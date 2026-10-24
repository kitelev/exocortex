/**
 * SELECT projection order — RFC 9821a379 AC5, core half (ticket 035da1eb).
 *
 * A `query__TableBlock` takes its columns from the query's SELECT projection,
 * in the order the query DECLARES it — not the order a row happens to carry
 * its bindings (`SolutionMapping.variables()` follows binding order, and the
 * Project operator keeps it). `NamedQueryRunner.run` therefore returns the
 * projection as `variables` on the SELECT envelope (computed by
 * `evaluateWithExoEval` from the parsed query).
 *
 * The cell half of AC5 (IRI cell → link with displayName, literal → text) is
 * drawn by the plugin and lives with the plugin ticket.
 *
 * Revert-verify: mutant-driver spec `selectProjectionVariables.spec.json`.
 */

import "reflect-metadata";
import { evaluateWithExoEval } from "../../../src/exoql/evaluateWithExoEval";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { NamedQueryRunner } from "../../../src/services/NamedQueryRunner";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import type { IQueryBodyResolver } from "../../../src/interfaces/IQueryBodyResolver";

// ?Конец is BOUND before ?Начало, the projection lists ?Начало first.
const BINDS_END_FIRST = `
SELECT ?Начало ?Конец WHERE {
  ?e <https://example.org/start> ?s .
  ?e <https://example.org/end> ?en .
  BIND(STR(?en) AS ?Конец)
  BIND(STR(?s) AS ?Начало)
}`;

async function storeWithOneEpisode(): Promise<InMemoryTripleStore> {
  const store = new InMemoryTripleStore();
  const e = new IRI("https://example.org/episode-1");
  await store.add(new Triple(e, new IRI("https://example.org/start"), new Literal("2026-08-09")));
  await store.add(new Triple(e, new IRI("https://example.org/end"), new Literal("2026-08-10")));
  return store;
}

function bodyResolver(body: string): IQueryBodyResolver {
  return { resolveSparql: async () => body } as unknown as IQueryBodyResolver;
}

describe("SELECT projection in declared order (RFC 9821a379 AC5, core)", () => {
  test("V1 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe variables follow the projection, not the binding order of the row", async () => {
    const result = await evaluateWithExoEval(BINDS_END_FIRST, { store: await storeWithOneEpisode() });
    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.variables).toEqual(["Начало", "Конец"]);
    // Control — the row itself carries BINDING order; without `variables` a
    // table would draw «Конец» first. This is what makes V1 discriminating.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].variables()).toEqual(["Конец", "Начало"]);
  });

  test("V2 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe NamedQueryRunner.run hands the projection to its caller", async () => {
    const runner = new NamedQueryRunner(bodyResolver(BINDS_END_FIRST), await storeWithOneEpisode());
    const result = await runner.run("7a3c1f20-5b9e-4d11-8c2a-0f6e9d4b2a71");
    expect(result?.kind).toBe("select");
    expect(result && result.kind === "select" ? result.variables : null).toEqual(["Начало", "Конец"]);
  });

  test("V3 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe a projected variable bound in no row is still a column; an empty result still has its columns", async () => {
    const result = await evaluateWithExoEval(
      `SELECT ?Эпизод ?Нет ?Начало WHERE { ?Эпизод <https://example.org/start> ?Начало . OPTIONAL { ?Эпизод <https://example.org/none> ?Нет } }`,
      { store: await storeWithOneEpisode() },
    );
    expect(result.kind === "select" ? result.variables : null).toEqual(["Эпизод", "Нет", "Начало"]);
    const empty = await evaluateWithExoEval(
      `SELECT ?a ?b WHERE { ?a <https://example.org/absent> ?b }`,
      { store: await storeWithOneEpisode() },
    );
    expect(empty.kind === "select" ? [empty.rows.length, empty.variables] : null).toEqual([0, ["a", "b"]]);
  });

  test("V4 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe an aggregate `(COUNT(?e) AS ?n)` is a column under its alias, in its place", async () => {
    const result = await evaluateWithExoEval(
      `SELECT ?s (COUNT(?e) AS ?n) WHERE { ?e <https://example.org/start> ?s } GROUP BY ?s`,
      { store: await storeWithOneEpisode() },
    );
    expect(result.kind === "select" ? result.variables : null).toEqual(["s", "n"]);
  });

  test("V6 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe without a store the empty SELECT envelope still carries the declared projection", async () => {
    const result = await evaluateWithExoEval(BINDS_END_FIRST);
    expect(result).toEqual({ kind: "select", rows: [], variables: ["Начало", "Конец"] });
  });

  test("V5 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe SELECT * has no declared order — every variable bound in the rows, first-seen", async () => {
    const result = await evaluateWithExoEval(
      `SELECT * WHERE { ?e <https://example.org/start> ?s }`,
      { store: await storeWithOneEpisode() },
    );
    const vars = result.kind === "select" ? result.variables : [];
    expect([...vars].sort()).toEqual(["e", "s"]);
    expect(result.kind === "select" ? result.rows[0].variables() : null).toEqual(vars);
  });
});
