import sql from "mssql";
const u = new URL(process.env.APP_DATABASE_URL);
const cfg = {
  server: u.hostname, port: u.port ? parseInt(u.port,10):1433,
  database: u.pathname.replace(/^\//,"")||"master",
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  options: { encrypt:true, trustServerCertificate:true, enableArithAbort:true, connectTimeout:15000, requestTimeout:60000 },
};
const pool = await new sql.ConnectionPool(cfg).connect();
const t = await pool.request().query(`
  SELECT t.TABLE_NAME, (SELECT COUNT(*) FROM core2.INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_NAME=t.TABLE_NAME) AS cols
  FROM core2.INFORMATION_SCHEMA.TABLES t WHERE t.TABLE_TYPE='BASE TABLE' ORDER BY t.TABLE_NAME`);
console.log("=== core2 tables (name : column count) ===");
for (const r of t.recordset) {
  // row count
  let rc = "?";
  try { const x = await pool.request().query(`SELECT COUNT(*) AS c FROM core2.dbo.[${r.TABLE_NAME}]`); rc = x.recordset[0].c; } catch {}
  console.log(`  ${r.TABLE_NAME}  (${r.cols} cols, ${rc} rows)`);
}
await pool.close();
