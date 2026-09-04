import React, { useState } from "react";
import {
  Battery,
  Wifi,
  Signal,
  Mic,
  Send,
  ChevronRight,
  Home,
  MessageSquare,
  Briefcase,
  Users,
  Bell,
  Activity,
  FileText,
  ClipboardList,
  FileSpreadsheet,
  Mail,
  TrendingUp,
} from "lucide-react";

const StatusBar = () => (
  <div className="flex justify-between items-center px-6 pt-3 pb-1 text-white text-[13px] font-medium z-50 shrink-0">
    <span>9:41</span>
    <div className="flex items-center gap-1.5">
      <Signal size={14} strokeWidth={2.5} />
      <Wifi size={14} strokeWidth={2.5} />
      <Battery size={14} strokeWidth={2.5} />
    </div>
  </div>
);

const TabBar = () => (
  <div className="flex justify-around items-center py-2 bg-[#0F1A22] border-t border-white/8 shrink-0">
    {[
      { Icon: Home, label: "Home" },
      { Icon: MessageSquare, label: "AI", active: true },
      { Icon: Briefcase, label: "Projects" },
      { Icon: Users, label: "People" },
      { Icon: Bell, label: "Alerts", badge: true },
    ].map(({ Icon, label, active, badge }) => (
      <div key={label} className="flex flex-col items-center gap-0.5 px-2 relative">
        <div className="relative">
          <Icon size={20} strokeWidth={2} className={active ? "text-[#6BA539]" : "text-white/55"} />
          {badge && <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#E87722] rounded-full" />}
        </div>
        <span className={`text-[10px] ${active ? "text-[#6BA539] font-semibold" : "text-white/55"}`}>{label}</span>
      </div>
    ))}
  </div>
);

const ACTIONS = [
  { num: "1", text: "Shift Tom R. off PMM-167 · 8h/wk", verb: "Apply" },
  { num: "2", text: "Defer pursuit · 14D", verb: "Defer" },
  { num: "3", text: "Engage 3 contract PM candidates", verb: "Engage" },
  { num: "4", text: "Open Sr PM req · close 45D", verb: "Open" },
];

const DRAFTS = [
  { Icon: ClipboardList, label: "Requisition", sub: "Sr PM · Healthcare" },
  { Icon: FileSpreadsheet, label: "Staffing plan", sub: "Pursuit · 6-wk ramp" },
  { Icon: FileText, label: "Exec summary", sub: "COO · 1-pager" },
  { Icon: Mail, label: "Client update", sub: "Healthcare PMO" },
  { Icon: TrendingUp, label: "Forecast brief", sub: "45-D outlook" },
];

export function Brief() {
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="w-[390px] h-[844px] mx-auto bg-[#1B2B38] text-white overflow-hidden flex flex-col font-sans relative">
      <StatusBar />

      {/* Header — Decision Support, not "AI assistant" */}
      <div className="flex items-center justify-between px-4 pt-1 pb-2 border-b border-white/5 shrink-0">
        <div className="flex flex-col">
          <span className="text-[9px] font-bold tracking-[0.18em] text-white/45 uppercase">RM ONE</span>
          <h1 className="text-[14px] font-bold leading-tight">Decision Support</h1>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#6BA539]/10 border border-[#6BA539]/30">
          <span className="w-1.5 h-1.5 rounded-full bg-[#6BA539] animate-pulse" />
          <span className="text-[9px] font-bold tracking-wider text-[#6BA539]">LIVE · 12 SIGNALS</span>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto px-3 pt-2.5 pb-2 flex flex-col gap-2.5 min-h-0">
        {/* User Bubble — terse */}
        <div className="flex justify-end">
          <div className="max-w-[78%] bg-[#2E4557] rounded-2xl rounded-tr-sm px-3 py-1.5 border border-white/8">
            <p className="text-[12.5px] leading-snug text-white">Healthcare pursuit — staffing?</p>
          </div>
        </div>

        {/* THE BRIEF — single dense card */}
        <div className="w-full bg-[#2E4557] rounded-xl border border-white/12 shadow-lg overflow-hidden">
          {/* Top status row: SITREP · RISK · HORIZON */}
          <div className="px-3 py-1.5 bg-[#0F1A22]/40 flex items-center justify-between border-b border-white/8">
            <div className="flex items-center gap-1.5">
              <Activity size={11} className="text-[#A9C23F]" strokeWidth={2.4} />
              <span className="text-[9px] font-bold tracking-[0.18em] text-white/55 uppercase">Sitrep</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold tracking-wider text-[#FF4D2E] bg-[#FF4D2E]/15 px-1.5 py-0.5 rounded">HIGH</span>
              <span className="text-[9px] font-bold tracking-wider text-[#FF9425] bg-[#FF9425]/15 px-1.5 py-0.5 rounded">45D</span>
            </div>
          </div>

          {/* Headline — specific prediction with date horizon */}
          <div className="px-3 pt-2 pb-1.5">
            <h2 className="text-[14.5px] font-bold leading-tight text-white">
              Healthcare PM shortage projected in 45 days.
            </h2>
            <p className="text-[10.5px] text-white/55 leading-snug mt-1 tabular-nums">
              2 Sr PM reqs short · pursuit value $4.2M · close-by Jun 10
            </p>
          </div>

          {/* Numbered Actions — verb-first, one-tap */}
          <div className="border-t border-white/8 divide-y divide-white/5">
            <div className="px-3 pt-1.5 pb-1 flex justify-between items-center">
              <span className="text-[9px] font-bold tracking-[0.18em] text-white/45 uppercase">Recommended actions</span>
              <span className="text-[9px] font-bold tracking-wider text-[#A9C23F]">RANKED · 4</span>
            </div>
            {ACTIONS.map((a) => (
              <button
                key={a.num}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
              >
                <div className="w-[18px] h-[18px] rounded-full bg-[#1B2B38] border border-white/15 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-white/85">{a.num}</span>
                </div>
                <span className="flex-1 text-[12px] leading-tight text-white truncate">{a.text}</span>
                <span className="text-[9.5px] font-extrabold tracking-wider text-[#6BA539] bg-[#6BA539]/12 border border-[#6BA539]/30 px-2 py-0.5 rounded shrink-0">
                  {a.verb}
                </span>
              </button>
            ))}
          </div>

          {/* Confidence */}
          <div className="px-3 pt-1.5 pb-2 border-t border-white/8 flex items-center gap-2">
            <span className="text-[9px] font-bold tracking-[0.18em] text-white/45 uppercase shrink-0">Confidence</span>
            <div className="flex-1 h-[3px] bg-white/8 rounded-full overflow-hidden">
              <div className="h-full bg-[#6BA539] rounded-full" style={{ width: "87%" }} />
            </div>
            <span className="text-[11px] font-bold text-white tabular-nums shrink-0">87%</span>
          </div>
        </div>

        {/* DRAFT — expanded one-tap output patterns */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-1">
            <span className="text-[9px] font-bold tracking-[0.18em] text-white/55 uppercase">Draft for me</span>
            <span className="text-[9px] font-bold tracking-wider text-white/35">5 OUTPUTS</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {DRAFTS.map((d) => (
              <button
                key={d.label}
                className="flex items-center gap-2 px-2 py-1.5 bg-[#2E4557] border border-white/10 rounded-lg text-left hover:border-[#A9C23F]/40 active:scale-[0.98] transition-all"
              >
                <div className="w-7 h-7 rounded-md bg-[#1B2B38] border border-white/8 flex items-center justify-center shrink-0">
                  <d.Icon size={13} className="text-[#A9C23F]" strokeWidth={2.3} />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[10.5px] font-bold text-white leading-tight truncate">{d.label}</span>
                  <span className="text-[9px] text-white/45 leading-tight truncate">{d.sub}</span>
                </div>
              </button>
            ))}
            <button className="flex items-center justify-center gap-1.5 px-2 py-1.5 bg-[#1B2B38] border border-dashed border-white/15 rounded-lg text-white/55 hover:text-white hover:border-white/30 transition-colors">
              <span className="text-[10.5px] font-semibold">More</span>
              <ChevronRight size={11} />
            </button>
          </div>
        </div>

        {/* AI Follow-up — ops-brief style, terse */}
        <div className="flex justify-start">
          <div className="max-w-[88%] bg-[#0F1A22] rounded-2xl rounded-tl-sm px-3 py-1.5 border border-[#6BA539]/25 flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-[#6BA539] flex items-center justify-center shrink-0">
              <span className="text-[8.5px] font-extrabold text-white tracking-wider">DS</span>
            </div>
            <p className="text-[12px] leading-snug text-white">
              Draft requisition? <span className="text-[#A9C23F] font-bold">Y</span> · or pick above
            </p>
          </div>
        </div>
      </div>

      {/* Input Bar — command-style placeholder */}
      <div className="px-3 py-2 bg-[#1B2B38] border-t border-white/8 shrink-0">
        <div className="flex items-center gap-1.5 bg-[#0F1A22] border border-white/10 rounded-full px-1.5 py-1">
          <button className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 text-white/55">
            <Mic size={14} />
          </button>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Command or query…"
            className="flex-1 bg-transparent text-[12.5px] text-white placeholder:text-white/35 outline-none px-1"
          />
          <button
            className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
              inputValue.length > 0 ? "bg-[#6BA539] text-white" : "bg-white/5 text-white/35"
            }`}
          >
            <Send size={12} />
          </button>
        </div>
      </div>

      <TabBar />
    </div>
  );
}
