import React, { useState, useMemo } from 'react';
import { 
  Building2, 
  Activity, 
  CheckCircle2, 
  Clock, 
  Zap, 
  BarChart3, 
  ShieldAlert, 
  TrendingUp,
  X,
  Target,
  Briefcase,
  DollarSign
} from 'lucide-react';

// --- DATA ---
type Status = 'Open' | 'Active' | 'Closed';

interface Project {
  id: string;
  name: string;
  status: Status;
  valueM: number;
}

interface Company {
  id: string;
  name: string;
  projects: Project[];
}

const generateId = () => `PMM-22-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

const COMPANIES: Company[] = [
  {
    id: 'c1',
    name: 'Turner Construction',
    projects: [
      { id: generateId(), name: 'JFK Terminal 4 Redevelopment', status: 'Active', valueM: 450 },
      { id: generateId(), name: 'Hudson Yards Concourse', status: 'Active', valueM: 820 },
      { id: generateId(), name: 'Madison Square Tower', status: 'Closed', valueM: 310 },
      { id: generateId(), name: 'East Side Tech Hub', status: 'Open', valueM: 150 },
      { id: generateId(), name: 'Brooklyn Navy Yard Phase 2', status: 'Active', valueM: 280 },
    ]
  },
  {
    id: 'c2',
    name: 'Skanska USA',
    projects: [
      { id: generateId(), name: 'LaGuardia Central Terminal', status: 'Active', valueM: 940 },
      { id: generateId(), name: 'Moynihan Train Hall Overhaul', status: 'Closed', valueM: 1100 },
      { id: generateId(), name: 'Second Avenue Subway Expansion', status: 'Active', valueM: 650 },
      { id: generateId(), name: 'Newark AirTrain Replacement', status: 'Open', valueM: 420 },
    ]
  },
  {
    id: 'c3',
    name: 'NYC DDC',
    projects: [
      { id: generateId(), name: 'Queens Borough Hall Renovation', status: 'Active', valueM: 85 },
      { id: generateId(), name: 'Staten Island Library', status: 'Closed', valueM: 45 },
      { id: generateId(), name: 'Bronx Animal Shelter', status: 'Open', valueM: 30 },
      { id: generateId(), name: 'Manhattan Court Complex', status: 'Active', valueM: 120 },
    ]
  },
  {
    id: 'c4',
    name: 'Port Authority NY/NJ',
    projects: [
      { id: generateId(), name: 'GWB Terminal Overhaul', status: 'Closed', valueM: 550 },
      { id: generateId(), name: 'PATH Train Signal Upgrade', status: 'Active', valueM: 340 },
      { id: generateId(), name: 'Lincoln Tunnel Suspender Ropes', status: 'Open', valueM: 210 },
    ]
  },
  {
    id: 'c5',
    name: 'Gilbane',
    projects: [
      { id: generateId(), name: 'NYU Langone Expansion', status: 'Active', valueM: 410 },
      { id: generateId(), name: 'Columbia University Science Bldg', status: 'Closed', valueM: 260 },
      { id: generateId(), name: 'Mount Sinai Annex', status: 'Active', valueM: 190 },
      { id: generateId(), name: 'Fordham Business School', status: 'Open', valueM: 140 },
    ]
  },
  {
    id: 'c6',
    name: 'AECOM',
    projects: [
      { id: generateId(), name: 'Gateway Tunnel Portal', status: 'Active', valueM: 1200 },
      { id: generateId(), name: 'Penn Station Access', status: 'Open', valueM: 850 },
      { id: generateId(), name: 'BQE Rehabilitation', status: 'Active', valueM: 430 },
    ]
  },
  {
    id: 'c7',
    name: 'Hensel Phelps',
    projects: [
      { id: generateId(), name: 'Javits Center Expansion', status: 'Closed', valueM: 680 },
      { id: generateId(), name: 'UN Headquarters Revamp', status: 'Active', valueM: 320 },
    ]
  },
  {
    id: 'c8',
    name: 'Suffolk',
    projects: [
      { id: generateId(), name: 'Waldorf Astoria Hotel', status: 'Active', valueM: 290 },
      { id: generateId(), name: 'One Vanderbilt Restoration', status: 'Open', valueM: 180 },
      { id: generateId(), name: 'Plaza Hotel Condos', status: 'Closed', valueM: 410 },
      { id: generateId(), name: 'Pier 17 Redevelopment', status: 'Active', valueM: 220 },
      { id: generateId(), name: 'Hudson Square Boutique Hotel', status: 'Active', valueM: 150 },
    ]
  }
];

const TOTAL_PORTFOLIO_VALUE = COMPANIES.reduce((acc, comp) => 
  acc + comp.projects.reduce((sum, p) => sum + p.valueM, 0)
, 0);

// --- STYLES ---
const styles = `
  :root {
    --bg-base: #050505;
    --bg-surface: #0a0a0c;
    --bg-surface-hover: #121215;
    --bg-panel: #111114;
    --border-dim: rgba(255,255,255,0.06);
    --border-glow: rgba(107, 165, 57, 0.2);
    --text-main: #f0f0f0;
    --text-muted: #888890;
    --brand-green: #6BA539;
    --brand-green-glow: rgba(107, 165, 57, 0.15);
    
    --status-active: #4F93E6;
    --status-open: #D69E3A;
    --status-closed: #5A5A62;
  }
  
  * { box-sizing: border-box; }
  
  .cc-container {
    width: 100vw;
    height: 100vh;
    background-color: var(--bg-base);
    color: var(--text-main);
    font-family: 'Inter', -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .cc-header {
    padding: 24px 32px;
    border-bottom: 1px solid var(--border-dim);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-base) 100%);
  }
  
  .cc-title {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .cc-title-dot {
    width: 8px;
    height: 8px;
    background-color: var(--brand-green);
    border-radius: 50%;
    box-shadow: 0 0 12px var(--brand-green);
  }
  
  .cc-grid-wrapper {
    flex: 1;
    overflow: auto;
    padding: 32px;
  }
  
  .cc-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 8px;
  }
  
  .cc-th {
    text-align: left;
    padding: 0 16px 12px 16px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-weight: 500;
  }
  
  .cc-tr {
    background-color: var(--bg-surface);
    transition: all 0.2s ease;
    border-radius: 6px;
  }
  
  .cc-tr:hover {
    background-color: var(--bg-surface-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(0,0,0,0.4), inset 0 0 0 1px var(--border-glow);
  }
  
  .cc-td {
    padding: 16px;
    font-size: 14px;
    border-top: 1px solid var(--border-dim);
    border-bottom: 1px solid var(--border-dim);
  }
  
  .cc-tr .cc-td:first-child {
    border-left: 1px solid var(--border-dim);
    border-top-left-radius: 6px;
    border-bottom-left-radius: 6px;
  }
  
  .cc-tr .cc-td:last-child {
    border-right: 1px solid var(--border-dim);
    border-top-right-radius: 6px;
    border-bottom-right-radius: 6px;
  }
  
  .cc-company-name {
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    transition: color 0.2s ease;
  }
  
  .cc-company-name:hover {
    color: var(--brand-green);
  }
  
  .cc-mono {
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 13px;
  }
  
  .cc-cell-clickable {
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.2s ease;
    display: inline-block;
  }
  
  .cc-cell-clickable:hover {
    background-color: rgba(255,255,255,0.08);
  }
  
  .cc-value {
    color: #fff;
    font-weight: 500;
  }
  
  .cc-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    background: var(--brand-green-glow);
    color: var(--brand-green);
    border: 1px solid rgba(107, 165, 57, 0.3);
    transition: all 0.2s ease;
  }
  
  .cc-badge:hover {
    background: rgba(107, 165, 57, 0.25);
    box-shadow: 0 0 15px rgba(107, 165, 57, 0.2);
  }

  /* Modal Overlay */
  .cc-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 32px;
    opacity: 0;
    animation: fadeIn 0.2s forwards;
  }
  
  @keyframes fadeIn { to { opacity: 1; } }
  
  /* Popups */
  .cc-popup {
    background: var(--bg-panel);
    border: 1px solid var(--border-dim);
    border-radius: 12px;
    width: 100%;
    max-width: 600px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05);
    overflow: hidden;
    transform: translateY(10px);
    animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  
  @keyframes slideUp { to { transform: translateY(0); } }
  
  .cc-popup-header {
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-dim);
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(255,255,255,0.01);
  }
  
  .cc-popup-title {
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .cc-close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }
  
  .cc-close-btn:hover {
    background: rgba(255,255,255,0.1);
    color: #fff;
  }
  
  .cc-popup-body {
    padding: 24px;
    max-height: 70vh;
    overflow-y: auto;
  }
  
  /* Drilldown List */
  .cc-record-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .cc-record-item {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    background: rgba(255,255,255,0.02);
    border: 1px solid var(--border-dim);
    border-radius: 8px;
  }
  
  /* AI Analysis Layout */
  .cc-ai-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 24px;
  }
  
  .cc-ai-stat {
    background: rgba(255,255,255,0.02);
    border: 1px solid var(--border-dim);
    padding: 16px;
    border-radius: 8px;
  }
  
  .cc-ai-stat-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }
  
  .cc-ai-stat-val {
    font-size: 18px;
    font-weight: 500;
  }
  
  .cc-perspective {
    background: linear-gradient(145deg, rgba(107, 165, 57, 0.05) 0%, transparent 100%);
    border: 1px solid var(--border-glow);
    border-radius: 8px;
    padding: 20px;
  }
  
  .cc-perspective-title {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--brand-green);
    margin-bottom: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .cc-perspective-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  
  .cc-perspective-item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  
  .cc-perspective-icon {
    color: var(--brand-green);
    margin-top: 2px;
  }
  
  .cc-perspective-text {
    font-size: 14px;
    line-height: 1.5;
    color: #e0e0e0;
  }
  
  .cc-perspective-label {
    font-weight: 600;
    color: #fff;
    margin-right: 6px;
  }
`;

// --- COMPONENTS ---

export default function CommandCenter() {
  const [drilldown, setDrilldown] = useState<{ company: Company, type: Status | 'Total', records: Project[] } | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<Company | null>(null);

  const handleCellClick = (company: Company, type: Status | 'Total') => {
    const records = type === 'Total' 
      ? company.projects 
      : company.projects.filter(p => p.status === type);
    setDrilldown({ company, type, records });
  };

  return (
    <div className="cc-container">
      <style>{styles}</style>
      
      <header className="cc-header">
        <div className="cc-title">
          <div className="cc-title-dot" />
          RMOne / Command Center
        </div>
        <div className="cc-mono" style={{ color: 'var(--brand-green)' }}>
          LIVE DATA STREAM
        </div>
      </header>
      
      <div className="cc-grid-wrapper">
        <table className="cc-table">
          <thead>
            <tr>
              <th className="cc-th">Client Company</th>
              <th className="cc-th">Total Records</th>
              <th className="cc-th">Open</th>
              <th className="cc-th">Active</th>
              <th className="cc-th">Closed</th>
              <th className="cc-th">Total Contract Value</th>
              <th className="cc-th" style={{ textAlign: 'right' }}>Intelligence</th>
            </tr>
          </thead>
          <tbody>
            {COMPANIES.map(company => {
              const total = company.projects.length;
              const open = company.projects.filter(p => p.status === 'Open').length;
              const active = company.projects.filter(p => p.status === 'Active').length;
              const closed = company.projects.filter(p => p.status === 'Closed').length;
              const val = company.projects.reduce((sum, p) => sum + p.valueM, 0);
              
              return (
                <tr key={company.id} className="cc-tr">
                  <td className="cc-td">
                    <span className="cc-company-name" onClick={() => setAiAnalysis(company)}>
                      <Building2 size={16} color="var(--text-muted)" />
                      {company.name}
                    </span>
                  </td>
                  <td className="cc-td">
                    <span className="cc-cell-clickable cc-mono" onClick={() => handleCellClick(company, 'Total')}>
                      {total}
                    </span>
                  </td>
                  <td className="cc-td">
                    <span className="cc-cell-clickable cc-mono" style={{ color: open ? 'var(--status-open)' : 'inherit' }} onClick={() => handleCellClick(company, 'Open')}>
                      {open}
                    </span>
                  </td>
                  <td className="cc-td">
                    <span className="cc-cell-clickable cc-mono" style={{ color: active ? 'var(--status-active)' : 'inherit' }} onClick={() => handleCellClick(company, 'Active')}>
                      {active}
                    </span>
                  </td>
                  <td className="cc-td">
                    <span className="cc-cell-clickable cc-mono" style={{ color: closed ? 'var(--status-closed)' : 'inherit' }} onClick={() => handleCellClick(company, 'Closed')}>
                      {closed}
                    </span>
                  </td>
                  <td className="cc-td cc-value cc-mono">
                    ${val.toLocaleString()}M
                  </td>
                  <td className="cc-td" style={{ textAlign: 'right' }}>
                    <button className="cc-badge" onClick={() => setAiAnalysis(company)}>
                      <Zap size={14} /> AI Analysis
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drilldown Modal */}
      {drilldown && (
        <div className="cc-overlay" onClick={() => setDrilldown(null)}>
          <div className="cc-popup" onClick={e => e.stopPropagation()}>
            <div className="cc-popup-header">
              <div className="cc-popup-title">
                <Activity size={18} color="var(--brand-green)" />
                {drilldown.company.name} - {drilldown.type} Records
              </div>
              <button className="cc-close-btn" onClick={() => setDrilldown(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="cc-popup-body">
              <div className="cc-record-list">
                {drilldown.records.map(r => (
                  <div key={r.id} className="cc-record-item">
                    <span className="cc-mono" style={{ color: 'var(--text-muted)' }}>{r.id}</span>
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                    <span className="cc-mono" style={{
                      color: r.status === 'Active' ? 'var(--status-active)' : r.status === 'Open' ? 'var(--status-open)' : 'var(--status-closed)'
                    }}>
                      {r.status}
                    </span>
                    <span className="cc-mono">${r.valueM}M</span>
                  </div>
                ))}
                {drilldown.records.length === 0 && (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>No records found.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Analysis Modal */}
      {aiAnalysis && (() => {
        const c = aiAnalysis;
        const total = c.projects.length;
        const val = c.projects.reduce((sum, p) => sum + p.valueM, 0);
        const share = ((val / TOTAL_PORTFOLIO_VALUE) * 100).toFixed(1);
        const avg = total > 0 ? Math.round(val / total) : 0;
        const largest = c.projects.reduce((max, p) => p.valueM > max.valueM ? p : max, c.projects[0]);
        const active = c.projects.filter(p => p.status === 'Active').length;
        
        return (
          <div className="cc-overlay" onClick={() => setAiAnalysis(null)}>
            <div className="cc-popup" onClick={e => e.stopPropagation()}>
              <div className="cc-popup-header">
                <div className="cc-popup-title">
                  <Zap size={18} color="var(--brand-green)" />
                  AI Portfolio Analysis: {c.name}
                </div>
                <button className="cc-close-btn" onClick={() => setAiAnalysis(null)}>
                  <X size={20} />
                </button>
              </div>
              <div className="cc-popup-body">
                
                <div className="cc-ai-grid">
                  <div className="cc-ai-stat">
                    <div className="cc-ai-stat-label">Portfolio Share</div>
                    <div className="cc-ai-stat-val cc-mono">{share}%</div>
                  </div>
                  <div className="cc-ai-stat">
                    <div className="cc-ai-stat-label">Avg Proj Size</div>
                    <div className="cc-ai-stat-val cc-mono">${avg}M</div>
                  </div>
                  <div className="cc-ai-stat" style={{ gridColumn: 'span 2' }}>
                    <div className="cc-ai-stat-label">Largest Active Project</div>
                    <div className="cc-ai-stat-val" style={{ fontSize: '15px' }}>{largest?.name || 'N/A'} <span className="cc-mono" style={{ color: 'var(--text-muted)' }}>(${largest?.valueM || 0}M)</span></div>
                  </div>
                </div>

                <div className="cc-perspective">
                  <div className="cc-perspective-title">
                    <ShieldAlert size={14} /> Management Perspective
                  </div>
                  <div className="cc-perspective-list">
                    <div className="cc-perspective-item">
                      <Target size={16} className="cc-perspective-icon" />
                      <div className="cc-perspective-text">
                        <span className="cc-perspective-label">Strategy:</span> 
                        {share > '10' ? 'High concentration risk detected; consider diversifying future awards to alternative contractors to mitigate dependency.' : 'Healthy distribution of capital across specialized sectors, maintaining competitive leverage in upcoming bids.'}
                      </div>
                    </div>
                    <div className="cc-perspective-item">
                      <DollarSign size={16} className="cc-perspective-icon" />
                      <div className="cc-perspective-text">
                        <span className="cc-perspective-label">Financials:</span> 
                        With an average project size of ${avg}M, cash flow burn rate is projected to peak next quarter on active sites; monitor contingency drawdowns closely.
                      </div>
                    </div>
                    <div className="cc-perspective-item">
                      <Briefcase size={16} className="cc-perspective-icon" />
                      <div className="cc-perspective-text">
                        <span className="cc-perspective-label">Delivery:</span> 
                        {active} out of {total} projects are actively burning hours; resource allocation appears stable but may strain if open projects commence concurrently.
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
