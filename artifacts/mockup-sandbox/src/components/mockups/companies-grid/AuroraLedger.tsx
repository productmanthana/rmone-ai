import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  X, 
  Target, 
  DollarSign, 
  Truck, 
  Building2, 
  Briefcase,
  ChevronRight,
  TrendingUp,
  FileText,
  AlertCircle,
  CheckCircle2,
  PieChart,
  BarChart3,
  Activity,
  ChevronDown
} from 'lucide-react';

// --- Types ---
type Status = 'Open' | 'Active' | 'Closed';

interface Project {
  id: string;
  name: string;
  status: Status;
  value: number;
}

interface Company {
  id: string;
  name: string;
  projects: Project[];
}

// --- Sample Data ---
const COMPANIES: Company[] = [
  {
    id: 'c1',
    name: 'Turner Construction',
    projects: [
      { id: 'PMM-24-00101', name: 'Downtown Tech Hub', status: 'Active', value: 45.5 },
      { id: 'PMM-23-00892', name: 'Riverfront Campus', status: 'Active', value: 120.0 },
      { id: 'PMM-24-00234', name: 'Medical Center Annex', status: 'Open', value: 18.2 },
      { id: 'PMM-22-00511', name: 'Airport Terminal B', status: 'Closed', value: 210.5 },
      { id: 'PMM-24-00405', name: 'University Science Bldg', status: 'Open', value: 65.0 },
    ]
  },
  {
    id: 'c2',
    name: 'Skanska USA',
    projects: [
      { id: 'PMM-24-00155', name: 'Transit Hub Expansion', status: 'Active', value: 85.0 },
      { id: 'PMM-23-00677', name: 'Highway 99 Overpass', status: 'Active', value: 34.2 },
      { id: 'PMM-21-00999', name: 'Civic Center Reno', status: 'Closed', value: 155.8 },
      { id: 'PMM-24-00512', name: 'Water Treatment Facility', status: 'Open', value: 42.0 },
    ]
  },
  {
    id: 'c3',
    name: 'NYC DDC',
    projects: [
      { id: 'PMM-24-00881', name: 'Brooklyn Library Renovation', status: 'Open', value: 12.5 },
      { id: 'PMM-23-00112', name: 'Queens Community Center', status: 'Active', value: 28.4 },
      { id: 'PMM-22-00334', name: 'Manhattan Streetscape', status: 'Closed', value: 15.0 },
    ]
  },
  {
    id: 'c4',
    name: 'Port Authority NY/NJ',
    projects: [
      { id: 'PMM-24-00901', name: 'JFK Terminal 4 Upgrades', status: 'Active', value: 450.0 },
      { id: 'PMM-24-00902', name: 'Lincoln Tunnel Maintenance', status: 'Open', value: 85.5 },
      { id: 'PMM-23-00771', name: 'PATH Ventilation System', status: 'Active', value: 125.0 },
      { id: 'PMM-21-00222', name: 'Newark Monorail Extension', status: 'Closed', value: 310.0 },
      { id: 'PMM-24-00955', name: 'Port Logistics Center', status: 'Open', value: 65.2 },
      { id: 'PMM-23-00444', name: 'George Washington Bridge Tolls', status: 'Closed', value: 45.0 },
    ]
  },
  {
    id: 'c5',
    name: 'Gilbane',
    projects: [
      { id: 'PMM-24-00333', name: 'State Capitol Renovation', status: 'Active', value: 95.0 },
      { id: 'PMM-24-00334', name: 'County Courthouse', status: 'Open', value: 25.5 },
    ]
  },
  {
    id: 'c6',
    name: 'AECOM',
    projects: [
      { id: 'PMM-24-00611', name: 'Regional Rail Line', status: 'Active', value: 850.0 },
      { id: 'PMM-24-00622', name: 'Coastal Bridge Repair', status: 'Open', value: 115.0 },
      { id: 'PMM-22-00111', name: 'Metro Station Overhaul', status: 'Closed', value: 220.5 },
    ]
  },
  {
    id: 'c7',
    name: 'Hensel Phelps',
    projects: [
      { id: 'PMM-24-00711', name: 'Federal Office Building', status: 'Active', value: 145.0 },
      { id: 'PMM-24-00712', name: 'Military Base Housing', status: 'Open', value: 65.5 },
      { id: 'PMM-23-00888', name: 'Veterans Hospital Wing', status: 'Active', value: 88.0 },
      { id: 'PMM-21-00555', name: 'Aviation Training Center', status: 'Closed', value: 135.0 },
    ]
  },
  {
    id: 'c8',
    name: 'Suffolk',
    projects: [
      { id: 'PMM-24-00811', name: 'Luxury Highrise', status: 'Active', value: 210.0 },
      { id: 'PMM-24-00812', name: 'Mixed-Use Retail Park', status: 'Open', value: 75.0 },
      { id: 'PMM-22-00444', name: 'Corporate Headquarters', status: 'Closed', value: 185.0 },
    ]
  }
];

// --- Helper Functions ---
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value) + 'M';
};

const getStatusColor = (status: Status) => {
  switch (status) {
    case 'Open': return 'text-amber-600 bg-amber-50/80 border-amber-200/50';
    case 'Active': return 'text-[#6BA539] bg-[#6BA539]/10 border-[#6BA539]/20';
    case 'Closed': return 'text-slate-500 bg-slate-100 border-slate-200';
  }
};

const getStatusIcon = (status: Status) => {
  switch (status) {
    case 'Open': return <AlertCircle className="w-3.5 h-3.5" />;
    case 'Active': return <TrendingUp className="w-3.5 h-3.5" />;
    case 'Closed': return <CheckCircle2 className="w-3.5 h-3.5" />;
  }
};

export default function AuroraLedger() {
  const [expandedCompany, setExpandedCompany] = useState<{ id: string, status: Status | 'Total' } | null>(null);
  const [aiPanelCompany, setAiPanelCompany] = useState<string | null>(null);
  const [visibleRows, setVisibleRows] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Calculate totals
  const { totalPortfolioValue, maxCompanyValue } = useMemo(() => {
    let total = 0;
    let max = 0;
    COMPANIES.forEach(c => {
      const val = c.projects.reduce((s, p) => s + p.value, 0);
      total += val;
      if (val > max) max = val;
    });
    return { totalPortfolioValue: total, maxCompanyValue: max };
  }, []);

  // Staggered entrance
  useEffect(() => {
    COMPANIES.forEach((c, i) => {
      setTimeout(() => {
        setVisibleRows(prev => [...prev, c.id]);
      }, 100 * i);
    });
  }, []);

  // Keyboard support for AI Panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAiPanelCompany(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleExpand = (companyId: string, status: Status | 'Total') => {
    if (expandedCompany?.id === companyId && expandedCompany?.status === status) {
      setExpandedCompany(null);
    } else {
      setExpandedCompany({ id: companyId, status });
    }
  };

  const renderAIPanel = () => {
    if (!aiPanelCompany) return null;
    const company = COMPANIES.find(c => c.id === aiPanelCompany)!;
    
    const totalValue = company.projects.reduce((sum, p) => sum + p.value, 0);
    const portfolioShare = ((totalValue / totalPortfolioValue) * 100).toFixed(1);
    const avgSize = (totalValue / company.projects.length).toFixed(1);
    const largestProject = [...company.projects].sort((a, b) => b.value - a.value)[0];
    
    const totalCount = company.projects.length;
    const activeCount = company.projects.filter(p => p.status === 'Active').length;
    const openCount = company.projects.filter(p => p.status === 'Open').length;
    const closedCount = company.projects.filter(p => p.status === 'Closed').length;

    return (
      <div
        className="fixed inset-0 z-50 flex justify-end bg-slate-900/10 backdrop-blur-sm transition-opacity"
        onClick={() => setAiPanelCompany(null)}
      >
        <div 
          className="w-full max-w-md h-full bg-white shadow-2xl border-l border-slate-200 overflow-y-auto animate-in slide-in-from-right duration-300 ease-out"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-xl border-b border-slate-100 px-6 py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 bg-[#6BA539]/20 blur-xl rounded-full"></div>
                <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-[#6BA539]/20 to-transparent flex items-center justify-center text-[#6BA539] border border-[#6BA539]/20">
                  <Sparkles className="w-5 h-5" />
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">{company.name}</h3>
                <p className="text-xs font-medium text-[#6BA539]">AI Intelligence</p>
              </div>
            </div>
            <button 
              onClick={() => setAiPanelCompany(null)}
              className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-7">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#6BA539]/10 border border-[#6BA539]/20">
              <Sparkles className="w-3.5 h-3.5 text-[#6BA539]" />
              <span className="text-xs font-semibold text-[#6BA539] tracking-wide uppercase">AI Company Intelligence — Live Data</span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><PieChart className="w-4 h-4 text-slate-800"/> Portfolio Share</div>
                <div className="text-3xl font-semibold tracking-tight text-slate-900">{portfolioShare}%</div>
              </div>
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-slate-800"/> Avg Project</div>
                <div className="text-3xl font-semibold tracking-tight text-slate-900">${avgSize}M</div>
              </div>
            </div>

            {/* Project Status Mix */}
            <div>
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Projects Status Mix</h4>
              <div className="h-2.5 rounded-full overflow-hidden flex">
                {totalCount > 0 && (
                  <>
                    <div className="h-full bg-[#0EA5E9]" style={{ width: `${(openCount / totalCount) * 100}%` }} />
                    <div className="h-full bg-[#6BA539]" style={{ width: `${(activeCount / totalCount) * 100}%` }} />
                    <div className="h-full bg-slate-300" style={{ width: `${(closedCount / totalCount) * 100}%` }} />
                  </>
                )}
              </div>
              <div className="flex items-center gap-5 mt-2.5 text-xs font-medium text-slate-800">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#0EA5E9]"/> Open {openCount}</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#6BA539]"/> Active {activeCount}</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-300"/> Closed {closedCount}</span>
              </div>
            </div>

            {/* AI Analysis Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-[#6BA539]" />
                <h4 className="text-sm font-bold text-slate-900">AI Analysis</h4>
              </div>
              <div className="flex gap-2 mb-4">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Strategy</span>
                <span className="text-[10px] text-slate-300">·</span>
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Financials</span>
                <span className="text-[10px] text-slate-300">·</span>
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Delivery</span>
              </div>

              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#6BA539]/15 flex items-center justify-center mt-0.5">
                    <TrendingUp className="w-3.5 h-3.5 text-[#6BA539]" />
                  </div>
                  <p className="text-sm font-medium text-slate-800 leading-relaxed">
                    {company.name} represents <span className="text-slate-900 font-bold">{portfolioShare}%</span> of your total project pipeline with {totalCount} project worth <span className="text-slate-900 font-bold">{formatCurrency(totalValue)}</span>. This is a strategic key account — protect the relationship with executive-level touchpoints and priority delivery.
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-500/15 flex items-center justify-center mt-0.5">
                    <DollarSign className="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <p className="text-sm font-medium text-slate-800 leading-relaxed">
                    Total book value is <span className="text-slate-900 font-bold">{formatCurrency(totalValue)}</span>. Largest engagement: <span className="text-slate-900 font-bold">{largestProject.name}</span> at {formatCurrency(largestProject.value)}. Meaningful revenue contribution with manageable concentration risk.
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-sky-500/15 flex items-center justify-center mt-0.5">
                    <Activity className="w-3.5 h-3.5 text-sky-600" />
                  </div>
                  <p className="text-sm font-medium text-slate-800 leading-relaxed">
                    {activeCount > 0 ? `${activeCount} currently in active delivery` : 'Nothing currently in active delivery'},{openCount > 0 ? ` ${openCount} project open awaiting decision or kickoff` : ' no open items'}. {openCount > 0 && activeCount === 0 ? `Line up resources now so the ${openCount} open item${openCount > 1 ? 's' : ''} can start without delay when they convert.` : 'Resource allocation is aligned with active workload.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Flagship */}
            <div>
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Flagship Project</h4>
              <div className="relative p-5 rounded-2xl bg-slate-900 text-white overflow-hidden shadow-lg group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#6BA539]/30 blur-[40px] -mr-10 -mt-10 rounded-full transition-transform duration-700 group-hover:scale-150" />
                <div className="relative z-10 flex justify-between items-start mb-4">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center backdrop-blur-md">
                    <Target className="w-5 h-5 text-white" />
                  </div>
                  <div className={`px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-md border ${
                    largestProject.status === 'Active' ? 'bg-[#6BA539]/25 text-[#6BA539] border-[#6BA539]/40' :
                    largestProject.status === 'Open' ? 'bg-[#0EA5E9]/25 text-[#0EA5E9] border-[#0EA5E9]/40' :
                    'bg-white/10 text-white/70 border-white/20'
                  }`}>
                    {largestProject.status}
                  </div>
                </div>
                <div className="relative z-10">
                  <p className="font-semibold text-lg mb-1">{largestProject.name}</p>
                  <p className="text-white/60 text-sm font-mono mb-4">{largestProject.id}</p>
                  <p className="text-3xl font-semibold tracking-tight">{formatCurrency(largestProject.value)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans overflow-x-hidden selection:bg-[#6BA539]/20 selection:text-[#6BA539]">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
        .font-sans { font-family: 'Plus Jakarta Sans', sans-serif; }
        
        .aurora-bg {
          position: fixed;
          top: -20vh;
          right: -10vw;
          width: 80vw;
          height: 80vh;
          background: radial-gradient(circle, rgba(107, 165, 57, 0.05) 0%, rgba(107, 165, 57, 0) 70%);
          border-radius: 50%;
          filter: blur(80px);
          pointer-events: none;
          z-index: 0;
        }

        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />
      
      <div className="aurora-bg"></div>

      <div className="relative z-10 max-w-7xl mx-auto px-8 py-12 space-y-10">
        
        {/* Header */}
        <header className="flex items-end justify-between animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 shadow-sm mb-4">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#6BA539] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#6BA539]"></span>
              </span>
              <span className="text-xs font-semibold tracking-wide text-slate-600 uppercase">Live Ledger</span>
            </div>
            <h1 className="text-4xl font-light tracking-tight text-slate-900">Portfolio Ledger</h1>
            <p className="text-slate-500 mt-2 text-lg">Financial orchestration across {COMPANIES.length} partners</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-1">Total Managed Value</p>
            <p className="text-5xl font-light tracking-tighter text-slate-900 drop-shadow-sm">
              {formatCurrency(totalPortfolioValue)}
            </p>
          </div>
        </header>

        {/* Ledger Grid */}
        <div className="bg-white/60 backdrop-blur-xl border border-white rounded-3xl shadow-xl shadow-slate-200/50 overflow-hidden">
          {/* Column Headers */}
          <div className="grid grid-cols-[3fr_2fr_1.5fr] gap-6 px-8 py-4 bg-white/40 border-b border-slate-100 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <div>Company & Intelligence</div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <span>All</span>
              <span>Open</span>
              <span>Active</span>
              <span>Closed</span>
            </div>
            <div className="text-right">Contract Value</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100/60" ref={scrollRef}>
            {COMPANIES.map(company => {
              const isVisible = visibleRows.includes(company.id);
              const isExpanded = expandedCompany?.id === company.id;
              
              const totalCount = company.projects.length;
              const openCount = company.projects.filter(p => p.status === 'Open').length;
              const activeCount = company.projects.filter(p => p.status === 'Active').length;
              const closedCount = company.projects.filter(p => p.status === 'Closed').length;
              const totalValue = company.projects.reduce((sum, p) => sum + p.value, 0);
              const valuePercent = (totalValue / maxCompanyValue) * 100;

              const filteredProjects = isExpanded && expandedCompany.status !== 'Total' 
                ? company.projects.filter(p => p.status === expandedCompany.status)
                : company.projects;

              return (
                <div 
                  key={company.id}
                  className={`transition-all duration-700 ease-out flex flex-col ${
                    isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
                  }`}
                >
                  {/* Main Row */}
                  <div className="group relative grid grid-cols-[3fr_2fr_1.5fr] gap-6 px-8 py-5 items-center hover:bg-slate-50/80 transition-colors">
                    
                    {/* Background Value Bar (The "Ledger" feel) */}
                    <div 
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#6BA539]/[0.03] to-transparent pointer-events-none transition-all duration-1000"
                      style={{ width: `${valuePercent}%` }}
                    />

                    {/* Left: Identity & AI */}
                    <div className="relative z-10 flex items-center justify-between pr-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400 group-hover:border-[#6BA539]/30 group-hover:text-[#6BA539] transition-all">
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900 text-lg group-hover:text-[#6BA539] transition-colors">{company.name}</h3>
                          <p className="text-xs text-slate-400 font-mono tracking-wider">{company.id.toUpperCase()}</p>
                        </div>
                      </div>
                      
                      <button 
                        onClick={() => setAiPanelCompany(company.id)}
                        className="relative overflow-hidden w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-[#6BA539] bg-white border border-slate-200 shadow-sm hover:border-[#6BA539]/30 hover:shadow-[#6BA539]/10 transition-all opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 focus-visible:opacity-100 focus-visible:translate-x-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6BA539]/50"
                        title="AI Analysis"
                      >
                        <Sparkles className="w-4 h-4 relative z-10" />
                      </button>
                    </div>

                    {/* Middle: Interactive Status Pills */}
                    <div className="relative z-10 grid grid-cols-4 gap-2">
                      <button 
                        onClick={() => toggleExpand(company.id, 'Total')}
                        className={`flex flex-col items-center justify-center py-2 rounded-xl border transition-all ${
                          isExpanded && expandedCompany.status === 'Total' 
                            ? 'bg-slate-900 border-slate-900 text-white shadow-md' 
                            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-lg font-semibold leading-none">{totalCount}</span>
                      </button>

                      <button 
                        onClick={() => toggleExpand(company.id, 'Open')}
                        disabled={openCount === 0}
                        className={`flex flex-col items-center justify-center py-2 rounded-xl border transition-all ${
                          openCount === 0 ? 'opacity-40 cursor-not-allowed bg-slate-50 border-transparent' :
                          isExpanded && expandedCompany.status === 'Open'
                            ? 'bg-amber-500 border-amber-500 text-white shadow-md shadow-amber-500/20'
                            : 'bg-amber-50/50 border-amber-200/50 text-amber-600 hover:bg-amber-50 hover:border-amber-300'
                        }`}
                      >
                        <span className="text-lg font-semibold leading-none">{openCount}</span>
                      </button>

                      <button 
                        onClick={() => toggleExpand(company.id, 'Active')}
                        disabled={activeCount === 0}
                        className={`flex flex-col items-center justify-center py-2 rounded-xl border transition-all ${
                          activeCount === 0 ? 'opacity-40 cursor-not-allowed bg-slate-50 border-transparent' :
                          isExpanded && expandedCompany.status === 'Active'
                            ? 'bg-[#6BA539] border-[#6BA539] text-white shadow-md shadow-[#6BA539]/20'
                            : 'bg-[#6BA539]/5 border-[#6BA539]/20 text-[#6BA539] hover:bg-[#6BA539]/10 hover:border-[#6BA539]/30'
                        }`}
                      >
                        <span className="text-lg font-semibold leading-none">{activeCount}</span>
                      </button>

                      <button 
                        onClick={() => toggleExpand(company.id, 'Closed')}
                        disabled={closedCount === 0}
                        className={`flex flex-col items-center justify-center py-2 rounded-xl border transition-all ${
                          closedCount === 0 ? 'opacity-40 cursor-not-allowed bg-slate-50 border-transparent' :
                          isExpanded && expandedCompany.status === 'Closed'
                            ? 'bg-slate-600 border-slate-600 text-white shadow-md'
                            : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <span className="text-lg font-semibold leading-none">{closedCount}</span>
                      </button>
                    </div>

                    {/* Right: Contract Value */}
                    <div className="relative z-10 text-right pr-2 flex items-center justify-end gap-4">
                      <span className="text-2xl font-light tracking-tight text-slate-900">{formatCurrency(totalValue)}</span>
                      <ChevronDown className={`w-5 h-5 text-slate-300 transition-transform duration-300 ${isExpanded ? '-rotate-180 text-slate-600' : ''}`} />
                    </div>
                  </div>

                  {/* Expanded Drilldown inline */}
                  <div 
                    className={`overflow-hidden transition-all duration-500 ease-in-out ${
                      isExpanded ? 'max-h-[800px] opacity-100 border-t border-slate-100 bg-slate-50/50' : 'max-h-0 opacity-0'
                    }`}
                  >
                    <div className="px-8 py-6 pl-24">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          {expandedCompany?.status === 'Total' ? 'All Records' : `${expandedCompany?.status} Records`}
                        </h4>
                        <span className="text-xs font-mono text-slate-400 bg-white px-2 py-1 rounded-md border border-slate-200 shadow-sm">{filteredProjects.length} ITEMS</span>
                      </div>

                      <div className="space-y-2">
                        {filteredProjects.map((project, idx) => (
                          <div 
                            key={project.id} 
                            className="group/record flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-[#6BA539]/30 transition-all cursor-pointer"
                            style={{ animationDelay: `${idx * 50}ms` }}
                          >
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-lg border ${getStatusColor(project.status)}`}>
                                {getStatusIcon(project.status)}
                              </div>
                              <div>
                                <p className="font-medium text-slate-900 text-sm group-hover/record:text-[#6BA539] transition-colors">{project.name}</p>
                                <p className="text-xs text-slate-400 font-mono mt-0.5">{project.id}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-6">
                              <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${getStatusColor(project.status)}`}>
                                {project.status}
                              </span>
                              <span className="font-medium text-slate-900 text-right w-24">
                                {formatCurrency(project.value)}
                              </span>
                              <ChevronRight className="w-4 h-4 text-slate-300 group-hover/record:text-[#6BA539] transition-colors" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {renderAIPanel()}
    </div>
  );
}