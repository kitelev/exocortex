/**
 * Production-shape integration test: SPARQL arithmetic (`+ - * /`) over a
 * NON-numeric operand is a type error (SPARQL 1.1 §17.3), not a number parsed
 * out of the operand's text (vault-exodev ems__Bug 02355814).
 *
 * ## The defect
 *
 * `FilterExecutor.toNumericValue` ran `parseFloat` over whatever it got — a
 * string, a literal of any datatype, any object with a `.value` — so every text
 * that STARTS with digits passed as a number: `0 - "7"` = -7, `0 - "7abc"` = -7,
 * `0 - "2026-11-10"^^xsd:date` = -2026 (the year), and FILTER kept the row, BIND
 * bound a plausible number, COALESCE never reached its fallback. rc 0.
 *
 * ## What the fix must NOT break
 *
 * The engine carries some NUMERIC values as bare strings, and the coercion was
 * what made them work: a query constant the translator leaves as text
 * (`1.5e0`, `"2.5"^^xsd:float`, `"3"^^xsd:int`) and a store value a bind join or
 * EXISTS substitutes into the expression (`termToAlgebraNode` keeps the lexical
 * form and the datatype on the node, evaluation drops the datatype). The fix
 * reads the datatype off the operand NODE before evaluating it
 * (`evaluateArithmeticOperand`), for BOTH operands; A8 / A9 lock the right one,
 * A11 / A12 the left one. Only a DIRECT operand keeps its type — see below.
 *
 * ## Not asserted here, on purpose
 *
 * - A numeric constant that loses its type BEFORE it reaches arithmetic — bound by
 *   `BIND(1.5e0 AS ?k)`, projected by a subquery, returned by `COALESCE(?u, 1.5e0)` /
 *   `IF(…, "3"^^xsd:int, …)`: evaluation returns the constant as a plain string, so
 *   arithmetic sees text and now rejects it (named limitation of this fix,
 *   ems__Bug c42f1a54, stand forms N1–N4).
 * - The same for a STORE value a bind join / EXISTS / LATERAL substitutes, when it
 *   first passes through COALESCE / IF / BIND or a projection:
 *   `NOT EXISTS { … FILTER(?m > COALESCE(?n, 0) + 1) }` — on 17.18.3 the coercion
 *   computed it, now it is a type error (named limitation N7, same root c42f1a54).
 * - SUM / AVG over an expression that raises: the aggregate skips the error and an
 *   empty sum is 0 (`AggregateExecutor`), so `SUM(?t + 0)` is 0 where SPARQL 1.1
 *   says unbound. A15 locks only what reaches the aggregate — an error (COUNT 0,
 *   MIN unbound) — not SUM's 0.
 * - Text that looks like a dateTime taken as a dateTime by the date/duration
 *   branches (`"2026-11-10T10:00:00" - "2026-11-09T10:00:00"` = P1D) — a separate
 *   coercion (`isDateTimeValue`), not `toNumericValue`.
 * - An ill-typed NUMERIC literal (`"7abc"^^xsd:integer` = 7) and the valid
 *   `xsd:double` forms `INF` / `NaN` — the lexical form of a numeric literal is still
 *   read by `parseFloat`, as before (ems__Bug 8bf29e93). A form it cannot read at all
 *   (`"abc"^^xsd:double`) stays a type error, not NaN — A13 / A14. Which reading of
 *   the lexical form is right is 8bf29e93's to define, so `parseFloat` itself is NOT
 *   pinned (`Number()` in its place passes these axes).
 * - A query constant whose datatype IRI contains `#integer` / `#decimal`: the
 *   translator turns it into a JS number by substring (`"7"^^<urn:x:dt#integer> + 1`
 *   = 8, `"abc"^^xsd:integer + 1` = NaN), before `toNumericValue` (ems__Bug efc04321).
 *
 * Revert-verify: `strict-arithmetic-02355814-filter-executor.spec.json` removes one
 * guarantee per mutant and names the axes that must turn red. C1–C4 are controls,
 * green on the pre-fix engine by construction.
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
} from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { evaluateWithExoEval } from "../../../src/exoql/evaluateWithExoEval";
import { ExoQL } from "../../../src/exoql";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { Literal } from "../../../src/domain/models/rdf/Literal";

let seq = 0;
const uid = () =>
  `02355814-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (u: string, fm: IFrontmatter): FixtureNote => ({
  uid: u,
  frontmatter: { exo__Asset_uid: u, ...fm },
});

// ---------------------------------------------------------------- population
// Two bugs, labels of length 7 and 9 (?o = STRLEN(?l) — a JS number), and one
// property of every literal kind the converter emits: a YAML integer
// (xsd:integer 7 / 9), a YAML fraction (xsd:decimal 2.5), a quoted "7" (a plain
// literal) and an ISO timestamp (xsd:dateTime).
const BUG_CLASS = uid();
const bug = (label: string, n: number): FixtureNote =>
  note(uid(), {
    exo__Asset_label: label,
    exo__Instance_class: `[[${BUG_CLASS}]]`,
    ems__Effort_votes: n,
    ems__Effort_weight: 2.5,
    ems__Effort_code: "7",
    ems__Effort_startTimestamp: "2026-11-10T10:00:00",
  });
const NOTES: FixtureNote[] = [
  note(BUG_CLASS, { exo__Asset_label: "ems__Bug" }),
  bug("Asset A", 7),
  bug("Asset Bbb", 9),
  ...Array.from({ length: 3 }, (_, i) => note(uid(), { exo__Asset_label: `Noise ${i}` })),
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
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`;
const q = (sparql: string) => `${PREFIX}\n${sparql}`;

/** Body of W: two solutions, ?o = 7 / 9, store-typed ?n ?d ?t ?ts. */
const B = `?s exo:Instance_class ems:Bug . ?s exo:Asset_label ?l . BIND(STRLEN(?l) AS ?o)`;
const B2 = `${B} ?s ems:Effort_votes ?n ; ems:Effort_weight ?d ; ems:Effort_code ?t ; ems:Effort_startTimestamp ?ts .`;
const W = `{ ${B} }`;
const W2 = `{ ${B2} }`;

const translate = (sparql: string): AlgebraOperation =>
  new ExoQLAlgebraTranslator().translate(new SPARQLParser().parse(q(sparql)));

/** Term → its lexical value; JS primitives as strings; unbound → "UNBOUND". */
const val = (t: unknown): string => {
  if (t === undefined || t === null) return "UNBOUND";
  if (typeof t === "number" || typeof t === "boolean" || typeof t === "string") return String(t);
  if (typeof t === "object" && t !== null && "value" in t) return String((t as { value: unknown }).value);
  return JSON.stringify(t);
};

type Rows = Array<{ get(name: string): unknown }>;

const select = async (sparql: string): Promise<Rows> =>
  (await new ExoQLQueryExecutor(store).executeAll(translate(sparql))) as unknown as Rows;
const ask = (sparql: string): Promise<boolean> =>
  new ExoQLQueryExecutor(store).executeAsk(translate(sparql) as AskOperation);
const col = async (sparql: string, name: string, run = select): Promise<string[]> =>
  (await run(sparql)).map((r) => val(r.get(name))).sort();

/** BIND(E AS ?x) over W (or W2): the values of ?x, sorted. */
const bindX = (e: string, body = B) => col(`SELECT ?x WHERE { ${body} BIND(${e} AS ?x) }`, "x");
const UNBOUND2 = ["UNBOUND", "UNBOUND"];
const BOTH = ["Asset A", "Asset Bbb"];

const pluginTranslator = new ExoQLAlgebraTranslator();
const pluginOptimizer = new AlgebraOptimizer();
const SELECT_PATHS: Record<string, (sparql: string) => Promise<Rows>> = {
  runQuery: async (sparql) => {
    const r = await evaluateWithExoEval(q(sparql), { store });
    if (r.kind !== "select") throw new Error(`run-query returned ${r.kind}`);
    return r.rows as unknown as Rows;
  },
  exoql: async (sparql) => (await ExoQL.query(q(sparql), store)) as unknown as Rows,
  plugin: async (sparql) => {
    const algebra = pluginOptimizer.optimize(
      pluginTranslator.translate(new SPARQLParser().parse(q(sparql))),
    );
    return (await new ExoQLQueryExecutor(store).executeAll(algebra)) as unknown as Rows;
  },
};

describe("SPARQL arithmetic over a non-numeric operand is a type error (ems__Bug 02355814)", () => {
  // ------------------------------------------------------------ controls
  it("C1 population: two solutions, and every literal kind the axes rely on is in the store", async () => {
    expect(await col(`SELECT ?l WHERE ${W2}`, "l")).toEqual(BOTH);
    const row = (await select(`SELECT ?n ?d ?t ?ts WHERE ${W2} LIMIT 1`))[0];
    const dt = (v: unknown) => (v instanceof Literal ? (v.datatype?.value ?? "plain") : typeof v);
    expect(dt(row.get("n"))).toBe("http://www.w3.org/2001/XMLSchema#integer");
    expect(dt(row.get("d"))).toBe("http://www.w3.org/2001/XMLSchema#decimal");
    expect(dt(row.get("t"))).toBe("plain");
    expect(dt(row.get("ts"))).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
  });

  it("C2 numeric arithmetic: JS numbers, store xsd:integer / xsd:decimal, aggregates, casts", async () => {
    expect(await bindX("?o - 1")).toEqual(["6", "8"]);
    expect(await bindX("?n + 1", B2)).toEqual(["10", "8"]);
    expect(await bindX("?d * 2", B2)).toEqual(["5", "5"]);
    expect(await bindX("?o / 2")).toEqual(["3.5", "4.5"]);
    expect(await bindX("xsd:integer(STR(?n)) + 1", B2)).toEqual(["10", "8"]);
    expect(await col(`SELECT ((COUNT(*) * 2) AS ?x) WHERE ${W}`, "x")).toEqual(["4"]);
    expect(await col(`SELECT ?s (SUM(?o) AS ?x) WHERE ${W} GROUP BY ?s HAVING (SUM(?o) * 1 > 8)`, "x")).toEqual(["9"]);
    expect(await col(`SELECT ?s (SUM(?o * 2) AS ?x) WHERE ${W} GROUP BY ?s`, "x")).toEqual(["14", "18"]);
  });

  it("C3 date / time / duration arithmetic of typed operands is untouched", async () => {
    expect(await bindX(`"2026-11-10"^^xsd:date - "2026-11-01"^^xsd:date`)).toEqual(["P9D", "P9D"]);
    expect(await bindX(`"PT1H"^^xsd:dayTimeDuration * ?n`, B2)).toEqual(["PT7H", "PT9H"]);
    expect(await bindX(`"PT2H"^^xsd:dayTimeDuration / 2`)).toEqual(["PT1H", "PT1H"]);
    expect((await bindX(`?ts + "PT1H"^^xsd:dayTimeDuration`, B2)).every((v) => v !== "UNBOUND")).toBe(true);
  });

  it("C4 errors stay errors: text variable, boolean, unbound operand, division by zero", async () => {
    expect(await bindX("0 - ?l")).toEqual(UNBOUND2);
    expect(await bindX("?o + true")).toEqual(UNBOUND2);
    expect(await bindX("?zzz + 1")).toEqual(UNBOUND2);
    expect(await bindX("?o / 0")).toEqual(UNBOUND2);
  });

  // ------------------------------------------------------------ strictness
  it("A1 a text constant is not a number: BIND leaves ?x unbound, FILTER drops the row", async () => {
    expect(await bindX(`0 - "7"`)).toEqual(UNBOUND2);
    expect(await bindX(`0 + "7"`)).toEqual(UNBOUND2);
    expect(await bindX(`?o * "2"`)).toEqual(UNBOUND2);
    expect(await bindX(`"7" / 1`)).toEqual(UNBOUND2);
    expect(await select(`SELECT ?l WHERE { ${B} FILTER(0 - "7" < 0) }`)).toHaveLength(0);
  });

  it("A2 text whose NUMERIC PREFIX parseFloat would take: 0 - \"7abc\" is an error", async () => {
    expect(await bindX(`0 - "7abc"`)).toEqual(UNBOUND2);
    expect(await bindX(`"12 apples" + 0`)).toEqual(UNBOUND2);
  });

  it("A3 a date / dateTime / time operand with a number is an error, not its year", async () => {
    expect(await bindX(`0 - "2026-11-10"^^xsd:date`)).toEqual(UNBOUND2);
    expect(await bindX(`?o + "2026-11-10T10:00:00"^^xsd:dateTime`)).toEqual(UNBOUND2);
    expect(await bindX(`"10:00:00"^^xsd:time + 1`)).toEqual(UNBOUND2);
  });

  it("A4 typed literals of a non-numeric datatype: xsd:string, language-tagged, unknown, boolean", async () => {
    expect(await bindX(`"7"^^xsd:string + 1`)).toEqual(UNBOUND2);
    expect(await bindX(`"7"@en + 1`)).toEqual(UNBOUND2);
    expect(await bindX(`0 - "7"^^<urn:x:dt>`)).toEqual(UNBOUND2);
    expect(await bindX(`"1"^^xsd:boolean + 1`)).toEqual(UNBOUND2);
  });

  it("A5 store values: a plain literal \"7\", an xsd:dateTime, MAX of timestamps, STR(?o)", async () => {
    expect(await bindX("?t + 1", B2)).toEqual(UNBOUND2);
    expect(await bindX("?ts - 0", B2)).toEqual(UNBOUND2);
    expect(await bindX(`?n + "1"`, B2)).toEqual(UNBOUND2);
    expect(await bindX("STR(?o) + 1")).toEqual(UNBOUND2);
    expect(await col(`SELECT ((MAX(?ts) - 0) AS ?x) WHERE ${W2}`, "x")).toEqual(["UNBOUND"]);
    expect(await select(`SELECT ?l WHERE { ${B2} FILTER(?t - 7 = 0) }`)).toHaveLength(0);
  });

  it("A6 the error reaches its consumer: COALESCE moves on, ASK / HAVING / IF see no value", async () => {
    expect(await bindX(`COALESCE(0 - "7", 5)`)).toEqual(["5", "5"]);
    expect(await bindX(`COALESCE(?t + 1, ?n + 1)`, B2)).toEqual(["10", "8"]);
    expect(await ask(`ASK { ${B} FILTER(?o - "5" > 0) }`)).toBe(false);
    expect(await select(`SELECT (COUNT(*) AS ?x) WHERE ${W} HAVING (COUNT(*) + "1" > 0)`)).toHaveLength(0);
    expect(await bindX(`IF(0 - "7" < 0, 1, 2)`)).toEqual(UNBOUND2);
  });

  it("A7 a duration times text is an error on both sides of the operator", async () => {
    expect(await bindX(`"PT1H"^^xsd:dayTimeDuration * "2"`)).toEqual(UNBOUND2);
    expect(await bindX(`"2" * "PT1H"^^xsd:dayTimeDuration`)).toEqual(UNBOUND2);
    expect(await bindX(`"PT2H"^^xsd:dayTimeDuration / "2"`)).toEqual(UNBOUND2);
  });

  // ------------------------------------------------------------ numbers the engine carries as text
  it("A8 numeric constants the translator leaves as text stay numbers: xsd:double, float, derived integers", async () => {
    expect(await bindX("?o + 1.5e0")).toEqual(["10.5", "8.5"]);
    expect(await bindX(`?o + "2.5"^^xsd:float`)).toEqual(["11.5", "9.5"]);
    expect(await bindX(`?o + "3"^^xsd:int`)).toEqual(["10", "12"]);
    expect(await bindX(`?o + "4"^^xsd:nonNegativeInteger`)).toEqual(["11", "13"]);
    expect(await bindX(`?o - "5"^^xsd:unsignedByte`)).toEqual(["2", "4"]);
    expect(await col(`SELECT (COUNT(*) AS ?x) WHERE ${W} HAVING (COUNT(*) * "2"^^xsd:long > 3)`, "x")).toEqual(["2"]);
  });

  it("A9 a store number substituted into the expression stays a number: EXISTS and bind join", async () => {
    expect(await col(`SELECT ?l WHERE { ${B2} FILTER EXISTS { ?s ems:Effort_votes ?m FILTER(?m - ?n = 0) } }`, "l")).toEqual(BOTH);
    expect(await col(`SELECT ?l WHERE { { ${B2} } { ?s ems:Effort_votes ?m FILTER(?m - ?n = 0) } }`, "l")).toEqual(BOTH);
    expect(await col(`SELECT ?x WHERE { { ${B2} } { ?s ems:Effort_votes ?m BIND(?m + ?n AS ?x) } }`, "x")).toEqual(["14", "18"]);
    expect(await col(`SELECT ?l WHERE { ${B2} FILTER NOT EXISTS { ?s ems:Effort_weight ?w FILTER(?w * 2 - ?d = 2.5) } }`, "l")).toEqual([]);
  });

  // ------------------------------------------------------------ the same, LEFT operand
  it("A11 numeric constants carried as text stay numbers as the LEFT operand too", async () => {
    expect(await bindX("1.5e0 + ?o")).toEqual(["10.5", "8.5"]);
    expect(await bindX(`"2.5"^^xsd:float + ?o`)).toEqual(["11.5", "9.5"]);
    expect(await bindX(`"3"^^xsd:int + ?o`)).toEqual(["10", "12"]);
    expect(await bindX(`"5"^^xsd:unsignedByte - ?o`)).toEqual(["-2", "-4"]);
    expect(await bindX(`1.5e0 * "PT1H"^^xsd:dayTimeDuration`)).toEqual(["PT1H30M", "PT1H30M"]);
    expect(await col(`SELECT (SUM(1.5e0 * ?o) AS ?x) WHERE ${W}`, "x")).toEqual(["24"]);
    expect(await col(`SELECT (COUNT(*) AS ?x) WHERE ${W} HAVING ("2"^^xsd:long * COUNT(*) > 3)`, "x")).toEqual(["2"]);
  });

  it("A12 a store number substituted as the LEFT operand stays a number: EXISTS, NOT EXISTS, bind join", async () => {
    expect(await col(`SELECT ?l WHERE { ${B2} FILTER EXISTS { ?s ems:Effort_votes ?m FILTER(?n - ?m = 0) } }`, "l")).toEqual(BOTH);
    expect(await col(`SELECT ?l WHERE { ${B2} FILTER NOT EXISTS { ?s ems:Effort_weight ?w FILTER(?d - ?w * 2 = -2.5) } }`, "l")).toEqual([]);
    expect(await col(`SELECT ?x WHERE { { ${B2} } { ?s ems:Effort_votes ?m BIND(?n + ?m AS ?x) } }`, "x")).toEqual(["14", "18"]);
  });

  // ------------------------------------------------------------ a numeric datatype, an unreadable form
  it("A13 a numeric-typed constant parseFloat cannot read is a type error, not NaN", async () => {
    expect(await bindX(`"abc"^^xsd:double + 1`)).toEqual(UNBOUND2);
    expect(await select(`SELECT ?l WHERE { ${B} FILTER("abc"^^xsd:float + 1 != 0) }`)).toHaveLength(0);
    expect(await bindX(`COALESCE("x"^^xsd:int * 2, 5)`)).toEqual(["5", "5"]);
  });

  it("A14 a VALUES-bound numeric literal parseFloat cannot read is a type error; a readable one counts", async () => {
    expect(await col(`SELECT ?x WHERE { VALUES ?v { "abc"^^xsd:double } BIND(?v + 1 AS ?x) }`, "x")).toEqual(["UNBOUND"]);
    expect(await col(`SELECT ?x WHERE { VALUES ?v { "2.5"^^xsd:double } BIND(?v + 1 AS ?x) }`, "x")).toEqual(["3.5"]);
  });

  // ------------------------------------------------------------ into an aggregate
  it("A15 the error reaches an aggregate as an error: COUNT skips it, MIN has no value", async () => {
    expect(await col(`SELECT (COUNT(?t + 0) AS ?x) WHERE ${W2}`, "x")).toEqual(["0"]);
    expect(await col(`SELECT (MIN(?t + 0) AS ?x) WHERE ${W2}`, "x")).toEqual(["UNBOUND"]);
    expect(await col(`SELECT (COUNT(?n + 0) AS ?x) WHERE ${W2}`, "x")).toEqual(["2"]);
  });

  // ------------------------------------------------------------ operand forms a lenient implementation misses (review of the spec)
  it("A16 a text constant reaching arithmetic THROUGH A VARIABLE is an error: BIND, subquery, COALESCE, IF", async () => {
    expect(await col(`SELECT ?x WHERE { ${B} BIND("7" AS ?k) BIND(0 - ?k AS ?x) }`, "x")).toEqual(UNBOUND2);
    expect(await col(`SELECT ?x WHERE { ${B} BIND("7"^^xsd:string AS ?k) BIND(?k + 1 AS ?x) }`, "x")).toEqual(UNBOUND2);
    expect(
      await col(`SELECT ?x WHERE { ${B} { SELECT ?s ("7" AS ?k) WHERE { ?s exo:Asset_label ?l2 } } BIND(0 - ?k AS ?x) }`, "x"),
    ).toEqual(UNBOUND2);
    expect(await bindX(`COALESCE(?zzz, "7") + 1`)).toEqual(UNBOUND2);
    expect(await bindX(`1 + IF(true, "7", 0)`)).toEqual(UNBOUND2);
  });

  it("A17 a Literal of a NON-numeric datatype from VALUES or GROUP_CONCAT is an error on either side", async () => {
    for (const lit of [`"7"^^xsd:string`, `"7"`, `"2026"^^xsd:gYear`, `"7"^^<urn:x:dt>`]) {
      expect(await col(`SELECT ?x WHERE { VALUES ?v { ${lit} } BIND(0 - ?v AS ?x) }`, "x")).toEqual(["UNBOUND"]);
      expect(await col(`SELECT ?x WHERE { VALUES ?v { ${lit} } BIND(?v + 1 AS ?x) }`, "x")).toEqual(["UNBOUND"]);
    }
    expect(await col(`SELECT ?s ((GROUP_CONCAT(?o) + 1) AS ?x) WHERE { ${B} } GROUP BY ?s`, "x")).toEqual(UNBOUND2);
    expect(await col(`SELECT ?s ((1 - GROUP_CONCAT(?o)) AS ?x) WHERE { ${B} } GROUP BY ?s`, "x")).toEqual(UNBOUND2);
  });

  it("A18 a duration times / by a non-numeric LITERAL — store text, dateTime, date — is an error on both sides", async () => {
    for (const e of [
      `"PT1H"^^xsd:dayTimeDuration * ?t`,
      `?t * "PT1H"^^xsd:dayTimeDuration`,
      `"PT1H"^^xsd:dayTimeDuration * ?ts`,
      `?ts * "PT1H"^^xsd:dayTimeDuration`,
      `"PT1H"^^xsd:dayTimeDuration / ?t`,
      `"PT1H"^^xsd:dayTimeDuration / ?ts`,
      `"PT1H"^^xsd:dayTimeDuration * "2026-11-10"^^xsd:date`,
      `"2026-11-10"^^xsd:date * "PT1H"^^xsd:dayTimeDuration`,
    ]) {
      expect(await bindX(e, B2)).toEqual(UNBOUND2);
    }
  });

  // Every datatype BuiltInFunctions.isNumeric accepts — a shorter list of its own would pass A8 / A11.
  const NUMERIC_TYPES = [
    "integer", "decimal", "float", "double", "nonPositiveInteger", "negativeInteger", "long", "int",
    "short", "byte", "nonNegativeInteger", "unsignedLong", "unsignedInt", "unsignedShort", "unsignedByte",
    "positiveInteger",
  ];
  const lexical = (t: string) => (t === "negativeInteger" || t === "nonPositiveInteger" ? "-5" : "5");
  const sorted = (xs: number[]) => xs.map(String).sort();

  it("A19 a numeric CONSTANT of each of the 16 numeric datatypes counts as a number, on either side", async () => {
    for (const t of NUMERIC_TYPES) {
      const v = Number(lexical(t));
      expect(await bindX(`?o + "${lexical(t)}"^^xsd:${t}`)).toEqual(sorted([7 + v, 9 + v]));
      expect(await bindX(`"${lexical(t)}"^^xsd:${t} - ?o`)).toEqual(sorted([v - 7, v - 9]));
    }
  });

  it("A21 a VALUES-bound literal of each of the 16 numeric datatypes counts as a number, on either side", async () => {
    for (const t of NUMERIC_TYPES) {
      const v = Number(lexical(t));
      const row = (e: string) => col(`SELECT ?x WHERE { VALUES ?v { "${lexical(t)}"^^xsd:${t} } BIND(${e} AS ?x) }`, "x");
      expect(await row("?v + 1")).toEqual([String(v + 1)]);
      expect(await row("1 - ?v")).toEqual([String(1 - v)]);
    }
  });

  it("A20 a constant of a NON-numeric datatype is not rebuilt as a typed literal: a #date-like type does not subtract as a date", async () => {
    expect(await bindX(`"2026-11-10"^^<urn:x:dt#date> - "2026-11-01"^^<urn:x:dt#date>`)).toEqual(UNBOUND2);
    expect(await bindX(`"2026-11-10"^^xsd:dateTimeStamp - "2026-11-01"^^xsd:dateTimeStamp`)).toEqual(UNBOUND2);
    expect(await bindX(`"2026-11-10"^^xsd:dateTimeStamp + "P1D"^^xsd:dayTimeDuration`)).toEqual(UNBOUND2);
  });

  // ------------------------------------------------------------ paths
  it.each(Object.keys(SELECT_PATHS).map((k, i) => [`A10${"abc"[i]}`, k]))(
    "%s path %s: a text operand errors, a numeric one counts",
    async (_axis, path) => {
      const run = SELECT_PATHS[path];
      expect(await col(`SELECT ?l WHERE { ${B} FILTER(0 - "7" < 0) }`, "l", run)).toEqual([]);
      expect(await col(`SELECT ?x WHERE { ${B} BIND(0 - "2026-11-10"^^xsd:date AS ?x) }`, "x", run)).toEqual(UNBOUND2);
      expect(await col(`SELECT ?x WHERE { ${B2} BIND(?n + 1.5e0 AS ?x) }`, "x", run)).toEqual(["10.5", "8.5"]);
      expect(await col(`SELECT ?x WHERE { ${B2} BIND(1.5e0 + ?n AS ?x) }`, "x", run)).toEqual(["10.5", "8.5"]);
      expect(await col(`SELECT ?l WHERE { { ${B2} } { ?s ems:Effort_votes ?m FILTER(?m - ?n = 0) } }`, "l", run)).toEqual(BOTH);
      expect(await col(`SELECT ?l WHERE { { ${B2} } { ?s ems:Effort_votes ?m FILTER(?n - ?m = 0) } }`, "l", run)).toEqual(BOTH);
    },
  );

  it("A10d path precondition (inline sparqlAsk, JSON round-trip): a text operand does not show the button", async () => {
    const pre = (sparql: string) =>
      new PreconditionEvaluator(store).evaluate(
        { id: "p-02355814", label: "probe", sparqlAsk: q(sparql) },
        "obsidian://vault/target.md",
      );
    expect(await pre(`ASK { ${B} FILTER(?o - "5" > 0) }`)).toBe(false);
    expect(await pre(`ASK { ${B} FILTER(?o - 8 > 0) }`)).toBe(true);
    expect(await pre(`ASK { ${B2} FILTER(?n + "3"^^xsd:int = 12) }`)).toBe(true);
    expect(await pre(`ASK { ${B2} FILTER("3"^^xsd:int + ?n = 12) }`)).toBe(true);
  });
});
