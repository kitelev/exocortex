/**
 * Production-shape integration test: MIN / MAX / SAMPLE answer one of the group's
 * values — the RDF term itself, with its datatype, language and IRI-ness (SPARQL 1.1
 * §18.5.1.5–§18.5.1.8) — vault-exodev ems__Bug 2e597cb5 and ems__Bug 03904911.
 *
 * ## The defect
 *
 * The aggregate read each value's text and built a NEW literal from the JS result:
 * a number became xsd:decimal (`"42"^^xsd:integer` → `"42"^^xsd:decimal`), anything
 * else xsd:string — a dateTime, an IRI, a language-tagged literal. A join back on the
 * result ("the latest of the group") then found nothing, `isIRI(MAX(?r))` was false,
 * `HAVING (sameTerm(MAX(?n), 42))` dropped the group. SAMPLE also ran parseFloat
 * over text — "2026-11-11 Сводка" → 2026, a uid "4ec049e2-…" → 4 — and answered a
 * lone space for a group without values. An expression that yields a term
 * (COALESCE(?n, 0)) was compared and returned as its N-Triples string.
 *
 * The fix: MIN / MAX / SAMPLE keep each value together with the term it came from;
 * MIN / MAX choose by the same comparison as before (numeric only if every value is
 * numeric, else lexical; a term an expression yields by its text, not its N-Triples
 * string), equal keys of different terms ordered by the term's N-Triples form; the
 * answer is the chosen term. A JS value (of a BIND or an expression) answers as before
 * — a number xsd:decimal, anything else its text in xsd:string; SAMPLE no longer
 * parses it; the empty string answers "" as BIND("") holds it. No values ⇒ unbound.
 *
 * Revert-verify: `group-term-aggregates-2e597cb5-*.spec.json` removes one guarantee
 * per mutant and names the axes that must turn red. K1–K8 are controls, green on the
 * pre-fix engine by construction; every G axis is red on it. G11 also guards a
 * plausible wrong implementation of the fix: the first of equal keys, which makes the
 * answer depend on the order the store yields solutions in.
 *
 * Not asserted here, on purpose — wrong before AND after this fix, another ticket's:
 * - the value of an expression is a JS primitive, so its exact type is unknown and it
 *   answers as before (K5): `MAX(?n + 1)` and `MIN(STRLEN(?l))` are xsd:decimal where
 *   SPARQL says xsd:integer, `MAX(BIND(true))` an xsd:string (ems__Bug 864dc82a);
 * - which value MIN / MAX choose across kinds (an IRI against a literal, "5" against
 *   5) is the engine's comparison, not SPARQL's ORDER BY order — unchanged here.
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
import { evaluateWithExoEval } from "../../../src/exoql/evaluateWithExoEval";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { BlankNode } from "../../../src/domain/models/rdf/BlankNode";
import type { AlgebraOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";

const XSD = "http://www.w3.org/2001/XMLSchema#";
const u = (n: number) => `2e597cb5-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (id: string, fm: IFrontmatter): FixtureNote => ({
  uid: id,
  frontmatter: { exo__Asset_uid: id, ...fm },
});

// ---------------------------------------------------------------- population
const CLS = u(0xc1a5);
const A = u(1);
const B = u(2);
const C = u(3);
const LBL_C = "2026-11-11 Сводка";
const NOTES: FixtureNote[] = [
  note(CLS, { exo__Asset_label: "stand__Thing" }),
  note(A, {
    exo__Asset_label: "Asset One",
    exo__Instance_class: `[[${CLS}]]`,
    stand__Thing_n: 42,
    stand__Thing_x: 4.5,
    stand__Thing_d: "2026-08-02T20:07:15",
    stand__Thing_ref: `[[${B}]]`,
    stand__Thing_grp: "g1",
  }),
  note(B, {
    exo__Asset_label: "Asset Two",
    exo__Instance_class: `[[${CLS}]]`,
    stand__Thing_n: 7,
    stand__Thing_d: "2026-11-11T09:00:00",
    stand__Thing_ref: `[[${A}]]`,
    stand__Thing_grp: "g1",
  }),
  note(C, { exo__Asset_label: LBL_C, exo__Instance_class: `[[${CLS}]]` }),
  // Equal numeric keys of different terms: 5 is "5"^^xsd:integer, "5" a simple literal.
  note(u(4), { exo__Asset_label: "Tie integer", stand__Thing_tie: 5 }),
  note(u(5), { exo__Asset_label: "Tie string", stand__Thing_tie: "5" }),
  // An Exo 0.0.3 statement whose object is a plain string: Exo003Parser.toTriple
  // stores it with the default language tag — "x"@ru.
  {
    uid: u(6),
    frontmatter: {
      metadata: "statement",
      subject: "https://example.org/s2e597cb5",
      predicate: "https://example.org/p2e597cb5",
      object: "x",
    },
  },
  // Two groups by ?grp2; numeric TEXT "10" / "9" (simple literals); a plain "abc".
  note(u(0x11), {
    exo__Asset_label: "E one",
    stand__Thing_grp2: "h1",
    stand__Thing_d2: "2026-01-01T00:00:00",
    stand__Thing_code: "10",
    stand__Thing_lt: "abc",
  }),
  note(u(0x12), { exo__Asset_label: "E two", stand__Thing_grp2: "h2", stand__Thing_d2: "2026-02-02T00:00:00", stand__Thing_code: "9" }),
  // "abc"@ru on the same predicate as the plain "abc": equal text, different terms.
  {
    uid: u(0x13),
    frontmatter: {
      metadata: "statement",
      subject: "https://example.org/sLt2e597cb5",
      predicate: "https://exocortex.my/ontology/stand#Thing_lt",
      object: "abc",
    },
  },
  // Exo 0.0.3 blank nodes: <file> owl:sameAs _:id.
  { uid: u(0x14), frontmatter: { metadata: "blank_node", uri: "_:bnone" } },
  { uid: u(0x15), frontmatter: { metadata: "blank_node", uri: "_:bntwo" } },
  // Stored simple literals (as vault text is kept — no datatype): pairs whose order differs
  // between text and N-Triples form ("Task" / "Task!") and between code unit and locale
  // ("apple" / "Banana"). ⛔ Not `…_case`: the parser reads `p:case` as the CASE keyword.
  note(u(0x16), { exo__Asset_label: "T one", stand__Thing_txt: "Task", stand__Thing_ab: "apple" }),
  note(u(0x17), { exo__Asset_label: "T two", stand__Thing_txt: "Task!", stand__Thing_ab: "Banana" }),
];
const IRI_A = `obsidian://vault/${A}.md`;
const IRI_B = `obsidian://vault/${B}.md`;

// ---------------------------------------------------------------- harness
function makeFile(id: string): IFile {
  return { path: `${id}.md`, basename: id, name: `${id}.md`, extension: "md", parent: null } as unknown as IFile;
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

let store: InMemoryTripleStore;
let triples: Triple[];
beforeAll(async () => {
  triples = await convertAll(NOTES);
  store = new InMemoryTripleStore();
  await store.addAll(triples);
});

const PREFIX = `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX st: <https://exocortex.my/ontology/stand#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`;
const q = (sparql: string) => `${PREFIX}\n${sparql}`;

/** The algebra `exocortex-cli query` executes: translated, then optimized. */
const plan = (sparql: string): AlgebraOperation =>
  new AlgebraOptimizer().optimize(new ExoQLAlgebraTranslator().translate(new SPARQLParser().parse(q(sparql))));
const runOn = (s: InMemoryTripleStore, sparql: string) => new ExoQLQueryExecutor(s).executeAll(plan(sparql));
const run = (sparql: string) => runOn(store, sparql);

/** The term bound to `v` in the only row of `sparql` — as [kind, text, datatype | @lang]. */
async function one(sparql: string, v = "m"): Promise<unknown> {
  const r = await run(sparql);
  expect(r).toHaveLength(1);
  return describeTerm(r[0].get(v));
}
function describeTerm(t: unknown): unknown {
  if (t === undefined) return "unbound";
  if (t instanceof IRI) return ["iri", t.value];
  if (t instanceof BlankNode) return ["bnode"];
  if (t instanceof Literal) {
    // The base direction is part of the term (RDF 1.2): "x"@ar--rtl ≠ "x"@ar (G20).
    if (t.language) return ["lit", t.value, `@${t.language}${t.direction ? `--${t.direction}` : ""}`];
    return ["lit", t.value, t.datatype ? t.datatype.value : `${XSD}string`];
  }
  return ["other", typeof t, String(t)];
}

const G = `?s exo:Instance_class ?c FILTER(CONTAINS(STR(?c), "c1a5") || STRENDS(STR(?c), "stand#Thing"))`;
const N = `?s st:Thing_n ?n`;
const RU = `?x <https://example.org/p2e597cb5> ?o`;
const int = (v: number) => ["lit", String(v), `${XSD}integer`];

const SUITE = "MIN / MAX / SAMPLE answer the group's term (ems__Bug 2e597cb5, ems__Bug 03904911)";

describe(SUITE, () => {
  // ------------------------------------------------------------- controls
  it("K1 population: three things; ?n is xsd:integer 42 and 7; ?d xsd:dateTime; ?ref IRIs; \"x\"@ru, two groups, numeric text, \"abc\" twice, two blank nodes", async () => {
    expect(await run(`SELECT ?s WHERE { ${G} }`)).toHaveLength(3);
    const n = await run(`SELECT ?n WHERE { ${N} } ORDER BY ?n`);
    expect(n.map((r) => describeTerm(r.get("n")))).toEqual([int(7), int(42)]);
    const d = await run(`SELECT ?d WHERE { ?s st:Thing_d ?d }`);
    expect(d.map((r) => (describeTerm(r.get("d")) as string[])[2])).toEqual([`${XSD}dateTime`, `${XSD}dateTime`]);
    expect((await run(`SELECT ?r WHERE { ?s st:Thing_ref ?r }`)).every((r) => r.get("r") instanceof IRI)).toBe(true);
    expect(await one(`SELECT ?o WHERE { ${RU} }`, "o")).toEqual(["lit", "x", "@ru"]);
    expect(await run(`SELECT ?g WHERE { ?x st:Thing_grp2 ?g }`)).toHaveLength(2);
    expect((await run(`SELECT ?c WHERE { ?x st:Thing_code ?c }`)).map((r) => describeTerm(r.get("c")))).toEqual(
      expect.arrayContaining([
        ["lit", "10", `${XSD}string`],
        ["lit", "9", `${XSD}string`],
      ]),
    );
    const lt = (await run(`SELECT ?t WHERE { ?x st:Thing_lt ?t }`)).map((r) => JSON.stringify(describeTerm(r.get("t"))));
    expect(lt.sort()).toEqual([JSON.stringify(["lit", "abc", "@ru"]), JSON.stringify(["lit", "abc", `${XSD}string`])].sort());
    expect((await run(`SELECT ?b WHERE { ?f owl:sameAs ?b }`)).map((r) => r.get("b") instanceof BlankNode)).toEqual([
      true,
      true,
    ]);
  });

  it("K2 COUNT / SUM / AVG / GROUP_CONCAT answer as before", async () => {
    const r = await run(
      `SELECT (COUNT(?n) AS ?c) (SUM(?n) AS ?su) (AVG(?n) AS ?a) (GROUP_CONCAT(?n; SEPARATOR=",") AS ?g) WHERE { ${N} }`,
    );
    expect(r).toHaveLength(1);
    expect(describeTerm(r[0].get("c"))).toEqual(int(2));
    expect(describeTerm(r[0].get("su"))).toEqual(["lit", "49", `${XSD}decimal`]);
    expect(describeTerm(r[0].get("a"))).toEqual(["lit", "24.5", `${XSD}decimal`]);
    expect((describeTerm(r[0].get("g")) as string[])[1].split(",").sort()).toEqual(["42", "7"]);
  });

  it("K3 MIN / MAX choose the same value as before — numeric when every value is numeric, else lexical", async () => {
    const text = async (sparql: string) => ((await one(sparql)) as string[])[1];
    expect(await text(`SELECT (MAX(?n) AS ?m) WHERE { ${N} }`)).toBe("42");
    expect(await text(`SELECT (MIN(?n) AS ?m) WHERE { ${N} }`)).toBe("7");
    expect(await text(`SELECT (MIN(?l) AS ?m) WHERE { ${G} ?s exo:Asset_label ?l }`)).toBe(LBL_C);
    expect(await text(`SELECT (MAX(?l) AS ?m) WHERE { ${G} ?s exo:Asset_label ?l }`)).toBe("Asset Two");
    expect(await text(`SELECT (MAX(?d) AS ?m) WHERE { ?s st:Thing_d ?d }`)).toBe("2026-11-11T09:00:00");
  });

  it("K4 MIN / MAX of a group without values stay unbound (ems__Bug 37c80e59)", async () => {
    const r = await run(
      `SELECT ?s (MIN(?nope) AS ?mi) (MAX(?nope) AS ?ma) WHERE { ${G} FILTER(?s = <${IRI_A}>) OPTIONAL { ?s st:Thing_nope ?nope } } GROUP BY ?s`,
    );
    expect(r).toHaveLength(1);
    expect([r[0].get("mi"), r[0].get("ma")]).toEqual([undefined, undefined]);
  });

  // ------------------------------------------------------------- the defect
  it("G1 MAX / MIN / SAMPLE over \"42\"^^xsd:integer answer xsd:integer, not xsd:decimal", async () => {
    expect(await one(`SELECT (MAX(?n) AS ?m) WHERE { ${N} }`)).toEqual(int(42));
    expect(await one(`SELECT (MIN(?n) AS ?m) WHERE { ${N} }`)).toEqual(int(7));
    expect(await one(`SELECT (SAMPLE(?n) AS ?m) WHERE { ${N} FILTER(?n > 10) }`)).toEqual(int(42));
    expect(await one(`SELECT (MAX(?x) AS ?m) WHERE { ?s st:Thing_x ?x }`)).toEqual(["lit", "4.5", `${XSD}decimal`]);
  });

  it("G2 the result's type is observable: DATATYPE in a subquery, sameTerm in HAVING", async () => {
    // DATATYPE(…) projects as the IRI's text (a value, not a term — ems__Bug 864dc82a).
    const d = (await one(`SELECT (DATATYPE(?m) AS ?d) WHERE { { SELECT (MAX(?n) AS ?m) WHERE { ${N} } } }`, "d")) as string[];
    expect(d[d.length - 1]).toBe(`${XSD}integer`);
    expect(await run(`SELECT (MAX(?n) AS ?m) WHERE { ${N} } HAVING (sameTerm(MAX(?n), 42))`)).toHaveLength(1);
    expect(await run(`SELECT (MAX(?n) AS ?m) WHERE { ${N} } HAVING (sameTerm(MAX(?n), 42.0))`)).toHaveLength(0);
  });

  it("G3 a dateTime stays xsd:dateTime — and \"the latest of the group\" joins back", async () => {
    expect(await one(`SELECT (MAX(?d) AS ?m) WHERE { ?s st:Thing_d ?d }`)).toEqual([
      "lit",
      "2026-11-11T09:00:00",
      `${XSD}dateTime`,
    ]);
    const r = await run(`SELECT ?s WHERE { { SELECT (MAX(?d) AS ?m) WHERE { ?t st:Thing_d ?d } } ?s st:Thing_d ?m }`);
    expect(r.map((x) => describeTerm(x.get("s")))).toEqual([["iri", IRI_B]]);
    const n = await run(`SELECT ?s WHERE { { SELECT (MAX(?n) AS ?m) WHERE { ?t st:Thing_n ?n } } ?s st:Thing_n ?m }`);
    expect(n.map((x) => describeTerm(x.get("s")))).toEqual([["iri", IRI_A]]);
  });

  it("G4 an IRI stays an IRI: isIRI(MAX(?r)), SAMPLE(?r), and the join back on it", async () => {
    const lo = IRI_A < IRI_B ? IRI_A : IRI_B;
    const hi = IRI_A < IRI_B ? IRI_B : IRI_A;
    expect(await one(`SELECT (MIN(?r) AS ?m) WHERE { ?s st:Thing_ref ?r }`)).toEqual(["iri", lo]);
    expect(await one(`SELECT (SAMPLE(?r) AS ?m) WHERE { <${IRI_A}> st:Thing_ref ?r }`)).toEqual(["iri", IRI_B]);
    expect(
      await run(`SELECT ?m WHERE { { SELECT (MAX(?r) AS ?m) WHERE { ?s st:Thing_ref ?r } } FILTER(isIRI(?m)) }`),
    ).toHaveLength(1);
    const r = await run(`SELECT ?s WHERE { { SELECT (MAX(?r) AS ?m) WHERE { ?t st:Thing_ref ?r } } ?s st:Thing_ref ?m }`);
    expect(r.map((x) => describeTerm(x.get("s")))).toEqual([["iri", hi === IRI_B ? IRI_A : IRI_B]]);
  });

  it("G5 SAMPLE does not parse numbers out of text (ems__Bug 03904911)", async () => {
    expect(
      await one(`SELECT (SAMPLE(?l) AS ?m) WHERE { ?s exo:Asset_label ?l FILTER(STRSTARTS(?l, "2026-11")) }`),
    ).toEqual(["lit", LBL_C, `${XSD}string`]);
    expect(await one(`SELECT (SAMPLE(?v) AS ?m) WHERE { ?s exo:Asset_uid ?v FILTER(?v = "${C}") }`)).toEqual([
      "lit",
      C,
      `${XSD}string`,
    ]);
    expect(await one(`SELECT (SAMPLE(?w) AS ?m) WHERE { BIND("2026-10-06T09:35" AS ?w) }`)).toEqual([
      "lit",
      "2026-10-06T09:35",
      `${XSD}string`,
    ]);
    expect(
      await one(`SELECT (SAMPLE(DISTINCT ?d) AS ?m) WHERE { ?s st:Thing_d ?d FILTER(?d > "2026-09") }`),
    ).toEqual(["lit", "2026-11-11T09:00:00", `${XSD}dateTime`]);
  });

  it("G6 SAMPLE of a group without values is unbound, not a lone space (ems__Bug 03904911)", async () => {
    const grouped = await run(
      `SELECT ?s (SAMPLE(?nope) AS ?m) WHERE { ${G} FILTER(?s = <${IRI_A}>) OPTIONAL { ?s st:Thing_nope ?nope } } GROUP BY ?s`,
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0].get("m")).toBeUndefined();
    expect(
      await one(`SELECT (SAMPLE(?nope) AS ?m) WHERE { ${G} OPTIONAL { ?s st:Thing_nope ?nope } }`),
    ).toBe("unbound");
  });

  it("G7 a language-tagged literal keeps its tag — the 0b24c745 forms", async () => {
    expect(await one(`SELECT (MAX(?o) AS ?m) WHERE { ${RU} }`)).toEqual(["lit", "x", "@ru"]);
    expect(await run(`SELECT ?x WHERE { ${RU} } GROUP BY ?x HAVING (SAMPLE(?o) = "x"@ru)`)).toHaveLength(1);
    expect(await run(`SELECT ?x WHERE { ${RU} } GROUP BY ?x HAVING (MIN(?o) = "x"@ru)`)).toHaveLength(1);
    expect(
      await run(`SELECT ?m WHERE { { SELECT (SAMPLE(?o) AS ?m) WHERE { ${RU} } } FILTER(?m = "x"@ru) }`),
    ).toHaveLength(1);
    expect(await run(`SELECT ?x WHERE { ${RU} } GROUP BY ?x HAVING (SAMPLE(?o) = "x")`)).toHaveLength(0);
  });

  it("G8 an expression that yields a term is compared by the term's value and answers the term — COALESCE, IF", async () => {
    expect(await one(`SELECT (MAX(COALESCE(?n, 0)) AS ?m) WHERE { ${N} }`)).toEqual(int(42));
    expect(await one(`SELECT (MIN(COALESCE(?n, 0)) AS ?m) WHERE { ${N} }`)).toEqual(int(7));
    expect(await one(`SELECT (MIN(IF(true, ?d, ?d)) AS ?m) WHERE { ?s st:Thing_d ?d }`)).toEqual([
      "lit",
      "2026-08-02T20:07:15",
      `${XSD}dateTime`,
    ]);
  });

  it("G13 a tagged constant yielded by an expression keeps its tag", async () => {
    expect(
      await one(`SELECT (SAMPLE(COALESCE(?nope, "x"@en)) AS ?m) WHERE { ${G} FILTER(?s = <${IRI_A}>) }`),
    ).toEqual(["lit", "x", "@en"]);
    expect(await one(`SELECT (MAX(IF(true, "x"@en, "y"@en)) AS ?m) WHERE { ${G} }`)).toEqual(["lit", "x", "@en"]);
  });

  it("K5 a BIND / expression value answers as before — a number xsd:decimal, else its text (ems__Bug 864dc82a)", async () => {
    const dec = (v: string) => ["lit", v, `${XSD}decimal`];
    // The shape of the stored "share by month" queries: a whole result of a division —
    // xsd:decimal by SPARQL — must not turn xsd:integer.
    expect(await one(`SELECT (MIN(ROUND(?n * 1000 / ?n) / 10) AS ?m) WHERE { ${N} }`)).toEqual(dec("100"));
    expect(await one(`SELECT (MAX(?n + 1) AS ?m) WHERE { ${N} }`)).toEqual(dec("43"));
    expect(
      await one(`SELECT (MIN(STRLEN(?l)) AS ?m) WHERE { ?s exo:Asset_label ?l FILTER(?l IN ("Asset One", "Asset Two")) }`),
    ).toEqual(dec("9"));
    expect(await one(`SELECT (MAX(?w) AS ?m) WHERE { BIND(4.5 AS ?w) }`)).toEqual(dec("4.5"));
    expect(await one(`SELECT (MAX(?w) AS ?m) WHERE { BIND(true AS ?w) }`)).toEqual(["lit", "true", `${XSD}string`]);
    expect(await one(`SELECT (MAX(?w) AS ?m) WHERE { BIND("2026-08-02" AS ?w) }`)).toEqual([
      "lit",
      "2026-08-02",
      `${XSD}string`,
    ]);
  });

  it("G10 an empty-string value answers \"\" — as BIND(\"\") holds it — and the query does not fail", async () => {
    expect(await one(`SELECT (MIN(?w) AS ?m) WHERE { BIND("" AS ?w) }`)).toEqual(["other", "string", ""]);
    expect(await one(`SELECT (SAMPLE(?w) AS ?m) WHERE { BIND("" AS ?w) }`)).toEqual(["other", "string", ""]);
  });

  it("G19 the empty string takes part in the choice: MIN of {\"\", \"x\"} is not \"x\", whatever the order", async () => {
    for (const order of ["1 2", "2 1"]) {
      const r = await run(
        `SELECT (MIN(?w) AS ?mi) (MAX(?w) AS ?ma) WHERE { VALUES ?k { ${order} } BIND(IF(?k = 1, "", "x") AS ?w) }`,
      );
      expect(r).toHaveLength(1);
      expect(describeTerm(r[0].get("mi"))).not.toEqual(["lit", "x", `${XSD}string`]);
      expect(describeTerm(r[0].get("ma"))).toEqual(["lit", "x", `${XSD}string`]);
    }
  });

  it("G11 equal keys of different terms give one answer, whatever order the solutions come in", async () => {
    const reversed = new InMemoryTripleStore();
    await reversed.addAll([...triples].reverse());
    const sparql = `SELECT (MIN(?t) AS ?mi) (MAX(?t) AS ?ma) WHERE { ?s st:Thing_tie ?t }`;
    const a = await runOn(store, sparql);
    const b = await runOn(reversed, sparql);
    const pair = (r: typeof a) => [describeTerm(r[0].get("mi")), describeTerm(r[0].get("ma"))];
    expect(pair(a)).toEqual(pair(b));
    // "5" (a simple literal) sorts before "5"^^xsd:integer in N-Triples form.
    expect(pair(a)).toEqual([
      ["lit", "5", `${XSD}string`],
      ["lit", "5", `${XSD}integer`],
    ]);
  });

  it("K6 numeric TEXT (simple literals \"10\" / \"9\") is still chosen numerically", async () => {
    const r = await run(`SELECT (MAX(?c) AS ?mx) (MIN(?c) AS ?mn) WHERE { ?x st:Thing_code ?c }`);
    expect([(r[0].get("mx") as Literal).value, (r[0].get("mn") as Literal).value]).toEqual(["10", "9"]);
  });

  it("K7 equal text of different terms (\"abc\" and \"abc\"@ru): one answer whatever the solution order", async () => {
    const reversed = new InMemoryTripleStore();
    await reversed.addAll([...triples].reverse());
    const sparql = `SELECT (MIN(?t) AS ?mi) (MAX(?t) AS ?ma) WHERE { ?x st:Thing_lt ?t }`;
    const pair = async (s: InMemoryTripleStore) => {
      const r = await runOn(s, sparql);
      return [describeTerm(r[0].get("mi")), describeTerm(r[0].get("ma"))];
    };
    expect(await pair(store)).toEqual(await pair(reversed));
  });

  it("K8 an evaluation error leaves the value out — the query does not fail", async () => {
    const r = await run(
      `SELECT (MAX(?l + 1) AS ?m) (COUNT(?l) AS ?c) WHERE { ?s exo:Instance_class ?k ; exo:Asset_label ?l }`,
    );
    expect(r).toHaveLength(1);
  });

  it("G14 several groups: each group answers its own term", async () => {
    const r = await run(
      `SELECT ?g (MAX(?d) AS ?mx) (MIN(?d) AS ?mn) (SAMPLE(?d) AS ?sa) WHERE { ?x st:Thing_grp2 ?g ; st:Thing_d2 ?d } GROUP BY ?g ORDER BY ?g`,
    );
    const dt = (v: string) => ["lit", v, `${XSD}dateTime`];
    expect(r.map((x) => [describeTerm(x.get("mx")), describeTerm(x.get("mn")), describeTerm(x.get("sa"))])).toEqual([
      [dt("2026-01-01T00:00:00"), dt("2026-01-01T00:00:00"), dt("2026-01-01T00:00:00")],
      [dt("2026-02-02T00:00:00"), dt("2026-02-02T00:00:00"), dt("2026-02-02T00:00:00")],
    ]);
  });

  it("G15 numeric TEXT answers the stored simple literal, not a decimal", async () => {
    expect(await one(`SELECT (MAX(?c) AS ?m) WHERE { ?x st:Thing_code ?c }`)).toEqual(["lit", "10", `${XSD}string`]);
  });

  it("G16 a blank node stays a blank node: SAMPLE, isBlank(MAX), the join back", async () => {
    expect(await one(`SELECT (SAMPLE(?b) AS ?m) WHERE { ?f owl:sameAs ?b }`)).toEqual(["bnode"]);
    expect(
      await run(`SELECT ?m WHERE { { SELECT (MAX(?b) AS ?m) WHERE { ?f owl:sameAs ?b } } FILTER(isBlank(?m)) }`),
    ).toHaveLength(1);
    expect(
      await run(`SELECT ?f WHERE { { SELECT (MIN(?b) AS ?m) WHERE { ?g owl:sameAs ?b } } ?f owl:sameAs ?m }`),
    ).toHaveLength(1);
  });

  it("G12 the run-query path (ExoEval) answers the same terms", async () => {
    const rq = await evaluateWithExoEval(
      q(`SELECT (MAX(?n) AS ?m) (SAMPLE(?l) AS ?s) WHERE { ?t st:Thing_n ?n . ?u exo:Asset_label ?l FILTER(STRSTARTS(?l, "2026-11")) }`),
      { store },
    );
    if (rq.kind !== "select") throw new Error(`run-query returned ${rq.kind}`);
    expect(rq.rows).toHaveLength(1);
    expect(describeTerm(rq.rows[0].get("m"))).toEqual(int(42));
    expect(describeTerm(rq.rows[0].get("s"))).toEqual(["lit", LBL_C, `${XSD}string`]);
  });

  // ---------------------------------------------- the choice is locked (spec review)
  // K9–K11 are controls: green on the pre-fix engine, because MIN / MAX pick the same value
  // there — only its type was wrong. They lock WHICH value is chosen, so a fix that
  // answers the right term for the wrong reason cannot pass.
  const chosen = async (values: string): Promise<string[]> => {
    const r = await run(`SELECT (MIN(?v) AS ?mi) (MAX(?v) AS ?ma) WHERE { VALUES ?v { ${values} } }`);
    expect(r).toHaveLength(1);
    return [(describeTerm(r[0].get("mi")) as string[])[1], (describeTerm(r[0].get("ma")) as string[])[1]];
  };
  const bothOrders = async (a: string, b: string): Promise<string[]> => {
    const ab = await chosen(`${a} ${b}`);
    expect(await chosen(`${b} ${a}`)).toEqual(ab);
    return ab;
  };

  it("K9 text with a numeric prefix is compared lexically — strict Number(), not parseFloat (ems__Bug 0c24668f)", async () => {
    // With the fix, equal years of two timestamps tie and the tie-break picks the right
    // term, so 0c24668f's own dateTime suite no longer sees parseFloat coming back. These
    // values do: parseFloat reads "10 tasks" as 10 and "4ec049e2-…" as 4.
    expect(await bothOrders(`"10 tasks"`, `"9 tasks"`)).toEqual(["10 tasks", "9 tasks"]);
    expect(await bothOrders(`"4ec049e2-aaaa"`, `"10ab0000-bbbb"`)).toEqual(["10ab0000-bbbb", "4ec049e2-aaaa"]);
    expect(await bothOrders(`3`, `"2026-01-01"^^xsd:date`)).toEqual(["2026-01-01", "3"]);
  });

  it("K10 the lexical choice compares the TEXT, not the N-Triples form", async () => {
    // N-Triples puts a closing quote after the text: "Task" vs "Task!" and "abc" vs "abc "
    // would swap, and an IRI (bare) would sort after a quoted literal.
    expect(await bothOrders(`"Task"`, `"Task!"`)).toEqual(["Task", "Task!"]);
    expect(await bothOrders(`"abc"`, `"abc "`)).toEqual(["abc", "abc "]);
    expect(await bothOrders(`<http://z.example/a>`, `"zebra"`)).toEqual(["http://z.example/a", "zebra"]);
  });

  it("K11 the lexical choice is by UTF-16 code unit, not by locale", async () => {
    expect(await bothOrders(`"apple"`, `"Banana"`)).toEqual(["Banana", "apple"]);
    const three = await chosen(`"Сводка" "Zeta" "ёлка"`);
    expect(await chosen(`"ёлка" "Zeta" "Сводка"`)).toEqual(three);
    expect(three).toEqual(["Zeta", "ёлка"]);
  });

  /** MIN / MAX texts over stored triples, in the store's order and in the reverse one. */
  const storedChoice = async (pattern: string): Promise<string[]> => {
    const reversed = new InMemoryTripleStore();
    await reversed.addAll([...triples].reverse());
    const sparql = `SELECT (MIN(?v) AS ?mi) (MAX(?v) AS ?ma) WHERE { ${pattern} }`;
    const texts = async (s: InMemoryTripleStore) => {
      const r = await runOn(s, sparql);
      expect(r).toHaveLength(1);
      return [describeTerm(r[0].get("mi")), describeTerm(r[0].get("ma"))].map((t) => (t as string[])[1]);
    };
    const a = await texts(store);
    expect(await texts(reversed)).toEqual(a);
    return a;
  };

  it("K12 a blank node against a literal is compared by its label, as before — not by an undefined key", async () => {
    // MIN is the blank node ("_:…" sorts before "abc"), MAX one of the two "abc" terms.
    const [mi, ma] = await storedChoice(`{ ?f owl:sameAs ?v } UNION { ?x st:Thing_lt ?v }`);
    expect(ma).toBe("abc");
    expect(mi).not.toBe("abc");
  });

  it("K13 stored simple literals: the lexical choice compares the TEXT, not the N-Triples form", async () => {
    expect(await storedChoice(`?x st:Thing_txt ?v`)).toEqual(["Task", "Task!"]);
  });

  it("K14 stored simple literals: the lexical choice is by UTF-16 code unit, not by locale", async () => {
    expect(await storedChoice(`?x st:Thing_ab ?v`)).toEqual(["Banana", "apple"]);
  });

  it("G20 a directional literal keeps its base direction (RDF 1.2)", async () => {
    const rtl = ["lit", "x", "@ar--rtl"];
    expect(await one(`SELECT (SAMPLE(?v) AS ?m) WHERE { BIND("x"@ar--rtl AS ?v) }`)).toEqual(rtl);
    expect(await one(`SELECT (MAX(?v) AS ?m) WHERE { BIND("x"@ar--rtl AS ?v) }`)).toEqual(rtl);
    expect(await one(`SELECT (SAMPLE(COALESCE(?nope, "x"@ar--rtl)) AS ?m) WHERE { ${G} FILTER(?s = <${IRI_A}>) }`)).toEqual(
      rtl,
    );
  });
});
