/**
 * Data Cleaning Assistant routes.
 *
 * POST /upload    — attach a messy Excel; kicks off a background cleaning run
 * GET  /status/:id — poll progress (state lives in S3 so ANY worker answers)
 * GET  /download/:id — the cleaned .xlsx in exact import-template format
 * POST /chat      — SSE chat with Claude Opus about the cleaning report
 *
 * NEVER writes to any database (the engine's DB access is read-only existence
 * checks for cross-referencing Project IDs).
 */
import { Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { resolveRequestSource, isSuperAdminSource } from "../lib/rds-auth.js";
import { registerChunkUploadRoutes } from "../lib/upload-chunks.js";
import { runCleaningSession, type CleaningReport, type CleanOverride } from "../lib/data-cleaning/engine.js";
import { writeStatus, readStatus, readReport, readCleanedFile, listSessions, saveReviewedFile, readReviewedFile, saveOriginalFile, readOriginalFile } from "../lib/data-cleaning/store.js";
import { TEMPLATE_COLS, type ModuleId } from "../lib/data-cleaning/template.js";
import { learnCleaningMapping } from "../lib/data-cleaning/learned.js";
import { anthropic, CLEANING_MODEL, anthropicConfigured } from "../lib/anthropic.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveTenant(req: Parameters<typeof resolveRequestSource>[0], requested?: string): { tenant: string } | { error: string } {
  const src = resolveRequestSource(req);
  if (!src) return { error: "Unauthorized" };
  const want = String(requested ?? "").trim();
  if (want && !isSuperAdminSource(src) && want.toLowerCase() !== src.tenant.toLowerCase()) {
    return { error: "Forbidden: cannot act on another tenant" };
  }
  return { tenant: isSuperAdminSource(src) ? (want || src.tenant) : src.tenant };
}

// ── Upload + background clean ────────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file attached." }); return; }
  return handleCleaningUpload({ buffer: req.file.buffer, originalname: req.file.originalname }, req, res);
});

// Chunked variant for files past the ~32MB production edge cap: pieces arrive
// via /upload-chunk, /upload-complete reassembles and runs the same handler.
registerChunkUploadRoutes(router, {
  maxAssembledBytes: 250 * 1024 * 1024,
  onComplete: (f, cReq, cRes) => handleCleaningUpload({ buffer: f.buffer, originalname: f.originalname }, cReq, cRes),
});

// Shared body of POST /upload and the chunked /upload-complete path.
async function handleCleaningUpload(
  file: { buffer: Buffer; originalname: string },
  req: Parameters<typeof resolveTenant>[0] & { body?: Record<string, unknown> },
  res: import("express").Response,
) {
  try {
    const auth = resolveTenant(req, (req.body?.tenantId as string) ?? "");
    if ("error" in auth) { res.status(auth.error === "Unauthorized" ? 401 : 403).json({ error: auth.error }); return; }
    if (!/\.(xlsx|xls)$/i.test(file.originalname)) {
      res.status(400).json({ error: "Please attach an Excel file (.xlsx or .xls)." });
      return;
    }
    const tenantId = auth.tenant;
    const sessionId = crypto.randomUUID();
    const fileName = file.originalname;
    const buffer = file.buffer;

    await writeStatus(tenantId, sessionId, {
      stage: "queued", pct: 0, message: "Queued…",
      updatedAt: new Date().toISOString(), fileName,
    });

    // Keep the original next to the session so a later re-clean (user maps a
    // dropped column) can re-run without re-attaching. Non-fatal on failure.
    void saveOriginalFile(tenantId, sessionId, buffer).catch(e =>
      console.warn(`[data-cleaning] original save skipped for ${sessionId}:`,
        e instanceof Error ? e.message : String(e)));

    res.json({ sessionId, tenantId, fileName });

    // Background run on this worker; progress + results live in SQL Server
    // so any worker can answer the polls.
    void runCleaningSession({ tenantId, sessionId, fileName, buffer, checkDb: true })
      .catch(async (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[data-cleaning] session ${sessionId} failed:`, msg);
        try {
          await writeStatus(tenantId, sessionId, {
            stage: "failed", pct: 100, message: "Cleaning failed.",
            error: msg, updatedAt: new Date().toISOString(), fileName,
          });
        } catch { /* status write itself failed — poll will show stale */ }
      });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ── Re-clean with user-confirmed column mappings ─────────────────────────────
// The import grid shows columns the cleaning left out; the user picks the
// right template column and we re-run the ENGINE on the stored ORIGINAL file
// with those mappings as absolute overrides. Same sessionId — the report and
// cleaned file are overwritten, so the existing status polling just works.
router.post("/reclean/:sessionId", async (req, res) => {
  try {
    const auth = resolveTenant(req, (req.body?.tenantId as string) ?? "");
    if ("error" in auth) { res.status(auth.error === "Unauthorized" ? 401 : 403).json({ error: auth.error }); return; }
    const sessionId = String(req.params.sessionId);
    if (!SESSION_RE.test(sessionId)) { res.status(400).json({ error: "Bad session id" }); return; }
    const raw = Array.isArray(req.body?.overrides) ? req.body.overrides : [];
    const overrides: CleanOverride[] = [];
    for (const o of raw.slice(0, 60)) {
      const sheet = String(o?.sheet ?? "").trim();
      const header = String(o?.header ?? "").trim();
      const module = String(o?.module ?? "") as ModuleId;
      const target = String(o?.target ?? "").trim();
      if (!sheet || !header || !target) continue;
      const cols = TEMPLATE_COLS[module];
      if (!cols || !cols.some(c => c.label === target)) continue;
      overrides.push({ sheet, header, module, target });
    }
    if (!overrides.length) { res.status(400).json({ error: "No valid column mappings provided." }); return; }

    const tenantId = auth.tenant;
    const st = await readStatus(tenantId, sessionId);
    if (!st) { res.status(404).json({ error: "Session not found" }); return; }
    if (st.stage !== "done" && st.stage !== "failed") {
      res.status(409).json({ error: "This session is still being cleaned — wait for it to finish first." });
      return;
    }
    const original = await readOriginalFile(tenantId, sessionId);
    if (!original) {
      res.status(404).json({ error: "The original file for this session is no longer available — please upload it again." });
      return;
    }

    await writeStatus(tenantId, sessionId, {
      stage: "queued", pct: 0, message: "Re-cleaning with your column mappings…",
      updatedAt: new Date().toISOString(), fileName: original.fileName,
    });
    res.json({ sessionId, tenantId, fileName: original.fileName });

    void runCleaningSession({
      tenantId, sessionId, fileName: original.fileName,
      buffer: original.buffer, checkDb: true, overrides,
    }).then(() => {
      // Remember the confirmed mappings so future files match automatically
      // (shared store also used by the import grid). Learn only AFTER the
      // re-clean succeeded so a failed run can't teach a bad alias. Fail-open.
      for (const o of overrides) void learnCleaningMapping(o.header, o.module, o.target);
    }).catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[data-cleaning] re-clean ${sessionId} failed:`, msg);
      try {
        await writeStatus(tenantId, sessionId, {
          stage: "failed", pct: 100, message: "Re-cleaning failed.",
          error: msg, updatedAt: new Date().toISOString(), fileName: original.fileName,
        });
      } catch { /* status write itself failed — poll will show stale */ }
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Template column labels per module — the import grid builds the "map a
// dropped column" picker from this, so choices always match what /reclean
// accepts (frontend grids keep their own similar-but-not-identical col sets).
router.get("/template-columns", (req, res) => {
  if (!resolveRequestSource(req)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const out: Record<string, string[]> = {};
  for (const [m, cols] of Object.entries(TEMPLATE_COLS)) out[m] = cols.map(c => c.label);
  res.json(out);
});

// ── Poll status (+ report once done) ────────────────────────────────────────
router.get("/status/:sessionId", async (req, res) => {
  try {
    const auth = resolveTenant(req, (req.query.tenantId as string) ?? "");
    if ("error" in auth) { res.status(auth.error === "Unauthorized" ? 401 : 403).json({ error: auth.error }); return; }
    const sessionId = String(req.params.sessionId);
    if (!SESSION_RE.test(sessionId)) { res.status(400).json({ error: "Bad session id" }); return; }

    const st = await readStatus(auth.tenant, sessionId);
    if (!st) { res.status(404).json({ error: "Session not found" }); return; }

    // Staleness guard: if the owning worker died mid-run the status freezes.
    const ageMs = Date.now() - Date.parse(st.updatedAt || "");
    const stale = st.stage !== "done" && st.stage !== "failed" && Number.isFinite(ageMs) && ageMs > 3 * 60_000;

    let report: CleaningReport | null = null;
    if (st.stage === "done") report = await readReport(auth.tenant, sessionId);
    res.json({ ...st, stale, report });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Session history ──────────────────────────────────────────────────────────
router.get("/sessions", async (req, res) => {
  try {
    const auth = resolveTenant(req, (req.query.tenantId as string) ?? "");
    if ("error" in auth) { res.status(auth.error === "Unauthorized" ? 401 : 403).json({ error: auth.error }); return; }
    const sessions = (await listSessions(auth.tenant, 60))
      // Hide legacy script-created sessions whose IDs aren't UUIDs — the
      // report/download routes (correctly) reject them, so listing them
      // would only produce dead rows.
      .filter(s => SESSION_RE.test(s.sessionId));
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Full stored report for one past session (History detail view).
router.get("/report/:sessionId", async (req, res) => {
  try {
    const auth = resolveTenant(req, (req.query.tenantId as string) ?? "");
    if ("error" in auth) { res.status(auth.error === "Unauthorized" ? 401 : 403).json({ error: auth.error }); return; }
    const sessionId = String(req.params.sessionId);
    if (!SESSION_RE.test(sessionId)) { res.status(400).json({ error: "Bad session id" }); return; }
    const report = await readReport(auth.tenant, sessionId);
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }
    res.json({ report });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Download cleaned / reviewed workbook ────────────────────────────────────
// ?which=reviewed serves the decisions-applied file the user finalized on the
// import review screen; default is the engine's cleaned output.
router.get("/download/:sessionId", async (req, res) => {
  try {
    const auth = resolveTenant(req, (req.query.tenantId as string) ?? "");
    if ("error" in auth) { res.status(auth.error === "Unauthorized" ? 401 : 403).json({ error: auth.error }); return; }
    const sessionId = String(req.params.sessionId);
    if (!SESSION_RE.test(sessionId)) { res.status(400).json({ error: "Bad session id" }); return; }

    const reviewed = String(req.query.which ?? "") === "reviewed";
    const file = reviewed
      ? await readReviewedFile(auth.tenant, sessionId)
      : await readCleanedFile(auth.tenant, sessionId);
    if (!file) { res.status(404).json({ error: reviewed ? "Reviewed file not found" : "Cleaned file not ready" }); return; }
    const base = file.fileName.replace(/\.(xlsx|xls)$/i, "");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${base}-${reviewed ? "REVIEWED" : "CLEANED"}.xlsx"`);
    res.send(file.buffer);
  } catch {
    res.status(404).json({ error: "File not ready" });
  }
});

// ── Save the reviewed (decisions-applied) workbook ──────────────────────────
// Called when the user clicks Done on the import review screen. The file is
// built client-side from the final grid state; we keep it next to cleaned.xlsx
// so it can be re-downloaded from History any time.
router.post("/reviewed/:sessionId", upload.single("file"), async (req, res) => {
  try {
    const auth = resolveTenant(req, (req.body?.tenantId as string) ?? "");
    if ("error" in auth) { res.status(auth.error === "Unauthorized" ? 401 : 403).json({ error: auth.error }); return; }
    const sessionId = String(req.params.sessionId);
    if (!SESSION_RE.test(sessionId)) { res.status(400).json({ error: "Bad session id" }); return; }
    if (!req.file) { res.status(400).json({ error: "No file attached." }); return; }
    if (!/\.xlsx$/i.test(req.file.originalname)) {
      res.status(400).json({ error: "Expected an .xlsx file." });
      return;
    }

    // Only attach reviewed files to sessions that actually exist for this
    // tenant — otherwise a bad session id would create orphan S3 objects.
    const st = await readStatus(auth.tenant, sessionId);
    if (!st) { res.status(404).json({ error: "Session not found" }); return; }

    await saveReviewedFile(auth.tenant, sessionId, req.file.buffer);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Chat about the results (SSE, Claude Opus) ───────────────────────────────
router.post("/chat", async (req, res) => {
  const auth = resolveTenant(req, (req.body?.tenantId as string) ?? "");
  if ("error" in auth) { res.status(auth.error === "Unauthorized" ? 401 : 403).json({ error: auth.error }); return; }
  if (!anthropicConfigured()) { res.status(503).json({ error: "AI service not configured." }); return; }

  const sessionId = String(req.body?.sessionId ?? "");
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length) { res.status(400).json({ error: "No messages" }); return; }

  let report: CleaningReport | null = null;
  if (SESSION_RE.test(sessionId)) report = await readReport(auth.tenant, sessionId);
  // Keep the prompt inside its 30k budget: the summary matters more to chat
  // than the (possibly huge) per-row review list, so trim that list.
  const chatReport = report
    ? { ...report, review: (report.review ?? []).slice(0, 60) }
    : null;

  const system = `You are the RM ONE Data Cleaning Assistant. You help operations staff prepare messy client Excel files for import into RM ONE.

How the tool works (explain when asked):
- The user attaches an Excel file; deterministic code maps their columns onto RM ONE's exact import template (tabs: Projects, Team Assignments, Schedule, Staff, Opportunities, Leads, Companies), fixes date/number/email formats, removes duplicates, and cross-checks Project IDs across tabs.
- You (Claude) only adjudicated ambiguous column mappings. Project-name matching is fully deterministic: exact name match (case/whitespace-insensitive) wins; a punctuation-variant match is used only when it points to exactly one project; anything ambiguous is never guessed.
- The output file uses RM ONE's template column names — never the client's original headers — so it drops straight into the Import page.
- Rows with unresolvable problems (ambiguous or unmatched project names, missing required IDs) are MOVED to per-tab review sheets named "<Tab> — Review". Each review sheet has the exact same columns as its main tab plus a final "Remarks" column explaining the problem and listing candidate Project IDs when the name was ambiguous. The user fixes the cell, then copies the row (everything except Remarks) to the bottom of the main tab. Project IDs are only ever assigned on a CERTAIN match — never guessed. Nothing is ever written to the database.

Rules:
- Be concise and concrete. Reference actual numbers from the report below.
- If the user asks about something not in the report, say you can only see the cleaning summary, not the raw data.
- Never invent data that is not in the report.

${chatReport ? `CLEANING REPORT (JSON):\n${JSON.stringify(chatReport).slice(0, 30000)}` : "No file has been analyzed in this session yet — tell the user to attach an Excel file first."}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  try { res.socket?.setNoDelay(true); } catch { /* noop */ }
  res.write(": stream-open\n\n");
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 5000);

  try {
    const stream = anthropic.messages.stream({
      model: CLEANING_MODEL,
      max_tokens: 4096,
      system,
      messages: messages
        .filter((m: { role?: string }) => m?.role === "user" || m?.role === "assistant")
        .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: String(m.content ?? "") }))
        .slice(-20),
    });
    stream.on("text", (text) => {
      res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
    });
    await stream.finalMessage();
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e instanceof Error ? e.message : String(e) })}\n\n`);
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

export default router;
