/* ─────────────────────────────────────────────────────────────
 * OrgDimPicker — shared organization-dimension chips for the
 * Reports / Analytics pages: Division (default) / Business Unit /
 * Department. The three dimensions are SEPARATE canonical fields
 * (business-unit-separate-entity rule) — switching the chip regroups
 * real aggregation data; it never relabels one dimension as another.
 *
 * useOrgDim(storageKey) persists the choice per page family in
 * sessionStorage (same pattern as the reports period state).
 * ──────────────────────────────────────────────────────────── */
import { useState } from "react";
import { MC, useMC } from "@/components/analytics/MissionKit";
import { ORG_DIMS, type OrgDim } from "@/lib/analyticsCenter";

export function useOrgDim(storageKey: string): [OrgDim, (v: OrgDim) => void] {
  const [dim, setDim] = useState<OrgDim>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw === "division" || raw === "businessUnit" || raw === "department") return raw;
    } catch { /* fall through */ }
    return "division";
  });
  const set = (v: OrgDim) => {
    setDim(v);
    try { sessionStorage.setItem(storageKey, v); } catch { /* non-fatal */ }
  };
  return [dim, set];
}

export function OrgDimPicker({ value, onChange, dark = false }: {
  value: OrgDim;
  onChange: (v: OrgDim) => void;
  dark?: boolean;
}) {
  const theme = useMC();
  const mc = dark ? MC : theme;
  return (
    <div style={{
      display: "inline-flex", gap: 3, padding: 3, borderRadius: 999,
      border: `1px solid ${mc.border}`, background: "rgba(127,127,127,0.06)",
    }}>
      {ORG_DIMS.map(d => {
        const active = value === d.key;
        return (
          <span
            key={d.key}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            title={`Group by ${d.label}`}
            onClick={() => onChange(d.key)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange(d.key); } }}
            style={{
              padding: "5px 11px", borderRadius: 999, fontSize: 11, fontWeight: 700,
              cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
              color: active ? "#16240a" : mc.muted,
              background: active ? "linear-gradient(140deg, #8EC94A, #6BA539)" : "transparent",
            }}
          >
            {d.short}
          </span>
        );
      })}
    </div>
  );
}
