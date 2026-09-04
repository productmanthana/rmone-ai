import React from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

const PHASE: Record<string, { bg: string; text: string; outline?: string }> = {
  'Props':       { bg: '#808080', text: '#fff' },
  'Soft':        { bg: '#FFFFFF', text: '#808080', outline: '#808080' },
  'No Phase':    { bg: '#D0BF9E', text: '#3d2e14' },
  'Non-Project': { bg: '#000000', text: '#fff' },
  'Pre-SD':      { bg: '#C9F1E4', text: '#1a5c44' },
  'SD':          { bg: '#86D5CA', text: '#1a4a45' },
  'DD':          { bg: '#44A2B1', text: '#fff' },
  'CD':          { bg: '#236E97', text: '#fff' },
  'Bidding':     { bg: '#1B296D', text: '#fff' },
  'CM':          { bg: '#79260A', text: '#fff' },
  'CO':          { bg: '#DD8629', text: '#3d1f00' },
};

const MONTHS = ['Apr 2026','May 2026','Jun 2026','Jul 2026','Aug 2026','Sep 2026'];
const M = MONTHS.length;

// Today = Jul 26 → fraction = (3 + 26/31) / 6
const TODAY_FRAC = (3 + 26 / 31) / M;

interface GanttProj {
  code: string; name: string; phase: string; pct: number;
  sf: number; ef: number; // start/end fraction 0–1
}

const PROJECTS: GanttProj[] = [
  { code: 'PMM-0042', name: 'Riverside Mixed-Use Tower',    phase: 'DD',     pct: 60, sf: 0/6,   ef: 3.5/6 },
  { code: 'PMM-0039', name: 'Harbor Civic Center',          phase: 'SD',     pct: 40, sf: 1/6,   ef: 4.5/6 },
  { code: 'PMM-0058', name: 'Downtown Residential Phase 2', phase: 'Pre-SD', pct: 20, sf: 2/6,   ef: 6/6   },
];

// monthly % utilisation (Apr–Sep)
const CAPACITY = [60, 100, 120, 100, 80, 20];

export function StaffGanttModal() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, width: 920, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>

        {/* HEADER */}
        <div style={{ background: '#f8fafc', padding: '14px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#236E97', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700 }}>MT</div>
          <div>
            <div style={{ color: '#1e293b', fontSize: 15, fontWeight: 700 }}>Michael Torres</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>BIM Manager · Architecture, PC</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ChevronLeft size={14} color="#94a3b8" />
              <span style={{ color: '#475569', fontSize: 12 }}>Apr – Sep 2026</span>
              <ChevronRight size={14} color="#94a3b8" />
            </div>
            <button style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#475569', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
              View Weekly Detail
            </button>
            <div style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <X size={14} color="#94a3b8" />
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>

          {/* CAPACITY BAR */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Monthly Capacity</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {CAPACITY.map((pct, i) => {
                const over = pct > 100;
                const bg = over ? '#F9AB33' : pct > 80 ? '#FF5757' : '#6BA639';
                return (
                  <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ height: 32, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{ width: '100%', height: `${Math.min(pct, 100)}%`, background: bg }} />
                    </div>
                    <div style={{ fontSize: 10, color: bg, marginTop: 3, fontWeight: 600 }}>{pct}%</div>
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>{MONTHS[i].slice(0, 3)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* GANTT */}
          <div style={{ display: 'flex' }}>
            {/* LEFT */}
            <div style={{ width: 270, flexShrink: 0, borderRight: '1px solid #e2e8f0' }}>
              <div style={{ height: 36, borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
                <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600 }}>PROJECT</span>
              </div>
              {PROJECTS.map(proj => (
                <div key={proj.code} style={{ height: 56, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', paddingRight: 12, paddingLeft: 8, gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: PHASE[proj.phase].bg, flexShrink: 0 }} />
                  <div>
                    <div style={{ color: '#94a3b8', fontSize: 10 }}>{proj.code}</div>
                    <div style={{ color: '#1e293b', fontSize: 12, fontWeight: 600, maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proj.name}</div>
                    <div style={{ display: 'inline-block', background: PHASE[proj.phase].bg, color: PHASE[proj.phase].text, fontSize: 9, padding: '1px 6px', borderRadius: 8, fontWeight: 700, marginTop: 2 }}>{proj.phase}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* TIMELINE */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {/* Month headers */}
              <div style={{ display: 'flex', height: 36, borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                {MONTHS.map((mo, i) => (
                  <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 10, fontWeight: 600, borderRight: '1px solid #e2e8f0' }}>
                    {mo}
                  </div>
                ))}
              </div>

              {/* Project rows */}
              {PROJECTS.map(proj => (
                <div key={proj.code} style={{ height: 56, position: 'relative', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center' }}>
                  {/* Grid lines */}
                  {MONTHS.map((_, i) => (
                    <div key={i} style={{ position: 'absolute', left: `${(i / M) * 100}%`, top: 0, bottom: 0, width: 1, background: '#f1f5f9' }} />
                  ))}
                  {/* TODAY */}
                  <div style={{ position: 'absolute', left: `${TODAY_FRAC * 100}%`, top: 0, bottom: 0, width: 2, background: '#FF5757', zIndex: 5 }} />
                  {/* Bar — left edge fades to ~60% opacity to simulate partial first week */}
                  <div style={{
                    position: 'absolute',
                    left: `${proj.sf * 100}%`,
                    width: `${(proj.ef - proj.sf) * 100}%`,
                    height: 34,
                    background: `linear-gradient(to right, ${PHASE[proj.phase].bg}9E 0%, ${PHASE[proj.phase].bg}9E 4%, ${PHASE[proj.phase].bg} 12%)`,
                    border: PHASE[proj.phase].outline ? `1px solid ${PHASE[proj.phase].outline}` : 'none',
                    borderRadius: 17,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: PHASE[proj.phase].text,
                    fontSize: 11, fontWeight: 700,
                    overflow: 'hidden',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                    paddingLeft: 10, paddingRight: 10,
                  }}>
                    {proj.pct}% · {proj.phase}
                  </div>
                </div>
              ))}

              {/* TODAY label */}
              <div style={{ position: 'absolute', top: 36, left: `${TODAY_FRAC * 100}%`, transform: 'translateX(-50%)', zIndex: 10 }}>
                <div style={{ background: '#FF5757', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, whiteSpace: 'nowrap' }}>TODAY</div>
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0', padding: '10px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
          <button style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: 8, padding: '6px 18px', fontSize: 13, cursor: 'pointer' }}>Close</button>
          <button style={{ background: '#44A2B1', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>View Weekly Detail</button>
        </div>
      </div>
    </div>
  );
}
