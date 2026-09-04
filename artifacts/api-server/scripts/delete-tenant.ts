import fs from "fs";
import sql from "mssql";
import { getPool } from "../src/lib/db.js";
import { CLONE_CONFIG_TABLES } from "../src/onboarding/roles.js";
const LOG="/tmp/del.log"; fs.writeFileSync(LOG,"start\n");
const log=(s:string)=>{fs.appendFileSync(LOG,s+"\n");console.log(s);};
const DB=process.env.CLIENT_DB_NAME??"core2";
// tenants to purge: explicit test GUID + any probe tenants (LIKE patterns)
const EXACT=process.argv.slice(2);
const PATTERNS=["11111111%","22222222%"];
(async()=>{
  const pool=await getPool();
  const cols=await pool.request().query(`
    SELECT TABLE_SCHEMA s, TABLE_NAME t FROM ${DB}.INFORMATION_SCHEMA.COLUMNS
    WHERE LOWER(COLUMN_NAME)='tenantid'`);
  const has=new Map(cols.recordset.map((r:any)=>[r.t.toLowerCase(),r.s]));
  const scoped=CLONE_CONFIG_TABLES.filter(t=>has.has(t.toLowerCase()));
  const fqs=scoped.map(t=>`[${DB}].[${has.get(t.toLowerCase())}].[${t}]`);
  const pred=PATTERNS.map(p=>`TenantID LIKE '${p}'`)
    .concat(EXACT.map(g=>`TenantID='${g}'`)).join(" OR ");
  log(`purging ${scoped.length} tables where ${pred}`);
  // loop passes to satisfy FK delete order without disabling constraints
  let remaining=1, pass=0;
  while(remaining>0 && pass<8){
    pass++; let deleted=0; const errs:string[]=[];
    for(const fq of fqs){
      try{ const r=await pool.request().query(`DELETE FROM ${fq} WHERE ${pred}`); deleted+=r.rowsAffected[0]||0; }
      catch(e:any){ errs.push(fq.split(".").pop()+":"+e.number); }
    }
    // recount
    const parts=fqs.map(fq=>`SELECT COUNT(*) n FROM ${fq} WHERE ${pred}`);
    const rc=await pool.request().query(parts.join("\nUNION ALL\n"));
    remaining=(rc.recordset as any[]).reduce((a,x)=>a+x.n,0);
    log(`pass ${pass}: deleted=${deleted} remaining=${remaining} fkBlocked=${errs.length}`);
  }
  log(remaining===0?"CLEAN all test tenant rows removed":`STILL ${remaining} rows`);
  process.exit(0);
})().catch(e=>{log("ERR: "+e.message);process.exit(1);});
