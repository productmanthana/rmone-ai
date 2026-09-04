import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Mail, Loader2, RefreshCw, CheckCircle2, ChevronDown, UserPlus, Pencil, Upload, RotateCcw,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddStaffModal } from "@/components/AddStaffModal";
import { EditStaffModal } from "@/components/EditStaffModal";
import BulkStaffUploadModal from "@/components/BulkStaffUploadModal";
import { authHeaders, type LiveResourceProxy } from "@/lib/api";
import { fetchInviteRoster, getInviteRosterSeed, type InviteMember } from "@/lib/inviteRoster";
import { fetchAccessLevels, isCustomAcl, usePermissionsVersion, type AccessLevelDef } from "@/lib/permissions";

const API = "/api/onboarding";
const BRAND = "#A9C23F";
const BRAND_INK = "#253746";

type AccessLevel = "Admin" | "Manager" | "User";
// "" means leave the access level unset → the person is grandfathered (editable).
// "custom:<id>" = admin-defined level (Settings → Access Levels, #87).
type RoleChoice = AccessLevel | "" | string;

const ROLE_OPTIONS: { value: RoleChoice; label: string }[] = [
  { value: "User",    label: "User (view only)" },
  { value: "Manager", label: "Manager (can edit)" },
  { value: "Admin",   label: "Admin (can edit)" },
];
// Existing members can additionally be reset to "no specific level".
const EXISTING_ROLE_OPTIONS: { value: RoleChoice; label: string }[] = [
  { value: "",        label: "Not set" },
  ...ROLE_OPTIONS,
];

interface Props {
  /** Tenant GUID or label accepted by the backend (resolveTenantId handles both). */
  tenantId: string;
  /** Friendly company name shown in the dialog header. */
  tenantLabel?: string;
  /** Dialog mode (default): controlled open state. Ignored when `embedded`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Embedded mode: render inline as a card (Settings → Staff & Resources →
   *  Manage Staff) instead of a popup dialog. Loads the roster on mount. */
  embedded?: boolean;
}

export default function InviteMembersDialog({ tenantId, tenantLabel, open, onOpenChange, embedded = false }: Props) {
  const [invites, setInvites]           = useState<InviteMember[] | null>(null);
  // Which client the on-screen roster belongs to (tenant-isolation guard).
  const loadedTenantRef = useRef<string | null>(null);
  const [invitesLoading, setLoading]    = useState(false);
  const [invitesErr, setInvitesErr]     = useState<string | null>(null);
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [sending, setSending]           = useState(false);
  const [confirmSend, setConfirmSend]   = useState(false);
  const [showAddStaff, setShowAddStaff]     = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [editMember, setEditMember]         = useState<InviteMember | null>(null);
  // A member whose password we're about to reset (re-send a fresh set-password
  // link). Kept separate from the bulk-invite selection so resetting one person
  // never disturbs the checkboxes.
  const [resetTarget, setResetTarget]   = useState<InviteMember | null>(null);
  // Deactivate / reactivate / delete a member — confirmed in the footer (same
  // pattern as the password-reset confirm) so the row controls stay tiny.
  const [actionTarget, setActionTarget] = useState<{ m: InviteMember; kind: "deactivate" | "reactivate" | "delete" } | null>(null);
  const [actionBusy, setActionBusy]     = useState(false);
  const [actionErr, setActionErr]       = useState<string | null>(null);
  const [sendResult, setSendResult]     = useState<{ sentCount: number; failedCount: number; failed: { name: string; reason: string }[] } | null>(null);

  // Per-member access-level editing for people already on the list.
  const [savingRole, setSavingRole] = useState<Set<string>>(new Set());
  const [roleErr, setRoleErr]       = useState<string | null>(null);
  // Admin-defined levels for the inline selector (#87) — soft-fail: the
  // built-ins always work, custom options just don't appear. Keyed on the
  // permissions version so a level added in a sibling tab shows up here.
  const [customLevels, setCustomLevels] = useState<AccessLevelDef[]>([]);
  const permsVersion = usePermissionsVersion();

  // Per-member direct send: which row is currently sending its invite email,
  // and which just finished (brief ✓ flash) so the click feels acknowledged.
  const [sendingOne, setSendingOne] = useState<string | null>(null);
  const [sentOne, setSentOne]       = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // One truth for "is the UI live": embedded mode is always open (loads on
  // mount); dialog mode follows the controlled `open` prop.
  const isOpen = embedded ? true : !!open;
  const requestClose = (v: boolean) => { if (!embedded) onOpenChange?.(v); };

  const loadInvites = useCallback(async () => {
    if (!tenantId) return;
    // Tenant isolation: if the on-screen roster belongs to a DIFFERENT client
    // (superadmin switching scope), clear it before anything else — the old
    // tenant's rows must never linger under the new scope, even if the fresh
    // fetch later fails.
    const tenantChanged = loadedTenantRef.current !== null && loadedTenantRef.current !== tenantId;
    if (tenantChanged) {
      setInvites(null);
      setSelected(new Set());
      loadedTenantRef.current = null;
    }
    // Instant render: paint the last-loaded roster immediately (SWR) while
    // the fresh fetch revalidates in the background. The seed is memory-only,
    // tenant-scoped, and only ever holds successful loads (lib/inviteRoster).
    const seed = getInviteRosterSeed(tenantId);
    if (seed) {
      setInvites(prev => (tenantChanged ? seed : prev ?? seed));
      setSelected(prev => (!tenantChanged && prev.size > 0) ? prev : new Set(
        seed.filter(m => m.hasEmail && m.inviteStatus !== "accepted" && m.enabled !== false).map(m => m.userGuid),
      ));
      loadedTenantRef.current = tenantId;
    }
    setLoading(true);
    setInvitesErr(null);
    setSendResult(null);
    try {
      const members = await fetchInviteRoster(tenantId);
      setInvites(members);
      setSelected(new Set(
        members.filter(m => m.hasEmail && m.inviteStatus !== "accepted" && m.enabled !== false).map(m => m.userGuid),
      ));
      loadedTenantRef.current = tenantId;
    } catch (e: any) {
      // With a seed on screen, keep showing it — a failed silent refresh must
      // not blank a healthy roster (error text renders only when list empty).
      setInvitesErr(e.message ?? "Could not load team members");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);


  // Load the team list automatically each time the dialog is opened; reset
  // transient form/result state when it closes so it opens clean next time.
  useEffect(() => {
    if (!isOpen || !tenantId) return;
    fetchAccessLevels(tenantId).then(setCustomLevels).catch(() => setCustomLevels([]));
  }, [isOpen, tenantId, permsVersion]);

  useEffect(() => {
    if (isOpen) {
      loadInvites();
    } else {
      setRoleErr(null);
      setSendResult(null);
      setConfirmSend(false);
      setResetTarget(null);
      setActionTarget(null);
      setActionErr(null);
      setSearchQuery("");
    }
  }, [isOpen, loadInvites]);

  const toggleSelect = useCallback((guid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid); else next.add(guid);
      return next;
    });
  }, []);

  // Filter the list by search query (name, email, job title, dept).
  const q = searchQuery.trim().toLowerCase();
  const filteredInvites = (invites ?? []).filter(m => {
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      (m.email ?? "").toLowerCase().includes(q) ||
      (m.jobTitle ?? "").toLowerCase().includes(q) ||
      (m.divisionName ?? "").toLowerCase().includes(q) ||
      (m.departmentName ?? "").toLowerCase().includes(q)
    );
  });

  // Members that can actually be invited (have an email and haven't accepted yet).
  const selectableGuids = filteredInvites
    .filter(m => m.hasEmail && m.inviteStatus !== "accepted" && m.enabled !== false)
    .map(m => m.userGuid);
  const allSelected = selectableGuids.length > 0 && selectableGuids.every(g => selected.has(g));

  const toggleSelectAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(selectableGuids));
  }, [allSelected, selectableGuids]);

  // Core send routine, used by "Send invites" and the per-member resend.
  // Returns true only when every requested invite actually went out, so
  // callers can distinguish success from a swallowed failure.
  const doSend = useCallback(async (guids: string[]): Promise<boolean> => {
    if (!tenantId || guids.length === 0) return false;
    setSending(true);
    setInvitesErr(null);
    setSendResult(null);
    try {
      const res = await fetch(`${API}/invites/send`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, userGuids: guids }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setSendResult({ sentCount: d.sentCount, failedCount: d.failedCount, failed: d.failed ?? [] });
      await loadInvites();
      return (d.failedCount ?? 0) === 0 && (d.sentCount ?? 0) > 0;
    } catch (e: any) {
      setInvitesErr(e.message ?? "Failed to send invites");
      return false;
    } finally {
      setSending(false);
    }
  }, [tenantId, loadInvites]);

  // Direct per-member send — no intermediate confirm, no copy step. Sends the
  // set-password email immediately and flashes a ✓ so the click feels done.
  // The ✓ only shows when the email genuinely went out.
  const sendOne = useCallback(async (m: InviteMember) => {
    setSendingOne(m.userGuid);
    try {
      const ok = await doSend([m.userGuid]);
      if (ok) {
        setSentOne(m.userGuid);
        setTimeout(() => setSentOne(null), 2500);
      }
    } finally {
      setSendingOne(null);
    }
  }, [doSend]);

  // Change an existing member's access level. Optimistically updates the row,
  // then persists; on failure it reloads the list so the UI never lies.
  const updateMemberRole = useCallback(async (userGuid: string, role: RoleChoice) => {
    if (!tenantId) return;
    setRoleErr(null);
    setSavingRole(prev => new Set(prev).add(userGuid));
    setInvites(prev => prev?.map(m =>
      m.userGuid === userGuid ? { ...m, accessLevel: role === "" ? null : role } : m) ?? prev);
    try {
      const res = await fetch(`${API}/members/role`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, userGuid, role }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    } catch (e: any) {
      setRoleErr(e.message ?? "Could not update access level");
      await loadInvites();
    } finally {
      setSavingRole(prev => { const next = new Set(prev); next.delete(userGuid); return next; });
    }
  }, [tenantId, loadInvites]);

  // Run the footer-confirmed account action. Deactivate/reactivate hit
  // /members/active; delete hits /members/delete (which refuses anyone with
  // project history — the server message explains to deactivate instead).
  const runMemberAction = useCallback(async () => {
    if (!actionTarget || !tenantId) return;
    const { m, kind } = actionTarget;
    setActionBusy(true);
    setActionErr(null);
    try {
      const url = kind === "delete" ? `${API}/members/delete` : `${API}/members/active`;
      const body: Record<string, unknown> = { tenantId, userGuid: m.userGuid };
      if (kind !== "delete") body.active = kind === "reactivate";
      const res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) throw new Error((d as any).message || (d as any).error || `HTTP ${res.status}`);
      setActionTarget(null);
      await loadInvites();
    } catch (e: any) {
      setActionErr(e.message ?? "The change didn't save — please try again.");
    } finally {
      setActionBusy(false);
    }
  }, [actionTarget, tenantId, loadInvites]);

  const statusBadge = (m: InviteMember) => {
    if (!m.hasEmail) return <Badge variant="outline" className="text-muted-foreground shrink-0">No email</Badge>;
    return null;
  };

  const brandBtn = { backgroundColor: BRAND, color: BRAND_INK } as const;

  // Body + footer are IDENTICAL in dialog and embedded modes — built once and
  // wrapped by whichever chrome (Radix dialog vs. inline card) is in use.
  const bodyAndFooter = (
    <>
        {/* Body (scrolls) */}
        <div className="flex-1 overflow-auto px-6 py-5 space-y-5">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAddStaff(true)}>
                <UserPlus className="w-4 h-4 mr-1.5" />
                Add team member
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowBulkUpload(true)}>
                <Upload className="w-4 h-4 mr-1.5" />
                Bulk upload
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={loadInvites} disabled={invitesLoading}>
              {invitesLoading
                ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                : <RefreshCw className="w-4 h-4 mr-1.5" />}
              Refresh
            </Button>
          </div>

          {/* Status messages */}
          {invitesErr && <p className="text-sm text-red-500">{invitesErr}</p>}
          {roleErr && <p className="text-sm text-red-500">{roleErr}</p>}

          {sendResult && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm">
              <p className="font-medium text-green-600 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                {sendResult.sentCount} invite{sendResult.sentCount === 1 ? "" : "s"} sent
                {sendResult.failedCount > 0 && ` · ${sendResult.failedCount} could not be sent`}
              </p>
              {sendResult.failed.length > 0 && (
                <ul className="mt-1.5 ml-5 list-disc text-xs text-muted-foreground space-y-0.5">
                  {sendResult.failed.map((f, i) => (
                    <li key={i}><strong>{f.name}</strong>: {f.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Member list */}
          {invites === null ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading team members…
            </p>
          ) : invites.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-muted-foreground">No team members found for this client.</p>
              <Button variant="outline" size="sm" onClick={() => setShowAddStaff(true)}>
                <UserPlus className="w-4 h-4 mr-1.5" />
                Add team member
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border divide-y overflow-hidden">
              {/* Search bar */}
              <div className="px-3 py-2 bg-muted/30 border-b">
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <circle cx={11} cy={11} r={8} /><path d="m21 21-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search by name, email or department…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-8 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50">
                <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#A9C23F]"
                    checked={allSelected}
                    disabled={selectableGuids.length === 0}
                    onChange={toggleSelectAll}
                  />
                  {allSelected ? "Deselect all" : "Select all"}
                </label>
                <span className="text-xs text-muted-foreground">
                  {q
                    ? `${filteredInvites.length} of ${invites.length} shown`
                    : `${selectableGuids.length} can be invited`}
                </span>
              </div>
              {filteredInvites.length === 0 && q ? (
                <div className="px-4 py-6 text-sm text-center text-muted-foreground">
                  No members match "{searchQuery}"
                </div>
              ) : null}
              {filteredInvites.map(m => {
                const disabled = !m.hasEmail || m.inviteStatus === "accepted" || m.enabled === false;
                return (
                  <div
                    key={m.userGuid}
                    className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${disabled ? "opacity-70" : "hover:bg-muted/40"}`}
                  >
                    {/* Checkbox + identity toggle selection; the controls on the
                        right are siblings so they never cross-fire the checkbox. */}
                    <label className={`flex items-center gap-3 min-w-0 flex-1 ${disabled ? "" : "cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-[#A9C23F]"
                        checked={selected.has(m.userGuid)}
                        disabled={disabled}
                        onChange={() => toggleSelect(m.userGuid)}
                      />
                      <span className="flex flex-col min-w-0 flex-1 gap-0.5">
                        {/* Row 1 — full name (+ Disabled chip when sign-in is blocked) */}
                        <span className={`font-medium leading-snug ${m.enabled === false ? "text-muted-foreground" : "text-foreground"}`}>
                          {m.name}
                          {m.enabled === false && (
                            <Badge variant="outline" className="ml-2 align-middle text-[9px] px-1 py-0 text-red-400 border-red-500/40 uppercase tracking-wide">Disabled</Badge>
                          )}
                        </span>

                        {/* Row 2 — email */}
                        <span className="text-xs text-muted-foreground truncate">
                          {m.hasEmail ? m.email : "No email address on file"}
                        </span>

                        {/* Row 3 — division + dept */}
                        {(m.divisionName || m.departmentName) && (
                          <span className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            {m.divisionName && (
                              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                                {m.divisionName}
                              </span>
                            )}
                            {m.departmentName && (
                              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                                {m.departmentName}
                              </span>
                            )}
                          </span>
                        )}

                        {/* Row 4 — role chip + inline access-level selector */}
                        <span className="flex items-center gap-2 flex-wrap mt-0.5">
                          {m.jobTitle && (
                            <Badge variant="secondary" className="font-normal text-[11px] px-1.5 py-0">
                              {m.jobTitle}
                            </Badge>
                          )}
                          {(() => {
                            // Normalize built-ins to title-case so "admin" from DB matches
                            // option value "Admin"; custom markers pass through verbatim.
                            const raw = (m.accessLevel ?? "").trim();
                            const isCustom = isCustomAcl(raw);
                            const level = !raw ? null
                              : isCustom ? raw.toLowerCase()
                              : (raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase());
                            const c = level === "Admin" ? "#8B5CF6" : level === "Manager" ? "#4B9CD3" : isCustom ? BRAND_INK : "#6B7280";
                            const deletedCustom = isCustom && !customLevels.some(l => `custom:${l.id}` === level);
                            return (
                              <div className="relative inline-flex items-center" onClick={e => e.preventDefault()}>
                                <select
                                  className="appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring/40 rounded-full"
                                  style={{
                                    paddingTop: 1, paddingBottom: 1,
                                    paddingLeft: 8, paddingRight: 20,
                                    backgroundColor: `${c}1A`,
                                    border: `1px solid ${c}55`,
                                    color: c,
                                    fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                                    opacity: savingRole.has(m.userGuid) ? 0.5 : 1,
                                  }}
                                  value={level ?? ""}
                                  disabled={savingRole.has(m.userGuid)}
                                  onChange={e => updateMemberRole(m.userGuid, e.target.value as RoleChoice)}
                                  title="Change access level"
                                  aria-label={`Access level for ${m.name}`}
                                >
                                  <option value="" style={{ color: "#6B7280" }}>Not set</option>
                                  {ROLE_OPTIONS.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                  {customLevels.length > 0 && (
                                    <optgroup label="Custom levels (Settings → Access Levels)">
                                      {customLevels.map(l => (
                                        <option key={l.id} value={`custom:${l.id}`}>{l.name}</option>
                                      ))}
                                    </optgroup>
                                  )}
                                  {deletedCustom && (
                                    <option value={level!}>Deleted level — pick another (currently view-only)</option>
                                  )}
                                </select>
                                <ChevronDown className="w-2.5 h-2.5 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: c }} />
                              </div>
                            );
                          })()}
                          {savingRole.has(m.userGuid) && (
                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                          )}
                        </span>
                      </span>
                    </label>

                    {/* Right-side actions: one button row + optional status label below */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className="flex items-center gap-2">
                        {statusBadge(m)}
                        {m.inviteStatus === "accepted" && (
                          <Badge variant="outline" className="text-green-600 border-green-500/40">Password set</Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setEditMember(m)}
                          title="Edit division, role, job title…"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit org
                        </Button>
                        {m.hasEmail && m.inviteStatus !== "accepted" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className={`h-8 px-2 gap-1 text-xs ${sentOne === m.userGuid ? "text-green-600 border-green-500/40" : ""}`}
                            onClick={() => sendOne(m)}
                            disabled={sendingOne === m.userGuid || sending}
                            title={
                              m.inviteStatus === "none"
                                ? "Email them a secure set-password link"
                                : m.inviteStatus === "expired"
                                  ? "Link expired — email a fresh set-password link"
                                  : "Resend the set-password link"
                            }
                          >
                            {sendingOne === m.userGuid
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : sentOne === m.userGuid
                                ? <CheckCircle2 className="w-3 h-3" />
                                : m.inviteStatus === "none"
                                  ? <Mail className="w-3 h-3" />
                                  : <RotateCcw className="w-3 h-3" />}
                            {sentOne === m.userGuid ? "Sent!" : m.inviteStatus === "none" ? "Send invite" : "Resend"}
                          </Button>
                        )}
                      </div>
                      {/* Status label sits below the button row, right-aligned under Resend */}
                      {m.hasEmail && m.inviteStatus !== "accepted" && (m.inviteStatus === "sent" || m.inviteStatus === "expired") && (
                        <span className={`text-[10px] leading-none mr-0.5 ${m.inviteStatus === "expired" ? "text-yellow-500" : "text-blue-400"}`}>
                          {m.inviteStatus === "expired" ? "Link expired" : "Invite sent"}
                        </span>
                      )}
                      {m.inviteStatus === "accepted" && m.hasEmail && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1"
                          onClick={() => { setConfirmSend(false); setResetTarget(m); }}
                          disabled={sending}
                          title="Send a fresh set-password link — their current password stops working until they set a new one"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset
                        </Button>
                      )}
                      {/* Account controls — nothing happens until confirmed in the footer */}
                      <div className="flex items-center gap-2.5 mt-0.5">
                        <button
                          type="button"
                          className={`text-[10px] leading-none underline-offset-2 hover:underline ${m.enabled === false ? "text-green-500 hover:text-green-400" : "text-muted-foreground hover:text-amber-500"}`}
                          onClick={() => { setActionErr(null); setActionTarget({ m, kind: m.enabled === false ? "reactivate" : "deactivate" }); }}
                          title={m.enabled === false ? "Let this person sign in again" : "Block sign-in but keep all their projects and history"}
                        >
                          {m.enabled === false ? "Reactivate" : "Deactivate"}
                        </button>
                        <button
                          type="button"
                          className="text-[10px] leading-none text-muted-foreground hover:text-red-500 underline-offset-2 hover:underline"
                          onClick={() => { setActionErr(null); setActionTarget({ m, kind: "delete" }); }}
                          title="For accounts created by mistake — people with project history can't be deleted"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer (sticky) */}
        {actionTarget ? (
          <div className="border-t px-6 py-4 space-y-3 bg-background">
            <p className="text-sm">
              {actionTarget.kind === "deactivate" && (
                <>Deactivate <strong>{actionTarget.m.name}</strong>? They immediately lose the ability to
                sign in and any pending invite link stops working. All their projects, hours and history
                stay exactly as they are — you can reactivate them any time.</>
              )}
              {actionTarget.kind === "reactivate" && (
                <>Reactivate <strong>{actionTarget.m.name}</strong>? They'll be able to sign in again with
                their existing password (or you can send them a fresh invite link afterwards).</>
              )}
              {actionTarget.kind === "delete" && (
                <>Delete <strong>{actionTarget.m.name}</strong>? This is for accounts created by mistake —
                if they have any project assignments the system will refuse, and deactivating is the right
                choice instead. Deleted people move to <strong>Archive → Users</strong>, where an admin can
                restore them.</>
              )}
            </p>
            {actionErr && <p className="text-xs text-red-500">{actionErr}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={actionBusy}
                onClick={() => { setActionTarget(null); setActionErr(null); }}>
                Cancel
              </Button>
              <Button size="sm" disabled={actionBusy}
                className={actionTarget.kind === "delete" ? "bg-red-600 hover:bg-red-700 text-white"
                  : actionTarget.kind === "deactivate" ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
                onClick={() => void runMemberAction()}>
                {actionBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : actionTarget.kind === "deactivate" ? "Deactivate"
                  : actionTarget.kind === "reactivate" ? "Reactivate" : "Delete"}
              </Button>
            </div>
          </div>
        ) : resetTarget ? (
          <div className="border-t px-6 py-4 space-y-3 bg-background">
            <p className="text-sm">
              {resetTarget.inviteStatus === "accepted" ? (
                <>Reset the password for <strong>{resetTarget.name}</strong>? We'll email them a fresh
                "set your own password" link. Their current password will stop working until they
                choose a new one via the link.</>
              ) : (
                <>Resend a password-setup link to <strong>{resetTarget.name}</strong> ({resetTarget.email})?
                {resetTarget.inviteStatus === "expired" && " Their previous link has expired."}{" "}
                A fresh secure link will be emailed to them, valid for 48 hours.</>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setResetTarget(null)} disabled={sending}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => { const g = resetTarget.userGuid; setResetTarget(null); doSend([g]); }} disabled={sending} style={brandBtn}>
                {sending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Mail className="w-4 h-4 mr-1.5" />}
                {sending ? "Sending…" : resetTarget.inviteStatus === "accepted" ? "Yes, reset password" : "Yes, send link"}
              </Button>
            </div>
          </div>
        ) : confirmSend ? (
          <div className="border-t px-6 py-4 space-y-3 bg-background">
            <p className="text-sm">
              Send a secure "set your own password" email to <strong>{selected.size}</strong> team
              member{selected.size === 1 ? "" : "s"}? Their current password will stop working until they set a new one via the link.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmSend(false)} disabled={sending}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => { setConfirmSend(false); doSend([...selected]); }} disabled={sending} style={brandBtn}>
                {sending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Mail className="w-4 h-4 mr-1.5" />}
                {sending ? "Sending…" : "Yes, send invites"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 border-t px-6 py-4 bg-background">
            <p className="text-xs text-muted-foreground">{selected.size} selected</p>
            <Button
              size="sm"
              onClick={() => { if (selected.size > 0) setConfirmSend(true); }}
              disabled={sending || selected.size === 0}
              style={brandBtn}
            >
              {sending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Mail className="w-4 h-4 mr-1.5" />}
              {sending ? "Sending…" : `Send invites${selected.size ? ` (${selected.size})` : ""}`}
            </Button>
          </div>
        )}
    </>
  );

  // Sub-modals are portalled to <body>, so they work identically whether the
  // roster is shown in the dialog or embedded in a settings tab.
  const subModals = (
    <>
    {showAddStaff && createPortal(
      <AddStaffModal
        open={showAddStaff}
        onClose={() => setShowAddStaff(false)}
        onCreated={(_name, inviteSent) => {
          setShowAddStaff(false);
          // Dialog mode closes after a sent invite (legacy behavior); the
          // embedded settings tab has nowhere to "close" to — just refresh.
          if (inviteSent && !embedded) { requestClose(false); } else { loadInvites(); }
        }}
        tenantId={tenantId}
      />,
      document.body,
    )}

    {editMember && createPortal(
      <EditStaffModal
        open={!!editMember}
        resource={editMember ? ({
          id: editMember.userGuid,
          name: editMember.name,
          username: editMember.email,
          role: editMember.jobTitle,
          accessLevel: editMember.accessLevel,
          currentPct: 0, totalProjects: 0,
          allProjectIds: [], activeProjects: [],
          activeAllocations: [], lastActiveDate: null,
        } satisfies LiveResourceProxy) : null}
        onClose={() => setEditMember(null)}
        onSaved={() => { setEditMember(null); loadInvites(); }}
        tenantId={tenantId}
      />,
      document.body,
    )}

    {showBulkUpload && createPortal(
      <BulkStaffUploadModal
        tenantId={tenantId}
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onDone={() => { setShowBulkUpload(false); loadInvites(); }}
      />,
      document.body,
    )}
    </>
  );

  const description = (
    <>
      {tenantLabel ? <>Client: <strong>{tenantLabel}</strong>. </> : null}
      Send each person a secure, one-time link to choose their own password —
      no shared or default passwords. Links expire in 48 hours.
    </>
  );

  if (embedded) {
    return (
      <>
        <div className="rounded-xl border bg-background flex flex-col overflow-hidden">
          {/* Plain header — Radix DialogTitle/Description need a Dialog context. */}
          <div className="px-6 pt-6 pb-4 border-b space-y-1.5">
            <div className="flex items-center gap-2 text-base font-semibold">
              <Mail className="w-4 h-4 shrink-0" /> Manage staff
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed m-0">{description}</p>
          </div>
          {bodyAndFooter}
        </div>
        {subModals}
      </>
    );
  }

  return (
    <>
    <Dialog
      open={isOpen}
      onOpenChange={(v) => {
        // Sub-modals are portalled to body; their backdrop click looks like an
        // "outside click" to Radix and would close the parent — block it.
        if (!v && (showAddStaff || showBulkUpload || !!editMember)) return;
        requestClose(v);
      }}
      // Constant non-modal: the sub-modals (Add/Edit/Bulk) are portalled to
      // <body>, and a modal Radix dialog would trap focus + block scrolling
      // inside them. Keeping this CONSTANT (never toggled) also stops the body
      // scroll-lock from flapping, which caused the visible layout "shake"
      // when stacked popups opened/closed. Outside-close is handled by the
      // guards in onOpenChange/onInteractOutside/onEscapeKeyDown.
      modal={false}
    >
      <DialogContent
        className="max-w-2xl w-full max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
        onInteractOutside={(e) => {
          // Same guard: don't let Radix close the parent while a sub-modal is open.
          if (showAddStaff || showBulkUpload || !!editMember) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          // Suppress Escape bubbling to parent when a sub-modal is handling it.
          if (showAddStaff || showBulkUpload || !!editMember) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-1.5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="w-4 h-4 shrink-0" /> Manage staff
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">{description}</DialogDescription>
        </DialogHeader>
        {bodyAndFooter}
      </DialogContent>
    </Dialog>
    {subModals}
    </>
  );
}
