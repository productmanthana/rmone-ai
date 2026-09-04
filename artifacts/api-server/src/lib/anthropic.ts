/**
 * Anthropic (Claude) client.
 *
 * Data Cleaning uses the client's direct Anthropic API key in every runtime.
 * A managed AI proxy is deliberately not a fallback for this workload.
 *
 * NOTE on claude-opus-4-8: temperature / top_p / top_k are deprecated and
 * return a 400 if set — omit them entirely from every request.
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? "";

export const anthropic = new Anthropic({
  apiKey: anthropicApiKey || "dummy",
});

/** Model used by the Data Cleaning Assistant (user requested Opus). */
export const CLEANING_MODEL = "claude-opus-4-8";

export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
