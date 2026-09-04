/* ─────────────────────────────────────────────────────────────────────────
 * Actuals vs Forecast — API routes.
 *
 *   GET  /overview                    latest snapshot per project (Executive)
 *   GET  /project/:ticket             full stored series + detail + milestones
 *   POST /rebuild                     recompute snapshots (admin; backfill)
 *   POST /imports                     begin an actuals import batch
 *   POST /imports/:id/rows            upsert parsed rows (client-side XLSX)
 *   POST /imports/:id/commit          finish batch + restate affected weeks
 *   GET  /imports                     batch history
 *   GET  /imports/:id/exceptions      quarantined rows
 *   GET  /integrity                   admin-only snapshot history integrity report
 *
 * Read gate copies /api/analytics/financial verbatim: RDS session required
 * (bearer-only upstream sessions get an honest available:false), custom
 * access levels need editFinancials, caps-read failure fails CLOSED (503).
 * Writes additionally require an admin-ish level (or manageSettings) and the
 * global read-only guard. No server response caching here — snapshots are
 * already the stored truth.
 * ──────────────────────────────────────────────────────────────────────── */
import { Router, type IRouter, type Request, type Response } from "express";
import { resolveRequestSource } from "../lib/rds-auth.js";
import { getCapsForAcl } from "../lib/access-control.js";
import { blockIfReadOnly } from "./rmone-proxy.js";
import { normalizeTicketId } from "../lib/pipeline.js";
import { loadEffectiveDefaults } from "../lib/onboarding-settings-store.js";
import { getSchedulePhaseMilestonesRds, ticketsExistRds } from "../lib/rds-provider.js";
import { mondayUtc } from "../lib/financial-analytics.js";
import { currentWeekMsUtcMinus12, isoDayUtc } from "../lib/actuals-forecast.js";
import {
  abortImportBatch,
  bumpImportBatchCounters,
  createImportBatch,
  insertImportExceptions,
  listImportBatches,
  listImportExceptions,
  readDetailRows,
  readOverviewSnapshots,
  readSnapshotWeeks,
  updateImportBatch,
  upsertActualHours,
  type ActualUpsertRow,
  type ImportExceptionRow,
  isAfBuildInProgress,
} from "../lib/actuals-forecast-store.js";
import { runAfSnapshotsForTenant, startAfSnapshotsForTenant } from "../lib/actuals-forecast-job.js";
import {
  DEFAULT_AF_INTEGRITY_EPSILON,
  scanAfSnapshotIntegrity,
} from "../lib/actuals-forecast-integrity.js";
import { getMssqlPool, mssql, getUsersByTenant } from "@workspace/db";

const router: IRouter = Router();

/* ── gates ────────────────────────────────────────────────────────────── */

interface GateResult {
  src: { tenant: string; tid: string; username: string; accessLevel: string };
  caps: { editFinancials?: boolean; manageSettings?: boolean } | null;
}

/** Same contract as /api/analytics/financial. Returns null after writing the
 * response when the request may not read financial forecasts. */
async function gateFinancialRead(req: Request, res: Response): Promise<GateResult | null> {
  const src = resolveRequestSource(req);
  if (!src) {
    const hdr = req.headers["authorization"];
    const raw = Array.isArray(hdr) ? hdr[0] : hdr;
    if (raw && String(raw).trim()) {
      res.json({
        available: false,
        reason:
          "Actuals vs Forecast needs the AWS-hosted data source. This company's data source doesn't support it yet.",
      });
      return null;
    }
    res.status(401).json({ error: "not_signed_in" });
    return null;
  }
  try {
    const caps = await getCapsForAcl(src.accessLevel, src.tenant);
    if (caps && !caps.editFinancials) {
      res.status(403).json({
        error: "financial_restricted",
        error_description: "Your access level doesn't include financial data.",
      });
      return null;
    }
    return { src, caps };
  } catch (e) {
    // Fail closed — never serve tenant-wide rates when the policy can't be read.
    console.warn(`[actuals-forecast] caps unavailable for ${src.username}@${src.tenant}: ${String(e).slice(0, 120)}`);
    res.status(503).json({ error: "policy_unavailable" });
    return null;
  }
}

/** Writes: financial read + admin-ish level (custom levels need
 * manageSettings) + the global read-only guard. */
async function gateWrite(req: Request, res: Response): Promise<GateResult | null> {
  const gate = await gateFinancialRead(req, res);
  if (!gate) return null;
  const acl = String(gate.src.accessLevel || "unset").toLowerCase();
  const adminish = ["admin", "administrator", "unset"].includes(acl) || gate.caps?.manageSettings === true;
  if (!adminish) {
    res.status(403).json({
      error: "admin_required",
      error_description: "Importing actuals or rebuilding snapshots needs an admin access level.",
    });
    return null;
  }
  if (await blockIfReadOnly(req, res)) return null;
  return gate;
}

/** Admin-only read gate for operational reports. Unlike gateWrite, this never
 * invokes the global read-only guard because the report cannot mutate data. */
async function gateAdminRead(req: Request, res: Response): Promise<GateResult | null> {
  const gate = await gateFinancialRead(req, res);
  if (!gate) return null;
  const acl = String(gate.src.accessLevel || "unset").toLowerCase();
  const adminish = ["admin", "administrator", "unset"].includes(acl) || gate.caps?.manageSettings === true;
  if (!adminish) {
    res.status(403).json({
      error: "admin_required",
      error_description: "Reviewing forecast history integrity needs an admin access level.",
    });
    return null;
  }
  return gate;
}

/* ── row shapers (snake_case storage → camelCase API) ─────────────────── */

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

function mapWeekRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    weekMonday: String(r.weekMonday ?? ""),
    actualHoursTd: num(r.actual_hours_td),
    forecastRemainingHours: num(r.forecast_remaining_hours),
    forecastTotalHours: num(r.forecast_total_hours),
    forecastHoursTd: num(r.forecast_hours_td),
    actualCostTd: num(r.actual_cost_td),
    forecastRemainingCost: num(r.forecast_remaining_cost),
    forecastTotalCost: num(r.forecast_total_cost),
    forecastCostTd: num(r.forecast_cost_td),
    actualBillTd: num(r.actual_bill_td),
    forecastRemainingBill: num(r.forecast_remaining_bill),
    forecastTotalBill: num(r.forecast_total_bill),
    forecastBillTd: num(r.forecast_bill_td),
    hoursVariance: num(r.hours_variance),
    costVariance: num(r.cost_variance),
    billVariance: num(r.bill_variance),
    substitutedHours: num(r.substituted_hours),
    unratedActualHours: num(r.unrated_actual_hours),
    actualsCovered: !!Number(r.actuals_covered ?? 0),
    final: !!Number(r.final_ ?? 0),
    backfilled: !!Number(r.backfilled ?? 0),
    computedAt: r.computed_at instanceof Date ? r.computed_at.toISOString() : null,
  };
}

function mapDetailRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    weekMonday: String(r.weekMonday ?? ""),
    person: String(r.resource_guid ?? ""),
    personName: String(r.resource_name ?? ""),
    // readDetailRows resolves these against the CURRENT canonical user in this
    // tenant, so a persisted historical GUID reflects a later activation change.
    enabled: typeof r.enabled === "boolean" ? r.enabled : null,
    tenantId: String(r.tenant_id ?? ""),
    roleName: String(r.role_name ?? ""),
    division: String(r.division ?? ""),
    actualHours: num(r.actual_hours),
    actualCost: num(r.actual_cost),
    actualBill: num(r.actual_bill),
    forecastHours: num(r.forecast_hours),
    forecastCost: num(r.forecast_cost),
    forecastBill: num(r.forecast_bill),
    remainingHours: num(r.remaining_hours),
    remainingCost: num(r.remaining_cost),
    remainingBill: num(r.remaining_bill),
    substituted: !!Number(r.substituted ?? 0),
    rateApproximated: !!Number(r.rate_approximated ?? 0),
    missingDivision: !!Number(r.missing_division ?? 0),
    actualsCovered: !!Number(r.actuals_covered ?? 0),
  };
}

async function loadAfFlags(tenantLabel: string): Promise<{ useImportedActuals: boolean; usePlannedAsActualFallback: boolean }> {
  const d = await loadEffectiveDefaults(tenantLabel).catch(() => null);
  return {
    useImportedActuals: d?.useImportedActuals !== false,
    usePlannedAsActualFallback: d?.usePlannedAsActualFallback === true,
  };
}

/* ── reads ────────────────────────────────────────────────────────────── */

router.get("/integrity", async (req: Request, res: Response): Promise<void> => {
  const gate = await gateAdminRead(req, res);
  if (!gate) return;

  const rawEpsilon = typeof req.query.epsilon === "string" ? req.query.epsilon.trim() : "";
  const epsilon = rawEpsilon ? Number(rawEpsilon) : DEFAULT_AF_INTEGRITY_EPSILON;
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    res.status(400).json({
      error: "bad_epsilon",
      error_description: "epsilon must be a finite non-negative number.",
    });
    return;
  }

  try {
    const scan = await scanAfSnapshotIntegrity(gate.src.tid, epsilon);
    res.json({
      ok: true,
      report: "actuals_forecast_snapshot_integrity",
      tenantId: gate.src.tid,
      ...scan,
      readOnly: true,
      repairAvailable: false,
      message: scan.summary,
    });
  } catch (e) {
    console.error(`[actuals-forecast/integrity] ${String(e).slice(0, 300)}`);
    res.status(503).json({
      error: "integrity_scan_failed",
      error_description:
        "Forecast history integrity could not be checked. No result is available and no data was changed.",
    });
  }
});

router.get("/overview", async (req: Request, res: Response) => {
  try {
    const gate = await gateFinancialRead(req, res);
    if (!gate) return;
    const [rows, flags, building] = await Promise.all([
      readOverviewSnapshots(gate.src.tid),
      loadAfFlags(gate.src.tenant),
      isAfBuildInProgress(gate.src.tid).catch(() => false),
    ]);
    res.json({
      available: true,
      currentWeek: isoDayUtc(currentWeekMsUtcMinus12()),
      flags,
      building,
      projects: rows.map((r) => ({ ticket: String(r.ticket_id ?? ""), ...mapWeekRow(r) })),
    });
  } catch (e) {
    console.error(`[actuals-forecast/overview] ${String(e).slice(0, 300)}`);
    res.status(500).json({ error: "overview_failed" });
  }
});

router.get("/project/:ticket", async (req: Request, res: Response) => {
  try {
    const gate = await gateFinancialRead(req, res);
    if (!gate) return;
    const ticket = String(req.params.ticket ?? "").trim();
    if (!ticket) {
      res.status(400).json({ error: "bad_ticket" });
      return;
    }
    const { tid, tenant } = gate.src;
    const [weeks, detail, milestones, flags] = await Promise.all([
      readSnapshotWeeks(tid, ticket),
      readDetailRows(tid, ticket),
      getSchedulePhaseMilestonesRds(tid, ticket),
      loadAfFlags(tenant),
    ]);
    res.json({
      available: true,
      ticket,
      currentWeek: isoDayUtc(currentWeekMsUtcMinus12()),
      flags,
      weeks: weeks.map(mapWeekRow),
      detail: detail.map(mapDetailRow),
      milestones,
    });
  } catch (e) {
    console.error(`[actuals-forecast/project] ${String(e).slice(0, 300)}`);
    res.status(500).json({ error: "project_failed" });
  }
});

/* ── rebuild (admin) ──────────────────────────────────────────────────── */

router.post("/rebuild", async (req: Request, res: Response) => {
  try {
    const gate = await gateWrite(req, res);
    if (!gate) return;
    const body = (req.body ?? {}) as { ticket?: string; fromWeek?: string; fullHistory?: boolean };
    const ticket = String(body.ticket ?? "").trim();
    let fromWeekMs: number | undefined;
    if (body.fromWeek) {
      const t = Date.parse(String(body.fromWeek));
      if (!Number.isFinite(t)) {
        res.status(400).json({ error: "bad_from_week" });
        return;
      }
      fromWeekMs = mondayUtc(t);
    }
    const opts = {
      tickets: ticket ? [ticket] : undefined,
      backfill: true,
      fromWeekMs,
      fullHistory: body.fullHistory === true,
    };
    if (ticket) {
      // Single-project rebuilds are quick — stay synchronous.
      const stats = await runAfSnapshotsForTenant(gate.src.tid, gate.src.tenant, opts);
      res.json({ ok: true, ...stats });
      return;
    }
    // Full-tenant rebuilds can take minutes on large tenants. Never hold the
    // HTTP request open for that — the proxy would time out while the build
    // kept running, which read as a failure. Acquire the tenant lock with
    // ZERO wait BEFORE answering: a 202 means the lock is already held (so
    // the overview's `building` flag is true from that instant), and a
    // concurrent click loses atomically with a fast 409 — no probe/start
    // race, no 60s queued loser tying up a DB connection.
    const start = await startAfSnapshotsForTenant(gate.src.tid, gate.src.tenant, opts, 0);
    if (!start.started) {
      res.status(409).json({ error: "rebuild_in_progress" });
      return;
    }
    const t0 = Date.now();
    start.done
      .then((s) => console.log(
        `[actuals-forecast/rebuild] done tenant=${s.tenant} tickets=${s.tickets} weeks=${s.weeksWritten + s.weeksRestated} in ${Math.round((Date.now() - t0) / 1000)}s`,
      ))
      .catch((e) => console.error(`[actuals-forecast/rebuild] background run failed: ${String(e).slice(0, 300)}`));
    res.status(202).json({ ok: true, started: true });
  } catch (e) {
    console.error(`[actuals-forecast/rebuild] ${String(e).slice(0, 300)}`);
    res.status(500).json({ error: "rebuild_failed", detail: String(e).slice(0, 200) });
  }
});

/* ── actuals import ───────────────────────────────────────────────────── */

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normName = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

router.post("/imports", async (req: Request, res: Response) => {
  try {
    const gate = await gateWrite(req, res);
    if (!gate) return;
    const filename = String((req.body ?? {}).filename ?? "actuals.xlsx").trim() || "actuals.xlsx";
    const batchId = await createImportBatch(gate.src.tid, filename, gate.src.username);
    res.json({ ok: true, batchId });
  } catch (e) {
    console.error(`[actuals-forecast/imports] ${String(e).slice(0, 300)}`);
    res.status(500).json({ error: "batch_create_failed" });
  }
});

interface ImportRowIn {
  employee?: unknown; ticket?: unknown; week?: unknown; hours?: unknown;
  role?: unknown; division?: unknown;
}

router.post("/imports/:id/rows", async (req: Request, res: Response) => {
  try {
    const gate = await gateWrite(req, res);
    if (!gate) return;
    const { tid } = gate.src;
    const batchId = Number(req.params.id);
    if (!Number.isFinite(batchId) || batchId <= 0) {
      res.status(400).json({ error: "bad_batch" });
      return;
    }
    // Batch lifecycle: rows may only land on an existing OPEN batch — never
    // on a committed one (its numbers are published) or a made-up id.
    const batchPool = await getMssqlPool();
    const bstate = await batchPool.request()
      .input("tid", mssql.NVarChar, tid)
      .input("b", mssql.BigInt, batchId)
      .query(`SELECT status FROM dbo.rmone_actual_import_batches WHERE tenant_id = @tid AND id = @b`);
    if (!bstate.recordset?.length) {
      res.status(404).json({ error: "batch_not_found" });
      return;
    }
    if (String(bstate.recordset[0].status ?? "") !== "open") {
      res.status(409).json({
        error: "batch_closed",
        error_description: "This import batch is no longer accepting rows — start a new import.",
      });
      return;
    }
    const rowsIn = (req.body ?? {}).rows as ImportRowIn[] | undefined;
    if (!Array.isArray(rowsIn) || !rowsIn.length) {
      res.status(400).json({ error: "no_rows" });
      return;
    }
    if (rowsIn.length > 5000) {
      res.status(400).json({ error: "chunk_too_large", error_description: "Send at most 5000 rows per request." });
      return;
    }

    // People: match GUID → email → username → unique normalized name.
    // GUID-looking strings ONLY match by id (never as a name). Deleted users
    // never match; disabled users still do (their past hours are real).
    const users = (await getUsersByTenant(tid)).filter((u) => !u.deleted);
    const byId = new Map<string, { id: string; name: string }>();
    const byEmail = new Map<string, { id: string; name: string }>();
    const byUsername = new Map<string, { id: string; name: string }>();
    const byName = new Map<string, { id: string; name: string } | "ambiguous">();
    for (const u of users) {
      const id = String(u.id ?? "").trim().toLowerCase();
      if (!id) continue;
      const entry = { id, name: String(u.name || u.username || "").trim() };
      byId.set(id, entry);
      const email = String(u.email ?? "").trim().toLowerCase();
      if (email) byEmail.set(email, entry);
      const username = String(u.username ?? "").trim().toLowerCase();
      if (username) byUsername.set(username, entry);
      const nn = normName(String(u.name ?? ""));
      if (nn) byName.set(nn, byName.has(nn) ? "ambiguous" : entry);
    }

    // Tickets: existence against live PMM + Opportunity, tolerant of
    // normalization differences (try the raw trimmed AND normalized forms,
    // store the DB's verbatim id). Unknown project = exception, NEVER a new
    // record (ghost-guard rule).
    const rawTickets = new Set<string>();
    for (const r of rowsIn) {
      const t = String(r.ticket ?? "").trim();
      if (t) {
        rawTickets.add(t);
        const n = normalizeTicketId(t);
        if (n) rawTickets.add(n);
      }
    }
    const existing = await ticketsExistRds(tid, [...rawTickets]);
    const verbatim = new Map<string, string>(); // normalized → DB id
    for (const t of existing) verbatim.set(normalizeTicketId(t) || t, t);

    const ok: ActualUpsertRow[] = [];
    const exceptions: ImportExceptionRow[] = [];
    for (const r of rowsIn) {
      const employee = String(r.employee ?? "").trim();
      const ticketRaw = String(r.ticket ?? "").trim();
      const weekRaw = String(r.week ?? "").trim();
      const roleName = String(r.role ?? "").trim();
      const division = String(r.division ?? "").trim();
      const hoursNum = Number(r.hours);
      const rowJson = { employee, ticket: ticketRaw, week: weekRaw, hours: r.hours, role: roleName, division };

      if (!employee || !ticketRaw || !weekRaw) {
        exceptions.push({ reason: "missing_fields", detail: "Employee, Project ID and Week are required.", rowJson });
        continue;
      }
      // person
      let person: { id: string; name: string } | undefined;
      const empLower = employee.toLowerCase();
      if (GUID_RE.test(employee)) {
        person = byId.get(empLower);
        if (!person) {
          exceptions.push({ reason: "unknown_person", detail: `No user with id ${employee}.`, rowJson });
          continue;
        }
      } else {
        person = byEmail.get(empLower) ?? byUsername.get(empLower);
        if (!person) {
          const hit = byName.get(normName(employee));
          if (hit === "ambiguous") {
            exceptions.push({ reason: "ambiguous_person", detail: `More than one user is named “${employee}” — use their email or id.`, rowJson });
            continue;
          }
          person = hit ?? undefined;
        }
        if (!person) {
          exceptions.push({ reason: "unknown_person", detail: `No user matches “${employee}” (tried email, username, full name). Users are never auto-created by this import.`, rowJson });
          continue;
        }
      }
      // ticket
      const ticket =
        (existing.has(ticketRaw) ? ticketRaw : undefined) ??
        verbatim.get(normalizeTicketId(ticketRaw) || ticketRaw);
      if (!ticket) {
        exceptions.push({ reason: "unknown_project", detail: `No project or opportunity with ID “${ticketRaw}”.`, rowJson });
        continue;
      }
      // week — accept ISO or parseable date; snap to that week's UTC Monday.
      const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(weekRaw) ? weekRaw + "T00:00:00Z" : weekRaw);
      if (!Number.isFinite(parsed)) {
        exceptions.push({ reason: "bad_week", detail: `“${weekRaw}” is not a date.`, rowJson });
        continue;
      }
      const weekIso = isoDayUtc(mondayUtc(parsed));
      // hours — 0 allowed (an explicit zero is a real statement); >168 impossible.
      if (!Number.isFinite(hoursNum) || hoursNum < 0) {
        exceptions.push({ reason: "bad_hours", detail: `“${String(r.hours)}” is not a valid hours value.`, rowJson });
        continue;
      }
      if (hoursNum > 168) {
        exceptions.push({ reason: "excessive_hours", detail: `${hoursNum} hours in one week is impossible (max 168).`, rowJson });
        continue;
      }
      ok.push({
        ticket,
        person: person.id,
        personName: person.name,
        weekIso,
        hours: hoursNum,
        roleName,
        division,
      });
    }

    const stored = await upsertActualHours(tid, ok, batchId);
    if (exceptions.length) await insertImportExceptions(tid, batchId, exceptions);
    await bumpImportBatchCounters(tid, batchId, ok.length, exceptions.length);
    // accepted = input rows that passed validation; stored = weekly key rows
    // left after daily/task-level rows collapsed into per-week totals.
    res.json({ ok: true, accepted: ok.length, stored, exceptions: exceptions.length });
  } catch (e) {
    console.error(`[actuals-forecast/rows] ${String(e).slice(0, 300)}`);
    res.status(500).json({ error: "rows_failed", detail: String(e).slice(0, 200) });
  }
});

router.post("/imports/:id/commit", async (req: Request, res: Response) => {
  try {
    const gate = await gateWrite(req, res);
    if (!gate) return;
    const { tid, tenant } = gate.src;
    const batchId = Number(req.params.id);
    if (!Number.isFinite(batchId) || batchId <= 0) {
      res.status(400).json({ error: "bad_batch" });
      return;
    }
    const body = (req.body ?? {}) as { rowsTotal?: number };
    // rowsTotal is REQUIRED — without it the chunk accounting below can't
    // prove the upload arrived whole, and a partial file could publish.
    const expected = Number(body.rowsTotal);
    if (!Number.isInteger(expected) || expected < 0) {
      res.status(400).json({ error: "rows_total_required", error_description: "Send rowsTotal: the number of data rows in the uploaded file." });
      return;
    }

    const pool = await getMssqlPool();
    // State machine: open → completing → completed. The flip rejects commits
    // on unknown/aborted/already-completed batches, and closes the door on
    // late /rows chunks (they require status='open'). 'completing' stays
    // retryable so a crashed commit can be re-run.
    const flip = await pool.request()
      .input("tid", mssql.NVarChar, tid)
      .input("b", mssql.BigInt, batchId)
      .query(
        `UPDATE dbo.rmone_actual_import_batches SET status = 'completing'
         WHERE tenant_id = @tid AND id = @b AND status IN ('open', 'completing');
         SELECT @@ROWCOUNT AS flipped;`,
      );
    if (!Number(flip.recordset?.[0]?.flipped ?? 0)) {
      const probe = await pool.request()
        .input("tid", mssql.NVarChar, tid)
        .input("b", mssql.BigInt, batchId)
        .query(`SELECT status FROM dbo.rmone_actual_import_batches WHERE tenant_id = @tid AND id = @b`);
      if (!probe.recordset?.length) res.status(404).json({ error: "batch_not_found" });
      else res.status(409).json({ error: "batch_closed", error_description: `This batch is ${String(probe.recordset[0].status)} — it can't be committed again.` });
      return;
    }
    // Chunk accounting: every /rows call bumps rows_ok/rows_exception. If the
    // client's expected total doesn't match, a chunk failed or never arrived —
    // refuse to commit rather than silently publish a partial file.
    const bc = await pool.request()
      .input("tid", mssql.NVarChar, tid)
      .input("b", mssql.BigInt, batchId)
      .query(
        `SELECT rows_ok, rows_exception FROM dbo.rmone_actual_import_batches
         WHERE tenant_id = @tid AND id = @b`,
      );
    const okCount = Number(bc.recordset?.[0]?.rows_ok ?? 0);
    const excCount = Number(bc.recordset?.[0]?.rows_exception ?? 0);
    if (expected !== okCount + excCount) {
      res.status(409).json({
        error: "rows_incomplete",
        error_description:
          `This upload accounted for ${okCount + excCount} of ${expected} rows — ` +
          `a chunk failed or was never sent. Re-upload the file as a new import.`,
        accepted: okCount,
        exceptions: excCount,
      });
      return;
    }

    // What did this batch actually touch? (Server-derived — chunk requests
    // are stateless.) Affected tickets restate from the earliest imported week.
    const r = await pool.request()
      .input("tid", mssql.NVarChar, tid)
      .input("b", mssql.BigInt, batchId)
      .query(
        `SELECT ticket_id, MIN(week_monday) AS minWeek
         FROM dbo.rmone_actual_hours
         WHERE tenant_id = @tid AND source_batch = @b
         GROUP BY ticket_id`,
      );
    const tickets: string[] = [];
    let minWeekMs: number | undefined;
    for (const row of r.recordset ?? []) {
      const t = String(row.ticket_id ?? "").trim();
      if (t) tickets.push(t);
      const w = row.minWeek instanceof Date ? row.minWeek.getTime() : Date.parse(String(row.minWeek ?? ""));
      if (Number.isFinite(w)) minWeekMs = minWeekMs === undefined ? w : Math.min(minWeekMs, w);
    }

    const excs = await listImportExceptions(tid, batchId, 1);
    let stats = null;
    if (tickets.length) {
      stats = await runAfSnapshotsForTenant(tid, tenant, {
        tickets,
        backfill: true,
        fromWeekMs: minWeekMs !== undefined ? mondayUtc(minWeekMs) : undefined,
      });
    }
    await updateImportBatch(tid, batchId, {
      rowsTotal: Number.isFinite(Number(body.rowsTotal)) ? Number(body.rowsTotal) : undefined,
      status: excs.length ? "completed_with_exceptions" : "completed",
      completed: true,
    });
    res.json({ ok: true, tickets: tickets.length, snapshot: stats });
  } catch (e) {
    console.error(`[actuals-forecast/commit] ${String(e).slice(0, 300)}`);
    res.status(500).json({ error: "commit_failed", detail: String(e).slice(0, 200) });
  }
});

/** Abort a failed upload: wipe the batch's rows + exceptions so nothing
 * half-uploaded lingers for a later rebuild to silently pick up. */
router.post("/imports/:id/abort", async (req: Request, res: Response) => {
  try {
    const gate = await gateWrite(req, res);
    if (!gate) return;
    const { tid } = gate.src;
    const batchId = Number(req.params.id);
    if (!Number.isFinite(batchId) || batchId <= 0) {
      res.status(400).json({ error: "bad_batch" });
      return;
    }
    const pool = await getMssqlPool();
    const bc = await pool.request()
      .input("tid", mssql.NVarChar, tid)
      .input("b", mssql.BigInt, batchId)
      .query(`SELECT status FROM dbo.rmone_actual_import_batches WHERE tenant_id = @tid AND id = @b`);
    if (!bc.recordset?.length) {
      res.status(404).json({ error: "batch_not_found" });
      return;
    }
    const status = String(bc.recordset[0].status ?? "");
    if (status === "aborted") {
      res.json({ ok: true, removedHours: 0, removedExceptions: 0 });
      return;
    }
    if (status.startsWith("completed")) {
      res.status(409).json({
        error: "batch_completed",
        error_description: "This import already finished — its numbers are published. Upload a correcting file instead.",
      });
      return;
    }
    const out = await abortImportBatch(tid, batchId);
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error(`[actuals-forecast/abort] ${String(e).slice(0, 300)}`);
    res.status(500).json({ error: "abort_failed", detail: String(e).slice(0, 200) });
  }
});

router.get("/imports", async (req: Request, res: Response) => {
  try {
    const gate = await gateFinancialRead(req, res);
    if (!gate) return;
    const batches = await listImportBatches(gate.src.tid);
    res.json({
      ok: true,
      batches: batches.map((b) => ({
        id: Number(b.id),
        filename: String(b.filename ?? ""),
        uploadedBy: String(b.uploaded_by ?? ""),
        rowsTotal: b.rows_total == null ? null : Number(b.rows_total),
        rowsOk: b.rows_ok == null ? null : Number(b.rows_ok),
        rowsException: b.rows_exception == null ? null : Number(b.rows_exception),
        status: String(b.status ?? ""),
        createdAt: b.created_at instanceof Date ? b.created_at.toISOString() : null,
        completedAt: b.completed_at instanceof Date ? b.completed_at.toISOString() : null,
      })),
    });
  } catch (e) {
    console.error(`[actuals-forecast/imports:list] ${String(e).slice(0, 300)}`);
    res.status(500).json({ error: "list_failed" });
  }
});

router.get("/imports/:id/exceptions", async (req: Request, res: Response) => {
  try {
    const gate = await gateFinancialRead(req, res);
    if (!gate) return;
    const batchId = Number(req.params.id);
    if (!Number.isFinite(batchId) || batchId <= 0) {
      res.status(400).json({ error: "bad_batch" });
      return;
    }
    const rows = await listImportExceptions(gate.src.tid, batchId);
    res.json({
      ok: true,
      exceptions: rows.map((x) => ({
        id: Number(x.id),
        reason: String(x.reason ?? ""),
        detail: String(x.detail ?? ""),
        row: ((): unknown => {
          try { return x.row_json ? JSON.parse(String(x.row_json)) : null; } catch { return null; }
        })(),
        createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : null,
      })),
    });
  } catch (e) {
    console.error(`[actuals-forecast/exceptions] ${String(e).slice(0, 300)}`);
    res.status(500).json({ error: "exceptions_failed" });
  }
});

export default router;
