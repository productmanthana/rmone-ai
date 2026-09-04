import { getMssqlPool, mssql } from "@workspace/db";

export type AfSnapshotMetric = "hours" | "cost" | "bill";
export type AfSnapshotViolationKind =
  | "total_identity"
  | "variance_identity"
  | "negative_remaining"
  | "non_finite";

export interface AfSnapshotIntegrityRow {
  tenant_id?: unknown;
  ticket_id?: unknown;
  week_monday?: unknown;
  actual_hours_td?: unknown;
  forecast_remaining_hours?: unknown;
  forecast_total_hours?: unknown;
  forecast_hours_td?: unknown;
  actual_cost_td?: unknown;
  forecast_remaining_cost?: unknown;
  forecast_total_cost?: unknown;
  forecast_cost_td?: unknown;
  actual_bill_td?: unknown;
  forecast_remaining_bill?: unknown;
  forecast_total_bill?: unknown;
  forecast_bill_td?: unknown;
  hours_variance?: unknown;
  cost_variance?: unknown;
  bill_variance?: unknown;
}

export interface AfSnapshotIntegrityMetricFinding {
  metric: AfSnapshotMetric;
  violations: AfSnapshotViolationKind[];
  totalDelta: number | null;
  varianceDelta: number | null;
  remaining: number | null;
}

export interface AfSnapshotIntegrityFinding {
  tenantId: string;
  ticketId: string;
  weekMonday: string;
  metrics: AfSnapshotIntegrityMetricFinding[];
}

export interface AfSnapshotIntegrityScanResult {
  epsilon: number;
  tenantsScanned: number;
  rowsScanned: number;
  findingCount: number;
  findings: AfSnapshotIntegrityFinding[];
  noViolations: boolean;
  summary: string;
}
interface MetricInput {
  metric: AfSnapshotMetric;
  actual: unknown;
  remaining: unknown;
  total: unknown;
  planTd: unknown;
  variance: unknown;
}

const asFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const displayDate = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  return text.length >= 10 ? text.slice(0, 10) : text;
};

/**
 * Find persisted rows that violate the AF storage identities.
 *
 * `total = actual-to-date + remaining` and
 * `variance = plan-to-date - actual-to-date` are checked with the supplied
 * epsilon. Negative remaining is always reported, including values smaller
 * than epsilon, because remaining work cannot be negative.
 */
export function findAfSnapshotIntegrityIssues(
  rows: readonly AfSnapshotIntegrityRow[],
  epsilon = 0.01,
): AfSnapshotIntegrityFinding[] {
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new Error("Snapshot integrity epsilon must be a finite non-negative number");
  }

  const findings: AfSnapshotIntegrityFinding[] = [];
  for (const row of rows) {
    const metrics: AfSnapshotIntegrityMetricFinding[] = [];
    const inputs: MetricInput[] = [
      {
        metric: "hours",
        actual: row.actual_hours_td,
        remaining: row.forecast_remaining_hours,
        total: row.forecast_total_hours,
        planTd: row.forecast_hours_td,
        variance: row.hours_variance,
      },
      {
        metric: "cost",
        actual: row.actual_cost_td,
        remaining: row.forecast_remaining_cost,
        total: row.forecast_total_cost,
        planTd: row.forecast_cost_td,
        variance: row.cost_variance,
      },
      {
        metric: "bill",
        actual: row.actual_bill_td,
        remaining: row.forecast_remaining_bill,
        total: row.forecast_total_bill,
        planTd: row.forecast_bill_td,
        variance: row.bill_variance,
      },
    ];

    for (const input of inputs) {
      const actual = asFiniteNumber(input.actual);
      const remaining = asFiniteNumber(input.remaining);
      const total = asFiniteNumber(input.total);
      const planTd = asFiniteNumber(input.planTd);
      const variance = asFiniteNumber(input.variance);
      const violations: AfSnapshotViolationKind[] = [];

      if (
        actual === null ||
        remaining === null ||
        total === null ||
        planTd === null ||
        variance === null
      ) {
        violations.push("non_finite");
      }

      const totalDelta =
        actual === null || remaining === null || total === null
          ? null
          : total - actual - remaining;
      const varianceDelta =
        actual === null || planTd === null || variance === null
          ? null
          : variance - (planTd - actual);

      if (totalDelta !== null && Math.abs(totalDelta) > epsilon) {
        violations.push("total_identity");
      }
      if (varianceDelta !== null && Math.abs(varianceDelta) > epsilon) {
        violations.push("variance_identity");
      }
      if (remaining !== null && remaining < 0) {
        violations.push("negative_remaining");
      }

      if (violations.length) {
        metrics.push({
          metric: input.metric,
          violations,
          totalDelta,
          varianceDelta,
          remaining,
        });
      }
    }

    if (metrics.length) {
      findings.push({
        tenantId: String(row.tenant_id ?? "").trim(),
        ticketId: String(row.ticket_id ?? "").trim(),
        weekMonday: displayDate(row.week_monday),
        metrics,
      });
    }
  }
  return findings;
}

/**
 * Run the read-only snapshot scan for one tenant, or for every tenant when no
 * tenant id is supplied. The caller owns authorization; this function only
 * accepts the tenant id selected by that caller and always binds it as a SQL
 * parameter.
 */
export async function scanAfSnapshotIntegrity(
  tenantId?: string,
  epsilon = DEFAULT_AF_INTEGRITY_EPSILON,
): Promise<AfSnapshotIntegrityScanResult> {
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new Error("Snapshot integrity epsilon must be a finite non-negative number");
  }

  const pool = await getMssqlPool();
  const requestedTenantId = tenantId?.trim() || null;
  const tenantRequest = pool.request();
  const tenantResult = requestedTenantId
    ? await tenantRequest
      .input("tid", mssql.NVarChar, requestedTenantId)
      .query(
        `SELECT DISTINCT tenant_id
         FROM dbo.rmone_af_snapshots
         WHERE tenant_id = @tid
         ORDER BY tenant_id`,
      )
    : await tenantRequest.query(
      `SELECT DISTINCT tenant_id
       FROM dbo.rmone_af_snapshots
       ORDER BY tenant_id`,
    );
  const tenants = (tenantResult.recordset ?? [])
    .map((row: Record<string, unknown>) => String(row.tenant_id ?? "").trim())
    .filter(Boolean);

  let rowsScanned = 0;
  const findings: AfSnapshotIntegrityFinding[] = [];
  for (const scannedTenantId of tenants) {
    const result = await pool.request()
      .input("tid", mssql.NVarChar, scannedTenantId)
      .query(
        `SELECT tenant_id, ticket_id, week_monday,
                actual_hours_td, forecast_remaining_hours, forecast_total_hours, forecast_hours_td,
                actual_cost_td, forecast_remaining_cost, forecast_total_cost, forecast_cost_td,
                actual_bill_td, forecast_remaining_bill, forecast_total_bill, forecast_bill_td,
                hours_variance, cost_variance, bill_variance
         FROM dbo.rmone_af_snapshots
         WHERE tenant_id = @tid
         ORDER BY ticket_id, week_monday`,
      );
    const rows = (result.recordset ?? []) as AfSnapshotIntegrityRow[];
    rowsScanned += rows.length;
    findings.push(...findAfSnapshotIntegrityIssues(rows, epsilon));
  }

  return {
    epsilon,
    tenantsScanned: tenants.length,
    rowsScanned,
    findingCount: findings.length,
    findings,
    noViolations: findings.length === 0,
    summary: findings.length
      ? `${findings.length} forecast history integrity violation${findings.length === 1 ? "" : "s"} found.`
      : "No forecast history integrity violations found.",
  };
}

/**
 * Guard a batch before it is published by a snapshot writer.
 *
 * Unlike the read-only scanner, writers must fail loudly: a bad row must not
 * reach a delete/insert or restatement update that could leave a series
 * partially refreshed. Keep the findings on the error so the caller/logs can
 * identify the exact tenant, ticket, week, and metric family that failed.
 */
export function assertAfSnapshotIntegrity(
  rows: readonly AfSnapshotIntegrityRow[],
  context = "snapshot write",
  epsilon = 0.01,
): void {
  const findings = findAfSnapshotIntegrityIssues(rows, epsilon);
  if (!findings.length) return;

  const details = findings.flatMap((finding) =>
    finding.metrics.map((metric) =>
      `${finding.tenantId}/${finding.ticketId}/${finding.weekMonday}/${metric.metric}:` +
      metric.violations.join(","),
    ),
  );
  throw new Error(
    `Rejected ${context}: forecast snapshot integrity violation(s): ${details.join("; ")}`,
  );
}

export const DEFAULT_AF_INTEGRITY_EPSILON = 0.01;
