import type { RosterPerson, OppRow, PmmRow, PersonProfile } from "./api";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  loading?: boolean;
  /** For assistant messages still being streamed */
  isStreaming?: boolean;
  /** Live tool-progress line ("Fetching project details…") streamed by the
   * server while tools execute. Cleared when the next content token lands. */
  statusText?: string;
  /** Sidecar structured data — comes from SSE events independent of text */
  roster?: RosterPerson[];
  oppTable?: { title: string; rows: OppRow[]; summary: string };
  oppTable2?: { title: string; rows: OppRow[]; summary: string };
  pmmTable?: { title: string; rows: PmmRow[]; summary: string };
  personProfile?: PersonProfile;
  /** Persisted confirmation state for the SITREP Decision-Support action
   * chips (APPLY / DEFER / ENGAGE / OPEN). Keyed by the action's index in
   * the parsed DecisionBrief.actions array so the confirmation survives
   * mobile virtualization unmounts and chat-history reloads. Absent /
   * missing keys mean "not confirmed yet". */
  chipStates?: Record<number, boolean>;
}

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  messages: ChatMessage[];
  /** `${tenant}|${username}` — written on every save so cross-tenant/user
   *  sessions can be detected and discarded on load. Optional for backward
   *  compatibility with sessions saved before this field was added. */
  _owner?: string;
}
