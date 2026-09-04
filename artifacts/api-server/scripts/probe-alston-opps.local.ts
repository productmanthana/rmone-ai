/** READ-ONLY probe: Alston AI — why do opportunities show "No lifecycle assigned"? */
import sql from "mssql";
import { getPool } from "../src/lib/db.js";
import { resolveTenantId } from "../src/lib/pipeline.js";
import { loadEffectiveDefaults } from "../src/lib/onboarding-settings-store.js";
import { isOutcomeStageName } from "../src/lib/stage-rules.js";

const DB = process.env.CLIENT_DB_NAME ?? "core2";
const LABELS = ["Alston AI", "AlstonAI", "Alston Ai", "alston ai", "alstonai", "Alston"];

const pool = await getPool();
const seen = new Set<string>();
for (const label of LABELS) {
  let tid: string;
  try { tid = resolveTenantId(label); } catch { continue; }
  if (seen.has(tid)) continue;
  seen.add(tid);

  const tot = await pool.request().input("tid", sql.NVarChar, tid).query(`
    SELECT COUNT(*) total,
           SUM(CASE WHEN [ProjectLifeCycleLookup] IS NULL THEN 1 ELSE 0 END) nullLc
    FROM ${DB}.dbo.Opportunity
    WHERE [TenantID]=@tid AND ([Deleted]=0 OR [Deleted] IS NULL)`);
  const row = (tot.recordset as any[])[0] ?? {};
  if (!row.total) { console.log(`label "${label}" tid=${tid}: 0 opportunities — skip`); continue; }
  console.log(`\n=== label "${label}" tid=${tid}: ${row.total} opps, ${row.nullLc} with NULL lifecycle lookup`);

  // settings
  try {
    const eff = await loadEffectiveDefaults(label);
    const list = String(eff.defaultOpportunityStages ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    console.log(`  defaultOpportunityStages: [${list.join(" | ")}]`);
    console.log(`  schedulable: [${list.filter((s) => !isOutcomeStageName(s)).join(" | ")}]`);
  } catch (e) { console.log(`  settings load failed: ${String(e)}`); }

  // lookup value breakdown joined to template table (any module)
  const br = await pool.request().input("tid", sql.NVarChar, tid).query(`
    SELECT o.[ProjectLifeCycleLookup] lc, COUNT(*) n,
           MAX(CAST(lc.[Name] AS NVARCHAR(100))) nm, MAX(lc.[ModuleNameLookup]) mod,
           MAX(CASE WHEN lc.[Deleted]=1 THEN 1 ELSE 0 END) tplDeleted,
           MAX(CASE WHEN lc.[ID] IS NULL THEN 1 ELSE 0 END) missing
    FROM ${DB}.dbo.Opportunity o
    LEFT JOIN ${DB}.dbo.Config_ModuleLifeCycles lc
      ON lc.[ID] = o.[ProjectLifeCycleLookup] AND lc.[TenantID] = o.[TenantID]
    WHERE o.[TenantID]=@tid AND (o.[Deleted]=0 OR o.[Deleted] IS NULL)
    GROUP BY o.[ProjectLifeCycleLookup] ORDER BY n DESC`);
  for (const r of br.recordset as any[]) {
    const lcv = r.lc == null ? "NULL" : String(r.lc);
    console.log(`  lookup=${lcv} opps=${r.n} tplName="${r.nm ?? "-"}" module=${r.mod ?? "-"} tplDeleted=${r.tplDeleted} tplMissing=${r.missing}`);
  }

  // stage counts for referenced templates
  const tpls = (br.recordset as any[]).filter((r) => r.lc != null).map((r) => Number(r.lc));
  for (const id of tpls) {
    const st = await pool.request()
      .input("tid", sql.NVarChar, tid).input("lc", sql.NVarChar, String(id))
      .query(`SELECT [StageTitle] t FROM ${DB}.dbo.Config_Module_ModuleStages
              WHERE [TenantID]=@tid AND [LifeCycleName]=@lc AND ([Deleted]=0 OR [Deleted] IS NULL)
              ORDER BY [StageStep]`);
    const sig = (st.recordset as any[]).map((r) => String(r.t ?? "").trim()).filter(Boolean);
    console.log(`  tpl#${id} stageRows=${sig.length} stages=[${sig.join(" | ")}]`);
  }

  // all OPM templates for the tenant (even unreferenced)
  const all = await pool.request().input("tid", sql.NVarChar, tid).query(`
    SELECT [ID] id, CAST([Name] AS NVARCHAR(100)) nm FROM ${DB}.dbo.Config_ModuleLifeCycles
    WHERE [TenantID]=@tid AND [ModuleNameLookup]='OPM' AND ([Deleted]=0 OR [Deleted] IS NULL)`);
  console.log(`  OPM templates for tenant: ${(all.recordset as any[]).map((r) => `#${r.id}"${r.nm}"`).join(", ") || "(none)"}`);
}
process.exit(0);
