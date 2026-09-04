import { useState } from "react";

const BrandNav = () => (
  <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-[#E2EAD8] px-2 py-2 flex justify-around z-20 shadow-sm">
    {[
      { icon: "🏠", label: "Home", id: "home" },
      { icon: "💬", label: "Chat", id: "chat", active: true },
      { icon: "📊", label: "Projects", id: "projects" },
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

type Message = { role: "user" | "ai"; text: string; actions?: string[] };

const messages: Message[] = [
  {
    role: "ai",
    text: "Hi Sanket! I'm AI RMONE Agents.\n\nAsk me anything about your projects, resources, or pipeline — in plain English or by voice.",
    actions: ["View Project Timelines", "Find Bench Resources", "Create Opportunity"],
  },
  { role: "user", text: "Show me resources under 85% allocation" },
  {
    role: "ai",
    text: "Found 7 resources under 85% threshold. 3 are critically under-allocated (below 70%). Would you like to reassign or notify?",
    actions: ["View Full Table", "Reassign Resources", "Send Notifications"],
  },
];

const ResourceChip = ({ name, pct, skill }: { name: string; pct: number; skill: string }) => (
  <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-[#E2EAD8] shadow-sm">
    <div className="w-7 h-7 rounded-full bg-[#8DC63F] flex items-center justify-center flex-shrink-0">
      <span className="text-white text-[10px] font-black">{name.split(" ").map(n => n[0]).join("")}</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-[#1B3035] text-[11px] font-semibold truncate">{name}</div>
      <div className="text-[#8A9E8A] text-[9px]">{skill}</div>
    </div>
    <div className={`text-xs font-bold px-2 py-0.5 rounded-full ${pct < 70 ? "text-[#E07A35] bg-[#E07A35]/10" : "text-[#8DC63F] bg-[#8DC63F]/10"}`}>
      {pct}%
    </div>
  </div>
);

export function BrandChatbot() {
  const [input, setInput] = useState("");
  const [isVoice, setIsVoice] = useState(false);

  return (
    <div className="w-[390px] h-[844px] bg-[#F5F9F0] flex flex-col overflow-hidden mx-auto relative">
      <div className="absolute top-0 left-0 right-0 h-[4px] bg-[#8DC63F]" />

      <div className="bg-white flex items-center justify-between px-5 pt-12 pb-3 border-b border-[#E2EAD8]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#8DC63F] flex items-center justify-center relative">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#8DC63F] border-2 border-white" />
          </div>
          <div>
            <h2 className="text-[#1B3035] text-sm font-bold">AI RMONE Agents</h2>
            <p className="text-[#8DC63F] text-[10px] font-medium">● Natural language queries</p>
          </div>
        </div>
        <button className="text-[#8DC63F] text-xs px-3 py-1.5 bg-[#8DC63F]/10 border border-[#8DC63F]/30 rounded-lg font-semibold">+ New Chat</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-6">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            {msg.role === "ai" && (
              <div className="w-7 h-7 rounded-full bg-[#8DC63F] flex items-center justify-center flex-shrink-0 mt-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              </div>
            )}
            <div className="max-w-[75%]">
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                msg.role === "user"
                  ? "bg-[#8DC63F] text-white font-medium rounded-tr-md shadow-sm"
                  : "bg-white border border-[#E2EAD8] text-[#1B3035] rounded-tl-md shadow-sm"
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
                    <button key={a} className="text-[11px] px-3 py-1.5 bg-white border border-[#8DC63F]/40 text-[#8DC63F] rounded-full shadow-sm font-medium">
                      {a}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 pb-20 pt-2 bg-white border-t border-[#E2EAD8]">
        <div className="flex items-center gap-2 bg-[#F5F9F0] border border-[#E2EAD8] rounded-2xl px-4 py-3 mt-2">
          <input
            type="text"
            placeholder="Ask anything about your data..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-transparent text-[#1B3035] text-sm outline-none placeholder:text-[#B0C4B0]"
          />
          <button
            onClick={() => setIsVoice(!isVoice)}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${isVoice ? "bg-[#E07A35]" : "bg-[#E2EAD8]"}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isVoice ? "white" : "#8A9E8A"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
          <button className="w-8 h-8 rounded-xl bg-[#8DC63F] flex items-center justify-center shadow-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {["Top 5 projects by fee", "Projects starting next 10 months", "Compare revenue by OPCOs"].map((q) => (
            <button key={q} className="text-[10px] px-3 py-1.5 bg-[#F5F9F0] border border-[#E2EAD8] text-[#8A9E8A] rounded-full whitespace-nowrap flex-shrink-0">
              {q}
            </button>
          ))}
        </div>
      </div>

      <BrandNav />
    </div>
  );
}
