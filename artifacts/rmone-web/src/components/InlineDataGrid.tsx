import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { getModuleRecords, getStoredUser, authHeaders, getUserList } from "@/lib/api";
import { fetchAccessLevels, createCustomAccessLevels, usePermissionsVersion, fetchUserGroups, saveUserGroups, type UserGroup } from "@/lib/permissions";
// xlsx is ~1 MB minified — loaded on demand so it stays OUT of the app's
// startup bundle (it was one of the biggest contributors to the boot splash
// time). processFile awaits the load; exportXlsx runs only after a file has
// been parsed, so the module is always cached by the time it's needed.
type XlsxMod = typeof import("xlsx");
let _xlsxMod: XlsxMod | null = null;
async function loadXlsx(): Promise<XlsxMod> {
  if (!_xlsxMod) _xlsxMod = await import("xlsx");
  return _xlsxMod;
}
function getXlsxSync(): XlsxMod {
  if (!_xlsxMod) throw new Error("Excel engine still loading — please retry in a moment.");
  return _xlsxMod;
}
import {
  Upload, ArrowRight, FileSpreadsheet, ChevronLeft,
  Plus, GripVertical, ChevronDown, CheckCircle2,
  Download, AlertTriangle, X, Trash2, Search, Copy, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportWizardOverlay, type WizardStepDef } from "@/components/ImportWizardOverlay";
import ImportGridPeek, { type GridPeekState } from "@/components/ImportGridPeek";
import ImportRunPanel from "@/components/ImportRunPanel";
import { Table2 as PeekTableIcon } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { getCachedCleanedFile, putCachedCleanedFile, deleteCachedCleanedFile } from "@/lib/cleanedFileCache";
import { uploadFileSmart } from "@/lib/chunkedUpload";
import { buildGridColumnMappings } from "@/lib/importServerFields";
import ImportReviewGrid, { type SheetData } from "@/components/ImportReviewGrid";
import GroupAccessLevelPopup, { type GroupAclGroup } from "@/components/GroupAccessLevelPopup";
import DateField from "@/components/DateField";
import {
  type ColDef, type TabDef, type Row, type DbRefCheck,
  REQUIRED_ID_BY_TAB, REQUIRED_ID_BY_CARD, requiredIdFor,
  filterOrphanRows, isPlausibleDateString, normalizeDateInput, STATUS_OPTS, PERCENT_KEYS,
  validateCell, scanAllIssues, canonicalizeOpt, normalizeTicketRef, isCreatableLevelValue,
} from "@/lib/importValidation";
import { Z } from "@/lib/zLayers";
import { ImportGateLatches } from "@/lib/importGateLatches";
import {
  mergeGroupMembers, resolveRecordGroupTokens, cleanGroupCellValue,
  buildUserNameMap, buildNewGroups,
} from "@/lib/importGroupMerge";
export type { ColDef } from "@/lib/importValidation";

// Canonicalize a cell value for hard-validated fixed-option columns
// ("Full Time" → "Full-Time", "part time" → "Part-Time"). Free-text,
// status and softOpts columns pass through verbatim, as do values that
// don't loosely match any allowed option (they keep their red highlight).
const isTrueFalseCol = (col: ColDef): boolean =>
  col.opts?.length === 2 && col.opts[0] === "TRUE" && col.opts[1] === "FALSE";

// Spreadsheet-style booleans → TRUE/FALSE ("1", "yes", "y", "x" → TRUE;
// "0", "no", "n" → FALSE). Blank/unrecognized returns null (left verbatim).
const boolishToTrueFalse = (raw: string): string | null => {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (["true", "t", "1", "yes", "y", "x", "✓", "checked"].includes(s)) return "TRUE";
  if (["false", "f", "0", "no", "n", "unchecked"].includes(s)) return "FALSE";
  return null;
};

const canonCellValue = (col: ColDef | undefined, val: string): string => {
  if (!col || col.type !== "select" || col.softOpts || !col.opts?.length) return val;
  const hit = canonicalizeOpt(col.opts, val);
  if (hit != null) return hit;
  // TRUE/FALSE columns additionally accept 1/0 and yes/no variants so pasted
  // exports land clean; anything unrecognized stays verbatim for review.
  if (isTrueFalseCol(col)) {
    const b = boolishToTrueFalse(val);
    if (b != null) return b;
  }
  return val;
};

// Grid rows saved for "resume where I left off" must be scoped by tenant —
// cardId alone ("projects", "opportunities", "team", …) is the SAME key
// across every company, so without the tenant prefix one company's uploaded
// staff/project rows would silently reappear when a different tenant (even a
// brand-new one) is opened in the same browser. bustCache() on login/logout
// does NOT touch this key (different prefix), so scoping is the real fix.
function gridStorageKey(cardId: string): string {
  const tenant = getStoredUser()?.tenant || "anon";
  // v2: the pre-v2 key accumulated auto-saved demo/sample drafts that kept
  // resurrecting as real-looking rows on every visit. Bumping the version
  // orphans those stale drafts so a fresh grid always starts with just the
  // ghost example rows + blank rows.
  return `rmone-grid-v2-${tenant}-${cardId}`;
}

/** Pre-v2 draft key — removed on grid init so stale demo drafts can't linger. */
function legacyGridStorageKey(cardId: string): string {
  const tenant = getStoredUser()?.tenant || "anon";
  return `rmone-grid-${tenant}-${cardId}`;
}

// ── Held-row decision persistence ────────────────────────────────────────
// Decisions made in the review view (IDs typed or picked, rows added to the
// import, duplicate cards dismissed) survive a page refresh: the cleaned
// workbook is re-downloaded by its cleaning sessionId and the saved decisions
// are replayed onto the freshly-parsed held rows. Only the DECISIONS are
// stored (tiny patches keyed by source row) — never the rows themselves,
// since review sheets can hold 10k+ rows.
export interface HeldDecision {
  edits?: Record<string, string>;
  status?: "added" | "dismissed";
  /** Name-clash "keep only this one": project IDs removed from the main grid. */
  removeIds?: string[];
  /** The winning ID the removed IDs merged into — child tabs (Team
      Assignments / Schedule) re-point their rows at it, including when the
      verdict is replayed after a page refresh. */
  keepId?: string;
  /** Name-clash "keep both" chosen, but the family of held assignment/schedule
      rows naming this project still needs its one-per-family project pick. */
  assignPending?: boolean;
  /** Row joined the import automatically when a name clash was settled with
      "Keep selected ID" — listed read-only on its tab so the user can see
      exactly what was added for them. */
  auto?: boolean;
}
export type HeldDecisions = Record<string, HeldDecision>;
interface HeldStore {
  sessionId: string;
  fileName?: string;
  /** Superadmin data-cleaning handoff for another tenant (rides ?tenantId=). */
  tenantOverride?: string | null;
  summary?: { fixed: number; dupes: number; review: number };
  decisions: HeldDecisions;
}
function heldStoreKey(cardId: string): string {
  const tenant = getStoredUser()?.tenant || "anon";
  return `rmone-heldrows-v1-${tenant}-${cardId}`;
}
function loadHeldStore(cardId: string): HeldStore | null {
  try {
    const raw = localStorage.getItem(heldStoreKey(cardId));
    if (!raw) return null;
    const s = JSON.parse(raw) as HeldStore;
    return s && typeof s.sessionId === "string" && s.decisions && typeof s.decisions === "object" ? s : null;
  } catch { return null; }
}
function saveHeldStore(cardId: string, store: HeldStore): void {
  try { localStorage.setItem(heldStoreKey(cardId), JSON.stringify(store)); } catch { /* ignore */ }
}
function clearHeldStore(cardId: string): void {
  try { localStorage.removeItem(heldStoreKey(cardId)); } catch { /* ignore */ }
}

// ── Upload progress overlay ───────────────────────────────────────────────────
// Shows as a popup when the user clicks "Upload X rows" and the submit is
// in-flight (before the backend responds and transitions to the terminal view).
const UPLOAD_STEPS = [
  "Preparing data…",
  "Validating rows…",
  "Moving to database…",
];

function UploadingCard({ rowCount, label = "Uploading your data" }: { rowCount: number; label?: string }) {
  const [stepIdx, setStepIdx] = useState(0);
  // Follow the app-wide theme: the popup was originally styled for dark mode
  // only, which looked jarring on light-mode pages — swap the palette instead
  // of hardcoding the dark one.
  const { mode } = useTheme();
  const light = mode === "light";

  useEffect(() => {
    // Advance through the steps once and hold on the last one — cycling back
    // to "Preparing data…" after "Moving to database…" reads as a restart.
    const t = setInterval(() => setStepIdx(i => Math.min(i + 1, UPLOAD_STEPS.length - 1)), 1400);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      background: light ? "#ffffff" : "#0f1117",
      border: "1px solid rgba(99,102,241,0.35)",
      borderRadius: 18,
      padding: "32px 36px",
      width: 400, maxWidth: "100%", margin: "0 auto",
      boxShadow: light
        ? "0 24px 80px rgba(15,23,42,0.25), 0 0 0 1px rgba(99,102,241,0.12)"
        : "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.2)",
      display: "flex", flexDirection: "column", gap: 20,
    }}>
      <style>{`
        @keyframes idg-shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes idg-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            width: 18, height: 18, borderRadius: "50%",
            border: "2px solid #6366f1",
            borderTopColor: "transparent",
            display: "inline-block",
            animation: "idg-spin 0.75s linear infinite",
            flexShrink: 0,
          }} />
          <div>
            <div style={{ color: light ? "#1d2733" : "#e2e8f0", fontWeight: 700, fontSize: 15, letterSpacing: 0.1 }}>
              {label}
            </div>
            <div style={{ color: light ? "#4f46e5" : "#6366f1", fontSize: 11.5, marginTop: 1 }}>
              {rowCount} row{rowCount !== 1 ? "s" : ""} · processing in background
            </div>
          </div>
        </div>

        {/* Animated progress bar */}
        <div style={{
          height: 8, borderRadius: 99,
          background: light ? "rgba(15,23,42,0.08)" : "rgba(255,255,255,0.08)",
          overflow: "hidden", position: "relative",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(90deg, transparent 0%, #6366f1 40%, #818cf8 60%, transparent 100%)",
            animation: "idg-shimmer 1.4s ease-in-out infinite",
          }} />
        </div>

        {/* Step messages */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {UPLOAD_STEPS.map((step, i) => (
            <div key={step} style={{
              display: "flex", alignItems: "center", gap: 9,
              opacity: i <= stepIdx ? 1 : 0.3,
              transition: "opacity 0.4s",
            }}>
              <span style={{
                width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: i < stepIdx ? "#22c55e" : i === stepIdx ? "#6366f1" : light ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.12)",
                fontSize: 8, color: "#fff", fontWeight: 900,
              }}>
                {i < stepIdx ? "✓" : i === stepIdx ? "›" : ""}
              </span>
              <span style={{
                fontSize: 11.5,
                color: i < stepIdx
                  ? (light ? "#16a34a" : "#86efac")
                  : i === stepIdx
                    ? (light ? "#4f46e5" : "#c7d2fe")
                    : (light ? "#94a3b8" : "#4b5563"),
                fontWeight: i === stepIdx ? 600 : 400,
              }}>{step}</span>
            </div>
          ))}
        </div>

        <div style={{
          fontSize: 10.5, color: light ? "#64748b" : "#4b5563", textAlign: "center",
          borderTop: light ? "1px solid rgba(15,23,42,0.10)" : "1px solid rgba(255,255,255,0.07)",
          paddingTop: 14,
        }}>
          process running in background · safe to close · check status at /onboarding/history
        </div>
      </div>
  );
}

// ── Column definitions — match template exactly ───────────────────────────

const PROJECT_COLS: ColDef[] = [
  { key:"projectId",             label:"Project ID",              w:130 },
  { key:"projectTitle",          label:"Project Title",           w:220 },
  { key:"companyName",           label:"Company Name",            w:170 },
  { key:"companyId",             label:"Company ID",              w:130 },
  { key:"ownerName",             label:"Contact Name",            w:150, opts:["Project Manager","Project Executive","Principal","Program Manager","Lead Superintendent","Lead Estimator","Lead Architect","Director","Project Lead","Owner's Rep"] },
  { key:"ownersRep",             label:"Owner's Rep",             w:150 },
  { key:"businessLead",          label:"Business Lead",           w:160 },
  { key:"projectManager",        label:"Project Manager",         w:160 },
  { key:"srProjectManager",      label:"Sr Project Manager",      w:170 },
  { key:"shortName",             label:"Short Name",              w:130 },
  { key:"marketSector",          label:"Market Sector",           w:140, opts:["Transportation","Healthcare","Government","Real Estate","Technology","Education","Commercial","Industrial","Residential","Energy","Aviation","Utilities","Water/Wastewater"] },
  { key:"projectType",           label:"Project Type",            w:140, opts:["New Construction","Renovation","Design-Build","Reconstruction","Rehabilitation","Addition","Retrofit","Interior Fit-Out"] },
  { key:"serviceType",           label:"Service Type",            w:140, opts:["Architecture","Engineering","Construction Management","General Contracting","Program Management","Inspection","Owner's Representative","Design-Build"] },
  { key:"category",              label:"Category",                w:120, opts:["Active","Inactive","On Hold","Complete","Closed","Prospect"] },
  { key:"businessUnit",          label:"Business Unit",           w:150 },
  { key:"division",              label:"Division",                w:130 },
  { key:"department",            label:"Department",              w:130 },
  { key:"status",                label:"Status",                  w:110, type:"status" },
  { key:"startDate",             label:"Target Start Date",       w:135, type:"date" },
  { key:"endDate",               label:"Target End Date",         w:130, type:"date" },
  { key:"closeoutDate",          label:"Closeout Date",           w:120, type:"date" },
  // Blank cells auto-fill with today's date at import time (server-side).
  { key:"createdOn",             label:"Created On",              w:130, type:"date" },
  { key:"contractValue",         label:"Contract Value",          w:130, type:"currency" },
  { key:"laborBudget",           label:"Labor Budget",            w:120, type:"currency" },
  { key:"grossMargin",           label:"Gross Margin",            w:120, type:"currency" },
  { key:"contractType",          label:"Contract Type",           w:120, opts:["Lump Sum","Cost Plus","GMP","Unit Price","Time & Materials","Fixed Fee","IDIQ"] },
  { key:"contractedAmount",      label:"Contracted Amount",       w:150, type:"currency" },
  { key:"proposalAmount",        label:"Proposal Amount",         w:140, type:"currency" },
  { key:"bidAmount",             label:"Bid Amount",              w:120, type:"currency" },
  { key:"changeOrders",          label:"Change Orders",           w:130, type:"currency" },
  { key:"approvedChangeOrders",  label:"Approved Change Orders",  w:180, type:"currency" },
  { key:"retainage",             label:"Retainage",               w:110, type:"currency" },
  { key:"feePct",                label:"Fee %",                   w:80,  type:"number" },
  { key:"contingency",           label:"Contingency",             w:120, type:"currency" },
  { key:"nonOperatingCost",      label:"Non-Operating Cost",      w:150, type:"currency" },
  { key:"totalProjectCost",      label:"Total Project Cost",      w:150, type:"currency" },
  { key:"pctComplete",           label:"% Complete",              w:100, type:"number" },
  { key:"priority",              label:"Priority",                w:100, opts:["Low","Medium","High","Critical"] },
  { key:"nextMilestone",         label:"Next Milestone",          w:160 },
  { key:"nextMilestoneDate",     label:"Next Milestone Date",     w:160, type:"date" },
  { key:"description",           label:"Description",             w:200 },
  { key:"notes",                 label:"Notes",                   w:220 },
  { key:"streetAddress",         label:"Street Address",          w:180 },
  { key:"city",                  label:"City",                    w:120 },
  { key:"state",                 label:"State",                   w:80,  opts:["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"], softOpts: true },
  { key:"office",                label:"Office",                  w:140 },
  { key:"linkedOpp",             label:"From Opportunity",        w:200,  type:"select" },
  { key:"bidDueDate",            label:"Bid Due Date",            w:130, type:"date" },
  { key:"retainagePct",          label:"Retainage Percent",       w:130, type:"number" },
  { key:"actualProjectCost",     label:"Actual Project Cost",     w:160, type:"currency" },
  { key:"forecastedProjectCost", label:"Forecasted Project Cost", w:180, type:"currency" },
  // Client "Action User(s)" columns land here — cells like "PMO; Mitch Spencer"
  // keep only the group tokens (person names are covered by assignments).
  { key:"projGroups",            label:"Groups",                  w:180 },
];

const SCHEDULE_COLS: ColDef[] = [
  { key:"sch_projectId",   label:"Project / Opp ID", w:140 },
  { key:"sch_project",     label:"Project Title",   w:220 },
  { key:"sch_phaseName",   label:"Phase Name",      w:180 },
  { key:"sch_phaseOrder",  label:"Phase Order",     w:100, type:"number" },
  { key:"sch_startDate",   label:"Start Date",      w:110, type:"date"   },
  { key:"sch_endDate",     label:"End Date",        w:110, type:"date"   },
  { key:"sch_duration",    label:"Duration (days)", w:130, type:"number" },
  { key:"sch_milestone",   label:"Milestone",       w:180, opts:["Yes","No"] },
  { key:"sch_pctComplete", label:"% Complete",      w:100, type:"number" },
  { key:"sch_notes",       label:"Notes",           w:220 },
];

// Staff / Team roster template — used when cardId === "team"
// Name and Email lead; Business Unit, Division, Dept follow; then role info.
const STAFF_COLS: ColDef[] = [
  { key:"st_name",         label:"Full Name",      w:180 },
  { key:"st_email",        label:"Login Email",    w:210 },
  { key:"st_phone",        label:"Phone Number",   w:140 },
  { key:"st_businessUnit", label:"Business Unit",  w:160 },
  { key:"st_division",     label:"Division",       w:140 },
  { key:"st_department",   label:"Department",     w:140 },
  { key:"st_role",         label:"Role",           w:160, opts:["Project Lead","Project Manager","Principal","Program Manager","Lead Superintendent","Lead Estimator","Architect","Engineer","Project Engineer","Inspector","Foreman","Coordinator","Director"] },
  { key:"st_jobTitle",     label:"Job Title",      w:160 },
  { key:"st_manager",      label:"Manager",        w:210 },
  { key:"st_accessLevel",  label:"Access Level",   w:120, type:"select", opts:["Admin","Manager","User"] },
  { key:"st_startDate",    label:"Start Date",     w:110, type:"date" },
  { key:"st_endDate",      label:"End Date",       w:110, type:"date" },
  { key:"st_created",      label:"Created On",     w:130, type:"date" },
  { key:"st_employeeType", label:"Employee Type",  w:160, type:"select", opts:["Full-Time","Part-Time","As Needed","Temporary","SCA Contingency Staff"] },
  { key:"st_employeeId",   label:"Employee ID",    w:130 },
  { key:"st_skills",       label:"Skills",         w:200 },
  { key:"st_expTags",      label:"Experience Tags",w:200 },
  { key:"st_groups",       label:"Groups",         w:200 },
];

const ASG_COLS: ColDef[] = [
  { key:"asg_projectId",    label:"Project / Opp ID", w:140 },
  { key:"asg_project",      label:"Project",          w:220 },
  { key:"asg_name",         label:"Name",             w:160 },
  { key:"asg_email",        label:"Email",            w:190 },
  { key:"asg_employeeId",   label:"Employee ID",      w:120 },
  { key:"asg_startDate",    label:"Start Date",       w:110, type:"date" },
  { key:"asg_endDate",      label:"End Date",         w:110, type:"date" },
  { key:"asg_totalHours",   label:"Total Hours",      w:110, type:"number" },
  { key:"asg_pctAlloc",     label:"Allocation %",     w:120, type:"number" },
  { key:"asg_type",         label:"Type",             w:100, opts:["Staff","Subcontractor","Consultant","Client Contact","Vendor"] },
  { key:"asg_role",         label:"Role",             w:140, opts:["Project Lead","Project Manager","Principal","Program Manager","Lead Superintendent","Lead Estimator","Architect","Engineer","Project Engineer","Inspector","Foreman","Coordinator"] },
  { key:"asg_jobTitle",     label:"Job Title",        w:150 },
  { key:"asg_businessUnit", label:"Business Unit",    w:150 },
  { key:"asg_division",     label:"Division",         w:130 },
  { key:"asg_department",   label:"Department",       w:130 },
  { key:"asg_billingRate",  label:"Billing Rate",     w:110, type:"currency" },
  { key:"asg_laborRate",    label:"Labor Rate",       w:110, type:"currency" },
  { key:"asg_costRate",     label:"Cost Rate",        w:110, type:"currency" },
  { key:"asg_billedHours",  label:"Billed Hours",     w:110, type:"number" },
  // Allocation flags — TRUE/FALSE selects; paste/typing tolerates 1/0, yes/no,
  // y/n (canonCellValue maps them to TRUE/FALSE at ingest).
  { key:"asg_softAlloc",     label:"Soft Allocation", w:130, type:"select", opts:["TRUE","FALSE"] },
  { key:"asg_nonChargeable", label:"Non Chargeable",  w:130, type:"select", opts:["TRUE","FALSE"] },
  { key:"asg_isLocked",      label:"Is Locked",       w:110, type:"select", opts:["TRUE","FALSE"] },
  { key:"asg_accessLevel",  label:"Access Level",     w:120, type:"select", opts:["Admin","Manager","User"] },
];

const OPP_COLS: ColDef[] = [
  { key:"opp_erpJob",       label:"Opportunity ID",          w:140 },
  { key:"opp_title",        label:"Opportunity Title",       w:220 },
  { key:"opp_category",     label:"Project Category",        w:200, opts:["Service Projects (CNS)","Construction Projects (CPR)"] },
  { key:"opp_company",      label:"Company Name",            w:170 },
  { key:"opp_companyId",    label:"Company ID",              w:130 },
  { key:"opp_contact",      label:"Contact Name",            w:150 },
  { key:"opp_businessLead", label:"Business Lead",           w:160 },
  { key:"opp_projectManager", label:"Project Manager",       w:160 },
  { key:"opp_srProjectManager", label:"Sr Project Manager",  w:170 },
  { key:"opp_stage",        label:"Stage",                   w:140, opts:["Prospecting","Qualifying","Proposal","Negotiation","Awarded","Lost"] },
  { key:"opp_chance",       label:"Chance of Success",       w:150 }, // free text — tenants use values like "(4) More Than 80%"
  { key:"opp_pctComplete",  label:"% Complete",              w:100, type:"number" },
  { key:"opp_sector",       label:"Market Sector",           w:140, opts:["Transportation","Healthcare","Government","Real Estate","Technology","Education","Commercial","Industrial","Residential","Energy","Aviation","Utilities","Water/Wastewater"] },
  { key:"opp_bu",           label:"Business Unit",           w:150 },
  { key:"opp_division",     label:"Division",                w:130 },
  { key:"opp_dept",         label:"Department",              w:130 },
  { key:"opp_targetStart",  label:"Target Start",            w:130, type:"date" },
  { key:"opp_targetEnd",    label:"Target End",              w:120, type:"date" },
  { key:"opp_awardDate",    label:"Award / Loss Date",       w:140, type:"date" },
  // Blank cells auto-fill with today's date at import time (server-side).
  { key:"opp_createdOn",    label:"Created On",              w:130, type:"date" },
  { key:"opp_approxValue",  label:"Approx Contract Value",   w:170, type:"currency" },
  { key:"opp_costEst",      label:"Forecasted Project Cost", w:190, type:"currency" },
  { key:"opp_laborAmt",     label:"Labor Contract Amount",   w:170, type:"currency" },
  { key:"opp_nonOpCost",    label:"Non-Operating Cost",      w:170, type:"currency" },
  { key:"opp_margin",       label:"Gross Margin",            w:120, type:"number" },
  { key:"opp_contractType", label:"Contract Type",           w:130, opts:["Fixed","T&M","GMP","Cost-Plus"] },
  { key:"opp_description",  label:"Description",             w:200 },
  { key:"opp_notes",        label:"Notes",                   w:220 },
  { key:"opp_poc",          label:"Point of Contact",        w:160 },
  { key:"opp_status",       label:"Status",                  w:100, opts:["Active","On Hold","Closed"] },
  { key:"opp_office",       label:"Office",                  w:140 },
  // Client "Action User(s)" columns land here — see projGroups above.
  { key:"opp_groups",       label:"Groups",                  w:180 },
  { key:"opp_accessLevel",  label:"Access Level",            w:120, type:"select", opts:["Admin","Manager","User"] },
];

// ── Access-level opts: built-ins + tenant custom levels ─────────────────────
// The Access Level selects are hardcoded to the built-ins above; admin-defined
// custom levels (Settings → Access Levels) are merged in at runtime by name.
// Mutating the shared ColDefs keeps every consumer in lockstep (cell selects,
// validateCell, the select auto-canonicalizer, and downloadCardTemplate).
const BUILTIN_ACCESS_LEVELS = ["Admin", "Manager", "User"];
const ACCESS_LEVEL_COL_KEYS = new Set(["st_accessLevel", "asg_accessLevel", "opp_accessLevel"]);
/** Returns true when the option lists actually changed (drives a re-render). */
function applyCustomAccessLevelOpts(customNames: string[]): boolean {
  const extras = customNames.filter(n => !BUILTIN_ACCESS_LEVELS.some(b => b.toLowerCase() === n.toLowerCase()));
  const opts = [...BUILTIN_ACCESS_LEVELS, ...extras];
  let changed = false;
  for (const cols of [STAFF_COLS, ASG_COLS, OPP_COLS]) {
    for (const c of cols) {
      if (!ACCESS_LEVEL_COL_KEYS.has(c.key)) continue;
      if ((c.opts ?? []).join("\u0000") !== opts.join("\u0000")) { c.opts = opts; changed = true; }
    }
  }
  return changed;
}

const LEADS_COLS: ColDef[] = [
  { key:"ld_id",        label:"Lead ID",              w:130 },
  { key:"ld_name",      label:"Lead Name",            w:220 },
  { key:"ld_company",   label:"Company Name",          w:170 },
  { key:"ld_companyId", label:"Company ID",            w:130 },
  { key:"ld_contact",   label:"Contact Name",          w:150 },
  { key:"ld_stage",     label:"Stage",                 w:140, opts:["Prospecting","Qualifying","Proposal","Negotiation"] },
  { key:"ld_status",    label:"Status",                w:100, opts:["Active","On Hold"] },
  { key:"ld_sector",    label:"Market Sector",         w:140, opts:["Transportation","Healthcare","Government","Real Estate","Technology","Education","Commercial","Industrial","Residential","Energy","Aviation","Utilities","Water/Wastewater"] },
  { key:"ld_category",  label:"Project Category",      w:200, opts:["Service Projects (CNS)","Construction Projects (CPR)"] },
  { key:"ld_bu",        label:"Business Unit",         w:150 },
  { key:"ld_division",  label:"Division",              w:130 },
  { key:"ld_dept",      label:"Department",            w:130 },
  { key:"ld_office",    label:"Office",                w:130 },
  { key:"ld_address",   label:"Address",               w:200 },
  { key:"ld_city",      label:"City",                  w:120 },
  { key:"ld_state",     label:"State",                 w:80  },
  { key:"ld_targetStart", label:"Target Start",        w:130, type:"date" },
  { key:"ld_targetEnd",   label:"Target End",          w:120, type:"date" },
  { key:"ld_value",     label:"Est. Contract Value",   w:160, type:"currency" },
  { key:"ld_createdOn", label:"Created On",            w:130, type:"date" },
  { key:"ld_desc",      label:"Description",           w:200 },
  { key:"ld_note",      label:"Notes",                 w:200 },
];

const COMPANY_BIZ_TYPES = ["General Contractor","Subcontractor","Architect","Engineer","Owner / Developer","Construction Manager","Consultant","Supplier / Vendor","Government Agency","Other"];
const COMPANIES_COLS: ColDef[] = [
  { key:"co_name",     label:"Company Name",   w:200 },
  { key:"co_companyId", label:"Company ID",    w:130 },
  { key:"co_short",    label:"Abbreviated Name", w:150 },
  { key:"co_reltype",  label:"Relationship Type", w:150, opts:["Client","Prospect","Partner","Vendor","Subcontractor","Consultant","Competitor","Other"] },
  { key:"co_biztype",  label:"Business Type",  w:170, opts:COMPANY_BIZ_TYPES },
  { key:"co_secbiz",   label:"Secondary Business Type", w:190, opts:COMPANY_BIZ_TYPES },
  { key:"co_sector",   label:"Industry",       w:150, opts:["Real Estate","Infrastructure","Government","Commercial","Healthcare","Transportation","Technology","Education"] },
  { key:"co_health",   label:"CRM Health",     w:120, opts:["Good","At Risk","Poor"] },
  { key:"co_contact",  label:"Contact Name",   w:160 },
  { key:"co_email",    label:"Contact Email",  w:200 },
  { key:"co_title",    label:"Contact Title",  w:170 },
  { key:"co_phone",    label:"Phone",          w:140 },
  { key:"co_fax",      label:"Fax",            w:130 },
  { key:"co_address",  label:"Address",        w:200 },
  { key:"co_street2",  label:"Street 2",       w:150 },
  { key:"co_city",     label:"City",           w:120 },
  { key:"co_state",    label:"State",          w:80  },
  { key:"co_zip",      label:"Zip",            w:90  },
  { key:"co_assigned", label:"Assigned To",    w:160 },
  { key:"co_rep",      label:"Client Rep",     w:170 },
  { key:"co_division", label:"Division",       w:130 },
  { key:"co_desc",     label:"Description",    w:220 },
  { key:"co_created",  label:"Created On",     w:130, type:"date" },
];

// ── Tab definitions per card ──────────────────────────────────────────────

function getTabsForCard(cardId: string, multiTab: boolean): TabDef[] {
  // Standalone Team Assignments / Schedule cards: ONE tab whose id matches
  // the dynamic assignment/schedule tabs ("assignments"/"schedule") so
  // mandatory-ID enforcement, sample rows, synonym matching and sheet-name
  // routing all work unchanged. Rows here reference EXISTING Projects
  // (PMM-…) or Opportunities (OPM-…) by ID — the backend resolves either
  // prefix on the same sheet, so one upload can mix both.
  if (cardId === "assignments") return [
    { id: "assignments", label: "Team Assignments", cols: ASG_COLS, sheetName: "Team Assignments" },
  ];
  if (cardId === "schedule") return [
    { id: "schedule", label: "Schedule", cols: SCHEDULE_COLS, sheetName: "Schedule" },
  ];
  const mainLabel = cardId === "opportunities" ? "Opportunities"
    : cardId === "leads" ? "Leads"
    : cardId === "team" ? "Staff / Team"
    : cardId === "companies" ? "Companies"
    : "Projects";
  const mainSheet = cardId === "opportunities" ? "Opportunities"
    : cardId === "leads" ? "Leads"
    : cardId === "team" ? "Staff"
    : cardId === "companies" ? "Companies"
    : "Projects";
  const mainCols = cardId === "team" ? STAFF_COLS
    : cardId === "opportunities" ? OPP_COLS
    : cardId === "leads" ? LEADS_COLS
    : cardId === "companies" ? COMPANIES_COLS
    : PROJECT_COLS;
  const mainTab: TabDef = { id: "main", label: mainLabel, cols: mainCols, sheetName: mainSheet };
  if (multiTab) return [
    mainTab,
    { id: "assignments", label: "Team Assignments", cols: ASG_COLS, sheetName: "Team Assignments" },
    { id: "schedule",    label: "Schedule",         cols: SCHEDULE_COLS, sheetName: "Schedule" },
  ];
  return [mainTab];
}

// Mandatory-ID / duplicate / orphan / per-cell validators moved to
// @/lib/importValidation.ts (shared with ImportReviewGrid).

// Main-tab title columns — used by the name-clash UI to label duplicate-title
// groups (the old duplicate-title upload BLOCK itself is gone; exact-duplicate
// and ID checks now run through the validation review grid).
const TITLE_COL_BY_CARD: Record<string, { key: string; label: string }> = {
  projects:      { key: "projectTitle", label: "Project Title" },
  opportunities: { key: "opp_title",    label: "Opportunity Title" },
  leads:         { key: "ld_name",      label: "Lead Name" },
};

/** Download a template XLSX for any card.
 *  Templates ALWAYS contain the 2 built-in example rows per tab (plus blank
 *  entry rows) — never live/previously-imported data. The example rows show
 *  the expected format and are stripped again if re-uploaded unchanged. */
export async function downloadCardTemplate(
  cardId: string,
  multiTab: boolean,
  _existingRows?: Record<string, Record<string, string>[]>,
): Promise<void> {
  const tabs = getTabsForCard(cardId, multiTab);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "RM ONE";
  wb.created = new Date();
  const ALT = "FFF5F6FF";

  for (const tab of tabs) {
    const ws = wb.addWorksheet(tab.sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
    tab.cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.round(c.w / 7); });

    const headerRow = ws.addRow(tab.cols.map(c => c.label));
    headerRow.height = 22;
    headerRow.eachCell(cell => {
      cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
      cell.border    = { bottom: { style: "thin", color: { argb: "FF3730A3" } } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });

    // Built-in example rows — templates always ship the same 2 rows per tab.
    const sampleRows = sampleRowsFor(cardId, tab.id);

    sampleRows.forEach((rowData, idx) => {
      const row = ws.addRow(tab.cols.map(c => rowData[c.key] ?? ""));
      row.height = 18;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : ALT } };
        cell.font      = { size: 10 };
        cell.alignment = { vertical: "middle" };
        cell.border    = { bottom: { style: "hair", color: { argb: "FFE5E7EB" } } };
      });
    });
    // A few blank rows at the bottom so the user can add new entries
    for (let i = 0; i < 5; i++) {
      const row = ws.addRow(tab.cols.map(() => ""));
      row.height = 18;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = { bottom: { style: "hair", color: { argb: "FFE5E7EB" } } };
      });
    }

    // Data validation: hard dropdowns for select/status columns, soft
    // suggestion lists for free-text opts columns, numeric/percent guards
    // for number & currency columns (shared with the in-grid builder).
    applyListAndNumberValidation(ws, tab.cols, 201);

    // Date validation on every "date" column — hard stop (errorStyle:"error")
    // so free text is rejected while editing the downloaded template, same
    // guard as the in-app grid further down in this file. Note: the calendar-
    // picker icon itself only ever appears in Windows desktop Excel — Excel
    // Online/Mac/mobile never show it even with this validation present.
    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    tab.cols.forEach((c, colIdx) => {
      if (c.type !== "date") return;
      const letter = ws.getColumn(colIdx + 1).letter;
      for (let r = 2; r <= 201; r++) {
        const cell = ws.getCell(`${letter}${r}`);
        if (typeof cell.value === "string" && ISO_DATE_RE.test(cell.value.trim())) {
          const [y, m, d] = cell.value.trim().split("-").map(Number);
          cell.value = new Date(y, m - 1, d);
        }
        cell.numFmt = "yyyy-mm-dd";
        cell.dataValidation = {
          type: "date",
          operator: "between",
          formulae: [new Date(1990, 0, 1), new Date(2100, 0, 1)],
          allowBlank: true,
          showErrorMessage: true,
          errorStyle: "error",
          errorTitle: "Not a valid date",
          error: "Please enter a real date (e.g. 2025-01-31). Text is not allowed in this column.",
          showInputMessage: true,
          promptTitle: "Date required",
          prompt: "Enter a date, e.g. 2025-01-31.",
        };
      }
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const a = document.createElement("a");
  a.href = url; a.download = `${cardId}_template.xlsx`; a.click();
  URL.revokeObjectURL(url);
}

// ── Synonym matching ──────────────────────────────────────────────────────
const SKIP = "__skip__";
const SYNONYMS: Record<string, string[]> = {
  // PROJECT_COLS
  type:                  ["type","record type"],
  companyName:           ["company name","company","client","client name","organization","firm","customer","account"],
  ownerName:             ["owner name","owner","client rep","client contact","client manager","point of contact","poc","contact person","contact","main contact","primary contact","key contact","project contact","project lead","project leads","proj lead","lead","project leader","team lead","lead contact","lead person"],
  ownersRep:             ["owner's rep","owner's representative","owners rep","owners representative","owner rep representative","external owner rep","ownerrep","ownersrep"],
  businessLead:          ["business lead","business unit lead","bu lead","biz lead","business leader","unit lead"],
  projectManager:        ["project manager","pm","project mgr","proj manager","proj mgr","manager"],
  srProjectManager:      ["sr project manager","senior project manager","sr. project manager","sr pm","senior pm"],
  createdOn:             ["created on","created date","date created","creation date","created","created at"],
  projGroups:            ["groups","action user","action users","user groups","user group","group membership","security groups","access groups"],
  projectTitle:          ["project title","project name","name","title","project","job name","opportunity title","lead name","opportunity name"],
  projectId:             ["project id","project #","job id","job #","job number","project number","erp job id","project no","project num","proj id","proj no","proj #","project identifier","pmm id","record id","ticket id","erp job #","erp job","erp id","job no","id number","rmone id","rm one id","rmone #","rmone number","rmone project id"],
  shortName:             ["short name","short","abbreviation","code","project code","nickname","alias"],
  marketSector:          ["market sector","sector","industry","vertical","market","market type"],
  projectType:           ["project type","type of project","project category"],
  serviceType:           ["service type","delivery method","contract method","procurement","service"],
  category:              ["category","cat","sub-category"],
  businessUnit:          ["business unit","bu","practice group","primary bu","primary business unit","business unit name","bu name"],
  division:              ["division","div","practice area","business line","group"],
  department:            ["department","dept","team","sub-group"],
  status:                ["status","project status","record status","overall status","phase","project phase","current phase","phase status","work status","current status"],
  startDate:             ["target start date","start date","start","begin date","commencement","from","project start","planned start","target start","kickoff date","kick off date","kickoff","plan start","plan start date"],
  endDate:               ["target end date","end date","end","finish date","completion date","due date","target end","to","project end","planned end","target completion","target completion date","plan close","plan end","plan close date","plan end date","planned close"],
  closeoutDate:          ["closeout date","closeout","close out date","project close"],
  contractValue:         ["contract value","value","contract amount","total contract","total fee","project value"],
  laborBudget:           ["labor budget","labour budget","labor cost","labour cost","staffing budget"],
  grossMargin:           ["gross margin","margin","gm","gross profit"],
  contractType:          ["contract type","delivery type","contract form","agreement type"],
  contractedAmount:      ["contracted amount","contracted","executed contract","signed amount","awarded amount","award amount","awarded value","award value"],
  proposalAmount:        ["proposal amount","proposal","proposal value","proposed amount","proposed value"],
  bidAmount:             ["bid amount","bid","bid value","tender amount","bid price"],
  bidDueDate:            ["bid due date","bid due","bid deadline","bid submission date","tender due date"],
  retainagePct:          ["retainage percent","retainage choice","retainage percentage","retainage rate"],
  actualProjectCost:     ["actual project cost","actual cost","actual total cost","incurred cost"],
  forecastedProjectCost: ["forecasted project cost","forecasted cost","forecast cost","projected project cost","eac cost"],
  changeOrders:          ["change orders","co total","total co","cos","change order"],
  approvedChangeOrders:  ["approved change orders","approved co","approved cos","approved change order total"],
  retainage:             ["retainage","retention","holdback"],
  feePct:                ["fee %","fee percent","fee pct","fee percentage","fee rate"],
  contingency:           ["contingency","contingency amount","contingency budget","contingency reserve","contingency fund"],
  nonOperatingCost:      ["non-operating cost","non operating cost","nonoperatingcost","noc","nco","non-op cost"],
  totalProjectCost:      ["total project cost","total cost","tpc","total budget"],
  pctComplete:           ["% complete","percent complete","completion %","progress","percent done"],
  priority:              ["priority","project priority","urgency","priority level"],
  nextMilestone:         ["next milestone","milestone","next milestone name","upcoming milestone"],
  nextMilestoneDate:     ["next milestone date","milestone date","upcoming milestone date","milestone due","milestone due date"],
  description:           ["description","desc","project description","scope","summary","project scope","exec summary","contract comments"],
  notes:                 ["notes","note","project notes","general notes","pm notes","internal notes","comments","comment","contract notes","contract note","project summary note","summary note","project summary","remarks"],
  streetAddress:         ["street address","address","street","site address","location address","address line 1","address line","address 1"],
  city:                  ["city","site city","project city","location city","town","town city"],
  state:                 ["state","province","region","state/province"],
  office:                ["office","office location","branch","managing office","branch office","office name"],
  linkedOpp:             ["from opportunity","source opportunity","linked opportunity","origin opportunity","opportunity link","won from opportunity"],
  // ASG_COLS (prefixed with asg_ to avoid collision with project fields)
  asg_projectId:         ["project id","project #","job id","job #","job number","project number","erp job id","project no","project num","proj id","proj no","proj #","project identifier","pmm id","record id","ticket id","erp job #","erp job","erp id","job no","id number","job code","project / opp id","project/opp id","project or opp id","project or opportunity id","opportunity id","opp id","opp #","opportunity #","opm id","opportunity number","opp no","rmone id","rm one id","rmone #","rmone number"],
  asg_project:           ["project","project title","project name","job","job name","project reference","assigned project"],
  // STAFF_COLS synonyms (st_ prefix)
  st_name:               ["full name","name","employee name","staff name","member name","resource name","display name","person name","person"],
  st_email:              ["login email","email","e-mail","email address","work email","staff email","user email","corporate email","username","user name","login","login name","user login","login id"],
  st_businessUnit:       ["business unit","bu","business area","strategic unit","business unit name","primary bu","primary business unit"],
  st_division:           ["division","div","practice area","business vertical"],
  st_department:         ["department","dept","team","sub-group","cost centre"],
  st_role:               ["role","position","job role","function","staff role","global role","resource role","employee role","primary role","role name","worker role","billable role","billing role"],
  st_jobTitle:           ["job title","title","designation","employee title"],
  st_manager:            ["manager","manager email","reports to","line manager","reporting manager","manager name","direct manager"],
  st_accessLevel:        ["access level","access","user role","permission","permission level"],
  st_startDate:          ["start date","hire date","join date","employment start"],
  st_created:            ["created on","created date","date created","creation date","created","created at"],
  st_endDate:            ["end date","termination date","leave date","employment end"],
  st_employeeType:       ["employee type","employment type","worker type","staff type","work type","employment status","employee category"],
  st_phone:              ["phone","phone number","mobile","mobile number","cell","cell phone","work phone","telephone","contact number","direct phone"],
  st_employeeId:         ["employee id","employee number","staff id","badge number","emp id","payroll id","employee no","badge id","hr id","worker id"],
  st_skills:             ["skills","skill set","competencies","expertise","skill list","technical skills","capabilities"],
  st_expTags:            ["experience tags","experience","tags","experience areas","area of experience","specializations","practice areas"],
  st_groups:             ["groups","user groups","user group","group membership","security groups","member of"],
  asg_name:              ["name","full name","team member","resource","staff","employee","person","resource name","member name","employee name","staff member","staff name"],
  asg_email:             ["email","e-mail","email address","work email","staff email"],
  asg_employeeId:        ["employee id","employee #","employee number","employee no","emp id","emp #","emp no","emp number","staff id","staff #","staff number","staff no","personnel id","personnel number","badge id","badge number","badge #","worker id","payroll id","payroll number","hr id","people id","person id","resource id"],
  asg_startDate:         ["start date","start","begin date","from","assignment start","allocation start date","allocation start","est start date","estimated start date","plan start","plan start date"],
  asg_endDate:           ["end date","end","finish date","to","assignment end","through","allocation end date","allocation end","est end date","estimated end date","plan close","plan end","plan close date","plan end date"],
  asg_totalHours:        ["total hours","hours","hrs","budgeted hours","allocated hours","planned hours","planned effort","effort","allocation hour","allocation hours","allocation hrs","alloc hours","alloc hrs","total hrs"],
  asg_pctAlloc:          ["allocation %","% alloc","alloc %","% allocation","pct allocation","pct alloc","allocation percent","allocation percentage","percent allocation","allocation pct","fte %","fte"],
  asg_type:              ["type","assignment type","allocation type"],
  asg_role:              ["role","position","job role","function","project role","role on job","role on project"],
  asg_jobTitle:          ["job title","title","designation","employee title"],
  asg_businessUnit:      ["business unit","bu","bu studio","primary bu","primary business unit"],
  asg_division:          ["division","div","practice area"],
  asg_department:        ["department","dept"],
  asg_billingRate:       ["billing rate","bill rate","rate","hourly rate","billable rate","standard billing rate","charge rate","charge out rate","chargeout rate","client rate","invoice rate","billing rate per hour","hourly billing rate","hourly bill rate","billing rate usd","bill rate usd"],
  asg_laborRate:         ["labor rate","labour rate","labor cost rate"],
  asg_costRate:          ["cost rate","employee cost","cost"],
  asg_billedHours:       ["billed hours","billed","invoiced hours"],
  asg_softAlloc:         ["soft allocation","soft alloc","soft","soft booking","soft booked","tentative","tentative allocation","provisional","provisional allocation","pencilled in","penciled in","soft assignment","is soft","softallocation"],
  asg_nonChargeable:     ["non chargeable","non-chargeable","nonchargeable","non chargable","non-chargable","non billable","non-billable","nonbillable","not billable","not chargeable","no charge","unbillable","overhead","non bill","nb"],
  asg_isLocked:          ["is locked","islocked","locked","lock","locked allocation","allocation locked","frozen","protected","do not change","do not update","no reimport","exclude from import"],
  asg_accessLevel:       ["access level","access","permission","user role","security level","perms","permissions"],
  // SCHEDULE_COLS
  sch_projectId:         ["project id","project #","job id","job #","job number","project number","erp job id","project no","project num","proj id","proj no","proj #","project identifier","pmm id","record id","ticket id","erp job #","erp job","erp id","job no","id number","job code","project / opp id","project/opp id","project or opp id","project or opportunity id","opportunity id","opp id","opp #","opportunity #","opm id","opportunity number","opp no","rmone id","rm one id","rmone #","rmone number"],
  sch_project:           ["project title","project name","project","job name","job","project ref"],
  sch_phaseName:         ["phase name","phase","task name","task","activity name","activity","stage","stage name","workstream","workstream stage"],
  sch_phaseOrder:        ["phase order","order","sequence","step","phase no","phase #","stage order","stage no","phase number","seq","seq no","seq #","order #"],
  sch_startDate:         ["start date","start","begin date","commencement","from","planned start","phase start","stage start","begins","plan start","plan start date"],
  sch_endDate:           ["end date","end","finish date","completion date","due date","planned end","planned finish","phase finish","phase end","stage end","stage finish","ends","plan close","plan end","plan close date","plan end date"],
  sch_duration:          ["duration (days)","duration","days","duration days","length (days)","length","dur"],
  sch_milestone:         ["milestone","key milestone","deliverable","milestone name","is milestone","milestone flag"],
  sch_pctComplete:       ["% complete","percent complete","completion %","progress","pct complete","% done","done"],
  sch_notes:             ["notes","comments","description","remarks","note","phase notes","remarks log","log"],
  // OPP_COLS (opp_ prefix)
  opp_title:        ["opportunity title","opp title","opportunity name","opp name","pursuit","pursuit name","project title","project name","title","name"],
  opp_category:     ["project category","category","module","project type category","opp category","cns/cpr","service or construction","opportunity category"],
  opp_company:      ["company name","company","client","client name","organization","firm"],
  opp_contact:      ["contact name","contact","client contact","primary contact","main contact","key contact","project contact","project lead","project leads","proj lead","lead","project leader","team lead","lead contact","lead person","owner name","owner","client rep","client manager","point of contact","poc","contact person"],
  opp_erpJob:       ["erp job #","erp job","job #","erp","job number","erp job id","opportunity id","opp id","opportunity #","opp #","project id","project #","project number","job id","record id","ticket id","project no","project num","proj id","proj no","project identifier","opportunity number","opp number","opportunity no","pursuit id","pursuit #","erp id","job no","id number","rmone id","rm one id","rmone #","rmone number"],
  opp_stage:        ["stage","pursuit stage","crm status","opportunity stage","opportunity status","opp stage"],
  opp_chance:       ["chance of success","win probability","probability","win %","chance","success %","win rate"],
  opp_pctComplete:  ["% complete","percent complete","completion %","progress","percent done","pct complete","% done","done %","completion","phase % complete","phase percent complete"],
  opp_sector:       ["market sector","sector","industry","vertical","market"],
  opp_bu:           ["business unit","bu","practice group","primary bu","primary business unit"],
  opp_division:     ["division","div","practice area","business line"],
  opp_dept:         ["department","dept","team"],
  opp_targetStart:  ["target start","target start date","forecast start","forecasted start","expected start","projected start","start date","start","plan start","plan start date"],
  opp_targetEnd:    ["target end","target end date","target completion","forecast end","forecasted end","expected end","projected end","expected completion","end date","end","plan close","plan end","plan close date","plan end date"],
  opp_awardDate:    ["award / loss date","award date","loss date","outcome date","awarded date"],
  opp_approxValue:  ["approx contract value","approximate value","estimated value","contract value","value"],
  opp_costEst:      ["forecasted project cost","cost estimate","project cost","internal cost","forecasted cost"],
  opp_laborAmt:     ["labor contract amount","labor budget","labour budget","labor amount"],
  opp_nonOpCost:    ["non-operating cost","non operating cost","nonoperatingcost","noc","nco","non-op cost"],
  opp_margin:       ["gross margin","margin","gm","gross profit"],
  opp_contractType: ["contract type","delivery type","contract form","agreement type"],
  opp_description:  ["description","desc","summary","scope","opportunity description"],
  opp_notes:        ["notes","note","opportunity notes","opp notes","pm notes","general notes","internal notes","internal note","comments","comment","opp comment","additional notes","remarks"],
  opp_poc:          ["point of contact","poc","client poc","contact person"],
  opp_businessLead:     ["business lead","business lead user","business lead name","business unit lead","bu lead","biz lead","business leader","unit lead"],
  opp_projectManager:   ["project manager","pm","project mgr","proj manager","proj mgr","manager","project management"],
  opp_srProjectManager: ["sr project manager","senior project manager","sr. project manager","sr pm","senior pm","principal project manager","principal pm"],
  opp_createdOn:        ["created on","created date","date created","creation date","created","created at"],
  opp_groups:           ["groups","action user","action users","user groups","user group","group membership","security groups","access groups"],
  opp_status:       ["status","record status","overall status","phase","project phase","current phase","phase status","work status","current status"],
  opp_office:       ["office","office location","branch","managing office","branch office","office name"],
  // LEADS_COLS (ld_ prefix)
  ld_name:      ["lead name","lead","lead title","inquiry name","opportunity name"],
  ld_company:   ["company name","company","client","client name","organization"],
  ld_contact:   ["contact name","contact","primary contact","main contact","key contact","project contact","client contact","project lead","project leads","proj lead","lead","project leader","team lead","lead contact","lead person","point of contact","poc","contact person"],
  ld_stage:     ["stage","lead stage","pursuit stage","inquiry stage"],
  ld_status:    ["status","lead status","record status"],
  ld_createdOn: ["created on","created date","date created","creation date","created","created at"],
  ld_sector:    ["market sector","sector","industry","vertical"],
  ld_category:  ["project category","category","project type category","lead category","opp category","cns/cpr","service or construction","request category"],
  ld_bu:        ["business unit","bu","practice group","primary bu","primary business unit"],
  ld_division:  ["division","div","practice area"],
  ld_dept:      ["department","dept","sub department","sub-department","department name"],
  ld_office:    ["office","branch","office location","managing office","home office"],
  ld_address:   ["address","street address","address 1","address1","street","project address","site address"],
  ld_city:      ["city","town","municipality"],
  ld_state:     ["state","province","state/province","state or province"],
  ld_targetStart: ["target start","target start date","forecast start","forecasted start","expected start","start date","projected start","plan start","plan start date"],
  ld_targetEnd:   ["target end","target end date","target completion","forecast end","forecasted end","expected end","end date","projected end","expected completion","plan close","plan end","plan close date","plan end date"],
  ld_value:     ["est. contract value","estimated value","contract value","est value","approx value"],
  ld_desc:      ["description","desc","summary","scope"],
  ld_note:      ["notes","note","internal notes","internal note","comments","remarks"],
  // COMPANIES_COLS (co_ prefix)
  co_name:    ["company name","company","client","organization","firm","account"],
  co_sector:  ["industry","market sector","sector","vertical","business type"],
  co_health:  ["crm health","health","relationship health","account health","client health"],
  co_contact: ["contact name","contact","primary contact","main contact","key contact","project contact","client contact","project lead","project leads","proj lead","lead contact","lead person","point of contact","poc","contact person"],
  co_email:   ["contact email","email","e-mail","contact e-mail"],
  co_title:   ["contact title","title","contact job title","position"],
  co_phone:   ["phone","telephone","phone number","tel"],
  co_address: ["address","street address","street","mailing address"],
  co_city:    ["city","location city"],
  co_state:   ["state","province","state/province","region"],
  co_rep:     ["client rep","account manager","relationship owner","rep","rm"],
  co_division:["division","div","managing division"],
  co_created: ["created on","created date","date created","creation date","created","created at"],
};

const DICT_SYNONYMS: Record<string, string[]> = {
  // PROJECT_COLS
  projectTitle: ["prj name","proj name","prj","proj","project nm","long name","project long name","full project name","full title","official name","project full name","job nm","commission name","site name","facility name","building name","development name","program name","programme name","project heading","display title"],
  companyName: ["co name","cust name","acct name","entity name","counterparty","owner company","employer","employer name","principal client","end customer","bill to","bill to client","billing client","invoice to","sold to","developer name","agency name"],
  ownerName: ["client representative","customer rep","contact full name","customer contact","site contact","attention","attn name","account contact","named contact"],
  ownersRep: ["owner's agent","owners agent","owner agent","owner side rep","owner pm","owner project manager","employer's representative","employers representative","engineer's representative","superintending officer","contract administrator","project monitor","owner advisor","owner's consultant"],
  projectId: ["rm one id","rmone id","rm1 id","rm one number","tkt id","prj id","prj code","reference no","erp job number","erp no","erp ref","cmic project number","cmic project no","cmic","cmic id","cmic no","cmic number","cmic job","cmic job number","wbs id","charge number","external id","external ref","legacy id","legacy number","source id","system id","contract id","work order no","wo no","sap project","sap wbs","oracle project number"],
  shortName: ["short title","abbrev","abbr","acronym","nick name","friendly name","common name","working name","project short name","project alias","project nickname","mnemonic","code name","slug"],
  marketSector: ["market name","segment name","business segment","client industry","facility type","asset type","sub sector","subsector"],
  projectType: ["project type choice","project type name","prj type","proj type","type of work","nature of work","build method","project class","project nature"],
  serviceType: ["service type choice","service type name","service name","service group","offering type","practice type","practice line","capability","capability type","services provided","service provided","type of services","solution type"],
  category: ["categories","category choice","category code","cat name","subtype","sub type","grouping","bucket","portfolio category"],
  businessUnit: ["bu name","bu code","bu lookup","business unit lookup","crm business unit","crm bu","p&l unit","reporting unit","company unit","business area"],
  division: ["div name","div code","divisional unit","business division","branch division","group division","lob name","organisation unit","organization unit"],
  department: ["dep","dept name","dept code","department no","dept no","functional group","section name","cc code","charge department","home department","reporting department"],
  status: ["status code","crm project status choice","crm project status","crm status","job status","present status","life cycle status","workflow state","pipeline status","active status","disposition","standing"],
  startDate: ["start dt","date start","beginning date","date begun","started on","start on","date of commencement","ko date","inception date","ntp","notice to proceed","job start","job start date","contract commencement","effective from","valid from","period from"],
  endDate: ["end dt","date end","finished on","date complete","date completed","completed on","completed date","closing date","job end date","contract completion","contract finish","practical completion","practical completion date","valid to","valid until","to date","period to","thru date","through date"],
  closeoutDate: ["close out","project closeout","job closeout date","final close date","financial closeout","financial closeout date","financial close date","admin closeout","administrative closeout date","final acceptance","final acceptance date","final sign off date","sign off date","archive date","archived date","retention release date","final invoice date","turnover date"],
  contractValue: ["contract amt","contract total","total project value","value of work","value of works","works value","booked value","contract revenue","total fees","net contract value","gross contract value","budget amount","budget value","budgeted cost","budgeted amount"],
  laborBudget: ["labor budget amount","labour budget amount","labor contract amount","labour contract amount","labor contract value","labor contract","labour contract","labor amount","labour amount","labor cost budget","labour cost budget","budgeted labor","budgeted labour","budget labor","labor budgeted","direct labor budget","direct labour budget","planned labor","planned labor cost","labor fee budget","labor fee","labour fee","labor value","labour value","labor portion","staff budget","resource budget","manpower budget","man hour budget","manhour budget","effort budget","payroll budget","wage budget"],
  grossMargin: ["gross margin amount","gross margin value","gross margin pct","gross margin percentage","gm pct","gm amount","margin amount","margin value","margin pct","margin percentage","gross profit amount","gp pct","gp amount","profit amount","profitability","expected margin","planned margin","forecast margin","budgeted margin","contribution margin","net margin","profit percent"],
  contractType: ["contract type choice","contract type name","contract basis","contract model","contract category","contract class","contract classification","type of agreement","pricing basis","billing type","billing method","billing basis","bill type","invoice type","fee basis","compensation method","commercial model","commercial type"],
  contractedAmount: ["contracted amt","contracted sum","contracted price","contracted total","contracted value","amount contracted","value contracted","executed amount","executed value","signed value","committed amount","committed value","commitment amount","original contract amount","original contract value","original contract sum","base contract amount","base contract value","baseline contract value","initial contract amount","initial contract value","contract booked value","current contract amount","revised contract amount"],
  proposalAmount: ["proposal amt","proposal sum","proposal total","proposal price","proposal fee","fee proposal","fee proposal amount","proposed fee","proposed price","amount proposed","quote","quote value","quoted value","quoted price","quotation","quotation amount","quotation value","offer amount","offered amount","offer value","submitted amount","submitted value","submission amount","pursuit value","pursuit amount","expected fee"],
  bidAmount: ["bid amt","bid sum","bid figure","bid submitted","bid submission amount","amount bid","tender price","tender sum","tender total","tendered amount","tendered value","tender submitted","bid tender amount","original bid amount","final bid amount","winning bid","winning bid amount","lump sum bid","base bid","base bid amount","submitted bid","submitted bid amount"],
  bidDueDate: ["bid date","tender submission date","tender deadline","bid submittal date","bid close date","submittal due date"],
  retainagePct: ["retainage pct","retention pct","retained percentage"],
  actualProjectCost: ["real project cost","costs incurred"],
  forecastedProjectCost: ["forecast total cost","forecast at completion","fac","estimate at completion","eac","anticipated cost","anticipated final cost","afc"],
  changeOrders: ["change order sum","change orders amount","change orders value","change orders total","co value","co sum","total co value","sum of change orders","pending cos","open change orders","unapproved change orders","potential change orders","pco","pcos","variation order","variation orders","variation amount","variation value","variation total","amendment amount","contract amendments","extra works","additional works","additional works value"],
  approvedChangeOrders: ["approved change orders amount","approved change orders value","approved change orders total","approved co amount","approved co value","approved co total","aco","acos","aco amount","total approved change orders","total approved cos","sum of approved cos","executed cos","executed co amount","signed change orders","signed cos","accepted change orders","accepted cos","authorised change orders","authorized change orders","approved variations","approved vo","approved vos","approved variation amount","agreed variations","sanctioned change orders"],
  retainage: ["retainage value","retainage withheld","retention value","retention money","retention sum","retained amount","amount retained","hold back","holdback amount","withheld amount","security retention","defects retention"],
  feePct: ["percent fee","percentage fee","fee ratio","management fee percent","markup","mark up","markup pct","markup percent","mark up percentage"],
  contingency: ["contingencies","contingency value","contingency sum","contingency total","contingency pct","contingency percent","contingency percentage","contingency rate","contingency allowance","contingency provision","project contingency","reserve amount","management reserve","risk reserve","risk allowance","risk provision","risk contingency","allowance amount","provisional sum","provisional sums","buffer amount","design contingency","construction contingency","escalation allowance"],
  nonOperatingCost: ["non op cost","non operating expense","non operating expenses","non operational cost","non labor cost","non labour cost","other cost","other costs","other direct cost","other direct costs","odc","indirect cost","indirect costs","overhead cost","reimbursable cost","reimbursables","pass through cost","passthrough cost","expense budget","expenses budget","sub consultant cost","subconsultant cost","subcontract cost"],
  totalProjectCost: ["total project costs","total project cost amount","project costs","all in cost","all in project cost","total installed cost","tic","tec","estimated total cost","job cost","job costs","total spend","total expenditure","total outlay","capital cost","capex","overall budget","total job cost","grand total cost","total costs","total cost amount"],
  pctComplete: ["percentage complete","completion percent","completion percentage","progress percent","progress percentage","physical percent complete","physical progress","work complete","earned value"],
  priority: ["priorities","priority choice","priority name","priority code","priority rating","priority value","priority flag","prio","job priority","importance","importance level","urgency level","criticality","critical level","severity","severity level","order of priority","tier level","escalation level"],
  nextMilestone: ["next milestone title","next milestone desc","milestones","milestone name","milestone title","milestone description","current milestone","coming milestone","following milestone","key milestone","major milestone","next key event","next deliverable","next deliverable name","next submission","next gate","stage gate","next review","next checkpoint"],
  nextMilestoneDate: ["next milestone dt","next milestone due","next milestone deadline","next milestone target","milestone dt","milestone deadline","milestone target date","current milestone date","next key date","key milestone date","next major milestone date","next event date","next deliverable date","deliverable date","next submission date","next stage date","next phase date","next gate date","gate date","next review date","next checkpoint date","next action date","next due date"],
  description: ["descriptions","descr","description text","job description","project brief","detailed description","full description","long description","long text","project narrative","about project","overview","project overview","work description","description of work","description of works","scope of work","scope of works","sow","sow description","statement of work"],
  notes: ["notes text","note text","job notes","remarks text","observation","observations","memos","memo text","annotations","private notes","manager notes","admin notes","additional info","additional information","extra notes","other notes","other info","other information","free text","narrative notes","comment text","internal comment","additional comments","contract note"],
  streetAddress: ["street address 1","street address line 1","street addr","street 1","street name","street line 1","addr1","addr line 1","full address","complete address","postal address","physical address","job address","job site address","work address","building address","premises address","address details","project address"],
  city: ["cities","city code","city town","city or town","town name","township","municipality","locality","suburb","borough","metro area","metropolitan area","job city","address city","mailing city","postal city"],
  state: ["state code","state abbr","state abbreviation","state abbrev","state prov","province name","site state","job state","address state","mailing state","postal state","state or province"],
  office: ["offices","office lookup","office choice","office code","office no","office number","office id","home location","assigned office","responsible office","reporting office","operating office","executing office","lead office","owning office","primary office","branch name","branch code","regional office","local office","site office"],
  // ASG_COLS — assignments-tab date/hour/type mirrors of TAB_SYNONYM_OVERRIDES
  asg_startDate: ["start dt","date start","started on","start on","effective from","valid from","period from","from date","commencement","commencement date"],
  asg_endDate: ["end dt","date end","finished on","completed on","completed date","date complete","date completed","valid to","valid until","to date","period to","thru date","through date","completion date","due date","deadline"],
  asg_totalHours: ["budget hours","forecast hours","man hours","manhours","scheduled hours","assigned hours"],
  asg_pctAlloc: ["utilization","utilisation","capacity","capacity percent","loading","percent time","percent allocated","fte percent"],
  asg_type: ["booking type","hard soft","confirmed tentative","commitment type"],
  asg_role: ["assignment role","labor category","lcat","trade"],
  asg_billedHours: ["hours billed","chargeable hours"],
  // OPP_COLS — same server families re-pointed at opportunity columns
  opp_title: ["pursuit title","project heading","full title","official name"],
  opp_company: ["co name","cust name","acct name","entity name","counterparty","owner company","principal client","end customer","developer name","agency name"],
  opp_sector: ["market name","market type","segment name","business segment","client industry","facility type","asset type","sub sector","subsector"],
  opp_bu: ["bu name","bu code","bu lookup","business unit lookup","crm business unit","crm bu","reporting unit","business area"],
  opp_division: ["div name","div code","business division","lob name"],
  opp_dept: ["dept name","dept code","dept no","functional group","section name"],
  opp_targetStart: ["estimated start date","estimated start","est start","anticipated start","anticipated start date","target commencement","planned start date","scheduled start","scheduled start date","baseline start"],
  opp_targetEnd: ["est end","anticipated completion","anticipated completion date","anticipated end","planned end","planned end date","scheduled end","scheduled finish","baseline end date","forecast finish","forecast completion","forecast completion date","planned completion","planned completion date","scheduled completion","target finish","target finish date"],
  opp_awardDate: ["date awarded","date lost","won loss date","awarded or loss date","award decision date","decision date","go no go date"],
  opp_approxValue: ["est contract value","expected value","anticipated value"],
  opp_contractType: ["contract type choice","contract form","contract basis","pricing basis","fee basis","commercial model"],
  opp_office: ["office code","assigned office","branch name","regional office","local office"],
  // LEADS_COLS
  ld_company: ["co name","cust name","acct name","entity name","developer name","agency name"],
  ld_targetStart: ["estimated start","est start","anticipated start","anticipated start date","planned start date"],
  ld_targetEnd: ["est end","anticipated end","anticipated completion","planned end","planned end date","forecast completion"],
  ld_value: ["expected value","anticipated value"],
  ld_office: ["office code","branch name","home location"],
  // COMPANIES_COLS
  co_name: ["co name","cust name","acct name","entity name","counterparty","developer name","agency name"],
};
// DICT_SYNONYMS is an extension dictionary — merge it into SYNONYMS at module
// init so BOTH the exact and fuzzy tiers see every alias. (It was previously
// declared but never referenced, so aliases like "rmone id" or "planned start
// date" silently never matched anything.)
for (const [k, list] of Object.entries(DICT_SYNONYMS)) {
  const dst = (SYNONYMS[k] ??= []);
  for (const s of list) if (!dst.includes(s)) dst.push(s);
}
function norm(s: string) { return s.toLowerCase().replace(/#/g, " num ").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim(); }
// Compact form: all separators removed. Makes camelCase / no-space headers
// ("AllocationStartDate", "EstStartDate") match their spaced synonyms
// ("allocation start date") — norm() alone can't, since it has no separator
// to split on in the header.
function compactKey(s: string) { return s.toLowerCase().replace(/#/g, "num").replace(/[^a-z0-9]/g, ""); }

// ── Custom synonyms (Synonyms manager) ────────────────────────────────────
// Aliases the client added via the Synonyms page map to BACKEND canonical
// fields (e.g. "AllocationStartDate"), not grid column keys — so after an
// alias hit we resolve the canonical field name through the same
// label/synonym matching to find the grid column.
// Refetched at the start of EVERY file parse (uploads are rare, the GET is
// cheap) so an alias added on the Synonyms page mid-session is picked up on
// the next upload without a page reload. On fetch failure the last
// successfully-loaded map (if any) is kept.
let CUSTOM_SYN: Record<string, string> | null = null; // compactKey(alias) → canonicalField
function ensureCustomSynonyms(): Promise<void> {
  return fetch("/api/synonyms")
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data: { synonyms?: Array<{ alias: string; canonicalField: string; isBuiltin: boolean }> }) => {
      const map: Record<string, string> = {};
      for (const s of data.synonyms ?? []) {
        if (s.isBuiltin) continue; // built-ins are already covered by SYNONYMS above
        const k = compactKey(String(s.alias ?? ""));
        if (k && s.canonicalField) map[k] = String(s.canonicalField);
      }
      CUSTOM_SYN = map;
    })
    .catch(() => {}); // keep last-known-good map; auto-mapping stays non-fatal
}

function exactMapToColDef(header: string, cols: ColDef[]): string {
  const n = norm(header);
  const c = compactKey(header);
  for (const col of cols) {
    if (norm(col.label) === n || compactKey(col.label) === c) return col.key;
    const syns = SYNONYMS[col.key] ?? [];
    if (syns.some(s => norm(s) === n || compactKey(s) === c)) return col.key;
  }
  // Custom synonym: alias → backend canonical field → grid column.
  const canon = CUSTOM_SYN?.[c];
  if (canon) {
    const cc = compactKey(canon);
    for (const col of cols) {
      if (compactKey(col.label) === cc) return col.key;
      // e.g. canonical "JobTitle" vs key "asg_jobTitle" → "jobtitle"
      if (compactKey(col.key.replace(/^(asg|st|sch|opp|ld|co)_/, "")) === cc) return col.key;
      const syns = SYNONYMS[col.key] ?? [];
      if (syns.some(s => compactKey(s) === cc)) return col.key;
    }
  }
  return SKIP;
}

// ── Fuzzy tier (deterministic, synchronous) ───────────────────────────────
// Variant-tolerant matching applied ONLY after every exact tier fails.
// Purely a function of (header, cols) — no async, no external state — so
// buildNoDupMappings, the upload column audit's duplicate exemption and the
// "_\d+" de-suffix retry all stay in lockstep by calling the same function.
//
// Design constraints (documented in memory: import-grid-column-audit.md):
//  • Token-based: split on separators, camelCase and letter↔digit boundaries,
//    expand common abbreviations (proj→project, no→number, …).
//  • A candidate (label or synonym) matches when all its tokens appear in the
//    header AND the header's leftover tokens are pure noise ("number", units,
//    articles, bare digits). "Project ID Number" → {project,id}+noise ✓.
//  • Typos: one edit distance on the compact forms (both ≥6 chars).
//  • Specificity guard: the winning column must be STRICTLY more specific
//    (longest candidate token count) than every other candidate column —
//    any tie means ambiguity → SKIP. Never guesses between two columns.
const FUZZY_ABBREV: Record<string, string> = {
  proj: "project", opp: "opportunity", opps: "opportunity",
  amt: "amount", desc: "description", dept: "department", div: "division",
  pct: "percent", no: "number", num: "number", nbr: "number",
  addr: "address", emp: "employee", hrs: "hours", mgr: "manager",
  qty: "quantity", alloc: "allocation", est: "estimated",
  dt: "date", actl: "actual", begins: "start", begin: "start",
  ends: "end", finish: "end", seq: "sequence", dur: "duration",
  plan: "planned", prj: "project", tgt: "target",
};
const FUZZY_NOISE = new Set([
  "number", "col", "column", "field", "usd", "dollar", "dollars",
  "per", "hour", "hours", "hr", "h", "of", "the", "a", "an", "in", "for", "total",
]);
function fuzzyTokens(s: string): string[] {
  return s
    .replace(/#/g, " number ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(t => FUZZY_ABBREV[t] ?? t);
}
// All candidate tokens present in the header, leftovers are noise/digits only.
function tokenSubsetMatch(headerToks: string[], candToks: string[]): boolean {
  if (candToks.length === 0) return false;
  const hset = new Set(headerToks);
  if (!candToks.every(t => hset.has(t))) return false;
  const cset = new Set(candToks);
  return headerToks.every(t => cset.has(t) || FUZZY_NOISE.has(t) || /^\d+$/.test(t));
}
// True when a and b are at most one insert/delete/substitute apart.
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la === lb) { i++; j++; }
    else if (la > lb) { i++; }
    else { j++; }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}
function fuzzyMapToColDef(header: string, cols: ColDef[]): string {
  const hToks = fuzzyTokens(header);
  if (hToks.length === 0) return SKIP;
  const hExpanded = hToks.join("");
  const hCompact = compactKey(header);
  // Units guard: a header carrying an explicit hour token ("AllocationHour",
  // "Capacity Hours") must never fuzzy-land on a percent-flavored column.
  // FUZZY_NOISE forgives "hour"/"hours" as leftover tokens — right for
  // "Budgeted Hours USD", but as a UNIT it contradicts a % destination
  // (20 hours ≠ 20%, the pipeline would book 8h weeks instead of 20h).
  // Percent-flavored = label/synonyms mention %/percent/pct and carry no
  // hour-ish alias of their own. Exact tiers are untouched, so a custom
  // alias that literally names a % column keeps working.
  const headerHasHourUnit = hToks.some(t => t === "hour" || t === "hours" || t === "hr");
  const HOUR_RE = /hour|\bhrs?\b/i;
  const PCT_RE = /%|percent|\bpct\b/i;
  const pctOnlyCol = (col: ColDef) =>
    (PCT_RE.test(col.label) || (SYNONYMS[col.key] ?? []).some(s => PCT_RE.test(s))) &&
    !(HOUR_RE.test(col.label) || (SYNONYMS[col.key] ?? []).some(s => HOUR_RE.test(s)));
  // Best (most token-rich) matching candidate per column key.
  const best = new Map<string, number>();
  for (const col of cols) {
    if (headerHasHourUnit && pctOnlyCol(col)) continue;
    const cands = [col.label, ...(SYNONYMS[col.key] ?? [])];
    for (const cand of cands) {
      const cToks = fuzzyTokens(cand);
      let hit = tokenSubsetMatch(hToks, cToks);
      if (!hit) {
        const cCompact = compactKey(cand);
        const cExpanded = cToks.join("");
        hit =
          (hCompact.length >= 6 && cCompact.length >= 6 && withinOneEdit(hCompact, cCompact)) ||
          (hExpanded.length >= 6 && cExpanded.length >= 6 && withinOneEdit(hExpanded, cExpanded));
      }
      if (hit && cToks.length > (best.get(col.key) ?? 0)) best.set(col.key, cToks.length);
    }
  }
  if (best.size === 0) return SKIP;
  // Strictly-most-specific winner or nothing.
  let winner: string | null = null; let winScore = 0; let tied = false;
  for (const [key, score] of best) {
    if (score > winScore) { winner = key; winScore = score; tied = false; }
    else if (score === winScore) { tied = true; }
  }
  return tied || winner === null ? SKIP : winner;
}

function autoMapToColDef(header: string, cols: ColDef[], opts?: { exactOnly?: boolean }): string {
  const k = exactMapToColDef(header, cols);
  if (k !== SKIP || opts?.exactOnly) return k;
  return fuzzyMapToColDef(header, cols);
}

// Strict label-only check: header must exactly match a ColDef label (no synonyms).
// Used for schema validation so only official template column names are accepted.
// RETIRED_LABELS: columns that used to exist on our templates but were removed
// (Actual dates/hours are schedule-derived now). Files that still contain them
// — e.g. workbooks downloaded from an older template — pass validation and the
// column is simply skipped instead of blocking the whole upload.
const RETIRED_LABELS = new Set([
  "actual start", "actual end", "actual hours",
  "actual start date", "actual end date",
]);
function isKnownLabel(header: string, tabs: TabDef[]): boolean {
  const n = norm(header);
  if (RETIRED_LABELS.has(n)) return true;
  return tabs.some(tab => tab.cols.some(col => norm(col.label) === n));
}

// Build initial no-dup mappings for one tab.
// Three passes per group: label-exact headers claim FIRST (a header that
// literally names a template column — "JobTitle" ≡ "Job Title" — can never
// lose that column to an earlier nickname column: bare "Title" is only a
// synonym for Job Title). Then synonym-exact matches, then fuzzy. Fuzzy
// results are still computed against the FULL col list (autoMapToColDef
// stays a pure function of header+cols — the upload audit's could-match
// exemption depends on that); a fuzzy winner already claimed by an exact
// twin dedup-SKIPs exactly like an exact duplicate would.
//
// LOSER_FALLBACK: a nickname header that lost its column to a LABEL-EXACT
// header gets one narrow re-route instead of a dedup-SKIP. Keyed by
// norm(header); values = candidate col keys in priority order (first
// unclaimed one on this tab wins). Bare "Title" next to a real job-title
// column is the project name sitting beside the project ID (H Mart file),
// not a person's title. Equal-strength twins keep the dedup-SKIP behavior.
const LOSER_FALLBACK: Record<string, string[]> = {
  title: ["asg_project"],
};
// Label-exact tier: the header IS a template column's visible label.
function labelExactKey(header: string, cols: ColDef[]): string {
  const n = norm(header);
  const c = compactKey(header);
  for (const col of cols) {
    if (norm(col.label) === n || compactKey(col.label) === c) return col.key;
  }
  return SKIP;
}
function buildNoDupMappings(headers: string[], cols: ColDef[], hasData?: (h: string) => boolean): Record<string, string> {
  const used = new Set<string>();
  // Columns claimed by a header that literally bears the column's label —
  // only these claims trigger the LOSER_FALLBACK re-route for the weaker
  // nickname header.
  const labelClaimed = new Set<string>();
  const out: Record<string, string> = {};
  // Data-bearing headers claim BEFORE empty ones (when the caller tells us
  // which is which): an empty "Target Start" column must never hold Start
  // Date hostage while a filled "Plan Start" goes unmapped. Within each
  // group the label→synonym→fuzzy invariant is unchanged.
  const groups: string[][] = hasData
    ? [headers.filter(h => hasData(h)), headers.filter(h => !hasData(h))]
    : [headers];
  for (const group of groups) {
    // Pass 1: label-exact claims (file order breaks label-vs-label ties).
    for (const h of group) {
      const k = labelExactKey(h, cols);
      if (k === SKIP) continue;
      if (used.has(k)) {
        out[h] = SKIP;
      } else {
        out[h] = k;
        used.add(k);
        labelClaimed.add(k);
      }
    }
    // Pass 2: exact synonym / custom-synonym claims.
    for (const h of group) {
      if (h in out) continue;
      const k = autoMapToColDef(h, cols, { exactOnly: true });
      if (k === SKIP) continue; // fuzzy pass handles it below
      if (!used.has(k)) {
        out[h] = k;
        used.add(k);
        continue;
      }
      // Column taken. Lost to a label-exact header → one narrow re-route;
      // otherwise (true duplicate of equal strength) dedup-SKIP as before.
      const fb = labelClaimed.has(k) ? LOSER_FALLBACK[norm(h)] : undefined;
      const fbKey = fb?.find(key => !used.has(key) && cols.some(c2 => c2.key === key));
      if (fbKey) {
        out[h] = fbKey;
        used.add(fbKey);
      } else {
        out[h] = SKIP;
      }
    }
    // Pass 3: fuzzy.
    for (const h of group) {
      if (h in out) continue;
      const k = autoMapToColDef(h, cols);
      if (k !== SKIP && used.has(k)) {
        out[h] = SKIP;
      } else {
        out[h] = k;
        if (k !== SKIP) used.add(k);
      }
    }
  }
  return out;
}

// ── Data-driven bare-"Title" re-route (only-"Title" files) ────────────────
// Some files have ONLY a "Title" column — no job-title header at all — so the
// synonym tier legitimately maps it to Job Title (HR exports call the
// person's title just "Title"). But when the DATA shows the same value on
// every row of each project (e.g. "H Mart" on every PMM-26-000008 row), that
// column is the project NAME sitting next to the project ID, not a person's
// title. SERVER MIRROR: reRouteAssignmentsBareTitle (pipeline.ts) — its data
// arm applies the same rules; keep the two in lockstep. Exercised by the
// api-server harness scripts/check-title-reroute-web.ts, which extracts this
// function (and everything from SKIP down to here) from the component source.
function reRouteBareTitleByData(mappings: Record<string, string>, cols: ColDef[], rows: Row[]): void {
  // Bare "Title" header that OWNS the Job Title column. (A real "Job Title"
  // header would have label-claimed it, sending bare "Title" through
  // LOSER_FALLBACK above — so this path only fires for only-"Title" files.)
  const titleH = Object.keys(mappings).find(h => mappings[h] === "asg_jobTitle" && norm(h) === "title");
  if (!titleH) return;
  if (!cols.some(c => c.key === "asg_project")) return;          // tab has no project column
  if (Object.values(mappings).includes("asg_project")) return;   // project name already mapped
  const projH = Object.keys(mappings).find(h => mappings[h] === "asg_projectId");
  if (!projH) return;                                            // nothing to group by
  if (!titleValuesConstantPerProject(rows, projH, titleH)) return;
  mappings[titleH] = "asg_project";
  // A weaker job-title synonym (e.g. "Designation") that dedup-SKIPped
  // against the bare "Title" can now claim the freed Job Title column.
  const orphan = Object.keys(mappings).find(h => mappings[h] === SKIP && autoMapToColDef(h, cols, { exactOnly: true }) === "asg_jobTitle");
  if (orphan) mappings[orphan] = "asg_jobTitle";
}

// Data rule — keep in LOCKSTEP with the server twin (pipeline.ts
// titleValuesConstantPerProject):
//   • only rows where BOTH the project id and the title are non-blank count;
//   • at least one project must repeat the value on 2+ rows (evidence);
//   • any project with 2+ distinct title values → NOT a project name;
//   • 2+ projects all sharing ONE identical value (e.g. "Engineer" on every
//     row of every project) reads as a company-wide job title → NOT a name.
function titleValuesConstantPerProject(rows: Row[], projH: string, titleH: string): boolean {
  const groups = new Map<string, { titles: Set<string>; n: number }>();
  for (const r of rows) {
    const p = String(r[projH] ?? "").trim();
    const t = String(r[titleH] ?? "").trim();
    if (!p || !t) continue;
    const key = p.toLowerCase();
    const g = groups.get(key) ?? { titles: new Set<string>(), n: 0 };
    g.titles.add(t.toLowerCase());
    g.n++;
    groups.set(key, g);
  }
  let evidence = false;
  const across = new Set<string>();
  for (const g of groups.values()) {
    if (g.titles.size > 1) return false;
    if (g.n >= 2) evidence = true;
    for (const t of g.titles) across.add(t);
  }
  if (!evidence) return false;
  return groups.size < 2 || across.size >= 2;
}

// First few distinct non-blank values of a file column — shown in the upload
// audit popup so the user can recognise what the column holds, and fed to the
// suggestion tier's value-shape hints.
function collectSamples(rows: Row[], header: string, max = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const v = String(r[header] ?? "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v.length > 60 ? v.slice(0, 57) + "…" : v);
    if (out.length >= max) break;
  }
  return out;
}

// ── Suggestion tier (popup-only) ──────────────────────────────────────────
// Looser than the fuzzy tier: used ONLY to PRESELECT a best guess in the
// upload-audit popup, where the user explicitly confirms or changes it —
// suggestions are never applied without that confirmation.
//  • Tier 1 (name): every token of a candidate label/synonym appears in the
//    header — leftovers are allowed ("Primary BU" → Business Unit,
//    "ERP Project ID" → Project ID). Most-token candidate wins; a tie
//    between two different columns means ambiguity → no suggestion.
//  • Tier 2 (data shape): date-looking values + a start/end/due-ish header
//    token → the unique free date column on that side; values that all
//    belong to exactly one column's fixed opts list → that column.
// A colAudit suggestion counts as "pending" only while it is still eligible
// under the popup dropdown's rules — Access Level drops out the moment a
// data-bearing Groups column exists (the Groups → level popup decides then).
// Shared by the popup's header count, intro copy, Continue label AND the
// Continue apply filter so they can never disagree.
function eligiblePendingSuggestion(
  u: { mappedTo?: string; suggested?: string; suggestionPending?: boolean; tabId?: string },
  tabStates: Record<string, { mappings: Record<string, string>; rows: Row[] } | undefined>,
): boolean {
  if (!u.suggestionPending || u.mappedTo || !u.suggested || !u.tabId) return false;
  if (u.suggested !== "st_accessLevel") return true;
  const ts = tabStates[u.tabId];
  if (!ts) return false;
  const gh = Object.entries(ts.mappings).find(([, k]) => k === "st_groups")?.[0];
  return !(gh && ts.rows.some(r => String(r[gh] ?? "").trim() !== ""));
}

function suggestColDef(header: string, samples: string[], cols: ColDef[]): string | undefined {
  const hToks = fuzzyTokens(header);
  if (hToks.length === 0 || cols.length === 0) return undefined;
  const hset = new Set(hToks);
  let bestKey: string | undefined; let bestScore = 0; let tie = false;
  for (const col of cols) {
    let colBest = 0;
    for (const cand of [col.label, ...(SYNONYMS[col.key] ?? [])]) {
      const cToks = fuzzyTokens(cand);
      // Single-token candidates are too loose here ("prj" ⊆ anything with
      // "project" in it) — one-word matches are the exact/fuzzy tiers' job.
      if (cToks.length < 2 || !cToks.every(t => hset.has(t))) continue;
      if (cToks.length > colBest) colBest = cToks.length;
    }
    if (colBest === 0) continue;
    if (colBest > bestScore) { bestScore = colBest; bestKey = col.key; tie = false; }
    else if (colBest === bestScore && col.key !== bestKey) tie = true;
  }
  if (bestKey && !tie) return bestKey;
  const vals = samples.filter(Boolean);
  if (vals.length > 0) {
    const pureNumber = (v: string) => /^\d+(\.\d+)?$/.test(v);
    const dateLike = vals.every(v =>
      /^\d{4}-\d{1,2}-\d{1,2}/.test(v) ||
      /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(v) ||
      (!pureNumber(v) && !Number.isNaN(Date.parse(v))));
    if (dateLike) {
      const dueish   = hToks.includes("due");
      const startish = !dueish && hToks.some(t => ["start","begin","begins","kickoff","commencement"].includes(t));
      const endish   = !dueish && hToks.some(t => ["end","close","closed","finish","completion","complete"].includes(t));
      const want = dueish ? ["due"] : startish && !endish ? ["start"] : endish && !startish ? ["end","close","finish","completion"] : null;
      if (want) {
        const dateCols = cols.filter(c => c.type === "date" && want.some(w => fuzzyTokens(c.label).includes(w)));
        if (dateCols.length === 1) return dateCols[0].key;
      }
    }
    const lc = vals.map(v => v.toLowerCase());
    const optCols = cols.filter(c => c.opts && c.opts.length > 0 && lc.every(v => c.opts!.some(o => o.toLowerCase() === v)));
    if (optCols.length === 1) return optCols[0].key;
  }
  return undefined;
}

// ── Sample data ───────────────────────────────────────────────────────────

// FRESH_START: when true the import grid ALWAYS opens on the clean template
// (the 2 read-only example rows + blank entry rows) for every module — a
// previously loaded file and unsent typed drafts are NOT restored on a
// revisit. Flip to false to bring the old restore behaviour back.
const FRESH_START_ALWAYS = true;
const empty = (cols: ColDef[]): Row => Object.fromEntries(cols.map(c => [c.key, ""]));

const SAMPLE_PROJECTS: Row[] = [
  { companyName:"Metro Transit Authority",   projectTitle:"Downtown Rail Extension — Phase 2",  projectId:"PMM-2024-0412", shortName:"Rail Ext Ph2",    marketSector:"Transportation", projectType:"New Construction",  serviceType:"Construction Management", category:"Active", businessUnit:"Civil & Transit",    division:"Infrastructure", department:"Rail",        status:"Active",   startDate:"2024-03-01", endDate:"2026-09-30", closeoutDate:"2026-10-31", contractValue:"48500000", laborBudget:"18000000", grossMargin:"7275000",  contractType:"GMP",      feePct:"15", contingency:"1200000", pctComplete:"35", priority:"High",   ownerName:"City Rail Authority",      nextMilestone:"TBM Launch",          nextMilestoneDate:"2024-08-15", city:"San Francisco", state:"CA", streetAddress:"400 Rail Blvd",       office:"San Francisco", description:"Heavy-rail extension connecting downtown to the Northside interchange — three TBM drives totalling 3.2 km." },
  { companyName:"City General Hospital",     projectTitle:"Surgical Wing Expansion",            projectId:"PMM-2024-0530", shortName:"CGH Surg Wing",   marketSector:"Healthcare",     projectType:"Addition",         serviceType:"Architecture",           category:"Active", businessUnit:"Healthcare Studio",  division:"Healthcare",     department:"Design",     status:"Active",   startDate:"2024-06-15", endDate:"2025-12-31", closeoutDate:"2026-01-15", contractValue:"22750000", laborBudget:"8500000",  grossMargin:"3412500",  contractType:"Fixed",    feePct:"15", contingency:"680000",  pctComplete:"20", priority:"High",   ownerName:"City Health Board",        nextMilestone:"Structural Steel",    nextMilestoneDate:"2024-11-01", city:"Riverside",     state:"CA", streetAddress:"150 Hospital Ave",    office:"Los Angeles",   description:"New 48-bed surgical wing with four OR suites, sterile processing core, and rooftop mechanical." },
  { companyName:"Westside School District",  projectTitle:"Westside K-8 Campus Rebuild",        projectId:"PMM-2024-0718", shortName:"WSD K-8 Rebuild", marketSector:"Education",      projectType:"Reconstruction",   serviceType:"Architecture",           category:"Active", businessUnit:"Buildings",          division:"Education",      department:"K-12",       status:"Active",   startDate:"2024-08-01", endDate:"2026-06-30", closeoutDate:"2026-07-31", contractValue:"31200000", laborBudget:"11000000", grossMargin:"4680000",  contractType:"Fixed",    feePct:"15", contingency:"936000",  pctComplete:"12", priority:"Medium", ownerName:"District Facilities Dept", nextMilestone:"CD Approval",         nextMilestoneDate:"2024-12-01", city:"Oakland",       state:"CA", streetAddress:"2200 Westside Ave",   office:"San Francisco", description:"Full campus rebuild for 850-student K-8 school including gymnasium, media center, and STEM labs." },
  { companyName:"Harbor Realty Group",       projectTitle:"Harbor Waterfront Mixed-Use Tower",  projectId:"PMM-2024-0865", shortName:"Harbor MU Tower", marketSector:"Real Estate",    projectType:"New Construction",  serviceType:"Architecture",           category:"Active", businessUnit:"Buildings",          division:"Commercial",     department:"Development",status:"Active",   startDate:"2025-02-01", endDate:"2027-08-31", closeoutDate:"2027-09-30", contractValue:"74000000", laborBudget:"27000000", grossMargin:"11100000", contractType:"GMP",      feePct:"15", contingency:"2220000", pctComplete:"5",  priority:"High",   ownerName:"Harbor Development Corp",  nextMilestone:"Permit Approval",     nextMilestoneDate:"2025-01-31", city:"San Diego",     state:"CA", streetAddress:"1 Harbor Way",        office:"San Diego",     description:"Mixed-use tower: 240 residential units, ground-floor retail, structured parking garage, and rooftop amenity deck." },
  { companyName:"Summit Energy Partners",    projectTitle:"Summit Solar Operations Hub",        projectId:"PMM-2025-0102", shortName:"Summit Solar Hub", marketSector:"Energy",         projectType:"New Construction",  serviceType:"Engineering",            category:"Active", businessUnit:"Civil & Transit",    division:"Energy",         department:"Renewables", status:"Active",   startDate:"2025-04-01", endDate:"2026-12-31", closeoutDate:"2027-01-31", contractValue:"19500000", laborBudget:"7200000",  grossMargin:"2925000",  contractType:"T&M",      feePct:"15", contingency:"585000",  pctComplete:"0",  priority:"Medium", ownerName:"Summit Capital LLC",       nextMilestone:"Geotechnical Report", nextMilestoneDate:"2025-05-15", city:"Phoenix",       state:"AZ", streetAddress:"8800 Desert Sun Pkwy",office:"Phoenix",       description:"Operations and maintenance hub for 180 MW solar farm including control room, battery storage building, and access roads." },
];
const SAMPLE_STAFF: Row[] = [
  { st_name:"James Okafor",    st_email:"james.okafor@rmone.com",    st_businessUnit:"Buildings",          st_division:"Commercial",      st_department:"Design",      st_role:"Senior Architect",    st_jobTitle:"Lead Architect",  st_manager:"elena.rodriguez@rmone.com", st_accessLevel:"Manager", st_startDate:"2022-06-01", st_groups:"PMO; Design Leads" },
  { st_name:"Priya Sharma",    st_email:"priya.sharma@rmone.com",    st_businessUnit:"Civil & Transit",    st_division:"Infrastructure",  st_department:"Structural",  st_role:"Structural Engineer", st_jobTitle:"Engineer II",     st_manager:"sarah.mitchell@rmone.com",  st_accessLevel:"User",    st_startDate:"2023-01-15", st_endDate:"2026-12-31" },
  { st_name:"Sarah Mitchell",  st_email:"sarah.mitchell@rmone.com",  st_businessUnit:"Civil & Transit",    st_division:"Infrastructure",  st_department:"Rail",        st_role:"Project Manager",     st_jobTitle:"Senior PM",       st_manager:"elena.rodriguez@rmone.com", st_accessLevel:"Manager", st_startDate:"2021-03-10" },
  { st_name:"Tom Williams",    st_email:"tom.williams@rmone.com",    st_businessUnit:"Healthcare Studio",  st_division:"Healthcare",      st_department:"Design",      st_role:"Project Manager",     st_jobTitle:"PM",              st_manager:"elena.rodriguez@rmone.com", st_accessLevel:"Manager", st_startDate:"2020-09-01" },
  { st_name:"Elena Rodriguez", st_email:"elena.rodriguez@rmone.com", st_businessUnit:"Buildings",          st_division:"Commercial",      st_department:"Development", st_role:"Principal",           st_jobTitle:"Principal",       st_accessLevel:"Admin",   st_startDate:"2019-07-22", st_groups:"Leadership" },
];
const SAMPLE_OPP: Row[] = [
  { opp_title:"Harbor District Mixed-Use Development", opp_company:"Harbor Realty Group",          opp_contact:"Mike Torres",  opp_stage:"Proposal",    opp_chance:"60", opp_sector:"Real Estate",    opp_bu:"Buildings",          opp_division:"Commercial",     opp_dept:"Development", opp_targetStart:"2026-01-01", opp_targetEnd:"2027-06-30", opp_approxValue:"31500000", opp_costEst:"22000000", opp_laborAmt:"9500000",  opp_nonOpCost:"850000",  opp_margin:"30", opp_contractType:"GMP",      opp_poc:"James Okafor",    opp_status:"Active", opp_office:"San Diego",       opp_description:"Mixed-use tower: retail podium, 200 residential units, structured parking, and rooftop amenity." },
  { opp_title:"Regional Airport Concourse Expansion",  opp_company:"Metro Airport Authority",      opp_contact:"Lisa Park",    opp_stage:"Negotiation", opp_chance:"80", opp_sector:"Aviation",       opp_bu:"Civil & Transit",    opp_division:"Infrastructure", opp_dept:"Airside",     opp_targetStart:"2025-10-01", opp_targetEnd:"2027-03-31", opp_approxValue:"67000000", opp_costEst:"50000000", opp_laborAmt:"24000000", opp_nonOpCost:"1750000", opp_margin:"25", opp_contractType:"Cost-Plus", opp_poc:"Priya Sharma",    opp_status:"Active", opp_office:"San Francisco",   opp_description:"Expansion of Concourse D with 12 new gate hold rooms, consolidated security checkpoint, and retail." },
  { opp_title:"University Science Complex",            opp_company:"State University Foundation",  opp_contact:"Dr. Maria Lee", opp_stage:"Proposal",   opp_chance:"55", opp_sector:"Education",      opp_bu:"Buildings",          opp_division:"Education",      opp_dept:"Higher Ed",   opp_targetStart:"2026-06-01", opp_targetEnd:"2028-12-31", opp_approxValue:"52000000", opp_costEst:"38000000", opp_laborAmt:"15000000", opp_nonOpCost:"1200000", opp_margin:"27", opp_contractType:"Fixed",    opp_poc:"Elena Rodriguez", opp_status:"Active", opp_office:"San Francisco",   opp_description:"New 4-building science complex: wet labs, imaging suite, vivarium, and 200-seat lecture hall." },
  { opp_title:"Riverside Data Center Campus",          opp_company:"CloudCore Inc.",               opp_contact:"Alan Brent",   opp_stage:"Prospecting", opp_chance:"35", opp_sector:"Technology",     opp_bu:"Civil & Transit",    opp_division:"Infrastructure", opp_dept:"MEP",         opp_targetStart:"2026-09-01", opp_targetEnd:"2028-06-30", opp_approxValue:"89000000", opp_costEst:"65000000", opp_laborAmt:"28000000", opp_nonOpCost:"2500000", opp_margin:"28", opp_contractType:"GMP",      opp_poc:"Tom Williams",    opp_status:"Active", opp_office:"Phoenix",         opp_description:"Two-phase hyperscale data center: 40 MW Phase 1 shell and core, with shell-and-core only for Phase 2." },
  { opp_title:"Downtown Medical Office Tower",         opp_company:"HealthFirst Properties",       opp_contact:"Karen Novak",  opp_stage:"Qualifying",  opp_chance:"45", opp_sector:"Healthcare",     opp_bu:"Healthcare Studio",  opp_division:"Healthcare",     opp_dept:"Medical",     opp_targetStart:"2026-08-01", opp_targetEnd:"2028-03-31", opp_approxValue:"44500000", opp_costEst:"33000000", opp_laborAmt:"13500000", opp_nonOpCost:"990000",  opp_margin:"26", opp_contractType:"Fixed",    opp_poc:"Sarah Mitchell",  opp_status:"Active", opp_office:"Los Angeles",     opp_description:"18-story medical office tower with full imaging floor, ambulatory surgery center, and below-grade parking." },
];
const SAMPLE_LEADS: Row[] = [
  { ld_name:"Westside Community Health Center Renovation", ld_id:"EX-LD-0001", ld_company:"Westside Health Network",           ld_contact:"Sarah Kim",      ld_stage:"Prospecting", ld_status:"Active",   ld_sector:"Healthcare",     ld_bu:"Healthcare Studio", ld_division:"Healthcare",     ld_targetStart:"2026-03-01", ld_targetEnd:"2027-06-30", ld_value:"8500000",  ld_desc:"Renovation of existing outpatient clinic across 3 buildings — seismic upgrade and MEP replacement.", ld_note:"Initial inquiry from CFO; budget pre-approved. Pursuing sole-source." },
  { ld_name:"Downtown Office Tower Retrofit",              ld_id:"EX-LD-0002", ld_company:"Nexus Properties LLC",              ld_contact:"Mike Torres",    ld_stage:"Qualifying",  ld_status:"Active",   ld_sector:"Commercial",     ld_bu:"Buildings",         ld_division:"Commercial",     ld_targetStart:"2026-06-01", ld_targetEnd:"2027-09-30", ld_value:"14200000", ld_desc:"Energy-efficiency retrofit across 22 floors: curtain wall replacement, HVAC, and LED lighting.",     ld_note:"RFP expected Q4; need to confirm scope with PM before bid submission." },
  { ld_name:"City Park Recreation Complex",                ld_id:"EX-LD-0003", ld_company:"City Parks & Recreation Dept",      ld_contact:"Brian Walsh",    ld_stage:"Prospecting", ld_status:"Active",   ld_sector:"Government",     ld_bu:"Buildings",         ld_division:"Civic",          ld_targetStart:"2026-04-01", ld_targetEnd:"2027-10-31", ld_value:"12800000", ld_desc:"New aquatic center, multi-use courts, and community meeting rooms on 4-acre park site.",            ld_note:"Bond measure funded. Awaiting council approval of scope." },
  { ld_name:"Industrial Logistics Center",                 ld_id:"EX-LD-0004", ld_company:"WestPac Freight LLC",               ld_contact:"Dana Cruz",      ld_stage:"Qualifying",  ld_status:"Active",   ld_sector:"Industrial",     ld_bu:"Civil & Transit",   ld_division:"Industrial",     ld_targetStart:"2026-07-01", ld_targetEnd:"2027-12-31", ld_value:"22400000", ld_desc:"500,000 sq ft cross-dock logistics facility with truck court, rail spur, and driver amenity building.", ld_note:"Design-build preferred. Fast-track schedule; need PE sub locked in by RFP." },
  { ld_name:"Community College Performing Arts Center",    ld_id:"EX-LD-0005", ld_company:"Bay Area Community College District", ld_contact:"Prof. Lin Zhao", ld_stage:"Prospecting", ld_status:"Active",   ld_sector:"Education",      ld_bu:"Buildings",         ld_division:"Education",      ld_targetStart:"2026-09-01", ld_targetEnd:"2028-05-31", ld_value:"34000000", ld_desc:"750-seat concert hall, 200-seat black box theatre, rehearsal studios, and music faculty offices.",   ld_note:"Prop 39 bond. Acoustical consultant required for shortlist." },
];
const SAMPLE_COMPANIES: Row[] = [
  { co_name:"Metro Transit Authority",   co_sector:"Transportation", co_health:"Good",      co_contact:"Sandra Kim",      co_email:"s.kim@mta.gov",               co_title:"Director of Capital Projects", co_phone:"(415) 555-0101", co_city:"San Francisco", co_state:"CA", co_address:"400 Rail Blvd",       co_rep:"Sarah Mitchell",  co_division:"Infrastructure" },
  { co_name:"City General Hospital",     co_sector:"Healthcare",     co_health:"Good",      co_contact:"Dr. Lee Chen",    co_email:"l.chen@citygeneral.org",       co_title:"VP Facilities",                co_phone:"(951) 555-0188", co_city:"Riverside",     co_state:"CA", co_address:"150 Hospital Ave",    co_rep:"Tom Williams",    co_division:"Healthcare"     },
  { co_name:"Westside School District",  co_sector:"Education",      co_health:"Good",      co_contact:"Rachel Torres",   co_email:"r.torres@westsideusd.edu",     co_title:"Director of Facilities",       co_phone:"(510) 555-0234", co_city:"Oakland",       co_state:"CA", co_address:"2200 Westside Ave",   co_rep:"James Okafor",    co_division:"Education"      },
  { co_name:"Harbor Realty Group",       co_sector:"Real Estate",    co_health:"At Risk",   co_contact:"Mike Torres",     co_email:"m.torres@harborgroup.com",     co_title:"VP Development",               co_phone:"(619) 555-0177", co_city:"San Diego",     co_state:"CA", co_address:"1 Harbor Way",        co_rep:"Elena Rodriguez", co_division:"Commercial"     },
  { co_name:"Summit Energy Partners",    co_sector:"Energy",         co_health:"Good",      co_contact:"Greg Walsh",      co_email:"g.walsh@summitenergy.com",     co_title:"Director of Engineering",      co_phone:"(602) 555-0392", co_city:"Phoenix",       co_state:"AZ", co_address:"8800 Desert Sun Pkwy",co_rep:"Priya Sharma",    co_division:"Energy"         },
];
const SAMPLE_ASG: Row[] = [
  { asg_project:"Downtown Rail Extension — Phase 2", asg_projectId:"PMM-2024-0412", asg_name:"Sarah Mitchell",  asg_email:"sarah.mitchell@rmone.com",  asg_startDate:"2024-03-01", asg_endDate:"2026-09-30", asg_totalHours:"3200", asg_type:"Hard", asg_role:"Project Manager",     asg_jobTitle:"Senior PM",      asg_businessUnit:"Civil & Transit",    asg_division:"Infrastructure", asg_department:"Rail",        asg_billingRate:"200" },
  { asg_project:"Surgical Wing Expansion",           asg_projectId:"PMM-2024-0530", asg_name:"Tom Williams",    asg_email:"tom.williams@rmone.com",    asg_startDate:"2024-06-15", asg_endDate:"2025-12-31", asg_totalHours:"3500", asg_type:"Hard", asg_role:"Project Manager",     asg_jobTitle:"PM",             asg_businessUnit:"Healthcare Studio",  asg_division:"Healthcare",     asg_department:"Design",      asg_billingRate:"200" },
  { asg_project:"Westside K-8 Campus Rebuild",       asg_projectId:"PMM-2024-0718", asg_name:"James Okafor",    asg_email:"james.okafor@rmone.com",    asg_startDate:"2024-08-01", asg_endDate:"2026-06-30", asg_totalHours:"2800", asg_type:"Hard", asg_role:"Senior Architect",    asg_jobTitle:"Lead Architect", asg_businessUnit:"Buildings",          asg_division:"Commercial",     asg_department:"Design",      asg_billingRate:"185" },
  { asg_project:"Harbor Waterfront Mixed-Use Tower", asg_projectId:"PMM-2024-0865", asg_name:"Elena Rodriguez", asg_email:"elena.rodriguez@rmone.com", asg_startDate:"2025-02-01", asg_endDate:"2027-08-31", asg_totalHours:"4200", asg_type:"Hard", asg_role:"Principal",           asg_jobTitle:"Principal",      asg_businessUnit:"Buildings",          asg_division:"Commercial",     asg_department:"Development", asg_billingRate:"225" },
  { asg_project:"Summit Solar Operations Hub",       asg_projectId:"PMM-2025-0102", asg_name:"Priya Sharma",    asg_email:"priya.sharma@rmone.com",    asg_startDate:"2025-04-01", asg_endDate:"2026-12-31", asg_totalHours:"2400", asg_type:"Hard", asg_role:"Structural Engineer", asg_jobTitle:"Engineer II",    asg_businessUnit:"Civil & Transit",    asg_division:"Infrastructure", asg_department:"Structural",  asg_billingRate:"155" },
];
const SAMPLE_SCH: Row[] = [
  { sch_project:"Downtown Rail Extension — Phase 2", sch_projectId:"PMM-2024-0412", sch_phaseName:"Pre-Construction & Mobilisation", sch_phaseOrder:"1", sch_startDate:"2024-01-15", sch_endDate:"2024-02-29", sch_duration:"46",  sch_milestone:"Yes", sch_pctComplete:"100", sch_notes:"Site investigation, utility surveys, permit acquisition" },
  { sch_project:"Downtown Rail Extension — Phase 2", sch_projectId:"PMM-2024-0412", sch_phaseName:"Foundation & Tunnel Boring",      sch_phaseOrder:"2", sch_startDate:"2024-03-01", sch_endDate:"2025-04-30", sch_duration:"427", sch_milestone:"Yes", sch_pctComplete:"65",  sch_notes:"Three TBM drives; 3.2 km combined bore length" },
  { sch_project:"Surgical Wing Expansion",           sch_projectId:"PMM-2024-0530", sch_phaseName:"Structural Frame",                sch_phaseOrder:"1", sch_startDate:"2024-09-01", sch_endDate:"2024-12-31", sch_duration:"122", sch_milestone:"Yes", sch_pctComplete:"100", sch_notes:"Steel erection complete; concrete decks in progress" },
  { sch_project:"Surgical Wing Expansion",           sch_projectId:"PMM-2024-0530", sch_phaseName:"MEP Rough-In & Fit-Out",          sch_phaseOrder:"2", sch_startDate:"2025-01-01", sch_endDate:"2025-08-31", sch_duration:"242", sch_milestone:"No",  sch_pctComplete:"15",  sch_notes:"Medical gas, HVAC, and electrical rough-in" },
  { sch_project:"Westside K-8 Campus Rebuild",       sch_projectId:"PMM-2024-0718", sch_phaseName:"Schematic Design",               sch_phaseOrder:"1", sch_startDate:"2024-08-01", sch_endDate:"2024-12-15", sch_duration:"137", sch_milestone:"Yes", sch_pctComplete:"80",  sch_notes:"Community engagement meetings scheduled for October" },
  { sch_project:"Harbor Waterfront Mixed-Use Tower", sch_projectId:"PMM-2024-0865", sch_phaseName:"Pre-Construction & Permits",      sch_phaseOrder:"1", sch_startDate:"2025-02-01", sch_endDate:"2025-06-30", sch_duration:"149", sch_milestone:"Yes", sch_pctComplete:"10",  sch_notes:"Coastal Commission submittal due March; geotechnical complete" },
  { sch_project:"Summit Solar Operations Hub",       sch_projectId:"PMM-2025-0102", sch_phaseName:"Site Investigation & Design",     sch_phaseOrder:"1", sch_startDate:"2025-04-01", sch_endDate:"2025-09-30", sch_duration:"183", sch_milestone:"Yes", sch_pctComplete:"0",   sch_notes:"Geotechnical, environmental baseline, and 30% design" },
];
const SAMPLE_ASG_OPP: Row[] = [
  { asg_project:"Harbor District Mixed-Use Development", asg_name:"James Okafor",    asg_email:"james.okafor@rmone.com",    asg_startDate:"2026-01-01", asg_endDate:"2027-06-30", asg_totalHours:"3120", asg_type:"Soft", asg_role:"Senior Architect",    asg_jobTitle:"Lead Architect", asg_businessUnit:"Buildings",          asg_division:"Commercial",     asg_department:"Design",      asg_billingRate:"185" },
  { asg_project:"Regional Airport Concourse Expansion",  asg_name:"Priya Sharma",    asg_email:"priya.sharma@rmone.com",    asg_startDate:"2025-10-01", asg_endDate:"2027-03-31", asg_totalHours:"3900", asg_type:"Soft", asg_role:"Structural Engineer", asg_jobTitle:"Engineer II",    asg_businessUnit:"Civil & Transit",    asg_division:"Infrastructure", asg_department:"Structural",  asg_billingRate:"155" },
  { asg_project:"University Science Complex",            asg_name:"Elena Rodriguez", asg_email:"elena.rodriguez@rmone.com", asg_startDate:"2026-06-01", asg_endDate:"2028-12-31", asg_totalHours:"4400", asg_type:"Soft", asg_role:"Principal",           asg_jobTitle:"Principal",      asg_businessUnit:"Buildings",          asg_division:"Education",      asg_department:"Design",      asg_billingRate:"225" },
  { asg_project:"Riverside Data Center Campus",          asg_name:"Tom Williams",    asg_email:"tom.williams@rmone.com",    asg_startDate:"2026-09-01", asg_endDate:"2028-06-30", asg_totalHours:"2800", asg_type:"Soft", asg_role:"Project Manager",     asg_jobTitle:"PM",             asg_businessUnit:"Civil & Transit",    asg_division:"Infrastructure", asg_department:"MEP",         asg_billingRate:"200" },
  { asg_project:"Downtown Medical Office Tower",         asg_name:"Sarah Mitchell",  asg_email:"sarah.mitchell@rmone.com",  asg_startDate:"2026-08-01", asg_endDate:"2028-03-31", asg_totalHours:"3200", asg_type:"Soft", asg_role:"Project Manager",     asg_jobTitle:"Senior PM",      asg_businessUnit:"Healthcare Studio",  asg_division:"Healthcare",     asg_department:"Medical",     asg_billingRate:"200" },
];
const SAMPLE_SCH_OPP: Row[] = [
  { sch_project:"Harbor District Mixed-Use Development", sch_phaseName:"Schematic Design",           sch_phaseOrder:"1", sch_startDate:"2026-01-01", sch_endDate:"2026-06-30", sch_duration:"180", sch_milestone:"Yes", sch_pctComplete:"0", sch_notes:"Subject to contract award; coastal entitlement required" },
  { sch_project:"Regional Airport Concourse Expansion",  sch_phaseName:"Design Development",         sch_phaseOrder:"1", sch_startDate:"2025-10-01", sch_endDate:"2026-06-30", sch_duration:"273", sch_milestone:"Yes", sch_pctComplete:"0", sch_notes:"FAA Part 77 airspace review concurrent with DD" },
  { sch_project:"University Science Complex",            sch_phaseName:"Pre-Design & Programming",   sch_phaseOrder:"1", sch_startDate:"2026-06-01", sch_endDate:"2026-12-31", sch_duration:"213", sch_milestone:"Yes", sch_pctComplete:"0", sch_notes:"Lab programming with department heads; BSL-2 containment required" },
  { sch_project:"Riverside Data Center Campus",          sch_phaseName:"Site Assessment & Concept",  sch_phaseOrder:"1", sch_startDate:"2026-09-01", sch_endDate:"2027-03-31", sch_duration:"212", sch_milestone:"Yes", sch_pctComplete:"0", sch_notes:"Utility capacity study and grid interconnect assessment" },
  { sch_project:"Downtown Medical Office Tower",         sch_phaseName:"Concept Design",             sch_phaseOrder:"1", sch_startDate:"2026-08-01", sch_endDate:"2027-01-31", sch_duration:"183", sch_milestone:"Yes", sch_pctComplete:"0", sch_notes:"Certificate of Need filing with state health dept by Oct 2026" },
];

// ── Parsed file structures ────────────────────────────────────────────────
interface ParsedSheet { name: string; headers: string[]; rows: Row[]; }


// Per-tab file state after classification
interface TabFileState {
  headers: string[];                // file column headers assigned to this tab
  rows: Row[];                      // file rows from sheets classified to this tab
  mappings: Record<string, string>; // fileHeader → ColDef.key | SKIP (no dups within tab)
  colOrder: string[];               // current display order of headers
  fixedValues: Record<string, string>;   // templateKey → user-typed static value (all rows)
  cellOverrides: Record<number, Record<string, string>>; // rowIdx → templateKey → edited value
}

// ── Same-name project clash helpers ───────────────────────────────────────
// Two main-tab rows with the SAME title but DIFFERENT IDs are either two real
// jobs that share a name, or the same job entered twice. The review view shows
// one "name clash" card per title so the user settles it once: keep both
// (legit) or keep only one — the other row leaves THIS import only; nothing is
// ever deleted from the database.
const normProjName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const CLASH_KEY_PREFIX = "clash:";

interface ClashEntry { id: string; rowNum: number; preview: [string, string][]; held?: HeldRow }
interface ClashGroup { key: string; title: string; entries: ClashEntry[] }

// ── Near-duplicate PAIR grouping ("Possible duplicate" cards) ───────────────
// The cleaning engine flags near-identical project names in BOTH directions
// (row A gets "copy of B", row B gets "copy of A"), so one pair used to render
// as two disconnected notice cards. These types group the flags back into ONE
// card per family so the user makes a single decision: keep one / keep all /
// remove all. Every member row is ALSO in the main grid (the flags are
// informational copies), so "remove" acts on the grid rows by project ID.
interface DupMember { id: string; title: string; srcRow?: string; held?: HeldRow }
interface DupGroup { key: string; tabId: string; tabLabel: string; members: DupMember[] }
const DUP_GROUP_KEY_PREFIX = "dupgrp:"; // stored inside the clash:* namespace to reuse removeIds replay

// Resolve the file header that feeds a template column: cleaned files use the
// exact template label as the header; fall back through the mapping table.
function headerForKey(ts: TabFileState, label: string, key: string): string | undefined {
  return ts.colOrder.find(h => ts.mappings[h] === key)
    ?? ts.colOrder.find(h => h.trim().toLowerCase() === label.toLowerCase());
}

// Drop main-tab rows whose effective ID is in removeIds, re-indexing
// cellOverrides (keyed by row position) so remaining grid edits stay aligned.
function removeRowsById(ts: TabFileState, idHeader: string, idKey: string, removeIds: Set<string>): TabFileState {
  const keep: Row[] = [];
  const overrides: Record<number, Record<string, string>> = {};
  ts.rows.forEach((r, i) => {
    const ov = ts.cellOverrides?.[i];
    const effId = String(ov?.[idKey] ?? r[idHeader] ?? "").trim();
    if (removeIds.has(effId)) return;
    if (ov) overrides[keep.length] = ov;
    keep.push(r);
  });
  return { ...ts, rows: keep, cellOverrides: overrides };
}

// Rewrite rows whose effective ID is in fromIds to carry toId instead —
// used when a name clash is settled so child tabs (Team Assignments /
// Schedule) never keep pointing at an ID that just left the Projects tab.
function remapRowIds(ts: TabFileState, idHeader: string, idKey: string, fromIds: Set<string>, toId: string): TabFileState {
  let changed = false;
  const overrides: Record<number, Record<string, string>> = { ...(ts.cellOverrides ?? {}) };
  ts.rows.forEach((r, i) => {
    const ov = overrides[i];
    const effId = String(ov?.[idKey] ?? r[idHeader] ?? "").trim();
    if (!fromIds.has(effId)) return;
    overrides[i] = { ...(ov ?? {}), [idKey]: toId };
    changed = true;
  });
  return changed ? { ...ts, cellOverrides: overrides } : ts;
}

// Marker key stamped onto rows added manually via "Add Row" in file mode.
// Never collides with real file headers, is not in colOrder/mappings so it
// never reaches the submitted data, and lets the main-tab strong-field filter
// keep blank manual rows visible while the user types into them.
const MANUAL_ROW_KEY = "__rmManualRow";

// ── Data-Cleaning review sheets ───────────────────────────────────────────
// The cleaning engine quarantines problem rows on per-tab review sheets named
// "<Tab> — Review" (exact template columns + a "Remarks" column). Those rows
// must NEVER be classified into the grid silently — their columns mirror the
// real template, so content scoring would route them straight into the main
// tab. They are partitioned out before classification and shown in the
// "Needs attention" panel, where the user fixes each row and adds it back.
const REVIEW_SHEET_RE = /\s*[—–-]+\s*review\s*$/i;

interface HeldRow {
  id: number;
  /** Stable decision key — "<tabId>:<source row>" (ordinal fallback) — used
   *  to persist and replay review-view decisions across page refreshes. */
  dKey: string;
  tabId: string;
  tabLabel: string;
  cells: Row;      // template-label keyed — review sheets mirror template columns
  remarks: string; // why the cleaning engine held this row back
  srcRow?: string;    // row number in the user's ORIGINAL uploaded file ("Source Row" col)
  matchedId?: string; // ID(s) this row collided with / could belong to ("Matched ID" col)
  // Projects added from the Projects tab AFTER cleaning ran — offered as extra
  // pickable candidates on assignment/schedule cards that mention their name.
  // (srcRow only exists on engine-parsed candidates, never on these.)
  extraCands?: { id: string; title: string; srcRow?: string }[];
}
let heldRowSeq = 0;

// Minimal shape of the data-cleaning report the grid needs to summarize a run
// (mirrors the backend CleaningReport — only the fields used here).
interface CleaningReportLite {
  sheets?: {
    sourceSheet?: string;
    module: string | null;
    fixes: { dates: number; numbers: number; emails: number; idsFilled: number };
    duplicates: { exactRemoved: number; conflictsResolved: number };
    columnMap?: { source: string; target: string | null; method: string }[];
  }[];
  reviewCount?: number;
  droppedColumns?: DroppedColLite[];
}

// A source column the cleaning engine could not place anywhere (mirrors the
// backend's DroppedColumn). Surfaced in a panel so the user can pick the right
// destination and re-clean — silent column loss is never acceptable.
interface DroppedColLite {
  sourceSheet: string;   // sheet name in the user's original file
  tab: string;           // output tab the rest of the sheet landed on
  module: string;
  header: string;
  samples: string[];
  rows: number;          // rows with data in this column
}

interface DroppedInfo {
  cols: DroppedColLite[];
  /** Targets already used per source sheet + module (see takenKey) — the
   *  picker must not offer a destination another column already feeds. */
  taken: Record<string, string[]>;
}

// Key for DroppedInfo.taken: one source sheet can feed SEVERAL modules
// (split sheets), and template labels repeat across modules — so the taken
// set must be scoped to the (sheet, module) pair, never the sheet alone.
const takenKey = (sheet: string, module: string) =>
  `${sheet.trim().toLowerCase()}\u0000${module}`;

function parseDroppedInfo(report: CleaningReportLite): DroppedInfo | null {
  const cols = (report.droppedColumns ?? []).filter(d => d && d.header && d.module);
  if (!cols.length) return null;
  const taken: Record<string, string[]> = {};
  for (const s of report.sheets ?? []) {
    if (!s.sourceSheet || !s.columnMap) continue;
    // Keyed by sourceSheet + MODULE, merged — a split source sheet produces
    // several report entries with the SAME sourceSheet (one per output tab).
    // Keying by sheet alone either dropped units (overwrite) or pooled all
    // modules' targets together, blocking valid picks: template labels
    // repeat across modules ("Start Date" exists on Projects AND Team
    // Assignments), and a label filled on one tab is a legal home on another.
    const k = takenKey(s.sourceSheet, s.module ?? "");
    taken[k] = [
      ...(taken[k] ?? []),
      ...s.columnMap.filter(c => c.target).map(c => c.target as string),
    ];
  }
  return { cols, taken };
}

// Progress popup shown while an upload runs through the data-cleaning engine.
// Centered modal with a staged checklist: each stage has its own progress bar
// that lights up and pulses while active, then locks in green when done — so
// non-technical users can follow exactly what is happening.
const CLEANING_STAGES: { label: string; from: number }[] = [
  { label: "Reading your file",              from: 0  },
  { label: "Understanding your columns",     from: 12 },
  { label: "Fixing dates, numbers & emails", from: 30 },
  { label: "Removing duplicate rows",        from: 50 },
  { label: "Matching people to projects",    from: 68 },
  { label: "Preparing your grid",            from: 88 },
];
// Sentinel error messages so the retry loop can tell "user closed the popup"
// and "the run stopped making progress" apart from genuine engine failures.
const CLEAN_CANCELLED = "__clean_cancelled__";
const CLEAN_STALLED = "__clean_stalled__";
function CleaningPopup({ pct, msg, onCancel, onSkip, restore }: { pct: number; msg: string; onCancel: () => void; onSkip: () => void; restore?: boolean }) {
  // Restore mode — no cleaning is running; we're just re-downloading the
  // already-cleaned workbook after a refresh / back-navigation. Show a small
  // honest loader instead of replaying the full staged "Cleaning your data"
  // checklist, which reads as if the whole cleaning process started again.
  if (restore) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl border border-emerald-200 w-[380px] max-w-full overflow-hidden">
          <div className="px-6 py-5 flex items-center gap-3" style={{ background: "linear-gradient(135deg,#ecfdf5,#f0fdfa)" }}>
            <div className="w-11 h-11 rounded-xl bg-white border border-emerald-200 shadow-sm flex items-center justify-center shrink-0">
              <span className="w-5 h-5 rounded-full border-[2.5px] border-emerald-500 border-t-transparent animate-spin block" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-800 text-[15px] leading-tight">Loading your saved work</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{msg}</p>
            </div>
          </div>
          <div className="px-6 py-3 text-[10px] text-gray-400 text-center">
            Your file was already cleaned — this just picks up where you left off.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-emerald-200 w-[460px] max-w-full overflow-hidden">
        <div className="px-6 pt-5 pb-4 flex items-center gap-3" style={{ background: "linear-gradient(135deg,#ecfdf5,#f0fdfa)" }}>
          <div className="w-11 h-11 rounded-xl bg-white border border-emerald-200 shadow-sm flex items-center justify-center shrink-0">
            <span className="w-5 h-5 rounded-full border-[2.5px] border-emerald-500 border-t-transparent animate-spin block" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-800 text-[15px] leading-tight">Cleaning your data</p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{msg}</p>
          </div>
          <span className="text-lg font-bold text-emerald-600 tabular-nums shrink-0">{pct}%</span>
          <button onClick={onCancel} title="Stop cleaning — nothing will be loaded"
            className="ml-1 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-white/70 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-3">
          {CLEANING_STAGES.map((st, i) => {
            const next = CLEANING_STAGES[i + 1]?.from ?? 100;
            const done = pct >= next;
            const active = !done && pct >= st.from;
            const stagePct = done ? 100 : active ? Math.round(((pct - st.from) / (next - st.from)) * 100) : 0;
            return (
              <div key={st.label} className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold ${
                  done ? "bg-emerald-500 text-white" : active ? "bg-emerald-100 text-emerald-600 animate-pulse" : "bg-gray-100 text-gray-400"}`}>
                  {done ? "✓" : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] font-medium leading-none mb-1 ${done ? "text-gray-500" : active ? "text-emerald-700" : "text-gray-400"}`}>
                    {st.label}
                  </p>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        done ? "bg-emerald-500"
                          : active ? "bg-gradient-to-r from-emerald-300 via-emerald-500 to-emerald-300 bg-[length:200%_100%] animate-pulse"
                          : ""}`}
                      style={{ width: `${stagePct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-6 pb-3">
          <button onClick={onSkip}
            className="w-full py-2 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-600 hover:text-gray-800 transition-colors">
            Skip cleaning — load my file into the grid now
          </button>
        </div>
        <div className="px-6 pb-4 text-[10px] text-gray-400 text-center">
          Everything is fixed by exact rules — nothing is guessed. Rows we're not sure about are set aside for you to review.
          {" "}If it gets stuck it restarts by itself — press <span className="font-semibold text-gray-500">×</span> to stop, or skip cleaning above to keep going.
        </div>
      </div>
    </div>
  );
}

// Translate a cleaning-engine remark into plain, non-technical language.
// For ambiguous project names, the candidate IDs embedded in the remark
// ("CPR-18-000412 ("Russell Reynolds"), …") are parsed into clickable options.
interface FriendlyRemark {
  kind: "duplicate" | "ambiguous" | "notfound" | "noproject" | "missingid" | "other";
  title: string;
  body: string;
  candidates?: { id: string; title: string; srcRow?: string }[];
}
// Candidates arrive from the cleaning engine as `ID ("Title", row N)` — the
// row number is the OTHER side of the collision in the user's original file,
// so duplicate cards can show both row numbers. Older cleaned files (before
// row numbers were added) still match — the `, row N` part is optional.
const CANDIDATE_RE = /([\w./-]+)\s*\("([^"]*)"(?:,\s*row\s*(\d+))?\)/g;
function friendlyRemark(remarks: string): FriendlyRemark {
  const r = remarks ?? "";
  if (/^ALREADY on/i.test(r)) {
    // Pull the matched project(s) out of the remark — `ID ("Title")` pairs —
    // so the card can show exactly WHICH project this row looks like a copy of.
    const candidates: { id: string; title: string; srcRow?: string }[] = [];
    const dre = new RegExp(CANDIDATE_RE.source, "g");
    let dc: RegExpExecArray | null;
    while ((dc = dre.exec(r)) !== null) candidates.push({ id: dc[1], title: dc[2], srcRow: dc[3] || undefined });
    return {
      kind: "duplicate",
      title: "Possible duplicate — already in your grid",
      body: "This row looks like a copy of a project that is already loaded in the grid, so it won't be imported twice. Nothing to do — but if these are really two different jobs, give this one its own Project ID and add it.",
      candidates: candidates.length ? candidates : undefined,
    };
  }
  let m = r.match(/matches (\d+) projects — pick the right one: (.*?)(?:\. Type its ID|$)/i);
  if (m) {
    const candidates: { id: string; title: string; srcRow?: string }[] = [];
    const re = new RegExp(CANDIDATE_RE.source, "g");
    let c: RegExpExecArray | null;
    while ((c = re.exec(m[2])) !== null) candidates.push({ id: c[1], title: c[2], srcRow: c[3] || undefined });
    // Note: this is about the PROJECT named on the row, never the person —
    // one person can be on many projects. The card title names the project
    // explicitly so it can't be read as a complaint about the person's name.
    const projName = candidates[0]?.title;
    return {
      kind: "ambiguous",
      title: projName
        ? `Which "${projName}" project does this row belong to?`
        : `The project on this row matches ${m[1]} different projects in your file`,
      body: `Your Projects tab has ${m[1]} separate projects with this exact name, each with its own ID. This is only about picking the right project — one person can be on as many projects as needed. Pick the project this row belongs to and the ID fills in automatically:`,
      candidates,
    };
  }
  m = r.match(/No project called "(.*?)" exists/i);
  if (m) {
    return {
      kind: "notfound",
      title: "We couldn't find this project",
      body: `This row says it belongs to "${m[1]}", but there is no project with that name anywhere in your file. Check the spelling on your Projects tab, or type the correct Project ID below.`,
    };
  }
  if (/project column is blank/i.test(r)) {
    return {
      kind: "noproject",
      title: "No project named on this row",
      body: "This row doesn't say which project it belongs to. Type the Project ID it should go under, then add it.",
    };
  }
  m = r.match(/"([^"]+)" is blank and the import will not accept/i);
  if (m) {
    return {
      kind: "missingid",
      title: `Missing ${m[1]}`,
      body: `Every row needs a ${m[1]} before it can be imported. Type it below, then add the row.`,
    };
  }
  return { kind: "other", title: "Held back for review", body: r };
}

// Columns that are STRONG signals for the schedule tab — unique to phase/timeline data.
const STRONG_SCH_KEYS = new Set([
  "sch_phaseName","sch_phaseOrder","sch_duration","sch_milestone",
]);
// Columns that are STRONG signals for the assignments tab — these are unique
// to staffing/allocation data and never appear on a project record.
const STRONG_ASG_KEYS = new Set([
  "asg_email","asg_totalHours","asg_pctAlloc","asg_role","asg_jobTitle",
  "asg_billingRate","asg_laborRate","asg_costRate",
  "asg_billedHours","asg_accessLevel",
]);
// Columns that are STRONG signals for the projects/main tab — unique to records,
// never on a team-assignment row.
// Also includes the prefixed keys used by single-tab cards (leads=ld_*, companies=co_*,
// staff=st_*, opportunities=opp_*) so uploaded files are never dropped with 0 strong hits.
const STRONG_PROJ_KEYS = new Set([
  // Project / opportunity cols (unprefixed)
  "companyName","projectId","shortName","marketSector","serviceType",
  "contractValue","laborBudget","grossMargin","contractType","contractedAmount",
  "proposalAmount","bidAmount","changeOrders","retainage","feePct","contingency",
  "totalProjectCost","pctComplete","priority","description","streetAddress","city","state","office",
  // Leads card (ld_* prefixed)
  "ld_name","ld_company","ld_stage","ld_sector","ld_value","ld_desc","ld_contact",
  // Companies card (co_* prefixed)
  "co_name","co_sector","co_email","co_health","co_contact","co_rep",
  // Staff / Team card (st_* prefixed)
  "st_name","st_email","st_role","st_jobTitle","st_accessLevel","st_businessUnit",
  // Opportunities card (opp_* prefixed)
  "opp_title","opp_company","opp_stage","opp_approxValue","opp_sector","opp_status","opp_pctComplete",
]);

// Weighted score: strong/exclusive columns score 3×, shared columns score 1×.
// Returns { total, strong } so callers can require at least one strong-key hit.
function sheetScore(ps: ParsedSheet, cols: ColDef[], strongKeys: Set<string>): { total: number; strong: number } {
  let total = 0; let strong = 0;
  for (const h of ps.headers) {
    // Sheet ROUTING stays exact-only: the fuzzy tier's ambiguity guard is
    // per-tab, so a header could fuzzy-match "uniquely" in two different
    // tabs and mis-route a whole sheet. Real files essentially always carry
    // at least one exact strong header ("Project Title", "Name", …).
    const k = autoMapToColDef(h, cols, { exactOnly: true });
    if (k !== SKIP) {
      const isStrong = strongKeys.has(k);
      total += isStrong ? 3 : 1;
      if (isStrong) strong++;
    }
  }
  return { total, strong };
}

// Classify all sheets → tab states for file mode.
// Sheets with ZERO strong-key matches for every tab are excluded — this
// prevents unrelated sheets from being merged into the wrong grid.
function classifyParsedSheets(sheets: ParsedSheet[], tabs: TabDef[], routedNames?: Set<string>): Record<string, TabFileState> {
  const mainTab = tabs[0];
  const asgTab  = tabs.find(t => t.id === "assignments");
  const schTab  = tabs.find(t => t.id === "schedule");

  // Build a name→tabId map for direct sheet-name matching (case-insensitive).
  // When the user uploads our own template the sheet names match exactly
  // ("Opportunities", "Team Assignments", "Schedule") — route them directly
  // without relying on column scoring so a "Stage" column can never mis-route
  // an Opportunities sheet into the Schedule tab.
  const nameToTabId: Map<string, string> = new Map();
  for (const tab of tabs) {
    nameToTabId.set(tab.sheetName.toLowerCase().trim(), tab.id);
  }

  const sheetTabIds: Map<ParsedSheet, string> = new Map();
  for (const ps of sheets) {
    // 1. Direct sheet-name match — highest priority, no scoring needed.
    const byName = nameToTabId.get(ps.name.toLowerCase().trim());
    if (byName) { sheetTabIds.set(ps, byName); continue; }

    // 2. Score-based routing for sheets with arbitrary names.
    const main = sheetScore(ps, mainTab.cols, STRONG_PROJ_KEYS);
    const asg  = asgTab ? sheetScore(ps, asgTab.cols, STRONG_ASG_KEYS) : { total: 0, strong: 0 };
    const sch  = schTab ? sheetScore(ps, schTab.cols, STRONG_SCH_KEYS) : { total: 0, strong: 0 };
    // Skip sheets with no strong-key match in ANY tab
    if (main.strong === 0 && asg.strong === 0 && sch.strong === 0) continue;
    // Route to the tab with the highest total score; ties break main < asg < sch
    let winner = mainTab.id;
    if (asg.total >= main.total && asg.strong > 0 && asgTab) winner = asgTab.id;
    if (sch.total > asg.total  && sch.strong > 0 && schTab)  winner = schTab.id;
    if (sch.total > main.total && sch.strong > 0 && schTab && sch.total >= asg.total) winner = schTab.id;
    sheetTabIds.set(ps, winner);
  }

  // Single-tab mode: prevent foreign sheets (team/schedule/etc.) from bleeding
  // into the main view by restricting which sheets contribute rows.
  // — If any sheet matched by name, drop all score-routed sheets.
  // — If no name match but multiple sheets scored in, keep only the best one.
  if (tabs.length === 1) {
    const nameMatched = sheets.filter(ps => nameToTabId.has(ps.name.toLowerCase().trim()));
    if (nameMatched.length > 0) {
      for (const ps of sheets) {
        if (!nameMatched.includes(ps)) sheetTabIds.delete(ps);
      }
    } else if (sheetTabIds.size > 1) {
      let best: ParsedSheet | null = null;
      let bestScore = 0;
      for (const ps of sheets) {
        if (!sheetTabIds.has(ps)) continue;
        const s = sheetScore(ps, mainTab.cols, STRONG_PROJ_KEYS);
        if (s.total > bestScore) { bestScore = s.total; best = ps; }
      }
      for (const ps of sheets) { if (ps !== best) sheetTabIds.delete(ps); }
    }
  }

  // Report which sheets actually landed in a tab — the caller's upload audit
  // counts every data-bearing column in a dropped sheet as "not taken".
  if (routedNames) {
    for (const ps of sheets) if (sheetTabIds.has(ps)) routedNames.add(ps.name);
  }

  const result: Record<string, TabFileState> = {};
  for (const tab of tabs) {
    const tabSheets = sheets.filter(ps => sheetTabIds.get(ps) === tab.id);
    // Collect headers unique to this tab (deduplicate across sheets)
    const seen = new Set<string>();
    const headers: string[] = [];
    for (const ps of tabSheets) for (const h of ps.headers) if (!seen.has(h)) { seen.add(h); headers.push(h); }
    // Flatten rows — strip gap-template hint rows (any cell starting with ★)
    const isHintRow = (r: Row) => Object.values(r).some(v => String(v ?? "").trimStart().startsWith("★"));
    const rows = tabSheets.flatMap(ps => ps.rows).filter(r => !isHintRow(r));
    // Build no-dup mappings. Data-bearing columns claim template columns
    // before empty ones — an empty "Target Start" must never block a filled
    // "Plan Start" from landing in Start Date (or hide that grid column from
    // the audit popup's remap dropdown).
    const dataHeaders = new Set(headers.filter(h => rows.some(r => String(r[h] ?? "").trim() !== "")));
    const mappings = buildNoDupMappings(headers, tab.cols, h => dataHeaders.has(h));
    // Only-"Title" files: re-route Title → Project when the data says it is
    // the project name, not a job title (see reRouteBareTitleByData).
    reRouteBareTitleByData(mappings, tab.cols, rows);
    result[tab.id] = { headers, rows, mappings, colOrder: [...headers], fixedValues: {}, cellOverrides: {} };
  }
  return result;
}

// ── Two-section team sheet merge ──────────────────────────────────────────
// Some Excel files have staff-definition rows (Name/Email/Role/JobTitle) in
// rows 1–N with no Project column, then project-assignment rows (Project/dates/
// Alloc%) in rows N+1–M with no Name/Email.  Detect this pattern and fill
// Name+Email on each assignment row by matching Role+JobTitle+Division+CostRate
// back to the person registry built from the staff rows.
function mergeTeamSections(ts: TabFileState): TabFileState {
  // Build inverse mapping: canonicalKey → first original header that maps to it
  const inv = new Map<string, string>();
  for (const [orig, canon] of Object.entries(ts.mappings)) {
    if (canon && canon !== SKIP && !inv.has(canon)) inv.set(canon, orig);
  }

  // Keys use the ColDef.key prefix conventions: asg_ for assignments, st_ for staff
  const nameH  = inv.get("asg_name")      ?? inv.get("st_name")       ?? null;
  const emailH = inv.get("asg_email")     ?? inv.get("st_email")      ?? null;
  const projH  = inv.get("asg_project")   ?? null;
  const roleH  = inv.get("asg_role")      ?? inv.get("st_role")       ?? null;
  const jtH    = inv.get("asg_jobTitle")  ?? inv.get("st_jobTitle")   ?? null;
  const divH   = inv.get("asg_division")  ?? inv.get("st_division")
              ?? inv.get("asg_businessUnit") ?? inv.get("st_businessUnit") ?? null;
  const costH  = inv.get("asg_costRate")  ?? null;

  // Need at least name/email to identify people, and project to identify assignments
  if ((!nameH && !emailH) || !projH) return ts;

  const hasIdentity = (row: Row) =>
    !!(nameH  && (row[nameH]  ?? "").trim().length > 0) ||
    !!(emailH && (row[emailH] ?? "").trim().length > 0);
  const hasProject = (row: Row) =>
    projH ? (row[projH] ?? "").trim().length > 0 : false;

  // Classify every row so we can auto-detect the file's layout.
  //  person → identity, no project (a staff-definition / roster row)
  //  assign → project, no identity (an assignment row missing its person)
  //  both   → identity AND project (a real assignment that also names the person)
  //  blank  → neither
  type Kind = "person" | "assign" | "both" | "blank";
  const kinds: Kind[] = ts.rows.map(row => {
    const id = hasIdentity(row);
    const pj = hasProject(row);
    if (id && pj) return "both";
    if (id)       return "person";
    if (pj)       return "assign";
    return "blank";
  });

  const personCount = kinds.filter(k => k === "person").length;
  const assignCount = kinds.filter(k => k === "assign").length;
  const bothCount   = kinds.filter(k => k === "both").length;

  // Nothing to fill (every project row already names its person, or there are no
  // assignment rows at all) → normal flat file, leave untouched.
  if (!assignCount || (personCount === 0 && bothCount === 0)) return ts;

  // Count contiguous "person" runs (blanks don't break a run; assign/both do).
  // A single run at the top/bottom ⇒ two-block layout. Multiple runs ⇒ grouped.
  let personRuns = 0;
  let inRun = false;
  for (const k of kinds) {
    if (k === "person") { if (!inRun) { personRuns++; inRun = true; } }
    else if (k === "assign" || k === "both") { inRun = false; }
  }

  const identityOf = (row: Row) => ({
    name:  nameH  ? (row[nameH]  ?? "") : "",
    email: emailH ? (row[emailH] ?? "") : "",
  });
  const fillIdentity = (row: Row, info: { name: string; email: string }): Row => {
    const updated = { ...row };
    if (nameH  && info.name  && !(row[nameH]  ?? "").trim()) updated[nameH]  = info.name;
    if (emailH && info.email && !(row[emailH] ?? "").trim()) updated[emailH] = info.email;
    return updated;
  };

  // ── Flat single-table file (no roster rows — every named row carries its own
  // project): NO forward-fill, ever. A blank Name/Email row there is ALWAYS an
  // OPEN POSITION (unfilled demand), even a single row whose Role/CostRate
  // happen to match the person above. User mandate — filling names onto open
  // positions silently assigns vacant slots to the wrong employee and creates
  // false exact-duplicate flags. Rows pass through unchanged and the server
  // imports the blank ones as ResourceUser-NULL demand rows (mirrors the
  // namedRowCarriesProject guard in expandTeamSheet).
  if (personCount === 0 && bothCount > 0) return ts;

  // ── Strategy A: person-grouped / indented layout → positional forward-fill ──
  // The person's identity sits on a roster/header row (no project data) and the
  // assignment rows beneath it inherit that person until the next person appears.
  // This is the most reliable link when roles repeat, so it wins whenever the
  // layout is genuinely grouped (multiple person runs). We deliberately do NOT
  // trigger on a single roster block that happens to contain one stray named
  // assignment row — that is a two-block file and belongs to key-match below.
  if (personRuns >= 2) {
    let current: { name: string; email: string } | null = null;
    const out: Row[] = [];
    ts.rows.forEach((row, i) => {
      const k = kinds[i];
      if (k === "person") { current = identityOf(row); return; }  // drop header rows
      if (k === "both")   { current = identityOf(row); out.push(row); return; }
      if (k === "assign" && current) { out.push(fillIdentity(row, current)); return; }
      out.push(row); // blank, or an assign row before any person → leave as-is
    });
    return { ...ts, rows: out };
  }

  // ── Strategy B: two-block layout → key-match by role + job title + div + rate ──
  // All staff-definition rows form one block, all assignment rows another. There is
  // no positional link, so match each assignment to a person by their shared columns,
  // most-specific → least-specific. Keys shared by two DIFFERENT people are ambiguous:
  // we remove them so those assignments stay blank (user can fix) instead of being
  // silently attributed to whichever person happened to be listed first.
  type PersonInfo = { name: string; email: string };
  const byRJDC = new Map<string, PersonInfo>();
  const byRJD  = new Map<string, PersonInfo>();
  const byRJ   = new Map<string, PersonInfo>();
  const ambRJDC = new Set<string>();
  const ambRJD  = new Set<string>();
  const ambRJ   = new Set<string>();
  const addKey = (map: Map<string, PersonInfo>, amb: Set<string>, key: string, info: PersonInfo) => {
    if (amb.has(key)) return;
    const prev = map.get(key);
    if (!prev) { map.set(key, info); return; }
    if (prev.name !== info.name || prev.email !== info.email) { map.delete(key); amb.add(key); }
  };

  ts.rows.forEach((pr, i) => {
    if (kinds[i] !== "person") return;
    const r  = roleH  ? (pr[roleH]  ?? "").toLowerCase().trim() : "";
    const jt = jtH    ? (pr[jtH]    ?? "").toLowerCase().trim() : "";
    const dv = divH   ? (pr[divH]   ?? "").toLowerCase().trim() : "";
    const cr = costH  ? (pr[costH]  ?? "").trim() : "";
    const info = identityOf(pr);
    if (!info.name && !info.email) return;
    addKey(byRJDC, ambRJDC, `${r}|${jt}|${dv}|${cr}`, info);
    addKey(byRJD,  ambRJD,  `${r}|${jt}|${dv}`,        info);
    addKey(byRJ,   ambRJ,   `${r}|${jt}`,               info);
  });

  const out: Row[] = [];
  ts.rows.forEach((row, i) => {
    if (kinds[i] === "person") return;          // drop staff-definition rows
    if (kinds[i] !== "assign") { out.push(row); return; }  // keep both/blank as-is

    const r  = roleH  ? (row[roleH]  ?? "").toLowerCase().trim() : "";
    const jt = jtH    ? (row[jtH]    ?? "").toLowerCase().trim() : "";
    const dv = divH   ? (row[divH]   ?? "").toLowerCase().trim() : "";
    const cr = costH  ? (row[costH]  ?? "").trim() : "";

    const info = byRJDC.get(`${r}|${jt}|${dv}|${cr}`)
              ?? byRJD.get (`${r}|${jt}|${dv}`)
              ?? byRJ.get  (`${r}|${jt}`);
    out.push(info ? fillIdentity(row, info) : row);
  });

  return { ...ts, rows: out };
}


// ── Built-in example rows ─────────────────────────────────────────────────
// The grid ALWAYS opens with 2 read-only "ghost" example rows rendered above
// the editable rows (they are NOT part of tmplData), and downloaded templates
// always include the same 2 rows per tab.
const EXAMPLE_ROW_COUNT = 2;
// Ghost-row Opportunity ID for the standalone cards' example rows. Lives in
// SAMPLE_STRONG_VALUES (below) so isBuiltinSampleRow strips it at submit.
const SAMPLE_OPP_TICKET_ID = "OPM-2026-0417";

function sampleRowsFor(cardId: string, tabId: string): Row[] {
  const isOpp = cardId === "opportunities";
  // Standalone Team Assignments / Schedule cards: the two example rows teach
  // the mixed-ID capability — one row references a Project (PMM-…), the
  // other an Opportunity (OPM-…). All sample IDs live in
  // SAMPLE_STRONG_VALUES so these ghost rows can never import as real data.
  if (cardId === "assignments" && tabId === "assignments") {
    return [
      { ...SAMPLE_ASG[0] },
      { ...SAMPLE_ASG_OPP[0], asg_projectId: SAMPLE_OPP_TICKET_ID },
    ];
  }
  if (cardId === "schedule" && tabId === "schedule") {
    return [
      { ...SAMPLE_SCH[0], sch_projectId: SAMPLE_ASG[0].asg_projectId },
      { ...SAMPLE_SCH_OPP[0], sch_projectId: SAMPLE_OPP_TICKET_ID },
    ];
  }
  const src =
    tabId === "assignments" ? (isOpp ? SAMPLE_ASG_OPP : SAMPLE_ASG) :
    tabId === "schedule"    ? (isOpp ? SAMPLE_SCH_OPP : SAMPLE_SCH) :
    cardId === "team"          ? SAMPLE_STAFF :
    isOpp                      ? SAMPLE_OPP :
    cardId === "leads"         ? SAMPLE_LEADS :
    cardId === "companies"     ? SAMPLE_COMPANIES :
    SAMPLE_PROJECTS;
  return src.slice(0, EXAMPLE_ROW_COUNT).map(r => ({ ...r }));
}

// Signatures that make sure the built-in example rows can NEVER be imported
// as real data (the server pipeline only guards @sample-demo-co.com rows —
// these grid samples are not covered there, so this client-side strip is the
// only guard). Value-based so it also works on header-keyed file rows from a
// re-uploaded template. STRONG values are unique to the sample data (emails,
// record IDs) — one hit marks the row. WEAK values (titles, names) could
// conceivably appear in real data, so they require 2+ hits in the same row.
const SAMPLE_STRONG_VALUES: Set<string> = (() => {
  const s = new Set<string>();
  const add = (v?: string) => { const t = (v ?? "").trim().toLowerCase(); if (t) s.add(t); };
  SAMPLE_PROJECTS.forEach(r => add(r.projectId));
  SAMPLE_STAFF.forEach(r => add(r.st_email));
  SAMPLE_LEADS.forEach(r => add(r.ld_id));
  SAMPLE_COMPANIES.forEach(r => add(r.co_email));
  [...SAMPLE_ASG, ...SAMPLE_ASG_OPP].forEach(r => { add(r.asg_email); add(r.asg_projectId); });
  [...SAMPLE_SCH, ...SAMPLE_SCH_OPP].forEach(r => add(r.sch_projectId));
  add(SAMPLE_OPP_TICKET_ID);
  return s;
})();
const SAMPLE_WEAK_VALUES: Set<string> = (() => {
  const s = new Set<string>();
  const add = (v?: string) => { const t = (v ?? "").trim().toLowerCase(); if (t) s.add(t); };
  SAMPLE_PROJECTS.forEach(r => { add(r.projectTitle); add(r.companyName); });
  SAMPLE_STAFF.forEach(r => add(r.st_name));
  SAMPLE_OPP.forEach(r => { add(r.opp_title); add(r.opp_company); add(r.opp_contact); });
  SAMPLE_LEADS.forEach(r => { add(r.ld_name); add(r.ld_company); add(r.ld_contact); });
  SAMPLE_COMPANIES.forEach(r => { add(r.co_name); add(r.co_contact); });
  [...SAMPLE_ASG, ...SAMPLE_ASG_OPP].forEach(r => { add(r.asg_name); add(r.asg_project); });
  [...SAMPLE_SCH, ...SAMPLE_SCH_OPP].forEach(r => { add(r.sch_project); add(r.sch_phaseName); });
  return s;
})();
// Known template keys that hold a record's unique ID. The regex alone
// misses opp_erpJob (ends in "Job") and st_email (ends in "email"), so
// real opportunity/staff rows sharing sample weak values get wrongly stripped.
const RECORD_ID_TEMPLATE_KEYS = new Set([
  "projectId", "opp_erpJob", "ld_id", "st_email",
  "asg_projectId", "sch_projectId",
]);
// Is this column a record-ID column? Matches both raw file headers
// ("Opportunity ID", "Project ID") and internal grid keys.
function isRecordIdKey(k: string): boolean {
  return RECORD_ID_TEMPLATE_KEYS.has(k) ||
    /Id$/.test(k) || /(^|[\s_.-])id$/i.test(k) || /\bid\b/i.test(k);
}
function isBuiltinSampleRow(row: Row): boolean {
  // A row carrying its OWN record ID (a non-blank value in an ID column that
  // is not one of our sample IDs) is real user data — never strip it. The
  // built-in example rows either leave ID columns blank or use unmistakable
  // sample IDs (EX-LD-…, PMM-2024-…) which live in SAMPLE_STRONG_VALUES.
  // Without this gate, tenants whose real people/companies share names with
  // the sample data (e.g. demo tenants seeded from the template) get real
  // rows silently dropped by the weak-value heuristic below.
  for (const [k, v] of Object.entries(row)) {
    const t = String(v ?? "").trim().toLowerCase();
    if (!t) continue;
    if (isRecordIdKey(k) && !SAMPLE_STRONG_VALUES.has(t)) return false;
  }
  let weakHits = 0;
  for (const v of Object.values(row)) {
    const t = String(v ?? "").trim().toLowerCase();
    if (!t) continue;
    if (SAMPLE_STRONG_VALUES.has(t)) return true;
    if (SAMPLE_WEAK_VALUES.has(t) && ++weakHits >= 2) return true;
  }
  return false;
}


/** Shared Excel data-validation for list (select/status/opts) and numeric
 *  columns — used by BOTH template builders so they can't drift. Date
 *  validation stays per-builder (the two use different date formats).
 *  Hard dropdown (errorStyle:"error") only for select/status columns;
 *  opts-only columns keep a soft suggestion list (free text allowed). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyListAndNumberValidation(ws: any, cols: readonly ColDef[], lastRow: number): void {
  cols.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    const opts = c.type === "status" ? STATUS_OPTS : c.opts;
    if (opts && opts.length > 0) {
      const joined = opts.join(",");
      if (joined.length > 250) return; // Excel inline-list limit (255 chars)
      // Status is a SOFT suggestion list — tenant-defined statuses in the
      // client's file are accepted verbatim, so Excel must not block them.
      const hard = c.type === "select";
      for (let r = 2; r <= lastRow; r++) {
        ws.getCell(`${letter}${r}`).dataValidation = hard
          ? {
              type: "list", allowBlank: true, formulae: [`"${joined}"`],
              showErrorMessage: true, errorStyle: "error",
              errorTitle: "Invalid option", error: `Choose one of: ${joined}`,
            }
          : { type: "list", allowBlank: true, formulae: [`"${joined}"`], showErrorMessage: false };
      }
    } else if (c.type === "number" || c.type === "currency") {
      const isPct = PERCENT_KEYS.has(c.key);
      for (let r = 2; r <= lastRow; r++) {
        ws.getCell(`${letter}${r}`).dataValidation = {
          type: "decimal",
          operator: isPct ? "between" : "greaterThan",
          formulae: isPct ? [0, 100] : [-1000000000000],
          allowBlank: true, showErrorMessage: true, errorStyle: "error",
          errorTitle: isPct ? "Invalid percent" : "Invalid number",
          error: isPct
            ? "Enter a number between 0 and 100."
            : "Enter a number — text is not allowed in this column.",
        };
      }
    }
  });
}
const STATUS_CLR: Record<string, string> = {
  Active:"bg-green-100 text-green-700","On Hold":"bg-yellow-100 text-yellow-700",
  Complete:"bg-blue-100 text-blue-700",Pending:"bg-gray-100 text-gray-500",
  Cancelled:"bg-red-100 text-red-600","In Review":"bg-purple-100 text-purple-700",
};

// ── Tab type helper ───────────────────────────────────────────────────────
function getTabType(tabId: string, cardId: string): "team" | "clients" | "assignments" | "schedule" {
  if (tabId === "assignments") return "assignments";
  if (tabId === "schedule")    return "schedule";
  if (cardId === "team")       return "team";
  return "clients";
}

// ── Template column header (file mode) ───────────────────────────────────
// Fixed to the template structure. Shows which file column feeds it via a chip.
// When no file column matches, the user can type a fixed value applied to all rows.
function TmplColHeader({ col, fileHeader, fixedValue, matchType, availableHeaders, headerSamples, isAiLoading, onAssign, onSetFixed, onSelectColumn, isSelected, deferredCheck }: {
  col: ColDef;
  fileHeader: string | null;
  fixedValue?: string | null;
  matchType: "auto" | "ai" | "manual" | null;
  availableHeaders: string[];
  /** First non-empty value per file column, shown as a sample in the dropdown */
  headerSamples?: Record<string, string>;
  isAiLoading: boolean;
  onAssign: (fh: string | null) => void;
  onSetFixed?: (v: string | null) => void;
  onSelectColumn?: () => void;
  isSelected?: boolean;
  /** When true, shows a "checked at upload" badge (large-tenant deferred ID check). */
  deferredCheck?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typingFixed, setTypingFixed] = useState(false);
  const [fixedDraft, setFixedDraft] = useState("");

  const hasFixed  = !!fixedValue;
  const hasSource = fileHeader !== null;

  const chipClass = hasFixed
    ? "border-teal-400 bg-teal-50 text-teal-700"
    : !hasSource
      ? isAiLoading
        ? "border-dashed border-amber-300 bg-amber-50 text-amber-500 animate-pulse"
        : "border-dashed border-gray-200 bg-gray-50 text-gray-400"
      : matchType === "manual"
        ? "border-green-400 bg-green-50 text-green-700"
        : matchType === "ai"
          ? "border-amber-400 bg-amber-50 text-amber-700"
          : "border-indigo-300 bg-indigo-50 text-indigo-700";

  const chipLabel = hasFixed
    ? `= ${fixedValue}`
    : !hasSource
      ? (isAiLoading ? "Matching…" : "↑ No source")
      : `↑ ${fileHeader}`;

  return (
    <th className="border p-0 align-top"
      style={{ minWidth: col.w, width: col.w, borderColor: isSelected ? "#818cf8" : "#e5e7eb", backgroundColor: isSelected ? "rgba(99,102,241,0.08)" : "#ffffff" }}>
      {/* Template column name — click to select entire column */}
      <div
        className={`px-2 pt-2 pb-1 border-b select-none ${isSelected ? "cursor-pointer" : onSelectColumn ? "cursor-pointer hover:bg-indigo-50/60" : ""}`}
        style={{ borderBottomColor: isSelected ? "#6366f1" : "#f3f4f6", backgroundColor: isSelected ? "#6366f1" : "#f3f4f6" }}
        title={isSelected ? `Click to deselect column "${col.label}"` : onSelectColumn ? `Click to select all rows in "${col.label}"` : col.label}
        onClick={e => { e.stopPropagation(); onSelectColumn?.(); }}
      >
        <span className="flex items-center gap-1 text-[11px] font-semibold leading-tight truncate" style={{ color: isSelected ? "#ffffff" : "#374151" }}>
          <span className="truncate">{col.label}</span>
          {deferredCheck && (
            <span
              title="This tenant has too many IDs to check as you type — IDs are validated when you click Upload instead."
              style={{
                flexShrink: 0, fontSize: 8.5, lineHeight: "13px",
                background: isSelected ? "rgba(255,255,255,0.22)" : "rgba(99,102,241,0.13)",
                color: isSelected ? "#e0e7ff" : "#6366f1",
                borderRadius: 4, padding: "1px 5px", fontWeight: 700,
                letterSpacing: 0.2, whiteSpace: "nowrap", cursor: "default",
              }}>
              checked at upload
            </span>
          )}
        </span>
      </div>
      {/* Source chip — which file column feeds this template col */}
      <div className="relative px-2 py-1.5">
        <button onClick={() => { setOpen(o => !o); setTypingFixed(false); }}
          className={`w-full flex items-center justify-between gap-1 px-2 py-1.5 rounded-md border text-[10px] font-medium transition ${chipClass}`}>
          <span className="truncate leading-tight min-w-0">{chipLabel}</span>
          <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
        </button>
        {open && (
          <div className="absolute top-full left-0 z-50 mt-0.5 w-64 rounded-lg shadow-xl max-h-80 overflow-y-auto text-xs" style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb" }}>
            {/* ── Fixed value entry — TOP of dropdown ── */}
            {onSetFixed && (
              <div className={`${hasFixed ? "bg-teal-50/60" : ""}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
                {!typingFixed ? (
                  <div>
                    <button
                      className={`w-full text-left px-3 py-2 flex items-center gap-1.5 font-medium ${
                        hasFixed ? "text-teal-700 hover:bg-teal-100" : "text-teal-600 hover:bg-teal-50"
                      }`}
                      onClick={() => { setTypingFixed(true); setFixedDraft(fixedValue ?? ""); }}>
                      <span className="text-base leading-none">✎</span>
                      <span className="flex-1">{hasFixed ? `Change "${col.label}" value…` : `Enter "${col.label}" value…`}</span>
                    </button>
                    {hasFixed && (
                      <button
                        className="w-full text-left px-3 pb-2 text-red-400 hover:text-red-600 text-[10px] flex items-center gap-1"
                        onClick={() => { onSetFixed?.(null); setOpen(false); setTypingFixed(false); }}>
                        <span>✕</span> Remove fixed value — use file data instead
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="px-3 py-2.5 space-y-1.5">
                    <p className="text-[10px] text-teal-700 font-medium">Fill every row — {col.label}:</p>
                    <input
                      autoFocus
                      className="w-full border border-teal-300 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-teal-400"
                      placeholder={col.opts?.[0] ?? col.label}
                      value={fixedDraft}
                      onChange={e => setFixedDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const v = fixedDraft.trim();
                          if (v) { onAssign(null); onSetFixed(v); }
                          setOpen(false); setTypingFixed(false);
                        }
                        if (e.key === "Escape") { setTypingFixed(false); }
                      }}
                    />
                    <div className="flex gap-1.5 pt-0.5">
                      <button
                        className="flex-1 bg-teal-500 hover:bg-teal-600 text-white rounded px-2 py-1 text-[10px] font-medium"
                        onClick={() => {
                          const v = fixedDraft.trim();
                          if (v) { onAssign(null); onSetFixed(v); }
                          setOpen(false); setTypingFixed(false);
                        }}>
                        Save fixed value
                      </button>
                      <button
                        className="px-2 py-1 text-[10px] hover:text-gray-600"
                        style={{ color: "#9ca3af" }}
                        onClick={() => setTypingFixed(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* ── Or map to a file column ── */}
            {(fileHeader || availableHeaders.length > 0) && (
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#9ca3af" }}>
                Or map to a column from your file
              </p>
            )}
            <button className="w-full text-left px-3 py-2 hover:bg-gray-50 italic" style={{ color: "#9ca3af" }}
              onClick={() => { onAssign(null); onSetFixed?.(null); setOpen(false); setTypingFixed(false); }}>
              ↑ No source — leave empty
            </button>
            {/* Currently assigned file col */}
            {fileHeader && (
              <button key="__cur__"
                onClick={() => { setTypingFixed(false); setOpen(false); }}
                className="w-full text-left px-3 py-2 bg-indigo-50 text-indigo-700 font-semibold flex items-center gap-2">
                <span className="text-indigo-400 shrink-0">✓</span>
                <span className="flex-1 min-w-0 truncate">{fileHeader}</span>
                {headerSamples?.[fileHeader] && (
                  <span className="shrink-0 text-[10px] text-indigo-400 italic truncate max-w-[90px]" title={headerSamples[fileHeader]}>
                    e.g. {headerSamples[fileHeader]}
                  </span>
                )}
              </button>
            )}
            {/* Available (unassigned) file cols */}
            {availableHeaders.map(h => (
              <button key={h}
                onClick={() => { onAssign(h); onSetFixed?.(null); setTypingFixed(false); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate">{h}</span>
                {headerSamples?.[h] && (
                  <span className="shrink-0 text-[10px] text-gray-400 italic truncate max-w-[90px]" title={headerSamples[h]}>
                    e.g. {headerSamples[h]}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </th>
  );
}

// ── Extra / unmatched file column header ──────────────────────────────────
// Appended after all template columns for file cols that couldn't be mapped.
// crossTabLabel = e.g. "Team Assignments" when this file col belongs to another tab's template
function ExtraColHeader({ fileHeader, crossTabLabel, isDragging, isOver,
  onDragStart, onDragOver, onDrop, onDragEnd }: {
  fileHeader: string;
  crossTabLabel: string | null;
  isDragging: boolean; isOver: boolean;
  onDragStart: () => void; onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void; onDragEnd: () => void;
}) {
  const isCrossTab = crossTabLabel !== null;
  const bg = isCrossTab ? "bg-sky-50/40" : "bg-amber-50/30";
  const dragBg = isCrossTab ? "bg-sky-50/70 border-b border-sky-200/60" : "bg-amber-50/60 border-b border-amber-200/50";
  const grip = isCrossTab ? "text-sky-300" : "text-amber-300";
  const label = isCrossTab ? "text-sky-700" : "text-amber-700";
  const badgeCls = isCrossTab
    ? "text-sky-600 bg-sky-50 border border-sky-200"
    : "text-amber-500 bg-amber-50 border border-amber-200";
  const badgeText = isCrossTab ? `→ ${crossTabLabel}` : "Not in any template";

  return (
    <th
      className={`border p-0 align-top select-none transition-all
        ${bg} ${isDragging ? "opacity-40" : ""} ${isOver ? "bg-blue-50 border-l-2 border-l-blue-400" : ""}`}
      style={{ minWidth: 140, borderColor: isOver ? undefined : "#e5e7eb" }}>
      <div draggable
        onDragStart={e => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
        onDragOver={e => { e.preventDefault(); onDragOver(e); }}
        onDrop={e => { e.preventDefault(); onDrop(); }}
        onDragEnd={onDragEnd}>
        <div className={`flex items-center gap-1.5 px-2 pt-2 pb-1 cursor-grab ${dragBg}`}>
          <GripVertical className={`w-3 h-3 ${grip} shrink-0`} />
          <span className={`text-[11px] ${label} font-medium truncate leading-tight`} title={fileHeader}>{fileHeader}</span>
        </div>
        <div className="px-2 py-1.5">
          <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${badgeCls}`}>
            {badgeText}
          </span>
        </div>
      </div>
    </th>
  );
}

// ── Editable template cell ────────────────────────────────────────────────
type CellKey = { row: number; col: string };

function TemplateCell({ value, col, editing, inDragFill, isSelected, isRowSel, extraErr, onEdit, onCommit, onLiveChange, onFillHandleDown, onEnterCell, onShiftClick, onCellDown, onCellUp, onDoubleClick }: {
  value: string; col: ColDef; editing: boolean; inDragFill: boolean; isSelected?: boolean; isRowSel?: boolean;
  /** Extra grid-level validation error (e.g. unknown Project/Opp ID) — same red treatment as validateCell errors. */
  extraErr?: string | null;
  onEdit: () => void; onCommit: (v: string) => void; onLiveChange?: (v: string) => void;
  onFillHandleDown: () => void; onEnterCell: () => void; onShiftClick?: () => void;
  onCellDown?: () => void; onCellUp?: () => void; onDoubleClick?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | null>(null);
  const listId = `dl-${col.key}`;
  const start = () => { onEdit(); setDraft(value); setTimeout(() => ref.current?.focus(), 0); };

  // Date columns: always render as a DateField.
  // Mouse handlers live on the field (not the td) so stopPropagation prevents
  // the td-level selection logic from stealing focus before the picker opens.
  if (col.type === "date") {
    const dateErr = validateCell(col, value);
    return (
      <td
        className={`border text-xs relative ${isSelected ? "border-indigo-400 ring-2 ring-blue-300 ring-inset" : dateErr ? "ring-2 ring-red-300 ring-inset" : ""}`}
        title={dateErr ?? undefined}
        style={{ width: col.w, minWidth: col.w, padding: 0, borderColor: isSelected ? undefined : dateErr ? "#f87171" : "#e5e7eb" }}
      >
        <div onMouseUp={e => { e.stopPropagation(); onCellUp?.(); }}>
          <DateField
            value={draft}
            onChange={v => { setDraft(v); onCommit(v); }}
            compact
            onMouseDownCapture={e => { e.stopPropagation(); onCellDown?.(); }}
            onKeyDown={e => { if (e.key === "Escape") { setDraft(value); onCommit(value); } }}
            style={{ border: "none", background: "transparent", borderRadius: 0, fontSize: 12 }}
          />
        </div>
      </td>
    );
  }

  if (editing) {
    if (col.type === "status") {
      // Tenant-defined statuses from the client's file are legal values —
      // keep the current one selectable so opening the editor never stomps it.
      const hasDraft = !draft.trim() || STATUS_OPTS.some(s => s.toLowerCase() === draft.trim().toLowerCase());
      return (
        <td className="border border-blue-400 ring-2 ring-blue-300 ring-inset p-0" style={{ width: col.w, minWidth: col.w }}>
          <select autoFocus className="w-full h-full px-2 py-1 text-xs bg-white outline-none"
            value={draft} onChange={e => { setDraft(e.target.value); onLiveChange?.(e.target.value); }} onBlur={() => onCommit(draft)}
            onKeyDown={e => { if (e.key === "Enter") onCommit(draft); if (e.key === "Escape") onCommit(value); }}>
            {!hasDraft && <option value={draft}>{draft}</option>}
            {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
          </select>
        </td>
      );
    }
    if (col.type === "select" && col.opts && col.opts.length > 0) {
      return (
        <td className="border border-blue-400 ring-2 ring-blue-300 ring-inset p-0" style={{ width: col.w, minWidth: col.w }}>
          <select autoFocus className="w-full h-full px-2 py-1 text-xs bg-white outline-none"
            value={draft} onChange={e => { setDraft(e.target.value); onLiveChange?.(e.target.value); }} onBlur={() => onCommit(draft)}
            onKeyDown={e => { if (e.key === "Enter") onCommit(draft); if (e.key === "Escape") onCommit(value); }}>
            <option value="">— select —</option>
            {col.opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </td>
      );
    }
    return (
      <td className="border border-blue-400 ring-2 ring-blue-300 ring-inset p-0" style={{ width: col.w, minWidth: col.w }}>
        {col.opts && <datalist id={listId}>{col.opts.map(o => <option key={o} value={o} />)}</datalist>}
        <input ref={ref} autoFocus list={col.opts ? listId : undefined}
          className="w-full h-full px-2 py-1.5 text-xs bg-white outline-none"
          style={{ color: "#111827" }}
          value={draft} onChange={e => { setDraft(e.target.value); onLiveChange?.(e.target.value); }} onBlur={() => onCommit(draft)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === "Tab") onCommit(draft); if (e.key === "Escape") onCommit(value); }} />
      </td>
    );
  }

  const badge = col.type === "status" ? (STATUS_CLR[value] || "bg-gray-100 text-gray-500") : null;
  const cellErr = validateCell(col, value) ?? extraErr ?? null;
  return (
    <td
      title={cellErr ?? undefined}
      className={`border text-xs cursor-cell select-none relative group
        ${inDragFill
          ? "bg-blue-100 border-blue-400"
          : isRowSel
            ? "bg-indigo-100/70 border-indigo-300 px-2 py-1.5"
            : isSelected
              ? "bg-indigo-50/60 border-indigo-400 px-2 py-1.5"
              : cellErr
                ? "px-2 py-1.5 bg-red-50"
                : "px-2 py-1.5 hover:bg-blue-50/60"}`}
      style={{ width: col.w, minWidth: col.w, maxWidth: col.w, borderColor: inDragFill || isRowSel || isSelected ? undefined : cellErr ? "#f87171" : "#e5e7eb" }}
      onMouseDown={e => {
        if (e.shiftKey && onShiftClick) { onShiftClick(); }
        else { onCellDown?.(); }
      }}
      onMouseUp={() => { /* single click selects the row; double-click edits */ }}
      onDoubleClick={() => { onDoubleClick?.(); }}
      onMouseEnter={onEnterCell}
    >
      <div className={inDragFill ? "px-2 py-1.5" : ""}>
        {badge
          ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${badge}`}>{value || "Pending"}</span>
          : value?.trim()
            ? <span className="truncate block" style={{ color: cellErr ? "#b91c1c" : "#374151" }}>{value}</span>
            : <span className="italic text-[11px]" style={{ color: "#d1d5db" }}>—</span>}
      </div>
      {/* Drag-fill handle — bottom-right corner, appears on cell hover */}
      <div
        className="absolute bottom-[-3px] right-[-3px] w-[6px] h-[6px] bg-blue-500 border border-white rounded-sm opacity-0 group-hover:opacity-100 cursor-crosshair z-20"
        onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onFillHandleDown(); }}
      />
    </td>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export type ImportMode = "update" | "add" | "replace";

export interface InlineDataGridProps {
  cardId: string; cardLabel: string; multiTab?: boolean;
  onClose: () => void;
  /** columnMappings = the grid's own header→server-field map for the exported
   *  file ({ sheetName: { header → canonical } }), built from
   *  lib/importServerFields.ts. Pages forward it to /preflight and /run so the
   *  server applies the grid's known matches instead of re-deriving them from
   *  its dictionaries (the Aug 2026 misplaced-team incident). Absent only for
   *  sheets the table doesn't cover (e.g. Schedule). */
  onSubmit: (file: File, mode: ImportMode, columnMappings?: Record<string, Record<string, string>>) => void;
  isSubmitting?: boolean;
  embedded?: boolean;
  /** Strict identity keys (Aug 2026): recurring imports match by key ONLY —
   *  record rows need their Company ID, assignment people need a login email,
   *  and email cells must look like emails. Adds blocking Fix-issues flags;
   *  the server's update-mode gate is the backstop. Leave OFF for create-mode
   *  surfaces (onboarding, bulk create) which keep the tolerant ladder. */
  strictKeys?: boolean;
  /** Upload id of the import run this grid just submitted (server accepted
   *  /run). While set, the wizard stays open on its final "Processing" step —
   *  live terminal, Cancel Upload, Done — instead of navigating away to the
   *  status page. */
  runningUploadId?: string | null;
  /** Called when the user leaves the Processing step. ok = the run finished
   *  successfully (incl. partial) — the submitted file data is cleared so the
   *  same file can't be double-imported by accident. */
  onRunClosed?: (ok: boolean) => void;
  /** True when runningUploadId is a run this grid is only WATCHING (started
   *  from another tab / before a refresh / by another user) — Done must NOT
   *  clear this grid's own unsubmitted rows or file. */
  runIsExternal?: boolean;
  onDownloadTemplate?: (rows?: Record<string, Record<string, string>[]>) => void;
  /** Called when the user clears the uploaded file — lets the parent refresh sidebar counts. */
  onClear?: () => void;
  jobRunning?: boolean;
  thisModRunning?: boolean;
  /** Called when the user clicks Upload File while another import is running —
   *  lets the parent open its live-progress popup instead of the button being
   *  silently disabled with only a hover tooltip. */
  onJobRunningClick?: () => void;
  /** Pre-load this file into the grid on mount (skips AI matching). */
  initialFile?: File;
  /** Data-Cleaning session behind initialFile — enables saved review-decision
   *  replay + persistence for the cleaning → import handoff. */
  cleanSessionId?: string | null;
  /** Tenant override for that session (superadmin handoff). */
  cleanTenant?: string | null;
  /** Hide Import / Change File buttons — use for read-only history viewing. */
  readOnly?: boolean;
  /** Always submit as "create" — for provably-fresh new tenants. */
  forceCreate?: boolean;
  /**
   * The tenant already has data in ANY module (not just this card's). When
   * true, submissions run as "update" (merge-only: add new + update matched,
   * never remove); otherwise the grid fast-paths to "create" and the server
   * independently upgrades it to "update" for existing clients.
   */
  clientHasData?: boolean;
  /**
   * Existing Project + Opportunity ticket IDs from the database — used by the
   * standalone Team Assignments / Schedule cards to flag unknown references
   * as-you-type and to auto-correct separator/case drift ("pmm 26 020" →
   * "PMM-26-020") to the DB's exact ID. null/undefined = list unavailable →
   * the client-side check is skipped (fail open; the server's
   * ghost-reference guard remains the backstop).
   */
  existingTicketIds?: string[] | null;
  /**
   * Server-side batch check for large tenants (>10 000 IDs) where shipping
   * the full ID list is too expensive. When provided and existingTicketIds is
   * null, gateValidationReview calls this with the grid's current ID-column
   * values and uses the result to flag unknowns in the review step.
   * Returns a Set of found IDs (lowercased). Errors must resolve to an empty
   * Set (fail open); the server ghost-reference guard remains the backstop.
   */
  checkTicketIds?: (ids: string[]) => Promise<Set<string>>;
}

// (The old update/add/replace "apply mode" question was retired in the Aug 2026
// merge-only import redesign: every upload adds + updates, absent-from-file is
// untouched, and the server coerces legacy modes to "update". Removal is only
// manual or via the admin start-over wipe.)

export function InlineDataGrid({ cardId, cardLabel, multiTab = false, onClose, onSubmit, isSubmitting, embedded = false, strictKeys = false, onDownloadTemplate, onClear, jobRunning, thisModRunning, onJobRunningClick, initialFile, cleanSessionId, cleanTenant, readOnly = false, forceCreate = false, clientHasData = false, existingTicketIds = null, checkTicketIds, runningUploadId = null, onRunClosed, runIsExternal = false }: InlineDataGridProps) {
  // Preload the xlsx module as soon as any grid renders — the manual-entry
  // submit path calls the SYNCHRONOUS exportXlsx without ever running
  // processFile, so the module must already be cached by submit time.
  // This keeps xlsx out of the app's startup bundle (it only loads when a
  // grid page is actually opened) while guaranteeing availability.
  useEffect(() => { void loadXlsx(); }, []);
  const baseTabs = useMemo(() => getTabsForCard(cardId, multiTab), [cardId, multiTab]);
  // fileTabs is set when the uploaded file has sheets beyond what our template exposes
  // (e.g. a Leads file that also has a "Team Assignments" sheet). Null = use baseTabs.
  const [fileTabs, setFileTabs] = useState<TabDef[] | null>(null);
  const tabs = useMemo(() => fileTabs ?? baseTabs, [fileTabs, baseTabs]);

  // ── DB-backed ticket-ID index (standalone Assignments / Schedule cards) ──
  // existingTicketIds = the tenant's real PMM/Opportunity ticket IDs. Two
  // lookups: exact (case-insensitive) and normalized (all separators
  // stripped). The normalized map only ever rewrites a value when it maps to
  // exactly ONE canonical ID — ambiguous normalizations fall back to
  // exact-match-only, so drift is corrected but never guessed.
  const isStandaloneRefCard = cardId === "assignments" || cardId === "schedule";
  // BOTH ID columns are checked on standalone cards — uploading a workbook
  // with the other sheet type sprouts its tab dynamically, and those rows
  // reference existing records too. On Projects/Opportunities cards the DB
  // check stays OFF (ticketRefIndex = null): assignment/schedule sheets there
  // legally forward-reference records created by the same upload.
  const refColKey = isStandaloneRefCard ? (cardId === "assignments" ? "asg_projectId" : "sch_projectId") : null;
  // Large-tenant deferred-check flag: existingTicketIds was not shipped (too
  // expensive), but a server-side batch checker is wired up — IDs are only
  // validated at submit time, not as the user types.
  const deferredIdCheck = isStandaloneRefCard && existingTicketIds === null && !!checkTicketIds;
  const isTicketRefCol = useCallback((key: string | undefined): boolean =>
    !!key && isStandaloneRefCard && (key === "asg_projectId" || key === "sch_projectId"),
  [isStandaloneRefCard]);
  const ticketRefIndex = useMemo(() => {
    if (!existingTicketIds || !isStandaloneRefCard) return null;
    const exact = new Set<string>();
    const canon = new Map<string, string>();
    const collided = new Set<string>();
    const ids: string[] = [];
    for (const raw of existingTicketIds) {
      const id = String(raw ?? "").trim();
      if (!id) continue;
      ids.push(id);
      exact.add(id.toLowerCase());
      const k = normalizeTicketRef(id);
      if (!k) continue;
      const prev = canon.get(k);
      if (prev !== undefined && prev !== id) collided.add(k);
      else canon.set(k, id);
    }
    for (const k of collided) canon.delete(k); // ambiguous → exact match only
    return { exact, canon, ids };
  }, [existingTicketIds, isStandaloneRefCard]);

  // Auto-correct separator/case drift to the DB's exact ID ("pmm 26 020" →
  // "PMM-26-020"). Values with no unambiguous match pass through unchanged —
  // they get red-flagged, never guessed.
  const canonTicketRef = useCallback((v: string): string => {
    if (!ticketRefIndex) return v;
    const t = v.trim();
    if (!t) return v;
    return ticketRefIndex.canon.get(normalizeTicketRef(t)) ?? v;
  }, [ticketRefIndex]);

  // Wrapper over canonCellValue so every cell write site (edit / paste /
  // fill / file ingest) ALSO canonicalizes ticket IDs on the standalone
  // cards' ID column. Other columns behave exactly as before.
  const canonCell = useCallback((cd: ColDef | undefined, val: string): string => {
    const base = canonCellValue(cd, val);
    if (cd && isTicketRefCol(cd.key)) return canonTicketRef(base);
    return base;
  }, [isTicketRefCol, canonTicketRef]);

  // Closest existing ID suggestion for near-miss values.
  // Only runs when a value has already failed the has() check — so it's
  // called for invalid IDs only, keeping per-render cost negligible.
  // Threshold: ≤ 2 edits on the normalized (no separators) form, and only
  // IDs sharing the same alphabetic prefix (e.g. "PMM") are candidates so
  // the search is O(small constant) regardless of total ID count.
  const suggestTicketRef = useCallback((raw: string): string | null => {
    if (!ticketRefIndex) return null;
    const t = (raw ?? "").trim();
    const normT = normalizeTicketRef(t);
    if (!normT) return null;
    const pfx = normT.match(/^[A-Z]+/)?.[0] ?? "";
    if (!pfx) return null;
    const MAX_DIST = 2;
    let best: string | null = null;
    let bestDist = MAX_DIST + 1;
    let tied = false;
    for (const id of ticketRefIndex.ids) {
      const normId = normalizeTicketRef(id);
      if (!normId.startsWith(pfx)) continue;
      // Levenshtein distance — iterative, two-row, O(m·n) time.
      const a = normT, b = normId;
      const m = a.length, n = b.length;
      if (Math.abs(m - n) > MAX_DIST) continue; // length gap alone exceeds threshold
      let prev = Array.from({ length: n + 1 }, (_, i) => i);
      let curr = new Array<number>(n + 1);
      for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
          curr[j] = a[i - 1] === b[j - 1]
            ? prev[j - 1]
            : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
        }
        [prev, curr] = [curr, prev];
      }
      const d = prev[n];
      if (d === 0) return null; // exact normalized match (valid, shouldn't reach here)
      if (d < bestDist) { bestDist = d; best = id; tied = false; }
      else if (d === bestDist) { tied = true; }
    }
    return !tied && bestDist <= MAX_DIST ? best : null;
  }, [ticketRefIndex]);

  // Batch-checked IDs for large tenants — populated immediately after file
  // upload or paste so unknowns are highlighted in the grid right away (not
  // only at submit time). null = check hasn't run yet; Set = result of the
  // most recent batch check (may be empty when the call fails — fail open).
  const [batchCheckedIds, setBatchCheckedIds] = useState<Set<string> | null>(null);

  // As-you-type red flag for IDs that don't match any existing record.
  // Null when the ID list is unavailable — fail open, server guard remains.
  // Two paths:
  //   • Small tenant  — ticketRefIndex (built from the full ID list) available
  //   • Large tenant  — ticketRefIndex is null; batchCheckedIds populated after
  //                     file upload / paste via the server-side batch check.
  const dbCellErr = useCallback((cd: ColDef | undefined, val: string): string | null => {
    if (!cd || !isTicketRefCol(cd.key)) return null;
    const t = (val ?? "").trim();
    if (!t) return null;
    // Built-in example rows use fabricated IDs — they're stripped at submit
    // (isBuiltinSampleRow), so don't alarm users by flagging them red.
    if (SAMPLE_STRONG_VALUES.has(t.toLowerCase())) return null;
    if (ticketRefIndex) {
      if (ticketRefIndex.exact.has(t.toLowerCase())) return null;
      if (ticketRefIndex.canon.has(normalizeTicketRef(t))) return null;
      const suggestion = suggestTicketRef(t);
      const hint = suggestion ? ` — did you mean "${suggestion}"?` : "";
      return `"${t}" doesn't match any existing Project or Opportunity${hint} Check the ID, or import that record first`;
    }
    // Large-tenant path: use the batch-check result when available.
    if (batchCheckedIds !== null) {
      if (batchCheckedIds.has(t.toLowerCase())) return null;
      return `"${t}" doesn't match any existing Project or Opportunity — check the ID, or import that record first`;
    }
    return null; // batch check not yet completed — fail open
  }, [ticketRefIndex, isTicketRefCol, suggestTicketRef, batchCheckedIds]);

  // DB-reference check handed to the submit-time scan + the review grid.
  const dbRefCheck = useMemo<DbRefCheck | null>(() => {
    if (!ticketRefIndex) return null;
    return {
      has: (raw: string) => {
        const t = (raw ?? "").trim();
        if (!t) return true;
        return ticketRefIndex.exact.has(t.toLowerCase()) || ticketRefIndex.canon.has(normalizeTicketRef(t));
      },
      suggest: suggestTicketRef,
    };
  }, [ticketRefIndex, suggestTicketRef]);
  const [showTemplateWarning, setShowTemplateWarning] = useState(false);
  // Upload column audit: file's data-bearing columns vs columns the grid took.
  // Set when even ONE data-containing column failed to match the template /
  // synonyms — the popup names the exact columns and offers the template.
  // tabId is present when the column's sheet was routed into a tab — those
  // columns can be remapped in-place from the popup (dropdown → assignToTemplate).
  // Columns from dropped sheets have no tabId and stay guidance-only.
  // mappedTo tracks a remap made from the popup (col key) for count/UI updates.
  const [colAudit, setColAudit] = useState<{
    fileDataCols: number;
    takenCols: number;
    // acknowledged: the user pressed Continue on the popup during this
    // upload flow — the submit gate skips re-showing it, and the upload
    // confirm's Back button reopens it (data kept alive for that).
    acknowledged?: boolean;
    // samples: first distinct values of the file column (shown so the user
    // recognises the data). suggested/suggestionPending: best-guess grid
    // column preselected in the dropdown — applied ONLY when the user
    // confirms via the Continue button, cleared when they touch the select.
    unmatched: { sheet: string; col: string; tabId?: string; mappedTo?: string; samples?: string[]; suggested?: string; suggestionPending?: boolean }[];
  } | null>(null);
  // The audit popup does NOT open when the file loads — the data is stored
  // silently and the popup opens as step 1 of the upload flow, when the
  // user clicks "Upload N rows" (submitFileData). Continue/X close it.
  const [colAuditOpen, setColAuditOpen] = useState(false);
  // "This file needs a lot of clean-up" popup: fires right after a fresh
  // upload lands with MANY held-back rows (or a jumble spanning several
  // tabs) — recommends the standard template but never blocks continuing.
  const [messyWarning, setMessyWarning] = useState<{ total: number; byTab: [string, number][] } | null>(null);
  // True only between a user-initiated upload and the processFile run it
  // triggers — the popup must never fire on refresh replays, the
  // Data-Cleaning handoff, or read-only history views.
  const freshUploadRef = useRef(false);
  // How many built-in example rows were stripped from the last uploaded file —
  // surfaced in the status bar so sample-row stripping is never silent.
  const [sampleSkipCount, setSampleSkipCount] = useState(0);
  // When the uploaded file consists ENTIRELY of our built-in example rows
  // (e.g. the user is test-driving the import with a sample workbook),
  // stripping them would load a confusing empty grid. Instead the rows are
  // kept, this counter drives an explanatory chip, and the ref lets the
  // upload-time sample-row guards wave the rows through.
  const [sampleKeptCount, setSampleKeptCount] = useState(0);
  const allowSampleRowsRef = useRef(false);

  // ── Dynamic column opts (e.g. live opportunity list) ─────────────────────
  const [dynamicOpts, setDynamicOpts] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (cardId !== "projects") return;
    getModuleRecords("OPM").then(res => {
      const titles = ((res as any).data ?? [])
        .map((o: any) => String(o.Title ?? o.ProjectTitle ?? o.TicketId ?? ""))
        .filter(Boolean) as string[];
      if (titles.length) setDynamicOpts(prev => ({ ...prev, linkedOpp: titles }));
    }).catch(() => {});
  }, [cardId]);

  // Access-level selects: built-ins + this tenant's admin-defined custom
  // levels (Settings → Access Levels), matched by name. Keyed on the
  // permissions version so a level added in a sibling tab appears without a
  // reload. Soft-fail: the built-ins always work. The shared column defs are
  // updated in place (not via dynamicOpts/softOpts) so the cell selects, the
  // validation gate, the select auto-canonicalizer, and the downloadable
  // template all agree on the same complete option list.
  const permsVersion = usePermissionsVersion();
  const [, setAclOptsVersion] = useState(0);
  // Kept in state too: the group → access-level popup renders these names as
  // selection cards (built-ins + tenant customs).
  const [customAclNames, setCustomAclNames] = useState<string[]>([]);
  useEffect(() => {
    fetchAccessLevels(cleanTenant ?? undefined).then(levels => {
      const names = levels.map(l => String(l.name ?? "").trim()).filter(Boolean);
      setCustomAclNames(names);
      if (applyCustomAccessLevelOpts(names)) setAclOptsVersion(v => v + 1);
    }).catch(() => {});
  }, [cleanTenant, permsVersion]);

  // softOpts: dynamically-fetched lists (e.g. live opportunity titles) are
  // suggestions only — they may be incomplete, so they must never hard-fail
  // validation (keeps cell styling consistent with the import gate, which
  // uses the base ColDef without dynamic opts).
  const enrichCol = (col: ColDef): ColDef =>
    dynamicOpts[col.key] ? { ...col, opts: dynamicOpts[col.key], softOpts: true } : col;

  // ── Template mode state ────────────────────────────────────────────────
  const [activeTmplTab, setActiveTmplTab] = useState(tabs[0].id);
  const [tmplData, setTmplData] = useState<Record<string, Row[]>>(() => {
    // Restore unsent in-progress edits from localStorage if available.
    // Migration: older versions stored the built-in sample rows (and the
    // just-imported records) as real data rows — strip anything matching
    // the sample data so stale drafts can't resurrect it.
    try {
      // One-time purge of the pre-v2 draft key — it accumulated demo rows
      // that kept reappearing as real-looking data on every visit.
      try { localStorage.removeItem(legacyGridStorageKey(cardId)); } catch { /* ignore */ }
      // FRESH_START: skip draft restore entirely — the grid always opens fresh.
      const saved = FRESH_START_ALWAYS ? null : localStorage.getItem(gridStorageKey(cardId));
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, Row[]>;
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          const cleaned: Record<string, Row[]> = {};
          for (const [k, rows] of Object.entries(parsed)) {
            cleaned[k] = (rows ?? []).filter(r => r && !isBuiltinSampleRow(r));
          }
          if (Object.values(cleaned).some(rows => rows.length > 0)) return cleaned;
        }
      }
    } catch { /* ignore */ }
    // Fresh grid: example data is shown via the read-only ghost rows — the
    // editable grid itself starts with a few blank rows to type into.
    return Object.fromEntries(
      getTabsForCard(cardId, multiTab).map(t => [t.id, [empty(t.cols), empty(t.cols), empty(t.cols)]])
    );
  });

  // Ref mirror of tmplData so async closures (e.g. deferred paste ID-check) can
  // read the latest value without stale closure capture.
  const tmplDataRef = useRef<Record<string, Row[]>>(tmplData);
  useEffect(() => { tmplDataRef.current = tmplData; }, [tmplData]);

  // Auto-save template edits (skip first render to avoid overwriting localStorage with sample rows)
  const tmplDataMountedRef = useRef(false);
  useEffect(() => {
    if (!tmplDataMountedRef.current) { tmplDataMountedRef.current = true; return; }
    // FRESH_START_ALWAYS: don't write drafts either — they'd never be read, and
    // stale drafts would resurrect if the flag is ever flipped back to false.
    if (FRESH_START_ALWAYS) return;
    try { localStorage.setItem(gridStorageKey(cardId), JSON.stringify(tmplData)); } catch { /* ignore */ }
  }, [tmplData, cardId]);
  const [editing, setEditing] = useState<CellKey | null>(null);
  // Anchor cell for paste — set whenever a cell is clicked/edited
  const [selAnchor, setSelAnchor] = useState<CellKey | null>(null);
  const [selActive, setSelActive] = useState<CellKey | null>(null);
  // Flash indicator shown briefly after a smart paste is applied
  const [pasteFlash, setPasteFlash] = useState(false);
  // Drag-fill state: tracks which column is being dragged and the current target row
  const [dragFill, setDragFill] = useState<{ tabId: string; colKey: string; srcRow: number; val: string; toRow: number } | null>(null);
  // File-drag-over: true while user is dragging an .xlsx/.csv file over the grid
  const [fileDragOver, setFileDragOver] = useState(false);
  // File-mode editing
  const [fileEditCell, setFileEditCell] = useState<{ tabId: string; rowIdx: number; colKey: string } | null>(null);
  const [fileEditDraft, setFileEditDraft] = useState("");
  const [fileSelAnchor, setFileSelAnchor] = useState<{ rowIdx: number; colKey: string } | null>(null);
  const [fileSelActive, setFileSelActive] = useState<{ rowIdx: number; colKey: string } | null>(null);
  // File-mode drag-fill
  const [fileDragFill, setFileDragFill] = useState<{ colKey: string; srcRow: number; val: string; toRow: number } | null>(null);
  const isFileDraggingRef = useRef(false);
  const isDraggingRef = useRef(false);
  // Refs mirror the drag state so the mouseup handler can read the latest value
  // without stale closures and without nesting setState inside a setState updater.
  const dragFillRef = useRef<{ tabId: string; colKey: string; srcRow: number; val: string; toRow: number } | null>(null);
  const fileDragFillRef = useRef<{ colKey: string; srcRow: number; val: string; toRow: number } | null>(null);
  // Prevents onBlur from cancelling the next cell's edit mode after Tab/Enter navigation
  const skipNextBlurRef = useRef(false);
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cell: { rowIdx: number; colKey: string | null } | null } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  // Shown when the browser blocks programmatic clipboard read on menu Paste.
  const [pasteHint, setPasteHint] = useState<{ x: number; y: number } | null>(null);
  // Drag-select (click+drag to highlight a range — template mode)
  const isDragSelectingRef = useRef(false);
  const didDragSelectRef = useRef(false); // true once the mouse enters a 2nd cell during drag-select

  // Commit drag-fill on global mouseup (handles BOTH template and file mode)
  useEffect(() => {
    const up = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        const prev = dragFillRef.current;
        dragFillRef.current = null;
        setDragFill(null);
        if (prev) {
          const lo = Math.min(prev.srcRow, prev.toRow);
          const hi = Math.max(prev.srcRow, prev.toRow);
          setTmplData(d => ({
            ...d,
            [prev.tabId]: (d[prev.tabId] ?? []).map((r, i) =>
              i >= lo && i <= hi ? { ...r, [prev.colKey]: prev.val } : r
            ),
          }));
        }
      }
      if (isFileDraggingRef.current) {
        isFileDraggingRef.current = false;
        const prev = fileDragFillRef.current;
        fileDragFillRef.current = null;
        setFileDragFill(null);
        if (prev) {
          const lo = Math.min(prev.srcRow, prev.toRow);
          const hi = Math.max(prev.srcRow, prev.toRow);
          setFileTabStates(fts => {
            const cur = fts[activeFileTabRef.current];
            if (!cur) return fts;
            const newOverrides = { ...cur.cellOverrides };
            for (let i = lo; i <= hi; i++) {
              newOverrides[i] = { ...(newOverrides[i] ?? {}), [prev.colKey]: prev.val };
            }
            return { ...fts, [activeFileTabRef.current]: { ...cur, cellOverrides: newOverrides } };
          });
        }
      }
      // Clear drag-select mode
      isDragSelectingRef.current = false;
      didDragSelectRef.current = false;
    };
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, []);

  // Track drag row by Y coordinate using both elementsFromPoint and <tr> onMouseEnter
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!isDraggingRef.current && !isFileDraggingRef.current) return;
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      for (const el of els) {
        const tr = (el as HTMLElement).closest("[data-row-idx]") as HTMLElement | null;
        if (!tr) continue;
        const ri = parseInt(tr.dataset.rowIdx ?? "-1", 10);
        if (ri < 0) continue;
        if (isDraggingRef.current && dragFillRef.current && dragFillRef.current.toRow !== ri) {
          const next = { ...dragFillRef.current, toRow: ri };
          dragFillRef.current = next;
          setDragFill(next);
        }
        if (isFileDraggingRef.current && fileDragFillRef.current && fileDragFillRef.current.toRow !== ri) {
          const next = { ...fileDragFillRef.current, toRow: ri };
          fileDragFillRef.current = next;
          setFileDragFill(next);
        }
        break;
      }
    };
    document.addEventListener("mousemove", handler);
    return () => document.removeEventListener("mousemove", handler);
  }, []);

  // Smart paste from Excel:
  //  - If first row looks like column headers (≥2 cells match template synonyms),
  //    map by name and fill from anchor row (or row 0 if nothing selected).
  //  - Otherwise fill by position from anchor (or row 0 / col 0 if no anchor).
  const handleGridPaste = useCallback((e: React.ClipboardEvent | ClipboardEvent) => {
    const text = (e as React.ClipboardEvent).clipboardData?.getData("text/plain")
      ?? (e as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd().split("\n");
    const parsed = lines.map(l => l.split("\t"));
    const isMultiCell = parsed.length > 1 || (parsed[0]?.length ?? 0) > 1;
    const tabDef = tabs.find(t => t.id === activeTmplTab);
    if (!tabDef) return;
    const colsList = tabDef.cols;
    if (!isMultiCell) {
      // Single-cell paste — Excel semantics: fill every cell of the selected
      // range with the value. A focused editor input handles its own paste
      // natively (this also prevents double-handling, since the container's
      // onPaste receives the same bubbled event).
      const activeEl = document.activeElement;
      if (activeEl && ["INPUT", "TEXTAREA", "SELECT"].includes(activeEl.tagName)) return;
      if (!selAnchor) return;
      e.preventDefault();
      const val = (parsed[0]?.[0] ?? "").trim();
      const aCi = colsList.findIndex(c => c.key === selAnchor.col);
      const bCi = selActive ? colsList.findIndex(c => c.key === selActive.col) : aCi;
      const rMin = Math.min(selAnchor.row, selActive?.row ?? selAnchor.row);
      const rMax = Math.max(selAnchor.row, selActive?.row ?? selAnchor.row);
      const cMin = Math.min(aCi, bCi);
      const cMax = Math.max(aCi, bCi);
      if (cMin < 0) return;
      setTmplData(prev => {
        const rows = [...(prev[activeTmplTab] ?? []).map(r => ({ ...r }))];
        for (let ri = rMin; ri <= rMax; ri++) {
          while (ri >= rows.length) rows.push(empty(colsList));
          for (let ci = cMin; ci <= cMax; ci++) {
            const cd = colsList[ci];
            if (cd) rows[ri][cd.key] = canonCell(cd, val);
          }
        }
        return { ...prev, [activeTmplTab]: rows };
      });
      setEditing(null);
      setPasteFlash(true);
      setTimeout(() => setPasteFlash(false), 800);
      // Large-tenant: re-check IDs in case the ID column was touched.
      tmplPasteIdCheckRef.current?.();
      return;
    }
    e.preventDefault();

    // ── Detect whether first row is a header row ──────────────────────────
    const firstRow = parsed[0] ?? [];
    const headerMap: Record<number, string> = {}; // pastedColIdx → templateKey
    for (let ci = 0; ci < firstRow.length; ci++) {
      const k = autoMapToColDef(firstRow[ci], colsList);
      if (k !== SKIP) headerMap[ci] = k;
    }
    const isHeaderPaste = Object.keys(headerMap).length >= Math.min(2, firstRow.filter(c => c.trim()).length);

    const anchorRow = selAnchor?.row ?? 0;

    if (isHeaderPaste) {
      // Header-mapped paste: rows 1+ are data, columns matched by name
      const dataRows = parsed.slice(1);
      setTmplData(prev => {
        const rows = [...(prev[activeTmplTab] ?? []).map(r => ({ ...r }))];
        dataRows.forEach((pr, ri) => {
          const rowIdx = anchorRow + ri;
          while (rowIdx >= rows.length) rows.push(empty(colsList));
          for (const [ci, key] of Object.entries(headerMap)) {
            const val = (pr[Number(ci)] ?? "").trim();
            if (val) rows[rowIdx][key] = canonCell(colsList.find(c => c.key === key), val);
          }
        });
        return { ...prev, [activeTmplTab]: rows };
      });
      setPasteFlash(true);
      setTimeout(() => setPasteFlash(false), 1200);
    } else {
      // Positional paste: fill from anchor (or 0,0)
      const anchorColIdx = selAnchor ? colsList.findIndex(c => c.key === selAnchor.col) : 0;
      const startCol = anchorColIdx < 0 ? 0 : anchorColIdx;
      setTmplData(prev => {
        const rows = [...(prev[activeTmplTab] ?? []).map(r => ({ ...r }))];
        for (let ri = 0; ri < parsed.length; ri++) {
          const pr = anchorRow + ri;
          while (pr >= rows.length) rows.push(empty(colsList));
          for (let ci = 0; ci < parsed[ri].length; ci++) {
            const pc = startCol + ci;
            if (pc >= colsList.length) break;
            rows[pr][colsList[pc].key] = canonCell(colsList[pc], (parsed[ri][ci] ?? "").trim());
          }
        }
        return { ...prev, [activeTmplTab]: rows };
      });
    }
    // Large-tenant: re-check IDs in case the ID column was touched.
    tmplPasteIdCheckRef.current?.();
    setEditing(null);
  }, [selAnchor, selActive, activeTmplTab, tabs, canonCell]);


  // ── File mode state (ALL hoisted — no conditional hooks) ───────────────
  const [fileMode, setFileMode] = useState(false);
  const [filename, setFilename] = useState("");
  const [uploading, setUploading] = useState(false);
  const [totalFileRows, setTotalFileRows] = useState(0);
  const [activeFileTab, setActiveFileTab] = useState(tabs[0].id);
  // Ref so mouseup closure can read current tab without stale capture
  const activeFileTabRef = useRef(tabs[0].id);
  useEffect(() => { activeFileTabRef.current = activeFileTab; }, [activeFileTab]);
  // Per-template-tab state keyed by tab.id
  const [fileTabStates, setFileTabStates] = useState<Record<string, TabFileState>>({});
  // Ref mirrors fileTabStates so async callbacks (e.g. deferred paste ID-check)
  // can always read the latest value without stale closure capture.
  const fileTabStatesRef = useRef<Record<string, TabFileState>>({});
  useEffect(() => { fileTabStatesRef.current = fileTabStates; }, [fileTabStates]);
  // Stable trigger for the deferred paste batch-check — updated whenever the
  // relevant deps change so the paste handler can call it without listing
  // checkTicketIds / isStandaloneRefCard / isTicketRefCol in its own dep array.
  const pasteIdCheckRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!checkTicketIds || !isStandaloneRefCard) { pasteIdCheckRef.current = null; return; }
    pasteIdCheckRef.current = () => {
      // Defer one tick so React has applied the paste's setState updates to
      // fileTabStatesRef before we read from it.
      setTimeout(() => {
        const fts = fileTabStatesRef.current;
        const idValues: string[] = [];
        for (const [tabId, ts] of Object.entries(fts)) {
          const tabDef = (fileTabs ?? baseTabs).find(t => t.id === tabId);
          const refKey = tabDef?.cols.find(c => isTicketRefCol(c.key))?.key;
          if (!refKey) continue;
          const idHeader = Object.entries(ts.mappings).find(([, k]) => k === refKey)?.[0];
          if (idHeader) {
            for (const row of ts.rows) {
              const v = String(row[idHeader] ?? "").trim();
              if (v) idValues.push(v);
            }
          }
          for (const ovr of Object.values(ts.cellOverrides ?? {})) {
            const v = String((ovr as Record<string, string>)[refKey] ?? "").trim();
            if (v) idValues.push(v);
          }
        }
        const unique = [...new Set(idValues)];
        if (!unique.length) return;
        checkTicketIds(unique)
          .then(found => setBatchCheckedIds(found))
          .catch(() => { /* fail open */ });
      }, 0);
    };
  }, [checkTicketIds, isStandaloneRefCard, isTicketRefCol, baseTabs, fileTabs]);

  // Stable trigger for the deferred paste batch-check in TEMPLATE mode —
  // reads from tmplDataRef so it always sees the latest rows without needing
  // to be recreated on every tmplData change.
  const tmplPasteIdCheckRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!checkTicketIds || !isStandaloneRefCard) { tmplPasteIdCheckRef.current = null; return; }
    tmplPasteIdCheckRef.current = () => {
      // Defer one tick so React has applied the paste's setTmplData update to
      // tmplDataRef before we read from it.
      setTimeout(() => {
        const data = tmplDataRef.current;
        const idValues: string[] = [];
        for (const [tabId, rows] of Object.entries(data)) {
          const tabDef = tabs.find(t => t.id === tabId);
          const refKey = tabDef?.cols.find(c => isTicketRefCol(c.key))?.key;
          if (!refKey) continue;
          for (const row of rows) {
            const v = String(row[refKey] ?? "").trim();
            if (v) idValues.push(v);
          }
        }
        const unique = [...new Set(idValues)];
        if (!unique.length) return;
        checkTicketIds(unique)
          .then(found => setBatchCheckedIds(found))
          .catch(() => { /* fail open — highlights stay absent */ });
      }, 0);
    };
  }, [checkTicketIds, isStandaloneRefCard, isTicketRefCol, tabs]);

  // Quarantined rows from Data-Cleaning review sheets — fixed + added one by
  // one via the "Needs attention" panel; never submitted while held here.
  const [heldRows, setHeldRows] = useState<HeldRow[]>([]);
  // Rows that joined the import AUTOMATICALLY when a project-name clash was
  // settled with "Keep selected ID" — they are already in the grid, and are
  // shown read-only on their tab (Team Assignments / Schedule) purely so the
  // user can see what was added for them. Rebuilt from saved decisions on
  // refresh; cleared on every fresh upload.
  const [autoAdded, setAutoAdded] = useState<HeldRow[]>([]);
  // Held-row cards whose "Type a different ID" box was manually revealed —
  // when candidate buttons exist, clicking is the default and typing is tucked away.
  const [typeOpenIds, setTypeOpenIds] = useState<Set<number>>(new Set());
  // Full-page review view: opens automatically when a cleaning run finishes,
  // holds the summary + the held-back rows grouped into per-module tabs.
  const [cleanResultsOpen, setCleanResultsOpen] = useState(false);
  // Same-name/different-ID project clashes: normalized title → user's verdict.
  // "keepBoth" lifts the duplicate-title upload block; "resolved" means the
  // losing row(s) were removed from this import. Persisted per cleaning
  // session in the held store under "clash:<name>" keys, replayed on refresh.
  const [clashDecisions, setClashDecisions] = useState<Record<string, "keepBoth" | "resolved">>({});
  // Name-clash table: which Project ID the user has ticked per clash group
  // (groupKey → selected id). Feeds the "Keep selected" button per row.
  const [clashPicks, setClashPicks] = useState<Record<string, string>>({});
  // "No ID yet" held row ticked as a clash survivor: the Project ID typed for
  // it, keyed by held-row id. Kept OFF the row's cells while typing so the row
  // stays in the no-ID list until the decision is actually taken.
  const [clashHeldIdInput, setClashHeldIdInput] = useState<Record<number, string>>({});
  const [activeHeldTab, setActiveHeldTab] = useState<string>("");
  // Review-view search + pagination (13k held rows must never render at once).
  const [heldSearch, setHeldSearch] = useState("");
  const [heldPage, setHeldPage] = useState(0);
  const [heldPageInput, setHeldPageInput] = useState("");
  useEffect(() => { setHeldPage(0); setHeldPageInput(""); }, [heldSearch, activeHeldTab]);
  // Keep held-tab in sync with the main tab bar so the inline review section
  // always shows the decisions for whichever tab is currently active.
  useEffect(() => {
    const label = tabs.find(t => t.id === activeFileTab)?.label;
    if (label) setActiveHeldTab(label);
  }, [activeFileTab, tabs]);
  // Held rows are now shown inline on each tab — no separate review overlay.
  // openReview / closeReview kept as stubs so call-sites (finishReview etc.) don't break.
  const openReview = useCallback(() => { setCleanResultsOpen(true); }, []);
  const closeReview = useCallback(() => { setCleanResultsOpen(false); }, []);
  useEffect(() => {
    const onPop = () => {
      if (new URLSearchParams(window.location.search).get("review") !== "1") setCleanResultsOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Virtualized file grid — ALL rows are always shown (Excel-like); only the
  // slice inside the scroll viewport is rendered as real DOM, so even 50k-row
  // files load instantly and scroll smoothly. FILE_ROW_H is the fixed row
  // height the top/bottom spacers assume — every data <tr> pins to it.
  const FILE_ROW_H = 30;
  const FILE_OVERSCAN = 12;
  const [vWin, setVWin] = useState({ start: 0, count: 70 });
  const fileGridScrollRef = useRef<HTMLDivElement | null>(null);
  const fileGridResizeObsRef = useRef<ResizeObserver | null>(null);
  // Callback ref: measures the viewport on mount and on resize so the render
  // window always covers the visible area (even on very tall screens).
  const fileGridScrollCb = useCallback((el: HTMLDivElement | null) => {
    fileGridScrollRef.current = el;
    fileGridResizeObsRef.current?.disconnect();
    fileGridResizeObsRef.current = null;
    if (!el) return;
    const measure = () => {
      const count = Math.ceil(el.clientHeight / FILE_ROW_H) + FILE_OVERSCAN * 2;
      setVWin(prev => prev.count >= count ? prev : { ...prev, count });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    fileGridResizeObsRef.current = ro;
  }, []);
  // Cache of the filtered row set, display→real index map and stable column
  // widths — rebuilt only when the rows / tab / column mapping change, never
  // on scroll re-renders (scanning 50k rows per frame would defeat the point).
  const fileGridCacheRef = useRef<{
    rows: Row[]; tabId: string; mapSig: string;
    effectiveRows: Row[]; realIdx: number[] | null; colWs: Record<string, number>;
  } | null>(null);
  const onFileGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const start = Math.max(0, Math.floor(el.scrollTop / FILE_ROW_H) - FILE_OVERSCAN);
    const count = Math.ceil(el.clientHeight / FILE_ROW_H) + FILE_OVERSCAN * 2;
    setVWin(prev => (prev.start === start && prev.count >= count)
      ? prev : { start, count: Math.max(count, prev.count) });
  }, []);
  // Per-tab search over the whole file grid. Cleared when the tab or file
  // changes; the filtered row set is cached in fileSearchCacheRef so scroll
  // re-renders never re-scan a 60k-row file.
  const [fileSearch, setFileSearch] = useState("");
  const fileSearchCacheRef = useRef<{
    base: Row[]; q: string; mapSig: string; rows: Row[]; realIdx: number[];
  } | null>(null);
  useEffect(() => { setFileSearch(""); }, [activeFileTab, filename]);
  useEffect(() => {
    setVWin({ start: 0, count: 70 });
    if (fileGridScrollRef.current) fileGridScrollRef.current.scrollTop = 0;
  }, [activeFileTab, filename, fileSearch]);
  // Range operations (delete/paste-fill/drag-fill) act on the contiguous
  // REAL-index span rMin..rMax — with a search active the visible rows are
  // non-contiguous, so a lingering selection would silently hit hidden rows.
  // Clear any selection whenever the search text changes.
  useEffect(() => {
    setFileSelAnchor(null); setFileSelActive(null); setFileEditCell(null);
  }, [fileSearch]);
  // Inline data-cleaning: progress while a fresh upload runs through the
  // cleaning engine, and the summary of the finished run (fixed / dupes /
  // review counts + session id for "Download cleaned Excel").
  const [cleaning, setCleaning] = useState<{ pct: number; msg: string; restore?: boolean } | null>(null);
  const [cleanSummary, setCleanSummary] = useState<{ sid: string; fixed: number; dupes: number; review: number; fallback?: boolean } | null>(null);
  // Columns the cleaning engine dropped + the user's destination picks,
  // keyed by `${sourceSheet}\u0000${header}` ("" / missing = leave out).
  const [droppedInfo, setDroppedInfo] = useState<DroppedInfo | null>(null);
  const [droppedPicks, setDroppedPicks] = useState<Record<string, string>>({});
  const [droppedTabSel, setDroppedTabSel] = useState<string>("");
  // Backend template labels per module (fetched once, powers the picker).
  const [templateCols, setTemplateCols] = useState<Record<string, string[]> | null>(null);
  const [recleaning, setRecleaning] = useState(false);
  // Styled in-app dialog that replaces browser alert()s.
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const cleaningRef = useRef(false);
  // Set by the popup's × button — checked by the status-poll loop so a
  // click stops the run (and any auto-restart) within one poll tick.
  const cleanCancelRef = useRef(false);
  // Set by the popup's "Skip cleaning" button — the run is cancelled like ×,
  // but the raw file is then loaded into the grid so the user can keep going.
  const cleanSkipRef = useRef(false);
  // Abort handle for the in-flight upload/download fetch. Without it the ×
  // button does nothing while the initial upload request is still pending
  // (the cancel ref is only checked by the status-poll loop, which hasn't
  // started yet) — the popup would sit at 3% and ignore every click.
  const cleanAbortRef = useRef<AbortController | null>(null);
  // Poll interval + mounted flags so an in-flight cleaning run stops cleanly
  // if the user navigates away mid-clean (no setState on unmounted component).
  const cleanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gridMountedRef = useRef(true);
  useEffect(() => () => {
    gridMountedRef.current = false;
    if (cleanPollRef.current) clearInterval(cleanPollRef.current);
  }, []);
  const [dragSrc, setDragSrc] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [matchTypes, setMatchTypes] = useState<Record<string, Record<string, "auto" | "manual" | "ai">>>({});
  const [aiMatchingTabs, setAiMatchingTabs] = useState<Set<string>>(new Set());
  // LLM-derived cross-tab hints: fileHeader → other-tab label (e.g. "Team Assignments")
  // Populated asynchronously after per-tab AI matching via /classify-cross-tab.
  const [crossTabHints, setCrossTabHints] = useState<Record<string, string>>({});
  // Schema validation error: set when an uploaded file contains unrecognised columns.
  const fileRef = useRef<HTMLInputElement>(null);

  // Submit-time snapshot under review: when the pre-import scan finds ANY
  // issue (missing IDs, bad values, exact duplicates, orphan child rows) the
  // Excel-style review grid opens on this snapshot instead of the old popups.
  const [validationReview, setValidationReview] = useState<SheetData[] | null>(null);
  const pendingImportFile = useRef<File | null>(null);
  const pendingImportRows = useRef<Record<string, Row[]> | null>(null);
  // The grid's own header→server-field map for the file in pendingImportFile —
  // set in the SAME place the file is built so the two can never drift apart.
  const pendingImportMappings = useRef<Record<string, Record<string, string>> | null>(null);
  // Instant click feedback: building the workbook + validating 60k+ rows is
  // heavy synchronous work, so the button/overlay must render BEFORE it runs.
  // `preparing` flips on in the click handler and the heavy submit is
  // deferred two frames so the spinner actually paints first.
  const [preparing, setPreparing] = useState(false);
  // Last concrete wizard step shown — keeps the wizard's step pills stable
  // while a busy transition (validation scan / group fetch / upload) runs.
  const lastWizardStepRef = useRef(1);
  // One-at-a-time latch for the async group-gate resolvers (staff + record
  // tabs): they fetch tenant groups BEFORE any popup renders. While one is in
  // flight it owns the `preparing` overlay — beginSubmit must not clear it
  // early, and a second submit must not start a competing resolution.
  const gateResolveBusyRef = useRef(false);
  // Pre-upload mapping confirmation popup state. Declared HERE (well before
  // the document-level paste/delete/copy handlers) so those effects can gate
  // on it without a TDZ crash — while the popup is open its data snapshot is
  // what uploads, so grid mutations behind the modal must be blocked.
  // Summary building + overlay JSX live next to submitFileData further down.
  const [mappingConfirm, setMappingConfirm] = useState<{
    data: { cols: ColDef[]; rows: Row[]; sheetName: string }[];
    tabs: {
      id: string;
      label: string;
      rowCount: number;
      mapped: { header: string; colLabel: string; colKey: string; warn: boolean; samples: string[]; fromAudit?: boolean }[];
      skipped: string[];
      /** Grid column keys the user matched by hand in the column-check step —
       *  highlighted in the "View in grid" peek so they can see exactly where
       *  their pick landed. */
      auditKeys?: string[];
    }[];
  } | null>(null);
  // Read-only "peek at the grid" popup — opened from wizard steps that cover
  // the grid (Review matches / Fix issues) so the user can check a decision
  // against the actual rows without leaving the step.
  const [gridPeek, setGridPeek] = useState<GridPeekState | null>(null);
  // Any submit failure must be LOUD. This chain used to be fire-and-forget:
  // a throw anywhere (Excel-engine chunk missing in a stale tab, unexpected
  // data, …) closed the overlay and did nothing — the user saw a flash and
  // no explanation.
  const reportSubmitError = useCallback((e: unknown) => {
    console.error("[import] submit failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    alert(`Upload could not start: ${msg}\n\nPlease refresh the page and try again.`);
  }, []);
  // Group-popup prompts are declared HERE (same reason as mappingConfirm
  // above): the document-level paste/delete/cut handlers gate on them, and
  // while either popup is open its pending-data snapshot is what uploads —
  // grid mutations behind the modal must be blocked. Their refs + logic live
  // next to the gates further down.
  const [groupAclPrompt, setGroupAclPrompt] = useState<{ groups: GroupAclGroup[]; tabIndex: number } | null>(null);
  const [recordGroupsPrompt, setRecordGroupsPrompt] = useState<GroupAclGroup[] | null>(null);
  const beginSubmit = useCallback((fn: () => void | Promise<void>) => {
    setPreparing(true);
    requestAnimationFrame(() => setTimeout(() => {
      let out: unknown;
      try { out = fn(); } catch (e) { setPreparing(false); reportSubmitError(e); return; }
      if (out instanceof Promise) {
        // Async submit (validation gate): keep the overlay up until it
        // settles — a popup, the review grid, or the upload takes over.
        out.then(() => {
          // A group-gate resolver may still be fetching (it latched inside
          // finishSubmit before this promise settled) — it owns the clear.
          if (!gateResolveBusyRef.current) setPreparing(false);
        }, (e) => { setPreparing(false); reportSubmitError(e); });
      } else {
        setPreparing(false);
      }
    }, 0));
  }, [reportSubmitError]);

  // One-shot: pressing Continue on the column-audit popup flows straight
  // into the upload confirm — no second "Upload N rows" click (continuous
  // import process). A state bump + effect (not a direct call) so the submit
  // runs AFTER the just-applied suggestion mappings have committed; the
  // effect's latest-render closure then reads the fresh fileTabStates. The
  // popup's X close keeps the old behavior (stay on the grid to edit).
  const [auditAutoSubmit, setAuditAutoSubmit] = useState(0);
  useEffect(() => {
    if (!auditAutoSubmit) return;
    setAuditAutoSubmit(0);
    if (!fileMode || isSubmitting || preparing) return;
    beginSubmit(submitFileData);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot trigger; reads latest closures on purpose
  }, [auditAutoSubmit]);

  // True when this card has previously-imported rows saved in localStorage.
  // Used to decide whether to show the mode-picker dialog: a fresh tenant
  // (no prior data) should skip the dialog and go straight to "create".
  const hasLocalData = useMemo(() => {
    try {
      // FRESH_START: saved drafts are never restored, so they don't count as
      // local data either (keeps the mode-picker decision consistent).
      if (FRESH_START_ALWAYS) return false;
      const saved = localStorage.getItem(gridStorageKey(cardId));
      if (!saved) return false;
      const parsed = JSON.parse(saved) as Record<string, Row[]>;
      // Built-in sample rows saved by older versions don't count as data.
      return Object.values(parsed).some((rows) => (rows ?? []).filter(r => r && !isBuiltinSampleRow(r)).length > 0);
    } catch { return false; }
  }, [cardId]);

  // ── file-mode manual rows ────────────────────────────────────────────────
  // "Add Row" in file mode APPENDS a blank row at the END of the active tab.
  // The marker key (never a real file header) lets the main-tab strong-field
  // filter keep the blank row visible while the user fills it in, and lets the
  // preview keep it on screen even past the 50-row display cap. Appending (not
  // prepending) keeps all existing cellOverrides row indices stable.
  const addFileRow = useCallback(() => {
    const tabId = activeFileTabRef.current;
    setFileTabStates(prev => {
      const ts = prev[tabId];
      if (!ts) return prev;
      return {
        ...prev,
        [tabId]: { ...ts, rows: [...ts.rows, { [MANUAL_ROW_KEY]: "1" }] },
      };
    });
    setTotalFileRows(n => n + 1);
  }, []);

  // ── cell override setter ─────────────────────────────────────────────────
  const setCellOverride = useCallback((tabId: string, rowIdx: number, colKey: string, value: string) => {
    const col = tabs.find(t => t.id === tabId)?.cols.find(c => c.key === colKey);
    const v = canonCell(col, value);
    setFileTabStates(prev => {
      const ts = prev[tabId];
      if (!ts) return prev;
      const rowOverrides = { ...(ts.cellOverrides[rowIdx] ?? {}), [colKey]: v };
      return { ...prev, [tabId]: { ...ts, cellOverrides: { ...ts.cellOverrides, [rowIdx]: rowOverrides } } };
    });
    // Large-tenant path: re-check IDs so highlights stay current after any
    // cell edit (pasteIdCheckRef is null when checkTicketIds isn't set, making
    // this a no-op for small tenants whose as-you-type path already handles it).
    pasteIdCheckRef.current?.();
  }, [tabs, canonCell]);

  // ── Excel-style row operations (context menu) ────────────────────────────
  // File mode: ts.rows and cellOverrides are keyed by ROW INDEX, so inserting
  // or deleting rows must re-key every override at/after the splice point.
  // Plain functions (not useCallback) so they always read fresh state.
  const insertFileRowAt = (at: number) => {
    const ts = fileTabStates[activeFileTab];
    if (!ts) return;
    const idx = Math.max(0, Math.min(at, ts.rows.length));
    setFileTabStates(prev => {
      const cur = prev[activeFileTab];
      if (!cur) return prev;
      const rows = [...cur.rows];
      rows.splice(idx, 0, { [MANUAL_ROW_KEY]: "1" });
      const newOvr: typeof cur.cellOverrides = {};
      for (const [k, v] of Object.entries(cur.cellOverrides)) {
        const ri = Number(k);
        newOvr[ri >= idx ? ri + 1 : ri] = v;
      }
      return { ...prev, [activeFileTab]: { ...cur, rows, cellOverrides: newOvr } };
    });
    setTotalFileRows(n => n + 1);
    const cols = (tabs.find(tb => tb.id === activeFileTab) ?? tabs[0]).cols;
    if (cols.length) { setFileSelAnchor({ rowIdx: idx, colKey: cols[0].key }); setFileSelActive(null); }
    setFileEditCell(null);
    pasteIdCheckRef.current?.();
  };

  const deleteFileRows = (rMin: number, rMax: number) => {
    const ts = fileTabStates[activeFileTab];
    if (!ts) return;
    const lo = Math.max(0, rMin);
    const hi = Math.min(ts.rows.length - 1, rMax);
    if (hi < lo) return;
    const count = hi - lo + 1;
    setFileTabStates(prev => {
      const cur = prev[activeFileTab];
      if (!cur) return prev;
      const rows = cur.rows.filter((_, i) => i < lo || i > hi);
      const newOvr: typeof cur.cellOverrides = {};
      for (const [k, v] of Object.entries(cur.cellOverrides)) {
        const ri = Number(k);
        if (ri < lo) newOvr[ri] = v;
        else if (ri > hi) newOvr[ri - count] = v;
      }
      return { ...prev, [activeFileTab]: { ...cur, rows, cellOverrides: newOvr } };
    });
    setTotalFileRows(n => Math.max(0, n - count));
    setFileSelAnchor(null); setFileSelActive(null); setFileEditCell(null);
    pasteIdCheckRef.current?.();
  };

  const insertTmplRowAt = (at: number) => {
    const tabCols = (tabs.find(tb => tb.id === activeTmplTab) ?? tabs[0]).cols;
    setTmplData(prev => {
      const rows = [...(prev[activeTmplTab] ?? [])];
      const idx = Math.max(0, Math.min(at, rows.length));
      rows.splice(idx, 0, empty(tabCols));
      return { ...prev, [activeTmplTab]: rows };
    });
    const idx = Math.max(0, Math.min(at, (tmplData[activeTmplTab] ?? []).length));
    if (tabCols.length) { setSelAnchor({ row: idx, col: tabCols[0].key }); setSelActive(null); }
    setEditing(null);
  };

  const deleteTmplRows = (rMin: number, rMax: number) => {
    const tabCols = (tabs.find(tb => tb.id === activeTmplTab) ?? tabs[0]).cols;
    setTmplData(prev => {
      const cur = prev[activeTmplTab] ?? [];
      const rows = cur.filter((_, i) => i < rMin || i > rMax);
      // Never leave a template tab with zero rows — keep one blank row.
      return { ...prev, [activeTmplTab]: rows.length ? rows : [empty(tabCols)] };
    });
    setSelAnchor(null); setSelActive(null); setEditing(null);
  };

  // ── Right-click → Excel-style context menu ───────────────────────────────
  // Resolves the clicked cell from the DOM (tr[data-row-idx] + td.cellIndex;
  // column 0 is the row-number gutter), moves the selection like Excel does
  // (click outside the selection moves it; inside keeps the range; gutter
  // selects the whole row), then opens the shared menu.
  const openCtxMenu = (e: React.MouseEvent, mode: "file" | "tmpl") => {
    const t = e.target as HTMLElement;
    // Inside a cell editor keep the browser's native text-editing menu.
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
    const td = (t.closest?.("td") ?? null) as HTMLTableCellElement | null;
    const tr = (td?.closest("tr[data-row-idx]") ?? null) as HTMLTableRowElement | null;
    const cols = mode === "file"
      ? (tabs.find(tb => tb.id === activeFileTab) ?? tabs[0]).cols
      : (tabs.find(tb => tb.id === activeTmplTab) ?? tabs[0]).cols;
    let cell: { rowIdx: number; colKey: string | null } | null = null;
    if (td && tr) {
      const ri = Number(tr.getAttribute("data-row-idx"));
      const ci = td.cellIndex - 1;
      if (Number.isFinite(ri)) cell = { rowIdx: ri, colKey: ci >= 0 ? (cols[ci]?.key ?? null) : null };
    }
    const hasSel = mode === "file" ? fileSelAnchor !== null : selAnchor !== null;
    if (!cell && !hasSel) return; // nothing to act on → browser menu
    e.preventDefault();
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) ae.blur(); // commit pending edit
    if (cell) {
      if (cell.colKey === null) {
        // Row-number gutter → select the entire row.
        if (cols.length) {
          if (mode === "file") {
            setFileSelAnchor({ rowIdx: cell.rowIdx, colKey: cols[0].key });
            setFileSelActive({ rowIdx: cell.rowIdx, colKey: cols[cols.length - 1].key });
            setFileEditCell(null);
          } else {
            setSelAnchor({ row: cell.rowIdx, col: cols[0].key });
            setSelActive({ row: cell.rowIdx, col: cols[cols.length - 1].key });
            setEditing(null);
          }
        }
      } else {
        const anchor = mode === "file"
          ? (fileSelAnchor ? { row: fileSelAnchor.rowIdx, col: fileSelAnchor.colKey } : null)
          : (selAnchor ? { row: selAnchor.row, col: selAnchor.col } : null);
        const act = mode === "file"
          ? (fileSelActive ? { row: fileSelActive.rowIdx, col: fileSelActive.colKey } : null)
          : (selActive ? { row: selActive.row, col: selActive.col } : null);
        const aCi = anchor ? cols.findIndex(c => c.key === anchor.col) : -1;
        const bCi = act ? cols.findIndex(c => c.key === act.col) : aCi;
        const rLo = anchor ? Math.min(anchor.row, act?.row ?? anchor.row) : -1;
        const rHi = anchor ? Math.max(anchor.row, act?.row ?? anchor.row) : -1;
        const ci = cols.findIndex(c => c.key === cell!.colKey);
        const inside = !!anchor && cell.rowIdx >= rLo && cell.rowIdx <= rHi
          && ci >= Math.min(aCi, bCi) && ci <= Math.max(aCi, bCi);
        if (!inside) {
          if (mode === "file") { setFileSelAnchor({ rowIdx: cell.rowIdx, colKey: cell.colKey }); setFileSelActive(null); setFileEditCell(null); }
          else { setSelAnchor({ row: cell.rowIdx, col: cell.colKey }); setSelActive(null); setEditing(null); }
        }
      }
    }
    setPasteHint(null);
    setContextMenu({ x: e.clientX, y: e.clientY, cell });
  };

  // ── file-mode paste ──────────────────────────────────────────────────────
  const handleFilePaste = useCallback((e: React.ClipboardEvent | ClipboardEvent) => {
    const text = (e as React.ClipboardEvent).clipboardData?.getData("text/plain")
      ?? (e as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd().split("\n");
    const parsed = lines.map(l => l.split("\t"));
    const isMultiCell = parsed.length > 1 || (parsed[0]?.length ?? 0) > 1;
    const tabDef = tabs.find(t => t.id === activeFileTab);
    const ts = fileTabStates[activeFileTab];
    if (!tabDef || !ts) return;
    const colsList = tabDef.cols;
    if (!isMultiCell) {
      // Single-cell paste — fill the selected range (Excel semantics).
      const activeEl = document.activeElement;
      if (activeEl && ["INPUT", "TEXTAREA", "SELECT"].includes(activeEl.tagName)) return;
      if (!fileSelAnchor) return;
      e.preventDefault();
      const val = (parsed[0]?.[0] ?? "").trim();
      const aCi = colsList.findIndex(c => c.key === fileSelAnchor.colKey);
      const bCi = fileSelActive ? colsList.findIndex(c => c.key === fileSelActive.colKey) : aCi;
      const rMin = Math.min(fileSelAnchor.rowIdx, fileSelActive?.rowIdx ?? fileSelAnchor.rowIdx);
      const rMax = Math.max(fileSelAnchor.rowIdx, fileSelActive?.rowIdx ?? fileSelAnchor.rowIdx);
      const cMin = Math.min(aCi, bCi);
      const cMax = Math.max(aCi, bCi);
      if (cMin < 0) return;
      setFileTabStates(prev => {
        const cur = prev[activeFileTab];
        if (!cur) return prev;
        const newOverrides = { ...cur.cellOverrides };
        for (let ri = rMin; ri <= rMax; ri++) {
          const rowOvr: Record<string, string> = { ...(newOverrides[ri] ?? {}) };
          for (let ci = cMin; ci <= cMax; ci++) { const cd = colsList[ci]; if (cd) rowOvr[cd.key] = canonCell(cd, val); }
          newOverrides[ri] = rowOvr;
        }
        return { ...prev, [activeFileTab]: { ...cur, cellOverrides: newOverrides } };
      });
      setPasteFlash(true);
      setTimeout(() => setPasteFlash(false), 600);
      // Large-tenant: re-check IDs in case the ID column was touched.
      pasteIdCheckRef.current?.();
      return;
    }
    e.preventDefault();
    const firstRow = parsed[0] ?? [];
    const headerMap: Record<number, string> = {};
    for (let ci = 0; ci < firstRow.length; ci++) {
      const k = autoMapToColDef(firstRow[ci], colsList);
      if (k !== SKIP) headerMap[ci] = k;
    }
    const isHeaderPaste = Object.keys(headerMap).length >= Math.min(2, firstRow.filter(c => c.trim()).length);
    const anchorRow = fileSelAnchor?.rowIdx ?? 0;
    // Pasting more rows than exist (e.g. anchored on a manual "Add Row" row at
    // the end) must EXTEND ts.rows — overrides on non-existent rows are never
    // read by submitFileData, so without this the extra rows silently vanish.
    const extendRows = (rows: Row[], needed: number): Row[] =>
      rows.length >= needed
        ? rows
        : [...rows, ...Array.from({ length: needed - rows.length }, () => ({ [MANUAL_ROW_KEY]: "1" }))];
    if (isHeaderPaste) {
      const dataRows = parsed.slice(1);
      setFileTabStates(prev => {
        const cur = prev[activeFileTab];
        if (!cur) return prev;
        const newOverrides = { ...cur.cellOverrides };
        dataRows.forEach((cells, di) => {
          const ri = anchorRow + di;
          const row: Record<string, string> = { ...(newOverrides[ri] ?? {}) };
          Object.entries(headerMap).forEach(([ci, k]) => { row[k] = canonCell(colsList.find(c => c.key === k), cells[+ci] ?? ""); });
          newOverrides[ri] = row;
        });
        return { ...prev, [activeFileTab]: { ...cur, rows: extendRows(cur.rows, anchorRow + dataRows.length), cellOverrides: newOverrides } };
      });
      setTotalFileRows(n => Math.max(n, anchorRow + dataRows.length));
    } else {
      const anchorColIdx = fileSelAnchor ? colsList.findIndex(c => c.key === fileSelAnchor.colKey) : 0;
      setFileTabStates(prev => {
        const cur = prev[activeFileTab];
        if (!cur) return prev;
        const newOverrides = { ...cur.cellOverrides };
        parsed.forEach((cells, di) => {
          const ri = anchorRow + di;
          const row: Record<string, string> = { ...(newOverrides[ri] ?? {}) };
          cells.forEach((val, ci) => {
            const colDef = colsList[anchorColIdx + ci];
            if (colDef) row[colDef.key] = canonCell(colDef, val);
          });
          newOverrides[ri] = row;
        });
        return { ...prev, [activeFileTab]: { ...cur, rows: extendRows(cur.rows, anchorRow + parsed.length), cellOverrides: newOverrides } };
      });
      setTotalFileRows(n => Math.max(n, anchorRow + parsed.length));
    }
    setPasteFlash(true);
    setTimeout(() => setPasteFlash(false), 600);
    // Large-tenant: re-check IDs in case the ID column was touched.
    pasteIdCheckRef.current?.();
  }, [activeFileTab, fileTabStates, fileSelAnchor, fileSelActive, tabs, canonCell]);

  // ── Global paste listener — fires for BOTH modes when focus is lost (e.g. right-click Paste) ─
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      // Snapshot modal open (pre-upload confirm / group popups) or a submit
      // gate is resolving (`preparing`) → the captured data snapshot is what
      // uploads; block paste edits so screen and upload never differ.
      if (mappingConfirm || groupAclPrompt || recordGroupsPrompt || preparing) return;
      const active = document.activeElement;
      const inInput = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      if (fileMode) {
        // File mode: skip if an editing input is focused (its own onPaste handles it)
        if (inInput) return;
        handleFilePaste(e);
      } else {
        // Template mode: for multi-cell paste, always intercept (right-click loses focus)
        const text = e.clipboardData?.getData("text/plain") ?? "";
        const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd().split("\n");
        const parsed = lines.map(l => l.split("\t"));
        const isMultiCell = parsed.length > 1 || (parsed[0]?.length ?? 0) > 1;
        // Single-cell paste into a focused editor input stays native; on a
        // selected-but-not-editing cell it's handled by handleGridPaste.
        if (!isMultiCell && inInput) return;
        handleGridPaste(e as unknown as React.ClipboardEvent);
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [fileMode, handleFilePaste, handleGridPaste, mappingConfirm, groupAclPrompt, recordGroupsPrompt, preparing]);

  // ── Delete / Backspace clears selected range (both template mode and file mode) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Snapshot modal open or a submit gate resolving → block delete/clear
      // (the captured data snapshot is what uploads; keep screen in sync).
      if (mappingConfirm || groupAclPrompt || recordGroupsPrompt || preparing) return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      // Escape → clear selection without modifying data
      if (e.key === "Escape") {
        if (fileMode) { setFileSelAnchor(null); setFileSelActive(null); }
        else          { setSelAnchor(null);     setSelActive(null);     }
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      if (fileMode) {
        if (!fileSelAnchor) return;
        const tabDef = tabs.find(t => t.id === activeFileTab);
        if (!tabDef) return;
        const colsList = tabDef.cols;
        const anchorCi = colsList.findIndex(c => c.key === fileSelAnchor.colKey);
        const activeCi = fileSelActive ? colsList.findIndex(c => c.key === fileSelActive.colKey) : anchorCi;
        const activeRiEnd = fileSelActive?.rowIdx ?? fileSelAnchor.rowIdx;
        const rMin = Math.min(fileSelAnchor.rowIdx, activeRiEnd);
        const rMax = Math.max(fileSelAnchor.rowIdx, activeRiEnd);
        const cMin = Math.min(anchorCi, activeCi);
        const cMax = Math.max(anchorCi, activeCi);
        setFileTabStates(prev => {
          const cur = prev[activeFileTab];
          if (!cur) return prev;
          const newOverrides = { ...cur.cellOverrides };
          for (let ri = rMin; ri <= rMax; ri++) {
            const rowOvr: Record<string, string> = { ...(newOverrides[ri] ?? {}) };
            for (let ci = cMin; ci <= cMax; ci++) { const k = colsList[ci]?.key; if (k) rowOvr[k] = ""; }
            newOverrides[ri] = rowOvr;
          }
          return { ...prev, [activeFileTab]: { ...cur, cellOverrides: newOverrides } };
        });
        // Large-tenant: clearing cells may remove ID values — re-check so
        // highlights reflect the current state (no-op when checkTicketIds unset).
        pasteIdCheckRef.current?.();
      } else {
        if (!selAnchor) return;
        const tmplCols = (tabs.find(t => t.id === activeTmplTab) ?? tabs[0]).cols;
        const anchorCi = tmplCols.findIndex(c => c.key === selAnchor.col);
        const activeCi = selActive ? tmplCols.findIndex(c => c.key === selActive.col) : anchorCi;
        const activeRiEnd = selActive?.row ?? selAnchor.row;
        const rMin = Math.min(selAnchor.row, activeRiEnd);
        const rMax = Math.max(selAnchor.row, activeRiEnd);
        const cMin = Math.min(anchorCi, activeCi);
        const cMax = Math.max(anchorCi, activeCi);
        setTmplData(prev => ({
          ...prev,
          [activeTmplTab]: (prev[activeTmplTab] ?? []).map((r, i) => {
            if (i < rMin || i > rMax) return r;
            const updated = { ...r };
            for (let ci = cMin; ci <= cMax; ci++) { const k = tmplCols[ci]?.key; if (k) updated[k] = ""; }
            return updated;
          }),
        }));
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fileMode, fileSelAnchor, fileSelActive, activeFileTab, tabs, selAnchor, selActive, activeTmplTab, mappingConfirm, groupAclPrompt, recordGroupsPrompt, preparing]);

  // ── Copy (Ctrl/Cmd+C) — copies selected range to clipboard as TSV ────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Snapshot modal open or a submit gate resolving → let native copy work
      // on the popup's own text and block cut-clearing the grid behind it.
      if (mappingConfirm || groupAclPrompt || recordGroupsPrompt || preparing) return;
      const isCut = e.key === "x";
      if (!((e.key === "c" || isCut) && (e.ctrlKey || e.metaKey))) return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      let tsv = "";
      if (fileMode) {
        if (!fileSelAnchor) return;
        const tabDef = tabs.find(t => t.id === activeFileTab);
        const ts = fileTabStates[activeFileTab];
        if (!tabDef || !ts) return;
        const colsList = tabDef.cols;
        const anchorCi = colsList.findIndex(c => c.key === fileSelAnchor.colKey);
        const activeCi = fileSelActive ? colsList.findIndex(c => c.key === fileSelActive.colKey) : anchorCi;
        const activeRiEnd = fileSelActive?.rowIdx ?? fileSelAnchor.rowIdx;
        const rMin = Math.min(fileSelAnchor.rowIdx, activeRiEnd);
        const rMax = Math.max(fileSelAnchor.rowIdx, activeRiEnd);
        const cMin = Math.min(anchorCi, activeCi);
        const cMax = Math.max(anchorCi, activeCi);
        const allRows = ts.rows ?? [];
        const fv = ts.fixedValues ?? {};
        const overrides = ts.cellOverrides ?? {};
        const revMap: Record<string, string> = {};
        for (const [h, k] of Object.entries(ts.mappings)) { if (k !== SKIP) revMap[k] = h; }
        const rows: string[][] = [];
        for (let ri = rMin; ri <= rMax; ri++) {
          const fileRow = allRows[ri] ?? {};
          const row: string[] = [];
          for (let ci = cMin; ci <= cMax; ci++) {
            const col = colsList[ci]; if (!col) continue;
            const override = overrides[ri]?.[col.key];
            const fileVal = revMap[col.key] ? (fileRow[revMap[col.key]] ?? "") : (fv[col.key] ?? "");
            row.push(override !== undefined ? override : fileVal);
          }
          rows.push(row);
        }
        tsv = rows.map(r => r.join("\t")).join("\n");
      } else {
        if (!selAnchor) return;
        const tabDef = tabs.find(t => t.id === activeTmplTab);
        if (!tabDef) return;
        const colsList = tabDef.cols;
        const anchorCi = colsList.findIndex(c => c.key === selAnchor.col);
        const activeCi = selActive ? colsList.findIndex(c => c.key === selActive.col) : anchorCi;
        const activeRiEnd = selActive?.row ?? selAnchor.row;
        const rMin = Math.min(selAnchor.row, activeRiEnd);
        const rMax = Math.max(selAnchor.row, activeRiEnd);
        const cMin = Math.min(anchorCi, activeCi);
        const cMax = Math.max(anchorCi, activeCi);
        const tmplRows = tmplData[activeTmplTab] ?? [];
        const rows: string[][] = [];
        for (let ri = rMin; ri <= rMax; ri++) {
          const row: string[] = [];
          for (let ci = cMin; ci <= cMax; ci++) row.push(tmplRows[ri]?.[colsList[ci]?.key ?? ""] ?? "");
          rows.push(row);
        }
        tsv = rows.map(r => r.join("\t")).join("\n");
      }
      if (!tsv) return;
      e.preventDefault();
      navigator.clipboard.writeText(tsv).catch(() => {});
      if (!isCut) return;
      // Ctrl/Cmd+X — Excel cut semantics: copy the range, then clear it.
      if (fileMode) {
        if (!fileSelAnchor) return;
        const tabDef = tabs.find(t => t.id === activeFileTab);
        if (!tabDef) return;
        const colsList = tabDef.cols;
        const anchorCi = colsList.findIndex(c => c.key === fileSelAnchor.colKey);
        const activeCi = fileSelActive ? colsList.findIndex(c => c.key === fileSelActive.colKey) : anchorCi;
        const activeRiEnd = fileSelActive?.rowIdx ?? fileSelAnchor.rowIdx;
        const rMin = Math.min(fileSelAnchor.rowIdx, activeRiEnd);
        const rMax = Math.max(fileSelAnchor.rowIdx, activeRiEnd);
        const cMin = Math.min(anchorCi, activeCi);
        const cMax = Math.max(anchorCi, activeCi);
        setFileTabStates(prev => {
          const cur = prev[activeFileTab];
          if (!cur) return prev;
          const newOverrides = { ...cur.cellOverrides };
          for (let ri = rMin; ri <= rMax; ri++) {
            const rowOvr: Record<string, string> = { ...(newOverrides[ri] ?? {}) };
            for (let ci = cMin; ci <= cMax; ci++) { const k = colsList[ci]?.key; if (k) rowOvr[k] = ""; }
            newOverrides[ri] = rowOvr;
          }
          return { ...prev, [activeFileTab]: { ...cur, cellOverrides: newOverrides } };
        });
      } else {
        if (!selAnchor) return;
        const tmplCols = (tabs.find(t => t.id === activeTmplTab) ?? tabs[0]).cols;
        const anchorCi = tmplCols.findIndex(c => c.key === selAnchor.col);
        const activeCi = selActive ? tmplCols.findIndex(c => c.key === selActive.col) : anchorCi;
        const activeRiEnd = selActive?.row ?? selAnchor.row;
        const rMin = Math.min(selAnchor.row, activeRiEnd);
        const rMax = Math.max(selAnchor.row, activeRiEnd);
        const cMin = Math.min(anchorCi, activeCi);
        const cMax = Math.max(anchorCi, activeCi);
        setTmplData(prev => ({
          ...prev,
          [activeTmplTab]: (prev[activeTmplTab] ?? []).map((r, i) => {
            if (i < rMin || i > rMax) return r;
            const updated = { ...r };
            for (let ci = cMin; ci <= cMax; ci++) { const k = tmplCols[ci]?.key; if (k) updated[k] = ""; }
            return updated;
          }),
        }));
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fileMode, fileSelAnchor, fileSelActive, activeFileTab, tabs, fileTabStates, selAnchor, selActive, activeTmplTab, tmplData, mappingConfirm, groupAclPrompt, recordGroupsPrompt, preparing]);

  // ── Context menu dismissal — outside click / Esc / scroll / window blur ──
  useEffect(() => {
    if (!contextMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!ctxMenuRef.current?.contains(e.target as Node)) setContextMenu(null);
    };
    // Capture phase so Esc closes ONLY the menu (the bubble-phase Esc handler
    // would also clear the cell selection).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setContextMenu(null);
    };
    const onScroll = () => setContextMenu(null);
    const onBlur = () => setContextMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [contextMenu]);

  // ── Download styled template XLSX (ExcelJS — matches card quality) ──────
  const downloadGridTemplate = useCallback(async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "RM ONE";
    wb.created = new Date();

    for (const tab of tabs) {
      const ws = wb.addWorksheet(tab.sheetName, {
        views: [{ state: "frozen", ySplit: 1 }],
      });

      // Set column widths directly (avoids the blank row that `ws.columns` inserts)
      tab.cols.forEach((c, i) => {
        ws.getColumn(i + 1).width = Math.round(c.w / 7);
      });

      // ── Header row (row 1) ────────────────────────────────────────────
      const headerRow = ws.addRow(tab.cols.map(c => c.label));
      headerRow.height = 22;
      headerRow.eachCell(cell => {
        cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
        cell.border    = { bottom: { style: "thin", color: { argb: "FF3730A3" } } };
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
      });

      // ── Sample data rows ──────────────────────────────────────────────
      // Templates ALWAYS contain the 2 built-in example rows per tab —
      // never live/previously-imported grid data.
      const sampleRows = sampleRowsFor(cardId, tab.id);

      sampleRows.forEach((r, i) => {
        const row = ws.addRow(tab.cols.map(c => r[c.key] ?? ""));
        row.height = 18;
        const bg = i % 2 === 0 ? "FFFFFFFF" : "FFF5F3FF";
        row.eachCell({ includeEmpty: true }, cell => {
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          cell.font      = { size: 10, name: "Calibri", color: { argb: "FF374151" } };
          cell.alignment = { vertical: "middle" };
          cell.border    = { bottom: { style: "hair", color: { argb: "FFE5E7EB" } } };
        });
      });

      // ── 3 blank entry rows (matches card view) ────────────────────────
      for (let i = 0; i < 3; i++) {
        const row = ws.addRow(tab.cols.map(() => ""));
        row.height = 18;
        row.eachCell({ includeEmpty: true }, cell => {
          cell.border = { bottom: { style: "hair", color: { argb: "FFE5E7EB" } } };
        });
      }

      // ── Date validation on every "date" column ─────────────────────────
      // Excel's native calendar picker only shows on cells with type:"date"
      // data validation AND only on Windows desktop Excel (Mac/web/mobile
      // never show a calendar UI even with validation present — that's an
      // Excel limitation, not something we can change). errorStyle:"error"
      // (hard stop) is required — "warning" lets the user click through and
      // keep typed-in text like "dsasd", which defeats the point of validation.
      // We also pre-format the column as a date and add an input hint so the
      // expected format is obvious before the user types anything.
      const lastDataRow = ws.rowCount;
      const extraBlankRows = 200; // pre-validate well past the visible rows so pasted/added rows stay protected
      const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      tab.cols.forEach((c, i) => {
        if (c.type !== "date") return;
        const col = i + 1;
        for (let r = 2; r <= lastDataRow + extraBlankRows; r++) {
          const cell = ws.getCell(r, col);
          // Excel's calendar-picker icon only activates on cells whose value
          // is a real date (or a blank date-validated cell) — plain text
          // sample dates like "2026-07-01" never trigger it. Convert.
          if (typeof cell.value === "string" && ISO_DATE_RE.test(cell.value.trim())) {
            const [y, m, d] = cell.value.trim().split("-").map(Number);
            cell.value = new Date(y, m - 1, d);
          }
          cell.numFmt = "m/d/yyyy";
          cell.dataValidation = {
            type: "date",
            operator: "greaterThan",
            formulae: [new Date(1900, 0, 1)],
            allowBlank: true,
            showErrorMessage: true,
            errorStyle: "error",
            errorTitle: "Invalid date",
            error: "Please enter a valid date (e.g. 3/15/2026). Text is not allowed in this column.",
            showInputMessage: true,
            promptTitle: "Date required",
            prompt: "Enter a date, e.g. 3/15/2026.",
          };
        }
      });

      // ── List + numeric validation (shared helper — matches card builder) ──
      applyListAndNumberValidation(ws, tab.cols, lastDataRow + extraBlankRows);
    }

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    const a = document.createElement("a");
    a.href = url; a.download = `${cardId}_template.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }, [tabs, cardId]);

  // ── File parsing ──────────────────────────────────────────────────────
  // ── Core file parser — shared by handleFile (user pick) and initialFile effect ─
  const processFile = useCallback(async (file: File, skipAiMatching = false, decisions?: HeldDecisions) => {
    setUploading(true);
    // Consume the fresh-upload flag up front — early returns (empty file,
    // bad dates) must not leave it armed for a later non-upload run.
    const freshUpload = freshUploadRef.current;
    freshUploadRef.current = false;
    try {
      // Load client-added synonyms BEFORE classifying headers so aliases from
      // the Synonyms manager participate in auto-mapping (non-fatal on error).
      await ensureCustomSynonyms();
      const XLSX = await loadXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const rawSheets = wb.SheetNames.map(name => {
        const ws = wb.Sheets[name];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
        if (!raw.length) return { name, headers: [] as string[], nonBlank: [] as Row[], real: [] as Row[] };
        const headers = Object.keys(raw[0]);
        const rows = raw.map(r => {
          const o: Row = {};
          for (const h of headers) {
            const v = r[h];
            if (v instanceof Date) {
              // SheetJS (cellDates) builds these as LOCAL midnight, but with a
              // small historical-timezone drift that can land a few seconds
              // BEFORE midnight (e.g. 23:59:50 in Asia/Kolkata) — reading the
              // local date then yields the PREVIOUS day, silently shifting
              // every imported date back by one. Snap forward to the next
              // local midnight when within 2h of it, then read local parts.
              const DAY = 86400000;
              const sinceMidnight = ((v.getHours() * 60 + v.getMinutes()) * 60 + v.getSeconds()) * 1000 + v.getMilliseconds();
              const dd = sinceMidnight >= DAY - 2 * 3600000
                ? new Date(v.getTime() + (DAY - sinceMidnight))
                : v;
              const yr = dd.getFullYear();
              const mo = String(dd.getMonth() + 1).padStart(2, "0");
              const dy = String(dd.getDate()).padStart(2, "0");
              o[h] = `${yr}-${mo}-${dy}`;
            } else {
              o[h] = String(v ?? "").trim();
            }
          }
          return o;
        });
        // Excel often carries formatted-but-empty trailing rows (e.g. a template
        // pre-formatted through row 20+ with only 2 rows actually filled in).
        // sheet_to_json's defval:"" turns those into fully-blank row objects —
        // drop any row where every cell is blank so the grid's row count and
        // preview reflect only real data, not phantom empty rows.
        const nonBlank = rows.filter(o => Object.values(o).some(v => String(v ?? "").trim() !== ""));
        // Built-in template example rows must never sneak into a real import.
        const real = nonBlank.filter(o => !isBuiltinSampleRow(o));
        return { name, headers, nonBlank, real };
      }).filter(s => s.headers.length > 0);
      // If stripping the example rows would wipe the ENTIRE file, the user
      // deliberately uploaded our sample data (e.g. test-driving the import
      // with the sample workbook). Loading an empty grid there is a dead end
      // — keep the rows, flag them in the status bar, and let the upload-time
      // guards wave them through for this file only.
      const totalNonBlank = rawSheets.reduce((a, s) => a + s.nonBlank.length, 0);
      const totalReal = rawSheets.reduce((a, s) => a + s.real.length, 0);
      const keepSamples = totalReal === 0 && totalNonBlank > 0;
      allowSampleRowsRef.current = keepSamples;
      const sheets: ParsedSheet[] = rawSheets.map(s => ({
        name: s.name,
        headers: s.headers,
        rows: keepSamples ? s.nonBlank : s.real,
      }));
      setSampleSkipCount(keepSamples ? 0 : totalNonBlank - totalReal);
      setSampleKeptCount(keepSamples ? totalNonBlank : 0);

      // ── Review-sheet partition (MUST run before anything else) ──────────
      // "<Tab> — Review" sheets hold quarantined rows from Data Cleaning.
      // Keep them out of classification entirely — they'd content-score into
      // the main tab and silently rejoin the import.
      const reviewSheets = sheets.filter(s => REVIEW_SHEET_RE.test(s.name));
      const cleanSheets  = sheets.filter(s => !REVIEW_SHEET_RE.test(s.name));
      const reviewBase   = (s: ParsedSheet) => s.name.replace(REVIEW_SHEET_RE, "").trim();

      if (!cleanSheets.length && !reviewSheets.length) {
        setNotice({ title: "Empty file", message: "This file doesn't appear to contain any data rows." });
        return;
      }

      // ── Dynamic tab expansion ─────────────────────────────────────────────
      // Even when the card's template is single-tab (Leads, Staff, Companies…),
      // the user's own file may contain a "Team Assignments" or "Schedule" sheet.
      // Detect those sheets by name or column content and extend the working tab
      // list so classifyParsedSheets routes — and mergeTeamSections runs — on
      // every relevant sheet regardless of module. Review sheets count via
      // their base name, so a fully-quarantined "Team Assignments" sheet still
      // gets its tab for fixed rows to land in.
      const asgTabDef: TabDef = { id: "assignments", label: "Team Assignments", cols: ASG_COLS, sheetName: "Team Assignments" };
      const schTabDef: TabDef = { id: "schedule",    label: "Schedule",         cols: SCHEDULE_COLS, sheetName: "Schedule" };
      const needsAsg = !tabs.find(t => t.id === "assignments") && (
        cleanSheets.some(ps =>
          /(assign|team\s*assign)/i.test(ps.name) || sheetScore(ps, ASG_COLS, STRONG_ASG_KEYS).strong > 0
        ) || reviewSheets.some(ps => /(assign|team\s*assign)/i.test(reviewBase(ps)))
      );
      const needsSch = !tabs.find(t => t.id === "schedule") && (
        cleanSheets.some(ps =>
          /^schedule$/i.test(ps.name.trim()) || sheetScore(ps, SCHEDULE_COLS, STRONG_SCH_KEYS).strong > 0
        ) || reviewSheets.some(ps => /^schedule$/i.test(reviewBase(ps)))
      );
      const effectiveTabs: TabDef[] = [
        ...tabs,
        ...(needsAsg ? [asgTabDef] : []),
        ...(needsSch ? [schTabDef] : []),
      ];
      // NOTE: the final tab list is committed AFTER classification (see the
      // "Prune empty dynamic tabs" step below) — the needsAsg/needsSch
      // detection is a heuristic and can fire on files that contain no real
      // assignments/schedule sheet; committing here would leave an empty tab.

      const routedSheetNames = new Set<string>();
      const classified = classifyParsedSheets(cleanSheets, effectiveTabs, routedSheetNames);
      // For team/assignment tabs, fill Name+Email on assignment-only rows from
      // the person-definition rows above them (two-section import format).
      for (const [tabId, ts] of Object.entries(classified)) {
        const tabType = getTabType(tabId, cardId);
        if (tabType === "team" || tabType === "assignments") {
          classified[tabId] = mergeTeamSections(ts);
        }
      }
      const mt: Record<string, Record<string, "auto" | "manual">> = {};
      for (const [tabId, ts] of Object.entries(classified)) {
        mt[tabId] = {};
        for (const h of ts.headers) mt[tabId][h] = "auto";
      }

      // ── Date auto-fix (all modules, all date columns) ────────────────────
      // Excel/Sheets validation is only a soft guard, so any format can reach
      // a date column. Instead of blocking the upload with an error dialog,
      // silently normalize every readable date to YYYY-MM-DD (the only format
      // the date pickers and the import both understand). Values that truly
      // aren't dates are left in place — the cell shows an inline red
      // highlight the user can fix in the grid, nothing blocks.
      for (const [tabId, ts] of Object.entries(classified)) {
        const tabDef = effectiveTabs.find(t => t.id === tabId);
        if (!tabDef) continue;
        const dateCols = new Set(tabDef.cols.filter(c => c.type === "date").map(c => c.key));
        if (dateCols.size === 0) continue;
        for (const [header, key] of Object.entries(ts.mappings)) {
          if (!dateCols.has(key)) continue;
          for (const row of ts.rows) {
            const v = row[header];
            if (!v) continue;
            const iso = normalizeDateInput(String(v));
            if (iso && iso !== String(v).trim()) row[header] = iso;
          }
        }
      }

      // ── Select-option auto-fix (all modules, all fixed-option columns) ───
      // Same philosophy as the date auto-fix: files routinely say "Full Time"
      // where the app's canonical option is "Full-Time" (or "part time",
      // "AS NEEDED", …). Case/hyphen/spacing variants of an allowed option
      // are silently rewritten to the canonical spelling so they pass
      // validation and land in the DB exactly as the app's dropdowns expect.
      // Only hard-validated fixed lists are touched: status columns and
      // softOpts suggestion lists accept free text and are left verbatim.
      for (const [tabId, ts] of Object.entries(classified)) {
        const tabDef = effectiveTabs.find(t => t.id === tabId);
        if (!tabDef) continue;
        const optCols = new Map(
          tabDef.cols
            .filter(c => c.type === "select" && !c.softOpts && (c.opts?.length ?? 0) > 0)
            .map(c => [c.key, c.opts!]),
        );
        if (optCols.size === 0) continue;
        for (const [header, key] of Object.entries(ts.mappings)) {
          const opts = optCols.get(key);
          if (!opts) continue;
          for (const row of ts.rows) {
            const v = row[header];
            if (!v) continue;
            const canon = canonicalizeOpt(opts, String(v));
            if (canon && canon !== String(v).trim()) row[header] = canon;
          }
        }
      }

      // ── Ticket-ID canonicalization (standalone Assignments / Schedule) ──
      // Same idea as the option canonicalization above, but against the
      // tenant's real Project/Opp ticket IDs: separator/case drift in the
      // uploaded file ("pmm 26 020" → "PMM-26-020") is rewritten to the DB's
      // exact ID. Unknown IDs stay as-is — flagged later, never guessed.
      if (isStandaloneRefCard && ticketRefIndex) {
        for (const ts of Object.values(classified)) {
          for (const [header, key] of Object.entries(ts.mappings)) {
            if (!isTicketRefCol(key)) continue;
            for (const row of ts.rows) {
              const v = row[header];
              if (!v) continue;
              const fixed = canonTicketRef(String(v));
              if (fixed !== String(v)) row[header] = fixed;
            }
          }
        }
      }

      // ── Template-format warning ───────────────────────────────────────────
      // If fewer than 40% of the uploaded file's headers were recognised (mapped
      // to a non-SKIP key), the file is likely not in our template format.
      // Show a soft, dismissable warning so the user knows accuracy may be lower.
      const allMappingValues = Object.values(classified).flatMap(ts => Object.values(ts.mappings));
      const totalFileHeaders  = Object.values(classified).reduce((n, ts) => n + ts.headers.length, 0);
      const matchedHeaders    = allMappingValues.filter(v => v !== SKIP).length;
      const matchRate = totalFileHeaders > 0 ? matchedHeaders / totalFileHeaders : 1;
      setShowTemplateWarning(totalFileHeaders > 2 && matchRate < 0.4);

      // ── Upload column audit ───────────────────────────────────────────────
      // Compare the file's data-bearing (non-blank) columns against the
      // columns the grid actually took. Even ONE data-containing column that
      // failed to match the template/synonyms opens a popup naming the exact
      // columns and telling the user to fix them or re-upload on the template.
      if (freshUpload) {
        const unmatchedCols: { sheet: string; col: string; tabId?: string; samples?: string[]; suggested?: string }[] = [];
        let fileDataCols = 0;
        // Columns inside sheets the grid routed into a tab
        for (const [tabId, ts] of Object.entries(classified)) {
          const tabDef = effectiveTabs.find(t => t.id === tabId);
          for (const h of ts.headers) {
            if (!ts.rows.some(r => String(r[h] ?? "").trim() !== "")) continue; // blank column
            const isMapped = (ts.mappings[h] ?? SKIP) !== SKIP;
            // Duplicate column (e.g. "Project Id" AND "Project ID"): the header
            // DOES match a template column but another file column already took
            // it — its data is captured through that twin, so it neither counts
            // toward the file's data columns nor triggers the warning. Literal
            // same-named duplicates arrive suffixed ("Project ID_1") courtesy of
            // sheet_to_json, so retry the match with the suffix stripped.
            if (!isMapped && tabDef) {
              const deSuffixed = h.replace(/_\d+$/, "");
              if (autoMapToColDef(h, tabDef.cols) !== SKIP) continue;
              if (deSuffixed !== h && autoMapToColDef(deSuffixed, tabDef.cols) !== SKIP) continue;
            }
            fileDataCols++;
            if (!isMapped) {
              unmatchedCols.push({ sheet: tabDef?.label ?? tabId, col: h, tabId, samples: collectSamples(ts.rows, h) });
            }
          }
        }
        // Whole sheets the grid dropped — every data-bearing column there was lost
        for (const ps of cleanSheets) {
          if (routedSheetNames.has(ps.name)) continue;
          for (const h of ps.headers) {
            if (!ps.rows.some(r => String(r[h] ?? "").trim() !== "")) continue;
            fileDataCols++;
            unmatchedCols.push({ sheet: ps.name, col: h, samples: collectSamples(ps.rows, h) });
          }
        }
        // Best-guess suggestions: preselect a grid column per unmatched file
        // column (name tokens first, then value-shape hints). Applied ONLY
        // when the user confirms via Continue — never silently imported.
        // A grid column is suggested at most once and never one that a
        // data-bearing file column already claimed.
        for (const [tabId, ts] of Object.entries(classified)) {
          const tabDef = effectiveTabs.find(t => t.id === tabId);
          if (!tabDef) continue;
          const entries = unmatchedCols.filter(u => u.tabId === tabId);
          if (entries.length === 0) continue;
          const usedByData = new Set(
            Object.entries(ts.mappings)
              .filter(([h, k]) => k !== SKIP && ts.rows.some(r => String(r[h] ?? "").trim() !== ""))
              .map(([, k]) => k));
          // Same rule as the popup dropdown: while a data-bearing Groups
          // column decides access levels, Access Level must never be
          // suggested either.
          const groupsHeader = Object.entries(ts.mappings).find(([, k]) => k === "st_groups")?.[0];
          const groupsHaveData = !!groupsHeader && ts.rows.some(r => String(r[groupsHeader] ?? "").trim() !== "");
          const suggestedTaken = new Set<string>();
          for (const u of entries) {
            const free = tabDef.cols.filter(c =>
              !usedByData.has(c.key) && !suggestedTaken.has(c.key) &&
              !(c.key === "st_accessLevel" && groupsHaveData));
            const key = suggestColDef(u.col, u.samples ?? [], free);
            if (key) { u.suggested = key; suggestedTaken.add(key); }
          }
        }
        if (unmatchedCols.length > 0) {
          setColAudit({
            fileDataCols,
            takenCols: fileDataCols - unmatchedCols.length,
            unmatched: unmatchedCols.map(u => ({ ...u, suggestionPending: !!u.suggested })),
          });
          setShowTemplateWarning(false); // the audit popup already covers the template guidance
        } else {
          setColAudit(null);
        }
      }

      // ── Collect held-back rows from the review sheets ────────────────────
      // Review-sheet columns are exact template labels plus "Remarks"; keep
      // the remarks aside and hold the data cells for the fix-up panel.
      const held: HeldRow[] = [];
      const tabOrdinals: Record<string, number> = {};
      for (const rs of reviewSheets) {
        const base = reviewBase(rs).toLowerCase();
        const heldTab = effectiveTabs.find(t =>
          t.sheetName.toLowerCase() === base || t.label.toLowerCase() === base);
        if (!heldTab) continue; // review sheet for a module this card doesn't import
        const remarksHeader = rs.headers.find(h => h.trim().toLowerCase() === "remarks");
        // Info-only verification columns written after Remarks by the cleaning
        // engine — captured as metadata, never treated as row data.
        const srcRowHeader    = rs.headers.find(h => h.trim().toLowerCase() === "source row");
        const matchedIdHeader = rs.headers.find(h => h.trim().toLowerCase() === "matched id");
        const metaHeaders = new Set([remarksHeader, srcRowHeader, matchedIdHeader].filter(Boolean));
        for (const row of rs.rows) {
          const cells: Row = {};
          for (const h of rs.headers) { if (!metaHeaders.has(h)) cells[h] = row[h] ?? ""; }
          const srcRow = srcRowHeader ? String(row[srcRowHeader] ?? "").trim() || undefined : undefined;
          const ord = (tabOrdinals[heldTab.id] = (tabOrdinals[heldTab.id] ?? 0) + 1);
          held.push({
            id: ++heldRowSeq,
            // Same file → same parse order, so the ordinal fallback is stable.
            dKey: `${heldTab.id}:${srcRow ?? `r${ord}`}`,
            tabId: heldTab.id,
            tabLabel: heldTab.label,
            cells,
            remarks: remarksHeader ? (row[remarksHeader] ?? "") : "",
            srcRow,
            matchedId: matchedIdHeader ? String(row[matchedIdHeader] ?? "").trim() || undefined : undefined,
          });
        }
      }

      // ── Replay saved review decisions (refresh restore) ──────────────────
      // Edits merge into the held cells; "dismissed" rows drop out; "added"
      // rows rejoin the import exactly like addHeldRow would have, in the
      // order the user originally added them (decision insertion order) so
      // the cross-tab candidate sync reproduces the same result.
      let heldFinal = held;
      const autoInit: HeldRow[] = [];
      if (decisions && Object.keys(decisions).length) {
        const byKey = new Map(held.map(h => [h.dKey, h]));
        for (const [k, d] of Object.entries(decisions)) {
          const h = byKey.get(k);
          if (h && d.edits) h.cells = { ...h.cells, ...d.edits };
        }
        let remaining = held.filter(h => !decisions[h.dKey]?.status);
        const addedKeys = Object.entries(decisions).filter(([, d]) => d.status === "added").map(([k]) => k);
        for (const k of addedKeys) {
          const h = byKey.get(k);
          if (!h) continue;
          // Rows a clash verdict added for the user reappear in the read-only
          // "added automatically" table on their tab after a refresh too.
          if (decisions[k]?.auto) autoInit.push(h);
          const tabDef = effectiveTabs.find(t => t.id === h.tabId);
          if (!tabDef) continue;
          const existing = classified[h.tabId];
          if (existing && existing.headers.length > 0) {
            const keyToLabel = new Map(tabDef.cols.map(c => [c.key, c.label]));
            const row: Row = {};
            for (const header of existing.colOrder) {
              const mappedKey = existing.mappings[header];
              const tplLabel = mappedKey && mappedKey !== SKIP ? keyToLabel.get(mappedKey) : undefined;
              row[header] = h.cells[header] ?? (tplLabel ? h.cells[tplLabel] : undefined) ?? "";
            }
            existing.rows.push(row);
          } else {
            const headers = tabDef.cols.map(c => c.label);
            classified[h.tabId] = {
              headers,
              colOrder: [...headers],
              mappings: Object.fromEntries(tabDef.cols.map(c => [c.label, c.key])),
              rows: [{ ...h.cells }],
              fixedValues: {},
              cellOverrides: {},
            };
            mt[h.tabId] = Object.fromEntries(tabDef.cols.map(c => [c.label, "auto" as const]));
          }
          // Cross-tab sync (mirrors addHeldRow): the re-added project becomes
          // a pickable candidate on remaining assignment/schedule rows, and
          // auto-fills rows that previously matched nothing.
          const addedId = String(h.cells["Project ID"] ?? "").trim();
          const addedTitle = String(h.cells["Project Title"] ?? "").trim();
          if (addedId && addedTitle) {
            const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
            const tKey = norm(addedTitle);
            remaining = remaining.map(x => {
              if (x.tabId === h.tabId) return x;
              const refName = String(x.cells["Project"] ?? x.cells["Project Title"] ?? "").trim();
              if (!refName || norm(refName) !== tKey) return x;
              const cands = x.extraCands ?? [];
              if (cands.some(c => c.id === addedId)) return x;
              const next: HeldRow = { ...x, extraCands: [...cands, { id: addedId, title: addedTitle }] };
              const idLabel = requiredIdFor(cardId, x.tabId)?.label ?? "Project ID";
              if (friendlyRemark(x.remarks).kind === "notfound" && !String(x.cells[idLabel] ?? "").trim()) {
                next.cells = { ...x.cells, [idLabel]: addedId };
              }
              return next;
            });
          }
        }
        heldFinal = remaining;
      }
      setHeldRows(heldFinal);
      setAutoAdded(autoInit);
      setTypeOpenIds(new Set());

      // ── "Use our standard template" nudge ─────────────────────────────
      // A fresh upload that lands with a pile of held-back rows (>10) —
      // whether all under Projects or smeared across Team Assignments /
      // Schedule — is almost always a file that wasn't built from our
      // template. Say so immediately, offer the template download, and let
      // the user continue into the normal fix-up flow if they prefer.
      if (freshUpload) {
        if (heldFinal.length > 10) {
          const tabCounts = new Map<string, number>();
          for (const h of heldFinal) tabCounts.set(h.tabLabel, (tabCounts.get(h.tabLabel) ?? 0) + 1);
          setMessyWarning({ total: heldFinal.length, byTab: [...tabCounts.entries()].sort((a, b) => b[1] - a[1]) });
        } else {
          setMessyWarning(null);
        }
      }

      // ── Replay name-clash verdicts (refresh restore) ──────────────────
      // "Keep only this one" removed the losing project row(s) from the grid;
      // re-apply that removal onto the freshly-parsed workbook. "Keep both"
      // verdicts re-arm the duplicate-title exemption at upload time.
      const clashInit: Record<string, "keepBoth" | "resolved"> = {};
      if (decisions) {
        const clashIdCol = REQUIRED_ID_BY_CARD[cardId];
        for (const [k, d] of Object.entries(decisions)) {
          if (!k.startsWith(CLASH_KEY_PREFIX)) continue;
          const nameKey = k.slice(CLASH_KEY_PREFIX.length);
          if (d.removeIds?.length) {
            clashInit[nameKey] = "resolved";
            const rmSet = new Set(d.removeIds.map(s => s.trim()));
            const mainTs = classified["main"];
            const idHeader = mainTs && clashIdCol ? headerForKey(mainTs, clashIdCol.label, clashIdCol.key) : undefined;
            if (mainTs && clashIdCol && idHeader) {
              classified["main"] = removeRowsById(mainTs, idHeader, clashIdCol.key, rmSet);
            }
            // Child tabs follow the winner on refresh too — the freshly
            // parsed workbook's assignment/schedule rows would otherwise
            // still carry the removed IDs.
            const keepId = d.keepId?.trim();
            if (keepId) {
              for (const [tabId, cts] of Object.entries(classified)) {
                if (tabId === "main" || !cts) continue;
                const req = REQUIRED_ID_BY_TAB[tabId];
                if (!req) continue;
                const hdr = headerForKey(cts, req.label, req.key);
                if (hdr) classified[tabId] = remapRowIds(cts, hdr, req.key, rmSet, keepId);
              }
            }
          } else {
            // "Keep both" settles the group outright — held rows naming it are
            // decided per row on their own tabs. (Older saves may still carry
            // assignPending from the removed follow-up step; treated the same.)
            clashInit[nameKey] = "keepBoth";
          }
        }
      }
      setClashDecisions(clashInit);

      // ── Prune empty dynamic tabs ─────────────────────────────────────────
      // The Team Assignments / Schedule tabs added by the dynamic expansion
      // above come from a heuristic (sheet name or column scoring) that can
      // fire on files with no real assignments/schedule sheet — e.g. a staff
      // sheet whose Role/Start Date columns score as "assignment-like". If,
      // after classification and review-row collection, nothing actually
      // landed on a dynamically-added tab (no routed rows, no held review
      // rows, no auto re-added rows), drop it again so the grid never shows
      // an empty "0 rows" tab that wasn't in the uploaded file.
      // Dynamic = any tab beyond the card's base template tabs. Derived from
      // baseTabs (NOT needsAsg/needsSch): on a "Change File" re-upload, `tabs`
      // already contains a previously-added dynamic tab, so needsAsg/needsSch
      // are false — but that tab must still be re-evaluated (kept if the new
      // file populates it, dropped if not) rather than silently orphaned.
      const baseTabIds = new Set(baseTabs.map(t => t.id));
      const dynamicIds = effectiveTabs.filter(t => !baseTabIds.has(t.id)).map(t => t.id);
      const keptDynamicIds = dynamicIds.filter(id =>
        (classified[id]?.rows.length ?? 0) > 0 ||
        heldFinal.some(h => h.tabId === id) ||
        autoInit.some(h => h.tabId === id),
      );
      const droppedDynamic = new Set(dynamicIds.filter(id => !keptDynamicIds.includes(id)));
      const finalTabs = effectiveTabs.filter(t => !droppedDynamic.has(t.id));
      for (const id of droppedDynamic) { delete classified[id]; delete mt[id]; }
      setFileTabs(keptDynamicIds.length > 0 ? finalTabs : null);

      setFileTabStates(classified);
      setMatchTypes(mt);
      setCrossTabHints({});
      setFilename(file.name);
      setTotalFileRows(Object.values(classified).reduce((s, ts) => s + ts.rows.length, 0));
      // Land on the first tab that actually received rows — a file holding
      // only e.g. Team Assignments would otherwise open on an empty Projects
      // tab and look like the upload found nothing. Tab ORDER is unchanged
      // (empty base tabs stay visible); only the initial selection moves.
      // All-empty files keep the old behavior (first tab).
      const landTab = finalTabs.find(t => (classified[t.id]?.rows.length ?? 0) > 0) ?? finalTabs[0];
      setActiveFileTab(landTab.id);
      setFileMode(true);

      // ── Large-tenant immediate ID check ───────────────────────────────────
      // For tenants with >10 000 records the full ID list isn't shipped to the
      // browser. Fire the server-side batch check right after the file is
      // parsed so unknown IDs are highlighted in the grid columns straight
      // away — not only when the user clicks Upload. Fail open: any network or
      // server error leaves batchCheckedIds null so the grid stays unlocked.
      if (checkTicketIds && isStandaloneRefCard) {
        setBatchCheckedIds(null); // reset while the new check is in flight
        const idValues: string[] = [];
        for (const [tabId, ts] of Object.entries(classified)) {
          const tabDef = effectiveTabs.find(t => t.id === tabId);
          const refKey = tabDef?.cols.find(c => isTicketRefCol(c.key))?.key;
          if (!refKey) continue;
          const idHeader = Object.entries(ts.mappings).find(([, k]) => k === refKey)?.[0];
          if (idHeader) {
            for (const row of ts.rows) {
              const v = String(row[idHeader] ?? "").trim();
              if (v) idValues.push(v);
            }
          }
        }
        const unique = [...new Set(idValues)];
        if (unique.length) {
          checkTicketIds(unique)
            .then(found => setBatchCheckedIds(found))
            .catch(() => { /* fail open — leave batchCheckedIds null */ });
        }
      }

      // AI matching is disabled (schemaClean path) — skip when caller says so too
      if (skipAiMatching) return;
      // schemaClean=true path always short-circuits anyway
      const schemaClean = true;
      if (schemaClean) return;

      // ── AI matching: fire one batch call per tab for SKIP'd columns ───────
      const tabsNeedingAi = tabs.filter(tab => {
        const ts = classified[tab.id];
        return ts && ts.headers.some(h => ts.mappings[h] === SKIP);
      });
      if (tabsNeedingAi.length > 0) {
        setAiMatchingTabs(new Set(tabsNeedingAi.map(t => t.id)));
        for (const tab of tabsNeedingAi) {
          const ts = classified[tab.id];
          const skipHeaders = ts.headers.filter(h => ts.mappings[h] === SKIP);
          const sampleValues: Record<string, string[]> = {};
          for (const h of skipHeaders) {
            sampleValues[h] = ts.rows.slice(0, 20).map(r => r[h] ?? "").filter(Boolean).slice(0, 5);
          }
          (async () => {
            try {
              // Phase 1 — match against THIS tab's canonical fields
              const res = await fetch("/api/onboarding/suggest-fields-batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  tabType: getTabType(tab.id, cardId),
                  unknownCols: skipHeaders,
                  canonicalFields: tab.cols.map(c => c.label),
                  sampleValues,
                }),
              });
              const aiResults: Record<string, string | null> = res.ok ? await res.json() : {};
              // Apply AI suggestions only for still-SKIP'd columns, no dups
              setFileTabStates(prev => {
                const cur = prev[tab.id]; if (!cur) return prev;
                const mappings = { ...cur.mappings };
                const usedNow = new Set(Object.values(mappings).filter(k => k !== SKIP));
                for (const [h, label] of Object.entries(aiResults)) {
                  if (!label || mappings[h] !== SKIP) continue;
                  const col = tab.cols.find(c => c.label === label);
                  if (col && !usedNow.has(col.key)) {
                    mappings[h] = col.key;
                    usedNow.add(col.key);
                  }
                }
                return { ...prev, [tab.id]: { ...cur, mappings } };
              });
              setMatchTypes(prev => {
                const tabMt = { ...(prev[tab.id] ?? {}) };
                for (const h of skipHeaders) {
                  if (aiResults[h] && tabMt[h] === "auto") tabMt[h] = "ai";
                }
                return { ...prev, [tab.id]: tabMt };
              });

              // Phase 2 — cross-tab: for headers still SKIP'd after Phase 1,
              // check if they belong to any OTHER tab using the strict LLM matcher
              // (can return null → only real matches are flagged).
              const mappedByPhase1 = new Set(
                Object.entries(aiResults).filter(([, v]) => v !== null).map(([h]) => h)
              );
              const stillSkip = skipHeaders.filter(h => !mappedByPhase1.has(h));
              if (stillSkip.length > 0) {
                const otherTabs = tabs.filter(t => t.id !== tab.id);
                for (const otherTab of otherTabs) {
                  const crossSamples: Record<string, string[]> = {};
                  for (const h of stillSkip) {
                    crossSamples[h] = ts.rows.slice(0, 20).map(r => r[h] ?? "").filter(Boolean).slice(0, 5);
                  }
                  const cRes = await fetch("/api/onboarding/classify-cross-tab", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      tabType: getTabType(otherTab.id, cardId),
                      unknownCols: stillSkip,
                      canonicalFields: otherTab.cols.map(c => c.label),
                      sampleValues: crossSamples,
                    }),
                  });
                  if (!cRes.ok) continue;
                  const crossResults: Record<string, string | null> = await cRes.json();
                  setCrossTabHints(prev => {
                    const next = { ...prev };
                    for (const [h, matched] of Object.entries(crossResults)) {
                      if (matched) next[h] = otherTab.label;
                    }
                    return next;
                  });
                }
              }
            } finally {
              setAiMatchingTabs(prev => { const s = new Set(prev); s.delete(tab.id); return s; });
            }
          })();
        }
      }
    } catch (err) {
      console.error(err);
      setNotice({
        title: "Couldn't read that file",
        message: "Please upload an Excel or CSV file (.xlsx, .xls, or .csv) and try again.",
      });
    } finally { setUploading(false); }
  }, [tabs, baseTabs, cardId, isStandaloneRefCard, ticketRefIndex, isTicketRefCol, canonTicketRef]);

  // ── Inline data cleaning ─────────────────────────────────────────────
  // Every fresh .xlsx upload first runs through the deterministic cleaning
  // engine: upload → poll → load the CLEANED workbook into the grid (review
  // rows land in the Needs-attention panel via the normal review-sheet
  // partition). Any failure falls back to the raw file so an upload is never
  // blocked by the cleaner.
  const cleanThenLoad = useCallback(async (file: File) => {
    if (cleaningRef.current) return;
    cleaningRef.current = true;
    cleanCancelRef.current = false;
    cleanSkipRef.current = false;
    setCleanSummary(null);
    setDroppedInfo(null);
    setDroppedPicks({}); setDroppedTabSel("");
    setCleaning({ pct: 3, msg: "Uploading your file to Data Cleaning…" });
    // One full attempt: upload + poll to completion. Rejects with
    // CLEAN_STALLED when the run stops moving (backend stale flag, no
    // pct/message change for 3 minutes — matching the server's own stale
    // window — or the 6-minute cap) so the outer loop can restart it, and
    // CLEAN_CANCELLED the moment the user presses the popup's ×.
    const runOnce = async (): Promise<{ sid: string; report: CleaningReportLite }> => {
      // Abortable upload with a hard time cap: a hung upload used to freeze
      // the popup at 3% forever with a dead × button. Abort by the user maps
      // to CLEAN_CANCELLED; abort by the timer maps to CLEAN_STALLED so the
      // auto-restart / raw-file fallback logic takes over. The cap scales
      // with file size — huge files go up in ~20MB pieces (production caps
      // any single request at ~32MB) and legitimately take longer than 90s.
      const ac = new AbortController();
      cleanAbortRef.current = ac;
      const uploadCapMs = 90_000 * Math.max(1, Math.ceil(file.size / (25 * 1024 * 1024)));
      const uploadTimer = setTimeout(() => ac.abort(), uploadCapMs);
      let up: Response;
      try {
        up = await uploadFileSmart({
          url: "/api/data-cleaning/upload",
          file,
          headers: authHeaders() as Record<string, string>,
          signal: ac.signal,
        });
      } catch {
        throw new Error(cleanCancelRef.current ? CLEAN_CANCELLED : CLEAN_STALLED);
      } finally {
        clearTimeout(uploadTimer);
      }
      if (cleanCancelRef.current) throw new Error(CLEAN_CANCELLED);
      const uj = await up.json();
      if (!up.ok) throw new Error(uj?.error ?? `upload failed (${up.status})`);
      const sid: string = uj.sessionId;
      const report = await new Promise<CleaningReportLite>((resolve, reject) => {
        const t0 = Date.now();
        let lastSig = "";
        let lastMoveAt = Date.now();
        const iv = setInterval(async () => {
          if (!gridMountedRef.current) { clearInterval(iv); return; }
          if (cleanCancelRef.current) { clearInterval(iv); reject(new Error(CLEAN_CANCELLED)); return; }
          try {
            const r = await fetch(`/api/data-cleaning/status/${sid}`, { headers: authHeaders() });
            if (!r.ok) return;
            const st = await r.json();
            if (st.stage === "done" && st.report) { clearInterval(iv); resolve(st.report); return; }
            if (st.stage === "failed") { clearInterval(iv); reject(new Error(st.error ?? "cleaning failed")); return; }
            if (st.stale) { clearInterval(iv); reject(new Error(CLEAN_STALLED)); return; }
            const pct = Math.max(5, Math.min(95, st.pct ?? 5));
            // Client-side stall backstop: any pct OR message change counts as
            // life. 3-minute threshold mirrors the backend's own stale window
            // (st.stale above is the primary detector; this catches the case
            // where status responses keep arriving but never change at all).
            const sig = `${pct}|${st.message ?? ""}`;
            if (sig !== lastSig) { lastSig = sig; lastMoveAt = Date.now(); }
            // A tick that was already in flight when × was pressed must not
            // resurrect the popup the cancel handler just hid.
            if (!cleanCancelRef.current) setCleaning({ pct, msg: st.message || "Cleaning your data…" });
            if (Date.now() - lastMoveAt > 3 * 60_000) { clearInterval(iv); reject(new Error(CLEAN_STALLED)); return; }
            if (Date.now() - t0 > 6 * 60_000) { clearInterval(iv); reject(new Error(CLEAN_STALLED)); }
          } catch { /* transient poll error — keep trying */ }
        }, 2000);
        cleanPollRef.current = iv;
      });
      return { sid, report };
    };
    try {
      // Stuck runs restart themselves once (fresh upload, fresh session);
      // a second stall falls through to the raw-file fallback below.
      let out: { sid: string; report: CleaningReportLite } | null = null;
      for (let attempt = 1; attempt <= 2 && !out; attempt++) {
        try {
          out = await runOnce();
        } catch (err) {
          const em = err instanceof Error ? err.message : "";
          if (em === CLEAN_STALLED && attempt < 2 && !cleanCancelRef.current && gridMountedRef.current) {
            console.warn("[data-cleaning] run stalled — restarting automatically");
            setCleaning({ pct: 3, msg: "That run got stuck — restarting the cleaning from the top…" });
            continue;
          }
          throw err;
        }
      }
      if (!out) throw new Error("cleaning failed");
      const { sid, report } = out;
      if (!gridMountedRef.current) return;
      // A skip pressed in the window between the poll resolving and this
      // check must still load the raw file — throw into the catch instead
      // of silently returning with nothing loaded.
      if (cleanCancelRef.current) {
        if (cleanSkipRef.current) throw new Error(CLEAN_CANCELLED);
        return;
      }
      const cleanedSheets = (report.sheets ?? []).filter(s => s.module);
      if (!cleanedSheets.length) throw new Error("no recognized tabs in the file");
      setCleaning({ pct: 97, msg: "Loading the cleaned rows into the grid…" });
      const dl = await fetch(`/api/data-cleaning/download/${sid}`, { headers: authHeaders(), signal: cleanAbortRef.current?.signal });
      if (!dl.ok) throw new Error(`download failed (${dl.status})`);
      const blob = await dl.blob();
      // Cache the cleaned workbook on this device — a refresh or
      // back-navigation then restores the rows instantly (no server round
      // trip that leaves the empty template on screen while it runs).
      void putCachedCleanedFile(sid, blob, file.name);
      const cleanedFile = new File([blob], file.name.replace(/\.xlsx$/i, "") + " (cleaned).xlsx", {
        type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      await processFile(cleanedFile);
      const fixed = cleanedSheets.reduce((a, s) => a + s.fixes.dates + s.fixes.numbers + s.fixes.emails + s.fixes.idsFilled, 0);
      const dupes = cleanedSheets.reduce((a, s) => a + s.duplicates.exactRemoved + s.duplicates.conflictsResolved, 0);
      setCleanSummary({ sid, fixed, dupes, review: report.reviewCount ?? 0 });
      // Columns the engine could not place — surfaced in a panel so the user
      // can map them and re-clean instead of losing them silently.
      setDroppedInfo(parseDroppedInfo(report));
      setDroppedPicks({}); setDroppedTabSel("");
      // Fresh session → fresh decision store. A refresh re-downloads the
      // cleaned workbook by this sessionId and replays saved decisions.
      saveHeldStore(cardId, {
        sessionId: sid,
        fileName: file.name,
        tenantOverride: null,
        summary: { fixed, dupes, review: report.reviewCount ?? 0 },
        decisions: {},
      });
      openReview();
    } catch (err) {
      const em = err instanceof Error ? err.message : "";
      const cancelled = em === CLEAN_CANCELLED || cleanCancelRef.current;
      if (cancelled && !cleanSkipRef.current) {
        // User pressed × — stop the whole thing: no cleaned load, no raw
        // fallback. The grid stays exactly as it was before the upload.
        console.info("[data-cleaning] stopped by the user");
        return;
      }
      // "Skip cleaning" or a genuine engine failure — load the raw file so
      // the user is never blocked by the cleaner.
      if (cleanSkipRef.current) console.info("[data-cleaning] user chose to load the file without cleaning");
      else console.error("[data-cleaning] falling back to the raw file:", err);
      if (!gridMountedRef.current) return;
      clearHeldStore(cardId);
      freshUploadRef.current = true; // the cleaned-path run consumed the flag before failing
      await processFile(file);
      setCleanSummary({ sid: "", fixed: 0, dupes: 0, review: 0, fallback: true });
      setDroppedInfo(null);
      setDroppedPicks({}); setDroppedTabSel("");
    } finally {
      setCleaning(null);
      cleaningRef.current = false;
      cleanAbortRef.current = null;
    }
  }, [processFile, cardId, openReview]);

  // × on the cleaning popup: closes it INSTANTLY (abort any in-flight
  // upload fetch, hide the popup) — the run's own loop then winds down and
  // nothing gets loaded. Previously the click only set a flag that the poll
  // loop checked, so during the upload phase × appeared completely dead.
  const cancelCleaning = useCallback(() => {
    cleanCancelRef.current = true;
    cleanAbortRef.current?.abort();
    setCleaning(null);
  }, []);
  // "Skip cleaning" on the popup: cancel the run the same way, but load the
  // raw file into the grid so the user can continue to import right away.
  const skipCleaning = useCallback(() => {
    cleanSkipRef.current = true;
    cleanCancelRef.current = true;
    cleanAbortRef.current?.abort();
    setCleaning({ pct: 96, msg: "Loading your file without cleaning…" });
  }, []);

  // Re-download the cleaned workbook for the last cleaning run.
  const downloadCleaned = useCallback(async () => {
    if (!cleanSummary?.sid) return;
    try {
      const r = await fetch(`/api/data-cleaning/download/${cleanSummary.sid}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`download failed (${r.status})`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${cardId}_cleaned.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice({
        title: "Download failed",
        message: "Could not download the cleaned file — please try uploading again.",
      });
    }
  }, [cleanSummary, cardId]);

  // Fetch the backend's template column labels the first time the
  // dropped-columns panel needs them (static data — one fetch per session).
  useEffect(() => {
    if (!droppedInfo?.cols.length || templateCols) return;
    let dead = false;
    (async () => {
      try {
        const r = await fetch("/api/data-cleaning/template-columns", { headers: authHeaders() });
        if (r.ok) { const j = await r.json(); if (!dead) setTemplateCols(j); }
      } catch { /* picker stays empty — Map & re-clean stays disabled */ }
    })();
    return () => { dead = true; };
  }, [droppedInfo, templateCols]);

  // ── Re-clean with user-confirmed column mappings ─────────────────────
  // The dropped-columns panel collects destination picks; this re-runs the
  // cleaning engine on the server-stored ORIGINAL file with those picks as
  // absolute overrides, then reloads the grid exactly like a fresh clean.
  const recleanWithMappings = useCallback(async () => {
    const sid = cleanSummary?.sid;
    if (!sid || recleaning || cleaningRef.current || !droppedInfo) return;
    const overrides = droppedInfo.cols.map(d => ({
      sheet: d.sourceSheet, header: d.header, module: d.module,
      target: droppedPicks[`${d.sourceSheet}\u0000${d.header}`] ?? "",
    })).filter(o => o.target);
    if (!overrides.length) return;
    cleaningRef.current = true;
    setRecleaning(true);
    cleanCancelRef.current = false;
    cleanSkipRef.current = false;
    setCleaning({ pct: 4, msg: "Re-cleaning with your column mappings…" });
    try {
      const store = loadHeldStore(cardId);
      const r = await fetch(`/api/data-cleaning/reclean/${sid}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          overrides,
          ...(store?.tenantOverride ? { tenantId: store.tenantOverride } : {}),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? `re-clean failed (${r.status})`);
      const fileName: string = j?.fileName || store?.fileName || "cleaned-data.xlsx";
      const report = await new Promise<CleaningReportLite>((resolve, reject) => {
        const t0 = Date.now();
        const iv = setInterval(async () => {
          if (!gridMountedRef.current) { clearInterval(iv); return; }
          if (cleanCancelRef.current) { clearInterval(iv); reject(new Error(CLEAN_CANCELLED)); return; }
          try {
            const s = await fetch(`/api/data-cleaning/status/${sid}`, { headers: authHeaders() });
            if (!s.ok) return;
            const st = await s.json();
            if (st.stage === "done" && st.report) { clearInterval(iv); resolve(st.report); return; }
            if (st.stage === "failed") { clearInterval(iv); reject(new Error(st.error ?? "re-cleaning failed")); return; }
            if (!cleanCancelRef.current) {
              setCleaning({ pct: Math.max(5, Math.min(95, st.pct ?? 5)), msg: st.message || "Re-cleaning your data…" });
            }
            if (Date.now() - t0 > 6 * 60_000) { clearInterval(iv); reject(new Error("re-cleaning timed out")); }
          } catch { /* transient poll error — keep trying */ }
        }, 2000);
        cleanPollRef.current = iv;
      });
      if (!gridMountedRef.current || cleanCancelRef.current) return;
      setCleaning({ pct: 97, msg: "Loading the re-cleaned rows into the grid…" });
      const dl = await fetch(`/api/data-cleaning/download/${sid}`, { headers: authHeaders() });
      if (!dl.ok) throw new Error(`download failed (${dl.status})`);
      const blob = await dl.blob();
      void putCachedCleanedFile(sid, blob, fileName);
      const cleanedFile = new File([blob], fileName.replace(/\.xlsx$/i, "") + " (cleaned).xlsx", {
        type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      await processFile(cleanedFile);
      const cleanedSheets = (report.sheets ?? []).filter(s => s.module);
      const fixed = cleanedSheets.reduce((a, s) => a + s.fixes.dates + s.fixes.numbers + s.fixes.emails + s.fixes.idsFilled, 0);
      const dupes = cleanedSheets.reduce((a, s) => a + s.duplicates.exactRemoved + s.duplicates.conflictsResolved, 0);
      setCleanSummary({ sid, fixed, dupes, review: report.reviewCount ?? 0 });
      setDroppedInfo(parseDroppedInfo(report));
      setDroppedPicks({}); setDroppedTabSel("");
      // Row identities changed with the re-clean — saved decisions no longer
      // line up, so the store restarts fresh (same as a new cleaning run).
      saveHeldStore(cardId, {
        sessionId: sid,
        fileName,
        tenantOverride: store?.tenantOverride ?? null,
        summary: { fixed, dupes, review: report.reviewCount ?? 0 },
        decisions: {},
      });
    } catch (err) {
      if (cleanCancelRef.current) return; // user closed the popup — grid unchanged
      setNotice({
        title: "Re-cleaning didn't finish",
        message: `${err instanceof Error ? err.message : "Something went wrong."}\n\nYour current rows are unchanged — you can try again.`,
      });
    } finally {
      setCleaning(null);
      setRecleaning(false);
      cleaningRef.current = false;
    }
  }, [cleanSummary, recleaning, droppedInfo, droppedPicks, cardId, processFile]);

  // Thin wrapper so the file <input> onChange can call processFile.
  // Fresh .xlsx uploads run through inline data cleaning first; .csv/.xls
  // (which the cleaning engine can't parse) and read-only history views load
  // directly.
  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
    if (cleaningRef.current) return;
    freshUploadRef.current = true; // arm the "use our template" nudge for this upload only
    // CLEANING_HIDDEN: inline cleaning is fully disabled — every upload loads
    // straight into the grid. The grid's own checks (strict column validation,
    // AI column matching, exact-duplicate scan, mandatory IDs) cover the file.
    if (false /* CLEANING_HIDDEN */ && !readOnly && /\.xlsx$/i.test(file!.name)) {
      await cleanThenLoad(file!);
    } else {
      // All uploads bypass cleaning — clear any summary
      // from a previous cleaned upload so a stale banner never lingers.
      setCleanSummary(null);
      setDroppedInfo(null);
      setDroppedPicks({}); setDroppedTabSel("");
      clearHeldStore(cardId);
      await processFile(file);
    }
  }, [processFile, cleanThenLoad, readOnly, cardId]);

  // Auto-load initialFile on mount (read-only history view, or the
  // Data Cleaning → Import handoff). For the handoff, saved review decisions
  // for the SAME cleaning session are replayed so a refresh keeps prior work.
  useEffect(() => {
    if (!initialFile) return;
    let decisions: HeldDecisions | undefined;
    if (cleanSessionId && !readOnly) {
      const store = loadHeldStore(cardId);
      if (store?.sessionId === cleanSessionId) {
        decisions = store.decisions;
      } else {
        saveHeldStore(cardId, {
          sessionId: cleanSessionId,
          fileName: initialFile.name,
          tenantOverride: cleanTenant ?? null,
          decisions: {},
        });
      }
    }
    void processFile(initialFile, true, decisions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  // ── Session re-hydration ───────────────────────────────────────────────
  // A refresh mid-review used to throw away the cleaned file AND every
  // decision. If a decision store exists for this card, re-download the
  // cleaned workbook by sessionId and replay the saved decisions. Never runs
  // for history views or when a file arrives via the handoff props.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    // FRESH_START: never restore a previously loaded file — every visit opens
    // on the clean template with just the example rows.
    if (FRESH_START_ALWAYS) return;
    if (rehydratedRef.current || initialFile || cleanSessionId || readOnly) return;
    rehydratedRef.current = true;
    const store = loadHeldStore(cardId);
    if (!store?.sessionId) return;
    (async () => {
      try {
        // Local-first: the cleaned workbook was cached on this device when
        // the cleaning run finished, so the user's rows come back instantly
        // instead of sitting on the empty template while a multi-MB server
        // download runs. The server copy is the fallback on a cache miss.
        const cached = await getCachedCleanedFile(store.sessionId);
        let blob: Blob;
        if (cached) {
          setCleaning({ pct: 85, msg: "Restoring your rows…", restore: true });
          blob = cached.blob;
        } else {
          setCleaning({ pct: 40, msg: "Fetching your cleaned file…", restore: true });
          const q = store.tenantOverride ? `?tenantId=${encodeURIComponent(store.tenantOverride)}` : "";
          const r = await fetch(`/api/data-cleaning/download/${store.sessionId}${q}`, { headers: authHeaders() });
          if (!r.ok) {
            // Only a definitive "this session no longer exists" clears the
            // saved work; a transient failure (5xx / network) keeps the
            // store so the next visit simply retries.
            if (r.status === 404 || r.status === 410 || r.status === 403) {
              clearHeldStore(cardId);
              void deleteCachedCleanedFile(store.sessionId);
            }
            return;
          }
          blob = await r.blob();
          void putCachedCleanedFile(store.sessionId, blob, store.fileName || "cleaned-data.xlsx");
        }
        if (!gridMountedRef.current) return;
        const f = new File([blob], store.fileName || "cleaned-data.xlsx", {
          type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        await processFile(f, true, store.decisions);
        if (!gridMountedRef.current) return;
        if (store.summary) setCleanSummary({ sid: store.sessionId, ...store.summary });
        // Restore the dropped-columns panel too — it lives in the stored
        // report on the server, so it survives refreshes like the rows do.
        try {
          const q2 = store.tenantOverride ? `?tenantId=${encodeURIComponent(store.tenantOverride)}` : "";
          const rr = await fetch(`/api/data-cleaning/report/${store.sessionId}${q2}`, { headers: authHeaders() });
          if (rr.ok) {
            const rj = await rr.json();
            if (rj?.report && gridMountedRef.current) {
              setDroppedInfo(parseDroppedInfo(rj.report as CleaningReportLite));
              setDroppedPicks({}); setDroppedTabSel("");
            }
          }
        } catch { /* panel just stays hidden — rows and decisions are intact */ }
        // Deep link straight back into the review view (?review=1).
        if (new URLSearchParams(window.location.search).get("review") === "1") setCleanResultsOpen(true);
      } catch {
        // Parse / unexpected failure — drop the cached copy (it may be
        // corrupt) but KEEP the decision store: the next visit retries
        // from the server instead of silently losing the saved work.
        void deleteCachedCleanedFile(store.sessionId);
      } finally {
        if (gridMountedRef.current) setCleaning(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── File mode mapping helpers ─────────────────────────────────────────
  // Assign a file column to a template key (template-fixed view).
  // If another file col already feeds this template key, releases it to SKIP.
  // If fileHeader is null, clears the template col (no data source).
  const assignToTemplate = useCallback((tabId: string, templateKey: string, fileHeader: string | null) => {
    setFileTabStates(prev => {
      const ts = { ...prev[tabId] }; if (!ts) return prev;
      const mappings = { ...ts.mappings };
      // Release any existing file col mapped to this templateKey
      for (const [h, k] of Object.entries(mappings)) {
        if (k === templateKey) mappings[h] = SKIP;
      }
      // Assign new fileHeader
      if (fileHeader !== null) mappings[fileHeader] = templateKey;
      return { ...prev, [tabId]: { ...ts, mappings } };
    });
    if (fileHeader !== null) {
      setMatchTypes(prev => ({
        ...prev,
        [tabId]: { ...(prev[tabId] ?? {}), [fileHeader]: "manual" },
      }));
    }
  }, []);

  // Set (or clear) a fixed/constant value for a template key when no file column is mapped.
  const setFixedValue = useCallback((tabId: string, templateKey: string, value: string | null) => {
    setFileTabStates(prev => {
      const ts = prev[tabId]; if (!ts) return prev;
      const fv = { ...(ts.fixedValues ?? {}) };
      if (value === null) { delete fv[templateKey]; }
      else { fv[templateKey] = value; }
      return { ...prev, [tabId]: { ...ts, fixedValues: fv } };
    });
  }, []);

  // Legacy: used internally by AI matching path (fileHeader → templateKey direction)
  const setMapping = useCallback((tabId: string, header: string, newKey: string) => {
    setFileTabStates(prev => {
      const ts = { ...prev[tabId] };
      const mappings = { ...ts.mappings };
      if (newKey !== SKIP) {
        for (const [h, k] of Object.entries(mappings)) {
          if (h !== header && k === newKey) mappings[h] = SKIP;
        }
      }
      mappings[header] = newKey;
      return { ...prev, [tabId]: { ...ts, mappings } };
    });
    setMatchTypes(prev => ({
      ...prev,
      [tabId]: { ...(prev[tabId] ?? {}), [header]: "manual" },
    }));
  }, []);

  const reorderCols = useCallback((tabId: string, from: string, to: string) => {
    if (from === to) return;
    setFileTabStates(prev => {
      const ts = prev[tabId]; if (!ts) return prev;
      const arr = [...ts.colOrder];
      const fi = arr.indexOf(from), ti = arr.indexOf(to);
      if (fi < 0 || ti < 0) return prev;
      arr.splice(fi, 1); arr.splice(ti, 0, from);
      return { ...prev, [tabId]: { ...ts, colOrder: arr } };
    });
  }, []);

  // ── Export helpers ────────────────────────────────────────────────────
  const exportXlsx = (data: { cols: ColDef[]; rows: Row[]; sheetName: string }[], fileName?: string): File => {
    // Safe: export always follows a parse (processFile), which awaited the load.
    const XLSX = getXlsxSync();
    const wb = XLSX.utils.book_new();
    for (const { cols, rows, sheetName } of data) {
      const filtered = rows.filter(r => cols.some(c => r[c.key]?.trim()));
      const sheet = XLSX.utils.json_to_sheet(filtered.map(r => {
        const out: Record<string, string> = {};
        for (const col of cols) out[col.label] = r[col.key] ?? "";
        return out;
      }));
      XLSX.utils.book_append_sheet(wb, sheet, sheetName);
    }
    // compression:true — SheetJS defaults to an UNCOMPRESSED zip, which made
    // 66k-row exports several times larger than the user's original file and
    // slowed the upload badly. Standard zip deflate shrinks these ~5-10x and
    // every Excel parser (server-side ExcelJS included) reads it natively.
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
    return new File([buf], fileName ?? `${cardId}_data.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  };

  // Shared import executor — persists rows, updates the template view, and
  // calls onSubmit. Used by both the dialog confirm path and the no-dialog
  // fast-path (fresh tenant).
  const doImport = useCallback((mode: ImportMode) => {
    if (!pendingImportFile.current) return;
    // Always clear the held-row decision store so the next visit to the
    // import page starts fresh — not just for manual-row entry but also
    // for the cleaned-file upload path (where pendingImportRows is null).
    const st = loadHeldStore(cardId);
    if (st?.sessionId) void deleteCachedCleanedFile(st.sessionId);
    clearHeldStore(cardId);
    if (pendingImportRows.current) {
      // Also reset the template grid back to blank example rows.
      try { localStorage.removeItem(gridStorageKey(cardId)); } catch { /* ignore */ }
      tmplDataMountedRef.current = false;
      setTmplData(Object.fromEntries(
        getTabsForCard(cardId, multiTab).map(t => [t.id, [empty(t.cols), empty(t.cols), empty(t.cols)]])
      ));
      pendingImportRows.current = null;
    }
    onSubmit(pendingImportFile.current, mode, pendingImportMappings.current ?? undefined);
  }, [cardId, multiTab, onSubmit]);

  // ── Group → access level popup (team card) ─────────────────────────────
  // When a staff upload carries Groups but some people have no Access Level,
  // the import pauses on a mandatory popup: pick a level per group and the
  // empty Access Level cells are filled from each person's groups. Levels
  // already in the file always win (only empty cells are filled); people
  // with no groups stay on the pipeline default (User).
  // (groupAclPrompt state lives up next to mappingConfirm — the document-
  // level edit handlers gate on it without a TDZ crash.)
  const groupAclPendingData = useRef<{ cols: ColDef[]; rows: Row[]; sheetName: string }[] | null>(null);
  // One-shot gate latches (staff groups / record groups / new levels + the
  // Fix-issues marker). ALL latch reads/writes go through this instance —
  // the transition rules (set on confirm only, re-armed by Back, reset each
  // submit pass) live in lib/importGateLatches.ts where they are unit-tested.
  const gatesRef = useRef(new ImportGateLatches());

  // Collect the distinct groups of rows that would actually be filled (empty
  // Access Level + at least one group). Groups appearing only on rows with an
  // explicit level need no pick — and this also keeps the untouched sample
  // rows (which ship with levels) out of the popup.
  const groupAclGate = (data: { cols: ColDef[]; rows: Row[] }[]): { groups: GroupAclGroup[]; tabIndex: number } | null => {
    if (cardId !== "team") return null;
    const tabIndex = data.findIndex(d => d.cols.some(c => c.key === "st_groups"));
    if (tabIndex < 0) return null;
    const seen = new Map<string, GroupAclGroup>();
    for (const r of data[tabIndex].rows) {
      if (String(r.st_accessLevel ?? "").trim()) continue;
      const names = String(r.st_groups ?? "").split(/[;,]/).map(s => s.trim()).filter(Boolean);
      for (const n of names) {
        const k = n.toLowerCase();
        const e = seen.get(k);
        if (e) e.count += 1; else seen.set(k, { name: n, count: 1 });
      }
    }
    return seen.size ? { groups: [...seen.values()], tabIndex } : null;
  };

  // Distinct Access Level values across the snapshot that don't name an
  // existing level (built-ins + tenant customs are already merged into each
  // column's opts). They pause the flow on the New-levels wizard step where
  // they're created for real — the Fix-issues remark promises exactly that.
  const collectNewLevelNames = (data: { cols: ColDef[]; rows: Row[] }[]): string[] => {
    const seen = new Map<string, string>();
    for (const d of data) {
      for (const c of d.cols) {
        if (!c.key.endsWith("_accessLevel")) continue;
        for (const r of d.rows) {
          const v = String(r[c.key] ?? "").trim();
          if (!v || !isCreatableLevelValue(c, v)) continue;
          const k = v.toLowerCase();
          if (!seen.has(k)) seen.set(k, v);
        }
      }
    }
    return [...seen.values()];
  };

  // Fill empty Access Level cells from the confirmed picks. Highest level
  // wins across a person's groups: Admin > Manager > custom levels > User;
  // a tie between two custom levels keeps the first-listed group's pick.
  const applyGroupAclPicks = (
    data: { cols: ColDef[]; rows: Row[]; sheetName: string }[],
    tabIndex: number,
    picks: Record<string, string>,
  ) => {
    const BUILTIN_RANK: Record<string, number> = { admin: 4, manager: 3, user: 1 };
    const rankOf = (lvl: string) => BUILTIN_RANK[lvl.trim().toLowerCase()] ?? 2; // customs sit between Manager and User
    const rows = data[tabIndex].rows.map(r => {
      if (String(r.st_accessLevel ?? "").trim()) return r;
      const names = String(r.st_groups ?? "").split(/[;,]/).map(s => s.trim()).filter(Boolean);
      let best: string | null = null;
      for (const n of names) {
        const lvl = picks[n.toLowerCase()];
        if (lvl && (best === null || rankOf(lvl) > rankOf(best))) best = lvl;
      }
      return best ? { ...r, st_accessLevel: best } : r;
    });
    return data.map((d, i) => (i === tabIndex ? { ...d, rows } : d));
  };

  // Stored group defaults: a group created from a projects/opps import can
  // carry the access level picked there (defaultAccessLevel). Staff imports
  // consume those silently and only ask about groups without one.
  const groupAclDefaultPicks = useRef<Record<string, string>>({});

  const resolveGroupAcl = async (
    data: { cols: ColDef[]; rows: Row[]; sheetName: string }[],
    gate: { groups: GroupAclGroup[]; tabIndex: number },
  ) => {
    const defaults = new Map<string, string>();
    try {
      const existing = await fetchUserGroups(cleanTenant ?? undefined);
      // A stored default must still name a real level — stale after a level
      // was renamed or deleted → fall back to asking for that group.
      const valid = new Set(["admin", "manager", "user", ...customAclNames.map(n => n.trim().toLowerCase())]);
      for (const g of existing) {
        const lvl = (g.defaultAccessLevel ?? "").trim();
        if (lvl && valid.has(lvl.toLowerCase())) defaults.set(g.name.trim().toLowerCase(), lvl);
      }
    } catch {
      // Groups service unreachable — ask about every group, exactly as before.
    }
    const remaining = gate.groups.filter(g => !defaults.has(g.name.toLowerCase()));
    const prePicks: Record<string, string> = {};
    for (const g of gate.groups) {
      const lvl = defaults.get(g.name.toLowerCase());
      if (lvl) prePicks[g.name.toLowerCase()] = lvl;
    }
    if (!remaining.length) {
      // Auto-resolved (all groups had stored defaults) — no popup shown, so
      // the New-levels offer stays armed (viaPopupConfirm is NOT passed).
      gatesRef.current.resolveStaffGroups();
      finishSubmit(applyGroupAclPicks(data, gate.tabIndex, prePicks));
      return;
    }
    groupAclDefaultPicks.current = prePicks;
    groupAclPendingData.current = data;
    setGroupAclPrompt({ groups: remaining, tabIndex: gate.tabIndex });
  };

  // ── "Action User" → Groups gate (projects / opportunities cards) ────────
  // Client files carry group-ish columns ("PMO", "PMO; Mitch Spencer"). Cells
  // keep ONLY tenant user-group tokens: known groups import directly; an
  // unknown FIRST token pauses on a create-groups popup (SAME component as
  // the staff group→level popup, so the Admin/Manager/User/custom level cards
  // show here too). Person names riding along in a cell become MEMBERS of
  // the group(s) named in that same cell — matched against existing staff,
  // ADD-only (nobody is ever removed). Names matching nobody are dropped
  // from the cell as before; people still join projects via Assignments.
  // (recordGroupsPrompt state lives up next to mappingConfirm — the document-
  // level edit handlers gate on it without a TDZ crash.)
  const recordGroupsPendingData = useRef<{ cols: ColDef[]; rows: Row[]; sheetName: string }[] | null>(null);
  const recordGroupsTabIndex = useRef(0);
  const recordGroupsKeyRef = useRef("");
  const recordGroupsResolvedRef = useRef(false);
  // group name (lowercase) → member GUIDs found in its cells, carried from
  // resolve → confirm so the popup path saves members too.
  const recordGroupsMembersRef = useRef<Map<string, Set<string>> | null>(null);

  // Rewrite every Groups cell to the canonical "; "-joined group names it
  // resolved to (dropping person tokens and duplicates). Pure cell logic
  // lives in lib/importGroupMerge.ts (regression-tested).
  const cleanRecordGroupCells = (
    data: { cols: ColDef[]; rows: Row[]; sheetName: string }[],
    tabIndex: number,
    key: string,
    canon: Map<string, string>,
  ) => {
    const rows = data[tabIndex].rows.map(r => {
      const raw = String(r[key] ?? "").trim();
      if (!raw) return r;
      return { ...r, [key]: cleanGroupCellValue(raw, canon) };
    });
    return data.map((d, i) => (i === tabIndex ? { ...d, rows } : d));
  };

  const resolveRecordGroups = async (
    data: { cols: ColDef[]; rows: Row[]; sheetName: string }[],
    tabIndex: number,
    key: string,
  ) => {
    let existing: UserGroup[];
    let userRows: Record<string, unknown>[] | null = null;
    try {
      // Tenant users fetched alongside the groups: person names listed next
      // to a group in a cell become that group's MEMBERS. getUserList is
      // own-tenant only, so superadmins importing for a client skip member
      // resolution (never match against the wrong tenant's staff); a users
      // fetch failure also just skips members — the groups flow continues.
      const [groupsRes, usersRes] = await Promise.all([
        fetchUserGroups(cleanTenant ?? undefined),
        cleanTenant
          ? Promise.resolve(null)
          : getUserList().then(r => (Array.isArray(r) ? r : null)).catch(() => null),
      ]);
      existing = groupsRes;
      userRows = usersRes;
    } catch (e) {
      // Groups service unreachable — never guess. A later save without a
      // fresh read could clobber real groups (the save replaces the whole
      // list), so the import proceeds with the cells untouched instead.
      console.warn("[import] user-groups fetch failed — Groups column imported as-is", e);
      gatesRef.current.resolveRecordGroups();
      finishSubmit(data);
      return;
    }
    // Person-name → user GUID map (normalized full name). Two different
    // people sharing a name = ambiguous → never guess, the token is dropped.
    // Token/name resolution is pure and lives in lib/importGroupMerge.ts
    // (regression-tested — a bug here clobbers group membership on import).
    const userByName = buildUserNameMap(userRows);
    const canon = new Map(existing.map(g => [g.name.trim().toLowerCase(), g.name.trim()] as const));
    // Cells come in many shapes ("rm1" alone, "PMO; Mitch Spencer",
    // "pmo,director"): a bare group name must still pick up the row's team
    // (user request). So the row's person columns also feed membership —
    // everyone assigned on a row joins every group that row names.
    const PERSONNEL_KEYS = new Set([
      "businessLead", "projectManager", "srProjectManager",
      "opp_businessLead", "opp_projectManager", "opp_srProjectManager",
    ]);
    const personnelCols = data[tabIndex].cols.filter(c => PERSONNEL_KEYS.has(c.key)).map(c => c.key);
    const { unknown, members } = resolveRecordGroupTokens(
      data[tabIndex].rows, key, canon, userByName, personnelCols,
    );
    recordGroupsPendingData.current = data;
    recordGroupsTabIndex.current = tabIndex;
    recordGroupsKeyRef.current = key;
    recordGroupsMembersRef.current = members;
    if (!unknown.size) {
      recordGroupsPendingData.current = null;
      gatesRef.current.resolveRecordGroups();
      recordGroupsMembersRef.current = null;
      // No new groups, but the file may still name members for existing
      // ones — merge ADD-only and save. `existing` was read moments ago in
      // THIS action (no popup sat open), so it is the fresh pre-save read.
      // Membership is an enhancement: a failed save warns and the import
      // continues untouched.
      if (members.size) {
        try {
          const { merged, changed } = mergeGroupMembers(existing, members);
          if (changed) await saveUserGroups(merged, cleanTenant ?? undefined);
        } catch (e) {
          console.warn("[import] adding group members failed — import continues", e);
        }
      }
      finishSubmit(cleanRecordGroupCells(data, tabIndex, key, canon));
      return;
    }
    setRecordGroupsPrompt([...unknown.values()]);
  };

  const confirmRecordGroups = async (picks: Record<string, string>) => {
    const pending = recordGroupsPendingData.current;
    const prompt = recordGroupsPrompt;
    if (!pending || !prompt) return;
    try {
      // Re-read right before writing — the list may have changed while the
      // popup sat open, and the save replaces the whole list.
      const fresh = await fetchUserGroups(cleanTenant ?? undefined);
      // Members collected from the cells: existing groups merge ADD-only,
      // new groups are born with theirs.
      const members = recordGroupsMembersRef.current ?? new Map<string, Set<string>>();
      const { merged: freshMerged, changed } = mergeGroupMembers(fresh, members);
      // No color → the server assigns the first unused palette color. The
      // picked level rides along as the group's default access level —
      // consumed by the STAFF import gate to fill empty Access Level cells.
      // (Pure logic in lib/importGroupMerge.ts — never touches `fresh`.)
      const additions = buildNewGroups(fresh, prompt, picks, members, Date.now() % 100000) as UserGroup[];
      const saved = (additions.length || changed)
        ? await saveUserGroups([...freshMerged, ...additions], cleanTenant ?? undefined)
        : fresh;
      const canon = new Map(saved.map(g => [g.name.trim().toLowerCase(), g.name.trim()] as const));
      for (const g of additions) {
        const k = g.name.trim().toLowerCase();
        if (!canon.has(k)) canon.set(k, g.name.trim());
      }
      const tabIndex = recordGroupsTabIndex.current;
      const key = recordGroupsKeyRef.current;
      setRecordGroupsPrompt(null);
      recordGroupsPendingData.current = null;
      recordGroupsMembersRef.current = null;
      // Levels offer answered too — the popup carried the suggested chips,
      // so ✕-declined levels stay declined for the rest of this pass.
      gatesRef.current.resolveRecordGroups({ viaPopupConfirm: true });
      finishSubmit(cleanRecordGroupCells(pending, tabIndex, key, canon));
    } catch (e) {
      console.error("[import] creating user groups failed", e);
      alert(`Could not create the new group${prompt.length > 1 ? "s" : ""}: ${e instanceof Error ? e.message : String(e)}\n\nYou can try again, or press Back and clear the Groups column.`);
    }
  };

  // Shared tail of BOTH submit paths (template + file mode). Validation
  // happens BEFORE this runs (gateValidationReview + the review grid), so by
  // the time we're here the data is clean; the orphan filter stays as a
  // silent safety net (a no-op after review).
  const finishSubmitInner = (data: { cols: ColDef[]; rows: Row[]; sheetName: string }[]) => {
    // Safety net: never start an empty import. Every entry point already
    // guards this (Upload buttons disable at 0 rows; the review grid blocks
    // an all-rows-skipped continue), but any path that slips through would
    // run a do-nothing job that still reports "complete" — fail loudly.
    if (data.every(d => d.rows.length === 0)) {
      alert("Nothing to import — every row was left out or empty, so no upload was started.");
      return;
    }
    // Three mandatory pause points before an import runs, walked in order by
    // the shared latch machine (lib/importGateLatches.ts — set on confirm
    // only, re-armed by Back, reset at every new submit pass):
    //   staffGroups  — team card: Groups present but Access Level missing →
    //                  resolve the group → level picks first.
    //   recordGroups — projects/opps cards: Groups / "Action User" column →
    //                  resolve against tenant user groups.
    //   newLevels    — ANY card with an Access Level column naming levels
    //                  that don't exist yet → create them BEFORE the import
    //                  runs (the Fix-issues remark points forward to exactly
    //                  this). ✕-declined levels are honored via the one-shot
    //                  latch (set on confirm) — no re-prompt loop.
    const staffGate = groupAclGate(data);
    const rgKey = cardId === "projects" ? "projGroups" : cardId === "opportunities" ? "opp_groups" : null;
    const rgTab = rgKey ? data.findIndex(d => d.cols.some(c => c.key === rgKey)) : -1;
    const rgActive = rgKey != null && rgTab >= 0 && data[rgTab].rows.some(r => String(r[rgKey] ?? "").trim());
    const gate = gatesRef.current.next({
      staffGroupsGate: !!staffGate,
      recordGroupsGate: rgActive,
      hasNewLevels: collectNewLevelNames(data).length > 0,
    });
    if (gate === "staffGroups" && staffGate) {
      // Groups with a stored default level (created from a record import)
      // are filled silently — the popup only asks about the rest. The
      // resolver awaits a fetch BEFORE any popup renders: latch + hold the
      // preparing overlay across that window so a rapid second click or a
      // grid edit can't double-submit or drift from the captured snapshot
      // (beginSubmit defers the preparing clear to us while latched).
      if (gateResolveBusyRef.current) return;
      gateResolveBusyRef.current = true;
      setPreparing(true);
      resolveGroupAcl(data, staffGate)
        .catch(reportSubmitError)
        .finally(() => { gateResolveBusyRef.current = false; setPreparing(false); });
      return;
    }
    if (gate === "recordGroups") {
      // Same latch + preparing hold as the staff gate above — this
      // resolver also fetches before its popup renders.
      if (gateResolveBusyRef.current) return;
      gateResolveBusyRef.current = true;
      setPreparing(true);
      resolveRecordGroups(data, rgTab, rgKey!)
        .catch(reportSubmitError)
        .finally(() => { gateResolveBusyRef.current = false; setPreparing(false); });
      return;
    }
    if (gate === "newLevels") {
      // Reuses the groups popup with an empty group list; its confirm
      // creates the levels and refreshes the level selects' opts, so
      // re-entry finds nothing new.
      groupAclPendingData.current = data;
      setGroupAclPrompt({ groups: [], tabIndex: 0 });
      return;
    }
    // Belt-and-braces: snap any remaining ticket-ID drift ("pmm 26 020") to
    // the DB's exact form at the ONE point both submit paths funnel through.
    // Catches values written before the ID list finished loading, drag-fill
    // copies of stale cells and review-grid edits. No-op off standalone cards
    // (ticketRefIndex null) and for unknown/ambiguous IDs (pass through, the
    // server-side ghost guard stays the final arbiter).
    if (ticketRefIndex) {
      data = data.map(d => {
        const refKey = d.cols.find(c => isTicketRefCol(c.key))?.key;
        if (!refKey) return d;
        return {
          ...d,
          rows: d.rows.map(r => {
            const cur = r[refKey] ?? "";
            const cv = canonTicketRef(cur);
            return cv === cur ? r : { ...r, [refKey]: cv };
          }),
        };
      });
    }
    const dataToImport = filterOrphanRows(cardId, tabs, data, hasLocalData || clientHasData);
    pendingImportRows.current = Object.fromEntries(tabs.map((t, i) => [t.id, dataToImport[i].rows]));
    pendingImportFile.current = exportXlsx(dataToImport);
    // Record what every exported header means, straight from the grid's own
    // column definitions — the server applies these verbatim instead of
    // re-guessing from its synonym dictionaries.
    const gridMappings = buildGridColumnMappings(dataToImport);
    pendingImportMappings.current = Object.keys(gridMappings).length > 0 ? gridMappings : null;
    // Merge-only imports (Aug 2026 redesign): there is no apply-mode question
    // any more. Fresh tenant / forceCreate → "create"; everything else →
    // "update" (add new rows, update matched ones, never remove). The server
    // independently coerces legacy "add"/"replace" to "update" and upgrades a
    // stray "create" for an existing client, so data safety never depends on
    // what the client sends.
    if (forceCreate || (!hasLocalData && !clientHasData)) { doImport("create" as ImportMode); return; }
    doImport("update" as ImportMode);
  };

  // LOUD-failure wrapper: finishSubmit is also re-entered directly by the
  // review grid's Continue and the group→access-level popup confirm, which
  // bypass beginSubmit's promise chain — so the try/catch lives here.
  const finishSubmit = (data: { cols: ColDef[]; rows: Row[]; sheetName: string }[]) => {
    try { finishSubmitInner(data); } catch (e) { reportSubmitError(e); }
  };

  // Validation gate shared by both submit paths: ONE scan covering missing
  // IDs, bad cell values, exact duplicates and orphan child rows. Any issue
  // opens the Excel-style review grid (fix inline / keep / skip per row);
  // a clean file goes straight through, exactly as before.
  //
  // Large-tenant path: when existingTicketIds is null (full list not shipped)
  // but checkTicketIds is available, collect every ID-column value from the
  // data, batch-check them server-side, and build a one-shot DbRefCheck from
  // the result before running the normal scan. Errors resolve to an empty
  // found-set (fail open — the server ghost-reference guard is still the
  // final backstop).
  const gateValidationReview = async (data: { cols: ColDef[]; rows: Row[]; sheetName: string }[]) => {
    // The cleaned-workbook export needs the Excel engine. It's preloaded on
    // mount, but a stale tab (chunk URL gone after a redeploy) or a slow
    // network can leave it missing — await it here so submit either works or
    // fails loudly, never a silent flash.
    await loadXlsx();
    let effectiveDbRef = dbRefCheck;
    if (!effectiveDbRef && checkTicketIds && isStandaloneRefCard) {
      // Gather every non-empty ID-column value from all sheets.
      const idValues: string[] = [];
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const refKey = tab.cols.find(c => isTicketRefCol(c.key))?.key;
        if (!refKey) continue;
        for (const row of data[i]?.rows ?? []) {
          const v = String(row[refKey] ?? "").trim();
          if (v) idValues.push(v);
        }
      }
      if (idValues.length) {
        const foundSet = await checkTicketIds(idValues).catch(() => new Set<string>());
        effectiveDbRef = {
          has: (raw: string) => {
            const t = (raw ?? "").trim();
            return !t || foundSet.has(t.toLowerCase());
          },
        };
      }
    }
    const issues = scanAllIssues(
      cardId, tabs.map((t, i) => ({ tab: t, rows: data[i].rows })), hasLocalData || clientHasData,
      { dbRefs: effectiveDbRef, strictKeys },
    );
    if (issues.length > 0) { gatesRef.current.markFixIssuesShown(); setValidationReview(data); return; }
    finishSubmit(data);
  };

  const submitTemplateData = () => {
    gatesRef.current.startSubmitPass();
    const data = tabs.map(tab => ({
      cols: tab.cols,
      // Defense in depth: the built-in example rows are never part of
      // tmplData, but strip anything matching them anyway.
      rows: (tmplData[tab.id] ?? []).filter(r => allowSampleRowsRef.current || !isBuiltinSampleRow(r)),
      sheetName: tab.sheetName,
    }));
    return gateValidationReview(data);
  };

  // ── Held-row fix-up ("Needs attention" panel) ───────────────────────────
  // Persist a review decision (tiny patch, never rows) so a refresh replays it.
  const recordHeldDecision = useCallback((dKey: string, patch: HeldDecision) => {
    const store = loadHeldStore(cardId);
    if (!store) return; // no active cleaning session — nothing to replay against
    const d = store.decisions[dKey] ?? {};
    if (patch.edits) d.edits = { ...(d.edits ?? {}), ...patch.edits };
    if (patch.status) d.status = patch.status;
    store.decisions[dKey] = d;
    saveHeldStore(cardId, store);
  }, [cardId]);

  const setHeldCell = useCallback((h: HeldRow, label: string, value: string) => {
    setHeldRows(prev => prev.map(x => x.id === h.id ? { ...x, cells: { ...x.cells, [label]: value } } : x));
    recordHeldDecision(h.dKey, { edits: { [label]: value } });
  }, [recordHeldDecision]);

  // opts.skipDecision: bulk callers record all decisions in ONE store write
  // afterwards — the per-row write re-parses the whole JSON blob each time.
  const addHeldRow = useCallback((h: HeldRow, opts?: { skipDecision?: boolean; stayOnTab?: boolean }) => {
    const tabDef = tabs.find(t => t.id === h.tabId);
    if (!tabDef) return;
    const req = requiredIdFor(cardId, h.tabId);
    if (req && !(h.cells[req.label] ?? "").trim()) return;
    setFileTabStates(prev => {
      const existing = prev[h.tabId];
      if (existing && existing.headers.length > 0) {
        // Append keyed by the tab's existing headers. Cleaned files use exact
        // template labels on both main and review sheets, so keys line up;
        // resolve through the mapping's template label as a fallback.
        const keyToLabel = new Map(tabDef.cols.map(c => [c.key, c.label]));
        const row: Row = {};
        for (const header of existing.colOrder) {
          const mappedKey = existing.mappings[header];
          const tplLabel = mappedKey && mappedKey !== SKIP ? keyToLabel.get(mappedKey) : undefined;
          row[header] = h.cells[header] ?? (tplLabel ? h.cells[tplLabel] : undefined) ?? "";
        }
        return { ...prev, [h.tabId]: { ...existing, rows: [...existing.rows, row] } };
      }
      // Main sheet was header-only (every row quarantined) → no usable tab
      // state exists. Synthesize one straight from the template columns.
      const headers = tabDef.cols.map(c => c.label);
      return {
        ...prev,
        [h.tabId]: {
          headers,
          colOrder: [...headers],
          mappings: Object.fromEntries(tabDef.cols.map(c => [c.label, c.key])),
          rows: [{ ...h.cells }],
          fixedValues: {},
          cellOverrides: {},
        },
      };
    });
    setMatchTypes(prev => prev[h.tabId] && Object.keys(prev[h.tabId]).length > 0
      ? prev
      : { ...prev, [h.tabId]: Object.fromEntries(tabDef.cols.map(c => [c.label, "auto" as const])) });
    setHeldRows(prev => {
      const rest = prev.filter(x => x.id !== h.id);
      // ── Cross-tab sync ────────────────────────────────────────────────
      // If the row just added is a PROJECT, other held rows (assignments /
      // schedule) that reference its name were prepared BEFORE it existed.
      // Offer it as an extra pickable candidate on those cards — and where
      // the row previously matched NOTHING, fill its ID in automatically.
      const addedId = String(h.cells["Project ID"] ?? "").trim();
      const addedTitle = String(h.cells["Project Title"] ?? "").trim();
      if (!addedId || !addedTitle) return rest;
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
      const key = norm(addedTitle);
      return rest.map(x => {
        if (x.tabId === h.tabId) return x;
        const refName = String(x.cells["Project"] ?? x.cells["Project Title"] ?? "").trim();
        if (!refName || norm(refName) !== key) return x;
        const cands = x.extraCands ?? [];
        if (cands.some(c => c.id === addedId)) return x;
        const next: HeldRow = { ...x, extraCands: [...cands, { id: addedId, title: addedTitle }] };
        // Previously matched nothing → the new project is the only match:
        // auto-fill the ID (never overwrite something already typed/picked).
        const kind = friendlyRemark(x.remarks).kind;
        const idLabel = requiredIdFor(cardId, x.tabId)?.label ?? "Project ID";
        if (kind === "notfound" && !String(x.cells[idLabel] ?? "").trim()) {
          next.cells = { ...x.cells, [idLabel]: addedId };
        }
        return next;
      });
    });
    setTotalFileRows(n => n + 1);
    // Programmatic family adds (clash verdicts, bulk resolves) must NOT yank
    // the user onto the Team Assignments / Schedule tab — only a direct
    // "+ Add" click on that tab should focus it.
    if (!opts?.stayOnTab) setActiveFileTab(h.tabId);
    // Snapshot the full cells (picked/typed ID included) so a refresh re-adds
    // this exact row even if individual edits were never recorded.
    if (!opts?.skipDecision) recordHeldDecision(h.dKey, { status: "added", edits: { ...h.cells } });
  }, [tabs, cardId, recordHeldDecision]);

  // ── Same-name project clash detection + resolution ──────────────────────
  // Groups of main-tab rows sharing one title across 2+ different IDs. One
  // card per title renders in the review view; settled groups drop out via
  // clashDecisions ("keepBoth" or "resolved").
  const nameClashGroups = useMemo<ClashGroup[]>(() => {
    if (!fileMode) return [];
    const ts = fileTabStates["main"];
    const mainDef = tabs.find(t => t.id === "main");
    const idCol = REQUIRED_ID_BY_CARD[cardId];
    const titleCol = TITLE_COL_BY_CARD[cardId];
    if (!ts || !mainDef || !idCol || !titleCol) return [];
    const idHeader = headerForKey(ts, idCol.label, idCol.key);
    const titleHeader = headerForKey(ts, titleCol.label, titleCol.key);
    if (!idHeader || !titleHeader) return [];
    const keyToLabel = new Map(mainDef.cols.map(c => [c.key, c.label]));
    const byName = new Map<string, { title: string; entries: ClashEntry[] }>();
    ts.rows.forEach((r, i) => {
      const ov = ts.cellOverrides?.[i] ?? {};
      const id = String(ov[idCol.key] ?? r[idHeader] ?? "").trim();
      const title = String(ov[titleCol.key] ?? r[titleHeader] ?? "").trim();
      if (!id || !title) return;
      const k = normProjName(title);
      const preview: [string, string][] = [];
      for (const h of ts.colOrder) {
        if (h === idHeader || h === titleHeader) continue;
        const mapped = ts.mappings[h];
        if (mapped === SKIP) continue;
        const v = String((mapped ? ov[mapped] : undefined) ?? r[h] ?? "").trim();
        if (!v) continue;
        preview.push([(mapped && keyToLabel.get(mapped)) || h, v]);
        if (preview.length >= 3) break;
      }
      const g = byName.get(k) ?? { title, entries: [] };
      g.entries.push({ id, rowNum: i + 1, preview });
      byName.set(k, g);
    });
    // Held project rows that already CARRY an ID join the clash detection too,
    // so the name clash shows up front — not only after the user adds the held
    // row to the grid. (Duplicate-kind held rows stay out: the grouped
    // "possible duplicate" cards own those decisions.)
    for (const h of heldRows) {
      if (h.tabId !== "main") continue;
      if (friendlyRemark(h.remarks).kind === "duplicate") continue;
      const id = String(h.cells[idCol.label] ?? "").trim();
      const title = String(h.cells["Project Title"] ?? h.cells["Project"] ?? "").trim();
      if (!id || !title) continue;
      const k = normProjName(title);
      const preview: [string, string][] = [];
      for (const [ck, cv] of Object.entries(h.cells)) {
        if (ck === idCol.label || ck === titleCol.label || ck === "Project Title" || ck === "Project") continue;
        const v = (cv ?? "").trim();
        if (!v) continue;
        preview.push([ck, v]);
        if (preview.length >= 3) break;
      }
      const g = byName.get(k) ?? { title, entries: [] };
      g.entries.push({ id, rowNum: parseInt(h.srcRow ?? "", 10) || 0, preview, held: h });
      byName.set(k, g);
    }
    const out: ClashGroup[] = [];
    for (const [k, g] of byName.entries()) {
      // Fully settled groups drop out.
      const dec = clashDecisions[k];
      if (dec === "keepBoth" || dec === "resolved") continue;
      // Same-ID repeats are the duplicate blocker's job — one entry per ID here.
      const seenIds = new Set<string>();
      const entries = g.entries.filter(e => (seenIds.has(e.id) ? false : (seenIds.add(e.id), true)));
      if (entries.length > 1) {
        // Entries in ID order so the same clash always shows its options the same way.
        out.push({ key: k, title: g.title, entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)) });
      }
    }
    // Deterministic order (alphabetical by name) — the held-row sort on the
    // other review tabs uses the same collation, so the Nth clash here lines
    // up with the Nth family of held assignment/schedule rows.
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }, [fileMode, fileTabStates, tabs, cardId, clashDecisions, heldRows]);

  // Held ambiguous rows that reference one project NAME are one decision —
  // shared by the held-card bulk button and the clash card's auto-resolve.
  const bulkTargetsByName = useCallback((nameKey: string, chosenId: string): { row: HeldRow; idLabel: string }[] => {
    if (!nameKey || !chosenId) return [];
    const out: { row: HeldRow; idLabel: string }[] = [];
    for (const x of heldRows) {
      if (friendlyRemark(x.remarks).kind !== "ambiguous") continue;
      if (normProjName(String(x.cells["Project"] ?? x.cells["Project Title"] ?? "")) !== nameKey) continue;
      const idLabel = requiredIdFor(cardId, x.tabId)?.label;
      if (!idLabel) continue;
      // Never overwrite a DIFFERENT ID the user already picked/typed.
      const cur = (x.cells[idLabel] ?? "").trim();
      if (!cur || cur === chosenId) out.push({ row: x, idLabel });
    }
    return out;
  }, [heldRows, cardId]);

  const bulkAddFamilyByName = useCallback((nameKey: string, chosenId: string) => {
    if (!chosenId) return;
    const patched: HeldRow[] = [];
    for (const { row: x, idLabel } of bulkTargetsByName(nameKey, chosenId)) {
      const p = { ...x, cells: { ...x.cells, [idLabel]: chosenId } };
      addHeldRow(p, { skipDecision: true, stayOnTab: true });
      patched.push(p);
    }
    if (!patched.length) return;
    // These rows joined the import without the user touching them — keep them
    // visible (read-only) on their tab so nothing "disappears" silently.
    setAutoAdded(prev => {
      const seen = new Set(prev.map(r => r.dKey));
      return [...prev, ...patched.filter(p => !seen.has(p.dKey))];
    });
    // ONE decision-store write for the whole family (not N re-parses of the
    // full JSON blob) so big families don't freeze the tab.
    const store = loadHeldStore(cardId);
    if (!store) return;
    for (const p of patched) {
      const d = store.decisions[p.dKey] ?? {};
      d.status = "added";
      d.auto = true;
      d.edits = { ...(d.edits ?? {}), ...p.cells };
      store.decisions[p.dKey] = d;
    }
    saveHeldStore(cardId, store);
  }, [bulkTargetsByName, addHeldRow, cardId]);

  // Main-tab held rows naming this project whose required ID is blank — they
  // surface INSIDE the clash table as "No ID yet" pick options so the whole
  // name is settled in one place.
  const clashHeldNoId = useCallback((nameKey: string): HeldRow[] => {
    const idLabel = requiredIdFor(cardId, "main")?.label;
    if (!idLabel) return [];
    return heldRows.filter(x =>
      x.tabId === "main" &&
      !(x.cells[idLabel] ?? "").trim() &&
      normProjName(String(x.cells["Project Title"] ?? x.cells["Project"] ?? "")) === nameKey);
  }, [heldRows, cardId]);

  // Held main-tab rows that a clash decision settles as COPIES: same name and
  // either no ID at all, or flagged as a duplicate of a row already in the
  // grid. Once the name has one decided ID, these have nothing left to add.
  const clashHeldCopies = useCallback((nameKey: string): HeldRow[] => {
    const idLabel = requiredIdFor(cardId, "main")?.label;
    return heldRows.filter(x =>
      x.tabId === "main" &&
      normProjName(String(x.cells["Project Title"] ?? x.cells["Project"] ?? "")) === nameKey &&
      ((idLabel ? !(x.cells[idLabel] ?? "").trim() : false) || friendlyRemark(x.remarks).kind === "duplicate"));
  }, [heldRows, cardId]);

  // "Keep only this one": the other same-named row(s) leave THIS import (the
  // database is untouched) and every held assignment/schedule row naming this
  // project resolves to the survivor automatically.
  const resolveNameClash = useCallback((g: ClashGroup, keepId: string) => {
    const loserIds = [...new Set(g.entries.map(e => e.id).filter(id => id !== keepId))];
    if (!loserIds.length) return;
    const idCol = REQUIRED_ID_BY_CARD[cardId];
    const rm = new Set(loserIds);
    const cur = fileTabStates["main"];
    let removedCount = 0;
    if (cur && idCol) {
      const idHeader = headerForKey(cur, idCol.label, idCol.key);
      if (idHeader) removedCount = cur.rows.length - removeRowsById(cur, idHeader, idCol.key, rm).rows.length;
    }
    setFileTabStates(prev => {
      const next = { ...prev };
      const ts = prev["main"];
      if (ts && idCol) {
        const hdr = headerForKey(ts, idCol.label, idCol.key);
        if (hdr) next["main"] = removeRowsById(ts, hdr, idCol.key, rm);
      }
      // Child tabs (Team Assignments / Schedule): rows still carrying a
      // losing ID are re-pointed at the kept ID in the SAME step, so the
      // tabs never drift out of sync with the Projects tab.
      for (const [tabId, cts] of Object.entries(prev)) {
        if (tabId === "main" || !cts) continue;
        const req = REQUIRED_ID_BY_TAB[tabId];
        if (!req) continue;
        const hdr = headerForKey(cts, req.label, req.key);
        if (!hdr) continue;
        next[tabId] = remapRowIds(cts, hdr, req.key, rm, keepId);
      }
      return next;
    });
    if (removedCount > 0) setTotalFileRows(n => Math.max(0, n - removedCount));
    bulkAddFamilyByName(g.key, keepId);
    // Held copies of this name (no ID / flagged duplicates) AND held clash
    // entries that lost the pick are settled by the same decision — clear
    // them so one click truly finishes the name.
    const heldLosers = g.entries.filter(e => e.held && e.id !== keepId).map(e => e.held!);
    const copies = clashHeldCopies(g.key);
    const dropped = [...copies, ...heldLosers.filter(h => !copies.some(c => c.id === h.id))];
    if (dropped.length) {
      const dropIds = new Set(dropped.map(c => c.id));
      setHeldRows(prev => prev.filter(x => !dropIds.has(x.id)));
    }
    const store = loadHeldStore(cardId);
    if (store) {
      store.decisions[`${CLASH_KEY_PREFIX}${g.key}`] = { status: "dismissed", removeIds: loserIds, keepId };
      for (const c of dropped) store.decisions[c.dKey] = { ...(store.decisions[c.dKey] ?? {}), status: "dismissed" };
      saveHeldStore(cardId, store);
    }
    setClashDecisions(prev => ({ ...prev, [g.key]: "resolved" }));
  }, [cardId, fileTabStates, bulkAddFamilyByName, clashHeldCopies]);

  // The survivor the user ticked is a held row with NO ID: the typed ID
  // becomes its Project ID, the row joins the grid, and every other row
  // carrying this name (the clashing grid rows + remaining held copies)
  // leaves this import. Held assignment/schedule rows naming the project
  // resolve to the typed ID automatically.
  const keepHeldAsClashWinner = useCallback((g: ClashGroup, held: HeldRow, typedIdRaw: string) => {
    const typedId = typedIdRaw.trim();
    if (!typedId) return;
    const idCol = REQUIRED_ID_BY_CARD[cardId];
    const loserIds = [...new Set(g.entries.map(e => e.id).filter(id => id !== typedId))];
    const rm = new Set(loserIds);
    const cur = fileTabStates["main"];
    let removedCount = 0;
    if (cur && idCol && rm.size) {
      const idHeader = headerForKey(cur, idCol.label, idCol.key);
      if (idHeader) removedCount = cur.rows.length - removeRowsById(cur, idHeader, idCol.key, rm).rows.length;
    }
    if (rm.size) setFileTabStates(prev => {
      const next = { ...prev };
      const ts = prev["main"];
      if (ts && idCol) {
        const hdr = headerForKey(ts, idCol.label, idCol.key);
        if (hdr) next["main"] = removeRowsById(ts, hdr, idCol.key, rm);
      }
      // Child tabs: rows carrying a losing ID follow the typed winner ID
      // immediately, so no tab is left pointing at a removed project.
      for (const [tabId, cts] of Object.entries(prev)) {
        if (tabId === "main" || !cts) continue;
        const req = REQUIRED_ID_BY_TAB[tabId];
        if (!req) continue;
        const hdr = headerForKey(cts, req.label, req.key);
        if (!hdr) continue;
        next[tabId] = remapRowIds(cts, hdr, req.key, rm, typedId);
      }
      return next;
    });
    if (removedCount > 0) setTotalFileRows(n => Math.max(0, n - removedCount));
    const idLabel = idCol?.label ?? "Project ID";
    const winner: HeldRow = { ...held, cells: { ...held.cells, [idLabel]: typedId } };
    addHeldRow(winner, { skipDecision: true });
    bulkAddFamilyByName(g.key, typedId);
    // Copies AND held clash entries that lost the pick leave with the winner.
    const heldLosers = g.entries.filter(e => e.held && e.held.id !== held.id && e.id !== typedId).map(e => e.held!);
    const copies = clashHeldCopies(g.key).filter(x => x.id !== held.id);
    const dropped = [...copies, ...heldLosers.filter(h => !copies.some(c => c.id === h.id))];
    if (dropped.length) {
      const dropIds = new Set(dropped.map(c => c.id));
      setHeldRows(prev => prev.filter(x => !dropIds.has(x.id)));
    }
    const store = loadHeldStore(cardId);
    if (store) {
      store.decisions[`${CLASH_KEY_PREFIX}${g.key}`] = { status: "dismissed", removeIds: loserIds, keepId: typedId };
      store.decisions[winner.dKey] = { ...(store.decisions[winner.dKey] ?? {}), status: "added", edits: { ...winner.cells } };
      for (const c of dropped) store.decisions[c.dKey] = { ...(store.decisions[c.dKey] ?? {}), status: "dismissed" };
      saveHeldStore(cardId, store);
    }
    setClashDecisions(prev => ({ ...prev, [g.key]: "resolved" }));
  }, [cardId, fileTabStates, addHeldRow, bulkAddFamilyByName, clashHeldCopies]);

  // "They're different jobs": every ID stays its own project, the shared
  // title is allowed through the duplicate-title upload block, and the group
  // settles in ONE step. Held assignment/schedule rows naming this project
  // reappear on their own tabs immediately — each shows the clashing IDs as
  // pick buttons, so the per-row project choice happens right where the rows
  // live.
  const finishKeepBoth = useCallback((g: ClashGroup) => {
    // Held rows among the clashing IDs are "different jobs" too — they join
    // the import as their own projects in the same one step.
    for (const e of g.entries) if (e.held) addHeldRow(e.held, { stayOnTab: true });
    const store = loadHeldStore(cardId);
    if (store) {
      store.decisions[`${CLASH_KEY_PREFIX}${g.key}`] = { status: "dismissed" };
      saveHeldStore(cardId, store);
    }
    setClashDecisions(prev => ({ ...prev, [g.key]: "keepBoth" }));
  }, [cardId, addHeldRow]);

  // ── "Possible duplicate" flags → ONE card per family ────────────────────
  // The engine flags near-identical names in both directions, so a pair used
  // to show as two mirrored notice cards. Reconnect them via the IDs each
  // flag names (its own row's ID + the "copy of" candidates) into connected
  // components. Members whose flag was one-directional still appear — their
  // id/title/srcRow come from the candidate list of the row that named them.
  const dupGroups = useMemo<DupGroup[]>(() => {
    if (!fileMode) return [];
    // Collect duplicate-kind held rows per tab (in practice: the main tab).
    const byTab = new Map<string, { rows: HeldRow[]; tabLabel: string }>();
    for (const h of heldRows) {
      if (friendlyRemark(h.remarks).kind !== "duplicate") continue;
      const idLabel = requiredIdFor(cardId, h.tabId)?.label;
      if (!idLabel || !(h.cells[idLabel] ?? "").trim()) continue; // no own ID → leave on the old per-row card
      const g = byTab.get(h.tabId) ?? { rows: [], tabLabel: h.tabLabel };
      g.rows.push(h);
      byTab.set(h.tabId, g);
    }
    const out: DupGroup[] = [];
    for (const [tabId, { rows, tabLabel }] of byTab.entries()) {
      const idLabel = requiredIdFor(cardId, tabId)!.label;
      const titleLabel = tabId === "main" ? TITLE_COL_BY_CARD[cardId]?.label : undefined;
      // Union-find over project IDs.
      const parent = new Map<string, string>();
      const find = (x: string): string => {
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r)!;
        let c = x;
        while (parent.get(c) !== c) { const n = parent.get(c)!; parent.set(c, r); c = n; }
        return r;
      };
      const ensure = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
      const union = (a: string, b: string) => { ensure(a); ensure(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
      const info = new Map<string, DupMember>();
      const note = (id: string, m: { title?: string; srcRow?: string; held?: HeldRow }) => {
        const cur = info.get(id) ?? { id, title: "" };
        if (m.held) cur.held = m.held;                       // held flag beats candidate info
        if (m.title && (!cur.title || m.held)) cur.title = m.title;
        if (m.srcRow && (!cur.srcRow || m.held)) cur.srcRow = m.srcRow;
        info.set(id, cur);
      };
      for (const h of rows) {
        const own = (h.cells[idLabel] ?? "").trim();
        ensure(own);
        note(own, {
          title: (titleLabel ? (h.cells[titleLabel] ?? "") : "").trim()
            || String(h.cells["Project Title"] ?? h.cells["Project"] ?? "").trim(),
          srcRow: h.srcRow,
          held: h,
        });
        for (const c of friendlyRemark(h.remarks).candidates ?? []) {
          if (!c.id.trim() || c.id.trim() === own) continue;
          note(c.id.trim(), { title: c.title, srcRow: c.srcRow });
          union(own, c.id.trim());
        }
      }
      // Components → groups (2+ members, at least one held flag to act on).
      const comps = new Map<string, DupMember[]>();
      for (const id of info.keys()) {
        ensure(id);
        const root = find(id);
        const list = comps.get(root) ?? [];
        list.push(info.get(id)!);
        comps.set(root, list);
      }
      for (const members of comps.values()) {
        if (members.length < 2 || !members.some(m => m.held)) continue;
        members.sort((a, b) => {
          const ra = parseInt(a.srcRow ?? "", 10), rb = parseInt(b.srcRow ?? "", 10);
          if (!isNaN(ra) && !isNaN(rb) && ra !== rb) return ra - rb;
          return a.id.localeCompare(b.id);
        });
        out.push({
          key: `${tabId}:${members.map(m => m.id).sort().join("|")}`,
          tabId, tabLabel, members,
        });
      }
    }
    // Deterministic order: by first member's file row, then key.
    out.sort((a, b) => {
      const ra = parseInt(a.members[0]?.srcRow ?? "", 10), rb = parseInt(b.members[0]?.srcRow ?? "", 10);
      if (!isNaN(ra) && !isNaN(rb) && ra !== rb) return ra - rb;
      return a.key.localeCompare(b.key);
    });
    return out;
  }, [fileMode, heldRows, cardId]);

  // Held rows swallowed by a grouped duplicate card — hidden from the
  // per-row lists (the ONE card is their only trace).
  const dupGroupedRowIds = useMemo(() => {
    const s = new Set<number>();
    for (const g of dupGroups) for (const m of g.members) if (m.held) s.add(m.held.id);
    return s;
  }, [dupGroups]);

  // One decision settles the whole family:
  //  keepId    → every OTHER member row leaves THIS import (grid rows removed
  //              by project ID — the database is never touched);
  //  keepAll   → all rows stay in the grid; the flags are dismissed;
  //  removeAll → every member row leaves this import.
  const resolveDupGroup = useCallback((g: DupGroup, action: { keepId?: string; keepAll?: boolean; removeAll?: boolean }) => {
    const allIds = g.members.map(m => m.id);
    const removeIds = action.keepAll ? [] : action.removeAll ? allIds : allIds.filter(id => id !== action.keepId);
    if (removeIds.length) {
      const idCol = requiredIdFor(cardId, g.tabId);
      const rm = new Set(removeIds);
      const cur = fileTabStates[g.tabId];
      let removedCount = 0;
      if (cur && idCol) {
        const idHeader = headerForKey(cur, idCol.label, idCol.key);
        if (idHeader) removedCount = cur.rows.length - removeRowsById(cur, idHeader, idCol.key, rm).rows.length;
      }
      setFileTabStates(prev => {
        const next = { ...prev };
        const ts = prev[g.tabId];
        if (ts && idCol) {
          const hdr = headerForKey(ts, idCol.label, idCol.key);
          if (hdr) next[g.tabId] = removeRowsById(ts, hdr, idCol.key, rm);
        }
        // "Keep this one" on the Projects tab: child rows carrying a removed
        // duplicate ID re-point at the kept ID in the same step.
        if (action.keepId && g.tabId === "main") {
          for (const [tabId, cts] of Object.entries(prev)) {
            if (tabId === "main" || !cts) continue;
            const req = REQUIRED_ID_BY_TAB[tabId];
            if (!req) continue;
            const hdr = headerForKey(cts, req.label, req.key);
            if (!hdr) continue;
            next[tabId] = remapRowIds(cts, hdr, req.key, rm, action.keepId);
          }
        }
        return next;
      });
      if (removedCount > 0) setTotalFileRows(n => Math.max(0, n - removedCount));
    }
    const heldInGroup = g.members.map(m => m.held).filter((h): h is HeldRow => !!h);
    const heldIds = new Set(heldInGroup.map(h => h.id));
    setHeldRows(prev => prev.filter(x => !heldIds.has(x.id)));
    const store = loadHeldStore(cardId);
    if (store) {
      // Row removals replay through the same clash:* removeIds path on refresh.
      if (removeIds.length) {
        store.decisions[`${CLASH_KEY_PREFIX}${DUP_GROUP_KEY_PREFIX}${[...allIds].sort().join("|")}`] =
          { status: "dismissed", removeIds,
            ...(action.keepId && g.tabId === "main" ? { keepId: action.keepId } : {}) };
      }
      for (const h of heldInGroup) store.decisions[h.dKey] = { ...(store.decisions[h.dKey] ?? {}), status: "dismissed" };
      saveHeldStore(cardId, store);
    }
  }, [cardId, fileTabStates]);

  // Final grid state → per-tab template rows: fixed values, column mappings
  // and every cell edit applied; blank rows and built-in sample rows dropped.
  // Shared by the import submit AND the reviewed-file export on review "Done".
  const buildFileTabData = () => {
    return tabs.map(tab => {
      const ts = fileTabStates[tab.id];
      if (!ts) return { cols: tab.cols, rows: [] as Row[], sheetName: tab.sheetName };
      const fv = ts.fixedValues ?? {};
      const overrides = ts.cellOverrides ?? {};
      const mappedRows = ts.rows.map((fileRow, ri) => {
        const out: Row = {};
        for (const [k, v] of Object.entries(fv)) out[k] = v;
        for (const h of ts.colOrder) {
          const key = ts.mappings[h];
          if (key && key !== SKIP) out[key] = fileRow[h] ?? "";
        }
        for (const [k, v] of Object.entries(overrides[ri] ?? {})) { if (v !== undefined) out[k] = v; }
        return out;
      }).filter(r => Object.values(r).some(v => v?.trim()))
        // Built-in template example rows must never be imported as real data
        // (unless the whole file IS the sample workbook — see processFile).
        .filter(r => allowSampleRowsRef.current || !isBuiltinSampleRow(r));
      return { cols: tab.cols, rows: mappedRows, sheetName: tab.sheetName };
    });
  };

  // ── Reviewed-file popup (review "Done") ────────────────────────────────
  // After the user settles their held-row / name-clash decisions and clicks
  // Done, offer the decisions-applied workbook for download and save it to
  // the cleaning session (S3) so History can re-serve it later.
  const [reviewedDialog, setReviewedDialog] = useState<{
    file: File;
    save: "saving" | "saved" | "failed";
    heldLeft: number;
  } | null>(null);

  const finishReview = () => {
    closeReview();
    try {
      const store = loadHeldStore(cardId);
      const sid = store?.sessionId || cleanSummary?.sid || "";
      if (!sid) return; // no cleaning session behind this grid — nothing to save
      const data = buildFileTabData();
      if (!data.some(d => d.rows.length > 0)) return;
      const base = (store?.fileName ?? cardId).replace(/\.(xlsx|xls)$/i, "");
      const file = exportXlsx(data, `${base}-REVIEWED.xlsx`);
      setReviewedDialog({ file, save: "saving", heldLeft: heldRows.length });
      const fd = new FormData();
      fd.append("file", file);
      if (store?.tenantOverride) fd.append("tenantId", store.tenantOverride);
      fetch(`/api/data-cleaning/reviewed/${sid}`, { method: "POST", headers: authHeaders(), body: fd })
        .then(r => { setReviewedDialog(prev => (prev ? { ...prev, save: r.ok ? "saved" : "failed" } : prev)); })
        .catch(() => { setReviewedDialog(prev => (prev ? { ...prev, save: "failed" } : prev)); });
    } catch (e) {
      // Never block closing the review over an export problem.
      console.error("[data-cleaning] reviewed export failed:", e);
    }
  };

  // ── Pre-upload mapping confirmation (file mode only) ───────────────────
  // Before an uploaded file starts importing, show every column match
  // (file header → RM ONE column) with sample values so a wrong landing spot
  // (e.g. "Title" ending up in the wrong column) is caught by eye first.
  // Confirm continues into the EXACT same flow as before (validation review →
  // import-mode question); Back returns to the grid. This popup runs earlier
  // than — and fully independent of — the add/update/replace mode decision.
  const buildMappingSummary = (data: { cols: ColDef[]; rows: Row[]; sheetName: string }[]) => {
    const normLbl = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const out: NonNullable<typeof mappingConfirm>["tabs"] = [];
    tabs.forEach((tab, i) => {
      const ts = fileTabStates[tab.id];
      const rows = data[i]?.rows ?? [];
      if (!ts || rows.length === 0) return;
      // Columns the user matched by hand in the column-check step — they get
      // a "you matched" tag below and drive the grid-peek highlights, so the
      // pick they just made is visibly reflected on this step too.
      const auditPicks = (colAudit?.unmatched ?? []).filter(u => u.mappedTo && u.tabId === tab.id);
      const mt = matchTypes[tab.id] ?? {};
      const mapped: (typeof out)[number]["mapped"] = [];
      for (const h of ts.colOrder) {
        const key = ts.mappings[h];
        if (!key || key === SKIP) continue;
        const col = tab.cols.find(c => c.key === key);
        if (!col) continue;
        const samples: string[] = [];
        for (const r of rows) {
          const v = (r[key] ?? "").trim();
          if (!v) continue;
          samples.push(v.length > 30 ? v.slice(0, 30) + "…" : v);
          if (samples.length >= 3) break;
        }
        // Flag matches worth a second look: the file's header text differs
        // from the column it lands in (synonym / fuzzy / AI matches). Columns
        // the user re-mapped by hand are trusted as-is.
        const warn = mt[h] !== "manual" && normLbl(h) !== normLbl(col.label);
        const fromAudit = auditPicks.some(p => p.col === h && p.mappedTo === key);
        mapped.push({ header: h, colLabel: col.label, colKey: key, warn, samples, fromAudit });
      }
      // Skipped file columns that actually carry data (scan capped for speed)
      // — shown so a silently-dropped column is visible before upload.
      const skipped: string[] = [];
      for (const h of ts.colOrder) {
        if ((ts.mappings[h] ?? SKIP) !== SKIP) continue;
        const cap = Math.min(ts.rows.length, 500);
        for (let ri = 0; ri < cap; ri++) {
          if ((ts.rows[ri][h] ?? "").trim()) { skipped.push(h); break; }
        }
      }
      const auditKeys = [...new Set(auditPicks.map(p => p.mappedTo as string))].filter(k => mapped.some(m => m.colKey === k));
      if (mapped.length || skipped.length) out.push({ id: tab.id, label: tab.label, rowCount: rows.length, mapped, skipped, auditKeys });
    });
    return out;
  };

  const submitFileData = () => {
    gatesRef.current.startSubmitPass();
    // Step 1 of the upload flow: if the file had columns the grid didn't
    // take and some are STILL unmapped, show the column-audit popup now
    // (it no longer pops right after the file loads — user request: one
    // continuous flow that starts at "Upload N rows"). Its Continue button
    // marks the audit acknowledged (data kept so the upload confirm's Back
    // can reopen it) and re-enters this submit via auditAutoSubmit; the X
    // close clears it and leaves the grid editable.
    if (colAudit && !colAudit.acknowledged && colAudit.unmatched.some(u => !u.mappedTo)) {
      setColAuditOpen(true);
      return;
    }
    const data = buildFileTabData();
    // Show the column-match confirmation first; Confirm re-enters the
    // unchanged validation → import flow with this exact data snapshot.
    const summary = buildMappingSummary(data);
    if (summary.length > 0) { setMappingConfirm({ data, tabs: summary }); return; }
    return gateValidationReview(data);
  };

  // ── Reviewed-file popup (shown after review "Done") ────────────────────
  const reviewedFileDialog = reviewedDialog && (
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-4" onClick={() => setReviewedDialog(null)}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Your reviewed file is ready</h2>
            <p className="text-xs text-gray-500 mt-1">
              This Excel has every decision you just made applied
              {reviewedDialog.heldLeft > 0
                ? ` — the ${reviewedDialog.heldLeft.toLocaleString()} held-back row${reviewedDialog.heldLeft !== 1 ? "s" : ""} you didn't add ${reviewedDialog.heldLeft !== 1 ? "are" : "is"} left out`
                : ""}.
            </p>
          </div>
        </div>

        <div className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
          reviewedDialog.save === "saved"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : reviewedDialog.save === "failed"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-gray-200 bg-gray-50 text-gray-600"
        }`}>
          {reviewedDialog.save === "saved" && "Saved — you can re-download it any time from Data Cleaning history."}
          {reviewedDialog.save === "failed" && "Couldn't save it to your cleaning history — you can still download it below."}
          {reviewedDialog.save === "saving" && "Saving to your cleaning history…"}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => setReviewedDialog(null)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-50"
          >
            Close
          </button>
          <button
            disabled={reviewedDialog.save === "saving"}
            onClick={() => {
              const url = URL.createObjectURL(reviewedDialog.file);
              const a = document.createElement("a");
              a.href = url;
              a.download = reviewedDialog.file.name;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: "#6BA539" }}
          >
            <Download className="w-3.5 h-3.5" /> Download Excel
          </button>
        </div>
      </div>
    </div>
  );

  // Group → access level popup — rendered in BOTH mode branches below,
  // beside the other overlays.
  // ── New-groups step: "Back" to the PREVIOUS wizard step ────────────────
  // The groups gate pauses the submit pipeline with the data snapshot held
  // in its pending ref. Back leaves the gate exactly like its Cancel (so the
  // pipeline re-gates cleanly on the next forward walk) and reopens the step
  // the user came from: Fix issues when the snapshot still flags rows, else
  // Review matches (file mode). A clean template pass has no earlier step to
  // land on, so the button only renders there after Fix issues was actually
  // part of this pass. (Second exit beside "Back to editing" — user request.)
  const canStepBackFromGroups = gatesRef.current.canStepBack(fileMode);
  const stepBackFromGroups = () => {
    const isStaffGate = !!groupAclPrompt;
    // Re-arm the New-levels offer — going Back means the user wants another
    // look, so the next Continue must pause on this step again.
    gatesRef.current.stepBack();
    const pending = isStaffGate ? groupAclPendingData.current : recordGroupsPendingData.current;
    if (isStaffGate) {
      setGroupAclPrompt(null);
      groupAclPendingData.current = null;
      groupAclDefaultPicks.current = {};
    } else {
      setRecordGroupsPrompt(null);
      recordGroupsPendingData.current = null;
      recordGroupsMembersRef.current = null;
    }
    if (!pending) return; // defensive — a gate without a snapshot ends at the grid
    // Same scan the validation gate runs (dbRefCheck may be null on huge
    // tenants — fewer flags shown; the server ghost guard stays the backstop).
    const issues = scanAllIssues(
      cardId, tabs.map((t, i) => ({ tab: t, rows: pending[i]?.rows ?? [] })), hasLocalData || clientHasData,
      { dbRefs: dbRefCheck, strictKeys },
    );
    if (issues.length > 0) { setValidationReview(pending); return; }
    if (fileMode) {
      const summary = buildMappingSummary(pending);
      if (summary.length > 0) { setMappingConfirm({ data: pending, tabs: summary }); return; }
    }
    // Nowhere earlier to land (clean template pass) — back to the grid.
  };

  // Unknown Access Level values in the paused snapshot — offered as
  // pre-seeded "will be created" chips in whichever groups popup shows.
  // groups:[] (levels-only prompt) = the dedicated New-levels wizard step.
  const groupAclSuggested = groupAclPrompt ? collectNewLevelNames(groupAclPendingData.current ?? []) : [];
  const levelsOnlyPrompt = !!groupAclPrompt && groupAclPrompt.groups.length === 0;
  const groupAclOverlay = groupAclPrompt && (
    <GroupAccessLevelPopup
      groups={groupAclPrompt.groups}
      customLevels={customAclNames}
      suggestedLevels={groupAclSuggested}
      title={levelsOnlyPrompt ? "New access levels in this file" : undefined}
      intro={levelsOnlyPrompt ? <>
        The Access Level column uses {groupAclSuggested.length === 1 ? "a level name" : "level names"} that
        {groupAclSuggested.length === 1 ? " doesn't" : " don't"} exist yet in Settings → Access Levels.
        Everything listed below is created for real when you continue, and the import carries on.
        Spot a typo? Remove it with the ✕ — those rows then keep the text exactly as written in the file.
      </> : undefined}
      confirmLabel={levelsOnlyPrompt ? "Create & continue" : undefined}
      onCancel={() => { setGroupAclPrompt(null); groupAclPendingData.current = null; groupAclDefaultPicks.current = {}; }}
      onBack={canStepBackFromGroups ? stepBackFromGroups : undefined}
      onConfirm={async (picks, newLevels) => {
        // Levels typed in the popup are created for real FIRST (Settings →
        // Access Levels), so the import pipeline resolves them like any other
        // custom level. On failure the popup stays open with picks intact —
        // loud alert, user retries or goes back; nothing is half-applied.
        if (newLevels.length) {
          try {
            const saved = await createCustomAccessLevels(newLevels, cleanTenant ?? undefined);
            const names = saved.map(l => String(l.name ?? "").trim()).filter(Boolean);
            setCustomAclNames(names);
            // Keep the grid's Access Level cell selects/validation in sync.
            if (applyCustomAccessLevelOpts(names)) setAclOptsVersion(v => v + 1);
          } catch (e) {
            console.error("[import] creating access levels failed", e);
            alert(`Could not create the new access level${newLevels.length > 1 ? "s" : ""}: ${e instanceof Error ? e.message : String(e)}\n\nYou can try again, or pick one of the existing levels and continue.`);
            return;
          }
        }
        const pending = groupAclPendingData.current;
        const prompt = groupAclPrompt;
        setGroupAclPrompt(null);
        groupAclPendingData.current = null;
        if (!pending || !prompt) return;
        // Confirm sets BOTH latches: the staff gate is answered and the
        // levels offer too (✕-declined levels stay declined this pass).
        gatesRef.current.resolveStaffGroups({ viaPopupConfirm: true });
        // Stored defaults resolved before the popup + the user's picks here.
        const merged = { ...groupAclDefaultPicks.current, ...picks };
        groupAclDefaultPicks.current = {};
        finishSubmit(applyGroupAclPicks(pending, prompt.tabIndex, merged));
      }}
      embedded
    />
  );

  // Create-groups overlay for the projects / opportunities "Groups" column —
  // SAME component as the staff popup above so the level cards (Admin /
  // Manager / User + tenant custom levels + "+ New level") show here too.
  // The pick becomes each new group's defaultAccessLevel: the next staff
  // import fills empty Access Level cells from it instead of asking again.
  const recordGroupsOverlay = recordGroupsPrompt && (
    <GroupAccessLevelPopup
      groups={recordGroupsPrompt}
      customLevels={customAclNames}
      suggestedLevels={collectNewLevelNames(recordGroupsPendingData.current ?? [])}
      title="New groups in this file"
      intro={<>
        The Groups / Action User column names groups that don&apos;t exist yet in
        Settings → User Groups. Pick the access level each new group&apos;s members
        get by default — the next staff import fills empty Access Level cells from it
        automatically. Need a level that doesn&apos;t exist yet? Use{" "}
        <span className="font-semibold">+ New level</span> — name it, tick what it can
        do, and it is created under Settings → Access Levels. Groups that already exist
        import directly. Person names listed next to a group, and the row&apos;s own
        team (Business Lead, Project Manager, Sr Project Manager), are added to that
        group as members automatically when they match existing staff.
      </>}
      countLabel={n => `${n.toLocaleString()} row${n === 1 ? "" : "s"}`}
      confirmLabel="Create & continue"
      embedded
      onCancel={() => { setRecordGroupsPrompt(null); recordGroupsPendingData.current = null; recordGroupsMembersRef.current = null; }}
      onBack={canStepBackFromGroups ? stepBackFromGroups : undefined}
      onConfirm={async (picks, newLevels) => {
        // Levels typed in the popup are created for real FIRST (Settings →
        // Access Levels) — same contract as the staff overlay above. On
        // failure the popup stays open with picks intact.
        if (newLevels.length) {
          try {
            const saved = await createCustomAccessLevels(newLevels, cleanTenant ?? undefined);
            const names = saved.map(l => String(l.name ?? "").trim()).filter(Boolean);
            setCustomAclNames(names);
            if (applyCustomAccessLevelOpts(names)) setAclOptsVersion(v => v + 1);
          } catch (e) {
            console.error("[import] creating access levels failed", e);
            alert(`Could not create the new access level${newLevels.length > 1 ? "s" : ""}: ${e instanceof Error ? e.message : String(e)}\n\nYou can try again, or pick one of the existing levels and continue.`);
            return;
          }
        }
        await confirmRecordGroups(picks);
      }}
    />
  );

  // Validation review overlay — replaces the old missing-ID / duplicate /
  // invalid-cell / orphan-ID popups. Rendered in BOTH mode branches below.
  const validationReviewOverlay = validationReview && (
    <ImportReviewGrid
      embedded
      tabs={tabs}
      data={validationReview}
      cardId={cardId}
      clientHasData={hasLocalData || clientHasData}
      strictKeys={strictKeys}
      dbRefCheck={dbRefCheck}
      rowNumOffset={fileMode ? 2 : 1}
      onCancel={() => setValidationReview(null)}
      onContinue={(fixed) => { setValidationReview(null); finishSubmit(fixed); }}
      onPeekGrid={(tabIdx, highlightRowIdxs) => {
        // Read-only peek at the FULL submitted data — duplicate decisions are
        // impossible to judge from the flagged rows alone, and the wizard
        // covers the grid (user request: a way to see "which is what").
        const d = validationReview?.[tabIdx];
        const tb = tabs[tabIdx];
        if (!d || !tb) return;
        setGridPeek({
          title: `${tb.label} — your full data`,
          note: highlightRowIdxs.length ? "rows under review are highlighted" : undefined,
          cols: d.cols.map(c => ({ key: c.key, label: c.label })),
          rows: d.rows,
          highlightRows: highlightRowIdxs,
          rowNumOffset: fileMode ? 2 : 1,
        });
      }}
    />
  );

  // Pre-upload mapping confirmation overlay — file-mode submits only, but
  // rendered in both branches beside the other overlays for consistency.
  // ── Wizard step wiring ────────────────────────────────────────────────
  // mappingConfirmContent / groupAclContent / validationContent are rendered
  // inside the ImportWizardOverlay (full-screen page) rather than as their
  // own floating modal dialogs. Only the inner card content lives here;
  // the wizard provides the backdrop, step indicator, and back button.

  const mappingConfirmOverlay = mappingConfirm && (
    /* Content rendered inside wizard — no fixed backdrop here. The wizard
       headline already says "Review column matches", so the card carries just
       ONE compact hint line (user request: no space-eating double header) and
       the table gets the full width. */
    <div className="bg-white rounded-xl shadow-xl w-full mx-auto p-5 flex flex-col min-h-0" style={{ maxHeight: "calc(100vh - 190px)" }}>
        <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
          <FileSpreadsheet className="w-4 h-4 text-indigo-600 flex-shrink-0" />
          <p className="text-xs text-gray-600 truncate">
            Each file column saves into the RM ONE column shown — look closely at any marked{" "}
            <span className="inline-flex items-center gap-0.5 text-amber-700 font-semibold"><AlertTriangle className="w-3 h-3" /> check</span>
            {" "}(the names aren't an exact match).
          </p>
        </div>

        {/* Scrollable middle region — the footer with Back / Confirm stays
            pinned below, always visible without scrolling to the bottom. */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 mt-4 pr-1">
        {mappingConfirm.tabs.map(t => (
          <div key={t.id} className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700">{t.label}</span>
              <div className="flex items-center gap-2.5">
                {/* Read-only peek at the real rows — with the columns the user
                    just matched in the column check highlighted, so they can
                    SEE where their pick landed (the wizard covers the grid). */}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                  onClick={() => {
                    const ti = tabs.findIndex(x => x.id === t.id);
                    const d = mappingConfirm.data[ti];
                    if (!d) return;
                    setGridPeek({
                      title: `${t.label} — what will be uploaded`,
                      note: t.auditKeys?.length ? "the columns you matched are marked" : undefined,
                      cols: t.mapped.map(m => ({ key: m.colKey, label: m.colLabel })),
                      rows: d.rows,
                      highlightColKeys: t.auditKeys,
                      rowNumOffset: 2,
                    });
                  }}
                >
                  <PeekTableIcon className="w-3.5 h-3.5" /> View in grid
                </button>
                <span className="text-[11px] text-gray-500">{t.rowCount.toLocaleString()} row{t.rowCount !== 1 ? "s" : ""}</span>
              </div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] text-gray-400">
                  <th className="text-left font-medium px-3 py-1.5 whitespace-nowrap">Your file column</th>
                  <th className="text-left font-medium px-3 py-1.5 whitespace-nowrap">Goes into</th>
                  <th className="text-left font-medium px-3 py-1.5 w-full">Sample data</th>
                </tr>
              </thead>
              <tbody>
                {t.mapped.map(m => (
                  <tr key={m.header} className={`border-t border-gray-100 align-top ${m.warn ? "bg-amber-50/60" : ""}`}>
                    <td className="px-3 py-1.5 font-medium text-gray-800 whitespace-nowrap">{m.header}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-gray-800">
                        <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />{m.colLabel}
                        {m.warn && (
                          <span className="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">
                            <AlertTriangle className="w-3 h-3" /> check
                          </span>
                        )}
                        {m.fromAudit && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-semibold whitespace-nowrap">you matched</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-500">{m.samples.length ? m.samples.join("  ·  ") : <span className="text-gray-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {t.skipped.length > 0 && (
              <div className="px-3 py-2 border-t border-gray-100 text-[11px] text-gray-500">
                Not imported (no matching column): <span className="font-medium text-gray-600">{t.skipped.join(", ")}</span>
              </div>
            )}
          </div>
        ))}
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-gray-100 flex-shrink-0">
          <p className="text-[11px] text-gray-400">
            {colAudit?.acknowledged
              ? <>Wrong match? Click <b>Back</b> to return to the column-matching step.</>
              : <>Wrong match? Click <b>Back</b> and change it from the column's header dropdown.</>}
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <Button size="sm" variant="outline" onClick={() => {
              setMappingConfirm(null);
              // Step back, not cancel: when the column-audit popup was step 1
              // of this upload flow, reopen it (un-acknowledged) instead of
              // dropping straight back to the grid.
              if (colAudit?.acknowledged) {
                setColAudit(prev => prev ? { ...prev, acknowledged: false } : prev);
                setColAuditOpen(true);
              }
            }}>
              Back
            </Button>
            <Button size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              disabled={isSubmitting || preparing}
              onClick={() => {
                const d = mappingConfirm.data;
                setMappingConfirm(null);
                beginSubmit(() => gateValidationReview(d));
              }}>
              <ArrowRight className="w-3.5 h-3.5 mr-1" />
              Confirm &amp; Upload
            </Button>
          </div>
        </div>
    </div>
  );

  // ── Wizard state ──────────────────────────────────────────────────────
  // ONE continuous full-page flow. Every stage of an upload — column check,
  // review matches, fix issues, new groups and the final processing wait —
  // renders inside the ImportWizardOverlay. No stage ever drops back to the
  // grid as a floating popup mid-flow.
  const hasAuditStep = fileMode && !!colAudit;
  const wizardSteps: WizardStepDef[] = [];
  const stepNum = { audit: 0, review: 0, fix: 0, groups: 0, run: 0 };
  ([
    ["audit",  "Column check",   hasAuditStep],
    ["review", "Review matches", fileMode],
    ["fix",    "Fix issues",     true],
    ["groups", levelsOnlyPrompt ? "New levels" : "New groups", true],
    ["run",    "Processing",     true],
  ] as [keyof typeof stepNum, string, boolean][]).forEach(([key, label, incl]) => {
    if (!incl) return;
    const num = wizardSteps.length + 1;
    stepNum[key] = num;
    wizardSteps.push({ num, label });
  });

  const auditStepOpen = !!(hasAuditStep && colAudit && colAuditOpen);
  // The server accepted /run for this grid's upload — the wizard's final
  // "Processing" step takes over (live terminal + Cancel Upload + Done); the
  // user is never dumped onto the separate status page mid-flow.
  const runActive = !!runningUploadId;
  // Busy transition (validation scan, group fetch, the upload HTTP call):
  // keep the wizard up with a progress card instead of dropping to the grid.
  const busyOnly = !!(preparing || isSubmitting) && !runActive
    && !auditStepOpen && !mappingConfirm && !validationReview
    && !groupAclPrompt && !recordGroupsPrompt;

  const concreteStep =
    runActive                                ? stepNum.run
    : auditStepOpen                          ? stepNum.audit
    : mappingConfirm                         ? stepNum.review
    : validationReview                       ? stepNum.fix
    : (groupAclPrompt || recordGroupsPrompt) ? stepNum.groups
    : isSubmitting                           ? stepNum.run
    : null;
  // Render-phase ref write is deliberate and idempotent — it records the
  // last concrete step so the pills hold steady across busy gaps.
  if (concreteStep != null) lastWizardStepRef.current = concreteStep;

  const wizardActive = concreteStep != null || busyOnly;
  const wizardStep   = concreteStep ?? lastWizardStepRef.current;
  const wizardTitle =
    runActive                                ? "Processing your import"
    : auditStepOpen                          ? "Check unmatched columns"
    : mappingConfirm                         ? "Review column matches"
    : validationReview                       ? "Fix issues before import"
    : (groupAclPrompt || recordGroupsPrompt) ? (levelsOnlyPrompt ? "New access levels" : "New groups")
    : isSubmitting                           ? "Uploading your data"
    : "Getting things ready…";
  const wizardSubtitle =
    runActive
      ? "Your data is importing — live progress below. It keeps running even if you leave this page."
    : auditStepOpen
      ? "Some columns in your file didn't match a grid column. Decide what happens to them, then continue."
    : mappingConfirm
      ? "" // one-line headline — the card carries the "check" hint inline (user request)
    : validationReview
      ? "A few rows need a decision — fix them inline, keep them as-is, or leave them out."
    : (groupAclPrompt || recordGroupsPrompt)
      ? (levelsOnlyPrompt
          ? "These access levels don't exist yet — review them below and they're created for you."
          : `These groups don't exist yet. Pick the default access level for each group's members.`)
    : isSubmitting
      ? "Hang tight — your file is being sent. Live progress appears right here."
      : "One moment…";
  // The Fix-issues step embeds the full review grid — give it real width.
  // Review matches gets real width too (user request: the table was cramped).
  const wizardMaxW =
    runActive          ? 860
    : validationReview ? 1500
    : mappingConfirm   ? 1140
    : auditStepOpen    ? 840
    : busyOnly         ? 560
    : 800;
  // Back wiring per step:
  //  • Column check (first step) → back to the GRID (same as the X close) —
  //    an explicit way out of the flow from step one.
  //  • Review matches → reopen the column-check step when one exists;
  //    without one it IS the first step, so Back returns to the grid.
  //  • New groups → previous step (Fix issues when rows still flag, else
  //    Review matches) — same handler as the card's in-card "Back"; absent
  //    on a clean template pass where no earlier step exists.
  //  • Fix issues keeps its own in-card Cancel controls.
  const wizardOnBack: (() => void) | undefined =
    runActive
      ? undefined
    : auditStepOpen
      ? () => { setColAudit(null); setColAuditOpen(false); }
    : mappingConfirm
      ? () => {
          setMappingConfirm(null);
          if (colAudit?.acknowledged) {
            setColAudit((prev) => prev ? { ...prev, acknowledged: false } : prev);
            setColAuditOpen(true);
          }
        }
    : (groupAclPrompt || recordGroupsPrompt)
      ? (canStepBackFromGroups ? stepBackFromGroups : undefined)
    : undefined;

  // ── Derived template values ───────────────────────────────────────────
  const activeTmplTabDef = tabs.find(t => t.id === activeTmplTab) ?? tabs[0];
  const activeTmplRows = tmplData[activeTmplTab] ?? [];
  const filledCounts = tabs.map(t => (tmplData[t.id] ?? []).filter(r => t.cols.some(c => r[c.key]?.trim()) && !isBuiltinSampleRow(r)).length);
  const totalFilled = filledCounts.reduce((a, b) => a + b, 0);

  // ── Shared file tab view vars ─────────────────────────────────────────
  const activeFileTabDef = tabs.find(t => t.id === activeFileTab) ?? tabs[0];
  const activeFileTs = fileTabStates[activeFileTab];
  const curOrder = activeFileTs?.colOrder ?? [];
  const curMappings = activeFileTs?.mappings ?? {};
  const curMatchTypes = matchTypes[activeFileTab] ?? {};

  // ── Wizard step content: column check / apply mode / busy card ────────
  // These previously rendered as standalone fixed-backdrop popups over the
  // grid; they now mount as children of the ImportWizardOverlay so the whole
  // upload reads as one continuous flow.
  const colAuditContent = auditStepOpen && colAudit ? (
    <div
      style={{
        width: "100%", maxWidth: 780, margin: "0 auto",
        borderRadius: 16, overflow: "hidden", backgroundColor: "#fff",
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
      }}
    >
              <div style={{
                background: "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)",
                padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
              }}>
                <AlertTriangle className="w-4 h-4 shrink-0 text-white" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white leading-tight">
                    {(() => {
                      const open = colAudit.unmatched.filter(u => !u.mappedTo).length;
                      return open === 0
                        ? "All file columns are now mapped"
                        : `${open} column${open !== 1 ? "s" : ""} from your file ${open !== 1 ? "were" : "was"} not taken`;
                    })()}
                  </p>
                  <p className="text-[11px] text-white/80 mt-0.5">
                    Your file has {colAudit.fileDataCols} columns with data — the grid matched{" "}
                    {colAudit.takenCols + colAudit.unmatched.filter(u => u.mappedTo).length}
                    {(() => {
                      const s = colAudit.unmatched.filter(u => eligiblePendingSuggestion(u, fileTabStates)).length;
                      return s > 0 ? ` · ${s} suggested below` : "";
                    })()}
                  </p>
                </div>
                <button className="shrink-0 text-white/80 hover:text-white" onClick={() => { setColAudit(null); setColAuditOpen(false); }} title="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-5 py-4 text-sm text-gray-700" style={{ maxHeight: "min(62vh, 560px)", overflowY: "auto" }}>
                <p className="text-xs text-gray-600 leading-relaxed">
                  These columns contain data but didn't match any template column.
                  Pick the grid column each one belongs to — or leave it as
                  “Don't import” and its data will be left out:
                </p>
                {colAudit.unmatched.some(u => eligiblePendingSuggestion(u, fileTabStates)) && (
                  <p className="text-xs text-amber-700 leading-relaxed mt-1.5">
                    <b>Amber rows are our best guess</b> from the column name and its
                    data — press <b>Apply suggested &amp; continue</b> to accept them,
                    or change any dropdown first.
                  </p>
                )}
                {(() => {
                  const bySheet = new Map<string, typeof colAudit.unmatched>();
                  for (const u of colAudit.unmatched) {
                    const arr = bySheet.get(u.sheet) ?? [];
                    arr.push(u);
                    bySheet.set(u.sheet, arr);
                  }
                  return [...bySheet.entries()].map(([sheet, entries]) => (
                    <div key={sheet} className="mt-3">
                      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">{sheet}</p>
                      <div className="mt-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-wide text-gray-400">
                        <span className="w-[26%] shrink-0">Your file column</span>
                        <span className="w-[27%] shrink-0">Example data</span>
                        <span className="text-[11px] invisible shrink-0">→</span>
                        <span className="flex-1 min-w-0">Grid column</span>
                      </div>
                      <div className="mt-1.5 space-y-1.5">
                        {entries.map(u => {
                          const tab = u.tabId ? tabs.find(t => t.id === u.tabId) : undefined;
                          const ts  = u.tabId ? fileTabStates[u.tabId] : undefined;
                          if (!tab || !ts) {
                            // Column from a sheet the grid couldn't route into any
                            // tab — its rows were never loaded, so there is nothing
                            // to remap. Template guidance still applies.
                            return (
                              <div key={u.col} className="flex items-center gap-2">
                                <div className="w-[26%] shrink-0 flex min-w-0">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-[11px] font-semibold max-w-full truncate" title={u.col}>
                                    {u.col}
                                  </span>
                                </div>
                                <span className="w-[27%] shrink-0 text-[10px] text-gray-500 truncate" title={(u.samples ?? []).join(" · ")}>
                                  {u.samples?.length ? <>e.g. {u.samples.slice(0, 2).join(" · ")}</> : <span className="text-gray-300">—</span>}
                                </span>
                                <span className="text-gray-400 text-[11px] shrink-0">→</span>
                                <span className="flex-1 min-w-0 text-[10px] text-gray-400 italic">sheet not recognized — use the template</span>
                              </div>
                            );
                          }
                          const usedKeys = new Set(Object.values(ts.mappings).filter(k => k !== SKIP));
                          // When the upload already carries Groups data, access
                          // levels are decided by the Groups → level popup, so
                          // offering "Access Level" here would invite junk
                          // mappings (file values always beat the popup's
                          // fills). It stays offered when there is no Groups
                          // data — then mapping a column is the only way in.
                          // Recomputed per render: mapping/unmapping Groups in
                          // this very popup updates the dropdowns instantly.
                          const groupsHeader = Object.entries(ts.mappings).find(([, k]) => k === "st_groups")?.[0];
                          const groupsHaveData = !!groupsHeader && ts.rows.some(r => String(r[groupsHeader] ?? "").trim() !== "");
                          // A grid column claimed only by an EMPTY file column
                          // stays offered here — the empty claim carries no
                          // data, and hiding the column made real columns
                          // (e.g. Start Date) impossible to pick.
                          const holderOf = new Map<string, string>();
                          for (const [h, k] of Object.entries(ts.mappings)) if (k !== SKIP) holderOf.set(k, h);
                          const holderHasData = (key: string) => {
                            const h = holderOf.get(key);
                            return !!h && ts.rows.some(r => String(r[h] ?? "").trim() !== "");
                          };
                          // A pending suggestion can become ineligible while
                          // the popup is open (e.g. the user maps a Groups
                          // column right here) — treat it as not-pending so
                          // the select value always resolves to a listed
                          // option and the count/label stay honest.
                          const pending = !u.mappedTo && !!u.suggestionPending && !!u.suggested &&
                            !(u.suggested === "st_accessLevel" && groupsHaveData);
                          const options = tab.cols.filter(c =>
                            (!usedKeys.has(c.key) || c.key === u.mappedTo || !holderHasData(c.key) || (pending && c.key === u.suggested)) &&
                            !(c.key === "st_accessLevel" && groupsHaveData && c.key !== u.mappedTo),
                          );
                          return (
                            <div key={u.col} className="flex items-center gap-2">
                              <div className="w-[26%] shrink-0 flex min-w-0">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold max-w-full truncate ${
                                    u.mappedTo
                                      ? "bg-green-50 border-green-300 text-green-700"
                                      : pending
                                        ? "bg-amber-50 border-amber-300 text-amber-700"
                                        : "bg-red-50 border-red-200 text-red-700"
                                  }`}
                                  title={u.col}
                                >
                                  {u.col}
                                </span>
                              </div>
                              <span className="w-[27%] shrink-0 text-[10px] text-gray-500 truncate" title={(u.samples ?? []).join(" · ")}>
                                {u.samples?.length ? <>e.g. {u.samples.slice(0, 2).join(" · ")}</> : <span className="text-gray-300">—</span>}
                              </span>
                              <span className="text-gray-400 text-[11px] shrink-0">→</span>
                              <select
                                value={u.mappedTo ?? (pending ? u.suggested : "")}
                                title={pending ? "Suggested match — press Continue to apply, or change it" : undefined}
                                onChange={e => {
                                  const key = e.target.value;
                                  if (key) {
                                    assignToTemplate(u.tabId!, key, u.col);
                                  } else if (u.mappedTo) {
                                    setMapping(u.tabId!, u.col, SKIP);
                                  }
                                  setColAudit(prev => prev ? {
                                    ...prev,
                                    unmatched: prev.unmatched.map(x =>
                                      x.sheet === u.sheet && x.col === u.col
                                        ? { ...x, mappedTo: key || undefined, suggestionPending: false }
                                        : x),
                                  } : prev);
                                }}
                                className={`flex-1 min-w-0 text-[11px] rounded-md border px-2 py-1 bg-white outline-none focus:ring-1 focus:ring-indigo-400 ${
                                  u.mappedTo
                                    ? "border-green-300 text-green-700 font-semibold"
                                    : pending
                                      ? "border-amber-400 text-amber-700 font-semibold bg-amber-50"
                                      : "border-gray-300 text-gray-600"
                                }`}
                              >
                                <option value="">Don't import</option>
                                {options.map(c => (
                                  <option key={c.key} value={c.key}>{c.label}{pending && c.key === u.suggested ? " (suggested)" : ""}</option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
                <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    <b>Tip:</b> mappings you pick here apply instantly — you can also change
                    any column's source later using the chip under each grid column header.
                    For unrecognized sheets, download the template below, copy your data into
                    it, and re-upload.
                  </p>
                </div>
              </div>
              <div className="px-5 pb-4 flex gap-2 justify-end">
                <button
                  onClick={() => { void downloadGridTemplate(); }}
                  className="px-4 py-2 rounded-lg text-white text-xs font-bold shadow-sm hover:brightness-105"
                  style={{ background: "linear-gradient(135deg, #f97316, #f59e0b)" }}>
                  Download template
                </button>
                <button
                  onClick={() => {
                    // Apply the still-pending suggestions the user just
                    // confirmed. Steal-guard: never take a grid column that a
                    // DATA-bearing file column claims by now (empty claims
                    // are released — they carry nothing). Decisions are
                    // simulated synchronously from the current snapshot so
                    // the audit rows flip to mapped ONLY for suggestions
                    // that truly applied — steal-guard skips stay pending
                    // (keeps the submit gate honest after Back) — and the
                    // state updaters stay pure consumers (StrictMode-safe).
                    const pend = colAudit.unmatched.filter(u => eligiblePendingSuggestion(u, fileTabStates));
                    const byTab = new Map<string, typeof pend>();
                    for (const u of pend) { const a = byTab.get(u.tabId!) ?? []; a.push(u); byTab.set(u.tabId!, a); }
                    const appliedCols = new Set<string>(); // sheet\u0000col of truly-applied suggestions
                    const nextTabStates: Record<string, (typeof fileTabStates)[string]> = {};
                    const appliedByTab = new Map<string, string[]>();
                    for (const [tabId, list] of byTab) {
                      const cur = fileTabStates[tabId]; if (!cur) continue;
                      const mappings = { ...cur.mappings };
                      for (const u of list) {
                        const key = u.suggested!;
                        // Re-check the dropdown's eligibility rules at
                        // apply time: Access Level stays off-limits while
                        // a data-bearing Groups column decides levels.
                        if (key === "st_accessLevel") {
                          const gh = Object.entries(mappings).find(([, k]) => k === "st_groups")?.[0];
                          if (gh && cur.rows.some(r => String(r[gh] ?? "").trim() !== "")) continue;
                        }
                        const holder = Object.entries(mappings).find(([, k]) => k === key)?.[0];
                        if (holder && cur.rows.some(r => String(r[holder] ?? "").trim() !== "")) continue;
                        if (holder) mappings[holder] = SKIP;
                        mappings[u.col] = key;
                        appliedCols.add(`${u.sheet}\u0000${u.col}`);
                        appliedByTab.set(tabId, [...(appliedByTab.get(tabId) ?? []), u.col]);
                      }
                      nextTabStates[tabId] = { ...cur, mappings };
                    }
                    if (Object.keys(nextTabStates).length > 0) {
                      setFileTabStates(prev => {
                        const out = { ...prev };
                        for (const [tabId, st] of Object.entries(nextTabStates)) if (out[tabId]) out[tabId] = st;
                        return out;
                      });
                    }
                    for (const [tabId, cols] of appliedByTab) {
                      setMatchTypes(prev => ({
                        ...prev,
                        [tabId]: {
                          ...(prev[tabId] ?? {}),
                          ...Object.fromEntries(cols.map(c => [c, "manual" as const])),
                        },
                      }));
                    }
                    // Keep the audit data and mark it acknowledged — the
                    // upload confirm's Back button reopens this step. Only
                    // truly-applied suggestions turn green/mapped here.
                    setColAudit(prev => prev ? {
                      ...prev,
                      acknowledged: true,
                      unmatched: prev.unmatched.map(x =>
                        appliedCols.has(`${x.sheet}\u0000${x.col}`)
                          ? { ...x, mappedTo: pend.find(p => p.sheet === x.sheet && p.col === x.col)!.suggested, suggestionPending: false }
                          : x),
                    } : prev);
                    setColAuditOpen(false);
                    // Continuous flow: go straight on to the upload confirm.
                    setAuditAutoSubmit(n => n + 1);
                  }}
                  className={`px-4 py-2 rounded-lg text-xs font-bold border ${
                    colAudit.unmatched.some(u => eligiblePendingSuggestion(u, fileTabStates))
                      ? "border-amber-300 bg-amber-500 text-white hover:brightness-105"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}>
                  {(() => {
                    const n = colAudit.unmatched.filter(u => eligiblePendingSuggestion(u, fileTabStates)).length;
                    if (n > 0) return `Apply ${n} suggested & continue`;
                    return "Continue";
                  })()}
                </button>
              </div>
    </div>
  ) : null;

  // Busy transitions (validation scan / group fetch) + the final upload:
  // the staged progress card renders as the wizard's step content.
  // After a successful in-wizard run, clear the submitted data — mirrors the
  // old navigate-to-status-page flow (returning remounted a blank grid) and
  // prevents accidentally double-importing the same file. Failed or cancelled
  // runs keep everything loaded so the user can fix and retry.
  const resetAfterRun = () => {
    if (fileMode) {
      setFileMode(false); setFileTabs(null); setFileTabStates({}); setBatchCheckedIds(null);
      setShowTemplateWarning(false); setColAudit(null); setColAuditOpen(false); setMessyWarning(null);
      setHeldRows([]); setCleanSummary(null); setDroppedInfo(null); setDroppedPicks({});
      setDroppedTabSel(""); setClashDecisions({}); setClashPicks({});
      allowSampleRowsRef.current = false; setSampleKeptCount(0); setSampleSkipCount(0);
      const st = loadHeldStore(cardId);
      if (st?.sessionId) void deleteCachedCleanedFile(st.sessionId);
      clearHeldStore(cardId);
    }
    // Template mode keeps its typed rows — imports upsert server-side, so a
    // re-submit is harmless, and wiping hand-typed work would hurt more.
    onClear?.();
  };
  // Final wizard step: the SAME live terminal as the status page, plus Cancel
  // Upload and Done — the whole flow ends inside the wizard (user request).
  const runContent = runActive && runningUploadId ? (
    <ImportRunPanel
      key={runningUploadId}
      uploadId={runningUploadId}
      onDone={(ok) => { if (ok && !runIsExternal) resetAfterRun(); onRunClosed?.(ok); }}
    />
  ) : null;

  const busyContent = busyOnly ? (
    <UploadingCard
      rowCount={fileMode ? totalFileRows : totalFilled}
      label={isSubmitting ? "Uploading your data" : "Checking your file"}
    />
  ) : null;

  // Template-fixed view derived values:
  // reverseMap: templateKey → fileHeader (which file col feeds each template col)
  const reverseMap: Record<string, string> = {};
  for (const [h, k] of Object.entries(curMappings)) {
    if (k !== SKIP) reverseMap[k] = h;
  }
  // Extra file cols: those still mapped to SKIP (no template col accepted them)
  const extraHeadersAll = curOrder.filter(h => curMappings[h] === SKIP);
  // Available file cols for reassignment = currently SKIP'd
  const availableFileHeaders = (activeFileTs?.headers ?? []).filter(h => curMappings[h] === SKIP);
  // First non-empty value per file column — shown as a sample in the source-picker dropdown
  const availableHeaderSamples = useMemo<Record<string, string>>(() => {
    const rows = activeFileTs?.rows ?? [];
    const hdrs = activeFileTs?.headers ?? [];
    const out: Record<string, string> = {};
    for (const h of hdrs) {
      for (const r of rows) {
        const v = String(r[h] ?? "").trim();
        if (v) { out[h] = v.length > 28 ? v.slice(0, 28) + "…" : v; break; }
      }
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileTs]);
  // Fixed (constant) values typed by the user for template cols with no file source
  const curFixedValues = activeFileTs?.fixedValues ?? {};
  // Count both file-mapped and fixed-value template cols as "filled"
  const mappedTemplateCount = Object.keys(reverseMap).length + Object.keys(curFixedValues).length;

  // Detect cross-tab columns: extras that match a template col in ANOTHER tab
  const normH = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Role keywords: fast synchronous fallback while the LLM cross-tab call is
  // still in-flight. Once crossTabHints is populated these become redundant.
  const ROLE_KEYWORDS = ["lead", "manager", "principal", "supervisor", "estimator",
    "engineer", "director", "coordinator", "superintendent", "architect",
    "inspector", "foreman", "officer", "head", "exec", "vp", "ceo", "cfo", "coo", "cto"];

  // Returns the OTHER tab label if this file col belongs there; null = truly extra.
  // Priority: 1) LLM-confirmed hint  2) exact template label/key match
  //           3) role-keyword heuristic (fast sync fallback)
  const getOtherTabLabel = (fh: string): string | null => {
    // 1. LLM-confirmed cross-tab classification (most reliable; async)
    if (crossTabHints[fh]) return crossTabHints[fh];
    // 2. Exact label/key match against another tab's template columns
    for (const t of tabs) {
      if (t.id === activeFileTab) continue;
      const n = normH(fh);
      if (t.cols.some(c => normH(c.label) === n || normH(c.key) === n)) return t.label;
    }
    // 3. Keyword heuristic: sync fallback until LLM result arrives
    const asgTab = tabs.find(t => t.id !== activeFileTab);
    if (asgTab) {
      const headerNorm = normH(fh);
      if (ROLE_KEYWORDS.some(k => headerNorm.includes(k))) return asgTab.label;
    }
    return null;
  };

  // crossTabExtras: belong to another tab; trueExtras: not in any template
  const crossTabExtras = extraHeadersAll.filter(h => getOtherTabLabel(h) !== null);
  const trueExtras = extraHeadersAll.filter(h => getOtherTabLabel(h) === null);
  // Combined extra headers in display order: cross-tab first, truly extra last
  const extraHeaders = [...crossTabExtras, ...trueExtras];

  // ════════════════════════════════════════════════════════════════════════
  // FILE MODE
  // ════════════════════════════════════════════════════════════════════════
  if (fileMode && Object.keys(fileTabStates).length > 0) {
    // Step-gated review flow: while Step 1 (column mapping of dropped columns)
    // is unresolved, competing buttons (Upload, Add Row, Continue to import)
    // and the Step 2 row-decisions section stay hidden. Must mirror the Step 1
    // panel's own render condition (cleanSummary present, not fallback) so the
    // gates can never be stricter than the panel that resolves them.
    // CLEANING_HIDDEN: the Step 1 column-mapping panel is hidden, so this gate
    // must be permanently open — otherwise a restored cleaning session hides
    // the Upload button with no visible way to unlock it.
    // Old predicate: !readOnly && !!cleanSummary && !cleanSummary.fallback
    //   && (droppedInfo?.cols.length ?? 0) > 0;
    const mappingPending = false;
    // Filter out assignment/phase rows from the Projects display.
    // Strategy: a row is a valid project row only if it has data in at least one
    // For the main (projects/leads) tab only: filter out rows that look like
    // team-assignment or schedule rows by requiring at least one strong project field.
    // For assignments and schedule tabs, show all rows without filtering.
    const STRONG_PROJECT_KEYS = new Set([
      "companyName", "type", "shortName", "projectId",
      "marketSector", "projectType", "businessUnit",
      "contractValue", "status", "category",
    ]);
    const allRows = activeFileTs?.rows ?? [];
    const isMainTab = activeFileTab === tabs[0].id;
    const isManualRow = (row: Row) => (row[MANUAL_ROW_KEY] ?? "") === "1";
    const passesStrong = (row: Row) => {
      for (const col of activeFileTabDef.cols) {
        if (!STRONG_PROJECT_KEYS.has(col.key)) continue;
        const fh = reverseMap[col.key];
        if (fh && (row[fh] ?? "").toString().trim()) return true;
      }
      return false;
    };
    // Filtered rows + display→real index map + stable column widths, cached in
    // fileGridCacheRef so scroll re-renders never re-scan a large file. The
    // mapping signature (which file column feeds each template column) is part
    // of the key because both the strong-field filter and the sampled column
    // widths depend on it.
    const mapSig = activeFileTab + "\u0000" + activeFileTabDef.cols.map(c => reverseMap[c.key] ?? "").join("\u0000");
    let fgc = fileGridCacheRef.current;
    if (!fgc || fgc.rows !== allRows || fgc.tabId !== activeFileTab || fgc.mapSig !== mapSig) {
      // Only apply the strong-field filter when at least one FILE row passes it —
      // otherwise show everything (same fallback as before manual rows existed).
      // Manual "Add Row" rows always stay visible regardless of the filter.
      const anyStrong = isMainTab && allRows.some(r => !isManualRow(r) && passesStrong(r));
      const filteredRows = anyStrong ? allRows.filter(row => isManualRow(row) || passesStrong(row)) : [];
      // If no row passes (or non-main tab), fall back to showing all rows
      const effRows = filteredRows.length > 0 ? filteredRows : allRows;
      // Each display row carries its REAL index in ts.rows — cellOverrides,
      // selection and edit state are keyed by that index (submitFileData reads
      // overrides by ts.rows position), so display position must never be used
      // as the state key. realIdx is null when display order === ts.rows order.
      let realIdx: number[] | null = null;
      if (effRows !== allRows) {
        const realIdxOf = new Map<Row, number>();
        allRows.forEach((r, i) => realIdxOf.set(r, i));
        realIdx = effRows.map(r => realIdxOf.get(r) ?? 0);
      }
      // Stable per-column widths from a data sample — the table uses fixed
      // layout so columns can never resize while the virtual window scrolls.
      const colWs: Record<string, number> = {};
      for (const col of activeFileTabDef.cols) {
        const fh = reverseMap[col.key];
        let maxLen = col.label.length;
        if (fh) {
          const n = Math.min(effRows.length, 150);
          for (let i = 0; i < n; i++) {
            const l = (effRows[i][fh] ?? "").toString().length;
            if (l > maxLen) maxLen = l;
          }
        }
        colWs[col.key] = Math.max(col.w, Math.min(240, Math.round(maxLen * 6.6) + 26));
      }
      fgc = { rows: allRows, tabId: activeFileTab, mapSig, effectiveRows: effRows, realIdx, colWs };
      fileGridCacheRef.current = fgc;
    }
    const { effectiveRows, realIdx: fgRealIdx, colWs: fgColWs } = fgc;
    const fileGridW = 40 + activeFileTabDef.cols.reduce((s, c) => s + (fgColWs[c.key] ?? c.w), 0);
    // Per-tab search: filters the DISPLAYED rows only — cellOverrides,
    // selection and edit state stay keyed by REAL ts.rows indices, so
    // matching rows keep their edits and the upload always sends every row.
    // Matches any mapped column's raw file value (case-insensitive), cached
    // so scroll re-renders never re-scan a large file.
    const fileSearchQ = fileSearch.trim().toLowerCase();
    let displayRows = effectiveRows;
    let dispRealIdx = fgRealIdx;
    if (fileSearchQ) {
      let sc = fileSearchCacheRef.current;
      // Key includes mapSig: remapping a column chip changes which file
      // headers are searched even when the row array identity is unchanged.
      if (!sc || sc.base !== effectiveRows || sc.q !== fileSearchQ || sc.mapSig !== mapSig) {
        const mappedHeaders = activeFileTabDef.cols
          .map(c => reverseMap[c.key]).filter((h): h is string => !!h);
        const rows: Row[] = [];
        const realIdx: number[] = [];
        effectiveRows.forEach((r, di) => {
          const hit = mappedHeaders.some(fh =>
            (r[fh] ?? "").toString().toLowerCase().includes(fileSearchQ));
          if (hit) { rows.push(r); realIdx.push(fgRealIdx ? fgRealIdx[di] : di); }
        });
        sc = { base: effectiveRows, q: fileSearchQ, mapSig, rows, realIdx };
        fileSearchCacheRef.current = sc;
      }
      displayRows = sc.rows;
      dispRealIdx = sc.realIdx;
    }
    // Virtual window: render only the rows inside (and just around) the
    // viewport; spacer rows keep the scrollbar sized for the full file.
    const totalRows = displayRows.length;
    const winStart = Math.max(0, Math.min(vWin.start, Math.max(0, totalRows - 1)));
    const winEnd = Math.min(totalRows, winStart + vWin.count);
    const windowRows: { row: Row; idx: number; ri: number }[] = [];
    for (let di = winStart; di < winEnd; di++) {
      windowRows.push({ row: displayRows[di], idx: dispRealIdx ? dispRealIdx[di] : di, ri: di });
    }
    const padTop = winStart * FILE_ROW_H;
    const padBottom = (totalRows - winEnd) * FILE_ROW_H;
    const hiddenCount = isMainTab ? allRows.length - effectiveRows.length : 0;

    return (
      <div className={embedded ? "flex flex-col flex-1 min-h-0 overflow-hidden" : "fixed inset-0 z-50 flex flex-col"} style={{ backgroundColor: "var(--rm-panel)" }}>
        {/* Read-only history view: the initialFile parse blocks the main
            thread for large workbooks — without this the grid looks frozen. */}
        {readOnly && uploading && !isSubmitting && !preparing && (
          <div className="fixed inset-0 z-[80] bg-white/90 flex flex-col items-center justify-center gap-3 text-gray-600">
            <span className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            <span className="text-sm font-medium">Preparing preview of {cardLabel}…</span>
            <span className="text-xs text-gray-400">Large files can take a little while to open.</span>
          </div>
        )}
        {/* CLEANING_HIDDEN: cleaning && <CleaningPopup pct={cleaning.pct} msg={cleaning.msg} restore={cleaning.restore} onCancel={cancelCleaning} onSkip={skipCleaning} /> */}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />


        {/* AI Processing Popup */}
        {aiMatchingTabs.size > 0 && (
          <div className="fixed inset-0 z-[70] pointer-events-none flex items-start justify-center pt-20">
            <div className="pointer-events-auto bg-white rounded-2xl shadow-2xl border border-amber-200 px-6 py-5 w-80 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                  <span className="w-5 h-5 rounded-full border-[2.5px] border-amber-500 border-t-transparent animate-spin block" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 text-sm leading-tight">AI Column Matching</p>
                  <p className="text-xs text-gray-500 mt-0.5">Analysing unrecognised column headers…</p>
                </div>
              </div>
              {/* Animated indeterminate progress bar */}
              <div className="w-full h-1.5 bg-amber-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-amber-500 to-amber-300 bg-[length:200%_100%] animate-pulse" />
              </div>
              <div className="flex items-center justify-between text-[10px] text-gray-400">
                <span>Powered by RM ONE AI</span>
                <span>{[...aiMatchingTabs].map(t => tabs.find(x => x.id === t)?.label).filter(Boolean).join(", ")}</span>
              </div>
            </div>
          </div>
        )}

        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 shadow-sm shrink-0" style={{ borderBottom: "1px solid var(--rm-panel-border)", backgroundColor: "var(--rm-panel)" }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { if (readOnly) { onClose(); } else { setFileMode(false); setFileTabs(null); setShowTemplateWarning(false); setColAudit(null); setMessyWarning(null); allowSampleRowsRef.current = false; setSampleKeptCount(0); } }}
              className="flex items-center gap-1 text-xs font-bold text-gray-900 transition hover:text-indigo-700"
            >
              <ChevronLeft className="w-4 h-4" /> {readOnly ? "Close" : "Back to template"}
            </button>
            <span style={{ color: "var(--rm-text-faint)" }}>|</span>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
              <span className="font-semibold text-sm" style={{ color: "var(--rm-text)" }}>{filename}</span>
              <span className="text-xs rounded-full px-2 py-0.5" style={{ color: "var(--rm-text-muted)", backgroundColor: "var(--rm-panel-soft)" }}>{totalFileRows} rows</span>
              {readOnly && (
                <span className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-2 py-0.5 font-medium">
                  View Only
                </span>
              )}
            </div>
          </div>
          {!readOnly && !thisModRunning && (
            <div className="flex items-center gap-2">
              {!mappingPending && (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                  style={{ borderColor: "var(--rm-panel-border)", color: "var(--rm-text)", backgroundColor: "var(--rm-panel-soft)" }}
                  onClick={addFileRow}>
                  <Plus className="w-3 h-3" /> Add Row
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                style={{ borderColor: "var(--rm-panel-border)", color: "var(--rm-text)", backgroundColor: "var(--rm-panel-soft)" }}
                onClick={() => fileRef.current?.click()} disabled={uploading || !!cleaning}>
                <Upload className="w-3 h-3" /> Change File
              </Button>
              <Button size="sm" variant="outline"
                className="h-7 text-xs gap-1 border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => {
                  if (!window.confirm(`Clear the uploaded file "${filename}" and its ${totalFileRows} row${totalFileRows !== 1 ? "s" : ""}? This can't be undone.`)) return;
                  setFileMode(false); setFileTabs(null); setFileTabStates({}); setBatchCheckedIds(null); setShowTemplateWarning(false); setColAudit(null); setMessyWarning(null); setHeldRows([]); setCleanSummary(null); setDroppedInfo(null); setDroppedPicks({}); setDroppedTabSel(""); setClashDecisions({}); setClashPicks({});
                  allowSampleRowsRef.current = false; setSampleKeptCount(0); setSampleSkipCount(0);
                  // Kill the decision store AND the on-device cached workbook —
                  // otherwise the rehydration effect would restore the cleared
                  // session on the next visit.
                  const st = loadHeldStore(cardId);
                  if (st?.sessionId) void deleteCachedCleanedFile(st.sessionId);
                  clearHeldStore(cardId);
                  onClear?.();
                }}>
                <Trash2 className="w-3 h-3" /> Clear
              </Button>
              {!mappingPending && (
                <Button size="sm"
                  className={`h-7 text-xs gap-1 text-white ${(isSubmitting || preparing || totalFileRows === 0) ? "bg-gray-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"}`}
                  disabled={isSubmitting || preparing || totalFileRows === 0}
                  title={totalFileRows === 0 ? "Nothing to upload — the file has no filled data rows." : undefined}
                  onClick={() => beginSubmit(submitFileData)}>
                  {(isSubmitting || preparing)
                    ? <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    : <ArrowRight className="w-3 h-3" />}
                  {isSubmitting ? "Uploading…" : preparing ? "Processing…" : `Upload ${totalFileRows} row${totalFileRows !== 1 ? "s" : ""}`}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Template tabs (always fixed — Projects / Team Assignments) */}
        <div className="flex items-center shrink-0 px-6" style={{ borderBottom: "1px solid var(--rm-panel-border)", backgroundColor: "var(--rm-panel)" }}>
          {tabs.map((tab, ti) => {
            const ts = fileTabStates[tab.id];
            const rowCount = ts?.rows.length ?? 0;
            const colCount = ts ? Object.values(ts.mappings).filter(v => v !== SKIP).length : 0;
            return (
              <button key={tab.id} onClick={() => setActiveFileTab(tab.id)}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors"
                style={{
                  borderBottomColor: activeFileTab === tab.id ? "#6366f1" : "transparent",
                  color: activeFileTab === tab.id ? "#6366f1" : "var(--rm-text-muted)",
                }}>
                {tab.label}
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{
                    backgroundColor: activeFileTab === tab.id ? "rgba(99,102,241,0.15)" : "var(--rm-panel-soft)",
                    color: activeFileTab === tab.id ? "#6366f1" : "var(--rm-text-muted)",
                  }}>
                  {rowCount} rows · {colCount} cols
                </span>
              </button>
            );
          })}
        </div>

        {/* Scrollable content region — the summary strip, wizard steps and
            the grid all live here so the page can scroll as one unit when a
            step section grows tall. */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">

        {/* Data-cleaning summary strip — CLEANING_HIDDEN */}
        {false /* CLEANING_HIDDEN */ && !readOnly && (cleanSummary || heldRows.length > 0) && (
          !cleanSummary || cleanSummary!.fallback ? (
            <div className="shrink-0 flex items-center gap-2 px-6 py-2 text-xs font-medium" style={{ backgroundColor: "#fffbeb", borderBottom: "1px solid #fcd34d", color: "#92400e" }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
              <span>
                {cleanSummary?.fallback
                  ? "Data cleaning couldn't run on this file — your original rows were loaded unchanged. Decide on each row below before importing."
                  : `${heldRows.length.toLocaleString()} row${heldRows.length !== 1 ? "s" : ""} from this file need a decision — see below.`}
              </span>
              {cleanSummary?.fallback && (
                <button className="ml-auto shrink-0 text-amber-700 hover:text-amber-900" onClick={() => setCleanSummary(null)} title="Dismiss">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="shrink-0 flex items-center gap-2 px-6 py-2 text-xs font-medium"
              style={heldRows.length + nameClashGroups.length > 0
                ? { backgroundColor: "#fffbeb", borderBottom: "1px solid #fcd34d", color: "#92400e" }
                : { backgroundColor: "#f0fdf4", borderBottom: "1px solid #bbf7d0", color: "#166534" }}>
              {heldRows.length + nameClashGroups.length > 0
                ? <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                : <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-600" />}
              <span>
                Data cleaning finished — {cleanSummary!.fixed.toLocaleString()} value{cleanSummary!.fixed !== 1 ? "s" : ""} fixed
                {" · "}{cleanSummary!.dupes.toLocaleString()} duplicate{cleanSummary!.dupes !== 1 ? "s" : ""} removed
                {heldRows.length > 0 ? ` · ${heldRows.length.toLocaleString()} row${heldRows.length !== 1 ? "s" : ""} need a decision below` : ""}
                {nameClashGroups.length > 0 ? ` · ${nameClashGroups.length.toLocaleString()} project name clash${nameClashGroups.length !== 1 ? "es" : ""} to settle below` : ""}
              </span>
              {mappingPending ? (
                <span className="ml-auto shrink-0 text-[11px] font-semibold" style={{ color: "#92400e" }}>
                  Finish the column mapping below first
                </span>
              ) : (
                <button onClick={finishReview}
                  className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-bold shadow-sm hover:brightness-105"
                  style={{ background: "linear-gradient(135deg,#6BA539,#4e8028)" }}>
                  Continue to import <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        )}

        {/* ── Step 1 · Column mapping (dropped-columns rescue) ─────────────
            Columns the cleaning engine couldn't place anywhere. The user picks
            the right RM ONE destination per column and re-cleans — or uses the
            skip link to leave them out and move on to Step 2. Never silent. */}
        {false /* CLEANING_HIDDEN — Step 1 column mapping */ && !readOnly && fileMode && !recleaning && cleanSummary && !cleanSummary!.fallback && (droppedInfo?.cols.length ?? 0) > 0 && (() => {
          const info = droppedInfo!;
          const pickKey = (d: DroppedColLite) => `${d.sourceSheet}\u0000${d.header}`;
          const pickedCount = info.cols.filter(d => droppedPicks[pickKey(d)]).length;
          const trim = (s: string) => (s.length > 28 ? s.slice(0, 28) + "…" : s);
          // Group the dropped columns by the template tab they belong to —
          // Projects / Team Assignments / Schedule each get their own sub-tab.
          const byTab = new Map<string, DroppedColLite[]>();
          for (const d of info.cols) {
            const g = byTab.get(d.tab) ?? [];
            g.push(d);
            byTab.set(d.tab, g);
          }
          const tabNames = [...byTab.keys()];
          const selTab = byTab.has(droppedTabSel) ? droppedTabSel : tabNames[0];
          const selCols = byTab.get(selTab) ?? [];
          const pickedOn = (t: string) => (byTab.get(t) ?? []).filter(d => droppedPicks[pickKey(d)]).length;
          // Template columns ALREADY carrying data on each destination tab —
          // read from the grid itself (mappings + fixed values), because the
          // report's per-sheet "taken" map can miss (split sheets, restored
          // sessions, re-uploaded cleaned files). A column the user can see
          // filled in the grid below must never be offered as a destination.
          // Mapped-but-empty columns stay offered — they are a legal home.
          const normLbl = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
          const filledByTab = new Map<string, Set<string>>();
          for (const tn of tabNames) {
            const tnl = tn.trim().toLowerCase();
            const td = tabs.find(x => x.sheetName.trim().toLowerCase() === tnl || x.label.trim().toLowerCase() === tnl);
            const ts = td ? fileTabStates[td!.id] : undefined;
            const set = new Set<string>();
            if (td && ts) {
              const keyToLabel = new Map(td!.cols.map(c => [c.key, c.label]));
              for (const [h, k] of Object.entries(ts!.mappings)) {
                if (!k || k === SKIP) continue;
                const lbl = keyToLabel.get(k);
                if (!lbl) continue;
                // .some() exits on the first row with data — cheap in practice.
                if (ts!.rows.some(r => String(r[h] ?? "").trim() !== "")) set.add(normLbl(lbl!));
              }
              for (const k of Object.keys(ts!.fixedValues)) {
                const lbl = keyToLabel.get(k);
                if (lbl) set.add(normLbl(lbl!));
              }
            }
            filledByTab.set(tn, set);
          }
          return (
            <div className="shrink-0 border-b bg-white" style={{ borderColor: "#e5e7eb" }}>
              <style>{`.rm-dropped-scroll::-webkit-scrollbar{width:8px;height:8px}.rm-dropped-scroll::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:8px}.rm-dropped-scroll::-webkit-scrollbar-thumb:hover{background:#9ca3af}.rm-dropped-scroll::-webkit-scrollbar-track{background:#f9fafb}`}</style>
              <div className="px-6 py-4">
                {/* Header row: step badge · title · actions */}
                <div className="flex items-start gap-3">
                  <span className="shrink-0 mt-0.5 text-[10px] font-bold tracking-wider rounded-full px-2.5 py-1"
                    style={{ backgroundColor: "#ede9fe", color: "#6d28d9" }}>
                    STEP 1 OF 2
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Column mapping — {info.cols.length === 1
                        ? "1 column from your file needs a home"
                        : `${info.cols.length} columns from your file need a home`}
                    </h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      These headers from your Excel file didn't match any RM ONE column. Pick the RM ONE column each belongs in and press "Map &amp; re-clean". Once this step is done, the next step unlocks.
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      disabled={pickedCount === 0}
                      onClick={() => void recleanWithMappings()}
                      className="px-3.5 py-2 rounded-lg text-white text-xs font-bold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-105"
                      style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)" }}>
                      Map & re-clean{pickedCount > 0 ? ` (${pickedCount})` : ""}
                    </button>
                    <button
                      onClick={() => { setDroppedInfo(null); setDroppedPicks({}); setDroppedTabSel(""); }}
                      title="Leave these columns out of the import and move on"
                      className="text-[10.5px] font-medium text-gray-400 hover:text-gray-600 underline underline-offset-2">
                      Skip — leave these columns out
                    </button>
                  </div>
                </div>

                {/* Sheet sub-tabs — one per template tab that has dropped columns */}
                {tabNames.length > 1 && (
                  <div className="flex items-center gap-1.5 mt-3">
                    {tabNames.map(t => {
                      const total = byTab.get(t)!.length;
                      const done = pickedOn(t);
                      const active = t === selTab;
                      return (
                        <button key={t} onClick={() => setDroppedTabSel(t)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors"
                          style={active
                            ? { backgroundColor: "#f5f3ff", borderColor: "#a78bfa", color: "#6d28d9" }
                            : { backgroundColor: "#fff", borderColor: "#e5e7eb", color: "#6b7280" }}>
                          {t}
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                            style={active ? { backgroundColor: "#ddd6fe", color: "#5b21b6" } : { backgroundColor: "#f3f4f6", color: "#9ca3af" }}>
                            {done > 0 ? `${done}/${total}` : total}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Mapping table for the selected sheet */}
                <div className="mt-3 rounded-xl border overflow-hidden" style={{ borderColor: "#e5e7eb" }}>
                  <div className="rm-dropped-scroll" style={{ maxHeight: 260, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                      <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                        <tr style={{ background: "#f9fafb" }}>
                          <th style={{ padding: "8px 14px", textAlign: "left", fontWeight: 700, color: "#374151", whiteSpace: "nowrap", borderBottom: "2px solid #e5e7eb" }}>
                            Column in your Excel file
                          </th>
                          <th style={{ padding: "8px 14px", textAlign: "left", fontWeight: 700, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>
                            Sample values from your file
                          </th>
                          <th style={{ padding: "8px 14px", textAlign: "left", fontWeight: 700, color: "#4e8028", whiteSpace: "nowrap", borderBottom: "2px solid #e5e7eb" }}>
                            RM ONE column
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selCols.map((d, i) => {
                          const key = pickKey(d);
                          const cur = droppedPicks[key] ?? "";
                          const takenHere = new Set(info.taken[takenKey(d.sourceSheet, d.module)] ?? []);
                          for (const o of info.cols) {
                            // Another pick only blocks this dropdown when it lands on
                            // the SAME output tab (two sources can't feed one column
                            // there). Same-sheet picks headed to a different tab are
                            // fine — labels repeat across modules.
                            if (o === d || o.tab !== d.tab) continue;
                            const p = droppedPicks[pickKey(o)];
                            if (p) takenHere.add(p);
                          }
                          const filledHere = filledByTab.get(d.tab) ?? new Set<string>();
                          const opts = (templateCols?.[d.module] ?? []).filter(t =>
                            t === cur || (!takenHere.has(t) && !filledHere.has(normLbl(t))));
                          return (
                            <tr key={key} style={{ borderBottom: i < selCols.length - 1 ? "1px solid #f3f4f6" : "none", background: cur ? "#f0fdf4" : "#fff" }}>
                              <td style={{ padding: "7px 14px", whiteSpace: "nowrap" }}>
                                <span className="inline-flex items-center gap-1.5">
                                  <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" style={{ color: "#059669" }} />
                                  <span style={{ fontWeight: 600, color: "#111827" }}>{d.header}</span>
                                </span>
                                {d.rows > 0 && (
                                  <span style={{ marginLeft: 8, fontSize: 10, color: "#9ca3af" }}>
                                    {d.rows.toLocaleString()} row{d.rows !== 1 ? "s" : ""} with data
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: "7px 14px", color: "#6b7280", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {d.samples.length > 0 ? d.samples.slice(0, 3).map(trim).join(" · ") : "—"}
                              </td>
                              <td style={{ padding: "7px 14px", whiteSpace: "nowrap" }}>
                                <select
                                  value={cur}
                                  onChange={e => setDroppedPicks(p => ({ ...p, [key]: e.target.value }))}
                                  style={{
                                    borderRadius: 8, padding: "4px 8px", minWidth: 190, fontSize: 11.5,
                                    background: "#fff", color: cur ? "#166534" : "#6b7280",
                                    border: cur ? "1.5px solid #6BA539" : "1px solid #d1d5db", outline: "none",
                                    fontWeight: cur ? 600 : 400,
                                  }}>
                                  <option value="">Leave out of import</option>
                                  {opts.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Inline held-rows section — shows directly below each tab's grid.
            Hidden while the Step-1 column-mapping panel is open — the user
            advances to this Step 2 with the panel's Next button. ── */}
        {false /* CLEANING_HIDDEN — Step 2 held rows & clash decisions */ && !readOnly && fileMode && !(!recleaning && cleanSummary && !cleanSummary!.fallback && (droppedInfo?.cols.length ?? 0) > 0) && ((cleanSummary && !cleanSummary!.fallback) || heldRows.length > 0 || nameClashGroups.length > 0) && (() => {
          const cs = cleanSummary && !cleanSummary!.fallback ? cleanSummary : null;
          // Name-clash cards live on the main module's tab — make sure that
          // tab exists (and comes first) even when it has no held rows.
          const mainLabel = tabs.find(t => t.id === "main")?.label ?? "Projects";
          const clashGroups = nameClashGroups;
          const groups = new Map<string, HeldRow[]>();
          if (clashGroups.length > 0) groups.set(mainLabel, []);
          for (const h of heldRows) {
            const g = groups.get(h.tabLabel) ?? [];
            g.push(h);
            groups.set(h.tabLabel, g);
          }
          // A tab whose held rows were ALL auto-added by a clash verdict must
          // stay visible — its read-only "added automatically" table is the
          // only place the user can see what was assigned for them.
          for (const a of autoAdded) if (!groups.has(a.tabLabel)) groups.set(a.tabLabel, []);
          const groupNames = [...groups.keys()];
          const curTab = groups.has(activeHeldTab) ? activeHeldTab : (groupNames[0] ?? "");
          // ── Pick once, apply everywhere ────────────────────────────────
          // Ambiguous cards that reference the SAME project name are really
          // ONE decision, not N. Family resolution is shared with the
          // name-clash cards (bulkTargetsByName / bulkAddFamilyByName above).
          const refNameOf = (x: HeldRow) =>
            normProjName(String(x.cells["Project"] ?? x.cells["Project Title"] ?? ""));
          const bulkTargets = (h: HeldRow, chosenId: string) => bulkTargetsByName(refNameOf(h), chosenId);
          const bulkAddFamily = (h: HeldRow, chosenId: string) => bulkAddFamilyByName(refNameOf(h), chosenId);
          // Deterministic row order on every tab: issue type first, then the
          // referenced project name (SAME alphabetical collation the clash
          // list uses, so Projects / Team Assignments / Schedule all march
          // through the clashes in the same order), then original file row.
          const KIND_RANK: Record<FriendlyRemark["kind"], number> = {
            ambiguous: 0, notfound: 1, noproject: 2, missingid: 3, other: 4, duplicate: 5,
          };
          // Rows whose project name is still being decided in the clash table
          // are HIDDEN from the lists below — the ONE decision on the Projects
          // tab covers them, so repeating them row-by-row was pure noise. They
          // come back (or are auto-added) the moment their clash is settled.
          const openClashKeys = new Set(clashGroups.map(g => g.key));
          const waitingOnClash = (h: HeldRow) => openClashKeys.size > 0 && openClashKeys.has(refNameOf(h));
          const actionableOf = (label: string) => {
            const rows = groups.get(label) ?? [];
            const base = dupGroupedRowIds.size > 0 ? rows.filter(h => !dupGroupedRowIds.has(h.id)) : rows;
            return openClashKeys.size > 0 ? base.filter(h => !waitingOnClash(h)) : base;
          };
          // Grouped "possible duplicate" cards per tab — the rows they swallow
          // are excluded from the lists above, so each pair is ONE decision.
          const dupGroupsOf = (label: string) => dupGroups.filter(g => g.tabLabel === label);
          const tabDupGroups = dupGroupsOf(curTab);
          // Held rows that render INSIDE the clash table (held clash entries
          // with an ID) are that card's own rows — counting them again as
          // "waiting" would double-count them in the header total.
          const clashEntryHeldIds = new Set<number>();
          for (const cg of clashGroups) for (const e of cg.entries) if (e.held) clashEntryHeldIds.add(e.held!.id);
          const waitingRows = (groups.get(curTab) ?? []).filter(h => waitingOnClash(h) && !clashEntryHeldIds.has(h.id));
          const rawTabRows = actionableOf(curTab);
          const kindOf = new Map<number, FriendlyRemark["kind"]>();
          for (const h of rawTabRows) kindOf.set(h.id, friendlyRemark(h.remarks).kind);
          const tabRows = [...rawTabRows].sort((a, b) => {
            const ka = KIND_RANK[kindOf.get(a.id) ?? "other"];
            const kb = KIND_RANK[kindOf.get(b.id) ?? "other"];
            if (ka !== kb) return ka - kb;
            const na = refNameOf(a), nb = refNameOf(b);
            if (na !== nb) return na.localeCompare(nb);
            const ra = parseInt(a.srcRow ?? "", 10), rb = parseInt(b.srcRow ?? "", 10);
            if (!isNaN(ra) && !isNaN(rb) && ra !== rb) return ra - rb;
            return a.id - b.id;
          });
          const q = heldSearch.trim().toLowerCase();
          const filtered = q
            ? tabRows.filter(h =>
                (h.srcRow ?? "").toLowerCase().includes(q) ||
                h.remarks.toLowerCase().includes(q) ||
                Object.values(h.cells).some(v => (v ?? "").toLowerCase().includes(q)))
            : tabRows;
          const PAGE_SIZE = 100;
          const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
          const page = Math.min(heldPage, pageCount - 1);
          const curRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
          // How many held rows each clash card would auto-resolve (footnote).
          const clashFamCount = new Map<string, number>();
          if (clashGroups.length > 0) {
            const clashKeys = new Set(clashGroups.map(g => g.key));
            for (const x of heldRows) {
              if (friendlyRemark(x.remarks).kind !== "ambiguous") continue;
              const k = refNameOf(x);
              if (clashKeys.has(k)) clashFamCount.set(k, (clashFamCount.get(k) ?? 0) + 1);
            }
          }
          // Issue chip shared by the unified Projects table and per-tab grids.
          const issueBadge = (kind: FriendlyRemark["kind"]) =>
            kind === "duplicate" ? { txt: "Possible duplicate", cls: "bg-gray-100 text-gray-600" }
            : kind === "ambiguous" ? { txt: "Pick the project", cls: "bg-violet-100 text-violet-700" }
            : kind === "notfound" ? { txt: "Project not found", cls: "bg-amber-100 text-amber-700" }
            : kind === "noproject" ? { txt: "No project named", cls: "bg-amber-100 text-amber-700" }
            : kind === "missingid" ? { txt: "Missing ID", cls: "bg-amber-100 text-amber-700" }
            : { txt: "Review", cls: "bg-amber-100 text-amber-700" };
          // Only the PROJECTS card merges its main-tab held rows into the
          // clash table (its columns are project-shaped). Team / Companies /
          // Opportunities / Leads keep the generic per-tab grid below, whose
          // columns come from their own templates.
          const mergeMainHeld = curTab === mainLabel && cardId === "projects";
          const mergedHeldCount = mergeMainHeld ? filtered.length : 0;
          // Only render this section when the currently active tab has something to decide.
          const curTabTotal = actionableOf(curTab).length + dupGroupsOf(curTab).length
            + (curTab === mainLabel ? clashGroups.length : 0)
            + waitingRows.length
            + autoAdded.filter(r => r.tabLabel === curTab).length;
          // Step-gated flow: while Step 1 (column mapping) is unresolved, the
          // row-decisions section stays hidden — one step, one set of buttons.
          if (!curTabTotal || mappingPending) return null;
          return (
            <div className="border-t-2 border-amber-100 bg-white">
              {/* Inline section header */}
              <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100" style={{ backgroundColor: "#fafaf9" }}>
                {cs && (
                  <span className="shrink-0 text-[10px] font-bold tracking-wider rounded-full px-2.5 py-1"
                    style={{ backgroundColor: "#ede9fe", color: "#6d28d9" }}>
                    STEP 2 OF 2
                  </span>
                )}
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {cs ? "Row decisions — " : ""}{curTabTotal} row{curTabTotal !== 1 ? "s" : ""} on this tab need{curTabTotal === 1 ? "s" : ""} a decision
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    Add a row to include it in the import, or Skip to leave it out. Your choices are saved automatically.
                  </p>
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input value={heldSearch} onChange={e => setHeldSearch(e.target.value)}
                    placeholder="Search these rows…"
                    className="h-8 w-48 rounded-lg border border-gray-200 bg-white pl-8 pr-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                </div>
              </div>
              <div className="px-6 py-5">
                <div>
                  {/* Excel round-trip callout — the fastest path for big files */}
                  {cs?.sid && (
                    <div className="rounded-2xl border border-indigo-200 shadow-sm px-5 py-4 mb-5 flex items-start gap-4"
                      style={{ background: "linear-gradient(135deg,#eef2ff,#faf5ff)" }}>
                      <div className="w-10 h-10 rounded-xl bg-white border border-indigo-200 flex items-center justify-center shrink-0">
                        <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900">Fixing a lot of rows? Do it in Excel instead.</p>
                        <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                          Download the cleaned Excel — every held-back row sits on its own "… — Review" tab with the reason in the Remarks column.
                          Fix the rows there, move them back onto the main tab, and upload the file again.
                        </p>
                        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                          <button onClick={() => void downloadCleaned()}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold">
                            <Download className="w-3.5 h-3.5" /> Download cleaned Excel
                          </button>
                          <button onClick={() => { closeReview(); fileRef.current?.click(); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50 text-xs font-semibold">
                            <Upload className="w-3.5 h-3.5" /> Upload the fixed file
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Summary chips */}
                  {cs && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                        <CheckCircle2 className="w-3 h-3" /> {cs!.fixed.toLocaleString()} value{cs!.fixed !== 1 ? "s" : ""} tidied up (dates, numbers, emails)
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                        <CheckCircle2 className="w-3 h-3" /> {cs!.dupes.toLocaleString()} duplicate row{cs!.dupes !== 1 ? "s" : ""} removed
                      </span>
                      {heldRows.length > 0 && (
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                          <AlertTriangle className="w-3 h-3" /> {heldRows.length.toLocaleString()} row{heldRows.length !== 1 ? "s" : ""} waiting on you
                        </span>
                      )}
                      {clashGroups.length > 0 && (
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-3 py-1">
                          <Copy className="w-3 h-3" /> {clashGroups.length.toLocaleString()} project name clash{clashGroups.length !== 1 ? "es" : ""} to settle
                        </span>
                      )}
                    </div>
                  )}

                  {/* Held-row cards */}
                  <div className="space-y-3">
                  {/* Cross-tab pointer: rows on this tab whose project is still
                      being decided in the Projects clash table are HIDDEN from
                      the list below — this banner is their only trace here. */}
                  {curTab !== mainLabel && waitingRows.length > 0 && (
                    <div className="rounded-xl border border-violet-200 px-4 py-3 flex items-start gap-3 shadow-sm"
                      style={{ background: "linear-gradient(135deg,#f5f3ff,#eef2ff)" }}>
                      <div className="w-8 h-8 rounded-lg bg-white border border-violet-200 flex items-center justify-center shrink-0">
                        <Copy className="w-4 h-4 text-violet-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900">
                          {waitingRows.length.toLocaleString()} row{waitingRows.length !== 1 ? "s" : ""} on this tab {waitingRows.length !== 1 ? "are" : "is"} waiting on the Projects tab — nothing to do here
                        </p>
                        <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
                          Their project names are part of the name clashes still open under <span className="font-semibold">Projects</span>,
                          so they are not listed below. Settle each clash there once and these rows are filled in and added to the import automatically.
                        </p>
                      </div>
                      <button onClick={() => setActiveHeldTab(mainLabel)}
                        className="shrink-0 self-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold whitespace-nowrap">
                        Resolve under Projects
                      </button>
                    </div>
                  )}
                  {/* Rows a "Keep selected ID" verdict added automatically —
                      shown read-only so nothing disappears silently. No
                      buttons on purpose: they are already in the import. */}
                  {curTab !== mainLabel && (() => {
                    const autoRows = autoAdded.filter(r => r.tabLabel === curTab);
                    if (autoRows.length === 0) return null;
                    const tabDef = tabs.find(t => t.id === autoRows[0].tabId);
                    const idLabel = requiredIdFor(cardId, autoRows[0].tabId)?.label;
                    const allLabels = tabDef ? tabDef!.cols.map(c => c.label) : Object.keys(autoRows[0].cells);
                    const colLabels = allLabels.filter(l => autoRows.some(r => String(r.cells[l] ?? "").trim() !== ""));
                    return (
                      <div className="rounded-xl border border-emerald-200 bg-white overflow-hidden shadow-sm">
                        <div className="px-4 py-3 flex items-start gap-3 border-b border-emerald-100"
                          style={{ background: "linear-gradient(135deg,#ecfdf5,#f0fdf4)" }}>
                          <div className="w-8 h-8 rounded-lg bg-white border border-emerald-200 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900">
                              {autoRows.length.toLocaleString()} row{autoRows.length !== 1 ? "s" : ""} added to your import automatically
                            </p>
                            <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
                              When you pressed <span className="font-semibold">Keep selected ID</span> on the Projects tab, these rows were
                              assigned to that project and added for you. They are shown here for reference only — they are already part of
                              the import, and nothing needs to be done (or can be changed) here.
                            </p>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-[11px] border-collapse">
                            <thead>
                              <tr className="bg-gray-100 text-[10px] uppercase tracking-wide text-gray-600">
                                <th className="border border-gray-300 px-2 py-2 text-center font-semibold whitespace-nowrap w-12">Sl. No</th>
                                {colLabels.map(l => (
                                  <th key={l} className="border border-gray-300 px-3 py-2 text-left font-semibold whitespace-nowrap">{l}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {autoRows.map((r, i) => (
                                <tr key={r.dKey} className={i % 2 === 1 ? "bg-gray-50/60" : "bg-white"}>
                                  <td className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700">{i + 1}</td>
                                  {colLabels.map(l => (
                                    <td key={l} className={`border border-gray-300 px-3 py-2 whitespace-nowrap ${l === idLabel ? "font-semibold text-emerald-700" : "text-gray-700"}`}>
                                      {String(r.cells[l] ?? "")}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                  {/* ONE table for the whole Projects tab: name clashes first
                      (same title, different IDs — settle each once), then every
                      other held project row (near-duplicate names, copies,
                      missing IDs) right below in the same grid. */}
                  {curTab === mainLabel && (clashGroups.length > 0 || (mergeMainHeld && curRows.length > 0)) && (
                    <div className="rounded-xl border border-violet-200 bg-white overflow-hidden shadow-sm">
                      <div className="px-4 py-3 flex items-start gap-3 border-b border-violet-100"
                        style={{ background: "linear-gradient(135deg,#f5f3ff,#eef2ff)" }}>
                        <div className="w-8 h-8 rounded-lg bg-white border border-violet-200 flex items-center justify-center shrink-0">
                          <Copy className="w-4 h-4 text-violet-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-900">
                            {clashGroups.length > 0
                              ? <>{clashGroups.length.toLocaleString()} project name{clashGroups.length !== 1 ? "s" : ""} appear{clashGroups.length === 1 ? "s" : ""} on rows with different IDs{mergedHeldCount > 0 ? ` · ${mergedHeldCount.toLocaleString()} more row${mergedHeldCount !== 1 ? "s" : ""} below need${mergedHeldCount === 1 ? "s" : ""} a decision` : ""}</>
                              : <>{mergedHeldCount.toLocaleString()} project row{mergedHeldCount !== 1 ? "s" : ""} need{mergedHeldCount === 1 ? "s" : ""} a decision</>}
                          </p>
                          <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
                            {clashGroups.length > 0 && (
                              <>
                                Tick the ID you want to keep, then press <span className="font-semibold">Keep selected ID</span> — or press
                                <span className="font-semibold"> Different jobs</span> to keep all of them; their held team and schedule rows then show up on the other tabs so you can pick the right project for each row.
                                Your choice only decides what goes into this import — nothing is deleted from your database.
                                {waitingRows.length > 0 && (
                                  <> Your decisions here also settle {waitingRows.length.toLocaleString()} held row{waitingRows.length !== 1 ? "s" : ""} naming these projects.</>
                                )}
                              </>
                            )}
                            {mergedHeldCount > 0 && (
                              <>
                                {clashGroups.length > 0 ? " " : ""}Every other held project row sits in this same table — the note under its name says why it was held. Press <span className="font-semibold">Add</span> to include one, or <span className="font-semibold">Skip</span> to leave it out.
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-gray-100 text-[10px] uppercase tracking-wide text-gray-600">
                              <th className="border border-gray-300 px-2 py-2 text-center font-semibold whitespace-nowrap w-12">Sl. No</th>
                              <th className="border border-gray-300 px-3 py-2 text-left font-semibold min-w-[160px]">Project Name</th>
                              <th className="border border-gray-300 px-3 py-2 text-left font-semibold whitespace-nowrap">Project ID</th>
                              <th className="border border-gray-300 px-3 py-2 text-center font-semibold whitespace-nowrap">Row</th>
                              <th className="border border-gray-300 px-3 py-2 text-left font-semibold min-w-[200px]">Details</th>
                              <th className="border border-gray-300 px-3 py-2 text-center font-semibold whitespace-nowrap">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {clashGroups.map((g, gi) => {
                              const famN = clashFamCount.get(g.key) ?? 0;
                              // Held rows with this name but NO ID: extra pick
                              // options — pick one and type its new ID right here.
                              const heldNoId = clashHeldNoId(g.key);
                              // Guard against stale picks: a ticked ID must still
                              // exist in this group (a re-uploaded file can change
                              // the candidate IDs under the same name).
                              const rawPick = clashPicks[g.key] ?? g.entries[0]?.id ?? "";
                              const pick = g.entries.some(e => e.id === rawPick) ||
                                heldNoId.some(h => `held:${h.id}` === rawPick) ? rawPick : "";
                              const heldPick = pick.startsWith("held:")
                                ? heldNoId.find(h => `held:${h.id}` === pick) : undefined;
                              const heldTypedId = heldPick ? (clashHeldIdInput[heldPick.id] ?? "").trim() : "";
                              return (
                                <tr key={`clash-${g.key}`} className={gi % 2 === 1 ? "bg-gray-50/60" : "bg-white"}>
                                  <td className="border border-gray-300 px-2 py-2 text-center align-top font-semibold text-gray-700">
                                    {gi + 1}
                                  </td>
                                  <td className="border border-gray-300 px-3 py-2 align-top">
                                    <p className="text-xs font-bold text-gray-900 leading-snug">{g.title}</p>
                                    <p className="text-[10px] mt-1 leading-snug text-gray-500">
                                      {g.entries.length} IDs share this name{heldNoId.length > 0 ? ` · ${heldNoId.length.toLocaleString()} held row${heldNoId.length !== 1 ? "s" : ""} with this name still need${heldNoId.length === 1 ? "s" : ""} an ID` : ""}{famN > 0 ? ` · your pick also fills ${famN.toLocaleString()} held row${famN !== 1 ? "s" : ""} on the other tabs — "Different jobs" sends them there so you pick per row` : ""}
                                    </p>
                                  </td>
                                  <td className="border border-gray-300 px-3 py-1.5 align-top whitespace-nowrap">
                                    {g.entries.map(e => (
                                      <label key={`pick-${g.key}-${e.id}`}
                                        className={`flex items-center gap-2 py-1 px-1.5 rounded cursor-pointer select-none ${
                                          pick === e.id ? "bg-violet-100/80" : "hover:bg-violet-50"}`}>
                                        <input type="radio" name={`clash-pick-${g.key}`} checked={pick === e.id}
                                          onChange={() => setClashPicks(prev => ({ ...prev, [g.key]: e.id }))}
                                          className="w-3.5 h-3.5 accent-violet-600 cursor-pointer shrink-0" />
                                        <span className="font-bold text-gray-900">{e.id}</span>
                                      </label>
                                    ))}
                                    {/* Held rows with this name but no ID: pickable
                                        right here — tick one and type its new ID. */}
                                    {heldNoId.map(h => {
                                      const sel = pick === `held:${h.id}`;
                                      return (
                                        <div key={`pickheld-${g.key}-${h.id}`}>
                                          <label className={`flex items-center gap-2 py-1 px-1.5 rounded cursor-pointer select-none ${
                                            sel ? "bg-amber-100/80" : "hover:bg-amber-50"}`}>
                                            <input type="radio" name={`clash-pick-${g.key}`} checked={sel}
                                              onChange={() => setClashPicks(prev => ({ ...prev, [g.key]: `held:${h.id}` }))}
                                              className="w-3.5 h-3.5 accent-amber-600 cursor-pointer shrink-0" />
                                            <span className="font-bold text-amber-700">No ID yet</span>
                                          </label>
                                          {sel && (
                                            <input value={clashHeldIdInput[h.id] ?? ""}
                                              onChange={e => setClashHeldIdInput(prev => ({ ...prev, [h.id]: e.target.value }))}
                                              placeholder="Type its new Project ID"
                                              className="ml-6 mt-0.5 mb-1 h-7 w-40 rounded-md border border-amber-300 bg-white px-2 text-[10px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
                                          )}
                                        </div>
                                      );
                                    })}
                                  </td>
                                  <td className="border border-gray-300 px-3 py-1.5 align-top text-center whitespace-nowrap">
                                    {g.entries.map(e => (
                                      <div key={`row-${g.key}-${e.id}`} className="py-1 text-gray-600 tabular-nums">{e.held ? (e.held.srcRow ?? "—") : e.rowNum}</div>
                                    ))}
                                    {heldNoId.map(h => (
                                      <div key={`rowheld-${g.key}-${h.id}`} className="py-1 text-gray-600 tabular-nums">{h.srcRow ?? "—"}</div>
                                    ))}
                                  </td>
                                  <td className="border border-gray-300 px-3 py-1.5 align-top min-w-[220px]">
                                    {g.entries.map(e => (
                                      <div key={`det-${g.key}-${e.id}`} className="py-1">
                                        {e.preview.length
                                          ? e.preview.map(([k, v]) => (
                                              <div key={k} className="flex gap-1 text-[10px] leading-snug">
                                                <span className="text-gray-400 shrink-0 whitespace-nowrap">{k}:</span>
                                                <span className="text-gray-700 break-words min-w-0">{v}</span>
                                              </div>
                                            ))
                                          : <span className="text-gray-400 text-[10px]">—</span>}
                                        {e.held && (
                                          <div className="text-[10px] text-amber-700 leading-snug">Held for review — joins the import only if kept</div>
                                        )}
                                      </div>
                                    ))}
                                    {heldNoId.map(h => (
                                      <div key={`detheld-${g.key}-${h.id}`} className="py-1">
                                        <span className="text-[10px] text-amber-700">Same name, no ID — held out of the import</span>
                                      </div>
                                    ))}
                                  </td>
                                  <td className="border border-gray-300 px-3 py-2 align-top text-center whitespace-nowrap">
                                    <div className="flex flex-col items-stretch gap-1.5">
                                        <button onClick={() => {
                                            if (!pick) return;
                                            if (heldPick) {
                                              if (!heldTypedId) return;
                                              // Typed an ID that's already one of the
                                              // clashing IDs (any casing) → same as
                                              // ticking that ID.
                                              const same = g.entries.find(e => e.id.toLowerCase() === heldTypedId.toLowerCase());
                                              if (same && !same.held) resolveNameClash(g, same.id);
                                              else if (same?.held) keepHeldAsClashWinner(g, same.held, same.id);
                                              else keepHeldAsClashWinner(g, heldPick, heldTypedId);
                                            } else {
                                              // A held entry that already carries an ID
                                              // wins via the held-winner path (its row
                                              // joins the grid); grid entries via the
                                              // plain keep path.
                                              const ent = g.entries.find(e => e.id === pick);
                                              if (ent?.held) keepHeldAsClashWinner(g, ent.held, ent.id);
                                              else resolveNameClash(g, pick);
                                            }
                                          }} disabled={!pick || (!!heldPick && !heldTypedId)}
                                          title={heldPick
                                            ? (heldTypedId ? `Keep this row with new ID ${heldTypedId}` : "Type a Project ID for the picked row first")
                                            : pick ? `Keep only ${pick} in this import` : "Tick a Project ID first"}
                                          className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold whitespace-nowrap ${
                                            pick && (!heldPick || heldTypedId) ? "bg-violet-600 hover:bg-violet-700 text-white"
                                                 : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}>
                                          <CheckCircle2 className="w-3 h-3" /> Keep selected ID
                                        </button>
                                        <button onClick={() => finishKeepBoth(g)}
                                          title={famN > 0
                                            ? `Keep every ID as its own project — the ${famN.toLocaleString()} held row${famN !== 1 ? "s" : ""} on the other tabs will then show these IDs as buttons so you can pick the right project for each row`
                                            : "Keep every ID as its own project"}
                                          className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 text-[10px] font-semibold whitespace-nowrap">
                                          Different jobs — keep {g.entries.length === 2 ? "both" : "all"}
                                        </button>
                                        {!pick && (
                                          <span className="text-[9px] text-gray-400 leading-snug">Tick an ID to enable "Keep selected"</span>
                                        )}
                                        {!!heldPick && !heldTypedId && (
                                          <span className="text-[9px] text-amber-600 leading-snug">Type the new Project ID to enable "Keep selected"</span>
                                        )}
                                      </div>
                                  </td>
                                </tr>
                              );
                            })}
                            {/* Every OTHER held project row lives in this same
                                table: near-duplicate name variants, rows flagged
                                as copies, rows missing an ID — one row each,
                                right below the name clashes. */}
                            {mergeMainHeld && curRows.map((h, hi) => {
                              const req = requiredIdFor(cardId, h.tabId);
                              const fr = friendlyRemark(h.remarks);
                              const idVal = req ? (h.cells[req.label] ?? "") : "";
                              const canAdd = !req || !!idVal.trim();
                              const candSeen = new Set<string>();
                              const allCands = [...(fr.candidates ?? []), ...(h.extraCands ?? [])]
                                .filter(c => candSeen.has(c.id) ? false : (candSeen.add(c.id), true));
                              const typeOpen = !!req && (allCands.length === 0 || typeOpenIds.has(h.id) ||
                                (!!idVal.trim() && !allCands.some(c => c.id === idVal.trim())));
                              const badge = issueBadge(fr.kind);
                              const isDup = fr.kind === "duplicate";
                              const rowName = (h.cells["Project Title"] ?? h.cells["Project"] ?? "").trim() || "—";
                              const details = Object.entries(h.cells)
                                .filter(([ck, cv]) => (cv ?? "").trim() && ck !== "Project Title" && ck !== "Project" && (!req || ck !== req.label))
                                .slice(0, 3);
                              const bulkN = canAdd && fr.kind === "ambiguous" ? bulkTargets(h, idVal.trim()).length : 0;
                              const skipRow = () => {
                                setHeldRows(prev => prev.filter(x => x.id !== h.id));
                                recordHeldDecision(h.dKey, { status: "dismissed" });
                              };
                              return (
                                <tr key={`held-${h.id}`} className={(clashGroups.length + page * PAGE_SIZE + hi) % 2 === 1 ? "bg-gray-50/60" : "bg-white"}>
                                  <td className="border border-gray-300 px-2 py-2 text-center align-top font-semibold text-gray-700">
                                    {clashGroups.length + page * PAGE_SIZE + hi + 1}
                                  </td>
                                  <td className="border border-gray-300 px-3 py-2 align-top">
                                    <p className="text-xs font-bold text-gray-900 leading-snug">{rowName}</p>
                                    <span title={`${fr.title} — ${fr.body}`}
                                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold cursor-help ${badge.cls}`}>
                                      {badge.txt}
                                    </span>
                                  </td>
                                  <td className="border border-gray-300 px-3 py-1.5 align-top">
                                    {isDup ? (
                                      <span className="text-gray-500 text-[10px] whitespace-nowrap"
                                        title={allCands.length > 1 ? allCands.map(c => `${c.id} — ${c.title}${c.srcRow ? ` (row ${c.srcRow})` : ""}`).join("\n") : undefined}>
                                        Copy of <span className="font-bold text-gray-800">{allCands[0]?.id ?? h.matchedId ?? "—"}</span>
                                        {allCands[0]?.srcRow ? ` (row ${allCands[0].srcRow})` : ""}
                                        {allCands.length > 1 ? ` +${allCands.length - 1} more` : ""}
                                      </span>
                                    ) : (
                                      <div className="flex items-center gap-1.5 flex-wrap min-w-[150px] py-0.5">
                                        {allCands.map(c => {
                                          const selected = idVal.trim() === c.id;
                                          return (
                                            <button key={c.id}
                                              title={`${c.title}${c.srcRow ? ` — your file row ${c.srcRow}` : ""}`}
                                              onClick={() => req && setHeldCell(h, req.label, c.id)}
                                              className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold transition-colors ${
                                                selected
                                                  ? "bg-indigo-600 border-indigo-600 text-white"
                                                  : "bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50"}`}>
                                              {selected && <CheckCircle2 className="w-3 h-3" />}
                                              {c.id}
                                            </button>
                                          );
                                        })}
                                        {typeOpen && req && (
                                          <input
                                            value={idVal}
                                            onChange={e => setHeldCell(h, req.label, e.target.value)}
                                            placeholder={req.label}
                                            className="h-7 w-36 rounded-md border border-amber-300 bg-white px-2 text-[10px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                                          />
                                        )}
                                        {!typeOpen && req && allCands.length > 0 && (
                                          <button onClick={() => setTypeOpenIds(prev => { const n = new Set(prev); n.add(h.id); return n; })}
                                            className="text-[10px] text-gray-400 underline decoration-dotted hover:text-gray-600 whitespace-nowrap">
                                            Type ID
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                  <td className="border border-gray-300 px-3 py-1.5 align-top text-center whitespace-nowrap">
                                    <div className="py-1 text-gray-600 tabular-nums">{h.srcRow ?? "—"}</div>
                                  </td>
                                  <td className="border border-gray-300 px-3 py-1.5 align-top min-w-[220px]">
                                    {details.length
                                      ? details.map(([ck, cv]) => (
                                          <div key={ck} className="flex gap-1 text-[10px] leading-snug py-0.5">
                                            <span className="text-gray-400 shrink-0 whitespace-nowrap">{ck}:</span>
                                            <span className="text-gray-700 break-words min-w-0">{cv}</span>
                                          </div>
                                        ))
                                      : <span className="text-gray-400 text-[10px]">—</span>}
                                  </td>
                                  <td className="border border-gray-300 px-3 py-2 align-top text-center whitespace-nowrap">
                                    {isDup ? (
                                      <button onClick={skipRow}
                                        title={`${fr.title} — ${fr.body}`}
                                        className="inline-flex items-center px-2.5 py-1 rounded-md border border-gray-200 bg-white text-[10px] font-semibold text-gray-500 hover:text-gray-700 whitespace-nowrap">
                                        Got it — hide
                                      </button>
                                    ) : (
                                      <div className="flex flex-col items-stretch gap-1.5">
                                        {bulkN > 1 && (
                                          <button
                                            title={`Use ${idVal.trim()} for all ${bulkN.toLocaleString()} held rows that name this project`}
                                            onClick={() => bulkAddFamily(h, idVal.trim())}
                                            className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-semibold whitespace-nowrap">
                                            <CheckCircle2 className="w-3 h-3" /> Use for all {bulkN.toLocaleString()} rows
                                          </button>
                                        )}
                                        <button disabled={!canAdd}
                                          title={canAdd ? "Add this row to the import" : (allCands.length > 0 ? "Pick a project first" : `Type the ${req?.label ?? "ID"} first`)}
                                          onClick={() => canAdd && addHeldRow(h)}
                                          className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-white whitespace-nowrap ${
                                            canAdd ? "bg-amber-600 hover:bg-amber-700" : "bg-gray-300 cursor-not-allowed"}`}>
                                          <Plus className="w-3 h-3" /> Add
                                        </button>
                                        <button onClick={skipRow}
                                          title="Leave this row out of the import"
                                          className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-[10px] font-semibold text-gray-500 hover:text-gray-700 whitespace-nowrap">
                                          Skip
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {/* Grouped "possible duplicate" cards: one pair (or trio) of
                      near-identical names = ONE decision. The rows are all in
                      the grid already — these cards decide which of them stay. */}
                  {tabDupGroups.map(g => {
                    const n = g.members.length;
                    const allWord = n === 2 ? "both" : `all ${n}`;
                    const idColG = requiredIdFor(cardId, g.tabId);
                    const titleLabelG = g.tabId === "main" ? TITLE_COL_BY_CARD[cardId]?.label : undefined;
                    const hideLabels = new Set([idColG?.label, titleLabelG, "Project Title", "Project"].filter(Boolean) as string[]);
                    return (
                      <div key={g.key} className="rounded-xl border border-gray-300 bg-white overflow-hidden shadow-sm">
                        <div className="px-4 py-3 flex items-start gap-3 border-b border-gray-200 bg-gray-50">
                          <div className="w-8 h-8 rounded-lg bg-white border border-gray-300 flex items-center justify-center shrink-0">
                            <Copy className="w-4 h-4 text-gray-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900">
                              Possible duplicate — {n === 2 ? "are these two rows the same project?" : `are these ${n} rows the same project?`}
                            </p>
                            <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
                              Their names differ only by punctuation or spacing, but each has its own ID. Right now {allWord} are in your grid —
                              do nothing and they {n === 2 ? "both" : "all"} import as separate projects.
                              <span className="font-semibold"> Keep only this one</span> drops the other{n > 2 ? "s" : ""} from this import;
                              nothing is ever deleted from your database.
                            </p>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-[11px]">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-500">
                                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">File row</th>
                                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">{idColG?.label ?? "ID"}</th>
                                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Name</th>
                                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Details</th>
                                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.members.map((m, mi) => {
                                const details: [string, string][] = [];
                                if (m.held) {
                                  for (const [ck, cv] of Object.entries(m.held.cells)) {
                                    if (hideLabels.has(ck)) continue;
                                    const v = (cv ?? "").trim();
                                    if (!v) continue;
                                    details.push([ck, v]);
                                    if (details.length >= 3) break;
                                  }
                                }
                                return (
                                  <tr key={m.id} className={`align-top ${mi > 0 ? "border-t border-gray-100" : ""}`}>
                                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap tabular-nums">{m.srcRow ?? "—"}</td>
                                    <td className="px-3 py-2 whitespace-nowrap font-bold text-gray-800">{m.id}</td>
                                    <td className="px-3 py-2 text-gray-700">
                                      <span className="block whitespace-normal break-words max-w-[260px]">{m.title || "—"}</span>
                                    </td>
                                    <td className="px-3 py-2 min-w-[200px]">
                                      {details.length
                                        ? details.map(([ck, cv]) => (
                                            <div key={ck} className="flex gap-1 text-[10px] leading-snug py-0.5">
                                              <span className="text-gray-400 shrink-0 whitespace-nowrap">{ck}:</span>
                                              <span className="text-gray-700 break-words min-w-0">{cv}</span>
                                            </div>
                                          ))
                                        : <span className="text-gray-400 text-[10px]">Already in your grid</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                      <button onClick={() => resolveDupGroup(g, { keepId: m.id })}
                                        title={`Keep ${m.id} and drop the other ${n === 2 ? "row" : "rows"} from this import`}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold whitespace-nowrap">
                                        <CheckCircle2 className="w-3 h-3" /> Keep only this one
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-2 flex-wrap">
                          <button onClick={() => resolveDupGroup(g, { keepAll: true })}
                            title={`All ${n} rows stay in the grid and import as separate projects`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 text-[10px] font-semibold whitespace-nowrap">
                            Keep {allWord} — they're different projects
                          </button>
                          <button onClick={() => resolveDupGroup(g, { removeAll: true })}
                            title={`Drop ${allWord} rows from this import (your file and database are untouched)`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 text-[10px] font-semibold whitespace-nowrap">
                            Remove {allWord}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {heldRows.length === 0 && clashGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
                      <p className="text-sm font-semibold text-gray-800">Nothing needs your attention</p>
                      <p className="text-xs text-gray-500 mt-1">All rows were loaded into the grid — continue below, then press Upload when you're ready.</p>
                      <button onClick={finishReview}
                        className="mt-4 h-9 inline-flex items-center gap-2 px-4 rounded-lg text-xs font-bold text-white shadow-md hover:shadow-lg hover:brightness-105 transition-all"
                        style={{ background: "linear-gradient(135deg,#6BA539,#4e8028)" }}>
                        Continue — take cleaned data to import
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : tabRows.length > 0 && filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <Search className="w-8 h-8 text-gray-300 mb-3" />
                      <p className="text-sm font-semibold text-gray-800">No rows match your search</p>
                      <p className="text-xs text-gray-500 mt-1">Try a different search, or clear it to see all {tabRows.length.toLocaleString()} rows on this tab.</p>
                    </div>
                  ) : !mergeMainHeld && curRows.length > 0 && (() => {
                    // ── Held rows as a data grid ─────────────────────────
                    // The projects card's main tab shows everything in the
                    // ONE table above; this per-tab grid serves every other
                    // tab (and every other card's main tab). Every template
                    // column that has data, plus Issue / project pick /
                    // action — same information the cards carried, in a
                    // scannable grid.
                    const req0 = requiredIdFor(cardId, curRows[0].tabId);
                    const tabDef = tabs.find(t => t.label === curTab);
                    const templateLabels = tabDef ? tabDef!.cols.map(c => c.label) : [];
                    const seenLabels = new Set(templateLabels);
                    // Defensive: review-sheet cells not in the template still show.
                    for (const h of curRows) for (const k of Object.keys(h.cells)) {
                      if (!seenLabels.has(k)) { seenLabels.add(k); templateLabels.push(k); }
                    }
                    const dataCols = templateLabels.filter(l =>
                      (!req0 || l !== req0.label) && curRows.some(h => (h.cells[l] ?? "").trim()));
                    return (
                      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                        <div className="px-4 py-2.5 border-b border-gray-200 bg-amber-50/60">
                          <p className="text-xs font-bold text-gray-800">These rows were left out of your import for now</p>
                          <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                            Each row had a question the system could not answer on its own — the <span className="font-semibold">Issue</span> column tells you what it is.
                            Fix a row and press <span className="font-semibold">Add</span> to include it, or press <span className="font-semibold">Skip</span> to leave it out. Rows you leave here are simply skipped — they never block the rest of your import.
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-[11px]">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-500">
                                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">File row</th>
                                {dataCols.map(l => (
                                  <th key={l} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{l}</th>
                                ))}
                                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Issue</th>
                                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">{req0?.label ?? "ID"}</th>
                                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {curRows.map(h => {
                                const req = requiredIdFor(cardId, h.tabId);
                                const fr = friendlyRemark(h.remarks);
                                const idVal = req ? (h.cells[req.label] ?? "") : "";
                                const canAdd = !req || !!idVal.trim();
                                // Candidates parsed from the remark + projects added after
                                // cleaning ran (cross-tab sync), de-duplicated by ID.
                                const candSeen = new Set<string>();
                                const allCands = [...(fr.candidates ?? []), ...(h.extraCands ?? [])]
                                  .filter(c => candSeen.has(c.id) ? false : (candSeen.add(c.id), true));
                                const typeOpen = !!req && (allCands.length === 0 || typeOpenIds.has(h.id) ||
                                  (!!idVal.trim() && !allCands.some(c => c.id === idVal.trim())));
                                const badge = issueBadge(fr.kind);
                                const bulkN = canAdd && fr.kind === "ambiguous" ? bulkTargets(h, idVal.trim()).length : 0;
                                // Assignment/schedule rows pointing at a project that
                                // simply isn't in this file: nothing can honestly be
                                // fixed here — the only action offered is Skip.
                                const skipOnly = curTab !== mainLabel
                                  && (fr.kind === "notfound" || fr.kind === "noproject")
                                  && allCands.length === 0 && !idVal.trim();
                                const skipRow = () => {
                                  setHeldRows(prev => prev.filter(x => x.id !== h.id));
                                  recordHeldDecision(h.dKey, { status: "dismissed" });
                                };
                                return (
                                  <tr key={h.id} className={`border-t border-gray-100 align-top ${fr.kind === "duplicate" ? "bg-gray-50/60" : "hover:bg-amber-50/30"}`}>
                                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{h.srcRow ?? "—"}</td>
                                    {dataCols.map(l => {
                                      const v = (h.cells[l] ?? "").trim();
                                      return (
                                        <td key={l} className="px-3 py-2 text-gray-700">
                                          <span className="block whitespace-normal break-words max-w-[220px]" title={v}>{v || "—"}</span>
                                        </td>
                                      );
                                    })}
                                    <td className="px-3 py-2 whitespace-nowrap">
                                      <span title={`${fr.title} — ${fr.body}`}
                                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold cursor-help ${badge.cls}`}>
                                        {badge.txt}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2">
                                      {fr.kind === "duplicate" ? (
                                        <span className="text-gray-500 whitespace-nowrap"
                                          title={allCands.length > 1 ? allCands.map(c => `${c.id} — ${c.title}${c.srcRow ? ` (row ${c.srcRow})` : ""}`).join("\n") : undefined}>
                                          Copy of <span className="font-bold text-gray-800">{allCands[0]?.id ?? h.matchedId ?? "—"}</span>
                                          {allCands[0]?.srcRow ? ` (row ${allCands[0].srcRow})` : ""}
                                          {allCands.length > 1 ? ` +${allCands.length - 1} more` : ""}
                                        </span>
                                      ) : skipOnly ? (
                                        <span className="block text-[10px] text-gray-400 whitespace-normal leading-snug max-w-[200px]">
                                          This project isn't in your file — nothing to pick here
                                        </span>
                                      ) : (
                                        <div className="flex items-center gap-1.5 flex-wrap min-w-[170px]">
                                          {allCands.map(c => {
                                            const selected = idVal.trim() === c.id;
                                            return (
                                              <button key={c.id}
                                                title={`${c.title}${c.srcRow ? ` — your file row ${c.srcRow}` : ""}`}
                                                onClick={() => req && setHeldCell(h, req.label, c.id)}
                                                className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold transition-colors ${
                                                  selected
                                                    ? "bg-indigo-600 border-indigo-600 text-white"
                                                    : "bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50"}`}>
                                                {selected && <CheckCircle2 className="w-3 h-3" />}
                                                {c.id}
                                              </button>
                                            );
                                          })}
                                          {typeOpen && req && (
                                            <input
                                              value={idVal}
                                              onChange={e => setHeldCell(h, req.label, e.target.value)}
                                              placeholder={req.label}
                                              className="h-7 w-36 rounded-md border border-amber-300 bg-white px-2 text-[10px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                                            />
                                          )}
                                          {!typeOpen && req && allCands.length > 0 && (
                                            <button onClick={() => setTypeOpenIds(prev => { const n = new Set(prev); n.add(h.id); return n; })}
                                              className="text-[10px] text-gray-400 underline decoration-dotted hover:text-gray-600 whitespace-nowrap">
                                              Type ID
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {fr.kind === "duplicate" ? (
                                        <button onClick={skipRow}
                                          className="inline-flex items-center px-2.5 py-1 rounded-md border border-gray-200 bg-white text-[10px] font-semibold text-gray-500 hover:text-gray-700 whitespace-nowrap">
                                          Got it — hide
                                        </button>
                                      ) : skipOnly ? (
                                        <button onClick={skipRow}
                                          title="Leave this row out of the import — it points to a project that isn't in your file"
                                          className="inline-flex items-center px-2.5 py-1 rounded-md border border-gray-300 bg-white text-[10px] font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap">
                                          Skip
                                        </button>
                                      ) : (
                                        <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                                          {/* Pick once, apply everywhere: one project choice
                                              resolves EVERY held row naming the same project. */}
                                          {bulkN > 1 && (
                                            <button
                                              title={`Use ${idVal.trim()} for all ${bulkN.toLocaleString()} held rows that name this project`}
                                              onClick={() => bulkAddFamily(h, idVal.trim())}
                                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-semibold whitespace-nowrap">
                                              <CheckCircle2 className="w-3 h-3" /> Use for all {bulkN.toLocaleString()} rows
                                            </button>
                                          )}
                                          <button disabled={!canAdd}
                                            title={canAdd ? "Add this row to the import" : (allCands.length > 0 ? "Pick a project first" : `Type the ${req?.label ?? "ID"} first`)}
                                            onClick={() => canAdd && addHeldRow(h)}
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold text-white whitespace-nowrap ${
                                              canAdd ? "bg-amber-600 hover:bg-amber-700" : "bg-gray-300 cursor-not-allowed"}`}>
                                            <Plus className="w-3 h-3" /> Add
                                          </button>
                                          <button onClick={skipRow}
                                            title="Leave this row out of the import"
                                            className="inline-flex items-center px-2.5 py-1 rounded-md border border-gray-200 bg-white text-[10px] font-semibold text-gray-500 hover:text-gray-700 whitespace-nowrap">
                                            Skip
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                  </div>

                  {/* Pagination */}
                  {filtered.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
                      <p className="text-[11px] text-gray-500">
                        Showing {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}{q ? " matching" : ""} row{filtered.length !== 1 ? "s" : ""}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button disabled={page === 0} onClick={() => setHeldPage(p => Math.max(0, p - 1))}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold ${page === 0 ? "border-gray-100 text-gray-300 cursor-not-allowed" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                          Previous
                        </button>
                        <span className="text-[11px] text-gray-500">Page {page + 1} of {pageCount}</span>
                        <button disabled={page >= pageCount - 1} onClick={() => setHeldPage(p => Math.min(pageCount - 1, p + 1))}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold ${page >= pageCount - 1 ? "border-gray-100 text-gray-300 cursor-not-allowed" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                          Next
                        </button>
                        {/* Go to page */}
                        {pageCount > 2 && (
                          <form
                            className="flex items-center gap-1.5"
                            onSubmit={e => {
                              e.preventDefault();
                              const n = parseInt(heldPageInput, 10);
                              if (!isNaN(n)) setHeldPage(Math.max(0, Math.min(pageCount - 1, n - 1)));
                              setHeldPageInput("");
                            }}
                          >
                            <span className="text-[10px] text-gray-400 whitespace-nowrap">Go to</span>
                            <input
                              type="number" min={1} max={pageCount}
                              value={heldPageInput}
                              onChange={e => setHeldPageInput(e.target.value)}
                              onBlur={() => {
                                const n = parseInt(heldPageInput, 10);
                                if (!isNaN(n)) setHeldPage(Math.max(0, Math.min(pageCount - 1, n - 1)));
                                setHeldPageInput("");
                              }}
                              placeholder={String(page + 1)}
                              className="w-11 h-7 rounded-lg border border-gray-200 bg-white text-[11px] font-semibold text-gray-700 text-center outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 px-1"
                            />
                          </form>
                        )}
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-gray-400 mt-5 pb-4">
                    Rows left here are simply skipped — they never block your import.
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Non-template format warning — floating popup */}
        {/* Styled notice dialog — replaces browser alert()s */}
        {notice && (
          <div
            style={{
              position: "fixed", inset: 0, zIndex: Z.GRID_OVERLAY,
              display: "flex", alignItems: "center", justifyContent: "center",
              backgroundColor: "rgba(15,23,42,0.45)",
            }}
            onClick={() => setNotice(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: 440, maxWidth: "calc(100vw - 48px)",
                borderRadius: 16, overflow: "hidden", backgroundColor: "#fff",
                boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
                animation: "fadeInTicker 0.22s ease both",
              }}
            >
              <div style={{
                background: "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)",
                padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
              }}>
                <AlertTriangle className="w-4 h-4 shrink-0 text-white" />
                <span className="text-sm font-bold text-white flex-1 min-w-0 truncate">{notice.title}</span>
                <button className="shrink-0 text-white/80 hover:text-white" onClick={() => setNotice(null)} title="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-5 py-4 text-sm text-gray-700" style={{ whiteSpace: "pre-line", maxHeight: 320, overflowY: "auto" }}>
                {notice.message}
              </div>
              <div className="px-5 pb-4 flex justify-end">
                <button
                  onClick={() => setNotice(null)}
                  className="px-4 py-2 rounded-lg text-white text-xs font-bold shadow-sm hover:brightness-105"
                  style={{ background: "linear-gradient(135deg,#6BA539,#4e8028)" }}>
                  OK
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload column audit — file's data columns vs columns the grid took.
            Opens as step 1 of the upload flow (submitFileData), not on load. */}

        {showTemplateWarning && (
          <div
            style={{
              position: "fixed",
              top: 0, left: 0, right: 0, bottom: 0,
              zIndex: Z.GRID,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              paddingTop: 72,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                pointerEvents: "auto",
                width: 420,
                borderRadius: 16,
                overflow: "hidden",
                boxShadow: "0 20px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(251,146,60,0.35)",
                animation: "fadeInTicker 0.22s ease both",
              }}
            >
              {/* Gradient header bar */}
              <div style={{
                background: "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)",
                padding: "14px 16px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10,
                  background: "rgba(255,255,255,0.22)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <AlertTriangle className="w-5 h-5" style={{ color: "#fff" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ color: "#fff", fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>
                    File format doesn't match template
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.80)", fontSize: 11, marginTop: 1 }}>
                    Some columns may not map correctly
                  </p>
                </div>
                <button
                  onClick={() => setShowTemplateWarning(false)}
                  style={{
                    background: "rgba(255,255,255,0.20)",
                    border: "none",
                    borderRadius: 7,
                    padding: 5,
                    cursor: "pointer",
                    color: "#fff",
                    display: "flex", alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Body */}
              <div style={{
                background: "#1e2433",
                padding: "14px 18px 16px",
                borderTop: "1px solid rgba(251,146,60,0.20)",
              }}>
                <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.55 }}>
                  For best accuracy, download the template, fill it in, and re-upload.
                  You can still continue — but synonym matching may be less reliable.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {onDownloadTemplate && (
                    <button
                      onClick={() => { onDownloadTemplate(tmplData); setShowTemplateWarning(false); }}
                      style={{
                        flex: 1,
                        background: "linear-gradient(135deg, #f97316, #f59e0b)",
                        border: "none",
                        borderRadius: 8,
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 12,
                        padding: "8px 14px",
                        cursor: "pointer",
                      }}
                    >
                      Download template
                    </button>
                  )}
                  <button
                    onClick={() => setShowTemplateWarning(false)}
                    style={{
                      flex: 1,
                      background: "rgba(255,255,255,0.07)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8,
                      color: "#94a3b8",
                      fontWeight: 600,
                      fontSize: 12,
                      padding: "8px 14px",
                      cursor: "pointer",
                    }}
                  >
                    Continue anyway
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* "This file needs a lot of clean-up" — fresh upload landed with a
            pile of held-back rows (or a jumble across several tabs). Blocking
            popup: recommend the standard template, offer the download, and a
            clearly-labelled "continue despite the warning" path. */}
        {!readOnly && messyWarning && (
          <div
            style={{
              position: "fixed",
              top: 0, left: 0, right: 0, bottom: 0,
              zIndex: Z.POPUP_TOP,
              background: "rgba(15,23,42,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <div
              style={{
                width: 460,
                maxWidth: "100%",
                borderRadius: 16,
                overflow: "hidden",
                boxShadow: "0 24px 70px rgba(0,0,0,0.5), 0 0 0 1px rgba(251,146,60,0.35)",
                animation: "fadeInTicker 0.22s ease both",
              }}
            >
              {/* Gradient header bar */}
              <div style={{
                background: "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)",
                padding: "14px 16px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10,
                  background: "rgba(255,255,255,0.22)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <AlertTriangle className="w-5 h-5" style={{ color: "#fff" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ color: "#fff", fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>
                    This file needs a lot of clean-up
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.80)", fontSize: 11, marginTop: 1 }}>
                    {messyWarning.total} rows couldn't be matched automatically
                  </p>
                </div>
                <button
                  onClick={() => setMessyWarning(null)}
                  style={{
                    background: "rgba(255,255,255,0.20)",
                    border: "none",
                    borderRadius: 7,
                    padding: 5,
                    cursor: "pointer",
                    color: "#fff",
                    display: "flex", alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Body */}
              <div style={{
                background: "#1e2433",
                padding: "14px 18px 16px",
                borderTop: "1px solid rgba(251,146,60,0.20)",
              }}>
                <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.55 }}>
                  {messyWarning.byTab.length > 1
                    ? "The data looks mixed together — problem rows landed under several sections:"
                    : "A large number of rows had problems:"}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {messyWarning.byTab.map(([tab, n]) => (
                    <span key={tab} style={{
                      background: "rgba(251,146,60,0.12)",
                      border: "1px solid rgba(251,146,60,0.30)",
                      borderRadius: 999,
                      color: "#fdba74",
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "3px 10px",
                    }}>
                      {tab}: {n} row{n !== 1 ? "s" : ""}
                    </span>
                  ))}
                </div>
                <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.55, marginTop: 10 }}>
                  This usually means the file wasn't built from our standard template.
                  The fastest fix: download the template, copy your data into the matching
                  tabs and columns, then upload that file instead.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button
                    onClick={() => {
                      if (onDownloadTemplate) onDownloadTemplate(tmplData);
                      else void downloadCardTemplate(cardId, multiTab);
                      setMessyWarning(null);
                    }}
                    style={{
                      flex: 1,
                      background: "linear-gradient(135deg, #6BA539, #5a8f2f)",
                      border: "none",
                      borderRadius: 8,
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 12,
                      padding: "9px 14px",
                      cursor: "pointer",
                    }}
                  >
                    Download template
                  </button>
                  <button
                    onClick={() => setMessyWarning(null)}
                    style={{
                      flex: 1,
                      background: "rgba(255,255,255,0.07)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8,
                      color: "#94a3b8",
                      fontWeight: 600,
                      fontSize: 12,
                      padding: "9px 14px",
                      cursor: "pointer",
                    }}
                  >
                    Continue &amp; fix in portal
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="flex items-center gap-4 px-6 py-2 text-xs shrink-0" style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
          <span className="flex items-center gap-1 text-indigo-600 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />{mappedTemplateCount} of {activeFileTabDef.cols.length} template fields filled
          </span>
          {sampleSkipCount > 0 && (
            <span className="flex items-center gap-1 text-amber-600">
              {sampleSkipCount} example row{sampleSkipCount !== 1 ? "s" : ""} from the template skipped (not imported)
            </span>
          )}
          {sampleKeptCount > 0 && (
            <span className="flex items-center gap-1 text-amber-600">
              This file contains our example data — {sampleKeptCount} sample row{sampleKeptCount !== 1 ? "s" : ""} kept so you can test the import
            </span>
          )}
          {hiddenCount > 0 && (
            <span className="flex items-center gap-1" style={{ color: "#9ca3af" }}>
              {hiddenCount} assignment row{hiddenCount !== 1 ? "s" : ""} hidden — see Team Assignments tab
            </span>
          )}
          {aiMatchingTabs.has(activeFileTab) && (
            <span className="flex items-center gap-1.5 text-amber-600 font-medium">
              <span className="w-3 h-3 rounded-full border-2 border-amber-500 border-t-transparent animate-spin inline-block" />
              AI matching…
            </span>
          )}
          {!aiMatchingTabs.has(activeFileTab) && Object.values(curMatchTypes).some(t => t === "ai") && (
            <span className="flex items-center gap-1.5 text-amber-600 font-medium">✦ AI suggested — review amber chips</span>
          )}
          {/* Per-tab search — filters the rows shown below; every row is
              still uploaded (search never changes what gets imported). */}
          <div className="relative ml-auto shrink-0">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={fileSearch}
              onChange={e => setFileSearch(e.target.value)}
              placeholder={`Search ${activeFileTabDef.label}…`}
              className="h-6 w-52 rounded-md border border-gray-200 bg-white pl-7 pr-6 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300"
            />
            {fileSearch && (
              <button onClick={() => setFileSearch("")} title="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <span className="text-[10px]" style={{ color: "#9ca3af" }}>
            {fileSearchQ
              ? `${totalRows.toLocaleString()} of ${effectiveRows.length.toLocaleString()} rows match · all rows still upload`
              : `All ${effectiveRows.length.toLocaleString()} rows shown · click a chip to change the source column`}
          </span>
        </div>

        {/* Template-fixed grid — data flows into template columns.
            Virtualized: only the rows near the viewport exist in the DOM. */}
        <div ref={fileGridScrollCb} onScroll={onFileGridScroll}
          className="flex-1 overflow-auto" style={{ backgroundColor: "#fff", minHeight: 380 }} onPaste={handleFilePaste}
          onContextMenu={e => openCtxMenu(e, "file")}>
          <table className="border-collapse text-xs" style={{ tableLayout: "fixed", width: fileGridW, backgroundColor: "#fff" }}>
            <colgroup>
              <col style={{ width: 40 }} />
              {activeFileTabDef.cols.map(c => (
                <col key={c.key} style={{ width: fgColWs[c.key] ?? c.w }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                {/* Row number */}
                <th className="border px-2 font-normal text-center w-10 min-w-10 sticky left-0 z-20 align-bottom pb-3 cursor-pointer select-none transition-colors"
                  style={{ borderColor: "#e5e7eb", backgroundColor: "#f3f4f6", color: "#9ca3af" }}
                  title="Click to deselect all" onClick={() => { setFileSelAnchor(null); setFileSelActive(null); setFileEditCell(null); }}>#</th>

                {/* ── TEMPLATE COLUMNS (always fixed structure) ── */}
                {(() => {
                  // Pre-compute selection range once for all column headers
                  const _hAci = fileSelAnchor ? activeFileTabDef.cols.findIndex(c => c.key === fileSelAnchor!.colKey) : -1;
                  const _hBci = fileSelActive ? activeFileTabDef.cols.findIndex(c => c.key === fileSelActive!.colKey) : _hAci;
                  const _hRlo = fileSelAnchor ? Math.min(fileSelAnchor.rowIdx, fileSelActive?.rowIdx ?? fileSelAnchor.rowIdx) : -1;
                  const _hRhi = fileSelAnchor ? Math.max(fileSelAnchor.rowIdx, fileSelActive?.rowIdx ?? fileSelAnchor.rowIdx) : -1;
                  const _hClo = Math.min(_hAci, _hBci);
                  const _hChi = Math.max(_hAci, _hBci);
                  // Selection state is keyed by REAL ts.rows indices. Every row
                  // is now shown (virtually), so column select-all spans the
                  // whole file — same as Excel. When a search filter is active
                  // the span covers the last MATCHING row instead.
                  const lastRow = totalRows
                    ? (dispRealIdx ? dispRealIdx[totalRows - 1] : totalRows - 1)
                    : -1;
                  return activeFileTabDef.cols.map((col, colIdx) => {
                    const fh = reverseMap[col.key] ?? null;
                    const mt = fh ? (curMatchTypes[fh] ?? "auto") : null;
                    // Column is "selected" when all rows are in selection AND this col is in the col range
                    const isColSel = fileSelAnchor !== null && lastRow >= 0
                      && _hRlo === 0 && _hRhi === lastRow
                      && colIdx >= _hClo && colIdx <= _hChi;
                    return (
                      <TmplColHeader key={col.key}
                        col={col}
                        fileHeader={fh}
                        fixedValue={curFixedValues[col.key] ?? null}
                        matchType={mt}
                        availableHeaders={availableFileHeaders}
                        headerSamples={availableHeaderSamples}
                        isAiLoading={aiMatchingTabs.has(activeFileTab)}
                        isSelected={isColSel}
                        deferredCheck={deferredIdCheck && col.key === refColKey}
                        onAssign={fh2 => assignToTemplate(activeFileTab, col.key, fh2)}
                        onSetFixed={v => setFixedValue(activeFileTab, col.key, v)}
                        onSelectColumn={() => {
                          if (isColSel) {
                            setFileSelAnchor(null); setFileSelActive(null); setFileEditCell(null);
                          } else {
                            if (lastRow < 0) return;
                            setFileSelAnchor({ rowIdx: 0, colKey: col.key });
                            setFileSelActive({ rowIdx: lastRow, colKey: col.key });
                            setFileEditCell(null);
                          }
                        }}
                      />
                    );
                  });
                })()}

              </tr>
            </thead>
            <tbody>
              {/* Top spacer — stands in for the rows scrolled above the window */}
              {padTop > 0 && (
                <tr aria-hidden="true" style={{ height: padTop }}>
                  <td colSpan={activeFileTabDef.cols.length + 1} style={{ padding: 0, border: "none" }} />
                </tr>
              )}
              {windowRows.map(({ row, idx: rIdx, ri }) => {
                // rIdx = REAL index in ts.rows (keys overrides/selection/edit
                // state); ri = display position (zebra striping only).
                // Compute whether this entire row is currently selected (all cols span)
                const _aCi = fileSelAnchor ? activeFileTabDef.cols.findIndex(c => c.key === fileSelAnchor!.colKey) : -1;
                const _bCi = fileSelActive ? activeFileTabDef.cols.findIndex(c => c.key === fileSelActive!.colKey) : _aCi;
                const _rLo = fileSelAnchor ? Math.min(fileSelAnchor.rowIdx, fileSelActive?.rowIdx ?? fileSelAnchor.rowIdx) : -1;
                const _rHi = fileSelAnchor ? Math.max(fileSelAnchor.rowIdx, fileSelActive?.rowIdx ?? fileSelAnchor.rowIdx) : -1;
                const _cLo = Math.min(_aCi, _bCi);
                const _cHi = Math.max(_aCi, _bCi);
                const isRowSel = fileSelAnchor !== null && rIdx >= _rLo && rIdx <= _rHi
                  && _cLo === 0 && _cHi === activeFileTabDef.cols.length - 1;
                return (
                <tr key={rIdx} data-row-idx={rIdx}
                  style={{ backgroundColor: ri % 2 === 0 ? "#ffffff" : "#f9fafb", height: FILE_ROW_H }}
                  onMouseEnter={() => {
                    if (isFileDraggingRef.current && fileDragFillRef.current && fileDragFillRef.current.toRow !== rIdx) {
                      const next = { ...fileDragFillRef.current, toRow: rIdx };
                      fileDragFillRef.current = next;
                      setFileDragFill(next);
                    }
                  }}>
                  <td
                    className={`border px-2 py-1.5 text-center w-10 text-[10px] sticky left-0 z-10 cursor-pointer select-none font-medium ${
                      isRowSel ? "bg-indigo-500 text-white border-indigo-500" : ""
                    }`}
                    style={isRowSel ? {} : { backgroundColor: ri % 2 === 0 ? "#ffffff" : "#f9fafb", color: "#9ca3af", borderColor: "#e5e7eb" }}
                    title={isRowSel ? "Click to deselect row" : "Click to select row"}
                    onClick={() => {
                      if (isRowSel) {
                        setFileSelAnchor(null); setFileSelActive(null); setFileEditCell(null);
                      } else {
                        const cols = activeFileTabDef.cols;
                        if (!cols.length) return;
                        setFileSelAnchor({ rowIdx: rIdx, colKey: cols[0].key });
                        setFileSelActive({ rowIdx: rIdx, colKey: cols[cols.length - 1].key });
                        setFileEditCell(null);
                      }
                    }}
                  >{rIdx + 1}</td>

                  {/* Template column cells — editable, value from override > file col > fixed value */}
                  {activeFileTabDef.cols.map(col => {
                    const fh  = reverseMap[col.key];
                    const fv  = curFixedValues[col.key];
                    const override = (activeFileTs?.cellOverrides?.[rIdx]?.[col.key]);
                    const fileVal = fh ? (row[fh] ?? "") : (fv ?? "");
                    const val = override !== undefined ? override : fileVal;
                    const isFixed = !fh && !!fv && override === undefined;
                    const isOverride = override !== undefined && override !== fileVal;
                    const cellErr = validateCell(col, val) ?? dbCellErr(col, val);
                    const isEditing = fileEditCell?.tabId === activeFileTab && fileEditCell.rowIdx === rIdx && fileEditCell.colKey === col.key;
                    // Range selection: anchor → active defines the selected rectangle
                    const colIdx = activeFileTabDef.cols.findIndex(c => c.key === col.key);
                    const anchorCi  = fileSelAnchor ? activeFileTabDef.cols.findIndex(c => c.key === fileSelAnchor.colKey) : -1;
                    const activeCi  = fileSelActive ? activeFileTabDef.cols.findIndex(c => c.key === fileSelActive.colKey) : anchorCi;
                    const activeRiE = fileSelActive?.rowIdx ?? fileSelAnchor?.rowIdx ?? -1;
                    const rMin = fileSelAnchor ? Math.min(fileSelAnchor.rowIdx, activeRiE) : -1;
                    const rMax = fileSelAnchor ? Math.max(fileSelAnchor.rowIdx, activeRiE) : -1;
                    const cMin = Math.min(anchorCi, activeCi);
                    const cMax = Math.max(anchorCi, activeCi);
                    const isSelected = fileSelAnchor !== null && rIdx >= rMin && rIdx <= rMax && colIdx >= cMin && colIdx <= cMax;
                    const isDragHighlight = fileDragFill && fileDragFill.colKey === col.key
                      && rIdx >= Math.min(fileDragFill.srcRow, fileDragFill.toRow)
                      && rIdx <= Math.max(fileDragFill.srcRow, fileDragFill.toRow);
                    return (
                      <td key={col.key}
                        title={cellErr ?? undefined}
                        style={{ minWidth: col.w, maxWidth: 240, position: "relative",
                          borderColor: isDragHighlight ? undefined : isRowSel ? undefined : isSelected ? undefined : cellErr ? "#f87171" : isOverride ? undefined : "#e5e7eb",
                          color: isDragHighlight ? undefined : isRowSel ? "#1f2937" : isSelected ? "#1f2937" : cellErr ? "#b91c1c" : isOverride ? undefined : isFixed ? undefined : val ? "#374151" : "#d1d5db",
                        }}
                        className={`border text-xs select-none ${
                          isDragHighlight ? "border-indigo-400 bg-indigo-50"
                          : isRowSel      ? "border-indigo-300 bg-indigo-100/70"
                          : isSelected    ? "border-indigo-400 bg-indigo-50/60"
                          : cellErr       ? "bg-red-50"
                          : isOverride    ? "border-orange-200 bg-orange-50 text-orange-700"
                          : isFixed       ? "bg-teal-50/40 text-teal-700 italic"
                          : val           ? ""
                          :                 "italic"
                        }`}
                        onMouseDown={(e) => {
                          if (!activeFileTabDef.cols.length) return;
                          if (e.shiftKey && fileSelAnchor) {
                            setFileSelActive({ rowIdx: rIdx, colKey: col.key });
                          } else if (col.type === "date" && !isEditing) {
                            // Date cells: a single click opens the editor with the
                            // native calendar picker (mirrors template mode).
                            setFileSelAnchor({ rowIdx: rIdx, colKey: col.key });
                            setFileSelActive({ rowIdx: rIdx, colKey: col.key });
                            setFileEditCell({ tabId: activeFileTab, rowIdx: rIdx, colKey: col.key });
                            setFileEditDraft(normalizeDateInput(val) ?? "");
                          } else {
                            isDragSelectingRef.current = true;
                            didDragSelectRef.current = false;
                            // Select just this cell on single click
                            setFileSelAnchor({ rowIdx: rIdx, colKey: col.key });
                            setFileSelActive({ rowIdx: rIdx, colKey: col.key });
                            setFileEditCell(null);
                          }
                        }}
                        onMouseUp={() => {
                          // mouseUp intentionally does NOT open edit mode —
                          // use double-click to edit a specific cell.
                        }}
                        onDoubleClick={() => {
                          setFileEditCell({ tabId: activeFileTab, rowIdx: rIdx, colKey: col.key });
                          setFileEditDraft(col.type === "date" ? (normalizeDateInput(val) ?? "") : val);
                        }}
                        onMouseEnter={() => {
                          if (isDragSelectingRef.current) {
                            didDragSelectRef.current = true;
                            setFileSelActive({ rowIdx: rIdx, colKey: col.key });
                          }
                        }}>
                        {isEditing ? (
                          col.type === "date" ? (
                          <DateField
                            autoFocus
                            openOnMount
                            compact
                            value={/^\d{4}-\d{2}-\d{2}$/.test(fileEditDraft) ? fileEditDraft : ""}
                            onMouseDownCapture={e => e.stopPropagation()}
                            onChange={v => {
                              setFileEditDraft(v);
                              // Only commit complete dates — never an empty/partial
                              // draft, or a mere click-through on an unreadable cell
                              // ("TBD") would silently wipe its value. Committing also
                              // closes the editor (calendar pick = done).
                              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                                setCellOverride(activeFileTab, rIdx, col.key, v);
                                skipNextBlurRef.current = true;
                                setFileEditCell(null);
                              }
                            }}
                            onKeyDown={e => {
                              if (e.key === "Enter" || e.key === "Escape") {
                                skipNextBlurRef.current = true;
                                setFileEditCell(null);
                              }
                            }}
                            style={{ backgroundColor: "#fff", color: "#111827", fontSize: 12, border: "none", borderRadius: 0 }}
                            wrapStyle={{ minWidth: col.w }}
                          />
                          ) : (
                          <input
                            autoFocus
                            className="w-full h-full px-2 py-1.5 text-xs outline-none border-0"
                            style={{ backgroundColor: "#fff", color: "#111827", minWidth: col.w }}
                            value={fileEditDraft}
                            onChange={e => setFileEditDraft(e.target.value)}
                            onPaste={e => {
                              const lines = e.clipboardData.getData("text/plain")
                                .replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd().split("\n");
                              const parsed = lines.map(l => l.split("\t"));
                              if (parsed.length > 1 || (parsed[0]?.length ?? 0) > 1) {
                                setCellOverride(activeFileTab, rIdx, col.key, fileEditDraft);
                                setFileEditCell(null);
                                handleFilePaste(e);
                              }
                            }}
                            onBlur={() => {
                              if (skipNextBlurRef.current) { skipNextBlurRef.current = false; return; }
                              setCellOverride(activeFileTab, rIdx, col.key, fileEditDraft);
                              setFileEditCell(null);
                            }}
                            onKeyDown={e => {
                              if (e.key === "Enter" || e.key === "Tab") {
                                e.preventDefault();
                                setCellOverride(activeFileTab, rIdx, col.key, fileEditDraft);
                                skipNextBlurRef.current = true;
                                setFileEditCell(null);
                                if (e.key === "Tab") {
                                  const nextColIdx = activeFileTabDef.cols.findIndex(c => c.key === col.key) + 1;
                                  const nextCol = activeFileTabDef.cols[nextColIdx];
                                  if (nextCol) {
                                    const nextVal = (activeFileTs?.cellOverrides?.[rIdx]?.[nextCol.key]) ??
                                      (reverseMap[nextCol.key] ? (row[reverseMap[nextCol.key]] ?? "") : (curFixedValues[nextCol.key] ?? ""));
                                    setFileSelAnchor({ rowIdx: rIdx, colKey: nextCol.key });
                                    setFileSelActive({ rowIdx: rIdx, colKey: nextCol.key });
                                    setFileEditCell({ tabId: activeFileTab, rowIdx: rIdx, colKey: nextCol.key });
                                    setFileEditDraft(nextVal);
                                  }
                                }
                              }
                              if (e.key === "Escape") { skipNextBlurRef.current = true; setFileEditCell(null); }
                            }}
                          />
                          )
                        ) : (
                          <>
                            <span className="truncate block px-2 py-1.5">{val || "—"}</span>
                            {/* Drag-fill handle — bottom-right corner */}
                            <div
                              className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-indigo-500 cursor-crosshair opacity-0 hover:opacity-100 transition-opacity"
                              style={{ borderTopLeftRadius: 2 }}
                              onMouseDown={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                const d = { colKey: col.key, srcRow: rIdx, val, toRow: rIdx };
                                fileDragFillRef.current = d;
                                isFileDraggingRef.current = true;
                                setFileDragFill(d);
                              }}
                            />
                          </>
                        )}
                      </td>
                    );
                  })}

                </tr>
              ); })}
              {/* drag-fill mousemove capture */}
              {fileDragFill && (
                <tr style={{ position: "absolute", inset: 0, pointerEvents: "all", zIndex: 40, background: "transparent" }}
                  onMouseMove={e => {
                    if (!isFileDraggingRef.current) return;
                    const table = (e.currentTarget as HTMLElement).closest("table");
                    if (!table) return;
                    const rows = table.querySelectorAll("tbody tr");
                    let closest = fileDragFill.srcRow;
                    rows.forEach((r) => {
                      // Rows carry their REAL ts.rows index in data-row-idx —
                      // never use the DOM enumeration position.
                      const dIdx = parseInt((r as HTMLElement).dataset.rowIdx ?? "", 10);
                      if (!Number.isFinite(dIdx)) return;
                      const rect = r.getBoundingClientRect();
                      if (e.clientY >= rect.top - 4 && e.clientY <= rect.bottom + 4) closest = dIdx;
                    });
                    setFileDragFill(prev => prev ? { ...prev, toRow: closest } : null);
                  }}
                />
              )}
              {/* Bottom spacer — stands in for the rows below the window */}
              {padBottom > 0 && (
                <tr aria-hidden="true" style={{ height: padBottom }}>
                  <td colSpan={activeFileTabDef.cols.length + 1} style={{ padding: 0, border: "none" }} />
                </tr>
              )}
            </tbody>
          </table>
          {fileSearchQ && totalRows === 0 && (
            <div className="flex items-center justify-center py-6">
              <span className="text-xs" style={{ color: "#6b7280" }}>
                No rows match "{fileSearch.trim()}" on this tab — clear the search to see all {effectiveRows.length.toLocaleString()} rows.
              </span>
            </div>
          )}
          {totalRows > 100 && (
            <div className="flex items-center justify-center py-2 border-t" style={{ borderColor: "#e5e7eb", backgroundColor: "#f9fafb" }}>
              <span className="text-xs" style={{ color: "#6b7280" }}>
                {fileSearchQ
                  ? `${totalRows.toLocaleString()} matching rows shown — scroll to browse. Every row (matching or not) will be imported.`
                  : `All ${totalRows.toLocaleString()} rows are shown — scroll to browse. Every row will be imported.`}
              </span>
            </div>
          )}
        </div>
        </div>

      {reviewedFileDialog}
      {gridPeek && <ImportGridPeek {...gridPeek} onClose={() => setGridPeek(null)} />}
      <ImportWizardOverlay
        open={wizardActive}
        steps={wizardSteps}
        currentStep={wizardStep}
        title={wizardTitle}
        subtitle={wizardSubtitle}
        onBack={wizardOnBack}
        locked={isSubmitting}
        contentMaxWidth={wizardMaxW}
      >
        {colAuditContent}
        {mappingConfirmOverlay}
        {validationReviewOverlay}
        {groupAclOverlay}
        {recordGroupsOverlay}
        {busyContent}
        {runContent}
      </ImportWizardOverlay>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // TEMPLATE MODE
  // ════════════════════════════════════════════════════════════════════════
  const cols = activeTmplTabDef.cols;
  const totalW = cols.reduce((a, c) => a + c.w, 0) + 42;

  return (
    <div className={embedded ? "flex flex-col flex-1 min-h-0 overflow-hidden" : "fixed inset-0 z-50 flex flex-col"} style={{ backgroundColor: "var(--rm-panel)" }}>
      {/* Read-only history view: while the initialFile is being parsed the
          grid is still in template mode and the main thread blocks on the
          workbook parse — show a visible "preparing" overlay so a big file
          doesn't look like a frozen empty grid. */}
      {readOnly && uploading && !isSubmitting && !preparing && (
        <div className="fixed inset-0 z-[80] bg-white/90 flex flex-col items-center justify-center gap-3 text-gray-600">
          <span className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <span className="text-sm font-medium">Preparing preview of {cardLabel}…</span>
          <span className="text-xs text-gray-400">Large files can take a little while to open.</span>
        </div>
      )}
      {/* CLEANING_HIDDEN: the staged "Cleaning your data" popup never shows.
          Only the plain restore loader remains (re-opening a saved session). */}
      {cleaning?.restore && <CleaningPopup pct={cleaning.pct} msg={cleaning.msg} restore={cleaning.restore} onCancel={cancelCleaning} onSkip={skipCleaning} />}
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />

      {/* Right-click context menu — Excel-style, shared by file and template mode */}
      {contextMenu && (() => {
        const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");
        const mod = isMac ? "⌘" : "Ctrl+";
        // openCtxMenu already moved the selection to the clicked cell, so the
        // current selection span IS the menu's target (matches what's highlighted).
        const aRow = fileMode ? fileSelAnchor?.rowIdx : selAnchor?.row;
        const bRow = fileMode ? (fileSelActive?.rowIdx ?? fileSelAnchor?.rowIdx) : (selActive?.row ?? selAnchor?.row);
        const hasSel = aRow !== undefined;
        const rMin = hasSel ? Math.min(aRow!, bRow ?? aRow!) : -1;
        const rMax = hasSel ? Math.max(aRow!, bRow ?? aRow!) : -1;
        const nRows = hasSel ? rMax - rMin + 1 : 0;
        const close = () => setContextMenu(null);
        const dispatchKey = (key: string, withMod?: boolean) =>
          document.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: !!withMod, bubbles: true }));
        const itemCls = "w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700 flex items-center justify-between gap-6 disabled:opacity-40 disabled:hover:bg-white";
        return (
          <div ref={ctxMenuRef}
            className="fixed z-[999] bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-xs min-w-[180px] select-none"
            style={{
              left: Math.max(4, Math.min(contextMenu.x, window.innerWidth - 210)),
              top: Math.max(4, Math.min(contextMenu.y, window.innerHeight - 300)),
            }}>
            <button className={itemCls} disabled={!hasSel}
              onClick={() => { dispatchKey("x", true); close(); }}>
              <span>Cut</span><span className="text-gray-400 font-mono text-[10px]">{mod}X</span>
            </button>
            <button className={itemCls} disabled={!hasSel}
              onClick={() => { dispatchKey("c", true); close(); }}>
              <span>Copy</span><span className="text-gray-400 font-mono text-[10px]">{mod}C</span>
            </button>
            <button className={itemCls} disabled={!hasSel}
              onClick={async () => {
                const pos = { x: contextMenu.x, y: contextMenu.y };
                close();
                const text = await navigator.clipboard.readText().catch(() => "");
                if (text) {
                  const fake = { clipboardData: { getData: () => text } } as unknown as React.ClipboardEvent;
                  if (fileMode) handleFilePaste(fake); else handleGridPaste(fake);
                } else {
                  // Browser refused programmatic clipboard read — guide the user.
                  setPasteHint(pos);
                  window.setTimeout(() => setPasteHint(null), 3000);
                }
              }}>
              <span>Paste</span><span className="text-gray-400 font-mono text-[10px]">{mod}V</span>
            </button>
            <button className={itemCls} disabled={!hasSel}
              onClick={() => { dispatchKey("Delete"); close(); }}>
              <span>Clear contents</span><span className="text-gray-400 font-mono text-[10px]">Del</span>
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button className={itemCls} disabled={!hasSel}
              onClick={() => { (fileMode ? insertFileRowAt : insertTmplRowAt)(rMin); close(); }}>
              <span>Insert row above</span>
            </button>
            <button className={itemCls} disabled={!hasSel}
              onClick={() => { (fileMode ? insertFileRowAt : insertTmplRowAt)(rMax + 1); close(); }}>
              <span>Insert row below</span>
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-white" disabled={!hasSel}
              onClick={() => { (fileMode ? deleteFileRows : deleteTmplRows)(rMin, rMax); close(); }}>
              {nRows > 1 ? `Delete ${nRows} rows` : "Delete row"}
            </button>
          </div>
        );
      })()}
      {pasteHint && (
        <div className="fixed z-[999] bg-gray-900 text-white text-[11px] px-3 py-1.5 rounded-lg shadow-lg pointer-events-none"
          style={{ left: Math.max(4, Math.min(pasteHint.x, window.innerWidth - 280)), top: pasteHint.y }}>
          Your browser blocked menu paste — press Ctrl+V (⌘V on Mac) instead
        </div>
      )}


      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 shadow-sm shrink-0" style={{ borderBottom: "1px solid var(--rm-panel-border)", backgroundColor: "var(--rm-panel)" }}>
        <div className="flex items-center gap-3">
          {!embedded && (
            <>
              <button onClick={onClose} className="flex items-center gap-1.5 text-xs transition" style={{ color: "var(--rm-text-muted)" }}>
                <ChevronLeft className="w-4 h-4" /> Other modules
              </button>
              <span style={{ color: "var(--rm-text-faint)" }}>|</span>
            </>
          )}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-semibold text-sm" style={{ color: "var(--rm-text)" }}>{cardLabel} — Data Entry</span>
            <span className="text-xs rounded-full px-2 py-0.5" style={{ color: "var(--rm-text-muted)", backgroundColor: "var(--rm-panel-soft)" }}>Template</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onDownloadTemplate && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              style={{ borderColor: "var(--rm-panel-border)", color: "var(--rm-text)", backgroundColor: "var(--rm-panel-soft)" }}
              onClick={() => onDownloadTemplate(tmplData)}>
              <Download className="w-3 h-3" /> Download template
            </Button>
          )}
          {!thisModRunning && (
            <Button size="sm" variant="outline"
              className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
              onClick={() => {
                // While an import is running the click opens the parent's
                // live-progress popup (one file at a time) instead of the
                // file picker — a silently-disabled button confused users.
                if (jobRunning) { onJobRunningClick?.(); return; }
                fileRef.current?.click();
              }}
              disabled={uploading || !!cleaning || (!!jobRunning && !onJobRunningClick)}
              title={jobRunning ? "An import is already running — please wait for it to finish" : undefined}>
              {uploading
                ? <span className="w-3 h-3 rounded-full border-2 border-emerald-700 border-t-transparent animate-spin" />
                : <Upload className="w-3 h-3" />}
              {uploading ? "Reading…" : "Upload File"}
            </Button>
          )}

          <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
            style={{ borderColor: "var(--rm-panel-border)", color: "var(--rm-text)", backgroundColor: "var(--rm-panel-soft)" }}
            onClick={() => setTmplData(prev => ({ ...prev, [activeTmplTab]: [...(prev[activeTmplTab] ?? []), empty(cols)] }))}>
            <Plus className="w-3 h-3" /> Add Row
          </Button>
          {activeTmplRows.length > 0 && (
            <Button size="sm" variant="outline"
              className="h-7 text-xs gap-1 border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => {
                if (!window.confirm(`Clear all ${activeTmplRows.length} row${activeTmplRows.length !== 1 ? "s" : ""} in "${activeTmplTabDef?.label ?? activeTmplTab}"? This can't be undone.`)) return;
                const tabCols = (tabs.find(t => t.id === activeTmplTab) ?? tabs[0]).cols;
                setTmplData(prev => ({ ...prev, [activeTmplTab]: [empty(tabCols), empty(tabCols), empty(tabCols)] }));
                setSelAnchor(null); setSelActive(null); setEditing(null);
              }}>
              <Trash2 className="w-3 h-3" /> Clear
            </Button>
          )}
          {!thisModRunning && (
            <Button size="sm" className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
              disabled={totalFilled === 0 || isSubmitting || preparing} onClick={() => beginSubmit(submitTemplateData)}>
              {(isSubmitting || preparing) ? <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" /> : <ArrowRight className="w-3 h-3" />}
              {isSubmitting ? "Uploading…" : preparing ? "Processing…" : `Upload ${totalFilled} row${totalFilled !== 1 ? "s" : ""}`}
            </Button>
          )}
        </div>
      </div>

      {pasteFlash && (
        <div className="flex items-center gap-2 px-6 py-1.5 bg-violet-50 border-b border-violet-100 text-xs text-violet-700 font-medium shrink-0 animate-pulse">
          <CheckCircle2 className="w-3.5 h-3.5" /> Pasted!
        </div>
      )}

      {/* Template tabs */}
      <div className="flex items-center shrink-0 px-6" style={{ borderBottom: "1px solid var(--rm-panel-border)", backgroundColor: "var(--rm-panel)" }}>
        {baseTabs.map((tab, ti) => {
          const count = filledCounts[ti];
          return (
            <button key={tab.id} onClick={() => setActiveTmplTab(tab.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors"
              style={{
                borderBottomColor: activeTmplTab === tab.id ? "#6366f1" : "transparent",
                color: activeTmplTab === tab.id ? "#6366f1" : "var(--rm-text-muted)",
              }}>
              {tab.label}
              {count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{
                    backgroundColor: activeTmplTab === tab.id ? "rgba(99,102,241,0.15)" : "var(--rm-panel-soft)",
                    color: activeTmplTab === tab.id ? "#6366f1" : "var(--rm-text-muted)",
                  }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <span className="ml-auto text-xs pb-2" style={{ color: "var(--rm-text-faint)" }}>
          {activeTmplRows.length} rows · {cols.length} columns
        </span>
      </div>

      {/* Template grid — also accepts file drag-drop */}
      <div className="flex-1 overflow-auto min-h-0 relative" style={{ backgroundColor: "#fff" }} onPaste={handleGridPaste}
        onContextMenu={e => openCtxMenu(e, "tmpl")}
        onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setFileDragOver(true); } }}
        onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setFileDragOver(false); }}
        onDrop={e => {
          e.preventDefault(); setFileDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file && /\.(xlsx|xls|csv)$/i.test(file.name)) {
            const dt = new DataTransfer(); dt.items.add(file);
            if (fileRef.current) { fileRef.current.files = dt.files; handleFile({ target: fileRef.current } as unknown as React.ChangeEvent<HTMLInputElement>); }
          }
        }}>
        {/* File drag-over overlay */}
        {fileDragOver && (
          <div className="absolute inset-0 z-30 bg-violet-50/90 border-2 border-dashed border-violet-400 rounded flex flex-col items-center justify-center gap-3 pointer-events-none">
            <Upload className="w-10 h-10 text-violet-400" />
            <p className="text-base font-semibold text-violet-700">Drop your Excel or CSV file here</p>
            <p className="text-xs text-violet-500">Columns will be auto-matched to the template</p>
          </div>
        )}
        <table className="border-collapse text-xs" style={{ tableLayout: "fixed", width: totalW, backgroundColor: "#fff" }}>
          <thead className="sticky top-0 z-10">
            <tr style={{ backgroundColor: "#f3f4f6", borderBottom: "1px solid #e5e7eb" }}>
              <th className="w-10 min-w-10 border px-2 py-2.5 text-center font-normal sticky left-0 z-20 cursor-pointer select-none"
                style={{ borderColor: "#e5e7eb", backgroundColor: "#f3f4f6", color: "#9ca3af" }}
                title="Click to deselect" onClick={() => { setSelAnchor(null); setSelActive(null); setEditing(null); }}>#</th>
              {cols.map((col, colIdx) => (
                <th key={col.key}
                  className="border px-2 py-2.5 text-left text-xs font-semibold whitespace-nowrap cursor-pointer hover:bg-indigo-50/60 select-none"
                  style={{ borderColor: "#e5e7eb", color: "#4b5563", width: col.w, minWidth: col.w }}
                  title={`Click to select all rows in "${col.label}"`}
                  onClick={() => {
                    const last = activeTmplRows.length - 1;
                    if (last < 0) return;
                    setSelAnchor({ row: 0, col: col.key });
                    setSelActive({ row: last, col: col.key });
                    setEditing(null);
                  }}>
                  <span className="flex items-center gap-1">
                    {col.label}
                    {col.opts && <ChevronDown className="w-3 h-3 text-indigo-400 shrink-0" />}
                    {deferredIdCheck && col.key === refColKey && (
                      <span
                        title="This tenant has too many IDs to check as you type — IDs are validated when you click Upload instead."
                        style={{
                          flexShrink: 0, fontSize: 8.5, lineHeight: "13px",
                          background: "rgba(99,102,241,0.13)", color: "#6366f1",
                          borderRadius: 4, padding: "1px 5px", fontWeight: 700,
                          letterSpacing: 0.2, whiteSpace: "nowrap", cursor: "default",
                        }}>
                        checked at upload
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Read-only ghost example rows — always shown, never part of the
                editable data and never imported. They demonstrate the expected
                format for each column. */}
            {sampleRowsFor(cardId, activeTmplTab).map((exRow, xi) => (
              <tr key={`ex-${xi}`} className="select-none" style={{ backgroundColor: "#fafaf9" }}>
                <td
                  className="border px-2 py-1.5 text-center w-10 min-w-10 text-[9px] sticky left-0 z-10 font-semibold"
                  style={{ backgroundColor: "#fafaf9", color: "#a8a29e", borderColor: "#e5e7eb" }}
                  title="Example row — for reference only, never imported"
                >EX</td>
                {cols.map(col => (
                  <td key={col.key} className="border px-2 py-1.5 text-xs italic"
                    style={{ width: col.w, minWidth: col.w, maxWidth: col.w, borderColor: "#e5e7eb", color: "#9ca3af" }}
                    title="Example row — for reference only, never imported">
                    <span className="truncate block">{exRow[col.key] ?? ""}</span>
                  </td>
                ))}
              </tr>
            ))}
            {activeTmplRows.map((row, ri) => {
              // Compute row-level selection for template mode
              const _tAci = selAnchor ? cols.findIndex(c => c.key === selAnchor.col) : -1;
              const _tBci = selActive ? cols.findIndex(c => c.key === selActive.col) : _tAci;
              const _tRlo = selAnchor ? Math.min(selAnchor.row, selActive?.row ?? selAnchor.row) : -1;
              const _tRhi = selAnchor ? Math.max(selAnchor.row, selActive?.row ?? selAnchor.row) : -1;
              const _tClo = Math.min(_tAci, _tBci);
              const _tChi = Math.max(_tAci, _tBci);
              const isTmplRowSel = selAnchor !== null && ri >= _tRlo && ri <= _tRhi
                && _tClo === 0 && _tChi === cols.length - 1;
              return (
              <tr key={ri} data-row-idx={ri}
                style={{ backgroundColor: ri % 2 === 0 ? "#ffffff" : "#f9fafb" }}
                onMouseEnter={() => {
                  if (isDraggingRef.current && dragFillRef.current && dragFillRef.current.toRow !== ri) {
                    const next = { ...dragFillRef.current, toRow: ri };
                    dragFillRef.current = next;
                    setDragFill(next);
                  }
                }}>
                <td
                  className={`border px-2 py-1.5 text-center w-10 min-w-10 text-[10px] sticky left-0 z-10 cursor-pointer select-none font-medium ${
                    isTmplRowSel ? "bg-indigo-500 text-white border-indigo-500" : ""
                  }`}
                  style={isTmplRowSel ? {} : { backgroundColor: ri % 2 === 0 ? "#ffffff" : "#f9fafb", color: "#9ca3af", borderColor: "#e5e7eb" }}
                  title={isTmplRowSel ? "Click to deselect row" : "Click to select row"}
                  onClick={() => {
                    if (isTmplRowSel) {
                      setSelAnchor(null); setSelActive(null); setEditing(null);
                    } else {
                      if (!cols.length) return;
                      setSelAnchor({ row: ri, col: cols[0].key });
                      setSelActive({ row: ri, col: cols[cols.length - 1].key });
                      setEditing(null);
                    }
                  }}
                >{ri + 1}</td>
                {cols.map(col => {
                  const inDragFill = !!(
                    dragFill &&
                    dragFill.colKey === col.key &&
                    ri >= Math.min(dragFill.srcRow, dragFill.toRow) &&
                    ri <= Math.max(dragFill.srcRow, dragFill.toRow)
                  );
                  // Range selection rectangle for template mode
                  const tmplColIdx = cols.findIndex(c => c.key === col.key);
                  const tmplAnchorCi = selAnchor ? cols.findIndex(c => c.key === selAnchor.col) : -1;
                  const tmplActiveCi = selActive ? cols.findIndex(c => c.key === selActive.col) : tmplAnchorCi;
                  const tmplActiveRi = selActive?.row ?? selAnchor?.row ?? -1;
                  const tmplRMin = selAnchor ? Math.min(selAnchor.row, tmplActiveRi) : -1;
                  const tmplRMax = selAnchor ? Math.max(selAnchor.row, tmplActiveRi) : -1;
                  const tmplCMin = Math.min(tmplAnchorCi, tmplActiveCi);
                  const tmplCMax = Math.max(tmplAnchorCi, tmplActiveCi);
                  const isTmplSelected = selAnchor !== null && ri >= tmplRMin && ri <= tmplRMax && tmplColIdx >= tmplCMin && tmplColIdx <= tmplCMax;
                  return (
                    <TemplateCell key={col.key} value={row[col.key] ?? ""} col={enrichCol(col)}
                      extraErr={dbCellErr(col, row[col.key] ?? "")}
                      editing={editing?.row === ri && editing?.col === col.key}
                      inDragFill={inDragFill}
                      isSelected={isTmplSelected}
                      isRowSel={isTmplRowSel}
                      onEdit={() => { setEditing({ row: ri, col: col.key }); setSelAnchor({ row: ri, col: col.key }); setSelActive({ row: ri, col: col.key }); }}
                      onShiftClick={() => {
                        // Extend row selection to this row (keep first col → last col span)
                        if (!cols.length) return;
                        if (!selAnchor) {
                          setSelAnchor({ row: ri, col: cols[0].key });
                        } else {
                          setSelAnchor(prev => prev ? { ...prev, col: cols[0].key } : { row: ri, col: cols[0].key });
                        }
                        setSelActive({ row: ri, col: cols[cols.length - 1].key });
                      }}
                      onDoubleClick={() => {
                        setEditing({ row: ri, col: col.key });
                        setSelAnchor({ row: ri, col: col.key });
                        setSelActive({ row: ri, col: col.key });
                      }}
                      onCommit={val => {
                        // Canonicalize on COMMIT only (blur/Enter) — fixed-option
                        // variants + ticket-ID drift snap to their exact form.
                        // onLiveChange stays raw so typing isn't fought mid-word.
                        const cv = canonCell(col, val);
                        setTmplData(prev => ({
                          ...prev,
                          [activeTmplTab]: (prev[activeTmplTab] ?? []).map((r, i) => i === ri ? { ...r, [col.key]: cv } : r),
                        }));
                        setEditing(null);
                        // Re-run the batch ID check when the ID column is edited
                        // manually (typed character-by-character), so red highlights
                        // appear without needing a paste or submit.
                        if (isTicketRefCol(col.key)) tmplPasteIdCheckRef.current?.();
                      }}
                      onLiveChange={val => {
                        setTmplData(prev => ({
                          ...prev,
                          [activeTmplTab]: (prev[activeTmplTab] ?? []).map((r, i) => i === ri ? { ...r, [col.key]: val } : r),
                        }));
                      }}
                      onFillHandleDown={() => {
                        const d = { tabId: activeTmplTab, colKey: col.key, srcRow: ri, val: row[col.key] ?? "", toRow: ri };
                        dragFillRef.current = d;
                        isDraggingRef.current = true;
                        setDragFill(d);
                      }}
                      onEnterCell={() => {
                        if (isDraggingRef.current && dragFillRef.current && dragFillRef.current.toRow !== ri) {
                          const next = { ...dragFillRef.current, toRow: ri };
                          dragFillRef.current = next;
                          setDragFill(next);
                        }
                        if (isDragSelectingRef.current) {
                          didDragSelectRef.current = true;
                          setSelActive({ row: ri, col: col.key });
                        }
                      }}
                      onCellDown={() => {
                        if (!cols.length) return;
                        isDragSelectingRef.current = true;
                        didDragSelectRef.current = false;
                        // Select just this cell on single click
                        setSelAnchor({ row: ri, col: col.key });
                        setSelActive({ row: ri, col: col.key });
                        setEditing(null);
                      }}
                      onCellUp={() => { /* single click = row selection; double-click opens editor */ }}
                    />
                  );
                })}
              </tr>
            ); })}
            <tr>
              <td colSpan={cols.length + 1} className="px-4 py-2" style={{ borderTop: "1px dashed #e5e7eb" }}>
                <button onClick={() => setTmplData(prev => ({ ...prev, [activeTmplTab]: [...(prev[activeTmplTab] ?? []), empty(cols)] }))}
                  className="text-xs hover:text-indigo-500 flex items-center gap-1 transition" style={{ color: "#d1d5db" }}>
                  <Plus className="w-3.5 h-3.5" /> Click to add a row…
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {reviewedFileDialog}
      {gridPeek && <ImportGridPeek {...gridPeek} onClose={() => setGridPeek(null)} />}
      <ImportWizardOverlay
        open={wizardActive}
        steps={wizardSteps}
        currentStep={wizardStep}
        title={wizardTitle}
        subtitle={wizardSubtitle}
        onBack={wizardOnBack}
        locked={isSubmitting}
        contentMaxWidth={wizardMaxW}
      >
        {colAuditContent}
        {mappingConfirmOverlay}
        {validationReviewOverlay}
        {groupAclOverlay}
        {recordGroupsOverlay}
        {busyContent}
        {runContent}
      </ImportWizardOverlay>
    </div>
  );
}
