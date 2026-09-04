import React, { useState } from 'react';
import { 
  Search, 
  Command, 
  AlertTriangle, 
  Users, 
  Clock, 
  ArrowRight, 
  Building2, 
  Briefcase, 
  Activity, 
  Calendar, 
  ChevronRight,
  Zap,
  FolderOpen,
  User,
  ShieldAlert
} from 'lucide-react';
import './CommandDeck.css';

const MOCK_DATA = {
  recentRecords: [
    { id: 'PRJ-9202', name: 'Riverside Medical Tower', type: 'Project', status: 'Active', time: '12 mins ago', icon: Building2 },
    { id: 'OPM-25-000023', name: 'Healthcare Vertical Expansion', type: 'Opportunity', status: 'Bidding', time: '1 hour ago', icon: Briefcase },
    { id: 'PMM-26-000010', name: 'Harbor Point Substation', type: 'Lead', status: 'Evaluating', time: '3 hours ago', icon: Zap },
    { id: 'PRJ-9188', name: 'Westside Distribution Center', type: 'Project', status: 'At Risk', time: 'Yesterday', icon: Building2 },
  ],
  unstaffed: [
    { name: 'Downtown Transit Hub', id: 'PRJ-9150', needs: 4, priority: 'Critical' },
    { name: 'Vertex Corporate Campus', id: 'PRJ-9211', needs: 2, priority: 'High' },
    { name: 'Oakridge Data Center', id: 'OPM-25-00102', needs: 1, priority: 'Medium' },
  ],
  freePeople: [
    { name: 'Alex Chen', role: 'Senior Project Manager', free: 80 },
    { name: 'Sarah Jenkins', role: 'Electrical Estimator', free: 100 },
    { name: 'Marcus Rodriguez', role: 'Site Superintendent', free: 60 },
    { name: 'David Kim', role: 'Safety Coordinator', free: 100 },
  ],
  chartData: [
    { week: 'W41', demand: 75, capacity: 100 },
    { week: 'W42', demand: 85, capacity: 100 },
    { week: 'W43', demand: 95, capacity: 100 },
    { week: 'W44', demand: 110, capacity: 100 }, // Overcapacity
    { week: 'W45', demand: 115, capacity: 100 }, // Overcapacity
    { week: 'W46', demand: 90, capacity: 100 },
    { week: 'W47', demand: 70, capacity: 100 },
    { week: 'W48', demand: 60, capacity: 100 },
  ]
};

export default function CommandDeck() {
  const [searchValue, setSearchValue] = useState('');

  return (
    <div className="command-deck-container min-h-screen p-6 md:p-10 flex flex-col items-center">
      <div className="command-deck-content w-full max-w-6xl flex flex-col gap-10">
        
        {/* Header */}
        <header className="flex justify-between items-center w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#4E8A22]/20 border border-[#4E8A22]/40 flex items-center justify-center">
              <Zap className="w-5 h-5 text-[#84cc16]" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white m-0 leading-tight">RM ONE</h1>
              <p className="text-xs text-zinc-400 font-medium uppercase tracking-widest">Operational Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-4 text-sm text-zinc-400">
              <span className="flex items-center gap-1.5"><FolderOpen className="w-4 h-4" /> 42 Live</span>
              <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
              <span className="flex items-center gap-1.5"><User className="w-4 h-4" /> 18 Free</span>
              <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
              <span className="flex items-center gap-1.5"><Activity className="w-4 h-4" /> 7 Touched Today</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center overflow-hidden">
              <img src={`https://api.dicebear.com/7.x/notionists/svg?seed=Felix&backgroundColor=transparent`} alt="User" className="w-8 h-8 opacity-80" />
            </div>
          </div>
        </header>

        {/* Hero Search */}
        <section className="w-full flex flex-col items-center justify-center py-12 md:py-16">
          <h2 className="text-4xl md:text-5xl font-semibold text-white mb-6 tracking-tight text-center">
            What needs <span className="text-[#84cc16]">doing?</span>
          </h2>
          <div className="w-full max-w-2xl">
            <div className="search-input-wrapper flex items-center px-5 py-4 w-full shadow-2xl">
              <Search className="w-6 h-6 text-zinc-400 mr-4 flex-shrink-0" />
              <input 
                type="text" 
                placeholder="Search by name, ID, client, or person..." 
                className="search-input text-lg md:text-xl placeholder:text-zinc-500"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                autoFocus
              />
              <div className="hidden md:flex items-center justify-center bg-zinc-800/80 border border-zinc-700 rounded px-2.5 py-1 ml-4 shadow-sm flex-shrink-0">
                <Command className="w-3.5 h-3.5 text-zinc-400 mr-1" />
                <span className="text-xs font-semibold text-zinc-400">K</span>
              </div>
            </div>
            <div className="flex items-center justify-center mt-6 gap-6 text-sm text-zinc-500">
              <span className="flex items-center gap-2"><div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400 border border-zinc-700">1</div> Search</span>
              <ArrowRight className="w-4 h-4 text-zinc-700" />
              <span className="flex items-center gap-2"><div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400 border border-zinc-700">2</div> Select</span>
              <ArrowRight className="w-4 h-4 text-zinc-700" />
              <span className="flex items-center gap-2 text-zinc-300"><div className="w-5 h-5 rounded-full bg-[#4E8A22]/30 flex items-center justify-center text-[10px] text-[#84cc16] border border-[#4E8A22]/50">3</div> Act</span>
            </div>
          </div>
        </section>

        {/* Bento Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full pb-20">
          
          {/* Card 1: Weekly Demand (Span 2) */}
          <div className="bento-card col-span-1 md:col-span-2 p-6 flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-start mb-8">
              <div>
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-[#84cc16]" />
                  Fleet Demand Forecast
                </h3>
                <p className="text-sm text-zinc-400 mt-1">Projected staffing demand vs capacity across all active projects.</p>
              </div>
              <button className="text-xs font-medium text-zinc-400 hover:text-white transition-colors bg-zinc-800/50 px-3 py-1.5 rounded-md border border-zinc-700/50">
                View Full Roster
              </button>
            </div>

            <div className="flex-1 flex items-end h-48 gap-2 mt-4 relative">
              {/* Capacity Line */}
              <div className="absolute top-[16%] left-0 w-full border-t border-dashed border-zinc-600/50 z-0">
                <span className="absolute -top-5 left-0 text-[10px] text-zinc-500 font-mono">100% CAPACITY</span>
              </div>

              {MOCK_DATA.chartData.map((data, i) => {
                const isOver = data.demand > 100;
                const heightPercent = Math.min(data.demand, 120); // Cap visual at 120%
                
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-3 z-10 group cursor-crosshair h-full">
                    <div className="w-full relative h-full flex flex-col justify-end group-hover:opacity-90">
                      {/* Tooltip */}
                      <div className="opacity-0 group-hover:opacity-100 absolute -top-10 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 text-white text-xs py-1 px-2 rounded pointer-events-none whitespace-nowrap transition-opacity z-20">
                        {data.demand}% Demand
                      </div>
                      
                      {/* Overcapacity segment */}
                      {isOver && (
                        <div 
                          className="w-full bg-red-500/80 rounded-t-sm chart-bar"
                          style={{ height: `${((data.demand - 100) / 120) * 100}%` }}
                        />
                      )}
                      {/* Normal segment */}
                      <div 
                        className={`w-full ${isOver ? 'bg-[#4E8A22]/80 rounded-none' : 'bg-[#4E8A22]/80 rounded-t-sm'} chart-bar`}
                        style={{ height: `${(Math.min(data.demand, 100) / 120) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-zinc-500 font-medium">{data.week}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Card 2: Nobody on these (Span 1) */}
          <div className="bento-card col-span-1 p-6 border-red-900/30 bg-gradient-to-b from-red-950/10 to-transparent">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center relative">
                <ShieldAlert className="w-4 h-4 text-red-500" />
                <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
              </div>
              <h3 className="text-lg font-medium text-white">Unstaffed Jobs</h3>
            </div>
            
            <div className="flex flex-col gap-4">
              {MOCK_DATA.unstaffed.map((job, i) => (
                <div key={i} className="group p-3 rounded-lg border border-red-900/20 bg-zinc-900/30 hover:bg-red-950/20 hover:border-red-900/40 transition-colors cursor-pointer">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-sm font-medium text-red-50 group-hover:text-red-400 transition-colors">{job.name}</h4>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-zinc-500">{job.id}</span>
                    <span className="text-xs font-medium bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full flex items-center gap-1.5">
                      <Users className="w-3 h-3" /> Needs {job.needs}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-4 py-2 text-xs font-medium text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 rounded-lg transition-colors flex items-center justify-center gap-2">
              View all 7 unstaffed <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {/* Card 3: Free this week (Span 1) */}
          <div className="bento-card col-span-1 p-6">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#4E8A22]/20 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-[#84cc16]" />
                </div>
                <h3 className="text-lg font-medium text-white">Free this week</h3>
              </div>
            </div>

            <div className="flex flex-col gap-5">
              {MOCK_DATA.freePeople.map((person, i) => (
                <div key={i} className="flex flex-col gap-2 group cursor-pointer">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-zinc-200 group-hover:text-white">{person.name}</p>
                      <p className="text-[11px] text-zinc-500">{person.role}</p>
                    </div>
                    <span className="text-xs font-mono text-[#84cc16]">{person.free}%</span>
                  </div>
                  <div className="load-bar-track">
                    <div 
                      className={`load-bar-fill ${person.free === 100 ? 'high' : ''}`} 
                      style={{ width: `${person.free}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card 4: Jump back in (Span 2) */}
          <div className="bento-card col-span-1 md:col-span-2 p-6">
            <div className="flex justify-between items-start mb-6">
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-zinc-400" />
                Jump back in
              </h3>
              <button className="text-xs font-medium text-zinc-400 hover:text-white transition-colors">
                View History
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {MOCK_DATA.recentRecords.map((record, i) => {
                const Icon = record.icon;
                return (
                  <div key={i} className="flex items-center p-3 rounded-xl border border-zinc-800/50 bg-zinc-900/30 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all cursor-pointer group">
                    <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center border border-zinc-700 mr-4 group-hover:bg-[#4E8A22]/20 group-hover:border-[#4E8A22]/40 transition-colors">
                      <Icon className="w-4 h-4 text-zinc-400 group-hover:text-[#84cc16] transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">{record.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-zinc-500 font-mono">{record.id}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-700"></span>
                        <span className="text-[11px] text-zinc-500">{record.time}</span>
                      </div>
                    </div>
                    <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChevronRight className="w-4 h-4 text-zinc-500" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </section>
      </div>
    </div>
  );
}
