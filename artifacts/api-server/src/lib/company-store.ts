// ── Company ID (CRMCompany.TicketId) minting + manual company creation ──────
//
// Shared primitives for the "Company IDs everywhere" feature:
//   • mint per-tenant COM-YY-NNNNNN ticket IDs into CRMCompany.TicketId
//   • backfill legacy rows that predate company IDs (ensureCompanyTicketIds)
//   • create ONE company safely (dup-name / dup-ID guarded) — used by the web
//     "New Company" modal, the import review "create-company" action, and
//     nothing else. Imports themselves NEVER auto-create companies from
//     record-sheet names anymore (strict-ID policy); only the Companies sheet
//     and explicit admin review decisions create rows.
//
// Why a separate module: both the import pipeline and the interactive API
// (rds-provider / rmone-proxy / onboarding review actions) need the exact same
// primitives. pipeline.ts exports execInsert but ALSO imports this module, so
// to avoid an import cycle this file does its own live-column-filtered INSERT:
// callers pass the live CRMCompany column set (rds-provider tableColumns /
// pipeline getColumnSets) and anything absent from the live schema is silently
// dropped — the same schema-drift contract as execInsert.
//
// Concurrency model: one tenant's imports are serialized by the import lease,
// but a web "New Company" can race an import or another admin. Everything that
// mints or checks uniqueness runs inside ONE transaction holding the
// tenant-scoped applock `rmone:com-ids:<tid>` (transaction-owner, same pattern
// as onboarding's tenant locks), with UPDLOCK/HOLDLOCK on the scan queries so
// two concurrent transactions can't read the same MAX sequence. The filtered
// unique index UX_CRMCompany_Tenant_TicketId backstops anything that slips
// through (e.g. a bulk path that mints outside a lock); createCompanyCore
// retries once on a unique-key violation when the ID was auto-minted.

import sql from "mssql";
import { getPool } from "./db.js";

// Live-column set contract — rds-provider's CISet (case-insensitive Set) and
// pipeline's getColumnSets values are both structurally compatible. Callers
// that pass a plain Set<string> must lowercase... don't: pass a CI set. All
// probes below go through liveHas() which tries the raw name only — CISet is
// case-insensitive internally, and pipeline sets are lowercased, so probe with
// the exact casing the caller's set expects via the `lowercased` flag.
export type LiveColSet = { has(name: string): boolean };

const liveHas = (live: LiveColSet, col: string): boolean =>
  live.has(col) || live.has(col.toLowerCase());

export const COMPANY_TICKET_PREFIX = "COM";

// Custom company IDs must never collide with record-module routing:
// resolveTicketMod routes by startsWith("OPM")/("LEM")/… BEFORE any lookup, so
// the guard is prefix-based with no dash requirement (at least as strict as
// the router — mirrors userSuppliedRecordId in pipeline.ts). ACR/SVC are
// reserved for future modules per the create-record contract.
export const RESERVED_COMPANY_ID_PREFIX_RE = /^(PMM|OPM|LEM|ACR|SVC)/i;

// Max length for a custom company ID. CRMCompany.TicketId is a varchar wide
// enough for record tickets (13 chars); 32 keeps custom file IDs comfortable
// while staying far from any plausible column cap.
export const COMPANY_ID_MAX_LEN = 32;

// LOCKSTEP with normalizeTicketId in pipeline.ts (duplicated to avoid the
// pipeline → company-store → pipeline import cycle): trim, collapse spaced
// dashes ("COM - 12" → "COM-12"), collapse runs of whitespace.
export function normalizeCompanyTicketId(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
}

// COM-YY-NNNNNN — same shape as generateTicketId("COM", seq) in pipeline.ts.
// Sequence restarts each calendar year (established convention for PMM/OPM/
// LEM); uniqueness holds because the year is embedded in the string.
export function formatCompanyTicketId(seq: number): string {
  const yy = new Date().getFullYear().toString().slice(2);
  return `${COMPANY_TICKET_PREFIX}-${yy}-${String(seq).padStart(6, "0")}`;
}

// Validate a normalized custom ID. Returns null when OK, else a user-facing
// reason. Blank is NOT valid here — callers treat blank as "auto-mint".
export function customCompanyIdProblem(cleaned: string): string | null {
  if (!cleaned) return "Company ID is empty.";
  if (cleaned.length > COMPANY_ID_MAX_LEN) {
    return `Company ID is too long (max ${COMPANY_ID_MAX_LEN} characters).`;
  }
  if (RESERVED_COMPANY_ID_PREFIX_RE.test(cleaned)) {
    const p = cleaned.slice(0, 3).toUpperCase();
    return `The ID "${cleaned}" starts with the reserved prefix "${p}", which is used for a different record type. Please choose a different ID.`;
  }
  return null;
}

type Reqable = sql.ConnectionPool | sql.Transaction;

// mssql's Request constructor overloads don't accept the union directly —
// narrow with instanceof so each branch hits a concrete overload.
const mkRequest = (r: Reqable): sql.Request =>
  r instanceof sql.Transaction ? new sql.Request(r) : new sql.Request(r);

// Transaction-scoped applock serializing all company-ID mints for a tenant.
// MUST be called on a Transaction (LockOwner='Transaction' → auto-released at
// commit/rollback). Throws on timeout so callers fail loudly, never mint blind.
export async function acquireCompanyIdLock(tx: sql.Transaction, tenantId: string): Promise<void> {
  await new sql.Request(tx)
    .input("res", sql.NVarChar, `rmone:com-ids:${tenantId}`)
    .query(`DECLARE @r INT;
            EXEC @r = sp_getapplock @Resource=@res, @LockMode='Exclusive',
                                    @LockOwner='Transaction', @LockTimeout=8000;
            IF @r < 0 THROW 51000, 'company-id lock timeout', 1;`);
}

// Highest existing COM-<currentYY>-NNNNNN sequence for the tenant. With
// `lock: true` (inside a transaction) the scan takes UPDLOCK+HOLDLOCK so the
// key range stays stable until commit — two concurrent minting transactions
// serialize instead of both reading the same max.
export async function nextCompanySeq(
  reqable: Reqable,
  tenantId: string,
  opts?: { lock?: boolean },
): Promise<number> {
  const yy = new Date().getFullYear().toString().slice(2);
  const hint = opts?.lock ? "WITH (UPDLOCK, HOLDLOCK)" : "";
  // SUBSTRING after the 'COM-YY-' prefix (7 chars) instead of RIGHT(…,6) with
  // a LEN=13 gate: sequences past 999999 grow to 7-8 digits (see both mint
  // sites) and MUST advance this scan, or every later mint re-reads the same
  // max and collides with the unique index forever. TRY_CAST NULLs out
  // multi-segment custom IDs (e.g. COM-26-12-34) so they never poison MAX().
  const r = await mkRequest(reqable)
    .input("tid", sql.NVarChar, tenantId)
    .query(`SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(TicketId, 8, 12) AS INT)), 0) AS maxSeq
            FROM core2.dbo.CRMCompany ${hint}
            WHERE TenantID=@tid AND TicketId LIKE 'COM-${yy}-%'`);
  return ((r.recordset?.[0]?.maxSeq as number) ?? 0) + 1;
}

// Filtered unique index backstopping ID uniqueness per tenant. Idempotent,
// best-effort (some managed tenants may deny DDL — the applock path is the
// primary guard; the index is defense in depth). Once per process.
let indexEnsureDone = false;
export async function ensureCompanyTicketIndex(pool: sql.ConnectionPool): Promise<void> {
  if (indexEnsureDone) return;
  indexEnsureDone = true; // set FIRST — a failing CREATE shouldn't retry every call
  try {
    await pool.request().query(
      `IF NOT EXISTS (SELECT 1 FROM core2.sys.indexes
                      WHERE name = 'UX_CRMCompany_Tenant_TicketId'
                        AND object_id = OBJECT_ID('core2.dbo.CRMCompany'))
       CREATE UNIQUE NONCLUSTERED INDEX UX_CRMCompany_Tenant_TicketId
         ON core2.dbo.CRMCompany (TenantID, TicketId)
         WHERE TicketId IS NOT NULL AND TicketId <> '' AND Deleted = 0;`,
    );
  } catch (e) {
    console.warn(`[company-store] ensureCompanyTicketIndex skipped: ${String((e as Error)?.message ?? e)}`);
  }
}

// ── Backfill: stamp COM IDs onto every legacy row missing one ───────────────
// Adoption-friendly timing: NOT run by the import pipeline pre-pass. Fired by
// (a) the web Companies tab (editor-gated POST /companies/ensure-ids) and
// (b) the pipeline right after a companies sheet is processed. Entirely
// atomic: applock → max-scan → ONE set-based ROW_NUMBER update → commit.
export async function ensureCompanyTicketIds(
  tenantId: string,
): Promise<{ minted: number; total: number; skipped?: string }> {
  // REAL pool, NOT the getLivePool() facade: this function opens an explicit
  // sql.Transaction, and tedious requires an actual ConnectionPool parent —
  // the facade only forwards request/transaction, so Transaction internals
  // hit a missing .acquire() and kill the whole worker with an async
  // TypeError (observed as 502s on every create/ensure-ids call). Short
  // transactions on a captured real pool match every other
  // `new sql.Transaction(pool)` site in rds-provider.
  const pool = await getPool();

  // Live-schema guard: tenants whose CRMCompany lacks TicketId (drift) skip
  // cleanly instead of erroring every Companies-tab visit.
  const colChk = await pool.request().query(
    `SELECT COUNT(*) AS n FROM core2.INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='CRMCompany' AND COLUMN_NAME='TicketId'`,
  );
  if (((colChk.recordset?.[0]?.n as number) ?? 0) === 0) {
    return { minted: 0, total: 0, skipped: "CRMCompany has no TicketId column" };
  }

  await ensureCompanyTicketIndex(pool);

  const yy = new Date().getFullYear().toString().slice(2);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await acquireCompanyIdLock(tx, tenantId);
    const base = (await nextCompanySeq(tx, tenantId)) - 1; // applock already serializes
    const upd = await new sql.Request(tx)
      .input("tid", sql.NVarChar, tenantId)
      .input("base", sql.Int, base)
      .query(
        // Deterministic ORDER BY ID → re-runs are stable; soft-deleted rows
        // stay unstamped (invisible + excluded from the filtered index).
        `;WITH need AS (
           SELECT ID, ROW_NUMBER() OVER (ORDER BY ID) AS rn
           FROM core2.dbo.CRMCompany
           WHERE TenantID=@tid AND (Deleted = 0 OR Deleted IS NULL)
             AND (TicketId IS NULL OR LTRIM(RTRIM(TicketId)) = '')
         )
         UPDATE c SET TicketId = 'COM-${yy}-' +
           -- 6-digit zero-pad below the ceiling; ABOVE it the number simply
           -- grows (7-8 digits). VARCHAR(6) overflowed at >999999 (a custom
           -- ID near the ceiling wedged the whole backfill), and RIGHT(…,6)
           -- would truncate grown sequences into colliding IDs.
           CASE WHEN @base + n.rn > 999999 THEN CAST(@base + n.rn AS VARCHAR(12))
                ELSE RIGHT('000000' + CAST(@base + n.rn AS VARCHAR(12)), 6) END
         FROM core2.dbo.CRMCompany c
         JOIN need n ON n.ID = c.ID;
         SELECT @@ROWCOUNT AS minted;`,
      );
    await tx.commit();
    const minted = Number(
      (upd.recordsets as sql.IRecordSet<{ minted: number }>[])?.slice(-1)[0]?.[0]?.minted ??
      (upd.recordset?.[0]?.minted as number | undefined) ?? 0,
    );
    const tot = await pool.request()
      .input("tid", sql.NVarChar, tenantId)
      .query(`SELECT COUNT(*) AS n FROM core2.dbo.CRMCompany
              WHERE TenantID=@tid AND (Deleted = 0 OR Deleted IS NULL)`);
    if (minted > 0) console.log(`[company-store] backfilled ${minted} company IDs (tenant=${tenantId})`);
    return { minted, total: (tot.recordset?.[0]?.n as number) ?? 0 };
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw e;
  }
}

// ── Create ONE company (dup-guarded, ID minted or adopted) ───────────────────
export type CreateCompanyInput = {
  tenantId: string;
  title: string;
  // Custom ID (verbatim after normalize); blank/undefined → auto-mint.
  ticketId?: string | null;
  // Optional extra live columns, already keyed by REAL column name
  // (ClientMarketSector, CRMHealth, Telephone, EmailAddress, WebsiteUrl,
  // StreetAddress1, City, State, Zip, ClientRep, …). Blank values are skipped.
  fields?: Record<string, string | null | undefined>;
  divisionName?: string | null; // resolved to DivisionLookup best-effort
  createdBy?: string | null;
  live: LiveColSet; // live CRMCompany columns (tableColumns / getColumnSets)
};

export type CreateCompanyResult =
  | { ok: true; id: number; ticketId: string; title: string }
  | { ok: false; code: "bad-title" | "bad-id" | "dup-title" | "dup-id"; error: string;
      existing?: { id: number; ticketId: string | null; title: string } };

// Best-effort Division name → CompanyDivisions.ID (DivTitle is the canonical
// title column; some tenants use Title). Never throws.
export async function resolveDivisionIdByName(
  pool: sql.ConnectionPool,
  tenantId: string,
  name: string,
): Promise<number | null> {
  const wanted = (name || "").trim().toLowerCase();
  if (!wanted) return null;
  for (const col of ["DivTitle", "Title"]) {
    try {
      const r = await pool.request()
        .input("tid", sql.NVarChar, tenantId)
        .input("t", sql.NVarChar, wanted)
        .query(`SELECT TOP 1 ID FROM core2.dbo.CompanyDivisions
                WHERE TenantID=@tid AND LOWER(LTRIM(RTRIM([${col}]))) = @t
                ORDER BY ID`);
      const id = r.recordset?.[0]?.ID;
      if (id != null) return Number(id);
      return null; // column exists, no match — done
    } catch { /* column missing on this tenant — try the fallback name */ }
  }
  return null;
}

const DUP_KEY_ERRNOS = new Set([2601, 2627]);

export async function createCompanyCore(input: CreateCompanyInput): Promise<CreateCompanyResult> {
  const title = (input.title || "").trim();
  if (!title) return { ok: false, code: "bad-title", error: "Company name is required." };
  if (title.length > 255) return { ok: false, code: "bad-title", error: "Company name is too long (max 255 characters)." };

  let customId = "";
  if (input.ticketId != null && String(input.ticketId).trim() !== "") {
    customId = normalizeCompanyTicketId(input.ticketId);
    const problem = customCompanyIdProblem(customId);
    if (problem) return { ok: false, code: "bad-id", error: problem };
  }

  // REAL pool (see ensureCompanyTicketIds): explicit transactions below need
  // a true ConnectionPool parent — the getLivePool() facade crashes tedious.
  const pool = await getPool();
  await ensureCompanyTicketIndex(pool);

  const hasTicketCol = liveHas(input.live, "TicketId");
  const divId = input.divisionName && liveHas(input.live, "DivisionLookup")
    ? await resolveDivisionIdByName(pool, input.tenantId, input.divisionName)
    : null;

  // Auto-mint retry: a bulk path minting outside the applock could take our
  // sequence between commit-time; the unique index turns that into error
  // 2601/2627 — re-mint once. Custom IDs never retry (a dup there is a real
  // user-facing conflict).
  const maxAttempts = customId ? 1 : 2;
  for (let attempt = 1; ; attempt++) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await acquireCompanyIdLock(tx, input.tenantId);

      // Dup-name guard (case-insensitive on trimmed Title, live rows only).
      // UPDLOCK+HOLDLOCK: a concurrent create of the same name blocks here
      // until we commit, then sees our row.
      const dupT = await new sql.Request(tx)
        .input("tid", sql.NVarChar, input.tenantId)
        .input("t", sql.NVarChar, title.toLowerCase())
        .query(`SELECT TOP 1 ID, TicketId, Title FROM core2.dbo.CRMCompany WITH (UPDLOCK, HOLDLOCK)
                WHERE TenantID=@tid AND (Deleted = 0 OR Deleted IS NULL)
                  AND LOWER(LTRIM(RTRIM(Title))) = @t`);
      const exT = dupT.recordset?.[0];
      if (exT) {
        await tx.rollback();
        return {
          ok: false, code: "dup-title",
          error: `A company named "${String(exT.Title ?? title)}" already exists${exT.TicketId ? ` (${String(exT.TicketId)})` : ""}.`,
          existing: { id: Number(exT.ID), ticketId: exT.TicketId ? String(exT.TicketId) : null, title: String(exT.Title ?? "") },
        };
      }

      let ticketId = customId;
      if (hasTicketCol && customId) {
        // Dup-ID guard with the whitespace bridge (REPLACE compare) so a
        // legacy spaced variant can't coexist with its clean form.
        const dupI = await new sql.Request(tx)
          .input("tid", sql.NVarChar, input.tenantId)
          .input("id", sql.VarChar, customId)
          .query(`SELECT TOP 1 ID, TicketId, Title FROM core2.dbo.CRMCompany WITH (UPDLOCK, HOLDLOCK)
                  WHERE TenantID=@tid AND (Deleted = 0 OR Deleted IS NULL)
                    AND (TicketId = @id OR REPLACE(TicketId, ' ', '') = REPLACE(@id, ' ', ''))`);
        const exI = dupI.recordset?.[0];
        if (exI) {
          await tx.rollback();
          return {
            ok: false, code: "dup-id",
            error: `The ID "${customId}" is already used by company "${String(exI.Title ?? "")}". Please choose a different ID.`,
            existing: { id: Number(exI.ID), ticketId: exI.TicketId ? String(exI.TicketId) : null, title: String(exI.Title ?? "") },
          };
        }
      } else if (hasTicketCol) {
        ticketId = formatCompanyTicketId(await nextCompanySeq(tx, input.tenantId, { lock: true }));
      }

      // Live-column-filtered INSERT (execInsert contract, local to avoid the
      // pipeline import cycle). CRMCompany.ID is identity — proven by the
      // existing plain-INSERT create path — so OUTPUT INSERTED.ID is safe.
      const req = new sql.Request(tx)
        .input("tid", sql.NVarChar, input.tenantId)
        .input("title", sql.NVarChar, title);
      const cols: string[] = ["[TenantID]", "[Title]"];
      const vals: string[] = ["@tid", "@title"];
      const add = (col: string, param: string, type: sql.ISqlTypeFactoryWithNoParams | typeof sql.NVarChar, value: unknown): void => {
        if (!liveHas(input.live, col)) return;
        req.input(param, type as never, value as never);
        cols.push(`[${col}]`);
        vals.push(`@${param}`);
      };
      if (hasTicketCol && ticketId) add("TicketId", "tick", sql.VarChar, ticketId);
      add("Deleted", "del", sql.Bit, 0);
      add("Created", "created", sql.DateTime, new Date());
      add("CreatedByUser", "by", sql.NVarChar, (input.createdBy ?? "").slice(0, 256) || null);
      if (divId != null) add("DivisionLookup", "divid", sql.BigInt, divId);
      for (const [col, raw] of Object.entries(input.fields ?? {})) {
        const v = raw == null ? "" : String(raw).trim();
        if (!v) continue;
        add(col, `f${cols.length}`, sql.NVarChar, v);
      }

      const ins = await req.query(
        `INSERT INTO core2.dbo.CRMCompany (${cols.join(", ")})
         OUTPUT INSERTED.[ID] VALUES (${vals.join(", ")})`,
      );
      await tx.commit();
      const id = Number(ins.recordset?.[0]?.ID);
      console.log(`[company-store] created company "${title}" → ${ticketId || "(no id col)"} / #${id} (tenant=${input.tenantId})`);
      return { ok: true, id, ticketId: ticketId || String(id), title };
    } catch (e) {
      try { await tx.rollback(); } catch { /* commit raced/already rolled back */ }
      const num = Number((e as { number?: number })?.number ?? NaN);
      if (!customId && DUP_KEY_ERRNOS.has(num) && attempt < maxAttempts) {
        console.warn(`[company-store] minted ID collided (attempt ${attempt}) — re-minting`);
        continue;
      }
      throw e;
    }
  }
}
