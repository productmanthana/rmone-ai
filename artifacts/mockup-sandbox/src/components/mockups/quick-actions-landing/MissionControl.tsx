import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Terminal, 
  Activity, 
  AlertTriangle, 
  Users, 
  Briefcase, 
  Server, 
  Clock, 
  ArrowRight,
  Database,
  Crosshair,
  Zap
} from 'lucide-react';
import './MissionControl.css';

const MissionControl = () => {
  const [time, setTime] = useState(new Date().toISOString());
  const [searchValue, setSearchValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toISOString());
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const opsLog = [
    { time: '14:22:01', type: 'UPDATE', target: 'PMM-26-000010', desc: 'Status shifted to ACTIVE' },
    { time: '14:21:45', type: 'ALLOC', target: 'Sarah Jenkins', desc: 'Assigned to Riverside Medical' },
    { time: '14:20:12', type: 'NOTE', target: 'OPM-25-000023', desc: 'Site access delayed by 2 days' },
    { time: '14:18:55', type: 'SYSTEM', target: 'DATA_SYNC', desc: 'ERP sync completed successfully' },
    { time: '14:15:30', type: 'UPDATE', target: 'PRJ-9202', desc: 'Phase 2 dates adjusted' },
    { time: '14:12:11', type: 'ALERT', target: 'Harbor Point', desc: 'Electrical Estimator unassigned' },
    { time: '14:10:05', type: 'ALLOC', target: 'David Chen', desc: 'Extended on Transit Hub' },
    { time: '14:05:22', type: 'NOTE', target: 'PMM-26-000010', desc: 'Client requested budget review' },
  ];

  return (
    <div className="mc-theme min-h-screen relative overflow-hidden flex flex-col">
      {/* Background Elements */}
      <div className="absolute inset-0 mc-grid-bg"></div>
      <div className="absolute inset-0 mc-vignette z-0"></div>
      <div className="mc-scanline"></div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-[#142E18] bg-[#030805]/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded bg-[#4E8A22] flex items-center justify-center mc-node-glow">
            <Terminal size={18} className="text-[#030805]" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-[0.2em] text-[#E4F4E7] leading-none">RM ONE</h1>
            <p className="text-[10px] uppercase tracking-widest text-[#6B9475] mc-mono mt-1">Operational Intelligence</p>
          </div>
        </div>

        <div className="flex items-center gap-6 mc-mono text-xs">
          <div className="flex items-center gap-2 text-[#6BE329]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#6BE329] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#6BE329]"></span>
            </span>
            SYSTEM ONLINE
          </div>
          <div className="flex items-center gap-2 text-[#6B9475] border-l border-[#142E18] pl-6">
            <Server size={14} />
            <span>LATENCY: 12ms</span>
          </div>
          <div className="flex items-center gap-2 text-[#E4F4E7] border-l border-[#142E18] pl-6 w-56">
            <Clock size={14} className="text-[#4E8A22]" />
            <span>{time.replace('T', ' ').substring(0, 23)}Z</span>
          </div>
        </div>
      </header>

      {/* Top Ticker */}
      <div className="relative z-10 border-b border-[#142E18] bg-[#071109] py-1 text-[10px] mc-mono text-[#6B9475] flex items-center px-4">
        <div className="uppercase tracking-widest text-[#4E8A22] font-bold mr-4 shrink-0">Global Feed //</div>
        <div className="mc-ticker-wrap flex-1">
          <div className="mc-ticker-content flex gap-8">
            {/* Double the content for smooth infinite scrolling */}
            {[...Array(2)].map((_, i) => (
              <React.Fragment key={i}>
                <span className="flex items-center gap-2"><span className="text-[#E3A829]">●</span> Harbor Point Substation: Critical path delayed</span>
                <span className="flex items-center gap-2"><span className="text-[#6BE329]">●</span> Riverside Medical Tower: 100% staffed for next 14 days</span>
                <span className="flex items-center gap-2"><span className="text-[#E34A29]">●</span> 3 Projects require immediate assignment</span>
                <span className="flex items-center gap-2"><span className="text-[#4E8A22]">●</span> 42 Active Projects tracked</span>
                <span className="flex items-center gap-2"><span className="text-[#299DE3]">●</span> OPM-25-000023 converted to WON</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <main className="relative z-10 flex-1 grid grid-cols-12 gap-6 p-6 overflow-hidden">
        
        {/* LEFT COLUMN: Operations & Warnings */}
        <div className="col-span-3 flex flex-col gap-6">
          <div className="mc-panel flex-1 rounded border border-[#142E18] flex flex-col relative overflow-hidden">
            <div className="p-3 border-b border-[#142E18] bg-[#050B07] flex justify-between items-center">
              <h2 className="mc-mono text-xs text-[#6B9475] uppercase tracking-wider flex items-center gap-2">
                <Activity size={14} className="text-[#4E8A22]" />
                Live Operations
              </h2>
              <span className="text-[10px] text-[#4E8A22] mc-mono">UPDATING</span>
            </div>
            <div className="p-4 flex-1 overflow-y-auto mc-scrollbar">
              <div className="flex flex-col gap-3">
                {opsLog.map((log, i) => (
                  <div key={i} className="flex gap-3 text-xs group cursor-default">
                    <div className="text-[#4E8A22] mc-mono shrink-0 pt-0.5">{log.time}</div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border mc-mono
                          ${log.type === 'UPDATE' ? 'text-[#299DE3] border-[#299DE3]/30 bg-[#299DE3]/10' : 
                            log.type === 'ALERT' ? 'text-[#E34A29] border-[#E34A29]/30 bg-[#E34A29]/10' :
                            log.type === 'ALLOC' ? 'text-[#E3A829] border-[#E3A829]/30 bg-[#E3A829]/10' :
                            'text-[#6BE329] border-[#6BE329]/30 bg-[#6BE329]/10'
                          }`}>
                          {log.type}
                        </span>
                        <span className="font-medium text-[#E4F4E7]">{log.target}</span>
                      </div>
                      <div className="text-[#6B9475] text-[11px] leading-tight group-hover:text-[#E4F4E7] transition-colors">{log.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mc-panel h-48 rounded border border-[#E34A29]/30 bg-[#1A0B09]/80 flex flex-col">
            <div className="p-3 border-b border-[#E34A29]/30 bg-[#26100D] flex items-center gap-2">
              <AlertTriangle size={14} className="text-[#E34A29]" />
              <h2 className="mc-mono text-xs text-[#E34A29] uppercase tracking-wider">Critical Anomalies</h2>
            </div>
            <div className="p-4 flex-1 flex flex-col justify-center">
              <div className="flex items-start gap-4 mb-4">
                <div className="text-4xl font-light text-[#E34A29] mc-mono leading-none">3</div>
                <div>
                  <div className="text-sm font-medium text-[#F4D4CE]">Jobs with zero headcount</div>
                  <div className="text-xs text-[#E34A29]/70 mt-1">Action required immediately</div>
                </div>
              </div>
              <div className="text-[10px] mc-mono text-[#E34A29]/50 flex justify-between border-t border-[#E34A29]/20 pt-2">
                <span>PRJ-9202</span>
                <span>PRJ-9188</span>
                <span>OPM-25-000014</span>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: Command Line & Flow */}
        <div className="col-span-6 flex flex-col items-center justify-center gap-12 relative">
          
          <div className="w-full max-w-2xl relative z-10">
            <div className="text-center mb-6">
              <h2 className="text-3xl font-light tracking-widest text-[#E4F4E7] mb-2 uppercase">Command Center</h2>
              <p className="text-sm text-[#4E8A22] mc-mono uppercase">Query internal intelligence network</p>
            </div>
            
            <div className={`relative transition-all duration-300 ${isFocused ? 'scale-105' : 'scale-100'}`}>
              {/* Decorative brackets */}
              <div className={`absolute -left-4 top-0 bottom-0 w-2 border-l-2 border-t-2 border-b-2 transition-colors duration-300 ${isFocused ? 'border-[#6BE329]' : 'border-[#4E8A22]'}`}></div>
              <div className={`absolute -right-4 top-0 bottom-0 w-2 border-r-2 border-t-2 border-b-2 transition-colors duration-300 ${isFocused ? 'border-[#6BE329]' : 'border-[#4E8A22]'}`}></div>
              
              <div className="absolute inset-y-0 left-0 flex items-center pl-6 pointer-events-none">
                <Search size={24} className={isFocused ? 'text-[#6BE329]' : 'text-[#4E8A22]'} />
              </div>
              <input 
                type="text" 
                className={`w-full bg-[#050B07]/90 border text-xl py-6 pl-16 pr-6 text-[#E4F4E7] mc-search-input mc-mono transition-all duration-300 placeholder-opacity-50 ${isFocused ? 'mc-glow-border border-[#6BE329]' : 'border-[#142E18]'}`}
                placeholder="Search by name, ID, client, or person..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                spellCheck="false"
              />
              <div className={`absolute inset-y-0 right-0 flex items-center pr-6 pointer-events-none ${searchValue.length === 0 ? 'opacity-100' : 'opacity-0'} transition-opacity`}>
                <span className="w-2.5 h-6 bg-[#6BE329] mc-blink"></span>
              </div>
            </div>
            
            <div className="flex justify-between items-center mt-4 px-2 mc-mono text-[10px] text-[#4E8A22]">
              <div>PRESS <span className="bg-[#142E18] text-[#E4F4E7] px-1.5 py-0.5 rounded ml-1">/</span> TO FOCUS</div>
              <div>ESC TO CLEAR</div>
            </div>
          </div>

          {/* Flow Visual */}
          <div className="w-full max-w-2xl mc-panel rounded-lg p-8 relative">
            <div className="absolute top-0 left-4 px-2 -translate-y-1/2 bg-[#071109] text-[10px] mc-mono text-[#6B9475]">OPERATION FLOW</div>
            
            <div className="flex items-center justify-between relative">
              {/* Connecting Line */}
              <div className="absolute top-1/2 left-10 right-10 h-[2px] bg-[#142E18] -translate-y-1/2 z-0">
                <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-transparent via-[#4E8A22] to-transparent w-full opacity-50 animate-pulse"></div>
              </div>

              {/* Step 1 */}
              <div className="relative z-10 flex flex-col items-center gap-3 w-1/3">
                <div className="w-16 h-16 rounded-full bg-[#030805] border-2 border-[#4E8A22] flex items-center justify-center mc-node-glow">
                  <Database size={24} className="text-[#6BE329]" />
                </div>
                <div className="text-center">
                  <div className="text-[#E4F4E7] font-medium tracking-wide mb-1">SEARCH</div>
                  <div className="text-[10px] text-[#6B9475] mc-mono">Global Index</div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="relative z-10 flex flex-col items-center gap-3 w-1/3">
                <div className="w-16 h-16 rounded-full bg-[#030805] border-2 border-[#4E8A22] flex items-center justify-center mc-node-glow">
                  <Crosshair size={24} className="text-[#6BE329]" />
                </div>
                <div className="text-center">
                  <div className="text-[#E4F4E7] font-medium tracking-wide mb-1">SELECT</div>
                  <div className="text-[10px] text-[#6B9475] mc-mono">Target Record</div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="relative z-10 flex flex-col items-center gap-3 w-1/3">
                <div className="w-16 h-16 rounded-full bg-[#030805] border-2 border-[#6BE329] flex items-center justify-center shadow-[0_0_20px_rgba(107,227,41,0.2)]">
                  <Zap size={24} className="text-[#6BE329]" />
                </div>
                <div className="text-center">
                  <div className="text-[#E4F4E7] font-medium tracking-wide mb-1">ACT</div>
                  <div className="text-[10px] text-[#6B9475] mc-mono">Status/Note/Team</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Data & Stats */}
        <div className="col-span-3 flex flex-col gap-6">
          <div className="mc-panel flex-1 rounded border border-[#142E18] flex flex-col">
            <div className="p-3 border-b border-[#142E18] bg-[#050B07] flex items-center gap-2">
              <Users size={14} className="text-[#4E8A22]" />
              <h2 className="mc-mono text-xs text-[#6B9475] uppercase tracking-wider">Fleet Utilization</h2>
            </div>
            <div className="p-6 flex-1 flex flex-col items-center justify-center relative">
              {/* Radial Gauge SVG */}
              <div className="relative w-48 h-48 flex items-center justify-center">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 drop-shadow-[0_0_8px_rgba(107,227,41,0.3)]">
                  {/* Background Track */}
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#142E18" strokeWidth="8" />
                  {/* Inner Track */}
                  <circle cx="50" cy="50" r="30" fill="none" stroke="#142E18" strokeWidth="2" strokeDasharray="2 4" />
                  {/* Progress Line */}
                  <circle 
                    cx="50" cy="50" r="40" 
                    fill="none" 
                    stroke="#6BE329" 
                    strokeWidth="8" 
                    strokeDasharray="251.2" 
                    strokeDashoffset="32.6" /* 87% of 251.2 */
                    className="mc-chart-path"
                  />
                  {/* Marker */}
                  <circle cx="50" cy="10" r="2" fill="#E4F4E7" className="animate-pulse" />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                  <div className="text-4xl font-light text-[#E4F4E7] mc-mono tracking-tighter">87<span className="text-xl text-[#4E8A22]">%</span></div>
                  <div className="text-[10px] text-[#6B9475] uppercase tracking-widest mt-1">ALLOCATED</div>
                </div>
              </div>
              
              <div className="mt-6 w-full space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#6B9475]">Available Staff</span>
                  <span className="mc-mono text-[#E4F4E7]">18 <span className="text-[#4E8A22]">/ 142</span></span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#6B9475]">Senior PMs Open</span>
                  <span className="mc-mono text-[#E3A829]">2</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mc-panel h-48 rounded border border-[#142E18] flex flex-col">
            <div className="p-3 border-b border-[#142E18] bg-[#050B07] flex items-center gap-2">
              <Briefcase size={14} className="text-[#4E8A22]" />
              <h2 className="mc-mono text-xs text-[#6B9475] uppercase tracking-wider">Volume Trend</h2>
            </div>
            <div className="p-4 flex-1 flex flex-col">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <div className="text-2xl font-light text-[#E4F4E7] mc-mono">42</div>
                  <div className="text-[10px] text-[#4E8A22] uppercase tracking-wider">Live Projects</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-light text-[#E4F4E7] mc-mono">7</div>
                  <div className="text-[10px] text-[#4E8A22] uppercase tracking-wider">Touched Today</div>
                </div>
              </div>
              
              {/* Sparkline */}
              <div className="mt-auto h-16 w-full relative group">
                <svg viewBox="0 0 200 50" className="w-full h-full overflow-visible">
                  <defs>
                    <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4E8A22" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#4E8A22" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* Grid lines */}
                  <line x1="0" y1="25" x2="200" y2="25" stroke="#142E18" strokeWidth="1" strokeDasharray="4 4" />
                  
                  {/* Area */}
                  <path d="M0,40 L30,35 L60,45 L90,20 L120,25 L150,10 L180,15 L200,5 L200,50 L0,50 Z" fill="url(#chartGrad)" />
                  
                  {/* Line */}
                  <path d="M0,40 L30,35 L60,45 L90,20 L120,25 L150,10 L180,15 L200,5" fill="none" stroke="#4E8A22" strokeWidth="2" className="mc-chart-path" />
                  
                  {/* Current point */}
                  <circle cx="200" cy="5" r="4" fill="#6BE329" className="mc-node-glow animate-pulse" />
                </svg>
                <div className="absolute top-0 right-0 -mt-6 -mr-2 bg-[#142E18] text-[#6BE329] text-[10px] mc-mono px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  +12% vs last wk
                </div>
              </div>
            </div>
          </div>
        </div>

      </main>
      
      {/* Keyboard hints footer */}
      <footer className="relative z-10 border-t border-[#142E18] bg-[#030805] py-2 px-6 flex justify-between items-center text-[10px] mc-mono text-[#4E8A22]">
        <div>RM ONE SECURE TERMINAL v2.4.1</div>
        <div className="flex gap-6">
          <span><kbd className="bg-[#142E18] text-[#E4F4E7] px-1.5 py-0.5 rounded border border-[#2F5939] mr-1">⌘</kbd> + <kbd className="bg-[#142E18] text-[#E4F4E7] px-1.5 py-0.5 rounded border border-[#2F5939] mr-1">K</kbd> COMMAND MENU</span>
          <span><kbd className="bg-[#142E18] text-[#E4F4E7] px-1.5 py-0.5 rounded border border-[#2F5939] mr-1">?</kbd> HELP</span>
        </div>
      </footer>
    </div>
  );
};

export default MissionControl;
