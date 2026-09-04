/**
 * Pipeline Review lifecycle refresh regression check.
 * Run: pnpm --filter @workspace/rmone-web run check:lifecycle-refresh
 *
 * Exercises the supported smartUpdate date path used by ProjectDatesWidget:
 * a successful ActualCompletionDate save must emit the lifecycle event and
 * make the next affected module read use ?fresh=1.
 */

const values = new Map<string, string>();
const storage = {
  getItem(key: string) { return values.get(key) ?? null; },
  setItem(key: string, value: string) { values.set(key, String(value)); },
  removeItem(key: string) { values.delete(key); },
  clear() { values.clear(); },
  key(index: number) { return [...values.keys()][index] ?? null; },
  get length() { return values.size; },
};

const fakeWindow = new EventTarget() as EventTarget & { localStorage: typeof storage };
fakeWindow.localStorage = storage;
class TestCustomEvent<T = unknown> extends Event {
  public readonly detail: T;
  constructor(type: string, init?: { detail?: T }) {
    super(type);
    this.detail = init?.detail as T;
  }
}

const runtime = globalThis as typeof globalThis & { window: typeof fakeWindow; localStorage: typeof storage; CustomEvent: typeof TestCustomEvent };
runtime.window = fakeWindow;
runtime.localStorage = storage;
runtime.CustomEvent = TestCustomEvent;
// The test needs no real cross-tab transport; avoiding a Node BroadcastChannel
// also makes the process exit deterministically.
(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;

const calls: string[] = [];
globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  calls.push(url);
  if (url.endsWith("/smart-update")) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/records/PMM")) {
    return new Response(JSON.stringify({ total: 0, data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({}), { status: 404, headers: { "content-type": "application/json" } });
};

const api = await import("../src/lib/api");
let lifecycleDetail: { modules?: string[] } | null = null;
fakeWindow.addEventListener(api.LIFECYCLE_CHANGED_EVENT, (event) => {
  lifecycleDetail = (event as unknown as { detail: { modules?: string[] } }).detail;
});

await api.smartUpdate("PMM-SMART-1", [{
  FieldName: "ActualCompletionDate",
  Value: "2026-08-19T00:00:00",
  IsExcluded: false,
}]);
await api.getModuleRecords("PMM");

const eventOk = lifecycleDetail?.modules?.length === 1 && lifecycleDetail.modules[0] === "PMM";
const freshOk = calls.some((url) => url.includes("/records/PMM?fresh=1"));
if (!eventOk || !freshOk) {
  console.error("check-lifecycle-refresh: FAILED", { lifecycleDetail, calls });
  process.exit(1);
}
console.log("check-lifecycle-refresh: smartUpdate ActualCompletionDate emits PMM lifecycle refresh and fresh read");