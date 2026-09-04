import OpenAI from "openai";

// ── Three-level fallback chain ────────────────────────────────────────────────
// Level 1 — client's own OpenAI key       → OPENAI_API_KEY
// Level 2 — our own OpenAI key            → OPENAI_API_KEY_OVERFLOW
// Level 3 — managed AI proxy (last resort) → AI_INTEGRATIONS_OPENAI_* secrets
//
// On any 429 the next level is tried immediately and transparently.
// The user never sees an error unless ALL levels are exhausted.

const clientKey  = process.env.OPENAI_API_KEY                   ?? "";
const ownKey     = process.env.OPENAI_API_KEY_OVERFLOW           ?? "";
const integrationKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY    ?? "";
const integrationBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL   ?? "";
const clientBase = process.env.OPENAI_BASE_URL                   ?? "";

function makeClient(apiKey: string, baseURL?: string): OpenAI {
  return baseURL ? new OpenAI({ apiKey, baseURL }) : new OpenAI({ apiKey });
}

// Build the ordered fallback list — only levels with a key are included.
const chain: { client: OpenAI; label: string }[] = [];
if (clientKey) chain.push({ client: makeClient(clientKey, clientBase || undefined), label: "client key (OPENAI_API_KEY)" });
if (ownKey)    chain.push({ client: makeClient(ownKey),                 label: "own key (OPENAI_API_KEY_OVERFLOW)" });
if (integrationKey && integrationBase) chain.push({ client: makeClient(integrationKey, integrationBase), label: "managed AI proxy" });

if (chain.length === 0) {
  console.error("[openai] WARNING: no OpenAI key configured — chat will fail");
} else {
  const labels = chain.map((c, i) => `  ${i + 1}. ${c.label}`).join("\n");
  console.log(`[openai] fallback chain (${chain.length} level${chain.length > 1 ? "s" : ""}):\n${labels}`);
}

// ── wrapCreate: tries each level in order on 429 ─────────────────────────────
function wrapCreate<T extends (...args: any[]) => Promise<any>>(
  getFn: (idx: number) => T,
  total: number,
): T {
  return (async (...args: any[]) => {
    for (let i = 0; i < total; i++) {
      try {
        return await getFn(i)(...args);
      } catch (err: any) {
        if (err?.status === 429 && i < total - 1) {
          console.warn(
            `[openai] level ${i + 1} (${chain[i]?.label}) hit 429 — ` +
            `switching to level ${i + 2} (${chain[i + 1]?.label})`,
          );
          continue;
        }
        throw err;
      }
    }
    // Unreachable — loop always either returns or throws.
    throw new Error("[openai] all fallback levels exhausted");
  }) as T;
}

// The primary client is always chain[0] (or a no-op dummy if chain is empty).
const primary = chain.length > 0 ? chain[0].client : makeClient("dummy");

if (chain.length > 1) {
  const total = chain.length;
  // Capture the ORIGINAL create functions before overwriting primary's —
  // chain[0].client IS primary, so reading .create lazily at call time would
  // return the wrapper itself and recurse forever (max call stack exceeded).
  const chatCreates = chain.map(
    (c) => c.client.chat.completions.create.bind(c.client.chat.completions),
  );
  const transcriptionCreates = chain.map(
    (c) => c.client.audio.transcriptions.create.bind(c.client.audio.transcriptions),
  );
  primary.chat.completions.create = wrapCreate((i) => chatCreates[i], total);
  primary.audio.transcriptions.create = wrapCreate((i) => transcriptionCreates[i], total);
}

export const openai = primary;
export default openai;

/** True when at least one configured provider can service an OpenAI request. */
export function openaiConfigured(): boolean {
  return chain.length > 0;
}
