import { useState } from "react";

const NavBar = () => (
  <div className="absolute bottom-0 left-0 right-0 bg-[#0A1628] border-t border-[#1E3A5F] px-2 py-2 flex justify-around z-20">
    {[
      { icon: "🏠", label: "Home", id: "home" },
      { icon: "💬", label: "Chat", id: "chat", active: true },
      { icon: "📊", label: "Projects", id: "projects" },
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

type Message = { role: "user" | "ai"; text: string; actions?: string[] };

const initialMessages: Message[] = [
  {
    role: "ai",
    text: "Hi Sanket! I'm your AI Resource Manager. I can help you with project timelines, resource allocations, RFP workflows, and more.\n\nWhat would you like to work on today?",
    actions: ["View Project Timelines", "Check Underutilized Resources", "Create New Opportunity"],
  },
  {
    role: "user",
    text: "Show me resources under 85% allocation",
  },
  {
    role: "ai",
    text: "Found 7 resources currently under 85% allocation threshold. Here's the summary:",
    actions: ["View Full Table", "Reallocate Resources", "Send Notifications"],
  },
];

const ResourceChip = ({ name, pct, skill }: { name: string; pct: number; skill: string }) => (
  <div className="flex items-center gap-2 bg-[#0A1628] rounded-xl px-3 py-2.5 border border-[#1E3A5F]">
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#1D4ED8] to-[#3B82F6] flex items-center justify-center flex-shrink-0">
      <span className="text-white text-[10px] font-bold">{name.split(" ").map(n => n[0]).join("")}</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-[#94A3B8] text-[11px] font-medium truncate">{name}</div>
      <div className="text-[#64748B] text-[9px]">{skill}</div>
    </div>
    <div className={`text-xs font-bold px-2 py-0.5 rounded-full ${pct < 70 ? "text-[#EF4444] bg-[#1C0A0A]" : "text-[#F59E0B] bg-[#1C1100]"}`}>
      {pct}%
    </div>
  </div>
);

export function AIChatbot() {
  const [input, setInput] = useState("");
  const [isVoice, setIsVoice] = useState(false);

  return (
    <div className="w-[390px] h-[844px] bg-[#0A1628] flex flex-col overflow-hidden mx-auto relative">
      <div className="flex items-center justify-between px-5 pt-12 pb-3 border-b border-[#1E3A5F]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6366F1] to-[#3B82F6] flex items-center justify-center relative">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#22C55E] border-2 border-[#0A1628]" />
          </div>
          <div>
            <h2 className="text-white text-sm font-bold">RM AI Assistant</h2>
            <p className="text-[#22C55E] text-[10px]">● Online · GPT-4o</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="w-8 h-8 rounded-lg bg-[#0F2040] border border-[#1E3A5F] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <button className="w-8 h-8 rounded-lg bg-[#0F2040] border border-[#1E3A5F] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-6">
        {initialMessages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            {msg.role === "ai" && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#6366F1] to-[#3B82F6] flex items-center justify-center flex-shrink-0 mt-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              </div>
            )}
            <div className={`max-w-[75%] ${msg.role === "user" ? "" : ""}`}>
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                msg.role === "user"
                  ? "bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white rounded-tr-md"
                  : "bg-[#0F2040] border border-[#1E3A5F] text-[#CBD5E1] rounded-tl-md"
              }`}>
                {msg.text}
              </div>
              {msg.role === "ai" && i === 2 && (
                <div className="mt-2 space-y-1.5">
                  <ResourceChip name="Alex Johnson" pct={62} skill="Project Manager" />
                  <ResourceChip name="Maria Santos" pct={75} skill="Estimator" />
                  <ResourceChip name="David Kim" pct={68} skill="Field Supervisor" />
                </div>
              )}
              {msg.actions && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.actions.map((a) => (
                    <button key={a} className="text-[11px] px-3 py-1.5 bg-[#0F2040] border border-[#2563EB] text-[#60A5FA] rounded-full hover:bg-[#1E3A5F] transition-colors">
                      {a}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 pb-20 pt-2">
        <div className="flex items-center gap-2 bg-[#0F2040] border border-[#1E3A5F] rounded-2xl px-4 py-3">
          <input
            type="text"
            placeholder="Ask about projects, resources, RFPs..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-transparent text-[#94A3B8] text-sm outline-none placeholder:text-[#334155]"
          />
          <button
            onClick={() => setIsVoice(!isVoice)}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${isVoice ? "bg-[#EF4444]" : "bg-[#1E3A5F]"}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
          <button className="w-8 h-8 rounded-xl bg-gradient-to-r from-[#2563EB] to-[#3B82F6] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {["Update project dates", "Find bench resources", "Check RFP status"].map((q) => (
            <button key={q} className="text-[10px] px-3 py-1.5 bg-[#0F2040] border border-[#1E3A5F] text-[#64748B] rounded-full whitespace-nowrap flex-shrink-0">
              {q}
            </button>
          ))}
        </div>
      </div>

      <NavBar />
    </div>
  );
}
