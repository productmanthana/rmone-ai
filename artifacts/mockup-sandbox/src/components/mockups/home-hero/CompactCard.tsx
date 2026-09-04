import React from "react";
import { AlertTriangle, ArrowUpRight, TrendingUp, ChevronRight, Sparkles } from "lucide-react";

export function CompactCard() {
  return (
    <div 
      className="min-h-screen flex flex-col items-center justify-center p-8 font-sans"
      style={{ backgroundColor: "#1B2B38", fontFamily: "Inter, sans-serif" }}
    >
      <div className="w-full max-w-[880px] flex flex-col gap-4">
        
        {/* Top Hero Card */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* Header Row */}
          <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-[11px] font-bold tracking-widest text-[#1B2B38]">
                MY PORTFOLIO <span className="opacity-40 px-1">·</span> NEXT 7 DAYS
              </h2>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#6BA539]/10 text-[#6BA539] text-[10px] font-bold tracking-wider">
                <div className="w-1.5 h-1.5 rounded-full bg-[#6BA539] animate-pulse" />
                LIVE · 5
              </div>
            </div>

            {/* Window Selector */}
            <div className="flex items-center bg-gray-50 rounded-lg p-1">
              {['7D', '30D', '60D', '90D'].map((window) => (
                <button
                  key={window}
                  className={`px-3 py-1 text-[11px] font-bold rounded-md transition-colors ${
                    window === '7D' 
                      ? 'bg-white text-[#6BA539] shadow-sm' 
                      : 'text-gray-400 hover:text-[#1B2B38]'
                  }`}
                >
                  {window}
                </button>
              ))}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="p-8 flex items-center gap-12">
            
            {/* Health Gauge & Score Area */}
            <div className="flex flex-col items-center justify-center flex-shrink-0 relative">
              {/* Simple SVG Gauge */}
              <div className="relative w-[130px] h-[130px]">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  {/* Background Track */}
                  <circle
                    cx="50" cy="50" r="42"
                    fill="transparent" stroke="#f3f4f6" strokeWidth="8"
                  />
                  {/* Progress Track */}
                  <circle
                    cx="50" cy="50" r="42"
                    fill="transparent" stroke="#6BA539" strokeWidth="8"
                    strokeDasharray="264"
                    strokeDashoffset={264 - (264 * 0.86)}
                    strokeLinecap="round"
                  />
                </svg>
                
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-black tracking-tight text-[#1B2B38]">86</span>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">/ 100</span>
                </div>
              </div>
              
              <div className="mt-4 flex flex-col items-center gap-2">
                <div className="px-2.5 py-1 rounded bg-[#6BA539] text-white text-[10px] font-bold tracking-widest">
                  ON TRACK
                </div>
                <div className="flex items-center gap-1 text-[#15803D] text-[11px] font-semibold">
                  <TrendingUp className="w-3 h-3" />
                  +2 vs last wk
                </div>
              </div>
            </div>

            {/* KPI Grid */}
            <div className="flex-1 grid grid-cols-2 gap-3">
              <KpiCard label="On-track projects" value={92} status="good" />
              <KpiCard label="RFIs response time" value={78} status="warn" />
              <KpiCard label="Schedule adherence" value={88} status="good" />
              <KpiCard label="Approvals due" value={60} status="warn" />
            </div>

          </div>
        </div>

        {/* Pinned Critical Card */}
        <div className="bg-white rounded-2xl shadow-xl p-6 border-l-4 border-[#DC2626] relative">
          <div className="absolute top-6 right-6">
            <div className="px-2.5 py-1 rounded bg-gray-100 text-gray-500 text-[10px] font-bold tracking-widest">
              7D
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
            <span className="text-[#DC2626] text-[11px] font-bold tracking-widest uppercase">
              Pinned Critical
            </span>
          </div>

          <h3 className="text-xl font-bold text-[#1B2B38] mb-1">
            Bruce Korrow — over-allocated 143%
          </h3>
          <p className="text-sm text-[#1B2B38]/60 mb-6 font-medium">
            Utilization breach across 42 projects
          </p>

          <div className="bg-[#1B2B38]/[0.02] rounded-xl p-5 border border-gray-100 mb-6">
            <div className="flex items-center gap-1.5 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-[#6BA539]" />
              <h4 className="text-[10px] font-bold text-[#1B2B38]/70 tracking-widest uppercase">
                AI Analysis · Why this is critical
              </h4>
            </div>
            
            <ul className="space-y-2.5">
              <li className="flex items-start gap-3">
                <span className="text-[#6BA539] mt-1 text-xs">·</span>
                <span className="text-sm text-[#1B2B38]/80 leading-relaxed">
                  Projected 143% utilization is 43 pts over capacity — burnout and slip risk are immediate, not theoretical.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-[#6BA539] mt-1 text-xs">·</span>
                <span className="text-sm text-[#1B2B38]/80 leading-relaxed">
                  Cascade exposure: a single re-plan touches 42 active projects — schedule, billing and client comms all move with it.
                </span>
              </li>
            </ul>
          </div>

          <div className="flex justify-end">
            <button className="flex items-center gap-2 bg-[#6BA539] hover:bg-[#5a8c2f] transition-colors text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-sm">
              Resolve now
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

function KpiCard({ label, value, status }: { label: string; value: number; status: 'good' | 'warn' }) {
  const color = status === 'good' ? '#6BA539' : '#F59E0B';
  const bgSoft = status === 'good' ? 'bg-[#6BA539]/10' : 'bg-[#F59E0B]/10';

  return (
    <div className="border border-gray-100 rounded-xl p-4 flex flex-col justify-between bg-gray-50/50 hover:bg-white transition-colors cursor-default group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full`} style={{ backgroundColor: color }} />
          <span className="text-xs font-semibold text-[#1B2B38]/70 group-hover:text-[#1B2B38] transition-colors">
            {label}
          </span>
        </div>
        <span className="text-lg font-bold text-[#1B2B38] leading-none">
          {value}
        </span>
      </div>
      
      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div 
          className="h-full rounded-full transition-all duration-1000 ease-out" 
          style={{ width: `${value}%`, backgroundColor: color }} 
        />
      </div>
    </div>
  );
}
