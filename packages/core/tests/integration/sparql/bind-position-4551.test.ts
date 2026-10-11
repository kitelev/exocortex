/**
 * Production-shape integration test: a SPARQL BIND extends the group prefix AT ITS
 * POSITION — a later pattern joins with the bound value (req 60ed88e7, issue #4551,
 * SPARQL 1.1 §18.2.2.4; RFC 14217015 decision №6).
 *
 * ## The defect
 *
 * `PatternTranslator.translateWhere` collected every BIND of a group and wrapped the
 * finished join of all the other patterns in `Extend`. `{ BIND(P AS ?p) ?s ?p ?o }`
 * became `Extend(?p = P)(BGP[?s ?p ?o])`: the BGP ran with ?p FREE (every triple of
 * the store) and the Extend overwrote ?p in each row afterwards — 147 576 rows
 * instead of 2 in the reviewer's vault.
 *
 * ## The pipeline under test
 *
 * The one `exocortex-cli query` runs: `SPARQLParser` → `ExoQLAlgebraTranslator` →
 * `AlgebraOptimizer.optimize` → `ExoQLQueryExecutor` (class + property hierarchy
 * decorators). The store is built by the REAL converter over fixture notes, so the
 * predicate IRIs, label forms and `exo__Property_superProperty` edges are exactly
 * what production emits.
 *
 * Revert-verify: `bind-position-4551-*.spec.json` (one spec per changed source file)
 * remove one guarantee each and name the axes that must turn red.
 */

import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import type { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { AlgebraOptimizer } from "../../../src/infrastructure/sparql/algebra/AlgebraOptimizer";
import type { AlgebraOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import type { Subject, Predicate, Object as RDFObject } from "../../../src/domain/models/rdf/Triple";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

const ei = (local: string) => Namespace.forPrefix("exoization-ideas")!.term(local).value;
const VIDEO = ei("ExoizationIdea_video");

let seq = 0;
const uid = () => `b1d45510-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const fileIri = (u: string) => `obsidian://vault/${u}.md`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (u: string, fm: IFrontmatter): FixtureNote => ({ uid: u, frontmatter: { exo__Asset_uid: u, ...fm } });

// ---------------------------------------------------------------- TBox
const U = { ideaClass: uid(), exoizable: uid(), video: uid(), book: uid() };
const prop = (u: string, label: string, parent?: string): FixtureNote =>
  note(u, { exo__Asset_label: label, ...(parent ? { exo__Property_superProperty: `[[${parent}]]` } : {}) });

const TBOX: FixtureNote[] = [
  note(U.ideaClass, { exo__Asset_label: "exoization-ideas__ExoizationIdea" }),
  prop(U.exoizable, "exoization-ideas__ExoizationIdea_exoizable"),
  prop(U.video, "exoization-ideas__ExoizationIdea_video", U.exoizable),
  prop(U.book, "exoization-ideas__ExoizationIdea_book", U.exoizable),
];

// ---------------------------------------------------------------- sources + ideas
const S = { generic: uid(), v1: uid(), v2: uid(), book: uid() };
const SOURCES: FixtureNote[] = [
  note(S.generic, { exo__Asset_label: "A generic source" }),
  note(S.v1, { exo__Asset_label: "Video one" }),
  note(S.v2, { exo__Asset_label: "Video two" }),
  note(S.book, { exo__Asset_label: "A book" }),
];
const idea = (u: string, label: string, fm: IFrontmatter): FixtureNote =>
  note(u, { exo__Asset_label: label, exo__Instance_class: `[[${U.ideaClass}]]`, ...fm });
const I = { direct: uid(), v1: uid(), v2: uid(), book: uid() };
const IDEAS: FixtureNote[] = [
  idea(I.direct, "Idea generic", { "exoization-ideas__ExoizationIdea_exoizable": `[[${S.generic}]]` }),
  idea(I.v1, "Idea one video", { "exoization-ideas__ExoizationIdea_video": `[[${S.v1}]]` }),
  idea(I.v2, "Idea two video", { "exoization-ideas__ExoizationIdea_video": `[[${S.v2}]]` }),
  idea(I.book, "Idea book", { "exoization-ideas__ExoizationIdea_book": `[[${S.book}]]` }),
];

// Unrelated notes: the store must hold far more triples than any expected answer,
// so a pattern that runs with ?p FREE is visibly wrong (the 147 576 of #4551).
const NOISE: FixtureNote[] = Array.from({ length: 40 }, (_, i) =>
  note(uid(), { exo__Asset_label: `Noise ${i}`, "exoization-ideas__ExoizationIdea_note": `n${i}` }),
);

const NOTES = [...TBOX, ...SOURCES, ...IDEAS, ...NOISE];

// ---------------------------------------------------------------- harness
function makeFile(u: string): IFile {
  return { path: `${u}.md`, basename: u, name: `${u}.md`, extension: "md", parent: null } as unknown as IFile;
}

async function convertAll(notes: FixtureNote[]): Promise<Triple[]> {
  const files = notes.map((n) => makeFile(n.uid));
  const fmByPath = new Map<string, IFrontmatter>();
  const fileByLinkpath = new Map<string, IFile>();
  notes.forEach((n, i) => {
    fmByPath.set(files[i].path, n.frontmatter);
    fileByLinkpath.set(n.uid, files[i]);
  });
  const vault = {
    getAllFiles: jest.fn(() => files),
    getFrontmatter: jest.fn((f: IFile) => fmByPath.get(f.path) ?? null),
    getFirstLinkpathDest: jest.fn((linkpath: string) => fileByLinkpath.get(linkpath) ?? null),
    read: jest.fn().mockResolvedValue(""),
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getAbstractFileByPath: jest.fn(),
    updateFrontmatter: jest.fn(),
    rename: jest.fn(),
    createFolder: jest.fn(),
    process: jest.fn(),
    updateLinks: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
  } as unknown as jest.Mocked<IVaultAdapter>;
  const converter = new NoteToRDFConverter(vault);
  const out: Triple[] = [];
  for (const f of files) out.push(...(await converter.convertNote(f)));
  return out;
}

/** Records the predicate of every `match` the engine makes against the raw store. */
class CountingStore extends InMemoryTripleStore {
  readonly predicateCalls: string[] = [];
  override async match(subject?: Subject, predicate?: Predicate, object?: RDFObject): Promise<Triple[]> {
    this.predicateCalls.push(predicate?.value ?? "*");
    return super.match(subject, predicate, object);
  }
}

let store: CountingStore;
beforeAll(async () => {
  store = new CountingStore();
  await store.addAll(await convertAll(NOTES));
});

const fmt = (term: unknown): string =>
  term instanceof IRI ? `<${term.value}>` : term === undefined ? "∅" : String(term);

const parser = new SPARQLParser();
const translator = new ExoQLAlgebraTranslator();
const PREFIX = `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX eideas: <https://exocortex.my/ontology/exoization-ideas#>`;

/** The algebra `exocortex-cli query` executes: translated, then optimized. */
const plan = (sparql: string): AlgebraOperation =>
  new AlgebraOptimizer().optimize(translator.translate(parser.parse(`${PREFIX}\n${sparql}`)));

async function rows(sparql: string, vars: string[]): Promise<string[]> {
  const solutions = await new ExoQLQueryExecutor(store).executeAll(plan(sparql));
  return solutions.map((s) => vars.map((v) => fmt(s.get(v))).join(" | ")).sort();
}

async function count(sparql: string): Promise<number> {
  const [only] = await rows(sparql, ["n"]);
  return Number(only.replace(/^"?(\d+)".*$/, "$1"));
}

const pair = (a: string, b: string) => `<${fileIri(a)}> | <${fileIri(b)}>`;

/** #4551 F1 — a constant predicate chosen by a BIND before the pattern. */
const F1 = `SELECT (COUNT(*) AS ?n) WHERE { BIND(eideas:ExoizationIdea_video AS ?p) ?idea ?p ?src }`;

describe("BIND extends the group prefix at its position (req 60ed88e7, #4551)", () => {
  it("B1 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a constant BIND before a pattern restricts it: F1 counts 2, as the constant predicate does", async () => {
    // Input is built: the store is large, the predicate occurs exactly twice.
    expect(await store.count()).toBeGreaterThan(100);
    expect(await count(`SELECT (COUNT(*) AS ?n) WHERE { ?idea eideas:ExoizationIdea_video ?src }`)).toBe(2);
    expect(await count(F1)).toBe(2);
    expect(await rows(`SELECT ?idea ?src WHERE { BIND(eideas:ExoizationIdea_video AS ?p) ?idea ?p ?src }`, ["idea", "src"])).toEqual(
      [pair(I.v1, S.v1), pair(I.v2, S.v2)].sort(),
    );
  });

  it("B2 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a computed BIND between two patterns joins with the later pattern (#4551 second case)", async () => {
    const q = `SELECT ?idea ?src WHERE {
      ?pf exo:Property_superProperty eideas:ExoizationIdea_exoizable .
      ?pf exo:Asset_label ?pl .
      BIND(IRI(STR(?pl)) AS ?p)
      ?idea ?p ?src }`;
    // Input is built: two sub-properties, their labels are the predicate IRIs.
    expect(
      await rows(`SELECT ?pl WHERE { ?pf exo:Property_superProperty eideas:ExoizationIdea_exoizable . ?pf exo:Asset_label ?pl }`, ["pl"]),
    ).toEqual([`<${ei("ExoizationIdea_book")}>`, `<${VIDEO}>`].sort());
    expect(await rows(q, ["idea", "src"])).toEqual([pair(I.v1, S.v1), pair(I.v2, S.v2), pair(I.book, S.book)].sort());
  });

  it("B3 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND reads only the variables bound BEFORE it", async () => {
    const before = await rows(`SELECT ?s ?y WHERE { BIND(STR(?x) AS ?y) ?s exo:Asset_label ?x }`, ["s", "y"]);
    expect(before).toHaveLength(NOTES.length);
    expect(before.every((r) => r.endsWith("| ∅"))).toBe(true);
    // Control: the same BIND AFTER the pattern binds ?y in every row.
    const after = await rows(`SELECT ?s ?y WHERE { ?s exo:Asset_label ?x BIND(STR(?x) AS ?y) }`, ["s", "y"]);
    expect(after).toHaveLength(NOTES.length);
    expect(after.some((r) => r.endsWith("| ∅"))).toBe(false);
  });

  it("B4 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a FILTER stays group-scoped: written first, it sees a BIND made later in the group", async () => {
    expect(
      await rows(`SELECT ?s WHERE { FILTER(?y = "Idea one video") ?s exo:Asset_label ?x BIND(STR(?x) AS ?y) }`, ["s"]),
    ).toEqual([`<${fileIri(I.v1)}>`]);
  });

  it("B5 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 the bound predicate is looked up in the store, not scanned", async () => {
    await count(F1); // warm: the decorators build their indexes once per store
    store.predicateCalls.length = 0;
    expect(await count(F1)).toBe(2);
    expect(store.predicateCalls).toContain(VIDEO);
    expect(store.predicateCalls).not.toContain("*");
  });

  it("B6 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a predicate bound by a BIND is matched as stored — no sub-property widening, as when bound inside one BGP", async () => {
    const direct = [pair(I.direct, S.generic)];
    expect(await rows(`SELECT ?idea ?src WHERE { BIND(eideas:ExoizationIdea_exoizable AS ?p) ?idea ?p ?src }`, ["idea", "src"])).toEqual(direct);
    expect(
      await rows(`SELECT ?idea ?src WHERE { <${fileIri(U.exoizable)}> exo:Asset_label ?p . ?idea ?p ?src }`, ["idea", "src"]),
    ).toEqual(direct);
    // Control: the predicate written as a CONSTANT is widened to its sub-properties.
    expect(await rows(`SELECT ?idea ?src WHERE { ?idea eideas:ExoizationIdea_exoizable ?src }`, ["idea", "src"])).toEqual(
      [pair(I.direct, S.generic), pair(I.v1, S.v1), pair(I.v2, S.v2), pair(I.book, S.book)].sort(),
    );
  });

  it("B7 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 the optimizer does not move a constrained later pattern ahead of the BIND", async () => {
    // A plain copy (not STR/CONCAT): unbound ?x leaves ?y unbound, a value a bind
    // join substitutes into the expression binds it. STR(<substituted node>) errors
    // and CONCAT accepts an unbound argument as "" — both would hide the overtaking.
    const q = `SELECT ?s ?y WHERE {
      BIND(?x AS ?y)
      ?s exo:Asset_label ?x .
      ?s exo:Instance_class eideas:ExoizationIdea }`;
    // Input is built: the later BGP is CONSTRAINED (concrete object) — the shape the
    // join reordering would otherwise move to the left of the BIND.
    const got = await rows(q, ["s", "y"]);
    expect(got).toHaveLength(IDEAS.length);
    expect(got.every((r) => r.endsWith("| ∅"))).toBe(true);
  });

  it("B8 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 an OPTIONAL after a BIND joins with the bound value", async () => {
    expect(
      await rows(`SELECT ?idea ?src WHERE { BIND(<${fileIri(S.v1)}> AS ?src) OPTIONAL { ?idea eideas:ExoizationIdea_video ?src } }`, ["idea", "src"]),
    ).toEqual([pair(I.v1, S.v1)]);
  });

  it("B9 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a MINUS after a BIND subtracts by the bound value", async () => {
    const minus = (src: string) =>
      rows(`SELECT ?src WHERE { BIND(<${fileIri(src)}> AS ?src) MINUS { ?idea eideas:ExoizationIdea_video ?src } }`, ["src"]);
    expect(await minus(S.v1)).toEqual([]);
    // Control: a value no video idea uses is kept.
    expect(await minus(S.generic)).toEqual([`<${fileIri(S.generic)}>`]);
  });

  it("B10 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 the plan puts the Extend under the join, on its left", () => {
    const join = (function find(op: AlgebraOperation): AlgebraOperation | null {
      if (op.type === "join") return op;
      const child = (op as unknown as { input?: AlgebraOperation }).input;
      return child ? find(child) : null;
    })(plan(F1));
    expect(join?.type).toBe("join");
    if (join?.type !== "join") return;
    expect(join.left.type).toBe("extend");
    expect(join.right.type).toBe("bgp");
  });

  it("B11 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND first in each UNION branch restricts its own branch", async () => {
    const q = `SELECT ?idea ?src WHERE {
      { BIND(eideas:ExoizationIdea_video AS ?p) ?idea ?p ?src }
      UNION
      { BIND(eideas:ExoizationIdea_book AS ?p) ?idea ?p ?src } }`;
    expect(await rows(q, ["idea", "src"])).toEqual([pair(I.v1, S.v1), pair(I.v2, S.v2), pair(I.book, S.book)].sort());
  });

  it("B13 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 IRI(…) builds an IRI term — the #4551 expression shape joins with the later pattern", async () => {
    // The expression of the issue's second case, over a label held as a literal.
    const q = (fn: string) => `SELECT ?idea ?src WHERE {
      BIND("exoization-ideas__ExoizationIdea_video" AS ?pl)
      BIND(${fn}(CONCAT("https://exocortex.my/ontology/", REPLACE(STR(?pl), "__", "#"))) AS ?p)
      ?idea ?p ?src }`;
    const videos = [pair(I.v1, S.v1), pair(I.v2, S.v2)].sort();
    expect(await rows(q("IRI"), ["idea", "src"])).toEqual(videos);
    // An IRI argument is returned as is; a non-string argument is an error (unbound).
    expect(await rows(`SELECT ?p WHERE { BIND(IRI(eideas:ExoizationIdea_video) AS ?p) }`, ["p"])).toEqual([`<${VIDEO}>`]);
    expect(await rows(`SELECT ?p WHERE { BIND(IRI(42) AS ?p) }`, ["p"])).toEqual(["∅"]);
  });

  it("B14 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND of a constant IRI binds the IRI term, which FILTERs still compare with the constant", async () => {
    expect(await rows(`SELECT ?p WHERE { BIND(eideas:ExoizationIdea_video AS ?p) }`, ["p"])).toEqual([`<${VIDEO}>`]);
    expect(
      await rows(`SELECT ?p WHERE { BIND(eideas:ExoizationIdea_video AS ?p) FILTER(?p = eideas:ExoizationIdea_video) }`, ["p"]),
    ).toEqual([`<${VIDEO}>`]);
    expect(await rows(`SELECT ?p WHERE { BIND(eideas:ExoizationIdea_video AS ?p) FILTER(STR(?p) = "${VIDEO}") }`, ["p"])).toEqual([`<${VIDEO}>`]);
  });

  it("B17 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 URI(…) is the synonym of IRI(…)", async () => {
    const q = `SELECT ?idea ?src WHERE {
      BIND("exoization-ideas__ExoizationIdea_video" AS ?pl)
      BIND(URI(CONCAT("https://exocortex.my/ontology/", REPLACE(STR(?pl), "__", "#"))) AS ?p)
      ?idea ?p ?src }`;
    expect(await rows(q, ["idea", "src"])).toEqual([pair(I.v1, S.v1), pair(I.v2, S.v2)].sort());
  });

  it("B15 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND-bound predicate in a LATER triple of the joined BGP is matched as stored too", async () => {
    const q = `SELECT ?idea ?src WHERE {
      BIND(eideas:ExoizationIdea_exoizable AS ?p)
      ?idea exo:Instance_class eideas:ExoizationIdea .
      ?idea ?p ?src }`;
    expect(await rows(q, ["idea", "src"])).toEqual([pair(I.direct, S.generic)]);
  });

  it("B16 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND deeper in the join's left operand is not overtaken either", async () => {
    const q = `SELECT ?s ?y WHERE {
      BIND(?x AS ?y)
      OPTIONAL { ?s exo:Asset_uid ?u }
      ?s exo:Asset_label ?x .
      ?s exo:Instance_class eideas:ExoizationIdea }`;
    const got = await rows(q, ["s", "y"]);
    expect(got).toHaveLength(IDEAS.length);
    expect(got.every((r) => r.endsWith("| ∅"))).toBe(true);
  });

  it("B12 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND reading an earlier BIND chains, and the later pattern joins with the result", async () => {
    const q = `SELECT ?idea ?src WHERE {
      BIND("ExoizationIdea_video" AS ?local)
      BIND(IRI(CONCAT("https://exocortex.my/ontology/exoization-ideas#", ?local)) AS ?p)
      ?idea ?p ?src }`;
    expect(await rows(q, ["idea", "src"])).toEqual([pair(I.v1, S.v1), pair(I.v2, S.v2)].sort());
  });
});
