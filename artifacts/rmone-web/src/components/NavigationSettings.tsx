/**
 * Settings → Navigation (#88 show/hide, #90 order + rename) — admins choose,
 * per menu item, whether it is visible, who sees it, what order it appears in,
 * and an optional custom display name. Canonical ids never change; custom
 * names appear only in the sidebar — page titles and internals stay canonical.
 *
 * tenantId semantics (same contract as AccessLevelsSettings/UserGroupsModal):
 *   undefined → company admin managing their own company
 *   string    → superadmin managing that client
 *   null      → superadmin who hasn't picked a client yet (read-only note)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save, Lock, RefreshCw, GripVertical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { NAV_DEFS, type NavSurface } from "@/lib/navCatalog";
import {
  fetchNavVisibility, saveNavVisibility, fetchUserGroups,
  type NavItemRule, type NavVisibilityData, type UserGroup,
} from "@/lib/permissions";
import { getSeed, setSeed, seedScope } from "@/lib/settingsSeed";
import { fetchOrgAudienceGroups, isOrgAudienceId, isRoleAudienceId } from "@/lib/orgAudience";
import { GroupMembersHover, useGroupMemberNames } from "@/components/GroupMembersHover";

type NavMode = "everyone" | "hidden" | "groups" | "roles";
interface RowState { mode: NavMode; groupIds: string[]; roleIds: string[]; implicit?: boolean }

const CONFIGURABLE_NAV_DEFS = NAV_DEFS.filter((d) => !d.navigationHidden);
const DEFAULT_ORDER = CONFIGURABLE_NAV_DEFS.map((d) => d.id);
const DEFAULT_SURFACES: Record<string, NavSurface> = Object.fromEntries(
  CONFIGURABLE_NAV_DEFS.map((d) => [d.id, d.defaultSurface ?? "vertical"]),
);

const MODE_LABELS: Array<{ value: NavMode; label: string }> = [
  { value: "everyone", label: "Everyone" },
  { value: "hidden",   label: "Hidden" },
  { value: "groups",   label: "Only these groups / roles" },
];

function defaultRows(): Record<string, RowState> {
  const out: Record<string, RowState> = {};
  for (const d of CONFIGURABLE_NAV_DEFS) out[d.id] = { mode: "everyone", groupIds: [], roleIds: [] };
  return out;
}

function rowsFrom(data: NavVisibilityData): Record<string, RowState> {
  const out = defaultRows();
  for (const [id, rule] of Object.entries(data.items)) {
    if (!out[id]) continue;
    // Access-level rules are a legacy format. Navigation visibility now uses
    // User Groups consistently; display old role rules as Everyone until the
    // admin saves the page with the new group-based policy.
    const mode: NavMode = rule.mode === "roles" ? "everyone" : rule.mode;
    out[id] = {
      mode,
      groupIds: mode === "groups" ? rule.groupIds : [],
      roleIds: [],
      implicit: false,
    };
  }
  return out;
}

function orderFrom(data: NavVisibilityData): string[] {
  if (!data.order || data.order.length === 0) return DEFAULT_ORDER;
  // Keep only known ids; append any missing ones at their catalog position.
  const known = new Set(DEFAULT_ORDER);
  const kept = data.order.filter((id) => known.has(id));
  const inKept = new Set(kept);
  const missing = DEFAULT_ORDER.filter((id) => !inKept.has(id));
  return [...kept, ...missing];
}

function surfacesFrom(data: Pick<NavVisibilityData, "surfaces">): Record<string, NavSurface> {
  const out = { ...DEFAULT_SURFACES };
  for (const [id, surface] of Object.entries(data.surfaces ?? {})) {
    if (id in out && (surface === "vertical" || surface === "horizontal")) out[id] = surface;
  }
  return out;
}

export default function NavigationSettings({ tenantId }: { tenantId?: string | null }) {
  const { toast } = useToast();
  // Instant render: boot from the session seeds (settings hub pre-warms the
  // raw nav doc + the shared user-groups list) and revalidate in the background.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time seed only
  const boot = useMemo(() => {
    if (tenantId === null) return null;
    const nav = getSeed<NavVisibilityData>(`navVisibility:${seedScope(tenantId)}`);
    if (!nav) return null;
    return {
      rows: rowsFrom(nav),
      orderedIds: orderFrom(nav),
      labels: nav.labels ?? {},
      surfaces: surfacesFrom(nav),
      groups: getSeed<UserGroup[]>(`userGroups:${seedScope(tenantId)}`) ?? [],
    };
  }, []);
  const [rows, setRowsRaw] = useState<Record<string, RowState>>(boot ? boot.rows : defaultRows);
  const [orderedIds, setOrderedIdsRaw] = useState<string[]>(boot?.orderedIds ?? DEFAULT_ORDER);
  const [customLabels, setCustomLabelsRaw] = useState<Record<string, string>>(boot?.labels ?? {});
  const [surfaces, setSurfacesRaw] = useState<Record<string, NavSurface>>(boot?.surfaces ?? DEFAULT_SURFACES);
  const [snapshot, setSnapshot] = useState<string>(() =>
    JSON.stringify(
      boot
        ? { rows: boot.rows, orderedIds: boot.orderedIds, labels: boot.labels, surfaces: boot.surfaces }
        : { rows: defaultRows(), orderedIds: DEFAULT_ORDER, labels: {}, surfaces: DEFAULT_SURFACES },
    ),
  );
  const [groups, setGroups] = useState<UserGroup[]>(boot?.groups ?? []);
  // Org units (BU / Division / Department) as live audiences — shown alongside
  // real groups as visibility targets. DISPLAY catalog only; the saved rule
  // just stores their sentinel ids ("org:bu:<id>" …).
  const [orgAuds, setOrgAuds] = useState<UserGroup[]>([]);
  const pickGroups = useMemo(() => [...groups, ...orgAuds], [groups, orgAuds]);
  const [loading, setLoading] = useState(!boot);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Background refetches must never clobber a draft the user already started.
  const dirtyRef = useRef(false);
  // Stale-response guard: a load resolving after a newer load, a tenant
  // switch, or a save must not apply. Bumping the seq invalidates everything
  // in flight.
  const loadSeqRef = useRef(0);
  // User edits mark the draft dirty SYNCHRONOUSLY — the memo-driven effect
  // below lags one render, which is enough for a resolving background fetch
  // to clobber a just-started edit. Load/save paths use the raw setters.
  const setRows = useCallback(
    (v: Record<string, RowState> | ((prev: Record<string, RowState>) => Record<string, RowState>)) => {
      dirtyRef.current = true;
      setRowsRaw(v);
    }, []);
  const setOrderedIds = useCallback((v: string[] | ((prev: string[]) => string[])) => {
    dirtyRef.current = true;
    setOrderedIdsRaw(v);
  }, []);
  const setCustomLabels = useCallback(
    (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
      dirtyRef.current = true;
      setCustomLabelsRaw(v);
    }, []);
  const setSurfaces = useCallback(
    (v: Record<string, NavSurface> | ((prev: Record<string, NavSurface>) => Record<string, NavSurface>)) => {
      dirtyRef.current = true;
      setSurfacesRaw(v);
    }, []);

  const load = useCallback(async (background: boolean) => {
    if (tenantId === null) { setLoading(false); return; }
    const seq = ++loadSeqRef.current;
    if (!background) { setLoading(true); setLoadErr(null); }
    try {
      const [data, gs, orgList] = await Promise.all([
        fetchNavVisibility(tenantId),
        // null = fetch FAILED — not "tenant has no groups".
        fetchUserGroups(tenantId).catch(() => null),
        // Org units for live BU/Division/Dept audiences ([] on failure).
        fetchOrgAudienceGroups(tenantId ?? undefined).catch(() => [] as UserGroup[]),
      ]);
      if (seq !== loadSeqRef.current) return; // superseded (tenant switch / save)
      setSeed(`navVisibility:${seedScope(tenantId)}`, data);
      const nextRows = rowsFrom(data);
      const nextOrder = orderFrom(data);
      const nextLabels = data.labels ?? {};
      const nextSurfaces = surfacesFrom(data);
      if (!background || !dirtyRef.current) {
        setRowsRaw(nextRows);
        setOrderedIdsRaw(nextOrder);
        setCustomLabelsRaw(nextLabels);
        setSurfacesRaw(nextSurfaces);
        setSnapshot(JSON.stringify({ rows: nextRows, orderedIds: nextOrder, labels: nextLabels, surfaces: nextSurfaces }));
      }
      // Group catalog isn't part of the draft — refresh only on success so a
      // failure never blanks the last-known list.
      if (gs) setGroups(gs);
      if (orgList.length > 0) setOrgAuds(orgList);
    } catch (e) {
      if (seq !== loadSeqRef.current) return; // superseded
      // Background refresh failure: keep showing the seeded doc (stale-if-error).
      if (!background) setLoadErr(e instanceof Error ? e.message : "Could not load the navigation settings.");
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
    const nav = getSeed<NavVisibilityData>(`navVisibility:${seedScope(tenantId)}`);
    if (nav) {
       const nextRows = rowsFrom(nav);
      const nextOrder = orderFrom(nav);
      const nextLabels = nav.labels ?? {};
      const nextSurfaces = surfacesFrom(nav);
      setRowsRaw(nextRows);
      setOrderedIdsRaw(nextOrder);
      setCustomLabelsRaw(nextLabels);
      setSurfacesRaw(nextSurfaces);
      setSnapshot(JSON.stringify({ rows: nextRows, orderedIds: nextOrder, labels: nextLabels, surfaces: nextSurfaces }));
      setGroups(getSeed<UserGroup[]>(`userGroups:${seedScope(tenantId)}`) ?? []);
      setLoading(false);
      setLoadErr(null);
      // Fresh doc for this tenant — any draft belonged to the previous one.
      dirtyRef.current = false;
      void load(true);
    } else {
      void load(false);
    }
  }, [boot, load, tenantId]);

  const dirty = useMemo(
    () => JSON.stringify({ rows, orderedIds, labels: customLabels, surfaces }) !== snapshot,
    [rows, orderedIds, customLabels, surfaces, snapshot],
  );
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const groupName = useCallback(
    (gid: string) => pickGroups.find((g) => g.id === gid)?.name ?? gid,
    [pickGroups],
  );
  // Hovering a group pill shows its members (own tenant only — superadmin
  // managing another tenant falls back to member counts).
  const memberNamesOf = useGroupMemberNames(tenantId === undefined);

  const setMode = (id: string, mode: NavMode) =>
    // Keep the selected groups in the draft while switching modes. This lets
    // an admin try Everyone/Hidden and return to Only these groups without
    // having to rebuild a long group selection from scratch.
    setRows((prev) => ({ ...prev, [id]: {
      mode,
      groupIds: prev[id]?.groupIds ?? [],
      roleIds: prev[id]?.roleIds ?? [],
      implicit: false,
    } }));
  const toggleGroup = (id: string, gid: string) =>
    setRows((prev) => {
      const cur = prev[id] ?? { mode: "groups" as NavMode, groupIds: [], roleIds: [] };
      const has = cur.groupIds.includes(gid);
      return { ...prev, [id]: { ...cur, groupIds: has ? cur.groupIds.filter((g) => g !== gid) : [...cur.groupIds, gid] } };
    });
  const setLabel = (id: string, val: string) =>
    setCustomLabels((prev) => {
      if (!val.trim()) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: val };
    });
  const setSurface = (id: string, surface: NavSurface) =>
    setSurfaces((prev) => ({ ...prev, [id]: surface }));

  const save = async () => {
    // Known ids include org-unit and role sentinels — a saved live audience
    // must never be pruned as "no longer exists" just because the org/role
    // catalogs haven't loaded (they arrive async and can fail independently).
    // Sentinel-shaped ids are therefore ALWAYS kept; the server resolves them
    // live and a genuinely deleted unit/role simply stops matching anyone.
    const knownGroupIds = new Set(pickGroups.map((g) => g.id));
    const keepId = (g: string) => knownGroupIds.has(g) || isOrgAudienceId(g) || isRoleAudienceId(g);
    const items: Record<string, NavItemRule> = {};
    for (const def of CONFIGURABLE_NAV_DEFS) {
      if (def.neverHide || def.adminOnly) continue;
      const row = rows[def.id];
      if (!row) continue;
      if (row.implicit) continue;
      if (row.mode === "everyone") {
        continue;
      }
      if (row.mode === "groups") {
        const ids = row.groupIds.filter(keepId);
        if (ids.length === 0) {
          toast({
            title: `"${def.label}" needs at least one group`,
            description: "Pick the groups that should still see it, or switch it back to Everyone / Hidden.",
            variant: "destructive",
          });
          return;
        }
        items[def.id] = { mode: "groups", groupIds: ids, roleIds: [] };
      } else {
        items[def.id] = { mode: "hidden", groupIds: [], roleIds: [] };
      }
    }

    // Only persist order if it differs from the default.
    const orderChanged = orderedIds.join(",") !== DEFAULT_ORDER.join(",");
    const finalOrder = orderChanged ? orderedIds : [];

    // Only persist non-blank custom labels.
    const finalLabels: Record<string, string> = {};
    for (const [id, lbl] of Object.entries(customLabels)) {
      if (lbl.trim()) finalLabels[id] = lbl.trim();
    }
    const finalSurfaces: Record<string, NavSurface> = {};
    for (const def of CONFIGURABLE_NAV_DEFS) {
      const surface = surfaces[def.id] ?? def.defaultSurface ?? "vertical";
      const defaultSurface = def.defaultSurface ?? "vertical";
      if (surface !== defaultSurface) finalSurfaces[def.id] = surface;
    }

    const data: NavVisibilityData = { items, order: finalOrder, labels: finalLabels, surfaces: finalSurfaces };
    setSaving(true);
    try {
      // Invalidate in-flight loads so a stale response can't overwrite the save.
      loadSeqRef.current++;
      const saved = await saveNavVisibility(data, tenantId ?? undefined);
      // Keep the instant-render seed in step so the next visit boots on the saved doc.
      setSeed(`navVisibility:${seedScope(tenantId)}`, saved);
      const nextRows = rowsFrom(saved);
      const nextOrder = orderFrom(saved);
      const nextLabels = saved.labels ?? {};
      const nextSurfaces = surfacesFrom(saved);
      setRowsRaw(nextRows);
      setOrderedIdsRaw(nextOrder);
      setCustomLabelsRaw(nextLabels);
      setSurfacesRaw(nextSurfaces);
      setSnapshot(JSON.stringify({ rows: nextRows, orderedIds: nextOrder, labels: nextLabels, surfaces: nextSurfaces }));
      toast({ title: "Menu saved", description: "People will see the updated menu on their next page change." });
    } catch (e) {
      toast({
        title: "Couldn't save the menu",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  /* ── Drag-to-reorder ──────────────────────────────────────────────────── */
  const dragId = useRef<string | null>(null);
  const dragOverId = useRef<string | null>(null);

  const onDragStart = (id: string) => (e: React.DragEvent) => {
    dragId.current = id;
    e.dataTransfer.effectAllowed = "move";
    // A tiny delay so the ghost image renders before we mutate state.
    e.dataTransfer.setDragImage(e.currentTarget as HTMLElement, 16, 16);
  };
  const onDragOver = (id: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverId.current !== id) dragOverId.current = id;
  };
  const onDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragId.current;
    dragId.current = null;
    dragOverId.current = null;
    if (!from || from === targetId) return;
    setOrderedIds((prev) => {
      const arr = [...prev];
      const fi = arr.indexOf(from);
      const ti = arr.indexOf(targetId);
      if (fi === -1 || ti === -1) return prev;
      arr.splice(fi, 1);
      arr.splice(ti, 0, from);
      return arr;
    });
  };
  const onDragEnd = () => {
    dragId.current = null;
    dragOverId.current = null;
  };

  /* ── Superadmin without a client picked ──────────────────────────────── */
  if (tenantId === null) {
    return (
      <div>
        <Header />
        <div style={{
          border: "1px dashed hsl(var(--border))", borderRadius: 12, padding: "26px 24px",
          color: "hsl(var(--muted-foreground))", fontSize: 13.5, lineHeight: 1.6,
        }}>
          Menus are set up per company. Switch the scope above to a specific client company to
          manage which menu items its people see.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        flex: "1 1 auto", minHeight: 0, overflowY: "auto", paddingRight: 4,
        display: "flex", flexDirection: "column",
      }}>
        <Header tenantLabel={typeof tenantId === "string" ? tenantId : undefined} />

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "hsl(var(--muted-foreground))", fontSize: 13, padding: "18px 2px" }}>
          <Loader2 style={{ width: 15, height: 15, animation: "spin 1s linear infinite" }} />
          Loading menu settings…
        </div>
      ) : loadErr ? (
        <div style={{
          border: "1px solid hsl(var(--destructive) / 0.35)", background: "hsl(var(--destructive) / 0.06)",
          borderRadius: 10, padding: "14px 16px", fontSize: 13, color: "hsl(var(--foreground))",
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <span>{loadErr}</span>
          <button
            type="button"
            onClick={() => void load(false)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid hsl(var(--border))",
              background: "hsl(var(--card))", borderRadius: 8, padding: "5px 10px", fontSize: 12.5, cursor: "pointer",
              color: "hsl(var(--foreground))",
            }}
          >
            <RefreshCw style={{ width: 13, height: 13 }} /> Try again
          </button>
        </div>
      ) : (
        <>
          <div style={{
            width: "100%", boxSizing: "border-box",
            border: "1px solid hsl(var(--border))", borderRadius: 12,
            overflow: "hidden", background: "hsl(var(--card))",
            flex: "1 0 auto",
          }}>
             {orderedIds.map((id, i) => {
               const def = CONFIGURABLE_NAV_DEFS.find((d) => d.id === id);
              if (!def) return null;
               const row = rows[def.id] ?? { mode: "everyone" as NavMode, groupIds: [], roleIds: [] };
              const locked = Boolean(def.neverHide || def.adminOnly);
              const customLabel = customLabels[def.id] ?? "";

              return (
                <div
                  key={def.id}
                  draggable
                  onDragStart={onDragStart(def.id)}
                  onDragOver={onDragOver(def.id)}
                  onDrop={onDrop(def.id)}
                  onDragEnd={onDragEnd}
                  style={{
                    padding: "13px 16px",
                    borderTop: i === 0 ? "none" : "1px solid hsl(var(--border))",
                    display: "flex", flexDirection: "column", gap: 10,
                    opacity: locked ? 0.75 : 1,
                    cursor: "default",
                    userSelect: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    {/* Drag handle */}
                    <span
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        cursor: "grab", color: "hsl(var(--muted-foreground))", opacity: 0.5,
                        flexShrink: 0,
                      }}
                      title="Drag to reorder"
                    >
                      <GripVertical style={{ width: 14, height: 14 }} />
                    </span>

                    {/* Label + optional custom name input */}
                    <div style={{ minWidth: 180, flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "hsl(var(--foreground))" }}>
                        {def.label}
                        {def.sub && (
                          <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginLeft: 6, fontWeight: 400 }}>
                            ({def.sub})
                          </span>
                        )}
                      </span>
                      {!locked && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="text"
                            value={customLabel}
                            onChange={(e) => setLabel(def.id, e.target.value)}
                            placeholder={`Custom name (default: "${def.label}")`}
                            maxLength={60}
                            style={{
                              width: "100%", maxWidth: 260,
                              border: "1px solid hsl(var(--border))", borderRadius: 6,
                              padding: "4px 8px", fontSize: 12, background: "hsl(var(--background))",
                              color: "hsl(var(--foreground))", outline: "none",
                            }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = "hsl(var(--primary))")}
                            onBlur={(e) => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
                          />
                          {customLabel && (
                            <span style={{ fontSize: 11.5, color: "hsl(var(--primary))", whiteSpace: "nowrap" }}>
                              Shows as "{customLabel}"
                            </span>
                          )}
                        </div>
                      )}
                      {def.editorOnly && !locked && (
                        <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>
                          Read-only accounts never see this item.
                        </div>
                      )}
                      {def.groupUnder && (
                        <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>
                          Shown in the sidebar as a sub-item of "
                           {CONFIGURABLE_NAV_DEFS.find((d) => d.id === def.groupUnder)?.label ?? def.groupUnder}
                          " — it always sits directly beneath it.
                        </div>
                      )}
                    </div>

                    {locked ? (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
                        color: "hsl(var(--muted-foreground))",
                        border: "1px solid hsl(var(--border))", borderRadius: 999, padding: "4px 10px",
                        flexShrink: 0,
                      }}>
                        <Lock style={{ width: 11.5, height: 11.5 }} />
                        {def.neverHide
                          ? "Always visible — hidden pages send people here"
                          : "Admin screen — only admins see it, and it can't be hidden from them"}
                      </span>
                    ) : (
                      /* Right-side column: toggle on top, group chips directly below */
                       <div style={{
                         display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8,
                         flex: "1 1 560px", minWidth: 0, maxWidth: "100%",
                       }}>
                         <div style={{
                             display: "flex", alignItems: "center", justifyContent: "space-between",
                           gap: 12, flexWrap: "wrap",
                         }}>
                           <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                             <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>Place in</span>
                             <div
                               role="group"
                               aria-label={`Navigation placement for ${def.label}`}
                               style={{ display: "inline-flex", border: "1px solid hsl(var(--border))", borderRadius: 9, overflow: "hidden" }}
                             >
                               {([
                                 { value: "vertical" as NavSurface, label: "Vertical" },
                                 { value: "horizontal" as NavSurface, label: "Horizontal" },
                               ]).map((placement) => {
                                 const active = (surfaces[def.id] ?? def.defaultSurface ?? "vertical") === placement.value;
                                 return (
                                   <button
                                     key={placement.value}
                                     type="button"
                                     onClick={() => setSurface(def.id, placement.value)}
                                     aria-pressed={active}
                                     style={{
                                       border: "none", cursor: "pointer", padding: "6px 10px", fontSize: 12,
                                       fontWeight: active ? 650 : 400,
                                       background: active ? "hsl(var(--primary) / 0.12)" : "transparent",
                                       color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                                     }}
                                   >
                                     {placement.label}
                                   </button>
                                 );
                               })}
                             </div>
                           </div>

                           <div style={{ display: "inline-flex", border: "1px solid hsl(var(--border))", borderRadius: 9, overflow: "hidden" }}>
                           {MODE_LABELS.map((m) => {
                            const active = row.mode === m.value;
                            return (
                              <button
                                key={m.value}
                                type="button"
                                onClick={() => setMode(def.id, m.value)}
                                style={{
                                  border: "none", cursor: "pointer", padding: "6px 12px", fontSize: 12.5,
                                  fontWeight: active ? 600 : 400,
                                  background: active
                                    ? m.value === "hidden" ? "hsl(var(--destructive) / 0.12)" : "hsl(var(--primary) / 0.12)"
                                    : "transparent",
                                  color: active
                                    ? m.value === "hidden" ? "hsl(var(--destructive))" : "hsl(var(--primary))"
                                    : "hsl(var(--muted-foreground))",
                                }}
                              >
                                {m.label}
                              </button>
                            );
                          })}
                           </div>
                        </div>
                        {row.mode === "groups" && (
                          pickGroups.length === 0 ? (
                            <div style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", textAlign: "right" }}>
                              No user groups exist yet — create them under Manage Organization → User Groups first.
                            </div>
                          ) : (
                             <div
                               role="list"
                               aria-label={`Groups for ${def.label}`}
                               tabIndex={0}
                               title="All available user groups"
                               style={{
                                 display: "flex", flexWrap: "wrap", gap: 6,
                                 justifyContent: "flex-start", minWidth: 0, maxWidth: "100%",
                                 overflowX: "visible", overflowY: "visible",
                                 padding: "2px 2px 7px",
                               }}
                             >
                              {pickGroups.map((g) => {
                                const on = row.groupIds.includes(g.id);
                                return (
                                    <GroupMembersHover
                                     key={g.id}
                                     groupName={g.name}
                                     memberIds={g.memberIds}
                                     names={memberNamesOf(g.memberIds)}
                                     wrapStyle={{ flex: "0 0 auto" }}
                                    >
                                    <button
                                      type="button"
                                      onClick={() => toggleGroup(def.id, g.id)}
                                      style={{
                                        border: `1px solid ${on ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                                        background: on ? "hsl(var(--primary) / 0.10)" : "hsl(var(--card))",
                                        color: on ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                                        borderRadius: 999, padding: "4px 11px", fontSize: 12.5, cursor: "pointer",
                                         fontWeight: on ? 600 : 400, flex: "0 0 auto", whiteSpace: "nowrap",
                                      }}
                                    >
                                      {groupName(g.id)}
                                    </button>
                                  </GroupMembersHover>
                                );
                              })}
                            </div>
                          )
                         )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 14, lineHeight: 1.6, maxWidth: 640 }}>
            Tip: drag the grip handle <GripIcon /> to reorder items. Type a custom name in the text field
            to rename an item in the sidebar only — page titles stay the same. Visibility rules
            (Everyone / Hidden / Only these groups / roles) apply to admins too, except the locked admin
            screens. Group pickers offer user groups, org units (BU / Division / Department) and job roles —
            role and org audiences follow the staff directory live, so there is no member list to maintain.
          </p>
        </>
      )}
      </div>

      {!loading && !loadErr && (
        <div style={{
          flexShrink: 0, zIndex: 6, display: "flex", alignItems: "center", gap: 12,
          flexWrap: "wrap", padding: "12px 0 10px", marginTop: 8,
          borderTop: "1px solid hsl(var(--border))",
          background: "hsl(var(--background))",
          boxShadow: "0 -8px 16px hsl(var(--background) / 0.92)",
        }}>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void save()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              background: dirty && !saving ? "hsl(var(--primary))" : "hsl(var(--muted))",
              color: dirty && !saving ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
              border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600,
              cursor: dirty && !saving ? "pointer" : "default",
            }}
          >
            {saving
              ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
              : <Save style={{ width: 14, height: 14 }} />}
            {saving ? "Saving…" : "Save menu"}
          </button>
          {dirty && !saving && (
            <span style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>Unsaved changes</span>
          )}
        </div>
      )}
    </div>
  );
}

function GripIcon() {
  return (
    <span style={{ display: "inline-flex", verticalAlign: "middle", opacity: 0.55 }}>
      <GripVertical style={{ width: 11, height: 11 }} />
    </span>
  );
}

function Header({ tenantLabel }: { tenantLabel?: string }) {
  return (
    <div style={{ width: "100%", marginBottom: 12 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: "hsl(var(--foreground))", margin: 0 }}>Navigation</h2>
      <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: "5px 0 0", lineHeight: 1.45, width: "100%" }}>
        Choose which menu items {tenantLabel ? <>people at <b>{tenantLabel}</b></> : "your team"} see,
        place them in the vertical sidebar or horizontal top bar, drag to reorder, and give them custom names.
        Home stays visible, and admins always keep Import, Settings, and System.
      </p>
    </div>
  );
}
