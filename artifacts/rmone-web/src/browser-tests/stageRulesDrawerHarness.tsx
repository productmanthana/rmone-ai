/*
 * Stage-rules drawer regression:
 *
 * An empty stage-permission rule is an explicit server-side freeze. This
 * harness mounts the real schedule-card host and pins the three client-side
 * protections around that dangerous legacy shape:
 *   1. choosing a restricted editor mode with no picks stays UI-only;
 *   2. a changed permissions document containing an empty rule is rejected
 *      before the host sends a PUT;
 *   3. stepping to another stage clears the restricted-mode draft.
 *
 * The browser runner supplies only the API responses; all state transitions,
 * validation, toasts, and DOM are production code.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ScheduleStageRulesHost,
  type ScheduleRuleTarget,
} from "@/components/StageRulesSettings";
import { Toaster } from "@/components/ui/toaster";
import { EMPTY_STAGE_RULES } from "@/lib/stageRules";

const NEW_STAGE = "New";
const ACTIVE_STAGE = "Active";
const PERSON_ID = "11111111-2222-3333-4444-555555555555";

type Row = Record<string, unknown>;

const emptyRules = {
  ...EMPTY_STAGE_RULES,
  stageOrder: { PMM: [NEW_STAGE, ACTIVE_STAGE], OPM: null, LEM: null },
};

const emptyLegacyPermission = {
  module: "PMM",
  stage: NEW_STAGE,
  actionUserIds: [],
  actionGroupIds: [],
  editorUserIds: [],
  editorGroupIds: [],
  // This is the old grant-style shape. A regression that stamps "viewOnly"
  // here would turn the UI-only restricted draft into a dirty freeze.
  othersMode: "normal",
};

const activePermission = {
  module: "PMM",
  stage: ACTIVE_STAGE,
  actionUserIds: [],
  actionGroupIds: [],
  editorUserIds: [PERSON_ID],
  editorGroupIds: [],
  othersMode: "normal",
};

export const permissionPutBodies: Row[] = [];

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl, window.location.href);
  const path = url.pathname;
  const method = (init?.method ?? "GET").toUpperCase();

  if (!path.startsWith("/api/")) return realFetch(input, init);

  if (path === "/api/rmone/stage-rules" && method === "GET") {
    return jsonResponse({ rules: emptyRules, stageOrder: emptyRules.stageOrder });
  }
  if (path === "/api/onboarding/stage-permissions" && method === "GET") {
    return jsonResponse({ rules: [emptyLegacyPermission, activePermission] });
  }
  if (path === "/api/onboarding/stage-permissions" && method === "PUT") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { rules?: Row[] };
    permissionPutBodies.push(body);
    return jsonResponse({ rules: body.rules ?? [] });
  }
  if (path === "/api/rmone/stage-rules" && method === "PUT") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { rules?: unknown };
    return jsonResponse({ rules: body.rules ?? emptyRules });
  }
  if (path === "/api/onboarding/user-groups") return jsonResponse({ groups: [] });
  if (path === "/api/rmone/user-list") {
    return jsonResponse([{ Id: PERSON_ID, Name: "Jordan Blake" }]);
  }
  if (path.startsWith("/api/rmone/field-options/")) return jsonResponse({ options: [] });
  if (path === "/api/rmone/business-units-list"
      || path === "/api/rmone/divisions"
      || path === "/api/rmone/departments"
      || path === "/api/rmone/roles-by-bu") return jsonResponse([]);
  return jsonResponse([]);
};

localStorage.setItem("rmone_token", "browser-test-token");
localStorage.setItem("rmone_username", "browser-test-admin");
localStorage.setItem("rmone_tenant", "browser-test-tenant");

function nextPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > 8_000) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await nextPaint();
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

function drawer(): HTMLElement {
  const value = document.querySelector<HTMLElement>('[role="dialog"][aria-label^="Rules for"]');
  if (!value) throw new Error("Stage-rules drawer did not mount");
  return value;
}

function whoModeSelect(): HTMLSelectElement {
  const value = Array.from(drawer().querySelectorAll<HTMLSelectElement>("select"))
    .find(select => Array.from(select.options).some(option => option.value === "people"));
  if (!value) throw new Error("Who-can-edit mode select did not mount");
  return value;
}

function saveButton(): HTMLButtonElement {
  const value = Array.from(drawer().querySelectorAll<HTMLButtonElement>("button"))
    .find(button => ["Save", "Saved"].includes(button.textContent?.trim() ?? ""));
  if (!value) throw new Error("Drawer save button did not mount");
  return value;
}

function chooseRestrictedMode(): void {
  const select = whoModeSelect();
  select.value = "people";
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function Shell(): React.ReactElement {
  const [open, setOpen] = useState<ScheduleRuleTarget>({
    mod: "PMM",
    stage: NEW_STAGE,
    order: [NEW_STAGE, ACTIVE_STAGE],
  });
  return (
    <>
      <ScheduleStageRulesHost
        open={open}
        onOpenChange={next => {
          if (next) setOpen(next);
        }}
      />
      <Toaster />
    </>
  );
}

async function runRegression(): Promise<void> {
  permissionPutBodies.length = 0;
  createRoot(document.getElementById("root")!).render(<Shell />);

  await waitUntil(
    () => document.querySelector<HTMLElement>('[role="dialog"][aria-label^="Rules for"]')
      ?.getAttribute("aria-label") === `Rules for ${NEW_STAGE}`,
    "The New stage drawer did not finish loading");

  // 1. The empty legacy rule must remain a UI-only draft. If setEditWhoMode
  // stamps viewOnly, the host becomes dirty and the Save button enables.
  chooseRestrictedMode();
  await waitUntil(() => whoModeSelect().value === "people",
    "Restricted editor mode was not selected");
  if (!bodyText().includes("Pick at least one")) {
    throw new Error("Empty restricted mode did not explain that a first pick is still required");
  }
  if (!saveButton().disabled || saveButton().textContent?.trim() !== "Saved") {
    throw new Error("Choosing restricted mode with an empty legacy rule made the draft dirty");
  }
  if (permissionPutBodies.length !== 0) {
    throw new Error("Choosing restricted mode with no picks sent a permissions PUT");
  }

  // 3. Stepping stages must discard that UI-only draft. The Active rule is
  // grant-style, so its fresh view is Everyone with access.
  const nextStage = drawer().querySelector<HTMLButtonElement>('button[title="Next stage"]');
  if (!nextStage) throw new Error("Next-stage button did not mount");
  nextStage.click();
  await waitUntil(
    () => document.querySelector<HTMLElement>('[role="dialog"][aria-label^="Rules for"]')
      ?.getAttribute("aria-label") === `Rules for ${ACTIVE_STAGE}`,
    "Stepping to Active did not switch the drawer");
  if (whoModeSelect().value !== "everyone") {
    throw new Error(`Switching stages retained the previous editWhoDraft (${whoModeSelect().value})`);
  }

  // 2. Make the non-empty Active rule dirty while the empty New legacy rule
  // remains in the same document. The host gate must block before PUT.
  chooseRestrictedMode();
  await waitUntil(() => whoModeSelect().value === "people" && !saveButton().disabled,
    "Changing the non-empty Active permission rule did not enable Save");
  saveButton().click();
  await waitUntil(() => bodyText().includes("A stage permission rule is empty"),
    "The host did not surface the empty-rule save guard");
  if (permissionPutBodies.length !== 0) {
    throw new Error("Host save guard allowed a permissions PUT containing an empty rule");
  }
}

void runRegression()
  .then(() => {
    document.documentElement.dataset.testStatus = "passed";
    document.documentElement.dataset.testDetail = "all assertions passed";
  })
  .catch(error => {
    document.documentElement.dataset.testStatus = "failed";
    document.documentElement.dataset.testDetail =
      error instanceof Error ? error.stack || error.message : String(error);
    console.error(error);
  });