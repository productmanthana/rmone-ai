/* Shared type for the decision-support action payloads. Mirrors the
 * declaration in artifacts/rmone-mobile/app/(tabs)/chat.tsx so picker
 * sheet components can be imported without pulling in the giant chat
 * module. Keep these two declarations in sync. */
export type DecisionActionPayload =
  | { kind: "shift_allocation"; personName: string; projectId: string; hoursPerWeek: number }
  | { kind: "defer_pursuit"; pursuitName: string; days: number; recordId?: string }
  | { kind: "engage_candidates"; role: string; count: number; recipients?: string[] }
  | { kind: "open_requisition"; title: string; closeInDays: number; manager?: string };
