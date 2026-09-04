const ExcelJS = require('/home/runner/workspace/node_modules/exceljs/lib/exceljs.nodejs.js');

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmtDate(d) { if (!d) return ''; return (d.getMonth()+1).toString().padStart(2,'0') + '/' + d.getDate().toString().padStart(2,'0') + '/' + d.getFullYear(); }
function parseD(s) { if (!s) return null; const [y,m,dx] = s.split('-'); return new Date(+y, +m-1, +dx); }

const opps = [
  { title:'Midtown Mixed-Use Tower OPM',            id:'OPM-26-001', stage:'Shortlisted', chance:75,  sector:'Commercial',       cat:'Building',       value:8200000,  cost:5740000, labor:4100000, nonop:1640000, margin:2460000, contract:'Lump Sum',  status:'Shortlisted', office:'Manhattan',     bidDue:'2026-08-15', interview:'2026-08-28', proposalDue:'2026-09-10', fStart:'2026-10-01', fEnd:'2028-03-31', award:'2026-09-25', company:'Apex Realty Partners',           contact:'David Chen',      poc:'Jennifer Mills',  desc:'Owner rep services for 42-story mixed-use tower in Midtown.',                         notes:'Fee negotiation ongoing; legal review of draft contract.' },
  { title:'Brooklyn Navy Yard Industrial Hub',       id:'OPM-26-002', stage:'Proposal',    chance:60,  sector:'Industrial',       cat:'Building',       value:5600000,  cost:3920000, labor:2800000, nonop:1120000, margin:1680000, contract:'Cost Plus', status:'Proposal',    office:'Brooklyn',      bidDue:'2026-08-20', interview:'',           proposalDue:'2026-09-05', fStart:'2026-10-15', fEnd:'2027-12-31', award:'',           company:'Navy Yard Dev Corp',             contact:'Sarah Huang',     poc:'Michael Torres',  desc:'OPM for adaptive reuse of historic industrial complex on Brooklyn waterfront.',        notes:'Environmental review in progress; Phase II ESA ordered.' },
  { title:'Queens Greenway Bridge Rehab',            id:'OPM-26-003', stage:'Interview',   chance:80,  sector:'Transportation',   cat:'Infrastructure', value:3100000,  cost:2170000, labor:1550000, nonop:620000,  margin:930000,  contract:'Lump Sum',  status:'Interview',   office:'Queens',        bidDue:'2026-07-30', interview:'2026-08-12', proposalDue:'2026-08-25', fStart:'2026-09-15', fEnd:'2027-06-30', award:'',           company:'NYC DOT',                        contact:'Robert Park',     poc:'Lisa Adams',      desc:'PM oversight for greenway pedestrian bridge rehabilitation and ADA upgrades.',         notes:'Federal funding secured; NEPA categorical exclusion received.' },
  { title:'Harlem Hospital Expansion',               id:'OPM-26-004', stage:'Awarded',     chance:100, sector:'Healthcare',       cat:'Building',       value:12500000, cost:8750000, labor:6250000, nonop:2500000, margin:3750000, contract:'GMP',       status:'Active',      office:'Manhattan',     bidDue:'2026-06-01', interview:'2026-06-15', proposalDue:'2026-06-28', fStart:'2026-08-01', fEnd:'2029-01-31', award:'2026-07-10', company:'NYC Health + Hospitals',         contact:'Angela Morris',   poc:'Jennifer Mills',  desc:'New 6-story patient tower addition with full MEP scope and fire code upgrade.',        notes:'Schematic design approved; GC pre-qual underway.' },
  { title:'Staten Island Ferry Terminal Moderniz.',  id:'OPM-26-005', stage:'Proposal',    chance:55,  sector:'Transportation',   cat:'Infrastructure', value:4400000,  cost:3080000, labor:2200000, nonop:880000,  margin:1320000, contract:'Lump Sum',  status:'Proposal',    office:'Staten Island', bidDue:'2026-09-01', interview:'',           proposalDue:'2026-09-20', fStart:'2026-11-01', fEnd:'2028-06-30', award:'',           company:'MTA New York City Transit',      contact:'James Walsh',     poc:'Michael Torres',  desc:'Capital PM for terminal modernization, ADA compliance and passenger flow upgrades.',   notes:'DBE goals 30%; union labor agreement required.' },
  { title:'Bronx Courthouse Phased Renovation',      id:'OPM-26-006', stage:'Shortlisted', chance:70,  sector:'Civic/Government', cat:'Building',       value:6300000,  cost:4410000, labor:3150000, nonop:1260000, margin:1890000, contract:'Cost Plus', status:'Shortlisted', office:'Bronx',         bidDue:'2026-08-10', interview:'2026-08-22', proposalDue:'2026-09-02', fStart:'2026-10-01', fEnd:'2028-02-28', award:'',           company:'NYC Office of Court Admin.',     contact:'Patricia Grant',  poc:'Lisa Adams',      desc:'Phased renovation of historic 1930s courthouse while courts remain operational.',      notes:'Landmark status; LPC approval required for all exterior modifications.' },
  { title:'JFK Cargo Facility Phase 2',              id:'OPM-26-007', stage:'Awarded',     chance:100, sector:'Aviation',         cat:'Infrastructure', value:9800000,  cost:6860000, labor:4900000, nonop:1960000, margin:2940000, contract:'Lump Sum',  status:'Active',      office:'Queens',        bidDue:'2026-05-15', interview:'2026-05-28', proposalDue:'2026-06-10', fStart:'2026-07-01', fEnd:'2028-09-30', award:'2026-06-20', company:'JFKIAT LLC',                     contact:'Thomas Reeves',   poc:'Jennifer Mills',  desc:'Owner representative for new 250k SF air cargo and ground services facility.',         notes:'FAA Part 77 coordination and TSA security integration underway.' },
  { title:'Manhattan School of Music Renovation',    id:'OPM-26-008', stage:'Proposal',    chance:65,  sector:'Education',        cat:'Building',       value:2800000,  cost:1960000, labor:1400000, nonop:560000,  margin:840000,  contract:'Lump Sum',  status:'Proposal',    office:'Manhattan',     bidDue:'2026-09-05', interview:'',           proposalDue:'2026-09-25', fStart:'2026-11-15', fEnd:'2027-08-31', award:'',           company:'Manhattan School of Music',      contact:'Clara Sutton',    poc:'Michael Torres',  desc:'PM for historic building renovation and acoustic performance hall upgrade.',            notes:'Phased to avoid academic year disruption; donor-funded capital campaign.' },
  { title:'Hudson Yards Phase 3 Parking Structure',  id:'OPM-26-009', stage:'Interview',   chance:72,  sector:'Commercial',       cat:'Building',       value:5100000,  cost:3570000, labor:2550000, nonop:1020000, margin:1530000, contract:'GMP',       status:'Interview',   office:'Manhattan',     bidDue:'2026-07-25', interview:'2026-08-08', proposalDue:'2026-08-20', fStart:'2026-09-20', fEnd:'2027-10-31', award:'',           company:'Related Companies',              contact:'Eric Stone',      poc:'Lisa Adams',      desc:'OPM oversight for 1,200-space below-grade parking structure in Hudson Yards.',         notes:'Adjacent to active Amtrak corridor; vibration monitoring required.' },
  { title:'Williamsburg Waterfront Boutique Hotel',  id:'OPM-26-010', stage:'Prospect',    chance:40,  sector:'Hospitality',      cat:'Building',       value:7600000,  cost:5320000, labor:3800000, nonop:1520000, margin:2280000, contract:'Cost Plus', status:'Prospect',    office:'Brooklyn',      bidDue:'2026-10-01', interview:'',           proposalDue:'',           fStart:'2027-01-15', fEnd:'2028-12-31', award:'',           company:'Waterfront Hotels LLC',          contact:'Nina Park',       poc:'Jennifer Mills',  desc:'Owner rep for new 18-story boutique hotel on the East River waterfront.',              notes:'Zoning variance pending; community board input expected October 2026.' },
  { title:'LaGuardia Central Hall Fit-Out',          id:'OPM-26-011', stage:'Awarded',     chance:100, sector:'Aviation',         cat:'Infrastructure', value:4700000,  cost:3290000, labor:2350000, nonop:940000,  margin:1410000, contract:'Lump Sum',  status:'Active',      office:'Queens',        bidDue:'2026-04-20', interview:'2026-05-02', proposalDue:'2026-05-15', fStart:'2026-06-01', fEnd:'2027-05-31', award:'2026-05-25', company:'LaGuardia Gateway Partners',     contact:'Ivan Ruiz',       poc:'Michael Torres',  desc:'OPM for 350k SF terminal central hall interior fit-out and concession build-out.',     notes:'GC procurement complete; shop drawings under review.' },
  { title:'Newark Bay Seawall Restoration',          id:'OPM-26-012', stage:'Shortlisted', chance:68,  sector:'Environmental',    cat:'Infrastructure', value:3800000,  cost:2660000, labor:1900000, nonop:760000,  margin:1140000, contract:'Cost Plus', status:'Shortlisted', office:'New Jersey',    bidDue:'2026-08-25', interview:'2026-09-05', proposalDue:'2026-09-18', fStart:'2026-10-20', fEnd:'2027-11-30', award:'',           company:'Port Authority of NY/NJ',        contact:'Gary Lewis',      poc:'Lisa Adams',      desc:'PM for emergency seawall stabilization and tidal gate replacement at Newark Bay.',     notes:'USACE Section 404 permit submitted; NJDEP coordination required.' },
  { title:'Flushing Meadows Aquatics Center',        id:'OPM-26-013', stage:'Proposal',    chance:58,  sector:'Recreation',       cat:'Building',       value:6900000,  cost:4830000, labor:3450000, nonop:1380000, margin:2070000, contract:'GMP',       status:'Proposal',    office:'Queens',        bidDue:'2026-09-12', interview:'',           proposalDue:'2026-10-01', fStart:'2026-11-15', fEnd:'2028-05-31', award:'',           company:'NYC Parks',                      contact:'Sandra Kim',      poc:'Jennifer Mills',  desc:'New 50m Olympic aquatics facility and year-round community recreation center.',        notes:'Community board review scheduled; ULURP process anticipated.' },
  { title:'Prospect Park Concert Shell Rehab',       id:'OPM-26-014', stage:'Lost',        chance:0,   sector:'Recreation',       cat:'Building',       value:1900000,  cost:1330000, labor:950000,  nonop:380000,  margin:570000,  contract:'Lump Sum',  status:'Lost',        office:'Brooklyn',      bidDue:'2026-06-10', interview:'2026-06-20', proposalDue:'2026-07-01', fStart:'2026-09-01', fEnd:'2027-04-30', award:'2026-07-20', company:'Prospect Park Alliance',         contact:'Olivia Hart',     poc:'Michael Torres',  desc:'PM for rehabilitation of historic 1916 outdoor concert shell at Prospect Park.',       notes:'Awarded to competitor; fee differential was deciding factor.' },
  { title:'Bronx Zoo Wildlife Immersion Center',     id:'OPM-26-015', stage:'Interview',   chance:78,  sector:'Recreation',       cat:'Building',       value:4200000,  cost:2940000, labor:2100000, nonop:840000,  margin:1260000, contract:'GMP',       status:'Interview',   office:'Bronx',         bidDue:'2026-07-18', interview:'2026-08-01', proposalDue:'2026-08-14', fStart:'2026-09-15', fEnd:'2027-12-31', award:'',           company:'Wildlife Conservation Society',  contact:'Paul Warner',     poc:'Lisa Adams',      desc:'OPM for new 45k SF wildlife immersion center and naturalized habitat landscape.',      notes:'LEED Gold certification required; zoo remains open during construction.' },
  { title:'Rockaway Beach Resiliency Upgrades',      id:'OPM-26-016', stage:'Awarded',     chance:100, sector:'Environmental',    cat:'Infrastructure', value:5500000,  cost:3850000, labor:2750000, nonop:1100000, margin:1650000, contract:'Cost Plus', status:'Active',      office:'Queens',        bidDue:'2026-05-01', interview:'2026-05-14', proposalDue:'2026-05-28', fStart:'2026-07-01', fEnd:'2027-12-31', award:'2026-06-10', company:'NYC DDC',                        contact:'Diane Foster',    poc:'Jennifer Mills',  desc:'PM for FEMA-funded coastal resiliency, dune restoration and boardwalk rebuild.',       notes:'FEMA 75% reimbursable; HUD CDBG-DR funds cover remaining 25%.' },
  { title:'Upper West Side Luxury Residential',      id:'OPM-26-017', stage:'Proposal',    chance:62,  sector:'Residential',      cat:'Building',       value:7300000,  cost:5110000, labor:3650000, nonop:1460000, margin:2190000, contract:'Lump Sum',  status:'Proposal',    office:'Manhattan',     bidDue:'2026-09-18', interview:'',           proposalDue:'2026-10-08', fStart:'2026-11-01', fEnd:'2028-10-31', award:'',           company:'Steiner NYC',                    contact:'Mark Ellison',    poc:'Michael Torres',  desc:'Full OPM services for 38-story luxury residential tower on Upper West Side.',          notes:'Pre-construction design at 60%; GC pre-qual list being assembled.' },
  { title:'Mott Haven Library & Community Hub',      id:'OPM-26-018', stage:'Shortlisted', chance:73,  sector:'Civic/Government', cat:'Building',       value:2300000,  cost:1610000, labor:1150000, nonop:460000,  margin:690000,  contract:'GMP',       status:'Shortlisted', office:'Bronx',         bidDue:'2026-08-05', interview:'2026-08-18', proposalDue:'2026-08-30', fStart:'2026-10-01', fEnd:'2027-09-30', award:'',           company:'New York Public Library',        contact:'Grace Turner',    poc:'Lisa Adams',      desc:'PM for new branch library and community center co-location in Mott Haven.',            notes:'M/WBE goals 35%; SCA partnership under discussion.' },
  { title:"Randall's Island Sports Complex",         id:'OPM-26-019', stage:'Prospect',    chance:45,  sector:'Recreation',       cat:'Building',       value:8800000,  cost:6160000, labor:4400000, nonop:1760000, margin:2640000, contract:'Lump Sum',  status:'Prospect',    office:'Manhattan',     bidDue:'2026-11-01', interview:'',           proposalDue:'',           fStart:'2027-02-01', fEnd:'2029-06-30', award:'',           company:"Randalls Island Park Alliance",  contact:'Kevin Black',     poc:'Jennifer Mills',  desc:'OPM for multi-sport complex and enclosed year-round athletic facility.',               notes:'RFQ stage; full RFP expected Q4 2026; city capital commitment pending.' },
  { title:'Cross-Bronx Deck Park Phase 1',           id:'OPM-26-020', stage:'Awarded',     chance:100, sector:'Transportation',   cat:'Infrastructure', value:11200000, cost:7840000, labor:5600000, nonop:2240000, margin:3360000, contract:'Cost Plus', status:'Active',      office:'Bronx',         bidDue:'2026-04-10', interview:'2026-04-24', proposalDue:'2026-05-08', fStart:'2026-06-15', fEnd:'2029-03-31', award:'2026-05-28', company:'NYC DOT / Bronx Borough Pres.',  contact:'Rachel Gomez',    poc:'Michael Torres',  desc:'Owner representative for 1.1-mile cap-and-deck park over Cross-Bronx Expressway.',    notes:'EIS complete; 30% design submitted; community engagement ongoing.' },
];

const members = [
  { name:'Jennifer Mills',   email:'jmills@northbridge-cm.com',   role:'Project Executive',       title:'VP of Project Management',  bu:'Building Division', div:'OPM', dept:'Project Management', bill:285, labor:210, cost:175 },
  { name:'Michael Torres',   email:'mtorres@northbridge-cm.com',  role:'Project Manager',         title:'Senior Project Manager',    bu:'Building Division', div:'OPM', dept:'Project Management', bill:225, labor:165, cost:140 },
  { name:'Lisa Adams',       email:'ladams@northbridge-cm.com',   role:'Project Manager',         title:'Project Manager II',        bu:'Civil Division',    div:'OPM', dept:'Project Management', bill:210, labor:155, cost:130 },
  { name:'James Reilly',     email:'jreilly@northbridge-cm.com',  role:'Senior Cost Manager',     title:'Cost Manager',              bu:'Building Division', div:'OPM', dept:'Cost Management',    bill:195, labor:145, cost:120 },
  { name:'Carol Vance',      email:'cvance@northbridge-cm.com',   role:'Scheduler',               title:'Senior Planner',            bu:'Civil Division',    div:'OPM', dept:'Scheduling',         bill:180, labor:135, cost:110 },
  { name:'Robert Kim',       email:'rkim@northbridge-cm.com',     role:'Document Controller',     title:'Document Control Manager',  bu:'Building Division', div:'OPM', dept:'Document Control',   bill:145, labor:110, cost:90  },
  { name:'Patricia Cruz',    email:'pcruz@northbridge-cm.com',    role:'Senior Estimator',        title:'Senior Estimator',          bu:'Building Division', div:'OPM', dept:'Cost Management',    bill:190, labor:140, cost:115 },
  { name:'David Osei',       email:'dosei@northbridge-cm.com',    role:'Project Engineer',        title:'Project Engineer II',       bu:'Civil Division',    div:'OPM', dept:'Engineering',        bill:165, labor:125, cost:100 },
  { name:'Anna Petrov',      email:'apetrov@northbridge-cm.com',  role:'Contract Administrator',  title:'Contract Manager',          bu:'Building Division', div:'OPM', dept:'Contracts',          bill:175, labor:130, cost:105 },
  { name:'Carlos Mendez',    email:'cmendez@northbridge-cm.com',  role:'Field Inspector',         title:'Senior Inspector',          bu:'Civil Division',    div:'OPM', dept:'Field Operations',   bill:160, labor:120, cost:95  },
];

const buildPhases = ['Pre-Design & Planning','Schematic Design','Design Development','Construction Documents','Construction Administration'];
const infraPhases = ['Preliminary Engineering','30% Design','60% Design','90% Design','Construction Phase Services'];
const envPhases   = ['Environmental Assessment','Preliminary Design','Final Design','Permitting','Construction Support'];

function getPhases(opp) {
  if (opp.sector === 'Transportation' || opp.sector === 'Aviation') return infraPhases;
  if (opp.sector === 'Environmental') return envPhases;
  return buildPhases;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  const wsO = wb.addWorksheet('Opportunities');
  const wsT = wb.addWorksheet('Team Assignments');
  const wsS = wb.addWorksheet('Schedule');

  wsO.addRow(['Opportunity Title','Project Category','Company Name','Contact Name','ERP Job ID','Stage','Chance of Success','Market Sector','Business Unit','Division','Department','Bid Due Date','Interview Date','Proposal Phase Due','Forecast Start','Forecast End','Award / Loss Date','Approx Contract Value','Forecasted Project Cost','Labor Contract Amount','Non-Operating Cost','Gross Margin','Contract Type','Description','Notes','Point of Contact','Status','Office','Access Level']);
  wsT.addRow(['Project','Name','Email','Start Date','End Date','Total Hours','Type','Role','Job Title','Business Unit','Division','Department','Billing Rate','Labor Rate','Cost Rate','Actual Start','Actual End','Actual Hours','Billed Hours','Access Level']);
  wsS.addRow(['Project Title','Phase Name','Phase Order','Start Date','End Date','Duration (days)','Milestone','% Complete','Notes']);

  opps.forEach((opp, i) => {
    const fStart = parseD(opp.fStart);
    const fEnd   = parseD(opp.fEnd);

    wsO.addRow([
      opp.title, opp.cat, opp.company, opp.contact, opp.id,
      opp.stage, opp.chance + '%', opp.sector,
      'Pursuits', 'OPM Services', 'Project Management',
      opp.bidDue      ? fmtDate(parseD(opp.bidDue))      : '',
      opp.interview   ? fmtDate(parseD(opp.interview))   : '',
      opp.proposalDue ? fmtDate(parseD(opp.proposalDue)) : '',
      fmtDate(fStart), fmtDate(fEnd),
      opp.award       ? fmtDate(parseD(opp.award))       : '',
      opp.value, opp.cost, opp.labor, opp.nonop, opp.margin,
      opp.contract, opp.desc, opp.notes, opp.poc, opp.status, opp.office, 'editor'
    ]);

    const numM   = opp.value >= 7000000 ? 3 : 2;
    const base   = i % (members.length - numM + 1);
    const mSlice = members.slice(base, base + numM);
    const isLive = opp.stage === 'Awarded' || opp.status === 'Active';

    mSlice.forEach((m, mi) => {
      const mStart = addDays(fStart, mi * 14);
      const mEnd   = mi === 0 ? fEnd : addDays(fEnd, -30 * mi);
      const mSpan  = Math.max(1, Math.round((mEnd - mStart) / 86400000));
      const totalH = Math.round(mSpan * (mi === 0 ? 0.5 : 0.3));
      const actH   = isLive ? Math.round(totalH * 0.4) : 0;
      const bilH   = Math.round(actH * 0.95);
      wsT.addRow([
        opp.title, m.name, m.email,
        fmtDate(mStart), fmtDate(mEnd),
        totalH, mi === 0 ? 'Lead' : 'Support', m.role, m.title,
        m.bu, m.div, m.dept, m.bill, m.labor, m.cost,
        actH ? fmtDate(mStart)                                    : '',
        actH ? fmtDate(addDays(mStart, Math.floor(mSpan * 0.4))) : '',
        actH, bilH, 'editor'
      ]);
    });

    const phases    = getPhases(opp);
    const numP      = opp.value >= 8000000 ? 5 : 4;
    const usePhases = phases.slice(0, numP);
    const pDays     = Math.round(Math.round((fEnd - fStart) / 86400000) / numP);
    const isLost    = opp.stage === 'Lost';
    let cursor = new Date(fStart);

    usePhases.forEach((pname, pi) => {
      const pStart = new Date(cursor);
      const pEnd   = pi === numP - 1 ? new Date(fEnd) : addDays(cursor, pDays);
      const dur    = Math.max(1, Math.round((pEnd - pStart) / 86400000));
      const pct    = isLost ? 0 : isLive ? (pi === 0 ? 100 : pi === 1 ? 60 : pi === 2 ? 20 : 0) : 0;
      const mile   = (pi === 0 || pi === numP - 1) ? 'Yes' : 'No';
      wsS.addRow([opp.title, pname, pi + 1, fmtDate(pStart), fmtDate(pEnd), dur, mile, pct, '']);
      cursor = addDays(pEnd, 1);
    });
  });

  await wb.xlsx.writeFile('/home/runner/workspace/attached_assets/opportunities_template_20_filled.xlsx');
  console.log('Written OK');

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile('/home/runner/workspace/attached_assets/opportunities_template_20_filled.xlsx');
  for (const ws of wb2.worksheets) {
    let dr = 0;
    ws.eachRow((r, n) => { if (n > 1 && r.values.slice(1).filter(Boolean).length > 0) dr++; });
    console.log(ws.name + ': ' + dr + ' data rows');
  }
})().catch(e => { console.error(e.message, e.stack); process.exit(1); });
