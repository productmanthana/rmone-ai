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

const resources = [
  { name: "Sarah Chen", role: "Lead Architect", alloc: 100, added: true, initials: "SC" },
  { name: "Carlos Ruiz", role: "Structural Eng.", alloc: 80, added: true, initials: "CR" },
  { name: "Emily Zhao", role: "MEP Coordinator", alloc: 60, added: false, initials: "EZ" },
  { name: "James Wilson", role: "Cost Estimator", alloc: 40, added: false, initials: "JW" },
];

export function BrandRFPDetail() {
  const [step, setStep] = useState(2);
  const [laborCost, setLaborCost] = useState(2450000);
  const [notified, setNotified] = useState(false);

  const steps = ["Create", "Estimate", "Resources", "Submit"];

  return (
    <div className="w-[390px] h-[844px] bg-[#F5F9F0] flex flex-col overflow-hidden mx-auto relative">
      <div className="absolute top-0 left-0 right-0 h-[4px] bg-[#8DC63F]" />

      <div className="bg-white border-b border-[#E2EAD8] flex items-center gap-3 px-5 pt-12 pb-3">
        <button className="w-8 h-8 rounded-lg bg-[#F5F9F0] border border-[#E2EAD8] flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A9E8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className="flex-1">
          <h2 className="text-[#1B3035] text-base font-bold">Riverside Medical Center</h2>
          <p className="text-[#8A9E8A] text-[11px]">OPP-26-0042 · RFP Response</p>
        </div>
        <div className="text-[#E07A35] text-xs font-bold bg-[#E07A35]/10 px-2 py-1 rounded-lg border border-[#E07A35]/30">5 days left</div>
      </div>

      <div className="px-5 py-4 bg-white border-b border-[#E2EAD8]">
        <div className="flex items-center gap-0">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <button
                  onClick={() => setStep(i)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    i < step ? "bg-[#8DC63F] text-white" :
                    i === step ? "bg-[#8DC63F] text-white ring-2 ring-[#8DC63F] ring-offset-2 ring-offset-white" :
                    "bg-[#E2EAD8] text-[#B0C4B0]"
                  }`}>
                  {i < step ? "✓" : i + 1}
                </button>
                <span className={`text-[9px] mt-1 font-medium ${i === step ? "text-[#8DC63F]" : "text-[#B0C4B0]"}`}>{s}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 -mt-4 ${i < step ? "bg-[#8DC63F]" : "bg-[#E2EAD8]"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 pb-24 space-y-4">
        <div className="bg-white border border-[#E2EAD8] rounded-2xl p-4 shadow-sm">
          <h4 className="text-[#1B3035] text-sm font-semibold mb-3">General Conditions</h4>
          <div className="space-y-2">
            {[
              { label: "Contract Type", value: "GMP - Guaranteed Max Price" },
              { label: "Project Duration", value: "18 months" },
              { label: "Location", value: "Riverside, CA" },
              { label: "Scope", value: "Medical facility, 120,000 sq ft" },
            ].map((f) => (
              <div key={f.label} className="flex justify-between items-center py-1.5 border-b border-[#E2EAD8]/50 last:border-0">
                <span className="text-[#8A9E8A] text-xs">{f.label}</span>
                <span className="text-[#1B3035] text-xs font-medium">{f.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-[#E2EAD8] rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[#1B3035] text-sm font-semibold">Labor Cost Estimate</h4>
            <button className="text-[#8DC63F] text-xs font-semibold">Edit</button>
          </div>
          <div className="bg-[#F5F9F0] border border-[#E2EAD8] rounded-xl p-3 mb-3">
            <div className="flex justify-between items-center">
              <span className="text-[#8A9E8A] text-xs">Total Labor Cost</span>
              <span className="text-[#8DC63F] text-xl font-bold">${(laborCost / 1000000).toFixed(2)}M</span>
            </div>
            <input
              type="range" min={1000000} max={5000000} step={50000} value={laborCost}
              onChange={(e) => setLaborCost(Number(e.target.value))}
              className="w-full h-1.5 rounded-full mt-2 appearance-none"
              style={{ accentColor: "#8DC63F" }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Direct Labor", value: `$${((laborCost * 0.65) / 1000).toFixed(0)}K`, color: "text-[#8DC63F]" },
              { label: "Subcontractor", value: `$${((laborCost * 0.25) / 1000).toFixed(0)}K`, color: "text-[#4A9A9F]" },
              { label: "Overhead", value: `$${((laborCost * 0.07) / 1000).toFixed(0)}K`, color: "text-[#E07A35]" },
              { label: "Contingency", value: `$${((laborCost * 0.03) / 1000).toFixed(0)}K`, color: "text-[#8A9E8A]" },
            ].map((c) => (
              <div key={c.label} className="bg-[#F5F9F0] border border-[#E2EAD8] rounded-xl p-2.5 text-center">
                <div className={`text-sm font-bold ${c.color}`}>{c.value}</div>
                <div className="text-[#8A9E8A] text-[10px]">{c.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-[#E2EAD8] rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[#1B3035] text-sm font-semibold">Resource Assignment</h4>
            <button className="flex items-center gap-1 text-[#8DC63F] text-xs font-semibold bg-[#8DC63F]/10 px-2 py-1 rounded-lg border border-[#8DC63F]/20">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add
            </button>
          </div>
          <div className="space-y-2">
            {resources.map((r) => (
              <div key={r.name} className={`flex items-center gap-3 p-3 rounded-xl border ${r.added ? "border-[#8DC63F]/30 bg-[#8DC63F]/5" : "border-[#E2EAD8] bg-[#F5F9F0]"}`}>
                <div className="w-8 h-8 rounded-full bg-[#8DC63F] flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[10px] font-black">{r.initials}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[#1B3035] text-xs font-semibold truncate">{r.name}</div>
                  <div className="text-[#8A9E8A] text-[10px]">{r.role}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold ${r.alloc >= 80 ? "text-[#8DC63F]" : "text-[#E07A35]"}`}>{r.alloc}%</span>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${r.added ? "bg-[#8DC63F]" : "bg-[#E2EAD8]"}`}>
                    {r.added ? <span className="text-white text-[9px] font-black">✓</span> : <span className="text-[#B0C4B0] text-[9px]">+</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-[#E2EAD8] rounded-2xl p-4 shadow-sm">
          <h4 className="text-[#1B3035] text-sm font-semibold mb-3">Team Notifications</h4>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 rounded-xl bg-[#E07A35]/10 border border-[#E07A35]/30 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#E07A35" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <p className="text-[#4A6A50] text-xs leading-relaxed">
              {notified
                ? "✅ Marketing team and 4 estimators notified about this RFP."
                : "Notify Marketing, Estimators, and Project Executives to collaborate on this RFP."
              }
            </p>
          </div>
          <button
            onClick={() => setNotified(!notified)}
            className={`w-full text-sm py-3 rounded-xl font-bold shadow-sm transition-all ${notified ? "bg-[#8DC63F]/10 border-2 border-[#8DC63F] text-[#8DC63F]" : "bg-[#8DC63F] text-white"}`}
          >
            {notified ? "✓ Notifications Sent" : "Send Team Notifications"}
          </button>
        </div>
      </div>

      <BrandNav />
    </div>
  );
}
