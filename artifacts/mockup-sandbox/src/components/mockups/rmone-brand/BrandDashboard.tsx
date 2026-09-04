import { useState } from "react";

const BrandNav = ({ active }: { active: string }) => (
  <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-[#E2EAD8] px-2 py-2 flex justify-around z-20 shadow-sm">
    {[
      { icon: "🏠", label: "Home", id: "home" },
      { icon: "💬", label: "Chat", id: "chat" },
      { icon: "📊", label: "Projects", id: "projects" },
      { icon: "👥", label: "Resources", id: "resources" },
      { icon: "📋", label: "RFP", id: "rfp" },
    ].map((item) => (
      <div key={item.id} className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${active === item.id ? "bg-[#F5F9F0]" : ""}`}>
        <span className="text-lg">{item.icon}</span>
        <span className={`text-[10px] ${active === item.id ? "text-[#8DC63F] font-bold" : "text-[#B0C4B0]"}`}>{item.label}</span>
      </div>
    ))}
  </div>
);

const KPICard = ({ label, value, sub, green, icon }: any) => (
  <div className="bg-white border border-[#E2EAD8] rounded-2xl p-4 flex flex-col gap-2 shadow-sm">
    <div className="flex items-center justify-between">
      <span className="text-2xl">{icon}</span>
      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${green ? "text-[#8DC63F] bg-[#8DC63F]/10" : "text-[#E07A35] bg-[#E07A35]/10"}`}>{sub}</span>
    </div>
    <div className="text-2xl font-bold text-[#1B3035]">{value}</div>
    <div className="text-[#8A9E8A] text-xs">{label}</div>
  </div>
);

export function BrandDashboard() {
  const [filter, setFilter] = useState("Monthly");

  return (
    <div className="w-[390px] h-[844px] bg-[#F5F9F0] flex flex-col overflow-hidden mx-auto relative">
      <div className="absolute top-0 left-0 right-0 h-[4px] bg-[#8DC63F]" />

      <div className="bg-white border-b border-[#E2EAD8] flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <p className="text-[#8A9E8A] text-xs">Good morning,</p>
          <div className="flex items-center gap-2">
            <h2 className="text-[#1B3035] text-lg font-bold">Sanket Lad</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#8DC63F]/10 text-[#8DC63F] border border-[#8DC63F]/20 font-semibold">Manager</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-[#F5F9F0] border border-[#E2EAD8] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A9E8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#E07A35] flex items-center justify-center">
              <span className="text-[8px] text-white font-bold">3</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-[#8DC63F] flex items-center justify-center">
            <span className="text-white text-sm font-black">SL</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 px-5 py-3 bg-white border-b border-[#E2EAD8]">
        {["Monthly", "Quarterly", "Yearly"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${filter === f ? "bg-[#8DC63F] text-white font-bold shadow-sm" : "bg-[#F5F9F0] text-[#8A9E8A] border border-[#E2EAD8]"}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 pb-24 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <KPICard label="Active Projects" value="24" sub="↑ 3 new" green icon="🏗️" />
          <KPICard label="Open Opportunities" value="11" sub="↑ 2 added" green={false} icon="🎯" />
          <KPICard label="Bench Resources" value="7" sub="↓ 2 placed" green={false} icon="👤" />
          <KPICard label="Avg Utilization" value="82%" sub="Target 85%" green icon="📈" />
        </div>

        <div className="bg-white border border-[#E2EAD8] rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[#1B3035] text-sm font-semibold">Allocation vs Utilization</h3>
            <span className="text-[#8DC63F] text-xs font-semibold">View all →</span>
          </div>
          <div className="space-y-3">
            {[
              { name: "Construction", alloc: 91, util: 78 },
              { name: "Preconstruction", alloc: 85, util: 82 },
              { name: "IT & Digital", alloc: 70, util: 65 },
              { name: "Admin & NCO", alloc: 45, util: 40 },
            ].map((row) => (
              <div key={row.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[#4A6A50]">{row.name}</span>
                  <span className="text-[#8A9E8A]">{row.alloc}% / {row.util}%</span>
                </div>
                <div className="relative h-2 bg-[#F5F9F0] rounded-full">
                  <div className="h-2 rounded-full bg-[#8DC63F] opacity-25" style={{ width: `${row.alloc}%` }} />
                  <div className="absolute top-0 h-2 rounded-full bg-[#8DC63F]" style={{ width: `${row.util}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3">
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#8DC63F] opacity-25" /><span className="text-[10px] text-[#8A9E8A]">Allocated</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#8DC63F]" /><span className="text-[10px] text-[#8A9E8A]">Utilized</span></div>
          </div>
        </div>

        <div className="bg-white border border-[#E2EAD8] rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[#1B3035] text-sm font-semibold">Resource Skills Forecast</h3>
            <span className="text-[#8DC63F] text-xs font-semibold">Details →</span>
          </div>
          <div className="flex items-center justify-center gap-6">
            <div className="relative w-28 h-28">
              <svg viewBox="0 0 36 36" className="w-28 h-28 -rotate-90">
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#E2EAD8" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#8DC63F" strokeWidth="3" strokeDasharray="38 62" strokeLinecap="round" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#E07A35" strokeWidth="3" strokeDasharray="25 75" strokeDashoffset="-38" strokeLinecap="round" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#4A9A9F" strokeWidth="3" strokeDasharray="22 78" strokeDashoffset="-63" strokeLinecap="round" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#A3C244" strokeWidth="3" strokeDasharray="15 85" strokeDashoffset="-85" strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[#1B3035] text-base font-bold">142</span>
                <span className="text-[#8A9E8A] text-[9px]">Resources</span>
              </div>
            </div>
            <div className="space-y-2">
              {[
                { label: "Project Mgmt", pct: "38%", color: "bg-[#8DC63F]" },
                { label: "Engineering", pct: "25%", color: "bg-[#E07A35]" },
                { label: "Estimating", pct: "22%", color: "bg-[#4A9A9F]" },
                { label: "Field Ops", pct: "15%", color: "bg-[#A3C244]" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.color}`} />
                  <span className="text-[11px] text-[#4A6A50] w-24">{s.label}</span>
                  <span className="text-[11px] text-[#1B3035] font-semibold">{s.pct}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#E2EAD8] rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[#1B3035] text-sm font-semibold">Pipeline Summary</h3>
            <span className="text-[#8A9E8A] text-xs">This Month</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Bidding", value: "5", color: "text-[#E07A35]" },
              { label: "Awarded", value: "3", color: "text-[#8DC63F]" },
              { label: "Lost", value: "2", color: "text-[#B0C4B0]" },
            ].map((p) => (
              <div key={p.label} className="bg-[#F5F9F0] border border-[#E2EAD8] rounded-xl p-3">
                <div className={`text-xl font-bold ${p.color}`}>{p.value}</div>
                <div className="text-[#8A9E8A] text-[10px]">{p.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-[#E2EAD8] flex justify-between items-center">
            <span className="text-[#8A9E8A] text-xs">Total Pipeline Value</span>
            <span className="text-[#8DC63F] font-bold text-sm">$48.2M</span>
          </div>
        </div>
      </div>

      <BrandNav active="home" />
    </div>
  );
}
