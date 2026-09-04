// Compact abbreviations for role/title strings on tight team-card rows:
// "Project Manager" → "PM", "Senior Project Manager" → "Sr PM",
// "Project Engineer II" → "PE II", "VP of Project Management" → "VP PM".
// Single-word roles stay as-is. Call sites must expose the FULL text via a
// hover tooltip (title attribute) since the abbreviation is lossy.
const MODIFIERS: Record<string, string> = {
  senior: "Sr", sr: "Sr", junior: "Jr", jr: "Jr",
  assistant: "Asst", associate: "Assoc", deputy: "Dep",
  executive: "Exec", principal: "Prin",
};
const NUMERAL_RE = /^(?:[IVX]{1,4}|\d{1,2})$/i;
const SKIP_WORDS = new Set(["of", "the", "and", "for", "&", "-", "–"]);

export function abbrevRole(full: string): string {
  const raw = (full || "").trim();
  if (!raw) return raw;
  const words = raw.replace(/\(.*?\)/g, " ").split(/[\s/]+/).filter(Boolean);
  const mods: string[] = [];
  const cores: string[] = [];
  const tails: string[] = [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (SKIP_WORDS.has(lw)) continue;
    // Roman numerals / levels ("II", "2") trail the abbreviation verbatim.
    if (NUMERAL_RE.test(w) && cores.length > 0) { tails.push(w.toUpperCase()); continue; }
    // Leading seniority modifiers keep their conventional short form.
    if (MODIFIERS[lw] && cores.length === 0) { mods.push(MODIFIERS[lw]); continue; }
    cores.push(w);
  }
  let core: string;
  if (cores.length >= 2) {
    // Initials for multi-word cores; existing acronyms ("VP") stay whole and
    // break the initial-run so "VP of Project Management" reads "VP PM".
    const parts: string[] = [];
    let run = "";
    for (const w of cores) {
      if (w.length <= 3 && w === w.toUpperCase()) {
        if (run) { parts.push(run); run = ""; }
        parts.push(w);
      } else {
        run += w[0].toUpperCase();
      }
    }
    if (run) parts.push(run);
    core = parts.join(" ");
  } else {
    core = cores.join(" ");
  }
  const out = [...mods, core, ...tails].filter(Boolean).join(" ");
  // Never return something LONGER than the original (e.g. "Sr" → "Sr").
  return out && out.length < raw.length ? out : raw;
}
