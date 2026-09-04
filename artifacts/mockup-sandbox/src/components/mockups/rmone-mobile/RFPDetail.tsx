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

const resources = [
  { name: "Sarah Chen", role: "Lead Architect", alloc: 100, added: true },
  { name: "Carlos Ruiz", role: "Structural Eng.", alloc: 80, added: true },
  { name: "Emily Zhao", role: "MEP Coordinator", alloc: 60, added: false },
  { name: "James Wilson", role: "Cost Estimator", alloc: 40, added: false },
];

export function RFPDetail() {
  const [step, setStep] = useState(2);
  const [laborCost, setLaborCost] = useState(2450000);
  const [notified, setNotified] = useState(false);

  const steps = ["Create", "Estimate", "Resources", "Submit"];

  return (
    <div className="w-[390px] h-[844px] bg-[#0A1628] flex flex-col overflow-hidden mx-auto relative">
      <div className="flex items-center gap-3 px-5 pt-12 pb-3">
        <button className="w-8 h-8 rounded-lg bg-[#0F2040] border border-[#1E3A5F] flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className="flex-1">
          <h2 className="text-white text-base font-bold">Riverside Medical Center</h2>
          <p className="text-[#64748B] text-[11px]">OPP-26-0042 · RFP Response</p>
        </div>
        <div className="text-right">
          <div className="text-[#EF4444] text-xs font-semibold">5 days left</div>
        </div>
      </div>

      <div className="px-5 mb-4">
        <div className="flex items-center gap-0">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center flex-1">
              <div className={`flex flex-col items-center ${i < steps.length - 1 ? "flex-1" : ""}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  i < step ? "bg-[#22C55E] text-white" :
                  i === step ? "bg-[#3B82F6] text-white ring-2 ring-[#3B82F6] ring-offset-2 ring-offset-[#0A1628]" :
                  "bg-[#1E3A5F] text-[#475569]"
                }`}>
                  {i < step ? "✓" : i + 1}
                </div>
                <span className={`text-[9px] mt-1 ${i === step ? "text-[#3B82F6] font-semibold" : "text-[#475569]"}`}>{s}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 -mt-4 ${i < step ? "bg-[#22C55E]" : "bg-[#1E3A5F]"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-4">
        <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-2xl p-4">
          <h4 className="text-white text-sm font-semibold mb-3">General Conditions</h4>
          <div className="space-y-2">
            {[
              { label: "Contract Type", value: "GMP - Guaranteed Max Price" },
              { label: "Project Duration", value: "18 months" },
              { label: "Location", value: "Riverside, CA" },
              { label: "Scope", value: "Medical facility, 120,000 sq ft" },
            ].map((f) => (
              <div key={f.label} className="flex justify-between">
                <span className="text-[#64748B] text-xs">{f.label}</span>
                <span className="text-[#94A3B8] text-xs font-medium">{f.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-white text-sm font-semibold">Labor Cost Estimate</h4>
            <button className="text-[#3B82F6] text-xs">Edit</button>
          </div>
          <div className="bg-[#0A1628] border border-[#1E3A5F] rounded-xl p-3 mb-3">
            <div className="flex justify-between items-center">
              <span className="text-[#64748B] text-xs">Total Labor Cost</span>
              <span className="text-white text-lg font-bold">${(laborCost / 1000000).toFixed(2)}M</span>
            </div>
            <input
              type="range" min={1000000} max={5000000} step={50000} value={laborCost}
              onChange={(e) => setLaborCost(Number(e.target.value))}
              className="w-full accent-blue-500 h-1 mt-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Direct Labor", value: `$${((laborCost * 0.65) / 1000).toFixed(0)}K` },
              { label: "Subcontractor", value: `$${((laborCost * 0.25) / 1000).toFixed(0)}K` },
              { label: "Overhead", value: `$${((laborCost * 0.07) / 1000).toFixed(0)}K` },
              { label: "Contingency", value: `$${((laborCost * 0.03) / 1000).toFixed(0)}K` },
            ].map((c) => (
              <div key={c.label} className="bg-[#0A1628] border border-[#1E3A5F] rounded-xl p-2.5 text-center">
                <div className="text-white text-sm font-semibold">{c.value}</div>
                <div className="text-[#64748B] text-[10px]">{c.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-white text-sm font-semibold">Resource Assignment</h4>
            <button className="flex items-center gap-1 text-[#3B82F6] text-xs">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add
            </button>
          </div>
          <div className="space-y-2">
            {resources.map((r) => (
              <div key={r.name} className={`flex items-center gap-3 p-3 rounded-xl border ${r.added ? "border-[#1E4D3A] bg-[#051F10]" : "border-[#1E3A5F] bg-[#0A1628]"}`}>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#1D4ED8] to-[#6366F1] flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[10px] font-bold">{r.name.split(" ").map(n => n[0]).join("")}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[#94A3B8] text-xs font-medium truncate">{r.name}</div>
                  <div className="text-[#64748B] text-[10px]">{r.role}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium ${r.alloc >= 80 ? "text-[#22C55E]" : "text-[#F59E0B]"}`}>{r.alloc}%</span>
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center ${r.added ? "bg-[#22C55E]" : "bg-[#1E3A5F]"}`}>
                    {r.added ? <span className="text-white text-[8px]">✓</span> : <span className="text-[#475569] text-[8px]">+</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#0F2040] border border-[#1E3A5F] rounded-2xl p-4">
          <h4 className="text-white text-sm font-semibold mb-3">Team Notifications</h4>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 rounded-xl bg-[#1C1100] border border-[#F59E0B] flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <p className="text-[#94A3B8] text-xs leading-relaxed">
              {notified
                ? "✅ Marketing team and 4 estimators notified about RFP requirements."
                : "Notify Marketing, Estimators, and Project Executives about this RFP opportunity."
              }
            </p>
          </div>
          <button
            onClick={() => setNotified(!notified)}
            className={`w-full text-sm py-3 rounded-xl font-medium transition-all ${notified ? "bg-[#052E16] border border-[#22C55E] text-[#22C55E]" : "bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white"}`}
          >
            {notified ? "✓ Notifications Sent" : "Send Team Notifications"}
          </button>
        </div>
      </div>

      <NavBar />
    </div>
  );
}
