/**
 * Ticket 2588fa84 (RFC 308a52c3 «Загрузка по запросу», Д3) — the double-run oracle
 * `query --batch <file> --prune-oracle`, on a SYNTHETIC corpus over a temp vault read
 * by the REAL loader (full parse, the production converter configuration).
 *
 * The synthetic corpus carries the forms the live corpus (Ф1в) lacks — `exo:byUUID`
 * (a subject without `exo:Asset_uid`: the edge a statement materializes), a zero-length
 * path with both ends free (it pairs every node of the graph) — and the forms where the analyzer's skeleton changes the answer
 * under the PRODUCTION converter: a symbolic class as the subject of a hierarchy pattern
 * (the hierarchy lives on class FILE IRIs; the class bridge maps the symbolic class to it
 * through `rdfs:label`) and a sub-property chain under `exo:Asset_relates`. Membership
 * objects are symbolic under the production converter, so the membership bridge changes
 * no answer here — the live corpus shows the same. ASK is absent: CLI `query` does not
 * run it at all today («Unknown operation type: ask», single and batch alike).
 *
 * Axes (the FIRST token of each title — the mutant driver keys on it):
 *   O1.<k> per corpus entry: judged ⇒ `equal`; fail-safe ⇒ `full-load` with the analyzer's reason.
 *   O2  the oracle itself: 0 diverged, 0 failed, judged = every non-fail-safe entry; informative
 *       (non-empty) judged entries are counted apart.
 *   O3  non-vacuity: the class-bridge canary detects a break (on the hierarchy entry).
 *   O4  non-vacuity: the sub-property canary detects a break (on the sub-property entry).
 *   O5  full answers that differ between the two full runs ⇒ `unstable`, never `diverged`.
 *   O6  a cut that changes the answer ⇒ `diverged`, counts named, exit OPERATION_FAILED.
 *   O7  a cut run that THROWS while the full run answers ⇒ `diverged` (`cutError`), not `failed`.
 *   O8  no bound value or answer digest reaches stdout (privacy: private graphs).
 *   O8b no predicate IRI of the pruned set reaches stdout (only its size).
 *   O9  the result cache is never consulted: a warmed entry for the same text still executes.
 *   O10 compareAnswers: same list ⇒ equal; same multiset ⇒ order-only; else diverged.
 *   O11 `--prune-oracle` without `--batch` is refused before anything is loaded.
 *   O17 `--batch … --prune-oracle` dispatches to the oracle (oracle records, not answers).
 *   O12 the summary is the LAST line and counts every entry once.
 *   O13 a canary whose difference comes with an unstable full answer is `unstable`, not `detected`.
 *   O14 a predicate the query itself needs is never dropped by a canary (membership entry: `silent`).
 *   O15 an unstable entry is NOT judged (the denominator of «0 diverged» counts judged entries only).
 *   O16 compareAnswers counts the multiset difference on BOTH sides.
 *   O18–O21 the canonical row keeps every part of an answer: the bound value, a literal's
 *       datatype and language, an IRI, each position of a CONSTRUCT triple.
 *   O22 the analyzer reads the translator's algebra, not the optimized one (buildAlgebra once per entry).
 *   O23 `noOptimize` reaches the execution plan.
 *   O24 a canary that changes only the row ORDER is silent, not detected.
 *   O25 full answers that differ only in order are unstable too.
 *   O26 a cut run that times out is `cut-timeout` — not judged, not diverged, exit 0.
 *   O27 an UPDATE entry is refused as `query --batch` refuses it (`update-rejected`).
 *   O28 a full-load entry the product cannot run (DESCRIBE) is a failed entry.
 *   O9b the query result cache is never WRITTEN (positive control: `query --batch` writes it in the same home).
 *   O29 the reference full answer comes from the FULL graph: a cut that loses a row is not `equal`;
 *       O29b — the full re-run comes from the FULL graph too: that difference is not `unstable`
 *       (the stub keys on the graph SIZE, not on the call number).
 *   O30 a canary run that times out is `unstable`, not `detected`; O30b — a canary run that throws
 *       otherwise is `detected` (the main cut would be `diverged` with `cutError`, O7).
 *   O31 a failed full re-run (timeout) during a canary leaves the entry judged once, not `failed`;
 *       O31b — a failed full re-run after a differing cut makes the entry `unstable`, not `failed`.
 *   O32 a cut that changes only the row order, the full answer stable ⇒ `order-only`, exit 0.
 *   O33 `--timeout` reaches the oracle's runs; O34 `--use-cache` reaches its graph load.
 *   O36 the cut store is reused: [A, A'] (the same P') builds the cut once;
 *       O36b — only one is kept: [A, B, A] builds it three times (bounded memory).
 * `--no-optimize` has no wiring axis: the flag is dead product-wide (commander sets
 * `options.optimize`, the code reads `options.noOptimize` — bug 954c7dfa); the oracle wires it
 * exactly as `query --batch` does, so the axis lands with that fix.
 * O5–O9 run a PLAIN query (no skeleton in its P'), so an analyzer mutant does not reach them.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import os from "os";

const { sparqlQueryCommand, buildAlgebra, executeAlgebra } = await import("../../src/commands/sparql-query.js");
const oracle = await import("../../src/commands/query-prune-oracle.js");
const { QueryResultCache } = await import("../../src/cache/QueryResultCache.js");
const batchMod = await import("../../src/commands/query-batch.js");
const { ExitCodes } = await import("../../src/utils/ExitCodes.js");
const { QueryTimeoutError } = await import("../../src/utils/errors/index.js");
const core = await import("@kitelev/exocortex-core");

const PFX = [
  "PREFIX exo: <https://exocortex.my/ontology/exo#>",
  "PREFIX ems: <https://exocortex.my/ontology/ems#>",
  "PREFIX concept: <https://exocortex.my/ontology/concept#>",
  "PREFIX flow: <https://exocortex.my/ontology/flow#>",
  "PREFIX test: <https://exocortex.my/ontology/test#>",
  "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>",
].join("\n");

let seq = 0;
const uid = (): string => `2588fa84-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const C = { thing: uid(), device: uid(), gadget: uid() };
const P = { relates: uid(), related: uid(), deep: uid() };
const A = { i1: uid(), i3: uid(), a1: uid(), a2: uid(), a3: uid(), d1: uid(), f1: uid(), stmt: uid(), ghost: uid() };
/** A value only the fixture carries: it must never reach the oracle's stdout (O8). */
const SECRET = "SECRET-VALUE-2588fa84";

function noteText(fm: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${JSON.stringify(item)}`);
    } else {
      lines.push(`${k}: ${typeof v === "string" ? JSON.stringify(v) : String(v)}`);
    }
  }
  lines.push("---", "", "");
  return lines.join("\n");
}

const cls = (u: string, label: string, sup?: string): [string, Record<string, unknown>] => [
  u,
  {
    exo__Asset_uid: u,
    exo__Asset_label: label,
    aliases: [label],
    exo__Instance_class: ["[[exo__Class]]"],
    ...(sup ? { exo__Class_superClass: `[[${sup}]]` } : {}),
  },
];
const prop = (u: string, label: string, sup?: string): [string, Record<string, unknown>] => [
  u,
  {
    exo__Asset_uid: u,
    exo__Asset_label: label,
    aliases: [label],
    exo__Instance_class: ["[[exo__ObjectProperty]]"],
    ...(sup ? { exo__Property_superProperty: `[[${sup}]]` } : {}),
  },
];

const NOTES: Array<[string, Record<string, unknown>]> = [
  cls(C.thing, "test__Thing"),
  cls(C.device, "test__Device", C.thing),
  cls(C.gadget, "test__Gadget", C.device),
  prop(P.relates, "exo__Asset_relates"),
  prop(P.related, "concept__Concept_related", P.relates),
  prop(P.deep, "test__deep", P.related),
  // membership: a bare-UID link (symbolic object) and a LABEL-form link (class FILE IRI object)
  [A.i1, { exo__Asset_uid: A.i1, exo__Asset_label: "Gadget one", exo__Instance_class: [`[[${C.gadget}]]`], ems__Effort_status: SECRET }],
  [A.i3, { exo__Asset_uid: A.i3, exo__Asset_label: "Gadget three", exo__Instance_class: ["[[test__Gadget]]"] }],
  // sub-property edges under exo:Asset_relates (direct, child, grandchild)
  [A.a1, { exo__Asset_uid: A.a1, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Concept A", concept__Concept_related: `[[${A.a2}]]` }],
  [A.a2, { exo__Asset_uid: A.a2, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Concept B", ems__Effort_status: "doing" }],
  [A.a3, { exo__Asset_uid: A.a3, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Asset C", exo__Asset_relates: `[[${A.a2}]]` }],
  [A.d1, { exo__Asset_uid: A.d1, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Deep one", test__deep: `[[${A.a3}]]` }],
  [A.f1, { exo__Asset_uid: A.f1, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Flow item", flow__WorkItem_stage: `[[${A.a2}]]`, flow__WorkItem_note: "n1" }],
  // a statement materializes an edge whose SUBJECT has no file and no exo:Asset_uid —
  // exo:byUUID finds it by the subject IRI (the CLI loader skips a NOTE without the key)
  [A.stmt, { exo__Asset_uid: A.stmt, exo__Instance_class: ["[[exo__Statement]]"], exo__Asset_label: "Stmt", exo__Statement_subject: `[[${A.ghost}]]`, exo__Statement_predicate: "test__edge", exo__Statement_object: `[[${A.a2}]]` }],
];

/** The synthetic corpus — what CI judges. `expect` documents the verdict the analyzer gives today. */
const CORPUS: Array<{ name: string; sparql: string }> = [
  { name: "syn.sub-property", sparql: `${PFX}\nSELECT ?s ?o WHERE { ?s exo:Asset_relates ?o }` },
  // one level down: the closure of Concept_related is [test:deep] alone — its edge needs the declarations
  { name: "syn.sub-property-child", sparql: `${PFX}\nSELECT ?s ?o WHERE { ?s concept:Concept_related ?o }` },
  { name: "syn.bridge-membership", sparql: `${PFX}\nSELECT ?s WHERE { ?s exo:Instance_class test:Gadget }` },
  { name: "syn.bridge-hierarchy", sparql: `${PFX}\nSELECT ?p WHERE { test:Gadget exo:Class_superClass ?p }` },
  { name: "syn.namespace-filter", sparql: `${PFX}\nSELECT ?s ?p ?v WHERE { ?s ?p ?v . FILTER(CONTAINS(STR(?p), 'ontology/flow#')) }` },
  { name: "syn.optional-union", sparql: `${PFX}\nSELECT ?s ?l ?st WHERE { { ?s exo:Asset_label ?l } UNION { ?s flow:WorkItem_note ?l } OPTIONAL { ?s ems:Effort_status ?st } }` },
  { name: "syn.minus-exists", sparql: `${PFX}\nSELECT ?s WHERE { ?s exo:Asset_label ?l . MINUS { ?s ems:Effort_status "doing" } FILTER EXISTS { ?s exo:Asset_uid ?u } }` },
  { name: "syn.group-count", sparql: `${PFX}\nSELECT ?st (COUNT(?s) AS ?n) WHERE { ?s ems:Effort_status ?st } GROUP BY ?st ORDER BY ?st` },
  { name: "syn.subquery", sparql: `${PFX}\nSELECT ?s ?l WHERE { ?s exo:Asset_label ?l . { SELECT ?s WHERE { ?s exo:Asset_relates ?o } } }` },
  { name: "syn.construct", sparql: `${PFX}\nCONSTRUCT { ?s <urn:test:rel> ?o } WHERE { ?s exo:Asset_relates ?o }` },
  { name: "syn.const-subject-path", sparql: `${PFX}\nSELECT ?x WHERE { test:Gadget exo:Class_superClass* ?x }` },
  // fail-safe forms: the analyzer refuses to prune — a mutant that prunes them diverges
  { name: "syn.variable-predicate", sparql: `${PFX}\nSELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }` },
  // both ends free: a zero-length path pairs EVERY node of the graph with itself — the cut has fewer
  // nodes. Not a class-bridge predicate (that one is a full load for its own reason), no sub-properties;
  // towards a constant the engine returns the constant even when no triple names it — no divergence.
  { name: "syn.zero-length-free", sparql: `${PFX}\nSELECT (COUNT(*) AS ?n) WHERE { ?c flow:WorkItem_stage* ?x }` },
  { name: "syn.by-uuid", sparql: `${PFX}\nSELECT ?s WHERE { BIND(exo:byUUID("${A.ghost}") AS ?s) }` },
  // the filter sits in the OPTIONAL group, the variable predicate in the outer one (Ф1а PD16)
  { name: "syn.namespace-in-optional", sparql: `${PFX}\nSELECT * WHERE { ?s ?p ?v OPTIONAL { ?s flow:WorkItem_note ?w FILTER(CONTAINS(STR(?p), "ontology/flow#")) } }` },
  // the same filter in the SAME group as its variable predicate is a legal VL-3 cut
  { name: "syn.namespace-same-group", sparql: `${PFX}\nSELECT ?s ?v WHERE { ?s exo:Asset_label ?l . OPTIONAL { ?s ?p ?v . FILTER(CONTAINS(STR(?p), 'ontology/flow#')) } }` },
  // a predicate read ONLY inside FILTER EXISTS (separate from the MINUS entry: one walker per entry)
  { name: "syn.exists", sparql: `${PFX}\nSELECT ?s WHERE { ?s exo:Asset_label ?l . FILTER EXISTS { ?s flow:WorkItem_note ?n } }` },
  // a broken cut changes a VALUE, not the number of rows: one row either way
  { name: "syn.sub-property-count", sparql: `${PFX}\nSELECT (COUNT(?o) AS ?n) WHERE { ?s exo:Asset_relates ?o }` },
  { name: "syn.limit-one", sparql: `${PFX}\nSELECT ?s WHERE { ?s exo:Asset_relates ?o } ORDER BY ?s LIMIT 1` },
  // judged, but EMPTY: an equal empty answer says little — the summary counts the informative ones apart
  { name: "syn.empty", sparql: `${PFX}\nSELECT ?s WHERE { ?s exo:Asset_label "no such label 2588fa84" }` },
];
/** No skeleton in its P' — the axes on the oracle's own logic use it. */
const PLAIN = { name: "plain", sparql: `${PFX}\nSELECT ?s ?l WHERE { ?s exo:Asset_label ?l }` };

const FAIL_SAFE: Record<string, string> = {
  "syn.variable-predicate": "variable-predicate",
  "syn.zero-length-free": "zero-length-path-free-subject",
  "syn.by-uuid": "uuid-lookup",
  "syn.namespace-in-optional": "variable-predicate",
};
/** Judged entries: everything that is not a fail-safe form. A mutant that sends one to full load lowers it. */
const JUDGED_FLOOR = CORPUS.length - Object.keys(FAIL_SAFE).length;

let vaultDir: string;
let workDir: string;

function memorySink(): { lines: string[]; progress: string[]; sink: { write(l: string): Promise<void>; progress(m: string): void } } {
  const lines: string[] = [];
  const progress: string[] = [];
  return {
    lines,
    progress,
    sink: {
      write: async (l: string) => {
        lines.push(l);
      },
      progress: (m: string) => {
        progress.push(m);
      },
    },
  };
}

function batchFile(entries: unknown): string {
  const p = path.join(workDir, `batch-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(entries));
  return p;
}

type Rec = Record<string, any>;
async function runOracle(
  entries: unknown,
  overrides: Partial<Parameters<typeof oracle.runPruneOracleBatch>[1]> = {},
): Promise<{ records: Rec[]; summary: Rec; lines: string[]; exitCode: number | undefined }> {
  const mem = memorySink();
  const saved = process.exitCode;
  process.exitCode = undefined;
  try {
    await oracle.runPruneOracleBatch(
      batchFile(entries),
      {
        vault: vaultDir,
        useCache: false,
        timeoutMs: 30_000,
        noOptimize: false,
        buildAlgebra: buildAlgebra as never,
        executeAlgebra: executeAlgebra as never,
        ...overrides,
      },
      mem.sink,
    );
    const parsed = mem.lines.map((l) => JSON.parse(l) as Rec);
    return {
      records: parsed.filter((r) => r.type === "oracle"),
      summary: parsed[parsed.length - 1],
      lines: mem.lines,
      exitCode: process.exitCode as number | undefined,
    };
  } finally {
    process.exitCode = saved;
  }
}

let corpusRun: Awaited<ReturnType<typeof runOracle>>;

beforeAll(async () => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-2588fa84-vault-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-2588fa84-work-"));
  for (const [u, fm] of NOTES) fs.writeFileSync(path.join(vaultDir, `${u}.md`), noteText(fm));
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  corpusRun = await runOracle(CORPUS);
});

afterAll(() => {
  jest.restoreAllMocks();
  for (const d of [vaultDir, workDir]) fs.rmSync(d, { recursive: true, force: true });
});

const byName = (records: Rec[], name: string): Rec => {
  const r = records.find((x) => x.name === name);
  if (!r) throw new Error(`no record ${name}`);
  return r;
};

describe("query --batch --prune-oracle (ticket 2588fa84, RFC 308a52c3 Д3)", () => {
  it.each(CORPUS.map((e, k) => [k + 1, e.name] as const))("O1.%i @req:00390739-fb98-487c-af20-9a89be3046a2 %s — the entry's verdict", (_k, name) => {
    const r = byName(corpusRun.records, name);
    const reason = FAIL_SAFE[name];
    if (reason !== undefined) {
      expect([r.verdict, r.reasons]).toEqual(["full-load", expect.arrayContaining([reason])]);
    } else {
      expect([r.ok, r.verdict]).toEqual([true, "equal"]);
    }
  });

  it("O2 @req:00390739-fb98-487c-af20-9a89be3046a2 the oracle on the synthetic corpus: 0 diverged, 0 failed, every non-fail-safe entry judged", () => {
    const { summary } = corpusRun;
    expect([summary.diverged, summary.failed]).toEqual([0, 0]);
    expect(summary.judged).toBe(JUDGED_FLOOR);
    expect(summary.equal).toBe(summary.judged);
    const nonEmpty = corpusRun.records.filter((r) => r.mode === "prune" && r.verdict === "equal" && r.full.count > 0).length;
    expect([summary.judgedNonEmpty, summary.judged - summary.judgedNonEmpty]).toEqual([nonEmpty, 1]);
  });

  it("O3 @req:00390739-fb98-487c-af20-9a89be3046a2 non-vacuity: dropping the class-bridge skeleton is detected on ≥ 1 entry", () => {
    expect(corpusRun.summary.canary.classBridge.detected).toBeGreaterThanOrEqual(1);
    // ⛤ Under the PRODUCTION converter membership objects are symbolic even for a label-form
    // link, so the bridge changes no membership answer (the live corpus shows the same);
    // it does change a hierarchy pattern with a symbolic class subject.
    expect(byName(corpusRun.records, "syn.bridge-hierarchy").canary.classBridge).toBe("detected");
  });

  it("O4 @req:00390739-fb98-487c-af20-9a89be3046a2 non-vacuity: dropping the sub-property skeleton is detected on ≥ 1 entry", () => {
    expect(corpusRun.summary.canary.subProperty.detected).toBeGreaterThanOrEqual(1);
    expect(byName(corpusRun.records, "syn.sub-property").canary.subProperty).toBe("detected");
  });

  it("O5 @req:00390739-fb98-487c-af20-9a89be3046a2 full answers that differ between the two full runs ⇒ unstable, not diverged", async () => {
    let call = 0;
    const flaky = (async (store: never, algebra: never, t: number, s: number) => {
      const real = (await (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s)) as any;
      call += 1;
      // calls: full, cut, full again — the cut AND the second full run lose the rows
      return call >= 2 ? { kind: "select", results: [] } : real;
    }) as never;
    const run = await runOracle([PLAIN], { executeAlgebra: flaky });
    expect([run.records[0].verdict, run.summary.unstable, run.summary.diverged]).toEqual(["unstable", 1, 0]);
    expect(run.exitCode).toBe(ExitCodes.SUCCESS);
  });

  it("O15 @req:00390739-fb98-487c-af20-9a89be3046a2 an unstable entry is not judged", async () => {
    let call = 0;
    const flaky = (async (store: never, algebra: never, t: number, s: number) => {
      const real = (await (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s)) as any;
      call += 1;
      return call >= 2 ? { kind: "select", results: [] } : real;
    }) as never;
    const run = await runOracle([PLAIN], { executeAlgebra: flaky });
    expect([run.summary.judged, run.summary.equal + run.summary.orderOnly + run.summary.diverged]).toEqual([0, 0]);
  });

  it("O6 @req:00390739-fb98-487c-af20-9a89be3046a2 a cut that changes the answer ⇒ diverged, counts named, exit OPERATION_FAILED", async () => {
    let call = 0;
    const lossy = (async (store: never, algebra: never, t: number, s: number) => {
      const real = (await (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s)) as any;
      call += 1;
      return call === 2 ? { kind: "select", results: real.results.slice(1) } : real;
    }) as never;
    const run = await runOracle([PLAIN], { executeAlgebra: lossy });
    const r = run.records[0];
    expect([r.verdict, r.onlyFull, r.onlyCut]).toEqual(["diverged", 1, 0]);
    expect(run.summary.diverged).toBe(1);
    expect(run.exitCode).toBe(ExitCodes.OPERATION_FAILED);
  });

  it("O7 @req:00390739-fb98-487c-af20-9a89be3046a2 a cut run that throws while the full run answers ⇒ diverged (cutError), not failed", async () => {
    let call = 0;
    const throwing = (async (store: never, algebra: never, t: number, s: number) => {
      call += 1;
      if (call === 2) throw new Error("boom");
      return (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s);
    }) as never;
    const run = await runOracle([PLAIN], { executeAlgebra: throwing });
    expect([run.records[0].verdict, run.records[0].cutError, run.summary.failed]).toEqual(["diverged", "execution", 0]);
  });

  it("O8 @req:00390739-fb98-487c-af20-9a89be3046a2 no bound value or answer digest reaches stdout", () => {
    const text = corpusRun.lines.join("\n");
    expect(text.includes(SECRET)).toBe(false);
    expect(text.includes("Gadget one")).toBe(false);
    expect(text.includes("digest")).toBe(false);
    // the value IS in an answer the oracle compared (the canary that proves O8 can fail)
    const r = byName(corpusRun.records, "syn.optional-union");
    expect(r.full.count).toBeGreaterThan(0);
  });

  it("O8b @req:00390739-fb98-487c-af20-9a89be3046a2 no predicate IRI of the pruned set reaches stdout", () => {
    const text = corpusRun.lines.join("\n");
    expect(text.includes("Concept_related")).toBe(false);
    expect(text.includes("ontology/flow#")).toBe(false);
    // the predicates ARE in the pruned set the oracle cut by (the canary that proves O8b can fail)
    const r = byName(corpusRun.records, "syn.sub-property");
    expect(r.predicates).toBeGreaterThan(0);
  });

  it("O9 @req:00390739-fb98-487c-af20-9a89be3046a2 the query result cache is never consulted: a warmed entry for the same text still executes", async () => {
    // the cache lives under the home directory: a sandbox, never the user's real cache (ITRV §A137)
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "exo-2588fa84-home-"));
    jest.spyOn(os, "homedir").mockReturnValue(home);
    const cache = new QueryResultCache();
    await cache.set(PLAIN.sparql, { type: "select", count: 0, bindings: [] }, 300, null);
    try {
      const run = await runOracle([PLAIN]);
      expect([run.records[0].verdict, run.records[0].full.count > 0]).toEqual(["equal", true]);
    } finally {
      (os.homedir as unknown as { mockRestore(): void }).mockRestore();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("O9b @req:00390739-fb98-487c-af20-9a89be3046a2 the query result cache is never written (positive control: query --batch writes it in the same home)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "exo-2588fa84-home-"));
    jest.spyOn(os, "homedir").mockReturnValue(home);
    const dir = path.join(home, ".exocortex", "cache", "query-results");
    const written = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length : 0);
    const saved = process.exitCode;
    try {
      await runOracle([PLAIN]);
      const afterOracle = written();
      await batchMod.runSparqlBatch(
        batchFile([PLAIN]),
        {
          vault: vaultDir,
          useCache: false,
          useQueryResultCache: true,
          cacheTtlSeconds: 300,
          timeoutMs: 30_000,
          noOptimize: false,
          buildAlgebra: buildAlgebra as never,
          executeAlgebra: executeAlgebra as never,
        },
        memorySink().sink,
      );
      expect([afterOracle, written() > 0]).toEqual([0, true]);
    } finally {
      process.exitCode = saved;
      (os.homedir as unknown as { mockRestore(): void }).mockRestore();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("O10 @req:00390739-fb98-487c-af20-9a89be3046a2 compareAnswers: equal / order-only / diverged", () => {
    expect(oracle.compareAnswers(["a", "b"], ["a", "b"]).verdict).toBe("equal");
    expect(oracle.compareAnswers(["a", "b"], ["b", "a"]).verdict).toBe("order-only");
    expect(oracle.compareAnswers(["a"], ["c"]).verdict).toBe("diverged");
  });

  it("O16 @req:00390739-fb98-487c-af20-9a89be3046a2 compareAnswers counts the multiset difference on both sides", () => {
    expect(oracle.compareAnswers(["a", "a", "b"], ["a", "b", "c"])).toEqual({ verdict: "diverged", onlyReference: 1, onlyCandidate: 1 });
    expect(oracle.compareAnswers([], ["a", "a"])).toEqual({ verdict: "diverged", onlyReference: 0, onlyCandidate: 2 });
  });

  async function command(args: string[], vault: string = vaultDir): Promise<{ out: string[]; exitError: string | null }> {
    const out: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      out.push(String(chunk));
      const cb = rest.find((r) => typeof r === "function") as ((e?: Error | null) => void) | undefined;
      if (cb) cb(null);
      return true;
    }) as never);
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const saved = process.exitCode;
    try {
      await sparqlQueryCommand().parseAsync(["node", "query", ...args, "--vault", vault]);
      return { out, exitError: null };
    } catch (e) {
      return { out, exitError: (e as Error).message };
    } finally {
      writeSpy.mockRestore();
      exitSpy.mockRestore();
      process.exitCode = saved;
    }
  }

  it("O11 @req:00390739-fb98-487c-af20-9a89be3046a2 --prune-oracle without --batch is refused", async () => {
    const r = await command([PLAIN.sparql, "--prune-oracle"]);
    expect(r.exitError).toMatch(/^exit:/);
    expect(r.out.join("")).toBe("");
  });

  it("O17 @req:00390739-fb98-487c-af20-9a89be3046a2 --batch … --prune-oracle dispatches to the oracle", async () => {
    const r = await command(["--batch", batchFile([PLAIN]), "--prune-oracle"]);
    const types = r.out.join("").split("\n").filter((l) => l !== "").map((l) => (JSON.parse(l) as Rec).type);
    expect([r.exitError, types]).toEqual([null, ["oracle", "summary"]]);
  });

  const lastRecord = (out: string[]): Rec => {
    const lines = out.join("").split("\n").filter((l) => l !== "");
    return JSON.parse(lines[lines.length - 1]) as Rec;
  };

  it("O33 @req:00390739-fb98-487c-af20-9a89be3046a2 --timeout reaches the oracle's runs", async () => {
    const delays: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const spy = jest.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      delays.push(ms);
      return realSetTimeout(fn, ms, ...rest);
    }) as never);
    let r: Awaited<ReturnType<typeof command>>;
    try {
      r = await command(["--batch", batchFile([PLAIN]), "--prune-oracle", "--timeout", "4321ms"]);
    } finally {
      spy.mockRestore();
    }
    expect([r.exitError, lastRecord(r.out).judged, delays.filter((d) => d === 4321).length >= 2]).toEqual([null, 1, true]);
  });

  it("O34 @req:00390739-fb98-487c-af20-9a89be3046a2 --use-cache reaches the oracle's graph load", async () => {
    const v = fs.mkdtempSync(path.join(os.tmpdir(), "exo-2588fa84-cachevault-"));
    fs.cpSync(vaultDir, v, { recursive: true });
    try {
      const args = ["--batch", batchFile([PLAIN]), "--prune-oracle", "--use-cache"];
      const first = await command(args, v);
      const second = await command(args, v);
      expect([first.exitError, second.exitError, lastRecord(second.out).loadMode]).toEqual([null, null, "hit"]);
    } finally {
      fs.rmSync(v, { recursive: true, force: true });
    }
  });

  it("O13 @req:00390739-fb98-487c-af20-9a89be3046a2 a canary difference that comes with an unstable full answer is unstable, not detected", async () => {
    let call = 0;
    const clocky = (async (store: never, algebra: never, t: number, s: number) => {
      const real = (await (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s)) as any;
      call += 1;
      // calls: full, cut (equal), sub-property canary, full again — the last two lose the rows
      return call >= 3 ? { kind: "select", results: [] } : real;
    }) as never;
    const entry = CORPUS.find((e) => e.name === "syn.sub-property") as { name: string; sparql: string };
    const run = await runOracle([entry], { executeAlgebra: clocky });
    const r = run.records[0];
    expect([r.verdict, r.canary.subProperty, run.summary.canary.subProperty.detected]).toEqual(["equal", "unstable", 0]);
  });

  it("O14 @req:00390739-fb98-487c-af20-9a89be3046a2 a canary never drops a predicate the query itself needs: the membership entry stays silent", () => {
    const r = byName(corpusRun.records, "syn.bridge-membership");
    expect([r.verdict, r.canary.classBridge]).toEqual(["equal", "silent"]);
  });

  // ---- canonical form: a row keeps every part of the answer (review HIGH-1, W1–W4)
  const sol = (pairs: Record<string, unknown>) =>
    ({ kind: "select", results: [new core.SolutionMapping(new Map(Object.entries(pairs)) as never)] }) as never;
  const XSD = "http://www.w3.org/2001/XMLSchema#";

  it("O18 @req:00390739-fb98-487c-af20-9a89be3046a2 the bound value is part of the row", () => {
    const a = oracle.answerRows(sol({ n: new core.DomainLiteral("3", new core.DomainIRI(`${XSD}integer`)) }));
    const b = oracle.answerRows(sol({ n: new core.DomainLiteral("1", new core.DomainIRI(`${XSD}integer`)) }));
    expect(oracle.compareAnswers(a, b).verdict).toBe("diverged");
  });

  it("O19 @req:00390739-fb98-487c-af20-9a89be3046a2 a literal's datatype and language are part of the row", () => {
    const plain = oracle.answerRows(sol({ v: new core.DomainLiteral("5") }));
    const typed = oracle.answerRows(sol({ v: new core.DomainLiteral("5", new core.DomainIRI(`${XSD}integer`)) }));
    const tagged = oracle.answerRows(sol({ v: new core.DomainLiteral("5", undefined, "en") }));
    expect([oracle.compareAnswers(plain, typed).verdict, oracle.compareAnswers(plain, tagged).verdict]).toEqual(["diverged", "diverged"]);
  });

  it("O20 @req:00390739-fb98-487c-af20-9a89be3046a2 an IRI is part of the row", () => {
    const a = oracle.answerRows(sol({ s: new core.DomainIRI("https://example.org/a") }));
    const b = oracle.answerRows(sol({ s: new core.DomainIRI("https://example.org/b") }));
    expect(oracle.compareAnswers(a, b).verdict).toBe("diverged");
  });

  it("O21 @req:00390739-fb98-487c-af20-9a89be3046a2 every position of a CONSTRUCT triple is part of the row", () => {
    const T = (s: string, p: string, o: string) =>
      new core.DomainTriple(new core.DomainIRI(s), new core.DomainIRI(p), new core.DomainIRI(o));
    const rows = (t: unknown) => oracle.answerRows({ kind: "construct", triples: [t] } as never);
    const base = rows(T("urn:s", "urn:p", "urn:o"));
    expect(
      [rows(T("urn:x", "urn:p", "urn:o")), rows(T("urn:s", "urn:x", "urn:o")), rows(T("urn:s", "urn:p", "urn:x"))].map(
        (r) => oracle.compareAnswers(base, r).verdict,
      ),
    ).toEqual(["diverged", "diverged", "diverged"]);
  });

  it("O22 @req:00390739-fb98-487c-af20-9a89be3046a2 the analyzer reads the translator's algebra: buildAlgebra runs once per entry", async () => {
    let calls = 0;
    const counting = ((ast: never, noOptimize: boolean) => {
      calls += 1;
      return (buildAlgebra as (a: never, n: boolean) => unknown)(ast, noOptimize);
    }) as never;
    await runOracle([PLAIN, CORPUS[0]], { buildAlgebra: counting });
    expect(calls).toBe(2);
  });

  it("O23 @req:00390739-fb98-487c-af20-9a89be3046a2 noOptimize reaches the execution plan", async () => {
    const seen: boolean[] = [];
    const spy = ((ast: never, noOptimize: boolean) => {
      seen.push(noOptimize);
      return (buildAlgebra as (a: never, n: boolean) => unknown)(ast, noOptimize);
    }) as never;
    await runOracle([PLAIN], { buildAlgebra: spy, noOptimize: true });
    await runOracle([PLAIN], { buildAlgebra: spy, noOptimize: false });
    expect(seen).toEqual([true, false]);
  });

  const reversed = (real: any) =>
    real.kind === "select" ? { kind: "select", results: [...real.results].reverse() } : real;

  it("O24 @req:00390739-fb98-487c-af20-9a89be3046a2 a canary that changes only the row order is silent", async () => {
    let call = 0;
    const exec = (async (store: never, algebra: never, t: number, s: number) => {
      const real = (await (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s)) as any;
      call += 1;
      return call === 3 ? reversed(real) : real; // full, cut, class-bridge canary (really silent here — O14)
    }) as never;
    const entry = CORPUS.find((e) => e.name === "syn.bridge-membership") as { name: string; sparql: string };
    const run = await runOracle([entry], { executeAlgebra: exec });
    expect([run.records[0].verdict, run.records[0].canary.classBridge]).toEqual(["equal", "silent"]);
  });

  it("O25 @req:00390739-fb98-487c-af20-9a89be3046a2 full answers that differ only in order are unstable too", async () => {
    let call = 0;
    const exec = (async (store: never, algebra: never, t: number, s: number) => {
      const real = (await (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s)) as any;
      call += 1;
      return call >= 2 ? reversed(real) : real; // the cut and the second full run come in another order
    }) as never;
    const run = await runOracle([PLAIN], { executeAlgebra: exec });
    expect([run.records[0].verdict, run.summary.orderOnly]).toEqual(["unstable", 0]);
  });

  it("O32 @req:00390739-fb98-487c-af20-9a89be3046a2 a cut that changes only the row order, the full answer stable ⇒ order-only, exit 0", async () => {
    let call = 0;
    const exec = (async (store: never, algebra: never, t: number, s: number) => {
      const real = (await (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s)) as any;
      call += 1;
      return call === 2 ? reversed(real) : real; // full, cut (other order), full again (same order as the first)
    }) as never;
    const run = await runOracle([PLAIN], { executeAlgebra: exec });
    expect(run.records[0].full.count).toBeGreaterThan(1);
    expect([run.records[0].verdict, run.summary.orderOnly, run.summary.judged, run.exitCode]).toEqual([
      "order-only",
      1,
      1,
      ExitCodes.SUCCESS,
    ]);
  });

  it("O26 @req:00390739-fb98-487c-af20-9a89be3046a2 a cut run that times out is cut-timeout: not judged, not diverged, exit 0", async () => {
    let call = 0;
    const slow = (async (store: never, algebra: never, t: number, s: number) => {
      call += 1;
      if (call === 2) throw new QueryTimeoutError(t, t);
      return (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s);
    }) as never;
    const run = await runOracle([PLAIN], { executeAlgebra: slow });
    expect([run.records[0].verdict, run.summary.cutTimeout, run.summary.diverged, run.summary.judged]).toEqual(["cut-timeout", 1, 0, 0]);
    expect(run.exitCode).toBe(ExitCodes.SUCCESS);
  });

  // any run over a graph smaller than the full one loses one row — wherever the oracle runs it
  const bySize = () => {
    const fullSize = corpusRun.summary.triples as number;
    return (async (store: any, algebra: never, t: number, s: number) => {
      const real = (await (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s)) as any;
      return (await store.count()) < fullSize ? { kind: "select", results: real.results.slice(1) } : real;
    }) as never;
  };

  it("O29 @req:00390739-fb98-487c-af20-9a89be3046a2 the reference full answer comes from the full graph: a cut that loses a row is not equal", async () => {
    const run = await runOracle([PLAIN], { executeAlgebra: bySize() });
    expect(run.records[0].verdict).not.toBe("equal");
  });

  it("O29b @req:00390739-fb98-487c-af20-9a89be3046a2 the full re-run comes from the full graph too: that difference is not unstable", async () => {
    const run = await runOracle([PLAIN], { executeAlgebra: bySize() });
    expect([run.records[0].verdict === "unstable", run.summary.unstable]).toEqual([false, 0]);
  });

  const scripted = (plan: Record<number, "timeout" | "error" | "empty" | "lossy">) => {
    let call = 0;
    return (async (store: never, algebra: never, t: number, s: number) => {
      call += 1;
      const what = plan[call];
      if (what === "timeout") throw new QueryTimeoutError(t, t);
      if (what === "error") throw new Error("boom");
      const real = (await (executeAlgebra as (...a: unknown[]) => Promise<any>)(store, algebra, t, s)) as any;
      if (what === "empty") return { kind: "select", results: [] };
      if (what === "lossy") return { kind: "select", results: real.results.slice(1) };
      return real;
    }) as never;
  };
  const subPropertyEntry = () => CORPUS.find((e) => e.name === "syn.sub-property") as { name: string; sparql: string };
  const accounted = (s: Rec) => s.judged + s.unstable + s.cutTimeout + s.fullLoad + s.failed;

  it("O30 @req:00390739-fb98-487c-af20-9a89be3046a2 a canary run that times out is unstable, not detected", async () => {
    // calls on the sub-property entry: full, cut, sub-property canary (the class bridge is n/a here)
    const run = await runOracle([subPropertyEntry()], { executeAlgebra: scripted({ 3: "timeout" }) });
    const r = run.records[0];
    expect([r.verdict, r.canary.subProperty, run.summary.canary.subProperty.detected, run.summary.failed]).toEqual([
      "equal",
      "unstable",
      0,
      0,
    ]);
  });

  it("O30b @req:00390739-fb98-487c-af20-9a89be3046a2 a canary run that throws otherwise is detected (the main cut would be diverged, O7)", async () => {
    const run = await runOracle([subPropertyEntry()], { executeAlgebra: scripted({ 3: "error" }) });
    const r = run.records[0];
    expect([r.verdict, r.canary.subProperty, run.summary.canary.subProperty.detected]).toEqual(["equal", "detected", 1]);
  });

  it("O31 @req:00390739-fb98-487c-af20-9a89be3046a2 a failed full re-run during a canary leaves the entry judged once, never failed", async () => {
    // full, cut (equal), canary (differs), full re-run (times out)
    const run = await runOracle([subPropertyEntry()], { executeAlgebra: scripted({ 3: "empty", 4: "timeout" }) });
    const r = run.records[0];
    expect([r.ok, r.verdict, r.canary.subProperty, run.summary.failed, accounted(run.summary), run.exitCode]).toEqual([
      true,
      "equal",
      "unstable",
      0,
      1,
      ExitCodes.SUCCESS,
    ]);
  });

  it("O31b @req:00390739-fb98-487c-af20-9a89be3046a2 a failed full re-run after a differing cut makes the entry unstable, never failed", async () => {
    // full, cut (loses a row), full re-run (times out)
    const run = await runOracle([PLAIN], { executeAlgebra: scripted({ 2: "lossy", 3: "timeout" }) });
    expect([run.records[0].verdict, run.summary.unstable, run.summary.failed, accounted(run.summary), run.exitCode]).toEqual([
      "unstable",
      1,
      0,
      1,
      ExitCodes.SUCCESS,
    ]);
  });

  // cut builds of a batch beyond those of [A] alone (the graph load is the same in both runs);
  // the same text runs under distinct names (a batch refuses a duplicate name); no entry has a canary
  const extraCutBuilds = async (entries: unknown[]): Promise<{ extra: number; judged: number; canaries: boolean }> => {
    const spy = jest.spyOn(core.InMemoryTripleStore.prototype, "addAll");
    try {
      await runOracle([PLAIN]);
      const one = spy.mock.calls.length;
      spy.mockClear();
      const run = await runOracle(entries);
      return {
        extra: spy.mock.calls.length - one,
        judged: run.summary.judged,
        canaries: run.records.some((x) => x.canary.classBridge !== "n/a" || x.canary.subProperty !== "n/a"),
      };
    } finally {
      spy.mockRestore();
    }
  };
  const PLAIN_B = { name: "plain-b", sparql: `${PFX}\nSELECT ?s ?n WHERE { ?s flow:WorkItem_note ?n }` };

  it("O36 @req:00390739-fb98-487c-af20-9a89be3046a2 the cut store is reused: [A, A'] with the same P' builds the cut once", async () => {
    expect(await extraCutBuilds([PLAIN, { ...PLAIN, name: "plain-2" }])).toEqual({ extra: 0, judged: 2, canaries: false });
  });

  it("O36b @req:00390739-fb98-487c-af20-9a89be3046a2 only one cut store is kept: [A, B, A] builds the cut three times (bounded memory)", async () => {
    expect(await extraCutBuilds([PLAIN, PLAIN_B, { ...PLAIN, name: "plain-3" }])).toEqual({ extra: 2, judged: 3, canaries: false });
  });

  it("O27 @req:00390739-fb98-487c-af20-9a89be3046a2 an UPDATE entry is refused as query --batch refuses it", async () => {
    const run = await runOracle([{ name: "upd", sparql: `${PFX}\nINSERT DATA { <urn:a> <urn:b> <urn:c> }` }]);
    expect([run.records[0].ok, run.records[0].error, run.summary.failed]).toEqual([false, { type: "update-rejected" }, 1]);
  });

  it("O28 @req:00390739-fb98-487c-af20-9a89be3046a2 a full-load entry the product cannot run (DESCRIBE) is a failed entry", async () => {
    const run = await runOracle([{ name: "desc", sparql: `${PFX}\nDESCRIBE <urn:x>` }]);
    expect([run.records[0].ok, run.summary.fullLoad, run.summary.failed]).toEqual([false, 0, 1]);
  });

  it("O12 @req:00390739-fb98-487c-af20-9a89be3046a2 the summary is the last line and counts every entry once", () => {
    const { summary, records } = corpusRun;
    expect(summary.type).toBe("summary");
    expect(records.length).toBe(CORPUS.length);
    expect(summary.judged + summary.unstable + summary.fullLoad + summary.failed).toBe(CORPUS.length);
    expect(summary.graphLoads).toBe(1);
  });
});
