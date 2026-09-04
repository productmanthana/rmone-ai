/* ─────────────────────────────────────────────────────────────
 * PeriodPicker — shared reporting-period chips for the Reports
 * pages: This quarter (default) / week / month / YTD / custom.
 * Custom dates are parsed as LOCAL days in reportsCenter, never UTC.
 * ──────────────────────────────────────────────────────────── */
import { MC, useMC } from "@/components/analytics/MissionKit";
import { PERIOD_CHOICES, type PeriodKind } from "@/lib/reportsCenter";

export type PeriodState = { kind: PeriodKind; customStart: string; customEnd: string };

export const DEFAULT_PERIOD: PeriodState = { kind: "quarter", customStart: "", customEnd: "" };

export function PeriodPicker({ value, onChange, dark = false }: {
  value: PeriodState;
  onChange: (v: PeriodState) => void;
  dark?: boolean;
}) {
  const theme = useMC();
  const mc = dark ? MC : theme;
  const dateInput = (key: "customStart" | "customEnd", label: string) => (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: mc.faint }}>
      {label}
      <input
        type="date"
        value={value[key]}
        onChange={e => onChange({ ...value, [key]: e.target.value })}
        style={{
          padding: "4px 7px", borderRadius: 8, fontSize: 11.5,
          border: `1px solid ${mc.border}`, background: "transparent", color: mc.text,
          colorScheme: "dark light",
        }}
      />
    </label>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <div style={{
        display: "inline-flex", gap: 3, padding: 3, borderRadius: 999,
        border: `1px solid ${mc.border}`, background: "rgba(127,127,127,0.06)",
      }}>
        {PERIOD_CHOICES.map(c => {
          const active = value.kind === c.kind;
          return (
            <span
              key={c.kind}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => onChange({ ...value, kind: c.kind })}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange({ ...value, kind: c.kind }); } }}
              style={{
                padding: "5px 11px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                color: active ? "#16240a" : mc.muted,
                background: active ? "linear-gradient(140deg, #8EC94A, #6BA539)" : "transparent",
              }}
            >
              {c.label}
            </span>
          );
        })}
      </div>
      {value.kind === "custom" && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {dateInput("customStart", "From")}
          {dateInput("customEnd", "To")}
        </div>
      )}
    </div>
  );
}
