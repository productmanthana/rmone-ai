import {
  Briefcase,
  FileText,
  ShieldCheck,
  TrendingDown,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  Clock,
  Sun,
  CloudRain,
  Cloud,
  Bell,
} from "lucide-react";

const PAPER = "#F5F1EA";
const PAPER_DEEP = "#EDE6D8";
const INK = "#1B2B38";
const INK_SOFT = "#3C4B57";
const INK_MUTED = "#7A7468";
const RULE = "#D8D1BF";
const RULE_SOFT = "#E5DECC";
const GREEN = "#6BA539";

const SERIF = `'Playfair Display', 'Source Serif Pro', Georgia, 'Times New Roman', serif`;
const SANS = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

function Eyebrow({ children, color = INK_MUTED }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: 10,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        fontWeight: 700,
        color,
      }}
    >
      {children}
    </div>
  );
}

function PaperCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: "#FBF8F1",
        border: `1px solid ${RULE}`,
        borderTop: `2px solid ${GREEN}`,
        boxShadow: "0 1px 0 rgba(0,0,0,0.02), 0 8px 24px -16px rgba(60,50,30,0.18)",
        padding: 22,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  delta,
  deltaTone = "neutral",
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
  label: string;
  value: string;
  delta: string;
  deltaTone?: "good" | "bad" | "neutral";
}) {
  const deltaColor =
    deltaTone === "good" ? GREEN : deltaTone === "bad" ? "#B0413E" : INK_MUTED;
  return (
    <div style={{ flex: 1, paddingRight: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon size={14} strokeWidth={1.6} color={INK_SOFT} />
        <Eyebrow>{label}</Eyebrow>
      </div>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 46,
          fontWeight: 600,
          lineHeight: 1,
          color: INK,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: SANS,
          fontSize: 11.5,
          color: deltaColor,
          fontWeight: 500,
          fontStyle: "italic",
        }}
      >
        {delta}
      </div>
    </div>
  );
}

function PriorityRow({
  title,
  project,
  due,
  priority,
}: {
  title: string;
  project: string;
  due: string;
  priority: "high" | "medium";
}) {
  const isHigh = priority === "high";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        paddingBlock: 16,
        borderTop: `1px solid ${RULE_SOFT}`,
      }}
    >
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 22,
          fontWeight: 600,
          color: INK_MUTED,
          minWidth: 28,
          lineHeight: 1.1,
        }}
      >
        §
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span
            style={{
              fontFamily: SANS,
              fontSize: 9.5,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: isHigh ? "#B0413E" : "#8A6B1F",
              border: `1px solid ${isHigh ? "#E0B8B6" : "#E5D6A6"}`,
              background: isHigh ? "#FBECEA" : "#FBF3DB",
              padding: "2px 6px",
            }}
          >
            {priority}
          </span>
          <span style={{ fontFamily: SANS, fontSize: 11, color: INK_MUTED }}>
            {project}
          </span>
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 19,
            fontWeight: 500,
            color: INK,
            lineHeight: 1.25,
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </div>
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 11,
          color: INK_SOFT,
          fontStyle: "italic",
          whiteSpace: "nowrap",
          paddingTop: 4,
        }}
      >
        {due}
      </div>
    </div>
  );
}

function ScheduleRow({ time, title, project }: { time: string; title: string; project: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "70px 1fr",
        gap: 18,
        paddingBlock: 14,
        borderTop: `1px solid ${RULE_SOFT}`,
        alignItems: "baseline",
      }}
    >
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 22,
          fontWeight: 600,
          color: INK,
          letterSpacing: "-0.01em",
        }}
      >
        {time}
      </div>
      <div>
        <div style={{ fontFamily: SERIF, fontSize: 16, color: INK, fontWeight: 500 }}>
          {title}
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 11,
            color: INK_MUTED,
            marginTop: 2,
            letterSpacing: "0.02em",
          }}
        >
          {project}
        </div>
      </div>
    </div>
  );
}

function Forecast({
  day,
  temp,
  icon: Icon,
}: {
  day: string;
  temp: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
}) {
  return (
    <div
      style={{
        flex: 1,
        textAlign: "center",
        paddingInline: 4,
        borderRight: `1px solid ${RULE_SOFT}`,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 9.5,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: INK_MUTED,
          fontWeight: 700,
        }}
      >
        {day}
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <Icon size={18} strokeWidth={1.5} color={INK_SOFT} />
      </div>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 22,
          fontWeight: 600,
          color: INK,
          marginTop: 6,
        }}
      >
        {temp}
      </div>
    </div>
  );
}

export function EditorialPaper() {
  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: PAPER,
        color: INK,
        fontFamily: SANS,
        position: "relative",
        overflowX: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

        .paper-noise::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 0.42  0 0 0 0 0.36  0 0 0 0 0.24  0 0 0 0.10 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
          opacity: 0.55;
          mix-blend-mode: multiply;
          z-index: 0;
        }
        .paper-fibers::after {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          background-image:
            radial-gradient(ellipse at 20% 10%, rgba(180,150,90,0.08), transparent 55%),
            radial-gradient(ellipse at 85% 90%, rgba(140,110,60,0.08), transparent 55%);
          z-index: 0;
        }
        .masthead-rule {
          height: 1px;
          background: ${INK};
          opacity: 0.85;
        }
        .masthead-rule-thin {
          height: 1px;
          background: ${INK};
          opacity: 0.25;
          margin-top: 3px;
        }
        .editorial-fade-in {
          animation: editorialFade 0.7s ease-out both;
        }
        @keyframes editorialFade {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .editorial-fade-in { animation: none; }
        }
      `}</style>

      <div className="paper-noise paper-fibers" style={{ position: "absolute", inset: 0 }} />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1040,
          margin: "0 auto",
          padding: "40px 32px 64px",
        }}
        className="editorial-fade-in"
      >
        {/* Masthead */}
        <header style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  fontFamily: SERIF,
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: INK,
                }}
              >
                RMONE
              </div>
              <div
                style={{
                  width: 1,
                  height: 18,
                  background: RULE,
                }}
              />
              <Eyebrow>Daily Briefing · Vol. XII</Eyebrow>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: 10.5,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: INK_SOFT,
                  border: `1px solid ${RULE}`,
                  padding: "5px 10px",
                  background: "rgba(255,255,255,0.4)",
                }}
              >
                <Briefcase size={11} style={{ display: "inline", marginRight: 6, verticalAlign: "-1px" }} />
                12 active projects
              </span>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: 10.5,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: "#B0413E",
                  border: `1px solid #E0B8B6`,
                  padding: "5px 10px",
                  background: "#FBECEA",
                }}
              >
                <Bell size={11} style={{ display: "inline", marginRight: 6, verticalAlign: "-1px" }} />
                3 alerts
              </span>
            </div>
          </div>

          <div className="masthead-rule" />
          <div className="masthead-rule-thin" />

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginTop: 28,
              gap: 24,
            }}
          >
            <h1
              style={{
                fontFamily: SERIF,
                fontSize: 56,
                lineHeight: 1.02,
                fontWeight: 600,
                letterSpacing: "-0.025em",
                color: INK,
                margin: 0,
              }}
            >
              Good morning, <span style={{ fontStyle: "italic", fontWeight: 500 }}>Marcus</span>.
            </h1>
            <div style={{ textAlign: "right", paddingBottom: 6 }}>
              <Eyebrow>The Morning Edition</Eyebrow>
              <div
                style={{
                  fontFamily: SERIF,
                  fontSize: 14,
                  fontStyle: "italic",
                  color: INK_SOFT,
                  marginTop: 6,
                }}
              >
                Monday, May 11, 2026
              </div>
            </div>
          </div>

          <div style={{ marginTop: 22, height: 1, background: RULE }} />
        </header>

        {/* Snapshot */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
            <Eyebrow color={INK}>Today's Snapshot</Eyebrow>
            <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: INK_MUTED }}>
              By the numbers
            </span>
          </div>
          <PaperCard>
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <Stat icon={Briefcase} label="Active Projects" value="12" delta="+2 vs last week" deltaTone="good" />
              <div style={{ width: 1, background: RULE_SOFT, marginInline: 8 }} />
              <Stat icon={FileText} label="Open RFIs" value="7" delta="−3 today" deltaTone="good" />
              <div style={{ width: 1, background: RULE_SOFT, marginInline: 8 }} />
              <Stat icon={ShieldCheck} label="Safety Incidents" value="0" delta="14 days clean" deltaTone="good" />
              <div style={{ width: 1, background: RULE_SOFT, marginInline: 8 }} />
              <Stat icon={TrendingDown} label="Budget Variance" value="−2.4%" delta="favorable" deltaTone="good" />
            </div>
          </PaperCard>
        </section>

        {/* Two column */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.15fr 1fr",
            gap: 24,
            marginBottom: 28,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
              <Eyebrow color={INK}>Priority Items</Eyebrow>
              <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: INK_MUTED }}>
                Three to handle first
              </span>
            </div>
            <PaperCard style={{ paddingBlock: 6 }}>
              <PriorityRow
                title="Tower B — concrete pour delayed"
                project="Riverside Towers"
                due="Due today"
                priority="high"
              />
              <PriorityRow
                title="RFI #248 awaiting response"
                project="Atrium West"
                due="Due tomorrow"
                priority="medium"
              />
              <PriorityRow
                title="Safety walk overdue — Site C"
                project="Lakeside Logistics"
                due="2 days overdue"
                priority="medium"
              />
            </PaperCard>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
              <Eyebrow color={INK}>Today's Schedule</Eyebrow>
              <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: INK_MUTED }}>
                <Clock size={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
                Pacific
              </span>
            </div>
            <PaperCard style={{ paddingBlock: 6 }}>
              <ScheduleRow time="09:00" title="OAC meeting" project="Riverside Towers" />
              <ScheduleRow time="11:30" title="Concrete sub walkthrough" project="Atrium West" />
              <ScheduleRow time="14:00" title="Owner update call" project="Lakeside Logistics" />
              <ScheduleRow time="16:30" title="Weekly safety review" project="All sites" />
            </PaperCard>
          </div>
        </section>

        {/* Forecast */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
            <Eyebrow color={INK}>7-Day Forecast</Eyebrow>
            <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: INK_MUTED }}>
              Field conditions
            </span>
          </div>
          <PaperCard style={{ padding: "18px 8px" }}>
            <div style={{ display: "flex" }}>
              <Forecast day="Mon" temp="68°" icon={Sun} />
              <Forecast day="Tue" temp="71°" icon={Sun} />
              <Forecast day="Wed" temp="65°" icon={CloudRain} />
              <Forecast day="Thu" temp="60°" icon={CloudRain} />
              <Forecast day="Fri" temp="72°" icon={Cloud} />
              <Forecast day="Sat" temp="78°" icon={Sun} />
              <div style={{ flex: 1, textAlign: "center", paddingInline: 4 }}>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 9.5,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: INK_MUTED,
                    fontWeight: 700,
                  }}
                >
                  Sun
                </div>
                <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
                  <Sun size={18} strokeWidth={1.5} color={INK_SOFT} />
                </div>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontSize: 22,
                    fontWeight: 600,
                    color: INK,
                    marginTop: 6,
                  }}
                >
                  80°
                </div>
              </div>
            </div>
          </PaperCard>
        </section>

        {/* Colophon */}
        <footer
          style={{
            borderTop: `1px solid ${RULE}`,
            paddingTop: 14,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: INK_MUTED }}>
            "Build with intention." — RMONE Editorial
          </span>
          <Eyebrow>Issue №132 · Pacific Edition</Eyebrow>
        </footer>
      </div>
    </div>
  );
}

export default EditorialPaper;
