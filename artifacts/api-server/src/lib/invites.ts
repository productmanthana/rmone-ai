// ─────────────────────────────────────────────────────────────────────────────
// Secure "set your own password" invite — token storage in SQL Server (core2)
//
// Tokens are stored in core2.dbo.RMOneInviteTokens (AWS RDS), which is shared
// between all environments (dev, prod). This ensures invite links generated in
// any environment are always validateable on the production server.
//
// Previously tokens were stored in Drizzle Postgres, which is split per-env,
// causing "This link is not valid" on production when invites were sent from dev.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import { getPool, sql } from "./db.js";
import { hashPassword } from "./pipeline.js";
import { sendEmail } from "./agentmail.js";
import { updateUser } from "@workspace/db";

export const INVITE_TTL_HOURS = 48;

export function publicBaseUrl(): string {
  const explicit = (process.env.APP_PUBLIC_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const dom = (process.env.DEV_PUBLIC_DOMAIN || "").trim();
  return dom ? `https://${dom}` : "";
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function normTenantKey(t: string): string {
  return t.trim().replace(/\s+/g, "_").toLowerCase();
}

export interface InviteRow {
  id: number;
  tenantKey: string;
  tenantLabel: string;
  userGuid: string;
  email: string;
  name: string;
  tokenHash: string;
  status: string;
  expiresAt: Date;
  sentAt: Date;
  acceptedAt: Date | null;
}

export interface InviteResult {
  ok: boolean;
  emailed: boolean;
  link?: string;
  message?: string;
}

// Ensure the invite tokens table exists in core2 (idempotent, cached after first run).
let _tableEnsured = false;
export async function ensureInviteTable(pool: Awaited<ReturnType<typeof getPool>>): Promise<void> {
  if (_tableEnsured) return;
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM core2.sys.tables
      WHERE name=N'RMOneInviteTokens' AND schema_id=SCHEMA_ID(N'dbo')
    )
    CREATE TABLE core2.dbo.RMOneInviteTokens (
      ID           INT IDENTITY(1,1) PRIMARY KEY,
      TenantKey    NVARCHAR(200) NOT NULL,
      TenantLabel  NVARCHAR(500) NOT NULL,
      UserGuid     NVARCHAR(50)  NOT NULL,
      Email        NVARCHAR(200) NOT NULL,
      Name         NVARCHAR(200) NOT NULL,
      TokenHash    NVARCHAR(100) NOT NULL,
      Status       NVARCHAR(20)  NOT NULL CONSTRAINT DF_RMOneInvite_Status DEFAULT N'sent',
      ExpiresAt    DATETIME2     NOT NULL,
      SentAt       DATETIME2     NOT NULL CONSTRAINT DF_RMOneInvite_SentAt DEFAULT GETUTCDATE(),
      AcceptedAt   DATETIME2     NULL,
      UpdatedAt    DATETIME2     NOT NULL CONSTRAINT DF_RMOneInvite_UpdatedAt DEFAULT GETUTCDATE(),
      CONSTRAINT UQ_RMOneInvite_Hash UNIQUE (TokenHash),
      CONSTRAINT UQ_RMOneInvite_User UNIQUE (TenantKey, UserGuid)
    )
  `);
  _tableEnsured = true;
}

// Upsert an invite token row (insert or replace by TenantKey+UserGuid).
export async function upsertInviteToken(opts: {
  tenantKey: string; tenantLabel: string; userGuid: string;
  email: string; name: string; tokenHash: string; expiresAt: Date;
}): Promise<void> {
  const pool = await getPool();
  await ensureInviteTable(pool);
  await pool.request()
    .input("tk", sql.NVarChar, opts.tenantKey)
    .input("tl", sql.NVarChar, opts.tenantLabel)
    .input("ug", sql.NVarChar, opts.userGuid)
    .input("em", sql.NVarChar, opts.email)
    .input("nm", sql.NVarChar, opts.name)
    .input("th", sql.NVarChar, opts.tokenHash)
    .input("ea", sql.DateTime2, opts.expiresAt)
    .query(`
      MERGE core2.dbo.RMOneInviteTokens AS T
      USING (SELECT @tk TenantKey, @tl TenantLabel, @ug UserGuid,
                    @em Email, @nm Name, @th TokenHash, @ea ExpiresAt) AS S
      ON T.TenantKey = S.TenantKey AND T.UserGuid = S.UserGuid
      WHEN MATCHED THEN UPDATE SET
        TenantLabel = S.TenantLabel, Email = S.Email, Name = S.Name,
        TokenHash = S.TokenHash, Status = N'sent', ExpiresAt = S.ExpiresAt,
        SentAt = GETUTCDATE(), AcceptedAt = NULL, UpdatedAt = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT
        (TenantKey, TenantLabel, UserGuid, Email, Name, TokenHash, Status, ExpiresAt, SentAt, UpdatedAt)
        VALUES (S.TenantKey, S.TenantLabel, S.UserGuid, S.Email, S.Name,
                S.TokenHash, N'sent', S.ExpiresAt, GETUTCDATE(), GETUTCDATE());
    `);
}

// Void any not-yet-accepted invite for a user. Called when their login email
// changes: an invite already sent to the old (possibly wrong) address must not
// remain able to claim the account. Accepted rows are kept as history.
export async function voidPendingInvite(userGuid: string): Promise<void> {
  const pool = await getPool();
  await ensureInviteTable(pool);
  await pool.request()
    .input("ug", sql.NVarChar, userGuid)
    .query(`DELETE FROM core2.dbo.RMOneInviteTokens
            WHERE LOWER(UserGuid) = LOWER(@ug) AND Status = N'sent'`);
}

// Look up an invite row by token hash (no state change).
export async function lookupInviteToken(tokenHash: string): Promise<InviteRow | null> {
  const pool = await getPool();
  await ensureInviteTable(pool);
  const r = await pool.request()
    .input("th", sql.NVarChar, tokenHash)
    .query(`
      SELECT TOP 1
        ID AS id, TenantKey AS tenantKey, TenantLabel AS tenantLabel,
        UserGuid AS userGuid, Email AS email, Name AS name, TokenHash AS tokenHash,
        Status AS status, ExpiresAt AS expiresAt, SentAt AS sentAt, AcceptedAt AS acceptedAt
      FROM core2.dbo.RMOneInviteTokens
      WHERE TokenHash = @th
    `);
  if (!r.recordset.length) return null;
  const row = r.recordset[0] as Record<string, unknown>;
  return {
    id:          Number(row.id),
    tenantKey:   String(row.tenantKey   ?? ""),
    tenantLabel: String(row.tenantLabel ?? ""),
    userGuid:    String(row.userGuid    ?? ""),
    email:       String(row.email       ?? ""),
    name:        String(row.name        ?? ""),
    tokenHash:   String(row.tokenHash   ?? ""),
    status:      String(row.status      ?? ""),
    expiresAt:   new Date(row.expiresAt as string),
    sentAt:      new Date(row.sentAt    as string),
    acceptedAt:  row.acceptedAt ? new Date(row.acceptedAt as string) : null,
  };
}

// Atomically claim a token (sent→accepted). Returns the row if claimed, null if already used/expired.
export async function claimInviteToken(tokenHash: string): Promise<InviteRow | null> {
  const pool = await getPool();
  await ensureInviteTable(pool);
  const r = await pool.request()
    .input("th", sql.NVarChar, tokenHash)
    .query(`
      UPDATE core2.dbo.RMOneInviteTokens
      SET Status = N'accepted', AcceptedAt = GETUTCDATE(), UpdatedAt = GETUTCDATE()
      OUTPUT
        INSERTED.ID AS id, INSERTED.TenantKey AS tenantKey, INSERTED.TenantLabel AS tenantLabel,
        INSERTED.UserGuid AS userGuid, INSERTED.Email AS email, INSERTED.Name AS name,
        INSERTED.TokenHash AS tokenHash, INSERTED.Status AS status,
        INSERTED.ExpiresAt AS expiresAt, INSERTED.SentAt AS sentAt, INSERTED.AcceptedAt AS acceptedAt
      WHERE TokenHash = @th AND Status = N'sent' AND ExpiresAt > GETUTCDATE()
    `);
  if (!r.recordset.length) return null;
  const row = r.recordset[0] as Record<string, unknown>;
  return {
    id:          Number(row.id),
    tenantKey:   String(row.tenantKey   ?? ""),
    tenantLabel: String(row.tenantLabel ?? ""),
    userGuid:    String(row.userGuid    ?? ""),
    email:       String(row.email       ?? ""),
    name:        String(row.name        ?? ""),
    tokenHash:   String(row.tokenHash   ?? ""),
    status:      String(row.status      ?? ""),
    expiresAt:   new Date(row.expiresAt as string),
    sentAt:      new Date(row.sentAt    as string),
    acceptedAt:  row.acceptedAt ? new Date(row.acceptedAt as string) : null,
  };
}

// Release a previously claimed token (compensate on password-write failure).
export async function releaseInviteToken(id: number): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input("id", sql.Int, id)
    .query(`UPDATE core2.dbo.RMOneInviteTokens
            SET Status = N'sent', AcceptedAt = NULL, UpdatedAt = GETUTCDATE()
            WHERE ID = @id`);
}

// Get all invite rows for a tenant (for the invite status list).
export async function getInvitesByTenantKey(tenantKey: string): Promise<InviteRow[]> {
  const pool = await getPool();
  await ensureInviteTable(pool);
  const r = await pool.request()
    .input("tk", sql.NVarChar, tenantKey)
    .query(`
      SELECT
        ID AS id, TenantKey AS tenantKey, TenantLabel AS tenantLabel,
        UserGuid AS userGuid, Email AS email, Name AS name, TokenHash AS tokenHash,
        Status AS status, ExpiresAt AS expiresAt, SentAt AS sentAt, AcceptedAt AS acceptedAt
      FROM core2.dbo.RMOneInviteTokens
      WHERE TenantKey = @tk
    `);
  return (r.recordset as Record<string, unknown>[]).map(row => ({
    id:          Number(row.id),
    tenantKey:   String(row.tenantKey   ?? ""),
    tenantLabel: String(row.tenantLabel ?? ""),
    userGuid:    String(row.userGuid    ?? ""),
    email:       String(row.email       ?? ""),
    name:        String(row.name        ?? ""),
    tokenHash:   String(row.tokenHash   ?? ""),
    status:      String(row.status      ?? ""),
    expiresAt:   new Date(row.expiresAt as string),
    sentAt:      new Date(row.sentAt    as string),
    acceptedAt:  row.acceptedAt ? new Date(row.acceptedAt as string) : null,
  }));
}

// ── Main invite sender ────────────────────────────────────────────────────────
export async function sendSetPasswordInvite(opts: {
  tid: string;
  tenantLabel: string;
  userGuid: string;
  email: string;
  name: string;
}): Promise<InviteResult> {
  const email = (opts.email || "").trim();
  const base = publicBaseUrl();
  if (!base) return { ok: false, emailed: false, message: "Public app URL is not configured (set APP_PUBLIC_URL)." };
  if (!email.includes("@")) return { ok: false, emailed: false, message: "No valid email address on file." };

  const tenantKey = normTenantKey(opts.tenantLabel);
  const rawToken  = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600_000);
  const scrambled = hashPassword(crypto.randomBytes(24).toString("hex"));
  const link = `${base}/set-password?token=${rawToken}`;

  // Scramble the password in Postgres (replaces UPDATE AspNetUsers SET PasswordHash).
  const idLow = opts.userGuid.toLowerCase();
  await updateUser(opts.tid, idLow, { passwordHash: scrambled, updatedAt: new Date() });
  // Keep SQL Server pool warm for downstream queries (getPool side-effect).
  const pool = await getPool();

  await upsertInviteToken({ tenantKey, tenantLabel: opts.tenantLabel, userGuid: opts.userGuid, email, name: opts.name, tokenHash, expiresAt });

  const firstName = (opts.name || "").split(/\s+/)[0] || "there";
  const body = [
    `Hi ${firstName},`,
    ``,
    `An account has been created for you on ${opts.tenantLabel}'s RM ONE workspace.`,
    `To finish setting up, please choose your own password:`,
    ``,
    `  Set Up Your Account: ${link}`,
    ``,
    `This link is unique to you and expires in ${INVITE_TTL_HOURS} hours.`,
    `For your security, please don't share it with anyone.`,
    ``,
    `Please do not reply to this email — it is sent from an automated, unmonitored address.`,
  ].join("\n");

  const htmlBody = `<div style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#333;max-width:560px;">
<p style="margin:0 0 4px 0;font-size:22px;font-weight:900;letter-spacing:-0.5px;"><span style="color:#253746;">RM&nbsp;</span><span style="color:#6BA539;">ONE</span></p>
<hr style="border:none;border-top:3px solid #6BA539;margin:0 0 24px 0;">
<p style="margin:0 0 12px 0;">Hi <strong>${firstName}</strong>,</p>
<p style="margin:0 0 12px 0;">An account has been created for you on <strong>${opts.tenantLabel}</strong>'s RM ONE workspace.<br>
Click the button below to choose your own password and get started.</p>
<p style="margin:28px 0;">
  <a href="${link}" style="display:inline-block;background:#6BA539;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:13px 32px;border-radius:8px;letter-spacing:0.3px;">Set Up Your Account</a>
</p>
<p style="margin:0 0 8px 0;font-size:13px;color:#666;">This link expires in <strong>${INVITE_TTL_HOURS} hours</strong> and can only be used once. Please don't share it with anyone.</p>
<p style="margin:0 0 24px 0;font-size:13px;color:#888;">Please do not reply to this email — it is sent from an automated, unmonitored address.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px 0;">
<p style="margin:0;font-size:13px;color:#999;">Best regards,<br><strong style="color:#333;">${opts.tenantLabel}</strong><br><span style="font-size:12px;">via <span style="color:#253746;font-weight:bold;">RM&nbsp;</span><span style="color:#6BA539;font-weight:bold;">ONE</span></span></p>
</div>`;

  const result = await sendEmail({
    to: [email],
    subject: `Set up your ${opts.tenantLabel} RM ONE account`,
    body,
    htmlBody,
    senderDisplayName: opts.tenantLabel,
    noReply: true,
  });

  return { ok: true, emailed: result.ok, link, message: result.ok ? undefined : result.message };
}
