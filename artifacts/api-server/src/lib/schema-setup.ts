/**
 * Creates the core2 database and all RM ONE onboarding tables.
 * Safe to run multiple times — uses IF NOT EXISTS checks.
 * Connects to master first, creates core2 DB, then creates tables inside core2.
 */
import { getPool } from "./db.js";

export interface SchemaSetupResult {
  success: boolean;
  tablesCreated: string[];
  errors: { table: string; message: string }[];
}

const TABLE_DEFS: { name: string; sql: string }[] = [
  {
    name: "Tenant",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='Tenant' AND type='U')
    CREATE TABLE core2.dbo.Tenant (
      ID          BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID    NVARCHAR(255) NOT NULL UNIQUE,
      TenantName  NVARCHAR(255) NULL,
      Country     NVARCHAR(100) NULL,
      GUID        NVARCHAR(36)  NULL,
      SelfRegistered BIT DEFAULT 0
    )`,
  },
  {
    name: "CompanyDivisions",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='CompanyDivisions' AND type='U')
    CREATE TABLE core2.dbo.CompanyDivisions (
      ID              BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID        NVARCHAR(255) NOT NULL,
      Title           NVARCHAR(255) NOT NULL,
      CompanyIdLookup BIGINT NULL,
      DivisionIDLookup BIGINT NULL,
      Deleted         BIT DEFAULT 0
    )`,
  },
  {
    name: "Department",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='Department' AND type='U')
    CREATE TABLE core2.dbo.Department (
      ID                  BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID            NVARCHAR(255) NOT NULL,
      DepartmentId        BIGINT NULL,
      Title               NVARCHAR(255) NOT NULL,
      DivisionId          BIGINT NULL,
      DivisionIdLookup    BIGINT NULL,
      DepartmentDivision  NVARCHAR(255) NULL,
      FunctionalName      NVARCHAR(255) NULL,
      FunctionId          BIGINT NULL,
      IsDeleted           BIT DEFAULT 0,
      Deleted             BIT DEFAULT 0
    )`,
  },
  {
    name: "BusinessUnit",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='BusinessUnit' AND type='U')
    CREATE TABLE core2.dbo.BusinessUnit (
      ID        BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID  NVARCHAR(255) NOT NULL,
      Title     NVARCHAR(255) NOT NULL,
      ShortName NVARCHAR(255) NULL,
      Deleted   BIT DEFAULT 0
    )`,
  },
  {
    name: "Roles",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='Roles' AND type='U')
    CREATE TABLE core2.dbo.Roles (
      ID           BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID     NVARCHAR(255) NOT NULL,
      GlobalRoleId NVARCHAR(36)  NULL,
      Name         NVARCHAR(255) NOT NULL,
      BillingRate  FLOAT NULL,
      EmpLaborRate FLOAT NULL,
      EmpCostRate  FLOAT NULL
    )`,
  },
  {
    name: "Jobtitle",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='Jobtitle' AND type='U')
    CREATE TABLE core2.dbo.Jobtitle (
      ID               BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID         NVARCHAR(255) NOT NULL,
      Title            NVARCHAR(255) NOT NULL,
      DepartmentLookup BIGINT NULL,
      Deleted          BIT DEFAULT 0
    )`,
  },
  {
    name: "AspNetUsers",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='AspNetUsers' AND type='U')
    CREATE TABLE core2.dbo.AspNetUsers (
      Id               NVARCHAR(36)  NOT NULL PRIMARY KEY,
      TenantID         NVARCHAR(255) NOT NULL,
      UserName         NVARCHAR(255) NOT NULL,
      Name             NVARCHAR(255) NOT NULL,
      Email            NVARCHAR(255) NULL,
      PasswordHash     NVARCHAR(MAX) NULL,
      UserRole         NVARCHAR(255) NULL,
      GlobalRoleID     NVARCHAR(36)  NULL,
      DepartmentLookup BIGINT NULL,
      DivisionLookup   BIGINT NULL,
      JobTitleLookup   BIGINT NULL,
      ManagerUser      NVARCHAR(36)  NULL,
      UGITStartDate    DATETIME NULL,
      UGITEndDate      DATETIME NULL,
      IsManager        BIT DEFAULT 0,
      Enabled          BIT DEFAULT 1,
      JobProfile       NVARCHAR(MAX) NULL,
      Deleted          BIT DEFAULT 0
    )`,
  },
  {
    name: "ResourceWorkItems",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='ResourceWorkItems' AND type='U')
    CREATE TABLE core2.dbo.ResourceWorkItems (
      ID               BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID         NVARCHAR(255) NOT NULL,
      Resource         NVARCHAR(36)  NULL,
      WorkItem         NVARCHAR(100) NULL,
      WorkItemID       BIGINT NULL,
      WorkItemType     NVARCHAR(100) NULL,
      SubWorkItem      NVARCHAR(100) NULL,
      GlobalRoleID     NVARCHAR(36)  NULL,
      JobTitleLookup   BIGINT NULL,
      DivisionLookup   BIGINT NULL,
      PctAllocation    FLOAT NULL,
      AllocationHour   FLOAT NULL,
      ActualStartDate  DATETIME NULL,
      ActualEndDate    DATETIME NULL,
      ActualPctAllocation FLOAT NULL,
      ActualHour       FLOAT NULL,
      SoftAllocation   BIT DEFAULT 0,
      IsConsultant     BIT DEFAULT 0,
      IsIT             BIT DEFAULT 0,
      IsManager        BIT DEFAULT 0,
      ManagerLookup    NVARCHAR(36)  NULL,
      FunctionalArea   NVARCHAR(255) NULL,
      ERPJobID         NVARCHAR(255) NULL,
      Attachments      NVARCHAR(MAX) NULL,
      Deleted          BIT DEFAULT 0,
      Created          DATETIME DEFAULT GETDATE(),
      Modified         DATETIME DEFAULT GETDATE(),
      CreatedBy        NVARCHAR(36)  NULL,
      ModifiedBy       NVARCHAR(36)  NULL
    )`,
  },
  {
    name: "CRMCompany",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='CRMCompany' AND type='U')
    CREATE TABLE core2.dbo.CRMCompany (
      ID                      BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID                NVARCHAR(255) NOT NULL,
      Title                   NVARCHAR(255) NOT NULL,
      ClientRep               NVARCHAR(255) NULL,
      ClientRepDivisionLookup BIGINT NULL,
      ClientMarketSector      NVARCHAR(255) NULL,
      CRMHealth               NVARCHAR(100) NULL,
      DivisionLookup          BIGINT NULL,
      Deleted                 BIT DEFAULT 0
    )`,
  },
  {
    name: "CRMContact",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='CRMContact' AND type='U')
    CREATE TABLE core2.dbo.CRMContact (
      ID               BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID         NVARCHAR(255) NOT NULL,
      CRMCompanyLookup BIGINT NULL,
      PointOfContact   NVARCHAR(255) NOT NULL,
      Deleted          BIT DEFAULT 0
    )`,
  },
  {
    name: "PMM",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='PMM' AND type='U')
    CREATE TABLE core2.dbo.PMM (
      ID                   BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID             NVARCHAR(255) NOT NULL,
      TicketId             VARCHAR(50)   NULL,
      Title                NVARCHAR(500) NOT NULL,
      ERPJobID             NVARCHAR(100) NULL,
      ChanceOfSuccessChoice NVARCHAR(100) NULL,
      ApproxContractValue  FLOAT NULL,
      ContractValue        FLOAT NULL,
      ContractLimit        FLOAT NULL,
      ContractType         NVARCHAR(100) NULL,
      StatusChoice         NVARCHAR(100) NULL,
      SectorChoice         NVARCHAR(100) NULL,
      DepartmentLookup     NVARCHAR(255) NULL,
      DivisionLookup       BIGINT NULL,
      CRMBusinessUnitChoice NVARCHAR(255) NULL,
      CRMCompanyLookup     NVARCHAR(255) NULL,
      CRMContactLookup     NVARCHAR(255) NULL,
      TargetStartDate      DATETIME NULL,
      TargetCompletionDate DATETIME NULL,
      Deleted              BIT DEFAULT 0,
      CreatedByUser        NVARCHAR(255) NULL,
      ModifiedByUser       NVARCHAR(255) NULL
    )`,
  },
  {
    name: "Opportunity",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='Opportunity' AND type='U')
    CREATE TABLE core2.dbo.Opportunity (
      ID                   BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID             NVARCHAR(255) NOT NULL,
      TicketId             VARCHAR(50)   NULL,
      Title                NVARCHAR(500) NOT NULL,
      ERPJobID             NVARCHAR(100) NULL,
      ContractValue        FLOAT NULL,
      StatusChoice         NVARCHAR(100) NULL,
      DepartmentLookup     NVARCHAR(255) NULL,
      DivisionLookup       BIGINT NULL,
      CRMBusinessUnitChoice NVARCHAR(255) NULL,
      CRMCompanyLookup     NVARCHAR(255) NULL,
      TargetStartDate      DATETIME NULL,
      TargetCompletionDate DATETIME NULL,
      Deleted              BIT DEFAULT 0,
      CreatedByUser        NVARCHAR(255) NULL
    )`,
  },
  {
    name: "ResourceAllocation",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='ResourceAllocation' AND type='U')
    CREATE TABLE core2.dbo.ResourceAllocation (
      ID                    BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID              NVARCHAR(255) NOT NULL,
      TicketId              VARCHAR(50)   NULL,
      ResourceWorkItemLookup BIGINT NULL,
      AllocationStartDate   DATETIME NULL,
      AllocationEndDate     DATETIME NULL,
      ActualStartDate       DATETIME NULL,
      ActualEndDate         DATETIME NULL,
      PctAllocation         FLOAT NULL,
      BillingRate           DECIMAL(18,2) NULL,
      EmpLaborRate          FLOAT NULL,
      EmpCostRate           FLOAT NULL,
      BilledHours           FLOAT NULL,
      AllocationHour        FLOAT NULL,
      AllocationType        VARCHAR(50)   NULL,
      SoftAllocation        BIT DEFAULT 0,
      NonChargeable         BIT DEFAULT 0,
      IsLocked              BIT DEFAULT 0,
      Deleted               BIT DEFAULT 0,
      CreatedByUser         NVARCHAR(255) NULL,
      ModifiedByUser        NVARCHAR(255) NULL
    )`,
  },
  {
    name: "Config_ConfigurationVariable",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='Config_ConfigurationVariable' AND type='U')
    CREATE TABLE core2.dbo.Config_ConfigurationVariable (
      ID       BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID NVARCHAR(255) NOT NULL,
      KeyName  NVARCHAR(255) NOT NULL,
      KeyValue NVARCHAR(MAX) NULL
    )`,
  },
  {
    name: "ModuleTasks",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='ModuleTasks' AND type='U')
    CREATE TABLE core2.dbo.ModuleTasks (
      ID          BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID    NVARCHAR(255) NOT NULL,
      TicketId    VARCHAR(50)   NULL,
      Title       NVARCHAR(500) NULL,
      Description NVARCHAR(MAX) NULL,
      StageStep   NVARCHAR(255) NULL,
      DueDate     DATETIME NULL,
      AssignedTo  NVARCHAR(36)  NULL,
      Status      NVARCHAR(100) NULL,
      Deleted     BIT DEFAULT 0
    )`,
  },
  {
    name: "TicketHours",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='TicketHours' AND type='U')
    CREATE TABLE core2.dbo.TicketHours (
      ID         BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID   NVARCHAR(255) NOT NULL,
      ResourceID NVARCHAR(36)  NULL,
      TicketId   VARCHAR(50)   NULL,
      Hours      FLOAT NULL,
      LogDate    DATETIME NULL,
      Deleted    BIT DEFAULT 0
    )`,
  },
  {
    name: "POR",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='POR' AND type='U')
    CREATE TABLE core2.dbo.POR (
      ID               BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID         NVARCHAR(255) NOT NULL,
      Title            NVARCHAR(500) NULL,
      CompanyLookup    NVARCHAR(255) NULL,
      InitiativeLookup NVARCHAR(255) NULL,
      Status           NVARCHAR(100) NULL,
      TargetStartDate  DATETIME NULL,
      TargetEndDate    DATETIME NULL,
      Deleted          BIT DEFAULT 0
    )`,
  },
  {
    name: "ResourceTimeSheet",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='ResourceTimeSheet' AND type='U')
    CREATE TABLE core2.dbo.ResourceTimeSheet (
      ID             BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID       NVARCHAR(255) NOT NULL,
      ResourceID     NVARCHAR(36)  NULL,
      WeekStartDate  DATETIME NULL,
      TotalHours     FLOAT NULL,
      Status         NVARCHAR(100) NULL,
      Deleted        BIT DEFAULT 0
    )`,
  },
  {
    name: "SVCRequests",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='SVCRequests' AND type='U')
    CREATE TABLE core2.dbo.SVCRequests (
      ID          BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID    NVARCHAR(255) NOT NULL,
      TicketId    VARCHAR(50)   NULL,
      Title       NVARCHAR(500) NULL,
      Description NVARCHAR(MAX) NULL,
      Status      NVARCHAR(100) NULL,
      Priority    NVARCHAR(100) NULL,
      AssignedTo  NVARCHAR(36)  NULL,
      CreatedDate DATETIME DEFAULT GETDATE(),
      Deleted     BIT DEFAULT 0
    )`,
  },
  {
    name: "ACR",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='ACR' AND type='U')
    CREATE TABLE core2.dbo.ACR (
      ID          BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID    NVARCHAR(255) NOT NULL,
      TicketId    VARCHAR(50)   NULL,
      Title       NVARCHAR(500) NULL,
      RequestType NVARCHAR(255) NULL,
      Status      NVARCHAR(100) NULL,
      RequestedBy NVARCHAR(36)  NULL,
      CreatedDate DATETIME DEFAULT GETDATE(),
      Deleted     BIT DEFAULT 0
    )`,
  },
  {
    // Status change ledger — one row per human-initiated status/stage write on
    // OPM (opportunities) and LEM (leads). Powers the Reports per-period
    // "decided this week / converted this month" counts. System writes
    // (autoStatus, schedule auto-advance) are intentionally excluded so the
    // ledger reflects deliberate human decisions only.
    name: "CRMStatusLedger",
    sql: `IF NOT EXISTS (SELECT * FROM core2.sys.objects WHERE name='CRMStatusLedger' AND type='U')
    CREATE TABLE core2.dbo.CRMStatusLedger (
      ID          BIGINT IDENTITY(1,1) PRIMARY KEY,
      TenantID    NVARCHAR(255) NOT NULL,
      TicketId    VARCHAR(50)   NOT NULL,
      Module      VARCHAR(10)   NOT NULL,
      OldStatus   NVARCHAR(200) NULL,
      NewStatus   NVARCHAR(200) NOT NULL,
      ChangedAt   DATETIME      NOT NULL DEFAULT GETUTCDATE(),
      ChangedBy   NVARCHAR(255) NULL
    );
    IF NOT EXISTS (
      SELECT * FROM core2.sys.indexes
      WHERE name='IX_CRMStatusLedger_Tenant_Ticket'
        AND object_id=OBJECT_ID('core2.dbo.CRMStatusLedger')
    )
      CREATE INDEX IX_CRMStatusLedger_Tenant_Ticket
        ON core2.dbo.CRMStatusLedger (TenantID, TicketId, ChangedAt DESC);`,
  },
];

export async function setupSchema(): Promise<SchemaSetupResult> {
  const pool = await getPool();
  const result: SchemaSetupResult = { success: true, tablesCreated: [], errors: [] };

  // Step 1 — Create core2 database if it doesn't exist
  try {
    await pool.request().query(`
      IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'core2')
        CREATE DATABASE core2
    `);
  } catch (e: any) {
    return { success: false, tablesCreated: [], errors: [{ table: "core2 (database)", message: e.message }] };
  }

  // Step 2 — Create each table inside core2
  for (const { name, sql } of TABLE_DEFS) {
    try {
      await pool.request().query(sql);
      result.tablesCreated.push(name);
    } catch (e: any) {
      result.errors.push({ table: name, message: e.message });
      result.success = false;
    }
  }

  return result;
}
