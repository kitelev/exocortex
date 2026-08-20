/**
 * Issue #4056 — one canon for the `ems__Effort_status` vocabulary.
 *
 * Three readers parsed the same vocabulary independently, and TWO of them held
 * their own copy of the same six UIDs (`STATUS_UID_BY_ENUM` in
 * `GroundingExecutor`, `FALLBACK_EFFORT_STATUS_VALUES` in the plugin's
 * `PropertySchemas`). Both had to be hand-edited when `ToDo` and `Analysis`
 * were deleted from `exoas-public` on 2026-08-13 — the drift point had already
 * fired once, and nothing made the third reader visible to that migrator.
 *
 * ⛤ The load-bearing axis is the one on the SOURCE, not on any single value
 * shape: the readers mostly AGREE today, so per-shape axes pass against three
 * independent implementations too. Only "a status added to the canon appears in
 * the derived table" tells one design from the other.
 *
 * Revert-verify: restoring a literal table in either consumer turns the
 * derivation axes RED; the shape axes stay GREEN in both states.
 */
import { EffortStatus } from "../../../../src/domain/constants/EffortStatus";
import {
  EFFORT_STATUS_UID,
  EFFORT_STATUS_BY_UID,
  normalizeEffortStatus,
} from "../../../../src/domain/constants/EffortStatusCanon";
import { STATUS_UID_BY_ENUM } from "../../../../src/services/GroundingExecutor";

const DONE_UID = "7b9b3116-7c3c-438c-9618-94fe301320a6";

describe("Issue #4056: the effort-status canon", () => {
  describe("one source", () => {
    it("the workflow table IS the canon, not a copy of it", () => {
      // The DoD axis. A literal re-declaration in GroundingExecutor makes this
      // red the moment the two drift by a single entry — and identity makes
      // drift impossible rather than merely detectable.
      expect(STATUS_UID_BY_ENUM).toBe(EFFORT_STATUS_UID);
    });

    it("the inverse is derived, so the two directions cannot disagree", () => {
      for (const [symbol, uid] of Object.entries(EFFORT_STATUS_UID)) {
        expect(EFFORT_STATUS_BY_UID[uid]).toBe(symbol);
      }
      expect(Object.keys(EFFORT_STATUS_BY_UID)).toHaveLength(
        Object.keys(EFFORT_STATUS_UID).length,
      );
    });

    it("covers every member of the EffortStatus enum", () => {
      // Guards the other direction: a status added to the enum without a UID
      // would silently have no table entry, and every reader would fail to
      // resolve it.
      for (const value of Object.values(EffortStatus)) {
        expect(typeof EFFORT_STATUS_UID[value]).toBe("string");
      }
    });
  });

  describe("normalizeEffortStatus reads every legal shape", () => {
    it.each([
      ["symbolic", "[[ems__EffortStatusDone]]"],
      ["bare UID", `[[${DONE_UID}]]`],
      ["UID with a symbolic alias", `[[${DONE_UID}|ems__EffortStatusDone]]`],
      ["UID with an arbitrary alias", `[[${DONE_UID}|Done]]`],
      ["space-form", `[[ems__EffortStatusDone ${DONE_UID}]]`],
      ["quoted", `"[[${DONE_UID}]]"`],
      ["one-element list", null],
    ])("%s", (_name, input) => {
      const value = input ?? [`[[${DONE_UID}]]`];
      expect(normalizeEffortStatus(value)).toBe(EffortStatus.DONE);
    });

    it("returns null for a MULTI-element list rather than guessing", () => {
      // Picking a first would silently contradict whichever value the UI shows.
      // What null MEANS stays with the caller — a refusal for a transition, an
      // unknown for a display matcher.
      expect(
        normalizeEffortStatus([
          `[[${DONE_UID}]]`,
          "[[ems__EffortStatusDoing]]",
        ]),
      ).toBeNull();
    });

    it.each([
      ["absent", undefined],
      ["null", null],
      ["empty", "[[]]"],
      ["alias only", "[[|Done]]"],
      ["unknown UID", "[[00000000-0000-4000-8000-000000000000]]"],
      ["not a status at all", "[[ems__Task]]"],
    ])("returns null when the value is %s", (_name, input) => {
      expect(normalizeEffortStatus(input)).toBeNull();
    });
  });
});
