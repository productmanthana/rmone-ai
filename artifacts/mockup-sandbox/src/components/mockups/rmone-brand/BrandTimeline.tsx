import { useState } from "react";

const BrandNav = () => (
  <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-[#E2EAD8] px-2 py-2 flex justify-around z-20 shadow-sm">
    {[
      { icon: "🏠", label: "Home", id: "home" },
      { icon: "💬", label: "Chat", id: "chat" },
      { icon: "📊", label: "Projects", id: "projects", active: true },
      { icon: "👥", label: "Resources", id: "resources" },
      { icon: "📋", label: "RFP", id: "rfp" },
    ].map((item) => (
      <div key={item.id} className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${item.active ? "bg-[#F5F9F0]" : ""}`}>
        <span className="text-lg">{item.icon}</span>
        <span className={`text-[10px] ${item.active ? "text-[#8DC63F] font-bold" : "text-[#B0C4B0]"}`}>{item.label}</span>
      </div>
    ))}
  </div>
);

const projects = [
  { id: "CPR-24-001176", name: "Sunridge Office Complex", type: "Construction", status: "Active", precon: { start: "Jan 17", end: "Feb 13" }, construction: { start: "Aug 15", end: "Dec 30" }, alloc: 92, risk: "low" },
  { id: "CPR-24-001154", name: "Harbor View Renovation", type: "Renovation", status: "Preconstruction", precon: { start: "Feb 1", end: "Mar 15" }, construction: { start: "Sep 1", end: "Nov 30" }, alloc: 78, risk: "medium" },
  { id: "CPR-24-001199", name: "Tech Campus Phase 2", type: "New Build", status: "Bidding", precon: { start: "Mar 10", end: "Apr 20" }, construction: { start: "Oct 5", end: "Feb 28" }, alloc: 55, risk: "high" },
];

export function BrandTimeline() {
  const [selected, setSelected] = useState(projects[0]);
  const [editMode, setEditMode] = useState(false);

  return (
    <div className="w-[390px] h-[844px] bg-[#F5F9F0] flex flex-col overflow-hidden mx-auto relative">
      <div className="absolute top-0 left-0 right-0 h-[4px] bg-[#8DC63F]" />

      <div className="bg-white border-b border-[#E2EAD8] flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <h2 className="text-[#1B3035] text-lg font-bold">Project Timelines</h2>
          <p className="text-[#8A9E8A] text-xs">{projects.length} active projects</p>
        </div>
        <button className="flex items-center gap-1.5 bg-[#8DC63F] px-3 py-2 rounded-xl shadow-sm">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span className="text-white text-xs font-bold">Add</span>
        </button>
      </div>

      <div className="flex gap-2 px-5 py-3 bg-white border-b border-[#E2EAD8] overflow-x-auto">
        {["All", "Active", "Preconstruction", "Bidding"].map((tab, i) => (
          <button key={tab} className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap ${i === 0 ? "bg-[#8DC63F] text-white font-bold shadow-sm" : "bg-[#F5F9F0] border border-[#E2EAD8] text-[#8A9E8A]"}`}>
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 pb-24 space-y-3">
        {projects.map((p) => (
          <button key={p.id} onClick={() => setSelected(p)} className={`w-full text-left bg-white border rounded-2xl p-4 shadow-sm transition-all ${selected.id === p.id ? "border-[#8DC63F]" : "border-[#E2EAD8]"}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    p.status === "Active" ? "text-[#8DC63F] bg-[#8DC63F]/10" :
                    p.status === "Preconstruction" ? "text-[#4A9A9F] bg-[#4A9A9F]/10" :
                    "text-[#E07A35] bg-[#E07A35]/10"
                  }`}>{p.status}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    p.risk === "low" ? "text-[#8DC63F] bg-[#8DC63F]/10" :
                    p.risk === "medium" ? "text-[#E07A35] bg-[#E07A35]/10" :
                    "text-red-500 bg-red-50"
                  }`}>{p.risk === "low" ? "✓ On Track" : p.risk === "medium" ? "⚠ At Risk" : "⚡ Critical"}</span>
                </div>
                <h3 className="text-[#1B3035] text-sm font-semibold">{p.name}</h3>
                <p className="text-[#8A9E8A] text-[11px]">{p.id} · {p.type}</p>
              </div>
              <div className="text-right">
                <div className={`text-sm font-bold ${p.alloc >= 85 ? "text-[#8DC63F]" : p.alloc >= 70 ? "text-[#E07A35]" : "text-red-500"}`}>{p.alloc}%</div>
                <div className="text-[#8A9E8A] text-[10px]">allocated</div>
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-[#8A9E8A]">Preconstruction</span>
                  <span className="text-[#4A6A50]">{p.precon.start} → {p.precon.end}</span>
                </div>
                <div className="h-1.5 bg-[#F5F9F0] rounded-full border border-[#E2EAD8]">
                  <div className="h-1.5 bg-[#E07A35] rounded-full w-3/4" />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-[#8A9E8A]">Construction</span>
                  <span className="text-[#4A6A50]">{p.construction.start} → {p.construction.end}</span>
                </div>
                <div className="h-1.5 bg-[#F5F9F0] rounded-full border border-[#E2EAD8]">
                  <div className="h-1.5 bg-[#8DC63F] rounded-full w-1/4" />
                </div>
              </div>
            </div>

            {selected.id === p.id && (
              <div className="mt-4 pt-3 border-t border-[#E2EAD8] flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setEditMode(!editMode); }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-[#8DC63F]/10 border border-[#8DC63F]/40 text-[#8DC63F] text-xs py-2 rounded-xl font-semibold"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit Dates
                </button>
                <button className="flex-1 flex items-center justify-center gap-1.5 bg-[#F5F9F0] border border-[#E2EAD8] text-[#4A6A50] text-xs py-2 rounded-xl">
                  Allocations
                </button>
                <button className="flex items-center justify-center gap-1.5 bg-[#E07A35]/10 border border-[#E07A35]/40 text-[#E07A35] text-xs py-2 px-3 rounded-xl">
                  Notify
                </button>
              </div>
            )}
          </button>
        ))}

        {editMode && (
          <div className="bg-white border-2 border-[#8DC63F] rounded-2xl p-4 shadow-sm">
            <h4 className="text-[#1B3035] text-sm font-bold mb-4">Edit Timeline · {selected.name}</h4>
            <div className="space-y-3">
              {["Precon Start", "Precon End", "Construction Start", "Construction End"].map((f) => (
                <div key={f}>
                  <label className="text-[#8A9E8A] text-[10px] uppercase tracking-wide font-semibold">{f}</label>
                  <div className="flex items-center gap-2 bg-[#F5F9F0] border border-[#E2EAD8] rounded-xl px-3 py-2.5 mt-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8DC63F" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <span className="text-[#8A9E8A] text-sm">Select date...</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button className="flex-1 bg-[#8DC63F] text-white text-sm py-2.5 rounded-xl font-bold shadow-sm">
                Save & Recalculate
              </button>
              <button onClick={() => setEditMode(false)} className="px-4 bg-[#F5F9F0] border border-[#E2EAD8] text-[#8A9E8A] text-sm py-2.5 rounded-xl">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <BrandNav />
    </div>
  );
}
