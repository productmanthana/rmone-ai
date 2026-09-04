import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import OpenAI from "openai";
import { openai } from "../lib/openai-client.js";
import { isValidSessionToken } from "./rmone-proxy.js";
import { getBusinessRules } from "../lib/business-rules.js";
import type { OnboardingDefaults } from "../lib/onboarding-defaults.js";
import {
  getInsightsWithStale,
  putInsights,
  invalidateInsight,
  invalidateKind,
  pruneExpired,
  tryAcquireRefreshLocks,
  type InsightWriteEntry,
} from "../lib/insightsCache.js";

const router: IRouter = Router();

type Severity = "red" | "amber" | "green";
type Kind = "project" | "opportunity" | "lead" | "staff" | "demand";

interface IncomingRecord {
  id: string;
  fields: Record<string, unknown>;
}
interface InsightOut {
  severity: Severity;
  text: string;
}

const TTL_MS = 24 * 60 * 60 * 1000;
// Stale-while-revalidate grace window: rows whose `expiresAt` is in the past
// but no further than this many ms beyond it are still served immediately,
// while a background refresh writes a new row. Beyond the window, the row is
// treated as a true miss and we regenerate synchronously.
//
// Tunable at runtime via INSIGHTS_STALE_GRACE_DAYS (defaults to 7). Setting
// it to 0 reverts to the pre-SWR behavior (every expired row is a true miss).
const STALE_GRACE_MS: number = (() => {
  const raw = process.env.INSIGHTS_STALE_GRACE_DAYS;
  const days = raw == null || raw.trim() === "" ? 7 : Number(raw);
  // Reject NaN, negatives, and non-finite values so a typo can't accidentally
  // disable the grace window or push it to absurd lengths.
  const safe = Number.isFinite(days) && days >= 0 ? days : 7;
  return safe * 24 * 60 * 60 * 1000;
})();
const MAX_TEXT = 240;
const BATCH_SIZE = 20;
const MAX_RECORDS_PER_REQUEST = 60;

// Best-effort housekeeping: sweep expired rows at most once an hour so the
// cache table doesn't accumulate stale entries indefinitely.
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let _lastPruneAt = 0;
function maybePrune(): void {
  const now = Date.now();
  if (now - _lastPruneAt < PRUNE_INTERVAL_MS) return;
  _lastPruneAt = now;
  void pruneExpired().then(n => {
    if (n > 0) console.log(`[card-insights] pruned ${n} expired cache rows`);
  });
}

function hashFields(kind: Kind, id: string, fields: Record<string, unknown>): string {
  const json = JSON.stringify({ kind, id, fields });
  return crypto.createHash("sha1").update(json).digest("hex").slice(0, 16);
}

// Cached insight outputs depend not only on the record's fields but, for some
// kinds, on the admin-tuned business rules (severity bands + prompt thresholds).
// We fold a short fingerprint of ONLY the rules that affect this kind into the
// cache key so that changing a rule globally produces fresh keys (old rows fall
// out naturally via TTL) instead of serving stale, pre-change insights for 24h.
// Kinds whose prompt/severity never reference business rules (project, lead)
// return "" so their existing cache keys stay stable.
function ruleFingerprint(kind: Kind, rules: OnboardingDefaults): string {
  let relevant: Record<string, number> | null = null;
  if (kind === "staff") {
    relevant = {
      o: rules.overCapacityPct,
      u: rules.underAllocatedPct,
      c: rules.concentrationPct,
      t: rules.targetUtilizationPct,
    };
  } else if (kind === "demand") {
    relevant = { d: rules.demandUrgencyDays };
  } else if (kind === "opportunity") {
    relevant = { p: rules.proposalCoveragePct };
  }
  if (!relevant) return "";
  return crypto.createHash("sha1").update(JSON.stringify(relevant)).digest("hex").slice(0, 8);
}

function clampText(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + "…" : t;
}

function normSeverity(s: unknown): Severity {
  const v = String(s ?? "").toLowerCase();
  if (v === "red" || v === "high" || v === "critical") return "red";
  if (v === "amber" || v === "yellow" || v === "medium" || v === "warn" || v === "warning") return "amber";
  return "green";
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Compute the severity for a staff record deterministically from its fields.
 * The model's text is still useful as commentary, but its severity choice has
 * proven unreliable (e.g. classifying "100% on a single project" as green
 * even though the prompt rules call that an amber concentration risk). The
 * rules here mirror the SYSTEM_PROMPTS.staff text exactly so the badge always
 * agrees with the explanation underneath it.
 *
 * Rule precedence (first match wins):
 *   1. red   – severe over-capacity (>110%) or idle bench with prior history
 *   2. amber – under-allocated 1–60%
 *   3. amber – mildly over-allocated 101–110% (between green ceiling and red floor)
 *   4. amber – single active project carrying >80% (concentration risk)
 *   5. green – everything else (healthy 61–100% balanced, 0% with no history, etc.)
 */
function computeStaffSeverity(fields: Record<string, unknown>, rules: OnboardingDefaults): Severity {
  const pct = num(fields.currentAllocPct) ?? 0;
  const activeCount = num(fields.activeProjectCount) ?? 0;
  const totalProjects = num(fields.totalProjects) ?? 0;
  const over    = rules.overCapacityPct;     // red above this
  const under   = rules.underAllocatedPct;   // amber at/below this (and > 0)
  const concent = rules.concentrationPct;    // single-project carry risk
  if (pct > over) return "red";
  if (pct === 0 && totalProjects > 0) return "red";
  if (pct >= 1 && pct <= under) return "amber";
  if (pct > 100) return "amber";
  if (activeCount <= 1 && pct > concent) return "amber";
  return "green";
}

function computeSeverity(kind: Kind, fields: Record<string, unknown>, rules: OnboardingDefaults): Severity | null {
  if (kind === "staff") return computeStaffSeverity(fields, rules);
  return null;
}

const SYSTEM_PROMPTS: Record<"project" | "lead", string> = {
  project: [
    "You write boardroom-grade insights about active construction/engineering PROJECTS for an executive (CEO/COO) and the assigned PM.",
    "Output ONE punchy insight (≤ 220 chars, 1–2 sentences) that combines (a) the BUSINESS IMPACT (revenue at risk, margin, cash, client relationship) AND (b) a concrete OWNER ACTION this week (who to staff, who to call, what to rebaseline).",
    "AVAILABLE DATA: You receive name, phase, status, valueUSD, forecastCostUSD, laborContractUSD, sector, division, city, teamCount, staffingDemandCount, staffingAvgPct, staffingFTE, staffingTopRoles, daysInCurrentPhase, scheduleStatus, target/actual dates, closed.",
    "USE THE DATA: Reference specific numbers — e.g. 'With 0 FTE demand on a $2M active project, lock staffing before margins erode' or 'Phase 1 for 120 days on a $500K job — confirm phase gate or escalate stall'. Compare forecastCost vs valueUSD for margin risk. Use sector/city for market context. Use staffing fields to flag under/over-allocation.",
    "SCHEDULE INTERPRETATION (critical):",
    "  scheduleStatus='target_only' means the schedule has NOT been updated with actuals yet — only planned/target dates exist. Do NOT flag schedule slippage. Instead flag that the schedule needs to be baselined/updated with actual dates, or focus on other project risks (staffing, value, phase).",
    "  scheduleStatus='actual' means the schedule HAS been updated — actual dates are tracked. Focus on other project issues: staffing gaps, value risks, phase progression, team composition. Do NOT flag schedule slippage since the schedule is actively managed.",
    "  scheduleStatus='none' means no dates at all — flag that the project needs a schedule.",
    "Severity rules:",
    "  red   = no schedule when phase requires one, zero staffing demand (0 FTE) on an active phase, forecastCost > valueUSD (margin blown), or daysInCurrentPhase > 90 on a small project.",
    "  amber = recently won but team not yet staffed, staffingAvgPct < 50% (under-allocated), schedule not yet baselined (target_only on an active phase), or missing value on a later-stage phase.",
    "  green = phase, schedule, value, and staffing all consistent — but still surface the ONE thing the PM should protect this week based on the specific data.",
    "Style: speak like a sharp chief of staff. Use verbs (lock, staff, escalate, rebaseline, protect). NEVER give generic advice — always ground the insight in the specific record data. NEVER restate numbers already on the card. NEVER say 'no data' — use what you have.",
  ].join(" "),
  lead: [
    "You write boardroom-grade insights about early-stage LEADS for an executive (CRO) and the BD owner.",
    "Output ONE punchy insight (≤ 220 chars, 1–2 sentences) that combines (a) the STRATEGIC FIT (sector, geography, deal size relative to our book) AND (b) a concrete OWNER ACTION this week (send qualifier, book discovery, route to a partner, kill it).",
    "Severity rules:",
    "  red   = no activity > 45 days, due date passed, or value missing on a strategically important sector.",
    "  amber = stale 14–45 days, missing close target, or weak sector fit.",
    "  green = recently created or touched — call out the ONE qualifier that confirms it's worth pursuing.",
    "Style: BD owner voice. Verbs: qualify, route, kill, advance, schedule. NEVER restate dates already on the card. NEVER say 'no data' — infer from sector/value/age what the BD owner should do next.",
  ].join(" "),
};

// Staff & demand prompts carry the admin-tuned thresholds inline so the model's
// commentary always agrees with the configured severity bands (and, for demand,
// the model's severity choice — which we keep — uses the same numbers).
function staffPrompt(r: OnboardingDefaults): string {
  return [
    "You analyze a single RESOURCE / STAFF member's allocation for a resource manager.",
    "For each record, output ONE gap-focused insight (1–2 short sentences, ≤ 240 chars).",
    `The target ('sweet spot') utilization for a fully-productive person is ${r.targetUtilizationPct}% — steer recommendations toward bringing each person near it.`,
    "Severity rules:",
    `  red   = current allocation > ${r.overCapacityPct}% (over-capacity) OR 0% with active project history (idle bench).`,
    `  amber = under-allocated 1–${r.underAllocatedPct}%, or single project carrying > ${r.concentrationPct}% (concentration risk).`,
    `  green = balanced ${r.underAllocatedPct + 1}–100% across multiple projects.`,
    "Recommend a concrete next move (e.g. 'shift 20% to a pursuit', 'protect Q2 capacity'). Don't restate the % already on the card.",
  ].join(" ");
}

function oppPrompt(r: OnboardingDefaults): string {
  return [
    "You write boardroom-grade insights about sales OPPORTUNITIES (pursuits) for an executive (CEO/CRO) and the pursuit lead.",
    "Output ONE punchy insight (≤ 220 chars, 1–2 sentences) that combines (a) the PIPELINE IMPACT (weighted revenue, win odds, slip risk) AND (b) a concrete OWNER ACTION this week (qualify, lock pursuit lead, escalate to client champion, walk away).",
    `Portfolio context: our firm aims to keep the sales pipeline at least ${r.proposalCoveragePct}% of the active project portfolio value — weigh how much this pursuit helps reach (or protect) that coverage goal.`,
    "Severity rules:",
    "  red   = bid due ≤ 5 days with low probability, weighted value collapsing, or no pursuit lead on a high-$ deal.",
    "  amber = bid in 6–20 days, mid probability, or unstaffed pursuit team.",
    "  green = healthy probability with a comfortable bid window — call out the ONE move that locks the win.",
    "Style: sharp BD voice. Verbs: qualify, lock, escalate, walk, protect. NEVER restate the % or $ already on the card. NEVER say 'no data' — infer from stage and bid window what the pursuit lead must do next.",
  ].join(" ");
}

function demandPrompt(r: OnboardingDefaults): string {
  return [
    "You analyze open DEMAND (unfilled role requests) for a resource manager.",
    "For each record, output ONE gap-focused insight (1–2 short sentences, ≤ 240 chars).",
    "Severity rules:",
    `  red   = soft allocation OR start date inside ${r.demandUrgencyDays} days with no person assigned, OR > 50% allocation unfilled.`,
    `  amber = start in ${r.demandUrgencyDays + 1}–45 days unfilled, mid allocation %, or long duration role.`,
    "  green = comfortable lead time, low %, or temporary backfill.",
    "Recommend a concrete next move (e.g. 'pull from bench list', 'confirm soft → hard'). Don't restate role/percent already on the card.",
  ].join(" ");
}

function systemPromptFor(kind: Kind, rules: OnboardingDefaults): string {
  if (kind === "staff") return staffPrompt(rules);
  if (kind === "demand") return demandPrompt(rules);
  if (kind === "opportunity") return oppPrompt(rules);
  return SYSTEM_PROMPTS[kind];
}

const KINDS: ReadonlySet<Kind> = new Set<Kind>(["project", "opportunity", "lead", "staff", "demand"]);

function isKind(s: unknown): s is Kind {
  return typeof s === "string" && KINDS.has(s as Kind);
}

async function generateBatch(
  kind: Kind,
  batch: IncomingRecord[],
  rulesOverride?: OnboardingDefaults,
): Promise<Record<string, InsightOut>> {
  if (batch.length === 0) return {};
  const userPayload = batch.map(r => ({ id: r.id, ...r.fields }));
  // Prefer the caller's already-fetched rules so the generated prompt/severity
  // agree with the ruleSalt baked into the cache key for this request. The
  // background refresh path has no handler rules, so it falls back to the
  // (cached) global rules.
  const rules = rulesOverride ?? await getBusinessRules();
  const sys = systemPromptFor(kind, rules) +
    ' Return ONLY a JSON object: {"insights":[{"id":"<id>","severity":"red|amber|green","text":"..."}]}.' +
    " Use exactly the ids provided. No prose outside JSON.";

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: Math.min(120 * batch.length, 1500),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify({ records: userPayload }) },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { insights?: Array<{ id?: string; severity?: string; text?: string }> };
    const list = Array.isArray(parsed.insights) ? parsed.insights : [];
    const out: Record<string, InsightOut> = {};
    for (const item of list) {
      if (!item || typeof item.id !== "string") continue;
      // Prefer a deterministic, fields-derived severity for kinds where the
      // model is known to drift from the documented rules (e.g. staff). Fall
      // back to the model's choice for kinds that still rely on it.
      const matchRec = batch.find(b => b.id === item.id);
      const computed = matchRec ? computeSeverity(kind, matchRec.fields, rules) : null;
      out[item.id] = {
        severity: computed ?? normSeverity(item.severity),
        text: clampText(typeof item.text === "string" ? item.text : ""),
      };
    }
    return out;
  } catch (e) {
    console.log(`[card-insights] OpenAI batch failed for kind=${kind} size=${batch.length}: ${String(e).slice(0, 200)}`);
    return {};
  }
}

// Tracks cache keys with a background regeneration currently in flight in
// THIS process, so concurrent requests for the same stale row only trigger
// one OpenAI call instead of N. This set is process-local; cross-replica
// dedupe is layered on top via Postgres advisory locks (see
// `tryAcquireRefreshLocks`). Entries are removed after the regen settles.
const _inFlightRefreshKeys = new Set<string>();

interface PreparedRecord { record: IncomingRecord; key: string; fieldsHash: string }

/**
 * Fire-and-forget regeneration for stale records. Called after the response
 * has already been sent, so any error here only affects the next read — never
 * the user who triggered it.
 *
 * Dedupe happens in two layers so we don't waste OpenAI spend or race two
 * fresh writes against each other:
 *   1. In-process: `_inFlightRefreshKeys` collapses concurrent requests for
 *      the same stale row inside a single Node process.
 *   2. Cross-replica: a Postgres advisory lock per cache key ensures that
 *      when the API server runs with multiple replicas (or two pods overlap
 *      during a rolling deploy), only one of them actually regenerates each
 *      stale row. Replicas that lose the race drop the row from this batch;
 *      the winner's fresh write will satisfy the next read on either side.
 *
 * If the coordination backend is briefly unavailable (`degraded === true`)
 * we fall back to in-process-only dedupe so refreshes still happen — at
 * worst that's the pre-coordination behavior of one regen per replica.
 */
function scheduleBackgroundRefresh(
  kind: Kind,
  staleRecords: PreparedRecord[],
): void {
  if (staleRecords.length === 0) return;

  // First-pass in-process dedupe. We mark these as in-flight immediately so
  // any other request landing on this process while we await the advisory
  // lock won't queue a second background job for the same key.
  const candidates: PreparedRecord[] = [];
  for (const p of staleRecords) {
    if (_inFlightRefreshKeys.has(p.key)) continue;
    _inFlightRefreshKeys.add(p.key);
    candidates.push(p);
  }
  if (candidates.length === 0) return;

  // setImmediate keeps the regen completely off the request's critical path —
  // the response has already flushed by the time this runs.
  setImmediate(() => {
    void (async () => {
      const lock = await tryAcquireRefreshLocks(candidates.map(p => p.key));
      // When degraded, the coordination layer couldn't talk to Postgres at
      // all. Fall through and regenerate everything we held in-process —
      // duplicating work across replicas this round is still better than
      // serving stale data forever.
      const ownedKeys: Set<string> = lock.degraded
        ? new Set(candidates.map(p => p.key))
        : new Set(lock.acquired);
      const toRefresh = candidates.filter(p => ownedKeys.has(p.key));
      const skipped = candidates.length - toRefresh.length;
      if (skipped > 0) {
        console.log(
          `[card-insights] cross-replica lock skipped ${skipped}/${candidates.length} stale rows for kind=${kind} (already owned by another replica)`,
        );
      }

      try {
        if (toRefresh.length === 0) return;

        const batches: IncomingRecord[][] = [];
        for (let i = 0; i < toRefresh.length; i += BATCH_SIZE) {
          batches.push(toRefresh.slice(i, i + BATCH_SIZE).map(p => p.record));
        }
        const results = await Promise.all(batches.map(b => generateBatch(kind, b)));

        const writes: InsightWriteEntry[] = [];
        const byId = new Map(toRefresh.map(p => [p.record.id, p]));
        for (const map of results) {
          for (const [id, val] of Object.entries(map)) {
            const p = byId.get(id);
            if (!p) continue;
            if (!val.text) continue;
            writes.push({
              key: p.key,
              kind,
              recordId: id,
              fieldsHash: p.fieldsHash,
              value: val,
            });
          }
        }

        if (writes.length > 0) {
          try {
            await putInsights(writes, TTL_MS);
            console.log(`[card-insights] background refreshed ${writes.length} stale rows for kind=${kind}`);
          } catch (e) {
            console.log(`[card-insights] background cache write failed: ${String(e).slice(0, 200)}`);
          }
        }
      } catch (e) {
        console.log(`[card-insights] background refresh failed for kind=${kind}: ${String(e).slice(0, 200)}`);
      } finally {
        // Release advisory locks first so other replicas can pick up the
        // next round, then release in-process slots.
        try { await lock.release(); } catch { /* swallow */ }
        for (const p of candidates) _inFlightRefreshKeys.delete(p.key);
      }
    })();
  });
}

// Naive in-process rate limiter — caps cost-amplification abuse without taking
// a hard dependency on Redis. 60 requests / 60s per IP is comfortably above
// real card-scrolling traffic but well below a runaway abuser.
const RL_WINDOW_MS = 60_000;
const RL_LIMIT = 60;
const _rlBuckets = new Map<string, number[]>();
function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const arr = _rlBuckets.get(ip) ?? [];
  const fresh = arr.filter(ts => now - ts < RL_WINDOW_MS);
  if (fresh.length >= RL_LIMIT) {
    _rlBuckets.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  _rlBuckets.set(ip, fresh);
  return true;
}

router.post("/card-insights", async (req: Request, res: Response) => {
  try {
    // Require a bearer token that matches a live RM ONE session issued by
    // /api/rmone/token. This prevents anonymous callers from triggering paid
    // OpenAI usage with a guessed/fabricated bearer string.
    const auth = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    const token = m?.[1]?.trim() ?? "";
    console.log(`[card-insights] incoming kind=${(req.body as {kind?: string})?.kind} hasToken=${!!token} tokenPrefix=${token.slice(0, 12)}`);
    if (!token || !(await isValidSessionToken(token))) {
      console.log(`[card-insights] 401 — token rejected (prefix=${token.slice(0, 12)})`);
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }
    console.log(`[card-insights] token OK`);
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim()
      || req.socket.remoteAddress
      || "unknown";
    if (!rateLimitOk(ip)) {
      res.status(429).json({ error: "Too many insight requests, slow down." });
      return;
    }

    const body = req.body as { kind?: string; records?: IncomingRecord[] };
    const kind = body.kind as Kind;
    if (!isKind(kind)) {
      res.status(400).json({ error: "Invalid kind" });
      return;
    }
    const records = Array.isArray(body.records) ? body.records.slice(0, MAX_RECORDS_PER_REQUEST) : [];
    if (records.length === 0) {
      res.json({ insights: {} });
      return;
    }

    maybePrune();

    // Fetch the admin-tuned rules once so rule-dependent kinds can fold a
    // fingerprint into their cache key (see ruleFingerprint). getBusinessRules
    // is cached (~30s) and invalidated on a global settings save, so a global
    // rule change yields fresh keys here within seconds — no 24h stale window.
    const rules = await getBusinessRules();
    const ruleSalt = ruleFingerprint(kind, rules);

    const out: Record<string, InsightOut> = {};
    const prepared = new Map<string, PreparedRecord>(); // id -> prepared

    for (const r of records) {
      if (!r || typeof r.id !== "string" || !r.fields) continue;
      const fieldsHash = hashFields(kind, r.id, r.fields);
      // Key intentionally embeds fieldsHash so that any change to the
      // record's fields naturally invalidates the cached row. We carry
      // fieldsHash separately too — never re-parse it from the key,
      // since record ids may legitimately contain colons. The ruleSalt
      // suffix (empty for project/lead) busts the key when an admin changes
      // a business rule this kind depends on.
      const key = ruleSalt
        ? `${kind}:${r.id}:${fieldsHash}:${ruleSalt}`
        : `${kind}:${r.id}:${fieldsHash}`;
      prepared.set(r.id, { record: r, key, fieldsHash });
    }

    let cacheHits = 0;
    let staleHits = 0;
    // Records that returned a stale-but-within-grace cached value. We serve
    // them in this response and queue a background refresh after `res.json`
    // so the next user sees a fresh row without anyone paying the OpenAI
    // latency cost on the critical path.
    const staleToRefresh: PreparedRecord[] = [];
    try {
      const keys = Array.from(prepared.values()).map(p => p.key);
      const { fresh, stale } = await getInsightsWithStale(keys, STALE_GRACE_MS);
      for (const p of prepared.values()) {
        const freshHit = fresh.get(p.key);
        if (freshHit) {
          out[p.record.id] = freshHit;
          cacheHits++;
          continue;
        }
        const staleHit = stale.get(p.key);
        if (staleHit) {
          out[p.record.id] = staleHit;
          staleHits++;
          staleToRefresh.push(p);
        }
      }
    } catch (e) {
      // If the cache is briefly unavailable, fall through and regenerate
      // rather than failing the whole request.
      console.log(`[card-insights] cache read failed: ${String(e).slice(0, 200)}`);
    }

    const misses: IncomingRecord[] = [];
    for (const { record } of prepared.values()) {
      if (!out[record.id]) misses.push(record);
    }

    if (misses.length === 0) {
      console.log(`[card-insights] kind=${kind} req=${records.length} hits=${cacheHits} stale=${staleHits} generated=0`);
      res.json({ insights: out, cacheHits, staleHits, generated: 0 });
      // Kick off the background refresh AFTER responding so the user never
      // waits on it.
      scheduleBackgroundRefresh(kind, staleToRefresh);
      return;
    }

    const batches: IncomingRecord[][] = [];
    for (let i = 0; i < misses.length; i += BATCH_SIZE) {
      batches.push(misses.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.all(batches.map(b => generateBatch(kind, b, rules)));
    let generated = 0;
    const writes: InsightWriteEntry[] = [];
    for (const map of results) {
      for (const [id, val] of Object.entries(map)) {
        const p = prepared.get(id);
        if (!p) continue;
        if (!val.text) continue;
        writes.push({
          key: p.key,
          kind,
          recordId: id,
          fieldsHash: p.fieldsHash,
          value: val,
        });
        out[id] = val;
        generated++;
      }
    }

    if (writes.length > 0) {
      try {
        await putInsights(writes, TTL_MS);
      } catch (e) {
        console.log(`[card-insights] cache write failed: ${String(e).slice(0, 200)}`);
      }
    }

    // Retry pass: any miss the model dropped from its batch JSON gets one
    // more chance in single-record batches. Models occasionally truncate
    // long batches; a per-record call almost always succeeds and prevents
    // permanent "—" placeholders from polluting the cache.
    const stillMissing = misses.filter(r => !out[r.id]);
    if (stillMissing.length > 0) {
      const retryResults = await Promise.all(
        stillMissing.map(r => generateBatch(kind, [r], rules)),
      );
      const retryWrites: InsightWriteEntry[] = [];
      for (const map of retryResults) {
        for (const [id, val] of Object.entries(map)) {
          const p = prepared.get(id);
          if (!p || !val.text) continue;
          const entry: InsightWriteEntry = {
            key: p.key, kind, recordId: id, fieldsHash: p.fieldsHash, value: val,
          };
          retryWrites.push(entry);
          out[id] = val;
          generated++;
        }
      }
      if (retryWrites.length > 0) {
        try { await putInsights(retryWrites, TTL_MS); } catch (e) {
          console.log(`[card-insights] retry cache write failed: ${String(e).slice(0, 200)}`);
        }
      }
    }

    // Anything still missing after the retry: emit a kind-specific fallback
    // line so the executive/PM never sees an empty bullet. We cache the
    // fallback with a short TTL (1h) so a record the model consistently
    // chokes on doesn't trigger TWO OpenAI calls (batch + retry) on every
    // page load — but the row still refreshes within an hour to give the
    // model another chance once context might have changed.
    const FALLBACK: Record<Kind, string> = {
      project: "Confirm phase, schedule and lead PM are locked in this week.",
      opportunity: "Lock the pursuit lead and confirm the next client touch this week.",
      lead: "Send a qualifier and decide pursue / route / kill within 5 days.",
      staff: "Review allocation and confirm the next assignment this week.",
      demand: "Assign an owner and confirm the start date this week.",
    };
    const FALLBACK_TTL_MS = 60 * 60 * 1000; // 1 hour
    const fallbackWrites: InsightWriteEntry[] = [];
    for (const r of misses) {
      if (!out[r.id]) {
        const val: InsightOut = { severity: "amber", text: FALLBACK[kind] };
        out[r.id] = val;
        const p = prepared.get(r.id);
        if (p) {
          fallbackWrites.push({
            key: p.key, kind, recordId: r.id, fieldsHash: p.fieldsHash, value: val,
          });
        }
      }
    }
    if (fallbackWrites.length > 0) {
      try { await putInsights(fallbackWrites, FALLBACK_TTL_MS); } catch (e) {
        console.log(`[card-insights] fallback cache write failed: ${String(e).slice(0, 200)}`);
      }
    }

    console.log(`[card-insights] kind=${kind} req=${records.length} hits=${cacheHits} stale=${staleHits} generated=${generated}`);
    res.json({ insights: out, cacheHits, staleHits, generated });
    // Refresh any stale rows after the response is sent so the next user
    // sees a fresh value without anyone waiting on OpenAI.
    scheduleBackgroundRefresh(kind, staleToRefresh);
  } catch (e) {
    console.log(`[card-insights] error: ${String(e)}`);
    res.status(500).json({ error: "Internal error" });
  }
});

// --- Admin cache invalidation -------------------------------------------------
//
// Authenticates with the INSIGHTS_ADMIN_TOKEN env var (separate from user
// session tokens, since this affects every user's cached output). Constant-time
// comparison avoids leaking the token via timing.
function adminAuthOk(req: Request): boolean {
  const expected = process.env.INSIGHTS_ADMIN_TOKEN ?? "";
  if (!expected) return false;
  const auth = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const provided = m?.[1]?.trim() ?? "";
  if (!provided || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

router.delete("/card-insights/cache/:kind/:id", async (req: Request, res: Response) => {
  if (!adminAuthOk(req)) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  const kind = String(req.params.kind ?? "");
  const id = String(req.params.id ?? "");
  if (!isKind(kind) || !id) {
    res.status(400).json({ error: "Invalid kind or id" });
    return;
  }
  try {
    const removed = await invalidateInsight(kind, id);
    res.json({ removed });
  } catch (e) {
    console.log(`[card-insights] invalidate failed: ${String(e).slice(0, 200)}`);
    res.status(500).json({ error: "Internal error" });
  }
});

router.delete("/card-insights/cache/:kind", async (req: Request, res: Response) => {
  if (!adminAuthOk(req)) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  const kind = String(req.params.kind ?? "");
  if (!isKind(kind)) {
    res.status(400).json({ error: "Invalid kind" });
    return;
  }
  try {
    const removed = await invalidateKind(kind);
    res.json({ removed });
  } catch (e) {
    console.log(`[card-insights] invalidate kind failed: ${String(e).slice(0, 200)}`);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
