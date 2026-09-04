/**
 * Task #801 regression guard for status propagation boundaries. These checks
 * cover provider paths that are deliberately difficult to fixture end-to-end
 * (parallel SQL fan-out), while pinning the canonical identity rules in source.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const provider = readFileSync(resolve(import.meta.dirname, "../rds-provider.ts"), "utf8");
const afStore = readFileSync(resolve(import.meta.dirname, "../actuals-forecast-store.ts"), "utf8");
const afRoute = readFileSync(resolve(import.meta.dirname, "../../routes/actuals-forecast.ts"), "utf8");

// Disabled-but-non-deleted people remain in the main roster and their
// allocation rows; only deletion is a visibility boundary.
assert.match(provider, /if \(appRow\?\.deleted\) continue;/);
assert.match(provider, /if \(knownRow\?\.deleted\) continue;/);
assert.doesNotMatch(provider, /\.filter\(\(u\) => u\.enabled !== false\)\s*\.map\(\(u\) => \(\{/);
assert.match(provider, /enabled: p\.enabled,/);
assert.match(provider, /enabled: u\.enabled !== false,/);

// Resource and team identities stay GUID-keyed, never display-name-keyed, so
// duplicate names remain distinct within a tenant.
assert.match(provider, /const byId = new Map<string, PersonRec>\(\);/);
assert.match(provider, /const key = `\$\{\(resourceId \|\| name\)\.toLowerCase\(\)\}::/);
assert.match(provider, /tenantId: tid,/);
// Every getProjectTeamRds member branch (RA primary, RWI-only fallback and
// project-*User fallback) carries the request tenant, including disabled
// canonical users and superadmin-targeted tenant contexts.
const teamSection = provider.slice(provider.indexOf("export async function getProjectTeamRds"));
assert.ok(teamSection.indexOf("tenantId: tid,") >= 0, "primary team members carry tenantId");
assert.equal((teamSection.match(/tenantId: tid,/g) ?? []).length >= 3, true,
  "primary and both fallback team projections must carry tenantId");
assert.match(teamSection, /enabled: orgU\?\.enabled !== false,\s+tenantId: tid,/);
assert.match(teamSection, /enabled: orgU2\?\.enabled !== false,\s+tenantId: tid,/);
assert.match(teamSection, /enabled: u\?\.enabled !== false,\s+tenantId: tid,/);

// Stored AF evidence receives CURRENT tenant-scoped canonical metadata. The
// people map's GUID key prevents a same GUID/name in another tenant bleeding in.
assert.match(afStore, /const people = new Map<string, \{ name: string; enabled: boolean; tenantId: string \}>\(\);/);
assert.match(afStore, /people\.set\(id, \{ name, enabled: u\.enabled !== false, tenantId: tid \}\)/);
assert.match(afStore, /enabled: person\?\.enabled \?\? null, tenant_id: person\?\.tenantId \?\? tid/);
assert.match(afRoute, /enabled: typeof r\.enabled === "boolean" \? r\.enabled : null,/);
assert.match(afRoute, /tenantId: String\(r\.tenant_id \?\? ""\),/);

console.log("staff status propagation contract regression passed");