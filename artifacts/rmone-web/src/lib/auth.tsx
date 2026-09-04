import { useEffect, useState, useCallback, type ReactNode } from "react";
import { login as apiLogin, getUserProfile, logout as apiLogout, getStoredUser } from "./api";
import { clearAuditTrailCache } from "./auditTrailCache";
import { loadBusinessRules } from "./businessRules";
import { clearDashboardSnapshot } from "./dashboardSnapshot";
import { queryClient } from "./queryClient";
import { AuthContext, type AuthUser } from "./auth-context";
import { checkSuperAdminApi, clearSuperAdminCache, setRoleOverride, setJobTitleOverride } from "./roleResolver";
import { bustPermissionCaches } from "./permissions";

/**
 * Pick a friendly display name from an RM ONE /profile response. Mirrors the
 * mobile chat's userDisplayName fetch (artifacts/rmone-mobile/app/(tabs)/chat.tsx
 * around line 4332): DisplayName -> FullName -> Name -> "First Last" ->
 * FirstName -> raw username. Used by the chat backend to sign AI-drafted
 * emails with a real human name.
 */
function deriveDisplayName(profile: unknown, fallback: string): string {
  if (!profile || typeof profile !== "object") return fallback;
  const p = profile as Record<string, unknown>;
  const pick = (k: string): string | undefined => {
    const v = p[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const display = pick("DisplayName");
  if (display) return display;
  const full = pick("FullName");
  if (full) return full;
  const name = pick("Name");
  if (name) return name;
  const first = pick("FirstName");
  const last = pick("LastName");
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  return fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Hydrate from localStorage *synchronously* during the first render so
  // the app never gets stuck on a spinner waiting for the profile fetch.
  // (Previously: production users on slow networks would see only "Loading…"
  // because we awaited /profile before rendering anything.) The profile
  // refresh still runs in the background below — if it 401s we clear the
  // session and bounce to /login.
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser() as AuthUser | null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await getUserProfile(stored.username);
        if (cancelled) return;
        const profileAclRaw = typeof profile?.AccessLevel === "string"
          ? String(profile.AccessLevel).trim().toLowerCase() : null;
        const profileAcl = profileAclRaw === "unset" ? null : profileAclRaw;
        setUser({
          ...stored,
          // Prefer the fresh profile title; fall back to the tenant+user-scoped
          // stored title (persisted at login) so a missing field in the profile
          // response never blanks the role badge back to the default persona.
          userRoles: typeof profile?.UserRoles === "string" && profile.UserRoles.trim()
            ? profile.UserRoles
            : stored.userRoles,
          userId:
            profile?.Id != null
              ? String(profile.Id)
              : profile?.UserId != null
                ? String(profile.UserId)
                : undefined,
          canEdit: typeof profile?.CanEdit === "boolean" ? profile.CanEdit : stored.canEdit,
          isAdmin: profileAcl !== null ? profileAcl === "admin" : stored.isAdmin,
          displayName: deriveDisplayName(profile, stored.username),
        });
        // The live profile may reflect an access-level change made after the
        // stored login snapshot. Re-read mounted capability/record gates so
        // the account menu cannot say Admin while a stale permission verdict
        // still blocks financial fields.
        bustPermissionCaches();
      } catch {
        // Token invalid / expired — clear and surface login screen.
        await apiLogout();
        queryClient.clear();
        if (!cancelled) setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (tenant: string, username: string, password: string) => {
    await apiLogin(tenant, username, password);
    // apiLogin() already busts the localStorage/in-memory data cache. Also wipe
    // the React Query cache: its keys are NOT tenant-scoped (["pmm"], ["opm"],
    // …) and staleTime is 10min, so a tenant/user switch in the same SPA runtime
    // would otherwise serve the prior tenant's data as "fresh". Tenant isolation.
    queryClient.clear();
    // Drop the previous session's home-dashboard snapshot too: it's forwarded
    // verbatim to the chat LLM as dashboardContext, so a stale one from the
    // prior tenant/user must never survive a same-tab sign-in.
    clearDashboardSnapshot();
    clearAuditTrailCache();
    // A fresh sign-in starts from the account's ASSIGNED title: drop any
    // persona/job-title override left over from a previous session so the DB
    // title always drives the Home page and Daily Briefing at login. The
    // in-app job-title switcher still works normally for the session. Must
    // run AFTER apiLogin so the override key resolves against the NEW tenant.
    setRoleOverride(username, null);
    setJobTitleOverride(username, null);
    // Kick off the signed-in company's business-rules load in the BACKGROUND.
    // The home overlay build awaits whenBusinessRulesSettled() (capped) behind
    // the post-login splash, so the rules fingerprint is stable before the
    // first dashboard build WITHOUT holding the "Signing in…" button spinner
    // here (previously this awaited up to 4 s and the button visibly stalled).
    void loadBusinessRules().catch(() => { /* defaults remain — rebuild path still works */ });
    const stored = getStoredUser();
    if (!stored) throw new Error("Sign-in failed: no token persisted");
    // Complete sign-in IMMEDIATELY from the login response — it already
    // carries UserRoles, CanEdit and AccessLevel (persisted by apiLogin into
    // localStorage, hydrated back via getStoredUser). Previously we awaited
    // the follow-up /profile fetch here (a remote SQL round trip with a 45 s
    // timeout), which kept the "Signing in…" spinner up for seconds even
    // though the token was issued instantly. The profile now refreshes in
    // the background and merges in userId/displayName when it lands.
    setUser({ ...stored, displayName: username });
    // Warm the superadmin cache for DB-added accounts (fire-and-forget — root
    // accounts already work synchronously, this only helps added ones).
    checkSuperAdminApi(username, stored.token).catch(() => {});
    // Background profile refresh: fills in userId + friendly displayName and
    // corrects canEdit/isAdmin if the profile disagrees with the login
    // response. Guarded so a slow response never resurrects a session after
    // sign-out or overwrites a DIFFERENT user who signed in meanwhile.
    void (async () => {
      try {
        const profile = await getUserProfile(username);
        const current = getStoredUser();
        if (!current || current.token !== stored.token) return;
        const profileAclRaw = typeof profile?.AccessLevel === "string"
          ? String(profile.AccessLevel).trim().toLowerCase() : null;
        const profileAcl = profileAclRaw === "unset" ? null : profileAclRaw;
        setUser((prev) => {
          if (!prev || prev.username !== username || prev.token !== stored.token) return prev;
          return {
            ...prev,
            userRoles: typeof profile?.UserRoles === "string" && profile.UserRoles.trim()
              ? profile.UserRoles
              : prev.userRoles,
            userId:
              profile?.Id != null
                ? String(profile.Id)
                : profile?.UserId != null
                  ? String(profile.UserId)
                  : prev.userId,
            canEdit: typeof profile?.CanEdit === "boolean" ? profile.CanEdit : prev.canEdit,
            isAdmin: profileAcl !== null ? profileAcl === "admin" : prev.isAdmin,
            displayName: deriveDisplayName(profile, username),
          };
        });
        // Same correction for the post-login background profile refresh.
        // This also covers changes made from another browser, where a local
        // BroadcastChannel notification cannot reach this session.
        bustPermissionCaches();
      } catch {/* ignore — login already succeeded */}
    })();
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    clearDashboardSnapshot();
    clearSuperAdminCache();
    clearAuditTrailCache();
    queryClient.clear();
    setUser(null);
  }, []);

  const handleAuthError = useCallback(async () => {
    await apiLogout();
    clearDashboardSnapshot();
    clearSuperAdminCache();
    clearAuditTrailCache();
    queryClient.clear();
    setUser(null);
  }, []);

  // Cross-tab session enforcement: if another tab logs in as a DIFFERENT user
  // (or logs out), sign this tab out immediately. Uses the browser's native
  // `storage` event which fires in every tab EXCEPT the one that wrote the
  // change — so the tab doing the login is unaffected.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== "rmone_username" && e.key !== "rmone_token" && e.key !== "rmone_tenant") return;
      const newUsername = localStorage.getItem("rmone_username");
      const newTenant = localStorage.getItem("rmone_tenant");
      const currentUsername = user?.username;
      const currentTenant = user?.tenant;
      // Only act when a user is currently signed in here
      if (!currentUsername) return;
      // Another tab signed out, signed in as a different user, or signed in
      // to a DIFFERENT TENANT. The tenant comparison is essential: customers
      // reuse the same email across companies, so username alone matches while
      // this tab's in-memory data still belongs to the previous company — and
      // its next API call would use the NEW tenant's token. Sign out instead.
      if (
        !newUsername ||
        newUsername !== currentUsername ||
        (currentTenant &&
          (newTenant ?? "").toLowerCase() !== currentTenant.toLowerCase())
      ) {
        clearDashboardSnapshot();
        clearSuperAdminCache();
        clearAuditTrailCache();
        queryClient.clear();
        setUser(null);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [user?.username, user?.tenant]);

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut, handleAuthError }}>
      {children}
    </AuthContext.Provider>
  );
}
