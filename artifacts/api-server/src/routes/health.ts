import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// ── GET /api/healthz/imports — deploy drain probe ───────────────────────────
// "Is it safe to replace/restart API instances right now?" Deploy pipelines
// (Elastic Beanstalk rolling deploys, VM restarts) poll this before swapping
// instances: an instance killed mid-import strands a half-written import that
// the ghost sweep only fails 10 minutes later — drain first, then swap.
//
//   drainSafe — true when NO import pipeline is executing anywhere in the
//               fleet (running === 0; the shared jobs table sees every worker
//               on every instance). Fresh *pending* uploads (parsed, waiting
//               for the user to press Run) do NOT block: their state is
//               persisted, so /run works against a replacement instance —
//               stricter pipelines may additionally wait for pending === 0.
//   counts    — aggregates only. Unauthenticated like its sibling /healthz,
//               so no tenant labels, file names, or upload ids are exposed.
//
// DB probe failure → 503, drainSafe:false — fail CLOSED: "unknown" must never
// green-light a swap; the pipeline retries or times out loudly.
//
// Lazy import keeps the plain /healthz liveness probe dependency-free; the
// onboarding module (and its DB plumbing) loads only when this deploy-time
// probe is actually hit.
router.get("/healthz/imports", async (_req, res) => {
  try {
    const { summarizeActiveImports } = await import("./onboarding.js");
    const s = await summarizeActiveImports();
    res.json({
      ok: true,
      drainSafe: s.running === 0,
      ...s,
      asOf: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({
      ok: false,
      drainSafe: false,
      error: "active-imports probe failed",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

export default router;
