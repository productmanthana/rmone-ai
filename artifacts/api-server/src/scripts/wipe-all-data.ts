/**
 * Wipes ALL rows from every user table in core2 in one server-side batch.
 * Uses a cursor with TRY/CATCH per table so one bad table doesn't abort the rest.
 * FK constraints are disabled before deletion and left disabled (empty tables
 * have no violations — the onboarding flow will handle data integrity on import).
 */
import { getPool } from "../lib/db.js";

async function main() {
  console.log("[wipe] Connecting...");
  const pool = await getPool();

  console.log("[wipe] Disabling all FK constraints in core2...");
  await pool.request().query(`
    USE core2;
    EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL';
  `);

  console.log("[wipe] Deleting all rows (server-side cursor, TRY/CATCH per table)...");
  const result = await pool.request().query(`
    USE core2;
    DECLARE @tbl  NVARCHAR(256);
    DECLARE @sql  NVARCHAR(512);
    DECLARE @rows INT;
    DECLARE @deleted INT = 0;
    DECLARE @skipped INT = 0;

    DECLARE cur CURSOR FAST_FORWARD FOR
      SELECT TABLE_NAME
      FROM   INFORMATION_SCHEMA.TABLES
      WHERE  TABLE_TYPE = 'BASE TABLE'
      ORDER  BY TABLE_NAME;

    OPEN cur;
    FETCH NEXT FROM cur INTO @tbl;

    WHILE @@FETCH_STATUS = 0
    BEGIN
      BEGIN TRY
        SET @sql = N'DELETE FROM [' + @tbl + N']; SET @r = @@ROWCOUNT;';
        EXEC sp_executesql @sql, N'@r INT OUTPUT', @r = @rows OUTPUT;
        SET @deleted = @deleted + ISNULL(@rows, 0);
      END TRY
      BEGIN CATCH
        SET @skipped = @skipped + 1;
      END CATCH
      FETCH NEXT FROM cur INTO @tbl;
    END

    CLOSE cur;
    DEALLOCATE cur;

    SELECT @deleted AS TotalDeleted, @skipped AS TablesSkipped;
  `);

  const row = result.recordset?.[0];
  console.log(`[wipe] Done — ${row?.TotalDeleted ?? "?"} rows deleted, ${row?.TablesSkipped ?? "?"} tables skipped.`);
  await pool.close();
}

main().catch((e) => { console.error("[wipe] FATAL:", e.message); process.exit(1); });
