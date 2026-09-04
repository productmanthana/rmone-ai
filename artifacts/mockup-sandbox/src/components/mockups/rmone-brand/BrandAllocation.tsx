import { useState } from "react";

const BrandNav = () => (
  <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-[#E2EAD8] px-2 py-2 flex justify-around z-20 shadow-sm">
    {[
      { icon: "🏠", label: "Home", id: "home" },
      { icon: "💬", label: "Chat", id: "chat" },
      { icon: "📊", label: "Projects", id: "projects" },
      { icon: "👥", label: "Resources", id: "resources", active: true },
      { icon: "📋", label: "RFP", id: "rfp" },
    ].map((item) => (
      <div key={item.id} className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${item.active ? "bg-[#F5F9F0]" : ""}`}>
        <span className="text-lg">{item.icon}</span>
        <span className={`text-[10px] ${item.active ? "text-[#8DC63F] font-bold" : "text-[#B0C4B0]"}`}>{item.label}</span>
      </div>
    ))}
  </div>
);

const resources = [
  { name: "Alex Johnson", role: "Project Manager", dept: "Construction", alloc: 62, projects: 2, initials: "AJ" },
  { name: "Maria Santos", role: "Senior Estimator", dept: "Preconstruction", alloc: 75, projects: 3, initials: "MS" },
  { name: "David Kim", role: "Field Supervisor", dept: "Field Ops", alloc: 68, projects: 1, initials: "DK" },
  { name: "Sarah Chen", role: "MEP Coordinator", dept: "Engineering", alloc: 88, projects: 4, initials: "SC" },
  { name: "James Wilson", role: "Cost Controller", dept: "Finance", alloc: 95, projects: 5, initials: "JW" },
  { name: "Emma Davis", role: "Architect", dept: "Design", alloc: 45, projects: 1, initials: "ED" },
];

export function BrandAllocation() {
  const [threshold, setThreshold] = useState(85);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "bench">("all");

  const filtered = tab === "bench" ? resources.filter(r => r.alloc < threshold) : resources;

  return (
    <div className="w-[390px] h-[844px] bg-[#F5F9F0] flex flex-col overflow-hidden mx-auto relative">
      <div className="absolute top-0 left-0 right-0 h-[4px] bg-[#8DC63F]" />

      <div className="bg-white border-b border-[#E2EAD8] flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <h2 className="text-[#1B3035] text-lg font-bold">Resource Allocation</h2>
          <p className="text-[#8A9E8A] text-xs">{resources.length} resources · {resources.filter(r => r.alloc < threshold).length} underutilized</p>
        </div>
        <button className="flex items-center gap-1.5 bg-[#8DC63F] px-3 py-2 rounded-xl shadow-sm">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          <span className="text-white text-xs font-bold">Filter</span>
        </button>
      </div>

      <div className="px-5 py-3 bg-white border-b border-[#E2EAD8]">
        <div className="bg-[#F5F9F0] border border-[#E2EAD8] rounded-xl p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[#4A6A50] text-xs font-medium">Allocation Threshold</span>
            <span className="text-[#8DC63F] text-xs font-bold">{threshold}%</span>
          </div>
          <input
            type="range" min={50} max={100} value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none"
            style={{ accentColor: "#8DC63F" }}
          />
          <div className="flex justify-between text-[#B0C4B0] text-[9px] mt-1">
            <span>50%</span><span>75%</span><span>100%</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 px-5 py-3 bg-white border-b border-[#E2EAD8]">
        {[
          { id: "all", label: `All (${resources.length})` },
          { id: "bench", label: `Under ${threshold}% (${resources.filter(r => r.alloc < threshold).length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as "all" | "bench")}
            className={`text-xs px-3 py-1.5 rounded-full font-medium flex-1 transition-all ${tab === t.id ? "bg-[#8DC63F] text-white font-bold shadow-sm" : "bg-[#F5F9F0] border border-[#E2EAD8] text-[#8A9E8A]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 pb-24 space-y-2.5">
        {filtered.map((r) => (
          <button key={r.name} onClick={() => setSelected(selected === r.name ? null : r.name)} className={`w-full text-left bg-white border rounded-2xl p-4 shadow-sm transition-all ${selected === r.name ? "border-[#8DC63F]" : "border-[#E2EAD8]"}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#8DC63F] flex items-center justify-center flex-shrink-0">
                <span className="text-white text-sm font-black">{r.initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[#1B3035] text-sm font-semibold truncate">{r.name}</div>
                <div className="text-[#8A9E8A] text-[11px]">{r.role}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[#B0C4B0] text-[10px]">📁 {r.projects} project{r.projects !== 1 ? "s" : ""}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${r.alloc < threshold ? "text-[#8DC63F] bg-[#8DC63F]/10" : "text-[#8A9E8A] bg-[#E2EAD8]"}`}>
                    {r.alloc < threshold ? "Available" : "Booked"}
                  </span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className={`text-lg font-bold ${r.alloc >= 85 ? "text-[#8DC63F]" : r.alloc >= 70 ? "text-[#E07A35]" : "text-red-500"}`}>
                  {r.alloc}%
                </div>
                <div className="w-14 h-1.5 bg-[#E2EAD8] rounded-full mt-1">
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: `${r.alloc}%`, backgroundColor: r.alloc >= 85 ? "#8DC63F" : r.alloc >= 70 ? "#E07A35" : "#EF4444" }}
                  />
                </div>
              </div>
            </div>

            {selected === r.name && (
              <div className="mt-4 pt-3 border-t border-[#E2EAD8]">
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {["Jan", "Feb", "Mar"].map((m, i) => (
                    <div key={m} className="bg-[#F5F9F0] rounded-xl p-2 text-center border border-[#E2EAD8]">
                      <div className="text-[#8A9E8A] text-[10px] mb-1">{m}</div>
                      <div className={`text-sm font-bold ${[r.alloc - 10, r.alloc, r.alloc + 5][i] >= 85 ? "text-[#8DC63F]" : "text-[#E07A35]"}`}>
                        {[r.alloc - 10, r.alloc, r.alloc + 5][i]}%
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 flex items-center justify-center gap-1.5 bg-[#8DC63F] text-white text-xs py-2 rounded-xl font-bold shadow-sm">
                    Reassign
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-1.5 bg-[#E07A35]/10 border border-[#E07A35]/30 text-[#E07A35] text-xs py-2 rounded-xl">
                    Notify
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-1.5 bg-[#F5F9F0] border border-[#E2EAD8] text-[#4A6A50] text-xs py-2 rounded-xl">
                    Details
                  </button>
                </div>
              </div>
            )}
          </button>
        ))}
      </div>

      <BrandNav />
    </div>
  );
}
