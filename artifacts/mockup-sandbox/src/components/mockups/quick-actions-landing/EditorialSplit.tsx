import React from 'react';
import { Search, ArrowRight, Activity, Users, LayoutDashboard, Clock, CheckCircle2, AlertCircle, BarChart3, MoveRight, ChevronRight, Zap } from 'lucide-react';
import './EditorialSplit.css';

export default function EditorialSplit() {
  return (
    <div className="editorial-split-wrapper min-h-screen w-full flex flex-col md:flex-row bg-[#FAFAFA] text-zinc-900 selection:bg-[#65B32E] selection:text-white">
      {/* LEFT COLUMN: Typography & Action */}
      <div className="flex-1 flex flex-col px-8 py-12 md:px-16 md:py-12 justify-between animate-slide-up relative z-10 shadow-[20px_0_40px_rgba(0,0,0,0.03)] bg-[#FAFAFA]">
        
        {/* Header */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#1f3f0e] rounded-sm flex items-center justify-center shadow-inner relative overflow-hidden">
               <div className="absolute inset-0 bg-gradient-to-br from-[#3e7c1d] to-transparent opacity-50"></div>
               <div className="w-4 h-4 bg-[#65B32E] rounded-full relative z-10 shadow-[0_0_10px_#65B32E]"></div>
            </div>
            <div>
              <h1 className="font-bold tracking-widest text-sm text-[#1f3f0e] uppercase">RM ONE</h1>
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Operational Intelligence</p>
            </div>
          </div>
          <div className="px-3 py-1 bg-zinc-100 rounded-full border border-zinc-200 text-xs font-semibold text-zinc-500 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#65B32E] animate-pulse-slow"></span>
            COMMAND CENTER
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-xl mt-24 mb-16">
          <h2 className="font-editorial text-6xl md:text-[80px] font-medium leading-[1.05] text-[#111] tracking-tight mb-8 animate-slide-up stagger-1">
            What needs <br />
            <span className="italic text-[#3e7c1d] font-normal relative">
              doing?
              <svg className="absolute -bottom-2 left-0 w-full h-3 text-[#65B32E]/30" viewBox="0 0 100 10" preserveAspectRatio="none">
                <path d="M0 5 Q 50 10 100 0" stroke="currentColor" strokeWidth="3" fill="none" />
              </svg>
            </span>
          </h2>
          
          <div className="relative group animate-slide-up stagger-2 mb-16">
            <div className="absolute inset-0 bg-[#65B32E] blur-[30px] opacity-10 group-hover:opacity-20 transition-opacity duration-700 rounded-full"></div>
            <div className="relative flex items-center bg-white border border-zinc-200 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(101,179,46,0.1)] transition-all duration-300 p-2.5 pl-8 group-hover:border-[#65B32E]/50">
              <Search className="w-7 h-7 text-zinc-400 group-hover:text-[#3e7c1d] transition-colors" />
              <input 
                type="text" 
                placeholder="Search by name, ID, client, or person..." 
                className="flex-1 bg-transparent border-none outline-none px-5 py-4 text-xl placeholder:text-zinc-400 text-zinc-800 font-medium"
                autoFocus
              />
              <button className="bg-[#1f3f0e] text-white rounded-full p-4 hover:bg-[#132709] transition-all flex items-center justify-center hover:scale-105 active:scale-95 shadow-lg">
                <ArrowRight className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Quick Stats - Editorial Layout */}
          <div className="animate-slide-up stagger-3">
            <div className="flex items-center gap-4 mb-6">
               <div className="h-[1px] flex-1 bg-zinc-200"></div>
               <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Pulse Check</span>
               <div className="h-[1px] flex-1 bg-zinc-200"></div>
            </div>
            
            <div className="grid grid-cols-2 gap-x-8 gap-y-10">
              <div className="flex flex-col gap-2 group cursor-pointer">
                <div className="flex items-center gap-2 text-[#3e7c1d] font-semibold text-sm uppercase tracking-wide">
                  <Users className="w-4 h-4" /> Available Capacity
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-editorial font-semibold text-[#111] group-hover:text-[#65B32E] transition-colors">18</span>
                  <span className="text-sm font-medium text-zinc-500">people</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">Staff members with active bandwidth this current week.</p>
              </div>

              <div className="flex flex-col gap-2 group cursor-pointer">
                <div className="flex items-center gap-2 text-[#3e7c1d] font-semibold text-sm uppercase tracking-wide">
                  <LayoutDashboard className="w-4 h-4" /> Live Projects
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-editorial font-semibold text-[#111] group-hover:text-[#65B32E] transition-colors">42</span>
                  <span className="text-sm font-medium text-zinc-500">projects</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">Active construction and design phases underway.</p>
              </div>

              <div className="flex flex-col gap-2 group cursor-pointer">
                <div className="flex items-center gap-2 text-red-600 font-semibold text-sm uppercase tracking-wide">
                  <AlertCircle className="w-4 h-4" /> Attention Required
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-editorial font-semibold text-red-600 group-hover:text-red-500 transition-colors">3</span>
                  <span className="text-sm font-medium text-zinc-500">unstaffed</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">Critical opportunities missing key personnel assignments.</p>
              </div>

              <div className="flex flex-col gap-2 group cursor-pointer">
                <div className="flex items-center gap-2 text-zinc-600 font-semibold text-sm uppercase tracking-wide">
                  <Activity className="w-4 h-4" /> System Velocity
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-editorial font-semibold text-[#111] group-hover:text-[#65B32E] transition-colors">124</span>
                  <span className="text-sm font-medium text-zinc-500">updates</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">Record modifications processed in the last 24 hours.</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex items-center gap-8 text-xs text-zinc-400 font-semibold uppercase tracking-wider animate-slide-up stagger-4">
          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#65B32E]" /> Live DB Sync</div>
          <div className="flex items-center gap-2"><Clock className="w-4 h-4" /> Updated just now</div>
        </div>
      </div>

      {/* RIGHT COLUMN: Layered Flow Visual */}
      <div className="flex-1 bg-[#131A10] text-white relative overflow-hidden flex flex-col items-center justify-center min-h-[600px] md:min-h-screen border-l border-[#295213]/30">
        
        {/* Deep background textures */}
        <div className="absolute inset-0 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay pointer-events-none"></div>
        <div className="absolute top-0 right-0 w-full h-full opacity-[0.05] pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
        
        {/* Glowing orbs */}
        <div className="absolute -top-[20%] -right-[10%] w-[60%] h-[60%] bg-[#65B32E] rounded-full blur-[150px] opacity-20 pointer-events-none animate-pulse-slow"></div>
        <div className="absolute -bottom-[10%] -left-[10%] w-[50%] h-[50%] bg-[#3e7c1d] rounded-full blur-[120px] opacity-30 pointer-events-none"></div>

        {/* Content Wrapper */}
        <div className="relative w-full max-w-lg px-8 py-8 z-20">
          
          <div className="mb-12 flex items-center justify-between animate-slide-up stagger-3">
             <h3 className="font-editorial text-2xl text-[#E5ECE0] italic">The Pipeline</h3>
             <div className="flex items-center gap-2 text-xs font-mono text-[#65B32E] bg-[#1f3f0e]/50 px-3 py-1 rounded-full border border-[#3e7c1d]/30">
               <Zap className="w-3 h-3" /> ACTION REQUIRED
             </div>
          </div>

          {/* Layered Composition */}
          <div className="relative w-full h-[500px]">
            
            {/* Layer 1: Search Result / Record Card */}
            <div className="absolute top-0 left-0 w-[90%] bg-[#1A2515] border border-[#2c4e17] rounded-xl p-5 shadow-[0_20px_40px_rgba(0,0,0,0.5)] animate-slide-up stagger-4 transition-transform hover:-translate-y-2 hover:border-[#65B32E] duration-500 z-10">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-xs font-mono text-[#65B32E] mb-1">PRJ-9202</div>
                  <h4 className="text-lg font-semibold text-white">Riverside Medical Tower</h4>
                </div>
                <div className="px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-[10px] font-bold uppercase tracking-wider">
                  Pre-Con
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4 border-t border-[#2c4e17] pt-4">
                <div>
                  <div className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">Project Exec</div>
                  <div className="text-sm text-zinc-200 flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold">JD</div>
                    J. Doe
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">Start Date</div>
                  <div className="text-sm text-zinc-200">Oct 12, 2024</div>
                </div>
              </div>
            </div>

            {/* Connecting line */}
            <div className="absolute top-[100px] left-[15%] w-[2px] h-20 bg-gradient-to-b from-[#65B32E] to-transparent z-0 animate-slide-up stagger-5 opacity-50"></div>

            {/* Layer 2: Data Vis / Allocation Chart */}
            <div className="absolute top-[110px] right-0 w-[85%] bg-[#212C1A] border border-[#3e7c1d] rounded-xl p-5 shadow-[0_30px_50px_rgba(0,0,0,0.6)] animate-slide-up stagger-5 backdrop-blur-md z-20">
              <div className="flex justify-between items-center mb-4">
                <h5 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#65B32E]" /> Role Fulfillment
                </h5>
                <span className="text-xs text-zinc-400">Next 4 Weeks</span>
              </div>
              
              {/* Mini Bar Chart built with divs */}
              <div className="space-y-3 mt-4">
                <div className="relative">
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>Sr. Project Manager</span>
                    <span className="text-[#65B32E]">100%</span>
                  </div>
                  <div className="w-full h-2 bg-[#131A10] rounded-full overflow-hidden">
                    <div className="h-full bg-[#65B32E] w-full rounded-full"></div>
                  </div>
                </div>
                <div className="relative">
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>Electrical Estimator</span>
                    <span className="text-yellow-500">45%</span>
                  </div>
                  <div className="w-full h-2 bg-[#131A10] rounded-full overflow-hidden">
                    <div className="h-full bg-yellow-500 w-[45%] rounded-full relative">
                       <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/30 animate-pulse"></div>
                    </div>
                  </div>
                </div>
                <div className="relative">
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>Site Supt.</span>
                    <span className="text-red-500">0%</span>
                  </div>
                  <div className="w-full h-2 bg-[#131A10] rounded-full overflow-hidden border border-red-500/20">
                    <div className="h-full bg-red-500 w-[0%] rounded-full"></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Connecting line */}
            <div className="absolute top-[260px] right-[25%] w-[2px] h-20 bg-gradient-to-b from-[#65B32E] to-transparent z-10 animate-slide-up stagger-6 opacity-50"></div>

            {/* Layer 3: Action Panel */}
            <div className="absolute top-[280px] left-[5%] w-[80%] bg-[#2a3c20] border border-[#65B32E]/40 rounded-xl p-1 shadow-[0_20px_50px_rgba(0,0,0,0.7)] animate-slide-up stagger-6 z-30">
               <div className="bg-[#182512] rounded-lg p-5">
                  <h5 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    Take Action
                  </h5>
                  <div className="flex flex-col gap-2">
                    <button className="w-full text-left px-4 py-3 bg-[#24351a] hover:bg-[#344d25] border border-[#3e7c1d] rounded-lg text-sm text-zinc-200 transition-colors flex justify-between items-center group">
                      <span>Request Staffing Allocation</span>
                      <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
                    </button>
                    <button className="w-full text-left px-4 py-3 bg-[#24351a] hover:bg-[#344d25] border border-[#3e7c1d] rounded-lg text-sm text-zinc-200 transition-colors flex justify-between items-center group">
                      <span>Update Phase Dates</span>
                      <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
                    </button>
                  </div>
               </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
