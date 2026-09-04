// ─────────────────────────────────────────────────────────────────────────────
// RDS-backed authentication.
//
// Users live in our Postgres `users` table (replacing core2.dbo.AspNetUsers).
// Passwords use the same PBKDF2 V2/V3 format so existing hashes still verify.
// JWTs are signed with SESSION_SECRET and carry the same payload shape.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import type { Request } from "express";
import { findUserForLogin } from "@workspace/db";
import type { UserRow } from "@workspace/db";
import { resolveTenantId } from "./pipeline.js";
import { realTitleOf } from "./rds-provider.js";

const SECRET = process.env.SESSION_SECRET || "";
const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h, mirrors RM ONE's default-ish window

// Access level governs who may edit (change schedules / allocations / assignments).
// "admin" and "manager" can edit; "user" is read-only; "unset" = legacy accounts
// onboarded before access levels existed — grandfathered as editable so we never
// silently lock anyone out. canEditFromAcl() is the single source of that rule.
// "custom:<id>" = an admin-defined custom access level (#87) whose real
// capabilities live in lib/access-control.ts; canEditFromAcl stays OPTIMISTIC
// for those (true) — the live write gates enforce the level's actual caps, so
// a login token never grants more than the gates allow.
export type AccessLevel = "admin" | "manager" | "user" | "unset" | `custom:${string}`;

export function canEditFromAcl(acl: AccessLevel | string | undefined | null): boolean {
  return String(acl ?? "unset").toLowerCase() !== "user";
}

export interface RdsTokenPayload {
  sub: string;       // AspNetUsers.Id (GUID)
  tenant: string;    // friendly tenant label as typed at login
  tid: string;       // resolved tenant GUID
  username: string;  // AspNetUsers.UserName
  role: string;      // AspNetUsers.UserRole (raw)
  acl: AccessLevel;  // access level (admin/manager/user/unset)
  src: "rds";        // marks this as an RDS-issued token
  iat: number;
  exp: number;
}

export interface RdsUserRow {
  id: string;
  userName: string;
  name: string;
  passwordHash: string | null;
  enabled: boolean;
  role: string;
  accessLevel: AccessLevel;
}

// ── Password verification (ASP.NET Identity V2 + V3) ─────────────────────────
// V2 (marker 0x00): PBKDF2-HMAC-SHA1, 1000 iters, 16B salt, 32B subkey.
// V3 (marker 0x01): self-describing prf/iter/saltlen header. We support both so
// passwords seeded by the golden config (which may be V3) also verify.
export function verifyPassword(plaintext: string, storedBase64: string | null | undefined): boolean {
  if (!plaintext || !storedBase64) return false;
  let buf: Buffer;
  try {
    buf = Buffer.from(storedBase64, "base64");
  } catch {
    return false;
  }
  if (buf.length < 1) return false;

  const marker = buf[0];

  if (marker === 0x00) {
    if (buf.length !== 1 + 16 + 32) return false;
    const salt = buf.subarray(1, 17);
    const subkey = buf.subarray(17, 49);
    const derived = crypto.pbkdf2Sync(plaintext, salt, 1000, 32, "sha1");
    return timingSafeEqual(derived, subkey);
  }

  if (marker === 0x01) {
    // [0x01][prf u32][iter u32][saltLen u32][salt][subkey]
    if (buf.length < 13) return false;
    const prf = buf.readUInt32BE(1);
    const iter = buf.readUInt32BE(5);
    const saltLen = buf.readUInt32BE(9);
    if (saltLen <= 0 || 13 + saltLen >= buf.length) return false;
    const salt = buf.subarray(13, 13 + saltLen);
    const subkey = buf.subarray(13 + saltLen);
    if (subkey.length === 0) return false;
    const alg = prf === 0 ? "sha1" : prf === 1 ? "sha256" : prf === 2 ? "sha512" : null;
    if (!alg) return false;
    const derived = crypto.pbkdf2Sync(plaintext, salt, iter, subkey.length, alg);
    return timingSafeEqual(derived, subkey);
  }

  return false;
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── User lookup ──────────────────────────────────────────────────────────────
// Returns the Postgres user for this tenant+username/email, or null if none.
// Used by the login route: a user found here (with a password set) is an
// AWS customer and authenticates locally.
export async function lookupUserForLogin(tenant: string, username: string): Promise<RdsUserRow | null> {
  const tid = resolveTenantId(tenant);
  const row = await findUserForLogin(tid, username);
  if (!row) return null;
  return {
    id: row.id,
    userName: row.username,
    name: row.name,
    passwordHash: row.passwordHash,
    enabled: row.enabled,
    role: realTitleOf(row.title, row.role),
    accessLevel: deriveAccessLevelPg(row),
  };
}

// Derive the access level from the Postgres users row.
// isSiteAdmin is the authoritative admin flag and always wins.
// accessLevel carries the explicit admin/manager/user value written by the
// pipeline; when blank we fall back to isManager, then "unset" (grandfathered).
function deriveAccessLevelPg(row: UserRow): AccessLevel {
  if (row.isSiteAdmin) return "admin";
  const explicit = (row.accessLevel ?? "").trim().toLowerCase();
  if (explicit === "admin" || explicit === "manager" || explicit === "user") {
    return explicit as AccessLevel;
  }
  // Custom access level marker ("custom:<id>") — pass through verbatim so the
  // live gates can resolve its capabilities; must never collapse to "unset"
  // (that would silently grandfather the user as a full editor).
  if (explicit.startsWith("custom:")) return explicit as AccessLevel;
  if (row.isManager) return "manager";
  return "unset";
}

// ── JWT (HMAC-SHA256, signed with SESSION_SECRET) ────────────────────────────
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}

export function signRdsToken(input: { sub: string; tenant: string; username: string; role: string; accessLevel?: AccessLevel }): string {
  if (!SECRET) throw new Error("SESSION_SECRET is not set — cannot sign RDS tokens");
  const now = Math.floor(Date.now() / 1000);
  const payload: RdsTokenPayload = {
    sub: input.sub,
    tenant: input.tenant,
    tid: resolveTenantId(input.tenant),
    username: input.username,
    role: input.role,
    acl: input.accessLevel ?? "unset",
    src: "rds",
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = b64url(crypto.createHmac("sha256", SECRET).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

export function verifyRdsToken(token: string | null | undefined): RdsTokenPayload | null {
  if (!token || !SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = b64url(crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest());
  // Constant-time compare of the signature.
  const sBuf = Buffer.from(s);
  const eBuf = Buffer.from(expected);
  if (!timingSafeEqual(sBuf, eBuf)) return null;
  let payload: RdsTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as RdsTokenPayload;
  } catch {
    return null;
  }
  if (payload.src !== "rds") return null;
  if (typeof payload.exp !== "number" || Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

/**
 * Returns true when the token has a valid RDS signature and src="rds" but the
 * expiry window has passed.  Used by the chat route to return a clean 401 so
 * the frontend can force a re-login instead of silently failing.
 */
export function isExpiredRdsToken(token: string | null | undefined): boolean {
  if (!token || !SECRET) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [h, p, s] = parts;
  const expected = b64url(crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest());
  const sBuf = Buffer.from(s);
  const eBuf = Buffer.from(expected);
  try {
    if (!timingSafeEqual(sBuf, eBuf)) return false;
  } catch {
    return false;
  }
  let payload: RdsTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as RdsTokenPayload;
  } catch {
    return false;
  }
  if (payload.src !== "rds") return false;
  // Valid RDS token but expired
  return typeof payload.exp === "number" && Math.floor(Date.now() / 1000) >= payload.exp;
}

export const TOKEN_TTL = TOKEN_TTL_SECONDS;

// ── Profile (mirrors the fields the frontend reads from /profile) ────────────
export async function getRdsProfile(tenant: string, username: string): Promise<Record<string, unknown> | null> {
  const user = await lookupUserForLogin(tenant, username);
  if (!user) return null;
  // Role comes directly from the Postgres users row (title || role).
  // The frontend roleResolver substring-matches UserRoles for persona detection
  // (COO > CFO > EXECUTIVE > RM > PM), so we surface the job title text here.
  return {
    UserId: user.id,
    UserName: user.userName,
    Name: user.name,
    UserRoles: user.role || "",
    AccessLevel: user.accessLevel,
    CanEdit: canEditFromAcl(user.accessLevel),
    Status: true,
  };
}

// ── Request source resolution ────────────────────────────────────────────────
// Data routes call this to decide whether to serve from core2 (RDS) or proxy to
// the RM ONE cloud. Returns the decoded RDS payload when the bearer is one of our
// tokens; otherwise null (caller falls back to the existing RM ONE path).
export interface RequestSource {
  src: "rds";
  tenant: string;
  tid: string;
  userId: string;
  username: string;
  role: string;
  accessLevel: AccessLevel;
  canEdit: boolean;
}

export function resolveRequestSource(req: Request): RequestSource | null {
  const hdr = req.headers["authorization"] || req.headers["Authorization" as keyof typeof req.headers];
  const raw = Array.isArray(hdr) ? hdr[0] : hdr;
  const token = raw?.startsWith("Bearer ") ? raw.slice(7) : raw;
  const payload = verifyRdsToken(token);
  if (!payload) return null;
  const accessLevel = (payload.acl ?? "unset") as AccessLevel;
  return {
    src: "rds",
    tenant: payload.tenant,
    tid: payload.tid,
    userId: payload.sub,
    username: payload.username,
    role: payload.role,
    accessLevel,
    canEdit: canEditFromAcl(accessLevel),
  };
}

// The ONLY accounts granted cross-company ("superadmin") visibility — the
// internal RM ONE operators who may see/control EVERY company's onboarding, as
// opposed to a single client company's own admin (which is an access *level*,
// scoped to one tenant). Identified by login username (core2 AspNetUsers.UserName,
// which is the account's email).
//
// ROOT accounts are hardcoded here as a safety net and can never be removed.
// Additional superadmins are stored in the `superadmin_accounts` Postgres table
// and checked via isSuperAdminSource / the superadmin router's guard().
export const ROOT_SUPERADMIN_ACCOUNTS: readonly string[] = [
  "drsampathkumarpatil@gmail.com",
  "sanjk0604@gmail.com",
  "sanjeev@rmone.com",
];

// The tenant these root accounts must be logged into for superadmin
// (cross-company) powers to apply. Logging into ANY other tenant (e.g. their
// own client company, or a demo tenant) must behave like a normal user of
// that tenant — superadmin is a property of the "rmone" login, not of the
// account's email address.
const SUPERADMIN_HOME_TENANT = "rmone";

// Trusted server-side superadmin check, based on the authenticated account from
// the verified JWT (not on a client-supplied value). Checks root accounts only —
// the superadmin router's guard() also checks DB-added accounts.
// IMPORTANT: superadmin status is scoped to the "rmone" tenant login. The same
// email logged into a different tenant is just that tenant's normal user —
// otherwise a root account also holding a seat in a client company would be
// treated as cross-company superadmin everywhere, redirecting them to the
// "All Companies" views instead of their own company's data.
export function isSuperAdminSource(src: RequestSource): boolean {
  const uname = (src.username || "").trim().toLowerCase();
  if (!(ROOT_SUPERADMIN_ACCOUNTS as string[]).includes(uname)) return false;
  return (src.tenant || "").trim().toLowerCase() === SUPERADMIN_HOME_TENANT;
}
