import { useState, type ReactNode } from "react";
import { ShieldCheck, Plus, ArrowLeft } from "lucide-react";
import { CAP_ROWS, NO_CAPS, type Caps } from "@/lib/permissions";
import { buildSuggestedSeed, removeSuggestedOptIn, commitDraftLevel, computeUsedNewLevels } from "@/lib/groupAclPopupModel";

/** One group found in the uploaded staff data that needs a level pick. */
export interface GroupAclGroup {
  /** Display name exactly as written in the file (first occurrence wins). */
  name: string;
  /** How many uploaded people WITHOUT an access level list this group. */
  count: number;
}

/** A level typed in this popup: name + the capability ticks chosen inline. */
export interface NewLevelDraft {
  name: string;
  caps: Caps;
}

const BUILTINS = ["Admin", "Manager", "User"] as const;

/** Conservative default guess from the group's name. Custom levels are never
 *  guessed — admins pick those deliberately. */
function guessLevel(name: string): string {
  if (/admin/i.test(name)) return "Admin";
  if (/(manager|director|lead|principal|head)/i.test(name)) return "Manager";
  return "User";
}

/**
 * Mandatory popup shown while importing staff when the file has Groups but
 * some people have no Access Level. One pick per group, rendered as
 * lightweight selection cards: the built-in levels, this tenant's custom
 * access levels, and any NEW level defined right here ("+ New level" opens a
 * mini form: name + the same capability ticks as Settings → Access Levels).
 * New levels are really created (with those ticks) on confirm; until then a
 * ✕ on their chip removes them again — groups pointing at a removed level
 * fall back to the name-based guess. Confirming fills the empty Access Level
 * cells (values already in the file always win); Back returns to the grid
 * without importing. Deliberately NOT closable via backdrop click — it is a
 * required decision gate, not an info dialog.
 */
export default function GroupAccessLevelPopup({
  groups,
  customLevels,
  suggestedLevels,
  onConfirm,
  onCancel,
  onBack,
  title,
  intro,
  countLabel,
  confirmLabel,
  embedded,
}: {
  groups: GroupAclGroup[];
  /** Tenant-defined custom access level names (Settings → Access Levels). */
  customLevels: string[];
  /** Level names found in the FILE's Access Level column that don't exist
   *  yet. Seeded as pre-made "will be created" drafts (default caps: edit
   *  non-financial data) — the ✕ on a chip opts one out again; still-listed
   *  ones are returned in newLevels even when no group picks them. */
  suggestedLevels?: string[];
  /** picks: lowercased group name → chosen level display name.
   *  newLevels: levels defined here that were actually picked — the caller
   *  creates them (with their caps) BEFORE applying. May return a promise;
   *  while it's pending the popup shows a busy state, and if the caller
   *  declines to close it (create failed) the user can simply retry. */
  onConfirm: (picks: Record<string, string>, newLevels: NewLevelDraft[]) => void | Promise<void>;
  /** "Back to editing" — abandons the upload flow and returns to the grid. */
  onCancel: () => void;
  /** Present → a second "← Back" button (far left) returns to the PREVIOUS
   *  wizard step (fix issues / review matches) instead of the grid. */
  onBack?: () => void;
  /** Override the header title (default: staff-import wording). */
  title?: string;
  /** Override the explainer paragraph body (default: staff-import wording). */
  intro?: ReactNode;
  /** Override the per-group count caption (default "N people to fill"). */
  countLabel?: (count: number) => string;
  /** Override the confirm button label (default "Apply & continue"). */
  confirmLabel?: string;
  /**
   * When true the outer `fixed inset-0` backdrop is omitted — the caller
   * (e.g. ImportWizardOverlay) provides the full-screen context itself.
   */
  embedded?: boolean;
}) {
  // File-detected level names that truly don't exist yet — deduped
  // case-insensitively (first casing wins) and checked against built-ins and
  // customs, so case-variants can never seed two colliding drafts.
  // (Pure logic lives in lib/groupAclPopupModel.ts — unit-tested there.)
  const suggestedSeed = buildSuggestedSeed(suggestedLevels, customLevels, BUILTINS);
  // LIVE opt-in tracking: ✕ on a suggested chip deletes it here too, so
  // apply() only auto-creates levels the user left in place. (An immutable
  // "was ever suggested" check would wrongly resurrect a same-named draft
  // typed later via + New level, which must follow the picked-only rule.)
  const [optedInSuggested, setOptedInSuggested] = useState<Set<string>>(
    () => new Set(suggestedSeed.map(n => n.toLowerCase())),
  );
  const hadSuggestions = suggestedSeed.length > 0;
  // Levels defined in this popup session (offered on every card once added) —
  // pre-seeded with the file-detected ones so the user only has to confirm.
  const [created, setCreated] = useState<NewLevelDraft[]>(
    () => suggestedSeed.map(name => ({ name, caps: { ...NO_CAPS, editData: true } })),
  );
  const createdNames = new Set(created.map(c => c.name));
  // Deduped case-insensitively, first occurrence wins (built-in > tenant
  // custom > draft). After Create & continue succeeds, the parent refreshes
  // customLevels while the drafts are still mounted for a beat — without the
  // dedupe each just-created level renders twice (duplicate React keys,
  // seen in a live session Aug 2026).
  const levels: string[] = [];
  {
    const seenLvl = new Set<string>();
    for (const n of [
      ...BUILTINS,
      ...customLevels.map(n => n.trim()).filter(Boolean),
      ...created.map(c => c.name),
    ]) {
      const key = n.toLowerCase();
      if (seenLvl.has(key)) continue;
      seenLvl.add(key);
      levels.push(n);
    }
  }
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map(g => [g.name.toLowerCase(), guessLevel(g.name)])),
  );
  // "+ New level" mini form: which group card is typing, the draft name, and
  // the capability ticks (default: can edit non-money data, nothing else —
  // same default a popup-created level used to get silently).
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftCaps, setDraftCaps] = useState<Caps>({ ...NO_CAPS, editData: true });
  const [busy, setBusy] = useState(false);

  const openAdd = (k: string) => {
    setAddingFor(k);
    setDraft("");
    setDraftCaps({ ...NO_CAPS, editData: true });
  };

  const commitNew = (k: string) => {
    setAddingFor(null);
    setDraft("");
    // Same name already on offer (built-in, tenant custom, or typed a moment
    // ago) → existing one is selected instead of minting a duplicate. A
    // same-named draft after a ✕-removed suggestion does NOT resurrect the
    // opt-in — it only lands via the picked-only rule (model is unit-tested).
    const { created: nextCreated, pick } = commitDraftLevel(levels, created, draft, { ...draftCaps });
    if (!pick) return;
    if (nextCreated !== created) setCreated(nextCreated);
    setPicks(p => ({ ...p, [k]: pick }));
  };

  // "Added it, changed my mind" — remove a popup-defined level right here.
  // Any group pointing at it falls back to the name-based guess.
  const removeCreated = (name: string) => {
    setCreated(c => c.filter(x => x.name !== name));
    // Suggested chip? Drop its live opt-in too — ✕ must mean "don't create",
    // even if a same-named draft is typed later via + New level.
    setOptedInSuggested(prev => removeSuggestedOptIn(prev, name));
    setPicks(p => {
      const next = { ...p };
      for (const g of groups) {
        const k = g.name.toLowerCase();
        if (next[k] === name) next[k] = guessLevel(g.name);
      }
      return next;
    });
  };

  const apply = () => {
    // Levels picked for a group get created, and so do file-detected ones the
    // user left in place (their rows carry the name directly) — but a draft
    // typed then never used is discarded, so no junk levels land in Settings.
    const usedNew = computeUsedNewLevels(created, picks, optedInSuggested);
    setBusy(true);
    Promise.resolve(onConfirm(picks, usedNew)).finally(() => setBusy(false));
  };

  const inner = (
      <div
        /* Embedded (wizard step): cap height against the viewport minus the
           wizard chrome (top bar + headline) so with MANY groups the list
           scrolls INSIDE the card and the footer buttons stay pinned in
           view — the wizard page itself must never need scrolling to reach
           Create & continue. Standalone popup keeps the old 75vh cap. */
        className={`bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 flex flex-col gap-4 ${embedded ? "max-h-[calc(100vh-190px)]" : "max-h-[75vh]"}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">{title ?? "Set an access level for each group"}</h2>
            <p className="text-xs text-gray-500 mt-1">
              {intro ?? <>
                Some people in this upload have groups but no access level. Pick a level per group and
                their empty Access Level cells are filled automatically. Levels already in the file are
                kept. If someone is in several groups, the highest level wins
                (Admin &gt; Manager &gt; custom levels &gt; User); people with no groups stay User.
                Need a level that doesn&apos;t exist yet? Use <span className="font-semibold">+ New level</span> —
                name it, tick what it can do, and it is created under Settings → Access Levels
                automatically. Added one by mistake? Remove it with the ✕ on its chip.
              </>}
            </p>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 space-y-2.5 -mx-1 px-1">
          {hadSuggestions && (() => {
            // File-detected levels still opted in (✕ removes the draft AND
            // its opt-in). Section stays visible after all are removed so the
            // "nothing will be created" state is explicit — and it shows even
            // with no groups to fill (the levels-only wizard step).
            const pending = created.filter(c => optedInSuggested.has(c.name.trim().toLowerCase()));
            return (
              <div className="rounded-lg border border-[#6BA539]/50 bg-[#fafdf6] p-3">
                <div className="text-sm font-semibold text-gray-800">New access levels in this file</div>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                  The Access Level column uses {pending.length === 1 ? "a level name" : "level names"} that
                  {pending.length === 1 ? " doesn't" : " don't"} exist yet. Anything listed below is created
                  automatically when you continue — members can edit non-financial data to start, and you can
                  fine-tune abilities anytime in Settings → Access Levels. A typo? Remove it with ✕ and its rows
                  keep the text exactly as written in the file.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {pending.map(c => (
                    <span
                      key={c.name}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg border border-[#6BA539] bg-[#f2f8e9] text-xs font-semibold text-[#4a7326]"
                    >
                      {c.name}
                      <span className="ml-1 text-[10px] font-normal opacity-70">will be created</span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Don't create level ${c.name}`}
                        title="Don't create this level"
                        onClick={() => removeCreated(c.name)}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); removeCreated(c.name); }
                        }}
                        className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] leading-none text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                      >✕</span>
                    </span>
                  ))}
                  {pending.length === 0 && (
                    <span className="text-[11px] text-gray-400">
                      All removed — nothing new will be created; those cells import as typed.
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
          {groups.map(g => {
            const k = g.name.toLowerCase();
            return (
              <div key={k} className="rounded-lg border border-gray-200 p-3">
                <div className="text-sm font-semibold text-gray-800">
                  {g.name}
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {countLabel ? countLabel(g.count) : `${g.count.toLocaleString()} ${g.count === 1 ? "person" : "people"} to fill`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                  {levels.map(lvl => {
                    const sel = picks[k] === lvl;
                    const isNew = createdNames.has(lvl);
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setPicks(p => ({ ...p, [k]: lvl }))}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                          sel
                            ? "border-[#6BA539] bg-[#f2f8e9] text-[#4a7326]"
                            : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {lvl}
                        {isNew && (
                          <span className="ml-1 text-[10px] font-normal opacity-70">new</span>
                        )}
                        {isNew && (
                          /* Chip is a <button>; inner affordance must NOT be
                             a nested button (hydration error) — span[role=button]. */
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={`Remove level ${lvl}`}
                            title="Remove this new level"
                            onClick={e => { e.stopPropagation(); removeCreated(lvl); }}
                            onKeyDown={e => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault(); e.stopPropagation(); removeCreated(lvl);
                              }
                            }}
                            className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full align-middle text-[10px] leading-none text-gray-400 hover:text-red-600 hover:bg-red-50"
                          >
                            ✕
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {addingFor !== k && (
                    <button
                      type="button"
                      onClick={() => openAdd(k)}
                      className="px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-xs font-semibold text-gray-500 hover:border-[#6BA539] hover:text-[#4a7326] inline-flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> New level
                    </button>
                  )}
                </div>

                {addingFor === k && (
                  <div className="mt-2 rounded-lg border border-[#6BA539] bg-[#fafdf6] p-2.5">
                    <input
                      autoFocus
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") { e.preventDefault(); commitNew(k); }
                        if (e.key === "Escape") { setAddingFor(null); setDraft(""); }
                      }}
                      placeholder="New level name"
                      maxLength={80}
                      className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-xs outline-none focus:border-[#6BA539] bg-white"
                    />
                    <div className="grid grid-cols-2 gap-1.5 mt-2">
                      {CAP_ROWS.map(c => {
                        const on = draftCaps[c.key];
                        return (
                          <label
                            key={c.key}
                            title={c.hint}
                            className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium cursor-pointer select-none transition-colors ${
                              on
                                ? "border-[#6BA539] bg-[#f2f8e9] text-[#4a7326]"
                                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => setDraftCaps(p => ({ ...p, [c.key]: !p[c.key] }))}
                              className="w-3.5 h-3.5 accent-[#6BA539] flex-shrink-0"
                            />
                            {c.label}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1.5">
                      Tick what this level can do — everyone can always view. Fine-tune later in
                      Settings → Access Levels.
                    </p>
                    <div className="flex justify-end gap-1.5 mt-2">
                      <button
                        type="button"
                        onClick={() => { setAddingFor(null); setDraft(""); }}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => commitNew(k)}
                        disabled={!draft.trim()}
                        className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: "#6BA539" }}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-1 flex-shrink-0">
          {onBack && (
            <button
              onClick={onBack}
              disabled={busy}
              title="Go back to the previous step"
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onCancel}
            disabled={busy}
            title="Leave the upload flow and return to the grid"
            className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            Back to editing
          </button>
          <button
            onClick={apply}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: "#6BA539" }}
          >
            {busy ? "Applying…" : (confirmLabel ?? "Apply & continue")}
          </button>
        </div>
      </div>
  );
  if (embedded) return inner;
  return (
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-4">
      {inner}
    </div>
  );
}
