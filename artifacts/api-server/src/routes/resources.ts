import { Router, type IRouter, type Request, type Response } from "express";
import {
  getSkillCatalog, insertSkillIfNotExists,
  getResourceSkillsByGuid, getResourceSkillsByTenant, insertResourceSkill, deleteResourceSkill,
  getResourceProfile, upsertResourceProfile,
  getResourceCertifications, insertResourceCertification, deleteResourceCertification,
  getResourceEducation, insertResourceEducation, deleteResourceEducation,
  getResourceWorkHistory, insertResourceWorkHistory, deleteResourceWorkHistory,
  getResourceProjects, insertResourceProject, deleteResourceProject,
  getResourceResumes, insertResourceResume, deleteResourceResume, clearPrimaryResumes,
  getExperienceTagCatalog, insertExperienceTagIfNotExists,
  getUserExperienceTagsByGuid, insertUserExperienceTag, deleteUserExperienceTag,
  getUsersByTenantAndIds,
  getResourceAvailabilityByGuid, getResourceAvailabilityByTenant,
  upsertResourceAvailabilityByDates, updateResourceAvailability, deleteResourceAvailability,
  ensureLeaveTypeColumn,
} from "@workspace/db";

// Idempotently ensure the leave_type column exists on first load.
void ensureLeaveTypeColumn().catch((e: unknown) => console.warn("[resources] ensureLeaveTypeColumn:", e));
import { resolveRequestSource, isSuperAdminSource } from "../lib/rds-auth.js";
import { resolveTenantId } from "../lib/pipeline.js";
import { isValidSessionToken } from "./rmone-proxy.js";
import { getPool } from "../lib/db.js";
import {
  setAuditTarget,
  setTrustedAuditChanges,
  trustedAuditDiff,
} from "../lib/auditTrail.js";

const router: IRouter = Router();

// All resource-enrichment data lives in OUR Postgres, keyed by the core2
// AspNetUsers.Id GUID (resourceGuid) and tenant GUID (tid). The legacy core2
// schema is never written here — these are additive capabilities (resumes,
// skills, certifications, education, work history, portfolio) the old schema
// could not represent in a structured, queryable way.

function ctx(req: Request, res: Response): { tid: string } | null {
  const rds = resolveRequestSource(req);
  if (!rds) {
    res.status(401).json({ ok: false, message: "Not signed in." });
    return null;
  }
  return { tid: rds.tid };
}

// Dual-auth ctx for read-only Postgres endpoints: accepts either an RDS JWT
// (for RDS-native tenants) OR a valid upstream RM ONE Bearer token with the
// x-rmone-tenant header (for upstream/proxy-auth tenants). The tenant name in
// the header is mapped to the same deterministic UUID used by the pipeline.
async function ctxAny(req: Request, res: Response): Promise<{ tid: string } | null> {
  const rds = resolveRequestSource(req);
  if (rds) return { tid: rds.tid };
  const auth = req.headers.authorization ?? "";
  const tenantName = String(req.headers["x-rmone-tenant"] ?? "").trim();
  if (!auth || !tenantName) {
    res.status(401).json({ ok: false, message: "Not signed in." });
    return null;
  }
  const token = auth.replace(/^bearer\s+/i, "").trim();
  const ok = await isValidSessionToken(token).catch(() => false);
  if (!ok) {
    res.status(401).json({ ok: false, message: "Invalid or expired session." });
    return null;
  }
  return { tid: resolveTenantId(tenantName) };
}

function asInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function asNum(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
}
function asNumVal(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function asDate(v: unknown): string | null {
  const s = asStr(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
// Skill catalog (per-tenant taxonomy)
// ----------------------------------------------------------------------------
router.get("/skill-catalog", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  try {
    const rows = await getSkillCatalog(c.tid);
    res.json({ ok: true, total: rows.length, data: rows });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.post("/skill-catalog", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  setAuditTarget(res, { entityType: "configuration", entityId: "skill-catalog" });
  const name = asStr(req.body?.name);
  if (!name) { res.status(400).json({ ok: false, message: "name required" }); return; }
  let beforeIds: Set<number> | null = null;
  try { beforeIds = new Set((await getSkillCatalog(c.tid)).map((row) => row.id)); } catch { /* audit is best-effort */ }
  try {
    const id = await ensureCatalogSkill(c.tid, name, asStr(req.body?.category));
    if (beforeIds) {
      try {
        const after = (await getSkillCatalog(c.tid)).find((row) => row.id === id);
        if (after && !beforeIds.has(id)) {
          setTrustedAuditChanges(res, createdChanges(after, ["name"]));
        } else {
          setTrustedAuditChanges(res, []);
        }
      } catch { /* audit is best-effort */ }
    }
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

async function ensureCatalogSkill(tid: string, name: string, _category: string | null): Promise<number> {
  return insertSkillIfNotExists(tid, name);
}

// ----------------------------------------------------------------------------
// Skills-matching search: who has skill X at proficiency >= N
// ----------------------------------------------------------------------------
router.get("/search", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  const skill = asStr(req.query.skill);
  const minLevel = asInt(req.query.minLevel) ?? 1;
  if (!skill) { res.status(400).json({ ok: false, message: "skill query param required" }); return; }
  try {
    const allSkills = await getResourceSkillsByTenant(c.tid);
    const matches = allSkills
      .filter((s) => s.skillName.toLowerCase().includes(skill.toLowerCase()) && (s.proficiency ?? 0) >= minLevel)
      .sort((a, b) => (b.proficiency ?? 0) - (a.proficiency ?? 0));
    const guids = [...new Set(matches.map((m) => m.resourceGuid))];
    const names = await resolveResourceNames(c.tid, guids);
    const results = matches.map((m) => ({
      resourceGuid: m.resourceGuid,
      name: names[m.resourceGuid]?.name ?? null,
      email: names[m.resourceGuid]?.email ?? null,
      skillName: m.skillName,
      proficiency: m.proficiency,
      yearsExperience: m.yearsExperience,
      lastUsedYear: m.lastUsedYear,
    }));
    res.json({ ok: true, total: results.length, data: results });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// Enrich resource GUIDs with display name/email from core2 AspNetUsers (read-only).
async function resolveResourceNames(
  tid: string, guids: string[],
): Promise<Record<string, { name: string; email: string | null }>> {
  const out: Record<string, { name: string; email: string | null }> = {};
  if (guids.length === 0) return out;
  try {
    const guidsLow = guids.map(g => g.toLowerCase());
    const rows = await getUsersByTenantAndIds(tid, guidsLow).catch(() => []);
    for (const row of rows) {
      out[row.id] = { name: row.name || row.username || "", email: row.email || null };
    }
  } catch { /* name enrichment is best-effort */ }
  return out;
}

async function setStaffAuditTarget(res: Response, tid: string, guid: string): Promise<void> {
  setAuditTarget(res, { entityType: "staff", entityId: guid });
  const names = await resolveResourceNames(tid, [guid]);
  const name = names[guid]?.name;
  if (name) setAuditTarget(res, { entityName: name });
}

function rowObject(row: unknown): Record<string, unknown> | null {
  return row && typeof row === "object" && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null;
}

function createdChanges(row: unknown, fields: string[]): ReturnType<typeof trustedAuditDiff> {
  return trustedAuditDiff(null, rowObject(row), { fields });
}

// ----------------------------------------------------------------------------
// Leave / partial availability windows
// ----------------------------------------------------------------------------
// A window marks a person as fully out (0%) or partially available (1-99%)
// between two dates. 100% is the implicit default and is rejected.
// NOTE: this tenant-wide route MUST stay above the "/:guid" wildcard.
router.get("/availability-all", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  try {
    const rows = await getResourceAvailabilityByTenant(c.tid);
    res.json({ ok: true, total: rows.length, data: rows });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

function parseAvailBody(b: Record<string, unknown>): { startDate: string; endDate: string; availabilityPct: number; reason: string | null; leaveType: string | null } | string {
  const startDate = asDate(b.startDate);
  const endDate = asDate(b.endDate);
  if (!startDate || !endDate) return "startDate and endDate are required (YYYY-MM-DD)";
  if (endDate < startDate) return "endDate must be on or after startDate";
  const pct = asInt(b.availabilityPct) ?? 0;
  if (pct < 0 || pct > 99) return "availabilityPct must be 0-99 (0 = fully out)";
  const reason = asStr(b.reason);
  const leaveType = asStr(b.leaveType);
  return {
    startDate, endDate, availabilityPct: pct,
    reason: reason ? reason.slice(0, 400) : null,
    leaveType: leaveType ? leaveType.slice(0, 100) : null,
  };
}

router.get("/:guid/availability", async (req, res) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ ok: false, message: "Not signed in." }); return; }
  // Superadmin viewing another company's staff: honor the explicit tenant
  // override (guarded — non-superadmins always stay on their own tenant;
  // resolveTenantId is GUID-idempotent so passing a tid is safe).
  const tOverride = asStr(req.query.tenantId);
  const tid = tOverride && isSuperAdminSource(rds) ? resolveTenantId(tOverride) : rds.tid;
  try {
    const rows = await getResourceAvailabilityByGuid(tid, req.params.guid);
    res.json({ ok: true, total: rows.length, data: rows });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// Write gate for availability windows: mirrors the app-wide edit rule — an
// EXPLICIT "user" access level is view-only; admin/manager/unset (legacy
// grandfathered) may edit. Fails closed with 403.
function requireAvailEditor(req: Request, res: Response): { tid: string; username: string | null } | null {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ ok: false, message: "Not signed in." }); return null; }
  const acl = String(rds.accessLevel ?? "unset").trim().toLowerCase() || "unset";
  if (acl === "user") {
    res.status(403).json({ ok: false, message: "You don't have permission to change leave and availability." });
    return null;
  }
  // Superadmin editing another company's staff must write into THAT company's
  // rows, not the login tenant — guarded override, non-superadmins can never
  // redirect a write (same pattern as the other staff-modal write routes).
  const tOverride = asStr((req.body as Record<string, unknown> | undefined)?.tenantId) ?? asStr(req.query.tenantId);
  const tid = tOverride && isSuperAdminSource(rds) ? resolveTenantId(tOverride) : rds.tid;
  return { tid, username: rds.username ?? null };
}

router.post("/:guid/availability", async (req, res) => {
  const c = requireAvailEditor(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const parsed = parseAvailBody(req.body ?? {});
  if (typeof parsed === "string") { res.status(400).json({ ok: false, message: parsed }); return; }
  let before: Record<string, unknown> | null = null;
  try {
    const rows = await getResourceAvailabilityByGuid(c.tid, req.params.guid);
    before = rowObject(rows.find((row) => row.startDate === parsed.startDate && row.endDate === parsed.endDate));
  } catch { /* audit is best-effort */ }
  try {
    // Idempotent on dates: a window with the SAME start+end already exists →
    // updated in place instead of stacking a duplicate (Save auto-add +
    // "+ Add" double-fire, or an admin re-entering the same leave). Atomic —
    // the unique index in the DB backstops concurrent requests.
    const { row, deduped } = await upsertResourceAvailabilityByDates({
      tenantId: c.tid, resourceGuid: req.params.guid,
      ...parsed,
      createdBy: c.username,
    });
    setTrustedAuditChanges(res, trustedAuditDiff(before, rowObject(row), {
      fields: ["startDate", "endDate", "availabilityPct", "reason", "leaveType"],
    }));
    res.json({ ok: true, data: row, deduped });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.put("/:guid/availability/:id", async (req, res) => {
  const c = requireAvailEditor(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const id = asInt(req.params.id);
  if (id === null) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  const parsed = parseAvailBody(req.body ?? {});
  if (typeof parsed === "string") { res.status(400).json({ ok: false, message: parsed }); return; }
  let before: Record<string, unknown> | null = null;
  try {
    before = rowObject((await getResourceAvailabilityByGuid(c.tid, req.params.guid)).find((row) => row.id === id));
  } catch { /* audit is best-effort */ }
  try {
    // Row must belong to BOTH this tenant and this person — an id alone
    // must never reach across to another person's window.
    const row = await updateResourceAvailability(c.tid, req.params.guid, id, parsed);
    if (!row) { res.status(404).json({ ok: false, message: "not found" }); return; }
    if (before) {
      setTrustedAuditChanges(res, trustedAuditDiff(before, rowObject(row), {
        fields: ["startDate", "endDate", "availabilityPct", "reason", "leaveType"],
      }));
    }
    res.json({ ok: true, data: row });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.delete("/:guid/availability/:id", async (req, res) => {
  const c = requireAvailEditor(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const id = asInt(req.params.id);
  if (id === null) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  let before: Record<string, unknown> | null = null;
  try {
    before = rowObject((await getResourceAvailabilityByGuid(c.tid, req.params.guid)).find((row) => row.id === id));
  } catch { /* audit is best-effort */ }
  try {
    const gone = await deleteResourceAvailability(c.tid, req.params.guid, id);
    if (!gone) { res.status(404).json({ ok: false, message: "not found" }); return; }
    if (before) {
      setTrustedAuditChanges(res, trustedAuditDiff(before, null, {
        fields: ["startDate", "endDate", "availabilityPct", "reason", "leaveType"],
      }));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// Aggregate profile for one resource
// ----------------------------------------------------------------------------
router.get("/:guid", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  const guid = req.params.guid;
  try {
    const tid = c.tid;
    const [profile, skills, certs, education, work, projects, resumes, names] = await Promise.all([
      getResourceProfile(tid, guid),
      getResourceSkillsByGuid(tid, guid),
      getResourceCertifications(tid, guid),
      getResourceEducation(tid, guid),
      getResourceWorkHistory(tid, guid),
      getResourceProjects(tid, guid),
      getResourceResumes(tid, guid),
      resolveResourceNames(tid, [guid]),
    ]);
    res.json({
      ok: true,
      resourceGuid: guid,
      name: names[guid]?.name ?? null,
      email: names[guid]?.email ?? null,
      profile: profile ?? null,
      skills, certifications: certs, education, workHistory: work, projects, resumes,
    });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// Profile upsert
// ----------------------------------------------------------------------------
router.put("/:guid/profile", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  const guid = req.params.guid;
  await setStaffAuditTarget(res, c.tid, guid);
  const b = req.body ?? {};
  const availStr = asDate(b.availableFrom);
  const preferredRoles = Array.isArray(b.preferredRoles)
    ? (b.preferredRoles as unknown[]).map((s) => String(s).trim()).filter(Boolean)
    : asStr(b.preferredRoles)
      ? String(b.preferredRoles).split(",").map((s) => s.trim()).filter(Boolean)
      : null;
  const values = {
    tenantId: c.tid, resourceGuid: guid,
    headline: asStr(b.headline),
    bio: asStr(b.bio),
    location: asStr(b.location),
    yearsExperience: asNumVal(b.yearsExperience),
    availableFrom: availStr ? new Date(availStr) : null,
    preferredRoles,
    linkedinUrl: asStr(b.linkedinUrl),
    billingRate: asNumVal(b.billingRate),
    laborRate: asNumVal(b.laborRate),
    costRate: asNumVal(b.costRate),
  };
  let before: Record<string, unknown> | null | undefined;
  try { before = rowObject(await getResourceProfile(c.tid, guid)); } catch { /* audit is best-effort */ }
  try {
    const row = await upsertResourceProfile(values);
    if (before !== undefined) {
      setTrustedAuditChanges(res, trustedAuditDiff(before, rowObject(row), {
        fields: [
          "headline", "bio", "location", "yearsExperience", "availableFrom",
          "preferredRoles", "linkedinUrl", "billingRate", "laborRate", "costRate",
        ],
      }));
    }
    res.json({ ok: true, data: row });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// Skills CRUD
// ----------------------------------------------------------------------------
router.post("/:guid/skills", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  const guid = req.params.guid;
  await setStaffAuditTarget(res, c.tid, guid);
  const name = asStr(req.body?.skillName ?? req.body?.name);
  if (!name) { res.status(400).json({ ok: false, message: "skillName required" }); return; }
  const category = asStr(req.body?.category);
  let before: Record<string, unknown> | null | undefined;
  try {
    before = rowObject((await getResourceSkillsByGuid(c.tid, guid))
      .find((row) => row.skillName.toLowerCase() === name.toLowerCase()));
  } catch { /* audit is best-effort */ }
  try {
    const skillId = await ensureCatalogSkill(c.tid, name, category);
    const row = await insertResourceSkill({
      tenantId: c.tid, resourceGuid: guid, skillId, skillName: name,
      category: category ?? null,
      proficiency: asInt(req.body?.proficiency) ?? null,
      yearsExperience: asNumVal(req.body?.yearsExperience),
      lastUsedYear: asInt(req.body?.lastUsedYear) ?? null,
      isPrimary: !!req.body?.isPrimary,
    });
    if (before !== undefined) {
      setTrustedAuditChanges(res, trustedAuditDiff(before, rowObject(row), {
        fields: ["skillName", "category", "proficiency", "yearsExperience", "lastUsedYear", "isPrimary"],
      }));
    }
    res.json({ ok: true, id: row?.id ?? row, skillName: name, data: row });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.delete("/:guid/skills/:id", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const id = asInt(req.params.id);
  if (id === null) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  let before: Record<string, unknown> | null = null;
  try {
    before = rowObject((await getResourceSkillsByGuid(c.tid, req.params.guid)).find((row) => row.id === id));
  } catch { /* audit is best-effort */ }
  try {
    await deleteResourceSkill(c.tid, req.params.guid, id);
    if (before) {
      setTrustedAuditChanges(res, trustedAuditDiff(before, null, {
        fields: ["skillName", "category", "proficiency", "yearsExperience", "lastUsedYear", "isPrimary"],
      }));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// Certifications CRUD
// ----------------------------------------------------------------------------
router.post("/:guid/certifications", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const name = asStr(req.body?.name);
  if (!name) { res.status(400).json({ ok: false, message: "name required" }); return; }
  try {
    const row = await insertResourceCertification({
      tenantId: c.tid, resourceGuid: req.params.guid, name,
      issuer: asStr(req.body?.issuer) ?? null,
      credentialId: asStr(req.body?.credentialId) ?? null,
      issueDate: asDate(req.body?.issueDate) ?? null,
      expiryDate: asDate(req.body?.expiryDate) ?? null,
      attachmentPath: asStr(req.body?.attachmentPath) ?? null,
      isVerified: !!req.body?.isVerified,
    });
    setTrustedAuditChanges(res, createdChanges(row, [
      "name", "issuer", "credentialId", "issueDate", "expiryDate", "isVerified",
    ]));
    res.json({ ok: true, data: row });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.delete("/:guid/certifications/:id", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const id = asInt(req.params.id);
  if (id === null) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  let before: Record<string, unknown> | null = null;
  try {
    before = rowObject((await getResourceCertifications(c.tid, req.params.guid)).find((row) => row.id === id));
  } catch { /* audit is best-effort */ }
  try {
    await deleteResourceCertification(c.tid, req.params.guid, id);
    if (before) {
      setTrustedAuditChanges(res, trustedAuditDiff(before, null, {
        fields: ["name", "issuer", "credentialId", "issueDate", "expiryDate", "isVerified"],
      }));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// Education CRUD
// ----------------------------------------------------------------------------
router.post("/:guid/education", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const institution = asStr(req.body?.institution);
  if (!institution) { res.status(400).json({ ok: false, message: "institution required" }); return; }
  try {
    const row = await insertResourceEducation({
      tenantId: c.tid, resourceGuid: req.params.guid, institution,
      degree: asStr(req.body?.degree) ?? null,
      fieldOfStudy: asStr(req.body?.fieldOfStudy) ?? null,
      startYear: asInt(req.body?.startYear) ?? null,
      endYear: asInt(req.body?.endYear) ?? null,
      isCurrent: !!req.body?.isCurrent,
    });
    setTrustedAuditChanges(res, createdChanges(row, [
      "institution", "degree", "fieldOfStudy", "startYear", "endYear", "isCurrent",
    ]));
    res.json({ ok: true, data: row });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.delete("/:guid/education/:id", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const id = asInt(req.params.id);
  if (id === null) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  let before: Record<string, unknown> | null = null;
  try {
    before = rowObject((await getResourceEducation(c.tid, req.params.guid)).find((row) => row.id === id));
  } catch { /* audit is best-effort */ }
  try {
    await deleteResourceEducation(c.tid, req.params.guid, id);
    if (before) {
      setTrustedAuditChanges(res, trustedAuditDiff(before, null, {
        fields: ["institution", "degree", "fieldOfStudy", "startYear", "endYear", "isCurrent"],
      }));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// Work history CRUD
// ----------------------------------------------------------------------------
router.post("/:guid/work-history", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const company = asStr(req.body?.company);
  if (!company) { res.status(400).json({ ok: false, message: "company required" }); return; }
  try {
    const row = await insertResourceWorkHistory({
      tenantId: c.tid, resourceGuid: req.params.guid, company,
      title: asStr(req.body?.title) ?? null,
      location: asStr(req.body?.location) ?? null,
      startDate: asDate(req.body?.startDate) ?? null,
      endDate: asDate(req.body?.endDate) ?? null,
      isCurrent: !!req.body?.isCurrent,
      description: asStr(req.body?.description) ?? null,
    });
    setTrustedAuditChanges(res, createdChanges(row, [
      "company", "title", "location", "startDate", "endDate", "isCurrent", "description",
    ]));
    res.json({ ok: true, data: row });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.delete("/:guid/work-history/:id", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const id = asInt(req.params.id);
  if (id === null) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  let before: Record<string, unknown> | null = null;
  try {
    before = rowObject((await getResourceWorkHistory(c.tid, req.params.guid)).find((row) => row.id === id));
  } catch { /* audit is best-effort */ }
  try {
    await deleteResourceWorkHistory(c.tid, req.params.guid, id);
    if (before) {
      setTrustedAuditChanges(res, trustedAuditDiff(before, null, {
        fields: ["company", "title", "location", "startDate", "endDate", "isCurrent", "description"],
      }));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// Projects (portfolio) CRUD
// ----------------------------------------------------------------------------
router.post("/:guid/projects", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const name = asStr(req.body?.projectName ?? req.body?.name);
  if (!name) { res.status(400).json({ ok: false, message: "name required" }); return; }
  try {
    const row = await insertResourceProject({
      tenantId: c.tid, resourceGuid: req.params.guid, projectName: name,
      role: asStr(req.body?.role) ?? null,
      client: asStr(req.body?.client) ?? null,
      startDate: asDate(req.body?.startDate) ?? null,
      endDate: asDate(req.body?.endDate) ?? null,
      isCurrent: !!req.body?.isCurrent,
      description: asStr(req.body?.description) ?? null,
    });
    setTrustedAuditChanges(res, createdChanges(row, [
      "projectName", "role", "client", "startDate", "endDate", "isCurrent", "description",
    ]));
    res.json({ ok: true, data: row });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.delete("/:guid/projects/:id", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const id = asInt(req.params.id);
  if (id === null) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  let before: Record<string, unknown> | null = null;
  try {
    before = rowObject((await getResourceProjects(c.tid, req.params.guid)).find((row) => row.id === id));
  } catch { /* audit is best-effort */ }
  try {
    await deleteResourceProject(c.tid, req.params.guid, id);
    if (before) {
      setTrustedAuditChanges(res, trustedAuditDiff(before, null, {
        fields: ["projectName", "role", "client", "startDate", "endDate", "isCurrent", "description"],
      }));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// Resume file metadata CRUD (file bytes live in object storage; this stores the
// object path + metadata returned by the storage upload flow).
// ----------------------------------------------------------------------------
router.post("/:guid/resumes", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const objectPath = asStr(req.body?.objectPath);
  const fileName = asStr(req.body?.fileName);
  if (!objectPath || !fileName) { res.status(400).json({ ok: false, message: "objectPath and fileName required" }); return; }
  // Only accept normalized object paths minted by our own upload flow — never
  // arbitrary URLs or paths pointing outside the private object dir.
  if (!objectPath.startsWith("/objects/")) {
    res.status(400).json({ ok: false, message: "invalid objectPath" }); return;
  }
  const makePrimary = !!req.body?.isPrimary;
  try {
    if (makePrimary) {
      await clearPrimaryResumes(c.tid, req.params.guid);
    }
    const row = await insertResourceResume({
      tenantId: c.tid, resourceGuid: req.params.guid, objectPath, fileName,
      contentType: asStr(req.body?.contentType) ?? null,
      sizeBytes: asInt(req.body?.sizeBytes) ?? null,
      summary: asStr(req.body?.summary) ?? null,
      isPrimary: makePrimary,
    });
    setTrustedAuditChanges(res, createdChanges(row, ["fileName", "sizeBytes"]));
    res.json({ ok: true, data: row });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.delete("/:guid/resumes/:id", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const id = asInt(req.params.id);
  if (id === null) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  let before: Record<string, unknown> | null = null;
  try {
    before = rowObject((await getResourceResumes(c.tid, req.params.guid)).find((row) => row.id === id));
  } catch { /* audit is best-effort */ }
  try {
    await deleteResourceResume(c.tid, req.params.guid, id);
    if (before) {
      setTrustedAuditChanges(res, trustedAuditDiff(before, null, { fields: ["fileName", "sizeBytes"] }));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// Experience Tag Catalog (per-tenant taxonomy)
// ----------------------------------------------------------------------------
router.get("/experience-tag-catalog", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  try {
    const rows = await getExperienceTagCatalog(c.tid);
    res.json(rows);
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.post("/experience-tag-catalog", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  setAuditTarget(res, { entityType: "configuration", entityId: "experience-tag-catalog" });
  const name = asStr(req.body?.name);
  if (!name) { res.status(400).json({ ok: false, message: "name required" }); return; }
  const tid = c.tid;
  let beforeIds: Set<number> | null = null;
  try { beforeIds = new Set((await getExperienceTagCatalog(tid)).map((row) => row.id)); } catch { /* audit is best-effort */ }
  try {
    const id = await insertExperienceTagIfNotExists(tid, name);
    if (beforeIds) {
      try {
        const after = (await getExperienceTagCatalog(tid)).find((row) => row.id === id);
        setTrustedAuditChanges(res, after && !beforeIds.has(id) ? createdChanges(after, ["name", "category"]) : []);
      } catch { /* audit is best-effort */ }
    }
    res.json({ ok: true, id, name });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// User Experience Tags CRUD
// ----------------------------------------------------------------------------
router.get("/:guid/experience-tags", async (req, res) => {
  const c = await ctxAny(req, res); if (!c) return;
  const guid = req.params.guid.toLowerCase();
  try {
    const rows = await getUserExperienceTagsByGuid(c.tid, guid);
    res.json(rows);
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.post("/:guid/experience-tags", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const tagName = asStr(req.body?.tagName ?? req.body?.name);
  if (!tagName) { res.status(400).json({ ok: false, message: "tagName required" }); return; }
  let beforeIds: Set<number> | null = null;
  try {
    beforeIds = new Set((await getUserExperienceTagsByGuid(c.tid, req.params.guid)).map((row) => row.id));
  } catch { /* audit is best-effort */ }
  try {
    await insertExperienceTagIfNotExists(c.tid, tagName);
    await insertUserExperienceTag({ tenantId: c.tid, resourceGuid: req.params.guid, tagName });
    if (beforeIds) {
      try {
        const after = (await getUserExperienceTagsByGuid(c.tid, req.params.guid))
          .find((row) => !beforeIds!.has(row.id));
        setTrustedAuditChanges(res, after ? createdChanges(after, ["tagName"]) : []);
      } catch { /* audit is best-effort */ }
    }
    res.json({ ok: true, data: { tagName } });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.delete("/:guid/experience-tags/:id", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  await setStaffAuditTarget(res, c.tid, req.params.guid);
  const id = asInt(req.params.id);
  if (id === null) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  let before: Record<string, unknown> | null = null;
  try {
    before = rowObject((await getUserExperienceTagsByGuid(c.tid, req.params.guid)).find((row) => row.id === id));
  } catch { /* audit is best-effort */ }
  try {
    await deleteUserExperienceTag(c.tid, req.params.guid, id);
    if (before) setTrustedAuditChanges(res, trustedAuditDiff(before, null, { fields: ["tagName"] }));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// ----------------------------------------------------------------------------
// User Skills — GET / POST / DELETE for a single person
// ----------------------------------------------------------------------------
router.get("/:guid/skills", async (req, res) => {
  const c = await ctxAny(req, res); if (!c) return;
  const guid = req.params.guid.toLowerCase();
  try {
    const rows = await getResourceSkillsByGuid(c.tid, guid);
    res.json(rows);
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

export default router;
