import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();

// ── Tab 1: messy team/staff names + extra unrecognized columns ──────────────
const team = wb.addWorksheet("Staff Directory 2026");
team.columns = [
  { header: "Employee ID", key: "eid" },              // unrecognized
  { header: "Business Unit", key: "bu" },             // → Division
  { header: "Dept", key: "dept" },                    // → Department
  { header: "Job Role", key: "role" },                // → Role
  { header: "Job Title", key: "title" },              // → JobTitle
  { header: "Bill Rate ($/hr)", key: "bill" },        // → BillingRate
  { header: "Pay Rate", key: "labor" },               // → EmpLaborRate
  { header: "Loaded Cost/hr", key: "cost" },          // → EmpCostRate
  { header: "Work Email", key: "email" },             // → UserName
  { header: "Employee Name", key: "name" },           // → FullName
  { header: "Personal Email", key: "pemail" },        // → Email (maybe)
  { header: "Temp Password", key: "pwd" },            // → Password
  { header: "Permission Level", key: "perm" },        // → UserRole
  { header: "Reports To", key: "mgr" },               // → Manager
  { header: "Hire Date", key: "hire" },               // → StartDate
  { header: "Termination Date", key: "term" },        // → EndDate
  { header: "Short Bio", key: "bio" },                // → JobProfile
  { header: "Is People Manager", key: "ismgr" },      // → IsManager
  { header: "Mobile Phone", key: "phone" },           // unrecognized
  { header: "Office Location", key: "office" },       // unrecognized
  { header: "Certifications", key: "certs" },         // unrecognized
];
const divisions = ["Infrastructure", "Buildings", "Water", "Transportation"];
const depts = ["Engineering", "Architecture", "Project Management", "MEP"];
const roles = ["Senior Engineer", "Project Engineer", "Designer", "Principal", "Project Manager"];
const titles = ["Lead Engineer", "Staff Engineer", "Sr Designer", "Partner", "PM II"];
for (let i = 1; i <= 14; i++) {
  team.addRow({
    eid: `EMP-${1000 + i}`,
    bu: divisions[i % divisions.length],
    dept: depts[i % depts.length],
    role: roles[i % roles.length],
    title: titles[i % titles.length],
    bill: 150 + i * 5,
    labor: 60 + i * 2,
    cost: 95 + i * 3,
    email: `user${i}@acmeaefirm.com`,
    name: `Employee ${i} Lastname${i}`,
    pemail: `emp${i}@gmail.com`,
    pwd: "Welcome@123",
    perm: i === 1 ? "Admin" : i % 4 === 0 ? "Manager" : "User",
    mgr: i > 1 ? "user1@acmeaefirm.com" : "",
    hire: `20${20 + (i % 6)}-0${1 + (i % 9)}-15`,
    term: i % 7 === 0 ? "2026-12-31" : "",
    bio: `Specialist in ${depts[i % depts.length].toLowerCase()} with ${i} years experience.`,
    ismgr: i % 4 === 0 ? 1 : 0,
    phone: `+1-415-555-${1000 + i}`,
    office: ["San Francisco", "Oakland", "San Jose"][i % 3],
    certs: i % 2 === 0 ? "PE, LEED AP" : "EIT",
  });
}

// ── Tab 2: clients/projects with MANY columns, messy headers ────────────────
const clients = wb.addWorksheet("Client Projects & Opportunities");
clients.columns = [
  { header: "Record Type", key: "type" },             // → Type
  { header: "Client / Company", key: "co" },          // → CompanyName
  { header: "Primary Contact", key: "contact" },      // → ContactName
  { header: "Account Owner", key: "rep" },            // → ClientRep
  { header: "Relationship Health", key: "health" },   // → CRMHealth
  { header: "Industry", key: "sector" },              // → MarketSector
  { header: "Engagement Name", key: "ptitle" },       // → ProjectTitle
  { header: "Internal Job #", key: "erp" },           // → ERPJobID
  { header: "Engagement Type", key: "ptype" },        // → ProjectType
  { header: "Discipline", key: "svc" },               // → ServiceType
  { header: "Work Category", key: "reqcat" },         // → RequestCategory
  { header: "Classification", key: "cat" },           // → Category
  { header: "Label / Tag", key: "tag" },              // → ProjectTag
  { header: "Total Fee ($)", key: "cv" },             // → ContractValue
  { header: "Not-To-Exceed Cap", key: "limit" },      // → ContractLimit
  { header: "Target Margin %", key: "margin" },       // → GrossMargin
  { header: "Pricing Model", key: "ctype" },          // → ContractType
  { header: "Win Probability %", key: "win" },        // → ChanceOfSuccessChoice
  { header: "Stage", key: "status" },                 // → Status
  { header: "Managing Division", key: "div" },        // → Division
  { header: "Owning Department", key: "dept" },        // → Department
  { header: "Kickoff Date", key: "start" },           // → StartDate
  { header: "Target Finish", key: "end" },            // → EndDate
  { header: "Proposal Deadline", key: "prop" },       // → ProposalPhaseDueDate
  { header: "Precon Start", key: "preconS" },         // → PreconStartDate
  { header: "Precon End", key: "preconE" },           // → PreconEndDate
  { header: "Construction Start", key: "constS" },     // → ConstStartDate
  { header: "Closeout Date", key: "closeout" },       // → CloseoutDate
  { header: "Site Address", key: "addr" },            // unrecognized
  { header: "City", key: "city" },                    // unrecognized
  { header: "ZIP", key: "zip" },                      // unrecognized
  { header: "Internal Notes", key: "notes" },         // unrecognized
];
const cos = ["Metro Transit Authority", "Harbor Health System", "Vista Unified Schools", "Coastal Power Co", "Summit Developers"];
for (let i = 1; i <= 16; i++) {
  const isOpp = i % 3 === 0;
  clients.addRow({
    type: isOpp ? "Opportunity" : "Project",
    co: cos[i % cos.length],
    contact: `Contact ${i} Person; Secondary ${i}`,
    rep: `user${(i % 5) + 1}@acmeaefirm.com`,
    health: ["Good", "Fair", "Poor"][i % 3],
    sector: ["Transportation", "Healthcare", "Education", "Energy", "Commercial"][i % 5],
    ptitle: `${cos[i % cos.length]} - Phase ${i} ${isOpp ? "Pursuit" : "Delivery"}`,
    erp: `JOB-26-${2000 + i}`,
    ptype: ["Design", "Construction", "Consulting", "Renovation"][i % 4],
    svc: ["Architecture", "Engineering", "PM", "MEP"][i % 4],
    reqcat: ["New Build", "Retrofit", "Study"][i % 3],
    cat: ["Vertical", "Horizontal"][i % 2],
    tag: `FY26-${i}`,
    cv: 500000 + i * 125000,
    limit: 600000 + i * 130000,
    margin: 28 + (i % 12),
    ctype: ["Fixed", "T&M", "Cost-Plus", "GMP"][i % 4],
    win: isOpp ? 40 + (i % 50) : "",
    status: ["Active", "On Hold", "Closed"][i % 3],
    div: divisions[i % divisions.length],
    dept: depts[i % depts.length],
    start: `2026-0${1 + (i % 9)}-01`,
    end: `2027-0${1 + (i % 9)}-28`,
    prop: isOpp ? `2026-0${1 + (i % 9)}-10` : "",
    preconS: `2026-0${1 + (i % 8)}-05`,
    preconE: `2026-0${2 + (i % 8)}-20`,
    constS: `2026-0${3 + (i % 6)}-01`,
    closeout: `2027-1${i % 2}-15`,
    addr: `${100 + i} Main Street`,
    city: ["San Francisco", "Oakland", "Sacramento"][i % 3],
    zip: `9${4000 + i}`,
    notes: `Key pursuit for FY26. Champion is Contact ${i}.`,
  });
}

// ── Tab 3: assignments / allocations ────────────────────────────────────────
const assign = wb.addWorksheet("Resource Assignments");
assign.columns = [
  { header: "Engagement", key: "proj" },              // → Project
  { header: "Assigned To (email)", key: "res" },      // → Resource
  { header: "From", key: "from" },                    // → AllocationStartDate
  { header: "Until", key: "until" },                  // → AllocationEndDate
  { header: "% Time", key: "pct" },                   // → PctAllocation
  { header: "Budget Hours", key: "hrs" },             // → AllocationHour
  { header: "Booking Type", key: "btype" },           // → AllocationType
  { header: "Bill Rate Override", key: "bill" },      // → BillingRate
  { header: "Work Package", key: "wp" },              // unrecognized
];
for (let i = 1; i <= 18; i++) {
  assign.addRow({
    proj: `${cos[i % cos.length]} - Phase ${(i % 16) + 1} ${(i % 3 === 0) ? "Pursuit" : "Delivery"}`,
    res: `user${(i % 14) + 1}@acmeaefirm.com`,
    from: `2026-0${1 + (i % 9)}-01`,
    until: `2026-${10 + (i % 3)}-31`,
    pct: [25, 50, 75, 100][i % 4],
    hrs: 200 + i * 20,
    btype: i % 2 === 0 ? "Hard" : "Soft",
    bill: i % 5 === 0 ? 185 : "",
    wp: `WP-${i}`,
  });
}

// ── Tab 4: junk / instructions tab (should be skipped or low-scored) ────────
const readme = wb.addWorksheet("README - Instructions");
readme.columns = [{ header: "Instructions", key: "txt" }];
readme.addRow({ txt: "Fill in the three data tabs above. Do not edit this sheet." });
readme.addRow({ txt: "Questions? Email onboarding@acmeaefirm.com" });

const path = "/tmp/complex_client.xlsx";
await wb.xlsx.writeFile(path);
console.log("WROTE", path, "tabs:", wb.worksheets.map(w => w.name).join(" | "));
