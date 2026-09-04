/**
 * Backend mirror of the import-page template (InlineDataGrid column sets).
 *
 * SOURCE OF TRUTH: artifacts/rmone-web/src/components/InlineDataGrid.tsx
 *   PROJECT_COLS / SCHEDULE_COLS / STAFF_COLS / ASG_COLS / OPP_COLS /
 *   LEADS_COLS / COMPANIES_COLS and getTabsForCard() sheet names.
 * If those change, this file MUST be updated in lockstep — the acceptance
 * test is that a cleaned file loads into the import page with ZERO
 * unrecognised columns.
 */

export type ColKind = "text" | "date" | "currency" | "number" | "email";

export interface TemplateCol {
  label: string;      // exact header the import page expects
  kind: ColKind;
  required?: boolean; // mandatory on every populated row
}

export type ModuleId =
  | "projects" | "assignments" | "schedule" | "team"
  | "opportunities" | "leads" | "companies";

/** Sheet name in the output workbook, exactly as the import page expects. */
export const SHEET_NAME: Record<ModuleId, string> = {
  projects:      "Projects",
  assignments:   "Team Assignments",
  schedule:      "Schedule",
  team:          "Staff",
  opportunities: "Opportunities",
  leads:         "Leads",
  companies:     "Companies",
};

const t  = (label: string, required = false): TemplateCol => ({ label, kind: "text", required });
const d  = (label: string): TemplateCol => ({ label, kind: "date" });
const c  = (label: string): TemplateCol => ({ label, kind: "currency" });
const n  = (label: string): TemplateCol => ({ label, kind: "number" });
const em = (label: string, required = false): TemplateCol => ({ label, kind: "email", required });

export const TEMPLATE_COLS: Record<ModuleId, TemplateCol[]> = {
  projects: [
    t("Project ID", true), t("Project Title", true), t("Company Name"),
    t("Contact Name"), t("Short Name"), t("Market Sector"), t("Project Type"),
    t("Service Type"), t("Category"), t("Business Unit"), t("Division"),
    t("Department"), t("Status"), d("Start Date"), d("End Date"),
    d("Actual Start"), d("Actual End"),
    d("Closeout Date"), c("Contract Value"),
    c("Labor Budget"), c("Gross Margin"), t("Contract Type"),
    c("Contracted Amount"), c("Proposal Amount"), c("Bid Amount"),
    c("Change Orders"), c("Approved Change Orders"), c("Retainage"),
    n("Fee %"), c("Contingency"), c("Non-Operating Cost"),
    c("Total Project Cost"), n("% Complete"), t("Priority"),
    t("Next Milestone"), d("Next Milestone Date"), t("Description"),
    t("Notes"), t("Street Address"), t("City"), t("State"), t("Office"),
    t("From Opportunity"), d("Bid Due Date"), n("Retainage Percent"),
    c("Actual Project Cost"), c("Forecasted Project Cost"),
    t("Business Lead"), t("Project Manager"), t("Sr Project Manager"),
    d("Created On"), t("Groups"),
  ],
  schedule: [
    t("Project ID", true), t("Project Title"), t("Phase Name"),
    n("Phase Order"), d("Start Date"), d("End Date"), n("Duration (days)"),
    t("Milestone"), n("% Complete"), t("Notes"),
  ],
  team: [
    t("Full Name", true), em("Login Email", true), t("Business Unit"),
    t("Division"), t("Department"), t("Role"), t("Job Title"),
    t("Access Level"), d("Start Date"), t("Employee Type"),
    t("Phone Number"), t("Employee ID"), t("Skills"), t("Experience Tags"),
  ],
  assignments: [
    t("Project ID", true), t("Project", true), t("Name", true), em("Email"),
    d("Start Date"), d("End Date"), n("Total Hours"), t("Type"), t("Role"),
    t("Job Title"), t("Business Unit"), t("Division"), t("Department"),
    c("Billing Rate"), c("Labor Rate"), c("Cost Rate"), d("Actual Start"),
    d("Actual End"), n("Actual Hours"), n("Billed Hours"), t("Access Level"),
  ],
  opportunities: [
    t("Opportunity ID", true), t("Opportunity Title", true),
    t("Project Category"), t("Company Name"), t("Contact Name"), t("Stage"),
    t("Chance of Success"), t("Market Sector"), t("Business Unit"),
    t("Division"), t("Department"),
    d("Target Start"), d("Target End"), d("Actual Start"), d("Actual End"),
    d("Award / Loss Date"), c("Approx Contract Value"),
    c("Forecasted Project Cost"), c("Labor Contract Amount"),
    c("Non-Operating Cost"), n("Gross Margin"), t("Contract Type"),
    t("Description"), t("Notes"), t("Point of Contact"), t("Status"),
    t("Office"), t("Access Level"),
    t("Business Lead"), t("Project Manager"), t("Sr Project Manager"),
    d("Created On"), t("Groups"),
  ],
  leads: [
    t("Lead ID", true), t("Lead Name", true), t("Company Name"),
    t("Contact Name"), t("Stage"), t("Status"), t("Market Sector"),
    t("Business Unit"), t("Division"), t("Department"), d("Bid Due Date"),
    d("Forecast Start"), d("Forecast End"), c("Est. Contract Value"),
    t("Description"), t("Notes"),
  ],
  companies: [
    t("Company Name", true), t("Company ID"), t("Abbreviated Name"),
    t("Relationship Type"), t("Business Type"), t("Secondary Business Type"),
    t("Industry"), t("CRM Health"),
    t("Contact Name"), em("Contact Email"), t("Contact Title"),
    t("Phone"), t("Fax"),
    t("Address"), t("Street 2"), t("City"), t("State"), t("Zip"),
    t("Assigned To"), t("Client Rep"), t("Division"), t("Description"),
  ],
};

/** The mandatory per-row ID column per module (import page hard-blocks without it). */
export const REQUIRED_ID: Record<ModuleId, string | null> = {
  projects:      "Project ID",
  assignments:   "Project ID",
  schedule:      "Project ID",
  team:          "Login Email",
  opportunities: "Opportunity ID",
  leads:         "Lead ID",
  companies:     null,
};

// ── Normalisation + synonym matching ────────────────────────────────────────

export function normKey(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9%]/g, "");
}

/** Per-module header synonyms (normKey form → template label). */
const SYN: Record<ModuleId, Record<string, string>> = {
  projects: {
    projectname: "Project Title", title: "Project Title", name: "Project Title",
    project: "Project Title", jobname: "Project Title",
    projectnumber: "Project ID", jobnumber: "Project ID", jobno: "Project ID",
    projectno: "Project ID", id: "Project ID", ticketid: "Project ID",
    projid: "Project ID", projectcode: "Project ID",
    client: "Company Name", clientname: "Company Name", owner: "Company Name",
    company: "Company Name", customer: "Company Name",
    pointofcontact: "Contact Name", contactperson: "Contact Name",
    contact: "Contact Name",
    projectcategory: "Category",
    typeofproject: "Project Type",
    nickname: "Short Name",
    sector: "Market Sector", market: "Market Sector",
    bu: "Business Unit", businessline: "Business Unit",
    dept: "Department", div: "Division",
    value: "Contract Value", contractamount: "Contract Value",
    totalvalue: "Contract Value", fee: "Contract Value",
    laborcontractamount: "Labor Budget",
    begindate: "Start Date", startdate: "Start Date", start: "Start Date",
    kickoffdate: "Start Date",
    targetstartdate: "Start Date", targetstart: "Start Date",
    enddate: "End Date", finishdate: "End Date", end: "End Date",
    completiondate: "End Date",
    targetenddate: "End Date", targetend: "End Date",
    targetcompletiondate: "End Date", targetcompletion: "End Date",
    realstart: "Actual Start", actualbegin: "Actual Start",
    realfinish: "Actual End", actualfinish: "Actual End",
    agreementtype: "Contract Type", awardedamount: "Contracted Amount",
    proposedvalue: "Proposal Amount", bidprice: "Bid Amount",
    retention: "Retainage", contingencyreserve: "Contingency",
    totalcost: "Total Project Cost", nonopcosts: "Non-Operating Cost",
    feepercentage: "Fee %",
    pctcomplete: "% Complete",
    percentcomplete: "% Complete", percentdone: "% Complete",
    "done%": "% Complete",
    prioritylevel: "Priority",
    upcomingmilestone: "Next Milestone", milestonedue: "Next Milestone Date",
    state: "State", stateprovince: "State",
    address: "Street Address", addressline1: "Street Address",
    towncity: "City", officelocation: "Office",
    sourceopportunity: "From Opportunity",
    projectstatus: "Status", stage: "Status", type: "Project Type",
    phase: "Status", currentphase: "Status", projectphase: "Status",
    phasestatus: "Status", workstatus: "Status", currentstatus: "Status",
    businesslead: "Business Lead", businessunitlead: "Business Lead",
    bulead: "Business Lead", bizlead: "Business Lead",
    projectmanager: "Project Manager", projectmgr: "Project Manager",
    pm: "Project Manager",
    srprojectmanager: "Sr Project Manager",
    seniorprojectmanager: "Sr Project Manager", srpm: "Sr Project Manager",
    seniorpm: "Sr Project Manager",
    createdon: "Created On", createddate: "Created On",
    datecreated: "Created On", creationdate: "Created On",
    created: "Created On",
    actionuser: "Groups", actionusers: "Groups", usergroups: "Groups",
    projectdescription: "Description", comments: "Notes", note: "Notes",
    remarks: "Notes",
    biddue: "Bid Due Date", biddeadline: "Bid Due Date",
    bidsubmissiondate: "Bid Due Date",
    retainagechoice: "Retainage Percent",
    retainagepercentage: "Retainage Percent",
    retainagerate: "Retainage Percent",
    actualcost: "Actual Project Cost", actualtotalcost: "Actual Project Cost",
    forecastedcost: "Forecasted Project Cost",
    forecastcost: "Forecasted Project Cost",
    projectedprojectcost: "Forecasted Project Cost",
  },
  assignments: {
    projecttitle: "Project", projectname: "Project", job: "Project",
    assignedproject: "Project",
    projectnumber: "Project ID", jobnumber: "Project ID", jobno: "Project ID",
    ticketid: "Project ID", projid: "Project ID", projectcode: "Project ID",
    jobcode: "Project ID",
    resource: "Name", teammember: "Name", employee: "Name", person: "Name",
    staff: "Name", fullname: "Name", employeename: "Name", resourcename: "Name",
    staffmember: "Name",
    emailaddress: "Email", loginemail: "Email", mail: "Email",
    hours: "Total Hours", allocationhours: "Total Hours",
    allocationhour: "Total Hours",
    totalhrs: "Total Hours", hrs: "Total Hours", allochours: "Total Hours",
    plannedhrs: "Total Hours", plannedhours: "Total Hours",
    plannedefforth: "Total Hours",
    begindate: "Start Date", allocationstartdate: "Start Date",
    assignmentstart: "Start Date",
    allocationenddate: "End Date", finishdate: "End Date",
    assignmentend: "End Date",
    actualbegin: "Actual Start", actlbegin: "Actual Start",
    realstart: "Actual Start",
    actualfinish: "Actual End", actlfinish: "Actual End",
    realfinish: "Actual End",
    hoursactual: "Actual Hours", actualhrs: "Actual Hours",
    hrslogged: "Actual Hours",
    hoursbilled: "Billed Hours", billedhrs: "Billed Hours",
    invoicedhrs: "Billed Hours",
    permission: "Access Level", perms: "Access Level",
    userrole: "Access Level",
    projectrole: "Role", roleonjob: "Role",
    allocationtype: "Type", alloctype: "Type",
    title: "Job Title", position: "Job Title", jobtitle: "Job Title",
    bu: "Business Unit", dept: "Department", div: "Division",
    bustudio: "Business Unit",
    rate: "Billing Rate", billrate: "Billing Rate",
    ratebill: "Billing Rate", billratehr: "Billing Rate",
    ratecost: "Cost Rate", costhr: "Cost Rate",
    ratelabor: "Labor Rate", labourrate: "Labor Rate",
  },
  schedule: {
    projecttitle: "Project Title", projectname: "Project Title",
    project: "Project Title", job: "Project Title",
    projectnumber: "Project ID", jobnumber: "Project ID", ticketid: "Project ID",
    jobcode: "Project ID", jobid: "Project ID", jobno: "Project ID",
    projid: "Project ID",
    phase: "Phase Name", phasetitle: "Phase Name", task: "Phase Name",
    taskname: "Phase Name", stage: "Phase Name",
    workstream: "Phase Name", workstreamstage: "Phase Name",
    order: "Phase Order", sequence: "Phase Order", seq: "Phase Order",
    begindate: "Start Date", begins: "Start Date", phasestart: "Start Date",
    enddate: "End Date", duedate: "End Date", ends: "End Date",
    phasefinish: "End Date",
    finishdate: "End Date", duration: "Duration (days)",
    durationdays: "Duration (days)", dur: "Duration (days)",
    days: "Duration (days)",
    milestoneflag: "Milestone", ismilestone: "Milestone",
    pctcomplete: "% Complete",
    percentcomplete: "% Complete", percentdone: "% Complete",
    "done%": "% Complete", "progress%": "% Complete",
    comments: "Notes", remarks: "Notes", remarkslog: "Notes", note: "Notes",
  },
  team: {
    name: "Full Name", employeename: "Full Name", employee: "Full Name",
    staffname: "Full Name", person: "Full Name", resource: "Full Name",
    email: "Login Email", emailaddress: "Login Email", username: "Login Email",
    mail: "Login Email", workemail: "Login Email",
    bu: "Business Unit", dept: "Department", div: "Division",
    title: "Job Title", position: "Job Title", jobposition: "Job Title",
    accesslevel: "Access Level", userrole: "Access Level",
    permission: "Access Level", perms: "Access Level", hiredate: "Start Date",
    startdate: "Start Date", joindate: "Start Date",
    phone: "Phone Number", phoneno: "Phone Number", mobile: "Phone Number",
    empid: "Employee ID", employeeno: "Employee ID", staffid: "Employee ID",
    type: "Employee Type", employmenttype: "Employee Type",
  },
  opportunities: {
    title: "Opportunity Title", opportunityname: "Opportunity Title",
    oppname: "Opportunity Title", opptitle: "Opportunity Title",
    projecttitle: "Opportunity Title", name: "Opportunity Title",
    oppid: "Opportunity ID", opportunitynumber: "Opportunity ID",
    ticketid: "Opportunity ID", id: "Opportunity ID", erpjob: "Opportunity ID",
    client: "Company Name", company: "Company Name", customer: "Company Name",
    probability: "Chance of Success", chance: "Chance of Success",
    winprobability: "Chance of Success", pwin: "Chance of Success",
    value: "Approx Contract Value", contractvalue: "Approx Contract Value",
    estimatedvalue: "Approx Contract Value", estvalue: "Approx Contract Value",
    bu: "Business Unit", dept: "Department", div: "Division",
    sector: "Market Sector", market: "Market Sector",
    startdate: "Target Start", enddate: "Target End",
    forecaststart: "Target Start", forecastend: "Target End",
    targetstart: "Target Start", targetend: "Target End",
    actualstart: "Actual Start", actualend: "Actual End",
    comments: "Notes",
    phase: "Status", currentphase: "Status", phasestatus: "Status",
    businesslead: "Business Lead", businessunitlead: "Business Lead",
    bulead: "Business Lead", bizlead: "Business Lead",
    projectmanager: "Project Manager", projectmgr: "Project Manager",
    pm: "Project Manager",
    srprojectmanager: "Sr Project Manager",
    seniorprojectmanager: "Sr Project Manager", srpm: "Sr Project Manager",
    seniorpm: "Sr Project Manager",
    createdon: "Created On", createddate: "Created On",
    datecreated: "Created On", creationdate: "Created On",
    created: "Created On",
    actionuser: "Groups", actionusers: "Groups", usergroups: "Groups",
  },
  leads: {
    name: "Lead Name", title: "Lead Name", leadtitle: "Lead Name",
    id: "Lead ID", leadnumber: "Lead ID", ticketid: "Lead ID",
    client: "Company Name", company: "Company Name",
    value: "Est. Contract Value", contractvalue: "Est. Contract Value",
    estimatedvalue: "Est. Contract Value",
    bu: "Business Unit", dept: "Department", div: "Division",
    sector: "Market Sector", startdate: "Forecast Start",
    enddate: "Forecast End", comments: "Notes",
  },
  companies: {
    name: "Company Name", company: "Company Name", client: "Company Name",
    companyname: "Company Name", sector: "Industry", marketsector: "Industry",
    email: "Contact Email", contactemail: "Contact Email",
    contact: "Contact Name", contactperson: "Contact Name",
    title: "Contact Title", phoneno: "Phone", telephone: "Phone",
    street: "Address", streetaddress: "Address", div: "Division",
    accountmanager: "Client Rep", relationshipowner: "Client Rep",
  },
};

/** Tab-name synonyms for module detection (normKey form). */
const TAB_SYNONYMS: Record<string, ModuleId> = {
  projects: "projects", project: "projects", clientsprojects: "projects",
  projectlist: "projects", pmm: "projects", jobs: "projects",
  activeprojects: "projects",
  teamassignments: "assignments", assignments: "assignments",
  assignment: "assignments", staffing: "assignments",
  allocations: "assignments", allocation: "assignments",
  resourceallocation: "assignments", resourceallocations: "assignments",
  staffingplan: "assignments",
  schedule: "schedule", schedules: "schedule", phases: "schedule",
  milestones: "schedule", projectschedule: "schedule",
  staff: "team", staffroster: "team", team: "team", teammembers: "team",
  yourteam: "team", employees: "team", roster: "team", people: "team",
  personnel: "team",
  opportunities: "opportunities", opportunity: "opportunities",
  opps: "opportunities", pipeline: "opportunities", opm: "opportunities",
  pursuits: "opportunities",
  leads: "leads", lead: "leads", lem: "leads",
  companies: "companies", company: "companies", crmcompanies: "companies",
  vendors: "companies", contacts: "companies",
};

/** Map a source header to a template label deterministically. */
export function matchHeader(module: ModuleId, source: string): string | null {
  const k = normKey(source);
  if (!k) return null;
  for (const col of TEMPLATE_COLS[module]) {
    if (normKey(col.label) === k) return col.label;
  }
  return SYN[module][k] ?? null;
}

/**
 * Classify a sheet to a module: tab-name first, then header-content scoring.
 * Returns null when nothing scores high enough (sheet is skipped + reported).
 */
export function classifySheet(sheetName: string, headers: string[]): ModuleId | null {
  // Review sheets from a previous cleaning run ("Projects — Review") hold
  // quarantined rows — never classify them as a module, or re-cleaning a
  // cleaned file would merge held-back rows into the clean output.
  if (/[—–-]\s*review\s*$/i.test(sheetName.trim())) return null;

  const scoreFor = (mod: ModuleId) => {
    let hits = 0;
    for (const h of headers) if (matchHeader(mod, h)) hits++;
    return { hits, score: headers.length ? hits / headers.length : 0 };
  };

  let best: ModuleId | null = null;
  let bestScore = 0;
  for (const mod of Object.keys(TEMPLATE_COLS) as ModuleId[]) {
    const { hits, score } = scoreFor(mod);
    if (hits >= 3 && score > bestScore) { bestScore = score; best = mod; }
  }

  const byName = TAB_SYNONYMS[normKey(sheetName)];
  if (byName) {
    // The tab name wins UNLESS the columns clearly belong to a different tab
    // (e.g. a tab named "Team" whose columns are really assignment columns —
    // Project, Start Date, Total Hours…). Require a decisive margin so a
    // genuine match by name is never flipped on a near-tie: staff and
    // assignment tabs share many columns (Name, Email, Role, Job Title…),
    // so only a distinctly better fit (like a Project column) overrides.
    if (best && best !== byName && bestScore >= 0.4 && bestScore >= scoreFor(byName).score + 0.2) {
      return best;
    }
    return byName;
  }
  return bestScore >= 0.4 ? best : null;
}

export function templateLabels(module: ModuleId): string[] {
  return TEMPLATE_COLS[module].map(col => col.label);
}

/**
 * Compact catalog of ALL template tabs + columns for the whole-sheet AI
 * planning prompt. Every module at once — the planner may map any column to
 * any tab, which is what lets mixed sheets split correctly.
 */
export function catalogForPrompt(): string {
  return (Object.keys(TEMPLATE_COLS) as ModuleId[]).map(mod => {
    const cols = TEMPLATE_COLS[mod]
      .map(c => `"${c.label}"(${c.kind}${c.required ? ",required" : ""})`)
      .join(", ");
    return `${mod} — sheet "${SHEET_NAME[mod]}":\n  ${cols}`;
  }).join("\n");
}

export function colKind(module: ModuleId, label: string): ColKind {
  return TEMPLATE_COLS[module].find(col => col.label === label)?.kind ?? "text";
}
