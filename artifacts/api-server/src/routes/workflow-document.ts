/**
 * POST /workflow-document
 * Streams an AI-generated "Stage Lifecycle Document" for a given module's
 * stage rules — works like the Stage Authorization Certificate in the
 * screenshot. Body: { rules, perms, module, stageOrder }.
 */
import { Router, type IRouter } from "express";
import { openai } from "../lib/openai-client.js";
import { isValidSessionToken } from "./rmone-proxy.js";

const router: IRouter = Router();

const MODULE_NAMES: Record<string, string> = {
  PMM: "Projects",
  OPM: "Opportunities",
  LEM: "Leads",
};

router.post("/workflow-document", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "") ?? null;
  if (!await isValidSessionToken(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { rules, perms, module: mod, stageOrder } = req.body as {
    rules?: Record<string, unknown>;
    perms?: Array<Record<string, unknown>>;
    module?: string;
    stageOrder?: string[];
  };

  if (!mod || !rules) {
    res.status(400).json({ error: "module and rules required" });
    return;
  }

  const moduleName = MODULE_NAMES[mod] ?? mod;
  const stages: string[] = Array.isArray(stageOrder) ? stageOrder : [];

  const fieldLocks = (Array.isArray((rules as any).fieldLocks) ? (rules as any).fieldLocks : []) as any[];
  const stageSkips = (Array.isArray((rules as any).stageSkips) ? (rules as any).stageSkips : []) as any[];
  const workflowTypes = ((rules as any).workflowTypes ?? {}) as Record<string, unknown[]>;
  const permRules = Array.isArray(perms) ? perms : [];

  const modLocks = fieldLocks.filter(l => l.module === mod);
  const modSkips = stageSkips.filter((s: any) => s.module === mod && s.field !== "WorkflowTypeName");
  // Entries may be bare strings or { name, allowedGroupIds } objects (#121) —
  // the document only needs the names.
  const modTypes = (Array.isArray(workflowTypes[mod]) ? workflowTypes[mod] : [])
    .map((t: any) => (typeof t === "string" ? t : String(t?.name ?? "")))
    .filter((t: string) => t.trim() !== "");
  const modPerms = permRules.filter((p: any) => p.module === mod);

  const locksText = modLocks.length
    ? modLocks.map((l: any) =>
        `- Lock [${(l.fields as string[]).join(", ")}] ${l.direction === "from" ? "once the record reaches" : "until the record reaches"} "${l.stage}"`
      ).join("\n")
    : "None configured.";

  const skipsText = modSkips.length
    ? modSkips.map((s: any) =>
        `- When ${s.field} = "${s.value}": skip stages [${(s.skipStages as string[]).join(", ")}]`
      ).join("\n")
    : "None configured.";

  const typesText = modTypes.length
    ? modTypes.map((t: string) => {
        const skipRule = stageSkips.find(
          (s: any) => s.module === mod && s.field === "WorkflowTypeName" &&
          s.value?.trim().toLowerCase() === t.trim().toLowerCase()
        ) as any;
        const skipped = skipRule?.skipStages ?? [];
        return `- ${t}${skipped.length ? ` (skips: ${skipped.join(", ")})` : " (uses full workflow)"}`;
      }).join("\n")
    : "None — all records use the full stage sequence.";

  const permsText = modPerms.length
    ? modPerms.map((p: any) =>
        `- Stage "${p.stage}": ${(p.actionUserIds as string[]).length + (p.actionGroupIds as string[]).length} stage owners, ${(p.editorUserIds as string[]).length + (p.editorGroupIds as string[]).length} data editors; everyone else ${p.othersMode === "normal" ? "keeps their normal access" : "is view-only"}`
      ).join("\n")
    : "None — every stage works with default access (all authorized staff can act).";

  const prompt = `You are the documentation engine for RM ONE, a construction project management platform.

Generate a professional "Stage Lifecycle Authorization" document for the ${moduleName} module.

CONFIGURATION DATA:
Stage sequence: ${stages.length ? stages.join(" → ") : "Default (no custom sequence set)"}
Field locks:
${locksText}
Stage skips:
${skipsText}
Workflow types:
${typesText}
Stage permissions:
${permsText}

Write the document exactly in this format — keep it concise and readable:

---
## ${moduleName} Stage Lifecycle Authorization
**Auto-generated · Updated by workflow**

### 1. Stage Transition Overview
[2-sentence summary of this module's workflow from entry to closure. Mention the stage count.]

### 2. Gate Condition Verification
[For each lock rule, explain it in plain English — what gets locked, when, and why that matters. If none, say "No gate conditions configured — all fields remain editable throughout the lifecycle."]

### 3. Stage Routing
[For each skip rule and workflow type, explain in one sentence what path that record takes. If none, say "All records follow the standard stage sequence."]

### 4. Access Control
[Explain who can act at each restricted stage in plain English. If none, say "No stage-level access restrictions configured."]

### 5. Authorization Status
${modLocks.length + modSkips.length + modPerms.length > 0 ? "✅ **Active** — stage rules are in effect." : "⚪ **No rules configured** — default workflow applies."}
---

Keep the total under 350 words. Avoid jargon. Write as if explaining to a project manager.`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 900,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Generation failed";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  }
  res.end();
});

export default router;
