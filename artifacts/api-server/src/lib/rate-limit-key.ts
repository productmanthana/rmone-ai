import { createHash } from "node:crypto";

/**
 * Rate-limit bucket identity, trust-tiered.
 *
 * - Authorization values that VERIFY locally (RDS HMAC JWTs) earn a pure
 *   per-user bucket: office NATs funnel many real users through one apparent
 *   IP, and a shared per-IP bucket would 429 innocent users. Verified tokens
 *   cannot be minted by an attacker (signing requires SESSION_SECRET), so a
 *   bucket per token is safe — cardinality is bounded by real sign-ins.
 * - EVERYTHING else — no Authorization, malformed bearers, expired tokens,
 *   and legacy upstream OAuth bearers this server cannot verify — shares the
 *   sender's per-IP bucket. This is deliberate: keying unverifiable headers
 *   individually lets any client mint a fresh bucket per request, which is
 *   both a limiter bypass (unbounded budget) and unbounded in-memory store
 *   growth (architect finding, Aug 2026). The cost is that legacy-upstream
 *   users behind one NAT share an IP budget; if that ever pinches, the fix
 *   is verifying upstream bearers (introspection / JWKS, cached) BEFORE
 *   granting per-user buckets — never per-token keying of unverified values.
 *
 * Pure function: the verifier is injected so tests can exercise the tiering
 * without crypto material or database imports.
 */
export function rateLimitBucketKey(
  authHeader: string | undefined,
  ipBucket: string,
  verifyBearer: (token: string) => unknown,
): string {
  if (authHeader) {
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (verifyBearer(bearer)) {
      return "u:" + createHash("sha256").update(authHeader).digest("hex").slice(0, 32);
    }
  }
  return "ip:" + ipBucket;
}
