import OpenAI from "openai";
import { encodingForModel, getEncoding, type TiktokenModel, type Tiktoken } from "js-tiktoken";

type Msg = OpenAI.Chat.ChatCompletionMessageParam;

let _enc: Tiktoken | null = null;
function enc(): Tiktoken {
  if (_enc) return _enc;
  try {
    _enc = encodingForModel("gpt-4o" as TiktokenModel);
  } catch {
    _enc = getEncoding("cl100k_base");
  }
  return _enc!;
}

function strContent(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join(" ");
  }
  return "";
}

export function countTokens(messages: Msg[]): number {
  const e = enc();
  let total = 0;
  for (const m of messages) {
    total += 4;
    total += e.encode(m.role || "").length;
    const content = strContent((m as any).content);
    if (content) total += e.encode(content).length;
    const tcs: any[] = (m as any).tool_calls || [];
    for (const tc of tcs) {
      total += 8;
      total += e.encode(tc.function?.name || "").length;
      total += e.encode(tc.function?.arguments || "").length;
    }
    if ((m as any).tool_call_id) total += e.encode((m as any).tool_call_id).length;
  }
  total += 2;
  return total;
}

export interface MemoryOptions {
  /** Keep this many of the most recent user/assistant turns verbatim. */
  keepLastTurns: number;
  /** Hard token budget — if input exceeds this, force more aggressive trimming. */
  maxInputTokens: number;
  /** Tool result content longer than this will be summarized when older than `freshToolRounds`. */
  toolResultMaxChars: number;
  /** Number of most recent tool rounds to preserve verbatim. */
  freshToolRounds: number;
  /** Whether to call the model to summarize dropped turns. */
  summarizeDropped: boolean;
}

export const DEFAULT_MEMORY_OPTIONS: MemoryOptions = {
  keepLastTurns: 20,
  maxInputTokens: 80_000,
  toolResultMaxChars: 1500,
  freshToolRounds: 2,
  summarizeDropped: true,
};

/**
 * Trim old tool results in-place: any assistant+tool pair that is older
 * than the last `freshToolRounds` rounds gets its tool content shortened
 * to a one-line summary (head + tail + size note).
 */
export function trimOldToolResults(
  messages: Msg[],
  opts: { freshToolRounds: number; toolResultMaxChars: number }
): Msg[] {
  // Identify tool message indices in order
  const toolIdxs: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if ((messages[i] as any).role === "tool") toolIdxs.push(i);
  }
  if (toolIdxs.length <= opts.freshToolRounds) return messages;
  const cutoff = toolIdxs[toolIdxs.length - opts.freshToolRounds];
  return messages.map((m, i) => {
    if (i >= cutoff) return m;
    if ((m as any).role !== "tool") return m;
    const c = strContent((m as any).content);
    if (c.length <= opts.toolResultMaxChars) return m;
    let summary: string;
    try {
      const parsed = JSON.parse(c);
      const ok = parsed?.ok;
      const message = (parsed?.message || "").toString().slice(0, 200);
      const keys = parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 6).join(",") : "";
      summary = `[older tool result, trimmed — ${c.length} chars original. ok=${ok}; keys=${keys}; message="${message}"]`;
    } catch {
      summary = `[older tool result, trimmed — ${c.length} chars original. head="${c.slice(0, 120).replace(/\s+/g, " ")}…"]`;
    }
    return { ...(m as any), content: summary } as Msg;
  });
}

/**
 * Apply a sliding window over user/assistant turns. Returns:
 *   { kept: Msg[], dropped: Msg[] }
 * The caller is responsible for re-prepending any system messages.
 */
export function applySlidingWindow(
  history: Msg[],
  keepLastTurns: number
): { kept: Msg[]; dropped: Msg[] } {
  // history contains only user/assistant (and possibly tool) — but here we
  // use it on the inbound chat history which is just user/assistant pairs.
  const userIdxs: number[] = [];
  for (let i = 0; i < history.length; i++) {
    if ((history[i] as any).role === "user") userIdxs.push(i);
  }
  if (userIdxs.length <= keepLastTurns) {
    return { kept: history, dropped: [] };
  }
  const startKeep = userIdxs[userIdxs.length - keepLastTurns];
  return {
    kept: history.slice(startKeep),
    dropped: history.slice(0, startKeep),
  };
}

/**
 * Summarize dropped turns into a single short note via gpt-4o-mini.
 * Returns a string suitable for a "system" memory note.
 */
export async function summarizeDroppedTurns(
  dropped: Msg[],
  openai: OpenAI
): Promise<string> {
  if (dropped.length === 0) return "";
  const transcript = dropped
    .map((m) => {
      const role = (m as any).role;
      if (role !== "user" && role !== "assistant") return "";
      const txt = strContent((m as any).content).slice(0, 600);
      if (!txt.trim()) return "";
      return `${role.toUpperCase()}: ${txt}`;
    })
    .filter(Boolean)
    .join("\n\n");
  if (!transcript) return "";
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 250,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a memory compressor for a chat assistant in an enterprise resource-management app. Summarize the EARLIER part of a conversation in 4-8 short bullet points capturing: (1) people, projects (PMM/OPM/LEM IDs), and clients discussed; (2) actions taken or proposed (allocation edits, schedule changes, emails drafted); (3) any user preferences or constraints stated; (4) open questions or pending decisions. Be terse and concrete. Do NOT include pleasantries.",
        },
        { role: "user", content: `Earlier conversation transcript:\n\n${transcript}\n\nProduce the bullet summary.` },
      ],
    });
    const summary = resp.choices[0]?.message?.content?.trim() || "";
    return summary;
  } catch (e) {
    console.warn("[chatMemory] summarizeDroppedTurns failed:", e instanceof Error ? e.message : String(e));
    return "";
  }
}

/**
 * Manage the inbound chat history (user/assistant turns from the client):
 *   1. Apply sliding window
 *   2. Summarize dropped turns into a memory note (if any dropped)
 *
 * Returns:
 *   - history: trimmed user/assistant turns
 *   - memoryNote: optional system message text to inject (empty if nothing dropped)
 */
export async function manageHistory(
  history: Msg[],
  openai: OpenAI,
  opts: MemoryOptions = DEFAULT_MEMORY_OPTIONS
): Promise<{ history: Msg[]; memoryNote: string; droppedCount: number }> {
  const { kept, dropped } = applySlidingWindow(history, opts.keepLastTurns);
  let memoryNote = "";
  if (dropped.length > 0 && opts.summarizeDropped) {
    memoryNote = await summarizeDroppedTurns(dropped, openai);
  }
  return { history: kept, memoryNote, droppedCount: dropped.length };
}

/**
 * Identify the atomic span of messages that must be dropped together
 * starting at index `start`. Critical for OpenAI tool-call validity:
 *   - assistant.tool_calls MUST be followed by tool messages whose
 *     tool_call_id matches each call. Dropping one half of the pair
 *     causes a 400 on the next request.
 *
 * Returns [start, endExclusive) — the slice to splice out as a unit.
 */
function findDropSpan(messages: Msg[], start: number): { start: number; end: number } | null {
  if (start >= messages.length) return null;
  const m: any = messages[start];
  if (m.role === "tool") {
    // Orphan tool — drop alone (shouldn't happen under normal flow but be safe).
    return { start, end: start + 1 };
  }
  if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
    const expectedIds = new Set<string>(m.tool_calls.map((tc: any) => tc.id));
    let end = start + 1;
    while (end < messages.length) {
      const next: any = messages[end];
      if (next.role === "tool" && expectedIds.has(next.tool_call_id)) {
        expectedIds.delete(next.tool_call_id);
        end++;
        if (expectedIds.size === 0) break;
      } else {
        break;
      }
    }
    return { start, end };
  }
  // Plain user/assistant text — drop alone.
  return { start, end: start + 1 };
}

/**
 * Validate that tool-call pairing invariants hold. Used as a defense-in-depth
 * check after trimming: every assistant tool_call must have a matching tool
 * response right after it, and every tool message must follow a matching
 * assistant tool_call.
 */
export function validateToolPairing(messages: Msg[]): { ok: boolean; reason?: string } {
  const open = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const m: any = messages[i];
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) open.add(tc.id);
    } else if (m.role === "tool") {
      if (!open.has(m.tool_call_id)) {
        return { ok: false, reason: `orphan tool message at index ${i} (tool_call_id=${m.tool_call_id})` };
      }
      open.delete(m.tool_call_id);
    }
  }
  if (open.size > 0) {
    return { ok: false, reason: `unresolved assistant tool_call(s): ${[...open].join(",")}` };
  }
  return { ok: true };
}

/**
 * Final guardrail: if the assembled message array exceeds maxInputTokens,
 * drop the oldest non-system spans (tool-pair-aware) until under budget.
 * System messages and the LATEST message are never dropped.
 */
export function enforceTokenBudget(
  messages: Msg[],
  maxInputTokens: number
): { messages: Msg[]; droppedForBudget: number; finalTokens: number } {
  let current = [...messages];
  let droppedForBudget = 0;
  let tokens = countTokens(current);
  if (tokens <= maxInputTokens) return { messages: current, droppedForBudget: 0, finalTokens: tokens };

  // Walk from the start, skipping system messages and never crossing into
  // the final message. Drop atomic spans (assistant+tool_calls grouped).
  while (tokens > maxInputTokens && current.length > 2) {
    let dropStart = -1;
    for (let i = 0; i < current.length - 1; i++) {
      if ((current[i] as any).role !== "system") { dropStart = i; break; }
    }
    if (dropStart === -1) break;
    const span = findDropSpan(current, dropStart);
    if (!span || span.end > current.length - 1) break; // never drop the final msg
    const removed = span.end - span.start;
    current.splice(span.start, removed);
    droppedForBudget += removed;
    tokens = countTokens(current);
  }
  return { messages: current, droppedForBudget, finalTokens: tokens };
}

export function logUsage(
  tag: string,
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | undefined | null
): void {
  if (!usage) return;
  // cached_tokens = the portion of the prompt served from OpenAI's prompt
  // cache (~50% cheaper + faster TTFT). Requires a >1024-token static prefix;
  // our system prompt is built static-rules-first for exactly this reason.
  const cached = usage.prompt_tokens_details?.cached_tokens;
  const cacheInfo =
    typeof cached === "number" && usage.prompt_tokens
      ? ` cached=${cached} (${Math.round((cached / usage.prompt_tokens) * 100)}% cache-hit)`
      : " cached=n/a";
  console.log(
    `[chat:usage] ${tag} prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}${cacheInfo}`
  );
}
