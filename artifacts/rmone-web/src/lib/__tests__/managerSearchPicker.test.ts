/**
 * ManagerSearchPicker debounce-cancellation regression net (Resources →
 * Manager view). The picker debounces the grid live-filter (onQueryChange)
 * by 180ms and must CANCEL the pending timer on selection and on unmount.
 * If a refactor drops either cancellation, a user who types then quickly
 * picks a person gets the stale filter re-applied to page state ~180ms
 * later — a filtered (often empty) grid right after selecting, or a filter
 * applied after navigating away.
 *
 * Scenarios (the REAL component through react-test-renderer, with the page's
 * exact onSelect/onQueryChange wiring mirrored in the harness):
 *   0. CONTROL — the debounce genuinely schedules (typing never applies
 *      synchronously; retyping reschedules; clearing applies "" instantly),
 *      so the cancellation assertions below can't pass vacuously.
 *   1. type → immediately click a person → onQueryChange NEVER fires
 *      afterwards, managerSearch stays cleared, selection recorded.
 *   2. type → picker unmounts (view switch, and full page unmount) → no
 *      delayed query is applied.
 *   3. Enter/ArrowDown select the CLAMPED highlighted hit — ArrowDown clamps
 *      at the last hit, and a hit list that SHRINKS under a high highlight
 *      (roster refresh) still selects the clamped row instead of nothing.
 *   4. Source-binding: pages/resources.tsx still wires the picker exactly the
 *      way the harness mirrors it (select clears managerSearch; the grid
 *      live-filter reads the debounced managerSearch state).
 *
 * Runs under plain node/tsx like the other __tests__ harnesses: no window on
 * purpose; real timers (assertions are either synchronous or after the full
 * 180ms window, never mid-window, so a loaded machine can't flake them).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LiveResourceProxy } from "../api";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Imported dynamically so the act-environment flag above is set first.
const React = (await import("react")).default;
const { default: TestRenderer, act } = await import("react-test-renderer");
const { ManagerSearchPicker } = await import("../../components/ManagerSearchPicker");

const DEBOUNCE_MS = 180;
// Long enough past the debounce window that a surviving timer must have fired.
const SETTLE_MS = DEBOUNCE_MS + 270;

const WATCHDOG = setTimeout(() => {
  console.error("FAIL: managerSearchPicker.test did not finish within 60s");
  process.exit(1);
}, 60_000);
void WATCHDOG;

// ── Fixture people ──────────────────────────────────────────────────────────
// Roles deliberately avoid the substring "an" so query hits stay name-driven
// and the expected hit sets below are exact.
const person = (id: string, name: string, role: string): LiveResourceProxy =>
  ({ id, name, role } as unknown as LiveResourceProxy);

const PEOPLE: LiveResourceProxy[] = [
  person("u-bob", "Bob Stone", "Estimator"),
  person("u-andy", "Andy Park", "Engineer"),
  person("u-angela", "Angela Fox", "Designer"),
  person("u-andrea", "Andrea Cole", "Surveyor"),
  person("u-cara", "Cara Diaz", "Drafter"),
];
// "an" hits, all prefix matches, alphabetical: Andrea Cole, Andy Park, Angela Fox.
// "and" hits: Andrea Cole, Andy Park.

const EXTENDED: LiveResourceProxy[] = [
  ...PEOPLE,
  person("u-anita", "Anita Wells", "Estimator"),
  person("u-anthony", "Anthony Reed", "Drafter"),
];
// EXTENDED "an" hits: Andrea, Andy, Angela, Anita, Anthony (5).
const SHRUNK: LiveResourceProxy[] = [
  person("u-angela", "Angela Fox", "Designer"),
  person("u-anthony", "Anthony Reed", "Drafter"),
  person("u-bob", "Bob Stone", "Estimator"),
];
// SHRUNK "an" hits: Angela Fox, Anthony Reed (2).
const ROLE_LABEL_PEOPLE: LiveResourceProxy[] = [
  person("u-role", "Alex Morgan", "Senior Project Manager"),
  person("u-eng", "Robin Lee", "Engineer"),
];

// ── Harness: mirrors the page wiring VERBATIM (bound by scenario 4) ─────────
//   <ManagerSearchPicker people={staffResources} loading={allocQ.isLoading}
//     onSelect={(id) => { setManagerSelectedId(id); setManagerSearch(""); }}
//     onQueryChange={setManagerSearch} />
const queryLog: string[] = [];
const selectLog: string[] = [];
const out: { managerSearch: string; managerSelectedId: string | null } = {
  managerSearch: "",
  managerSelectedId: null,
};

function Harness({ showPicker, people, teamMemberCounts }: {
  showPicker: boolean;
  people: LiveResourceProxy[];
  teamMemberCounts?: ReadonlyMap<string, number>;
}) {
  const [managerSelectedId, setManagerSelectedId] = React.useState<string | null>(null);
  const [managerSearch, setManagerSearch] = React.useState("");
  out.managerSearch = managerSearch;
  out.managerSelectedId = managerSelectedId;
  if (!showPicker) return null;
  return React.createElement(ManagerSearchPicker, {
    people,
    teamMemberCounts,
    loading: false,
    onSelect: (id: string) => { selectLog.push(id); setManagerSelectedId(id); setManagerSearch(""); },
    onQueryChange: (q: string) => { queryLog.push(q); setManagerSearch(q); },
  });
}

async function mount(
  people: LiveResourceProxy[],
  teamMemberCounts?: ReadonlyMap<string, number>,
): Promise<ReactTestRenderer> {
  queryLog.length = 0;
  selectLog.length = 0;
  out.managerSearch = "";
  out.managerSelectedId = null;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Harness, { showPicker: true, people, teamMemberCounts }));
  });
  return renderer;
}

const input = (r: ReactTestRenderer): ReactTestInstance => r.root.findByType("input");
const type = (r: ReactTestRenderer, value: string) =>
  act(async () => { input(r).props.onChange({ target: { value } }); });
const focusInput = (r: ReactTestRenderer) =>
  act(async () => { input(r).props.onFocus(); });
const pressKey = (r: ReactTestRenderer, key: string) =>
  act(async () => {
    input(r).props.onKeyDown({ key, preventDefault() { /* noop */ }, currentTarget: { blur() { /* noop */ } } });
  });
const settleInAct = (r: ReactTestRenderer, ms: number) =>
  act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function textOf(node: ReactTestInstance): string {
  const parts: string[] = [];
  const walk = (n: ReactTestInstance | string): void => {
    if (typeof n === "string") { parts.push(n); return; }
    for (const child of n.children) walk(child as ReactTestInstance | string);
  };
  walk(node);
  return parts.join("");
}
const hitButtons = (r: ReactTestRenderer): ReactTestInstance[] => r.root.findAllByType("button");

// ── Scenario 0: CONTROL — the debounce genuinely schedules and fires ────────
{
  const r = await mount(PEOPLE);
  await type(r, "and");
  assert.deepEqual(queryLog, [], "typing must never apply the filter synchronously");
  await type(r, "andy"); // retype inside the window: reschedules, single fire
  assert.deepEqual(queryLog, [], "retyping must not flush the previous pending query");
  assert.equal(input(r).props.value, "andy", "input is controlled by picker-local text state");
  await settleInAct(r, SETTLE_MS);
  assert.deepEqual(queryLog, ["andy"],
    "exactly ONE debounced fire with the LATEST text (reschedule must cancel the older timer)");
  assert.equal(out.managerSearch, "andy", "debounced query reaches page state");

  // Clearing applies instantly (full grid restored without the 180ms wait).
  await type(r, "");
  assert.deepEqual(queryLog, ["andy", ""], "clearing pushes \"\" synchronously");
  assert.equal(out.managerSearch, "", "cleared filter reaches page state instantly");
  await type(r, "   ");
  assert.deepEqual(queryLog, ["andy", "", ""], "whitespace-only counts as cleared");
  await settleInAct(r, SETTLE_MS);
  assert.deepEqual(queryLog, ["andy", "", ""], "no stray timer survives a clear");
  await act(async () => { r.unmount(); });
  console.log("PASS control: debounce schedules, reschedules, clears instantly");
}

// ── Scenario 1: type → immediately click a person → stale filter cancelled ──
{
  const r = await mount(PEOPLE);
  await focusInput(r);
  await type(r, "and"); // pending 180ms timer for "and"
  const buttons = hitButtons(r);
  assert.equal(buttons.length, 2, "\"and\" lists Andrea Cole and Andy Park");
  assert.ok(textOf(buttons[0]).includes("Andrea Cole"), "prefix hits sort alphabetically");
  assert.ok(textOf(buttons[1]).includes("Andy Park"), "Andy Park is the second hit");
  await act(async () => { buttons[1].props.onMouseDown({ preventDefault() { /* noop */ } }); });

  assert.deepEqual(selectLog, ["u-andy"], "click selects the person");
  assert.equal(out.managerSelectedId, "u-andy", "page records the selection");
  assert.equal(out.managerSearch, "", "managerSearch is cleared on selection");
  assert.equal(input(r).props.value, "", "picker text clears on selection");
  assert.deepEqual(queryLog, [], "no query applied before the debounce window");

  await settleInAct(r, SETTLE_MS);
  assert.deepEqual(queryLog, [],
    "REGRESSION: pending debounce must be cancelled on selection — a surviving " +
    "timer would re-apply the stale \"and\" filter after the pick");
  assert.equal(out.managerSearch, "", "grid filter stays cleared after the debounce window");
  assert.equal(out.managerSelectedId, "u-andy", "selection survives");
  await act(async () => { r.unmount(); });
  console.log("PASS select-cancels: click after typing never applies the stale filter");
}

// Role display — names include a compact role in brackets, followed by the
// real unique-team count for managers. The full source role stays available
// through the result title tooltip; ordinary staff do not get a fake zero.
{
  const r = await mount(ROLE_LABEL_PEOPLE, new Map([["u-role", 7]]));
  await focusInput(r);
  const buttons = hitButtons(r);
  assert.equal(buttons.length, 2, "role fixture shows both people");
  const alex = buttons.find(button => textOf(button).includes("Alex Morgan"));
  const robin = buttons.find(button => textOf(button).includes("Robin Lee"));
  assert.ok(alex && textOf(alex).includes("Alex Morgan (SPM) – 7"), "manager role is followed by its unique-team count");
  assert.ok(robin && textOf(robin).includes("Robin Lee (Eng)"), "single-word role uses its short label");
  assert.ok(robin && !textOf(robin).includes(" – "), "ordinary staff do not receive a fabricated team count");
  const alexText = alex?.findAllByType("span").find(span => span.props.title === "Senior Project Manager");
  assert.ok(alexText, "full role remains available as a tooltip");
  await act(async () => { r.unmount(); });
  console.log("PASS role-label: manager results show short roles and real team counts");
}

// ── Scenario 2: type → picker unmounts (view switch) → no delayed query ─────
{
  const r = await mount(PEOPLE);
  await type(r, "angela"); // pending timer
  await act(async () => {
    r.update(React.createElement(Harness, { showPicker: false, people: PEOPLE }));
  });
  await settleInAct(r, SETTLE_MS);
  assert.deepEqual(queryLog, [],
    "REGRESSION: unmount cleanup must clear the pending debounce — a surviving " +
    "timer would filter the page after the picker is gone");
  assert.equal(out.managerSearch, "", "page state untouched after the picker unmounts");
  await act(async () => { r.unmount(); });

  // Full page unmount (navigation) — same guarantee, plus nothing crashes.
  const r2 = await mount(PEOPLE);
  await type(r2, "dana"); // pending timer (zero hits is fine — timer schedules regardless)
  await act(async () => { r2.unmount(); });
  await sleep(SETTLE_MS);
  assert.deepEqual(queryLog, [], "no delayed query after full unmount");
  console.log("PASS unmount-cancels: view switch and navigation kill the pending filter");
}

// ── Scenario 3: Enter/ArrowDown select the CLAMPED highlighted hit ──────────
{
  const r = await mount(PEOPLE);
  await focusInput(r);
  await type(r, "an"); // hits: Andrea Cole, Andy Park, Angela Fox
  assert.equal(hitButtons(r).length, 3, "\"an\" lists the three An* people");
  for (let i = 0; i < 5; i++) await pressKey(r, "ArrowDown"); // 5 downs, 3 hits → clamp at last
  await pressKey(r, "Enter");
  assert.deepEqual(selectLog, ["u-angela"],
    "ArrowDown clamps at the last hit; Enter selects it");
  assert.equal(out.managerSearch, "", "Enter selection also clears managerSearch");
  await settleInAct(r, SETTLE_MS);
  assert.deepEqual(queryLog, [],
    "REGRESSION: Enter selection must also cancel the pending debounce");
  await act(async () => { r.unmount(); });
  console.log("PASS keyboard-clamp: ArrowDown clamps, Enter selects and cancels");
}

// Hit list SHRINKS under a high highlight (roster refresh) → clamped Enter.
{
  const r = await mount(EXTENDED);
  await focusInput(r);
  await type(r, "an"); // 5 hits
  assert.equal(hitButtons(r).length, 5, "EXTENDED \"an\" lists five people");
  for (let i = 0; i < 4; i++) await pressKey(r, "ArrowDown"); // highlight = 4 (last)
  await act(async () => {
    r.update(React.createElement(Harness, { showPicker: true, people: SHRUNK }));
  });
  assert.equal(hitButtons(r).length, 2, "roster refresh shrinks the hit list to two");
  await pressKey(r, "Enter");
  assert.deepEqual(selectLog, ["u-anthony"],
    "highlight past the end must CLAMP to the last remaining hit (unclamped " +
    "hits[4] is undefined and Enter would select nothing)");
  await act(async () => { r.unmount(); });
  console.log("PASS shrink-clamp: Enter selects the clamped hit after the list shrinks");
}

// Enter with zero hits selects nothing and does not crash.
{
  const r = await mount(PEOPLE);
  await focusInput(r);
  await type(r, "zzz");
  assert.equal(hitButtons(r).length, 0, "no hits for zzz");
  await pressKey(r, "Enter");
  assert.deepEqual(selectLog, [], "Enter with no hits selects nothing");
  await act(async () => { r.unmount(); });
  console.log("PASS empty-enter: Enter on an empty hit list is a no-op");
}

// ── Scenario 4: source-binding — the page wires the picker as mirrored ──────
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pageSrc = readFileSync(path.join(here, "../../pages/resources.tsx"), "utf8");
  assert.ok(
    pageSrc.includes('import { ManagerSearchPicker } from "@/components/ManagerSearchPicker"'),
    "resources.tsx must render the extracted @/components/ManagerSearchPicker " +
    "(this test covers THAT component — do not fork a page-local copy)",
  );
  assert.match(
    pageSrc,
    /onSelect=\{\s*\(id\)\s*=>\s*\{\s*setManagerSelectedId\(id\);\s*setManagerSearch\(""\);\s*\}\s*\}/,
    "page onSelect must clear managerSearch when a person is picked — the " +
    "harness mirrors exactly this wiring",
  );
  assert.match(
    pageSrc,
    /onQueryChange=\{\s*setManagerSearch\s*\}/,
    "page must feed the debounced query straight into managerSearch state",
  );
  assert.match(
    pageSrc,
    /managerSearch\.trim\(\)\.toLowerCase\(\)/,
    "managerDefaultRows live-filter must read the debounced managerSearch state",
  );
  console.log("PASS source-binding: resources.tsx wiring matches the harness mirror");
}

console.log("PASS managerSearchPicker.test: all scenarios green");
process.exit(0);
