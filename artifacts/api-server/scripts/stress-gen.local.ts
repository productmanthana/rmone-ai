/**
 * THROWAWAY stress-test file generator (delete after the prod load test).
 * Builds 5 Excel files, ~200,000 rows each (2,000 Staff + 10,000 Projects
 * + 188,000 Team Assignments), mimicking the largest real customer's shape
 * (~3.5x weekly-expansion ratio). Streaming writer, ISO date strings only.
 *
 * Usage: tsx scripts/stress-gen.local.ts [--out /tmp/stress]
 */
import ExcelJS from "exceljs";
import * as fs from "node:fs";
import * as path from "node:path";

const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "/tmp/stress";

export const LABELS = ["stresstest-a-0807", "stresstest-b-0807", "stresstest-c-0807", "stresstest-d-0807", "stresstest-e-0807"];
const PREFIXES = ["SA", "SB", "SC", "SD", "SE"];

const STAFF_N = 1_000;
const PROJ_N = 4_000;
const TEAM_N = 45_000;

// Deterministic PRNG so reruns produce identical files.
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Aarav", "Vivaan", "Aditya", "Diya", "Ishaan", "Kavya", "Rohan", "Ananya", "Arjun", "Meera", "Karan", "Priya", "Rahul", "Sneha", "Vikram", "Nisha", "James", "Maria", "David", "Sarah", "Michael", "Elena", "Thomas", "Laura"];
const LAST = ["Sharma", "Patel", "Reddy", "Iyer", "Khan", "Gupta", "Nair", "Singh", "Das", "Mehta", "Okafor", "Muller", "Garcia", "Smith", "Johnson", "Brown", "Silva", "Rossi", "Kim", "Chen"];
const BUS = ["Buildings", "Infrastructure", "Civil & Transit", "Energy", "Water"];
const DIVS = ["Architecture", "Engineering", "Commercial", "Interiors", "Environmental", "Program Management"];
const DEPTS = ["Design", "Structural", "MEP", "Planning", "Controls", "Field Ops"];
const ROLES = ["Project Manager", "Senior Architect", "Engineer II", "Designer", "Estimator", "Superintendent", "BIM Specialist", "Scheduler"];
const TITLES = ["Lead Architect", "Senior Engineer", "Engineer II", "Design Manager", "Project Executive", "Coordinator", "Analyst"];
const SECTORS = ["Healthcare", "Transportation", "Education", "Real Estate", "Government", "Aviation"];
const STATUSES = ["Active", "Active", "Active", "Active", "On Hold", "Complete"]; // mostly active
const CONTRACT_TYPES = ["GMP", "Lump Sum", "Cost Plus", "Fixed Fee", "T&M"];
const COMPANIES = Array.from({ length: 200 }, (_, i) => `Stress Client ${String(i + 1).padStart(3, "0")} LLC`);

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function genTenant(label: string, prefix: string, seed: number) {
  const rnd = mulberry32(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const file = path.join(OUT, `${label}.xlsx`);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: false, useSharedStrings: false });

  // ── Staff ──
  const staff = wb.addWorksheet("Staff");
  staff.addRow(["Full Name", "Login Email", "Business Unit", "Division", "Department", "Role", "Job Title", "Access Level", "Start Date"]).commit();
  const emails: string[] = [];
  for (let i = 0; i < STAFF_N; i++) {
    const fn = pick(FIRST), ln = pick(LAST);
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}.${i}@${label}.example`;
    emails.push(email);
    staff.addRow([
      `${fn} ${ln}`, email, pick(BUS), pick(DIVS), pick(DEPTS), pick(ROLES), pick(TITLES),
      i < 20 ? "admin" : i < 200 ? "manager" : "user",
      iso(new Date(2020 + Math.floor(rnd() * 5), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28))),
    ]).commit();
  }
  staff.commit();

  // ── Projects ──
  const proj = wb.addWorksheet("Projects");
  proj.addRow(["Project ID", "Company Name", "Project Title", "Market Sector", "Business Unit", "Division", "Department", "Status", "Contract Type", "Start Date", "End Date", "Contract Value"]).commit();
  const projIds: string[] = [];
  for (let i = 0; i < PROJ_N; i++) {
    const id = `${prefix}-${10001 + i}`;
    projIds.push(id);
    const s = new Date(2025, 5 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28));
    const e = new Date(s.getTime() + (90 + Math.floor(rnd() * 540)) * 86400_000);
    proj.addRow([
      id, pick(COMPANIES), `${pick(SECTORS)} ${pick(["Tower", "Campus", "Terminal", "Plant", "Bridge", "Complex", "Renovation", "Expansion"])} ${prefix}${i}`,
      pick(SECTORS), pick(BUS), pick(DIVS), pick(DEPTS), pick(STATUSES), pick(CONTRACT_TYPES),
      iso(s), iso(e), Math.round(500_000 + rnd() * 50_000_000),
    ]).commit();
  }
  proj.commit();

  // ── Team Assignments ── (~2-6 week spans → ~3.5-4x weekly RA expansion)
  const team = wb.addWorksheet("Team Assignments");
  team.addRow(["Project", "Team Member", "Start Date", "End Date", "Total Hours", "Soft Allocation", "Non Chargeable", "Is Locked"]).commit();
  for (let i = 0; i < TEAM_N; i++) {
    const weeks = 2 + Math.floor(rnd() * 5); // 2..6
    const s = new Date(2025, 6 + Math.floor(rnd() * 14), 1 + Math.floor(rnd() * 28));
    const e = new Date(s.getTime() + weeks * 7 * 86400_000 - 86400_000);
    team.addRow([
      projIds[Math.floor(rnd() * projIds.length)],
      emails[Math.floor(rnd() * emails.length)],
      iso(s), iso(e), weeks * (10 + Math.floor(rnd() * 31)), // 10-40 h/week
      rnd() < 0.05 ? "TRUE" : "", rnd() < 0.04 ? "TRUE" : "",
      i < 50 ? "TRUE" : "", // exactly 50 locked rows per tenant — must survive replace
    ]).commit();
  }
  team.commit();

  await wb.commit();
  const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
  console.log(`${label}: ${STAFF_N + PROJ_N + TEAM_N} rows → ${file} (${mb} MB)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < LABELS.length; i++) await genTenant(LABELS[i], PREFIXES[i], 1000 + i);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})();
