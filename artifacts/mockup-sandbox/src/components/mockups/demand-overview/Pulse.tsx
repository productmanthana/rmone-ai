import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertCircle, ArrowUpRight, Briefcase, Building2, Calendar, Clock, ChevronRight } from 'lucide-react';
import './_pulse.css';

const trendData = [
  { week: 'Jul 20', hours: 1480 },
  { week: 'Jul 27', hours: 1620 },
  { week: 'Aug 3', hours: 1390 },
  { week: 'Aug 10', hours: 1750 },
  { week: 'Aug 17', hours: 1980 },
  { week: 'Aug 24', hours: 1710 },
  { week: 'Aug 31', hours: 1450 },
  { week: 'Sep 7', hours: 1220 },
  { week: 'Sep 14', hours: 980 },
  { week: 'Sep 21', hours: 1100 },
  { week: 'Sep 28', hours: 860 },
  { week: 'Oct 5', hours: 720 },
];

const topRoles = [
  { role: 'Project Manager', hours: 320, positions: 8, max: 320 },
  { role: 'Civil Engineer', hours: 280, positions: 7, max: 320 },
  { role: 'Structural Engineer', hours: 240, positions: 6, max: 320 },
  { role: 'Construction Inspector', hours: 210, positions: 6, max: 320 },
  { role: 'Architect', hours: 180, positions: 5, max: 320 },
  { role: 'Estimator', hours: 140, positions: 4, max: 320 },
  { role: 'Surveyor', hours: 110, positions: 3, max: 320 },
];

const topProjects = [
  { project: 'Harbor Bridge Rehabilitation', id: 'PMM-22-000598', hours: 340, max: 340 },
  { project: 'Riverside Medical Campus', id: 'PMM-23-001022', hours: 280, max: 340 },
  { project: 'Metro Line Extension Phase 2', id: 'PMM-21-000431', hours: 260, max: 340 },
  { project: 'Lakefront Stadium Renewal', id: 'PMM-24-000105', hours: 190, max: 340 },
  { project: 'Downtown Transit Hub', id: 'PMM-23-000888', hours: 150, max: 340 },
];

function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = value;
    const duration = 1000;
    const increment = end / (duration / 16);
    
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        clearInterval(timer);
        setDisplayValue(end);
      } else {
        setDisplayValue(Math.floor(start));
      }
    }, 16);

    return () => clearInterval(timer);
  }, [value]);

  return <>{displayValue.toLocaleString()}</>;
}

export function Pulse() {
  return (
    <div className="pulse-wrapper min-h-screen p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-10">
        
        {/* Header */}
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-sm font-semibold tracking-widest uppercase text-[hsl(var(--pulse-text-muted))] mb-2">
              Weekly Demand Overview
            </h1>
            <h2 className="text-3xl font-bold tracking-tight">July 20 — 26, 2026</h2>
          </div>
          <div className="pulse-pill flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium">
            <Calendar className="w-4 h-4 text-[hsl(var(--pulse-text-muted))]" />
            <span>12-Week Forecast</span>
          </div>
        </header>

        {/* Hero Section */}
        <section className="pulse-card p-8 md:p-10 relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8 mb-10">
            <div>
              <p className="text-[hsl(var(--pulse-text-muted))] font-medium mb-4 flex items-center gap-2">
                Total Unfilled Demand <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-50 text-blue-600 text-xs">i</span>
              </p>
              <div className="flex items-baseline gap-4">
                <span className="pulse-hero-number text-7xl md:text-8xl font-bold tracking-tighter text-[hsl(var(--pulse-accent))]">
                  <AnimatedNumber value={1480} />
                </span>
                <span className="text-2xl font-medium text-[hsl(var(--pulse-text-muted))] pb-2">hrs</span>
              </div>
            </div>
            
            <div className="flex flex-col gap-4 min-w-[200px]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
                  <ArrowUpRight className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-500">+12%</div>
                  <div className="text-sm text-[hsl(var(--pulse-text-muted))] font-medium">vs last week</div>
                </div>
              </div>
              <div className="h-px w-full bg-[hsl(var(--pulse-border))] my-2"></div>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <Briefcase className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold">42</div>
                  <div className="text-sm text-[hsl(var(--pulse-text-muted))] font-medium">open positions</div>
                </div>
              </div>
            </div>
          </div>

          <div className="h-[200px] w-full -mx-4 md:mx-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--pulse-accent))" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(var(--pulse-accent))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="week" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: 'hsl(var(--pulse-text-muted))', fontSize: 12, fontWeight: 500 }}
                  dy={10}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                  labelStyle={{ color: 'hsl(var(--pulse-text-muted))', fontSize: '12px', marginBottom: '4px' }}
                  itemStyle={{ color: 'hsl(var(--pulse-text-main))', fontWeight: 'bold', fontSize: '16px' }}
                  formatter={(value) => [`${value} hrs`, 'Demand']}
                />
                <Area 
                  type="monotone" 
                  dataKey="hours" 
                  stroke="hsl(var(--pulse-accent))" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorHours)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Urgency KPIs */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="pulse-card p-6 flex items-center justify-between group cursor-pointer hover:border-red-200 transition-colors">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
                <AlertCircle className="w-7 h-7 text-red-500" />
              </div>
              <div>
                <div className="text-3xl font-bold text-red-600 mb-1">6</div>
                <div className="font-medium text-[hsl(var(--pulse-text-muted))]">Positions Overdue</div>
              </div>
            </div>
            <ChevronRight className="w-6 h-6 text-gray-300 group-hover:text-red-400 transition-colors" />
          </div>
          
          <div className="pulse-card p-6 flex items-center justify-between group cursor-pointer hover:border-orange-200 transition-colors">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center">
                <Clock className="w-7 h-7 text-orange-500" />
              </div>
              <div>
                <div className="text-3xl font-bold text-orange-600 mb-1">11</div>
                <div className="font-medium text-[hsl(var(--pulse-text-muted))]">Starting in ≤ 14 Days</div>
              </div>
            </div>
            <ChevronRight className="w-6 h-6 text-gray-300 group-hover:text-orange-400 transition-colors" />
          </div>
        </section>

        {/* Drivers */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 pt-4">
          
          {/* Top Roles */}
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-8 rounded-lg bg-[hsl(var(--pulse-surface))] border border-[hsl(var(--pulse-border))] flex items-center justify-center">
                <Briefcase className="w-4 h-4 text-[hsl(var(--pulse-text-muted))]" />
              </div>
              <h3 className="text-xl font-semibold">Top Roles in Demand</h3>
            </div>
            
            <div className="space-y-6">
              {topRoles.map((item, i) => (
                <div key={i} className="group cursor-default">
                  <div className="flex justify-between text-sm mb-2 font-medium">
                    <span className="text-[hsl(var(--pulse-text-main))]">{item.role}</span>
                    <span className="text-[hsl(var(--pulse-text-muted))]">{item.hours}h <span className="text-gray-300 mx-1">|</span> {item.positions} pos</span>
                  </div>
                  <div className="h-2.5 w-full bg-[hsl(var(--pulse-surface))] rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(item.hours / item.max) * 100}%` }}
                      transition={{ duration: 1, delay: i * 0.1, ease: "easeOut" }}
                      className="h-full bg-[hsl(var(--pulse-accent))] rounded-full opacity-80 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Projects */}
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-8 rounded-lg bg-[hsl(var(--pulse-surface))] border border-[hsl(var(--pulse-border))] flex items-center justify-center">
                <Building2 className="w-4 h-4 text-[hsl(var(--pulse-text-muted))]" />
              </div>
              <h3 className="text-xl font-semibold">Top Projects</h3>
            </div>
            
            <div className="space-y-6">
              {topProjects.map((item, i) => (
                <div key={i} className="group cursor-default">
                  <div className="flex justify-between text-sm mb-1 font-medium">
                    <span className="text-[hsl(var(--pulse-text-main))] truncate pr-4">{item.project}</span>
                    <span className="text-[hsl(var(--pulse-text-muted))] whitespace-nowrap">{item.hours}h</span>
                  </div>
                  <div className="text-xs text-[hsl(var(--pulse-text-muted))] mb-2">{item.id}</div>
                  <div className="h-2.5 w-full bg-[hsl(var(--pulse-surface))] rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(item.hours / item.max) * 100}%` }}
                      transition={{ duration: 1, delay: i * 0.1, ease: "easeOut" }}
                      className="h-full bg-[hsl(var(--pulse-text-main))] rounded-full opacity-70 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </section>

      </div>
    </div>
  );
}
