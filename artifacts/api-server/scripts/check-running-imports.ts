/** Is any import running against the shared RDS right now (dev OR prod)? */
import { countActiveOnboardingImports, getAllOnboardingJobsMeta } from "@workspace/db";

const active = await countActiveOnboardingImports(5);
console.log(`Active imports (fresh heartbeat, last 5 min): ${active}`);

const jobs = await getAllOnboardingJobsMeta();
const recent = jobs.slice(0, 8);
for (const j of recent) {
  console.log(
    `${j.status.padEnd(9)} ${j.tenantId?.slice(0, 12).padEnd(14) ?? ""} ${j.fileName?.slice(0, 34).padEnd(36) ?? ""} created=${j.createdAt} updated=${j.updatedAt}`,
  );
}
process.exit(0);
