import React, { useState } from "react";
import {
  Wifi,
  Battery,
  Signal,
  Home,
  MessageSquare,
  Briefcase,
  Users,
  Bell,
  Zap,
  Activity,
  ChevronRight,
} from "lucide-react";

type HeatmapView = "Office" | "Role" | "Discipline";

export function Heatmap() {
  const [activeTab] = useState("home");
  const [scenario, setScenario] = useState<"base" | "win">("base");
  const [view, setView] = useState<HeatmapView>("Office");

  const weeks = ["W18", "W19", "W20", "W21", "W22", "W23", "W24", "W25"];

  // Reduced to 5 rows for less density
  const heatmapData: Record<HeatmapView, { rows: string[]; getVal: (row: string, w: number) => number }> = {
    Office: {
      rows: ["NY Metro", "Phoenix", "Houston", "Atlanta", "Boston"],
      getVal: (row, w) => {
        if (row === "Phoenix") return [82, 108, 115, 96, 88, 82, 80, 78][w];
        if (row === "NY Metro") return 75 + w * 2;
        if (row === "Houston") return 60 + w * 3;
        if (row === "Atlanta") return 80 - w;
        return 92 - w * 2;
      },
    },
    Role: {
      rows: ["Senior PM", "PM", "Estimator", "Designer", "Engineer"],
      getVal: (row, w) => {
        if (row === "Senior PM") return [98, 112, 118, 110, 102, 95, 92, 90][w];
        if (row === "PM") return [90, 95, 102, 98, 92, 88, 85, 82][w];
        if (row === "Estimator") return [85, 92, 96, 88, 82, 78, 75, 72][w];
        if (row === "Designer") return 70 + w;
        return 78 + w * 1.5;
      },
    },
    Discipline: {
      rows: ["Healthcare", "Civil/Infra", "Commercial", "Education", "Industrial"],
      getVal: (row, w) => {
        if (row === "Healthcare") return [95, 110, 116, 108, 100, 92, 88, 85][w];
        if (row === "Civil/Infra") return 80 + w;
        if (row === "Commercial") return 75 + w * 1.5;
        if (row === "Education") return 68 + w;
        return 60 + w * 2;
      },
    },
  };

  // Stronger contrast — overload becomes RED and unmistakable
  const getCellStyle = (val: number) => {
    if (val < 70) return { bg: "bg-[#A9C23F]/20", text: "text-transparent" };
    if (val < 85) return { bg: "bg-[#6BA539]/85", text: "text-transparent" };
    if (val < 95) return { bg: "bg-[#E87722]/45", text: "text-transparent" };
    if (val <= 100) return { bg: "bg-[#E87722]/85", text: "text-white font-bold" };
    return { bg: "bg-[#FF4D2E]", text: "text-white font-extrabold" };
  };

  // Find the peak overload week in current view
  const peakInfo = (() => {
    let best = { row: "", week: 0, val: 0 };
    heatmapData[view].rows.forEach((r) => {
      weeks.forEach((_, w) => {
        const v = heatmapData[view].getVal(r, w);
        if (v > best.val) best = { row: r, week: w, val: v };
      });
    });
    return best;
  })();

  // Demand vs Capacity (simplified)
  const capacityY = 50;
  const baseDemand = [[0, 80], [42.8, 70], [85.7, 55], [128.5, 42], [171.4, 35], [214.2, 32], [257.1, 30], [300, 28]];
  const winDemand = [[0, 80], [42.8, 70], [85.7, 55], [128.5, 38], [171.4, 22], [214.2, 12], [257.1, 6], [300, 2]];
  const toPath = (pts: number[][]) => `M ${pts.map((p) => `${p[0]},${p[1]}`).join(" L ")}`;
  const baseDemandPath = toPath(baseDemand);
  const winDemandPath = toPath(winDemand);

  // Crossover (hiring trigger) approximate — week where demand line crosses capacity
  const crossoverX = 128.5; // around W22 / June
  const crossoverWeek = "W22";
  const crossoverMonth = "Jun";

  // Resource Collision — simplified: only show overlap density per week
  const collisions = [
    { project: "PMM-167", weeks: [0, 1, 2, 3], color: "bg-[#6BA539]/85" },
    { project: "PMM-089", weeks: [2, 3, 4, 5], color: "bg-[#A9C23F]/85" },
    { project: "Healthcare", weeks: [3, 4, 5, 6, 7], color: "bg-[#E87722]/85" },
  ];
  const failureWeek = 3; // W21
  const failurePct = 150;

  const tabPills: HeatmapView[] = ["Office", "Role", "Discipline"];

  return (
    <div className="w-[390px] h-[844px] mx-auto bg-[#1B2B38] text-white overflow-hidden flex flex-col relative font-sans">
      {/* Status Bar */}
      <div className="flex justify-between items-center px-6 pt-3 pb-1 text-[13px] font-medium shrink-0">
        <span>9:41</span>
        <div className="flex items-center gap-1.5">
          <Signal size={14} strokeWidth={2.5} />
          <Wifi size={14} strokeWidth={2.5} />
          <Battery size={14} strokeWidth={2.5} />
        </div>
      </div>

      {/* Header */}
      <div className="px-4 pt-1 pb-1.5 shrink-0 flex items-end justify-between">
        <div>
          <div className="text-[9px] font-bold tracking-[0.18em] text-white/45 uppercase">RM ONE · Forecast</div>
          <h1 className="text-[19px] font-bold leading-tight mt-0.5">Visual Forecasting</h1>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#6BA539]/10 border border-[#6BA539]/30">
          <span className="w-1.5 h-1.5 rounded-full bg-[#6BA539] animate-pulse" />
          <span className="text-[9px] font-bold tracking-wider text-[#A9C23F]">8-WK FORECAST</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pb-1 shrink-0">
        <div className="flex border-b border-white/10">
          {tabPills.map((tab) => (
            <button
              key={tab}
              onClick={() => setView(tab)}
              className={`pb-1.5 px-3 text-[11.5px] font-semibold relative transition-colors ${
                view === tab ? "text-white" : "text-white/55"
              }`}
            >
              {tab}
              {view === tab && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#6BA539]" />}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 space-y-2.5">
        {/* A · PEAK OVERLOAD WEEK */}
        <section>
          <div className="flex items-center justify-between mb-1.5 px-1">
            <div className="flex flex-col">
              <span className="text-[8.5px] font-extrabold tracking-[0.18em] text-white/45 uppercase">Headline</span>
              <span className="text-[12.5px] font-extrabold text-white leading-tight">
                Peak overload week · <span className="text-[#FF4D2E]">{weeks[peakInfo.week]}</span>
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[8.5px] font-bold text-white/45 tracking-wider">{peakInfo.row.toUpperCase()}</span>
              <span className="text-[14px] font-extrabold text-[#FF4D2E] leading-none tabular-nums">{peakInfo.val}%</span>
            </div>
          </div>

          <div className="bg-[#2E4557] rounded-xl px-2.5 py-2 border border-white/10">
            {/* Week header */}
            <div className="flex ml-[64px] mb-1">
              {weeks.map((w, i) => (
                <div
                  key={w}
                  className={`flex-1 text-[8.5px] text-center font-bold tracking-wider ${
                    i === peakInfo.week ? "text-[#FF4D2E]" : "text-white/55"
                  }`}
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="space-y-[3px]">
              {heatmapData[view].rows.map((row) => (
                <div key={row} className="flex items-center h-[19px]">
                  <div className="w-[64px] text-[10px] font-semibold text-white/80 truncate pr-2">{row}</div>
                  <div className="flex-1 flex gap-[2px]">
                    {weeks.map((w, idx) => {
                      const val = heatmapData[view].getVal(row, idx);
                      const style = getCellStyle(val);
                      return (
                        <div
                          key={w}
                          className={`flex-1 h-[19px] rounded-[3px] flex items-center justify-center ${style.bg}`}
                          style={
                            row === peakInfo.row && idx === peakInfo.week
                              ? { boxShadow: "0 0 0 1.5px #FF4D2E" }
                              : undefined
                          }
                        >
                          {val > 100 && (
                            <span className={`text-[8px] tabular-nums leading-none ${style.text}`}>{val}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {/* Compact legend */}
            <div className="mt-2 pt-1.5 border-t border-white/8 flex items-center justify-between text-[8px] text-white/45">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-[#6BA539]/85" /><span>OK</span></div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-[#E87722]/85" /><span>Warn</span></div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-[#FF4D2E]" /><span>Overload</span></div>
              </div>
              <span className="text-[8.5px] font-bold text-white/55 tracking-wider">8 WKS</span>
            </div>
          </div>
        </section>

        {/* B · HIRING TRIGGER MONTH */}
        <section>
          <div className="flex items-center justify-between mb-1.5 px-1">
            <div className="flex flex-col">
              <span className="text-[8.5px] font-extrabold tracking-[0.18em] text-white/45 uppercase">Headline</span>
              <span className="text-[12.5px] font-extrabold text-white leading-tight">
                Hiring trigger month · <span className="text-[#E87722]">{crossoverMonth}</span>
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[8.5px] font-bold text-white/45 tracking-wider">DEMAND CROSSES CAP</span>
              <span className="text-[12px] font-extrabold text-[#E87722] tabular-nums">{crossoverWeek} · 2 Sr PM</span>
            </div>
          </div>

          <div className="bg-[#2E4557] rounded-xl px-2.5 py-2 border border-white/10 h-[120px] flex flex-col">
            <div className="flex-1 relative flex">
              <div className="w-7 flex flex-col justify-between text-[8px] text-white/40 pb-3 pr-1">
                <span>+</span><span>·</span><span>−</span>
              </div>
              <div className="flex-1 relative border-l border-b border-white/10 mb-3">
                <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 300 100">
                  {/* Overload area = above capacity, below demand BEFORE crossover */}
                  <path
                    d={`M 0,${capacityY} L ${crossoverX},${capacityY} L ${crossoverX},42 L 85.7,55 L 42.8,70 L 0,80 Z`}
                    fill="#FF4D2E" fillOpacity="0.18"
                  />
                  {/* Capacity baseline */}
                  <path d={`M 0,${capacityY} L 300,${capacityY}`} stroke="#6BA539" strokeWidth="1.8" strokeDasharray="4 4" fill="none" />
                  {/* Base demand */}
                  <path d={baseDemandPath} stroke="#FF4D2E" strokeWidth="2.2" fill="none" />
                  {/* Win-scenario demand */}
                  {scenario === "win" && (
                    <path d={winDemandPath} stroke="#FF9425" strokeWidth="2" strokeDasharray="3 2" fill="none" opacity="0.95" />
                  )}
                  {/* Crossover marker */}
                  <line x1={crossoverX} y1="0" x2={crossoverX} y2="92" stroke="#E87722" strokeWidth="1" strokeDasharray="2 2" opacity="0.65" />
                  <circle cx={crossoverX} cy={capacityY} r="3.5" fill="#E87722" stroke="#1B2B38" strokeWidth="1.5" />
                </svg>
                {/* Trigger label */}
                <div
                  className="absolute text-[8px] font-extrabold text-[#E87722] tracking-wider"
                  style={{ left: `${(crossoverX / 300) * 100}%`, top: "2px", transform: "translateX(-50%)" }}
                >
                  HIRE
                </div>
              </div>
            </div>
            <div className="flex ml-7 justify-between text-[8px] text-white/45 tabular-nums">
              {weeks.map((w, i) => <span key={w}>{i % 2 === 0 ? w : ""}</span>)}
            </div>
            {/* Tiny inline legend */}
            <div className="ml-7 flex items-center gap-3 text-[8px] text-white/55 mt-1">
              <span className="flex items-center gap-1"><div className="w-2 h-[2px] bg-[#FF4D2E]" /> Demand</span>
              <span className="flex items-center gap-1"><div className="w-2 border-t border-dashed border-[#6BA539]" /> Capacity</span>
              {scenario === "win" && <span className="flex items-center gap-1"><div className="w-2 h-[2px] bg-[#FF9425]" /> Win NYCHA</span>}
            </div>
          </div>
        </section>

        {/* C · RESOURCE FAILURE POINT */}
        <section>
          <div className="flex items-center justify-between mb-1.5 px-1">
            <div className="flex flex-col">
              <span className="text-[8.5px] font-extrabold tracking-[0.18em] text-white/45 uppercase">Headline</span>
              <span className="text-[12.5px] font-extrabold text-white leading-tight">
                Resource failure point · <span className="text-[#FF4D2E]">{weeks[failureWeek]}</span>
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[8.5px] font-bold text-white/45 tracking-wider">TOM R. · 3 PROJECTS</span>
              <span className="text-[14px] font-extrabold text-[#FF4D2E] leading-none tabular-nums">{failurePct}%</span>
            </div>
          </div>

          <div className="bg-[#2E4557] rounded-xl px-2.5 py-2 border border-white/10">
            <div className="flex ml-[72px] mb-1">
              {weeks.map((w, i) => (
                <div
                  key={w}
                  className={`flex-1 text-[8.5px] text-center font-bold tracking-wider ${
                    i === failureWeek ? "text-[#FF4D2E]" : "text-white/55"
                  }`}
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {collisions.map((c, idx) => (
                <div key={idx} className="flex items-center h-[15px]">
                  <div className="w-[72px] text-[10px] font-semibold text-white/85 truncate pr-2">{c.project}</div>
                  <div className="flex-1 flex gap-[2px]">
                    {weeks.map((_, wi) => (
                      <div
                        key={wi}
                        className={`flex-1 h-[12px] rounded-[2px] ${c.weeks.includes(wi) ? c.color : "bg-white/[0.04]"}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Failure-point density bar */}
            <div className="mt-2 pt-2 border-t border-white/8">
              <div className="flex items-center gap-2">
                <span className="w-[72px] text-[8.5px] text-white/55 uppercase tracking-wider font-bold pr-2">Overlap</span>
                <div className="flex-1 flex gap-[2px]">
                  {weeks.map((_, wi) => {
                    const total = collisions.reduce((s, c) => s + (c.weeks.includes(wi) ? 1 : 0), 0);
                    const cls =
                      total >= 3 ? "bg-[#FF4D2E]" : total === 2 ? "bg-[#E87722]/75" : total === 1 ? "bg-[#6BA539]/55" : "bg-white/[0.04]";
                    return <div key={wi} className={`flex-1 h-[5px] rounded-full ${cls}`} />;
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* D · SCENARIO — elevated, "What if?" framing */}
        <section className="pb-1">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <div className="flex flex-col">
              <span className="text-[8.5px] font-extrabold tracking-[0.18em] text-[#A9C23F] uppercase flex items-center gap-1">
                <Zap size={10} className="text-[#A9C23F]" strokeWidth={2.6} /> Scenario
              </span>
              <span className="text-[12.5px] font-extrabold text-white leading-tight">What if we win NYCHA?</span>
            </div>
            <span className="text-[10px] font-bold text-[#A9C23F] tracking-wider">+$8.2M</span>
          </div>

          <div className="bg-[#2E4557] rounded-xl px-2.5 py-2 border border-[#6BA539]/30">
            <div className="flex gap-1.5 mb-1.5">
              <button
                onClick={() => setScenario("base")}
                className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-extrabold tracking-wide transition-colors ${
                  scenario === "base"
                    ? "bg-[#1B2B38] text-white border border-white/25"
                    : "bg-transparent text-white/55 border border-white/10"
                }`}
              >
                Base case
              </button>
              <button
                onClick={() => setScenario("win")}
                className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-extrabold tracking-wide transition-colors ${
                  scenario === "win"
                    ? "bg-[#6BA539]/20 text-[#A9C23F] border border-[#6BA539]/55"
                    : "bg-transparent text-white/55 border border-white/10"
                }`}
              >
                Win pursuit
              </button>
            </div>
            {scenario === "win" ? (
              <div className="flex items-center gap-2 px-1">
                <Activity size={11} className="text-[#FF9425] shrink-0" strokeWidth={2.6} />
                <div className="flex-1 text-[10.5px] text-white/85 leading-snug">
                  +14 FTE W22–W30 · Phoenix peak <span className="text-[#FF4D2E] font-extrabold">118%</span> · <span className="text-[#FF9425] font-bold">2 hires required</span>
                </div>
                <ChevronRight size={12} className="text-white/45 shrink-0" />
              </div>
            ) : (
              <div className="flex items-center gap-2 px-1">
                <Activity size={11} className="text-[#A9C23F] shrink-0" strokeWidth={2.6} />
                <div className="flex-1 text-[10.5px] text-white/65 leading-snug">
                  Tap <span className="text-white font-bold">Win pursuit</span> to model FTE, peak utilization & hire impact
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Bottom Tab Bar */}
      <div className="border-t border-white/8 bg-[#0F1A22] flex justify-around items-center py-2 shrink-0">
        {[
          { Icon: Home, label: "Home" },
          { Icon: MessageSquare, label: "AI" },
          { Icon: Briefcase, label: "Projects", active: true },
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
    </div>
  );
}
