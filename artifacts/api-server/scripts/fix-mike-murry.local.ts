import { getMssqlPool, updateUser } from "@workspace/db";
async function main() {
  const tid = "22897300-acd1-5876-bfba-ae8b794cedd0";
  const id  = "9ddf763e-ccc6-4631-8570-16f4b87da6a9"; // Mike Murry - fake10@rmone.com
  await getMssqlPool(); // ensure bootstrap
  await updateUser(tid, id, { enabled: true });
  console.log("Mike Murry re-enabled successfully.");
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
