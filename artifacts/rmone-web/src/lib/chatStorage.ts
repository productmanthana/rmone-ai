/**
 * Web-side chat session persistence. Mirrors the mobile schema (rmone_sessions_v2)
 * so a future shared backend could migrate transparently. Tenant+username-scoped.
 *
 * Cross-user isolation is enforced at two levels:
 *  1. Storage key: `rmone_sessions_v2_${tenant}_${username}`
 *  2. Owner tag: every saved session carries `_owner: "${tenant}|${username}"`.
 *     On load, sessions whose `_owner` doesn't match the current user are
 *     silently discarded. This catches sessions that were incorrectly migrated
 *     into the current user's key (e.g. same email, different tenant).
 */

import type { ChatSession } from "./chatTypes";

// ─── API base ─────────────────────────────────────────────────────────────────
// Relative URL works for the browser (same-origin SPA). Falls back gracefully
// when called outside a browser context (tests, SSR).
const CHAT_API =
  typeof window !== "undefined"
    ? `${(import.meta as any).env?.BASE_URL ?? "/"}`.replace(/\/$/, "") + "/api/chat"
    : "/api/chat";

const SESSIONS_KEY_PREFIX = "rmone_sessions_v2";
const ACTIVE_KEY_PREFIX = "rmone_active_session_v2";
const MAX_SESSIONS = 10;
const MAX_MESSAGES_PER_SESSION = 40;

function getSessionsKey(username?: string, tenant?: string): string {
  if (username && tenant) return `${SESSIONS_KEY_PREFIX}_${tenant.toLowerCase()}_${username.toLowerCase()}`;
  if (username) return `${SESSIONS_KEY_PREFIX}_${username.toLowerCase()}`;
  return SESSIONS_KEY_PREFIX;
}

function getActiveKey(username?: string, tenant?: string): string {
  if (username && tenant) return `${ACTIVE_KEY_PREFIX}_${tenant.toLowerCase()}_${username.toLowerCase()}`;
  if (username) return `${ACTIVE_KEY_PREFIX}_${username.toLowerCase()}`;
  return ACTIVE_KEY_PREFIX;
}

/** Canonical owner string embedded in each session. */
function makeOwnerKey(username?: string, tenant?: string): string | undefined {
  return username && tenant
    ? `${tenant.toLowerCase()}|${username.toLowerCase()}`
    : undefined;
}

/**
 * Filter out sessions whose `_owner` is set to a *different* user.
 * Sessions with no `_owner` (written before this field was added) are kept
 * for backward compatibility — they'll receive the correct tag on next save.
 */
function filterByOwner(sessions: ChatSession[], ownerKey: string | undefined): ChatSession[] {
  if (!ownerKey) return sessions;
  return sessions.filter((s) => !s._owner || s._owner === ownerKey);
}

export function loadSessions(username?: string, tenant?: string): ChatSession[] {
  try {
    const key = getSessionsKey(username, tenant);
    const owner = makeOwnerKey(username, tenant);
    const raw = localStorage.getItem(key);
    if (!raw) {
      // Migrate from legacy username-only key when switching to tenant-scoped key
      if (username && tenant) {
        const legacyKey = getSessionsKey(username);
        const legacyRaw = localStorage.getItem(legacyKey);
        if (legacyRaw) {
          const arr = JSON.parse(legacyRaw) as ChatSession[];
          if (Array.isArray(arr) && arr.length > 0) {
            // Copy to the new tenant-scoped key, filtering any sessions that
            // already carry a different user's owner tag (cross-tenant migration
            // of same-email accounts). Remove the legacy key so a second tenant
            // with the same email cannot also migrate these sessions.
            const filtered = filterByOwner(arr, owner);
            localStorage.setItem(key, JSON.stringify(filtered));
            localStorage.removeItem(legacyKey);
            return filtered;
          }
        }
      }
      return [];
    }
    const arr = JSON.parse(raw) as ChatSession[];
    if (!Array.isArray(arr)) return [];
    // Discard any sessions that belong to a different user (owner mismatch).
    // This cleans up sessions that were incorrectly migrated into this key
    // before the owner-tag mechanism was introduced.
    return filterByOwner(arr, owner);
  } catch {
    return [];
  }
}

/**
 * Strip the prefill / autosave pipe-segments from any WEEKLY_ALLOC tag in
 * persisted assistant messages. Without this, restoring a session re-renders
 * the widget with the original directive — re-applying the prefill on top of
 * the now-saved server hours and (if autosave was set) silently saving again.
 *
 * Mobile parity: artifacts/rmone-mobile/app/(tabs)/chat.tsx neuterAllocTagsForStorage.
 * The live in-memory message stays intact; only the persisted copy is scrubbed.
 */
function neuterAllocTagsForStorage(text: string): string {
  return text.replace(
    /\[[^\]\[|]{0,4}WEEKLY_ALLOC:([^|\]]+)\|([^|\]]+)\|([^|\]]+)(?:\|[^\]]*)?(?:\|[^\]]*)?\]/g,
    "[WEEKLY_ALLOC:$1|$2|$3]",
  );
}

export function saveSessions(sessions: ChatSession[], username?: string, tenant?: string) {
  // Never write when the user is not fully authenticated — this can happen when
  // the persist effect fires after logout (username/tenant become undefined),
  // which would incorrectly save sessions under the bare "rmone_sessions_v2"
  // key and make them visible to the next user who loads without a valid token.
  if (!username || !tenant) return;

  const owner = makeOwnerKey(username, tenant);
  const trimmed = sessions.slice(0, MAX_SESSIONS).map((s) => ({
    ...s,
    _owner: owner,
    messages: s.messages.slice(-MAX_MESSAGES_PER_SESSION).map((m) =>
      m.role === "assistant" && typeof m.content === "string"
        ? { ...m, content: neuterAllocTagsForStorage(m.content) }
        : m
    ),
  }));
  const key = getSessionsKey(username, tenant);
  try {
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    try {
      const fewer = trimmed.slice(0, 3).map((s) => ({
        ...s,
        messages: s.messages.slice(-20),
      }));
      localStorage.setItem(key, JSON.stringify(fewer));
    } catch {
      localStorage.removeItem(key);
    }
  }
}

export function loadActiveSessionId(username?: string, tenant?: string): string | null {
  try {
    return localStorage.getItem(getActiveKey(username, tenant));
  } catch {
    return null;
  }
}

export function saveActiveSessionId(id: string | null, username?: string, tenant?: string) {
  try {
    const key = getActiveKey(username, tenant);
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ─── Database-backed session sync ─────────────────────────────────────────────
// These functions mirror the localStorage helpers above but persist sessions in
// SQL Server so chat history survives across devices and browser clears.
// All calls are fire-and-forget safe (catch-all, never throw).

function prepareSessionForDb(session: ChatSession): object {
  const messages = session.messages.slice(-100).map((m) =>
    m.role === "assistant" && typeof m.content === "string"
      ? { ...m, content: neuterAllocTagsForStorage(m.content) }
      : m,
  );
  return {
    id: session.id,
    title: session.title,
    timestamp: session.timestamp,
    messages,
  };
}

function makeDbHeaders(token: string, username: string, tenant: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "x-rmone-tenant": tenant.toLowerCase(),
    "x-rmone-username": username.toLowerCase(),
    "Content-Type": "application/json",
  };
}

export async function loadSessionsFromDb(
  token: string,
  username: string,
  tenant: string,
): Promise<ChatSession[]> {
  if (!token || !username || !tenant) return [];
  try {
    const res = await fetch(`${CHAT_API}/sessions`, {
      headers: makeDbHeaders(token, username, tenant),
    });
    if (!res.ok) return [];
    const data = await res.json() as { sessions?: ChatSession[] };
    return Array.isArray(data.sessions) ? data.sessions : [];
  } catch {
    return [];
  }
}

export async function saveSessionToDb(
  token: string,
  username: string,
  tenant: string,
  session: ChatSession,
): Promise<void> {
  if (!token || !username || !tenant) return;
  try {
    await fetch(`${CHAT_API}/sessions`, {
      method: "POST",
      headers: makeDbHeaders(token, username, tenant),
      body: JSON.stringify(prepareSessionForDb(session)),
    });
  } catch {
    // non-fatal
  }
}

export async function deleteSessionFromDb(
  token: string,
  username: string,
  tenant: string,
  sessionId: string,
): Promise<void> {
  if (!token || !username || !tenant) return;
  try {
    await fetch(`${CHAT_API}/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: makeDbHeaders(token, username, tenant),
    });
  } catch {
    // non-fatal
  }
}

export function makeSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function sessionTitle(messages: { role: string; content: string }[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New conversation";
  const t = (first.content || "").trim();
  return t.length > 40 ? t.slice(0, 38) + "…" : t;
}

export function groupSessions(sessions: ChatSession[]): { label: string; items: ChatSession[] }[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yestStart = todayStart.getTime() - 86400000;
  const weekStart = todayStart.getTime() - 6 * 86400000;
  const groups = [
    { label: "Today", items: [] as ChatSession[] },
    { label: "Yesterday", items: [] as ChatSession[] },
    { label: "This Week", items: [] as ChatSession[] },
    { label: "Older", items: [] as ChatSession[] },
  ];
  for (const s of sessions) {
    if (s.timestamp >= todayStart.getTime()) groups[0].items.push(s);
    else if (s.timestamp >= yestStart) groups[1].items.push(s);
    else if (s.timestamp >= weekStart) groups[2].items.push(s);
    else groups[3].items.push(s);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function formatSessionDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
