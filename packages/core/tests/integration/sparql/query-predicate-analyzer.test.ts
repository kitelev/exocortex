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
    expect(context.subPropertyIndex.get(TEST("memberOf"))).toEqual([
      EXO("Instance_class"),
    ]);
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
