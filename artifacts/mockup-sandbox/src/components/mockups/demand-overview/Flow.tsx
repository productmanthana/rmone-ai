import React from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { motion } from "framer-motion";
import { 
  AlertCircle, 
  Briefcase, 
  Calendar, 
  ChevronRight, 
  Clock, 
  HardHat, 
  MapPin, 
  TrendingUp, 
  Users 
} from "lucide-react";
import "./_flow.css";

const data = [
  { week: "Jul 20", hours: 1480, hard: 1036, soft: 444, note: "This Week" },
  { week: "Jul 27", hours: 1620, hard: 1134, soft: 486 },
  { week: "Aug 3", hours: 1390, hard: 973, soft: 417 },
  { week: "Aug 10", hours: 1750, hard: 1225, soft: 525 },
  { week: "Aug 17", hours: 1980, hard: 1386, soft: 594, note: "Peak Demand" },
  { week: "Aug 24", hours: 1710, hard: 1197, soft: 513 },
  { week: "Aug 31", hours: 1450, hard: 1015, soft: 435 },
  { week: "Sep 7", hours: 1220, hard: 854, soft: 366 },
  { week: "Sep 14", hours: 980, hard: 686, soft: 294 },
  { week: "Sep 21", hours: 1100, hard: 770, soft: 330 },
  { week: "Sep 28", hours: 860, hard: 602, soft: 258 },
  { week: "Oct 5", hours: 720, hard: 504, soft: 216, note: "Cool-down" },
];

const topRoles = [
  { role: "Project Manager", hours: 320, positions: 8 },
  { role: "Civil Engineer", hours: 280, positions: 7 },
  { role: "Structural Engineer", hours: 240, positions: 6 },
  { role: "Construction Inspector", hours: 210, positions: 6 },
  { role: "Architect", hours: 180, positions: 5 },
];

const topProjects = [
  { name: "Harbor Bridge Rehab", id: "PMM-22-000598", hours: 340 },
  { name: "Riverside Medical", id: "PMM-23-0192", hours: 280 },
  { name: "Metro Line Ext", id: "PMM-21-0084", hours: 260 },
  { name: "Lakefront Stadium", id: "PMM-24-0012", hours: 190 },
];

export function Flow() {
  return (
    <div className="flow-container min-h-screen w-full overflow-hidden text-slate-800 relative">
      {/* Ambient Background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-100 opacity-50 blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-100 opacity-50 blur-[100px]" />
      </div>

      <header className="relative z-10 px-8 py-6 flex justify-between items-center border-b border-slate-200/50 bg-white/50 backdrop-blur-md">
        <div>
          <h1 className="text-3xl font-light tracking-tight text-slate-900">Demand Flow</h1>
          <p className="text-slate-500 font-light mt-1 flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4" /> Q3 2026 Projection
          </p>
        </div>
        <div className="flex gap-4">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-50 text-red-600 text-sm font-medium border border-red-100">
            <AlertCircle className="w-4 h-4" />
            6 Overdue
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 text-amber-600 text-sm font-medium border border-amber-100">
            <Clock className="w-4 h-4" />
            11 within 14 days
          </div>
        </div>
      </header>

      <main className="relative z-10 w-full h-[calc(100vh-100px)] flex flex-col pt-12">
        {/* Top Annotation Layer */}
        <div className="absolute top-8 left-0 right-0 h-64 z-20 pointer-events-none">
          {/* This Week Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="absolute left-[8%] top-[20px] w-80 flow-card-blur rounded-2xl p-6 pointer-events-auto"
          >
            <div className="flex justify-between items-start mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-1 rounded-md">This Week (Jul 20)</span>
              <span className="flex items-center text-emerald-600 text-xs font-bold bg-emerald-50 px-2 py-1 rounded-md">
                <TrendingUp className="w-3 h-3 mr-1" /> +12%
              </span>
            </div>
            
            <div className="mb-6">
              <div className="text-5xl font-light text-slate-900 tracking-tight mb-1">1,480<span className="text-xl text-slate-400 font-normal">h</span></div>
              <div className="text-slate-500 flex items-center gap-2">
                <Users className="w-4 h-4" /> 42 open positions
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Primary Drivers</p>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-700"><Briefcase className="w-4 h-4 text-slate-400" /> Project Managers</span>
                <span className="font-medium text-slate-900">320h</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-700"><HardHat className="w-4 h-4 text-slate-400" /> Civil Engineers</span>
                <span className="font-medium text-slate-900">280h</span>
              </div>
            </div>
            
            <div className="absolute -bottom-[60px] left-10 w-px h-[60px] bg-gradient-to-b from-blue-300 to-transparent"></div>
          </motion.div>

          {/* Peak Demand Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
            className="absolute left-[40%] top-[0px] w-64 flow-card-blur rounded-2xl p-5 pointer-events-auto animate-float"
          >
            <div className="flex justify-between items-start mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">Peak (Aug 17)</span>
            </div>
            <div className="text-4xl font-light text-slate-900 tracking-tight mb-1">1,980<span className="text-xl text-slate-400 font-normal">h</span></div>
            <p className="text-xs text-slate-500 mt-2">Driven by Harbor Bridge phase 2 kickoff.</p>
            <div className="absolute -bottom-[80px] left-10 w-px h-[80px] bg-gradient-to-b from-indigo-300 to-transparent"></div>
          </motion.div>

          {/* Cool-down Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="absolute right-[8%] top-[60px] w-56 flow-card-blur rounded-2xl p-5 pointer-events-auto"
          >
             <div className="flex justify-between items-start mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-1 rounded-md">Cool-down (Oct 5)</span>
            </div>
            <div className="text-3xl font-light text-slate-900 tracking-tight mb-1">720<span className="text-lg text-slate-400 font-normal">h</span></div>
            <p className="text-xs text-slate-500 mt-2">Capacity opens up for new bids.</p>
            <div className="absolute -bottom-[120px] left-10 w-px h-[120px] bg-gradient-to-b from-slate-300 to-transparent"></div>
          </motion.div>
        </div>

        {/* The River (Chart) */}
        <div className="flex-1 w-full relative z-10 px-8 mt-24">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-color)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--chart-color)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorHard" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1e40af" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="#1e40af" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
              <XAxis 
                dataKey="week" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }}
                dy={10}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', padding: '16px' }}
                cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <Area 
                type="monotone" 
                dataKey="hours" 
                stroke="var(--chart-color)" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorHours)" 
                animationDuration={2000}
              />
               <Area 
                type="monotone" 
                dataKey="hard" 
                stroke="#1e40af" 
                strokeWidth={2}
                strokeDasharray="5 5"
                fillOpacity={1} 
                fill="url(#colorHard)" 
                animationDuration={2000}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Bottom Drill-down Context */}
        <div className="h-64 bg-white/60 border-t border-slate-200/50 backdrop-blur-xl z-20 px-8 py-6 flex gap-8">
          
          <div className="flex-1">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2">
              <Briefcase className="w-4 h-4" /> Top Roles in Demand
            </h3>
            <div className="space-y-3">
              {topRoles.map((role, idx) => (
                <div key={idx} className="flex items-center justify-between group cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold">
                      {role.positions}
                    </div>
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600 transition-colors">{role.role}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-slate-500">{role.hours}h</span>
                    <ChevronRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="w-px h-full bg-slate-200/50"></div>

          <div className="flex-1">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Top Projects Driving Demand
            </h3>
            <div className="space-y-4">
              {topProjects.map((proj, idx) => (
                <div key={idx} className="flex items-center justify-between group cursor-pointer">
                  <div>
                    <div className="text-sm font-medium text-slate-700 group-hover:text-blue-600 transition-colors">{proj.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{proj.id}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-semibold text-slate-700">{proj.hours}h</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="w-px h-full bg-slate-200/50"></div>

          <div className="flex-1 flex flex-col justify-center">
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-2">Demand Composition</h3>
              <div className="flex items-end gap-2 mb-4">
                <span className="text-3xl font-light text-slate-800">70%</span>
                <span className="text-sm text-slate-500 mb-1">Hard Allocations</span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-200 flex overflow-hidden">
                <div className="h-full bg-blue-600 w-[70%]"></div>
                <div className="h-full bg-blue-300 w-[30%]"></div>
              </div>
              <div className="flex justify-between text-xs text-slate-500 mt-2">
                <span>Hard (70%)</span>
                <span>Soft (30%)</span>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

export default Flow;