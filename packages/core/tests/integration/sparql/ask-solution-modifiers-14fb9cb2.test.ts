/**
 * Production-shape integration test: ASK honours its solution modifiers —
 * GROUP BY / HAVING and LIMIT / OFFSET (SPARQL 1.1 §16.3, §18.2.4) — on every
 * path that executes an ASK (vault-exodev ems__Bug 14fb9cb2).
 *
 * ## The defect
 *
 * `ExoQLAlgebraTranslator.translateAsk` built `{ type: "ask", where }` from the
 * WHERE patterns only and dropped every modifier the parser had read, so
 * `ASK {…} LIMIT 0` answered `true`, `OFFSET N` past the last solution answered
 * `true`, `HAVING` never filtered a group, and an implicit group (HAVING without
 * GROUP BY) over an EMPTY WHERE answered `false` instead of `true`.
 *
 * The fix wraps WHERE the way `translateSelect` does — Group (with HAVING) first,
 * Slice last — and leaves ORDER BY out: it reorders, it never removes a solution.
 *
 * ## The paths under test
 *
 * Every ASK path goes through `ExoQLAlgebraTranslator.translate`:
 * the engine (`executeAsk`), a button precondition (`PreconditionEvaluator`),
 * `run-query` (`evaluateWithExoEval`), the public `ExoQL.ask`, and the plugin's
 * `SPARQLQueryService` (translate → `AlgebraOptimizer.optimize` → `executeAsk`).
 * The store is built by the REAL `NoteToRDFConverter` over fixture notes.
 *
 * Revert-verify: `ask-solution-modifiers-14fb9cb2.spec.json` removes one
 * guarantee per mutant and names the axes that must turn red. Axes C1–C3 are
 * controls, green on the pre-fix engine by construction.
 *
 * Not asserted here, on purpose: the grouping step is the one SELECT uses, and
 * its own gaps (ems__Bug 2653916f — phantom group over an empty input under
 * GROUP BY, HAVING without an aggregate, an aggregate in ORDER BY, EXISTS in
 * HAVING; GROUP BY by expression — ems__Bug 38328fcc) are that bug's axes. The
 * differential A12 keeps ASK equal to SELECT, so fixing them there fixes both.
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

let seq = 0;
const uid = () =>
  `14fb9cb2-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

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
// pattern there are 3 solutions but 2 groups: an axis can tell "grouped" from
// "not grouped" and "Group then Slice" from "Slice then Group".
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
/** Three solutions, two groups by ?s: "Asset One" has two aliases. */
const WA = `{ ?s exo:Instance_class ems:Bug . ?s exo:Asset_aliases ?a . }`;
/** No solution. */
const W0 = `{ ?s exo:Instance_class ems:Bug . ?s exo:Asset_label "No such bug" . }`;

const translate = (sparql: string): AlgebraOperation =>
  new ExoQLAlgebraTranslator().translate(new SPARQLParser().parse(q(sparql)));

/** The engine path: parse → translate → executeAsk. */
const ask = (sparql: string): Promise<boolean> =>
  new ExoQLQueryExecutor(store).executeAsk(translate(sparql) as AskOperation);

const select = (sparql: string) =>
  new ExoQLQueryExecutor(store).executeAll(translate(sparql));

/**
 * The plugin's `SPARQLQueryService` keeps ONE translator and ONE optimizer for
 * its lifetime, so the plugin path reuses them across every query of the file —
 * per-call state leaking between queries shows up here (A17 too).
 */
const pluginTranslator = new ExoQLAlgebraTranslator();
const pluginOptimizer = new AlgebraOptimizer();

/**
 * The four other ASK paths, each called the way production calls it. The key is
 * the axis suffix (A11a…A11d, A18a…A18d): the driver names the path that went red.
 */
const PATHS: Record<string, (sparql: string) => Promise<boolean>> = {
  // button precondition (inline sparqlAsk) — compile, JSON round-trip, executeAsk
  precondition: (sparql) =>
    new PreconditionEvaluator(store).evaluate(
      { id: "p-14fb9cb2", label: "probe", sparqlAsk: q(sparql) },
      "obsidian://vault/target.md",
    ),
  // run-query — evaluateWithExoEval
  runQuery: async (sparql) => {
    const r = await evaluateWithExoEval(q(sparql), { store });
    if (r.kind !== "ask") throw new Error(`run-query returned ${r.kind}`);
    return r.result;
  },
  // public ExoQL API
  exoql: (sparql) => ExoQL.ask(q(sparql), store),
  // plugin SPARQLQueryService.ask — the SAME translator and optimizer every call
  plugin: (sparql) => {
    const algebra = pluginOptimizer.optimize(
      pluginTranslator.translate(new SPARQLParser().parse(q(sparql))),
    );
    return new ExoQLQueryExecutor(store).executeAsk(algebra as AskOperation);
  },
};

/** Axis suffix per path: "precondition" → "a", …, "plugin" → "d". */
const PATH_AXES: Array<[string, string]> = Object.keys(PATHS).map((p, i) => [
  String.fromCharCode(97 + i),
  p,
]);

const nodeTypes = (op: unknown, acc: string[] = []): string[] => {
  if (op && typeof op === "object") {
    const t = (op as { type?: unknown }).type;
    if (typeof t === "string") acc.push(t);
    for (const v of Object.values(op as Record<string, unknown>)) nodeTypes(v, acc);
  }
  return acc;
};

describe("ASK solution modifiers (ems__Bug 14fb9cb2)", () => {
  // ------------------------------------------------------------ controls
  it("C1 population: W has 2 solutions, WA 3 solutions in 2 groups, W0 none", async () => {
    expect(await select(`SELECT ?l WHERE ${W}`)).toHaveLength(2);
    expect(await select(`SELECT ?a WHERE ${WA}`)).toHaveLength(3);
    expect(await select(`SELECT ?s WHERE ${WA} GROUP BY ?s`)).toHaveLength(2);
    expect(await select(`SELECT ?l WHERE ${W0}`)).toHaveLength(0);
  });

  it("C2 canaries: ASK without modifiers — true on a match, false without, ASK {} true", async () => {
    expect(await ask(`ASK ${W}`)).toBe(true);
    expect(await ask(`ASK ${W0}`)).toBe(false);
    expect(await ask(`ASK {}`)).toBe(true);
  });

  it("C3 modifiers that keep a solution stay true: OFFSET 1, LIMIT 1, GROUP BY, HAVING that holds", async () => {
    expect(await ask(`ASK ${W} OFFSET 1`)).toBe(true);
    expect(await ask(`ASK ${W} LIMIT 1`)).toBe(true);
    expect(await ask(`ASK ${W} ORDER BY DESC(?l) OFFSET 1`)).toBe(true);
    expect(await ask(`ASK ${WA} GROUP BY ?s`)).toBe(true);
    expect(await ask(`ASK ${WA} GROUP BY ?s HAVING (COUNT(?a) = 2)`)).toBe(true);
  });

  // ------------------------------------------------------------ LIMIT / OFFSET
  it("A1 LIMIT 0 answers false", async () => {
    expect(await ask(`ASK ${W} LIMIT 0`)).toBe(false);
    expect(await ask(`ASK ${W} ORDER BY ?l LIMIT 0`)).toBe(false);
  });

  it("A2 OFFSET at or past the last solution answers false (OFFSET 2 of 2, OFFSET 5)", async () => {
    expect(await ask(`ASK ${W} OFFSET 2`)).toBe(false);
    expect(await ask(`ASK ${W} OFFSET 5`)).toBe(false);
  });

  it("A3 LIMIT 0 with an OFFSET answers false", async () => {
    expect(await ask(`ASK ${W} LIMIT 0 OFFSET 1`)).toBe(false);
  });

  it("A4 the empty pattern with LIMIT 0 answers false", async () => {
    expect(await ask(`ASK {} LIMIT 0`)).toBe(false);
  });

  // ------------------------------------------------------------ GROUP BY / HAVING
  it("A5 HAVING that no group satisfies answers false", async () => {
    expect(await ask(`ASK ${WA} GROUP BY ?s HAVING (COUNT(?a) > 5)`)).toBe(false);
  });

  it("A6 OFFSET counts GROUPS, not solutions: 2 groups, OFFSET 2 false, OFFSET 1 true", async () => {
    expect(await ask(`ASK ${WA} GROUP BY ?s OFFSET 2`)).toBe(false);
    expect(await ask(`ASK ${WA} GROUP BY ?s OFFSET 1`)).toBe(true);
  });

  it("A7 LIMIT applies after HAVING: the one group with 2 aliases survives LIMIT 1", async () => {
    expect(await ask(`ASK ${WA} GROUP BY ?s HAVING (COUNT(?a) = 2) LIMIT 1`)).toBe(true);
  });

  it("A8 HAVING without GROUP BY is one implicit group: COUNT(*) = 2 true, = 3 false", async () => {
    expect(await ask(`ASK ${W} HAVING (COUNT(*) = 2)`)).toBe(true);
    expect(await ask(`ASK ${W} HAVING (COUNT(*) = 3)`)).toBe(false);
  });

  it("A9 the implicit group exists over an EMPTY pattern: HAVING (COUNT(*) = 0) is true, as SELECT says", async () => {
    expect(await select(`SELECT (COUNT(*) AS ?n) WHERE ${W0}`)).toHaveLength(1);
    expect(await ask(`ASK ${W0} HAVING (COUNT(*) = 0)`)).toBe(true);
  });

  it("A13 HAVING applies BEFORE the slice: only the 2nd group passes COUNT = 1 — LIMIT 1 true, OFFSET 1 false", async () => {
    // Groups in order: "Asset One" (2 aliases), "Asset Two" (1). Slicing first
    // would keep "Asset One" alone and HAVING would then drop it.
    expect(await ask(`ASK ${WA} GROUP BY ?s HAVING (COUNT(?a) = 1) LIMIT 1`)).toBe(true);
    expect(await ask(`ASK ${WA} GROUP BY ?s HAVING (COUNT(?a) = 1) OFFSET 1`)).toBe(false);
  });

  it("A14 the empty pattern is ONE empty solution, grouped like any other: HAVING (COUNT(*) = 0) false, = 1 true", async () => {
    // No SELECT twin here: `SELECT … WHERE {}` is rejected by translateSelect.
    expect(await ask(`ASK {} HAVING (COUNT(*) = 0)`)).toBe(false);
    expect(await ask(`ASK {} HAVING (COUNT(*) = 1)`)).toBe(true);
  });

  it("A15 several HAVING constraints are a conjunction: (=2)(>1) true, (=2)(=3) false", async () => {
    expect(await ask(`ASK ${W} HAVING (COUNT(*) = 2) (COUNT(*) > 1)`)).toBe(true);
    expect(await ask(`ASK ${W} HAVING (COUNT(*) = 2) (COUNT(*) = 3)`)).toBe(false);
  });

  it("A15b the conjunction does not depend on the order: (=3)(=2) false", async () => {
    expect(await ask(`ASK ${W} HAVING (COUNT(*) = 3) (COUNT(*) = 2)`)).toBe(false);
  });

  it("A16 GROUP BY over two variables: (?s, ?a) gives 3 groups — OFFSET 2 true, OFFSET 3 false, COUNT = 2 false", async () => {
    expect(await ask(`ASK ${WA} GROUP BY ?s ?a OFFSET 2`)).toBe(true);
    expect(await ask(`ASK ${WA} GROUP BY ?s ?a OFFSET 3`)).toBe(false);
    expect(await ask(`ASK ${WA} GROUP BY ?s ?a HAVING (COUNT(*) = 2)`)).toBe(false);
  });

  it("A17 one translator reused across queries (as the plugin's SPARQLQueryService keeps it) answers like a fresh one", async () => {
    // A HAVING query first, then queries without modifiers: state left behind by
    // the first translation (aggregates, the aggregate map) must not reach them.
    const tr = new ExoQLAlgebraTranslator();
    const opt = new AlgebraOptimizer();
    const sequence: Array<[string, boolean]> = [
      [`ASK ${WA} GROUP BY ?s HAVING (COUNT(?a) > 5)`, false],
      [`ASK ${W0}`, false],
      [`ASK ${W0} GROUP BY ?s`, false],
      [`ASK ${W} OFFSET 2`, false],
      [`ASK ${W} HAVING (COUNT(*) = 2)`, true],
      [`ASK ${WA} GROUP BY ?s OFFSET 2`, false],
      [`ASK ${W0}`, false],
    ];
    const got: Array<[string, boolean]> = [];
    for (const [s] of sequence) {
      const alg = opt.optimize(tr.translate(new SPARQLParser().parse(q(s))));
      got.push([s, await new ExoQLQueryExecutor(store).executeAsk(alg as AskOperation)]);
    }
    expect(got).toEqual(sequence);
  });

  // ------------------------------------------------------------ ORDER BY (form)
  it("A10 ORDER BY is not translated for ASK — it reorders, never removes (no sort cost)", () => {
    const op = translate(`ASK ${W} ORDER BY ?l LIMIT 0`) as AskOperation;
    expect(op.type).toBe("ask");
    expect(op.where.type).toBe("slice");
    expect(nodeTypes(op)).not.toContain("orderby");
  });

  it("A19 an ASK WITHOUT modifiers translates as before: where is the pattern itself — no group, no slice", () => {
    // Every live button precondition has no modifier: their algebra must not change.
    const op = translate(`ASK ${W}`) as AskOperation;
    expect(op.type).toBe("ask");
    expect(nodeTypes(op.where)).not.toContain("slice");
    expect(nodeTypes(op.where)).not.toContain("group");
  });

  // ------------------------------------------------------------ every ASK path
  it.each(PATH_AXES)(
    "A11%s path %s: LIMIT 0 false, HAVING-unsatisfied false, canary true",
    async (_axis, path) => {
      const run = PATHS[path];
      expect(await run(`ASK ${W}`)).toBe(true);
      expect(await run(`ASK ${W} LIMIT 0`)).toBe(false);
      expect(await run(`ASK ${WA} GROUP BY ?s HAVING (COUNT(?a) > 5)`)).toBe(false);
    },
  );

  // A button precondition turns ANY error into `false` (fail-closed catch), so an
  // axis whose every assertion expects `false` cannot tell "honoured the modifier"
  // from "threw". These forms keep a solution: `true` is the only right answer.
  it.each(PATH_AXES)(
    "A18%s path %s: modifiers that KEEP a solution answer true (a throw is not a 'false')",
    async (_axis, path) => {
      const run = PATHS[path];
      expect(await run(`ASK ${W} LIMIT 1`)).toBe(true);
      expect(await run(`ASK ${W} OFFSET 1`)).toBe(true);
      expect(await run(`ASK ${WA} GROUP BY ?s HAVING (COUNT(?a) = 2)`)).toBe(true);
      expect(await run(`ASK ${W0} HAVING (COUNT(*) = 0)`)).toBe(true);
    },
  );

  // ------------------------------------------------------------ differential vs SELECT
  // ASK is true iff the SELECT with the same pattern and modifiers has a row.
  // The projection is chosen so the SELECT is valid with each modifier family.
  const FORMS: Array<{ where: string; mods: string; proj: string }> = [];
  for (const where of [W, WA, W0]) {
    const v = where === WA ? "?a" : "?l";
    for (const slice of ["", "LIMIT 0", "LIMIT 1", "OFFSET 1", "OFFSET 2", "OFFSET 3", "LIMIT 1 OFFSET 1", "LIMIT 0 OFFSET 1"]) {
      FORMS.push({ where, mods: slice, proj: v });
      FORMS.push({ where, mods: `GROUP BY ?s ${slice}`, proj: "?s" });
      FORMS.push({ where, mods: `GROUP BY ?s HAVING (COUNT(${v}) = 2) ${slice}`, proj: "?s" });
      FORMS.push({ where, mods: `GROUP BY ?s HAVING (COUNT(${v}) = 1) ${slice}`, proj: "?s" });
      FORMS.push({ where, mods: `GROUP BY ?s HAVING (COUNT(${v}) > 5) ${slice}`, proj: "?s" });
      FORMS.push({ where, mods: `HAVING (COUNT(*) = 0) ${slice}`, proj: "(COUNT(*) AS ?n)" });
      FORMS.push({ where, mods: `HAVING (COUNT(*) > 1) ${slice}`, proj: "(COUNT(*) AS ?n)" });
    }
  }

  it("A12 differential: ASK equals 'the SELECT has a row' on every form", async () => {
    const mismatches: string[] = [];
    for (const f of FORMS) {
      const a = await ask(`ASK ${f.where} ${f.mods}`);
      const rows = await select(`SELECT ${f.proj} WHERE ${f.where} ${f.mods}`);
      if (a !== rows.length > 0) {
        mismatches.push(`${f.where === W ? "W" : f.where === WA ? "WA" : "W0"} ${f.mods.trim()} → ASK ${a}, SELECT ${rows.length}`);
      }
    }
    expect(FORMS.length).toBeGreaterThanOrEqual(160);
    expect(mismatches).toEqual([]);
  });
});
