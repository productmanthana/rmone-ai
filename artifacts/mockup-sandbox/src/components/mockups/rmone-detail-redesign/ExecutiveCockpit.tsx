import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  RadialBarChart, RadialBar, PolarAngleAxis,
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  AreaChart, Area, CartesianGrid, ReferenceLine
} from 'recharts';
import { 
  ChevronLeft, MoreVertical, Building2, Calendar, 
  Users, DollarSign, Activity, AlertTriangle,
  ChevronDown, ChevronUp, Home, MessageSquare, 
  FolderKanban, BookOpen, FileText, CheckCircle2
} from 'lucide-react';

const COLORS = {
  bg: '#E7F0D6',
  bgGradient: '#F5F9F0',
  text: '#1B3035',
  muted: '#8A9E8A',
  border: '#E2EAD8',
  green: '#8DC63F',
  greenDark: '#6BA02B',
  amber: '#E07A35',
  cardBg: '#FFFFFF',
  chartGrid: '#E2EAD8'
};

const CHART_COLORS = ['#8DC63F', '#609B2B', '#A8D66D', '#C4E39A'];

const teamData = [
  { name: 'Architecture', value: 40 },
  { name: 'MEP', value: 25 },
  { name: 'Structural', value: 20 },
  { name: 'Cost', value: 15 },
];

const budgetData = [
  { month: 'Jan', spent: 0.2, target: 0.3 },
  { month: 'Feb', spent: 0.5, target: 0.6 },
  { month: 'Mar', spent: 0.9, target: 0.9 },
  { month: 'Apr', spent: 1.2, target: 1.2 },
  { month: 'May', spent: 1.6, target: 1.5 }, // slight overburn
];

const scheduleData = [
  { name: 'Pre-Sch', actual: 100, target: 100 },
  { name: 'Schematic', actual: 40, target: 100 },
  { name: 'Design Dev', actual: 0, target: 100 },
  { name: 'Const Doc', actual: 0, target: 100 },
  { name: 'Bid', actual: 0, target: 100 },
];

export function ExecutiveCockpit() {
  const [healthScore, setHealthScore] = useState(0);
  const [expandedSection, setExpandedSection] = useState<string | null>('schedule');

  useEffect(() => {
    const timer = setTimeout(() => {
      setHealthScore(80);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { 
      y: 0, 
      opacity: 1,
      transition: { type: 'spring' as const, stiffness: 300, damping: 24 }
    }
  };

  return (
    <div 
      className="relative mx-auto text-[#1B3035] overflow-hidden shadow-2xl"
      style={{ background: COLORS.bgGradient, width: 390, height: 844, fontFamily: 'system-ui, sans-serif' }}
    >
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#E7F0D6]/95 backdrop-blur-md border-b border-[#E2EAD8] px-4 pt-12 pb-3">
        <div className="flex items-center justify-between mb-3">
          <button className="p-2 -ml-2 text-[#1B3035]">
            <ChevronLeft size={24} />
          </button>
          <div className="flex gap-2">
            <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#8DC63F] bg-[#8DC63F]/10 rounded border border-[#8DC63F]/20">
              PRE-SCHEMATIC
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider text-white bg-[#1B3035] rounded">
              PMM
            </span>
          </div>
          <button className="p-2 -mr-2 text-[#1B3035]">
            <MoreVertical size={24} />
          </button>
        </div>
        <h1 className="text-xl font-bold leading-tight mb-1">
          CHSLI/CRCD - South Bay Cardio PET Reno
        </h1>
        <p className="text-xs text-[#8A9E8A] font-mono mb-2">PMM-25-000165</p>
        <div className="flex items-center gap-1.5 text-xs font-medium text-[#1B3035]">
          <Building2 size={14} className="text-[#8DC63F]" />
          Catholic Health Services of Long Island
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="h-[calc(100%-140px)] overflow-y-auto overflow-x-hidden pb-24 px-4 pt-4 hide-scrollbar perspective-[1000px]">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-col gap-4 transform-style-3d"
        >
          {/* Health Ring 3D Card */}
          <motion.div 
            variants={itemVariants}
            className="bg-white rounded-2xl p-5 border border-[#E2EAD8] shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative preserve-3d"
            whileHover={{ rotateX: 5, rotateY: -5 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#8A9E8A] flex items-center gap-1.5">
                  <Activity size={14} /> Project Health
                </h2>
              </div>
              <div className="flex items-center gap-1 text-xs font-bold text-[#8DC63F] bg-[#8DC63F]/10 px-2 py-1 rounded">
                <CheckCircle2 size={12} /> HEALTHY
              </div>
            </div>

            <div className="flex items-center justify-center h-[180px] mt-2 translate-z-12">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart 
                  cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" 
                  barSize={16} data={[{ name: 'Score', value: healthScore }]} 
                  startAngle={180} endAngle={-180}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar 
                    background={{ fill: '#F5F9F0' }} 
                    dataKey="value" 
                    cornerRadius={8}
                    fill="#8DC63F"
                  />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center translate-z-20 pointer-events-none">
                <span className="text-4xl font-black tabular-nums tracking-tighter">{healthScore}</span>
                <span className="text-[10px] uppercase font-bold text-[#8A9E8A]">Score</span>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 bg-[#FFF4ED] border border-[#FAD7C4] text-[#E07A35] p-3 rounded-xl text-xs translate-z-8">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <p className="font-medium leading-tight">Target completion date passed. Schedule adjustment needed.</p>
            </div>
          </motion.div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <motion.div variants={itemVariants} className="bg-white p-4 rounded-2xl border border-[#E2EAD8] shadow-sm">
              <div className="flex items-center gap-1.5 text-[#8A9E8A] mb-1">
                <Users size={14} /> <span className="text-xs font-bold uppercase">Team</span>
              </div>
              <div className="text-2xl font-black mb-0.5">13</div>
              <div className="text-[10px] font-medium text-[#8A9E8A]">6% avg utilization</div>
            </motion.div>
            <motion.div variants={itemVariants} className="bg-white p-4 rounded-2xl border border-[#E2EAD8] shadow-sm">
              <div className="flex items-center gap-1.5 text-[#8A9E8A] mb-1">
                <DollarSign size={14} /> <span className="text-xs font-bold uppercase">Value</span>
              </div>
              <div className="text-2xl font-black mb-0.5">$4.2M</div>
              <div className="text-[10px] font-medium text-[#8DC63F]">+12% margin</div>
            </motion.div>
          </div>

          {/* Schedule */}
          <motion.div variants={itemVariants} className="bg-white rounded-2xl border border-[#E2EAD8] shadow-sm overflow-hidden">
            <button 
              className="w-full p-4 flex items-center justify-between bg-white text-left"
              onClick={() => toggleSection('schedule')}
            >
              <h2 className="text-sm font-bold uppercase tracking-wider text-[#1B3035] flex items-center gap-2">
                <Calendar size={16} className="text-[#8A9E8A]" /> Schedule Risk
              </h2>
              {expandedSection === 'schedule' ? <ChevronUp size={16} className="text-[#8A9E8A]" /> : <ChevronDown size={16} className="text-[#8A9E8A]" />}
            </button>
            <AnimatePresence>
              {expandedSection === 'schedule' && (
                <motion.div 
                  initial={{ height: 0 }} 
                  animate={{ height: 'auto' }} 
                  exit={{ height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 border-t border-[#F5F9F0] pt-4">
                    <div className="flex justify-between text-xs mb-4">
                      <div>
                        <div className="text-[#8A9E8A] mb-1">Target</div>
                        <div className="font-mono font-medium">Mar 25 – Aug 26</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[#8A9E8A] mb-1">Actual</div>
                        <div className="font-mono font-medium text-[#E07A35]">Apr 25 – TBD</div>
                      </div>
                    </div>
                    
                    <div className="mb-2 flex justify-between items-end">
                      <span className="text-xs font-bold">Progress</span>
                      <span className="text-xs font-mono font-bold text-[#8DC63F]">42%</span>
                    </div>
                    <div className="h-1.5 w-full bg-[#F5F9F0] rounded-full overflow-hidden mb-6">
                      <motion.div 
                        initial={{ width: 0 }} 
                        animate={{ width: '42%' }} 
                        transition={{ delay: 0.5, duration: 1 }}
                        className="h-full bg-[#8DC63F] rounded-full"
                      />
                    </div>

                    <div className="h-[120px] -mx-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart layout="vertical" data={scheduleData} margin={{ top: 0, right: 20, left: 0, bottom: 0 }} barSize={8}>
                          <XAxis type="number" hide />
                          <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8A9E8A' }} width={80} />
                          <Bar dataKey="target" stackId="a" fill="#F5F9F0" radius={[0, 4, 4, 0]} />
                          <Bar dataKey="actual" stackId="a" fill="#8DC63F" radius={[0, 4, 4, 0]} style={{ transform: 'translateX(-100%)' }} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Budget */}
          <motion.div variants={itemVariants} className="bg-white rounded-2xl border border-[#E2EAD8] shadow-sm overflow-hidden">
            <button 
              className="w-full p-4 flex items-center justify-between bg-white text-left"
              onClick={() => toggleSection('budget')}
            >
              <h2 className="text-sm font-bold uppercase tracking-wider text-[#1B3035] flex items-center gap-2">
                <DollarSign size={16} className="text-[#8A9E8A]" /> Budget Burn
              </h2>
              {expandedSection === 'budget' ? <ChevronUp size={16} className="text-[#8A9E8A]" /> : <ChevronDown size={16} className="text-[#8A9E8A]" />}
            </button>
            <AnimatePresence>
              {(expandedSection === 'budget' || expandedSection === null) && (
                <motion.div 
                  initial={{ height: 0 }} 
                  animate={{ height: 'auto' }} 
                  exit={{ height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 border-t border-[#F5F9F0] pt-4">
                    <div className="flex gap-4 mb-6">
                      <div className="flex-1">
                        <div className="text-[10px] uppercase font-bold text-[#8A9E8A] mb-1">EAC</div>
                        <div className="text-lg font-mono font-bold">$3.8M</div>
                      </div>
                      <div className="flex-1">
                        <div className="text-[10px] uppercase font-bold text-[#8A9E8A] mb-1">Spent</div>
                        <div className="text-lg font-mono font-bold text-[#E07A35]">$1.6M</div>
                      </div>
                    </div>
                    
                    <div className="h-[140px] -ml-4 -mr-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={budgetData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorSpent" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#E07A35" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#E07A35" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2EAD8" />
                          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8A9E8A' }} dy={10} />
                          <Area type="monotone" dataKey="target" stroke="#8A9E8A" strokeDasharray="4 4" fill="none" strokeWidth={2} />
                          <Area type="monotone" dataKey="spent" stroke="#E07A35" fillOpacity={1} fill="url(#colorSpent)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Team Breakdown */}
          <motion.div variants={itemVariants} className="bg-white rounded-2xl border border-[#E2EAD8] shadow-sm overflow-hidden mb-6">
            <button 
              className="w-full p-4 flex items-center justify-between bg-white text-left"
              onClick={() => toggleSection('team')}
            >
              <h2 className="text-sm font-bold uppercase tracking-wider text-[#1B3035] flex items-center gap-2">
                <Users size={16} className="text-[#8A9E8A]" /> Resources
              </h2>
              {expandedSection === 'team' ? <ChevronUp size={16} className="text-[#8A9E8A]" /> : <ChevronDown size={16} className="text-[#8A9E8A]" />}
            </button>
            <AnimatePresence>
              {(expandedSection === 'team' || expandedSection === null) && (
                <motion.div 
                  initial={{ height: 0 }} 
                  animate={{ height: 'auto' }} 
                  exit={{ height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 border-t border-[#F5F9F0] pt-4">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-[100px] h-[100px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={teamData}
                              cx="50%" cy="50%" innerRadius={30} outerRadius={45}
                              paddingAngle={2} dataKey="value" stroke="none"
                            >
                              {teamData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        {teamData.map((d, i) => (
                          <div key={d.name} className="flex items-center gap-1.5 text-xs font-medium">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            {d.name}
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      {[
                        { name: 'Sarah Chen', role: 'Sr PM', load: 80, b: true },
                        { name: 'Marcus Reid', role: 'Lead Arch', load: 100, b: true, warn: true },
                        { name: 'Priya Patel', role: 'MEP Coord', load: 60, b: false },
                        { name: "James O'Brien", role: 'Estimator', load: 40, b: false }
                      ].map((member, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#F5F9F0] text-[#1B3035] flex items-center justify-center font-bold text-xs">
                              {member.name.charAt(0)}{member.name.split(' ')[1]?.charAt(0)}
                            </div>
                            <div>
                              <div className={`font-medium ${member.warn ? 'text-[#E07A35]' : 'text-[#1B3035]'}`}>{member.name}</div>
                              <div className="text-[10px] text-[#8A9E8A]">{member.role}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`font-mono font-bold text-xs ${member.warn ? 'text-[#E07A35]' : 'text-[#1B3035]'}`}>
                              {member.load}%
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

        </motion.div>
      </div>

      {/* Bottom Nav */}
      <div className="absolute bottom-0 w-full bg-white border-t border-[#E2EAD8] pb-safe pt-2 px-6 flex justify-between items-center shadow-[0_-10px_20px_rgb(0,0,0,0.03)] z-20">
        {[
          { icon: Home, label: 'Home' },
          { icon: MessageSquare, label: 'Chat' },
          { icon: FolderKanban, label: 'Projects', active: true },
          { icon: BookOpen, label: 'Resources' },
          { icon: FileText, label: 'RFP' }
        ].map((item, i) => (
          <button key={i} className={`flex flex-col items-center gap-1 p-2 ${item.active ? 'text-[#8DC63F]' : 'text-[#8A9E8A]'}`}>
            <item.icon size={20} className={item.active ? 'fill-[#8DC63F]/20' : ''} />
            <span className="text-[9px] font-bold tracking-wide">{item.label}</span>
          </button>
        ))}
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .preserve-3d { transform-style: preserve-3d; }
        .translate-z-8 { transform: translateZ(8px); }
        .translate-z-12 { transform: translateZ(12px); }
        .translate-z-20 { transform: translateZ(20px); }
      `}} />
    </div>
  );
}

export default ExecutiveCockpit;
