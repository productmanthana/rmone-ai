/**
 * Shared status-list rules for schedule-enabled records.
 *
 * A PMM/OPM lifecycle owns its base status list: those dated schedule phases
 * stay in schedule order, while per-record custom statuses are appended.
 * Keep this small module independent of page components so list views, Quick
 * Actions, and Project Detail all use the same controlled status vocabulary.
 */
export type StageCfg = {
  order: string[];
  custom: string[];
  removed: string[];
  subStatuses?: Record<string, string[]>;
};

export const EMPTY_STAGE_CFG: StageCfg = { order: [], custom: [], removed: [], subStatuses: {} };

export function parseStageCfg(value: unknown): StageCfg {
  const raw = value as Record<string, unknown> | null;
  if (!raw || !Array.isArray(raw.order) || !Array.isArray(raw.custom)) return EMPTY_STAGE_CFG;
  const subStatuses: Record<string, string[]> = {};
  if (raw.subStatuses && typeof raw.subStatuses === "object" && !Array.isArray(raw.subStatuses)) {
    for (const [key, entries] of Object.entries(raw.subStatuses as Record<string, unknown>)) {
      if (Array.isArray(entries)) subStatuses[key] = entries.map(String);
    }
  }
  return {
    order: raw.order.map(String),
    custom: raw.custom.map(String),
    removed: Array.isArray(raw.removed) ? raw.removed.map(String) : [],
    subStatuses,
  };
}

export function applyStageCfgToOptions(base: string[], cfg: StageCfg, lockedBase = false): string[] {
  const locked = lockedBase ? new Set(base.map((value) => value.trim().toLowerCase())) : null;
  const removed = new Set(cfg.removed.map((value) => value.trim().toLowerCase()));
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...base, ...cfg.custom]) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key) || (removed.has(key) && !(locked && locked.has(key)))) continue;
    seen.add(key);
    merged.push(value);
  }

  const ordered: string[] = [];
  if (locked) for (const value of merged) if (locked.has(value.trim().toLowerCase())) ordered.push(value);
  for (const configured of locked ? cfg.order.filter((value) => !locked.has(value.trim().toLowerCase())) : cfg.order) {
    const found = merged.find((value) => value.trim().toLowerCase() === configured.trim().toLowerCase());
    if (found && !ordered.includes(found)) ordered.push(found);
  }
  for (const value of merged) if (!ordered.includes(value)) ordered.push(value);

  const output: string[] = [];
  const outputKeys = new Set<string>();
  for (const phase of ordered) {
    const phaseKey = phase.trim().toLowerCase();
    if (!outputKeys.has(phaseKey)) { outputKeys.add(phaseKey); output.push(phase); }
    for (const sub of cfg.subStatuses?.[phaseKey] ?? []) {
      const subKey = sub.trim().toLowerCase();
      if (subKey && !outputKeys.has(subKey)) { outputKeys.add(subKey); output.push(sub); }
    }
  }
  return output;
}

/** True when a stored status is one of this record's manually controlled
 * top-level statuses or phase sub-statuses. Controlled values override the
 * date-derived schedule phase in record summaries. */
export function isConfiguredCustomStatus(value: string, cfg: StageCfg): boolean {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return false;
  if (cfg.custom.some((entry) => entry.trim().toLowerCase() === wanted)) return true;
  return Object.values(cfg.subStatuses ?? {}).some((entries) =>
    entries.some((entry) => entry.trim().toLowerCase() === wanted)
  );
}

/** Add or restore a reusable per-record custom status without disturbing
 * schedule-owned base phases or existing sub-status configuration. */
export function ensureCustomStatusInStageCfg(
  cfg: StageCfg,
  baseOptions: string[],
  value: string,
): StageCfg {
  const name = value.trim();
  if (!name) return cfg;
  const wanted = name.toLowerCase();
  const isBase = baseOptions.some((entry) => entry.trim().toLowerCase() === wanted);
  const existingCustom = cfg.custom.find((entry) => entry.trim().toLowerCase() === wanted);
  const isSubStatus = Object.values(cfg.subStatuses ?? {}).some((entries) =>
    entries.some((entry) => entry.trim().toLowerCase() === wanted)
  );
  const removed = cfg.removed.filter((entry) => entry.trim().toLowerCase() !== wanted);

  if (isBase || isSubStatus) {
    return removed.length === cfg.removed.length ? cfg : { ...cfg, removed };
  }

  const customName = existingCustom ?? name;
  const custom = existingCustom ? cfg.custom : [...cfg.custom, customName];
  const order = cfg.order.some((entry) => entry.trim().toLowerCase() === wanted)
    ? cfg.order
    : [...cfg.order, customName];
  return { ...cfg, order, custom, removed };
}

type TaskLike = Record<string, unknown>;

function localDayTime(day: string, endOfDay = false): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).getTime();
}

function localDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function scheduleTasksFromResponse(value: unknown): TaskLike[] {
  if (Array.isArray(value)) return value as TaskLike[];
  const box = value as { Data?: unknown; data?: unknown } | null;
  return Array.isArray(box?.Data) ? box.Data as TaskLike[] : Array.isArray(box?.data) ? box.data as TaskLike[] : [];
}

export function schedulePhaseNames(value: unknown): string[] {
  const seen = new Set<string>();
  return scheduleTasksFromResponse(value)
    .map((row, index) => ({
      name: String(row.Title ?? row.Alias ?? "").trim(),
      order: Number(row.StageStep ?? row.ItemOrder ?? index) || index,
    }))
    .filter((entry) => entry.name)
    .sort((a, b) => a.order - b.order)
    .filter((entry) => {
      const key = entry.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => entry.name);
}

function taskTime(row: TaskLike, keys: string[], endOfDay = false): number {
  for (const key of keys) {
    const raw = String(row[key] ?? "").trim();
    // Schedule dates are local calendar days. Do not append "Z": that shifts
    // the boundary to the prior local evening in US timezones.
    const day = raw.slice(0, 10);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? localDayTime(day, endOfDay)
      : new Date(raw).getTime();
    if (Number.isFinite(parsed) && new Date(parsed).getUTCFullYear() > 2000) return parsed;
  }
  return NaN;
}

/** Start DAYS ("YYYY-MM-DD") of every dated schedule phase — day STRINGS, not
 *  instants, so the manual-latch display rule (lib/manualStatusLatch) compares
 *  calendar days exactly like the server's auto-advance latch does. */
export function schedulePhaseStartDays(value: unknown): string[] {
  return scheduleTasksFromResponse(value)
    .map((row) => String(row.StartDate ?? "").trim().slice(0, 10))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day > "2000-12-31");
}

/** The currently applicable phase from the same task rows used by Project Detail. */
export function currentSchedulePhase(value: unknown, now = Date.now()): string {
  const rows = scheduleTasksFromResponse(value)
    .map((row, index) => ({
      name: String(row.Title ?? row.Alias ?? "").trim(),
      order: Number(row.StageStep ?? row.ItemOrder ?? index) || index,
      start: taskTime(row, ["StartDate"]),
      end: taskTime(row, ["DueDate", "EndDate"], true),
    }))
    .filter((row) => row.name)
    .sort((a, b) => (Number.isFinite(a.start) ? a.start : Infinity) - (Number.isFinite(b.start) ? b.start : Infinity) || a.order - b.order);
  if (rows.length === 0) return "";
  const active = rows.find((row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.start <= now && now <= row.end);
  if (active) return active.name;
  const upcoming = rows.find((row) => Number.isFinite(row.start) && row.start > now);
  if (upcoming) return upcoming.name;
  return rows[rows.length - 1].name;
}

/**
 * Project Detail does not let a manual status write jump ahead of a scheduled
 * phase. Custom statuses remain writable; only a dated schedule phase (or one
 * of its configured sub-statuses) is blocked before its start calendar day.
 */
export function futureSchedulePhase(
  target: string,
  tasks: unknown,
  cfg: StageCfg,
  now = Date.now(),
): { phase: string; startDay: string } | null {
  const phaseRows = scheduleTasksFromResponse(tasks).map((row, index) => ({
    name: String(row.Title ?? row.Alias ?? "").trim(),
    startDay: String(row.StartDate ?? "").slice(0, 10),
    order: Number(row.StageStep ?? row.ItemOrder ?? index) || index,
  })).filter((row) => row.name).sort((a, b) => a.order - b.order);
  const wanted = target.trim().toLowerCase();
  let phase = phaseRows.find((row) => row.name.toLowerCase() === wanted);
  if (!phase) {
    for (const [parent, subs] of Object.entries(cfg.subStatuses ?? {})) {
      if (subs.some((sub) => sub.trim().toLowerCase() === wanted)) {
        phase = phaseRows.find((row) => row.name.trim().toLowerCase() === parent.trim().toLowerCase());
        break;
      }
    }
  }
  if (!phase || !/^\d{4}-\d{2}-\d{2}$/.test(phase.startDay) || phase.startDay <= "2000-01-01") return null;
  const today = localDayKey(new Date(now));
  return phase.startDay > today ? { phase: phase.name, startDay: phase.startDay } : null;
}