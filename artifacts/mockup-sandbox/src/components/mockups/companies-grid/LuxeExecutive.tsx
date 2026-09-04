import React, { useState, useMemo } from 'react';
import { Sparkles, X, Activity, Target, Landmark, ArrowUpRight, BarChart3, Clock, ChevronRight } from 'lucide-react';

// --- Types ---
type Status = 'Open' | 'Active' | 'Closed';

interface ProjectRecord {
  id: string;
  name: string;
  status: Status;
  value: number; // in millions
}

interface Company {
  id: string;
  name: string;
  records: ProjectRecord[];
}

// --- Sample Data ---
const COMPANIES: Company[] = [
  {
    id: 'c1',
    name: 'Turner Construction',
    records: [
      { id: 'PMM-22-000598', name: 'Hudson Yards Phase 2', status: 'Active', value: 245.5 },
      { id: 'PMM-23-000102', name: 'Downtown Medical Center', status: 'Open', value: 85.0 },
      { id: 'PMM-21-000944', name: 'Tech Campus Block A', status: 'Closed', value: 410.0 },
      { id: 'PMM-23-000411', name: 'Midtown Transit Hub', status: 'Active', value: 175.2 },
    ],
  },
  {
    id: 'c2',
    name: 'Skanska USA',
    records: [
      { id: 'PMM-22-000301', name: 'LaGuardia Terminal B', status: 'Closed', value: 850.0 },
      { id: 'PMM-23-000502', name: 'State University Science Bldg', status: 'Active', value: 120.5 },
      { id: 'PMM-24-000115', name: 'Waterfront Development', status: 'Open', value: 340.0 },
    ],
  },
  {
    id: 'c3',
    name: 'NYC DDC',
    records: [
      { id: 'PMM-23-000788', name: 'Queens Library Expansion', status: 'Active', value: 45.0 },
      { id: 'PMM-22-000445', name: 'Bronx Community Center', status: 'Closed', value: 28.5 },
      { id: 'PMM-24-000088', name: 'East River Seawall', status: 'Open', value: 115.0 },
      { id: 'PMM-24-000089', name: 'Brooklyn Precinct Upgrade', status: 'Open', value: 55.0 },
      { id: 'PMM-23-000902', name: 'Staten Island Pier', status: 'Active', value: 82.4 },
    ],
  },
  {
    id: 'c4',
    name: 'Port Authority NY/NJ',
    records: [
      { id: 'PMM-21-000105', name: 'JFK AirTrain Extension', status: 'Closed', value: 1200.0 },
      { id: 'PMM-23-000211', name: 'PATH Maintenance Facility', status: 'Active', value: 210.0 },
      { id: 'PMM-24-000056', name: 'Newark Terminal A Revamp', status: 'Open', value: 650.0 },
    ],
  },
  {
    id: 'c5',
    name: 'Gilbane',
    records: [
      { id: 'PMM-22-000677', name: 'Athletic Complex Reno', status: 'Closed', value: 95.0 },
      { id: 'PMM-23-000422', name: 'Symphony Hall Acoustics', status: 'Active', value: 42.0 },
    ],
  },
  {
    id: 'c6',
    name: 'AECOM',
    records: [
      { id: 'PMM-21-000881', name: 'Regional Rail Line', status: 'Closed', value: 2100.0 },
      { id: 'PMM-23-000305', name: 'Highway 99 Expansion', status: 'Active', value: 450.0 },
      { id: 'PMM-24-000101', name: 'Bridge Seismic Retrofit', status: 'Open', value: 180.0 },
      { id: 'PMM-24-000204', name: 'Harbor Dredging', status: 'Open', value: 95.5 },
    ],
  },
  {
    id: 'c7',
    name: 'Hensel Phelps',
    records: [
      { id: 'PMM-22-000552', name: 'Federal Courthouse', status: 'Active', value: 310.0 },
      { id: 'PMM-23-000714', name: 'Aviation Hangar B', status: 'Open', value: 125.0 },
      { id: 'PMM-21-000409', name: 'Data Center Alpha', status: 'Closed', value: 540.0 },
    ],
  },
  {
    id: 'c8',
    name: 'Suffolk',
    records: [
      { id: 'PMM-23-000821', name: 'Luxury High-rise Tower', status: 'Active', value: 280.0 },
      { id: 'PMM-24-000044', name: 'Boutique Hotel', status: 'Open', value: 145.0 },
    ],
  },
];

const BRAND_GREEN = '#6BA539';

// --- Helper Functions ---
const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(val) + 'M';
};

const getStatusColor = (status: Status) => {
  switch (status) {
    case 'Active': return '#6BA539';
    case 'Open': return '#0f172a';
    case 'Closed': return '#94a3b8';
  }
};

// --- Components ---

export default function LuxeExecutiveGrid() {
  const [drillDown, setDrillDown] = useState<{ company: Company; statusFilter: Status | 'Total' } | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<Company | null>(null);

  const totalPortfolioValue = useMemo(() => {
    return COMPANIES.reduce((sum, c) => sum + c.records.reduce((s, r) => s + r.value, 0), 0);
  }, []);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setDrillDown(null);
      setAiAnalysis(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1C1E] font-sans antialiased" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');
        
        .font-serif { font-family: 'Playfair Display', serif; }
        .font-sans { font-family: 'Inter', sans-serif; }
        
        .luxe-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
        }
        
        .luxe-th {
          text-align: left;
          font-weight: 500;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #64748B;
          padding: 1.5rem 1rem;
          border-bottom: 1px solid #E2E8F0;
        }
        
        .luxe-td {
          padding: 1.25rem 1rem;
          border-bottom: 1px solid #F1F5F9;
          font-variant-numeric: tabular-nums;
          transition: background-color 0.2s ease;
        }
        
        .luxe-tr:hover .luxe-td {
          background-color: #FFFFFF;
        }

        .count-cell {
          cursor: pointer;
          border-radius: 4px;
          transition: all 0.2s ease;
        }
        
        .count-cell:hover {
          background-color: #F1F5F9;
          color: ${BRAND_GREEN};
        }

        .glass-panel {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(12px);
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0,0,0,0.02);
        }
      `}} />

      <div className="max-w-[1200px] mx-auto p-12">
        <header className="mb-12 flex justify-between items-end">
          <div>
            <h1 className="font-serif text-4xl text-[#0F172A] tracking-tight mb-2">Partner Portfolio</h1>
            <p className="text-[#64748B] text-sm tracking-wide uppercase">Consolidated view of capital projects</p>
          </div>
          <div className="text-right">
            <p className="text-[#64748B] text-sm mb-1">Total Monitored Value</p>
            <p className="font-serif text-3xl text-[#0F172A]">{formatCurrency(totalPortfolioValue)}</p>
          </div>
        </header>

        <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-[#E2E8F0] overflow-hidden">
          <table className="luxe-table">
            <thead>
              <tr>
                <th className="luxe-th pl-8 w-[30%]">Entity</th>
                <th className="luxe-th text-right">Total</th>
                <th className="luxe-th text-right">Open</th>
                <th className="luxe-th text-right">Active</th>
                <th className="luxe-th text-right">Closed</th>
                <th className="luxe-th text-right">Contract Value</th>
                <th className="luxe-th text-center pr-8 w-[15%]">Insights</th>
              </tr>
            </thead>
            <tbody>
              {COMPANIES.map(company => {
                const total = company.records.length;
                const open = company.records.filter(r => r.status === 'Open').length;
                const active = company.records.filter(r => r.status === 'Active').length;
                const closed = company.records.filter(r => r.status === 'Closed').length;
                const value = company.records.reduce((sum, r) => sum + r.value, 0);

                return (
                  <tr key={company.id} className="luxe-tr group">
                    <td className="luxe-td pl-8">
                      <button 
                        onClick={() => setAiAnalysis(company)}
                        className="font-medium text-[#0F172A] hover:text-[#6BA539] transition-colors text-base"
                      >
                        {company.name}
                      </button>
                    </td>
                    <td className="luxe-td text-right">
                      <span className="count-cell px-3 py-1 font-semibold text-[#0F172A]" onClick={() => setDrillDown({company, statusFilter: 'Total'})}>
                        {total}
                      </span>
                    </td>
                    <td className="luxe-td text-right">
                      <span className="count-cell px-3 py-1 text-[#475569]" onClick={() => setDrillDown({company, statusFilter: 'Open'})}>
                        {open}
                      </span>
                    </td>
                    <td className="luxe-td text-right">
                      <span className="count-cell px-3 py-1 text-[#475569]" onClick={() => setDrillDown({company, statusFilter: 'Active'})}>
                        {active}
                      </span>
                    </td>
                    <td className="luxe-td text-right">
                      <span className="count-cell px-3 py-1 text-[#475569]" onClick={() => setDrillDown({company, statusFilter: 'Closed'})}>
                        {closed}
                      </span>
                    </td>
                    <td className="luxe-td text-right font-serif text-lg text-[#0F172A]">
                      {formatCurrency(value)}
                    </td>
                    <td className="luxe-td text-center pr-8">
                      <button 
                        onClick={() => setAiAnalysis(company)}
                        className="inline-flex items-center justify-center p-2 rounded-full hover:bg-[#F1F5F9] text-[#94A3B8] hover:text-[#6BA539] transition-colors"
                        title="AI Analysis"
                      >
                        <Sparkles size={18} strokeWidth={1.5} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down Modal */}
      {drillDown && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/20 backdrop-blur-sm p-4 transition-opacity duration-300"
          onClick={handleBackdropClick}
        >
          <div className="glass-panel w-full max-w-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-8 py-6 border-b border-[#E2E8F0] flex justify-between items-center bg-white/50">
              <div>
                <h2 className="font-serif text-2xl text-[#0F172A]">{drillDown.company.name}</h2>
                <p className="text-sm text-[#64748B] mt-1">{drillDown.statusFilter === 'Total' ? 'All Records' : `${drillDown.statusFilter} Records`}</p>
              </div>
              <button 
                onClick={() => setDrillDown(null)}
                className="p-2 text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-8 max-h-[60vh] overflow-y-auto bg-white/80">
              <div className="space-y-4">
                {drillDown.company.records
                  .filter(r => drillDown.statusFilter === 'Total' || r.status === drillDown.statusFilter)
                  .map(record => (
                    <div key={record.id} className="group flex items-center justify-between p-4 rounded-xl border border-[#E2E8F0] hover:border-[#CBD5E1] hover:shadow-sm bg-white transition-all">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-sm tracking-wider uppercase" style={{ 
                            backgroundColor: `${getStatusColor(record.status)}15`,
                            color: getStatusColor(record.status)
                          }}>
                            {record.status}
                          </span>
                          <span className="text-sm text-[#64748B] font-mono tracking-tight">{record.id}</span>
                        </div>
                        <h4 className="text-[#0F172A] font-medium">{record.name}</h4>
                      </div>
                      <div className="text-right">
                        <span className="font-serif text-xl text-[#0F172A]">{formatCurrency(record.value)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Analysis Modal */}
      {aiAnalysis && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/30 backdrop-blur-md p-4 transition-opacity duration-300"
          onClick={handleBackdropClick}
        >
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Header */}
            <div className="relative h-32 bg-[#0F172A] flex items-end p-8 overflow-hidden">
              <div className="absolute inset-0 opacity-20" style={{ background: `linear-gradient(135deg, ${BRAND_GREEN} 0%, transparent 100%)` }} />
              <div className="absolute top-6 right-6">
                <button 
                  onClick={() => setAiAnalysis(null)}
                  className="p-2 text-white/60 hover:text-white bg-black/20 hover:bg-black/40 rounded-full backdrop-blur transition-all"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="relative z-10 w-full flex justify-between items-end">
                <div>
                  <div className="flex items-center gap-2 text-[#6BA539] mb-2 text-sm font-medium tracking-wide">
                    <Sparkles size={14} />
                    <span>EXECUTIVE BRIEFING</span>
                  </div>
                  <h2 className="font-serif text-3xl text-white tracking-tight">{aiAnalysis.name}</h2>
                </div>
              </div>
            </div>

            <div className="p-8">
              {/* Key Metrics */}
              <div className="grid grid-cols-4 gap-6 mb-10">
                {(() => {
                  const total = aiAnalysis.records.reduce((sum, r) => sum + r.value, 0);
                  const share = (total / totalPortfolioValue) * 100;
                  const avgSize = total / aiAnalysis.records.length;
                  const largest = Math.max(...aiAnalysis.records.map(r => r.value));
                  const active = aiAnalysis.records.filter(r => r.status === 'Active').length;
                  const open = aiAnalysis.records.filter(r => r.status === 'Open').length;

                  return (
                    <>
                      <div>
                        <p className="text-xs text-[#64748B] uppercase tracking-wider mb-1">Portfolio Share</p>
                        <p className="font-serif text-2xl text-[#0F172A]">{share.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#64748B] uppercase tracking-wider mb-1">Avg Project</p>
                        <p className="font-serif text-2xl text-[#0F172A]">{formatCurrency(avgSize)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#64748B] uppercase tracking-wider mb-1">Max Exposure</p>
                        <p className="font-serif text-2xl text-[#0F172A]">{formatCurrency(largest)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#64748B] uppercase tracking-wider mb-1">Active / Open</p>
                        <p className="font-serif text-2xl text-[#0F172A]">{active} / {open}</p>
                      </div>
                    </>
                  );
                })()}
              </div>

              <hr className="border-[#E2E8F0] mb-8" />

              {/* Management Perspective */}
              <div>
                <h3 className="text-sm font-semibold text-[#0F172A] uppercase tracking-widest mb-6">Management Perspective</h3>
                <div className="space-y-6">
                  
                  {/* Strategy */}
                  <div className="flex gap-4">
                    <div className="mt-1 flex-shrink-0 w-8 h-8 rounded-full bg-[#F1F5F9] text-[#475569] flex items-center justify-center">
                      <Target size={16} strokeWidth={2} />
                    </div>
                    <div>
                      <h4 className="text-[#0F172A] font-medium mb-1">Strategy & Alignment</h4>
                      <p className="text-[#475569] leading-relaxed">
                        Strong alignment with overall capital strategy. Active engagement on strategic infrastructure implies long-term partnership stability and consistent high-tier delivery capabilities.
                      </p>
                    </div>
                  </div>

                  {/* Financials */}
                  <div className="flex gap-4">
                    <div className="mt-1 flex-shrink-0 w-8 h-8 rounded-full bg-[#F1F5F9] text-[#475569] flex items-center justify-center">
                      <Landmark size={16} strokeWidth={2} />
                    </div>
                    <div>
                      <h4 className="text-[#0F172A] font-medium mb-1">Financial Exposure</h4>
                      <p className="text-[#475569] leading-relaxed">
                        Financial footprint is well-distributed across {aiAnalysis.records.length} distinct initiatives. Contract values demonstrate appropriate risk concentration within tolerance thresholds.
                      </p>
                    </div>
                  </div>

                  {/* Delivery */}
                  <div className="flex gap-4">
                    <div className="mt-1 flex-shrink-0 w-8 h-8 rounded-full bg-[#F1F5F9] text-[#475569] flex items-center justify-center">
                      <Activity size={16} strokeWidth={2} />
                    </div>
                    <div>
                      <h4 className="text-[#0F172A] font-medium mb-1">Execution Velocity</h4>
                      <p className="text-[#475569] leading-relaxed">
                        Throughput remains consistent. With {aiAnalysis.records.filter(r=>r.status==='Active').length} active projects transitioning smoothly and upcoming open items entering pipeline, capacity utilization appears optimal.
                      </p>
                    </div>
                  </div>

                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
