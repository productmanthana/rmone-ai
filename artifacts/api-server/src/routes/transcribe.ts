import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { toFile } from "openai";
import { openai, openaiConfigured } from "../lib/openai-client.js";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post(
  "/",
  upload.single("audio"),
  async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization ?? req.headers["x-rmone-token"] as string;
    if (!authHeader) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No audio file provided" });
      return;
    }
    if (!openaiConfigured()) {
      res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
      return;
    }

    const wantStream = req.query.stream === "1" || req.query.stream === "true";

    try {
      const mimeType = req.file.mimetype || "audio/webm";
      const ext = mimeType.includes("mp4") || mimeType.includes("m4a") || mimeType.includes("aac") ? "m4a"
        : mimeType.includes("ogg") ? "ogg"
        : mimeType.includes("wav") ? "wav"
        : mimeType.includes("3gp") ? "3gp"
        : "webm";

      const file = await toFile(req.file.buffer, `audio.${ext}`, {
        type: mimeType,
      });

      if (wantStream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();

        const send = (obj: unknown) => {
          res.write(`data: ${JSON.stringify(obj)}\n\n`);
        };

        try {
          const stream = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file,
            response_format: "text",
            stream: true,
          } as any);

          let finalText = "";
          for await (const event of stream as any) {
            const t = event?.type as string | undefined;
            if (t === "transcript.text.delta" && typeof event.delta === "string") {
              finalText += event.delta;
              send({ delta: event.delta });
            } else if (t === "transcript.text.done") {
              if (typeof event.text === "string") finalText = event.text;
              send({ done: true, text: finalText });
            }
          }
          if (!res.writableEnded) {
            send({ done: true, text: finalText });
            res.end();
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send({ error: msg });
          res.end();
        }
        return;
      }

      const transcript = await openai.audio.transcriptions.create({
        model: "gpt-4o-mini-transcribe",
        file,
        response_format: "text",
      });

      res.json({ text: transcript });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

export default router;
