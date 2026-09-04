/**
 * IS_DEPLOYED_SERVER — is this process a DEPLOYED server, as opposed to the
 * local development workspace?
 *
 * Why it exists: background fan-outs (boot/periodic home-cache warming, the
 * nightly allocation integrity scan, the usage rollup) are suppressed in the
 * dev workspace because it shares the SAME core2 RDS as production — an Aug
 * 2026 DMV capture caught idle-dev warm sweeps stacking 30+ concurrent
 * tenant-wide queries onto prod's CPU-starved instance.
 *
 * That suppression must NOT apply to real deployments:
 *  - Hosted workspace deployments set a platform deployment flag.
 *  - AWS Elastic Beanstalk environments set ENV_NAME (dev|qa|pilot|prod, from
 *    infra/aws/beanstalk.tf) and run against their OWN database copy. Without
 *    this signal they were treated as "dev" and never warmed — every first
 *    dashboard hit paid the 30–45s cold fan-out (observed on rmone-dev,
 *    Aug 2026).
 *
 * ENV_NAME is never set in the local workspace, so dev keeps skipping.
 */
export const IS_DEPLOYED_SERVER: boolean = Boolean(
  process.env["ENV_NAME"],
);

/**
 * BACKGROUND_PROFILE — how much scheduled background load (cache warming,
 * usage rollup) this deployed server should generate.
 *
 *  "full"  — production cadence: tight boot-warm stagger, lead worker
 *            re-warms every 10 min, first usage rollup 90s after boot.
 *  "light" — medium nonprod cadence (qa/pilot): boot warm spread ~4× wider,
 *            re-warm 6× slower, first rollup deferred 15 min.
 *  "off"   — no automatic warm/rollup/integrity jobs (rmone-dev t3.small);
 *            request-driven cache filling still works normally.
 *
 * Why: 2026-08-27 — rmone-dev (t3.small, 2 GiB, WORKERS=2) wedged within ~3 minutes
 * of its first warmed boot. Both workers boot-warming every tenant, the
 * lead worker's first 10-min re-warm sweep, and the usage rollup all landed
 * within ~60s; the EB health daemon and log agents stopped reporting
 * (resource starvation), the site stopped serving, and the instance had to
 * be terminated. Production hardware (r6i.large, 16 GiB, WORKERS=4) runs
 * "full" — the cadence proven on the production VM.
 *
 * BACKGROUND_PROFILE=full|light|off overrides the ENV_NAME-derived default —
 * an emergency lever to damp a struggling box (or load-test a nonprod one)
 * without cutting a release.
 */
export type BackgroundProfile = "full" | "light" | "off";
export const BACKGROUND_PROFILE: BackgroundProfile = (() => {
  const override = process.env["BACKGROUND_PROFILE"];
  if (override === "full" || override === "light" || override === "off") return override;
  const envName = process.env["ENV_NAME"];
  if (envName === "dev") return "off";
  if (envName && envName !== "prod") return "light";
  return "full";
})();
