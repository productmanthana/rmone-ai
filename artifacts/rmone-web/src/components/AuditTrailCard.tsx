import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Activity, AlertTriangle, Bot, ChevronDown, ChevronUp, HelpCircle, Mail, RefreshCw, Search, ShieldAlert, ShieldCheck, ShieldX, type LucideIcon } from "lucide-react";
import { getAuditHealth, getAuditTrail, getProjectTeam, searchPeople, sendAuditEmail, type AuditAccountStatus, type AuditHealth, type AuditOutcome, type AuditTrailItem } from "@/lib/api";
import { auditSeedKey, patchAuditSeedHealth, readAuditSeed, writeAuditSeed } from "@/lib/auditTrailCache";
import { subscribeDataChanged } from "@/lib/dataSync";
import { EditDraftModal, type EditDraftValue } from "@/components/chat/EditDraftModal";

interface AuditTrailCardProps {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  actorEmail?: string;
  subjectId?: string;
  subjectEmail?: string;
  title?: string;
  defaultOpen?: boolean;
  /** Initial filter only; the regular activity selector remains available. */
  defaultActivity?: "" | "interaction" | "data";
  /** Person-level views can be limited to actual project/opportunity/lead rows. */
  recordsOnly?: boolean;
  /** Use when the card is embedded inside a modal that already has a title. */
  hideHeader?: boolean;
  /** Removes the page-level outer margin when the card is placed in a grid. */
  compact?: boolean;
  /** Lets a parent expand its grid placement with the card. */
  onOpenChange?: (open: boolean) => void;
  /** Renders only the compact header; the parent owns the expanded surface. */
  triggerOnly?: boolean;
  /** Ref for the header button when a parent draws a connector to this card. */
  triggerRef?: (node: HTMLButtonElement | null) => void;
}

type ActivityFilter = "" | "interaction" | "data";

const OUTCOME: Record<AuditOutcome, { label: string; color: string; bg: string }> = {
  success: { label: "Succeeded", color: "#087F5B", bg: "rgba(8,127,91,.10)" },
  failed: { label: "Failed", color: "#C92A2A", bg: "rgba(201,42,42,.10)" },
  denied: { label: "Denied", color: "#C92A2A", bg: "rgba(201,42,42,.10)" },
  partial: { label: "Partly completed", color: "#B26A00", bg: "rgba(178,106,0,.10)" },
  cancelled: { label: "Cancelled", color: "#5F6875", bg: "rgba(95,104,117,.10)" },
};

const ACCOUNT: Record<AuditAccountStatus, { label: string; color: string; bg: string; Icon: LucideIcon; hint: string }> = {
  secured: { label: "Secured", color: "#087F5B", bg: "rgba(8,127,91,.10)", Icon: ShieldCheck, hint: "Active account with a password-protected sign-in" },
  invite_pending: { label: "Invite pending", color: "#B26A00", bg: "rgba(178,106,0,.10)", Icon: ShieldAlert, hint: "Account exists but the person has not set a password yet" },
  deactivated: { label: "Deactivated", color: "#B26A00", bg: "rgba(178,106,0,.10)", Icon: ShieldX, hint: "Sign-in is currently disabled for this account" },
  removed: { label: "Removed", color: "#5F6875", bg: "rgba(95,104,117,.10)", Icon: ShieldX, hint: "This person is no longer in the user roster" },
  system: { label: "RM ONE auto", color: "#0B7285", bg: "rgba(11,114,133,.10)", Icon: Bot, hint: "Automated action by RM ONE (imports, background jobs, AI)" },
  unknown: { label: "Unknown", color: "#5F6875", bg: "rgba(95,104,117,.10)", Icon: HelpCircle, hint: "No account identity was recorded for this event" },
};

const AUDIT_LOADING_STEPS = [
  "Securely checking your recent activity",
  "Verifying who changed what",
  "Resolving readable record details",
];

function words(action: string): string {
  return action.replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function actorLabel(item: AuditTrailItem): string {
  return item.actorName || item.actorEmail || (item.actorType !== "user" ? "RM ONE" : "Unknown user");
}

/** Plain-language verb for the Action column, e.g. "Edited project". */
function actionLabel(action: string): string {
  const interaction: Record<string, string> = {
    "interaction.view": "Viewed item",
    "interaction.open": "Opened control",
    "interaction.close": "Closed control",
    "interaction.navigate": "Navigated to page",
    "interaction.filter": "Changed filter",
    "interaction.search": "Used search",
    "interaction.export": "Exported data",
  };
  if (interaction[action]) return interaction[action];
  if (action === "status.changed") return "Status changed";
  const [verb = "", ...rest] = action.split(".");
  const entityWord = rest.join(" ").replace(/[-_]+/g, " ");
  if (entityWord === "allocation") {
    if (verb === "update") return "Changed allocation";
    if (verb === "create" || verb === "assign") return "Added allocation";
    if (verb === "delete") return "Removed allocation";
  }
  const verbWord: Record<string, string> = {
    view: "Viewed", update: "Edited", create: "Added", delete: "Deleted",
    restore: "Restored", assign: "Assigned", import: "Imported", export: "Exported",
    login: "Signed in", logout: "Signed out",
  };
  const mapped = verbWord[verb];
  if (!mapped) return words(action);
  return entityWord ? `${mapped} ${entityWord}` : mapped;
}

function isInteraction(item: AuditTrailItem): boolean {
  return item.action.startsWith("interaction.") || item.action.startsWith("view.");
}

function interactionDetails(action: string): string | null {
  const details: Record<string, string> = {
    "interaction.view": "Viewed this item — no data was changed",
    "interaction.open": "Opened a control or section — no data was changed",
    "interaction.close": "Closed a control or section — no data was changed",
    "interaction.navigate": "Navigated to this page — no data was changed",
    "interaction.filter": "Changed a filter or selection — no data was changed",
    "interaction.search": "Used search — search terms are not recorded",
    "interaction.export": "Started an export — no data was changed",
  };
  return details[action] ?? null;
}

interface ChangeLine { field: string; before: string | null; after: string | null }

function asDisplay(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value);
  return text === "[redacted]" ? "Hidden for privacy" : text;
}

/** Notes imported from the legacy list can be stored as a SharePoint-style
 * envelope: GUID;#UTC:<internal timestamp>;#<human note>;#True. The audit
 * row already has its own CreatedAt column, so exposing that storage envelope
 * makes the Details column look like it contains a second event timestamp. */
function auditValue(field: string, value: unknown): string | null {
  const text = asDisplay(value);
  if (text == null || !/(note|comment|description)/i.test(field)) return text;
  const parts = text.split(";#");
  const looksLikeGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[0] ?? "");
  // The second segment must be a REAL timestamp ("UTC:2026-08-27T10:15:00Z" or an
  // epoch number), not merely any text after "UTC:" — otherwise a legitimate note
  // that happens to resemble the envelope would get content stripped from it.
  const stamp = /^UTC:/i.test(parts[1] ?? "") ? parts[1]!.slice(4).trim() : null;
  const hasInternalTimestamp =
    stamp != null && /^\d/.test(stamp) && (/^\d+$/.test(stamp) || Number.isFinite(Date.parse(stamp)));
  const hasEnvelopeFlag = /^(true|false)$/i.test(parts.at(-1) ?? "");
  if (parts.length >= 4 && looksLikeGuid && hasInternalTimestamp && hasEnvelopeFlag) {
    return parts.slice(2, -1).join(";#").trim() || null;
  }
  return text;
}

/** Normalize the stored changes payload into "field: before → after" lines.
 *  Ledger-backed events carry OldValue/NewValue; generic request events only
 *  know the value that was submitted (rendered as "set to …"). */
function changeLines(changes: unknown): ChangeLine[] {
  if (!changes) return [];
  if (Array.isArray(changes)) {
    return changes.map((entry) => {
      if (!entry || typeof entry !== "object") return { field: String(entry), before: null, after: null };
      const row = entry as Record<string, unknown>;
      const field = String(row.FieldName ?? row.fieldName ?? row.name ?? row.field ?? "Field");
      const before = auditValue(field, row.OldValue ?? row.oldValue ?? row.before ?? row.previous);
      const after = auditValue(field, row.NewValue ?? row.newValue ?? row.after ?? row.Value ?? row.value);
      return { field: words(field), before, after };
    });
  }
  if (typeof changes === "object") {
    return Object.entries(changes as Record<string, unknown>)
      .filter(([, value]) => value != null && typeof value !== "object")
      .map(([key, value]) => ({ field: words(key), before: null, after: auditValue(key, value) }));
  }
  return [{ field: String(changes), before: null, after: null }];
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric", month: "short", day: "2-digit",
  hour: "numeric", minute: "2-digit", second: "2-digit",
  timeZoneName: "short",
});

const HEADER_CELL: CSSProperties = {
  position: "sticky", top: 0, zIndex: 1, background: "var(--rm-bg)",
  textAlign: "left", padding: "9px 10px", borderBottom: "1px solid var(--rm-panel-border)",
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
  color: "var(--rm-text-muted)", whiteSpace: "nowrap",
};

const CELL: CSSProperties = {
  padding: "10px", borderBottom: "1px solid var(--rm-panel-border)",
  verticalAlign: "top", fontSize: 12, color: "var(--rm-text)",
};

/** Render guard for pathological events (e.g. bulk imports with hundreds of
 *  field changes). Anything beyond this is DISCLOSED with an explicit count,
 *  never silently dropped. */
const MAX_INLINE_CHANGES = 200;

function auditDetailsForEmail(item: AuditTrailItem): string[] {
  const lines = changeLines(item.changes);
  if (lines.length > 0) {
    return lines.slice(0, MAX_INLINE_CHANGES).map((line) =>
      line.before != null
        ? `${line.field}: ${line.before} → ${line.after ?? "—"}`
        : line.after != null
          ? `${line.field}: set to ${line.after}`
          : `${line.field}: changed`,
    );
  }
  if (item.failureReason) return [item.failureReason];
  const interaction = interactionDetails(item.action);
  if (interaction) return [interaction];
  if (item.action.startsWith("login") || item.action.startsWith("logout")) return ["—"];
  return item.outcome === "success"
    ? ["Saved successfully — no values changed"]
    : ["No change details were recorded for this event"];
}

function auditRowsForEmail(rows: AuditTrailItem[], cardTitle: string): { subject: string; body: string; recipient: string } {
  const uniqueRecipients = [...new Set(
    rows.map((item) => item.actorEmail?.trim().toLowerCase()).filter((email): email is string => Boolean(email)),
  )];
  const affected = [...new Set(rows.map((item) => item.entityName || item.entityId).filter(Boolean))];
  const scope = affected.length === 1 ? String(affected[0]) : cardTitle;
  const grouped = rows.length > 1;
  const sections = rows.map((item, index) => {
    const account = ACCOUNT[item.accountStatus] ?? ACCOUNT.unknown;
    const tone = OUTCOME[item.outcome] ?? OUTCOME.failed;
    const affectedLabel = item.entityName || item.entityId || "Tenant-wide";
    return [
      `${grouped ? `${index + 1}. ` : ""}${actionLabel(item.action)} — ${tone.label}`,
      `Who: ${actorLabel(item)}${item.actorRole ? ` · ${item.actorRole}` : ""}`,
      `When: ${DATE_TIME_FORMAT.format(new Date(item.createdAt))}`,
      `Affected: ${affectedLabel}${item.entityName && item.entityId ? ` · ${item.entityId}` : ""}`,
      `Account: ${account.label}`,
      item.source ? `Source: ${item.source}` : null,
      "Details:",
      ...auditDetailsForEmail(item).map((line) => `- ${line}`),
    ].filter((line): line is string => Boolean(line));
  });
  return {
    subject: grouped ? `Audit history — ${scope}` : `Audit change — ${scope}`,
    body: [
      grouped ? `Audit history for ${scope}` : `Audit change for ${scope}`,
      `Prepared from ${cardTitle} in RM ONE.`,
      "",
      ...sections.flatMap((section, index) => index === 0 ? section : ["", ...section]),
      "",
      "This message contains the audit details available to the current viewer.",
    ].join("\n"),
    recipient: uniqueRecipients.join(", "),
  };
}

export function AuditTrailCard({
  entityType, entityId, actorId, actorEmail, subjectId, subjectEmail, title = "Audit Trail", defaultOpen = false,
  defaultActivity = "", recordsOnly = false, hideHeader = false, compact = false, onOpenChange,
  triggerOnly = false, triggerRef,
}: AuditTrailCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [rows, setRows] = useState<AuditTrailItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<AuditOutcome | "">("");
  const [source, setSource] = useState("");
  const [activity, setActivity] = useState<ActivityFilter>(defaultActivity);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [health, setHealth] = useState<AuditHealth | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [emailDraft, setEmailDraft] = useState<EditDraftValue | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailNotice, setEmailNotice] = useState("");
  const seq = useRef(0);
  const auditTopScrollRef = useRef<HTMLDivElement | null>(null);
  const auditTableScrollRef = useRef<HTMLDivElement | null>(null);
  const auditScrollSyncing = useRef(false);
  // True from the moment a "Load earlier" request STARTS until the next
  // successful top-page load — live refresh must never clobber paged history,
  // including while the page request is still in flight.
  const paging = useRef(false);
  const liveTimers = useRef<number[]>([]);
  const lastBusSchedule = useRef(0);
  const subjectMode = Boolean(subjectId || subjectEmail);
  const scopedActorId = subjectMode ? undefined : actorId;
  const scopedActorEmail = subjectMode ? undefined : actorEmail;

  const cancelLiveRefreshes = () => {
    for (const timer of liveTimers.current) clearTimeout(timer);
    liveTimers.current = [];
  };

  // Debounce typed search so each keystroke doesn't fire a full remote query.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const key = useMemo(
    () => [entityType, entityId, scopedActorId, scopedActorEmail, subjectId, subjectEmail, outcome, source, activity, search, start, end].join("|"),
    [entityType, entityId, scopedActorId, scopedActorEmail, subjectId, subjectEmail, outcome, source, activity, search, start, end],
  );
  const seedKey = useMemo(() => auditSeedKey(key), [key]);

  useEffect(() => {
    if (!loading || rows.length > 0) {
      setLoadingStep(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingStep((step) => (step + 1) % AUDIT_LOADING_STEPS.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [loading, rows.length]);

  const load = async (opts?: { before?: string; silent?: boolean }) => {
    const before = opts?.before;
    const silent = opts?.silent === true;
    const mySeq = ++seq.current;
    if (before) {
      paging.current = true;
      cancelLiveRefreshes();
      setLoadingMore(true);
    } else if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await getAuditTrail({
        entityType, entityId, actorId: scopedActorId, actorEmail: scopedActorEmail, subjectId, subjectEmail,
        outcome: outcome || undefined,
        source: source || undefined,
        eventKind: activity === "data" ? "change" : activity || undefined,
        search: search || undefined,
        start: start || undefined,
        end: end || undefined,
        before,
        limit: 40,
      });
      if (seq.current !== mySeq) return; // superseded by a newer request
      if (!before) paging.current = false; // top page reloaded — history reset
      setRows((current) => before ? [...current, ...result.rows] : result.rows);
      setCursor(result.nextCursor);
      setError("");
      if (!before) {
        writeAuditSeed(seedKey, {
          rows: result.rows,
          cursor: result.nextCursor,
          health: readAuditSeed(seedKey)?.health ?? null,
          at: Date.now(),
        });
        // Health banner is informative, never worth holding the table for:
        // fetch it off the critical path.
        void getAuditHealth()
          .then((value) => {
            if (seq.current !== mySeq) return;
            setHealth(value);
            patchAuditSeedHealth(seedKey, value);
          })
          .catch(() => { if (seq.current === mySeq) setHealth(null); });
      }
    } catch {
      if (seq.current !== mySeq) return;
      // Keep showing the rows we already have; the inline stale note below
      // discloses that the refresh failed.
      setError("The audit trail could not be refreshed. Please try again.");
    } finally {
      if (seq.current === mySeq) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    setExpanded(null);
    paging.current = false;
    const seeded = readAuditSeed(seedKey);
    if (seeded) {
      // Paint the last loaded page instantly, then refresh it in the background.
      setRows(seeded.rows);
      setCursor(seeded.cursor);
      setHealth(seeded.health);
      setError("");
      if (open) void load({ silent: true });
    } else {
      setRows([]);
      setCursor(null);
      setError("");
      if (open) void load();
    }
    // key/seedKey intentionally represent all scope inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seedKey]);

  const visibleRows = useMemo(
    // Defense in depth for session seeds created before the server stopped
    // returning inferred record-view rows. Person-level Quick Actions uses
    // recordsOnly so generic page/control events can never masquerade as a
    // project change with "Tenant-wide" in the Affected column.
    () => rows.filter((item) =>
      !item.action.startsWith("view.")
      && (!recordsOnly || (
        Boolean(item.entityId)
        && ["project", "opportunity", "lead", "pmm", "opm", "lem", "record"]
          .includes(String(item.entityType ?? "").trim().toLowerCase())
      ))
      && (activity === "" || (activity === "interaction" ? isInteraction(item) : !isInteraction(item))),
    ),
    [activity, recordsOnly, rows],
  );

  useEffect(() => {
    setSelectedIds(new Set());
  }, [seedKey]);

  const completeRowsForEmail = async (): Promise<AuditTrailItem[]> => {
    const all: AuditTrailItem[] = [];
    let before: string | undefined;
    let previousCursor = "";
    for (let page = 0; page < 100; page += 1) {
      const result = await getAuditTrail({
        entityType, entityId, actorId: scopedActorId, actorEmail: scopedActorEmail, subjectId, subjectEmail,
        outcome: outcome || undefined,
        source: source || undefined,
        eventKind: activity === "data" ? "change" : activity || undefined,
        search: search || undefined,
        start: start || undefined,
        end: end || undefined,
        before,
        limit: 100,
      });
      all.push(...result.rows);
      const next = result.nextCursor ?? "";
      if (!next || next === previousCursor) break;
      previousCursor = next;
      before = next;
    }
    return all.filter((item) =>
      !item.action.startsWith("view.")
      && (!recordsOnly || (
        Boolean(item.entityId)
        && ["project", "opportunity", "lead", "pmm", "opm", "lem", "record"]
          .includes(String(item.entityType ?? "").trim().toLowerCase())
      ))
      && (activity === "" || (activity === "interaction" ? isInteraction(item) : !isInteraction(item))),
    );
  };

  // "Add project team" quick action in the email popup — only for record
  // types that actually have a team (PMM projects / OPM opportunities). Team
  // rows carry no emails, so members are resolved against the org directory:
  // GUID-first (duplicate names are real), name match only as a fallback and
  // only when that name is unambiguous in the directory.
  const teamRecordId = ["project", "opportunity"].includes(String(entityType ?? "").trim().toLowerCase()) && entityId
    ? entityId
    : null;
  const emailQuickAdd = useMemo(() => {
    if (!teamRecordId) return undefined;
    return {
      label: "Add project team",
      emptyMessage: "No team members with email addresses were found for this record.",
      load: async () => {
        const [{ team }, directory] = await Promise.all([
          getProjectTeam(teamRecordId),
          searchPeople("", 1000),
        ]);
        const byGuid = new Map<string, string>();
        const byName = new Map<string, string | null>(); // null = ambiguous name, never used
        for (const person of directory) {
          if (person.guid) byGuid.set(person.guid.trim().toLowerCase(), person.email);
          const nameKey = person.name.trim().toLowerCase();
          if (!nameKey) continue;
          const prev = byName.get(nameKey);
          byName.set(nameKey, prev === undefined || prev === person.email ? person.email : null);
        }
        const emails: string[] = [];
        for (const member of team) {
          const viaGuid = member.resourceId ? byGuid.get(member.resourceId.trim().toLowerCase()) : undefined;
          const email = viaGuid ?? byName.get(member.name?.trim().toLowerCase() ?? "") ?? undefined;
          if (email) emails.push(email);
        }
        return emails;
      },
    };
  }, [teamRecordId]);

  const openEmailDraft = (items: AuditTrailItem[]) => {
    if (items.length === 0) return;
    const prepared = auditRowsForEmail(items, title);
    setEmailNotice("");
    setEmailDraft({ ...prepared, rawText: prepared.body });
  };

  const handleEmailHistory = async (selectedOnly: boolean) => {
    setEmailNotice("");
    try {
      let emailRows: AuditTrailItem[];
      if (selectedOnly) {
        const selected = new Set(selectedIds);
        emailRows = visibleRows.filter((item) => selected.has(item.id));
      } else {
        emailRows = await completeRowsForEmail();
      }
      if (emailRows.length === 0) {
        setEmailNotice(selectedOnly ? "Select at least one audit entry first." : "There is no audit history to email.");
        return;
      }
      openEmailDraft(emailRows);
    } catch {
      setEmailNotice("The complete audit history could not be loaded for email.");
    }
  };

  const handleEmailConfirm = async (next: { subject: string; body: string; recipient: string }) => {
    if (emailSending) return;
    setEmailSending(true);
    setEmailNotice("");
    try {
      const result = await sendAuditEmail({
        to: next.recipient.split(/[,;]\s*/).map((email) => email.trim()).filter(Boolean),
        subject: next.subject,
        body: next.body,
      });
      if (!result.ok) throw new Error(result.message || "The email could not be sent");
      setEmailDraft(null);
      setEmailNotice("Audit email sent successfully.");
    } catch (error) {
      setEmailNotice(error instanceof Error ? error.message : "The audit email could not be sent.");
    } finally {
      setEmailSending(false);
    }
  };

  // Live updates: any successful write in this tab (or a sibling tab)
  // publishes on the data-sync bus. Audit events are stored asynchronously
  // just after the write finishes, so refresh twice on a short delay — the
  // second pass catches slower storage. Skipped while paged into history so
  // "Load earlier" results are never clobbered.
  useEffect(() => {
    if (!open) return;
    // Pending refreshes were cancelled with the previous subscription, so the
    // burst-suppression window must not carry over — it would swallow the
    // only refresh for a write that lands right after a filter change.
    lastBusSchedule.current = 0;
    const fireLiveRefresh = () => {
      // Re-checked at FIRE time: the user may have paged into history after
      // this refresh was scheduled.
      if (!paging.current) void load({ silent: true });
    };
    const unsubscribe = subscribeDataChanged("any", () => {
      if (paging.current) return;
      const now = Date.now();
      if (now - lastBusSchedule.current < 1000) return; // one pair per burst
      lastBusSchedule.current = now;
      liveTimers.current.push(window.setTimeout(fireLiveRefresh, 1200));
      liveTimers.current.push(window.setTimeout(fireLiveRefresh, 3600));
    });
    return () => {
      unsubscribe();
      cancelLiveRefreshes();
    };
    // load closes over the current filters; resubscribed when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seedKey]);

  return (
    <>
      <section style={{ margin: compact || hideHeader ? 0 : "16px", border: hideHeader ? 0 : "1px solid var(--rm-panel-border)", borderRadius: hideHeader ? 0 : 16, background: hideHeader ? "transparent" : "var(--rm-panel)", overflow: hideHeader ? "visible" : "hidden" }}>
      {!hideHeader && (
        <button
          type="button"
          ref={triggerRef}
          onClick={() => {
            if (triggerOnly) {
              onOpenChange?.(true);
              return;
            }
            const next = !open;
            setOpen(next);
            onOpenChange?.(next);
          }}
          aria-expanded={triggerOnly ? false : open}
          aria-haspopup={triggerOnly ? "dialog" : undefined}
          data-testid="audit-trail-toggle"
          style={{ width: "100%", padding: "16px 18px", display: "flex", alignItems: "center", gap: 12, border: 0, background: "transparent", color: "var(--rm-text)", cursor: "pointer", textAlign: "left" }}
        >
          <Activity size={20} color="var(--rm-green)" />
          <span style={{ flex: 1 }}>
            <strong style={{ display: "block", fontSize: 15 }}>{title}</strong>
            <span style={{ display: "block", marginTop: 3, fontSize: 12, color: "var(--rm-text-muted)" }}>
              {subjectMode ? "Activity by and about this person—who did what, when, and whether it worked" : "Who did what, when, and whether it worked"}
            </span>
          </span>
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      )}
      {open && (
        <div style={{ borderTop: hideHeader ? 0 : "1px solid var(--rm-panel-border)", padding: hideHeader ? "8px 18px 18px" : "4px 18px 18px" }}>
          {health && health.writeFailures > 0 && (
            <div role="alert" style={{ marginTop: 12, padding: "10px 12px", borderRadius: 9, background: "rgba(178,106,0,.10)", color: "#B26A00", fontSize: 12 }}>
              <strong>Audit storage needs attention.</strong> {health.writeFailures} event{health.writeFailures === 1 ? "" : "s"} could not be saved
              {health.lastWriteFailureAt ? ` as of ${new Date(health.lastWriteFailureAt).toLocaleString()}` : ""}. Business changes may still have completed.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(150px,2fr) repeat(3,minmax(110px,1fr)) repeat(2,minmax(120px,1fr)) 38px", gap: 8, padding: "14px 0 8px", alignItems: "center", justifyContent: "center" }}>
            <label style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 9, top: 10, color: "var(--rm-text-faint)" }} />
              <input aria-label="Search audit trail" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Actor, record, action…" style={{ width: "100%", minHeight: 34, padding: "6px 8px 6px 29px", borderRadius: 8, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", color: "var(--rm-text)" }} />
            </label>
            <select aria-label="Filter audit outcome" value={outcome} onChange={(event) => setOutcome(event.target.value as AuditOutcome | "")} style={{ minHeight: 34, borderRadius: 8, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", color: "var(--rm-text)" }}>
              <option value="">All outcomes</option>
              {Object.entries(OUTCOME).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </select>
            <select aria-label="Filter audit source" value={source} onChange={(event) => setSource(event.target.value)} style={{ minHeight: 34, borderRadius: 8, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", color: "var(--rm-text)" }}>
              <option value="">All sources</option>
              <option value="web">Web</option>
              <option value="chat/ai">Chat / AI</option>
              <option value="import">Import</option>
              <option value="api">API</option>
            </select>
            <select aria-label="Filter audit activity type" value={activity} onChange={(event) => setActivity(event.target.value as ActivityFilter)} style={{ minHeight: 34, borderRadius: 8, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", color: "var(--rm-text)" }}>
              <option value="">All activity</option>
              <option value="interaction">Interactions</option>
              <option value="data">Data changes</option>
            </select>
          <input aria-label="Audit start date" type="date" value={start} onChange={(event) => setStart(event.target.value)} style={{ minHeight: 34, width: "100%", borderRadius: 8, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", color: "var(--rm-text)", textAlign: "center" }} />
          <input aria-label="Audit end date" type="date" value={end} onChange={(event) => setEnd(event.target.value)} style={{ minHeight: 34, width: "100%", borderRadius: 8, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", color: "var(--rm-text)", textAlign: "center" }} />
          <button type="button" aria-label="Refresh audit trail" onClick={() => void load({ silent: rows.length > 0 })} disabled={loading || refreshing} style={{ minWidth: 38, minHeight: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", color: "var(--rm-text)", cursor: "pointer" }}><RefreshCw size={15} className={loading || refreshing ? "animate-spin" : ""} /></button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingBottom: 10 }}>
            <span style={{ flex: 1, minWidth: 180, fontSize: 11.5, color: "var(--rm-text-muted)" }}>
              {selectedIds.size > 0
                ? `${selectedIds.size} audit entr${selectedIds.size === 1 ? "y" : "ies"} selected`
                : "Email one entry, selected entries, or all matching history"}
            </span>
            <button
              type="button"
              onClick={() => void handleEmailHistory(true)}
              disabled={selectedIds.size === 0 || emailSending}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", color: "var(--rm-text)", cursor: selectedIds.size === 0 ? "not-allowed" : "pointer", opacity: selectedIds.size === 0 ? 0.5 : 1, fontSize: 11.5, fontWeight: 700 }}
            >
              <Mail size={14} /> Email selected
            </button>
            <button
              type="button"
              onClick={() => void handleEmailHistory(false)}
              disabled={visibleRows.length === 0 || emailSending}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--rm-green)", background: "var(--rm-green)", color: "#fff", cursor: visibleRows.length === 0 ? "not-allowed" : "pointer", opacity: visibleRows.length === 0 ? 0.5 : 1, fontSize: 11.5, fontWeight: 700 }}
            >
              <Mail size={14} /> Email all history
            </button>
          </div>
          {emailNotice && (
            <div role="status" style={{ margin: "0 0 8px", fontSize: 11.5, color: emailNotice.toLowerCase().includes("success") ? "#087F5B" : "#B26A00" }}>
              {emailNotice}
            </div>
          )}
          {error && rows.length > 0 ? (
            <div style={{ margin: "2px 0 8px", fontSize: 11.5, color: "#B26A00" }}>
              Couldn&apos;t refresh just now — showing the last loaded activity.
            </div>
          ) : refreshing && rows.length > 0 ? (
            <div style={{ margin: "2px 0 8px", fontSize: 11.5, color: "var(--rm-text-muted)" }} aria-live="polite">
              Checking for new activity…
            </div>
          ) : null}
          {loading && rows.length === 0 ? (
            <div aria-label="Loading audit trail" aria-live="polite" style={{
              marginTop: 6, border: "1px solid rgba(18, 150, 115, .24)", borderRadius: 12,
              padding: "22px 20px", background: "linear-gradient(135deg, rgba(18,150,115,.09), rgba(49,130,206,.08))",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{
                  width: 38, height: 38, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 12, color: "#087F5B", background: "rgba(18,150,115,.14)",
                }}>
                  <ShieldCheck size={21} style={{ animation: "rmPulseGlow 1.8s ease-in-out infinite" }} />
                </span>
                <div>
                  <strong style={{ display: "block", color: "var(--rm-text)", fontSize: 14 }}>Auditing your history…</strong>
                  <span style={{ display: "block", marginTop: 4, color: "var(--rm-text-muted)", fontSize: 12 }}>
                    {AUDIT_LOADING_STEPS[loadingStep]}
                  </span>
                </div>
              </div>
              <div
                role="progressbar"
                aria-label="Auditing your history"
                aria-valuetext={AUDIT_LOADING_STEPS[loadingStep]}
                style={{ position: "relative", height: 7, marginTop: 18, overflow: "hidden", borderRadius: 999, background: "rgba(18,150,115,.14)" }}
              >
                <span className="rm-progress-glide" style={{
                  position: "absolute", top: 0, bottom: 0, left: 0, width: "34%",
                  borderRadius: 999, background: "linear-gradient(90deg, #087F5B, #2FAF8C)",
                }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 10, color: "#087F5B", fontSize: 11 }}>
                <ShieldCheck size={13} />
                Secure audit lookup in progress
              </div>
            </div>
          ) : error && rows.length === 0 ? (
            <div style={{ padding: "18px 0", display: "flex", alignItems: "center", gap: 10, color: "#C92A2A" }}>
              <AlertTriangle size={18} /><span>The audit trail could not be loaded. Please try again.</span>
              <button type="button" onClick={() => void load()} style={{ marginLeft: "auto" }}>Try again</button>
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "24px 0", color: "var(--rm-text-muted)", fontSize: 13 }}>No audit activity has been recorded for this item yet.</div>
          ) : visibleRows.length === 0 ? (
            <div style={{ padding: "24px 0", color: "var(--rm-text-muted)", fontSize: 13 }}>No {activity === "interaction" ? "interaction" : "data-change"} activity matches this filter.</div>
          ) : (
            <>
              <div
                ref={auditTopScrollRef}
                aria-label="Scroll audit trail horizontally"
                onScroll={(event) => {
                  if (auditScrollSyncing.current) return;
                  const table = auditTableScrollRef.current;
                  if (!table) return;
                  auditScrollSyncing.current = true;
                  table.scrollLeft = event.currentTarget.scrollLeft;
                  requestAnimationFrame(() => { auditScrollSyncing.current = false; });
                }}
                style={{ position: "sticky", top: 0, zIndex: 4, height: 14, marginTop: 6, overflowX: "auto", overflowY: "hidden", background: "var(--rm-bg)", border: "1px solid var(--rm-panel-border)", borderBottom: 0, borderRadius: "10px 10px 0 0" }}
              >
                <div style={{ width: 1220, minWidth: 1220, height: 1 }} />
              </div>
              <div
                ref={auditTableScrollRef}
                onScroll={(event) => {
                  if (auditScrollSyncing.current) return;
                  const top = auditTopScrollRef.current;
                  if (!top) return;
                  auditScrollSyncing.current = true;
                  top.scrollLeft = event.currentTarget.scrollLeft;
                  requestAnimationFrame(() => { auditScrollSyncing.current = false; });
                }}
                style={{ border: "1px solid var(--rm-panel-border)", borderRadius: "0 0 10px 10px", overflowX: "auto", overflowY: "visible" }}
              >
                <table style={{ width: "100%", minWidth: 1220, borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ ...HEADER_CELL, width: 42, top: hideHeader ? 14 : 0 }} scope="col">
                        <input
                          type="checkbox"
                          aria-label="Select all visible audit entries"
                          checked={visibleRows.length > 0 && visibleRows.every((item) => selectedIds.has(item.id))}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelectedIds((current) => {
                              const next = new Set(current);
                              visibleRows.forEach((item) => checked ? next.add(item.id) : next.delete(item.id));
                              return next;
                            });
                          }}
                        />
                      </th>
                      <th style={{ ...HEADER_CELL, width: 52, top: hideHeader ? 14 : 0 }} scope="col">Sl. No</th>
                      <th style={{ ...HEADER_CELL, minWidth: 190, top: hideHeader ? 14 : 0 }} scope="col">Action</th>
                      <th style={{ ...HEADER_CELL, minWidth: 260, top: hideHeader ? 14 : 0 }} scope="col">Details (before → after)</th>
                      <th style={{ ...HEADER_CELL, minWidth: 170, top: hideHeader ? 14 : 0 }} scope="col">Affected</th>
                      <th style={{ ...HEADER_CELL, minWidth: 185, top: hideHeader ? 14 : 0 }} scope="col">Date &amp; time</th>
                      <th style={{ ...HEADER_CELL, minWidth: 120, top: hideHeader ? 14 : 0 }} scope="col">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((item, index) => {
                      const tone = OUTCOME[item.outcome] ?? OUTCOME.failed;
                      const account = ACCOUNT[item.accountStatus] ?? ACCOUNT.unknown;
                      const lines = changeLines(item.changes);
                      const isExpanded = expanded === item.id;
                      const hasDeviceInfo = Boolean(item.userAgent || item.requestId);
                      return (
                        <tr key={item.id} data-testid="audit-trail-row">
                          <td style={{ ...CELL, textAlign: "center" }}>
                            <input
                              type="checkbox"
                              aria-label={`Select audit entry ${index + 1}`}
                              checked={selectedIds.has(item.id)}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setSelectedIds((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(item.id);
                                  else next.delete(item.id);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td style={{ ...CELL, color: "var(--rm-text-muted)" }}>{index + 1}</td>
                          <td style={CELL}>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                              <strong style={{ fontSize: 12.5 }}>{actionLabel(item.action)}</strong>
                              <span style={{ padding: "2px 7px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: tone.color, background: tone.bg, whiteSpace: "nowrap" }}>{tone.label}</span>
                            </div>
                            <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--rm-text-muted)", overflowWrap: "anywhere" }}>
                              {actorLabel(item)}
                              {item.actorRole ? ` · ${item.actorRole}` : ""}
                              {item.source ? ` · via ${item.source}` : ""}
                            </div>
                          </td>
                          <td style={{ ...CELL, color: "var(--rm-text-muted)" }}>
                            {interactionDetails(item.action) && !item.failureReason ? (
                              <span style={{ fontStyle: "italic" }}>{interactionDetails(item.action)}</span>
                            ) : lines.length === 0 && !item.failureReason && (
                              <span style={{ fontStyle: "italic" }}>
                                {item.action.startsWith("view")
                                  ? "Opened for viewing — nothing was changed"
                                  : item.action.startsWith("login") || item.action.startsWith("logout")
                                    ? "—"
                                    : item.outcome === "success"
                                      ? "Saved successfully — no values changed"
                                      : "No change details were recorded for this event"}
                              </span>
                            )}
                            {lines.slice(0, MAX_INLINE_CHANGES).map((line, lineIndex) => (
                              <div key={lineIndex} style={{ marginTop: lineIndex === 0 ? 0 : 3, overflowWrap: "anywhere" }}>
                                <span style={{ color: "var(--rm-text)", fontWeight: 600 }}>{line.field}:</span>{" "}
                                {line.before != null
                                  ? <>{line.before} <span aria-hidden="true">→</span> {line.after ?? "—"}</>
                                  : line.after != null ? <>set to {line.after}</> : "changed"}
                              </div>
                            ))}
                            {lines.length > MAX_INLINE_CHANGES && (
                              <div style={{ marginTop: 4, fontStyle: "italic" }}>
                                …and {lines.length - MAX_INLINE_CHANGES} more changes in this event (not shown)
                              </div>
                            )}
                            {item.failureReason && <div style={{ marginTop: 4, color: tone.color, overflowWrap: "anywhere" }}>{item.failureReason}</div>}
                            {hasDeviceInfo && (
                              <button
                                type="button"
                                onClick={() => setExpanded((value) => value === item.id ? null : item.id)}
                                // display:block — the toggle must sit on its own
                                // line; inline it visually merges with the italic
                                // details text ("…nothing was changedDevice info").
                                style={{ display: "block", marginTop: 5, padding: 0, border: 0, background: "transparent", fontSize: 11, color: "var(--rm-green)", cursor: "pointer", textAlign: "left" }}
                              >
                                {isExpanded ? "Hide device info" : "Device info"}
                              </button>
                            )}
                            {isExpanded && hasDeviceInfo && (
                              <div style={{ marginTop: 6, padding: 8, borderRadius: 7, background: "var(--rm-bg)", fontSize: 11, overflowWrap: "anywhere" }}>
                                {item.userAgent && <div>Device/browser: {item.userAgent}</div>}
                                {item.requestId && <div>Request: {item.requestId}</div>}
                              </div>
                            )}
                          </td>
                          <td style={CELL}>
                            <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{item.entityName || item.entityId || "Tenant-wide"}</div>
                            <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--rm-text-muted)", overflowWrap: "anywhere" }}>
                              {item.entityType ? words(item.entityType) : "Activity"}
                              {item.entityName && item.entityId ? ` · ${item.entityId}` : ""}
                            </div>
                          </td>
                          <td style={{ ...CELL, whiteSpace: "nowrap" }} title={`UTC: ${item.createdAt}`}>
                            {DATE_TIME_FORMAT.format(new Date(item.createdAt))}
                          </td>
                          <td style={{ ...CELL, minWidth: 120 }}>
                            <button
                              type="button"
                              aria-label={`Email audit entry ${index + 1}`}
                              onClick={() => openEmailDraft([item])}
                              disabled={emailSending}
                              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, minWidth: 92, whiteSpace: "nowrap", padding: "6px 8px", borderRadius: 7, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", color: "var(--rm-green)", cursor: emailSending ? "wait" : "pointer", fontSize: 11, fontWeight: 700 }}
                            >
                              <Mail size={13} /> Email
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {cursor && (
                <button type="button" disabled={loadingMore} onClick={() => void load({ before: cursor })} style={{ marginTop: 14, padding: "8px 12px", borderRadius: 9, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", color: "var(--rm-text)", cursor: "pointer" }}>
                  {loadingMore ? "Loading…" : "Load earlier activity"}
                </button>
              )}
            </>
          )}
        </div>
      )}
      </section>
      <EditDraftModal
        open={emailDraft != null}
        initial={emailDraft}
        busy={emailSending}
        quickAdd={emailQuickAdd}
        onCancel={() => {
          if (!emailSending) setEmailDraft(null);
        }}
        onConfirm={(next) => void handleEmailConfirm(next)}
      />
    </>
  );
}
