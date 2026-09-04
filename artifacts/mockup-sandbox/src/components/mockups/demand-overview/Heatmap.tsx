import React from 'react';
import { 
  TrendingUp, AlertCircle, Clock, Calendar, 
  ChevronRight, ArrowUpRight, BarChart3
} from 'lucide-react';
import './_heatmap.css';

// Data definitions
const WEEKS = [
  { label: 'Jul 20', isCurrent: true },
  { label: 'Jul 27' },
  { label: 'Aug 3' },
  { label: 'Aug 10' },
  { label: 'Aug 17' },
  { label: 'Aug 24' },
  { label: 'Aug 31' },
  { label: 'Sep 7' },
  { label: 'Sep 14' },
  { label: 'Sep 21' },
  { label: 'Sep 28' },
  { label: 'Oct 5' },
];

const WEEKLY_TOTALS = [1480, 1620, 1390, 1750, 1980, 1710, 1450, 1220, 980, 1100, 860, 720];

// Max weekly total for bar chart scaling
const MAX_TOTAL = Math.max(...WEEKLY_TOTALS);

const ROLES = [
  { name: 'Project Manager', thisWeek: 320, positions: 8 },
  { name: 'Civil Engineer', thisWeek: 280, positions: 7 },
  { name: 'Structural Engineer', thisWeek: 240, positions: 6 },
  { name: 'Construction Inspector', thisWeek: 210, positions: 6 },
  { name: 'Architect', thisWeek: 180, positions: 5 },
  { name: 'Estimator', thisWeek: 140, positions: 4 },
  { name: 'Surveyor', thisWeek: 110, positions: 3 },
];

// Synthetic data distribution based on roles and weekly totals
const generateHeatmapData = () => {
  return ROLES.map((role) => {
    const row = [];
    let roleSum = 0;
    for (let i = 0; i < 12; i++) {
      // Create a curve that somewhat matches the weekly totals
      const weekMultiplier = WEEKLY_TOTALS[i] / WEEKLY_TOTALS[0];
      let val = Math.round(role.thisWeek * weekMultiplier * (0.8 + Math.random() * 0.4));
      row.push(val);
      roleSum += val;
    }
    return { ...role, data: row, total: roleSum };
  });
};

const heatmapData = generateHeatmapData();

const TOP_PROJECTS = [
  { name: 'Harbor Bridge Rehabilitation', id: 'PMM-22-000598', hrs: 340 },
  { name: 'Riverside Medical Campus', id: 'PMM-22-000812', hrs: 280 },
  { name: 'Metro Line Ext. Phase 2', id: 'PMM-22-000945', hrs: 260 },
  { name: 'Lakefront Stadium Renewal', id: 'PMM-22-001023', hrs: 190 },
  { name: 'Downtown Transit Hub', id: 'PMM-22-001156', hrs: 150 },
];

// Helper to determine cell color based on value
const getIntensityClass = (val: number) => {
  if (val === 0) return 'heatmap-cell-0';
  if (val < 50) return 'heatmap-cell-1';
  if (val < 100) return 'heatmap-cell-2';
  if (val < 150) return 'heatmap-cell-3';
  if (val < 200) return 'heatmap-cell-4';
  if (val < 250) return 'heatmap-cell-5';
  if (val < 300) return 'heatmap-cell-6';
  if (val < 350) return 'heatmap-cell-7';
  if (val < 400) return 'heatmap-cell-8';
  if (val < 450) return 'heatmap-cell-9';
  return 'heatmap-cell-10';
};

export function Heatmap() {
  return (
    <div className="heatmap-container min-h-screen bg-[#fcfcfd] text-slate-900 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <header className="flex items-end justify-between pb-6 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-1 rounded">RESOURCE PLANNING</span>
              <span className="text-slate-500 text-sm">Updated Today, Jul 17</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900">Demand Overview</h1>
            <p className="text-slate-500 mt-2 text-lg">Unfilled positions and resource gaps across the portfolio.</p>
          </div>
          
          <div className="flex gap-4">
            <button className="px-4 py-2 bg-white border border-slate-200 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm">
              Export CSV
            </button>
            <button className="px-4 py-2 bg-slate-900 text-white rounded-md text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm">
              Create Requisition
            </button>
          </div>
        </header>

        {/* Hero KPIs & Urgency */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="text-slate-500 text-sm font-medium mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              THIS WEEK (JUL 20)
            </div>
            <div className="flex items-end gap-4">
              <div>
                <div className="text-5xl font-bold tracking-tight heatmap-mono">1,480</div>
                <div className="text-slate-500 mt-1">Unfilled Hours</div>
              </div>
              <div className="mb-1">
                <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                  <TrendingUp className="w-3 h-3" /> +12%
                </span>
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-sm">
              <span className="text-slate-600">Representing <strong className="text-slate-900">42</strong> open positions</span>
            </div>
          </div>

          <div className="bg-rose-50 p-6 rounded-xl border border-rose-100 shadow-sm flex flex-col justify-between">
            <div className="text-rose-600 text-sm font-medium mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              URGENCY
            </div>
            <div>
              <div className="text-4xl font-bold tracking-tight text-rose-700 heatmap-mono">6</div>
              <div className="text-rose-600 mt-1">Positions Overdue</div>
            </div>
            <div className="mt-6 pt-4 border-t border-rose-200/50 flex items-center justify-between text-sm">
              <span className="text-rose-700 font-medium">Start dates already passed</span>
              <button className="text-rose-700 hover:text-rose-800 flex items-center gap-1 font-medium">
                View <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="bg-amber-50 p-6 rounded-xl border border-amber-100 shadow-sm flex flex-col justify-between">
            <div className="text-amber-600 text-sm font-medium mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              UPCOMING
            </div>
            <div>
              <div className="text-4xl font-bold tracking-tight text-amber-700 heatmap-mono">11</div>
              <div className="text-amber-600 mt-1">Starting in {"<"} 14 Days</div>
            </div>
            <div className="mt-6 pt-4 border-t border-amber-200/50 flex items-center justify-between text-sm">
              <span className="text-amber-700 font-medium">Immediate action required</span>
              <button className="text-amber-700 hover:text-amber-800 flex items-center gap-1 font-medium">
                View <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* The Heatmap Section */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-slate-400" />
              Demand Heatmap: Roles by Week
            </h2>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>Less</span>
              <div className="flex h-3 rounded overflow-hidden">
                <div className="w-4 heatmap-cell-1"></div>
                <div className="w-4 heatmap-cell-3"></div>
                <div className="w-4 heatmap-cell-5"></div>
                <div className="w-4 heatmap-cell-7"></div>
                <div className="w-4 heatmap-cell-9"></div>
              </div>
              <span>More hours</span>
            </div>
          </div>

          <div className="heatmap-grid mb-2">
            {/* Top Left Empty Cell */}
            <div className="flex items-end pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Role
            </div>

            {/* Week Headers & Bar Chart */}
            {WEEKS.map((week, i) => (
              <div key={i} className={`flex flex-col justify-end items-center pb-2 ${week.isCurrent ? 'heatmap-col-highlight' : ''}`}>
                {/* Mini Bar */}
                <div className="w-full flex justify-center mb-3 h-16 items-end">
                  <div 
                    className={`w-4/5 rounded-t-sm ${week.isCurrent ? 'bg-blue-500' : 'bg-slate-200'}`}
                    style={{ height: `${(WEEKLY_TOTALS[i] / MAX_TOTAL) * 100}%` }}
                  />
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">W{i+1}</div>
                <div className={`text-xs font-medium whitespace-nowrap ${week.isCurrent ? 'text-blue-600 font-bold' : 'text-slate-600'}`}>
                  {week.label}
                </div>
                <div className={`text-[10px] mt-1 heatmap-mono ${week.isCurrent ? 'text-blue-500 font-bold' : 'text-slate-400'}`}>
                  {WEEKLY_TOTALS[i].toLocaleString()}
                </div>
              </div>
            ))}

            {/* Top Right Total Header */}
            <div className="flex items-end justify-end pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              12W Total
            </div>
          </div>

          <div className="flex flex-col gap-1">
            {heatmapData.map((row, rIdx) => (
              <div key={rIdx} className="heatmap-grid items-center group">
                {/* Row Label */}
                <div className="text-sm font-medium text-slate-700 truncate pr-4 group-hover:text-blue-600 transition-colors cursor-pointer flex items-center gap-2">
                  {row.name}
                </div>

                {/* Heatmap Cells */}
                {row.data.map((val, cIdx) => (
                  <div 
                    key={cIdx} 
                    className={`h-10 rounded-sm flex items-center justify-center text-xs heatmap-mono transition-all hover:ring-2 hover:ring-slate-400 hover:scale-[1.02] cursor-crosshair ${getIntensityClass(val)}`}
                    title={`${row.name} - ${WEEKS[cIdx].label}: ${val} hrs`}
                  >
                    {val > 0 ? val : ''}
                  </div>
                ))}

                {/* Row Total */}
                <div className="text-sm text-right heatmap-mono font-medium text-slate-600 pl-4">
                  {row.total.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Projects Driver Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-base font-bold mb-4 flex items-center justify-between">
              Top Projects Driving Demand
              <button className="text-xs text-blue-600 font-medium hover:underline flex items-center">
                View All <ChevronRight className="w-3 h-3 ml-1" />
              </button>
            </h3>
            <div className="space-y-3">
              {TOP_PROJECTS.map((proj, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer">
                  <div>
                    <div className="font-medium text-sm text-slate-900">{proj.name}</div>
                    <div className="text-xs text-slate-500 heatmap-mono mt-0.5">{proj.id}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold heatmap-mono text-slate-900">{proj.hrs} <span className="text-slate-400 font-normal text-xs">hrs</span></div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide">This Week</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="bg-slate-900 rounded-xl shadow-lg p-6 text-white relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 p-32 bg-blue-500/10 rounded-full blur-3xl mix-blend-screen pointer-events-none" />
            <div className="absolute -bottom-10 -left-10 p-32 bg-purple-500/10 rounded-full blur-3xl mix-blend-screen pointer-events-none" />
            
            <div className="relative z-10">
              <h3 className="text-lg font-bold mb-2">Demand Distribution</h3>
              <p className="text-slate-400 text-sm mb-8">Breakdown of confirmed vs probable requirements across the next 12 weeks.</p>
              
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-medium">Hard Demand (Booked)</span>
                    <span className="heatmap-mono">70%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 w-[70%] rounded-full" />
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-medium">Soft Demand (Pipeline)</span>
                    <span className="heatmap-mono">30%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-400 w-[30%] rounded-full" />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="relative z-10 mt-8 pt-6 border-t border-slate-800">
              <button className="w-full py-3 bg-white text-slate-900 rounded-lg text-sm font-bold hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                Analyze Pipeline Impact
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
