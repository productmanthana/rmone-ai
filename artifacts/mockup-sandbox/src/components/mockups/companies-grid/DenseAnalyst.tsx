import React, { useState, useMemo, useRef, useEffect } from 'react';

// --- DATA MODEL ---
type Status = 'Open' | 'Active' | 'Closed';

interface ProjectRecord {
  id: string;
  name: string;
  status: Status;
  valueM: number;
}

interface Company {
  id: string;
  name: string;
  records: ProjectRecord[];
}

const SAMPLE_COMPANIES: Company[] = [
  {
    id: 'c1',
    name: 'Turner Construction',
    records: [
      { id: 'PMM-22-000598', name: 'Hudson Yards Tower C', status: 'Active', valueM: 450.5 },
      { id: 'PMM-22-001204', name: 'JFK Terminal 4 Expansion', status: 'Open', valueM: 850.0 },
      { id: 'PMM-21-008432', name: 'NYU Langone Main Campus', status: 'Closed', valueM: 120.0 },
      { id: 'PMM-23-000102', name: 'Newark Airport T1', status: 'Active', valueM: 1100.0 },
      { id: 'PMM-23-000845', name: 'Midtown Tech Hub', status: 'Open', valueM: 340.2 },
    ]
  },
  {
    id: 'c2',
    name: 'Skanska USA',
    records: [
      { id: 'PMM-22-004412', name: 'LaGuardia AirTrain', status: 'Active', valueM: 2100.0 },
      { id: 'PMM-21-002199', name: 'Moynihan Train Hall Phase 2', status: 'Closed', valueM: 1600.0 },
      { id: 'PMM-23-009911', name: 'East River Bridge Repair', status: 'Active', valueM: 85.5 },
      { id: 'PMM-23-001022', name: 'UN Headquarters Renovation', status: 'Open', valueM: 410.0 },
    ]
  },
  {
    id: 'c3',
    name: 'NYC DDC',
    records: [
      { id: 'PMM-22-008123', name: 'Brooklyn Borough Hall Roof', status: 'Closed', valueM: 15.4 },
      { id: 'PMM-23-004455', name: 'Queens Library Extension', status: 'Active', valueM: 42.0 },
      { id: 'PMM-23-007788', name: 'Staten Island Sewer Main', status: 'Open', valueM: 112.5 },
    ]
  },
  {
    id: 'c4',
    name: 'Port Authority NY/NJ',
    records: [
      { id: 'PMM-21-005544', name: 'GWB Cable Replacement', status: 'Closed', valueM: 205.0 },
      { id: 'PMM-22-003322', name: 'PATH Station Upgrades', status: 'Active', valueM: 88.0 },
      { id: 'PMM-22-009988', name: 'Holland Tunnel Approach', status: 'Active', valueM: 145.2 },
      { id: 'PMM-23-001122', name: 'Newark Monorail Maintenance', status: 'Open', valueM: 55.0 },
      { id: 'PMM-23-004433', name: 'JFK Cargo Facility', status: 'Open', valueM: 310.0 },
      { id: 'PMM-23-005566', name: 'Port Street Resurfacing', status: 'Open', valueM: 28.5 },
    ]
  },
  {
    id: 'c5',
    name: 'Gilbane',
    records: [
      { id: 'PMM-22-006677', name: 'Palo Alto Networks Campus', status: 'Active', valueM: 650.0 },
      { id: 'PMM-21-008899', name: 'Columbia University Science Center', status: 'Closed', valueM: 420.0 },
      { id: 'PMM-23-002211', name: 'Boston Public Schools Modernization', status: 'Open', valueM: 180.0 },
    ]
  },
  {
    id: 'c6',
    name: 'AECOM',
    records: [
      { id: 'PMM-20-001100', name: 'LAX Automated People Mover', status: 'Closed', valueM: 2000.0 },
      { id: 'PMM-22-002233', name: 'Chicago Metro Red Line', status: 'Active', valueM: 1800.0 },
      { id: 'PMM-23-005544', name: 'Seattle Harbor Redevelopment', status: 'Open', valueM: 950.0 },
      { id: 'PMM-23-007766', name: 'Miami Seawall Defense', status: 'Open', valueM: 450.0 },
    ]
  },
  {
    id: 'c7',
    name: 'Hensel Phelps',
    records: [
      { id: 'PMM-21-004455', name: 'Denver Airport Concourse C', status: 'Closed', valueM: 850.0 },
      { id: 'PMM-22-009900', name: 'SF General Hospital Wing', status: 'Active', valueM: 1200.0 },
    ]
  },
  {
    id: 'c8',
    name: 'Suffolk',
    records: [
      { id: 'PMM-22-003344', name: 'Logan Airport Terminal E', status: 'Active', valueM: 600.0 },
      { id: 'PMM-23-001155', name: 'Wynn Casino Extension', status: 'Open', valueM: 850.0 },
      { id: 'PMM-23-008822', name: 'Harvard Business School Atrium', status: 'Open', valueM: 120.0 },
      { id: 'PMM-23-009933', name: 'Mass General Research Lab', status: 'Active', valueM: 340.0 },
      { id: 'PMM-21-006611', name: 'South Station Tower Phase 1', status: 'Closed', valueM: 900.0 },
    ]
  }
];

// --- ICONS ---
const IconSparkles = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    <path d="M5 3v4M3 5h4"/>
  </svg>
);

const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
);

const IconStrategy = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const IconFinancials = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" x2="12" y1="2" y2="22"/>
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
);

const IconDelivery = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/>
    <path d="M12 2v2"/><path d="M12 20v2"/><path d="M2 12h2"/><path d="M20 12h2"/>
  </svg>
);

// --- COMPONENT ---
export default function DenseAnalyst() {
  const [activeDrilldown, setActiveDrilldown] = useState<{companyId: string, type: 'Total'|'Open'|'Active'|'Closed', anchorRect: DOMRect} | null>(null);
  const [activeAiAnalysis, setActiveAiAnalysis] = useState<{companyId: string, anchorRect: DOMRect} | null>(null);

  const totalPortfolioValue = useMemo(() => {
    return SAMPLE_COMPANIES.reduce((sum, c) => sum + c.records.reduce((rSum, r) => rSum + r.valueM, 0), 0);
  }, []);

  const handleCellClick = (e: React.MouseEvent, companyId: string, type: 'Total'|'Open'|'Active'|'Closed') => {
    e.stopPropagation();
    setActiveAiAnalysis(null);
    const rect = e.currentTarget.getBoundingClientRect();
    if (activeDrilldown?.companyId === companyId && activeDrilldown.type === type) {
      setActiveDrilldown(null);
    } else {
      setActiveDrilldown({ companyId, type, anchorRect: rect });
    }
  };

  const handleAiClick = (e: React.MouseEvent, companyId: string) => {
    e.stopPropagation();
    setActiveDrilldown(null);
    const rect = e.currentTarget.getBoundingClientRect();
    if (activeAiAnalysis?.companyId === companyId) {
      setActiveAiAnalysis(null);
    } else {
      setActiveAiAnalysis({ companyId, anchorRect: rect });
    }
  };

  const closePopups = () => {
    setActiveDrilldown(null);
    setActiveAiAnalysis(null);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopups();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const renderDrilldownPopup = () => {
    if (!activeDrilldown) return null;
    const company = SAMPLE_COMPANIES.find(c => c.id === activeDrilldown.companyId)!;
    const records = activeDrilldown.type === 'Total' 
      ? company.records 
      : company.records.filter(r => r.status === activeDrilldown.type);

    return (
      <div 
        className="fixed z-50 bg-[#0d0d0f] border border-[#2a2a2e] shadow-2xl popup-anim"
        style={{
          top: Math.min(activeDrilldown.anchorRect.bottom + 8, window.innerHeight - 300),
          left: Math.max(16, Math.min(activeDrilldown.anchorRect.left - 100, window.innerWidth - 450)),
          width: 450,
          borderRadius: 4
        }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a2e] bg-[#141416]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#f3f3f4] uppercase tracking-wider">{company.name}</span>
            <span className="text-[10px] text-[#8e8e93] bg-[#2a2a2e] px-1.5 py-0.5 rounded-sm">{activeDrilldown.type} Records</span>
          </div>
          <button onClick={closePopups} className="text-[#8e8e93] hover:text-white transition-colors p-1 rounded hover:bg-[#2a2a2e]">
            <IconX />
          </button>
        </div>
        <div className="max-h-[250px] overflow-y-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="sticky top-0 bg-[#0d0d0f] text-[#8e8e93] text-[10px] uppercase tracking-wider shadow-[0_1px_0_#2a2a2e]">
              <tr>
                <th className="font-normal px-3 py-1.5 w-[110px]">Ticket ID</th>
                <th className="font-normal px-3 py-1.5">Project Name</th>
                <th className="font-normal px-3 py-1.5 w-[60px]">Status</th>
                <th className="font-normal px-3 py-1.5 text-right w-[80px]">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c1c1f]">
              {records.map(r => (
                <tr key={r.id} className="hover:bg-[#141416] transition-colors group">
                  <td className="px-3 py-2 text-[#6BA539] group-hover:text-[#7fbe45] cursor-pointer transition-colors">{r.id}</td>
                  <td className="px-3 py-2 text-[#f3f3f4] truncate max-w-[150px]" title={r.name}>{r.name}</td>
                  <td className="px-3 py-2 text-[#b1b1b3]">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${r.status === 'Active' ? 'bg-[#6BA539]' : r.status === 'Open' ? 'bg-[#e5a034]' : 'bg-[#5e5e62]'}`} />
                      {r.status}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-[#f3f3f4]">${r.valueM.toFixed(1)}M</td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[#8e8e93]">No records found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderAiAnalysisPopup = () => {
    if (!activeAiAnalysis) return null;
    const company = SAMPLE_COMPANIES.find(c => c.id === activeAiAnalysis.companyId)!;
    
    const companyValue = company.records.reduce((sum, r) => sum + r.valueM, 0);
    const portfolioShare = (companyValue / totalPortfolioValue) * 100;
    const avgSize = companyValue / company.records.length;
    const largest = [...company.records].sort((a,b) => b.valueM - a.valueM)[0];
    
    const openC = company.records.filter(r=>r.status==='Open').length;
    const activeC = company.records.filter(r=>r.status==='Active').length;
    const closedC = company.records.filter(r=>r.status==='Closed').length;

    return (
      <div 
        className="fixed z-50 bg-[#0d0d0f] border border-[#2a2a2e] shadow-2xl popup-anim"
        style={{
          top: Math.min(activeAiAnalysis.anchorRect.bottom + 8, window.innerHeight - 350),
          left: Math.max(16, Math.min(activeAiAnalysis.anchorRect.right - 400, window.innerWidth - 420)),
          width: 400,
          borderRadius: 4
        }}
      >
        <div className="px-4 py-3 border-b border-[#2a2a2e] flex items-center justify-between bg-gradient-to-r from-[#141416] to-[#0d0d0f]">
          <div className="flex items-center gap-2 text-[#6BA539]">
            <IconSparkles />
            <span className="text-sm font-medium tracking-wide">Analysis: {company.name}</span>
          </div>
          <button onClick={closePopups} className="text-[#8e8e93] hover:text-white transition-colors p-1 rounded hover:bg-[#2a2a2e]">
            <IconX />
          </button>
        </div>
        
        <div className="p-4 space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] text-[#8e8e93] uppercase tracking-wider mb-1">Portfolio Share</div>
              <div className="text-lg font-light text-[#f3f3f4] tabular-nums">{portfolioShare.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-[10px] text-[#8e8e93] uppercase tracking-wider mb-1">Avg Project</div>
              <div className="text-lg font-light text-[#f3f3f4] tabular-nums">${avgSize.toFixed(0)}M</div>
            </div>
            <div>
              <div className="text-[10px] text-[#8e8e93] uppercase tracking-wider mb-1">Status Mix</div>
              <div className="flex h-5 w-full bg-[#1c1c1f] rounded-sm overflow-hidden mt-1 gap-[1px]">
                {activeC > 0 && <div style={{width: `${(activeC/company.records.length)*100}%`}} className="bg-[#6BA539]" title={`Active: ${activeC}`} />}
                {openC > 0 && <div style={{width: `${(openC/company.records.length)*100}%`}} className="bg-[#e5a034]" title={`Open: ${openC}`} />}
                {closedC > 0 && <div style={{width: `${(closedC/company.records.length)*100}%`}} className="bg-[#5e5e62]" title={`Closed: ${closedC}`} />}
              </div>
            </div>
          </div>

          <div className="border border-[#2a2a2e] rounded bg-[#141416] p-3 space-y-3">
            <div className="text-[10px] text-[#8e8e93] uppercase tracking-wider border-b border-[#2a2a2e] pb-2 mb-2">Management Perspective</div>
            
            <div className="flex gap-2 items-start">
              <div className="mt-0.5 text-[#6BA539]"><IconStrategy /></div>
              <div>
                <div className="text-xs font-medium text-[#f3f3f4]">Strategy</div>
                <div className="text-[11px] text-[#b1b1b3] leading-snug mt-0.5">Heavy concentration in high-value active projects; limited pipeline for new open bids compared to historical run rate.</div>
              </div>
            </div>

            <div className="flex gap-2 items-start">
              <div className="mt-0.5 text-[#6BA539]"><IconFinancials /></div>
              <div>
                <div className="text-xs font-medium text-[#f3f3f4]">Financials</div>
                <div className="text-[11px] text-[#b1b1b3] leading-snug mt-0.5">${companyValue.toFixed(1)}M total exposure with ${largest?.valueM.toFixed(1)}M tied to a single asset ({largest?.name}).</div>
              </div>
            </div>

            <div className="flex gap-2 items-start">
              <div className="mt-0.5 text-[#6BA539]"><IconDelivery /></div>
              <div>
                <div className="text-xs font-medium text-[#f3f3f4]">Delivery</div>
                <div className="text-[11px] text-[#b1b1b3] leading-snug mt-0.5">Execution velocity remains stable; {closedC} recent closures indicate strong operational cadence.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#050506] text-[#f3f3f4] font-sans overflow-hidden flex flex-col" onClick={closePopups}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        
        .font-sans { font-family: 'Inter', sans-serif; }
        .tabular-nums { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
        
        .cell-interactive {
          transition: background-color 0.15s ease, color 0.15s ease;
          cursor: pointer;
        }
        .cell-interactive:hover {
          background-color: #1a1a1d;
          color: white;
        }
        .cell-active {
          background-color: #1a1a1d;
          color: white;
          box-shadow: inset 0 0 0 1px #3f3f46;
        }

        .popup-anim {
          animation: slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          transform-origin: top center;
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(4px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a2e; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
      `}</style>

      <div className="px-6 py-4 border-b border-[#1c1c1f] flex items-center justify-between bg-[#050506]">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 bg-[#6BA539] rounded-[2px]" />
          <h1 className="text-sm font-medium tracking-wide uppercase text-[#e1e1e3]">Companies Grid</h1>
        </div>
        <div className="text-xs text-[#8e8e93] flex items-center gap-4">
          <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#6BA539]"/> Active</div>
          <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#e5a034]"/> Open</div>
          <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#5e5e62]"/> Closed</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="border border-[#1c1c1f] rounded-sm bg-[#0a0a0c]">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#050506]">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-[#8e8e93] uppercase tracking-wider border-b border-[#1c1c1f] w-[250px]">Company</th>
                <th className="px-4 py-3 text-xs font-medium text-[#8e8e93] uppercase tracking-wider border-b border-[#1c1c1f] text-right w-[100px]">Records</th>
                <th className="px-4 py-3 text-xs font-medium text-[#8e8e93] uppercase tracking-wider border-b border-[#1c1c1f] text-right w-[100px]">Open</th>
                <th className="px-4 py-3 text-xs font-medium text-[#8e8e93] uppercase tracking-wider border-b border-[#1c1c1f] text-right w-[100px]">Active</th>
                <th className="px-4 py-3 text-xs font-medium text-[#8e8e93] uppercase tracking-wider border-b border-[#1c1c1f] text-right w-[100px]">Closed</th>
                <th className="px-4 py-3 text-xs font-medium text-[#8e8e93] uppercase tracking-wider border-b border-[#1c1c1f] text-right w-[140px]">Value ($M)</th>
                <th className="px-4 py-3 border-b border-[#1c1c1f] w-[80px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c1c1f]">
              {SAMPLE_COMPANIES.map(company => {
                const total = company.records.length;
                const open = company.records.filter(r => r.status === 'Open').length;
                const active = company.records.filter(r => r.status === 'Active').length;
                const closed = company.records.filter(r => r.status === 'Closed').length;
                const val = company.records.reduce((sum, r) => sum + r.valueM, 0);

                return (
                  <tr key={company.id} className="group hover:bg-[#0f0f12] transition-colors h-[40px]">
                    <td className="px-0 py-0 border-r border-[#1c1c1f]">
                      <div 
                        className="px-4 py-2.5 h-full w-full flex items-center text-[#e1e1e3] font-medium cursor-pointer hover:text-[#6BA539] transition-colors"
                        onClick={(e) => handleAiClick(e, company.id)}
                      >
                        {company.name}
                      </div>
                    </td>
                    <td className="px-0 py-0 border-r border-[#1c1c1f]">
                      <div 
                        className={`px-4 py-2.5 h-full w-full text-right tabular-nums cell-interactive text-[#b1b1b3] ${activeDrilldown?.companyId === company.id && activeDrilldown.type === 'Total' ? 'cell-active' : ''}`}
                        onClick={(e) => handleCellClick(e, company.id, 'Total')}
                      >
                        {total}
                      </div>
                    </td>
                    <td className="px-0 py-0 border-r border-[#1c1c1f]">
                      <div 
                        className={`px-4 py-2.5 h-full w-full text-right tabular-nums cell-interactive text-[#e5a034] opacity-90 ${activeDrilldown?.companyId === company.id && activeDrilldown.type === 'Open' ? 'cell-active' : ''}`}
                        onClick={(e) => handleCellClick(e, company.id, 'Open')}
                      >
                        {open}
                      </div>
                    </td>
                    <td className="px-0 py-0 border-r border-[#1c1c1f]">
                      <div 
                        className={`px-4 py-2.5 h-full w-full text-right tabular-nums cell-interactive text-[#6BA539] opacity-90 ${activeDrilldown?.companyId === company.id && activeDrilldown.type === 'Active' ? 'cell-active' : ''}`}
                        onClick={(e) => handleCellClick(e, company.id, 'Active')}
                      >
                        {active}
                      </div>
                    </td>
                    <td className="px-0 py-0 border-r border-[#1c1c1f]">
                      <div 
                        className={`px-4 py-2.5 h-full w-full text-right tabular-nums cell-interactive text-[#8e8e93] ${activeDrilldown?.companyId === company.id && activeDrilldown.type === 'Closed' ? 'cell-active' : ''}`}
                        onClick={(e) => handleCellClick(e, company.id, 'Closed')}
                      >
                        {closed}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#e1e1e3] border-r border-[#1c1c1f]">
                      {val.toFixed(1)}
                    </td>
                    <td className="px-2 py-0">
                      <div className="flex items-center justify-center">
                        <button 
                          onClick={(e) => handleAiClick(e, company.id)}
                          className={`flex items-center justify-center p-1.5 rounded transition-all ${activeAiAnalysis?.companyId === company.id ? 'bg-[#6BA539] text-white shadow-[0_0_10px_rgba(107,165,57,0.3)]' : 'text-[#5e5e62] hover:text-[#6BA539] hover:bg-[#1a1a1d]'}`}
                          title="Instant AI Analysis"
                        >
                          <IconSparkles />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[#050506] border-t border-[#2a2a2e]">
              <tr>
                <td className="px-4 py-3 text-xs font-medium text-[#8e8e93] uppercase tracking-wider border-r border-[#1c1c1f]">Portfolio Totals</td>
                <td className="px-4 py-3 text-right tabular-nums text-[#8e8e93] font-medium border-r border-[#1c1c1f]">{SAMPLE_COMPANIES.reduce((s,c)=>s+c.records.length,0)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-[#e5a034] font-medium opacity-80 border-r border-[#1c1c1f]">{SAMPLE_COMPANIES.reduce((s,c)=>s+c.records.filter(r=>r.status==='Open').length,0)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-[#6BA539] font-medium opacity-80 border-r border-[#1c1c1f]">{SAMPLE_COMPANIES.reduce((s,c)=>s+c.records.filter(r=>r.status==='Active').length,0)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-[#5e5e62] font-medium border-r border-[#1c1c1f]">{SAMPLE_COMPANIES.reduce((s,c)=>s+c.records.filter(r=>r.status==='Closed').length,0)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-[#f3f3f4] font-medium border-r border-[#1c1c1f]">${totalPortfolioValue.toFixed(1)}M</td>
                <td className="px-4 py-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {renderDrilldownPopup()}
      {renderAiAnalysisPopup()}
    </div>
  );
}
