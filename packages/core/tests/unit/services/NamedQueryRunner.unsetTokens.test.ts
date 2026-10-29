/**
 * RFC 9821a379 decision 8 / AC7 — the bypass of ems__Bug 2bc09942 (ticket
 * 058bad52): `NamedQueryRunner.run(…, { refuseUnsetTokens: true })` refuses a
 * body that still carries a `$<name>` token after substitution, because the
 * engine reads such a token as an unbound variable and a comparison with it
 * lets every row through.
 *
 * revert-verify: mutants in `NamedQueryRunner.unsetTokens.spec.json` (runner)
 * and `findUnsetQueryTokens.spec.json` (scanner) — each reddens its own axes.
 */

import {
  NamedQueryRunner,
  UnsetQueryTokenError,
} from "../../../src/services/NamedQueryRunner";
import { findUnsetQueryTokens } from "../../../src/services/findUnsetQueryTokens";
import type { IQueryBodyResolver } from "../../../src/interfaces/IQueryBodyResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

const LABEL = "https://exocortex.my/ontology/exo#Asset_label";
const A = "obsidian://vault/notes/a.md";
const B = "obsidian://vault/notes/b.md";

class MapQueryBodyResolver implements IQueryBodyResolver {
  constructor(private readonly bodies: Record<string, string>) {}
  async resolveSparql(uid: string): Promise<string | null> {
    return this.bodies[uid] ?? null;
  }
}

function runner(body: string): NamedQueryRunner {
  const store = new InMemoryTripleStore();
  store.add(new Triple(new IRI(A), new IRI(LABEL), new Literal("Alpha")));
  store.add(new Triple(new IRI(B), new IRI(LABEL), new Literal("Beta")));
  return new NamedQueryRunner(new MapQueryBodyResolver({ q: body }), store);
}

describe("NamedQueryRunner — refuseUnsetTokens (RFC 9821a379 AC7, ticket 058bad52)", () => {
  it("K1 @req:23f10730-82f7-4037-b566-da79d5fa3378 a $token with no value is refused before evaluation, named in the error", async () => {
    const r = runner(
      `SELECT ?s WHERE { ?s <${LABEL}> ?l . FILTER(?l != $who) }`,
    );
    const outcome = await r
      .run("q", { currentAsset: A }, { refuseUnsetTokens: true })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(outcome).toBeInstanceOf(UnsetQueryTokenError);
    expect((outcome as UnsetQueryTokenError).tokens).toEqual(["who"]);
    expect((outcome as Error).message).toContain("$who");
  });

  it("K2 @req:23f10730-82f7-4037-b566-da79d5fa3378 the check reads the SUBSTITUTED body: $currentAsset given a value is not a token", async () => {
    const r = runner(`SELECT ?l WHERE { $currentAsset <${LABEL}> ?l }`);
    const result = await r.run(
      "q",
      { currentAsset: A },
      { refuseUnsetTokens: true },
    );
    expect(result?.kind).toBe("select");
    const rows = result?.kind === "select" ? result.rows : [];
    expect(rows.map((row) => (row.get("l") as Literal).value)).toEqual([
      "Alpha",
    ]);
  });

  it('K3 @req:23f10730-82f7-4037-b566-da79d5fa3378 $ inside a string literal, a comment or an IRI is not a token (REPLACE(…, "$1") is live data)', async () => {
    const r = runner(
      [
        `SELECT ?x WHERE {`,
        `  ?s <${LABEL}> ?l .  # $commented`,
        `  BIND(REPLACE(?l, "^(.).*$", "$1") AS ?x)`,
        `  FILTER(?s != <http://example.org/$inIri>)`,
        `}`,
      ].join("\n"),
    );
    const result = await r.run(
      "q",
      { currentAsset: A },
      { refuseUnsetTokens: true },
    );
    expect(result?.kind).toBe("select");
    expect(findUnsetQueryTokens(`"$1" # $c\n <http://e/$i>`)).toEqual([]);
  });

  it("K4 @req:23f10730-82f7-4037-b566-da79d5fa3378 without the option the runner evaluates as before (runScalar / CLI run-query unchanged)", async () => {
    const r = runner(
      `SELECT ?s WHERE { ?s <${LABEL}> ?l . FILTER(?l != $who) }`,
    );
    const result = await r.run("q", { currentAsset: A });
    expect(result?.kind).toBe("select");
  });

  it("K5 @req:23f10730-82f7-4037-b566-da79d5fa3378 token names are Unicode", () => {
    expect(findUnsetQueryTokens("SELECT * WHERE { ?s ?p $день }")).toEqual([
      "день",
    ]);
  });

  it("K10 @req:23f10730-82f7-4037-b566-da79d5fa3378 token names are unique, in order of first appearance", () => {
    expect(
      findUnsetQueryTokens("SELECT * WHERE { ?s ?p $b . ?s ?p $a . ?s ?p $b }"),
    ).toEqual(["b", "a"]);
  });

  it("K6 @req:23f10730-82f7-4037-b566-da79d5fa3378 a bare quote inside a long string does not end it early", () => {
    expect(
      findUnsetQueryTokens(`SELECT * WHERE { BIND("""a"b $z""" AS ?x) }`),
    ).toEqual([]);
  });

  it("K9 @req:23f10730-82f7-4037-b566-da79d5fa3378 an escaped quote does not end a short string early; adjacent strings do not hide a later token", () => {
    expect(
      findUnsetQueryTokens(`SELECT * WHERE { BIND("a\\"$q" AS ?x) }`),
    ).toEqual([]);
    expect(
      findUnsetQueryTokens(
        `SELECT * WHERE { BIND('it''s' AS ?x) FILTER(?x = $after) }`,
      ),
    ).toEqual(["after"]);
  });

  it("K7 @req:23f10730-82f7-4037-b566-da79d5fa3378 an escaped quote right before the closing triple quote does not end a long string early", () => {
    expect(
      findUnsetQueryTokens(
        `SELECT * WHERE { BIND("""say \\"$no\\"""" AS ?x) FILTER(?x = $yes) }`,
      ),
    ).toEqual(["yes"]);
  });

  it("K8 @req:23f10730-82f7-4037-b566-da79d5fa3378 < as a comparison operator is not an IRI: a token after it, before a later IRI, is found", () => {
    expect(
      findUnsetQueryTokens(
        `SELECT ?e WHERE { ?e <http://e/start> ?s . FILTER(?s < $dayEnd) . ?e <http://e/p> ?o }`,
      ),
    ).toEqual(["dayEnd"]);
  });

  it("K11 @req:23f10730-82f7-4037-b566-da79d5fa3378 a long string in single quotes is a string too: a bare quote inside it does not end it early", () => {
    expect(
      findUnsetQueryTokens(`SELECT * WHERE { BIND('''it's $z''' AS ?x) }`),
    ).toEqual([]);
  });
});
