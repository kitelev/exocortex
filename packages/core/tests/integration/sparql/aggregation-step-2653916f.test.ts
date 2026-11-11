/**
 * Production-shape integration test: the aggregation step of SPARQL 1.1
 * (§18.2.4.1 grouping and aggregation, §18.2.4.2 HAVING) on every path that runs
 * a SELECT or an ASK (vault-exodev ems__Bug 2653916f).
 *
 * ## The defects (CLI 17.18.1)
 *
 * 1. GROUP BY over an EMPTY input answered one phantom row (unbound key, COUNT 0):
 *    `AggregateExecutor` built an empty group whenever no group existed. By SPARQL
 *    1.1 `Group(exprlist, P)` over an empty P has no group (w3c rdf-tests
 *    `agg-empty-group-count-1`); only the implicit `Group((1), P)` of an aggregate
 *    without GROUP BY is one group even then (`agg-empty-group-count-2`).
 * 2. HAVING without an aggregate and without GROUP BY built a group anyway, so the
 *    solutions collapsed into one empty row: `HAVING (?l = "x")` never matched and
 *    `HAVING (true)` over an empty input answered one row. By §18.2.4.1 the
 *    aggregate step is skipped then and HAVING is `Filter(E, P)` (§18.2.4.2).
 * 3. An aggregate in ORDER BY was refused ("Unsupported expression structure"):
 *    it must group the query level and read its group's value (§18.2.4.1 replaces
 *    it with aggi). ASK ignored it altogether.
 * 4. EXISTS in HAVING or in a SELECT expression was refused: the aggregate-aware
 *    operator table dropped its graph pattern, and HAVING was evaluated
 *    synchronously, where EXISTS cannot be.
 *
 * ## The paths under test
 *
 * The engine (`executeAll` / `executeAsk`), a button precondition
 * (`PreconditionEvaluator`, ASK), `run-query` (`evaluateWithExoEval`), the public
 * `ExoQL.query` / `ExoQL.ask`, and the plugin's `SPARQLQueryService` (one
 * translator and one optimizer reused across queries). The store is built by the
 * REAL `NoteToRDFConverter` over fixture notes.
 *
 * Revert-verify: the `aggregation-step-2653916f-*.spec.json` files (one per
 * subject) remove one guarantee per mutant and name the axes that must turn red.
 * C1–C3 are controls, green on the pre-fix engine by construction.
 *
 * Not asserted here: GROUP BY by an expression on a NON-empty input (38328fcc),
 * IN / an aggregate inside a function call when the level groups (2f27f300), and
 * ORDER BY by an expression that is not an aggregate, which does not sort
 * (f7105304) — those bugs own them.
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
import type { SolutionMapping } from "../../../src/infrastructure/sparql/SolutionMapping";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { evaluateWithExoEval } from "../../../src/exoql/evaluateWithExoEval";
import { ExoQL } from "../../../src/exoql";
import { Triple } from "../../../src/domain/models/rdf/Triple";

let seq = 0;
const uid = () =>
  `2653916f-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (u: string, fm: IFrontmatter): FixtureNote => ({
  uid: u,
  frontmatter: { exo__Asset_uid: u, ...fm },
});

// ---------------------------------------------------------------- population
// Two bugs. "Asset One" carries TWO aliases, "Asset Two" one — so over the alias
// pattern there are 3 solutions in 2 groups whose COUNT differs (2 and 1): an
// ORDER BY on the aggregate has an order to get right, and it is NOT the input
// order ("Asset One" comes first in the input, last in ascending count).
const BUG_CLASS = uid();
const NOTES: FixtureNote[] = [
  note(BUG_CLASS, { exo__Asset_label: "ems__Bug" }),
  note(uid(), {
    exo__Asset_label: "Asset One",
    exo__Instance_class: `[[${BUG_CLASS}]]`,
    aliases: ["Alpha one", "Alpha two"],
  }),
  note(uid(), {
    exo__Asset_label: "Asset Two",
    exo__Instance_class: `[[${BUG_CLASS}]]`,
    aliases: ["Beta one"],
  }),
  // Unrelated notes: an engine that ignores the class pattern is visibly wrong.
  ...Array.from({ length: 5 }, (_, i) =>
    note(uid(), { exo__Asset_label: `Noise ${i}`, aliases: [`Noise ${i}`] }),
  ),
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
PREFIX ems: <https://exocortex.my/ontology/ems#>`;
const q = (sparql: string) => `${PREFIX}\n${sparql}`;

/** Two solutions: one label per bug. */
const W = `{ ?s exo:Instance_class ems:Bug . ?s exo:Asset_label ?l . }`;
/** Three solutions, two groups by ?s ("Asset One" has two aliases). */
const WA = `{ ?s exo:Instance_class ems:Bug . ?s exo:Asset_aliases ?a . ?s exo:Asset_label ?l . }`;
/** No solution. */
const W0 = `{ ?s exo:Instance_class ems:Bug . ?s exo:Asset_label "No such bug" . }`;

const translate = (sparql: string): AlgebraOperation =>
  new ExoQLAlgebraTranslator().translate(new SPARQLParser().parse(q(sparql)));

/** The engine path: parse → translate → executeAsk / executeAll. */
const ask = (sparql: string): Promise<boolean> =>
  new ExoQLQueryExecutor(store).executeAsk(translate(sparql) as AskOperation);
const select = (sparql: string): Promise<SolutionMapping[]> =>
  new ExoQLQueryExecutor(store).executeAll(translate(sparql));

/** The value of `v` in a row, as text (`undefined` when unbound). */
const val = (row: SolutionMapping, v: string): string | undefined => {
  const t = row.get(v) as unknown;
  if (t === undefined || t === null) return undefined;
  if (typeof t === "object" && "value" in (t as object)) return String((t as { value: unknown }).value);
  return String(t);
};
/** Values of `v` in row order. */
const col = async (sparql: string, v: string): Promise<Array<string | undefined>> =>
  (await select(sparql)).map((r) => val(r, v));
/** Values of `v`, sorted (order not under test). */
const bag = async (sparql: string, v: string): Promise<Array<string | undefined>> =>
  (await col(sparql, v)).sort();

const nodeTypes = (op: unknown, acc: string[] = []): string[] => {
  if (op && typeof op === "object") {
    const t = (op as { type?: unknown }).type;
    if (typeof t === "string") acc.push(t);
    for (const v of Object.values(op as Record<string, unknown>)) nodeTypes(v, acc);
  }
  return acc;
};

/**
 * The plugin's `SPARQLQueryService` keeps ONE translator and ONE optimizer for its
 * lifetime: per-call state leaking between queries shows up on the plugin path.
 */
const pluginTranslator = new ExoQLAlgebraTranslator();
const pluginOptimizer = new AlgebraOptimizer();
const pluginAlgebra = (sparql: string) =>
  pluginOptimizer.optimize(pluginTranslator.translate(new SPARQLParser().parse(q(sparql))));

/** ASK paths other than the engine, each called the way production calls it. */
const ASK_PATHS: Record<string, (sparql: string) => Promise<boolean>> = {
  precondition: (sparql) =>
    new PreconditionEvaluator(store).evaluate(
      { id: "p-2653916f", label: "probe", sparqlAsk: q(sparql) },
      "obsidian://vault/target.md",
    ),
  runQuery: async (sparql) => {
    const r = await evaluateWithExoEval(q(sparql), { store });
    if (r.kind !== "ask") throw new Error(`run-query returned ${r.kind}`);
    return r.result;
  },
  exoql: (sparql) => ExoQL.ask(q(sparql), store),
  plugin: (sparql) =>
    new ExoQLQueryExecutor(store).executeAsk(pluginAlgebra(sparql) as AskOperation),
};
/** SELECT paths other than the engine. */
const SELECT_PATHS: Record<string, (sparql: string) => Promise<SolutionMapping[]>> = {
  runQuery: async (sparql) => {
    const r = await evaluateWithExoEval(q(sparql), { store });
    if (r.kind !== "select") throw new Error(`run-query returned ${r.kind}`);
    return r.rows;
  },
  exoql: (sparql) => ExoQL.query(q(sparql), store),
  plugin: (sparql) => new ExoQLQueryExecutor(store).executeAll(pluginAlgebra(sparql)),
};
const axes = (paths: Record<string, unknown>): Array<[string, string]> =>
  Object.keys(paths).map((p, i) => [String.fromCharCode(97 + i), p]);

const EX_ONE = `EXISTS { ?s exo:Asset_aliases "Alpha one" }`;

describe("Aggregation step (ems__Bug 2653916f)", () => {
  // ------------------------------------------------------------ controls
  it("C1 population: W has 2 solutions, WA 3 in 2 groups (counts 2 and 1), W0 none", async () => {
    expect(await bag(`SELECT ?l WHERE ${W}`, "l")).toEqual(["Asset One", "Asset Two"]);
    expect(await select(`SELECT ?a WHERE ${WA}`)).toHaveLength(3);
    expect(await bag(`SELECT ?s (COUNT(?a) AS ?n) WHERE ${WA} GROUP BY ?s`, "n")).toEqual(["1", "2"]);
    expect(await select(`SELECT ?l WHERE ${W0}`)).toHaveLength(0);
  });

  it("C2 the implicit group of an aggregate without GROUP BY is ONE row even over an empty input", async () => {
    expect(await col(`SELECT (COUNT(*) AS ?n) WHERE ${W0}`, "n")).toEqual(["0"]);
    expect(await col(`SELECT (SUM(?a) AS ?t) WHERE ${W0}`, "t")).toEqual(["0"]);
    expect(await ask(`ASK ${W0} HAVING (COUNT(*) = 0)`)).toBe(true);
    expect(await col(`SELECT (COUNT(*) AS ?n) WHERE ${W} HAVING (COUNT(*) = 2)`, "n")).toEqual(["2"]);
  });

  it("C3 unchanged neighbours: GROUP BY with no aggregate over an empty input, FILTER EXISTS, ORDER BY a variable", async () => {
    expect(await select(`SELECT ?s WHERE ${W0} GROUP BY ?s`)).toHaveLength(0);
    expect(await bag(`SELECT ?l WHERE { ${W.slice(1, -1)} FILTER ${EX_ONE} }`, "l")).toEqual(["Asset One"]);
    expect(await col(`SELECT ?l WHERE ${W} ORDER BY DESC(?l)`, "l")).toEqual(["Asset Two", "Asset One"]);
  });

  // ------------------------------------------------------------ form 1: GROUP BY over an empty input
  it("A1 GROUP BY over an empty input has NO row, whatever the aggregate", async () => {
    for (const agg of ["COUNT(*)", "COUNT(?l)", "SUM(?l)", "MAX(?l)", "MIN(?l)", "SAMPLE(?l)", "GROUP_CONCAT(?l)"]) {
      expect({ agg, rows: (await select(`SELECT ?s (${agg} AS ?v) WHERE ${W0} GROUP BY ?s`)).length }).toEqual({ agg, rows: 0 });
    }
    expect(await select(`SELECT ?s ?l (COUNT(*) AS ?n) WHERE ${W0} GROUP BY ?s ?l`)).toHaveLength(0);
    expect(await select(`SELECT ?s (COUNT(*) AS ?n) WHERE ${W0} GROUP BY ?s HAVING (COUNT(*) = 0)`)).toHaveLength(0);
    expect(await ask(`ASK ${W0} GROUP BY ?s HAVING (COUNT(*) = 0)`)).toBe(false);
  });

  it("A2 SELECT: GROUP BY whose only key is an expression has no row over an empty input either", async () => {
    // The step drops expression keys (38328fcc), so no variable says "grouped".
    expect(await select(`SELECT (COUNT(*) AS ?n) WHERE ${W0} GROUP BY (STR(?s))`)).toHaveLength(0);
  });

  it("A2b ASK: GROUP BY whose only key is an expression has no group over an empty input either", async () => {
    expect(await ask(`ASK ${W0} GROUP BY (STR(?s)) HAVING (COUNT(*) = 0)`)).toBe(false);
  });

  it("A2c GROUP BY by an expression with a HAVING and NO aggregate: still no group over an empty input", async () => {
    // Review R3: a guard that also asks for an aggregate passes every other axis.
    expect(await select(`SELECT ("k" AS ?k) WHERE ${W0} GROUP BY (STR(?s)) HAVING (true)`)).toHaveLength(0);
    expect(await ask(`ASK ${W0} GROUP BY (STR(?s)) HAVING (true)`)).toBe(false);
  });

  it("A3 a subquery with GROUP BY over an empty input joins as no row; without GROUP BY as one", async () => {
    expect(await select(`SELECT ?n WHERE { { SELECT ?s (COUNT(*) AS ?n) WHERE ${W0} GROUP BY ?s } }`)).toHaveLength(0);
    expect(await col(`SELECT ?n WHERE { { SELECT (COUNT(*) AS ?n) WHERE ${W0} } }`, "n")).toEqual(["0"]);
  });

  // ------------------------------------------------------------ form 2: HAVING without grouping is a Filter
  it("A4 HAVING without an aggregate and without GROUP BY filters the solutions", async () => {
    expect(await bag(`SELECT ?l WHERE ${W} HAVING (?l = "Asset One")`, "l")).toEqual(["Asset One"]);
    expect(await bag(`SELECT ?l WHERE ${W} HAVING (STRLEN(?l) > 0)`, "l")).toEqual(["Asset One", "Asset Two"]);
    expect(await bag(`SELECT ?l WHERE ${W} HAVING (?l IN ("Asset Two"))`, "l")).toEqual(["Asset Two"]);
  });

  it("A5 over an empty input HAVING without grouping keeps nothing: SELECT no row, ASK false", async () => {
    expect(await select(`SELECT ?s WHERE ${W0} HAVING (true)`)).toHaveLength(0);
    for (const mods of ["HAVING (true)", "HAVING (1 = 1)", "HAVING (!BOUND(?s))", `HAVING (!(?l = "x"))`, "HAVING (true) LIMIT 1"]) {
      expect({ mods, answer: await ask(`ASK ${W0} ${mods}`) }).toEqual({ mods, answer: false });
    }
  });

  it("A6 several HAVING conditions are a conjunction, in any order", async () => {
    expect(await bag(`SELECT ?l WHERE ${W} HAVING (?l = "Asset One") (STRLEN(?l) > 3)`, "l")).toEqual(["Asset One"]);
    expect(await select(`SELECT ?l WHERE ${W} HAVING (?l = "Asset One") (false)`)).toHaveLength(0);
    expect(await select(`SELECT ?l WHERE ${W} HAVING (false) (?l = "Asset One")`)).toHaveLength(0);
  });

  it("A7 HAVING comes before SELECT expressions: it cannot see their aliases, they still apply after it", async () => {
    expect(await select(`SELECT ?l (STRLEN(?l) AS ?k) WHERE ${W} HAVING (?k = 9)`)).toHaveLength(0);
    const rows = await select(`SELECT ?l (STRLEN(?l) AS ?k) WHERE ${W} HAVING (?l = "Asset One")`);
    expect(rows.map((r) => [val(r, "l"), val(r, "k")])).toEqual([["Asset One", "9"]]);
  });

  it("A8 HAVING without grouping may hold EXISTS: it sees each solution", async () => {
    expect(await bag(`SELECT ?l WHERE ${W} HAVING (${EX_ONE})`, "l")).toEqual(["Asset One"]);
    expect(await ask(`ASK ${W} HAVING (?l = "Asset One")`)).toBe(true);
    expect(await ask(`ASK ${W} HAVING (?l = "No such")`)).toBe(false);
  });

  // ------------------------------------------------------------ form 3: an aggregate in ORDER BY
  it("A9 an aggregate in ORDER BY groups the query level: one row, over an empty input too", async () => {
    expect(await col(`SELECT (COUNT(*) AS ?n) WHERE ${W} ORDER BY COUNT(*)`, "n")).toEqual(["2"]);
    expect(await col(`SELECT (COUNT(*) AS ?n) WHERE ${W0} ORDER BY COUNT(*)`, "n")).toEqual(["0"]);
  });

  it("A9b an aggregate ONLY in ORDER BY (constants projected) still makes the one implicit group", async () => {
    // Review R2: with an aggregate in SELECT or a GROUP BY the level groups anyway —
    // here ORDER BY is the only reason to group.
    expect(await col(`SELECT ("k" AS ?k) WHERE ${W} ORDER BY COUNT(*)`, "k")).toEqual(["k"]);
    expect(await col(`SELECT ("k" AS ?k) WHERE ${W0} ORDER BY COUNT(*)`, "k")).toEqual(["k"]);
  });

  it("A10 ORDER BY an aggregate sorts the groups by it — the aggregate need not be in SELECT", async () => {
    const by = (dir: string) => `SELECT ?s (SAMPLE(?l) AS ?m) WHERE ${WA} GROUP BY ?s ORDER BY ${dir}`;
    expect(await col(by("COUNT(?a)"), "m")).toEqual(["Asset Two", "Asset One"]);
    expect(await col(by("DESC(COUNT(?a))"), "m")).toEqual(["Asset One", "Asset Two"]);
    expect(await col(`${by("COUNT(?a)")} LIMIT 1`, "m")).toEqual(["Asset Two"]);
  });

  it("A10b ORDER BY an expression over an aggregate is refused loudly; projecting it sorts", async () => {
    // Review R5: ORDER BY by an expression does not sort (f7105304), so accepting
    // it would answer silently unsorted — before 2653916f it was refused too.
    expect(() => translate(`SELECT ?s WHERE ${WA} GROUP BY ?s ORDER BY (COUNT(?a) + 0)`)).toThrow(
      /ORDER BY on an expression over an aggregate is not supported/,
    );
    const projected = `SELECT ?s (SAMPLE(?l) AS ?m) ((COUNT(?a) + 0) AS ?k) WHERE ${WA} GROUP BY ?s ORDER BY ?k`;
    expect(await col(projected, "m")).toEqual(["Asset Two", "Asset One"]);
  });

  it("A11 ASK: an aggregate in ORDER BY groups (one group), the sort itself is not built", async () => {
    expect(await ask(`ASK ${W} ORDER BY COUNT(*) OFFSET 1`)).toBe(false);
    expect(await ask(`ASK ${W0} ORDER BY COUNT(*)`)).toBe(true);
    expect(await ask(`ASK ${W} ORDER BY COUNT(*)`)).toBe(true);
    const types = nodeTypes(translate(`ASK ${W} ORDER BY COUNT(*) OFFSET 1`));
    expect(types).toContain("group");
    expect(types).not.toContain("orderby");
  });

  it("A12 ORDER BY without an aggregate translates as before: no group, ordinary sort", async () => {
    expect(nodeTypes(translate(`SELECT ?l WHERE ${W} ORDER BY DESC(?l)`))).not.toContain("group");
    expect(nodeTypes(translate(`ASK ${W} ORDER BY ?l LIMIT 1`))).not.toContain("group");
    expect(await col(`SELECT ?l WHERE ${W} ORDER BY ?l`, "l")).toEqual(["Asset One", "Asset Two"]);
  });

  // ------------------------------------------------------------ form 4: EXISTS in HAVING and SELECT expressions
  it("A13 EXISTS in HAVING over groups: EXISTS keeps both, NOT EXISTS none", async () => {
    const having = (h: string) => `SELECT ?s (SAMPLE(?l) AS ?m) WHERE ${WA} GROUP BY ?s HAVING (${h})`;
    expect(await bag(having(`EXISTS { ?s exo:Asset_aliases ?x }`), "m")).toEqual(["Asset One", "Asset Two"]);
    expect(await select(having(`NOT EXISTS { ?s exo:Asset_aliases ?x }`))).toHaveLength(0);
  });

  it("A14 EXISTS in HAVING sees the group key, alone and next to an aggregate", async () => {
    const having = (h: string) => `SELECT ?s (SAMPLE(?l) AS ?m) WHERE ${WA} GROUP BY ?s HAVING (${h})`;
    expect(await col(having(EX_ONE), "m")).toEqual(["Asset One"]);
    expect(await col(having(`COUNT(?a) = 1 && EXISTS { ?s exo:Asset_aliases "Beta one" }`), "m")).toEqual(["Asset Two"]);
    expect(await col(having(`EXISTS { ?s exo:Asset_aliases ?x FILTER(STRSTARTS(?x, "Beta")) }`), "m")).toEqual(["Asset Two"]);
  });

  it("A15 ASK with EXISTS in HAVING: true when a group passes, false when none does", async () => {
    expect(await ask(`ASK ${WA} GROUP BY ?s HAVING (${EX_ONE})`)).toBe(true);
    expect(await ask(`ASK ${WA} GROUP BY ?s HAVING (EXISTS { ?s exo:Asset_aliases "No such" })`)).toBe(false);
  });

  it("A16 EXISTS in a SELECT expression is a value per row: true / false, NOT EXISTS, inside IF, with GROUP BY", async () => {
    const pairs = async (sparql: string) =>
      (await select(sparql)).map((r) => [val(r, "l") ?? val(r, "m"), val(r, "e")]).sort();
    expect(await pairs(`SELECT ?l (${EX_ONE} AS ?e) WHERE ${W}`)).toEqual([["Asset One", "true"], ["Asset Two", "false"]]);
    expect(await pairs(`SELECT ?l (NOT ${EX_ONE} AS ?e) WHERE ${W}`)).toEqual([["Asset One", "false"], ["Asset Two", "true"]]);
    expect(await pairs(`SELECT ?l (IF(${EX_ONE}, "y", "n") AS ?e) WHERE ${W}`)).toEqual([["Asset One", "y"], ["Asset Two", "n"]]);
    expect(await pairs(`SELECT ?s (SAMPLE(?l) AS ?m) (${EX_ONE} AS ?e) WHERE ${WA} GROUP BY ?s`)).toEqual([["Asset One", "true"], ["Asset Two", "false"]]);
  });

  it("A17 an error in a HAVING that holds EXISTS drops the group; the query does not fail", async () => {
    const sparql = `SELECT ?s WHERE ${WA} GROUP BY ?s HAVING (${EX_ONE} && STR(?nope) = "x")`;
    await expect(select(sparql)).resolves.toHaveLength(0);
  });

  it("A18 HAVING over groups checks EVERY condition, not only the first", async () => {
    const sparql = `SELECT ?s (SAMPLE(?l) AS ?m) WHERE ${WA} GROUP BY ?s HAVING (COUNT(?a) > 0) (COUNT(?a) = 1)`;
    expect(await col(sparql, "m")).toEqual(["Asset Two"]);
  });

  it("A18b a FALSE HAVING condition drops the group even when a later one holds", async () => {
    // Review R1: "the last condition decides" passes A18 — the false one must come first here.
    const sparql = `SELECT ?s (SAMPLE(?l) AS ?m) WHERE ${WA} GROUP BY ?s HAVING (COUNT(?a) = 1) (COUNT(?a) > 0)`;
    expect(await col(sparql, "m")).toEqual(["Asset Two"]);
    expect(await ask(`ASK ${WA} GROUP BY ?s HAVING (COUNT(?a) = 5) (COUNT(?a) > 0)`)).toBe(false);
  });

  it("A22 aggregate names stay unique when HAVING holds EXISTS over a subquery and ORDER BY an aggregate", async () => {
    // Review R4: the subquery inside EXISTS is translated by translateSelect while
    // the outer level still collects; a counter reset there gave the ORDER BY
    // aggregate the name of the HAVING one (HAVING then read MAX instead of COUNT).
    const sparql = `SELECT ?s (SAMPLE(?l) AS ?m) WHERE ${WA} GROUP BY ?s
      HAVING (COUNT(?a) >= 1 && EXISTS { { SELECT ?s WHERE { ?s exo:Asset_label ?zz } } })
      ORDER BY DESC(MAX(?l))`;
    expect(await col(sparql, "m")).toEqual(["Asset Two", "Asset One"]);
  });

  // ------------------------------------------------------------ review of the spec
  it("A23 ASK: HAVING without grouping filters BEFORE LIMIT / OFFSET, on every ASK path", async () => {
    // Review of the spec (W1): a Filter applied AFTER the Slice passes every other axis —
    // there the matching label is the first solution, so both orders agree.
    for (const [path, run] of Object.entries({ engine: ask, ...ASK_PATHS })) {
      const limit = await run(`ASK ${W} HAVING (?l = "Asset Two") LIMIT 1`);
      const offset = await run(`ASK ${W} HAVING (?l = "Asset Two") OFFSET 1`);
      expect({ path, limit, offset }).toEqual({ path, limit: true, offset: false });
    }
  });

  it("A24 ASK: HAVING without grouping takes IN / NOT IN, on every ASK path", async () => {
    // Review of the spec (W2): reusing the HAVING conditions translated through the
    // aggregate-aware table loses the IN list (2f27f300) — A4 checks IN in SELECT only.
    for (const [path, run] of Object.entries({ engine: ask, ...ASK_PATHS })) {
      const isIn = await run(`ASK ${W} HAVING (?l IN ("Asset Two"))`);
      const notIn = await run(`ASK ${W} HAVING (?l NOT IN ("Asset One", "Asset Two"))`);
      expect({ path, isIn, notIn }).toEqual({ path, isIn: true, notIn: false });
    }
  });

  // Two JOIN operands: every condition below reads a variable of each.
  const WJ_IN = `{ ?s exo:Instance_class ems:Bug . ?s exo:Asset_label ?l . } { ?c exo:Instance_class ems:Bug . ?c exo:Asset_label ?k . FILTER(?k = "Asset Two") }`;
  const WJ = `{ ${WJ_IN} }`;
  const lk = (rs: SolutionMapping[]) => rs.map((r) => `${val(r, "l")}|${val(r, "k")}`).sort();

  it("A25 HAVING without grouping IS the FILTER of WHERE — same answer on every path, over a JOIN", async () => {
    // Review of the spec (HIGH): on the paths with the optimizer (plugin, `query`) a Filter
    // whose variables hide under EXISTS or arithmetic is pushed into one JOIN operand
    // (walker defect a8012c4f) — FILTER in WHERE answers so on 17.18.1 already, and HAVING
    // without grouping is that Filter now (§18.2.4.2). The axis locks PARITY, not the value:
    // fixing a8012c4f keeps it green and fixes both forms; a fix for HAVING alone turns it red.
    const conds = [
      `?l = "Asset One" && EXISTS { ?c exo:Asset_label "Asset One" }`,
      `?l = "Asset One" && COALESCE(STRLEN(?k) * 0, 1) = 1`,
      `?l != ?k`,
    ];
    for (const c of conds) {
      for (const [path, run] of Object.entries({ engine: select, ...SELECT_PATHS })) {
        const having = lk(await run(`SELECT ?l ?k WHERE ${WJ} HAVING (${c})`));
        const filter = lk(await run(`SELECT ?l ?k WHERE { ${WJ_IN} FILTER(${c}) }`));
        expect({ c, path, having }).toEqual({ c, path, having: filter });
      }
      for (const [path, run] of Object.entries({ engine: ask, ...ASK_PATHS })) {
        const having = await run(`ASK ${WJ} HAVING (${c})`);
        const filter = await run(`ASK { ${WJ_IN} FILTER(${c}) }`);
        expect({ c, path, having }).toEqual({ c, path, having: filter });
      }
    }
    // Not vacuous: without the optimizer the answers are those of SPARQL 1.1.
    expect(lk(await select(`SELECT ?l ?k WHERE ${WJ} HAVING (${conds[0]})`))).toEqual([]);
    expect(lk(await select(`SELECT ?l ?k WHERE ${WJ} HAVING (${conds[1]})`))).toEqual([]);
    expect(lk(await select(`SELECT ?l ?k WHERE ${WJ} HAVING (${conds[2]})`))).toEqual(["Asset One|Asset Two"]);
  });

  it("A26 EXISTS under arithmetic answers in a SELECT expression as in BIND, in HAVING as in FILTER — every path", async () => {
    // Review of the spec: the async evaluator has no branch for arithmetic (a8012c4f), so
    // EXISTS under arithmetic errs — in BIND and FILTER on 17.18.1 already. PARITY again:
    // fixing a8012c4f fixes every form at once; a fix for one form alone turns this red.
    const e = `(IF(${EX_ONE}, 1, 0) + 1)`;
    const le = (rs: SolutionMapping[]) => rs.map((r) => `${val(r, "l")}|${val(r, "e")}`).sort();
    const ss = (rs: SolutionMapping[]) => rs.map((r) => String(val(r, "s"))).sort();
    const ex = `EXISTS { ?s exo:Asset_aliases "Alpha one" }`;
    for (const [path, run] of Object.entries({ engine: select, ...SELECT_PATHS })) {
      const proj = le(await run(`SELECT ?l (${e} AS ?e) WHERE ${W}`));
      const bind = le(await run(`SELECT ?l ?e WHERE { ${W.slice(1, -1)} BIND(${e} AS ?e) }`));
      expect({ path, proj }).toEqual({ path, proj: bind });
      const having = ss(await run(`SELECT ?s WHERE ${WA} GROUP BY ?s HAVING ((IF(${ex}, 1, 0) + COUNT(?a)) = 3)`));
      const filter = ss(
        await run(`SELECT ?s WHERE { { SELECT ?s (COUNT(?a) AS ?n) WHERE ${WA} GROUP BY ?s } FILTER((IF(${ex}, 1, 0) + ?n) = 3) }`),
      );
      expect({ path, having }).toEqual({ path, having: filter });
    }
  });

  // ------------------------------------------------------------ every path
  it.each(axes(ASK_PATHS))(
    "A19%s ASK path %s: the four forms answer by SPARQL 1.1 (and a canary)",
    async (_axis, path) => {
      const run = ASK_PATHS[path];
      expect(await run(`ASK ${W}`)).toBe(true);
      expect(await run(`ASK ${W0} GROUP BY ?s HAVING (COUNT(*) = 0)`)).toBe(false);
      expect(await run(`ASK ${W} HAVING (?l = "Asset One")`)).toBe(true);
      expect(await run(`ASK ${W0} HAVING (true)`)).toBe(false);
      expect(await run(`ASK ${W} ORDER BY COUNT(*) OFFSET 1`)).toBe(false);
      expect(await run(`ASK ${W0} ORDER BY COUNT(*)`)).toBe(true);
      expect(await run(`ASK ${WA} GROUP BY ?s HAVING (${EX_ONE})`)).toBe(true);
    },
  );

  it.each(axes(SELECT_PATHS))(
    "A20%s SELECT path %s: the four forms answer by SPARQL 1.1",
    async (_axis, path) => {
      const run = SELECT_PATHS[path];
      expect(await run(`SELECT ?l WHERE ${W}`)).toHaveLength(2);
      expect(await run(`SELECT ?s (COUNT(*) AS ?n) WHERE ${W0} GROUP BY ?s`)).toHaveLength(0);
      expect((await run(`SELECT ?l WHERE ${W} HAVING (?l = "Asset One")`)).map((r) => val(r, "l"))).toEqual(["Asset One"]);
      expect((await run(`SELECT (COUNT(*) AS ?n) WHERE ${W} ORDER BY COUNT(*)`)).map((r) => val(r, "n"))).toEqual(["2"]);
      expect((await run(`SELECT ?s (SAMPLE(?l) AS ?m) WHERE ${WA} GROUP BY ?s HAVING (${EX_ONE})`)).map((r) => val(r, "m"))).toEqual(["Asset One"]);
      expect((await run(`SELECT ?l (${EX_ONE} AS ?e) WHERE ${W}`)).map((r) => val(r, "e")).sort()).toEqual(["false", "true"]);
    },
  );

  // ------------------------------------------------------------ differential vs SELECT
  // ASK is true iff the SELECT with the same pattern and modifiers has a row, on
  // every form of this bug. Each form also has its absolute axis above.
  const FORMS: Array<{ where: string; mods: string; proj: string }> = [];
  for (const [where, name] of [[W, "W"], [WA, "WA"], [W0, "W0"]] as const) {
    for (const slice of ["", "LIMIT 1", "OFFSET 1", "OFFSET 2"]) {
      FORMS.push({ where, mods: `GROUP BY ?s HAVING (COUNT(*) = 0) ${slice}`, proj: "?s" });
      FORMS.push({ where, mods: `GROUP BY ?s HAVING (COUNT(*) > 0) ${slice}`, proj: "?s" });
      FORMS.push({ where, mods: `GROUP BY (STR(?s)) HAVING (COUNT(*) >= 0) ${slice}`, proj: "(COUNT(*) AS ?n)" });
      FORMS.push({ where, mods: `HAVING (?l = "Asset One") ${slice}`, proj: "?l" });
      FORMS.push({ where, mods: `HAVING (true) ${slice}`, proj: "?l" });
      FORMS.push({ where, mods: `HAVING (?l = "Asset Two") ${slice}`, proj: "?l" });
      FORMS.push({ where, mods: `HAVING (?l IN ("Asset Two")) ${slice}`, proj: "?l" });
      FORMS.push({ where, mods: `ORDER BY COUNT(*) ${slice}`, proj: "(COUNT(*) AS ?n)" });
      FORMS.push({ where, mods: `GROUP BY ?s ORDER BY DESC(COUNT(*)) ${slice}`, proj: "?s" });
      FORMS.push({ where, mods: `GROUP BY ?s HAVING (EXISTS { ?s exo:Asset_label ?x }) ${slice}`, proj: "?s" });
      FORMS.push({ where, mods: `GROUP BY ?s HAVING (NOT EXISTS { ?s exo:Asset_label ?x }) ${slice}`, proj: "?s" });
    }
    void name;
  }

  it("A21 differential: ASK equals 'the SELECT has a row' on every form of this bug", async () => {
    const mismatches: string[] = [];
    for (const f of FORMS) {
      const a = await ask(`ASK ${f.where} ${f.mods}`);
      const rows = await select(`SELECT ${f.proj} WHERE ${f.where} ${f.mods}`);
      if (a !== rows.length > 0) {
        mismatches.push(`${f.where === W ? "W" : f.where === WA ? "WA" : "W0"} ${f.mods.trim()} → ASK ${a}, SELECT ${rows.length}`);
      }
    }
    expect(FORMS.length).toBeGreaterThanOrEqual(100);
    expect(mismatches).toEqual([]);
  });
});
