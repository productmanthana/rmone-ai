import { useState } from "react";

const NavBar = () => (
  <div className="absolute bottom-0 left-0 right-0 bg-[#0A1628] border-t border-[#1E3A5F] px-2 py-2 flex justify-around z-20">
    {[
      { icon: "🏠", label: "Home", id: "home" },
      { icon: "💬", label: "Chat", id: "chat" },
      { icon: "📊", label: "Projects", id: "projects", active: true },
      { icon: "👥", label: "Resources", id: "resources" },
      { icon: "📋", label: "RFP", id: "rfp" },
    ].map((item) => (
      <div key={item.id} className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${item.active ? "bg-[#1E3A5F]" : ""}`}>
        <span className="text-lg">{item.icon}</span>
        <span className={`text-[10px] ${item.active ? "text-[#3B82F6] font-semibold" : "text-[#475569]"}`}>{item.label}</span>
      </div>
    ))}
  </div>
);

const projects = [
  { id: "CPR-24-001176", name: "Sunridge Office Complex", type: "Construction", status: "Active", precon: { start: "Jan 17", end: "Feb 13" }, construction: { start: "Aug 15", end: "Dec 30" }, alloc: 92, risk: "low" },
  { id: "CPR-24-001154", name: "Harbor View Renovation", type: "Renovation", status: "Preconstruction", precon: { start: "Feb 1", end: "Mar 15" }, construction: { start: "Sep 1", end: "Nov 30" }, alloc: 78, risk: "medium" },
  { id: "CPR-24-001199", name: "Tech Campus Phase 2", type: "New Build", status: "Bidding", precon: { start: "Mar 10", end: "Apr 20" }, construction: { start: "Oct 5", end: "Feb 28" }, alloc: 55, risk: "high" },
];

export function ProjectTimeline() {
  const [selected, setSelected] = useState(projects[0]);
  const [editMode, setEditMode] = useState(false);

  return (
    <div className="w-[390px] h-[844px] bg-[#0A1628] flex flex-col overflow-hidden mx-auto relative">
      <div className="flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <h2 className="text-white text-lg font-bold">Project Timelines</h2>
          <p className="text-[#64748B] text-xs">{projects.length} active projects</p>
        </div>
        <div className="flex gap-2">
          <button className="w-8 h-8 rounded-lg bg-[#0F2040] border border-[#1E3A5F] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <button className="w-8 h-8 rounded-lg bg-[#0F2040] border border-[#1E3A5F] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div className="px-5 mb-3 flex gap-2 overflow-x-auto pb-1">
        {["All", "Active", "Preconstruction", "Bidding"].map((tab) => (
          <button key={tab} className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap ${tab === "All" ? "bg-[#3B82F6] text-white" : "bg-[#0F2040] border border-[#1E3A5F] text-[#64748B]"}`}>
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-3">
        {projects.map((p) => (
          <button key={p.id} onClick={() => setSelected(p)} className={`w-full text-left bg-[#0F2040] border rounded-2xl p-4 transition-all ${selected.id === p.id ? "border-[#3B82F6]" : "border-[#1E3A5F]"}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    p.status === "Active" ? "text-[#22C55E] bg-[#052E16]" :
                    p.status === "Preconstruction" ? "text-[#60A5FA] bg-[#0C1A3A]" :
                    "text-[#F59E0B] bg-[#1C1100]"
                  }`}>{p.status}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    p.risk === "low" ? "text-[#22C55E] bg-[#052E16]" :
                    p.risk === "medium" ? "text-[#F59E0B] bg-[#1C1100]" :
                    "text-[#EF4444] bg-[#1C0A0A]"
                  }`}>{p.risk === "low" ? "✓ On Track" : p.risk === "medium" ? "⚠ At Risk" : "⚡ Critical"}</span>
                </div>
                <h3 className="text-white text-sm font-semibold">{p.name}</h3>
                <p className="text-[#64748B] text-[11px]">{p.id} · {p.type}</p>
              </div>
              <div className="text-right">
                <div className={`text-sm font-bold ${p.alloc >= 85 ? "text-[#22C55E]" : p.alloc >= 70 ? "text-[#F59E0B]" : "text-[#EF4444]"}`}>{p.alloc}%</div>
                <div className="text-[#64748B] text-[10px]">allocated</div>
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-[#64748B]">Preconstruction</span>
                  <span className="text-[#94A3B8]">{p.precon.start} → {p.precon.end}</span>
                </div>
                <div className="h-1.5 bg-[#1E3A5F] rounded-full">
                  <div className="h-1.5 bg-[#6366F1] rounded-full w-3/4" />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-[#64748B]">Construction</span>
                  <span className="text-[#94A3B8]">{p.construction.start} → {p.construction.end}</span>
                </div>
                <div className="h-1.5 bg-[#1E3A5F] rounded-full">
                  <div className="h-1.5 bg-[#3B82F6] rounded-full w-1/4" />
                </div>
              </div>
            </div>

            {selected.id === p.id && (
              <div className="mt-4 pt-3 border-t border-[#1E3A5F] flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setEditMode(!editMode); }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-[#1E3A5F] text-[#60A5FA] text-xs py-2 rounded-xl"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit Dates
                </button>
                <button className="flex-1 flex items-center justify-center gap-1.5 bg-[#0A1628] border border-[#1E3A5F] text-[#94A3B8] text-xs py-2 rounded-xl">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  Allocations
                </button>
                <button className="flex items-center justify-center gap-1.5 bg-[#0A1628] border border-[#1E3A5F] text-[#94A3B8] text-xs py-2 px-3 rounded-xl">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  Notify
                </button>
              </div>
            )}
          </button>
        ))}

        {editMode && (
          <div className="bg-[#0F2040] border border-[#3B82F6] rounded-2xl p-4">
            <h4 className="text-white text-sm font-semibold mb-4">Edit Timeline · {selected.name}</h4>
            <div className="space-y-3">
              {[
                { label: "Precon Start", value: selected.precon.start },
                { label: "Precon End", value: selected.precon.end },
                { label: "Construction Start", value: selected.construction.start },
                { label: "Construction End", value: selected.construction.end },
              ].map((f) => (
                <div key={f.label}>
                  <label className="text-[#64748B] text-[10px] uppercase tracking-wide">{f.label}</label>
                  <div className="flex items-center gap-2 bg-[#0A1628] border border-[#1E3A5F] rounded-xl px-3 py-2.5 mt-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <span className="text-[#94A3B8] text-sm">{f.value}, 2025</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button className="flex-1 bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white text-sm py-2.5 rounded-xl font-medium">
                Save & Update Allocations
              </button>
              <button onClick={() => setEditMode(false)} className="px-4 bg-[#0A1628] border border-[#1E3A5F] text-[#64748B] text-sm py-2.5 rounded-xl">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <NavBar />
    </div>
  );
}
