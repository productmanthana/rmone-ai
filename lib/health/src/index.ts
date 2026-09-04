// SHARED HEALTH SCORING — single source of truth for project health gauges.
//
// IMPORTANT: This file is the ONLY place project health is computed. Both the
// mobile project-detail page (artifacts/rmone-mobile/app/project/[id].tsx) and
// the AI chat backend (artifacts/api-server/src/routes/chat.ts) import from
// here so the score, the failed-check bullets, and the wording all line up
// pixel-for-pixel everywhere the user sees them. Any change to scoring rules
// or check labels MUST happen here, never in a duplicate copy elsewhere.
//
// The function signature mirrors what the mobile page already expected:
//
//   computeHealth(projectData, { lifecycleAssigned, scheduleLastPhaseEnd })
//
// where `projectData` is a normalized record (RMOne field names already
// translated to friendly fields) and the second argument is the lifecycle
// context the caller computes from RMOne's schedule response.

export interface HealthAllocation {
  name: string;
  role: string;
  pct: number;
}

export interface HealthProjectData {
  status: string;
  /** ApproxContractValue — total contract revenue. May be 0 if not set. */
  value: number;
  targetStart: string;
  targetEnd: string;
  actualEnd: string;
  probability: number;
  /** "PMM" | "OPM" | "LEM" | "COM" | "CON" — derived from project ID prefix. */
  module: string;
  allocations: HealthAllocation[];
}

export interface HealthIssue {
  text: string;
  deduction: number;
}

export interface HealthCheck {
  label: string;
  weight: number;
  passed: boolean;
  failText?: string;
  hint?: string;
  displayPts?: number;
}

export interface HealthResult {
  score: number;
  issues: HealthIssue[];
  checks: HealthCheck[];
}

export interface HealthContext {
  lifecycleAssigned?: boolean;
  scheduleLastPhaseEnd?: string;
}

// ── Date helpers (kept in this file so they cannot drift from the scoring) ──

function fmtDayShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function durationMonths(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0;
  const s = new Date(start.length === 10 ? start + "T00:00:00" : start);
  const e = new Date(end.length === 10 ? end + "T00:00:00" : end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  const diff = (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  return Math.round(diff * 10) / 10;
}

export function durationLabel(months: number): string {
  if (months <= 0) return "";
  if (months < 1) return `${Math.round(months * 30)}d`;
  if (months < 12) return months === 1 ? "1 mo" : `${months.toFixed(months % 1 === 0 ? 0 : 1)} mo`;
  const y = Math.floor(months / 12);
  const m = Math.round(months % 12);
  if (m === 0) return y === 1 ? "1 yr" : `${y} yr`;
  return `${y}y ${m}m`;
}

// Build a precise "why Contract Value failed" string — either it's empty/0,
// or it has a non-zero placeholder below the $1,000 minimum threshold.
const cvStateShort = (v: number): string =>
  v === 0
    ? "Contract Value is empty"
    : `Contract Value is $${v.toLocaleString()} (placeholder, below $1,000 minimum)`;

const cvStateHint = (v: number, recordKind: "project" | "opportunity" | "lead"): string => {
  const stateText = v === 0
    ? "is empty"
    : `is $${v.toLocaleString()}, which is below the $1,000 minimum (looks like a placeholder, not a real value)`;
  const purpose = recordKind === "opportunity" ? " so it contributes to pipeline forecasting" : "";
  return `Contract Value ${stateText} on this ${recordKind}. Open the ${recordKind} in RMOne and enter the total contract revenue in the Contract Value field${purpose}. Note: Labor Contract Amount is a separate field for the labor portion of the contract — it is not used as a substitute.`;
};

export function computeHealth(d: HealthProjectData, ctx?: HealthContext): HealthResult {
  const checks: HealthCheck[] = [];
  const mod = d.module;
  const chk = (label: string, weight: number, passed: boolean, failText?: string, hint?: string) =>
    checks.push({ label, weight, passed, failText, hint });

  if (mod === "PMM") {
    // Filter the "0001-01-01" placeholder RMOne uses for empty date fields.
    const targetStartReal = d.targetStart && !d.targetStart.startsWith("0001") ? d.targetStart : "";
    const targetEndReal = d.targetEnd && !d.targetEnd.startsWith("0001") ? d.targetEnd : "";
    const lifecycleAssigned = !!ctx?.lifecycleAssigned;
    const schedEnd = ctx?.scheduleLastPhaseEnd && !ctx.scheduleLastPhaseEnd.startsWith("0001") ? ctx.scheduleLastPhaseEnd : "";
    const hasRealSchedule = lifecycleAssigned && !!schedEnd;
    const projectIsClosed = !!d.status && /complete|closed|finish|cancel|archive|withdrawn|done|closeout/i.test(d.status);

    // Target date checks: the schedule supersedes the baseline target dates once
    // a lifecycle is assigned. Pass these checks (and rename them) whenever a
    // real schedule exists — the schedule's first/last phase ARE the effective
    // start/end; demanding the user also fill the obsolete baseline fields is
    // redundant and confusing.
    if (hasRealSchedule) {
      chk("Schedule defines start date", 15, true);
      chk("Schedule defines end date", 10, true);
    } else {
      chk("Target start date set", 15, !!targetStartReal, "Missing target start date",
        "No lifecycle assigned, so the project's planned start date comes from TargetStartDate. Edit Project Schedule to fill it in, or assign a lifecycle.");
      chk("Target completion date set", 10, !!targetEndReal, "Missing target completion date",
        "No lifecycle assigned, so the project's planned end date comes from TargetCompletionDate. Edit Project Schedule to fill it in, or assign a lifecycle.");
    }

    // Project value — uses ApproxContractValue ONLY (no fallback to
    // LaborContractAmount or other fields, per client direction).
    chk("Contract Value set", 10, !!d.value && d.value >= 1000, cvStateShort(d.value || 0),
      cvStateHint(d.value || 0, "project"));
    chk("Team assigned", 25, d.allocations.length > 0, "No team members assigned",
      "Project has zero allocations. Add team members via the Project Team section so work can be tracked.");
    chk("Team adequately staffed (3+)", 10, d.allocations.length >= 3, "Team appears understaffed",
      `Only ${d.allocations.length} allocated team member${d.allocations.length === 1 ? "" : "s"}. Most projects need at least 3 (PM + 2 contributors) to be considered adequately staffed.`);
    const hasPM = d.allocations.some(a => /project\s*manager|pm\b/i.test(a.role));
    chk("Project Manager assigned", 15, hasPM || d.allocations.length === 0, "No Project Manager assigned",
      "Team has allocations but no one with a Project Manager / PM role. Add one or re-label an existing allocation's role.");
    const overAllocated = d.allocations.filter(a => a.pct > 100);
    chk("No over-allocations", 10, overAllocated.length === 0, `${overAllocated.length} over-allocated`,
      overAllocated.length > 0
        ? `${overAllocated.map(a => a.name || a.role).filter(Boolean).slice(0, 3).join(", ")}${overAllocated.length > 3 ? `, +${overAllocated.length - 3} more` : ""} exceed 100% allocation. Reduce their % on this project (or others) so total allocation ≤ 100%.`
        : undefined);

    // ── Schedule / runway check ──
    // SOURCE-OF-TRUTH RULE: TargetCompletionDate is NEVER compared against
    // the schedule's last DueDate. Targets aren't re-baselined when projects
    // slip in the real world, so doing so produces misleading "behind by X"
    // verdicts on projects that have legitimately renegotiated dates.
    //
    //   1. Closed (any kind) → always credit. Date label = schedule's last
    //      DueDate when a real schedule exists, else target end.
    //   2. Open + has real schedule → check schedule's last DueDate vs TODAY.
    //   3. Open + no schedule, target end in past vs TODAY → overdue.
    //   4. Open + no schedule, target end in future → forward runway from target.
    const todayMs = Date.now();
    const targetMs = targetEndReal ? new Date(targetEndReal).getTime() : 0;
    const schedMs = hasRealSchedule ? new Date(schedEnd).getTime() : 0;

    if (projectIsClosed) {
      const isCancelOrWithdrawn = /cancel|withdrawn/i.test(d.status);
      if (hasRealSchedule) {
        const dateStr = schedEnd ? ` ${fmtDayShort(schedEnd)}` : "";
        const verb = isCancelOrWithdrawn ? d.status : `Completed${dateStr}`;
        chk(`Project ${verb}`, 20, true);
      } else if (!isCancelOrWithdrawn && targetMs > 0 && targetMs < todayMs) {
        const slipMonths = durationMonths(targetEndReal, new Date(todayMs).toISOString());
        chk("Schedule on track", 20, false, `Completed ${durationLabel(slipMonths)} past target completion`,
          `Project status is "${d.status}" but no lifecycle is assigned, so target end (${fmtDayShort(targetEndReal)}) is compared against today (${fmtDayShort(new Date(todayMs).toISOString())}). Target was ${durationLabel(slipMonths)} ago. Either assign a lifecycle so the schedule's last phase becomes the close date, or update TargetCompletionDate to reflect the real close date.`);
      } else {
        const dateStr = targetEndReal ? ` ${fmtDayShort(targetEndReal)}` : "";
        const verb = isCancelOrWithdrawn ? d.status : `Completed${dateStr}`;
        chk(`Project ${verb}`, 20, true);
      }
    } else if (hasRealSchedule) {
      const daysLeft = Math.floor((schedMs - todayMs) / 86400000);
      if (daysLeft < 0) {
        chk("Schedule on track", 20, false, `Last scheduled phase date passed (${Math.abs(daysLeft)} days ago)`,
          `Lifecycle is assigned. Its last phase ended ${fmtDayShort(schedEnd)} (${Math.abs(daysLeft)} days ago) and the project is still open. Close the project, extend the schedule, or push the last phase's due date forward.`);
      } else if (daysLeft < 30) {
        chk("Comfortable runway (30+ days)", 5, false, "Last scheduled phase within 30 days",
          `Lifecycle's last phase ends ${fmtDayShort(schedEnd)} (${daysLeft} days from today). Less than 30 days of runway remaining — confirm closeout work is on track or extend the schedule.`);
      } else {
        chk("Comfortable runway (30+ days)", 5, true);
      }
    } else if (targetMs > 0 && targetMs < todayMs) {
      const slipMonths = durationMonths(targetEndReal, new Date(todayMs).toISOString());
      chk("Schedule on track", 20, false, `${durationLabel(slipMonths)} past target completion`,
        `Project is open and no lifecycle is assigned, so target end (${fmtDayShort(targetEndReal)}) is compared against today (${fmtDayShort(new Date(todayMs).toISOString())}). Target was ${durationLabel(slipMonths)} ago. Update TargetCompletionDate, assign a lifecycle, or close the project.`);
    } else if (targetMs > 0) {
      const daysLeft = Math.floor((targetMs - todayMs) / 86400000);
      if (daysLeft < 30) chk("Comfortable runway (30+ days)", 5, false, "Target completion within 30 days",
        `Target end is ${fmtDayShort(targetEndReal)} (${daysLeft} days from today). Less than 30 days of runway — confirm closeout is on track or push out TargetCompletionDate.`);
      else chk("Comfortable runway (30+ days)", 5, true);
    }
  } else if (mod === "OPM") {
    chk("Opportunity status set", 10, !!d.status, "Missing opportunity status",
      "Opportunity Status is empty. Set a stage (e.g. Identify Opportunity, Bidding, Awarded) so the opportunity can be tracked through the pipeline.");
    chk("Contract Value set", 15, !!d.value && d.value >= 1000, cvStateShort(d.value || 0),
      cvStateHint(d.value || 0, "opportunity"));
    chk("Win probability set", 10, !!d.probability && d.probability > 0, "Win probability not set",
      "Win Probability is 0. Set a realistic win % (e.g. 25%, 50%, 75%) so weighted-pipeline values can be calculated.");
    const lostStatuses = ["lost", "declined", "cancelled"];
    const isLost = !!d.status && lostStatuses.includes(d.status.toLowerCase());
    chk("Opportunity active", 30, !isLost, isLost ? `Opportunity ${d.status}` : undefined,
      isLost ? `Opportunity status is "${d.status}" — counted as a lost opportunity. Reopen it (change status to an active stage) if work is resuming, or leave it as-is to reflect the loss.` : undefined);
  } else if (mod === "LEM") {
    chk("Lead status set", 10, !!d.status, "Missing lead status",
      "Lead status is empty. Set a status (e.g. New, Qualifying, Qualified, Converted) so the lead can be triaged.");
    chk("Contract Value set", 10, !!d.value && d.value >= 1000, cvStateShort(d.value || 0),
      cvStateHint(d.value || 0, "lead"));
    const closedStatuses = ["closed", "cancelled", "dead"];
    const isClosed = !!d.status && closedStatuses.includes(d.status.toLowerCase());
    chk("Lead active", 25, !isClosed, isClosed ? `Lead ${d.status}` : undefined,
      isClosed ? `Lead status is "${d.status}" — no longer active. Reopen it (change status to an active stage) if it should re-enter the pipeline.` : undefined);
  } else if (mod === "COM" || mod === "CON") {
    return { score: -1, issues: [], checks: [] };
  }

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);

  // Largest-remainder rounding so per-check displayed pts sum to exactly 100
  // and (sum of passed displayed pts) === score. Avoids "82 + 19 = 101" and
  // "displayed parts don't add up to total" complaints.
  if (totalWeight > 0 && checks.length > 0) {
    const raw = checks.map(c => (c.weight / totalWeight) * 100);
    const floors = raw.map(v => Math.floor(v));
    const used = floors.reduce((s, v) => s + v, 0);
    const remainder = 100 - used;
    const order = raw
      .map((v, i) => ({ i, frac: v - floors[i] }))
      .sort((a, b) => b.frac - a.frac);
    const pts = floors.slice();
    for (let k = 0; k < remainder; k++) pts[order[k % order.length].i]++;
    checks.forEach((c, i) => { c.displayPts = pts[i]; });
  } else {
    checks.forEach(c => { c.displayPts = 0; });
  }

  const issues: HealthIssue[] = checks.filter(c => !c.passed).map(c => ({
    text: c.failText || c.label, deduction: c.displayPts ?? c.weight,
  }));
  const score = checks.filter(c => c.passed).reduce((s, c) => s + (c.displayPts ?? 0), 0);
  return { score: Math.max(0, Math.min(100, score)), issues, checks };
}
