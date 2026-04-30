/**
 * Unit tests for the PR2 inert surface of `evaluateWithExoEval`.
 *
 * RFC c78cc5c8 Phase 1a — exoql__Query + exo:eval MVP.
 *
 * Covers:
 *  • feature-flag default (`enabled: false` → `ExoQLEvalDisabledError`)
 *  • allowlist enforcement (FROM / SERVICE / UPDATE / LOAD on parse-stage)
 *  • allowlist permits SELECT and ASK without dataset / SERVICE / UPDATE clauses
 *  • flag override path returns `[]` (PR2 inert; PR3 wires the recursive engine)
 */

import {
  evaluateWithExoEval,
  validateExoQLAllowlist,
  ExoQLEvalDisabledError,
  ExoQLForbiddenKeywordError,
  DEFAULT_EVAL_CONFIG,
} from "../../../src/exoql";
import { ExoQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";

describe("evaluateWithExoEval (PR2 inert)", () => {
  it("throws ExoQLEvalDisabledError when the feature flag is false (default)", () => {
    expect(() => evaluateWithExoEval("SELECT ?s WHERE { ?s ?p ?o }")).toThrow(
      ExoQLEvalDisabledError,
    );
  });

  it("returns [] when the feature flag is overridden to true (PR2 stub)", () => {
    const result = evaluateWithExoEval("SELECT ?s WHERE { ?s ?p ?o }", {
      config: { enabled: true },
    });
    expect(result).toEqual([]);
  });

  it("freezes DEFAULT_EVAL_CONFIG with enabled=false", () => {
    expect(DEFAULT_EVAL_CONFIG.enabled).toBe(false);
    expect(DEFAULT_EVAL_CONFIG.maxNestedEvalCount).toBe(100);
    expect(DEFAULT_EVAL_CONFIG.maxAggregateEvalMillis).toBe(10_000);
    // Frozen via Object.freeze — assignment must not mutate.
    expect(Object.isFrozen(DEFAULT_EVAL_CONFIG)).toBe(true);
  });

  it("rejects FROM dataset clauses with ExoQLForbiddenKeywordError", () => {
    expect(() =>
      evaluateWithExoEval(
        "SELECT ?s FROM <http://example.org/g> WHERE { ?s ?p ?o }",
        { config: { enabled: true } },
      ),
    ).toThrow(ExoQLForbiddenKeywordError);
  });

  it("rejects FROM NAMED dataset clauses with ExoQLForbiddenKeywordError", () => {
    expect(() =>
      evaluateWithExoEval(
        "SELECT ?s FROM NAMED <http://example.org/g> WHERE { ?s ?p ?o }",
        { config: { enabled: true } },
      ),
    ).toThrow(ExoQLForbiddenKeywordError);
  });

  it("rejects SERVICE patterns inside WHERE with ExoQLForbiddenKeywordError", () => {
    expect(() =>
      evaluateWithExoEval(
        "SELECT ?s WHERE { SERVICE <http://example.org/sparql> { ?s ?p ?o } }",
        { config: { enabled: true } },
      ),
    ).toThrow(ExoQLForbiddenKeywordError);
  });

  it("rejects SERVICE nested inside OPTIONAL with ExoQLForbiddenKeywordError", () => {
    expect(() =>
      evaluateWithExoEval(
        "SELECT ?s WHERE { ?s ?p ?o OPTIONAL { SERVICE <http://x/> { ?s ?p ?o } } }",
        { config: { enabled: true } },
      ),
    ).toThrow(ExoQLForbiddenKeywordError);
  });

  it("rejects INSERT DATA (UPDATE) with ExoQLForbiddenKeywordError", () => {
    expect(() =>
      evaluateWithExoEval(
        "INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }",
        { config: { enabled: true } },
      ),
    ).toThrow(ExoQLForbiddenKeywordError);
  });

  it("rejects DELETE DATA (UPDATE) with ExoQLForbiddenKeywordError", () => {
    expect(() =>
      evaluateWithExoEval(
        "DELETE DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }",
        { config: { enabled: true } },
      ),
    ).toThrow(ExoQLForbiddenKeywordError);
  });

  it("rejects LOAD with ExoQLForbiddenKeywordError naming the LOAD keyword", () => {
    try {
      evaluateWithExoEval("LOAD <http://example.org/data.ttl>", {
        config: { enabled: true },
      });
      fail("expected ExoQLForbiddenKeywordError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExoQLForbiddenKeywordError);
      expect((err as ExoQLForbiddenKeywordError).keyword).toBe("LOAD");
    }
  });

  it("permits a vanilla SELECT (no FROM / SERVICE / UPDATE)", () => {
    expect(() =>
      evaluateWithExoEval("SELECT ?s WHERE { ?s ?p ?o }", {
        config: { enabled: true },
      }),
    ).not.toThrow();
  });

  it("permits a vanilla ASK", () => {
    expect(() =>
      evaluateWithExoEval("ASK WHERE { ?s ?p ?o }", {
        config: { enabled: true },
      }),
    ).not.toThrow();
  });

  it("disabled flag wins over allowlist when input is fully valid", () => {
    // Defensive ordering check — allowlist runs BEFORE flag, so a banned
    // construct surfaces ExoQLForbiddenKeywordError even when the flag is
    // its default `false`. (Otherwise users would get a misleading
    // "disabled" error for genuinely banned queries.)
    expect(() =>
      evaluateWithExoEval("SELECT ?s FROM <http://x/> WHERE { ?s ?p ?o }"),
    ).toThrow(ExoQLForbiddenKeywordError);
  });

  it("rejects non-string input with TypeError", () => {
    expect(() => evaluateWithExoEval(123 as unknown as string)).toThrow(
      TypeError,
    );
  });
});

describe("validateExoQLAllowlist (direct AST entry-point)", () => {
  const parser = new ExoQLParser();

  it("returns silently for a vanilla SELECT", () => {
    const ast = parser.parse("SELECT ?s WHERE { ?s ?p ?o }");
    expect(() => validateExoQLAllowlist(ast)).not.toThrow();
  });

  it("returns silently for a vanilla ASK", () => {
    const ast = parser.parse("ASK WHERE { ?s ?p ?o }");
    expect(() => validateExoQLAllowlist(ast)).not.toThrow();
  });

  it("ignores undefined / non-object input gracefully", () => {
    expect(() => validateExoQLAllowlist(undefined as never)).not.toThrow();
  });
});
