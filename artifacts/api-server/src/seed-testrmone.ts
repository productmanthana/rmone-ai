/**
 * Seed comprehensive test data for the "testrmone" tenant.
 *
 * Creates:
 *   - 6 login users (CEO, CFO, COO, Resource Manager, Executive, PM)
 *     password for all: rmone@8723
 *   - 15 additional team members (no login required)
 *   - 30 PMM projects  (active, overdue, at-risk, completed, planning)
 *   - 30 OPM opportunities (proposal → negotiation spread)
 *   - 20 LEM leads
 *   - Team assignments with concentration risk, over-allocation, conflicts
 *   - 8 open demand positions (staffing gaps)
 *
 * Idempotent — every INSERT is guarded by an existence check.
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/seed-testrmone.ts
 */

import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { getPool, sql } from "./lib/db.js";
import { hashPassword } from "./lib/pipeline.js";
import {
  getUsersByTenant,
  insertUser,
  updateUser,
} from "@workspace/db";

// ── Tenant identity ───────────────────────────────────────────────────────────
const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const TENANT_LABEL     = "testrmone";
const TID              = uuidv5(TENANT_LABEL, TENANT_NAMESPACE);
const PW_HASH          = hashPassword("rmone@8723");

// ── Date helpers ──────────────────────────────────────────────────────────────
function daysFromNow(n: number): Date {
  const d = new Date(); d.setDate(d.getDate() + n); return d;
}

// ── 6 Login users ─────────────────────────────────────────────────────────────
const LOGIN_USERS: Array<{
  guid: string; username: string; name: string;
  title: string; role: string;
  isSiteAdmin: boolean; acl: "admin" | "manager";
}> = [
  { guid: uuidv4(), username: "ceo@testrmone.com",  name: "Alexandra Chen",  title: "Chief Executive Officer",  role: "CEO",              isSiteAdmin: true,  acl: "admin"   },
  { guid: uuidv4(), username: "cfo@testrmone.com",  name: "Robert Kumar",    title: "Chief Financial Officer",  role: "CFO",              isSiteAdmin: true,  acl: "admin"   },
  { guid: uuidv4(), username: "coo@testrmone.com",  name: "Sarah Mitchell",  title: "Chief Operating Officer",  role: "COO",              isSiteAdmin: true,  acl: "admin"   },
  { guid: uuidv4(), username: "rm@testrmone.com",   name: "David Torres",    title: "Resource Manager",         role: "Resource Manager", isSiteAdmin: false, acl: "manager" },
  { guid: uuidv4(), username: "exec@testrmone.com", name: "Jennifer Park",   title: "Executive Director",       role: "Executive",        isSiteAdmin: true,  acl: "admin"   },
  { guid: uuidv4(), username: "pm@testrmone.com",   name: "Marcus Johnson",  title: "Senior Project Manager",   role: "Project Manager",  isSiteAdmin: false, acl: "manager" },
];

// ── 15 Team members (staff visible in team/resource views, no login needed) ──
const TEAM_MEMBERS: Array<{ guid: string; username: string; name: string; title: string }> = [
  { guid: uuidv4(), username: "alex.rivera@testrmone.com",  name: "Alex Rivera",  title: "Project Manager"        },
  { guid: uuidv4(), username: "priya.nair@testrmone.com",   name: "Priya Nair",   title: "Structural Engineer"    },
  { guid: uuidv4(), username: "james.okafor@testrmone.com", name: "James Okafor", title: "Senior Architect"       },
  { guid: uuidv4(), username: "sarah.bloom@testrmone.com",  name: "Sarah Bloom",  title: "Civil Engineer"         },
  { guid: uuidv4(), username: "mike.santos@testrmone.com",  name: "Mike Santos",  title: "MEP Engineer"           },
  { guid: uuidv4(), username: "lisa.chang@testrmone.com",   name: "Lisa Chang",   title: "Environmental Engineer" },
  { guid: uuidv4(), username: "tom.walsh@testrmone.com",    name: "Tom Walsh",    title: "Construction Manager"   },
  { guid: uuidv4(), username: "aisha.patel@testrmone.com",  name: "Aisha Patel",  title: "Cost Estimator"         },
  { guid: uuidv4(), username: "carlos.wu@testrmone.com",    name: "Carlos Wu",    title: "Project Engineer"       },
  { guid: uuidv4(), username: "nina.berg@testrmone.com",    name: "Nina Berg",    title: "Senior Engineer"        },
  { guid: uuidv4(), username: "raj.desai@testrmone.com",    name: "Raj Desai",    title: "Architect"              },
  { guid: uuidv4(), username: "emma.cox@testrmone.com",     name: "Emma Cox",     title: "Project Manager"        },
  // Bench — intentionally NO allocation rows → drives bench/under-util signals
  { guid: uuidv4(), username: "david.lee@testrmone.com",    name: "David Lee",    title: "Mechanical Engineer"    },
  { guid: uuidv4(), username: "fiona.west@testrmone.com",   name: "Fiona West",   title: "Urban Planner"          },
  { guid: uuidv4(), username: "omar.hassan@testrmone.com",  name: "Omar Hassan",  title: "Geotechnical Engineer"  },
];

// ── 30 PMM Projects ───────────────────────────────────────────────────────────
// Spread across active/healthy, overdue, due-soon, completed, planning to drive
// ALL role-home metrics: delivery risk, revenue at risk, schedule signals, bench.
const PROJECTS: Array<{
  ticket: string; title: string; cv: number; lca: number;
  status: string; pct: number; startOffset: number; endOffset: number;
  bu: string; sector: string;
}> = [
  // ── Active / healthy (12) ──────────────────────────────────────────────────
  { ticket:"PMM-26-001", title:"Midtown East Tower Complex",          cv:12_500_000, lca:8_100_000,  status:"In Progress",               pct:58, startOffset:-200, endOffset:140, bu:"Buildings",      sector:"Commercial"    },
  { ticket:"PMM-26-002", title:"Brooklyn Waterfront Promenade",       cv: 4_800_000, lca:3_100_000,  status:"Under Construction",         pct:71, startOffset:-180, endOffset:60,  bu:"Infrastructure", sector:"Public"        },
  { ticket:"PMM-26-003", title:"JFK Terminal 9 Expansion",            cv:18_200_000, lca:11_500_000, status:"In Progress",               pct:44, startOffset:-120, endOffset:240, bu:"Aviation",       sector:"Transportation"},
  { ticket:"PMM-26-004", title:"Hudson Yards Phase III",              cv: 9_300_000, lca:6_000_000,  status:"Construction Documents",    pct:22, startOffset:-45,  endOffset:310, bu:"Buildings",      sector:"Mixed-Use"     },
  { ticket:"PMM-26-005", title:"Queens BRT Corridor Extension",       cv: 6_400_000, lca:4_200_000,  status:"Construction Administration",pct:83, startOffset:-300, endOffset:30,  bu:"Transportation", sector:"Transit"       },
  { ticket:"PMM-26-006", title:"Newark Medical Center Addition",      cv: 7_900_000, lca:5_100_000,  status:"In Progress",               pct:37, startOffset:-90,  endOffset:180, bu:"Healthcare",     sector:"Healthcare"    },
  { ticket:"PMM-26-007", title:"Harlem Affordable Housing Block A",   cv: 3_200_000, lca:2_050_000,  status:"In Progress",               pct:65, startOffset:-210, endOffset:90,  bu:"Residential",    sector:"Housing"       },
  { ticket:"PMM-26-008", title:"Staten Island Ferry Terminal Upgrade",cv: 2_750_000, lca:1_800_000,  status:"Pre-Construction",          pct:12, startOffset:-20,  endOffset:360, bu:"Transportation", sector:"Marine"        },
  { ticket:"PMM-26-009", title:"Columbia University Science Hub",     cv: 5_600_000, lca:3_600_000,  status:"In Progress",               pct:51, startOffset:-150, endOffset:150, bu:"Education",      sector:"Academic"      },
  { ticket:"PMM-26-010", title:"Bronx River Greenway Phase 4",        cv: 1_850_000, lca:1_200_000,  status:"In Progress",               pct:77, startOffset:-280, endOffset:40,  bu:"Parks",          sector:"Parks"         },
  { ticket:"PMM-26-011", title:"Long Island Solar Farm Substation",   cv: 3_400_000, lca:2_200_000,  status:"Pre-Construction",          pct:8,  startOffset:-10,  endOffset:400, bu:"Energy",         sector:"Energy"        },
  { ticket:"PMM-26-012", title:"Westchester Highway Rehabilitation",  cv: 4_100_000, lca:2_700_000,  status:"In Progress",               pct:60, startOffset:-160, endOffset:100, bu:"Transportation", sector:"Transportation"},
  // ── Overdue — past target end, pct < 100% → PM/COO CRITICAL signals (6) ──
  { ticket:"PMM-26-013", title:"Castle Hill Affordable Housing",      cv: 2_100_000, lca:1_350_000,  status:"In Progress",               pct:68, startOffset:-400, endOffset:-30, bu:"Residential",    sector:"Housing"       },
  { ticket:"PMM-26-014", title:"Phoenix Plaza Retail Renovation",     cv: 1_050_000, lca:  680_000,  status:"In Progress",               pct:54, startOffset:-250, endOffset:-15, bu:"Commercial",     sector:"Retail"        },
  { ticket:"PMM-26-015", title:"East Harlem Community Center",        cv: 1_600_000, lca:1_040_000,  status:"In Progress",               pct:88, startOffset:-380, endOffset:-10, bu:"Community",      sector:"Public"        },
  { ticket:"PMM-26-016", title:"Upper West Side Library Expansion",   cv:   920_000, lca:  600_000,  status:"In Progress",               pct:72, startOffset:-300, endOffset:-20, bu:"Education",      sector:"Academic"      },
  { ticket:"PMM-26-017", title:"Flushing Meadow Pavilion Rebuild",    cv: 1_400_000, lca:  910_000,  status:"In Progress",               pct:45, startOffset:-350, endOffset:-5,  bu:"Parks",          sector:"Parks"         },
  { ticket:"PMM-26-018", title:"Port Richmond Waterfront Access",     cv: 2_300_000, lca:1_500_000,  status:"In Progress",               pct:62, startOffset:-420, endOffset:-40, bu:"Infrastructure", sector:"Marine"        },
  // ── Due soon — within 30 days → PM WARNING signals (4) ───────────────────
  { ticket:"PMM-26-019", title:"Grand Central South Lobby Retrofit",  cv: 3_700_000, lca:2_400_000,  status:"Construction Administration",pct:94, startOffset:-200, endOffset:14,  bu:"Buildings",      sector:"Commercial"    },
  { ticket:"PMM-26-020", title:"East New York Transit Hub",           cv: 2_600_000, lca:1_700_000,  status:"In Progress",               pct:87, startOffset:-180, endOffset:22,  bu:"Transportation", sector:"Transit"       },
  { ticket:"PMM-26-021", title:"Pelham Bay Elementary School",        cv: 1_800_000, lca:1_150_000,  status:"In Progress",               pct:91, startOffset:-250, endOffset:18,  bu:"Education",      sector:"Academic"      },
  { ticket:"PMM-26-022", title:"South Beach Boardwalk Restoration",   cv: 1_250_000, lca:  810_000,  status:"Construction Administration",pct:96, startOffset:-190, endOffset:8,   bu:"Parks",          sector:"Recreation"    },
  // ── Completed (4) ─────────────────────────────────────────────────────────
  { ticket:"PMM-26-023", title:"Manhattan Bridge Approach Repairs",   cv: 5_100_000, lca:3_300_000,  status:"Closed",                    pct:100,startOffset:-500, endOffset:-90, bu:"Infrastructure", sector:"Transportation"},
  { ticket:"PMM-26-024", title:"Riverdale Senior Center",             cv:   880_000, lca:  570_000,  status:"Closed",                    pct:100,startOffset:-450, endOffset:-120,bu:"Community",      sector:"Public"        },
  { ticket:"PMM-26-025", title:"Alphabet City Park Renovation",       cv:   650_000, lca:  420_000,  status:"Closed",                    pct:100,startOffset:-360, endOffset:-150,bu:"Parks",          sector:"Parks"         },
  { ticket:"PMM-26-026", title:"Elmhurst Hospital ER Expansion",      cv: 8_400_000, lca:5_400_000,  status:"Closed",                    pct:100,startOffset:-600, endOffset:-180,bu:"Healthcare",     sector:"Healthcare"    },
  // ── Planning / pre-construction (4) ───────────────────────────────────────
  { ticket:"PMM-26-027", title:"Greenpoint Industrial Conversion",    cv: 4_500_000, lca:2_900_000,  status:"Schematic Design",          pct:5,  startOffset:0,    endOffset:500, bu:"Industrial",     sector:"Industrial"    },
  { ticket:"PMM-26-028", title:"Red Hook Container Terminal Study",   cv: 2_800_000, lca:1_800_000,  status:"Pre-Design",                pct:2,  startOffset:15,   endOffset:420, bu:"Industrial",     sector:"Marine"        },
  { ticket:"PMM-26-029", title:"Astoria High School New Building",    cv: 7_200_000, lca:4_600_000,  status:"Design Development",        pct:18, startOffset:-30,  endOffset:480, bu:"Education",      sector:"Academic"      },
  { ticket:"PMM-26-030", title:"Throggs Neck Bridge Rehabilitation",  cv:11_000_000, lca:7_100_000,  status:"Pre-Construction",          pct:10, startOffset:-15,  endOffset:540, bu:"Infrastructure", sector:"Transportation"},
];

// ── 30 OPM Opportunities ──────────────────────────────────────────────────────
const OPPORTUNITIES: Array<{
  ticket: string; title: string; cv: number;
  stage: string; chance: number; closeOffset: number;
}> = [
  { ticket:"OPM-26-001", title:"Bronx Sports Arena Feasibility",          cv: 5_200_000, stage:"Proposal",    chance:45, closeOffset:18  },
  { ticket:"OPM-26-002", title:"LI Rail Platform Capacity Study",         cv: 2_400_000, stage:"Shortlisted", chance:68, closeOffset:32  },
  { ticket:"OPM-26-003", title:"Westchester Road Network Upgrade",        cv: 3_800_000, stage:"Negotiation", chance:82, closeOffset:12  },
  { ticket:"OPM-26-004", title:"Port Authority Cargo Expansion",          cv: 7_100_000, stage:"Proposal",    chance:35, closeOffset:55  },
  { ticket:"OPM-26-005", title:"Brooklyn Navy Yard Tech Hub Phase 2",     cv: 2_900_000, stage:"Shortlisted", chance:72, closeOffset:44  },
  { ticket:"OPM-26-006", title:"Manhattan East Side Flood Barrier",       cv: 9_500_000, stage:"Proposal",    chance:40, closeOffset:75  },
  { ticket:"OPM-26-007", title:"Coney Island Amusement District Plan",    cv: 1_800_000, stage:"Negotiation", chance:78, closeOffset:22  },
  { ticket:"OPM-26-008", title:"Bronx River Greenway Phase 5 Design",     cv: 1_100_000, stage:"Proposal",    chance:55, closeOffset:38  },
  { ticket:"OPM-26-009", title:"Hudson Valley Freight Rail Upgrade",      cv:14_200_000, stage:"Shortlisted", chance:60, closeOffset:65  },
  { ticket:"OPM-26-010", title:"Newark Airport Terminal C Expansion",     cv:22_000_000, stage:"Proposal",    chance:30, closeOffset:90  },
  { ticket:"OPM-26-011", title:"Queens Boulevard Complete Streets",       cv: 3_300_000, stage:"Shortlisted", chance:65, closeOffset:28  },
  { ticket:"OPM-26-012", title:"Staten Island North Shore Rail Link",     cv: 8_700_000, stage:"Negotiation", chance:75, closeOffset:15  },
  { ticket:"OPM-26-013", title:"Rockland County Campus Masterplan",       cv: 1_600_000, stage:"Proposal",    chance:42, closeOffset:48  },
  { ticket:"OPM-26-014", title:"JFK AirTrain Extension Study",            cv: 4_500_000, stage:"Shortlisted", chance:55, closeOffset:70  },
  { ticket:"OPM-26-015", title:"Williamsburg Industrial Remediation",     cv: 2_700_000, stage:"Proposal",    chance:38, closeOffset:85  },
  { ticket:"OPM-26-016", title:"Rikers Island Transition Infrastructure", cv: 6_400_000, stage:"Negotiation", chance:88, closeOffset:10  },
  { ticket:"OPM-26-017", title:"Hunts Point Food Distribution Center",    cv: 3_900_000, stage:"Shortlisted", chance:62, closeOffset:35  },
  { ticket:"OPM-26-018", title:"Calverton Enterprise Park Development",   cv: 5_100_000, stage:"Proposal",    chance:48, closeOffset:60  },
  { ticket:"OPM-26-019", title:"Governors Island Climate Hub",            cv: 2_200_000, stage:"Shortlisted", chance:70, closeOffset:25  },
  { ticket:"OPM-26-020", title:"Jamaica Downtown Rezoning Study",         cv: 1_400_000, stage:"Proposal",    chance:52, closeOffset:42  },
  { ticket:"OPM-26-021", title:"Cross Bronx Expressway Deck Park",        cv:11_500_000, stage:"Negotiation", chance:85, closeOffset:8   },
  { ticket:"OPM-26-022", title:"Roosevelt Island North Park Design",      cv: 1_200_000, stage:"Shortlisted", chance:67, closeOffset:30  },
  { ticket:"OPM-26-023", title:"Gowanus Canal Promenade",                 cv: 2_600_000, stage:"Proposal",    chance:44, closeOffset:52  },
  { ticket:"OPM-26-024", title:"MTA Bus Depot Electrification – Brooklyn",cv: 4_300_000, stage:"Shortlisted", chance:73, closeOffset:20  },
  { ticket:"OPM-26-025", title:"Fresh Kills Landfill Park Phase III",     cv: 3_700_000, stage:"Proposal",    chance:40, closeOffset:78  },
  { ticket:"OPM-26-026", title:"New Rochelle Waterfront Mixed Use",       cv: 6_800_000, stage:"Negotiation", chance:80, closeOffset:6   },
  { ticket:"OPM-26-027", title:"Hunts Point Resilience Master Plan",      cv: 2_100_000, stage:"Proposal",    chance:58, closeOffset:47  },
  { ticket:"OPM-26-028", title:"Brooklyn Bridge Park Pier 6 Expansion",   cv:   900_000, stage:"Shortlisted", chance:76, closeOffset:16  },
  { ticket:"OPM-26-029", title:"Metro North New Haven Line Upgrade",      cv:18_000_000, stage:"Proposal",    chance:25, closeOffset:110 },
  { ticket:"OPM-26-030", title:"BQX Streetcar Environmental Review",      cv: 7_500_000, stage:"Negotiation", chance:88, closeOffset:4   },
];

// ── 20 LEM Leads ──────────────────────────────────────────────────────────────
const LEADS: Array<{
  ticket: string; title: string; cv: string;
  status: string; sector: string;
}> = [
  { ticket:"LEM-26-001", title:"Park Slope Mixed-Use Tower Study",    cv:"3200000",  status:"Active",    sector:"Mixed-Use"      },
  { ticket:"LEM-26-002", title:"Flushing River Waterfront Concept",   cv:"5800000",  status:"Active",    sector:"Parks"          },
  { ticket:"LEM-26-003", title:"South Bronx Industrial Corridor Plan",cv:"2400000",  status:"Qualified", sector:"Industrial"     },
  { ticket:"LEM-26-004", title:"Rockaway Beach Resort Complex",       cv:"7100000",  status:"Active",    sector:"Recreation"     },
  { ticket:"LEM-26-005", title:"Manhattan West Podium Retrofit",      cv:"4600000",  status:"Qualified", sector:"Commercial"     },
  { ticket:"LEM-26-006", title:"Throgs Neck Affordable Housing Block",cv:"2900000",  status:"New",       sector:"Housing"        },
  { ticket:"LEM-26-007", title:"North Shore Greenway Concept",        cv:"1500000",  status:"Qualified", sector:"Parks"          },
  { ticket:"LEM-26-008", title:"Brooklyn Heights Contextual Rezone",  cv:"3800000",  status:"Active",    sector:"Mixed-Use"      },
  { ticket:"LEM-26-009", title:"Jamaica Bay Wildlife Center Study",   cv:"1100000",  status:"New",       sector:"Parks"          },
  { ticket:"LEM-26-010", title:"Maspeth Industrial Campus Master Plan",cv:"6300000", status:"Qualified", sector:"Industrial"     },
  { ticket:"LEM-26-011", title:"Morris Heights Community Hub Concept",cv:"1800000",  status:"Active",    sector:"Public"         },
  { ticket:"LEM-26-012", title:"Greenpoint Waterfront Park Phase 2",  cv:"2100000",  status:"New",       sector:"Parks"          },
  { ticket:"LEM-26-013", title:"LaGuardia Airport Ground Transport",  cv:"9400000",  status:"Qualified", sector:"Transportation" },
  { ticket:"LEM-26-014", title:"Spring Creek Towers Renovation Study",cv:"4200000",  status:"Active",    sector:"Housing"        },
  { ticket:"LEM-26-015", title:"Crotona Park Visitor Center Concept", cv:"750000",   status:"New",       sector:"Parks"          },
  { ticket:"LEM-26-016", title:"Red Hook Resilience Infrastructure",  cv:"6900000",  status:"Qualified", sector:"Infrastructure" },
  { ticket:"LEM-26-017", title:"Van Cortlandt Park Athletic Complex", cv:"2700000",  status:"Active",    sector:"Recreation"     },
  { ticket:"LEM-26-018", title:"Downtown Brooklyn Height Study",      cv:"1400000",  status:"New",       sector:"Commercial"     },
  { ticket:"LEM-26-019", title:"Bay Ridge Esplanade Extension Concept",cv:"3500000", status:"Qualified", sector:"Parks"          },
  { ticket:"LEM-26-020", title:"Willets Point Mixed-Use Phase B",     cv:"12000000", status:"Active",    sector:"Mixed-Use"      },
];

// ── Allocations ───────────────────────────────────────────────────────────────
// ti = index into TEAM_MEMBERS array.  Hours / weeks drive PctAllocation.
// Designed for:
//   Concentration risk: Alex Rivera (ti:0) on 8 projects
//   Over-allocation:    Alex (ti:0) ~130%, Priya (ti:1) ~110%
//   Team conflict:      Emma Cox (ti:11) PM on 2 overdue + 1 due-soon project
//   Bench:              David Lee (ti:12), Fiona West (ti:13), Omar (ti:14)
const ALLOCATIONS: Array<{ ti: number; ticket: string; hours: number; weeks: number }> = [
  // Alex Rivera (0) — concentration risk across 8 records
  { ti:0,  ticket:"PMM-26-001", hours:1800, weeks:50 },   // 90%
  { ti:0,  ticket:"PMM-26-002", hours: 800, weeks:50 },   // 40%  → ~130% total
  { ti:0,  ticket:"PMM-26-003", hours: 600, weeks:40 },   // concurrent overload
  { ti:0,  ticket:"PMM-26-013", hours: 400, weeks:30 },   // overdue project
  { ti:0,  ticket:"PMM-26-014", hours: 300, weeks:25 },   // overdue project
  { ti:0,  ticket:"PMM-26-019", hours: 200, weeks:10 },   // due soon
  { ti:0,  ticket:"PMM-26-020", hours: 150, weeks: 8 },   // due soon
  { ti:0,  ticket:"OPM-26-009", hours: 250, weeks:20 },   // opp allocation
  // Priya Nair (1) — over-allocated ~110%
  { ti:1,  ticket:"PMM-26-001", hours:1200, weeks:30 },   // 100%
  { ti:1,  ticket:"PMM-26-004", hours: 400, weeks:25 },   // +10% → over
  { ti:1,  ticket:"PMM-26-006", hours:1400, weeks:50 },
  { ti:1,  ticket:"PMM-26-030", hours: 800, weeks:40 },
  // James Okafor (2)
  { ti:2,  ticket:"PMM-26-003", hours:1600, weeks:50 },
  { ti:2,  ticket:"PMM-26-009", hours: 900, weeks:40 },
  { ti:2,  ticket:"PMM-26-027", hours: 600, weeks:30 },
  // Sarah Bloom (3)
  { ti:3,  ticket:"PMM-26-005", hours:1800, weeks:50 },
  { ti:3,  ticket:"PMM-26-010", hours: 600, weeks:25 },
  { ti:3,  ticket:"PMM-26-012", hours:1000, weeks:40 },
  // Mike Santos (4)
  { ti:4,  ticket:"PMM-26-006", hours:1600, weeks:50 },
  { ti:4,  ticket:"PMM-26-007", hours: 800, weeks:30 },
  { ti:4,  ticket:"PMM-26-016", hours: 500, weeks:30 },   // overdue
  // Lisa Chang (5)
  { ti:5,  ticket:"PMM-26-009", hours:1400, weeks:50 },
  { ti:5,  ticket:"PMM-26-011", hours: 600, weeks:30 },
  { ti:5,  ticket:"PMM-26-018", hours: 900, weeks:40 },   // overdue
  // Tom Walsh (6)
  { ti:6,  ticket:"PMM-26-002", hours:1600, weeks:50 },
  { ti:6,  ticket:"PMM-26-013", hours: 800, weeks:35 },   // overdue
  { ti:6,  ticket:"PMM-26-015", hours: 600, weeks:30 },   // overdue
  // Aisha Patel (7)
  { ti:7,  ticket:"PMM-26-004", hours:1800, weeks:50 },
  { ti:7,  ticket:"PMM-26-029", hours: 700, weeks:35 },
  // Carlos Wu (8)
  { ti:8,  ticket:"PMM-26-007", hours:1400, weeks:50 },
  { ti:8,  ticket:"PMM-26-008", hours: 400, weeks:20 },
  { ti:8,  ticket:"PMM-26-017", hours: 600, weeks:30 },   // overdue
  // Nina Berg (9)
  { ti:9,  ticket:"PMM-26-003", hours:1200, weeks:40 },
  { ti:9,  ticket:"PMM-26-021", hours: 600, weeks:20 },   // due soon
  { ti:9,  ticket:"PMM-26-022", hours: 400, weeks:15 },   // due soon
  // Raj Desai (10)
  { ti:10, ticket:"PMM-26-004", hours:1600, weeks:50 },
  { ti:10, ticket:"PMM-26-028", hours: 500, weeks:25 },
  // Emma Cox (11) — PM on 2 overdue + 1 due-soon = team conflict signal
  { ti:11, ticket:"PMM-26-013", hours:1200, weeks:40 },   // overdue
  { ti:11, ticket:"PMM-26-015", hours: 800, weeks:30 },   // overdue
  { ti:11, ticket:"PMM-26-019", hours: 600, weeks:20 },   // due soon
  // David Lee (12), Fiona West (13), Omar Hassan (14) → bench (no rows)
];

// ── Open Demands (unassigned positions → staffing gap / demand signals) ───────
const DEMANDS: Array<{
  ticket: string; role: string; pct: number;
  startOffset: number; endOffset: number;
}> = [
  { ticket:"PMM-26-003", role:"Senior MEP Engineer",    pct:100, startOffset:0,  endOffset:120 },
  { ticket:"PMM-26-006", role:"Structural Engineer",    pct:100, startOffset:10, endOffset:90  },
  { ticket:"PMM-26-007", role:"Cost Estimator",         pct: 80, startOffset:0,  endOffset:60  },
  { ticket:"PMM-26-011", role:"Electrical Engineer",    pct:100, startOffset:15, endOffset:120 },
  { ticket:"PMM-26-030", role:"Bridge Engineer",        pct:100, startOffset:20, endOffset:180 },
  { ticket:"OPM-26-009", role:"Project Manager",        pct:100, startOffset:30, endOffset:150 },
  { ticket:"OPM-26-021", role:"Senior Civil Engineer",  pct:100, startOffset:5,  endOffset:90  },
  { ticket:"PMM-26-018", role:"Environmental Engineer", pct: 80, startOffset:0,  endOffset:75  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function rowExists(
  pool: sql.ConnectionPool,
  table: string,
  conditions: Record<string, string | number | null>,
): Promise<boolean> {
  let req = pool.request().input("tid", sql.NVarChar, TID);
  const clauses: string[] = ["TenantID=@tid"];
  let i = 0;
  for (const [col, val] of Object.entries(conditions)) {
    if (val === null) {
      clauses.push(`${col} IS NULL`);
    } else {
      req = req.input(`v${i}`, sql.NVarChar, String(val));
      clauses.push(`${col}=@v${i}`);
      i++;
    }
  }
  const r = await req.query(
    `SELECT COUNT(*) AS cnt FROM core2.dbo.${table} WHERE ${clauses.join(" AND ")}`,
  );
  return (r.recordset[0]?.cnt ?? 0) > 0;
}

async function hasColumn(pool: sql.ConnectionPool, table: string, col: string): Promise<boolean> {
  const r = await pool.request()
    .input("t", sql.NVarChar, table)
    .input("c", sql.NVarChar, col)
    .query(`SELECT COUNT(*) AS cnt FROM core2.INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME=@t AND COLUMN_NAME=@c`);
  return (r.recordset[0]?.cnt ?? 0) > 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  Seeding tenant: ${TENANT_LABEL}`);
  console.log(`║  TID: ${TID}`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  const pool = await getPool();

  // Connectivity check
  try {
    await pool.request().query("SELECT TOP 1 TicketId FROM core2.dbo.PMM");
    console.log("✓ core2 reachable\n");
  } catch (e: any) {
    console.error("✗ Cannot reach core2:", e.message); process.exit(1);
  }

  // Probe optional columns once
  const hasPct      = await hasColumn(pool, "PMM",         "PctComplete");
  const hasCrmStat  = await hasColumn(pool, "PMM",         "CRMProjectStatusChoice");
  const hasBU       = await hasColumn(pool, "PMM",         "CRMBusinessUnitChoice");
  const hasSector   = await hasColumn(pool, "PMM",         "SectorChoice");
  const hasOpmCrm   = await hasColumn(pool, "Opportunity", "CRMOpportunityStatusChoice");
  const hasOppBU    = await hasColumn(pool, "Opportunity", "CRMBusinessUnitChoice");
  const hasLeadCV   = await hasColumn(pool, "Lead",        "ApproxContractValue");
  const hasLeadCVnv = await hasColumn(pool, "Lead",        "ContractValue");
  const hasLeadStat = await hasColumn(pool, "Lead",        "LeadStatus");
  const hasLeadSec  = await hasColumn(pool, "Lead",        "MarketSector");
  const hasLeadIsL  = await hasColumn(pool, "Lead",        "IsLead");
  const hasTitle    = await hasColumn(pool, "AspNetUsers", "Title");
  const hasPwHash   = await hasColumn(pool, "AspNetUsers", "PasswordHash");
  const hasEnabled  = await hasColumn(pool, "AspNetUsers", "Enabled");
  const hasIsSA     = await hasColumn(pool, "AspNetUsers", "IsSiteAdmin");

  // ── 1. Postgres login users ──────────────────────────────────────────────────
  console.log("── 1/8  Postgres login users (6)…");
  let pgNew = 0;
  const pgTenantUsers = await getUsersByTenant(TID).catch(() => []);
  for (const u of LOGIN_USERS) {
    const existing = pgTenantUsers.find(r => r.username === u.username.toLowerCase());
    if (existing) {
      // Ensure password and access level are set correctly
      await updateUser(TID, existing.id, {
        passwordHash: PW_HASH,
        isSiteAdmin: u.isSiteAdmin,
        accessLevel: u.acl,
        enabled: true,
        deleted: false,
        name: u.name,
      }).catch(e => console.warn(`  [pg] update ${u.username}: ${e.message}`));
      u.guid = existing.id;  // reuse existing GUID for MSSQL FK consistency
      console.log(`  ↺ updated ${u.username}`);
    } else {
      await insertUser({
        id:           u.guid,
        tenantId:     TID,
        username:     u.username.toLowerCase(),
        name:         u.name,
        email:        u.username,
        passwordHash: PW_HASH,
        isSiteAdmin:  u.isSiteAdmin,
        accessLevel:  u.acl,
        isManager:    false,
        enabled:      true,
        deleted:      false,
      }).catch(e => console.warn(`  [pg] insert ${u.username}: ${e.message}`));
      pgNew++;
      console.log(`  + inserted ${u.username}`);
    }
  }
  console.log(`     Postgres users: ${pgNew} new, ${LOGIN_USERS.length - pgNew} updated\n`);

  // ── 2. MSSQL AspNetUsers (all 21 users for FK integrity) ────────────────────
  // IMPORTANT: We sync GUIDs back onto the original LOGIN_USERS / TEAM_MEMBERS
  // arrays so that later steps (allocations) always use the DB-authoritative GUID,
  // not the freshly-generated uuidv4() that differs on every run.
  console.log("── 2/8  MSSQL AspNetUsers (21 users for FK integrity)…");

  // Pre-load existing GUIDs for this tenant in one query
  const existingUsersRow = await pool.request()
    .input("tid", sql.NVarChar, TID)
    .query("SELECT Id, UserName FROM core2.dbo.AspNetUsers WHERE TenantID=@tid");
  const dbGuidByUsername = new Map<string, string>(
    existingUsersRow.recordset.map((r: { Id: string; UserName: string }) => [r.UserName.toLowerCase(), r.Id])
  );

  // Sync GUIDs onto originals BEFORE building allUsers so every downstream
  // reference (TEAM_MEMBERS[i].guid, LOGIN_USERS[i].guid) is DB-correct.
  for (const u of LOGIN_USERS) {
    const dbGuid = dbGuidByUsername.get(u.username.toLowerCase());
    if (dbGuid) u.guid = dbGuid;
  }
  for (const u of TEAM_MEMBERS) {
    const dbGuid = dbGuidByUsername.get(u.username.toLowerCase());
    if (dbGuid) u.guid = dbGuid;
  }

  // Build the insert list — only users not yet in the DB
  const allUsers = [
    ...LOGIN_USERS.map(u => ({ guid: u.guid, username: u.username, name: u.name, title: u.title, withPw: true,  isSiteAdmin: u.isSiteAdmin })),
    ...TEAM_MEMBERS.map(u => ({ guid: u.guid, username: u.username, name: u.name, title: u.title, withPw: false, isSiteAdmin: false })),
  ];
  let mssqlNew = 0;
  for (const u of allUsers) {
    if (dbGuidByUsername.has(u.username.toLowerCase())) continue; // already exists

    let req = pool.request()
      .input("id",    sql.NVarChar, u.guid)
      .input("tid",   sql.NVarChar, TID)
      .input("uname", sql.NVarChar, u.username)
      .input("name",  sql.NVarChar, u.name)
      .input("email", sql.NVarChar, u.username)
      .input("desig", sql.NVarChar, u.title);

    let extraCols = ""; let extraVals = "";
    if (hasTitle) {
      req = req.input("title", sql.NVarChar, u.title);
      extraCols += ", Title"; extraVals += ", @title";
    }
    if (hasPwHash && u.withPw) {
      req = req.input("pw", sql.NVarChar, PW_HASH);
      extraCols += ", PasswordHash"; extraVals += ", @pw";
    }
    if (hasEnabled) {
      extraCols += ", Enabled"; extraVals += ", 1";
    }
    if (hasIsSA && u.isSiteAdmin) {
      extraCols += ", IsSiteAdmin"; extraVals += ", 1";
    }

    await req.query(`INSERT INTO core2.dbo.AspNetUsers
      (Id, TenantID, UserName, Name, Email, Designation,
       EmailConfirmed, PhoneNumberConfirmed, TwoFactorEnabled,
       LockoutEnabled, AccessFailedCount, Deleted${extraCols})
      VALUES (@id, @tid, @uname, @name, @email, @desig,
              0, 0, 0, 0, 0, 0${extraVals})`);
    mssqlNew++;
  }
  console.log(`     AspNetUsers: ${mssqlNew} inserted, ${allUsers.length - mssqlNew} already existed\n`);

  // ── 3. PMM Projects ──────────────────────────────────────────────────────────
  console.log("── 3/8  PMM Projects (30)…");
  let pmmNew = 0;
  for (const p of PROJECTS) {
    if (await rowExists(pool, "PMM", { TicketId: p.ticket })) continue;
    let req = pool.request()
      .input("tid",   sql.NVarChar, TID)
      .input("tick",  sql.NVarChar, p.ticket)
      .input("title", sql.NVarChar, p.title)
      .input("cv",    sql.Float,    p.cv)
      .input("lca",   sql.Float,    p.lca)
      .input("stat",  sql.NVarChar, p.status)
      .input("start", sql.DateTime, daysFromNow(p.startOffset))
      .input("end",   sql.DateTime, daysFromNow(p.endOffset));

    let extraCols = ""; let extraVals = "";
    if (hasPct)     { req = req.input("pct",  sql.Float,    p.pct);    extraCols += ", PctComplete";             extraVals += ", @pct";  }
    if (hasCrmStat) { req = req.input("crms", sql.NVarChar, p.status); extraCols += ", CRMProjectStatusChoice"; extraVals += ", @crms"; }
    if (hasBU)      { req = req.input("bu",   sql.NVarChar, p.bu);     extraCols += ", CRMBusinessUnitChoice";  extraVals += ", @bu";   }
    if (hasSector)  { req = req.input("sec",  sql.NVarChar, p.sector); extraCols += ", SectorChoice";           extraVals += ", @sec";  }

    const closed = (p.status === "Closed") ? 1 : 0;
    await req.query(`INSERT INTO core2.dbo.PMM
      (TenantID, TicketId, Title, ApproxContractValue, LaborContractAmount,
       Status, TargetStartDate, TargetCompletionDate, Closed, Deleted${extraCols})
      VALUES (@tid, @tick, @title, @cv, @lca,
              @stat, @start, @end, ${closed}, 0${extraVals})`);
    pmmNew++;
  }
  console.log(`     PMM: ${pmmNew} inserted, ${PROJECTS.length - pmmNew} already existed\n`);

  // ── 4. OPM Opportunities ─────────────────────────────────────────────────────
  console.log("── 4/8  OPM Opportunities (30)…");
  let opmNew = 0;
  for (const o of OPPORTUNITIES) {
    if (await rowExists(pool, "Opportunity", { TicketId: o.ticket })) continue;
    let req = pool.request()
      .input("tid",    sql.NVarChar, TID)
      .input("tick",   sql.NVarChar, o.ticket)
      .input("title",  sql.NVarChar, o.title)
      .input("cv",     sql.Float,    o.cv)
      .input("chance", sql.NVarChar, String(o.chance))
      .input("close",  sql.DateTime, daysFromNow(o.closeOffset))
      .input("stage",  sql.NVarChar, o.stage);

    let extraCols = ""; let extraVals = "";
    if (hasOpmCrm) { req = req.input("crms", sql.NVarChar, o.stage); extraCols += ", CRMOpportunityStatusChoice"; extraVals += ", @crms"; }
    if (hasOppBU)  { extraCols += ", CRMBusinessUnitChoice"; extraVals += ", 'Pursuits'"; }

    await req.query(`INSERT INTO core2.dbo.Opportunity
      (TenantID, TicketId, Title, ApproxContractValue,
       SuccessChance, CloseDate, Status, Closed, Deleted${extraCols})
      VALUES (@tid, @tick, @title, @cv, @chance, @close, @stage, 0, 0${extraVals})`);
    opmNew++;
  }
  console.log(`     Opportunity: ${opmNew} inserted, ${OPPORTUNITIES.length - opmNew} already existed\n`);

  // ── 5. LEM Leads ─────────────────────────────────────────────────────────────
  console.log("── 5/8  LEM Leads (20)…");
  let lemNew = 0;
  // Check if Lead table exists at all
  const leadTableExists = await pool.request()
    .query(`SELECT COUNT(*) AS cnt FROM core2.sys.objects WHERE name='Lead' AND type='U'`)
    .then(r => (r.recordset[0]?.cnt ?? 0) > 0);

  if (!leadTableExists) {
    console.log("     Lead table not found in core2 — skipping leads\n");
  } else {
    for (const l of LEADS) {
      if (await rowExists(pool, "Lead", { TicketId: l.ticket })) continue;
      let req = pool.request()
        .input("tid",   sql.NVarChar, TID)
        .input("tick",  sql.NVarChar, l.ticket)
        .input("title", sql.NVarChar, l.title);

      let extraCols = ""; let extraVals = "";
      if (hasLeadCV)   { req = req.input("cv",   sql.Float,    Number(l.cv));   extraCols += ", ApproxContractValue"; extraVals += ", @cv";   }
      if (hasLeadCVnv) { req = req.input("cvnv", sql.NVarChar, l.cv);           extraCols += ", ContractValue";       extraVals += ", @cvnv"; }
      if (hasLeadStat) { req = req.input("stat", sql.NVarChar, l.status);       extraCols += ", LeadStatus";          extraVals += ", @stat"; }
      if (hasLeadSec)  { req = req.input("sec",  sql.NVarChar, l.sector);       extraCols += ", MarketSector";        extraVals += ", @sec";  }
      if (hasLeadIsL)  { extraCols += ", IsLead"; extraVals += ", 1"; }

      // Try inserting — Lead may have Status or just LeadStatus
      const hasStatusCol = await hasColumn(pool, "Lead", "Status");
      if (hasStatusCol) {
        req = req.input("statg", sql.NVarChar, l.status);
        extraCols += ", Status"; extraVals += ", @statg";
      }

      await req.query(`INSERT INTO core2.dbo.Lead
        (TenantID, TicketId, Title, Closed, Deleted${extraCols})
        VALUES (@tid, @tick, @title, 0, 0${extraVals})`);
      lemNew++;
    }
    console.log(`     Lead: ${lemNew} inserted, ${LEADS.length - lemNew} already existed\n`);
  }

  // ── 6. ResourceWorkItems + ResourceAllocation (assigned) ────────────────────
  console.log("── 6/8  ResourceWorkItems + ResourceAllocation (assigned staff)…");
  const NOW = new Date();
  const rwiIsIdentity = await pool.request()
    .input("t", sql.NVarChar, "ResourceWorkItems")
    .input("c", sql.NVarChar, "ID")
    .query(`SELECT c.is_identity FROM core2.sys.columns c
            JOIN core2.sys.tables t ON t.object_id = c.object_id
            WHERE t.name=@t AND c.name=@c`)
    .then(r => r.recordset?.[0]?.is_identity === true);
  const hasRwiTitle = await hasColumn(pool, "ResourceWorkItems", "Title");
  const hasRoleCol  = await hasColumn(pool, "ResourceAllocation", "Role");

  let raNew = 0;
  for (const a of ALLOCATIONS) {
    const user = TEAM_MEMBERS[a.ti];
    if (await rowExists(pool, "ResourceAllocation", { ResourceUser: user.guid, TicketId: a.ticket })) continue;

    // Upsert RWI
    let rwiId: number;
    const rwiEx = await pool.request()
      .input("tid",  sql.NVarChar, TID)
      .input("uid",  sql.NVarChar, user.guid)
      .input("tick", sql.NVarChar, a.ticket)
      .query(`SELECT TOP 1 ID FROM core2.dbo.ResourceWorkItems
              WHERE TenantID=@tid AND ResourceUser=@uid AND WorkItem=@tick
              AND (Deleted IS NULL OR Deleted=0)`);

    if (rwiEx.recordset.length > 0) {
      rwiId = rwiEx.recordset[0].ID;
    } else {
      let rwiReq = pool.request()
        .input("tid",  sql.NVarChar, TID)
        .input("uid",  sql.NVarChar, user.guid)
        .input("tick", sql.NVarChar, a.ticket)
        .input("now",  sql.DateTime, NOW)
        .input("sys",  sql.NVarChar, "seed-testrmone");

      let rwiExtra = "";
      if (hasRwiTitle) {
        rwiReq = rwiReq.input("titl", sql.NVarChar, a.ticket);
        rwiExtra = ", Title";
      }

      let idClause = "";
      if (!rwiIsIdentity) {
        const maxR = await pool.request().input("tid", sql.NVarChar, TID)
          .query(`SELECT ISNULL(MAX(ID),0)+1 AS n FROM core2.dbo.ResourceWorkItems WHERE TenantID=@tid`);
        const nid = maxR.recordset[0]?.n ?? 1;
        rwiReq = rwiReq.input("nid", sql.BigInt, nid);
        idClause = "ID, ";
      }

      const rwiR = await rwiReq.query(`INSERT INTO core2.dbo.ResourceWorkItems
        (${idClause}TenantID, ResourceUser, WorkItem, WorkItemType,
         Created, Modified, CreatedByUser, ModifiedByUser, Deleted${rwiExtra ? ", Title" : ""})
        OUTPUT INSERTED.ID
        VALUES (${rwiIsIdentity ? "" : "@nid, "}@tid, @uid, @tick, 'Project',
                @now, @now, @sys, @sys, 0${rwiExtra ? ", @titl" : ""})`);
      rwiId = rwiR.recordset[0].ID;
    }

    const pct = Math.round((a.hours / (a.weeks * 40)) * 100);
    await pool.request()
      .input("tid",   sql.NVarChar, TID)
      .input("uid",   sql.NVarChar, user.guid)
      .input("tick",  sql.NVarChar, a.ticket)
      .input("hours", sql.Float,    a.hours)
      .input("pct",   sql.Float,    pct)
      .input("rwi",   sql.BigInt,   rwiId)
      .input("start", sql.DateTime, daysFromNow(-60))
      .input("end",   sql.DateTime, daysFromNow(120))
      .query(`INSERT INTO core2.dbo.ResourceAllocation
        (TenantID, ResourceUser, TicketId, ResourceWorkItemLookup,
         AllocationHour, PctAllocation,
         AllocationStartDate, AllocationEndDate, Deleted)
        VALUES (@tid, @uid, @tick, @rwi, @hours, @pct, @start, @end, 0)`);
    raNew++;
  }
  console.log(`     ResourceAllocation (assigned): ${raNew} inserted\n`);

  // ── 7. Open Demands (unassigned positions) ───────────────────────────────────
  console.log("── 7/8  Open demand positions (staffing gaps)…");
  let demandNew = 0;
  for (const d of DEMANDS) {
    const ex = await pool.request()
      .input("tid",  sql.NVarChar, TID)
      .input("tick", sql.NVarChar, d.ticket)
      .query(`SELECT COUNT(*) AS cnt FROM core2.dbo.ResourceAllocation
              WHERE TenantID=@tid AND TicketId=@tick AND ResourceUser IS NULL`);
    if ((ex.recordset[0]?.cnt ?? 0) > 0) continue;

    let rwiDemId: number;
    const rwiDEx = await pool.request()
      .input("tid",  sql.NVarChar, TID)
      .input("tick", sql.NVarChar, d.ticket)
      .query(`SELECT TOP 1 ID FROM core2.dbo.ResourceWorkItems
              WHERE TenantID=@tid AND WorkItem=@tick AND ResourceUser IS NULL
              AND (Deleted IS NULL OR Deleted=0)`);

    if (rwiDEx.recordset.length > 0) {
      rwiDemId = rwiDEx.recordset[0].ID;
    } else {
      let rwiReq2 = pool.request()
        .input("tid",  sql.NVarChar, TID)
        .input("tick", sql.NVarChar, d.ticket)
        .input("now",  sql.DateTime, NOW)
        .input("sys",  sql.NVarChar, "seed-testrmone");

      let rwiExtra2 = "";
      if (hasRwiTitle) {
        rwiReq2 = rwiReq2.input("role", sql.NVarChar, d.role);
        rwiExtra2 = ", Title";
      }

      let idClause2 = "";
      if (!rwiIsIdentity) {
        const maxR2 = await pool.request().input("tid", sql.NVarChar, TID)
          .query(`SELECT ISNULL(MAX(ID),0)+1 AS n FROM core2.dbo.ResourceWorkItems WHERE TenantID=@tid`);
        const nid2 = maxR2.recordset[0]?.n ?? 1;
        rwiReq2 = rwiReq2.input("nid", sql.BigInt, nid2);
        idClause2 = "ID, ";
      }

      const rwiD = await rwiReq2.query(`INSERT INTO core2.dbo.ResourceWorkItems
        (${idClause2}TenantID, ResourceUser, WorkItem, WorkItemType,
         Created, Modified, CreatedByUser, ModifiedByUser, Deleted${rwiExtra2 ? ", Title" : ""})
        OUTPUT INSERTED.ID
        VALUES (${rwiIsIdentity ? "" : "@nid, "}@tid, NULL, @tick, 'Project',
                @now, @now, @sys, @sys, 0${rwiExtra2 ? ", @role" : ""})`);
      rwiDemId = rwiD.recordset[0].ID;
    }

    let raReq = pool.request()
      .input("tid",   sql.NVarChar, TID)
      .input("tick",  sql.NVarChar, d.ticket)
      .input("pct",   sql.Float,    d.pct)
      .input("rwi",   sql.BigInt,   rwiDemId)
      .input("start", sql.DateTime, daysFromNow(d.startOffset))
      .input("end",   sql.DateTime, daysFromNow(d.endOffset));

    let raExtra = "";
    if (hasRoleCol) {
      raReq = raReq.input("role", sql.NVarChar, d.role);
      raExtra = ", Role";
    }

    await raReq.query(`INSERT INTO core2.dbo.ResourceAllocation
      (TenantID, ResourceUser, TicketId, ResourceWorkItemLookup,
       PctAllocation, AllocationStartDate, AllocationEndDate, Deleted${raExtra})
      VALUES (@tid, NULL, @tick, @rwi, @pct, @start, @end, 0${raExtra ? ", @role" : ""})`);
    demandNew++;
  }
  console.log(`     Open demands: ${demandNew} inserted\n`);

  // ── 8. PMMTasks — basic 3-phase schedules for active projects ────────────────
  // PMMIdLookup is a bigint FK to PMM.ID (the integer record ID, NOT the TicketId string).
  // PercentComplete is int in PMMTasks (not PctComplete).
  console.log("── 8/8  PMMTasks (basic phase schedules for active projects)…");
  const hasPMMTasks = await pool.request()
    .query(`SELECT COUNT(*) AS cnt FROM core2.sys.objects WHERE name='PMMTasks' AND type='U'`)
    .then(r => (r.recordset[0]?.cnt ?? 0) > 0);

  let taskNew = 0;
  if (!hasPMMTasks) {
    console.log("     PMMTasks table not found — skipping schedules\n");
  } else {
    // NOTE: PMMIdLookup in PMMTasks is the PK (unique per task row), NOT a FK to PMM.ID.
    // We must mint a globally unique bigint for each task row using MAX+1.
    // The FK from a project to its tasks goes through PMM.ProjectLifeCycleLookup.
    // We skip that FK wiring here and insert standalone phase rows linked by TenantID only,
    // which makes them visible in the lifecycle schedule builder.

    const phases = ["Schematic Design", "Design Development", "Construction Documents"];
    const activeForSchedule = PROJECTS.filter(p => p.pct > 0 && p.pct < 100).slice(0, 20);

    // Get the current max PMMIdLookup so we can mint unique IDs
    const maxRow = await pool.request()
      .query(`SELECT ISNULL(MAX(PMMIdLookup), 1000) AS mx FROM core2.dbo.PMMTasks`);
    let nextTaskId: number = Number(maxRow.recordset[0]?.mx ?? 1000) + 1;

    for (const p of activeForSchedule) {
      // Check if we already seeded tasks for this project (by checking TenantID + Title pattern)
      const pmmIdRow = await pool.request()
        .input("tid",  sql.NVarChar, TID)
        .input("tick", sql.NVarChar, p.ticket)
        .query(`SELECT TOP 1 ID FROM core2.dbo.PMM WHERE TenantID=@tid AND TicketId=@tick`);
      if (!pmmIdRow.recordset.length) continue;

      // Check if we already have tasks seeded for this project via StageStep title match
      const alreadySeeded = await pool.request()
        .input("tid", sql.NVarChar, TID)
        .query(`SELECT COUNT(*) AS cnt FROM core2.dbo.PMMTasks WHERE TenantID=@tid AND Title='Schematic Design'`);
      // Only skip if ALL phases already exist (idempotency: check unique task title per tenant)
      if ((alreadySeeded.recordset[0]?.cnt ?? 0) >= activeForSchedule.length) break;

      const span  = p.endOffset - p.startOffset;
      const third = Math.round(span / 3);

      for (let i = 0; i < phases.length; i++) {
        const phaseStart = daysFromNow(p.startOffset + i * third);
        const phaseEnd   = daysFromNow(p.startOffset + (i + 1) * third);
        const phasePct = Math.min(100, Math.max(0,
          Math.round(Math.min(1, Math.max(0, p.pct / 100 * 3 - i)) * 100)));

        const taskId = nextTaskId++;
        const now = new Date();
        try {
          await pool.request()
            .input("taskid",  sql.BigInt,   taskId)
            .input("tid",     sql.NVarChar, TID)
            .input("name",    sql.NVarChar, phases[i])
            .input("ts",      sql.DateTime, phaseStart)
            .input("td",      sql.DateTime, phaseEnd)
            .input("tp",      sql.Int,      phasePct)
            .input("step",    sql.Int,      i + 1)
            .input("now",     sql.DateTime, now)
            .input("seedusr", sql.NVarChar, "seed-script")
            .query(`INSERT INTO core2.dbo.PMMTasks
              (PMMIdLookup, TenantID, Title, StartDate, DueDate,
               PercentComplete, StageStep, Deleted,
               SprintLookup, UserSkillMultiLookup,
               Created, Modified, CreatedByUser, ModifiedByUser)
              VALUES (@taskid, @tid, @name, @ts, @td, @tp, @step, 0,
                      0, 0, @now, @now, @seedusr, @seedusr)`);
          taskNew++;
        } catch (e: any) { console.warn(`  PMMTask insert error: ${e.message}`); }
      }
    }
    console.log(`     PMMTasks: ${taskNew} phase rows inserted\n`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const portfolio    = PROJECTS.reduce((s, p) => s + p.cv, 0);
  const pipeline     = OPPORTUNITIES.reduce((s, o) => s + (o.cv * o.chance / 100), 0);
  const overdue      = PROJECTS.filter(p => p.endOffset < 0 && p.pct < 100).length;
  const dueSoon      = PROJECTS.filter(p => p.endOffset >= 0 && p.endOffset <= 30 && p.pct < 100).length;
  const completed    = PROJECTS.filter(p => p.status === "Closed").length;
  const allocatedSet = new Set(ALLOCATIONS.map(a => a.ti));
  const bench        = TEAM_MEMBERS.length - allocatedSet.size;
  const overAllocSet = new Set(
    ALLOCATIONS.filter(a => {
      const tot = ALLOCATIONS.filter(x => x.ti === a.ti)
        .reduce((s, x) => s + Math.round((x.hours / (x.weeks * 40)) * 100), 0);
      return tot > 100;
    }).map(a => a.ti),
  );

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Seed Complete — testrmone tenant                ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`
  Login users (password: rmone@8723):
    ceo@testrmone.com    — Alexandra Chen (CEO, admin)
    cfo@testrmone.com    — Robert Kumar   (CFO, admin)
    coo@testrmone.com    — Sarah Mitchell (COO, admin)
    rm@testrmone.com     — David Torres   (Resource Manager, manager)
    exec@testrmone.com   — Jennifer Park  (Executive, admin)
    pm@testrmone.com     — Marcus Johnson (Project Manager, manager)

  Data seeded:
    Projects      : ${PROJECTS.length} total (${overdue} overdue · ${dueSoon} due ≤30d · ${completed} completed)
    Opportunities : ${OPPORTUNITIES.length} (proposal → negotiation spread)
    Leads         : ${LEADS.length}
    Team staff    : ${TEAM_MEMBERS.length} members (${bench} bench · ${overAllocSet.size} over-allocated)
    Open demands  : ${DEMANDS.length} unfilled positions

  Expected signals per role:
    CEO  / EXEC  — $${(portfolio / 1e6).toFixed(0)}M portfolio · ${PROJECTS.filter(p=>p.pct<100&&p.endOffset>=0).length} active projects
    CFO          — $${(pipeline / 1e6).toFixed(1)}M weighted pipeline · ${overdue} overdue (revenue at risk)
    COO          — ${overdue} critical · ${dueSoon} due soon · ${overAllocSet.size} over-allocated
    Res. Mgr     — ${TEAM_MEMBERS.length} staff · ${bench} bench · concentration risk (Alex Rivera: 8 projects)
    PM           — ${overdue} overdue · ${dueSoon} due ≤30d · Emma Cox on 2 overdue projects (conflict)
  `);

  process.exit(0);
}

seed().catch(e => { console.error("[seed] FATAL:", e.message); process.exit(1); });
