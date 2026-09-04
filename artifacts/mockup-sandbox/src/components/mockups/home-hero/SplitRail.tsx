import React from "react";
import { AlertTriangle, TrendingUp, Sparkles, ArrowUpRight } from "lucide-react";

export function SplitRail() {
  return (
    <div className="min-h-screen bg-[#1B2B38] font-sans flex items-center justify-center p-8">
      <div className="w-full max-w-[1080px] mx-auto flex flex-col gap-6">
        
        {/* Header Section */}
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-white text-sm font-semibold tracking-wider opacity-90">MY PORTFOLIO · NEXT 7 DAYS</h2>
          <div className="bg-[#6BA539] text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            LIVE · 5
          </div>
        </div>

        {/* Main Split */}
        <div className="flex flex-col md:flex-row gap-6">
          
          {/* Left Rail */}
          <div className="w-full md:w-[340px] bg-white rounded-xl p-8 flex flex-col items-center relative overflow-hidden shadow-2xl shrink-0">
            {/* Window Selector */}
            <div className="flex bg-[#1B2B38]/5 p-1 rounded-lg mb-8 w-full">
              {['7D', '30D', '60D', '90D'].map((window) => (
                <button 
                  key={window}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-colors ${
                    window === '7D' 
                      ? 'bg-white text-[#6BA539] shadow-sm' 
                      : 'text-[#1B2B38]/60 hover:text-[#1B2B38]'
                  }`}
                >
                  {window}
                </button>
              ))}
            </div>

            <div className="bg-[#6BA539]/10 text-[#15803D] text-xs font-bold px-3 py-1 rounded-full mb-6">
              ON TRACK
            </div>

            <div className="relative w-48 h-48 flex items-center justify-center mb-4">
              {/* Fake SVG Gauge */}
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="46" fill="none" stroke="#E5E7EB" strokeWidth="6" strokeDasharray="289 289" />
                <circle 
                  cx="50" cy="50" r="46" 
                  fill="none" 
                  stroke="#6BA539" 
                  strokeWidth="6" 
                  strokeDasharray="248 289" 
                  strokeLinecap="round" 
                />
              </svg>
              <div className="flex flex-col items-center z-10">
                <span className="text-6xl font-black tracking-tighter text-[#1B2B38] leading-none">86</span>
                <span className="text-[#1B2B38]/50 text-sm font-medium mt-1">/ 100</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[#15803D] font-medium text-sm">
              <TrendingUp size={16} />
              <span>+2 vs last wk</span>
            </div>
          </div>

          {/* Right Rail */}
          <div className="flex-1 flex flex-col gap-4">
            {[
              { label: "On-track projects", value: "92", pct: 92, color: "#6BA539" },
              { label: "RFIs response time", value: "78", pct: 78, color: "#F59E0B" },
              { label: "Schedule adherence", value: "88", pct: 88, color: "#6BA539" },
              { label: "Approvals due", value: "60", pct: 60, color: "#F59E0B" }
            ].map((kpi, i) => (
              <div key={i} className="bg-white rounded-xl p-5 shadow-lg flex flex-col justify-center">
                <div className="flex items-end justify-between mb-3">
                  <span className="text-[#1B2B38]/70 font-semibold text-sm">{kpi.label}</span>
                  <span className="text-[#1B2B38] font-bold text-2xl leading-none">{kpi.value}</span>
                </div>
                
                {/* Fake sparkline/bar combination */}
                <div className="w-full h-2 bg-[#1B2B38]/5 rounded-full overflow-hidden relative">
                  <div 
                    className="absolute top-0 left-0 h-full rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${kpi.pct}%`, backgroundColor: kpi.color }}
                  />
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* Pinned Critical */}
        <div className="bg-white rounded-xl p-6 shadow-2xl flex flex-col md:flex-row gap-6 border border-l-4 border-l-[#DC2626] border-white relative mt-2 overflow-hidden">
          <div className="absolute top-0 right-0 bg-[#1B2B38]/5 text-[#1B2B38]/40 text-[10px] font-bold px-3 py-1 rounded-bl-lg">
            7D
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2 mb-3">
              <span className="bg-[#DC2626] text-white text-[10px] font-bold px-2 py-0.5 rounded-sm flex items-center gap-1 uppercase tracking-wide">
                <AlertTriangle size={10} />
                Pinned Critical
              </span>
            </div>
            
            <h3 className="text-[#1B2B38] text-xl font-bold mb-1">Bruce Korrow — over-allocated 143%</h3>
            <p className="text-[#1B2B38]/60 text-sm font-medium mb-5">Utilization breach across 42 projects</p>

            <div className="bg-[#1B2B38]/[0.03] rounded-lg p-4">
              <div className="flex items-center gap-1.5 text-[#1B2B38]/70 text-xs font-bold tracking-wider mb-2">
                <Sparkles size={12} className="text-[#1B2B38]/40" />
                AI ANALYSIS · WHY THIS IS CRITICAL
              </div>
              <ul className="text-sm text-[#1B2B38]/80 space-y-2 pl-4 list-disc marker:text-[#DC2626]/50">
                <li>Projected 143% utilization is 43 pts over capacity — burnout and slip risk are immediate, not theoretical.</li>
                <li>Cascade exposure: a single re-plan touches 42 active projects — schedule, billing and client comms all move with it.</li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col justify-end md:items-end">
            <button className="bg-[#6BA539]/10 hover:bg-[#6BA539]/20 text-[#15803D] font-bold px-6 py-3 rounded-lg flex items-center gap-2 transition-colors">
              Resolve now
              <ArrowUpRight size={18} />
            </button>
          </div>

        </div>

      </div>
    </div>
  );
}
