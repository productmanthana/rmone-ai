import React, { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Command,
  FileText,
  FolderKanban,
  Search,
  SlidersHorizontal,
  Users,
  Zap,
} from "lucide-react";

type RecordItem = {
  name: string;
  id: string;
  meta: string;
  status: string;
};

const records: RecordItem[] = [
  { name: "Riverside Medical Tower", id: "PMM-26-000010", meta: "Pre-construction · Boston, MA", status: "Active" },
  { name: "Harbor Point Substation", id: "OPM-25-000023", meta: "Electrical · Portland, OR", status: "At risk" },
  { name: "Northline Transit Hub", id: "PRJ-9202", meta: "Infrastructure · Seattle, WA", status: "Planning" },
];

const actionNodes = [
  { label: "Change status", desc: "Move the record forward", icon: Activity, tint: "#74d7b2" },
  { label: "Add a note", desc: "Log an update or observation", icon: FileText, tint: "#8fb7ff" },
  { label: "Manage team", desc: "Assign roles and availability", icon: Users, tint: "#d4b77a" },
  { label: "Edit dates", desc: "Shift mobilization milestones", icon: CalendarDays, tint: "#cf9be7" },
];

export default function HybridDark() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RecordItem>(records[0]);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const matches = useMemo(() => {
    if (!query.trim()) return records;
    const needle = query.toLowerCase();
    return records.filter((record) =>
      `${record.name} ${record.id} ${record.meta}`.toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <main className="hybrid-dark-theme min-h-[100dvh] overflow-auto bg-[#07100f] text-[#e7f1ec] selection:bg-[#74d7b2]/30">
      <style>{`
        .hybrid-dark-theme{background:#07100f!important;color:#e7f1ec!important;font-family:ui-sans-serif,system-ui,sans-serif}
        .hybrid-dark-theme>div{background:#0a1513!important}
        .hybrid-dark-theme header{background:rgba(11,23,21,.94)!important}
        .hybrid-dark-theme header,.hybrid-dark-theme footer,.hybrid-dark-theme>div>section{border-color:#1c3631!important}
        .hybrid-dark-theme>div>section:first-of-type{display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr}
        .hybrid-dark-theme>div>section:nth-of-type(2){display:grid;grid-template-columns:310px minmax(0,1fr) 274px}
        .hybrid-dark-theme>div>section:nth-of-type(2) aside>div,.hybrid-dark-theme>div>section:nth-of-type(2) .relative.mt-12{background:rgba(13,28,25,.9)!important;border-color:#23483d!important}
        .hybrid-dark-theme input{color:#f0faf5!important}
        .hybrid-dark-theme input::placeholder{color:#608278!important}
        @media(max-width:900px){.hybrid-dark-theme>div>section:first-of-type,.hybrid-dark-theme>div>section:nth-of-type(2){grid-template-columns:1fr}.hybrid-dark-theme>div>section:nth-of-type(2) aside{order:initial!important}.hybrid-dark-theme>div>section:first-of-type>div{border-left:0!important;padding-left:0!important}}
      `}</style>
      <div className="relative mx-auto min-h-[900px] w-full max-w-[1280px] overflow-hidden border-x border-[#1b3430] bg-[#0a1513]">
        <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(rgba(105,180,150,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(105,180,150,.06) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
        <div className="pointer-events-none absolute -right-32 top-16 h-[520px] w-[520px] rounded-full bg-[#286d5a]/10 blur-3xl" />
        <div className="pointer-events-none absolute left-1/3 top-[420px] h-[320px] w-[320px] rounded-full bg-[#296a71]/10 blur-3xl" />

        <header className="relative z-20 flex h-[76px] items-center justify-between border-b border-[#1c3631] bg-[#0b1715]/90 px-8 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#74d7b2]/50 bg-[#16352e] text-[#74d7b2] shadow-[0_0_24px_rgba(116,215,178,.16)]">
              <Command size={16} strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[15px] font-semibold tracking-[.22em] text-[#edf7f1]">RM ONE</div>
              <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[.21em] text-[#78a597]">Operational Intelligence</div>
            </div>
          </div>
          <div className="flex items-center gap-5 text-[10px] uppercase tracking-[.16em] text-[#78a597]">
            <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#74d7b2] shadow-[0_0_10px_#74d7b2]" />Live workspace</span>
            <span className="hidden border-l border-[#27453e] pl-5 sm:inline">Tue · 14:32:08 EST</span>
            <button aria-label="Open filters" onClick={() => setActiveAction("Workspace filters")} className="rounded-md border border-[#2a4a42] p-2 text-[#91afa4] transition hover:border-[#74d7b2] hover:text-[#74d7b2]"><SlidersHorizontal size={15} /></button>
          </div>
        </header>

        <section className="relative z-10 grid grid-cols-1 gap-5 border-b border-[#1c3631] px-8 py-5 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          {[
            { value: "42", label: "Live projects", note: "+4 this month", icon: FolderKanban, color: "#74d7b2" },
            { value: "3", label: "Need a team", note: "Action required", icon: Users, color: "#e4b77d" },
            { value: "18", label: "Room this week", note: "Available people", icon: Activity, color: "#8fb7ff" },
            { value: "7", label: "Touched today", note: "Across 5 records", icon: Zap, color: "#cf9be7" },
          ].map(({ value, label, note, icon: Icon, color }, index) => (
            <div key={label} className={`flex items-center gap-4 ${index ? "border-l border-[#1d3933] pl-5" : ""}`}>
              <Icon size={15} style={{ color }} />
              <div><div className="font-mono text-[25px] leading-none tracking-[-.05em] text-[#eff8f3]">{value}</div><div className="mt-1 text-[11px] text-[#acc0b8]">{label}</div></div>
              <div className="ml-auto hidden text-right text-[9px] uppercase tracking-[.12em] text-[#66867b] lg:block">{note}</div>
            </div>
          ))}
        </section>

        <section className="relative z-10 grid grid-cols-1 gap-8 px-8 pb-10 pt-10 lg:grid-cols-[310px_1fr_274px]">
          <aside className="order-2 space-y-5 lg:order-1">
            <div className="rounded-xl border border-[#23433a] bg-[#0d1c19]/80 p-5">
              <div className="mb-5 flex items-center justify-between"><h2 className="text-[11px] font-semibold uppercase tracking-[.18em] text-[#a9c0b7]">Weekly load</h2><span className="font-mono text-[10px] text-[#6e9a8c]">W21</span></div>
              <div className="flex items-end gap-3 border-b border-[#234139] pb-2" style={{ height: "100px", borderBottomColor: "#234139" }}>
                {[42, 57, 48, 76, 63, 84, 68].map((height, index) => <div key={index} className="group flex flex-1 flex-col items-center gap-2"><div className="w-full rounded-t-sm transition hover:bg-[#74d7b2]" style={{ height: `${height}%`, opacity: index === 5 ? 1 : .65, backgroundColor: index === 5 ? "#74d7b2" : "#2d6254" }} /><span className="font-mono text-[9px] text-[#66867b]">{["M", "T", "W", "T", "F", "S", "S"][index]}</span></div>)}
              </div>
              <div className="mt-4 flex justify-between text-[10px]"><span className="text-[#78988d]">Utilization</span><span className="font-mono text-[#d7e9e1]">78.4%</span></div>
              <div className="mt-2 h-1 rounded-full bg-[#19352f]"><div className="h-1 w-[78%] rounded-full bg-[#74d7b2]" /></div>
            </div>
            <div className="rounded-xl border border-[#23433a] bg-[#0d1c19]/80 p-5">
              <div className="mb-4 flex items-center gap-2"><Activity size={14} className="text-[#74d7b2]" /><h2 className="text-[11px] font-semibold uppercase tracking-[.18em] text-[#a9c0b7]">Recent signals</h2></div>
              <div className="space-y-4">
                {["Riverside Medical Tower", "Harbor Point Substation", "Senior Project Manager"].map((item, i) => <div key={item} className="flex gap-3"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${i === 1 ? "bg-[#e4b77d]" : "bg-[#74d7b2]"}`} /><div><div className="text-[11px] text-[#d7e6df]">{item}</div><div className="mt-1 text-[10px] text-[#6d8d83]">{i === 0 ? "Status shifted to active" : i === 1 ? "Electrical estimator unassigned" : "Availability updated · 9m ago"}</div></div></div>)}
              </div>
            </div>
          </aside>

          <section className="order-1 lg:order-2">
            <div className="mb-6"><div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.2em] text-[#74d7b2]"><span className="h-px w-6 bg-[#74d7b2]" />Command workspace</div><h1 className="text-[32px] font-medium tracking-[-.035em] text-[#edf6f1]">Find the work. <span className="text-[#75bfa7]">Move it forward.</span></h1><p className="mt-2 max-w-[490px] text-[13px] leading-6 text-[#78988d]">Search a project, person, or client to open the right operational action.</p></div>
            <div className="relative">
              <div className="absolute -inset-1 rounded-xl bg-[#58c9a4]/10 blur-lg" />
              <div className="relative flex items-center rounded-xl border border-[#4a9079] bg-[#0e211c] shadow-[0_0_30px_rgba(61,190,150,.12)] focus-within:border-[#9aead0]">
                <Search className="ml-5 text-[#74d7b2]" size={21} />
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, ID, client, or person..." className="w-full bg-transparent px-4 py-5 text-[14px] text-[#f0faf5] outline-none placeholder:text-[#608278]" />
                <kbd className="mr-4 hidden rounded border border-[#31584c] px-2 py-1 font-mono text-[10px] text-[#76998d] sm:block">/</kbd>
              </div>
              {query && <div className="absolute left-0 right-0 top-[68px] z-50 rounded-xl border border-[#31584c] bg-[#10231f] p-2 shadow-2xl">{matches.length ? matches.map((record) => <button key={record.id} onClick={() => { setSelected(record); setQuery(""); }} className="flex w-full items-center justify-between rounded-lg p-3 text-left hover:bg-[#18332b]"><span><span className="block text-[12px] text-[#e2f0e9]">{record.name}</span><span className="font-mono text-[10px] text-[#6d978a]">{record.id}</span></span><ChevronRight size={15} className="text-[#74d7b2]" /></button>) : <div className="p-3 text-[12px] text-[#89a89d]">No records match that search.</div>}</div>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[#66867b]"><span className="mr-1 uppercase tracking-[.15em]">Try</span>{["PMM-26-000010", "Harbor Point", "Senior Project Manager"].map((chip) => <button key={chip} onClick={() => setQuery(chip)} className="rounded-full border border-[#294b41] px-3 py-1.5 text-[#9ab9ae] transition hover:border-[#74d7b2] hover:text-[#d8f2e7]">{chip}</button>)}</div>

            <div className="relative mt-12 min-h-[340px] rounded-2xl border border-[#23483d] bg-[#0b1916]/80 p-6">
              <div className="absolute left-6 top-5 text-[10px] font-semibold uppercase tracking-[.2em] text-[#759d90]">Operation flow <span className="ml-2 font-mono text-[#456c60]">// 01</span></div>
              <div className="mt-8 flex items-center gap-3 rounded-lg border border-[#24493e] bg-[#11251f] px-4 py-3"><div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1b493c] text-[#74d7b2]"><Check size={15} /></div><div className="min-w-0"><div className="truncate text-[12px] text-[#e2f0e9]">{selected.name}</div><div className="font-mono text-[10px] text-[#70958a]">{selected.id} · {selected.status}</div></div><span className="ml-auto text-[10px] text-[#74d7b2]">Selected</span></div>
              <svg aria-hidden="true" className="pointer-events-none absolute left-[84px] top-[122px] h-[148px] w-[calc(100%-84px)] overflow-visible" viewBox="0 0 490 148" preserveAspectRatio="none"><path d="M0 0 C 90 0, 84 148, 180 148 M0 0 C 170 0, 190 148, 300 148 M0 0 C 230 0, 300 148, 420 148" fill="none" stroke="#397565" strokeWidth="1.2" strokeDasharray="4 7" /><circle cx="0" cy="0" r="3" fill="#74d7b2" /><circle cx="180" cy="148" r="3" fill="#74d7b2" /><circle cx="300" cy="148" r="3" fill="#8fb7ff" /><circle cx="420" cy="148" r="3" fill="#d4b77a" /></svg>
              <div className="relative mt-[105px] grid grid-cols-3 gap-3">{actionNodes.slice(0, 3).map(({ label, desc, icon: Icon, tint }) => <button key={label} onClick={() => setActiveAction(label)} className="group rounded-xl border border-[#2a5145] bg-[#10221e] p-4 text-left transition hover:-translate-y-1 hover:border-[#74d7b2] hover:bg-[#153129]"><div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border" style={{ color: tint, borderColor: `${tint}55`, backgroundColor: `${tint}12` }}><Icon size={16} /></div><div className="text-[12px] font-medium text-[#e1eee8]">{label}</div><div className="mt-1 text-[10px] leading-4 text-[#78978d]">{desc}</div><ArrowUpRight size={14} className="mt-4 text-[#4d7568] transition group-hover:text-[#74d7b2]" /></button>)}</div>
            </div>
          </section>

          <aside className="order-3 space-y-5">
            <div className="rounded-xl border border-[#23433a] bg-[#0d1c19]/80 p-5">
              <div className="mb-4 flex items-center justify-between"><h2 className="text-[11px] font-semibold uppercase tracking-[.18em] text-[#a9c0b7]">Fleet pulse</h2><span className="font-mono text-[10px] text-[#74d7b2]">LIVE</span></div>
              <div className="relative mx-auto h-[142px] w-[142px]"><svg className="-rotate-90" viewBox="0 0 100 100"><circle cx="50" cy="50" r="39" fill="none" stroke="#1b3931" strokeWidth="7" /><circle cx="50" cy="50" r="39" fill="none" stroke="#74d7b2" strokeWidth="7" strokeDasharray="245" strokeDashoffset="39" strokeLinecap="round" /><circle cx="50" cy="50" r="29" fill="none" stroke="#294b40" strokeWidth="1" strokeDasharray="2 4" /></svg><div className="absolute inset-0 flex flex-col items-center justify-center"><span className="font-mono text-[30px] tracking-[-.08em] text-[#eef8f2]">84<span className="text-[14px] text-[#74d7b2]">%</span></span><span className="text-[9px] uppercase tracking-[.16em] text-[#78988d]">allocated</span></div></div>
              <div className="mt-4 space-y-3"><div className="flex justify-between text-[11px]"><span className="text-[#78988d]">Available now</span><span className="font-mono text-[#d9ebe3]">18 / 142</span></div><div className="flex justify-between text-[11px]"><span className="text-[#78988d]">Senior PMs open</span><span className="font-mono text-[#e4b77d]">2</span></div></div>
            </div>
            <div className="rounded-xl border border-[#513f2a] bg-[#211b14]/70 p-5"><div className="mb-3 text-[10px] font-semibold uppercase tracking-[.18em] text-[#d6b47d]">Needs attention</div><div className="text-[20px] font-medium text-[#f0e4d3]">3 jobs</div><p className="mt-1 text-[11px] leading-5 text-[#aa9273]">have no assigned team member. Start with Harbor Point Substation.</p><button onClick={() => setQuery("Harbor Point")} className="mt-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.14em] text-[#e4b77d] hover:text-[#f5d7a4]">Review queue <ChevronRight size={13} /></button></div>
          </aside>
        </section>

        <footer className="relative z-10 flex items-center justify-between border-t border-[#1c3631] px-8 py-3 text-[9px] uppercase tracking-[.16em] text-[#55796d]"><span>RM ONE / Quick actions</span><span className="hidden sm:inline">Encrypted workspace · response 12ms</span></footer>
        {activeAction && <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-[#74d7b2]/50 bg-[#15362d] px-5 py-3 text-[12px] text-[#dff7ec] shadow-xl">Ready to {activeAction.toLowerCase()} on {selected.name}<button onClick={() => setActiveAction(null)} className="ml-4 text-[#74d7b2]" aria-label="Dismiss notification">×</button></div>}
      </div>
    </main>
  );
}