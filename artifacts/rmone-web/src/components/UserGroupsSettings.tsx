/**
 * User Groups — inline settings panel (Settings → User Groups).
 * Extracted from the modal so it lives as a first-class settings page.
 * Same tenantId semantics as AccessLevelsSettings / NavigationSettings:
 *   undefined → signed-in admin's own company
 *   string    → superadmin managing that client (people picker hidden)
 *   null      → superadmin, no company chosen yet
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Plus, Trash2, Users, Save, ChevronDown, ClipboardList, AlertTriangle, UserPlus, Search, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getUserList, updateStaffAssignment, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import {
  fetchUserGroups, saveUserGroups, groupColorMap, GROUP_COLOR_PALETTE,
  fetchStagePermissions, saveStagePermissions, fetchAccessLevels, usePermissionsVersion,
  notifyPermissionsChanged,
  type UserGroup, type StagePermRule,
} from "@/lib/permissions";
import {
  STAGE_RULE_MODULES, FALLBACK_STAGE_ORDER, fetchStageRulesFor, saveStageRules,
  EMPTY_STAGE_RULES,
  type StageRuleModule, type StageRules, type WorkflowTypeEntry,
} from "@/lib/stageRules";
import { getSeed, setSeed, seedScope, type StageRulesSeed } from "@/lib/settingsSeed";
import { fetchOrgAudienceGroups } from "@/lib/orgAudience";

const GROUP_ID_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

function groupIdFromName(name: string, taken: Set<string>): string {
  let base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/g, "");
  if (!base || !GROUP_ID_RE.test(base)) base = "group";
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const cand = `${base.slice(0, 24 - String(n).length - 1)}-${n}`.replace(/--+/g, "-");
    if (GROUP_ID_RE.test(cand) && !taken.has(cand)) return cand;
  }
  return `grp-${Date.now() % 100000}`;
}

/* ── Stage assignments (#120) ──────────────────────────────────────────────
 * Each group card shows which stages the group is responsible for and lets
 * admins add/remove assignments — editing the SAME stage-permissions doc as
 * Workflow & Stages → "Who can act", so the two views can never drift.
 */

// Keep in lockstep with MODULE_LABELS in StageRulesSettings.tsx.
const MODULE_LABELS: Record<StageRuleModule, string> = {
  PMM: "Projects",
  OPM: "Opportunities",
  LEM: "Leads",
};
// Fixed per-module badge hues (plain hex so the `${c}1f` alpha suffix is safe).
const normStage = (s: string) => s.trim().toLowerCase();

/** Effective stage order per module: admin override (in the rules doc) →
 *  server-derived order → built-in fallback. Same precedence the Who-can-act
 *  pickers and the server evaluate with. */
function effectiveOrders(s: Pick<StageRulesSeed, "rules" | "stageOrder"> | null | undefined): Record<StageRuleModule, string[]> {
  return {
    PMM: s?.rules?.stageOrder?.PMM ?? s?.stageOrder?.PMM ?? FALLBACK_STAGE_ORDER.PMM,
    OPM: s?.rules?.stageOrder?.OPM ?? s?.stageOrder?.OPM ?? FALLBACK_STAGE_ORDER.OPM,
    LEM: s?.rules?.stageOrder?.LEM ?? s?.stageOrder?.LEM ?? FALLBACK_STAGE_ORDER.LEM,
  };
}

/** Remove a (deleted) group's id from every rule. A rule left with no
 *  assignments at all is dropped — keeping it would silently FREEZE that
 *  stage for everyone (empty rule = explicit freeze in Who-can-act terms),
 *  which is never what deleting a group means. Pre-existing empty rules
 *  (deliberate freezes) are untouched. */
function stripGroupFromPerms(ps: StagePermRule[], gid: string): StagePermRule[] {
  return ps.flatMap(r => {
    if (!r.actionGroupIds.includes(gid) && !r.editorGroupIds.includes(gid)) return [r];
    const next: StagePermRule = {
      ...r,
      actionGroupIds: r.actionGroupIds.filter(x => x !== gid),
      editorGroupIds: r.editorGroupIds.filter(x => x !== gid),
    };
    const empty = next.actionUserIds.length + next.actionGroupIds.length
      + next.editorUserIds.length + next.editorGroupIds.length === 0;
    return empty ? [] : [next];
  });
}

/** Remove a (deleted) group's id from the rules doc: workflow-type access
 *  lists and every rule exception. Entries left with no restrictions
 *  canonicalize back to bare strings (= unrestricted), and empty
 *  exemptGroupIds keys are dropped — mirroring the server sanitizer. */
function stripGroupFromRules(rs: StageRules, gid: string): StageRules {
  const dropExempt = <T extends { exemptGroupIds?: string[]; appliesToGroupIds?: string[] }>(r: T): T => {
    let out = r;
    if (out.exemptGroupIds?.includes(gid)) {
      const left = out.exemptGroupIds.filter(x => x !== gid);
      const { exemptGroupIds: _e, ...rest } = out;
      out = (left.length ? { ...rest, exemptGroupIds: left } : rest) as T;
    }
    if (out.appliesToGroupIds?.includes(gid)) {
      const left = out.appliesToGroupIds.filter(x => x !== gid);
      const { appliesToGroupIds: _a, ...rest } = out;
      out = (left.length ? { ...rest, appliesToGroupIds: left } : rest) as T;
    }
    return out;
  };
  const wt: NonNullable<StageRules["workflowTypes"]> = {};
  let wtTouched = false;
  for (const m of STAGE_RULE_MODULES) {
    const list = rs.workflowTypes?.[m];
    if (!list) continue;
    wt[m] = list.map(e => {
      if (typeof e === "string" || !e.allowedGroupIds?.includes(gid)) return e;
      wtTouched = true;
      const groups = e.allowedGroupIds.filter(x => x !== gid);
      const users = e.allowedUserIds ?? [];
      const stages = e.stages ?? [];
      if (groups.length === 0 && users.length === 0 && stages.length === 0) return e.name;
      const o: Exclude<WorkflowTypeEntry, string> = { name: e.name };
      if (groups.length) o.allowedGroupIds = groups;
      if (users.length) o.allowedUserIds = users;
      if (stages.length) o.stages = stages;
      return o;
    });
  }
  return {
    ...rs,
    fieldLocks: rs.fieldLocks.map(dropExempt),
    stageSkips: rs.stageSkips.map(dropExempt),
    ...(rs.formLayout ? { formLayout: rs.formLayout.map(dropExempt) } : {}),
    ...(wtTouched ? { workflowTypes: { ...rs.workflowTypes, ...wt } } : {}),
  };
}

/** Remap a draft group's regenerated id across the whole rules doc. */
function remapGroupInRules(rs: StageRules, from: string, to: string): StageRules {
  const remapExempt = <T extends { exemptGroupIds?: string[]; appliesToGroupIds?: string[] }>(r: T): T => {
    let out = r;
    if (out.exemptGroupIds?.includes(from)) out = { ...out, exemptGroupIds: out.exemptGroupIds.map(x => (x === from ? to : x)) };
    if (out.appliesToGroupIds?.includes(from)) out = { ...out, appliesToGroupIds: out.appliesToGroupIds.map(x => (x === from ? to : x)) };
    return out;
  };
  const wt: NonNullable<StageRules["workflowTypes"]> = {};
  let wtTouched = false;
  for (const m of STAGE_RULE_MODULES) {
    const list = rs.workflowTypes?.[m];
    if (!list) continue;
    wt[m] = list.map(e => {
      if (typeof e === "string" || !e.allowedGroupIds?.includes(from)) return e;
      wtTouched = true;
      return { ...e, allowedGroupIds: e.allowedGroupIds.map(x => (x === from ? to : x)) };
    });
  }
  return {
    ...rs,
    fieldLocks: rs.fieldLocks.map(remapExempt),
    stageSkips: rs.stageSkips.map(remapExempt),
    ...(rs.formLayout ? { formLayout: rs.formLayout.map(remapExempt) } : {}),
    ...(wtTouched ? { workflowTypes: { ...rs.workflowTypes, ...wt } } : {}),
  };
}

/** True when the rules doc references the group anywhere. */
function rulesReferenceGroup(rs: StageRules, gid: string): boolean {
  const inExempt = (r: { exemptGroupIds?: string[]; appliesToGroupIds?: string[] }) =>
    !!r.exemptGroupIds?.includes(gid) || !!r.appliesToGroupIds?.includes(gid);
  if (rs.fieldLocks.some(inExempt) || rs.stageSkips.some(inExempt) || (rs.formLayout ?? []).some(inExempt)) return true;
  for (const m of STAGE_RULE_MODULES) {
    if ((rs.workflowTypes?.[m] ?? []).some(e => typeof e !== "string" && !!e.allowedGroupIds?.includes(gid))) return true;
  }
  return false;
}

// Placeholder job titles (onboarding stamps "Staff") — when the title is a
// placeholder, the raw role text is the better grouping signal. Mirrors the
// server-side isTitlePlaceholder stance.
const PLACEHOLDER_TITLES = new Set(["", "staff", "employee", "user", "member", "n/a", "-", "tbd"]);

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong — please try again.");

/** Shared select style used across inline forms in this file. */
const selSt: React.CSSProperties = {
  height: 30, fontSize: 12.5, borderRadius: 6, padding: "0 8px", maxWidth: 230,
  border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
  color: "hsl(var(--foreground))", outline: "none", cursor: "pointer",
};

type PersonOpt = { value: string; label: string; role?: string; acl?: string | null; orgUnitIds?: string[] };

/** Normalise a raw acl value from the API to a display label.
 *  Built-ins: null / "" / "user" → "User" | "manager" → "Manager" | "admin" → "Admin"
 *  Custom: "custom:Viewer+" → "Viewer+" (strip prefix)
 *  Returns "" when the value is truly unrecognised. */
function aclLabel(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v === "user") return "User";
  if (v === "manager") return "Manager";
  if (v === "admin") return "Admin";
  if (v.startsWith("custom:")) return raw!.trim().slice(7).trim() || "";
  // Non-standard string — capitalise and show as-is.
  return (raw ?? "").trim();
}

/** Resolve a user's RAW acl marker to the level's display NAME. Custom levels
 *  live on the user row as "custom:<id>" — the Access Levels tab definitions
 *  (id + name) turn that into the level's name. */
function makeResolveAclName(levelDefs: { id: string; name: string }[]) {
  const idToName = new Map(levelDefs.map(l => [l.id.trim().toLowerCase(), l.name.trim()]));
  return (raw: string | null | undefined): string => {
    const v = (raw ?? "").trim().toLowerCase();
    if (v.startsWith("custom:")) {
      const id = v.slice(7).trim();
      return idToName.get(id) ?? aclLabel(raw);
    }
    return aclLabel(raw);
  };
}

/** Canonical options for a group's access level: built-ins + every level
 *  defined on the Access Levels tab ("previously created" levels). Values are
 *  what defaultAccessLevel stores — lowercase built-ins, custom level NAMES —
 *  the same vocabulary the staff-import group popup writes and consumes. */
function levelOptions(levelDefs: { id: string; name: string }[]) {
  const builtIns = [
    { value: "admin", label: "Admin" },
    { value: "manager", label: "Manager" },
    { value: "user", label: "User" },
  ];
  const seen = new Set(builtIns.map(o => o.label.toLowerCase()));
  const customs = levelDefs
    .map(l => ({ value: l.name.trim(), label: l.name.trim() }))
    .filter(o => o.value && !seen.has(o.value.toLowerCase()))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...builtIns, ...customs];
}

/** One compact row: the group's access level. Everyone in the group gets this
 *  level when the page is saved (and staff imports keep filling new members'
 *  empty levels from it). Replaces the old "add everyone with an access
 *  level" member quick-add. */
function GroupLevelRow({ value, onChange, levelDefs, memberIds, people, selfId, onNavigateToAccessLevels }: {
  value: string;
  onChange: (next: string) => void;
  levelDefs: { id: string; name: string }[];
  memberIds: string[];
  people: PersonOpt[];
  selfId?: string;
  onNavigateToAccessLevels?: () => void;
}) {
  const opts = useMemo(() => levelOptions(levelDefs), [levelDefs]);
  const cur = value.trim();
  const curMatch = opts.find(o => o.value.toLowerCase() === cur.toLowerCase());
  const resolveAclName = useMemo(() => makeResolveAclName(levelDefs), [levelDefs]);
  // How many members will actually change on save (your own account never does).
  const pending = useMemo(() => {
    if (!cur || people.length === 0) return 0;
    const target = (curMatch?.label ?? cur).toLowerCase();
    let n = 0;
    for (const m of memberIds) {
      const lm = m.toLowerCase();
      if (selfId && lm === selfId) continue;
      const p = people.find(x => x.value === lm);
      if (p && resolveAclName(p.acl).toLowerCase() !== target) n++;
    }
    return n;
  }, [cur, curMatch, memberIds, people, selfId, resolveAclName]);
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
      title="Everyone in this group gets this access level when you save. Members added later (including via staff imports) get it too. Your own account is never changed here."
    >
      <ShieldCheck style={{ width: 13, height: 13, color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>Access level for this group:</span>
      <select
        value={curMatch?.value ?? cur}
        aria-label="Access level for this group"
        style={selSt}
        onChange={e => {
          if (e.target.value === "__manage_custom__") {
            // Reset select to previous value, then navigate.
            e.target.value = curMatch?.value ?? cur;
            onNavigateToAccessLevels?.();
            return;
          }
          onChange(e.target.value);
        }}
      >
        <option value="">None — members keep their own</option>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        {cur && !curMatch && <option value={cur}>{cur} (level no longer exists)</option>}
        {onNavigateToAccessLevels && (
          <option value="__manage_custom__">＋ Manage custom levels…</option>
        )}
      </select>
      {cur && pending > 0 && (
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "#d97706", whiteSpace: "nowrap" }}>
          will update {pending} member{pending === 1 ? "" : "s"} on save
        </span>
      )}
      {cur && !!curMatch && pending === 0 && people.length > 0 && memberIds.length > 0 && (
        <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
          ✓ all members have this level
        </span>
      )}
    </div>
  );
}

/** Quick-add everyone currently in a BU / Division / Department / job role,
 *  in one click. This is a SNAPSHOT — people who join the unit or role later
 *  are not added automatically (rules and pickers can target the unit or role
 *  LIVE instead; this control is for seeding a group's member list). */
function OrgQuickAdd({ people, selected, orgUnits, onAdd }: {
  people: PersonOpt[];
  selected: string[];
  /** Org units shaped as pseudo-groups (id = "org:bu:<id>" etc.). */
  orgUnits: UserGroup[];
  /** addIds = people to add; removeIds = previous bulk batch to remove first. */
  onAdd: (addIds: string[], removeIds?: string[]) => void;
}) {
  const [picked, setPicked] = useState("");
  const [lastBulk, setLastBulk] = useState<{ id: string; label: string; ids: string[] } | null>(null);
  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected]);
  const membersOf = useCallback((sid: string) =>
    people.filter(p => (p.orgUnitIds ?? []).includes(sid)).map(p => p.value.toLowerCase()),
  [people]);
  const groupsByKind = useMemo(() => {
    const kinds: { label: string; prefix: string; items: { id: string; name: string; count: number }[] }[] = [
      { label: "Business Units", prefix: "org:bu:", items: [] },
      { label: "Divisions", prefix: "org:div:", items: [] },
      { label: "Departments", prefix: "org:dept:", items: [] },
      // Role pseudo-groups ("role:<guid>") ride the same orgUnits list; the
      // people rows' orgUnitIds include role sentinels, so counts work too.
      { label: "Roles", prefix: "role:", items: [] },
    ];
    for (const u of orgUnits) {
      const kind = kinds.find(k => u.id.startsWith(k.prefix));
      if (!kind) continue;
      kind.items.push({ id: u.id, name: u.name, count: membersOf(u.id).length });
    }
    for (const k of kinds) k.items.sort((a, b) => a.name.localeCompare(b.name));
    return kinds.filter(k => k.items.length > 0);
  }, [orgUnits, membersOf]);
  if (groupsByKind.length === 0) return null;
  const pickedUnit = orgUnits.find(u => u.id === picked);
  const addable = picked ? membersOf(picked).filter(id => !selectedSet.has(id)).length : 0;
  const isReplacement = !!picked && !!lastBulk && lastBulk.id !== picked;
  const canAct = !!picked && (addable > 0 || isReplacement);
  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
        title="Adds everyone currently in that unit or role as a one-time snapshot. Tip: stage rules and audience pickers can target a BU, Division, Department or Role directly, which stays up to date automatically."
      >
        <UserPlus style={{ width: 13, height: 13, color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>Add everyone in:</span>
        <select
          value={picked}
          onChange={e => setPicked(e.target.value)}
          style={{ height: 30, fontSize: 12.5, border: "1px solid hsl(var(--border))", borderRadius: 6, background: "hsl(var(--background))", padding: "0 6px", maxWidth: 260 }}
        >
          <option value="">Pick a unit…</option>
          {groupsByKind.map(k => (
            <optgroup key={k.prefix} label={k.label}>
              {k.items.map(it => (
                <option key={it.id} value={it.id}>{it.name} ({it.count})</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          disabled={!canAct}
          onClick={() => {
            if (!picked || !pickedUnit) return;
            const ids = membersOf(picked);
            // Same replace semantics as the access-level quick-add: switching
            // to a DIFFERENT unit offers to swap the previous batch out.
            let toRemove: string[] | undefined;
            if (lastBulk && lastBulk.id !== picked) {
              const swap = window.confirm(
                `You previously added ${lastBulk.ids.length} member${lastBulk.ids.length === 1 ? "" : "s"} from "${lastBulk.label}" with this control.\n\n` +
                `OK — remove them and add the "${pickedUnit.name}" members instead (replace)\n` +
                `Cancel — keep them and just add the "${pickedUnit.name}" members on top`,
              );
              if (swap) toRemove = lastBulk.ids;
            }
            onAdd(ids, toRemove);
            setLastBulk({ id: picked, label: pickedUnit.name, ids });
            setPicked("");
          }}
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 7,
            fontSize: 12, fontWeight: 700, border: "none",
            cursor: canAct ? "pointer" : "default",
            background: canAct ? "hsl(var(--primary))" : "hsl(var(--muted))",
            color: canAct ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
          }}
        >
          <Plus style={{ width: 12, height: 12 }} />
          {isReplacement ? "Replace" : `Add${addable > 0 ? ` ${addable}` : ""}`}
        </button>
      </div>
    </div>
  );
}

/** Compact member multi-pick (checkbox dropdown) with name chips. */
function MemberPick({ options, selected, onChange, loadingPeople, labelOf: labelOfProp }: {
  options: PersonOpt[];
  selected: string[];
  onChange: (next: string[]) => void;
  loadingPeople?: boolean;
  /** Parent-supplied id→name resolver (also covers removed/archived users). */
  labelOf?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  // Filters the DISPLAYED member chips (large groups) — separate from the
  // dropdown's people-search filter above.
  const [chipFilter, setChipFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Case-insensitive lookup; the parent resolver also covers removed users.
  // Never show a raw GUID — an unresolvable id reads "Former member".
  const labelOf = labelOfProp ?? ((v: string) =>
    options.find(o => o.value.toLowerCase() === v.toLowerCase())?.label
    ?? (loadingPeople ? "…" : "Former member"));

  // Store IDs normalised to lowercase to stay consistent with what the server returns.
  const toggle = (v: string) => {
    const lv = v.toLowerCase();
    const has = selected.some(s => s.toLowerCase() === lv);
    onChange(has ? selected.filter(s => s.toLowerCase() !== lv) : [...selected, lv]);
  };

  const shown = options.filter(o => o.label.toLowerCase().includes(filter.trim().toLowerCase()));

  // Chip search: for large groups, filter the DISPLAYED chips by name so a
  // member can be found (and removed) without scrolling the whole list.
  const chipQ = chipFilter.trim().toLowerCase();
  const visibleChips = chipQ ? selected.filter(v => labelOf(v).toLowerCase().includes(chipQ)) : selected;

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      {/* Chip search — right side, shown once the member list is long enough to need it */}
      {selected.length > 8 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", marginBottom: 4 }}>
          {chipQ && (
            <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
              {visibleChips.length} of {selected.length} shown
            </span>
          )}
          <div style={{ position: "relative" }}>
            <Search style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, color: "hsl(var(--muted-foreground))", pointerEvents: "none" }} />
            <input
              type="text"
              value={chipFilter}
              onChange={e => setChipFilter(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Search members…"
              style={{
                width: 190, padding: "4px 8px 4px 24px", fontSize: 12, borderRadius: 6,
                border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
                color: "hsl(var(--foreground))", outline: "none",
              }}
            />
          </div>
          {chipQ && (
            <button type="button" title="Clear search" onClick={() => setChipFilter("")}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "hsl(var(--muted-foreground))", display: "flex" }}>
              <X style={{ width: 12, height: 12 }} />
            </button>
          )}
        </div>
      )}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          minHeight: 36, border: "1px solid hsl(var(--border))", borderRadius: 8,
          padding: "4px 8px", cursor: "pointer", display: "flex",
          flexWrap: "wrap", gap: 4, alignItems: "center", background: "hsl(var(--background))",
        }}
      >
        {selected.length === 0 && (
          <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
            {loadingPeople ? "Loading people…" : "Pick members…"}
          </span>
        )}
        {chipQ && visibleChips.length === 0 && (
          <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 12.5 }}>
            No members match "{chipFilter.trim()}"
          </span>
        )}
        {visibleChips.map(v => (
          <span key={v} title={labelOf(v)} style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            background: "hsl(var(--muted))", borderRadius: 4, padding: "2px 7px",
            fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))",
          }}>
            {labelOf(v)}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); toggle(v); }}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "0 1px", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center" }}
            >
              <X style={{ width: 10, height: 10 }} />
            </button>
          </span>
        ))}
        <ChevronDown style={{
          marginLeft: "auto", width: 13, height: 13,
          color: "hsl(var(--muted-foreground))", flexShrink: 0,
          transition: "transform .15s", transform: open ? "rotate(180deg)" : "none",
        }} />
      </div>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 60,
          background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
          borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
          maxHeight: 260, overflowY: "auto",
        }}>
          <div style={{ padding: 8, borderBottom: "1px solid hsl(var(--border))" }}>
            <input
              autoFocus
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search people…"
              style={{
                width: "100%", padding: "5px 8px", fontSize: 12.5, borderRadius: 6,
                border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
                color: "hsl(var(--foreground))", outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          {loadingPeople && (
            <div style={{ display: "flex", justifyContent: "center", padding: "14px 0" }}>
              <Loader2 className="animate-spin" style={{ width: 16, height: 16, color: "hsl(var(--muted-foreground))" }} />
            </div>
          )}
          {!loadingPeople && shown.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>No matches</div>
          )}
          {!loadingPeople && shown.map(opt => (
            <label
              key={opt.value}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", fontSize: 13, color: "hsl(var(--popover-foreground))" }}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--muted))")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <input
                type="checkbox"
                checked={selected.some(s => s.toLowerCase() === opt.value.toLowerCase())}
                onChange={() => toggle(opt.value)}
                style={{ accentColor: "hsl(var(--primary))", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UserGroupsSettings({ tenantId, onNavigateToAccessLevels }: { tenantId?: string | null; onNavigateToAccessLevels?: () => void }) {
  const { toast } = useToast();
  // Instant render: boot from the session seed (settings hub pre-warms it)
  // and revalidate in the background.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time seed only
  const boot = useMemo((): UserGroup[] | null => {
    if (tenantId === null) return null;
    return getSeed<UserGroup[]>(`userGroups:${seedScope(tenantId)}`) ?? null;
  }, []);
  const [groups, setGroupsRaw]  = useState<UserGroup[]>(boot ?? []);
  const [snapshot, setSnapshot] = useState<string>(boot ? JSON.stringify(boot) : "[]");
  const [people, setPeople]     = useState<PersonOpt[]>([]);
  // Every access level defined on the Access Levels tab (id + name), so the
  // quick-add dropdown mirrors that tab 1:1 (even levels nobody holds yet) and
  // can resolve users' stored "custom:<id>" markers to level names.
  // Refetched on the permissions version bump: saving levels on the sibling
  // tab broadcasts notifyPermissionsChanged(), so new levels appear here
  // immediately without a page refresh.
  const [levelDefs, setLevelDefs] = useState<{ id: string; name: string }[]>([]);
  // Org units (BU / Division / Department) AND job roles for the quick-add —
  // own-company only, mirroring the people picker's gating. Role entries ride
  // the same pseudo-group list (id = "role:<guid>").
  const [orgUnits, setOrgUnits] = useState<UserGroup[]>([]);
  useEffect(() => {
    if (tenantId !== undefined) return; // quick-add is own-company only
    let alive = true;
    fetchOrgAudienceGroups()
      .then(us => { if (alive) setOrgUnits(us); })
      .catch(() => {/* control simply doesn't render */});
    return () => { alive = false; };
  }, [tenantId]);
  const permsVersion = usePermissionsVersion();
  useEffect(() => {
    if (tenantId !== undefined) return; // quick-add is own-company only
    let alive = true;
    fetchAccessLevels()
      .then(ls => { if (alive) setLevelDefs(ls.map(l => ({ id: l.id, name: l.name }))); })
      .catch(() => {/* dropdown falls back to built-ins + levels people hold */});
    return () => { alive = false; };
  }, [tenantId, permsVersion]);

  // Signed-in identity: the group-level feature never changes YOUR own level
  // (self-lockout guard), and archived-name lookups need the tenant label.
  const { user: authUser } = useAuth();
  const selfId = (authUser?.userId ?? "").trim().toLowerCase() || undefined;
  // Names for member ids missing from the ACTIVE people list (removed users)
  // — fetched once, only when actually needed, so chips read
  // "Janet Lee (removed)" instead of a raw id like "fcea9a01…".
  const [archivedNames, setArchivedNames] = useState<Map<string, string>>(new Map());
  // Which tenant label the archive fetch ran for — reset on tenant change so
  // one tenant's removed-user names can never label another tenant's ids.
  const archivedForRef = useRef<string | null>(null);
  const [loading, setLoading]   = useState(!boot);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [loadErr, setLoadErr]   = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);

  // Drop the cached names the moment the signed-in tenant changes.
  useEffect(() => {
    const label = authUser?.tenant?.trim() || null;
    if (archivedForRef.current !== null && archivedForRef.current !== label) {
      archivedForRef.current = null;
      setArchivedNames(new Map());
    }
  }, [authUser]);

  // Fetch archived users' names once per tenant, only if some member id can't
  // be resolved from the active people list (chips must never show raw GUIDs).
  useEffect(() => {
    if (tenantId !== undefined || loadingPeople || people.length === 0) return;
    const label = authUser?.tenant?.trim();
    if (!label || archivedForRef.current === label) return;
    const known = new Set(people.map(p => p.value));
    const unresolved = groups.some(g => g.memberIds.some(m => !known.has(m.toLowerCase())));
    if (!unresolved) return;
    archivedForRef.current = label;
    fetch(`/api/onboarding/members/archived?tenantId=${encodeURIComponent(label)}`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then((b: { members?: { userGuid?: string; name?: string }[] } | null) => {
        if (archivedForRef.current !== label) return; // tenant switched mid-flight
        const m = new Map<string, string>();
        for (const x of b?.members ?? []) {
          const id = String(x.userGuid ?? "").trim().toLowerCase();
          const nm = String(x.name ?? "").trim();
          if (id && nm) m.set(id, nm);
        }
        if (m.size > 0) setArchivedNames(m);
      })
      .catch(() => { /* chips fall back to "Former member" */ });
  }, [groups, people, loadingPeople, tenantId, authUser]);

  /** Member id → display name: active people → archived users ("(removed)")
   *  → "Former member". Never a raw GUID. */
  const resolveMemberLabel = useCallback((v: string) => {
    const lv = v.toLowerCase();
    const hit = people.find(o => o.value === lv);
    if (hit) return hit.label;
    const a = archivedNames.get(lv);
    if (a) return `${a} (removed)`;
    return loadingPeople ? "…" : "Former member";
  }, [people, archivedNames, loadingPeople]);

  // Background refetches must never clobber a draft the user already started.
  const dirtyRef = useRef(false);
  const firstRunRef = useRef(true);
  // Stale-response guard: a fetch resolving after a newer fetch, a tenant
  // switch, or a save must not apply. Bumping the seq invalidates everything
  // in flight.
  const loadSeqRef = useRef(0);
  // User edits mark the draft dirty SYNCHRONOUSLY — the memo-driven effect
  // below lags one render, which is enough for a resolving background fetch
  // to clobber a just-started edit. Load/save paths use setGroupsRaw.
  const setGroups = (v: UserGroup[] | ((prev: UserGroup[]) => UserGroup[])) => {
    dirtyRef.current = true;
    setGroupsRaw(v);
  };

  // Group colors (#119): effective color per group id — explicit color wins,
  // colorless groups preview the same auto-assignment the server applies on
  // save, so what you see here is what persists.
  const colors = useMemo(() => groupColorMap(groups), [groups]);
  // Which group's color swatch popover is open (group id; one at a time).
  const [colorPickFor, setColorPickFor] = useState<string | null>(null);
  const colorPopRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (colorPickFor === null) return;
    const h = (e: MouseEvent) => {
      if (colorPopRef.current && !colorPopRef.current.contains(e.target as Node)) setColorPickFor(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [colorPickFor]);

  // ── Stage assignments (#120): the stage-permissions doc + stage orders ──
  // Boot from the Stage Rules card's seed (settings hub pre-warms it) and
  // revalidate in the background, mirroring the groups doc above.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time seed only
  const bootStage = useMemo((): StageRulesSeed | null => {
    if (tenantId === null) return null;
    return getSeed<StageRulesSeed>(`stageRules:${seedScope(tenantId)}`) ?? null;
  }, []);
  const [perms, setPermsRaw] = useState<StagePermRule[]>(bootStage?.perms ?? []);
  const [permsSnapshot, setPermsSnapshot] = useState<string>(JSON.stringify(bootStage?.perms ?? []));
  // Editing/saving is gated on a REAL doc having loaded: saving after a
  // failed load would wipe every stage rule for the company (hollow-cache).
  const [permsReady, setPermsReady] = useState(!!bootStage);
  const [permsErr, setPermsErr] = useState(false);
  const [stageOrders, setStageOrders] = useState<Record<StageRuleModule, string[]>>(effectiveOrders(bootStage));
  // Which groups have their Stage assignments panel expanded (by group id).
  // openStages removed — stage-assignment editing moved to Stage Rules page.
  const permsDirtyRef = useRef(false);
  const permsSeqRef = useRef(0);
  const setPerms = (v: StagePermRule[] | ((prev: StagePermRule[]) => StagePermRule[])) => {
    permsDirtyRef.current = true;
    setPermsRaw(v);
  };

  // ── Rules doc draft: workflow access + rule exceptions ──────────────────
  // Same load/readiness/save discipline as the perms doc above (permsReady
  // gates BOTH — they arrive from the same fetch pair).
  const [rules, setRulesRaw] = useState<StageRules>(bootStage?.rules ?? EMPTY_STAGE_RULES);
  const [rulesSnapshot, setRulesSnapshot] = useState<string>(JSON.stringify(bootStage?.rules ?? EMPTY_STAGE_RULES));
  const rulesDirtyRef = useRef(false);
  const setRules = (v: StageRules | ((prev: StageRules) => StageRules)) => {
    rulesDirtyRef.current = true;
    setRulesRaw(v);
  };

  const loadStagePerms = useCallback(async (background: boolean) => {
    if (tenantId === null) return;
    const seq = ++permsSeqRef.current;
    if (!background) setPermsErr(false);
    try {
      const [permRules, st] = await Promise.all([
        fetchStagePermissions(tenantId),
        fetchStageRulesFor(tenantId),
      ]);
      if (seq !== permsSeqRef.current) return; // superseded (tenant switch / save)
      setStageOrders(effectiveOrders(st));
      if (!background || !permsDirtyRef.current) {
        setPermsRaw(permRules);
        setPermsSnapshot(JSON.stringify(permRules));
      }
      if (!background || !rulesDirtyRef.current) {
        setRulesRaw(st.rules);
        setRulesSnapshot(JSON.stringify(st.rules));
      }
      setPermsReady(true);
      setPermsErr(false);
      // Keep the Stage Rules card's seed fresh too — but only when a real
      // groups source exists (never fabricate an empty groups list).
      const seedKey = `stageRules:${seedScope(tenantId)}`;
      const seedGroups = getSeed<UserGroup[]>(`userGroups:${seedScope(tenantId)}`)
        ?? getSeed<StageRulesSeed>(seedKey)?.groups;
      if (seedGroups) {
        setSeed<StageRulesSeed>(seedKey, { rules: st.rules, stageOrder: st.stageOrder, perms: permRules, groups: seedGroups });
      }
    } catch {
      if (seq !== permsSeqRef.current) return;
      // Seeded view keeps rendering (stale-if-error); a cold load shows retry.
      if (!background) setPermsErr(true);
    }
  }, [tenantId]);

  const firstPermsRunRef = useRef(true);
  useEffect(() => {
    if (tenantId === null) {
      setPermsRaw([]); setPermsSnapshot("[]");
      setRulesRaw(EMPTY_STAGE_RULES); setRulesSnapshot(JSON.stringify(EMPTY_STAGE_RULES));
      setPermsReady(false); setPermsErr(false);
      permsDirtyRef.current = false;
      rulesDirtyRef.current = false;
      return;
    }
    let background: boolean;
    if (firstPermsRunRef.current) {
      firstPermsRunRef.current = false;
      background = !!bootStage;
    } else {
      const s = getSeed<StageRulesSeed>(`stageRules:${seedScope(tenantId)}`);
      if (s) {
        setPermsRaw(s.perms);
        setPermsSnapshot(JSON.stringify(s.perms));
        setRulesRaw(s.rules);
        setRulesSnapshot(JSON.stringify(s.rules));
        setStageOrders(effectiveOrders(s));
        setPermsReady(true); setPermsErr(false);
        background = true;
      } else {
        setPermsRaw([]); setPermsSnapshot("[]");
        setRulesRaw(EMPTY_STAGE_RULES); setRulesSnapshot(JSON.stringify(EMPTY_STAGE_RULES));
        setPermsReady(false); setPermsErr(false);
        setStageOrders(effectiveOrders(null));
        background = false;
      }
      // Fresh doc for this tenant — any draft belonged to the previous one.
      permsDirtyRef.current = false;
      rulesDirtyRef.current = false;
    }
    void loadStagePerms(background);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootStage is mount-constant
  }, [tenantId, loadStagePerms]);

  useEffect(() => {
    if (tenantId === null) {
      setGroups([]); setSnapshot("[]"); setPeople([]);
      setLoading(false); setLoadErr(null);
      return;
    }
    // Boot from the seed: first run already seeded via useState; tenant
    // switches re-check for the new tenant. Seeded = revalidate silently.
    let background = false;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      background = !!boot;
    } else {
      const s = getSeed<UserGroup[]>(`userGroups:${seedScope(tenantId)}`);
      if (s) {
        setGroupsRaw(s);
        setSnapshot(JSON.stringify(s));
        setLoading(false);
        setLoadErr(null);
        // Fresh doc for this tenant — any draft belonged to the previous one.
        dirtyRef.current = false;
        background = true;
      }
    }
    if (!background) { setLoading(true); setLoadErr(null); }

    const seq = ++loadSeqRef.current;
    // Fetch groups first so the UI appears quickly, then load people in the background.
    fetchUserGroups(tenantId)
      .then(gs => {
        if (seq !== loadSeqRef.current) return; // superseded (tenant switch / save)
        setSeed(`userGroups:${seedScope(tenantId)}`, gs);
        if (!background || !dirtyRef.current) {
          setGroupsRaw(gs);
          setSnapshot(JSON.stringify(gs));
        }
        setLoading(false);
        if (tenantId === undefined) {
          // Load people list in background so existing chips resolve to names
          // right away. One failed attempt (server restart, transient DB blip)
          // must NOT leave the chips showing raw IDs forever — retry a few
          // times with backoff before giving up (user report: member chips
          // showed "fcea9a01…" instead of names after a transient 502).
          const loadPeople = (attempt: number) => {
          getUserList()
            .then(raw => {
              // Superseded (save / tenant switch): stop, but never strand the
              // spinner — loadingPeople must always reach a terminal state.
              if (seq !== loadSeqRef.current) { setLoadingPeople(false); return; }
              const opts = (Array.isArray(raw) ? raw as Record<string, unknown>[] : [])
                .map(u => {
                  // Role for the quick-add grouper: real job title wins, but a
                  // placeholder title ("Staff") falls back to the raw role text.
                  const title = String(u.JobProfile ?? "").trim();
                  const rawRole = String(u.Role ?? "").trim();
                  const role = PLACEHOLDER_TITLES.has(title.toLowerCase()) ? rawRole : title;
                  const rawAcl = u.AccessLevel as string | null | undefined;
                  // Live org sentinel ids (org:bu/div/dept) — backs the
                  // "add everyone in a BU/Division/Department" quick-add with
                  // the SAME membership the server-side rules resolve.
                  const orgUnitIds = Array.isArray(u.OrgUnitIds)
                    ? (u.OrgUnitIds as unknown[]).map(s => String(s ?? "").trim().toLowerCase()).filter(Boolean)
                    : [];
                  return {
                    // Normalise value to lowercase so it always matches saved memberIds.
                    value: String(u.Id ?? u.id ?? "").toLowerCase(),
                    label: String(u.Name ?? u.name ?? u.UserName ?? u.username ?? "").trim(),
                    ...(role ? { role } : {}),
                    acl: rawAcl ?? null,
                    ...(orgUnitIds.length ? { orgUnitIds } : {}),
                  };
                })
                .filter(p => p.value && p.label)
                .sort((a, b) => a.label.localeCompare(b.label));
              setPeople(opts);
              setLoadingPeople(false);
            })
            .catch(() => {
              if (seq !== loadSeqRef.current) { setLoadingPeople(false); return; } // superseded
              if (attempt < 5) {
                setTimeout(() => {
                  if (seq === loadSeqRef.current) loadPeople(attempt + 1);
                  else setLoadingPeople(false);
                }, 2500 * attempt);
              } else {
                // Out of retries — picker gracefully empty, chips fall back to IDs.
                setLoadingPeople(false);
              }
            });
          };
          setLoadingPeople(true);
          loadPeople(1);
        }
      })
      .catch(e => {
        if (seq !== loadSeqRef.current) return; // superseded
        // Background refresh failure: keep showing the seeded list (stale-if-error).
        if (!background) setLoadErr(e instanceof Error ? e.message : "Could not load user groups");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot is mount-constant
  }, [tenantId]);

  const savedIds = useMemo(() => {
    try { return new Set((JSON.parse(snapshot) as UserGroup[]).map(g => g.id)); }
    catch { return new Set<string>(); }
  }, [snapshot]);

  const dirty = useMemo(() => JSON.stringify(groups) !== snapshot, [groups, snapshot]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const stagesDirty = useMemo(
    () => permsReady && JSON.stringify(perms) !== permsSnapshot,
    [permsReady, perms, permsSnapshot],
  );
  useEffect(() => { permsDirtyRef.current = stagesDirty; }, [stagesDirty]);
  const rulesDirty = useMemo(
    () => permsReady && JSON.stringify(rules) !== rulesSnapshot,
    [permsReady, rules, rulesSnapshot],
  );
  useEffect(() => { rulesDirtyRef.current = rulesDirty; }, [rulesDirty]);
  const anyDirty = dirty || stagesDirty || rulesDirty;

  // Typing only updates the name. The draft id is NOT regenerated here — the
  // rows are keyed by g.id, so changing it per keystroke remounts the row and
  // the input loses focus after every character. Ids catch up on blur.
  const renameGroup = (i: number, name: string) => {
    setGroups(gs => gs.map((x, j) => (j === i ? { ...x, name } : x)));
  };

  // Draft (unsaved) groups regenerate their id from the name once the user
  // LEAVES the name field (blur fires before any Save click lands) — any
  // stage assignments already added under the old draft id must follow it.
  const finalizeGroupId = (i: number) => {
    const g = groups[i];
    if (!g || savedIds.has(g.id)) return;
    const taken = new Set(groups.filter((_, k) => k !== i).map(x => x.id));
    const nid = groupIdFromName(g.name || "group", taken);
    if (nid === g.id) return;
    const remap = { from: g.id, to: nid };
    setGroups(gs => gs.map((x, j) => (j === i ? { ...x, id: remap.to } : x)));
    {
      const { from, to } = remap;
      if (permsReady && perms.some(r => r.actionGroupIds.includes(from) || r.editorGroupIds.includes(from))) {
        setPerms(ps => ps.map(r => ({
          ...r,
          actionGroupIds: r.actionGroupIds.map(x => (x === from ? to : x)),
          editorGroupIds: r.editorGroupIds.map(x => (x === from ? to : x)),
        })));
      }
      if (permsReady && rulesReferenceGroup(rules, from)) {
        setRules(rs => remapGroupInRules(rs, from, to));
      }
      // openStages removed — stage-assignment editing moved to Stage Rules page.
    }
  };

  // Mirrors the latest tenant prop so an in-flight save can tell whether the
  // superadmin switched companies mid-save. Seed writes stay safe either way
  // (they're scoped to the ORIGINAL tenant), but state writes must be skipped.
  const tenantRef = useRef(tenantId);
  useEffect(() => { tenantRef.current = tenantId; }, [tenantId]);

  const doSave = async () => {
    if (tenantId === null) return;
    const tid = tenantId; // tenant this save belongs to (closure-stable)
    const sentGroups = JSON.stringify(groups);
    const sentPerms = JSON.stringify(perms);
    const sentRules = JSON.stringify(rules);
    const groupsDirtyNow = sentGroups !== snapshot;
    const permsDirtyNow = permsReady && sentPerms !== permsSnapshot;
    const rulesDirtyNow = permsReady && sentRules !== rulesSnapshot;
    if (!groupsDirtyNow && !permsDirtyNow && !rulesDirtyNow) return;
    if (groupsDirtyNow) {
      const bad = groups.find(g => !g.name.trim());
      if (bad) {
        toast({ title: "Every group needs a name", variant: "destructive" });
        return;
      }
    }
    // ── Group access level → member access levels (own company only) ──────
    // Triggered by: the group's level CHANGED (applies to all its members) or
    // members were ADDED to a group that has a level (applies to just them).
    // Unrelated saves never re-stamp anyone — Manage Staff stays the
    // per-person override authority.
    type AclApply = { guid: string; acl: string; levelName: string; fromGroup: string };
    const aclPlan: AclApply[] = [];
    const aclWarnings: string[] = [];
    let selfSkipped = false;
    if (groupsDirtyNow && tenantId === undefined) {
      let prevList: UserGroup[] = [];
      try { prevList = JSON.parse(snapshot) as UserGroup[]; } catch { /* fresh page */ }
      const prevById = new Map(prevList.map(p => [p.id, p]));
      const resolveAclName = makeResolveAclName(levelDefs);
      const aclByGuid = new Map(people.map(p => [p.value, p.acl ?? null]));
      const levelToAcl = (name: string): string | null => {
        const n = name.trim().toLowerCase();
        if (n === "admin" || n === "manager" || n === "user") return n;
        const def = levelDefs.find(l => l.name.trim().toLowerCase() === n);
        return def ? `custom:${def.id}` : null;
      };
      // Conflict guard below compares PLANNED writes only: a standing
      // membership in an unchanged group never blocks the save — levels are
      // applied on change/add, not continuously enforced.
      const planned = new Map<string, AclApply>();
      for (const g of groups) {
        const lvl = (g.defaultAccessLevel ?? "").trim();
        if (!lvl) continue;
        const acl = levelToAcl(lvl);
        if (!acl) {
          aclWarnings.push(`"${g.name}": the level "${lvl}" no longer exists — nobody's level was changed.`);
          continue;
        }
        const prev = prevById.get(g.id);
        const prevLvl = (prev?.defaultAccessLevel ?? "").trim().toLowerCase();
        const levelChanged = prevLvl !== lvl.toLowerCase();
        const prevMembers = new Set((prev?.memberIds ?? []).map(m => m.toLowerCase()));
        for (const raw of g.memberIds) {
          const m = raw.toLowerCase();
          if (!levelChanged && prevMembers.has(m)) continue; // untouched member
          if (selfId && m === selfId) { selfSkipped = true; continue; }
          if (!aclByGuid.has(m)) continue; // removed/unknown user — nothing to set
          if (resolveAclName(aclByGuid.get(m)).toLowerCase() === lvl.toLowerCase()) continue; // already there
          const already = planned.get(m);
          if (already && already.acl !== acl) {
            toast({
              title: "One person, two access levels",
              description: `${resolveMemberLabel(m)} would get "${already.levelName}" from "${already.fromGroup}" and "${aclLabel(lvl)}" from "${g.name}" in this save. Match the levels or remove them from one group.`,
              variant: "destructive",
            });
            return;
          }
          planned.set(m, { guid: m, acl, levelName: aclLabel(lvl), fromGroup: g.name });
        }
      }
      aclPlan.push(...planned.values());
      if (aclPlan.length > 0) {
        const byLevel = new Map<string, number>();
        for (const a of aclPlan) byLevel.set(a.levelName, (byLevel.get(a.levelName) ?? 0) + 1);
        const lines = [...byLevel.entries()]
          .map(([l, n]) => `  • ${n} ${n === 1 ? "person" : "people"} → ${l}`).join("\n");
        const ok = window.confirm(
          `Saving will also change access levels to match their group:\n\n${lines}\n\n` +
          (selfSkipped ? "(Your own account is never changed here.)\n\n" : "") +
          "Continue?",
        );
        if (!ok) return;
      }
    }
    setSaving(true);
    // Invalidate in-flight loads so a stale response can't overwrite the save.
    loadSeqRef.current++;
    permsSeqRef.current++;
    const seedKey = `stageRules:${seedScope(tid)}`;
    // A save response only replaces local state when (a) we're still on the
    // same tenant and (b) the user didn't keep editing while the save was in
    // flight. Otherwise the newer draft survives and simply stays dirty
    // against the fresh snapshot — the snapshot ALWAYS becomes server truth.
    const sameTenant = () => tenantRef.current === tid;
    let savedGroups: UserGroup[] | null = null;
    try {
      if (groupsDirtyNow) {
        savedGroups = await saveUserGroups(groups, tid);
        const sg = savedGroups;
        // Keep the instant-render seeds in step so the next visit boots on the saved list.
        setSeed(`userGroups:${seedScope(tid)}`, sg);
        const cur = getSeed<StageRulesSeed>(seedKey);
        if (cur) setSeed<StageRulesSeed>(seedKey, { ...cur, groups: sg });
        if (sameTenant()) {
          setGroupsRaw(prev => (JSON.stringify(prev) === sentGroups ? sg : prev));
          setSnapshot(JSON.stringify(sg));
        }
      }
    } catch (e) {
      toast({ title: "Could not save user groups", description: errMsg(e), variant: "destructive" });
      setSaving(false);
      return; // don't write stage assignments that reference unsaved groups
    }
    // Apply the planned access-level changes now that the groups doc is
    // saved. Per-member writes reuse the Manage Staff endpoint, so its
    // validation + audit trail apply; silent mode = one signal at the end.
    let aclApplied = 0;
    if (aclPlan.length > 0) {
      const failedGuids = new Set<string>();
      for (const a of aclPlan) {
        try {
          await updateStaffAssignment(a.guid, { accessLevel: a.acl }, { silent: true });
          aclApplied++;
        } catch {
          failedGuids.add(a.guid);
        }
      }
      if (aclApplied > 0) {
        const appliedBy = new Map(aclPlan.filter(a => !failedGuids.has(a.guid)).map(a => [a.guid, a.acl]));
        // Local truth: the pending-counters and chips read the new levels.
        setPeople(ps => ps.map(p => (appliedBy.has(p.value) ? { ...p, acl: appliedBy.get(p.value)! } : p)));
        notifyPermissionsChanged();
      }
      if (failedGuids.size > 0) {
        toast({
          title: "Some access levels didn't update",
          description: `${[...failedGuids].map(resolveMemberLabel).join(", ")} — re-pick the group's level and save again to retry.`,
          variant: "destructive",
        });
      }
    }
    if (aclWarnings.length > 0) {
      toast({ title: "Heads up", description: aclWarnings.join(" ") });
    }
    let permsOk = !permsDirtyNow;
    let rulesOk = !rulesDirtyNow;
    try {
      if (permsDirtyNow) {
        const savedPerms = await saveStagePermissions(perms, tid);
        const cur = getSeed<StageRulesSeed>(seedKey);
        if (cur) setSeed<StageRulesSeed>(seedKey, { ...cur, perms: savedPerms });
        if (sameTenant()) {
          setPermsRaw(prev => (JSON.stringify(prev) === sentPerms ? savedPerms : prev));
          setPermsSnapshot(JSON.stringify(savedPerms));
        }
        permsOk = true;
      }
    } catch (e) {
      toast({
        title: savedGroups ? "Groups saved — but stage assignments didn't save"
          : "Could not save stage assignments",
        description: errMsg(e),
        variant: "destructive",
      });
    }
    // Workflow access + rule exceptions live in the RULES doc — an
    // independent save, so a stage-assignment failure doesn't block it.
    try {
      if (rulesDirtyNow) {
        const savedRules = await saveStageRules(rules, typeof tid === "string" ? tid : undefined);
        const cur = getSeed<StageRulesSeed>(seedKey);
        if (cur) setSeed<StageRulesSeed>(seedKey, { ...cur, rules: savedRules });
        if (sameTenant()) {
          setRulesRaw(prev => (JSON.stringify(prev) === sentRules ? savedRules : prev));
          setRulesSnapshot(JSON.stringify(savedRules));
        }
        rulesOk = true;
      }
    } catch (e) {
      toast({
        title: "Could not save workflow access / rule exceptions",
        description: errMsg(e),
        variant: "destructive",
      });
    }
    if (permsOk && rulesOk) {
      toast({
        title: [
          groupsDirtyNow ? "Groups" : "",
          permsDirtyNow ? "stage assignments" : "",
          rulesDirtyNow ? "workflow access & exceptions" : "",
        ].filter(Boolean).join(", ").replace(/^./, c => c.toUpperCase()) + " saved",
        description: (aclApplied > 0 ? `Access level updated for ${aclApplied} ${aclApplied === 1 ? "person" : "people"}. ` : "")
          + (permsDirtyNow || rulesDirtyNow
            ? "Workflow & Stages shows the same assignments — it's one shared rulebook."
            : "Use them in Settings → Projects & Opportunities schedule to assign whole teams to stages."),
      });
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
        <Loader2 className="animate-spin" style={{ width: 22, height: 22, color: "hsl(var(--muted-foreground))" }} />
      </div>
    );
  }

  if (loadErr) {
    return <div style={{ fontSize: 13, color: "hsl(var(--destructive))", padding: "12px 0" }}>{loadErr}</div>;
  }

  if (tenantId === null) {
    return (
      <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", lineHeight: 1.5, padding: "12px 0" }}>
        Choose a company first — user groups belong to a specific company.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 20 }}>
        <Users style={{ width: 18, height: 18, color: "#6366f1", marginTop: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: "hsl(var(--foreground))" }}>User Groups</div>
          <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 3, lineHeight: 1.5 }}>
            Group people so you can give a whole team stage permissions at once.
            You can also give a group an access level — everyone in it gets that
            level when you save. Assign groups to stages and workflows in{" "}
            <b style={{ color: "hsl(var(--foreground))" }}>Settings → Projects &amp; Opportunities schedule</b>.
          </div>
        </div>
      </div>

      {/* Superadmin note */}
      {typeof tenantId === "string" && (
        <div style={{
          fontSize: 12.5, color: "hsl(var(--muted-foreground))", marginBottom: 16, lineHeight: 1.5,
          padding: "8px 12px", border: "1px solid hsl(var(--border))", borderRadius: 8,
          background: "hsl(var(--muted) / 0.3)",
        }}>
          Managing groups for <b style={{ color: "hsl(var(--foreground))" }}>{tenantId}</b>.
          You can add, rename, or delete groups here; picking members by name is only
          available inside that company's own workspace.
        </div>
      )}

      {/* Empty state */}
      {groups.length === 0 && (
        <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginBottom: 14 }}>
          No groups yet. Add one — for example "Proposals team" or "Project controls".
        </div>
      )}

      {/* Group list */}
      {groups.map((g, i) => {
        return (
        <div
          key={g.id}
          style={{
            padding: "10px 12px", border: "1px solid hsl(var(--border))",
            borderRadius: 10, marginBottom: 8, background: "hsl(var(--muted) / 0.25)",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: tenantId === undefined ? 8 : 0 }}>
            {/* Color swatch + popover picker (#119) */}
            <div ref={colorPickFor === g.id ? colorPopRef : undefined} style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                title="Group color — shown wherever this group appears"
                aria-label={`Change color for ${g.name || "this group"}`}
                aria-expanded={colorPickFor === g.id}
                onClick={() => setColorPickFor(cur => (cur === g.id ? null : g.id))}
                style={{
                  width: 22, height: 22, borderRadius: "50%", padding: 0, display: "block",
                  border: "2px solid hsl(var(--border))", background: colors.get(g.id) ?? "#64748b",
                  cursor: "pointer",
                }}
              />
              {colorPickFor === g.id && (
                <div style={{
                  position: "absolute", top: 28, left: 0, zIndex: 70,
                  background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
                  borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.35)", padding: 10,
                  display: "grid", gridTemplateColumns: "repeat(8, 20px)", gap: 6,
                }}>
                  {GROUP_COLOR_PALETTE.map(c => (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      aria-label={`Use color ${c}`}
                      aria-pressed={colors.get(g.id) === c}
                      onClick={() => {
                        setGroups(gs => gs.map((x, j) => (j === i ? { ...x, color: c } : x)));
                        setColorPickFor(null);
                      }}
                      style={{
                        width: 20, height: 20, borderRadius: "50%", background: c, padding: 0,
                        border: colors.get(g.id) === c ? "2px solid hsl(var(--foreground))" : "2px solid transparent",
                        cursor: "pointer",
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            <input
              value={g.name}
              onChange={e => renameGroup(i, e.target.value)}
              onBlur={() => finalizeGroupId(i)}
              placeholder="Group name (e.g. Proposals team)"
              style={{
                flex: "0 1 280px", minWidth: 140, padding: "6px 10px", fontSize: 13, fontWeight: 600,
                borderRadius: 7, border: "1px solid hsl(var(--border))",
                background: "hsl(var(--background))", color: "hsl(var(--foreground))", outline: "none",
              }}
            />
            <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
              {g.memberIds.length} member{g.memberIds.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              // Deleting is held until the stage docs load: otherwise the
              // deletion could save while the group's stage assignments,
              // workflow access and exceptions stay behind as dead references.
              disabled={!permsReady}
              title={permsReady ? "Delete this group" : "Still loading this group's stage assignments — one moment…"}
              onClick={() => {
                if (!permsReady) return;
                const gid = g.id;
                setGroups(gs => gs.filter((_, j) => j !== i));
                // A deleted group's stage assignments go with it — leaving its
                // id behind would keep dead references (and an all-empty rule
                // would silently freeze that stage). Only touch the doc when
                // it really loaded.
                if (permsReady && perms.some(r => r.actionGroupIds.includes(gid) || r.editorGroupIds.includes(gid))) {
                  setPerms(ps => stripGroupFromPerms(ps, gid));
                }
                // Same for workflow access + rule exceptions in the rules doc.
                if (permsReady && rulesReferenceGroup(rules, gid)) {
                  setRules(rs => stripGroupFromRules(rs, gid));
                }
              }}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: permsReady ? "pointer" : "default", opacity: permsReady ? 1 : 0.45, color: "hsl(var(--muted-foreground))", display: "flex", padding: 4 }}
            >
              <Trash2 style={{ width: 14, height: 14 }} />
            </button>
          </div>

          {/* People picker — only for own company */}
          {tenantId === undefined && (
            <>
              {/* Row 1: individual member pick + org bulk-add side by side */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <MemberPick
                    options={people}
                    selected={g.memberIds}
                    onChange={memberIds => setGroups(gs => gs.map((x, j) => j === i ? { ...x, memberIds } : x))}
                    loadingPeople={loadingPeople}
                    labelOf={resolveMemberLabel}
                  />
                </div>
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  <OrgQuickAdd
                    people={people}
                    orgUnits={orgUnits}
                    selected={g.memberIds}
                    onAdd={(ids, removeIds) => setGroups(gs => gs.map((x, j) => {
                      if (j !== i) return x;
                      const toRemove = new Set((removeIds ?? []).map(s => s.toLowerCase()));
                      const base = toRemove.size > 0
                        ? x.memberIds.filter(m => !toRemove.has(m.toLowerCase()))
                        : x.memberIds;
                      const have = new Set(base.map(s => s.toLowerCase()));
                      return { ...x, memberIds: [...base, ...ids.filter(v => !have.has(v))] };
                    }))}
                  />
                </div>
              </div>
              {/* Row 2: access level below */}
              <div style={{ marginTop: 8 }}>
                <GroupLevelRow
                  value={g.defaultAccessLevel ?? ""}
                  levelDefs={levelDefs}
                  memberIds={g.memberIds}
                  people={people}
                  selfId={selfId}
                  onNavigateToAccessLevels={onNavigateToAccessLevels}
                  onChange={lvl => setGroups(gs => gs.map((x, j) => {
                    if (j !== i) return x;
                    const { defaultAccessLevel: _d, ...rest } = x;
                    return lvl ? { ...rest, defaultAccessLevel: lvl } : rest;
                  }))}
                />
              </div>
            </>
          )}

          {/* Link to the schedule cards where stages, rules & audiences live */}
          <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px dashed hsl(var(--border))", display: "flex", alignItems: "center", gap: 6 }}>
            <ClipboardList style={{ width: 13, height: 13, color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>
              Assign this group to schedules &amp; stage rules in{" "}
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("rmone:openSettingsSection", { detail: { cat: "projects", sub: "opp-defaults" } }))}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12.5, fontWeight: 600, color: "hsl(var(--foreground))", textDecoration: "underline" }}
              >
                Schedule settings
              </button>
            </span>
          </div>
        </div>
        );
      })}

      {/* Add group */}
      <button
        type="button"
        onClick={() => {
          const taken = new Set(groups.map(g => g.id));
          // Stamp the next free palette color so the preview is locked in.
          const usedColors = new Set(groupColorMap(groups).values());
          const color = GROUP_COLOR_PALETTE.find(c => !usedColors.has(c))
            ?? GROUP_COLOR_PALETTE[groups.length % GROUP_COLOR_PALETTE.length];
          setGroups(gs => [...gs, { id: groupIdFromName("New group", taken), name: "New group", memberIds: [], color }]);
        }}
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
          borderRadius: 8, border: "1px dashed hsl(var(--border))", background: "transparent",
          cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "hsl(var(--foreground))",
          marginBottom: 28,
        }}
      >
        <Plus style={{ width: 13, height: 13 }} /> Add group
      </button>

      {/* Save bar — one Save writes both docs (groups + stage assignments) */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
        {anyDirty && !saving && (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#d97706" }}>Unsaved changes</span>
        )}
        <button
          type="button"
          onClick={() => void doSave()}
          disabled={saving || !anyDirty}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8,
            fontSize: 13, fontWeight: 700, border: "none",
            cursor: saving || !anyDirty ? "default" : "pointer",
            background: saving || !anyDirty ? "hsl(var(--muted))" : "#6366f1",
            color: saving || !anyDirty ? "hsl(var(--muted-foreground))" : "#fff",
          }}
        >
          {saving
            ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
            : <Save style={{ width: 13, height: 13 }} />}
          {anyDirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </div>
  );
}
