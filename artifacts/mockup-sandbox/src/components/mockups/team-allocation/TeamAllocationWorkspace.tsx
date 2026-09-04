import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Layers3,
  Plus,
  UserRound,
  UsersRound,
} from "lucide-react";

type Mode = "person" | "position";

type Week = {
  label: string;
  date: string;
  capacity: number;
  booked: number;
  planned: number;
  remaining: number;
};

const weeks: Week[] = [
  { label: "Aug 24", date: "W35", capacity: 40, booked: 28, planned: 8, remaining: 4 },
  { label: "Aug 31", date: "W36", capacity: 40, booked: 34, planned: 4, remaining: 2 },
  { label: "Sep 07", date: "W37", capacity: 40, booked: 16, planned: 12, remaining: 12 },
  { label: "Sep 14", date: "W38", capacity: 40, booked: 40, planned: 0, remaining: 0 },
  { label: "Sep 21", date: "W39", capacity: 40, booked: 20, planned: 8, remaining: 12 },
  { label: "Sep 28", date: "W40", capacity: 40, booked: 8, planned: 16, remaining: 16 },
  { label: "Oct 05", date: "W41", capacity: 40, booked: 0, planned: 16, remaining: 24 },
];

const baseStyles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#F3F7FA",
    color: "#173246",
    fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: 28,
  },
  eyebrow: {
    color: "#5D7B8C",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
  },
  label: {
    color: "#6B8492",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  muted: { color: "#6D8491" },
};

function SelectBox({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 7, minWidth: 220 }}>
      <div style={{ ...baseStyles.label, display: "flex", alignItems: "center", gap: 6 }}>
        <Icon size={13} strokeWidth={2.2} />
        {label}
      </div>
      <button
        type="button"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          border: "1px solid #BFD0D9",
          background: "#FFFFFF",
          borderRadius: 9,
          color: "#173246",
          padding: "12px 13px",
          textAlign: "left",
          fontSize: 13,
          fontWeight: 700,
          boxShadow: "0 2px 7px rgba(31,65,82,0.05)",
        }}
      >
        <span>
          {value}
          {hint && <span style={{ display: "block", marginTop: 3, color: "#76909D", fontSize: 10, fontWeight: 500 }}>{hint}</span>}
        </span>
        <ChevronDown size={15} color="#6D8491" />
      </button>
    </div>
  );
}

function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "warn" | "neutral" }) {
  const palette = {
    good: { background: "#E4F2D7", border: "#B9D995", color: "#4A782B" },
    warn: { background: "#FFF2D7", border: "#EBCB8D", color: "#946B1C" },
    neutral: { background: "#E9F0F3", border: "#CFDDE3", color: "#58727F" },
  }[tone];
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      border: `1px solid ${palette.border}`,
      borderRadius: 999,
      padding: "5px 8px",
      background: palette.background,
      color: palette.color,
      fontSize: 10,
      fontWeight: 800,
      whiteSpace: "nowrap",
    }}>
      {tone === "good" ? <CheckCircle2 size={12} /> : tone === "warn" ? <AlertTriangle size={12} /> : <Clock3 size={12} />}
      {children}
    </span>
  );
}

function AllocationInput({ value, remaining, onChange }: { value: number; remaining: number; onChange: (value: number) => void }) {
  const over = value > remaining;
  return (
    <div style={{ position: "relative" }}>
      <input
        aria-label="Hours for this week"
        value={value}
        onChange={event => onChange(Math.max(0, Number(event.target.value) || 0))}
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: `1px solid ${over ? "#D99B84" : value > 0 ? "#8BB85B" : "#C7D6DD"}`,
          background: over ? "#FFF5F1" : value > 0 ? "#F3FAED" : "#FFFFFF",
          borderRadius: 7,
          color: "#173246",
          padding: "9px 7px 8px",
          textAlign: "center",
          fontSize: 13,
          fontWeight: 800,
          outline: "none",
        }}
      />
      <span style={{ display: "block", marginTop: 4, color: over ? "#AE644E" : "#7A919D", fontSize: 9, textAlign: "center" }}>
        {over ? "over capacity" : value > 0 ? `${remaining - value}h left` : "add hours"}
      </span>
    </div>
  );
}

export function TeamAllocationWorkspace() {
  const [mode, setMode] = useState<Mode>("person");
  const [hours, setHours] = useState(() => weeks.map(week => week.planned));
  const total = useMemo(() => hours.reduce((sum, value) => sum + value, 0), [hours]);
  const hasWarning = hours.some((value, index) => value > weeks[index].remaining);

  const setWeekHours = (index: number, value: number) => {
    setHours(previous => previous.map((current, currentIndex) => currentIndex === index ? value : current));
  };

  return (
    <div style={baseStyles.page}>
      <div style={{ maxWidth: 1390, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, flexWrap: "wrap", marginBottom: 22 }}>
          <div>
            <div style={baseStyles.eyebrow}>Project team / allocation</div>
            <h1 style={{ margin: "8px 0 6px", color: "#173246", fontSize: 27, lineHeight: 1.1, letterSpacing: "-0.04em" }}>
              Add someone to the team
            </h1>
            <p style={{ ...baseStyles.muted, margin: 0, fontSize: 13 }}>
              Select the role and person once. Review availability and add weekly hours in the same workspace.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 4 }}>
            <div style={{ ...baseStyles.label, marginRight: 3 }}>Project</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #C7D6DD", borderRadius: 9, background: "#FFFFFF", padding: "9px 12px", color: "#173246", fontSize: 12, fontWeight: 800 }}>
              <Layers3 size={14} color="#5C8EAE" />
              Riverside Office · PMM-26-00492
            </div>
          </div>
        </div>

        <section style={{ border: "1px solid #C7D6DD", borderRadius: 14, background: "#FFFFFF", boxShadow: "0 14px 34px rgba(38,74,91,0.10)", overflow: "hidden" }}>
          <div style={{ borderBottom: "1px solid #DCE6EA", padding: "18px 22px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
              <div>
                <div style={baseStyles.label}>1 · Choose who to add</div>
                <div style={{ marginTop: 5, color: "#173246", fontSize: 17, fontWeight: 800 }}>Role and person are the only required choices</div>
              </div>
              <div style={{ display: "flex", gap: 3, border: "1px solid #CEDCE2", borderRadius: 10, background: "#F3F7F9", padding: 3 }}>
                {([
                  ["person", "Assigned person", UserRound],
                  ["position", "Open position", BriefcaseBusiness],
                ] as const).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      border: 0,
                      borderRadius: 7,
                      background: mode === key ? "#FFFFFF" : "transparent",
                      color: mode === key ? "#173246" : "#718793",
                      boxShadow: mode === key ? "0 2px 6px rgba(31,65,82,0.10)" : "none",
                      padding: "9px 11px",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 0.8fr) minmax(260px, 1fr) minmax(280px, 1.15fr)", gap: 14, marginTop: 17 }}>
              <SelectBox icon={BriefcaseBusiness} label="Role" value={mode === "person" ? "Project Manager" : "Project Manager"} hint="Exact role match" />
              <SelectBox icon={mode === "person" ? UserRound : BriefcaseBusiness} label={mode === "person" ? "Assigned person" : "Open position"} value={mode === "person" ? "John Smith" : "Project Manager · Open position"} hint={mode === "person" ? "Senior Project Manager" : "1 slot available"} />
              <div style={{ display: "flex", alignItems: "center", gap: 11, border: "1px solid #D5E2E7", borderRadius: 10, background: "#F8FBFC", padding: "12px 14px" }}>
                <div style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 9, background: "#E6F0F5", color: "#4C84A5" }}>
                  <Check size={18} strokeWidth={2.5} />
                </div>
                <div>
                  <div style={baseStyles.label}>Auto-filled from selection</div>
                  <div style={{ marginTop: 5, color: "#395566", fontSize: 12, fontWeight: 700 }}>
                    {mode === "person" ? "John’s current organization context" : "Role’s default organization context"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "292px minmax(800px, 1fr)", minHeight: 520 }}>
            <aside style={{ borderRight: "1px solid #DCE6EA", background: "#F8FBFC", padding: 22 }}>
              <div style={baseStyles.label}>Selection summary</div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 15 }}>
                <div style={{ display: "grid", placeItems: "center", width: 43, height: 43, borderRadius: 12, background: "#DDECF4", color: "#4C84A5" }}>
                  {mode === "person" ? <UserRound size={21} /> : <BriefcaseBusiness size={21} />}
                </div>
                <div>
                  <div style={{ color: "#173246", fontSize: 14, fontWeight: 800 }}>{mode === "person" ? "John Smith" : "Open position"}</div>
                  <div style={{ marginTop: 3, color: "#708894", fontSize: 11 }}>{mode === "person" ? "Senior Project Manager" : "Project Manager"}</div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 11, marginTop: 26 }}>
                {[
                  ["Business Unit", "Telecom"],
                  ["Division", "Telecom"],
                  ["Department", "Project Management"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div style={baseStyles.label}>{label}</div>
                    <div style={{ marginTop: 6, borderBottom: "1px solid #D8E3E8", paddingBottom: 8, color: "#3A5969", fontSize: 12, fontWeight: 700 }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 29, borderTop: "1px solid #D8E3E8", paddingTop: 18 }}>
                <div style={baseStyles.label}>Project dates</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, color: "#3A5969", fontSize: 12, fontWeight: 700 }}>
                  <CalendarDays size={15} color="#5C8EAE" />
                  Aug 24 – Oct 11, 2026
                </div>
                <div style={{ marginTop: 9, color: "#7A919D", fontSize: 10, lineHeight: 1.5 }}>
                  Weeks outside the project schedule stay unavailable.
                </div>
              </div>

              <div style={{ marginTop: 27, display: "flex", alignItems: "center", gap: 8, color: "#68818E", fontSize: 11 }}>
                <UsersRound size={14} />
                Existing team: 8 members
              </div>
            </aside>

            <main style={{ minWidth: 0, padding: "22px 22px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <div style={baseStyles.label}>2 · Plan weekly hours</div>
                  <div style={{ marginTop: 5, color: "#173246", fontSize: 17, fontWeight: 800 }}>Availability for {mode === "person" ? "John Smith" : "this open position"}</div>
                  <div style={{ marginTop: 5, color: "#708894", fontSize: 11.5 }}>Existing workload is shown first; enter this project’s hours in the green row.</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusPill tone={hasWarning ? "warn" : "good"}>{hasWarning ? "Capacity warning" : "Within capacity"}</StatusPill>
                  <StatusPill tone="neutral">{total}h planned</StatusPill>
                </div>
              </div>

              <div style={{ marginTop: 20, overflowX: "auto", border: "1px solid #D5E2E7", borderRadius: 11 }}>
                <div style={{ minWidth: 790 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "150px repeat(7, minmax(88px, 1fr))", background: "#F5F9FA", borderBottom: "1px solid #D5E2E7" }}>
                    <div style={{ padding: "13px 12px", ...baseStyles.label }}>Week of</div>
                    {weeks.map(week => (
                      <div key={week.label} style={{ borderLeft: "1px solid #E2EBEE", padding: "11px 7px 9px", textAlign: "center" }}>
                        <div style={{ color: "#395566", fontSize: 11, fontWeight: 800 }}>{week.label}</div>
                        <div style={{ marginTop: 3, color: "#91A4AE", fontSize: 9, fontWeight: 700 }}>{week.date}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "150px repeat(7, minmax(88px, 1fr))", borderBottom: "1px solid #E3ECEF" }}>
                    <div style={{ padding: "14px 12px", color: "#6B8492", fontSize: 10, fontWeight: 800 }}>Capacity</div>
                    {weeks.map(week => (
                      <div key={week.label} style={{ borderLeft: "1px solid #E7EEF1", padding: "14px 7px", textAlign: "center", color: "#617D8A", fontSize: 12, fontWeight: 800 }}>
                        {week.capacity}h
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "150px repeat(7, minmax(88px, 1fr))", borderBottom: "1px solid #E3ECEF" }}>
                    <div style={{ padding: "14px 12px" }}>
                      <div style={{ color: "#6B8492", fontSize: 10, fontWeight: 800 }}>Existing work</div>
                      <div style={{ marginTop: 4, color: "#94A6AF", fontSize: 9 }}>other projects</div>
                    </div>
                    {weeks.map(week => (
                      <div key={week.label} style={{ borderLeft: "1px solid #E7EEF1", padding: "14px 7px", textAlign: "center" }}>
                        <div style={{ height: 5, overflow: "hidden", borderRadius: 999, background: "#E4ECEF" }}>
                          <div style={{ width: `${Math.min(100, week.booked / week.capacity * 100)}%`, height: "100%", borderRadius: 999, background: week.booked >= week.capacity ? "#D18B71" : "#6C9DB9" }} />
                        </div>
                        <div style={{ marginTop: 7, color: "#526E7C", fontSize: 12, fontWeight: 800 }}>{week.booked}h</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "150px repeat(7, minmax(88px, 1fr))", background: "#F5FAF0", borderBottom: "1px solid #D9E9CF" }}>
                    <div style={{ padding: "15px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#4F782F", fontSize: 10, fontWeight: 900 }}>This project <Plus size={12} /></div>
                      <div style={{ marginTop: 4, color: "#72955C", fontSize: 9 }}>type hours directly</div>
                    </div>
                    {weeks.map((week, index) => (
                      <div key={week.label} style={{ borderLeft: "1px solid #DDEBD5", padding: "11px 7px 8px" }}>
                        <AllocationInput value={hours[index]} remaining={week.remaining} onChange={value => setWeekHours(index, value)} />
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "150px repeat(7, minmax(88px, 1fr))" }}>
                    <div style={{ padding: "14px 12px", color: "#6B8492", fontSize: 10, fontWeight: 800 }}>Remaining</div>
                    {weeks.map((week, index) => {
                      const remaining = week.remaining - hours[index];
                      return (
                        <div key={week.label} style={{ borderLeft: "1px solid #E7EEF1", padding: "14px 7px", textAlign: "center", color: remaining < 0 ? "#AE644E" : remaining === 0 ? "#8A6A28" : "#5C7F44", fontSize: 12, fontWeight: 900 }}>
                          {remaining}h
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, marginTop: 18, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, color: hasWarning ? "#9A644E" : "#5D7E43", fontSize: 11, fontWeight: 700 }}>
                  {hasWarning ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                  {hasWarning ? "Review the weeks above capacity before adding this person." : "Hours can be adjusted after adding the team member."}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button type="button" style={{ border: "1px solid #C7D6DD", borderRadius: 8, background: "#FFFFFF", color: "#5C7481", padding: "10px 15px", fontSize: 12, fontWeight: 800 }}>Cancel</button>
                  <button type="button" style={{ display: "inline-flex", alignItems: "center", gap: 8, border: 0, borderRadius: 8, background: "#5B8D4B", color: "#FFFFFF", padding: "11px 17px", fontSize: 12, fontWeight: 800, boxShadow: "0 5px 12px rgba(91,141,75,0.22)" }}>
                    Add to team <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            </main>
          </div>
        </section>

        <div style={{ display: "flex", justifyContent: "center", gap: 9, marginTop: 16, color: "#8499A4", fontSize: 10 }}>
          <span>Role and person stay explicit.</span>
          <span>•</span>
          <span>Organization fields are derived automatically.</span>
          <span>•</span>
          <span>Hours are entered against real availability.</span>
        </div>
      </div>
    </div>
  );
}