/**
 * Actuals-import "skip flagged rows" — upload selection + chunking honesty.
 *
 * The upload's default sends only rows that passed the pre-check. A code
 * review caught a bug where the chunk loop sliced the ORIGINAL parsed row
 * list while committing the FILTERED count: with flagged rows interspersed,
 * the wrong rows uploaded (flagged ones included, trailing ready ones
 * silently dropped) while every total still balanced — nothing looked wrong
 * afterwards. This test pins the fixed behavior end to end:
 *   1. only ready rows are sent, in original order,
 *   2. chunk payloads slice the FILTERED list (each ≤ CHUNK, no gaps),
 *   3. the rowsTotal handed to commit equals exactly what was sent,
 * and a control section replays the historical bug in the one shape where
 * the server's commit accounting could NOT have caught it (ready count an
 * exact multiple of the chunk size), proving these assertions genuinely
 * discriminate rather than pass vacuously.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { planUploadChunks } from "../afMath";

/* ── the page's real CHUNK size drives the fixtures ───────────────────── */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const pageSource = read("../../pages/actuals-import.tsx");

const chunkMatch = pageSource.match(/const CHUNK = (\d+);/);
assert.ok(chunkMatch, "actuals-import.tsx must declare its upload chunk size as `const CHUNK = <n>;`");
const CHUNK = Number(chunkMatch![1]);
assert.ok(Number.isInteger(CHUNK) && CHUNK >= 2, `CHUNK must be a small-batch size ≥ 2, got ${CHUNK}`);
assert.equal(CHUNK, 2000, "upload chunk size is pinned at 2000 — if this changed on purpose, update this test's expectation");

/* ── fixtures: a big file with ready/flagged rows INTERSPERSED ────────── */

interface Row { at: number; employee: string; ticket: string; hours: number }
type Check = { ok: true } | { ok: false; reason: string };

// 5×CHUNK + 3 rows, alternating ready/flagged, so the ready subset spans
// MULTIPLE full chunks plus a remainder — the shape where original-list
// slicing goes wrong invisibly.
const totalRows = 5 * CHUNK + 3;
const allRows: Row[] = [];
const checks: Check[] = [];
for (let i = 0; i < totalRows; i++) {
  allRows.push({ at: i, employee: `person-${i}`, ticket: `PMM-26-${String(i).padStart(6, "0")}`, hours: 1 + (i % 40) });
  checks.push(i % 2 === 0 ? { ok: true } : { ok: false, reason: "No user matches." });
}
const readyRows = allRows.filter((_, i) => checks[i].ok);
assert.ok(readyRows.length > 2 * CHUNK, "fixture must span at least two full chunks of ready rows");
assert.ok(readyRows.length % CHUNK !== 0, "fixture must leave a remainder chunk");

/* ── 1. skip-flagged plan: exactly the ready rows, in order, chunked ──── */

const plan = planUploadChunks(allRows, checks, true, CHUNK);

// Simulate the page's upload loop: what would the server receive?
const sentChunks: Row[][] = [];
let sentProgress = 0;
const progressSeen: number[] = [];
for (const chunk of plan.chunks) {
  sentChunks.push(chunk);
  sentProgress += chunk.length;
  progressSeen.push(sentProgress);
}
const committedRowsTotal = plan.total; // what commitActualsImport(batchId, plan.total) receives
const sentFlat = sentChunks.flat();

// Only ready rows — a flagged row anywhere in a payload is the exact bug.
assert.ok(sentFlat.every((r) => r.at % 2 === 0), "no flagged row may appear in any chunk payload");
// All ready rows, order preserved, and the very same objects (no copies).
assert.equal(sentFlat.length, readyRows.length, "every ready row must be sent — none silently dropped from the tail");
assert.ok(sentFlat.every((r, k) => r === readyRows[k]), "sent rows must be exactly the ready subset in original file order");
// plan.rows is the same sequence the chunks re-form.
assert.ok(plan.rows.every((r, k) => r === sentFlat[k]) && plan.rows.length === sentFlat.length, "plan.rows and the concatenated chunks must agree exactly");

// Chunk shapes: all full except the last, no empty chunks, correct count.
assert.equal(plan.chunks.length, Math.ceil(readyRows.length / CHUNK), "chunk count must cover the READY rows, not the original list");
assert.ok(plan.chunks.length >= 3, "fixture must exercise multiple chunks — enlarge it if CHUNK grew");
plan.chunks.forEach((c, k) => {
  if (k < plan.chunks.length - 1) assert.equal(c.length, CHUNK, `chunk ${k} must be full`);
  else assert.ok(c.length > 0 && c.length <= CHUNK, "last chunk must hold the nonempty remainder");
});

// Commit accounting matches what was actually sent.
assert.equal(committedRowsTotal, sentFlat.length, "rowsTotal passed to commit must equal the rows actually sent");
assert.equal(progressSeen[progressSeen.length - 1], plan.total, "progress accumulation must land exactly on the plan total");

/* ── 2. control: the HISTORICAL BUG passes accounting, ships wrong rows ── */

// The server's commit refuses unless rowsTotal === rows received, so the bug
// was truly invisible in exactly one shape: a ready count that is an exact
// multiple of CHUNK. Then slicing the ORIGINAL list sends precisely as many
// (wrong) rows as the commit declares — accounting balances, flagged rows
// import, trailing ready rows vanish. Prove section 1's payload checks are
// what catch it, i.e. they don't pass vacuously.
{
  const total2 = 4 * CHUNK; // alternating → ready = 2×CHUNK exactly
  const rows2: Row[] = [];
  const checks2: Check[] = [];
  for (let i = 0; i < total2; i++) {
    rows2.push({ at: i, employee: `p${i}`, ticket: `PMM-26-${String(i).padStart(6, "0")}`, hours: 1 });
    checks2.push(i % 2 === 0 ? { ok: true } : { ok: false, reason: "flagged" });
  }
  const good = planUploadChunks(rows2, checks2, true, CHUNK);
  assert.equal(good.total % CHUNK, 0, "control fixture needs an exact-multiple ready count — the only shape where the bug was invisible");

  // The old loop: bounds from the filtered list, slices from the ORIGINAL.
  const buggyChunks: Row[][] = [];
  for (let at = 0; at < good.total; at += CHUNK) buggyChunks.push(rows2.slice(at, at + CHUNK));
  const buggyFlat = buggyChunks.flat();

  assert.equal(buggyFlat.length, good.total, "control: the bug sends exactly as many rows as it commits — server accounting passes, nothing looks wrong");
  assert.ok(buggyFlat.some((r) => !checks2[r.at].ok), "control: yet flagged rows DO upload — section 1's only-ready check is what catches this");
  const buggySent = new Set(buggyFlat.map((r) => r.at));
  assert.ok(good.rows.some((r) => !buggySent.has(r.at)), "control: and trailing ready rows silently vanish — section 1's completeness check catches this");
  // The fixed plan on the SAME fixture stays honest at the boundary.
  assert.ok(
    good.chunks.flat().every((r, k) => r === good.rows[k] && checks2[r.at].ok) && good.chunks.flat().length === good.total,
    "fixed plan sends exactly the ready rows even at the exact-multiple boundary",
  );
}

/* ── 3. "import everything anyway" and fail-open pre-check ────────────── */

{
  // skipFlagged=false: everything uploads, flagged included, in order.
  const all = planUploadChunks(allRows, checks, false, CHUNK);
  assert.equal(all.total, allRows.length, "import-everything must send every parsed row");
  assert.ok(all.chunks.flat().every((r, k) => r === allRows[k]), "import-everything must preserve original order");
  // checks null (pre-check unavailable → fail OPEN): skipFlagged has nothing
  // to skip; the server validates during upload instead.
  const open = planUploadChunks(allRows, null, true, CHUNK);
  assert.equal(open.total, allRows.length, "with no pre-check results, skip-flagged must fail open and send every row");
}

/* ── 4. boundaries: exact multiples, tiny files, nothing ready ────────── */

{
  const exact = planUploadChunks(allRows.slice(0, 2 * CHUNK), null, false, CHUNK);
  assert.equal(exact.chunks.length, 2, "an exact multiple must not add an empty trailing chunk");
  assert.ok(exact.chunks.every((c) => c.length === CHUNK));

  const tiny = planUploadChunks(allRows.slice(0, 5), null, false, CHUNK);
  assert.equal(tiny.chunks.length, 1, "a file smaller than one chunk uploads as a single chunk");
  assert.equal(tiny.total, 5);

  const noneReady = planUploadChunks(allRows.slice(0, 4), [{ ok: false }, { ok: false }, { ok: false }, { ok: false }], true, CHUNK);
  assert.equal(noneReady.total, 0, "nothing ready → total 0 (the page bails before creating a batch)");
  assert.equal(noneReady.chunks.length, 0, "nothing ready → no chunks, so no empty POST can fire");
}

/* ── 5. misuse is loud, never a silent wrong-rows upload ──────────────── */

assert.throws(
  () => planUploadChunks(allRows, checks.slice(0, 10), true, CHUNK),
  /don't line up/,
  "checks computed for a different row list must throw — index filtering would upload the wrong rows",
);
assert.throws(() => planUploadChunks(allRows, checks, true, 0), /positive integer/, "a zero chunk size must throw, not loop forever");

/* ── 6. the page actually routes uploads through the helper ──────────── */

assert.ok(
  /import \{[^}]*planUploadChunks[^}]*\} from "@\/lib\/afMath"/s.test(pageSource),
  "actuals-import.tsx must import planUploadChunks from afMath — the tested helper, not a local reimplementation",
);
assert.ok(
  pageSource.includes("planUploadChunks(parsed.rows, checks, skipFlagged, CHUNK)"),
  "startUpload must build its plan from the parsed rows + pre-check results via planUploadChunks",
);
assert.ok(
  pageSource.includes("for (const chunk of plan.chunks)"),
  "the upload loop must iterate the PLAN's chunks — reintroducing manual slicing is the regression this test exists for",
);
assert.ok(
  pageSource.includes("sendActualsImportRows(batchId, chunk)"),
  "each POST payload must be a plan chunk, untouched",
);
assert.ok(
  pageSource.includes("commitActualsImport(batchId, plan.total)"),
  "commit must receive the plan's total so accounting checks the rows actually sent",
);
assert.ok(
  pageSource.includes("if (plan.total === 0) return;"),
  "an empty plan must bail out before creating a server-side batch",
);
assert.ok(
  !pageSource.includes("toSend") && !/\.slice\(at\b/.test(pageSource),
  "no leftover manual selection/slicing may remain in the page — all of it lives in planUploadChunks",
);

console.log("actuals-import-chunking: all assertions passed");
