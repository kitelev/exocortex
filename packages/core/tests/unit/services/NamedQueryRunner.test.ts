/**
 * Unit tests for NamedQueryRunner (RFC 78c2b7d0 C4 — read side).
 *
 * Covers:
 *   • SELECT scalar extraction — IRI binding reverse-mapped to Obsidian name,
 *     literal binding yields lexical value
 *   • ASK → boolean scalar
 *   • auto-inject $currentAsset / $currentClass (controlled <iri> substitution)
 *   • explicit params (iri + literal kinds, controlled formatting)
 *   • read-only guarantee — a mutation body is rejected by the engine allowlist
 *   • fail modes — no resolvable body (throws), empty result set (null)
 */

import { NamedQueryRunner } from "../../../src/services/NamedQueryRunner";
import { ExoQLForbiddenKeywordError } from "../../../src/exoql";
import type { IQueryBodyResolver } from "../../../src/interfaces/IQueryBodyResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

const EXO = "https://exocortex.my/ontology/exo";
const ISDEFINEDBY = `${EXO}#Asset_isDefinedBy`;
const ARCHIVE_ONTO = `${EXO}#Ontology_archiveOntology`;
const VOTES = `${EXO}#Asset_votes`;

const ASSET = "obsidian://vault/assets/asset-1.md";
const SRC_ONTO = "obsidian://vault/onto/src-onto.md";
const ARCHIVE_ONTO_FILE = "obsidian://vault/onto/9f1c0b2a-archive.md";

/** In-memory body resolver: uid → SPARQL string. */
class MapQueryBodyResolver implements IQueryBodyResolver {
  constructor(private readonly bodies: Record<string, string | null>) {}
  async resolveSparql(uid: string): Promise<string | null> {
    return this.bodies[uid] ?? null;
  }
}

function buildStore(): InMemoryTripleStore {
  const store = new InMemoryTripleStore();
  // asset --isDefinedBy--> src-onto --archiveOntology--> archive-onto
  store.add(new Triple(new IRI(ASSET), new IRI(ISDEFINEDBY), new IRI(SRC_ONTO)));
  store.add(
    new Triple(
      new IRI(SRC_ONTO),
      new IRI(ARCHIVE_ONTO),
      new IRI(ARCHIVE_ONTO_FILE),
    ),
  );
  // asset --votes--> "42" (literal)
  store.add(new Triple(new IRI(ASSET), new IRI(VOTES), new Literal("42")));
  return store;
}

describe("NamedQueryRunner.runScalar", () => {
  it("returns IRI scalar reverse-mapped to its Obsidian basename (archive 1-hop)", async () => {
    const store = buildStore();
    const resolver = new MapQueryBodyResolver({
      q1: `SELECT ?a WHERE { $currentAsset <${ISDEFINEDBY}> ?o . ?o <${ARCHIVE_ONTO}> ?a }`,
    });
    const runner = new NamedQueryRunner(resolver, store);

    const scalar = await runner.runScalar("q1", { currentAsset: ASSET });

    expect(scalar).toEqual({ value: "9f1c0b2a-archive", kind: "iri" });
  });

  it("returns literal scalar with its lexical value", async () => {
    const store = buildStore();
    const resolver = new MapQueryBodyResolver({
      q2: `SELECT ?n WHERE { $currentAsset <${VOTES}> ?n }`,
    });
    const runner = new NamedQueryRunner(resolver, store);

    const scalar = await runner.runScalar("q2", { currentAsset: ASSET });

    expect(scalar).toEqual({ value: "42", kind: "literal" });
  });

  it("returns boolean scalar for ASK queries", async () => {
    const store = buildStore();
    const resolver = new MapQueryBodyResolver({
      qAskTrue: `ASK { $currentAsset <${ISDEFINEDBY}> ?o }`,
      qAskFalse: `ASK { $currentAsset <${ARCHIVE_ONTO}> ?o }`,
    });
    const runner = new NamedQueryRunner(resolver, store);

    expect(await runner.runScalar("qAskTrue", { currentAsset: ASSET })).toEqual({
      value: "true",
      kind: "literal",
    });
    expect(
      await runner.runScalar("qAskFalse", { currentAsset: ASSET }),
    ).toEqual({ value: "false", kind: "literal" });
  });

  it("auto-injects $currentClass as a controlled IRI", async () => {
    const store = new InMemoryTripleStore();
    const CLASS = "obsidian://vault/onto/some-class.md";
    const INSTANCE_OF = `${EXO}#Instance_class`;
    store.add(new Triple(new IRI(ASSET), new IRI(INSTANCE_OF), new IRI(CLASS)));
    // query keyed on $currentClass — proves the token was substituted to <CLASS>
    const resolver = new MapQueryBodyResolver({
      qClass: `SELECT ?s WHERE { ?s <${INSTANCE_OF}> $currentClass }`,
    });
    const runner = new NamedQueryRunner(resolver, store);

    const scalar = await runner.runScalar("qClass", {
      currentAsset: ASSET,
      currentClass: CLASS,
    });

    expect(scalar).toEqual({ value: "asset-1", kind: "iri" });
  });

  it("substitutes explicit IRI params (controlled <iri> form)", async () => {
    const store = buildStore();
    const resolver = new MapQueryBodyResolver({
      qParam: `SELECT ?a WHERE { $srcOnto <${ARCHIVE_ONTO}> ?a }`,
    });
    const runner = new NamedQueryRunner(resolver, store);

    const scalar = await runner.runScalar("qParam", {
      params: { srcOnto: { value: SRC_ONTO, kind: "iri" } },
    });

    expect(scalar).toEqual({ value: "9f1c0b2a-archive", kind: "iri" });
  });

  it("returns null when the SELECT produces no rows", async () => {
    const store = buildStore();
    const resolver = new MapQueryBodyResolver({
      qEmpty: `SELECT ?a WHERE { $currentAsset <${ARCHIVE_ONTO}> ?a }`,
    });
    const runner = new NamedQueryRunner(resolver, store);

    expect(await runner.runScalar("qEmpty", { currentAsset: ASSET })).toBeNull();
  });

  it("throws fail-loud when the NamedQuery body cannot be resolved", async () => {
    const store = buildStore();
    const resolver = new MapQueryBodyResolver({ q1: null });
    const runner = new NamedQueryRunner(resolver, store);

    await expect(
      runner.runScalar("missing-uid", { currentAsset: ASSET }),
    ).rejects.toThrow(/no resolvable SPARQL body/);
  });

  it("is read-only — a mutation body is rejected by the engine allowlist", async () => {
    const store = buildStore();
    const resolver = new MapQueryBodyResolver({
      qMutate: `INSERT DATA { <${ASSET}> <${VOTES}> "999" }`,
    });
    const runner = new NamedQueryRunner(resolver, store);

    // Typed assertion: the engine allowlist rejects UPDATE at parse stage, so
    // the read-only guarantee is the SPECIFIC ExoQLForbiddenKeywordError, not
    // any incidental throw (code-reviewer LOW — guard against silent regression
    // where a future parser change throws for an unrelated reason).
    await expect(
      runner.runScalar("qMutate", { currentAsset: ASSET }),
    ).rejects.toBeInstanceOf(ExoQLForbiddenKeywordError);
  });

  it("refuses a malformed IRI param (no IRIREF break-out)", async () => {
    const store = buildStore();
    const resolver = new MapQueryBodyResolver({
      qInj: `SELECT ?a WHERE { $p <${ARCHIVE_ONTO}> ?a }`,
    });
    const runner = new NamedQueryRunner(resolver, store);

    await expect(
      runner.runScalar("qInj", {
        params: { p: { value: "x> ?a ?b . ?evil <y", kind: "iri" } },
      }),
    ).rejects.toThrow(/malformed IRI/);
  });
});

describe("NamedQueryRunner.run (envelope)", () => {
  it("returns the select envelope with rows", async () => {
    const store = buildStore();
    const resolver = new MapQueryBodyResolver({
      q1: `SELECT ?o WHERE { $currentAsset <${ISDEFINEDBY}> ?o }`,
    });
    const runner = new NamedQueryRunner(resolver, store);

    const result = await runner.run("q1", { currentAsset: ASSET });

    expect(result?.kind).toBe("select");
    if (result?.kind === "select") {
      expect(result.rows.length).toBe(1);
    }
  });

  it("returns null (not throw) for a missing body via run()", async () => {
    const store = buildStore();
    const resolver = new MapQueryBodyResolver({});
    const runner = new NamedQueryRunner(resolver, store);

    expect(await runner.run("nope", { currentAsset: ASSET })).toBeNull();
  });
});
