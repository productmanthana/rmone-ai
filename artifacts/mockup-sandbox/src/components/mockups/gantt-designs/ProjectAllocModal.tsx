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

const UTIL = {
  Under: { bg: '#FF5757', text: '#fff' },
  Good:  { bg: '#6BA639', text: '#fff' },
  Over:  { bg: '#F9AB33', text: '#fff' },
};

const WEEKS = ['07-Jul','14-Jul','21-Jul','28-Jul','04-Aug','11-Aug'];
const AVAIL = 40;

const PROJECTS = [
  { code: 'PMM-0042', name: 'Riverside Mixed-Use Tower',  client: 'TFG Properties LLC',  phase: 'DD',     hours: [24,24,24,24,24,24] as number[] },
  { code: 'PMM-0039', name: 'Harbor Civic Center',         client: 'Port Authority NYC',   phase: 'SD',     hours: [16,16, 8,16,16, 8] as number[] },
  { code: 'PMM-0051', name: 'Tech Campus Expansion',       client: 'Meridian Tech Group',  phase: 'Pre-SD', hours: [ 0, 8, 8, 8, 0, 8] as number[] },
];

function Cell({ h, phase }: { h: number; phase: string }) {
  const c = PHASE[phase];
  if (h === 0) return (
    <td style={{ width: 88, border: '1px solid #e2e8f0', padding: 0, background: '#fff' }}>
      <div style={{ height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e0', fontSize: 11 }}>0</div>
    </td>
  );
  return (
    <td style={{ width: 88, border: '1px solid #e2e8f0', padding: 0 }}>
      <div style={{ height: 30, background: c.bg, border: c.outline ? `1px solid ${c.outline}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.text, fontSize: 12, fontWeight: 700 }}>
        {h}h
      </div>
    </td>
  );
}

export function ProjectAllocModal() {
  const totals = WEEKS.map((_, wi) => PROJECTS.reduce((s, p) => s + p.hours[wi], 0));

  return (
    <div style={{ width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, width: 860, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>

        {/* HEADER */}
        <div style={{ background: '#f8fafc', padding: '14px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#44A2B1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700 }}>SC</div>
          <div>
            <div style={{ color: '#1e293b', fontSize: 15, fontWeight: 700 }}>Sarah Chen</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>Project Architect · Architecture, PC</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ChevronLeft size={14} color="#94a3b8" />
              <span style={{ color: '#475569', fontSize: 12 }}>Jul 7 – Aug 11, 2026</span>
              <ChevronRight size={14} color="#94a3b8" />
            </div>
            <div style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <X size={14} color="#94a3b8" />
            </div>
          </div>
        </div>

        {/* CAPACITY BAR */}
        <div style={{ background: '#f8fafc', padding: '10px 20px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, paddingBottom: 2 }}>Capacity</span>
            {WEEKS.map((w, i) => {
              const t = totals[i]; const over = t > AVAIL; const pct = Math.min((t / AVAIL) * 100, 100);
              const c = t === 0 ? UTIL.Under : over ? UTIL.Over : UTIL.Good;
              return (
                <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>{w}</div>
                  <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: c.bg, borderRadius: 4 }} />
                  </div>
                  <div style={{ fontSize: 10, color: c.bg, marginTop: 2 }}>{t}h / {AVAIL}h</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* GRID */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 250 }} />
              {WEEKS.map((_, i) => <col key={i} style={{ width: 88 }} />)}
              <col style={{ width: 70 }} />
            </colgroup>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ border: '1px solid #e2e8f0', padding: '6px 12px', color: '#64748b', fontSize: 11, textAlign: 'left' }}>Project</th>
                {WEEKS.map(w => (
                  <th key={w} style={{ border: '1px solid #e2e8f0', color: '#64748b', fontSize: 10, fontWeight: 600, textAlign: 'center', padding: '6px 0' }}>{w}</th>
                ))}
                <th style={{ border: '1px solid #e2e8f0', color: '#64748b', fontSize: 10, textAlign: 'center', padding: '6px 0' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {PROJECTS.map(proj => {
                const rowTotal = proj.hours.reduce((a, b) => a + b, 0);
                return (
                  <tr key={proj.code} style={{ background: '#fff' }}>
                    <td style={{ border: '1px solid #e2e8f0', padding: '6px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: PHASE[proj.phase].bg, border: PHASE[proj.phase].outline ? `1px solid ${PHASE[proj.phase].outline}` : '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
                        <div>
                          <div style={{ color: '#94a3b8', fontSize: 10 }}>{proj.code}</div>
                          <div style={{ color: '#1e293b', fontSize: 12, fontWeight: 600 }}>{proj.name}</div>
                          <div style={{ color: '#cbd5e0', fontSize: 10 }}>{proj.client}</div>
                        </div>
                        <div style={{ marginLeft: 'auto', background: PHASE[proj.phase].bg, border: PHASE[proj.phase].outline ? `1px solid ${PHASE[proj.phase].outline}` : 'none', color: PHASE[proj.phase].text, fontSize: 9, padding: '1px 7px', borderRadius: 8, fontWeight: 700, flexShrink: 0 }}>{proj.phase}</div>
                      </div>
                    </td>
                    {proj.hours.map((h, i) => <Cell key={i} h={h} phase={proj.phase} />)}
                    <td style={{ border: '1px solid #e2e8f0', padding: 0 }}>
                      <div style={{ height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 11, fontWeight: 600 }}>{rowTotal}h</div>
                    </td>
                  </tr>
                );
              })}
              {/* TOTAL ROW */}
              <tr style={{ background: '#f8fafc' }}>
                <td style={{ border: '1px solid #e2e8f0', padding: '6px 12px', color: '#64748b', fontSize: 11, fontWeight: 700 }}>Total / week</td>
                {totals.map((t, i) => {
                  const over = t > AVAIL;
                  const c = t === 0 ? UTIL.Under : over ? UTIL.Over : UTIL.Good;
                  return (
                    <td key={i} style={{ border: '1px solid #e2e8f0', padding: 0 }}>
                      <div style={{ height: 30, background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.text, fontSize: 12, fontWeight: 700 }}>
                        {t}h
                      </div>
                    </td>
                  );
                })}
                <td style={{ border: '1px solid #e2e8f0', padding: 0 }}>
                  <div style={{ height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 11, fontWeight: 700 }}>
                    {totals.reduce((a, b) => a + b, 0)}h
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* FOOTER */}
        <div style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0', padding: '10px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
          <button style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: 8, padding: '6px 18px', fontSize: 13, cursor: 'pointer' }}>Close</button>
          <button style={{ background: '#44A2B1', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Edit Allocations</button>
        </div>
      </div>
    </div>
  );
}
