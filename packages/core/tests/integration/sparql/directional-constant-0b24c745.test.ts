/**
 * Production-shape integration test: a literal constant written in the query keeps
 * its language tag and its base direction — vault-exodev ems__Bug 0b24c745 (the
 * direction) and ems__Bug 97ebe042 (the language tag in `=` / LANG), fixed in one go
 * by the founder's decision of 2026-11-11.
 *
 * ## The defects
 *
 * - The direction `--rtl` / `--ltr` is cut from the query text before sparqljs
 *   parses it (`DirectionalLangTagTransformer`) into a map keyed by the LANGUAGE,
 *   and nothing hands that map to the translator: every constant lost its
 *   direction, so `sameTerm("x"@ar--rtl, "x"@ar)` was true (ems__Bug 0b24c745).
 * - A language-tagged constant evaluated to its bare text: `LANG("x"@en)` was "",
 *   a BIND dropped the tag (ems__Bug 97ebe042).
 * - `=` / `!=` compared literal VALUES only, ignoring the language tag of any
 *   literal, constant or stored: `"x"@en = "x"`, `"x"@en = "x"@de` and a stored
 *   `"x"@ru = "x"` were true (ems__Bug 97ebe042).
 *
 * ## The fix
 *
 * The parser rewrites `@ar--rtl` into a private-use subtag sparqljs accepts and,
 * after parsing, restores `language: "ar"` + `direction: "rtl"` on that very term;
 * the translators carry the term's own direction (the language map stays only as
 * the legacy API); a language-tagged constant evaluates to the language-tagged
 * Literal; `=` / `!=` against a language-tagged literal also compare the language
 * tag and the direction.
 *
 * Revert-verify: `directional-constant-0b24c745-*.spec.json` (one per subject file)
 * removes one guarantee per mutant and names the axes that must turn red. Axes
 * K1–K3 are controls, green on the pre-fix engine by construction; T2 guards
 * against the plausible wrong fix «apply the language map in expressions too».
 *
 * Not asserted here, on purpose — wrong before AND after, another ticket's subject:
 * - `VALUES ?v { "x"@en }` and a triple pattern with a language-tagged literal
 *   abort the query «Literal cannot have both datatype and language tag»
 *   (ems__Bug 7c6523b5; the triple-pattern twin in `BGPExecutor.toRDFTerm` waits
 *   for the founder's answer of 2026-11-11) — only the translation is asserted (T6, T21);
 * - `""@en` is a term the engine cannot build: it stays the JS string "" (`""@en =
 *   ""` is true);
 * - HASLANGDIR / STRLANGDIR / LANGDIR are not in the parser's grammar;
 * - an EXISTS in a function's arguments sends the call through the async
 *   evaluator, which wraps every argument as an untyped node (ems__Bug 67c8925f).
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
import type { AlgebraOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";

let seq = 0;
const uid = () =>
  `0b24c745-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (u: string, fm: IFrontmatter): FixtureNote => ({
  uid: u,
  frontmatter: { exo__Asset_uid: u, ...fm },
});

// ---------------------------------------------------------------- population
// Two bugs with plain labels; an Exo 0.0.3 statement whose object is a plain
// string — Exo003Parser.toTriple stores it with the default tag: "x"@ru.
const BUG_CLASS = uid();
const NOTES: FixtureNote[] = [
  note(BUG_CLASS, { exo__Asset_label: "ems__Bug" }),
  note(uid(), { exo__Asset_label: "Asset One", exo__Instance_class: `[[${BUG_CLASS}]]` }),
  note(uid(), { exo__Asset_label: "Asset Two", exo__Instance_class: `[[${BUG_CLASS}]]` }),
  ...Array.from({ length: 3 }, (_, i) => note(uid(), { exo__Asset_label: `Noise ${i}` })),
  {
    uid: uid(),
    frontmatter: {
      metadata: "statement",
      subject: "https://example.org/s0b24c745",
      predicate: "https://example.org/p0b24c745",
      object: "x",
    },
  },
];

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

let store: InMemoryTripleStore;
beforeAll(async () => {
  store = new InMemoryTripleStore();
  await store.addAll(await convertAll(NOTES));
});

const PREFIX = `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>`;
const q = (sparql: string) => `${PREFIX}\n${sparql}`;

/** The algebra `exocortex-cli query` executes: translated, then optimized. */
const translate = (sparql: string): AlgebraOperation =>
  new ExoQLAlgebraTranslator().translate(new SPARQLParser().parse(q(sparql)));
const plan = (sparql: string): AlgebraOperation => new AlgebraOptimizer().optimize(translate(sparql));
const run = (sparql: string) => new ExoQLQueryExecutor(store).executeAll(plan(sparql));

/** The two bugs, one label each. */
const W = `?s exo:Instance_class ems:Bug . ?s exo:Asset_label ?l .`;
/** The stored Exo 0.0.3 object "x"@ru. */
const R = `?r <https://example.org/p0b24c745> ?o .`;

/** Number of distinct solutions of ?s (or ?r) for which `extra` holds. */
const pop = async (extra: string, where = W, v = "?s"): Promise<number> =>
  (await run(`SELECT DISTINCT ${v} WHERE { ${where} ${extra} }`)).length;
const popR = (extra: string) => pop(extra, R, "?r");
/** Number of result rows of a whole query. */
const rows = async (sparql: string): Promise<number> => (await run(sparql)).length;

/** Every literal node of a plan, in traversal order. */
function literalNodes(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const x of node) literalNodes(x, out);
    return out;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "literal") out.push(rec);
  for (const k of Object.keys(rec)) literalNodes(rec[k], out);
  return out;
}

/** Every sparqljs Literal term of a parsed query. */
function sparqljsLiterals(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const x of node) sparqljsLiterals(x, out);
    return out;
  }
  const rec = node as Record<string, unknown>;
  if (rec.termType === "Literal") out.push(rec);
  for (const k of Object.keys(rec)) sparqljsLiterals(rec[k], out);
  return out;
}

const SUITE = "a query constant keeps its language tag and base direction (ems__Bug 0b24c745, 97ebe042)";

describe(SUITE, () => {
  // ------------------------------------------------------------- controls
  it("K1 population: two bugs; the stored Exo 0.0.3 object is \"x\"@ru", async () => {
    expect(await pop("")).toBe(2);
    expect(await popR("")).toBe(1);
    const o = (await run(`SELECT ?o WHERE { ${R} }`))[0].get("o") as Literal;
    expect(o).toBeInstanceOf(Literal);
    expect([o.value, o.language, o.direction]).toEqual(["x", "ru", undefined]);
  });

  it("K2 controls that were right before the fix stay right", async () => {
    expect(await pop(`FILTER(sameTerm("x"@ar--rtl, "x"@ar--rtl))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm("x"@AR--rtl, "x"@ar--rtl))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm("x"@ar--rtl, "y"@ar--rtl))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("x"@ar, "x"@en))`)).toBe(0);
    expect(await pop(`FILTER(?l = "Asset Two")`)).toBe(1);
    expect(await pop(`FILTER("x"@en = "x"@en)`)).toBe(2);
    expect(await pop(`FILTER(STR("x"@en) = "x")`)).toBe(2);
    expect(await popR(`FILTER(sameTerm(?o, "x"@ru))`)).toBe(1);
    expect(await popR(`FILTER(?o = "x"@ru)`)).toBe(1);
    expect(await popR(`FILTER(LANG(?o) = "ru")`)).toBe(1);
  });

  it("K3 string functions read the text of a tagged constant", async () => {
    expect(await pop(`FILTER(STRLEN("abc"@en) = 3)`)).toBe(2);
    expect(await pop(`FILTER(CONTAINS("abc"@en, "b"))`)).toBe(2);
    expect(await pop(`FILTER(STR("x"@ar--rtl) = "x")`)).toBe(2);
    expect(await pop(`FILTER(STR(UCASE("x"@en)) = "X")`)).toBe(2);
  });

  // ------------------------------------------------------------- direction (0b24c745)
  it("T1 the direction is part of the constant's term", async () => {
    expect(await pop(`FILTER(sameTerm("x"@ar--rtl, "x"@ar))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("x"@ar, "x"@ar--rtl))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("x"@ar--rtl, "x"@ar--ltr))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm("x"@en-US--ltr, "x"@en-us))`)).toBe(0);
    expect(await pop(`FILTER(!sameTerm("x"@ar--rtl, "x"@ar))`)).toBe(2);
  });

  it("T2 one constant's direction does not pass to another with the same language", async () => {
    expect(await pop(`FILTER(sameTerm("x"@ar--rtl, "x"@ar--rtl) && !sameTerm("y"@ar, "y"@ar--ltr))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm("y"@ar, "y"@ar) && !sameTerm("x"@ar--rtl, "x"@ar))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm("y"@ar--ltr, "y"@ar--ltr) && !sameTerm("x"@ar--rtl, "x"@ar--ltr))`)).toBe(2);
  });

  it("T3 every expression path — HAVING, EXISTS, BIND, SELECT expression", async () => {
    expect(
      await rows(`SELECT (COUNT(?l) AS ?c) WHERE { ${W} } HAVING (sameTerm("x"@ar--rtl, "x"@ar))`),
    ).toBe(0);
    expect(await pop(`FILTER EXISTS { FILTER(sameTerm("x"@ar--rtl, "x"@ar)) }`)).toBe(0);
    expect(await pop(`BIND(sameTerm("x"@ar--rtl, "x"@ar) AS ?b) FILTER(?b)`)).toBe(0);
    const r = await run(`SELECT (sameTerm("x"@ar--rtl, "x"@ar) AS ?b) WHERE { ${W} }`);
    expect(r.map((s) => s.get("b"))).toEqual([false, false]);
  });

  it("T4 a directional constant is not the stored literal without a direction", async () => {
    expect(await popR(`FILTER(sameTerm(?o, "x"@ru--rtl))`)).toBe(0);
    expect(await popR(`FILTER(?o = "x"@ru--rtl)`)).toBe(0);
    expect(await popR(`FILTER(?o = "x"@ru--ltr)`)).toBe(0);
  });

  it("T5 the parser gives each literal its own direction and gives string contents back verbatim", async () => {
    const parsed = new SPARQLParser().parse(
      q(`SELECT * WHERE { ${W} FILTER(sameTerm("x"@ar--rtl, "y"@ar) || sameTerm("a@ar--rtl", "z"@he--ltr)) }`),
    );
    const lits = literalNodes(translate(`SELECT * WHERE { ${W} FILTER(sameTerm("x"@ar--rtl, "y"@ar) || sameTerm("a@ar--rtl", "z"@he--ltr)) }`));
    expect(lits.map((l) => [l.value, l.language ?? null, l.direction ?? null])).toEqual([
      ["x", "ar", "rtl"],
      ["y", "ar", null],
      ["a@ar--rtl", null, null],
      ["z", "he", "ltr"],
    ]);
    expect(JSON.stringify(parsed)).not.toContain("exodir");
    expect(await pop(`FILTER(sameTerm("a@ar--rtl", "a@ar--rtl"))`)).toBe(2);
    // single quotes and long strings
    expect(await pop(`FILTER(sameTerm('x'@ar--rtl, 'x'@ar))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm('x'@ar--rtl, "x"@ar--rtl))`)).toBe(2);
    expect(await pop(`FILTER(sameTerm("""x"""@ar--rtl, "x"@ar--rtl) && !sameTerm('''x'''@ar--rtl, "x"@ar))`)).toBe(2);
    // a directional literal written INSIDE a string is that string's text
    const r = await run(`SELECT ?c WHERE { ${W} FILTER(?l = "Asset Two") BIND('a "x"@ar--rtl b' AS ?c) }`);
    expect(String(r[0].get("c"))).toBe('a "x"@ar--rtl b');
    // ORDER BY and a CONSTRUCT template are walked too
    const ordered = new SPARQLParser().parse(q(`SELECT ?l WHERE { ${W} } ORDER BY (sameTerm(?l, "z"@ar--rtl))`));
    const constructed = new SPARQLParser().parse(q(`CONSTRUCT { ?s <https://example.org/q> "z"@ar--rtl } WHERE { ${W} }`));
    for (const ast of [ordered, constructed]) {
      expect(sparqljsLiterals(ast).map((l) => [l.value, l.language, l.direction ?? null])).toEqual([["z", "ar", "rtl"]]);
    }
  });

  it("T6 VALUES carries each literal's own direction (translation)", () => {
    const values = literalNodes(translate(`SELECT * WHERE { VALUES ?v { "x"@ar--rtl "y"@ar } }`));
    expect(values.map((l) => [l.value, l.language ?? null, l.direction ?? null])).toEqual([
      ["x", "ar", "rtl"],
      ["y", "ar", null],
    ]);
  });

  // Split from T6 (specification, 11.11): the triple pattern and VALUES are translated
  // by different translators — one axis for both left their two mutants (TT1, PT1)
  // with one and the same red set.
  it("T21 a triple pattern carries each literal's own direction (translation)", () => {
    const triples = literalNodes(
      translate(`SELECT * WHERE { ?r <https://example.org/p0b24c745> "z"@ar--ltr . ?q <https://example.org/p0b24c745> "w"@ar }`),
    );
    expect(triples.map((l) => [l.value, l.language ?? null, l.direction ?? null])).toEqual([
      ["z", "ar", "ltr"],
      ["w", "ar", null],
    ]);
  });

  it("T12 an empty directional constant — a term the engine cannot build — keeps its direction", async () => {
    expect(await pop(`FILTER(sameTerm(""@ar--rtl, ""@ar))`)).toBe(0);
    expect(await pop(`FILTER(sameTerm(""@ar--rtl, ""@ar--rtl))`)).toBe(2);
  });

  it("T13 the async parser restores directions too", async () => {
    const ast = await new SPARQLParser().parseAsync(
      q(`SELECT * WHERE { ${W} FILTER(sameTerm("x"@ar--rtl, "y"@ar)) }`),
    );
    const lits = literalNodes(new ExoQLAlgebraTranslator().translate(ast));
    expect(lits.map((l) => [l.value, l.language ?? null, l.direction ?? null])).toEqual([
      ["x", "ar", "rtl"],
      ["y", "ar", null],
    ]);
  });

  // ------------------------------------------------------------- language tag (97ebe042)
  it("T7 `=` / IN compare the language tag of a constant", async () => {
    expect(await pop(`FILTER(?l = "Asset Two"@en)`)).toBe(0);
    expect(await pop(`FILTER("x"@en = "x")`)).toBe(0);
    expect(await pop(`FILTER("x"@en = "x"@de)`)).toBe(0);
    expect(await pop(`FILTER("x"@en IN ("x"))`)).toBe(0);
    expect(await pop(`FILTER("x"@EN = "x"@en)`)).toBe(2);
    expect(await pop(`FILTER("x"@ar--rtl = "x"@ar)`)).toBe(0);
    expect(await pop(`FILTER("x"@ar--rtl = "x"@ar--rtl)`)).toBe(2);
    expect(await pop(`FILTER("x"@ar--rtl = "x")`)).toBe(0);
    expect(await pop(`FILTER("x"@ar--ltr = "x"@ar)`)).toBe(0);
    expect(await pop(`FILTER("x"@ar--ltr = "x"@ar--ltr)`)).toBe(2);
  });

  it("T8 LANG, LANGMATCHES and DATATYPE see the constant's tag", async () => {
    expect(await pop(`FILTER(LANG("x"@en) = "en")`)).toBe(2);
    expect(await pop(`FILTER(LANGMATCHES(LANG("x"@en), "en"))`)).toBe(2);
    expect(await pop(`FILTER(DATATYPE("x"@en) = rdf:langString)`)).toBe(2);
    expect(await pop(`FILTER(LANG("x"@ar--rtl) = "ar")`)).toBe(2);
  });

  it("T9 `=` compares the language tag of a stored literal", async () => {
    expect(await popR(`FILTER(?o = "x")`)).toBe(0);
    expect(await popR(`FILTER(?o = "x"@en)`)).toBe(0);
  });

  it("T14 `!=` is the negation of `=` for a language-tagged literal", async () => {
    expect(await pop(`FILTER("x"@en != "x")`)).toBe(2);
    expect(await pop(`FILTER("x"@en != "x"@en)`)).toBe(0);
    expect(await popR(`FILTER(?o != "x")`)).toBe(1);
    expect(await popR(`FILTER(?o != "x"@ru)`)).toBe(0);
  });

  it("T10 BIND of a tagged constant keeps the tag and the direction", async () => {
    const r = await run(`SELECT ?c ?d WHERE { ${W} FILTER(?l = "Asset Two") BIND("x"@en AS ?c) BIND("y"@ar--rtl AS ?d) }`);
    const c = r[0].get("c") as Literal;
    const d = r[0].get("d") as Literal;
    expect(c).toBeInstanceOf(Literal);
    expect(d).toBeInstanceOf(Literal);
    expect([c.value, c.language, c.direction, d.value, d.language, d.direction]).toEqual([
      "x", "en", undefined, "y", "ar", "rtl",
    ]);
    expect(await pop(`BIND("x"@en AS ?x) FILTER(sameTerm(?x, "x"@en))`)).toBe(2);
    expect(await pop(`BIND("x"@ar--rtl AS ?x) FILTER(sameTerm(?x, "x"@ar))`)).toBe(0);
    const e = (await run(`SELECT ?e WHERE { ${W} FILTER(?l = "Asset Two") BIND("y"@ar--ltr AS ?e) }`))[0].get("e") as Literal;
    expect([e.language, e.direction]).toEqual(["ar", "ltr"]);
    expect(await pop(`BIND("x"@ar--ltr AS ?x) FILTER(sameTerm(?x, "x"@ar--ltr))`)).toBe(2);
  });

  it("T11 every path that evaluates a FILTER — precondition ASK and run-query", async () => {
    const pre = new PreconditionEvaluator(store);
    const askPre = (cond: string) =>
      pre.evaluate(
        { id: `p-0b24c745-${cond.length}-${cond.charCodeAt(cond.length - 2)}`, label: "probe", sparqlAsk: q(`ASK { ${W} FILTER(${cond}) }`) },
        "obsidian://vault/target.md",
      );
    expect(await askPre(`sameTerm("x"@ar--rtl, "x"@ar)`)).toBe(false);
    expect(await askPre(`LANG("x"@en) = "en"`)).toBe(true);
    const rq = await evaluateWithExoEval(q(`SELECT ?l WHERE { ${W} FILTER(sameTerm("x"@ar--rtl, "x"@ar--ltr)) }`), { store });
    if (rq.kind !== "select") throw new Error(`run-query returned ${rq.kind}`);
    expect(rq.rows.length).toBe(0);
  });

  it("T15 a bound tagged value substituted into an EXISTS filter keeps its direction", async () => {
    expect(await pop(`BIND("x"@ar--rtl AS ?x) FILTER EXISTS { FILTER(?x = "x"@ar--rtl) }`)).toBe(2);
    expect(await pop(`BIND("x"@ar--ltr AS ?x) FILTER EXISTS { FILTER(?x = "x"@ar--ltr) }`)).toBe(2);
    expect(await pop(`BIND("x"@ar--rtl AS ?x) FILTER EXISTS { FILTER(sameTerm(?x, "x"@ar)) }`)).toBe(0);
    expect(await pop(`BIND("x"@ar--rtl AS ?x) FILTER NOT EXISTS { FILTER(?x = "x"@ar--rtl) }`)).toBe(0);
  });

  // Split from T15 (specification, 11.11): a bound value matched against the store
  // needs the store's node key to carry the direction (InMemoryTripleStore) on top of
  // the substitution (QueryExecutor) — one axis for both left ST1 and QE1 inseparable.
  it("T22 a bound tagged value matched against the store keeps its direction", async () => {
    expect(await rows(`SELECT ?r WHERE { BIND("x"@ru--rtl AS ?o) ${R} }`)).toBe(0);
    expect(await rows(`SELECT ?r WHERE { BIND("x"@ru AS ?o) ${R} }`)).toBe(1);
    expect(await pop(`BIND("x"@ru--rtl AS ?c) FILTER EXISTS { ?r <https://example.org/p0b24c745> ?c }`)).toBe(0);
    expect(await pop(`BIND("x"@ru AS ?c) FILTER EXISTS { ?r <https://example.org/p0b24c745> ?c }`)).toBe(2);
  });

  it("T16 a string function keeps its first argument's language tag and direction", async () => {
    expect(await popR(`FILTER(LCASE(?o) = ?o)`)).toBe(1);
    expect(await popR(`FILTER(UCASE(?o) = "X"@ru)`)).toBe(1);
    expect(await popR(`FILTER(SUBSTR(?o, 1) = ?o)`)).toBe(1);
    expect(await popR(`FILTER(REPLACE(?o, "x", "x") = ?o)`)).toBe(1);
    expect(await popR(`FILTER(?o IN (LCASE(?o)))`)).toBe(1);
    expect(await popR(`FILTER(?o != LCASE(?o))`)).toBe(0);
    expect(await pop(`FILTER(UCASE("x"@en) = "X"@en)`)).toBe(2);
    expect(await pop(`FILTER(LCASE("X"@en) = "x"@en)`)).toBe(2);
    expect(await pop(`FILTER(SUBSTR("abc"@en, 2) = "bc"@en)`)).toBe(2);
    expect(await pop(`FILTER(STRAFTER("abc"@en, "a") = "bc"@en)`)).toBe(2);
    expect(await pop(`FILTER(STRBEFORE("abc"@en, "c") = "ab"@en)`)).toBe(2);
    expect(await pop(`FILTER(STRAFTER("abc"@en, "z") = "")`)).toBe(2);
    expect(await pop(`FILTER(UCASE("x"@ar--rtl) = "X"@ar--rtl)`)).toBe(2);
    expect(await pop(`FILTER(UCASE("x"@ar--rtl) = "X"@ar)`)).toBe(0);
  });

  it("T19 CONCAT keeps a language tag only when every argument carries the same one", async () => {
    expect(await popR(`FILTER(CONCAT(?o) = ?o)`)).toBe(1);
    expect(await pop(`FILTER(CONCAT("a"@en, "b"@en) = "ab"@en)`)).toBe(2);
    expect(await pop(`FILTER(CONCAT("a"@en, "b") = "ab")`)).toBe(2);
    expect(await pop(`FILTER(CONCAT("a"@en, "b"@de) = "ab")`)).toBe(2);
  });

  it("T20 CONCAT keeps a base direction only when every argument carries the same one", async () => {
    expect(await pop(`FILTER(CONCAT("a"@ar--rtl, "b"@ar--rtl) = "ab"@ar--rtl)`)).toBe(2);
    expect(await pop(`FILTER(CONCAT("a"@ar--rtl, "b"@ar) = "ab")`)).toBe(2);
  });

  it("T17 an aggregate over an expression yielding a tagged constant reads its text", async () => {
    const g = await run(`SELECT (GROUP_CONCAT(IF(true, "a"@en, "b"@en)) AS ?g) (SAMPLE(COALESCE(?u, "x"@en)) AS ?m) WHERE { ${W} }`);
    expect([(g[0].get("g") as Literal).value, (g[0].get("m") as Literal).value]).toEqual(["a a", "x"]);
  });

  it("T18 DATATYPE of a directional constant is rdf:dirLangString", async () => {
    expect(await pop(`FILTER(DATATYPE("x"@ar--rtl) = rdf:dirLangString)`)).toBe(2);
    expect(await pop(`FILTER(DATATYPE("x"@ar) = rdf:langString)`)).toBe(2);
  });

  // T23–T27 — independent review of the specification (11.11): each closes one plausible
  // wrong implementation that passed every axis above (named in the spec's `_note`).
  it("T23 SUBSTR with a length keeps its first argument's tag", async () => {
    expect(await popR(`FILTER(SUBSTR(?o, 1, 1) = ?o)`)).toBe(1);
    expect(await pop(`FILTER(SUBSTR("abc"@en, 2, 1) = "b"@en)`)).toBe(2);
  });

  it("T24 a plain constant on the LEFT of `=` / `!=` / IN against a tagged one", async () => {
    expect(await pop(`FILTER("x" = "x"@en)`)).toBe(0);
    expect(await pop(`FILTER("x" != "x"@en)`)).toBe(2);
    expect(await pop(`FILTER("x" IN ("x"@en))`)).toBe(0);
  });

  it("T25 <= and >= over language-tagged literals stay as they were", async () => {
    expect(await pop(`FILTER("x"@en <= "x"@en)`)).toBe(2);
    expect(await pop(`FILTER("x"@en >= "x"@en)`)).toBe(2);
  });

  it("T26 DATATYPE of an ltr constant is rdf:dirLangString too", async () => {
    expect(await pop(`FILTER(DATATYPE("x"@ar--ltr) = rdf:dirLangString)`)).toBe(2);
  });

  it("T27 every directional literal written inside one string is given back verbatim", async () => {
    const r = await run(`SELECT ?c WHERE { ${W} FILTER(?l = "Asset Two") BIND('a "x"@ar--rtl "y"@he--ltr b' AS ?c) }`);
    expect(String(r[0].get("c"))).toBe('a "x"@ar--rtl "y"@he--ltr b');
  });
});
