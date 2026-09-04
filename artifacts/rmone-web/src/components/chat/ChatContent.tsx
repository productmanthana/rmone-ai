/**
 * ChatContent — renders an assistant message's content as a sequence of
 * blocks (text + structured widgets). Mirrors the mobile chat renderer.
 *
 * Widgets mounted here read sidecar data passed by the parent (roster,
 * oppTable, oppTable2, pmmTable, personProfile). Inline markers like
 * [HEALTH_GAUGE:...] carry their own data.
 */
import React, { useState } from "react";
import { fmtHours, fmtPct } from "@/lib/utils";
import {
  Briefcase, Building2, CheckCircle2, Mail, MapPin, Phone, User,
  XCircle, Folder, AlertTriangle, Edit2, Check, X,
  Zap, FileText, Users as UsersIcon, ChevronRight, BarChart3,
} from "lucide-react";

import { HealthGauge, healthColor, healthLabel } from "@/components/HealthGauge";
import type {
  PersonProfile, OppRow, PmmRow, RosterPerson,
} from "@/lib/api";
import { parseBlocks, type Block, type HGIssue, type DecisionBrief, type DraftPanel, type DecisionAction, type DecisionActionPayload } from "./parseBlocks";
import { WeeklyAllocationFormCard } from "./WeeklyAllocationFormCard";
import { TimelineBlock, ChartBlock } from "./TimelineChartBlocks";
import { ScheduleTableWidget } from "./ScheduleTableWidget";
import { LifecyclePickerWidget } from "./LifecyclePickerWidget";
import { ProjectDatesWidget } from "./ProjectDatesWidget";
import { AllocFormCard } from "./AllocFormCard";
import { AssignmentSetupCard } from "./AssignmentSetupCard";
import { EngagePicker, ApplyPicker, DeferPicker, OpenReqForm, prefetchPickerData } from "./PickerModal";
import { Z } from "@/lib/zLayers";

// Theme-aware: text / surface tokens read from the shared CSS variables
// so the chat answer bubble renders correctly in BOTH light and dark mode.
// (Brand colors and the explicit bgDark / bgDarker accents — used for
// fixed dark cards like the email-draft header — stay fixed.)
const C = {
  green: "#6BA539",
  greenLight: "#9DC957",
  orange: "#E87722",
  red: "#E03C3C",
  chipAccent: "#29BEE7",
  text: "var(--rm-text)",
  textMuted: "var(--rm-text-muted)",
  border: "var(--rm-panel-border)",
  bg: "var(--rm-panel)",
  bgSoft: "var(--rm-panel-soft)",
  bgDark: "#253746",
  bgDarker: "#1B2832",
};

interface Props {
  text: string;
  isStreaming?: boolean;
  isLatestAssistant?: boolean;
  roster?: RosterPerson[];
  oppTable?: { title: string; rows: OppRow[]; summary: string };
  oppTable2?: { title: string; rows: OppRow[]; summary: string };
  pmmTable?: { title: string; rows: PmmRow[]; summary: string };
  personProfile?: PersonProfile;
  onSend: (msg: string) => void;
  /** Called when the user clicks the EDIT button on an email-draft message.
   * Receives the FULL raw assistant text so the caller can parse subject /
   * body / recipient out of it. When omitted, EDIT falls back to sending the
   * literal "EDIT" string (legacy behavior). */
  onEditDraft?: (rawText: string) => void;
  /** Stable id of the assistant message this content belongs to. Used by
   *  prefill-aware widgets (WEEKLY_ALLOC) to dedup directive application
   *  across re-renders without bleeding state into a fresh message. */
  messageKey?: string | number;
  /** Persisted SITREP chip confirmation state (per-message). Index into
   *  brief.actions → true once the user has tapped APPLY/DEFER/ENGAGE/OPEN.
   *  Hoisted out of <ActionChip/> so the confirmation survives reloads and
   *  re-mounts. */
  chipStates?: Record<number, boolean>;
  /** Called when the user confirms a SITREP chip. The parent persists this
   *  into the assistant message so the chip remains "Applied" / "Deferred"
   *  / "Engaged" / "Opened" across renders. */
  onChipConfirm?: (actionIndex: number) => void;
  /** When true all write widgets (WeeklyAllocationFormCard, AssignmentSetupCard)
   *  are rendered in read-only mode — inputs disabled, Save hidden. */
  readOnly?: boolean;
}

export function ChatContent(props: Props) {
  const blocks = React.useMemo(() => {
    const parsed = parseBlocks(props.text);
    // Health gauge MUST always render at the top of the assistant message,
    // regardless of where the AI emitted the [HEALTH_GAUGE:...] tag in the
    // text stream. Stable sort: health_gauge first, everything else preserved.
    const gauges: typeof parsed = [];
    const rest: typeof parsed = [];
    for (const b of parsed) {
      if (b.type === "health_gauge") gauges.push(b);
      else rest.push(b);
    }
    const ordered = [...gauges, ...rest];
    // pmmTable sidecar data arrives via SSE but the AI is instructed NOT to
    // emit [PMM_TABLE] in its text (to avoid duplication). Auto-inject the
    // pmm_table block at the end when the sidecar data is present but no tag
    // was parsed from the text.
    if (props.pmmTable && !ordered.some(b => b.type === "pmm_table")) {
      ordered.push({ type: "pmm_table" });
    }
    return ordered;
  }, [props.text, props.pmmTable]);
  return (
    <>
      <style>{`
        @keyframes chat-fade-in-up {
          0% { opacity: 0; transform: translateY(12px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes chat-slide-right {
          0% { transform: scaleX(0); }
          100% { transform: scaleX(1); }
        }
        @keyframes chat-bar-grow {
          0% { transform: scaleY(0); opacity: 0; }
          100% { transform: scaleY(1); opacity: 1; }
        }
        .chat-block-enter {
          animation: chat-fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          opacity: 0;
        }
        .chat-hover-card {
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease;
        }
        .chat-hover-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        }
        .chat-table-row {
          transition: background-color 0.15s ease;
        }
        .chat-table-row:hover {
          background-color: var(--rm-panel-hover) !important;
        }
        @media (prefers-reduced-motion: reduce) {
          .chat-block-enter { animation: none; opacity: 1; }
        }
      `}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {blocks.map((b, i) => (
          <div key={i} className="chat-block-enter" style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` }}>
            <BlockRenderer block={b} {...props} />
          </div>
        ))}
      </div>
    </>
  );
}

function BlockRenderer({ block, ...props }: Props & { block: Block }) {
  const { onSend, onEditDraft, text, roster, oppTable, oppTable2, pmmTable, personProfile, isStreaming, isLatestAssistant } = props;
  switch (block.type) {
    case "text":
      return <TextMarkdown text={block.content} onSend={onSend} />;
    case "buttons":
      return (
        <ButtonsBlock
          labels={block.labels}
          onSend={onSend}
          onEditDraft={isLatestAssistant && onEditDraft ? () => onEditDraft(text) : undefined}
        />
      );
    case "roster":
      if (roster && roster.length > 0) return <RosterTable roster={roster} onSelect={onSend} />;
      if (isStreaming) return <Hint>RM ONE agents are evaluating the roster…</Hint>;
      return null;
    case "person_profile":
      if (personProfile) return <PersonProfileCard profile={personProfile} />;
      return <Hint>Loading profile…</Hint>;
    case "opp_table":
      if (oppTable && oppTable.rows.length > 0) return <OppTable data={oppTable} onSelect={onSend} />;
      if (isStreaming) return <Hint>RM ONE agents are evaluating opportunities…</Hint>;
      return null;
    case "opp_table_2":
      if (oppTable2 && oppTable2.rows.length > 0) return <OppTable data={oppTable2} onSelect={onSend} />;
      if (isStreaming) return <Hint>RM ONE agents are evaluating projects…</Hint>;
      return null;
    case "pmm_table":
      if (pmmTable && pmmTable.rows.length > 0) return <PmmTable data={pmmTable} onSelect={onSend} />;
      if (pmmTable && pmmTable.rows.length === 0) return <Hint>No projects found for this period.</Hint>;
      if (isStreaming) return <Hint>RM ONE agents are evaluating projects…</Hint>;
      return null;
    case "health_gauge":
      return <HealthGaugeCard {...block} passed={block.passed ?? []} />;
    case "update_success":
      return <UpdateSuccessCard recordId={block.recordId} person={block.person} />;
    case "update_fail":
      return <UpdateFailCard reason={block.reason} />;
    case "select_project":
      return <SelectProjectList projects={block.projects} onSend={onSend} />;
    case "decision_brief":
      return (
        <SitrepCard
          brief={block.brief}
          chipStates={props.chipStates}
          onChipConfirm={props.onChipConfirm}
        />
      );
    case "draft_panel":
      return <DraftForMePanel panel={block.panel} onSend={onSend} />;
    case "alloc_form":
      return (
        <AllocFormCard
          personName={block.personName}
          projectId={block.projectId}
          projectName={block.projectName}
          onSubmit={onSend}
        />
      );
    case "assignment_setup":
      return (
        <AssignmentSetupCard
          personName={block.personName}
          projectId={block.projectId}
          projectName={block.projectName}
          onSubmit={onSend}
          readOnly={props.readOnly}
        />
      );
    case "weekly_alloc":
      return (
        <WeeklyAllocationFormCard
          personName={block.personName}
          projectId={block.projectId}
          projectName={block.projectName}
          prefill={block.prefill}
          totalSet={block.totalSet}
          perWeekSet={block.perWeekSet}
          eachPhaseSet={block.eachPhaseSet}
          clearAll={block.clearAll}
          autosave={block.autosave}
          alreadyAssigned={block.alreadyAssigned}
          messageKey={props.messageKey}
          readOnly={props.readOnly}
          onSend={props.onSend}
        />
      );
    case "schedule_table":
      return <ScheduleTableWidget projectId={block.projectId} />;
    case "lifecycle_picker":
      return <LifecyclePickerWidget projectId={block.projectId} onSend={onSend} />;
    case "project_dates":
      return <ProjectDatesWidget projectId={block.projectId} />;
    case "chart":
      return <ChartBlock content={block.content} />;
    case "timeline":
      return <TimelineBlock content={block.content} />;
    case "suggestions":
      if (!isLatestAssistant || isStreaming) return null;
      return <SuggestionChips questions={block.questions} onSend={onSend} />;
    default:
      return null;
  }
}

function SuggestionChips({ questions, onSend }: { questions: string[]; onSend: (msg: string) => void }) {
  const [hovered, setHovered] = React.useState<number | null>(null);
  if (questions.length === 0) return null;
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
        Related questions
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {questions.map((q, i) => (
          <button
            key={i}
            onClick={() => onSend(q)}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === i ? C.chipAccent : "transparent",
              color: hovered === i ? "#fff" : C.chipAccent,
              border: `1.5px solid ${C.chipAccent}`,
              borderRadius: 20,
              padding: "5px 13px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "background 0.15s, color 0.15s",
              lineHeight: 1.4,
              textAlign: "left",
            }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────  TEXT (markdown — bold, code, bullets, headings, numbered lists, pipe tables)
   Faithful port of the mobile renderTextBlock + TableBlock + renderInline (artifacts/rmone-mobile/app/(tabs)/chat.tsx ~3297-3490).
   Same structure (line-by-line block detection, table buffering),
   same colors (Colors.darkDeep header, Colors.green ID column, Colors.darkCard alt rows),
   same fixed column widths by header semantic, same hover-tooltip behavior,
   same 1- vs 2-line truncation per column type. ───────────── */

// Table palette — theme-aware so the table reads as part of the
// surrounding bubble in BOTH light and dark mode. In light mode this
// gives a white table on a white bubble with a soft gray header and
// gentle zebra. In dark mode it gives a navy table on the navy bubble
// with a slightly lighter header and zebra row, and white cell text.
const M = {
  headerBg: "var(--rm-panel-soft)",   // soft elevated header
  headerText: "var(--rm-text-muted)", // muted header label
  rowAlt: "var(--rm-panel-soft)",     // subtle zebra (slightly elevated)
  rowBase: "var(--rm-panel)",         // base row = bubble surface
  cellText: "var(--rm-text)",         // matches C.text in the rest of the bubble
  green: "#6BA539",
  border: "var(--rm-panel-border)",   // matches C.border
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Mirror of mobile renderInline (chat.tsx:3297) — splits on **bold** and renders bold/code.
function renderInlineHtml(s: string): string {
  const esc = escapeHtml(s);
  return esc
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--rm-panel-soft);padding:1px 4px;border-radius:3px;font-size:13px">$1</code>');
}

// Mirror of mobile colWidthForHeader (chat.tsx:3314).
function colWidthForHeader(h: string): number {
  if (/id|ticket|record|ref|code/i.test(h))             return 116;
  if (/title|name|description|project|task/i.test(h))   return 152;
  if (/city|location|region|site|state/i.test(h))       return 104;
  if (/value|amount|fee|cost|revenue|budget/i.test(h))  return 84;
  if (/alloc|util|pct|percent|%|chance|score/i.test(h)) return 72;
  if (/status|phase|stage|type/i.test(h))               return 80;
  return 90;
}

function TextMarkdown({ text, onSend }: { text: string; onSend?: (msg: string) => void }) {
  if (!text || !text.trim()) return null;
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let tableBuf: string[] = [];

  const flushTable = () => {
    if (tableBuf.length > 0) {
      out.push(<TableBlock key={`t-${out.length}`} tableLines={[...tableBuf]} onSend={onSend} />);
      tableBuf = [];
    }
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) { tableBuf.push(trimmed); return; }
    flushTable();
    if (!trimmed) { out.push(<div key={`sp-${i}`} style={{ height: 6 }} />); return; }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      // Slightly tighter scale + heavier weight + tighter tracking.
      // Section colors preserved (H3/H4 stay green per brand) — only the
      // type metrics changed to read as polished headings instead of
      // default-styled HTML.
      const fontSize = level === 1 ? 20 : level === 2 ? 17 : level === 3 ? 15 : 14;
      const color = level <= 2 ? C.text : C.green;
      out.push(
        <div key={`h-${i}`} style={{
          color, fontWeight: 700, fontSize,
          marginTop: level === 1 ? 14 : level === 2 ? 12 : 10,
          marginBottom: level <= 2 ? 6 : 4,
          lineHeight: 1.3,
          letterSpacing: "-0.012em",
        }}>{headingText}</div>,
      );
      return;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      out.push(
        <div key={`b-${i}`} style={{ display: "flex", flexDirection: "row", marginBottom: 4 }}>
          <span style={{ color: C.green, marginRight: 8, fontSize: 15, lineHeight: "24px", flexShrink: 0 }}>•</span>
          <span
            style={{ flex: 1, color: C.text, fontSize: 15, lineHeight: "24px" }}
            dangerouslySetInnerHTML={{ __html: renderInlineHtml(trimmed.slice(2)) }}
          />
        </div>,
      );
      return;
    }

    const numMatch = trimmed.match(/^(\d+)\.\s(.+)$/);
    if (numMatch) {
      out.push(
        <div key={`n-${i}`} style={{ display: "flex", flexDirection: "row", marginTop: 6, marginBottom: 4 }}>
          <div style={{
            background: C.green, borderRadius: 12, width: 24, height: 24,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginRight: 10, marginTop: 1, flex: "0 0 auto",
          }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 12 }}>{numMatch[1]}</span>
          </div>
          <div
            style={{ flex: 1, color: C.text, fontSize: 15, lineHeight: "24px" }}
            dangerouslySetInnerHTML={{ __html: renderInlineHtml(numMatch[2]) }}
          />
        </div>,
      );
      return;
    }

    out.push(
      <div key={`p-${i}`}
        style={{ color: C.text, fontSize: 15, lineHeight: "24px", marginBottom: 4 }}
        dangerouslySetInnerHTML={{ __html: renderInlineHtml(trimmed) }}
      />,
    );
  });
  flushTable();

  return <div style={{ display: "flex", flexDirection: "column" }}>{out}</div>;
}

// Faithful port of the mobile TableBlock (chat.tsx:3324). Same column widths,
// same dark header / alternating dark card rows, same green-underlined ID column
// that pings onSend(cell), same hover tooltip showing header + full cell text.
function TableBlock({ tableLines, onSend }: { tableLines: string[]; onSend?: (msg: string) => void }) {
  const [pressedKey, setPressedKey] = React.useState<string | null>(null);

  const rows = tableLines
    .filter((l) => !/^\|[-:\s|]+\|?$/.test(l))
    .map((l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
  if (rows.length === 0) return null;

  const headers = rows[0] ?? [];
  const colMins = headers.map(colWidthForHeader);
  // Distribute remaining horizontal space using semantic weights — long-text
  // columns (name, title, project) get more growth than tiny ones (%, status).
  const colWeights = headers.map((h) => {
    if (/title|name|description|project|task/i.test(h)) return 3;
    if (/active|projects|details|notes|comment/i.test(h)) return 4;
    if (/city|location|region|site|state/i.test(h)) return 2;
    if (/value|amount|fee|cost|revenue|budget/i.test(h)) return 1;
    if (/alloc|util|pct|percent|%|chance|score/i.test(h)) return 0;
    if (/status|phase|stage|type/i.test(h)) return 1;
    if (/id|ticket|record|ref|code/i.test(h)) return 0;
    return 1;
  });

  return (
    <div style={{ margin: "8px 0" }}>
      <div style={{
        borderRadius: 8, overflow: "hidden",
        border: `1px solid ${M.border}`,
        width: "100%",
      }}>
        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "auto",
        }}>
          <colgroup>
            {headers.map((_, ci) => (
              <col
                key={ci}
                style={{
                  minWidth: colMins[ci],
                  width: colWeights[ci] === 0 ? colMins[ci] : "auto",
                }}
              />
            ))}
          </colgroup>
          <tbody>
            {rows.map((row, ri) => {
              const isHeader = ri === 0;
              const rowBg = isHeader ? M.headerBg : ri % 2 === 0 ? M.rowBase : M.rowAlt;
              return (
                <tr
                  key={ri}
                  className="chat-table-row"
                  style={{
                    background: rowBg,
                    borderBottom: ri < rows.length - 1 ? `1px solid ${M.border}` : "none",
                  }}
                >
                  {row.map((cell, ci) => {
                    const isIdCol = !isHeader && ci === 0 && !!onSend && !!cell;
                    const key = `${ri}-${ci}`;
                    const baseTd: React.CSSProperties = {
                      padding: "8px 10px",
                      verticalAlign: "top",
                      fontSize: 13,
                      lineHeight: "18px",
                      wordBreak: "break-word",
                    };

                    if (isHeader) {
                      return (
                        <th
                          key={ci}
                          style={{
                            ...baseTd,
                            color: M.headerText,
                            fontWeight: 700,
                            textAlign: "left",
                            whiteSpace: "nowrap",
                            fontSize: 12,
                            letterSpacing: 0.2,
                            textTransform: "uppercase",
                          }}
                        >{cell}</th>
                      );
                    }

                    if (isIdCol) {
                      return (
                        <td
                          key={ci}
                          onClick={() => onSend!(cell)}
                          onMouseDown={() => setPressedKey(key)}
                          onMouseUp={() => setPressedKey(null)}
                          onMouseLeave={() => setPressedKey((k) => (k === key ? null : k))}
                          style={{
                            ...baseTd, cursor: "pointer",
                            background: pressedKey === key ? `${M.green}1A` : undefined,
                            color: M.green, fontWeight: 600,
                            textDecoration: "underline",
                            whiteSpace: "nowrap",
                          }}
                          title={cell}
                        >{cell}</td>
                      );
                    }

                    return (
                      <td
                        key={ci}
                        style={{
                          ...baseTd,
                          color: M.cellText,
                          fontWeight: 400,
                        }}
                        title={cell}
                      >{cell}</td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────  HINT / PLACEHOLDER  ───────────── */
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: C.textMuted, fontSize: 12, fontStyle: "italic", padding: "4px 0" }}>
      {children}
    </div>
  );
}

function PlaceholderCard({ label, icon }: { label: string; icon: string }) {
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: C.bgSoft, border: `1px dashed ${C.border}`,
      display: "flex", alignItems: "center", gap: 8,
      fontSize: 12, color: C.textMuted,
    }}>
      <AlertTriangle size={14} color={C.orange} />
      <span>{label}</span>
      <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.6 }}>{icon}</span>
    </div>
  );
}

/* ─────────────  BUTTONS (action / confirm flows)  ───────────── */
function ButtonsBlock({
  labels,
  onSend,
  onEditDraft,
}: {
  labels: string[];
  onSend: (m: string) => void;
  /** When provided, intercept clicks on the EDIT button and open the
   * email-draft editor instead of sending the literal "EDIT" string. */
  onEditDraft?: () => void;
}) {
  const isConfirm = labels.some((l) =>
    ["YES", "NO", "CONFIRM", "YES_SEND", "CANCEL", "YES_PROCEED"].includes(l.trim().toUpperCase()));
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 10,
      marginTop: isConfirm ? 12 : 8,
      marginBottom: 4,
      paddingTop: isConfirm ? 12 : 0,
      borderTop: isConfirm ? `1px solid ${C.border}` : undefined,
    }}>
      {labels.map((rawLabel) => {
        const label = rawLabel.trim().toUpperCase();
        const isProjectId = /^[A-Z]{2,5}-\d{2,8}(?:-\d{3,8})?/.test(label);
        if (isProjectId) {
          const prefix = label.split("-")[0];
          const color = prefix === "PMM" ? C.green
            : prefix === "OPM" ? C.orange
            : prefix === "CNS" ? "#6B7FF0"
            : C.greenLight;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onSend(label)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: color + "18",
                border: `1.5px solid ${color}60`,
                padding: "8px 12px", borderRadius: 10,
                cursor: "pointer", color,
                fontWeight: 700, fontSize: 12,
              }}
            >
              <span style={{ background: color, color: "#fff", padding: "2px 5px", borderRadius: 4, fontSize: 9 }}>
                {prefix}
              </span>
              {label.slice(prefix.length + 1)}
            </button>
          );
        }
        const display = label === "YES_SEND" ? "SEND" : label === "YES_PROCEED" ? "PROCEED" : label;
        const bg = (label === "YES" || label === "YES_SEND" || label === "YES_PROCEED" || label === "CONFIRM") ? C.green
          : (label === "NO" || label === "CANCEL") ? C.red
          : label === "EDIT" ? C.orange
          : C.green;
        const Icon = (label === "YES" || label === "YES_SEND" || label === "YES_PROCEED" || label === "CONFIRM") ? Check
          : (label === "NO" || label === "CANCEL") ? X
          : Edit2;
        const handleClick = () => {
          if (label === "EDIT" && onEditDraft) {
            onEditDraft();
          } else {
            onSend(label);
          }
        };
        return (
          <button
            key={label}
            type="button"
            onClick={handleClick}
            style={{
              flex: isConfirm ? 1 : undefined,
              minWidth: isConfirm ? 100 : undefined,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: bg, color: "#fff", border: "none",
              padding: isConfirm ? "12px 18px" : "10px 16px",
              borderRadius: isConfirm ? 12 : 8,
              fontWeight: 700, fontSize: isConfirm ? 14 : 13,
              cursor: "pointer",
              boxShadow: isConfirm ? `0 2px 6px ${bg}55` : undefined,
            }}
          >
            <Icon size={isConfirm ? 16 : 14} />
            {display}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────  ROSTER  ───────────── */
function RosterTable({ roster, onSelect }: { roster: RosterPerson[]; onSelect: (m: string) => void }) {
  const sorted = [...roster].sort((a, b) => a.p - b.p);
  return (
    <div style={{ margin: "8px 0", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ background: C.bgSoft, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: C.text, display: "flex", justifyContent: "space-between" }}>
        <span>Roster ({sorted.length})</span>
        <span style={{ color: C.textMuted, fontWeight: 500 }}>Tap a name to ask about them</span>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {sorted.map((p, i) => {
          const status = p.p === 0 ? "Bench" : p.p > 100 ? "Over" : p.p >= 70 ? "Good" : "Light";
          const color = status === "Bench" ? C.red
            : status === "Over" ? C.orange
            : status === "Good" ? C.green : C.greenLight;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(`Tell me about ${p.n}`)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", background: C.bg, border: "none",
                borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
                cursor: "pointer", textAlign: "left",
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: C.text, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.n}</div>
                {p.r && <div style={{ fontSize: 11, color: C.textMuted }}>{p.r}</div>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color }}>
                {fmtPct(p.p)} · {p.t}h
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────  OPP TABLE / PMM TABLE  ───────────── */
function OppTable({ data, onSelect }: { data: { title: string; rows: OppRow[]; summary: string }; onSelect: (m: string) => void }) {
  return (
    <div style={{ margin: "8px 0", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ background: C.bgSoft, padding: "10px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{data.title}</div>
        {data.summary && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{data.summary}</div>}
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {data.rows.map((r, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(`Tell me about ${r.opmId || r.pmmId}`)}
            style={{
              width: "100%", display: "block", textAlign: "left",
              padding: "10px 12px", background: C.bg, border: "none",
              borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              {r.opmId && <span style={{ background: C.orange, color: "#fff", padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700 }}>OPM</span>}
              <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{r.opmId || r.pmmId}</span>
              {r.status && <span style={{ marginLeft: "auto", fontSize: 10, color: C.textMuted }}>{r.status}</span>}
            </div>
            <div style={{ fontSize: 13, color: C.text, marginBottom: 2 }}>{r.name}</div>
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: C.textMuted }}>
              {r.value && <span>{r.value}</span>}
              {r.city && <span><MapPin size={10} style={{ display: "inline", verticalAlign: -1 }} /> {r.city}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PmmTable({ data, onSelect }: { data: { title: string; rows: PmmRow[]; summary: string }; onSelect: (m: string) => void }) {
  return (
    <div style={{ margin: "8px 0", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ background: C.bgSoft, padding: "10px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{data.title}</div>
        {data.summary && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{data.summary}</div>}
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {data.rows.map((r, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(`Tell me about ${r.id}`)}
            style={{
              width: "100%", display: "block", textAlign: "left",
              padding: "10px 12px", background: C.bg, border: "none",
              borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ background: C.green, color: "#fff", padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700 }}>PMM</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{r.id}</span>
              {r.status && <span style={{ marginLeft: "auto", fontSize: 10, color: C.textMuted }}>{r.status}</span>}
            </div>
            <div style={{ fontSize: 13, color: C.text, marginBottom: 2 }}>{r.name}</div>
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: C.textMuted }}>
              {r.value && <span>{r.value}</span>}
              {r.city && <span><MapPin size={10} style={{ display: "inline", verticalAlign: -1 }} /> {r.city}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────  PERSON PROFILE  ───────────── */
function PersonProfileCard({ profile }: { profile: PersonProfile }) {
  const totalH = profile.weeks.reduce((s, w) => s + (w.hours ?? 0), 0);
  const peakWeek = profile.weeks.reduce<{ period: string; pct: number; hours: number } | null>(
    (best, w) => {
      const hrs = w.hours ?? 0;
      if (!best || w.pct > best.pct) return { period: w.period, pct: w.pct, hours: hrs };
      return best;
    },
    null,
  );
  const activeWeeksCount = profile.weeks.filter((w) => w.pct > 0).length;
  const avgPct = profile.avgPct;
  const status = profile.status;
  const statusColor = status === "Bench" ? C.red
    : status === "Over" || status === "Overloaded" ? C.orange
    : status === "Good" ? C.green : C.red;
  // Header gradient mirrors the status color so the card visually telegraphs
  // utilization state (green = good, red = bench/under, orange = over) without
  // the user having to read the badge.
  const headerGradient = status === "Over" || status === "Overloaded"
    ? `linear-gradient(135deg, ${C.bgDark} 0%, ${C.bgDarker} 60%, ${C.orange}33 100%)`
    : status === "Bench"
      ? `linear-gradient(135deg, ${C.bgDark} 0%, ${C.bgDarker} 60%, ${C.red}33 100%)`
      : `linear-gradient(135deg, ${C.bgDark} 0%, ${C.bgDarker} 60%, ${C.green}33 100%)`;

  return (
    <div style={{
      margin: "8px 0",
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      overflow: "hidden",
      background: C.bg,
      boxShadow: "0 1px 3px rgba(37,55,70,0.04), 0 8px 24px rgba(37,55,70,0.06)",
    }}>
      {/* Hero header — gradient that reflects status, big avatar, prominent name */}
      <div style={{
        padding: "18px 20px",
        background: headerGradient,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        gap: 14,
        position: "relative",
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 26,
          background: "rgba(255,255,255,0.16)",
          color: "#fff",
          border: "2px solid rgba(255,255,255,0.28)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, fontWeight: 700, letterSpacing: -0.5,
          flex: "0 0 auto",
          backdropFilter: "blur(6px)",
        }}>
          {(profile.name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", lineHeight: 1.2, letterSpacing: -0.2 }}>
            {profile.name}
          </div>
          {profile.jobTitle && (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.78)", marginTop: 3, fontWeight: 500 }}>
              {profile.jobTitle}
            </div>
          )}
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.62)", marginTop: 4 }}>
            {profile.periodRange} · {profile.mode}
          </div>
        </div>
        <div style={{
          padding: "6px 12px", borderRadius: 999,
          background: "#fff",
          color: statusColor,
          fontSize: 11, fontWeight: 700,
          display: "inline-flex", alignItems: "center", gap: 6,
          flex: "0 0 auto",
          boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
          letterSpacing: 0.2,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: statusColor }} />
          {status} ({totalH}h)
        </div>
      </div>

      {/* KPI strip — at-a-glance metrics */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        borderBottom: `1px solid ${C.border}`,
        background: "var(--rm-panel-soft)",
      }}>
        <KpiCell label="Total Hours" value={`${fmtHours(totalH)}h`} accent={C.text} />
        <KpiCell label="Avg Capacity" value={fmtPct(avgPct)} accent={avgPct > 100 ? C.orange : avgPct >= 70 ? C.green : C.red} divider />
        <KpiCell
          label="Peak Week"
          value={peakWeek ? `${fmtHours(peakWeek.hours)}h` : "—"}
          sub={peakWeek ? fmtPct(peakWeek.pct) : undefined}
          accent={peakWeek && peakWeek.pct > 100 ? C.orange : C.text}
          divider
        />
        <KpiCell
          label="Active Projects"
          value={`${profile.projects?.length ?? 0}`}
          sub={activeWeeksCount > 0 ? `${activeWeeksCount} weeks` : undefined}
          accent={C.text}
          divider
        />
      </div>

      {/* Contact rows (only when we have any) */}
      {(profile.contactEmail || profile.contactPhone || profile.contactCompany) && (
        <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
          {profile.contactEmail && <Row label="Email" value={profile.contactEmail} valueColor={C.green} />}
          {profile.contactPhone && <Row label="Phone" value={profile.contactPhone} icon={<Phone size={12} />} />}
          {profile.contactCompany && <Row label="Company" value={profile.contactCompany} icon={<Building2 size={12} />} />}
        </div>
      )}

      {/* Weekly utilization — actual bar chart, not a grid of cells.
          Each bar's height encodes the %, with a dashed 100% reference
          line so over-allocation is visually obvious. */}
      {profile.weeks.length > 0 && (
        <div style={{ padding: "16px 18px 12px", borderTop: `1px solid ${C.border}` }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            marginBottom: 12,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: C.textMuted,
              textTransform: "uppercase", letterSpacing: 0.5,
            }}>
              Weekly utilization
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: C.textMuted, fontWeight: 600 }}>
              <LegendDot color={C.greenLight} label="Low" />
              <LegendDot color={C.green} label="Good" />
              <LegendDot color={C.orange} label="Over" />
            </div>
          </div>
          <WeeklyBarChart weeks={profile.weeks} />
        </div>
      )}

      {/* Active projects — show allocation as an inline progress bar
          so the user sees relative load across projects at a glance. */}
      {profile.projects && profile.projects.length > 0 && (
        <div style={{ padding: "14px 18px 16px", borderTop: `1px solid ${C.border}` }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: C.textMuted,
            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
          }}>
            Active projects
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {profile.projects.map((p, i) => {
              const pBarColor = p.pct > 100 ? C.orange : p.pct >= 50 ? C.green : C.greenLight;
              const pBarWidth = Math.max(2, Math.min(100, p.pct));
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px",
                  background: "var(--rm-panel-soft)",
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: p.isCurrent ? `${C.green}1F` : C.bgSoft,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flex: "0 0 auto",
                  }}>
                    <Folder size={15} color={p.isCurrent ? C.green : C.textMuted} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: C.text,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {p.projectName || p.projectId}
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, marginBottom: 6 }}>
                      {p.role} · {p.startDate} → {p.endDate}
                    </div>
                    <div style={{
                      height: 6, borderRadius: 3, background: "var(--rm-panel-border)", overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${pBarWidth}%`, height: "100%",
                        background: pBarColor,
                        borderRadius: 3,
                        transition: "width 0.3s ease",
                      }} />
                    </div>
                  </div>
                  <div style={{
                    padding: "4px 10px", borderRadius: 999,
                    background: p.pct > 100 ? `${C.orange}1A` : p.isCurrent ? `${C.green}1A` : C.bgSoft,
                    color: p.pct > 100 ? C.orange : p.isCurrent ? C.green : C.textMuted,
                    fontSize: 12, fontWeight: 700,
                    flex: "0 0 auto",
                    minWidth: 48,
                    textAlign: "center",
                  }}>{fmtPct(p.pct)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* Small KPI tile used in the PersonProfileCard summary strip. */
function KpiCell({ label, value, sub, accent, divider }: {
  label: string; value: string; sub?: string; accent: string; divider?: boolean;
}) {
  return (
    <div style={{
      padding: "12px 8px",
      textAlign: "center",
      borderLeft: divider ? `1px solid ${C.border}` : "none",
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color: C.textMuted,
        textTransform: "uppercase", letterSpacing: 0.5,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent, marginTop: 4, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2, fontWeight: 600 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* Legend dot for the bar chart key. */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

/* Bar chart for weekly utilization. Bars scale to the largest week so
   values stay readable, but a dashed reference line marks 100% so
   over-allocation pops visually. */
function WeeklyBarChart({ weeks }: { weeks: { period: string; pct: number; hours?: number }[] }) {
  const maxPct = Math.max(100, ...weeks.map((w) => w.pct));
  const chartH = 120;             // bar plotting area
  const labelH = 32;              // x-axis label area: two compact lines (month + day)
  const topPad = 16;              // headroom above the chart for value labels
  const barGap = 6;
  const axisW = 36;               // right gutter reserved EXCLUSIVELY for the
                                  // "100%" reference label — bars never render
                                  // here, so the label can't merge with a bar
                                  // or its value label.
  // Fraction (0..1) of chartH from the chart top down to the 100% line.
  // When maxPct == 100, this is 0 (line sits at the plot top); when
  // maxPct == 120, it's 0.1667 (line is 1/6 down).
  const referenceTopFrac = (maxPct - 100) / maxPct;
  const referenceTop = topPad + referenceTopFrac * chartH;
  const totalH = topPad + chartH + labelH;

  return (
    // Explicit content-box sizing so the bar columns (which match
    // chartH + labelH) sit flush at the bottom and the topPad reserves
    // a clean headroom strip for the per-bar hours labels. The "100%"
    // reference label lives in its own right-side gutter (axisW).
    <div style={{
      position: "relative",
      height: totalH,
      boxSizing: "content-box",
      display: "flex",
      alignItems: "flex-end",
      gap: barGap,
      paddingRight: axisW,
    }}>
      {/* 100% reference line — spans the plot area only; its label sits
          in the reserved right gutter where no bar can ever collide. */}
      <div style={{
        position: "absolute",
        left: 0, right: axisW,
        top: referenceTop,
        height: 0,
        borderTop: `1px dashed ${C.border}`,
        pointerEvents: "none",
        zIndex: 0,
      }} />
      <span style={{
        position: "absolute", right: 0, top: referenceTop - 6,
        width: axisW - 4, textAlign: "right",
        fontSize: 9, color: C.textMuted, fontWeight: 600,
        lineHeight: "12px", pointerEvents: "none",
      }}>
        100%
      </span>

      {weeks.map((w, i) => {
        const pct = w.pct;
        const hrs = w.hours ?? 0;
        const barH = pct === 0 ? 2 : Math.max(3, (pct / maxPct) * chartH);
        const color = pct === 0 ? "#D9DEE3"
          : pct > 100 ? C.orange
          : pct >= 70 ? C.green
          : C.greenLight;
        return (
          <div key={i} style={{
            flex: 1,
            minWidth: 0,
            height: chartH + labelH,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            position: "relative",
            zIndex: 1,
          }}>
            {/* bar */}
            <div style={{
              flex: 1,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              alignItems: "center",
            }}>
              {hrs > 0 && (
                <div style={{
                  fontSize: 10, fontWeight: 700, color,
                  marginBottom: 2, lineHeight: 1, whiteSpace: "nowrap",
                }}>
                  {hrs}h
                </div>
              )}
              <div
                title={`${w.period} — ${hrs}h (${fmtPct(pct)})`}
                style={{
                  width: "85%",
                  height: barH,
                  background: `linear-gradient(0deg, ${color}dd, ${color})`,
                  borderRadius: "4px 4px 0 0",
                  boxShadow: pct > 100 ? `0 0 0 1px ${C.orange}, 0 0 8px ${C.orange}40` : "inset 0 1px 1px rgba(255,255,255,0.2)",
                  transition: "height 0.3s ease",
                  transformOrigin: "bottom",
                  animation: "chat-bar-grow 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
                  animationDelay: `${i * 0.03}s`,
                  opacity: 0,
                }}
              />
            </div>
            {/* label — "Apr-20-26" → "Apr" / "20" two-line compact */}
            {(() => {
              const parts = w.period.split("-");
              const mon = parts[0] ?? w.period;   // "Apr"
              const day = parts[1] ?? "";          // "20"
              return (
                <div style={{
                  height: labelH,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  paddingTop: 3,
                  width: "100%",
                }}>
                  <span style={{ fontSize: 9, color: C.textMuted, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap" }}>
                    {mon}
                  </span>
                  <span style={{ fontSize: 9, color: C.textMuted, fontWeight: 500, lineHeight: 1.2, whiteSpace: "nowrap" }}>
                    {day}
                  </span>
                  <span style={{ fontSize: 9, color: pct === 0 ? C.textMuted : color, fontWeight: 700, lineHeight: 1.2, marginTop: 2 }}>
                    {fmtPct(pct)}
                  </span>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value, valueColor, icon }: { label: string; value: string; valueColor?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
      <span style={{ color: C.textMuted }}>{label}</span>
      <span style={{ color: valueColor ?? C.text, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
        {icon}{value}
      </span>
    </div>
  );
}

/* ─────────────  HEALTH GAUGE  ───────────── */
function HealthGaugeCard({ projectId, score, issues, passed }: { projectId: string; score: number; label: string; issues: HGIssue[]; passed: HGIssue[] }) {
  const [showBreakdown, setShowBreakdown] = React.useState(false);
  const prefix = String(projectId || "").split("-")[0].toUpperCase();
  const sectionTitle = prefix === "OPM" ? "Opportunity Health"
    : prefix === "LEM" ? "Lead Health"
    : "Project Health";
  const hc = healthColor(score);
  const labelText = healthLabel(score);
  const issueColors = ["#E03C3C", "#F87171", C.orange, "#F59E0B", "#FBBF24"];
  const earned = passed.reduce((s, p) => s + (p.deduction || 0), 0);
  const lost = issues.reduce((s, p) => s + (p.deduction || 0), 0);
  return (
    <div className="chat-hover-card" style={{
      margin: "10px 0", borderRadius: 12, overflow: "hidden",
      border: `1px solid ${C.border}`, background: C.bgSoft,
      boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
    }}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{sectionTitle}</span>
        <span style={{ padding: "3px 8px", borderRadius: 999, background: hc + "20", color: hc, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {labelText}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "8px 14px" }}>
        <HealthGauge score={score} size={140} />
      </div>
      <div style={{ padding: "4px 14px 8px" }}>
        {issues.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.green, fontSize: 13 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: C.green }} />
            All checks passed
          </div>
        ) : (
          issues.map((iss, idx) => {
            const c = issueColors[idx % issueColors.length];
            return (
              <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: idx === issues.length - 1 ? 0 : 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: c, marginTop: 6 }} />
                <span style={{ flex: 1, color: C.text, fontSize: 13, lineHeight: 1.4 }}>{iss.text}</span>
                {iss.deduction > 0 && (
                  <span style={{ background: c + "22", color: c, padding: "2px 7px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                    −{iss.deduction}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      {(passed.length > 0 || issues.length > 0) && (
        <div style={{ padding: "0 14px 12px" }}>
          <button
            type="button"
            onClick={() => setShowBreakdown(true)}
            style={{
              width: "100%", padding: "8px 12px", borderRadius: 8,
              border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.04)",
              color: C.text, fontSize: 12, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            View health breakdown ({passed.length + issues.length} checks)
          </button>
        </div>
      )}
      {showBreakdown && (
        <HealthBreakdownModal
          title={sectionTitle}
          score={score}
          labelText={labelText}
          hc={hc}
          passed={passed}
          issues={issues}
          earned={earned}
          lost={lost}
          onClose={() => setShowBreakdown(false)}
        />
      )}
    </div>
  );
}

function HealthBreakdownModal({
  title, score, labelText, hc, passed, issues, earned, lost, onClose,
}: {
  title: string; score: number; labelText: string; hc: string;
  passed: HGIssue[]; issues: HGIssue[]; earned: number; lost: number;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.POPUP,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 560, maxHeight: "85vh",
          background: "#0F1A24", border: `1px solid ${C.border}`,
          borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{
          padding: "14px 18px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#FFF" }}>{title} Breakdown</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
              Score {score}/100 · {labelText} · {passed.length + issues.length} checks evaluated
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent", border: "none", color: "rgba(255,255,255,0.6)",
              fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 4,
            }}
          >×</button>
        </div>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12 }}>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, background: "rgba(107,165,57,0.12)", border: "1px solid rgba(107,165,57,0.3)" }}>
            <div style={{ fontSize: 10, color: "#A9C23F", fontWeight: 700, letterSpacing: 0.5 }}>POINTS EARNED</div>
            <div style={{ fontSize: 22, color: "#A9C23F", fontWeight: 800, marginTop: 2 }}>+{earned}</div>
          </div>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, background: "rgba(232,119,34,0.12)", border: "1px solid rgba(232,119,34,0.3)" }}>
            <div style={{ fontSize: 10, color: "#F87171", fontWeight: 700, letterSpacing: 0.5 }}>POINTS LOST</div>
            <div style={{ fontSize: 22, color: "#F87171", fontWeight: 800, marginTop: 2 }}>−{lost}</div>
          </div>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, background: hc + "1A", border: `1px solid ${hc}55` }}>
            <div style={{ fontSize: 10, color: hc, fontWeight: 700, letterSpacing: 0.5 }}>FINAL SCORE</div>
            <div style={{ fontSize: 22, color: hc, fontWeight: 800, marginTop: 2 }}>{score}<span style={{ fontSize: 12, opacity: 0.7 }}>/100</span></div>
          </div>
        </div>
        <div style={{ overflow: "auto", padding: "10px 18px 18px", flex: 1 }}>
          {passed.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#A9C23F", letterSpacing: 0.5, margin: "10px 0 6px" }}>
                ✓ PASSED ({passed.length})
              </div>
              {passed.map((p, i) => (
                <div key={`p-${i}`} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 8,
                  background: "rgba(107,165,57,0.08)", marginBottom: 4,
                }}>
                  <span style={{ width: 18, height: 18, borderRadius: 9, background: "#A9C23F", color: "#0F1A24", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                  <span style={{ flex: 1, color: "#FFF", fontSize: 13 }}>{p.text}</span>
                  <span style={{ color: "#A9C23F", fontWeight: 700, fontSize: 12 }}>+{p.deduction}</span>
                </div>
              ))}
            </>
          )}
          {issues.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#F87171", letterSpacing: 0.5, margin: "14px 0 6px" }}>
                ✗ FAILED ({issues.length})
              </div>
              {issues.map((iss, i) => (
                <div key={`f-${i}`} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 8,
                  background: "rgba(248,113,113,0.08)", marginBottom: 4,
                }}>
                  <span style={{ width: 18, height: 18, borderRadius: 9, background: "#F87171", color: "#0F1A24", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>×</span>
                  <span style={{ flex: 1, color: "#FFF", fontSize: 13 }}>{iss.text}</span>
                  <span style={{ color: "#F87171", fontWeight: 700, fontSize: 12 }}>−{iss.deduction}</span>
                </div>
              ))}
            </>
          )}
          {passed.length === 0 && issues.length === 0 && (
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, padding: 20, textAlign: "center" }}>
              No check details available for this record.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────  UPDATE SUCCESS / FAIL  ───────────── */
function UpdateSuccessCard({ recordId, person }: { recordId: string; person: string }) {
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", margin: "6px 0", border: `1px solid ${C.green}40` }}>
      <div style={{ background: C.green, color: "#fff", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <CheckCircle2 size={22} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Allocation Confirmed</div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>RM ONE database updated successfully</div>
        </div>
      </div>
      <div style={{ background: C.bg, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        {person && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: C.text }}>
            <User size={13} color={C.green} />{person}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textMuted }}>
          <Folder size={13} />Project: {recordId}
        </div>
      </div>
    </div>
  );
}

function UpdateFailCard({ reason }: { reason: string }) {
  return (
    <div style={{
      margin: "6px 0", padding: "12px 14px", borderRadius: 10,
      background: "#FCEAEA", border: `1px solid ${C.red}40`,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <XCircle size={18} color={C.red} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: C.red }}>Update Failed</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{reason}</div>
      </div>
    </div>
  );
}

/* ─────────────  SELECT_PROJECT pills  ───────────── */
function SelectProjectList({ projects, onSend }: { projects: { id: string; label: string }[]; onSend: (m: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0" }}>
      {projects.map((p, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSend(`Tell me about ${p.id}`)}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", background: C.bg,
            border: `1px solid ${C.green}40`, borderRadius: 10,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <Folder size={16} color={C.green} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.id}</div>
            <div style={{ fontSize: 11, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</div>
          </div>
          <Briefcase size={13} color={C.textMuted} />
          <Mail size={1} style={{ display: "none" }} />
        </button>
      ))}
    </div>
  );
}

/* ─────────────  DECISION-SUPPORT WIDGETS  ─────────────
   Bloomberg-style "SITREP" card + "DRAFT FOR ME" 2x2 grid + DS follow-up
   strip. Designed against attached_assets/IMG_4178_*.png. The cards live
   inside the white assistant bubble like every other widget here.
*/

const DS = {
  dark:    "#253746",
  darkDeep:"#1B2B38",
  darkCard:"#2E4557",
  green:   "#6BA539",
  greenLt: "#9DC957",
  orange:  "#E87722",
  red:     "#E03C3C",
  textOn:  "#FFFFFF",
  textDim: "#A6B6C2",
  border:  "rgba(255,255,255,0.10)",
  borderG: "rgba(107,165,57,0.55)",
};

function RiskPill({ risk }: { risk: DecisionBrief["risk"] }) {
  const bg = risk === "HIGH" ? DS.red : risk === "MED" ? DS.orange : DS.green;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999,
      backgroundColor: bg, color: "#FFFFFF",
      fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
      lineHeight: 1.4,
    }}>
      {risk}
    </span>
  );
}

function WindowPill({ label }: { label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 999,
      backgroundColor: "transparent",
      border: `1px solid ${DS.border}`,
      color: DS.textOn, fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
      lineHeight: 1.4,
    }}>
      {label}
    </span>
  );
}

// Past-tense labels for the four supported chip actions. Defined as an
// explicit map so the confirmed state is deterministic — never derived
// from string concatenation.
const ACTION_CHIP_LABEL: Record<
  "Apply" | "Defer" | "Engage" | "Open",
  { idle: string; done: string }
> = {
  Apply:  { idle: "Apply",  done: "Applied"  },
  Defer:  { idle: "Defer",  done: "Deferred" },
  Engage: { idle: "Engage", done: "Engaged"  },
  Open:   { idle: "Open",   done: "Opened"   },
};

// Map the typed payload kind onto its /api/decision/* endpoint. Keeping the
// mapping centralised here means the chip logic doesn't need to know about
// route paths — only the payload shape.
const DECISION_ENDPOINT: Record<DecisionActionPayload["kind"], string> = {
  shift_allocation:   "shift-allocation",
  defer_pursuit:      "defer-pursuit",
  engage_candidates:  "engage-candidates",
  open_requisition:   "open-requisition",
};

type ChipState = "idle" | "loading" | "success" | "error";
type ChipResult = { message: string; sub?: string } | null;

function ActionChip({
  label, state, onTap,
}: { label: "Apply" | "Defer" | "Engage" | "Open"; state: ChipState; onTap: () => void }) {
  const labels = ACTION_CHIP_LABEL[label];
  const isDone = state === "success";
  const isLoading = state === "loading";
  const isError = state === "error";
  const text = isDone ? labels.done
    : isLoading ? "..."
    : isError ? "Retry"
    : labels.idle;
  const bg = isDone ? DS.green : isError ? "transparent" : "transparent";
  const fg = isDone ? "#FFFFFF" : isError ? DS.red : DS.greenLt;
  const border = isDone ? DS.green : isError ? DS.red : DS.borderG;
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={isLoading || isDone}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "4px 10px", borderRadius: 999,
        background: bg,
        border: `1px solid ${border}`,
        color: fg,
        fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
        cursor: (isLoading || isDone) ? "default" : "pointer",
        opacity: isLoading ? 0.7 : 1,
        transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
        flexShrink: 0,
      }}
    >
      {isDone && <Check size={10} color="#FFFFFF" strokeWidth={3} />}
      {text}
    </button>
  );
}

/* One row inside the SITREP card: number badge + action text + chip, with
 * an inline confirmation/error strip rendered beneath whenever a chip tap
 * has produced a real /api/decision/* response. The persisted "chip was
 * tapped" flag flows in via `initialDone` (sourced from the assistant
 * message's chipStates map) so a re-mounted row remembers prior taps;
 * `onConfirm` is fired once a tap reaches the success state so the parent
 * can persist that flag. */
function synthesizeDecisionPayload(action: DecisionAction): DecisionActionPayload {
  const text = action.text;
  switch (action.chip) {
    case "Apply": {
      // Multi-segment IDs (PRJ-2026-001) must never be clipped mid-way —
      // a truncated match routes to a non-existent record page.
      const projMatch = text.match(/\b([A-Z]{2,4}-\d+(?:-\d+)*)\b/);
      const hoursMatch = text.match(/(\d+)\s*h(?:\/wk|rs?)?/i);
      const personMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]+)?)\s+off\b/);
      return {
        kind: "shift_allocation",
        personName: personMatch?.[1] ?? "",
        projectId: projMatch?.[1] ?? "",
        hoursPerWeek: hoursMatch ? Number(hoursMatch[1]) : 8,
      };
    }
    case "Defer": {
      const daysMatch = text.match(/(\d+)\s*(?:D\b|days?)/i);
      const cleaned = text.replace(/\s*·.*$/, "").replace(/\b\d+\s*(?:D\b|days?)\b/i, "").trim();
      return { kind: "defer_pursuit", pursuitName: cleaned || text, days: daysMatch ? Number(daysMatch[1]) : 14 };
    }
    case "Engage": {
      const countMatch = text.match(/\b(\d+)\b/);
      const roleMatch = text.match(/\b((?:contract|sr\.?|senior|junior|lead|principal)?\s*(?:pms?|project managers?|engineers?|architects?|estimators?|coordinators?|analysts?|directors?))\b/i);
      const role = (roleMatch?.[1] ?? "PM").trim().replace(/s$/i, "");
      return { kind: "engage_candidates", role: role || "PM", count: countMatch ? Number(countMatch[1]) : 3 };
    }
    case "Open": {
      const daysMatch = text.match(/(\d+)\s*(?:D\b|days?)/i);
      const cleaned = text
        .replace(/^open\s+/i, "")
        .replace(/\s*·\s*close\s*\d+\s*(?:D\b|days?).*$/i, "")
        .replace(/\s*·\s*\d+\s*(?:D\b|days?).*$/i, "")
        .trim();
      return { kind: "open_requisition", title: cleaned || text, closeInDays: daysMatch ? Number(daysMatch[1]) : 45 };
    }
  }
}

function SitrepActionRow({ action, index, initialDone, onConfirm }: {
  action: DecisionAction;
  index: number;
  initialDone?: boolean;
  onConfirm?: () => void;
}) {
  const [state, setState] = React.useState<ChipState>(initialDone ? "success" : "idle");
  const [result, setResult] = React.useState<ChipResult>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // Synthesise a payload from the action text when the brief did not
  // ship one. Without this, AI-generated SITREP chips fall back to the
  // legacy visual-only confirm and never reach a picker.
  const effectivePayload = React.useRef<DecisionActionPayload>(
    action.payload ?? synthesizeDecisionPayload(action),
  ).current;

  const handlePickerResult = (r: { ok: boolean; message: string; sub?: string }) => {
    if (r.ok) {
      setState("success");
      setResult({ message: r.message, sub: r.sub });
      onConfirm?.();
    } else {
      setState("error");
      setResult({ message: r.message, sub: r.sub });
    }
  };

  const onTap = () => {
    if (state === "loading" || state === "success") return;
    setPickerOpen(true);
  };

  const isErr = state === "error";
  const stripBg = isErr ? "rgba(224,60,60,0.12)" : "rgba(107,165,57,0.12)";
  const stripColor = isErr ? DS.red : DS.greenLt;

  return (
    <div style={{
      background: DS.darkCard, borderRadius: 10,
      border: `1px solid ${DS.border}`,
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px",
      }}>
        <span style={{
          minWidth: 18, height: 18, padding: "0 5px",
          borderRadius: 5, background: "rgba(255,255,255,0.06)",
          color: DS.textDim, fontSize: 10, fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>{index + 1}</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: DS.textOn, lineHeight: 1.35 }}>
          {action.text}
        </span>
        <ActionChip label={action.chip} state={state} onTap={onTap} />
      </div>
      {(state === "success" || state === "error") && (() => {
        // Always show a result strip once a chip is in success/error so the
        // user can see what action was taken — even when the row is being
        // restored from persisted chipStates (initialDone) and we no longer
        // have the original picker result message in memory. Falls back to
        // the chip's past-tense label + the action text.
        const fallbackMsg = state === "success"
          ? `${ACTION_CHIP_LABEL[action.chip].done}.`
          : "Action failed.";
        const msg = result?.message || fallbackMsg;
        const sub = result?.sub ?? (result ? undefined : action.text);
        return (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 6,
            padding: "6px 10px 8px 10px",
            background: stripBg,
            borderTop: `1px solid ${DS.border}`,
          }}>
            {isErr
              ? <AlertTriangle size={12} color={stripColor} style={{ marginTop: 2, flexShrink: 0 }} />
              : <Check size={12} color={stripColor} strokeWidth={3} style={{ marginTop: 2, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: stripColor, lineHeight: 1.35 }}>
                {msg}
              </div>
              {sub && (
                <div style={{ fontSize: 10, color: DS.textDim, lineHeight: 1.4, marginTop: 2 }}>
                  {sub}
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {pickerOpen && effectivePayload.kind === "engage_candidates" && (
        <EngagePicker payload={effectivePayload} onClose={() => setPickerOpen(false)} onResult={handlePickerResult} />
      )}
      {pickerOpen && effectivePayload.kind === "shift_allocation" && (
        <ApplyPicker payload={effectivePayload} onClose={() => setPickerOpen(false)} onResult={handlePickerResult} />
      )}
      {pickerOpen && effectivePayload.kind === "defer_pursuit" && (
        <DeferPicker payload={effectivePayload} onClose={() => setPickerOpen(false)} onResult={handlePickerResult} />
      )}
      {pickerOpen && effectivePayload.kind === "open_requisition" && (
        <OpenReqForm payload={effectivePayload} onClose={() => setPickerOpen(false)} onResult={handlePickerResult} />
      )}
    </div>
  );
}

function SitrepCard({
  brief, chipStates, onChipConfirm,
}: {
  brief: DecisionBrief;
  /** Persisted per-action confirmation map (index → confirmed). */
  chipStates?: Record<number, boolean>;
  /** Notifies the parent when an action chip reaches confirmed state so
   *  the persisted message can be updated. When omitted (legacy callers,
   *  ad-hoc previews) the chip falls back to local React state so the
   *  visual still works. */
  onChipConfirm?: (actionIndex: number) => void;
}) {
  // Local fallback: if the parent does NOT wire up onChipConfirm we keep
  // an in-component state map so the chip still flips visually. The
  // primary chat surface always passes onChipConfirm and chipStates.
  const [localStates, setLocalStates] = React.useState<Record<number, boolean>>({});
  // Warm the picker caches as soon as a SITREP card mounts so tapping
  // a chip opens its modal with data already in hand instead of a
  // ~second-long "Loading bench…" spinner. Cheap & idempotent — the
  // helper dedupes via in-flight promise + 60s TTL cache.
  React.useEffect(() => { prefetchPickerData(); }, []);
  const conf = Math.max(0, Math.min(100, brief.confidence));
  return (
    <div className="chat-hover-card" style={{
      background: `linear-gradient(180deg, ${DS.darkDeep} 0%, ${DS.dark} 100%)`,
      border: `1px solid ${DS.border}`, borderRadius: 12,
      padding: 16, color: DS.textOn,
      boxShadow: "0 6px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 24, height: 24, borderRadius: 6,
          background: "rgba(107,165,57,0.18)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <Zap size={14} color={DS.greenLt} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: DS.textDim }}>SITREP</span>
        <div style={{ flex: 1 }} />
        <RiskPill risk={brief.risk} />
        <WindowPill label={brief.window} />
      </div>

      {/* Headline + sub */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>{brief.headline}</div>
        <div style={{ marginTop: 4, fontSize: 12, color: DS.textDim, lineHeight: 1.45 }}>{brief.subline}</div>
      </div>

      {/* Hairline divider before the actions block */}
      <div style={{
        marginTop: 12, marginBottom: 8,
        height: 1, background: DS.border,
      }} />

      {/* Section header: "RECOMMENDED ACTIONS" / "RANKED · N" */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 8,
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.0, color: DS.textDim }}>
          RECOMMENDED ACTIONS
        </span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: DS.greenLt }}>
          RANKED · {brief.actions.length}
        </span>
      </div>

      {/* Ranked actions — each row owns its own loading / success / error
          state and dispatches to /api/decision/* on tap. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {brief.actions.map((a, i) => (
          <SitrepActionRow
            key={i}
            action={a}
            index={i}
            initialDone={(chipStates ?? localStates)[i] === true}
            onConfirm={() => {
              if (onChipConfirm) onChipConfirm(i);
              else setLocalStates((s) => ({ ...s, [i]: true }));
            }}
          />
        ))}
      </div>

      {/* Confidence bar */}
      <div style={{ marginTop: 12 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
          color: DS.textDim, marginBottom: 4,
        }}>
          <span>CONFIDENCE</span>
          <span style={{ color: DS.greenLt }}>{conf}%</span>
        </div>
        <div style={{
          height: 4, borderRadius: 999, background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}>
          <div style={{
            width: `${conf}%`, height: "100%",
            background: `linear-gradient(90deg, ${DS.green}, ${DS.greenLt})`,
          }} />
        </div>
      </div>
    </div>
  );
}

function DraftCardIcon({ icon, size = 16 }: { icon: "file" | "users" | "briefcase" | "mail"; size?: number }) {
  if (icon === "users")     return <UsersIcon size={size} color={DS.greenLt} />;
  if (icon === "briefcase") return <Briefcase size={size} color={DS.greenLt} />;
  if (icon === "mail")      return <Mail size={size} color={DS.greenLt} />;
  return <FileText size={size} color={DS.greenLt} />;
}

function draftAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return { "Content-Type": "application/json" };
  const token = window.localStorage.getItem("rmone_token");
  const username = window.localStorage.getItem("rmone_username") ?? "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(username ? { "X-Username": username } : {}),
  };
}

function DraftForMePanel({ panel, onSend }: { panel: DraftPanel; onSend: (msg: string) => void }) {
  // Outputs = number of draft cards + 1 forecast row. Computed so the header
  // count always stays in sync with the actual layout.
  const outputsCount = panel.cards.length + 1;
  // Inline ack result for the "Accept" button — persists a real audit row
  // before handing the prompt to AI Chat. Mirrors the SITREP chip-row shape.
  const [acceptResult, setAcceptResult] = useState<
    { ok: boolean; message: string; detail?: string } | null
  >(null);
  const [acceptBusy, setAcceptBusy] = useState(false);

  async function acceptDraft() {
    if (acceptBusy) return;
    setAcceptBusy(true);
    setAcceptResult(null);
    try {
      const r = await fetch("/api/decision/accept-draft", {
        method: "POST",
        headers: draftAuthHeaders(),
        body: JSON.stringify({
          refId: `followup:${panel.followupAccept}:${panel.forecastTitle}`.slice(0, 256),
          label: panel.followupText,
          title: panel.followupText,
          prompt: panel.followupPrompt,
          payload: { cards: panel.cards.map((c) => c.title), forecast: panel.forecastTitle },
        }),
      });
      const json = (await r.json().catch(() => ({}))) as {
        ok?: boolean; message?: string; detail?: string;
      };
      const ok = !!json.ok && r.ok;
      setAcceptResult({
        ok,
        message: json.message ?? (ok ? "Draft queued" : "Could not queue draft"),
        detail: json.detail,
      });
      // Always hand the prompt to AI Chat so the user gets the draft regardless
      // of whether the audit row succeeded — failure to log is non-blocking.
      onSend(panel.followupPrompt);
    } catch (e) {
      setAcceptResult({
        ok: false,
        message: "Network error — draft not logged",
        detail: e instanceof Error ? e.message : String(e),
      });
      onSend(panel.followupPrompt);
    } finally {
      setAcceptBusy(false);
    }
  }
  return (
    <div className="chat-hover-card" style={{
      background: DS.dark, border: `1px solid ${DS.border}`,
      borderRadius: 12, padding: 16, color: DS.textOn,
      boxShadow: "0 6px 20px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.05)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10,
      }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: DS.textDim }}>DRAFT FOR ME</span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: DS.greenLt }}>
          {outputsCount} OUTPUTS
        </span>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))",
        gap: 8,
      }}>
        {panel.cards.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSend(c.prompt)}
            style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: "10px 12px", textAlign: "left",
              background: DS.darkCard, color: DS.textOn,
              border: `1px solid ${DS.border}`, borderRadius: 10,
              cursor: "pointer",
              transition: "transform 80ms ease, border-color 120ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = DS.borderG; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = DS.border; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "rgba(107,165,57,0.16)",
              display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <DraftCardIcon icon={c.icon} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{c.title}</div>
              <div style={{ fontSize: 10, color: DS.textDim, lineHeight: 1.4, marginTop: 2 }}>{c.sub}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Forecast brief row */}
      <button
        type="button"
        onClick={() => onSend("Show me the 45-day forecast brief.")}
        style={{
          marginTop: 8, width: "100%",
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", textAlign: "left",
          background: DS.darkCard, color: DS.textOn,
          border: `1px solid ${DS.border}`, borderRadius: 10,
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = DS.borderG; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = DS.border; }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: "rgba(107,165,57,0.16)",
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <BarChart3 size={16} color={DS.greenLt} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{panel.forecastTitle}</div>
          <div style={{ fontSize: 10, color: DS.textDim, lineHeight: 1.4, marginTop: 2 }}>{panel.forecastSub}</div>
        </div>
        <span style={{ fontSize: 10, color: DS.greenLt, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 2 }}>
          More <ChevronRight size={12} color={DS.greenLt} />
        </span>
      </button>

      {/* DS follow-up strip */}
      <div style={{
        marginTop: 10,
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px", borderRadius: 10,
        background: "rgba(107,165,57,0.08)",
        border: `1px solid ${DS.borderG}`,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 1, color: DS.greenLt,
          padding: "2px 6px", borderRadius: 4,
          background: "rgba(107,165,57,0.18)",
        }}>DS</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: DS.textOn }}>{panel.followupText}</span>
        <button
          type="button"
          onClick={acceptDraft}
          disabled={acceptBusy}
          style={{
            padding: "4px 10px", borderRadius: 999,
            background: DS.green, color: "#FFFFFF",
            border: "none", cursor: acceptBusy ? "not-allowed" : "pointer",
            fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
            opacity: acceptBusy ? 0.6 : 1,
          }}
        >
          {acceptBusy ? "Queueing…" : panel.followupAccept}
        </button>
        <span style={{ fontSize: 11, color: DS.textDim }}>· or pick above</span>
      </div>

      {acceptResult && (
        <div
          style={{
            marginTop: 8,
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 11,
            background: acceptResult.ok ? "rgba(107,165,57,0.18)" : "rgba(232,119,34,0.20)",
            border: `1px solid ${acceptResult.ok ? "rgba(107,165,57,0.55)" : "rgba(232,119,34,0.55)"}`,
            color: DS.textOn,
          }}
          data-testid="draft-accept-result"
        >
          <span style={{ fontWeight: 800, marginRight: 6 }}>{acceptResult.ok ? "✓" : "!"}</span>
          <span style={{ fontWeight: 700 }}>{acceptResult.message}</span>
          {acceptResult.detail && (
            <span style={{ opacity: 0.85, marginLeft: 6 }}>· {acceptResult.detail}</span>
          )}
        </div>
      )}
    </div>
  );
}
