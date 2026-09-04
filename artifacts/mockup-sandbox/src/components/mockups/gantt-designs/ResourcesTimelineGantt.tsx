import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

// ── Complete pixel-sampled phase palette ───────────────────────────────────
const PHASE: Record<string, { bg: string; text: string; outline?: string }> = {
  'Props':          { bg: '#808080', text: '#fff' },
  'Soft':           { bg: '#FFFFFF', text: '#808080', outline: '#808080' },
  'No Phase':       { bg: '#D0BF9E', text: '#3d2e14' },
  'Non-Project':    { bg: '#000000', text: '#fff' },
  'Pre-SD':         { bg: '#C9F1E4', text: '#1a5c44' },
  'SD':             { bg: '#86D5CA', text: '#1a4a45' },
  'DD':             { bg: '#44A2B1', text: '#fff' },
  'CD':             { bg: '#236E97', text: '#fff' },
  'Bidding':        { bg: '#1B296D', text: '#fff' },
  'CM':             { bg: '#79260A', text: '#fff' },
  'CO':             { bg: '#DD8629', text: '#3d1f00' },
  'Custom-Yellow':  { bg: '#FFFF99', text: '#5a4a00' },
  'Custom-Pink':    { bg: '#FF99CC', text: '#5a0030' },
};

// ── Utilization status colors ───────────────────────────────────────────────
const UTIL = {
  Under: { bg: '#FF5757', text: '#fff' },
  Good:  { bg: '#6BA639', text: '#fff' },
  Over:  { bg: '#F9AB33', text: '#fff' },
};

const MONTHS = [
  { label: '← Jul 26 →', span: 4 },
  { label: '← Aug 26 →', span: 5 },
  { label: '← Sep 26 →', span: 4 },
];

const WEEKS = [
  '06-Jul','13-Jul','20-Jul','27-Jul',
  '03-Aug','10-Aug','17-Aug','24-Aug','31-Aug',
  '07-Sep','14-Sep','21-Sep','28-Sep',
];

const HIGHLIGHT_WEEK = '07-Sep';
const HATCH = 'repeating-linear-gradient(-45deg,#E5E5E5,#E5E5E5 1px,#F6F6F6 1px,#F6F6F6 6px)';

type Phase = string;
type UtilKey = 'Under' | 'Good' | 'Over';

interface Project {
  code: string;
  name: string;
  phase: Phase;
  hours: (number | null)[];
}

interface Person {
  name: string;
  org: string;
  util: UtilKey;
  totals: (number | null)[];
  projects: Project[];
}

const DATA: Person[] = [
  {
    name: 'Aaron R Dolber', org: 'Architecture, PC', util: 'Under',
    totals: [39,40,40,35,40,40,38,0,0,0,4,0,0],
    projects: [
      { code:'TEST 20/07 · 1', name:'Architecture, PC TEST 20/07 · 1', phase:'CO',
        hours:[7,7,7,7,0,0,0,0,0,0,0,0,0] },
      { code:'TEST 20/07 · 2', name:'TEST 20/07 · 2', phase:'SD',
        hours:[0,8,8,4,4,0,0,0,0,0,0,0,0] },
      { code:'TEST 21/07',     name:'Architecture, PC TEST 21/07', phase:'DD',
        hours:[32,25,25,24,36,40,38,0,0,0,4,0,0] },
    ],
  },
  {
    name: 'Anello Tedesco', org: 'Oom', util: 'Good',
    totals:[0,40,45,40,45,40,8,0,8,8,0,2,2],
    projects: [
      // Middlesex County = custom yellow (unconfirmed phase — flagged for client)
      { code:'25-244-1029', name:'Middlesex County 25-244-1029', phase:'Custom-Yellow',
        hours:[0,40,40,40,40,40,8,0,8,8,0,2,2] },
      { code:'NYCHA-Steam',  name:'NYCHA – Underground Steam Pipe Bronx', phase:'No Phase',
        hours:[0,0,5,0,5,0,0,0,0,0,0,0,0] },
      { code:'TEST 20/07-2', name:'CA & CI of Multi-Use Paths on Thompson…', phase:'Pre-SD',
        hours:[0,0,0,0,0,0,0,0,0,0,0,0,0] },
    ],
  },
  {
    name: 'Anthony Weber', org: 'Vice President', util: 'Over',
    totals:[72,72,76,74,81,72,38,43,43,43,35,38,38],
    projects: [
      // Holiday = No Phase (tan) — semantically unphased time-off, not Non-Project
      { code:'Holiday-CS',     name:'Holiday · CS',                             phase:'No Phase',
        hours:[8,8,8,8,8,8,8,8,8,8,8,8,8] },
      // Admin = Non-Project (black) — confirmed as non-project admin work
      { code:'Admin',          name:'Admin',                                     phase:'Non-Project',
        hours:[4,4,4,4,4,4,4,4,4,4,4,4,4] },
      // Most NYC municipal projects = No Phase (tan) — unphased in the system
      { code:'18-340-0270.07', name:'NYC Dept · 18-340-0270.07 McMarren Park',  phase:'No Phase',
        hours:[0,0,0,0,0,0,0,0,0,0,0,0,2] },
      { code:'20-164-0278.09', name:'NYC Housing · 20-164-0278.09 Steam Pipe',  phase:'No Phase',
        hours:[0,0,0,0,0,2,2,2,0,2,2,0,0] },
      { code:'23-060-0278.01', name:'NYC Dept · 23-060-0278.01',                phase:'No Phase',
        hours:[2,2,1,1,1,0,0,0,0,0,0,0,0] },
      { code:'24-277-0094',    name:'Con Edison 24-277-0094',                   phase:'No Phase',
        hours:[1,1,1,1,1,1,1,1,0,0,0,0,0] },
      { code:'21-164-2452',    name:'MAT 21-164-2452 Cluster 1 Rehab',          phase:'No Phase',
        hours:[2,2,2,2,2,0,0,0,0,0,0,0,0] },
      { code:'18-340-0270.12', name:'NYC Parks · 18-340-0270.12 Railroad Park', phase:'No Phase',
        hours:[6,9,7,4,0,0,0,0,0,0,0,0,0] },
      // CM = 18-340-0270.11 Fajardo Park Reconstruction
      { code:'18-340-0270.11', name:'NYC Parks · 18-340-0270.11 Fajardo Park',  phase:'CM',
        hours:[1,1,1,1,1,0,0,0,0,0,0,0,0] },
      { code:'19-250-0248.01', name:'NCDPW · 19-250-0248.01 Roadside Drainage', phase:'No Phase',
        hours:[0,0,2,2,2,2,0,0,0,0,0,0,0] },
      // Bidding = 25-141-0270 McCabe Field
      { code:'25-141-0270',    name:'NYC Parks · 25-141-0270 McCabe Field',     phase:'Bidding',
        hours:[0,1,1,1,1,0,0,0,0,0,0,0,0] },
      { code:'25-230-0089.02', name:'City of Yonkers · 25-230 Drive Bridge',    phase:'No Phase',
        hours:[0,0,2,2,0,0,0,0,0,0,0,0,0] },
      // BPCA = custom pink (unconfirmed — flagged for client)
      { code:'25-253-0031',    name:'BPCA Northwest Resiliency Project',         phase:'Custom-Pink',
        hours:[8,8,8,8,4,4,0,0,0,0,0,0,0] },
    ],
  },
  {
    name: 'Diana Patel', org: 'Interior Design', util: 'Good',
    totals:[16,24,24,24,24,24,24,24,16,0,0,0,0],
    projects: [
      { code:'PMM-0042', name:'Riverside Mixed-Use Tower', phase:'DD',
        hours:[16,24,24,24,24,24,24,24,16,0,0,0,0] },
    ],
  },
];

const DEMAND: number[] = [7.62,10.75,14.69,9.38,10.75,12.81,10.32,9.02,8.57,34.21,4.19,3.81,1.08];

const LEFT_W = 290;
const CW = 68;

// ── Cell components ─────────────────────────────────────────────────────────

function PhaseCell({ val, phase, isHighlightCol, isFirst }:
  { val: number | null; phase: Phase; isHighlightCol: boolean; isFirst: boolean }) {
  const c = PHASE[phase] ?? PHASE['No Phase'];
  const colBg = isHighlightCol ? '#f3eeff' : undefined;

  if (!val) {
    return (
      <td style={{ width: CW, minWidth: CW, border: '1px solid #e2e8f0', padding: 0, background: colBg ?? HATCH }}>
        <div style={{ height: 26 }} />
      </td>
    );
  }

  const border = c.outline ? `1px solid ${c.outline}` : 'none';
  // First allocated cell in a bar = ~60% opacity to simulate partial-week start
  const opacity = isFirst ? 0.62 : 1;

  return (
    <td style={{ width: CW, minWidth: CW, border: '1px solid #e2e8f0', padding: 0, background: colBg }}>
      <div style={{
        height: 26, background: c.bg, border, opacity,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: c.text, fontSize: 11, fontWeight: 700,
      }}>
        {val}
      </div>
    </td>
  );
}

function UtilCell({ val, util, isHighlightCol }:
  { val: number | null; util: UtilKey; isHighlightCol: boolean }) {
  const c = UTIL[util];
  const colBg = isHighlightCol ? '#f3eeff' : undefined;

  if (!val) {
    return (
      <td style={{ width: CW, minWidth: CW, border: '1px solid #e2e8f0', padding: 0, background: colBg ?? '#f8fafc' }}>
        <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e0', fontSize: 10 }}>
          {val === 0 ? '0\n0 Proj.' : ''}
        </div>
      </td>
    );
  }
  return (
    <td style={{ width: CW, minWidth: CW, border: '1px solid #e2e8f0', padding: 0, background: colBg }}>
      <div style={{ height: 28, background: c.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: c.text, lineHeight: 1.1 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{val}</span>
        <span style={{ fontSize: 8, opacity: 0.85 }}>Proj.</span>
      </div>
    </td>
  );
}

export function ResourcesTimelineGantt() {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(['Aaron R Dolber','Anello Tedesco','Anthony Weber'])
  );

  const toggle = (name: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden' }}>

      {/* ── LEGEND ─────────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Utilization */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Utilization</span>
          {Object.entries(UTIL).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 13, height: 13, borderRadius: '50%', background: v.bg }} />
              <span style={{ color: '#475569', fontSize: 11 }}>{k}</span>
            </div>
          ))}
        </div>
        <div style={{ width: 1, height: 18, background: '#e2e8f0' }} />
        {/* Allocations */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Allocations</span>
          {Object.entries(PHASE).filter(([k]) => !k.startsWith('Custom')).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{
                width: 13, height: 13, borderRadius: '50%',
                background: v.bg,
                border: v.outline ? `2px solid ${v.outline}` : '1px solid rgba(0,0,0,0.15)',
                flexShrink: 0,
              }} />
              <span style={{ color: '#475569', fontSize: 10 }}>{k}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── GRID ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: LEFT_W + CW * WEEKS.length }}>
          <colgroup>
            <col style={{ width: LEFT_W }} />
            {WEEKS.map((_, i) => <col key={i} style={{ width: CW }} />)}
          </colgroup>
          <thead>
            {/* Month super-header */}
            <tr style={{ background: '#f1f5f9' }}>
              <th style={{ position: 'sticky', left: 0, zIndex: 10, background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '3px 8px', color: '#94a3b8', fontSize: 10, textAlign: 'left' }} />
              {MONTHS.map((m, i) => (
                <th key={i} colSpan={m.span} style={{ border: '1px solid #e2e8f0', color: '#64748b', fontSize: 10, fontWeight: 700, textAlign: 'center', padding: '3px 0', background: '#f1f5f9' }}>
                  {m.label}
                </th>
              ))}
            </tr>
            {/* Week header */}
            <tr>
              <th style={{ position: 'sticky', left: 0, zIndex: 10, background: '#f8fafc', border: '1px solid #e2e8f0', padding: '4px 8px', color: '#94a3b8', fontSize: 10, textAlign: 'left', fontWeight: 600 }}>
                Resource
              </th>
              {WEEKS.map((w) => (
                <th key={w} style={{
                  border: '1px solid #e2e8f0',
                  color: w === HIGHLIGHT_WEEK ? '#5b21b6' : '#64748b',
                  fontSize: 10, fontWeight: 600, textAlign: 'center', padding: '4px 0',
                  // ✦ exact purple from reference for selected column
                  background: w === HIGHLIGHT_WEEK ? '#CFA1EE' : '#f8fafc',
                }}>
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DATA.map(person => {
              const open = expanded.has(person.name);
              return (
                <React.Fragment key={person.name}>
                  {/* PERSON SUMMARY ROW */}
                  <tr style={{ background: '#eef2f7', cursor: 'pointer' }} onClick={() => toggle(person.name)}>
                    <td style={{ position: 'sticky', left: 0, zIndex: 5, background: '#eef2f7', border: '1px solid #e2e8f0', padding: '4px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {open ? <ChevronDown size={12} color="#94a3b8" /> : <ChevronRight size={12} color="#94a3b8" />}
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                          {person.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                        </div>
                        <div>
                          <div style={{ color: '#1e293b', fontSize: 12, fontWeight: 700 }}>{person.name}</div>
                          <div style={{ color: '#94a3b8', fontSize: 10 }}>{person.org}</div>
                        </div>
                        <div style={{ marginLeft: 'auto', background: UTIL[person.util].bg, color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10, flexShrink: 0 }}>
                          {person.util}
                        </div>
                      </div>
                    </td>
                    {person.totals.map((h, i) => (
                      <UtilCell key={i} val={h} util={person.util} isHighlightCol={WEEKS[i] === HIGHLIGHT_WEEK} />
                    ))}
                  </tr>

                  {/* PROJECT SUB-ROWS */}
                  {open && person.projects.map(proj => {
                    // Find first non-null/zero index for partial-opacity treatment
                    const firstIdx = proj.hours.findIndex(h => h && h > 0);
                    return (
                      <tr key={proj.code} style={{ background: '#fff' }}>
                        <td style={{ position: 'sticky', left: 0, zIndex: 5, background: '#fff', border: '1px solid #e2e8f0', padding: '3px 8px 3px 30px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{
                              width: 7, height: 7, borderRadius: 2, flexShrink: 0,
                              background: PHASE[proj.phase]?.bg ?? '#D0BF9E',
                              border: PHASE[proj.phase]?.outline ? `1px solid ${PHASE[proj.phase].outline}` : '1px solid rgba(0,0,0,0.1)',
                            }} />
                            <div>
                              <div style={{ color: '#64748b', fontSize: 9, fontWeight: 600 }}>{proj.code}</div>
                              <div style={{ color: '#94a3b8', fontSize: 9, maxWidth: 215, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proj.name}</div>
                            </div>
                          </div>
                        </td>
                        {proj.hours.map((h, i) => (
                          <PhaseCell
                            key={i} val={h} phase={proj.phase}
                            isHighlightCol={WEEKS[i] === HIGHLIGHT_WEEK}
                            isFirst={i === firstIdx}
                          />
                        ))}
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}

            {/* DEMAND FTE ROW */}
            <tr style={{ background: '#fffbeb' }}>
              <td style={{ position: 'sticky', left: 0, zIndex: 5, background: '#fffbeb', border: '1px solid #fde68a', padding: '4px 8px' }}>
                <span style={{ color: '#92400e', fontSize: 11, fontWeight: 700 }}>Allocated Demand (FTE)</span>
              </td>
              {DEMAND.map((d, i) => (
                <td key={i} style={{ border: '1px solid #fde68a', padding: 0 }}>
                  <div style={{ height: 26, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#92400e', fontSize: 10, fontWeight: 600 }}>
                    {d.toFixed(2)}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
