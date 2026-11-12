/**
 * Query predicate analyzer (RFC 308a52c3 «Загрузка по запросу», phase 1a).
 *
 * Two kinds of axes:
 * - `PA<n>` — the analyzer's verdict for one query: mode, reason, the exact P'.
 * - `PD<n>` — the guarantee itself, differentially: the REAL engine
 *   (`ExoQLQueryExecutor`, both store decorators on, as in the CLI) over the full
 *   store and over the store cut to P' returns the same answer. A query the analyzer
 *   sends to full load is asserted to be one where the cut store DOES change the
 *   answer (`PD` full-load axes) — so a mutant that prunes it goes red here, not
 *   only on its own verdict axis.
 *
 * The store is built by the REAL converter over fixture notes, so the forms the
 * engine reads implicitly (symbolic Instance_class objects, label-form file-IRI
 * objects, superProperty declarations on file IRIs) are what production emits.
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
import type {
  AlgebraOperation,
  AskOperation,
  ConstructOperation,
} from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import {
  analyzeAlgebraPredicates,
  analyzeParsedQuery,
  computeSubPropertyIndex,
  type PredicateAnalysis,
  type PredicateAnalysisContext,
} from "../../../src/infrastructure/sparql/analysis/QueryPredicateAnalyzer";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Triple as RdfTriple } from "../../../src/domain/models/rdf/Triple";
import type { Triple } from "../../../src/domain/models/rdf/Triple";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

const EXO = (l: string) => Namespace.EXO.term(l).value;
const RDFS_LABEL = Namespace.RDFS.term("label").value;
const RELATES = EXO("Asset_relates");
const RELATED = Namespace.forPrefix("concept")!.term("Concept_related").value;
const FLOW = (l: string) => Namespace.forPrefix("flow")!.term(l).value;
const TEST = (l: string) => Namespace.forPrefix("test")!.term(l).value;
/** RFC Д1 class bridge skeleton — a LITERAL here, so a drift of the constant reddens PA3. */
const SIX = [
  EXO("Class_superClass"),
  Namespace.RDFS.term("subClassOf").value,
  RDFS_LABEL,
  EXO("Asset_label"),
  EXO("Instance_class"),
  Namespace.RDF.term("type").value,
];

let seq = 0;
const uid = () =>
  `5a03523f-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (u: string, fm: IFrontmatter, withUid = true): FixtureNote => ({
  uid: u,
  frontmatter: withUid ? { exo__Asset_uid: u, ...fm } : { ...fm },
});

const C = { thing: uid(), device: uid(), gadget: uid(), orphan: uid() };
const P = {
  relates: uid(),
  related: uid(),
  superClass: uid(),
  instanceClass: uid(),
  memberOf: uid(),
  deep: uid(),
};
const A = {
  a1: uid(),
  a2: uid(),
  a3: uid(),
  f1: uid(),
  x: uid(),
  y: uid(),
  rule: uid(),
  i1: uid(),
  i2: uid(),
  i3: uid(),
  i4: uid(),
  nouid: uid(),
  d1: uid(),
};
/** Review round 1: declarations whose PARENT the decorator never widens (bridge / W3C). */
const W = { kind: uid(), alias: uid() };
/** Review round 1: row-ORDER counterexamples (namespace filter + object index; SUM/AVG). */
const R = {
  x: uid(),
  s1: uid(),
  s2: uid(),
  stmt: uid(),
  ref: uid(),
  n1: uid(),
  n2: uid(),
  n3: uid(),
};
/** Review round 2: GROUP BY keeps the FIRST row's term of a group keyed by lexical value. */
const Q = {
  refb: uid(),
  n4: uid(),
  n5: uid(),
  x2: uid(),
  s3: uid(),
  s4: uid(),
  stmt2: uid(),
};

const NOTES: FixtureNote[] = [
  // ---- class TBox
  note(C.thing, { exo__Asset_label: "test__Thing" }),
  note(C.device, {
    exo__Asset_label: "test__Device",
    exo__Class_superClass: `[[${C.thing}]]`,
  }),
  note(C.gadget, {
    exo__Asset_label: "test__Gadget",
    exo__Class_superClass: `[[${C.device}]]`,
  }),
  // ---- property TBox
  note(P.relates, { exo__Asset_label: "exo__Asset_relates" }),
  note(P.related, {
    exo__Asset_label: "concept__Concept_related",
    exo__Property_superProperty: `[[${P.relates}]]`,
  }),
  // ---- instances
  note(A.i1, {
    exo__Asset_label: "Gadget one",
    exo__Instance_class: `[[${C.gadget}]]`,
    ems__Effort_status: "done",
  }),
  note(A.i3, {
    exo__Asset_label: "Gadget three",
    exo__Instance_class: "[[test__Gadget]]",
  }),
  note(A.a1, {
    exo__Asset_label: "Concept A",
    concept__Concept_related: `[[${A.a2}]]`,
  }),
  note(A.a2, {
    exo__Asset_label: "Concept B",
    ems__Effort_status: "doing",
    test__other: "m",
  }),
  note(A.a3, {
    exo__Asset_label: "Asset C",
    exo__Asset_relates: `[[${A.a2}]]`,
    ems__Effort_status: "s3",
  }),
  note(A.f1, {
    exo__Asset_label: "Flow item",
    flow__WorkItem_stage: `[[${A.a2}]]`,
    flow__WorkItem_note: "n1",
    test__other: "o1",
  }),
  note(A.x, { test__other: "x-only" }),
  note(A.y, { test__other: "y-only" }),
  note(A.rule, { exo__Asset_label: "Rule" }),
  // ---- forms added by the spec review: a predicate file whose label is the symbolic
  // IRI a query can bind ?p to; a sub-property CHAIN (n = 2 under Asset_relates); a
  // membership sub-property; a note without exo__Asset_uid (byUUID still finds it).
  note(P.superClass, { exo__Asset_label: "exo__Class_superClass" }),
  note(P.instanceClass, { exo__Asset_label: "exo__Instance_class" }),
  note(P.memberOf, { exo__Asset_label: "test__memberOf" }),
  note(P.deep, {
    exo__Asset_label: "test__deep",
    exo__Property_superProperty: `[[${P.related}]]`,
  }),
  note(A.d1, { exo__Asset_label: "Deep one", test__deep: `[[${A.a3}]]` }),
  note(
    A.nouid,
    { exo__Asset_label: "Legacy", ems__Effort_status: "legacy" },
    false,
  ),
  // ---- review round 1: sub-property declarations under parents the decorator never
  // widens — a class-bridge predicate and a W3C one (the index carries them).
  note(W.kind, {
    exo__Asset_label: "test__kind",
    exo__Property_superProperty: `[[${P.instanceClass}]]`,
  }),
  note(W.alias, {
    exo__Asset_label: "test__alias",
    exo__Property_superProperty: "rdfs__label",
  }),
  // ---- review round 1, row order through the OBJECT index: the reified statement
  // gives S1 a flow edge to X AFTER S2's, while S1 met X first under Asset_relates.
  note(R.x, { exo__Asset_label: "X target" }),
  note(R.s1, { exo__Asset_label: "S one", exo__Asset_relates: `[[${R.x}]]` }),
  note(R.s2, { exo__Asset_label: "S two", flow__WorkItem_stage: `[[${R.x}]]` }),
  note(R.stmt, {
    exo__Asset_label: "Stmt",
    exo__Instance_class: "[[exo__Statement]]",
    exo__Statement_subject: `[[${R.s1}]]`,
    exo__Statement_predicate: "flow__WorkItem_stage",
    exo__Statement_object: `[[${R.x}]]`,
  }),
  // ---- review round 1, SUM/AVG over a free-subject path: N3/N2 first appear as
  // objects of Ref, so the start-node order differs once test:ref is cut away.
  note(R.ref, {
    exo__Asset_label: "Ref",
    test__ref: [`[[${R.n3}]]`, `[[${R.n2}]]`],
  }),
  note(R.n1, { exo__Asset_label: "N one", test__val: "0.1" }),
  note(R.n2, { exo__Asset_label: "N two", test__val: "0.2" }),
  note(R.n3, { exo__Asset_label: "N three", test__val: "0.3" }),
  // ---- review round 2: "5"^^xsd:integer (YAML number) and "5" (YAML string) share a
  // GROUP BY group; which term the group returns depends on row order.
  note(Q.refb, { exo__Asset_label: "Ref B", test__ref: `[[${Q.n5}]]` }),
  note(Q.n4, { exo__Asset_label: "N four", test__num: 5 }),
  note(Q.n5, { exo__Asset_label: "N five", test__num: "5" }),
  // ---- review round 2: the same through a namespace-admitted variable predicate.
  note(Q.x2, { exo__Asset_label: "X2 target" }),
  note(Q.s3, {
    exo__Asset_label: "S three",
    exo__Asset_relates: `[[${Q.x2}]]`,
    test__num: 7,
  }),
  note(Q.s4, {
    exo__Asset_label: "S four",
    flow__WorkItem_stage: `[[${Q.x2}]]`,
    test__num: "7",
  }),
  note(Q.stmt2, {
    exo__Asset_label: "Stmt2",
    exo__Instance_class: "[[exo__Statement]]",
    exo__Statement_subject: `[[${Q.s3}]]`,
    exo__Statement_predicate: "flow__WorkItem_stage",
    exo__Statement_object: `[[${Q.x2}]]`,
  }),
];

/**
 * ENGINE-level form the converter does not produce today: a class whose name exists
 * only as an `rdfs:label` LITERAL (the bridge index key) and whose symbolic node occurs
 * only under an unrelated predicate. The converter also emits the symbolic IRI as the
 * object of `exo:Asset_label`, which hides the gap; the analyzer's guarantee is derived
 * from what the ENGINE reads, so it must hold without that converter invariant.
 */
const ORPHAN_FILE = `obsidian://vault/${C.orphan}.md`;
const extraTriples = (): Triple[] => [
  new RdfTriple(
    new IRI(ORPHAN_FILE),
    new IRI(RDFS_LABEL),
    new Literal("test__Orphan"),
  ),
  new RdfTriple(
    new IRI(ORPHAN_FILE),
    new IRI(EXO("Class_superClass")),
    new IRI(TEST("Thing")),
  ),
  new RdfTriple(
    new IRI(`obsidian://vault/${A.rule}.md`),
    new IRI(TEST("Rule_targetClass")),
    new IRI(TEST("Orphan")),
  ),
  // exo:Instance_class ⊑ test:memberOf — a membership predicate in a closure.
  new RdfTriple(
    new IRI(`obsidian://vault/${P.instanceClass}.md`),
    new IRI(EXO("Property_superProperty")),
    new IRI(TEST("memberOf")),
  ),
  new RdfTriple(
    new IRI(`obsidian://vault/${A.i4}.md`),
    new IRI(EXO("Instance_class")),
    new IRI(ORPHAN_FILE),
  ),
  new RdfTriple(
    new IRI(`obsidian://vault/${A.i4}.md`),
    new IRI(EXO("Asset_uid")),
    new Literal(A.i4),
  ),
];

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
    // A label-form wikilink resolves through the label (the CLI adapter's behaviour).
    for (const key of ["exo__Asset_label", "rdfs__label"]) {
      const label = n.frontmatter[key];
      if (typeof label === "string") fileByLinkpath.set(label, files[i]);
    }
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
  // The class bridge changes an answer only when membership objects are class FILE IRIs
  // (RFC 78572fa9 stage-1 emission); the analyzer must be exact in that configuration too.
  const converter = new NoteToRDFConverter(vault, undefined, {
    emitInstanceClassAsUid: true,
  });
  const out: Triple[] = [];
  for (const f of files) out.push(...(await converter.convertNote(f)));
  return out;
}

const PREFIXES = `
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX concept: <https://exocortex.my/ontology/concept#>
PREFIX flow: <https://exocortex.my/ontology/flow#>
PREFIX test: <https://exocortex.my/ontology/test#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
`;

const parser = new SPARQLParser();
const translate = (q: string): AlgebraOperation =>
  new ExoQLAlgebraTranslator().translate(parser.parse(PREFIXES + q));

let allTriples: Triple[] = [];
let context: PredicateAnalysisContext;

beforeAll(async () => {
  allTriples = [...(await convertAll(NOTES)), ...extraTriples()];
  const full = new InMemoryTripleStore();
  await full.addAll(allTriples);
  context = {
    subPropertyIndex: await computeSubPropertyIndex(full),
    storePredicates: new Set(allTriples.map((t) => t.predicate.value)),
  };
});

const analyze = (q: string): PredicateAnalysis =>
  analyzeAlgebraPredicates(translate(q), context);

/** The CLI path (`sparql-query.ts` `buildAlgebra`): translate, then optimize. */
function optimized(algebra: AlgebraOperation): AlgebraOperation {
  return algebra.type === "construct"
    ? {
        ...(algebra as ConstructOperation),
        where: new AlgebraOptimizer().optimize(
          (algebra as ConstructOperation).where,
        ),
      }
    : new AlgebraOptimizer().optimize(algebra);
}

async function answer(
  triples: Triple[],
  translated: AlgebraOperation,
): Promise<string[]> {
  const algebra = optimized(translated);
  const store = new InMemoryTripleStore();
  await store.addAll(triples);
  const executor = new ExoQLQueryExecutor(store);
  if (algebra.type === "ask")
    return [String(await executor.executeAsk(algebra as AskOperation))];
  if (algebra.type === "construct") {
    return (await executor.executeConstruct(algebra as ConstructOperation))
      .map((t) => t.toString())
      .sort();
  }
  const rows = await executor.executeAll(algebra);
  return rows
    .map((r) => {
      const o = r.toJSON();
      return JSON.stringify(
        Object.keys(o)
          .sort()
          .map((k) => [k, o[k]]),
      );
    })
    .sort();
}

const cut = (predicates: ReadonlySet<string>): Triple[] =>
  allTriples.filter((t) => predicates.has(t.predicate.value));

/** The guarantee: P' gives the full-load answer. */
async function expectSameAnswer(q: string): Promise<PredicateAnalysis> {
  const algebra = translate(q);
  const analysis = analyzeAlgebraPredicates(algebra, context);
  expect(analysis.mode).toBe("prune");
  if (analysis.mode !== "prune") throw new Error("unreachable");
  const full = await answer(allTriples, algebra);
  expect(full.length).toBeGreaterThan(0); // a vacuous query proves nothing
  expect(await answer(cut(analysis.predicates), algebra)).toEqual(full);
  return analysis;
}

/** Review witnesses: whatever the verdict, a prune must give the full-load answer. */
async function expectSound(q: string): Promise<PredicateAnalysis> {
  const algebra = translate(q);
  const analysis = analyzeAlgebraPredicates(algebra, context);
  const full = await answer(allTriples, algebra);
  expect(full.length).toBeGreaterThan(0);
  if (analysis.mode === "prune") {
    expect(await answer(cut(analysis.predicates), algebra)).toEqual(full);
  }
  return analysis;
}

/**
 * A full-load verdict is load-bearing: cutting to what the analyzer WOULD load without
 * that verdict (the query's predicates + the skeleton the query pulls) changes the answer.
 */
async function expectFullLoadIsNeeded(
  q: string,
  kind: string,
  ownPredicates: string[],
): Promise<void> {
  const algebra = translate(q);
  const analysis = analyzeAlgebraPredicates(algebra, context);
  expect(analysis.mode).toBe("full");
  if (analysis.mode !== "full") throw new Error("unreachable");
  expect(analysis.reasons.map((r) => r.kind)).toContain(kind);
  const full = await answer(allTriples, algebra);
  const naive = new Set(ownPredicates);
  expect(await answer(cut(naive), algebra)).not.toEqual(full);
}

const kinds = (a: PredicateAnalysis): string[] =>
  a.mode === "full" ? a.reasons.map((r) => r.kind) : ["PRUNE"];
const expectFull = (q: string, kind: string): void => {
  expect(kinds(analyze(q))).toContain(kind);
};
const exactP = (q: string, preds: string[]): void => {
  const a = analyze(q);
  expect(a.mode).toBe("prune");
  if (a.mode === "prune")
    expect([...a.predicates].sort()).toEqual([...preds].sort());
};

describe("QueryPredicateAnalyzer — fixture forms (asserted before they are relied on)", () => {
  test("PA0 the converter emits the forms the axes rely on", () => {
    const has = (s: string, p: string, o: string): boolean =>
      allTriples.some(
        (t) =>
          t.subject.toString().includes(s) &&
          t.predicate.value === p &&
          t.object.toString().includes(o),
      );
    // stage-1 emission: a bare-uid membership object is the class FILE IRI; the label form stays symbolic
    expect(has(A.i1, EXO("Instance_class"), `${C.gadget}.md`)).toBe(true);
    expect(has(A.i3, EXO("Instance_class"), "test#Gadget")).toBe(true);
    // a prefix__Name label is emitted as the symbolic IRI object of exo:Asset_label
    expect(has(C.gadget, EXO("Asset_label"), "test#Gadget")).toBe(true);
    // ...and its rdfs:label mirror is the LITERAL the bridge index reads
    expect(
      allTriples.some(
        (t) =>
          t.subject.toString().includes(C.gadget) &&
          t.predicate.value === RDFS_LABEL &&
          t.object.toString() === '"test__Gadget"',
      ),
    ).toBe(true);
    // the orphan's symbolic node occurs only as the rule target
    const orphan = allTriples.filter(
      (t) =>
        t.object.toString().includes("test#Orphan") ||
        t.subject.toString().includes("test#Orphan"),
    );
    expect(orphan.map((t) => t.predicate.value)).toEqual([
      TEST("Rule_targetClass"),
    ]);
    // the sub-property index sees the declaration
    expect([...(context.subPropertyIndex.get(RELATES) ?? [])].sort()).toEqual(
      [RELATED, TEST("deep")].sort(),
    );
    // transitive: test:kind ⊑ exo:Instance_class ⊑ test:memberOf (review round 1)
    expect(
      [...(context.subPropertyIndex.get(TEST("memberOf")) ?? [])].sort(),
    ).toEqual([EXO("Instance_class"), TEST("kind")].sort());
    // the note without exo__Asset_uid carries no exo:Asset_uid triple
    expect(
      allTriples.some(
        (t) =>
          t.subject.toString().includes(A.nouid) &&
          t.predicate.value === EXO("Asset_uid"),
      ),
    ).toBe(false);
  });
});

describe("QueryPredicateAnalyzer — verdict axes", () => {
  test("PA1 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 constant predicates after prefix expansion; no skeleton for a plain query", () => {
    const a = analyze(
      "SELECT ?s ?o WHERE { ?s ems:Effort_status ?o . ?s exo:Asset_label ?l }",
    );
    expect(a.mode).toBe("prune");
    if (a.mode !== "prune") return;
    expect([...a.predicates].sort()).toEqual(
      [EXO("Asset_label"), Namespace.EMS.term("Effort_status").value].sort(),
    );
  });

  test("PA2 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 sub-property fixed point: Asset_relates widens to the WHOLE chain", () => {
    const a = analyze("SELECT ?s ?o WHERE { ?s exo:Asset_relates ?o }");
    expect(a.mode).toBe("prune");
    if (a.mode !== "prune") return;
    expect(a.predicates.has(RELATED)).toBe(true);
    expect(a.predicates.has(TEST("deep"))).toBe(true);
  });

  test("PA16 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 widening pulls what the decorator reads to BUILD its index: superProperty + Asset_label", () => {
    const a = analyze("SELECT ?s ?o WHERE { ?s exo:Asset_relates ?o }");
    expect(a.mode).toBe("prune");
    if (a.mode !== "prune") return;
    expect([...a.predicates].sort()).toEqual(
      [
        RELATES,
        RELATED,
        TEST("deep"),
        EXO("Property_superProperty"),
        EXO("Asset_label"),
      ].sort(),
    );
  });

  test("PA3 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 symbolic class membership pulls the six-predicate class bridge, rdfs:label included", () => {
    const a = analyze("SELECT ?s WHERE { ?s exo:Instance_class test:Gadget }");
    expect(a.mode).toBe("prune");
    if (a.mode !== "prune") return;
    expect([...a.predicates].sort()).toEqual([...SIX].sort());
  });

  test("PA4 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 membership with a non-ontology constant object does not pull the bridge", () => {
    const a = analyze(
      "SELECT ?s WHERE { ?s rdf:type <http://example.org/Other> }",
    );
    expect(a.mode).toBe("prune");
    if (a.mode !== "prune") return;
    expect([...a.predicates]).toEqual([Namespace.RDF.term("type").value]);
  });

  test("PA5 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 variable predicate → full load", () => {
    const a = analyze("SELECT * WHERE { ?s ?p ?o }");
    expect(a).toEqual({
      mode: "full",
      reasons: [{ kind: "variable-predicate", variable: "p" }],
    });
  });

  test("PA6 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 zero-length path with a free subject → full load; with a constant subject → prune", () => {
    const free = analyze(
      `SELECT ?c WHERE { ?c exo:Class_superClass* <obsidian://vault/${A.x}.md> }`,
    );
    expect(free.mode).toBe("full");
    if (free.mode === "full")
      expect(free.reasons.map((r) => r.kind)).toContain(
        "zero-length-path-free-subject",
      );
    expect(
      analyze("SELECT ?p WHERE { test:Gadget exo:Class_superClass* ?p }").mode,
    ).toBe("prune");
  });

  test("PA7 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 one-or-more path is not nullable: a free subject over a NON-hierarchy predicate prunes", () => {
    expect(analyze("SELECT ?s WHERE { ?s exo:Asset_relates+ ?o }").mode).toBe(
      "prune",
    );
  });

  test("PA8 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 DESCRIBE, SERVICE, GRAPH, UPDATE → full load", () => {
    const kinds = (a: PredicateAnalysis): string[] =>
      a.mode === "full" ? a.reasons.map((r) => r.kind) : [];
    expect(kinds(analyze(`DESCRIBE <obsidian://vault/${A.x}.md>`))).toEqual([
      "describe",
    ]);
    expect(
      kinds(
        analyze(
          "SELECT * WHERE { SERVICE <http://example.org/sparql> { ?s exo:Asset_label ?l } }",
        ),
      ),
    ).toEqual(["service"]);
    expect(
      kinds(analyze("SELECT * WHERE { GRAPH ?g { ?s exo:Asset_label ?l } }")),
    ).toEqual(["graph"]);
    const upd = parser.parse(PREFIXES + 'INSERT DATA { <urn:a> <urn:b> "c" }');
    expect(
      analyzeParsedQuery(
        upd,
        () => {
          throw new Error("must not translate");
        },
        context,
      ),
    ).toEqual({
      mode: "full",
      reasons: [{ kind: "update" }],
    });
  });

  test("PA9 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 exo:byUUID → full load (the UUID index covers every loaded subject)", () => {
    const a = analyze(`SELECT ?x WHERE { BIND(exo:byUUID("${A.y}") AS ?x) }`);
    expect(a).toEqual({ mode: "full", reasons: [{ kind: "uuid-lookup" }] });
  });

  test("PA19 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 byUUID inside HAVING is seen", () => {
    const a = analyze(
      `SELECT ?s (COUNT(?st) AS ?n) WHERE { ?s ems:Effort_status ?st } GROUP BY ?s HAVING (COALESCE(STR(exo:byUUID("${A.y}")), "none") != "none")`,
    );
    expect(a).toEqual({ mode: "full", reasons: [{ kind: "uuid-lookup" }] });
  });

  test("PA10 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 VL-3: a namespace filter in the same group bounds the variable predicate", () => {
    const a = analyze(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(CONTAINS(STR(?p), "ontology/flow#")) }',
    );
    expect(a.mode).toBe("prune");
    if (a.mode === "prune")
      expect([...a.predicates].sort()).toEqual(
        [FLOW("WorkItem_note"), FLOW("WorkItem_stage")].sort(),
      );
  });

  test("PA18 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 VL-3: STRSTARTS on the full namespace IRI bounds the variable predicate too", () => {
    const a = analyze(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(STRSTARTS(STR(?p), "https://exocortex.my/ontology/flow#")) }',
    );
    expect(a.mode).toBe("prune");
    if (a.mode === "prune")
      expect([...a.predicates].sort()).toEqual(
        [FLOW("WorkItem_note"), FLOW("WorkItem_stage")].sort(),
      );
  });

  test("PA11 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 VL-3: the filter inside OPTIONAL does not bound the outer variable predicate", () => {
    const a = analyze(
      'SELECT * WHERE { ?s ?p ?v OPTIONAL { ?s flow:WorkItem_note ?w FILTER(CONTAINS(STR(?p), "ontology/flow#")) } }',
    );
    expect(a.mode).toBe("full");
  });

  test("PA12 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 VL-3 without a predicate list → full load", () => {
    const a = analyzeAlgebraPredicates(
      translate(
        'SELECT * WHERE { ?s ?p ?v FILTER(STRSTARTS(STR(?p), "https://exocortex.my/ontology/flow#")) }',
      ),
      { subPropertyIndex: context.subPropertyIndex },
    );
    expect(a.mode).toBe("full");
  });

  test("PA13 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a free-subject path over a hierarchy predicate → full load", () => {
    const a = analyze(
      "SELECT ?c WHERE { ?c exo:Class_superClass+ test:Thing }",
    );
    expect(a.mode).toBe("full");
    if (a.mode === "full")
      expect(a.reasons.map((r) => r.kind)).toEqual([
        "class-bridge-path-free-subject",
      ]);
  });

  test("PA17 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 byUUID written as an operator-form function name is detected", () => {
    const algebra = {
      type: "extend",
      variable: "x",
      expression: {
        type: "function",
        function: "byuuid",
        args: [{ type: "literal", value: A.y }],
      },
      input: { type: "bgp", triples: [] },
    } as unknown as AlgebraOperation;
    const a = analyzeAlgebraPredicates(algebra, context);
    expect(a).toEqual({ mode: "full", reasons: [{ kind: "uuid-lookup" }] });
  });

  test("PA14 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 an unknown operation type throws (exhaustive walk)", () => {
    expect(() =>
      analyzeAlgebraPredicates(
        { type: "nope" } as unknown as AlgebraOperation,
        context,
      ),
    ).toThrow(/unsupported operation/);
  });
});

describe("QueryPredicateAnalyzer — differential axes (real engine, full store vs store cut to P')", () => {
  test("PD1 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 sub-property: Asset_relates sees Concept_related through the cut store", async () => {
    await expectSameAnswer("SELECT ?s ?o WHERE { ?s exo:Asset_relates ?o }");
  });

  test("PD2 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 class bridge: a symbolic membership query sees a FILE-IRI membership object", async () => {
    await expectSameAnswer(
      "SELECT ?s WHERE { ?s exo:Instance_class test:Gadget }",
    );
  });

  test("PD3 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 class bridge: a symbolic hierarchy subject", async () => {
    await expectSameAnswer(
      "SELECT ?p WHERE { test:Gadget exo:Class_superClass ?p }",
    );
  });

  test("PD4 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 class bridge: membership object bound by VALUES", async () => {
    await expectSameAnswer(
      "SELECT ?s WHERE { VALUES ?c { test:Gadget } ?s exo:Instance_class ?c }",
    );
  });

  test("PD5 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: byUUID finds subjects WITHOUT exo:Asset_uid (RFC listed Asset_uid)", async () => {
    // a materialized class file with only rdfs:label + superClass, and a note without the key
    await expectFullLoadIsNeeded(
      `SELECT ?x WHERE { BIND(exo:byUUID("${C.orphan}") AS ?x) }`,
      "uuid-lookup",
      [EXO("Asset_uid")],
    );
    await expectFullLoadIsNeeded(
      `SELECT ?x WHERE { BIND(exo:byUUID("${A.nouid}") AS ?x) }`,
      "uuid-lookup",
      [EXO("Asset_uid")],
    );
  });

  test("PD6 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 FILTER NOT EXISTS reads its own pattern", async () => {
    await expectSameAnswer(
      "SELECT ?s WHERE { ?s exo:Asset_label ?l FILTER NOT EXISTS { ?s ems:Effort_status ?st } }",
    );
  });

  test("PD7 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 BIND(EXISTS {…}) reads its pattern", async () => {
    await expectSameAnswer(
      "SELECT ?s ?has WHERE { ?s exo:Asset_label ?l BIND(EXISTS { ?s ems:Effort_status ?x } AS ?has) }",
    );
  });

  test("PD8 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 HAVING reads its EXISTS-free expression: a grouped query prunes and keeps the answer", async () => {
    await expectSameAnswer(
      "SELECT ?s (COUNT(?st) AS ?n) WHERE { ?s ems:Effort_status ?st } GROUP BY ?s HAVING (COUNT(?st) > 0)",
    );
  });

  test("PD9 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a subquery reads its own pattern", async () => {
    await expectSameAnswer(
      "SELECT ?s ?o WHERE { { SELECT ?s WHERE { ?s exo:Asset_uid ?u } } ?s ems:Effort_status ?o }",
    );
  });

  test("PD19 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 every UNION branch is read", async () => {
    await expectSameAnswer(
      "SELECT ?s ?o WHERE { { ?s ems:Effort_status ?o } UNION { ?s flow:WorkItem_note ?o } UNION { ?s flow:WorkItem_stage ?o } }",
    );
  });

  test("PD20 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 the MINUS side is read", async () => {
    await expectSameAnswer(
      'SELECT ?s ?o WHERE { ?s ems:Effort_status ?o MINUS { ?s test:other "m" } }',
    );
  });

  test("PD21 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 the OPTIONAL side is read", async () => {
    await expectSameAnswer(
      "SELECT ?s ?o ?r WHERE { ?s ems:Effort_status ?o OPTIONAL { ?s exo:Asset_relates ?r } }",
    );
  });

  test("PA15 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 ORDER BY comparators are walked (defensive: the engine sorts by variables only today)", () => {
    // QueryExecutor.getExpressionValue evaluates a variable or a literal and returns
    // undefined for any other comparator — so no ORDER BY expression reads the store
    // TODAY. The analyzer over-approximates instead of depending on that limitation.
    const a = analyze(
      `SELECT ?s WHERE { ?s ems:Effort_status ?st } ORDER BY (exo:byUUID("${A.y}"))`,
    );
    expect(a).toEqual({ mode: "full", reasons: [{ kind: "uuid-lookup" }] });
  });

  test("PD11 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 VL-3: Q_FLOW_TRIPLES shape loads only the namespace", async () => {
    const a = await expectSameAnswer(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(CONTAINS(STR(?p), "ontology/flow#")) }',
    );
    if (a.mode === "prune")
      expect(a.predicates.has(EXO("Asset_label"))).toBe(false);
  });

  test("PD12 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 ASK and CONSTRUCT read their WHERE", async () => {
    await expectSameAnswer("ASK { ?s exo:Asset_relates ?o }");
    await expectSameAnswer(
      "CONSTRUCT { ?s <urn:r> ?o } WHERE { ?s exo:Asset_relates ?o }",
    );
  });

  test("PD18 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 LATERAL reads its right side", async () => {
    await expectSameAnswer(
      "SELECT ?s ?st WHERE { ?s exo:Asset_label ?l LATERAL { SELECT ?st WHERE { ?s ems:Effort_status ?st } } }",
    );
  });

  test("PD13 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 zero-length path from a constant subject", async () => {
    await expectSameAnswer(
      "SELECT ?p WHERE { test:Gadget exo:Class_superClass* ?p }",
    );
  });

  test("PD14 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: variable predicate", async () => {
    await expectFullLoadIsNeeded(
      "SELECT * WHERE { ?s ?p ?o }",
      "variable-predicate",
      [],
    );
  });

  test("PD15 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: zero-length path, free subject (RFC AC: ?c exo:Class_superClass* <X>)", async () => {
    await expectFullLoadIsNeeded(
      "SELECT ?c WHERE { ?c exo:Class_superClass* test:Orphan }",
      "zero-length-path-free-subject",
      [...SIX],
    );
    await expectFullLoadIsNeeded(
      `SELECT ?c WHERE { ?c ems:Effort_status* <obsidian://vault/${A.x}.md> }`,
      "zero-length-path-free-subject",
      [Namespace.EMS.term("Effort_status").value],
    );
  });

  test("PD16 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: namespace filter scoped to OPTIONAL", async () => {
    await expectFullLoadIsNeeded(
      'SELECT * WHERE { ?s ?p ?v OPTIONAL { ?s flow:WorkItem_note ?w FILTER(CONTAINS(STR(?p), "ontology/flow#")) } }',
      "variable-predicate",
      [FLOW("WorkItem_note"), FLOW("WorkItem_stage")],
    );
  });

  test("PD17 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: free-subject hierarchy path", async () => {
    await expectFullLoadIsNeeded(
      "SELECT ?c WHERE { ?c exo:Class_superClass+ test:Thing }",
      "class-bridge-path-free-subject",
      [...SIX],
    );
  });

  test("PD25 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: free-subject INVERSE membership path", async () => {
    await expectFullLoadIsNeeded(
      "SELECT ?c ?s WHERE { ?c ^exo:Instance_class ?s }",
      "class-bridge-path-free-subject",
      [...SIX],
    );
  });

  // ---- spec-review reproductions and witnesses (each was a wrong answer or a wrong
  // implementation passing every earlier axis; all run through the CLI optimizer)
  test("PD22 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 VL-3: a namespace-admitted predicate bound to exo:Instance_class reaches the bridge", async () => {
    await expectSameAnswer(
      'SELECT ?s WHERE { VALUES ?p { exo:Instance_class } ?s ?p test:Gadget . FILTER(STRSTARTS(STR(?p), "https://exocortex.my/ontology/")) }',
    );
  });

  test("PD23 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 VL-3: a namespace-admitted predicate bound from DATA reaches the hierarchy bridge", async () => {
    await expectSameAnswer(
      'SELECT ?p ?v WHERE { ?f exo:Asset_label ?p . test:Gadget ?p ?v . FILTER(STRSTARTS(STR(?p), "https://exocortex.my/ontology/exo#")) }',
    );
  });

  test("PD24 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a membership predicate in the sub-property closure pulls the bridge", async () => {
    await expectSameAnswer("SELECT ?s WHERE { ?s test:memberOf test:Gadget }");
  });

  test("PD36 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: free-subject path whose CLOSURE reaches a membership predicate", async () => {
    await expectFullLoadIsNeeded(
      "SELECT ?c ?s WHERE { ?c ^test:memberOf ?s }",
      "class-bridge-path-free-subject",
      [TEST("memberOf"), EXO("Instance_class"), ...SIX],
    );
  });

  test("PD37 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: free-subject path + LIMIT (start nodes come in whole-graph order)", async () => {
    await expectFullLoadIsNeeded(
      "SELECT ?x WHERE { ?x exo:Property_superProperty+ ?y } LIMIT 2",
      "free-subject-path-order",
      [EXO("Property_superProperty")],
    );
  });

  test("PD38 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: free-subject path + GROUP_CONCAT", async () => {
    await expectFullLoadIsNeeded(
      "SELECT (GROUP_CONCAT(STR(?x)) AS ?g) WHERE { ?x exo:Property_superProperty+ ?y }",
      "free-subject-path-order",
      [EXO("Property_superProperty")],
    );
  });

  test("PA20 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 the same free-subject path WITHOUT an order-sensitive modifier prunes", async () => {
    await expectSameAnswer(
      "SELECT ?x WHERE { ?x exo:Property_superProperty+ ?y }",
    );
  });

  test("PD26 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a disjunction of namespace tests does not bound the predicate", async () => {
    await expectSound(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(CONTAINS(STR(?p), "ontology/flow#") || CONTAINS(STR(?p), "ontology/test#")) }',
    );
  });

  test("PD27 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a negated namespace test does not bound the predicate", async () => {
    await expectSound(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(!CONTAINS(STR(?p), "ontology/flow#")) }',
    );
  });

  test("PD28 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 one-or-more over a nullable path is nullable", async () => {
    await expectSound(
      `SELECT ?c WHERE { ?c (ems:Effort_status?)+ <obsidian://vault/${A.x}.md> }`,
    );
  });

  test("PD29 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 an alternative with one nullable branch is nullable", async () => {
    await expectSound(
      `SELECT ?c WHERE { ?c (flow:WorkItem_note|ems:Effort_status?) <obsidian://vault/${A.x}.md> }`,
    );
  });

  test("PD31 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a filter in one UNION branch does not bound the other branch", async () => {
    await expectSound(
      'SELECT * WHERE { { ?s ?p ?v } UNION { ?s flow:WorkItem_note ?n FILTER(CONTAINS(STR(?p), "ontology/flow#")) } }',
    );
  });

  test("PD32 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a filter inside a subquery does not bound the outer predicate", async () => {
    await expectSound(
      'SELECT * WHERE { ?s ?p ?v { SELECT ?s WHERE { ?s ?p ?x FILTER(CONTAINS(STR(?p), "ontology/flow#")) } } }',
    );
  });

  test("PD33 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a filter inside NOT EXISTS does not bound the outer predicate", async () => {
    await expectSound(
      'SELECT * WHERE { ?s ?p ?v FILTER NOT EXISTS { ?s flow:WorkItem_note ?n FILTER(CONTAINS(STR(?p), "ontology/flow#")) } }',
    );
  });

  test("PD34 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 rdf:type with a symbolic class object pulls the bridge", async () => {
    await expectSameAnswer("SELECT ?s WHERE { ?s rdf:type test:Gadget }");
  });

  test("PD35 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 rdfs:subClassOf with a symbolic subject pulls the bridge", async () => {
    await expectSameAnswer(
      "SELECT ?p WHERE { test:Gadget rdfs:subClassOf ?p }",
    );
  });
});

describe("QueryPredicateAnalyzer — review round 1 (witnesses and order counterexamples)", () => {
  test("PA21 the index carries a bridge parent and a W3C parent (fixture form)", () => {
    expect(context.subPropertyIndex.get(EXO("Instance_class"))).toEqual([
      TEST("kind"),
    ]);
    expect(context.subPropertyIndex.get(RDFS_LABEL)).toEqual([TEST("alias")]);
  });

  test("PD39 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 the DISTINCT input is read", async () => {
    await expectSameAnswer(
      "SELECT DISTINCT ?s WHERE { ?s ems:Effort_status ?o }",
    );
  });

  test("PD40 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 the REDUCED input is read", async () => {
    await expectSameAnswer(
      "SELECT REDUCED ?s WHERE { ?s ems:Effort_status ?o }",
    );
  });

  test("PD41 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 the ORDER BY input is read", async () => {
    await expectSameAnswer(
      "SELECT ?s WHERE { ?s ems:Effort_status ?o } ORDER BY ?s",
    );
  });

  test("PA22 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 byUUID on the RIGHT of a comparison is seen", () => {
    expectFull(
      `SELECT ?s WHERE { ?s exo:Asset_label ?l FILTER("x" != STR(exo:byUUID("${A.y}"))) }`,
      "uuid-lookup",
    );
  });

  test("PA23 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 byUUID inside a logical operand is seen", () => {
    expectFull(
      `SELECT ?s WHERE { ?s exo:Asset_label ?l FILTER(BOUND(?s) || STR(exo:byUUID("${A.y}")) = "x") }`,
      "uuid-lookup",
    );
  });

  test("PA24 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 byUUID as the TESTED expression of IN is seen", () => {
    expectFull(
      `SELECT ?s WHERE { ?s exo:Asset_label ?l FILTER(exo:byUUID("${A.y}") IN (?s)) }`,
      "uuid-lookup",
    );
  });

  test("PA40 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 byUUID inside the LIST of IN is seen", () => {
    expectFull(
      `SELECT ?s WHERE { ?s exo:Asset_label ?l FILTER(?s IN (exo:byUUID("${A.y}"))) }`,
      "uuid-lookup",
    );
  });

  test("PA25 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 byUUID inside arithmetic is seen", () => {
    expectFull(
      `SELECT ?s WHERE { ?s exo:Asset_label ?l FILTER(STRLEN(STR(exo:byUUID("${A.y}"))) + 1 > 0) }`,
      "uuid-lookup",
    );
  });

  test("PA26 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 byUUID inside an aggregate is seen", () => {
    expectFull(
      `SELECT (COUNT(exo:byUUID("${A.y}")) AS ?n) WHERE { ?s exo:Asset_label ?l }`,
      "uuid-lookup",
    );
  });

  test("PA27 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 byUUID as a slash-local-name function IRI is seen", () => {
    expectFull(
      `SELECT ?x WHERE { ?s exo:Asset_label ?l BIND(<http://example.org/fn/byUUID>("${A.y}") AS ?x) }`,
      "uuid-lookup",
    );
  });

  test("PD42 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a nullable SEQUENCE path with a free subject is a full load", async () => {
    const q = `SELECT ?c WHERE { ?c (ems:Effort_status?/flow:WorkItem_note?) <obsidian://vault/${A.x}.md> }`;
    await expectSound(q);
    expectFull(q, "zero-length-path-free-subject");
  });

  test("PD43 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 every item of a sequence path is collected", async () => {
    await expectSameAnswer(
      `SELECT ?y WHERE { <obsidian://vault/${A.a1}.md> concept:Concept_related/ems:Effort_status ?y }`,
    );
  });

  test("PD44 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 membership inside a constant-subject path pulls the bridge", async () => {
    await expectSameAnswer(
      "SELECT ?s WHERE { test:Gadget ^exo:Instance_class ?s }",
    );
  });

  test("PD45 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a namespace test on ANOTHER variable does not bound ?p", async () => {
    await expectSound(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(CONTAINS(STR(?v), "ontology/test#")) }',
    );
  });

  test("PD46 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 an outer filter does not bound ?p inside a subquery (row multiplicity)", async () => {
    await expectSound(
      'SELECT ?s ?v WHERE { ?s ?p ?v FILTER(CONTAINS(STR(?p), "ontology/flow#")) { SELECT ?s WHERE { ?s ?p ?x } } }',
    );
  });

  test("PA28 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 SAMPLE + a free-subject path is order-sensitive", () => {
    expectFull(
      "SELECT (SAMPLE(?x) AS ?s) WHERE { ?x exo:Property_superProperty+ ?y }",
      "free-subject-path-order",
    );
  });

  test("PA29 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a custom aggregate + a free-subject path is order-sensitive", () => {
    expectFull(
      "PREFIX agg: <https://exocortex.my/ontology/agg#> SELECT (agg:median(?n) AS ?m) WHERE { ?x exo:Property_superProperty+ ?y BIND(1 AS ?n) }",
      "free-subject-path-order",
    );
  });

  test("PA30 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 OFFSET + a free-subject path is order-sensitive", () => {
    expectFull(
      "SELECT ?x WHERE { ?x exo:Property_superProperty+ ?y } OFFSET 1",
      "free-subject-path-order",
    );
  });

  test("PA31 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a quoted triple (subject or object) is a full load", () => {
    expectFull(
      "SELECT ?x WHERE { << ?s exo:Asset_label ?l >> exo:Asset_relates ?x }",
      "quoted-triple",
    );
    expectFull(
      "SELECT ?x WHERE { ?x exo:Asset_relates << ?s exo:Asset_label ?l >> }",
      "quoted-triple",
    );
  });

  test("PD47 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 STRENDS and LCASE are not namespace tests", async () => {
    await expectSound(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(STRENDS(STR(?p), "_note")) }',
    );
    await expectSound(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(CONTAINS(LCASE(STR(?p)), "workitem")) }',
    );
    await expectSound(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(CONTAINS(LCASE(?p), "workitem")) }',
    );
  });

  test("PD48 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 the LEFT of OPTIONAL stays in the filter's group (VL-3 precision)", async () => {
    await expectSameAnswer(
      'SELECT * WHERE { ?s ?p ?v OPTIONAL { ?s exo:Asset_label ?l } FILTER(CONTAINS(STR(?p), "ontology/flow#")) }',
    );
  });

  test("PD55 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 the LEFT of MINUS stays in the filter's group (VL-3 precision)", async () => {
    await expectSameAnswer(
      'SELECT * WHERE { ?s ?p ?v MINUS { ?s ems:Effort_status "doing" } FILTER(CONTAINS(STR(?p), "ontology/flow#")) }',
    );
  });

  test("PA32 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 two namespace conjuncts intersect", () => {
    exactP(
      'SELECT * WHERE { ?s ?p ?v FILTER(CONTAINS(STR(?p), "ontology/flow#") && CONTAINS(STR(?p), "_note")) }',
      [FLOW("WorkItem_note")],
    );
  });

  test("PA33 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 STRSTARTS is a prefix test, not a substring test", () => {
    exactP(
      'SELECT * WHERE { ?s ?p ?v FILTER(STRSTARTS(STR(?p), "WorkItem")) }',
      [],
    );
  });

  test("PA34 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 the decorator never widens Instance_class or a W3C parent: P' stays exact", () => {
    exactP("SELECT ?s WHERE { ?s exo:Instance_class test:Gadget }", SIX);
    exactP("SELECT ?s ?l WHERE { ?s rdfs:label ?l }", [RDFS_LABEL]);
  });

  test("PA35 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full-load reasons are deduplicated", () => {
    const a = analyze(
      `SELECT * WHERE { ?a ems:Effort_status* <obsidian://vault/${A.x}.md> . ?b ems:Effort_status* <obsidian://vault/${A.y}.md> }`,
    );
    expect(a).toEqual({
      mode: "full",
      reasons: [{ kind: "zero-length-path-free-subject" }],
    });
  });

  test("PA36 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 sources say why each predicate is in P'", () => {
    const a = analyze("SELECT ?s ?o WHERE { ?s exo:Asset_relates ?o }");
    if (a.mode !== "prune") throw new Error("prune expected");
    const src = (p: string) => [...(a.sources.get(p) ?? [])].sort();
    expect(src(RELATES)).toEqual(["query"]);
    expect(src(RELATED)).toEqual(["sub-property"]);
    expect(src(EXO("Property_superProperty"))).toEqual([
      "sub-property-declarations",
    ]);
    const b = analyze("SELECT ?s WHERE { ?s exo:Instance_class test:Gadget }");
    if (b.mode !== "prune") throw new Error("prune expected");
    expect([...(b.sources.get(RDFS_LABEL) ?? [])]).toEqual(["class-bridge"]);
    expect([...(b.sources.get(EXO("Instance_class")) ?? [])].sort()).toEqual([
      "class-bridge",
      "query",
    ]);
    const c = analyze(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(CONTAINS(STR(?p), "ontology/flow#")) }',
    );
    if (c.mode !== "prune") throw new Error("prune expected");
    expect([...(c.sources.get(FLOW("WorkItem_note")) ?? [])]).toEqual([
      "namespace-filter",
    ]);
  });

  test("PA37 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 membership with a literal object does not pull the bridge", () => {
    exactP('SELECT ?s WHERE { ?s exo:Instance_class "x" }', [
      EXO("Instance_class"),
    ]);
  });

  test("PA38 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a namespace test is matched to a variable predicate by its variable NAME", () => {
    expectFull(
      'SELECT ?s ?p ?v WHERE { ?s ?p ?v FILTER(CONTAINS(STR(?s), "ontology/flow#")) }',
      "variable-predicate",
    );
  });

  test("PD49 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a filter inside MINUS does not bound the outer ?p", async () => {
    await expectSound(
      'SELECT * WHERE { ?s ?p ?v MINUS { ?s flow:WorkItem_note ?n FILTER(CONTAINS(STR(?p), "ontology/flow#")) } }',
    );
  });

  test("PD50 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a filter inside LATERAL does not bound the outer ?p", async () => {
    await expectSound(
      'SELECT * WHERE { ?s ?p ?v LATERAL { SELECT ?n WHERE { ?s flow:WorkItem_note ?n FILTER(CONTAINS(STR(?p), "ontology/flow#")) } } }',
    );
  });

  test("PD56 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a namespace filter inside a UNION branch bounds ?p of THAT branch", async () => {
    await expectSameAnswer(
      'SELECT * WHERE { { ?s ?p ?v FILTER(CONTAINS(STR(?p), "ontology/flow#")) } UNION { ?s exo:Asset_label ?v } }',
    );
  });

  test("PA41 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 byUUID inside the SECOND argument of a two-argument custom aggregate is seen", () => {
    expectFull(
      `PREFIX agg: <https://exocortex.my/ontology/agg#> SELECT (agg:corr(?n, STRLEN(STR(exo:byUUID("${A.y}")))) AS ?r) WHERE { ?s exo:Asset_label ?l BIND(1 AS ?n) }`,
      "uuid-lookup",
    );
  });

  test("PD51 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: namespace-bounded variable predicate + LIMIT (object-index order)", async () => {
    await expectFullLoadIsNeeded(
      `SELECT ?s WHERE { ?s ?p <obsidian://vault/${R.x}.md> FILTER(STRSTARTS(STR(?p), "https://exocortex.my/ontology/flow#")) } LIMIT 1`,
      "namespace-filter-order",
      [FLOW("WorkItem_stage"), FLOW("WorkItem_note")],
    );
  });

  test("PD52 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: namespace-bounded variable predicate + GROUP_CONCAT", async () => {
    await expectFullLoadIsNeeded(
      `SELECT (GROUP_CONCAT(STR(?s)) AS ?g) WHERE { ?s ?p <obsidian://vault/${R.x}.md> FILTER(STRSTARTS(STR(?p), "https://exocortex.my/ontology/flow#")) }`,
      "namespace-filter-order",
      [FLOW("WorkItem_stage"), FLOW("WorkItem_note")],
    );
  });

  test("PD53 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: SUM over a free-subject path (floating-point addition order)", async () => {
    await expectFullLoadIsNeeded(
      "SELECT (SUM(?v) AS ?s) WHERE { ?x test:val+ ?v }",
      "free-subject-path-order",
      [TEST("val")],
    );
  });

  test("PD54 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: AVG over a free-subject path", async () => {
    await expectFullLoadIsNeeded(
      "SELECT (AVG(?v) AS ?s) WHERE { ?x test:val+ ?v }",
      "free-subject-path-order",
      [TEST("val")],
    );
  });
});

describe("QueryPredicateAnalyzer — review round 2 (GROUP BY order, LATERAL group, two admitted predicates)", () => {
  test("PD57 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: GROUP BY over a free-subject path (first row's term)", async () => {
    await expectFullLoadIsNeeded(
      "SELECT ?v (COUNT(?x) AS ?n) WHERE { ?x test:num+ ?v } GROUP BY ?v",
      "free-subject-path-order",
      [TEST("num")],
    );
  });

  test("PD58 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: GROUP BY over a namespace-admitted variable predicate", async () => {
    await expectFullLoadIsNeeded(
      `SELECT ?v (COUNT(?s) AS ?n) WHERE { ?s ?p <obsidian://vault/${Q.x2}.md> . ?s test:num ?v FILTER(STRSTARTS(STR(?p), "https://exocortex.my/ontology/flow#")) } GROUP BY ?v`,
      "namespace-filter-order",
      [FLOW("WorkItem_stage"), FLOW("WorkItem_note"), TEST("num")],
    );
  });

  test("PD59 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: GROUP BY without an aggregate over a free-subject path", async () => {
    await expectFullLoadIsNeeded(
      "SELECT ?v WHERE { ?x test:num+ ?v } GROUP BY ?v",
      "free-subject-path-order",
      [TEST("num")],
    );
  });

  test("PD60 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 MIN / MAX / COUNT(DISTINCT) and DISTINCT over a free-subject path prune and keep the answer", async () => {
    await expectSameAnswer(
      "SELECT (MIN(?v) AS ?m) (MAX(?v) AS ?M) (COUNT(DISTINCT ?v) AS ?c) WHERE { ?x test:num+ ?v }",
    );
    await expectSameAnswer("SELECT DISTINCT ?v WHERE { ?x test:num+ ?v }");
  });

  test("PD61 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 a filter inside a LATERAL aggregate subquery does not bound the outer ?p", async () => {
    await expectSound(
      'SELECT ?s ?p ?v ?n WHERE { ?s ?p ?v LATERAL { SELECT (COUNT(?x) AS ?n) WHERE { ?s flow:WorkItem_note ?x FILTER(CONTAINS(STR(?p), "ontology/flow#")) } } }',
    );
  });

  test("PD62 @req:f5db994b-9f10-4d7c-9b25-e0022a789db6 full load is needed: TWO admitted variable predicates + LIMIT", async () => {
    await expectFullLoadIsNeeded(
      `SELECT ?s WHERE { ?s ?p <obsidian://vault/${R.x}.md> . ?s ?q ?w FILTER(STRSTARTS(STR(?p), "https://exocortex.my/ontology/flow#") && STRSTARTS(STR(?q), "https://exocortex.my/ontology/flow#")) } LIMIT 1`,
      "namespace-filter-order",
      [FLOW("WorkItem_stage"), FLOW("WorkItem_note")],
    );
  });
});
