import React, { useState, useMemo, useEffect } from 'react';
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
  Activity
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
    case 'Open': return 'text-amber-600 bg-amber-50 border-amber-100';
    case 'Active': return 'text-[#6BA539] bg-[#6BA539]/10 border-[#6BA539]/20';
    case 'Closed': return 'text-slate-500 bg-slate-100 border-slate-200';
  }
};

const getStatusIcon = (status: Status) => {
  switch (status) {
    case 'Open': return <AlertCircle className="w-4 h-4" />;
    case 'Active': return <TrendingUp className="w-4 h-4" />;
    case 'Closed': return <CheckCircle2 className="w-4 h-4" />;
  }
};

// --- Components ---

export default function CardRowHybrid() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [drilldownState, setDrilldownState] = useState<{ companyId: string, status: Status | 'Total' } | null>(null);

  // Close modals on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedCompanyId(null);
        setDrilldownState(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const totalPortfolioValue = useMemo(() => {
    return COMPANIES.reduce((sum, c) => sum + c.projects.reduce((s, p) => s + p.value, 0), 0);
  }, []);

  // --- AI Analysis Modal ---
  const renderAIAnalysis = () => {
    if (!selectedCompanyId) return null;
    const company = COMPANIES.find(c => c.id === selectedCompanyId)!;
    
    const totalValue = company.projects.reduce((sum, p) => sum + p.value, 0);
    const portfolioShare = ((totalValue / totalPortfolioValue) * 100).toFixed(1);
    const avgSize = (totalValue / company.projects.length).toFixed(1);
    const largestProject = [...company.projects].sort((a, b) => b.value - a.value)[0];
    
    const activeCount = company.projects.filter(p => p.status === 'Active').length;
    const openCount = company.projects.filter(p => p.status === 'Open').length;
    const closedCount = company.projects.filter(p => p.status === 'Closed').length;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setSelectedCompanyId(null)}>
        <div 
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-100 scale-in-95 animate-in zoom-in-95 duration-200"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#6BA539]/10 flex items-center justify-center text-[#6BA539]">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-lg">{company.name}</h3>
                <p className="text-sm text-slate-500">AI Portfolio Analysis</p>
              </div>
            </div>
            <button 
              onClick={() => setSelectedCompanyId(null)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-8">
            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1.5"><PieChart className="w-3.5 h-3.5"/> Share</div>
                <div className="text-2xl font-semibold text-slate-900">{portfolioShare}%</div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5"/> Avg Size</div>
                <div className="text-2xl font-semibold text-slate-900">${avgSize}M</div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 col-span-2">
                <div className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5"/> Mix (O / A / C)</div>
                <div className="text-2xl font-semibold text-slate-900 flex items-baseline gap-2">
                  <span className="text-amber-600">{openCount}</span>
                  <span className="text-slate-300 text-lg">/</span>
                  <span className="text-[#6BA539]">{activeCount}</span>
                  <span className="text-slate-300 text-lg">/</span>
                  <span className="text-slate-500">{closedCount}</span>
                </div>
              </div>
            </div>

            {/* Largest Project Highlight */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-[#6BA539]/5 border border-[#6BA539]/20">
              <div>
                <p className="text-xs font-medium text-[#6BA539] mb-0.5">Flagship Project</p>
                <p className="font-medium text-slate-900">{largestProject.name}</p>
                <p className="text-sm text-slate-500">{largestProject.id}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-semibold text-slate-900">{formatCurrency(largestProject.value)}</p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(largestProject.status)}`}>
                  {largestProject.status}
                </span>
              </div>
            </div>

            {/* Management Perspective */}
            <div>
              <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-slate-400" />
                Management Perspective
              </h4>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Target className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="font-medium text-slate-900 text-sm mb-0.5">Strategy</h5>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Expanding footprint in public infrastructure with a clear shift towards long-term active contracts.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="font-medium text-slate-900 text-sm mb-0.5">Financials</h5>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Healthy pipeline value; high concentration in the flagship {largestProject.name} driving current revenue.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                    <Truck className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="font-medium text-slate-900 text-sm mb-0.5">Delivery</h5>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Execution remains steady, though the {openCount} open projects require near-term mobilization planning.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- Drilldown Modal ---
  const renderDrilldown = () => {
    if (!drilldownState) return null;
    const company = COMPANIES.find(c => c.id === drilldownState.companyId)!;
    
    const filteredRecords = drilldownState.status === 'Total' 
      ? company.projects 
      : company.projects.filter(p => p.status === drilldownState.status);

    const totalValue = filteredRecords.reduce((sum, p) => sum + p.value, 0);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setDrilldownState(null)}>
        <div 
          className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden border border-slate-200 scale-in-95 animate-in zoom-in-95 duration-200"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div>
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-slate-400" />
                {company.name}
              </h3>
              <p className="text-sm text-slate-500 mt-0.5">
                {drilldownState.status === 'Total' ? 'All Records' : `${drilldownState.status} Records`} • {filteredRecords.length} items
              </p>
            </div>
            <button 
              onClick={() => setDrilldownState(null)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {filteredRecords.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                No records found.
              </div>
            ) : (
              <div className="space-y-1">
                {filteredRecords.map(record => (
                  <div key={record.id} className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-lg transition-colors group">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-md ${getStatusColor(record.status)}`}>
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 group-hover:text-[#6BA539] transition-colors">{record.name}</p>
                        <p className="text-sm text-slate-500 font-mono text-xs">{record.id}</p>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-6">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${getStatusColor(record.status)}`}>
                        {record.status}
                      </span>
                      <span className="font-semibold text-slate-900 w-24 text-right">
                        {formatCurrency(record.value)}
                      </span>
                      <button className="text-slate-300 hover:text-[#6BA539] transition-colors">
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
            <span className="text-sm font-medium text-slate-600">Total Value</span>
            <span className="font-semibold text-lg text-slate-900">{formatCurrency(totalValue)}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50/50 p-8 font-sans selection:bg-[#6BA539]/20 selection:text-[#6BA539]">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        .font-sans { font-family: 'Inter', sans-serif; }
      `}} />
      
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Companies</h1>
            <p className="text-slate-500 mt-1 flex items-center gap-2">
              Portfolio overview across {COMPANIES.length} active partners
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">Total Portfolio Value</p>
            <p className="text-3xl font-bold text-slate-900">{formatCurrency(totalPortfolioValue)}</p>
          </div>
        </div>

        {/* Grid Header */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr_auto] gap-4 px-6 py-3 text-sm font-medium text-slate-500 uppercase tracking-wider border-b border-slate-200">
          <div>Company</div>
          <div className="text-center">Total</div>
          <div className="text-center">Open</div>
          <div className="text-center">Active</div>
          <div className="text-center">Closed</div>
          <div className="text-right">Contract Value</div>
          <div className="w-12"></div>
        </div>

        {/* Grid Body - The "Cards" */}
        <div className="space-y-3">
          {COMPANIES.map(company => {
            const totalCount = company.projects.length;
            const openCount = company.projects.filter(p => p.status === 'Open').length;
            const activeCount = company.projects.filter(p => p.status === 'Active').length;
            const closedCount = company.projects.filter(p => p.status === 'Closed').length;
            const totalValue = company.projects.reduce((sum, p) => sum + p.value, 0);

            return (
              <div 
                key={company.id}
                className="group grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr_auto] gap-4 items-center px-6 py-4 bg-white rounded-xl shadow-sm border border-slate-200/60 hover:shadow-md hover:border-[#6BA539]/30 transition-all duration-200 cursor-default"
              >
                {/* Company Name */}
                <div 
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => setSelectedCompanyId(company.id)}
                >
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-[#6BA539]/10 group-hover:text-[#6BA539] transition-colors">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 group-hover:text-[#6BA539] transition-colors">{company.name}</h3>
                    <p className="text-xs text-slate-500 font-medium">{company.id.toUpperCase()}</p>
                  </div>
                </div>

                {/* Counts (Clickable cells) */}
                <div 
                  className="text-center py-2 px-3 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors border border-transparent hover:border-slate-200"
                  onClick={() => setDrilldownState({ companyId: company.id, status: 'Total' })}
                >
                  <span className="font-medium text-slate-900">{totalCount}</span>
                </div>
                
                <div 
                  className="text-center py-2 px-3 rounded-lg hover:bg-amber-50 cursor-pointer transition-colors border border-transparent hover:border-amber-100"
                  onClick={() => setDrilldownState({ companyId: company.id, status: 'Open' })}
                >
                  <span className={`font-medium ${openCount > 0 ? 'text-amber-600' : 'text-slate-300'}`}>{openCount}</span>
                </div>

                <div 
                  className="text-center py-2 px-3 rounded-lg hover:bg-[#6BA539]/10 cursor-pointer transition-colors border border-transparent hover:border-[#6BA539]/20"
                  onClick={() => setDrilldownState({ companyId: company.id, status: 'Active' })}
                >
                  <span className={`font-medium ${activeCount > 0 ? 'text-[#6BA539]' : 'text-slate-300'}`}>{activeCount}</span>
                </div>

                <div 
                  className="text-center py-2 px-3 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors border border-transparent hover:border-slate-200"
                  onClick={() => setDrilldownState({ companyId: company.id, status: 'Closed' })}
                >
                  <span className={`font-medium ${closedCount > 0 ? 'text-slate-600' : 'text-slate-300'}`}>{closedCount}</span>
                </div>

                {/* Total Value */}
                <div className="text-right pr-4">
                  <span className="font-semibold text-slate-900">{formatCurrency(totalValue)}</span>
                </div>

                {/* AI Action */}
                <div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCompanyId(company.id);
                    }}
                    className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:bg-[#6BA539]/10 hover:text-[#6BA539] transition-all duration-200 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="AI Analysis"
                  >
                    <Sparkles className="w-5 h-5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {renderAIAnalysis()}
      {renderDrilldown()}
    </div>
  );
}
