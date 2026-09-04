/**
 * Lead/Team hierarchy model — Resources page → Manager view.
 *
 * Turns the raw /lead-team-context payload into a tiered, deduplicated
 * "org structure" model. IMPORTANT HONESTY RULE: tiers reflect the lead
 * (key-personnel) fields people hold on the selected person's records —
 * they are NOT a fabricated reporting chain. A person appearing in a higher
 * band means "holds a more senior lead role on these records", nothing more.
 *
 * Dedupe: one node per person (GUID first, name-only fallback), placed at
 * their MOST SENIOR (minimum) tier across all records, with per-record role
 * chips retained so context is never lost.
 */
import { KP_LEAD_ROLES } from "./quickActions";
import type { LeadTeamContext, LeadTeamRecord } from "./api";

// ── Tier catalogue ────────────────────────────────────────────────────────────
// 1 Executive · 2 Sponsors/Owners · 3 Senior delivery · 4 Delivery leads ·
// 5 Specialist leads · 6 Team members (allocation rows, no lead field).
export const TIER_LABELS: Record<number, string> = {
  1: "Executive Leadership",
  2: "Sponsors & Owners",
  3: "Senior Management",
  4: "Delivery Leads",
  5: "Specialist Leads",
  6: "Team Members",
};

const FIELD_TIER: Record<string, number> = {
  PresidentUser: 1,
  ExecutiveVicePresidentUser: 1,
  SeniorVicePresidentUser: 1,
  VicePresidentUser: 1,
  AssociateVicePresidentUser: 1,
  PrincipalUser: 1,
  ProjectExecutiveUser: 1,
  SponsorsUser: 2,
  OwnerUser: 2,
  BusinessLeadUser: 2,
  ProgramManagerUser: 2,
  StakeHoldersUser: 2,
  SeniorProjectManagerUser: 3,
  SeniorEstimatorUser: 3,
  SeniorMEPManagerUser: 3,
  SeniorSuperintendentUser: 3,
  ProjectManagerUser: 4,
  ProjectLeadUser: 4,
  LeadEstimatorUser: 4,
  LeadSuperintendentUser: 4,
  EstimatorUser: 5,
  SuperintendentUser: 5,
  PointOfContact: 5,
};

const FIELD_ROLE: Record<string, string> = Object.fromEntries(
  KP_LEAD_ROLES.map(r => [r.field, r.role]),
);

/** User-typed roles from CustomLeadsJson arrive as `custom:<Role Label>` —
 *  same prefix convention as the record-detail KeyPersonnel flow. */
const CUSTOM_FIELD_PREFIX = "custom:";

/** Tier for a raw *User field name; unknown/custom fields land in tier 5. */
export function tierForField(field: string): number {
  if (field.startsWith(CUSTOM_FIELD_PREFIX)) return 5;
  return FIELD_TIER[field] ?? 5;
}

/** Human label for a raw *User field name ("VicePresidentUser" → "Vice President"). */
export function roleForField(field: string): string {
  if (field.startsWith(CUSTOM_FIELD_PREFIX)) {
    return field.slice(CUSTOM_FIELD_PREFIX.length).trim() || field;
  }
  const known = FIELD_ROLE[field];
  if (known) return known;
  // Prettify unknown custom columns: strip trailing "User", split camel-case.
  return field.replace(/User$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || field;
}

// ── Model types ───────────────────────────────────────────────────────────────

export interface HierarchyRecordRef {
  ticketId: string;
  title: string;
  module: "PMM" | "OPM";
  /** Role label this person carries ON THIS RECORD (lead role or team role). */
  role: string;
  /** Raw *User field behind `role` for LEAD refs (absent for team refs) —
   *  kept so seniority comparisons never reverse-map display labels. */
  field?: string;
}

export interface HierarchyPersonNode {
  /** Stable dedupe key: lowercased GUID, or "name:<lower>" for name-only tokens. */
  key: string;
  /** null = legacy name-only token — cannot open the hours grid. */
  id: string | null;
  name: string;
  /** Job title from the staff directory ("" when unknown). */
  title: string;
  /** 1–5 lead tiers, 6 = team member. */
  tier: number;
  /** Distinct role labels across records, most senior first, with counts. */
  roles: { role: string; count: number }[];
  /** Every record this person appears on (within the selected lead's scope). */
  records: HierarchyRecordRef[];
  isSelected: boolean;
}

export interface HierarchyTeamGroup {
  ticketId: string;
  title: string;
  module: "PMM" | "OPM";
  members: HierarchyPersonNode[];
}

export interface LeadHierarchyModel {
  selected: HierarchyPersonNode;
  /** Lead bands (tier 1–5) that actually have people, ascending tier. */
  tiers: { tier: number; label: string; people: HierarchyPersonNode[] }[];
  /** Team members (no lead role on these records), grouped per record. */
  teamGroups: HierarchyTeamGroup[];
  /** Unique people across the whole model (selected + leads + team). */
  totalPeople: number;
  totalRecords: number;
  /** Team-member count after dedupe (excluding leads + selected). */
  totalTeamMembers: number;
}

// ── Builder ───────────────────────────────────────────────────────────────────

function nodeKey(id: string | null, name: string): string {
  return id ? id.toLowerCase() : `name:${name.trim().toLowerCase()}`;
}

interface Acc {
  id: string | null;
  name: string;
  title: string;
  minTier: number;
  roleCounts: Map<string, number>;
  /** role label per record (first lead role wins; team role only if no lead role). */
  records: Map<string, HierarchyRecordRef>;
}

function ensureAcc(map: Map<string, Acc>, key: string, id: string | null, name: string, title: string): Acc {
  let a = map.get(key);
  if (!a) {
    a = { id, name, title, minTier: 99, roleCounts: new Map(), records: new Map() };
    map.set(key, a);
  }
  if (!a.id && id) a.id = id;
  if (!a.title && title) a.title = title;
  return a;
}

function recKey(r: LeadTeamRecord): string {
  return `${r.module}:${r.ticketId.toLowerCase()}`;
}

function toNode(key: string, a: Acc, selectedKey: string): HierarchyPersonNode {
  const roles = Array.from(a.roleCounts.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((x, y) => y.count - x.count || x.role.localeCompare(y.role));
  return {
    key,
    id: a.id,
    name: a.name,
    title: a.title,
    tier: a.minTier === 99 ? 6 : a.minTier,
    roles,
    records: Array.from(a.records.values()),
    isSelected: key === selectedKey,
  };
}

/**
 * Build the tiered hierarchy model for a selected person.
 * `ctx.records` empty (worker case) → model contains ONLY the selected person.
 */
export function buildLeadHierarchyModel(ctx: LeadTeamContext): LeadHierarchyModel {
  const selectedKey = nodeKey(ctx.person.id || null, ctx.person.name || ctx.person.id);
  const leadAccs = new Map<string, Acc>();

  // Pass 1 — every lead on every record (includes the selected person's own
  // lead roles, and higher/lower leads alike).
  for (const rec of ctx.records) {
    for (const lead of rec.leads) {
      const key = nodeKey(lead.id, lead.name);
      const a = ensureAcc(leadAccs, key, lead.id, lead.name, "");
      const tier = tierForField(lead.field);
      const role = roleForField(lead.field);
      if (tier < a.minTier) a.minTier = tier;
      a.roleCounts.set(role, (a.roleCounts.get(role) ?? 0) + 1);
      const rk = recKey(rec);
      const existing = a.records.get(rk);
      if (!existing) {
        a.records.set(rk, { ticketId: rec.ticketId, title: rec.title, module: rec.module, role, field: lead.field });
      } else if (tier < tierForField(existing.field ?? "")) {
        // Most senior role label per record — compared on the RAW field, so a
        // custom field whose prettified label collides with a canonical label
        // can never inherit the wrong tier.
        existing.role = role;
        existing.field = lead.field;
      }
    }
  }

  // Ensure the selected person exists even when they lead nothing (worker) —
  // or when their id matched records but their own lead entry was name-only.
  const selAcc = ensureAcc(
    leadAccs, selectedKey,
    ctx.person.id || null,
    ctx.person.name || ctx.person.id,
    ctx.person.title || "",
  );

  // Pass 2 — team members (allocation rows). A person already present as a
  // lead only gains record refs; new people become tier-6 accs.
  const teamAccs = new Map<string, Acc>();
  for (const rec of ctx.records) {
    const rk = recKey(rec);
    for (const m of rec.team) {
      const key = nodeKey(m.id, m.name);
      const role = m.role || "Team Member";
      const leadAcc = leadAccs.get(key);
      if (leadAcc) {
        // Lead also allocated to the record — keep their lead chip, don't
        // duplicate them into the team band.
        if (!leadAcc.records.has(rk)) {
          leadAcc.records.set(rk, { ticketId: rec.ticketId, title: rec.title, module: rec.module, role });
        }
        if (!leadAcc.title && m.title) leadAcc.title = m.title;
        continue;
      }
      const a = ensureAcc(teamAccs, key, m.id, m.name, m.title);
      a.roleCounts.set(role, (a.roleCounts.get(role) ?? 0) + 1);
      if (!a.records.has(rk)) {
        a.records.set(rk, { ticketId: rec.ticketId, title: rec.title, module: rec.module, role });
      }
    }
  }

  // Selected node.
  const selected = toNode(selectedKey, selAcc, selectedKey);

  // Lead bands (excluding the selected person — they render as the focal node).
  const tierMap = new Map<number, HierarchyPersonNode[]>();
  for (const [key, a] of leadAccs) {
    if (key === selectedKey) continue;
    const node = toNode(key, a, selectedKey);
    const arr = tierMap.get(node.tier) ?? [];
    arr.push(node);
    tierMap.set(node.tier, arr);
  }
  const tiers = Array.from(tierMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([tier, people]) => ({
      tier,
      label: TIER_LABELS[tier] ?? "Leads",
      people: people.sort((x, y) => y.records.length - x.records.length || x.name.localeCompare(y.name)),
    }));

  // Team groups per record, preserving the server's record order.
  const teamGroups: HierarchyTeamGroup[] = [];
  for (const rec of ctx.records) {
    const rk = recKey(rec);
    const members: HierarchyPersonNode[] = [];
    for (const m of rec.team) {
      const key = nodeKey(m.id, m.name);
      const a = teamAccs.get(key);
      if (!a) continue; // was folded into a lead node
      if (!a.records.has(rk)) continue;
      members.push(toNode(key, a, selectedKey));
    }
    members.sort((x, y) => x.name.localeCompare(y.name));
    if (members.length > 0 || rec.leads.length > 0) {
      teamGroups.push({ ticketId: rec.ticketId, title: rec.title, module: rec.module, members });
    }
  }

  const uniquePeople = new Set<string>([selectedKey]);
  for (const key of leadAccs.keys()) uniquePeople.add(key);
  for (const key of teamAccs.keys()) uniquePeople.add(key);

  return {
    selected,
    tiers,
    teamGroups,
    totalPeople: uniquePeople.size,
    totalRecords: ctx.records.length,
    totalTeamMembers: teamAccs.size,
  };
}
