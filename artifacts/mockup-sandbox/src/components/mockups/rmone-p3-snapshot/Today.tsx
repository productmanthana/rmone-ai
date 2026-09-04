import {
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Battery,
  Wifi,
  Signal,
  AlertOctagon,
  AlertTriangle,
  Lightbulb,
  Activity,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

export function Today() {
  return (
    <div className="w-[390px] h-[844px] mx-auto bg-[#1B2B38] text-white overflow-hidden flex flex-col relative font-sans">
      {/* iOS Status Bar */}
      <div className="flex justify-between items-center px-6 pt-3 pb-1 z-10 shrink-0 text-[13px] font-medium">
        <span>9:41</span>
        <div className="flex items-center gap-1.5">
          <Signal size={14} strokeWidth={2.5} />
          <Wifi size={14} strokeWidth={2.5} />
          <Battery size={14} strokeWidth={2.5} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 relative">
        {/* Header */}
        <div className="flex justify-between items-end pt-1 pb-2.5">
          <div>
            <div className="text-white/55 text-[11px] font-medium leading-tight">Sunday · April 26</div>
            <h1 className="text-[19px] font-bold tracking-tight leading-tight mt-0.5">Good morning, Admin</h1>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#6BA539]/10 border border-[#6BA539]/30">
            <span className="w-1.5 h-1.5 rounded-full bg-[#6BA539] animate-pulse" />
            <span className="text-[9px] font-bold tracking-wider text-[#A9C23F]">LIVE PULSE</span>
          </div>
        </div>

        {/* PINNED CRITICAL — most-severe, dominant (RED for true critical) */}
        <div className="mb-2.5 rounded-2xl overflow-hidden bg-gradient-to-br from-[#FF4D2E]/22 via-[#FF4D2E]/10 to-transparent border border-[#FF4D2E]/55 relative">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#FF4D2E]" />
          <div className="px-3.5 pt-2.5 pb-3 pl-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Zap size={11} className="text-[#FF4D2E]" strokeWidth={2.6} />
              <span className="text-[8.5px] font-extrabold tracking-[0.18em] text-[#FF4D2E] uppercase">Pinned · Critical</span>
              <span className="text-[8.5px] font-bold tracking-wider text-white/55 ml-1">NEXT 7 DAYS</span>
              <span className="ml-auto text-[8.5px] font-bold text-white/45 tabular-nums">3 SEC AGO</span>
            </div>

            <h2 className="text-[16px] font-extrabold leading-[1.15] text-white mb-1">
              Phoenix office projected at 104% utilization next week.
            </h2>
            <p className="text-[11px] text-white/70 leading-snug tabular-nums mb-2.5">
              Peak week of May 4 · 7 FTE overage · cascade risk on 3 active projects
            </p>

            <div className="flex items-center gap-1.5">
              <button className="flex-1 bg-[#6BA539] text-white text-[11.5px] font-extrabold py-1.5 rounded-md shadow-[0_2px_8px_rgba(107,165,57,0.45)]">
                Resolve now
              </button>
              <button className="px-3 py-1.5 bg-white/8 border border-white/15 text-white text-[11.5px] font-bold rounded-md">
                View
              </button>
            </div>
          </div>
        </div>

        {/* LIVE PULSE stat board — high-contrast */}
        <div className="mb-2.5 rounded-xl bg-[#0F1A22] border border-white/10 overflow-hidden">
          <div className="px-3 pt-2 pb-1.5 flex items-center justify-between border-b border-white/8">
            <div className="flex items-center gap-1.5">
              <Activity size={11} className="text-[#A9C23F]" strokeWidth={2.4} />
              <span className="text-[9px] font-extrabold tracking-[0.18em] text-white/65 uppercase">Overnight scan</span>
            </div>
            <span className="text-[9px] font-bold tracking-wider text-white/45">412 PROJ · 87 STAFF · 23 PURSUITS</span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/8">
            <div className="px-3 py-2.5 bg-[#FF4D2E]/8">
              <div className="flex items-baseline gap-1">
                <div className="text-[24px] font-extrabold text-[#FF4D2E] leading-none tracking-tight tabular-nums">3</div>
                <ArrowUpRight size={11} className="text-[#FF4D2E]" strokeWidth={2.8} />
              </div>
              <div className="text-[8.5px] text-[#FF4D2E] mt-1 leading-tight uppercase tracking-wider font-extrabold">Risks<br/>flagged</div>
              <div className="text-[8.5px] text-white/45 mt-0.5 tabular-nums">+2 vs yest.</div>
            </div>
            <div className="px-3 py-2.5 bg-[#6BA539]/8">
              <div className="flex items-baseline gap-1">
                <div className="text-[24px] font-extrabold text-[#A9C23F] leading-none tracking-tight tabular-nums">2</div>
                <ArrowDownRight size={11} className="text-[#A9C23F]" strokeWidth={2.8} />
              </div>
              <div className="text-[8.5px] text-[#A9C23F] mt-1 leading-tight uppercase tracking-wider font-extrabold">Conflicts<br/>resolved</div>
              <div className="text-[8.5px] text-white/45 mt-0.5 tabular-nums">overnight</div>
            </div>
            <div className="px-3 py-2.5 bg-[#6BA539]/8">
              <div className="flex items-baseline gap-1">
                <div className="text-[20px] font-extrabold text-[#A9C23F] leading-none tracking-tight tabular-nums">+$4.2M</div>
              </div>
              <div className="text-[8.5px] text-[#A9C23F] mt-1 leading-tight uppercase tracking-wider font-extrabold">Forecast<br/>shift</div>
              <div className="text-[8.5px] text-white/45 mt-0.5 tabular-nums">wk-over-wk</div>
            </div>
          </div>
        </div>

        {/* WHAT CHANGED SINCE YESTERDAY — elevated */}
        <div className="mb-2.5">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[9.5px] font-extrabold tracking-[0.18em] text-white/65 uppercase">What changed since yesterday</span>
            <span className="text-[9px] font-bold text-white/45 tracking-wider">5 MOVES</span>
          </div>
          <div className="bg-[#2E4557] rounded-xl border border-white/10 divide-y divide-white/6 overflow-hidden">
            {[
              { icon: TrendingUp, color: "#A9C23F", label: "Utilization", delta: "+4%", note: "Phoenix office >90%", positive: true },
              { icon: TrendingUp, color: "#A9C23F", label: "Forecast backlog", delta: "+$4.2M", note: "1 new opportunity won", positive: true },
              { icon: TrendingDown, color: "#A9C23F", label: "Staffing conflicts", delta: "−2", note: "PMM-167 reassigned · 089 covered", positive: true },
              { icon: TrendingDown, color: "#FF9425", label: "PM avail · Tom R.", delta: "−8h/wk", note: "Phase shift on PMM-112", positive: false },
              { icon: TrendingUp, color: "#A9C23F", label: "Proposal pipeline", delta: "+$2.1M", note: "3 new RFPs entered", positive: true },
            ].map((row, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3 py-1.5">
                <row.icon size={16} style={{ color: row.color }} strokeWidth={2.6} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-white leading-tight truncate">{row.label}</div>
                  <div className="text-[9.5px] text-white/55 leading-tight truncate">{row.note}</div>
                </div>
                <div
                  className="text-[13px] font-extrabold tabular-nums shrink-0"
                  style={{ color: row.color }}
                >
                  {row.delta}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CRITICAL NOTIFICATIONS — high-contrast */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[9.5px] font-extrabold tracking-[0.18em] text-white/65 uppercase">Critical notifications</span>
            <span className="text-[9px] font-extrabold text-white bg-[#E87722] px-2 py-0.5 rounded-full tracking-wider">3 NEW</span>
          </div>

          <div className="space-y-1.5">
            {/* CRITICAL */}
            <button className="w-full flex items-center gap-2.5 p-2 bg-[#FF4D2E]/14 border border-[#FF4D2E]/55 rounded-xl text-left">
              <div className="w-8 h-8 rounded-lg bg-[#FF4D2E] flex items-center justify-center shrink-0">
                <AlertOctagon size={15} className="text-white" strokeWidth={2.6} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[8.5px] font-extrabold tracking-[0.18em] text-[#FF4D2E] uppercase">Critical</span>
                  <span className="text-[8.5px] text-white/45">· 4m ago</span>
                  <span className="ml-auto text-[8.5px] font-bold text-white/55 tracking-wider">7D</span>
                </div>
                <div className="text-[12px] font-bold text-white leading-tight truncate">Proposal staffing conflict · Healthcare RFP</div>
              </div>
              <ChevronRight size={13} className="text-white/40 shrink-0" />
            </button>

            {/* WARNING */}
            <button className="w-full flex items-center gap-2.5 p-2 bg-[#E87722]/12 border border-[#E87722]/45 rounded-xl text-left">
              <div className="w-8 h-8 rounded-lg bg-[#E87722]/25 border border-[#E87722]/55 flex items-center justify-center shrink-0">
                <AlertTriangle size={14} className="text-[#FF9425]" strokeWidth={2.6} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[8.5px] font-extrabold tracking-[0.18em] text-[#FF9425] uppercase">Warning</span>
                  <span className="text-[8.5px] text-white/45">· 22m ago</span>
                  <span className="ml-auto text-[8.5px] font-bold text-white/55 tracking-wider">14D</span>
                </div>
                <div className="text-[12px] font-bold text-white leading-tight truncate">PM utilization breach · Tom R. 91h/wk</div>
              </div>
              <ChevronRight size={13} className="text-white/40 shrink-0" />
            </button>

            {/* INSIGHT */}
            <button className="w-full flex items-center gap-2.5 p-2 bg-[#6BA539]/10 border border-[#6BA539]/45 rounded-xl text-left">
              <div className="w-8 h-8 rounded-lg bg-[#6BA539]/20 border border-[#6BA539]/55 flex items-center justify-center shrink-0">
                <Lightbulb size={14} className="text-[#A9C23F]" strokeWidth={2.6} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[8.5px] font-extrabold tracking-[0.18em] text-[#A9C23F] uppercase">Insight</span>
                  <span className="text-[8.5px] text-white/45">· 1h ago</span>
                  <span className="ml-auto text-[8.5px] font-bold text-white/55 tracking-wider">30D</span>
                </div>
                <div className="text-[12px] font-bold text-white leading-tight truncate">Forecast revenue at risk · +$1.8M exposure</div>
              </div>
              <ChevronRight size={13} className="text-white/40 shrink-0" />
            </button>
          </div>
        </div>

        {/* CTA */}
        <div className="pb-3">
          <button className="w-full bg-[#6BA539] hover:bg-[#5C8E31] text-white font-extrabold py-2.5 rounded-full flex items-center justify-center gap-1.5 transition-colors text-[13px] tracking-wide">
            Open command center
            <ChevronRight size={15} strokeWidth={2.6} />
          </button>
        </div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#1B2B38] to-transparent pointer-events-none" />
    </div>
  );
}
