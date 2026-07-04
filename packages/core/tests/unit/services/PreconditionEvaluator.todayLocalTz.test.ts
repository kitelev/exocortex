/**
 * `PreconditionEvaluator` `$today` local-timezone revert-verify (req ecb90c06 /
 * #3811) — the 5th and final declared `$today` surface.
 *
 * `PreconditionEvaluator.substituteVariables` interpolates `$today` (and its
 * sibling calendar-date tokens `$yesterday`/`$thisWeekStart`/…) into a
 * visibility/availability precondition-SPARQL ASK. It formerly sliced
 * `clock.now().toISOString()` (UTC) for `$today` while the sibling tokens
 * derived from a hardcoded `ALMATY_OFFSET_MS` local shift — so between local
 * midnight and 05:00 Asia/Almaty `$today` EQUALLED `$yesterday` (internally
 * absurd) and any precondition comparing an asset date against `$today`
 * mis-fired at the boundary. The fix derives every calendar-date token from ONE
 * shared local `Date` basis (`DateFormatter.toDateString` / local getters),
 * removing the hardcode.
 *
 * Revert-verify ([[integration-test-revert-verify]]): reverting `$today` to
 * `clock.now().toISOString().slice(0, 10)` (and the siblings back on
 * `ALMATY_OFFSET_MS`) makes `$today` resolve to "2026-07-02" (the UTC day, ==
 * `$yesterday`) → RED; the shared-local form → GREEN ("2026-07-03").
 *
 * CI-robustness ([[jest-timezone-sensitive-tests]]): `process.env.TZ` cannot be
 * re-tzset under jest (V8 caches the worker timezone), and the fix has NO
 * observable effect in a UTC runner — so a `Date` subclass (shared
 * `installFakeOffsetDate` helper) simulates a fixed UTC+5 (Asia/Almaty, no DST)
 * offset at 2026-07-02T19:27:00Z = 2026-07-03T00:27 local (local day 03, UTC day
 * 02), independent of the runner's real timezone. A guard proves the simulated
 * tz is active so the assertion can never silently pass both ways.
 *
 * @req:ecb90c06-92af-41bd-bb81-1d4510e53fa3
 */
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { installFakeOffsetDate } from "../../helpers/installFakeOffsetDate";

describe("PreconditionEvaluator $today = LOCAL calendar day (req ecb90c06 / #3811)", () => {
  const ASSET_IRI = "https://exocortex.my/ontology/ems/test-asset-123";

  it("substituteVariables interpolates $today as today's LOCAL day just after local midnight (UTC still previous day) and $today !== $yesterday @req:ecb90c06-92af-41bd-bb81-1d4510e53fa3", () => {
    const restore = installFakeOffsetDate(5, "2026-07-02T19:27:00Z");
    try {
      // Guard: prove the simulated tz is active (else the assertions below would
      // be vacuous in a UTC-tz runner and silently pass both ways — fail loud).
      expect(new Date().getHours()).toBe(0); // 00:27 local (Almaty)
      expect(new Date().getUTCDate()).toBe(2); // still July 2 in UTC

      const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());

      // Local today = 2026-07-03; the former UTC form returned "2026-07-02".
      const today = evaluator.substituteVariables("$today", ASSET_IRI);
      expect(today).toBe(`"2026-07-03"^^xsd:date`);

      // Sibling token — local yesterday = 2026-07-02.
      const yesterday = evaluator.substituteVariables("$yesterday", ASSET_IRI);
      expect(yesterday).toBe(`"2026-07-02"^^xsd:date`);

      // The bug's absurdity: at the boundary the former UTC `$today` equalled
      // `$yesterday`. The shared-local basis keeps them one local day apart.
      expect(today).not.toBe(yesterday);
    } finally {
      restore();
    }
  });

  it("evaluate (production-shape): a real precondition ASK comparing an asset xsd:date against $today matches TODAY's LOCAL day, NOT the UTC day, at the boundary @req:ecb90c06-92af-41bd-bb81-1d4510e53fa3", async () => {
    const restore = installFakeOffsetDate(5, "2026-07-02T19:27:00Z");
    try {
      expect(new Date().getHours()).toBe(0); // 00:27 local — guard
      expect(new Date().getUTCDate()).toBe(2); // still July 2 in UTC

      // Precondition ASK: is the asset's planned date == $today? Runs the REAL
      // substitute → parse → ASK evaluate pipeline through PreconditionEvaluator.
      const precondition = {
        id: "pre-planned-today",
        label: "planned for today (local)",
        sparqlAsk: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
          ASK {
            <${ASSET_IRI}> ems:plannedDate ?d .
            FILTER(?d = $today)
          }
        `,
      };
      const PLANNED = new IRI("https://exocortex.my/ontology/ems#plannedDate");
      const XSD_DATE = new IRI("http://www.w3.org/2001/XMLSchema#date");

      // Asset planned for TODAY's LOCAL day (2026-07-03) → the precondition
      // matches. With the former UTC `$today` (= "2026-07-02") it would NOT.
      const todayStore = new InMemoryTripleStore();
      await todayStore.add(
        new Triple(new IRI(ASSET_IRI), PLANNED, new Literal("2026-07-03", XSD_DATE)),
      );
      expect(
        await new PreconditionEvaluator(todayStore).evaluate(precondition, ASSET_IRI),
      ).toBe(true);

      // Control (non-vacuity): asset planned for the UTC day (2026-07-02, which
      // the bug's `$today` produced). The local `$today` (= "2026-07-03") must
      // NOT match it — proving the ASK really discriminates on the date value.
      const utcDayStore = new InMemoryTripleStore();
      await utcDayStore.add(
        new Triple(new IRI(ASSET_IRI), PLANNED, new Literal("2026-07-02", XSD_DATE)),
      );
      expect(
        await new PreconditionEvaluator(utcDayStore).evaluate(precondition, ASSET_IRI),
      ).toBe(false);
    } finally {
      restore();
    }
  });
});
