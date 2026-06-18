/**
 * Drift-guard for the exoql__Query + exo:eval defaults.
 *
 * Issue #2991 (P3 defensive, follow-up RFC c78cc5c8 Phase 1a T7).
 *
 * Companion to `drift-guard-function-registry.test.ts` — together the two
 * files lock the three product-critical defaults that any regression in
 * `exoql__Query` infrastructure would silently flip:
 *
 *  1. **Flag persistence** — `DEFAULT_EVAL_CONFIG` snapshot (`enabled`,
 *     budget caps, frozen). RFC c78cc5c8 Phase 1a (PR3 T4) flipped the B2
 *     lock to `enabled: true`; rollback path is documented in
 *     `docs/how-to/ROLLBACK_EXOQL_EVAL.md`. Any future deviation must update the
 *     manifest below explicitly.
 *
 *  2. **SPARQL function registry** — covered by
 *     `drift-guard-function-registry.test.ts` (sorted-keys snapshot +
 *     `exo:eval` registration).
 *
 *  3. **Allowlist forms** — `validateExoQLAllowlist` permits SELECT and
 *     ASK, and rejects every banned construct (UPDATE / FROM / FROM NAMED
 *     / SERVICE / LOAD) with `ExoQLForbiddenKeywordError`. Adding or
 *     removing a permitted form requires touching this manifest.
 *
 * The aim is NOT to replicate behavioural coverage from
 * `evaluateWithExoEval.test.ts` — that suite already exercises the
 * pipeline. This file is intentionally narrow: each assertion fails on a
 * single deliberate mutation of one of the three defaults, making the
 * test the explicit review gate the issue requires.
 */

import {
  DEFAULT_EVAL_CONFIG,
  ExoQLForbiddenKeywordError,
  validateExoQLAllowlist,
} from "../../../../exocortex/src/exoql";
import { ExoQLParser } from "../../../../exocortex/src/infrastructure/sparql/SPARQLParser";

const parser = new ExoQLParser();

describe("drift-guard: exoql__Query DEFAULT_EVAL_CONFIG", () => {
  it("snapshot of the three product-critical defaults (RFC c78cc5c8 Phase 1a)", () => {
    expect(DEFAULT_EVAL_CONFIG).toEqual({
      enabled: true,
      maxNestedEvalCount: 100,
      maxAggregateEvalMillis: 10_000,
    });
  });

  it("config object is frozen so accidental in-process mutation is impossible", () => {
    expect(Object.isFrozen(DEFAULT_EVAL_CONFIG)).toBe(true);
  });

  it("config has exactly the three documented keys (no silent additions)", () => {
    expect(Object.keys(DEFAULT_EVAL_CONFIG).sort()).toEqual([
      "enabled",
      "maxAggregateEvalMillis",
      "maxNestedEvalCount",
    ]);
  });
});

describe("drift-guard: exoql__Query allowlist forms", () => {
  // Permitted forms — adding a new permitted form (e.g. CONSTRUCT/DESCRIBE)
  // requires extending this manifest deliberately.
  const PERMITTED: ReadonlyArray<{ label: string; sparql: string }> = [
    { label: "SELECT", sparql: "SELECT * WHERE { ?s ?p ?o }" },
    { label: "ASK", sparql: "ASK { ?s ?p ?o }" },
  ];

  // Banned forms — removing one of these from the allowlist (e.g. dropping
  // the SERVICE check) flips the test from green to red.
  const BANNED: ReadonlyArray<{
    label: string;
    sparql: string;
    keyword: string;
  }> = [
    {
      label: "UPDATE (INSERT DATA)",
      sparql: "INSERT DATA { <urn:s> <urn:p> <urn:o> }",
      keyword: "UPDATE",
    },
    {
      label: "UPDATE (DELETE DATA)",
      sparql: "DELETE DATA { <urn:s> <urn:p> <urn:o> }",
      keyword: "UPDATE",
    },
    {
      label: "FROM dataset clause",
      sparql: "SELECT * FROM <urn:g> WHERE { ?s ?p ?o }",
      keyword: "FROM",
    },
    {
      label: "FROM NAMED dataset clause",
      sparql: "SELECT * FROM NAMED <urn:g> WHERE { GRAPH <urn:g> { ?s ?p ?o } }",
      keyword: "FROM",
    },
    {
      label: "SERVICE federated pattern",
      sparql:
        "SELECT * WHERE { SERVICE <https://example.org/sparql> { ?s ?p ?o } }",
      keyword: "SERVICE",
    },
    {
      label: "LOAD (UPDATE sub-form, must surface LOAD keyword)",
      sparql: "LOAD <urn:g>",
      keyword: "LOAD",
    },
  ];

  it.each(PERMITTED)("permits $label without throwing", ({ sparql }) => {
    const ast = parser.parse(sparql);
    expect(() => validateExoQLAllowlist(ast)).not.toThrow();
  });

  it.each(BANNED)(
    "rejects $label with ExoQLForbiddenKeywordError naming $keyword",
    ({ sparql, keyword }) => {
      const ast = parser.parse(sparql);
      let thrown: unknown = null;
      try {
        validateExoQLAllowlist(ast);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ExoQLForbiddenKeywordError);
      expect((thrown as Error).message).toContain(keyword);
    },
  );
});
