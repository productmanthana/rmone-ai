/**
 * Claude (Opus 4.8) helpers for the Data Cleaning Assistant.
 *
 * Claude NEVER sees bulk data — only headers + a few sample values, or small
 * batches of unresolved cases. Every answer is validated against a whitelist
 * before use; anything below the confidence floor goes to Needs Review.
 */
import { anthropic, CLEANING_MODEL, anthropicConfigured } from "../anthropic.js";
import { TEMPLATE_COLS, type ModuleId } from "./template.js";

export const CONFIDENCE_FLOOR = 0.85;

function extractText(msg: { content: { type: string; text?: string }[] }): string {
  return msg.content
    .filter(b => b.type === "text")
    .map(b => b.text ?? "")
    .join("")
    .trim();
}

function parseJson<T>(raw: string): T | null {
  let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = s.search(/[[{]/);
  if (first > 0) s = s.slice(first);
  try { return JSON.parse(s) as T; } catch { return null; }
}

async function ask(prompt: string): Promise<string | null> {
  if (!anthropicConfigured()) return null;
  try {
    const msg = await anthropic.messages.create({
      model: CLEANING_MODEL,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    return extractText(msg as any) || null;
  } catch (e) {
    console.warn("[data-cleaning:ai] Claude call failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Map unrecognised source headers to template column labels.
 * Returns { sourceHeader: targetLabel | null } — null means Needs Review/skip.
 */
export async function aiMapColumns(
  moduleLabel: string,
  targetLabels: string[],
  unknownCols: { header: string; samples: string[] }[],
): Promise<Record<string, string | null>> {
  const empty = Object.fromEntries(unknownCols.map(u => [u.header, null as string | null]));
  if (!unknownCols.length) return empty;

  const colDesc = unknownCols.map(u => {
    const ex = u.samples.slice(0, 5).map(s => JSON.stringify(String(s).slice(0, 60))).join(", ");
    return `- ${JSON.stringify(u.header)}${ex ? ` — example values: ${ex}` : " (no sample data)"}`;
  }).join("\n");

  const raw = await ask(`You are mapping spreadsheet columns from a messy client file onto a fixed import template for the "${moduleLabel}" sheet.

Template columns (the ONLY valid targets):
${targetLabels.map(l => `  - ${l}`).join("\n")}

Source columns to map:
${colDesc}

Rules:
1. Prefer a target whose meaning matches BOTH the header and the sample values.
2. If no target is a genuinely good fit, use null — do NOT force a match.
3. Confidence is 0..1: how sure you are the mapping is correct.

Respond with ONLY raw JSON (no markdown):
{ "<source header>": { "target": "<template column or null>", "confidence": 0.0 } }`);

  const parsed = raw ? parseJson<Record<string, { target: string | null; confidence: number }>>(raw) : null;
  if (!parsed) return empty;

  const valid = new Set(targetLabels);
  const out: Record<string, string | null> = {};
  for (const u of unknownCols) {
    const m = parsed[u.header];
    out[u.header] =
      m && m.target && valid.has(m.target) && (m.confidence ?? 0) >= CONFIDENCE_FLOOR
        ? m.target : null;
  }
  return out;
}

// ── Whole-sheet planning (v2) ───────────────────────────────────────────────

export interface PlanColumnDecision { module: ModuleId; target: string; confidence: number }

export interface SheetPlan {
  grain: string | null;
  primaryModule: ModuleId | null;
  /** Decision per source-column INDEX; null = no safe target (review/drop). */
  columns: Map<number, PlanColumnDecision | null>;
  /** Decision per wide-series id ("R0"…). */
  series: Map<string, { meaning: "weekly-hours" | "other"; confidence: number }>;
  split: { needed: boolean; confidence: number };
}

export interface PlanColumnInput {
  i: number;
  header: string;
  samples: string[];
  profile: string;
  /** Already decided deterministically (exact/learned) — the AI must not change it. */
  pinned?: { module: ModuleId; target: string };
}

export interface PlanSeriesInput { id: string; count: number; first: string; last: string }

const MODULE_IDS = new Set(Object.keys(TEMPLATE_COLS));

/**
 * ONE call per sheet: all headers + samples + value fingerprints + the FULL
 * template catalog (all 7 tabs). Returns a validated plan or null (caller
 * falls back to the deterministic v1 path). Answers are keyed by column
 * INDEX so long headers can never inflate or corrupt the response.
 */
export async function aiPlanSheet(opts: {
  sheetName: string;
  tabHint: ModuleId | null;
  catalog: string;
  columns: PlanColumnInput[];
  series: PlanSeriesInput[];
}): Promise<SheetPlan | null> {
  const { sheetName, tabHint, catalog, columns, series } = opts;
  if (!columns.length) return null;

  const colDesc = columns.map(c => {
    const ex = c.samples.slice(0, 5).map(s => JSON.stringify(s)).join(", ");
    const pin = c.pinned ? `  [PINNED to ${c.pinned.module}."${c.pinned.target}" — do not change]` : "";
    return `${c.i}. ${JSON.stringify(c.header)} — profile: ${c.profile}${ex ? ` — samples: ${ex}` : " — no data"}${pin}`;
  }).join("\n");

  const seriesDesc = series.length
    ? `\nWide column series (consecutive date-headed columns, treated as ONE unit each — their individual columns are NOT listed above):\n` +
      series.map(s => `${s.id}: ${s.count} date columns from "${s.first}" to "${s.last}", numeric values`).join("\n")
    : "";

  const raw = await ask(`You are planning how to fit ONE sheet from a client Excel workbook into a fixed import template with 7 tabs. Columns may belong to DIFFERENT tabs than the sheet's main one (clients often mix entities on one sheet).

TEMPLATE CATALOG — the ONLY valid (module, column) targets:
${catalog}

SHEET "${sheetName}"${tabHint ? ` (tab name suggests: ${tabHint})` : ""} — columns by index, with a data profile computed from the actual values:
${colDesc}${seriesDesc}

Decide:
1. "grain": what ONE data row represents (e.g. "one row per project", "one row per person per project").
2. "primaryModule": the template module this sheet mainly belongs to, or null.
3. "columns": for EVERY non-pinned index, the best target {"module","target"} or nulls when nothing genuinely fits. Judge by BOTH the header meaning and the data profile/samples. Related columns help (a date column that is always earlier than a sibling is the start; an amount ~10-15% of another is a fee, not the contract value).
4. "series": for each wide series id, "weekly-hours" if the values are work hours per row-entity per week, else "other".
5. "split": true when the sheet mixes 2+ entity kinds (e.g. project columns AND person/assignment columns) and should be split into multiple tabs.

Rules:
- NEVER force a match — a wrong mapping is far worse than null. Ambiguous columns (e.g. an amount that could be several template amounts) get null.
- Prefer the sheet's own entity: when the rows represent one entity kind, map columns to THAT module. Only map a column to a different module when it clearly describes a different entity than the row itself (that is what "split" is for). Several modules share column names (Business Unit, Division, Role, Status…) — pick the row entity's module, not a sibling.
- Some sheets fit NO template tab: task lists, timesheets / time logs, tickets, action-request queues, meeting notes. For those set primaryModule to null and give EVERY column null — do NOT map generic columns (Status, Description, Dates, Names) off a sheet whose rows are not template entities.
- confidence 0..1 = how sure you are; ${CONFIDENCE_FLOOR} or higher means "safe to apply automatically".
- Each (module, column) target may be used by at most ONE source column.

Respond with ONLY raw JSON (no markdown):
{"grain":"...","primaryModule":"projects"|null,"columns":[{"i":0,"module":"projects","target":"Project ID","confidence":0.97},{"i":5,"module":null,"target":null,"confidence":0}],"series":[{"id":"R0","meaning":"weekly-hours","confidence":0.9}],"split":{"needed":false,"confidence":0.9}}`);

  const parsed = raw ? parseJson<{
    grain?: string; primaryModule?: string | null;
    columns?: { i: number; module: string | null; target: string | null; confidence: number }[];
    series?: { id: string; meaning: string; confidence: number }[];
    split?: { needed: boolean; confidence: number };
  }>(raw) : null;
  if (!parsed || !Array.isArray(parsed.columns)) return null;

  const plan: SheetPlan = {
    grain: typeof parsed.grain === "string" ? parsed.grain.slice(0, 120) : null,
    primaryModule: parsed.primaryModule && MODULE_IDS.has(parsed.primaryModule)
      ? parsed.primaryModule as ModuleId : null,
    columns: new Map(),
    series: new Map(),
    split: {
      needed: Boolean(parsed.split?.needed),
      confidence: Number(parsed.split?.confidence ?? 0) || 0,
    },
  };

  // Pinned columns first — they claim their targets unconditionally.
  const taken = new Set<string>();   // `${module}|${target}`
  for (const c of columns) {
    if (!c.pinned) continue;
    plan.columns.set(c.i, { module: c.pinned.module, target: c.pinned.target, confidence: 1 });
    taken.add(`${c.pinned.module}|${c.pinned.target}`);
  }

  // AI decisions: validate module+target, apply the floor, resolve target
  // collisions highest-confidence-first.
  const byIndex = new Map<number, { module: string | null; target: string | null; confidence: number }>();
  for (const row of parsed.columns) {
    if (typeof row?.i === "number") byIndex.set(row.i, row);
  }
  const candidates: { i: number; module: ModuleId; target: string; confidence: number }[] = [];
  for (const c of columns) {
    if (c.pinned) continue;
    plan.columns.set(c.i, null);
    const d = byIndex.get(c.i);
    if (!d?.module || !d.target) continue;
    if (!MODULE_IDS.has(d.module)) continue;
    const mod = d.module as ModuleId;
    if (!TEMPLATE_COLS[mod].some(col => col.label === d.target)) continue;
    const conf = Number(d.confidence ?? 0) || 0;
    if (conf < CONFIDENCE_FLOOR) continue;
    candidates.push({ i: c.i, module: mod, target: d.target, confidence: conf });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  for (const cand of candidates) {
    const key = `${cand.module}|${cand.target}`;
    if (taken.has(key)) continue;
    taken.add(key);
    plan.columns.set(cand.i, { module: cand.module, target: cand.target, confidence: cand.confidence });
  }

  for (const s of parsed.series ?? []) {
    if (typeof s?.id !== "string") continue;
    plan.series.set(s.id, {
      meaning: s.meaning === "weekly-hours" ? "weekly-hours" : "other",
      confidence: Number(s.confidence ?? 0) || 0,
    });
  }
  return plan;
}

/**
 * Fuzzy-match unresolved references (project names, person names) against a
 * candidate list. Batched by caller (≤40 items). Returns candidate INDEX or
 * null per item.
 */
export async function aiFuzzyMatch(
  kindLabel: string,
  items: { idx: number; text: string; context?: string }[],
  candidates: string[],
): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  for (const it of items) out.set(it.idx, null);
  if (!items.length || !candidates.length) return out;

  const raw = await ask(`You are resolving ${kindLabel} from a messy spreadsheet against a known list.

Known list (index: value):
${candidates.map((cand, i) => `${i}: ${JSON.stringify(cand)}`).join("\n")}

Unresolved entries:
${items.map(it => `- id ${it.idx}: ${JSON.stringify(it.text)}${it.context ? ` (${it.context})` : ""}`).join("\n")}

Rules:
1. Match ONLY when the entry clearly refers to the same real-world thing
   (typos, abbreviations, extra words, different word order are OK).
2. If genuinely ambiguous or no good match exists, use null. Never guess.
3. Confidence 0..1.

Respond with ONLY raw JSON (no markdown):
[ { "id": 0, "match": <candidate index or null>, "confidence": 0.0 } ]`);

  const parsed = raw ? parseJson<{ id: number; match: number | null; confidence: number }[]>(raw) : null;
  if (!parsed || !Array.isArray(parsed)) return out;

  for (const row of parsed) {
    if (typeof row?.id !== "number" || !out.has(row.id)) continue;
    const ok =
      typeof row.match === "number" &&
      Number.isInteger(row.match) &&
      row.match >= 0 && row.match < candidates.length &&
      (row.confidence ?? 0) >= CONFIDENCE_FLOOR;
    out.set(row.id, ok ? (row.match as number) : null);
  }
  return out;
}
