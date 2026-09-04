import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, ReferenceLine, Tooltip as RechartsTooltip } from 'recharts';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowUpRight, Clock, Building2, Briefcase, Activity, CalendarDays, TrendingUp, TriangleAlert } from 'lucide-react';
import './_skyline.css';

const MOCK_DATA = [
  { week: 'Jul 20', total: 1480, hard: 1036, soft: 444, isCurrent: true, isPeak: false },
  { week: 'Jul 27', total: 1620, hard: 1134, soft: 486, isCurrent: false, isPeak: false },
  { week: 'Aug 3', total: 1390, hard: 973, soft: 417, isCurrent: false, isPeak: false },
  { week: 'Aug 10', total: 1750, hard: 1225, soft: 525, isCurrent: false, isPeak: false },
  { week: 'Aug 17', total: 1980, hard: 1386, soft: 594, isCurrent: false, isPeak: true },
  { week: 'Aug 24', total: 1710, hard: 1197, soft: 513, isCurrent: false, isPeak: false },
  { week: 'Aug 31', total: 1450, hard: 1015, soft: 435, isCurrent: false, isPeak: false },
  { week: 'Sep 7', total: 1220, hard: 854, soft: 366, isCurrent: false, isPeak: false },
  { week: 'Sep 14', total: 980, hard: 686, soft: 294, isCurrent: false, isPeak: false },
  { week: 'Sep 21', total: 1100, hard: 770, soft: 330, isCurrent: false, isPeak: false },
  { week: 'Sep 28', total: 860, hard: 602, soft: 258, isCurrent: false, isPeak: false },
  { week: 'Oct 5', total: 720, hard: 504, soft: 216, isCurrent: false, isPeak: false },
];

const ROLES = [
  { name: 'Project Manager', hrs: 320, pos: 8 },
  { name: 'Civil Engineer', hrs: 280, pos: 7 },
  { name: 'Structural Engineer', hrs: 240, pos: 6 },
  { name: 'Construction Inspector', hrs: 210, pos: 6 },
  { name: 'Architect', hrs: 180, pos: 5 },
  { name: 'Estimator', hrs: 140, pos: 4 },
  { name: 'Surveyor', hrs: 110, pos: 3 },
];

const PROJECTS = [
  { name: 'Harbor Bridge Rehabilitation', id: 'PMM-22-000598', hrs: 340 },
  { name: 'Riverside Medical Campus', id: 'PMM-23-001004', hrs: 280 },
  { name: 'Metro Line Extension Phase 2', id: 'PMM-24-000210', hrs: 260 },
  { name: 'Lakefront Stadium Renewal', id: 'PMM-24-000450', hrs: 190 },
  { name: 'Downtown Transit Hub', id: 'PMM-24-000880', hrs: 150 },
];

const formatNum = (num: number) => num.toLocaleString('en-US');

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="skyline-glass p-5 rounded-2xl w-64">
        <h4 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-slate-500" />
          Week of {label}
          {data.isCurrent && <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">Current</span>}
          {data.isPeak && <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">Peak</span>}
        </h4>
        
        <div className="space-y-4">
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-sm font-medium text-slate-900">{formatNum(data.total)} hrs</span>
              <span className="text-xs text-slate-500">Total Demand</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
              <div className="h-full bg-blue-600" style={{ width: `${(data.hard / data.total) * 100}%` }}></div>
              <div className="h-full bg-blue-300" style={{ width: `${(data.soft / data.total) * 100}%` }}></div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
            <div>
              <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-600"></div> Hard</div>
              <div className="text-sm font-medium text-slate-900">{formatNum(Math.round(data.hard))} <span className="text-xs text-slate-400 font-normal">hrs</span></div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-300"></div> Soft</div>
              <div className="text-sm font-medium text-slate-900">{formatNum(Math.round(data.soft))} <span className="text-xs text-slate-400 font-normal">hrs</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

export function Skyline() {
  return (
    <div className="min-h-screen bg-[#fafafa] font-sans text-slate-900 selection:bg-blue-200">
      
      {/* Top Stat Strip */}
      <header className="bg-white border-b border-slate-200/60 sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold tracking-tighter shadow-sm">RM</div>
              <h1 className="font-semibold text-slate-900">Demand Overview</h1>
            </div>
            <div className="h-4 w-px bg-slate-200"></div>
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-sm font-medium text-slate-700">Live Snapshot</span>
                <span className="text-sm text-slate-400">As of Jul 17, 2026</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-md hover:bg-slate-50 transition-colors">Export CSV</button>
            <button className="text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 px-4 py-1.5 rounded-lg shadow-sm transition-colors">View All Positions</button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-8 h-[calc(100vh-4rem)] flex flex-col">
        
        {/* The Hero Stats */}
        <div className="grid grid-cols-12 gap-8 mb-8 flex-none">
          <div className="col-span-5 flex flex-col justify-center">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-2">This Week</h2>
            <div className="flex items-baseline gap-4 mb-2">
              <span className="text-6xl font-black tracking-tight skyline-text-gradient-accent">{formatNum(1480)}</span>
              <span className="text-xl font-medium text-slate-500">unfilled hours</span>
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md text-sm font-semibold border border-emerald-100">
                <TrendingUp className="w-4 h-4" />
                <span>+12% vs last week</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-600 text-sm font-medium">
                <Briefcase className="w-4 h-4 text-slate-400" />
                <span>42 open positions</span>
              </div>
            </div>
          </div>

          <div className="col-span-7 flex gap-4">
            <div className="flex-1 bg-white rounded-2xl border border-slate-200/60 p-5 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <AlertCircle className="w-24 h-24 text-rose-600 -mt-6 -mr-6" />
              </div>
              <div className="flex items-center gap-2 text-rose-600 font-semibold mb-3">
                <TriangleAlert className="w-5 h-5" />
                Urgent Action Needed
              </div>
              <div className="flex gap-8">
                <div>
                  <div className="text-3xl font-black text-slate-900 mb-1">6</div>
                  <div className="text-sm text-slate-500">positions overdue</div>
                </div>
                <div className="w-px bg-slate-100 my-1"></div>
                <div>
                  <div className="text-3xl font-black text-slate-900 mb-1">11</div>
                  <div className="text-sm text-slate-500">starting in ≤14 days</div>
                </div>
              </div>
            </div>

            <div className="flex-1 bg-white rounded-2xl border border-slate-200/60 p-5 shadow-sm flex flex-col justify-center">
               <div className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Top Drivers</div>
               <div className="space-y-3">
                 <div className="flex items-center justify-between">
                   <div className="flex items-center gap-2 text-sm text-slate-700">
                     <Building2 className="w-4 h-4 text-slate-400" />
                     <span className="font-medium truncate max-w-[180px]">Harbor Bridge Rehab</span>
                   </div>
                   <span className="text-sm font-semibold text-slate-900">340h</span>
                 </div>
                 <div className="flex items-center justify-between">
                   <div className="flex items-center gap-2 text-sm text-slate-700">
                     <Briefcase className="w-4 h-4 text-slate-400" />
                     <span className="font-medium truncate max-w-[180px]">Project Manager</span>
                   </div>
                   <span className="text-sm font-semibold text-slate-900">320h</span>
                 </div>
               </div>
            </div>
          </div>
        </div>

        {/* The Skyline Chart */}
        <div className="flex-1 bg-white rounded-3xl border border-slate-200/60 shadow-sm p-8 relative flex flex-col">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h3 className="text-xl font-bold text-slate-900">The Demand Skyline</h3>
              <p className="text-slate-500 mt-1">12-week forward view of unfilled hours</p>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-blue-600"></div>
                <span className="text-sm text-slate-600 font-medium">Hard Demand (70%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-blue-300"></div>
                <span className="text-sm text-slate-600 font-medium">Soft Demand (30%)</span>
              </div>
            </div>
          </div>

          <div className="flex-1 w-full min-h-[300px] skyline-chart-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={MOCK_DATA} margin={{ top: 40, right: 0, left: 0, bottom: 0 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis 
                  dataKey="week" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 13, fontWeight: 500 }} 
                  dy={16}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#94a3b8', fontSize: 13 }} 
                  dx={-10}
                />
                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
                
                <ReferenceLine 
                  x="Aug 17" 
                  stroke="#f59e0b" 
                  strokeDasharray="4 4" 
                  label={{ position: 'top', value: 'Peak: 1,980 hrs', fill: '#d97706', fontSize: 12, fontWeight: 600, dy: -10 }} 
                />
                
                <Bar dataKey="hard" stackId="a" radius={[0, 0, 4, 4]}>
                  {MOCK_DATA.map((entry, index) => (
                    <Cell 
                      key={`cell-hard-${index}`} 
                      fill={entry.isCurrent ? '#1d4ed8' : entry.isPeak ? '#b45309' : '#2563eb'} 
                    />
                  ))}
                </Bar>
                <Bar dataKey="soft" stackId="a" radius={[4, 4, 0, 0]}>
                  {MOCK_DATA.map((entry, index) => (
                    <Cell 
                      key={`cell-soft-${index}`} 
                      fill={entry.isCurrent ? '#60a5fa' : entry.isPeak ? '#f59e0b' : '#93c5fd'} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Footer Role Chips */}
        <div className="mt-6 pt-6 border-t border-slate-200/60 flex-none">
          <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-hide">
            <span className="text-sm font-semibold text-slate-500 whitespace-nowrap flex-none uppercase tracking-wider">Top Roles in Demand:</span>
            {ROLES.map(role => (
              <div key={role.name} className="flex-none flex items-center gap-2 bg-white border border-slate-200 rounded-full pl-3 pr-4 py-1.5 hover:border-slate-300 transition-colors cursor-pointer group">
                <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">{role.name}</span>
                <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                <span className="text-xs font-semibold text-blue-600">{role.hrs}h</span>
                <span className="text-xs text-slate-400">({role.pos})</span>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}
