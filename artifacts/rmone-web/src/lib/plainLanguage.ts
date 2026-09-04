// ---------------------------------------------------------------------------
// Plain-language helpers.
//
// RM ONE's home page, daily briefing and side panels lean on industry
// shorthand ("demand coverage", "active portfolio", "concentration risk").
// This module translates those signals into words a non-specialist can act
// on, and replaces the one-size-fits-all "Why it matters" boilerplate with
// copy that is specific to WHAT kind of risk is being shown.
//
// Risk builders in homeIntelligence tag rows with a stable `kind` key; for
// older builders that don't, classifyRisk() falls back to keyword inference
// on the title/sub text so every row still gets sensible copy.
// ---------------------------------------------------------------------------

export type RiskKind =
  | "concentration"
  | "data-quality"
  | "over-allocation"
  | "demand-coverage"
  | "bench"
  | "pipeline"
  | "schedule"
  | "financial"
  | "generic";

/** Resolve a stable risk kind: explicit tag first, keyword fallback second. */
export function classifyRisk(
  kind: string | undefined,
  title: string,
  sub?: string,
): RiskKind {
  const k = (kind || "").toLowerCase();
  if (k.includes("concentration")) return "concentration";
  if (k.includes("data")) return "data-quality";
  if (k.includes("over-alloc") || k.includes("overload") || k.includes("utilization")) return "over-allocation";
  if (k.includes("demand") || k.includes("coverage")) return "demand-coverage";
  if (k.includes("bench")) return "bench";
  if (k.includes("pipeline") || k.includes("pursuit")) return "pipeline";
  if (k.includes("schedule") || k.includes("milestone")) return "schedule";
  if (k.includes("financ") || k.includes("margin") || k.includes("cash")) return "financial";

  const t = `${title} ${sub ?? ""}`.toLowerCase();
  if (t.includes("concentration") || t.includes("reliance on one client") || t.includes("rides on this one client")) return "concentration";
  if (t.includes("missing a client") || t.includes("data quality") || t.includes("not recorded")) return "data-quality";
  if (t.includes("over capacity") || t.includes("overload")) return "over-allocation";
  if (/\d{2,3}\s*%/.test(title) && (t.includes("utilization") || t.includes("allocat"))) return "over-allocation";
  if (t.includes("demand") || t.includes("unfilled") || t.includes("no one assigned") || t.includes("coverage") || t.includes("open position") || t.includes("staffing") || t.includes("gap") || t.includes("concurrent req")) return "demand-coverage";
  if (t.includes("bench") || t.includes("idle") || t.includes("unassigned time")) return "bench";
  if (t.includes("pipeline") || t.includes("pursuit") || t.includes("bid") || t.includes("proposal") || t.includes("early-stage")) return "pipeline";
  if (t.includes("overdue") || t.includes("milestone") || t.includes("deadline") || t.includes("schedule") || t.includes("closing") || t.includes("slip")) return "schedule";
  if (t.includes("margin") || t.includes("invoice") || t.includes("cash") || t.includes("revenue") || t.includes("$")) return "financial";
  return "generic";
}

/** One plain-words sentence per kind — the "In plain words" line. */
export const PLAIN_WORDS: Record<RiskKind, string> = {
  concentration:
    "A big share of your active work comes from a single client. If that client pauses or leaves, a lot of revenue goes with them.",
  "data-quality":
    "Some records are missing information. Nothing is wrong with the work itself — the records just need a quick update.",
  "over-allocation":
    "Someone is booked for more hours than they can actually work. Deadlines slip or people burn out unless the load is shared.",
  "demand-coverage":
    "Projects have asked for people who haven't been assigned yet. Unfilled roles can delay work from starting on time.",
  bench:
    "Some people have working time that isn't assigned to any project — time you pay for but can't bill.",
  pipeline:
    "This is about future work you're bidding on, not projects already underway. It affects revenue coming in later.",
  schedule:
    "Dates are at risk — something is due soon or already running late.",
  financial:
    "This directly affects money on your projects — value, billing, or costs.",
  generic:
    "The system spotted a pattern in your live data that's worth a look.",
};

/**
 * Kind- and tone-specific "Why it matters" copy. Replaces the generic
 * "leaving this unaddressed will almost certainly impact delivery, margin,
 * or client confidence" boilerplate that used to appear on every row.
 */
export function whyItMatters(
  kind: RiskKind,
  tone: "high" | "med" | "info",
): string {
  const base: Record<RiskKind, string> = {
    concentration:
      "Relying heavily on one client is fragile — a single decision by that client could remove a large slice of revenue at once. Winning work from other clients spreads that risk.",
    "data-quality":
      "Missing details make your reports less trustworthy. A few minutes updating the records gives you a truer picture of the business.",
    "over-allocation":
      "Overloaded people miss deadlines and burn out. Moving some of their work to teammates protects both the person and the schedule.",
    "demand-coverage":
      "Every unfilled role is work that may not start on time. Filling these early keeps project schedules intact.",
    bench:
      "Unassigned time is money spent with nothing billed against it. Placing people on projects recovers that cost.",
    pipeline:
      "Next quarter's revenue depends on today's pursuits. Letting bids stall quietly shrinks future income.",
    schedule:
      "Late dates ripple — one slipped milestone pushes everything after it and can delay billing too.",
    financial:
      "This touches revenue or cost directly, so small moves here have an outsized effect on margin.",
    generic:
      "Reviewing it now is quick; leaving it can let a small issue grow into a bigger one.",
  };
  const prefix =
    tone === "high"
      ? "Marked critical because it needs attention this week. "
      : tone === "med"
        ? "Marked as a warning — not urgent yet, but heading the wrong way. "
        : "Shared for awareness — no immediate action needed. ";
  return prefix + base[kind];
}

/** Glossary of shorthand terms that appear in KPI labels and card copy. */
export const GLOSSARY: { term: string; plain: string }[] = [
  { term: "demand coverage", plain: "Of all the people your projects have asked for, the share actually assigned. 100% means every request is filled." },
  { term: "active portfolio", plain: "The combined value of all projects currently in progress." },
  { term: "active work", plain: "The combined value of all projects currently in progress." },
  { term: "utilization", plain: "How much of a person's available working time is booked on projects." },
  { term: "pipeline", plain: "Work you're pursuing but haven't won yet." },
  { term: "bench", plain: "People on payroll who aren't assigned to a project right now." },
  { term: "concentration", plain: "Too much of your work depending on a single client." },
  { term: "pursuit", plain: "A piece of work you're actively bidding on." },
  { term: "hours on plan", plain: "Whether the hours people are actually booking match what was planned." },
  { term: "forecast", plain: "The hours or revenue expected in the coming weeks based on current assignments." },
  { term: "capacity", plain: "The total working hours your team has available." },
  { term: "margin", plain: "What's left of the project fee after paying for the work." },
  { term: "backlog", plain: "Work already won but not yet delivered." },
];

/** First glossary entry whose term appears in the given text, or null. */
export function plainTermFor(text: string): { term: string; plain: string } | null {
  const t = (text || "").toLowerCase();
  for (const g of GLOSSARY) {
    if (t.includes(g.term)) return g;
  }
  return null;
}
