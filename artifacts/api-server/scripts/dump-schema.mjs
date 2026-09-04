import sql from "mssql";

const host = process.env.CLIENT_DB_HOST;
const user = process.env.CLIENT_DB_USER;
const pass = process.env.CLIENT_DB_PASSWORD;
const port = parseInt(process.env.CLIENT_DB_PORT ?? "1433", 10);
const db   = process.env.CLIENT_DB_NAME ?? "core2";
const url  = process.env.APP_DATABASE_URL;

let cfg;
if (url) {
  const u = new URL(url);
  cfg = {
    server: u.hostname, port: u.port ? parseInt(u.port) : 1433,
    database: u.pathname.replace(/^\//, "") || "master",
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    options: { encrypt: true, trustServerCertificate: true }
  };
} else if (host && user && pass) {
  cfg = { server: host, port, database: db, user, password: pass,
          options: { encrypt: true, trustServerCertificate: true } };
} else {
  console.error("No DB credentials in environment. Set APP_DATABASE_URL or CLIENT_DB_HOST/USER/PASSWORD.");
  process.exit(1);
}

const TABLES = [
  "CompanyDivisions","Department","Roles","Jobtitle","AspNetUsers",
  "ResourceWorkItems","CRMCompany","CRMContact","PMM","Opportunity",
  "ResourceAllocation","Config_ConfigurationVariable",
  "ModuleTasks","TicketHours","RoleBillingRateByDept","POR",
  "ResourceTimeSheet","SVCRequests","ACR","Tenant"
];

try {
  const pool = await new sql.ConnectionPool(cfg).connect();
  const res = await pool.request().query(`
    SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_CATALOG = 'core2'
      AND TABLE_NAME IN (${TABLES.map(t => `'${t}'`).join(",")})
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  const schema = {};
  for (const row of res.recordset) {
    if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = [];
    schema[row.TABLE_NAME].push({
      col: row.COLUMN_NAME,
      type: row.DATA_TYPE + (row.CHARACTER_MAXIMUM_LENGTH ? `(${row.CHARACTER_MAXIMUM_LENGTH})` : ""),
      nullable: row.IS_NULLABLE === "YES"
    });
  }

  for (const [table, cols] of Object.entries(schema)) {
    console.log(`\n=== ${table} (${cols.length} cols) ===`);
    for (const c of cols) {
      const req = c.nullable ? "  optional" : "  REQUIRED";
      console.log(`  ${req}  ${c.col}  [${c.type}]`);
    }
  }

  await pool.close();
} catch (e) {
  console.error("DB ERROR:", e.message);
}
