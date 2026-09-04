export function getSSParam(): string {
  if (typeof window === "undefined") return "";
  try {
    return new URLSearchParams(window.location.search).get("ss") ?? "";
  } catch {
    return "";
  }
}

/** Read an arbitrary query-string param (web only — used for deep-links from Home). */
export function getQueryParam(name: string): string {
  if (typeof window === "undefined") return "";
  try {
    return new URLSearchParams(window.location.search).get(name) ?? "";
  } catch {
    return "";
  }
}
