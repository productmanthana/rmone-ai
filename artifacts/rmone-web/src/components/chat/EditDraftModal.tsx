import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Mail, Search, Send, AlertCircle, User, UserPlus, Briefcase, ExternalLink, Edit3 } from "lucide-react";
import { searchPeople, type PeopleSearchEntry } from "@/lib/api";
import { Z } from "@/lib/zLayers";

const C = {
  bg: "#253746",
  bgDeep: "#1B2832",
  card: "#2C3E50",
  cardSoft: "#34495E",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.18)",
  text: "#F4F6F8",
  textMuted: "rgba(244,246,248,0.65)",
  textDim: "rgba(244,246,248,0.45)",
  green: "#6BA539",
  greenLight: "#9DC957",
  orange: "#E87722",
  red: "#E03C3C",
  white: "#ffffff",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EditDraftValue {
  subject: string;
  body: string;
  recipient: string;
  rawText: string;
}

/** Optional one-click bulk recipient source (e.g. "Add project team"). */
export interface QuickAddRecipients {
  /** Button label, e.g. "Add project team". */
  label: string;
  /** Resolves to the email addresses to append as recipient chips. */
  load: () => Promise<string[]>;
  /** Shown when load() resolves to an empty list. */
  emptyMessage?: string;
}

interface Props {
  open: boolean;
  initial: EditDraftValue | null;
  onCancel: () => void;
  onConfirm: (next: { subject: string; body: string; recipient: string }) => void;
  busy?: boolean;
  quickAdd?: QuickAddRecipients;
}

export function EditDraftModal({ open, initial, onCancel, onConfirm, busy = false, quickAdd }: Props) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipient, setRecipient] = useState(""); // comma-separated chips
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientFocused, setRecipientFocused] = useState(false);
  const [recipientResults, setRecipientResults] = useState<PeopleSearchEntry[]>([]);
  const [recipientSearching, setRecipientSearching] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [quickAddNote, setQuickAddNote] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  /* Monotonic generation for quick-add requests. Bumped on every quick-add
   * click AND whenever the modal opens/closes/rehydrates, so a slow in-flight
   * load can never mutate a different (or reopened) draft when it resolves. */
  const quickAddGen = useRef(0);

  /* When modal opens with a fresh initial draft, hydrate state. */
  useEffect(() => {
    quickAddGen.current += 1; // invalidate any in-flight quick-add on open/close/draft change
    if (open && initial) {
      setSubject(initial.subject);
      setBody(initial.body);
      setRecipient(initial.recipient);
      setRecipientQuery("");
      setRecipientFocused(false);
      setRecipientResults([]);
      setRecipientError(null);
      setQuickAddBusy(false);
      setQuickAddNote(null);
    }
  }, [open, initial]);

  /* Debounced people-search whenever query changes. */
  useEffect(() => {
    if (!open) return;
    const q = recipientQuery.trim();
    if (q.length < 1) {
      setRecipientResults([]);
      setRecipientSearching(false);
      return;
    }
    let cancelled = false;
    setRecipientSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const results = await searchPeople(q, 200);
        if (!cancelled) setRecipientResults(results);
      } catch {
        if (!cancelled) setRecipientResults([]);
      } finally {
        if (!cancelled) setRecipientSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [recipientQuery, open]);

  /* ESC closes the modal. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, busy]);

  /* Click outside dropdown closes the suggestions list. */
  useEffect(() => {
    if (!recipientFocused) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setRecipientFocused(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [recipientFocused]);

  const chips = recipient
    .split(/[,;]\s*/)
    .map((s) => s.trim())
    .filter((s) => EMAIL_RE.test(s));

  const removeChip = useCallback((email: string) => {
    setRecipient((prev) => {
      const next = prev
        .split(/[,;]\s*/)
        .map((s) => s.trim())
        .filter((s) => EMAIL_RE.test(s) && s !== email)
        .join(", ");
      return next;
    });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const appendChip = useCallback((email: string) => {
    const e = email.trim();
    if (!EMAIL_RE.test(e)) return false;
    setRecipient((prev) => {
      const existing = prev
        .split(/[,;]\s*/)
        .map((s) => s.trim())
        .filter((s) => EMAIL_RE.test(s));
      if (existing.includes(e)) return prev;
      return existing.length === 0 ? e : `${existing.join(", ")}, ${e}`;
    });
    setRecipientError(null);
    return true;
  }, []);

  /* Bulk-append recipients from the optional quick-add source (e.g. the
   * record's current project team). Purely additive: existing chips stay,
   * duplicates are skipped case-insensitively, and every chip can still be
   * removed before sending. Guarded by quickAddGen so a slow response is
   * dropped if the modal closed, rehydrated, or a newer request started. */
  const handleQuickAdd = async () => {
    if (!quickAdd || quickAddBusy || busy) return;
    const gen = ++quickAddGen.current;
    setQuickAddBusy(true);
    setQuickAddNote(null);
    setRecipientError(null);
    try {
      const loaded = await quickAdd.load();
      if (quickAddGen.current !== gen) return; // stale — draft changed while loading
      const valid = [...new Set(loaded.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
      if (valid.length === 0) {
        setQuickAddNote({ text: quickAdd.emptyMessage ?? "No email addresses were found to add.", tone: "warn" });
      } else {
        // One functional update: dedupe against the TRUE previous state (not a
        // render-time snapshot), so chips typed while loading are never
        // duplicated case-variantly or dropped.
        const result = { added: 0 };
        setRecipient((prev) => {
          const parts = prev
            .split(/[,;]\s*/)
            .map((s) => s.trim())
            .filter((s) => EMAIL_RE.test(s));
          const seen = new Set(parts.map((s) => s.toLowerCase()));
          const fresh = valid.filter((e) => !seen.has(e));
          result.added = fresh.length;
          return fresh.length === 0 ? prev : [...parts, ...fresh].join(", ");
        });
        // Lazy updater: runs after the recipient updater above, so result.added
        // is populated by the time the note text is built.
        setQuickAddNote(() => (result.added > 0
          ? { text: `Added ${result.added} recipient${result.added === 1 ? "" : "s"}.`, tone: "ok" as const }
          : { text: "Everyone from that list is already a recipient.", tone: "ok" as const }));
      }
    } catch (error) {
      if (quickAddGen.current !== gen) return;
      setQuickAddNote({
        text: error instanceof Error && error.message ? error.message : "Couldn't load that list just now — please try again.",
        tone: "warn",
      });
    } finally {
      if (quickAddGen.current === gen) setQuickAddBusy(false);
    }
  };

  const handleConfirm = useCallback(() => {
    if (quickAddBusy) {
      setRecipientError("Hold on — recipients are still being added.");
      return;
    }
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    const pending = recipientQuery.trim();
    const allRaw = recipient
      .split(/[,;]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (pending && EMAIL_RE.test(pending) && !allRaw.includes(pending)) {
      allRaw.push(pending);
    }
    const recipientList = allRaw.filter((e) => EMAIL_RE.test(e));
    if (recipientList.length === 0) {
      setRecipientError("Please add at least one recipient before sending.");
      setRecipientFocused(true);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    if (recipientList.length !== allRaw.length) {
      setRecipientError("One of the recipients isn't a valid email address. Please fix it before sending.");
      setRecipientFocused(true);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    if (!trimmedBody) {
      setRecipientError("The email body cannot be empty.");
      return;
    }
    setRecipientError(null);
    onConfirm({
      subject: trimmedSubject,
      body: trimmedBody,
      recipient: recipientList.join(", "),
    });
  }, [subject, body, recipient, recipientQuery, onConfirm]);

  if (!open || !initial) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: Z.MODAL,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        style={{
          width: "min(680px, 96vw)",
          maxHeight: "92vh",
          background: C.bgDeep,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          borderBottomLeftRadius: 14,
          borderBottomRightRadius: 14,
          boxShadow: "0 -10px 40px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "rmone-slide-up 200ms ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Edit3 size={18} color={C.green} />
            <span style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Edit Email</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
              padding: 6,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.textMuted,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "14px 18px 8px", flex: 1 }}>
          {/* TO */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, letterSpacing: 0.4 }}>
                TO
              </div>
              {quickAdd && (
                <button
                  type="button"
                  onClick={() => void handleQuickAdd()}
                  disabled={busy || quickAddBusy}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 8,
                    border: `1px solid ${C.green}55`,
                    background: C.green + "18",
                    color: C.greenLight,
                    cursor: busy || quickAddBusy ? "wait" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  <UserPlus size={12} />
                  {quickAddBusy ? "Adding…" : quickAdd.label}
                </button>
              )}
            </div>
            <div style={{ position: "relative" }} ref={dropdownRef}>
              <div
                style={{
                  background: C.card,
                  borderRadius: 10,
                  padding: "6px 10px",
                  border: recipientError
                    ? `1.5px solid ${C.red}`
                    : `1px solid ${recipientFocused ? C.green + "60" : C.border}`,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 38,
                }}
                onClick={() => inputRef.current?.focus()}
              >
                <Search size={14} color={C.textMuted} style={{ marginLeft: 2, flexShrink: 0 }} />
                {chips.map((email) => (
                  <span
                    key={email}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      paddingLeft: 8,
                      paddingRight: 4,
                      paddingTop: 4,
                      paddingBottom: 4,
                      borderRadius: 14,
                      background: C.green + "22",
                      border: `1px solid ${C.green}55`,
                    }}
                  >
                    <Mail size={11} color={C.green} />
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 12,
                        color: C.text,
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {email}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeChip(email);
                      }}
                      aria-label={`Remove ${email}`}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        width: 16,
                        height: 16,
                        borderRadius: 8,
                        padding: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: C.textMuted,
                      }}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <input
                  ref={inputRef}
                  value={recipientQuery}
                  onChange={(e) => {
                    const t = e.target.value;
                    // Auto-chip when separator follows a complete email
                    const sepMatch = t.match(/^(\S+)[\s,;\n]+(.*)$/);
                    if (sepMatch) {
                      const head = sepMatch[1];
                      const tail = sepMatch[2];
                      if (EMAIL_RE.test(head)) {
                        appendChip(head);
                        setRecipientQuery(tail);
                        setRecipientResults([]);
                        return;
                      }
                    }
                    setRecipientQuery(t);
                    if (recipientError) setRecipientError(null);
                  }}
                  onFocus={() => setRecipientFocused(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && recipientQuery.length === 0 && chips.length > 0) {
                      removeChip(chips[chips.length - 1]);
                      e.preventDefault();
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      const t = recipientQuery.trim();
                      if (EMAIL_RE.test(t)) {
                        appendChip(t);
                        setRecipientQuery("");
                        setRecipientResults([]);
                      }
                    }
                  }}
                  placeholder={chips.length === 0 ? "Type a name or email…" : "Add another…"}
                  type="email"
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    flexGrow: 1,
                    minWidth: 140,
                    marginLeft: 4,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: C.text,
                    fontSize: 14,
                    fontWeight: 500,
                    padding: "6px 0",
                  }}
                />
                {recipientQuery.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRecipientQuery("");
                      setRecipientResults([]);
                      inputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      color: C.textMuted,
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {recipientError && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <AlertCircle size={12} color={C.red} />
                  <span style={{ fontSize: 12, color: C.red, fontWeight: 500 }}>{recipientError}</span>
                </div>
              )}
              {quickAddNote && !recipientError && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }} role="status">
                  {quickAddNote.tone === "warn" && <AlertCircle size={12} color={C.orange} />}
                  <span style={{ fontSize: 12, color: quickAddNote.tone === "warn" ? C.orange : C.textMuted, fontWeight: 500 }}>
                    {quickAddNote.text}
                  </span>
                </div>
              )}

              {recipientFocused && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: 6,
                    background: C.card,
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    maxHeight: 260,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
                    zIndex: 5,
                  }}
                >
                  <div style={{ overflowY: "auto", flex: 1 }}>
                    {recipientSearching && recipientResults.length === 0 && (
                      <div style={{ padding: "14px 12px", fontSize: 12, color: C.textDim }}>Searching…</div>
                    )}
                    {!recipientSearching && recipientResults.length === 0 && (
                      <div style={{ padding: "14px 12px", fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
                        {recipientQuery.trim()
                          ? EMAIL_RE.test(recipientQuery.trim())
                            ? `Press space or Enter to use "${recipientQuery.trim()}".`
                            : `No matches in your directory for "${recipientQuery.trim()}". Type the full email address (e.g. name@company.com) and press Enter to add it.`
                          : "Start typing to search people in your organization, or type any email address directly."}
                      </div>
                    )}
                    {recipientResults.map((r) => (
                      <button
                        key={`${r.email}-${r.source}`}
                        type="button"
                        onClick={() => {
                          appendChip(r.email);
                          setRecipientQuery("");
                          setRecipientResults([]);
                          setTimeout(() => inputRef.current?.focus(), 0);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 12px",
                          borderBottom: `1px solid ${C.border}`,
                          background: "transparent",
                          border: "none",
                          borderTop: "none",
                          borderLeft: "none",
                          borderRight: "none",
                          width: "100%",
                          cursor: "pointer",
                          textAlign: "left",
                          color: C.text,
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = C.green + "12";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                        }}
                      >
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            background: r.source === "user" ? C.green + "25" : C.orange + "25",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {r.source === "user" ? (
                            <User size={12} color={C.green} />
                          ) : (
                            <Briefcase size={12} color={C.orange} />
                          )}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span
                              style={{
                                fontWeight: 600,
                                fontSize: 13,
                                color: C.text,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flexShrink: 1,
                              }}
                            >
                              {r.name}
                            </span>
                            {r.projectCount && r.projectCount > 0 ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  background: C.green,
                                  color: C.white,
                                  padding: "2px 6px",
                                  borderRadius: 6,
                                  fontWeight: 700,
                                  fontSize: 9,
                                  flexShrink: 0,
                                }}
                              >
                                ON {r.projectCount} {r.projectCount === 1 ? "PROJECT" : "PROJECTS"}
                                <ExternalLink size={9} />
                              </span>
                            ) : null}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontSize: 11,
                              color: C.textMuted,
                              marginTop: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {r.email}
                            {r.title ? ` · ${r.title}` : ""}
                            {r.company ? ` · ${r.company}` : ""}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRecipientFocused(false)}
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      border: "none",
                      borderTop: `1px solid ${C.border}`,
                      cursor: "pointer",
                      textAlign: "right",
                      color: C.green,
                      fontWeight: 700,
                      fontSize: 14,
                      letterSpacing: 0.3,
                    }}
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* SUBJECT */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 6, letterSpacing: 0.4 }}>
              SUBJECT
            </div>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
              style={{
                width: "100%",
                background: C.card,
                borderRadius: 10,
                padding: "11px 12px",
                color: C.text,
                border: `1px solid ${C.border}`,
                fontSize: 14,
                fontWeight: 500,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* BODY */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 6, letterSpacing: 0.4 }}>
              MESSAGE
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Email body"
              rows={10}
              style={{
                width: "100%",
                background: C.card,
                borderRadius: 10,
                padding: "12px",
                color: C.text,
                border: `1px solid ${C.border}`,
                fontSize: 14,
                lineHeight: 1.5,
                minHeight: 220,
                resize: "vertical",
                outline: "none",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
            <div style={{ marginTop: 8, fontSize: 11, color: C.textDim, lineHeight: 1.4 }}>
              Add or change anything you'd like before sending. Your edits will be sent exactly as written.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "12px 18px 16px",
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1,
              padding: "13px 16px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.06)",
              color: C.textMuted,
              border: "none",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || quickAddBusy}
            style={{
              flex: 1.4,
              padding: "13px 16px",
              borderRadius: 12,
              background: C.green,
              color: C.white,
              border: "none",
              cursor: busy || quickAddBusy ? "wait" : "pointer",
              opacity: busy || quickAddBusy ? 0.75 : 1,
              fontWeight: 700,
              fontSize: 14,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: `0 2px 8px ${C.green}55`,
            }}
          >
            <Send size={16} />
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * parseDraftFromText
 * Mirrors the mobile openEditDraft parser: pulls subject / body / recipient
 * out of a streamed draft message and strips preambles, widget tags, and
 * markdown so the body is clean ready-to-send plain text.
 * ──────────────────────────────────────────────────────────────────── */
export async function parseDraftFromText(
  rawText: string,
  expandSchedule?: (projectId: string) => Promise<string | null>,
): Promise<EditDraftValue> {
  // Recipient: "draft email to alice@x.com" / "reply to Alice at alice@x.com"
  const recipientMatch = rawText.match(
    /(?:to|reply to|email)[:\s]+(?:[A-Za-z .'-]+\s+at\s+)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
  );
  const recipient = recipientMatch ? recipientMatch[1] : "";

  // Subject between **Subject:** and the next newline
  let subject = "";
  const subjMatch =
    rawText.match(/\*\*Subject:\*\*\s*([^\n]+)/i) || rawText.match(/Subject:\s*([^\n]+)/i);
  if (subjMatch) subject = subjMatch[1].trim().replace(/^\*+|\*+$/g, "").trim();

  // Body between --- markers (or fall back to entire message)
  let body = "";
  const dashMatch = rawText.match(/---\s*\n([\s\S]*?)\n---/);
  body = dashMatch ? dashMatch[1] : rawText;

  // Strip leading **Subject:** line if present
  body = body.replace(/^\s*\*\*Subject:\*\*[^\n]*\n+/i, "").replace(/^\s*Subject:[^\n]*\n+/i, "");
  // Strip "Here's my/your (updated )?draft email to ..." preamble
  body = body
    .replace(/^\s*Here'?s\s+(?:my|your)\s+(?:updated\s+)?draft\s+email\s+to\s+[^\n]+\n+/gi, "")
    .trim();
  // Strip inner ---\nSubject:...\n--- block
  body = body
    .replace(/^\s*---\s*\n+\s*\*?\*?Subject:\*?\*?[^\n]*\n+(?:\s*\n)*/i, "")
    .trim();
  // Strip trailing "Would you like to send..." / "Shall I send..." prompts
  body = body.replace(/\n+(?:---\s*)?\n*Would you like to send[\s\S]*$/i, "").trim();
  body = body
    .replace(
      /\n+(?:---\s*)?\n*(?:Shall I send|Should I send|Want me to send|Ready to send|Send (?:this|it)\??)[\s\S]*$/i,
      "",
    )
    .trim();
  // Strip widget/marker tags (only render in chat UI)
  body = body.replace(/\[BUTTONS:[^\]]+\]/gi, "");

  // Expand [SCHEDULE_TABLE:projectId] tags via the optional callback
  if (expandSchedule) {
    const schedMatches: { tag: string; projectId: string }[] = [];
    body.replace(/\[SCHEDULE_TABLE:([^\]]+)\]/gi, (full, pid) => {
      schedMatches.push({ tag: full, projectId: String(pid).trim() });
      return full;
    });
    if (schedMatches.length > 0) {
      const seen = new Set<string>();
      for (const { tag, projectId: pid } of schedMatches) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        try {
          const replacement = await expandSchedule(pid);
          body = body.split(tag).join(replacement ?? "");
        } catch {
          body = body.split(tag).join("");
        }
      }
    }
  } else {
    body = body.replace(/\[SCHEDULE_TABLE:[^\]]+\]/gi, "");
  }

  body = body.replace(
    /\[(?:PROJECT_DATES|LIFECYCLE_PICKER|HEALTH_GAUGE|WEEKLY_ALLOC|ALLOC_FORM|SELECT_PROJECT|CHART):[^\]]+\]/gi,
    "",
  );
  body = body.replace(/\[(?:ROSTER|PERSON_PROFILE|PMM_TABLE|OPP_TABLE|OPP_TABLE_2)\]/gi, "");

  // Convert [TIMELINE]...[/TIMELINE] blocks into plain-text schedule
  body = body.replace(/\[TIMELINE\]([\s\S]*?)\[\/TIMELINE\]/gi, (_m, inner) => {
    const rows = String(inner)
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.split("|").map((c) => c.trim()));
    if (!rows.length) return "";
    const fmt = (iso: string) => {
      if (!iso || iso === "N/A") return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    };
    const weeksBetween = (a: string, b: string): string => {
      if (!a || !b || a === "N/A" || b === "N/A") return "";
      const da = new Date(a).getTime();
      const db = new Date(b).getTime();
      if (isNaN(da) || isNaN(db) || db < da) return "";
      const w = Math.max(1, Math.ceil((db - da) / (7 * 86400000)));
      return ` (${w} ${w === 1 ? "week" : "weeks"})`;
    };
    const lines: string[] = ["Schedule:"];
    rows.forEach((r, i) => {
      const label = r[0] ?? "";
      const start = fmt(r[1] ?? "");
      const end = fmt(r[2] ?? "");
      const w = weeksBetween(r[1] ?? "", r[2] ?? "");
      const range = end ? `${start} → ${end}${w}` : start;
      lines.push(`${i + 1}. ${label} — ${range}`);
    });
    return "\n" + lines.join("\n") + "\n";
  });

  // Strip markdown formatting markers
  body = body.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  body = body.replace(/\*\*(.+?)\*\*/g, "$1");
  body = body.replace(/(^|[\s(])\*([^\s*][^*]*?)\*(?=[\s).,!?:;]|$)/g, "$1$2");
  body = body.replace(/__([^_]+)__/g, "$1");
  // Collapse extra blank lines
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  return { subject, body, recipient, rawText };
}
