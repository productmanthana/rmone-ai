/**
 * Z — the app's single documented z-index layering scheme.
 *
 * WHY THIS EXISTS: the app mixes hand-built fixed-div overlays with
 * Radix/shadcn dialogs. Radix dialogs lock pointer-events on <body> while
 * open — if a dialog ever renders BEHIND a custom overlay, the whole page
 * looks frozen (this shipped to production once). Every overlay must take
 * its z-index from here instead of an ad-hoc inline number, so any dialog
 * always beats its opener.
 *
 * BAND MAP (low → high):
 *   25–50        menus, dropdowns, sticky headers (component-local; not here)
 *   900          page-level anchored menus that must beat sticky grid chrome
 *   1000–1300    standard page modals + their nested children/menus/toasts
 *   2000–2001    page-level overlays above the standard modal band
 *   9000–9500    full-height drawers / wizard overlays + their sub-modals
 *   9900–9990    grid internals (import grid chrome, org popups)
 *   9999–10050   detail / risk / info popups (open above drawers and grids)
 *   10500        always-on-top edit modals (EditStaffModal + staff
 *                sub-overlays — must stay ABOVE the Radix invite members
 *                dialog, which stays z-50 and modal={false}; see
 *                .agents/memory/radix-dialog-stacked-portals.md)
 *   11000        Radix AlertDialog confirms (Tailwind z-[11000] in
 *                ui/alert-dialog.tsx) — beat EVERY custom opener below
 *   11999–12000  topmost table popovers
 *   90000        full-screen loaders
 *   99999        imperative DOM-appended toasts
 *   100000       splash screen + DateField popover (date pickers open
 *                inside any modal, so they must beat everything modal)
 *   100050       Radix toast viewport (Tailwind z-[100050] in ui/toast.tsx)
 *   200000       new-version banner — beats absolutely everything
 *
 * RULES:
 * 1. Anything that can be OPENED FROM another popup must use a band
 *    strictly above its opener's band. A z-TIE resolves by DOM mount order
 *    and hides the child behind the opener.
 * 2. Radix Dialog (ui/dialog.tsx) stays z-50: it must remain BELOW the
 *    staff edit band (10500) for the invite-members stacking to work.
 *    Never open a plain Dialog from inside a custom overlay — use
 *    AlertDialog (z 11000) for confirms, or a custom overlay from a
 *    higher band.
 * 3. New overlays: pick the semantic band, don't invent a number. Small
 *    within-band offsets (+1 backdrop/menu pairs) are expressed as
 *    Z.X ± n at the call site only when the pair lives in one component.
 * 4. Tailwind-classed layers (alert-dialog 11000, toast 100050, dialog 50)
 *    can't reference these constants in class strings — their values are
 *    mirrored here (Z.CONFIRM, Z.TOAST) and must stay in lockstep.
 */
export const Z = {
  /** Page-level anchored menus above sticky grid chrome. */
  PAGE_MENU: 900,
  /** Standard page modal overlay. */
  MODAL: 1000,
  /** Menu / popover opened from inside a standard modal. */
  MODAL_MENU: 1001,
  /** First-level child modal nested inside a standard modal. */
  MODAL_CHILD: 1100,
  /** Second-level child modal / heavier page modals. */
  MODAL_CHILD_2: 1200,
  /** Toast/badge floated above the standard modal band. */
  MODAL_TOAST: 1300,
  /** Page overlay that must beat the whole standard modal band. */
  PAGE_OVERLAY: 2000,
  /** Popup opened from a PAGE_OVERLAY. */
  PAGE_OVERLAY_POPUP: 2001,
  /** Full-height drawers and wizard overlays (Change Lifecycle etc.). */
  DRAWER: 9000,
  /** Menu opened from inside a drawer. */
  DRAWER_MENU: 9001,
  /** Sub-modal opened from a drawer (e.g. lifecycle apply). */
  DRAWER_SUB: 9100,
  /** Backdrop for pickers opened from drawer sub-content. */
  DRAWER_PICKER_BACKDROP: 9190,
  /** Picker dropdowns opened from drawer sub-content. */
  DRAWER_PICKER: 9200,
  /** Alert popups above the drawer band (e.g. BU mismatch). */
  DRAWER_ALERT: 9300,
  /** Non-interactive tips floated above drawers + their sub-modals. */
  DRAWER_TIP: 9500,
  /** Grid-internal chrome (import grid overlays). */
  GRID: 9900,
  /** Grid overlay layer. */
  GRID_OVERLAY: 9950,
  /** Backdrop for popups launched from grid cells. */
  GRID_POPUP_BACKDROP: 9960,
  /** Popups launched from grid cells. */
  GRID_POPUP: 9990,
  /** Detail / risk / info popups — above drawers and grids. */
  POPUP: 9999,
  /** Popup opened from a POPUP (or audience popovers etc.). */
  POPUP_CHILD: 10000,
  /** Second-level popup child. */
  POPUP_CHILD_2: 10001,
  /** Topmost popup layer within the popup band. */
  POPUP_TOP: 10050,
  /** Always-on-top edit modals (EditStaffModal + staff sub-overlays). */
  EDIT_MODAL: 10500,
  /** Radix AlertDialog confirms — mirrored as z-[11000] in ui/alert-dialog.tsx. */
  CONFIRM: 11000,
  /** Backdrop for the topmost table popovers. */
  TOP_POPOVER_BACKDROP: 11999,
  /** Topmost table popovers (SimpleTeamTable range editor). */
  TOP_POPOVER: 12000,
  /** Full-screen loaders. */
  FULLSCREEN_LOADER: 90000,
  /** Imperative document.body-appended toasts (style.zIndex needs String()). */
  DOM_TOAST: 99999,
  /** Splash screen + DateField popover — beats every modal band. */
  SPLASH: 100000,
  /** Radix toast viewport — mirrored as z-[100050] in ui/toast.tsx. */
  TOAST: 100050,
  /** New-version banner — beats absolutely everything. */
  BANNER: 200000,
} as const;
