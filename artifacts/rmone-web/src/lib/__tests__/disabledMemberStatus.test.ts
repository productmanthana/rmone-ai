import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Keep browser-only cache/sync paths inert while exercising the actual
// component + API helper contract.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
(globalThis as Record<string, unknown>).fetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const React = (await import("react")).default;
const { default: TestRenderer, act } = await import("react-test-renderer");
const { DisabledMemberStatus } = await import("../../components/DisabledMemberStatus");

let refreshes = 0;
let renderer!: ReturnType<typeof TestRenderer.create>;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(DisabledMemberStatus, {
    enabled: false,
    userGuid: "person-guid-801",
    tenantId: "other-tenant-guid-801",
    canManageStaff: true,
    onReactivated: () => { refreshes += 1; },
  }));
});
const button = renderer.root.findAllByType("button").find(node =>
  node.children.some((child: unknown) => child === " Reactivate"),
);
assert.ok(button, "Reactivate control is rendered.");
await act(async () => {
  await button.props.onClick({ stopPropagation() {} });
});

assert.equal(calls.length, 1, "Reactivate performs one account write.");
assert.equal(calls[0].url, "/api/onboarding/members/active");
assert.deepEqual(calls[0].body, {
  userGuid: "person-guid-801",
  tenantId: "other-tenant-guid-801",
  active: true,
}, "The cross-tenant member identity and active:true contract are retained.");
assert.equal(refreshes, 1, "The owning team surface refreshes after a successful reactivation.");

// Project Detail has both a fast team-first projection and its enriched
// projection. Both must retain the tenant supplied by project-team before the
// allocation reaches SimpleTeamTable/TeamGantt.
const projectDetailSource = readFileSync(new URL("../../pages/project-detail.tsx", import.meta.url), "utf8");
assert.equal(
  (projectDetailSource.match(/tenantId: tm\.tenantId/g) ?? []).length,
  2,
  "Both project-team → allocation projections retain the member tenant ID.",
);
console.log("disabledMemberStatus: tenant-scoped Reactivate contract passed");