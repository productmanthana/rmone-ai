import React from "react";
import {
  Home,
  MessageSquare,
  FolderKanban,
  Users,
  Bell,
  ChevronRight,
  Wifi,
  Signal,
  Battery,
  ArrowRightLeft,
  CalendarClock,
  UserPlus,
  Clock,
  DollarSign,
  FileSignature,
  TrendingDown,
  Briefcase,
} from "lucide-react";

export type Role = "COO" | "CFO" | "RM" | "PM" | "Exec";

type SubDriver = { label: string; value: number; tone: "good" | "warn" };
type Risk = { tone: "high" | "med"; title: string; sub: string };
type Action = { Icon: any; kind: string; title: string; cta: string; emphasis?: boolean };

type RoleConfig = {
  fullName: string;
  short: string;
  initials: string;
  greeting: string;
  health: { score: number; label: string; trend: string; subs: SubDriver[] };
  risks: Risk[];
  actions: Action[];
};

export const ROLE_DATA: Record<Role, RoleConfig> = {
  COO: {
    fullName: "Chief Operating Officer",
    short: "COO",
    initials: "AD",
    greeting: "Operational health",
    health: {
      score: 82,
      label: "STABLE",
      trend: "+3 vs last wk",
      subs: [
        { label: "Staffing balance", value: 88, tone: "good" },
        { label: "Utilization stability", value: 76, tone: "warn" },
        { label: "Proposal coverage", value: 71, tone: "warn" },
        { label: "Delivery exposure", value: 89, tone: "good" },
      ],
    },
    risks: [
      { tone: "high", title: "3 projects under-resourced \u00b7 30 days", sub: "PMM-25-000167, OPM-25-000089, +1" },
      { tone: "med", title: "Phoenix utilization projected 104%", sub: "Peak week of May 18" },
      { tone: "med", title: "2 PMs approaching burnout", sub: "Tom R. 91h/wk \u00b7 Ana D. 87h/wk" },
    ],
    actions: [
      { Icon: ArrowRightLeft, kind: "Move resources", title: "Move 4 FTE Boston \u2192 Phoenix", cta: "Apply", emphasis: true },
      { Icon: CalendarClock, kind: "Delay pursuits", title: "Delay 3 non-critical proposals 2 wks", cta: "Defer" },
      { Icon: UserPlus, kind: "Hire role", title: "Open 2 senior PM reqs \u00b7 Healthcare", cta: "Hire" },
      { Icon: Clock, kind: "Shift schedule", title: "Shift Tom R. off OPM-25-000089", cta: "Shift" },
    ],
  },
  CFO: {
    fullName: "Chief Financial Officer",
    short: "CFO",
    initials: "RG",
    greeting: "Financial health",
    health: {
      score: 74,
      label: "WATCH",
      trend: "\u22121.2 vs last wk",
      subs: [
        { label: "Pipeline coverage", value: 84, tone: "good" },
        { label: "Delivery margin", value: 56, tone: "warn" },
        { label: "Margin vs plan", value: 67, tone: "warn" },
        { label: "Cash collection", value: 59, tone: "warn" },
      ],
    },
    risks: [
      { tone: "high", title: "NYCHA Castle Hill margin \u22123.2%", sub: "Delivery \u00b7 approved budget vs run-rate" },
      { tone: "high", title: "AR > 60 days at $4.1M", sub: "Cash flow \u00b7 top 3 clients = 62%" },
      { tone: "med", title: "Houston burn +5% vs plan", sub: "Margin \u00b7 drives Q2 EBITDA risk" },
    ],
    actions: [
      { Icon: FileSignature, kind: "Re-baseline", title: "Re-baseline NYCHA Castle Hill margin", cta: "Open", emphasis: true },
      { Icon: DollarSign, kind: "Collections", title: "Push 4 AR escalations \u00b7 cash flow", cta: "Send" },
      { Icon: TrendingDown, kind: "Approve change", title: "Approve $2.1M change order \u00b7 Phoenix", cta: "Approve" },
      { Icon: CalendarClock, kind: "Defer capex", title: "Defer $480K Q2 capex to Q3", cta: "Defer" },
    ],
  },
  RM: {
    fullName: "Resource Manager",
    short: "Resource Mgr",
    initials: "TM",
    greeting: "Capacity health",
    health: {
      score: 68,
      label: "TIGHT",
      trend: "\u22124 vs last wk",
      subs: [
        { label: "Bench coverage", value: 62, tone: "warn" },
        { label: "Overload roles", value: 35, tone: "warn" },
        { label: "Open requisitions", value: 58, tone: "warn" },
        { label: "Time to fill", value: 81, tone: "good" },
      ],
    },
    risks: [
      { tone: "high", title: "Phoenix overload W19\u2013W21", sub: "PM + Sr. Designer \u00b7 117% load" },
      { tone: "high", title: "3 senior PM gaps \u00b7 Healthcare", sub: "Required by June 1" },
      { tone: "med", title: "Ana D. 87h/wk \u00b7 3rd week", sub: "Burnout risk threshold breached" },
    ],
    actions: [
      { Icon: ArrowRightLeft, kind: "Reassign", title: "Move Tom R. off OPM-25-000089", cta: "Apply", emphasis: true },
      { Icon: UserPlus, kind: "Open req", title: "Open 2 Sr. PM reqs \u2014 Healthcare", cta: "Open" },
      { Icon: Clock, kind: "Pull staff", title: "Pull 1 PM from Boston \u2192 Phoenix", cta: "Shift" },
      { Icon: CalendarClock, kind: "Cap hours", title: "Cap Ana D. at 50h/wk \u2014 next 2 wks", cta: "Cap" },
    ],
  },
  PM: {
    fullName: "Project Manager",
    short: "Project Mgr",
    initials: "JL",
    greeting: "My portfolio",
    health: {
      score: 86,
      label: "ON TRACK",
      trend: "+2 vs last wk",
      subs: [
        { label: "On-track projects", value: 92, tone: "good" },
        { label: "RFIs response time", value: 78, tone: "warn" },
        { label: "Schedule adherence", value: 88, tone: "good" },
        { label: "Approvals due", value: 60, tone: "warn" },
      ],
    },
    risks: [
      { tone: "high", title: "PMM-25-000167 \u2014 RFI overdue 4d", sub: "Sub-grade waterproofing detail" },
      { tone: "med", title: "OPM-25-000089 \u2014 schedule slip 4d", sub: "Steel delivery delayed" },
      { tone: "med", title: "2 approvals due by Friday", sub: "Change orders \u2014 $812K total" },
    ],
    actions: [
      { Icon: FileSignature, kind: "Resolve RFIs", title: "Reply to 7 outstanding RFIs", cta: "Open", emphasis: true },
      { Icon: DollarSign, kind: "Submit", title: "Submit Change Order #14 \u2014 Phoenix", cta: "Send" },
      { Icon: Briefcase, kind: "Confirm", title: "Confirm subcontractor for Castle Hill", cta: "Confirm" },
      { Icon: CalendarClock, kind: "Reschedule", title: "Reschedule steel pour to May 14", cta: "Update" },
    ],
  },
  Exec: {
    fullName: "Executive",
    short: "Executive",
    initials: "EX",
    greeting: "Firm health",
    health: {
      score: 79,
      label: "STEADY",
      trend: "+1 vs last wk",
      subs: [
        { label: "Pipeline coverage", value: 88, tone: "good" },
        { label: "Win rate (TTM)", value: 64, tone: "warn" },
        { label: "Hire velocity", value: 72, tone: "warn" },
        { label: "Client NPS", value: 84, tone: "good" },
      ],
    },
    risks: [
      { tone: "high", title: "Q3 pipeline gap \u2014 $14M short", sub: "Healthcare + Education segments" },
      { tone: "med", title: "Win rate dropped to 31%", sub: "Down from 38% trailing quarter" },
      { tone: "med", title: "2 key leadership hires delayed", sub: "Phoenix MD + East Region Dir." },
    ],
    actions: [
      { Icon: UserPlus, kind: "Approve plan", title: "Approve FY26 hire plan \u2014 18 roles", cta: "Approve", emphasis: true },
      { Icon: Briefcase, kind: "Review", title: "Review Q3 pipeline pursuit list", cta: "Open" },
      { Icon: FileSignature, kind: "Sign", title: "Sign Phoenix office lease renewal", cta: "Sign" },
      { Icon: TrendingDown, kind: "Reset target", title: "Reset Q3 win-rate target to 35%", cta: "Set" },
    ],
  },
};

function HealthGauge({ score, size = 88 }: { score: number; size?: number }) {
  const pad = 6;
  const total = size + pad * 2;
  const sw = 9;
  const r = (size - sw) / 2;
  const cx = total / 2;
  const cy = total / 2;
  const startA = 135;
  const arcDeg = 270;
  const fill = (Math.max(0, Math.min(100, score)) / 100) * arcDeg;
  const color = score >= 80 ? "#6BA539" : score >= 60 ? "#E87722" : "#FF9425";
  const polar = (a: number, R: number) => {
    const rad = (a * Math.PI) / 180;
    return { x: cx + R * Math.cos(rad), y: cy + R * Math.sin(rad) };
  };
  const arc = (s: number, e: number, R: number) => {
    const a = polar(s, R);
    const b = polar(e, R);
    const lg = e - s > 180 ? 1 : 0;
    return `M ${a.x} ${a.y} A ${R} ${R} 0 ${lg} 1 ${b.x} ${b.y}`;
  };
  return (
    <svg width={total} height={total} viewBox={`0 0 ${total} ${total}`} className="shrink-0">
      <path d={arc(startA, startA + arcDeg, r)} stroke="rgba(255,255,255,0.07)" strokeWidth={sw} fill="none" strokeLinecap="round" />
      <path d={arc(startA, startA + fill, r)} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
      <text x={cx} y={cy + 4} fontSize={Math.round(size * 0.34)} fontWeight="800" fill="#FFFFFF" textAnchor="middle" fontFamily="Inter, sans-serif">{score}</text>
      <text x={cx} y={cy + 18} fontSize={9} fontWeight="600" fill="rgba(255,255,255,0.5)" textAnchor="middle" fontFamily="Inter, sans-serif">/ 100</text>
    </svg>
  );
}

export function RoleHome({ role = "COO" }: { role?: Role }) {
  const data = ROLE_DATA[role];

  return (
    <div className="w-[390px] h-[844px] mx-auto bg-[#1B2B38] text-white overflow-hidden flex flex-col relative font-sans">
      {/* iOS Status Bar */}
      <div className="h-9 flex items-center justify-between px-6 pt-2 shrink-0 z-10">
        <span className="text-[13px] font-semibold tracking-tight">9:41</span>
        <div className="flex items-center gap-1.5">
          <Signal size={14} className="text-white" />
          <Wifi size={14} className="text-white" />
          <Battery size={14} className="text-white" />
        </div>
      </div>

      {/* Profile + role badge */}
      <div className="px-4 pt-1 pb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-11 h-11 rounded-full bg-[#6BA539] flex items-center justify-center font-bold text-white text-[13px] shrink-0">
            {data.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-bold leading-tight">Admin</span>
              <span className="text-[9px] font-bold text-[#253746] bg-[#A9C23F] px-1.5 py-0.5 rounded uppercase tracking-wider">{data.short}</span>
            </div>
            <div className="text-[11px] font-medium text-white/65 truncate leading-tight mt-0.5">{data.fullName} · Liro Engineers</div>
          </div>
          <Bell size={18} className="text-white/55 shrink-0" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 pb-1 flex flex-col gap-2.5 min-h-0 overflow-hidden">
        {/* Health Score card */}
        <section className="bg-[#2E4557] rounded-2xl p-3 border border-white/10 shrink-0">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[10px] text-white/55 font-semibold uppercase tracking-wider">{data.greeting}</span>
            <span className="text-[9px] font-bold text-[#6BA539] tracking-wider bg-[#1B2B38] px-2 py-0.5 rounded border border-[#6BA539]/30">
              {data.health.label}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <HealthGauge score={data.health.score} />
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              {data.health.subs.map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="text-[10.5px] text-white/65 flex-1 truncate">{s.label}</span>
                  <div className="w-12 h-1 rounded bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{ width: `${s.value}%`, background: s.tone === "good" ? "#6BA539" : "#E87722" }}
                    />
                  </div>
                  <span className="text-[10.5px] font-bold tabular-nums text-white/90 w-6 text-right">{s.value}</span>
                </div>
              ))}
              <div className="text-[9.5px] text-[#A9C23F] font-semibold mt-0.5">{data.health.trend}</div>
            </div>
          </div>
        </section>

        {/* Risk Feed */}
        <section className="flex flex-col gap-1.5 shrink-0">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] text-white/55 font-semibold uppercase tracking-wider">Operational risk feed</span>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-[#A9C23F] rounded-full animate-pulse" />
              <span className="text-[9px] text-[#A9C23F] font-semibold uppercase">Live</span>
            </div>
          </div>
          {data.risks.map((r, i) => {
            const isHigh = r.tone === "high";
            const dotColor = isHigh ? "bg-[#FF4D2E]" : "bg-[#E87722]";
            const chipBg = isHigh ? "bg-[#FF4D2E]/15 border-[#FF4D2E]/40 text-[#FF4D2E]" : "bg-[#E87722]/15 border-[#E87722]/40 text-[#FF9425]";
            const chipLabel = isHigh ? "CRIT" : "WARN";
            return (
              <button
                key={i}
                className={`bg-[#2E4557] rounded-xl border px-3 py-2.5 flex items-center gap-2.5 text-left ${
                  isHigh ? "border-[#FF4D2E]/30" : "border-white/10"
                }`}
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold leading-tight truncate">{r.title}</div>
                  <div className="text-[10px] text-white/55 leading-tight truncate mt-0.5">{r.sub}</div>
                </div>
                <span className={`text-[8.5px] font-extrabold tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${chipBg}`}>
                  {chipLabel}
                </span>
                <ChevronRight size={13} className="text-white/35 shrink-0" />
              </button>
            );
          })}
        </section>

        {/* Recommended Actions */}
        <section className="flex flex-col gap-1.5 min-h-0 flex-1">
          <div className="flex justify-between items-center px-1 shrink-0">
            <span className="text-[10px] text-white/55 font-semibold uppercase tracking-wider">Recommended actions</span>
            <span className="text-[9.5px] text-[#A9C23F] font-bold tracking-widest">AI · {data.actions.length}</span>
          </div>
          <div className="bg-[#2E4557] rounded-xl border border-white/10 divide-y divide-white/5 overflow-hidden flex-1 flex flex-col">
            {data.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3 flex-1 min-h-[48px]">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${a.emphasis ? "bg-[#E87722]/15" : "bg-[#6BA539]/12"}`}>
                  <a.Icon size={15} className={a.emphasis ? "text-[#FF9425]" : "text-[#A9C23F]"} strokeWidth={2.2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[8.5px] font-bold uppercase tracking-wider text-white/45 leading-none mb-1">{a.kind}</div>
                  <div className="text-[12px] font-semibold leading-tight truncate">{a.title}</div>
                </div>
                <button
                  className={`text-[10.5px] font-bold px-3 py-1.5 rounded-lg shrink-0 ${
                    a.emphasis ? "bg-[#6BA539] text-white" : "bg-[#1B2B38] text-white border border-white/10"
                  }`}
                >
                  {a.cta}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Bottom Nav */}
      <div className="bg-[#1B2B38] shrink-0 border-t border-white/8">
        <div className="flex justify-around items-center py-2">
          {[
            { Icon: Home, label: "Home", active: true },
            { Icon: MessageSquare, label: "AI" },
            { Icon: FolderKanban, label: "Projects" },
            { Icon: Users, label: "People" },
            { Icon: Bell, label: "Alerts", badge: true },
          ].map(({ Icon, label, active, badge }) => (
            <div key={label} className="flex flex-col items-center gap-0.5 px-2 relative">
              <div className="relative">
                <Icon size={20} className={active ? "text-[#6BA539]" : "text-white/55"} strokeWidth={2} />
                {badge && (<div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#E87722] rounded-full" />)}
              </div>
              <span className={`text-[10px] ${active ? "text-[#6BA539] font-semibold" : "text-white/55"}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
