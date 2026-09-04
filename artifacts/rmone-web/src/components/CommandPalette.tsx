import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Search,
  House,
  FolderKanban,
  UsersRound,
  Bot,
  BellRing,
  UserCircle,
  Sun,
  CornerDownLeft,
  Sparkles,
} from "lucide-react";
import { setChatPrompt } from "@/lib/chatBridge";

type CommandKind = "navigate" | "action";

type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  Icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
  kind: CommandKind;
  keywords: string[];
  run: (ctx: CommandRunCtx) => void;
};

type CommandRunCtx = {
  setLocation: (path: string) => void;
};

const STATIC_COMMANDS: CommandItem[] = [
  {
    id: "nav-home",
    label: "Go to Home",
    hint: "Daily briefing surface",
    Icon: House,
    kind: "navigate",
    keywords: ["home", "dashboard", "briefing", "overview"],
    run: ({ setLocation }) => setLocation("/"),
  },
  {
    id: "nav-projects",
    label: "Go to Projects",
    hint: "Pipeline and active jobs",
    Icon: FolderKanban,
    kind: "navigate",
    keywords: ["projects", "pipeline", "jobs", "opm", "pmm"],
    run: ({ setLocation }) => setLocation("/projects"),
  },
  {
    id: "nav-people",
    label: "Go to People",
    hint: "Resource list and allocations",
    Icon: UsersRound,
    kind: "navigate",
    keywords: ["people", "resources", "team", "staff", "allocations"],
    run: ({ setLocation }) => setLocation("/resources"),
  },
  {
    id: "nav-ai",
    label: "Open AI Chat",
    hint: "Ask the assistant",
    Icon: Bot,
    kind: "navigate",
    keywords: ["ai", "chat", "assistant", "ask", "question"],
    run: ({ setLocation }) => setLocation("/chat"),
  },
  {
    id: "nav-alerts",
    label: "Go to Alerts",
    hint: "Inbox of notifications",
    Icon: BellRing,
    kind: "navigate",
    keywords: ["alerts", "inbox", "notifications", "warnings"],
    run: ({ setLocation }) => setLocation("/alerts"),
  },
  {
    id: "nav-profile",
    label: "Open Profile",
    hint: "Your account",
    Icon: UserCircle,
    kind: "navigate",
    keywords: ["profile", "account", "me", "user"],
    run: ({ setLocation }) => setLocation("/profile"),
  },
  {
    id: "nav-analytics",
    label: "Open Analytics Dashboard",
    hint: "Pipeline analytics across PMM / OPM / LEM",
    Icon: Sun,
    kind: "navigate",
    keywords: ["analytics", "dashboard", "charts", "pipeline"],
    run: ({ setLocation }) => setLocation("/analytics"),
  },
  {
    id: "ai-bench",
    label: "Ask AI: who's on the bench?",
    hint: "Pre-fills the AI chat",
    Icon: Sparkles,
    kind: "action",
    keywords: ["bench", "idle", "available", "free", "ask"],
    run: ({ setLocation }) => {
      setChatPrompt(
        "Who is currently on the bench and could be redeployed this week?",
        { newSession: true, autoSend: true },
      );
      setLocation("/chat");
    },
  },
  {
    id: "ai-overload",
    label: "Ask AI: who's overloaded right now?",
    hint: "Pre-fills the AI chat",
    Icon: Sparkles,
    kind: "action",
    keywords: ["overload", "overallocated", "burnout", "capacity", "ask"],
    run: ({ setLocation }) => {
      setChatPrompt(
        "Which resources are projected over 100% utilization in the next 30 days, and which projects are driving it?",
        { newSession: true, autoSend: true },
      );
      setLocation("/chat");
    },
  },
  {
    id: "ai-pipeline",
    label: "Ask AI: pipeline at risk this month",
    hint: "Pre-fills the AI chat",
    Icon: Sparkles,
    kind: "action",
    keywords: ["pipeline", "at risk", "pursuits", "weighted", "ask"],
    run: ({ setLocation }) => {
      setChatPrompt(
        "Summarise the pursuits at risk this month, with weighted dollar value and the next-best follow-up for each.",
        { newSession: true, autoSend: true },
      );
      setLocation("/chat");
    },
  },
];

/**
 * Global ⌘K command palette. Opens with Cmd/Ctrl+K (or "/" anywhere
 * outside an input), supports keyboard nav, and routes to nav targets
 * or pre-fills the AI chat with common questions. Mounted once at the
 * Shell level so it's available everywhere.
 */
export function CommandPalette() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global open key: Cmd/Ctrl+K, also "/" when nothing is focused.
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      // Allow Cmd/Ctrl+K to close the palette while it's open even if
      // focus is in our own input, but never hijack the shortcut from
      // an active input/textarea/contentEditable in the rest of the app.
      if (meta && e.key.toLowerCase() === "k") {
        if (!open && isTypingTarget(e.target)) return;
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "/" && !open && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Reset state on open and focus the input.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return STATIC_COMMANDS;
    return STATIC_COMMANDS.filter((c) => {
      if (c.label.toLowerCase().includes(q)) return true;
      if (c.hint?.toLowerCase().includes(q)) return true;
      return c.keywords.some((k) => k.includes(q));
    });
  }, [query]);

  // Keep activeIdx within bounds whenever the filtered list shrinks.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  // Scroll the active row into view as the user navigates.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(
      `[data-cmd-idx="${activeIdx}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  function runByIndex(i: number) {
    const item = filtered[i];
    if (!item) return;
    item.run({ setLocation });
    setOpen(false);
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runByIndex(activeIdx);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center px-4"
      style={{
        backgroundColor: "rgba(15,26,36,0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        paddingTop: "12vh",
      }}
      onClick={() => setOpen(false)}
      data-testid="command-palette-overlay"
    >
      <div
        className="w-full max-w-xl rounded-2xl overflow-hidden"
        style={{
          backgroundColor: "var(--rm-panel)",
          border: "1px solid var(--rm-panel-border)",
          color: "var(--rm-text)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
        data-testid="command-palette"
      >
        <div
          className="flex items-center gap-2 px-3.5 py-3 border-b"
          style={{ borderColor: "var(--rm-panel-border)" }}
        >
          <Search size={16} color="var(--rm-text-muted)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onListKey}
            placeholder="Jump to a page or ask AI a quick question…"
            className="flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: "var(--rm-text)" }}
            data-testid="command-palette-input"
          />
          <kbd
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "var(--rm-panel-border)",
              color: "var(--rm-text-muted)",
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
            }}
          >
            ESC
          </kbd>
        </div>
        <div
          ref={listRef}
          className="max-h-[55vh] overflow-y-auto py-1.5"
          onKeyDown={onListKey}
        >
          {filtered.length === 0 ? (
            <div
              className="px-4 py-6 text-center text-[12px]"
              style={{ color: "var(--rm-text-muted)" }}
            >
              No results — try a different word.
            </div>
          ) : (
            filtered.map((c, i) => {
              const Icon = c.Icon;
              const active = i === activeIdx;
              return (
                <button
                  key={c.id}
                  type="button"
                  data-cmd-idx={i}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => {
                    setActiveIdx(i);
                    runByIndex(i);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors"
                  style={{
                    backgroundColor: active
                      ? "rgba(169,194,63,0.14)"
                      : "transparent",
                    color: "var(--rm-text)",
                  }}
                  data-testid={`command-item-${c.id}`}
                >
                  <span
                    className="w-7 h-7 rounded-md inline-flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor:
                        c.kind === "action"
                          ? "rgba(169,194,63,0.18)"
                          : "var(--rm-panel-border)",
                      color:
                        c.kind === "action" ? "#A9C23F" : "var(--rm-text)",
                    }}
                  >
                    <Icon size={14} strokeWidth={2.2} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold leading-tight truncate">
                      {c.label}
                    </span>
                    {c.hint ? (
                      <span
                        className="block text-[11px] truncate"
                        style={{ color: "var(--rm-text-muted)" }}
                      >
                        {c.hint}
                      </span>
                    ) : null}
                  </span>
                  {active ? (
                    <CornerDownLeft
                      size={12}
                      color="rgba(169,194,63,0.85)"
                      strokeWidth={2.5}
                    />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        <div
          className="flex items-center justify-between px-3.5 py-2 text-[10px] border-t"
          style={{
            borderColor: "var(--rm-panel-border)",
            color: "var(--rm-text-faint)",
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
            letterSpacing: "0.04em",
          }}
        >
          <span>↑↓ to navigate · ↵ to select</span>
          <span>⌘K · /</span>
        </div>
      </div>
    </div>
  );
}
