/* ─────────────────────────────────────────────────────────────────────────
 * Actuals vs Forecast — app-DB storage (SQL Server rmoneapp via
 * @workspace/db; NO Postgres anywhere, per the user-store rules).
 *
 * Tables (created in lib/db bootstrap):
 *   rmone_actual_hours            imported actual worked hours (upsert key:
 *                                 tenant, ticket, person, week, role)
 *   rmone_af_snapshots            project×week rollup — THE stored numbers
 *                                 every surface reads. [final]=1 rows have
 *                                 FROZEN forecast columns; only their actual
 *                                 side may be restated by late imports.
 *   rmone_af_snapshot_detail      per person/role/division evidence (fully
 *                                 recomputable; powers filters + report)
 *   rmone_actual_import_batches   import history
 *   rmone_actual_import_exceptions quarantined rows (never silently dropped)
 *
 * tenant_id in ALL these tables = the tenant GUID (src.tid / core2 TenantID),
 * NEVER the friendly login label — routes always have the GUID, and the
 * usage-telemetry label/GUID bridge pain taught us not to mix them.
 * ──────────────────────────────────────────────────────────────────────── */
import { getMssqlPool, getUsersByTenant, mssql } from "@workspace/db";
import {
  type AfActualRow,
  type AfDetailCell,
  type AfWeekPoint,
  aggregateActualKeyRows,
  currentWeekMsUtcMinus12,
  isoDayUtc,
} from "./actuals-forecast.js";
import { assertAfSnapshotIntegrity } from "./actuals-forecast-integrity.js";
import { mondayUtc } from "./financial-analytics.js";

/* mssql DATE columns come back as JS Dates at UTC midnight. */
const dateMs = (v: unknown): number => {
  if (v instanceof Date) return mondayUtc(v.getTime());
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? mondayUtc(t) : NaN;
};
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* ── actual hours ─────────────────────────────────────────────────────── */

export interface ActualUpsertRow {
  ticket: string;       // normalized ticket id
  person: string;       // resource GUID (stored lowercase)
  personName: string;
  weekIso: string;      // UTC Monday, YYYY-MM-DD
  hours: number;
  roleName: string;     // "" when the file had none
  division: string;
}

export async function loadActualRows(tid: string, tickets?: string[]): Promise<AfActualRow[]> {
  const pool = await getMssqlPool();
  const r = await pool.request().input("tid", mssql.NVarChar, tid).query(
    `SELECT ticket_id, resource_guid, resource_name, week_monday, hours, role_name, division
     FROM dbo.rmone_actual_hours WHERE tenant_id = @tid`,
  );
  const want = tickets && tickets.length ? new Set(tickets) : null;
  const out: AfActualRow[] = [];
  for (const row of r.recordset ?? []) {
    const ticket = String(row.ticket_id ?? "").trim();
    if (!ticket || (want && !want.has(ticket))) continue;
    const weekMs = dateMs(row.week_monday);
    if (!Number.isFinite(weekMs)) continue;
    out.push({
      ticket,
      person: String(row.resource_guid ?? "").trim().toLowerCase(),
      personName: String(row.resource_name ?? "").trim(),
      weekMs,
      hours: num(row.hours),
      roleName: String(row.role_name ?? "").trim(),
      division: String(row.division ?? "").trim(),
    });
  }
  return out;
}

/** Upsert imported rows. Same key (tenant, ticket, person, week, role)
 * REPLACES hours — the latest file is the truth for the weeks it covers. */
export async function upsertActualHours(
  tid: string,
  rows: ActualUpsertRow[],
  batchId: number | null,
): Promise<number> {
  if (!rows.length) return 0;
  // Timesheet exports carry one row per DAY or per task; the storage key is
  // per WEEK. Collapse duplicates FIRST — a MERGE whose source repeats a key
  // dies on the unique index ("Cannot insert duplicate key row").
  const folded = aggregateActualKeyRows(rows);
  const pool = await getMssqlPool();
  // One /rows call = one transaction. A mid-loop failure must leave NOTHING
  // behind so a client retry of the same failed chunk can never double-sum.
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  let written = 0;
  try {
    const CHUNK = 180; // 10 params/row — stay far below the 2100-param cap
    for (let i = 0; i < folded.length; i += CHUNK) {
      const chunk = folded.slice(i, i + CHUNK);
      const req = new mssql.Request(tx);
      const values: string[] = [];
      chunk.forEach((row, j) => {
        req.input(`t${j}`, mssql.NVarChar, tid);
        req.input(`k${j}`, mssql.NVarChar, row.ticket);
        req.input(`g${j}`, mssql.NVarChar, row.person.toLowerCase());
        req.input(`n${j}`, mssql.NVarChar, row.personName.slice(0, 300));
        req.input(`w${j}`, mssql.Date, row.weekIso);
        req.input(`h${j}`, mssql.Float, row.hours);
        req.input(`r${j}`, mssql.NVarChar, row.roleName.slice(0, 300));
        req.input(`d${j}`, mssql.NVarChar, row.division.slice(0, 300));
        req.input(`b${j}`, mssql.BigInt, batchId);
        values.push(`(@t${j}, @k${j}, @g${j}, @n${j}, @w${j}, @h${j}, @r${j}, @d${j}, @b${j})`);
      });
      // Same key in a LATER chunk of the SAME batch = more daily rows for the
      // same week → keep summing. A DIFFERENT (newer) batch = a re-imported
      // file correcting that week → REPLACE. NULL batch ids never sum.
      await req.query(
        `MERGE dbo.rmone_actual_hours WITH (HOLDLOCK) AS t
         USING (VALUES ${values.join(",")}) AS s
           (tenant_id, ticket_id, resource_guid, resource_name, week_monday, hours, role_name, division, source_batch)
         ON t.tenant_id = s.tenant_id AND t.ticket_id = s.ticket_id
            AND t.resource_guid = s.resource_guid AND t.week_monday = s.week_monday
            AND t.role_name = s.role_name
         WHEN MATCHED THEN UPDATE SET
           hours = CASE WHEN t.source_batch IS NOT NULL AND t.source_batch = s.source_batch
                        THEN t.hours + s.hours ELSE s.hours END,
           resource_name = CASE WHEN t.source_batch IS NOT NULL AND t.source_batch = s.source_batch AND t.resource_name <> ''
                                THEN t.resource_name ELSE s.resource_name END,
           division = CASE WHEN t.source_batch IS NOT NULL AND t.source_batch = s.source_batch AND t.division <> ''
                           THEN t.division ELSE s.division END,
           source_batch = s.source_batch,
           updated_at = GETUTCDATE()
         WHEN NOT MATCHED THEN INSERT
           (tenant_id, ticket_id, resource_guid, resource_name, week_monday, hours, role_name, division, source_batch)
           VALUES (s.tenant_id, s.ticket_id, s.resource_guid, s.resource_name, s.week_monday, s.hours, s.role_name, s.division, s.source_batch);`,
      );
      written += chunk.length;
    }
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* connection already gone */ }
    throw e;
  }
  return written;
}

/* ── import batches + exceptions ──────────────────────────────────────── */

export async function createImportBatch(tid: string, filename: string, uploadedBy: string): Promise<number> {
  const pool = await getMssqlPool();
  const r = await pool.request()
    .input("tid", mssql.NVarChar, tid)
    .input("fn", mssql.NVarChar, filename.slice(0, 400))
    .input("by", mssql.NVarChar, uploadedBy.slice(0, 200))
    .query(
      `INSERT INTO dbo.rmone_actual_import_batches (tenant_id, filename, uploaded_by)
       OUTPUT INSERTED.id VALUES (@tid, @fn, @by)`,
    );
  return Number(r.recordset?.[0]?.id);
}

/** Add one chunk's accepted/exception counts to the batch row. Chunk requests
 * are stateless, so the batch row is the only place the running totals live —
 * commit compares them against the client's expected row count. */
export async function bumpImportBatchCounters(
  tid: string,
  batchId: number,
  ok: number,
  exceptions: number,
): Promise<void> {
  const pool = await getMssqlPool();
  await pool.request()
    .input("tid", mssql.NVarChar, tid)
    .input("id", mssql.BigInt, batchId)
    .input("o", mssql.Int, ok)
    .input("e", mssql.Int, exceptions)
    .query(
      `UPDATE dbo.rmone_actual_import_batches
       SET rows_ok = rows_ok + @o, rows_exception = rows_exception + @e
       WHERE tenant_id = @tid AND id = @id`,
    );
}

/** Abort an unfinished batch: delete its uploaded rows + exceptions and mark
 * it aborted, in ONE transaction — a failed upload must leave NOTHING behind
 * for a later rebuild to silently pick up. Completed batches can't be
 * aborted (their numbers are published; corrections go through a new file). */
export async function abortImportBatch(
  tid: string,
  batchId: number,
): Promise<{ removedHours: number; removedExceptions: number }> {
  const pool = await getMssqlPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    const req = new mssql.Request(tx);
    req.input("tid", mssql.NVarChar, tid);
    req.input("id", mssql.BigInt, batchId);
    const r = await req.query(
      `DELETE FROM dbo.rmone_actual_hours WHERE tenant_id = @tid AND source_batch = @id;
       DELETE FROM dbo.rmone_actual_import_exceptions WHERE tenant_id = @tid AND batch_id = @id;
       UPDATE dbo.rmone_actual_import_batches
       SET status = 'aborted', completed_at = GETUTCDATE()
       WHERE tenant_id = @tid AND id = @id;`,
    );
    await tx.commit();
    const [h, e] = r.rowsAffected;
    return { removedHours: Number(h ?? 0), removedExceptions: Number(e ?? 0) };
  } catch (err) {
    try { await tx.rollback(); } catch { /* gone */ }
    throw err;
  }
}

export async function updateImportBatch(
  tid: string,
  batchId: number,
  patch: { rowsTotal?: number; rowsOk?: number; rowsException?: number; status?: string; completed?: boolean },
): Promise<void> {
  const pool = await getMssqlPool();
  await pool.request()
    .input("tid", mssql.NVarChar, tid)
    .input("id", mssql.BigInt, batchId)
    .input("rt", mssql.Int, patch.rowsTotal ?? null)
    .input("ro", mssql.Int, patch.rowsOk ?? null)
    .input("re", mssql.Int, patch.rowsException ?? null)
    .input("st", mssql.NVarChar, patch.status ?? null)
    .query(
      `UPDATE dbo.rmone_actual_import_batches SET
         rows_total = COALESCE(@rt, rows_total),
         rows_ok = COALESCE(@ro, rows_ok),
         rows_exception = COALESCE(@re, rows_exception),
         status = COALESCE(@st, status)
         ${patch.completed ? ", completed_at = GETUTCDATE()" : ""}
       WHERE tenant_id = @tid AND id = @id`,
    );
}

export interface ImportExceptionRow { reason: string; detail: string; rowJson?: unknown }

export async function insertImportExceptions(
  tid: string,
  batchId: number,
  rows: ImportExceptionRow[],
): Promise<void> {
  if (!rows.length) return;
  const pool = await getMssqlPool();
  const CHUNK = 300;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const req = pool.request();
    const values: string[] = [];
    chunk.forEach((row, j) => {
      req.input(`b${j}`, mssql.BigInt, batchId);
      req.input(`t${j}`, mssql.NVarChar, tid);
      req.input(`r${j}`, mssql.NVarChar, row.reason.slice(0, 60));
      req.input(`d${j}`, mssql.NVarChar, row.detail.slice(0, 1000));
      req.input(`j${j}`, mssql.NVarChar, row.rowJson === undefined ? null : JSON.stringify(row.rowJson).slice(0, 8000));
      values.push(`(@b${j}, @t${j}, @r${j}, @d${j}, @j${j})`);
    });
    await req.query(
      `INSERT INTO dbo.rmone_actual_import_exceptions (batch_id, tenant_id, reason, detail, row_json)
       VALUES ${values.join(",")}`,
    );
  }
}

export async function listImportBatches(tid: string, limit = 50): Promise<Record<string, unknown>[]> {
  const pool = await getMssqlPool();
  const r = await pool.request().input("tid", mssql.NVarChar, tid).query(
    `SELECT TOP ${Math.max(1, Math.min(200, limit))}
       id, filename, uploaded_by, rows_total, rows_ok, rows_exception, status, created_at, completed_at
     FROM dbo.rmone_actual_import_batches WHERE tenant_id = @tid ORDER BY id DESC`,
  );
  return r.recordset ?? [];
}

export async function listImportExceptions(tid: string, batchId: number, limit = 500): Promise<Record<string, unknown>[]> {
  const pool = await getMssqlPool();
  const r = await pool.request()
    .input("tid", mssql.NVarChar, tid)
    .input("id", mssql.BigInt, batchId)
    .query(
      `SELECT TOP ${Math.max(1, Math.min(2000, limit))} id, reason, detail, row_json, created_at
       FROM dbo.rmone_actual_import_exceptions WHERE tenant_id = @tid AND batch_id = @id ORDER BY id`,
    );
  return r.recordset ?? [];
}

/* ── snapshots ────────────────────────────────────────────────────────── */

/** Freeze every fully-elapsed week that is still open: the forecast columns
 * keep whatever the last run DURING that week computed — a true point-in-time
 * value. Runs before each recompute so the recompute can no longer touch the
 * frozen forecast side. */
export async function finalizeDueWeeks(tid: string): Promise<number> {
  const pool = await getMssqlPool();
  const cw = isoDayUtc(currentWeekMsUtcMinus12());
  const r = await pool.request()
    .input("tid", mssql.NVarChar, tid)
    .input("cw", mssql.Date, cw)
    .query(
      `UPDATE dbo.rmone_af_snapshots SET [final] = 1
       WHERE tenant_id = @tid AND [final] = 0 AND week_monday < @cw`,
    );
  return Number(r.rowsAffected?.[0] ?? 0);
}

/**
 * Persist a computed series for one project.
 *  - weeks already frozen ([final]=1): UPDATE the ACTUAL side + variances
 *    against the FROZEN forecast columns (late-timesheet restatement). The
 *    forecast side is never touched — Don's rule.
 *  - all other computed weeks: replace wholesale. A past week inserted here
 *    (no frozen row existed) is by definition reconstructed from the CURRENT
 *    plan → flagged backfilled=1 and frozen immediately.
 *  - detail rows for the computed range are replaced wholesale (the detail
 *    table is documented as recomputable evidence, not frozen truth).
 */
/** True when a snapshot writer (manual rebuild, hourly sweep, or an import
 * commit) currently holds this tenant's snapshot applock. Probe only — never
 * acquires or waits. Backs the fast 409 on /rebuild and the overview
 * "building" flag. */
export async function isAfBuildInProgress(tid: string): Promise<boolean> {
  const pool = await getMssqlPool();
  const r = await pool.request()
    .input("res", mssql.NVarChar, `rmone:af-snap:${tid.trim().toLowerCase()}`)
    .query(`SELECT APPLOCK_TEST('public', @res, 'Exclusive', 'Session') AS free`);
  return Number(r.recordset?.[0]?.free ?? 1) === 0;
}

export async function writeSnapshotSeries(
  tid: string,
  ticket: string,
  weeks: AfWeekPoint[],
  detail: AfDetailCell[],
  opts: { currentWeekMs: number },
): Promise<{ restated: number; written: number }> {
  const pool = await getMssqlPool();
  const cwMs = mondayUtc(opts.currentWeekMs);
  if (!weeks.length) return { restated: 0, written: 0 };
  const fromIso = weeks[0].weekMonday;

  const existing = await pool.request()
    .input("tid", mssql.NVarChar, tid)
    .input("tk", mssql.NVarChar, ticket)
    .query(
      `SELECT CONVERT(varchar(10), week_monday, 23) AS wk, [final] AS fin,
              actual_hours_td, forecast_remaining_hours, forecast_total_hours, forecast_hours_td,
              actual_cost_td, forecast_remaining_cost, forecast_total_cost, forecast_cost_td,
              actual_bill_td, forecast_remaining_bill, forecast_total_bill, forecast_bill_td,
              hours_variance, cost_variance, bill_variance
       FROM dbo.rmone_af_snapshots WHERE tenant_id = @tid AND ticket_id = @tk`,
    );
  const existingRows = (existing.recordset ?? []) as Array<Record<string, unknown>>;
  const frozen = new Set<string>();
  const existingByWeek = new Map<string, Record<string, unknown>>();
  for (const row of existingRows) {
    const week = String(row.wk);
    existingByWeek.set(week, row);
    if (Number(row.fin)) frozen.add(week);
  }

  const restatements = weeks.filter((w) => frozen.has(w.weekMonday));
  const fresh = weeks.filter((w) => !frozen.has(w.weekMonday));

  // Validate the exact values each SQL path will publish, before the
  // non-frozen range is deleted or any frozen row is restated. Frozen rows
  // intentionally use their persisted forecast columns; the incoming
  // forecast fields are ignored by the restatement path to preserve history.
  const sqlAdd = (left: unknown, right: unknown): number | null => {
    if (left === null || left === undefined || right === null || right === undefined) return null;
    const result = Number(left) + Number(right);
    return Number.isFinite(result) ? result : Number.NaN;
  };
  const sqlSubtract = (left: unknown, right: unknown): number | null => {
    if (left === null || left === undefined || right === null || right === undefined) return null;
    const result = Number(left) - Number(right);
    return Number.isFinite(result) ? result : Number.NaN;
  };
  const freshIntegrityRows = fresh.map((w) => ({
    tenant_id: tid,
    ticket_id: ticket,
    week_monday: w.weekMonday,
    actual_hours_td: w.actualHoursTd,
    forecast_remaining_hours: w.forecastRemainingHours,
    forecast_total_hours: w.forecastTotalHours,
    forecast_hours_td: w.forecastHoursTd,
    actual_cost_td: w.actualCostTd,
    forecast_remaining_cost: w.forecastRemainingCost,
    forecast_total_cost: w.forecastTotalCost,
    forecast_cost_td: w.forecastCostTd,
    actual_bill_td: w.actualBillTd,
    forecast_remaining_bill: w.forecastRemainingBill,
    forecast_total_bill: w.forecastTotalBill,
    forecast_bill_td: w.forecastBillTd,
    hours_variance: w.hoursVariance,
    cost_variance: w.costVariance,
    bill_variance: w.billVariance,
  }));
  const restatementIntegrityRows = restatements.map((w) => {
    const old = existingByWeek.get(w.weekMonday);
    // The frozen row was returned by the same query that classified it, so
    // this is defensive only; treating it as missing makes the write fail
    // closed rather than validating a different shape than SQL will update.
    if (!old) {
      return {
        tenant_id: tid,
        ticket_id: ticket,
        week_monday: w.weekMonday,
        actual_hours_td: Number.NaN,
        forecast_remaining_hours: null,
        forecast_total_hours: null,
        forecast_hours_td: null,
        actual_cost_td: Number.NaN,
        forecast_remaining_cost: null,
        forecast_total_cost: null,
        forecast_cost_td: null,
        actual_bill_td: Number.NaN,
        forecast_remaining_bill: null,
        forecast_total_bill: null,
        forecast_bill_td: null,
        hours_variance: null,
        cost_variance: null,
        bill_variance: null,
      };
    }
    return {
      tenant_id: tid,
      ticket_id: ticket,
      week_monday: w.weekMonday,
      actual_hours_td: w.actualHoursTd,
      forecast_remaining_hours: old.forecast_remaining_hours,
      forecast_total_hours: sqlAdd(w.actualHoursTd, old.forecast_remaining_hours),
      forecast_hours_td: old.forecast_hours_td,
      hours_variance: sqlSubtract(old.forecast_hours_td, w.actualHoursTd),
      actual_cost_td: w.actualCostTd,
      forecast_remaining_cost: old.forecast_remaining_cost,
      forecast_total_cost: sqlAdd(w.actualCostTd, old.forecast_remaining_cost),
      forecast_cost_td: old.forecast_cost_td,
      cost_variance: sqlSubtract(old.forecast_cost_td, w.actualCostTd),
      actual_bill_td: w.actualBillTd,
      forecast_remaining_bill: old.forecast_remaining_bill,
      forecast_total_bill: sqlAdd(w.actualBillTd, old.forecast_remaining_bill),
      forecast_bill_td: old.forecast_bill_td,
      bill_variance: sqlSubtract(old.forecast_bill_td, w.actualBillTd),
    };
  });
  assertAfSnapshotIntegrity(
    [...freshIntegrityRows, ...restatementIntegrityRows],
    `snapshot series ${tid}/${ticket}`,
  );

  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    /* 1 — restate the actual side of frozen weeks (forecast stays frozen). */
    for (const w of restatements) {
      await new mssql.Request(tx)
        .input("tid", mssql.NVarChar, tid)
        .input("tk", mssql.NVarChar, ticket)
        .input("wm", mssql.Date, w.weekMonday)
        .input("ah", mssql.Float, w.actualHoursTd)
        .input("ac", mssql.Float, w.actualCostTd)
        .input("ab", mssql.Float, w.actualBillTd)
        .input("sh", mssql.Float, w.substitutedHours)
        .input("uh", mssql.Float, w.unratedActualHours)
        .query(
          `UPDATE dbo.rmone_af_snapshots SET
             actual_hours_td = @ah, actual_cost_td = @ac, actual_bill_td = @ab,
             forecast_total_hours = @ah + forecast_remaining_hours,
             forecast_total_cost  = @ac + forecast_remaining_cost,
             forecast_total_bill  = @ab + forecast_remaining_bill,
             hours_variance = forecast_hours_td - @ah,
             cost_variance  = forecast_cost_td  - @ac,
             bill_variance  = forecast_bill_td  - @ab,
             substituted_hours = @sh, unrated_actual_hours = @uh,
             computed_at = GETUTCDATE()
           WHERE tenant_id = @tid AND ticket_id = @tk AND week_monday = @wm AND [final] = 1`,
        );
    }

    /* 2 — wipe non-frozen rows in the computed range, then insert fresh. */
    await new mssql.Request(tx)
      .input("tid", mssql.NVarChar, tid)
      .input("tk", mssql.NVarChar, ticket)
      .input("fm", mssql.Date, fromIso)
      .query(
        `DELETE FROM dbo.rmone_af_snapshots
         WHERE tenant_id = @tid AND ticket_id = @tk AND [final] = 0 AND week_monday >= @fm`,
      );
    const CHUNK = 70; // 24 params/row
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK);
      const req = new mssql.Request(tx);
      const values: string[] = [];
      chunk.forEach((w, j) => {
        const wMs = mondayUtc(Date.parse(w.weekMonday + "T00:00:00Z"));
        const isPast = wMs < cwMs;
        req.input(`tid${j}`, mssql.NVarChar, tid);
        req.input(`tk${j}`, mssql.NVarChar, ticket);
        req.input(`wm${j}`, mssql.Date, w.weekMonday);
        req.input(`a${j}`, mssql.Float, w.actualHoursTd);
        req.input(`b${j}`, mssql.Float, w.forecastRemainingHours);
        req.input(`c${j}`, mssql.Float, w.forecastTotalHours);
        req.input(`d${j}`, mssql.Float, w.forecastHoursTd);
        req.input(`e${j}`, mssql.Float, w.actualCostTd);
        req.input(`f${j}`, mssql.Float, w.forecastRemainingCost);
        req.input(`g${j}`, mssql.Float, w.forecastTotalCost);
        req.input(`h${j}`, mssql.Float, w.forecastCostTd);
        req.input(`i${j}`, mssql.Float, w.actualBillTd);
        req.input(`k${j}`, mssql.Float, w.forecastRemainingBill);
        req.input(`l${j}`, mssql.Float, w.forecastTotalBill);
        req.input(`m${j}`, mssql.Float, w.forecastBillTd);
        req.input(`n${j}`, mssql.Float, w.hoursVariance);
        req.input(`o${j}`, mssql.Float, w.costVariance);
        req.input(`p${j}`, mssql.Float, w.billVariance);
        req.input(`q${j}`, mssql.Float, w.substitutedHours);
        req.input(`r${j}`, mssql.Float, w.unratedActualHours);
        req.input(`s${j}`, mssql.Bit, isPast ? 1 : 0);
        req.input(`u${j}`, mssql.Bit, isPast ? 1 : 0); // past insert = reconstruction
        values.push(
          `(@tid${j}, @tk${j}, @wm${j}, @a${j}, @b${j}, @c${j}, @d${j}, @e${j}, @f${j}, @g${j}, @h${j}, @i${j}, @k${j}, @l${j}, @m${j}, @n${j}, @o${j}, @p${j}, @q${j}, @r${j}, @s${j}, @u${j})`,
        );
      });
      await req.query(
        `INSERT INTO dbo.rmone_af_snapshots
           (tenant_id, ticket_id, week_monday,
            actual_hours_td, forecast_remaining_hours, forecast_total_hours, forecast_hours_td,
            actual_cost_td, forecast_remaining_cost, forecast_total_cost, forecast_cost_td,
            actual_bill_td, forecast_remaining_bill, forecast_total_bill, forecast_bill_td,
            hours_variance, cost_variance, bill_variance,
            substituted_hours, unrated_actual_hours, [final], backfilled)
         VALUES ${values.join(",")}`,
      );
    }

    /* 3 — replace detail evidence for the computed range. */
    await new mssql.Request(tx)
      .input("tid", mssql.NVarChar, tid)
      .input("tk", mssql.NVarChar, ticket)
      .input("fm", mssql.Date, fromIso)
      .query(
        `DELETE FROM dbo.rmone_af_snapshot_detail
         WHERE tenant_id = @tid AND ticket_id = @tk AND week_monday >= @fm`,
      );
    const DCHUNK = 90; // 20 params/row
    for (let i = 0; i < detail.length; i += DCHUNK) {
      const chunk = detail.slice(i, i + DCHUNK);
      const req = new mssql.Request(tx);
      const values: string[] = [];
      chunk.forEach((c, j) => {
        req.input(`tid${j}`, mssql.NVarChar, tid);
        req.input(`tk${j}`, mssql.NVarChar, ticket);
        req.input(`wm${j}`, mssql.Date, c.weekMonday);
        req.input(`rg${j}`, mssql.NVarChar, c.person.slice(0, 100));
        req.input(`rn${j}`, mssql.NVarChar, c.personName.slice(0, 300));
        req.input(`ro${j}`, mssql.NVarChar, c.roleName.slice(0, 300));
        req.input(`dv${j}`, mssql.NVarChar, c.division.slice(0, 300));
        req.input(`a${j}`, mssql.Float, c.actualHours);
        req.input(`b${j}`, mssql.Float, c.actualCost);
        req.input(`c${j}`, mssql.Float, c.actualBill);
        req.input(`d${j}`, mssql.Float, c.forecastHours);
        req.input(`e${j}`, mssql.Float, c.forecastCost);
        req.input(`f${j}`, mssql.Float, c.forecastBill);
        req.input(`g${j}`, mssql.Float, c.remainingHours);
        req.input(`h${j}`, mssql.Float, c.remainingCost);
        req.input(`i${j}`, mssql.Float, c.remainingBill);
        req.input(`s${j}`, mssql.Bit, c.substituted ? 1 : 0);
        req.input(`p${j}`, mssql.Bit, c.rateApproximated ? 1 : 0);
        req.input(`m${j}`, mssql.Bit, c.missingDivision ? 1 : 0);
        values.push(
          `(@tid${j}, @tk${j}, @wm${j}, @rg${j}, @rn${j}, @ro${j}, @dv${j}, @a${j}, @b${j}, @c${j}, @d${j}, @e${j}, @f${j}, @g${j}, @h${j}, @i${j}, @s${j}, @p${j}, @m${j})`,
        );
      });
      await req.query(
        `INSERT INTO dbo.rmone_af_snapshot_detail
           (tenant_id, ticket_id, week_monday, resource_guid, resource_name, role_name, division,
            actual_hours, actual_cost, actual_bill, forecast_hours, forecast_cost, forecast_bill,
            remaining_hours, remaining_cost, remaining_bill, substituted, rate_approximated, missing_division)
         VALUES ${values.join(",")}`,
      );
    }

    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw e;
  }
  return { restated: restatements.length, written: fresh.length };
}

export async function readSnapshotWeeks(tid: string, ticket: string): Promise<Record<string, unknown>[]> {
  const pool = await getMssqlPool();
  const r = await pool.request()
    .input("tid", mssql.NVarChar, tid)
    .input("tk", mssql.NVarChar, ticket)
    .query(
      `SELECT CONVERT(varchar(10), s.week_monday, 23) AS weekMonday,
              actual_hours_td, forecast_remaining_hours, forecast_total_hours, forecast_hours_td,
              actual_cost_td, forecast_remaining_cost, forecast_total_cost, forecast_cost_td,
              actual_bill_td, forecast_remaining_bill, forecast_total_bill, forecast_bill_td,
              hours_variance, cost_variance, bill_variance,
               substituted_hours, unrated_actual_hours, [final] AS final_, backfilled, computed_at,
               CASE WHEN EXISTS (
                 SELECT 1 FROM dbo.rmone_actual_hours a
                 WHERE a.tenant_id = s.tenant_id AND a.ticket_id = s.ticket_id
                   AND a.week_monday = s.week_monday
               ) THEN 1 ELSE 0 END AS actuals_covered
       FROM dbo.rmone_af_snapshots s
       WHERE s.tenant_id = @tid AND s.ticket_id = @tk
       ORDER BY s.week_monday`,
    );
  return r.recordset ?? [];
}

/** Latest snapshot row per project as of the current (UTC−12) week — the
 * Executive rollup's source. */
export async function readOverviewSnapshots(tid: string): Promise<Record<string, unknown>[]> {
  const pool = await getMssqlPool();
  const cw = isoDayUtc(currentWeekMsUtcMinus12());
  const r = await pool.request()
    .input("tid", mssql.NVarChar, tid)
    .input("cw", mssql.Date, cw)
    .query(
      `WITH L AS (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY week_monday DESC) AS rn
         FROM dbo.rmone_af_snapshots
         WHERE tenant_id = @tid AND week_monday <= @cw
       )
       SELECT CONVERT(varchar(10), L.week_monday, 23) AS weekMonday, ticket_id,
              actual_hours_td, forecast_remaining_hours, forecast_total_hours, forecast_hours_td,
              actual_cost_td, forecast_remaining_cost, forecast_total_cost, forecast_cost_td,
              actual_bill_td, forecast_remaining_bill, forecast_total_bill, forecast_bill_td,
              hours_variance, cost_variance, bill_variance,
               substituted_hours, unrated_actual_hours, [final] AS final_, backfilled, computed_at,
               CASE WHEN EXISTS (
                 SELECT 1 FROM dbo.rmone_actual_hours a
                 WHERE a.tenant_id = L.tenant_id AND a.ticket_id = L.ticket_id
                   AND a.week_monday = L.week_monday
               ) THEN 1 ELSE 0 END AS actuals_covered
       FROM L WHERE rn = 1`,
    );
  return r.recordset ?? [];
}

export async function readDetailRows(tid: string, ticket: string): Promise<Record<string, unknown>[]> {
  const pool = await getMssqlPool();
  const [r, users] = await Promise.all([
    pool.request()
    .input("tid", mssql.NVarChar, tid)
    .input("tk", mssql.NVarChar, ticket)
    .query(
      `SELECT CONVERT(varchar(10), d.week_monday, 23) AS weekMonday,
              resource_guid, resource_name, role_name, division,
              actual_hours, actual_cost, actual_bill, forecast_hours, forecast_cost, forecast_bill,
              remaining_hours, remaining_cost, remaining_bill,
               substituted, rate_approximated, missing_division,
               CASE WHEN EXISTS (
                 SELECT 1 FROM dbo.rmone_actual_hours a
                 WHERE a.tenant_id = d.tenant_id AND a.ticket_id = d.ticket_id
                   AND a.week_monday = d.week_monday
                   AND a.resource_guid = d.resource_guid
               ) THEN 1 ELSE 0 END AS actuals_covered
       FROM dbo.rmone_af_snapshot_detail d
       WHERE d.tenant_id = @tid AND d.ticket_id = @tk
       ORDER BY d.week_monday, d.resource_name, d.role_name`,
    ),
    getUsersByTenant(tid).catch(() => []),
  ]);

  // Older snapshot builds could persist the resource GUID in resource_name
  // when the directory lookup was empty. Resolve that at read time as well as
  // at build time so historical snapshots become readable without a rebuild.
  // Tenant-scoped canonical identity metadata for persisted evidence rows.
  // Never key by display name: two people can legitimately share one name.
  const people = new Map<string, { name: string; enabled: boolean; tenantId: string }>();
  for (const u of users) {
    const id = String(u.id ?? "").trim().toLowerCase();
    const name = String(u.name || u.username || "").trim();
    if (id) people.set(id, { name, enabled: u.enabled !== false, tenantId: tid });
  }
  const looksLikeGuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  return (r.recordset ?? []).map((row: Record<string, unknown>) => {
    const id = String(row.resource_guid ?? "").trim().toLowerCase();
    const stored = String(row.resource_name ?? "").trim();
    const person = people.get(id);
    if (person?.name && (!stored || looksLikeGuid(stored) || stored.toLowerCase() === id)) {
      return { ...row, resource_name: person.name, enabled: person.enabled, tenant_id: person.tenantId };
    }
    // Unknown/legacy GUIDs have no canonical lifecycle state. Preserve the
    // stored evidence but make the tenant association explicit and never
    // borrow a same-GUID record from another tenant.
    return { ...row, enabled: person?.enabled ?? null, tenant_id: person?.tenantId ?? tid };
  });
}

/** Distinct tickets that already have snapshot rows (used by the job to pick
 * incremental vs full ranges, and by the overview to include actuals-only
 * projects). */
export async function readSnapshotTickets(tid: string): Promise<Set<string>> {
  const pool = await getMssqlPool();
  const r = await pool.request().input("tid", mssql.NVarChar, tid).query(
    `SELECT DISTINCT ticket_id FROM dbo.rmone_af_snapshots WHERE tenant_id = @tid`,
  );
  return new Set((r.recordset ?? []).map((x: Record<string, unknown>) => String(x.ticket_id)));
}

/** Tenants that have imported actuals (the snapshot job must cover these even
 * when they have no allocation rows). */
export async function tenantsWithActuals(): Promise<string[]> {
  const pool = await getMssqlPool();
  const r = await pool.request().query(
    `SELECT DISTINCT tenant_id FROM dbo.rmone_actual_hours`,
  );
  return (r.recordset ?? []).map((x: Record<string, unknown>) => String(x.tenant_id)).filter(Boolean);
}
