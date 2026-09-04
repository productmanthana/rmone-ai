/**
 * SPA module-visit beacon (#482). Maps the wouter route to a stable module
 * name and posts it to the usage telemetry layer — fire-and-forget, debounced,
 * skipped when logged out. The server stamps tenant/user/role from the JWT.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { sendUsageBeacon } from "./api";
import { useAuth } from "./useAuth";

/* The canonical module list (KNOWN_MODULES) lives in analyticsUsage.ts so
 * the pure builder — and the honesty check script — can use it without
 * pulling router/auth imports. Keep RULES below in lockstep with it. */

const RULES: [RegExp, string][] = [
  [/^\/$/, "Home"],
  [/^\/superadmin/, "Superadmin"],
  [/^\/analytics-center/, "AnalyticsCenter"],
  [/^\/analytics/, "Reports"],
  [/^\/projects/, "Projects"],
  [/^\/(project|opportunity|lead|staff)\/create/, "CreateRecord"],
  [/^\/project\//, "ProjectDetail"],
  [/^\/resources/, "Resources"],
  [/^\/forecast/, "Forecast"],
  [/^\/chat/, "Chat"],
  [/^\/intelligence/, "IntelligenceHub"],
  [/^\/alerts/, "Alerts"],
  [/^\/profile/, "Profile"],
  [/^\/(rate-card|billing-rates)/, "BillingRates"],
  [/^\/(import|onboarding|data-cleaning)/, "DataImport"],
  [/^\/configuration/, "Settings"],
  [/^\/system-health/, "SystemHealth"],
  [/^\/(briefing|daily-briefing)/, "DailyBriefing"],
];

export function moduleForPath(path: string): string | null {
  const p = (path || "/").split("?")[0];
  for (const [re, name] of RULES) if (re.test(p)) return name;
  // Unknown route: report the first segment so new pages still register
  // (PascalCase-ish, sanitized to the server's accepted charset).
  const seg = p.split("/").filter(Boolean)[0];
  if (!seg) return null;
  const clean = seg.replace(/[^A-Za-z0-9_-]/g, "");
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : null;
}

const DEDUPE_MS = 30_000;

/**
 * Extract a record / page context from the current route path.
 * Returns the ticket ID for detail pages (e.g. "/project/PMM-001" → "PMM-001"),
 * or the meaningful path segment for other sub-pages, or "" when no specific
 * context is available (e.g. list pages, home).
 */
export function contextForPath(path: string): string {
  const p = (path || "/").split("?")[0];
  // Record detail pages: /project/:id, /opportunity/:id, /lead/:id, /staff/:id
  const detailMatch = p.match(/^\/(project|opportunity|lead|staff)\/([^/]+)/);
  if (detailMatch) return detailMatch[2] ?? "";
  return "";
}

/** Rendered once inside the authenticated tree. Renders nothing. */
export function UsageBeaconTracker(): null {
  const [location] = useLocation();
  const { user } = useAuth();
  const last = useRef<{ mod: string; ctx: string; at: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    const mod = moduleForPath(location);
    if (!mod) return;
    const ctx = contextForPath(location);
    const now = Date.now();
    // Dedupe: same module AND same context within the window
    if (last.current && last.current.mod === mod && last.current.ctx === ctx && now - last.current.at < DEDUPE_MS) return;
    last.current = { mod, ctx, at: now };
    sendUsageBeacon(mod, ctx);
  }, [location, user]);

  return null;
}
