# Mobile Smoke Release Checklist

Ten-minute manual smoke test on a real iPhone (or Android) before publishing a
major release of the Exocortex Obsidian plugin.

GitHub Actions runs Electron desktop E2E. It does **not** cover iOS/Android
WebView CSS, touch targets, or on-screen-keyboard layout. Automated mobile
coverage (Playwright Mobile web, BrowserStack) is out of scope — budget = $0/mo.
This 10-minute manual pass is the cheapest way to catch real-device regressions
before they ship.

> Reference: see also
> [Testing Best Practices](./TESTING.md) for the automated suite that
> precedes this manual pass.

## Setup (≈1 min)

- [ ] iPhone with the latest App Store Obsidian build installed
- [ ] Test vault available on device (Obsidian Sync or AirDrop/Files copy)
- [ ] Plugin under test is present in `<vault>/.obsidian/plugins/exocortex/`
      and enabled in **Settings → Community plugins**
- [ ] AssetSpaces bootstrapped (Areas/Projects/Tasks ontology available)
- [ ] Dataview plugin installed and enabled (required for the Daily Tasks
      widget on daily notes)
- [ ] At least one `ems__Area` asset exists (e.g. `Life`)
- [ ] Familiar with toggling **Reading Mode** on mobile
      (ellipsis menu → Reading view). Exocortex layouts render only in
      Reading Mode.
- [ ] Plugin version under test: `x.y.z` ____________
- [ ] Device: iPhone model ____ · iOS ____ · Obsidian mobile ____

## Journey 1 — Create Project + Child Task (≈3 min)

1. Open an Area note in Reading Mode.
2. Tap **Create Project** in the Commands panel.
   - Expected: Input modal opens with the on-screen keyboard.
3. Enter name `Smoke test project <YYYY-MM-DD>` and submit (tap the primary
   button; Enter on the keyboard does **not** submit this modal).
   - Expected: a new Project file is created; Reading Mode re-renders.
4. On the new Project, tap **Create Child Task**.
5. Enter name `Smoke task 1` and submit.
   - Expected: the new Task file appears; the Project's Asset Relations
     table lists the task row without a manual refresh.

Pass checks:

- [ ] Input modal submit button is reachable above the on-screen keyboard
- [ ] Created files appear without force-closing and re-opening the note
- [ ] Buttons respond on the first tap (no ghost taps / no double-tap needed)
- [ ] No uncaught `exocortex` exceptions in the mobile debugger, if accessible

## Journey 2 — Change Task Status (≈2 min)

1. Open the task created in Journey 1 in Reading Mode.
2. Tap the **Set Status** command (or the status field in the status panel).
   - Expected: Input modal opens listing status values.
3. Pick `ems__EffortStatusDoing` and submit.
   - Expected: status row visibly updates to Doing within ~1 s;
     frontmatter gains `ems__Effort_startTimestamp`.
4. Repeat and pick `ems__EffortStatusDone`.
   - Expected: status flips to Done; frontmatter gains
     `ems__Effort_endTimestamp`.

Pass checks:

- [ ] Both `ems__Effort_status` and the matching timestamp are written
- [ ] UI re-renders without closing/re-opening the file
- [ ] Dropdown/Input modal is readable at default mobile text size

## Journey 3 — Browse AssetRelationsTable (≈3 min)

1. Open an Area with at least five children in Reading Mode.
2. Scroll the Asset Relations table vertically with your finger.
   - Expected: smooth scroll, sticky header row, no page-level bouncing.
3. Tap a column header to sort.
   - Expected: indicator ▲/▼ toggles; rows reorder.
4. Tap an asset label in a row.
   - Expected: target asset opens in Reading Mode (follows the Obsidian
     mobile navigation setting for in-place vs new pane).
5. Swipe / tap back to the Area.

Pass checks:

- [ ] Labels and identifiers readable without horizontal scroll
- [ ] Row tap target ≥ 44 × 44 pt (Apple HIG) — tap should land on the
      intended row
- [ ] No layout shift while scrolling (header does not jump)
- [ ] Area renders in ≤ 3 s from tap to usable table

## Rollback Criteria — Blockers

Any of the following **blocks the release** and must be fixed before publish:

- Action button fails to open its modal (dead zone, modal off-screen,
  submit button hidden by keyboard)
- Status change does not write to frontmatter (silent failure)
- AssetRelationsTable fails to render, crashes Obsidian mobile, or makes
  scrolling unusable (stuck, jumpy, renders < 5 rows)
- Obsidian mobile console shows uncaught exceptions from the `exocortex`
  bundle

Soft issues (note, do not block): minor theme-colour clashes, sub-pixel
alignment, slow but functional rendering in 3–5 s on older devices.

## Reporting

Record results in the release PR description or GitHub release notes:

- Plugin version: `x.y.z`
- Device: iPhone model / iOS version
- Obsidian mobile version
- Total time taken (target ≤ 10 min)
- Pass / fail per journey, plus notes on anything marginal

If anything fails:

1. Open a GitHub issue with label `mobile-smoke-regression`.
2. Link the failing journey step here (e.g. `Journey 2 step 3`).
3. Attach a short screen recording if feasible.
4. Do **not** merge the release PR until the regression is resolved or
   explicitly accepted.

## Screenshots (optional)

Drop reference screenshots into
`packages/obsidian-plugin/docs/images/mobile-smoke/` and link them from the
relevant journey step, e.g.:

```
![Journey 1 – Create Project modal](./images/mobile-smoke/j1-create-project-modal.png)
```

Screenshots help when the UI changes — diff against the last release's
images to spot visual regressions before running the live test.

## Why 10 minutes

Longer checklists get skipped under release pressure. Three journeys exercise
the majority of mobile-specific surface: Commands panel, Input modals,
status writes, and AssetRelationsTable scroll/sort/tap. Everything else is
covered by the desktop E2E and unit suites (`npm run test:all`).
