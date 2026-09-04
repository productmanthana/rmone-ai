// Dev probe: after the zero-claim fix, confirm getProjectTeamRds and the
// resource-week engine serve the SAME weekly numbers for OPM-00051 members.
import { getProjectTeamRds, getResourceWeekAllocationsRds } from "../src/lib/rds-provider.js";

const TID = "5c03084c-7413-5a56-9fa2-bc401f8a5650";
const PID = "OPM-00051";
const ADAM = "7fa6bdc1-2422-4cf4-8c45-f6aa48ad379c";

const team = (await getProjectTeamRds(TID, PID)) as unknown as {
  team?: Array<{ name: string; resourceId?: string; eacHrs?: number; weeklyHours?: Array<{ week: string; hours: number }> }>;
} | Array<{ name: string; resourceId?: string; eacHrs?: number; weeklyHours?: Array<{ week: string; hours: number }> }>;
const members = Array.isArray(team) ? team : (team.team ?? []);
console.log("team members:", members.length);
for (const m of members) {
  const wh = m.weeklyHours ?? [];
  const nonZero = wh.filter(w => w.hours > 0);
  console.log(`- ${m.name}: eac=${m.eacHrs} weeklyEntries=${wh.length} nonZero=${nonZero.length} first3=${JSON.stringify(wh.slice(0, 3))}`);
}

const eng = await getResourceWeekAllocationsRds(TID, ADAM, "2026-08-01", "2026-11-30");
const engRows = (eng as { weeks?: Array<{ weekStart: string; projects?: Array<{ projectId: string; hours: number }> }> }).weeks
  ?? (eng as unknown as Array<{ weekStart: string }>);
console.log("\nengine result keys:", Object.keys(eng as object));
console.log("engine sample:", JSON.stringify(engRows).slice(0, 600));
process.exit(0);
