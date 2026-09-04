/**
 * check:db-env-names — retired DB env-name gate.
 * Run: npx tsx scripts/check-db-env-names.ts
 *
 * The app-DB connection secret is APP_DATABASE_URL (canonical since Sep
 * 2026). Two older names existed before the rename — the values of RETIRED
 * and LEGACY below, deliberately never written contiguously in this file so
 * the gate's own text scan stays clean. For a transition window they were
 * tolerated as later operands of a canonical-first ||/?? fallback chain.
 * That window is CLOSED: every environment (the dev workspace, all Elastic
 * Beanstalk envs) stores the secret under APP_DATABASE_URL only, and the
 * owner asked for the retired name to be gone from the source tree
 * entirely.
 *
 * THE RULES:
 *   1. TEXT BAN (every non-binary file, any extension — code, shell,
 *      Terraform, docs, config, INCLUDING the hidden source dirs .github,
 *      .agents and .husky, coverage-asserted below; other dot-DIRS are
 *      platform/vendored/generated and stay out, and dot-FILES (.env*,
 *      .npmrc, …) stay out because they hold runtime config whose secret
 *      VALUES the violation printer would echo): the RETIRED name must not
 *      appear anywhere, not even in a comment. The older LEGACY name may
 *      appear ONLY in the migration-source contract files
 *      (TEXT_LEGACY_ALLOW): scripts/migrate-to-aws.sh injects it (from
 *      MIGRATION_SOURCE_DB_URL) and
 *      artifacts/api-server/scripts/migrate-to-aws.mjs reads it — that URL
 *      is the migration SOURCE and deliberately NOT the app's own. Agent
 *      memory (.agents/memory/) may also NAME the legacy contract when
 *      documenting it; the retired name has no such allowance.
 *   2. AST BAN (ts/js files): ANY process-env access of either name — read,
 *      write, destructure, optional chaining, bracket form, folded string
 *      construction, for-of key lists — is a violation regardless of where
 *      it sits in a fallback chain (the old canonical-first-chain approval
 *      is gone). Only migrate-to-aws.mjs may access the LEGACY name.
 *
 *      ANCHORS: an env access is recognized from every static route to the
 *      process object — the identifier `process`, the global object
 *      (`globalThis` / Node's `global`, chained: globalThis.global.process…),
 *      and inline `require("process" | "node:process")`. EVERY segment
 *      reachable from an anchor must constant-fold ("pro"+"cess", "e"+"nv",
 *      keys); an UNFOLDABLE selection on an anchor (process[k], globalThis[k],
 *      global[k]) FAILS CLOSED — it could be ["env"] / ["process"]. There is
 *      deliberately NO text prefilter for the AST pass: constant folding
 *      means no contiguous token is guaranteed to appear in evasive code, so
 *      every code file is fully parsed (~2s). The text pass (rule 1) is an
 *      ADDITIONAL detector for the plain spelling, not a shortcut.
 *      (Out of syntactic reach by design: aliasing process/process.env into
 *      another variable, eval/Function, and non-inline module bindings —
 *      that is code review's job, not this gate's. `window`/`self` are not
 *      anchors: Node code — the only place the DB secrets exist — has no
 *      such bindings on the global object.)
 *   3. Dynamic process.env[…] keys FAIL CLOSED unless they resolve via the
 *      one supported shape: `for (const k of <array of string literals>)`
 *      (inline, or a uniquely-named same-file const array).
 *
 * Self-test canaries run FIRST — one per known bypass class — and the gate
 * fails hard if a detector no longer flags them: a vacuous pass is itself a
 * failure (same philosophy as check-cache-bust-key-shape.ts).
 *
 * Exit code 0 = all good; 1 = violation or self-test failure.
 */

import ts from "typescript";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "../../..");

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL  " + msg); };
const ok = (msg: string) => console.log("ok    " + msg);

// ── The banned names ─────────────────────────────────────────────────────────
// Built from parts so neither token appears contiguously in this file — the
// gate must pass its own text scan without a self-exemption.

/** Retired pre-rename secret name (banned EVERYWHERE, even in comments). */
const RETIRED = ["NEW_CLIENT", "DB_URL"].join("_");
/** Oldest name; survives ONLY as the migration-source contract. */
const LEGACY = ["CLIENT", "DB_URL"].join("_");
const BANNED_ENV_NAMES = new Set([RETIRED, LEGACY]);
const CANONICAL = "APP_DATABASE_URL";

export interface Violation { line: number; text: string; reason: string; names?: string[] }

// ── AST detector (comments and strings are invisible to it) ─────────────────

/** Peel parens, non-null assertions and `as` casts. */
function unwrap(e: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isAsExpression(e)
  ) e = e.expression;
  return e;
}

/** The global object: `globalThis`, Node's `global`, and any foldable
 *  self-referencing chain (globalThis.global, global["globalThis"], …). */
const GLOBAL_OBJ_IDENTS = new Set(["globalThis", "global"]);
function isGlobalObjectExpr(e: ts.Expression): boolean {
  const u = unwrap(e);
  if (ts.isIdentifier(u) && GLOBAL_OBJ_IDENTS.has(u.text)) return true;
  if (ts.isPropertyAccessExpression(u) && GLOBAL_OBJ_IDENTS.has(u.name.text)) {
    return isGlobalObjectExpr(u.expression);
  }
  if (ts.isElementAccessExpression(u)) {
    const key = literalText(u.argumentExpression);
    if (key !== undefined && GLOBAL_OBJ_IDENTS.has(key)) return isGlobalObjectExpr(u.expression);
  }
  return false;
}

/** Every static route to the process object: the `process` identifier, a
 *  foldable "process" selection off the global object, or an inline
 *  require("process" | "node:process"). */
function isProcessIdent(e: ts.Expression): boolean {
  const u = unwrap(e);
  if (ts.isIdentifier(u) && u.text === "process") return true;
  if (ts.isPropertyAccessExpression(u) && u.name.text === "process") {
    return isGlobalObjectExpr(u.expression);
  }
  if (ts.isElementAccessExpression(u) && literalText(u.argumentExpression) === "process") {
    return isGlobalObjectExpr(u.expression);
  }
  if (ts.isCallExpression(u) && u.arguments.length === 1) {
    const callee = unwrap(u.expression);
    const mod = literalText(u.arguments[0]);
    if (ts.isIdentifier(callee) && callee.text === "require" && (mod === "process" || mod === "node:process")) {
      return true;
    }
  }
  return false;
}

/** Is this expression `process.env` (process.env / process?.env /
 *  process["env"] / globalThis.process.env)? */
function isProcessEnv(e: ts.Expression): boolean {
  const u = unwrap(e);
  if (ts.isPropertyAccessExpression(u) && u.name.text === "env" && isProcessIdent(u.expression)) return true;
  if (
    ts.isElementAccessExpression(u) &&
    literalText(u.argumentExpression) === "env" &&
    isProcessIdent(u.expression)
  ) return true;
  return false;
}

/** Constant-fold an expression to a string: literals, no-sub templates,
 *  templates whose holes fold, and `+` concatenations of foldable parts. */
function literalText(e: ts.Expression): string | undefined {
  const u = unwrap(e);
  if (ts.isStringLiteralLike(u)) return u.text;
  if (ts.isTemplateExpression(u)) {
    let s = u.head.text;
    for (const span of u.templateSpans) {
      const inner = literalText(span.expression);
      if (inner === undefined) return undefined;
      s += inner + span.literal.text;
    }
    return s;
  }
  if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = literalText(u.left);
    const r = literalText(u.right);
    return l !== undefined && r !== undefined ? l + r : undefined;
  }
  return undefined;
}

/** Fold an array literal of foldable strings; undefined if any element
 *  doesn't fold. */
function foldStringArray(e: ts.Expression): string[] | undefined {
  const u = unwrap(e);
  if (!ts.isArrayLiteralExpression(u)) return undefined;
  const out: string[] = [];
  for (const el of u.elements) {
    const s = literalText(el);
    if (s === undefined) return undefined;
    out.push(s);
  }
  return out;
}

/** The ONE supported dynamic-key shape: `for (const k of LIST) …
 *  process.env[k]` where LIST is an inline array of string literals or a
 *  uniquely-named const array of string literals in the same file. Returns
 *  the folded names, or undefined (→ caller fails closed). */
function resolveForOfKeys(arg: ts.Expression, sf: ts.SourceFile): string[] | undefined {
  const u = unwrap(arg);
  if (!ts.isIdentifier(u)) return undefined;
  const varName = u.text;
  // Nearest enclosing for-of that binds this identifier.
  for (let cur: ts.Node | undefined = u.parent; cur; cur = cur.parent) {
    if (!ts.isForOfStatement(cur)) continue;
    const init = cur.initializer;
    if (!ts.isVariableDeclarationList(init)) continue;
    const binds = init.declarations.some(
      (d) => ts.isIdentifier(d.name) && d.name.text === varName,
    );
    if (!binds) continue;
    const iterated = unwrap(cur.expression);
    const direct = foldStringArray(iterated);
    if (direct) return direct;
    if (ts.isIdentifier(iterated)) {
      // One hop: a uniquely-named const string-array in this file.
      const decls: ts.VariableDeclaration[] = [];
      const collect = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === iterated.text) decls.push(n);
        ts.forEachChild(n, collect);
      };
      collect(sf);
      if (decls.length === 1 && decls[0].initializer) return foldStringArray(decls[0].initializer);
    }
    return undefined;
  }
  return undefined;
}

const DYNAMIC = Symbol("dynamic");
/** If node accesses process.env.<key(s)>, return the statically-known key
 *  names, or DYNAMIC when the key cannot be resolved. undefined = not a
 *  process.env access at all. */
function envKeyNames(node: ts.Node, sf: ts.SourceFile): string[] | typeof DYNAMIC | undefined {
  if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) return [node.name.text];
  if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression)) {
    const lit = literalText(node.argumentExpression);
    if (lit !== undefined) return [lit];
    return resolveForOfKeys(node.argumentExpression, sf) ?? DYNAMIC;
  }
  return undefined;
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (/\.(tsx|jsx)$/.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.(js|mjs|cjs)$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Find every process-env access of a banned DB name (any position, any
 *  chain — there is no approved fallback shape anymore), plus unverifiable
 *  dynamic process.env keys. */
export function findLegacyDbEnvViolations(source: string, fileName = "candidate.ts"): Violation[] {
  // No text prefilter, on purpose: constant-folding means no contiguous
  // token is guaranteed to appear ("pro"+"cess"). Every file is parsed.
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, scriptKindFor(fileName));
  const out: Violation[] = [];
  const record = (n: ts.Node, reason: string, names?: string[]) => {
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
    out.push({ line: line + 1, text: (source.split(/\r?\n/)[line] ?? "").trim(), reason, names });
  };

  const visit = (n: ts.Node): void => {
    // Fail closed on a dynamic property SELECTION on an anchor — process[x]
    // could be process["env"], globalThis[x] / global[x] could be
    // ["process"]. Every segment reachable from an anchor must fold or the
    // gate cannot reason about anything built on top of it.
    if (ts.isElementAccessExpression(n) && literalText(n.argumentExpression) === undefined) {
      if (isProcessIdent(n.expression)) {
        record(n, `dynamic property selection on process — the gate cannot prove this is not process["env"]`);
      } else if (isGlobalObjectExpr(n.expression)) {
        record(n, `dynamic property selection on the global object — the gate cannot prove this is not globalThis["process"]`);
      }
    }
    const keys = envKeyNames(n, sf);
    if (keys === DYNAMIC) {
      record(n, `dynamic process.env[…] key the gate cannot resolve — it cannot prove this never reads a banned DB name (supported: literal keys, or for-of over a same-file const array of string literals)`);
    } else if (Array.isArray(keys)) {
      const banned = keys.filter((k) => BANNED_ENV_NAMES.has(k));
      if (banned.length > 0) {
        record(n, `process-env access of ${banned.join("/")} — banned name (canonical: process.env.${CANONICAL})`, banned);
      }
    }
    // Destructuring a banned name from process.env.
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isObjectBindingPattern(n.name)) {
      let touchesEnv = false;
      const probe = (m: ts.Node): void => {
        if (touchesEnv) return;
        if (ts.isExpression(m) && isProcessEnv(m)) { touchesEnv = true; return; }
        ts.forEachChild(m, probe);
      };
      probe(n.initializer);
      if (touchesEnv) {
        for (const el of n.name.elements) {
          let bound: string | undefined;
          const pn = el.propertyName;
          if (pn && ts.isIdentifier(pn)) bound = pn.text;
          else if (pn && ts.isStringLiteralLike(pn)) bound = pn.text;
          else if (pn && ts.isComputedPropertyName(pn)) {
            bound = literalText(pn.expression);
            if (bound === undefined) {
              record(el, `dynamic computed key destructured from process.env — the gate cannot prove it is not a banned DB name`);
              continue;
            }
          } else if (ts.isIdentifier(el.name)) bound = el.name.text;
          if (bound && BANNED_ENV_NAMES.has(bound)) {
            record(el, `destructures ${bound} from process.env — banned name`, [bound]);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// ── Text detector (the plain spelling, any file type) ───────────────────────

export interface TokenHit { line: number; text: string; name: string }

// Standalone LEGACY occurrences only: a occurrence of the RETIRED name also
// contains the LEGACY name as a substring, and must be reported ONCE (as
// RETIRED). The lookbehind excludes any [A-Za-z0-9_] run leading into it.
const legacyStandaloneRe = new RegExp("(?<![A-Za-z0-9_])" + LEGACY);

/** Every line containing a banned token. RETIRED matches as a plain
 *  substring (strictest — the word must be gone); LEGACY only when not
 *  preceded by an identifier character. Case-sensitive: these are exact
 *  env-var spellings, and case-mangled evasions that reach process.env are
 *  the AST pass's job. */
export function findBannedTokens(content: string): TokenHit[] {
  const out: TokenHit[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.includes(RETIRED)) out.push({ line: i + 1, text: ln.trim(), name: RETIRED });
    if (legacyStandaloneRe.test(ln)) out.push({ line: i + 1, text: ln.trim(), name: LEGACY });
  }
  return out;
}

// ── Self-test canaries (a vacuous pass is a failure) ─────────────────────────

function canary(label: string, source: string, expectViolations: number) {
  const got = findLegacyDbEnvViolations(source, "canary.ts").length;
  if (got === expectViolations) ok(`canary: ${label}`);
  else fail(`canary: ${label} — expected ${expectViolations} violation(s), got ${got}`);
}

// AST — must FLAG:
canary("bare dot read of the legacy name flags",
  `const u = new URL(process.env.${LEGACY});`, 1);
canary("bare dot read of the retired name flags",
  `const url = process.env.${RETIRED};`, 1);
canary("bare bracket read flags",
  `const raw = process.env["${RETIRED}"] ?? "";`, 1);
canary("optional chaining flags (process.env?.X)",
  `const u = process.env?.${LEGACY};`, 1);
canary("deep optional chaining + bracket flags",
  `const u = process?.env?.["${RETIRED}"];`, 1);
canary("globalThis.process.env read flags",
  `const u = globalThis.process.env.${LEGACY};`, 1);
canary("env WRITE of a banned name flags",
  `process.env.${RETIRED} = "mssql://x";`, 1);
canary("banned-first chain flags",
  `const url = process.env.${RETIRED} || process.env.${CANONICAL};`, 1);
canary("RETIREMENT FLIP: the once-approved canonical-first chain now flags BOTH operands",
  `const url = process.env.${CANONICAL} || process.env.${RETIRED} || process.env.${LEGACY};`, 2);
canary("retirement flip: multi-line chain (trailing ||) flags both", [
  `const url =`,
  `  process.env.${CANONICAL} ||`,
  `  process.env.${RETIRED} ||`,
  `  process.env.${LEGACY};`,
].join("\n"), 2);
canary("retirement flip: ?? bracket chain flags both", [
  `const raw = process.env["${CANONICAL}"] ??`,
  `  process.env["${RETIRED}"] ??`,
  `  process.env["${LEGACY}"] ?? "";`,
].join("\n"), 2);
canary("retirement flip: parenthesized + non-null chain flags both",
  `const url = (process.env.${CANONICAL} || process.env.${RETIRED} || process.env.${LEGACY})!;`, 2);
canary("retirement flip: presence check !!(chain) flags both",
  `const configured = !!(process.env.${CANONICAL} || process.env.${RETIRED} || process.env.${LEGACY});`, 2);
canary("retirement flip: chain as a call argument flags",
  `const u = new URL(process.env.${CANONICAL} || process.env.${LEGACY});`, 1);
canary("computed key folds: two-part concat flags (reviewer bypass)",
  `const u = process.env["${LEGACY.slice(0, 6)}" + "${LEGACY.slice(6)}"];`, 1);
canary("computed key folds: template literal flags",
  "const u = process.env[`" + RETIRED.slice(0, 10) + '${"' + RETIRED.slice(10, 13) + '"}' + RETIRED.slice(13) + "`];", 1);
canary("unresolvable dynamic key fails closed",
  `function f(name) { return process.env[name]; }`, 1);
canary("bracket-env dynamic key fails closed (reviewer bypass)",
  `function f(key) { return process["env"][key]; }`, 1);
canary("bracket-env folded computed banned key flags (reviewer bypass)",
  `const v = process["env"]["${LEGACY.slice(0, 6)}" + "${LEGACY.slice(6)}"];`, 1);
canary("optional bracket-env dynamic key fails closed (reviewer bypass)",
  `function f(key) { return process?.["env"]?.[key]; }`, 1);
canary("globalThis bracket-process banned read flags",
  `const v = globalThis["process"].env.${LEGACY};`, 1);
canary("folded env segment flags: process['e'+'nv'][banned] (reviewer bypass)",
  `const v = process["e" + "nv"]["${LEGACY}"];`, 1);
canary("folded process segment flags: globalThis['pro'+'cess'] (reviewer bypass)",
  `const v = globalThis["pro" + "cess"].env.${LEGACY};`, 1);
canary("folded env segment + dot key flags",
  `const v = process["e" + "nv"].${RETIRED};`, 1);
canary("dynamic property selection on process fails closed",
  `function f(k) { return process[k]["${LEGACY}"]; }`, 1);
canary("dynamic selection on globalThis fails closed (reviewer bypass)",
  `function f(k) { return globalThis[k].env.${LEGACY}; }`, 1);
canary("dynamic selection on globalThis, bracket form, fails closed",
  `function f(k) { return globalThis[k]["env"]["${LEGACY}"]; }`, 1);
canary("dynamic selection on globalThis, optional chain, fails closed",
  `function f(k) { return globalThis?.[k]?.env?.${LEGACY}; }`, 1);
canary("dynamic selection on Node global fails closed",
  `function f(k) { return global[k]; }`, 1);
canary("Node global.process banned read flags",
  `const v = global.process.env.${LEGACY};`, 1);
canary("chained global object anchor flags: globalThis.global.process",
  `const v = globalThis.global.process.env.${RETIRED};`, 1);
canary("inline require('node:process') banned read flags",
  `const v = require("node:process").env.${LEGACY};`, 1);
canary("inline require('process') bracket banned read flags",
  `const v = require("process")["env"]["${RETIRED}"];`, 1);
canary("for-of over a list containing a banned name flags",
  `for (const k of ["FOO", "${LEGACY}"]) { if (!process.env[k]) throw new Error(k); }`, 1);
canary("for-of via const array containing a banned name flags", [
  `const REQUIRED = ["FOO", "${RETIRED}"];`,
  `for (const k of REQUIRED) { if (!process.env[k]) throw new Error(k); }`,
].join("\n"), 1);
canary("destructure of a banned name flags",
  `const { ${LEGACY} } = process.env;`, 1);
canary("destructure flags even with ${CANONICAL} in the same pattern",
  `const { ${CANONICAL}, ${LEGACY} } = process.env;`, 1);
canary("aliased destructure flags",
  `const { ${RETIRED}: legacyUrl } = process.env;`, 1);
canary("string-key destructure flags",
  `const { "${LEGACY}": legacyUrl } = process.env;`, 1);
canary("ternary read flags",
  `const u = flag ? process.env.${LEGACY} : "";`, 1);
canary("&&-guarded read flags",
  `const u = ready && process.env.${LEGACY};`, 1);
canary("two bare reads = two violations", [
  `const a = process.env.${LEGACY};`,
  `const b = process.env.${RETIRED};`,
].join("\n"), 2);

// AST — must PASS:
canary("canonical-only read passes",
  `const url = process.env.${CANONICAL};`, 0);
canary("comment/string mentions are invisible to the AST pass (the TEXT pass owns them)", [
  `// legacy DB names are banned`,
  `throw new Error("set ${CANONICAL}");`,
].join("\n"), 0);
canary("unrelated literal env keys pass",
  `const v = process.env["SOME_OTHER_FLAG"];`, 0);
canary("near-miss discrete legacy config names pass (different names, not the URL)",
  `const host = process.env.CLIENT_DB_HOST; const port = process.env.CLIENT_DB_PORT;`, 0);
canary("for-of over non-DB env names passes",
  `for (const k of ["MIGRATION_SOURCE_DB_URL", "MIGRATION_TARGET_HOST"]) { if (!process.env[k]) throw new Error(k); }`, 0);
canary("for-of via const array of non-DB names passes", [
  `const REQUIRED = ["FOO_URL", "BAR_HOST"];`,
  `for (const k of REQUIRED) { if (!process.env[k]) throw new Error(k); }`,
].join("\n"), 0);
canary("foldable non-env selection on process passes",
  `const args = process["argv"];`, 0);
canary("foldable non-process selection on globalThis passes",
  `const f = globalThis["fetch"];`, 0);
canary("benign global-object property use passes",
  `global.setTimeout(fn, 100); const g = globalThis.structuredClone;`, 0);
canary("require of another module passes",
  `const fs = require("node:fs"); const v = fs.readFileSync(p, "utf8");`, 0);

// Text canaries:
function textCanary(label: string, content: string, expectHits: number, expectName?: string) {
  const hits = findBannedTokens(content);
  const nameOk = expectName === undefined || hits.every((h) => h.name === expectName);
  if (hits.length === expectHits && nameOk) ok(`text canary: ${label}`);
  else fail(`text canary: ${label} — expected ${expectHits} hit(s)${expectName ? ` of ${expectName}` : ""}, got ${hits.length} (${hits.map((h) => h.name).join(",") || "none"})`);
}

textCanary("retired token in a comment flags",
  `// falls back to ${RETIRED} on old builds`, 1, RETIRED);
textCanary("retired token in a shell substitution flags",
  'X="${' + RETIRED + ':-}"', 1, RETIRED);
textCanary("retired token in a Terraform setting flags",
  `{ name = "${RETIRED}", value = x.arn },`, 1, RETIRED);
textCanary("retired token counts ONCE, not also as the legacy substring",
  `value = ${RETIRED}`, 1, RETIRED);
textCanary("standalone legacy token flags",
  `CLIENT${"_DB_URL"}="$SRC" node migrate.mjs`, 1, LEGACY);
textCanary("legacy token mid-identifier does not flag (different name)",
  `const MY${LEGACY} = 1;`, 0);
textCanary("discrete legacy config names do not flag",
  `const host = process.env.CLIENT_DB_HOST;`, 0);
textCanary("canonical name does not flag",
  `${CANONICAL}=mssql://u:p@h:1433/db`, 0);
textCanary("empty file has no hits", ``, 0);

// ── Repo scan ────────────────────────────────────────────────────────────────

const MIGRATE_MJS = "artifacts/api-server/scripts/migrate-to-aws.mjs";
const MIGRATE_SH = "scripts/migrate-to-aws.sh";

/** The migration-source contract: the ONLY place the LEGACY name may be
 *  accessed via process.env (the wrapper injects it as the migration
 *  SOURCE, deliberately not the app's own URL). */
const AST_LEGACY_ALLOW = new Set<string>([MIGRATE_MJS]);
/** …and the only files where its spelling may appear at all. */
const TEXT_LEGACY_ALLOW = new Set<string>([MIGRATE_MJS, MIGRATE_SH]);
/** Agent memory may NAME the legacy contract while documenting it (these
 *  docs are internal, mirror-excluded, and naming the thing you document is
 *  the point). The RETIRED name gets no such allowance there or anywhere —
 *  including this gate, which never spells either name contiguously. */
const TEXT_LEGACY_ALLOW_DIRS = [".agents/memory/"];

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|heic|ico|bmp|svgz|woff2?|ttf|otf|eot|mp3|mp4|m4a|wav|webm|mov|zip|gz|tgz|br|xz|7z|rar|xlsx|xls|pptx|docx|pdf|glb|gltf|bin|wasm|node|jar|class|exe|dll|so|dylib|db|sqlite|ipa|apk|keystore|p12)$/i;
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage",
  "attached_assets", "generated",
]);

/** Root-level hidden dirs that ARE source and must be scanned (a blanket
 *  dot-skip would hide GitHub workflows and agent memory from the ban).
 *  Every other hidden dir is platform/vendored/generated (.git, .cache,
 *  .local, .pythonlibs, .canvas, nested .expo, …) and stays out. */
const SCAN_HIDDEN_DIRS = new Set([".agents", ".github", ".husky"]);

function* walk(dir: string, atRoot = false): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const hidden = e.name.startsWith(".");
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (hidden && !(atRoot && SCAN_HIDDEN_DIRS.has(e.name))) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (e.isFile()) {
      // Dot-FILES stay skipped everywhere (.env*, .npmrc, …): runtime/local
      // config whose secret VALUES the violation printer must never echo.
      if (hidden) continue;
      yield full;
    }
  }
}

// Allowlist hygiene: every sanctioned exception must still exist — if one is
// moved or deleted, prune the entry so the allowlist cannot rot into a hole.
for (const rel of new Set([...AST_LEGACY_ALLOW, ...TEXT_LEGACY_ALLOW])) {
  if (!existsSync(join(REPO_ROOT, rel))) {
    fail(`allowlist entry no longer exists: ${rel} — remove it from check-db-env-names.ts (or fix the path) so the exception list stays real`);
  }
}

let astScanned = 0;
let textScanned = 0;
const scannedRels: string[] = [];
const violations: Array<{ rel: string; v: Violation }> = [];

for (const file of walk(REPO_ROOT, true)) {
  const rel = relative(REPO_ROOT, file).split(sep).join("/");
  if (BINARY_EXT.test(file)) continue;
  // Terraform state files are generated snapshots of what is DEPLOYED, not
  // source — the .tf configs (which ARE scanned) are the authoring surface.
  // State catches up to reality via refresh, not via editing.
  if (/\.tfstate(\.|$)/.test(file)) continue; // incl. timestamped .backup copies
  let raw: Buffer;
  try {
    if (statSync(file).size > 2 * 1024 * 1024) continue; // junk/bundle guard
    raw = readFileSync(file);
  } catch {
    continue;
  }
  if (raw.subarray(0, 8192).includes(0)) continue; // binary sniff
  const content = raw.toString("utf8");

  // Rule 1: the plain spelling, in ANY file type.
  textScanned++;
  scannedRels.push(rel);
  for (const t of findBannedTokens(content)) {
    if (
      t.name === LEGACY &&
      (TEXT_LEGACY_ALLOW.has(rel) || TEXT_LEGACY_ALLOW_DIRS.some((d) => rel.startsWith(d)))
    ) continue;
    violations.push({
      rel,
      v: {
        line: t.line,
        text: t.text,
        reason: t.name === RETIRED
          ? `retired DB env name ${t.name} in source text — banned everywhere, comments included`
          : `legacy DB env name ${t.name} in source text — allowed only in the migration-source contract (${MIGRATE_SH} / ${MIGRATE_MJS})`,
      },
    });
  }

  // Rule 2: AST env-access analysis for code files.
  if (CODE_EXT.test(file)) {
    astScanned++;
    for (const v of findLegacyDbEnvViolations(content, file)) {
      if (v.names && v.names.length > 0 && v.names.every((n) => n === LEGACY) && AST_LEGACY_ALLOW.has(rel)) continue;
      violations.push({ rel, v });
    }
  }
}

if (astScanned < 100) {
  fail(`scanner saw only ${astScanned} code files — repo root resolution looks broken (expected the whole workspace)`);
}
if (textScanned <= astScanned || textScanned < 150) {
  fail(`text scan saw ${textScanned} files (code files: ${astScanned}) — the all-file walk looks broken; it must cover shell/Terraform/docs too`);
}
// Hidden-source-dir coverage: if these dirs exist they MUST contribute
// scanned files, or a blanket dot-skip regression has silently blinded the
// text ban to GitHub workflows / agent memory.
for (const dir of [".agents", ".github"]) {
  if (existsSync(join(REPO_ROOT, dir)) && !scannedRels.some((r) => r.startsWith(dir + "/"))) {
    fail(`coverage: ${dir}/ exists but contributed 0 scanned files — hidden source dirs must be walked (SCAN_HIDDEN_DIRS)`);
  }
}

for (const { rel, v } of violations) {
  fail(`${rel}:${v.line}  ${v.reason}\n        ${v.text}`);
}

if (violations.length > 0) {
  console.error(`
check-db-env-names: ${violations.length} banned DB env-name violation(s).

${RETIRED} is retired. The canonical secret is ${CANONICAL}, and every
environment (dev workspace + all Elastic Beanstalk envs) stores ONLY that name —
the retired spelling must not appear in the source tree at all: code,
comments, shell scripts, Terraform, docs.

${LEGACY} is allowed ONLY as the migration-source contract:
${MIGRATE_SH} injects it (from MIGRATION_SOURCE_DB_URL) and
${MIGRATE_MJS} reads it.

Read process.env.${CANONICAL} — or better, don't touch env at all: import the
shared connection layer (@workspace/db getMssqlPool, or api-server
src/lib/db.ts) which already owns resolution. Dynamic process.env[…] keys
must stay statically resolvable (literal keys, or for-of over a same-file
const array of string literals).`);
}

if (failures > 0) {
  console.error(`check-db-env-names: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`check-db-env-names: OK (${astScanned} code files AST-scanned, ${textScanned} files text-scanned, canaries green, no banned DB env names outside the migration contract)`);
