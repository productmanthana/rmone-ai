/**
 * Assumed-project-length creator-exception check (CI gate, #179).
 * Run: npx tsx scripts/check-duration-override.ts
 *
 * Pins the /new-record duration-override contract, now centralised in
 * resolveAssumedDurationMonths (src/lib/onboarding-defaults.ts):
 *   - creator matching a duration exception → exception months (and the
 *     assumed end date derived from them)
 *   - creator matching no rule → base months
 *   - membership lookup THROWING → base months, resolution still succeeds
 *     (record creation is never blocked by an audience hiccup)
 *   - leads (LEM) are unaffected by duration rules — lookups never run
 *
 * Exit code 0 = all good; 1 = at least one assertion failed.
 */
import {
  BUILTIN_ONBOARDING_DEFAULTS,
  resolveAssumedDurationMonths,
  deriveScheduleDates,
  type OnboardingDefaults,
  type CreatorMembershipLookups,
} from "../src/lib/onboarding-defaults.js";

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL  " + msg); };
const eq = (label: string, got: unknown, want: unknown) => {
  if (got !== want) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// Local mirror of the module's local-time month math (same as check-assumed-dates).
const iso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addMonths = (s: string, months: number): string => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(y, (m - 1) + months, d));
};

// Distinct knob values so a branch reading the wrong setting can't pass by luck.
const BASE_MONTHS = 4;
const EXC_MONTHS = 11;
const ORG_MONTHS = 7;
const D: OnboardingDefaults = {
  ...BUILTIN_ONBOARDING_DEFAULTS,
  durationMonths: BASE_MONTHS,
  projDurationRules: JSON.stringify([
    { ids: ["grp-special"], months: EXC_MONTHS },
    { ids: ["org:div:eng"], months: ORG_MONTHS },
  ]),
};

// Lookup fixtures. Each records whether it was called so we can assert the
// LEM / no-rules fast paths skip membership resolution entirely.
function lookups(opts: {
  groups?: string[] | Error;
  org?: string[] | null | Error;
}): CreatorMembershipLookups & { groupCalls: number; orgCalls: number } {
  const l = {
    groupCalls: 0,
    orgCalls: 0,
    getGroupIds: async () => {
      l.groupCalls++;
      if (opts.groups instanceof Error) throw opts.groups;
      return opts.groups ?? [];
    },
    getOrgAudienceIds: async () => {
      l.orgCalls++;
      if (opts.org instanceof Error) throw opts.org;
      return opts.org ?? null;
    },
  };
  return l;
}

const run = async () => {
  // ── 1. Creator matches a duration exception → exception months ────────────
  {
    const l = lookups({ groups: ["GRP-Special"], org: null }); // case-insensitive
    const r = await resolveAssumedDurationMonths(D, "PMM", "user-1", l);
    eq("group-matched creator uses exception months", r.months, EXC_MONTHS);
    eq("group-matched creator reports matched", r.matched, true);
    // The assumed end date actually derived from those months (route stamps
    // this via createRecordRds → deriveScheduleDates with the overridden defaults).
    const start = "2026-03-02";
    const dates = deriveScheduleDates({ ...D, durationMonths: r.months }, { rawStart: start });
    eq("assumed end = start + exception months", dates.end, addMonths(start, EXC_MONTHS));
  }

  // ── Org-audience sentinel match works too ──────────────────────────────────
  {
    const l = lookups({ groups: [], org: ["org:div:eng"] });
    const r = await resolveAssumedDurationMonths(D, "PMM", "user-1", l);
    eq("org-sentinel creator uses that rule's months", r.months, ORG_MONTHS);
  }

  // ── First matching rule (saved order) wins ─────────────────────────────────
  {
    const l = lookups({ groups: ["grp-special"], org: ["org:div:eng"] });
    const r = await resolveAssumedDurationMonths(D, "PMM", "user-1", l);
    eq("first rule in saved order wins", r.months, EXC_MONTHS);
  }

  // ── 2. Creator matches no rule → base months ───────────────────────────────
  {
    const l = lookups({ groups: ["some-other-group"], org: [] });
    const r = await resolveAssumedDurationMonths(D, "PMM", "user-1", l);
    eq("no-match creator gets base months", r.months, BASE_MONTHS);
    eq("no-match creator reports unmatched", r.matched, false);
    const start = "2026-03-02";
    const dates = deriveScheduleDates({ ...D, durationMonths: r.months }, { rawStart: start });
    eq("assumed end = start + base months", dates.end, addMonths(start, BASE_MONTHS));
  }

  // ── 3. Membership lookup throwing → base months, never throws ──────────────
  {
    const l = lookups({ groups: new Error("boom: groups store down") });
    let r;
    try {
      r = await resolveAssumedDurationMonths(D, "PMM", "user-1", l);
    } catch (e) {
      fail(`group-lookup failure must not throw (got ${String(e)})`);
    }
    if (r) {
      eq("group-lookup failure falls back to base months", r.months, BASE_MONTHS);
      eq("group-lookup failure reports unmatched", r.matched, false);
      if (!r.note) fail("group-lookup failure should carry a diagnostic note");
    }
  }
  // Org-audience failure alone is non-fatal — group matches still count.
  {
    const l = lookups({ groups: ["grp-special"], org: new Error("org chain unreachable") });
    const r = await resolveAssumedDurationMonths(D, "PMM", "user-1", l);
    eq("org failure doesn't lose a group match", r.months, EXC_MONTHS);
    if (!r.note) fail("org failure should carry a diagnostic note");
  }
  {
    const l = lookups({ groups: [], org: new Error("org chain unreachable") });
    const r = await resolveAssumedDurationMonths(D, "PMM", "user-1", l);
    eq("org failure with no group match → base months", r.months, BASE_MONTHS);
  }

  // ── 4. Leads (LEM) are unaffected — lookups never even run ────────────────
  {
    const l = lookups({ groups: ["grp-special"], org: ["org:div:eng"] });
    const r = await resolveAssumedDurationMonths(D, "LEM", "user-1", l);
    eq("LEM create ignores duration rules", r.months, BASE_MONTHS);
    eq("LEM create reports unmatched", r.matched, false);
    eq("LEM create skips group lookup", l.groupCalls, 0);
    eq("LEM create skips org lookup", l.orgCalls, 0);
  }
  // lowercase module name still recognised as LEM
  {
    const l = lookups({ groups: ["grp-special"] });
    const r = await resolveAssumedDurationMonths(D, "lem", "user-1", l);
    eq("lowercase 'lem' also skipped", r.months, BASE_MONTHS);
    eq("lowercase 'lem' skips lookups", l.groupCalls, 0);
  }

  // ── Fast paths: no rules / no user id skip lookups ─────────────────────────
  {
    const l = lookups({ groups: ["grp-special"] });
    const noRules: OnboardingDefaults = { ...D, projDurationRules: "" };
    const r = await resolveAssumedDurationMonths(noRules, "PMM", "user-1", l);
    eq("no rules → base months", r.months, BASE_MONTHS);
    eq("no rules skips lookups", l.groupCalls, 0);
  }
  {
    const l = lookups({ groups: ["grp-special"] });
    const r = await resolveAssumedDurationMonths(D, "PMM", "  ", l);
    eq("blank user id → base months", r.months, BASE_MONTHS);
    eq("blank user id skips lookups", l.groupCalls, 0);
  }
  // Malformed rules JSON is treated as "no rules" (strict parse drops it).
  {
    const l = lookups({ groups: ["grp-special"] });
    const bad: OnboardingDefaults = { ...D, projDurationRules: "{not json" };
    const r = await resolveAssumedDurationMonths(bad, "PMM", "user-1", l);
    eq("malformed rules JSON → base months", r.months, BASE_MONTHS);
  }
};

run().then(() => {
  if (failures > 0) {
    console.error(`\ncheck-duration-override: ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("check-duration-override: all assertions passed");
}).catch((e) => {
  console.error("check-duration-override: unexpected error", e);
  process.exit(1);
});
