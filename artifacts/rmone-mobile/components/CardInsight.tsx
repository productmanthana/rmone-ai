export type InsightKind = "project" | "opportunity" | "lead" | "staff" | "demand";
export type InsightSeverity = "red" | "amber" | "green";
export interface CardInsightValue { severity: InsightSeverity; text: string }

// AI INSIGHT strip removed per user request — no rendering on any card.
// Component kept as a no-op so existing call sites and imports stay valid.
export function CardInsight(_props: {
  kind: InsightKind;
  id: string;
  fields: Record<string, unknown>;
}) {
  return null;
}
