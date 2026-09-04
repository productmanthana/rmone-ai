import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { Platform } from "react-native";
import { login as apiLogin, getUserProfile, getMyCapabilities, bustCache, NO_CAPABILITIES, type MyCapabilities } from "./api";
import { clearDashboardSnapshot } from "./dashboardSnapshot";
import { setActiveTenant } from "./roleResolver";

interface AuthUser {
  username: string;
  tenant: string;
  token: string;
  userRoles: string;
  userId: string;
  /** Legacy profile hint only. Never use this to authorize a mobile action. */
  canEdit: boolean;
  capabilities: MyCapabilities;
}

// Legacy profile flag; capability-controlled UI must not consult this.
function parseCanEdit(v: string | null | undefined): boolean {
  return v !== "0";
}

const CAPS_KEY = "rmone_capabilities";
function parseCapabilities(raw: string | null): MyCapabilities {
  try {
    const value = JSON.parse(raw ?? "") as Partial<MyCapabilities>;
    return {
      editData: value.editData === true, advanceStages: value.advanceStages === true,
      editFinancials: value.editFinancials === true, manageStaff: value.manageStaff === true,
      manageSettings: value.manageSettings === true, importPage: value.importPage === true,
    };
  } catch { return NO_CAPABILITIES; }
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  signIn: (tenant: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  handleAuthError: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function savePassword(password: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem("rmone_password", password);
  } else {
    await SecureStore.setItemAsync("rmone_password", password);
  }
}

async function getPassword(): Promise<string | null> {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem("rmone_password");
  }
  return SecureStore.getItemAsync("rmone_password");
}

async function deletePassword() {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem("rmone_password");
  } else {
    await SecureStore.deleteItemAsync("rmone_password");
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const reAuthLock = useRef<Promise<void> | null>(null);

  // Persona overrides are keyed by tenant+username (see roleResolver.ts) since
  // the same admin email can be reused across separate companies. Keep the
  // module-level active-tenant cache in lockstep with whichever account is
  // currently signed in, so switching companies never leaks the previous
  // company's persona/job-title override.
  useEffect(() => {
    setActiveTenant(user?.tenant ?? null);
  }, [user?.tenant]);

  useEffect(() => {
    async function restoreSession() {
      try {
        const [token, username, tenant, savedPassword, userRoles, userId, canEditStored, capsStored] = await Promise.all([
          AsyncStorage.getItem("rmone_token"),
          AsyncStorage.getItem("rmone_username"),
          AsyncStorage.getItem("rmone_tenant"),
          getPassword(),
          AsyncStorage.getItem("rmone_userRoles"),
          AsyncStorage.getItem("rmone_userId"),
          AsyncStorage.getItem("rmone_canEdit"),
          AsyncStorage.getItem(CAPS_KEY),
        ]);
        const canEdit = parseCanEdit(canEditStored);
        const capabilities = parseCapabilities(capsStored);
        console.log("[auth] restoreSession: token=" + (token ? "present" : "null") + " user=" + (username ?? "null") + " savedPwd=" + (savedPassword ? "present" : "null") + " roles=" + (userRoles ?? "null"));
        if (token && username && tenant && userRoles) {
          // Refresh capabilities on restore. A failed/removed endpoint is
          // deliberately read-only rather than trusting a stale disk grant.
          const freshCaps = await getMyCapabilities();
          const settledCaps = freshCaps ?? NO_CAPABILITIES;
          await AsyncStorage.setItem(CAPS_KEY, JSON.stringify(settledCaps));
          setUser({ token, username, tenant, userRoles, userId: userId ?? "", canEdit, capabilities: settledCaps });
        } else if (token && username && tenant && savedPassword && !userRoles) {
          console.log("[auth] Token present but roles missing — re-authenticating to fetch roles…");
          try {
            const data = await apiLogin(tenant, username, savedPassword);
            const newToken = data.access_token as string;
            const newRoles = (data.userRoles as string) ?? "";
            const newCanEdit = typeof data.CanEdit === "boolean" ? data.CanEdit : true;
            await Promise.all([
              AsyncStorage.setItem("rmone_token", newToken),
              AsyncStorage.setItem("rmone_userRoles", newRoles),
              AsyncStorage.setItem("rmone_canEdit", newCanEdit ? "1" : "0"),
            ]);
            console.log("[auth] Re-auth for roles success, roles=" + newRoles);
            const freshCaps = await getMyCapabilities();
            const settledCaps = freshCaps ?? NO_CAPABILITIES;
            await AsyncStorage.setItem(CAPS_KEY, JSON.stringify(settledCaps));
            setUser({ token: newToken, username, tenant, userRoles: newRoles, userId: userId ?? "", canEdit: newCanEdit, capabilities: settledCaps });
          } catch (e) {
            console.warn("[auth] Re-auth for roles failed, using token without roles:", String(e));
            setUser({ token, username, tenant, userRoles: "", userId: userId ?? "", canEdit, capabilities: NO_CAPABILITIES });
          }
        } else if (token && username && tenant) {
          setUser({ token, username, tenant, userRoles: userRoles ?? "", userId: userId ?? "", canEdit, capabilities });
        } else if (username && tenant && savedPassword) {
          console.log("[auth] Token missing but credentials found — auto re-authenticating…");
          try {
            const data = await apiLogin(tenant, username, savedPassword);
            const newToken = data.access_token as string;
            const newRoles = (data.userRoles as string) ?? "";
            const newCanEdit = typeof data.CanEdit === "boolean" ? data.CanEdit : true;
            await Promise.all([
              AsyncStorage.setItem("rmone_token", newToken),
              AsyncStorage.setItem("rmone_userRoles", newRoles),
              AsyncStorage.setItem("rmone_canEdit", newCanEdit ? "1" : "0"),
            ]);
            console.log("[auth] Auto re-auth success, roles=" + newRoles);
            const freshCaps = await getMyCapabilities();
            const settledCaps = freshCaps ?? NO_CAPABILITIES;
            await AsyncStorage.setItem(CAPS_KEY, JSON.stringify(settledCaps));
            setUser({ token: newToken, username, tenant, userRoles: newRoles, userId: userId ?? "", canEdit: newCanEdit, capabilities: settledCaps });
          } catch (e) {
            console.warn("[auth] Auto re-auth failed:", String(e));
          }
        }
      } finally {
        setIsLoading(false);
      }
    }
    restoreSession();
  }, []);

  async function signIn(tenant: string, username: string, password: string) {
    const data = await apiLogin(tenant, username, password);
    const token = data.access_token as string;
    const userRoles = (data.userRoles as string) ?? "";
    // Clear any data cached under a PREVIOUS session before establishing the
    // new one. Cache keys are not tenant-scoped and a user can switch
    // tenants/users without signing out first — without this the prior
    // tenant's cached records (in-memory + AsyncStorage disk cache) would leak
    // into the new session. Critical for tenant data isolation.
    bustCache();
    // Retire the former optimistic financial grant before any new session can
    // render. It is intentionally no longer read by this client.
    await AsyncStorage.removeItem("rmone_canEditFinancials");
    await AsyncStorage.setItem("rmone_token", token);
    let userId = "";
    let canEdit = typeof data.CanEdit === "boolean" ? data.CanEdit : true;
    let capabilities = NO_CAPABILITIES;
    try {
      const [profile, caps] = await Promise.all([
        getUserProfile(username),
        getMyCapabilities(),
      ]);
      userId = profile?.Id ?? "";
      if (typeof profile?.CanEdit === "boolean") canEdit = profile.CanEdit;
      if (caps !== null) capabilities = caps;
    } catch (e) {
      console.warn("[auth] Failed to fetch profile/capabilities:", String(e));
    }
    await Promise.all([
      AsyncStorage.setItem("rmone_username", username),
      AsyncStorage.setItem("rmone_tenant", tenant),
      AsyncStorage.setItem("rmone_userRoles", userRoles),
      AsyncStorage.setItem("rmone_userId", userId),
      AsyncStorage.setItem("rmone_canEdit", canEdit ? "1" : "0"),
      AsyncStorage.setItem(CAPS_KEY, JSON.stringify(capabilities)),
      savePassword(password),
    ]);
    console.log("[auth] signIn success, roles=" + userRoles + " userId=" + userId);
    setUser({ token, username, tenant, userRoles, userId, canEdit, capabilities });
  }

  async function signOut() {
    await Promise.all([
      AsyncStorage.removeItem("rmone_token"),
      AsyncStorage.removeItem("rmone_username"),
      AsyncStorage.removeItem("rmone_tenant"),
      AsyncStorage.removeItem("rmone_userRoles"),
      AsyncStorage.removeItem("rmone_userId"),
      AsyncStorage.removeItem("rmone_canEdit"),
      AsyncStorage.removeItem("rmone_canEditFinancials"),
      AsyncStorage.removeItem(CAPS_KEY),
      deletePassword(),
    ]);
    clearDashboardSnapshot();
    bustCache();
    setUser(null);
  }

  const handleAuthError = useCallback(async () => {
    if (reAuthLock.current) {
      await reAuthLock.current;
      return;
    }
    const attempt = (async () => {
      console.warn("[auth] 401 received — attempting re-auth");
      await AsyncStorage.removeItem("rmone_token");
      const [username, tenant, savedPassword] = await Promise.all([
        AsyncStorage.getItem("rmone_username"),
        AsyncStorage.getItem("rmone_tenant"),
        getPassword(),
      ]);
      if (username && tenant && savedPassword) {
        try {
          const data = await apiLogin(tenant, username, savedPassword);
          const newToken = data.access_token as string;
          const newRoles = (data.userRoles as string) ?? "";
          const newCanEdit = typeof data.CanEdit === "boolean" ? data.CanEdit : true;
          await Promise.all([
            AsyncStorage.setItem("rmone_token", newToken),
            AsyncStorage.setItem("rmone_userRoles", newRoles),
            AsyncStorage.setItem("rmone_canEdit", newCanEdit ? "1" : "0"),
          ]);
          console.log("[auth] Re-auth on 401 success, roles=" + newRoles);
          const [savedUserId, profile, caps] = await Promise.all([
            AsyncStorage.getItem("rmone_userId"),
            getUserProfile(username).catch(() => null),
            getMyCapabilities(),
          ]);
          const userId = profile?.Id ?? savedUserId ?? "";
          const capabilities = caps ?? NO_CAPABILITIES;
          await Promise.all([
            AsyncStorage.setItem("rmone_userId", userId),
            AsyncStorage.setItem(CAPS_KEY, JSON.stringify(capabilities)),
          ]);
          setUser({ token: newToken, username, tenant, userRoles: newRoles, userId, canEdit: newCanEdit, capabilities });
          return;
        } catch (e) {
          console.warn("[auth] Re-auth failed:", String(e));
        }
      }
      setUser(null);
    })();
    reAuthLock.current = attempt;
    try { await attempt; } finally { reAuthLock.current = null; }
  }, []);

  return <AuthContext.Provider value={{ user, isLoading, signIn, signOut, handleAuthError }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
