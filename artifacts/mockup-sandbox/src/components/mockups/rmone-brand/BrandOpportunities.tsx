import { useState } from "react";

const BrandNav = () => (
  <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-[#E2EAD8] px-2 py-2 flex justify-around z-20 shadow-sm">
    {[
      { icon: "🏠", label: "Home", id: "home" },
      { icon: "💬", label: "Chat", id: "chat" },
      { icon: "📊", label: "Projects", id: "projects" },
      { icon: "👥", label: "Resources", id: "resources" },
      { icon: "📋", label: "RFP", id: "rfp", active: true },
    ].map((item) => (
      <div key={item.id} className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${item.active ? "bg-[#F5F9F0]" : ""}`}>
        <span className="text-lg">{item.icon}</span>
        <span className={`text-[10px] ${item.active ? "text-[#8DC63F] font-bold" : "text-[#B0C4B0]"}`}>{item.label}</span>
      </div>
    ))}
  </div>
);

const opps = [
  { id: "OPP-26-0042", name: "Riverside Medical Center", value: "$12.4M", stage: "RFP Response", daysLeft: 5, probability: 72, type: "Healthcare", resources: 8 },
  { id: "OPP-26-0039", name: "Downtown Mixed-Use Tower", value: "$28.7M", stage: "Qualification", daysLeft: 12, probability: 55, type: "Commercial", resources: 14 },
  { id: "OPP-26-0035", name: "Harbor Bridge Expansion", value: "$45.1M", stage: "Proposal Review", daysLeft: 3, probability: 88, type: "Infrastructure", resources: 22 },
  { id: "OPP-26-0028", name: "University Science Lab", value: "$8.9M", stage: "Discovery", daysLeft: 20, probability: 40, type: "Education", resources: 5 },
];

export function BrandOpportunities() {
  const [filter, setFilter] = useState("All");

  return (
    <div className="w-[390px] h-[844px] bg-[#F5F9F0] flex flex-col overflow-hidden mx-auto relative">
      <div className="absolute top-0 left-0 right-0 h-[4px] bg-[#8DC63F]" />

      <div className="bg-white border-b border-[#E2EAD8] flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <h2 className="text-[#1B3035] text-lg font-bold">Opportunities</h2>
          <p className="text-[#8A9E8A] text-xs">{opps.length} active · <span className="text-[#8DC63F] font-semibold">$95.1M</span> pipeline</p>
        </div>
        <button className="flex items-center gap-1.5 bg-[#8DC63F] px-4 py-2 rounded-xl shadow-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span className="text-white text-xs font-bold">New RFP</span>
        </button>
      </div>

      <div className="px-5 py-3 bg-white border-b border-[#E2EAD8]">
        <div className="flex items-center bg-[#F5F9F0] border border-[#E2EAD8] rounded-xl px-3 py-2.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B0C4B0" strokeWidth="2" className="mr-2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search opportunities..." className="bg-transparent text-sm text-[#1B3035] outline-none flex-1 placeholder:text-[#B0C4B0]" />
        </div>
      </div>

      <div className="flex gap-2 px-5 py-3 bg-white border-b border-[#E2EAD8] overflow-x-auto">
        {["All", "RFP Response", "Qualification", "Discovery"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap flex-shrink-0 ${filter === f ? "bg-[#8DC63F] text-white font-bold shadow-sm" : "bg-[#F5F9F0] border border-[#E2EAD8] text-[#8A9E8A]"}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 pb-24 space-y-3">
        {opps.filter(o => filter === "All" || o.stage === filter).map((opp) => (
          <div key={opp.id} className="bg-white border border-[#E2EAD8] rounded-2xl p-4 shadow-sm hover:border-[#8DC63F]/50 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0 pr-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    opp.daysLeft <= 5 ? "text-[#E07A35] bg-[#E07A35]/10" :
                    opp.daysLeft <= 10 ? "text-yellow-600 bg-yellow-50" :
                    "text-[#8DC63F] bg-[#8DC63F]/10"
                  }`}>
                    {opp.daysLeft <= 5 ? "🔴" : opp.daysLeft <= 10 ? "🟡" : "🟢"} {opp.daysLeft}d left
                  </span>
                  <span className="text-[#B0C4B0] text-[10px]">{opp.type}</span>
                </div>
                <h3 className="text-[#1B3035] text-sm font-semibold truncate">{opp.name}</h3>
                <p className="text-[#8A9E8A] text-[11px]">{opp.id}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[#8DC63F] text-sm font-bold">{opp.value}</div>
                <div className="text-[#8A9E8A] text-[10px]">Est. Value</div>
              </div>
            </div>

            <div className="mb-3">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-[#8A9E8A]">Win Probability</span>
                <span className={`font-bold ${opp.probability >= 70 ? "text-[#8DC63F]" : opp.probability >= 50 ? "text-[#E07A35]" : "text-[#8A9E8A]"}`}>{opp.probability}%</span>
              </div>
              <div className="h-1.5 bg-[#F5F9F0] rounded-full border border-[#E2EAD8]">
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${opp.probability}%`, backgroundColor: opp.probability >= 70 ? "#8DC63F" : opp.probability >= 50 ? "#E07A35" : "#B0C4B0" }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#4A6A50] text-[11px] font-medium bg-[#F5F9F0] px-2 py-1 rounded-lg border border-[#E2EAD8]">{opp.stage}</span>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1">
                  {Array.from({ length: Math.min(3, opp.resources) }).map((_, i) => (
                    <div key={i} className="w-5 h-5 rounded-full border-2 border-white" style={{ backgroundColor: ["#8DC63F", "#E07A35", "#4A9A9F"][i] }} />
                  ))}
                </div>
                <span className="text-[#8A9E8A] text-[10px]">+{opp.resources}</span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[#E2EAD8] flex gap-2">
              <button className="flex-1 text-xs py-2 bg-[#8DC63F]/10 border border-[#8DC63F]/30 text-[#8DC63F] rounded-xl font-semibold">View RFP</button>
              <button className="flex-1 text-xs py-2 bg-[#E07A35]/10 border border-[#E07A35]/30 text-[#E07A35] rounded-xl">Add Resources</button>
              <button className="flex-1 text-xs py-2 bg-[#F5F9F0] border border-[#E2EAD8] text-[#8A9E8A] rounded-xl">Notify</button>
            </div>
          </div>
        ))}
      </div>

      <BrandNav />
    </div>
  );
}
