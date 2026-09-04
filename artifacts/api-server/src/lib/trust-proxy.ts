import type { Express } from "express";

/**
 * Proxy-trust configuration.
 *
 * Why an address ALLOWLIST and not a hop count: `trust proxy = N` trusts
 * chain POSITIONS. The Elastic Beanstalk ALBs remain directly reachable
 * (the CloudFront origin lock is still pending hardening), so a caller
 * hitting an ALB directly can pre-load X-Forwarded-For entries that occupy
 * trusted positions and choose their own req.ip — defeating per-IP rate
 * limiting and poisoning every req.ip consumer downstream. An allowlist
 * instead walks the chain from the socket outward and stops at the first
 * address that is NOT a known proxy:
 *   - loopback      → the instance-local nginx (EB)
 *   - uniquelocal   → the ALB's private VPC address
 *   - CloudFront ORIGIN-FACING ranges → the edge host that contacted the ALB
 *
 * Via CloudFront:  [spoofed…, viewer, cf-edge, alb, nginx] → stops at viewer.
 * Direct to ALB:   [spoofed…, caller, alb, nginx]          → stops at caller.
 * Both paths yield the true client; spoofed entries are never reached.
 */

/**
 * Snapshot of the CLOUDFRONT_ORIGIN_FACING prefixes from
 * https://ip-ranges.amazonaws.com/ip-ranges.json (createDate 2026-08-31).
 * Used immediately at boot; a live copy is fetched asynchronously and
 * swapped in when it arrives. A stale snapshot degrades gracefully: an
 * unrecognized new edge range just means req.ip resolves to that edge for
 * requests it forwards (per-edge bucket) instead of the viewer — never a
 * spoofing hole.
 */
export const CLOUDFRONT_ORIGIN_FACING_SNAPSHOT: string[] = [
  "130.176.88.0/21", "54.239.134.0/23", "52.82.134.0/23", "130.176.86.0/23",
  "130.176.140.0/22", "130.176.0.0/18", "54.239.204.0/22", "130.176.160.0/19",
  "70.132.0.0/18", "15.158.0.0/16", "130.176.136.0/23", "54.239.170.0/23",
  "130.176.96.0/19", "54.182.184.0/22", "204.246.166.0/24", "130.176.64.0/21",
  "54.182.172.0/22", "205.251.218.0/24", "130.176.144.0/20", "54.182.176.0/21",
  "130.176.78.0/23", "54.182.248.0/22", "64.252.128.0/18", "54.182.154.0/23",
  "64.252.64.0/18", "54.182.144.0/21", "54.182.224.0/21", "130.176.128.0/21",
  "52.46.0.0/18", "3.172.64.0/18", "52.82.128.0/23", "18.68.0.0/16",
  "54.182.156.0/22", "54.182.160.0/21", "54.182.240.0/21", "130.176.192.0/19",
  "130.176.76.0/24", "54.239.208.0/21", "54.182.188.0/23", "24.110.128.0/17",
  "3.172.0.0/18", "130.176.80.0/22", "54.182.128.0/20", "130.176.72.0/22",
  "13.124.199.0/24", "3.29.57.0/26",
  "2600:9000:1000::/36", "2600:9000:5200::/40", "2600:9000:6000::/36",
];

const IP_RANGES_URL = "https://ip-ranges.amazonaws.com/ip-ranges.json";

function trustList(cloudfrontRanges: string[]): string[] {
  return ["loopback", "uniquelocal", ...cloudfrontRanges];
}

/**
 * Configure `trust proxy` for the runtime environment.
 *  - TRUST_PROXY_HOPS set (positive integer): emergency escape hatch — fixed
 *    hop count, e.g. if the proxy chain changes shape before code can ship.
 *  - ENV_NAME set (Elastic Beanstalk): address allowlist as documented above,
 *    with a non-blocking boot-time refresh of the CloudFront ranges.
 *  - Otherwise (workspace dev / hosted): a single local proxy hop.
 */
export function applyTrustProxy(app: Express): void {
  const envHops = Number(process.env["TRUST_PROXY_HOPS"]);
  if (Number.isInteger(envHops) && envHops > 0) {
    app.set("trust proxy", envHops);
    console.log(`[trust-proxy] fixed hop count = ${envHops} (TRUST_PROXY_HOPS override)`);
    return;
  }
  if (!process.env["ENV_NAME"]) {
    app.set("trust proxy", 1);
    console.log("[trust-proxy] trusted hops = 1 (workspace/hosted)");
    return;
  }
  app.set("trust proxy", trustList(CLOUDFRONT_ORIGIN_FACING_SNAPSHOT));
  console.log(
    `[trust-proxy] allowlist mode: loopback + uniquelocal + ${CLOUDFRONT_ORIGIN_FACING_SNAPSHOT.length} ` +
    `CloudFront origin-facing ranges (baked snapshot; live refresh in background)`,
  );
  // Boot-time refresh. Never blocks and never fails startup — the server must
  // come up (and pass ALB health checks) even if ip-ranges.json is unreachable.
  void refreshCloudFrontOriginRanges()
    .then((ranges) => {
      if (ranges) {
        app.set("trust proxy", trustList(ranges));
        console.log(`[trust-proxy] allowlist refreshed: ${ranges.length} CloudFront origin-facing ranges (live ip-ranges.json)`);
      } else {
        console.warn("[trust-proxy] live ip-ranges.json looked malformed — keeping baked snapshot");
      }
    })
    .catch((err: unknown) => {
      console.warn(`[trust-proxy] range refresh failed — keeping baked snapshot: ${err instanceof Error ? err.message : String(err)}`);
    });
}

async function refreshCloudFrontOriginRanges(): Promise<string[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(IP_RANGES_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`ip-ranges.json HTTP ${res.status}`);
    const body = (await res.json()) as {
      prefixes?: { service?: string; ip_prefix?: string }[];
      ipv6_prefixes?: { service?: string; ipv6_prefix?: string }[];
    };
    const v4 = (body.prefixes ?? [])
      .filter((p) => p.service === "CLOUDFRONT_ORIGIN_FACING" && typeof p.ip_prefix === "string")
      .map((p) => p.ip_prefix as string);
    const v6 = (body.ipv6_prefixes ?? [])
      .filter((p) => p.service === "CLOUDFRONT_ORIGIN_FACING" && typeof p.ipv6_prefix === "string")
      .map((p) => p.ipv6_prefix as string);
    const all = [...v4, ...v6];
    // Sanity floor: a suspiciously tiny list means a shape change or partial
    // response — keeping the baked snapshot is safer than trusting it.
    return all.length >= 10 ? all : null;
  } finally {
    clearTimeout(timer);
  }
}
