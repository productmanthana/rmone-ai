/**
 * LLM-powered column matching.
 * Called after synonym-table matching fails — uses GPT to suggest the best
 * canonical field for each unrecognised column header.
 *
 * Returns a map of { originalColumnName → bestCanonical | null }.
 * null means the LLM couldn't find a reasonable match (column should be skipped).
 *
 * The matcher considers BOTH the header name and several real sample values, and
 * detects the data shape (email / number / date / …) so the actual data — not
 * just an ambiguous or misspelled header — drives the decision. e.g. a column
 * named "cliets" full of email addresses maps to a contact/email field, not
 * CompanyName.
 */
import { openai } from "./openai-client.js";

// ── Lightweight value-shape detection ────────────────────────────────────────
// Looks across the provided samples and reports the dominant shape so the prompt
// can give the model a strong, data-driven signal.
function detectDataShape(samples: string[]): string | null {
  const vals = samples.map(s => s.trim()).filter(Boolean);
  if (!vals.length) return null;

  const is = {
    email:   (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    number:  (v: string) => /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(v),
    percent: (v: string) => /^\d+(\.\d+)?\s*%$/.test(v),
    date:    (v: string) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v) || (/[0-9]/.test(v) && !Number.isNaN(Date.parse(v)) && /[-/]/.test(v)),
    bool:    (v: string) => /^(0|1|true|false|yes|no|y|n)$/i.test(v),
    phone:   (v: string) => /^[+()\d][\d\s().-]{6,}$/.test(v),
  };

  const frac = (pred: (v: string) => boolean) => vals.filter(pred).length / vals.length;

  // Order matters: more specific shapes first.
  if (frac(is.email)   >= 0.6) return "email addresses";
  if (frac(is.percent) >= 0.6) return "percentages";
  if (frac(is.date)    >= 0.6) return "dates";
  if (frac(is.bool)    >= 0.8) return "yes/no or 0/1 flags";
  if (frac(is.phone)   >= 0.6) return "phone numbers";
  if (frac(is.number)  >= 0.8) return "numbers";
  return null;
}

/**
 * Best-guess variant: always returns a closest canonical field — never null.
 * Used as a "Phase 3" suggestion pass for columns the strict matcher can't
 * place. Results are shown to the user as pre-filled suggestions (not silently
 * applied), so a loose match is better than leaving the field blank.
 */
export async function llmSuggestColumns(
  sheetType:   "team" | "clients" | "assignments",
  unknownCols: string[],
  canonicals:  string[],
  sampleValues?: Record<string, string[]>,
): Promise<Record<string, string | null>> {
  if (!unknownCols.length) return {};

  const sheetLabel = {
    team:        "Your Team (employees / staff)",
    clients:     "Clients & Projects (CRM / project data)",
    assignments: "Assignments (resource allocation / staffing)",
  }[sheetType];

  const colDescriptions = unknownCols.map(col => {
    const samples = sampleValues?.[col] ?? [];
    if (!samples.length) return `- "${col}" (no sample data available)`;
    const shape = detectDataShape(samples);
    const examples = samples.slice(0, 5).map(s => `"${s}"`).join(", ");
    const shapeNote = shape ? ` — the values look like ${shape}` : "";
    return `- "${col}"${shapeNote}; example values: ${examples}`;
  }).join("\n");

  const prompt = `You are mapping spreadsheet columns to database field names for the "${sheetLabel}" sheet.

Available database fields:
${canonicals.map(c => `  - ${c}`).join("\n")}

For each column below, return the BEST matching database field from the list above.
IMPORTANT rules (apply in priority order):
1. EXACT NAME MATCH FIRST — if the column header is the same word as a database field (ignoring case, spaces, underscores), ALWAYS return that field. e.g. "Role" → "Role", "jobtitle" → "JobTitle". Never override an exact name match with a "creative" interpretation.
2. DATA SHAPE SECOND — weigh the example values heavily; the header may be misspelled or abbreviated.
3. You MUST always return a field — never return null. Choose the closest match even if imperfect.

Columns to suggest matches for:
${colDescriptions}

Respond with ONLY a JSON object like:
{
  "Column Header": "FieldName"
}

No explanation, no markdown fences — just the raw JSON object.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const choice = response.choices[0];
    let raw = choice?.message?.content?.trim() ?? "";
    if (!raw || choice?.finish_reason === "length") return Object.fromEntries(unknownCols.map(c => [c, null]));

    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(raw) as Record<string, string | null>;

    const validSet = new Set(canonicals);
    const result: Record<string, string | null> = {};
    for (const col of unknownCols) {
      const suggested = parsed[col];
      result[col] = suggested && validSet.has(suggested) ? suggested : null;
    }
    return result;
  } catch (e) {
    console.warn("[llm-suggest] failed:", (e as Error).message);
    return Object.fromEntries(unknownCols.map(c => [c, null]));
  }
}

export async function llmMatchColumns(
  sheetType:   "team" | "clients" | "assignments",
  unknownCols: string[],                   // column headers that failed synonym lookup
  canonicals:  string[],                   // valid canonical field names for this sheet
  sampleValues?: Record<string, string[]>, // several sample values per unknown col
): Promise<Record<string, string | null>> {
  if (!unknownCols.length) return {};

  const sheetLabel = {
    team:        "Your Team (employees / staff)",
    clients:     "Clients & Projects (CRM / project data)",
    assignments: "Assignments (resource allocation / staffing)",
  }[sheetType];

  const colDescriptions = unknownCols.map(col => {
    const samples = sampleValues?.[col] ?? [];
    if (!samples.length) return `- "${col}" (no sample data available)`;
    const shape = detectDataShape(samples);
    const examples = samples.slice(0, 5).map(s => `"${s}"`).join(", ");
    const shapeNote = shape ? ` — the values look like ${shape}` : "";
    return `- "${col}"${shapeNote}; example values: ${examples}`;
  }).join("\n");

  const prompt = `You are mapping spreadsheet columns to database field names for the "${sheetLabel}" sheet.

Available database fields:
${canonicals.map(c => `  - ${c}`).join("\n")}

For each column below, return the BEST matching database field from the list above, or null if there is no reasonable match.

IMPORTANT — how to decide:
- The EXAMPLE VALUES are the actual data in the column. Weigh them HEAVILY.
- The header name can be misspelled, abbreviated, or misleading. When the header name and the data disagree, TRUST THE DATA.
- e.g. a column whose values are email addresses maps to an email/contact field, NOT a company-name field — even if the header says something like "client" or "company".
- A match is only reasonable when the field would actually hold this kind of data.
- CRITICAL NAME FIELDS: "Full Name", "FullName", "Name", "Display Name", "Employee Name" — all map to FullName (the complete display name). Do NOT map these to FirstName. FirstName is ONLY for columns that exclusively hold the given/first name (e.g. "First Name", "Given Name", "Forename").

Columns to match:
${colDescriptions}

Respond with ONLY a JSON object like:
{
  "Column Header": "FieldName",
  "Another Column": null
}

No explanation, no markdown fences — just the raw JSON object.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      // gpt-5-mini is a reasoning model: reasoning tokens are drawn from this
      // same budget BEFORE any visible JSON is produced. 512 was far too small
      // for the larger tabs (17 / 30 columns) — reasoning alone consumed the
      // whole budget, leaving zero output (finish_reason "length"), so the
      // JSON.parse below threw and every column fell back to "unknown".
      max_completion_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const choice = response.choices[0];
    let raw = choice?.message?.content?.trim() ?? "";

    // Truncated / empty response — don't attempt to parse, just skip matching.
    if (!raw || choice?.finish_reason === "length") {
      console.warn(
        `[llm-match] no usable content for "${sheetType}" tab ` +
        `(finish_reason=${choice?.finish_reason}, ${unknownCols.length} columns) — ` +
        `leaving columns unmatched`,
      );
      return Object.fromEntries(unknownCols.map(c => [c, null]));
    }

    // Strip accidental markdown fences in case the model wraps the JSON.
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    const parsed = JSON.parse(raw) as Record<string, string | null>;

    // Validate — only accept values that are in the canonicals list
    const validSet = new Set(canonicals);
    const result: Record<string, string | null> = {};
    for (const col of unknownCols) {
      const suggested = parsed[col];
      result[col] = suggested && validSet.has(suggested) ? suggested : null;
    }
    return result;
  } catch (e) {
    console.warn("[llm-match] failed:", (e as Error).message);
    // On failure return no matches — don't block the upload
    return Object.fromEntries(unknownCols.map(c => [c, null]));
  }
}
