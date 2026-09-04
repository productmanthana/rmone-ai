/**
 * Employment-type name colors (client mandate, mirrors the web helper):
 *   Part-Time       → blue,   As Needed → purple,   SCA Contingency → orange,
 *   Full-Time / Temporary → no color (names render exactly as before).
 *
 * The hex values are ADMIN-TUNABLE per tenant on the web Settings page and
 * live in the onboarding-settings "effective" layer. This module keeps a tiny
 * singleton of just the five color keys: screens read synchronously through
 * empTypeColor() and subscribe via useEmpColorsVersion() so names re-tint
 * once the async fetch lands. "" = explicit "no color" (render normally).
 */
import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBase } from "./api";

export type EmpTypeKey =
  | "empColorPartTime"
  | "empColorAsNeeded"
  | "empColorScaContingency"
  | "empColorTemporary"
  | "empColorFullTime";

/** Built-in defaults — used until the fetch resolves (and if it ever fails). */
const BUILTIN: Record<EmpTypeKey, string> = {
  empColorPartTime: "#3B82F6",
  empColorAsNeeded: "#A855F7",
  empColorScaContingency: "#F97316",
  empColorTemporary: "",
  empColorFullTime: "",
};

let colors: Record<EmpTypeKey, string> = { ...BUILTIN };
let version = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((cb) => cb());

// Tenant the current colors were loaded for + when — the hook re-checks so a
// tenant switch (logout/login) picks up the new tenant's palette.
let loadedTenant: string | null = null;
let loadedAt = 0;
let inFlight: Promise<void> | null = null;
const TTL_MS = 5 * 60_000;

/** Hex color or "" (explicit "no color"); anything else falls back. */
function pickColor(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (s === "") return "";
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback;
}

/** Force-refresh from the server (call after login / tenant switch). */
export function loadEmpColors(): Promise<void> {
  if (inFlight) return inFlight;
  const p = (async () => {
    const [token, tenant] = await Promise.all([
      AsyncStorage.getItem("rmone_token"),
      AsyncStorage.getItem("rmone_tenant"),
    ]);
    const base = getApiBase();
    let effective: Record<string, unknown> | null = null;
    // Tenant-scoped effective layer first; upstream sessions the server can't
    // verify fall back to the open global layer (mirrors web businessRules).
    if (token && tenant) {
      try {
        const r = await fetch(
          `${base}/api/onboarding/settings?tenantId=${encodeURIComponent(tenant)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (r.ok) effective = ((await r.json())?.effective ?? null) as Record<string, unknown> | null;
      } catch { /* fall through to global */ }
    }
    if (!effective) {
      try {
        const g = await fetch(`${base}/api/onboarding/settings`);
        if (g.ok) effective = ((await g.json())?.effective ?? null) as Record<string, unknown> | null;
      } catch { /* keep previous values */ }
    }
    loadedTenant = tenant ?? "";
    loadedAt = Date.now();
    if (!effective) return;
    const next: Record<EmpTypeKey, string> = {
      empColorPartTime: pickColor(effective.empColorPartTime, BUILTIN.empColorPartTime),
      empColorAsNeeded: pickColor(effective.empColorAsNeeded, BUILTIN.empColorAsNeeded),
      empColorScaContingency: pickColor(effective.empColorScaContingency, BUILTIN.empColorScaContingency),
      empColorTemporary: pickColor(effective.empColorTemporary, BUILTIN.empColorTemporary),
      empColorFullTime: pickColor(effective.empColorFullTime, BUILTIN.empColorFullTime),
    };
    if (JSON.stringify(next) !== JSON.stringify(colors)) {
      colors = next;
      version++;
      notify();
    }
  })().finally(() => { inFlight = null; });
  inFlight = p;
  return p;
}

/** Fire-and-forget: refresh when stale or the tenant changed. */
async function ensureFresh(): Promise<void> {
  if (inFlight) return;
  const tenant = (await AsyncStorage.getItem("rmone_tenant")) ?? "";
  if (loadedTenant === tenant && Date.now() - loadedAt < TTL_MS) return;
  void loadEmpColors();
}

/** Normalize an employee-type label for matching: lowercase, letters only. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Map a raw employee-type label to its settings key (null = unknown type). */
export function empTypeKey(type?: string | null): EmpTypeKey | null {
  if (!type) return null;
  const k = norm(type);
  if (!k) return null;
  if (k.includes("sca") || k.includes("contingen")) return "empColorScaContingency";
  if (k.includes("part")) return "empColorPartTime";
  if (k.includes("needed") || k === "asneeded") return "empColorAsNeeded";
  if (k.includes("temp")) return "empColorTemporary";
  if (k.includes("full")) return "empColorFullTime";
  return null;
}

/**
 * Color for a person's employee type, or null when the name should render
 * normally (Full-Time, Temporary, unknown, blank — or admin set "no color").
 */
export function empTypeColor(type?: string | null): string | null {
  const key = empTypeKey(type);
  if (!key) return null;
  const c = colors[key];
  return c && c.trim() ? c : null;
}

/** Legend entries for the types that currently HAVE a color. */
export function empTypeLegend(): { label: string; color: string }[] {
  const rows: { label: string; key: EmpTypeKey }[] = [
    { label: "Part-Time", key: "empColorPartTime" },
    { label: "As Needed", key: "empColorAsNeeded" },
    { label: "SCA Contingency", key: "empColorScaContingency" },
    { label: "Temporary", key: "empColorTemporary" },
    { label: "Full-Time", key: "empColorFullTime" },
  ];
  return rows.filter((x) => colors[x.key].trim()).map((x) => ({ label: x.label, color: colors[x.key] }));
}

/**
 * Subscribe a screen to color changes; also kicks a (throttled) background
 * refresh so the first colored surface a user opens loads the palette.
 */
export function useEmpColorsVersion(): number {
  useEffect(() => { void ensureFresh(); }, []);
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
    () => version,
  );
}
