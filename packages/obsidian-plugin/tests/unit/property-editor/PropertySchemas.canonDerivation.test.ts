/**
 * Issue #4056 — the property-editor's status table is DERIVED from the core
 * canon, not a second hand-written copy of the same six UIDs.
 *
 * ⛤ The axis compares against `EFFORT_STATUS_UID` rather than against a literal
 * list: a hand-written expectation here would have to be edited alongside every
 * vocabulary change — reproducing, inside the test, the very restatement the
 * issue is about. Read from the canon, it grows on its own.
 *
 * Revert-verify: restoring a literal `FALLBACK_EFFORT_STATUS_VALUES` turns the
 * membership axis red as soon as the canon and the copy differ by one entry;
 * the label-shape axis stays green in both states.
 */
import { EFFORT_STATUS_UID } from "@kitelev/exocortex-core";
import {
  EFFORT_STATUS_VALUES,
  getStatusLabel,
} from "@plugin/domain/property-editor/PropertySchemas";

describe("Issue #4056: the property-editor table derives from the canon", () => {
  it("carries exactly the canon's UIDs, in the canon's order", () => {
    // The DoD axis for this surface. Order is the dropdown's and is the
    // lifecycle order the canon declares, so it is asserted too.
    expect(EFFORT_STATUS_VALUES.map((v) => v.value)).toEqual(
      Object.values(EFFORT_STATUS_UID).map((uid) => `[[${uid}]]`),
    );
  });

  it("keeps the wikilink and label shapes the editor writes", () => {
    // Canary — green in BOTH states. These strings go into user frontmatter
    // verbatim, so their shape is not free to change while the source does.
    for (const v of EFFORT_STATUS_VALUES) {
      const uid = v.value.slice(2, -2);
      expect(v.wikilink).toBe(`[[${uid}|${v.label}]]`);
      expect(v.label).toMatch(/^[A-Z][A-Za-z]*$/);
    }
  });

  it("still resolves a label for every canon status", () => {
    // Canary — green in BOTH states: the reader on this surface keeps its own
    // output shape (a human label), which the shared normaliser does not give.
    for (const uid of Object.values(EFFORT_STATUS_UID)) {
      expect(getStatusLabel(`[[${uid}]]`)).not.toBe(`[[${uid}]]`);
    }
  });
});
