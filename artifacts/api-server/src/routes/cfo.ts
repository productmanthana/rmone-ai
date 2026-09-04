/**
 * CFO financial-health route.
 *
 * GET /api/cfo/financial-health
 *   Returns 6 live-computed financial KPI scores (0–100) for the CFO
 *   home dashboard, derived from PMM records, OPM pipeline, and the
 *   resource-allocation summary.
 *
 * Auth: same Bearer + x-rmone-tenant/x-rmone-user-guid headers as
 * /api/alerts/*.  Uses the same `selfGet` pattern — calls our own
 * /api/rmone/* routes so tenant isolation is handled in one place.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { isValidSessionToken } from "./rmone-proxy.js";

const router: IRouter = Router();
const SELF_BASE = `http://127.0.0.1:${process.env.PORT || "8080"}/api/rmone`;

// ── Auth ──────────────────────────────────────────────────────────
interface SessionMeta { bearer: string; tenant: string; userGuid: string }

async function requireSession(req: Request, res: Response): Promise<SessionMeta | null> {
  const auth = req.headers.authorization ?? "";
  const tenant = String(req.headers["x-rmone-tenant"] ?? "").trim();
  const userGuid = String(req.headers["x-rmone-user-guid"] ?? "").trim();
  if (!auth) { res.status(401).json({ error: "Missing Authorization header" }); return null; }
  if (!tenant) { res.status(400).json({ error: "Missing x-rmone-tenant header" }); return null; }
  const token = auth.replace(/^bearer\s+/i, "").trim();
  const ok = await isValidSessionToken(token).catch(() => false);
  if (!ok) { res.status(401).json({ error: "Invalid or expired session" }); return null; }
  return { bearer: auth, tenant, userGuid };
}

async function selfGet<T>(path: string, bearer: string): Promise<T | null> {
  try {
    const r = await fetch(`${SELF_BASE}${path}`, {
      headers: { Authorization: bearer, Accept: "application/json" },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

// ── Data types ────────────────────────────────────────────────────
interface ModuleRecord { [k: string]: unknown }
interface ModuleResp { data?: ModuleRecord[]; total?: number }
interface AllocationsResp {
  total?: number;
  bench?: number;
  overAllocated?: number;
  healthy?: number;
  resources?: Array<{ id?: string; name?: string; currentPct?: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────
function fieldNum(r: ModuleRecord, k: string): number {
  const v = r[k];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const CONTRACT_FIELDS = ["ApproxContractValue", "ContractValue", "ProjectValue", "EstimatedValue"];

function valueOf(r: ModuleRecord): number {
  for (const f of CONTRACT_FIELDS) {
    const n = fieldNum(r, f);
    if (n > 0) return n;
  }
  return 0;
}

function clampPct(num: number, denom: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((num / denom) * 100)));
}

const RISK_RE = /risk|delay|hold|issue|red|stop|escalat|over[- ]?budget|slip|behind/i;

function statusOf(r: ModuleRecord): string {
  return String(
    r.CRMProjectStatusChoice ?? r.CRMOpportunityStatusChoice ?? r.Status ?? "",
  );
}

// ── Endpoint ──────────────────────────────────────────────────────
router.get("/financial-health", async (req: Request, res: Response) => {
  const meta = await requireSession(req, res);
  if (!meta) return;

  const [pmmResp, opmResp, allocsResp] = await Promise.all([
    selfGet<ModuleResp>("/records/PMM", meta.bearer),
    selfGet<ModuleResp>("/records/OPM", meta.bearer),
    selfGet<AllocationsResp>("/resource-allocations", meta.bearer),
  ]);

  const pmmRows   = pmmResp?.data  ?? [];
  const opmRows   = opmResp?.data  ?? [];
  const resources = allocsResp?.resources ?? [];
  const total     = Math.max(1, allocsResp?.total       ?? resources.length ?? 1);
  const bench     = allocsResp?.bench        ?? 0;
  const over      = allocsResp?.overAllocated ?? 0;
  const healthy   = allocsResp?.healthy       ?? 0;

  // ── 1. Pipeline Coverage ─────────────────────────────────────────
  // = open OPM pipeline value ÷ (PMM backlog × 25% target)
  // 25% is the default proposalCoveragePct business rule.
  const pipelineValue = opmRows
    .filter(r => !r.Closed)
    .reduce((s, r) => s + valueOf(r), 0);
  const backlogValue = pmmRows.reduce((s, r) => s + valueOf(r), 0);
  const coverageTarget = backlogValue * 0.25;
  let pipelineCoverage: number;
  if (coverageTarget > 0) {
    pipelineCoverage = Math.min(100, Math.round((pipelineValue / coverageTarget) * 100));
  } else if (pipelineValue > 0) {
    pipelineCoverage = 80;
  } else {
    pipelineCoverage = 0;
  }

  // ── 2. Labor Margin ──────────────────────────────────────────────
  // = avg across PMM projects of (ContractValue − LaborContractAmount) ÷ ContractValue
  // Represents what share of contract revenue is gross margin (not labor cost).
  const laborRows = pmmRows.filter(r => valueOf(r) > 0 && fieldNum(r, "LaborContractAmount") > 0);
  let laborMargin: number;
  if (laborRows.length > 0) {
    const margins = laborRows.map(r => {
      const cv    = valueOf(r);
      const labor = fieldNum(r, "LaborContractAmount");
      return Math.max(0, (cv - labor) / cv * 100);
    });
    laborMargin = Math.max(0, Math.min(100, Math.round(
      margins.reduce((a, b) => a + b, 0) / margins.length,
    )));
  } else {
    // No LaborContractAmount data: proxy from healthy allocation ratio.
    laborMargin = clampPct(healthy || total - bench - over, total);
  }

  // ── 3. Hours on Plan ─────────────────────────────────────────────
  // = % of resources NOT over-allocated
  // Proxy for min(ContractHrs ÷ ForecastHrs, 1) × 100: when resources are
  // within capacity the hours are on-plan; over-allocation flags schedule slip.
  const hoursOnPlan = clampPct(total - over, total);

  // ── 4. Labor Completion ──────────────────────────────────────────
  // = % of resources actively deployed (not on bench)
  // Proxy for ActualHrs ÷ ForecastHrs × 100: deployed fraction represents
  // the proportion of the labour forecast that has been engaged.
  const laborCompletion = clampPct(total - bench, total);

  // ── 5. Cost Coverage (FCCR) ──────────────────────────────────────
  // = % of PMM projects NOT flagged as at-risk
  // Proxy for RemainingRevenue ÷ ETC: at-risk projects threaten remaining
  // revenue; healthy projects provide cost coverage.
  const atRiskCount = pmmRows.filter(r => RISK_RE.test(statusOf(r))).length;
  let costCoverage: number;
  if (pmmRows.length > 0) {
    costCoverage = clampPct(pmmRows.length - atRiskCount, pmmRows.length);
  } else {
    // No PMM data: use pipeline-vs-backlog ratio.
    costCoverage = backlogValue > 0
      ? Math.min(100, Math.round((pipelineValue / backlogValue) * 100))
      : 0;
  }

  // ── 6. Alloc on Plan ─────────────────────────────────────────────
  // = % of resources in the healthy 60–100% allocation band
  // Directly computable when per-resource currentPct values are available;
  // falls back to the aggregate healthy count from the summary.
  let allocOnPlan: number;
  if (resources.length > 0) {
    const inBand = resources.filter(r => {
      const p = r.currentPct ?? 0;
      return p >= 60 && p <= 100;
    }).length;
    allocOnPlan = clampPct(inBand, resources.length);
  } else {
    allocOnPlan = clampPct(healthy, total);
  }

  res.json({
    pipelineCoverage,
    laborMargin,
    hoursOnPlan,
    laborCompletion,
    costCoverage,
    allocOnPlan,
    detail: {
      pipelineValue,
      backlogValue,
      coverageTarget,
      laborRowCount:     laborRows.length,
      totalPmmProjects:  pmmRows.length,
      totalOpmPursuits:  opmRows.length,
      atRiskCount,
      totalResources:    total,
      benchCount:        bench,
      overAllocatedCount: over,
      healthyCount:      healthy,
    },
  });
});

export default router;
