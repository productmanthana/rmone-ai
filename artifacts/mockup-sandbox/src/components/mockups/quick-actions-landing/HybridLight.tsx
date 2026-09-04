import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDot,
  FileText,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';

type RecordItem = {
  name: string;
  id: string;
  meta: string;
  kind: string;
  status: string;
};

const records: RecordItem[] = [
  { name: 'Riverside Medical Tower', id: 'PMM-26-000010', meta: 'Medical · Phoenix, AZ', kind: 'Project', status: 'Active' },
  { name: 'Harbor Point Substation', id: 'OPM-25-000023', meta: 'Infrastructure · Tacoma, WA', kind: 'Project', status: 'Pre-con' },
  { name: 'Senior Project Manager', id: 'ROLE-0048', meta: 'People · West region', kind: 'Role', status: '2 available' },
];

const ActionCard = ({
  icon: Icon,
  title,
  copy,
  accent,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  copy: string;
  accent: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="group w-[220px] rounded-[18px] border border-[#d8ded4] bg-[#fbfcf8] p-4 text-left shadow-[0_12px_24px_rgba(46,65,45,0.07)] transition-all duration-200 hover:-translate-y-1 hover:border-[#8ba677] hover:shadow-[0_16px_32px_rgba(46,65,45,0.13)] focus:outline-none focus:ring-2 focus:ring-[#76965d] focus:ring-offset-2"
  >
    <div className="mb-3 flex items-center justify-between">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ backgroundColor: accent }}>
        <Icon size={17} strokeWidth={2.2} />
      </span>
      <ArrowUpRight size={16} className="text-[#9ba79a] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </div>
    <div className="text-[14px] font-semibold tracking-[-0.01em] text-[#263329]">{title}</div>
    <div className="mt-1 text-[11px] leading-[1.45] text-[#748076]">{copy}</div>
  </button>
);

export default function HybridLight() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RecordItem | null>(records[0]);
  const [notice, setNotice] = useState('');
  const [activeAction, setActiveAction] = useState('Change status');

  const matches = useMemo(() => {
    if (!query.trim()) return records;
    const normalized = query.toLowerCase();
    return records.filter((record) => `${record.name} ${record.id} ${record.meta}`.toLowerCase().includes(normalized));
  }, [query]);

  const chooseRecord = (record: RecordItem) => {
    setSelected(record);
    setQuery(record.name);
    setNotice(`${record.name} selected`);
  };

  const runAction = (action: string) => {
    setActiveAction(action);
    setNotice(`${action} ready for ${selected?.name ?? 'a selected record'}`);
  };

  return (
    <main className="min-h-[900px] w-full overflow-hidden bg-[#f3f4ed] font-sans text-[#263329]">
      <div className="relative mx-auto min-h-[900px] w-full max-w-[1280px] overflow-hidden border-x border-[#e1e5dc] bg-[#f7f8f2]">
        <div className="pointer-events-none absolute inset-0 opacity-50" style={{ backgroundImage: 'linear-gradient(#dfe5da 1px, transparent 1px), linear-gradient(90deg, #dfe5da 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        <div className="pointer-events-none absolute -right-24 top-[-170px] h-[440px] w-[440px] rounded-full bg-[#e7eee1] opacity-80 blur-3xl" />
        <div className="relative">
          <header style={{ height: 74, padding: '0 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} className="border-b border-[#dfe4da] bg-[#f8f9f4]/90 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#31563a] text-[#eaf2e4] shadow-sm">
                <CircleDot size={17} strokeWidth={2.3} />
              </div>
              <div>
                <div className="text-[15px] font-bold tracking-[0.22em] text-[#2c4532]">RM ONE</div>
                <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.19em] text-[#7e8b7d]">Operational Intelligence</div>
              </div>
            </div>
            <div className="flex items-center gap-7 text-[11px] text-[#6e7b70]">
              <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#759d59]" /> All systems operational</span>
              <span className="border-l border-[#dfe4da] pl-7 font-mono text-[10px] tracking-wide">TUE 14:26 · LIVE</span>
              <button type="button" aria-label="Open security details" onClick={() => setNotice('Workspace secured with role-based access')} className="rounded-lg p-1.5 hover:bg-[#e8eee3]"><ShieldCheck size={16} className="text-[#547659]" /></button>
            </div>
          </header>

          <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 356px', gap: 28, padding: '28px 40px 24px' }}>
            <div>
              <div className="mb-5 flex items-end justify-between">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#789078]"><Sparkles size={13} /> Today at a glance</div>
                  <h1 className="text-[30px] font-semibold tracking-[-0.04em] text-[#263329]">Keep work moving.</h1>
                  <p className="mt-1 text-[13px] text-[#7b877c]">Find a project, then make the next useful change.</p>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[#99a398]">Last sync</div>
                  <div className="mt-1 font-mono text-[11px] text-[#5f7563]">14:25:48 · 12ms</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
                {[
                  ['42', 'Live projects', '↑ 4 this month', 'text-[#3d7747]'],
                  ['3', 'Jobs needing a team', 'Needs attention', 'text-[#b16c3e]'],
                  ['18', 'People with room', 'This week', 'text-[#668a55]'],
                  ['7', 'Touched today', 'Across 5 teams', 'text-[#607b83]'],
                ].map(([value, label, detail, color]) => (
                  <div key={label} className="rounded-[15px] border border-[#dde4d9] bg-[#fbfcf8] px-4 py-3 shadow-[0_5px_14px_rgba(53,72,49,0.035)]">
                    <div className={`text-[24px] font-semibold tracking-[-0.05em] ${color}`}>{value}</div>
                    <div className="mt-1 text-[11px] font-medium text-[#526157]">{label}</div>
                    <div className="mt-1.5 text-[9px] uppercase tracking-[0.08em] text-[#9aa69a]">{detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <aside style={{ padding: 16 }} className="rounded-[18px] border border-[#dbe3d6] bg-[#fbfcf8] shadow-[0_8px_20px_rgba(48,69,45,0.05)]">
              <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#526455]"><Activity size={15} className="text-[#6f955d]" /> Capacity pulse</div><span className="rounded-full bg-[#edf4e9] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#67905a]">Healthy</span></div>
              <div className="flex items-center gap-4">
                <div className="relative h-[88px] w-[88px]">
                  <svg viewBox="0 0 100 100" className="-rotate-90"><circle cx="50" cy="50" r="38" fill="none" stroke="#e7ece3" strokeWidth="9" /><circle cx="50" cy="50" r="38" fill="none" stroke="#6f955d" strokeWidth="9" strokeLinecap="round" strokeDasharray="239" strokeDashoffset="38" /></svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[21px] font-semibold text-[#36543d]">84%</span><span className="text-[8px] uppercase tracking-wider text-[#91a092]">utilized</span></div>
                </div>
                <div className="flex-1 space-y-2.5">
                  {[['Project managers', 76, '#6f955d'], ['Estimators', 91, '#b38b58'], ['Superintendents', 63, '#78949a']].map(([label, value, color]) => (
                    <div key={label as string}><div className="mb-1 flex justify-between text-[9px] text-[#778379]"><span>{label}</span><span className="font-mono text-[#53675a]">{value}%</span></div><div className="h-1.5 rounded-full bg-[#e8ede5]"><div className="h-1.5 rounded-full" style={{ width: `${value}%`, backgroundColor: color as string }} /></div></div>
                  ))}
                </div>
              </div>
            </aside>
          </section>

          <section style={{ margin: '0 40px', padding: '28px 32px 32px' }} className="relative rounded-[22px] border border-[#d6dfd1] bg-[#eef2e9]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="absolute left-8 top-0 -translate-y-1/2 bg-[#eef2e9] px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#728775]">The quick actions path</div>
            <div style={{ display: 'grid', gridTemplateColumns: '290px minmax(0, 1fr)', gap: 28 }}>
              <div>
                <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#7c9180]">01 · Search</div>
                <div className="relative">
                  <Search className="absolute left-4 top-4 text-[#6d9161]" size={20} />
                  <input aria-label="Search projects and people" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, ID, client, or person..." className="h-[54px] w-full rounded-[14px] border border-[#b9cdb5] bg-[#fbfcf8] pl-12 pr-10 text-[12px] font-medium text-[#334437] shadow-[0_6px_14px_rgba(55,78,50,0.06)] outline-none placeholder:text-[#9da99d] focus:border-[#6f955d] focus:ring-3 focus:ring-[#cfddca]" />
                  {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-3 top-3 rounded-lg p-2 text-[#829082] hover:bg-[#e9f0e5]"><X size={15} /></button>}
                </div>
                <div className="mt-3 text-[10px] text-[#8a968b]">Try a project, an ID, or a role</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {['PMM-26-000010', 'Harbor Point', 'Senior Project Manager'].map((tag) => <button type="button" key={tag} onClick={() => setQuery(tag)} className="rounded-full border border-[#d2ddd0] bg-[#f9fbf7] px-2.5 py-1 text-[9px] font-medium text-[#69806b] hover:border-[#86a57b] hover:text-[#3f7047]">{tag}</button>)}
                </div>
                {query && <div className="mt-3 overflow-hidden rounded-xl border border-[#dbe4d7] bg-[#fbfcf8]">{matches.length ? matches.map((record) => <button type="button" key={record.id} onClick={() => chooseRecord(record)} className="flex w-full items-center justify-between border-b border-[#e8ede5] px-3 py-2.5 text-left last:border-0 hover:bg-[#eef5eb]"><div><div className="text-[11px] font-semibold text-[#3a5140]">{record.name}</div><div className="font-mono text-[9px] text-[#94a195]">{record.id}</div></div><ChevronRight size={14} className="text-[#91a390]" /></button>) : <div className="px-3 py-3 text-[10px] text-[#89968b]">No matching records</div>}</div>}
              </div>

                <div style={{ position: 'relative', minHeight: 258 }}>
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 600 260" preserveAspectRatio="none"><path d="M 55 124 C 145 124, 148 47, 238 47" fill="none" stroke="#9ab293" strokeWidth="1.5" strokeDasharray="4 5" /><path d="M 55 124 C 145 124, 165 124, 238 124" fill="none" stroke="#9ab293" strokeWidth="1.5" strokeDasharray="4 5" /><path d="M 55 124 C 145 124, 148 204, 238 204" fill="none" stroke="#9ab293" strokeWidth="1.5" strokeDasharray="4 5" /><circle cx="55" cy="124" r="4" fill="#668a55" /><circle cx="238" cy="47" r="4" fill="#668a55" /><circle cx="238" cy="124" r="4" fill="#b38b58" /><circle cx="238" cy="204" r="4" fill="#78949a" /></svg>
                <div className="relative z-10 flex h-full items-center gap-[70px]">
                  <div className="flex w-[110px] flex-col items-center text-center"><div className="flex h-[74px] w-[74px] items-center justify-center rounded-full border-[5px] border-[#d7e4d2] bg-[#3f7047] text-white shadow-[0_8px_18px_rgba(57,94,59,0.18)]"><Search size={25} /></div><div className="mt-3 text-[11px] font-bold uppercase tracking-[0.16em] text-[#46654b]">Search</div><div className="mt-1 text-[9px] text-[#88968a]">Find anything</div></div>
                  <div className="flex flex-1 flex-col gap-3">
                    <ActionCard icon={BriefcaseBusiness} title="Change status" copy="Move a project forward with confidence." accent="#668a55" onClick={() => runAction('Change status')} />
                    <ActionCard icon={FileText} title="Add a note" copy="Capture a call, meeting, or field update." accent="#b38b58" onClick={() => runAction('Add a note')} />
                    <ActionCard icon={Users} title="Manage team" copy="Assign the right people to the work." accent="#78949a" onClick={() => runAction('Manage team')} />
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3 border-t border-[#dbe4d7] pt-4">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#dcebd5] text-[#5f8653]"><Check size={13} /></div>
              <div className="text-[10px] text-[#7b8b7e]"><span className="font-semibold text-[#536b56]">02 · Select record</span> <span className="mx-2 text-[#b3beb1]">→</span> <span className="font-semibold text-[#536b56]">03 · Act</span></div>
              <div className="ml-auto flex items-center gap-2 text-[10px] text-[#748276]"><span className="h-1.5 w-1.5 rounded-full bg-[#7c9d67]" /> {notice || `${activeAction} · ${selected?.name ?? 'No record selected'}`}</div>
            </div>
          </section>

          <footer style={{ padding: '20px 40px', display: 'flex', justifyContent: 'space-between' }} className="text-[10px] text-[#94a095]">
            <div className="flex items-center gap-2"><CalendarDays size={13} /> Activity timeline · 7 records touched today</div>
            <div className="flex items-center gap-5"><span>Riverside Medical Tower · 14:22</span><span>Harbor Point Substation · 14:20</span></div>
          </footer>
        </div>
      </div>
    </main>
  );
}