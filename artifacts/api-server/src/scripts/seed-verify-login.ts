/**
 * Seed / repair the designated VERIFICATION login for the "testrmone" tenant.
 *
 * Purpose (task: keep a working saved test-tenant login):
 *   Production incidents are verified end-to-end with a normal password login
 *   (POST /api/rmone/token) as agent@testrmone.com, whose password is the
 *   RMONE_PASSWORD workspace secret. This script creates that account if it is
 *   missing, or re-points its password at the CURRENT value of RMONE_PASSWORD
 *   if it drifted. It NEVER touches any other account — a before/after
 *   snapshot of every other row in the tenant is asserted byte-identical.
 *
 * The account:
 *   username  agent@testrmone.com          (tenant "testrmone")
 *   password  process.env.RMONE_PASSWORD   (never hardcoded here)
 *   acl       admin (isSiteAdmin) — full tenant admin so both read and write
 *             paths can be exercised during incident verification.
 *
 * Canonical identity lives in SQL Server rmoneapp dbo.rmone_users
 * (APP_DATABASE_URL), which dev preview AND the published VM share — running
 * this once makes the login valid in BOTH environments immediately.
 * The account is app-managed (post-migration): rmone_users only, no legacy
 * core2 AspNetUsers mirror row (see lib/user-store.ts header).
 *
 * Idempotent. Run from the api-server package root (node_modules resolution):
 *   cd artifacts/api-server && pnpm exec tsx src/scripts/seed-verify-login.ts
 */

import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { getUsersByTenant } from "@workspace/db";
import { hashPassword } from "../lib/pipeline.js";
import { verifyPassword, lookupUserForLogin } from "../lib/rds-auth.js";
import { createAppUser, updateAppUser } from "../lib/user-store.js";

const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const TENANT_LABEL     = "testrmone";
const TID              = uuidv5(TENANT_LABEL, TENANT_NAMESPACE);

const USERNAME     = "agent@testrmone.com";
const DISPLAY_NAME = "Verification Agent";

interface OtherRowSnapshot {
  username: string;
  passwordHash: string | null;
  enabled: boolean;
  deleted: boolean;
}

async function main() {
  const pw = process.env.RMONE_PASSWORD ?? "";
  if (!pw.trim()) {
    console.error("✗ RMONE_PASSWORD is not set in the environment — aborting (nothing written).");
    process.exit(1);
  }

  console.log(`Tenant: ${TENANT_LABEL} (${TID})`);
  console.log(`Account: ${USERNAME}`);

  // ── Snapshot every OTHER account before writing anything ──────────────────
  const before = await getUsersByTenant(TID);
  const othersBefore = new Map<string, OtherRowSnapshot>();
  for (const u of before) {
    if (u.username !== USERNAME) {
      othersBefore.set(u.id, {
        username: u.username,
        passwordHash: u.passwordHash,
        enabled: u.enabled,
        deleted: u.deleted,
      });
    }
  }
  console.log(`Existing accounts in tenant: ${before.length} (${othersBefore.size} others — must stay untouched)`);

  const existing = before.find(u => u.username === USERNAME);
  const hash = hashPassword(pw);

  if (existing) {
    // Repair path: this is OUR designated verification account — resetting its
    // password to match the stored secret is exactly the point of this script.
    await updateAppUser(TID, existing.id, {
      passwordHash: hash,
      enabled: true,
      deleted: false,
      isSiteAdmin: true,
      accessLevel: "admin",
      name: DISPLAY_NAME,
    });
    console.log(`↺ Repaired existing account (id ${existing.id}): password re-synced to RMONE_PASSWORD, enabled, admin.`);
  } else {
    await createAppUser({
      id:           uuidv4(),
      tenantId:     TID,
      username:     USERNAME,
      name:         DISPLAY_NAME,
      email:        USERNAME,
      passwordHash: hash,
      title:        DISPLAY_NAME,
      isSiteAdmin:  true,
      accessLevel:  "admin",
      isManager:    false,
      enabled:      true,
      deleted:      false,
    });
    console.log("+ Created verification account.");
  }

  // ── Verify the login round-trip the same way /token does ──────────────────
  const row = await lookupUserForLogin(TENANT_LABEL, USERNAME);
  if (!row) { console.error("✗ VERIFY FAILED: account not found via login lookup."); process.exit(1); }
  if (!row.enabled) { console.error("✗ VERIFY FAILED: account not enabled."); process.exit(1); }
  if (!verifyPassword(pw, row.passwordHash)) {
    console.error("✗ VERIFY FAILED: stored hash does not verify against RMONE_PASSWORD.");
    process.exit(1);
  }
  console.log(`✓ Login lookup OK — enabled, acl=${row.accessLevel}, password verifies against RMONE_PASSWORD.`);

  // ── Assert no other account was modified ───────────────────────────────────
  const after = await getUsersByTenant(TID);
  let clean = true;
  for (const u of after) {
    if (u.username === USERNAME) continue;
    const snap = othersBefore.get(u.id);
    if (!snap) { console.error(`✗ UNEXPECTED new row appeared: ${u.username}`); clean = false; continue; }
    if (snap.passwordHash !== u.passwordHash || snap.enabled !== u.enabled || snap.deleted !== u.deleted) {
      console.error(`✗ ACCOUNT DRIFT: ${u.username} changed (hash/enabled/deleted) — investigate immediately.`);
      clean = false;
    }
    othersBefore.delete(u.id);
  }
  for (const [, snap] of othersBefore) {
    console.error(`✗ ACCOUNT MISSING after run: ${snap.username}`);
    clean = false;
  }
  if (!clean) process.exit(1);
  console.log(`✓ All ${after.filter(u => u.username !== USERNAME).length} other accounts byte-identical (hash/enabled/deleted).`);

  console.log("\nDone. Normal password login now works with:");
  console.log(`  tenant=${TENANT_LABEL} username=${USERNAME} password=$RMONE_PASSWORD`);
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
