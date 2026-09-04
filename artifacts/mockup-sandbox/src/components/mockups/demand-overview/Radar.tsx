import React from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, AreaChart, Area, XAxis, YAxis } from "recharts";
import { AlertCircle, Clock, TrendingUp, Briefcase, Building2, Calendar, HardHat, Pickaxe, Map } from "lucide-react";
import "./_radar.css";

const TREND_DATA = [
  { week: "Jul 20", hours: 1480 },
  { week: "Jul 27", hours: 1620 },
  { week: "Aug 3", hours: 1390 },
  { week: "Aug 10", hours: 1750 },
  { week: "Aug 17", hours: 1980 },
  { week: "Aug 24", hours: 1710 },
  { week: "Aug 31", hours: 1450 },
  { week: "Sep 7", hours: 1220 },
  { week: "Sep 14", hours: 980 },
  { week: "Sep 21", hours: 1100 },
  { week: "Sep 28", hours: 860 },
  { week: "Oct 5", hours: 720 },
];

const ROLES_DATA = [
  { name: "Project Manager", hours: 320, positions: 8, color: "var(--radar-accent-1)" },
  { name: "Civil Engineer", hours: 280, positions: 7, color: "var(--radar-accent-2)" },
  { name: "Structural Eng.", hours: 240, positions: 6, color: "var(--radar-accent-3)" },
  { name: "Const. Inspector", hours: 210, positions: 6, color: "var(--radar-accent-4)" },
  { name: "Architect", hours: 180, positions: 5, color: "var(--radar-accent-5)" },
  { name: "Estimator", hours: 140, positions: 4, color: "var(--radar-accent-6)" },
  { name: "Surveyor", hours: 110, positions: 3, color: "var(--radar-accent-7)" },
];

const PROJECTS_DATA = [
  { id: "PMM-22-000598", name: "Harbor Bridge Rehabilitation", hours: 340, percent: 100 },
  { id: "PMM-23-000102", name: "Riverside Medical Campus", hours: 280, percent: 82 },
  { id: "PMM-23-000451", name: "Metro Line Extension Ph 2", hours: 260, percent: 76 },
  { id: "PMM-24-000019", name: "Lakefront Stadium Renewal", hours: 190, percent: 56 },
  { id: "PMM-24-000288", name: "Downtown Transit Hub", hours: 150, percent: 44 },
];

export function Radar() {
  return (
    <div className="radar-container min-h-screen p-6 md:p-8 flex flex-col gap-6">
      
      {/* Header */}
      <header className="flex justify-between items-end mb-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Demand Radar</h1>
          <p className="text-slate-500 mt-1 flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Week of Jul 20, 2026
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium text-slate-600 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm">
          <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> System Live</span>
          <span className="text-slate-300">|</span>
          <span>Last sync: 2m ago</span>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Projects & Urgency (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Urgency Panel */}
          <div className="flex gap-4">
            <div className="radar-urgent-card rounded-xl p-5 flex-1 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-rose-600 font-semibold mb-3">
                <AlertCircle className="w-5 h-5" />
                <span>Overdue</span>
              </div>
              <div>
                <span className="text-4xl font-bold text-rose-700">6</span>
                <span className="text-rose-600/80 ml-2 font-medium">Positions</span>
              </div>
              <div className="text-rose-600/70 text-sm mt-2">Start date passed</div>
            </div>
            
            <div className="radar-warning-card rounded-xl p-5 flex-1 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-amber-600 font-semibold mb-3">
                <Clock className="w-5 h-5" />
                <span>Starting Soon</span>
              </div>
              <div>
                <span className="text-4xl font-bold text-amber-700">11</span>
                <span className="text-amber-600/80 ml-2 font-medium">Positions</span>
              </div>
              <div className="text-amber-600/70 text-sm mt-2">Within 14 days</div>
            </div>
          </div>

          {/* Project Leaderboard */}
          <div className="radar-card p-6 flex-1">
            <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-slate-400" /> Top Projects Driving Demand
            </h3>
            <div className="flex flex-col gap-5">
              {PROJECTS_DATA.map((proj, i) => (
                <div key={proj.id} className="group relative">
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="font-medium text-slate-800 text-sm truncate pr-4">{proj.name}</span>
                    <span className="font-semibold text-slate-600 text-sm">{proj.hours}h</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-slate-800 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${proj.percent}%` }}
                      transition={{ duration: 1, delay: i * 0.1 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center: The Donut (5 cols) */}
        <div className="lg:col-span-5 radar-card p-6 flex flex-col items-center justify-center relative min-h-[400px]">
          <h3 className="absolute top-6 left-6 text-lg font-semibold flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-slate-400" /> Demand by Role
          </h3>
          
          <div className="w-full aspect-square max-w-[400px] relative mt-8">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={ROLES_DATA}
                  cx="50%"
                  cy="50%"
                  innerRadius="65%"
                  outerRadius="90%"
                  paddingAngle={2}
                  dataKey="hours"
                  stroke="none"
                >
                  {ROLES_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  formatter={(value) => [`${value} hrs`, 'Demand']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                />
              </PieChart>
            </ResponsiveContainer>
            
            {/* Center Hero Stat */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-slate-500 font-medium mb-1 uppercase tracking-wider text-xs">Total This Week</div>
              <div className="text-5xl font-bold text-slate-900 tracking-tight">1,480<span className="text-2xl text-slate-400 ml-1">h</span></div>
              <div className="text-slate-500 font-medium mt-1 mb-3">42 Open Positions</div>
              <div className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-semibold">
                <TrendingUp className="w-3 h-3" /> +12% vs last
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Roles Legend & Stats (3 cols) */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          <div className="radar-card p-6 flex-1">
            <h3 className="text-lg font-semibold mb-5">Role Breakdown</h3>
            <div className="flex flex-col gap-4">
              {ROLES_DATA.map((role) => (
                <div key={role.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color }} />
                    <span className="font-medium text-slate-700">{role.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500">{role.positions} pos</span>
                    <span className="font-semibold text-slate-900 w-10 text-right">{role.hours}h</span>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-8 pt-6 border-t border-slate-100">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-slate-500">Soft vs Hard Demand</span>
              </div>
              <div className="flex h-3 w-full rounded-full overflow-hidden">
                <div className="bg-blue-400 w-[30%]" title="Soft (30%)" />
                <div className="bg-slate-800 w-[70%]" title="Hard (70%)" />
              </div>
              <div className="flex justify-between text-xs mt-2 font-medium">
                <span className="text-blue-500">30% Soft</span>
                <span className="text-slate-700">70% Hard</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Bottom: 12-Week Sparkline */}
      <div className="radar-card p-6 h-48 flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Map className="w-5 h-5 text-slate-400" /> 12-Week Outlook
          </h3>
          <span className="text-sm font-medium text-slate-500">Jul 20 - Oct 5</span>
        </div>
        <div className="flex-1 w-full -ml-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={TREND_DATA} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="week" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12, fill: '#64748b' }} 
                dy={10}
              />
              <YAxis hide domain={['dataMin - 100', 'dataMax + 100']} />
              <RechartsTooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                labelStyle={{ fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}
                formatter={(val) => [`${val} hours`, 'Demand']}
              />
              <Area 
                type="monotone" 
                dataKey="hours" 
                stroke="#3b82f6" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorHours)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      
    </div>
  );
}
