/**
 * Production-shape integration test: sameTerm compares RDF TERMS, also when one
 * side is a literal constant written in the query (SPARQL 1.1 §17.4.1.8, RDF 1.1
 * literal term equality) — vault-exodev ems__Bug 290965dd.
 *
 * ## The defect
 *
 * A constant reached sameTerm as its JS value (`"Asset Two"` → a string, `42.0`
 * → 42): against a stored literal the pair was "different constructors" ⇒ false,
 * so `FILTER(sameTerm(?l, "Asset Two"))` dropped the matching row; and two
 * constants compared as JS values, so `sameTerm(42, 42.0)`, `sameTerm(4.20, 4.2)`
 * and `sameTerm("x"@en, "x")` were true. Between two Literals the datatype was
 * compared exactly — the RDF 1.0 reading that splits "a" from "a"^^xsd:string.
 *
 * The fix: the translator keeps a constant's lexical form (where its JS value does
 * not print it back) and language tag; the sameTerm handler rebuilds the constant's
 * exact term, takes DATATYPE(…) for the IRI it names, and makes a constant the
 * engine cannot build (`<tag:…>`, `""^^xsd:integer`, `""@en`) equal only to the
 * identical constant; a JS primitive (a value computed by STR / STRLEN / BIND /
 * arithmetic) against an RDF term stands for the literal of its JS kind; two
 * Literals compare by the datatype DATATYPE() reports.
 *
 * Revert-verify: `sameterm-constant-290965dd-*.spec.json` (one per subject file)
 * removes one guarantee per mutant and names the axes that must turn red.
 * Axes K1–K5 are controls, green on the pre-fix engine by construction; T9, T12,
 * T13, T17, T18, T23, T24, T28 and T31 guard against plausible wrong
 * implementations of the fix — the pre-fix engine answers those forms right as well.
 *
 * Not asserted here, on purpose — the answer is wrong before AND after this fix,
 * or becomes wrong with it, and belongs to another ticket:
 * - an IRI constant NESTED in an expression (`IF(true, <iri>, …)`, `COALESCE`) is
 *   still evaluated as a string; only a direct sameTerm argument is the IRI term
 *   (ems__Bug 160034f7);
 * - the value of an expression is a JS primitive, not an RDF term, so its exact
 *   type is unknown here and taken as the literal of its JS kind: `BIND(42.0 AS ?x)`
 *   holds 42 (integer), `LCASE("X"@en)` holds "x", `?n / 1` and `?n * 1.0` hold 42 —
 *   `sameTerm(?x, 42.0)`, `sameTerm(LCASE("X"@en), "x"@en)` are false and
 *   `sameTerm(?n, ?n / 1)` is true (ems__Bug 864dc82a);
 * - an EXISTS anywhere in a function's arguments sends the call through the async
 *   evaluator, which wraps every argument as an untyped literal node — term
 *   functions see strings (ems__Bug 67c8925f);
 * - MIN / MAX / SAMPLE return a new xsd:decimal / xsd:string literal instead of
 *   the group's term (ems__Bug 2e597cb5);
 * - a BIND that holds DATATYPE(…), and IF / COALESCE over it, yield the IRI's
 *   string, so `BIND(DATATYPE(?v) AS ?t) FILTER(sameTerm(?t, xsd:integer))` and
 *   `sameTerm(IF(true, DATATYPE(?v), xsd:string), xsd:integer)` are false — they
 *   were true only because the IRI constant was a string too; likewise a computed
 *   value equal to a constant the engine cannot build — `sameTerm(""@en,
 *   LCASE(""@en))`, `BIND("x"^^<tag:…> AS ?t) FILTER(sameTerm(?t, "x"^^<tag:…>))` —
 *   is false: the computed side is a JS value without its language or datatype
 *   (ems__Bug 864dc82a);
 * - the classes above change the direction of their error for some forms — a
 *   computed string now equals a stored literal of that text:
 *   `sameTerm(IF(true, <https://x.y/z>, "q"), ?v)` against a stored "https://x.y/z",
 *   `sameTerm(CONCAT("a"@en, "b"@en), ?v)` against a stored "ab" are true;
 * - the base direction of a constant (`"x"@ar--rtl`) is dropped before parsing, so
 *   it equals "x"@ar (ems__Bug 0b24c745).
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
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { evaluateWithExoEval } from "../../../src/exoql/evaluateWithExoEval";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { BuiltInFunctions } from "../../../src/infrastructure/sparql/filters/BuiltInFunctions";
import type { AlgebraOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";

let seq = 0;
const uid = () =>
  `290965dd-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (u: string, fm: IFrontmatter): FixtureNote => ({
  uid: u,
  frontmatter: { exo__Asset_uid: u, ...fm },
});

// ---------------------------------------------------------------- population
// Two bugs with plain labels; "Asset Two" also carries the YAML number 42, which
// the converter stores as "42"^^xsd:integer (ticket d5ad5217). Noise notes make
// an engine that ignores the class pattern visibly wrong.
const BUG_CLASS = uid();
const NOTES: FixtureNote[] = [
  note(BUG_CLASS, { exo__Asset_label: "ems__Bug" }),
  note(uid(), {
    exo__Asset_label: "Asset One",
    exo__Instance_class: `[[${BUG_CLASS}]]`,
  }),
  note(uid(), {
    exo__Asset_label: "Asset Two",
    exo__Instance_class: `[[${BUG_CLASS}]]`,
    stand__Thing_n: 42,
  }),
  ...Array.from({ length: 4 }, (_, i) =>
    note(uid(), { exo__Asset_label: `Noise ${i}`, stand__Thing_n: 42 }),
  ),
  // An Exo 0.0.3 statement whose object is a plain string: Exo003Parser.toTriple
  // stores it with the default language tag — "x"@ru (DEFAULT_LANGUAGE_TAG).
  {
    uid: uid(),
    frontmatter: {
      metadata: "statement",
      subject: "https://example.org/s290965dd",
      predicate: "https://example.org/p290965dd",
      object: "x",
    },
  },
];

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

let store: InMemoryTripleStore;
beforeAll(async () => {
  store = new InMemoryTripleStore();
  await store.addAll(await convertAll(NOTES));
});

const PREFIX = `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX st: <https://exocortex.my/ontology/stand#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`;
const q = (sparql: string) => `${PREFIX}\n${sparql}`;

/** The algebra `exocortex-cli query` executes: translated, then optimized. */
const plan = (sparql: string): AlgebraOperation =>
  new AlgebraOptimizer().optimize(
    new ExoQLAlgebraTranslator().translate(new SPARQLParser().parse(q(sparql))),
  );
const run = (sparql: string) => new ExoQLQueryExecutor(store).executeAll(plan(sparql));

/** The two bugs, one label each. */
const W = `?s exo:Instance_class ems:Bug . ?s exo:Asset_label ?l .`;
/** The one bug that carries ?n = "42"^^xsd:integer. */
const N = `?s exo:Instance_class ems:Bug . ?s st:Thing_n ?n .`;

/** Number of distinct bugs for which `extra` holds over W. */
const pop = async (extra: string, where = W): Promise<number> =>
  (await run(`SELECT DISTINCT ?s WHERE { ${where} ${extra} }`)).length;
/** Number of result rows of a whole query. */
const rows = async (sparql: string): Promise<number> => (await run(sparql)).length;

const SUITE = "sameTerm compares terms, a query constant included (ems__Bug 290965dd)";

describe(SUITE, () => {
  // ------------------------------------------------------------- controls
  it("K1 population: two bugs; ?n is \"42\"^^xsd:integer on one of them", async () => {
    expect(await pop("")).toBe(2);
    expect(await pop("", N)).toBe(1);
    const r = await run(`SELECT ?n WHERE { ${N} }`);
    const n = r[0].get("n") as Literal;
    expect(n).toBeInstanceOf(Literal);
    expect([n.value, n.datatype?.value]).toEqual([
      "42",
      "http://www.w3.org/2001/XMLSchema#integer",
    ]);
  });

  it("K2 controls that were right before the fix stay right", async () => {
    expect(await pop(`FILTER(?l = "Asset Two")`)).toBe(1);
    expect(await pop(`FILTER(sameTerm(?l, ?l))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(?s, ?s))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(STR(?l), "Asset Two"))`)).toBe(1);
    expect(await pop(`FILTER(sameTerm(STR(?l), STR(?l)))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(?l, "Asset Three"))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(?n, "42"))`, N)).toBe(0);
    expect(await pop(`FILTER(sameTerm(?n, 42.0))`, N)).toBe(0);
    expect(await pop(`FILTER(sameTerm(?l, "Asset Two"@en))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(true, "true"))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(1, "1"))`)).toBe(0);
  });

  it("K3 equal constants are the same term", async () => {
    expect(await pop(`FILTER(sameTerm("a", "a"))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(42, 42))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(42.0, 42.0))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(true, true))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm("x"@en, "x"@en))`)).toBe(2);
    expect(
      await pop(
        `FILTER(sameTerm("2026-01-01T00:00:00"^^xsd:dateTime, "2026-01-01T00:00:00"^^xsd:dateTime))`,
      ),
    ).toBe(2);
  });

  it("K4 an unbound argument stays an evaluation error — the row is dropped either way", async () => {
    expect(await pop(`FILTER(sameTerm(?nope, "x"))`)).toBe(0);
    expect(await pop(`FILTER(!sameTerm(?nope, "x"))`)).toBe(0);
    expect(await pop(`FILTER(!sameTerm("x", ?nope))`)).toBe(0);
    expect(await pop(`FILTER(!sameTerm(?nope, "x"^^<tag:ex.org,2026:dt>))`)).toBe(0);
    expect(await pop(`FILTER(!sameTerm("x"^^<tag:ex.org,2026:dt>, ?nope))`)).toBe(0);
  });

  // ------------------------------------------------------------- the defect
  it("T1 a string constant is the stored simple literal — either order, plain or ^^xsd:string", async () => {
    expect(await pop(`FILTER(sameTerm(?l, "Asset Two"))`)).toBe(1);
    expect(await pop(`FILTER(sameTerm("Asset Two", ?l))`)).toBe(1);
    expect(await pop(`FILTER(sameTerm(?l, "Asset Two"^^xsd:string))`)).toBe(1);
    expect(await pop(`FILTER(!sameTerm(?l, "Asset Two"))`)).toBe(1);
  });

  it("T2 a numeric constant is the stored typed literal — 42 and \"42\"^^xsd:integer, either order", async () => {
    expect(await pop(`FILTER(sameTerm(?n, 42))`, N)).toBe(1);
    expect(await pop(`FILTER(sameTerm(42, ?n))`, N)).toBe(1);
    expect(await pop(`FILTER(sameTerm(?n, "42"^^xsd:integer))`, N)).toBe(1);
  });

  it("T3 a computed value against a stored term — STR, BIND, IF, COALESCE", async () => {
    expect(await pop(`FILTER(sameTerm(?l, STR(?l)))`)).toBe(2);
    expect(await pop(`BIND("Asset Two" AS ?b) FILTER(sameTerm(?l, ?b))`)).toBe(1);
    expect(await pop(`FILTER(sameTerm(IF(true, "Asset Two", "x"), ?l))`)).toBe(1);
    expect(await pop(`FILTER(sameTerm(COALESCE(?nope, "Asset Two"), ?l))`)).toBe(1);
    expect(await pop(`BIND(42 AS ?x) FILTER(sameTerm(?n, ?x))`, N)).toBe(1);
  });

  it("T4 RDF 1.1: a VALUES literal (explicit xsd:string) is the stored simple literal", async () => {
    expect(await pop(`VALUES ?x { "Asset Two" } FILTER(sameTerm(?l, ?x))`)).toBe(1);
    expect(await pop(`VALUES ?x { "Asset Two"^^xsd:string } FILTER(sameTerm(?l, ?x))`)).toBe(1);
    expect(await pop(`VALUES ?x { 42 } FILTER(sameTerm(?n, ?x))`, N)).toBe(1);
    expect(await pop(`VALUES ?x { 42.0 } FILTER(sameTerm(?n, ?x))`, N)).toBe(0);
    // the unit: one term for "a" and "a"^^xsd:string, two for "a" and "a"@en
    const XSD_STRING = new IRI("http://www.w3.org/2001/XMLSchema#string");
    expect(BuiltInFunctions.sameTerm(new Literal("a"), new Literal("a", XSD_STRING))).toBe(true);
    expect(BuiltInFunctions.sameTerm(new Literal("a"), new Literal("a", undefined, "en"))).toBe(false);
    // and the base direction of a directional literal is part of the term
    expect(
      BuiltInFunctions.sameTerm(new Literal("a", undefined, "ar", "rtl"), new Literal("a", undefined, "ar")),
    ).toBe(false);
    expect(
      BuiltInFunctions.sameTerm(new Literal("a", undefined, "ar", "rtl"), new Literal("a", undefined, "ar", "rtl")),
    ).toBe(true);
  });

  it("T5 a constant on the LEFT keeps its exact term — lexical form, datatype", async () => {
    expect(await pop(`FILTER(sameTerm(4.20, 4.2))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("042"^^xsd:integer, 42))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(42.0, 42))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("42"^^xsd:integer, 42.0))`)).toBe(0);
  });

  it("T6 a constant on the RIGHT keeps its exact term — lexical form, datatype", async () => {
    expect(await pop(`FILTER(sameTerm(4.2, 4.20))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(42, "042"^^xsd:integer))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(42, 42.0))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(?n, "042"^^xsd:integer))`, N)).toBe(0);
  });

  it("T7 the language tag is part of the term — @en / none / @fr, either order, and STR drops it", async () => {
    expect(await pop(`FILTER(sameTerm("x"@en, "x"))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("x", "x"@en))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("x"@en, "x"@fr))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("x"@fr, "x"@en))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(STR("x"@en), "x"@en))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("x"@en, "x"@en-US))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("x"@en-US, "x"@en))`)).toBe(0);
  });

  it("T8 a computed number is the literal of its JS kind — whole xsd:integer, fractional xsd:decimal", async () => {
    expect(await pop(`FILTER(sameTerm(STRLEN(?l), 9))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(STRLEN(?l), 9.0))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(1 + 1, 2))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(1 + 1, 2.0))`)).toBe(0);
    expect(await pop(`BIND(42 AS ?x) FILTER(sameTerm(?x, 42.0))`)).toBe(0);
    expect(await pop(`BIND(42.5 AS ?x) FILTER(sameTerm(?x, 42.5))`)).toBe(2);
  });

  it("T9 the empty string between constants and computed values is itself", async () => {
    expect(await pop(`FILTER(sameTerm("", ""))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(STR(""), ""))`)).toBe(2);
  });

  it("K5 an IRI constant against itself is one term, against another IRI two", async () => {
    expect(await pop(`FILTER(sameTerm(<https://x.y/z>, <https://x.y/z>))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(?s, <https://x.y/z>))`)).toBe(0);
  });

  it("T10 HAVING and SELECT expressions — the same answers outside FILTER", async () => {
    expect(
      await rows(`SELECT (MAX(?l) AS ?m) WHERE { ${W} } HAVING (sameTerm(MAX(?l), "Asset Two"))`),
    ).toBe(1);
    expect(
      await rows(`SELECT (COUNT(?l) AS ?c) WHERE { ${W} } HAVING (sameTerm(COUNT(?l), 2))`),
    ).toBe(1);
    expect(
      await rows(`SELECT (COUNT(?l) AS ?c) WHERE { ${W} } HAVING (sameTerm(COUNT(?l), 2.0))`),
    ).toBe(0);
    const sel = await run(
      `SELECT ?l (sameTerm(?l, "Asset Two") AS ?b) (sameTerm(42, 42.0) AS ?c) WHERE { ${W} } ORDER BY ?l`,
    );
    const asBool = (v: unknown) => String(v instanceof Literal ? v.value : v);
    expect(sel.map((r) => [asBool(r.get("b")), asBool(r.get("c"))])).toEqual([
      ["false", "false"],
      ["true", "false"],
    ]);
    expect(await pop(`BIND(sameTerm(?l, "Asset Two") AS ?b) FILTER(?b)`)).toBe(1);
    expect(await pop(`FILTER EXISTS { FILTER(sameTerm(?l, "Asset Two")) }`)).toBe(1);
  });

  it("T11 every path that evaluates a FILTER — precondition ASK and run-query", async () => {
    const pre = new PreconditionEvaluator(store);
    const askPre = (cond: string) =>
      pre.evaluate(
        { id: `p-290965dd-${cond.length}`, label: "probe", sparqlAsk: q(`ASK { ${W} FILTER(${cond}) }`) },
        "obsidian://vault/target.md",
      );
    expect(await askPre(`sameTerm(?l, "Asset Two")`)).toBe(true);
    expect(await askPre(`sameTerm(42, 42.0)`)).toBe(false);
    const rq = await evaluateWithExoEval(
      q(`SELECT ?l WHERE { ${W} FILTER(sameTerm(?l, "Asset Two")) }`),
      { store },
    );
    if (rq.kind !== "select") throw new Error(`run-query returned ${rq.kind}`);
    expect(rq.rows.length).toBe(1);
  });

  it("T12 a computed boolean is xsd:boolean — not the string \"true\"", async () => {
    expect(await pop(`BIND(true AS ?x) FILTER(sameTerm(?x, true))`)).toBe(2);
    expect(await pop(`BIND(true AS ?x) FILTER(sameTerm(?x, "true"))`)).toBe(0);
  });

  it("T13 no stored literal is the empty string — and comparing with \"\" is not an error", async () => {
    expect(await pop(`FILTER(sameTerm(?l, ""))`)).toBe(0);
    expect(await pop(`FILTER(!sameTerm(?l, ""))`)).toBe(2);
    expect(await pop(`FILTER(!sameTerm("", ?l))`)).toBe(2);
  });

  it("T14 a value substituted into EXISTS keeps its term — typed and simple", async () => {
    expect(await pop(`FILTER EXISTS { FILTER(sameTerm(?n, 42)) }`, N)).toBe(1);
    expect(await pop(`FILTER EXISTS { FILTER(sameTerm(?n, 42.0)) }`, N)).toBe(0);
    expect(await pop(`FILTER EXISTS { FILTER(sameTerm(?l, "Asset Two")) }`)).toBe(1);
    // the plan is JSON-cloned into EXISTS, and NaN becomes null there — the lexical form must survive
    expect(await pop(`FILTER EXISTS { FILTER(sameTerm("NaN"^^xsd:decimal, "null"^^xsd:decimal)) }`)).toBe(0);
  });

  it("T15 a stored language-tagged literal (Exo 0.0.3, \"x\"@ru) — direct and substituted into EXISTS", async () => {
    const X = `?o0 <https://example.org/p290965dd> ?o .`;
    const n = async (extra: string) =>
      (await run(`SELECT ?o WHERE { ${X} ${extra} }`)).length;
    expect(await n("")).toBe(1);
    expect(await n(`FILTER(sameTerm(?o, "x"@ru))`)).toBe(1);
    expect(await n(`FILTER(sameTerm(?o, "x"))`)).toBe(0);
    expect(await n(`FILTER(sameTerm(?o, "x"@en))`)).toBe(0);
    expect(await n(`FILTER EXISTS { FILTER(sameTerm(?o, "x"@ru)) }`)).toBe(1);
    expect(await n(`FILTER EXISTS { FILTER(sameTerm(?o, "x")) }`)).toBe(0);
  });

  it("T16 a boolean constant keeps its lexical form — \"0\"^^xsd:boolean is not false", async () => {
    expect(await pop(`FILTER(sameTerm("0"^^xsd:boolean, false))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("1"^^xsd:boolean, true))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("true"^^xsd:boolean, true))`)).toBe(2);
    expect(await pop(`VALUES ?b { false } FILTER(sameTerm(?b, "0"^^xsd:boolean))`)).toBe(0);
  });

  it("T17 a string is never an IRI — a computed or VALUES string against an IRI with the same text", async () => {
    expect(await pop(`FILTER(sameTerm(?s, STR(?s)))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(STR(?s), ?s))`)).toBe(0);
    expect(await pop(`VALUES ?u { "https://x.y/z" } FILTER(sameTerm(?u, <https://x.y/z>))`)).toBe(0);
    expect(await pop(`VALUES ?u { "https://x.y/z" } FILTER(sameTerm(<https://x.y/z>, ?u))`)).toBe(0);
    expect(await pop(`VALUES ?u { "https://x.y/z" } FILTER(!sameTerm(?u, <https://x.y/z>))`)).toBe(2);
  });

  it("T18 a simple literal is not a typed literal of another datatype with the same text", async () => {
    expect(await pop(`FILTER(sameTerm(STR(?n), ?n))`, N)).toBe(0);
    expect(await pop(`BIND(STR(?n) AS ?x) FILTER(sameTerm(?n, ?x))`, N)).toBe(0);
    expect(await pop(`FILTER(sameTerm(?l, "Asset Two"^^<https://ex.org/dt>))`)).toBe(0);
  });

  it("T19 a computed number keeps its own kind — not the other side's numeric datatype", async () => {
    expect(await pop(`FILTER(sameTerm(STRLEN(?l), "9"^^xsd:decimal))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(STRLEN(?l), "9"^^xsd:integer))`)).toBe(2);
  });

  it("T20 a constant the engine cannot build is only the identical constant", async () => {
    expect(await pop(`FILTER(sameTerm("x"^^<tag:ex.org,2026:dt>, "x"^^<tag:ex.org,2026:dt>))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm("x"^^<tag:ex.org,2026:dt>, "y"^^<tag:ex.org,2026:dt>))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(<tag:ex.org,2026:a>, <tag:ex.org,2026:b>))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(""^^xsd:integer, ""^^xsd:integer))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(""@en, ""@en))`)).toBe(2);
  });

  it("T21 an IRI constant is the IRI term — the stored subject matches, a string does not", async () => {
    const two = (await run(`SELECT ?s WHERE { ${W} FILTER(?l = "Asset Two") }`))[0].get("s") as IRI;
    expect(two).toBeInstanceOf(IRI);
    expect(await pop(`FILTER(sameTerm(?s, <${two.value}>))`)).toBe(1);
    expect(await pop(`FILTER(sameTerm(<${two.value}>, ?s))`)).toBe(1);
    expect(await pop(`FILTER(sameTerm(<https://x.y/z>, "https://x.y/z"))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(<tag:ex.org,2026:z>, <tag:ex.org,2026:z>))`)).toBe(2);
  });

  it("T22 a constant written in canonical form is the plain literal node — the lexical form only where it differs", () => {
    const XSD = "http://www.w3.org/2001/XMLSchema#";
    const literals = (cond: string): unknown[] => {
      const found: unknown[] = [];
      JSON.stringify(
        new ExoQLAlgebraTranslator().translate(new SPARQLParser().parse(q(`SELECT ?l WHERE { ${W} FILTER(${cond}) }`))),
        (_k, v: unknown) => {
          if (v && typeof v === "object" && (v as { type?: unknown }).type === "literal") found.push(v);
          return v;
        },
      );
      return found;
    };
    expect(literals(`STRLEN(?l) > 0`)).toStrictEqual([{ type: "literal", value: 0, datatype: `${XSD}integer` }]);
    expect(literals(`?l != true`)).toStrictEqual([{ type: "literal", value: true, datatype: `${XSD}boolean` }]);
    expect(literals(`STRLEN(?l) > 0.0`)).toStrictEqual([
      { type: "literal", value: 0, datatype: `${XSD}decimal`, lexical: "0.0" },
    ]);
  });

  it("T23 the async evaluator's untyped node keeps the old answer — not a literal of its text", async () => {
    // EXISTS in an argument sends sameTerm through the async evaluator, which wraps every
    // computed argument as a literal node with no datatype (ems__Bug 67c8925f)
    expect(await pop(`FILTER(sameTerm(IF(EXISTS { ?s ?p ?o }, 42, 0), "42"))`)).toBe(0);
    expect(await pop(`FILTER(!sameTerm(IF(EXISTS { ?s ?p ?o }, ?nope, ?nope), "x"))`)).toBe(0);
  });

  it("T24 a whole number beyond 2^53 is still xsd:integer", async () => {
    expect(await pop(`FILTER(sameTerm(10000000000000000 + 0, 10000000000000000))`)).toBe(2);
  });

  it("T25 the base direction compares by value — rtl is not ltr", () => {
    expect(
      BuiltInFunctions.sameTerm(new Literal("a", undefined, "ar", "rtl"), new Literal("a", undefined, "ar", "ltr")),
    ).toBe(false);
  });

  it("T26 DATATYPE(…) is an IRI — the idiom sameTerm(DATATYPE(?x), xsd:…)", async () => {
    expect(await pop(`FILTER(sameTerm(DATATYPE(?l), xsd:string))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(xsd:string, DATATYPE(?l)))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm(DATATYPE(?n), xsd:integer))`, N)).toBe(1);
    expect(await pop(`FILTER(sameTerm(DATATYPE(?l), xsd:integer))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(DATATYPE(?l), "http://www.w3.org/2001/XMLSchema#string"))`)).toBe(0);
  });

  it("T27 a constant the engine cannot build is no stored, VALUES or computed term", async () => {
    expect(await pop(`FILTER(sameTerm(?l, "Asset Two"^^<tag:ex.org,2026:dt>))`)).toBe(0);
    expect(await pop(`FILTER(!sameTerm(?l, "Asset Two"^^<tag:ex.org,2026:dt>))`)).toBe(2);
    expect(await pop(`FILTER(!sameTerm(?l, "x"^^<tag:ex.org,2026:dt>))`)).toBe(2);
    expect(await pop(`VALUES ?u { "tag:ex.org,2026:z" } FILTER(sameTerm(?u, <tag:ex.org,2026:z>))`)).toBe(0);
    expect(await pop(`VALUES ?u { "tag:ex.org,2026:z" } FILTER(sameTerm(<tag:ex.org,2026:z>, ?u))`)).toBe(0);
    expect(await pop(`VALUES ?b { false } FILTER(sameTerm(?b, ""^^xsd:boolean))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(""@en, ""))`)).toBe(0);
  });

  it("T28 an unbuildable constant's datatype is part of it — \"\"^^xsd:integer is not \"\"^^xsd:boolean", async () => {
    expect(await pop(`FILTER(sameTerm(""^^xsd:integer, ""^^xsd:boolean))`)).toBe(0);
  });

  it("T29 an unbuildable constant's language is part of it — \"\"@en is not \"\"@fr", async () => {
    expect(await pop(`FILTER(sameTerm(""@en, ""@fr))`)).toBe(0);
  });

  it("T30 only DATATYPE(…) is an IRI — a computed string with an IRI's text stays a literal", async () => {
    expect(await pop(`FILTER(sameTerm(STR(DATATYPE(?n)), xsd:integer))`, N)).toBe(0);
    expect(await pop(`FILTER(sameTerm(DATATYPE(?l), STR(DATATYPE(?l))))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(CONCAT("http://www.w3.org/2001/XMLSchema#", "string"), xsd:string))`)).toBe(0);
  });

  it("T31 Infinity survives the JSON clone of the plan into EXISTS too", async () => {
    expect(await pop(`FILTER EXISTS { FILTER(sameTerm("Infinity"^^xsd:decimal, "null"^^xsd:decimal)) }`)).toBe(0);
  });
});
