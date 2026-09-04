// Call the SAME provider function the Resources staff grid uses, with a fresh
// process (no warm cache), to see whether Mike Murry is in the server output.
import { getResourceAllocations } from "../src/lib/rds-provider.js";

const TID = "22897300-acd1-5876-bfba-ae8b794cedd0"; // Alston AI

async function main() {
  const out: any = await getResourceAllocations(TID);
  const people: any[] = Array.isArray(out) ? out : (out?.resources ?? out?.people ?? []);
  console.log("people count:", people.length);
  const mike = people.filter((p: any) => String(p?.name ?? "").toLowerCase().includes("murry"));
  console.log("mike entries:", JSON.stringify(mike.map((m: any) => ({ id: m.id, name: m.name, role: m.role, username: m.username })), null, 2));
  if (!mike.length) console.log("sample names:", people.slice(0, 30).map((p: any) => p.name).join(", "));
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
