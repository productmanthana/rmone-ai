import { Router, type IRouter, type Request, type Response } from "express";
import {
  getChatSessions,
  upsertChatSession,
  deleteChatSession,
  pruneOldChatSessions,
} from "@workspace/db";
import { verifyRdsToken } from "../lib/rds-auth.js";
import { isValidSessionToken } from "./rmone-proxy.js";

const router: IRouter = Router();

const MAX_SESSIONS = 20;
const MAX_MESSAGES = 100;

interface UserCtx { tenant: string; username: string }

async function resolveUser(req: Request): Promise<UserCtx | null> {
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  const tenantHeader = String(req.headers["x-rmone-tenant"] ?? "").trim().toLowerCase();
  const usernameHeader = String(req.headers["x-rmone-username"] ?? "").trim().toLowerCase();

  const rds = verifyRdsToken(bearer);
  if (rds) {
    return {
      tenant: (rds.tenant ?? tenantHeader).toLowerCase(),
      username: rds.username.toLowerCase(),
    };
  }

  if ((await isValidSessionToken(bearer)) && tenantHeader && usernameHeader) {
    return { tenant: tenantHeader, username: usernameHeader };
  }

  return null;
}

router.get("/sessions", async (req: Request, res: Response) => {
  const ctx = await resolveUser(req);
  if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const rows = await getChatSessions(ctx.tenant, ctx.username);
    const sessions = rows.map(r => {
      let messages: unknown[] = [];
      try { messages = JSON.parse(r.messages); } catch { messages = []; }
      return {
        id: r.sessionId,
        title: r.title,
        timestamp: r.lastActivity,
        messages,
      };
    });
    res.json({ sessions });
  } catch (e: any) {
    console.error("[chat-sessions] GET error:", e?.message);
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

router.post("/sessions", async (req: Request, res: Response) => {
  const ctx = await resolveUser(req);
  if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { id, title, timestamp, messages } = req.body ?? {};
  if (!id || typeof id !== "string") { res.status(400).json({ error: "session id required" }); return; }

  try {
    const trimmedMessages = Array.isArray(messages)
      ? messages.slice(-MAX_MESSAGES)
      : [];

    await upsertChatSession(ctx.tenant, ctx.username, {
      sessionId: id,
      title: String(title ?? "").slice(0, 500),
      messages: JSON.stringify(trimmedMessages),
      lastActivity: Number(timestamp) || Date.now(),
    });

    await pruneOldChatSessions(ctx.tenant, ctx.username, MAX_SESSIONS).catch(() => {});

    res.json({ ok: true });
  } catch (e: any) {
    console.error("[chat-sessions] POST error:", e?.message);
    res.status(500).json({ error: "Failed to save session" });
  }
});

router.delete("/sessions/:sessionId", async (req: Request, res: Response) => {
  const ctx = await resolveUser(req);
  if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { sessionId } = req.params;
  if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }

  try {
    await deleteChatSession(ctx.tenant, ctx.username, String(sessionId));
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[chat-sessions] DELETE error:", e?.message);
    res.status(500).json({ error: "Failed to delete session" });
  }
});

export default router;
