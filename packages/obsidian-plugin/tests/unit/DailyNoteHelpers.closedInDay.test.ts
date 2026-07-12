/**
 * DailyNoteHelpers.isEffortClosedInDay — the "closed today" date-match predicate
 * (req b2a33efc / issue #3781). An effort is "closed on the day" iff its
 * ems__Effort_resolutionTimestamp OR ems__Effort_endTimestamp falls within the
 * day's LOCAL-timezone interval. Distinct from isEffortInDay (start/end/planned):
 * a Trashed-only closure (resolution only, no start/end/planned) is caught here.
 *
 * @req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08
 *
 * revert-verify: reverting isEffortClosedInDay to drop the resolutionTimestamp
 * field (or to always return false) → the "resolution on the day" + "Trashed-only
 * closure" assertions go RED; restoring → GREEN.
 *
 * tz-robustness: timestamps are written WITHOUT a timezone suffix
 * ("2026-07-12T12:00:00"), so `new Date(...)` parses them as LOCAL noon — which
 * is inside the LOCAL [00:00, 23:59:59.999] interval the predicate builds, in
 * any runner timezone (no process.env.TZ dependence; jest-timezone rule).
 */

import { DailyNoteHelpers } from "../../src/presentation/renderers/helpers/DailyNoteHelpers";

const DAY = "2026-07-12";
const NOON_ON_DAY = "2026-07-12T12:00:00"; // local noon → inside the local day
const NOON_PREV_DAY = "2026-07-11T12:00:00";

describe("DailyNoteHelpers.isEffortClosedInDay (req b2a33efc / #3781)", () => {
  it("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 matches an effort whose resolutionTimestamp falls on the day", () => {
    expect(
      DailyNoteHelpers.isEffortClosedInDay(
        { ems__Effort_resolutionTimestamp: NOON_ON_DAY },
        DAY,
      ),
    ).toBe(true);
  });

  it("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 matches an effort whose endTimestamp falls on the day (fallback signal)", () => {
    expect(
      DailyNoteHelpers.isEffortClosedInDay(
        { ems__Effort_endTimestamp: NOON_ON_DAY },
        DAY,
      ),
    ).toBe(true);
  });

  it("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 matches a Trashed-only closure (resolution only, no start/end/planned)", () => {
    // DefaultWorkflows: TRASHED sets ONLY resolutionTimestamp — the exact gap
    // isEffortInDay misses (it checks start/end/plannedStart/plannedEnd).
    const trashed = { ems__Effort_resolutionTimestamp: NOON_ON_DAY };
    expect(DailyNoteHelpers.isEffortClosedInDay(trashed, DAY)).toBe(true);
    // sanity: isEffortInDay does NOT see it (no start/end/planned)
    expect(DailyNoteHelpers.isEffortInDay(trashed, DAY)).toBe(false);
  });

  it("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 does NOT match a merely-started effort (start on day, no resolution/end)", () => {
    // startTimestamp on the day is a "touched today" signal, not a closure.
    const started = { ems__Effort_startTimestamp: NOON_ON_DAY };
    expect(DailyNoteHelpers.isEffortClosedInDay(started, DAY)).toBe(false);
    // sanity: isEffortInDay DOES see it (start on day)
    expect(DailyNoteHelpers.isEffortInDay(started, DAY)).toBe(true);
  });

  it("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 does NOT match a plannedEnd on the day (planning, not a closure)", () => {
    expect(
      DailyNoteHelpers.isEffortClosedInDay(
        { ems__Effort_plannedEndTimestamp: NOON_ON_DAY },
        DAY,
      ),
    ).toBe(false);
  });

  it("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 does NOT match a closure on a DIFFERENT day", () => {
    expect(
      DailyNoteHelpers.isEffortClosedInDay(
        { ems__Effort_resolutionTimestamp: NOON_PREV_DAY },
        DAY,
      ),
    ).toBe(false);
  });

  it("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 returns false for no closure timestamps at all", () => {
    expect(DailyNoteHelpers.isEffortClosedInDay({}, DAY)).toBe(false);
  });

  it("returns false for an invalid day string", () => {
    expect(
      DailyNoteHelpers.isEffortClosedInDay(
        { ems__Effort_resolutionTimestamp: NOON_ON_DAY },
        "not-a-day",
      ),
    ).toBe(false);
  });

  it("returns false for an invalid closure timestamp value", () => {
    expect(
      DailyNoteHelpers.isEffortClosedInDay(
        { ems__Effort_resolutionTimestamp: "garbage" },
        DAY,
      ),
    ).toBe(false);
  });
});
