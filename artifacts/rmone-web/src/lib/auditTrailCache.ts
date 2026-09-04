import { getStoredUser, type AuditHealth, type AuditTrailItem } from "./api";

/** Session-only seed cache so revisiting an Audit Trail card paints the last
 *  loaded page instantly while a background refresh fetches the latest.
 *  Keys are tenant+user scoped BY CONSTRUCTION (a tenant switch can never
 *  surface another tenant's rows), in memory only — nothing is persisted. */
export interface AuditSeed {
  rows: AuditTrailItem[];
  cursor: string | null;
  health: AuditHealth | null;
  at: number;
}

const seedCache = new Map<string, AuditSeed>();
const SEED_CAP = 24;

/** Tenant+user prefix so entries are unreachable after any account switch. */
export function auditSeedKey(scopeKey: string): string {
  const stored = getStoredUser();
  const who = stored ? `${stored.tenant}|${stored.username}` : "anonymous";
  return `${who}|${scopeKey}`;
}

export function readAuditSeed(key: string): AuditSeed | undefined {
  return seedCache.get(key);
}

export function writeAuditSeed(key: string, seed: AuditSeed): void {
  if (!seedCache.has(key) && seedCache.size >= SEED_CAP) {
    const oldest = seedCache.keys().next().value;
    if (oldest !== undefined) seedCache.delete(oldest);
  }
  seedCache.set(key, seed);
}

export function patchAuditSeedHealth(key: string, health: AuditHealth | null): void {
  const seeded = seedCache.get(key);
  if (seeded) seedCache.set(key, { ...seeded, health });
}

/** Wipe all seeded audit pages — called on sign-in/sign-out for tenant isolation. */
export function clearAuditTrailCache(): void {
  seedCache.clear();
}
