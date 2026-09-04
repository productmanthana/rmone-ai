// ─────────────────────────────────────────────────────────────────────────────
// Phase color resolution — three-tier nearest-match strategy
//
// Tier 1 — Exact match: canonical phase names from the A/E schedule template
//          (Pre-SD, SD, DD, CD, Bidding, CM, CO + allocation markers) always
//          resolve to their pixel-sampled reference colors.
//
// Tier 2 — Keyword / semantic nearest match: any non-canonical phase name is
//          matched against keyword groups derived from real-world synonyms.
//          "Schematic Design" → SD, "30% Design" → SD, "Closeout" → CO etc.
//          Covers most civil, construction, and mixed-use schedule templates
//          without requiring per-client configuration.
//
// Tier 3 — Position-based fallback: if no keyword matches, the phase's index
//          within its schedule is mapped through the canonical color sequence
//          (Pre-SD → CO), keeping visuals coherent for fully custom templates.
//
// Tier 4 — Hard fallback: no schedule data → "No Phase" tan (#D0BF9E).
//
// All Gantt chart components should call resolvePhaseColor() instead of
// maintaining their own PHASE dictionaries so custom schedules just work.
// ─────────────────────────────────────────────────────────────────────────────

export interface PhaseColor {
  bg: string;
  text: string;
  outline?: string;
}

// ── Canonical palette (pixel-sampled from client reference) ──────────────────
export const PHASE_COLORS: Record<string, PhaseColor> = {
  // Allocation-certainty markers
  'Props':        { bg: '#808080', text: '#fff' },
  'Soft':         { bg: '#FFFFFF', text: '#808080', outline: '#808080' },
  // Unphased / non-project
  'No Phase':     { bg: '#D0BF9E', text: '#3d2e14' },
  'Lead':         { bg: '#6BA539', text: '#fff' },
  'Non-Project':  { bg: '#000000', text: '#fff' },
  // A/E standard schedule progression
  'Pre-SD':       { bg: '#3A7D6E', text: '#fff' },
  'SD':           { bg: '#86D5CA', text: '#1a4a45' },
  'DD':           { bg: '#44A2B1', text: '#fff' },
  'CD':           { bg: '#236E97', text: '#fff' },
  'Bidding':      { bg: '#1B296D', text: '#fff' },
  'CM':           { bg: '#79260A', text: '#fff' },
  'CO':           { bg: '#DD8629', text: '#3d1f00' },
};

// Ordered color sequence used for position-based tier-3 fallback.
// Mirrors the A/E progression: mint (early) → teal → blue → navy → rust → amber (late).
const SEQUENCE: PhaseColor[] = [
  PHASE_COLORS['Pre-SD'],
  PHASE_COLORS['SD'],
  PHASE_COLORS['DD'],
  PHASE_COLORS['CD'],
  PHASE_COLORS['Bidding'],
  PHASE_COLORS['CM'],
  PHASE_COLORS['CO'],
];

// ── Keyword groups (Tier 2) ───────────────────────────────────────────────────
// Each entry: [canonicalKey, regexPatterns[]]
// Order matters — more specific patterns must come before general ones.
// Match is tested case-insensitively against the normalized phase name.
const KEYWORD_RULES: [string, RegExp[]][] = [
  // Non-project / overhead (before "admin" catches "construction admin")
  ['Non-Project', [
    /\bnon[- ]?project\b/,
    /\boverhead\b/,
    /\binternal time\b/,
    /\bbd\b/,
    /\bbusiness dev/,
    /\btraining\b/,
    /\bmarketing\b/,
  ]],
  // Unphased time-off
  ['No Phase', [
    /\bholiday\b/,
    /\bpto\b/,
    /\bvacation\b/,
    /\bleave\b/,
    /\btime[- ]off\b/,
    /\bpersonal\b/,
    /\bbreak\b/,
  ]],
  // Allocation certainty markers (exact-only effectively, but guard loose spellings)
  ['Soft',  [/\bsoft\b/, /\bprovisional\b/, /\btentative\b/]],
  ['Props', [/\bpropos(ed|al)?\b/, /\bpursuit\b/, /\bprospect/]],

  // CO — closeout (before "construction" catches it)
  ['CO', [
    /\bclos(e[- ]?out|eout|ing)\b/,
    /\bpunch[- ]?list\b/,
    /\bpunch\b/,
    /\bdefect\b/,
    /\bcommission/,
    /\bhandover\b/,
    /\bhand[- ]?over\b/,
    /\bwarranty\b/,
    /\bsubstantial\b/,
    /\bfinal (inspect|complet|accept)/,
    /\bpost[- ]?construction\b/,
  ]],
  // CM — construction management / site
  ['CM', [
    /\bconstruction (admin|manag|observe|phase|service)/,
    /\bca\s*&?\s*ci\b/,
    /\bsite (admin|supervis|manag)/,
    /\b(build|erect|install|execution) phase\b/,
    /\bconstruction$/,
  ]],
  // Bidding / procurement
  ['Bidding', [
    /\bbid(ding|der)?\b/,
    /\btender\b/,
    /\bprocurement\b/,
    /\brfp\b/,
    /\brfq\b/,
    /\bnegotiat/,
    /\bselection\b/,
  ]],
  // CD — construction documents
  ['CD', [
    /\bconstruction doc/,
    /\bworking draw/,
    /\bcontract doc/,
    /\bpermit (set|draw|doc)/,
    /\b90[%\s]/,
    /\b100[%\s]/,
  ]],
  // DD — design development
  ['DD', [
    /\bdesign develop/,
    /\bdesign dev\b/,
    /\b60[%\s]/,
    /\b75[%\s]/,
    /\bdesign review/,
  ]],
  // SD — schematic design
  ['SD', [
    /\bschematic/,
    /\bconceptual (design|plan)/,
    /\b30[%\s]/,
    /\bstrateg/,
    /\bpreliminary design/,
    /\bdiagram/,
  ]],
  // Pre-SD — pre-design / early stages
  ['Pre-SD', [
    /\bpre[- ]?design\b/,
    /\bpre[- ]?schematic\b/,
    /\bpre[- ]?sd\b/,
    /\bfeasibil/,
    /\bmaster plan/,
    /\bplanning (phase|study)/,
    /\bprogramm/,
    /\bsite assess/,
    /\bdue diligence\b/,
    /\bpre[- ]?construction planning\b/,
    /\bproject initiat/,
  ]],
];

// Normalize phase name for matching: lowercase, collapse whitespace
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve a phase color from a phase name with graceful fallback.
 *
 * @param phaseName  - Raw phase name from the schedule (may be null/undefined)
 * @param phaseIndex - 0-based index of this phase within the project schedule (for tier-3 fallback)
 * @param totalPhases - Total number of phases in the project schedule
 * @returns PhaseColor { bg, text, outline? }
 */
export function resolvePhaseColor(
  phaseName: string | null | undefined,
  phaseIndex?: number,
  totalPhases?: number,
): PhaseColor {
  const name = (phaseName ?? '').trim();

  // ── Tier 1: exact match (case-insensitive) ────────────────────────────────
  if (name) {
    const lower = name.toLowerCase();
    for (const [key, color] of Object.entries(PHASE_COLORS)) {
      if (key.toLowerCase() === lower) return color;
    }
  }

  // ── Tier 2: keyword / semantic nearest match ──────────────────────────────
  if (name) {
    const n = norm(name);
    for (const [key, patterns] of KEYWORD_RULES) {
      if (patterns.some(re => re.test(n))) {
        return PHASE_COLORS[key];
      }
    }
  }

  // ── Tier 3: position-based fallback ──────────────────────────────────────
  if (phaseIndex !== undefined && totalPhases !== undefined && totalPhases > 0) {
    const frac = phaseIndex / Math.max(totalPhases - 1, 1);
    const idx = Math.round(frac * (SEQUENCE.length - 1));
    return SEQUENCE[Math.max(0, Math.min(idx, SEQUENCE.length - 1))];
  }

  // ── Tier 4: hard fallback ─────────────────────────────────────────────────
  return PHASE_COLORS['No Phase'];
}

/**
 * Convenience: returns just the background hex color string.
 * Useful when you only need the color for a legend dot or border.
 */
export function phaseColorBg(
  phaseName: string | null | undefined,
  phaseIndex?: number,
  totalPhases?: number,
): string {
  return resolvePhaseColor(phaseName, phaseIndex, totalPhases).bg;
}

// ── Utilization palette (client-approved) ─────────────────────────────────────
// Under = red, Good/Healthy = green, Over = amber — the client's legacy
// resourcing sheet uses this emotion mapping (over-booked is amber "attention",
// under-booked is red "revenue leak"). Thresholds stay business-rule driven;
// only the COLORS come from here.
export const UTIL_COLORS: Record<'under' | 'good' | 'over', PhaseColor> = {
  under: { bg: '#FF5757', text: '#fff' },
  good:  { bg: '#6BA639', text: '#fff' },
  over:  { bg: '#F9AB33', text: '#fff' },
};

// Hatch pattern for empty (no-allocation) week cells in Gantt grids.
export const GANTT_HATCH =
  'repeating-linear-gradient(-45deg,#E5E5E5,#E5E5E5 1px,#F6F6F6 1px,#F6F6F6 6px)';

// Highlight (selected/current week) column treatment.
export const GANTT_HIGHLIGHT = {
  header: '#CFA1EE',
  headerText: '#5b21b6',
  cell: '#f3eeff',
};
