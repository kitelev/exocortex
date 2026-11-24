/**
 * Production-shape integration test: SPARQL unary minus and unary plus (`-A`,
 * `+A`; SPARQL 1.1 §17.3 op:numeric-unary-minus / -plus) are evaluated in every
 * expression position and on every query path (vault-exodev ems__Bug 151b98a1).
 *
 * ## The defect
 *
 * sparqljs parses `-?o` / `-(?o)` as `{ operator: "UMINUS", args: [?o] }` and
 * `+?o` as `{ operator: "UPLUS", args: [?o] }`. Neither operator table knew them
 * — `ExpressionTranslator.translateOperationExpression` (FILTER, BIND, ORDER BY,
 * function arguments) and `AggregateTranslator.transformExpressionWithAggregateVars`
 * (HAVING, SELECT expressions) — so both fell through to a call of a function
 * named `UMINUS` / `UPLUS`, which the evaluator does not have: FILTER(-?o < 0)
 * dropped every solution, BIND / projection left the variable unbound, HAVING
 * rejected every group — silently, rc 0.
 *
 * The fix translates `-A` / `+A` as `0 - A` / `0 + A` through ONE helper
 * (`unaryToArithmetic`) used by BOTH tables, so the evaluator, the SERVICE text
 * generator, the serializer and every expression walker handle it with the
 * existing binary arithmetic, and `-A` answers exactly what `0 - A` answers.
 *
 * ## Not asserted here, on purpose
 *
 * - ORDER BY over an EXPRESSION does not sort at all (ems__Bug f7105304:
 *   `getExpressionValue` returns undefined for a non-variable key) — for `-?o`
 *   and `0 - ?o` alike. A9 locks the form that does sort (key BIND-ed, ORDER BY
 *   the variable) and that `ORDER BY (-?o)` keeps the order `ORDER BY (0 - ?o)`
 *   keeps, so fixing f7105304 fixes both.
 * - How a NON-numeric operand is coerced (`0 - "7"` = -7, `0 - xsd:date` = -2026,
 *   where SPARQL 1.1 says type error) is the binary arithmetic's, not this fix's
 *   (ems__Bug 02355814). A13 locks PARITY (`-A` ≡ `0 - A` on such operands), not
 *   the values — it stays green when the shared coercion is made strict, and turns
 *   red only if strictness is added to ONE of the two forms.
 * - The optimizer's filter-variable walk and the async (EXISTS) evaluator do not
 *   descend into arithmetic — binary or unary alike (ems__Bug a8012c4f): a FILTER
 *   whose variable appears only under the sign and is bound by ANOTHER join operand
 *   is pushed where that variable is unbound. The path axes keep their variables
 *   bound by a BIND in the same group, so the filter stays above the join.
 *
 * Revert-verify: `unary-arithmetic-151b98a1-expression-translator.spec.json` and
 * `unary-arithmetic-151b98a1-aggregate-translator.spec.json` remove one guarantee
 * per mutant and name the axes that must turn red; both also run the compliance
 * test "should support unary negation" (built-in-functions.test.ts, un-skipped by
 * this fix). Axes C1–C4 are controls, green on the pre-fix engine by construction.
 * Mutants W1–W4 are plausible WRONG implementations that answer every numeric axis
 * right (nested sign folded away, sign over a subtraction swapping its operands,
 * `+` over arithmetic or over a non-aggregate as identity); A18–A24 tell them apart.
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
import type {
  AlgebraOperation,
  AskOperation,
} from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { evaluateWithExoEval } from "../../../src/exoql/evaluateWithExoEval";
import { ExoQL } from "../../../src/exoql";
import { Triple } from "../../../src/domain/models/rdf/Triple";

let seq = 0;
const uid = () =>
  `151b98a1-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (u: string, fm: IFrontmatter): FixtureNote => ({
  uid: u,
  frontmatter: { exo__Asset_uid: u, ...fm },
});

// ---------------------------------------------------------------- population
// Two bugs, labels of length 7 and 9: ?o = STRLEN(?l) gives two DIFFERENT
// positive numbers, so a sign, an order and a per-group value are all visible.
const BUG_CLASS = uid();
const NOTES: FixtureNote[] = [
  note(BUG_CLASS, { exo__Asset_label: "ems__Bug" }),
  note(uid(), { exo__Asset_label: "Asset A", exo__Instance_class: `[[${BUG_CLASS}]]` }),
  note(uid(), { exo__Asset_label: "Asset Bbb", exo__Instance_class: `[[${BUG_CLASS}]]` }),
  // Unrelated notes: an engine that ignores the class pattern is visibly wrong.
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

/** Body of W: two solutions, ?o = 7 ("Asset A") and 9 ("Asset Bbb"). */
const B = `?s exo:Instance_class ems:Bug . ?s exo:Asset_label ?l . BIND(STRLEN(?l) AS ?o)`;
const W = `{ ${B} }`;
/** No solution. */
const W0 = `{ ?s exo:Instance_class ems:Bug . ?s exo:Asset_label "No such bug" . }`;

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

/** The engine path: parse → translate → executeAll. */
const select = async (sparql: string): Promise<Rows> =>
  (await new ExoQLQueryExecutor(store).executeAll(translate(sparql))) as unknown as Rows;
const ask = (sparql: string): Promise<boolean> =>
  new ExoQLQueryExecutor(store).executeAsk(translate(sparql) as AskOperation);

/** Values of one column, sorted (for unordered comparisons). */
const col = async (sparql: string, name: string, run = select): Promise<string[]> =>
  (await run(sparql)).map((r) => val(r.get(name))).sort();
/** Values of one column in result order. */
const colOrdered = async (sparql: string, name: string): Promise<string[]> =>
  (await select(sparql)).map((r) => val(r.get(name)));

/** The plugin keeps ONE translator and ONE optimizer for its lifetime. */
const pluginTranslator = new ExoQLAlgebraTranslator();
const pluginOptimizer = new AlgebraOptimizer();

/**
 * The other query paths, each called the way production calls it. Key = axis
 * suffix (A11a…A11d): the driver names the path that went red.
 */
const SELECT_PATHS: Record<string, (sparql: string) => Promise<Rows>> = {
  // run-query — evaluateWithExoEval
  runQuery: async (sparql) => {
    const r = await evaluateWithExoEval(q(sparql), { store });
    if (r.kind !== "select") throw new Error(`run-query returned ${r.kind}`);
    return r.rows as unknown as Rows;
  },
  // public ExoQL API
  exoql: async (sparql) => (await ExoQL.query(q(sparql), store)) as unknown as Rows,
  // plugin SPARQLQueryService — the SAME translator and optimizer every call
  plugin: async (sparql) => {
    const algebra = pluginOptimizer.optimize(
      pluginTranslator.translate(new SPARQLParser().parse(q(sparql))),
    );
    return (await new ExoQLQueryExecutor(store).executeAll(algebra)) as unknown as Rows;
  },
};

/** Algebra as JSON: a fresh translator per call, so generated aggregate names match. */
const algebraOf = (sparql: string): string => JSON.stringify(translate(sparql));

/** Expression E in the FIRST operator table (BIND) and in the SECOND one (SELECT expression). */
const bindE = (e: string) => `SELECT ?n WHERE { ${B} BIND(${e} AS ?n) }`;
const selE = (e: string) => `SELECT (${e} AS ?n) WHERE ${W}`;
/** Operands on which SPARQL 1.1 arithmetic is a type error (A13, A18, A19, A24). */
const NON_NUMERIC = [`"7"`, `"2026-11-10"^^xsd:date`, `"P1D"^^xsd:dayTimeDuration`, `?l`, `true`];
/** Composite arithmetic whose result is not a number (A20–A23). */
const COMPOSITE = [
  `("2026-11-10"^^xsd:date - "2026-11-01"^^xsd:date)`,
  `("2026-11-10"^^xsd:date + "P1D"^^xsd:dayTimeDuration)`,
  `("P2D"^^xsd:dayTimeDuration - "P1D"^^xsd:dayTimeDuration)`,
];

describe("SPARQL unary minus / plus (ems__Bug 151b98a1)", () => {
  // ------------------------------------------------------------ controls
  it("C1 population: W has 2 solutions with ?o = 7 and 9, W0 none", async () => {
    expect(await col(`SELECT ?l WHERE ${W}`, "l")).toEqual(["Asset A", "Asset Bbb"]);
    expect(await col(`SELECT ?o WHERE ${W}`, "o")).toEqual(["7", "9"]);
    expect(await select(`SELECT ?l WHERE ${W0}`)).toHaveLength(0);
  });

  it("C2 binary arithmetic controls: 0 - ?o works in FILTER, BIND, projection, HAVING", async () => {
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(0 - ?o < 0) }`, "l")).toEqual(["Asset A", "Asset Bbb"]);
    expect(await col(`SELECT ?n WHERE { ${B} BIND(0 - ?o AS ?n) }`, "n")).toEqual(["-7", "-9"]);
    expect(await col(`SELECT ((0 - ?o) AS ?n) WHERE ${W}`, "n")).toEqual(["-7", "-9"]);
    expect(await col(`SELECT ((0 - COUNT(*)) AS ?n) WHERE ${W}`, "n")).toEqual(["-2"]);
    expect(await ask(`ASK ${W0} HAVING (0 - COUNT(*) = 0)`)).toBe(true);
  });

  it("C3 a negative numeric LITERAL and unary NOT are not unary arithmetic", async () => {
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(?o > -5) }`, "l")).toEqual(["Asset A", "Asset Bbb"]);
    expect(await col(`SELECT (-5 AS ?n) WHERE ${W}`, "n")).toEqual(["-5", "-5"]);
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(!(?o < 0)) }`, "l")).toEqual(["Asset A", "Asset Bbb"]);
    expect(algebraOf(`SELECT ?l WHERE { ${B} FILTER(?o > -5) }`)).not.toContain('"arithmetic"');
  });

  it("C4 errors stay errors: non-numeric or unbound operand drops FILTER, leaves BIND unbound", async () => {
    expect(await select(`SELECT ?l WHERE { ${B} FILTER(-?l < 0) }`)).toHaveLength(0);
    expect(await col(`SELECT ?n WHERE { ${B} BIND(-?l AS ?n) }`, "n")).toEqual(["UNBOUND", "UNBOUND"]);
    expect(await col(`SELECT ?n WHERE { ${B} BIND(+?l AS ?n) }`, "n")).toEqual(["UNBOUND", "UNBOUND"]);
    expect(await col(`SELECT ?n WHERE { ${B} BIND(-?zzz AS ?n) }`, "n")).toEqual(["UNBOUND", "UNBOUND"]);
  });

  // ------------------------------------------------------------ unary minus
  it("A1 FILTER: -?o and -(?o) are negative, -?o = -7 picks one solution", async () => {
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(-?o < 0) }`, "l")).toEqual(["Asset A", "Asset Bbb"]);
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(-(?o) < 0) }`, "l")).toEqual(["Asset A", "Asset Bbb"]);
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(-?o = -7) }`, "l")).toEqual(["Asset A"]);
  });

  it("A2 BIND and nesting: -?o, -(-?o) = ?o, ?o + -?o = 0, -(?o / 2)", async () => {
    expect(await col(`SELECT ?n WHERE { ${B} BIND(-?o AS ?n) }`, "n")).toEqual(["-7", "-9"]);
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(-(-?o) = ?o) }`, "l")).toEqual(["Asset A", "Asset Bbb"]);
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(?o + -?o = 0) }`, "l")).toEqual(["Asset A", "Asset Bbb"]);
    expect(await col(`SELECT ?n WHERE { ${B} BIND(-(?o / 2) AS ?n) }`, "n")).toEqual(["-3.5", "-4.5"]);
  });

  it("A3 as an argument and over a function: ABS(-?o), -?o IN (-7), -STRLEN(?l)", async () => {
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(ABS(-?o) = ?o) }`, "l")).toEqual(["Asset A", "Asset Bbb"]);
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(-?o IN (-7)) }`, "l")).toEqual(["Asset A"]);
    expect(await col(`SELECT ?n WHERE { ${B} BIND(-STRLEN(?l) AS ?n) }`, "n")).toEqual(["-7", "-9"]);
  });

  it("A4 SELECT expression without an aggregate: (-?o AS ?n), (-STRLEN(?l) AS ?n)", async () => {
    expect(await col(`SELECT (-?o AS ?n) WHERE ${W}`, "n")).toEqual(["-7", "-9"]);
    expect(await col(`SELECT (-STRLEN(?l) AS ?n) WHERE ${W}`, "n")).toEqual(["-7", "-9"]);
  });

  it("A5 HAVING: -COUNT, implicit group over an empty WHERE, a function over -SUM", async () => {
    expect(await col(`SELECT ?s (COUNT(?l) AS ?c) WHERE ${W} GROUP BY ?s HAVING (-COUNT(?l) < 0)`, "c")).toEqual(["1", "1"]);
    expect(await ask(`ASK ${W0} HAVING (-COUNT(*) = 0)`)).toBe(true);
    expect(await col(`SELECT ?s (SUM(?o) AS ?t) WHERE ${W} GROUP BY ?s HAVING (ABS(-SUM(?o)) > 8)`, "t")).toEqual(["9"]);
  });

  it("A6 SELECT expression over an aggregate: (-COUNT(*)), (-SUM(?o)) per group", async () => {
    expect(await col(`SELECT (-COUNT(*) AS ?n) WHERE ${W}`, "n")).toEqual(["-2"]);
    expect(await col(`SELECT ?s (-SUM(?o) AS ?n) WHERE ${W} GROUP BY ?s`, "n")).toEqual(["-7", "-9"]);
  });

  // ------------------------------------------------------------ unary plus
  it("A7 unary plus in FILTER, BIND, projection, aggregate projection and HAVING", async () => {
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(+?o > 0) }`, "l")).toEqual(["Asset A", "Asset Bbb"]);
    expect(await col(`SELECT ?n WHERE { ${B} BIND(+?o AS ?n) }`, "n")).toEqual(["7", "9"]);
    expect(await col(`SELECT (+?o AS ?n) WHERE ${W}`, "n")).toEqual(["7", "9"]);
    expect(await col(`SELECT (+COUNT(*) AS ?n) WHERE ${W}`, "n")).toEqual(["2"]);
    expect(await col(`SELECT ?s (COUNT(?l) AS ?c) WHERE ${W} GROUP BY ?s HAVING (+COUNT(?l) > 0)`, "c")).toEqual(["1", "1"]);
  });

  // ------------------------------------------------------------ invariants
  it("A8 algebra: -A is translated exactly as (0 - A), +A as (0 + A) — in both operator tables", async () => {
    const pairs: Array<[string, string]> = [
      [`SELECT ?l WHERE { ${B} FILTER(-?o < 0) }`, `SELECT ?l WHERE { ${B} FILTER((0 - ?o) < 0) }`],
      [`SELECT ?n WHERE { ${B} BIND(-(?o / 2) AS ?n) }`, `SELECT ?n WHERE { ${B} BIND((0 - (?o / 2)) AS ?n) }`],
      [`SELECT (-?o AS ?n) WHERE ${W}`, `SELECT ((0 - ?o) AS ?n) WHERE ${W}`],
      [`SELECT (-COUNT(*) AS ?n) WHERE ${W}`, `SELECT ((0 - COUNT(*)) AS ?n) WHERE ${W}`],
      [`ASK ${W0} HAVING (-COUNT(*) = 0)`, `ASK ${W0} HAVING ((0 - COUNT(*)) = 0)`],
      [`SELECT ?l WHERE ${W} ORDER BY (-?o)`, `SELECT ?l WHERE ${W} ORDER BY (0 - ?o)`],
      [`SELECT ?l WHERE { ${B} FILTER(+?o > 0) }`, `SELECT ?l WHERE { ${B} FILTER((0 + ?o) > 0) }`],
      [`SELECT (+COUNT(*) AS ?n) WHERE ${W}`, `SELECT ((0 + COUNT(*)) AS ?n) WHERE ${W}`],
    ];
    for (const [unary, binary] of pairs) expect(algebraOf(unary)).toBe(algebraOf(binary));
    expect(algebraOf(`SELECT ?l WHERE { ${B} FILTER(-?o < 0) }`)).not.toMatch(/UMINUS|UPLUS/);
  });

  it("A9 ORDER BY: a key BIND-ed with -x / +x is computed and takes part in sorting; ORDER BY (-?o) keeps the order of ORDER BY (0 - ?o)", async () => {
    // keys: Asset A = 1 / -1, Asset Bbb = -1 / 1 — different from the input order either way.
    // ⛔ Chosen so that string and numeric order AGREE: computed numbers sort as strings
    // (ems__Bug f7105304), so e.g. ORDER BY DESC(?k) over -7 / -9 is wrong after this fix
    // as it is for 0 - ?o. This axis locks "the key is computed", not "computed keys sort right".
    expect(await colOrdered(`SELECT ?l WHERE { ${B} BIND(-(?o - 8) AS ?k) } ORDER BY ?k`, "l")).toEqual(["Asset Bbb", "Asset A"]);
    expect(await colOrdered(`SELECT ?l WHERE { ${B} BIND(+(?o - 8) AS ?k) } ORDER BY DESC(?k)`, "l")).toEqual(["Asset Bbb", "Asset A"]);
    expect(await colOrdered(`SELECT ?l WHERE ${W} ORDER BY (-?o)`, "l")).toEqual(
      await colOrdered(`SELECT ?l WHERE ${W} ORDER BY (0 - ?o)`, "l"),
    );
  });

  it("A15 a sign over a COMPOSITE expression holding an aggregate (HAVING / SELECT expression)", async () => {
    // A plausible wrong second table handles the sign only when its operand IS an
    // aggregate and hands everything else to the expression table — which does not
    // know the aggregate variables (independent review of the plan, W1).
    expect(await col(`SELECT ?s (-(SUM(?o) + 1) AS ?n) WHERE ${W} GROUP BY ?s`, "n")).toEqual(["-10", "-8"]);
    expect(await col(`SELECT (-(-COUNT(*)) AS ?n) WHERE ${W}`, "n")).toEqual(["2"]);
    expect(await col(`SELECT ?s (COUNT(?l) AS ?c) WHERE ${W} GROUP BY ?s HAVING (-(COUNT(?l) * 2) < -1)`, "c")).toEqual(["1", "1"]);
    expect(await ask(`ASK ${W} HAVING (-ABS(SUM(?o)) < -15)`)).toBe(true);
  });

  it("A16 a sign over a NEGATIVE numeric literal: -(-5) = 5, +(-5) = -5", async () => {
    // A plausible wrong fold of a literal operand concatenates the sign lexically
    // ("-" + "-5" → NaN) (independent review of the plan, W2).
    expect(await col(`SELECT ?n WHERE { ${B} BIND(-(-5) AS ?n) }`, "n")).toEqual(["5", "5"]);
    expect(await col(`SELECT ?n WHERE { ${B} BIND(+(-5) AS ?n) }`, "n")).toEqual(["-5", "-5"]);
    expect(await col(`SELECT ?l WHERE { ${B} FILTER(?o > -(-6)) }`, "l")).toEqual(["Asset A", "Asset Bbb"]);
  });

  it("A17 contexts: subquery projection, NOT EXISTS, COALESCE, IF, an aggregate over a sign, DISTINCT", async () => {
    expect(await col(`SELECT ?n WHERE { { SELECT (-?o AS ?n) WHERE ${W} } }`, "n")).toEqual(["-7", "-9"]);
    expect(await col(`SELECT ?l WHERE { ${B} FILTER NOT EXISTS { FILTER(-?o < -8) } }`, "l")).toEqual(["Asset A"]);
    expect(await col(`SELECT ?n WHERE { ${B} BIND(COALESCE(-?zzz, -?o) AS ?n) }`, "n")).toEqual(["-7", "-9"]);
    expect(await col(`SELECT ?n WHERE { ${B} BIND(IF(?o > 8, -?o, +?o) AS ?n) }`, "n")).toEqual(["-9", "7"]);
    expect(await col(`SELECT (SUM(-?o) AS ?t) WHERE ${W}`, "t")).toEqual(["-16"]);
    expect(await col(`SELECT DISTINCT (-STRLEN("ab") AS ?n) WHERE ${W}`, "n")).toEqual(["-2"]);
  });

  it("A14 -x is a VALUE, not an error: BOUND after BIND(-?o) and BIND(-COUNT(*))", async () => {
    // Splits "the sign is wrong" (A2/A6) from "nothing is computed at all": a
    // unary-as-identity implementation passes here and fails A2; the defect fails both.
    expect(await select(`SELECT ?n WHERE { ${B} BIND(-?o AS ?n) FILTER(BOUND(?n)) }`)).toHaveLength(2);
    expect(await select(`SELECT ?n WHERE { ${B} BIND(+?o AS ?n) FILTER(BOUND(?n)) }`)).toHaveLength(2);
  });

  // ------------------------------------------------------------ paths
  describe.each(Object.keys(SELECT_PATHS).map((p, i) => [String.fromCharCode(97 + i), p]))(
    "A11%s path %s",
    (suffix, path) => {
      const run = SELECT_PATHS[path];
      it(`A11${suffix} FILTER, BIND, projection, HAVING and aggregate projection with -x`, async () => {
        expect(await col(`SELECT ?l WHERE { ${B} FILTER(-?o < 0) }`, "l", run)).toEqual(["Asset A", "Asset Bbb"]);
        expect(await col(`SELECT ?n WHERE { ${B} BIND(-?o AS ?n) }`, "n", run)).toEqual(["-7", "-9"]);
        expect(await col(`SELECT (-?o AS ?n) WHERE ${W}`, "n", run)).toEqual(["-7", "-9"]);
        expect(await col(`SELECT ?s (COUNT(?l) AS ?c) WHERE ${W} GROUP BY ?s HAVING (-COUNT(?l) < 0)`, "c", run)).toEqual(["1", "1"]);
        expect(await col(`SELECT (+COUNT(*) AS ?n) WHERE ${W}`, "n", run)).toEqual(["2"]);
      });
    },
  );

  it("A11d path precondition (inline sparqlAsk, JSON round-trip): -x in FILTER and HAVING", async () => {
    const pre = (sparql: string) =>
      new PreconditionEvaluator(store).evaluate(
        { id: "p-151b98a1", label: "probe", sparqlAsk: q(sparql) },
        "obsidian://vault/target.md",
      );
    expect(await pre(`ASK { ${B} FILTER(-?o = -9) }`)).toBe(true);
    expect(await pre(`ASK { ${B} FILTER(-?o = 9) }`)).toBe(false);
    expect(await pre(`ASK ${W0} HAVING (-COUNT(*) = 0)`)).toBe(true);
  });

  it("A12 SERVICE text generator: the generated query has no UMINUS/UPLUS call and parses back", async () => {
    const op = translate(`SELECT ?l WHERE { ${B} FILTER(-?o < 0) BIND(+?o AS ?p) }`);
    const where = (op as { input?: AlgebraOperation }).input ?? op;
    const text = new SPARQLGenerator().generateSelect(where);
    expect(text).not.toMatch(/UMINUS|UPLUS/i);
    const reparsed = new ExoQLAlgebraTranslator().translate(new SPARQLParser().parse(`${PREFIX}\n${text}`));
    const rows = (await new ExoQLQueryExecutor(store).executeAll(reparsed)) as unknown as Rows;
    expect(rows.map((r) => val(r.get("p"))).sort()).toEqual(["7", "9"]);
  });

  it("A13 parity on non-numeric operands: -A answers what 0 - A answers (the coercion is the binary one)", async () => {
    for (const a of NON_NUMERIC) {
      expect(await col(bindE(`-${a}`), "n")).toEqual(await col(bindE(`(0 - ${a})`), "n"));
      expect(await col(bindE(`+${a}`), "n")).toEqual(await col(bindE(`(0 + ${a})`), "n"));
    }
  });

  // ------------------------------------------------------------ independent review of the spec
  // A13 and C4 judged only the FIRST table and only a single sign; A8 locks the algebra on
  // eight forms only. Seven plausible wrong implementations (spec mutants W1–W4, both tables)
  // answer the numeric axes right and differ from 0 ∓ A exactly where SPARQL 1.1 says
  // "type error": a nested sign, a sign over composite non-numeric arithmetic, the second table.
  it("A18 [first table] nested sign: -(-A) answers what 0 - (0 - A) answers on non-numeric A", async () => {
    for (const a of NON_NUMERIC) expect(await col(bindE(`-(-${a})`), "n")).toEqual(await col(bindE(`(0 - (0 - ${a}))`), "n"));
    expect(await col(bindE(`-(-?l)`), "n")).toEqual(["UNBOUND", "UNBOUND"]);
  });

  it("A19 [second table] nested sign: -(-A) answers what 0 - (0 - A) answers on non-numeric A", async () => {
    for (const a of NON_NUMERIC) expect(await col(selE(`-(-${a})`), "n")).toEqual(await col(selE(`(0 - (0 - ${a}))`), "n"));
    expect(await col(selE(`-(-?l)`), "n")).toEqual(["UNBOUND", "UNBOUND"]);
  });

  it("A20 [first table] minus over composite date/duration arithmetic: -(D) answers what 0 - D answers", async () => {
    for (const d of COMPOSITE) expect(await col(bindE(`-${d}`), "n")).toEqual(await col(bindE(`(0 - ${d})`), "n"));
  });

  it("A21 [first table] plus over composite date/duration arithmetic: +(D) answers what 0 + D answers", async () => {
    for (const d of COMPOSITE) expect(await col(bindE(`+${d}`), "n")).toEqual(await col(bindE(`(0 + ${d})`), "n"));
  });

  it("A22 [second table] minus over composite date/duration arithmetic: -(D) answers what 0 - D answers", async () => {
    for (const d of COMPOSITE) expect(await col(selE(`-${d}`), "n")).toEqual(await col(selE(`(0 - ${d})`), "n"));
  });

  it("A23 [second table] plus over composite date/duration arithmetic: +(D) answers what 0 + D answers", async () => {
    for (const d of COMPOSITE) expect(await col(selE(`+${d}`), "n")).toEqual(await col(selE(`(0 + ${d})`), "n"));
  });

  it("A24 [second table] A13 + C4: (-A)/(+A) answer what (0 -/+ A) answer on non-numeric A; +?l and +SAMPLE stay errors", async () => {
    for (const a of NON_NUMERIC) {
      expect(await col(selE(`-${a}`), "n")).toEqual(await col(selE(`(0 - ${a})`), "n"));
      expect(await col(selE(`+${a}`), "n")).toEqual(await col(selE(`(0 + ${a})`), "n"));
    }
    expect(await col(selE(`+?l`), "n")).toEqual(["UNBOUND", "UNBOUND"]);
    expect(await ask(`ASK ${W} HAVING (+SAMPLE(?l) = "Asset A")`)).toBe(false);
  });
});
