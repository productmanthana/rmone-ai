// ─────────────────────────────────────────────────────────────────────────────
// Stable role → color mapping.
//
// Every role name always maps to the SAME color, everywhere in the app —
// "PM" is one fixed color, "Project Lead" another — so same-role members
// read as a group at a glance (user request: no random per-member colors).
//
// The mapping is deterministic (hash of the normalized role name into a
// curated palette), so it never depends on team composition, sort order,
// or which project you're looking at.
// ─────────────────────────────────────────────────────────────────────────────

// Curated palette: distinguishable hues that read well on the dark theme.
// Order matters only in that it spreads adjacent hash values across hues.
export const ROLE_PALETTE = [
  "#84CC16", // lime
  "#38BDF8", // sky
  "#FB923C", // orange
  "#A78BFA", // violet
  "#2DD4BF", // teal
  "#F472B6", // pink
  "#FBBF24", // amber
  "#60A5FA", // blue
  "#4ADE80", // green
  "#E879F9", // fuchsia
  "#FB7185", // rose
  "#22D3EE", // cyan
  "#C084FC", // purple
  "#FACC15", // yellow
  "#34D399", // emerald
  "#93C5FD", // light blue
];

// djb2 string hash — small, fast, deterministic.
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Fixed color for a role name. Falls back to a neutral gray when blank. */
export function roleColor(role: string | null | undefined): string {
  const key = (role || "").trim().toLowerCase();
  if (!key) return "#94A3B8"; // slate — "no role" neutral
  return ROLE_PALETTE[hashStr(key) % ROLE_PALETTE.length];
}
