/**
 * Rate-limiter bucket tiering check (guards the Aug 2026 architect finding).
 * Run: npx tsx scripts/check-rate-limit-keys.ts
 *
 * Rotating unverifiable Authorization headers must NEVER mint fresh limiter
 * buckets — that is both a limiter bypass (unbounded request budget from one
 * IP) and unbounded in-memory store growth. Only tokens the server can verify
 * locally earn a per-user bucket. Exercises rateLimitBucketKey with a stub
 * verifier — the HMAC verification path itself is covered by the production
 * auth flow; what this guards is the TIERING contract.
 *
 * Exit code 0 = all good; 1 = at least one assertion failed.
 */
import { rateLimitBucketKey } from "../src/lib/rate-limit-key.js";

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL  " + msg); };
const ok = (label: string, cond: boolean) => { if (!cond) fail(label); };

const verify = (token: string) =>
  token === "valid-token-a" || token === "valid-token-b" ? { sub: "user" } : null;
const IP = "203.0.113.7";

// 1. Rotated fabricated bearers all collapse into ONE bucket…
const rotated = new Set<string>();
for (let i = 0; i < 500; i++) rotated.add(rateLimitBucketKey(`Bearer fake-${i}.x.y`, IP, verify));
ok(`rotated fake bearers mint no buckets (got ${rotated.size} distinct, want 1)`, rotated.size === 1);
// …and that bucket IS the anonymous per-IP bucket (same budget, same counter).
ok("fake-bearer bucket equals the anonymous bucket", rotated.has(rateLimitBucketKey(undefined, IP, verify)));
ok("anonymous bucket is IP-scoped", rateLimitBucketKey(undefined, IP, verify) === "ip:" + IP);

// 2. Verified tokens: per-user bucket, stable, distinct per token.
const a1 = rateLimitBucketKey("Bearer valid-token-a", IP, verify);
const a2 = rateLimitBucketKey("Bearer valid-token-a", IP, verify);
const b = rateLimitBucketKey("Bearer valid-token-b", IP, verify);
ok("verified token gets a u: bucket", a1.startsWith("u:"));
ok("verified bucket is stable across calls", a1 === a2);
ok("distinct verified tokens get distinct buckets", a1 !== b);
ok("verified bucket is not the IP bucket", a1 !== "ip:" + IP);
ok(
  "Bearer prefix is stripped case-insensitively before verification",
  rateLimitBucketKey("bearer valid-token-a", IP, verify).startsWith("u:"),
);

// 3. Tokens the verifier rejects (expired/garbage) fall back to the IP bucket.
ok(
  "rejected token falls back to the IP bucket",
  rateLimitBucketKey("Bearer expired-or-forged", IP, verify) === "ip:" + IP,
);

// 4. No cross-IP bleed: the same fake token from two IPs = two buckets.
ok(
  "same fake token from different IPs stays IP-scoped",
  rateLimitBucketKey("Bearer fake-shared", IP, verify) !==
    rateLimitBucketKey("Bearer fake-shared", "198.51.100.9", verify),
);

if (failures > 0) {
  console.error(`check-rate-limit-keys: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-rate-limit-keys: PASS — unverifiable Authorization values cannot mint rate-limit buckets");
