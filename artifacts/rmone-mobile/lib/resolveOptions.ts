// Builders for the "Resolve now" options picker on the Daily Briefing.
// Each hero maps to a short list of concrete fixes that deep-link to the
// screen where the problem actually lives; handing off to AI Chat is
// always the explicit LAST option, never the default.

export interface ResolveOption {
  /** Stable key for testIDs. */
  id: string;
  /** Short action label ("Rebalance their workload"). */
  title: string;
  /** One-line explanation of where this takes the user. */
  sub: string;
  /** Feather icon name. */
  icon: string;
  /** expo-router destination. Omitted for the AI option. */
  to?: string;
  /** True for the "Ask AI" last option. */
  ai?: boolean;
}

const AI_OPTION: ResolveOption = {
  id: "ai",
  title: "Ask the AI assistant",
  sub: "Open AI Chat with this issue pre-filled and get a suggested plan",
  icon: "zap",
  ai: true,
};

const TICKET_RE = /[A-Z]{2,4}-\d{2}-\d{4,6}/;

/** Extract a ticket ID from the ref's label/sub/refId, if one exists. */
function ticketFrom(ref: { refId: string; label: string; sub?: string }): string | null {
  const inText = `${ref.label} ${ref.sub ?? ""}`.match(TICKET_RE);
  if (inText) return inText[0];
  // open-demands refIds embed the top demand's ticket as the last segment.
  const seg = ref.refId.split(":").pop() ?? "";
  return TICKET_RE.test(seg) ? seg : null;
}

export function buildBriefingResolveOptions(ref: {
  refId: string;
  label: string;
  level: string;
  sub?: string;
}): ResolveOption[] {
  const opts: ResolveOption[] = [];
  const ticket = ticketFrom(ref);

  if (ref.refId.startsWith("briefing:over-allocated")) {
    opts.push(
      {
        id: "workload",
        title: "Rebalance their workload",
        sub: "Open Resources to review this person's allocations week by week",
        icon: "users",
        to: "/(tabs)/resources",
      },
      {
        id: "forecast",
        title: "Check the capacity forecast",
        sub: "See where the overload sits in the coming weeks",
        icon: "trending-up",
        to: "/(tabs)/forecast",
      },
    );
  } else if (ref.refId.startsWith("briefing:open-demands")) {
    if (ticket) {
      opts.push({
        id: "project",
        title: "Open the project",
        sub: `Go to ${ticket} and staff the open position from its team card`,
        icon: "folder",
        to: `/project/${ticket}`,
      });
    }
    opts.push({
      id: "demand",
      title: "Review open demands",
      sub: "Open Resources to see every unfilled position and find people",
      icon: "user-plus",
      to: "/(tabs)/resources",
    });
  } else if (ref.refId.startsWith("briefing:pipeline")) {
    opts.push(
      {
        id: "pipeline",
        title: "Review the pipeline",
        sub: "Open Projects to inspect open opportunities and close dates",
        icon: "briefcase",
        to: "/(tabs)/projects",
      },
      {
        id: "forecast",
        title: "Check the forecast",
        sub: "See how the weighted pipeline lands against capacity",
        icon: "trending-up",
        to: "/(tabs)/forecast",
      },
    );
  } else {
    // Unknown hero kind — still offer a sensible starting point.
    if (ticket) {
      opts.push({
        id: "project",
        title: "Open the project",
        sub: `Go to ${ticket} to review and fix it directly`,
        icon: "folder",
        to: `/project/${ticket}`,
      });
    }
    opts.push({
      id: "resources",
      title: "Review team workload",
      sub: "Open Resources to check allocations and open demands",
      icon: "users",
      to: "/(tabs)/resources",
    });
  }

  opts.push(AI_OPTION);
  return opts;
}
