/**
 * `PreconditionEvaluator` `askCache` day-lock (req 96be4042 / #3819) — the 6th
 * and final surface of the date-tz family (#3806/#3808/#3810/#3813/#3817).
 *
 * `evaluateSparqlAsk` caches the COMPILED `AskOperation` in `askCache`. Formerly
 * the key was the RAW `sparqlAsk` text, but `compileAsk` runs `substituteVariables`
 * at COMPILE time — so the computed `$today`/`$now`/… values are BAKED into the
 * cached entry. A precondition first compiled on local day D therefore kept
 * evaluating against day D even after local midnight into day D+1, until a manual
 * `invalidateCache()` — so a button's visibility gate mis-fired overnight.
 *
 * The fix folds the LOCAL calendar day into the cache key ONLY for queries
 * containing a temporal token (`$today`/`$now`/…): a compiled ASK from day D is a
 * cache MISS on day D+1 → recompiled against the new day, no manual invalidate.
 * Token-free queries keep the raw-text key (one compile, reused forever — zero
 * perf regression).
 *
 * Revert-verify ([[integration-test-revert-verify]]): with the cache key reverted
 * to the raw `sparqlAsk` text, the day-D+1 evaluation re-serves the stale day-D
 * compiled ASK (`$today` = day D) → the asset (planned for day D+1) does NOT match
 * → RED; the date-aware key → recompile → match → GREEN.
 *
 * CI-robustness ([[jest-timezone-sensitive-tests]]): `process.env.TZ` cannot be
 * re-tzset under jest (V8 caches the worker timezone) and the local/UTC distinction
 * has no observable effect in a UTC runner — so the shared `installFakeOffsetDate`
 * `Date`-subclass simulates a fixed UTC+5 (Asia/Almaty, no DST) offset and the
 * fixed instant is switched across the local-midnight boundary (day D 23:00 local →
 * day D+1 00:30 local, UTC still day D). Guards (`getHours()`/`getDate()`/
 * `getUTCDate()`) assert the simulated tz is active so the test can never silently
 * pass both ways.
 *
 * @req:96be4042-6521-4f62-bdc6-ee31e7e260a5
 */
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { ExoQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { installFakeOffsetDate } from "../../helpers/installFakeOffsetDate";

describe("PreconditionEvaluator askCache day-lock (req 96be4042 / #3819)", () => {
  const ASSET_IRI = "https://exocortex.my/ontology/ems/test-asset-daylock";
  const PLANNED = new IRI("https://exocortex.my/ontology/ems#plannedDate");
  const XSD_DATE = new IRI("http://www.w3.org/2001/XMLSchema#date");

  // Restore any jest.spyOn even if an assertion throws before an inline restore.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // A visibility precondition: is the asset planned for TODAY (local)?
  const TODAY_ASK = `
    PREFIX ems: <https://exocortex.my/ontology/ems#>
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    ASK {
      <${ASSET_IRI}> ems:plannedDate ?d .
      FILTER(?d = $today)
    }
  `;

  it("a $today precondition compiled on local day D recompiles on day D+1 WITHOUT invalidateCache — the compiled ASK does not survive local midnight @req:96be4042-6521-4f62-bdc6-ee31e7e260a5", async () => {
    // Asset is planned for LOCAL day 2026-07-04 (= day D+1 below).
    const store = new InMemoryTripleStore();
    await store.add(
      new Triple(new IRI(ASSET_IRI), PLANNED, new Literal("2026-07-04", XSD_DATE)),
    );
    // ONE evaluator instance — its askCache persists across the day boundary.
    const evaluator = new PreconditionEvaluator(store);
    const precondition = {
      id: "pre-planned-today",
      label: "planned for today (local)",
      sparqlAsk: TODAY_ASK,
    };

    // --- Local day D = 2026-07-03 (23:00 local, UTC 18:00 day 03) ---
    let restore = installFakeOffsetDate(5, "2026-07-03T18:00:00Z");
    try {
      expect(new Date().getHours()).toBe(23); // 23:00 local — guard (sim tz active)
      expect(new Date().getDate()).toBe(3); // local day 03 — guard
      // $today = "2026-07-03"; asset planned "2026-07-04" (tomorrow) → NOT available.
      // This ALSO compiles + caches the ASK with $today baked in as "2026-07-03".
      expect(await evaluator.evaluate(precondition, ASSET_IRI)).toBe(false);
    } finally {
      restore();
    }

    // --- Local day D+1 = 2026-07-04 (00:30 local, UTC still 19:30 day 03) ---
    restore = installFakeOffsetDate(5, "2026-07-03T19:30:00Z");
    try {
      expect(new Date().getHours()).toBe(0); // 00:30 local — past local midnight
      expect(new Date().getDate()).toBe(4); // local day advanced to 04
      expect(new Date().getUTCDate()).toBe(3); // ...while UTC is STILL day 03
      // $today is now "2026-07-04"; the asset planned "2026-07-04" is TODAY →
      // the command MUST become available. With the raw-text cache key the stale
      // day-03 compiled ASK ($today = "2026-07-03") would be re-served → false (RED).
      // With the date-aware key the day change forces a recompile → true (GREEN).
      expect(await evaluator.evaluate(precondition, ASSET_IRI)).toBe(true);
    } finally {
      restore();
    }
  });

  it("token-free precondition ASK is compiled ONCE across a local-day change (perf-neutral) while a $today ASK recompiles @req:96be4042-6521-4f62-bdc6-ee31e7e260a5", async () => {
    const store = new InMemoryTripleStore();
    await store.add(
      new Triple(new IRI(ASSET_IRI), PLANNED, new Literal("2026-07-04", XSD_DATE)),
    );

    const parseSpy = jest.spyOn(ExoQLParser.prototype, "parse");

    // --- Token-free query: same cache entry must be reused across days ---
    const tokenFree = new PreconditionEvaluator(store);
    const tokenFreePre = {
      id: "pre-any",
      label: "asset exists",
      sparqlAsk: `ASK { <${ASSET_IRI}> ?p ?o }`,
    };
    parseSpy.mockClear();
    let restore = installFakeOffsetDate(5, "2026-07-03T18:00:00Z");
    try {
      await tokenFree.evaluate(tokenFreePre, ASSET_IRI);
    } finally {
      restore();
    }
    restore = installFakeOffsetDate(5, "2026-07-03T19:30:00Z");
    try {
      await tokenFree.evaluate(tokenFreePre, ASSET_IRI);
    } finally {
      restore();
    }
    // Compiled ONCE — raw-text key, reused across the day change (no perf regression).
    expect(parseSpy).toHaveBeenCalledTimes(1);

    // --- Temporal query: must recompile once the local day changes ---
    const temporal = new PreconditionEvaluator(store);
    const temporalPre = {
      id: "pre-planned-today-2",
      label: "planned for today (local)",
      sparqlAsk: TODAY_ASK,
    };
    parseSpy.mockClear();
    restore = installFakeOffsetDate(5, "2026-07-03T18:00:00Z");
    try {
      await temporal.evaluate(temporalPre, ASSET_IRI);
    } finally {
      restore();
    }
    restore = installFakeOffsetDate(5, "2026-07-03T19:30:00Z");
    try {
      await temporal.evaluate(temporalPre, ASSET_IRI);
    } finally {
      restore();
    }
    // Recompiled on the new local day — one parse per day (date-aware key).
    expect(parseSpy).toHaveBeenCalledTimes(2);
    // (afterEach restores the spy — no manual mockRestore that could leak on throw.)
  });

  it("memory bound: the SAME $today query evaluated across a local-day change keeps exactly ONE cache entry (no per-day leak) @req:96be4042-6521-4f62-bdc6-ee31e7e260a5", async () => {
    const store = new InMemoryTripleStore();
    await store.add(
      new Triple(new IRI(ASSET_IRI), PLANNED, new Literal("2026-07-04", XSD_DATE)),
    );
    const evaluator = new PreconditionEvaluator(store);
    const precondition = {
      id: "pre-mem",
      label: "planned today",
      sparqlAsk: TODAY_ASK,
    };
    // White-box: the cache is keyed by raw text so a day change REPLACES the
    // entry rather than adding a second one.
    const cache = (
      evaluator as unknown as { askCache: Map<string, unknown> }
    ).askCache;

    let restore = installFakeOffsetDate(5, "2026-07-03T18:00:00Z"); // day D
    try {
      await evaluator.evaluate(precondition, ASSET_IRI);
    } finally {
      restore();
    }
    expect(cache.size).toBe(1);

    restore = installFakeOffsetDate(5, "2026-07-03T19:30:00Z"); // day D+1
    try {
      await evaluator.evaluate(precondition, ASSET_IRI);
    } finally {
      restore();
    }
    // Still ONE entry — the day-D compiled ASK was overwritten, not accumulated.
    expect(cache.size).toBe(1);
  });
});
