import { useState } from "react";

const NavBar = () => (
  <div className="absolute bottom-0 left-0 right-0 bg-[#0A1628] border-t border-[#1E3A5F] px-2 py-2 flex justify-around z-20">
    {[
      { icon: "🏠", label: "Home", id: "home" },
      { icon: "💬", label: "Chat", id: "chat" },
      { icon: "📊", label: "Projects", id: "projects" },
      { icon: "👥", label: "Resources", id: "resources" },
      { icon: "📋", label: "RFP", id: "rfp", active: true },
    ].map((item) => (
      <div key={item.id} className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${item.active ? "bg-[#1E3A5F]" : ""}`}>
        <span className="text-lg">{item.icon}</span>
        <span className={`text-[10px] ${item.active ? "text-[#3B82F6] font-semibold" : "text-[#475569]"}`}>{item.label}</span>
      </div>
    ))}
  </div>
);

const opps = [
  { id: "OPP-26-0042", name: "Riverside Medical Center", value: "$12.4M", stage: "RFP Response", daysLeft: 5, probability: 72, type: "Healthcare", contact: "Mark Rivera", resources: 8 },
  { id: "OPP-26-0039", name: "Downtown Mixed-Use Tower", value: "$28.7M", stage: "Qualification", daysLeft: 12, probability: 55, type: "Commercial", contact: "Lisa Park", resources: 14 },
  { id: "OPP-26-0035", name: "Harbor Bridge Expansion", value: "$45.1M", stage: "Proposal Review", daysLeft: 3, probability: 88, type: "Infrastructure", contact: "Tom Bradley", resources: 22 },
  { id: "OPP-26-0028", name: "University Science Lab", value: "$8.9M", stage: "Discovery", daysLeft: 20, probability: 40, type: "Education", contact: "Ana Gutierrez", resources: 5 },
];

export function OpportunitiesList() {
  const [filter, setFilter] = useState("All");

  return (
    <div className="w-[390px] h-[844px] bg-[#0A1628] flex flex-col overflow-hidden mx-auto relative">
      <div className="flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <h2 className="text-white text-lg font-bold">Opportunities</h2>
          <p className="text-[#64748B] text-xs">{opps.length} active · $95.1M pipeline</p>
        </div>
        <button className="flex items-center gap-1.5 bg-gradient-to-r from-[#2563EB] to-[#3B82F6] px-4 py-2 rounded-xl">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span className="text-white text-xs font-semibold">New</span>
        </button>
      </div>

      <div className="px-5 mb-4">
        <div className="flex items-center bg-[#0F2040] border border-[#1E3A5F] rounded-xl px-3 py-2.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" className="mr-2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search opportunities..." className="bg-transparent text-sm text-[#64748B] outline-none flex-1 placeholder:text-[#334155]" />
        </div>
      </div>

      <div className="flex gap-2 px-5 mb-4 overflow-x-auto pb-1">
        {["All", "RFP Response", "Qualification", "Proposal Review"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap flex-shrink-0 ${filter === f ? "bg-[#3B82F6] text-white" : "bg-[#0F2040] border border-[#1E3A5F] text-[#64748B]"}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-3">
        {opps.filter(o => filter === "All" || o.stage === filter).map((opp) => (
          <div key={opp.id} className="bg-[#0F2040] border border-[#1E3A5F] rounded-2xl p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0 pr-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    opp.daysLeft <= 5 ? "text-[#EF4444] bg-[#1C0A0A]" :
                    opp.daysLeft <= 10 ? "text-[#F59E0B] bg-[#1C1100]" :
                    "text-[#22C55E] bg-[#052E16]"
                  }`}>
                    {opp.daysLeft <= 5 ? "🔴" : opp.daysLeft <= 10 ? "🟡" : "🟢"} {opp.daysLeft}d left
                  </span>
                  <span className="text-[#475569] text-[10px]">{opp.type}</span>
                </div>
                <h3 className="text-white text-sm font-semibold truncate">{opp.name}</h3>
                <p className="text-[#64748B] text-[11px]">{opp.id}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[#22C55E] text-sm font-bold">{opp.value}</div>
                <div className="text-[#64748B] text-[10px]">Est. Value</div>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1">
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-[#64748B]">Win Probability</span>
                  <span className={`font-semibold ${opp.probability >= 70 ? "text-[#22C55E]" : opp.probability >= 50 ? "text-[#F59E0B]" : "text-[#EF4444]"}`}>{opp.probability}%</span>
                </div>
                <div className="h-1.5 bg-[#1E3A5F] rounded-full">
                  <div
                    className={`h-1.5 rounded-full ${opp.probability >= 70 ? "bg-[#22C55E]" : opp.probability >= 50 ? "bg-[#F59E0B]" : "bg-[#EF4444]"}`}
                    style={{ width: `${opp.probability}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[#64748B] text-[10px]">Stage:</span>
                <span className="text-[#94A3B8] text-[11px] font-medium">{opp.stage}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1">
                  {Array.from({ length: Math.min(3, opp.resources) }).map((_, i) => (
                    <div key={i} className="w-5 h-5 rounded-full border border-[#0F2040]" style={{ backgroundColor: ["#3B82F6", "#6366F1", "#8B5CF6"][i] }} />
                  ))}
                </div>
                <span className="text-[#64748B] text-[10px]">+{opp.resources} resources</span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[#1E3A5F] flex gap-2">
              <button className="flex-1 text-xs py-2 bg-[#1E3A5F] text-[#60A5FA] rounded-xl">View RFP</button>
              <button className="flex-1 text-xs py-2 bg-[#052E16] text-[#22C55E] rounded-xl">Add Resources</button>
              <button className="flex-1 text-xs py-2 bg-[#1C1100] text-[#F59E0B] rounded-xl">Notify Team</button>
            </div>
          </div>
        ))}
      </div>

      <NavBar />
    </div>
  );
}
