import sql from "mssql";
const u = new URL(process.env.APP_DATABASE_URL);
const cfg = {
  server: u.hostname, port: u.port ? parseInt(u.port,10):1433,
  database: u.pathname.replace(/^\//,"")||"master",
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  options: { encrypt:true, trustServerCertificate:true, enableArithAbort:true, connectTimeout:15000, requestTimeout:60000 },
};
const pool = await new sql.ConnectionPool(cfg).connect();

// Query core2's PMM columns using the core2-prefixed INFORMATION_SCHEMA
const r = await pool.request().query(`
  SELECT COLUMN_NAME FROM core2.INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'PMM' ORDER BY ORDINAL_POSITION
`);
const live = r.recordset.map(x => x.COLUMN_NAME);
console.log("=== LIVE core2.PMM columns (" + live.length + ") ===");
console.log(live.join(", "));

// The .bak-derived hardcoded list
const baked = ["ID","TenantID","TicketId","Title","ERPJobID","ChanceOfSuccessChoice","ApproxContractValue","ContractValue","ContractLimit","ContractType","StatusChoice","SectorChoice","RequestCategory","ServiceType","ModuleName","Department","DepartmentLookup","Division","DivisionLookup","GlobalRoleID","PointOfContact","CRMCompanyLookup","CRMContactLookup","CompanyLookup","InitiativeLookup","ProgramLookup","ProjectTag","ProjectType","BudgetCategoryLookup","ConstStartDate","PreconStartDate","PreconEndDate","EstimatedConstructionStart","EstimatedConstructionEnd","TargetStartDate","TargetCompletionDate","CloseoutStartDate","CloseoutDate","ClosedDate","ProposalPhaseDueDate","GrossMargin","Category","GroupId","GroupTypeChoice","SourceID","SourceSystem","Deleted","CreatedByUser","ModifiedByUser"];

const liveSet = new Set(live);
const inBakNotLive = baked.filter(c => !liveSet.has(c));
console.log("\n=== In .bak/HARDCODED but NOT in live DB (these caused INSERT errors) ===");
console.log(inBakNotLive.join(", ") || "(none - they match!)");

const bakSet = new Set(baked);
const inLiveNotBak = live.filter(c => !bakSet.has(c));
console.log("\n=== In live DB but MISSING from .bak/HARDCODED (" + inLiveNotBak.length + ") ===");
console.log(inLiveNotBak.join(", ") || "(none)");

await pool.close();
