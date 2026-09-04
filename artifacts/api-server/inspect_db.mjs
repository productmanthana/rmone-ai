import sql from "mssql";
const u = new URL(process.env.APP_DATABASE_URL);
const cfg = {
  server: u.hostname, port: u.port ? parseInt(u.port,10):1433,
  database: u.pathname.replace(/^\//,"")||"master",
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  options: { encrypt:true, trustServerCertificate:true, enableArithAbort:true, connectTimeout:15000, requestTimeout:60000 },
};
console.log("Server:", cfg.server, "| Default DB in URL:", cfg.database, "\n");
const pool = await new sql.ConnectionPool(cfg).connect();

// 1. List all databases
const dbs = await pool.request().query(`SELECT name FROM sys.databases ORDER BY name`);
console.log("=== Databases on this server ===");
console.log(dbs.recordset.map(r => r.name).join(", "));

// 2. For each user database (not system), count tables
console.log("\n=== Table counts per user database ===");
for (const row of dbs.recordset) {
  const name = row.name;
  if (["master","tempdb","model","msdb","rdsadmin"].includes(name)) continue;
  try {
    const t = await pool.request().query(`SELECT COUNT(*) AS c FROM [${name}].INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'`);
    console.log(`  ${name}: ${t.recordset[0].c} tables`);
  } catch(e) {
    console.log(`  ${name}: (error: ${e.message})`);
  }
}
await pool.close();
