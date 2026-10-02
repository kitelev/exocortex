import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { isEpisodeOngoing } from "../../../src/domain/display-name/hostFunctions";
import { installFakeOffsetDate } from "../../helpers/installFakeOffsetDate";

/**
 * req 0fc2c853 — a `life__Episode` with INSTANT bounds (`life__Episode_startTimestamp` /
 * `_endTimestamp`) is ongoing only INSIDE the interval; the DAY-bounded reading of req 8a47ff93
 * is left exactly as it was.
 *
 * ⛤ The clock is fixed at LOCAL `2026-08-10T02:00:00` in a simulated UTC+5 zone, which is
 * `2026-08-09T21:00:00Z`. Two properties of that choice are load-bearing and neither is
 * decoration:
 *
 *  - the LOCAL day (10th) and the UTC day (9th) DIFFER, so an implementation that built "now"
 *    from the UTC getters would misjudge every interval on the local day — without that
 *    separation the suite would pass in a UTC runner with OR without the local basis
 *    ([[jest-timezone-sensitive-tests]]);
 *  - 02:00 local leaves room for an interval EARLIER today (00:00–01:00) and one LATER today
 *    (05:00–06:00) **on the same calendar day**, which is the only shape that distinguishes the
 *    interval reading from the day-truncating one. An interval on another day proves nothing:
 *    both readings agree there.
 *
 * ⛔ Every axis below asserts a DIRECT verdict of the predicate rather than a rendered string.
 * The composition of the two display specs is a separate, production-shape axis and lives in
 * `PrintNameRuleService.episodeOngoing.test.ts` — this file is the value-form matrix, which a
 * rendering surface cannot cover: the forms come from the YAML parser, not from the template.
 */
const FIXED_INSTANT = "2026-08-09T21:00:00Z";
const OFFSET_HOURS = 5;
const REQ = "@req:0fc2c853-b292-45e7-aa85-cf9091bd3032";

function episode(props: Record<string, unknown>): Record<string, unknown> {
  return { exo__Asset_label: "Перелёт Алматы—Новосибирск", ...props };
}

describe(`hostFunctions.isEpisodeOngoing — INSTANT bounds [req 0fc2c853]`, () => {
  let restoreDate: () => void;

  beforeEach(() => {
    restoreDate = installFakeOffsetDate(OFFSET_HOURS, FIXED_INSTANT);
    // Guard: the simulated zone is live AND local/UTC name different days. A broken fake would
    // otherwise make the whole matrix pass vacuously.
    expect(new Date().getFullYear()).toBe(2026);
    expect(new Date().getDate()).toBe(10); // LOCAL day
    expect(new Date().getUTCDate()).toBe(9); // UTC day — deliberately different
    expect(new Date().getHours()).toBe(2); // LOCAL hour, mid-day room on both sides
  });

  afterEach(() => restoreDate());

  it(`[E1] ${REQ} an interval CONTAINING now is ongoing`, () => {
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: "2026-08-10T01:30:00",
          life__Episode_endTimestamp: "2026-08-10T03:00:00",
        }),
      ),
    ).toBe(true);
  });

  it(`[E2] ${REQ} an interval EARLIER TODAY is NOT ongoing — the whole point of the req`, () => {
    // Both bounds collapse to "2026-08-10" = today, so the day-truncating reading calls this
    // ongoing and 📍 burns from midnight to midnight. This axis is the RED anchor.
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: "2026-08-10T00:00:00",
          life__Episode_endTimestamp: "2026-08-10T01:00:00",
        }),
      ),
    ).toBe(false);
  });

  it(`[E3] ${REQ} an interval LATER TODAY is NOT ongoing`, () => {
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: "2026-08-10T05:00:00",
          life__Episode_endTimestamp: "2026-08-10T06:00:00",
        }),
      ),
    ).toBe(false);
  });

  it(`[E4] ${REQ} the START boundary is INCLUSIVE — an episode beginning exactly now counts`, () => {
    // The equality point is REACHABLE by construction: the clock is fixed and the fixture names
    // the same second, so a `>` / `>=` flip is observable rather than measure-zero
    // ([[integration-test-revert-verify]] §A65).
    //
    // ⛤ Split from the END boundary deliberately. Held as one axis, the two mutants that flip the
    // two comparisons produced the SAME single red key, so the matrix could not show that both
    // conjuncts were locked ([[integration-test-revert-verify]] §A110).
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: "2026-08-10T02:00:00",
          life__Episode_endTimestamp: "2026-08-10T09:00:00",
        }),
      ),
    ).toBe(true);
  });

  it(`[E16] ${REQ} the END boundary is INCLUSIVE — an episode finishing exactly now still counts`, () => {
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: "2026-08-10T00:00:00",
          life__Episode_endTimestamp: "2026-08-10T02:00:00",
        }),
      ),
    ).toBe(true);
  });

  it(`[E5] ${REQ} an OPEN interval (startTimestamp, no endTimestamp) is ongoing — the shape of the one live carrier`, () => {
    // `818179d5` ("Заклинило шею") is exactly this shape: a startTimestamp and no end. Same
    // "you forgot to close this" reading the open DAY period carries.
    expect(
      isEpisodeOngoing(episode({ life__Episode_startTimestamp: "2026-08-10T01:00:00" })),
    ).toBe(true);
  });

  it(`[E6] ${REQ} the PRODUCTION value shape — an unquoted timestamp arrives as a Date, read by its UTC fields`, () => {
    // Measured 2026-10-03 with js-yaml 5.4.2 under YAML11_SCHEMA (what FileSystemVaultAdapter
    // loads frontmatter with): `2026-08-10T07:00:00` unquoted → Date, NOT a string. A zone-less
    // YAML timestamp is parsed as UTC, so the Date's UTC fields are the digits in the file —
    // the same reading applyValueFormat uses to PRINT these two properties.
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: new Date("2026-08-10T01:30:00Z"),
          life__Episode_endTimestamp: new Date("2026-08-10T03:00:00Z"),
        }),
      ),
    ).toBe(true);
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: new Date("2026-08-10T00:00:00Z"),
          life__Episode_endTimestamp: new Date("2026-08-10T01:00:00Z"),
        }),
      ),
    ).toBe(false);
  });

  it(`[E7] ${REQ} a PRESENT but unreadable startTimestamp fails closed and does NOT fall back to the day pair`, () => {
    // The day pair here DOES contain today, so a silent fallback would answer "ongoing" — i.e.
    // turn "I cannot read this" into "it is happening", the one direction the predicate must
    // never fail in.
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: "не время",
          life__Episode_start: "2026-08-01",
          life__Episode_end: "2026-08-20",
        }),
      ),
    ).toBe(false);
  });

  it(`[E8] ${REQ} an unreadable endTimestamp fails closed`, () => {
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: "2026-08-10T01:00:00",
          life__Episode_endTimestamp: "не время",
        }),
      ),
    ).toBe(false);
  });

  it(`[E9] ${REQ} the instant pair takes precedence over a co-present day pair — never a mixture`, () => {
    // Non-conformant asset (the two formats are exclusive per the founder's decision 2). The
    // instant pair says "finished an hour ago", the day pair says "today" — the answer must come
    // from the finer one alone.
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: "2026-08-10T00:00:00",
          life__Episode_endTimestamp: "2026-08-10T01:00:00",
          life__Episode_start: "2026-08-01",
          life__Episode_end: "2026-08-20",
        }),
      ),
    ).toBe(false);
  });

  it(`[E10] ${REQ} a DAY-bounded episode keeps the req-8a47ff93 reading — a time component still compares by its calendar day`, () => {
    // NEGATIVE CONTROL for the whole feature, and the one axis that pins "the day path is
    // unchanged": this period runs 09:30–18:00 while now is 02:00, so an implementation that
    // made the DAY pair instant-aware too would answer false. req 8a47ff93 requires true.
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_start: "2026-08-10T09:30:00",
          life__Episode_end: "2026-08-10T18:00:00",
        }),
      ),
    ).toBe(true);
  });

  it(`[E11] ${REQ} an episode carrying NEITHER pair is fail-closed`, () => {
    expect(isEpisodeOngoing(episode({}))).toBe(false);
    expect(isEpisodeOngoing(episode({ life__Episode_endTimestamp: "2026-08-10T09:00:00" }))).toBe(
      false,
    );
  });

  it(`[E12] ${REQ} an EXPLICIT ZONE is ignored — the wall clock as written, so the judge agrees with the display`, () => {
    // 01:30Z read as the written wall clock 01:30 is before now (02:00 local) → ongoing.
    // Honouring the zone would place it at 06:30 local → NOT yet started → false, while the
    // renderer would still print "01:30" beside the missing marker. This axis pins the choice.
    expect(
      isEpisodeOngoing(episode({ life__Episode_startTimestamp: "2026-08-10T01:30:00Z" })),
    ).toBe(true);
    expect(
      isEpisodeOngoing(episode({ life__Episode_startTimestamp: "2026-08-10T01:30:00+09:00" })),
    ).toBe(true);
  });

  it(`[E13] ${REQ} a DATE-ONLY value in a timestamp property reads as that day's midnight`, () => {
    expect(isEpisodeOngoing(episode({ life__Episode_startTimestamp: "2026-08-10" }))).toBe(true);
    expect(isEpisodeOngoing(episode({ life__Episode_startTimestamp: "2026-08-11" }))).toBe(false);
  });

  it(`[E14] ${REQ} a well-SHAPED but impossible wall clock is fail-closed (25:61, 00:61, Feb 31)`, () => {
    // The field widths match, so a shape-only check would accept these and compare them
    // lexicographically against a real now.
    //
    // ⛔ The first two cases are the ones that DISCRIMINATE, and finding that out took running the
    // mutant: "25:61" in the START bound is NOT a discriminating input, because the impossible
    // HOUR alone sorts past now, so the verdict is false with and without the range check. The
    // guard earns its keep on (a) an impossible MINUTE inside an hour that is earlier than now,
    // and (b) an impossible value in the END bound — where it would otherwise sort after every
    // real now and mark the episode ongoing forever. Without them the guard would have read as
    // defensive ([[integration-test-revert-verify]] §A130: the missing axis, not a dead guard).
    expect(
      isEpisodeOngoing(episode({ life__Episode_startTimestamp: "2026-08-10T00:61:00" })),
    ).toBe(false);
    expect(
      isEpisodeOngoing(
        episode({
          life__Episode_startTimestamp: "2026-08-10T01:00:00",
          life__Episode_endTimestamp: "2026-08-10T25:61:00",
        }),
      ),
    ).toBe(false);
    expect(
      isEpisodeOngoing(episode({ life__Episode_startTimestamp: "2026-08-10T25:61:00" })),
    ).toBe(false);
    expect(
      isEpisodeOngoing(episode({ life__Episode_startTimestamp: "2026-02-31T01:00:00" })),
    ).toBe(false);
    expect(
      isEpisodeOngoing(
        episode({ life__Episode_startTimestamp: new Date("not-a-timestamp") }),
      ),
    ).toBe(false);
  });

  it(`[E15] ${REQ} decoration and single-element lists are unwrapped like the day key`, () => {
    expect(
      isEpisodeOngoing(episode({ life__Episode_startTimestamp: ['"2026-08-10T01:00:00"'] })),
    ).toBe(true);
    expect(isEpisodeOngoing(episode({ life__Episode_startTimestamp: [] }))).toBe(false);
    expect(isEpisodeOngoing(episode({ life__Episode_startTimestamp: "   " }))).toBe(false);
  });
});
