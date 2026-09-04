import React, { useState } from 'react';
import { Search, Command, BriefcaseBusiness, Target, Building2, BarChart3, ArrowUpRight, UserRound } from 'lucide-react';
import './FlowCanvas.css';

const Cross = ({ x, y }: { x: number, y: number }) => (
  <div className="absolute text-[#D5D2C4] pointer-events-none" style={{ left: x, top: y }}>
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
      <path d="M8.5 0v17M0 8.5h17" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  </div>
);

const Ribbon = ({ id, d, delay = 0, color = "#4E8A22" }: { id: string, d: string, delay?: number, color?: string }) => (
  <g>
    {/* Thick translucent background */}
    <path
      id={id}
      d={d}
      fill="none"
      stroke={color}
      strokeWidth="28"
      strokeLinecap="round"
      opacity="0.08"
      className="fc-ribbon"
      style={{ animationDelay: `${delay}s` }}
    />
    {/* Core line */}
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.5"
      className="fc-ribbon"
      style={{ animationDelay: `${delay + 0.1}s` }}
    />
    {/* Pulsing dot traveling the path */}
    <circle r="4.5" fill={color} opacity="0">
      <animate
        attributeName="opacity"
        values="0;1;0"
        dur="4s"
        repeatCount="indefinite"
        begin={`${delay + 0.15}s`}
      />
      <animateMotion
        dur="4s"
        repeatCount="indefinite"
        begin={`${delay + 0.15}s`}
      >
        <mpath href={`#${id}`} />
      </animateMotion>
    </circle>
  </g>
);

const ActionNode = ({ icon: Icon, title, desc, hint, chips, x, y, delay, color = "#4E8A22", onSelect, selected }: any) => (
  <button
    type="button"
    aria-label={`Open ${title}`}
    onClick={() => onSelect(title)}
    className={`fc-node-button text-left absolute w-[270px] p-4 rounded-2xl shadow-lg border bg-white fc-fade-in-late hover:shadow-2xl transition-all duration-300 hover:-translate-y-1.5 cursor-pointer group z-20 ${selected ? 'border-[#4E8A22] ring-2 ring-[#E8F2E1]' : 'border-[#E0DDD2]'}`}
    style={{ left: x, top: y, animationDelay: `${delay}s`, animationFillMode: 'both' }}
  >
    <div className="flex items-start gap-3.5">
      <div 
        className="mt-0.5 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white shadow-inner transition-transform duration-300 group-hover:scale-110" 
        style={{ backgroundColor: color }}
      >
        <Icon className="w-4 h-4" strokeWidth={2.5} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold text-[#2C3525] group-hover:text-opacity-80 transition-colors" style={{ color: color }}>{title}</h3>
          <ArrowUpRight className="w-4 h-4 text-[#A0A69A] group-hover:text-[#4E8A22]" />
        </div>
        <p className="text-sm text-[#64705B] mt-1 leading-relaxed">{desc}</p>
        <p className="mt-2 text-[10px] uppercase tracking-wider font-bold text-[#A0A69A]">{hint}</p>
      </div>
    </div>
    {chips?.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5 pl-[53px]">
      {chips.map((chip: string) => <span key={chip} className="fc-chip-button rounded-full bg-[#F8F7F3] border border-[#E0DDD2] px-2.5 py-1 text-[10px] font-semibold text-[#64705B]">{chip}</span>)}
    </div>}
  </button>
);

const StatChip = ({ value, label, x, y, delay, color = "text-[#4E8A22]", children }: any) => (
  <div
    className="absolute flex items-center gap-4 bg-white/90 backdrop-blur-md px-5 py-3.5 rounded-2xl shadow-sm border border-[#E0DDD2]/80 fc-fade-in fc-float z-10 hover:shadow-md transition-shadow cursor-default"
    style={{ left: x, top: y, animationDelay: `${delay}s`, animationFillMode: 'both' }}
  >
    <div className={`font-serif-fc text-3xl font-bold ${color}`}>{value}</div>
    <div className="text-xs font-semibold uppercase tracking-wider text-[#64705B] max-w-[120px] leading-snug">
      {label}
    </div>
    {children && <div className="ml-1 pl-4 border-l border-[#E0DDD2]/80">{children}</div>}
  </div>
);

const RecentPill = ({ text, x, y, delay }: any) => (
  <div
    className="absolute bg-[#F8F7F3] border border-[#E0DDD2] text-[#64705B] text-xs font-medium px-4 py-2 rounded-full fc-fade-in-late fc-float-delay shadow-sm z-10"
    style={{ left: x, top: y, animationDelay: `${delay}s`, animationFillMode: 'both' }}
  >
    {text}
  </div>
);

export default function FlowCanvas() {
  const [searchValue, setSearchValue] = useState("");
  const [selected, setSelected] = useState("Hub");
  const select = (name: string) => setSelected(name);

  return (
    <div className="relative min-h-screen w-full fc-paper text-[#2C3525] font-sans-fc overflow-auto flex items-center justify-center">
      
      {/* Fixed aspect workspace */}
      <div className="relative w-[1280px] h-[900px] shrink-0 my-8 fc-workspace">
        
        {/* Background Grids / Crosses */}
        <Cross x={100} y={100} />
        <Cross x={1180} y={100} />
        <Cross x={100} y={800} />
        <Cross x={1180} y={800} />

        {/* Brand Header */}
        <div className="absolute top-12 left-12 flex flex-col gap-1 fc-fade-in" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-sm bg-[#4E8A22] flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-white" />
            </div>
            <span className="font-serif-fc font-bold tracking-widest text-lg text-[#2C3525]">RM ONE</span>
          </div>
          <span className="text-[10px] font-bold tracking-[0.2em] text-[#64705B] uppercase ml-7">Operational Intelligence</span>
        </div>

        {/* Legend */}
        <div className="absolute bottom-12 right-12 text-[#A0A69A] text-[10px] font-mono tracking-widest uppercase flex flex-col items-end gap-1.5 fc-fade-in" style={{ animationDelay: '1.2s' }}>
          <span>System Flow 1.0</span>
          <span>Scale: 1:1 Live</span>
          <div className="flex gap-1.5 mt-1 opacity-70">
            <div className="w-8 h-px bg-[#A0A69A]"></div>
            <div className="w-4 h-px bg-[#A0A69A]"></div>
            <div className="w-1 h-px bg-[#A0A69A]"></div>
          </div>
        </div>

        {/* Central Search Hub */}
        <div className="absolute top-[324px] left-[105px] w-[485px] z-30 fc-fade-in" style={{ animationDelay: '0.2s' }}>
          <h1 className="font-serif-fc text-5xl mb-7 leading-tight text-[#2C3525]">
            Who or what needs <br/>
            <span className="italic text-[#4E8A22]">your attention?</span>
          </h1>
          <div className="relative group">
            <div className="absolute -inset-1.5 bg-gradient-to-r from-[#4E8A22] to-[#D27D46] rounded-2xl blur-lg opacity-10 group-hover:opacity-20 transition duration-700"></div>
            <div className="relative bg-white rounded-2xl shadow-xl shadow-black/5 border border-[#E0DDD2]/80 p-2 flex items-center transition-transform hover:-translate-y-0.5 duration-300">
              <div className="pl-4 pr-3 text-[#4E8A22]">
                <Search className="w-6 h-6" strokeWidth={2.5} />
              </div>
                <input
                 aria-label="Search operational records"
                 className="fc-search-input w-full bg-transparent text-lg py-4 pr-4 outline-none placeholder:text-[#A0A69A] text-[#2C3525] font-medium"
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                 placeholder="Search by name, ID, client, or person..."
              />
              <div className="pr-2">
                <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-[#F8F7F3] text-[#64705B] border border-[#E0DDD2]">
                  <Command className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5 items-center">
            <span className="text-[10px] font-bold text-[#A0A69A] uppercase tracking-widest mr-2">Quick:</span>
             {['Riverside Medical Tower', 'Harbor Point Substation', 'Senior Project Manager'].map((tag) => (
              <button 
                 key={tag} 
                onClick={() => setSearchValue(tag)}
                className="px-3.5 py-1.5 rounded-full bg-white border border-[#E0DDD2] text-xs font-semibold text-[#4E8A22] hover:bg-[#4E8A22] hover:text-white hover:border-[#4E8A22] transition-colors shadow-sm"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* SVG Connective Tissue */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 1280 900" aria-hidden="true">
          <Ribbon id="path-projects" d="M 590 450 C 680 450, 690 155, 760 155" color="#4E8A22" delay={0.45} />
          <Ribbon id="path-opportunities" d="M 590 450 C 720 450, 745 300, 920 300" color="#D27D46" delay={0.55} />
          <Ribbon id="path-staff" d="M 590 450 C 720 450, 720 520, 810 520" color="#6A9B43" delay={0.65} />
          <Ribbon id="path-companies" d="M 590 450 C 650 520, 590 680, 620 680" color="#3A631B" delay={0.75} />
          <Ribbon id="path-analytics" d="M 590 450 C 770 500, 820 700, 950 700" color="#B66A38" delay={0.85} />
          <Ribbon id="path-project-note" d="M 1030 155 C 1080 155, 1080 105, 1120 105" color="#6A9B43" delay={1.05} />
          <Ribbon id="path-opportunity-review" d="M 1190 300 C 1230 300, 1230 390, 1160 390" color="#D27D46" delay={1.15} />

          {/* Hub connection dot */}
          <circle cx="590" cy="450" r="14" fill="none" stroke="#4E8A22" strokeWidth="1" className="fc-hub-ring" />
          <circle cx="590" cy="450" r="5" fill="#4E8A22" className="fc-fade-in" style={{ animationDelay: '1.2s' }}>
            <animate attributeName="r" values="5;7;5" dur="3s" repeatCount="indefinite" />
          </circle>

          {/* Node attach points */}
          <circle cx="760" cy="155" r="4" fill="#4E8A22" /><circle cx="920" cy="300" r="4" fill="#D27D46" />
          <circle cx="810" cy="520" r="4" fill="#6A9B43" /><circle cx="620" cy="680" r="4" fill="#3A631B" /><circle cx="950" cy="700" r="4" fill="#B66A38" />
        </svg>

        <div className="absolute top-[268px] left-[105px] text-xs text-[#64705B] z-30 fc-fade-in" style={{ animationDelay: '0.5s' }}>
          <span className="font-semibold text-[#4E8A22]">Ready.</span> {selected === "Hub" ? "Choose a path to begin." : `${selected} selected — choose an action.`}
        </div>

        {/* Action Nodes */}
        <ActionNode
          icon={BriefcaseBusiness} title="Projects" desc="Keep every job, date, and next step moving." hint="Change status · Edit dates"
          chips={["Change status", "Edit dates"]} x={760} y={112} delay={1.0} color="#4E8A22" onSelect={select} selected={selected === "Projects"}
        />
        <ActionNode
          icon={Target} title="Opportunities" desc="See pursuits clearly, from first lead to win." hint="Review pipeline"
          chips={["Review pipeline", "Add note"]} x={920} y={257} delay={1.1} color="#D27D46" onSelect={select} selected={selected === "Opportunities"}
        />
        <ActionNode
          icon={UserRound} title="Staff" desc="Find the right people and make room for work." hint="Assign staff"
          chips={["Assign staff", "Manage team"]} x={810} y={475} delay={1.2} color="#6A9B43" onSelect={select} selected={selected === "Staff"}
        />
        <ActionNode
          icon={Building2} title="Companies" desc="Understand clients, partners, and relationships." hint="Add note · Open record"
          chips={["Add note"]} x={620} y={630} delay={1.3} color="#3A631B" onSelect={select} selected={selected === "Companies"}
        />
        <ActionNode
          icon={BarChart3} title="Analytics" desc="Turn operational activity into a clear read." hint="Run report"
          chips={["Run report"]} x={950} y={655} delay={1.4} color="#B66A38" onSelect={select} selected={selected === "Analytics"}
        />

        <button type="button" aria-label="Open project notes" onClick={() => select("Project notes")} className="absolute z-20 top-[72px] left-[1115px] rounded-full bg-white border border-[#E0DDD2] shadow-sm px-3 py-2 text-[10px] font-bold text-[#64705B] hover:border-[#4E8A22]">Add note</button>
        <button type="button" aria-label="Review opportunity pipeline" onClick={() => select("Pipeline review")} className="absolute z-20 top-[372px] left-[1140px] rounded-full bg-white border border-[#E0DDD2] shadow-sm px-3 py-2 text-[10px] font-bold text-[#D27D46] hover:border-[#D27D46]">Review pipeline</button>

        {/* Floating Data Stats */}
        <StatChip value="42" label="Live projects" x={960} y={80} delay={1.4}>
          <div className="flex items-end gap-1 h-6 pt-1">
            <div className="w-1.5 h-3 bg-[#E8F2E1] rounded-full"></div>
            <div className="w-1.5 h-4 bg-[#E8F2E1] rounded-full"></div>
            <div className="w-1.5 h-6 bg-[#4E8A22] rounded-full"></div>
          </div>
        </StatChip>
        
        <StatChip value="18" label="People with room this week" x={120} y={790} delay={1.5}>
          <div className="grid grid-cols-3 gap-1">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className={`w-2 h-2 rounded-full ${i <= 4 ? 'bg-[#4E8A22]' : 'bg-[#E0DDD2]'}`}></div>
            ))}
          </div>
        </StatChip>
        
        <StatChip value="3" label="Jobs needing a team" x={120} y={710} delay={1.6} color="text-[#D27D46]" />
        <StatChip value="7" label="Records touched today" x={420} y={150} delay={1.7} />

        {/* Contextual Floating Pills */}
        <RecentPill text="Harbor Point Substation" x={120} y={280} delay={1.8} />
        <RecentPill text="Senior Project Manager" x={460} y={290} delay={1.9} />
        <RecentPill text="Electrical Estimator" x={160} y={580} delay={2.0} />
      </div>
    </div>
  );
}
