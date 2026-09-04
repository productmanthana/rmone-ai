/**
 * Seed dummy data for the test106 tenant so ALL role home screens
 * (COO, CFO, PM, EXEC, CEO, Resource Manager) show realistic live values.
 *
 * Safe to run multiple times — every INSERT is guarded by a prior
 * existence check (TenantID + natural key), so re-running is idempotent.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/seed-test106.ts
 */

import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { getPool, sql } from "./lib/db.js";

// ── Tenant ────────────────────────────────────────────────────────────────────
const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const TENANT_LABEL     = "test106";
const TID = uuidv5(TENANT_LABEL, TENANT_NAMESPACE);

const Y = new Date().getFullYear();

// Date helpers
function daysFromNow(n: number): Date {
  const d = new Date(); d.setDate(d.getDate() + n); return d;
}
function daysAgo(n: number): Date { return daysFromNow(-n); }

// ── PMM Projects ──────────────────────────────────────────────────────────────
// Mix of statuses/completion states to drive ALL role metrics:
//   COO   → active/at-risk ratio, delivery risk
//   CFO   → portfolio value, revenue at risk
//   PM    → PctComplete, schedule risk (overdue/due-soon), open demands
//   EXEC  → portfolio overview, top projects
//   RM    → utilization, bench, over-allocated
const PROJECTS = [
  // ── Active / healthy
  { ticket: "PMM-24-001", title: "Hudson Yards Commercial Tower",
    cv: 4_800_000, lca: 3_100_000, status: "In Progress",
    pct: 62, startOffset: -180, endOffset: 120, bu: "Buildings" },
  { ticket: "PMM-24-002", title: "Midtown Office Fit-Out",
    cv: 1_200_000, lca: 750_000, status: "Under Construction",
    pct: 45, startOffset: -90, endOffset: 60, bu: "Interiors" },
  { ticket: "PMM-24-003", title: "Brooklyn Bridge Waterfront Parkway",
    cv: 2_900_000, lca: 1_850_000, status: "In Progress",
    pct: 78, startOffset: -240, endOffset: 45, bu: "Infrastructure" },
  { ticket: "PMM-24-004", title: "Queens BRT Corridor Phase 2",
    cv: 3_600_000, lca: 2_200_000, status: "Construction Administration",
    pct: 55, startOffset: -120, endOffset: 90, bu: "Transportation" },
  { ticket: "PMM-24-005", title: "Harlem Community Center Renovation",
    cv: 980_000, lca: 620_000, status: "In Progress",
    pct: 88, startOffset: -300, endOffset: 20, bu: "Community" },
  { ticket: "PMM-24-006", title: "Staten Island Ferry Terminal Upgrade",
    cv: 1_750_000, lca: 1_100_000, status: "Construction Documents",
    pct: 33, startOffset: -60, endOffset: 180, bu: "Transportation" },
  { ticket: "PMM-24-007", title: "JFK Airport Terminal 8 Expansion",
    cv: 5_200_000, lca: 3_400_000, status: "In Progress",
    pct: 71, startOffset: -200, endOffset: 75, bu: "Aviation" },
  { ticket: "PMM-24-008", title: "Newark Light Rail Extension",
    cv: 2_300_000, lca: 1_480_000, status: "Pre-Construction",
    pct: 18, startOffset: -30, endOffset: 270, bu: "Transportation" },
  // ── Overdue (past target end, PctComplete < 100%) → PM CRITICAL signal
  { ticket: "PMM-24-009", title: "Castle Hill Affordable Housing",
    cv: 1_600_000, lca: 1_050_000, status: "In Progress",
    pct: 72, startOffset: -365, endOffset: -14, bu: "Residential" },   // overdue!
  { ticket: "PMM-24-010", title: "Phoenix Plaza Retail Fitout",
    cv: 870_000, lca: 560_000, status: "In Progress",
    pct: 58, startOffset: -180, endOffset: -7, bu: "Retail" },         // overdue!
  // ── Due soon (within 30d) → PM WARNING signal
  { ticket: "PMM-24-011", title: "Flushing Meadows Pavilion",
    cv: 1_100_000, lca: 720_000, status: "Construction Administration",
    pct: 91, startOffset: -200, endOffset: 18, bu: "Parks" },          // due in 18d
  { ticket: "PMM-24-012", title: "East New York Transit Hub",
    cv: 2_050_000, lca: 1_320_000, status: "In Progress",
    pct: 64, startOffset: -150, endOffset: 25, bu: "Transportation" }, // due in 25d
];

// ── OPM Pursuits ──────────────────────────────────────────────────────────────
// Close dates spread across 30d / 60d / 90d so pipeline-in-window always fires.
// WeightedValue = cv * chance/100 drives CFO pipeline metrics.
const PURSUITS = [
  { ticket: "OPM-24-001", title: "Bronx Sports Arena Feasibility",
    cv: 3_100_000, stage: "Proposal",    chance: 55, closeOffset: 12  },
  { ticket: "OPM-24-002", title: "Long Island Rail Road Platform Study",
    cv: 1_850_000, stage: "Shortlisted", chance: 70, closeOffset: 28  },
  { ticket: "OPM-24-003", title: "Westchester County Highway Rehab",
    cv: 2_400_000, stage: "Negotiation", chance: 80, closeOffset: 45  },
  { ticket: "OPM-24-004", title: "Port Authority Cargo Facility",
    cv: 4_200_000, stage: "Proposal",    chance: 40, closeOffset: 62  },
  { ticket: "OPM-24-005", title: "Brooklyn Navy Yard Tech Campus",
    cv: 1_600_000, stage: "Shortlisted", chance: 65, closeOffset: 75  },
  { ticket: "OPM-24-006", title: "Manhattan East Side Resiliency",
    cv: 2_800_000, stage: "Proposal",    chance: 45, closeOffset: 88  },
  { ticket: "OPM-24-007", title: "Coney Island Boardwalk Restoration",
    cv: 950_000,  stage: "Negotiation", chance: 85, closeOffset: 22  },
  { ticket: "OPM-24-008", title: "Bronx River Greenway Extension",
    cv: 1_300_000, stage: "Proposal",    chance: 50, closeOffset: 35  },
  { ticket: "OPM-24-009", title: "Hudson Tunnel Waterproofing",
    cv: 5_800_000, stage: "Shortlisted", chance: 60, closeOffset: 55  },
];

// ── Team Members (AspNetUsers) ────────────────────────────────────────────────
// 14 users across various job titles / roles
const USERS = [
  { guid: uuidv4(), username: "amit.patel@test106.com",     name: "Amit Patel",       designation: "Project Manager",        title: "Project Manager"   },
  { guid: uuidv4(), username: "sarah.jones@test106.com",    name: "Sarah Jones",      designation: "Senior Engineer",        title: "Senior Engineer"   },
  { guid: uuidv4(), username: "mike.chang@test106.com",     name: "Mike Chang",       designation: "Structural Engineer",    title: "Structural Engineer" },
  { guid: uuidv4(), username: "priya.sharma@test106.com",   name: "Priya Sharma",     designation: "Project Manager",        title: "Project Manager"   },
  { guid: uuidv4(), username: "tom.wilson@test106.com",     name: "Tom Wilson",       designation: "Architect",              title: "Architect"         },
  { guid: uuidv4(), username: "lina.kowalski@test106.com",  name: "Lina Kowalski",    designation: "Civil Engineer",         title: "Civil Engineer"    },
  { guid: uuidv4(), username: "james.brown@test106.com",    name: "James Brown",      designation: "Project Engineer",       title: "Project Engineer"  },
  { guid: uuidv4(), username: "ayesha.ali@test106.com",     name: "Ayesha Ali",       designation: "Senior Architect",       title: "Senior Architect"  },
  { guid: uuidv4(), username: "carlos.ruiz@test106.com",    name: "Carlos Ruiz",      designation: "MEP Engineer",           title: "MEP Engineer"      },
  { guid: uuidv4(), username: "fang.li@test106.com",        name: "Fang Li",          designation: "Project Manager",        title: "Project Manager"   },
  { guid: uuidv4(), username: "nina.vogt@test106.com",      name: "Nina Vogt",        designation: "Environmental Engineer", title: "Environmental Engineer" },
  { guid: uuidv4(), username: "raj.mehta@test106.com",      name: "Raj Mehta",        designation: "Cost Estimator",         title: "Cost Estimator"    },
  // Bench — no allocation rows → drives bench signal
  { guid: uuidv4(), username: "emily.ford@test106.com",     name: "Emily Ford",       designation: "Cost Estimator",         title: "Cost Estimator"    },
  { guid: uuidv4(), username: "david.osei@test106.com",     name: "David Osei",       designation: "Construction Manager",   title: "Construction Manager" },
];

// ── Allocations (assigned staff → projects) ───────────────────────────────────
// Indices into USERS; hours/weeks drive PctAllocation = hours/(weeks*40)*100
//
//  Ayesha (7): 1200h/26wks on PMM-007 = 115% → over-allocated (COO/RM signal)
//  Nina  (10): 1200h/26wks on PMM-004 + 900h/26wks on PMM-008 = 115%+87% → over
//  Emily (12): NO rows  → bench
//  David (13): NO rows  → bench
const ALLOCATIONS = [
  { ui: 0,  ticket: "PMM-24-001", hours: 1600, weeks: 50 },
  { ui: 1,  ticket: "PMM-24-003", hours:  900, weeks: 26 },
  { ui: 1,  ticket: "PMM-24-007", hours:  700, weeks: 24 },
  { ui: 2,  ticket: "PMM-24-004", hours: 1560, weeks: 50 },
  { ui: 3,  ticket: "PMM-24-002", hours:  800, weeks: 26 },
  { ui: 3,  ticket: "PMM-24-005", hours:  820, weeks: 26 },
  { ui: 4,  ticket: "PMM-24-006", hours: 1500, weeks: 50 },
  { ui: 5,  ticket: "PMM-24-008", hours: 1000, weeks: 50 },
  { ui: 6,  ticket: "PMM-24-003", hours: 1600, weeks: 50 },
  { ui: 7,  ticket: "PMM-24-007", hours: 1200, weeks: 26 },  // over
  { ui: 7,  ticket: "PMM-24-001", hours: 1100, weeks: 26 },  // over
  { ui: 8,  ticket: "PMM-24-004", hours: 1760, weeks: 50 },
  { ui: 9,  ticket: "PMM-24-009", hours: 1640, weeks: 50 },
  { ui: 10, ticket: "PMM-24-004", hours: 1200, weeks: 26 },  // over
  { ui: 10, ticket: "PMM-24-008", hours:  900, weeks: 26 },  // over
  { ui: 11, ticket: "PMM-24-011", hours: 1400, weeks: 50 },
  // Emily (12) and David (13) intentionally have NO rows → bench
];

// ── Open Demands (unassigned positions) ───────────────────────────────────────
// ResourceAllocation rows with ResourceUser = NULL — drives staffing gap signals
// for COO/RM/PM roles (the "open demands" count and revenue-at-risk amounts).
const DEMANDS = [
  { ticket: "PMM-24-004", role: "Senior Structural Engineer", pct: 100, startOffset: 0,  endOffset: 60  },
  { ticket: "PMM-24-007", role: "MEP Engineer",               pct: 100, startOffset: 5,  endOffset: 75  },
  { ticket: "PMM-24-012", role: "Project Manager",            pct: 100, startOffset: 0,  endOffset: 30  },
  { ticket: "OPM-24-003", role: "Civil Engineer",             pct: 80,  startOffset: 10, endOffset: 90  },
  { ticket: "OPM-24-009", role: "Structural Engineer",        pct: 100, startOffset: 20, endOffset: 120 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function exists(
  pool: any,
  table: string,
  tid: string,
  conditions: Record<string, string | number | null>,
): Promise<boolean> {
  let req = pool.request().input("tid", sql.NVarChar, tid);
  const clauses = [`TenantID=@tid`];
  let i = 0;
  for (const [col, val] of Object.entries(conditions)) {
    if (val === null) {
      clauses.push(`${col} IS NULL`);
    } else {
      req = req.input(`v${i}`, sql.NVarChar, String(val));
      clauses.push(`${col}=@v${i}`);
      i++;
    }
  }
  const r = await req.query(
    `SELECT COUNT(*) AS cnt FROM core2.dbo.${table} WHERE ${clauses.join(" AND ")}`,
  );
  return (r.recordset[0]?.cnt ?? 0) > 0;
}

async function hasColumn(pool: any, table: string, col: string): Promise<boolean> {
  const r = await pool.request()
    .input("t", sql.NVarChar, table)
    .input("c", sql.NVarChar, col)
    .query(`SELECT COUNT(*) AS cnt FROM core2.INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME=@t AND COLUMN_NAME=@c`);
  return (r.recordset[0]?.cnt ?? 0) > 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  console.log(`\n[seed] Tenant: ${TENANT_LABEL}  →  ${TID}`);
  const pool = await getPool();

  // Connectivity check
  try {
    await pool.request().query("SELECT TOP 1 TicketId FROM core2.dbo.PMM");
    console.log("[seed] core2 reachable ✓\n");
  } catch (e: any) {
    console.error("[seed] Cannot reach core2:", e.message);
    process.exit(1);
  }

  // Probe optional columns once
  const hasPct      = await hasColumn(pool, "PMM", "PctComplete");
  const hasCrmStat  = await hasColumn(pool, "PMM", "CRMProjectStatusChoice");
  const hasBU       = await hasColumn(pool, "PMM", "CRMBusinessUnitChoice");
  const hasOpmCrm   = await hasColumn(pool, "Opportunity", "CRMOpportunityStatusChoice");
  const hasOppCity  = await hasColumn(pool, "Opportunity", "City");

  // ── 1. PMM Projects ─────────────────────────────────────────────────────────
  console.log("[seed] 1/5  PMM projects…");
  let pmmNew = 0;
  for (const p of PROJECTS) {
    if (await exists(pool, "PMM", TID, { TicketId: p.ticket })) continue;

    let req = pool.request()
      .input("tid",   sql.NVarChar,  TID)
      .input("tick",  sql.NVarChar,  p.ticket)
      .input("title", sql.NVarChar,  p.title)
      .input("cv",    sql.Float,     p.cv)
      .input("lca",   sql.Float,     p.lca)
      .input("stat",  sql.NVarChar,  p.status)
      .input("start", sql.DateTime,  daysFromNow(p.startOffset))
      .input("end",   sql.DateTime,  daysFromNow(p.endOffset));

    let extraCols = "";
    let extraVals = "";

    if (hasPct) {
      req = req.input("pct", sql.Float, p.pct);
      extraCols += ", PctComplete";
      extraVals += ", @pct";
    }
    if (hasCrmStat) {
      req = req.input("crms", sql.NVarChar, p.status);
      extraCols += ", CRMProjectStatusChoice";
      extraVals += ", @crms";
    }
    if (hasBU) {
      req = req.input("bu", sql.NVarChar, p.bu);
      extraCols += ", CRMBusinessUnitChoice";
      extraVals += ", @bu";
    }

    await req.query(`INSERT INTO core2.dbo.PMM
      (TenantID, TicketId, Title, ApproxContractValue, LaborContractAmount,
       Status, TargetStartDate, TargetCompletionDate, Closed, Deleted${extraCols})
      VALUES (@tid, @tick, @title, @cv, @lca,
              @stat, @start, @end, 0, 0${extraVals})`);
    pmmNew++;
  }
  console.log(`       PMM: ${pmmNew} inserted, ${PROJECTS.length - pmmNew} already existed`);

  // ── 2. Opportunity Pursuits ─────────────────────────────────────────────────
  console.log("[seed] 2/5  Opportunity pursuits…");
  let opmNew = 0;
  for (const o of PURSUITS) {
    if (await exists(pool, "Opportunity", TID, { TicketId: o.ticket })) continue;

    let req = pool.request()
      .input("tid",   sql.NVarChar,  TID)
      .input("tick",  sql.NVarChar,  o.ticket)
      .input("title", sql.NVarChar,  o.title)
      .input("cv",    sql.Float,     o.cv)
      .input("chance",sql.NVarChar,  String(o.chance))
      .input("close", sql.DateTime,  daysFromNow(o.closeOffset))
      .input("stage", sql.NVarChar,  o.stage);

    let extraCols = "";
    let extraVals = "";
    if (hasOpmCrm) {
      req = req.input("crms", sql.NVarChar, o.stage);
      extraCols += ", CRMOpportunityStatusChoice";
      extraVals += ", @crms";
    }

    await req.query(`INSERT INTO core2.dbo.Opportunity
      (TenantID, TicketId, Title, ApproxContractValue,
       SuccessChance, CloseDate, Status, Closed, Deleted${extraCols})
      VALUES (@tid, @tick, @title, @cv, @chance, @close, @stage, 0, 0${extraVals})`);
    opmNew++;
  }
  console.log(`       Opportunity: ${opmNew} inserted, ${PURSUITS.length - opmNew} already existed`);

  // ── 3. AspNetUsers ──────────────────────────────────────────────────────────
  console.log("[seed] 3/5  AspNetUsers (team members)…");
  let userNew = 0;
  const hasTitleCol = await hasColumn(pool, "AspNetUsers", "Title");

  for (const u of USERS) {
    const ex = await pool.request()
      .input("tid",   sql.NVarChar, TID)
      .input("uname", sql.NVarChar, u.username)
      .query("SELECT Id FROM core2.dbo.AspNetUsers WHERE TenantID=@tid AND UserName=@uname");
    if (ex.recordset.length > 0) {
      u.guid = ex.recordset[0].Id;
      continue;
    }

    let req = pool.request()
      .input("id",    sql.NVarChar, u.guid)
      .input("tid",   sql.NVarChar, TID)
      .input("uname", sql.NVarChar, u.username)
      .input("name",  sql.NVarChar, u.name)
      .input("email", sql.NVarChar, u.username)
      .input("desig", sql.NVarChar, u.designation);

    let extraCols = "";
    let extraVals = "";
    if (hasTitleCol) {
      req = req.input("title", sql.NVarChar, u.title);
      extraCols += ", Title";
      extraVals += ", @title";
    }

    await req.query(`INSERT INTO core2.dbo.AspNetUsers
      (Id, TenantID, UserName, Name, Email, Designation,
       EmailConfirmed, PhoneNumberConfirmed, TwoFactorEnabled,
       LockoutEnabled, AccessFailedCount, Enabled, Deleted${extraCols})
      VALUES (@id, @tid, @uname, @name, @email, @desig,
              0, 0, 0, 0, 0, 1, 0${extraVals})`);
    userNew++;
  }
  console.log(`       AspNetUsers: ${userNew} inserted, ${USERS.length - userNew} already existed`);

  // ── 4. ResourceWorkItems + ResourceAllocation (assigned) ────────────────────
  console.log("[seed] 4/5  ResourceWorkItems + ResourceAllocation (assigned staff)…");
  const NOW = new Date();
  let raNew = 0;
  for (const a of ALLOCATIONS) {
    const user = USERS[a.ui];
    if (await exists(pool, "ResourceAllocation", TID, { ResourceUser: user.guid, TicketId: a.ticket })) continue;

    // Upsert RWI
    let rwiId: number;
    const rwiEx = await pool.request()
      .input("tid",  sql.NVarChar, TID)
      .input("uid",  sql.NVarChar, user.guid)
      .input("tick", sql.NVarChar, a.ticket)
      .query(`SELECT TOP 1 ID FROM core2.dbo.ResourceWorkItems
              WHERE TenantID=@tid AND ResourceUser=@uid AND WorkItem=@tick
              AND (Deleted IS NULL OR Deleted=0)`);
    if (rwiEx.recordset.length > 0) {
      rwiId = rwiEx.recordset[0].ID;
    } else {
      const rwiR = await pool.request()
        .input("tid",  sql.NVarChar, TID)
        .input("uid",  sql.NVarChar, user.guid)
        .input("tick", sql.NVarChar, a.ticket)
        .input("now",  sql.DateTime, NOW)
        .input("sys",  sql.NVarChar, "seed")
        .query(`INSERT INTO core2.dbo.ResourceWorkItems
          (TenantID, ResourceUser, WorkItem, WorkItemType, Title,
           Created, Modified, CreatedByUser, ModifiedByUser, Deleted)
          OUTPUT INSERTED.ID
          VALUES (@tid, @uid, @tick, 'Project', @tick, @now, @now, @sys, @sys, 0)`);
      rwiId = rwiR.recordset[0].ID;
    }

    const pct = Math.round((a.hours / (a.weeks * 40)) * 100);
    await pool.request()
      .input("tid",   sql.NVarChar, TID)
      .input("uid",   sql.NVarChar, user.guid)
      .input("tick",  sql.NVarChar, a.ticket)
      .input("hours", sql.Float,    a.hours)
      .input("pct",   sql.Float,    pct)
      .input("rwi",   sql.BigInt,   rwiId)
      .input("start", sql.DateTime, daysFromNow(-60))
      .input("end",   sql.DateTime, daysFromNow(90))
      .query(`INSERT INTO core2.dbo.ResourceAllocation
        (TenantID, ResourceUser, TicketId, ResourceWorkItemLookup,
         AllocationHour, PctAllocation,
         AllocationStartDate, AllocationEndDate, Deleted)
        VALUES (@tid, @uid, @tick, @rwi, @hours, @pct, @start, @end, 0)`);
    raNew++;
  }
  console.log(`       ResourceAllocation (assigned): ${raNew} inserted`);

  // ── 5. Open Demands (unassigned positions → staffing gap signals) ───────────
  // ResourceAllocation.ResourceWorkItemLookup is NOT NULL even for open demands,
  // so we must create a stub RWI row (ResourceUser = NULL is allowed there) first,
  // then link the RA row to it — same pattern as the assigned allocations above.
  console.log("[seed] 5/5  ResourceAllocation (open demands — no ResourceUser)…");
  let demandNew = 0;
  const hasRoleCol    = await hasColumn(pool, "ResourceAllocation", "Role");
  const hasRwiTitle   = await hasColumn(pool, "ResourceWorkItems",  "Title");
  const rwiIsIdentity = await pool.request()
    .input("t", sql.NVarChar, "ResourceWorkItems")
    .input("c", sql.NVarChar, "ID")
    .query(`SELECT c.is_identity FROM core2.sys.columns c
            JOIN core2.sys.tables t ON t.object_id = c.object_id
            WHERE t.name = @t AND c.name = @c`)
    .then((r: any) => r.recordset?.[0]?.is_identity === true);

  for (const d of DEMANDS) {
    // Check: any null-user RA row for this ticket+role already?
    const ex = await pool.request()
      .input("tid",  sql.NVarChar, TID)
      .input("tick", sql.NVarChar, d.ticket)
      .query(`SELECT COUNT(*) AS cnt FROM core2.dbo.ResourceAllocation
              WHERE TenantID=@tid AND TicketId=@tick AND ResourceUser IS NULL`);
    if ((ex.recordset[0]?.cnt ?? 0) > 0) continue;

    // Step A: upsert a stub RWI row with NULL ResourceUser
    let rwiDemandId: number;
    const rwiDemEx = await pool.request()
      .input("tid",  sql.NVarChar, TID)
      .input("tick", sql.NVarChar, d.ticket)
      .input("role", sql.NVarChar, d.role)
      .query(`SELECT TOP 1 ID FROM core2.dbo.ResourceWorkItems
              WHERE TenantID=@tid AND WorkItem=@tick AND ResourceUser IS NULL
              AND (Title=@role OR Title IS NULL)
              AND (Deleted IS NULL OR Deleted=0)`);
    if (rwiDemEx.recordset.length > 0) {
      rwiDemandId = rwiDemEx.recordset[0].ID;
    } else {
      let rwiReq = pool.request()
        .input("tid",  sql.NVarChar, TID)
        .input("tick", sql.NVarChar, d.ticket)
        .input("now",  sql.DateTime, NOW)
        .input("sys",  sql.NVarChar, "seed");

      let rwiExtraCols = "";
      let rwiExtraVals = "";
      if (hasRwiTitle) {
        rwiReq = rwiReq.input("role", sql.NVarChar, d.role);
        rwiExtraCols += ", Title";
        rwiExtraVals += ", @role";
      }

      // ID: supply manually if not identity
      let rwiIdClause = "";
      if (!rwiIsIdentity) {
        const maxR = await pool.request()
          .input("tid", sql.NVarChar, TID)
          .query(`SELECT ISNULL(MAX(ID), 0) + 1 AS nextId FROM core2.dbo.ResourceWorkItems WHERE TenantID=@tid`);
        const nextId = maxR.recordset[0]?.nextId ?? 1;
        rwiReq = rwiReq.input("newid", sql.BigInt, nextId);
        rwiIdClause = "ID, ";
      }

      const rwiInsert = await rwiReq.query(`INSERT INTO core2.dbo.ResourceWorkItems
        (${rwiIdClause}TenantID, ResourceUser, WorkItem, WorkItemType,
         Created, Modified, CreatedByUser, ModifiedByUser, Deleted${rwiExtraCols})
        OUTPUT INSERTED.ID
        VALUES (${rwiIsIdentity ? "" : "@newid, "}@tid, NULL, @tick, 'Project',
                @now, @now, @sys, @sys, 0${rwiExtraVals})`);
      rwiDemandId = rwiInsert.recordset[0].ID;
    }

    // Step B: insert the open-demand RA row pointing at the stub RWI
    let raReq = pool.request()
      .input("tid",   sql.NVarChar, TID)
      .input("tick",  sql.NVarChar, d.ticket)
      .input("pct",   sql.Float,    d.pct)
      .input("rwi",   sql.BigInt,   rwiDemandId)
      .input("start", sql.DateTime, daysFromNow(d.startOffset))
      .input("end",   sql.DateTime, daysFromNow(d.endOffset));

    let raExtraCols = "";
    let raExtraVals = "";
    if (hasRoleCol) {
      raReq = raReq.input("role", sql.NVarChar, d.role);
      raExtraCols += ", Role";
      raExtraVals += ", @role";
    }

    await raReq.query(`INSERT INTO core2.dbo.ResourceAllocation
      (TenantID, ResourceUser, TicketId, ResourceWorkItemLookup,
       PctAllocation, AllocationStartDate, AllocationEndDate, Deleted${raExtraCols})
      VALUES (@tid, NULL, @tick, @rwi, @pct, @start, @end, 0${raExtraVals})`);
    demandNew++;
  }
  console.log(`       ResourceAllocation (demands):  ${demandNew} inserted`);

  // ── Summary ──────────────────────────────────────────────────────────────────
  const backlog     = PROJECTS.reduce((s, p) => s + p.cv, 0);
  const pipeline    = PURSUITS.reduce((s, o) => s + (o.cv * o.chance / 100), 0);
  const pipeCov     = Math.round((pipeline / (backlog * 0.25)) * 100);
  const overdue     = PROJECTS.filter(p => p.endOffset < 0 && p.pct < 100).length;
  const dueSoon     = PROJECTS.filter(p => p.endOffset >= 0 && p.endOffset <= 30).length;
  const atRisk      = PROJECTS.filter(p => p.endOffset < 0).length;
  const bench       = USERS.length - new Set(ALLOCATIONS.map(a => a.ui)).size;
  const overAlloc   = new Set(
    ALLOCATIONS.filter(a => {
      const total = ALLOCATIONS.filter(x => x.ui === a.ui)
        .reduce((s, x) => s + Math.round((x.hours / (x.weeks * 40)) * 100), 0);
      return total > 100;
    }).map(a => a.ui),
  ).size;

  console.log(`\n✓ Seed complete for ${TENANT_LABEL} (${TID})`);
  console.log("\n  Role signals expected:");
  console.log(`  COO / EXEC  — ${PROJECTS.length} active projects · ${DEMANDS.length} open demands · ${overAlloc} over-allocated`);
  console.log(`  CFO         — Pipeline weighted ~$${(pipeline / 1e6).toFixed(1)}M · Coverage ~${pipeCov}% · Portfolio $${(backlog / 1e6).toFixed(1)}M`);
  console.log(`  PM          — ${overdue} overdue projects · ${dueSoon} due ≤30d · avg progress mixed`);
  console.log(`  Res. Mgr    — ${USERS.length} staff · ${bench} bench · ${overAlloc} over-allocated · ${DEMANDS.length} open slots`);
  console.log(`  Pipeline    — ${PURSUITS.length} pursuits closing 12–88 days out`);

  process.exit(0);
}

seed().catch(e => { console.error("[seed] FATAL:", e.message); process.exit(1); });
