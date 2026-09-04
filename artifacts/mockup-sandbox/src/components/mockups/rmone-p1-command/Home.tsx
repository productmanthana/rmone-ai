import React from "react";
import {
  Bell,
  Home as HomeIcon,
  Bot,
  Briefcase,
  Users,
  AlertTriangle,
  Battery,
  Wifi,
  Signal,
  ChevronRight,
  ArrowRightLeft,
  UserPlus,
  CalendarClock,
  Clock,
  Zap,
  Activity,
} from "lucide-react";

type Risk = {
  severity: "critical" | "high" | "med";
  horizon: string;
  title: string;
  meta: string;
};

const RISKS: Risk[] = [
  {
    severity: "high",
    horizon: "30D",
    title: "3 projects projected under-resourced",
    meta: "PMM-167, OPM-089, +1 · gap 14 FTE-wks",
  },
  {
    severity: "med",
    horizon: "45D",
    title: "Likely Senior PM shortage · Healthcare",
    meta: "Forecasted 2 reqs short · pipeline +$4.2M",
  },
  {
    severity: "med",
    horizon: "30D",
    title: "Burnout risk: Tom R., Ana D.",
    meta: "91h / 87h forecast wk-of May 11",
  },
];

type Action = {
  Icon: typeof ArrowRightLeft;
  kind: string;
  title: string;
  cta: string;
  emphasis?: boolean;
};

const ACTIONS: Action[] = [
  {
    Icon: ArrowRightLeft,
    kind: "Rebalance",
    title: "Move 4 FTE Boston → Phoenix",
    cta: "Apply",
    emphasis: true,
  },
  {
    Icon: UserPlus,
    kind: "Open req",
    title: "Open 2 Sr PM reqs · Healthcare · 45D",
    cta: "Hire",
  },
  {
    Icon: CalendarClock,
    kind: "Defer",
    title: "Defer 3 non-critical pursuits 2 wks",
    cta: "Defer",
  },
  {
    Icon: Clock,
    kind: "Re-schedule",
    title: "Shift Tom R. off OPM-089 · 8h/wk",
    cta: "Shift",
  },
];

const SUBS = [
  { label: "Staffing balance", value: 88, color: "#6BA539" },
  { label: "Utilization stability", value: 76, color: "#E87722" },
  { label: "Proposal coverage", value: 71, color: "#E87722" },
  { label: "Delivery exposure", value: 89, color: "#6BA539" },
];

function dotColor(s: Risk["severity"]) {
  if (s === "critical") return "#FF4D2E";
  if (s === "high") return "#E87722";
  return "#FF9425";
}

function borderColor(s: Risk["severity"]) {
  if (s === "critical") return "rgba(255,77,46,0.65)";
  if (s === "high") return "rgba(232,119,34,0.55)";
  return "rgba(255,148,37,0.40)";
}

export function Home() {
  return (
    <div className="w-[390px] h-[844px] mx-auto bg-[#1B2B38] text-white overflow-hidden flex flex-col font-sans relative">
      {/* iOS Status Bar */}
      <div className="flex justify-between items-center px-6 pt-3 pb-1 text-[13px] font-medium z-10 shrink-0">
        <span>9:41</span>
        <div className="flex items-center gap-1.5">
          <Signal size={14} className="text-white" />
          <Wifi size={14} className="text-white" />
          <Battery size={14} className="text-white" />
        </div>
      </div>

      {/* Header */}
      <div className="px-5 pt-1.5 pb-2 flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex flex-col">
            <span className="text-white/55 text-[11px] font-medium leading-tight">Good morning,</span>
            <span className="text-[18px] font-bold leading-tight mt-0.5">Admin</span>
          </div>
          <span className="bg-[#6BA539] text-white text-[9px] font-bold px-1.5 py-0.5 rounded mt-3">COO</span>
        </div>
        <div className="relative w-9 h-9 rounded-full bg-[#2E4557] flex items-center justify-center border border-white/10">
          <Bell size={16} className="text-white/55" />
          <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#E87722] rounded-full border border-[#2E4557]"></div>
        </div>
      </div>

      {/* Forecast frame strip */}
      <div className="mx-4 mb-2 px-3 py-1.5 rounded-md bg-[#0F1A22] border border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={11} className="text-[#A9C23F]" strokeWidth={2.4} />
          <span className="text-[10px] tracking-[0.18em] text-white/65 font-bold uppercase">Forecast window · Next 30 days</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#6BA539] animate-pulse"></span>
          <span className="text-[9px] text-[#6BA539] font-bold tracking-wider">LIVE</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 pb-2 flex flex-col gap-2.5 min-h-0">
        {/* OPERATIONAL HEALTH — primary indicator */}
        <section className="bg-gradient-to-br from-[#2E4557] to-[#243744] rounded-2xl p-3.5 border border-white/12 shrink-0 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-40 h-40 bg-[#A9C23F] opacity-[0.07] rounded-full blur-3xl pointer-events-none"></div>

          <div className="flex justify-between items-center mb-2.5 relative z-10">
            <span className="text-[10px] text-white/55 font-bold uppercase tracking-[0.16em]">Operational health</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-extrabold text-[#6BA539] tracking-[0.14em] bg-[#6BA539]/10 px-2 py-0.5 rounded border border-[#6BA539]/40">STABLE · 30D</span>
            </div>
          </div>

          <div className="flex items-center gap-3.5 relative z-10">
            <div className="w-[104px] h-[104px] relative shrink-0">
              <svg width="104" height="104" viewBox="0 0 100 100" className="absolute inset-0">
                <defs>
                  <linearGradient id="gaugeGradP1" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#A9C23F" />
                    <stop offset="60%" stopColor="#6BA539" />
                    <stop offset="100%" stopColor="#E87722" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
                <circle
                  cx="50" cy="50" r="42" fill="none"
                  stroke="url(#gaugeGradP1)" strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 42 * 0.82} ${2 * Math.PI * 42}`}
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[34px] font-extrabold leading-none tracking-tight">82</span>
                <span className="text-[9px] text-white/55 font-medium leading-none mt-0.5">/ 100 · forecast</span>
              </div>
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              {SUBS.map((s) => (
                <div key={s.label} className="flex flex-col gap-[3px]">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-white/75 truncate leading-none">{s.label}</span>
                    <span className="text-[10.5px] font-bold tabular-nums leading-none" style={{ color: s.color }}>{s.value}</span>
                  </div>
                  <div className="h-[3px] rounded-full bg-white/8 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${s.value}%`, backgroundColor: s.color }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PINNED CRITICAL — most-severe issue, dominant (RED for true critical) */}
        <section className="shrink-0">
          <div className="relative rounded-xl overflow-hidden border border-[#FF4D2E]/55 bg-gradient-to-r from-[#FF4D2E]/20 via-[#FF4D2E]/12 to-transparent">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#FF4D2E]"></div>
            <div className="px-3 py-2.5 pl-3.5 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[#FF4D2E]/25 flex items-center justify-center shrink-0">
                <Zap size={17} className="text-[#FF4D2E]" strokeWidth={2.4} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[8.5px] font-extrabold tracking-[0.16em] text-[#FF4D2E]">PINNED · CRITICAL</span>
                  <span className="text-[8.5px] font-bold tracking-wider text-white/45">7-DAY HORIZON</span>
                </div>
                <div className="text-[12.5px] font-bold leading-tight">Phoenix office projected at 104% utilization</div>
                <div className="text-[10px] text-white/65 leading-tight mt-0.5">Peak week of May 18 · 7 FTE overage forecast</div>
              </div>
              <button className="bg-[#6BA539] text-white text-[10.5px] font-extrabold px-3 py-1.5 rounded-md shrink-0 shadow-[0_2px_8px_rgba(107,165,57,0.45)]">
                Resolve
              </button>
            </div>
          </div>
        </section>

        {/* OPERATIONAL RISK FEED */}
        <section className="flex flex-col gap-1.5 shrink-0">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] text-white/55 font-bold uppercase tracking-[0.16em]">Operational risk feed</span>
            <span className="text-[9.5px] text-white/45 font-semibold tracking-wider">{RISKS.length} forecast</span>
          </div>

          <div className="flex flex-col gap-1.5">
            {RISKS.map((r, i) => (
              <div
                key={i}
                className="bg-[#2E4557] rounded-lg pl-2.5 pr-2.5 py-2 border-l-2 border border-white/6 flex items-center gap-2"
                style={{ borderLeftColor: borderColor(r.severity) }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor(r.severity) }}></span>
                <div className="flex-1 min-w-0 flex flex-col gap-0">
                  <div className="text-[11.5px] font-semibold leading-tight truncate">{r.title}</div>
                  <div className="text-[9.5px] text-white/55 truncate leading-tight mt-0.5">{r.meta}</div>
                </div>
                <span
                  className="text-[8.5px] font-extrabold tracking-wider px-1.5 py-0.5 rounded shrink-0"
                  style={{ color: dotColor(r.severity), backgroundColor: `${dotColor(r.severity)}1A` }}
                >
                  {r.horizon}
                </span>
                <ChevronRight size={12} className="text-white/35 shrink-0" />
              </div>
            ))}
          </div>
        </section>

        {/* RECOMMENDED ACTIONS — decision support */}
        <section className="flex flex-col gap-1.5 min-h-0 flex-1">
          <div className="flex justify-between items-center px-1 shrink-0">
            <span className="text-[10px] text-white/55 font-bold uppercase tracking-[0.16em]">Recommended actions</span>
            <span className="text-[9.5px] text-[#A9C23F] font-bold tracking-wider">DECISION SUPPORT · {ACTIONS.length}</span>
          </div>

          <div className="bg-[#2E4557] rounded-xl border border-white/10 divide-y divide-white/5 overflow-hidden flex-1 flex flex-col">
            {ACTIONS.map((a, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3 flex-1 min-h-[44px]">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    a.emphasis ? "bg-[#E87722]/15" : "bg-[#6BA539]/12"
                  }`}
                >
                  <a.Icon size={14} className={a.emphasis ? "text-[#FF9425]" : "text-[#A9C23F]"} strokeWidth={2.2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[8.5px] font-bold uppercase tracking-wider text-white/45 leading-none mb-0.5">{a.kind}</div>
                  <div className="text-[11.5px] font-semibold leading-tight truncate">{a.title}</div>
                </div>
                <button
                  className={`text-[10px] font-extrabold px-2.5 py-1 rounded-md shrink-0 ${
                    a.emphasis
                      ? "bg-[#6BA539] text-white"
                      : "bg-[#1B2B38] text-white border border-white/10"
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
      <div className="border-t border-white/8 bg-[#0F1A22] flex justify-around items-center py-2 shrink-0">
        {[
          { Icon: HomeIcon, label: "Home", active: true },
          { Icon: Bot, label: "AI" },
          { Icon: Briefcase, label: "Projects" },
          { Icon: Users, label: "People" },
          { Icon: AlertTriangle, label: "Alerts", badge: true },
        ].map(({ Icon, label, active, badge }) => (
          <div key={label} className="flex flex-col items-center gap-0.5 px-2 relative">
            <div className="relative">
              <Icon size={20} className={active ? "text-[#6BA539]" : "text-white/55"} strokeWidth={2} />
              {badge && (<div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#E87722] rounded-full"></div>)}
            </div>
            <span className={`text-[10px] ${active ? "text-[#6BA539] font-semibold" : "text-white/55"}`}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
