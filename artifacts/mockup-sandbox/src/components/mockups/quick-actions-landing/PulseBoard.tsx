import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Command, 
  Activity, 
  Users, 
  Briefcase, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Building2,
  HardHat,
  ArrowRight,
  Zap,
  ChevronRight,
  FileText
} from 'lucide-react';
import './pulse-board.css';

// SVG Progress Ring Component
const ProgressRing = ({ 
  value, 
  max, 
  color, 
  icon: Icon,
  size = 80
}: { 
  value: number; 
  max: number; 
  color: string; 
  icon?: any;
  size?: number;
}) => {
  const strokeWidth = 4;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (value / max) * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg height={size} width={size} className="transform -rotate-90">
        <circle
          stroke="rgba(255,255,255,0.05)"
          fill="transparent"
          strokeWidth={strokeWidth}
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          stroke={color}
          fill="transparent"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference + ' ' + circumference}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={radius}
          cx={size / 2}
          cy={size / 2}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-white">
        {Icon ? <Icon size={size * 0.35} className="opacity-80" style={{ color }} /> : null}
      </div>
    </div>
  );
};

// SVG Flow Diagram Component
const FlowDiagram = () => {
  return (
    <div className="relative w-full max-w-2xl mx-auto mt-16 px-4">
      <div className="pb-flow-line"></div>
      <div className="flex justify-between items-center relative">
        <div className="pb-flow-node flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full pb-glass flex items-center justify-center border border-[#4E8A22]/40 text-[#4E8A22] shadow-[0_0_15px_rgba(78,138,34,0.3)]">
            <Search size={20} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-white">Search</p>
            <p className="text-xs text-white/40 pb-font-mono mt-1">Any record</p>
          </div>
        </div>

        <div className="pb-flow-node flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full pb-glass flex items-center justify-center text-white/80">
            <Zap size={20} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-white">Select</p>
            <p className="text-xs text-white/40 pb-font-mono mt-1">Target context</p>
          </div>
        </div>

        <div className="pb-flow-node flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full pb-glass flex items-center justify-center text-white/80">
            <Command size={20} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-white">Act</p>
            <p className="text-xs text-white/40 pb-font-mono mt-1">Execute task</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Activity Sparkline Component
const Sparkline = () => {
  const points = "0,20 10,15 20,25 30,10 40,30 50,20 60,35 70,15 80,25 90,5 100,20";
  return (
    <svg viewBox="0 0 100 40" className="w-full h-8 overflow-visible">
      <polyline
        fill="none"
        stroke="#4E8A22"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        className="opacity-70"
      />
      <circle cx="90" cy="5" r="2" fill="#67B52E" className="animate-pulse" />
    </svg>
  );
}


export default function PulseBoard() {
  const [isFocused, setIsFocused] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const recentRecords = [
    { id: "PMM-26-000010", name: "Riverside Medical Tower", type: "Project", status: "Active", icon: Building2, float: "pb-animate-float-1" },
    { id: "EMP-992", name: "Sarah Jenkins", type: "Sr. Project Manager", status: "Available", icon: Users, float: "pb-animate-float-2" },
    { id: "OPM-25-000023", name: "Harbor Point Substation", type: "Opportunity", status: "Planning", icon: Briefcase, float: "pb-animate-float-3" },
    { id: "EMP-405", name: "Mike Ross", type: "Electrical Estimator", status: "Allocated", icon: HardHat, float: "pb-animate-float-4" },
  ];

  return (
    <div className="min-h-[100dvh] pb-mesh-bg pb-font-sans overflow-hidden flex flex-col relative selection:bg-[#4E8A22] selection:text-white">
      
      {/* Top Nav/Brand */}
      <header className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#67B52E] to-[#355E17] flex items-center justify-center shadow-lg shadow-[#4E8A22]/20">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-widest text-white">RM ONE</h1>
            <p className="text-[10px] uppercase tracking-wider text-[#67B52E] font-medium">Operational Intelligence</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 pb-glass px-3 py-1.5 rounded-full text-xs text-white/70">
            <span className="w-2 h-2 rounded-full bg-[#67B52E] animate-pulse"></span>
            System Nominal
          </div>
          <div className="w-8 h-8 rounded-full pb-glass border border-white/10 flex items-center justify-center">
            <span className="text-xs font-bold text-white/80">JD</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center relative z-10 w-full max-w-7xl mx-auto px-6 pt-20">
        
        {/* Central Search Area */}
        <div className="w-full max-w-3xl relative flex flex-col items-center mb-16">
          
          {/* Pulse Effects */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full aspect-square max-w-[600px] pointer-events-none">
            <div className="pb-pulse-ring pb-pulse-ring-1"></div>
            <div className="pb-pulse-ring pb-pulse-ring-2"></div>
            <div className="pb-pulse-ring pb-pulse-ring-3"></div>
          </div>

          <div className="text-center mb-8 relative z-10">
            <h2 className="text-4xl md:text-5xl font-light tracking-tight pb-gradient-text mb-3">
              Command Center
            </h2>
            <p className="text-white/50 text-sm md:text-base font-medium max-w-lg mx-auto">
              Find any project, opportunity, or team member instantly to update status, log notes, or adjust allocations.
            </p>
          </div>

          <div className={`w-full relative z-20 transition-all duration-500 ${isFocused ? 'scale-[1.02]' : 'scale-100'}`}>
            <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
              <Search className={`w-6 h-6 transition-colors duration-300 ${isFocused ? 'text-[#67B52E]' : 'text-white/40'}`} />
            </div>
            <input 
              type="text" 
              className={`w-full h-20 pl-16 pr-24 rounded-2xl bg-black/40 backdrop-blur-3xl border text-xl text-white placeholder:text-white/30 focus:outline-none transition-all duration-300 shadow-2xl
                ${isFocused ? 'border-[#4E8A22]/50 shadow-[0_10px_40px_rgba(78,138,34,0.15)] bg-black/60' : 'border-white/10'}`}
              placeholder="Search by name, ID, client, or person..."
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
            <div className="absolute inset-y-0 right-4 flex items-center gap-2">
              <kbd className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 border border-white/10 text-white/40 text-xs pb-font-mono font-medium">
                <Command size={12} /> K
              </kbd>
            </div>
            
            {/* Quick Suggestions Dropdown Mockup (shows when typing) */}
            {searchValue.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-4 pb-glass rounded-2xl border border-white/10 overflow-hidden shadow-2xl z-50 animate-in fade-in slide-in-from-top-4 duration-200">
                <div className="p-2">
                  <div className="px-4 py-2 text-xs font-semibold text-white/40 uppercase tracking-wider">Top Results</div>
                  {recentRecords.filter(r => r.name.toLowerCase().includes(searchValue.toLowerCase()) || r.id.toLowerCase().includes(searchValue.toLowerCase())).map((record, i) => (
                    <button key={i} className="w-full text-left flex items-center justify-between p-4 rounded-xl hover:bg-white/5 transition-colors group">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-[#67B52E]">
                          <record.icon size={20} />
                        </div>
                        <div>
                          <div className="text-white font-medium group-hover:text-[#67B52E] transition-colors">{record.name}</div>
                          <div className="text-white/40 text-xs flex items-center gap-2 mt-1">
                            <span className="pb-font-mono text-[10px] border border-white/10 px-1.5 rounded bg-white/5">{record.id}</span>
                            <span>{record.type}</span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-white/20 group-hover:text-white/60 transition-colors" />
                    </button>
                  ))}
                </div>
                <div className="bg-black/40 p-3 border-t border-white/5 flex items-center gap-4 text-xs text-white/40">
                  <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 pb-font-mono text-[10px]">↵</kbd> to select</span>
                  <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 pb-font-mono text-[10px]">↑↓</kbd> to navigate</span>
                </div>
              </div>
            )}
          </div>
          
          <FlowDiagram />
          
        </div>

        {/* Layout Grid: Recent (Left) & KPIs (Right) */}
        <div className="w-full flex flex-col lg:flex-row gap-8 justify-between items-start mt-8 relative z-10">
          
          {/* Left: Floating Recent Records */}
          <div className="w-full lg:w-1/3 flex flex-col gap-4">
            <h3 className="text-xs font-semibold tracking-wider text-white/40 uppercase mb-2 pl-2">Recent Contexts</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
              {recentRecords.map((record, idx) => (
                <div key={idx} className={`pb-glass pb-glass-hover rounded-2xl p-4 flex items-start gap-4 cursor-pointer ${record.float}`}>
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center shrink-0 border border-white/5">
                    <record.icon size={18} className="text-[#67B52E]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-white text-sm font-medium truncate">{record.name}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap border
                        ${record.status === 'Active' || record.status === 'Available' ? 'bg-[#4E8A22]/20 text-[#67B52E] border-[#4E8A22]/30' : 
                          'bg-white/5 text-white/60 border-white/10'}`}>
                        {record.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/40">
                      <span className="pb-font-mono text-[10px]">{record.id}</span>
                      <span className="w-1 h-1 rounded-full bg-white/20"></span>
                      <span className="truncate">{record.type}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Operational KPIs */}
          <div className="w-full lg:w-1/3 flex flex-col gap-4 lg:items-end">
             <h3 className="text-xs font-semibold tracking-wider text-white/40 uppercase mb-2 pr-2">Current Pulse</h3>
             <div className="grid grid-cols-2 gap-4 w-full">
                
                {/* KPI 1: Live Projects */}
                <div className="pb-glass rounded-2xl p-5 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <ProgressRing value={42} max={50} color="#67B52E" icon={Building2} size={48} />
                    <span className="text-3xl font-light text-white tracking-tight">42</span>
                  </div>
                  <p className="text-sm font-medium text-white mb-1">Live Projects</p>
                  <p className="text-xs text-white/40">Active this week</p>
                </div>

                {/* KPI 2: Staff Available */}
                <div className="pb-glass rounded-2xl p-5 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <ProgressRing value={18} max={100} color="#3b82f6" icon={Users} size={48} />
                    <span className="text-3xl font-light text-white tracking-tight">18</span>
                  </div>
                  <p className="text-sm font-medium text-white mb-1">Available</p>
                  <p className="text-xs text-white/40">Staff unallocated</p>
                </div>

                {/* KPI 3: Records Touched */}
                <div className="pb-glass rounded-2xl p-5 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                      <FileText size={20} className="text-white/60" />
                    </div>
                    <span className="text-3xl font-light text-white tracking-tight">7</span>
                  </div>
                  <p className="text-sm font-medium text-white mb-1">Records Touched</p>
                  <p className="text-xs text-white/40">Updated today</p>
                </div>

                {/* KPI 4: Alerts */}
                <div className="pb-glass rounded-2xl p-5 flex flex-col relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/10 rounded-bl-full blur-2xl"></div>
                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                      <AlertCircle size={20} className="text-red-400" />
                    </div>
                    <span className="text-3xl font-light text-red-400 tracking-tight">3</span>
                  </div>
                  <p className="text-sm font-medium text-white mb-1 relative z-10">Unstaffed Jobs</p>
                  <p className="text-xs text-white/40 relative z-10">Needs attention</p>
                </div>

             </div>

             {/* Activity Chart */}
             <div className="w-full pb-glass rounded-2xl p-5 mt-2">
                <div className="flex justify-between items-end mb-4">
                  <div>
                    <p className="text-sm font-medium text-white">System Activity</p>
                    <p className="text-xs text-white/40">Last 24 hours</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[#67B52E] text-xs font-bold">+12%</span>
                  </div>
                </div>
                <Sparkline />
             </div>
          </div>

        </div>
      </main>

      {/* Decorative Bottom Glow */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[200px] bg-[#4E8A22]/20 blur-[100px] rounded-full pointer-events-none z-0"></div>

    </div>
  );
}
