// ─────────────────────────────────────────────────────────────────────────────
// Allocation integrity scan (DRY-RUN ONLY — never deletes anything)
//
// Nightly cross-tenant sweep for phantom-hours junk signatures that
// were manually swept on 2026-08-12 (37 rows / 4 tenants — backup at
// backups/ra-junk-sweep-2026-08-12.json). Every known write path is guarded
// now; this scan is the tripwire in case some future path recreates junk, so
// a superadmin hears about it the same night instead of a customer finding
// 96h phantom weeks on a timeline.
//
// Signatures (LOCKSTEP with .agents/memory/hours-integrity-model.md):
//   S1: assigned row with ISNULL(AllocationHour,0)=0 AND PctAllocation>150
//       (hours pasted into the % column / stale span-pct filler weeks)
//   S2: assigned row with AllocationHour > max(168, spanDays×24)
//       (physically impossible hours for the row's span)
//   S3: assigned row with 0<AllocationHour<=168 AND PctAllocation>168
//       (valid weekly hours paired with a stale whole-assignment total)
//
// "Assigned" = RA.ResourceUser set OR the linked ResourceWorkItems row has a
// live (non-deleted) user. TRUE open-demand rows — RA.ResourceUser null AND
// RWI absent/userless — are NEVER flagged: pct>100 there is legitimate
// multi-FTE demand, and their hour totals are demand totals, not weekly hours.
//
// Findings are surfaced (superadmin endpoint + log alert with tenant and row
// IDs). Nothing is auto-deleted; zero findings = silent.
// ─────────────────────────────────────────────────────────────────────────────
import { getPool } from "./db.js";
import { BACKGROUND_PROFILE, IS_DEPLOYED_SERVER } from "./deploy-env.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface JunkAllocationFinding {
  id: string;
  tenantId: string;
  ticketId: string;
  resourceUser: string | null;
  rwiLookup: string | null;
  start: string | null;
  end: string | null;
  pctAllocation: number;
  allocationHour: number;
  signature: AllocationJunkSignature;
}

export type AllocationJunkSignature = "S1" | "S2" | "S3";

/** Pure mirror of the SQL signatures below, kept for focused regression tests. */
export function classifyAllocationJunkValues(input: {
  assigned: boolean;
  allocationHour: number;
  pctAllocation: number;
  physicalCap: number;
  inclusiveSpanDays: number | null;
}): AllocationJunkSignature | null {
  if (!input.assigned) return null;
  if (input.allocationHour === 0 && input.pctAllocation > 150) return "S1";
  if (
    input.allocationHour > 0 &&
    input.allocationHour <= 168 &&
    input.pctAllocation > 168 &&
    input.inclusiveSpanDays !== null &&
    input.inclusiveSpanDays >= 1 &&
    input.inclusiveSpanDays <= 7
  ) return "S3";
  if (input.allocationHour > input.physicalCap) return "S2";
  return null;
}

export interface IntegrityScanResult {
  ok: boolean;
  ranAt: string;            // ISO timestamp
  totalFindings: number;    // full count (rows may be capped below)
  findings: JunkAllocationFinding[];
  byTenant: Record<string, number>;
  truncated: boolean;
  error?: string;
}

// Cap the row payload — the count is always exact via COUNT(*) OVER().
const MAX_ROWS = 1000;

/** Run the cross-tenant junk-allocation scan. DRY-RUN: read-only, one query.
 *  Thresholds mirror pipeline.ts MAX_SANE_ALLOC_PCT=150 / MAX_WEEK_HOURS=168
 *  (local literals — importing pipeline here would risk a dependency cycle,
 *  same reason rds-provider keeps its own copies). */
export async function runAllocationIntegrityScan(): Promise<IntegrityScanResult> {
  const ranAt = new Date().toISOString();
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      ;WITH base AS (
        SELECT
          ra.ID, ra.TenantID, ra.TicketId, ra.ResourceUser, ra.ResourceWorkItemLookup,
          ra.AllocationStartDate AS s, ra.AllocationEndDate AS e,
          ISNULL(ra.PctAllocation, 0)  AS pct,
          ISNULL(ra.AllocationHour, 0) AS hrs,
          -- assigned = RA user set OR linked live RWI row has a user.
          CASE WHEN NULLIF(LTRIM(RTRIM(CAST(ra.ResourceUser AS NVARCHAR(64)))), '') IS NOT NULL
                 OR (rwi.ID IS NOT NULL
                     AND NULLIF(LTRIM(RTRIM(CAST(rwi.ResourceUser AS NVARCHAR(64)))), '') IS NOT NULL)
               THEN 1 ELSE 0 END AS assigned,
          -- physical cap for the row's span: max(168, spanDays*24)
          CASE WHEN ra.AllocationStartDate IS NOT NULL AND ra.AllocationEndDate IS NOT NULL
                    AND (DATEDIFF(day, ra.AllocationStartDate, ra.AllocationEndDate) + 1) * 24 > 168
               THEN (DATEDIFF(day, ra.AllocationStartDate, ra.AllocationEndDate) + 1) * 24
               ELSE 168 END AS cap
        FROM core2.dbo.ResourceAllocation ra
        LEFT JOIN core2.dbo.ResourceWorkItems rwi
          ON rwi.ID = TRY_CAST(NULLIF(CAST(ra.ResourceWorkItemLookup AS NVARCHAR(50)), '') AS BIGINT)
         AND rwi.TenantID = ra.TenantID
         AND (rwi.Deleted = 0 OR rwi.Deleted IS NULL)
        WHERE (ra.Deleted = 0 OR ra.Deleted IS NULL)
      )
      SELECT TOP (${MAX_ROWS})
        CAST(ID AS NVARCHAR(50)) AS ID, TenantID, TicketId,
        CAST(ResourceUser AS NVARCHAR(64)) AS ResourceUser,
        CAST(ResourceWorkItemLookup AS NVARCHAR(50)) AS RwiLookup,
        CONVERT(varchar(10), s, 23) AS s, CONVERT(varchar(10), e, 23) AS e,
        pct, hrs,
        CASE
          WHEN hrs = 0 AND pct > 150 THEN 'S1'
          WHEN hrs > 0 AND hrs <= 168 AND pct > 168
            AND s IS NOT NULL AND e IS NOT NULL
            AND DATEDIFF(day, s, e) BETWEEN 0 AND 6 THEN 'S3'
          ELSE 'S2'
        END AS signature,
        COUNT(*) OVER () AS total
      FROM base
      WHERE assigned = 1
        AND ( (hrs = 0 AND pct > 150)                    -- S1
              OR hrs > cap                              -- S2
              OR (hrs > 0 AND hrs <= 168 AND pct > 168 -- S3
                  AND s IS NOT NULL AND e IS NOT NULL
                  AND DATEDIFF(day, s, e) BETWEEN 0 AND 6)
            )
      ORDER BY TenantID, TicketId, ID;

      -- Exact per-tenant counts, independent of the row cap above.
      ;WITH base AS (
        SELECT ra.TenantID,
          ra.AllocationStartDate AS s,
          ra.AllocationEndDate AS e,
          ISNULL(ra.PctAllocation, 0)  AS pct,
          ISNULL(ra.AllocationHour, 0) AS hrs,
          CASE WHEN NULLIF(LTRIM(RTRIM(CAST(ra.ResourceUser AS NVARCHAR(64)))), '') IS NOT NULL
                 OR (rwi.ID IS NOT NULL
                     AND NULLIF(LTRIM(RTRIM(CAST(rwi.ResourceUser AS NVARCHAR(64)))), '') IS NOT NULL)
               THEN 1 ELSE 0 END AS assigned,
          CASE WHEN ra.AllocationStartDate IS NOT NULL AND ra.AllocationEndDate IS NOT NULL
                    AND (DATEDIFF(day, ra.AllocationStartDate, ra.AllocationEndDate) + 1) * 24 > 168
               THEN (DATEDIFF(day, ra.AllocationStartDate, ra.AllocationEndDate) + 1) * 24
               ELSE 168 END AS cap
        FROM core2.dbo.ResourceAllocation ra
        LEFT JOIN core2.dbo.ResourceWorkItems rwi
          ON rwi.ID = TRY_CAST(NULLIF(CAST(ra.ResourceWorkItemLookup AS NVARCHAR(50)), '') AS BIGINT)
         AND rwi.TenantID = ra.TenantID
         AND (rwi.Deleted = 0 OR rwi.Deleted IS NULL)
        WHERE (ra.Deleted = 0 OR ra.Deleted IS NULL)
      )
      SELECT TenantID, COUNT(*) AS n FROM base
      WHERE assigned = 1 AND (
        (hrs = 0 AND pct > 150)
        OR hrs > cap
        OR (hrs > 0 AND hrs <= 168 AND pct > 168
            AND s IS NOT NULL AND e IS NOT NULL
            AND DATEDIFF(day, s, e) BETWEEN 0 AND 6)
      )
      GROUP BY TenantID`);
    const sets = (r.recordsets ?? []) as unknown as Record<string, unknown>[][];
    const rows = sets[0] ?? [];
    const tenantRows = sets[1] ?? [];
    const findings: JunkAllocationFinding[] = rows.map(row => ({
      id: String(row.ID ?? ""),
      tenantId: String(row.TenantID ?? ""),
      ticketId: String(row.TicketId ?? ""),
      resourceUser: row.ResourceUser == null ? null : String(row.ResourceUser),
      rwiLookup: row.RwiLookup == null ? null : String(row.RwiLookup),
      start: row.s == null ? null : String(row.s),
      end: row.e == null ? null : String(row.e),
      pctAllocation: Number(row.pct) || 0,
      allocationHour: Number(row.hrs) || 0,
      signature:
        String(row.signature) === "S1"
          ? "S1"
          : String(row.signature) === "S3"
            ? "S3"
            : "S2",
    }));
    const totalFindings = rows.length ? Number(rows[0].total) || findings.length : 0;
    // byTenant comes from the exact SQL aggregate — never from the capped rows,
    // so per-tenant totals stay honest even when findings exceed MAX_ROWS.
    const byTenant: Record<string, number> = {};
    for (const t of tenantRows) byTenant[String(t.TenantID ?? "")] = Number(t.n) || 0;
    return { ok: true, ranAt, totalFindings, findings, byTenant, truncated: totalFindings > findings.length };
  } catch (e) {
    return { ok: false, ranAt, totalFindings: 0, findings: [], byTenant: {}, truncated: false, error: String(e) };
  }
}

// Latest result, shared ACROSS cluster workers via a small state file. The
// nightly scan runs only on the lead worker while GET requests are
// round-robined across all workers, so an in-memory copy alone would make
// most GETs report "never ran". The file is tiny (capped findings) and the
// in-memory copy is just a fast path for the worker that ran the scan.
const LAST_SCAN_FILE = path.join(os.tmpdir(), "rmone-integrity-scan-last.json");
let _lastScan: IntegrityScanResult | null = null;

function persistLastScan(result: IntegrityScanResult): void {
  _lastScan = result;
  try {
    const tmp = `${LAST_SCAN_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(result));
    fs.renameSync(tmp, LAST_SCAN_FILE); // atomic swap — readers never see a partial file
  } catch (e) {
    console.warn("[integrity-scan] failed to persist last-scan state:", String(e));
  }
}

/** Most recent scan result from ANY worker (file wins when newer). */
export function getLastIntegrityScan(): IntegrityScanResult | null {
  try {
    const raw = fs.readFileSync(LAST_SCAN_FILE, "utf8");
    const fromFile = JSON.parse(raw) as IntegrityScanResult;
    if (!_lastScan || String(fromFile.ranAt) >= String(_lastScan.ranAt)) return fromFile;
  } catch { /* no file yet or unreadable — fall back to in-memory */ }
  return _lastScan;
}

/** Run the scan and log an alert IF (and only if) it finds junk. Zero
 *  findings = silent (a single debug-level line is fine, no alert). */
export async function runAndReportIntegrityScan(trigger: string): Promise<IntegrityScanResult> {
  const result = await runAllocationIntegrityScan();
  persistLastScan(result);
  if (!result.ok) {
    // Scan FAILURE is loud too — a silently-dead tripwire is no tripwire.
    console.warn(`[integrity-scan] (${trigger}) scan FAILED: ${result.error}`);
    return result;
  }
  if (result.totalFindings > 0) {
    console.warn(
      `[integrity-scan] ALERT (${trigger}): ${result.totalFindings} junk allocation row(s) across ` +
      `${Object.keys(result.byTenant).length} tenant(s) — NOT auto-deleted, review via /api/superadmin/integrity-scan`);
    for (const [tid, n] of Object.entries(result.byTenant)) {
      // n is the EXACT per-tenant count (SQL aggregate); the ID list may be a
      // subset when findings exceed the row cap — say so explicitly.
      const ids = result.findings.filter(f => f.tenantId === tid).map(f => `${f.signature}:${f.id}`);
      const shown = ids.slice(0, 50);
      const suffix = n > shown.length ? `, … (${n - shown.length} more not listed)` : "";
      console.warn(`[integrity-scan]   tenant ${tid}: ${n} row(s) → ${shown.join(", ")}${suffix}`);
    }
    if (result.truncated) {
      console.warn(`[integrity-scan]   NOTE: row payload capped at ${result.findings.length} of ${result.totalFindings} findings — counts are exact, ID lists are partial`);
    }
  }
  return result;
}

// ── Nightly schedule (lead worker only — started from index.ts) ─────────────
// Runs at ~02:30 UTC every night. Production/deployment only unless
// INTEGRITY_SCAN_IN_DEV=1 (same dev-gating idea as boot cache warming: the
// dev workspace shares the live DB and must not add scheduled load).
const SCAN_HOUR_UTC = 2;
const SCAN_MINUTE_UTC = 30;

export function startAllocationIntegrityScan(): void {
  if (!IS_DEPLOYED_SERVER && process.env["INTEGRITY_SCAN_IN_DEV"] !== "1") return;
  if (BACKGROUND_PROFILE === "off") return;
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SCAN_HOUR_UTC, SCAN_MINUTE_UTC, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  const firstDelay = next.getTime() - now.getTime();
  setTimeout(() => {
    void runAndReportIntegrityScan("nightly").catch(e => console.warn("[integrity-scan] nightly run threw:", String(e)));
    setInterval(() => {
      void runAndReportIntegrityScan("nightly").catch(e => console.warn("[integrity-scan] nightly run threw:", String(e)));
    }, 24 * 60 * 60_000).unref();
  }, firstDelay).unref();
  console.log(`[integrity-scan] nightly junk-allocation scan scheduled (first run ${next.toISOString()})`);
}
