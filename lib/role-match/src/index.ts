/**
 * @workspace/role-match — abbreviation-aware role/title text matching.
 *
 * Users type shortcuts ("PM", "supt", "sr pm") when searching open positions
 * or people, and imported data itself often stores abbreviated role names
 * ("PM", "Asst PM"). Plain substring matching misses both directions, so every
 * role-search surface (web demand tab, demand drill-down, mobile demand,
 * server people-search) matches through this ONE module instead of ad-hoc
 * `.includes()` checks. Matching is deliberately recall-biased: it is used to
 * FILTER search results, never to write or link data — do NOT reuse it for
 * write-path role matching (openSlotAutoConsume stays exact on purpose).
 *
 * Semantics (all case/punctuation-insensitive):
 *   1. Substring — everything the old `.includes()` matched still matches.
 *   2. Acronyms — "pm" ⇒ "Project Manager", "srpm"/"sr pm" ⇒ "Senior Project
 *      Manager" (initials, with leading seniority modifiers stripped or
 *      shortened; known short tokens like "VP" stay whole: "vp pm" works).
 *   3. Alias expansion, both directions — query "PM" finds roles named
 *      "Project Manager…"; query "project manager" finds roles stored as
 *      "PM"/"Sr PM". Plurals fold ("PMs", "managers").
 *   4. Word prefixes — "coord" ⇒ "Coordinator", "proj man" ⇒ "Project
 *      Manager" (3+ chars per word, every query word must land somewhere).
 */

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
export function normalizeRoleText(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const STOP_WORDS = new Set(["of", "the", "and", "for"]);

/** Leading seniority/qualifier words strippable when deriving core acronyms,
 *  mapped to their conventional short form (mirrors web roleAbbrev.ts). */
const MODIFIER_SHORT: Record<string, string> = {
  senior: "sr", sr: "sr", junior: "jr", jr: "jr",
  assistant: "asst", asst: "asst", associate: "assoc", assoc: "assoc",
  deputy: "dep", dep: "dep", executive: "exec", exec: "exec",
  principal: "prin", prin: "prin", lead: "lead", chief: "chief",
  general: "gen", gen: "gen", interim: "interim", acting: "acting",
};

/**
 * Abbreviation → full-form expansions (normalized, space-separated).
 * AEC/construction-heavy on purpose — that is this product's tenant base.
 * Multi-expansion entries are alternatives (any may match). Expansions are
 * matched as substrings AND as bags of words, so "vdc" → "virtual design"
 * hits both "Virtual Design Construction" and "Virtual Design and
 * Construction". Recall-only: a wrong-ish alias adds noise to a search list,
 * it never corrupts data.
 */
export const ROLE_ALIASES: Record<string, string[]> = {
  // management ladder
  pm: ["project manager"],
  apm: ["assistant project manager"],
  spm: ["senior project manager"],
  px: ["project executive"],
  cm: ["construction manager"],
  acm: ["assistant construction manager"],
  om: ["operations manager"],
  dm: ["design manager"],
  fm: ["field manager", "facilities manager"],
  gc: ["general contractor"],
  gm: ["general manager"],
  // engineering
  pe: ["project engineer", "professional engineer"],
  ce: ["civil engineer", "cost engineer"],
  se: ["structural engineer", "site engineer"],
  me: ["mechanical engineer"],
  ee: ["electrical engineer"],
  fe: ["field engineer"],
  de: ["design engineer"],
  oe: ["office engineer"],
  eng: ["engineer", "engineering"],
  engr: ["engineer"],
  // field leadership
  supt: ["superintendent"],
  super: ["superintendent"],
  supv: ["supervisor"],
  sup: ["supervisor", "superintendent"],
  gs: ["general superintendent"],
  gf: ["general foreman"],
  // executives
  vp: ["vice president"],
  avp: ["assistant vice president"],
  svp: ["senior vice president"],
  evp: ["executive vice president"],
  ceo: ["chief executive officer"],
  cfo: ["chief financial officer"],
  coo: ["chief operating officer"],
  cto: ["chief technology officer"],
  cio: ["chief information officer"],
  cao: ["chief administrative officer"],
  // common role words
  dir: ["director"],
  mgr: ["manager"],
  proj: ["project"],
  mgmt: ["management"],
  ops: ["operations"],
  constr: ["construction"],
  est: ["estimator", "estimating"],
  arch: ["architect", "architecture"],
  admin: ["administrator", "administration", "administrative"],
  coord: ["coordinator"],
  sched: ["scheduler", "scheduling"],
  acct: ["accountant", "accounting"],
  insp: ["inspector", "inspection"],
  tech: ["technician", "technical"],
  spec: ["specialist"],
  asst: ["assistant"],
  assoc: ["associate"],
  sr: ["senior"],
  jr: ["junior"],
  dep: ["deputy"],
  exec: ["executive"],
  prin: ["principal"],
  gen: ["general"],
  // disciplines / departments
  qa: ["quality assurance"],
  qc: ["quality control"],
  qaqc: ["quality assurance", "quality control"],
  hse: ["health safety environment", "health safety environmental"],
  ehs: ["environmental health safety", "environment health safety"],
  hr: ["human resources"],
  bd: ["business development"],
  bim: ["building information modeling"],
  vdc: ["virtual design"],
  mep: ["mechanical electrical plumbing"],
  it: ["information technology"],
  dc: ["document control", "document controller"],
  pc: ["project coordinator", "project controls"],
  pa: ["project accountant", "project administrator"],
};

/** "managers" → "manager", "pms" → "pm"; both compare sides are singularized
 *  symmetrically, so short stems stay safe (never below 2 chars, no "ss"). */
function singular(t: string): string {
  return t.length > 2 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}

function aliasExpansions(token: string): string[] {
  return ROLE_ALIASES[token] ?? ROLE_ALIASES[singular(token)] ?? [];
}

/** Compact (space-free) acronym candidates for a multi-word role name. */
function acronymCandidates(tokens: string[]): Set<string> {
  const out = new Set<string>();
  if (tokens.length < 2) return out;
  // Full initials: "senior project manager" → "spm".
  out.add(tokens.map((t) => t[0]).join(""));
  // Known short tokens stay whole: "vp project management" → "vppm".
  out.add(tokens.map((t) => (t.length <= 4 && ROLE_ALIASES[t] ? t : t[0])).join(""));
  // Strip/shorten leading modifiers: "senior project manager" → "pm", "srpm".
  let i = 0;
  const mods: string[] = [];
  while (i < tokens.length - 1 && MODIFIER_SHORT[tokens[i]]) {
    mods.push(MODIFIER_SHORT[tokens[i]]);
    i++;
  }
  if (i > 0) {
    const core = tokens.slice(i);
    if (core.length >= 2) {
      const coreInitials = core.map((t) => t[0]).join("");
      out.add(coreInitials);
      out.add(mods.join("") + coreInitials);
    }
  }
  return out;
}

function tokenCovered(qt: string, roleTokens: string[], roleNorm: string): boolean {
  const sq = singular(qt);
  for (const rt of roleTokens) {
    if (singular(rt) === sq) return true;
    // Word-prefix ("coord" → "coordinator"); 3+ chars to avoid noise.
    if (qt.length >= 3 && (rt.startsWith(qt) || singular(rt).startsWith(sq))) return true;
  }
  // Query token is an abbreviation: any expansion present in the role?
  for (const exp of aliasExpansions(qt)) {
    if (roleNorm.includes(exp)) return true;
    const expTokens = exp.split(" ");
    if (expTokens.every((w) => roleTokens.some((rt) => singular(rt) === singular(w)))) return true;
  }
  // Role token is an abbreviation: does its expansion contain the query word?
  for (const rt of roleTokens) {
    for (const exp of aliasExpansions(rt)) {
      for (const w of exp.split(" ")) {
        if (singular(w) === sq) return true;
        if (qt.length >= 3 && w.startsWith(qt)) return true;
      }
    }
  }
  return false;
}

/**
 * Build a matcher for one user-typed query, reusable across many rows
 * (precomputes the query side once — call per keystroke, not per row).
 * Empty/blank queries match everything, nullish role names match nothing
 * (except against a blank query).
 */
export function roleQueryMatcher(
  query: string | null | undefined,
): (roleName: string | null | undefined) => boolean {
  const nq = normalizeRoleText(query);
  if (!nq) return () => true;
  const qTokens = nq.split(" ").filter((t) => !STOP_WORDS.has(t));
  const qCompact = nq.replace(/ /g, "");
  return (roleName) => {
    const nr = normalizeRoleText(roleName);
    if (!nr) return false;
    if (nr.includes(nq)) return true; // legacy substring behavior
    const rTokens = nr.split(" ").filter((t) => !STOP_WORDS.has(t));
    if (qCompact.length >= 2) {
      const qcSingular = singular(qCompact); // "pms" → "pm"
      for (const cand of acronymCandidates(rTokens)) {
        if (cand === qCompact || cand === qcSingular || cand.startsWith(qCompact)) return true;
      }
    }
    return qTokens.length > 0 && qTokens.every((qt) => tokenCovered(qt, rTokens, nr));
  };
}

/** One-off convenience — prefer roleQueryMatcher when filtering lists. */
export function roleTextMatches(
  query: string | null | undefined,
  roleName: string | null | undefined,
): boolean {
  return roleQueryMatcher(query)(roleName);
}

/* ------------------------------------------------------------------------ *
 * STRICT EQUIVALENCE — "is this the SAME role?" (assign flows)
 *
 * Different question from search above. When a user selects a Role and opens
 * the "Assigned To" picker, the people offered must hold THAT role — "PM",
 * "Proj Mgr" and "Project Manager" are the same role, but "Senior Project
 * Manager" / "Sr PM" / "Assistant PM" / "Project Manager II" are DIFFERENT
 * roles (seniority/level modifiers are significant, owner mandate Aug 2026).
 *
 * Semantics: normalize → expand abbreviation tokens ("pm" → "project
 * manager") → drop connector words → singularize → compare as unordered word
 * sets ("Manager, Project" ≡ "Project Manager"). A compact token on one side
 * may equal a modifier-PRESERVING acronym of the other ("SPM"/"SrPM" ≡
 * "Senior Project Manager") — but never a modifier-STRIPPED one, so "PM"
 * NEVER equals "Senior Project Manager".
 *
 * Two deliberate policy calls (do not "fix" without an owner decision):
 * - One-to-many aliases: a LITERALLY abbreviated stored title ("FM", "PE",
 *   "Sup") is equivalent to EACH of its catalog expansions — the data itself
 *   is ambiguous, and hiding that person from both pickers is worse than
 *   showing them (rows display the real title text). The full forms never
 *   merge: "Field Manager" ≢ "Facilities Manager".
 * - No suffix stripping: "Project Manager - Buildings" ≢ "Project Manager".
 *   Trailing qualifiers can't be told apart from role-changing words
 *   ("PM/Estimator"); the pickers' "show all people" notice is the escape.
 *
 * Still display/filter-only: do not use for write-path linking
 * (openSlotAutoConsume stays exact).
 * ------------------------------------------------------------------------ */

const MAX_KEY_COMBOS = 64;

interface RoleKeyInfo {
  /** Sorted-unique expanded word bags — the primary identity keys. */
  wordKeys: Set<string>;
  /** Modifier-preserving compact acronyms ("spm", "srpm") of a multi-word name. */
  acronyms: Set<string>;
  /** Set when this side is itself compact: one token ("pm", "srpm") or all
   *  single-letter tokens ("p m" from "P.M."). */
  compact: string | null;
}

function roleKeyInfo(text: string | null | undefined): RoleKeyInfo {
  const empty: RoleKeyInfo = { wordKeys: new Set(), acronyms: new Set(), compact: null };
  const n = normalizeRoleText(text);
  if (!n) return empty;
  const tokens = n.split(" ").filter((t) => !STOP_WORDS.has(t));
  if (tokens.length === 0) return empty;

  const compact =
    tokens.length === 1 ? tokens[0]
    : tokens.every((t) => t.length === 1) ? tokens.join("")
    : null;

  // Per-token alternatives: the raw token plus its known expansions.
  const keysFrom = (alternatives: string[][]): void => {
    let combos: string[][] = [[]];
    for (const alts of alternatives) {
      const next: string[][] = [];
      for (const c of combos) {
        for (const a of alts) {
          next.push([...c, a]);
          if (next.length >= MAX_KEY_COMBOS) break;
        }
        if (next.length >= MAX_KEY_COMBOS) break;
      }
      combos = next;
    }
    for (const combo of combos) {
      const words = combo
        .flatMap((part) => part.split(" "))
        .filter((w) => w && !STOP_WORDS.has(w))
        .map(singular);
      if (words.length === 0) continue;
      wordKeys.add(Array.from(new Set(words)).sort().join(" "));
    }
  };
  const wordKeys = new Set<string>();
  keysFrom(tokens.map((t) => [t, ...aliasExpansions(t)].slice(0, 4)));
  // A compact side ("pm", or "p m" from "P.M.") is ALSO readable as the whole
  // joined token — key that reading too, so "P.M." keys identically to "PM".
  if (compact && compact !== tokens[0]) keysFrom([[compact, ...aliasExpansions(compact)].slice(0, 4)]);

  // Acronym forms another side's COMPACT token may equal. Modifier info is
  // always kept ("srpm"), never stripped ("pm") — that is the strictness.
  const acronyms = new Set<string>();
  if (tokens.length >= 2 && compact === null) {
    acronyms.add(tokens.map((t) => t[0]).join(""));
    acronyms.add(tokens.map((t) => (t.length <= 4 && ROLE_ALIASES[t] ? t : t[0])).join(""));
    let i = 0;
    const mods: string[] = [];
    while (i < tokens.length - 1 && MODIFIER_SHORT[tokens[i]]) {
      mods.push(MODIFIER_SHORT[tokens[i]]);
      i++;
    }
    if (i > 0) acronyms.add(mods.join("") + tokens.slice(i).map((t) => t[0]).join(""));
  }
  return { wordKeys, acronyms, compact };
}

/**
 * Build a strict same-role checker for one selected Role/Title, reusable
 * across many candidate rows. Blank selection matches nothing (callers decide
 * what "no selection" means); blank candidates never match.
 */
export function roleEquivalence(
  selected: string | null | undefined,
): (candidate: string | null | undefined) => boolean {
  const S = roleKeyInfo(selected);
  if (S.wordKeys.size === 0) return () => false;
  return (candidate) => {
    const C = roleKeyInfo(candidate);
    if (C.wordKeys.size === 0) return false;
    for (const k of C.wordKeys) if (S.wordKeys.has(k)) return true;
    // Generic initials fallback ONLY for compact tokens with no explicit
    // alias ("srpm"). When the catalog defines the abbreviation ("pm" =
    // project manager), the alias is authoritative — otherwise "PM" would
    // leak into Program/Portfolio Manager via shared initials.
    if (C.compact && aliasExpansions(C.compact).length === 0 && S.acronyms.has(C.compact)) return true;
    if (S.compact && aliasExpansions(S.compact).length === 0 && C.acronyms.has(S.compact)) return true;
    return false;
  };
}

/** One-off convenience — prefer roleEquivalence when filtering lists. */
export function rolesEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return roleEquivalence(a)(b);
}
