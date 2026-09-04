type PromptPayload = {
  prompt: string;
  context?: string;
  ts: number;
  newSession?: boolean;
  autoSend?: boolean;
};
type Listener = (payload: PromptPayload) => void;

const STORAGE_KEY = "rmone:chatBridge:pending";

let _pending: PromptPayload | null = null;
const _dispatchedTs = new Set<number>();
const _listeners = new Set<Listener>();

// Tenant isolation: a pending hand-off prompt carries record context from the
// session that wrote it. If the user signs out / signs into a different
// tenant in the same tab before the chat page consumed it, the stale prompt
// would auto-send against the NEW tenant. login()/logout() dispatch
// rmone:authChanged — drop any pending payload at that boundary.
if (typeof window !== "undefined") {
  window.addEventListener("rmone:authChanged", () => {
    _pending = null;
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  });
}

/**
 * Module-scope claim so multiple React mounts (StrictMode) don't double-fetch
 * the same dispatch. Returns true exactly once per ts within the JS context.
 */
export function claimChatPrompt(ts: number): boolean {
  if (_dispatchedTs.has(ts)) return false;
  _dispatchedTs.add(ts);
  if (_dispatchedTs.size > 20) {
    const it = _dispatchedTs.values();
    for (let i = 0; i < 10; i++) {
      const next = it.next();
      if (next.done) break;
      _dispatchedTs.delete(next.value as number);
    }
  }
  return true;
}

function loadFromStorage(): PromptPayload | null {
  try {
    const raw =
      typeof window !== "undefined" ? window.sessionStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    return JSON.parse(raw) as PromptPayload;
  } catch {
    return null;
  }
}

function saveToStorage(payload: PromptPayload | null) {
  try {
    if (typeof window === "undefined") return;
    if (payload) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function setChatPrompt(
  prompt: string,
  opts?: { context?: string; newSession?: boolean; autoSend?: boolean },
) {
  const payload: PromptPayload = {
    prompt,
    context: opts?.context,
    newSession: opts?.newSession,
    autoSend: opts?.autoSend ?? true,
    ts: Date.now(),
  };
  _pending = payload;
  saveToStorage(payload);
  // Defensive: a fresh hand-off should never land the user back on a previous
  // chat session. Wipe every persisted active-session-id key so the chat page
  // can't fall back to a stale conversation if the hand-off useState fails to
  // pick up the payload for any reason. (Username-scoped keys all share the
  // `rmone_active_session_v2` prefix.)
  try {
    if (typeof window !== "undefined" && opts?.newSession) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith("rmone_active_session_v2")) keysToRemove.push(k);
      }
      keysToRemove.forEach((k) => window.localStorage.removeItem(k));
    }
  } catch {
    // ignore quota/security errors
  }
  _listeners.forEach((fn) => fn(payload));
}

export function consumeChatPrompt(): PromptPayload | null {
  const fromMem = _pending;
  const fromStore = loadFromStorage();
  const p = fromMem ?? fromStore;
  _pending = null;
  saveToStorage(null);
  return p;
}

export function peekChatPrompt(): PromptPayload | null {
  return _pending ?? loadFromStorage();
}

export function onChatPrompt(fn: Listener): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

const _scheduleListeners = new Set<() => void>();
export function notifyScheduleChanged() {
  _scheduleListeners.forEach((fn) => fn());
}
export function onScheduleChanged(fn: () => void): () => void {
  _scheduleListeners.add(fn);
  return () => {
    _scheduleListeners.delete(fn);
  };
}
