import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  decideAssignDates, deriveScheduleWindow, clampDateToWindow, displayModeFollowsSchedule,
  formatScheduleWindowLabel, liveTaskDataQuery, parseScheduleDateYmd, resolveAssignScheduleWindow,
  resolveLiveScheduleWindow, scheduleWindowRejection, SCHEDULE_WINDOW_UNKNOWN_ERROR,
} from "../scheduleWindow.js";

// ── displayModeFollowsSchedule — only the two schedule-rendering modes ──
assert.equal(displayModeFollowsSchedule("full"), true);
assert.equal(displayModeFollowsSchedule("schedule-no-grid"), true);
assert.equal(displayModeFollowsSchedule("no-schedule"), false);
assert.equal(displayModeFollowsSchedule("no-schedule-no-hours"), false);
assert.equal(displayModeFollowsSchedule("no-schedule-no-grid"), false);
assert.equal(displayModeFollowsSchedule(undefined), false);

// ── parseScheduleDateYmd — web parseScheduleDate semantics ──
assert.equal(parseScheduleDateYmd("2020-01-05T00:00:00"), "2020-01-05", "leading YMD wins, no TZ shift");
assert.equal(parseScheduleDateYmd("2020-01-05"), "2020-01-05");
assert.equal(parseScheduleDateYmd("0001-01-01T00:00:00"), null, "SQL sentinel is not a date");
assert.equal(parseScheduleDateYmd(""), null);
assert.equal(parseScheduleDateYmd(null), null);
assert.equal(parseScheduleDateYmd("not a date"), null);
assert.equal(parseScheduleDateYmd(new Date(2021, 2, 3)), "2021-03-03", "Date instances pass through as local YMD");

// ── deriveScheduleWindow ──
const winOf = (raw: unknown) => deriveScheduleWindow(raw);

// Dated phases → ready, min start / max end across rows (DueDate preferred).
const ready = winOf([
  { Title: "Design", StartDate: "2020-03-01T00:00:00", DueDate: "2020-06-30T00:00:00" },
  { Title: "Build", StartDate: "2020-01-06T00:00:00", DueDate: "2020-04-01T00:00:00" },
  { Title: "Close", StartDate: "2020-05-01", EndDate: "2021-02-15" }, // EndDate fallback
]);
assert.deepEqual(ready, { state: "ready", start: "2020-01-06", end: "2021-02-15" });

// {Data} / {data} envelopes unwrap (same tolerance as the web derive).
assert.equal(winOf({ Data: [{ Title: "P1", StartDate: "2020-01-01", DueDate: "2020-02-01" }] }).state, "ready");
assert.equal(winOf({ data: [{ Alias: "P1", StartDate: "2020-01-01", DueDate: "2020-02-01" }] }).state, "ready", "Alias names a row when Title is absent");

// No rows at all → none (no lifecycle assigned = free dates).
assert.deepEqual(winOf([]), { state: "none", start: "", end: "" });
assert.deepEqual(winOf(null), { state: "none", start: "", end: "" });

// Named rows without a single valid start≤end range → none (free dates).
assert.equal(winOf([{ Title: "P1" }, { Title: "P2", StartDate: "0001-01-01" }]).state, "none");
assert.equal(winOf([{ Title: "P1", StartDate: "2020-05-01", DueDate: "2020-01-01" }]).state, "none", "inverted range doesn't vote");

// Unnamed rows are ignored entirely.
assert.equal(winOf([{ StartDate: "2020-01-01", DueDate: "2020-02-01" }]).state, "none");

// A single undated row among dated ones doesn't block the window.
assert.deepEqual(
  winOf([
    { Title: "P1", StartDate: "2020-01-06", DueDate: "2020-02-01" },
    { Title: "P2" },
  ]),
  { state: "ready", start: "2020-01-06", end: "2020-02-01" },
);

// ── clampDateToWindow — hidden-date rule ──
const win = { state: "ready", start: "2020-01-06", end: "2021-02-15" } as const;
assert.equal(clampDateToWindow("2019-05-01", win, "start"), "2020-01-06", "below window → window start");
assert.equal(clampDateToWindow("2022-01-01", win, "end"), "2021-02-15", "above window → window end");
assert.equal(clampDateToWindow("2020-06-15", win, "start"), "2020-06-15", "inside window unchanged");
assert.equal(clampDateToWindow("2022-01-01T00:00:00", win, "start"), "2021-02-15", "datetime sliced to YMD then clamped");
assert.equal(clampDateToWindow("", win, "start"), "2020-01-06", "hidden empty start pins to window start");
assert.equal(clampDateToWindow("", win, "end"), "2021-02-15", "hidden empty end pins to window end");
for (const state of ["loading", "off", "none", "error"] as const) {
  assert.equal(clampDateToWindow("2019-05-01T00:00:00", { state, start: "", end: "" }, "start"),
    "2019-05-01T00:00:00", `${state} window is a strict no-op (value passes through verbatim)`);
}

// ── formatScheduleWindowLabel ──
assert.equal(formatScheduleWindowLabel(win), "Jan 6, 2020 – Feb 15, 2021");

// ── scheduleWindowRejection — 200 + {ok:false} bodies must not read as success ──
assert.equal(
  scheduleWindowRejection({ ok: false, Status: false, error: "ScheduleWindow", Message: "Start date 2019-01-01 is before the project schedule starts." }),
  "Start date 2019-01-01 is before the project schedule starts.",
  "object body → server Message",
);
assert.equal(
  scheduleWindowRejection('{"ok":false,"error":"ScheduleWindow","Message":"End date is after the schedule ends."}'),
  "End date is after the schedule ends.",
  "string body → parsed Message",
);
assert.equal(
  scheduleWindowRejection('{"error":"ScheduleWindow"}'),
  "Member dates must stay within the project's phase schedule.",
  "no Message → generic fallback",
);
assert.equal(scheduleWindowRejection({ ok: true, added: 1 }), null, "success body → null");
assert.equal(scheduleWindowRejection("AllocationOutofbounds~1~a~b~c"), null, "other rejections stay with their own handlers");

// ── resolveLiveScheduleWindow — the assignment-time window is LIVE ──
// Regression scenario: chat's weekly-allocation card derives its weeks from a
// CACHED task-data load and can sit in the transcript long afterwards. A
// schedule created (or shortened) after that cached load must still govern
// the dates the assign action writes: the action-time live resolve wins over
// anything derived earlier. A failed live fetch yields "error" — an OPEN-time
// notice state; the WRITE decision (decideAssignDates) fails CLOSED on it.
(async () => {
  // Cached load happened when the project had NO schedule (free dates)…
  const cachedLoadWindow = deriveScheduleWindow([]);
  assert.equal(cachedLoadWindow.state, "none");
  // …then a schedule was CREATED. The action-time live resolve sees it, and
  // the Monday-week span derived from the stale load clamps into it:
  const created = await resolveLiveScheduleWindow(async () => [
    { Title: "Build", StartDate: "2020-01-08T00:00:00", DueDate: "2020-06-30T00:00:00" },
  ]);
  assert.deepEqual(created, { state: "ready", start: "2020-01-08", end: "2020-06-30" });
  assert.equal(clampDateToWindow("2020-01-06", created, "start"), "2020-01-08", "week Monday before new schedule start snaps in");
  assert.equal(clampDateToWindow("2020-07-05", created, "end"), "2020-06-30", "week end past new schedule end snaps in");

  // Schedule SHORTENED after the cached load (old span ran through Dec) —
  // the derived end now follows the live truth, not the stale weeks:
  const shortened = await resolveLiveScheduleWindow(async () => [
    { Title: "Build", StartDate: "2020-01-06", DueDate: "2020-03-31" },
  ]);
  assert.equal(clampDateToWindow("2020-12-31", shortened, "end"), "2020-03-31");

  // Live fetch fails → "error" classification for open-time notices. The
  // pure clamp stays a strict no-op on it (it never invents a window), and
  // the WRITE path is protected separately: decideAssignDates THROWS on this
  // state (fail closed) — asserted below.
  const failed = await resolveLiveScheduleWindow(async () => { throw new Error("offline"); });
  assert.equal(failed.state, "error");
  assert.equal(clampDateToWindow("2019-01-01", failed, "start"), "2019-01-01");

  // ── resolveAssignScheduleWindow — the chat/modal decision seam per mode ──
  // Non-schedule display modes keep hidden dates FREE: no window fetch, no
  // clamping — even when dated phases exist in the DB.
  for (const mode of ["no-schedule", "no-schedule-no-hours", "no-schedule-no-grid"] as const) {
    let fetched = false;
    const win = await resolveAssignScheduleWindow({
      getMode: async () => mode,
      fetchLive: async () => { fetched = true; return [{ Title: "Build", StartDate: "2020-01-06", DueDate: "2020-03-31" }]; },
    });
    assert.equal(win.state, "off", `${mode} → window off`);
    assert.equal(fetched, false, `${mode} never fetches the schedule`);
    assert.equal(clampDateToWindow("2019-05-01", win, "start"), "2019-05-01", `${mode} keeps derived dates unchanged`);
    assert.equal(clampDateToWindow("2022-09-09", win, "end"), "2022-09-09", `${mode} keeps derived end unchanged`);
  }
  // Schedule-bound modes fetch LIVE and the window clamps.
  for (const mode of ["full", "schedule-no-grid"] as const) {
    const win = await resolveAssignScheduleWindow({
      getMode: async () => mode,
      fetchLive: async () => [{ Title: "Build", StartDate: "2020-01-06", DueDate: "2020-03-31" }],
    });
    assert.deepEqual(win, { state: "ready", start: "2020-01-06", end: "2020-03-31" }, `${mode} binds dates to the schedule`);
    assert.equal(clampDateToWindow("2019-05-01", win, "start"), "2020-01-06", `${mode} clamps derived start`);
  }
  // Mode resolution failure → "error" classification (drives the modal's
  // open-time notice); the WRITE decision fails CLOSED on it — see below.
  const modeFail = await resolveAssignScheduleWindow({
    getMode: async () => { throw new Error("rules fetch failed"); },
    fetchLive: async () => [],
  });
  assert.equal(modeFail.state, "error");
  assert.equal(clampDateToWindow("2019-05-01", modeFail, "start"), "2019-05-01");

  // ── decideAssignDates — the modal's WRITE decision resolves live ──
  // Integration regression: a schedule-no-grid modal opened while the
  // schedule ran Jan 6 – Dec 31, 2020, and the schedule was SHORTENED while
  // the form sat open. The submit-time decision re-resolves mode + window,
  // so the payload uses the NEW window — the open-time state is
  // informational only. (schedule-no-grid is the material case: the server
  // only enforces "full", so a stale client window would persist silently.)
  {
    const openTime = deriveScheduleWindow([{ Title: "Build", StartDate: "2020-01-06", DueDate: "2020-12-31" }]);
    assert.deepEqual(openTime, { state: "ready", start: "2020-01-06", end: "2020-12-31" }, "open-time window (goes stale)");
    const d = await decideAssignDates({
      getMode: async () => "schedule-no-grid",
      fetchLive: async () => [{ Title: "Build", StartDate: "2020-02-03", DueDate: "2020-03-31" }], // changed after open
      desiredStart: "2020-01-06", // seeded from the open-time truth
      desiredEnd: "2020-12-31",
    });
    assert.equal(d.startDate, "2020-02-03", "submitted start follows the POST-CHANGE window, not the open-time one");
    assert.equal(d.endDate, "2020-03-31", "submitted end follows the POST-CHANGE window");
    assert.equal(d.window.state, "ready");
  }
  // Schedule DELETED while the form sat open → dates go free again (stale
  // open-time bounds must stop enforcing).
  {
    const d = await decideAssignDates({
      getMode: async () => "full",
      fetchLive: async () => [],
      desiredStart: "2019-01-01", desiredEnd: "2022-12-31",
    });
    assert.equal(d.window.state, "none");
    assert.equal(d.startDate, "2019-01-01");
    assert.equal(d.endDate, "2022-12-31");
  }
  // Merge path: the EXISTING row's out-of-window dates clamp before the union,
  // so duplicate-person merges succeed with in-window dates.
  {
    const d = await decideAssignDates({
      getMode: async () => "full",
      fetchLive: async () => [{ Title: "Build", StartDate: "2020-01-06", DueDate: "2020-06-30" }],
      desiredStart: "2020-03-01", desiredEnd: "2020-04-01",
      mergeStart: "2019-05-01", mergeEnd: "2020-12-31", // legacy row outside the window
    });
    assert.equal(d.startDate, "2020-01-06", "merged start = min(clamped existing, desired)");
    assert.equal(d.endDate, "2020-06-30", "merged end = max(clamped existing, desired)");
  }
  // No-schedule mode at submit: dates pass through even when dated phases exist.
  {
    const d = await decideAssignDates({
      getMode: async () => "no-schedule",
      fetchLive: async () => [{ Title: "Build", StartDate: "2020-01-06", DueDate: "2020-03-31" }],
      desiredStart: "2019-01-01", desiredEnd: "2022-12-31",
    });
    assert.equal(d.window.state, "off");
    assert.equal(d.startDate, "2019-01-01");
    assert.equal(d.endDate, "2022-12-31");
  }
  // Admin flips the display MODE while the form sits open (e.g. an audience
  // rule or settings change re-resolves this viewer differently): the write
  // decision re-reads the EFFECTIVE mode too, so the flip governs the save
  // in both directions.
  {
    // Opened under "full" (window shown) → flipped to no-schedule ⇒ free.
    const toFree = await decideAssignDates({
      getMode: async () => "no-schedule",
      fetchLive: async () => [{ Title: "Build", StartDate: "2020-01-06", DueDate: "2020-03-31" }],
      desiredStart: "2019-01-01", desiredEnd: "2022-12-31",
    });
    assert.equal(toFree.window.state, "off", "mode flip to no-schedule frees the dates at submit");
    assert.equal(toFree.startDate, "2019-01-01");
    // Opened under "no-schedule" (no window) → flipped to schedule-no-grid ⇒ clamped.
    const toBound = await decideAssignDates({
      getMode: async () => "schedule-no-grid",
      fetchLive: async () => [{ Title: "Build", StartDate: "2020-01-06", DueDate: "2020-03-31" }],
      desiredStart: "2019-01-01", desiredEnd: "2022-12-31",
    });
    assert.equal(toBound.startDate, "2020-01-06", "mode flip to schedule-no-grid clamps at submit");
    assert.equal(toBound.endDate, "2020-03-31");
  }
  // ── WRITE decision fails CLOSED on an unknown window ──
  // Mode fetch or live schedule read failure must BLOCK the save with an
  // explicit error, never pass dates through: the server gate only backstops
  // "full" mode, so a transient lookup failure on a schedule-no-grid record
  // would otherwise reopen the out-of-window hole this gate exists to close.
  {
    await assert.rejects(
      decideAssignDates({
        getMode: async () => { throw new Error("mode endpoint down"); },
        fetchLive: async () => [],
        desiredStart: "2019-01-01", desiredEnd: "2022-12-31",
      }),
      (e: unknown) => e instanceof Error && e.message === SCHEDULE_WINDOW_UNKNOWN_ERROR,
      "mode-resolution failure blocks the write",
    );
    await assert.rejects(
      decideAssignDates({
        getMode: async () => "schedule-no-grid",
        fetchLive: async () => { throw new Error("task-data down"); },
        desiredStart: "2019-01-01", desiredEnd: "2022-12-31",
      }),
      (e: unknown) => e instanceof Error && e.message === SCHEDULE_WINDOW_UNKNOWN_ERROR,
      "live-schedule failure blocks the write in a schedule-bound mode",
    );
    // A KNOWN non-schedule mode never touches the live read, so a broken
    // task-data endpoint must not block a role/title edit whose dates are
    // free by mode (hidden-date rule: edits keep working).
    const free = await decideAssignDates({
      getMode: async () => "no-schedule",
      fetchLive: async () => { throw new Error("task-data down"); },
      desiredStart: "2019-01-01", desiredEnd: "2022-12-31",
    });
    assert.equal(free.window.state, "off");
    assert.equal(free.startDate, "2019-01-01");
    assert.equal(free.endDate, "2022-12-31");
    // Chat's module routing: when the record's module cannot be established
    // (details read fails or carries no ModuleName), getMode THROWS — the
    // decision must reject, never guess "project-side" and skip an opp-side
    // schedule-bound window (project-side mode may be non-schedule while the
    // opp-side mode binds dates).
    await assert.rejects(
      decideAssignDates({
        getMode: async () => { throw new Error("record module unknown"); },
        fetchLive: async () => [{ Title: "Build", StartDate: "2020-01-06", DueDate: "2020-03-31" }],
        desiredStart: "2019-01-01", desiredEnd: "2022-12-31",
      }),
      (e: unknown) => e instanceof Error && e.message === SCHEDULE_WINDOW_UNKNOWN_ERROR,
      "unresolvable record module blocks the write",
    );
  }

  // ── WRITE-decision reads bypass the SERVER's task-data cache ─────────────
  // /task-data serves from a fresh/stale-grace cache unless fresh=1 is
  // supplied, so a cached OLD schedule could otherwise decide the payload
  // (the "schedule shortened after open" case above shows the fresh read
  // governing the write). Pin the query contract, then pin that every
  // schedule-window resolution site actually rides the fresh helper.
  {
    const q = liveTaskDataQuery("PRJ 001");
    assert.ok(q.includes("fresh=1"), "live schedule read sends fresh=1 (server cache bypass)");
    assert.ok(q.includes("baseLineID=0"), "live schedule read targets the live plan");
    assert.ok(q.includes(encodeURIComponent("PRJ 001")), "ticket id is URL-encoded");

    const pkgRoot = fs.existsSync(path.join(process.cwd(), "components/AddTeamMemberModal.tsx"))
      ? process.cwd()
      : path.join(process.cwd(), "artifacts/rmone-mobile");
    const read = (rel: string) => fs.readFileSync(path.join(pkgRoot, rel), "utf8");

    const apiSrc = read("lib/api.ts");
    const helperAt = apiSrc.indexOf("export async function getLiveTaskData");
    assert.ok(helperAt >= 0, "api.ts exposes getLiveTaskData");
    assert.ok(apiSrc.slice(helperAt, helperAt + 700).includes("liveTaskDataQuery("),
      "getLiveTaskData rides the fresh=1 query builder");

    const modalReads = read("components/AddTeamMemberModal.tsx").match(/fetchLive:[^,\n]*/g) ?? [];
    assert.equal(modalReads.length, 2, "modal has open-time AND submit-time schedule reads");
    for (const r of modalReads) assert.ok(r.includes("getLiveTaskData("), `modal schedule read must use the fresh helper: ${r}`);

    const chatSrc = read("app/(tabs)/chat.tsx");
    const chatReads = chatSrc.match(/fetchLive:[^,\n]*/g) ?? [];
    assert.equal(chatReads.length, 1, "chat assign has exactly one schedule read");
    for (const r of chatReads) assert.ok(r.includes("getLiveTaskData("), `chat schedule read must use the fresh helper: ${r}`);

    // Chat's mode routing must not swallow a failed module lookup — a PMM
    // guess would read the project-side mode and could skip an opp-side
    // schedule-bound window. The getMode closure carries no .catch and
    // fails via the module-unknown throw (fail-closed downstream).
    const gmStart = chatSrc.indexOf("const assignWin = await resolveAssignScheduleWindow");
    assert.ok(gmStart >= 0, "chat assign resolves the window");
    const gmBlock = chatSrc.slice(gmStart, chatSrc.indexOf("fetchLive:", gmStart));
    assert.ok(!gmBlock.includes(".catch"), "chat module lookup must not swallow failures");
    assert.ok(gmBlock.includes("record module unknown"), "chat fails closed when the record's module cannot be established");
  }

  console.log("✓ schedule window: derive + clamp + per-mode assign gate + submit-time write decision + unknown-window fail-closed + fresh=1 cache-bypass contract + rejection detection");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
