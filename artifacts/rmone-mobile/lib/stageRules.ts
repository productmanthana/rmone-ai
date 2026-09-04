/**
 * Mobile stage-rules singleton — minimal subset needed for the "Tip for your
 * team" guidance banner (#137) and admin-skipped stage filtering (#284).
 *
 * Mirrors the web's lib/stageRules.ts singleton pattern:
 *  • Tenant-level rules: module-level in-memory cache only (no AsyncStorage /
 *    disk) — cleared on every login/logout via resetStageRulesCache(). 60s
 *    throttle so admin edits mid-session propagate. Never overwrites last-
 *    known-good rules with an empty/failed response.
 *  • Per-record effective rules: separate cache keyed by recordId. The server
 *    returns either the record's own override doc or the tenant doc (whichever
 *    is effective). Skip evaluation MUST use this path — mirroring the web's
 *    fetchStageRulesFor(undefined, project.id) in useEffect.
 *  • guidanceFor() and skippedStagesFor() match case-insensitively (trim +
 *    lowercase) — identical semantics to the server and the web client.
 */

import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "./api";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type StageRuleModule = "PMM" | "OPM" | "LEM";

/**
 * One skip rule as received from the server — mirrors the web's StageSkipRule
 * interface (stageRules.ts). Group-exemption fields are preserved in the type
 * for forward-compatibility; skip evaluation ignores them on mobile today
 * (mobile has no group-membership tracking — the safe fail-closed default
 * matches the web when memberGroupIds is null/undefined).
 */
export interface StageSkipRule {
  module: StageRuleModule;
  field: string;
  value: string;
  skipStages: string[];
  exemptGroupIds?: string[];
  appliesToGroupIds?: string[];
}

/** Minimal local interface — only what the tip banner and skip filter need. */
interface StageRulesPayload {
  stageGuidance?: Partial<Record<StageRuleModule, Record<string, string>>>;
  stageSkips?: StageSkipRule[];
}

// ── Tenant-level singleton state ─────────────────────────────────────────────

let _rules: StageRulesPayload = {};
let _loadedAt = 0;          // 0 = never loaded this login
let _inFlight: Promise<void> | null = null;
let _seq = 0;               // increments on every auth transition — invalidates
                            // any in-flight fetches that started for an old
                            // tenant (mirrors the web's loadSeq guard)

const STALE_MS = 60_000;    // 60 s — same throttle as web

// ── Per-record effective rules cache ─────────────────────────────────────────
// Keyed by recordId (uppercase). Each entry holds the stageSkips from the
// EFFECTIVE rules doc for that record (its own override if one exists, or the
// tenant doc otherwise — the server decides, identical to the web's
// fetchStageRulesFor(undefined, recordId)). Cleared on auth transition.
interface RecCache { skips: StageSkipRule[]; loadedAt: number }
const _recCache = new Map<string, RecCache>();

/** Clear all caches on login/logout so the next mount fetches fresh for the
 *  new tenant. Call from the auth context on sign-in and sign-out. */
export function resetStageRulesCache(): void {
  _seq++;           // invalidate any in-flight fetch from the old tenant
  _rules = {};
  _loadedAt = 0;
  _inFlight = null;
  _recCache.clear();
}

// ── Network helpers ──────────────────────────────────────────────────────────

async function authHeader(): Promise<string> {
  const token = await AsyncStorage.getItem("rmone_token");
  return token ? `Bearer ${token}` : "";
}

// ── Tenant-level fetch ───────────────────────────────────────────────────────

/**
 * Fetch (or return cached) tenant-wide stage rules. Used by useGuidanceTip.
 * Throttled to once per 60 s; never throws; never overwrites last-known-good
 * rules with an empty/failed response.
 */
export function loadStageRules(): Promise<void> {
  if (_inFlight) return _inFlight;
  if (_loadedAt && Date.now() - _loadedAt < STALE_MS) return Promise.resolve();

  const seq = ++_seq;
  let p!: Promise<void>;
  p = (async () => {
    try {
      const base = getApiBase();
      const auth = await authHeader();
      if (seq !== _seq) return;
      const res = await fetch(`${base}/api/onboarding/stage-rules`, {
        headers: auth ? { Authorization: auth } : {},
      });
      if (seq !== _seq) return;
      if (!res.ok) return;
      const body = (await res.json()) as { rules?: StageRulesPayload };
      if (seq !== _seq) return;
      const incoming = body?.rules;
      const newGuidance = incoming?.stageGuidance;
      const newSkips = incoming?.stageSkips;
      const hasGuidance = newGuidance && Object.keys(newGuidance).length > 0;
      const hasSkips = Array.isArray(newSkips) && newSkips.length > 0;
      _rules = {
        stageGuidance: hasGuidance ? newGuidance : _rules.stageGuidance,
        stageSkips: hasSkips ? newSkips : _rules.stageSkips,
      };
      _loadedAt = Date.now();
    } catch {
      /* offline / transient — keep last-known rules, don't update loadedAt */
    } finally {
      if (_inFlight === p) _inFlight = null;
    }
  })();

  _inFlight = p;
  return p;
}

// ── Per-record effective rules fetch ─────────────────────────────────────────

/**
 * Fetch the EFFECTIVE stage-skip rules for one record.
 *
 * The server returns the record's own override doc when it has one, or falls
 * back to the company doc — exactly the same as the web's
 * fetchStageRulesFor(undefined, recordId). Skip evaluation MUST use this path
 * so that per-record forked rule sets hide the right stages (mirrors the web's
 * stageRuleInfo: rules = recDoc ?? companyRules).
 *
 * Results are cached per-recordId for STALE_MS (60 s). Silently falls back to
 * the last-known value on network errors; falls back to [] on the first load.
 */
async function loadRecordSkips(
  recordId: string,
  seqAtStart: number,
): Promise<StageSkipRule[]> {
  const key = recordId.trim().toUpperCase();
  const cached = _recCache.get(key);
  if (cached && Date.now() - cached.loadedAt < STALE_MS) return cached.skips;

  try {
    const base = getApiBase();
    const auth = await authHeader();
    if (_seq !== seqAtStart) return cached?.skips ?? [];
    const url = `${base}/api/onboarding/stage-rules?recordId=${encodeURIComponent(key)}`;
    const res = await fetch(url, { headers: auth ? { Authorization: auth } : {} });
    if (_seq !== seqAtStart) return cached?.skips ?? [];
    if (!res.ok) return cached?.skips ?? [];
    const body = (await res.json()) as { rules?: StageRulesPayload };
    if (_seq !== seqAtStart) return cached?.skips ?? [];
    const skips = Array.isArray(body?.rules?.stageSkips) ? (body.rules!.stageSkips as StageSkipRule[]) : [];
    _recCache.set(key, { skips, loadedAt: Date.now() });
    return skips;
  } catch {
    return cached?.skips ?? [];
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * The admin-written tip for `stage` in `module`, or null.
 * Case-insensitive: tips are stored with lowercased keys.
 */
export function guidanceFor(
  rules: StageRulesPayload,
  mod: StageRuleModule,
  stage: string | null | undefined,
): string | null {
  const s = (stage ?? "").trim().toLowerCase();
  if (!s) return null;
  return rules.stageGuidance?.[mod]?.[s] ?? null;
}

const _norm = (s: string) => s.trim().toLowerCase();

/**
 * Resolve the displayed value for a skip-rule field from rawFields, using the
 * same display-chain priority the web's condFieldValues uses. Returns the first
 * non-empty value in the chain, or "" (no match possible for blank chains).
 * Mirrors web project-detail.tsx ~line 8648.
 */
function resolveFieldValue(
  field: string,
  rawFields: Record<string, unknown>,
): string {
  const fl = field.trim().toLowerCase();
  const chain: string[] | null =
    fl.includes("businessunit") ? ["CRMBusinessUnitChoice", "BusinessUnit", "BusinessUnitName"]
    : fl.includes("sector")      ? ["SectorChoice", "Sector", "MarketSector"]
    : fl.includes("division")    ? ["CompanyDivisionsTitle", "DivisionName", "Division", "DivTitle"]
    : fl.includes("department")  ? ["DepartmentName", "Department"]
    : fl.includes("projecttype") ? ["ProjectType", "ProjectTypeChoice", "CRMProjectTypeChoice"]
    : fl.includes("servicetype") ? ["ServiceType", "ServiceTypeChoice", "ServiceTypeText"]
    : null;
  if (chain) {
    for (const col of chain) {
      const v = String(rawFields[col] ?? "").trim();
      if (v) return v;
    }
    return "";
  }
  return String(rawFields[field] ?? "").trim();
}

/**
 * Compute the set of lowercased stage names that should be hidden for this
 * record. Mirrors the web's skippedStagesFor() (stageRules.ts ~440).
 *
 * Mobile has no group tracking, so group-scope rules (exemptGroupIds /
 * appliesToGroupIds) are ignored — skips apply to everyone, which is the
 * fail-closed default matching the web's behavior when memberGroupIds is null.
 */
export function skippedStagesFor(
  skips: StageSkipRule[],
  module: StageRuleModule,
  rawFields: Record<string, unknown>,
): Set<string> {
  const out = new Set<string>();
  for (const rule of skips) {
    if (rule.module !== module) continue;
    const fieldVal = resolveFieldValue(rule.field, rawFields);
    if (_norm(fieldVal) !== _norm(rule.value)) continue;
    for (const s of rule.skipStages) out.add(_norm(s));
  }
  return out;
}

// ── React hooks ───────────────────────────────────────────────────────────────

/**
 * Returns the admin-authored tip for the record's current stage, or null
 * while loading / when no tip is configured.
 */
export function useGuidanceTip(
  module: string | null | undefined,
  currentStage: string | null | undefined,
): string | null {
  const [tip, setTip] = useState<string | null>(null);

  useEffect(() => {
    const mod = module as StageRuleModule | undefined;
    if (mod !== "PMM" && mod !== "OPM" && mod !== "LEM") {
      setTip(null);
      return;
    }

    let alive = true;

    loadStageRules().then(() => {
      if (!alive) return;
      setTip(guidanceFor(_rules, mod, currentStage));
    }).catch(() => {
      if (alive) setTip(null);
    });

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, currentStage]);

  return tip;
}

/**
 * Returns the set of lowercased stage names that should be hidden in the
 * status picker for the given record, based on admin-configured skip rules.
 *
 * Fetches the EFFECTIVE rules for the specific record (the server returns the
 * record's own override doc when one exists, or the company doc otherwise) —
 * mirroring the web's fetchStageRulesFor(undefined, project.id) path so that
 * per-record forked rule sets are honoured. Results are cached per-recordId
 * for 60 s; the cache is cleared on auth transitions.
 *
 * Always returns an empty set for non-PMM/OPM/LEM modules (COM, CON, …)
 * and while the rules are still loading (showing all options = safe open).
 */
export function useSkippedStages(
  module: string | null | undefined,
  rawFields: Record<string, unknown> | null | undefined,
  recordId: string | null | undefined,
): Set<string> {
  const [skips, setSkips] = useState<StageSkipRule[]>([]);

  useEffect(() => {
    const mod = module as StageRuleModule | undefined;
    if (mod !== "PMM" && mod !== "OPM" && mod !== "LEM" || !recordId) {
      setSkips([]);
      return;
    }

    let alive = true;
    const seqAtStart = _seq;

    loadRecordSkips(recordId, seqAtStart).then((s) => {
      if (alive) setSkips(s);
    }).catch(() => {
      if (alive) setSkips([]);
    });

    return () => { alive = false; };
    // recordId changes on record→record navigation (component reuse) — include
    // it so the hook re-fetches for the new record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, recordId]);

  return useMemo(() => {
    const mod = module as StageRuleModule | undefined;
    if (mod !== "PMM" && mod !== "OPM" && mod !== "LEM") return new Set<string>();
    if (!rawFields) return new Set<string>();
    if (skips.length === 0) return new Set<string>();
    return skippedStagesFor(skips, mod, rawFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skips, module, rawFields]);
}
