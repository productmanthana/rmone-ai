/**
 * Parse the assistant's text into a sequence of renderable blocks.
 * Mirrors the mobile chat's parseBlocks (artifacts/rmone-mobile/app/(tabs)/chat.tsx).
 *
 * Recognized markers (all in plain text the AI emits):
 *   [ROSTER_TABLE]                           — render roster sidecar
 *   [PERSON_PROFILE]                         — render personProfile sidecar
 *   [OPP_TABLE]                              — render oppTable sidecar
 *   [OPP_TABLE_2]                            — render oppTable2 sidecar
 *   [PMM_TABLE]                              — render pmmTable sidecar
 *   [SCHEDULE_TABLE:projectId]               — interactive schedule editor
 *   [LIFECYCLE_PICKER:projectId]             — pick a project lifecycle
 *   [PROJECT_DATES:projectId]                — edit start/end dates
 *   [HEALTH_GAUGE:projectId|score|label|     — health gauge with breakdown
 *                 issue:ded;issue:ded]
 *   [BUTTONS:LABEL1,LABEL2,...]              — action buttons (inc. confirm flows)
 *   [CHART:bar]...[/CHART]                   — bar chart (deferred)
 *   [TIMELINE]...[/TIMELINE]                 — gantt timeline (deferred)
 *   [UPDATE_SUCCESS:recordId|person]         — green "saved" card
 *   [UPDATE_FAIL:reason]                     — red error card
 *   [SELECT_PROJECT:id] label                — project picker pill
 *   [ALLOC_FORM:person|projectId|projectName]    — single allocation form
 *   [WEEKLY_ALLOC:person|projectId|projectName|prefill?|autosave?] — interactive form
 */

export interface HGIssue { text: string; deduction: number }

/* Structured payload that wires a SITREP action chip to a real backend
 * endpoint under /api/decision/*. Discriminated by `kind` so each chip
 * type has its own typed shape. The chip remains tappable without a
 * payload (legacy briefs) — it then just confirms visually with no API
 * call. */
export type DecisionActionPayload =
  | { kind: "shift_allocation"; personName: string; projectId: string; hoursPerWeek: number }
  | { kind: "defer_pursuit"; pursuitName: string; days: number; recordId?: string }
  | { kind: "engage_candidates"; role: string; count: number; recipients?: string[] }
  | { kind: "open_requisition"; title: string; closeInDays: number; manager?: string };

export interface DecisionAction {
  text: string;
  chip: "Apply" | "Defer" | "Engage" | "Open";
  payload?: DecisionActionPayload;
}

export interface DecisionBrief {
  risk: "HIGH" | "MED" | "LOW";
  window: string;          // e.g. "45D"
  headline: string;
  subline: string;
  confidence: number;      // 0-100
  actions: DecisionAction[];
}

export interface DraftCard {
  title: string;
  sub: string;
  icon: "file" | "users" | "briefcase" | "mail";
  prompt: string;          // sent on tap
}

export interface DraftPanel {
  cards: DraftCard[];
  forecastTitle: string;
  forecastSub: string;
  followupText: string;
  followupAccept: string;  // text shown on the green Y pill
  followupPrompt: string;  // sent when Y pill tapped
}

export type Block =
  | { type: "text"; content: string }
  | { type: "chart"; content: string }
  | { type: "timeline"; content: string }
  | { type: "buttons"; labels: string[] }
  | { type: "suggestions"; questions: string[] }
  | { type: "roster" }
  | { type: "person_profile" }
  | { type: "opp_table" }
  | { type: "opp_table_2" }
  | { type: "pmm_table" }
  | { type: "schedule_table"; projectId: string }
  | { type: "lifecycle_picker"; projectId: string }
  | { type: "project_dates"; projectId: string }
  | { type: "health_gauge"; projectId: string; score: number; label: string; issues: HGIssue[]; passed: HGIssue[] }
  | { type: "update_success"; recordId: string; person: string }
  | { type: "update_fail"; reason: string }
  | { type: "select_project"; projects: { id: string; label: string }[] }
  | { type: "decision_brief"; brief: DecisionBrief }
  | { type: "draft_panel"; panel: DraftPanel }
  | { type: "alloc_form"; personName: string; projectId: string; projectName: string }
  | { type: "assignment_setup"; personName: string; projectId: string; projectName: string }
  | { type: "weekly_alloc";
      personName: string; projectId: string; projectName: string;
      prefill?: { phase: string; mode: "add" | "subtract" | "set"; hours: number }[];
      totalSet?: number;
      perWeekSet?: number;
      eachPhaseSet?: number;
      clearAll?: boolean;
      autosave?: boolean;
      alreadyAssigned?: boolean;
    };

// ── User-message safety net ────────────────────────────────────────────────
// If the AI emits a [WEEKLY_ALLOC:...] tag without a prefill clause, we infer
// the missing prefill from the user's own most-recent message text. This
// prevents requests like "make all above 40 hours per week each" from
// silently doing nothing because the LLM forgot to include the directive.
// (Ported verbatim from mobile chat.tsx:271 — same regexes, same priority.)
let lastUserMessageGlobal = "";
export function setLastUserMessageForParser(msg: string) {
  lastUserMessageGlobal = (msg || "").trim();
}

function inferPrefillFromUserMessage(): string {
  const m = lastUserMessageGlobal.toLowerCase();
  if (!m) return "";
  // EACH-PHASE TOTAL → prefill=eachphase=N (must match BEFORE perweek so
  // "under each phase" is not mis-read as per-week).
  const eachPhaseRe1 = /\b(\d+)\s*(?:h|hr|hrs|hours?)?\s*(?:under|to|in|on|for|per)\s+(?:each|every)\s+phase\b/;
  const eachPhaseRe2 = /\b(?:under|to|in|on|for|per)\s+(?:each|every)\s+phase\b[^0-9]{0,30}(\d+)\s*(?:h|hr|hrs|hours?)?\b/;
  const eachPhaseRe3 = /\b(\d+)\s*(?:h|hr|hrs|hours?)?\s+(?:under|to|in|on|for)\s+each\b(?!\s+(?:week|wk))/;
  const eachPhaseRe4 = /\bunder\s+each\b[^0-9]{0,30}(\d+)\s*(?:h|hr|hrs|hours?)?\b/;
  const epMatch = m.match(eachPhaseRe1) || m.match(eachPhaseRe2) || m.match(eachPhaseRe3) || m.match(eachPhaseRe4);
  if (epMatch) {
    const n = parseInt(epMatch[1], 10);
    if (isFinite(n) && n >= 0) return `prefill=eachphase=${n}`;
  }
  // PER-WEEK ACROSS ALL → prefill=perweek=N (match BEFORE total/overall).
  const perWeekRe = /\b(\d+)\s*(?:h|hr|hrs|hours?)?\s*(?:\/|per|each|every|a)\s*(?:wk|week)\b[^.\n]*\b(?:to|across|on|for)\s+(?:all|every|each)\b/;
  const weeklyAllRe = /\b(?:weekly|each\s+week|every\s+week)\b[^0-9]{0,15}(\d+)\s*(?:h|hr|hrs|hours?)?[^.\n]*\b(?:to|across|on|for)\s+(?:all|every|each)\b/;
  const allWeeklyRe = /\b(?:all|every|each)\s+(?:phases?|weeks?)\b[^0-9]{0,30}(\d+)\s*(?:h|hr|hrs|hours?)?\s*(?:\/|per|each|every|a)\s*(?:wk|week)\b/;
  // Also: "make all above 40 hours per week each" / "set them all to 40 per week"
  const allAboveRe = /\b(?:all|all\s+above|all\s+below|them\s+all|everything)\b[^.\n]*\b(\d+)\s*(?:h|hr|hrs|hours?)?\s*(?:\/|per|each|every|a)\s*(?:wk|week)\b/;
  const pwMatch = m.match(perWeekRe) || m.match(weeklyAllRe) || m.match(allWeeklyRe) || m.match(allAboveRe);
  if (pwMatch) {
    const n = parseInt(pwMatch[1], 10);
    if (isFinite(n) && n >= 0) return `prefill=perweek=${n}`;
  }
  // OVERALL / TOTAL → prefill=total=N
  const overallRe = /\b(?:overall|total|in\s+total|altogether)\b[^0-9]{0,20}(\d+)\s*(?:h|hr|hrs|hours?)?\b/;
  const makeItRe  = /\b(?:make|set|reduce)\s+(?:it|his|her|their|the\s+(?:overall|total))[^0-9]{0,15}(\d+)\s*(?:h|hr|hrs|hours?)?\b/;
  const ovMatch = m.match(overallRe) || m.match(makeItRe);
  const wantsClear = /\b(?:remove\s+all|clear\s+all|reset\s+all|wipe\s+(?:all|everything)|zero\s+(?:out|everything))\b/.test(m);
  if (ovMatch) {
    const n = parseInt(ovMatch[1], 10);
    if (isFinite(n) && n >= 0) return `prefill=total=${n}`;
  }
  if (wantsClear) return "prefill=clear";
  // PER-PHASE intent (e.g. "set Closeout to 40h", "add 10h to Bidding").
  const phaseListRe = /\b(?:pre[\s-]?schematic|schematic\s+design|design\s+development|construction\s+document(?:s|ation)?|bidding|construction\s+admin(?:istration)?|closeout|phase\s+\d+)\b/i;
  const phaseMatch = m.match(phaseListRe);
  if (phaseMatch) {
    const phase = phaseMatch[0].trim();
    const toN = m.match(/\bto\s+(\d+)\s*(?:h|hr|hrs|hours?)\b/);
    if (toN) {
      const n = parseInt(toN[1], 10);
      if (isFinite(n) && n >= 0) return `prefill=${phase}:=${n}`;
    }
    const addN = m.match(/\b(?:add|increase|plus|\+)\s*(\d+)\s*(?:h|hr|hrs|hours?|more)?\b/);
    if (addN) {
      const n = parseInt(addN[1], 10);
      if (isFinite(n) && n >= 0) return `prefill=${phase}:+${n}`;
    }
    const subN = m.match(/\b(?:remove|subtract|decrease|minus|-)\s*(\d+)\s*(?:h|hr|hrs|hours?)?\b/);
    if (subN) {
      const n = parseInt(subN[1], 10);
      if (isFinite(n) && n >= 0) return `prefill=${phase}:-${n}`;
    }
    const bareN = m.match(/\b(\d+)\s*(?:h|hr|hrs|hours?)\b/);
    if (bareN) {
      const n = parseInt(bareN[1], 10);
      if (isFinite(n) && n >= 0) return `prefill=${phase}:=${n}`;
    }
  }
  return "";
}

/* ── Demo helpers for the Bloomberg-style "Decision Support" brief ──────────
 * These produce the exact data shown in the reference Healthcare-PM screenshot
 * (attached_assets/IMG_4178_*.png). The marker [DECISION_BRIEF] / [DRAFT_PANEL]
 * with no payload renders these defaults so the UI is testable end-to-end
 * without any backend prompt changes. The marker also accepts an explicit
 * payload (`[DECISION_BRIEF:RISK|WINDOW|HEADLINE|SUBLINE|CONFIDENCE|a1:chip,a2:chip,...]`)
 * so the AI can emit different briefs in the future.
 */
export function defaultHealthcareBrief(): DecisionBrief {
  return {
    risk: "HIGH",
    window: "45D",
    headline: "Healthcare PM shortage projected in 45 days.",
    subline: "2 Sr PM reqs short · pursuit value $4.2M · close by Jun 10",
    confidence: 87,
    actions: [
      {
        text: "Shift Tom R. off PMM-167 · 8h/wk",
        chip: "Apply",
        payload: {
          kind: "shift_allocation",
          personName: "Tom Rodriguez",
          projectId: "PMM-167",
          hoursPerWeek: 8,
        },
      },
      {
        text: "Defer pursuit · 14D",
        chip: "Defer",
        payload: {
          kind: "defer_pursuit",
          pursuitName: "Healthcare PM pursuit",
          days: 14,
        },
      },
      {
        text: "Engage 3 contract PM candidates",
        chip: "Engage",
        payload: {
          kind: "engage_candidates",
          role: "Contract PM",
          count: 3,
        },
      },
      {
        text: "Open Sr PM req · close 45D",
        chip: "Open",
        payload: {
          kind: "open_requisition",
          title: "Sr PM · Healthcare",
          closeInDays: 45,
        },
      },
    ],
  };
}

export function defaultHealthcareDraftPanel(): DraftPanel {
  return {
    cards: [
      { title: "Requisition",  sub: "Sr PM · Healthcare", icon: "file",      prompt: "Draft a Sr PM requisition for the Healthcare practice." },
      { title: "Staffing plan",sub: "Pursuit · 8-wk ramp", icon: "users",     prompt: "Build a staffing plan for the Healthcare pursuit (8-week ramp)." },
      { title: "Exec summary", sub: "COO · 1-pager",      icon: "briefcase", prompt: "Write a 1-page exec summary of the Healthcare PM shortage for the COO." },
      { title: "Client update",sub: "Healthcare PMO",     icon: "mail",      prompt: "Draft a client update email to the Healthcare PMO about staffing." },
    ],
    forecastTitle: "Forecast brief",
    forecastSub: "45-D outlook",
    followupText: "Draft requisition?",
    followupAccept: "Y",
    followupPrompt: "Draft a Sr PM requisition for the Healthcare practice.",
  };
}

function parseDecisionBriefPayload(payload: string): DecisionBrief {
  const fallback = defaultHealthcareBrief();
  if (!payload) return fallback;
  const parts = payload.split("|");
  const risk = (parts[0] ?? "").trim().toUpperCase();
  const validRisk: DecisionBrief["risk"] = risk === "MED" || risk === "LOW" ? risk : "HIGH";
  const window = (parts[1] ?? "").trim() || fallback.window;
  const headline = (parts[2] ?? "").trim() || fallback.headline;
  const subline = (parts[3] ?? "").trim() || fallback.subline;
  const confRaw = parseInt((parts[4] ?? "").trim(), 10);
  const confidence = isFinite(confRaw) ? Math.max(0, Math.min(100, confRaw)) : fallback.confidence;
  const actionsRaw = (parts[5] ?? "").trim();
  let actions = fallback.actions;
  if (actionsRaw) {
    const parsed: DecisionAction[] = [];
    for (const seg of actionsRaw.split(",")) {
      const [text, chipRaw] = seg.split(":");
      const t = (text ?? "").trim();
      const c = (chipRaw ?? "").trim().toLowerCase();
      if (!t) continue;
      const chip: DecisionAction["chip"] =
        c === "defer"  ? "Defer"  :
        c === "engage" ? "Engage" :
        c === "open"   ? "Open"   :
        "Apply";
      parsed.push({ text: t, chip });
    }
    if (parsed.length > 0) actions = parsed;
  }
  return { risk: validRisk, window, headline, subline, confidence, actions };
}

/** Parses an optional DRAFT_PANEL payload of the form
 *    [DRAFT_PANEL:t^s^icon^prompt;t^s^icon^prompt;...|forecastTitle|forecastSub|followupText|followupAccept|followupPrompt]
 *  Cards are joined by ";" and fields inside each card by "^". Any missing
 *  segment falls back to the Healthcare-PM defaults so a bare [DRAFT_PANEL]
 *  still renders the legacy demo. icon must be one of file/users/briefcase/mail. */
function parseDraftPanelPayload(payload: string): DraftPanel {
  const fallback = defaultHealthcareDraftPanel();
  if (!payload) return fallback;
  const segs = payload.split("|");
  const cardsRaw = (segs[0] ?? "").trim();
  let cards = fallback.cards;
  if (cardsRaw) {
    const parsed: DraftCard[] = [];
    for (const cardSeg of cardsRaw.split(";")) {
      const fields = cardSeg.split("^").map((s) => s.trim());
      const title = fields[0] ?? "";
      const sub = fields[1] ?? "";
      const iconRaw = (fields[2] ?? "").toLowerCase();
      const prompt = fields[3] ?? "";
      if (!title || !prompt) continue;
      const icon: DraftCard["icon"] =
        iconRaw === "users"     ? "users"     :
        iconRaw === "briefcase" ? "briefcase" :
        iconRaw === "mail"      ? "mail"      :
        "file";
      parsed.push({ title, sub, icon, prompt });
    }
    if (parsed.length > 0) cards = parsed;
  }
  const forecastTitle  = (segs[1] ?? "").trim() || fallback.forecastTitle;
  const forecastSub    = (segs[2] ?? "").trim() || fallback.forecastSub;
  const followupText   = (segs[3] ?? "").trim() || fallback.followupText;
  const followupAccept = (segs[4] ?? "").trim() || fallback.followupAccept;
  const followupPrompt = (segs[5] ?? "").trim() || fallback.followupPrompt;
  return { cards, forecastTitle, forecastSub, followupText, followupAccept, followupPrompt };
}

// Rewrite "By <date>," (or " by <date>,") deadlines that are not anchored to
// real schedule data. The model occasionally still emits a fabricated date
// like "By March 20, 2026," in the Recommended Next Action section despite
// the system prompt forbidding it. We rewrite to a relative window UNLESS:
//   • the date is followed by a basis citation in parens — "(target
//     completion)", "(actual end)", "(per schedule)", "(bid date)",
//     "(next phase end)", "(milestone)", or
//   • the same date string appears at least one more time elsewhere in the
//     message (which usually means it came from the [TIMELINE]/dates block).
function scrubUngroundedDeadlines(text: string): string {
  if (!text) return text;
  // Patterns we recognize:
  //   "By March 20, 2026,"  /  "By Mar 20 2026,"  /  "By 20 March 2026,"
  //   "By 03/20/2026,"      /  "By 3-20-2026,"
  const monthName = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const dateRe = new RegExp(
    "(^|[\\s(>])(?:by|By|BY)\\s+(" +
    // Month Day, Year   |   Day Month Year   |   Month Day Year
    `${monthName}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s*\\d{4}` +
    `|\\d{1,2}(?:st|nd|rd|th)?\\s+${monthName}\\s+\\d{4}` +
    // MM/DD/YYYY  /  M-D-YYYY  /  YYYY-MM-DD
    "|\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4}" +
    "|\\d{4}[\\/\\-]\\d{1,2}[\\/\\-]\\d{1,2}" +
    ")\\s*(?:,\\s*|\\s+(?=[a-z]))",
    "g",
  );
  const groundedBasisRe =
    /^\s*\((?:[^)]*\b(?:target|actual|schedule|scheduled|milestone|phase|bid|contract\s+sign|completion|kickoff|kick-off|deadline\s+per|per\s+(?:schedule|contract|RM ONE))\b[^)]*)\)/i;

  return text.replace(dateRe, (full, lead, dateStr, offset: number) => {
    // Look at the chars right after the matched "By <date>, " for an
    // immediate basis citation in parens — if present, leave the line alone.
    const tail = text.slice(offset + full.length, offset + full.length + 80);
    if (groundedBasisRe.test(tail)) return full;
    // Also leave alone if the same date string appears elsewhere in the
    // message (likely echoed from the actual schedule context).
    const sameDate = text.split(dateStr).length - 1;
    if (sameDate >= 2) return full;
    // Otherwise rewrite to a relative window. Preserve the leading char
    // (space, paren, newline) so adjacent prose still reads cleanly.
    return `${lead}Within 1 week, `;
  });
}

export function parseBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  // Strip bold/italic markers that wrap any widget tag. The AI sometimes
  // emits tags like **[SCHEDULE_TABLE:...]** which would otherwise leave
  // dangling "**" pairs in the rendered text after we extract the tag.
  // Covers all widget tag names handled below.
  const WIDGET_TAGS =
    "WEEKLY_ALLOC|ALLOC_FORM|ASSIGN_SETUP|SELECT_PROJECT|SCHEDULE_TABLE|PROJECT_DATES|LIFECYCLE_PICKER|HEALTH_GAUGE|ROSTER_TABLE|PERSON_PROFILE|OPP_TABLE|OPP_TABLE_2|PMM_TABLE|UPDATE_SUCCESS|UPDATE_FAIL|BUTTONS|CHART|TIMELINE|DECISION_BRIEF|DRAFT_PANEL|SUGGESTIONS";
  const wrapRe = new RegExp(
    `(\\*\\*|__)\\s*(\\[(?:${WIDGET_TAGS})(?::[^\\]]*)?\\])\\s*\\1`,
    "gi",
  );
  let cleaned = raw.replace(wrapRe, "$2");
  // Also remove now-orphaned empty bold pairs sitting on their own line
  // (e.g. when only one side of the wrap matched, or the AI emitted a
  // stray "** **" line beside a tag).
  cleaned = cleaned
    .replace(/^\s*(?:\*\*|__)\s*(?:\*\*|__)\s*$/gm, "")
    // Strip standalone "..." lines — LLM filler artifact between sections.
    .replace(/^\s*\.{3}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");

  // Scrub leftover placeholder tokens the model occasionally emits when
  // it doesn't have the actual project / person / value. We strip the
  // placeholder along with adjacent connectors (em-dash, hyphen, colon,
  // brackets) so the sentence still reads cleanly. Examples cleaned up:
  //   "PMM-25-000060 — [Project Name]"        → "PMM-25-000060"
  //   "PMM-25-000060 - [Project Name]:"       → "PMM-25-000060:"
  //   "([Project Name])"                       → ""
  //   "Project: [Project Name]"                → "Project:"
  const PLACEHOLDER_TOKENS =
    "Project Name|ProjectID|Project ID|Address|Full Name|Person Name|Name|Date|Status|Value|Owner|Role|City|Sample Project|Sample Project Name";
  const phRe = new RegExp(`\\[\\s*(?:${PLACEHOLDER_TOKENS})\\s*\\]`, "gi");
  // Drop the redundant "Health Gauge + Score Breakdown" prose section
  // when a [HEALTH_GAUGE] widget is present — the widget already shows
  // the score and a "View health breakdown" expander, so duplicating it
  // as a numbered text section is noise. Also handles the same heading
  // without the leading "7." number, in case the model renumbers.
  if (/\[HEALTH_GAUGE:/i.test(cleaned)) {
    // Walk lines and drop the contiguous block that opens with a
    // "Health Gauge" heading. Stop as soon as we hit ANY of: another
    // heading (markdown # / bold-numbered / bold heading), a widget
    // tag line ([SOMETHING:...]), a horizontal rule, or EOF. This is
    // intentionally line-based rather than one big regex so it can't
    // run away and swallow trailing widgets or unnumbered sections.
    const lines = cleaned.split("\n");
    const out: string[] = [];
    const isHeading = (l: string) => {
      const t = l.trim();
      if (!t) return false;
      if (/^#{1,6}\s/.test(t)) return true;                  // ## Heading
      if (/^\*\*\s*\d+\.\s+\S/.test(t)) return true;         // **7. Foo**
      if (/^\*\*[^*]{2,}\*\*\s*$/.test(t)) return true;      // **Foo**
      if (/^\d+\.\s+[A-Z]/.test(t)) return true;             // 7. Foo
      return false;
    };
    const isWidgetTag = (l: string) => /^\s*\[[A-Z][A-Z0-9_]*:/.test(l);
    const isRule = (l: string) => /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(l);
    const isHealthHeading = (l: string) => {
      // Strip leading markers (#, **, numbering) before matching the title.
      const t = l
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\*\*\s*/, "")
        .replace(/\*\*\s*$/, "")
        .replace(/^\d+\.\s+/, "");
      return /^Health\s+Gauge(?:\s*\+\s*Score\s+Breakdown)?\b/i.test(t);
    };
    let skipping = false;
    for (const line of lines) {
      if (!skipping) {
        if (isHealthHeading(line)) { skipping = true; continue; }
        out.push(line);
      } else {
        // First boundary line ends the skip and is kept as part of output.
        if (isHeading(line) || isWidgetTag(line) || isRule(line)) {
          skipping = false;
          out.push(line);
        }
        // otherwise: drop the line (it's body of the redundant section)
      }
    }
    cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  cleaned = cleaned
    // Strip "  — [Project Name]"  /  " - [Project Name]"  /  " – [Project Name]"
    .replace(new RegExp(`\\s*[—–-]\\s*(?:${phRe.source})`, "gi"), "")
    // Strip "( [Project Name] )" / "[Project Name]" anywhere left
    .replace(new RegExp(`\\(\\s*(?:${phRe.source})\\s*\\)`, "gi"), "")
    .replace(phRe, "")
    // Tidy up any double-spaces or trailing punctuation we just created.
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\n[ \t]+/g, "\n");

  // Extract WEEKLY_ALLOC tags (variable trailing segments).
  //   slot 4 = prefill=...   (or the literal word "autosave")
  //   slot 5 = autosave       (when slot 4 already held the prefill)
  // See mobile chat.tsx:373-470 for the full grammar — this is a verbatim port.
  type WeeklyTag = {
    personName: string; projectId: string; projectName: string;
    prefill?: { phase: string; mode: "add" | "subtract" | "set"; hours: number }[];
    totalSet?: number; perWeekSet?: number; eachPhaseSet?: number;
    clearAll?: boolean; autosave?: boolean; alreadyAssigned?: boolean;
  };
  const weeklyTags: WeeklyTag[] = [];
  // Allow up to 4 stray chars between `[` and `WEEKLY_ALLOC:` — the AI has been
  // observed emitting `[V WEEKLY_ALLOC:Vincent…|PMM-25-000060|…]` (likely a
  // streaming token-boundary artifact). Without this slack the entire tag is
  // silently treated as plain text and the user sees the raw `[V WEEKLY_ALLOC:…]`
  // string instead of the editor card. Mirrors mobile chat.tsx parser.
  const weeklyRe = /\[[^\]\[|]{0,4}WEEKLY_ALLOC:([^|\]]+)(?:\|([^|\]]+))?(?:\|([^|\]]*))?(?:\|([^|\]]*))?(?:\|([^\]]*))?\]/g;
  let wm: RegExpExecArray | null;
  while ((wm = weeklyRe.exec(raw)) !== null) {
    const pName = (wm[1] ?? "").trim();
    const pId = (wm[2] ?? "").trim();
    let pProj = (wm[3] ?? "").trim() || pId;
    if (
      /^<[^>]*>$/.test(pProj) ||
      /^(project\s*name|name|placeholder)$/i.test(pProj) ||
      // Catch the "Project Name Needed" / "Name Needed" / "Project Name Here"
      // family — AI fills the 3rd slot with these literals when it doesn't
      // have the real project name in context (most often when re-emitting
      // the tag a turn or two after the original assignment).
      /\b(needed|here|tbd|unknown|missing)\b/i.test(pProj) ||
      /^project\s+name\b/i.test(pProj)
    ) pProj = pId;

    let prefillRaw = (wm[4] ?? "").trim();
    const tail5 = (wm[5] ?? "").trim();

    // Detect alreadyAssigned=true in any trailing slot before prefill inference.
    const alreadyAssigned =
      /^alreadyAssigned=true$/i.test(prefillRaw) || /^alreadyAssigned=true$/i.test(tail5);
    // If slot 4 was consumed by alreadyAssigned, clear it so we don't try to parse it as prefill.
    if (/^alreadyAssigned=true$/i.test(prefillRaw)) prefillRaw = "";

    // Safety net: bare tag + user clearly asked for an overall/per-week/etc
    // edit → synthesise the missing prefill from the user's wording.
    if (!/^prefill=/i.test(prefillRaw) && !/^autosave$/i.test(prefillRaw)) {
      const inferred = inferPrefillFromUserMessage();
      if (inferred) prefillRaw = inferred;
    }

    let prefill: { phase: string; mode: "add" | "subtract" | "set"; hours: number }[] | undefined;
    let totalSet: number | undefined;
    let perWeekSet: number | undefined;
    let eachPhaseSet: number | undefined;
    let clearAll = false;
    if (prefillRaw.toLowerCase().startsWith("prefill=")) {
      const spec = prefillRaw.slice("prefill=".length);
      const parts = spec.split(";").map(s => s.trim()).filter(Boolean);
      const parsed: { phase: string; mode: "add" | "subtract" | "set"; hours: number }[] = [];
      for (const part of parts) {
        if (/^(clear|clearall|reset|removeall)$/i.test(part)) { clearAll = true; continue; }
        const pwm = part.match(/^per\s*week\s*=\s*(\d+)$/i);
        if (pwm) { perWeekSet = parseInt(pwm[1], 10); continue; }
        const epm = part.match(/^each\s*phase\s*=\s*(\d+)$/i);
        if (epm) { eachPhaseSet = parseInt(epm[1], 10); continue; }
        const tm = part.match(/^total\s*=\s*(\d+)$/i);
        if (tm) { totalSet = parseInt(tm[1], 10); continue; }
        const pm = part.match(/^(.+?):([+\-=])(\d+)$/);
        if (pm) {
          const mode = pm[2] === "+" ? "add" : pm[2] === "-" ? "subtract" : "set";
          parsed.push({ phase: pm[1].trim(), mode, hours: parseInt(pm[3], 10) });
        }
      }
      if (parsed.length > 0) prefill = parsed;
    }
    const autosave = /^autosave$/i.test(prefillRaw) || /^autosave$/i.test(tail5);

    if (pName && pId && /^[A-Z]{2,5}-\d{2,8}(?:-\d{3,8})?$/.test(pId)) {
      weeklyTags.push({
        personName: pName, projectId: pId, projectName: pProj,
        prefill, totalSet, perWeekSet, eachPhaseSet, clearAll, autosave, alreadyAssigned,
      });
    }
    cleaned = cleaned.replace(wm[0], "");
  }

  // Extract ALLOC_FORM tags
  const allocTags: { personName: string; projectId: string; projectName: string }[] = [];
  const allocRe = /\[ALLOC_FORM:([^|]+)\|([^|]+)\|([^\]]*)\]/g;
  let am: RegExpExecArray | null;
  while ((am = allocRe.exec(raw)) !== null) {
    allocTags.push({
      personName: am[1].trim(), projectId: am[2].trim(), projectName: am[3].trim(),
    });
    cleaned = cleaned.replace(am[0], "");
  }

  // Extract ASSIGN_SETUP tags — inline BU/Role/Title picker card emitted by
  // the DIRECT ASSIGNMENT system prompt instead of asking the user to type
  // "BU: …, Role: …, Title: …". On submit the card sends that exact string,
  // so the existing assign_person flow is unchanged.
  const assignSetupTags: { personName: string; projectId: string; projectName: string }[] = [];
  const assignSetupRe = /\[ASSIGN_SETUP:([^|]+)\|([^|]+)\|([^\]]*)\]/g;
  let asm: RegExpExecArray | null;
  while ((asm = assignSetupRe.exec(raw)) !== null) {
    const pn = asm[1].trim();
    const pid = asm[2].trim().toUpperCase();
    let pname = asm[3].trim();
    if (
      !pname ||
      /^<[^>]*>$/.test(pname) ||
      /^(project\s*name|name|placeholder)$/i.test(pname) ||
      /\b(needed|here|tbd|unknown|missing)\b/i.test(pname) ||
      /^project\s+name\b/i.test(pname)
    ) pname = pid;
    if (pn && /^[A-Z]{2,5}-\d{2,8}(?:-\d{3,8})?$/.test(pid)) {
      assignSetupTags.push({ personName: pn, projectId: pid, projectName: pname });
    }
    cleaned = cleaned.replace(asm[0], "");
  }

  // Extract SELECT_PROJECT pills
  const selectProjects: { id: string; label: string }[] = [];
  const selectRe = /\[SELECT_PROJECT:([^\]]+)\]\s*([^\n[]*)/g;
  let sm: RegExpExecArray | null;
  while ((sm = selectRe.exec(cleaned)) !== null) {
    selectProjects.push({ id: sm[1].trim(), label: sm[2].trim() || sm[1].trim() });
    cleaned = cleaned.replace(sm[0], "");
  }

  // Normalize legacy button forms to BUTTONS:
  cleaned = cleaned
    .replace(/\[YES\s*,\s*NO\]/gi, "[BUTTONS:YES,NO]")
    .replace(/\[CONFIRM\s*,\s*NO\]/gi, "[BUTTONS:CONFIRM,NO]")
    .replace(/\[YES_SEND\s*,\s*EDIT\s*,\s*CANCEL\]/gi, "[BUTTONS:YES_SEND,EDIT,CANCEL]");

  // Strip stray "prefill=..." plaintext leak
  cleaned = cleaned.replace(/^\s*prefill=[^\n]*$/gim, "").replace(/\n{3,}/g, "\n\n");

  // ── Anti-hallucination: rewrite ungrounded "By <date>," deadlines ──
  // The model occasionally still emits a deadline like "By March 20, 2026,"
  // or "By 03/20/2026," with no real schedule basis. Rewrite to a relative
  // window UNLESS the same date appears elsewhere in the message (which
  // means it likely came from the actual schedule context) OR the date is
  // followed by a basis citation in parens like "(target completion)".
  cleaned = scrubUngroundedDeadlines(cleaned);

  // Extract [SUGGESTIONS: Q1 | Q2 | Q3] before the main RE so they don't
  // appear as raw text. Collect into an array; emitted as a block at the end.
  const suggestionsQuestions: string[] = [];
  cleaned = cleaned.replace(/\[SUGGESTIONS:\s*([^\]]+)\]/gi, (_, payload: string) => {
    const qs = payload.split("|").map((s: string) => s.trim()).filter(Boolean);
    suggestionsQuestions.push(...qs);
    return "";
  });
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trimEnd();

  // Dedupe SEND/EDIT/CANCEL bars (server post-processor sometimes emits twice)
  const sendRe = /\[BUTTONS:YES_SEND,EDIT,CANCEL\]/gi;
  const sendMatches = [...cleaned.matchAll(sendRe)];
  if (sendMatches.length > 1) {
    let removed = 0;
    cleaned = cleaned.replace(sendRe, (match) => {
      removed++;
      return removed < sendMatches.length ? "" : match;
    });
  }

  const RE =
    /\[CHART:bar\]([\s\S]*?)\[\/CHART\]|\[TIMELINE\]([\s\S]*?)\[\/TIMELINE\]|\[BUTTONS:([^\]]*)\]|(\[ROSTER_TABLE\])|(\[UPDATE_SUCCESS:([^\]]*)\])|(\[UPDATE_FAIL:([^\]]*)\])|(\[PERSON_PROFILE\])|(\[OPP_TABLE\])|(\[OPP_TABLE_2\])|(\[PMM_TABLE\])|(\[SCHEDULE_TABLE:([^\]]+)\])|(\[LIFECYCLE_PICKER:([^\]]+)\])|(\[HEALTH_GAUGE:([^\]]+)\])|(\[PROJECT_DATES:([^\]]+)\])|(\[DECISION_BRIEF(?::([^\]]*))?\])|(\[DRAFT_PANEL(?::([^\]]*))?\])/g;

  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(cleaned)) !== null) {
    if (m.index > lastIndex) blocks.push({ type: "text", content: cleaned.slice(lastIndex, m.index) });
    if (m[1] !== undefined) blocks.push({ type: "chart", content: m[1].trim() });
    else if (m[2] !== undefined) blocks.push({ type: "timeline", content: m[2].trim() });
    else if (m[3] !== undefined) blocks.push({ type: "buttons", labels: m[3].split(",").map((s) => s.trim()) });
    else if (m[4] !== undefined) blocks.push({ type: "roster" });
    else if (m[5] !== undefined) {
      const [recordId, ...rest] = (m[6] ?? "").split("|");
      blocks.push({ type: "update_success", recordId: recordId ?? "", person: rest.join("|") });
    } else if (m[7] !== undefined) {
      blocks.push({ type: "update_fail", reason: m[8] ?? "Unknown error" });
    } else if (m[9] !== undefined) {
      blocks.push({ type: "person_profile" });
    } else if (m[10] !== undefined) {
      blocks.push({ type: "opp_table" });
    } else if (m[11] !== undefined) {
      blocks.push({ type: "opp_table_2" });
    } else if (m[12] !== undefined) {
      blocks.push({ type: "pmm_table" });
    } else if (m[13] !== undefined) {
      blocks.push({ type: "schedule_table", projectId: (m[14] ?? "").trim() });
    } else if (m[15] !== undefined) {
      blocks.push({ type: "lifecycle_picker", projectId: (m[16] ?? "").trim() });
    } else if (m[17] !== undefined) {
      const payload = (m[18] ?? "").trim();
      const parts = payload.split("|");
      const projectId = (parts[0] ?? "").trim();
      const score = Number((parts[1] ?? "0").trim()) || 0;
      const label = (parts[2] ?? "").trim();
      const issuesRaw = (parts[3] ?? "").trim();
      const issues: HGIssue[] = issuesRaw
        ? issuesRaw.split(";").map((s) => {
            const [text, ded] = s.split(":");
            return { text: (text ?? "").trim(), deduction: Number((ded ?? "0").trim()) || 0 };
          }).filter((i) => i.text)
        : [];
      const passedRaw = (parts[4] ?? "").trim();
      const passed: HGIssue[] = passedRaw
        ? passedRaw.split(";").map((s) => {
            const [text, ded] = s.split(":");
            return { text: (text ?? "").trim(), deduction: Number((ded ?? "0").trim()) || 0 };
          }).filter((i) => i.text)
        : [];
      blocks.push({ type: "health_gauge", projectId, score, label, issues, passed });
    } else if (m[19] !== undefined) {
      blocks.push({ type: "project_dates", projectId: (m[20] ?? "").trim() });
    } else if (m[21] !== undefined) {
      blocks.push({ type: "decision_brief", brief: parseDecisionBriefPayload((m[22] ?? "").trim()) });
    } else if (m[23] !== undefined) {
      blocks.push({ type: "draft_panel", panel: parseDraftPanelPayload((m[24] ?? "").trim()) });
    }
    lastIndex = RE.lastIndex;
  }
  if (lastIndex < cleaned.length) blocks.push({ type: "text", content: cleaned.slice(lastIndex) });

  if (suggestionsQuestions.length > 0) blocks.push({ type: "suggestions", questions: suggestionsQuestions.slice(0, 4) });
  if (selectProjects.length > 0) blocks.push({ type: "select_project", projects: selectProjects });
  for (const a of allocTags) blocks.push({ type: "alloc_form", ...a });
  for (const s of assignSetupTags) blocks.push({ type: "assignment_setup", ...s });
  // Dedupe WEEKLY_ALLOC tags by personName|projectId — keep the LAST occurrence
  // for each unique pair. The system prompt tells the AI "only the last one
  // renders" but the parser previously rendered every tag, so when the AI
  // emitted (e.g.) a bare tag plus a prefill tag for the same person/project
  // in one reply, the user saw two stacked editor cards. Mobile already
  // collapses to a single weeklyAlloc upstream — this brings web in line.
  const dedupedWeekly = new Map<string, typeof weeklyTags[number]>();
  for (const w of weeklyTags) {
    dedupedWeekly.set(`${w.personName}|${w.projectId}`, w);
  }
  for (const w of dedupedWeekly.values()) blocks.push({ type: "weekly_alloc", ...w });

  return blocks;
}
