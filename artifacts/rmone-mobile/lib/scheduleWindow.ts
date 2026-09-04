// Phase-schedule window for team-member dates — the mobile mirror of the web's
// derivePlannerSchedule (rmone-web/src/lib/phaseHours.ts) reduced to the one
// thing member saves need: the dated window (earliest phase start → latest
// phase end).
//
// Product rule (same as the web Add/Edit member flows):
//   • The window applies only when the record's resolved display mode follows
//     a phase schedule ("full" or "schedule-no-grid"). In the no-schedule
//     modes the schedule is hidden from users, so member dates stay free —
//     enforcing an invisible window would reject saves the user can't
//     understand or fix.
//   • A LIVE /task-data fetch is the authoritative source; stale record props
//     never decide. No lifecycle or no dated phases ⇒ dates are free.
//   • Mobile's member flows never show date inputs (hidden-date flows), so
//     out-of-window dates are silently kept inside the window at submit —
//     never surfaced as an error about dates the user can't see (web's
//     hidden-date rule: clamp, don't block).

export type ScheduleWindowState =
  | "loading" // fetch in flight — window unknown, don't clamp yet
  | "off"     // display mode doesn't follow the schedule — dates free
  | "ready"   // dated phases found — start/end hold the window
  | "none"    // no lifecycle assigned or no dated phases — dates free
  | "error";  // fetch failed — window unknown; the server gate is the backstop

export interface ScheduleWindow {
  state: ScheduleWindowState;
  /** YYYY-MM-DD — earliest phase start. Empty unless state === "ready". */
  start: string;
  /** YYYY-MM-DD — latest phase end. Empty unless state === "ready". */
  end: string;
}

export const SCHED_WIN_LOADING: ScheduleWindow = { state: "loading", start: "", end: "" };

/** True when the display mode renders the phase schedule ("full" or
 *  "schedule-no-grid") — the only modes where member dates are bound to it. */
export function displayModeFollowsSchedule(mode: string | null | undefined): boolean {
  return mode === "full" || mode === "schedule-no-grid";
}

/** Parse a schedule date value tolerantly (mirrors the web parseScheduleDate):
 *  Date instances pass through; strings take the leading YYYY-MM-DD as a LOCAL
 *  date (never the timezone-shifting full-ISO parse); the SQL "0001-01-01"
 *  sentinel and unparseable values are null. */
export function parseScheduleDateYmd(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : ymdOf(v);
  const s = String(v).trim();
  if (!s || s.startsWith("0001")) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    // Re-emit via ymdOf so malformed-but-regex-shaped values ("2020-13-45")
    // normalize through Date rollover exactly like the web's toIso(parsed).
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : ymdOf(d);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : ymdOf(d);
}

function ymdOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Derive the dated window from a raw /task-data response (array or {Data}/
 *  {data} envelope). Same semantics as the web derivePlannerSchedule:
 *  no rows ⇒ "none" (no lifecycle); rows but no valid start≤end range ⇒
 *  "none" (no dated phases); otherwise "ready" with min start / max end. */
export function deriveScheduleWindow(raw: unknown): ScheduleWindow {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { Data?: unknown[] })?.Data)
      ? (raw as { Data: unknown[] }).Data
      : Array.isArray((raw as { data?: unknown[] })?.data)
        ? (raw as { data: unknown[] }).data
        : [];
  const named = rows.filter((r) => {
    const t = (r as { Title?: unknown; Alias?: unknown });
    return String(t?.Title ?? t?.Alias ?? "").trim().length > 0;
  });
  if (named.length === 0) return { state: "none", start: "", end: "" };
  let start = "";
  let end = "";
  for (const r of named) {
    const row = r as { StartDate?: unknown; DueDate?: unknown; EndDate?: unknown };
    const s = parseScheduleDateYmd(row.StartDate);
    const e = parseScheduleDateYmd(row.DueDate ?? row.EndDate);
    if (!s || !e || s > e) continue; // undated / sentinel / inverted rows don't vote
    if (!start || s < start) start = s;
    if (!end || e > end) end = e;
  }
  if (!start || !end) return { state: "none", start: "", end: "" };
  return { state: "ready", start, end };
}

/** Query string for the WRITE-decision schedule read. `fresh=1` makes the
 *  SERVER bypass its own task-data cache (fresh/stale-grace serving would
 *  otherwise hand back a schedule another user just created, shortened, or
 *  deleted — exactly the staleness this read exists to defeat); baseLineID 0
 *  = the live plan. Pure builder so tests can pin the cache-bypass contract. */
export function liveTaskDataQuery(ticketId: string): string {
  return `ticketID=${encodeURIComponent(ticketId)}&baseLineID=0&fresh=1`;
}

/** Resolve the window from a LIVE (uncached) task-data fetch at the moment a
 *  flow needs it. Cached or mount-time schedule reads must never decide
 *  member dates — a schedule created or reshaped after they settled has to
 *  win. Fetch failure ⇒ "error" (window unknown) — an informational state
 *  for OPEN-time notices; WRITE decisions (decideAssignDates) fail CLOSED
 *  on it instead of passing dates through. */
export async function resolveLiveScheduleWindow(fetchLive: () => Promise<unknown>): Promise<ScheduleWindow> {
  try {
    return deriveScheduleWindow(await fetchLive());
  } catch {
    return { state: "error", start: "", end: "" };
  }
}

/** Shared decision seam for HIDDEN-date assign flows (add-member modal and
 *  chat assign): 1) resolve the record's display mode — only modes that
 *  render a phase schedule bind member dates to it ("off" otherwise:
 *  no-schedule modes keep dates FREE, so no window fetch and no clamping);
 *  2) when it binds, resolve the window from a LIVE task-data read.
 *  Mode-resolution failure ⇒ "error" (window unknown) — open-time callers
 *  show a notice; the WRITE decision fails CLOSED on it. */
export async function resolveAssignScheduleWindow(opts: {
  getMode: () => Promise<string | undefined>;
  fetchLive: () => Promise<unknown>;
}): Promise<ScheduleWindow> {
  let mode: string | undefined;
  try {
    mode = await opts.getMode();
  } catch {
    return { state: "error", start: "", end: "" };
  }
  if (!displayModeFollowsSchedule(mode)) return { state: "off", start: "", end: "" };
  return resolveLiveScheduleWindow(opts.fetchLive);
}

/** User-facing message when a write decision cannot establish the window.
 *  The write must NOT proceed (fail closed) — see decideAssignDates. */
export const SCHEDULE_WINDOW_UNKNOWN_ERROR =
  "Couldn't verify the project's schedule window. Nothing was saved — please try again.";

/** The WRITE decision for an assign payload's dates: re-resolve display mode
 *  and the LIVE window immediately before building the payload — open-time
 *  state is informational only, because a schedule can be created, shortened,
 *  or moved while a form sits open (and the server only backstops "full"
 *  mode). Applies the hidden-date rule: clamp the desired span, and on merge
 *  paths clamp the EXISTING row's dates too before taking the union, so
 *  duplicate-person merges keep succeeding.
 *  Window unknown ("error": mode or live schedule read failed) ⇒ THROWS
 *  SCHEDULE_WINDOW_UNKNOWN_ERROR — fail CLOSED. The server gate only
 *  backstops "full" mode, so an unknown mode must never let out-of-window
 *  dates through on schedule-no-grid records; callers surface the message
 *  and write nothing (retrying re-resolves). */
export async function decideAssignDates(opts: {
  getMode: () => Promise<string | undefined>;
  fetchLive: () => Promise<unknown>;
  desiredStart: string;
  desiredEnd: string;
  /** Existing row's dates when merging into an already-present assignment. */
  mergeStart?: string;
  mergeEnd?: string;
}): Promise<{ window: ScheduleWindow; startDate: string; endDate: string }> {
  const window = await resolveAssignScheduleWindow({ getMode: opts.getMode, fetchLive: opts.fetchLive });
  if (window.state === "error") throw new Error(SCHEDULE_WINDOW_UNKNOWN_ERROR);
  const minYmd = (a: string, b: string) => (a && b ? (a < b ? a : b) : a || b);
  const maxYmd = (a: string, b: string) => (a && b ? (a > b ? a : b) : a || b);
  const effStart = clampDateToWindow(opts.desiredStart, window, "start");
  const effEnd = clampDateToWindow(opts.desiredEnd, window, "end");
  const startDate = opts.mergeStart !== undefined ? minYmd(clampDateToWindow(opts.mergeStart, window, "start"), effStart) : effStart;
  const endDate = opts.mergeEnd !== undefined ? maxYmd(clampDateToWindow(opts.mergeEnd, window, "end"), effEnd) : effEnd;
  return { window, startDate, endDate };
}

/** Silently keep a hidden member date inside the window (web hidden-date
 *  rule). No-op unless the window is "ready". An empty date pins to the
 *  window edge for its side, so hidden empty dates can't drift outside. */
export function clampDateToWindow(ymd: string, win: ScheduleWindow, side: "start" | "end"): string {
  if (win.state !== "ready") return ymd;
  let v = (ymd || "").slice(0, 10);
  if (!v) return side === "start" ? win.start : win.end;
  if (win.start && v < win.start) v = win.start;
  if (win.end && v > win.end) v = win.end;
  return v;
}

const fmtNice = (ymd: string): string => {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** "Jan 5, 2020 – Mar 3, 2021" — same label shape the web modal shows. */
export function formatScheduleWindowLabel(win: ScheduleWindow): string {
  return `${win.start ? fmtNice(win.start) : "…"} – ${win.end ? fmtNice(win.end) : "…"}`;
}

/** When an assign save was rejected by the server's schedule-window gate,
 *  return the human message to show (server Message when present); otherwise
 *  null. The /assign-resource route returns rejections as 200 + JSON
 *  ({ok:false, error:"ScheduleWindow", Message}), so without this check a
 *  rejected save would look like success. */
export function scheduleWindowRejection(result: unknown): string | null {
  const str = typeof result === "string" ? result : JSON.stringify(result ?? "");
  if (!/schedulewindow/i.test(str)) return null;
  const msgOf = (o: unknown): string | null => {
    const m = (o as { Message?: unknown })?.Message;
    return typeof m === "string" && m.trim() ? m : null;
  };
  if (result && typeof result === "object") {
    const m = msgOf(result);
    if (m) return m;
  }
  try {
    const m = msgOf(JSON.parse(str));
    if (m) return m;
  } catch { /* not JSON — fall through to the generic message */ }
  return "Member dates must stay within the project's phase schedule.";
}
