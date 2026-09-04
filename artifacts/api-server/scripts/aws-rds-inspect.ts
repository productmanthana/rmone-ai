/** Inspect RDS instances + existing proxies to plan the connection-pool fix. */
import {
  RDSClient,
  DescribeDBInstancesCommand,
  DescribeDBProxiesCommand,
} from "@aws-sdk/client-rds";

const client = new RDSClient({ region: process.env["AWS_REGION"] });

const [instances, proxies] = await Promise.all([
  client.send(new DescribeDBInstancesCommand({})),
  client
    .send(new DescribeDBProxiesCommand({}))
    .catch((e: Error) => ({ DBProxies: null, _err: e.message })),
]);

for (const db of instances.DBInstances ?? []) {
  console.log(`ID:        ${db.DBInstanceIdentifier}`);
  console.log(`Class:     ${db.DBInstanceClass}`);
  console.log(`Engine:    ${db.Engine} ${db.EngineVersion}`);
  console.log(`Endpoint:  ${db.Endpoint?.Address}:${db.Endpoint?.Port}`);
  console.log(`VPC:       ${db.DBSubnetGroup?.VpcId}`);
  console.log(`Subnets:   ${db.DBSubnetGroup?.Subnets?.map((s) => s.SubnetIdentifier).join(", ")}`);
  console.log(`SecGroups: ${db.VpcSecurityGroups?.map((g) => g.VpcSecurityGroupId).join(", ")}`);
  console.log(`Status:    ${db.DBInstanceStatus}  MultiAZ: ${db.MultiAZ}`);
  console.log(`Storage:   ${db.AllocatedStorage}GB ${db.StorageType}`);
  console.log("---");
}
const p = proxies as { DBProxies: { DBProxyName?: string }[] | null; _err?: string };
console.log("Proxies:", JSON.stringify(p.DBProxies ?? [], null, 2));
if (p._err) console.log("Proxy check error:", p._err);

// Proxy target registration + health
const { DescribeDBProxyTargetsCommand } = await import("@aws-sdk/client-rds");
for (const proxy of p.DBProxies ?? []) {
  if (!proxy.DBProxyName) continue;
  const targets = await client
    .send(new DescribeDBProxyTargetsCommand({ DBProxyName: proxy.DBProxyName }))
    .catch((e: Error) => ({ Targets: null, _err: e.message }));
  console.log(
    `Targets for ${proxy.DBProxyName}:`,
    JSON.stringify((targets as { Targets?: unknown[] }).Targets ?? (targets as { _err?: string })._err, null, 2),
  );
}

// Which endpoint does the app connect to? (host only — never credentials)
const raw = process.env["APP_DATABASE_URL"] ?? "";
try {
  const u = new URL(raw);
  const host = u.hostname;
  const isProxy = host.includes(".proxy-");
  const isRds = host.includes(".rds.amazonaws.com");
  console.log(
    `App DB host classification: ${isProxy ? "RDS PROXY endpoint" : isRds ? "DIRECT RDS instance endpoint" : "other/unknown"}`,
  );
  console.log(`Host suffix: ...${host.slice(-55)}`);
} catch {
  console.log("APP_DATABASE_URL not parseable as URL");
}
