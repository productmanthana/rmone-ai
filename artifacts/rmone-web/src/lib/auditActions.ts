/**
 * Value-free audit interaction capture for the web shell.
 *
 * This is deliberately delegated from document instead of being wired into
 * individual controls. It records only a small semantic action vocabulary and
 * route/control categories: never typed text, selected values, record names,
 * query strings, or keystrokes.
 */
import {
  recordAuditInteraction,
  type AuditInteractionEntityType,
  type AuditInteractionType,
} from "./api";

const DEDUPE_MS = 2_000;
const MAX_DEDUPE_KEYS = 200;
const recent = new Map<string, number>();
let installed = false;

function entityForPath(pathname: string): AuditInteractionEntityType {
  const segment = pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  const known: Record<string, AuditInteractionEntityType> = {
    project: "project",
    projects: "list",
    opportunity: "opportunity",
    opportunities: "list",
    lead: "lead",
    leads: "list",
    company: "company",
    companies: "list",
    contact: "contact",
    contacts: "list",
    staff: "staff",
    resources: "resource",
    resource: "resource",
    configuration: "configuration",
    settings: "configuration",
    report: "report",
    reports: "report",
    analytics: "report",
    "analytics-center": "report",
    "audit-trail": "audit-trail",
  };
  return known[segment] ?? (segment ? "list" : "dashboard");
}

/** A structural, stable control category. It is used only to dedupe and
 * classify a gesture; no dynamic DOM text or form value leaves the browser. */
function safeControlLabel(element: HTMLElement): string {
  const raw = element.dataset.auditAction
    ?? element.getAttribute("data-testid")
    ?? element.id
    ?? element.getAttribute("name")
    ?? element.getAttribute("aria-label")
    ?? element.tagName.toLowerCase();
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80) || element.tagName.toLowerCase();
}

function send(type: AuditInteractionType, entityType: AuditInteractionEntityType, label: string): void {
  const now = Date.now();
  const key = `${type}:${entityType}:${label}`;
  const previous = recent.get(key);
  if (previous && now - previous < DEDUPE_MS) return;
  recent.set(key, now);
  if (recent.size > MAX_DEDUPE_KEYS) {
    for (const [candidate, at] of recent) {
      if (now - at >= DEDUPE_MS || recent.size > MAX_DEDUPE_KEYS) recent.delete(candidate);
      if (recent.size <= MAX_DEDUPE_KEYS) break;
    }
  }
  recordAuditInteraction(type, entityType);
}

function clickType(label: string, expanded: string | null): AuditInteractionType {
  if (label.includes("export") || label.includes("download")) return "export";
  if (label.includes("search")) return "search";
  if (expanded === "true" || label.includes("close") || label.includes("hide")) return "close";
  return "open";
}

function trackNavigation(): void {
  const pathname = window.location.pathname;
  send("navigate", entityForPath(pathname), `route:${pathname.split("/").filter(Boolean)[0] ?? "home"}`);
}

/** Install global capture exactly once. Safe if startup is evaluated twice
 * during development or an embedding host remounts the web app. */
export function installAuditActionTracking(): void {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>("button, a[href], [role='button']");
    if (!control || control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true") return;
    const label = safeControlLabel(control);
    send(clickType(label, control.getAttribute("aria-expanded")), entityForPath(window.location.pathname), label);
  }, true);

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)
      && !(target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio"))) return;
    // No selected value, checked state, or typed value is inspected or sent.
    send("filter", entityForPath(window.location.pathname), safeControlLabel(target));
  }, true);

  const notifyNavigation = () => queueMicrotask(trackNavigation);
  const wrapHistory = (method: "pushState" | "replaceState") => {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      notifyNavigation();
      return result;
    } as History["pushState"];
  };
  wrapHistory("pushState");
  wrapHistory("replaceState");
  window.addEventListener("popstate", trackNavigation);
  window.addEventListener("hashchange", trackNavigation);
  trackNavigation();
}