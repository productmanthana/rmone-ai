import fs from "fs";
import sql from "mssql";
import { getPool } from "../src/lib/db.js";
import { CLONE_CONFIG_TABLES, TEMPLATE_TENANT_ID } from "../src/onboarding/roles.js";
const LOG="/tmp/verify.log"; fs.writeFileSync(LOG,"start\n");
const log=(s:string)=>{fs.appendFileSync(LOG,s+"\n");console.log(s);};
const NEW=process.argv[2]??"11111111-2222-3333-4444-555555555555";
const DB=process.env.CLIENT_DB_NAME??"core2";
(async()=>{
  const pool=await getPool();
  log("discovering tenant columns…");
  // which clone tables actually exist AND have a TenantID column
  const cols=await pool.request().query(`
    SELECT TABLE_SCHEMA s, TABLE_NAME t FROM ${DB}.INFORMATION_SCHEMA.COLUMNS
    WHERE LOWER(COLUMN_NAME)='tenantid'`);
  const has=new Map(cols.recordset.map((r:any)=>[r.t.toLowerCase(),r.s]));
  const scoped=CLONE_CONFIG_TABLES.filter(t=>has.has(t.toLowerCase()));
  log(`tenant-scoped clone tables: ${scoped.length} / ${CLONE_CONFIG_TABLES.length}`);
  const parts=scoped.map(t=>{
    const fq=`[${DB}].[${has.get(t.toLowerCase())}].[${t}]`;
    return `SELECT '${t}' tbl,
      (SELECT COUNT(*) FROM ${fq} WHERE TenantID=@tpl) tmpl,
      (SELECT COUNT(*) FROM ${fq} WHERE TenantID=@new) cloned`;
  });
  const r=await pool.request().input("tpl",sql.NVarChar(256),TEMPLATE_TENANT_ID).input("new",sql.NVarChar(256),NEW)
    .query(parts.join("\nUNION ALL\n"));
  const rows=r.recordset as {tbl:string;tmpl:number;cloned:number}[];
  const mism=rows.filter(x=>x.tmpl!==x.cloned);
  const totT=rows.reduce((a,x)=>a+x.tmpl,0), totC=rows.reduce((a,x)=>a+x.cloned,0);
  log(`TOTAL rows: template=${totT} cloned=${totC}`);
  log(`MISMATCHES: ${mism.length}`);
  for(const m of mism) log(`  MISMATCH ${m.tbl}: tmpl=${m.tmpl} cloned=${m.cloned}`);
  log(mism.length===0?"PASS all tenant-scoped tables match":"FAIL");
  process.exit(0);
})().catch(e=>{log("ERR: "+e.message);process.exit(1);});
