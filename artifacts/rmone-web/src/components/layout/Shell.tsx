import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/useAuth";
import { isSuperAdmin } from "@/lib/roleResolver";
import { NAV_DEFS, navDefMatches, tenantMatchesAllowlist, type NavSurface } from "@/lib/navCatalog";
import { getMyNavigation, getMyCapabilities, type MyCapabilities } from "@/lib/permissions";
import { authHeaders } from "@/lib/api";
import {
  House,
  UsersRound,
  Bot,
  BellRing,
  Activity,
  UserCircle,
  LogOut,
  Sun,
  Moon,
  Menu,
  X,
  Check,
  TrendingUp,
  LineChart,
  Sunrise,
  SlidersHorizontal,
  LayoutDashboard,
  Building2,
  PlusCircle,
  Settings2,
  FileText,
  BarChart3,
  BookUser,
  Handshake,
  HardHat,
  Archive,
  FileUp,
  RotateCcw,
  Radar,
  Zap,
  Gauge,
} from "lucide-react";
import {
  resolveActiveRole,
  getJobTitleOverride,
  getRoleOverride,
  type RolePersona,
} from "@/lib/roleResolver";
import { CommandPalette } from "@/components/CommandPalette";
import { useTheme } from "@/lib/theme";


// Compact light/dark toggle that lives next to the avatar in the top-right.
// Persists across pages via the ThemeProvider; sets data-theme on <html>
// which Home (and any other opted-in page) reads via CSS variables.
function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const isDark = mode === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle light/dark mode"
      className="flex items-center justify-center rounded-full transition-transform hover:scale-105"
      style={{
        width: 32,
        height: 32,
        backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(27,43,56,0.08)",
        border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(27,43,56,0.18)"}`,
        color: isDark ? "#FFFFFF" : "#1B2B38",
        cursor: "pointer",
      }}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

const ACL_COLORS: Record<string, string> = { Admin: "#8B5CF6", Manager: "#4B9CD3", User: "#6B7280" };

function AvatarMenu() {
  const [, setLocation] = useLocation();
  const { signOut, signIn, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<RolePersona>(() =>
    resolveActiveRole(user?.userRoles, user?.username),
  );
  const [activeJobTitle, setActiveJobTitle] = useState<string | null>(() =>
    getJobTitleOverride(user?.username),
  );
  const [hasOverride, setHasOverride] = useState<boolean>(
    () =>
      !!getJobTitleOverride(user?.username) || !!getRoleOverride(user?.username),
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => {
      setActiveRole(resolveActiveRole(user?.userRoles, user?.username));
      setActiveJobTitle(getJobTitleOverride(user?.username));
      setHasOverride(
        !!getJobTitleOverride(user?.username) ||
          !!getRoleOverride(user?.username),
      );
    };
    sync();
    window.addEventListener("rmone:roleOverrideChanged", sync);
    return () => window.removeEventListener("rmone:roleOverrideChanged", sync);
  }, [user?.userRoles, user?.username]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = (user?.displayName || user?.username || "U")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center rounded-full transition-transform hover:scale-105"
        style={{
          width: 32,
          height: 32,
          backgroundColor: BRAND_GREEN,
          color: "#FFFFFF",
          fontWeight: 700,
          fontSize: 12,
        }}
        aria-label="Account menu"
        data-testid="avatar-menu-button"
      >
        {initials}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 rounded-xl shadow-xl overflow-hidden"
          style={{
            width: 280,
            backgroundColor: SIDEBAR_BG,
            border: "1px solid rgba(255,255,255,0.10)",
            color: SIDEBAR_FG,
          }}
          data-testid="avatar-menu"
        >
          <div className="px-4 py-3 flex items-center gap-3" style={{ backgroundColor: HEADER_BG }}>
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[13px]"
              style={{ backgroundColor: BRAND_GREEN }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold truncate" style={{ color: SIDEBAR_FG }}>
                {user?.displayName || user?.username || "User"}
              </div>
              <div className="text-[11px] truncate" style={{ color: SIDEBAR_FG, opacity: 0.75 }}>
                {user?.username || ""}
              </div>
              <div className="text-[11px] truncate flex items-center gap-1 mt-0.5" style={{ color: SIDEBAR_FG, opacity: 0.55 }}>
                <span className="text-[9px] font-bold uppercase tracking-wider">Tenant</span>
                <span>{user?.tenant ?? "—"}</span>
              </div>
              {(() => {
                const lbl = user?.isAdmin ? "Admin" : user?.canEdit !== false ? "Manager" : "User";
                const c = ACL_COLORS[lbl] ?? "#6B7280";
                return (
                  <span style={{
                    display: "inline-flex", alignItems: "center", marginTop: 4,
                    padding: "1px 7px", borderRadius: 999,
                    backgroundColor: `${c}22`, border: `1px solid ${c}55`,
                    color: c, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                  }}>{lbl}</span>
                );
              })()}
            </div>
          </div>

          <div className="py-1">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors"
              style={{ color: SIDEBAR_FG }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <UserCircle className="h-4 w-4" />
              Profile
            </Link>
            <Link
              href="/daily-briefing"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors"
              style={{ color: SIDEBAR_FG }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              data-testid="avatar-menu-daily-briefing"
            >
              <Sunrise className="h-4 w-4" />
              Daily Briefing
            </Link>
            {/* Rate Card is surfaced under Configuration → Rate Card
                (/configuration/ratecard) and via the standalone /rate-card route,
                so it is intentionally not duplicated as a top-level avatar-menu
                link. Note: the inline grid can't pre-fill saved EmpCostRate values
                yet (no RM ONE GET endpoint) — current rates come through the Excel
                download instead. */}
          </div>

          {/* ── Demo-account switcher — only shown on test20 ── */}
          {user?.tenant === "test20" && (() => {
            const TEST20_ACCOUNTS = [
              { name: "Alex Rivera",   email: "alex.rivera@test20.local",   acl: "Admin"   },
              { name: "Morgan Chen",   email: "morgan.chen@test20.local",   acl: "Admin"   },
              { name: "Jordan Park",   email: "jordan.park@test20.local",   acl: "Admin"   },
              { name: "Taylor Brooks", email: "taylor.brooks@test20.local", acl: "Admin"   },
              { name: "Casey Walsh",   email: "casey.walsh@test20.local",   acl: "Manager" },
              { name: "Riley Nguyen",  email: "riley.nguyen@test20.local",  acl: "Manager" },
              { name: "Quinn Torres",  email: "quinn.torres@test20.local",  acl: "Manager" },
              { name: "Avery Kim",     email: "avery.kim@test20.local",     acl: "Manager" },
            ];
            const ACL_C: Record<string, string> = { Admin: "#f59e0b", Manager: "#3b82f6" };
            return (
              <div className="border-t max-h-[300px] overflow-y-auto" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <div className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Switch account
                </div>
                {TEST20_ACCOUNTS.map(a => {
                  const isCurrent = user?.username?.toLowerCase() === a.email.toLowerCase();
                  const isLoading = switching === a.email;
                  const initials = a.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                  const aclColor = ACL_C[a.acl] ?? "#6b7280";
                  return (
                    <button key={a.email} disabled={isCurrent || !!switching}
                      onClick={async () => {
                        if (isCurrent || switching) return;
                        setSwitching(a.email);
                        try { await signIn("test20", a.email, "RMOne@Test1"); setOpen(false); }
                        catch { /* stay on current account */ }
                        finally { setSwitching(null); }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-[12px] transition-colors text-left"
                      style={{
                        opacity: isCurrent ? 0.45 : switching && !isLoading ? 0.4 : 1,
                        cursor: isCurrent || !!switching ? "default" : "pointer",
                        color: SIDEBAR_FG,
                        background: "transparent",
                        border: "none",
                      }}
                      onMouseEnter={e => { if (!isCurrent && !switching) e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                      <span style={{ width: 26, height: 26, borderRadius: "50%", background: aclColor + "33", border: `1.5px solid ${aclColor}66`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: aclColor, flexShrink: 0 }}>
                        {isLoading ? "…" : initials}
                      </span>
                      <span className="flex-1 text-left">
                        <span style={{ display: "block", fontWeight: 600 }}>{a.name}</span>
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: aclColor + "22", color: aclColor }}>{a.acl}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* ── Test-account switcher — only shown on test21 ── */}
          {user?.tenant === "test21" && (() => {
            const TEST_ACCOUNTS = [
              { name: "Test Admin",   email: "test.admin@test21.local",   acl: "Admin" },
              { name: "Test Manager", email: "test.manager@test21.local", acl: "Manager" },
              { name: "Test User A",  email: "test.usera@test21.local",   acl: "User" },
              { name: "Test User B",  email: "test.userb@test21.local",   acl: "User" },
              { name: "Test Viewer",  email: "test.viewer@test21.local",  acl: "—" },
            ];
            const ACL_C: Record<string, string> = { Admin: "#f59e0b", Manager: "#3b82f6", User: "#22c55e" };
            return (
              <div className="border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <div className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Switch to test account
                </div>
                {TEST_ACCOUNTS.map(a => {
                  const isCurrent = user?.username?.toLowerCase() === a.email.toLowerCase();
                  const isLoading = switching === a.email;
                  const initials = a.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                  const aclColor = ACL_C[a.acl] ?? "#6b7280";
                  return (
                    <button key={a.email} disabled={isCurrent || !!switching}
                      onClick={async () => {
                        if (isCurrent || switching) return;
                        setSwitching(a.email);
                        try { await signIn("test21", a.email, "RMOne@Test1"); setOpen(false); }
                        catch { /* ignore — stays on current account */ }
                        finally { setSwitching(null); }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-[12px] transition-colors text-left"
                      style={{
                        opacity: isCurrent ? 0.45 : switching && !isLoading ? 0.4 : 1,
                        cursor: isCurrent || !!switching ? "default" : "pointer",
                        color: SIDEBAR_FG,
                        background: "transparent",
                        border: "none",
                      }}
                      onMouseEnter={e => { if (!isCurrent && !switching) e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                      <span style={{ width: 26, height: 26, borderRadius: "50%", background: aclColor + "33", border: `1.5px solid ${aclColor}66`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: aclColor, flexShrink: 0 }}>
                        {isLoading ? "…" : initials}
                      </span>
                      <span className="flex-1 text-left">
                        <span style={{ display: "block", fontWeight: 600 }}>{a.name}</span>
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: aclColor + "22", color: aclColor }}>{a.acl}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          <div className="border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <button
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors text-left"
              style={{ color: "#FCA5A5" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type NavItem = {
  /** Stable id from lib/navCatalog — the key persisted in nav-visibility configs (#88). */
  id: string;
  path: string;
  label: string;
  // Optional muted sublabel rendered after the label, e.g. "People (Resources)".
  sub?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;
  adminOnly?: boolean;
  importGated?: boolean;
  editorOnly?: boolean;
  allowedTenants?: string[];
  /** /projects entries: every ?view= this item covers (see lib/navCatalog). */
  matchViews?: string[];
  /** Extra pathnames this item fronts (tab-strip pages, see lib/navCatalog). */
  matchPaths?: string[];
  /** Rendered as an indented sub-item of this catalog id (see lib/navCatalog). */
  groupUnder?: string;
  navigationHidden?: boolean;
  defaultSurface?: NavSurface;
};

// Primary nav — ids, order, labels, routes and role flags live in
// lib/navCatalog.ts, shared with Settings → Navigation so the sidebar and the
// show/hide config can never drift apart (#88). Icons stay here (a rendering
// concern), chosen to be recognisable at a glance even when the sidebar is
// collapsed to icons only: BookUser = contact book (CRM), Handshake = deals
// (Leads & Opportunities), HardHat = construction work (Projects),
// Archive = closed/archived records (Archive), FileUp = file upload (Import).
// Data Cleaning AI Assistant stays hidden from nav (page still reachable at
// /data-cleaning if ever needed).
const NAV_ICONS: Record<string, NavItem["icon"]> = {
  home: House,
  ai: Bot,
  quickActions: Zap,
  manager: UsersRound,
  people: UsersRound,
  crm: BookUser,
  leads: Handshake,
  projects: HardHat,
  forecast: TrendingUp,
  actualsForecast: LineChart,
  reports: FileText,
  // Gauge, not Activity — keep Usage Analytics visually distinct from the
  // Analytics Center radar icon.
  usageAnalytics: Gauge,
  analytics: BarChart3,
  analyticsCenter: Radar,
  archive: Archive,
  alerts: BellRing,
  import: FileUp,
  offices: Building2,
  settings: Settings2,
  system: Activity,
};

const NAV_ITEMS: NavItem[] = NAV_DEFS.map((d) => ({
  id: d.id,
  path: d.path,
  label: d.label,
  sub: d.sub,
  icon: NAV_ICONS[d.id] ?? House,
  adminOnly: d.adminOnly,
  importGated: d.importGated,
  editorOnly: d.editorOnly,
  allowedTenants: d.allowedTenants,
  matchViews: d.matchViews,
  matchPaths: d.matchPaths,
  groupUnder: d.groupUnder,
  navigationHidden: d.navigationHidden,
  defaultSurface: d.defaultSurface,
}));

// True when the nav item points at the current location — shared matcher in
// lib/navCatalog (the hidden-page URL guard uses the same one, so "highlights
// in the menu" and "blocked when hidden" can never disagree).
function navItemIsActive(item: NavItem, location: string, search: string): boolean {
  return navDefMatches(item, location, search);
}

// Grouped sub-items (NavDef.groupUnder — e.g. Actuals vs Forecast under
// Analytics Center, #813) always render directly beneath their parent.
// Applied AFTER the admin-configured order so a saved order can never split
// a group. A child whose parent is filtered out (hidden, other tenant, role)
// keeps its own slot as a normal top-level item.
function regroupChildren(items: NavItem[]): NavItem[] {
  const ids = new Set(items.map((it) => it.id));
  const out: NavItem[] = [];
  for (const item of items) {
    if (item.groupUnder && ids.has(item.groupUnder)) continue; // emitted right after its parent below
    out.push(item);
    for (const child of items) {
      if (child.groupUnder === item.id) out.push(child);
    }
  }
  return out;
}

// Superadmin-only nav — replaces the full NAV_ITEMS list when the logged-in
// account is a superadmin. Hides all tenant-scoped pages; shows only the
// cross-company operator surfaces.
const SUPERADMIN_NAV_ITEMS: NavItem[] = [
  { id: "sa-dashboard",    path: "/superadmin",               label: "Dashboard",      icon: LayoutDashboard },
  { id: "sa-companies",    path: "/onboarding/history",       label: "Companies",      icon: Building2       },
  { id: "sa-new-company",  path: "/onboarding/new-company",   label: "New Company",    icon: PlusCircle      },
  { id: "sa-recycle-bin",  path: "/superadmin/recycle-bin",   label: "Recycle Bin",    icon: RotateCcw       },
  { id: "sa-settings",     path: "/configuration",            label: "Settings",       icon: Settings2       },
  { id: "sa-system",       path: "/system-health",            label: "System",         icon: Activity        },
];

const HEADER_BG = "var(--rm-chrome-header-bg)";
const SIDEBAR_BG = "var(--rm-chrome-bg)";
const SIDEBAR_BG_HOVER = "var(--rm-chrome-bg-hover)";
const SIDEBAR_BG_ACTIVE = "var(--rm-chrome-bg-active)";
const SIDEBAR_FG = "var(--rm-chrome-fg)";
const BRAND_GREEN = "#6BA539";

const COLLAPSE_KEY = "rmone-web:sidebarCollapsed";

function RmOneLogo({ size = 18 }: { size?: number }) {
  const { mode } = useTheme();
  return (
    <img
      src={`${import.meta.env.BASE_URL}${mode === "dark" ? "rm-one-logo.png" : "rm-one-logo-light.png"}`}
      alt="RM ONE"
      style={{ height: size, width: "auto", display: "block", objectFit: "contain" }}
    />
  );
}

function SidebarLogoutButton({ collapsed }: { collapsed: boolean }) {
  const { signOut } = useAuth();
  return (
    <button
      type="button"
      onClick={() => signOut()}
      title="Sign out"
      aria-label="Sign out"
      data-testid="sidebar-logout-button"
      className="flex items-center justify-center rounded-sm transition-colors"
      style={{
        height: collapsed ? 32 : 36,
        width: collapsed ? 32 : "100%",
        paddingLeft: collapsed ? 0 : 12,
        paddingRight: collapsed ? 0 : 12,
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 6,
        backgroundColor: "transparent",
        border: "1px solid var(--rm-panel-border)",
        color: SIDEBAR_FG,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      <LogOut className="h-3.5 w-3.5" />
      {!collapsed && <span>Sign out</span>}
    </button>
  );
}


function SidebarProfileFooter({ collapsed, capabilities }: { collapsed: boolean; capabilities: MyCapabilities | null }) {
  const { signOut, user } = useAuth();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const initials = (user?.displayName || user?.username || "U")
    .split(/[\s._@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join("") || "U";

  const displayName = user?.displayName || user?.username || "User";
  const email       = user?.username ?? "";
  const tenant      = user?.tenant ?? "";
  // Show the LIVE access-level identity, not an inference from legacy edit
  // booleans. An editable custom level used to be mislabeled "Manager" here
  // even though the server correctly resolved it as custom:<id>.
  const accessLabel = capabilities
    ? capabilities.source === "custom"
      ? (capabilities.levelName || "Custom")
      : capabilities.acl === "admin" || capabilities.acl === "administrator" || capabilities.acl === "unset"
        ? "Admin"
        : capabilities.acl === "manager"
          ? "Manager"
          : "User"
    : user?.isAdmin ? "Admin" : user?.canEdit !== false ? "Manager" : "User";

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {open && (
        <div
          className="absolute bottom-full mb-1 z-50 rounded-xl shadow-2xl overflow-hidden"
          style={{
            width: 240,
            left: 0,
            backgroundColor: SIDEBAR_BG,
            border: "1px solid rgba(255,255,255,0.10)",
            color: SIDEBAR_FG,
          }}
        >
          {/* Profile header — initials + email + tenant */}
          <div className="px-4 py-3 flex items-center gap-3" style={{ backgroundColor: HEADER_BG }}>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-[12px] shrink-0"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold truncate" style={{ color: SIDEBAR_FG }}>{displayName}</div>
              {email && <div className="text-[11px] truncate" style={{ color: SIDEBAR_FG, opacity: 0.75 }}>{email}</div>}
              {tenant && <div className="text-[11px] truncate mt-0.5 flex items-center gap-1" style={{ color: SIDEBAR_FG, opacity: 0.55 }}>
                <span className="text-[9px] font-bold uppercase tracking-wider">Tenant</span>
                <span>{tenant}</span>
              </div>}
              {accessLabel && (() => {
                const c = ACL_COLORS[accessLabel] ?? "#6B7280";
                return (
                  <span style={{
                    display: "inline-flex", alignItems: "center", marginTop: 4,
                    padding: "1px 7px", borderRadius: 999,
                    backgroundColor: `${c}22`, border: `1px solid ${c}55`,
                    color: c, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                  }}>{accessLabel}</span>
                );
              })()}
            </div>
          </div>

          {/* Actions */}
          <div className="py-1">
            <button
              onClick={() => { setOpen(false); setLocation("/profile"); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors text-left"
              style={{ color: SIDEBAR_FG }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <UserCircle className="h-4 w-4" />
              View profile
            </button>
          </div>

          <div className="border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <button
              onClick={() => { setOpen(false); signOut(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors text-left"
              style={{ color: "#FCA5A5" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Clickable profile footer — avatar + name when expanded */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Your profile"
        aria-label="Profile"
        className="w-full flex items-center transition-colors"
        style={{
          height: 48,
          backgroundColor: open ? SIDEBAR_BG_HOVER : HEADER_BG,
          borderTop: "1px solid rgba(0,0,0,0.2)",
          cursor: "pointer",
          border: "none",
          borderTopWidth: 1,
          borderTopStyle: "solid",
          borderTopColor: "rgba(0,0,0,0.2)",
          paddingLeft: collapsed ? 0 : 10,
          paddingRight: collapsed ? 0 : 10,
          justifyContent: collapsed ? "center" : "flex-start",
          gap: 10,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER)}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = open ? SIDEBAR_BG_HOVER : HEADER_BG)}
      >
        <div
          className="rounded-full flex items-center justify-center font-bold shrink-0"
          style={{
            width: collapsed ? 28 : 32,
            height: collapsed ? 28 : 32,
            backgroundColor: BRAND_GREEN,
            color: "#fff",
            fontSize: collapsed ? 10 : 12,
          }}
        >
          {initials}
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0 text-left">
            <div className="text-[12px] font-semibold truncate" style={{ color: SIDEBAR_FG }}>
              {displayName}
            </div>
            {tenant && (
              <div className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.45)" }}>
                {tenant}
              </div>
            )}
          </div>
        )}
      </button>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { user } = useAuth();
  // Undefined = grandfathered (no access level set) → treated as admin so
  // existing users don't lose access to Configuration/System pages.
  const isAdmin = user?.isAdmin !== false;
  // canEdit=false → role "user" (read-only). Undefined/null grandfathered as editable.
  const canEdit = !user || user.canEdit !== false;
  const superAdmin = isSuperAdmin(user?.username, user?.tenant);

  // Setup gate: same query as SetupGate in App.tsx — React Query deduplicates
  // the network call. When an admin has no uploads yet, only show Configuration.
  const { data: gateData } = useQuery({
    queryKey: ["setup-gate-history"],
    queryFn: async () => {
      const res = await fetch("/api/onboarding/history", { headers: authHeaders() as Record<string, string> });
      if (!res.ok) return { jobs: [] };
      return res.json() as Promise<{ jobs: { status: string }[] }>;
    },
    enabled: isAdmin && !superAdmin,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const setupRequired =
    isAdmin &&
    !superAdmin &&
    gateData !== undefined &&
    !gateData.jobs?.some((j: { status: string }) => j.status === "success" || j.status === "partial");

  // ── Navigation visibility + order + labels (#88, #90) ───────────────────
  // Menu config for THIS user resolved server-side (group membership + admin
  // protection applied there — the web never re-derives them). null until the
  // first answer arrives so nothing flashes or redirects on stale data.
  // Refreshes on every route change (cheap — 60s client cache) and instantly
  // when an admin saves Settings → Navigation in this tab. Fails OPEN to the
  // full menu; page data stays behind the server's #87 gates regardless.
  const [hiddenNav, setHiddenNav] = useState<Set<string> | null>(null);
  const [navOrder, setNavOrder] = useState<string[]>([]);
  const [navLabels, setNavLabels] = useState<Record<string, string>>({});
  const [navSurfaces, setNavSurfaces] = useState<Record<string, NavSurface>>({});
  // canImport from capabilities (admin-controlled which levels see Import page).
  const [myCaps, setMyCaps] = useState<MyCapabilities | null>(null);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    getMyCapabilities().then(c => { if (alive) setMyCaps(c); }).catch(() => {});
    return () => { alive = false; };
  }, [user]);
  useEffect(() => {
    const onPerms = () => {
      getMyCapabilities().then(c => setMyCaps(c)).catch(() => {});
      getMyNavigation({ fresh: true }).then(applyMyNav).catch(() => {});
    };
    window.addEventListener("rmone:permissionsChanged", onPerms);
    return () => window.removeEventListener("rmone:permissionsChanged", onPerms);
  }, []);

  const applyMyNav = (nav: {
    hidden: string[];
    order: string[];
    labels: Record<string, string>;
    surfaces: Record<string, NavSurface>;
  }) => {
    setHiddenNav((prev) =>
      prev && prev.size === nav.hidden.length && nav.hidden.every((id) => prev.has(id))
        ? prev : new Set(nav.hidden),
    );
    setNavOrder(nav.order);
    setNavLabels(nav.labels);
    setNavSurfaces(nav.surfaces);
  };

  useEffect(() => {
    if (superAdmin || !user) return;
    let alive = true;
    getMyNavigation({ fresh: true })
      .then((nav) => { if (alive) applyMyNav(nav); })
      .catch(() => { /* fail open — keep whatever we knew */ });
    return () => { alive = false; };
  }, [superAdmin, user, location]);
  useEffect(() => {
    if (superAdmin || !user) return;
    const refresh = () => { getMyNavigation({ fresh: true }).then(applyMyNav).catch(() => {}); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [superAdmin, user]);
  useEffect(() => {
    const onChanged = () => {
      getMyNavigation({ fresh: true }).then(applyMyNav).catch(() => {});
    };
    window.addEventListener("rmone:navChanged", onChanged);
    return () => window.removeEventListener("rmone:navChanged", onChanged);
  }, []);
  // Typing a hidden or tenant-unavailable page's address goes back to Home
  // instead. Record-detail pages (e.g. /project/:id) are deliberately
  // unaffected — hiding a MENU item hides its list page, not the records, so
  // cross-links from Home/AI keep working. During the setup gate the nav is
  // already forced to Import + Settings, so the guard stays out of the way.
  useEffect(() => {
    if (superAdmin || setupRequired || !user) return;
    const tenantUnavailable = NAV_DEFS.some((d) =>
      (d.navigationHidden
       || (d.allowedTenants !== undefined
         && !tenantMatchesAllowlist(user.tenant, d.allowedTenants)))
      && navDefMatches(d, location, search));
    const configHidden = !!hiddenNav && NAV_DEFS.some((d) =>
      hiddenNav.has(d.id) && navDefMatches(d, location, search));
    // Settings is a capability-protected page, not just an admin-looking menu
    // item. Do not redirect until the server has answered, so an Admin does not
    // bounce during the initial capabilities request.
    const settingsDenied = myCaps !== null && location.startsWith("/onboarding-settings") && myCaps.canSettings !== true;
    const blocked = tenantUnavailable || configHidden || settingsDenied;
    if (blocked) setLocation("/", { replace: true });
  }, [superAdmin, setupRequired, user, hiddenNav, location, search, setLocation]);

  // ONE visible-items computation for the desktop sidebar AND the mobile
  // drawer (the drawer previously skipped the role filters — same list now).
  // Apply admin order + custom labels on top of visibility filtering (#90).
  const visibleNavItems = (() => {
    if (superAdmin) return SUPERADMIN_NAV_ITEMS;
    const filtered = NAV_ITEMS.filter((item) => {
      if (setupRequired) return item.id === "import" || item.id === "settings";
      if (item.navigationHidden) return false;
      // Tenant allowlists are product-level policy and therefore apply before
      // role-specific visibility. Admin-only pages must not bypass them.
      if (!tenantMatchesAllowlist(user?.tenant, item.allowedTenants)) return false;
      if (item.id === "settings") return myCaps?.canSettings === true;
      if (item.adminOnly) return isAdmin;
      if (item.importGated) return !!(myCaps?.canImport);
      if (item.editorOnly && !canEdit) return false;
      if (hiddenNav?.has(item.id)) return false;
      return true;
    });
    // Apply custom order if set (items not in navOrder keep their catalog position at the end).
    const ordered = navOrder.length > 0
      ? [...filtered].sort((a, b) => {
          const ai = navOrder.indexOf(a.id);
          const bi = navOrder.indexOf(b.id);
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        })
      : filtered;
    // Apply custom labels (#90) — page titles / internal ids stay canonical.
    const labeled = ordered.map((item) =>
      navLabels[item.id] ? { ...item, label: navLabels[item.id] } : item,
    );
    // Snap grouped sub-items back under their parent (#813).
    return regroupChildren(labeled);
  })();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Collapsed (icons-only) by default; the user's explicit choice is
  // remembered in localStorage and wins on subsequent visits.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      return stored === null ? true : stored === "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    const handler = () => setCollapsed(true);
    window.addEventListener("rmone:gridViewActivated", handler);
    return () => window.removeEventListener("rmone:gridViewActivated", handler);
  }, []);

  const closeMenu = () => setIsMobileMenuOpen(false);
  const sidebarWidth = collapsed ? 56 : 220;

  // Admins can place each item in the horizontal top bar or vertical sidebar.
  // Missing saved values preserve the catalog defaults.
  const surfaceOf = (item: NavItem): NavSurface =>
    navSurfaces[item.id] ?? item.defaultSurface ?? "vertical";
  const topBarItems = visibleNavItems.filter((item) => surfaceOf(item) === "horizontal");
  const sidebarItems = visibleNavItems.filter((item) => surfaceOf(item) === "vertical");
  // A grouped sub-item indents only when its parent renders in the same list.
  const sidebarIdSet = new Set(sidebarItems.map((item) => item.id));
  const drawerIdSet = new Set(visibleNavItems.map((item) => item.id));

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-background overflow-hidden">

      {/* ── Desktop-only full-width top nav bar ── */}
      <div
        className="hidden md:flex items-center shrink-0 z-40 relative"
        style={{
          height: 48,
          backgroundColor: HEADER_BG,
          borderBottom: "1px solid var(--rm-topbar-border)",
          boxShadow: "0 1px 0 rgba(0,0,0,0.18), 0 2px 10px rgba(0,0,0,0.10)",
        }}
      >
        {/* Logo area — width tracks sidebar so it aligns with the panel below */}
        <div
          className="flex items-center shrink-0 px-3 overflow-hidden transition-[width] duration-200 ease-out"
          style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        >
          <Link
            href="/"
            aria-label="Go to RM ONE home"
            title="RM ONE home"
            className="rm-topbar-brand flex items-center gap-2.5 w-full overflow-hidden"
            style={{
              height: 36,
              justifyContent: collapsed ? "center" : "flex-start",
              padding: collapsed ? 0 : "0 10px",
              borderRadius: 9999,
              backgroundColor: "var(--rm-topbar-brand-bg)",
              border: "1px solid var(--rm-topbar-brand-border)",
              boxShadow: "var(--rm-topbar-brand-shadow)",
              color: "var(--rm-chrome-fg)",
              textDecoration: "none",
              transition: "background-color 150ms, border-color 150ms, box-shadow 150ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--rm-topbar-brand-hover-bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--rm-topbar-brand-bg)";
            }}
          >
            {/* App icon mark — always rendered even when the sidebar is collapsed */}
            {collapsed && <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "linear-gradient(140deg,#7EC044 0%,#4E7F27 100%)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 1px 6px rgba(107,165,57,0.50), inset 0 1px 0 rgba(255,255,255,0.20)",
                flexShrink: 0,
              }}
            >
              <span style={{ color: "#fff", fontWeight: 900, fontSize: 9, letterSpacing: "-0.03em", lineHeight: 1, userSelect: "none" }}>
                RM
              </span>
            </span>}
            {!collapsed && <RmOneLogo size={15} />}
          </Link>
        </div>

        {/* Vertical divider */}
        <div style={{ width: 1, height: 26, backgroundColor: "var(--rm-topbar-divider)", flexShrink: 0 }} />

        {/* Feature shortcuts — absolutely centred in the bar so they sit in
            the visual middle of the full viewport width regardless of sidebar
            or right-button widths. Modules live in the sidebar (#813); this
            row is reserved for Quick Actions + client-specific shortcuts.   */}
        <nav
          className="absolute left-1/2 -translate-x-1/2 flex items-center h-full"
          aria-label="Feature shortcuts"
          style={{ maxWidth: "calc(100% - 360px)", overflowX: "auto", padding: "0 4px" }}
        >
          {topBarItems.length === 0 ? (
            <span
              className="flex items-center px-4 text-[12px] italic"
              style={{ color: "var(--rm-topbar-tab-empty)" }}
            >
              No shortcuts enabled
            </span>
          ) : (
            topBarItems.map((item) => {
              const isActive = navItemIsActive(item, location, search);
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={item.path}
                  onClick={() => setCollapsed(true)}
                  className={`rm-topbar-tab flex items-center gap-2 px-5 whitespace-nowrap ${isActive ? "rm-topbar-tab--active" : ""}`}
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 700 : 600,
                    color: isActive ? BRAND_GREEN : "var(--rm-topbar-tab-inactive)",
                    backgroundColor: isActive ? "var(--rm-topbar-tab-active-bg)" : "transparent",
                    border: `1px solid ${isActive ? "var(--rm-topbar-tab-active-border)" : "transparent"}`,
                    borderRadius: 9999,
                    height: 36,
                    boxShadow: isActive ? "var(--rm-topbar-tab-active-shadow)" : "none",
                    transition: "color 150ms, background-color 150ms, border-color 150ms, box-shadow 150ms",
                    textDecoration: "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = "var(--rm-topbar-tab-hover-bg)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 26, height: 26, flexShrink: 0,
                     borderRadius: "50%",
                    backgroundColor: isActive ? BRAND_GREEN : "rgba(120,120,120,0.13)",
                    boxShadow: isActive ? "0 2px 8px rgba(107,165,57,0.32)" : "none",
                  }}>
                    <Icon
                      className="rm-topbar-tab-icon shrink-0"
                      strokeWidth={isActive ? 2.5 : 2}
                      style={{ width: 14, height: 14, color: isActive ? "#FFFFFF" : undefined }}
                    />
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })
          )}
        </nav>

        {/* Flex spacer — pushes right controls to the edge without disturbing
            the absolutely-positioned centred tabs.                            */}
        <div className="flex-1" />

        {/* Right: theme toggle + avatar (always visible, all pages) */}
        <div className="flex items-center gap-2 px-3 shrink-0">
          <ThemeToggle />
          <AvatarMenu />
        </div>
      </div>

      {/* ── Body row: sidebar + main content ── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* Desktop sidebar */}
        <aside
          className="hidden md:flex flex-col h-full transition-[width] duration-200 ease-out shrink-0"
          style={{
            width: sidebarWidth,
            backgroundColor: SIDEBAR_BG,
            color: SIDEBAR_FG,
          }}
        >
          {/* Collapse toggle — logo no longer here (it lives in the top bar) */}
          <div
            className="flex"
            style={{
              justifyContent: collapsed ? "center" : "flex-start",
              padding: collapsed ? "8px 0" : "8px 8px",
            }}
          >
            <button
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="flex items-center justify-center rounded-sm transition-colors"
              style={{
                width: 32,
                height: 28,
                backgroundColor: "transparent",
                border: "1px solid var(--rm-panel-border)",
                color: SIDEBAR_FG,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </button>
          </div>

          <nav
            className="flex-1 overflow-y-auto flex flex-col"
            style={{ padding: collapsed ? "10px 6px" : "10px 8px", gap: 6 }}
          >
            {sidebarItems.map((item) => {
              const isActive = navItemIsActive(item, location, search);
              const Icon = item.icon;
              // Grouped sub-item (e.g. Actuals vs Forecast under Analytics
              // Center) — indented + slightly smaller when the sidebar is
              // expanded; icons-only mode conveys the group by adjacency.
              const isSub = !!item.groupUnder && sidebarIdSet.has(item.groupUnder);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  title={collapsed ? (item.sub ? `${item.label} (${item.sub})` : item.label) : undefined}
                  className="flex items-center transition-colors relative"
                  style={{
                    minHeight: isSub ? 38 : 44,
                    paddingTop: 4,
                    paddingBottom: 4,
                    borderRadius: 8,
                    paddingLeft: collapsed ? 0 : isSub ? 30 : 12,
                    paddingRight: collapsed ? 0 : 8,
                    justifyContent: collapsed ? "center" : "flex-start",
                    gap: collapsed ? 0 : 12,
                    backgroundColor: isActive ? SIDEBAR_BG_ACTIVE : "transparent",
                    color: isActive ? BRAND_GREEN : SIDEBAR_FG,
                    fontWeight: isActive ? 700 : 500,
                    overflow: "hidden",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = SIDEBAR_BG_HOVER;
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  {isActive && (
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: 0, top: 8, bottom: 8,
                        width: 3, borderRadius: 2,
                        backgroundColor: BRAND_GREEN,
                      }}
                    />
                  )}
                  <Icon
                    className="shrink-0"
                    strokeWidth={isActive ? 2.5 : 2}
                    style={{ width: isSub ? 18 : 22, height: isSub ? 18 : 22 }}
                  />
                  {!collapsed && (
                    <span className="flex-1 min-w-0">
                      <span
                        className="block truncate text-[13px]"
                        style={{ lineHeight: 1.2 }}
                      >
                        {item.label}
                      </span>
                      {item.sub && (
                        <span
                          className="block truncate"
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            opacity: 0.5,
                            lineHeight: 1.3,
                            marginTop: 1,
                            letterSpacing: "0.01em",
                          }}
                        >
                          {item.sub}
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Sign out — anchored at the bottom of the sidebar */}
          <div
            style={{
              padding: collapsed ? "8px 6px" : "8px 8px",
              display: "flex",
              justifyContent: collapsed ? "center" : "stretch",
            }}
          >
            <SidebarLogoutButton collapsed={collapsed} />
          </div>

          <SidebarProfileFooter collapsed={collapsed} capabilities={myCaps} />
        </aside>

        {/* Mobile top header (unchanged) */}
        <div className="md:hidden flex flex-col w-full absolute inset-x-0 top-0 z-40">
          <header
            className="h-12 flex items-center justify-between px-3 shrink-0"
            style={{ backgroundColor: HEADER_BG, color: SIDEBAR_FG }}
          >
            <div className="flex items-center gap-2">
              <RmOneLogo size={15} />
            </div>
            <div className="flex items-center gap-2">
              {location === "/" && (
                <>
                  <ThemeToggle />
                  <AvatarMenu />
                </>
              )}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 -mr-2"
                style={{ color: SIDEBAR_FG }}
              >
                {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </header>

          {isMobileMenuOpen && (
            <div
              className="absolute inset-x-0 top-12 z-50 flex flex-col"
              style={{
                backgroundColor: SIDEBAR_BG,
                color: SIDEBAR_FG,
                height: "calc(100dvh - 48px)",
              }}
            >
              <nav className="flex-1 p-2 overflow-y-auto">
                {visibleNavItems.map((item) => {
                  const isActive = navItemIsActive(item, location, search);
                  const Icon = item.icon;
                  const isSub = !!item.groupUnder && drawerIdSet.has(item.groupUnder);
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      onClick={closeMenu}
                      className="flex items-center gap-3 px-4 py-3"
                      style={{
                        backgroundColor: isActive ? SIDEBAR_BG_ACTIVE : "transparent",
                        color: isActive ? BRAND_GREEN : SIDEBAR_FG,
                        paddingLeft: isSub ? 34 : undefined,
                      }}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{item.label}</span>
                        {item.sub && (
                          <span
                            className="block truncate"
                            style={{ fontSize: 11, fontWeight: 500, opacity: 0.5 }}
                          >
                            {item.sub}
                          </span>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          )}
        </div>

        {/* Main content */}
        <main
          className="flex-1 flex flex-col overflow-auto relative pt-12 md:pt-0"
          style={{ backgroundColor: "var(--rm-bg)" }}
        >
          {children}
        </main>

      </div>{/* end body row */}

      {/* Global ⌘K command palette */}
      <CommandPalette />
    </div>
  );
}
