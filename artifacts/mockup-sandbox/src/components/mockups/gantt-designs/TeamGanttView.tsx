import React from 'react';

const PHASE: Record<string, { bg: string; text: string; label: string; outline?: string }> = {
  'Props':       { bg: '#808080', text: '#fff',    label: 'Props'       },
  'Soft':        { bg: '#FFFFFF', text: '#808080', label: 'Soft',        outline: '#808080' },
  'No Phase':    { bg: '#D0BF9E', text: '#3d2e14', label: 'No Phase'    },
  'Non-Project': { bg: '#000000', text: '#fff',    label: 'Non-Project' },
  'Pre-SD':      { bg: '#C9F1E4', text: '#1a5c44', label: 'Pre-SD'     },
  'SD':          { bg: '#86D5CA', text: '#1a4a45', label: 'SD'         },
  'DD':          { bg: '#44A2B1', text: '#fff',    label: 'DD'         },
  'CD':          { bg: '#236E97', text: '#fff',    label: 'CD'         },
  'Bidding':     { bg: '#1B296D', text: '#fff',    label: 'Bidding'    },
  'CM':          { bg: '#79260A', text: '#fff',    label: 'CM'         },
  'CO':          { bg: '#DD8629', text: '#3d1f00', label: 'CO'         },
};

// 12-month window: Jan–Dec 2026
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const M = 12;

// Today = Jul 26 → (6 + 26/31) / 12
const TODAY_FRAC = (6 + 26 / 31) / M;

const PHASE_BANDS = [
  { phase: 'Pre-SD', sf: 0/12, ef: 3/12  },
  { phase: 'SD',     sf: 3/12, ef: 9/12  },
  { phase: 'DD',     sf: 9/12, ef: 12/12 },
];

interface Member {
  initials: string; name: string; role: string;
  phase: string; sf: number; ef: number; open?: boolean;
}

const MEMBERS: Member[] = [
  { initials:'SC', name:'Sarah Chen',      role:'Project Architect',  phase:'SD',     sf:0/12,  ef:12/12 },
  { initials:'MT', name:'Michael Torres',  role:'BIM Manager',         phase:'SD',     sf:2/12,  ef:11/12 },
  { initials:'DP', name:'Diana Patel',     role:'Interior Designer',   phase:'DD',     sf:5/12,  ef:10/12 },
  { initials:'JL', name:'James Liu',       role:'Structural Engineer', phase:'Pre-SD', sf:0/12,  ef: 6/12 },
  { initials:'RK', name:'Rachel Kim',      role:'Project Manager',     phase:'SD',     sf:0/12,  ef:12/12 },
  { initials:'?',  name:'OPEN – MEP Engineer', role:'Mechanical / Electrical', phase:'SD', sf:5/12, ef:12/12, open:true },
];

const AVATAR_BG: Record<string, string> = {
  SC:'#44A2B1', MT:'#236E97', DP:'#DD8629', JL:'#86D5CA', RK:'#6BA639',
};

export function TeamGanttView() {
  return (
    <div style={{ width:'100vw', height:'100vh', background:'#f8fafc', display:'flex', flexDirection:'column', fontFamily:'Inter, system-ui, sans-serif', overflow:'hidden' }}>

      {/* TOP BAR */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'10px 16px', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <div>
          <div style={{ color:'#1e293b', fontSize:14, fontWeight:700 }}>Riverside Mixed-Use Tower</div>
          <div style={{ color:'#94a3b8', fontSize:11 }}>PMM-0042 · Jan 2026 – Dec 2027</div>
        </div>
        {/* Legend pills */}
        <div style={{ display:'flex', gap:6, marginLeft:12, flexWrap:'wrap' }}>
          {Object.entries(PHASE).map(([k,v]) => (
            <div key={k} style={{ display:'flex', alignItems:'center', gap:3 }}>
              <div style={{ width:10, height:10, borderRadius:'50%', background:v.bg,
                border: v.outline ? `2px solid ${v.outline}` : '1px solid rgba(0,0,0,0.12)' }} />
              <span style={{ fontSize:9, color:'#64748b' }}>{k}</span>
            </div>
          ))}
        </div>
        {/* Toggle */}
        <div style={{ marginLeft:'auto', display:'flex', border:'1px solid #e2e8f0', borderRadius:6, overflow:'hidden' }}>
          <button style={{ background:'#fff', border:'none', color:'#64748b', padding:'5px 14px', fontSize:12, cursor:'pointer' }}>Schedule</button>
          <button style={{ background:'#44A2B1', border:'none', color:'#fff', padding:'5px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>Gantt</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* LEFT FROZEN */}
        <div style={{ width:240, flexShrink:0, background:'#fff', borderRight:'1px solid #e2e8f0', display:'flex', flexDirection:'column' }}>
          {/* phase band header height placeholder */}
          <div style={{ height:36, borderBottom:'1px solid #e2e8f0', background:'#f8fafc' }} />
          {/* month sub-header height placeholder */}
          <div style={{ height:24, borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', paddingLeft:10 }}>
            <span style={{ color:'#94a3b8', fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:0.8 }}>Team Member</span>
          </div>
          {/* Member rows */}
          {MEMBERS.map(m => (
            <div key={m.name} style={{ height:52, borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', padding:'0 10px', gap:8 }}>
              {m.open ? (
                <div style={{ width:30, height:30, borderRadius:'50%', border:'2px dashed #F9AB33', display:'flex', alignItems:'center', justifyContent:'center', color:'#F9AB33', fontSize:14, flexShrink:0 }}>?</div>
              ) : (
                <div style={{ width:30, height:30, borderRadius:'50%', background: AVATAR_BG[m.initials]||'#94a3b8', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:11, fontWeight:700, flexShrink:0 }}>
                  {m.initials}
                </div>
              )}
              <div style={{ overflow:'hidden' }}>
                <div style={{ color: m.open ? '#F9AB33' : '#1e293b', fontSize:12, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{m.name}</div>
                <div style={{ color:'#94a3b8', fontSize:10, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{m.role}</div>
              </div>
            </div>
          ))}
        </div>

        {/* TIMELINE */}
        <div style={{ flex:1, overflow:'auto', position:'relative' }}>
          <div style={{ minWidth:680, position:'relative' }}>

            {/* PHASE BAND HEADER */}
            <div style={{ height:36, display:'flex', borderBottom:'1px solid #e2e8f0', position:'relative' }}>
              {PHASE_BANDS.map((band, i) => {
                const c = PHASE[band.phase];
                return (
                  <div key={i} style={{
                    position:'absolute',
                    left:`${band.sf * 100}%`,
                    width:`${(band.ef - band.sf) * 100}%`,
                    height:'100%',
                    background: c.bg,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color: c.text, fontSize:11, fontWeight:700,
                    borderRight:'2px solid rgba(255,255,255,0.6)',
                    overflow:'hidden',
                  }}>
                    {c.label}
                  </div>
                );
              })}
            </div>

            {/* MONTH SUB-HEADER */}
            <div style={{ height:24, display:'flex', borderBottom:'1px solid #e2e8f0', background:'#f8fafc' }}>
              {MONTHS.map((mo, i) => (
                <div key={i} style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:9, fontWeight:600, borderRight:'1px solid #e2e8f0' }}>
                  {mo}
                </div>
              ))}
            </div>

            {/* TODAY line (spans full height) */}
            <div style={{ position:'absolute', top:0, bottom:0, left:`${TODAY_FRAC * 100}%`, width:2, background:'#FF5757', zIndex:20, pointerEvents:'none' }}>
              <div style={{ position:'absolute', top:60, left:'50%', transform:'translateX(-50%)', background:'#FF5757', color:'#fff', fontSize:8, fontWeight:700, padding:'2px 4px', borderRadius:3, whiteSpace:'nowrap' }}>TODAY</div>
            </div>

            {/* MEMBER ROWS */}
            {MEMBERS.map(m => (
              <div key={m.name} style={{ height:52, position:'relative', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center' }}>
                {/* Month grid lines */}
                {MONTHS.map((_, i) => (
                  <div key={i} style={{ position:'absolute', left:`${(i/M)*100}%`, top:0, bottom:0, width:1, background:'#f1f5f9' }} />
                ))}
                {/* Bar */}
                <div style={{
                  position:'absolute',
                  left:`${m.sf * 100}%`,
                  width:`${(m.ef - m.sf) * 100}%`,
                  height:32,
                  background: m.open ? 'transparent' : PHASE[m.phase].bg,
                  border: m.open ? '2px dashed #F9AB33' : 'none',
                  borderRadius:16,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  color: m.open ? '#F9AB33' : PHASE[m.phase].text,
                  fontSize:11, fontWeight:700,
                  overflow:'hidden',
                  boxShadow: m.open ? 'none' : '0 1px 4px rgba(0,0,0,0.1)',
                  paddingLeft:12, paddingRight:12,
                }}>
                  <span style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {m.open ? 'OPEN · MEP Engineer' : `${m.name} · ${m.phase}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
