// ── Office editor popup ──────────────────────────────────────────────────────
// One modal covers every office scenario: add a new office, rename an existing
// one, and pick exactly who works there. The staff list shows each person's
// current office so the admin is warned before anyone is MOVED from another
// office, and unchecking a current member unassigns them on save.
// Plain fixed-position overlay (no Radix portal) so it stacks reliably above
// the Organization-page popup that can host it (see modal-zindex memory).
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  getOfficeStaff, addOffice, renameOffice, assignOfficeStaff,
  type OfficeInfo, type OfficeStaffMember,
} from "@/lib/api";
import { Building2, Loader2, Search, Users, X, AlertTriangle, ArrowRight } from "lucide-react";
import { Z } from "@/lib/zLayers";

const BORDER = "hsl(var(--border))";
const TEXT   = "hsl(var(--foreground))";
const MUTED  = "hsl(var(--muted-foreground))";
const ACCENT = "#0ea5e9";
const AMBER  = "#d97706";

export default function OfficeEditorModal({ open, onClose, tenantId, offices, office, onSaved }: {
  open: boolean;
  onClose: () => void;
  /** Superadmin: manage a specific client's offices. null/undefined = own tenant. */
  tenantId?: string | null;
  /** Existing offices (for duplicate-name warnings). */
  offices: OfficeInfo[];
  /** Office being edited; null = adding a new office. */
  office: string | null;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const isEdit = office != null;

  const [name, setName]       = useState("");
  const [staff, setStaff]     = useState<OfficeStaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch]   = useState("");
  const [saving, setSaving]   = useState(false);
  // Members when the modal opened — the diff against `selected` drives saves.
  const initialMembers = useRef<Set<string>>(new Set());

  // (Re)initialize whenever the modal opens for a (possibly different) office.
  useEffect(() => {
    if (!open) return;
    setName(office ?? "");
    setSearch("");
    setSelected(new Set());
    initialMembers.current = new Set();
    setLoading(true);
    setLoadErr(false);
    let alive = true;
    getOfficeStaff(tenantId)
      .then(list => {
        if (!alive) return;
        setStaff(list);
        if (office != null) {
          const members = new Set(list.filter(s => (s.office ?? "").toLowerCase() === office.toLowerCase()).map(s => s.id));
          initialMembers.current = members;
          setSelected(new Set(members));
        }
      })
      .catch(() => { if (alive) setLoadErr(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, office, tenantId]);

  const trimmed = name.trim();
  // Duplicate warning: another office (curated OR seen on staff data) already
  // uses this name. When editing, the office's own name is not a duplicate.
  const duplicate = useMemo(() => {
    const low = trimmed.toLowerCase();
    if (!low) return null;
    if (isEdit && low === office!.toLowerCase()) return null;
    return offices.find(o => o.name.toLowerCase() === low) ?? null;
  }, [trimmed, offices, isEdit, office]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(s => s.name.toLowerCase().includes(q) || (s.title ?? "").toLowerCase().includes(q) || (s.office ?? "").toLowerCase().includes(q));
  }, [staff, search]);

  const movedCount = useMemo(() => {
    let n = 0;
    for (const s of staff) {
      if (!selected.has(s.id)) continue;
      const cur = (s.office ?? "").toLowerCase();
      if (cur && cur !== (office ?? "").toLowerCase()) n++;
    }
    return n;
  }, [staff, selected, office]);
  const removedCount = useMemo(
    () => [...initialMembers.current].filter(id => !selected.has(id)).length,
    [selected],
  );

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const canSave = !!trimmed && !duplicate && !saving && !loading;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      let finalName = trimmed;
      if (!isEdit) {
        // Only add to the curated list when the name is genuinely new — the
        // duplicate guard above already blocks known names.
        await addOffice(finalName, tenantId);
      } else if (trimmed.toLowerCase() !== office!.toLowerCase() || trimmed !== office) {
        if (trimmed !== office) {
          await renameOffice(office!, trimmed, tenantId);
        }
      }
      const toAdd = [...selected].filter(id => !initialMembers.current.has(id));
      const toRemove = [...initialMembers.current].filter(id => !selected.has(id));
      if (toAdd.length) await assignOfficeStaff(finalName, toAdd, tenantId);
      if (toRemove.length) await assignOfficeStaff(null, toRemove, tenantId);
      const bits: string[] = [];
      if (toAdd.length) bits.push(`${toAdd.length} added`);
      if (toRemove.length) bits.push(`${toRemove.length} unassigned`);
      toast({ title: isEdit ? `Office "${finalName}" updated` : `Office "${finalName}" created`, description: bits.length ? bits.join(" · ") : undefined });
      await onSaved();
      onClose();
    } catch (e) {
      toast({ title: "Couldn't save office", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: Z.POPUP_TOP, background: "rgba(15,23,42,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(2px)", padding: 16,
      }}>
      <div style={{
        background: "hsl(var(--card))", borderRadius: 16, width: "min(560px, 100%)",
        maxHeight: "min(680px, calc(100vh - 48px))", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(15,23,42,0.25)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px 12px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: `${ACCENT}15`, color: ACCENT, flexShrink: 0 }}>
            <Building2 size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{isEdit ? `Edit office` : "Add office"}</div>
            <div style={{ fontSize: 11.5, color: MUTED }}>
              {isEdit ? "Rename the office and choose who works there." : "Name the office and pick the staff who work there."}
            </div>
          </div>
          <button onClick={onClose} disabled={saving} title="Close"
            style={{ display: "flex", background: "none", border: "none", cursor: "pointer", color: MUTED, padding: 6 }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: "14px 20px 0", display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
          {/* Name */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>Office name</label>
            <input
              autoFocus={!isEdit}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. New York, Remote…"
              disabled={saving}
              style={{
                width: "100%", boxSizing: "border-box", marginTop: 5, fontSize: 13.5, fontWeight: 600,
                padding: "9px 12px", borderRadius: 9,
                border: `1px solid ${duplicate ? AMBER : BORDER}`,
                background: "hsl(var(--background))", color: TEXT, outline: "none",
              }}
            />
            {duplicate && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginTop: 7, padding: "8px 11px", borderRadius: 9, background: "#fffbeb", border: "1px solid #fde68a" }}>
                <AlertTriangle size={13} style={{ color: AMBER, flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12, color: "#92400e", lineHeight: 1.45 }}>
                  An office named <strong>{duplicate.name}</strong> already exists
                  {duplicate.staffCount ? ` with ${duplicate.staffCount} staff` : ""}. Edit that office instead of adding it twice.
                </span>
              </div>
            )}
          </div>

          {/* Staff picker */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>Staff in this office</label>
              <span style={{ flex: 1 }} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: ACCENT }}>
                <Users size={12} /> {selected.size} selected
              </span>
            </div>

            {(movedCount > 0 || removedCount > 0) && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 7, padding: "8px 11px", borderRadius: 9, background: "#fffbeb", border: "1px solid #fde68a" }}>
                <AlertTriangle size={13} style={{ color: AMBER, flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12, color: "#92400e", lineHeight: 1.45 }}>
                  On save{movedCount > 0 && <>, <strong>{movedCount}</strong> {movedCount === 1 ? "person" : "people"} will be moved here from another office</>}
                  {removedCount > 0 && <>{movedCount > 0 ? " and" : ","} <strong>{removedCount}</strong> current {removedCount === 1 ? "member" : "members"} will be left without an office</>}.
                </span>
              </div>
            )}

            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search staff by name, title or office…"
                disabled={loading}
                style={{
                  width: "100%", boxSizing: "border-box", fontSize: 12.5, padding: "8px 12px 8px 31px",
                  borderRadius: 9, border: `1px solid ${BORDER}`, background: "hsl(var(--background))", color: TEXT, outline: "none",
                }}
              />
            </div>

            <div style={{ flex: 1, minHeight: 120, overflowY: "auto", border: `1px solid ${BORDER}`, borderRadius: 10 }}>
              {loading ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: MUTED, fontSize: 12.5, padding: 16 }}>
                  <Loader2 size={14} className="animate-spin" /> Loading staff…
                </div>
              ) : loadErr ? (
                <div style={{ color: MUTED, fontSize: 12.5, padding: 16 }}>
                  Couldn't load the staff list — close and try again.
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ color: MUTED, fontSize: 12.5, padding: 16 }}>
                  {staff.length === 0 ? "No active staff found." : "No staff match your search."}
                </div>
              ) : filtered.map(s => {
                const checked = selected.has(s.id);
                const curLow = (s.office ?? "").toLowerCase();
                const isMemberHere = curLow && curLow === (office ?? "").toLowerCase();
                const willMove = checked && curLow && !isMemberHere;
                return (
                  <label key={s.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "7px 12px",
                    borderBottom: `1px solid hsl(var(--border) / 0.5)`, cursor: "pointer",
                    background: checked ? `${ACCENT}08` : "transparent",
                  }}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(s.id)} disabled={saving}
                      style={{ accentColor: ACCENT, width: 14, height: 14, flexShrink: 0, cursor: "pointer" }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                      {s.title && <span style={{ display: "block", fontSize: 10.5, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>}
                    </span>
                    {willMove ? (
                      <span title={`Currently in ${s.office} — saving moves them here`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: AMBER, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 20, padding: "2px 8px", flexShrink: 0, maxWidth: 170 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.office}</span>
                        <ArrowRight size={10} style={{ flexShrink: 0 }} />
                        <span>here</span>
                      </span>
                    ) : s.office && !isMemberHere ? (
                      <span title={`Currently in ${s.office}`} style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 20, padding: "2px 8px", flexShrink: 0, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.office}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 20px 16px" }}>
          <button onClick={onClose} disabled={saving}
            style={{ fontSize: 12.5, fontWeight: 600, padding: "8px 14px", borderRadius: 9, border: `1px solid ${BORDER}`, background: "transparent", color: MUTED, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={() => void handleSave()} disabled={!canSave}
            style={{
              display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700,
              padding: "8px 18px", borderRadius: 9, border: "none", color: "#fff", background: ACCENT,
              cursor: canSave ? "pointer" : "not-allowed", opacity: canSave ? 1 : 0.5,
            }}>
            {saving && <Loader2 size={13} className="animate-spin" />}
            {isEdit ? "Save changes" : "Add office"}
          </button>
        </div>
      </div>
    </div>
  );
}
