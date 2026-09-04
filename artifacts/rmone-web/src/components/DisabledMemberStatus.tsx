import React, { useState } from "react";
import { CircleHelp, Loader2, RotateCcw } from "lucide-react";
import { getAuditTrail, reactivateMember } from "@/lib/api";

/**
 * The account-state treatment shared by resource, team and forecast people.
 * Missing `enabled` deliberately means active for compatibility with older
 * projections. `canManageStaff` must be the page's already-resolved server
 * capability — this component never infers admin access from a role label.
 */
export function DisabledMemberStatus({
  enabled,
  userGuid,
  tenantId,
  canManageStaff = false,
  onReactivated,
}: {
  enabled?: boolean;
  userGuid?: string;
  tenantId?: string;
  canManageStaff?: boolean;
  onReactivated?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [history, setHistory] = useState<string | null>(null);
  if (enabled !== false) return null;

  const reactivate = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canManageStaff || !userGuid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reactivateMember(userGuid, tenantId);
      await onReactivated?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reactivate this person.");
    } finally {
      setBusy(false);
    }
  };

  const showDisabledHistory = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!userGuid || historyBusy) return;
    if (history) {
      setHistory(null);
      return;
    }
    setHistoryBusy(true);
    try {
      const result = await getAuditTrail({
        entityType: "staff",
        entityId: userGuid,
        outcome: "success",
        eventKind: "change",
        limit: 25,
      });
      const deactivation = result.rows.find((row) => {
        if (!Array.isArray(row.changes)) return false;
        return row.changes.some((rawChange) => {
          if (!rawChange || typeof rawChange !== "object") return false;
          const change = rawChange as Record<string, unknown>;
          const field = String(change.FieldName ?? change.fieldName ?? "").trim().toLowerCase();
          const next = change.NewValue ?? change.newValue;
          return field === "enabled" && (next === false || String(next).toLowerCase() === "false");
        });
      });
      if (!deactivation) {
        setHistory("No deactivation history was recorded. This account may have been disabled before account tracking began.");
        return;
      }
      const actor = deactivation.actorName || deactivation.actorEmail || (deactivation.actorType === "system" ? "the system" : "an administrator");
      const when = new Date(deactivation.createdAt);
      const date = Number.isNaN(when.getTime())
        ? "at an unknown time"
        : `on ${when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
      setHistory(`Disabled by ${actor} ${date}.`);
    } catch {
      setHistory("The deactivation history could not be loaded right now.");
    } finally {
      setHistoryBusy(false);
    }
  };

  return (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
        <span
          title="This account is disabled and cannot sign in."
          style={{ padding: "1px 6px", borderRadius: 999, fontSize: 9, lineHeight: "16px", fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "#b91c1c", border: "1px solid #ef444477", background: "#fef2f2" }}
        >Disabled</span>
        {canManageStaff && userGuid && (
          <button type="button" onClick={reactivate} disabled={busy} title="Reactivate account"
            style={{ border: "none", background: "transparent", padding: 0, cursor: busy ? "wait" : "pointer", color: "#4d7c0f", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
            {busy ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Reactivate
          </button>
        )}
        {userGuid && (
          <button type="button" onClick={showDisabledHistory} disabled={historyBusy} title="Show who disabled this account"
            style={{ border: "none", background: "transparent", padding: 0, cursor: historyBusy ? "wait" : "pointer", color: "#64748b", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
            {historyBusy ? <Loader2 size={11} className="animate-spin" /> : <CircleHelp size={11} />} Who disabled?
          </button>
        )}
      </span>
      {error && <span role="alert" style={{ display: "block", color: "#b91c1c", fontSize: 10 }}>{error}</span>}
      {history && <span role="status" style={{ display: "block", color: "#64748b", fontSize: 10, lineHeight: 1.35 }}>{history}</span>}
    </>
  );
}