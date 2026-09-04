import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { authHeaders, getCompanyProfile, updateCompanyProfile, type CompanyProfileFields } from "@/lib/api";
import {
  Building2, TrendingUp, Users, Briefcase, Link2, RefreshCw,
  CheckCircle2, XCircle, AlertTriangle, Clock, Activity,
  BarChart3, Sparkles, X, Upload, Gauge, Download,
  MoreVertical, ExternalLink, Loader2, List,
  ToggleLeft, ToggleRight, Search, ShieldCheck, UserPlus, ChevronDown, ChevronRight,
  Pencil, Save, Sun, Moon,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Input } from "@/components/ui/input";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import InviteMembersDialog from "@/components/InviteMembersDialog";
import { markHomeOverlayReady } from "@/components/CommandCentreLoader";

const API = "/api/superadmin";
const OB  = "/api/onboarding";
const SYS = "/api";

const COUNTRIES = [
  "", "United States", "Canada", "United Kingdom", "Australia", "New Zealand",
  "Ireland", "Germany", "France", "Netherlands", "Singapore", "Other",
];
const INDUSTRIES = ["", "Construction", "Engineering", "Architecture", "Real Estate", "Other"];
const OWNERSHIP_TYPES = ["", "Private", "Public", "Joint Venture", "Non-Profit", "Other"];

interface TenantSummary {
  tenantId: string;
  companyName: string;
  latestStatus: string;
  latestImportAt: string | null;
  totalInserted: number;
  totalErrors: number;
  runCount: number;
  activitySparkline: number[];
  projectCount: number;
  staffCount: number;
  oppCount: number;
  assignmentCount: number;
  readinessScore: number;
  isActive: boolean;
}

type StatusFilter = "all" | "success" | "partial" | "failed" | "inactive";

interface FleetSummary {
  tenants: TenantSummary[];
  totals: { companies: number; projects: number; staff: number; opps: number; assignments: number };
  activityByDay: { date: string; inserted: number }[];
}

interface LegacyAssignmentPeriod {
  allocationId: number;
  rwiId: number;
  start: string | null;
  end: string | null;
  hours: number;
  locked: boolean;
}

interface LegacyAssignmentFinding {
  tenantId: string;
  personId: string;
  personName: string;
  ticketId: string;
  role: string;
  assignmentIds: number[];
  canonicalRwiId: number;
  periods: LegacyAssignmentPeriod[];
  rawHours: number;
  mergedHours: number;
  mergeable: boolean;
  reasons: string[];
}

interface LegacyAssignmentScan {
  ok: boolean;
  ranAt: string;
  totalFindings: number;
  findings: LegacyAssignmentFinding[];
  truncated: boolean;
  error?: string;
}

interface Job {
  uploadId:      string;
  tenantId:      string;
  fileName:      string;
  status:        "pending" | "running" | "success" | "partial" | "failed";
  createdAt:     string;
  totalInserted: number;
  totalErrors:   number;
  warningsCount?: number;
}

type ImportMode = "update" | "add" | "replace";

function statusColor(status: string): string {
  if (status === "success") return "#22c55e";
  if (status === "partial")  return "#f59e0b";
  if (status === "failed")   return "#ef4444";
  return "#6b7280";
}

function readinessColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

// ── Badge helpers ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: Job["status"] }) {
  if (status === "success") return <Badge className="bg-green-600 text-white"><CheckCircle2 className="w-3 h-3 mr-1" />Success</Badge>;
  if (status === "failed")  return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
  if (status === "partial") return <Badge className="bg-yellow-500 text-black"><AlertTriangle className="w-3 h-3 mr-1" />Partial</Badge>;
  if (status === "pending") return <Badge variant="outline" className="text-muted-foreground"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
}

function WarningsBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <Badge
      variant="outline"
      className="border-yellow-500 text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 gap-1 shrink-0"
      title={`${count} field write warning${count === 1 ? "" : "s"}`}
    >
      <AlertTriangle className="w-3 h-3" />
      {count} warning{count === 1 ? "" : "s"}
    </Badge>
  );
}

// ── Row actions (inside drill-down table) ─────────────────────────────────────
function RowActions({
  job,
  onView,
  onInvite,
  onReimport,
}: {
  job: Job;
  onView: () => void;
  onInvite: () => void;
  onReimport: (mode: ImportMode) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" title="View details" onClick={onView}>
        <ExternalLink className="w-3 h-3" />
      </Button>
      <a
        href={`${OB}/file/${job.uploadId}`}
        download={job.fileName}
        title={`Download ${job.fileName}`}
        className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8 p-0 text-muted-foreground"
      >
        <Download className="w-3.5 h-3.5" />
      </a>
      <Button
        variant="ghost"
        size="sm"
        title="Invite team members"
        className="text-[#6BA539] hover:text-[#5a8f30]"
        onClick={onInvite}
      >
        <Users className="w-3.5 h-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" title="More actions" disabled={job.status === "running"}>
            <MoreVertical className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem onClick={onInvite}>
            <Users className="w-4 h-4 mr-2 text-[#6BA539]" />
            <div className="flex flex-col">
              <span>Invite team members</span>
              <span className="text-xs text-muted-foreground">Send a secure "set your own password" email.</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onReimport("update")}>
            <RefreshCw className="w-4 h-4 mr-2 text-blue-600" />
            <div className="flex flex-col">
              <span>Re-import from a new file</span>
              <span className="text-xs text-muted-foreground">Pick a new file. Existing records are updated, new rows are added — nothing is removed.</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── Company drill-down slide-over ─────────────────────────────────────────────
function CompanyDrillDown({
  tenant,
  onClose,
}: {
  tenant: TenantSummary;
  onClose: () => void;
}) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);
  const [adminsOpen, setAdminsOpen] = useState(true);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminEmailTouched, setAdminEmailTouched] = useState(false);
  const [addErr, setAddErr] = useState("");

  // Edit Company Profile state
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileErr, setProfileErr] = useState("");
  const [pWebsite,       setPWebsite]       = useState("");
  const [pPhone,         setPPhone]         = useState("");
  const [pEmail,         setPEmail]         = useState("");
  const [pStreet,        setPStreet]        = useState("");
  const [pCity,          setPCity]          = useState("");
  const [pState,         setPState]         = useState("");
  const [pZip,           setPZip]           = useState("");
  const [pCountry,       setPCountry]       = useState("");
  const [pIndustry,      setPIndustry]      = useState("");
  const [pOwnership,     setPOwnership]     = useState("");
  const [pLicense,       setPLicense]       = useState("");
  const [profileLoaded,  setProfileLoaded]  = useState(false);

  const { data: adminsData, isLoading: adminsLoading } = useQuery({
    queryKey: ["superadmin-company-admins", tenant.tenantId],
    queryFn: () =>
      fetch(`${API}/company-admins/${encodeURIComponent(tenant.tenantId)}`, {
        headers: authHeaders(),
      }).then(r => r.json()),
  });

  const addAdmin = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/company-admins/${encodeURIComponent(tenant.tenantId)}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: adminName.trim(), email: adminEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add admin");
      // Auto-send invite so they can set their password immediately
      await fetch(`${OB}/invites/send`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.tenantId, userGuids: [data.userGuid] }),
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["superadmin-company-admins", tenant.tenantId] });
      setAdminName(""); setAdminEmail(""); setAddingAdmin(false); setAddErr("");
    },
    onError: (e: Error) => setAddErr(e.message),
  });

  // Fetch company profile when the section is opened for the first time
  const { data: profileData } = useQuery({
    queryKey: ["superadmin-company-profile", tenant.tenantId],
    queryFn: () => getCompanyProfile(tenant.tenantId),
    enabled: profileOpen,
  });

  // Populate form fields once on first successful fetch
  useEffect(() => {
    if (!profileData?.profile || profileLoaded) return;
    const p = profileData.profile;
    setPWebsite(p.website       ?? "");
    setPPhone(p.phone           ?? "");
    setPEmail(p.companyEmail    ?? "");
    setPStreet(p.streetAddress  ?? "");
    setPCity(p.city             ?? "");
    setPState(p.state           ?? "");
    setPZip(p.zip               ?? "");
    setPCountry(p.country       ?? "");
    setPIndustry(p.industry     ?? "");
    setPOwnership(p.ownershipType ?? "");
    setPLicense(p.licenseNumber ?? "");
    setProfileLoaded(true);
  }, [profileData, profileLoaded]);

  const saveProfile = useMutation({
    mutationFn: () => updateCompanyProfile(tenant.tenantId, {
      website:       pWebsite.trim()   || undefined,
      phone:         pPhone.trim()     || undefined,
      companyEmail:  pEmail.trim()     || undefined,
      streetAddress: pStreet.trim()    || undefined,
      city:          pCity.trim()      || undefined,
      state:         pState.trim()     || undefined,
      zip:           pZip.trim()       || undefined,
      country:       pCountry         || undefined,
      industry:      pIndustry        || undefined,
      ownershipType: pOwnership       || undefined,
      licenseNumber: pLicense.trim()  || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["superadmin-company-profile", tenant.tenantId] });
      setProfileErr("");
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    },
    onError: (e: Error) => setProfileErr(e.message),
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["superadmin-tenant-history", tenant.tenantId],
    queryFn: () =>
      fetch(`${OB}/history?tenantId=${encodeURIComponent(tenant.tenantId)}`, {
        headers: authHeaders(),
      }).then(r => r.json()),
    refetchInterval: 5_000,
  });

  const { data: statusData } = useQuery({
    queryKey: ["superadmin-tenant-status", tenant.tenantId],
    queryFn: () =>
      fetch(`${API}/tenant-status/${encodeURIComponent(tenant.tenantId)}`, {
        headers: authHeaders(),
      }).then(r => r.json()),
  });

  const toggleActive = useMutation({
    mutationFn: async (isActive: boolean) => {
      await fetch(`${API}/tenant-status/${encodeURIComponent(tenant.tenantId)}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["superadmin-tenant-status", tenant.tenantId] });
      qc.invalidateQueries({ queryKey: ["superadmin-fleet"] });
    },
  });

  const jobs: Job[] = historyData?.jobs ?? [];
  const isActive: boolean = statusData?.isActive ?? true;
  const sc = statusColor(tenant.latestStatus);
  const rc = readinessColor(tenant.readinessScore);

  function reimport(job: Job, mode: ImportMode) {
    onClose();
    navigate(`/onboarding?tenant=${encodeURIComponent(job.tenantId)}&mode=${mode}`);
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        className="fixed top-0 right-0 z-50 h-full flex flex-col overflow-hidden"
        style={{
          width: "min(720px, 95vw)",
          background: "#111827",
          borderLeft: "1px solid #1f2937",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.6)",
          /* override CSS vars so all children pick up solid dark colours */
          "--rm-panel-bg": "#111827",
          "--rm-panel-border": "#1f2937",
          "--rm-fg": "#f9fafb",
          "--rm-muted": "#9ca3af",
        } as React.CSSProperties}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 px-6 py-5 shrink-0"
          style={{ borderBottom: "1px solid var(--rm-panel-border)" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "#6BA53920" }}
            >
              <Building2 className="w-5 h-5" style={{ color: "#6BA539" }} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold truncate" style={{ color: "var(--rm-fg)" }}>
                {tenant.tenantId}
              </h2>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <div
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0"
                  style={{ background: `${sc}20`, color: sc, border: `1px solid ${sc}40` }}
                >
                  {tenant.latestStatus}
                </div>
                <span className="text-xs" style={{ color: "var(--rm-muted)" }}>
                  {tenant.runCount} run{tenant.runCount === 1 ? "" : "s"}
                </span>
                {!isActive && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "#374151", color: "#9ca3af" }}>
                    Inactive
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Quick stats */}
        <div
          className="grid grid-cols-4 gap-0 shrink-0"
          style={{ borderBottom: "1px solid var(--rm-panel-border)" }}
        >
          {[
            { label: "Total Projects", value: tenant.projectCount, color: "#3b82f6" },
            { label: "Staff",    value: tenant.staffCount,   color: "#8b5cf6" },
            { label: "Opps",     value: tenant.oppCount,     color: "#f59e0b" },
            { label: "Assigns",  value: tenant.assignmentCount, color: "#6BA539" },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center py-3 gap-0.5" style={{ borderRight: "1px solid var(--rm-panel-border)" }}>
              <div className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--rm-muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Readiness bar */}
        <div className="px-6 py-3 shrink-0" style={{ borderBottom: "1px solid var(--rm-panel-border)" }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] uppercase tracking-wide font-medium" style={{ color: "var(--rm-muted)" }}>Data Readiness</span>
            <span className="text-xs font-bold" style={{ color: rc }}>{tenant.readinessScore}%</span>
          </div>
          <div className="h-1.5 rounded-full" style={{ background: "#1f2937" }}>
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${tenant.readinessScore}%`, background: rc }} />
          </div>
        </div>

        {/* Action bar */}
        <div className="px-6 py-3 flex items-center gap-2 flex-wrap shrink-0" style={{ borderBottom: "1px solid var(--rm-panel-border)" }}>
          <Button
            size="sm"
            onClick={() => { onClose(); navigate(`/onboarding?tenant=${encodeURIComponent(tenant.tenantId)}`); }}
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            Upload File
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { onClose(); navigate(`/onboarding/readiness?tenant=${encodeURIComponent(tenant.tenantId)}`); }}
          >
            <Gauge className="w-3.5 h-3.5 mr-1.5" />
            Data Readiness
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInviteTarget(tenant.tenantId)}
          >
            <Users className="w-3.5 h-3.5 mr-1.5 text-[#6BA539]" />
            Invite Members
          </Button>
          <div className="flex-1" />
          <Button
            variant={isActive ? "outline" : "default"}
            size="sm"
            disabled={toggleActive.isPending}
            onClick={() => toggleActive.mutate(!isActive)}
            title={isActive ? "Mark this company as inactive" : "Mark this company as active"}
            className={isActive ? "text-gray-600 dark:text-gray-400" : "bg-green-600 hover:bg-green-700 text-white"}
          >
            {isActive ? (
              <><ToggleRight className="w-4 h-4 mr-1.5 text-green-500" />Active</>
            ) : (
              <><ToggleLeft className="w-4 h-4 mr-1.5" />Inactive</>
            )}
          </Button>
        </div>

        {/* Company Admins section */}
        <div className="shrink-0" style={{ borderBottom: "1px solid var(--rm-panel-border)" }}>
          {/* Section header */}
          <button
            className="w-full flex items-center justify-between px-6 py-3 hover:bg-white/5 transition-colors"
            onClick={() => setAdminsOpen(o => !o)}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" style={{ color: "#6BA539" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--rm-fg)" }}>Company Admins</span>
              {!adminsLoading && (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: "#6BA53920", color: "#6BA539" }}>
                  {adminsData?.admins?.length ?? 0}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                role="button"
                tabIndex={0}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors cursor-pointer"
                style={{ color: "#6BA539", background: "#6BA53915" }}
                onClick={e => { e.stopPropagation(); setAddingAdmin(true); setAdminsOpen(true); setAddErr(""); }}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setAddingAdmin(true); setAdminsOpen(true); setAddErr(""); } }}
              >
                <UserPlus className="w-3 h-3" />
                Add Admin
              </span>
              {adminsOpen
                ? <ChevronDown className="w-4 h-4" style={{ color: "var(--rm-muted)" }} />
                : <ChevronRight className="w-4 h-4" style={{ color: "var(--rm-muted)" }} />
              }
            </div>
          </button>

          {adminsOpen && (
            <div className="px-6 pb-3 flex flex-col gap-2">
              {/* Add admin inline form */}
              {addingAdmin && (
                <div className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--rm-panel-border)" }}>
                  <div className="text-xs font-medium" style={{ color: "var(--rm-muted)" }}>New company admin — a set-password invite will be sent automatically.</div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Full name"
                      value={adminName}
                      onChange={e => setAdminName(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder="Email address"
                      type="email"
                      value={adminEmail}
                      onChange={e => { setAdminEmail(e.target.value); if (adminEmailTouched) setAdminEmailTouched(false); }}
                      onBlur={() => { if (adminEmail.trim()) setAdminEmailTouched(true); }}
                      className={`h-8 text-sm${adminEmailTouched && adminEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail.trim()) ? " border-red-500 focus:border-red-500" : ""}`}
                    />
                  </div>
                  {adminEmailTouched && adminEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail.trim()) && (
                    <div className="text-xs text-red-400">Please enter a valid email address (e.g. jane@company.com)</div>
                  )}
                  {addErr && <div className="text-xs text-red-400">{addErr}</div>}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={addAdmin.isPending || !adminName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail.trim())}
                      onClick={() => addAdmin.mutate()}
                    >
                      {addAdmin.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <UserPlus className="w-3 h-3 mr-1" />}
                      Add & Invite
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => { setAddingAdmin(false); setAddErr(""); setAdminName(""); setAdminEmail(""); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Admin list */}
              {adminsLoading ? (
                <div className="flex items-center gap-2 py-2 text-xs" style={{ color: "var(--rm-muted)" }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading admins…
                </div>
              ) : (adminsData?.admins?.length ?? 0) === 0 ? (
                <div className="text-xs py-2" style={{ color: "var(--rm-muted)" }}>
                  No admin accounts found for this company.{" "}
                  <button className="underline" style={{ color: "#6BA539" }} onClick={() => setAddingAdmin(true)}>Add one →</button>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {(adminsData.admins as { userGuid: string; name: string; email: string; isDefault: boolean }[]).map(admin => (
                    <div
                      key={admin.userGuid}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--rm-panel-border)" }}
                    >
                      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold" style={{ background: "#6BA53920", color: "#6BA539" }}>
                        {(admin.name || "?")[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: "var(--rm-fg)" }}>{admin.name || "—"}</div>
                        <div className="text-[10px] truncate" style={{ color: "var(--rm-muted)" }}>{admin.email || "no email"}</div>
                      </div>
                      {admin.isDefault && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0" style={{ background: "#3b82f620", color: "#3b82f6" }}>
                          Default
                        </span>
                      )}
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: "#6BA539" }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Company Profile section */}
        <div className="shrink-0" style={{ borderBottom: "1px solid var(--rm-panel-border)" }}>
          <button
            className="w-full flex items-center justify-between px-6 py-3 hover:bg-white/5 transition-colors"
            onClick={() => setProfileOpen(o => !o)}
          >
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4" style={{ color: "#6BA539" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--rm-fg)" }}>Company Profile</span>
            </div>
            {profileOpen
              ? <ChevronDown className="w-4 h-4" style={{ color: "var(--rm-muted)" }} />
              : <ChevronRight className="w-4 h-4" style={{ color: "var(--rm-muted)" }} />
            }
          </button>

          {profileOpen && (
            <div className="px-6 pb-5 flex flex-col gap-4">
              {!profileLoaded && (
                <div className="flex items-center gap-2 py-2 text-xs" style={{ color: "var(--rm-muted)" }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading profile…
                </div>
              )}

              {profileLoaded && (
                <>
                  {/* Contact */}
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider mt-1" style={{ color: "var(--rm-muted)" }}>Contact</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>Website URL</label>
                        <Input value={pWebsite} onChange={e => setPWebsite(e.target.value)} placeholder="https://acme.com" className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>Phone</label>
                        <Input value={pPhone} onChange={e => setPPhone(e.target.value)} placeholder="+1 (555) 000-0000" className="h-8 text-sm" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>Company email</label>
                      <Input value={pEmail} onChange={e => setPEmail(e.target.value)} placeholder="info@acme.com" type="email" className="h-8 text-sm" />
                    </div>
                  </div>

                  {/* Address */}
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--rm-muted)" }}>Address</p>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>Street address</label>
                      <Input value={pStreet} onChange={e => setPStreet(e.target.value)} placeholder="123 Main Street" className="h-8 text-sm" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>City</label>
                        <Input value={pCity} onChange={e => setPCity(e.target.value)} placeholder="New York" className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>State / Province</label>
                        <Input value={pState} onChange={e => setPState(e.target.value)} placeholder="NY" className="h-8 text-sm" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>ZIP / Postal code</label>
                        <Input value={pZip} onChange={e => setPZip(e.target.value)} placeholder="10001" className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>Country</label>
                        <select
                          value={pCountry}
                          onChange={e => setPCountry(e.target.value)}
                          className="w-full h-8 rounded-md border text-sm px-2 focus:outline-none focus:ring-2 focus:ring-ring"
                          style={{ background: "var(--rm-panel-bg)", borderColor: "var(--rm-panel-border)", color: "var(--rm-fg)" }}
                        >
                          {COUNTRIES.map(c => <option key={c} value={c}>{c || "Select country…"}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Business Profile */}
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--rm-muted)" }}>Business Profile</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>Industry / Sector</label>
                        <select
                          value={pIndustry}
                          onChange={e => setPIndustry(e.target.value)}
                          className="w-full h-8 rounded-md border text-sm px-2 focus:outline-none focus:ring-2 focus:ring-ring"
                          style={{ background: "var(--rm-panel-bg)", borderColor: "var(--rm-panel-border)", color: "var(--rm-fg)" }}
                        >
                          {INDUSTRIES.map(i => <option key={i} value={i}>{i || "Select industry…"}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>Ownership type</label>
                        <select
                          value={pOwnership}
                          onChange={e => setPOwnership(e.target.value)}
                          className="w-full h-8 rounded-md border text-sm px-2 focus:outline-none focus:ring-2 focus:ring-ring"
                          style={{ background: "var(--rm-panel-bg)", borderColor: "var(--rm-panel-border)", color: "var(--rm-fg)" }}
                        >
                          {OWNERSHIP_TYPES.map(o => <option key={o} value={o}>{o || "Select type…"}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: "var(--rm-fg)" }}>Contractor license number</label>
                      <Input value={pLicense} onChange={e => setPLicense(e.target.value)} placeholder="e.g. LIC-123456" className="h-8 text-sm" />
                    </div>
                  </div>

                  {/* Save / feedback */}
                  {profileErr && (
                    <div className="text-xs rounded-md px-3 py-2" style={{ background: "#ef444420", color: "#ef4444", border: "1px solid #ef444440" }}>
                      {profileErr}
                    </div>
                  )}
                  {profileSaved && (
                    <div className="text-xs rounded-md px-3 py-2 flex items-center gap-2" style={{ background: "#22c55e20", color: "#22c55e", border: "1px solid #22c55e40" }}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Profile saved successfully.
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={saveProfile.isPending}
                      onClick={() => saveProfile.mutate()}
                      className="h-8 text-xs"
                    >
                      {saveProfile.isPending
                        ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</>
                        : <><Save className="w-3.5 h-3.5 mr-1.5" />Save Profile</>
                      }
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* History table */}
        <div className="flex-1 overflow-y-auto">
          {historyLoading ? (
            <div className="flex items-center justify-center py-16 gap-2" style={{ color: "var(--rm-muted)" }}>
              <Loader2 className="w-5 h-5 animate-spin" /> Loading history…
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: "var(--rm-muted)" }}>
              <Clock className="w-10 h-10 opacity-30" />
              <p className="text-sm">No import runs found for this company.</p>
              <Button
                size="sm"
                onClick={() => { onClose(); navigate(`/onboarding?tenant=${encodeURIComponent(tenant.tenantId)}`); }}
              >
                Start First Upload
              </Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ position: "sticky", top: 0, background: "var(--rm-panel-bg)", zIndex: 1 }}>
                <tr style={{ borderBottom: "1px solid var(--rm-panel-border)" }}>
                  <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--rm-muted)" }}>File</th>
                  <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--rm-muted)" }}>Status</th>
                  <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--rm-muted)" }}>Inserted</th>
                  <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--rm-muted)" }}>Errors</th>
                  <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--rm-muted)" }}>Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--rm-muted)" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr
                    key={job.uploadId}
                    className="cursor-pointer transition-colors"
                    style={{ borderBottom: "1px solid var(--rm-panel-border)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                    onClick={() => { onClose(); navigate(`/onboarding/status/${job.uploadId}`); }}
                  >
                    <td className="px-4 py-3 font-medium max-w-[180px] truncate" style={{ color: "var(--rm-fg)" }} title={job.fileName}>
                      {job.fileName}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={job.status} />
                        <WarningsBadge count={job.warningsCount} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-green-500">
                      {job.totalInserted ?? "—"}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${(job.totalErrors ?? 0) > 0 ? "text-red-500" : ""}`} style={(job.totalErrors ?? 0) === 0 ? { color: "var(--rm-muted)" } : {}}>
                      {job.totalErrors ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--rm-muted)" }}>
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <RowActions
                        job={job}
                        onView={() => { onClose(); navigate(`/onboarding/status/${job.uploadId}`); }}
                        onInvite={() => setInviteTarget(job.tenantId)}
                        onReimport={mode => reimport(job, mode)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {tenant.latestImportAt && (
          <div
            className="px-6 py-3 text-xs shrink-0"
            style={{ borderTop: "1px solid var(--rm-panel-border)", color: "var(--rm-muted)" }}
          >
            Last import on {new Date(tenant.latestImportAt).toLocaleString()}
          </div>
        )}
      </div>

      <InviteMembersDialog
        tenantId={inviteTarget ?? ""}
        tenantLabel={inviteTarget ?? undefined}
        open={!!inviteTarget}
        onOpenChange={open => !open && setInviteTarget(null)}
      />
    </>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string }) {
  return (
    <div
      className="rounded-xl p-5 flex items-center gap-4"
      style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)" }}
    >
      <div className="rounded-lg p-3" style={{ background: `${color}20` }}>
        <Icon className="w-6 h-6" style={{ color }} />
      </div>
      <div>
        <div className="text-2xl font-bold tabular-nums" style={{ color: "var(--rm-fg)" }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
        <div className="text-xs uppercase tracking-wider mt-0.5" style={{ color: "var(--rm-muted)" }}>{label}</div>
      </div>
    </div>
  );
}

// ── Mini sparkline ──────────────────────────────────────────────────────────
function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return <div className="text-xs text-gray-400">No data</div>;
  const max = Math.max(...data, 1);
  const h = 28;
  const w = 8;
  const gap = 3;
  const total = data.length * (w + gap) - gap;
  return (
    <svg width={total} height={h} className="shrink-0">
      {data.map((v, i) => {
        const barH = Math.max(2, Math.round((v / max) * h));
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={h - barH}
            width={w}
            height={barH}
            rx={2}
            fill={color}
            opacity={0.75}
          />
        );
      })}
    </svg>
  );
}

// ── Company health card ──────────────────────────────────────────────────────
function CompanyCard({ t, onClick }: { t: TenantSummary; onClick: () => void }) {
  const sc = statusColor(t.latestStatus);
  const rc = readinessColor(t.readinessScore);
  const inactive = t.isActive === false;
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 cursor-pointer transition-all"
      style={{
        background: "var(--rm-panel-bg)",
        border: `1px solid ${inactive ? "#6b728040" : "var(--rm-panel-border)"}`,
        opacity: inactive ? 0.6 : 1,
      }}
      onClick={onClick}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = inactive ? "#6b728060" : "#6BA53980";
        (e.currentTarget as HTMLDivElement).style.boxShadow = inactive ? "" : "0 4px 20px rgba(107,165,57,0.12)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = inactive ? "#6b728040" : "var(--rm-panel-border)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "";
      }}
      title={`Open ${t.companyName || t.tenantId} history`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
            style={{ background: inactive ? "#6b728020" : "#6BA53920" }}
          >
            <Building2 className="w-4 h-4" style={{ color: inactive ? "#6b7280" : "#6BA539" }} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: "var(--rm-fg)" }} title={t.tenantId}>
              {t.companyName || t.tenantId}
            </div>
            <div className="text-xs truncate" style={{ color: "var(--rm-muted)" }} title={t.tenantId}>
              {t.companyName ? t.tenantId.slice(0, 8) + "…" : ""}{t.companyName ? " · " : ""}{t.runCount} run{t.runCount === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {inactive && (
            <div className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "#6b728020", color: "#6b7280", border: "1px solid #6b728040" }}>
              Inactive
            </div>
          )}
          <div
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: `${sc}20`, color: sc, border: `1px solid ${sc}40` }}
          >
            {t.latestStatus}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div style={{ color: "var(--rm-muted)" }}>Projects</div>
          <div className="font-bold" style={{ color: "var(--rm-fg)" }}>{t.projectCount}</div>
        </div>
        <div>
          <div style={{ color: "var(--rm-muted)" }}>Staff</div>
          <div className="font-bold" style={{ color: "var(--rm-fg)" }}>{t.staffCount}</div>
        </div>
        <div>
          <div style={{ color: "var(--rm-muted)" }}>Opps</div>
          <div className="font-bold" style={{ color: "var(--rm-fg)" }}>{t.oppCount}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--rm-muted)" }}>Readiness</div>
          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-1.5 rounded-full transition-all"
              style={{ width: `${t.readinessScore}%`, background: rc }}
            />
          </div>
          <div className="text-[10px] mt-0.5 font-semibold" style={{ color: rc }}>{t.readinessScore}%</div>
        </div>
        <MiniSparkline data={t.activitySparkline} color="#6BA539" />
      </div>

      {t.latestImportAt && (
        <div className="text-[10px]" style={{ color: "var(--rm-muted)" }}>
          Last import {new Date(t.latestImportAt).toLocaleDateString()}
        </div>
      )}

      <div
        className="text-[11px] font-medium flex items-center gap-1 mt-auto"
        style={{ color: "#6BA539" }}
      >
        <List className="w-3 h-3" />
        View history
      </div>
    </div>
  );
}

// ── Companies bar chart ──────────────────────────────────────────────────────
function FlatBarChart({ tenants }: { tenants: TenantSummary[] }) {
  const data = tenants.slice(0, 15).map(t => ({
    name: t.companyName
      ? (t.companyName.length > 14 ? t.companyName.slice(0, 13) + "…" : t.companyName)
      : (t.tenantId.length > 10 ? t.tenantId.slice(0, 9) + "…" : t.tenantId),
    projects: t.projectCount,
    score: t.readinessScore,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 40 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#888" }} angle={-30} textAnchor="end" />
        <YAxis tick={{ fontSize: 10, fill: "#888" }} />
        <Tooltip
          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey="projects" name="Projects" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={readinessColor(tenants[i]?.readinessScore ?? 0)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── System health strip ──────────────────────────────────────────────────────
function SystemHealthStrip() {
  const { data: uptimeData } = useQuery({
    queryKey: ["superadmin-uptime"],
    queryFn: () => fetch(`${SYS}/system/uptime-history`, { headers: authHeaders() }).then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: blockingData } = useQuery({
    queryKey: ["superadmin-blocking"],
    queryFn: () => fetch(`${SYS}/admin/db-blocking`, { headers: authHeaders() }).then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const services: { id: string; label: string }[] = [
    { id: "api", label: "API" },
    { id: "rmone", label: "RM ONE" },
    { id: "chat", label: "Chat" },
  ];

  const blockingCount = blockingData?.rows?.filter((r: any) => r.blocking_session_id > 0).length ?? 0;

  return (
    <div
      className="rounded-xl p-4 flex flex-wrap items-center gap-6"
      style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)" }}
    >
      <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--rm-muted)" }}>
        System Health
      </div>
      {services.map(svc => {
        const stats = uptimeData?.perService?.[svc.id];
        const pct = stats?.uptimePct ?? 100;
        const ok = pct >= 95;
        return (
          <div key={svc.id} className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: ok ? "#22c55e" : "#ef4444", boxShadow: ok ? "0 0 6px #22c55e" : "0 0 6px #ef4444" }}
            />
            <span className="text-xs font-medium" style={{ color: "var(--rm-fg)" }}>{svc.label}</span>
            <span className="text-xs" style={{ color: "var(--rm-muted)" }}>{pct.toFixed(1)}%</span>
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <Activity className="w-3.5 h-3.5" style={{ color: blockingCount > 0 ? "#f59e0b" : "var(--rm-muted)" }} />
        <span className="text-xs" style={{ color: blockingCount > 0 ? "#f59e0b" : "var(--rm-muted)" }}>
          {blockingCount} blocking {blockingCount === 1 ? "query" : "queries"}
        </span>
      </div>
    </div>
  );
}

// ── Superadmin accounts management panel ─────────────────────────────────────
function SuperadminsPanel() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newEmailTouched, setNewEmailTouched] = useState(false);
  const [addErr, setAddErr] = useState("");

  const { data, isLoading } = useQuery<{ accounts: { email: string; isRoot: boolean; addedBy: string | null; addedAt: string | null }[] }>({
    queryKey: ["superadmin-accounts"],
    queryFn: () => fetch(`${API}/accounts`, { headers: authHeaders() }).then(r => r.json()),
    staleTime: 60_000,
  });

  const addAccount = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/accounts`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to add");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["superadmin-accounts"] });
      setNewEmail(""); setAdding(false); setAddErr("");
    },
    onError: (e: Error) => setAddErr(e.message),
  });

  const removeAccount = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch(`${API}/accounts/${encodeURIComponent(email)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to remove");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["superadmin-accounts"] }),
  });

  const accounts = data?.accounts ?? [];

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4"
      style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: "#6BA539" }} />
          <span className="text-sm font-bold" style={{ color: "var(--rm-fg)" }}>RM ONE Superadmins</span>
          {!isLoading && (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: "#6BA53920", color: "#6BA539" }}>
              {accounts.length}
            </span>
          )}
        </div>
        <button
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity"
          style={{ background: "#6BA53920", color: "#6BA539", border: "1px solid #6BA53930" }}
          onClick={() => { setAdding(true); setAddErr(""); }}
        >
          <UserPlus className="w-3 h-3" />
          Add Superadmin
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--rm-panel-border)" }}>
          <div className="text-xs" style={{ color: "var(--rm-muted)" }}>
            Enter the email address of the RM ONE operator to grant superadmin access.
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="operator@rmone.com"
              type="email"
              value={newEmail}
              onChange={e => { setNewEmail(e.target.value); if (newEmailTouched) setNewEmailTouched(false); }}
              onBlur={() => { if (newEmail.trim()) setNewEmailTouched(true); }}
              className={`h-8 text-sm flex-1${newEmailTouched && newEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail.trim()) ? " border-red-500 focus:border-red-500" : ""}`}
              onKeyDown={e => { if (e.key === "Enter" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail.trim())) addAccount.mutate(); }}
            />
            <Button size="sm" className="h-8 shrink-0" disabled={addAccount.isPending || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail.trim())} onClick={() => addAccount.mutate()}>
              {addAccount.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => { setAdding(false); setNewEmail(""); setAddErr(""); setNewEmailTouched(false); }}>
              Cancel
            </Button>
          </div>
          {newEmailTouched && newEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail.trim()) && (
            <div className="text-xs text-red-400">Please enter a valid email address (e.g. user@company.com)</div>
          )}
          {addErr && <div className="text-xs text-red-400">{addErr}</div>}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--rm-muted)" }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {accounts.map(acct => (
            <div
              key={acct.email}
              className="flex items-center gap-3 px-3 py-2 rounded-lg"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--rm-panel-border)" }}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: "#6BA53920", color: "#6BA539" }}>
                {acct.email[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate font-medium" style={{ color: "var(--rm-fg)" }}>{acct.email}</div>
                {acct.isRoot ? (
                  <div className="text-[10px]" style={{ color: "var(--rm-muted)" }}>Root account — always active</div>
                ) : acct.addedBy ? (
                  <div className="text-[10px]" style={{ color: "var(--rm-muted)" }}>Added by {acct.addedBy}{acct.addedAt ? ` · ${new Date(acct.addedAt).toLocaleDateString()}` : ""}</div>
                ) : null}
              </div>
              {acct.isRoot ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium" style={{ background: "#3b82f620", color: "#3b82f6" }}>
                  Root
                </span>
              ) : (
                <button
                  className="text-[10px] px-2 py-1 rounded shrink-0 transition-colors hover:bg-red-500/10"
                  style={{ color: "#ef4444", border: "1px solid #ef444430" }}
                  disabled={removeAccount.isPending}
                  onClick={() => { if (confirm(`Remove ${acct.email} as superadmin?`)) removeAccount.mutate(acct.email); }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AI analysis panel ────────────────────────────────────────────────────────
function formatGeneratedAt(ts: number | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AIAnalysisPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["superadmin-ai"],
    queryFn: () => fetch(`${API}/ai-analysis`, { headers: authHeaders() }).then(r => r.json()),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      await fetch(`${API}/ai-analysis/refresh`, { method: "POST", headers: authHeaders() });
      await qc.invalidateQueries({ queryKey: ["superadmin-ai"] });
    },
  });

  const bullets: string[] = data?.bullets ?? [];
  const isWorking = isLoading || isFetching || refresh.isPending;
  const generatedAt: number | undefined = data?.generatedAt;

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4"
      style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 shrink-0" style={{ color: "#a855f7" }} />
          <span className="text-sm font-bold" style={{ color: "var(--rm-fg)" }}>AI Fleet Analysis</span>
          {data?.cached && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--rm-panel-border)", color: "var(--rm-muted)" }}>
              cached
            </span>
          )}
          {generatedAt && !isWorking && (
            <span className="text-[10px]" style={{ color: "var(--rm-muted)" }}>
              as of {formatGeneratedAt(generatedAt)}
            </span>
          )}
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={isWorking}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50 shrink-0"
          style={{ background: "#a855f720", color: "#a855f7", border: "1px solid #a855f730" }}
        >
          <RefreshCw className={`w-3 h-3 ${isWorking ? "animate-spin" : ""}`} />
          {isWorking ? "Analysing…" : "Refresh"}
        </button>
      </div>

      {isWorking && !bullets.length ? (
        <div className="space-y-2.5">
          {[85, 70, 90, 60].map((w, i) => (
            <div key={i} className="h-4 rounded animate-pulse" style={{ background: "var(--rm-panel-border)", width: `${w}%` }} />
          ))}
        </div>
      ) : bullets.length ? (
        <ul className="space-y-2.5">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed" style={{ color: "var(--rm-fg)" }}>
              <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#a855f7" }} />
              {b}
            </li>
          ))}
        </ul>
      ) : data?.error ? (
        <div className="text-sm" style={{ color: "#ef4444" }}>{data.error}</div>
      ) : (
        <div className="text-sm" style={{ color: "var(--rm-muted)" }}>
          Generating fleet briefing…
        </div>
      )}
    </div>
  );
}

// ── Legacy assignment duplicate review ───────────────────────────────────────
// This is intentionally not a bulk-fix tool. Every group has been evaluated on
// the server and a merge remains a two-step, typed confirmation action. Groups
// with locks or conflicting hours are visible here but cannot be auto-merged.
function LegacyAssignmentCleanupPanel() {
  const qc = useQueryClient();
  const [tenantScope, setTenantScope] = useState("");
  const [reviewing, setReviewing] = useState<LegacyAssignmentFinding | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const { data, isFetching, refetch, isError } = useQuery<LegacyAssignmentScan>({
    queryKey: ["superadmin-legacy-assignment-duplicates", tenantScope.trim()],
    queryFn: async () => {
      const scope = tenantScope.trim();
      const suffix = scope ? `?tenantId=${encodeURIComponent(scope)}` : "";
      const res = await fetch(`${API}/legacy-assignment-duplicates${suffix}`, { headers: authHeaders() });
      const payload = await res.json() as LegacyAssignmentScan;
      if (!res.ok) throw new Error(payload.error || "Could not scan legacy assignments.");
      return payload;
    },
    enabled: false,
    staleTime: 0,
  });
  const consolidate = useMutation({
    mutationFn: async (finding: LegacyAssignmentFinding) => {
      const res = await fetch(`${API}/legacy-assignment-duplicates/consolidate`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: finding.tenantId,
          assignmentIds: finding.assignmentIds,
          canonicalRwiId: finding.canonicalRwiId,
          confirmation: "CONSOLIDATE",
        }),
      });
      const payload = await res.json() as { error?: string };
      if (!res.ok) throw new Error(payload.error || "The consolidation could not be completed.");
      return finding;
    },
    onSuccess: (finding) => {
      qc.setQueryData<LegacyAssignmentScan>(["superadmin-legacy-assignment-duplicates", tenantScope.trim()], current => current
        ? {
          ...current,
          totalFindings: Math.max(0, current.totalFindings - 1),
          findings: current.findings.filter(item =>
            !(item.tenantId === finding.tenantId && item.assignmentIds.join(",") === finding.assignmentIds.join(","))),
        }
        : current);
      setReviewing(null);
      setConfirmation("");
    },
  });
  const mergeable = data?.findings.filter(finding => finding.mergeable).length ?? 0;

  return (
    <section className="rounded-xl p-5 space-y-4" style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)" }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" style={{ color: "#f59e0b" }} />
            <h2 className="text-sm font-bold" style={{ color: "var(--rm-fg)" }}>Legacy Assignment Review</h2>
          </div>
          <p className="text-xs mt-1 max-w-3xl" style={{ color: "var(--rm-muted)" }}>
            Find old duplicate assignment identities. Only groups with the same person, project, and role — with no locked or conflicting hour periods — can be consolidated. Conflicts are held for review.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={tenantScope}
            onChange={event => setTenantScope(event.target.value)}
            placeholder="Optional tenant ID"
            className="h-8 w-40 text-sm"
            aria-label="Optional tenant ID for legacy assignment review"
          />
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            Run review
          </Button>
        </div>
      </div>

      {isError && <div className="text-sm" style={{ color: "#ef4444" }}>The review could not be loaded. Try again.</div>}
      {!data && !isFetching && !isError && (
        <div className="rounded-lg px-3 py-3 text-sm" style={{ background: "var(--rm-bg)", color: "var(--rm-muted)" }}>
          This starts as a read-only scan. Nothing is changed until you review and confirm an individual group.
        </div>
      )}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--rm-muted)" }}>
            <span><strong style={{ color: "var(--rm-fg)" }}>{data.totalFindings}</strong> duplicate groups found</span>
            <span><strong style={{ color: "#22c55e" }}>{mergeable}</strong> safe to consolidate</span>
            <span>Reviewed {new Date(data.ranAt).toLocaleString()}</span>
          </div>
          {data.truncated && (
            <div className="rounded-lg px-3 py-2 text-xs flex gap-2" style={{ background: "#f59e0b18", color: "#b45309", border: "1px solid #f59e0b55" }}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              The result is capped. Enter a tenant ID and run the review again before relying on this list for a complete review.
            </div>
          )}
          {!data.findings.length ? (
            <div className="rounded-lg px-3 py-3 text-sm flex items-center gap-2" style={{ background: "#22c55e12", color: "#15803d" }}>
              <CheckCircle2 className="w-4 h-4" /> No duplicate legacy assignment identities were found.
            </div>
          ) : (
            <div className="space-y-3">
              {data.findings.map(finding => {
                const key = `${finding.tenantId}:${finding.assignmentIds.join(",")}`;
                const activeReview = reviewing && `${reviewing.tenantId}:${reviewing.assignmentIds.join(",")}` === key;
                return (
                  <div key={key} className="rounded-lg p-3" style={{ border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)" }}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="font-semibold text-sm" style={{ color: "var(--rm-fg)" }}>
                          {finding.personName} <span className="font-normal" style={{ color: "var(--rm-muted)" }}>· {finding.ticketId} · {finding.role}</span>
                        </div>
                        <div className="text-xs mt-1" style={{ color: "var(--rm-muted)" }}>
                          Tenant {finding.tenantId} · assignment IDs {finding.assignmentIds.join(", ")} · keep {finding.canonicalRwiId}
                        </div>
                      </div>
                      {finding.mergeable ? (
                        <Button size="sm" variant="outline" onClick={() => { setReviewing(finding); setConfirmation(""); }}>
                          Review merge
                        </Button>
                      ) : (
                        <Badge variant="outline" className="w-fit" style={{ color: "#b45309", borderColor: "#f59e0b66" }}>Held for review</Badge>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs" style={{ color: "var(--rm-muted)" }}>
                      {finding.periods.map(period => (
                        <span key={period.allocationId}>
                          {period.start ?? "No start"}–{period.end ?? "No end"}: <strong style={{ color: "var(--rm-fg)" }}>{period.hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}h</strong>
                          {period.locked ? " · locked" : ""}
                        </span>
                      ))}
                    </div>
                    {finding.mergeable ? (
                      <div className="mt-2 text-xs" style={{ color: "var(--rm-muted)" }}>
                        Retains {finding.mergedHours.toLocaleString(undefined, { maximumFractionDigits: 2 })}h across distinct periods; exact duplicate periods are removed.
                      </div>
                    ) : (
                      <ul className="mt-2 text-xs list-disc ml-4" style={{ color: "#b45309" }}>
                        {finding.reasons.map(reason => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}
                    {activeReview && (
                      <div className="mt-3 p-3 rounded-md space-y-2" style={{ background: "#f59e0b12", border: "1px solid #f59e0b55" }}>
                        <p className="text-xs" style={{ color: "var(--rm-fg)" }}>
                          This soft-deletes retired assignment identities and duplicate period copies. It preserves the listed distinct periods and records your account in their normal modification audit fields. Type <strong>CONSOLIDATE</strong> to proceed.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="CONSOLIDATE" className="h-8 text-sm" />
                          <div className="flex gap-2 shrink-0">
                            <Button size="sm" variant="ghost" onClick={() => { setReviewing(null); setConfirmation(""); }}>Cancel</Button>
                            <Button size="sm" onClick={() => consolidate.mutate(finding)} disabled={confirmation !== "CONSOLIDATE" || consolidate.isPending}>
                              {consolidate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null} Consolidate
                            </Button>
                          </div>
                        </div>
                        {consolidate.isError && <p className="text-xs" style={{ color: "#dc2626" }}>{consolidate.error.message}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function SuperadminDashboard() {
  // Superadmin skips RoleHome (which normally fires this), so the post-login
  // splash would wait the full 20s cap without it. Fire immediately on mount.
  useEffect(() => { markHomeOverlayReady(); }, []);

  const { data: fleet, isLoading } = useQuery<FleetSummary>({
    queryKey: ["superadmin-fleet"],
    queryFn: () => fetch(`${API}/fleet`, { headers: authHeaders() }).then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  const [selectedTenant, setSelectedTenant] = useState<TenantSummary | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const tenants = fleet?.tenants ?? [];
  const totals  = fleet?.totals ?? { companies: 0, projects: 0, staff: 0, opps: 0, assignments: 0 };
  const activity = fleet?.activityByDay ?? [];

  const filteredTenants = tenants.filter(t => {
    const matchesQuery = !filterQuery.trim() || t.tenantId.toLowerCase().includes(filterQuery.trim().toLowerCase());
    const matchesStatus =
      statusFilter === "all" ? true :
      statusFilter === "inactive" ? !t.isActive :
      t.isActive && t.latestStatus === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const { mode: themeMode, toggle: toggleTheme } = useTheme();

  return (
    <>
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        {/* Header + tab switcher */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <h1 className="text-2xl font-bold" style={{ color: "var(--rm-fg)" }}>Command Center</h1>
            <p className="text-sm mt-1" style={{ color: "var(--rm-muted)" }}>
              Fleet-wide view across all companies — click any card to drill in
            </p>
          </div>
          {/* Light / Dark mode toggle */}
          <button
            onClick={toggleTheme}
            title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 14px",
              borderRadius: 10,
              border: "1px solid var(--rm-panel-border)",
              background: "var(--rm-panel-bg)",
              color: "var(--rm-fg)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              transition: "opacity 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.75")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            {themeMode === "dark"
              ? <><Sun className="w-4 h-4" style={{ color: "#f59e0b" }} /> Light mode</>
              : <><Moon className="w-4 h-4" style={{ color: "#6366f1" }} /> Dark mode</>
            }
          </button>
        </div>


        {/* Fleet summary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Companies"   value={totals.companies}   icon={Building2}  color="#6BA539" />
          <StatCard label="Total Projects" value={totals.projects} icon={Briefcase} color="#3b82f6" />
          <StatCard label="Staff"       value={totals.staff}       icon={Users}      color="#8b5cf6" />
          <StatCard label="Assignments" value={totals.assignments} icon={Link2}      color="#f59e0b" />
        </div>

        {/* 3D Chart + Activity Timeline */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div
            className="rounded-xl p-5 flex flex-col"
            style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)", minHeight: 360 }}
          >
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4" style={{ color: "#6BA539" }} />
              <span className="text-sm font-bold" style={{ color: "var(--rm-fg)" }}>Companies by Project Count</span>
              <span className="text-[10px] ml-1" style={{ color: "var(--rm-muted)" }}>colour = data readiness (green/amber/red)</span>
            </div>
            <div className="flex-1" style={{ minHeight: 280 }}>
              {isLoading ? (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
              ) : (
                <FlatBarChart tenants={tenants} />
              )}
            </div>
          </div>

          <div
            className="rounded-xl p-5 flex flex-col"
            style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)", minHeight: 360 }}
          >
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4" style={{ color: "#3b82f6" }} />
              <span className="text-sm font-bold" style={{ color: "var(--rm-fg)" }}>Import Activity (30 days)</span>
            </div>
            <div className="flex-1" style={{ minHeight: 280 }}>
              {isLoading ? (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
              ) : activity.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activity} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <defs>
                      <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#888" }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10, fill: "#888" }} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                      labelFormatter={l => `Date: ${l}`}
                    />
                    <Area type="monotone" dataKey="inserted" name="Records inserted" stroke="#3b82f6" strokeWidth={2} fill="url(#actGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">No import activity yet</div>
              )}
            </div>
          </div>
        </div>

        {/* Superadmin accounts management */}
        <SuperadminsPanel />

        {/* Safe, reviewed repair for old duplicate assignment identities */}
        <LegacyAssignmentCleanupPanel />

        {/* AI Analysis */}
        <AIAnalysisPanel />

        {/* Company health grid */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider shrink-0" style={{ color: "var(--rm-muted)" }}>
              Company Health Grid
            </h2>
            <div className="flex flex-1 items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative flex-1 min-w-[160px] max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "var(--rm-muted)" }} />
                <input
                  type="text"
                  value={filterQuery}
                  onChange={e => setFilterQuery(e.target.value)}
                  placeholder="Search companies…"
                  className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg outline-none"
                  style={{
                    background: "var(--rm-panel-bg)",
                    border: "1px solid var(--rm-panel-border)",
                    color: "var(--rm-fg)",
                  }}
                />
              </div>
              {/* Status filter */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                className="px-3 py-1.5 text-sm rounded-lg outline-none cursor-pointer"
                style={{
                  background: "var(--rm-panel-bg)",
                  border: "1px solid var(--rm-panel-border)",
                  color: "var(--rm-fg)",
                }}
              >
                <option value="all">All statuses</option>
                <option value="success">Success</option>
                <option value="partial">Partial</option>
                <option value="failed">Failed</option>
                <option value="inactive">Inactive</option>
              </select>
              {/* Active filter indicator */}
              {(filterQuery.trim() || statusFilter !== "all") && (
                <button
                  onClick={() => { setFilterQuery(""); setStatusFilter("all"); }}
                  className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg transition-opacity hover:opacity-70"
                  style={{ background: "var(--rm-panel-border)", color: "var(--rm-muted)" }}
                  title="Clear filters"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
              {!isLoading && (filterQuery.trim() || statusFilter !== "all") && (
                <span className="text-xs" style={{ color: "var(--rm-muted)" }}>
                  {filteredTenants.length} of {tenants.length}
                </span>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-48 rounded-xl animate-pulse" style={{ background: "var(--rm-panel-bg)" }} />
              ))}
            </div>
          ) : filteredTenants.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredTenants.map(t => (
                <CompanyCard
                  key={t.tenantId}
                  t={t}
                  onClick={() => setSelectedTenant(t)}
                />
              ))}
            </div>
          ) : tenants.length ? (
            <div
              className="rounded-xl p-12 text-center"
              style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)" }}
            >
              <Search className="w-8 h-8 mx-auto mb-3 opacity-25" style={{ color: "var(--rm-muted)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--rm-fg)" }}>No companies match your filters</p>
              <p className="text-xs mt-1" style={{ color: "var(--rm-muted)" }}>
                Try a different name or status, or{" "}
                <button
                  className="underline hover:opacity-70"
                  onClick={() => { setFilterQuery(""); setStatusFilter("all"); }}
                >
                  clear filters
                </button>
              </p>
            </div>
          ) : (
            <div
              className="rounded-xl p-12 text-center text-sm"
              style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-muted)" }}
            >
              No companies imported yet.
            </div>
          )}
        </div>

        {/* System health strip */}
        <SystemHealthStrip />
      </div>

      {/* Company drill-down slide-over */}
      {selectedTenant && (
        <CompanyDrillDown
          tenant={selectedTenant}
          onClose={() => setSelectedTenant(null)}
        />
      )}
    </>
  );
}
