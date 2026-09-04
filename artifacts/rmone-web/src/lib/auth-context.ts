import { createContext } from "react";

export interface AuthUser {
  username: string;
  tenant: string;
  token: string;
  userRoles?: string;
  userId?: string;
  /**
   * Whether this user may edit (schedules, allocations, assignments). Derived
   * from the profile's CanEdit flag (RDS tenants). Undefined for RM ONE-cloud
   * users and during initial localStorage hydration — treated as editable so
   * we never hide controls from users the backend hasn't classified. The
   * backend is the real authority; this only governs UI affordances. */
  canEdit?: boolean;
  /**
   * True only for users with AccessLevel === "Admin". Admins can do everything
   * Managers can (canEdit=true) PLUS access system configuration pages
   * (Configuration, System Health) and change other users' access levels.
   * Managers can edit project/people data but cannot access config pages.
   * Undefined = grandfathered (treated as admin so existing setups are unaffected). */
  isAdmin?: boolean;
  /**
   * Friendly display name fetched from the user profile (DisplayName /
   * FullName / FirstName + LastName / FirstName, in that order). Falls back
   * to `username` when the profile call fails. Sent to the chat backend so
   * AI-drafted emails can sign off with a real human name instead of a
   * machine username like "Administrator_Liro_Poc". Mirrors mobile's
   * `userDisplayName` state. */
  displayName?: string;
}

export interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  signIn: (tenant: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  handleAuthError: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);
