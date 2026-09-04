import { useState, useMemo, useRef, useEffect } from "react";

const G = "#6BA539";
const G_LIGHT = "#f0f7ea";
const G_MED = "#ddefd0";
const BORDER = "#e5e7eb";
const BG = "#f8f9fa";
const PANEL = "#ffffff";
const TEXT = "#111827";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";

const categories = [
  {
    id: "projects",
    label: "Projects & Opportunities",
    icon: "📋",
    color: "#6BA539",
    sections: [
      {
        id: "proj-defaults",
        title: "Project Defaults",
        desc: "Status, type and lifecycle defaults applied to every new project",
        fields: [
          { label: "Default project status", type: "select", value: "Active", options: ["Active", "Pipeline", "Closed"] },
          { label: "Default project type", type: "select", value: "General", options: ["General", "Construction", "Engineering", "Consulting"] },
          { label: "Default lifecycle phases", type: "tags", value: ["Preconstruction", "Construction", "Closeout"] },
          { label: "Assumed project length (months)", type: "number", value: "6", hint: "Used when a project has no end date." },
        ],
      },
      {
        id: "opp-defaults",
        title: "Opportunity Defaults",
        desc: "Stage sets and probability weighting for the pipeline",
        fields: [
          { label: "Default opportunity stage", type: "select", value: "Pending Assignment", options: ["Pending Assignment", "Proposal Development", "Contract Negotiations"] },
          { label: "Opportunity stage set", type: "tags", value: ["Pending Assignment", "Proposal Development", "Contract Negotiations", "Awarded", "Lost"] },
        ],
      },
      {
        id: "proj-dates",
        title: "Dates & Horizon",
        desc: "Rules for how missing dates and forecast windows are filled",
        fields: [
          { label: "When a start date is missing", type: "select", value: "Start this Monday", options: ["Start this Monday", "Start today", "Start next Monday"] },
          { label: "Default forecast window (days)", type: "number", value: "90", hint: "For opportunities/leads with no close date." },
        ],
      },
    ],
  },
  {
    id: "schedule",
    label: "Schedule",
    icon: "📅",
    color: "#3b82f6",
    sections: [
      {
        id: "sched-display",
        title: "Display Mode",
        desc: "Control what schedule elements are visible across the app",
        fields: [
          { label: "Project display mode", type: "select", value: "Full (phases + weekly hours)", options: ["Full (phases + weekly hours)", "No schedule (weekly hours only)", "No schedule, no hours"] },
        ],
      },
      {
        id: "sched-editing",
        title: "Past Date Editing",
        desc: "Whether users may edit historical hours and how far back",
        fields: [
          { label: "Allow past date editing", type: "toggle", value: true },
          { label: "Past edit limit (weeks)", type: "number", value: "4", hint: "How many weeks back users can modify hours." },
        ],
      },
      {
        id: "sched-week",
        title: "Working Week",
        desc: "Define non-working days and the hours that count as a full week",
        fields: [
          { label: "Non-working days", type: "days", value: ["Sat", "Sun"] },
          { label: "Hours in a full week", type: "number", value: "40", hint: "The denominator for 100% allocation." },
        ],
      },
    ],
  },
  {
    id: "staff",
    label: "Staff & Resources",
    icon: "👥",
    color: "#f59e0b",
    sections: [
      {
        id: "staff-util",
        title: "Utilisation Thresholds",
        desc: "The % bands that colour-code staff as over-, optimal, or under-allocated",
        fields: [
          { label: "Over-capacity flag (%)", type: "number", value: "100", hint: "Red — staff above this are over-allocated." },
          { label: "Optimal band start (%)", type: "number", value: "75", hint: "Green — sweet spot lower bound." },
          { label: "Under-allocated flag (%)", type: "number", value: "50", hint: "Amber — staff below this need more work." },
        ],
      },
      {
        id: "staff-risk",
        title: "Demand & Risk",
        desc: "Thresholds that trigger risk alerts and urgency flags",
        fields: [
          { label: "Concentration risk threshold (%)", type: "number", value: "80", hint: "Alert when one project exceeds this share of a person's time." },
          { label: "Demand urgency window (days)", type: "number", value: "14", hint: "An unfilled role becomes URGENT within this window." },
        ],
      },
    ],
  },
  {
    id: "forecast",
    label: "Forecast",
    icon: "📈",
    color: "#8b5cf6",
    sections: [
      {
        id: "forecast-main",
        title: "Forecast Settings",
        desc: "Lookahead window and pipeline health targets",
        fields: [
          { label: "Forecast window (weeks)", type: "number", value: "12", hint: "How far ahead the forecasting page calculates demand vs. capacity." },
          { label: "Pipeline coverage target (%)", type: "number", value: "150", hint: "Healthy ratio of pipeline value to active portfolio value." },
        ],
      },
    ],
  },
];

function TagField({ value, color }: { value: string[]; color: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: `1px solid ${BORDER}`, borderRadius: 8, background: "#fafafa", minHeight: 40, alignItems: "center" }}>
      {value.map(t => (
        <span key={t} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 10px 2px 10px", borderRadius: 20, background: `${color}15`, border: `1px solid ${color}40`, fontSize: 12, color, fontWeight: 500 }}>
          {t}
          <span style={{ cursor: "pointer", opacity: 0.5, marginLeft: 2, fontSize: 11 }}>×</span>
        </span>
      ))}
      <span style={{ fontSize: 12, color: FAINT, cursor: "pointer" }}>+ Add</span>
    </div>
  );
}

function DaysField({ value }: { value: string[] }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {days.map(d => {
        const off = value.includes(d);
        return (
          <div key={d} style={{
            width: 40, height: 40, borderRadius: 8, border: `1px solid ${off ? "#ef444450" : BORDER}`,
            background: off ? "#fef2f250" : "#fafafa",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 600, color: off ? "#ef4444" : TEXT,
            cursor: "pointer", userSelect: "none" as const,
          }}>{d}</div>
        );
      })}
    </div>
  );
}

function FieldRow({ field, color }: { field: { label: string; type: string; value: string | string[] | boolean; options?: string[]; hint?: string }; color: string }) {
  if (field.type === "select") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{field.label}</label>
      <div style={{ position: "relative" }}>
        <select style={{ width: "100%", padding: "9px 32px 9px 12px", border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, color: TEXT, background: "#fff", appearance: "none", cursor: "pointer" }}>
          {(field.options ?? []).map(o => <option key={o} selected={o === field.value}>{o}</option>)}
        </select>
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: FAINT, pointerEvents: "none", fontSize: 11 }}>▾</span>
      </div>
      {field.hint && <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>{field.hint}</p>}
    </div>
  );

  if (field.type === "number") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{field.label}</label>
      <input type="number" defaultValue={field.value as string} style={{ width: 120, padding: "9px 12px", border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, color: TEXT, background: "#fff" }} />
      {field.hint && <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>{field.hint}</p>}
    </div>
  );

  if (field.type === "toggle") return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 40, height: 22, borderRadius: 11, background: field.value ? G : "#d1d5db", position: "relative", cursor: "pointer", transition: "background 0.2s" }}>
        <div style={{ position: "absolute", width: 18, height: 18, borderRadius: 9, background: "#fff", top: 2, left: field.value ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
      </div>
      <label style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{field.label}</label>
    </div>
  );

  if (field.type === "tags") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{field.label}</label>
      <TagField value={field.value as string[]} color={color} />
    </div>
  );

  if (field.type === "days") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{field.label}</label>
      <DaysField value={field.value as string[]} />
      <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>Click a day to mark it as non-working (shown in red).</p>
    </div>
  );

  return null;
}

function SectionAccordion({ section, color, openId, onToggle }: {
  section: typeof categories[0]["sections"][0];
  color: string;
  openId: string | null;
  onToggle: (id: string) => void;
}) {
  const open = openId === section.id;
  return (
    <div style={{ border: `1px solid ${open ? `${color}40` : BORDER}`, borderRadius: 12, overflow: "hidden", transition: "border-color 0.2s", background: PANEL }}>
      <button
        onClick={() => onToggle(section.id)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", background: open ? `${color}08` : "#fff",
          border: "none", cursor: "pointer", textAlign: "left" as const,
          borderBottom: open ? `1px solid ${color}20` : "none",
          transition: "background 0.2s",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: open ? color : TEXT }}>{section.title}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{section.desc}</div>
        </div>
        <div style={{
          width: 24, height: 24, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
          background: open ? `${color}15` : "#f3f4f6", color: open ? color : MUTED,
          fontSize: 12, flexShrink: 0, transition: "all 0.2s",
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
        }}>▾</div>
      </button>
      {open && (
        <div style={{ padding: "20px 20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {section.fields.map(f => <FieldRow key={f.label} field={f} color={color} />)}
          <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
            <button style={{
              padding: "8px 20px", borderRadius: 8, border: "none", background: color,
              color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsRedesign() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("projects");
  const [openSection, setOpenSection] = useState<string | null>("proj-defaults");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const filtered = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories.map(cat => ({
      ...cat,
      sections: cat.sections.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q) ||
        s.fields.some(f => f.label.toLowerCase().includes(q))
      ),
    })).filter(cat => cat.sections.length > 0);
  }, [search]);

  const handleNavClick = (catId: string) => {
    setActiveCategory(catId);
    setSearch("");
    const el = sectionRefs.current[catId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) setActiveCategory(e.target.id); }),
      { threshold: 0.3 }
    );
    Object.values(sectionRefs.current).forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const handleToggle = (id: string) => setOpenSection(prev => prev === id ? null : id);

  return (
    <div style={{ display: "flex", height: "100vh", background: BG, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", overflow: "hidden" }}>

      {/* Left sidebar */}
      <aside style={{ width: 240, flexShrink: 0, background: PANEL, borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: G, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14 }}>⚙</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>Settings</div>
              <div style={{ fontSize: 11, color: MUTED }}>testrmone</div>
            </div>
          </div>
          {/* Search */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: FAINT }}>🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search settings…"
              style={{
                width: "100%", padding: "8px 10px 8px 32px", border: `1px solid ${BORDER}`,
                borderRadius: 8, fontSize: 12, color: TEXT, background: BG, boxSizing: "border-box" as const,
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "12px 12px" }}>
          {!search.trim() && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: FAINT, textTransform: "uppercase", letterSpacing: 1, padding: "4px 8px 8px" }}>Configuration</div>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => handleNavClick(cat.id)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: activeCategory === cat.id ? `${cat.color}12` : "transparent",
                    marginBottom: 2, textAlign: "left" as const, transition: "background 0.15s",
                  }}
                >
                  <span style={{ fontSize: 16 }}>{cat.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: activeCategory === cat.id ? 600 : 400, color: activeCategory === cat.id ? cat.color : TEXT }}>
                    {cat.label}
                  </span>
                  {activeCategory === cat.id && (
                    <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: 3, background: cat.color, flexShrink: 0 }} />
                  )}
                </button>
              ))}

              <div style={{ marginTop: 16, fontSize: 10, fontWeight: 700, color: FAINT, textTransform: "uppercase", letterSpacing: 1, padding: "4px 8px 8px" }}>Quick Links</div>
              {[
                { label: "Utilisation Thresholds", catId: "staff", sectionId: "staff-util", icon: "⚡" },
                { label: "Working Week", catId: "schedule", sectionId: "sched-week", icon: "🗓" },
                { label: "Lifecycle Phases", catId: "projects", sectionId: "proj-defaults", icon: "🔄" },
              ].map(q => (
                <button key={q.label} onClick={() => { handleNavClick(q.catId); setTimeout(() => setOpenSection(q.sectionId), 300); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: "transparent", textAlign: "left" as const, marginBottom: 2 }}>
                  <span style={{ fontSize: 14 }}>{q.icon}</span>
                  <span style={{ fontSize: 12, color: MUTED }}>{q.label}</span>
                </button>
              ))}
            </>
          )}
          {search.trim() && filtered.length === 0 && (
            <div style={{ padding: "24px 10px", textAlign: "center" as const, color: FAINT, fontSize: 13 }}>No results for "{search}"</div>
          )}
        </nav>

        {/* Footer */}
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${BORDER}` }}>
          <button style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "#fafafa", cursor: "pointer" }}>
            <span style={{ fontSize: 13 }}>↩</span>
            <span style={{ fontSize: 12, color: MUTED }}>Reset to defaults</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflowY: "auto", padding: "32px 40px" }}>
        {/* Top banner */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: 0 }}>Settings</h1>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
            These defaults apply to your company. Anything you don't set keeps following the built-in default.
          </p>
        </div>

        {/* Category sections */}
        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          {filtered.map(cat => (
            <div key={cat.id} id={cat.id} ref={el => { sectionRefs.current[cat.id] = el; }}>
              {/* Category header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${cat.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                  {cat.icon}
                </div>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: 0 }}>{cat.label}</h2>
                  <div style={{ fontSize: 11, color: MUTED }}>{cat.sections.length} section{cat.sections.length !== 1 ? "s" : ""}</div>
                </div>
                <div style={{ flex: 1, height: 1, background: `${cat.color}20`, marginLeft: 8 }} />
              </div>
              {/* Accordions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cat.sections.map(sec => (
                  <SectionAccordion key={sec.id} section={sec} color={cat.color} openId={openSection} onToggle={handleToggle} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom spacer */}
        <div style={{ height: 60 }} />
      </main>
    </div>
  );
}
