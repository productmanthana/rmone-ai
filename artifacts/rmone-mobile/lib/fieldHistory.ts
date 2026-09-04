import { compactUsd } from "./money";

export type FinancialHistoryModule = "PMM" | "OPM" | "LEM";

export const FIELD_HISTORY_LABELS: Record<string, string> = {
  ContractValue: "Contract Value",
  ApproxContractValue: "Approx Contract Value",
  ProjectValue: "Project Value",
  LaborContractAmount: "Labor Contract",
};

/** Only record types with the financial value fields expose their history affordances. */
export function canShowFinancialHistory(module: string, canEditFinancials: boolean): boolean {
  return canEditFinancials && (["PMM", "OPM", "LEM"] as string[]).includes(module);
}

export function formatHistoryValue(value: string | null): string {
  if (value == null || value === "") return "blank";
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const absolute = Math.abs(number);
  if (absolute >= 1_000_000_000) {
    const compact = compactUsd(absolute);
    return number < 0 ? `-${compact}` : compact;
  }
  const formatted = absolute.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return number < 0 ? `-$${formatted}` : `$${formatted}`;
}

export function historyActor(changedBy: string | null, source: string): string {
  return changedBy
    ?? (source === "import"
      ? "File import"
      : source === "auto" ? "System (automatic)" : "Unknown user");
}

export function historySourceBadge(source: string): string | null {
  if (source === "import") return "File import";
  if (source === "auto") return "System (automatic)";
  return null;
}

/** Deliberately uses the device locale/time zone, matching the native history sheet. */
export function formatHistoryDate(changedAt: string): string {
  return new Date(changedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}