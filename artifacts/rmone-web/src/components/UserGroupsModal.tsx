/**
 * User Groups — admin CRUD + membership (#87), opened from Manage
 * Organization. Groups are used by per-stage permissions (Settings → Stage
 * Rules → "Who can act at each stage") so admins can assign a whole team at
 * once instead of person by person.
 *
 * Saves the whole doc at once (same contract as the settings pages); the
 * server rejects non-admins.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Plus, Trash2, Users, Save, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getUserList } from "@/lib/api";
import { fetchUserGroups, saveUserGroups, type UserGroup } from "@/lib/permissions";

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

type PersonOpt = { value: string; label: string };

/** Compact member multi-pick (checkbox dropdown) with name chips. */
function MemberPick({ options, selected, onChange }: {
  options: PersonOpt[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const labelOf = (v: string) => options.find(o => o.value.toLowerCase() === v.toLowerCase())?.label ?? `${v.slice(0, 8)}…`;
  const toggle = (v: string) => {
    const has = selected.some(s => s.toLowerCase() === v.toLowerCase());
    onChange(has ? selected.filter(s => s.toLowerCase() !== v.toLowerCase()) : [...selected, v]);
  };
  const shown = options.filter(o => o.label.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <div onClick={() => setOpen(o => !o)}
        style={{
          minHeight: 34, border: "1px solid hsl(var(--border))", borderRadius: 8,
          padding: "4px 8px", cursor: "pointer", display: "flex",
          flexWrap: "wrap", gap: 4, alignItems: "center", background: "hsl(var(--background))",
        }}>
        {selected.length === 0 && (
          <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 13 }}>Pick members…</span>
        )}
        {selected.map(v => (
          <span key={v} style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            background: "hsl(var(--muted))", borderRadius: 4, padding: "2px 6px",
            fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))",
          }}>
            {labelOf(v)}
            <button type="button" onClick={e => { e.stopPropagation(); toggle(v); }}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "0 1px", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center" }}>
              <X style={{ width: 10, height: 10 }} />
            </button>
          </span>
        ))}
        <ChevronDown style={{ marginLeft: "auto", width: 13, height: 13, color: "hsl(var(--muted-foreground))", flexShrink: 0, transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} />
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 60,
          background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
          borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
          maxHeight: 260, overflowY: "auto",
        }}>
          <div style={{ padding: 8, borderBottom: "1px solid hsl(var(--border))" }}>
            <input autoFocus type="text" value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="Search people…"
              style={{
                width: "100%", padding: "5px 8px", fontSize: 12.5, borderRadius: 6,
                border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
                color: "hsl(var(--foreground))", outline: "none",
              }} />
          </div>
          {shown.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>No matches</div>
          )}
          {shown.map(opt => (
            <label key={opt.value} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
              cursor: "pointer", fontSize: 13, color: "hsl(var(--popover-foreground))",
            }}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--muted))")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <input type="checkbox"
                checked={selected.some(s => s.toLowerCase() === opt.value.toLowerCase())}
                onChange={() => toggle(opt.value)}
                style={{ accentColor: "hsl(var(--primary))", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// tenantId semantics (mirrors AccessLevelsSettings / StageRulesSettings):
//   undefined → the signed-in admin's own company (normal case)
//   string    → superadmin managing THAT client's groups (people picker hidden —
//               the session people list belongs to the superadmin's tenant)
//   null      → superadmin with no company chosen yet (nothing to edit)
export default function UserGroupsModal({ open, onClose, tenantId }: { open: boolean; onClose: () => void; tenantId?: string | null }) {
  const { toast } = useToast();
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [snapshot, setSnapshot] = useState<string>("[]");
  const [people, setPeople] = useState<PersonOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Stable React keys for group rows — assigned once per slot, never changed
  // even when renameGroup regenerates g.id from the typed name. Without this,
  // rows remount on every keystroke and the name input loses focus.
  const stableKeysRef = useRef<string[]>([]);
  const uidCounterRef = useRef(0);
  const syncStableKeys = (gs: UserGroup[]) => {
    while (stableKeysRef.current.length < gs.length)
      stableKeysRef.current.push(`grp-${++uidCounterRef.current}`);
    stableKeysRef.current.length = gs.length;
  };

  useEffect(() => {
    if (!open) return;
    if (tenantId === null) {
      setGroups([]); setSnapshot("[]"); setPeople([]); setLoading(false); setLoadErr(null);
      return;
    }
    setLoading(true);
    setLoadErr(null);
    Promise.all([
      fetchUserGroups(tenantId),
      tenantId === undefined
        ? getUserList().catch(() => [] as Record<string, unknown>[])
        : Promise.resolve([] as Record<string, unknown>[]),
    ])
      .then(([gs, raw]) => {
        syncStableKeys(gs);
        setGroups(gs);
        setSnapshot(JSON.stringify(gs));
        const opts = (Array.isArray(raw) ? raw as Record<string, unknown>[] : [])
          .map(u => ({
            value: String(u.Id ?? u.id ?? ""),
            label: String(u.Name ?? u.name ?? u.UserName ?? u.username ?? ""),
          }))
          .filter(p => p.value && p.label)
          .sort((a, b) => a.label.localeCompare(b.label));
        setPeople(opts);
      })
      .catch(e => setLoadErr(e instanceof Error ? e.message : "Could not load user groups"))
      .finally(() => setLoading(false));
  }, [open, tenantId]);

  const savedIds = useMemo(() => {
    try { return new Set((JSON.parse(snapshot) as UserGroup[]).map(g => g.id)); }
    catch { return new Set<string>(); }
  }, [snapshot]);
  const dirty = useMemo(() => JSON.stringify(groups) !== snapshot, [groups, snapshot]);

  const renameGroup = (i: number, name: string) =>
    setGroups(gs => gs.map((g, j) => {
      if (j !== i) return g;
      if (savedIds.has(g.id)) return { ...g, name };
      const taken = new Set(gs.filter((_, k) => k !== i).map(x => x.id));
      return { ...g, name, id: groupIdFromName(name || "group", taken) };
    }));

  const doSave = async () => {
    if (tenantId === null) return; // no company chosen — nothing to save
    const bad = groups.find(g => !g.name.trim());
    if (bad) {
      toast({ title: "Every group needs a name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const saved = await saveUserGroups(groups, tenantId);
      setGroups(saved);
      setSnapshot(JSON.stringify(saved));
      toast({ title: "User groups saved", description: "Use them in Settings → Projects & Opportunities schedule to assign whole teams to stages." });
    } catch (e) {
      toast({
        title: "Could not save user groups",
        description: e instanceof Error ? e.message : "Something went wrong — please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: "min(680px, 94vw)", maxHeight: "86vh", display: "flex", flexDirection: "column",
        background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 14,
        boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "16px 18px 12px", borderBottom: "1px solid hsl(var(--border))" }}>
          <Users style={{ width: 17, height: 17, color: "#6366f1", marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: "hsl(var(--foreground))" }}>User Groups</div>
            <div style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", marginTop: 2, lineHeight: 1.45 }}>
              Group people so you can give a whole team stage permissions at once
              (Settings → Projects &amp; Opportunities schedule → “Who can act at each
              stage”). Groups don’t change anyone’s access level by themselves.
            </div>
          </div>
          <button type="button" onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 4, display: "flex" }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "14px 18px", overflowY: "auto", flex: 1, minHeight: 120 }}>
          {loading && (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Loader2 className="animate-spin" style={{ width: 22, height: 22, color: "hsl(var(--muted-foreground))" }} />
            </div>
          )}
          {!loading && loadErr && (
            <div style={{ fontSize: 13, color: "hsl(var(--destructive))" }}>{loadErr}</div>
          )}
          {!loading && !loadErr && tenantId === null && (
            <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>
              Choose a company first — user groups belong to a specific company.
            </div>
          )}
          {!loading && !loadErr && tenantId !== null && (
            <>
              {typeof tenantId === "string" && (
                <div style={{
                  fontSize: 12.5, color: "hsl(var(--muted-foreground))", marginBottom: 12, lineHeight: 1.5,
                  padding: "8px 10px", border: "1px solid hsl(var(--border))", borderRadius: 8, background: "hsl(var(--muted) / 0.3)",
                }}>
                  Managing groups for <b style={{ color: "hsl(var(--foreground))" }}>{tenantId}</b>.
                  You can add, rename, or delete groups here; picking members by name is only
                  available inside that company’s own workspace.
                </div>
              )}
              {groups.length === 0 && (
                <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginBottom: 12 }}>
                  No groups yet. Add one — for example “Proposals team” or “Project controls”.
                </div>
              )}
              {groups.map((g, i) => (
                <div key={stableKeysRef.current[i] ?? `grp-fallback-${i}`} style={{ padding: "10px 12px", border: "1px solid hsl(var(--border))", borderRadius: 10, marginBottom: 8, background: "hsl(var(--muted) / 0.25)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <input
                      value={g.name}
                      onChange={e => renameGroup(i, e.target.value)}
                      placeholder="Group name (e.g. Proposals team)"
                      style={{
                        flex: "0 1 260px", minWidth: 140, padding: "6px 9px", fontSize: 13, fontWeight: 600,
                        borderRadius: 7, border: "1px solid hsl(var(--border))",
                        background: "hsl(var(--background))", color: "hsl(var(--foreground))", outline: "none",
                      }} />
                    <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
                      {g.memberIds.length} member{g.memberIds.length === 1 ? "" : "s"}
                    </span>
                    <button type="button" title="Delete this group"
                      onClick={() => { stableKeysRef.current.splice(i, 1); setGroups(gs => gs.filter((_, j) => j !== i)); }}
                      style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex", padding: 4 }}>
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                  {tenantId === undefined && (
                    <MemberPick options={people} selected={g.memberIds}
                      onChange={memberIds => setGroups(gs => gs.map((x, j) => j === i ? { ...x, memberIds } : x))} />
                  )}
                </div>
              ))}
              <button type="button"
                onClick={() => {
                  const taken = new Set(groups.map(g => g.id));
                  stableKeysRef.current.push(`grp-${++uidCounterRef.current}`);
                  setGroups(gs => [...gs, { id: groupIdFromName("New group", taken), name: "New group", memberIds: [] }]);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8,
                  border: "1px dashed hsl(var(--border))", background: "transparent", cursor: "pointer",
                  fontSize: 12.5, fontWeight: 600, color: "hsl(var(--foreground))",
                }}>
                <Plus style={{ width: 13, height: 13 }} /> Add group
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px", borderTop: "1px solid hsl(var(--border))" }}>
          <button type="button" onClick={onClose}
            style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, border: "1px solid hsl(var(--border))", background: "transparent", color: "hsl(var(--foreground))", cursor: "pointer" }}>
            Close
          </button>
          <button type="button" onClick={() => void doSave()} disabled={saving || !dirty}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8,
              fontSize: 12.5, fontWeight: 700, border: "none", cursor: saving || !dirty ? "default" : "pointer",
              background: saving || !dirty ? "hsl(var(--muted))" : "hsl(var(--primary))",
              color: saving || !dirty ? "hsl(var(--muted-foreground))" : "hsl(var(--primary-foreground))",
            }}>
            {saving ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} /> : <Save style={{ width: 13, height: 13 }} />}
            {dirty ? "Save groups" : "Saved"}
          </button>
        </div>
      </div>
    </div>
  );
}
