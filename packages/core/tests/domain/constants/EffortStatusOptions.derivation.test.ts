/**
 * @req:355d9379-ed7b-4241-9ce7-0af955653127 — the dropdown list is DERIVED from
 * the canon, not restated beside it (issue #4121).
 *
 * The neighbouring `EffortStatusOptions.test.ts` locks the CONTENT (six entries,
 * `Draft` / `Doing` / `Done` present). It cannot lock the DERIVATION: restate the
 * six literals and every one of its axes stays green, because the content is
 * identical — which is exactly how this table drifted before. When `ToDo` and
 * `Analysis` were deleted from `exoas-public` (2026-08-13) the same six UIDs had
 * to be hand-edited in FOUR places; #4056 folded two into the canon and left this
 * one named as the remainder.
 *
 * ⛔ Content axes cannot substitute for these. `toHaveLength(6)` reds when the
 * canon grows — and the natural repair is to bump the 6, which restores green
 * WITHOUT restoring the link. Only an axis that reads the canon can tell the two
 * repairs apart.
 */
import { EFFORT_STATUS_UID } from "../../../src/domain/constants/EffortStatusCanon";
import { EFFORT_STATUS_OPTIONS } from "../../../src/domain/constants";

describe("@req:355d9379-ed7b-4241-9ce7-0af955653127 EFFORT_STATUS_OPTIONS derives from the canon", () => {
  it("carries exactly the canon's symbols, in the canon's order", () => {
    expect(EFFORT_STATUS_OPTIONS.map((o) => o.value)).toEqual(
      Object.keys(EFFORT_STATUS_UID).map((s) => `[[${s}]]`),
    );
  });

  it("still offers a label for every canon status", () => {
    // The tail-of-symbol mapping must cover the whole canon, not most of it —
    // a status whose label came out empty would render as a blank dropdown row.
    for (const symbol of Object.keys(EFFORT_STATUS_UID)) {
      const entry = EFFORT_STATUS_OPTIONS.find(
        (o) => o.value === `[[${symbol}]]`,
      );
      expect(entry).toBeDefined();
      expect(entry?.label.length).toBeGreaterThan(0);
    }
  });

  it("⛔ keeps the SYMBOLIC value form — deriving is not the UUID migration", () => {
    // The file header defers UUID-canon values to a coordinated
    // NoteToRDFConverter + starter-kit ASK migration. Deriving from a canon that
    // is KEYED by symbol must not smuggle that migration in.
    for (const o of EFFORT_STATUS_OPTIONS) {
      expect(o.value).toMatch(/^\[\[ems__EffortStatus[A-Za-z]+\]\]$/);
    }
  });
});
