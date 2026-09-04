// ── Offices — dedicated admin page ──────────────────────────────────────────
// Offices used to live as a cramped strip inside Manage Organization; they are
// a flat location list, not part of the BU→Division→Department hierarchy, so
// they get their own page (and an "Offices" popup on the Organization page).
// All add/edit flows go through OfficeEditorModal: name + staff picker with
// move/unassign warnings. Writes are admin-gated server-side; rename
// propagates to every staff member; delete is blocked while staff remain.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/useAuth";
import { Redirect } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { getOffices, deleteOffice, type OfficeInfo } from "@/lib/api";
import OfficeEditorModal from "@/components/OfficeEditorModal";
import {
  Building2, Plus, Pencil, Trash2, Loader2, Users, MapPin,
} from "lucide-react";

const CARD  = "hsl(var(--card))";
const BORDER = "hsl(var(--border))";
const TEXT  = "hsl(var(--foreground))";
const MUTED = "hsl(var(--muted-foreground))";
const ACCENT = "#0ea5e9";

export default function OfficesPage({ embedded = false, tenantId }: {
  /** Rendered inside another page (e.g. superadmin client settings, Organization popup) — no page chrome. */
  embedded?: boolean;
  /** Superadmin: manage a specific client's offices. null/undefined = own tenant. */
  tenantId?: string | null;
} = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.isAdmin !== false; // grandfathered-admin convention
  const tid = tenantId ?? undefined;

  const [offices, setOffices]   = useState<OfficeInfo[]>([]);
  const [loading, setLoading]   = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  // null = closed; { office: null } = add mode; { office: "X" } = edit "X".
  const [editor, setEditor] = useState<{ office: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setOffices(await getOffices(tid)); }
    catch { toast({ title: "Couldn't load offices", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [toast, tid]);
  useEffect(() => { void load(); }, [load]);

  if (!isAdmin) return <Redirect to="/" />;

  const handleDelete = async (name: string) => {
    if (deleting) return;
    setDeleting(name);
    try {
      await deleteOffice(name, tid);
      toast({ title: "Office removed", description: name });
      await load();
    } catch (e) {
      toast({ title: "Couldn't remove office", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setDeleting(null); }
  };

  const totalStaff = offices.reduce((s, o) => s + (o.staffCount || 0), 0);

  return (
    <div style={{ maxWidth: 880, margin: embedded ? undefined : "0 auto", padding: embedded ? "16px 0 24px" : "28px 24px 60px" }}>
      {/* Header — title on the left, Add office on the top right */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 6 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center",
          justifyContent: "center", background: `${ACCENT}18`, color: ACCENT, flexShrink: 0,
        }}>
          <Building2 size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: 0 }}>Offices</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>
            Locations shown on staff profiles and in forecast views. Renaming an office moves everyone assigned to it.
          </p>
        </div>
        <button
          onClick={() => setEditor({ office: null })}
          style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700,
            padding: "9px 16px", borderRadius: 9, border: "none", color: "#fff",
            background: ACCENT, cursor: "pointer", flexShrink: 0,
          }}
        >
          <Plus size={14} /> Add office
        </button>
      </div>

      {/* Summary strip */}
      <div style={{ display: "flex", gap: 10, margin: "18px 0 22px" }}>
        {[
          { icon: MapPin, label: "Offices", value: loading ? "…" : String(offices.length) },
          { icon: Users, label: "Staff with an office", value: loading ? "…" : String(totalStaff) },
        ].map(s => (
          <div key={s.label} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
            border: `1px solid ${BORDER}`, borderRadius: 10, background: CARD,
          }}>
            <s.icon size={15} style={{ color: ACCENT }} />
            <span style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>{s.value}</span>
            <span style={{ fontSize: 12, color: MUTED }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Office cards */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: MUTED, fontSize: 13, padding: "16px 0" }}>
          <Loader2 size={15} className="animate-spin" /> Loading offices…
        </div>
      ) : offices.length === 0 ? (
        <div style={{
          border: `1px dashed ${BORDER}`, borderRadius: 12, padding: "36px 20px",
          textAlign: "center", color: MUTED, fontSize: 13,
        }}>
          No offices yet — use “Add office” to create your first one and pick its staff.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {offices.map(office => {
            const isDeleting = deleting === office.name;
            const hasStaff = (office.staffCount || 0) > 0;
            return (
              <div key={office.name} style={{
                border: `1px solid ${BORDER}`, borderRadius: 12, background: CARD,
                padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center",
                    justifyContent: "center", background: `${ACCENT}12`, color: ACCENT, flexShrink: 0,
                  }}>
                    <Building2 size={15} />
                  </div>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={office.name}>
                    {office.name}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    onClick={() => setEditor({ office: office.name })}
                    title="View & edit the staff in this office"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
                      color: hasStaff ? ACCENT : MUTED, background: hasStaff ? `${ACCENT}12` : "hsl(var(--muted))",
                      borderRadius: 20, padding: "3px 10px", border: "none", cursor: "pointer",
                    }}>
                    <Users size={11} />
                    {office.staffCount} staff
                  </button>
                  {!office.curated && (
                    <span title="Found on staff records but not yet added to the curated list" style={{
                      fontSize: 10, fontWeight: 600, color: MUTED, border: `1px solid ${BORDER}`,
                      borderRadius: 20, padding: "2px 8px",
                    }}>
                      from staff data
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <button onClick={() => setEditor({ office: office.name })} title="Edit office & staff"
                    style={{ display: "flex", background: "none", border: "none", cursor: "pointer", color: MUTED, padding: 4 }}>
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => void handleDelete(office.name)}
                    disabled={isDeleting || hasStaff}
                    title={hasStaff ? "Unassign the staff in this office before deleting it" : "Delete"}
                    style={{
                      display: "flex", background: "none", border: "none",
                      cursor: isDeleting || hasStaff ? "not-allowed" : "pointer",
                      color: hasStaff ? MUTED : "#ef4444", opacity: hasStaff ? 0.5 : 1, padding: 4,
                    }}>
                    {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <OfficeEditorModal
        open={editor != null}
        onClose={() => setEditor(null)}
        tenantId={tid}
        offices={offices}
        office={editor?.office ?? null}
        onSaved={load}
      />
    </div>
  );
}
