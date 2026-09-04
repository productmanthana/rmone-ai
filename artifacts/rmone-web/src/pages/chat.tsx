import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  BarChart2, Bot, Briefcase, Building2, ChevronLeft, ChevronRight,
  DollarSign as DollarSignIcon, FolderOpen, Mail, Menu, MessageSquare,
  Mic, Pencil, Plus, Send, Square, Trash2, TrendingUp, User, Users,
} from "lucide-react";

import { chatStream, getTaskDataWithLifecycle, getStoredUser } from "@/lib/api";
import { refreshProjectTeamCache } from "@/lib/teamCache";
import { queryClient } from "@/lib/queryClient";
import { fetchSignalsCount } from "@/lib/homeLiveData";
import { getDashboardSnapshot } from "@/lib/dashboardSnapshot";
import { useAuth } from "@/lib/useAuth";
import {
  consumeChatPrompt, onChatPrompt,
} from "@/lib/chatBridge";
import {
  formatSessionDate, groupSessions, loadActiveSessionId,
  loadSessions, makeSessionId, saveActiveSessionId, saveSessions, sessionTitle,
  loadSessionsFromDb, saveSessionToDb, deleteSessionFromDb,
} from "@/lib/chatStorage";
import type { ChatMessage, ChatSession } from "@/lib/chatTypes";
import { ChatContent } from "@/components/chat/ChatContent";
import { setLastUserMessageForParser } from "@/components/chat/parseBlocks";
import { EditDraftModal, parseDraftFromText, type EditDraftValue } from "@/components/chat/EditDraftModal";
import { InboxModal } from "@/components/chat/InboxModal";
import { VoiceButton } from "@/components/chat/VoiceButton";
import {
  startInboxPolling, stopInboxPolling, subscribeInbox, getUnreadCount,
  setInboxUser, onNewMail,
} from "@/lib/inboxStore";
import { Z } from "@/lib/zLayers";

/* ─────────────  PALETTE (matches mobile chat)  ───────────── */
const BRAND = {
  bg: "var(--rm-bg)",
  bgDeep: "var(--rm-bg)",
  // Top header + conversations sidebar share the page background so the
  // entire chat surface (Shell sidebar → conv sidebar → message area) reads
  // as one continuous panel with no shade differences. Assistant message
  // bubbles below intentionally stay on white cards.
  headerBg: "var(--rm-bg)",
  chatSidebarBg: "var(--rm-bg)",
  chatSidebarBorder: "var(--rm-panel-border)",
  card: "var(--rm-panel)",
  cardBorder: "var(--rm-panel-border)",
  text: "var(--rm-text)",
  textMuted: "var(--rm-text-muted)",
  textOnDark: "var(--rm-text)",
  green: "#6BA539",
  greenBg: "var(--rm-green)",
  greenLight: "#9DC957",
  orange: "#E87722",
  red: "#E03C3C",
  bubbleUser: "var(--rm-panel)",
  bubbleAssistantBg: "var(--rm-panel)",
};

const QUICK_PROMPTS: { icon: React.ComponentType<{ size?: number; color?: string }>;
  text: string; color: string }[] = [
  { icon: Briefcase,  text: "Who is under-utilized?",    color: BRAND.green },
  { icon: Users,      text: "Show bench resources",      color: BRAND.orange },
  { icon: TrendingUp, text: "Pipeline health summary",   color: BRAND.greenLight },
  { icon: Mail,       text: "Send an email",             color: BRAND.green },
];

/* ─────────────  ROOT PAGE  ───────────── */
export default function ChatPage() {
  const { user, handleAuthError } = useAuth();
  const username = user?.username ?? undefined;
  const tenant = user?.tenant ?? undefined;

  // Capture any pending hand-off prompt EXACTLY ONCE at mount, before any other
  // hook runs. This is the only place we consume the chatBridge — subsequent
  // re-renders read the same captured value. The mount effect later turns this
  // into a real chatStream() call against the pre-created session.
  const [handoff] = useState(() => {
    const p = consumeChatPrompt();
    if (!p || p.autoSend === false) return null;
    const sid = makeSessionId();
    const ts = Date.now();
    const userMsg: ChatMessage = { id: `u-${ts}`, role: "user", content: p.prompt };
    const assistantMsg: ChatMessage = {
      id: `a-${ts}`, role: "assistant", content: "", isStreaming: true,
    };
    const session: ChatSession = {
      id: sid,
      title: sessionTitle([{ role: "user", content: p.prompt }]),
      timestamp: ts,
      messages: [userMsg, assistantMsg],
    };
    return { sid, session, hiddenContext: p.context, assistantMsgId: assistantMsg.id };
  });

  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    // Sanitize persisted sessions: any assistant message still flagged as
    // `isStreaming: true` is a stale flag from a previous tab/route switch
    // that unmounted the chat page mid-stream — no network request can
    // possibly be in flight at mount time. Leaving it set causes the
    // "RM ONE AI Agents are evaluating…" spinner to show forever. Clear it
    // and add a polite recovery note when the assistant bubble was empty.
    const sanitize = (list: ChatSession[]): ChatSession[] =>
      list.map((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.role === "assistant" && m.isStreaming
            ? {
                ...m,
                isStreaming: false,
                content: m.content || "The reply was interrupted. Please send the question again.",
              }
            : m,
        ),
      }));
    const existing = sanitize(loadSessions(username, tenant));
    return handoff ? [handoff.session, ...existing] : existing;
  });
  // When navigating into the chat page from another route, ALWAYS start
  // with a brand-new empty conversation. Existing sessions remain in
  // history (sidebar) but the page opens on a clean slate every time.
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (handoff) return handoff.sid;
    return null; // a fresh session is created by the mount effect below
  });
  // Conversations sidebar always starts CLOSED on every visit — user
  // opts in via the menu button each session. (Previously persisted to
  // localStorage, but the user wants a clean, always-off default.)
  // Conversations sidebar is now ALWAYS open per design — the user asked
  // us to remove the show/hide toggle entirely so history is always visible.
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [streaming, setStreaming] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("openInbox") === "1";
  });
  const [unread, setUnread] = useState(0);
  const [bellShake, setBellShake] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Inbox: subscribe + start polling once we have a username
  useEffect(() => {
    if (!username) return;
    setInboxUser(username, user?.userRoles);
    const unsub = subscribeInbox(() => setUnread(getUnreadCount()));
    const offNew = onNewMail(() => {
      setBellShake(true);
      setTimeout(() => setBellShake(false), 900);
    });
    startInboxPolling(30000);
    return () => { unsub(); offNew(); stopInboxPolling(); };
  }, [username, user?.userRoles]);

  // ── Load history from DB on mount (after localStorage init) ──────────────
  // Fetch sessions stored in SQL Server and merge: any session from another
  // device or browser that isn't already in localStorage will appear in the
  // sidebar. Already-present sessions are kept as-is (local copy is current).
  useEffect(() => {
    if (!username || !tenant) return;
    const token = window.localStorage.getItem("rmone_token") ?? "";
    if (!token) return;
    loadSessionsFromDb(token, username, tenant).then((dbSessions) => {
      if (dbSessions.length === 0) return;
      setSessions((prev) => {
        const byId = new Map(prev.map((s) => [s.id, s]));
        for (const ds of dbSessions) {
          if (!byId.has(ds.id)) byId.set(ds.id, ds);
          // If DB version is newer (e.g. saved from another device), prefer it
          else if (ds.timestamp > (byId.get(ds.id)!.timestamp ?? 0)) byId.set(ds.id, ds);
        }
        return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
      });
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, tenant]); // intentionally runs only once on mount

  // Persist whenever sessions or active id changes. The persist effect used
  // to fire on every SSE chunk during streaming, and each `saveSessions`
  // call serializes the whole sessions array to a JSON string and writes
  // it to localStorage — easily 5–50ms per chunk on long replies. We
  // debounce to once every 800ms and force one final flush whenever
  // streaming flips back to false so the final reply is always persisted.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    const delay = streaming ? 800 : 0;
    persistTimerRef.current = setTimeout(() => {
      saveSessions(sessions, username, tenant);
      // Also push the active session to SQL Server so it survives across devices.
      if (activeId && username && tenant) {
        const active = sessions.find((s) => s.id === activeId);
        if (active) {
          const token = window.localStorage.getItem("rmone_token") ?? "";
          saveSessionToDb(token, username, tenant, active).catch(() => {});
        }
      }
    }, delay);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [sessions, username, tenant, streaming, activeId]);
  useEffect(() => { saveActiveSessionId(activeId, username, tenant); }, [activeId, username, tenant]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  /* Update one session immutably */
  const updateSession = useCallback((id: string, fn: (s: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
  }, []);

  /* Create a fresh session and return its id */
  const createSession = useCallback((): string => {
    const id = makeSessionId();
    const newSession: ChatSession = {
      id,
      title: "New conversation",
      timestamp: Date.now(),
      messages: [],
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveId(id);
    return id;
  }, []);

  // Refs that always hold the latest values — used by long-lived subscriptions
  // (chatBridge listener) and by sendPrompt itself so it never relies on
  // synchronous-updater contracts of setState.
  const sessionsRef = useRef<ChatSession[]>(sessions);
  const activeIdRef = useRef<string | null>(activeId);
  const streamingRef = useRef<boolean>(streaming);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);

  // Per-session sticky hidden context + image attachments. Mirrors mobile's
  // `sessionHiddenCtxRef` / `sessionImagesRef` (chat.tsx ~4258). When a caller
  // (e.g. a future email-reply flow) passes hiddenContext on one turn we
  // remember it so subsequent follow-up turns in the same session keep the
  // [THREAD_CONTEXT_START]…[THREAD_CONTEXT_END] / [REPLY_INSTRUCTIONS] block
  // attached. We bind the sticky values to the session id they were captured
  // for so that switching sessions clears them, but creating a brand-new
  // session inside `sendPrompt` (newSession=true) does NOT race-clear the
  // context that was just stored — the activeId effect only clears when the
  // user navigates to a *different* session.
  const sessionHiddenCtxRef = useRef<{ sid: string; value: string } | undefined>(undefined);
  const sessionImagesRef = useRef<{
    sid: string;
    value: Array<{ filename: string; dataUrl: string }>;
  } | undefined>(undefined);

  useEffect(() => {
    if (sessionHiddenCtxRef.current && sessionHiddenCtxRef.current.sid !== activeId) {
      sessionHiddenCtxRef.current = undefined;
    }
    if (sessionImagesRef.current && sessionImagesRef.current.sid !== activeId) {
      sessionImagesRef.current = undefined;
    }
  }, [activeId]);

  // Real human display name for AI-drafted email signing. Falls back to
  // username so the server always receives something non-empty.
  const displayNameRef = useRef<string>(username ?? "");
  useEffect(() => {
    displayNameRef.current = (user?.displayName ?? "").trim() || (username ?? "");
  }, [user?.displayName, username]);

  /* Send a user prompt; create a new session on demand.
   *
   * `extraAssistantMsgs` is used by the email-draft editor: it lets the caller
   * inject one or more synthetic assistant messages BEFORE the new user turn
   * so the server-side handler can read the latest edited draft from history
   * (mirrors mobile sendMessage's `extraAssistantMsgs` parameter). Passing
   * messages explicitly avoids any race between setSessions / sessionsRef. */
  const sendPrompt = useCallback(async (
    prompt: string,
    opts?: {
      newSession?: boolean;
      /** Hidden context block (e.g. selected email + thread context) — sticky
       *  across follow-up turns in this session, mirrors mobile sendMessage's
       *  `hiddenContext` parameter. */
      hiddenContext?: string;
      /** Optional inline image attachments, mirrors mobile sendMessage's
       *  `imageAttachments` parameter. */
      imageAttachments?: Array<{ filename: string; dataUrl: string }>;
    },
    extraAssistantMsgs?: Array<{ role: "assistant"; content: string }>,
  ) => {
    const text = prompt.trim();
    if (!text || streamingRef.current) return;

    // Stash the latest user wording so parseBlocks can synthesise a prefill
    // payload for bare WEEKLY_ALLOC tags emitted by the model (e.g. user said
    // "make it 40 hours per week each" but model returned just the tag).
    // Mirrors mobile chat.tsx setLastUserMessageForParser at sendMessage entry.
    setLastUserMessageForParser(text);

    // Resolve / create the target session deterministically from refs
    let sid = activeIdRef.current;
    let baseMessages: ChatMessage[] = [];
    if (opts?.newSession || !sid) {
      sid = makeSessionId();
      const newSession: ChatSession = {
        id: sid, title: "New conversation", timestamp: Date.now(), messages: [],
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveId(sid);
    } else {
      const existing = sessionsRef.current.find((s) => s.id === sid);
      baseMessages = existing ? existing.messages : [];
    }

    // Sticky hidden context + image attachments (mirrors mobile chat.tsx ~5043).
    // We bind to the resolved `sid` so the activeId effect doesn't race-clear
    // newly-stored context when this call also created the session.
    if (opts?.hiddenContext) {
      sessionHiddenCtxRef.current = { sid, value: opts.hiddenContext };
    }
    if (opts?.imageAttachments && opts.imageAttachments.length > 0) {
      sessionImagesRef.current = { sid, value: opts.imageAttachments };
    }
    const effectiveHidden = opts?.hiddenContext
      ?? (sessionHiddenCtxRef.current?.sid === sid
          ? sessionHiddenCtxRef.current.value
          : undefined);
    const effectiveImages = opts?.imageAttachments
      ?? (sessionImagesRef.current?.sid === sid
          ? sessionImagesRef.current.value
          : undefined);

    const ts = Date.now();
    // Append any synthetic assistant messages first (e.g. an edited email
    // draft) so they appear immediately above the new user turn in history.
    const synthMsgs: ChatMessage[] = (extraAssistantMsgs ?? []).map((m, i) => ({
      id: `a-extra-${ts}-${i}`,
      role: "assistant",
      content: m.content,
      isStreaming: false,
    }));
    const userMsg: ChatMessage = { id: `u-${ts}`, role: "user", content: text };
    const assistantMsg: ChatMessage = {
      id: `a-${ts}`, role: "assistant", content: "", isStreaming: true,
    };
    const newMessages = [...baseMessages, ...synthMsgs, userMsg, assistantMsg];

    // History to send (without the empty assistant placeholder)
    const historyForApi = newMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, -1)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // Now apply the state update with a known final shape
    const targetSid = sid;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== targetSid) return s;
        const next = { ...s, messages: newMessages, timestamp: ts };
        if (newMessages.filter((m) => m.role === "user").length === 1) {
          next.title = sessionTitle(newMessages);
        }
        return next;
      }),
    );

    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      let buffer = "";
      let errored: string | null = null;
      await chatStream(historyForApi, (evt) => {
        // Helper to patch the assistant message in-place
        const patch = (mut: (m: ChatMessage) => ChatMessage) => {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== targetSid) return s;
              return {
                ...s,
                messages: s.messages.map((m) => (m.id === assistantMsg.id ? mut(m) : m)),
              };
            }),
          );
        };
        switch (evt.type) {
          case "content":
            buffer += evt.text;
            patch((m) => ({ ...m, content: buffer, statusText: undefined }));
            break;
          case "status":
            // Live tool-progress line while the server executes tools.
            patch((m) => ({ ...m, statusText: evt.text || undefined }));
            break;
          case "token":
            // Marker tokens (e.g. "[WEEKLY_ALLOC:...]") emitted alongside text;
            // append on its own line so parseBlocks sees them.
            buffer += (buffer && !buffer.endsWith("\n") ? "\n" : "") + evt.text;
            patch((m) => ({ ...m, content: buffer }));
            // When the assign_person tool completes, the server streams a
            // [WEEKLY_ALLOC:person|projectId|...] token. Invalidate the
            // project-team cache immediately so the Team modal shows the new
            // member without waiting for the 10-minute stale time to expire.
            if (evt.text.includes("WEEKLY_ALLOC:")) {
              const wam = evt.text.match(/WEEKLY_ALLOC:[^|]+\|([^|\]\s]+)/);
              if (wam?.[1]) {
                const pid = wam[1].trim();
                refreshProjectTeamCache(queryClient, pid);
                queryClient.invalidateQueries({ queryKey: ["project-allocations-raw", pid] });
              }
            }
            break;
          case "roster":
            patch((m) => ({ ...m, roster: evt.data }));
            break;
          case "oppTable":
            patch((m) => ({ ...m, oppTable: evt.data }));
            break;
          case "oppTable2":
            patch((m) => ({ ...m, oppTable2: evt.data }));
            break;
          case "pmmTable":
            patch((m) => ({ ...m, pmmTable: evt.data }));
            break;
          case "personProfile":
            patch((m) => ({ ...m, personProfile: evt.data }));
            break;
          case "error":
            errored = evt.message;
            // Server/stall-watchdog error messages are already user-facing —
            // show them directly instead of prefixing "Something went wrong:".
            buffer = `⚠️ ${evt.message.slice(0, 300)}`;
            patch((m) => ({ ...m, content: buffer, statusText: undefined }));
            break;
          case "cacheBust":
            // When the server signals a successful assign_person, it includes
            // the project_id so we can bust the right React Query keys — making
            // the Team modal show the new member without a manual refresh.
            if (evt.projectId) {
              refreshProjectTeamCache(queryClient, evt.projectId);
              queryClient.invalidateQueries({ queryKey: ["project-allocations-raw", evt.projectId] });
            }
            break;
          case "done":
            patch((m) => ({ ...m, statusText: undefined }));
            break;
        }
      }, ctrl.signal, {
        displayName: displayNameRef.current,
        hiddenContext: effectiveHidden,
        imageAttachments: effectiveImages,
        dashboardContext: getDashboardSnapshot() ?? undefined,
      });
      // After stream resolves, if it ended via {error}, surface it via thrown
      // logic the catch already handles above; otherwise no-op.
      if (errored && !buffer) throw new Error(errored);
    } catch (err) {
      if ((err as { code?: string }).code === "SESSION_EXPIRED") {
        await handleAuthError();
        return;
      }
      // Don't show an error message when the user explicitly aborted
      const aborted = ctrl.signal.aborted;
      const rawMsg = err instanceof Error ? err.message : "";
      // Raw browser network failures ("network error", "Failed to fetch",
      // "Load failed") are meaningless to the user — show a friendly line.
      const msg = rawMsg && !/failed to fetch|network\s?error|load failed|fetch failed/i.test(rawMsg)
        ? rawMsg
        : "The connection dropped while generating the reply — please try sending your question again.";
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== targetSid) return s;
          const msgs = s.messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: m.content || (aborted ? "" : `⚠️ ${msg}`) }
              : m,
          );
          return { ...s, messages: msgs };
        }),
      );
    } finally {
      // Only clear streaming if THIS controller is still the active one
      if (abortRef.current === ctrl) {
        setStreaming(false);
        abortRef.current = null;
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== targetSid) return s;
          const msgs = s.messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, isStreaming: false } : m,
          );
          return { ...s, messages: msgs };
        }),
      );
    }
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Stable single-arg wrapper for `<MessageList>`. The list passes this down
  // into every `<Bubble>` for ID-cell click / button-block clicks. Keeping it
  // referentially stable lets the React.memo on Bubble actually skip re-
  // rendering completed messages during streaming — without useCallback, the
  // inline lambda was re-created on every chunk and broke the memo.
  const sendPromptSimple = useCallback((text: string) => {
    void sendPrompt(text);
  }, [sendPrompt]);

  // Stable per-message chip-confirm handler hoisted out of the render path.
  // Mirrors the previous inline lambda exactly: persist the SITREP chip
  // confirmation onto the assistant message so it survives re-renders,
  // scroll virtualization, and full session reloads.
  const onChipConfirm = useCallback((messageId: string, actionIndex: number) => {
    const sid = activeIdRef.current;
    if (!sid) return;
    updateSession(sid, (s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        if (m.chipStates?.[actionIndex] === true) return m;
        return { ...m, chipStates: { ...(m.chipStates ?? {}), [actionIndex]: true } };
      }),
    }));
  }, [updateSession]);

  /* ──────────────────────────────────────────────────────────────────
   * Email Draft Editor
   * Mirrors the mobile openEditDraft / confirmEditedDraft / cancelEdited
   * Draft flow: user clicks EDIT on a draft assistant message, we parse
   * subject / body / recipient, open a modal for them to tweak, then on
   * confirm we drop a synthetic assistant message back into the active
   * session and fire YES_SEND so the server picks up the edited draft
   * from the conversation history.
   * ──────────────────────────────────────────────────────────────── */
  const [editDraft, setEditDraft] = useState<EditDraftValue | null>(null);

  const openEditDraft = useCallback(async (rawText: string) => {
    // Expand [SCHEDULE_TABLE:projectId] tags into inline markdown so the
    // recipient sees the actual phases instead of a stripped widget tag.
    const expandSchedule = async (projectId: string): Promise<string | null> => {
      try {
        const { data: raw } = await getTaskDataWithLifecycle(projectId);
        const arr: any[] = Array.isArray(raw)
          ? raw
          : ((raw as any)?.Data ?? (raw as any)?.data ?? []);
        const sorted = [...arr].sort(
          (a: any, b: any) => (a.ItemOrder ?? 0) - (b.ItemOrder ?? 0),
        );
        const fmtD = (d: string) => {
          if (!d) return "";
          const dt = new Date(d);
          if (isNaN(dt.getTime())) return d;
          return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        };
        const weeksBetween = (a: string, b: string): string => {
          if (!a || !b) return "";
          const da = new Date(a).getTime();
          const db = new Date(b).getTime();
          if (isNaN(da) || isNaN(db) || db < da) return "";
          const w = Math.max(1, Math.ceil((db - da) / (7 * 86400000)));
          return ` (${w} ${w === 1 ? "week" : "weeks"})`;
        };
        const lines: string[] = ["Schedule:"];
        sorted.forEach((t: any, i: number) => {
          const s = fmtD(t.StartDate || "");
          const e = fmtD(t.DueDate || "");
          const w = weeksBetween(t.StartDate || "", t.DueDate || "");
          lines.push(`${i + 1}. ${t.Title || ""} — ${s} → ${e}${w}`);
        });
        return "\n" + lines.join("\n") + "\n";
      } catch {
        return null;
      }
    };
    try {
      const parsed = await parseDraftFromText(rawText, expandSchedule);
      setEditDraft(parsed);
    } catch (e) {
      console.warn("[chat] parseDraftFromText failed:", e);
      setEditDraft({ subject: "", body: rawText, recipient: "", rawText });
    }
  }, []);

  const cancelEditDraft = useCallback(() => {
    setEditDraft(null);
  }, []);

  const confirmEditDraft = useCallback(
    (next: { subject: string; body: string; recipient: string }) => {
      const recipientLine = `Here's your updated draft email to ${next.recipient}:`;
      const draftMessage = `${recipientLine}\n\n---\n**Subject:** ${next.subject}\n\n${next.body}\n---`;
      setEditDraft(null);
      // Pass the synthetic assistant message explicitly to sendPrompt — this
      // matches the mobile sendMessage(text, _, _, extraAssistantMsgs) signature
      // and removes any setSessions / sessionsRef ordering race.
      void sendPromptRef.current("YES_SEND", undefined, [
        { role: "assistant", content: draftMessage },
      ]);
    },
    [],
  );

  // Always-fresh ref for sendPrompt so the chatBridge subscription doesn't
  // capture a stale closure (sendPrompt's identity is stable but we keep this
  // pattern to be defensive against future refactors).
  const sendPromptRef = useRef(sendPrompt);
  useEffect(() => { sendPromptRef.current = sendPrompt; }, [sendPrompt]);

  /* Run chatStream against a session that ALREADY contains the user message +
   * empty streaming assistant placeholder (created by the `handoff` useState
   * initializer at mount). This bypasses sendPrompt's session-creation path so
   * we never have a window where activeSession exists but messages.length === 0. */
  const runHandoffStream = useCallback(async (
    targetSid: string,
    assistantMsgId: string,
    userPrompt: string,
    hiddenContext?: string,
  ) => {
    setLastUserMessageForParser(userPrompt);
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setStreaming(true);

    const historyForApi = [{ role: "user" as const, content: userPrompt }];

    try {
      let buffer = "";
      let errored: string | null = null;
      const patch = (mut: (m: ChatMessage) => ChatMessage) => {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== targetSid) return s;
            return { ...s, messages: s.messages.map((m) => (m.id === assistantMsgId ? mut(m) : m)) };
          }),
        );
      };
      await chatStream(historyForApi, (evt) => {
        switch (evt.type) {
          case "content":
            buffer += evt.text;
            patch((m) => ({ ...m, content: buffer, statusText: undefined }));
            break;
          case "status":
            patch((m) => ({ ...m, statusText: evt.text || undefined }));
            break;
          case "token":
            buffer += (buffer && !buffer.endsWith("\n") ? "\n" : "") + evt.text;
            patch((m) => ({ ...m, content: buffer }));
            if (evt.text.includes("WEEKLY_ALLOC:")) {
              const wam = evt.text.match(/WEEKLY_ALLOC:[^|]+\|([^|\]\s]+)/);
              if (wam?.[1]) {
                const pid = wam[1].trim();
                refreshProjectTeamCache(queryClient, pid);
                queryClient.invalidateQueries({ queryKey: ["project-allocations-raw", pid] });
              }
            }
            break;
          case "roster":
            patch((m) => ({ ...m, roster: evt.data }));
            break;
          case "oppTable":
            patch((m) => ({ ...m, oppTable: evt.data }));
            break;
          case "oppTable2":
            patch((m) => ({ ...m, oppTable2: evt.data }));
            break;
          case "pmmTable":
            patch((m) => ({ ...m, pmmTable: evt.data }));
            break;
          case "personProfile":
            patch((m) => ({ ...m, personProfile: evt.data }));
            break;
          case "error":
            errored = evt.message;
            // Server/stall-watchdog error messages are already user-facing —
            // show them directly instead of prefixing "Something went wrong:".
            buffer = `⚠️ ${evt.message.slice(0, 300)}`;
            patch((m) => ({ ...m, content: buffer, statusText: undefined }));
            break;
          case "cacheBust":
            if (evt.projectId) {
              refreshProjectTeamCache(queryClient, evt.projectId);
              queryClient.invalidateQueries({ queryKey: ["project-allocations-raw", evt.projectId] });
            }
            break;
          case "done":
            patch((m) => ({ ...m, statusText: undefined }));
            break;
        }
      }, ctrl.signal, {
        displayName: displayNameRef.current,
        hiddenContext,
        dashboardContext: getDashboardSnapshot() ?? undefined,
      });
      if (errored && !buffer) throw new Error(errored);
    } catch (err) {
      if ((err as { code?: string }).code === "SESSION_EXPIRED") {
        await handleAuthError();
        return;
      }
      const aborted = ctrl.signal.aborted;
      const rawMsg = err instanceof Error ? err.message : "";
      // Raw browser network failures ("network error", "Failed to fetch",
      // "Load failed") are meaningless to the user — show a friendly line.
      const msg = rawMsg && !/failed to fetch|network\s?error|load failed|fetch failed/i.test(rawMsg)
        ? rawMsg
        : "The connection dropped while generating the reply — please try sending your question again.";
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== targetSid) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content || (aborted ? "" : `⚠️ ${msg}`) }
                : m,
            ),
          };
        }),
      );
    } finally {
      if (abortRef.current === ctrl) {
        setStreaming(false);
        abortRef.current = null;
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== targetSid) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === assistantMsgId ? { ...m, isStreaming: false } : m,
            ),
          };
        }),
      );
    }
  }, []);

  /* React to chatBridge prompts (deep-link from elsewhere in the app) */
  useEffect(() => {
    // The mount-time hand-off was already consumed by the `handoff` useState
    // initializer, which synchronously created the session + user bubble +
    // empty assistant placeholder. All we need to do here is fire the
    // chatStream call against that pre-created session.
    if (handoff) {
      const { sid, hiddenContext, assistantMsgId } = handoff;
      // Stash sticky hidden context for any follow-up turns in this session
      if (hiddenContext) {
        sessionHiddenCtxRef.current = { sid, value: hiddenContext };
      }
      void runHandoffStream(sid, assistantMsgId, handoff.session.messages[0].content, hiddenContext);
    }
    // Subscribe for any future prompts (read latest sendPrompt + streaming via refs)
    const unsub = onChatPrompt((p) => {
      if (streamingRef.current) return; // ignore deep links while streaming
      if (p.autoSend !== false) {
        consumeChatPrompt();
        void sendPromptRef.current(p.prompt, {
          newSession: p.newSession,
          hiddenContext: p.context,
        });
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Cleanup: abort any in-flight stream when the chat page unmounts.
   * Also synchronously clear `isStreaming` on every assistant message and
   * persist that to localStorage *before* we unmount, so that re-opening
   * the chat tab doesn't briefly flash the "evaluating…" spinner before
   * the load-time sanitizer in the useState initializer kicks in. */
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      const cleaned = sessionsRef.current.map((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.role === "assistant" && m.isStreaming
            ? {
                ...m,
                isStreaming: false,
                content: m.content || "The reply was interrupted. Please send the question again.",
              }
            : m,
        ),
      }));
      try { saveSessions(cleaned, username, tenant); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Tab-visibility recovery.
   *
   * When the user switches to another browser tab during streaming, browsers
   * throttle background tabs aggressively: the SSE fetch may stall, the
   * watchdog setInterval may not fire, and our React state-update queue may
   * be paused. The user comes back to a chat that says "RM ONE AI Agents are
   * evaluating…" forever even though the network request is dead.
   *
   * On every visibilitychange → visible, check if we're still in a streaming
   * state that hasn't received fresh activity in a long time, and if so
   * force-abort the request and clear the spinner so the user can try again
   * instead of seeing a permanent stuck state.
   */
  const streamStartedAtRef = useRef<number>(0);
  useEffect(() => {
    streamStartedAtRef.current = streaming ? Date.now() : 0;
  }, [streaming]);
  useEffect(() => {
    const onVis = () => {
      if (typeof document === "undefined" || document.hidden) return;
      if (!streamingRef.current) return;
      const elapsed = Date.now() - (streamStartedAtRef.current || 0);
      // 90s is well past the longest realistic LLM response time; if the
      // stream hasn't completed by then while we were hidden, treat it as
      // dead and recover.
      if (elapsed < 90_000) return;
      console.warn("[chat] tab-visibility recovery: aborting stale stream after", elapsed, "ms");
      try { abortRef.current?.abort(); } catch { /* noop */ }
      abortRef.current = null;
      setStreaming(false);
      // Clear isStreaming on any assistant messages still showing the
      // spinner, and add a polite recovery note as their content if they
      // were empty.
      setSessions((prev) => prev.map((s) => ({
        ...s,
        messages: s.messages.map((m) => {
          if (m.role !== "assistant" || !m.isStreaming) return m;
          return {
            ...m,
            isStreaming: false,
            content: m.content || "The reply was interrupted while the tab was in the background. Please send the question again.",
          };
        }),
      })));
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  /* Sidebar handlers */
  const handleNewChat = () => {
    // Always start fresh — abort any in-flight stream and clear streaming
    // state so the click never gets swallowed if a previous reply was
    // interrupted (which can leave `streaming` stuck true on the client).
    try {
      abortRef.current?.abort();
    } catch {
    }
    abortRef.current = null;
    setStreaming(false);
    streamingRef.current = false;
    sessionHiddenCtxRef.current = undefined;
    sessionImagesRef.current = undefined;
    setActiveId(null);
  };
  const handleSelectSession = (id: string) => {
    setActiveId(id);
  };
  const handleDeleteSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(null);
    if (username && tenant) {
      const token = window.localStorage.getItem("rmone_token") ?? "";
      deleteSessionFromDb(token, username, tenant, id).catch(() => {});
    }
  };
  const handleRenameSession = (id: string, title: string) => {
    updateSession(id, (s) => ({ ...s, title: title.trim() || s.title }));
  };

  return (
    <div style={{
      // Fill the AppShell <main> region — no longer a fixed-position overlay
      // since the global Shell now wraps this page.
      display: "flex", flex: 1, minHeight: 0, width: "100%", height: "100%",
      backgroundColor: BRAND.bg, color: BRAND.textOnDark,
    }}>
      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        sessions={sessions}
        activeId={activeId}
        onClose={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelect={handleSelectSession}
        onDelete={handleDeleteSession}
        onRename={handleRenameSession}
      />

      {/* Main column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <ChatHeader
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onNewChat={handleNewChat}
          streaming={streaming}
          unread={unread}
          shake={bellShake}
          onOpenInbox={() => setInboxOpen(true)}
        />

        {!activeSession || activeSession.messages.length === 0 ? (
          <IdleState
            onPick={(p) => sendPrompt(p)}
            onSubmit={(text) => sendPrompt(text)}
            disabled={streaming}
          />
        ) : (
          <MessageList
            messages={activeSession.messages}
            streaming={streaming}
            onSend={sendPromptSimple}
            onEditDraft={openEditDraft}
            onChipConfirm={onChipConfirm}
          />
        )}

        {activeSession && activeSession.messages.length > 0 && (
          <InputBar
            onSubmit={(text) => sendPrompt(text)}
            onStop={stopStreaming}
            streaming={streaming}
            onVoiceError={(m) => {
              setVoiceError(m);
              setTimeout(() => setVoiceError(null), 4000);
            }}
          />
        )}
      </div>

      <InboxModal
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
        onReplyWithAI={(prompt, hiddenContext, images) =>
          sendPrompt(prompt, { newSession: true, hiddenContext, imageAttachments: images })
        }
      />

      <EditDraftModal
        open={!!editDraft}
        initial={editDraft}
        onCancel={cancelEditDraft}
        onConfirm={confirmEditDraft}
      />

      {voiceError && (
        <div
          role="alert"
          style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            background: BRAND.red, color: "#fff",
            padding: "10px 16px", borderRadius: 10,
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
            fontSize: 13, fontWeight: 600, zIndex: Z.MODAL_TOAST,
          }}
        >
          {voiceError}
        </div>
      )}
    </div>
  );
}

/* ─────────────  HEADER  ───────────── */
function ChatHeader({
  sidebarOpen, onToggleSidebar, onNewChat, streaming, unread, shake, onOpenInbox,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  streaming: boolean;
  unread: number;
  shake: boolean;
  onOpenInbox: () => void;
}) {
  // Live signal count for the "LIVE · N SIGNALS" pill — counts at-risk
  // PMM/OPM records + open demand slots from the same RM ONE data the
  // home overlay uses. Refreshes every 60s so the number tracks reality
  // as records change. While the first fetch is in flight (or if it
  // fails / returns 0) the pill drops the count and just renders "LIVE"
  // so the user never sees a stale or hardcoded number.
  const [signalCount, setSignalCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchSignalsCount().then((n) => {
        if (alive) setSignalCount(n > 0 ? n : null);
      });
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      height: 44,
      // AvatarMenu now lives only on Home, so the chat header can hug
      // the right edge — no need to reserve space for a floating profile.
      padding: "0 14px 0 14px",
      borderBottom: "1px solid var(--rm-panel-border)",
      backgroundColor: BRAND.headerBg,
    }}>
      {/* Sidebar toggle removed — conversations sidebar is always open. */}

      {/* Brand block only — the previous Bot icon read as an "assistant"
          avatar and broke web/mobile parity (mobile shows a flat brand
          block with no avatar). The two-line stack — small "RM ONE"
          eyebrow above bold "Decision Support" — is now the dominant
          element on both platforms. */}
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.9, color: "var(--rm-text-muted)" }}>
          RM ONE
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.2, color: "var(--rm-text)", marginTop: 1 }}>
          Decision Support
        </span>
      </div>

      {/* Spacer — pushes the LIVE pill to the top-right of the header row,
          matching the reference where status pills sit opposite the title. */}
      <div style={{ flex: 1 }} />

      {/* LIVE · N SIGNALS pill — outlined green, top-right status pill.
          N is the live count from `fetchSignalsCount` (at-risk PMM/OPM
          records + open demand slots). When the count is unavailable
          we drop the number and just render "LIVE" so the pill never
          shows a stale or hardcoded value. */}
      <span
        aria-label={signalCount == null ? "Live" : `Live ${signalCount} signals`}
        title="Decision-support signal stream"
        style={{
          marginRight: 8,
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "3px 8px", borderRadius: 999,
          border: `1px solid ${BRAND.green}`, color: "#9DC957",
          fontSize: 10, fontWeight: 800, letterSpacing: 0.7,
          background: "rgba(107,165,57,0.08)",
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: 999,
          background: BRAND.green,
          boxShadow: streaming ? "0 0 6px rgba(107,165,57,0.9)" : "none",
          animation: streaming ? "rmone-mic-pulse 1.4s ease-in-out infinite" : undefined,
        }} />
        {signalCount == null
          ? "LIVE"
          : `LIVE · ${signalCount > 99 ? "99+" : signalCount} SIGNALS`}
      </span>

      <button
        type="button"
        onClick={onOpenInbox}
        aria-label={unread > 0 ? `Inbox (${unread} unread)` : "Inbox"}
        title="Inbox"
        style={{
          ...iconBtnStyle, position: "relative", padding: 8,
          animation: shake ? "rmone-shake 0.7s ease-in-out" : undefined,
        }}
      >
        <Mail size={18} color={unread > 0 ? BRAND.green : BRAND.textOnDark} />
        {unread > 0 && (
          <span
            aria-hidden
            style={{
              position: "absolute", top: 2, right: 2,
              minWidth: 16, height: 16, padding: "0 4px",
              borderRadius: 10, background: BRAND.red, color: "#fff",
              fontSize: 10, fontWeight: 800,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      <button
        onClick={onNewChat}
        disabled={streaming}
        style={{
          ...iconBtnStyle,
          gap: 6, padding: "6px 12px",
          backgroundColor: BRAND.greenBg,
          opacity: streaming ? 0.5 : 1,
          cursor: streaming ? "not-allowed" : "pointer",
        }}
        aria-label="New chat"
      >
        <Plus size={14} color="#FFFFFF" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#FFFFFF" }}>New Chat</span>
      </button>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  background: "transparent", border: "none", padding: 6, borderRadius: 8,
  cursor: "pointer", color: BRAND.textOnDark,
};

/* ─────────────  SIDEBAR  ───────────── */
function Sidebar({
  open, sessions, activeId, onClose, onNewChat, onSelect, onDelete, onRename,
}: {
  open: boolean;
  sessions: ChatSession[];
  activeId: string | null;
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const startEdit = (s: ChatSession) => {
    setEditingId(s.id);
    setDraftTitle(s.title);
  };
  const commitEdit = () => {
    if (editingId) onRename(editingId, draftTitle);
    setEditingId(null);
  };

  if (!open) {
    return <div style={{ width: 0, transition: "width 200ms ease" }} />;
  }

  return (
    <div style={{
      width: 280, flexShrink: 0,
      backgroundColor: "var(--rm-panel-soft)",
      borderRight: "1px solid var(--rm-panel-border)",
      display: "flex", flexDirection: "column",
      transition: "width 200ms ease",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 12px 8px",
      }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6,
          color: "#A6B6C2", textTransform: "uppercase" }}>
          Conversations
        </span>
        <div style={{ flex: 1 }} />
        {/* Hide-sidebar button removed — sidebar is always visible now. */}
      </div>

      <button
        onClick={onNewChat}
        style={{
          margin: "4px 12px 12px",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "10px 12px", borderRadius: 10,
          border: `1px solid ${BRAND.green}`,
          backgroundColor: "transparent",
          color: BRAND.greenLight, cursor: "pointer",
          fontSize: 13, fontWeight: 700,
        }}
      >
        <Plus size={14} />
        New Conversation
      </button>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 16px" }}>
        {sessions.length === 0 && (
          <div style={{
            padding: 16, fontSize: 12, color: "var(--rm-text-muted)",
            textAlign: "center", lineHeight: 1.5,
          }}>
            No conversations yet.
            <br />
            Ask anything to get started.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} style={{ marginTop: 4 }}>
            <div style={{
              padding: "8px 8px 4px", fontSize: 10, fontWeight: 700,
              color: "var(--rm-text-muted)", letterSpacing: 0.6, textTransform: "uppercase",
            }}>
              {g.label}
            </div>
            {g.items.map((s) => {
              const isActive = s.id === activeId;
              const isEditing = s.id === editingId;
              const rowStyle: React.CSSProperties = {
                width: "100%",
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 10px", margin: "2px 0",
                borderRadius: 8,
                backgroundColor: isActive ? "var(--rm-panel-hover)" : "transparent",
                border: isActive
                  ? `1px solid ${BRAND.green}`
                  : "1px solid transparent",
                textAlign: "left",
                font: "inherit", color: "inherit",
                cursor: isEditing ? "text" : "pointer",
              };
              const inner = (
                <>
                  <MessageSquare size={13} color={isActive ? BRAND.greenLight : "var(--rm-text-muted)"} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEditing ? (
                      <input
                        autoFocus
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        style={{
                          width: "100%", background: "transparent",
                          border: `1px solid ${BRAND.green}`, borderRadius: 4,
                          color: BRAND.textOnDark, fontSize: 13,
                          padding: "2px 4px",
                        }}
                      />
                    ) : (
                      <div style={{
                        fontSize: 13, color: BRAND.textOnDark, fontWeight: isActive ? 700 : 500,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {s.title}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "var(--rm-text-muted)", marginTop: 2 }}>
                      {formatSessionDate(s.timestamp)} · {s.messages.length} msgs
                    </div>
                  </div>
                </>
              );
              return (
                <div key={s.id} style={{ position: "relative", display: "flex" }}>
                  {isEditing ? (
                    <div style={rowStyle}>{inner}</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      aria-current={isActive ? "true" : undefined}
                      style={{
                        ...rowStyle,
                        background: rowStyle.backgroundColor,
                        backgroundColor: rowStyle.backgroundColor,
                        appearance: "none", flex: 1,
                        paddingRight: 56, // room for action buttons
                      }}
                    >
                      {inner}
                    </button>
                  )}
                  {!isEditing && (
                    <div style={{
                      position: "absolute", right: 6, top: "50%",
                      transform: "translateY(-50%)",
                      display: "flex", gap: 2,
                    }}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); startEdit(s); }}
                        aria-label={`Rename ${s.title}`}
                        style={{ ...iconBtnStyle, padding: 4 }}
                      >
                        <Pencil size={12} color="var(--rm-text-muted)" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                        aria-label={`Delete ${s.title}`}
                        style={{ ...iconBtnStyle, padding: 6 }}
                      >
                        <Trash2 size={16} color="var(--rm-text-muted)" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────  IDLE STATE  ───────────── */
function IdleState({
  onPick, onSubmit, disabled,
}: {
  onPick: (text: string) => void;
  onSubmit: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "flex-start",
      padding: "48px 32px 24px", gap: 24, overflowY: "auto",
    }}>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: "100%" }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: `linear-gradient(135deg, ${BRAND.green}, ${BRAND.greenLight})`,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 8px 24px rgba(107,165,57,0.4)",
      }}>
        <Bot size={32} color="#FFFFFF" />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>What needs a decision?</div>
        <div style={{ fontSize: 13, color: "#A6B6C2", marginTop: 6 }}>
          Ask anything about projects, people, pipeline, or send an email.
        </div>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 10, width: "100%", maxWidth: 720,
      }}>
        {QUICK_PROMPTS.map((p, i) => {
          const Icon = p.icon;
          return (
            <button
              key={i}
              onClick={() => onPick(p.text)}
              disabled={disabled}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "18px 18px", borderRadius: 14, minHeight: 72,
                backgroundColor: BRAND.card,
                border: `1px solid ${BRAND.cardBorder}`,
                color: BRAND.text, cursor: disabled ? "not-allowed" : "pointer",
                textAlign: "left", fontSize: 15, fontWeight: 600,
                opacity: disabled ? 0.6 : 1,
                transition: "transform 80ms ease, box-shadow 80ms ease",
                boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 4px 10px rgba(0,0,0,0.22)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.18)";
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                backgroundColor: p.color + "22",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <Icon size={16} color={p.color} />
              </div>
              {p.text}
            </button>
          );
        })}
      </div>
      </div>

      <div style={{ width: "100%", maxWidth: 720, marginTop: "auto" }}>
        <InputBar
          onSubmit={onSubmit}
          onStop={() => {}}
          streaming={false}
          embedded
        />
      </div>
    </div>
  );
}

const GREEN = "#6BA539";
const LIGHT_GREEN = "#A9C23F";

function HubPanel() {
  const [, setLocation] = useLocation();
  const domains = [
    { Icon: BarChart2,      label: "Pipeline Intelligence",  desc: "Pursuits, win rate, proposal pipeline and close forecasts",         path: "/analytics" },
    { Icon: Users,          label: "Workforce Intelligence", desc: "Utilisation, bench capacity, demand gaps and hire pipeline",         path: "/resources" },
    { Icon: FolderOpen,     label: "Project Intelligence",   desc: "Portfolio health, schedule float and milestone tracking",            path: "/projects" },
    { Icon: DollarSignIcon, label: "Financial Intelligence", desc: "Forecast revenue, margin risk and contract value tracking",          path: "/forecast" },
    { Icon: Building2,      label: "Executive Insight",      desc: "Firm-wide health score, strategic risk and top recommended actions", path: "/" },
  ] as const;

  const pentagon = [
    { angle: -90,  label: "Pipeline",  sublabel: "Intelligence", path: "/analytics" },
    { angle: -18,  label: "Financial", sublabel: "Intelligence", path: "/forecast" },
    { angle:  54,  label: "Project",   sublabel: "Intelligence", path: "/projects" },
    { angle: 126,  label: "Workforce", sublabel: "Intelligence", path: "/resources" },
    { angle: 198,  label: "Executive", sublabel: "Insight",      path: "/" },
  ] as const;

  return (
    <div style={{ width: "100%", maxWidth: 720 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
        color: "rgba(255,255,255,0.40)", marginBottom: 12,
      }}>
        RM ONE Operational Intelligence Hub
      </div>
      <div style={{
        borderRadius: 18, padding: "20px 20px",
        background: "linear-gradient(160deg, rgba(46,69,87,0.60) 0%, rgba(27,43,56,0.80) 100%)",
        border: "1px solid rgba(169,194,63,0.15)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
        display: "flex", flexDirection: "row", alignItems: "center", gap: 24,
      }}>
        {/* SVG pentagon wheel */}
        <div style={{ flexShrink: 0, width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="200" height="200" viewBox="0 0 200 200" fill="none">
            <circle cx="100" cy="100" r="94" stroke="rgba(169,194,63,0.20)" strokeWidth="1.5" />
            <circle cx="100" cy="100" r="72" stroke="rgba(169,194,63,0.12)" strokeWidth="1" strokeDasharray="4 4" />
            <circle cx="100" cy="100" r="28" fill="#1B2B38" stroke={GREEN} strokeWidth="2" />
            <text x="100" y="96" textAnchor="middle" fill={LIGHT_GREEN} fontSize="8" fontWeight="700" fontFamily="ui-monospace,monospace" letterSpacing="1">RM ONE</text>
            <text x="100" y="107" textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="6.5" fontFamily="sans-serif" letterSpacing="0.5">INTELLIGENCE</text>
            {pentagon.map(({ angle, label, sublabel, path }) => {
              const rad = (angle * Math.PI) / 180;
              const cx = 100 + 80 * Math.cos(rad);
              const cy = 100 + 80 * Math.sin(rad);
              const lx = 100 + 94 * Math.cos(rad);
              const ly = 100 + 94 * Math.sin(rad);
              const ta = Math.cos(rad) > 0.2 ? "start" : Math.cos(rad) < -0.2 ? "end" : "middle";
              const dx = Math.cos(rad) > 0.2 ? 4 : Math.cos(rad) < -0.2 ? -4 : 0;
              return (
                <g key={label} style={{ cursor: "pointer" }} onClick={() => setLocation(path)}>
                  <line x1="100" y1="100" x2={cx} y2={cy} stroke={`${LIGHT_GREEN}30`} strokeWidth="1" />
                  <circle cx={cx} cy={cy} r="11" fill={`${GREEN}22`} stroke={LIGHT_GREEN} strokeWidth="1.5" />
                  <circle cx={cx} cy={cy} r="4" fill={LIGHT_GREEN} />
                  <text x={lx + dx} y={ly + (Math.sin(rad) > 0.2 ? 10 : Math.sin(rad) < -0.2 ? -4 : 3)}
                    textAnchor={ta} fill="rgba(255,255,255,0.85)" fontSize="7" fontWeight="700" fontFamily="sans-serif">{label}</text>
                  <text x={lx + dx} y={ly + (Math.sin(rad) > 0.2 ? 19 : Math.sin(rad) < -0.2 ? 5 : 12)}
                    textAnchor={ta} fill="rgba(169,194,63,0.70)" fontSize="6" fontFamily="sans-serif">{sublabel}</text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Domain list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
          {domains.map(({ Icon, label, desc, path }) => (
            <button
              key={label}
              onClick={() => setLocation(path)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                borderRadius: 12, padding: "10px 12px", textAlign: "left",
                background: "rgba(27,43,56,0.55)",
                border: "1px solid rgba(169,194,63,0.12)",
                cursor: "pointer", transition: "filter 120ms ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.12)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = "brightness(1)"; }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                background: `${GREEN}22`, border: `1px solid ${GREEN}33`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon size={14} color={LIGHT_GREEN} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", lineHeight: 1.3 }}>{label}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{desc}</div>
              </div>
              <ChevronRight size={13} color="rgba(255,255,255,0.25)" style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────  TYPING DOTS  ─────────────
 * "RM ONE Agents are evaluating.." indicator with a brand-colour shimmer
 * (orange → green → green-light) sliding across the text plus three
 * subtle bouncing dots. Shown in the assistant bubble between the user
 * pressing send and the first streamed token arriving. */
function TypingDots({ label }: { label?: string }) {
  const dotStyle = (delay: string): React.CSSProperties => ({
    display: "inline-block",
    width: 6, height: 6, borderRadius: 999,
    background: `linear-gradient(135deg, ${BRAND.orange}, ${BRAND.green})`,
    animation: "rmone-typing-bounce 1.2s ease-in-out infinite",
    animationDelay: delay,
  });
  const shimmerTextStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.02em",
    backgroundImage: `linear-gradient(90deg, ${BRAND.green} 0%, ${BRAND.greenLight} 25%, ${BRAND.orange} 50%, ${BRAND.greenLight} 75%, ${BRAND.green} 100%)`,
    backgroundSize: "200% 100%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
  };
  return (
    <span
      role="status"
      aria-label="RM ONE Agents are evaluating"
      style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "2px 0" }}
    >
      <span className="rmone-shimmer" style={shimmerTextStyle}>
        {label || "RM ONE Agents are evaluating"}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span style={dotStyle("0s")} />
        <span style={dotStyle("0.18s")} />
        <span style={dotStyle("0.36s")} />
      </span>
    </span>
  );
}

/* ─────────────  MESSAGE LIST  ───────────── */
function MessageList({
  messages,
  streaming,
  onSend,
  onEditDraft,
  onChipConfirm,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
  onEditDraft?: (rawText: string) => void;
  /** Persists a SITREP action-chip confirmation onto the given assistant
   *  message so it survives re-renders and chat reloads. */
  onChipConfirm?: (messageId: string, actionIndex: number) => void;
}) {
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Track the last user message id we've already "anchored" to the top of
  // the viewport. When a NEW user message appears (i.e. the user just hit
  // send), we scroll that bubble to the top of the scroller — ChatGPT-
  // style — so the user sees their own question and the assistant's reply
  // streams in below it instead of pushing the question off-screen.
  const anchoredUserIdRef = useRef<string | null>(null);
  const lastUserId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].id;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // New user message just landed → pin it to the top of the viewport and
    // disable the bottom-sticky behaviour so the streaming reply does not
    // immediately scroll it back off-screen. The user can still tap "Jump
    // to latest" if they want to follow the tail.
    if (lastUserId && lastUserId !== anchoredUserIdRef.current) {
      anchoredUserIdRef.current = lastUserId;
      stickyRef.current = false;
      const target = el.querySelector<HTMLElement>(
        `[data-msg-id="${lastUserId}"]`,
      );
      if (target) {
        // Position the user's bubble ~16px below the top of the scroller.
        const offset = target.offsetTop - 16;
        el.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
        return;
      }
    }
    if (stickyRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streaming, lastUserId]);

  // Hide the "Jump to latest" pill the moment streaming finishes — at that
  // point the bottom is no longer moving so there's nothing to "jump" to.
  useEffect(() => {
    if (!streaming) setShowJumpToLatest(false);
  }, [streaming]);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stickyRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  // While the assistant is streaming, the message-array dependency above
  // re-pins the scroll on each chunk — but nested widgets (tables, charts,
  // images) can grow the DOM AFTER React commits, leaving the latest line
  // off-screen. A ResizeObserver on the inner content keeps the scroll
  // glued to the bottom whenever sticky is on, regardless of why the
  // height changed. Cleared as soon as the user scrolls away on purpose
  // (the onScroll handler flips stickyRef off when distanceFromBottom>80).
  const innerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const inner = innerRef.current;
    const el = scrollRef.current;
    if (!inner || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stickyRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // On mount (e.g. navigating into the chat page from another route),
  // always jump to the most recent message. Use a double rAF so we wait
  // for layout/fonts/images to settle before measuring scrollHeight.
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    const jump = () => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      stickyRef.current = true;
    };
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(jump);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 80;
    stickyRef.current = nearBottom;
    // Only show the pill while the assistant is still streaming AND the user
    // has scrolled away from the bottom. Once they scroll back near the
    // bottom (or the reply finishes — handled by the streaming effect) the
    // pill goes away on its own.
    const shouldShow = streaming && !nearBottom;
    setShowJumpToLatest((prev) => (prev === shouldShow ? prev : shouldShow));
  };

  return (
    <div style={{ flex: 1, position: "relative", display: "flex", minHeight: 0 }}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1, overflowY: "auto",
          padding: "20px 16px 12px",
          display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div ref={innerRef} style={{ width: "100%", maxWidth: 900, margin: "0 auto",
          display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.map((m) => (
            <Bubble
              key={m.id}
              m={m}
              onSend={onSend}
              onEditDraft={onEditDraft}
              isLatestAssistant={m.id === lastAssistantId}
              onChipConfirm={onChipConfirm}
            />
          ))}
        </div>
      </div>
      {showJumpToLatest && streaming && (
        <button
          type="button"
          onClick={jumpToLatest}
          aria-label="Jump to latest message"
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 999,
            background: BRAND.bgDeep,
            color: BRAND.textOnDark,
            border: `1px solid ${BRAND.green}`,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
            zIndex: 5,
          }}
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  );
}

/**
 * Decision-Support assistant messages render as a full-bleed dark card stack,
 * NOT inside the white assistant bubble with a Bot avatar. We detect the case
 * by looking for the [DECISION_BRIEF] / [DRAFT_PANEL] markers in the streamed
 * content. When matched, the bubble strips its container chrome so the cards
 * read as a Bloomberg-style decision-support surface.
 */
function isDecisionSupportContent(content: string): boolean {
  if (!content) return false;
  return /\[DECISION_BRIEF(?::[^\]]*)?\]/.test(content)
      || /\[DRAFT_PANEL(?::[^\]]*)?\]/.test(content);
}

/* React.memo wrapper so that when one assistant message updates during
 * streaming, only THAT bubble re-renders — not every previous reply in the
 * conversation. Each message has a stable `id`, and the patch helper in
 * sendPrompt keeps the object reference of unchanged messages intact, so a
 * shallow prop compare correctly skips re-rendering them. Without this,
 * every SSE chunk re-parsed every prior message's markdown / tables /
 * widgets — the dominant CPU cost on long replies. */
const Bubble = React.memo(BubbleImpl, (prev, next) => (
  prev.m === next.m &&
  prev.isLatestAssistant === next.isLatestAssistant &&
  prev.onSend === next.onSend &&
  prev.onEditDraft === next.onEditDraft &&
  prev.onChipConfirm === next.onChipConfirm
));

function BubbleImpl({ m, onSend, onEditDraft, isLatestAssistant, onChipConfirm }: {
  m: ChatMessage;
  onSend: (text: string) => void;
  onEditDraft?: (rawText: string) => void;
  isLatestAssistant: boolean;
  /** Unbound parent callback: (messageId, actionIndex). Bound to this
   *  message via useCallback below so the prop stays referentially stable
   *  across parent re-renders and React.memo can correctly skip
   *  re-renders of unchanged bubbles during streaming. */
  onChipConfirm?: (messageId: string, actionIndex: number) => void;
}) {
  const isUser = m.role === "user";
  const isDS = !isUser && isDecisionSupportContent(m.content || "");
  const boundChipConfirm = useCallback(
    (idx: number) => { onChipConfirm?.(m.id, idx); },
    [onChipConfirm, m.id],
  );
  return (
    <div data-msg-id={m.id} style={{
      display: "flex", gap: 10,
      flexDirection: isUser ? "row-reverse" : "row",
      alignItems: "flex-start",
    }}>
      {/* Avatar: omitted on Decision-Support surface so the card stack reads
          as the assistant response itself, with no extra branding noise. */}
      {!isDS && (
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          flexShrink: 0,
          background: isUser
            ? "linear-gradient(135deg, #4D6A85, #2C4053)"
            : `linear-gradient(135deg, ${BRAND.green}, ${BRAND.greenLight})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
        }}>
          {isUser
            ? <User size={14} color="#FFFFFF" />
            : <Bot size={14} color="#FFFFFF" />}
        </div>
      )}

      <div className={isUser || isDS ? undefined : "chat-prose"} style={{
        maxWidth: isUser ? "78%" : (isDS ? "100%" : "85%"),
        flex: isDS ? 1 : undefined,
        // DS surface is its own stack of dark cards — no white bubble, no
        // rounded-corner chrome, no shadow. The cards bring their own.
        padding: isDS ? 0 : "12px 16px",
        borderRadius: isDS ? 0 : 14,
        borderTopLeftRadius: isUser ? 14 : (isDS ? 0 : 4),
        borderTopRightRadius: isUser ? 4 : (isDS ? 0 : 14),
        backgroundColor: isUser ? BRAND.bubbleUser : (isDS ? "transparent" : BRAND.bubbleAssistantBg),
        border: isUser ? "1px solid var(--rm-panel-border)" : undefined,
        color: isUser ? BRAND.text : (isDS ? BRAND.textOnDark : BRAND.text),
        fontSize: 15, lineHeight: 1.6,
        boxShadow: isDS ? "none" : "0 2px 8px rgba(0,0,0,0.18)",
        wordBreak: "break-word",
      }}>
        {isUser ? (
          <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
        ) : m.content ? (
          <ChatContent
            text={m.content}
            isStreaming={m.isStreaming}
            isLatestAssistant={isLatestAssistant}
            roster={m.roster}
            oppTable={m.oppTable}
            oppTable2={m.oppTable2}
            pmmTable={m.pmmTable}
            personProfile={m.personProfile}
            onSend={onSend}
            onEditDraft={onEditDraft}
            messageKey={m.id}
            chipStates={m.chipStates}
            onChipConfirm={boundChipConfirm}
            readOnly={getStoredUser()?.canEdit === false}
          />
        ) : (
          m.isStreaming && <TypingDots label={m.statusText} />
        )}
        {!isUser && m.isStreaming && m.content && m.statusText && (
          <div style={{ marginTop: 6 }}>
            <TypingDots label={m.statusText} />
          </div>
        )}
        {!isUser && m.isStreaming && m.content && (
          <span style={{ display: "inline-block", width: 6, height: 14,
            marginLeft: 2, verticalAlign: "middle",
            backgroundColor: BRAND.greenBg, opacity: 0.7,
            animation: "rmone-blink 1s steps(1) infinite",
          }} />
        )}
      </div>
    </div>
  );
}

/* ─────────────  INPUT BAR  ───────────── */
function InputBar({
  onSubmit, onStop, streaming, embedded, onVoiceError,
}: {
  onSubmit: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  embedded?: boolean;
  onVoiceError?: (msg: string) => void;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const insertTranscript = (transcript: string) => {
    setText((prev) => {
      const sep = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
      const next = prev + sep + transcript;
      requestAnimationFrame(() => taRef.current?.focus());
      return next;
    });
  };
  // Live-typing: each delta from the streaming transcribe endpoint is appended
  // verbatim (no separator munging) so partial-word fragments concatenate
  // correctly — same UX as mobile chat.tsx appendText.
  const appendTranscriptDelta = (delta: string) => {
    setText((prev) => prev + delta);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  // Autosize
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || streaming) return;
    onSubmit(t);
    setText("");
  };

  return (
    <div style={{
      padding: embedded ? "0" : "10px 16px 14px",
      backgroundColor: embedded ? "transparent" : BRAND.bg,
      borderTop: embedded ? "none" : `1px solid ${BRAND.bgDeep}`,
    }}>
      <div style={{
        maxWidth: 900, margin: "0 auto",
        display: "flex", alignItems: "flex-end", gap: 8,
        backgroundColor: BRAND.card, borderRadius: 14,
        padding: 8, border: `1px solid ${BRAND.cardBorder}`,
        boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
      }}>
        <VoiceButton
          disabled={streaming}
          onDelta={appendTranscriptDelta}
          onTranscript={insertTranscript}
          onError={(m) => onVoiceError?.(m)}
        />

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={streaming ? "RM ONE AI Agents are evaluating.." : "Command or query…"}
          disabled={streaming}
          style={{
            flex: 1, resize: "none", border: "none", outline: "none",
            background: "transparent", color: BRAND.text,
            fontSize: 14, lineHeight: 1.5,
            fontFamily: "inherit", padding: "8px 4px", maxHeight: 180,
          }}
        />

        {streaming ? (
          <button
            onClick={onStop}
            aria-label="Stop"
            style={{
              ...iconBtnStyle, padding: 10, borderRadius: 10,
              backgroundColor: BRAND.red, color: "#FFFFFF",
            }}
          >
            <Square size={16} fill="#FFFFFF" color="#FFFFFF" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!text.trim()}
            aria-label="Send"
            style={{
              // Match the voice/mic button exactly: white tile + brand-green
              // icon in BOTH themes, BOTH enabled and disabled. Disabled just
              // dims via opacity so the two buttons feel like a matched pair.
              ...iconBtnStyle, padding: 10, borderRadius: 10,
              backgroundColor: "var(--rm-voice-bg)",
              color: "var(--rm-voice-fg)",
              border: `1px solid var(--rm-voice-border)`,
              cursor: text.trim() ? "pointer" : "not-allowed",
              opacity: text.trim() ? 1 : 0.5,
              boxShadow: text.trim() ? "0 2px 6px rgba(107,165,57,0.25)" : "none",
            }}
          >
            <Send size={16} color="var(--rm-voice-fg)" />
          </button>
        )}
      </div>
    </div>
  );
}

// keyframes injected once
if (typeof document !== "undefined" && !document.getElementById("rmone-chat-keyframes")) {
  const style = document.createElement("style");
  style.id = "rmone-chat-keyframes";
  style.textContent = `
    @keyframes rmone-blink { 50% { opacity: 0; } }
    @keyframes rmone-spin { to { transform: rotate(360deg); } }
    .rmone-spin { animation: rmone-spin 1s linear infinite; }
    @keyframes rmone-shake {
      0%, 100% { transform: rotate(0deg); }
      15% { transform: rotate(-12deg); }
      30% { transform: rotate(10deg); }
      45% { transform: rotate(-8deg); }
      60% { transform: rotate(6deg); }
      75% { transform: rotate(-3deg); }
    }
    @keyframes rmone-mic-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(224,60,60,0.6); }
      50% { box-shadow: 0 0 0 8px rgba(224,60,60,0); }
    }
    @keyframes rmone-shimmer-slide {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .rmone-shimmer { animation: rmone-shimmer-slide 2.2s linear infinite; }
    @keyframes rmone-typing-bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
      40% { transform: translateY(-3px); opacity: 0.85; }
    }
  `;
  document.head.appendChild(style);
}
