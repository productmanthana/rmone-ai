import { Router } from "express";
import { openai, openaiConfigured } from "../lib/openai-client.js";
import type { Request, Response } from "express";
import { resolveRequestSource, isSuperAdminSource, ROOT_SUPERADMIN_ACCOUNTS } from "../lib/rds-auth.js";
import {
  getSuperadminEmails,
  getAllSuperadminAccounts,
  insertSuperadminAccount,
  deleteSuperadminAccount,
  getAllOnboardingJobsMeta,
  getTenantStatuses,
  upsertTenantStatus,
  getTenantStatus,
} from "@workspace/db";
import { getPool, sql } from "../lib/db.js";
import { runAndReportIntegrityScan, getLastIntegrityScan } from "../lib/allocation-integrity-scan.js";
import { createStaffRds, StaffConflictError } from "../lib/staff.js";
import {
  scanLegacyAssignmentDuplicatesRds,
  consolidateLegacyAssignmentDuplicatesRds,
  LegacyAssignmentConsolidationError,
} from "../lib/rds-provider.js";
import { boundedAuditChanges, setAuditTarget, setTrustedAuditChanges, trustedAuditDiff } from "../lib/auditTrail.js";

const router = Router();

// ── DB-backed superadmin cache ────────────────────────────────────────────────
// Root accounts (hardcoded) are always superadmin. Additional accounts live in
// the superadmin_accounts Postgres table and are cached here for 60s.
let _saCache: { emails: Set<string>; expiresAt: number } | null = null;

async function getDbSuperadminEmails(): Promise<Set<string>> {
  const now = Date.now();
  if (_saCache && _saCache.expiresAt > now) return _saCache.emails;
  try {
    const rows = await getSuperadminEmails();
    const emails = new Set(rows.map(r => r.email.trim().toLowerCase()));
    _saCache = { emails, expiresAt: now + 60_000 };
    return emails;
  } catch {
    return _saCache?.emails ?? new Set();
  }
}

export function bustSuperadminCache() { _saCache = null; }

async function isSuperAdminExtended(src: { username?: string }): Promise<boolean> {
  const uname = (src.username || "").trim().toLowerCase();
  if (!uname) return false;
  if ((ROOT_SUPERADMIN_ACCOUNTS as string[]).includes(uname)) return true;
  const dbEmails = await getDbSuperadminEmails();
  return dbEmails.has(uname);
}

const RMONE_TENANT = "rmone";

async function guard(req: Request, res: Response): Promise<boolean> {
  const src = resolveRequestSource(req);
  // Superadmin portal requires (a) a valid RDS token, (b) an rmone-tenant login,
  // and (c) an account in the superadmin allowlist.
  if (!src || src.tenant.trim().toLowerCase() !== RMONE_TENANT || !(await isSuperAdminExtended(src))) {
    res.status(403).json({ error: "superadmin_required" });
    return false;
  }
  return true;
}

async function readCompanyProfileAudit(tenantId: string): Promise<Record<string, unknown>> {
  const pool = await getPool();
  const result: Record<string, unknown> = {};
  const company = await pool.request()
    .input("tid", sql.NVarChar, tenantId)
    .query(`SELECT TOP 1 WebsiteUrl, Telephone, EmailAddress, StreetAddress1,
                   City, State, Zip, Country, SectorChoice, OwnershipTypeChoice,
                   ContractorLicense
            FROM core2.dbo.CRMCompany WHERE TenantID = @tid`);
  const row = (company.recordset ?? [])[0] as Record<string, unknown> | undefined;
  if (row) {
    Object.assign(result, {
      website: row.WebsiteUrl ?? "",
      phone: row.Telephone ?? "",
      companyEmail: row.EmailAddress ?? "",
      streetAddress: row.StreetAddress1 ?? "",
      city: row.City ?? "",
      state: row.State ?? "",
      zip: row.Zip ?? "",
      country: row.Country ?? "",
      industry: row.SectorChoice ?? "",
      ownershipType: row.OwnershipTypeChoice ?? "",
      licenseNumber: row.ContractorLicense ?? "",
    });
  }
  if (!result.country) {
    try {
      const tenant = await pool.request().input("tid2", sql.NVarChar, tenantId)
        .query("SELECT TOP 1 Country FROM core2.dbo.Tenant WHERE TenantID = @tid2");
      result.country = tenant.recordset?.[0]?.Country ?? "";
    } catch {
      // Optional Tenant.Country enrichment.
    }
  }
  return result;
}

// ── Fleet summary cache ──────────────────────────────────────────────────────
let _fleetCache: { data: FleetSummary; expiresAt: number } | null = null;
const FLEET_TTL_MS = 60_000;

export interface TenantSummary {
  tenantId: string;
  companyName: string;
  latestStatus: string;
  latestImportAt: string | null;
  totalInserted: number;
  totalErrors: number;
  runCount: number;
  activitySparkline: number[];
  projectCount: number;
  staffCount: number;
  oppCount: number;
  assignmentCount: number;
  readinessScore: number;
  isActive: boolean;
}

export interface FleetSummary {
  tenants: TenantSummary[];
  totals: {
    companies: number;
    projects: number;
    staff: number;
    opps: number;
    assignments: number;
  };
  activityByDay: { date: string; inserted: number }[];
}

export async function fetchAllTenantIds(): Promise<string[]> {
  try {
    const pool = await getPool();
    // Union across all fact tables so tenants present in any table are discovered
    const r = await pool.request().query(`
      SELECT DISTINCT TenantID FROM core2.dbo.AspNetUsers       WHERE TenantID IS NOT NULL AND TenantID <> ''
      UNION
      SELECT DISTINCT TenantID FROM core2.dbo.PMM               WHERE TenantID IS NOT NULL AND TenantID <> ''
      UNION
      SELECT DISTINCT TenantID FROM core2.dbo.Opportunity        WHERE TenantID IS NOT NULL AND TenantID <> ''
      UNION
      SELECT DISTINCT TenantID FROM core2.dbo.ResourceWorkItems  WHERE TenantID IS NOT NULL AND TenantID <> ''
    `);
    return r.recordset.map((row: any) => String(row.TenantID)).filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchCountsBatch(tenantIds: string[]): Promise<Map<string, { projects: number; staff: number; opps: number; assignments: number }>> {
  const result = new Map<string, { projects: number; staff: number; opps: number; assignments: number }>();
  if (!tenantIds.length) return result;
  try {
    const pool = await getPool();
    const idList = tenantIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
    // Each CTE aggregates one fact table independently.
    // A UNION seed ensures every requested tenant appears even if absent from some tables.
    const r = await pool.request().query(`
      WITH seed AS (
        SELECT val AS TenantID FROM (VALUES ${tenantIds.map(id => `('${id.replace(/'/g, "''")}')`).join(",")}) v(val)
      ),
      pmm_counts AS (
        SELECT TenantID, COUNT(*) AS cnt
        FROM core2.dbo.PMM
        WHERE TenantID IN (${idList}) AND (Deleted=0 OR Deleted IS NULL)
        GROUP BY TenantID
      ),
      opp_counts AS (
        SELECT TenantID, COUNT(*) AS cnt
        FROM core2.dbo.Opportunity
        WHERE TenantID IN (${idList}) AND (Deleted=0 OR Deleted IS NULL)
        GROUP BY TenantID
      ),
      staff_counts AS (
        SELECT TenantID, COUNT(*) AS cnt
        FROM core2.dbo.AspNetUsers
        WHERE TenantID IN (${idList}) AND (Deleted=0 OR Deleted IS NULL) AND Enabled=1
        GROUP BY TenantID
      ),
      rw_counts AS (
        SELECT TenantID, COUNT(*) AS cnt
        FROM core2.dbo.ResourceWorkItems
        WHERE TenantID IN (${idList}) AND (Deleted=0 OR Deleted IS NULL)
        GROUP BY TenantID
      )
      SELECT
        s.TenantID                  AS tid,
        ISNULL(p.cnt,  0)           AS projects,
        ISNULL(st.cnt, 0)           AS staff,
        ISNULL(o.cnt,  0)           AS opps,
        ISNULL(r.cnt,  0)           AS assignments
      FROM seed s
      LEFT JOIN pmm_counts   p  ON p.TenantID  = s.TenantID
      LEFT JOIN opp_counts   o  ON o.TenantID  = s.TenantID
      LEFT JOIN staff_counts st ON st.TenantID = s.TenantID
      LEFT JOIN rw_counts    r  ON r.TenantID  = s.TenantID
    `);
    for (const row of r.recordset ?? []) {
      result.set(String(row.tid), {
        projects:    Number(row.projects    ?? 0),
        staff:       Number(row.staff       ?? 0),
        opps:        Number(row.opps        ?? 0),
        assignments: Number(row.assignments ?? 0),
      });
    }
  } catch {
    // non-fatal: counts stay at 0, dashboard still renders with what it has
  }
  return result;
}

function readinessScore(s: TenantSummary): number {
  // Score based on real data signals, not just import status
  let score = 0;
  // Data signals (up to 70 points)
  if (s.staffCount > 0)      score += 25;
  if (s.projectCount > 0)    score += 25;
  if (s.oppCount > 0)        score += 20;
  // Additional data depth bonus (up to 10 points)
  if (s.staffCount > 10)     score += 5;
  if (s.projectCount > 5)    score += 5;
  // Import status modifier (up to 20 points)
  if (s.latestStatus === "success") score += 20;
  else if (s.latestStatus === "partial") score += 10;
  else if (s.latestStatus === "failed")  score -= 5;
  return Math.max(0, Math.min(100, score));
}

export async function fetchCompanyNames(tenantIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!tenantIds.length) return result;
  try {
    const pool = await getPool();
    // Check table exists first (non-fatal if absent)
    const chk = await pool.request()
      .query(`SELECT 1 AS found FROM core2.INFORMATION_SCHEMA.TABLES
              WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='CRMCompany'`);
    if (!(chk.recordset ?? []).length) return result;
    const idList = tenantIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
    const r = await pool.request().query(
      `SELECT TenantID, MAX(Title) AS Title
       FROM core2.dbo.CRMCompany
       WHERE TenantID IN (${idList}) AND Title IS NOT NULL AND Title <> ''
       GROUP BY TenantID`
    );
    for (const row of r.recordset ?? []) {
      if (row.TenantID && row.Title) result.set(String(row.TenantID), String(row.Title));
    }
  } catch {
    // non-fatal — names stay empty, IDs shown as fallback
  }
  return result;
}

async function buildFleetSummary(): Promise<FleetSummary> {
  // Load onboarding job history (meta only — the fleet summary never needs
  // the raw Excel blobs, and skipping file_data keeps this query fast).
  const rows = await getAllOnboardingJobsMeta();

  const byTenant = new Map<string, typeof rows>();
  for (const row of rows) {
    const tid = row.tenantId ?? "unknown";
    if (!byTenant.has(tid)) byTenant.set(tid, []);
    byTenant.get(tid)!.push(row);
  }

  // Also discover tenants that exist in core2 but have no onboarding jobs
  let allCore2Ids: string[] = [];
  try {
    allCore2Ids = await fetchAllTenantIds();
  } catch {
    // non-fatal — core2 may be unreachable; stick with job-history tenants
  }
  for (const tid of allCore2Ids) {
    if (!byTenant.has(tid)) {
      byTenant.set(tid, []);  // empty run list signals "no onboarding history"
    }
  }

  // Fetch all counts in one batched query
  const allTenantIds = [...byTenant.keys()];
  const [countsMap, namesMap] = await Promise.all([
    fetchCountsBatch(allTenantIds),
    fetchCompanyNames(allTenantIds),
  ]);

  // Batch-fetch active/inactive flags from our Postgres tenant_status table
  const activeMap = new Map<string, boolean>();
  if (allTenantIds.length) {
    try {
      const statusRows = await getTenantStatuses(allTenantIds);
      for (const row of statusRows) {
        activeMap.set(row.tenantId, row.isActive);
      }
    } catch {
      // non-fatal — default to active
    }
  }

  const tenants: TenantSummary[] = [];
  for (const [tenantId, runs] of byTenant) {
    const latest = runs[0] ?? null;
    const totalInserted = runs.reduce((n, r) => n + (r.totalInserted ?? 0), 0);
    const totalErrors   = runs.reduce((n, r) => n + (r.totalErrors   ?? 0), 0);
    const last5 = runs.slice(0, 5).map(r => r.totalInserted ?? 0).reverse();

    const counts = countsMap.get(tenantId) ?? { projects: 0, staff: 0, opps: 0, assignments: 0 };
    const partial: TenantSummary = {
      tenantId,
      companyName:    namesMap.get(tenantId) ?? "",
      latestStatus:   latest?.status ?? "never",
      latestImportAt: latest?.createdAt ? String(latest.createdAt) : null,
      totalInserted,
      totalErrors,
      runCount: runs.length,
      activitySparkline: last5,
      projectCount:    counts.projects,
      staffCount:      counts.staff,
      oppCount:        counts.opps,
      assignmentCount: counts.assignments,
      readinessScore:  0,
      isActive:        activeMap.get(tenantId) ?? true,
    };
    partial.readinessScore = readinessScore(partial);
    // Skip ghost tenants: no jobs AND no data in core2 (stale/orphaned TenantIDs)
    if (runs.length === 0 && counts.staff === 0 && counts.projects === 0 && counts.opps === 0) continue;
    tenants.push(partial);
  }

  // Sort: tenants with real data first, then by last import date
  tenants.sort((a, b) => {
    const aHasData = a.projectCount + a.staffCount + a.oppCount;
    const bHasData = b.projectCount + b.staffCount + b.oppCount;
    if (bHasData !== aHasData) return bHasData - aHasData;
    return (b.latestImportAt ?? "").localeCompare(a.latestImportAt ?? "");
  });

  const dayMap = new Map<string, number>();
  for (const row of rows) {
    if (!row.createdAt) continue;
    const d = String(row.createdAt).slice(0, 10);
    dayMap.set(d, (dayMap.get(d) ?? 0) + (row.totalInserted ?? 0));
  }
  const activityByDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, inserted]) => ({ date, inserted }));

  return {
    tenants,
    totals: {
      companies:   tenants.length,
      projects:    tenants.reduce((n, t) => n + t.projectCount, 0),
      staff:       tenants.reduce((n, t) => n + t.staffCount, 0),
      opps:        tenants.reduce((n, t) => n + t.oppCount, 0),
      assignments: tenants.reduce((n, t) => n + t.assignmentCount, 0),
    },
    activityByDay,
  };
}

// ── GET /api/superadmin/fleet ────────────────────────────────────────────────
router.get("/fleet", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  try {
    const now = Date.now();
    if (_fleetCache && _fleetCache.expiresAt > now) {
      res.json(_fleetCache.data);
      return;
    }
    const data = await buildFleetSummary();
    _fleetCache = { data, expiresAt: now + FLEET_TTL_MS };
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── AI analysis cache ─────────────────────────────────────────────────────────
let _aiCache: { text: string; bullets: string[]; generatedAt: number; expiresAt: number } | null = null;
const AI_TTL_MS = 10 * 60_000;

function buildFleetContext(fleet: FleetSummary): string {
  const now = Date.now();
  const MS_PER_DAY = 86_400_000;

  // Helper: prefer company name, fall back to short GUID
  const dn = (t: TenantSummary) => t.companyName || t.tenantId;

  // Per-tenant enriched lines with stall detection and utilisation signals
  const tenantLines = fleet.tenants.slice(0, 25).map(t => {
    const daysSince = t.latestImportAt
      ? Math.floor((now - new Date(t.latestImportAt).getTime()) / MS_PER_DAY)
      : null;
    const stalledNote =
      (t.latestStatus === "partial" || t.latestStatus === "running") && daysSince !== null && daysSince >= 3
        ? ` [STALLED ${daysSince}d ago]`
        : daysSince !== null && daysSince > 14 && t.latestStatus !== "never"
        ? ` [dormant ${daysSince}d]`
        : "";
    const utilRatio =
      t.projectCount > 0
        ? (t.assignmentCount / t.projectCount).toFixed(1)
        : "0.0";
    const utilNote =
      t.projectCount >= 5 && t.assignmentCount === 0
        ? " [NO_ASSIGNMENTS]"
        : t.staffCount > 0 && t.assignmentCount === 0 && t.projectCount > 0
        ? " [staff_unassigned]"
        : "";
    return `- ${dn(t)}: status=${t.latestStatus}${stalledNote}, projects=${t.projectCount}, staff=${t.staffCount}, opps=${t.oppCount}, assignments=${t.assignmentCount} (${utilRatio}/proj)${utilNote}, readiness=${t.readinessScore}%, runs=${t.runCount}, lastImport=${t.latestImportAt?.slice(0, 10) ?? "never"}`;
  }).join("\n");

  // Aggregate signals
  const failed = fleet.tenants
    .filter(t => t.latestStatus === "failed")
    .map(t => dn(t)).join(", ") || "none";

  const stalled = fleet.tenants
    .filter(t => {
      if (!t.latestImportAt) return false;
      const d = Math.floor((now - new Date(t.latestImportAt).getTime()) / MS_PER_DAY);
      return (t.latestStatus === "partial" || t.latestStatus === "running") && d >= 3;
    })
    .map(t => {
      const d = Math.floor((now - new Date(t.latestImportAt!).getTime()) / MS_PER_DAY);
      return `${dn(t)} (${d}d)`;
    }).join(", ") || "none";

  const noImport = fleet.tenants
    .filter(t => !t.latestImportAt || t.latestStatus === "never")
    .map(t => dn(t)).join(", ") || "none";

  const dormant = fleet.tenants
    .filter(t => {
      if (!t.latestImportAt || t.latestStatus === "never") return false;
      const d = Math.floor((now - new Date(t.latestImportAt).getTime()) / MS_PER_DAY);
      return d > 14;
    })
    .map(t => {
      const d = Math.floor((now - new Date(t.latestImportAt!).getTime()) / MS_PER_DAY);
      return `${dn(t)} (${d}d since last import)`;
    }).join(", ") || "none";

  const noAssignments = fleet.tenants
    .filter(t => t.projectCount >= 5 && t.assignmentCount === 0)
    .map(t => `${dn(t)} (${t.projectCount} projects, 0 assignments)`)
    .join(", ") || "none";

  const topByProjects = [...fleet.tenants]
    .sort((a, b) => b.projectCount - a.projectCount)
    .slice(0, 3)
    .map(t => `${dn(t)} (${t.projectCount} projects, ${t.staffCount} staff)`)
    .join(", ");

  const topByOpps = [...fleet.tenants]
    .sort((a, b) => b.oppCount - a.oppCount)
    .slice(0, 3)
    .map(t => `${dn(t)} (${t.oppCount} opps)`)
    .join(", ");

  return `Fleet overview — ${fleet.totals.companies} companies | ${fleet.totals.projects} projects | ${fleet.totals.staff} staff | ${fleet.totals.opps} opportunities | ${fleet.totals.assignments} assignments

Per-company detail:
${tenantLines}

== Attention signals ==
Failed imports: ${failed}
Stalled onboardings (partial/running ≥3 days): ${stalled}
Never imported: ${noImport}
Dormant (>14 days since last import): ${dormant}
Projects with zero staff assignments (≥5 projects): ${noAssignments}
Top companies by project count: ${topByProjects}
Top companies by opportunity count: ${topByOpps}`;
}

// ── GET /api/superadmin/ai-analysis ─────────────────────────────────────────
router.get("/ai-analysis", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  const now = Date.now();
  if (_aiCache && _aiCache.expiresAt > now) {
    res.json({ bullets: _aiCache.bullets, text: _aiCache.text, generatedAt: _aiCache.generatedAt, cached: true });
    return;
  }
  try {
    const fleet = _fleetCache?.data ?? await buildFleetSummary();
    const context = buildFleetContext(fleet);

    const systemPrompt = `You are an operations analyst for RM ONE, a construction project management platform. Your job is to produce a concise, actionable executive briefing for the platform's operations team.

Rules:
- Output exactly 4–6 bullet points, each on its own line, starting with "- "
- Each bullet must reference specific company names and numbers from the data
- Prioritise: (1) stalled/failed onboardings by name and days, (2) utilisation anomalies, (3) dormant accounts, (4) healthy growth highlights
- Be direct and specific — no generic statements like "some companies need attention"
- Plain language only, no markdown headers, no bold/italic`;

    if (!openaiConfigured()) {
      res.json({ bullets: ["OpenAI API key not configured — analysis unavailable."], text: "", generatedAt: now, cached: false });
      return;
    }
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: context },
      ],
      max_tokens: 700,
      temperature: 0.25,
    });
    const text = completion.choices[0]?.message?.content ?? "";
    const bullets = text
      .split(/\n/)
      .map(l => l.trim().replace(/^[-•*]\s*/, "").replace(/^\d+\.\s*/, ""))
      .filter(l => l.length > 10);

    _aiCache = { text, bullets, generatedAt: now, expiresAt: now + AI_TTL_MS };
    res.json({ bullets, text, generatedAt: now, cached: false });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/superadmin/ai-analysis/refresh ─────────────────────────────────
router.post("/ai-analysis/refresh", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  _aiCache = null;
  _fleetCache = null;
  res.json({ ok: true });
});

// ── GET /api/superadmin/company-admins/:tenantId ─────────────────────────────
// Returns all admin users (IsSiteAdmin=1) for the given tenant from core2.
router.get("/company-admins/:tenantId", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  const rawTid = String(req.params.tenantId).trim();
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input("tid", sql.NVarChar, rawTid)
      .query(`SELECT Id, Name, Email, IsSiteAdmin, IsDefaultAdmin, Enabled
              FROM core2.dbo.AspNetUsers
              WHERE TenantID=@tid
                AND (Deleted=0 OR Deleted IS NULL)
                AND (ISNULL(IsSiteAdmin,0)=1 OR ISNULL(IsDefaultAdmin,0)=1)
              ORDER BY Name`);
    res.json({
      admins: r.recordset.map((u: Record<string, unknown>) => ({
        userGuid: u.Id,
        name:     u.Name ?? "",
        email:    u.Email ?? "",
        isDefault: !!(u.IsDefaultAdmin),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/superadmin/company-admins/:tenantId ────────────────────────────
// Create a new admin user for a tenant. Body: { name, email }
// Creates an AspNetUsers entry with IsSiteAdmin=1 + scrambled password, then
// the caller can fire /api/onboarding/invites/send to deliver the set-password link.
router.post("/company-admins/:tenantId", async (req: Request, res: Response): Promise<void> => {
  if (!(await guard(req, res))) return;
  const rawTid = String(req.params.tenantId).trim();
  const { name, email } = req.body as { name?: string; email?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  if (!email?.trim() || !email.includes("@")) { res.status(400).json({ error: "A valid email address is required" }); return; }

  try {
    const { userGuid } = await createStaffRds(rawTid, {
      name: name.trim(),
      email: email.trim(),
      accessLevel: "Admin",
    });
    setAuditTarget(res, { entityType: "staff", entityId: userGuid || email.trim(), entityName: name.trim() });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Name", OldValue: null, NewValue: name.trim() },
      { FieldName: "Email", OldValue: null, NewValue: email.trim() },
      { FieldName: "Role", OldValue: null, NewValue: "Admin" },
    ]));
    res.json({ ok: true, userGuid, name: name.trim(), email: email.trim() });
  } catch (e) {
    if (e instanceof StaffConflictError) {
      res.status(409).json({ error: e.message }); return;
    }
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/superadmin/tenant-status/:tenantId ───────────────────────────────
router.get("/tenant-status/:tenantId", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  const tenantId = String(req.params.tenantId);
  try {
    const row = await getTenantStatus(tenantId);
    res.json({ tenantId, isActive: row?.isActive ?? true, note: row?.note ?? null, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/superadmin/tenant-status/:tenantId ──────────────────────────────
router.post("/tenant-status/:tenantId", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  const tenantId = String(req.params.tenantId);
  const { isActive, note } = req.body as { isActive?: boolean; note?: string };
  const src = resolveRequestSource(req);
  const updatedBy = src?.username ?? null;
  try {
    let before: Awaited<ReturnType<typeof getTenantStatus>> = null;
    try { before = await getTenantStatus(tenantId); } catch { /* audit enrichment only */ }
    await upsertTenantStatus({ tenantId, isActive: isActive ?? true, note: note ?? null, updatedBy, updatedAt: new Date() });
    _fleetCache = null;
    setAuditTarget(res, { entityType: "configuration", entityId: `tenant:${tenantId}`, entityName: tenantId });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Enabled", OldValue: before?.isActive ?? true, NewValue: isActive ?? true },
    ]));
    res.json({ ok: true, tenantId, isActive: isActive ?? true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/superadmin/integrity-scan ───────────────────────────────────────
// Returns the most recent junk-allocation scan result (nightly or manual).
// Never runs the query itself — use POST /integrity-scan/run for a fresh scan.
router.get("/integrity-scan", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  const last = getLastIntegrityScan();
  res.json(last ?? { ok: true, ranAt: null, totalFindings: 0, findings: [], byTenant: {}, truncated: false, neverRan: true });
});

// ── POST /api/superadmin/integrity-scan/run ──────────────────────────────────
// Superadmin-triggered DRY-RUN sweep of the two junk-allocation signatures
// (S1: assigned + 0h + pct>150; S2: hours beyond the physical span cap).
// Findings are returned + logged with tenant and row IDs — NEVER auto-deleted.
router.post("/integrity-scan/run", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  try {
    const result = await runAndReportIntegrityScan("manual");
    res.status(result.ok ? 200 : 500).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/superadmin/legacy-assignment-duplicates ─────────────────────────
// Read-only review of pre-duplicate-guard assignment identities. Results include
// held/conflicting groups as well as safely mergeable ones, so an operator sees
// exactly why a group cannot be consolidated.
router.get("/legacy-assignment-duplicates", async (req: Request, res: Response): Promise<void> => {
  if (!(await guard(req, res))) return;
  const rawTenant = typeof req.query.tenantId === "string" ? req.query.tenantId.trim() : "";
  try {
    const findings = await scanLegacyAssignmentDuplicatesRds(rawTenant || undefined);
    const maxRows = 500;
    res.json({
      ok: true,
      ranAt: new Date().toISOString(),
      totalFindings: findings.length,
      findings: findings.slice(0, maxRows),
      truncated: findings.length > maxRows,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/superadmin/legacy-assignment-duplicates/consolidate ────────────
// Explicit, reviewed merge only. The server re-reads the entire group under
// transaction locks and refuses stale selections, locks, role mismatches, and
// conflicting hours. Retired rows are soft-deleted and carry the actor in their
// normal ModifiedByUser audit field.
router.post("/legacy-assignment-duplicates/consolidate", async (req: Request, res: Response): Promise<void> => {
  if (!(await guard(req, res))) return;
  const body = req.body as {
    tenantId?: unknown;
    assignmentIds?: unknown;
    canonicalRwiId?: unknown;
    confirmation?: unknown;
  };
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const assignmentIds = Array.isArray(body.assignmentIds)
    ? body.assignmentIds.map(Number).filter(Number.isSafeInteger)
    : [];
  const canonicalRwiId = Number(body.canonicalRwiId);
  if (body.confirmation !== "CONSOLIDATE") {
    res.status(400).json({ error: "Type CONSOLIDATE to confirm a reviewed assignment merge." });
    return;
  }
  if (!tenantId || assignmentIds.length < 2 || assignmentIds.length > 25 || !Number.isSafeInteger(canonicalRwiId)) {
    res.status(400).json({ error: "A tenant, one canonical assignment, and 2–25 assignment IDs are required." });
    return;
  }
  try {
    const src = resolveRequestSource(req);
    const result = await consolidateLegacyAssignmentDuplicatesRds({
      tenantId,
      assignmentIds,
      canonicalRwiId,
      actor: src?.username ?? "superadmin",
    });
    setAuditTarget(res, {
      entityType: "allocation",
      entityId: null,
      entityName: "Legacy assignment consolidation",
    });
    const mergedIds = [result.canonicalRwiId, ...result.retiredAssignmentIds];
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Merged assignment count", OldValue: mergedIds.length, NewValue: 1 },
      { FieldName: "Canonical assignment", OldValue: null, NewValue: result.canonicalRwiId },
      ...mergedIds.slice(0, 20).map((id, index) => ({
        FieldName: `Assignment sample ${index + 1}`,
        OldValue: id,
        NewValue: result.canonicalRwiId,
      })),
    ], mergedIds.length + 2, 22));
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof LegacyAssignmentConsolidationError) {
      res.status(e.code === "not_found" ? 404 : 409).json({ error: e.message, code: e.code });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/superadmin/check ─────────────────────────────────────────────────
// Lightweight auth probe — returns 200 if the caller is a superadmin (root OR
// DB-added), 403 otherwise. Used by the frontend to gate the portal for
// dynamically-added accounts without hardcoding their emails in client code.
router.get("/check", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  res.json({ ok: true });
});

// ── GET /api/superadmin/accounts ──────────────────────────────────────────────
// Lists every superadmin: root (hardcoded) + DB-added rows.
router.get("/accounts", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  try {
    const dbRows = await getAllSuperadminAccounts();
    const dbEmails = new Set(dbRows.map(r => r.email.toLowerCase()));
    const roots = (ROOT_SUPERADMIN_ACCOUNTS as string[]).map(email => ({
      email,
      isRoot: true,
      addedBy: null as string | null,
      addedAt: null as string | null,
    }));
    const added = dbRows
      .filter(r => !(ROOT_SUPERADMIN_ACCOUNTS as string[]).includes(r.email.toLowerCase()))
      .map(r => ({
        email: r.email,
        isRoot: false,
        addedBy: r.addedBy,
        addedAt: r.addedAt?.toISOString() ?? null,
      }));
    // Also surface roots that were inserted into DB (dedup)
    res.json({ accounts: [...roots, ...added], dbEmails: [...dbEmails] });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/superadmin/accounts ─────────────────────────────────────────────
// Adds a new email address to the superadmin_accounts table.
// Body: { email: string }
router.post("/accounts", async (req: Request, res: Response): Promise<void> => {
  if (!(await guard(req, res))) return;
  const src = resolveRequestSource(req);
  const { email } = req.body as { email?: string };
  if (!email?.trim() || !email.includes("@")) { res.status(400).json({ error: "A valid email address is required" }); return; }
  const normalised = email.trim().toLowerCase();
  if ((ROOT_SUPERADMIN_ACCOUNTS as string[]).includes(normalised)) { res.status(409).json({ error: "That email is already a root superadmin" }); return; }
  try {
    await insertSuperadminAccount(normalised, src?.username ?? null);
    bustSuperadminCache();
    setAuditTarget(res, { entityType: "staff", entityId: normalised, entityName: normalised });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Email", OldValue: null, NewValue: normalised },
      { FieldName: "Role", OldValue: null, NewValue: "Superadmin" },
    ]));
    res.json({ ok: true, email: normalised });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── DELETE /api/superadmin/accounts/:email ────────────────────────────────────
// Removes a DB-added superadmin. Root accounts cannot be removed here.
router.delete("/accounts/:email", async (req: Request, res: Response): Promise<void> => {
  if (!(await guard(req, res))) return;
  const email = decodeURIComponent(String(req.params.email)).trim().toLowerCase();
  if ((ROOT_SUPERADMIN_ACCOUNTS as string[]).includes(email)) { res.status(403).json({ error: "Root superadmin accounts cannot be removed" }); return; }
  try {
    let existed = false;
    try {
      existed = (await getAllSuperadminAccounts()).some((account) => account.email.toLowerCase() === email);
    } catch {
      // Audit enrichment is best-effort.
    }
    await deleteSuperadminAccount(email);
    bustSuperadminCache();
    setAuditTarget(res, { entityType: "staff", entityId: email, entityName: email, action: "delete.staff" });
    if (existed) {
      setTrustedAuditChanges(res, boundedAuditChanges([
        { FieldName: "Email", OldValue: email, NewValue: null },
        { FieldName: "Role", OldValue: "Superadmin", NewValue: null },
      ]));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/superadmin/company-profile/:tenantId ────────────────────────────
// Reads the current company profile fields from CRMCompany (+ Tenant.Country)
// for display in the Edit Company Profile form.
router.get("/company-profile/:tenantId", async (req: Request, res: Response) => {
  if (!(await guard(req, res))) return;
  const rawTid = String(req.params.tenantId).trim();
  try {
    const pool = await getPool();

    // Check CRMCompany exists and fetch the row for this tenant.
    const tableCheck = await pool.request()
      .input("tbl", sql.NVarChar, "CRMCompany")
      .query(`SELECT 1 AS found FROM core2.INFORMATION_SCHEMA.TABLES
              WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tbl`);

    let profile: Record<string, string | null> = {};

    if ((tableCheck.recordset ?? []).length > 0) {
      const r = await pool.request()
        .input("tid", sql.NVarChar, rawTid)
        .query(`SELECT TOP 1
                  Title,
                  WebsiteUrl, Telephone, EmailAddress,
                  StreetAddress1, Address, City, State, Zip, Country,
                  SectorChoice, OwnershipTypeChoice, ContractorLicense
                FROM core2.dbo.CRMCompany
                WHERE TenantID = @tid`);
      const row = (r.recordset ?? [])[0] as Record<string, unknown> | undefined;
      if (row) {
        profile = {
          companyName:   String(row.Title            ?? ""),
          website:       String(row.WebsiteUrl        ?? ""),
          phone:         String(row.Telephone         ?? ""),
          companyEmail:  String(row.EmailAddress      ?? ""),
          streetAddress: String(row.StreetAddress1 ?? row.Address ?? ""),
          city:          String(row.City              ?? ""),
          state:         String(row.State             ?? ""),
          zip:           String(row.Zip               ?? ""),
          country:       String(row.Country           ?? ""),
          industry:      String(row.SectorChoice      ?? ""),
          ownershipType: String(row.OwnershipTypeChoice ?? ""),
          licenseNumber: String(row.ContractorLicense ?? ""),
        };
      }
    }

    // Try Tenant.Country as a fallback/supplement for the country field.
    if (!profile.country) {
      try {
        const tc = await pool.request()
          .input("tid2", sql.NVarChar, rawTid)
          .query(`SELECT TOP 1 Country FROM core2.dbo.Tenant WHERE TenantID = @tid2`);
        const trow = (tc.recordset ?? [])[0] as Record<string, unknown> | undefined;
        if (trow?.Country) profile.country = String(trow.Country);
      } catch {
        // non-fatal
      }
    }

    res.json({ tenantId: rawTid, profile });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── PATCH /api/superadmin/company-profile/:tenantId ──────────────────────────
// Writes updated company profile fields to CRMCompany (and Tenant.Country).
// All fields are optional — only provided non-blank values are written.
router.patch("/company-profile/:tenantId", async (req: Request, res: Response): Promise<void> => {
  if (!(await guard(req, res))) return;
  const rawTid = String(req.params.tenantId).trim();
  const {
    website, phone, companyEmail, streetAddress,
    city, state, zip, country,
    industry, ownershipType, licenseNumber,
  } = req.body as {
    website?: string; phone?: string; companyEmail?: string;
    streetAddress?: string; city?: string; state?: string; zip?: string; country?: string;
    industry?: string; ownershipType?: string; licenseNumber?: string;
  };

  try {
    let auditBefore: Record<string, unknown> | null = null;
    try { auditBefore = await readCompanyProfileAudit(rawTid); } catch { /* audit enrichment only */ }
    const pool = await getPool();

    // ── Update CRMCompany ──────────────────────────────────────────────────────
    const tableCheck = await pool.request()
      .input("tbl", sql.NVarChar, "CRMCompany")
      .query(`SELECT 1 AS found FROM core2.INFORMATION_SCHEMA.TABLES
              WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tbl`);

    if ((tableCheck.recordset ?? []).length > 0) {
      const colsRes = await pool.request()
        .input("tbl2", sql.NVarChar, "CRMCompany")
        .query(`SELECT COLUMN_NAME FROM core2.INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tbl2`);
      const liveCols = new Set(
        ((colsRes.recordset ?? []) as { COLUMN_NAME: string }[]).map(r => r.COLUMN_NAME.toLowerCase()),
      );

      const fieldMap: [string, string | undefined][] = [
        ["WebsiteUrl",          website],
        ["Telephone",           phone],
        ["EmailAddress",        companyEmail],
        ["StreetAddress1",      streetAddress],
        ["Address",             streetAddress],
        ["City",                city],
        ["State",               state],
        ["Zip",                 zip],
        ["Country",             country],
        ["SectorChoice",        industry],
        ["OwnershipTypeChoice", ownershipType],
        ["ContractorLicense",   licenseNumber],
      ];

      const sets: string[] = [];
      const req2 = pool.request().input("tid", sql.NVarChar, rawTid);
      let pi = 0;
      for (const [col, val] of fieldMap) {
        if (val === undefined || val === null || !liveCols.has(col.toLowerCase())) continue;
        const pname = `p${pi++}`;
        sets.push(`[${col}] = @${pname}`);
        req2.input(pname, sql.NVarChar, val.trim());
      }

      if (sets.length > 0) {
        const existing = await pool.request()
          .input("tid3", sql.NVarChar, rawTid)
          .query(`SELECT TOP 1 ID FROM core2.dbo.CRMCompany WHERE TenantID = @tid3`);

        if ((existing.recordset ?? []).length > 0) {
          await req2.query(`UPDATE core2.dbo.CRMCompany SET ${sets.join(", ")} WHERE TenantID = @tid`);
        }
      }
    }

    // ── Update Tenant.Country ─────────────────────────────────────────────────
    if (country !== undefined) {
      try {
        const tCheck = await pool.request()
          .input("tc", sql.NVarChar, "Tenant")
          .query(`SELECT 1 AS found FROM core2.INFORMATION_SCHEMA.TABLES
                  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tc`);
        if ((tCheck.recordset ?? []).length > 0) {
          const tCols = await pool.request()
            .input("tc2", sql.NVarChar, "Tenant")
            .query(`SELECT COLUMN_NAME FROM core2.INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tc2`);
          const tLive = new Set(
            ((tCols.recordset ?? []) as { COLUMN_NAME: string }[]).map(r => r.COLUMN_NAME.toLowerCase()),
          );
          if (tLive.has("country") && tLive.has("tenantid")) {
            await pool.request()
              .input("tid4", sql.NVarChar, rawTid)
              .input("ctry", sql.NVarChar, country.trim())
              .query(`UPDATE core2.dbo.Tenant SET [Country] = @ctry WHERE [TenantID] = @tid4`);
          }
        }
      } catch (tenantErr) {
        console.warn(`[company-profile] Tenant.Country update skipped: ${String(tenantErr).slice(0, 200)}`);
      }
    }

    setAuditTarget(res, { entityType: "configuration", entityId: `tenant:${rawTid}`, entityName: rawTid });
    if (auditBefore) {
      try {
        const auditAfter = await readCompanyProfileAudit(rawTid);
        setTrustedAuditChanges(res, trustedAuditDiff(auditBefore, auditAfter, { limit: 30 }));
      } catch {
        // The committed write succeeded; omit detail if its audit re-read fails.
      }
    }
    res.json({ ok: true, tenantId: rawTid });
  } catch (e) {
    console.error("[company-profile] patch error:", String(e));
    res.status(500).json({ error: String(e) });
  }
});

export default router;
