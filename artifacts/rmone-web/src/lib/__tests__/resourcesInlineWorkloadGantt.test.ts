import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const resourcesSource = readFileSync(
  new URL("../../pages/resources.tsx", import.meta.url),
  "utf8",
);
const timelineGridSource = readFileSync(
  new URL("../../components/ResourcesTimelineGrid.tsx", import.meta.url),
  "utf8",
);
const projectDetailSource = readFileSync(
  new URL("../../pages/project-detail.tsx", import.meta.url),
  "utf8",
);
const rdsProviderSource = readFileSync(
  new URL("../../../../api-server/src/lib/rds-provider.ts", import.meta.url),
  "utf8",
);
const utilGridSource = readFileSync(
  new URL("../utilGrid.ts", import.meta.url),
  "utf8",
);

// Account reactivation is an account-management operation, not a timeline
// hours edit. A user with editData but without manageStaff must never receive
// the Reactivate action merely because the weekly grid is editable.
assert.match(
  timelineGridSource,
  /canEditProjectWeeks = false, canManageStaff = false/,
  "Timeline keeps manageStaff separate from the project-week edit capability.",
);
assert.match(
  timelineGridSource,
  /canManageStaff=\{canManageStaff\}/,
  "Disabled person treatment uses manageStaff, never canEditProjectWeeks.",
);
const timelineInstances = resourcesSource.match(/<ResourcesTimelineGrid[\s\S]*?\/>/g) ?? [];
assert.ok(timelineInstances.length >= 3, "Resources renders all primary timeline variants.");
assert.ok(
  timelineInstances.every(instance => /canManageStaff=\{canManageStaff\}/.test(instance)),
  "Every Resources timeline variant forwards the resolved manageStaff capability.",
);

// One top-level workload control drives Capacity and Projects together.
// Weekly is the default and aligns exact Monday cells for editing.
assert.match(
  resourcesSource,
  /const \[capView, setCapView\] = useState<"weekly" \| "monthly">\("weekly"\)/,
  "The shared workload view initializes to Weekly.",
);
assert.match(
  resourcesSource,
  /aria-label="Workload timeline view"[\s\S]*?\(\["weekly", "monthly"\] as const\)\.map/,
  "Capacity and Projects are controlled by one top-level Weekly/Monthly switch.",
);
assert.doesNotMatch(
  resourcesSource,
  /aria-label="Project timeline view"/,
  "Projects does not render a duplicate Weekly/Monthly control.",
);
assert.match(
  resourcesSource,
  /capView === "weekly" \? \([\s\S]*?<ProjectGanttWeekCell[\s\S]*?onSaveProjectWeek=\{onSaveProjectWeek\}/,
  "Weekly mode renders aligned project-week cells through the serialized weekly-save path.",
);
assert.match(
  resourcesSource,
  /const \[activeProjectWeekEdit, setActiveProjectWeekEdit\] = useState<string \| null>\(null\)/,
  "The person popup owns one active project-week editor.",
);
assert.match(
  resourcesSource,
  /editing=\{activeProjectWeekEdit === cellKey\}[\s\S]*?nextEditing \? cellKey : current === cellKey \? null : current/,
  "Opening another week replaces the prior editor, while an older save can only close its own cell.",
);
assert.match(
  resourcesSource,
  /const completeProjectEntries = \(pid: string\): ActiveAllocationProxy\[\] => \{[\s\S]*?allAllocs\.filter\(a => a\.projectId === pid\)/,
  "A selected project uses the complete person-and-project allocation set, not a single source row.",
);
assert.match(
  resourcesSource,
  /Array\.from\(new Set\(allocations\.map\(a => a\.projectId\)\)\)\.map\(pid => \{[\s\S]*?const entries = completeProjectEntries\(pid\)/,
  "Allocation mode renders one authoritative in-bar editor per project even when its source has multiple rows.",
);
const weekCellStart = resourcesSource.indexOf("function ProjectGanttWeekCell");
const weekCellEnd = resourcesSource.indexOf("/* ── Staff modal", weekCellStart);
const weekCellSource = resourcesSource.slice(weekCellStart, weekCellEnd);
assert.doesNotMatch(
  resourcesSource,
  /<ProjectAllocGanttModal\s+key=\{selectedProjectId\}\s+inlineGantt/,
  "There is no below-Gantt weekly editor for the selected project.",
);
assert.match(
  resourcesSource,
  /left: `calc\(\$\{\(i \/ projectTimelineCount\) \* 100\}% \+ 1px\)`[\s\S]*?width: `calc\(\$\{100 \/ projectTimelineCount\}% - 2px\)`/,
  "Weekly project cells share the same aligned timeline columns.",
);
assert.match(
  weekCellSource,
  /week: localIsoDay\(weekStart\)/,
  "Each edit preserves the exact Monday-starting week identity.",
);
assert.match(
  resourcesSource,
  /capView === "weekly"\s*\?\s*weeklyCap\.map\(week => \(\{ start: week\.ws/,
  "Weekly project headers use the same Monday source as the editable cells.",
);
assert.match(
  resourcesSource,
  /const WEEKLY_VISIBLE_COLUMNS = 8;[\s\S]*?projectTimelineCount \/ WEEKLY_VISIBLE_COLUMNS/,
  "Weekly Projects intentionally renders eight readable columns at a time.",
);
assert.match(
  resourcesSource,
  /overflowX: capView === "weekly" \? "auto" : "hidden"[\s\S]*?width: projectTimelineWidth/,
  "The wider Weekly project timeline scrolls horizontally without moving project labels.",
);
assert.match(
  resourcesSource,
  /const todayWeekIndex = weeklyCap\.findIndex\(week => week\.ws === mondayOf\(Date\.now\(\)\)\);[\s\S]*?timeline\.scrollLeft = Math\.max\(0, Math\.min\(targetLeft, timeline\.scrollWidth - timeline\.clientWidth\)\)/,
  "Opening a weekly workload popup scrolls its eight-column timeline to the current Monday week.",
);
assert.match(
  weekCellSource,
  /\{editing \? \(\s*<input[\s\S]*?type="number"/,
  "Only the one project-week cell clicked by the user becomes an input.",
);
assert.doesNotMatch(
  resourcesSource,
  /selectedProjectId === row\.pid/,
  "Clicking a monthly bar no longer opens several weekly inputs inside that monthly bar.",
);
assert.match(
  resourcesSource,
  /The Workload view above changes both Capacity and Projects\. Weekly lets you click and edit one Monday cell at a time/,
  "The Gantt explains that the shared top control changes both workload sections.",
);
assert.match(
  resourcesSource,
  /initialProjectId=\{initialProjectId\}[\s\S]*?onSaveProjectWeek=\{onSaveProjectWeek\}/,
  "Card-level project shortcuts open the same person popup with the shared weekly editor available.",
);
assert.match(
  weekCellSource,
  /setError\(`Use 0–\$\{MAX_WEEK_HOURS\}`\)/,
  "Values over 168 remain visible but receive an explicit inline validation message.",
);
const commitStart = weekCellSource.indexOf("const commit = async");
const invalidDraftGuard = weekCellSource.indexOf("if (nextHours === null || nextHours < 0 || nextHours > MAX_WEEK_HOURS)", commitStart);
const weeklySave = weekCellSource.indexOf("await onSaveProjectWeek", commitStart);
assert.ok(
  invalidDraftGuard >= 0 && weeklySave > invalidDraftGuard,
  "A blank weekly input is rejected before the in-bar editor can save it as zero.",
);
assert.match(
  weekCellSource,
  /const previousSavedHours = savedHours;[\s\S]*?setSavedHours\(nextHours\);[\s\S]*?onEditingChange\(false\);[\s\S]*?await onSaveProjectWeek/,
  "Popup project-week cells immediately retain the entered hours while the verified save runs.",
);
assert.match(
  weekCellSource,
  /onAccepted: \(\) => \{[\s\S]*?setSavedHours\(current => current === nextHours \? null : current\)/,
  "Popup project-week cells hand their local value to the shared accepted overlay instead of masking later live values.",
);
assert.match(
  weekCellSource,
  /catch \(e\) \{[\s\S]*?setSavedHours\(previousSavedHours\);[\s\S]*?setError/,
  "A failed popup project-week save restores the pre-save value and exposes its error.",
);
assert.doesNotMatch(
  weekCellSource,
  /\{saving \? <Loader2/,
  "A pending popup save never replaces the entered hours with a loader.",
);
assert.match(
  timelineGridSource,
  /onAccepted: \(\) => \{[\s\S]*?setOptimisticWeekOverrides[\s\S]*?delete next\[key\]/,
  "The Timeline hands off its local aggregate delta as soon as the shared page overlay is accepted, preventing double-counting.",
);
assert.match(
  timelineGridSource,
  /const generation = \+\+optimisticWeekGenerationRef\.current[\s\S]*?current\[key\]\?\.generation !== generation/,
  "Older Timeline save completions cannot remove a newer local edit for the same person/project/week.",
);
assert.match(
  resourcesSource,
  /onAccepted: accepted => \{[\s\S]*?setAcceptedWeekOverrides[\s\S]*?edit\.onAccepted\?\.\(\)/,
  "Resources installs the cross-view accepted-value overlay before releasing the initiating editor's local projection.",
);
assert.doesNotMatch(
  resourcesSource,
  /const \[weekOverrides, setWeekOverrides\]/,
  "Legacy Resources popup editors do not retain successful weekly overrides after the shared page overlay takes ownership.",
);
assert.match(
  resourcesSource,
  /function InlineGanttWeeklyBar[\s\S]*?onAccepted: \(\) => \{[\s\S]*?if \(current\[weekStart\] !== draft\) return current;[\s\S]*?delete next\[weekStart\][\s\S]*?if \(handedOff\)[\s\S]*?current\[weekStart\] === undefined[\s\S]*?\[weekStart\]: draft/,
  "The inline Gantt editor releases only its accepted draft and restores it if later verification fails.",
);
assert.match(
  resourcesSource,
  /function ProjectAllocGanttModal[\s\S]*?onAccepted: \(\) => \{[\s\S]*?current\?\.start === acceptedEdit\.start && current\.draft === acceptedEdit\.draft[\s\S]*?if \(handedOff\)[\s\S]*?current \?\? acceptedEdit/,
  "The legacy project-allocation editor also hands its matching draft to the page overlay without losing failure rollback.",
);
assert.match(
  resourcesSource,
  /if \(hours === acceptedEdit\.original\) \{[\s\S]*?return;[\s\S]*?weekCommitRef\.current = true;[\s\S]*?finally \{[\s\S]*?weekCommitRef\.current = false;/,
  "No-op and successful legacy modal edits cannot leave the weekly commit guard locked.",
);
const liveCellDetailStart = resourcesSource.indexOf("function CellDetailModal");
const liveCellDetailEnd = resourcesSource.indexOf("function WeeklyHoursModal", liveCellDetailStart);
const liveCellDetailSource = resourcesSource.slice(liveCellDetailStart, liveCellDetailEnd);
assert.match(
  resourcesSource,
  /const fmtH = \(h: number\) => fmtHours\(h\)/,
  "Manager popup weekly values use the shared two-decimal hours formatter, preserving values such as 1.75.",
);
assert.match(
  resourcesSource,
  /Math\.round\(\(hrs \+ Number\.EPSILON\) \* 100\) \/ 100/,
  "Manager popup allocation buckets preserve hundredths instead of quantizing each project-week to one decimal.",
);
assert.match(
  liveCellDetailSource,
  /\{fmtHours\(hours\)\}h booked/,
  "The Manager popup header uses the same hours precision as its project-week cells.",
);
assert.match(
  utilGridSource,
  /const total = Math\.round\(\(Math\.max\(0, weeklyHours\) \+ Number\.EPSILON\) \* 100\) \/ 100/,
  "The selected-week day split preserves a saved 1.75-hour weekly total instead of quantizing it to 1.8.",
);
assert.match(
  rdsProviderSource,
  /actualHrs !== undefined && actualHrs > 0[\s\S]*?Math\.round\(\(actualHrs \+ Number\.EPSILON\) \* 100\) \/ 100/,
  "The utilization API preserves real weekly hours to hundredths instead of rounding 1.75 to 2.",
);
assert.match(
  liveCellDetailSource,
  /onAccepted: \(\) => \{[\s\S]*?if \(prevHours\[key\] !== nextHours\) return prevHours;[\s\S]*?delete next\[key\]/,
  "The utilization cell-detail editor releases only its matching local value when the page overlay accepts it.",
);
assert.match(
  resourcesSource,
  /const liveCellModal = cellModal[\s\S]*?utilRows\.find[\s\S]*?buildCellModalState\([\s\S]*?\{liveCellModal && \([\s\S]*?weeks=\{liveCellModal\.weeks\}/,
  "An open utilization cell-detail popup is rebuilt from the latest projected utilization and allocation props.",
);
assert.match(
  resourcesSource,
  /const projectIdsByPerson = new Map<string, Set<string>>\(\)[\s\S]*?addScopedProject\(mid, rec\.ticketId\)[\s\S]*?addScopedProject\(idL, rec\.ticketId\)[\s\S]*?projectIdsByPerson: Object\.fromEntries/,
  "Manager hierarchy rows retain the exact shared record IDs for each subordinate, including people appearing under multiple selected-manager records.",
);
assert.match(
  resourcesSource,
  /const reserved = new Set<string>\(\[mid\]\)[\s\S]*?__managerSectionKey: rowKey[\s\S]*?__managerProjectScope: \[projectId\][\s\S]*?const teammates = rec\.team[\s\S]*?\.filter\(m => m\.id\.trim\(\)\.toLowerCase\(\) !== mid\)[\s\S]*?if \(idL && !reserved\.has\(idL\)\) idsL\.push\(idL\)[\s\S]*?pushSection\(`\$\{rec\.ticketId\} — \$\{rec\.title\}`, idsL, rec\.ticketId\)/,
  "Every Manager record section keeps higher, equal, and lower-role shared teammates, repeating people across records as one-record-scoped rows instead of suppressing them after the first section.",
);
assert.doesNotMatch(
  resourcesSource,
  /const under = rec\.team[\s\S]{0,500}roleRank\(/,
  "Manager team context must not hide shared teammates based on role seniority.",
);
assert.match(
  resourcesSource,
  /const scopeKeys = projectScope\s*\?\s*new Set\(projectScope\.map\([\s\S]*?week\.segs\.filter\(segment => inScope\(segment\.pid\)\)[\s\S]*?allAllocationProjList\.filter\(project => inScope\(project\.pid\)\)[\s\S]*?allAllocationProjectAllocs\.filter\(project => inScope\(project\.projectId\)\)/,
  "Manager cell popups remove every allocation, project row, and editable record outside the selected person's shared hierarchy records, including an empty scope.",
);
assert.match(
  resourcesSource,
  /managerGrid\?\.projectIdsByPerson\[[\s\S]*?String\(userId \|\| \(row as Record<string, unknown>\)\.UserId \|\| ""\)\.trim\(\)\.toLowerCase\(\)[\s\S]*?\]/,
  "The selected Manager grid passes each clicked subordinate's shared-record scope into the common allocation popup.",
);
assert.match(
  resourcesSource,
  /onPersonClick=\{\(name, userId\) => openWeeklyHoursByName\([\s\S]*?managerGrid\?\.projectIdsByPerson\[[\s\S]*?String\(userId \|\| ""\)\.trim\(\)\.toLowerCase\(\)[\s\S]*?projectScope=\{staffListModal\.projectScope\}/,
  "Clicking a name in a selected Manager hierarchy carries that person's shared-record scope into the full workload modal.",
);
assert.match(
  resourcesSource,
  /view === "Manager" && !managerSelectedId[\s\S]*?onPersonClick=\{\(name, userId\) => openWeeklyHoursByName\(name, userId\)\}/,
  "The unselected Manager/Timeline-style directory remains an unrestricted all-project name-click path.",
);
assert.match(
  resourcesSource,
  /const engineWeekByProject = useMemo[\s\S]*?if \(!inScope\(row\.projectId\)\) continue[\s\S]*?const activeProjects = Array\.from\(new Set\(r\.activeProjects\)\)\.filter\(inScope\)[\s\S]*?const allAllocs:[\s\S]*?\.filter\(a => inScope\(a\.projectId\)\)/,
  "The full workload modal applies Manager scope to server-backed week totals and every project/allocation row.",
);
assert.match(
  resourcesSource,
  /if \(!load\) \{[\s\S]*?hasResourceWeekOverrideInWindow\([\s\S]*?qsd,[\s\S]*?qed,[\s\S]*?\)[\s\S]*?currentPct: 0/,
  "The zero-load Staff fallback only applies when the accepted Monday week overlaps the selected quarter.",
);
assert.match(
  resourcesSource,
  /8 weeks at a time · scroll horizontally to see more · click one Monday cell to edit/,
  "Weekly mode tells users that additional weeks are available by horizontal scroll.",
);
const staffModalStart = resourcesSource.indexOf("function StaffUtilModal");
const staffModalEnd = resourcesSource.indexOf("/* ── Cell detail modal", staffModalStart);
const staffModalSource = resourcesSource.slice(staffModalStart, staffModalEnd);
assert.match(
  staffModalSource,
  /type GRow = \{[\s\S]*?module\?: "PMM" \| "OPM" \| "LEM"[\s\S]*?module: entries\.find\(entry => entry\.module\)\?\.module[\s\S]*?Open \$\{pName\(row\.pid\)\} Project Team[\s\S]*?onClose\(\);[\s\S]*?onProjectClick\(row\.pid, row\.module\)/,
  "The person-name workload popup preserves each allocation's module and passes it through its Project Team link.",
);
assert.match(
  resourcesSource,
  /Monthly overview · switch Projects to Weekly to edit hours/,
  "Monthly mode still directs read-only viewers to the Projects Weekly control.",
);
assert.match(
  staffModalSource,
  /Monthly overview · click any month cell to edit that month's total hours/,
  "Monthly mode tells hour editors that month cells edit in place.",
);
assert.match(
  staffModalSource,
  /monthEditable && months\.map\(\(mcell, mi\) =>[\s\S]*?setMonthEdit\(\{ rowKey: row\.key, monthIdx: mi \}\)[\s\S]*?\{visible \? \(/,
  "EVERY Monthly column is a full-height month-editor click target — blank cells outside the bar span and rows without in-window dates included — so clicks never fall through to the row's switch-to-Weekly handler.",
);
assert.match(
  staffModalSource,
  /role="button"[\s\S]*?tabIndex=\{0\}[\s\S]*?aria-label=\{`Edit \$\{pName\(row\.pid\)\} total hours for \$\{mLabel\}`\}[\s\S]*?onKeyDown=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?setMonthEdit\(\{ rowKey: row\.key, monthIdx: mi \}\)/,
  "Month cells are keyboard-operable — Enter/Space opens the month editor and never bubbles into the row's switch-to-Weekly handler.",
);
assert.match(
  staffModalSource,
  /background: "#FF5757", zIndex: 5, pointerEvents: "none"/,
  "The TODAY marker is click-through so it never swallows a cell edit underneath it.",
);
assert.match(
  timelineGridSource,
  /const scrollTimeline = \(direction: -1 \| 1\)[\s\S]*?const page = timelineCW \* 4;[\s\S]*?requestAnimationFrame\(animate\)[\s\S]*?aria-label="Show earlier weeks"[\s\S]*?aria-label="Show later weeks"/,
  "The main Resources timeline provides visible left/right controls with smooth, four-week animation.",
);
assert.match(
  timelineGridSource,
  /const atStart = timeline\.scrollLeft <= 4;[\s\S]*?const atEnd = timeline\.scrollLeft \+ timeline\.clientWidth >= timeline\.scrollWidth - 4;[\s\S]*?onQuarterNavigate\?\.\(direction\)/,
  "Timeline arrows continue to the adjacent quarter when the current window reaches either edge.",
);
assert.match(
  timelineGridSource,
  /onProjectClick\(proj\.pid, proj\.module\)[\s\S]*?>\s*Open record <ExternalLink/,
  "Expanded project rows in the main Resources timeline provide a direct, module-aware project link beneath the project name.",
);
assert.match(
  timelineGridSource,
  /pName\?: \(pid: string\) => string;[\s\S]*?onProjectClick\?: \(projectId: string, module\?: "PMM" \| "OPM" \| "LEM"\) => void;/,
  "The main Resources timeline accepts a project navigation callback without changing its existing row interactions.",
);
assert.match(
  resourcesSource,
  /function shiftQuarterLabel\(label: string, direction: -1 \| 1\)[\s\S]*?start\.setMonth\(start\.getMonth\(\) \+ direction \* 3\)[\s\S]*?onQuarterNavigate=\{navigateTimelineQuarter\}/,
  "Resources can resolve and load quarters beyond the initial picker range.",
);
assert.match(
  resourcesSource,
  /COMPACT UTILIZATION STRIP[\s\S]*?width: 18, height: 18[\s\S]*?upcomingLeave\.length > 0[\s\S]*?conflictByRow\.size > 0/,
  "The workload popup presents larger utilization signals alongside compact PTO and leave-conflict details.",
);
assert.doesNotMatch(
  resourcesSource,
  /Object\.entries\(PHASE_COLORS\)/,
  "The popup no longer spends vertical space on an allocation-color legend.",
);
assert.match(
  resourcesSource,
  /const projectHeaderH = capView === "weekly" \? 46 : 36;[\s\S]*?const utilization = capView === "weekly" \? weeklyCap\[i\] : monthlyCap\[i\];[\s\S]*?\{pct\}%/,
  "Each project timeline date displays its matching utilization percentage directly below the label.",
);
assert.doesNotMatch(
  resourcesSource,
  />Weekly Workload</,
  "The separate Weekly Workload block is removed to give Projects more vertical space.",
);
assert.match(
  timelineGridSource,
  /setOptimisticWeekOverrides\(current => \(\{[\s\S]*?hours: parsed,[\s\S]*?\}\)\);[\s\S]*?setWeekEdit\(null\);[\s\S]*?await onSaveProjectWeek/,
  "Project-week edits paint their new value immediately before server verification finishes.",
);
assert.match(
  timelineGridSource,
  /catch \(e\) \{[\s\S]*?setOptimisticWeekOverrides\(current => \{[\s\S]*?delete next\[key\]/,
  "A failed optimistic hour edit removes its local projection and exposes the save error.",
);
assert.doesNotMatch(
  timelineGridSource,
  /\{savingThis \? <Loader2/,
  "A pending save keeps the entered hour visible instead of replacing it with a rotating loader.",
);
assert.match(
  resourcesSource,
  /const rawAllocEntries = [\s\S]*?const allocEntries = rawAllocEntries\.filter\([\s\S]*?Number\.isFinite\(start\)[\s\S]*?end >= start/,
  "Missing or zero allocation dates are excluded before they can create a 1970 workload timeline.",
);
assert.match(
  resourcesSource,
  /splitTotalHoursByWeights\(totalHours, pctSum > 0 \? ids\.map\(item => item\.pct\) : ids\.map\(\(\) => 1\)\)[\s\S]*?hrs: splitHours\[index\]/,
  "Grid-fallback project segments retain the clicked cell's exact weekly total after tenth-hour rounding.",
);
assert.match(
  resourcesSource,
  /const selectedAllocationProjectIds = new Set[\s\S]*?const selectedWeekCoversClickedProjects = clickedProjectIds\.size === 0[\s\S]*?const selectedWeekMatchesAllocationTotal[\s\S]*?const useAllocationDetails = Boolean\(scopeKeys\) \|\| gridWeeks\.length === 0[\s\S]*?selectedWeekMatchesAllocationTotal && selectedWeekCoversClickedProjects[\s\S]*?const weeks = useAllocationDetails \? allocationWeeks : gridWeeks/,
  "Normal allocation details replace the clicked cell only when totals and project identities reconcile; an explicit Manager record scope uses its filtered allocation truth.",
);
assert.doesNotMatch(
  resourcesSource,
  /selectedWeekHasProjects \|\| selectedWeekMatchesAllocationTotal/,
  "One overlapping stale project can never replace a multi-project clicked cell.",
);
assert.match(
  resourcesSource,
  /projectName: entry\.projectName\?\.trim\(\) \|\| pName\(projectId\)[\s\S]*?projectAllocs: \[\.\.\.projectAllocsById\.values\(\)\]/,
  "The hours popup receives the same canonical project names and ticket IDs as the person-name popup.",
);
assert.match(
  resourcesSource,
  /const canonicalizeProjectRefs = [\s\S]*?canonicalizeResourcePopupProjectRefs\(refs, allAllocationProjectAllocs, pName\)[\s\S]*?const ids = canonicalizeProjectRefs\(gridCell\?\.projectIds \?\? \[\]\)/,
  "Compact utilization aliases are reconciled against the person's canonical allocation TicketIds before popup rows are built.",
);
assert.match(
  timelineGridSource,
  /projectScopeByUserId\?\.\[userId\.toLowerCase\(\)\][\s\S]*?scopedSet\.has\(\(entry\.projectId \|\| ""\)\.trim\(\)\.toLowerCase\(\)\)[\s\S]*?const cells = scopedSet[\s\S]*?hoursWinFilter\(inWeek\)/,
  "Manager hierarchy cells and expanded project rows are calculated only from records shared with the selected manager.",
);
assert.match(
  timelineGridSource,
  /const rowScope = \(r as Record<string, unknown>\)\.__managerProjectScope[\s\S]*?const rowKeys = new Set\([\s\S]*?rowKeys\.has\(p\.sectionKey\)[\s\S]*?const uniquePeople = new Map<string, number>\(\)[\s\S]*?const pctByPersonPeriod = new Map<string, number>\(\)/,
  "Repeated Manager project rows use exact section identities while headline people and utilization metrics remain person-deduplicated.",
);
assert.match(
  resourcesSource,
  /\{proj\.pid \|\| "—"\}[\s\S]*?\{proj\.name\}/,
  "Hours-popup project rows show the real ticket ID above the project name without a generic Project ID label.",
);
assert.match(
  timelineGridSource,
  /onCellClick\(person\.name, wins\[i\]\.key, cell, person\.row, person\.userId, person\.staffRow\)/,
  "A clicked utilization cell carries the resolved timeline staff record into the detail popup.",
);
assert.match(
  resourcesSource,
  /Case 3: User switches to any Resources view[\s\S]*?allocationMarkerTimestamp\(localStorage\.getItem\("rmone:allocationTs"\)\)[\s\S]*?void refetchAllocationViewsFresh\(\)/,
  "Every Resources view reconciles a missed allocation-save marker when the user returns to it.",
);
assert.doesNotMatch(
  resourcesSource,
  /if \(view !== "Timeline" && view !== "Staff"\) return;/,
  "Allocation refresh recovery is not limited to the Timeline and Staff tabs.",
);
assert.match(
  projectDetailSource,
  /const allocationMarkerReconciledByProject = new Map<string, string>\(\);[\s\S]*?const marker = localStorage\.getItem\("rmone:allocationTs"\);[\s\S]*?allocationMarkerReconciledByProject\.get\(id\) === marker[\s\S]*?const refreshed = await refreshAfterMutation\(true, true\)[\s\S]*?if \(refreshed\) \{[\s\S]*?allocationMarkerReconciledByProject\.set\(id, marker\)/,
  "Project Team reconciles a missed allocation-save marker when the record opens after a Resources edit.",
);
assert.match(
  projectDetailSource,
  /return true;[\s\S]*?catch \(e: unknown\)[\s\S]*?return false;[\s\S]*?return await loadProject\(true, fast, fetchTeam\)[\s\S]*?if \(attempt < 2\)/,
  "A failed fresh Project Team reconciliation remains retryable instead of falsely consuming the allocation marker.",
);
const cellDetailStart = resourcesSource.indexOf("function CellDetailModal");
const cellDetailEnd = resourcesSource.indexOf("/* ── Weekly Hours modal", cellDetailStart);
const cellDetailSource = resourcesSource.slice(cellDetailStart, cellDetailEnd);
assert.match(
  cellDetailSource,
  /const \[showSchedule, setShowSchedule\] = useState\(true\)[\s\S]*?selectedWeekDays\(selectedWeekStart, br\.nonWorkingDays, br\.holidayDates\)[\s\S]*?Week of \{selectedRangeLabel\}[\s\S]*?selectedDays\.map/,
  "A clicked workload cell opens directly on the multi-week allocation schedule.",
);
assert.match(
  cellDetailSource,
  /const selectedWeekCellShadow =[\s\S]*?const isSel = page \* VIS \+ i === selIdxAll[\s\S]*?boxShadow: isSel \? selectedWeekCellShadow : undefined/,
  "The clicked week remains visibly highlighted in the full schedule without replacing project phase colors.",
);
assert.match(
  cellDetailSource,
  /Weekly allocation only[\s\S]*?day columns are a read-only display split[\s\S]*?splitWeeklyHoursAcrossDays\(proj\.selectedHours, selectedDays\)[\s\S]*?Daily total/,
  "The selected-week view clearly identifies day columns as a read-only display of weekly allocation data.",
);
assert.match(
  cellDetailSource,
  /selectedWeekHasWorkingDays[\s\S]*?this week has no working days[\s\S]*?not assigned to individual days because every day is non-working or a company holiday/,
  "An all-non-working selected week exposes its undistributed weekly hours instead of inventing day values.",
);
assert.match(
  cellDetailSource,
  /Weekly total[\s\S]*?\{fmtH\(proj\.selectedHours\)\}h[\s\S]*?<Pencil[\s\S]*?Edit week/,
  "The selected-week drill-down exposes an explicit Edit week action on the weekly total beside the read-only day values.",
);
assert.match(
  cellDetailSource,
  /onClick=\{\(\) => setShowSchedule\(value => !value\)\}[\s\S]*?View full allocation schedule/,
  "The broader multi-week allocation schedule remains available through an explicit action.",
);
assert.match(
  cellDetailSource,
  /const \[editingCell, setEditingCell\][\s\S]*?const \[editedHours, setEditedHours\][\s\S]*?const commitCellEdit = async/,
  "The clicked-cell popup owns a single direct editor with local optimistic hours.",
);
assert.match(
  cellDetailSource,
  /parseWeeklyHoursDraft\(edit\.draft\)[\s\S]*?nextHours > MAX_WEEK_HOURS[\s\S]*?setEditError\(`Use 0–\$\{MAX_WEEK_HOURS\} hours`\)/,
  "Cell-detail edits reject invalid and over-168 weekly hours before saving.",
);
assert.match(
  cellDetailSource,
  /onSaveProjectWeeks\?: \(edit: ResourceProjectWeeksEdit\) => Promise<void>;[\s\S]*?createWeeklyCellSaveCoalescer\(onSaveProjectWeeks\)[\s\S]*?await coalescedSaveProjectWeek/,
  "The cell-detail popup receives the atomic multi-week saver and coalesces rapid inline weekly edits.",
);
assert.match(
  cellDetailSource,
  /setEditedHours\(prevHours => \(\{ \.\.\.prevHours, \[key\]: nextHours \}\)\);[\s\S]*?setEditingCell\(null\);[\s\S]*?await coalescedSaveProjectWeek/,
  "Cell-detail edits display their entered number immediately while the verified bulk save runs.",
);
assert.match(
  cellDetailSource,
  /const \[savingCellKeys, setSavingCellKeys\] = useState<Set<string>>\(\(\) => new Set\(\)\);[\s\S]*?const saving = savingCellKeys\.has\(key\);/,
  "Cell-detail saving state tracks every concurrent project/week cell instead of one global in-flight key.",
);
assert.match(
  cellDetailSource,
  /catch \(e\) \{[\s\S]*?if \(previous === undefined\) delete next\[key\];[\s\S]*?setEditErrors\(current => \(\{ \.\.\.current, \[key\]: message \}\)\);[\s\S]*?setEditingCell\(current => current \?\? edit\);/,
  "A failed folded cell save restores its prior hours and leaves a visible error on that exact project/week cell.",
);
assert.match(
  resourcesSource,
  /<CellDetailModal[\s\S]*?onSaveProjectWeek=\{saveResourceProjectWeek\}[\s\S]*?onSaveProjectWeeks=\{saveResourceProjectWeeks\}/,
  "Resources passes the shared atomic weekPatches saver into the utilization cell-detail popup.",
);
assert.match(
  resourcesSource,
  /const saveResourceProjectWeek = useCallback[\s\S]*?await runFastWeeklyHoursSave\([\s\S]*?weekPatch:[\s\S]*?onAccepted:[\s\S]*?onVerified:[\s\S]*?void refetchAllocationViewsFresh\(\)/,
  "Single-week Timeline and Manager edits release as soon as the POST is accepted while verification and refresh continue in the background.",
);
assert.match(
  resourcesSource,
  /const saveResourceProjectWeeks = useCallback[\s\S]*?await runFastWeeklyHoursSave\([\s\S]*?weekPatches:[\s\S]*?onAccepted:[\s\S]*?onVerified:[\s\S]*?void refetchAllocationViewsFresh\(\)/,
  "Bulk/coalesced Timeline and Manager edits use the same accepted-write fast path.",
);
assert.match(
  resourcesSource,
  /warnResourceHoursVerificationFailed[\s\S]*?Hours saved, but the follow-up check failed[\s\S]*?variant: "destructive"/,
  "A post-acceptance verification failure remains loud instead of silently pretending the save is confirmed.",
);
assert.match(
  cellDetailSource,
  /\{proj\.pid \|\| "—"\}[\s\S]*?Open \$\{proj\.name\} record[\s\S]*?onOpenProjectRecord\(proj\.pid, projectModule\)/,
  "The selected-week popup displays every project ID and gives each project a direct record link.",
);
assert.match(
  resourcesSource,
  /const openProjectRecord = \([\s\S]*?const module = hintedModule === "OPM" \? "OPM" : "PMM";[\s\S]*?\?module=\$\{module\}/,
  "Allocation-row record links open only Projects or Opportunities and never route an ambiguous ID to Leads.",
);
assert.match(
  rdsProviderSource,
  /if \(!forcedModule && mod === "PMM" && !fetched\?\.rec\)/,
  "An explicitly selected PMM/OPM module cannot fall back to a same-ID Lead on the server.",
);
assert.match(
  projectDetailSource,
  /if \(requestedModule && snap\.project\.module !== requestedModule\) return undefined;/,
  "A same-ID Lead snapshot is rejected when navigation explicitly requested a Project or Opportunity.",
);
assert.match(
  resourcesSource,
  /const openProjectTeam = \([\s\S]*?moduleHint\?: "PMM" \| "OPM" \| "LEM"[\s\S]*?const module = moduleHint \|\| projectModuleMap\[pid\] \|\| "PMM";[\s\S]*?\?section=team&module=\$\{module\}/,
  "Every Resources Team link carries an explicit module and never falls through to ambiguous Lead auto-detection.",
);
assert.match(
  resourcesSource,
  /module: entry\.module \|\| projectModuleMap\[projectId\]/,
  "The person allocation row carries its own PMM/OPM/LEM identity into the Team link.",
);
assert.doesNotMatch(
  resourcesSource,
  /\?section=team\$\{module \? `&module=/,
  "Resources never conditionally omits the module query parameter.",
);
assert.match(
  cellDetailSource,
  /onClick=\{\(\) => \{ onClose\(\); onOpenProjectRecord\(proj\.pid, projectModule\); \}\}[\s\S]*?title=\{`Open \$\{proj\.name\} record`\}/,
  "Clicking the visible project ID/title opens the Project or Opportunity record itself, not Team or Leads.",
);
assert.match(
  resourcesSource,
  /<ResourcesTimelineGrid[\s\S]*?onProjectClick=\{openProjectTeam\}/,
  "The expanded main Resources timeline sends its project links through the module-aware Team route.",
);
assert.doesNotMatch(resourcesSource, /inlineEditorRef|onProjectGantt|setWorkloadProject|setDrillProjectId/);

console.log("resources-inline-workload-gantt: all assertions passed");
// ── Coalescer identity: lane state (the in-flight save + queued folds) lives
// in the coalescer's closure, so the timeline coalescer must be created
// exactly once, routing the LATEST bulk saver through a ref. Recreating it
// whenever the save callback's identity changes (query refetch identities
// flip during a save's fresh re-reads; utilMode flips on mode switch) forgets
// the in-flight lane, so "folded" cells each POST separately. The browser
// harness proves folding works under a held POST; this guard pins the wiring
// that keeps the lane alive across renders.
assert.match(
  resourcesSource,
  /const coalescedTimelineWeekSave = useMemo\(\s*\(\) => createWeeklyCellSaveCoalescer\(edit => saveResourceProjectWeeksRef\.current\(edit\)\),\s*\[\],\s*\);/,
  "The timeline coalescer must be created once (empty deps) and route the latest bulk saver through a ref.",
);
assert.ok(
  !/createWeeklyCellSaveCoalescer\(saveResourceProjectWeeks\)/.test(resourcesSource),
  "The timeline coalescer must not be identity-coupled to the bulk saver — recreation wipes in-flight fold lanes.",
);
