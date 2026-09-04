import { useState } from "react";

const NavBar = ({ active }: { active: string }) => (
  <div className="absolute bottom-0 left-0 right-0 bg-[#0A1628] border-t border-[#1E3A5F] px-2 py-2 flex justify-around z-20">
    {[
      { icon: "🏠", label: "Home", id: "home" },
      { icon: "💬", label: "Chat", id: "chat" },
      { icon: "📊", label: "Projects", id: "projects" },
      { icon: "👥", label: "Resources", id: "resources" },
      { icon: "📋", label: "RFP", id: "rfp" },
    ].map((item) => (
      <div key={item.id} className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${active === item.id ? "bg-[#1E3A5F]" : ""}`}>
        <span className="text-lg">{item.icon}</span>
        <span className={`text-[10px] ${active === item.id ? "text-[#3B82F6] font-semibold" : "text-[#475569]"}`}>{item.label}</span>
      </div>
    ))}
  </div>
);

const KPICard = ({ label, value, sub, color, icon }: any) => (
  <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-2xl p-4 flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <span className="text-2xl">{icon}</span>
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{sub}</span>
    </div>
    <div className="text-2xl font-bold text-white">{value}</div>
    <div className="text-[#64748B] text-xs">{label}</div>
  </div>
);

export function BusinessDashboard() {
  const [filter, setFilter] = useState("Monthly");

  return (
    <div className="w-[390px] h-[844px] bg-[#0A1628] flex flex-col overflow-hidden mx-auto relative">
      <div className="flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <p className="text-[#64748B] text-xs">Good morning,</p>
          <h2 className="text-white text-lg font-bold">Sanket Lad</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-[#0F2040] border border-[#1E3A5F] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#EF4444] flex items-center justify-center">
              <span className="text-[8px] text-white font-bold">3</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#1D4ED8] flex items-center justify-center">
            <span className="text-white text-sm font-bold">SL</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 px-5 mb-4">
        {["Monthly", "Quarterly", "Yearly"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${filter === f ? "bg-[#3B82F6] text-white" : "bg-[#0F2040] text-[#64748B] border border-[#1E3A5F]"}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <KPICard label="Active Projects" value="24" sub="↑ 3 new" color="text-[#22C55E] bg-[#052E16]" icon="🏗️" />
          <KPICard label="Open Opportunities" value="11" sub="↑ 2 added" color="text-[#60A5FA] bg-[#0C1A3A]" icon="🎯" />
          <KPICard label="Bench Resources" value="7" sub="↓ 2 placed" color="text-[#F59E0B] bg-[#1C1100]" icon="👤" />
          <KPICard label="Avg Utilization" value="82%" sub="Target 85%" color="text-[#A78BFA] bg-[#150A2E]" icon="📈" />
        </div>

        <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white text-sm font-semibold">Allocation vs Utilization</h3>
            <span className="text-[#3B82F6] text-xs">View all →</span>
          </div>
          <div className="space-y-3">
            {[
              { name: "Construction", alloc: 91, util: 78, color: "#3B82F6" },
              { name: "Preconstruction", alloc: 85, util: 82, color: "#22C55E" },
              { name: "IT & Digital", alloc: 70, util: 65, color: "#F59E0B" },
              { name: "Admin & NCO", alloc: 45, util: 40, color: "#EF4444" },
            ].map((row) => (
              <div key={row.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[#94A3B8]">{row.name}</span>
                  <span className="text-[#64748B]">{row.alloc}% / {row.util}%</span>
                </div>
                <div className="relative h-2 bg-[#1E3A5F] rounded-full">
                  <div className="h-2 rounded-full opacity-30" style={{ width: `${row.alloc}%`, backgroundColor: row.color }} />
                  <div className="absolute top-0 h-2 rounded-full" style={{ width: `${row.util}%`, backgroundColor: row.color }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3">
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#3B82F6] opacity-30" /><span className="text-[10px] text-[#64748B]">Allocated</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#3B82F6]" /><span className="text-[10px] text-[#64748B]">Utilized</span></div>
          </div>
        </div>

        <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white text-sm font-semibold">Resource Skills Forecast</h3>
            <span className="text-[#3B82F6] text-xs">Details →</span>
          </div>
          <div className="flex items-center justify-center gap-6">
            <div className="relative w-28 h-28">
              <svg viewBox="0 0 36 36" className="w-28 h-28 -rotate-90">
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#1E3A5F" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#3B82F6" strokeWidth="3" strokeDasharray="38 62" strokeLinecap="round" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#22C55E" strokeWidth="3" strokeDasharray="25 75" strokeDashoffset="-38" strokeLinecap="round" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#F59E0B" strokeWidth="3" strokeDasharray="22 78" strokeDashoffset="-63" strokeLinecap="round" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#8B5CF6" strokeWidth="3" strokeDasharray="15 85" strokeDashoffset="-85" strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-white text-base font-bold">142</span>
                <span className="text-[#64748B] text-[9px]">Resources</span>
              </div>
            </div>
            <div className="space-y-2">
              {[
                { label: "Project Mgmt", pct: "38%", color: "bg-[#3B82F6]" },
                { label: "Engineering", pct: "25%", color: "bg-[#22C55E]" },
                { label: "Estimating", pct: "22%", color: "bg-[#F59E0B]" },
                { label: "Field Ops", pct: "15%", color: "bg-[#8B5CF6]" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.color}`} />
                  <span className="text-[11px] text-[#94A3B8] w-24">{s.label}</span>
                  <span className="text-[11px] text-white font-medium">{s.pct}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white text-sm font-semibold">Pipeline Summary</h3>
            <span className="text-[#64748B] text-xs">This Month</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Bidding", value: "5", color: "text-[#F59E0B]" },
              { label: "Awarded", value: "3", color: "text-[#22C55E]" },
              { label: "Lost", value: "2", color: "text-[#EF4444]" },
            ].map((p) => (
              <div key={p.label} className="bg-[#0A1628] rounded-xl p-3">
                <div className={`text-xl font-bold ${p.color}`}>{p.value}</div>
                <div className="text-[#64748B] text-[10px]">{p.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-[#1E3A5F] flex justify-between items-center">
            <span className="text-[#64748B] text-xs">Total Pipeline Value</span>
            <span className="text-white font-bold text-sm">$48.2M</span>
          </div>
        </div>
      </div>

      <NavBar active="home" />
    </div>
  );
}
