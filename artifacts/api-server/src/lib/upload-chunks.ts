/**
 * Chunked large-file uploads.
 *
 * The production edge (autoscale) rejects any single HTTP request over
 * ~32MB with a bare 413 BEFORE it reaches this server, so big files must
 * arrive as several smaller requests. The frontend slices files into ~20MB
 * pieces and POSTs them sequentially to /upload-chunk, then calls
 * /upload-complete which reassembles the original file and hands it to the
 * same handler the classic single-request /upload route uses.
 *
 * Pieces are stored in SQL Server (dbo.rmone_upload_chunks), NOT local disk
 * or memory: the API runs as multiple cluster workers across multiple
 * autoscale instances, so consecutive requests of one upload can land on
 * different processes/machines. Every piece is bound to the uploading
 * user+tenant (owner key) — completing or overwriting someone else's
 * session is impossible without their auth token.
 */
import multer from "multer";
import {
  insertUploadChunk,
  assembleUploadChunks,
  deleteUploadChunks,
  deleteStaleUploadChunks,
  sumUploadChunkBytes,
} from "@workspace/db";
import { resolveRequestSource } from "./rds-auth.js";
import type { Router, Request, Response } from "express";

// Each piece must stay comfortably under the ~32MB edge cap.
const CHUNK_MAX_BYTES = 30 * 1024 * 1024;
const MAX_CHUNKS = 500;
const SESSION_ID_RE = /^[A-Za-z0-9-]{8,80}$/;

const chunkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CHUNK_MAX_BYTES } });

function ownerKeyFor(req: Request): string | null {
  const src = resolveRequestSource(req);
  if (!src) return null;
  return `${src.tenant ?? ""}|${src.username ?? ""}`;
}

export interface AssembledUpload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export function registerChunkUploadRoutes(router: Router, opts: {
  /** Cap on the reassembled file size (mirrors the route's own multer cap). */
  maxAssembledBytes: number;
  /** Receives the reassembled file; must send the HTTP response itself. */
  onComplete: (file: AssembledUpload, req: Request, res: Response) => Promise<unknown> | unknown;
}): void {
  // ── POST <base>/upload-chunk ─────────────────────────────────────────────
  router.post("/upload-chunk", (req: Request, res: Response) => {
    chunkUpload.single("chunk")(req, res, async (err: unknown) => {
      try {
        if (err) {
          const tooBig = (err as { code?: string })?.code === "LIMIT_FILE_SIZE";
          return res.status(tooBig ? 413 : 400).json({
            error: tooBig ? "Upload piece too large" : `Upload failed: ${(err as Error)?.message ?? String(err)}`,
          });
        }
        const owner = ownerKeyFor(req);
        if (!owner) return res.status(401).json({ error: "Authentication required" });
        const sessionId = String(req.body?.sessionId ?? "").trim();
        const seq = Number(req.body?.seq);
        if (!SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: "Bad session id" });
        if (!Number.isInteger(seq) || seq < 0 || seq >= MAX_CHUNKS) {
          return res.status(400).json({ error: "Bad chunk sequence number" });
        }
        if (!req.file?.buffer?.length) return res.status(400).json({ error: "Empty chunk" });
        // First piece of a session doubles as an opportunistic sweep trigger,
        // so abandoned sessions get cleaned even if no upload ever completes.
        if (seq === 0) void deleteStaleUploadChunks().catch(() => { /* best effort */ });
        await insertUploadChunk(sessionId, seq, owner, req.file.buffer);
        // Running per-session cap: without it an authenticated user could park
        // (pieces × 30MB) per session indefinitely. Checked AFTER the upsert so
        // the total is authoritative; on breach the whole session is dropped.
        const total = await sumUploadChunkBytes(sessionId, owner);
        if (total > opts.maxAssembledBytes) {
          await deleteUploadChunks(sessionId).catch(() => { /* sweep will get it */ });
          return res.status(413).json({
            error: `File is too large to upload (limit ${Math.round(opts.maxAssembledBytes / (1024 * 1024))}MB).`,
          });
        }
        return res.json({ ok: true, seq });
      } catch (e) {
        return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  });

  // ── POST <base>/upload-complete ──────────────────────────────────────────
  // JSON body: { sessionId, fileName, totalChunks, ...passthrough fields }.
  // Passthrough fields (tenantId, forcedTabType, …) stay on req.body where
  // the wrapped upload handler already reads them.
  router.post("/upload-complete", async (req: Request, res: Response) => {
    try {
      const owner = ownerKeyFor(req);
      if (!owner) return res.status(401).json({ error: "Authentication required" });

      const sessionId = String(req.body?.sessionId ?? "").trim();
      const totalChunks = Number(req.body?.totalChunks);
      // basename only — strip any path the client might have sent
      const fileName = String(req.body?.fileName ?? "").split(/[\\/]/).pop()?.trim().slice(0, 300) ?? "";
      if (!SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: "Bad session id" });
      if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) {
        return res.status(400).json({ error: "Bad chunk count" });
      }
      if (!fileName) return res.status(400).json({ error: "fileName is required" });

      const asm = await assembleUploadChunks(sessionId, owner);
      if (!asm) {
        return res.status(404).json({ error: "No uploaded pieces found for this session — please retry the upload." });
      }
      if (asm.count !== totalChunks || !asm.buffer) {
        await deleteUploadChunks(sessionId).catch(() => { /* sweep will get it */ });
        return res.status(400).json({
          error: `Upload incomplete (${asm.count} of ${totalChunks} pieces received) — please retry the upload.`,
        });
      }
      if (asm.buffer.length > opts.maxAssembledBytes) {
        await deleteUploadChunks(sessionId).catch(() => { /* sweep will get it */ });
        return res.status(413).json({
          error: `File is too large to upload (limit ${Math.round(opts.maxAssembledBytes / (1024 * 1024))}MB).`,
        });
      }

      await deleteUploadChunks(sessionId).catch(() => { /* sweep will get it */ });
      void deleteStaleUploadChunks().catch(() => { /* opportunistic sweep only */ });

      const mimetype = /\.xls$/i.test(fileName)
        ? "application/vnd.ms-excel"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      return await opts.onComplete({ buffer: asm.buffer, originalname: fileName, mimetype }, req, res);
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
