import express, { type Express, type Request, type Response, type NextFunction } from "express";
import path from "path";
import { existsSync } from "fs";
import cors from "cors";
import compression from "compression";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import router from "./routes";
import { auditTrailObserver, startAuditOutboxWorker } from "./lib/auditTrail.js";
import { applyTrustProxy } from "./lib/trust-proxy.js";
import { verifyRdsToken } from "./lib/rds-auth.js";
import { rateLimitBucketKey } from "./lib/rate-limit-key.js";

const app: Express = express();
startAuditOutboxWorker();

// Trust the reverse-proxy X-Forwarded-For chain so req.ip is the real client,
// not a proxy's internal address. On Elastic Beanstalk this is an address
// ALLOWLIST (instance nginx + ALB private VPC + CloudFront origin-facing
// ranges), NOT a hop count — the ALBs are still directly reachable, and a
// hop count lets a direct caller spoof req.ip via pre-loaded X-Forwarded-For
// entries. Undercounting the CloudFront hop is what collapsed all anonymous
// logins into one shared rate-limit bucket (Aug 2026 dev-EB "Too many
// requests" incident). See lib/trust-proxy.ts for the full walk-through.
applyTrustProxy(app);

app.use(compression({
  filter: (req, res) => {
    if (req.path === "/api/chat/message") return false;
    return compression.filter(req, res);
  },
}));
app.use(cors());
// Register before request limits and body parsing so authenticated writes that
// are rejected with 429 or malformed-body responses are still captured after
// their true response outcome is known. The observer derives parsed targets in
// its finish callback for requests that proceed through the parsers.
app.use("/api", auditTrailObserver);

// ── Global rate limiter ──────────────────────────────────────────────────────
// One RM ONE screen can legitimately fan out into many parallel GET requests,
// so reads get a larger allowance while writes retain the stricter guard
// against accidental duplicate actions. Health-check paths are excluded.
// Bucket identity is trust-tiered (see lib/rate-limit-key.ts): only locally
// VERIFIED tokens earn a per-user bucket; every unverifiable Authorization
// value shares the sender's per-IP bucket, so rotating fabricated headers
// cannot mint fresh buckets (limiter bypass + unbounded MemoryStore growth).
app.use("/api", rateLimit({
  windowMs: 60 * 1000,
  limit: (req) =>
    req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS"
      ? 1_200
      : 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health" || req.path === "/status",
  keyGenerator: (req) =>
    rateLimitBucketKey(req.headers.authorization, ipKeyGenerator(req.ip ?? ""), verifyRdsToken),
  message: { error: "Too many requests — please slow down and retry in a moment." },
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Elastic Beanstalk liveness must remain DB-free so a transient database
// outage does not replace otherwise healthy application instances.
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, status: "ok" });
});

// API responses are per-user and real-time — forbid any browser or
// intermediary cache. Future-proofing: if a CDN (e.g. CloudFront) is ever
// put in front of the app it must never store one user's payload or replay
// a stale edit. Individual routes may still override (e.g. SSE streams set
// their own headers after this runs).
app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store, private");
  next();
});

app.use("/api", router);

// In the merged single-process VM build, set SERVE_WEB_DIR to the path of
// the built web app (e.g. artifacts/rmone-web/dist/public). The API server
// will then serve the SPA at `/` (and all non-/api routes) from the same
// process / port. In dev (separate workflows) leave SERVE_WEB_DIR unset and
// this block is a no-op.
const webDir = process.env["SERVE_WEB_DIR"];
if (webDir) {
  const absWebDir = path.isAbsolute(webDir)
    ? webDir
    : path.resolve(process.cwd(), webDir);
  if (!existsSync(absWebDir)) {
    throw new Error(
      `SERVE_WEB_DIR is set to "${webDir}" but that directory does not exist. ` +
        `Did you run \`pnpm --filter @workspace/rmone-web run build\` first?`,
    );
  }
  const indexHtml = path.join(absWebDir, "index.html");
  if (!existsSync(indexHtml)) {
    throw new Error(
      `SERVE_WEB_DIR "${absWebDir}" does not contain index.html. ` +
        `Make sure the web build output folder is correct.`,
    );
  }
  app.use(express.static(absWebDir, {
    index: false,
    setHeaders: (res, filePath) => {
      // Vite build assets carry a content hash in the filename, so a given
      // URL never changes — cache them for a year ("immutable"). Without
      // this, returning visitors re-download the multi-MB JS bundle on
      // every visit and sit on the boot splash.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (filePath.endsWith("version.json")) {
        // version.json is polled by stale tabs to detect new deploys — it
        // must never be served from a proxy or browser cache.  The SPA also
        // always appends ?_=<timestamp> as a belt-and-suspenders measure.
        res.setHeader("Cache-Control", "no-store");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  }));
  app.get(/^\/(?!api(?:\/|$)).*/, (_req: Request, res: Response, next: NextFunction) => {
    // index.html must never be cached long — it references the current
    // hashed asset names, and a stale copy would point at deleted files
    // after a redeploy. no-cache = always revalidate (cheap 304).
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  });
  console.log(`[startup] Serving web app from ${absWebDir}`);
}

export default app;
