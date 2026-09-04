// @ts-nocheck -- design mockup, excluded from strict typecheck
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronLeft, Building2, Users, Activity, 
  Calendar as CalendarIcon, DollarSign, Home, MessageSquare, 
  Briefcase, Folder, FileText, ChevronDown, ChevronUp, AlertCircle, Clock
} from 'lucide-react';
import { 
  RadialBarChart, RadialBar, PolarAngleAxis, 
  PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

// Theme Colors
const theme = {
  bg: '#F5F9F0',
  ink: '#1B3035',
  green: '#8DC63F',
  muted: '#8A9E8A',
  border: '#E2EAD8',
  amber: '#E07A35',
  cream: '#FFFDF9'
};

const fadeUpVariant = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

export function EditorialPremium() {
  const [healthScore, setHealthScore] = useState(0);
  const [scheduleExpanded, setScheduleExpanded] = useState(true);
  const [teamExpanded, setTeamExpanded] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setHealthScore(80), 500);
    return () => clearTimeout(timer);
  }, []);

  const healthData = [{ name: 'Health', value: healthScore, fill: theme.ink }];
  
  const teamDisciplineData = [
    { name: 'Architecture', value: 40, fill: theme.ink },
    { name: 'MEP', value: 25, fill: theme.muted },
    { name: 'Structural', value: 20, fill: theme.border },
    { name: 'Cost', value: 15, fill: theme.green },
  ];

  const budgetData = [
    { month: 'Jan', target: 500, actual: 400 },
    { month: 'Feb', target: 1000, actual: 900 },
    { month: 'Mar', target: 1800, actual: 1600 },
    { month: 'Apr', target: 2500, actual: null },
    { month: 'May', target: 3800, actual: null },
  ];

  return (
    <div 
      className="relative mx-auto overflow-hidden flex flex-col font-sans"
      style={{ width: 390, height: 844, color: theme.ink, background: '#F5F9F0' }}
    >
      {/* CSS for custom fonts and 3D */}
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap');
        .font-serif { font-family: 'Playfair Display', serif; }
        .font-sans { font-family: 'Inter', sans-serif; }
        
        .hairline-b { border-bottom: 1px solid ${theme.border}; }
        .hairline-t { border-top: 1px solid ${theme.border}; }
        
        .preserve-3d { transform-style: preserve-3d; perspective: 1000px; }
      `}} />

      {/* Header */}
      <header className="px-6 pt-14 pb-6 hairline-b z-10 shrink-0" style={{ background: '#F5F9F0' }}>
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}
          className="flex items-center justify-between mb-6"
        >
          <button className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors">
            <ChevronLeft size={20} color={theme.ink} strokeWidth={1.5} />
          </button>
          <div className="flex gap-2 text-[10px] tracking-widest uppercase font-semibold">
            <span style={{ color: theme.muted }}>PRE-SCHEMATIC</span>
            <span style={{ color: theme.border }}>|</span>
            <span style={{ color: theme.ink }}>PMM</span>
          </div>
          <div className="w-8" /> {/* Spacer */}
        </motion.div>

        <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="space-y-4">
          <motion.h1 variants={fadeUpVariant} className="text-3xl font-serif font-semibold leading-tight tracking-tight">
            South Bay Cardio<br/>PET Reno
          </motion.h1>
          <motion.div variants={fadeUpVariant} className="flex items-center gap-2 text-sm" style={{ color: theme.muted }}>
            <Building2 size={14} strokeWidth={1.5} />
            <span>Catholic Health Services of Long Island</span>
          </motion.div>
          <motion.div variants={fadeUpVariant} className="text-xs uppercase tracking-widest font-medium" style={{ color: theme.muted }}>
            PMM-25-000165
          </motion.div>
        </motion.div>
      </header>

      {/* Main Scrollable Area */}
      <main className="flex-1 overflow-y-auto pb-24 preserve-3d">
        <motion.div 
          initial="hidden" animate="visible" variants={staggerContainer}
          className="p-6 space-y-10"
        >
          
          {/* Hero Stats - 3D Card */}
          <motion.div 
            variants={fadeUpVariant}
            whileHover={{ rotateX: 5, rotateY: -5, translateZ: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="p-6 rounded-sm relative"
            style={{ backgroundColor: theme.cream, border: `1px solid ${theme.border}`, boxShadow: '0 10px 30px -10px rgba(27,48,53,0.05)' }}
          >
            <div className="grid grid-cols-2 gap-6 relative z-10">
              <div>
                <div className="text-xs tracking-widest uppercase mb-2 font-medium" style={{ color: theme.muted }}>Health Verdict</div>
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-serif font-semibold">80</span>
                  <span className="text-sm mb-1 font-medium" style={{ color: theme.green }}>Healthy</span>
                </div>
              </div>
              <div className="pl-6" style={{ borderLeft: `1px solid ${theme.border}` }}>
                <div className="text-xs tracking-widest uppercase mb-2 font-medium" style={{ color: theme.muted }}>Team Size</div>
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-serif font-semibold">13</span>
                  <span className="text-sm mb-1 font-medium" style={{ color: theme.muted }}>6% util</span>
                </div>
              </div>
            </div>
            
            {/* Subtle radial chart background */}
            <div className="absolute -bottom-10 -right-10 opacity-[0.03] pointer-events-none" style={{ transform: 'translateZ(-10px)' }}>
              <RadialBarChart width={200} height={200} innerRadius="60%" outerRadius="100%" data={[{ value: 80, fill: theme.ink }]} startAngle={90} endAngle={-270}>
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background clockWise dataKey="value" cornerRadius={0} />
              </RadialBarChart>
            </div>
          </motion.div>

          {/* Project Health Detailed */}
          <motion.section variants={fadeUpVariant} className="space-y-6">
            <h2 className="text-xl font-serif font-semibold flex items-center justify-between hairline-b pb-4">
              <span>Project Health</span>
              <Activity size={18} color={theme.muted} strokeWidth={1.5} />
            </h2>
            
            <div className="flex items-center gap-6">
              <div className="w-24 h-24 relative shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart innerRadius="70%" outerRadius="100%" data={healthData} startAngle={90} endAngle={-270}>
                    <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                    <RadialBar background clockWise dataKey="value" cornerRadius={0} />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center font-serif text-2xl">
                  {healthScore}
                </div>
              </div>
              
              <div className="flex-1 space-y-3">
                <div className="p-3 bg-white border border-dashed text-sm flex items-start gap-3" style={{ borderColor: theme.amber }}>
                  <AlertCircle size={16} color={theme.amber} className="shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span style={{ color: theme.ink }}>Target completion date passed. Schedule impact likely.</span>
                </div>
              </div>
            </div>
          </motion.section>

          {/* Schedule */}
          <motion.section variants={fadeUpVariant} className="space-y-4">
            <div 
              className="flex items-center justify-between cursor-pointer hairline-b pb-4"
              onClick={() => setScheduleExpanded(!scheduleExpanded)}
            >
              <h2 className="text-xl font-serif font-semibold">Schedule</h2>
              {scheduleExpanded ? <ChevronUp size={20} color={theme.muted} strokeWidth={1.5} /> : <ChevronDown size={20} color={theme.muted} strokeWidth={1.5} />}
            </div>
            
            <AnimatePresence>
              {scheduleExpanded && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden space-y-6 pt-2"
                >
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-widest mb-1" style={{ color: theme.muted }}>Target</div>
                      <div>Mar 12, 2025 – Aug 30, 2026</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-widest mb-1" style={{ color: theme.muted }}>Actual</div>
                      <div>Apr 02, 2025 – <span className="opacity-50">Pending</span></div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-medium uppercase tracking-widest">
                      <span>Progress</span>
                      <span>42% (15/36 Mo)</span>
                    </div>
                    <div className="h-1 w-full bg-black/5 relative overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }} animate={{ width: '42%' }} transition={{ duration: 1, delay: 0.5 }}
                        className="absolute top-0 left-0 h-full" style={{ backgroundColor: theme.ink }}
                      />
                    </div>
                  </div>

                  {/* Simple Timeline SVG */}
                  <div className="pt-4 space-y-3">
                    <div className="text-xs uppercase tracking-widest font-medium" style={{ color: theme.muted }}>Phases</div>
                    <div className="relative h-8 flex text-[10px] font-medium">
                      <div className="h-full flex items-center justify-center border-r" style={{ width: '20%', backgroundColor: theme.ink, color: theme.cream, borderColor: theme.bg }}>Pre</div>
                      <div className="h-full flex items-center justify-center border-r border-y" style={{ width: '30%', backgroundColor: theme.cream, color: theme.ink, borderColor: theme.border }}>Schematic</div>
                      <div className="h-full flex items-center justify-center border-r border-y border-dashed" style={{ width: '25%', borderColor: theme.border, color: theme.muted }}>DD</div>
                      <div className="h-full flex items-center justify-center border-y border-dashed" style={{ width: '25%', borderColor: theme.border, color: theme.muted }}>CD</div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

          {/* Budget Snapshot */}
          <motion.section variants={fadeUpVariant} className="space-y-6">
            <h2 className="text-xl font-serif font-semibold flex items-center justify-between hairline-b pb-4">
              <span>Budget Overview</span>
              <DollarSign size={18} color={theme.muted} strokeWidth={1.5} />
            </h2>
            
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: theme.muted }}>Value</div>
                <div className="font-serif font-semibold text-lg">$4.2M</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: theme.muted }}>EAC</div>
                <div className="font-serif font-semibold text-lg">$3.8M</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: theme.muted }}>Spent</div>
                <div className="font-serif font-semibold text-lg">$1.6M</div>
              </div>
            </div>

            <div className="h-40 w-full" style={{ marginLeft: -15 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={budgetData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: theme.muted }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: theme.muted }} tickFormatter={(val) => `${val}k`} />
                  <Tooltip contentStyle={{ backgroundColor: theme.cream, border: `1px solid ${theme.border}`, borderRadius: 0, fontSize: 12 }} />
                  <Area type="step" dataKey="target" stroke={theme.border} fill="transparent" strokeDasharray="3 3" />
                  <Area type="step" dataKey="actual" stroke={theme.ink} fill={theme.ink} fillOpacity={0.05} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.section>

          {/* Project Team */}
          <motion.section variants={fadeUpVariant} className="space-y-4">
            <div 
              className="flex items-center justify-between cursor-pointer hairline-b pb-4"
              onClick={() => setTeamExpanded(!teamExpanded)}
            >
              <h2 className="text-xl font-serif font-semibold">Team</h2>
              {teamExpanded ? <ChevronUp size={20} color={theme.muted} strokeWidth={1.5} /> : <ChevronDown size={20} color={theme.muted} strokeWidth={1.5} />}
            </div>

            <AnimatePresence>
              {teamExpanded && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden space-y-8 pt-2"
                >
                  <div className="flex items-center gap-6">
                    <div className="w-20 h-20 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={teamDisciplineData} innerRadius="60%" outerRadius="100%" dataKey="value" stroke="none">
                            {teamDisciplineData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
                      {teamDisciplineData.map(d => (
                        <div key={d.name} className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                          <span className="truncate" style={{ color: theme.muted }}>{d.name}</span>
                          <span className="font-medium ml-auto">{d.value}%</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="text-xs uppercase tracking-widest font-medium" style={{ color: theme.muted }}>Key Personnel</div>
                    
                    {[
                      { name: 'Sarah Chen', role: 'Senior Project Manager', util: 80 },
                      { name: 'Marcus Reid', role: 'Lead Architect', util: 100 },
                      { name: 'Priya Patel', role: 'MEP Coordinator', util: 60 },
                      { name: 'James O\'Brien', role: 'Cost Estimator', util: 40 },
                    ].map((person, i) => (
                      <div key={i} className="flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-sm bg-black/5 flex items-center justify-center text-xs font-serif font-semibold">
                            {person.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-sm">{person.name}</div>
                            <div className="text-xs" style={{ color: theme.muted }}>{person.role}</div>
                          </div>
                        </div>
                        <div className="text-xs font-medium px-2 py-1 bg-black/5 rounded-sm">
                          {person.util}%
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex flex-wrap gap-2 pt-2">
                    <span className="text-[10px] uppercase tracking-widest font-medium px-3 py-1.5 border" style={{ borderColor: theme.ink, color: theme.ink }}>MEP (Lead)</span>
                    <span className="text-[10px] uppercase tracking-widest font-medium px-3 py-1.5 border" style={{ borderColor: theme.border, color: theme.muted }}>Architecture</span>
                    <span className="text-[10px] uppercase tracking-widest font-medium px-3 py-1.5 border" style={{ borderColor: theme.border, color: theme.muted }}>Structural</span>
                  </div>

                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

        </motion.div>
      </main>

      {/* Bottom Navigation */}
      <nav className="h-20 bg-white border-t flex items-center justify-around px-2 pb-4 shrink-0 relative z-20" style={{ borderColor: theme.border }}>
        {[
          { icon: Home, label: 'Home' },
          { icon: MessageSquare, label: 'Chat' },
          { icon: Briefcase, label: 'Projects', active: true },
          { icon: Folder, label: 'Resources' },
          { icon: FileText, label: 'RFP' }
        ].map((item, i) => (
          <button key={i} className="flex flex-col items-center gap-1 p-2 w-16">
            <item.icon size={20} color={item.active ? theme.ink : theme.muted} strokeWidth={item.active ? 2 : 1.5} />
            <span className="text-[10px] font-medium" style={{ color: item.active ? theme.ink : theme.muted }}>
              {item.label}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
