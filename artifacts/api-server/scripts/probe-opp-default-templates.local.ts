/**
 * READ-ONLY probe: per tenant, list OPM lifecycle templates (id, name, ordered
 * stage signature, # of opportunities referencing each) next to the tenant's
 * CURRENT effective defaultOpportunityStages — to identify which template is
 * "the old default" that existing opportunities still point at.
 */
import sql from "mssql";
import { getPool } from "../src/lib/db.js";
import { resolveTenantId } from "../src/lib/pipeline.js";
import { loadEffectiveDefaults } from "../src/lib/onboarding-settings-store.js";
import { isOutcomeStageName } from "../src/lib/stage-rules.js";

const DB = process.env.CLIENT_DB_NAME ?? "core2";
const LABELS = [
  "Alston AI", "AlstonAI", "Alston", "Liro", "LiRo", "Liro_Poc", "Liro Poc", "LiRo POC",
  "LiroDemo", "LiRoDemo", "test21", "test99", "demormone", "ResOne",
];

const pool = await getPool();
const tidToLabel = new Map<string, string>();
for (const l of LABELS) {
  try { tidToLabel.set(resolveTenantId(l), l); } catch { /* ignore */ }
}

const lcs = await pool.request().query(`
  SELECT lc.[TenantID] tid, lc.[ID] id, lc.[Name] nm
  FROM ${DB}.dbo.Config_ModuleLifeCycles lc
  WHERE lc.[ModuleNameLookup]='OPM' AND (lc.[Deleted]=0 OR lc.[Deleted] IS NULL)
  ORDER BY lc.[TenantID], lc.[ID]`);
const byTenant = new Map<string, { id: number; nm: string }[]>();
for (const r of lcs.recordset as any[]) {
  const tid = String(r.tid ?? "").trim();
  const arr = byTenant.get(tid) ?? [];
  arr.push({ id: Number(r.id), nm: String(r.nm ?? "") });
  byTenant.set(tid, arr);
}
console.log(`OPM templates found for ${byTenant.size} tenant(s)`);

for (const [tid, tpls] of byTenant) {
  const label = tidToLabel.get(tid);
  console.log(`\n=== tid=${tid} label=${label ?? "?"}`);
  if (label) {
    try {
      const eff = await loadEffectiveDefaults(label);
      const list = String(eff.defaultOpportunityStages ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      console.log(`  defaultOpportunityStages: [${list.join(" | ")}]`);
      console.log(`  schedulable (outcomes removed): [${list.filter((s) => !isOutcomeStageName(s)).join(" | ")}]`);
    } catch (e) { console.log(`  (settings load failed: ${String(e)})`); }
  }
  for (const t of tpls) {
    const st = await pool.request()
      .input("tid", sql.NVarChar, tid).input("lc", sql.NVarChar, String(t.id))
      .query(`SELECT [StageTitle] title, [StageStep] step FROM ${DB}.dbo.Config_Module_ModuleStages
              WHERE [TenantID]=@tid AND [LifeCycleName]=@lc AND ([Deleted]=0 OR [Deleted] IS NULL)
              ORDER BY [StageStep]`);
    const sig = (st.recordset as any[]).map((r) => String(r.title ?? "").trim()).filter(Boolean);
    const rc = await pool.request()
      .input("tid", sql.NVarChar, tid).input("id", sql.BigInt, t.id)
      .query(`SELECT COUNT(*) n FROM ${DB}.dbo.Opportunity
              WHERE [TenantID]=@tid AND [ProjectLifeCycleLookup]=@id AND ([Deleted]=0 OR [Deleted] IS NULL)`);
    const n = (rc.recordset as any[])[0]?.n ?? 0;
    console.log(`  tpl#${t.id} refs=${n} name="${t.nm.slice(0, 70)}" stages=[${sig.join(" | ")}]`);
  }
}
process.exit(0);
