import { getPool } from "../src/lib/db.js";

const TABLES = [
  "CompanyDivisions","Department","Roles","Jobtitle","AspNetUsers",
  "ResourceWorkItems","CRMCompany","CRMContact","PMM","Opportunity",
  "ResourceAllocation","Config_ConfigurationVariable",
  "ModuleTasks","TicketHours","RoleBillingRateByDept","POR",
  "ResourceTimeSheet","SVCRequests","ACR","Tenant","ProjectChangeLog"
];

const pool = await getPool();
const res = await pool.request().query(`
  SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, COLUMN_DEFAULT
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_CATALOG = 'core2'
    AND TABLE_NAME IN (${TABLES.map(t=>`'${t}'`).join(",")})
  ORDER BY TABLE_NAME, ORDINAL_POSITION
`);

const schema: Record<string, {col:string,type:string,nullable:boolean,hasDefault:boolean}[]> = {};
for (const row of res.recordset) {
  if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = [];
  schema[row.TABLE_NAME].push({
    col: row.COLUMN_NAME,
    type: row.DATA_TYPE + (row.CHARACTER_MAXIMUM_LENGTH ? `(${row.CHARACTER_MAXIMUM_LENGTH})` : ""),
    nullable: row.IS_NULLABLE === "YES",
    hasDefault: row.COLUMN_DEFAULT != null
  });
}

for (const [table, cols] of Object.entries(schema).sort()) {
  console.log(`\n=== ${table} (${cols.length} columns) ===`);
  for (const c of cols) {
    const flag = !c.nullable && !c.hasDefault ? " ★REQUIRED" : c.nullable ? "" : " (has-default)";
    console.log(`  ${c.col.padEnd(40)} ${c.type.padEnd(20)}${flag}`);
  }
}

await pool.close();
