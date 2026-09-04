import { useState } from "react";

const NavBar = () => (
  <div className="absolute bottom-0 left-0 right-0 bg-[#0A1628] border-t border-[#1E3A5F] px-2 py-2 flex justify-around z-20">
    {[
      { icon: "🏠", label: "Home", id: "home" },
      { icon: "💬", label: "Chat", id: "chat" },
      { icon: "📊", label: "Projects", id: "projects" },
      { icon: "👥", label: "Resources", id: "resources", active: true },
      { icon: "📋", label: "RFP", id: "rfp" },
    ].map((item) => (
      <div key={item.id} className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${item.active ? "bg-[#1E3A5F]" : ""}`}>
        <span className="text-lg">{item.icon}</span>
        <span className={`text-[10px] ${item.active ? "text-[#3B82F6] font-semibold" : "text-[#475569]"}`}>{item.label}</span>
      </div>
    ))}
  </div>
);

const resources = [
  { name: "Alex Johnson", role: "Project Manager", dept: "Construction", alloc: 62, projects: 2, available: true },
  { name: "Maria Santos", role: "Senior Estimator", dept: "Preconstruction", alloc: 75, projects: 3, available: true },
  { name: "David Kim", role: "Field Supervisor", dept: "Field Ops", alloc: 68, projects: 1, available: true },
  { name: "Sarah Chen", role: "MEP Coordinator", dept: "Engineering", alloc: 88, projects: 4, available: false },
  { name: "James Wilson", role: "Cost Controller", dept: "Finance", alloc: 95, projects: 5, available: false },
  { name: "Emma Davis", role: "Architect", dept: "Design", alloc: 45, projects: 1, available: true },
];

export function ResourceAllocation() {
  const [threshold, setThreshold] = useState(85);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "bench">("all");

  const filtered = tab === "bench"
    ? resources.filter(r => r.alloc < threshold)
    : resources;

  return (
    <div className="w-[390px] h-[844px] bg-[#0A1628] flex flex-col overflow-hidden mx-auto relative">
      <div className="flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <h2 className="text-white text-lg font-bold">Resource Allocation</h2>
          <p className="text-[#64748B] text-xs">{resources.length} resources · {resources.filter(r => r.alloc < threshold).length} underutilized</p>
        </div>
        <button className="flex items-center gap-1.5 bg-[#0F2040] border border-[#1E3A5F] px-3 py-2 rounded-xl">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          <span className="text-[#60A5FA] text-xs">Filter</span>
        </button>
      </div>

      <div className="px-5 mb-3">
        <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-xl p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[#94A3B8] text-xs">Allocation Threshold</span>
            <span className="text-[#3B82F6] text-xs font-bold">{threshold}%</span>
          </div>
          <input
            type="range" min={50} max={100} value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full accent-blue-500 h-1"
          />
          <div className="flex justify-between text-[#334155] text-[9px] mt-1">
            <span>50%</span><span>75%</span><span>100%</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 px-5 mb-3">
        {[
          { id: "all", label: `All (${resources.length})` },
          { id: "bench", label: `Under ${threshold}% (${resources.filter(r => r.alloc < threshold).length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as "all" | "bench")}
            className={`text-xs px-3 py-1.5 rounded-full font-medium flex-1 ${tab === t.id ? "bg-[#3B82F6] text-white" : "bg-[#0F2040] border border-[#1E3A5F] text-[#64748B]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-2.5">
        {filtered.map((r) => (
          <button key={r.name} onClick={() => setSelected(selected === r.name ? null : r.name)} className={`w-full text-left bg-[#0F2040] border rounded-2xl p-4 transition-all ${selected === r.name ? "border-[#3B82F6]" : "border-[#1E3A5F]"}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#1D4ED8] to-[#6366F1] flex items-center justify-center flex-shrink-0">
                <span className="text-white text-sm font-bold">{r.name.split(" ").map(n => n[0]).join("")}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm font-semibold truncate">{r.name}</div>
                <div className="text-[#64748B] text-[11px]">{r.role}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[#475569] text-[10px]">📁 {r.projects} project{r.projects !== 1 ? "s" : ""}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.available ? "text-[#22C55E] bg-[#052E16]" : "text-[#EF4444] bg-[#1C0A0A]"}`}>
                    {r.available ? "Available" : "Fully Booked"}
                  </span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className={`text-lg font-bold ${r.alloc >= 85 ? "text-[#22C55E]" : r.alloc >= 70 ? "text-[#F59E0B]" : "text-[#EF4444]"}`}>
                  {r.alloc}%
                </div>
                <div className="w-14 h-1.5 bg-[#1E3A5F] rounded-full mt-1">
                  <div
                    className={`h-1.5 rounded-full ${r.alloc >= 85 ? "bg-[#22C55E]" : r.alloc >= 70 ? "bg-[#F59E0B]" : "bg-[#EF4444]"}`}
                    style={{ width: `${r.alloc}%` }}
                  />
                </div>
              </div>
            </div>

            {selected === r.name && (
              <div className="mt-4 pt-3 border-t border-[#1E3A5F]">
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {["Jan", "Feb", "Mar"].map((m, i) => (
                    <div key={m} className="bg-[#0A1628] rounded-xl p-2 text-center">
                      <div className="text-[#94A3B8] text-[10px] mb-1">{m}</div>
                      <div className={`text-sm font-bold ${[r.alloc - 10, r.alloc, r.alloc + 5][i] >= 85 ? "text-[#22C55E]" : "text-[#F59E0B]"}`}>
                        {[r.alloc - 10, r.alloc, r.alloc + 5][i]}%
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 flex items-center justify-center gap-1.5 bg-[#2563EB] text-white text-xs py-2 rounded-xl">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    Reassign
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-1.5 bg-[#0A1628] border border-[#1E3A5F] text-[#94A3B8] text-xs py-2 rounded-xl">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    Notify
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-1.5 bg-[#0A1628] border border-[#1E3A5F] text-[#94A3B8] text-xs py-2 rounded-xl">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Details
                  </button>
                </div>
              </div>
            )}
          </button>
        ))}
      </div>

      <NavBar />
    </div>
  );
}
