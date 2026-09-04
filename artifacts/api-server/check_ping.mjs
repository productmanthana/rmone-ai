import { getPool } from "./src/lib/db.js";
async function main() {
  console.log("connecting...");
  const pool = await getPool();
  console.log("connected, running select 1");
  const res = await pool.request().query("SELECT 1 as ok");
  console.log(res.recordset);
}
main().catch(e => { console.error("ERR", e.message); process.exit(1); });
