import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getBusinessUnits, getDivisions, getDepartments, getJobTitles, getRoleBillingRates,
  type JobTitleRow,
} from "@/lib/api";
import { Building2, Layers, Briefcase, UserCog, GraduationCap, X, Loader2 } from "lucide-react";
import { Z } from "@/lib/zLayers";

/* Clicking a Role / Title / BU / Division / Department value in a data grid
 * opens a small org-chart popup showing WHERE that entity sits in the
 * organization (same visual language as the Organization page), instead of
 * filtering the grid — filtering stays on the pills above the grid.
 *
 * Every kind shows its FULL linked chain (BU → Division → Department →
 * Job Title → Role, as far as the data links go), rendered as a centred
 * mini org-chart tree exactly like Configuration → Organization. */

export type OrgKind = "bu" | "division" | "department" | "role" | "title";

const PANEL  = "var(--rm-panel, #ffffff)";
const BORDER = "var(--rm-panel-border, #e2e8f0)";
const TEXT   = "var(--rm-text, #1e293b)";
const MUTED  = "var(--rm-text-muted, #64748b)";
const FAINT  = "var(--rm-text-faint, #94a3b8)";
const SOFT   = "var(--rm-panel-soft, #f8fafc)";

const KIND_META: Record<OrgKind, { label: string; color: string; icon: React.ElementType }> = {
  bu:         { label: "Business Unit", color: "#6366f1", icon: Building2 },
  division:   { label: "Division",      color: "#10b981", icon: Layers },
  department: { label: "Department",    color: "#f59e0b", icon: Briefcase },
  role:       { label: "Role",          color: "#8b5cf6", icon: UserCog },
  title:      { label: "Job Title",     color: "#ec4899", icon: GraduationCap },
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

type BuRow   = { ID: number | string; Title: string };
type DivRow  = { ID: number | string; Title: string; BusinessUnitIdLookup?: string | null };
type DeptRow = { ID: number | string; Title: string; DivisionIdLookup?: string | null };

type ChainNode = { kind: OrgKind; name: string; highlight?: boolean; missing?: boolean };
type MatchChain = {
  key: string;
  nodes: ChainNode[];
  childrenLabel?: string;
  childKind?: OrgKind;
  children?: string[];
};

/* ── Org-chart tree pieces (same visual language as Configuration → Organization) ── */

function TreeNode({ n, small }: { n: ChainNode; small?: boolean }) {
  const meta = KIND_META[n.kind];
  const Icon = meta.icon;
  const color = meta.color;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
      <div style={{
        padding: small ? "5px 11px" : "8px 16px",
        borderRadius: 10,
        border: `2px solid ${n.missing ? color + "25" : n.highlight ? color : color + "60"}`,
        background: n.missing ? SOFT : color + (n.highlight ? "1c" : "12"),
        boxShadow: n.highlight ? `0 0 0 3px ${color}22` : "0 1px 4px rgba(0,0,0,0.05)",
        display: "flex", alignItems: "center", gap: 6,
        maxWidth: small ? 150 : 240, minWidth: 0,
      }}>
        <Icon size={small ? 12 : 15} style={{ color: n.missing ? color + "90" : color, flexShrink: 0 }} />
        <span style={{
          fontSize: small ? 11 : 13, fontWeight: n.highlight ? 800 : 700,
          color: n.missing ? FAINT : TEXT, fontStyle: n.missing ? "italic" : "normal",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{n.name}</span>
      </div>
      <div style={{
        marginTop: 3, fontSize: 8, fontWeight: 700, color,
        background: color + "15", border: `1px solid ${color}30`,
        borderRadius: 10, padding: "1px 7px", letterSpacing: "0.08em",
        textTransform: "uppercase", whiteSpace: "nowrap",
      }}>{KIND_META[n.kind].label}</div>
    </div>
  );
}

function VLine({ color }: { color: string }) {
  return <div style={{ width: 2, height: 14, background: color + "60" }} />;
}

/** Branching connector + row of small child boxes, like the org page. */
function ChildBranch({ chain }: { chain: MatchChain }) {
  const kids = chain.children ?? [];
  const kind = chain.childKind ?? "department";
  const color = KIND_META[kind].color;
  const BOX_CAP = 8;
  if (kids.length === 0 && !chain.childrenLabel) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      {kids.length > 0 && (
        <>
          <VLine color={color} />
          {kids.length > 1 && (
            <div style={{ width: "min(80%, 340px)", height: 2, background: color + "40" }} />
          )}
          <div style={{
            display: "flex", gap: 14, alignItems: "flex-start", justifyContent: "center",
            flexWrap: "wrap", paddingTop: kids.length > 1 ? 8 : 0,
          }}>
            {kids.slice(0, BOX_CAP).map((c, i) => (
              <TreeNode key={i} n={{ kind, name: c }} small />
            ))}
            {kids.length > BOX_CAP && (
              <span style={{ fontSize: 11, fontWeight: 700, color: FAINT, alignSelf: "center", padding: "6px 2px" }}>
                +{(kids.length - BOX_CAP).toLocaleString()} more
              </span>
            )}
          </div>
        </>
      )}
      {chain.childrenLabel && (
        <p style={{
          fontSize: 9, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase",
          color: FAINT, margin: "8px 0 0",
        }}>{chain.childrenLabel}</p>
      )}
    </div>
  );
}

function ChainCard({ chain }: { chain: MatchChain }) {
  return (
    <div style={{
      border: `1px solid ${BORDER}`, borderRadius: 12, padding: "16px 12px",
      backgroundColor: PANEL,
      display: "flex", flexDirection: "column", alignItems: "center",
    }}>
      {chain.nodes.map((n, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: "100%" }}>
          {i > 0 && <VLine color={KIND_META[n.kind].color} />}
          <TreeNode n={n} />
        </div>
      ))}
      <ChildBranch chain={chain} />
    </div>
  );
}

function OrgPopupContent({ kind, value, onClose }: { kind: OrgKind; value: string; onClose: () => void }) {
  const buQ    = useQuery({ queryKey: ["businessUnits"],         queryFn: () => getBusinessUnits(),    staleTime: 30_000 });
  const divQ   = useQuery({ queryKey: ["divisions"],             queryFn: () => getDivisions(),        staleTime: 30_000 });
  const deptQ  = useQuery({ queryKey: ["departments"],           queryFn: () => getDepartments(),      staleTime: 30_000 });
  const jtQ    = useQuery({ queryKey: ["job-titles"],            queryFn: () => getJobTitles(),        staleTime: 30_000 });
  const ratesQ = useQuery({ queryKey: ["role-billing-rates-v2"], queryFn: () => getRoleBillingRates(), staleTime: 30_000 });
  const buData = buQ.data, divData = divQ.data, deptData = deptQ.data, jtData = jtQ.data, ratesData = ratesQ.data;
  const queries = [buQ, divQ, deptQ, jtQ, ratesQ];
  const failed = queries.some(q => q.isError);
  const retryFailed = () => queries.forEach(q => { if (q.isError) void q.refetch(); });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loading = !buData || !divData || !deptData || !jtData || !ratesData;

  const chains: MatchChain[] = useMemo(() => {
    if (loading) return [];
    const bus   = (buData ?? []) as BuRow[];
    const divs  = (divData ?? []) as DivRow[];
    const depts = (deptData ?? []) as DeptRow[];
    const titles = (jtData ?? []) as JobTitleRow[];
    const roles = ratesData?.rates ?? [];

    const buById  = new Map(bus.map(b => [String(b.ID), b]));
    const divById = new Map(divs.map(d => [String(d.ID), d]));
    const divsByBu = new Map<string, DivRow[]>();
    for (const d of divs) {
      const k = String(d.BusinessUnitIdLookup ?? "");
      if (!k) continue;
      if (!divsByBu.has(k)) divsByBu.set(k, []);
      divsByBu.get(k)!.push(d);
    }
    const deptsByDiv = new Map<string, DeptRow[]>();
    for (const dp of depts) {
      const k = String(dp.DivisionIdLookup ?? "");
      if (!k) continue;
      if (!deptsByDiv.has(k)) deptsByDiv.set(k, []);
      deptsByDiv.get(k)!.push(dp);
    }
    const titlesByDept = new Map<string, JobTitleRow[]>();
    for (const t of titles) {
      const k = String(t.DepartmentId ?? "");
      if (!k) continue;
      if (!titlesByDept.has(k)) titlesByDept.set(k, []);
      titlesByDept.get(k)!.push(t);
    }
    const titleName = (t: JobTitleRow) => String(t.JobTitleName || t.Title || "").trim();
    const v = norm(value);
    const out: MatchChain[] = [];

    // Walks dept → division → BU upward, returning nodes top-down.
    const parentChainOfDept = (dp: DeptRow): ChainNode[] => {
      const dv = dp.DivisionIdLookup ? divById.get(String(dp.DivisionIdLookup)) : undefined;
      const bu = dv?.BusinessUnitIdLookup ? buById.get(String(dv.BusinessUnitIdLookup)) : undefined;
      const nodes: ChainNode[] = [];
      nodes.push(bu ? { kind: "bu", name: bu.Title } : { kind: "bu", name: "No business unit linked", missing: true });
      nodes.push(dv ? { kind: "division", name: dv.Title } : { kind: "division", name: "No division linked", missing: true });
      return nodes;
    };

    if (kind === "bu") {
      for (const bu of bus.filter(b => norm(b.Title) === v)) {
        const children = (divsByBu.get(String(bu.ID)) ?? []).map(d => d.Title);
        out.push({
          key: `bu-${bu.ID}`,
          nodes: [{ kind: "bu", name: bu.Title, highlight: true }],
          childrenLabel: children.length ? `Divisions in this business unit (${children.length})` : undefined,
          childKind: "division",
          children,
        });
      }
    } else if (kind === "division") {
      for (const dv of divs.filter(d => norm(d.Title) === v)) {
        const bu = dv.BusinessUnitIdLookup ? buById.get(String(dv.BusinessUnitIdLookup)) : undefined;
        const children = (deptsByDiv.get(String(dv.ID)) ?? []).map(d => d.Title);
        out.push({
          key: `div-${dv.ID}`,
          nodes: [
            bu ? { kind: "bu", name: bu.Title } : { kind: "bu", name: "No business unit linked", missing: true },
            { kind: "division", name: dv.Title, highlight: true },
          ],
          childrenLabel: children.length ? `Departments in this division (${children.length})` : undefined,
          childKind: "department",
          children,
        });
      }
    } else if (kind === "department") {
      for (const dp of depts.filter(d => norm(d.Title) === v)) {
        const children = (titlesByDept.get(String(dp.ID)) ?? []).map(titleName).filter(Boolean);
        out.push({
          key: `dept-${dp.ID}`,
          nodes: [...parentChainOfDept(dp), { kind: "department", name: dp.Title, highlight: true }],
          childrenLabel: children.length ? `Job titles in this department (${children.length})` : undefined,
          childKind: "title",
          children: [...new Set(children)],
        });
      }
    } else if (kind === "title") {
      // Full chain: BU → Division → Department → Job Title (highlighted) → Role.
      const seen = new Set<string>();
      for (const t of titles.filter(t => norm(titleName(t)) === v || norm(t.Title) === v)) {
        const dp = t.DepartmentId != null ? depts.find(d => String(d.ID) === String(t.DepartmentId)) : undefined;
        const dedupe = `${t.DepartmentId ?? ""}|${norm(t.RoleName)}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const nodes: ChainNode[] = dp
          ? [...parentChainOfDept(dp), { kind: "department", name: dp.Title }]
          : [{ kind: "department", name: "No department linked", missing: true }];
        nodes.push({ kind: "title", name: titleName(t) || value, highlight: true });
        const role = String(t.RoleName ?? "").trim();
        if (role) nodes.push({ kind: "role", name: role });
        out.push({ key: `jt-${t.ID}`, nodes });
      }
    } else if (kind === "role") {
      // Full chain per linked job title: BU → Division → Department → Job Title
      // → Role (highlighted). A role can be reached through several titles /
      // departments — each distinct path gets its own card (capped below).
      const matched = roles.filter(r => norm(r.name) === v);
      const roleName = matched[0]?.name ?? value;
      const linked = titles.filter(t => norm(t.RoleName) === v);
      const seen = new Set<string>();
      for (const t of linked) {
        const dp = t.DepartmentId != null ? depts.find(d => String(d.ID) === String(t.DepartmentId)) : undefined;
        const dedupe = `${t.DepartmentId ?? ""}|${norm(titleName(t))}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const nodes: ChainNode[] = dp
          ? [...parentChainOfDept(dp), { kind: "department", name: dp.Title }]
          : [{ kind: "department", name: "No department linked", missing: true }];
        nodes.push({ kind: "title", name: titleName(t) || "Untitled job title" });
        nodes.push({ kind: "role", name: roleName, highlight: true });
        out.push({ key: `role-${t.ID}`, nodes });
      }
      // Role exists but no job title links to it yet — show it alone with a hint.
      if (out.length === 0 && matched.length > 0) {
        out.push({
          key: `role-${matched[0].id}`,
          nodes: [{ kind: "role", name: roleName, highlight: true }],
          childrenLabel: "No job titles are mapped to this role yet",
          children: [],
        });
      }
    }
    return out;
  }, [loading, buData, divData, deptData, jtData, ratesData, kind, value]);

  const meta = KIND_META[kind];
  const MATCH_CAP = 5;

  return createPortal(
    <div
      onClick={e => { e.stopPropagation(); onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: Z.GRID_POPUP_BACKDROP,
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(15,23,42,0.45)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 520, maxWidth: "calc(100vw - 32px)", maxHeight: "80vh",
          display: "flex", flexDirection: "column",
          borderRadius: 16, backgroundColor: PANEL, border: `1px solid ${BORDER}`,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
          borderBottom: `1px solid ${BORDER}`,
        }}>
          <span style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            backgroundColor: `${meta.color}1f`, color: meta.color,
          }}><meta.icon size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</p>
            <p style={{ margin: 0, fontSize: 11, color: MUTED }}>{meta.label} — where it sits in your organization</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 8, border: `1px solid ${BORDER}`,
            backgroundColor: "transparent", color: MUTED, cursor: "pointer", flexShrink: 0,
          }}><X size={14} /></button>
        </div>

        <div style={{ padding: 14, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {failed ? (
            <div style={{ textAlign: "center", padding: "22px 12px" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: TEXT }}>Couldn’t load the organization structure</p>
              <p style={{ margin: "6px 0 12px", fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                Something went wrong while fetching the hierarchy. Please try again.
              </p>
              <button onClick={retryFailed} style={{
                fontSize: 12, fontWeight: 700, color: "#fff", backgroundColor: "#6BA539",
                border: "none", borderRadius: 8, padding: "7px 16px", cursor: "pointer",
              }}>Try again</button>
            </div>
          ) : loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", padding: "26px 0", color: MUTED, fontSize: 12, fontWeight: 600 }}>
              <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Loading organization…
            </div>
          ) : chains.length === 0 ? (
            <div style={{ textAlign: "center", padding: "22px 12px" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: TEXT }}>Not in the organization structure yet</p>
              <p style={{ margin: "6px 0 0", fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                “{value}” isn’t set up as a {meta.label.toLowerCase()} under Configuration → Organization, so there’s no hierarchy to show for it.
              </p>
            </div>
          ) : (
            <>
              {chains.length > 1 && (
                <p style={{ margin: 0, fontSize: 11, color: MUTED }}>
                  {kind === "role" || kind === "title"
                    ? `This ${meta.label.toLowerCase()} appears in ${chains.length} places in your organization:`
                    : `${chains.length} places in your organization share this name:`}
                </p>
              )}
              {chains.slice(0, MATCH_CAP).map(c => <ChainCard key={c.key} chain={c} />)}
              {chains.length > MATCH_CAP && (
                <p style={{ margin: 0, fontSize: 11, color: FAINT, textAlign: "center" }}>
                  and {chains.length - MATCH_CAP} more…
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Clickable org cell — replaces the old filter-on-click behaviour with an
 *  org-chart popup. Renders a dim dash when the value is empty. */
export function OrgCell({ value, kind }: { value?: string | null; kind: OrgKind }) {
  const [open, setOpen] = useState(false);
  const v = (value ?? "").trim();
  if (!v) return <span style={{ color: FAINT }}>—</span>;
  return (
    <>
      <button
        className="rm-dg-orglink"
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        title={`See where "${v}" sits in your organization`}
        style={{
          display: "inline-block", background: "none", border: "none",
          padding: 0, margin: 0, font: "inherit", color: "inherit",
          cursor: "pointer", maxWidth: "100%",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textAlign: "inherit", verticalAlign: "middle",
          borderBottom: "1px dashed rgba(128,128,128,0.35)",
          transition: "color 0.12s, border-color 0.12s",
        }}
      >
        {v}
      </button>
      {open && <OrgPopupContent kind={kind} value={v} onClose={() => setOpen(false)} />}
    </>
  );
}
