/**
 * Settings → Stage Rules — admin-configured, company-wide rules that:
 *   1. LOCK fields once (or until) a record reaches a given stage
 *      ("lock Contract Value once an opportunity reaches Awarded"), and
 *   2. SKIP stages for records matching a field value ("Federal-sector
 *      opportunities skip Contract Negotiations").
 *
 * Locks are enforced server-side on every save path and apply to EVERYONE,
 * admins included; the record page also greys locked cells out up front.
 * Skips only hide stages from pickers and the lifecycle bar — they never
 * block saves.
 *
 * tenantId semantics (mirrors DisplayDefaultsSettings):
 *   undefined — a company admin editing their OWN company
 *   string    — a superadmin editing that specific company
 *   null      — a superadmin still on "Global defaults" scope: stage rules
 *               are per-company only, so show a pick-a-company note.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Plus, Trash2, Lock, SkipForward, AlertTriangle, ChevronDown, ChevronUp, X, UserCheck, Users, GripVertical, Workflow, RotateCcw, Check, Pencil, Tags, ClipboardList, LayoutTemplate, SlidersHorizontal, Eye, ChevronRight, Search, ExternalLink } from "lucide-react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MultiPick from "@/components/MultiPick";
import { ScopePicker, scopeLabel, DefaultScopeGuardDialog, ColorSwatchPicker, phaseColorIsDark } from "@/components/PhaseListEditor";
import { GroupMembersHover, useGroupMemberNames } from "@/components/GroupMembersHover";
import { getBusinessUnits, getFieldOptions, getUserList, getModuleRecords, updateFields } from "@/lib/api";
import {
  STAGE_RULE_MODULES, FALLBACK_STAGE_ORDER, EMPTY_STAGE_RULES, ruleFieldsFor,
  lockApplies, layoutApplies, ruleExempts,
  fetchStageRulesFor, saveStageRules, resetRecordStageRules, friendlyFieldLabel, webFieldKind,
  getStageRules, stageRulesLoaded,
  fetchWorkflowTemplates, saveWorkflowTemplates,
  fetchRecordForks,
  type StageRules, type StageRuleModule, type FieldLockRule, type StageSkipRule,
  type StageOrderMap, type FormLayoutRule, type WorkflowTypeEntry,
  type WorkflowTemplate, type RecordFork,
} from "@/lib/stageRules";
import { SKIP_FIELD_SUGGESTIONS, makeSkipValCache } from "@/lib/skipValueLoaders";
import {
  fetchStagePermissions, saveStagePermissions, fetchUserGroups, fetchImportedDefaults, groupColorMap, usePermissionsVersion,
  type StagePermRule, type UserGroup, type ImportedDefaults,
} from "@/lib/permissions";
import { getSeed, setSeed, seedScope, type StageRulesSeed } from "@/lib/settingsSeed";
import { fetchOrgAudienceGroups, isOrgAudienceId, isRoleAudienceId } from "@/lib/orgAudience";
import { audienceIdName, isUserAudienceId, personAudienceOptions, userAudienceId } from "@/lib/audienceIds";
import { findAudienceClashes, type ClashAudience } from "@/lib/audienceClash";
import { AudienceClashDialog } from "@/components/AudienceClashDialog";
import { Z } from "@/lib/zLayers";

// Workflow-type entries may be bare strings (unrestricted) or objects with
// group/user restrictions (#121/#131) and their own stage list (#131) — read
// through these everywhere.
const wtName = (e: WorkflowTypeEntry): string => (typeof e === "string" ? e : e.name);
const wtGroups = (e: WorkflowTypeEntry): string[] => (typeof e === "string" ? [] : (e.allowedGroupIds ?? []));
const wtUsers = (e: WorkflowTypeEntry): string[] => (typeof e === "string" ? [] : (e.allowedUserIds ?? []));
const wtStages = (e: WorkflowTypeEntry): string[] => (typeof e === "string" ? [] : (e.stages ?? []));
/** Canonical entry shape (mirrors the server sanitizer): bare string when NO
 *  extras are attached, so untouched docs keep their original shape. */
const wtEntry = (name: string, groupIds: string[], userIds: string[], stages: string[]): WorkflowTypeEntry => {
  if (groupIds.length === 0 && userIds.length === 0 && stages.length === 0) return name;
  const o: Exclude<WorkflowTypeEntry, string> = { name };
  if (groupIds.length) o.allowedGroupIds = groupIds;
  if (userIds.length) o.allowedUserIds = userIds;
  if (stages.length) o.stages = stages;
  return o;
};

/** A type's "who can use it" audience as exemption ids for its skip rule:
 *  group ids verbatim (they may already carry org:/user: sentinels) plus
 *  user:<id> sentinels for directly-listed people. Lowercased — the same
 *  canon the sanitizers store and ruleExempts compares against. People who
 *  can USE a type must still SEE its skipped stages; the skip only trims the
 *  stage list for everyone else. */
const typeAudienceIds = (groupIds: string[], userIds: string[]): string[] => {
  const all = [...groupIds, ...userIds.map(u => userAudienceId(u))];
  return [...new Set(all.map(s => s.trim().toLowerCase()).filter(Boolean))];
};

/** Recompute a type skip rule's exemption list after the type's audience
 *  changed: drop the OLD audience, keep manually-added extras, add the NEW
 *  audience. Returns the rule unchanged in shape (exemptGroupIds omitted
 *  when empty, mirroring the sanitizer's canonical form). */
const restampSkipExempt = (rule: StageSkipRule, oldAud: string[], newAud: string[]): StageSkipRule => {
  const oldSet = new Set(oldAud);
  const kept = (rule.exemptGroupIds ?? []).map(s => s.trim().toLowerCase()).filter(x => x && !oldSet.has(x));
  const merged = [...new Set([...kept, ...newAud])];
  const { exemptGroupIds: _e, ...rest } = rule;
  return merged.length ? { ...rest, exemptGroupIds: merged } : rest;
};

/** Save-time lockstep (also heals docs saved before this rule existed):
 *  every workflow type's audience is UNIONED into its own skip rule's
 *  exemptions, so "who can use it" members never lose the skipped stages.
 *  Union-only — audience REMOVALS are handled at edit time (patchTypeEntry /
 *  template scope sync), which know the old audience. */
const stampTypeExemptions = (r: StageRules): StageRules => {
  let stageSkips = r.stageSkips;
  for (const m of STAGE_RULE_MODULES) {
    for (const e of r.workflowTypes?.[m] ?? []) {
      const aud = typeAudienceIds(wtGroups(e), wtUsers(e));
      if (aud.length === 0) continue;
      const nm = wtName(e).trim().toLowerCase();
      const i = stageSkips.findIndex(s => s.module === m && s.field === "WorkflowTypeName" && s.value.trim().toLowerCase() === nm);
      if (i < 0) continue;
      const have = new Set((stageSkips[i].exemptGroupIds ?? []).map(s => s.trim().toLowerCase()));
      if (aud.every(a => have.has(a))) continue;
      if (stageSkips === r.stageSkips) stageSkips = [...stageSkips];
      stageSkips[i] = { ...stageSkips[i], exemptGroupIds: [...new Set([...have, ...aud])] };
    }
  }
  return stageSkips === r.stageSkips ? r : { ...r, stageSkips };
};

/** Link that jumps to Settings → Staff & Resources → User Groups so admins can
 *  create a group without leaving the rule they're editing. The settings page
 *  listens for this event and switches its own category/tab state. */
function NewGroupLink() {
  return (
    <button type="button" title="Create a new user group"
      onClick={() => window.dispatchEvent(new CustomEvent("rmone:openSettingsSection", { detail: { cat: "staff", sub: "staff-groups" } }))}
      style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--primary))", fontSize: 12, whiteSpace: "nowrap", padding: 0, textDecoration: "underline", flexShrink: 0 }}>
      + New group
    </button>
  );
}

/** Explicit "applies to" audience choice for a rule: Everyone, only specific
 *  groups, or only specific PEOPLE. People are stored as "user:<id>" sentinels
 *  in the SAME appliesToGroupIds list — the server adds each viewer's own
 *  sentinel to its membership checks, so no new storage or matching machinery.
 *  The legacy "everyone except selected groups" choice still renders for rules
 *  saved with it (the select must never lie about the current value), but new
 *  scoping offers Everyone / groups / people only.
 *  Local mode state keeps the picker open even while zero entries are picked,
 *  so the choice never silently flips back to Everyone mid-edit. */
function AppliesToPick({ exempt, only, onChange, groups, groupsReady, groupColors, people, exceptHint, onlyHint, hoverWrap }: {
  /** "Everyone except" list (exemptGroupIds) — legacy rules only. */
  exempt: string[];
  /** "Only specific groups/people" list (appliesToGroupIds) — wins over exempt. */
  only: string[];
  /** Called with BOTH lists — exactly one is ever non-empty. */
  onChange: (exempt: string[], only: string[]) => void;
  groups: UserGroup[];
  /** False while the group list has never loaded successfully — the picker
   *  must say "loading" rather than falsely claim no groups exist. */
  groupsReady: boolean;
  groupColors: Map<string, string>;
  /** Tenant roster for "Only specific people" — null when people can't be
   *  picked here (cross-tenant superadmin edits scope by group only). */
  people: { value: string; label: string }[] | null;
  exceptHint: string;
  onlyHint: string;
  /** Group-members hover wrapper forwarded to the picker (see GroupMembersHover). */
  hoverWrap?: (value: string, node: ReactNode) => ReactNode;
}) {
  type Mode = "everyone" | "except" | "groups" | "people";
  const deriveMode = (on: string[], ex: string[]): Mode =>
    on.length ? (on.every(isUserAudienceId) ? "people" : "groups") : ex.length ? "except" : "everyone";
  const [mode, setMode] = useState<Mode>(deriveMode(only, exempt));
  // Set only when the ADMIN switches to a scoped mode — the list then opens
  // immediately (one glance, no second click). Rules that load already
  // scoped must NOT auto-open dropdowns on page load.
  const [justSwitched, setJustSwitched] = useState(false);
  // A background refetch (or template apply) can change the lists under us —
  // reflect that; clearing stays manual so the picker doesn't vanish while
  // the admin is still choosing groups/people.
  useEffect(() => {
    if (only.length > 0) setMode(only.every(isUserAudienceId) ? "people" : "groups");
    else if (exempt.length > 0) setMode("except");
  }, [only.join("|"), exempt.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const personOpts = personAudienceOptions(people);
  return (
    <>
      <select value={mode}
        onChange={e => {
          const m = e.target.value as Mode;
          setMode(m);
          setJustSwitched(m !== "everyone");
          // Carry picks across mode switches — but only ids of the right KIND
          // (group ids never survive into people mode and vice versa).
          if (m === "everyone") onChange([], []);
          else if (m === "except") onChange((only.length ? only : exempt).filter(id => !isUserAudienceId(id)), []);
          else if (m === "groups") onChange([], (exempt.length ? exempt : only).filter(id => !isUserAudienceId(id)));
          else onChange([], (only.length ? only : exempt).filter(isUserAudienceId));
        }}
        style={{ height: 30, fontSize: 12.5, border: "1px solid hsl(var(--border))", borderRadius: 6, background: "hsl(var(--background))", padding: "0 6px", flexShrink: 0 }}>
        <option value="everyone">Everyone</option>
        {mode === "except" && <option value="except">Everyone except selected groups</option>}
        <option value="groups">Only specific groups</option>
        {(people !== null || mode === "people") && <option value="people">Only specific people</option>}
      </select>
      {mode !== "everyone" && (
        <MultiPick
          options={mode === "people"
            ? personOpts
            // Selected person entries ride along in group modes so a mixed
            // (hand-edited) list still shows names instead of raw sentinels.
            : [...groups.map(g => ({ value: g.id, label: g.name, color: groupColors.get(g.id) })), ...personOpts.filter(o => only.includes(o.value) || exempt.includes(o.value))]}
          selected={mode === "except" ? exempt : only}
          onChange={ids => (mode === "except" ? onChange(ids, []) : onChange([], ids))}
          placeholder={mode === "people"
            ? (personOpts.length ? "Pick the people this applies to…" : people === null ? "People can't be picked from this screen" : "Loading people…")
            : groups.length ? (mode === "groups" ? onlyHint : exceptHint) : groupsReady ? "No user groups yet — create one first" : "Loading groups…"}
          hoverWrap={hoverWrap}
          defaultOpen={justSwitched}
        />
      )}
      {mode !== "people" && <NewGroupLink />}
    </>
  );
}

/** Add-only searchable dropdown replacing long native <select> lists (#user
 *  request: the drawer's "Add a person…" roster select had no search box, so
 *  finding one name meant scrolling the whole company). Trigger looks like the
 *  compact selects around it; opening reveals a search input + filtered list
 *  (visual language mirrors MultiPick). Picking calls onPick and KEEPS the
 *  list open so several people can be added in a row — already-picked entries
 *  disappear because the caller filters them out of `sections`. */
function AddSearchPick({ placeholder, searchPlaceholder, sections, onPick }: {
  placeholder: string;
  searchPlaceholder: string;
  /** Grouped options (label: null = no header row). Sections emptied by the
   *  search query are hidden entirely. */
  sections: { label: string | null; opts: { value: string; label: string }[] }[];
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [q, setQ] = useState("");
  // Keyboard-highlighted row (combobox active option) — hover moves it too,
  // so mouse and keyboard never fight over two different highlights.
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const trigRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  // Outside-click close (same pattern as MultiPick — clicks on option rows
  // land inside `ref`, so picking never closes the list by accident).
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQ(""); }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  // Flip up when there isn't enough room below the trigger.
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setOpenUp(spaceBelow < 300 && rect.top > spaceBelow);
  }, [open]);
  // The search box is the whole point — focus it the moment the list opens.
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
    if (!open) { setQ(""); setActive(0); }
  }, [open]);

  const norm = q.trim().toLowerCase();
  const vis = sections
    .map(s => ({ ...s, opts: norm ? s.opts.filter(o => o.label.toLowerCase().includes(norm)) : s.opts }))
    .filter(s => s.opts.length > 0);
  const flat = vis.flatMap(s => s.opts);
  // Flattened render rows: headers interleaved with options carrying their
  // global keyboard index.
  const rows: Array<{ type: "header"; label: string } | { type: "opt"; value: string; label: string; idx: number }> = [];
  { let i = 0; for (const s of vis) { if (s.label) rows.push({ type: "header", label: s.label }); for (const o of s.opts) rows.push({ type: "opt", value: o.value, label: o.label, idx: i++ }); } }
  const act = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);
  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-opt-${i}`;
  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!open || act < 0) return;
    (listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null)
      ?.scrollIntoView({ block: "nearest" });
  }, [act, open, norm]);
  const pick = (v: string) => { onPick(v); setQ(""); searchRef.current?.focus(); };
  const close = (refocusTrigger: boolean) => {
    setOpen(false); setQ("");
    // Escape unmounts the focused input — hand focus back to the trigger so
    // keyboard users aren't dropped at the top of the page.
    if (refocusTrigger) trigRef.current?.focus();
  };

  return (
    <div ref={ref} style={{ position: "relative", maxWidth: 230 }}>
      <button ref={trigRef} type="button" onClick={() => setOpen(o => !o)} aria-label={placeholder} aria-expanded={open}
        style={{
          height: 28, fontSize: 12, borderRadius: 6, padding: "0 8px", width: "100%",
          border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
          color: "hsl(var(--muted-foreground))", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
        }}>
        {placeholder}
        <ChevronDown style={{ width: 13, height: 13, flexShrink: 0, transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div style={{
          position: "absolute",
          ...(openUp ? { bottom: "calc(100% + 4px)", top: "auto" } : { top: "calc(100% + 4px)", bottom: "auto" }),
          left: 0, minWidth: "100%", width: 280, zIndex: 50,
          background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
          borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
          display: "flex", flexDirection: "column", maxHeight: 300,
        }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid hsl(var(--border))", flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <Search style={{
                position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                width: 13, height: 13, color: "hsl(var(--muted-foreground))", pointerEvents: "none",
              }} />
              <input ref={searchRef} type="text" value={q}
                onChange={e => { setQ(e.target.value); setActive(0); }}
                role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
                aria-activedescendant={act >= 0 ? optId(act) : undefined}
                onKeyDown={e => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(flat.length - 1, 0))); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
                  else if (e.key === "Enter") { e.preventDefault(); if (act >= 0) pick(flat[act].value); }
                  else if (e.key === "Escape") { e.stopPropagation(); close(true); }
                }}
                placeholder={searchPlaceholder} aria-label={searchPlaceholder}
                style={{
                  width: "100%", padding: "5px 8px 5px 28px", fontSize: 12.5,
                  borderRadius: 5, border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--background))", color: "hsl(var(--foreground))",
                  outline: "none", boxSizing: "border-box",
                }} />
            </div>
          </div>
          <div ref={listRef} role="listbox" id={listId} style={{ overflowY: "auto", flex: 1 }}>
            {flat.length === 0 && (
              <div style={{ padding: "10px 12px", fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>
                {norm ? `No matches for "${q.trim()}"` : "Nothing left to add"}
              </div>
            )}
            {rows.map((row, ri) => row.type === "header" ? (
              <div key={`h-${row.label}`} style={{ padding: "7px 12px 3px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "hsl(var(--muted-foreground))" }}>
                {row.label}
              </div>
            ) : (
              <button key={row.value} type="button" onClick={() => pick(row.value)}
                role="option" id={optId(row.idx)} aria-selected={row.idx === act}
                data-active={row.idx === act ? "true" : undefined}
                onMouseEnter={() => setActive(row.idx)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "6px 12px",
                  fontSize: 13, color: "hsl(var(--popover-foreground))",
                  background: row.idx === act ? "hsl(var(--muted))" : "transparent",
                  border: "none", cursor: "pointer",
                }}>
                {row.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const MODULE_LABELS: Record<StageRuleModule, string> = {
  PMM: "Projects",
  OPM: "Opportunities",
  LEM: "Leads",
};

/** Stage-set ids derive from their names — Save As with an existing set's
 *  name UPDATES that set instead of creating a duplicate. One shared slug
 *  keeps the dialog's "updates X" hint and the save path from disagreeing. */
const tplIdOf = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** At-a-glance group chip on a "Who can act" stage row (#119): filled tint =
 *  stage owner, dashed outline = data editor. Colors are plain "#rrggbb" hex,
 *  so hex+alpha suffixes are safe here. */
function GlanceChip({ name, color, kind }: { name: string; color: string; kind: "owner" | "editor" }) {
  // No native title tooltip here — the GroupMembersHover wrapper at every
  // call site shows a richer card (role + member names) on hover instead.
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
        borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: "hsl(var(--foreground))",
        background: kind === "owner" ? `${color}1f` : "transparent",
        border: kind === "owner" ? `1px solid ${color}66` : `1px dashed ${color}88`,
        whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis",
      }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
    </span>
  );
}
/* ── Workflow Stages editor ──────────────────────────────────────────────
 * The company's stage sequence per module, shown as a numbered stepper (the
 * same visual the record pages use) plus an elderly-friendly reorder list:
 * big up/down arrow buttons AND drag handles, inline rename, add + delete.
 * Saving writes rules.stageOrder[module]; "Reset to standard" removes the
 * override so the derived/built-in order applies again.
 */
function WorkflowStagesCard({ rules, setRules, derivedOrder, statusOpts, perms, setPerms, onGoTypes, onSave, saving, dirty, templates, templatesReady, onSaveTemplate, onDeleteTemplate, onUpdateTemplateScope, onRenameTemplate, groups, groupsReady, groupColors, tenantId, people, loadedTpl, setLoadedTpl }: {
  rules: StageRules;
  setRules: React.Dispatch<React.SetStateAction<StageRules>>;
  /** Effective order per module when NO override is saved (server-derived or builtin). */
  derivedOrder: Record<StageRuleModule, string[]>;
  statusOpts: Record<StageRuleModule, string[]>;
  perms: StagePermRule[];
  /** The drawer's "Who can act here" section edits the SAME perms draft the tab edits. */
  setPerms: React.Dispatch<React.SetStateAction<StagePermRule[]>>;
  /** Switch the page to the Workflow types tab (drawer's "no types yet" hint). */
  onGoTypes?: () => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  /** Reusable workflow templates (#131) — save-as/apply/delete. */
  templates: WorkflowTemplate[];
  templatesReady: boolean;
  onSaveTemplate: (name: string, mod: StageRuleModule, stages: string[], colors: Record<string, string>, scope?: { applyMode: "everyone" | "except" | "groups"; groupIds: string[] }, opts?: { keepDefault?: boolean }) => void;
  onDeleteTemplate: (id: string) => void;
  /** Change WHO a saved stage set applies to, right from the Manage dialog. */
  onUpdateTemplateScope: (id: string, applyMode: "everyone" | "except" | "groups", groupIds: string[]) => void;
  onRenameTemplate?: (id: string, newName: string) => Promise<void>;
  /** Tenant roster for "Only specific people" scopes — null when people
   *  can't be picked here (cross-tenant superadmin edits). */
  people: { value: string; label: string }[] | null;
  groups: UserGroup[];
  groupsReady: boolean;
  groupColors: Map<string, string>;
  /** undefined = own company, string = superadmin's chosen company, null = none picked. */
  tenantId?: string | null;
  /** The set explicitly loaded via Manage→Edit — survives content edits so
   *  plain Save keeps writing THAT set, never the Everyone default (#user:
   *  editing a group set silently became everyone's workflow). */
  loadedTpl: { id: string; mod: StageRuleModule } | null;
  setLoadedTpl: (v: { id: string; mod: StageRuleModule } | null) => void;
  }) {
  const [mod, setMod] = useState<StageRuleModule>("LEM");
  // Feedback for Manage-sets "Edit" — when the loaded set's stages happen to
  // match what's already on screen, nothing visibly changes and the click
  // reads as "not loading"; the toast confirms it landed.
  const { toast } = useToast();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [newStage, setNewStage] = useState("");
  const [renameIdx, setRenameIdx] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [showAllExtras, setShowAllExtras] = useState(false);
  const [editingSetName, setEditingSetName] = useState(false);
  const [setNameDraft, setSetNameDraft] = useState("");
  // Per-module fresh-start flag — switching tabs doesn't wipe the clean slate.
  const [freshStartMods, setFreshStartMods] = useState<Partial<Record<StageRuleModule, boolean>>>({});
  const freshStart = !!(freshStartMods[mod]);
  const setFreshStart = (val: boolean) => setFreshStartMods(m => ({ ...m, [mod]: val }));
  const newStageInputRef = useRef<HTMLInputElement>(null);
  const [showTplDialog, setShowTplDialog] = useState(false);
  // Manage-dialog search box (#user request) — cleared whenever the dialog closes.
  const [tplQ, setTplQ] = useState("");
  // Imported-data truth for the Manage dialog's pinned entry — the statuses
  // actually found in the tenant's imported records, fetched lazily the first
  // time the dialog opens (live scan; the editable default gets overwritten
  // on save so it can't serve as this truth).
  const [imported, setImported] = useState<ImportedDefaults | null>(null);
  const importedTried = useRef(false);
  // Superadmin can switch companies without remounting — drop the previous
  // tenant's data so the next dialog open refetches for the right one.
  useEffect(() => {
    importedTried.current = false;
    setImported(null);
  }, [tenantId]);
  useEffect(() => {
    if (!showTplDialog || tenantId === null || importedTried.current) return;
    importedTried.current = true;
    let dead = false;
    fetchImportedDefaults(tenantId ?? undefined)
      .then((d) => { if (!dead) setImported(d); })
      .catch(() => { importedTried.current = false; /* retry on next open */ });
    return () => { dead = true; };
  }, [showTplDialog, tenantId]);
  // Hover-detail popup on numbered stage bubbles (stage bar + drag list).
  // Stores the pixel position of the hovered bubble so the popup is anchored
  // right below it regardless of scroll position.
  const [hoveredBubble, setHoveredBubble] = useState<{ idx: number; x: number; y: number } | null>(null);
  // Pinned popup — set when the user CLICKS a chip; stays open until dismissed.
  // Supersedes hover while active (mouse-leave won't close it).
  const [pinnedBubble, setPinnedBubble] = useState<{ idx: number; x: number; y: number } | null>(null);
  const hidePopupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showBubble = (e: React.MouseEvent<HTMLSpanElement>, idx: number) => {
    if (hidePopupTimer.current) { clearTimeout(hidePopupTimer.current); hidePopupTimer.current = null; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHoveredBubble({ idx, x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  };
  // Click a chip → pin the popup (toggle if already pinned at the same stage).
  const clickBubble = (e: React.MouseEvent<HTMLSpanElement>, idx: number) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPinnedBubble(prev => prev?.idx === idx ? null : { idx, x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  };
  const hideBubble = () => {
    hidePopupTimer.current = setTimeout(() => setHoveredBubble(null), 120);
  };
  const keepBubble = () => {
    if (hidePopupTimer.current) { clearTimeout(hidePopupTimer.current); hidePopupTimer.current = null; }
  };

  // ── Per-stage "Set rules" drawer ─────────────────────────────────────────
  // Index into the visible stage list of the stage whose drawer is open.
  const [drawerIdx, setDrawerIdx] = useState<number | null>(null);
  // Per-module per-stage record counts for the drawer header + freeze warning.
  // Own-company admins only: /records always serves the CALLER's tenant, so a
  // superadmin editing another company must not see their own counts here.
  // undefined = not fetched yet, null = fetch failed (drawer hides the count).
  const [recCounts, setRecCounts] = useState<Partial<Record<StageRuleModule, Record<string, number> | null>>>({});
  useEffect(() => {
    if (drawerIdx === null || tenantId !== undefined || recCounts[mod] !== undefined) return;
    let dead = false;
    // First-non-empty stage value per module — mirrors how record pages read it.
    const chains: Record<StageRuleModule, string[]> = {
      PMM: ["Status", "ModuleStepLookup"],
      OPM: ["CRMOpportunityStatusChoice", "CRMOpportunityStageChoice", "Status", "ModuleStepLookup"],
      LEM: ["LeadStatus", "Status"],
    };
    getModuleRecords(mod)
      .then(res => {
        if (dead) return;
        const counts: Record<string, number> = {};
        for (const rec of res.data ?? []) {
          let v = "";
          for (const c of chains[mod]) {
            const x = String((rec as Record<string, unknown>)[c] ?? "").trim();
            if (x) { v = x; break; }
          }
          if (v) counts[v.toLowerCase()] = (counts[v.toLowerCase()] ?? 0) + 1;
        }
        setRecCounts(m => ({ ...m, [mod]: counts }));
      })
      .catch(() => { if (!dead) setRecCounts(m => ({ ...m, [mod]: null })); });
    return () => { dead = true; };
  }, [drawerIdx, mod, tenantId, recCounts]);

  // "Save As…" popup state (MS-Word-style save flow, #this-batch).
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saName, setSaName] = useState("");
  const [saMode, setSaMode] = useState<"everyone" | "except" | "groups">("everyone");
  const [saGroups, setSaGroups] = useState<string[]>([]);
  // ── Default-scope guard (#user): pointing the EVERYONE default at specific
  // people usually means "give them their own set" — a popup offers create-new
  // (an exact copy) first; "Limit the default anyway" keeps the conversion.
  const [defGuard, setDefGuard] = useState<{ tplId: string; mode: "except" | "groups"; ids: string[] } | null>(null);
  const [defGuardName, setDefGuardName] = useState("");
  const [defGuardNonce, setDefGuardNonce] = useState(0);
  // Audience-overlap popup for Save As — open while the new set's audience
  // overlaps another same-module stage set's audience (same person or group
  // in both → first-match-wins would silently decide who sees what).
  const [saClashOpen, setSaClashOpen] = useState(false);
  // Which group-scoped exception card is expanded below the main editor.
  const [expandedTpl, setExpandedTpl] = useState<string | null>(null);

  const custom = rules.stageOrder?.[mod] ?? null;
  // Fresh-start ("+ New") builds from a truly EMPTY list — never fall back to
  // the derived/existing order while the user is composing a new set.
  const baseStages = freshStart ? (custom ?? []) : (custom ?? derivedOrder[mod]);

  // The saved stage set the current list already matches (if any) — plain
  // "Save" quietly refreshes IT too (colors etc.), Word-style, instead of
  // asking for a name again.
  const matchedTpl = useMemo(() => {
    if (!templatesReady) return null;
    const normArr = (arr: string[]) => arr.map(s => s.trim().toLowerCase());
    const cur = normArr(baseStages);
    const hits = templates.filter(t => {
      // The same stage sequence can exist in TWO modules — never cross-match
      // (plain Save / the header Applies-to control would silently edit the
      // OTHER module's set). Legacy sets without a module stamp still match.
      if (t.module && t.module !== mod) return false;
      const tn = normArr(t.stages);
      return tn.length === cur.length && tn.every((s, i) => s === cur[i]);
    });
    // Content tie (#user: a group set saved with the SAME steps as the
    // default): wear the EVERYONE holder's identity. Group sets are edited
    // explicitly through Manage→Edit (loadedTpl pins them), so a tie must
    // never dress the editor in a group set's name and route plain Save at it.
    const scopeOf = (t: WorkflowTemplate) => t.applyMode ?? ((t.groupIds ?? []).length ? "groups" : "everyone");
    return hits.find(t => scopeOf(t) === "everyone") ?? hits[0] ?? null;
  }, [templatesReady, templates, baseStages, mod]);

  // ── Single-Everyone rule (#user) ─────────────────────────────────────────
  // Per workflow, at most ONE saved set may apply to Everyone — that set IS
  // the module's default. The scope controls below refuse a second Everyone
  // and name the current holder instead.
  const tplScopeOf = (t: WorkflowTemplate) => t.applyMode ?? ((t.groupIds ?? []).length ? "groups" : "everyone");
  const everyoneTplFor = (m: StageRuleModule, excludeId?: string) =>
    templates.find(t => t.id !== excludeId && (t.module ?? m) === m && tplScopeOf(t) === "everyone") ?? null;
  // The set the editor is EDITING: an explicit Manage→Edit load wins (it
  // survives content edits); otherwise fall back to content-matching.
  const loadedTplObj = loadedTpl && loadedTpl.mod === mod ? templates.find(t => t.id === loadedTpl.id) ?? null : null;
  const activeTpl = loadedTplObj ?? matchedTpl;
  // Route scope changes through the default-guard (#user): converting the
  // EVERYONE holder to a group scope pops the create-new-recommended dialog
  // instead of applying straight away. Non-holder sets pass through. The
  // picker fires once on the bare mode switch (no ids yet) — swallowed
  // silently so the popup opens with the actual picks in hand.
  const guardedScopeChange = (tgt2: WorkflowTemplate, m: "everyone" | "except" | "groups", ids: string[]) => {
    if (tplScopeOf(tgt2) === "everyone" && m !== "everyone") {
      if (ids.length === 0) return;
      setDefGuardName("");
      // Close the header audience popover (custom portal, z 10000) — it would
      // float ABOVE the guard dialog; the Manage dialog (Radix) stacks fine.
      setTplAudFor(null);
      setDefGuard({ tplId: tgt2.id, mode: m, ids });
      return;
    }
    onUpdateTemplateScope(tgt2.id, m, m === "everyone" ? [] : ids);
  };

  // ── Manage-dialog search (#user request) ──────────────────────────────
  // A set matches on its NAME, on any audience entry's display name (group /
  // person / org unit), or on the name of a MEMBER of an audience group — so
  // typing a person's name surfaces the sets that reach them through a group.
  // "Everyone" sets carry no audience list, so they match by name only.
  const peopleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people ?? []) m.set(p.value.trim().toLowerCase(), p.label);
    return m;
  }, [people]);
  const tplQNorm = tplQ.trim().toLowerCase();
  const visibleTpls = templates.filter(tpl => {
    if (!tplQNorm) return true;
    if (tpl.name.toLowerCase().includes(tplQNorm)) return true;
    for (const id of tpl.groupIds ?? []) {
      if (audienceIdName(id, groups, people).toLowerCase().includes(tplQNorm)) return true;
      const g = groups.find(x => x.id === String(id).trim().toLowerCase());
      if (g && g.memberIds.some(mid => (peopleById.get(String(mid).trim().toLowerCase()) ?? "").toLowerCase().includes(tplQNorm))) return true;
    }
    return false;
  });

  // Roster names for the hover cards rendered from THIS card (drawer rows,
  // preview picker) — own tenant only; superadmin cross-tenant shows counts.
  const memberNamesOf = useGroupMemberNames(tenantId === undefined);

  // ── Save As audience-clash scan ───────────────────────────────────────
  // Existing SAME-MODULE stage sets in saved order (earlier = wins at
  // resolution time) plus the set being created (appended last = lowest
  // priority). Only clashes that involve the NEW set are surfaced here —
  // overlaps between pre-existing sets show inline on the Manage cards.
  const NEW_TPL_KEY = "__new_template__";
  const saClashes = useMemo(() => {
    if (saMode === "everyone") return [];
    // Same-name Save As REPLACES that set (ids derive from names) — leave it
    // out of the scan or the prefilled dialog would clash with itself.
    const saId = tplIdOf(saName);
    const list: ClashAudience[] = [];
    for (const t of templates) {
      if (t.module !== mod) continue;
      if (saId && t.id === saId) continue;
      list.push({ key: t.id, label: t.name, applyMode: t.applyMode, groupIds: t.groupIds ?? [], priority: list.length });
    }
    list.push({ key: NEW_TPL_KEY, label: saName.trim() || "New stage set", applyMode: saMode, groupIds: saGroups, priority: list.length });
    return findAudienceClashes(list, groups, people)
      .filter(c => c.winner.key === NEW_TPL_KEY || c.loser.key === NEW_TPL_KEY);
  }, [templates, mod, saMode, saGroups, saName, groups, people]);

  // ── Manage-dialog overlap scan (ALL modules at once) ─────────────────────
  // One scan across every saved set: same-workflow pairs are real conflicts
  // (first in the list wins at resolution time — amber warning). CROSS-workflow
  // pairs are NOT conflicts — each workflow resolves its own sets, so one
  // person is EXPECTED to have a set per workflow — but silence reads as
  // "group members aren't considered" when a person is covered directly in one
  // set and via a group in another (#user report). Those pairs get a neutral
  // gray note naming the other workflow instead. Sets with NO module stamp
  // never apply at runtime at all (the server requires t.module before a
  // scoped set can override anyone) — pairs involving one are informational
  // too; an amber "wins for them" there would claim a winner the server never
  // picks.
  const manageClashes = useMemo(() => {
    const modOf = new Map(templates.map(t => [t.id, t.module]));
    const list: ClashAudience[] = templates.map((t, i) => (
      { key: t.id, label: t.name, applyMode: t.applyMode, groupIds: t.groupIds ?? [], priority: i }));
    return findAudienceClashes(list, groups, people).map(c => {
      const wm = modOf.get(c.winner.key), lm = modOf.get(c.loser.key);
      const kind: "conflict" | "cross" | "inert" =
        !wm || !lm ? "inert" : wm === lm ? "conflict" : "cross";
      return { c, kind, winnerMod: wm, loserMod: lm };
    });
  }, [templates, groups, people]);

  const doSaveTemplate = () => {
    // Single-Everyone belt: the dialog disables Save for this, but the clash
    // popup path re-enters here and state can shift between render and click.
    const holder = saMode === "everyone" ? everyoneTplFor(mod, tplIdOf(saName)) : null;
    if (holder) {
      toast({
        title: "Only one stage set can be for everyone",
        description: `"${holder.name}" already applies to everyone in ${MODULE_LABELS[mod]}. Save this set for specific groups or people, or change "${holder.name}" first under Manage stage sets.`,
        variant: "destructive",
      });
      return;
    }
    onSaveTemplate(saName.trim(), mod, baseStages, rules.stageColors?.[mod] ?? {},
      { applyMode: saMode, groupIds: saMode === "everyone" ? [] : saGroups });
    setSaClashOpen(false);
    setShowSaveAs(false);
  };
  // Statuses already used on records ANYWHERE in the app appear directly in
  // this list, appended after the configured steps — exactly where the record
  // pages' stage bars show them — instead of a separate "click to add" strip.
  // Terminal outcomes (Converted / Lost / Closed…) are results, not steps.
  const normStage = (s: string) => s.trim().toLowerCase().replace(/[\u2013\u2014]/g, "-");
  // Keep in lockstep with the server's isOutcomeStageName (stage-rules.ts):
  // these names are ENDINGS (outcomes), not path steps — they split into the
  // OUTCOMES strip here and get ending buttons on the record page. "Awarded"
  // is deliberately a path step (real working phase that seeds schedules).
  const isTerminalish = (s: string) => {
    const k = normStage(s);
    return k === "converted" || k === "lost" || k === "won"
      || k === "cancelled" || k === "canceled" || k === "declined"
      || k.startsWith("closed");
  };
  const observedExtras = freshStart ? [] : statusOpts[mod]
    .filter(o => o.trim() && !isTerminalish(o) && !baseStages.some(s => normStage(s) === normStage(o)));
  const stages = [...baseStages, ...observedExtras];
  // Rows at index >= baseLen are in-use statuses, not yet official steps:
  // they can be recolored and reordered (any edit materializes the WHOLE
  // displayed list as the custom workflow, adopting them), but rename/delete
  // stay off — records still carry the value, so it would just reappear.
  const baseLen = baseStages.length;
  // Long in-use lists collapse: a few extras preview inline, the rest sit
  // behind an expander — mirroring the record pages' collapsed stage bars.
  // With a SAVED custom workflow, NOTHING previews inline: the list is exactly
  // what the admin composed, and old statuses still in use on records must not
  // resurface under it (user report: new set "rest, test2" grew the retired
  // "test1, test3" rows back). They stay reachable behind the expander.
  const EXTRA_PREVIEW = custom !== null ? 0 : 3;
  const extrasCollapsible = stages.length > baseLen + EXTRA_PREVIEW;
  const visibleCount = showAllExtras || !extrasCollapsible ? stages.length : baseLen + EXTRA_PREVIEW;
  const hiddenExtras = stages.length - visibleCount;
  const isCustom = custom !== null;
  const colorOf = (s: string) => rules.stageColors?.[mod]?.[s.trim().toLowerCase()] ?? null;
  const setColor = (s: string, color: string | null) => {
    setRules(r => {
      const all = { ...(r.stageColors ?? {}) };
      const entries = { ...(all[mod] ?? {}) };
      const k = s.trim().toLowerCase();
      if (color) entries[k] = color; else delete entries[k];
      if (Object.keys(entries).length) all[mod] = entries; else delete all[mod];
      const next = { ...r };
      if (Object.keys(all).length) next.stageColors = all; else delete next.stageColors;
      return next;
    });
  };
  // ── Per-stage audience ("Applies to" button on each row) ──────────────────
  // Who a SINGLE stage applies to. Stored on the rules doc keyed by lowercased
  // stage name (same convention as stageColors — a rename orphans the entry,
  // and it re-applies if the name returns). Saved with the card's Save button;
  // the server then drops scoped stages from this viewer-facing lists (stage
  // bar, Advance, status menus) for people outside the audience.
  const audienceOf = (s: string, m: StageRuleModule = mod) => rules.stageAudiences?.[m]?.[s.trim().toLowerCase()] ?? null;
  const [audFor, setAudFor] = useState<{ s: string; top: number; left: number } | null>(null);
  const audPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!audFor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (audPanelRef.current?.contains(t)) return;
      if (t.closest?.("[data-audbtn]")) return; // the button's own click handles toggling
      setAudFor(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAudFor(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [audFor]);
  // Set-level audience ("Applies to" button in the list header) — surfaces the
  // SAME "Who does it apply to?" control that lives under Manage stage sets
  // and in Save As…, right next to New where people look for it (#user
  // request). Edits persist through onUpdateTemplateScope immediately.
  const [tplAudFor, setTplAudFor] = useState<{ top: number; left: number; tplId?: string } | null>(null);
  const tplAudPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tplAudFor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (tplAudPanelRef.current?.contains(t)) return;
      if (t.closest?.("[data-tplaudbtn]")) return; // the button's own click handles toggling
      setTplAudFor(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTplAudFor(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [tplAudFor]);
  const tplScoped = !!activeTpl
    && (activeTpl.applyMode ?? ((activeTpl.groupIds ?? []).length ? "groups" : "everyone")) !== "everyone";
  const setAudience = (stage: string, m: "everyone" | "except" | "groups", ids: string[]) => {
    setRules(r => {
      const all = { ...(r.stageAudiences ?? {}) };
      const entries = { ...(all[mod] ?? {}) };
      const k = stage.trim().toLowerCase();
      // Empty selection = everyone. The server sanitizer drops such entries
      // anyway — storing them client-side would only fake a dirty state.
      if (m === "everyone" || ids.length === 0) delete entries[k];
      else entries[k] = { applyMode: m, groupIds: ids.map(x => x.toLowerCase()) };
      if (Object.keys(entries).length) all[mod] = entries; else delete all[mod];
      const next = { ...r };
      if (Object.keys(all).length) next.stageAudiences = all; else delete next.stageAudiences;
      return next;
    });
  };
  const audTitle = (s: string, m: StageRuleModule = mod): string => {
    const a = audienceOf(s, m);
    if (!a) return `"${s}" applies to everyone — click to scope it to specific groups or people`;
    const g = a.groupIds.filter(id => !isUserAudienceId(id) && !isOrgAudienceId(id) && !isRoleAudienceId(id)).length;
    const o = a.groupIds.filter(id => isOrgAudienceId(id)).length;
    const rl = a.groupIds.filter(id => isRoleAudienceId(id)).length;
    const p = a.groupIds.filter(id => isUserAudienceId(id)).length;
    const parts = [
      g ? `${g} group${g === 1 ? "" : "s"}` : "",
      o ? `${o} org unit${o === 1 ? "" : "s"}` : "",
      rl ? `${rl} role${rl === 1 ? "" : "s"}` : "",
      p ? `${p} ${p === 1 ? "person" : "people"}` : "",
    ].filter(Boolean).join(", ");
    return a.applyMode === "groups"
      ? `"${s}" applies only to ${parts} — everyone else's workflow skips it. Click to change.`
      : `"${s}" applies to everyone EXCEPT ${parts}. Click to change.`;
  };
  const labels = rules.buttonLabels?.[mod] ?? {};
  const setLabel = (key: "advance" | "back" | "lost" | "cancel", v: string) => {
    setRules(r => {
      const all = { ...(r.buttonLabels ?? {}) };
      const entry = { ...(all[mod] ?? {}) };
      const t = v.trim().slice(0, 24);
      if (t) entry[key] = t; else delete entry[key];
      if (Object.keys(entry).length) all[mod] = entry; else delete all[mod];
      const next = { ...r };
      if (Object.keys(all).length) next.buttonLabels = all; else delete next.buttonLabels;
      return next;
    });
  };

  // forMod: the Manage-sets Edit button loads a set into the set's OWN
  // workflow, which may not be the tab currently shown — the default (current
  // tab) covers every other caller.
  const setOrder = (next: string[] | null, forMod: StageRuleModule = mod) => {
    setRules(r => {
      const so = { ...(r.stageOrder ?? {}) };
      // Normally lists under 2 stages reset to the derived order, but during a
      // fresh start the FIRST typed stage must stick or it silently reverts.
      if (next && (next.length >= 2 || (freshStart && next.length >= 1))) so[forMod] = next;
      else delete so[forMod];
      // Preserve everything else (stageColors, buttonLabels, …) — only the
      // stageOrder key is being added/removed here.
      if (Object.keys(so).length) return { ...r, stageOrder: so };
      const rest = { ...r };
      delete rest.stageOrder;
      return rest;
    });
    setRenameIdx(null);
  };
  // Any edit while still on the derived order first materializes it as custom.
  // Only the VISIBLE rows are materialized — hidden (collapsed) in-use
  // statuses must never be silently adopted into the workflow by an edit.
  const edit = (fn: (list: string[]) => string[]) => setOrder(fn(stages.slice(0, visibleCount)));

  // Move a PATH row to a target PATH position. Works on the path projection
  // so outcome rows (terminal results) interleaved in the underlying list are
  // never dragged along — the moved step lands exactly at the requested path
  // position and every other row keeps its place.
  const movePath = (fromReal: number, toPathPos: number) => {
    if (toPathPos < 0 || fromReal < 0 || fromReal >= visibleCount) return;
    edit(list => {
      const [x] = list.splice(fromReal, 1);
      const pIdx = list.map((_, i) => i).filter(i => !isTerminalish(list[i]));
      if (toPathPos > pIdx.length) return (list.splice(fromReal, 0, x), list); // out of range — put it back
      const at = toPathPos < pIdx.length ? pIdx[toPathPos] : (pIdx.length ? pIdx[pIdx.length - 1] + 1 : list.length);
      list.splice(at, 0, x);
      return list;
    });
  };
  const addStage = () => {
    const v = newStage.trim();
    if (!v) return;
    const visible = stages.slice(0, visibleCount);
    if (visible.some(s => s.trim().toLowerCase() === v.toLowerCase())) { setNewStage(""); return; }
    // Typing the name of a hidden in-use status ADOPTS it into the workflow
    // (keeping its original casing) — the only deliberate way to bring one in.
    const adopted = stages.slice(visibleCount).find(s => s.trim().toLowerCase() === v.toLowerCase());
    setOrder([...visible, adopted ?? v]);
    setNewStage("");
    // Fresh-start stays on for the whole composition: the "in use on records"
    // statuses belong to the OLD workflow and must not resurface just because
    // the new list reached 2 stages. It ends on reset or module switch.
  };
  const commitRename = () => {
    if (renameIdx === null) return;
    const v = renameVal.trim();
    const i = renameIdx;
    setRenameIdx(null);
    if (!v || v === stages[i]) return;
    if (stages.some((s, j) => j !== i && s.trim().toLowerCase() === v.toLowerCase())) return;
    edit(list => list.map((s, j) => (j === i ? v : s)));
  };

  const key = (s: string) => s.trim().toLowerCase();
  const badgesFor = (s: string) => {
    const k = key(s);
    const locks = rules.fieldLocks.filter(r => r.module === mod && key(r.stage) === k).length;
    const skips = rules.stageSkips.filter(r => r.module === mod && r.skipStages.some(x => key(x) === k)).length;
    const who = perms.filter(p => p.module === mod && key(p.stage) === k)
      .reduce((n, p) => n + p.actionUserIds.length + p.actionGroupIds.length + p.editorUserIds.length + p.editorGroupIds.length, 0);
    return { locks, skips, who };
  };
  /** Full detail for the hover popup — same filters as badgesFor but returns
       arrays. Takes an optional module so the Manage-sets cards (which can
       list sets saved under ANOTHER module) never count the wrong rules. */
  const detailFor = (s: string, m: StageRuleModule = mod) => {
    const k = key(s);
    const lockRules = rules.fieldLocks.filter(r => r.module === m && key(r.stage) === k);
    const skipRules = rules.stageSkips.filter(r => r.module === m && r.skipStages.some(x => key(x) === k));
    const whoRules = perms.filter(p => p.module === m && key(p.stage) === k);
    const formRules = (rules.formLayout ?? []).filter(r => r.module === m && key(r.stage) === k);
    const reqRules = (rules.requiredFields ?? []).filter(r => r.module === m && key(r.stage) === k);
    return { lockRules, skipRules, whoRules, formRules, reqRules };
  };
  const groupName = (id: string) => groups.find(g => g.id === id)?.name ?? id;
  const personName = (id: string) =>
    people?.find(pp => pp.value.toLowerCase() === id.toLowerCase())?.label ?? id;
  /** How many rules touch a stage — same definition as the drawer's total
       (field locks + skip conditions + who-can-act + form rules). */
  const ruleCountFor = (s: string, m: StageRuleModule = mod) => {
    const { lockRules, skipRules, whoRules, formRules, reqRules } = detailFor(s, m);
    return lockRules.length + skipRules.length + whoRules.length + formRules.length + reqRules.length;
  };
  /** Plain-language hover summary of every rule touching a stage — shared by
       the "Set rules (N)" button and the stage chips in the set cards, so a
       set that "applies to everyone" still reveals its per-stage limits. */
  const ruleSummaryFor = (s: string, m: StageRuleModule = mod): string => {
    const { lockRules, skipRules, whoRules, formRules, reqRules } = detailFor(s, m);
    const lines: string[] = [];
    for (const r of reqRules)
      lines.push(`• Must be filled in to enter: ${r.fields.map(f => friendlyFieldLabel(f, m)).join(", ")}`);
    for (const r of whoRules) {
      const owners = [...r.actionGroupIds.map(groupName), ...r.actionUserIds.map(personName)];
      const editors = [...r.editorGroupIds.map(groupName), ...r.editorUserIds.map(personName)];
      const bits: string[] = [];
      if (owners.length) bits.push(`${owners.join(", ")} — can move forward and edit`);
      if (editors.length) bits.push(`${editors.join(", ")} — can edit, can't move forward`);
      bits.push(r.othersMode === "normal" ? "everyone else: normal permissions" : "everyone else: view only");
      lines.push(`• Who can act: ${bits.join("; ")}`);
    }
    for (const r of lockRules)
      lines.push(`• Locked ${r.direction === "until" ? "until here" : "from here on"}: ${r.fields.join(", ")}`);
    for (const r of skipRules)
      lines.push(`• Skipped when ${r.field} = ${r.value}`);
    for (const r of formRules) {
      const parts = [
        r.hidden.length ? `${r.hidden.length} hidden` : "",
        r.readOnly.length ? `${r.readOnly.length} read-only` : "",
      ].filter(Boolean);
      if (parts.length) lines.push(`• Form: ${parts.join(", ")}`);
    }
    const n = lines.length;
    const head = n
      ? `${n} rule${n === 1 ? "" : "s"} on "${s}":`
      : `No rules on "${s}" yet — open Set rules to add some.`;
    const tail = audienceOf(s, m) ? `\n${audTitle(s, m)}` : "";
    return n ? `${head}\n${lines.join("\n")}${tail}` : `${head}${tail}`;
  };

  // ── Mockup-style display model: PATH (ordered steps) vs OUTCOMES ─────────
  // Terminal results (Won / Lost / Closed… / Converted / Cancelled) render in
  // their own unordered OUTCOMES section — display-only grouping, the saved
  // stage list is unchanged.
  const visibleStages = stages.slice(0, visibleCount);
  const pathIdx = visibleStages.map((_, i) => i).filter(i => !isTerminalish(visibleStages[i]));
  const outcomeIdx = visibleStages.map((_, i) => i).filter(i => isTerminalish(visibleStages[i]));
  const pathNum = new Map(pathIdx.map((ri, pos) => [ri, pos + 1]));
  const wonish = (s: string) => {
    const k = normStage(s);
    return k === "won" || k === "converted" || (k.startsWith("closed") && k.includes("won"));
  };

  // Open the drawer on a stage by NAME (inherited-rule "Go to" links) —
  // expanding the collapsed in-use extras first when the target hides there.
  const gotoStage = (name: string) => {
    const at = stages.findIndex(s => normStage(s) === normStage(name));
    if (at < 0) return;
    if (at >= visibleCount) setShowAllExtras(true);
    setDrawerIdx(at);
  };
  // ↑↓ header stepping — moves the open drawer between stages without closing.
  const stepDrawer = (dir: -1 | 1) => setDrawerIdx(i => {
    if (i === null) return i;
    const n = i + dir;
    return n < 0 || n >= visibleCount ? i : n;
  });

  // Likely-typo detection: any long word in a stage name that ISN'T part of
  // the standard/derived vocabulary but sits 1-2 edits away from a word that
  // is (e.g. "Propsal" vs "Proposal") gets a gentle warning chip.
  const lev = (a: string, b: string): number => {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
      let prev = dp[0];
      dp[0] = j;
      for (let i = 1; i <= a.length; i++) {
        const t = dp[i];
        dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = t;
      }
    }
    return dp[a.length];
  };
  const typoVocab = useMemo(() => {
    const words = new Set<string>();
    for (const list of [derivedOrder[mod] ?? [], FALLBACK_STAGE_ORDER[mod] ?? []])
      for (const st of list)
        for (const w of st.trim().toLowerCase().split(/[^a-z]+/))
          if (w.length >= 5) words.add(w);
    return words;
  }, [mod, derivedOrder]);
  const typoFor = (s: string): string | null => {
    for (const w of normStage(s).split(/[^a-z]+/)) {
      if (w.length < 5 || typoVocab.has(w)) continue;
      for (const cand of typoVocab) {
        const d = lev(w, cand);
        if (d > 0 && d <= (w.length >= 8 ? 2 : 1)) return cand;
      }
    }
    return null;
  };

  // Mockup-style text chips on each stage row ("1 locked", "skippable",
  // "4 can act", "custom form") — hovering any of them opens the detail popup.
  const stageChips = (s: string, i: number) => {
    const { lockRules, skipRules, whoRules, formRules, reqRules } = detailFor(s);
    const lockedFields = new Set(lockRules.flatMap(r => r.fields.map(f => key(f)))).size;
    const reqCount = new Set(reqRules.flatMap(r => r.fields.map(f => key(f)))).size;
    const whoCount = whoRules.reduce((n, p) =>
      n + p.actionUserIds.length + p.actionGroupIds.length + p.editorUserIds.length + p.editorGroupIds.length, 0);
    const formFields = new Set(formRules.flatMap(r => [...r.hidden, ...r.readOnly].map(f => key(f)))).size;
    const typo = typoFor(s);
    const chip = (label: string, fg: string, bg: string, bd: string, hint: string) => (
      <span key={label} title={pinnedBubble?.idx === i ? undefined : hint}
        onMouseEnter={e => showBubble(e, i)} onMouseLeave={hideBubble}
        onClick={e => clickBubble(e, i)}
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, fontWeight: 600,
          padding: "2px 8px", borderRadius: 5, whiteSpace: "nowrap", cursor: "pointer",
          background: pinnedBubble?.idx === i ? bg.replace("0.10", "0.22").replace("0.08", "0.20") : bg,
          border: `1px solid ${pinnedBubble?.idx === i ? fg : bd}`, color: fg, flexShrink: 0,
        }}>
        {label}
      </span>
    );
    if (!lockedFields && !skipRules.length && !whoCount && !formFields && !reqCount && !typo) return null;
    return (
      <span style={{ display: "inline-flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
        {typo && (
          <span title={`Possible misspelling — similar to "${typo}". Use the pencil to rename it if so.`}
            onMouseEnter={e => showBubble(e, i)} onMouseLeave={hideBubble}
            style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: "#d97706", whiteSpace: "nowrap", cursor: "default" }}>
            <AlertTriangle style={{ width: 11, height: 11 }} /> likely typo
          </span>
        )}
        {/* Chip colors match the hover popup + stage-bar badges: required rose,
             locks sky, skips amber, access green, form purple — one color language. */}
        {reqCount > 0 && chip(`${reqCount} required`, "#e11d48", "rgba(225,29,72,0.08)", "rgba(225,29,72,0.35)",
          `${reqCount} field${reqCount > 1 ? "s" : ""} must be filled in before a record can move to this stage — hover for the list`)}
        {lockedFields > 0 && chip(`${lockedFields} locked`, "#0284c7", "rgba(14,165,233,0.10)", "rgba(14,165,233,0.40)",
          `${lockedFields} field${lockedFields > 1 ? "s" : ""} lock at this stage — hover for the list`)}
        {skipRules.length > 0 && chip("skippable", "#b45309", "rgba(245,158,11,0.10)", "rgba(245,158,11,0.45)",
          "Some records skip this stage — hover for when")}
        {whoCount > 0 && chip(`${whoCount} can act`, "#047857", "rgba(16,185,129,0.10)", "rgba(16,185,129,0.40)",
          "Only specific people or groups can act here — hover for who")}
        {formFields > 0 && chip(`${formFields} in form`, "#7c3aed", "rgba(139,92,246,0.10)", "rgba(139,92,246,0.45)",
          "This stage hides or locks some form fields — hover for details")}
      </span>
    );
  };

  const bubble = (n: number, customColor?: string | null): React.CSSProperties => ({
    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 13, fontWeight: 700,
    background: customColor || "hsl(var(--primary))",
    color: "#FFFFFF",
  });
  const iconBtn: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 6, border: "1px solid hsl(var(--border))",
    background: "hsl(var(--background))", color: "hsl(var(--foreground))",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  };

  const handleSetNameSave = async () => {
    if (!matchedTpl || !onRenameTemplate) return;
    const trimmed = setNameDraft.trim();
    if (trimmed && trimmed !== matchedTpl.name) await onRenameTemplate(matchedTpl.id, trimmed);
    setEditingSetName(false);
  };

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Workflow style={{ width: 16, height: 16, color: "#8b5cf6", flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: "hsl(var(--foreground))" }}>Workflow stages</span>
        </div>
        {matchedTpl && (
          editingSetName ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <input
                autoFocus
                value={setNameDraft}
                onChange={e => setSetNameDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { void handleSetNameSave(); }
                  if (e.key === "Escape") setEditingSetName(false);
                }}
                style={{ fontSize: 18, fontWeight: 700, border: "1px solid hsl(var(--border))", borderRadius: 6, padding: "3px 10px", background: "hsl(var(--background))", color: "hsl(var(--foreground))", outline: "none", minWidth: 180 }}
              />
              <button type="button" onClick={() => void handleSetNameSave()}
                style={{ padding: "4px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "hsl(var(--primary))", color: "#fff", border: "none" }}>
                Save
              </button>
              <button type="button" onClick={() => setEditingSetName(false)}
                style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "none", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }}>
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, minHeight: 26 }}>
              <span style={{ fontSize: 19, lineHeight: 1.25, fontWeight: 700, color: "hsl(var(--foreground))" }}>{matchedTpl.name}</span>
              {onRenameTemplate && (
                <button type="button" title="Rename this stage set"
                  onClick={() => { setSetNameDraft(matchedTpl.name); setEditingSetName(true); }}
                  style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Pencil style={{ width: 12, height: 12 }} />
                </button>
              )}
            </div>
          )
        )}
      </div>
      <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 0, marginBottom: 18 }}>
        The steps a record moves through, in order. This order drives the stage bar on every record page,
        the "Advance" button, and when field locks kick in. Drag a stage, or use the arrow buttons, to reorder.
      </p>
      <div>
        {/* Module tabs — underline style (mockup) with Standard/Custom chip right */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, borderBottom: "1px solid hsl(var(--border))", marginBottom: 16 }}>
          {STAGE_RULE_MODULES.map(m => (
            <button key={m} type="button" onClick={() => { setMod(m); setRenameIdx(null); setNewStage(""); setShowAllExtras(false); setExpandedTpl(null); setDrawerIdx(null); }}
              style={{
                // Equal-width tabs (user request): each module tab takes an
                // identical share of the strip instead of sizing to its label.
                flex: "1 1 0", minWidth: 0, textAlign: "center",
                padding: "8px 14px", fontSize: 13.5, cursor: "pointer",
                fontWeight: m === mod ? 700 : 500,
                background: "none", border: "none", marginBottom: -1,
                color: m === mod ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                borderBottom: m === mod ? "2.5px solid hsl(var(--primary))" : "2.5px solid transparent",
                transition: "color .15s, border-color .15s",
              }}>
              {MODULE_LABELS[m]}
            </button>
          ))}
          <span style={{
            marginLeft: "auto", fontSize: 11.5, fontWeight: 600,
            padding: "3px 10px", whiteSpace: "nowrap", borderRadius: 999, marginBottom: 6,
            background: isCustom ? "rgba(139,92,246,0.10)" : "hsl(var(--muted) / 0.5)",
            border: `1px solid ${isCustom ? "#8b5cf655" : "hsl(var(--border))"}`,
            color: isCustom ? "#8b5cf6" : "hsl(var(--muted-foreground))",
          }}>
            {isCustom ? "Custom workflow" : "Standard"}
          </span>
        </div>

        {/* Visual stepper preview — single row, clips overflow so long stage
             names never wrap. The expand toggle lives OUTSIDE this container
             so overflow:hidden never clips it. */}
        <div style={{
          display: "flex", alignItems: "center", gap: 0, flexWrap: "nowrap",
          overflowX: "auto",
          padding: "14px 12px",
          borderRadius: extrasCollapsible ? "10px 10px 0 0" : 10,
          marginBottom: extrasCollapsible ? 0 : 16,
          background: "hsl(var(--muted) / 0.4)",
          border: "1px solid hsl(var(--border))",
          borderBottom: extrasCollapsible ? "none" : undefined,
        }}>
          {/* Same PATH-then-OUTCOMES projection as the reorder list below —
              outcomes (Lost / Won / Closed…) always render at the END of the
              strip no matter where they sit in the underlying saved list, so
              the preview and the list never disagree about the order. */}
          {[...pathIdx, ...outcomeIdx].flatMap((i, renderPos) => {
            const s = visibleStages[i];
            const b = badgesFor(s);
            const isOut = isTerminalish(s);
            const pill = (
              <div key={`pill-${s}-${i}`} title={`Set rules for "${s}"`} onClick={() => setDrawerIdx(i)}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 10px 5px 6px", borderRadius: 999, cursor: "pointer", background: drawerIdx === i ? "rgba(139,92,246,0.08)" : "hsl(var(--background))", border: `1px solid ${drawerIdx === i ? "#8b5cf6" : "hsl(var(--border))"}`, flexShrink: 0 }}>
                <span style={{ ...bubble(i, colorOf(s) ?? (isOut ? (wonish(s) ? "#15803d" : "#6b7280") : null)), cursor: "default" }}
                  onMouseEnter={e => showBubble(e, i)} onMouseLeave={hideBubble}>
                  {isOut ? (wonish(s) ? <Check style={{ width: 15, height: 15 }} /> : <X style={{ width: 14, height: 14 }} />) : pathNum.get(i)}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", whiteSpace: "nowrap" }}>{s}</span>
                {b.locks > 0 && <span title={`${b.locks} field-lock rule${b.locks > 1 ? "s" : ""} anchored here`} style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, color: "#0ea5e9" }}><Lock style={{ width: 11, height: 11 }} />{b.locks}</span>}
                {b.skips > 0 && <span title="Some records skip this stage" style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, color: "#f59e0b" }}><SkipForward style={{ width: 11, height: 11 }} />{b.skips}</span>}
                {b.who > 0 && <span title="Only specific people or groups can act at this stage" style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, color: "#10b981" }}><UserCheck style={{ width: 11, height: 11 }} />{b.who}</span>}
              </div>
            );
            if (renderPos === 0) return [pill];
            const connector = (
              // Continuous dotted line filling the whole gap (repeating dot
              // pattern), flowing left→right — not a few dots in the middle.
              <span key={`conn-${s}-${i}`} style={{
                flex: 1, minWidth: 16, height: 4, alignSelf: "center", margin: "0 6px",
                backgroundImage: "radial-gradient(circle, #6366f1 1.5px, transparent 1.6px)",
                backgroundSize: "10px 4px", backgroundRepeat: "repeat-x", backgroundPosition: "0 center",
                animation: "phaseConnectorFlow 0.9s linear infinite",
              }} />
            );
            return [connector, pill];
          })}
        </div>
        {/* Expand / collapse toggle — outside the clipped row so it's always
             visible on every module tab whenever there are hidden extras. */}
        {extrasCollapsible && (
          <button type="button" onClick={() => setShowAllExtras(v => !v)}
            title={showAllExtras ? "Collapse the in-use statuses" : `Show all ${stages.length} — every status in use on records`}
            style={{
              width: "100%", padding: "6px 12px", marginBottom: 16,
              borderRadius: "0 0 10px 10px",
              border: "1px solid hsl(var(--border))", borderTop: "none",
              background: "hsl(var(--muted) / 0.25)", cursor: "pointer",
              fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
              color: "hsl(var(--primary))",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            }}>
            {showAllExtras
              ? <><ChevronUp style={{ width: 13, height: 13 }} /> Hide the {hiddenExtras} extra stage{hiddenExtras === 1 ? "" : "s"}</>
              : <><ChevronDown style={{ width: 13, height: 13 }} /> {stages.length - visibleCount} more stage{stages.length - visibleCount === 1 ? "" : "s"} already on your records — all {stages.length} are saved together, click to see them</>}
          </button>
        )}

        {/* ── Reorder list — bordered card containing the draggable stage rows */}
        <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 10, marginBottom: 16 }}>
          {/* Card header: audience chip + steps·outcomes summary left, New / Manage right */}
          <div style={{ padding: "8px 12px", background: "hsl(var(--muted) / 0.45)", borderBottom: "1px solid hsl(var(--border))", display: "flex", alignItems: "center", gap: 8, borderRadius: "9px 9px 0 0" }}>
            {(() => {
              const scope = activeTpl ? tplScopeOf(activeTpl) : "everyone";
              // The everyone set IS the default — badge it green as "Default"
              // instead of a plain "Everyone" (#user request).
              const isDefault = scope === "everyone";
              const label = isDefault
                ? "DEFAULT · EVERYONE"
                : (scope === "except" ? "EVERYONE EXCEPT " : "") + (activeTpl?.groupIds ?? []).map(groupName).join(", ").toUpperCase();
              return (
                <span title={isDefault
                    ? (activeTpl
                      ? `"${activeTpl.name}" is the everyone default — the workflow everyone gets unless a group stage set covers them. Only one set can be the everyone default.`
                      : "This is the default workflow — everyone gets it unless a group stage set covers them.")
                    : `This stage list ${loadedTplObj ? "is the saved set" : "matches the saved set"} "${activeTpl?.name}" — saving updates that set for its own people, not the everyone default`}
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10.5, fontWeight: 700,
                    letterSpacing: 0.6, padding: "3px 9px", borderRadius: 6, whiteSpace: "nowrap",
                    maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis",
                    background: isDefault ? "rgba(16,185,129,0.12)" : "hsl(var(--background))",
                    border: isDefault ? "1px solid rgba(16,185,129,0.5)" : "1px solid hsl(var(--border))",
                    color: isDefault ? "#047857" : "hsl(var(--foreground))", flexShrink: 0,
                  }}>
                  {label}
                </span>
              );
            })()}
            <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--muted-foreground))", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {pathIdx.length} step{pathIdx.length === 1 ? "" : "s"}{outcomeIdx.length > 0 ? ` · ${outcomeIdx.length} outcome${outcomeIdx.length === 1 ? "" : "s"}` : ""}
            </span>
            {/* New + Manage stage sets — pinned in header so they're always accessible */}
            <button type="button"
              title="Start a new stage list from scratch — rename the starter stages, then use Save As… to store it as a named set"
              onClick={() => {
                if (dirty && !window.confirm(`The current ${MODULE_LABELS[mod]} stage list has unsaved changes — start fresh? Unsaved edits are lost. Saved stage sets under Manage are not affected.`)) return;
                setOrder([]); setRenameIdx(null); setNewStage(""); setShowAllExtras(false); setFreshStart(true); setLoadedTpl(null);
                setTimeout(() => newStageInputRef.current?.focus(), 50);
              }}
              style={{
                display: "flex", alignItems: "center", gap: 4, height: 28, padding: "0 10px",
                fontSize: 12, fontWeight: 700, borderRadius: 6, border: "1.5px solid #6366f1",
                background: "#6366f115", color: "#6366f1", cursor: "pointer",
              }}>
              <Plus style={{ width: 13, height: 13 }} /> New
            </button>
            {/* Who the WHOLE stage list applies to — same control as under
                 Manage stage sets / Save As…, surfaced here so it's easy to
                 find (#user request) */}
            <button type="button" data-tplaudbtn=""
              title={activeTpl
                ? `Who does "${activeTpl.name}" apply to — the same setting lives under Manage stage sets and Save As…`
                : "Who does this stage list apply to — Save As… names the list first, then you pick the audience"}
              onClick={e => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setTplAudFor(prev => prev ? null : {
                  top: Math.min(r.bottom + 6, Math.max(80, window.innerHeight - 460)),
                  left: Math.max(8, Math.min(r.left - 140, window.innerWidth - 380)),
                  tplId: activeTpl?.id, // capture the target — the list can reshape mid-edit
                });
              }}
              style={{
                display: "flex", alignItems: "center", gap: 4, height: 28, padding: "0 10px",
                fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", borderRadius: 6,
                border: `1.5px solid ${tplScoped || tplAudFor ? "#6366f1" : "#6366f180"}`,
                background: tplScoped ? "#6366f115" : "transparent", color: "#6366f1", cursor: "pointer",
              }}>
              <Users style={{ width: 13, height: 13 }} /> Applies to
            </button>
            <button type="button"
              onClick={() => setShowTplDialog(true)}
              style={{
                display: "flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px",
                fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", borderRadius: 6,
                border: "1.5px solid #8b5cf6", background: templates.length ? "#8b5cf615" : "transparent",
                color: "#8b5cf6", cursor: "pointer",
              }}>
              <LayoutTemplate style={{ width: 13, height: 13 }} />
              Manage stage sets{templates.length ? ` (${templates.length})` : ""}
            </button>
          </div>
          {/* Per-stage "Applies to" popover — the same three-way audience
               picker used for stage sets, scoped to ONE stage. Portal-ed to
               body so it never clips inside the scrollable stage list. */}
          {audFor && createPortal(
            <div ref={audPanelRef} style={{
              position: "fixed", top: audFor.top, left: audFor.left, zIndex: Z.POPUP_CHILD,
              width: 360, maxHeight: 440, overflowY: "auto",
              background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
              borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,0.22)", padding: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "hsl(var(--foreground))" }}>Who does “{audFor.s}” apply to?</div>
                <button type="button" title="Close" style={iconBtn} onClick={() => setAudFor(null)}>
                  <X style={{ width: 13, height: 13, color: "hsl(var(--muted-foreground))" }} />
                </button>
              </div>
              <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginBottom: 8, lineHeight: 1.45 }}>
                Scopes this ONE stage. People outside the audience don't get it — their
                workflow bar and status menus skip straight over it. Field locks and
                “who can act” rules (Set rules) are separate.
              </div>
              <ScopePicker
                mode={audienceOf(audFor.s)?.applyMode ?? "everyone"}
                groupIds={audienceOf(audFor.s)?.groupIds ?? []}
                onChange={(m, ids) => setAudience(audFor.s, m, m === "everyone" ? [] : ids)}
                groups={groups} groupsReady={groupsReady} groupColors={groupColors}
                people={people} />
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>Takes effect when you save the workflow.</span>
                <Button type="button" size="sm" style={{ height: 26, fontSize: 12 }} onClick={() => setAudFor(null)}>Done</Button>
              </div>
            </div>,
            document.body)}
          {/* Set-level "Who does it apply to?" popover — mirrors the control
               under Manage stage sets; edits persist immediately via
               onUpdateTemplateScope. Unsaved lists route to Save As… (the
               audience lives on a NAMED set). */}
          {tplAudFor && createPortal(
            <div ref={tplAudPanelRef} style={{
              position: "fixed", top: tplAudFor.top, left: tplAudFor.left, zIndex: Z.POPUP_CHILD,
              width: 360, maxHeight: 440, overflowY: "auto",
              background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
              borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,0.22)", padding: 12,
            }}>
              {(() => {
                // Render from the set captured when the popover OPENED — a
                // scope edit can clear this module's stage order and reshape
                // the visible list, and the picker must not morph away
                // mid-edit (review finding).
                const tgt = tplAudFor.tplId ? templates.find(t => t.id === tplAudFor.tplId) ?? null : null;
                return (<>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "hsl(var(--foreground))" }}>
                      {tgt ? `Who does “${tgt.name}” apply to?` : "Who does this stage list apply to?"}
                    </div>
                    <button type="button" title="Close" style={iconBtn} onClick={() => setTplAudFor(null)}>
                      <X style={{ width: 13, height: 13, color: "hsl(var(--muted-foreground))" }} />
                    </button>
                  </div>
                  {tgt ? (
                    <>
                      <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginBottom: 8, lineHeight: 1.45 }}>
                        Whose workflow uses these stages — the same setting shown under
                        <b> Manage stage sets</b> and in <b>Save As…</b>. Changes save right away.
                      </div>
                      <ScopePicker
                        key={`tplaud-${tgt.id}-${defGuardNonce}`}
                        mode={tgt.applyMode ?? ((tgt.groupIds ?? []).length ? "groups" : "everyone")}
                        groupIds={tgt.groupIds ?? []}
                        onChange={(m, ids) => guardedScopeChange(tgt, m, ids)}
                        groups={groups} groupsReady={groupsReady} groupColors={groupColors}
                        people={people}
                        everyoneLocked={(() => {
                          if (tplScopeOf(tgt) === "everyone") return undefined;
                          const holder = everyoneTplFor(tgt.module ?? mod, tgt.id);
                          return holder
                            ? <>Only one {MODULE_LABELS[tgt.module ?? mod]} stage set can apply to everyone — &ldquo;<b>{holder.name}</b>&rdquo; already is the everyone default. Change &ldquo;{holder.name}&rdquo; to specific groups first if this set should replace it.</>
                            : undefined;
                        })()} />
                      {tgt.stages.some(st => ruleCountFor(st, tgt.module ?? mod) > 0) && (
                        <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", margin: "8px 0 0", lineHeight: 1.45 }}>
                          "Who does it apply to" = whose workflow uses these stages. Stages with their
                          own limits (like who can act) keep them — see Set rules on each row.
                        </p>
                      )}
                      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                        <Button type="button" size="sm" style={{ height: 26, fontSize: 12 }} onClick={() => setTplAudFor(null)}>Done</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginBottom: 10, lineHeight: 1.5 }}>
                        This stage list isn't saved as a named set yet. <b>Save As…</b> names it —
                        that's where you pick who it applies to.
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <Button type="button" variant="outline" size="sm" style={{ height: 26, fontSize: 12 }} onClick={() => setTplAudFor(null)}>Close</Button>
                        <Button type="button" size="sm" style={{ height: 26, fontSize: 12 }} disabled={baseStages.length < 2}
                          onClick={() => {
                            setTplAudFor(null);
                            setSaName(""); setSaMode("everyone"); setSaGroups([]);
                            setShowSaveAs(true);
                          }}>
                          Save As…
                        </Button>
                      </div>
                    </>
                  )}
                </>);
              })()}
            </div>,
            document.body)}
          {/* Stage rows — vertically scrollable so header buttons always stay visible.
               Rendered in two sections: PATH (ordered, draggable) then OUTCOMES
               (terminal results, no order between them). */}
          <div style={{ display: "flex", flexDirection: "column", maxHeight: 480, overflowY: "auto" }}>
            {(() => {
              const sectionHdr = (label: string, hint: string, topBorder: boolean) => (
                <div key={`hdr-${label}`} style={{
                  padding: "7px 14px", display: "flex", alignItems: "baseline", gap: 7,
                  background: "hsl(var(--muted) / 0.3)",
                  borderBottom: "1px solid hsl(var(--border))",
                  borderTop: topBorder ? "1px solid hsl(var(--border))" : "none",
                }}>
                  <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, color: "hsl(var(--muted-foreground))" }}>{label}</span>
                  <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>— {hint}</span>
                </div>
              );
              const renderRow = (s: string, i: number, pos: number, isOutcome: boolean, isLast: boolean) => (
                <div key={`${s}-${i}`} draggable={!isOutcome && renameIdx !== i}
                  onDragStart={isOutcome ? undefined : () => setDragIdx(i)}
                  onDragOver={isOutcome ? undefined : e => { e.preventDefault(); setOverIdx(i); }}
                  onDragLeave={isOutcome ? undefined : () => setOverIdx(o => (o === i ? null : o))}
                  onDrop={isOutcome ? undefined : e => { e.preventDefault(); if (dragIdx !== null && dragIdx !== i) movePath(dragIdx, pos); setDragIdx(null); setOverIdx(null); }}
                  onDragEnd={isOutcome ? undefined : () => { setDragIdx(null); setOverIdx(null); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "9px 14px",
                    background: overIdx === i && dragIdx !== null && dragIdx !== i
                      ? "hsl(var(--primary) / 0.06)"
                      : drawerIdx === i ? "rgba(139,92,246,0.06)" : "hsl(var(--background))",
                    borderLeft: overIdx === i && dragIdx !== null && dragIdx !== i
                      ? "3px solid hsl(var(--primary))"
                      : drawerIdx === i ? "3px solid #8b5cf6" : "3px solid transparent",
                    borderBottom: isLast ? "none" : "1px solid hsl(var(--border))",
                    opacity: dragIdx === i ? 0.45 : 1,
                    cursor: renameIdx === i || isOutcome ? "default" : "grab",
                    transition: "background .1s",
                  }}>
                  {isOutcome
                    ? <span style={{ width: 15, flexShrink: 0 }} />
                    : <GripVertical style={{ width: 15, height: 15, color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />}
                  <span style={{ ...bubble(i, colorOf(s) ?? (isOutcome ? (wonish(s) ? "#15803d" : "#6b7280") : null)), cursor: "default" }}
                    onMouseEnter={e => showBubble(e, i)} onMouseLeave={hideBubble}>
                    {isOutcome ? (wonish(s) ? <Check style={{ width: 15, height: 15 }} /> : <X style={{ width: 14, height: 14 }} />) : pos + 1}
                  </span>
                  {renameIdx === i ? (
                    <>
                      <Input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitRename(); } if (e.key === "Escape") setRenameIdx(null); }}
                        style={{ height: 30, fontSize: 13, flex: 1 }} />
                      <button type="button" title="Save name" style={iconBtn} onClick={commitRename}><Check style={{ width: 15, height: 15, color: "#10b981" }} /></button>
                    </>
                  ) : (
                    <>
                      {/* Name + inline rename pencil share the flexible slot,
                           so the pencil sits right beside the text */}
                      <span style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: "hsl(var(--foreground))", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
                        <button type="button" disabled={i >= baseLen}
                          title={i >= baseLen ? "Statuses in use on records keep their name — records still carry this value" : "Rename stage"}
                          style={{ width: 24, height: 24, borderRadius: 5, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0, opacity: i >= baseLen ? 0.3 : 0.7, cursor: i >= baseLen ? "not-allowed" : "pointer", color: "hsl(var(--muted-foreground))" }}
                          onClick={() => { setRenameIdx(i); setRenameVal(s); }}><Pencil style={{ width: 12.5, height: 12.5 }} /></button>
                      </span>
                      {stageChips(s, i)}
                      {i >= baseLen && (
                        <span title="This status is already used on records, so it's part of the flow automatically. Reorder or recolor it to adopt it as an official step."
                          style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
                            background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                          in use on records
                        </span>
                      )}
                      {/* Per-stage rules drawer opener — between the pills and the action buttons */}
                      <button type="button" title={`${ruleSummaryFor(s)}\n\nClick to open — mandatory fields, skip conditions, field rules, who can act.`}
                        onClick={() => setDrawerIdx(i)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 9px", flexShrink: 0,
                          fontSize: 11.5, fontWeight: 700, borderRadius: 6, cursor: "pointer",
                          border: `1px solid ${drawerIdx === i ? "#8b5cf6" : "#8b5cf655"}`,
                          background: drawerIdx === i ? "rgba(139,92,246,0.10)" : "transparent", color: "#8b5cf6" }}>
                        <SlidersHorizontal style={{ width: 12, height: 12 }} /> Set rules{ruleCountFor(s) > 0 ? ` (${ruleCountFor(s)})` : ""}
                      </button>
                      {/* Who this ONE stage applies to — the audience normally
                           lives on the whole stage SET (header "Applies to"
                           button / Manage stage sets), so this per-row button
                           is HIDDEN unless the stage already has its own
                           audience — old setups stay visible and clearable
                           (#user request: one obvious place, less clutter). */}
                      {(audienceOf(s) || audFor?.s === s) && (
                        <button type="button" data-audbtn={s} title={audTitle(s)}
                          onClick={e => {
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setAudFor(prev => prev?.s === s ? null : {
                              s,
                              top: Math.min(r.bottom + 6, Math.max(80, window.innerHeight - 460)),
                              left: Math.max(8, Math.min(r.left - 140, window.innerWidth - 380)),
                            });
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 9px", flexShrink: 0,
                            fontSize: 11.5, fontWeight: 700, borderRadius: 6, cursor: "pointer",
                            border: `1px solid ${audienceOf(s) || audFor?.s === s ? "#6366f1" : "#6366f155"}`,
                            background: audienceOf(s) ? "rgba(99,102,241,0.10)" : "transparent", color: "#6366f1" }}>
                          <Users style={{ width: 12, height: 12 }} /> Applies to
                        </button>
                      )}
                    </>
                  )}
                  <label title="Stage color — click to pick a color for this stage's bubble and workflow bar" style={{ padding: 0, overflow: "hidden", position: "relative", cursor: "pointer", display: "flex", alignItems: "center", borderRadius: 6 }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: 6, display: "block",
                      background: colorOf(s) ?? "transparent",
                      border: colorOf(s) ? "2px solid rgba(0,0,0,0.18)" : "2px dashed hsl(var(--border))",
                      boxShadow: colorOf(s) ? `0 0 0 2px ${colorOf(s)}44` : "none",
                      transition: "box-shadow .15s",
                    }} />
                    <input type="color" value={colorOf(s) || "#6366f1"} onChange={e => setColor(s, e.target.value)}
                      style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
                  </label>
                  {colorOf(s) && (
                    <button type="button" title="Reset color" style={{ ...iconBtn, width: 20 }} onClick={() => setColor(s, null)}>
                      <X style={{ width: 11, height: 11, color: "hsl(var(--muted-foreground))" }} />
                    </button>
                  )}
                  {!isOutcome && (
                    <>
                      <button type="button" title="Move up" style={{ ...iconBtn, opacity: pos === 0 ? 0.35 : 1 }} disabled={pos === 0}
                        onClick={() => movePath(i, pos - 1)}><ChevronUp style={{ width: 17, height: 17 }} /></button>
                      <button type="button" title={pos >= pathIdx.length - 1 && hiddenExtras > 0 ? "Expand the list below to move further down" : "Move down"}
                        style={{ ...iconBtn, opacity: pos >= pathIdx.length - 1 ? 0.35 : 1 }} disabled={pos >= pathIdx.length - 1}
                        onClick={() => movePath(i, pos + 1)}><ChevronDown style={{ width: 17, height: 17 }} /></button>
                    </>
                  )}
                  <button type="button"
                    title={i >= baseLen ? "Can't remove — records still use this status; it would reappear here"
                      : stages.length <= 1 ? "A workflow needs at least one stage" : isOutcome ? "Remove outcome" : "Remove stage"}
                    disabled={stages.length <= 1 || i >= baseLen}
                    style={{ ...iconBtn, opacity: stages.length <= 1 || i >= baseLen ? 0.35 : 1, cursor: stages.length <= 1 || i >= baseLen ? "not-allowed" : "pointer" }}
                    onClick={() => edit(list => list.filter((_, j) => j !== i))}>
                    <Trash2 style={{ width: 14, height: 14, color: stages.length <= 1 || i >= baseLen ? "hsl(var(--muted-foreground))" : "#ef4444" }} />
                  </button>
                </div>
              );
              return (
                <>
                  {pathIdx.length > 0 && sectionHdr("PATH", "in order, drag to change", false)}
                  {pathIdx.map((ri, pos) => renderRow(visibleStages[ri], ri, pos, false,
                    outcomeIdx.length === 0 && !extrasCollapsible && pos === pathIdx.length - 1))}
                  {outcomeIdx.length > 0 && sectionHdr("OUTCOMES", "terminal, no order between them", pathIdx.length > 0)}
                  {outcomeIdx.map((ri, pos) => renderRow(visibleStages[ri], ri, pos, true,
                    !extrasCollapsible && pos === outcomeIdx.length - 1))}
                </>
              );
            })()}
            {extrasCollapsible && (
              <button type="button" onClick={() => setShowAllExtras(v => !v)}
                style={{
                  width: "100%", padding: "10px 14px", border: "none",
                  borderTop: "1px solid hsl(var(--border))",
                  background: "hsl(var(--muted) / 0.35)", cursor: "pointer",
                  fontSize: 12.5, fontWeight: 600, color: "hsl(var(--primary))",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>
                {showAllExtras
                  ? <><ChevronUp style={{ width: 14, height: 14 }} /> Hide the {hiddenExtras} extra stage{hiddenExtras === 1 ? "" : "s"}</>
                  : <><ChevronDown style={{ width: 14, height: 14 }} /> {hiddenExtras} more stage{hiddenExtras === 1 ? "" : "s"} already on your records — all {stages.length} are saved together, click to see them</>}
              </button>
            )}
          </div>
          {/* Add-stage footer row */}
          <div style={{ padding: "10px 14px", borderTop: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.25)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Input ref={newStageInputRef} value={newStage} onChange={e => setNewStage(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStage(); } }}
              placeholder="New stage name…" style={{ height: 32, fontSize: 13, maxWidth: 220 }} />
            {(() => {
              const nsOutcome = isTerminalish(newStage);
              return (
                <>
                  <Button variant="outline" size="sm" onClick={addStage} disabled={!newStage.trim() || nsOutcome}
                    title={nsOutcome ? `"${newStage.trim()}" sounds like a final result — use + Add outcome` : "Add as an ordered step in the path"}>
                    <Plus className="w-4 h-4 mr-1" /> Add to path
                  </Button>
                  <Button variant="outline" size="sm" onClick={addStage} disabled={!newStage.trim() || !nsOutcome}
                    title={!newStage.trim() || nsOutcome ? "Add as a terminal outcome" : `Outcomes are final results — use a name like "Won", "Lost", "Cancelled" or "Closed – …"`}>
                    <Plus className="w-4 h-4 mr-1" /> Add outcome
                  </Button>
                </>
              );
            })()}
            {isCustom && (
              <Button variant="ghost" size="sm" onClick={() => { setFreshStart(false); setOrder(null); setLoadedTpl(null); }} style={{ color: "hsl(var(--muted-foreground))" }}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset to standard
              </Button>
            )}
            {/* Save / Save As — right-aligned in the footer row */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexShrink: 0 }}>
              {/* A brand-new set must be NAMED first: Save is hidden until the
                  user stores it via Save As…, then Save makes it live. */}
              {!(freshStart && !activeTpl) && <Button size="sm" style={{ height: 28, fontSize: 12, padding: "0 10px" }}
                disabled={saving || !dirty || (freshStart && baseStages.length > 0 && baseStages.length < 2)}
                onClick={() => {
                  if (baseStages.length >= 2) {
                    // Everyone-scoped sets ARE the default — plain Save refreshes
                    // them here. GROUP-scoped sets are refreshed inside doSave,
                    // which also puts the Everyone default back (#user bug:
                    // saving a group set made it everyone's workflow).
                    if (activeTpl && tplScopeOf(activeTpl) === "everyone")
                      onSaveTemplate(activeTpl.name, mod, baseStages, rules.stageColors?.[mod] ?? {});
                    // The pre-existing (imported) workflow auto-files under a
                    // default name so it's always recoverable from Manage stage
                    // sets. Fresh-start sets are named by the user via Save As.
                    // Skipped when another set already holds Everyone — the
                    // snapshot would show up as a SECOND everyone set.
                    else if (!activeTpl && !freshStart && !everyoneTplFor(mod, tplIdOf("Existing from import")))
                      onSaveTemplate("Existing from import", mod, baseStages, rules.stageColors?.[mod] ?? {});
                  }
                  onSave();
                }}>
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                {dirty ? "Save" : "Saved"}
              </Button>}
              <Button variant="outline" size="sm" style={{ height: 28, fontSize: 12, padding: "0 10px" }}
                disabled={baseStages.length < 2}
                onClick={() => {
                  // Word-style prefill (#user): when the list already matches a
                  // saved set, Save As starts from THAT set's name + audience —
                  // keeping the name re-saves it, typing a new one makes a copy.
                  // Previously this opened blank even while the footer promised
                  // to update the matched set.
                  setSaName(activeTpl?.name ?? "");
                  // No matched set: default the audience to "groups" when some
                  // OTHER set already holds Everyone (single-Everyone rule).
                  setSaMode(activeTpl ? tplScopeOf(activeTpl) : (everyoneTplFor(mod) ? "groups" : "everyone"));
                  setSaGroups(activeTpl ? [...(activeTpl.groupIds ?? [])] : []);
                  setShowSaveAs(true);
                }}>
                Save As…
              </Button>
            </div>
          </div>
        </div>

        {/* helper text below the card */}
        <p style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", margin: "-8px 0 16px", lineHeight: 1.5 }}>
          {freshStart && !activeTpl
            ? <><b>Save As…</b> names and stores your new stage set first — the <b>Save</b> button appears after that to make it live.</>
            : activeTpl && tplScopeOf(activeTpl) !== "everyone"
            ? <><b>Save</b> updates the stage set "{activeTpl.name}" for the people it applies to — the <b>everyone default</b> workflow is not changed. <b>Save As…</b> stores
          the list as a NEW named stage set — saved sets live under <b>Manage stage sets</b> (in the list header).</>
            : <><b>Save</b> stores the {MODULE_LABELS[mod]} stages above{activeTpl ? <> and updates the saved set "{activeTpl.name}"</> : (!freshStart ? <> and keeps them under Manage stage sets as "Existing from import"</> : null)}. <b>Save As…</b> stores
          them as a NEW named stage set — saved sets live under <b>Manage stage sets</b> (in the list header).</>}
        </p>

        {/* Group-scoped exceptions live in Manage stage sets — no need to repeat them here */}


        {/* ── Save As dialog — name + who it applies to */}
        {/* ── Default-scope guard popup (#user) — create-new beats limiting ── */}
        {defGuard && (() => {
          const gt = templates.find(t => t.id === defGuard.tplId);
          if (!gt) return null;
          const gm = gt.module ?? mod;
          const clashId = tplIdOf(defGuardName);
          const nameClash = !!clashId && templates.some(t => t.id === clashId);
          return (
            <DefaultScopeGuardDialog
              noun="stage set"
              defaultName={gt.name}
              pickedLabel={scopeLabel({ applyMode: defGuard.mode, groupIds: defGuard.ids }, groups, people)}
              nameValue={defGuardName}
              onNameChange={setDefGuardName}
              nameError={nameClash ? "A stage set with this name already exists — pick a different one." : null}
              onCreate={() => {
                const name = defGuardName.trim();
                if (!name || nameClash) return;
                // Copy the holder's own stages + colors (the Manage dialog can
                // scope a set from ANOTHER module than the open editor tab).
                onSaveTemplate(name, gm, [...gt.stages], { ...(rules.stageColors?.[gm] ?? {}), ...(gt.stageColors ?? {}) },
                  { applyMode: defGuard.mode, groupIds: defGuard.ids }, { keepDefault: true });
                setDefGuard(null);
                setTplAudFor(null);
                setDefGuardNonce(n => n + 1);
              }}
              onLimit={() => {
                onUpdateTemplateScope(defGuard.tplId, defGuard.mode, defGuard.ids);
                setDefGuard(null);
              }}
              onCancel={() => { setDefGuard(null); setDefGuardNonce(n => n + 1); }}
            />
          );
        })()}
        <Dialog open={showSaveAs} onOpenChange={setShowSaveAs}>
          {/* z-[11000]: reachable from the z-10000 audience popovers and lives
              inside the z-1000 settings overlay — default z-50 renders behind
              both while Radix locks body pointer-events (app looks frozen). */}
          <DialogContent className="z-[11000]" style={{ maxWidth: 480 }}>
            <DialogHeader>
              <DialogTitle style={{ fontSize: 15 }}>Save As — new stage set</DialogTitle>
            </DialogHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Name</div>
                <Input autoFocus value={saName} onChange={e => setSaName(e.target.value)}
                  placeholder="e.g. Fast-track approvals" style={{ height: 32, fontSize: 12.5 }} />
                {(() => {
                  // Same name = same set (ids derive from names): say so up
                  // front instead of silently overwriting on Save.
                  const id = tplIdOf(saName);
                  const hit = id ? templates.find(t => t.id === id) : undefined;
                  if (!hit) return null;
                  const other = hit.module && hit.module !== mod;
                  return (
                    <p style={{ fontSize: 11.5, margin: "5px 0 0", lineHeight: 1.5, color: other ? "#b45309" : "hsl(var(--muted-foreground))" }}>
                      {other
                        ? <>⚠ This name is taken by a {MODULE_LABELS[hit.module as StageRuleModule]} stage set — saving replaces that one. Pick a different name to keep both.</>
                        : <>Saving under this name updates "{hit.name}" — type a new name to make a copy instead.</>}
                    </p>
                  );
                })()}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Who does it apply to?</div>
                <ScopePicker mode={saMode} groupIds={saGroups}
                  onChange={(m, ids) => { setSaMode(m); setSaGroups(ids); }}
                  groups={groups} groupsReady={groupsReady} groupColors={groupColors}
                  people={tenantId !== undefined ? null : people}
                  everyoneLocked={(() => {
                    if (saMode === "everyone") return undefined;
                    const holder = everyoneTplFor(mod, tplIdOf(saName));
                    return holder
                      ? <>Only one {MODULE_LABELS[mod]} stage set can apply to everyone — &ldquo;<b>{holder.name}</b>&rdquo; already is the everyone default. Change &ldquo;{holder.name}&rdquo; first if this set should replace it.</>
                      : undefined;
                  })()} />
                {(() => {
                  // Single-Everyone rule: saving a SECOND everyone set would
                  // make "the default" ambiguous — block and name the holder.
                  const holder = saMode === "everyone" ? everyoneTplFor(mod, tplIdOf(saName)) : null;
                  return holder ? (
                    <p style={{ fontSize: 11.5, margin: "6px 0 0", lineHeight: 1.5, color: "#b91c1c" }}>
                      ⚠ Only one {MODULE_LABELS[mod]} stage set can apply to everyone — &ldquo;<b>{holder.name}</b>&rdquo; already
                      does. Pick specific groups or people for this one, or first change &ldquo;{holder.name}&rdquo; under Manage stage sets.
                    </p>
                  ) : null;
                })()}
                <p style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", margin: "6px 0 0", lineHeight: 1.5 }}>
                  "Everyone" saves a reusable set. Group choices also add it as a workflow the chosen
                  people can put {MODULE_LABELS[mod].toLowerCase()} on — press <b>Save</b> afterwards to make that live.
                </p>
              </div>
              <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 10px", background: "hsl(var(--muted) / 0.25)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "hsl(var(--muted-foreground))", marginBottom: 6 }}>SAVING THESE STAGES</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {baseStages.map((s, i) => (
                    <span key={`${s}-${i}`} title={ruleSummaryFor(s)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px 2px 3px", border: "1px solid hsl(var(--border))", borderRadius: 999, background: "hsl(var(--background))", fontSize: 11.5, fontWeight: 600 }}>
                      <span style={{ ...bubble(i + 1, rules.stageColors?.[mod]?.[s.trim().toLowerCase()]), width: 20, height: 20, fontSize: 10.5 }}>{i + 1}</span>
                      {s}
                      {ruleCountFor(s) > 0 && <span style={{ color: "#8b5cf6", fontWeight: 700 }}>({ruleCountFor(s)})</span>}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button variant="outline" size="sm" onClick={() => setShowSaveAs(false)}>Cancel</Button>
                <Button size="sm" disabled={!saName.trim() || baseStages.length < 1 || (saMode === "everyone" && !!everyoneTplFor(mod, tplIdOf(saName)))}
                  onClick={() => {
                    // Same-people-in-two-sets guard: open the conflict popup
                    // instead of silently letting first-match-wins decide.
                    if (saClashes.length > 0) { setSaClashOpen(true); return; }
                    doSaveTemplate();
                  }}>
                  <Save className="w-3.5 h-3.5 mr-1.5" /> Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Save As audience-clash popup — same people in two stage sets ── */}
        <AudienceClashDialog
          open={saClashOpen && showSaveAs}
          clashes={saClashes}
          nounSingular="stage set"
          resolutionHint="Stage sets are checked top-down; the first one that matches a person decides the workflow they see."
          onRemove={(clash, side) => {
            const entry = side === "winner" ? clash.winner : clash.loser;
            const viaId = (side === "winner" ? clash.winnerViaId : clash.loserViaId).trim().toLowerCase();
            const strip = (ids: string[]) => ids.filter(id => id.trim().toLowerCase() !== viaId);
            if (entry.key === NEW_TPL_KEY) {
              setSaGroups(g => strip(g));
            } else {
              const t = templates.find(x => x.id === entry.key);
              if (t) onUpdateTemplateScope(t.id, t.applyMode ?? "groups", strip(t.groupIds ?? []));
            }
          }}
          onContinue={doSaveTemplate}
          onCancel={() => setSaClashOpen(false)}
          removalNote="Removing from an EXISTING stage set applies immediately; removing from the new one just narrows the audience you're picking here."
        />


        {/* ── Manage stage sets dialog — colored stage chips + who each set applies to */}
        <Dialog open={showTplDialog} onOpenChange={v => { setShowTplDialog(v); if (!v) setTplQ(""); }}>
          {/* z-[11000]: see Save As… dialog comment above — same freeze trap. */}
          <DialogContent className="z-[11000]" style={{ maxWidth: 620, maxHeight: "82vh", overflowY: "auto" }}>
            <DialogHeader>
              <DialogTitle style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15 }}>
                <LayoutTemplate style={{ width: 15, height: 15, color: "#8b5cf6" }} />
                Manage stage sets
              </DialogTitle>
            </DialogHeader>
            <p style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", margin: "0 0 14px", lineHeight: 1.55 }}>
              Stage sets saved with <strong>Save As…</strong> live here. Applying one replaces the
              <strong> {MODULE_LABELS[mod]}</strong> stage list shown — press Save afterwards to make it real.
            </p>
            {/* Single-Everyone rule: legacy data can hold several everyone-
                 scoped sets per workflow — surface them up top so the admin
                 knows which extras to re-scope. New ones can't be created. */}
            {(() => {
              const dupes = STAGE_RULE_MODULES.map(m => ({
                m, l: templates.filter(t => (t.module ?? m) === m && tplScopeOf(t) === "everyone"),
              })).filter(x => x.l.length >= 2);
              if (!dupes.length) return null;
              return (
                <div style={{ margin: "0 0 12px", padding: "9px 12px", borderRadius: 8, background: "rgba(217,119,6,0.07)", border: "1px solid rgba(217,119,6,0.35)", fontSize: 12, lineHeight: 1.55, color: "hsl(var(--foreground))", display: "flex", flexDirection: "column", gap: 4 }}>
                  {dupes.map(({ m, l }) => (
                    <div key={m}>⚠ <b>{MODULE_LABELS[m]}</b>: {l.length} sets apply to everyone ({l.map(t => `"${t.name}"`).join(", ")}) — only one can. Open the extras below and pick specific groups or people for them.</div>
                  ))}
                </div>
              );
            })()}

            {/* ── Search — by set name, audience, or group member (#user request) */}
            {templatesReady && templates.length > 0 && (
              <div style={{ position: "relative", margin: "0 0 12px" }}>
                <Search style={{ width: 13, height: 13, position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))", pointerEvents: "none" }} />
                <Input value={tplQ} onChange={e => setTplQ(e.target.value)}
                  placeholder="Search sets by name, group, or person…"
                  aria-label="Search stage sets by set name, group name, or person name"
                  style={{ height: 32, fontSize: 12.5, paddingLeft: 30 }} />
              </div>
            )}
            {templatesReady && templates.length > 0 && tplQNorm !== "" && visibleTpls.length === 0 && (
              <div style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", paddingBottom: 8 }}>
                No saved sets match "{tplQ.trim()}" — the search covers set names, groups, people, and group members.
              </div>
            )}

            {!templatesReady && (
              <div style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", paddingBottom: 8 }}>Loading stage sets…</div>
            )}
            {/* ── Pinned entries (Current default first, then Existing from import)
                 Both have a pencil that loads stages into the main editor. */}
            {(() => {
              const defStages = custom ?? derivedOrder[mod];
              const impStages = imported?.stages?.[mod] ?? [];
              const norm = (a: string[]) => a.map((s) => s.trim().toLowerCase()).join("\u0000");
              const sameAsDefault = impStages.length > 0 && norm(impStages) === norm(defStages);
              // Pinned entries join the search by their card titles.
              const pinnedMatches = (t: string) => !tplQNorm || t.toLowerCase().includes(tplQNorm);

              const loadAndClose = (stagesToLoad: string[], title: string) => {
                setOrder([...stagesToLoad]);
                setLoadedTpl(null); // pinned cards are the default/import — not a saved group set
                setShowTplDialog(false);
                toast({ title: `Loaded "${title}" into the ${MODULE_LABELS[mod]} editor`, description: "Make changes above, then press Save." });
              };

              const pinnedCard = (title: string, badge: string, desc: React.ReactNode, stagesToShow: string[]) => (
                <div key={title} style={{ padding: "10px 12px", border: "1px dashed hsl(var(--border))", borderRadius: 8, marginBottom: 6, background: "hsl(var(--muted) / 0.15)" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>{title}</div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", padding: "2px 7px", borderRadius: 999, background: badge.includes("Default") ? "rgba(16,185,129,0.12)" : "hsl(var(--muted))", border: badge.includes("Default") ? "1px solid rgba(16,185,129,0.45)" : "1px solid transparent", color: badge.includes("Default") ? "#047857" : "hsl(var(--muted-foreground))" }}>{badge}</span>
                    </div>
                    <button type="button" title={`Load "${title}" into the editor to make changes`}
                      onClick={() => loadAndClose(stagesToShow, title)}
                      style={{ background: "none", border: "1px solid hsl(var(--border))", borderRadius: 6, cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: 11.5, fontWeight: 600 }}>
                      <Pencil style={{ width: 11, height: 11 }} /> Edit
                    </button>
                  </div>
                  <p style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", margin: "6px 0 0", lineHeight: 1.5 }}>{desc}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }} title={stagesToShow.join(" → ")}>
                    {stagesToShow.map((s, i) => (
                      <span key={`${s}-${i}`} title={ruleSummaryFor(s)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px 2px 3px", border: "1px solid hsl(var(--border))", borderRadius: 999, background: "hsl(var(--background))", fontSize: 11.5, fontWeight: 600 }}>
                        <span style={{ ...bubble(i + 1, rules.stageColors?.[mod]?.[s.trim().toLowerCase()]), width: 20, height: 20, fontSize: 10.5 }}>{i + 1}</span>
                        {s}
                        {ruleCountFor(s) > 0 && <span style={{ color: "#8b5cf6", fontWeight: 700 }}>({ruleCountFor(s)})</span>}
                      </span>
                    ))}
                  </div>
                </div>
              );

              return (
                <>
                  {/* Current default always first */}
                  {defStages.length >= 2 && pinnedMatches("Current default") && pinnedCard(
                    "Current default", sameAsDefault ? "Imported · Default" : "Default",
                    sameAsDefault
                      ? <>The {MODULE_LABELS[mod]} statuses found in your imported records — currently also the default for <b>everyone</b> not covered by a group stage set. Click <b>Edit</b> to load into the editor above.</>
                      : <>Applies to <b>everyone</b> not covered by a group stage set below{custom ? " (as saved above)" : ""}. Click <b>Edit</b> to load into the editor above.</>,
                    defStages,
                  )}
                  {/* Existing from import — only when it differs from the default */}
                  {impStages.length > 0 && !sameAsDefault && pinnedMatches("Existing from import") && pinnedCard(
                    "Existing from import", "Imported",
                    <>The {MODULE_LABELS[mod]} statuses found in your imported records. The default workflow has since been changed — click <b>Edit</b> to restore this order into the editor.</>,
                    impStages,
                  )}
                </>
              );
            })()}
            {templatesReady && templates.length === 0 && (
              <div style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", paddingBottom: 8 }}>
                No stage sets saved yet — use <b>Save As…</b> under the stage list to create one.
              </div>
            )}
            {templatesReady && visibleTpls.map(tpl => (
              <div key={tpl.id} style={{ padding: "10px 12px", border: "1px solid hsl(var(--border))", borderRadius: 8, marginBottom: 6, background: "hsl(var(--muted) / 0.25)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>{tpl.name}</div>
                    {/* Which workflow this set belongs to — without it, sets from
                         different workflows look like one competing list and the
                         absent overlap warning reads as a bug. */}
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, border: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
                      {tpl.module ? `${MODULE_LABELS[tpl.module]} workflow` : "Not tied to a workflow"}
                    </span>
                    {/* Single-Everyone rule: the everyone-scoped set IS the
                         default — badge it green. Legacy data can hold several;
                         the extras get an amber flag instead of a second badge. */}
                    {(() => {
                      if (tplScopeOf(tpl) !== "everyone") return null;
                      const m2 = tpl.module ?? mod;
                      const first = templates.find(t => (t.module ?? m2) === m2 && tplScopeOf(t) === "everyone");
                      return first?.id === tpl.id ? (
                        <span title={`Everyone in ${MODULE_LABELS[m2]} gets this workflow unless a group stage set covers them — only one set can be the everyone default.`}
                          style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 8px", borderRadius: 999, background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.45)", color: "#047857", whiteSpace: "nowrap", letterSpacing: 0.4, textTransform: "uppercase" }}>
                          Default · Everyone
                        </span>
                      ) : (
                        <span title="Only one set per workflow can apply to everyone — open this one and pick specific groups or people."
                          style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 8px", borderRadius: 999, background: "rgba(217,119,6,0.10)", border: "1px solid rgba(217,119,6,0.4)", color: "#b45309", whiteSpace: "nowrap", letterSpacing: 0.4, textTransform: "uppercase" }}>
                          Also everyone
                        </span>
                      );
                    })()}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    {/* Make default — promotes this set to the Everyone scope.
                         Fires through the guarded scope-change so the existing
                         single-Everyone rule and create-copy dialog apply. */}
                    {tplScopeOf(tpl) !== "everyone" && (
                      <button type="button"
                        title={everyoneTplFor(tpl.module ?? mod, tpl.id)
                          ? `Make "${tpl.name}" the default — will remove everyone-scope from the current default first`
                          : `Make "${tpl.name}" the default — applies to everyone in ${MODULE_LABELS[tpl.module ?? mod]}`}
                        onClick={() => guardedScopeChange(tpl, "everyone", [])}
                        style={{ background: "none", border: "1px solid hsl(var(--primary) / 0.4)", borderRadius: 6, cursor: "pointer", color: "hsl(var(--primary))", display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: 11.5, fontWeight: 600 }}>
                        <Check style={{ width: 11, height: 11 }} /> Make default
                      </button>
                    )}
                    <button type="button" title={`Load "${tpl.name}" into the editor to make changes`}
                      onClick={() => {
                        // Load into the set's OWN workflow and jump to that
                        // tab — loading an Opportunities set into whichever
                        // tab happened to be open either corrupted that
                        // tab's list or looked like "Edit did nothing".
                        const target = tpl.module ?? mod;
                        if (target !== mod) { setMod(target); setRenameIdx(null); setNewStage(""); setShowAllExtras(false); setExpandedTpl(null); setDrawerIdx(null); }
                        setOrder([...tpl.stages], target);
                        // Pin the editor to THIS set — content edits keep saving
                        // into it (single-Everyone rule) instead of the default.
                        setLoadedTpl({ id: tpl.id, mod: target });
                        setShowTplDialog(false);
                        toast({ title: `Loaded "${tpl.name}" into the ${MODULE_LABELS[target]} editor`, description: "Make changes above, then press Save." });
                      }}
                      style={{ background: "none", border: "1px solid hsl(var(--border))", borderRadius: 6, cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: 11.5, fontWeight: 600 }}>
                      <Pencil style={{ width: 11, height: 11 }} /> Edit
                    </button>
                    <button type="button" title="Delete this stage set" onClick={() => onDeleteTemplate(tpl.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex", padding: 4, borderRadius: 4 }}>
                      <Trash2 style={{ width: 13, height: 13 }} />
                    </button>
                  </div>
                </div>
                {/* Who does it apply to? — same three options as everywhere else,
                     editable right here instead of a fixed label. */}
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: 0.4 }}>Who does it apply to?</div>
                  <ScopePicker
                    key={`mg-${tpl.id}-${defGuardNonce}`}
                    mode={tplScopeOf(tpl)}
                    groupIds={tpl.groupIds ?? []}
                    onChange={(m, ids) => guardedScopeChange(tpl, m, ids)}
                    groups={groups} groupsReady={groupsReady} groupColors={groupColors}
                    people={people}
                    everyoneLocked={(() => {
                      if (tplScopeOf(tpl) === "everyone") return undefined;
                      const holder = everyoneTplFor(tpl.module ?? mod, tpl.id);
                      return holder
                        ? <>Only one {MODULE_LABELS[tpl.module ?? mod]} stage set can apply to everyone — &ldquo;<b>{holder.name}</b>&rdquo; already is the everyone default. Change &ldquo;{holder.name}&rdquo; to specific groups first if this set should replace it.</>
                        : undefined;
                    })()} />
                  {/* "Everyone" here ≠ no limits: per-stage rules still apply.
                       Bridge the two so the audience label never reads as a
                       contradiction of a one-person "who can act" rule. */}
                  {tpl.stages.some(st => ruleCountFor(st, tpl.module ?? mod) > 0) && (
                    <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", margin: "5px 0 0", lineHeight: 1.45 }}>
                      "Who does it apply to" = whose workflow uses these stages. Stages with their own
                      limits (like who can act) show a purple count below — hover one for the details.
                    </p>
                  )}
                </div>
                {/* Overlap warnings — same person/group in two same-module sets.
                     Inline text (not a popup) because scope edits here persist
                     on every picker click — a dialog per click would be
                     obnoxious. The pickers right above are the fix. */}
                {(() => {
                  const mine = manageClashes.filter(x => x.c.winner.key === tpl.id || x.c.loser.key === tpl.id);
                  const conflicts = mine.filter(x => x.kind === "conflict").map(x => x.c);
                  const crossNotes = mine.filter(x => x.kind !== "conflict");
                  if (mine.length === 0) return null;
                  const subjectOf = (c: (typeof conflicts)[number], via: string | null) =>
                    c.subjectKind === "group"
                      ? <>The whole group <b>{c.subjectName}</b></>
                      : c.subjectKind === "org"
                        ? <>The org unit <b>{c.subjectName}</b></>
                        : <><b>{c.subjectName}</b>{via ? <> (via group &ldquo;{via}&rdquo;)</> : null}</>;
                  return (
                    <>
                      {conflicts.length > 0 && (
                        <div style={{ marginTop: 6, padding: "7px 10px", borderRadius: 6, background: "rgba(217,119,6,0.07)", border: "1px solid rgba(217,119,6,0.3)", display: "flex", flexDirection: "column", gap: 7 }}>
                          {conflicts.slice(0, 4).map((c, ci) => {
                            const isWinner = c.winner.key === tpl.id;
                            const via = isWinner ? c.winnerViaName : c.loserViaName;
                            // "Keep …" buttons: the admin picks the set that
                            // should apply — keeping one side removes the
                            // subject's coverage from the OTHER side. Scope
                            // edits on these cards persist immediately (same
                            // path as the pickers above).
                            const stripFromTpl = (side: "winner" | "loser") => {
                              const entry = side === "winner" ? c.winner : c.loser;
                              const viaId = (side === "winner" ? c.winnerViaId : c.loserViaId).trim().toLowerCase();
                              const t = templates.find(x => x.id === entry.key);
                              if (!t) return;
                              onUpdateTemplateScope(t.id, t.applyMode ?? "groups", (t.groupIds ?? []).filter(id => id.trim().toLowerCase() !== viaId));
                            };
                            const stripTip = (side: "winner" | "loser") => {
                              const entry = side === "winner" ? c.winner : c.loser;
                              const viaName = side === "winner" ? c.winnerViaName : c.loserViaName;
                              const what = c.subjectKind === "group"
                                ? `the whole group \u201C${c.subjectName}\u201D`
                                : c.subjectKind === "org"
                                  ? `the org unit \u201C${c.subjectName}\u201D`
                                  : viaName
                                    ? `the whole group \u201C${viaName}\u201D (which covers ${c.subjectName})`
                                    : c.subjectName;
                              return `Removes ${what} from \u201C${entry.label}\u201D. Applies immediately.`;
                            };
                            const chooseBtn: React.CSSProperties = {
                              height: 22, padding: "0 9px", fontSize: 11, fontWeight: 700, borderRadius: 6,
                              border: "1px solid rgba(217,119,6,0.45)", background: "hsl(var(--background))",
                              color: "#92400e", cursor: "pointer", whiteSpace: "nowrap",
                            };
                            return (
                              <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <span style={{ fontSize: 11.5, color: "#92400e", lineHeight: 1.5 }}>
                                  ⚠ {subjectOf(c, via)}
                                  {" "}is in both &ldquo;{c.winner.label}&rdquo; and &ldquo;{c.loser.label}&rdquo; — right now <b>&ldquo;{c.winner.label}&rdquo;</b> wins for them (higher in the list).
                                </span>
                                <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 11, color: "#92400e", fontWeight: 700 }}>Which should apply to them?</span>
                                  <button type="button" title={stripTip("loser")} style={chooseBtn}
                                    onClick={() => stripFromTpl("loser")}>
                                    Keep &ldquo;{c.winner.label}&rdquo;
                                  </button>
                                  <button type="button" title={stripTip("winner")} style={chooseBtn}
                                    onClick={() => stripFromTpl("winner")}>
                                    Keep &ldquo;{c.loser.label}&rdquo;
                                  </button>
                                </span>
                              </div>
                            );
                          })}
                          {conflicts.length > 4 && (
                            <span style={{ fontSize: 11, color: "#92400e" }}>…and {conflicts.length - 4} more overlap{conflicts.length - 4 === 1 ? "" : "s"}.</span>
                          )}
                        </div>
                      )}
                      {crossNotes.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                          {crossNotes.slice(0, 3).map((x, ci) => {
                            const isWinner = x.c.winner.key === tpl.id;
                            const other = isWinner ? x.c.loser : x.c.winner;
                            const otherMod = isWinner ? x.loserMod : x.winnerMod;
                            const via = isWinner ? x.c.winnerViaName : x.c.loserViaName;
                            return (
                              <span key={ci} style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>
                                ⓘ {subjectOf(x.c, via)}
                                {" "}is also in &ldquo;{other.label}&rdquo;{x.kind === "cross"
                                  ? <> — that&apos;s the {otherMod ? MODULE_LABELS[otherMod] : "other"} workflow, so both apply (no conflict).</>
                                  : <> — a set that isn&apos;t tied to a workflow never applies automatically, so there&apos;s no conflict.</>}
                              </span>
                            );
                          })}
                          {crossNotes.length > 3 && (
                            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>…and {crossNotes.length - 3} more.</span>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
                {/* Colored numbered chips — same colors the record pages' stage bars use */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }} title={tpl.stages.join(" → ")}>
                  {tpl.stages.map((s, i) => (
                    <span key={`${s}-${i}`} title={ruleSummaryFor(s, tpl.module ?? mod)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px 2px 3px", border: "1px solid hsl(var(--border))", borderRadius: 999, background: "hsl(var(--background))", fontSize: 11.5, fontWeight: 600 }}>
                      <span style={{ ...bubble(i + 1, tpl.stageColors?.[s.trim().toLowerCase()]), width: 20, height: 20, fontSize: 10.5 }}>{i + 1}</span>
                      {s}
                      {ruleCountFor(s, tpl.module ?? mod) > 0 && <span style={{ color: "#8b5cf6", fontWeight: 700 }}>({ruleCountFor(s, tpl.module ?? mod)})</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </DialogContent>
        </Dialog>

        {/* ── Button names — fully isolated bordered card */}
        <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 10 }}>
          <div style={{ padding: "10px 16px", background: "hsl(var(--muted) / 0.45)", borderBottom: "1px solid hsl(var(--border))", display: "flex", alignItems: "center", gap: 6, borderRadius: "9px 9px 0 0" }}>
            <Pencil style={{ width: 13, height: 13, color: "hsl(var(--muted-foreground))" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--foreground))" }}>Button names on record pages</span>
          </div>
          <div style={{ padding: "14px 16px" }}>
            <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: "0 0 14px" }}>
              Rename the workflow buttons everyone sees on {MODULE_LABELS[mod].toLowerCase()} — leave blank to keep the standard name.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {([
                { key: "advance" as const, std: "Advance", hint: "moves the record to the next stage" },
                { key: "back" as const, std: "Go Back", hint: "moves it one stage back" },
                ...(mod === "PMM" ? [] : [
                  { key: "lost" as const, std: "Lost", hint: "marks it as lost" },
                  { key: "cancel" as const, std: "Cancel", hint: "closes it without winning" },
                ]),
              ]).map(b => (
                <div key={b.key} style={{
                  display: "flex", flexDirection: "column", gap: 4, minWidth: 150,
                  padding: "10px 12px", border: "1px solid hsl(var(--border))",
                  borderRadius: 8, background: "hsl(var(--background))",
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: 0.5 }} title={b.hint}>
                    "{b.std}" button
                  </span>
                  <Input value={labels[b.key] ?? ""} maxLength={24}
                    onChange={e => setLabel(b.key, e.target.value)}
                    placeholder={b.std} style={{ height: 30, fontSize: 13 }} />
                  <span style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))" }}>{b.hint}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <Button onClick={onSave} disabled={saving || !dirty} size="sm">
                {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                {dirty ? "Save changes" : "Saved"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stage-bubble hover/pinned popup ─────────────────────────────────
           Appears on hover of any numbered circle in the stage bar or the
           drag-list; stays pinned when a chip is clicked.
           Fixed-positioned so it escapes overflow:hidden containers.
           pointer-events:auto so the user can move the mouse onto the popup
           without it immediately dismissing (keepBubble extends the hover). */}
      {(pinnedBubble !== null || hoveredBubble !== null) && (() => {
        const activeBubble = pinnedBubble ?? hoveredBubble!;
        const isPinned = pinnedBubble !== null;
        if (stages[activeBubble.idx] === undefined) return null;
        const s = stages[activeBubble.idx];
        const { lockRules, skipRules, whoRules, formRules, reqRules } = detailFor(s);
        const totalLockFields = lockRules.reduce((n, r) => n + r.fields.length, 0);
        const whoCount = whoRules.reduce((n, p) =>
          n + p.actionUserIds.length + p.actionGroupIds.length + p.editorUserIds.length + p.editorGroupIds.length, 0);
        const hasAny = lockRules.length || skipRules.length || whoCount > 0 || formRules.length || reqRules.length;
        /** "A, B and C" — the popup speaks in full sentences (same voice as
             the drawer's green readback), so lists need a natural join. */
        const listJoin = (arr: string[]) => arr.length <= 1 ? (arr[0] ?? "") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
        // Keep inside viewport horizontally
        const vpW = typeof window !== "undefined" ? window.innerWidth : 1200;
        const popW = 300;
        const rawX = activeBubble.x - popW / 2;
        const clampedX = Math.max(8, Math.min(rawX, vpW - popW - 8));
        return (
          <div
            onMouseEnter={keepBubble}
            onMouseLeave={isPinned ? undefined : hideBubble}
            style={{
              position: "fixed",
              left: clampedX,
              top: activeBubble.y,
              width: popW,
              zIndex: Z.POPUP,
              background: "hsl(var(--background))",
              border: isPinned ? "1px solid hsl(var(--primary) / 0.5)" : "1px solid hsl(var(--border))",
              borderRadius: 10,
              padding: "12px 14px",
              boxShadow: isPinned ? "0 8px 32px rgba(0,0,0,0.22)" : "0 8px 28px rgba(0,0,0,0.14)",
              pointerEvents: "auto",
            }}
          >
            {/* Stage title + close button when pinned */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ ...bubble(activeBubble.idx, colorOf(s) ?? (isTerminalish(s) ? (wonish(s) ? "#15803d" : "#6b7280") : null)), width: 22, height: 22, fontSize: 11, flexShrink: 0 }}>
                {isTerminalish(s)
                  ? (wonish(s) ? <Check style={{ width: 12, height: 12 }} /> : <X style={{ width: 11, height: 11 }} />)
                  : (pathNum.get(activeBubble.idx) ?? activeBubble.idx + 1)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--foreground))", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
              {isPinned && (
                <button type="button" onClick={() => setPinnedBubble(null)}
                  style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}>
                  <X style={{ width: 12, height: 12 }} />
                </button>
              )}
            </div>

            {/* Likely typo hint */}
            {typoFor(s) && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 5, marginBottom: 9 }}>
                <AlertTriangle style={{ width: 12, height: 12, color: "#d97706", flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 700, color: "#d97706" }}>Likely typo</span> — this name looks
                  close to "<span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{typoFor(s)}</span>".
                  Use the pencil on the row to rename it if it's a misspelling.
                </span>
              </div>
            )}

            {!hasAny && !typoFor(s) && (
              <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: 0 }}>
                No rules configured for this stage.
              </p>
            )}

            {/* Mandatory fields — same sentence the drawer's readback uses */}
            {reqRules.length > 0 && (() => {
              const names = [...new Set(reqRules.flatMap(r => r.fields.map(f => friendlyFieldLabel(f, mod))))];
              return (
                <div style={{ marginBottom: 9 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                    <Check style={{ width: 12, height: 12, color: "#e11d48" }} />
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "#e11d48" }}>
                      {names.length} field{names.length !== 1 ? "s" : ""} required
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", paddingLeft: 17, lineHeight: 1.7 }}>
                    To move a record to "{s}", <span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{listJoin(names)}</span> must be filled in first.
                  </div>
                </div>
              );
            })()}

            {/* Field locks */}
            {lockRules.length > 0 && (
              <div style={{ marginBottom: 9 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                  <Lock style={{ width: 12, height: 12, color: "#0ea5e9" }} />
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0ea5e9" }}>
                    {totalLockFields} field{totalLockFields !== 1 ? "s" : ""} locked
                  </span>
                </div>
                {lockRules.map((r, ri) => {
                  const names = listJoin(r.fields.map(f => friendlyFieldLabel(f, mod)));
                  return (
                    <div key={ri} style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", paddingLeft: 17, lineHeight: 1.7 }}>
                      {r.direction === "from"
                        ? <>Once a record is in "{s}", <span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{names}</span> can&apos;t be changed any more.</>
                        : <><span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{names}</span> can&apos;t be changed until a record reaches "{s}".</>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Skip rules */}
            {skipRules.length > 0 && (
              <div style={{ marginBottom: 9 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                  <SkipForward style={{ width: 12, height: 12, color: "#f59e0b" }} />
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#f59e0b" }}>
                    Skippable
                  </span>
                </div>
                {skipRules.map((r, ri) => {
                  const fieldLabel = SKIP_FIELD_SUGGESTIONS.find(x => x.value === r.field)?.label ?? r.field;
                  return (
                    <div key={ri} style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", paddingLeft: 17, lineHeight: 1.7 }}>
                      Records where <span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{fieldLabel}</span> is{" "}
                      <span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>"{r.value}"</span> skip "{s}" and go straight to the next stage.
                    </div>
                  );
                })}
              </div>
            )}

            {/* Who can act */}
            {whoCount > 0 && (
              <div style={{ marginBottom: 9 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                  <UserCheck style={{ width: 12, height: 12, color: "#10b981" }} />
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#10b981" }}>
                    {whoCount} can act
                  </span>
                </div>
                {whoRules.map((r, ri) => {
                  // Same case-insensitive person lookup as the drawer: saved
                  // ids are lowercased server-side, roster GUIDs are not.
                  const personName = (id: string) =>
                    people?.find(pp => pp.value.toLowerCase() === id.toLowerCase())?.label ?? id;
                  const owners = [...r.actionGroupIds.map(id => groupName(id)), ...r.actionUserIds.map(personName)];
                  const editors = [...r.editorGroupIds.map(id => groupName(id)), ...r.editorUserIds.map(personName)];
                  return (
                    <div key={ri} style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", paddingLeft: 17, lineHeight: 1.7 }}>
                      {owners.length > 0 && (
                        <div><span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{listJoin(owners)}</span> can move records forward from "{s}" and edit them.</div>
                      )}
                      {editors.length > 0 && (
                        <div><span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{listJoin(editors)}</span> can edit records here but can&apos;t move them forward.</div>
                      )}
                      <div style={{ fontStyle: "italic" }}>
                        Everyone else {r.othersMode === "normal" ? "keeps their normal access." : "can only view records in this stage."}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Form layout */}
            {formRules.length > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                  <ClipboardList style={{ width: 12, height: 12, color: "#8b5cf6" }} />
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#8b5cf6" }}>Custom form</span>
                </div>
                {(() => {
                  const hid = [...new Set(formRules.flatMap(r => r.hidden.map(f => friendlyFieldLabel(f, mod))))];
                  const ro = [...new Set(formRules.flatMap(r => r.readOnly.map(f => friendlyFieldLabel(f, mod))))];
                  return (
                    <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", paddingLeft: 17, lineHeight: 1.7 }}>
                      {hid.length > 0 && <div>While a record is in "{s}", <span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{listJoin(hid)}</span> {hid.length > 1 ? "don't" : "doesn't"} show on the form.</div>}
                      {ro.length > 0 && <div><span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{listJoin(ro)}</span> can be seen here but not edited.</div>}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Per-stage "Set rules" drawer — edits the SAME draft docs as the tabs */}
      {drawerIdx !== null && visibleStages[drawerIdx] !== undefined && (() => {
        const ds = visibleStages[drawerIdx];
        const isOut = isTerminalish(ds);
        const rc = recCounts[mod];
        return (
          <StageRuleDrawer
            mod={mod}
            stage={ds}
            eyebrow={isOut
              ? "Outcome"
              : `Stage ${pathNum.get(drawerIdx) ?? drawerIdx + 1} of ${pathIdx.length}`}
            color={colorOf(ds) ?? (isOut ? (wonish(ds) ? "#15803d" : "#6b7280") : null)}
            canPrev={drawerIdx > 0}
            canNext={drawerIdx < visibleCount - 1}
            onStep={stepDrawer}
            onClose={() => setDrawerIdx(null)}
            gotoStage={gotoStage}
            rules={rules} setRules={setRules}
            perms={perms} setPerms={setPerms}
            order={stages}
            groups={groups} groupsReady={groupsReady} groupColors={groupColors} people={people}
            memberNamesOf={memberNamesOf}
            statusOpts={statusOpts[mod]}
            typeNames={(rules.workflowTypes?.[mod] ?? []).map(wtName)}
            onGoTypes={onGoTypes}
            recordCount={rc == null ? null : (rc[ds.trim().toLowerCase()] ?? 0)}
            onSave={onSave} saving={saving} dirty={dirty}
          />
        );
      })()}
    </div>
  );
}

/* ═════════════════ Per-stage "Set rules" drawer ═════════════════
   One data model, two editors: everything here is a filtered VIEW over the
   page's draft docs (rules + perms). Edits go through the SAME setRules /
   setPerms the six tabs use, and persist through the page's existing Save —
   no separate endpoints, no duplicate state, tabs and drawer never disagree. */
function StageRuleDrawer({
  mod, stage, eyebrow, color, phaseColor, onPhaseColorChange,
  canPrev, canNext, onStep, onClose, gotoStage,
  rules, setRules, perms, setPerms, order,
  groups, groupsReady, groupColors, people, memberNamesOf,
  statusOpts, typeNames, onGoTypes, recordCount,
  onSave, saving, dirty, recordScope,
}: {
  mod: StageRuleModule;
  stage: string;
  eyebrow: string;
  color: string | null;
  /** Per-phase color override for this stage (hex). Shown as a live swatch in
   *  the drawer header and editable when onPhaseColorChange is provided. */
  phaseColor?: string | null;
  /** Called when the admin picks or clears the phase color from this drawer. */
  onPhaseColorChange?: (hex: string | null) => void;
  canPrev: boolean;
  canNext: boolean;
  onStep: (dir: -1 | 1) => void;
  onClose: () => void;
  /** Move the drawer to another stage by name (inherited-rule links). */
  gotoStage: (name: string) => void;
  rules: StageRules;
  setRules: React.Dispatch<React.SetStateAction<StageRules>>;
  perms: StagePermRule[];
  setPerms: React.Dispatch<React.SetStateAction<StagePermRule[]>>;
  /** FULL evaluation order (path + outcomes + in-use extras) for lock ranges. */
  order: string[];
  groups: UserGroup[];
  groupsReady: boolean;
  groupColors: Map<string, string>;
  people: { value: string; label: string }[] | null;
  /** Roster-name resolver from the owning card — null = count-only hovers. */
  memberNamesOf: (ids: string[]) => string[] | null;
  statusOpts: string[];
  typeNames: string[];
  onGoTypes?: () => void;
  /** Records sitting on this stage right now — null when unknown. */
  recordCount: number | null;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  /** Set = the drawer edits ONE record's rules (record-page host): scope
      banner on top, "Who can act" hidden (stage permissions stay
      company-wide), reset affordance when the record already has its own
      fork ("record" source). */
  recordScope?: { label: string; source: "record" | "tenant"; onReset: () => void; resetting: boolean } | null;
}) {
  const k = (s: string) => s.trim().toLowerCase();
  const sk = k(stage);
  const modLabel = MODULE_LABELS[mod];
  // First stage: records are CREATED here, not moved into it, so "required
  // before entering" (section 1) is meaningless — grey it out.
  const isFirstStage = order.length > 0 && k(order[0]) === sk;
  // User-friendly title: "Stage 1: New" instead of a bare stage name.
  const posMatch = /^Stage (\d+)/i.exec(eyebrow);
  const titleText = posMatch ? `Stage ${posMatch[1]}: ${stage}` : stage;

  // Escape closes; body scroll locks while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Add-row inputs reset when the drawer steps to another stage.
  const [condField, setCondField] = useState("");
  const [condValue, setCondValue] = useState("");
  // "Other (type a value)…" escape hatch: when the value dropdown is showing
  // but the needed value isn't in the tenant's data / org catalog (e.g. a
  // legacy denormalized name), the admin can still type it freely.
  const [condOther, setCondOther] = useState(false);
  // Record-mode reset ("Use company rules instead") asks for a second click —
  // it deletes the project's own rules, which isn't undoable from here.
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { setConfirmReset(false); }, [stage]);
  const [addField, setAddField] = useState("");
  const [addState, setAddState] = useState<"locked" | "readOnly" | "hidden">("locked");
  const [addScope, setAddScope] = useState<"from" | "until" | "at">("from");
  const [whoPick, setWhoPick] = useState("");
  const [whoTier, setWhoTier] = useState<"owner" | "editor">("owner");
  const [whoOpen, setWhoOpen] = useState(false);
  const [whoQ, setWhoQ] = useState("");
  // Rule 5 "Who can edit" — a restricted mode chosen with nobody picked yet
  // lives only in UI state: writing an empty viewOnly rule into the draft
  // would freeze the stage for everyone (and the pre-save gate blocks empty
  // rules anyway). The perms doc is only touched once someone is picked.
  const [editWhoDraft, setEditWhoDraft] = useState<"people" | "groups" | null>(null);
  const whoAddRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!whoOpen) return;
    const onDown = (e: MouseEvent) => { if (whoAddRef.current && !whoAddRef.current.contains(e.target as Node)) setWhoOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setWhoOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [whoOpen]);
  const [previewOn] = useState(true);
  const [pvShowAll, setPvShowAll] = useState(false);
  // One-shot card (#137): the advanced sections collapse under "More options"
  // so the four plain blanks are the whole first impression. Kept open/closed
  // across stage steps — admins comparing stages hate re-expanding.
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setCondValue(""); setAddField(""); setWhoPick(""); setWhoOpen(false); setWhoQ(""); setEditWhoDraft(null); }, [stage]);

  // ── Skip-field value loading ──────────────────────────────────────────────
  // Shared skip-value cache — backed by makeSkipValCache so the registry of
  // SKIP_VALUE_LOADERS is the single source of truth for both this drawer and
  // the outer SkipsCard.  Adding a field to SKIP_VALUE_LOADERS automatically
  // works in both surfaces without a second edit.
  // Cross-tenant guard: people === null when tenantId !== undefined (the parent
  // sets it that way); loading values from the caller's own tenant would be
  // meaningless for the company being edited.
  const skipValCacheRef = useRef(makeSkipValCache());
  const [skipValVersion, setSkipValVersion] = useState(0);
  const bumpSkipVer = useCallback(() => setSkipValVersion(v => v + 1), []);

  const ensureSkipVals = useCallback((field: string) => {
    if (people === null) return; // cross-tenant: don't load wrong-tenant values
    // Module-scoped: value scans hit THIS workflow's table (Leads rules get
    // Lead values, not project values); org-catalog loaders ignore it.
    skipValCacheRef.current.ensureSkipVals(field, bumpSkipVer, mod);
  }, [bumpSkipVer, people, mod]);

  // Pre-load values for every field used in THIS module's existing skip rules
  useEffect(() => {
    const fieldsNeeded = new Set(rules.stageSkips.filter(r => r.module === mod).map(r => r.field));
    fieldsNeeded.forEach(f => ensureSkipVals(f));
  }, [rules.stageSkips, ensureSkipVals, mod]);

  // Re-fire whenever the user picks a new field in the "condition" row so the
  // value dropdown populates immediately (condField was previously omitted from
  // the deps above with an eslint-disable, so changing the field never triggered
  // the loader and skipValsFor returned [] → free-text fallback appeared).
  useEffect(() => { ensureSkipVals(condField); }, [condField, ensureSkipVals]);

  /** Returns loaded value options for a skip field, or [] if not yet loaded / no loader. */
  const skipValsFor = useCallback((field: string): string[] => {
    void skipValVersion; // subscribe to re-renders
    return skipValCacheRef.current.skipValsFor(field, mod);
  }, [skipValVersion, mod]);

  // ── Filtered views over the draft docs ───────────────────────────────────
  const lockRules = rules.fieldLocks.map((r, idx) => ({ r, idx }))
    .filter(x => x.r.module === mod && k(x.r.stage) === sk);
  const layoutRules = (rules.formLayout ?? []).map((r, idx) => ({ r, idx }))
    .filter(x => x.r.module === mod && k(x.r.stage) === sk);
  const skipRules = rules.stageSkips.map((r, idx) => ({ r, idx }))
    .filter(x => x.r.module === mod && x.r.skipStages.some(s => k(s) === sk));
  const permRules = perms.map((r, idx) => ({ r, idx }))
    .filter(x => x.r.module === mod && k(x.r.stage) === sk);
  // Lock rules anchored on OTHER stages whose range covers this one.
  const inherited = rules.fieldLocks
    .filter(r => r.module === mod && k(r.stage) !== sk && lockApplies(r, stage, order));
  // Form rules (read-only / hidden) anchored elsewhere that reach this stage
  // via their From/Before scope — shown read-only like inherited locks.
  const inheritedLayout = (rules.formLayout ?? [])
    .filter(r => r.module === mod && k(r.stage) !== sk && layoutApplies(r, stage, order));
  // Record-level drawers deliberately hide company-wide stage permissions.
  // Do not count that hidden "Who can act" rule as one of this project's own
  // rules, or an otherwise-empty drawer misleadingly says "1 rule".
  const visiblePermRuleCount = recordScope ? 0 : permRules.length;
  const rulesTotal = lockRules.length + skipRules.length + visiblePermRuleCount + layoutRules.length
    + (rules.requiredFields ?? []).filter(r => r.module === mod && k(r.stage) === sk).length;

  // ── Field-rule rows: one row per (rule, field) pair ──────────────────────
  type RowRef = { kind: "lock"; idx: number } | { kind: "layout"; idx: number; arr: "hidden" | "readOnly" };
  type FieldRow = {
    field: string; state: "locked" | "readOnly" | "hidden";
    scope: "from" | "until" | "at"; exempt: string[]; only: string[]; ref: RowRef;
  };
  const fieldRows: FieldRow[] = [
    ...lockRules.flatMap(({ r, idx }) => r.fields.map(f => ({
      field: f, state: "locked" as const, scope: r.direction,
      exempt: r.exemptGroupIds ?? [], only: r.appliesToGroupIds ?? [],
      ref: { kind: "lock" as const, idx },
    }))),
    ...layoutRules.flatMap(({ r, idx }) => [
      ...r.hidden.map(f => ({
        field: f, state: "hidden" as const, scope: r.direction ?? "at",
        exempt: r.exemptGroupIds ?? [], only: r.appliesToGroupIds ?? [],
        ref: { kind: "layout" as const, idx, arr: "hidden" as const },
      })),
      ...r.readOnly.map(f => ({
        field: f, state: "readOnly" as const, scope: r.direction ?? "at",
        exempt: r.exemptGroupIds ?? [], only: r.appliesToGroupIds ?? [],
        ref: { kind: "layout" as const, idx, arr: "readOnly" as const },
      })),
    ]),
  ].sort((a, b) => friendlyFieldLabel(a.field).localeCompare(friendlyFieldLabel(b.field)));

  const sameAud = (r: { exemptGroupIds?: string[]; appliesToGroupIds?: string[] }, exempt: string[], only: string[]) => {
    const norm = (a?: string[]) => [...(a ?? [])].map(x => x.toLowerCase()).sort().join("|");
    return norm(r.exemptGroupIds) === norm(exempt) && norm(r.appliesToGroupIds) === norm(only);
  };
  /** Doc minus one (rule, field) pair — rules left empty drop entirely. */
  const docWithout = (r: StageRules, row: FieldRow): StageRules => {
    if (row.ref.kind === "lock") {
      const li = row.ref.idx;
      const fieldLocks = r.fieldLocks
        .map((x, j) => j === li ? { ...x, fields: x.fields.filter(f => k(f) !== k(row.field)) } : x)
        .filter(x => x.fields.length > 0);
      return { ...r, fieldLocks };
    }
    const { idx: yi, arr } = row.ref;
    const layout = (r.formLayout ?? [])
      .map((x, j) => j === yi ? { ...x, [arr]: x[arr].filter(f => k(f) !== k(row.field)) } as FormLayoutRule : x)
      .filter(x => x.hidden.length > 0 || x.readOnly.length > 0);
    const next = { ...r };
    if (layout.length) next.formLayout = layout; else delete next.formLayout;
    return next;
  };
  /** Doc plus one field rule — merges into an existing rule with the SAME
   *  stage + scope + audience, so the doc stays as compact as the tabs keep it. */
  const docWith = (r: StageRules, field: string, state: FieldRow["state"], scope: FieldRow["scope"], exempt: string[], only: string[]): StageRules => {
    const aud: { exemptGroupIds?: string[]; appliesToGroupIds?: string[] } = {};
    if (exempt.length) aud.exemptGroupIds = exempt;
    if (only.length) aud.appliesToGroupIds = only;
    if (state === "locked") {
      const dir = scope === "at" ? "from" : scope; // locks have no "at" mode
      const at = r.fieldLocks.findIndex(x => x.module === mod && k(x.stage) === sk && x.direction === dir && sameAud(x, exempt, only));
      const fieldLocks = at >= 0
        ? r.fieldLocks.map((x, j) => j === at
          ? { ...x, fields: x.fields.some(f => k(f) === k(field)) ? x.fields : [...x.fields, field] }
          : x)
        : [...r.fieldLocks, { module: mod, stage, direction: dir, fields: [field], ...aud }];
      return { ...r, fieldLocks };
    }
    const arr = state === "hidden" ? "hidden" as const : "readOnly" as const;
    const other = state === "hidden" ? "readOnly" as const : "hidden" as const;
    const list = r.formLayout ?? [];
    // Scope is part of the rule identity — "at" and "from" rules on one stage
    // mean different ranges, so they must never fuse. Canonical stored form
    // omits direction for "at" (matches the server sanitizer).
    const at = list.findIndex(x => x.module === mod && k(x.stage) === sk && (x.direction ?? "at") === scope && sameAud(x, exempt, only));
    const layout = at >= 0
      ? list.map((x, j) => j === at ? {
        ...x,
        [arr]: x[arr].some(f => k(f) === k(field)) ? x[arr] : [...x[arr], field],
        [other]: x[other].filter(f => k(f) !== k(field)),
      } as FormLayoutRule : x)
      : [...list, {
        module: mod, stage, hidden: arr === "hidden" ? [field] : [], readOnly: arr === "readOnly" ? [field] : [],
        ...(scope !== "at" ? { direction: scope } : {}), ...aud,
      }];
    return { ...r, formLayout: layout };
  };
  /** Re-home one row with changed state/scope/audience — one doc update. */
  const patchRow = (row: FieldRow, next: Partial<{ state: FieldRow["state"]; scope: FieldRow["scope"]; exempt: string[]; only: string[] }>) =>
    setRules(r => {
      const state = next.state ?? row.state;
      // Scopes carry over between states verbatim; docWith snaps the one
      // combination that doesn't exist (Locked + "at" → "from").
      const scope = next.scope ?? row.scope;
      const exempt = next.exempt ?? row.exempt;
      const only = next.only ?? row.only;
      return docWith(docWithout(r, row), row.field, state, scope, exempt, only);
    });
  const removeRow = (row: FieldRow) => setRules(r => docWithout(r, row));
  const addFieldRule = () => {
    if (!addField) return;
    // A freezing rule on a stage that HOLDS records deserves a pause (#spec).
    if ((addState === "locked" || addState === "hidden") && (recordCount ?? 0) > 0) {
      const what = addState === "locked" ? "locks this field on" : "hides this field from";
      if (!window.confirm(`${recordCount} ${modLabel.toLowerCase()} sit on "${stage}" right now — this rule ${what} all of them as soon as you save. Add it?`)) return;
    }
    setRules(r => docWith(r, addField, addState, addScope, [], []));
    setAddField("");
  };

  // ── Skip conditions ──────────────────────────────────────────────────────
  const condLabel = (f: string) =>
    SKIP_FIELD_SUGGESTIONS.find(x => x.value === f)?.label ?? friendlyFieldLabel(f);
  /** True when the field stores a date value — show a calendar picker. */
  const isDateField = (f: string) => /date/i.test(f) || f === "Created";
  const removeCondition = (idx: number) =>
    setRules(r => ({
      ...r,
      stageSkips: r.stageSkips
        .map((x, j) => j === idx ? { ...x, skipStages: x.skipStages.filter(s => k(s) !== sk) } : x)
        .filter(x => x.skipStages.length > 0),
    }));
  // Commits a skip condition into the draft rules. Takes explicit values so
  // the value dropdown can commit ON PICK — users kept choosing field +
  // value and pressing Save without clicking "Add", which silently dropped
  // the condition (and left Save greyed out, since nothing had changed).
  // Rows 1 & 2 already add on pick; the Skip row now matches them.
  const commitCondition = (fRaw: string, vRaw: string) => {
    const f = fRaw.trim(); const v = vRaw.trim();
    if (!f || !v) return;
    setRules(r => {
      const at = r.stageSkips.findIndex(x => x.module === mod && x.field === f && k(x.value) === k(v));
      const stageSkips = at >= 0
        ? r.stageSkips.map((x, j) => j === at
          ? { ...x, skipStages: x.skipStages.some(s => k(s) === sk) ? x.skipStages : [...x.skipStages, stage] }
          : x)
        : [...r.stageSkips, { module: mod, field: f, value: v, skipStages: [stage] }];
      return { ...r, stageSkips };
    });
    setCondValue("");
    // Back to the dropdown after a successful commit — "Other" free-text mode
    // is a one-shot escape, not a sticky preference.
    setCondOther(false);
  };
  const addCondition = () => commitCondition(condField, condValue);
  // Edit an existing skip row FOR THIS STAGE ONLY. Skip rules are canonically
  // keyed by (module, field, value) and carry a LIST of stages (addCondition
  // and the Types tab both merge on that key), so two invariants matter here:
  //   1. A rule shared with other stages must be split (copy-on-write) before
  //      the edit — patching it in place would silently rewrite the condition
  //      for the OTHER stages too.
  //   2. On commit (select pick / input blur) rules that now collide on the
  //      canonical key must be re-merged, or the Types tab's first-match
  //      lookups see duplicates and edit only one of them.
  // While typing in the free-text value input we pass commit=false so rows
  // don't fuse (and reorder under the cursor) mid-keystroke; the blur commit
  // canonicalizes. Audience arrays are part of the merge key so rules with
  // different audiences are never fused (their configs would be lost).
  const patchCondition = (idx: number, patch: Partial<{ field: string; value: string }>, commit: boolean) =>
    setRules(r => {
      const src = r.stageSkips[idx];
      if (!src) return r;
      const others = src.skipStages.filter(s => k(s) !== sk);
      let stageSkips = others.length === 0
        ? r.stageSkips.map((x, j) => j === idx ? { ...x, ...patch } : x)
        : [
          ...r.stageSkips.map((x, j) => j === idx ? { ...x, skipStages: others } : x),
          { ...src, ...patch, skipStages: [stage] },
        ];
      if (commit) {
        const audSig = (x: typeof src) =>
          `${(x.appliesToGroupIds ?? []).slice().sort().join(",")}~${(x.exemptGroupIds ?? []).slice().sort().join(",")}`;
        const seen = new Map<string, number>();
        const out: typeof stageSkips = [];
        for (const x of stageSkips) {
          const key = `${x.module}|${x.field}|${k(x.value)}|${audSig(x)}`;
          const at = seen.get(key);
          if (at == null) { seen.set(key, out.length); out.push(x); }
          else out[at] = {
            ...out[at],
            skipStages: [
              ...out[at].skipStages,
              ...x.skipStages.filter(s => !out[at].skipStages.some(t => k(t) === k(s))),
            ],
          };
        }
        stageSkips = out;
      }
      return { ...r, stageSkips };
    });
  const condFieldOpts = [
    ...SKIP_FIELD_SUGGESTIONS.filter(o => o.value !== "WorkflowTypeName" || typeNames.length > 0),
    ...ruleFieldsFor(mod).filter(o => !SKIP_FIELD_SUGGESTIONS.some(s => s.value === o.value)),
  ];

  // ── Who can act ──────────────────────────────────────────────────────────
  type WhoRow = { id: string; kind: "group" | "user"; tier: "owner" | "editor"; permIdx: number };
  const whoRows: WhoRow[] = permRules.flatMap(({ r, idx }) => [
    ...r.actionGroupIds.map(id => ({ id, kind: "group" as const, tier: "owner" as const, permIdx: idx })),
    ...r.actionUserIds.map(id => ({ id, kind: "user" as const, tier: "owner" as const, permIdx: idx })),
    ...r.editorGroupIds.map(id => ({ id, kind: "group" as const, tier: "editor" as const, permIdx: idx })),
    ...r.editorUserIds.map(id => ({ id, kind: "user" as const, tier: "editor" as const, permIdx: idx })),
  ]);
  const groupLabel = (id: string) => groups.find(g => g.id === id)?.name ?? id;
  // Person lookups are case-INSENSITIVE: the server sanitizer lowercases
  // saved user ids while getUserList returns uppercase SQL Server GUIDs —
  // an exact compare made saved rows render as raw GUIDs after save/reload.
  const personLabel = (id: string) =>
    people?.find(p => p.value.toLowerCase() === id.toLowerCase())?.label ?? id;
  const whoLabel = (w: WhoRow) => (w.kind === "group" ? groupLabel(w.id) : personLabel(w.id));
  const audLabel = (id: string) => {
    const g = groups.find(x => x.id === id);
    if (g) return g.name;
    const bare = id.replace(/^user:/, "").toLowerCase();
    const p = people?.find(x => x.value.toLowerCase() === bare);
    return p?.label ?? id.replace(/^user:/, "");
  };
  const audNames = (ids: string[]) => ids.map(audLabel).join(", ");
  // "Everyone else" mode for THIS stage's rule (max one per module+stage).
  // Legacy rules coerce to "viewOnly" — the behavior before the field existed.
  const othersMode: "viewOnly" | "normal" =
    permRules.some(({ r }) => r.othersMode === "normal") ? "normal" : "viewOnly";
  const setOthersMode = (m2: "viewOnly" | "normal") =>
    setPerms(p => p.map(r => (r.module === mod && k(r.stage) === sk ? { ...r, othersMode: m2 } : r)));
  const permKeyOf = (kind: "group" | "user", tier: "owner" | "editor") =>
    tier === "owner" ? (kind === "group" ? "actionGroupIds" as const : "actionUserIds" as const)
      : (kind === "group" ? "editorGroupIds" as const : "editorUserIds" as const);
  const setWhoRowTier = (w: WhoRow, tier: "owner" | "editor") => {
    if (tier === w.tier) return;
    setPerms(p => p.map((r, j) => {
      if (j !== w.permIdx) return r;
      const from = permKeyOf(w.kind, w.tier);
      const to = permKeyOf(w.kind, tier);
      return {
        ...r,
        [from]: r[from].filter(x => x !== w.id),
        [to]: r[to].includes(w.id) ? r[to] : [...r[to], w.id],
      } as StagePermRule;
    }));
  };
  const removeWho = (w: WhoRow) =>
    setPerms(p => p
      .map((r, j) => {
        if (j !== w.permIdx) return r;
        const from = permKeyOf(w.kind, w.tier);
        return { ...r, [from]: r[from].filter(x => x !== w.id) } as StagePermRule;
      })
      // A rule this stage just emptied would silently freeze the stage for
      // everyone (and block save) — drop it instead.
      .filter(r => !(r.module === mod && k(r.stage) === sk
        && r.actionGroupIds.length === 0 && r.actionUserIds.length === 0
        && r.editorGroupIds.length === 0 && r.editorUserIds.length === 0)));
  const addWhoValue = (pick: string, tier: "owner" | "editor") => {
    if (!pick) return;
    const kind = pick.startsWith("u:") ? "user" as const : "group" as const;
    const id = pick.slice(2);
    const key = permKeyOf(kind, tier);
    setPerms(p => {
      const at = p.findIndex(r => r.module === mod && k(r.stage) === sk);
      if (at >= 0) {
        return p.map((r, j) => {
          if (j !== at) return r;
          // Case-insensitive removal: saved ids come back lowercased from the
          // server while fresh picks carry the roster's original GUID casing —
          // an exact compare would duplicate the same person in two tiers.
          const notPicked = (x: string) => x.toLowerCase() !== id.toLowerCase();
          const cleaned = {
            ...r,
            actionGroupIds: r.actionGroupIds.filter(notPicked),
            actionUserIds: r.actionUserIds.filter(notPicked),
            editorGroupIds: r.editorGroupIds.filter(notPicked),
            editorUserIds: r.editorUserIds.filter(notPicked),
          };
          return { ...cleaned, [key]: [...cleaned[key], id] } as StagePermRule;
        });
      }
      // New rules default to "normal": adding a person grants THEM a role
      // without silently locking everyone else out (#per-stage drawer UX).
      const base: StagePermRule = { module: mod, stage, actionUserIds: [], actionGroupIds: [], editorUserIds: [], editorGroupIds: [], othersMode: "normal" };
      return [...p, { ...base, [key]: [id] } as StagePermRule];
    });
    setWhoPick("");
  };
  const addWho = () => addWhoValue(whoPick, whoTier);

  // ── Rule 5: "Who can edit" — plain-language view of the SAME rule ────────
  // Three modes over the editor tier + othersMode:
  //   everyone        → othersMode "normal" (listed people, if any, are
  //                     grant-style only — nobody else loses access)
  //   people / groups → othersMode "viewOnly": only listed editors (and stage
  //                     owners, who can always edit) may change records here.
  const editorEntries = whoRows.filter(w => w.tier === "editor");
  const ownerEntries = whoRows.filter(w => w.tier === "owner");
  const permRuleExists = permRules.length > 0;
  const docRestricted = permRuleExists && othersMode === "viewOnly";
  const docKind: "people" | "groups" =
    editorEntries.length > 0 && editorEntries.every(w => w.kind === "group") ? "groups" : "people";
  const editWhoMode: "everyone" | "people" | "groups" =
    editWhoDraft ?? (docRestricted ? docKind : "everyone");
  const setEditWhoMode = (m2: "everyone" | "people" | "groups") => {
    if (m2 === "everyone") {
      setEditWhoDraft(null);
      // Back to "everyone with access": the rule (if any) flips to grant-style
      // "normal"; a rule left with no assignments at all is dropped — the
      // sanitizer would keep it as an explicit stage freeze otherwise.
      setPerms(p => p
        .map(r => (r.module === mod && k(r.stage) === sk ? { ...r, othersMode: "normal" as const } : r))
        .filter(r => !(r.module === mod && k(r.stage) === sk
          && r.actionGroupIds.length === 0 && r.actionUserIds.length === 0
          && r.editorGroupIds.length === 0 && r.editorUserIds.length === 0)));
      return;
    }
    setEditWhoDraft(m2);
    // An existing rule WITH assignments becomes a real restriction right
    // away; with no rule yet — or an empty legacy rule with nobody in either
    // tier — nothing is written until the first pick (see editWhoDraft
    // note). Stamping viewOnly on an empty rule would freeze the stage for
    // everyone.
    if (permRuleExists && (ownerEntries.length > 0 || editorEntries.length > 0)) setOthersMode("viewOnly");
  };
  const addEditorPick = (pick: string) => {
    if (!pick) return;
    const pkKind = pick.startsWith("u:") ? "user" as const : "group" as const;
    const pkId = pick.slice(2);
    const pkKey = pkKind === "group" ? "editorGroupIds" as const : "editorUserIds" as const;
    setPerms(p => {
      const at = p.findIndex(r => r.module === mod && k(r.stage) === sk);
      if (at >= 0) {
        return p.map((r, j) => {
          if (j !== at) return r;
          const notPicked = (x: string) => x.toLowerCase() !== pkId.toLowerCase();
          // Dedupe within the editor tier only — never silently strip the same
          // person from the OWNER tier (that would revoke their move rights;
          // owners can already edit, so the duplicate is harmless).
          const cleaned = { ...r, editorGroupIds: r.editorGroupIds.filter(notPicked), editorUserIds: r.editorUserIds.filter(notPicked) };
          return { ...cleaned, othersMode: "viewOnly" as const, [pkKey]: [...cleaned[pkKey], pkId] } as StagePermRule;
        });
      }
      const base: StagePermRule = { module: mod, stage, actionUserIds: [], actionGroupIds: [], editorUserIds: [], editorGroupIds: [], othersMode: "viewOnly" };
      return [...p, { ...base, [pkKey]: [pkId] } as StagePermRule];
    });
  };
  const editorPicked = (id: string) =>
    editorEntries.some(w => w.id.toLowerCase() === id.toLowerCase());

  // ── Preview as a user ────────────────────────────────────────────────────
  const fieldOpts = ruleFieldsFor(mod);
  const pv = useMemo(() => {
    const emptySet = new Set<string>();
    const map = new Map<string, { label: string; rank: number }>();
    const bump = (f: string, rank: number) => {
      const kk = k(f);
      const cur = map.get(kk);
      if (!cur) map.set(kk, { label: friendlyFieldLabel(f, mod), rank });
      else if (rank > cur.rank) cur.rank = rank;
    };
    // Mandatory to enter this stage — rank 4 (always shown first).
    const mandatoryRules = (rules.requiredFields ?? []).filter(r => r.module === mod && k(r.stage) === sk);
    const mandatoryFields: string[] = [];
    for (const r of mandatoryRules) for (const f of r.fields) if (!mandatoryFields.some(x => k(x) === k(f))) mandatoryFields.push(f);
    for (const f of mandatoryFields) bump(f, 4);
    // Locks: every module rule whose range covers this stage.
    for (const r of rules.fieldLocks) {
      if (r.module !== mod || !lockApplies(r, stage, order) || ruleExempts(r, emptySet)) continue;
      for (const f of r.fields) bump(f, 2);
    }
    // Form rules: hidden/read-only via layout rules.
    for (const r of rules.formLayout ?? []) {
      if (r.module !== mod || !layoutApplies(r, stage, order) || ruleExempts(r, emptySet)) continue;
      for (const f of r.readOnly) bump(f, 1);
      for (const f of r.hidden) bump(f, 3);
    }
    // configured = fields with a specific rule, sorted strictest first.
    const configured = [...map.entries()].map(([kk, v]) => ({ key: kk, ...v }))
      .sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label));
    // editable = every field that has no rule at all.
    const editable = fieldOpts.filter(o => !map.has(k(o.value))).map(o => ({ key: k(o.value), label: o.label }));
    return { configured, editable };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOn, rules.requiredFields, rules.fieldLocks, rules.formLayout, mod, stage, sk, order.join("|")]);

  // ── Shared styles ────────────────────────────────────────────────────────
  const dSel: React.CSSProperties = {
    height: 28, fontSize: 12, borderRadius: 6, padding: "0 6px", maxWidth: "100%",
    border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
    color: "hsl(var(--foreground))", cursor: "pointer",
  };
  const iconBtnSm: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 6, border: "1px solid hsl(var(--border))",
    background: "hsl(var(--background))", color: "hsl(var(--foreground))",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
  };
  const chipMono: React.CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, fontWeight: 600,
    padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap",
    border: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.4)",
    color: "hsl(var(--foreground))",
  };
  const xBtn: React.CSSProperties = {
    width: 22, height: 22, borderRadius: 5, border: "none", background: "transparent",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
    color: "hsl(var(--muted-foreground))", flexShrink: 0, padding: 0,
  };
  /** Compact square "+" commit button pinned to the right edge of an add-row. */
  const plusBtn: React.CSSProperties = {
    width: 28, height: 28, borderRadius: 6, border: "1px solid hsl(var(--border))",
    background: "hsl(var(--background))", color: "hsl(var(--foreground))",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0,
  };
  const secWrap: React.CSSProperties = { padding: "14px 16px", borderBottom: "1px solid hsl(var(--border))" };
  const secHdr = (icon: ReactNode, label: string, tint: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 9 }}>
      {icon}
      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10.5, fontWeight: 700, letterSpacing: 1.1, color: tint, textTransform: "uppercase" }}>{label}</span>
    </div>
  );
  const emptyTxt: React.CSSProperties = { fontSize: 12, color: "hsl(var(--muted-foreground))", margin: 0, lineHeight: 1.55 };
  const stateColor: Record<FieldRow["state"], string> = { locked: "#0284c7", readOnly: "#b45309", hidden: "#dc2626" };
  const stateLabel: Record<FieldRow["state"], string> = { locked: "Locked", readOnly: "Read-only", hidden: "Hidden" };

  // ── One-shot card (#137): simple views + tiny mutators over the SAME draft
  //    docs the advanced sections edit — never a second copy of any rule. ────
  const reqRules = (rules.requiredFields ?? []).filter(r => r.module === mod && k(r.stage) === sk);
  const reqFields: string[] = [];
  for (const r of reqRules) for (const f of r.fields) if (!reqFields.some(x => k(x) === k(f))) reqFields.push(f);
  // Fields covered by an AUDIENCE-FREE rule — only these get an ✕ (scoped
  // rules are deliberate policies; the simple card must never silently
  // mutate them, so their chips render read-only).
  const reqOpenKeys = new Set<string>();
  for (const r of reqRules) {
    if (r.exemptGroupIds?.length || r.appliesToGroupIds?.length) continue;
    for (const f of r.fields) reqOpenKeys.add(k(f));
  }
  const addReqField = (field: string) => {
    if (!field) return;
    setRules(r => {
      const list = r.requiredFields ?? [];
      // Merge into this stage's audience-free rule; create one if none exists
      // (mirrors docWith's compaction so the doc stays tab-shaped).
      const at = list.findIndex(x => x.module === mod && k(x.stage) === sk
        && !(x.exemptGroupIds?.length) && !(x.appliesToGroupIds?.length));
      const requiredFields = at >= 0
        ? list.map((x, j) => j === at
          ? { ...x, fields: x.fields.some(f => k(f) === k(field)) ? x.fields : [...x.fields, field] }
          : x)
        : [...list, { module: mod, stage, fields: [field] }];
      return { ...r, requiredFields };
    });
  };
  const removeReqField = (field: string) =>
    setRules(r => {
      // Only mutate this stage's AUDIENCE-FREE rules — a scoped rule
      // (appliesTo/exempt groups) is a distinct policy someone set up
      // deliberately; silently stripping its fields from the simple card
      // would be invisible policy drift. Scoped chips render without an ✕.
      const requiredFields = (r.requiredFields ?? [])
        .map(x => x.module === mod && k(x.stage) === sk
          && !(x.exemptGroupIds?.length) && !(x.appliesToGroupIds?.length)
          ? { ...x, fields: x.fields.filter(f => k(f) !== k(field)) } : x)
        .filter(x => x.fields.length > 0);
      const next = { ...r };
      if (requiredFields.length) next.requiredFields = requiredFields; else delete next.requiredFields;
      return next;
    });
  // Stage guidance tip — display-only text on the record pages (#137).
  const guidanceVal = rules.stageGuidance?.[mod]?.[sk] ?? "";
  const setGuidance = (text: string) => {
    const tip = text.slice(0, 240);
    setRules(r => {
      if ((r.stageGuidance?.[mod]?.[sk] ?? "") === tip) return r;
      const modMap = { ...(r.stageGuidance?.[mod] ?? {}) };
      if (tip) modMap[sk] = tip; else delete modMap[sk];
      const sg = { ...(r.stageGuidance ?? {}) };
      if (Object.keys(modMap).length) sg[mod] = modMap; else delete sg[mod];
      const next = { ...r };
      if (Object.keys(sg).length) next.stageGuidance = sg; else delete next.stageGuidance;
      return next;
    });
  };
  // "Locked after this" = the plain subset (locked + from). Read-only/hidden,
  // until/at scopes and audiences stay in the advanced Field rules section.
  const simpleLockRows = fieldRows.filter(x => x.state === "locked" && x.scope === "from");
  const addSimpleLock = (field: string) => {
    if (!field) return;
    if ((recordCount ?? 0) > 0) {
      if (!window.confirm(`${recordCount} ${modLabel.toLowerCase()} sit on "${stage}" right now — this locks the field on all of them as soon as you save. Add it?`)) return;
    }
    setRules(r => docWith(r, field, "locked", "from", [], []));
  };
  // ── Edge-case cross-rule warnings (#user report: Office was both "mandatory
  //    to enter Qualifying" AND Qualifying's skip condition — skips bypass the
  //    enter-gate by design, so skipped records are never asked for Office;
  //    plus lock/required combos that trap records between stages).
  //    Config lint only: surfaced loudly, never blocks Save — some combos are
  //    legitimate on purpose (e.g. skip the stage for one office, require the
  //    field everywhere else). Claims stay honest (review-hardened): backward
  //    moves are legal, so trap wording names the actual repair path instead
  //    of claiming "never"; audience-scoped rules downgrade to amber (the two
  //    rules may bind disjoint people); field identity is alias-aware
  //    (Department ↔ DepartmentLookup) exactly like enforcement.
  const stageIdx = order.findIndex(s => k(s) === sk);
  const isScopedRule = (r: { exemptGroupIds?: string[]; appliesToGroupIds?: string[] }) =>
    !!(r.exemptGroupIds?.length || r.appliesToGroupIds?.length);
  const sameField = (a: string, b: string) => {
    if (k(a) === k(b)) return true;
    const ka = webFieldKind(a);
    return ka !== null && ka === webFieldKind(b);
  };
  /** First rule that makes `field` un-fillable while a record SITS on
   *  `atStage` — locks + read-only/hidden form rules, ALL scopes (an "at"
   *  rule on the first stage traps records just as hard as a range lock),
   *  evaluated with the same applies helpers enforcement uses. */
  const blockerAt = (field: string, atStage: string): { what: string; scoped: boolean } | null => {
    for (const r of rules.fieldLocks) {
      if (r.module !== mod || !r.fields.some(f => sameField(f, field))) continue;
      if (lockApplies(r, atStage, order)) return { what: "locked", scoped: isScopedRule(r) };
    }
    for (const r of rules.formLayout ?? []) {
      if (r.module !== mod) continue;
      const hid = r.hidden.some(f => sameField(f, field));
      if (!hid && !r.readOnly.some(f => sameField(f, field))) continue;
      if (layoutApplies(r, atStage, order)) return { what: hid ? "hidden" : "read-only", scoped: isScopedRule(r) };
    }
    return null;
  };
  /** Any stage strictly before index `beforeIdx` where `field` is fillable? */
  const editableSomewhereBefore = (field: string, beforeIdx: number) =>
    order.slice(0, Math.max(0, beforeIdx)).some(s2 => blockerAt(field, s2) === null);
  type EdgeWarn = { sev: "red" | "amber"; key: string; text: React.ReactNode };
  const edgeWarns: EdgeWarn[] = [];
  // Scoped rules → amber: the pair may bind disjoint groups, so a red
  // absolute would be a lie for most people.
  const pushWarn = (key: string, scoped: boolean, text: React.ReactNode) =>
    edgeWarns.push({
      sev: scoped ? "amber" : "red", key,
      text: <>{text}{scoped ? <> <i>(Group-scoped rules — only some people are affected.)</i></> : null}</>,
    });
  if (!isFirstStage) {
    // 1 · Mandatory to enter THIS stage + this stage's skip rule keyed on the
    //     same field (amber): the enter-gate fires on the exact target stage
    //     only, and a skip changes the target to the stage AFTER this one — so
    //     records that skip are never asked for the field at all.
    for (const F of reqFields) {
      const hits = skipRules.filter(({ r }) => sameField(r.field, F));
      if (hits.length === 0) continue;
      const lbl = friendlyFieldLabel(F, mod);
      const vals = hits.map(({ r }) => `"${r.value}"`).join(" or ");
      edgeWarns.push({
        sev: "amber", key: `rs-${k(F)}`,
        text: <><b>{lbl}</b> is mandatory to enter "{stage}" (rule 1), but rule 3 skips "{stage}" when {lbl} is {vals} — records that skip are never asked for {lbl}. If it must always be filled in, add it to the next stage&apos;s mandatory list too.</>,
      });
    }
    // 2 · Mandatory to enter THIS stage + un-fillable on the stage right
    //     before it: records arrive at the doorstep unable to fix the very
    //     field that blocks them.
    if (stageIdx > 0) {
      const prev = order[stageIdx - 1];
      for (const F of reqFields) {
        const b = blockerAt(F, prev);
        if (!b) continue;
        const lbl = friendlyFieldLabel(F, mod);
        const reqScoped = reqRules.some(r => isScopedRule(r) && r.fields.some(f => sameField(f, F)));
        pushWarn(`rl-${k(F)}`, b.scoped || reqScoped, editableSomewhereBefore(F, stageIdx - 1)
          ? <><b>{lbl}</b> is mandatory to enter "{stage}", but it&apos;s {b.what} on "{prev}" — the stage right before. A record that reaches "{prev}" with {lbl} empty can&apos;t be fixed there; someone would have to move it back to an earlier stage to fill it in.</>
          : <><b>{lbl}</b> is mandatory to enter "{stage}", but it&apos;s {b.what} on every earlier stage — it can only be filled in when a record is first created. Records created without {lbl} won&apos;t be able to move into "{stage}" the normal way.</>);
      }
    }
  }
  // 3 · Locked from THIS stage onward + mandatory to enter a LATER stage:
  //     the lock never lifts, so the only fill window is before this stage.
  if (stageIdx >= 0) {
    const warned = new Set<string>();
    const checkW3 = (F: string, what: string, blockScoped: boolean) => {
      const fk = k(F);
      if (warned.has(fk)) return;
      for (const rq of rules.requiredFields ?? []) {
        if (rq.module !== mod || !rq.fields.some(f => sameField(f, F))) continue;
        const ti = order.findIndex(s => k(s) === k(rq.stage));
        if (ti <= stageIdx) continue;
        warned.add(fk);
        const lbl = friendlyFieldLabel(F, mod);
        pushWarn(`lr-${fk}`, blockScoped || isScopedRule(rq), editableSomewhereBefore(F, stageIdx)
          ? <><b>{lbl}</b> becomes {what} once a record is in "{stage}" (rule 2), but it&apos;s mandatory to enter "{rq.stage}" later. A record that lands here with {lbl} empty can&apos;t move on to "{rq.stage}" — someone would have to move it back to an earlier stage to fill it in. Consider making {lbl} mandatory for "{stage}" too.</>
          : <><b>{lbl}</b> becomes {what} once a record is in "{stage}" (rule 2), but it&apos;s mandatory to enter "{rq.stage}" later — and it can&apos;t be filled in on any earlier stage either. Only records that had {lbl} filled in at creation will ever reach "{rq.stage}". Consider making {lbl} mandatory for "{stage}" too.</>);
        return;
      }
    };
    for (const r of rules.fieldLocks) {
      if (r.module !== mod || r.direction !== "from" || k(r.stage) !== sk) continue;
      for (const F of r.fields) checkW3(F, "locked", isScopedRule(r));
    }
    for (const r of rules.formLayout ?? []) {
      if (r.module !== mod || r.direction !== "from" || k(r.stage) !== sk) continue;
      for (const F of r.readOnly) checkW3(F, "read-only", isScopedRule(r));
      for (const F of r.hidden) checkW3(F, "hidden", isScopedRule(r));
    }
  }

  // What "More options" is hiding right now — hint so set-up work never vanishes.
  const advCount = fieldRows.filter(x => !(x.state === "locked" && x.scope === "from")).length
    + whoRows.filter(w => w.tier === "editor").length
    + inherited.length + inheritedLayout.length;
  const blankLbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "hsl(var(--foreground))" };
  const simpleChip = (keyStr: string, label: string, onX: (() => void) | null, title?: string) => (
    <span key={keyStr} title={title} style={{
      display: "inline-flex", alignItems: "center", gap: 2, padding: onX ? "2px 2px 2px 10px" : "2px 10px",
      borderRadius: 999, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
      fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))",
    }}>
      {label}{title ? " *" : ""}
      {onX && <button type="button" title="Remove" style={xBtn} onClick={onX}><X style={{ width: 11, height: 11 }} /></button>}
    </span>
  );

  return createPortal(
    <>
      <style>{`@keyframes srDrawerIn{from{transform:translateX(26px);opacity:0}to{transform:none;opacity:1}}
.srWhoOpt:hover{background:hsl(var(--muted)/0.55)!important}`}</style>
      {/* Scrim — click closes. Sits above page content and the page's sticky bars. */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: Z.MODAL, background: "rgba(15,23,42,0.45)" }} />
      <aside role="dialog" aria-modal="true" aria-label={`Rules for ${stage}`}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 500, maxWidth: "94vw", zIndex: Z.MODAL_MENU,
          background: "hsl(var(--background))", borderLeft: "1px solid hsl(var(--border))",
          boxShadow: "-14px 0 44px rgba(0,0,0,0.20)", display: "flex", flexDirection: "column",
          animation: "srDrawerIn .16s ease-out",
        }}>

        {/* ── Header ── */}
        <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid hsl(var(--border))", display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {eyebrow}
            </span>
            <button type="button" title="Previous stage" disabled={!canPrev} onClick={() => onStep(-1)}
              style={{ ...iconBtnSm, opacity: canPrev ? 1 : 0.35, cursor: canPrev ? "pointer" : "not-allowed" }}>
              <ChevronUp style={{ width: 14, height: 14 }} />
            </button>
            <button type="button" title="Next stage" disabled={!canNext} onClick={() => onStep(1)}
              style={{ ...iconBtnSm, opacity: canNext ? 1 : 0.35, cursor: canNext ? "pointer" : "not-allowed" }}>
              <ChevronDown style={{ width: 14, height: 14 }} />
            </button>
            <button type="button" title="Close" onClick={onClose} style={iconBtnSm}>
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: color ?? (phaseColor ?? "hsl(var(--primary))") }} />
            <span style={{ fontSize: 16.5, fontWeight: 800, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleText}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "hsl(var(--primary))", background: "hsl(var(--primary) / 0.1)", border: "1px solid hsl(var(--primary) / 0.3)", borderRadius: 999, padding: "2px 9px", flexShrink: 0, whiteSpace: "nowrap" }}>
              {MODULE_LABELS[mod]} workflow
            </span>
          </div>
          <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>
            {recordCount != null ? `${recordCount} record${recordCount === 1 ? "" : "s"} here · ` : ""}
            {rulesTotal} rule{rulesTotal === 1 ? "" : "s"}
          </span>
          {/* Phase color picker — shown when the host has color data (schedule settings, not record-page rules) */}
          {onPhaseColorChange && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>Phase color</span>
              <ColorSwatchPicker current={phaseColor ?? null} onChange={(hex) => onPhaseColorChange(hex)} size={20} />
              {phaseColor && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "2px 9px 2px 5px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
                  background: phaseColor, color: phaseColorIsDark(phaseColor) ? "#fff" : "#222",
                  border: "1px solid rgba(0,0,0,0.08)",
                }}>
                  {phaseColor}
                </span>
              )}
              {!phaseColor && (
                <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontStyle: "italic" }}>Auto (based on name)</span>
              )}
            </div>
          )}
        </div>

        {/* ── Record-scope banner — this drawer edits ONE project's rules ── */}
        {recordScope && (
          <div style={{
            flexShrink: 0, padding: "9px 16px 10px", borderBottom: "1px solid hsl(var(--border))",
            background: recordScope.source === "record" ? "rgba(217,119,6,0.09)" : "hsl(var(--primary) / 0.05)",
            display: "flex", flexDirection: "column", gap: 7,
          }}>
            {recordScope.source === "record" ? (
              <>
                <span style={{ fontSize: 12, lineHeight: 1.5, color: "hsl(var(--foreground))" }}>
                  <b>This project has its own rules.</b> Company-wide rules don&apos;t apply to
                  {" "}<b>&quot;{recordScope.label}&quot;</b> while these are in place.
                </span>
                <button type="button" disabled={recordScope.resetting}
                  onClick={() => {
                    if (!confirmReset) { setConfirmReset(true); return; }
                    setConfirmReset(false);
                    recordScope.onReset();
                  }}
                  style={{
                    alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6,
                    fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 7,
                    border: confirmReset ? "1px solid #dc2626" : "1px solid hsl(var(--border))",
                    color: confirmReset ? "#dc2626" : "hsl(var(--foreground))",
                    background: "hsl(var(--background))", cursor: recordScope.resetting ? "wait" : "pointer",
                    opacity: recordScope.resetting ? 0.6 : 1,
                  }}>
                  {recordScope.resetting
                    ? (<><Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> Removing…</>)
                    : (<><RotateCcw style={{ width: 12, height: 12 }} /> {confirmReset ? "Click again to confirm — this project's own rules will be removed" : "Use company rules instead"}</>)}
                </button>
              </>
            ) : (
              <span style={{ fontSize: 12, lineHeight: 1.5, color: "hsl(var(--foreground))" }}>
                <b>Showing company rules.</b> Saving a change creates rules for
                {" "}<b>&quot;{recordScope.label}&quot;</b> only — every other record keeps the company rules.
              </span>
            )}
          </div>
        )}

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>

          {/* ── One-shot card (#137): four plain fill-in-the-blank lines that
                 cover the common setups. Everything advanced stays available
                 under "More options" below — same draft docs, same Save. ── */}
          <div style={{ ...secWrap, background: "hsl(var(--primary) / 0.04)" }}>
            {/* 1 · Required before entering */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 16, opacity: isFirstStage ? 0.4 : 1, pointerEvents: isFirstStage ? "none" : undefined }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={blankLbl}>1 · Mandatory fields: <span style={{ fontWeight: 500, color: "hsl(var(--muted-foreground))" }}>must be filled in before a record can move to "{stage}"</span></span>
                {isFirstStage && (
                  <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontStyle: "italic" }}>
                    — not needed, records start in "{stage}"
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {reqFields.map(f => reqOpenKeys.has(k(f))
                  ? simpleChip(`rq-${k(f)}`, friendlyFieldLabel(f, mod), () => removeReqField(f))
                  : simpleChip(`rq-${k(f)}`, friendlyFieldLabel(f, mod), null, "Limited to specific people — manage this rule with your RM ONE contact"))}
                <select value="" onChange={e => addReqField(e.target.value)} style={{ ...dSel, maxWidth: 175 }}>
                  <option value="" disabled>Add a field…</option>
                  {fieldOpts.filter(o => !reqFields.some(f => k(f) === k(o.value))).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            {/* 2 · Locked from here on */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid hsl(var(--border))", paddingTop: 16, paddingBottom: 16 }}>
              <span style={blankLbl}>2 · Can't change: <span style={{ fontWeight: 500, color: "hsl(var(--muted-foreground))" }}>once a record is in "{stage}", these fields are locked</span></span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {simpleLockRows.map(row => simpleChip(
                  `lk-${row.ref.kind}-${"arr" in row.ref ? row.ref.arr : ""}-${row.ref.idx}-${k(row.field)}`,
                  friendlyFieldLabel(row.field, mod),
                  () => removeRow(row),
                  row.exempt.length || row.only.length ? "Applies to specific groups — see the advanced rules below" : undefined,
                ))}
                <select value="" onChange={e => addSimpleLock(e.target.value)} style={{ ...dSel, maxWidth: 175 }}>
                  <option value="" disabled>Add a field…</option>
                  {fieldOpts.filter(o => !simpleLockRows.some(x => k(x.field) === k(o.value))).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            {/* 3 · Skip this stage when */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid hsl(var(--border))", paddingTop: 16, paddingBottom: 16 }}>
              <span style={blankLbl}>3 · Skip this stage: <span style={{ fontWeight: 500, color: "hsl(var(--muted-foreground))" }}>"{stage}" is automatically skipped when…</span></span>
              {/* Existing skip conditions as removable chips */}
              {skipRules.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {skipRules.map(({ r, idx }) => {
                    const fieldLabel = condFieldOpts.find(o => o.value === r.field)?.label ?? r.field;
                    return simpleChip(
                      `sk-${idx}`,
                      `When ${fieldLabel} = "${r.value}"`,
                      () => removeCondition(idx),
                    );
                  })}
                </div>
              )}
              {/* Add a new skip condition */}
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                <select value={condField} onChange={e => { setCondField(e.target.value); setCondValue(""); setCondOther(false); }}
                  style={{ ...dSel, maxWidth: 160 }}>
                  <option value="" disabled>When field…</option>
                  {condFieldOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {condField && (
                  skipValsFor(condField).length > 0 && !condOther ? (
                    // Picking a value commits the condition immediately (chip
                    // appears above, select resets) — no separate "Add" click.
                    <select value={condValue}
                      onChange={e => e.target.value === "__other__" ? setCondOther(true) : commitCondition(condField, e.target.value)}
                      style={{ ...dSel, maxWidth: 160 }}>
                      <option value="" disabled>equals…</option>
                      {skipValsFor(condField).map(v => <option key={v} value={v}>{v}</option>)}
                      <option value="__other__">Other (type a value)…</option>
                    </select>
                  ) : (
                    <input value={condValue} onChange={e => setCondValue(e.target.value)}
                      placeholder="equals…" onKeyDown={e => { if (e.key === "Enter") addCondition(); }}
                      // Clicking away (e.g. straight onto Save) commits the
                      // typed value instead of silently dropping it.
                      onBlur={() => { if (condField.trim() && condValue.trim()) addCondition(); }}
                      style={{ ...dSel, width: 130, padding: "0 8px" }} />
                  )
                )}
                {condField && condValue && (
                  <button type="button" onClick={addCondition} title="Add condition"
                    style={{ ...dSel, padding: "0 10px", cursor: "pointer", fontWeight: 600, color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.4)" }}>
                    Add
                  </button>
                )}
              </div>
            </div>
            {/* 4 · Team tip */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid hsl(var(--border))", paddingTop: 16, paddingBottom: 16 }}>
              <span style={blankLbl}>4 · Tip for your team: <span style={{ fontWeight: 500, color: "hsl(var(--muted-foreground))" }}>shows on the record page while a record is in "{stage}"</span></span>
              <Input value={guidanceVal} onChange={e => setGuidance(e.target.value)} maxLength={240}
                placeholder='e.g. "Confirm budget and client contact before moving on"'
                style={{ height: 30, fontSize: 12.5 }} />
            </div>
            {/* 5 · Who can edit — the stage-permission rule's editor tier in
                plain language. Company-wide by design: record-level drawers
                only point at Settings (the perms doc is tenant-scoped, v1). */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid hsl(var(--border))", paddingTop: 16 }}>
              <span style={blankLbl}>5 · Who can edit: <span style={{ fontWeight: 500, color: "hsl(var(--muted-foreground))" }}>while a record is in "{stage}", who can make changes to it?</span></span>
              {recordScope ? (
                <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", fontStyle: "italic" }}>
                  Set company-wide — open Settings to change who can edit records in this stage.
                </span>
              ) : (
                <>
                  <select value={editWhoMode} onChange={e => setEditWhoMode(e.target.value as "everyone" | "people" | "groups")}
                    style={{ ...dSel, maxWidth: 230 }}>
                    <option value="everyone">Everyone with access</option>
                    <option value="people" disabled={people === null && editWhoMode !== "people"}>Only people I pick</option>
                    <option value="groups">Only groups I pick</option>
                  </select>
                  {editWhoMode !== "everyone" && (
                    <>
                      {editorEntries.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {editorEntries.map(w => simpleChip(`ed-${w.kind}-${w.id}`, whoLabel(w), () => removeWho(w)))}
                        </div>
                      )}
                      {editWhoMode === "people" ? (
                        people === null ? (
                          <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", fontStyle: "italic" }}>
                            People can only be picked from inside this company's own Settings.
                          </span>
                        ) : (
                          <AddSearchPick
                            placeholder="Add a person…"
                            searchPlaceholder="Type a name to search…"
                            sections={[{ label: null, opts: people.filter(p2 => !editorPicked(p2.value)) }]}
                            onPick={v => addEditorPick(`u:${v}`)}
                          />
                        )
                      ) : (
                        <AddSearchPick
                          placeholder="Add a group…"
                          searchPlaceholder="Search groups…"
                          sections={(() => {
                            const opts = groups.filter(g => !editorPicked(g.id));
                            const mk = (g: UserGroup) => ({ value: g.id, label: g.name });
                            return [
                              { label: "User groups", opts: opts.filter(g => !isOrgAudienceId(g.id) && !isRoleAudienceId(g.id)).map(mk) },
                              { label: "Business units / Divisions / Departments", opts: opts.filter(g => isOrgAudienceId(g.id)).map(mk) },
                              { label: "Job roles", opts: opts.filter(g => isRoleAudienceId(g.id)).map(mk) },
                            ];
                          })()}
                          onPick={v => addEditorPick(`g:${v}`)}
                        />
                      )}
                      {editorEntries.length === 0 && !docRestricted && (
                        <span style={{ fontSize: 12, color: "#b45309" }}>
                          Pick at least one — until then, everyone can still edit records in "{stage}".
                        </span>
                      )}
                      {editorEntries.length === 0 && docRestricted && ownerEntries.length > 0 && (
                        <span style={{ fontSize: 12, color: "#b45309" }}>
                          Right now only people allowed to move records out of "{stage}" can edit here.
                        </span>
                      )}
                      {editorEntries.length > 0 && ownerEntries.length > 0 && (
                        <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>
                          People allowed to move records out of "{stage}" can always edit too.
                        </span>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Edge-case warnings — rendered ABOVE the green readback so problems
              are impossible to miss. Live-updates as the answers change. */}
          {edgeWarns.length > 0 && (
            <div style={{ margin: "12px 2px 0", display: "flex", flexDirection: "column", gap: 8 }}>
              {(["red", "amber"] as const).map(sev => {
                const list = edgeWarns.filter(w => w.sev === sev);
                if (list.length === 0) return null;
                const fg = sev === "red" ? "#b91c1c" : "#92400e";
                return (
                  <div key={sev} style={{
                    padding: "8px 11px", borderRadius: 8, display: "flex", flexDirection: "column", gap: 6,
                    background: sev === "red" ? "rgba(220,38,38,0.06)" : "rgba(217,119,6,0.07)",
                    border: sev === "red" ? "1px solid rgba(220,38,38,0.35)" : "1px solid rgba(217,119,6,0.3)",
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: fg }}>
                      {sev === "red" ? "These rules fight each other" : "Worth double-checking"}
                    </span>
                    {list.map(w => (
                      <span key={w.key} style={{ fontSize: 12, lineHeight: 1.55, color: fg }}>
                        {sev === "red" ? "⛔" : "⚠"} {w.text}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Plain-English readback — lives right under the questions so it
              updates in place as answers change above (it derives from the
              same draft state the questions edit). */}
          {(reqFields.length > 0 || simpleLockRows.length > 0 || skipRules.length > 0 || (!recordScope && docRestricted && editorEntries.length > 0)) && (
            <div style={{ margin: "12px 2px 0", fontSize: 12.5, lineHeight: 1.6, padding: "8px 11px", borderRadius: 8, background: "hsl(var(--muted) / 0.5)", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              {reqFields.length > 0 && <>To move a record to "{stage}", <b>{reqFields.map(f => friendlyFieldLabel(f, mod)).join(", ")}</b> must be filled in.{" "}</>}
              {simpleLockRows.length > 0 && <>Once in "{stage}", <b>{[...new Set(simpleLockRows.map(x => friendlyFieldLabel(x.field, mod)))].join(", ")}</b> can't be changed.{" "}</>}
              {skipRules.length > 0 && <>"{stage}" is skipped when {skipRules.map(({ r }) => `${condFieldOpts.find(o => o.value === r.field)?.label ?? r.field} is "${r.value}"`).join(" or ")}.{" "}</>}
              {!recordScope && docRestricted && editorEntries.length > 0 && <>Only <b>{editorEntries.map(whoLabel).join(", ")}</b>{ownerEntries.length > 0 ? " (plus anyone who can move records here)" : ""} can edit records in "{stage}" — everyone else can view them.</>}
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div style={{ borderTop: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.3)", padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
          {/* Save row — always on its own line so it's never crowded out */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button size="sm" style={{ height: 32, fontSize: 13, padding: "0 16px", marginLeft: "auto", minWidth: 72,
              background: dirty ? "#16a34a" : undefined,
              color: dirty ? "#fff" : undefined,
              borderColor: dirty ? "#16a34a" : undefined,
            }} disabled={saving || !dirty} onClick={onSave}>
              {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
          </div>
          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>Everything here applies to "{stage}" — locked fields stay locked from "{stage}" onward.</span>
          {/* ── Field preview panel (always visible) ── */}
          <div style={{ borderTop: "1px dashed hsl(var(--border))", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "hsl(var(--muted-foreground))" }}>
              What your team sees on this stage
            </span>
            {pv.configured.length === 0 && skipRules.length === 0 && pv.editable.length === 0 && (
              <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>No rules set yet — all fields are freely editable.</span>
            )}
            {/* Skip notice — shown before field rows */}
            {skipRules.length > 0 && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 7, padding: "5px 8px", borderRadius: 6, background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.35)" }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, flexShrink: 0, background: "#d97706", color: "#fff", marginTop: 1 }}>Skipped</span>
                <span style={{ fontSize: 12, color: "hsl(var(--foreground))", lineHeight: 1.5 }}>
                  "{stage}" is automatically skipped when{" "}
                  {skipRules.map(({ r }, i) => (
                    <span key={i}>
                      {i > 0 && <> or </>}
                      <b>{condFieldOpts.find(o => o.value === r.field)?.label ?? r.field}</b> = "{r.value}"
                    </span>
                  ))}
                </span>
              </div>
            )}
            {/* Configured rows — mandatory / hidden / locked / read-only */}
            {pv.configured.map(r => {
              const isReq   = r.rank === 4;
              const isHid   = r.rank === 3;
              const isLock  = r.rank === 2;
              const bg    = isReq ? "#d97706" : isHid ? "#dc2626" : isLock ? "#0369a1" : "#6d28d9";
              const label = isReq ? "Must fill in" : isHid ? "Hidden" : isLock ? "Can't change" : "Read-only";
              return (
                <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: "hsl(var(--foreground))", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, flexShrink: 0, background: bg, color: "#fff", letterSpacing: 0.2 }}>
                    {label}
                  </span>
                </div>
              );
            })}
            {/* Editable fields — collapsed by default, expandable */}
            {pv.editable.length > 0 && (
              <>
                <button type="button" onClick={() => setPvShowAll(v => !v)}
                  style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "hsl(var(--muted))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))" }}>
                    {pv.editable.length} freely editable
                  </span>
                  <span style={{ fontSize: 10.5 }}>{pvShowAll ? "▲ hide" : "▼ show all"}</span>
                </button>
                {pvShowAll && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 4, borderLeft: "2px solid hsl(var(--border))", maxHeight: 160, overflowY: "auto" }}>
                    {pv.editable.map(f => (
                      <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", flex: 1 }}>{f.label}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, flexShrink: 0, background: "hsl(var(--muted))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))" }}>
                          Editable
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </aside>
    </>,
    document.body,
  );
}

const selStyle: React.CSSProperties = {
  height: 32, fontSize: 13, borderRadius: 6, padding: "0 8px",
  border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
  color: "hsl(var(--foreground))", outline: "none", cursor: "pointer",
};

/** Single-stage <select> with an inline "add custom stage" flow — the same
 *  capability the multi-pick stage pickers have. Adding registers the stage
 *  in the shared draft workflow (via onAddCustom), so every other stage
 *  picker on the page sees it immediately.
 *  Note the value mapping: "" must map to the disabled placeholder option
 *  explicitly — an unmatched value makes browsers DISPLAY the first enabled
 *  option while state stays empty, so the dropdown would lie. */
export function StageSelectWithCustom({ value, stages, onPick, onAddCustom }: {
  value: string;
  stages: string[];
  onPick: (stage: string) => void;
  /** Registers the stage into the draft workflow; returns the canonical name. */
  onAddCustom: (name: string) => string;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const inPick = stages.some(s => s.trim().toLowerCase() === value.trim().toLowerCase());
  const commit = () => {
    const v = text.trim();
    setAdding(false); setText("");
    if (!v) return;
    const canonical = onAddCustom(v);
    if (canonical) onPick(canonical);
  };
  if (adding) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <input autoFocus type="text" value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { setAdding(false); setText(""); }
          }}
          placeholder="New stage name…"
          style={{ ...selStyle, cursor: "text", width: 170 }} />
        <button type="button" onClick={commit} style={{
          height: 32, padding: "0 12px", fontSize: 12, borderRadius: 6, fontWeight: 600,
          background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))",
          border: "none", cursor: "pointer",
        }}>Add</button>
        <button type="button" title="Cancel" onClick={() => { setAdding(false); setText(""); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex", padding: 2 }}>
          <X style={{ width: 13, height: 13 }} />
        </button>
      </span>
    );
  }
  return (
    <select value={value.trim() === "" ? "" : (inPick ? value : "__custom__")} style={selStyle}
      onChange={e => {
        if (e.target.value === "__addcustom__") { setAdding(true); return; }
        if (e.target.value !== "__custom__") onPick(e.target.value);
      }}>
      <option value="" disabled>Pick a stage…</option>
      {stages.map(s => <option key={s} value={s}>{s}</option>)}
      {!inPick && value.trim() !== "" && (
        <option value="__custom__">{value} (not in stage list)</option>
      )}
      <option value="__addcustom__">＋ Custom stage…</option>
    </select>
  );
}

/** Compact ORDERED stage-list editor (#131) for a workflow's own stages —
 *  numbered chips with up/down/remove plus an add box. Removal is blocked at
 *  2 stages (the server drops 1-stage lists as meaningless). */
function OrderedStageChips({ stages, onChange, suggestions }: {
  stages: string[];
  onChange: (next: string[]) => void;
  /** Stage-name suggestions (module workflow + in-use statuses) for the add box. */
  suggestions: string[];
}) {
  const [text, setText] = useState("");
  const norm = (s: string) => s.trim().toLowerCase();
  const add = () => {
    const v = text.trim();
    setText("");
    if (!v || stages.some(s => norm(s) === norm(v)) || stages.length >= 30) return;
    onChange([...stages, v]);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const tinyBtn: React.CSSProperties = {
    width: 20, height: 20, borderRadius: 4, border: "none", background: "transparent",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 0,
  };
  const listId = useMemo(() => `wt-stage-suggest-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {stages.map((s, i) => (
          <span key={`${s}-${i}`} style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 6px 3px 8px",
            borderRadius: 999, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
            fontSize: 12.5, fontWeight: 600, color: "hsl(var(--foreground))",
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: "50%", background: "hsl(var(--primary))",
              color: "#fff", fontSize: 10.5, fontWeight: 700,
              display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>{i + 1}</span>
            {s}
            <button type="button" title="Move earlier" style={{ ...tinyBtn, opacity: i === 0 ? 0.3 : 1 }} disabled={i === 0} onClick={() => move(i, -1)}>
              <ChevronUp style={{ width: 13, height: 13 }} />
            </button>
            <button type="button" title="Move later" style={{ ...tinyBtn, opacity: i === stages.length - 1 ? 0.3 : 1 }} disabled={i === stages.length - 1} onClick={() => move(i, 1)}>
              <ChevronDown style={{ width: 13, height: 13 }} />
            </button>
            <button type="button"
              title={stages.length <= 2 ? "A workflow needs at least 2 stages" : "Remove stage"}
              disabled={stages.length <= 2}
              style={{ ...tinyBtn, opacity: stages.length <= 2 ? 0.3 : 1 }}
              onClick={() => onChange(stages.filter((_, j) => j !== i))}>
              <X style={{ width: 12, height: 12, color: stages.length <= 2 ? undefined : "#ef4444" }} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="text" value={text} list={listId}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Add a stage…"
          style={{ ...selStyle, cursor: "text", width: 180, height: 28, fontSize: 12.5 }} />
        <datalist id={listId}>
          {suggestions.filter(s => !stages.some(x => norm(x) === norm(s))).map(s => <option key={s} value={s} />)}
        </datalist>
        <button type="button" onClick={add} disabled={!text.trim()}
          style={{
            height: 28, padding: "0 10px", fontSize: 12, borderRadius: 6, fontWeight: 600,
            background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))",
            border: "none", cursor: text.trim() ? "pointer" : "not-allowed", opacity: text.trim() ? 1 : 0.5,
          }}>Add</button>
      </div>
    </div>
  );
}

function WarnNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "#d97706", marginTop: 6, lineHeight: 1.45 }}>
      <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

/** Green ✓ save button shown at the bottom of each rule-tab panel. */
function SaveCheckButton({ saving, dirty, onSave }: { saving: boolean; dirty: boolean; onSave: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !dirty}
        title={dirty ? "Save changes" : "All changes saved"}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 22px", borderRadius: 10,
          fontSize: 14, fontWeight: 700, cursor: saving || !dirty ? "not-allowed" : "pointer",
          border: "none",
          background: dirty ? "#16a34a" : "hsl(var(--muted))",
          color: dirty ? "#fff" : "hsl(var(--muted-foreground))",
          transition: "background .2s, color .2s",
          opacity: saving ? 0.7 : 1,
          boxShadow: dirty ? "0 2px 8px rgba(22,163,74,0.25)" : "none",
        }}
      >
        {saving
          ? <Loader2 style={{ width: 18, height: 18, animation: "spin 1s linear infinite" }} />
          : <Check style={{ width: 18, height: 18 }} />
        }
        {saving ? "Saving…" : dirty ? "Save" : "Saved"}
      </button>
    </div>
  );
}

export default function StageRulesSettings({ tenantId }: { tenantId?: string | null }) {
  const { toast } = useToast();
  // Instant render: boot from the session seed (last docs this session — the
  // settings hub pre-warms them), else the app-wide rules singleton (own
  // tenant; warm from sign-in). A background refetch revalidates either way.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time seed only
  const boot = useMemo((): Partial<StageRulesSeed> | null => {
    if (tenantId === null) return null;
    const s = getSeed<StageRulesSeed>(`stageRules:${seedScope(tenantId)}`);
    if (s) return s;
    if (tenantId === undefined && stageRulesLoaded()) {
      const st = getStageRules();
      return { rules: st.rules, stageOrder: st.stageOrder };
    }
    return null;
  }, []);
  const [rules, setRulesRaw] = useState<StageRules>(boot?.rules ?? EMPTY_STAGE_RULES);
  const [stageOrder, setStageOrder] = useState<StageOrderMap>(boot?.stageOrder ?? { PMM: null, OPM: null, LEM: null });
  const [savedSnapshot, setSavedSnapshot] = useState<string>(JSON.stringify(boot?.rules ?? EMPTY_STAGE_RULES));
  const [loading, setLoading] = useState(!boot);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Known status values per module (own-tenant only) — extra suggestions for
  // the skip-stage picker beyond the evaluation order.
  const [statusOpts, setStatusOpts] = useState<Record<StageRuleModule, string[]>>({ PMM: [], OPM: [], LEM: [] });
  // Per-stage permissions (#87): who may act at each stage. Saved as its own
  // doc but edited on this page (same mental model as locks/skips).
  const [perms, setPermsRaw] = useState<StagePermRule[]>(boot?.perms ?? []);
  const [permsSnapshot, setPermsSnapshot] = useState<string>(JSON.stringify(boot?.perms ?? []));
  const [groups, setGroups] = useState<UserGroup[]>(boot?.groups ?? []);
  // Org units (BU / Division / Department) as live audiences — shaped as
  // pseudo-groups so every picker on this page can target them alongside
  // real groups. DISPLAY-only: never saved into the user-groups doc.
  const [orgAuds, setOrgAuds] = useState<UserGroup[]>([]);
  // True once the group list has loaded successfully at least once (a seed
  // counts — seeds only ever hold successful loads). Until then the pickers
  // say "Loading groups…" instead of falsely claiming no groups exist.
  const [groupsReady, setGroupsReady] = useState<boolean>(!!boot);
  // Stage-chips popup: { mod, idx } of the workflow type whose stages are being edited.
  const [stageChipsDialog, setStageChipsDialog] = useState<{ mod: StageRuleModule; idx: number } | null>(null);
  // One-shot retry when the (silently caught) groups fetch fails — a single
  // blip must not leave the rule editors claiming the tenant has no groups.
  const groupsRetriedRef = useRef(false);
  const [people, setPeople] = useState<{ value: string; label: string }[]>([]);
  // Group colors (#119): shared groupColorMap so chips here match the User
  // Groups settings page and what the server persists on save.
  // Pickers offer real groups PLUS live org-unit audiences (org pseudo-groups
  // carry fixed colors, so real group colors are unaffected).
  const pickGroups = useMemo(() => [...groups, ...orgAuds], [groups, orgAuds]);
  const groupColors = useMemo(() => groupColorMap(pickGroups), [pickGroups]);
  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g] as const)), [groups]);
  // Hovering any group name shows its members. Names resolve from the
  // own-tenant roster only — superadmin managing another tenant gets the
  // member-count fallback (own roster would be the wrong tenant's people).
  const memberNamesOf = useGroupMemberNames(tenantId === undefined);
  const groupHoverWrap = (value: string, node: ReactNode): ReactNode => {
    const g = groupById.get(value);
    if (!g) return node;
    return (
      <GroupMembersHover groupName={g.name} memberIds={g.memberIds} names={memberNamesOf(g.memberIds)}>
        {node}
      </GroupMembersHover>
    );
  };
  // Delete-row confirmation (#stage-assignment): trash icon asks first instead
  // of removing the rule instantly. Tracks the ROW OBJECT, not its index — a
  // background refetch can replace/reorder perms while the modal is open, and
  // an index would then delete the wrong row. Identity match fails safe.
  const [confirmDelPerm, setConfirmDelPerm] = useState<StagePermRule | null>(null);
  useEffect(() => {
    if (confirmDelPerm && !perms.includes(confirmDelPerm)) setConfirmDelPerm(null);
  }, [perms, confirmDelPerm]);
  useEffect(() => {
    if (!confirmDelPerm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirmDelPerm(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelPerm]);

  // Background refetches must never clobber a draft the user already started
  // — guarded per doc, so an untouched doc still freshens silently.
  const rulesDirtyRef = useRef(false);
  const permsDirtyRef = useRef(false);
  // Stale-response guard: a load resolving after a newer load, a tenant
  // switch, or a save must not apply. Bumping the seq invalidates everything
  // in flight.
  const loadSeqRef = useRef(0);
  // User-edit setters mark their doc dirty SYNCHRONOUSLY — the memo-driven
  // effect below lags one render, which is enough for a resolving background
  // fetch to clobber a just-started draft. Load/save paths use the raw setters.
  const setRules = useCallback((v: StageRules | ((prev: StageRules) => StageRules)) => {
    rulesDirtyRef.current = true;
    setRulesRaw(v);
  }, []);
  const setPerms = useCallback((v: StagePermRule[] | ((prev: StagePermRule[]) => StagePermRule[])) => {
    permsDirtyRef.current = true;
    setPermsRaw(v);
  }, []);

  const load = useCallback(async (background: boolean) => {
    if (tenantId === null) { setLoading(false); return; }
    const seq = ++loadSeqRef.current;
    if (!background) { setLoading(true); setLoadErr(null); }
    try {
      const [st, permRules, groupList, orgList] = await Promise.all([
        fetchStageRulesFor(tenantId ?? undefined),
        fetchStagePermissions(tenantId ?? undefined),
        // null = fetch FAILED — not "tenant has no groups". Never seed that.
        fetchUserGroups(tenantId ?? undefined).catch(() => null),
        // Org units for live BU/Division/Dept audiences ([] on failure —
        // pickers then offer real groups only; saved org ids still resolve).
        fetchOrgAudienceGroups(tenantId ?? undefined).catch(() => [] as UserGroup[]),
      ]);
      if (seq !== loadSeqRef.current) return; // superseded (tenant switch / save)
      const seedKey = `stageRules:${seedScope(tenantId)}`;
      // Hollow-cache rule: a failed groups fetch must not overwrite previously
      // good seeded groups with a synthetic empty list.
      const seedGroups = groupList ?? getSeed<StageRulesSeed>(seedKey)?.groups ?? [];
      setSeed<StageRulesSeed>(seedKey, {
        rules: st.rules, stageOrder: st.stageOrder, perms: permRules, groups: seedGroups,
      });
      if (!background || !rulesDirtyRef.current) {
        setRulesRaw(st.rules);
        setStageOrder(st.stageOrder);
        setSavedSnapshot(JSON.stringify(st.rules));
      }
      if (!background || !permsDirtyRef.current) {
        setPermsRaw(permRules);
        setPermsSnapshot(JSON.stringify(permRules));
      }
      if (groupList) {
        setGroups(groupList);
        setGroupsReady(true);
        groupsRetriedRef.current = false;
      } else if (!groupsRetriedRef.current) {
        // Groups fetch failed (rules/perms still loaded) — retry once shortly.
        groupsRetriedRef.current = true;
        setTimeout(() => { if (seq === loadSeqRef.current) void load(true); }, 1500);
      }
      // Org units apply regardless of the groups outcome; a failed org fetch
      // just leaves previously loaded units in place.
      if (orgList.length > 0) setOrgAuds(orgList);
    } catch (e) {
      if (seq !== loadSeqRef.current) return; // superseded
      // Background refresh failure: keep showing the seeded docs (stale-if-error).
      if (!background) setLoadErr(e instanceof Error ? e.message : "Could not load stage rules");
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [tenantId]);
  // First run: revalidate (in the background when booted from a seed).
  // Tenant switches (superadmin): boot the new tenant's seed or spin.
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      void load(!!boot);
      return;
    }
    if (tenantId === null) { setLoading(false); return; }
    const s = getSeed<StageRulesSeed>(`stageRules:${seedScope(tenantId)}`);
    if (s) {
      setRulesRaw(s.rules);
      setStageOrder(s.stageOrder);
      setSavedSnapshot(JSON.stringify(s.rules));
      setPermsRaw(s.perms);
      setPermsSnapshot(JSON.stringify(s.perms));
      setGroups(s.groups);
      setGroupsReady(true);
      setLoading(false);
      setLoadErr(null);
      // Fresh docs for this tenant — any draft belonged to the previous one.
      rulesDirtyRef.current = false;
      permsDirtyRef.current = false;
      void load(true);
    } else {
      void load(false);
    }
  }, [boot, load, tenantId]);

  // Groups edited elsewhere (User Groups tab) broadcast a version bump —
  // background-refresh so new groups appear in the pickers immediately.
  // Dirty-doc guards inside load() keep any in-progress edits untouched.
  const permsVersion = usePermissionsVersion();
  const permsVerRef = useRef(permsVersion);
  useEffect(() => {
    if (permsVerRef.current === permsVersion) return;
    permsVerRef.current = permsVersion;
    void load(true);
  }, [permsVersion, load]);

  useEffect(() => {
    // People picker uses the signed-in tenant's roster — cross-tenant
    // superadmin edits assign by GROUP (or existing raw IDs) only.
    if (tenantId !== undefined) return;
    let alive = true;
    getUserList()
      .then((raw) => {
        if (!alive || !Array.isArray(raw)) return;
        const opts = (raw as Record<string, unknown>[])
          .map((u) => ({
            value: String(u.Id ?? u.id ?? ""),
            label: String(u.Name ?? u.name ?? u.UserName ?? u.username ?? ""),
          }))
          .filter((p) => p.value && p.label)
          .sort((a, b) => a.label.localeCompare(b.label));
        setPeople(opts);
      })
      .catch(() => { /* pickers fall back to raw IDs */ });
    return () => { alive = false; };
  }, [tenantId]);

  useEffect(() => {
    // Cross-tenant superadmin edits fall back to the stage order + builtins;
    // status options come from the admin's OWN tenant so they'd be wrong here.
    if (tenantId !== undefined) return;
    let alive = true;
    (async () => {
      for (const m of STAGE_RULE_MODULES) {
        try {
          const o = await getFieldOptions("status", m);
          if (alive && Array.isArray(o)) setStatusOpts(p => ({ ...p, [m]: o }));
        } catch { /* suggestions only — ignore */ }
      }
    })();
    return () => { alive = false; };
  }, [tenantId]);

  // The stage list rules are EVALUATED against (server does the same):
  // the DRAFT custom workflow when present (so lock/skip pickers follow the
  // Workflow Stages card before saving), then the tenant-configured order,
  // otherwise the built-in fallback.
  const evalOrderFor = useCallback(
    (m: StageRuleModule) => rules.stageOrder?.[m] ?? stageOrder[m] ?? FALLBACK_STAGE_ORDER[m],
    [rules.stageOrder, stageOrder],
  );
  const stagePickFor = useCallback((m: StageRuleModule) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of [...evalOrderFor(m), ...statusOpts[m]]) {
      const k = s.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(s);
    }
    return out;
  }, [evalOrderFor, statusOpts]);

  // Adding a custom stage from ANY picker registers it in the draft workflow
  // (rules.stageOrder[module]) — the shared list every stage picker reads —
  // so locks, skips, workflow types, form layout and who-can-act all stay in
  // sync, and saving persists it as part of the workflow itself (which also
  // makes lock rules anchored on it actually evaluate, and record pages show
  // it in steppers/dropdowns). Returns the canonical spelling.
  const registerCustomStage = useCallback((m: StageRuleModule, name: string): string => {
    const v = name.trim();
    if (!v) return "";
    const base = rules.stageOrder?.[m] ?? stageOrder[m] ?? FALLBACK_STAGE_ORDER[m];
    const existing = base.find(s => s.trim().toLowerCase() === v.toLowerCase());
    if (existing) return existing; // already a stage — reuse its spelling
    // Server caps workflows at 30 stages — keep the rule's value but skip
    // registering rather than silently losing the 31st on save.
    if (base.length >= 30) return v;
    setRules(r => {
      const cur = r.stageOrder?.[m] ?? stageOrder[m] ?? FALLBACK_STAGE_ORDER[m];
      if (cur.some(s => s.trim().toLowerCase() === v.toLowerCase()) || cur.length >= 30) return r;
      return { ...r, stageOrder: { ...(r.stageOrder ?? {}), [m]: [...cur, v] } };
    });
    return v;
  }, [rules.stageOrder, stageOrder, setRules]);

  // Shared skip-value cache for the outer SkipsCard — same makeSkipValCache
  // factory as StageRuleDrawer so SKIP_VALUE_LOADERS is the single registry.
  // Adding a new condition field to that map automatically works in both
  // surfaces without a second edit.  Cross-tenant: values would come from the
  // caller's own tenant and be wrong for the company being edited.
  const outerSkipCacheRef = useRef(makeSkipValCache());
  const [outerSkipVer, setOuterSkipVer] = useState(0);
  const bumpOuterSkipVer = useCallback(() => setOuterSkipVer(v => v + 1), []);
  useEffect(() => {
    if (tenantId !== undefined) return; // cross-tenant: skip loading
    for (const f of new Set(rules.stageSkips.map(r => r.field))) {
      outerSkipCacheRef.current.ensureSkipVals(f, bumpOuterSkipVer);
    }
  }, [rules.stageSkips, tenantId, bumpOuterSkipVer]);
  /** Value options for the outer SkipsCard dropdowns ([] until loaded or no loader). */
  const outerSkipValsFor = useCallback((field: string): string[] => {
    void outerSkipVer; // subscribe to re-renders
    return outerSkipCacheRef.current.skipValsFor(field);
  }, [outerSkipVer]);

  const rulesDirty = useMemo(() => JSON.stringify(rules) !== savedSnapshot, [rules, savedSnapshot]);
  const permsDirty = useMemo(() => JSON.stringify(perms) !== permsSnapshot, [perms, permsSnapshot]);
  const dirty = rulesDirty || permsDirty;
  useEffect(() => {
    rulesDirtyRef.current = rulesDirty;
    permsDirtyRef.current = permsDirty;
  }, [rulesDirty, permsDirty]);

  const doSave = async () => {
    // Half-finished rules are SILENTLY dropped by the server's sanitizer —
    // the toast would say "saved" while the rule vanishes. Block the save
    // and point at the unfinished rule instead.
    const badLock = rules.fieldLocks.findIndex(r => r.fields.length === 0 || r.stage.trim() === "");
    if (badLock >= 0) {
      setActiveTab("locks");
      const r = rules.fieldLocks[badLock];
      toast({
        title: "A lock rule isn't finished",
        description: `Rule ${badLock + 1} under "Lock fields by stage" still needs ${r.fields.length === 0 ? "at least one field to lock" : "a stage picked"}. Finish it or remove it, then save again.`,
        variant: "destructive",
      });
      return;
    }
    const badSkip = rules.stageSkips.findIndex(r => r.field.trim() === "" || r.value.trim() === "" || r.skipStages.length === 0);
    if (badSkip >= 0) {
      setActiveTab("skips");
      const r = rules.stageSkips[badSkip];
      toast({
        title: "A skip rule isn't finished",
        description: `Rule ${badSkip + 1} under "Skip stages" still needs ${r.field.trim() === "" ? "a field picked" : r.value.trim() === "" ? "a value to match" : "at least one stage to skip"}. Finish it or remove it, then save again.`,
        variant: "destructive",
      });
      return;
    }
    const badLayout = (rules.formLayout ?? []).findIndex(r => r.stage.trim() === "" || (r.hidden.length === 0 && r.readOnly.length === 0));
    if (badLayout >= 0) {
      setActiveTab("layout");
      const r = (rules.formLayout ?? [])[badLayout];
      toast({
        title: "A form-layout rule isn't finished",
        description: `Rule ${badLayout + 1} under "Form layout by stage" still needs ${r.stage.trim() === "" ? "a stage picked" : "at least one read-only or hidden field"}. Finish it or remove it, then save again.`,
        variant: "destructive",
      });
      return;
    }
    const badTypeMod = STAGE_RULE_MODULES.find(m => (rules.workflowTypes?.[m] ?? []).some(t => wtName(t).trim() === ""));
    if (badTypeMod) {
      setActiveTab("types");
      toast({
        title: "A workflow type has no name",
        description: `One of the ${MODULE_LABELS[badTypeMod]} workflow types is blank. Give it a name or remove it, then save again.`,
        variant: "destructive",
      });
      return;
    }
    const dupTypeMod = STAGE_RULE_MODULES.find(m => {
      const l = (rules.workflowTypes?.[m] ?? []).map(t => wtName(t).trim().toLowerCase());
      return new Set(l).size !== l.length;
    });
    if (dupTypeMod) {
      setActiveTab("types");
      toast({
        title: "Two workflow types have the same name",
        description: `${MODULE_LABELS[dupTypeMod]} has duplicate workflow type names. Rename or remove one, then save again.`,
        variant: "destructive",
      });
      return;
    }
    // A 1-stage custom stage list is SILENTLY dropped by the server sanitizer
    // (the workflow would fall back to the module order while the toast says
    // "saved") — block and explain instead. UI prevents this, but belt-and-braces.
    const badStagesMod = STAGE_RULE_MODULES.find(m =>
      (rules.workflowTypes?.[m] ?? []).some(t => wtStages(t).length === 1));
    if (badStagesMod) {
      setActiveTab("types");
      toast({
        title: "A workflow's stage list is too short",
        description: `One of the ${MODULE_LABELS[badStagesMod]} workflows has only 1 stage in its own stage list. Add at least one more stage, or switch it back to the module workflow, then save again.`,
        variant: "destructive",
      });
      return;
    }
    const badPerm = perms.findIndex(r => r.stage.trim() === "");
    if (badPerm >= 0) {
      setActiveTab("who");
      toast({
        title: 'A "Who can act" rule isn\'t finished',
        description: `Rule ${badPerm + 1} under "Who can act at each stage" still needs a stage picked. Finish it or remove it, then save again.`,
        variant: "destructive",
      });
      return;
    }
    // Block saving a rule that has a stage but nobody assigned — it would
    // silently freeze that stage for everyone, which is never intentional.
    // Only enforced when the perms doc itself changed, so a legacy empty rule
    // never blocks saves of the OTHER tabs (docs save independently below).
    const emptyPerm = !permsDirty ? -1 : perms.findIndex(r =>
      r.stage.trim() !== "" &&
      (r.actionUserIds?.length ?? 0) === 0 &&
      (r.actionGroupIds?.length ?? 0) === 0 &&
      (r.editorUserIds?.length ?? 0) === 0 &&
      (r.editorGroupIds?.length ?? 0) === 0
    );
    if (emptyPerm >= 0) {
      setActiveTab("who");
      toast({
        title: 'Assign someone before saving',
        description: `The "${perms[emptyPerm].stage}" rule under "Who can act" has no stage owners or data editors. Assign at least one person or group, or remove the rule.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    // Invalidate in-flight loads so a stale response can't overwrite the save.
    loadSeqRef.current++;
    // ── Single-Everyone rule (#user bug): a GROUP-scoped stage set loaded in
    // the editor (or content-matching one) must save into the SET — never
    // into the module's Everyone default. Refresh the set (+ its workflow-
    // type stage copy), then put stageOrder back to the last-saved value.
    let effRules = rules;
    const scopedTargets: { m: StageRuleModule; tpl: WorkflowTemplate }[] = [];
    if (rulesDirty) {
      let base: StageRules | null = null;
      try { base = JSON.parse(savedSnapshot) as StageRules; } catch { base = null; }
      if (base) {
        const scopeOf = (t: WorkflowTemplate) => t.applyMode ?? ((t.groupIds ?? []).length ? "groups" : "everyone");
        const changed = (m: StageRuleModule) =>
          JSON.stringify(rules.stageOrder?.[m] ?? null) !== JSON.stringify(base?.stageOrder?.[m] ?? null);
        const lt = loadedTpl ? templates.find(x => x.id === loadedTpl.id) : null;
        // While a set is explicitly loaded, its module's identity is KNOWN —
        // the content belt must stay out (an everyone-holder edit that happens
        // to equal a group set's stages must NOT be routed into that set).
        const reserved = lt && loadedTpl ? loadedTpl.mod : null;
        if (lt && loadedTpl && scopeOf(lt) !== "everyone" && changed(loadedTpl.mod))
          scopedTargets.push({ m: loadedTpl.mod, tpl: lt });
        // Belt: an edited order that still content-matches a scoped set (e.g.
        // color-only changes, or a set loaded before this tracking existed).
        const norm = (a: string[]) => a.map(s => s.trim().toLowerCase()).join("\u0000");
        for (const m of STAGE_RULE_MODULES) {
          if (m === reserved || scopedTargets.some(t => t.m === m) || !changed(m)) continue;
          const curStages = rules.stageOrder?.[m];
          if (!curStages || curStages.length < 2) continue;
          const hits = templates.filter(x => (!x.module || x.module === m) && norm(x.stages) === norm(curStages));
          // Content tie → the everyone holder wins (same rule as matchedTpl):
          // an edit that lands on the default's own steps must never be routed
          // into a group set that happens to share them.
          const t = hits.find(x => scopeOf(x) === "everyone") ?? hits[0] ?? null;
          if (t && scopeOf(t) !== "everyone") scopedTargets.push({ m, tpl: t });
        }
      }
      if (base && scopedTargets.length) {
        const so = { ...(effRules.stageOrder ?? {}) };
        let types = effRules.workflowTypes;
        for (const { m, tpl } of scopedTargets) {
          const stagesNow = rules.stageOrder?.[m] ?? tpl.stages;
          if (stagesNow.length >= 2) {
            // Keep the set's workflow-TYPE stage copy in step (the runtime
            // side of "who does it apply to"). The set itself is persisted —
            // awaited — in the try block below, BEFORE the rules doc is saved.
            const list = types?.[m];
            const nm = tpl.name.trim().toLowerCase();
            const idx = (list ?? []).findIndex(e => (typeof e === "string" ? e : e.name).trim().toLowerCase() === nm);
            if (list && idx >= 0) {
              const prevEntry = list[idx];
              const newList = [...list];
              newList[idx] = wtEntry(tpl.name, wtGroups(prevEntry), wtUsers(prevEntry), [...stagesNow]);
              types = { ...(types ?? {}), [m]: newList } as StageRules["workflowTypes"];
            }
          }
          // The Everyone default reverts to what was last saved for this module.
          const prevVal = base.stageOrder?.[m];
          if (prevVal && prevVal.length >= 2) so[m] = prevVal; else delete so[m];
        }
        effRules = { ...effRules };
        if (types) effRules.workflowTypes = types;
        if (Object.keys(so).length) effRules.stageOrder = so as StageRules["stageOrder"];
        else delete effRules.stageOrder;
      }
    }
    try {
      // Two docs, saved independently — only the ones that changed.
      let finalRules = effRules;
      let finalOrder = stageOrder;
      let finalPerms = perms;
      if (rulesDirty) {
        // Persist edits INTO each scoped set first — awaited, so a failed
        // template save ABORTS before the rules doc is touched (otherwise the
        // revert below would silently throw the user's edits away).
        for (const { m, tpl } of scopedTargets) {
          const stagesNow = rules.stageOrder?.[m] ?? tpl.stages;
          if (stagesNow.length < 2) continue;
          if (!(await saveAsTemplate(tpl.name, m, stagesNow, rules.stageColors?.[m] ?? {}, undefined, true)))
            throw new Error(`Your edits to the stage set "${tpl.name}" could not be saved, so nothing was changed. Please try Save again.`);
        }
        // Lockstep stamp: each type's audience is exempt from its own skip
        // rule (heals docs saved before exemption stamping existed).
        const saved = await saveStageRules(stampTypeExemptions(effRules), tenantId ?? undefined);
        setRulesRaw(saved);
        setSavedSnapshot(JSON.stringify(saved));
        setLoadedTpl(null); // saved — content-matching picks the set back up
        finalRules = saved;
        // The saved workflow (stageOrder) changes the EFFECTIVE order the
        // server computes — especially a "Reset to standard", which reverts
        // to the derived order this component cannot compute locally. Refresh
        // the authoritative map so pickers + preview never show a stale order.
        try {
          const st = await fetchStageRulesFor(tenantId ?? undefined);
          setStageOrder(st.stageOrder);
          finalOrder = st.stageOrder;
        } catch { /* preview refresh only — next full load corrects it */ }
      }
      if (permsDirty) {
        const savedPerms = await saveStagePermissions(perms, tenantId ?? undefined);
        setPermsRaw(savedPerms);
        setPermsSnapshot(JSON.stringify(savedPerms));
        finalPerms = savedPerms;
      }
      // Keep the instant-render seed in step so the next visit boots on the saved docs.
      setSeed<StageRulesSeed>(`stageRules:${seedScope(tenantId)}`, {
        rules: finalRules, stageOrder: finalOrder, perms: finalPerms, groups,
      });
      toast(scopedTargets.length
        ? {
          title: `Saved — "${scopedTargets[0].tpl.name}" updated for its people only`,
          description: "Changes went into that stage set, which applies just to the groups or people it covers. The everyone default workflow was left unchanged.",
        }
        : { title: "Stage rules saved", description: "They now apply to everyone in the company." });
    } catch (e) {
      toast({
        title: "Could not save stage rules",
        description: e instanceof Error ? e.message : "Something went wrong — please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const setLock = (i: number, patch: Partial<FieldLockRule>) =>
    setRules(r => ({ ...r, fieldLocks: r.fieldLocks.map((x, j) => j === i ? { ...x, ...patch } : x) }));
  const setSkip = (i: number, patch: Partial<StageSkipRule>) =>
    setRules(r => ({ ...r, stageSkips: r.stageSkips.map((x, j) => j === i ? { ...x, ...patch } : x) }));
  const setPerm = (i: number, patch: Partial<StagePermRule>) =>
    setPerms(p => p.map((x, j) => j === i ? { ...x, ...patch } : x));
  const setLayoutRule = (i: number, patch: Partial<FormLayoutRule>) =>
    setRules(r => ({ ...r, formLayout: (r.formLayout ?? []).map((x, j) => j === i ? { ...x, ...patch } : x) }));

  // ── Workflow types (Workflow tab) ─────────────────────────────────────────
  // Type names live in rules.workflowTypes[mod]; each type's skipped stages
  // are a REGULAR stage-skip rule with field "WorkflowTypeName" — one source of
  // truth shared with the Skip-stages tab, enforcement and the record pages.
  const wtRuleIdx = (r: StageRules, mod: StageRuleModule, name: string) =>
    r.stageSkips.findIndex(s => s.module === mod && s.field === "WorkflowTypeName" && s.value.trim().toLowerCase() === name.trim().toLowerCase());
  const addWorkflowType = () => {
    const name = newTypeName.trim();
    if (!name) return;
    setRules(r => {
      const list = r.workflowTypes?.[wtMod] ?? [];
      if (list.some(t => wtName(t).trim().toLowerCase() === name.toLowerCase())) return r;
      return { ...r, workflowTypes: { ...r.workflowTypes, [wtMod]: [...list, name] } };
    });
    setNewTypeName("");
  };
  const renameWorkflowType = (mod: StageRuleModule, idx: number, next: string) =>
    setRules(r => {
      const list = [...(r.workflowTypes?.[mod] ?? [])];
      const cur = list[idx];
      const old = cur == null ? "" : wtName(cur);
      // Preserve the entry's group restrictions (#121) through renames.
      list[idx] = cur != null && typeof cur === "object" ? { ...cur, name: next } : next;
      // Keep the type's skip rule pointing at the SAME type through renames.
      const stageSkips = old.trim() === "" ? r.stageSkips : r.stageSkips.map(s =>
        s.module === mod && s.field === "WorkflowTypeName" && s.value.trim().toLowerCase() === old.trim().toLowerCase()
          ? { ...s, value: next } : s);
      return { ...r, workflowTypes: { ...r.workflowTypes, [mod]: list }, stageSkips };
    });
  const deleteWorkflowType = (mod: StageRuleModule, idx: number) =>
    setRules(r => {
      const list = [...(r.workflowTypes?.[mod] ?? [])];
      const cur = list[idx];
      const old = cur == null ? "" : wtName(cur);
      list.splice(idx, 1);
      const workflowTypes = { ...r.workflowTypes, [mod]: list };
      if (list.length === 0) delete workflowTypes[mod];
      return {
        ...r,
        workflowTypes,
        stageSkips: old.trim() === "" ? r.stageSkips : r.stageSkips.filter(s =>
          !(s.module === mod && s.field === "WorkflowTypeName" && s.value.trim().toLowerCase() === old.trim().toLowerCase())),
      };
    });
  const setTypeSkipStages = (mod: StageRuleModule, name: string, stages: string[]) =>
    setRules(r => {
      const i = wtRuleIdx(r, mod, name);
      // The type's audience rides along as the rule's exemption list — people
      // who can USE the type still SEE its skipped stages (union keeps any
      // manually-added exemptions from the Skip-stages tab).
      const entry = (r.workflowTypes?.[mod] ?? []).find(e => wtName(e).trim().toLowerCase() === name.trim().toLowerCase());
      const aud = entry ? typeAudienceIds(wtGroups(entry), wtUsers(entry)) : [];
      const stageSkips = [...r.stageSkips];
      if (stages.length === 0) { if (i >= 0) stageSkips.splice(i, 1); }
      else if (i >= 0) stageSkips[i] = restampSkipExempt({ ...stageSkips[i], skipStages: stages }, [], aud);
      else stageSkips.push(restampSkipExempt({ module: mod, field: "WorkflowTypeName", value: name, skipStages: stages }, [], aud));
      return { ...r, stageSkips };
    });
  // Patch one workflow-type entry's extras (#121/#131) while PRESERVING the
  // rest — canonical shape via wtEntry (bare string when nothing attached).
  // Audience changes (groupIds/userIds) restamp the type's skip-rule
  // exemptions in the SAME update, so "who can use it" and "who still sees
  // the skipped stages" can never drift apart.
  const patchTypeEntry = (
    mod: StageRuleModule, idx: number,
    patch: Partial<{ groupIds: string[]; userIds: string[]; stages: string[] }>,
  ) =>
    setRules(r => {
      const list = [...(r.workflowTypes?.[mod] ?? [])];
      const cur = list[idx];
      if (cur == null) return r;
      const nextGroups = patch.groupIds ?? wtGroups(cur);
      const nextUsers = patch.userIds ?? wtUsers(cur);
      list[idx] = wtEntry(wtName(cur), nextGroups, nextUsers, patch.stages ?? wtStages(cur));
      let stageSkips = r.stageSkips;
      if (patch.groupIds !== undefined || patch.userIds !== undefined) {
        const i = wtRuleIdx(r, mod, wtName(cur));
        if (i >= 0) {
          stageSkips = [...stageSkips];
          stageSkips[i] = restampSkipExempt(
            stageSkips[i],
            typeAudienceIds(wtGroups(cur), wtUsers(cur)),
            typeAudienceIds(nextGroups, nextUsers),
          );
        }
      }
      return { ...r, workflowTypes: { ...r.workflowTypes, [mod]: list }, stageSkips };
    });
  // One combined audience write — groups + people land in the SAME patch so
  // the skip-rule exemptions restamp once with the full new audience.
  const setTypeAudience = (mod: StageRuleModule, idx: number, groupIds: string[], userIds: string[]) =>
    patchTypeEntry(mod, idx, { groupIds, userIds: userIds.map(s => s.trim().toLowerCase()).filter(Boolean) });
  const setTypeStages = (mod: StageRuleModule, idx: number, stages: string[]) =>
    patchTypeEntry(mod, idx, { stages });

  // Tab state must be declared BEFORE any conditional returns (Rules of Hooks).
  const [activeTab, setActiveTab] = useState<"workflow" | "types" | "locks" | "skips" | "layout" | "who">("workflow");
  // Flow-builder mode toggle state — must be before conditional returns too.
  // Workflow-types editor state (Workflow tab).
  const [wtMod, setWtMod] = useState<StageRuleModule>("OPM");
  const [newTypeName, setNewTypeName] = useState("");

  // ── Direct record sync (types tab) ────────────────────────────────────────
  // The module's records, so admins can put records ON a type right here
  // instead of opening each record. Lazy per module; own-tenant only (a
  // superadmin editing another company would read the WRONG tenant's
  // records). Toggles write WorkflowTypeName through the SAME update-fields
  // path the record page uses — the server re-checks field locks and "who
  // can use it" membership on every write, so denials surface honestly.
  const [wtRecs, setWtRecs] = useState<Partial<Record<StageRuleModule, { id: string; label: string; wt: string }[]>>>({});
  const [wtRecsFail, setWtRecsFail] = useState<Partial<Record<StageRuleModule, boolean>>>({});
  const [wtRecBusy, setWtRecBusy] = useState<string | null>(null);
  useEffect(() => {
    if (activeTab !== "types" || tenantId !== undefined) return;
    if (wtRecs[wtMod] || wtRecsFail[wtMod]) return;
    let alive = true;
    getModuleRecords(wtMod)
      .then(resp => {
        if (!alive) return;
        const rows = (Array.isArray(resp?.data) ? resp.data : [])
          .map(a => ({
            id: String(a.TicketId ?? "").trim(),
            label: String(a.Title ?? a.ShortName ?? a.TicketId ?? "").trim(),
            wt: String(a.WorkflowTypeName ?? "").trim(),
          }))
          .filter(x => x.id)
          .sort((x, y) => x.label.localeCompare(y.label));
        setWtRecs(p => ({ ...p, [wtMod]: rows }));
      })
      .catch(() => { if (alive) setWtRecsFail(p => ({ ...p, [wtMod]: true })); });
    return () => { alive = false; };
  }, [activeTab, wtMod, tenantId, wtRecs, wtRecsFail]);
  /** One record toggled on/off a type. On = the record now uses this type;
   *  off = back to the standard workflow (clearing passes the server's
   *  restriction gate by design — it's not an assignment). */
  const applyTypeToRecord = async (mod: StageRuleModule, typeName: string, recId: string, on: boolean) => {
    if (wtRecBusy) return; // one write at a time — keeps toasts and state honest
    const rec = (wtRecs[mod] ?? []).find(x => x.id === recId);
    if (!rec) return;
    setWtRecBusy(recId);
    try {
      const res = await updateFields(recId, [{ FieldName: "WorkflowTypeName", Value: on ? typeName : "" }]);
      if (!res.ok) throw new Error(res.error || "The server rejected the change.");
      setWtRecs(p => ({ ...p, [mod]: (p[mod] ?? []).map(x => x.id === recId ? { ...x, wt: on ? typeName : "" } : x) }));
      toast({
        title: on ? "Workflow type applied" : "Workflow type removed",
        description: on
          ? `"${rec.label}" now uses the "${typeName}" workflow.`
          : `"${rec.label}" is back on the standard workflow.`,
      });
    } catch (e) {
      const err = e as Error & { friendlyMessage?: string };
      toast({
        title: "Couldn't update the record",
        description: `"${rec.label}": ${err.friendlyMessage || err.message || "Unknown error"}`,
        variant: "destructive",
      });
    } finally {
      setWtRecBusy(null);
    }
  };

  // ── Workflow TEMPLATES (#131): reusable named stage lists ────────────────
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  // Scope edits from the Manage dialog persist on every picker change — chain
  // them so rapid clicks can't interleave and a stale save can't win.
  const scopeSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const templatesChainRef = useRef<WorkflowTemplate[]>([]);
  useEffect(() => { templatesChainRef.current = templates; }, [templates]);
  // The stage set explicitly loaded into the editor via Manage→Edit. Content-
  // matching (matchedTpl) alone loses track the moment the user EDITS the
  // loaded list — plain Save then wrote the group set's stages into the
  // Everyone default (#user bug). Cleared on +New / Reset / pinned-card
  // loads and after each successful rules save.
  const [loadedTpl, setLoadedTpl] = useState<{ id: string; mod: StageRuleModule } | null>(null);
  const [templatesReady, setTemplatesReady] = useState(false); // fetch settled OK
  useEffect(() => {
    if (tenantId === null) return;
    let alive = true;
    setTemplatesReady(false);
    fetchWorkflowTemplates(tenantId ?? undefined)
      .then(t => { if (alive) { setTemplates(t); setTemplatesReady(true); } })
      .catch(() => { /* templates are a convenience — section shows a retry note */ });
    return () => { alive = false; };
  }, [tenantId]);
  // Persist the FULL list — hollow-cache rule: never overwrite the saved doc
  // from a state that never loaded it (templatesReady gate at the call sites).
  const persistTemplates = async (next: WorkflowTemplate[]): Promise<boolean> => {
    try {
      const saved = await saveWorkflowTemplates(next, tenantId ?? undefined);
      setTemplates(saved);
      return true;
    } catch (e) {
      toast({
        title: "Could not save workflow templates",
        description: e instanceof Error ? e.message : "Something went wrong — please try again.",
        variant: "destructive",
      });
      return false;
    }
  };
  const saveAsTemplate = async (
    name: string, mod: StageRuleModule, stages: string[], colors: Record<string, string>,
    scope?: { applyMode: "everyone" | "except" | "groups"; groupIds: string[] },
    quiet?: boolean, // suppress success toasts (doSave shows its own summary)
    opts?: { keepDefault?: boolean }, // create-copy flow (#user): leave the everyone default's live order untouched
  ): Promise<boolean> => {
    if (!templatesReady) return false;
    const id = tplIdOf(name);
    if (!id || stages.length < 2) return false;
    const tpl: WorkflowTemplate = { id, name: name.trim(), module: mod, stages: [...stages] };
    const tplColors: Record<string, string> = {};
    for (const s of stages) { const c = colors[s.trim().toLowerCase()]; if (c) tplColors[s.trim().toLowerCase()] = c; }
    if (Object.keys(tplColors).length) tpl.stageColors = tplColors;
    // CHAINED on the same queue as updateTemplateScope. The clash dialog can
    // fire a scope write on an EXISTING set ("Remove X from …") and this Save
    // As back-to-back; both persist the FULL template list, so unserialized
    // they race last-write-wins and one of the two changes silently vanishes.
    // Each link reads the freshest list (templatesChainRef) at RUN time.
    let ok = false; // set true only when THIS link persists successfully
    scopeSaveChainRef.current = scopeSaveChainRef.current.then(async () => {
      // Scope: an explicit Save As choice wins; a plain Save (no scope arg) on
      // an existing set keeps whatever it already had — including LEGACY sets
      // that carry groupIds without applyMode (still group-scoped; deriving
      // from applyMode alone silently rewrote them as everyone sets).
      const cur = templatesChainRef.current;
      const prev = cur.find(t => t.id === id);
      const eff = scope ?? (prev ? {
        applyMode: prev.applyMode ?? ((prev.groupIds ?? []).length ? "groups" as const : "everyone" as const),
        groupIds: prev.groupIds ?? [],
      } : undefined);
      // Single-Everyone belt (#user): an explicit Everyone choice while some
      // OTHER set already holds Everyone for this workflow would mint a second
      // default. The Save As dialog blocks this too — chained saves can race.
      if (scope && scope.applyMode === "everyone") {
        const scopeOf = (t: WorkflowTemplate) => t.applyMode ?? ((t.groupIds ?? []).length ? "groups" : "everyone");
        const clash = cur.find(t => t.id !== id && (!t.module || t.module === mod) && scopeOf(t) === "everyone");
        if (clash) {
          toast({
            title: "Only one stage set can be for everyone",
            description: `"${clash.name}" already applies to everyone in ${MODULE_LABELS[mod]}. "${tpl.name}" was not saved — pick specific groups or people for it, or change "${clash.name}" first.`,
            variant: "destructive",
          });
          return;
        }
      }
      if (eff && eff.applyMode !== "everyone" && eff.groupIds.length > 0) {
        tpl.applyMode = eff.applyMode;
        tpl.groupIds = [...eff.groupIds];
      }
      const next = [...cur.filter(t => t.id !== id), tpl];
      if (!(await persistTemplates(next))) return;
      templatesChainRef.current = next; // next chained save builds on THIS result
      ok = true;
      // Group-scoped sets also become a workflow TYPE — the existing runtime
      // mechanism (#131): members of the allowed groups can put records on it,
      // and those records use the set's stages. "Except" stores the complement
      // of today's group list (the allowed side is what the server enforces).
      if (scope && scope.applyMode !== "everyone" && scope.groupIds.length > 0) {
        const allowed = scope.applyMode === "groups"
          ? [...scope.groupIds]
          : groups.map(g => g.id).filter(gid => !scope.groupIds.includes(gid));
        const stagesCopy = [...stages];
        setRules(r => {
          const types = { ...(r.workflowTypes ?? {}) } as NonNullable<StageRules["workflowTypes"]>;
          const list = [...(types[mod] ?? [])];
          const nIdx = list.findIndex(e => (typeof e === "string" ? e : e.name).trim().toLowerCase() === tpl.name.trim().toLowerCase());
          // Preserve directly-listed people through the scope overwrite (the
          // template scope only manages GROUPS — erasing allowedUserIds here
          // would silently kick people off the type).
          const prevEntry = nIdx >= 0 ? list[nIdx] : null;
          const prevUsers = prevEntry ? wtUsers(prevEntry) : [];
          const entry = wtEntry(tpl.name, allowed, prevUsers, stagesCopy);
          if (nIdx >= 0) list[nIdx] = entry; else list.push(entry);
          types[mod] = list;
          // Audience changed → restamp the type's skip-rule exemptions so
          // "who can use it" members keep seeing any skipped stages.
          const i = wtRuleIdx(r, mod, tpl.name);
          let stageSkips = r.stageSkips;
          if (i >= 0) {
            stageSkips = [...stageSkips];
            stageSkips[i] = restampSkipExempt(
              stageSkips[i],
              prevEntry ? typeAudienceIds(wtGroups(prevEntry), wtUsers(prevEntry)) : [],
              typeAudienceIds(allowed, prevUsers),
            );
          }
          // Clear the global stage order for this module so non-matching users
          // see the standard derived stages instead of falling back to whatever
          // the admin happened to have configured in the Workflow Stages card.
          // A group-scoped "Save As" is an exclusive assignment: stages should
          // only appear to the chosen groups, not to everyone via the fallback.
          // EXCEPTION (#user, keepDefault): "Create a new set for these people"
          // COPIES the everyone default — the default must keep applying to
          // everyone else, so the live order stays untouched.
          const next2: StageRules = { ...r, workflowTypes: types, stageSkips };
          if (!opts?.keepDefault) {
            const so = { ...(r.stageOrder ?? {}) };
            delete so[mod];
            if (Object.keys(so).length) next2.stageOrder = so as StageRules["stageOrder"];
            else delete next2.stageOrder;
          }
          return next2;
        });
        if (!quiet) toast(opts?.keepDefault ? {
          title: "New stage set created",
          description: `"${tpl.name}" applies to the chosen people — press Save to make it live. The default still applies to everyone else.`,
        } : {
          title: "Stage set saved",
          description: `"${tpl.name}" was saved for the chosen groups — press Save to make it live. The global stage order for this module has been cleared so only the selected groups see these stages.`,
        });
      } else if (!quiet) {
        toast({ title: "Stage set saved", description: `"${tpl.name}" (${tpl.stages.length} stages) can now be applied to any workflow.` });
      }
    }).catch(e => {
      // Keep the chain alive — a poisoned chain would silently drop every
      // future template/scope save. persistTemplates already toasts.
      console.error("[saveAsTemplate]", e);
    });
    await scopeSaveChainRef.current;
    return ok;
  };
  /** Change a saved set's audience from the Manage dialog. Mirrors the scope
   *  side of saveAsTemplate: a scoped set (with groups picked) also lives as a
   *  workflow TYPE; "Everyone" (or no groups picked) removes that type.
   *  Saves are CHAINED (one at a time, latest templates snapshot read at run
   *  time) so rapid picker clicks can't land out of order and revert scope. */
  const updateTemplateScope = (id: string, applyMode: "everyone" | "except" | "groups", groupIds: string[]) => {
    if (!templatesReady) return;
    scopeSaveChainRef.current = scopeSaveChainRef.current.then(async () => {
      const cur = templatesChainRef.current;
      const prev = cur.find(t => t.id === id);
      if (!prev) return;
      // Single-Everyone belt (#user): switching this set to Everyone while
      // another set already holds Everyone for the same workflow would mint
      // a second default — refuse and name the holder. (The pickers disable
      // the option; this catches chained/racing edits.)
      if (applyMode === "everyone") {
        const scopeOf = (t: WorkflowTemplate) => t.applyMode ?? ((t.groupIds ?? []).length ? "groups" : "everyone");
        const clash = cur.find(t => t.id !== id && (!prev.module || !t.module || t.module === prev.module) && scopeOf(t) === "everyone");
        if (clash) {
          toast({
            title: "Only one stage set can be for everyone",
            description: `"${clash.name}" already applies to everyone. Change "${clash.name}" to specific groups first, then make "${prev.name}" the everyone default.`,
            variant: "destructive",
          });
          return;
        }
      }
      const tpl: WorkflowTemplate = { ...prev };
      const prevWasEveryone =
        (prev.applyMode ?? ((prev.groupIds ?? []).length ? "groups" : "everyone")) === "everyone";
      if (applyMode === "everyone") { delete tpl.applyMode; delete tpl.groupIds; }
      else { tpl.applyMode = applyMode; tpl.groupIds = [...groupIds]; }
      const next = cur.map(t => (t.id === id ? tpl : t));
      if (!(await persistTemplates(next))) return;
      templatesChainRef.current = next; // next chained save builds on THIS result
      // Taking the ONLY everyone set down to a group is safe — but say so:
      // admins otherwise fear the group version silently stays on for all
      // (#user question). Everyone outside the picked audience falls back to
      // the built-in standard workflow, never to nothing.
      if (prevWasEveryone && applyMode !== "everyone" && groupIds.length > 0) {
        toast({
          title: `"${prev.name}" is no longer the everyone default`,
          description: "It now applies only to the groups or people you picked. Everyone else automatically goes back to the standard workflow. Press Save to make this live.",
        });
      }
      const nm = tpl.name.trim().toLowerCase();
      const tplMod = tpl.module;
      if (!tplMod) return;
      if (applyMode !== "everyone" && groupIds.length > 0) {
        const allowed = applyMode === "groups"
          ? [...groupIds]
          : groups.map(g => g.id).filter(gid => !groupIds.includes(gid));
        const stagesCopy = [...tpl.stages];
        setRules(r => {
          const types = { ...(r.workflowTypes ?? {}) } as NonNullable<StageRules["workflowTypes"]>;
          const list = [...(types[tplMod] ?? [])];
          const nIdx = list.findIndex(e => (typeof e === "string" ? e : e.name).trim().toLowerCase() === nm);
          // Preserve directly-listed people (scope manages GROUPS only) and
          // restamp the type's skip-rule exemptions to the new audience.
          const prevEntry = nIdx >= 0 ? list[nIdx] : null;
          const prevUsers = prevEntry ? wtUsers(prevEntry) : [];
          const entry = wtEntry(tpl.name, allowed, prevUsers, stagesCopy);
          if (nIdx >= 0) list[nIdx] = entry; else list.push(entry);
          types[tplMod] = list;
          const i = wtRuleIdx(r, tplMod, tpl.name);
          let stageSkips = r.stageSkips;
          if (i >= 0) {
            stageSkips = [...stageSkips];
            stageSkips[i] = restampSkipExempt(
              stageSkips[i],
              prevEntry ? typeAudienceIds(wtGroups(prevEntry), wtUsers(prevEntry)) : [],
              typeAudienceIds(allowed, prevUsers),
            );
          }
          // Same logic as saveAsTemplate: clear the global stage order for this
          // module so non-matching users see standard stages, not the fallback.
          const so2 = { ...(r.stageOrder ?? {}) };
          delete so2[tplMod];
          const next2: StageRules = { ...r, workflowTypes: types, stageSkips };
          if (Object.keys(so2).length) next2.stageOrder = so2 as StageRules["stageOrder"];
          else delete next2.stageOrder;
          return next2;
        });
      } else {
        // Everyone (or scoped with nobody picked yet) — take its workflow type
        // off. Only THIS template's module: a same-named type in another module
        // belongs to a different set and must not be touched.
        setRules(r => {
          const types = { ...(r.workflowTypes ?? {}) } as NonNullable<StageRules["workflowTypes"]>;
          const before = types[tplMod] ?? [];
          const removed = before.find(e => (typeof e === "string" ? e : e.name).trim().toLowerCase() === nm);
          const after = before.filter(e => (typeof e === "string" ? e : e.name).trim().toLowerCase() !== nm);
          if (after.length === before.length) return r;
          // Type gone → its audience no longer exempts anyone from the (now
          // dormant) skip rule; manually-added exemptions stay put.
          const i = wtRuleIdx(r, tplMod, nm);
          let stageSkips = r.stageSkips;
          if (i >= 0 && removed != null) {
            stageSkips = [...stageSkips];
            stageSkips[i] = restampSkipExempt(stageSkips[i], typeAudienceIds(wtGroups(removed), wtUsers(removed)), []);
          }
          return { ...r, workflowTypes: { ...types, [tplMod]: after }, stageSkips };
        });
      }
    }).catch(() => { /* persistTemplates already toasts; keep the chain alive */ });
  };
  const deleteTemplate = async (id: string) => {
    if (!templatesReady) return;
    const tpl = templates.find(t => t.id === id);
    if (!(await persistTemplates(templates.filter(t => t.id !== id)))) return;
    // A group-scoped set also lives as a workflow TYPE (the runtime side of
    // its "who does it apply to" choice) — remove that too, or the "deleted"
    // set would silently keep gating records.
    if (tpl?.applyMode && tpl.applyMode !== "everyone") {
      const nm = tpl.name.trim().toLowerCase();
      setRules(r => {
        const types = { ...(r.workflowTypes ?? {}) } as NonNullable<StageRules["workflowTypes"]>;
        let changed = false;
        let stageSkips = r.stageSkips;
        for (const m of Object.keys(types) as StageRuleModule[]) {
          const before = types[m] ?? [];
          const removed = before.find(e => (typeof e === "string" ? e : e.name).trim().toLowerCase() === nm);
          const after = before.filter(e => (typeof e === "string" ? e : e.name).trim().toLowerCase() !== nm);
          if (after.length !== before.length) {
            types[m] = after; changed = true;
            // Strip the removed type's audience from its (now dormant) skip
            // rule's exemptions; manually-added exemptions stay put.
            const i = stageSkips.findIndex(s => s.module === m && s.field === "WorkflowTypeName" && s.value.trim().toLowerCase() === nm);
            if (i >= 0 && removed != null) {
              if (stageSkips === r.stageSkips) stageSkips = [...stageSkips];
              stageSkips[i] = restampSkipExempt(stageSkips[i], typeAudienceIds(wtGroups(removed), wtUsers(removed)), []);
            }
          }
        }
        return changed ? { ...r, workflowTypes: types, stageSkips } : r;
      });
      // Saving is a no-op when nothing actually changed, so the hint is safe.
      toast({
        title: "Stage set deleted",
        description: `"${tpl.name}" was removed. Press Save to also take its workflow off the record pages.`,
      });
    }
  };
  const renameTemplate = async (id: string, newName: string) => {
    if (!templatesReady) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    // Update name in-place (the id field is independent of name — only new
    // saves via saveAsTemplate derive id from name, existing rows keep theirs).
    const next = templates.map(t => t.id === id ? { ...t, name: trimmed } : t);
    await persistTemplates(next);
  };

  if (tenantId === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stage Rules</CardTitle>
          <CardDescription>
            Stage rules are set per company. Pick a company in "Who do these apply to?" above, then come back here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (loadErr) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stage Rules</CardTitle>
          <CardDescription>{loadErr}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={() => void load(false)}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  // Badge counts shown on tab headers so the admin knows at a glance which
  // sections have rules configured.
  const lockCount = rules.fieldLocks.length;
  const skipCount = rules.stageSkips.length;
  const permCount = perms.length;
  const layoutCount = (rules.formLayout ?? []).length;
  const typeCount = STAGE_RULE_MODULES.reduce((n, m) => n + (rules.workflowTypes?.[m]?.length ?? 0), 0);

  const TAB_DEFS = [
    { id: "workflow" as const, label: "Workflow stages",         icon: <Workflow style={{ width: 14, height: 14 }} />,    color: "#8b5cf6", count: 0 },
    { id: "locks" as const,    label: "Lock fields by stage",    icon: <Lock style={{ width: 14, height: 14 }} />,        color: "#0ea5e9", count: lockCount },
    { id: "skips" as const,    label: "Skip stages",             icon: <SkipForward style={{ width: 14, height: 14 }} />, color: "#a855f7", count: skipCount },
    { id: "types" as const,    label: "Workflow types",          icon: <Tags style={{ width: 14, height: 14 }} />,        color: "#f97316", count: typeCount },
    { id: "layout" as const,   label: "Fields layout",           icon: <ClipboardList style={{ width: 14, height: 14 }} />, color: "#f59e0b", count: layoutCount },
    { id: "who" as const,      label: "Who can act",             icon: <UserCheck style={{ width: 14, height: 14 }} />,   color: "#10b981", count: permCount },
  ] as const;

  const tabPanelStyle: React.CSSProperties = {
    background: "hsl(var(--background))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    padding: "24px 28px",
    minHeight: 280,
  };

  return (
    <div>
      <style>{`
        @keyframes phaseConnectorFlow {
          from { background-position-x: 0; }
          to   { background-position-x: 10px; }
        }
      `}</style>
      {/* Page title + description removed (user request) — the breadcrumb
          already says "Stage Rules". Keep the unsaved-changes warning only,
          right-aligned, so pending edits are still impossible to miss. */}
      {dirty && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#d97706", display: "flex", alignItems: "center", gap: 5 }}>
            <AlertTriangle style={{ width: 13, height: 13 }} /> Unsaved changes
          </span>
        </div>
      )}

      <div style={tabPanelStyle}>
          <WorkflowStagesCard
            rules={rules}
            setRules={setRules}
            derivedOrder={{
              PMM: stageOrder.PMM ?? FALLBACK_STAGE_ORDER.PMM,
              OPM: stageOrder.OPM ?? FALLBACK_STAGE_ORDER.OPM,
              LEM: stageOrder.LEM ?? FALLBACK_STAGE_ORDER.LEM,
            }}
            statusOpts={statusOpts}
            perms={perms}
            setPerms={setPerms}
            onSave={() => void doSave()}
            saving={saving}
            dirty={dirty}
            templates={templates}
            templatesReady={templatesReady}
            loadedTpl={loadedTpl}
            setLoadedTpl={setLoadedTpl}
            onSaveTemplate={(name, m, stages, colors, scope, opts) => void saveAsTemplate(name, m, stages, colors, scope, undefined, opts)}
            onDeleteTemplate={(id) => void deleteTemplate(id)}
            onUpdateTemplateScope={(id, m, ids) => void updateTemplateScope(id, m, ids)}
            onRenameTemplate={(id, name) => renameTemplate(id, name)}
            people={tenantId !== undefined ? null : people}
            groups={pickGroups}
            groupsReady={groupsReady}
            groupColors={groupColors}
            tenantId={tenantId}
          />
        </div>

      {/* Per-project rules overview — renders below the Workflow Stages card */}
      <RecordForksSection tenantId={tenantId} />

      {/* Stage-chips edit dialog — outside tab panels so it survives tab switches */}
      {stageChipsDialog && (() => {
        const dlg = stageChipsDialog;
        const tStages = wtStages((rules.workflowTypes?.[dlg.mod] ?? [])[dlg.idx]);
        return (
          <Dialog open onOpenChange={open => { if (!open) setStageChipsDialog(null); }}>
            {/* z-[11000]: see Save As… dialog comment above — same freeze trap. */}
            <DialogContent className="z-[11000]" style={{ maxWidth: 560, width: "95vw" }}>
              <DialogHeader>
                <DialogTitle>
                  Edit stages — {wtName((rules.workflowTypes?.[dlg.mod] ?? [])[dlg.idx]) || "this type"}
                </DialogTitle>
              </DialogHeader>
              <OrderedStageChips
                stages={tStages}
                onChange={stages => setTypeStages(dlg.mod, dlg.idx, stages)}
                suggestions={stagePickFor(dlg.mod)}
              />
              {templates.length > 0 && (
                <select value="" style={{ ...selStyle, height: 28, fontSize: 12, marginTop: 8 }}
                  onChange={e => {
                    const tpl = templates.find(x => x.id === e.target.value);
                    if (tpl) setTypeStages(dlg.mod, dlg.idx, [...tpl.stages]);
                  }}>
                  <option value="" disabled>Replace with a template…</option>
                  {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                </select>
              )}
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}

/* ═════════════════ Projects running custom rules ════════════════════
   Compact list of every record that has a per-record stage-rules fork so
   admins can review and reset them without visiting each record individually.
   Mirrors the "Use company rules" drawer action (same API call).             */

function RecordForksSection({ tenantId }: { tenantId?: string | null }) {
  const { toast } = useToast();
  const [forks, setForks] = useState<RecordFork[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** recordId being confirmed for reset (first click). */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (tenantId === null) { setLoading(false); return; }
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchRecordForks(tenantId ?? undefined);
      if (seq !== loadSeqRef.current) return;
      setForks(result);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setLoadError(e instanceof Error ? e.message : "Could not load custom-rules list");
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  // Dismiss confirm when Escape is pressed.
  useEffect(() => {
    if (!confirmId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirmId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmId]);

  const doReset = async (recordId: string) => {
    if (resettingId) return;
    setResettingId(recordId);
    setConfirmId(null);
    try {
      await resetRecordStageRules(recordId, tenantId ?? undefined);
      setForks(prev => prev.filter(f => f.recordId !== recordId));
      toast({ title: "Back to company rules", description: `"${recordId}" now follows the company-wide stage rules.` });
    } catch (e) {
      toast({
        title: "Could not remove custom rules",
        description: e instanceof Error ? e.message : "Something went wrong — please try again.",
        variant: "destructive",
      });
    } finally {
      setResettingId(null);
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
    } catch { return iso; }
  };

  const cardStyle: React.CSSProperties = {
    background: "hsl(var(--background))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    marginTop: 16,
    overflow: "hidden",
  };
  const headerStyle: React.CSSProperties = {
    padding: "14px 20px",
    borderBottom: forks.length > 0 || loading ? "1px solid hsl(var(--border))" : undefined,
  };

  if (tenantId === null) return null;

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SlidersHorizontal style={{ width: 15, height: 15, color: "#d97706" }} />
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Projects running custom rules</span>
          {!loading && forks.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, background: "#fef3c7", color: "#92400e", borderRadius: 10, padding: "1px 7px" }}>
              {forks.length}
            </span>
          )}
        </div>
        <p style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
          Stage rules can be customised per project from its schedule card. Projects listed here
          diverge from your company-wide rules — resetting a project removes its override and
          returns it to the shared configuration.
        </p>
      </div>

      {loading && (
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
          <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && loadError && (
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: "hsl(var(--destructive))" }}>{loadError}</span>
          <button type="button" onClick={() => void load()}
            style={{ fontSize: 12, color: "hsl(var(--primary))", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
            Retry
          </button>
        </div>
      )}

      {!loading && !loadError && forks.length === 0 && (
        <div style={{ padding: "16px 20px", fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>
          No projects are running custom stage rules right now. When an admin uses "Set rules"
          on a specific project's schedule card and saves overrides, that project will appear here.
        </div>
      )}

      {!loading && !loadError && forks.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.35)" }}>
              <th style={{ textAlign: "left", padding: "8px 20px", fontWeight: 600, fontSize: 11.5, color: "hsl(var(--muted-foreground))", letterSpacing: "0.03em" }}>Project</th>
              <th style={{ textAlign: "right", padding: "8px 16px", fontWeight: 600, fontSize: 11.5, color: "hsl(var(--muted-foreground))", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>Custom rules</th>
              <th style={{ textAlign: "right", padding: "8px 16px", fontWeight: 600, fontSize: 11.5, color: "hsl(var(--muted-foreground))", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>Last changed</th>
              <th style={{ padding: "8px 16px 8px 8px", width: 1 }} />
            </tr>
          </thead>
          <tbody>
            {forks.map(fork => {
              const isResetting = resettingId === fork.recordId;
              const isConfirming = confirmId === fork.recordId;
              return (
                <tr key={fork.recordId}
                  style={{ borderBottom: "1px solid hsl(var(--border) / 0.6)", background: isConfirming ? "hsl(var(--destructive) / 0.04)" : undefined }}>
                  <td style={{ padding: "10px 20px" }}>
                    <a
                      href={`/project/${encodeURIComponent(fork.recordId)}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "hsl(var(--primary))", textDecoration: "none", fontWeight: 500 }}
                      onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
                      onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
                    >
                      {fork.recordId}
                      <ExternalLink style={{ width: 11, height: 11, opacity: 0.7, flexShrink: 0 }} />
                    </a>
                  </td>
                  <td style={{ padding: "10px 16px", textAlign: "right", color: "hsl(var(--foreground))" }}>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{fork.ruleCount}</span>
                  </td>
                  <td style={{ padding: "10px 16px", textAlign: "right", color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
                    {formatDate(fork.lastChangedAt)}
                  </td>
                  <td style={{ padding: "10px 16px 10px 8px", whiteSpace: "nowrap", textAlign: "right" }}>
                    {isConfirming ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <button type="button" onClick={() => void doReset(fork.recordId)} disabled={isResetting}
                          style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "hsl(var(--destructive))", border: "none", borderRadius: 5, padding: "3px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {isResetting ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" /> : <Check style={{ width: 11, height: 11 }} />}
                          Confirm reset
                        </button>
                        <button type="button" onClick={() => setConfirmId(null)}
                          style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", background: "none", border: "1px solid hsl(var(--border))", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(fork.recordId)} disabled={!!resettingId}
                        title="Reset this project to company-wide stage rules"
                        style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", background: "none", border: "1px solid hsl(var(--border))", borderRadius: 5, padding: "3px 9px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, opacity: resettingId ? 0.5 : 1 }}>
                        <RotateCcw style={{ width: 11, height: 11 }} /> Reset to company rules
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ═════════════════ Schedule-card "Set rules" host ═════════════════
   The client's mental model: stages and the schedule are the SAME list,
   managed on ONE card (Settings → Projects & Opportunities). This host lets
   those schedule cards open the per-stage "Set rules" drawer without
   mounting the whole Stage Rules page. It owns the rules + permissions
   draft docs (same endpoints and instant-render seed as StageRulesSettings),
   renders StageRuleDrawer for the requested stage, and reports per-stage
   rule counts up to the parent so schedule rows can show "Set rules (N)".

   Save semantics: the drawer's Save persists immediately; closing the drawer
   with unsaved edits auto-saves too — the schedule cards around it auto-save,
   so a silently-dropped draft would betray the page's mental model. */

const hostStageKey = (s: string) => s.trim().toLowerCase().replace(/[\u2013\u2014]/g, "-");
// Lockstep with the server's isOutcomeStageName + the Workflow Stages card:
// these names are ENDINGS (outcomes), not path steps.
const hostIsOutcome = (s: string) => {
  const k = hostStageKey(s);
  return k === "converted" || k === "lost" || k === "won"
    || k === "cancelled" || k === "canceled" || k === "declined"
    || k.startsWith("closed");
};
const hostIsWonish = (s: string) => /won|converted|award/i.test(s);
/** How many rules touch a stage — same definition as the drawer's total
    (field locks + skip conditions + who-can-act + form + required rules). */
export const countStageRules = (rules: StageRules, perms: StagePermRule[], m: StageRuleModule, s: string): number => {
  const k = s.trim().toLowerCase();
  const key = (x: string) => x.trim().toLowerCase();
  return rules.fieldLocks.filter(r => r.module === m && key(r.stage) === k).length
    + rules.stageSkips.filter(r => r.module === m && r.skipStages.some(x => key(x) === k)).length
    + perms.filter(p => p.module === m && key(p.stage) === k).length
    + (rules.formLayout ?? []).filter(r => r.module === m && key(r.stage) === k).length
    + (rules.requiredFields ?? []).filter(r => r.module === m && key(r.stage) === k).length;
};

/** Which stage's drawer is open, and the stage list it navigates within
    (the schedule list the button was clicked on). */
export type ScheduleRuleTarget = {
  mod: StageRuleModule;
  stage: string;
  order: string[];
  /** Current color override for this phase (hex). Shown in the drawer header
   *  and editable via the inline color picker — changes are written back via
   *  onPhaseColorChange so the phase list keeps its colors in sync. */
  phaseColor?: string | null;
};

export function ScheduleStageRulesHost({ tenantId, recordId, recordLabel, open, onOpenChange, onCountsChange, onPhaseColorChange }: {
  /** undefined = own company; string = superadmin-selected company; null = none picked. */
  tenantId?: string | null;
  /** Set = RECORD mode: the drawer edits a per-record override doc (a fork of
      the company rules that then governs ONLY this record) instead of the
      company-wide document. Ticket ID of the record. */
  recordId?: string;
  /** Display name for the record-mode banner/toasts (defaults to recordId). */
  recordLabel?: string;
  open: ScheduleRuleTarget | null;
  onOpenChange: (o: ScheduleRuleTarget | null) => void;
  /** Registers a per-stage rule counter with the parent (null on unmount) so
      schedule rows can badge their "Set rules" buttons. Re-registered on
      every rules/perms change so counts stay live. */
  onCountsChange?: (fn: ((mod: StageRuleModule, stage: string) => number) | null) => void;
  /** Called when the admin picks or clears a phase color from within the rules
   *  drawer. The parent (PhaseSetsSaveBar / onboarding-settings) persists the
   *  change via onColorChangeReady so the phase list stays in sync. */
  /** Third arg = the module of the OPEN drawer (PMM vs OPM) so the parent can
   *  route the write to the matching phase editor — a Projects color must
   *  never land in the Opportunities set or vice versa. */
  onPhaseColorChange?: (stageName: string, color: string | null, mod: StageRuleModule) => void;
}) {
  const { toast } = useToast();
  // Instant boot from the shared stage-rules seed (same key StageRulesSettings
  // maintains), else the app-wide singleton for the own tenant. RECORD mode
  // never boots from a seed: both hold the COMPANY doc, and whether this
  // record has its own fork is unknown until the fetch answers — booting
  // "ready" from the company doc could mislabel a fork as absent.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time seed only
  const boot = useMemo((): Partial<StageRulesSeed> | null => {
    if (recordId) return null;
    if (tenantId === null) return null;
    const s = getSeed<StageRulesSeed>(`stageRules:${seedScope(tenantId)}`);
    if (s) return s;
    if (tenantId === undefined && stageRulesLoaded()) {
      const st = getStageRules();
      return { rules: st.rules, stageOrder: st.stageOrder };
    }
    return null;
  }, []);
  const [rules, setRulesRaw] = useState<StageRules>(boot?.rules ?? EMPTY_STAGE_RULES);
  const [stageOrder, setStageOrder] = useState<StageOrderMap>(boot?.stageOrder ?? { PMM: null, OPM: null, LEM: null });
  const [savedSnapshot, setSavedSnapshot] = useState<string>(JSON.stringify(boot?.rules ?? EMPTY_STAGE_RULES));
  const [perms, setPermsRaw] = useState<StagePermRule[]>(boot?.perms ?? []);
  const [permsSnapshot, setPermsSnapshot] = useState<string>(JSON.stringify(boot?.perms ?? []));
  const [groups, setGroups] = useState<UserGroup[]>(boot?.groups ?? []);
  const [orgAuds, setOrgAuds] = useState<UserGroup[]>([]);
  const [groupsReady, setGroupsReady] = useState<boolean>(!!boot);
  const [people, setPeople] = useState<{ value: string; label: string }[]>([]);
  const [statusOpts, setStatusOpts] = useState<Record<StageRuleModule, string[]>>({ PMM: [], OPM: [], LEM: [] });
  // Editing a rules doc that never loaded would let a save WIPE existing
  // rules — the drawer stays gated behind ready (a seed counts: seeds only
  // ever hold successful loads).
  const [ready, setReady] = useState<boolean>(!!boot);
  const [saving, setSaving] = useState(false);
  // Record mode: which doc the drawer is showing — the record's own fork or
  // the company doc it would fork on first save. Meaningless in tenant mode.
  const [ruleSource, setRuleSource] = useState<"record" | "tenant">("tenant");
  const [resetting, setResetting] = useState(false);

  // Draft guards — a background refetch must never clobber in-progress edits.
  const rulesDirtyRef = useRef(false);
  const permsDirtyRef = useRef(false);
  const loadSeqRef = useRef(0);
  const setRules = useCallback((v: StageRules | ((prev: StageRules) => StageRules)) => {
    rulesDirtyRef.current = true;
    setRulesRaw(v);
  }, []);
  const setPerms = useCallback((v: StagePermRule[] | ((prev: StagePermRule[]) => StagePermRule[])) => {
    permsDirtyRef.current = true;
    setPermsRaw(v);
  }, []);

  const load = useCallback(async () => {
    if (tenantId === null) return;
    const seq = ++loadSeqRef.current;
    try {
      const [st, permRules, groupList, orgList] = await Promise.all([
        fetchStageRulesFor(tenantId ?? undefined, recordId),
        fetchStagePermissions(tenantId ?? undefined),
        // null = fetch FAILED — not "tenant has no groups". Never seed that.
        fetchUserGroups(tenantId ?? undefined).catch(() => null),
        fetchOrgAudienceGroups(tenantId ?? undefined).catch(() => [] as UserGroup[]),
      ]);
      if (seq !== loadSeqRef.current) return; // superseded (tenant switch)
      if (!recordId) {
        // Seeds hold the COMPANY doc — a record fork must never overwrite one.
        const seedKey = `stageRules:${seedScope(tenantId)}`;
        const seedGroups = groupList ?? getSeed<StageRulesSeed>(seedKey)?.groups ?? [];
        setSeed<StageRulesSeed>(seedKey, {
          rules: st.rules, stageOrder: st.stageOrder, perms: permRules, groups: seedGroups,
        });
      } else {
        setRuleSource(st.source === "record" ? "record" : "tenant");
      }
      if (!rulesDirtyRef.current) {
        setRulesRaw(st.rules);
        setSavedSnapshot(JSON.stringify(st.rules));
      }
      setStageOrder(st.stageOrder);
      if (!permsDirtyRef.current) {
        setPermsRaw(permRules);
        setPermsSnapshot(JSON.stringify(permRules));
      }
      if (groupList) { setGroups(groupList); setGroupsReady(true); }
      if (orgList.length > 0) setOrgAuds(orgList);
      setReady(true);
    } catch { /* seed/last data stands; next mount retries */ }
  }, [tenantId, recordId]);
  useEffect(() => {
    // Tenant switch: drafts belonged to the previous tenant.
    rulesDirtyRef.current = false;
    permsDirtyRef.current = false;
    void load();
  }, [load]);

  useEffect(() => {
    // People picker uses the signed-in tenant's roster — cross-tenant
    // superadmin edits assign by GROUP (or existing raw IDs) only.
    if (tenantId !== undefined) return;
    let alive = true;
    getUserList()
      .then((raw) => {
        if (!alive || !Array.isArray(raw)) return;
        const opts = (raw as Record<string, unknown>[])
          .map((u) => ({
            value: String(u.Id ?? u.id ?? ""),
            label: String(u.Name ?? u.name ?? u.UserName ?? u.username ?? ""),
          }))
          .filter((p) => p.value && p.label)
          .sort((a, b) => a.label.localeCompare(b.label));
        setPeople(opts);
      })
      .catch(() => { /* pickers fall back to raw IDs */ });
    return () => { alive = false; };
  }, [tenantId]);

  useEffect(() => {
    // Cross-tenant superadmin edits skip this — status options would come
    // from the admin's OWN tenant and be wrong here.
    if (tenantId !== undefined) return;
    let alive = true;
    (async () => {
      for (const m of STAGE_RULE_MODULES) {
        try {
          const o = await getFieldOptions("status", m);
          if (alive && Array.isArray(o)) setStatusOpts(p => ({ ...p, [m]: o }));
        } catch { /* suggestions only — ignore */ }
      }
    })();
    return () => { alive = false; };
  }, [tenantId]);

  // Live per-stage counts for the parent's "Set rules (N)" badges.
  useEffect(() => {
    // Stage permissions remain company-wide and are hidden in record mode, so
    // the project schedule badge must not present them as project-owned rules.
    const visiblePerms = recordId ? [] : perms;
    onCountsChange?.((m, s) => countStageRules(rules, visiblePerms, m, s));
  }, [rules, perms, recordId, onCountsChange]);
  useEffect(() => () => { onCountsChange?.(null); }, [onCountsChange]);

  const rulesDirty = JSON.stringify(rules) !== savedSnapshot;
  const permsDirty = JSON.stringify(perms) !== permsSnapshot;
  const dirty = rulesDirty || permsDirty;

  const doSave = useCallback(async () => {
    // tenantId is fixed for this component's life (parent keys the mount per
    // scope), so a save can never target a different tenant's document.
    if (!ready || saving || tenantId === null) return;
    const rd = JSON.stringify(rules) !== savedSnapshot;
    const pd = JSON.stringify(perms) !== permsSnapshot;
    if (!rd && !pd) return;
    // Same guard as the full Settings page: a permission rule with nobody in
    // either tier reads as an explicit stage FREEZE server-side. The drawer
    // UI never creates one (empty rules are dropped or kept draft-only), so
    // this only trips on odd legacy docs — block loudly instead of saving.
    if (pd && !recordId) {
      const emptyRule = perms.find(r =>
        r.actionUserIds.length === 0 && r.actionGroupIds.length === 0 &&
        r.editorUserIds.length === 0 && r.editorGroupIds.length === 0);
      if (emptyRule) {
        toast({
          title: "A stage permission rule is empty",
          description: `The "${emptyRule.stage}" rule has no people or groups picked, which would freeze that stage for everyone. Pick at least one person or group, or set "Who can edit" back to Everyone, then save again.`,
          variant: "destructive",
        });
        return;
      }
    }
    setSaving(true);
    try {
      let finalRules = rules;
      let finalPerms = perms;
      if (rd) {
        // Lockstep stamp: each type's audience is exempt from its own skip rule.
        let toSave = stampTypeExemptions(rules);
        if (recordId && open) {
          // Record forks carry the project's OWN stage order (the phase list
          // the drawer was opened on) so the server's from/until lock ranges
          // evaluate on the exact sequence the admin configured against.
          toSave = { ...toSave, stageOrder: { ...(toSave.stageOrder ?? {}), [open.mod]: open.order } };
        }
        const saved = await saveStageRules(toSave, tenantId ?? undefined, recordId);
        setRulesRaw(saved);
        setSavedSnapshot(JSON.stringify(saved));
        rulesDirtyRef.current = false;
        finalRules = saved;
        if (recordId) setRuleSource("record");
      }
      // Stage permissions are company-wide by design — record mode hides the
      // "Who can act" editor and never writes the perms doc.
      if (pd && !recordId) {
        const savedPerms = await saveStagePermissions(perms, tenantId ?? undefined);
        setPermsRaw(savedPerms);
        setPermsSnapshot(JSON.stringify(savedPerms));
        permsDirtyRef.current = false;
        finalPerms = savedPerms;
      }
      if (!recordId) {
        setSeed<StageRulesSeed>(`stageRules:${seedScope(tenantId)}`, {
          rules: finalRules, stageOrder, perms: finalPerms, groups,
        });
      }
      toast(recordId
        ? { title: "Project rules saved", description: `They apply to "${recordLabel ?? recordId}" only — company-wide rules no longer affect this record.` }
        : { title: "Stage rules saved", description: "They now apply to everyone in the company." });
    } catch (e) {
      toast({
        title: recordId ? "Could not save this project's rules" : "Could not save stage rules",
        description: e instanceof Error ? e.message : "Something went wrong — please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [ready, saving, rules, perms, savedSnapshot, permsSnapshot, tenantId, recordId, recordLabel, open, stageOrder, groups, toast]);

  // Record mode: drop the fork — the company doc governs this record again.
  // Unsaved draft edits are discarded deliberately (the admin chose to reset).
  const doReset = useCallback(async () => {
    if (!recordId || resetting) return;
    setResetting(true);
    try {
      await resetRecordStageRules(recordId, tenantId ?? undefined);
      rulesDirtyRef.current = false;
      permsDirtyRef.current = false;
      setRuleSource("tenant");
      await load();
      toast({ title: "Back to company rules", description: `"${recordLabel ?? recordId}" now follows the company-wide stage rules.` });
    } catch (e) {
      toast({
        title: "Could not remove this project's rules",
        description: e instanceof Error ? e.message : "Something went wrong — please try again.",
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  }, [recordId, resetting, tenantId, load, toast, recordLabel]);

  const pickGroups = useMemo(() => [...groups, ...orgAuds], [groups, orgAuds]);
  const groupColors = useMemo(() => groupColorMap(pickGroups), [pickGroups]);
  const memberNamesOf = useGroupMemberNames(tenantId === undefined);

  if (!open) return null;
  if (tenantId === null) {
    // Superadmin with no company picked — there is no rules document to edit.
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: Z.MODAL, background: "rgba(15,23,42,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={() => onOpenChange(null)}>
        <div style={{ background: "hsl(var(--background))", borderRadius: 10, padding: "18px 26px", fontSize: 13.5, maxWidth: 380, lineHeight: 1.5 }}>
          Pick a company first — stage rules belong to one company&apos;s workflow.
        </div>
      </div>
    );
  }
  if (!ready) {
    // Rules doc still loading — a drawer over an EMPTY doc could wipe real
    // rules on save. Brief blocking spinner instead.
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: Z.MODAL, background: "rgba(15,23,42,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={() => onOpenChange(null)}>
        <div style={{ background: "hsl(var(--background))", borderRadius: 10, padding: "18px 26px", display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
          <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> Loading rules…
        </div>
      </div>
    );
  }

  const idx = open.order.findIndex(s => hostStageKey(s) === hostStageKey(open.stage));
  const isOut = hostIsOutcome(open.stage);
  const pathIdx = open.order.map((_, i) => i).filter(i => !hostIsOutcome(open.order[i]));
  const pathPos = idx >= 0 ? pathIdx.indexOf(idx) : -1;
  const close = () => {
    // Auto-save on close — the surrounding schedule cards auto-save, so a
    // silently-dropped rules draft would be a surprise.
    if (dirty) void doSave();
    onOpenChange(null);
  };
  return (
    <StageRuleDrawer
      mod={open.mod}
      stage={open.stage}
      eyebrow={isOut ? "Outcome" : (pathPos >= 0 ? `Stage ${pathPos + 1} of ${pathIdx.length}` : "Stage")}
      color={isOut ? (hostIsWonish(open.stage) ? "#15803d" : "#6b7280") : null}
      phaseColor={open.phaseColor}
      onPhaseColorChange={onPhaseColorChange ? (hex) => {
        // Reflect the new color in the open target immediately so the swatch
        // updates without waiting for the parent to re-render the drawer.
        onOpenChange({ ...open, phaseColor: hex });
        onPhaseColorChange(open.stage, hex, open.mod);
      } : undefined}
      canPrev={idx > 0}
      canNext={idx >= 0 && idx < open.order.length - 1}
      onStep={(dir) => {
        const ni = idx + dir;
        if (ni >= 0 && ni < open.order.length) onOpenChange({ ...open, stage: open.order[ni] });
      }}
      onClose={close}
      gotoStage={(name) => onOpenChange({ ...open, stage: name })}
      rules={rules} setRules={setRules}
      perms={perms} setPerms={setPerms}
      order={open.order}
      groups={pickGroups} groupsReady={groupsReady} groupColors={groupColors}
      people={tenantId === undefined ? people : null}
      memberNamesOf={memberNamesOf}
      statusOpts={statusOpts[open.mod]}
      typeNames={(rules.workflowTypes?.[open.mod] ?? []).map(wtName)}
      recordCount={null}
      onSave={() => void doSave()} saving={saving} dirty={dirty}
      recordScope={recordId ? { label: recordLabel ?? recordId, source: ruleSource, onReset: () => void doReset(), resetting } : null}
    />
  );
}
