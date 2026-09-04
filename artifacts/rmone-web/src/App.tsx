import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getModuleRecords, getResourceDemands, getResourceAllocations, getResourceMaster, getAllocationUtilization, getDivisions, getDepartments, getBusinessUnits, getUsers, authHeaders, activeImportKey, importResultKey, bustCache, IN_WIZARD_RUN_FLAG } from "@/lib/api";
import { sumUpdatedRows } from "@/lib/importSteps";
import { computeForecastWindow } from "@/lib/forecastIntelligence";
import { defaultUtilQuery } from "@/lib/quarters";
import ForecastTabs from "@/components/ForecastTabs";
import { warmOverlayCache } from "@/lib/overlayCache";
import { loadBusinessRules } from "@/lib/businessRules";
import { ROLE_HOME_DATA, type WindowKey } from "@/lib/roleHomeData";
import { resolveActiveRole, isSuperAdmin } from "@/lib/roleResolver";
import { Toaster } from "@/components/ui/toaster";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { useAuth } from "@/lib/useAuth";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import SetPasswordPage from "@/pages/set-password";
import { SplashScreen } from "@/components/SplashScreen";
import AppShell from "@/pages/app-shell";
import { RoleHome } from "@/components/RoleHome";
import { CommandCentreLoader, RmOneProcessing } from "@/components/CommandCentreLoader";
import { UsageBeaconTracker } from "@/lib/usageBeacon";
import { NewVersionBanner } from "@/components/NewVersionBanner";
import { lazyWithReload } from "@/lib/lazyReload";

// ── Route-level code splitting ──────────────────────────────────────────────
// Every page below is its own build chunk, fetched on first visit, instead of
// shipping inside the startup bundle. The eager imports above (login, shell,
// splash, RoleHome) are everything the first paint after login actually needs
// — this is most of the "slow first load" fix for the hosted environments.
//
// lazyPage() adds a stale-build guard: hashed chunk files from the PREVIOUS
// build disappear from the server after a redeploy, so a tab still running
// the old index.html would throw on its next navigation. Reload once (loop-
// guarded) to pick up the fresh build instead of showing a broken page; the
// NewVersionBanner handles the polite prompt path, this handles the hard one.
function lazyPage<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) {
  // Delegates to the shared fail-closed guard (lib/lazyReload): reload at most
  // once per guard window, and ONLY after the guard timestamp was persisted —
  // if sessionStorage is unavailable it shows the new-version banner instead
  // of reloading, so a chunk failure can never hard-loop the tab.
  return lazyWithReload(loader);
}

const DailyBriefingPage   = lazyPage(() => import("@/pages/daily-briefing"));
const AnalyticsPage       = lazyPage(() => import("@/pages/analytics"));
const AnalyticsCenterPage = lazyPage(() => import("@/pages/analytics-center"));
const AnalyticsCenterSectionPage = lazyPage(() =>
  import("@/pages/analytics-center").then((m) => ({ default: m.AnalyticsCenterSectionPage })),
);
const AnalyticsUsagePage  = lazyPage(() => import("@/pages/analytics-usage"));
const ActualsForecastPage = lazyPage(() => import("@/pages/actuals-forecast"));
const ForecastReportPage  = lazyPage(() => import("@/pages/forecast-report"));
const ExecutiveForecastPage = lazyPage(() => import("@/pages/executive-forecast"));
const ActualsImportPage   = lazyPage(() => import("@/pages/actuals-import"));
const ProjectsPage        = lazyPage(() => import("@/pages/projects"));
const ResourcesPage       = lazyPage(() => import("@/pages/resources"));
const ManagerPage         = lazyPage(() => import("@/pages/resources").then((m) => ({ default: m.ManagerPage })));
const QuickActionsPage    = lazyPage(() => import("@/pages/quick-actions"));
const ChatPage            = lazyPage(() => import("@/pages/chat"));
const IntelligenceHubPage = lazyPage(() => import("@/pages/intelligence"));
const ReportsHubPage      = lazyPage(() => import("@/pages/reports"));
const ReportModulePage    = lazyPage(() =>
  import("@/pages/reports").then((m) => ({ default: m.ReportModulePage })),
);
const ForecastPage        = lazyPage(() => import("@/pages/forecast"));
const ProfilePage         = lazyPage(() => import("@/pages/profile"));
const AlertsPage          = lazyPage(() => import("@/pages/alerts"));
const ProjectDetailPage   = lazyPage(() => import("@/pages/project-detail"));
const ProjectCreatePage   = lazyPage(() => import("@/pages/project-create"));
const OpportunityCreatePage = lazyPage(() => import("@/pages/opportunity-create"));
const LeadCreatePage      = lazyPage(() => import("@/pages/lead-create"));
const StaffCreatePage     = lazyPage(() => import("@/pages/staff-create"));
const RateCardPage        = lazyPage(() => import("@/pages/rate-card"));
const BillingRatesPage    = lazyPage(() => import("@/pages/billing-rates"));
const SystemHealthPage    = lazyPage(() => import("@/pages/system-health"));
const ConfigurationPage   = lazyPage(() => import("@/pages/configuration"));
const ImportDataPage      = lazyPage(() => import("@/pages/import"));
const DataCleaningPage    = lazyPage(() => import("@/pages/data-cleaning"));
const OnboardingStatusPage    = lazyPage(() => import("@/pages/onboarding-status"));
const OnboardingHistoryPage   = lazyPage(() => import("@/pages/onboarding-history"));
const OnboardingSettingsPage  = lazyPage(() => import("@/pages/onboarding-settings"));
const OnboardingReadinessPage = lazyPage(() => import("@/pages/onboarding-readiness"));
const OnboardingSynonymsPage  = lazyPage(() => import("@/pages/onboarding-synonyms"));
const ProvisionTenantPage     = lazyPage(() => import("@/pages/onboarding-new-company"));
const SuperadminDashboard     = lazyPage(() => import("@/pages/superadmin-dashboard"));
const SuperadminRecycleBinPage = lazyPage(() => import("@/pages/superadmin-recycle-bin"));

/** Shown while a route chunk downloads. Default renders inside the app-shell
 *  content area; `full` covers the viewport on the dark app background (the
 *  full-screen briefing routes render outside the shell). Matches the boot
 *  spinner used while /api/auth/me resolves, so chunk loads read as the same
 *  brief "app is getting ready" moment rather than a new kind of screen. */
function RouteLoadingFallback({ full = false }: { full?: boolean }) {
  if (full) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="min-h-screen flex flex-col items-center justify-center gap-3.5"
        style={{ backgroundColor: "#253746", color: "#9aa4ad" }}
      >
        <div
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "3px solid rgba(169,194,63,0.25)",
            borderTopColor: "#A9C23F",
            animation: "rmone-boot-spin 0.9s linear infinite",
            // Promote to its own compositor layer so the spin keeps
            // animating even while the main thread is busy parsing a
            // just-downloaded page chunk (otherwise it looks frozen).
            willChange: "transform",
          }}
        />
        <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
          RM ONE · loading
        </div>
      </div>
    );
  }
  // In-shell variant: the same card-style processing popup the data-heavy
  // pages use (project detail, billing rates, …) so opening a page looks
  // identical to loading its data — one loading language app-wide. The
  // card's motion (pulse rings, sweep bar) is transform-based, so it stays
  // live on the compositor even while the chunk is being parsed.
  return (
    <div style={{ minHeight: "40vh" }}>
      <RmOneProcessing
        label="Opening page…"
        sublabel="LOADING PAGE MODULES"
        stages={["Downloading page modules", "Preparing interface", "Rendering page"]}
        stageIntervalMs={550}
        light
      />
    </div>
  );
}

const POLL_INTERVAL      = 4_000; // 4 s — responsive without spamming

interface ImportResult {
  uploadId:      string;
  status:        string;
  fileName?:     string;
  /** NEW data rows inserted from the file (setup/seed writes excluded). */
  totalInserted: number;
  /** Existing records updated in place (update-mode data work). */
  totalUpdated:  number;
  totalErrors:   number;
}

/**
 * Sits silently in the background. Tracks any in-flight import and shows a
 * completion modal (not just a toast) wherever the user is when it finishes.
 *
 * Two sources:
 *  1. rmone_active_import  — uploadId for jobs still running; we poll.
 *  2. rmone_import_result  — JSON result written by the status page when the
 *     job finishes there; lets us notify the user after they navigate away.
 */
function ImportCompletionWatcher() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const firedRef  = useRef<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  // When a successful/partial import completes, immediately invalidate the
  // sidebar gate query and all data caches so:
  //  1. The full nav (Projects, Opportunities, etc.) appears without a manual refresh.
  //  2. The new pages load with fresh data rather than empty caches.
  useEffect(() => {
    if (!result) return;
    const ok = result.status === "success" || result.status === "partial";
    if (!ok) return;
    // Full refresh: clear the api.ts request cache (in-memory + persisted) and
    // invalidate ALL React Query caches. An import can touch any module —
// Projects, Opportunities, Leads, Staff, Billing Rates, Organization — and
    // Forecast / Alerts / Home all derive from the same data, so a targeted
    // list always under-refreshes. Mounted pages refetch immediately; others
    // refetch on their next visit — no hard refresh needed.
    bustCache();
    void qc.invalidateQueries();
  }, [result, qc]);

  // Stale-flag recovery: the in-wizard flag is only meaningful while an
  // ImportRunPanel is actually mounted, and its unmount cleanup never runs on
  // a hard refresh or tab close — clear whatever survived the reload so this
  // tab's completion watcher is never permanently silenced. (On a real page
  // load no panel is mounted yet — the wizard's run state doesn't survive a
  // refresh — so anything found here is stale by definition.)
  useEffect(() => {
    try { sessionStorage.removeItem(IN_WIZARD_RUN_FLAG); } catch { /* ignore */ }
  }, []);

  // ── Check for a result left by the status page ───────────────────────────
  useEffect(() => {
    if (location.startsWith("/onboarding/status")) return;
    try {
      const raw = localStorage.getItem(importResultKey());
      if (!raw) return;
      const r: ImportResult = JSON.parse(raw);
      if (r?.uploadId && firedRef.current !== r.uploadId) {
        firedRef.current = r.uploadId;
        localStorage.removeItem(importResultKey());
        // Cancelled imports are always user-initiated — no popup needed.
        if (r.status !== "cancelled") setResult(r);
      }
    } catch { /* malformed — ignore */ }
  }, [location]);

  // ── Poll an in-flight job ─────────────────────────────────────────────────
  useEffect(() => {
    if (location.startsWith("/onboarding/status")) return;

    let uploadId: string | null = null;
    try { uploadId = localStorage.getItem(activeImportKey()); } catch { /* ignore */ }
    if (!uploadId) return;
    if (firedRef.current === uploadId) return;

    let cancelled = false;
    const id = uploadId;

    const poll = async () => {
      // The import page's in-wizard "Processing" step is showing THIS run
      // live — it owns the completion UX (and busts caches itself), so the
      // global "finished" dialog would double-notify right on top of it.
      // Upload-scoped on purpose: a leftover flag from some other run must
      // never silence the watcher for this one.
      try { if (sessionStorage.getItem(IN_WIZARD_RUN_FLAG) === id) return; } catch { /* ignore */ }
      try {
        const res = await fetch(`/api/onboarding/status/${encodeURIComponent(id)}`, {
          headers: authHeaders() as Record<string, string>,
        });
        if (res.status === 404) {
          // The job no longer exists (e.g. deleted from import history) — drop
          // the marker or this watcher polls a dead id forever and the import
          // page keeps seeding a phantom "running" banner from localStorage.
          try { localStorage.removeItem(activeImportKey()); } catch { /* ignore */ }
          return;
        }
        if (!res.ok) return;
        const data: ImportResult & { status: string } = await res.json();
        const { status } = data;
        if (status === "success" || status === "partial" || status === "failed" || status === "cancelled") {
          if (!cancelled && firedRef.current !== id) {
            firedRef.current = id;
            try { localStorage.removeItem(activeImportKey()); } catch { /* ignore */ }
            // A cancel is always something the user did on purpose — silently
            // stop tracking instead of chasing them with a late popup.
            if (status !== "cancelled") {
              setResult({
                uploadId: id, status, fileName: data.fileName,
                totalInserted: data.totalInserted ?? 0,
                // Update-mode runs can be all updates + 0 inserts — count that
                // as real data work so the dialog never claims "setup only".
                totalUpdated: sumUpdatedRows((data as { steps?: Parameters<typeof sumUpdatedRows>[0] }).steps ?? []),
                totalErrors: data.totalErrors ?? 0,
              });
            }
          }
        }
      } catch { /* network error — retry next tick */ }
    };

    void poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    return () => { cancelled = true; clearInterval(timer); };
  }, [location]);

  if (!result) return null;

  const ok      = result.status === "success" || result.status === "partial";
  const partial = result.status === "partial";
  const cancelled = result.status === "cancelled";

  return (
    <Dialog open onOpenChange={() => setResult(null)}>
      <DialogContent style={{
        backgroundColor: "#1a2332", border: "1px solid #2a3a4a", borderRadius: 16,
        maxWidth: 420, padding: 0, overflow: "hidden",
      }}>
        {/* coloured top band */}
        <div style={{
          padding: "28px 28px 20px",
          background: ok
            ? "linear-gradient(135deg,rgba(107,165,57,0.15),rgba(107,165,57,0.05))"
            : "linear-gradient(135deg,rgba(239,68,68,0.15),rgba(239,68,68,0.05))",
          borderBottom: "1px solid #2a3a4a",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            {ok
              ? (partial
                  ? <AlertTriangle size={28} color="#E87722" />
                  : <CheckCircle2 size={28} color="#6BA539" />)
              : <XCircle size={28} color="#ef4444" />}
            <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>
              {ok
                ? (partial ? "Import completed with warnings" : "Import successful")
                : (cancelled ? "Import cancelled" : "Import failed")}
            </span>
          </div>
          {result.fileName && (
            <p style={{ fontSize: 13, color: "#94a3b8", margin: 0, paddingLeft: 40 }}>
              {result.fileName}
            </p>
          )}
        </div>

        {/* stats */}
        {ok && (
          <div style={{ display: "flex", gap: 0, padding: "20px 28px" }}>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: (result.totalInserted > 0 || result.totalUpdated > 0) ? "#6BA539" : "#E87722" }}>
                {result.totalInserted.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                {result.totalInserted > 0 || result.totalUpdated > 0
                  ? "new data rows imported"
                  : "new data rows — no records from your file were written (setup entries only)"}
              </div>
            </div>
            {result.totalUpdated > 0 && (
              <div style={{ flex: 1, textAlign: "center", borderLeft: "1px solid #2a3a4a" }}>
                <div style={{ fontSize: 30, fontWeight: 800, color: "#6BA539" }}>
                  {result.totalUpdated.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>records updated</div>
              </div>
            )}
            {result.totalErrors > 0 && (
              <div style={{ flex: 1, textAlign: "center", borderLeft: "1px solid #2a3a4a" }}>
                <div style={{ fontSize: 30, fontWeight: 800, color: "#E87722" }}>
                  {result.totalErrors.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>errors</div>
              </div>
            )}
          </div>
        )}
        {ok && (
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 28px 16px", textAlign: "center" }}>
            All pages have been refreshed with your new data — no reload needed.
          </p>
        )}
        {!ok && (
          <div style={{ padding: "20px 28px", fontSize: 13, color: "#94a3b8" }}>
            Check the import history page for details.
          </div>
        )}

        {/* actions */}
        <div style={{ display: "flex", gap: 10, padding: "0 28px 24px", justifyContent: "flex-end" }}>
          <button
            onClick={() => setResult(null)}
            style={{
              padding: "9px 20px", borderRadius: 8, border: "1px solid #2a3a4a",
              background: "transparent", color: "#94a3b8", fontSize: 13, cursor: "pointer",
            }}>
            Dismiss
          </button>
          <button
            onClick={() => { setResult(null); navigate(`/onboarding/history${user?.tenant ? `?tenantId=${encodeURIComponent(user.tenant)}` : ""}`); }}
            style={{
              padding: "9px 20px", borderRadius: 8, border: "none",
              background: "#6BA539", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
            View History
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Warm the cache for the heavy modules (PMM/OPM/LEM/COM + resource
 * demands) as soon as the user is authenticated. By the time they click
 * into Projects or Resources, the data is already loaded (or in
 * flight), so those pages skip the "Loading live data…" overlay and
 * render instantly from cache.
 */
function CachePrewarm() {
  const qc = useQueryClient();
  const { user } = useAuth();

  // Org-structure + users — fired IMMEDIATELY on mount with no user dependency.
  // authHeaders() reads the JWT directly from localStorage so this works even
  // before the useAuth() hook resolves the user object.  These are the queries
  // that drive every create-form dropdown, so starting them as early as possible
  // minimises the "Loading options…" window.
  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["divisions"],     queryFn: () => getDivisions(),    staleTime: 5 * 60 * 1000 });
    qc.prefetchQuery({ queryKey: ["departments"],   queryFn: () => getDepartments(),  staleTime: 5 * 60 * 1000 });
    qc.prefetchQuery({ queryKey: ["businessUnits"], queryFn: () => getBusinessUnits(), staleTime: 5 * 60 * 1000 });
    qc.prefetchQuery({ queryKey: ["users"],         queryFn: () => getUsers(),         staleTime: 10 * 60 * 1000 });
  }, [qc]); // intentionally NO user dep — fire before user object resolves

  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["pmm"], queryFn: () => getModuleRecords("PMM") });
    qc.prefetchQuery({ queryKey: ["opm"], queryFn: () => getModuleRecords("OPM") });
    qc.prefetchQuery({ queryKey: ["lem"], queryFn: () => getModuleRecords("LEM") });
    qc.prefetchQuery({ queryKey: ["com"], queryFn: () => getModuleRecords("COM") });
    qc.prefetchQuery({ queryKey: ["resource-demands"], queryFn: () => getResourceDemands() });

    // Forecast page sources — prefetch under the SAME query keys the
    // Forecast page uses so its useQuery hooks find warm data on first
    // visit. computeForecastWindow(new Date(), 52) is deterministic
    // (Monday-anchored, fixed 52 weeks), so the util key here always
    // matches the page's key for the current week.
    const fw = computeForecastWindow(new Date(), 52);
    qc.prefetchQuery({
      queryKey: ["forecast-util", fw.startDate, fw.endDate],
      queryFn: () => getAllocationUtilization({
        startDate: fw.startDate,
        endDate: fw.endDate,
        mode: "Weekly",
        includeSoftAllocations: true,
      }),
      staleTime: 5 * 60 * 1000,
    });
    // Timeline/Manager utilization — prefetch under the SAME key the
    // Resources page (and the standalone /manager page) builds on first
    // mount: current quarter, Weekly mode, all filter toggles off (see
    // defaultUtilQuery in lib/quarters.ts — both sides read the same
    // helpers, so the key cannot drift). The Manager grid blocks entirely
    // on this query, so warming it here is what makes a first click on
    // Manager render instantly instead of sitting on the "Loading weekly
    // utilization" spinner for the full round-trip.
    const du = defaultUtilQuery();
    qc.prefetchQuery({
      queryKey: du.queryKey,
      queryFn: () => getAllocationUtilization(du.opts),
      staleTime: 5 * 60 * 1000,
    });

    qc.prefetchQuery({ queryKey: ["resource-allocations"], queryFn: () => getResourceAllocations(), staleTime: 5 * 60 * 1000 });
    qc.prefetchQuery({ queryKey: ["resource-master"], queryFn: () => getResourceMaster(), staleTime: 5 * 60 * 1000 });

    // Warm the live overlay used by /alerts (and the home feed) for the
    // user's current role, so the Alerts page renders rows instantly
    // instead of showing the "RM ONE agents are evaluating" loader on
    // first open. Home has no day-window picker any more — every role
    // always aggregates the whole tenant, so there is no per-user window
    // preference to read from localStorage (that key is legacy and no
    // longer written anywhere).
    const role = resolveActiveRole(user?.userRoles, user?.username);
    const data = ROLE_HOME_DATA[role];
    const win: WindowKey = data.defaultWindow;
    // Wait for the business rules to resolve BEFORE warming: the overlay
    // cache key embeds the rules fingerprint, so a warm fired under the
    // default rules would be written to a key the home page never reads
    // once the tenant's real rules land — a wasted 10-20 s fetch.
    void loadBusinessRules().then(() => warmOverlayCache(role, win, user?.username));
  }, [qc, user?.username, user?.userRoles]);
  return null;
}

/**
 * Redirects admin users who have no data yet to the Import page so they
 * import before using the app. Superadmins and non-admin users are not gated.
 *
 * "Has data" is determined from TWO independent signals checked in parallel:
 *  1. Import history — at least one success/partial job.
 *  2. Live record count — tenant has ≥1 project, opportunity, or lead row in
 *     core2 (catches tenants seeded by cloning, direct DB writes, or manual
 *     record creation that have real data but an empty import history).
 * Either signal being true is sufficient to let the user through.
 */
function SetupGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();
  const superAdmin = isSuperAdmin(user?.username, user?.tenant);
  const isAdmin = user?.isAdmin !== false;
  const shouldCheck = isAdmin && !superAdmin;

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["setup-gate-history"],
    queryFn: async () => {
      const res = await fetch("/api/onboarding/history", { headers: authHeaders() as Record<string, string> });
      if (!res.ok) return { jobs: [] };
      return res.json() as Promise<{ jobs: { status: string }[] }>;
    },
    enabled: shouldCheck,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Fallback probe: a cheap EXISTS check on key tables in core2. Catches
  // tenants that have live records but no import history. Fails open
  // (hasData:true) when the DB is unreachable so admins are never spuriously
  // locked out — the redirect is a UX guard, not a security boundary.
  const { data: liveData, isLoading: liveLoading } = useQuery({
    queryKey: ["setup-gate-has-data"],
    queryFn: async () => {
      const res = await fetch("/api/onboarding/has-data", { headers: authHeaders() as Record<string, string> });
      if (!res.ok) return { hasData: true }; // fail open
      return res.json() as Promise<{ hasData: boolean }>;
    },
    enabled: shouldCheck,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Don't redirect until both checks resolve so we never flash the Import page
  // for a tenant that has data.
  if (!shouldCheck || historyLoading || liveLoading) return <>{children}</>;

  const hasData =
    historyData?.jobs?.some((j) => j.status === "success" || j.status === "partial") ||
    liveData?.hasData === true;

  const onAllowedPath =
    location.startsWith("/configuration") ||
    location.startsWith("/onboarding") ||
    location.startsWith("/import") ||
    location.startsWith("/data-cleaning") ||
    location === "/profile";

  if (!hasData && !onAllowedPath) {
    return <Redirect to="/import" />;
  }

  return <>{children}</>;
}

function ProtectedRoutes() {
  const { user, isLoading } = useAuth();
  // Warm the chunks a fresh login lands on (once auth resolves) so the
  // once-a-day briefing redirect and the most-visited pages never flash the
  // route fallback. Fire-and-forget: a failed prefetch just means the chunk
  // loads on demand instead. Delayed so it never competes with the login
  // overlay warm-up for bandwidth.
  const username = user?.username;
  useEffect(() => {
    if (!username) return;
    // Guarded warm: a failed prefetch (offline, stale chunk right after a
    // deploy) must stay SILENT — the route then just loads on demand with
    // lazyPage's stale-chunk recovery. A bare `void import()` would surface
    // an unhandled promise rejection instead.
    const warm = (load: () => Promise<unknown>) => { load().catch(() => {}); };
    const t = window.setTimeout(() => {
      warm(() => import("@/pages/daily-briefing"));
      warm(() => import("@/pages/projects"));
      warm(() => import("@/pages/resources"));
      // Forecast is a heavy chunk (page + forecastIntelligence lib) and its
      // DATA is already prefetched by CachePrewarm — without warming the
      // chunk too, first click still sat on the "Loading page modules"
      // fallback for the whole download + parse.
      warm(() => import("@/pages/forecast"));
    }, 1500);
    // Record detail (project / opportunity / lead) is the heaviest chunk in
    // the app AND the most-opened destination — warm it too so clicking a
    // record never freezes on download + parse of megabytes of JS over a
    // slow link. Scheduled later, and on browser idle where supported, so
    // it never competes with the post-login data fan-out; skipped entirely
    // when the browser signals data saving.
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    let idleId: number | undefined;
    const t2 = window.setTimeout(() => {
      if (conn?.saveData) return;
      const kick = () => warm(() => import("@/pages/project-detail"));
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(kick, { timeout: 4000 });
      } else {
        kick();
      }
    }, 4000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
      if (idleId !== undefined && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [username]);
  if (isLoading) {
    // Visible loading indicator on the dark navy app background so the
    // user never sees a blank screen while /api/auth/me resolves
    // (previously the muted-foreground text was nearly invisible on the
    // navy background, which read as a broken page).
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-3.5"
        style={{ backgroundColor: "#253746", color: "#9aa4ad" }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "3px solid rgba(169,194,63,0.25)",
            borderTopColor: "#A9C23F",
            animation: "rmone-boot-spin 0.9s linear infinite",
          }}
        />
        <div
          style={{
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          RM ONE · loading
        </div>
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  // The Daily Briefing renders OUTSIDE the AppShell — full-screen, no
  // sidebar, on the deep-navy background — so it reads as a focused
  // launch surface rather than a normal dashboard page.
  return (
    <>
      {/* Branded post-login splash — plays once per real login event,
          armed by login.tsx and self-consumed on first mount. Subsequent
          page navigations do NOT trigger it. */}
      <CommandCentreLoader />
      <CachePrewarm />
      <ImportCompletionWatcher />
      {/* Usage telemetry (#482): module-visit beacon — fire-and-forget,
          debounced, renders nothing, never blocks navigation. */}
      <UsageBeaconTracker />
      <Suspense fallback={<RouteLoadingFallback full />}>
      <Switch>
      {/* Daily Briefing — full-screen "Good morning" launch screen, no
          sidebar. Login routes here once per calendar day per account
          (see lib/briefingGate.ts); it is also reachable on demand from
          the avatar menu via /daily-briefing. The page marks itself as
          seen on mount, so it shows at most once per day per user. */}
      <Route path="/briefing">
        {() =>
          isSuperAdmin(user?.username, user?.tenant) ? (
            <Redirect to="/superadmin" />
          ) : (
            <DailyBriefingPage />
          )
        }
      </Route>
      <Route path="/daily-briefing" component={DailyBriefingPage} />
      <Route>
        {/* The main app sidebar is always visible — including on /chat. The
            chat page renders its OWN conversations sidebar inside the shell,
            which the user can toggle on/off independently. */}
        <SetupGate>
        <AppShell>
          <Suspense fallback={<RouteLoadingFallback />}>
          <Switch>
            {/* Superadmin: redirect root → /superadmin only when logged in as the rmone tenant */}
            <Route path="/">{() => {
              const { user } = useAuth();
              if (isSuperAdmin(user?.username, user?.tenant)) return <Redirect to="/superadmin" />;
              return <RoleHome />;
            }}</Route>
            {/* Superadmin dashboard — accessible only to superadmins logged in as rmone tenant */}
            <Route path="/superadmin">{() => {
              const { user } = useAuth();
              if (!isSuperAdmin(user?.username, user?.tenant)) return <Redirect to="/" />;
              return <SuperadminDashboard />;
            }}</Route>
            <Route path="/superadmin/recycle-bin">{() => {
              const { user } = useAuth();
              if (!isSuperAdmin(user?.username, user?.tenant)) return <Redirect to="/" />;
              return <SuperadminRecycleBinPage />;
            }}</Route>
            <Route path="/analytics" component={AnalyticsPage} />
            {/* Actuals vs Forecast — one destination, three tabs. The three
                routes stay alive so historical deep links (?ticket=… etc.)
                keep working; ForecastTabs renders the shared tab strip and
                each page keeps its own lazy chunk. */}
            <Route path="/actuals-forecast">{() => <ForecastTabs tab="graph"><ActualsForecastPage /></ForecastTabs>}</Route>
            <Route path="/forecast-report">{() => <ForecastTabs tab="report"><ForecastReportPage /></ForecastTabs>}</Route>
            <Route path="/executive-forecast">{() => <ForecastTabs tab="portfolio"><ExecutiveForecastPage /></ForecastTabs>}</Route>
            <Route path="/actuals-import" component={ActualsImportPage} />
            {/* Visibility is resolved by Shell from the tenant's live
                access-level navigation rule, including direct URLs. */}
            <Route path="/usage-analytics" component={AnalyticsUsagePage} />
            <Route path="/analytics-center/:section">
              {(params) => {
                return <AnalyticsCenterSectionPage section={params.section} />;
              }}
            </Route>
            <Route path="/analytics-center">{() => {
              return <AnalyticsCenterPage />;
            }}</Route>
            <Route path="/reports/:module">
              {(params) => <ReportModulePage module={params.module} />}
            </Route>
            <Route path="/reports" component={ReportsHubPage} />
            <Route path="/projects" component={ProjectsPage} />
            <Route path="/resources" component={ResourcesPage} />
            <Route path="/manager" component={ManagerPage} />
            <Route path="/quick-actions" component={QuickActionsPage} />
            <Route path="/forecast" component={ForecastPage} />
            <Route path="/chat" component={ChatPage} />
            <Route path="/intelligence" component={IntelligenceHubPage} />
            <Route path="/alerts" component={AlertsPage} />
            <Route path="/profile" component={ProfilePage} />
            <Route path="/rate-card">{() => <RateCardPage />}</Route>
            <Route path="/import" component={ImportDataPage} />
            <Route path="/data-cleaning" component={DataCleaningPage} />
            <Route path="/configuration/import">{() => <Redirect to="/import" />}</Route>
            <Route path="/configuration/:section" component={ConfigurationPage} />
            {/* Settings opens on the All Settings card hub. Category deep
                links such as /configuration/organization still open their
                specific editor through the route above. */}
            <Route path="/configuration" component={ConfigurationPage} />
            <Route path="/configuration/organisation">{() => <Redirect to="/configuration/organization" />}</Route>
            <Route path="/billing-rates">{() => <BillingRatesPage />}</Route>
            <Route path="/manage-organisation">{() => <Redirect to="/configuration/organization" />}</Route>
            <Route path="/manage-organization">{() => <Redirect to="/configuration/organization" />}</Route>
            <Route path="/system-health" component={SystemHealthPage} />
            <Route path="/project/create" component={ProjectCreatePage} />
            <Route path="/opportunity/create" component={OpportunityCreatePage} />
            <Route path="/lead/create" component={LeadCreatePage} />
            <Route path="/staff/create" component={StaffCreatePage} />
            <Route path="/project/:id">
              {(params) => <ProjectDetailPage projectId={params.id} />}
            </Route>
            <Route path="/onboarding">{() => <Redirect to="/import" />}</Route>
            <Route path="/onboarding/settings">{() => <OnboardingSettingsPage />}</Route>
            <Route path="/onboarding/synonyms">{() => <OnboardingSynonymsPage />}</Route>
            <Route path="/onboarding/readiness">{() => <OnboardingReadinessPage />}</Route>
            <Route path="/onboarding/history">{() => <OnboardingHistoryPage />}</Route>
            <Route path="/onboarding/new-company" component={ProvisionTenantPage} />
            <Route path="/onboarding/status/:id">
              {(params) => <OnboardingStatusPage uploadId={params.id} />}
            </Route>
            <Route component={NotFound} />
          </Switch>
          </Suspense>
        </AppShell>
        </SetupGate>
      </Route>
    </Switch>
    </Suspense>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      {/* Public, unauthenticated page — onboarded members land here from their
          secure invite email to set their own password. */}
      <Route path="/set-password" component={SetPasswordPage} />
      <Route>{() => <ProtectedRoutes />}</Route>
    </Switch>
  );
}

function App() {
  // Load the admin-tuned business thresholds once at startup so the dashboards
  // (home health score, forecast window) reflect the configured values.
  useEffect(() => { void loadBusinessRules(); }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
        <AuthProvider>
          <SplashScreen>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
            <NewVersionBanner />
          </SplashScreen>
        </AuthProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
