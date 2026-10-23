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
import type {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { AlgebraOptimizer } from "../../../src/infrastructure/sparql/algebra/AlgebraOptimizer";
import { SPARQLGenerator } from "../../../src/infrastructure/sparql/algebra/SPARQLGenerator";
import type { AlgebraOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import type {
  Subject,
  Predicate,
  Object as RDFObject,
} from "../../../src/domain/models/rdf/Triple";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

const ei = (local: string) =>
  Namespace.forPrefix("exoization-ideas")!.term(local).value;
const VIDEO = ei("ExoizationIdea_video");

let seq = 0;
const uid = () =>
  `b1d45510-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const fileIri = (u: string) => `obsidian://vault/${u}.md`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (u: string, fm: IFrontmatter): FixtureNote => ({
  uid: u,
  frontmatter: { exo__Asset_uid: u, ...fm },
});

// ---------------------------------------------------------------- TBox
const U = { ideaClass: uid(), exoizable: uid(), video: uid(), book: uid() };
const prop = (u: string, label: string, parent?: string): FixtureNote =>
  note(u, {
    exo__Asset_label: label,
    ...(parent ? { exo__Property_superProperty: `[[${parent}]]` } : {}),
  });

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
  note(u, {
    exo__Asset_label: label,
    exo__Instance_class: `[[${U.ideaClass}]]`,
    ...fm,
  });
const I = { direct: uid(), v1: uid(), v2: uid(), book: uid() };
const IDEAS: FixtureNote[] = [
  idea(I.direct, "Idea generic", {
    "exoization-ideas__ExoizationIdea_exoizable": `[[${S.generic}]]`,
  }),
  idea(I.v1, "Idea one video", {
    "exoization-ideas__ExoizationIdea_video": `[[${S.v1}]]`,
  }),
  idea(I.v2, "Idea two video", {
    "exoization-ideas__ExoizationIdea_video": `[[${S.v2}]]`,
  }),
  idea(I.book, "Idea book", {
    "exoization-ideas__ExoizationIdea_book": `[[${S.book}]]`,
  }),
];

// Unrelated notes: the store must hold far more triples than any expected answer,
// so a pattern that runs with ?p FREE is visibly wrong (the 147 576 of #4551).
const NOISE: FixtureNote[] = Array.from({ length: 40 }, (_, i) =>
  note(uid(), {
    exo__Asset_label: `Noise ${i}`,
    "exoization-ideas__ExoizationIdea_note": `n${i}`,
  }),
);

const NOTES = [...TBOX, ...SOURCES, ...IDEAS, ...NOISE];

// ---------------------------------------------------------------- harness
function makeFile(u: string): IFile {
  return {
    path: `${u}.md`,
    basename: u,
    name: `${u}.md`,
    extension: "md",
    parent: null,
  } as unknown as IFile;
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
    getFirstLinkpathDest: jest.fn(
      (linkpath: string) => fileByLinkpath.get(linkpath) ?? null,
    ),
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
  override async match(
    subject?: Subject,
    predicate?: Predicate,
    object?: RDFObject,
  ): Promise<Triple[]> {
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
  term instanceof IRI
    ? `<${term.value}>`
    : term === undefined
      ? "∅"
      : String(term);

const parser = new SPARQLParser();
const translator = new ExoQLAlgebraTranslator();
const PREFIX = `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX eideas: <https://exocortex.my/ontology/exoization-ideas#>`;

/** The algebra `exocortex-cli query` executes: translated, then optimized. */
const plan = (sparql: string): AlgebraOperation =>
  new AlgebraOptimizer().optimize(
    translator.translate(parser.parse(`${PREFIX}\n${sparql}`)),
  );

async function rows(sparql: string, vars: string[]): Promise<string[]> {
  const solutions = await new ExoQLQueryExecutor(store).executeAll(
    plan(sparql),
  );
  return solutions
    .map((s) => vars.map((v) => fmt(s.get(v))).join(" | "))
    .sort();
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
    expect(
      await count(
        `SELECT (COUNT(*) AS ?n) WHERE { ?idea eideas:ExoizationIdea_video ?src }`,
      ),
    ).toBe(2);
    expect(await count(F1)).toBe(2);
    expect(
      await rows(
        `SELECT ?idea ?src WHERE { BIND(eideas:ExoizationIdea_video AS ?p) ?idea ?p ?src }`,
        ["idea", "src"],
      ),
    ).toEqual([pair(I.v1, S.v1), pair(I.v2, S.v2)].sort());
  });

  it("B2 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a computed BIND between two patterns joins with the later pattern (#4551 second case)", async () => {
    const q = `SELECT ?idea ?src WHERE {
      ?pf exo:Property_superProperty eideas:ExoizationIdea_exoizable .
      ?pf exo:Asset_label ?pl .
      BIND(IRI(STR(?pl)) AS ?p)
      ?idea ?p ?src }`;
    // Input is built: two sub-properties, their labels are the predicate IRIs.
    expect(
      await rows(
        `SELECT ?pl WHERE { ?pf exo:Property_superProperty eideas:ExoizationIdea_exoizable . ?pf exo:Asset_label ?pl }`,
        ["pl"],
      ),
    ).toEqual([`<${ei("ExoizationIdea_book")}>`, `<${VIDEO}>`].sort());
    expect(await rows(q, ["idea", "src"])).toEqual(
      [pair(I.v1, S.v1), pair(I.v2, S.v2), pair(I.book, S.book)].sort(),
    );
  });

  it("B3 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND reads only the variables bound BEFORE it", async () => {
    const before = await rows(
      `SELECT ?s ?y WHERE { BIND(STR(?x) AS ?y) ?s exo:Asset_label ?x }`,
      ["s", "y"],
    );
    expect(before).toHaveLength(NOTES.length);
    expect(before.every((r) => r.endsWith("| ∅"))).toBe(true);
    // Control: the same BIND AFTER the pattern binds ?y in every row.
    const after = await rows(
      `SELECT ?s ?y WHERE { ?s exo:Asset_label ?x BIND(STR(?x) AS ?y) }`,
      ["s", "y"],
    );
    expect(after).toHaveLength(NOTES.length);
    expect(after.some((r) => r.endsWith("| ∅"))).toBe(false);
  });

  it("B4 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a FILTER stays group-scoped: written first, it sees a BIND made later in the group", async () => {
    expect(
      await rows(
        `SELECT ?s WHERE { FILTER(?y = "Idea one video") ?s exo:Asset_label ?x BIND(STR(?x) AS ?y) }`,
        ["s"],
      ),
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
    expect(
      await rows(
        `SELECT ?idea ?src WHERE { BIND(eideas:ExoizationIdea_exoizable AS ?p) ?idea ?p ?src }`,
        ["idea", "src"],
      ),
    ).toEqual(direct);
    expect(
      await rows(
        `SELECT ?idea ?src WHERE { <${fileIri(U.exoizable)}> exo:Asset_label ?p . ?idea ?p ?src }`,
        ["idea", "src"],
      ),
    ).toEqual(direct);
    // Control: the predicate written as a CONSTANT is widened to its sub-properties.
    expect(
      await rows(
        `SELECT ?idea ?src WHERE { ?idea eideas:ExoizationIdea_exoizable ?src }`,
        ["idea", "src"],
      ),
    ).toEqual(
      [
        pair(I.direct, S.generic),
        pair(I.v1, S.v1),
        pair(I.v2, S.v2),
        pair(I.book, S.book),
      ].sort(),
    );
  });

  it("B7 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 the optimizer does not move a constrained later pattern ahead of the BIND", async () => {
    // A plain copy (not STR/CONCAT): unbound ?x leaves ?y unbound, a value a bind
    // join substitutes into the expression binds it. STR(<substituted IRI node>)
    // errors (ems__Bug 4e3ce943) and CONCAT of an unbound argument is an error
    // (ems__Bug 37c80e59) — both would hide the overtaking.
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
      await rows(
        `SELECT ?idea ?src WHERE { BIND(<${fileIri(S.v1)}> AS ?src) OPTIONAL { ?idea eideas:ExoizationIdea_video ?src } }`,
        ["idea", "src"],
      ),
    ).toEqual([pair(I.v1, S.v1)]);
  });

  it("B9 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a MINUS after a BIND subtracts by the bound value", async () => {
    const minus = (src: string) =>
      rows(
        `SELECT ?src WHERE { BIND(<${fileIri(src)}> AS ?src) MINUS { ?idea eideas:ExoizationIdea_video ?src } }`,
        ["src"],
      );
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
    expect(await rows(q, ["idea", "src"])).toEqual(
      [pair(I.v1, S.v1), pair(I.v2, S.v2), pair(I.book, S.book)].sort(),
    );
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
    expect(
      await rows(
        `SELECT ?p WHERE { BIND(IRI(eideas:ExoizationIdea_video) AS ?p) }`,
        ["p"],
      ),
    ).toEqual([`<${VIDEO}>`]);
    expect(
      await rows(`SELECT ?p WHERE { BIND(IRI(42) AS ?p) }`, ["p"]),
    ).toEqual(["∅"]);
  });

  it("B14 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND of a constant IRI binds the IRI term, which FILTERs still compare with the constant", async () => {
    expect(
      await rows(
        `SELECT ?p WHERE { BIND(eideas:ExoizationIdea_video AS ?p) }`,
        ["p"],
      ),
    ).toEqual([`<${VIDEO}>`]);
    expect(
      await rows(
        `SELECT ?p WHERE { BIND(eideas:ExoizationIdea_video AS ?p) FILTER(?p = eideas:ExoizationIdea_video) }`,
        ["p"],
      ),
    ).toEqual([`<${VIDEO}>`]);
    expect(
      await rows(
        `SELECT ?p WHERE { BIND(eideas:ExoizationIdea_video AS ?p) FILTER(STR(?p) = "${VIDEO}") }`,
        ["p"],
      ),
    ).toEqual([`<${VIDEO}>`]);
  });

  it("B17 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 URI(…) is the synonym of IRI(…)", async () => {
    const q = `SELECT ?idea ?src WHERE {
      BIND("exoization-ideas__ExoizationIdea_video" AS ?pl)
      BIND(URI(CONCAT("https://exocortex.my/ontology/", REPLACE(STR(?pl), "__", "#"))) AS ?p)
      ?idea ?p ?src }`;
    expect(await rows(q, ["idea", "src"])).toEqual(
      [pair(I.v1, S.v1), pair(I.v2, S.v2)].sort(),
    );
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
    // Two levels down (round 6: the order gate reads the LEFT operand, so the Extend
    // must be found as a grandchild of it, not only as a child).
    const deeper = await rows(
      `SELECT ?s ?y WHERE { BIND(?x AS ?y) OPTIONAL { ?s exo:Asset_uid ?u } OPTIONAL { ?s exo:Asset_createdAt ?c } ?s exo:Asset_label ?x . ?s exo:Instance_class eideas:ExoizationIdea }`,
      ["s", "y"],
    );
    expect(deeper).toHaveLength(IDEAS.length);
    expect(deeper.every((r) => r.endsWith("| ∅"))).toBe(true);
  });

  // ---- Review round 1 (PR #4557) ----

  it("B18 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND mid-group keeps a group FILTER on a shared variable working", async () => {
    const target = `<${fileIri(I.v1)}>`;
    const withBind = (filter: string) =>
      rows(
        `SELECT ?s ?p ?o WHERE { ?s exo:Asset_label ?l BIND(STR(?l) AS ?y) ?s ?p ?o FILTER(${filter}) }`,
        ["s", "p", "o"],
      );
    const without = (filter: string) =>
      rows(
        `SELECT ?s ?p ?o WHERE { ?s exo:Asset_label ?l . ?s ?p ?o FILTER(${filter}) }`,
        ["s", "p", "o"],
      );
    for (const filter of [
      `?s = ${target}`,
      `CONTAINS(STR(?s), "${I.v1}")`,
      `?s != ${target}`,
    ]) {
      const expected = await without(filter);
      // Input is built: the filter keeps some rows and drops others.
      expect(expected.length).toBeGreaterThan(0);
      expect(await withBind(filter)).toEqual(expected);
    }
  });

  it("B19 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND does not capture a variable a subquery does not project", async () => {
    const all = await count(
      `SELECT (COUNT(*) AS ?n) WHERE { { SELECT ?idea WHERE { ?idea ?p ?src } } }`,
    );
    expect(all).toBe(await store.count());
    expect(
      await count(
        `SELECT (COUNT(*) AS ?n) WHERE { BIND(eideas:ExoizationIdea_video AS ?p) { SELECT ?idea WHERE { ?idea ?p ?src } } }`,
      ),
    ).toBe(all);
    // Control: a PROJECTED ?p joins with the bound value.
    expect(
      await count(
        `SELECT (COUNT(*) AS ?n) WHERE { BIND(eideas:ExoizationIdea_video AS ?p) { SELECT ?idea ?p WHERE { ?idea ?p ?src } } }`,
      ),
    ).toBe(2);
  });

  it("B20 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 the UUID-index filter rewrite constrains the patterns before a BIND too", async () => {
    const run = async (sparql: string) => {
      const op = new AlgebraOptimizer().optimizeWithSubjects(
        translator.translate(parser.parse(`${PREFIX}\n${sparql}`)),
        [fileIri(I.v1)],
      );
      return (await new ExoQLQueryExecutor(store).executeAll(op)).length;
    };
    const filter = `FILTER(CONTAINS(STR(?s), "${I.v1}"))`;
    const expected = await run(
      `SELECT ?p ?o WHERE { ?s exo:Asset_label ?l . ?s ?p ?o ${filter} }`,
    );
    expect(expected).toBeGreaterThan(0);
    expect(
      await run(
        `SELECT ?p ?o WHERE { ?s exo:Asset_label ?l BIND(STR(?l) AS ?y) ?s ?p ?o ${filter} }`,
      ),
    ).toBe(expected);
  });

  it("B21 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 the SPARQL generator writes a BIND of an IRI back as an IRI", () => {
    const op = translator.translate(
      parser.parse(
        `${PREFIX}\nSELECT ?s ?o WHERE { BIND(eideas:ExoizationIdea_video AS ?p) ?s ?p ?o }`,
      ),
    );
    const text = new SPARQLGenerator().generateSelect(op);
    expect(text).toContain(`BIND(<${VIDEO}> AS ?p)`);
  });

  // ---- Review round 2 (PR #4557) ----

  it("B22 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND mid-group keeps a FILTER reading a shared AND a right-only variable working", async () => {
    const withBind = (filter: string) =>
      rows(
        `SELECT ?s ?p ?o WHERE { ?s exo:Asset_label ?l BIND(STR(?l) AS ?y) ?s ?p ?o FILTER(${filter}) }`,
        ["s", "p", "o"],
      );
    const without = (filter: string) =>
      rows(
        `SELECT ?s ?p ?o WHERE { ?s exo:Asset_label ?l . ?s ?p ?o FILTER(${filter}) }`,
        ["s", "p", "o"],
      );
    for (const filter of [
      "?s != ?o",
      "STR(?s) != STR(?o)",
      "isIRI(?s) && BOUND(?o)",
    ]) {
      const expected = await without(filter);
      expect(expected.length).toBeGreaterThan(0);
      expect(await withBind(filter)).toEqual(expected);
    }
  });

  it("B23 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a LIMIT subquery is evaluated on its own — no outer value is substituted before the slice", async () => {
    const sub = `SELECT ?idea ?p WHERE { ?idea ?p ?src } ORDER BY ?idea ?p LIMIT 3`;
    // Independent evaluation: the subquery's own 3 rows, then the join keeps the ones with ?p = video.
    const own = await rows(sub, ["idea", "p"]);
    expect(own).toHaveLength(3);
    const expected = own.filter((r) => r.endsWith(`| <${VIDEO}>`));
    const got = await rows(
      `SELECT ?idea ?p WHERE { VALUES ?p { eideas:ExoizationIdea_video } { ${sub} } }`,
      ["idea", "p"],
    );
    expect(got).toEqual(expected);
  });

  it("B24 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 the UUID-index rewrite keeps a BIND that defines the filtered variable", async () => {
    const run = async (sparql: string) => {
      const op = new AlgebraOptimizer().optimizeWithSubjects(
        translator.translate(parser.parse(`${PREFIX}\n${sparql}`)),
        [fileIri(I.v1)],
      );
      return (await new ExoQLQueryExecutor(store).executeAll(op)).length;
    };
    const filter = `FILTER(CONTAINS(STR(?s), "${I.v1}"))`;
    const expected = await run(
      `SELECT ?p ?o WHERE { ?x exo:Asset_label ?l . ?x ?p ?o BIND(?x AS ?s) ${filter} }`,
    );
    expect(expected).toBeGreaterThan(0);
    expect(
      await run(
        `SELECT ?p ?o WHERE { ?x exo:Asset_label ?l BIND(?x AS ?s) ?s ?p ?o ${filter} }`,
      ),
    ).toBe(expected);
  });

  // ---- Review round 3 (PR #4557) ----

  it("B25 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 EXISTS over a LIMIT subquery stays correlated — the outer solution is substituted before the slice", async () => {
    const CLS = `?x exo:Instance_class eideas:ExoizationIdea`;
    const videoIdeas = [`<${fileIri(I.v1)}>`, `<${fileIri(I.v2)}>`].sort();
    const others = [`<${fileIri(I.direct)}>`, `<${fileIri(I.book)}>`].sort();
    // Input is built: without the slice EXISTS keeps exactly the two video ideas.
    expect(
      await rows(
        `SELECT ?x WHERE { ${CLS} FILTER EXISTS { SELECT ?x WHERE { ?x eideas:ExoizationIdea_video ?o } } }`,
        ["x"],
      ),
    ).toEqual(videoIdeas);
    const sliced = `{ SELECT ?x WHERE { ?x eideas:ExoizationIdea_video ?o } LIMIT 1 }`;
    expect(
      await rows(`SELECT ?x WHERE { ${CLS} FILTER EXISTS ${sliced} }`, ["x"]),
    ).toEqual(videoIdeas);
    expect(
      await rows(`SELECT ?x WHERE { ${CLS} FILTER NOT EXISTS ${sliced} }`, [
        "x",
      ]),
    ).toEqual(others);
    expect(
      await rows(
        `SELECT ?x ?v WHERE { ${CLS} BIND(IF(EXISTS ${sliced}, "y", "n") AS ?v) }`,
        ["x", "v"],
      ),
    ).toEqual(
      [
        ...videoIdeas.map((x) => `${x} | y`),
        ...others.map((x) => `${x} | n`),
      ].sort(),
    );
  });

  it("B26 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 LATERAL over a nested LIMIT subquery stays correlated — top-N per outer row", async () => {
    const q = `SELECT ?x ?l WHERE {
      ?x exo:Instance_class eideas:ExoizationIdea
      LATERAL { SELECT ?l WHERE { { SELECT ?x ?l WHERE { ?x exo:Asset_label ?l } LIMIT 1 } } } }`;
    const own = IDEAS.map(
      (n) =>
        `<${fileIri(n.uid)}> | "${String(n.frontmatter.exo__Asset_label)}"`,
    ).sort();
    expect(
      (await rows(q, ["x", "l"])).map((r) => r.replace(/"\^\^.*$/, '"')),
    ).toEqual(own);
  });

  it("B27 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a LIMIT subquery on the right of a join runs once, not once per left row", async () => {
    const sub = `{ SELECT ?x ?u WHERE { ?x exo:Asset_uid ?u } ORDER BY ?u LIMIT 5 }`;
    const left = `?x exo:Asset_label ?l0`;
    // Input is built: the left side has far more rows than one.
    expect(
      (await rows(`SELECT ?x WHERE { ${left} }`, ["x"])).length,
    ).toBeGreaterThan(40);
    expect(
      await rows(`SELECT ?x ?u WHERE { ${sub} ${left} }`, ["x", "u"]),
    ).toHaveLength(5);
    // Count the subquery's executions: the executor dispatches every operand through
    // `this.execute`, so an instance wrapper sees the join's calls. (A count of store
    // `match` calls cannot tell: the store decorators answer repeats from their index.)
    // ⛔ The COUNT form on purpose: under a Group the join is not reordered, so the
    // subquery stays on the RIGHT — the shape of the review's 1.1 s → 6.6 s probe.
    const executor = new ExoQLQueryExecutor(store);
    const execute = executor.execute.bind(executor);
    let subqueryRuns = 0;
    executor.execute = (op: AlgebraOperation) => {
      if (op.type === "subquery") subqueryRuns += 1;
      return execute(op);
    };
    const [solution] = await executor.executeAll(
      plan(`SELECT (COUNT(*) AS ?n) WHERE { ${left} ${sub} }`),
    );
    expect(
      Number(String(solution.get("n")).replace(/^"?(\d+)".*$/, "$1")),
    ).toBe(5);
    expect(subqueryRuns).toBe(1);
  });

  it("B28 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a FILTER reading a BIND variable inside arithmetic is not pushed away from it", async () => {
    const q = (cmp: string) =>
      `SELECT ?s WHERE { BIND(48 AS ?window) ?s exo:Asset_uid ?t FILTER(STRLEN(?t) <= ${cmp}) }`;
    const expected = await rows(q("?window"), ["s"]);
    expect(expected.length).toBeGreaterThan(0);
    expect(await rows(q("?window * 1"), ["s"])).toEqual(expected);
  });

  it("B29 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a FILTER reading a BIND variable inside IN is not pushed away from it", async () => {
    expect(
      await rows(
        `SELECT ?s WHERE { BIND("Idea one video" AS ?w) ?s exo:Asset_label ?l FILTER(STRLEN(?l) > 0 && ?l IN (?w)) }`,
        ["s"],
      ),
    ).toEqual([`<${fileIri(I.v1)}>`]);
  });

  it("B30 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a FILTER reading a BIND variable inside a cast is not pushed away from it", async () => {
    const q = (cmp: string) =>
      `SELECT ?s WHERE { BIND(48 AS ?window) ?s exo:Asset_uid ?t FILTER(STRLEN(?t) <= ${cmp}) }`;
    const expected = await rows(q("?window"), ["s"]);
    expect(expected.length).toBeGreaterThan(0);
    expect(
      await rows(q("<http://www.w3.org/2001/XMLSchema#integer>(?window)"), [
        "s",
      ]),
    ).toEqual(expected);
  });

  it("B31 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a FILTER with NOT EXISTS stays above the join after a BIND", async () => {
    const filter = `FILTER(?n > 0 && NOT EXISTS { ?s exo:Asset_label ?u })`;
    // Control: the BIND last (no join under it) — every joined row passes (a label is never the uid).
    const expected = await rows(
      `SELECT ?s ?u WHERE { ?s exo:Asset_label ?l . ?s exo:Asset_uid ?u BIND(STRLEN(STR(?l)) AS ?n) ${filter} }`,
      ["s", "u"],
    );
    expect(expected.length).toBeGreaterThan(40);
    expect(
      await rows(
        `SELECT ?s ?u WHERE { ?s exo:Asset_label ?l BIND(STRLEN(STR(?l)) AS ?n) ?s exo:Asset_uid ?u ${filter} }`,
        ["s", "u"],
      ),
    ).toEqual(expected);
  });

  it("B32 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 the UUID-index rewrite of a group with a BIND keeps the constraint on a subquery, UNION or VALUES operand", async () => {
    const filter = `FILTER(CONTAINS(STR(?s), "${I.v1}"))`;
    const shapes = [
      `?s exo:Asset_label ?l BIND(STR(?l) AS ?y) { SELECT ?s ?k WHERE { ?s exo:Asset_uid ?k } } ${filter}`,
      `?s exo:Asset_label ?l BIND(STR(?l) AS ?y) { ?s exo:Asset_uid ?k } UNION { ?s exo:Asset_label ?k } ${filter}`,
      `?s exo:Asset_label ?l BIND(STR(?l) AS ?y) VALUES ?s { <${fileIri(I.v1)}> <${fileIri(I.v2)}> } ${filter}`,
    ];
    for (const where of shapes) {
      const sparql = `SELECT ?s ?k WHERE { ${where} }`;
      // The plain plan (no rewrite) is the reference; it keeps only rows of I.v1.
      const expected = await rows(sparql, ["s", "k"]);
      expect(expected.length).toBeGreaterThan(0);
      expect(expected.every((r) => r.startsWith(`<${fileIri(I.v1)}>`))).toBe(
        true,
      );
      const op = new AlgebraOptimizer().optimizeWithSubjects(
        translator.translate(parser.parse(`${PREFIX}\n${sparql}`)),
        [fileIri(I.v1)],
      );
      const got = (await new ExoQLQueryExecutor(store).executeAll(op))
        .map((s) => ["s", "k"].map((v) => fmt(s.get(v))).join(" | "))
        .sort();
      expect(got).toEqual(expected);
    }
  });

  // ---- Review round 4 (PR #4557) ----

  const v1 = `<${fileIri(I.v1)}>`;
  const v2 = `<${fileIri(I.v2)}>`;
  const bookIdea = `<${fileIri(I.book)}>`;
  const CLS = `?x exo:Instance_class eideas:ExoizationIdea`;
  const slicedVideo = `{ SELECT ?x WHERE { ?x eideas:ExoizationIdea_video ?o } LIMIT 1 }`;

  it("B33 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 an IN / NOT IN filter on a variable shared with a VALUES operand keeps its rows", async () => {
    const inValues = (filter: string) =>
      rows(
        `SELECT ?s ?p ?o WHERE { VALUES ?s { ${v1} ${v2} ${bookIdea} } ?s ?p ?o FILTER(${filter}) }`,
        ["s", "p", "o"],
      );
    const reference = (subjects: string) =>
      rows(`SELECT ?s ?p ?o WHERE { ?s ?p ?o FILTER(?s IN (${subjects})) }`, [
        "s",
        "p",
        "o",
      ]);
    const keptIn = await reference(`${v1}, ${v2}`);
    expect(keptIn.length).toBeGreaterThan(0);
    expect(await inValues(`?s IN (${v1}, ${v2})`)).toEqual(keptIn);
    const keptNotIn = await reference(`${v2}, ${bookIdea}`);
    expect(keptNotIn.length).toBeGreaterThan(0);
    expect(await inValues(`?s NOT IN (${v1})`)).toEqual(keptNotIn);
  });

  it("B34 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 an IN / NOT IN filter on a variable a subquery operand projects keeps its rows", async () => {
    const q = (filter: string) =>
      `SELECT ?s WHERE { { SELECT ?s WHERE { ?s exo:Instance_class eideas:ExoizationIdea } } ?s exo:Asset_label ?l FILTER(${filter}) }`;
    expect(await rows(q(`?s IN (${v1}, ${v2})`), ["s"])).toEqual(
      [v1, v2].sort(),
    );
    expect(await rows(q(`?s NOT IN (${v1})`), ["s"])).toEqual(
      [`<${fileIri(I.direct)}>`, v2, bookIdea].sort(),
    );
  });

  it("B35 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 an IN filter on a variable an OPTIONAL and a VALUES operand share keeps its rows", async () => {
    const SV1 = `<${fileIri(S.v1)}>`;
    const base = `${CLS} OPTIONAL { ?x eideas:ExoizationIdea_video ?o } VALUES ?o { ${SV1} }`;
    const expected = await rows(`SELECT ?x ?o WHERE { ${base} }`, ["x", "o"]);
    // Input is built: every row carries ?o = S.v1 (bound by the OPTIONAL or by VALUES).
    expect(expected.length).toBeGreaterThan(1);
    expect(expected.every((r) => r.endsWith(`| ${SV1}`))).toBe(true);
    expect(
      await rows(`SELECT ?x ?o WHERE { ${base} FILTER(?o IN (${SV1})) }`, [
        "x",
        "o",
      ]),
    ).toEqual(expected);
  });

  it("B36 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a filter is not pushed onto the operand the join reordering moves to the right", async () => {
    const filter = `FILTER(?s IN (${v1}, ${v2}) && ?p IN (exo:Asset_label))`;
    // Reference: one BGP, no join to push across.
    const expected = await rows(
      `SELECT ?s ?p WHERE { ?s exo:Asset_label ?l . ?s ?p ?o . ?s exo:Instance_class eideas:ExoizationIdea ${filter} }`,
      ["s", "p"],
    );
    expect(expected).toHaveLength(2);
    expect(
      await rows(
        `SELECT ?s ?p WHERE { { ?s exo:Asset_label ?l . ?s ?p ?o } { ?s exo:Instance_class eideas:ExoizationIdea } ${filter} }`,
        ["s", "p"],
      ),
    ).toEqual(expected);
  });

  it("B37 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 an IN filter on a variable a LATERAL operand binds keeps its rows", async () => {
    const q = `SELECT ?x WHERE { ${CLS} LATERAL { SELECT ?l WHERE { ?x exo:Asset_label ?l } LIMIT 1 } ?x exo:Asset_uid ?u FILTER(?x IN (${v1}, ${v2})) }`;
    expect(await rows(q, ["x"])).toEqual([v1, v2].sort());
  });

  it("B38 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 EXISTS over a LIMIT subquery inside a join operand stays correlated", async () => {
    const videoIdeas = [v1, v2].sort();
    const others = [`<${fileIri(I.direct)}>`, bookIdea].sort();
    expect(
      await rows(
        `SELECT ?x WHERE { ${CLS} . { ?x exo:Asset_label ?l FILTER EXISTS ${slicedVideo} } }`,
        ["x"],
      ),
    ).toEqual(videoIdeas);
    expect(
      await rows(
        `SELECT ?x WHERE { ${CLS} . { ?x exo:Asset_label ?l FILTER NOT EXISTS ${slicedVideo} } }`,
        ["x"],
      ),
    ).toEqual(others);
    expect(
      await rows(
        `SELECT ?x WHERE { ${CLS} BIND(1 AS ?one) { ?x exo:Asset_label ?l FILTER EXISTS ${slicedVideo} } }`,
        ["x"],
      ),
    ).toEqual(videoIdeas);
  });

  // EXISTS hidden inside a larger FILTER expression after a BIND: the filter stays
  // above the join. Reference: the BIND last (no join under the filter).
  const existsAfterBind = async (filter: string) => {
    const ctl = await rows(
      `SELECT ?s ?u WHERE { ?s exo:Asset_label ?l . ?s exo:Asset_uid ?u BIND(STRLEN(STR(?l)) AS ?n) FILTER(${filter}) }`,
      ["s", "u"],
    );
    expect(ctl.length).toBeGreaterThan(40);
    expect(
      await rows(
        `SELECT ?s ?u WHERE { ?s exo:Asset_label ?l BIND(STRLEN(STR(?l)) AS ?n) ?s exo:Asset_uid ?u FILTER(${filter}) }`,
        ["s", "u"],
      ),
    ).toEqual(ctl);
  };

  it("B39 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a FILTER with EXISTS inside a function call (IF, COALESCE) stays above the join after a BIND", async () => {
    await existsAfterBind(
      `IF(NOT EXISTS { ?s exo:Asset_label ?u }, ?n > 0, false)`,
    );
    await existsAfterBind(
      `COALESCE(NOT EXISTS { ?s exo:Asset_label ?u }, false) && ?n > 0`,
    );
  });

  it("B40 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a FILTER with EXISTS inside a comparison stays above the join after a BIND", async () => {
    await existsAfterBind(`(?n > 0) = (NOT EXISTS { ?s exo:Asset_label ?u })`);
  });

  it("B41 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a FILTER with EXISTS inside IN stays above the join after a BIND", async () => {
    await existsAfterBind(`(NOT EXISTS { ?s exo:Asset_label ?u }) IN (?n > 0)`);
  });

  it("B42 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 EXISTS reaches a LIMIT subquery nested in a join inside its pattern", async () => {
    const q = `SELECT ?x WHERE { ${CLS} FILTER EXISTS { ?x exo:Asset_label ?l ${slicedVideo} } }`;
    expect(await rows(q, ["x"])).toEqual([v1, v2].sort());
  });

  // ---- Review round 5 (PR #4557): a join WITHOUT a BIND keeps the previous plan ----
  // Each refinement of the pushdown guard changed the plan of BIND-free joins too,
  // and the join reordering then moved an operand where the bind join's older
  // substitution defects show (MINUS loses the shared variable). Expected: the
  // standard answer, which is also what the engine gave before the PR.
  const VIDEO_P = `eideas:ExoizationIdea_video`;
  const directIdea = `<${fileIri(I.direct)}>`;

  it("B43 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND-free `A MINUS {B} C` with a filter on a left-only and a shared variable keeps its answer", async () => {
    const xs = async (sparql: string) =>
      [...new Set(await rows(sparql, ["x"]))].sort();
    expect(
      await xs(
        `SELECT ?x ?u WHERE { { ?x exo:Asset_label ?l MINUS { ?x ${VIDEO_P} ?o } } ?x exo:Asset_uid ?u FILTER(STRSTARTS(?l, "Idea") && ?x != ${bookIdea}) }`,
      ),
    ).toEqual([directIdea]);
    expect(
      await xs(
        `SELECT ?x ?u WHERE { ?x exo:Asset_label ?l MINUS { ?x ${VIDEO_P} ?o } ?x exo:Asset_uid ?u FILTER(STRSTARTS(?l, "Idea") && ?x != ${bookIdea}) }`,
      ),
    ).toEqual([directIdea]);
    expect(
      await xs(
        `SELECT ?x ?u WHERE { ?x exo:Instance_class ?c MINUS { ?x ${VIDEO_P} ?o } ?x exo:Asset_uid ?u FILTER(?c = eideas:ExoizationIdea && ?x != ${bookIdea}) }`,
      ),
    ).toEqual([directIdea]);
  });

  it("B44 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND-free MINUS group on the RIGHT with a filter on its own and a shared variable keeps its answer", async () => {
    const got = [
      ...new Set(
        await rows(
          `SELECT ?x ?u WHERE { ?x exo:Asset_uid ?u { ?x exo:Asset_label ?l MINUS { ?x ${VIDEO_P} ?o } } FILTER(STRSTARTS(?l, "Idea") && ?x != ${bookIdea}) }`,
          ["x"],
        ),
      ),
    ].sort();
    expect(got).toEqual([directIdea]);
  });

  // ---- Review round 6 (PR #4557): a nested group with a BIND is evaluated on its own ----
  const solutionsOf = async (sparql: string) =>
    (await new ExoQLQueryExecutor(store).executeAll(plan(sparql))).map((s) => ({
      s: fmt(s.get("s")),
      y: s.get("y"),
    }));

  it("B45 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a nested BIND group written on the right is not pinned there — moved left, it does not see an outer variable", async () => {
    // Scope: an UNCONSTRAINED left operand. With a constrained one the reordering keeps
    // the group on the right and the bind join still substitutes into it — the older
    // bug f440b567, not fixed here.
    const all = await solutionsOf(
      `SELECT ?s ?y WHERE { ?s exo:Asset_label ?l { ?s exo:Asset_uid ?u BIND(?l AS ?y) } }`,
    );
    expect(all.length).toBeGreaterThan(40);
    expect(all.filter((r) => r.y !== undefined)).toEqual([]);
    const ideas = await solutionsOf(
      `SELECT ?s ?y WHERE { ?s exo:Asset_label ?l { ?s exo:Asset_uid ?u BIND(?l AS ?y) } FILTER(STRSTARTS(?l, "Idea")) }`,
    );
    expect(ideas).toHaveLength(IDEAS.length);
    expect(ideas.filter((r) => r.y !== undefined)).toEqual([]);
    // Its own FILTER on an outer-only variable is an error inside the group: no rows.
    expect(
      await rows(
        `SELECT ?s WHERE { ?s exo:Asset_label ?l { ?s exo:Asset_uid ?u BIND(STRLEN(?u) AS ?n) FILTER(STRSTARTS(?l, "Idea")) } }`,
        ["s"],
      ),
    ).toEqual([]);
  });

  it("B46 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND group written FIRST is evaluated on its own, with or without an inner FILTER", async () => {
    // ?k is a LITERAL (the label): a substituted IRI would make the BIND expression
    // unevaluable (bug 4e3ce943) and leave ?y unbound by accident.
    for (const group of [
      `{ ?s exo:Asset_uid ?u BIND(?k AS ?y) FILTER(BOUND(?u)) }`,
      `{ ?s exo:Asset_uid ?u BIND(?k AS ?y) }`,
    ]) {
      const got = await solutionsOf(
        `SELECT ?s ?y WHERE { ${group} ?s exo:Asset_label ?k . ?s exo:Instance_class eideas:ExoizationIdea }`,
      );
      expect(got).toHaveLength(IDEAS.length);
      expect(got.filter((r) => r.y !== undefined)).toEqual([]);
    }
  });

  it("B47 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a group FILTER over a join whose BIND is on the RIGHT stays above the join", async () => {
    // Pushed left onto the label pattern, the filter would be moved right of the
    // bind join by the reordering (the BIND group costs less) and receive the
    // substituted IRI (bug 4e3ce943). Reference: the same group without the BIND.
    const filter = `FILTER(?s != ${bookIdea})`;
    const expected = await rows(
      `SELECT ?s WHERE { ?s exo:Asset_label ?l { ?s exo:Asset_uid ?u } ${filter} }`,
      ["s"],
    );
    expect(expected.length).toBeGreaterThan(40);
    expect(
      await rows(
        `SELECT ?s WHERE { ?s exo:Asset_label ?l { ?s exo:Asset_uid ?u BIND(STRLEN(?u) AS ?n) } ${filter} }`,
        ["s"],
      ),
    ).toEqual(expected);
  });

  it("B12 @req:60ed88e7-5b71-4112-a4a5-a78e3204b0b7 a BIND reading an earlier BIND chains, and the later pattern joins with the result", async () => {
    const q = `SELECT ?idea ?src WHERE {
      BIND("ExoizationIdea_video" AS ?local)
      BIND(IRI(CONCAT("https://exocortex.my/ontology/exoization-ideas#", ?local)) AS ?p)
      ?idea ?p ?src }`;
    expect(await rows(q, ["idea", "src"])).toEqual(
      [pair(I.v1, S.v1), pair(I.v2, S.v2)].sort(),
    );
  });
});
