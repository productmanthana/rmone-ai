/**
 * Archive → Users — deleted staff accounts.
 *
 * People removed via Manage Staff → Delete land here (soft-deleted: they keep
 * their row, they just can't sign in and leave every active list). An admin
 * can restore them, which puts them straight back into Manage Staff.
 *
 * The server enforces the staff-admin gate on restore; `canManage` only hides
 * the button up front for view-only users.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, UserX } from "lucide-react";
import { authHeaders } from "@/lib/api";

const API = "/api/onboarding";

interface ArchivedUser {
  userGuid: string;
  name: string;
  email: string;
  username: string;
  jobTitle: string;
  removedAt: string | null;
}

interface Props {
  tenantId: string;
  /** The page's search box text — filters this list too. */
  search: string;
  canManage: boolean;
}

const C = {
  card: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.09)",
  text: "#E5E7EB",
  dim: "#9CA3AF",
  green: "#A9C23F",
  red: "#F87171",
};

export default function ArchivedUsersPanel({ tenantId, search, canManage }: Props) {
  const [rows, setRows] = useState<ArchivedUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) { setRows([]); return; }
    setErr(null);
    try {
      const res = await fetch(`${API}/members/archived?tenantId=${encodeURIComponent(tenantId)}`, { headers: authHeaders() });
      const d = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) throw new Error((d as { error?: string }).error || `HTTP ${res.status}`);
      setRows(((d as { members?: ArchivedUser[] }).members ?? []));
    } catch (e) {
      setErr((e as Error).message ?? "Couldn't load archived users");
      setRows(prev => prev ?? []); // no forever-spinner on failure
    }
  }, [tenantId]);

  useEffect(() => { setRows(null); void load(); }, [load]);

  const restore = useCallback(async (guid: string) => {
    setBusy(guid);
    setActionErr(null);
    try {
      const res = await fetch(`${API}/members/restore`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, userGuid: guid }),
      });
      const d = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) throw new Error((d as { message?: string; error?: string }).message || (d as { error?: string }).error || `HTTP ${res.status}`);
      setConfirming(null);
      await load();
    } catch (e) {
      setActionErr((e as Error).message ?? "Restore failed — please try again.");
    } finally {
      setBusy(null);
    }
  }, [tenantId, load]);

  const q = search.trim().toLowerCase();
  const shown = (rows ?? []).filter(u => !q
    || (u.name || "").toLowerCase().includes(q)
    || (u.email || "").toLowerCase().includes(q)
    || (u.jobTitle || "").toLowerCase().includes(q));

  return (
    <div style={{ padding: "4px 24px 40px" }}>
      {rows === null ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: C.dim, fontSize: 13 }}>
          <Loader2 size={16} style={{ display: "inline-block", verticalAlign: -3, marginRight: 8 }} className="animate-spin" />
          Loading archived users…
        </div>
      ) : err ? (
        <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13 }}>
          <div style={{ color: C.red, marginBottom: 10 }}>{err}</div>
          <button onClick={() => void load()}
            style={{ padding: "7px 14px", borderRadius: 8, backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 12, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div style={{ padding: "48px 0", textAlign: "center", color: C.dim, fontSize: 13 }}>
          <UserX size={22} style={{ display: "block", margin: "0 auto 10px", opacity: 0.5 }} />
          {q ? `No archived users match "${search}"` : (
            <>
              No archived users.
              <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>
                People deleted from Manage Staff appear here and can be restored by an admin.
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {actionErr && (
            <div style={{ padding: "8px 12px", borderRadius: 8, backgroundColor: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.35)", color: C.red, fontSize: 12 }}>
              {actionErr}
            </div>
          )}
          {shown.map(u => {
            const removed = u.removedAt ? new Date(u.removedAt) : null;
            const isBusy = busy === u.userGuid;
            const isConfirming = confirming === u.userGuid;
            return (
              <div key={u.userGuid}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                  backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
                }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: C.text, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {u.name || u.username}
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: C.red, border: "1px solid rgba(248,113,113,0.4)", borderRadius: 999, padding: "1px 7px" }}>
                      Deleted
                    </span>
                  </div>
                  <div style={{ color: C.dim, fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {u.email || "No email on file"}{u.jobTitle ? ` · ${u.jobTitle}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  {removed && !Number.isNaN(removed.getTime()) && (
                    <span style={{ color: C.dim, fontSize: 11 }}>Removed {removed.toLocaleDateString()}</span>
                  )}
                  {canManage && (isConfirming ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button disabled={isBusy} onClick={() => void restore(u.userGuid)}
                        style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, backgroundColor: C.green, border: `1px solid ${C.green}`, color: "#1F2937", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: isBusy ? 0.6 : 1 }}>
                        {isBusy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        Confirm restore
                      </button>
                      <button disabled={isBusy} onClick={() => setConfirming(null)}
                        style={{ padding: "6px 10px", borderRadius: 8, backgroundColor: "transparent", border: `1px solid ${C.border}`, color: C.dim, fontSize: 12, cursor: "pointer" }}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => { setActionErr(null); setConfirming(u.userGuid); }}
                      title="Bring this person back — they reappear in Manage Staff and can sign in again"
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, backgroundColor: "transparent", border: `1px solid ${C.green}66`, color: C.green, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      <RotateCcw size={12} />
                      Restore
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
