// Curated standard job titles offered as ready-to-pick suggestions in staff
// forms and the bulk-upload Excel template. Picking one creates the title in
// the catalogue instead of forcing free-text entry (which risks typos like
// "C.E.O" that break home-persona matching in roleResolver).
//
// Persona keywords (roleResolver TRANSLATIONS):
//   EXECUTIVE:        CEO, President, Principal, Managing Director, Partner, Owner,
//                     Director, Vice President, SVP, EVP, Managing Partner
//   CFO:              CFO, Controller, Finance Manager, Finance Director,
//                     Chief Financial Officer
//   COO:              COO, Operations Manager, Operations Director
//   RESOURCE_MANAGER: Resource Manager, Staffing Manager, HR Manager, HR Director,
//                     Talent Manager, Workforce Manager
//   PROJECT_MANAGER:  Project Manager, Program Manager, Senior Project Manager,
//                     Construction Manager, PMO Director
// (CTO/CIO included as common titles; persona defaults to Project Manager
//  unless overridden via the profile persona menu.)

export const STANDARD_JOB_TITLES: string[] = [

  // ── Persona titles first (daily briefing / home login roles) ─────────────
  // EXECUTIVE persona
  "CEO",
  "President",
  "Managing Director",
  "Partner",
  "Principal",
  "Owner",
  // CFO persona
  "CFO",
  "Controller",
  "Finance Manager",
  // COO persona
  "COO",
  "Operations Manager",
  // PROJECT_MANAGER persona
  "Project Manager",
  "Senior Project Manager",
  "Program Manager",
  // RESOURCE_MANAGER persona
  "Resource Manager",
  "Staffing Manager",
  "HR Manager",

  // ── Remaining C-Suite & Executive ────────────────────────────────────────
  "CTO",
  "CIO",
  "CMO",
  "CHRO",
  "CSO",
  "CLO",
  "CPO",
  "Executive Vice President",
  "Senior Vice President",
  "Vice President",
  "Managing Partner",
  "Director",
  "Associate Director",
  "Executive Director",

  // ── Finance & Accounting ──────────────────────────────────────────────────
  "Finance Director",
  "Senior Financial Analyst",
  "Financial Analyst",
  "Budget Analyst",
  "Cost Analyst",
  "Accountant",
  "Senior Accountant",
  "Staff Accountant",
  "Bookkeeper",
  "Accounts Payable Manager",
  "Accounts Receivable Manager",
  "Treasury Manager",
  "Tax Manager",
  "Tax Analyst",
  "Audit Manager",
  "Internal Auditor",
  "Payroll Manager",
  "Payroll Specialist",
  "Billing Specialist",

  // ── Operations & Administration ───────────────────────────────────────────
  "Operations Director",
  "Operations Coordinator",
  "Office Manager",
  "Facilities Manager",
  "Supply Chain Manager",
  "Logistics Manager",
  "Procurement Manager",
  "Procurement Specialist",
  "Contract Manager",
  "Contract Administrator",
  "Document Controller",
  "Administrative Director",
  "Administrative Manager",
  "Administrative Coordinator",
  "Executive Assistant",
  "Administrative Assistant",

  // ── Human Resources & People ──────────────────────────────────────────────
  "HR Director",
  "HR Generalist",
  "HR Coordinator",
  "Talent Acquisition Manager",
  "Recruiter",
  "Senior Recruiter",
  "Talent Manager",
  "Workforce Manager",
  "Training Manager",
  "Learning & Development Manager",
  "Benefits Manager",
  "Compensation Manager",

  // ── Project & Program Management ──────────────────────────────────────────
  "PMO Director",
  "Portfolio Manager",
  "Senior Program Manager",
  "Junior Project Manager",
  "Assistant Project Manager",
  "Project Coordinator",
  "Project Administrator",
  "Project Controls Manager",
  "Project Controls Engineer",
  "Scheduler",
  "Senior Scheduler",
  "Planner",
  "Cost Engineer",
  "Cost Manager",
  "Change Manager",

  // ── Architecture & Design ─────────────────────────────────────────────────
  "Principal Architect",
  "Senior Architect",
  "Architect",
  "Project Architect",
  "Design Architect",
  "Architectural Designer",
  "Interior Designer",
  "Senior Interior Designer",
  "Landscape Architect",
  "Urban Planner",
  "Urban Designer",
  "BIM Manager",
  "BIM Coordinator",
  "CAD Manager",
  "CAD Technician",
  "Drafter",
  "Senior Drafter",
  "Designer",
  "Senior Designer",

  // ── Engineering (General) ─────────────────────────────────────────────────
  "Principal Engineer",
  "Senior Engineer",
  "Engineer",
  "Engineer I",
  "Engineer II",
  "Engineer III",
  "Associate Engineer",
  "Lead Engineer",
  "Design Engineer",
  "Resident Engineer",
  "Field Engineer",
  "Site Engineer",
  "Staff Engineer",

  // ── Civil & Structural Engineering ───────────────────────────────────────
  "Principal Civil Engineer",
  "Senior Civil Engineer",
  "Civil Engineer",
  "Structural Engineer",
  "Senior Structural Engineer",
  "Principal Structural Engineer",
  "Transportation Engineer",
  "Geotechnical Engineer",
  "Hydraulic Engineer",
  "Environmental Engineer",
  "Senior Environmental Engineer",

  // ── MEP & Specialty Engineering ───────────────────────────────────────────
  "Mechanical Engineer",
  "Senior Mechanical Engineer",
  "Electrical Engineer",
  "Senior Electrical Engineer",
  "Plumbing Engineer",
  "MEP Engineer",
  "MEP Coordinator",
  "Commissioning Engineer",
  "Systems Engineer",
  "Controls Engineer",

  // ── Construction & Field Operations ──────────────────────────────────────
  "Construction Manager",
  "Senior Construction Manager",
  "General Superintendent",
  "Area Superintendent",
  "Site Superintendent",
  "Superintendent",
  "General Foreman",
  "Site Foreman",
  "Foreman",
  "Assistant Superintendent",

  // ── Estimating ────────────────────────────────────────────────────────────
  "Chief Estimator",
  "Senior Estimator",
  "Estimator",
  "Cost Estimator",
  "Quantity Surveyor",

  // ── Quality & Safety ──────────────────────────────────────────────────────
  "Quality Manager",
  "QA/QC Manager",
  "QA Manager",
  "QC Manager",
  "QA Inspector",
  "QC Inspector",
  "Field Inspector",
  "Special Inspector",
  "Inspector",
  "EHS Manager",
  "Safety Manager",
  "Safety Officer",
  "Health & Safety Manager",
  "Environmental Health & Safety Manager",

  // ── Environmental & Science ───────────────────────────────────────────────
  "Principal Scientist",
  "Senior Scientist",
  "Lead Scientist",
  "Scientist",
  "Environmental Scientist",
  "Environmental Manager",
  "Environmental Consultant",
  "Field Technician",
  "Senior Technician",
  "Lab Technician",
  "Geologist",
  "Senior Geologist",
  "Hydrogeologist",

  // ── IT & Technology ───────────────────────────────────────────────────────
  "IT Director",
  "IT Manager",
  "IT Coordinator",
  "Solutions Architect",
  "Systems Architect",
  "Software Engineer",
  "Senior Software Engineer",
  "Lead Software Engineer",
  "DevOps Engineer",
  "Database Administrator",
  "Network Engineer",
  "Security Engineer",
  "QA Engineer",
  "Business Analyst",
  "Senior Business Analyst",
  "Systems Analyst",
  "Technical Lead",
  "Data Analyst",
  "Data Engineer",

  // ── Marketing, BD & Sales ─────────────────────────────────────────────────
  "Business Development Director",
  "Business Development Manager",
  "Marketing Director",
  "Marketing Manager",
  "Communications Manager",
  "Proposal Manager",
  "Proposal Coordinator",
  "Client Services Manager",
  "Account Manager",
  "Account Executive",
  "Sales Manager",

  // ── Legal & Compliance ────────────────────────────────────────────────────
  "General Counsel",
  "Legal Counsel",
  "Compliance Manager",
  "Risk Manager",
  "Compliance Officer",

  // ── Consulting ────────────────────────────────────────────────────────────
  "Managing Consultant",
  "Principal Consultant",
  "Senior Consultant",
  "Consultant",
  "Associate",
  "Senior Associate",
  "Analyst",
  "Senior Analyst",
  "Technical Writer",
  "Technical Specialist",

  // ── Coordinator / Support ─────────────────────────────────────────────────
  "Coordinator",
  "Senior Coordinator",
  "Specialist",
  "Senior Specialist",
  "Manager",
  "Senior Manager",
  "Supervisor",
  "Team Lead",
  "Lead",
];

/** Append any standard titles missing from a plain name list (case-insensitive). */
export function withSuggestedTitleNames(names: string[]): string[] {
  const have = new Set(names.map((n) => n.trim().toLowerCase()));
  const extra = STANDARD_JOB_TITLES.filter((n) => !have.has(n.toLowerCase()));
  return extra.length ? [...names, ...extra] : names;
}

export interface TitleOption { id: string; name: string; label: string }

/**
 * Append any standard titles missing from an {id,name,label} option list.
 * Suggested entries use the NAME as their id — the same convention the
 * existing heuristic fallbacks use — so downstream "only persist a real
 * catalogue JobTitleId" guards keep the saved JobTitleLookup empty and the
 * title flows by name only.
 */
export function withSuggestedTitleOptions(opts: TitleOption[]): TitleOption[] {
  const have = new Set(opts.map((o) => (o.name || "").trim().toLowerCase()));
  const extra = STANDARD_JOB_TITLES.filter((n) => !have.has(n.toLowerCase()));
  // Suggested standard titles lead (client ask, Aug 2026): common picks are
  // one scroll away; the tenant's own catalogue titles follow.
  return extra.length
    ? [...extra.map((n) => ({ id: n, name: n, label: `${n} · Suggested` })), ...opts]
    : opts;
}
