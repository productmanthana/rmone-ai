/**
 * check:cache-guards — cache bust key-shape lockstep gate (#737).
 * Run: npx tsx scripts/check-cache-bust-key-shape.ts
 *
 * Production incident (Aug 27, 2026): the record-detail cache keyed entries
 * `${tid}:${id}:${module ?? "auto"}` (3 segments) while every per-ticket bust
 * deleted `${tid}:${ticketId}` (2 segments). Map.delete() with a key shape
 * that can never equal a written key is a SILENT no-op — record pages served
 * pre-save values for the full TTL+grace (~35 min). The runtime companion
 * (src/lib/__tests__/projectDetailBustKey.test.ts) pins the fixed behaviour
 * for that one cache; this static gate catches the same CLASS of bug for
 * every module-scope Map in api-server src/routes + src/lib.
 *
 * How it works (TypeScript AST, no type checker):
 *   1. Collect module-scope `const x = new Map(...)` declarations, grouped
 *      into families (fooCache / fooInFlight / fooGen / fooBustAt share the
 *      key shape of family "foo") — trio maps are always keyed identically.
 *   2. Evidence of the WRITTEN key shape: template/string keys passed to
 *      .set/.get/.has — directly, via a local `const key = \`...\`` binding,
 *      via a pdKey-style key-constructor call (a module-scope function whose
 *      returns share one template shape), or one call hop through a helper
 *      whose parameter is the key (setXCacheIfCurrent-style wrappers).
 *   3. Every EXACT .delete() key with a resolvable shape (again: direct,
 *      local const, or one hop through a bustXLocal-style helper) must match
 *      a written shape for the family. Sweep deletes (keys obtained by
 *      iterating .keys()) are shape-safe by construction and skipped.
 *   4. Shape = number of literal ':' separators + 1; the ${...} holes don't
 *      matter, only the segment structure.
 *
 * Self-test canaries run FIRST — including the exact incident shape (inline
 * and behind a one-hop helper) — and the gate fails hard if the detector no
 * longer flags them: a vacuous pass is itself a failure (same philosophy as
 * the control scenarios in rdsCacheBustRace.test.ts). An anchor assertion
 * then requires the projectDetail family to be visible in rmone-proxy.ts
 * with 3-segment evidence, so a refactor that hides the maps from the
 * scanner cannot silently disable the gate.
 *
 * Exit code 0 = all good; 1 = violation or self-test failure.
 */

import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(here, "../src");

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL  " + msg); };
const ok = (msg: string) => console.log("ok    " + msg);

// ── Key-shape resolution ──────────────────────────────────────────────────────

/** Module-scope key-constructor functions (pdKey-style: a function whose
 *  resolvable returns all share one template shape) → segment count. Reset
 *  and populated per analyze() run; keyShape() consults it so `m.get(pdKey(
 *  tid, id))` and `const k = pdKey(...)` carry the constructor's shape. */
let activeCtorShapes = new Map<string, number>();

/** Segment count of a statically-known key expression, or undefined. */
function keyShape(e: ts.Expression): number | undefined {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    return e.text.split(":").length;
  }
  if (ts.isTemplateExpression(e)) {
    let colons = (e.head.text.match(/:/g) ?? []).length;
    for (const span of e.templateSpans) colons += (span.literal.text.match(/:/g) ?? []).length;
    return colons + 1;
  }
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) &&
      (e.expression.name.text === "toLowerCase" || e.expression.name.text === "toUpperCase")) {
    return keyShape(e.expression.expression);
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    return activeCtorShapes.get(e.expression.text);
  }
  if (ts.isParenthesizedExpression(e)) return keyShape(e.expression);
  return undefined;
}

/** Register module-scope key constructors: functions whose shape-resolvable
 *  return expressions agree on one segment count (unresolvable returns, e.g.
 *  a param passthrough in a normalizer, are ignored; conflicting shapes
 *  disqualify). Two rounds so a canonicalizer returning another
 *  constructor's call (pdNormalizeKey → pdKey) resolves too. */
function collectKeyConstructors(parsed: { file: string; sf: ts.SourceFile }[], into: Map<string, number>): void {
  const bodies = new Map<string, ts.ConciseBody>();
  for (const { sf } of parsed) {
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name && ts.isIdentifier(stmt.name) && stmt.body) {
        bodies.set(stmt.name.text, stmt.body);
      } else if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer &&
              (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
            bodies.set(d.name.text, d.initializer.body);
          }
        }
      }
    }
  }
  for (let round = 0; round < 2; round++) {
    for (const [name, body] of bodies) {
      if (into.has(name)) continue;
      const returns: ts.Expression[] = [];
      if (!ts.isBlock(body)) {
        returns.push(body);
      } else {
        const walk = (n: ts.Node): void => {
          if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n)) return;
          if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
          ts.forEachChild(n, walk);
        };
        ts.forEachChild(body, walk);
      }
      let found: number | undefined;
      let conflict = false;
      for (const r of returns) {
        const s = keyShape(r); // consults activeCtorShapes → round 2 sees round 1
        if (s === undefined) continue;
        if (found !== undefined && found !== s) { conflict = true; break; }
        found = s;
      }
      if (!conflict && found !== undefined) into.set(name, found);
    }
  }
}

type Resolved =
  | { kind: "shape"; segments: number }
  | { kind: "param"; fn: ts.SignatureDeclaration; index: number }
  | { kind: "skip" }; // swept key (for-of over .keys()), or statically unknown

/** Resolve a key expression: direct shape, nearest lexical `const` template,
 *  enclosing-function parameter, or skip (unknown / iterated sweep key). */
function resolveKeyExpr(e: ts.Expression): Resolved {
  const direct = keyShape(e);
  if (direct !== undefined) return { kind: "shape", segments: direct };
  if (!ts.isIdentifier(e)) return { kind: "skip" };
  const name = e.text;
  let node: ts.Node = e;
  while (node.parent) {
    const parent: ts.Node = node.parent;
    if (ts.isFunctionLike(parent)) {
      const idx = parent.parameters.findIndex(
        (p) => ts.isIdentifier(p.name) && p.name.text === name);
      if (idx >= 0) return { kind: "param", fn: parent, index: idx };
    }
    const stmts = ts.isBlock(parent) ? parent.statements
      : ts.isSourceFile(parent) ? parent.statements
      : ts.isModuleBlock(parent) ? parent.statements
      : (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) ? parent.statements
      : undefined;
    if (stmts) {
      for (const s of stmts) {
        if (!ts.isVariableStatement(s)) continue;
        for (const d of s.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) {
            const shp = keyShape(d.initializer);
            return shp !== undefined ? { kind: "shape", segments: shp } : { kind: "skip" };
          }
        }
      }
    }
    if (ts.isForOfStatement(parent) && ts.isVariableDeclarationList(parent.initializer)) {
      for (const d of parent.initializer.declarations) {
        // Keys obtained by iteration (sweep over .keys() / Set unions) always
        // exist in the map — shape-safe by construction.
        if (ts.isIdentifier(d.name) && d.name.text === name) return { kind: "skip" };
      }
    }
    node = parent;
  }
  return { kind: "skip" };
}

/** Name of a module-scope function (declaration or `const f = ...`). */
function functionName(fn: ts.SignatureDeclaration): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name && ts.isIdentifier(fn.name)) {
    return fn.name.text;
  }
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
      fn.parent && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) {
    return fn.parent.name.text;
  }
  return undefined;
}

/** True when `id` (used as a map receiver) is shadowed by a non-module-scope
 *  declaration — a local `const cache = new Map()` must not be attributed to
 *  a module map of the same name. */
function isShadowed(id: ts.Identifier): boolean {
  const name = id.text;
  let node: ts.Node = id;
  while (node.parent) {
    const parent: ts.Node = node.parent;
    if (ts.isFunctionLike(parent)) {
      if (parent.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name)) return true;
    }
    const stmts = ts.isBlock(parent) ? parent.statements
      : (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) ? parent.statements
      : undefined;
    if (stmts) {
      for (const s of stmts) {
        if (!ts.isVariableStatement(s)) continue;
        for (const d of s.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name) return true;
        }
      }
    }
    if (ts.isForOfStatement(parent) && ts.isVariableDeclarationList(parent.initializer)) {
      for (const d of parent.initializer.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) return true;
      }
    }
    node = parent;
  }
  return false;
}

// ── Analysis model ────────────────────────────────────────────────────────────

const FAMILY_SUFFIXES = ["Cache", "InFlight", "Gen", "BustAt"];
function familyOf(mapName: string): string {
  for (const suf of FAMILY_SUFFIXES) {
    if (mapName.length > suf.length && mapName.endsWith(suf)) {
      return mapName.slice(0, -suf.length);
    }
  }
  return mapName;
}

interface MapInfo { file: string; mapName: string; family: string }
interface DeleteSite { file: string; line: number; mapName: string; family: string; segments: number; via?: string }
interface Analysis {
  maps: MapInfo[];
  /** family key = `${file}#${family}` → set of written-key segment counts */
  evidence: Map<string, Set<number>>;
  deletes: DeleteSite[];
  checkedDeletes: number;
}

interface HelperOp { file: string; mapName: string; family: string; op: "set" | "get" | "has" | "delete"; paramIndex: number }

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function analyze(sources: { file: string; text: string }[]): Analysis {
  const maps: MapInfo[] = [];
  const mapsByFile = new Map<string, Map<string, MapInfo>>();
  const evidence = new Map<string, Set<number>>();
  const deletes: DeleteSite[] = [];
  // One-hop helper registry (global across files: bust helpers are exported
  // and called cross-module) + recorded plain calls to resolve afterwards.
  const helpers = new Map<string, HelperOp[]>();
  const plainCalls: { name: string; call: ts.CallExpression; sf: ts.SourceFile; file: string }[] = [];

  const famKey = (info: MapInfo) => `${info.file}#${info.family}`;
  const addEvidence = (info: MapInfo, segments: number) => {
    const k = famKey(info);
    if (!evidence.has(k)) evidence.set(k, new Set());
    evidence.get(k)!.add(segments);
  };

  const parsed = sources.map(({ file, text }) => ({
    file,
    sf: ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true),
  }));

  // Pass A0: key-constructor functions (pdKey-style), so constructor-built
  // keys carry their shape through gets/sets/deletes and local consts.
  activeCtorShapes = new Map();
  collectKeyConstructors(parsed, activeCtorShapes);

  // Pass A: module-scope map declarations.
  for (const { file, sf } of parsed) {
    const byName = new Map<string, MapInfo>();
    mapsByFile.set(file, byName);
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        let init: ts.Expression = d.initializer;
        if (ts.isAsExpression(init)) init = init.expression;
        if (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "Map") {
          const info: MapInfo = { file, mapName: d.name.text, family: familyOf(d.name.text) };
          maps.push(info);
          byName.set(info.mapName, info);
        }
      }
    }
  }

  // Pass B: map operations + helper registration + call collection.
  for (const { file, sf } of parsed) {
    const byName = mapsByFile.get(file)!;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
          const op = callee.name.text;
          const info = byName.get(callee.expression.text);
          if (info && (op === "set" || op === "get" || op === "has" || op === "delete") &&
              node.arguments.length > 0 && !isShadowed(callee.expression)) {
            const r = resolveKeyExpr(node.arguments[0]);
            if (r.kind === "shape") {
              if (op === "delete") {
                deletes.push({ file, line: lineOf(sf, node), mapName: info.mapName, family: info.family, segments: r.segments });
              } else {
                addEvidence(info, r.segments);
              }
            } else if (r.kind === "param") {
              const fnName = functionName(r.fn);
              if (fnName) {
                if (!helpers.has(fnName)) helpers.set(fnName, []);
                helpers.get(fnName)!.push({ file, mapName: info.mapName, family: info.family, op: op as HelperOp["op"], paramIndex: r.index });
              }
            }
          }
        } else if (ts.isIdentifier(callee)) {
          plainCalls.push({ name: callee.text, call: node, sf, file });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // Pass C: one-hop resolution — a helper's key parameter takes the shape of
  // each call site's argument (setXCacheIfCurrent / bustXLocal wrappers).
  for (const pc of plainCalls) {
    const ops = helpers.get(pc.name);
    if (!ops) continue;
    for (const h of ops) {
      const arg = pc.call.arguments[h.paramIndex];
      if (!arg) continue;
      const r = resolveKeyExpr(arg);
      if (r.kind !== "shape") continue; // swept/unknown/param-of-param — safe to skip
      const info: MapInfo = { file: h.file, mapName: h.mapName, family: h.family };
      if (h.op === "delete") {
        deletes.push({
          file: pc.file, line: lineOf(pc.sf, pc.call), mapName: h.mapName,
          family: h.family, segments: r.segments, via: pc.name,
        });
      } else {
        addEvidence(info, r.segments);
      }
    }
  }

  return { maps, evidence, deletes, checkedDeletes: deletes.length };
}

/** Deletes whose key shape can never match any written key of the family. */
function violationsOf(a: Analysis): (DeleteSite & { known: number[] })[] {
  const out: (DeleteSite & { known: number[] })[] = [];
  for (const d of a.deletes) {
    const known = a.evidence.get(`${d.file}#${d.family}`);
    if (!known || known.size === 0) continue; // no shape evidence — cannot judge
    if (!known.has(d.segments)) out.push({ ...d, known: [...known].sort() });
  }
  return out;
}

// ── Self-test canaries (the gate must be able to FAIL) ───────────────────────

const CANARY_BAD_INLINE = `
const fooCache = new Map<string, { data: unknown; expiresAt: number }>();
const fooInFlight = new Map<string, Promise<unknown>>();
function readFoo(tid: string, id: string, module?: string) {
  const cacheKey = \`\${tid}:\${id}:\${module ?? "auto"}\`;
  const hit = fooCache.get(cacheKey);
  if (!hit) fooCache.set(cacheKey, { data: 1, expiresAt: Date.now() });
  return hit;
}
export function bustFoo(tid: string, ticketId?: string) {
  if (ticketId) {
    fooCache.delete(\`\${tid}:\${ticketId}\`);
    fooInFlight.delete(\`\${tid}:\${ticketId}\`);
  }
}
`;

const CANARY_BAD_ONEHOP = `
const barCache = new Map<string, unknown>();
function readBar(tid: string, id: string) {
  const key = \`\${tid}:\${id}:auto\`;
  barCache.set(key, 1);
}
function bustBarLocal(cacheKey: string) {
  barCache.delete(cacheKey);
}
export function bustBar(tid: string, ticketId: string) {
  bustBarLocal(\`\${tid}:\${ticketId}\`);
}
`;

const CANARY_BAD_CTOR = `
const quxCache = new Map<string, unknown>();
const QUX_MODULES = new Set(["PMM", "OPM"]);
function quxSeg(id: string): string { return String(id).trim().toUpperCase(); }
function quxKey(tid: string, id: string, mod?: string): string {
  return \`\${tid}:\${quxSeg(id)}:\${mod && QUX_MODULES.has(mod) ? mod : "auto"}\`;
}
function readQux(tid: string, id: string, mod?: string) {
  const cacheKey = quxKey(tid, id, mod);
  quxCache.set(cacheKey, 1);
}
export function bustQux(tid: string, ticketId: string) {
  quxCache.delete(\`\${tid}:\${ticketId}\`);
}
`;

const CANARY_GOOD = `
const bazCache = new Map<string, unknown>();
const bazGen = new Map<string, number>();
function readBaz(tid: string, id: string, module?: string) {
  const cacheKey = \`\${tid}:\${id}:\${module ?? "auto"}\`;
  bazCache.set(cacheKey, 1);
  bazGen.set(cacheKey, 0);
}
function bustBazLocal(cacheKey: string) {
  bazGen.set(cacheKey, (bazGen.get(cacheKey) ?? 0) + 1);
  bazCache.delete(cacheKey);
}
export function bustBaz(tid: string, ticketId?: string) {
  if (ticketId) {
    const prefix = \`\${tid}:\${ticketId}:\`.toLowerCase();
    const keys = new Set<string>([...bazCache.keys(), ...bazGen.keys()]);
    for (const k of keys) {
      if (k.toLowerCase().startsWith(prefix)) bustBazLocal(k);
    }
  } else {
    for (const k of bazCache.keys()) if (k.startsWith(\`\${tid}:\`)) bazCache.delete(k);
  }
  bazCache.delete(\`\${tid}:\${ticketId}:auto\`);
}
`;

function selfTest(): void {
  const badInline = violationsOf(analyze([{ file: "canary-bad-inline.ts", text: CANARY_BAD_INLINE }]));
  if (badInline.length === 2 &&
      badInline.some((v) => v.mapName === "fooCache") &&
      badInline.some((v) => v.mapName === "fooInFlight")) {
    ok("self-test: incident shape (3-segment writes, 2-segment inline delete) is flagged on cache + inFlight");
  } else {
    fail(`self-test: incident canary produced ${badInline.length} violation(s) ` +
      `[${badInline.map((v) => v.mapName).join(", ")}] — expected fooCache + fooInFlight. ` +
      "The detector has gone blind; fix the gate before trusting it.");
  }

  const badOneHop = violationsOf(analyze([{ file: "canary-bad-onehop.ts", text: CANARY_BAD_ONEHOP }]));
  if (badOneHop.length === 1 && badOneHop[0].mapName === "barCache" && badOneHop[0].via === "bustBarLocal") {
    ok("self-test: 2-segment key smuggled through a bustXLocal helper hop is flagged");
  } else {
    fail(`self-test: one-hop canary produced ${badOneHop.length} violation(s) — expected exactly barCache via bustBarLocal`);
  }

  const badCtor = violationsOf(analyze([{ file: "canary-bad-ctor.ts", text: CANARY_BAD_CTOR }]));
  if (badCtor.length === 1 && badCtor[0].mapName === "quxCache" &&
      badCtor[0].segments === 2 && badCtor[0].known.join(",") === "3") {
    ok("self-test: constructor-built keys (pdKey-style) carry evidence — 2-segment delete vs ctor 3-segment writes is flagged");
  } else {
    fail(`self-test: constructor canary produced ${badCtor.length} violation(s) ` +
      `[${badCtor.map((v) => `${v.mapName}:${v.segments} vs {${v.known.join(",")}}`).join("; ")}] — ` +
      "expected exactly quxCache 2 vs {3}. Constructor resolution has gone blind (main's pdKey refactor " +
      "routes ALL projectDetail keys through a constructor, so without this the anchor loses its evidence).");
  }

  const good = violationsOf(analyze([{ file: "canary-good.ts", text: CANARY_GOOD }]));
  if (good.length === 0) {
    ok("self-test: correct pattern (prefix sweep + matching exact delete) produces no violations");
  } else {
    fail(`self-test: good canary false-positive(s): ${good.map((v) => `${v.mapName}@${v.line}`).join(", ")}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(p));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

selfTest();

const files = [...listTsFiles(join(SRC_ROOT, "routes")), ...listTsFiles(join(SRC_ROOT, "lib"))];
const analysis = analyze(files.map((f) => ({ file: f, text: readFileSync(f, "utf-8") })));

const familiesWithEvidence = [...analysis.evidence.entries()].filter(([, s]) => s.size > 0).length;
console.log(`scanned ${files.length} files: ${analysis.maps.length} module-scope Maps, ` +
  `${familiesWithEvidence} cache families with key-shape evidence, ` +
  `${analysis.checkedDeletes} exact delete site(s) checked`);

// Debug aid: `--dump-families` prints every family's written key shapes.
if (process.argv.includes("--dump-families")) {
  for (const [k, s] of [...analysis.evidence.entries()].sort()) {
    const [file, family] = k.split("#");
    console.log(`  ${relative(join(here, ".."), file)} # ${family} → {${[...s].sort().join(",")}}`);
  }
}

// Anchor: the incident cache must stay visible to the scanner — if a refactor
// hides projectDetail* from pass A/B the whole gate would pass vacuously. It
// must also be written with EXACTLY 3-segment keys: any stray 2-segment write
// (like the pre-fix hot-rewarm's `${tid}:${id}` detail warm, which populated
// entries no route lookup ever read) would count as evidence and make the
// incident's 2-segment no-op delete look legal to this gate.
{
  const proxyFile = files.find((f) => f.endsWith("rmone-proxy.ts"));
  const anchor = proxyFile ? analysis.evidence.get(`${proxyFile}#projectDetail`) : undefined;
  const anchorMaps = analysis.maps.filter((m) => m.family === "projectDetail" && m.file === proxyFile);
  if (proxyFile && anchor && anchor.size === 1 && anchor.has(3) && anchorMaps.length >= 3) {
    ok(`anchor: projectDetail family visible in rmone-proxy.ts (${anchorMaps.length} maps, written shapes exactly {3})`);
  } else {
    fail("anchor: the projectDetail cache family (rmone-proxy.ts) must be visible to the scanner with " +
      `EXACTLY {3}-segment written keys (found maps=${anchorMaps.length}, shapes={${anchor ? [...anchor].sort().join(",") : ""}}). ` +
      "A non-3-segment write re-masks the incident's 2-segment no-op delete; if the caches were " +
      "renamed/moved, update this gate — do not let it go blind.");
  }
}

const violations = violationsOf(analysis);
for (const v of violations) {
  const rel = relative(join(here, ".."), v.file);
  fail(`${rel}:${v.line} — ${v.mapName}.delete(${v.via ? `via ${v.via}` : "…"}) uses a ${v.segments}-segment key, ` +
    `but "${v.family}" entries are written with {${v.known.join(", ")}}-segment keys. ` +
    "This delete can never match a written key — a silent no-op bust (the Aug 2026 stale-record incident). " +
    "Bust by prefix sweep over .keys() (see bustProjectDetailForTicketLocal) or fix the key to the written shape.");
}
if (violations.length === 0) ok("no cache has an exact-delete key shape that its writers never produce");

// ── Summary ───────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll cache bust key-shape checks passed.");
}
