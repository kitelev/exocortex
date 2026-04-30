/**
 * Unit tests for `evaluateWithExoEval` after PR3 (T4) wiring.
 *
 * RFC c78cc5c8 Phase 1a — exoql__Query + exo:eval MVP.
 *
 * Covers:
 *  • feature-flag default flipped to `enabled: true` (PR3 T4)
 *  • allowlist enforcement (FROM / SERVICE / UPDATE / LOAD)
 *  • allowlist permits SELECT / ASK without dataset / SERVICE / UPDATE
 *  • dispatch: SELECT / ASK / CONSTRUCT shapes returned via discriminated envelope
 *  • disabled override still throws
 */

import {
  evaluateWithExoEval,
  validateExoQLAllowlist,
  ExoQLEvalDisabledError,
  ExoQLForbiddenKeywordError,
  DEFAULT_EVAL_CONFIG,
} from "../../../src/exoql";
import { ExoQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Triple } from "../../../src/domain/models/rdf/Triple";

describe("evaluateWithExoEval (PR3 wired)", () => {
  it("default flag is enabled (PR3 T4 flipped)", () => {
    expect(DEFAULT_EVAL_CONFIG.enabled).toBe(true);
    expect(DEFAULT_EVAL_CONFIG.maxNestedEvalCount).toBe(100);
    expect(DEFAULT_EVAL_CONFIG.maxAggregateEvalMillis).toBe(10_000);
    expect(Object.isFrozen(DEFAULT_EVAL_CONFIG)).toBe(true);
  });

  it("throws ExoQLEvalDisabledError when overridden to disabled", async () => {
    await expect(
      evaluateWithExoEval("SELECT ?s WHERE { ?s ?p ?o }", {
        config: { enabled: false },
      }),
    ).rejects.toBeInstanceOf(ExoQLEvalDisabledError);
  });

  it("returns empty SELECT envelope when no store provided", async () => {
    const result = await evaluateWithExoEval("SELECT ?s WHERE { ?s ?p ?o }");
    expect(result).toEqual({ kind: "select", rows: [] });
  });

  it("returns empty ASK=false envelope when no store provided", async () => {
    const result = await evaluateWithExoEval("ASK WHERE { ?s ?p ?o }");
    expect(result).toEqual({ kind: "ask", result: false });
  });

  it("ASK { } (always-true sentinel) returns true against any store", async () => {
    const store = new InMemoryTripleStore();
    const result = await evaluateWithExoEval("ASK { }", { store });
    expect(result).toEqual({ kind: "ask", result: true });
  });

  it("dispatches SELECT against a populated store", async () => {
    const store = new InMemoryTripleStore();
    const s = new IRI("https://example.org/a");
    const p = new IRI("https://example.org/p");
    const o = new IRI("https://example.org/b");
    await store.add(new Triple(s, p, o));
    const result = await evaluateWithExoEval(
      "SELECT ?s WHERE { ?s ?p ?o }",
      { store },
    );
    expect(result.kind).toBe("select");
    if (result.kind === "select") {
      expect(result.rows.length).toBeGreaterThan(0);
    }
  });

  it("rejects FROM dataset clauses with ExoQLForbiddenKeywordError", async () => {
    await expect(
      evaluateWithExoEval(
        "SELECT ?s FROM <http://example.org/g> WHERE { ?s ?p ?o }",
      ),
    ).rejects.toBeInstanceOf(ExoQLForbiddenKeywordError);
  });

  it("rejects FROM NAMED dataset clauses with ExoQLForbiddenKeywordError", async () => {
    await expect(
      evaluateWithExoEval(
        "SELECT ?s FROM NAMED <http://example.org/g> WHERE { ?s ?p ?o }",
      ),
    ).rejects.toBeInstanceOf(ExoQLForbiddenKeywordError);
  });

  it("rejects SERVICE patterns inside WHERE with ExoQLForbiddenKeywordError", async () => {
    await expect(
      evaluateWithExoEval(
        "SELECT ?s WHERE { SERVICE <http://example.org/sparql> { ?s ?p ?o } }",
      ),
    ).rejects.toBeInstanceOf(ExoQLForbiddenKeywordError);
  });

  it("rejects SERVICE nested inside OPTIONAL with ExoQLForbiddenKeywordError", async () => {
    await expect(
      evaluateWithExoEval(
        "SELECT ?s WHERE { ?s ?p ?o OPTIONAL { SERVICE <http://x/> { ?s ?p ?o } } }",
      ),
    ).rejects.toBeInstanceOf(ExoQLForbiddenKeywordError);
  });

  it("rejects INSERT DATA (UPDATE) with ExoQLForbiddenKeywordError", async () => {
    await expect(
      evaluateWithExoEval(
        "INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }",
      ),
    ).rejects.toBeInstanceOf(ExoQLForbiddenKeywordError);
  });

  it("rejects DELETE DATA (UPDATE) with ExoQLForbiddenKeywordError", async () => {
    await expect(
      evaluateWithExoEval(
        "DELETE DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }",
      ),
    ).rejects.toBeInstanceOf(ExoQLForbiddenKeywordError);
  });

  it("rejects LOAD with ExoQLForbiddenKeywordError naming the LOAD keyword", async () => {
    let caught: unknown = undefined;
    try {
      await evaluateWithExoEval("LOAD <http://example.org/data.ttl>");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExoQLForbiddenKeywordError);
    expect((caught as ExoQLForbiddenKeywordError).keyword).toBe("LOAD");
  });

  it("permits a vanilla SELECT (no FROM / SERVICE / UPDATE)", async () => {
    await expect(
      evaluateWithExoEval("SELECT ?s WHERE { ?s ?p ?o }"),
    ).resolves.toBeDefined();
  });

  it("permits a vanilla ASK", async () => {
    await expect(
      evaluateWithExoEval("ASK WHERE { ?s ?p ?o }"),
    ).resolves.toBeDefined();
  });

  it("allowlist runs BEFORE flag check (defensive ordering)", async () => {
    // Forbidden construct must surface ExoQLForbiddenKeywordError even when
    // flag is overridden to disabled — otherwise users get a misleading
    // "disabled" error for genuinely banned queries.
    await expect(
      evaluateWithExoEval("SELECT ?s FROM <http://x/> WHERE { ?s ?p ?o }", {
        config: { enabled: false },
      }),
    ).rejects.toBeInstanceOf(ExoQLForbiddenKeywordError);
  });

  it("rejects non-string input with TypeError", async () => {
    await expect(
      evaluateWithExoEval(123 as unknown as string),
    ).rejects.toBeInstanceOf(TypeError);
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
