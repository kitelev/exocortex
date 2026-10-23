/**
 * Production-shape integration test: an UNBOUND argument of a SPARQL function is an
 * evaluation ERROR (SPARQL 1.1 §17.3), not an empty string — so a FILTER over it
 * drops the row instead of letting every row through (vault-exodev ems__Bug 37c80e59).
 *
 * ## The defect
 *
 * Three mechanisms produced an unbound value where a string was meant, and a fourth
 * turned it into "true":
 *
 * 1. `FilterExecutor.getStringValue(undefined)` returned `""`; most string, date,
 *    hash and numeric functions read their argument through it (not every argument:
 *    SUBSTR's start and length go through `Number(…)`), so
 *    `CONTAINS(?label, ?unbound)` — `"…".includes("")` — was TRUE for every row.
 *    A NamedQuery run without its `$param` returned the whole population.
 * 2. `FilterExecutor.getTermFromExpression` returned a value only for a variable:
 *    `STR("ab")`, `STR(LCASE(?l))`, `isIRI(<constant>)` saw `undefined`.
 * 3. A value computed by BIND is a JS primitive; EXISTS substitution
 *    (`QueryExecutor.substituteInExpression`) did not recognise it as a term, so
 *    the variable stayed unbound inside the EXISTS filter — and (1) made it true.
 *
 * The fix makes an unbound argument an error at the two shared helpers and catches
 * the new error on every path it reaches (HAVING, MIN/MAX of no values, IN, the
 * async function path, exo:byUUID's own contract), and substitutes a BIND primitive
 * into EXISTS / LATERAL — but NOT into the independent operand of a join.
 *
 * ## The pipeline under test
 *
 * The one `exocortex-cli query` runs: `SPARQLParser` → `ExoQLAlgebraTranslator` →
 * `AlgebraOptimizer.optimize` → `ExoQLQueryExecutor`. The store is built by the REAL
 * converter over fixture notes, so the class IRI, label and `aliases` triples are
 * exactly what production emits.
 *
 * Revert-verify: `unbound-argument-37c80e59-*.spec.json` (one spec per changed source
 * file) remove one guarantee each and name the axes that must turn red. Axes marked
 * "no regression" are green on the pre-fix engine too, by construction.
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
import { FilterExecutor } from "../../../src/infrastructure/sparql/executors/FilterExecutor";
import { SolutionMapping } from "../../../src/infrastructure/sparql/SolutionMapping";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { AlgebraOptimizer } from "../../../src/infrastructure/sparql/algebra/AlgebraOptimizer";
import type {
  AlgebraOperation,
  Expression,
} from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../src/domain/models/rdf/Triple";

let seq = 0;
const uid = () =>
  `37c80e59-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (u: string, fm: IFrontmatter): FixtureNote => ({
  uid: u,
  frontmatter: { exo__Asset_uid: u, ...fm },
});

// ---------------------------------------------------------------- TBox
const BUG_CLASS = uid();
const TBOX: FixtureNote[] = [note(BUG_CLASS, { exo__Asset_label: "ems__Bug" })];

// ---------------------------------------------------------------- population
// Ten bugs. Eight carry an alias equal to the label, one a different alias, one
// none — the shape of the vault the defect was found on (221 of 222 aliased).
// Three labels (and their aliases) contain "bug"; four labels are longer than 12.
const bug = (label: string, aliases?: string[]): FixtureNote =>
  note(uid(), {
    exo__Asset_label: label,
    exo__Instance_class: `[[${BUG_CLASS}]]`,
    ...(aliases ? { aliases } : {}),
  });
const BUGS: FixtureNote[] = [
  bug("Bug alpha", ["Bug alpha"]), // 9
  bug("Bug beta parser", ["Bug beta parser"]), // 15
  bug("Bug gamma", ["Bug gamma"]), // 9
  bug("Crash on save", ["Crash on save"]), // 13
  bug("Slow startup", ["Slow startup"]), // 12
  bug("Wrong count in table", ["Wrong count in table"]), // 20
  bug("Missing button", ["Missing button"]), // 14
  bug("Broken link", ["Broken link"]), // 11
  bug("Typo in menu", ["Typo in the menu"]), // 12, alias differs
  bug("Lost focus"), // 10, no alias
];
const POP = BUGS.length; // 10
const ALIAS_EQUALS_LABEL = 8;
const LABEL_HAS_BUG = 3;
const LONGER_THAN_12 = 4;

// Unrelated notes: an engine that ignores the class pattern is visibly wrong.
const NOISE: FixtureNote[] = Array.from({ length: 25 }, (_, i) =>
  note(uid(), { exo__Asset_label: `Noise ${i}`, aliases: [`Noise ${i}`] }),
);

const NOTES = [...TBOX, ...BUGS, ...NOISE];

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

const parser = new SPARQLParser();
const translator = new ExoQLAlgebraTranslator();
const PREFIX = `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>`;

/** The algebra `exocortex-cli query` executes: translated, then optimized. */
const plan = (sparql: string): AlgebraOperation =>
  new AlgebraOptimizer().optimize(
    translator.translate(parser.parse(`${PREFIX}\n${sparql}`)),
  );

const run = async (sparql: string) =>
  new ExoQLQueryExecutor(store).executeAll(plan(sparql));

/** A bound value as a plain string; `∅` for unbound. */
const val = (term: unknown): string => {
  if (term === undefined || term === null) return "∅";
  if (term instanceof IRI) return `<${term.value}>`;
  if (term instanceof Literal) return term.value;
  return String(term);
};

/** The population pattern every axis starts from. */
const BUGS_WHERE = `?s exo:Instance_class ems:Bug . ?s exo:Asset_label ?l .`;

/** Number of distinct bugs for which `extra` (FILTER / pattern) holds. */
async function pop(extra: string): Promise<number> {
  const rows = await run(`SELECT DISTINCT ?s WHERE { ${BUGS_WHERE} ${extra} }`);
  return rows.length;
}

/** Values of the projected variables of a one-row SELECT over a single bug. */
async function oneRow(projection: string, vars: string[]): Promise<string[]> {
  const rows = await run(
    `SELECT ${projection} WHERE { ${BUGS_WHERE} FILTER(?l = "Bug alpha") }`,
  );
  expect(rows).toHaveLength(1);
  return vars.map((v) => val(rows[0].get(v)));
}

const SUITE =
  "an unbound function argument is an evaluation error (ems__Bug 37c80e59)";

describe(SUITE, () => {
  it("U1 a FILTER whose string function has an unbound argument drops the row — CONTAINS / STRSTARTS / STRENDS / REGEX", async () => {
    // Input is built: the population is non-empty and the class pattern matters.
    expect(await pop("")).toBe(POP);
    expect(await pop(`FILTER(CONTAINS(LCASE(STR(?l)), ?nope))`)).toBe(0);
    expect(await pop(`FILTER(STRSTARTS(STR(?l), ?nope))`)).toBe(0);
    expect(await pop(`FILTER(STRENDS(STR(?l), ?nope))`)).toBe(0);
    // A NamedQuery parameter that was not passed (`--param who` missing).
    expect(await pop(`FILTER(REGEX(STR(?l), $who, "i"))`)).toBe(0);
    // Control: a BOUND empty string is legal and matches everything.
    expect(await pop(`FILTER(CONTAINS(?l, ""))`)).toBe(POP);
    expect(await pop(`FILTER(CONTAINS(LCASE(STR(?l)), "bug"))`)).toBe(
      LABEL_HAS_BUG,
    );
  });

  it("U2 an unbound argument stays unbound through value functions and their chains", async () => {
    const [v1, v2, v3, v4] = await oneRow(
      `(LCASE(?nope) AS ?v1) (CONCAT("a", ?nope) AS ?v2) (STRLEN(?nope) AS ?v3) (REPLACE("abc", ?nope, "x") AS ?v4)`,
      ["v1", "v2", "v3", "v4"],
    );
    expect([v1, v2, v3, v4]).toEqual(["∅", "∅", "∅", "∅"]);
    // The chain the defect reported: a missing parameter wrapped in a function.
    expect(await pop(`FILTER(CONTAINS(LCASE(STR(?l)), LCASE($p)))`)).toBe(0);
    expect(await pop(`FILTER(CONTAINS(STR(?l), CONCAT($p, "")))`)).toBe(0);
    // An unbound OPTIONAL value inside CONCAT leaves the BIND unbound (standard);
    // COALESCE is the documented way to default it.
    const concat = await run(`SELECT ?s ?v WHERE { ${BUGS_WHERE}
      OPTIONAL { ?s exo:Asset_nothing ?x } BIND(CONCAT(STR(?l), " / ", ?x) AS ?v) }`);
    expect(concat).toHaveLength(POP);
    expect(concat.filter((r) => r.get("v") !== undefined)).toHaveLength(0);
    const coalesced = await run(`SELECT ?s ?v WHERE { ${BUGS_WHERE}
      OPTIONAL { ?s exo:Asset_nothing ?x } BIND(CONCAT(STR(?l), " / ", COALESCE(?x, "")) AS ?v) }`);
    expect(coalesced.filter((r) => r.get("v") !== undefined)).toHaveLength(POP);
  });

  it("U3 no regression: `||` tolerates an erroring operand — a label match still passes", async () => {
    expect(
      await pop(
        `FILTER(CONTAINS(LCASE(STR(?l)), "bug") || CONTAINS(LCASE(STR(?nope)), "bug"))`,
      ),
    ).toBe(LABEL_HAS_BUG);
    expect(
      await pop(
        `FILTER(CONTAINS(LCASE(?nope), "bug") || CONTAINS(LCASE(STR(?l)), "bug"))`,
      ),
    ).toBe(LABEL_HAS_BUG);
  });

  it("U3b no regression: the ASYNCHRONOUS `||` / `&&` (an EXISTS operand) tolerate an erroring operand too", async () => {
    expect(
      await pop(
        `FILTER(EXISTS { ?s exo:Asset_label ?l2 } || CONTAINS(?l, ?nope))`,
      ),
    ).toBe(POP);
    expect(
      await pop(
        `FILTER(CONTAINS(?l, ?nope) || EXISTS { ?s exo:Asset_label ?l2 })`,
      ),
    ).toBe(POP);
    // A false absorbs the error of `&&`: !(false && error) = true.
    expect(
      await pop(
        `FILTER(!(NOT EXISTS { ?s exo:Asset_label ?l2 } && CONTAINS(?l, ?nope)))`,
      ),
    ).toBe(POP);
  });

  it("U4 a HAVING condition that errors drops the group — the query itself does not fail", async () => {
    const group = (having: string) =>
      run(`SELECT ?c (COUNT(?s) AS ?n) WHERE { ?s exo:Instance_class ?c . ?s exo:Asset_label ?l .
        FILTER(?c = ems:Bug) } GROUP BY ?c HAVING(${having})`);
    // Input is built: without the erroring condition the group is there.
    expect(await group(`COUNT(?s) > 0`)).toHaveLength(1);
    expect(await group(`CONTAINS(STR(?c), ?nope)`)).toHaveLength(0);
    await expect(group(`STR(?nope) = "x"`)).resolves.toHaveLength(0);
  });

  it("U5 exo:byUUID keeps its own contract: an unbound UUID argument yields undefined, not an error", () => {
    const executor = new FilterExecutor();
    executor.setTripleStore(store);
    const call = {
      type: "function",
      function: "byUUID",
      args: [{ type: "variable", name: "nope" }],
    } as unknown as Expression;
    expect(() =>
      executor.evaluateExpression(call, new SolutionMapping()),
    ).not.toThrow();
    expect(
      executor.evaluateExpression(call, new SolutionMapping()),
    ).toBeUndefined();
  });

  async function noValueGroup(agg: string): Promise<void> {
    const rows = await run(`SELECT ?s (${agg} AS ?m) WHERE { ${BUGS_WHERE}
      OPTIONAL { ?s exo:Asset_aliases ?a } } GROUP BY ?s`);
    expect(rows).toHaveLength(POP);
    // Exactly the alias-less bug has no value — the variable is ABSENT from its
    // row, so the CLI's JSON output (`solution.toJSON()`) can serialize it.
    expect(rows.filter((r) => r.get("m") === undefined)).toHaveLength(1);
    expect(rows.filter((r) => !r.has("m"))).toHaveLength(1);
    expect(() => rows.map((r) => r.toJSON())).not.toThrow();
  }

  it("U6 MAX of a group with no values is unbound — the query does not fail", async () => {
    await noValueGroup("MAX(?a)");
    // After the unbound-argument fix STRLEN(?a) errors per row — MAX sees no values.
    await noValueGroup("MAX(STRLEN(?a))");
  });

  it("U6b MIN of a group with no values is unbound — the query does not fail", async () => {
    for (const agg of ["MIN(?a)", "MIN(STRLEN(?a))"]) await noValueGroup(agg);
  });

  it("U7 IN / NOT IN (synchronous path): a match absorbs an erroring element, no match + an error is an error", async () => {
    expect(await pop(`FILTER("x" IN (LCASE(?nope), "x"))`)).toBe(POP);
    expect(await pop(`FILTER("x" IN ("x", LCASE(?nope)))`)).toBe(POP);
    expect(await pop(`FILTER("y" IN (LCASE(?nope), "x"))`)).toBe(0);
    expect(await pop(`FILTER("x" NOT IN (LCASE(?nope)))`)).toBe(0);
    // Control: without an erroring element IN keeps working.
    expect(await pop(`FILTER(STR(?l) IN ("Bug alpha", "Lost focus"))`)).toBe(2);
  });

  it("U7b IN / NOT IN (asynchronous path — EXISTS in the list): the same rules", async () => {
    const ex = `IF(EXISTS { ?s exo:Asset_label ?l2 }, "x", "y")`;
    expect(await pop(`FILTER("x" IN (LCASE(?nope), ${ex}))`)).toBe(POP);
    expect(await pop(`FILTER("z" IN (LCASE(?nope), ${ex}))`)).toBe(0);
    expect(await pop(`FILTER("z" NOT IN (LCASE(?nope), ${ex}))`)).toBe(0);
    // Control: no erroring element.
    expect(await pop(`FILTER("x" IN ("q", ${ex}))`)).toBe(POP);
  });

  it("U8 the asynchronous function path keeps an unbound argument unbound (CONCAT next to EXISTS)", async () => {
    const ex = `IF(EXISTS { ?s exo:Asset_label ?l2 }, "a", "b")`;
    expect(await pop(`FILTER(CONCAT(?nope, ${ex}) = "a")`)).toBe(0);
    // Control: a bound argument on the same path.
    expect(
      await pop(`FILTER(CONCAT(STR(?l), ${ex}) = CONCAT(STR(?l), "a"))`),
    ).toBe(POP);
  });

  it("S1 STR takes any expression — a literal, a function call, arithmetic, an IRI constant", async () => {
    const [v1, v2, v3, v4, v5] = await oneRow(
      `(STR("ab") AS ?v1) (LCASE(STR("AB")) AS ?v2) (STR(LCASE(?l)) AS ?v3) (STR(1 + 2) AS ?v4) (STR(CONCAT("a", "b")) AS ?v5)`,
      ["v1", "v2", "v3", "v4", "v5"],
    );
    expect([v1, v2, v3, v4, v5]).toEqual(["ab", "ab", "bug alpha", "3", "ab"]);
    expect(await pop(`FILTER(STR(LCASE(?l)) = LCASE(STR(?l)))`)).toBe(POP);
    // `STRSTARTS(str(?p), str(ems:))` — the form a knowledge asset called broken.
    expect(
      await pop(
        `?s exo:Instance_class ?c FILTER(STRSTARTS(STR(?c), STR(ems:)))`,
      ),
    ).toBe(POP);
  });

  it("S2 EXISTS with STR over an outer variable equals the plain join; NOT EXISTS is its complement", async () => {
    const inner = `?s exo:Asset_aliases ?al . FILTER(STR(?al) = STR(?l))`;
    // Control: the same correlation as an ordinary join.
    expect(await pop(inner)).toBe(ALIAS_EQUALS_LABEL);
    expect(await pop(`FILTER(EXISTS { ${inner} })`)).toBe(ALIAS_EQUALS_LABEL);
    expect(await pop(`FILTER NOT EXISTS { ${inner} }`)).toBe(
      POP - ALIAS_EQUALS_LABEL,
    );
  });

  it("S3 sameTerm over values computed by functions: equal type and value is the same term", async () => {
    expect(await pop(`FILTER(sameTerm("a", "a"))`)).toBe(POP);
    expect(await pop(`FILTER(sameTerm(1, 1))`)).toBe(POP);
    expect(await pop(`FILTER(sameTerm(STR(?l), STR(?l)))`)).toBe(POP);
    expect(await pop(`FILTER(sameTerm("a", "b"))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(1, "1"))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(STR(?l), "zzqq"))`)).toBe(0);
  });

  it("B1 a string bound by BIND reaches an EXISTS filter exactly as one bound by VALUES", async () => {
    const exists = `FILTER(EXISTS { ?s exo:Asset_aliases ?al . FILTER(CONTAINS(LCASE(STR(?al)), ?k)) })`;
    // Positive pair: three aliases contain "bug".
    expect(await pop(`VALUES ?k { "bug" } ${exists}`)).toBe(LABEL_HAS_BUG);
    expect(await pop(`BIND("bug" AS ?k) ${exists}`)).toBe(LABEL_HAS_BUG);
    // Negative pair. ⛔ Alone it is vacuous to a lost substitution: the
    // unbound-argument fix already turns it to 0 — the positive pair is the axis.
    expect(await pop(`VALUES ?k { "zzqq" } ${exists}`)).toBe(0);
    expect(await pop(`BIND("zzqq" AS ?k) ${exists}`)).toBe(0);
    // A BIND of a computed string (the table-body form).
    expect(await pop(`BIND(LCASE(STR("BUG")) AS ?k) ${exists}`)).toBe(
      LABEL_HAS_BUG,
    );
  });

  it("B2 a number bound by BIND reaches an EXISTS filter exactly as one bound by VALUES", async () => {
    const exists = `FILTER(EXISTS { ?s exo:Asset_label ?l2 . FILTER(STRLEN(STR(?l2)) > ?n) })`;
    expect(await pop(`FILTER(STRLEN(STR(?l)) > 12)`)).toBe(LONGER_THAN_12);
    expect(await pop(`VALUES ?n { 12 } ${exists}`)).toBe(LONGER_THAN_12);
    expect(await pop(`BIND(12 AS ?n) ${exists}`)).toBe(LONGER_THAN_12);
    expect(await pop(`BIND(12.5 AS ?n) ${exists}`)).toBe(LONGER_THAN_12);
    // The substituted node is a NUMBER, not its digits as a string: inside EXISTS
    // it equals 12 and not "12" — exactly as outside.
    const eq = (rhs: string) =>
      `FILTER(EXISTS { ?s exo:Asset_label ?l2 . FILTER(?n = ${rhs}) })`;
    expect(await pop(`BIND(12 AS ?n) FILTER(?n = 12)`)).toBe(POP);
    expect(await pop(`BIND(12 AS ?n) ${eq("12")}`)).toBe(POP);
    expect(await pop(`BIND(12 AS ?n) FILTER(?n = "12")`)).toBe(0);
    expect(await pop(`BIND(12 AS ?n) ${eq('"12"')}`)).toBe(0);
  });

  it("B3 a boolean bound by BIND reaches an EXISTS filter as it does a plain filter", async () => {
    expect(await pop(`BIND(true AS ?b) FILTER(?b)`)).toBe(POP);
    expect(
      await pop(
        `BIND(true AS ?b) FILTER(EXISTS { ?s exo:Asset_label ?l2 . FILTER(?b) })`,
      ),
    ).toBe(POP);
    expect(
      await pop(
        `BIND(false AS ?b) FILTER(EXISTS { ?s exo:Asset_label ?l2 . FILTER(?b) })`,
      ),
    ).toBe(0);
  });

  it("J1 a PRIMITIVE a BIND computed on the left of a join is unbound inside the right operand's own group (§18.5)", async () => {
    // ⚠ Narrow on purpose: a TERM value (BIND(?l AS ?k), VALUES) still leaks into the
    // right group's FILTER — a pre-existing defect of the bind join (ems__Bug f440b567).
    // Since this fix the leak is wider: a substituted IRI, and any term a term
    // function reads (STR, sameTerm, isIRI …), now evaluates where it raised before
    // (4e3ce943) and the row was dropped — the standard answer by accident. Probes
    // and the measured exposure: ems__Bug f440b567, «Радиус шире после 37c80e59».
    // The inner group is evaluated on its own (SPARQL 1.1 §18.5): ?k is unbound there.
    expect(
      await pop(
        `BIND("x" AS ?k) { ?s exo:Asset_label ?l3 . FILTER(!BOUND(?k)) }`,
      ),
    ).toBe(POP);
    expect(
      await pop(
        `BIND("x" AS ?k) { { ?s exo:Asset_label ?l3 . FILTER(?k = "x") } UNION { ?s exo:Asset_nothing ?z } }`,
      ),
    ).toBe(0);
    expect(
      await pop(
        `BIND(SUBSTR(STR(?l), 1, 1) AS ?f) { ?s exo:Asset_label ?l3 . FILTER(STRSTARTS(STR(?l3), ?f)) }`,
      ),
    ).toBe(0);
    // EXISTS nested in the right operand is correlated with ITS group, not the left BIND.
    expect(
      await pop(
        `BIND("bug" AS ?k) { ?s exo:Asset_label ?l3 . FILTER(EXISTS { ?s exo:Asset_aliases ?al . FILTER(CONTAINS(LCASE(STR(?al)), ?k)) }) }`,
      ),
    ).toBe(0);
  });

  it("T1 a term-test function over an unbound variable is an error — !isLiteral / !isIRI / sameTerm drop the row", async () => {
    expect(await pop(`FILTER(!isLiteral(?nope))`)).toBe(0);
    expect(await pop(`FILTER(!isIRI(?nope))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(?nope1, ?nope2))`)).toBe(0);
    // Control: over a bound variable the tests answer.
    expect(await pop(`FILTER(isLiteral(?l))`)).toBe(POP);
    expect(await pop(`FILTER(!isIRI(?l))`)).toBe(POP);
  });

  it("T1b an UNBOUND non-variable argument of a term-test function is an error too", async () => {
    expect(await pop(`FILTER(!isLiteral(COALESCE(?nope)))`)).toBe(0);
    expect(
      await pop(`FILTER(sameTerm(COALESCE(?nope1), COALESCE(?nope2)))`),
    ).toBe(0);
    // Control: a bound value through the same wrapper.
    expect(await pop(`FILTER(isLiteral(COALESCE(?l)))`)).toBe(POP);
  });

  it("T2 no regression: `!BOUND(?x) || isLiteral(?x)` over an OPTIONAL keeps every row", async () => {
    expect(
      await pop(
        `OPTIONAL { ?s exo:Asset_nothing ?x } FILTER(!BOUND(?x) || isLiteral(?x))`,
      ),
    ).toBe(POP);
    expect(
      await pop(
        `OPTIONAL { ?s exo:Asset_aliases ?x } FILTER(!BOUND(?x) || isLiteral(?x))`,
      ),
    ).toBe(POP);
  });

  it("I1 a term-test function over an IRI substituted into a join operand or an EXISTS filter answers — the row is kept", async () => {
    // EXISTS / a bind join substitute the bound ?s as an `{ type: "iri" }` node; once
    // non-variable arguments are evaluated (S1), that node must evaluate to the IRI —
    // on the pre-fix engine these answered only by accident (an `undefined` argument).
    const J = `?s exo:Asset_label ?l3`;
    expect(await pop(`{ ${J} FILTER(!isLiteral(?s)) }`)).toBe(POP);
    expect(await pop(`{ ${J} FILTER(!isBlank(?s)) }`)).toBe(POP);
    expect(await pop(`{ ${J} FILTER(sameTerm(?s, ?s)) }`)).toBe(POP);
    expect(await pop(`FILTER(EXISTS { ${J} FILTER(!isLiteral(?s)) })`)).toBe(
      POP,
    );
    // Negative half: the IRI is not a literal.
    expect(await pop(`FILTER(EXISTS { ${J} FILTER(isLiteral(?s)) })`)).toBe(0);
  });

  it("I2 side effect: a substituted IRI evaluates in any expression — isIRI, STR, comparison (the symptom of ems__Bug 4e3ce943)", async () => {
    const J = `?s exo:Asset_label ?l3`;
    expect(await pop(`FILTER(EXISTS { ${J} FILTER(isIRI(?s)) })`)).toBe(POP);
    expect(
      await pop(
        `FILTER(EXISTS { ${J} FILTER(STRSTARTS(STR(?s), "obsidian://")) })`,
      ),
    ).toBe(POP);
    expect(await pop(`FILTER(EXISTS { ${J} FILTER(?s = ?s) })`)).toBe(POP);
  });

  it("U9 GROUP BY with MIN / MAX / SAMPLE over a FILTER that keeps no row does not fail the query", async () => {
    // A NamedQuery run without its parameter now keeps no rows (U1) — the empty
    // input must not turn into "Literal value cannot be empty". ⛔ The row count is
    // NOT pinned: one row instead of zero groups is ems__Bug f7105304 item 4.
    for (const agg of ["MAX", "MIN", "SAMPLE"]) {
      const rows = await run(`SELECT ?s (${agg}(?l) AS ?m) WHERE { ${BUGS_WHERE}
        FILTER(CONTAINS(?l, ?nope)) } GROUP BY ?s`);
      expect(rows.filter((r) => r.has("m"))).toHaveLength(0);
      expect(() => rows.map((r) => r.toJSON())).not.toThrow();
    }
  });

  it("L1 a string bound by BIND reaches a LATERAL subquery's filter (correlated, §18.6)", async () => {
    const lateral = (k: string) =>
      `BIND("${k}" AS ?k) LATERAL { SELECT ?s WHERE { ?s exo:Asset_aliases ?al .
        FILTER(CONTAINS(LCASE(STR(?al)), ?k)) } }`;
    expect(await pop(lateral("bug"))).toBe(LABEL_HAS_BUG);
    expect(await pop(lateral("zzqq"))).toBe(0);
  });
});
