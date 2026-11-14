/**
 * Ticket dc5ed554 (RFC 308a52c3 «Загрузка по запросу», Д1, phase 1b) — `query
 * --prune-report`: P', the full-load reasons and the share of loaded triples, over a temp
 * vault read by the REAL loader (full parse, the production converter configuration).
 *
 * Axes (the FIRST token of each title — the mutant driver keys on it):
 *   R1  a constant predicate: mode `prune`, P' = that predicate (source `query`), the
 *       triple count of the cut and of the load, the share.
 *   R2  VL-3: `?s ?p ?v FILTER(CONTAINS(STR(?p), 'ontology/flow#'))` — mode «prune by
 *       namespace filter», P' is EXACTLY the flow# predicates of the graph, nothing else.
 *   R3  a variable predicate: mode «full load», the reason named, share 100 %.
 *   R4  the namespace filter in another group (OPTIONAL) admits nothing: full load.
 *   R5  sub-properties: the sub-property and the declarations are in P' with their sources.
 *   R6  the class bridge: a hierarchy pattern with a symbolic class brings the bridge skeleton.
 *   R7  share in LOADER units: the cut counts the loaded triples with duplicates, exactly as
 *       the loader returns them — not the deduplicated store (the fixture carries duplicates
 *       under P', so the two counts differ).
 *   R8  `--output json`: stdout is ONE JSON document, `data.type` = "prune-report".
 *   R9  the query RESULT cache is neither read (a warmed entry does not answer instead of the
 *       report) nor written (positive control: plain `query` writes it in the same home).
 *   R10 the query is not executed: a value only its answer would carry never reaches stdout.
 *   R11a–R11e flags that shape an execution report (or the oracle) are refused before the
 *       load — one axis name per refusal.
 *   R12 `--batch … --prune-report`: one record per entry in input order, the summary last;
 *       modes counted; the median share counts a full load as 1, the prune median does not.
 *   R13 the batch union: one full entry ⇒ full; all pruned ⇒ |∪P'| and its loaded triples.
 *   R14 entries a batch would not run (syntax, UPDATE) are failed: not in medians nor union;
 *       exit OPERATION_FAILED.
 *   R15 `--use-cache` reaches the report's load (the second run reads the triple cache);
 *       R15b — the same for the batch report.
 *   R16 median: odd, even, empty.
 *   R17 a mixed query (constant + namespace filter) is prune-namespace (SOME predicate).
 *   R18–R20 the batch union: the union of overlapping entries (not the sum), in loader
 *       units (duplicates counted), with the skeletons.
 *   R21 P' sorted by IRI.  R22 a batch record carries the whole report.
 *   R23 --template reaches the report.  R24 an empty graph: share 0 for a prune.
 *   R25 a query the translator refuses: a failed batch entry of type `analysis`.
 *   R26 a syntax error carries the same context as plain query's (the parsed text).
 *   R27 a single UPDATE: full load «update» (plain query executes it over the full graph).
 * Axes R17–R25 were found by the independent review of the specification: ten wrong but
 * plausible implementations passed R1–R16 (the union, the record shape, a hidden execution).
 */
import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import os from "os";

const { sparqlQueryCommand } = await import("../../src/commands/sparql-query.js");
const report = await import("../../src/commands/query-prune-report.js");
const { loadVaultTriples } = await import("../../src/cache/loadVaultTriples.js");
const { ExitCodes } = await import("../../src/utils/ExitCodes.js");
const core = await import("@kitelev/exocortex-core");

const PFX = [
  "PREFIX exo: <https://exocortex.my/ontology/exo#>",
  "PREFIX ems: <https://exocortex.my/ontology/ems#>",
  "PREFIX concept: <https://exocortex.my/ontology/concept#>",
  "PREFIX flow: <https://exocortex.my/ontology/flow#>",
  "PREFIX test: <https://exocortex.my/ontology/test#>",
  "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>",
].join("\n");

const EXO = "https://exocortex.my/ontology/exo#";
const FLOW = "https://exocortex.my/ontology/flow#";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

let seq = 0;
const uid = (): string => `dc5ed554-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const C = { thing: uid(), gadget: uid(), status: uid() };
const S = { done: uid() };
const P = { relates: uid(), related: uid() };
const A = { g1: uid(), g2: uid(), g3: uid(), a1: uid(), a2: uid(), f1: uid(), f2: uid() };
/** A value only the answer of a query carries: the report never executes it (R10). */
const SECRET = "SECRET-VALUE-dc5ed554";

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

const NOTES: Array<[string, Record<string, unknown>]> = [
  [C.thing, { exo__Asset_uid: C.thing, exo__Asset_label: "test__Thing", aliases: ["test__Thing"], exo__Instance_class: ["[[exo__Class]]"] }],
  [C.gadget, { exo__Asset_uid: C.gadget, exo__Asset_label: "test__Gadget", aliases: ["test__Gadget"], exo__Instance_class: ["[[exo__Class]]"], exo__Class_superClass: `[[${C.thing}]]` }],
  [P.relates, { exo__Asset_uid: P.relates, exo__Asset_label: "exo__Asset_relates", aliases: ["exo__Asset_relates"], exo__Instance_class: ["[[exo__ObjectProperty]]"] }],
  [P.related, { exo__Asset_uid: P.related, exo__Asset_label: "concept__Concept_related", aliases: ["concept__Concept_related"], exo__Instance_class: ["[[exo__ObjectProperty]]"], exo__Property_superProperty: `[[${P.relates}]]` }],
  // a symbolic individual (label `prefix__Name`): EVERY file that links it repeats its type
  // triples (rdf:type + exo:Instance_class) — the loader returns duplicates (R7), the same
  // mechanism that makes ~12 % of vault-exodev's loaded triples duplicates (status values)
  [C.status, { exo__Asset_uid: C.status, exo__Asset_label: "test__Status", aliases: ["test__Status"], exo__Instance_class: ["[[exo__Class]]"] }],
  [S.done, { exo__Asset_uid: S.done, exo__Asset_label: "test__StatusDone", aliases: ["test__StatusDone"], exo__Instance_class: [`[[${C.status}]]`] }],
  [A.g1, { exo__Asset_uid: A.g1, exo__Asset_label: "Gadget one", exo__Instance_class: [`[[${C.gadget}]]`], ems__Effort_status: SECRET }],
  [A.g2, { exo__Asset_uid: A.g2, exo__Asset_label: "Gadget two", exo__Instance_class: [`[[${C.gadget}]]`], ems__Effort_status: `[[${S.done}]]` }],
  [A.g3, { exo__Asset_uid: A.g3, exo__Asset_label: "Gadget three", exo__Instance_class: [`[[${C.gadget}]]`], ems__Effort_status: `[[${S.done}]]` }],
  [A.a1, { exo__Asset_uid: A.a1, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Concept A", concept__Concept_related: `[[${A.a2}]]` }],
  [A.a2, { exo__Asset_uid: A.a2, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Concept B", exo__Asset_relates: `[[${A.a1}]]` }],
  [A.f1, { exo__Asset_uid: A.f1, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Flow one", flow__WorkItem_stage: `[[${A.a2}]]`, flow__WorkItem_note: "n1" }],
  [A.f2, { exo__Asset_uid: A.f2, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Flow two", flow__WorkItem_rank: "5" }],
];

const Q = {
  constant: `${PFX}\nSELECT ?s ?st WHERE { ?s ems:Effort_status ?st }`,
  namespace: `${PFX}\nSELECT ?s ?p ?v WHERE { ?s ?p ?v . FILTER(CONTAINS(STR(?p), 'ontology/flow#')) }`,
  variable: `${PFX}\nSELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
  namespaceInOptional: `${PFX}\nSELECT * WHERE { ?s ?p ?v OPTIONAL { ?s flow:WorkItem_note ?w FILTER(CONTAINS(STR(?p), "ontology/flow#")) } }`,
  subProperty: `${PFX}\nSELECT ?s ?o WHERE { ?s exo:Asset_relates ?o }`,
  hierarchy: `${PFX}\nSELECT ?p WHERE { test:Gadget exo:Class_superClass ?p }`,
  membership: `${PFX}\nSELECT ?s WHERE { ?s exo:Instance_class test:Gadget }`,
  // a constant predicate AND a namespace-bounded variable predicate in one group
  mixed: `${PFX}\nSELECT ?s ?v WHERE { ?s ems:Effort_status ?st . ?s ?p ?v . FILTER(CONTAINS(STR(?p), 'ontology/flow#')) }`,
  // parses, but the translator refuses a negated property set: the analysis fails
  negated: `${PFX}\nSELECT ?s WHERE { ?s !(exo:Asset_label|ems:Effort_status) ?o }`,
};

let vaultDir: string;
let workDir: string;
/** The suite's HOME: the query result cache lives under os.homedir() — never the real one. */
let homeDir: string;
/** A vault with no notes at all (R24). */
let emptyDir: string;
let loaded: Awaited<ReturnType<typeof loadVaultTriples>>;

type Rec = Record<string, any>;

/** Raw loaded triples whose predicate is in the set — what the report must count. */
const rawCount = (predicates: Iterable<string>): number => {
  const set = new Set(predicates);
  return loaded.triples.filter((t) => set.has(t.predicate.value)).length;
};
const flowPredicates = (): string[] =>
  [...new Set(loaded.triples.map((t) => t.predicate.value).filter((p) => p.includes("ontology/flow#")))].sort();

async function command(args: string[], vault: string = vaultDir): Promise<{ log: string[]; out: string[]; exitError: string | null }> {
  const log: string[] = [];
  const out: string[] = [];
  const logSpy = jest.spyOn(console, "log").mockImplementation(((...a: unknown[]) => {
    log.push(a.map(String).join(" "));
  }) as never);
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
    return { log, out, exitError: null };
  } catch (e) {
    return { log, out, exitError: (e as Error).message };
  } finally {
    logSpy.mockRestore();
    writeSpy.mockRestore();
    exitSpy.mockRestore();
    process.exitCode = saved;
  }
}

function batchFile(entries: unknown): string {
  const p = path.join(workDir, `batch-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(entries));
  return p;
}

async function runBatch(entries: unknown): Promise<{ records: Rec[]; summary: Rec; exitCode: number | undefined }> {
  const lines: string[] = [];
  const saved = process.exitCode;
  process.exitCode = undefined;
  try {
    await report.runPruneReportBatch(batchFile(entries), { vault: vaultDir, useCache: false }, {
      write: async (l: string) => {
        lines.push(l);
      },
      progress: () => undefined,
    });
    const parsed = lines.map((l) => JSON.parse(l) as Rec);
    return { records: parsed.filter((r) => r.type === "prune-report"), summary: parsed[parsed.length - 1], exitCode: process.exitCode as number | undefined };
  } finally {
    process.exitCode = saved;
  }
}

const jsonReport = async (sparql: string): Promise<Rec> => {
  const r = await command([sparql, "--prune-report", "--output", "json"]);
  expect(r.exitError).toBeNull();
  return (JSON.parse(r.log.join("\n")) as Rec).data;
};

beforeAll(async () => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-dc5ed554-vault-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-dc5ed554-work-"));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-dc5ed554-home-"));
  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-dc5ed554-empty-"));
  // A mutant that falls through to execution writes the result cache: keep it out of the real HOME.
  jest.spyOn(os, "homedir").mockReturnValue(homeDir);
  for (const [u, fm] of NOTES) fs.writeFileSync(path.join(vaultDir, `${u}.md`), noteText(fm));
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  loaded = await loadVaultTriples(vaultDir, { useCache: false });
});

afterAll(() => {
  jest.restoreAllMocks();
  for (const d of [vaultDir, workDir, homeDir, emptyDir]) fs.rmSync(d, { recursive: true, force: true });
});

describe("query --prune-report (ticket dc5ed554, RFC 308a52c3 Д1 phase 1b)", () => {
  it("R1 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 a constant predicate: mode prune, P' = the predicate, counts and share", async () => {
    const r = await command([Q.constant, "--prune-report"]);
    const text = r.log.join("\n");
    const pred = "https://exocortex.my/ontology/ems#Effort_status";
    const cut = rawCount([pred]);
    expect(r.exitError).toBeNull();
    expect(text).toContain("Mode: prune\n");
    expect(text).toContain(`P' (1 predicate(s)):\n  ${pred}  [query]`);
    expect(text).toContain(`Triples: ${cut} of ${loaded.triples.length} loaded (${((cut / loaded.triples.length) * 100).toFixed(2)} %)`);
    expect(cut).toBeGreaterThan(0);
  });

  it("R2 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 VL-3: a namespace filter on a variable predicate — «prune by namespace filter», P' is exactly the flow# predicates", async () => {
    const r = await command([Q.namespace, "--prune-report"]);
    const text = r.log.join("\n");
    const listed = r.log
      .flatMap((l) => l.split("\n"))
      .filter((l) => l.startsWith("  http"))
      .map((l) => l.trim().split(/\s+/)[0])
      .sort();
    expect(r.exitError).toBeNull();
    expect(text).toContain("Mode: prune by namespace filter");
    expect(listed).toEqual(flowPredicates());
    expect(listed.length).toBeGreaterThanOrEqual(3);
    expect(listed.every((p) => p.startsWith(FLOW))).toBe(true);
    const data = await jsonReport(Q.namespace);
    expect([data.mode, data.triplesCut]).toEqual(["prune-namespace", rawCount(flowPredicates())]);
  });

  it("R3 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 a variable predicate: full load, the reason named, share 100 %", async () => {
    const r = await command([Q.variable, "--prune-report"]);
    const text = r.log.join("\n");
    expect(r.exitError).toBeNull();
    expect(text).toContain("Mode: full load");
    expect(text).toContain("Full-load reasons: variable-predicate (?p)");
    expect(text).toContain(`Triples: ${loaded.triples.length} of ${loaded.triples.length} loaded (100.00 %)`);
  });

  it("R4 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 a namespace filter in another group (OPTIONAL) admits nothing: full load", async () => {
    const data = await jsonReport(Q.namespaceInOptional);
    expect([data.mode, data.reasons.map((x: Rec) => x.kind), data.predicates, data.share]).toEqual(["full", ["variable-predicate"], [], 1]);
  });

  it("R5 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 sub-properties: the sub-property and its declarations are in P' with their sources", async () => {
    const data = await jsonReport(Q.subProperty);
    const src = Object.fromEntries((data.predicates as Rec[]).map((p) => [p.iri, p.sources]));
    expect(data.mode).toBe("prune");
    expect(src[`${EXO}Asset_relates`]).toEqual(["query"]);
    expect(src["https://exocortex.my/ontology/concept#Concept_related"]).toEqual(["sub-property"]);
    expect(src[`${EXO}Property_superProperty`]).toEqual(["sub-property-declarations"]);
  });

  it("R6 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 the class bridge: a symbolic-class hierarchy pattern brings rdfs:label as class-bridge", async () => {
    const data = await jsonReport(Q.hierarchy);
    const src = Object.fromEntries((data.predicates as Rec[]).map((p) => [p.iri, p.sources]));
    expect(data.mode).toBe("prune");
    // Class_superClass is the query's own predicate AND one of the six bridge predicates
    expect(src[`${EXO}Class_superClass`]).toEqual(["class-bridge", "query"]);
    expect(src[RDFS_LABEL]).toEqual(["class-bridge"]);
  });

  it("R7 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 share in loader units: the cut counts loaded triples with duplicates, not the deduplicated store", async () => {
    const data = await jsonReport(Q.membership);
    const preds = (data.predicates as Rec[]).map((p) => p.iri as string);
    const cutStore = new core.InMemoryTripleStore();
    const set = new Set(preds);
    await cutStore.addAll(loaded.triples.filter((t) => set.has(t.predicate.value)));
    const unique = await cutStore.count();
    // the fixture is meant to carry duplicates under P' — otherwise the axis proves nothing
    expect(rawCount(preds)).toBeGreaterThan(unique);
    expect([data.triplesCut, data.triplesLoaded]).toEqual([rawCount(preds), loaded.triples.length]);
    expect(data.share).toBeCloseTo(rawCount(preds) / loaded.triples.length, 12);
  });

  it("R8 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 --output json: stdout is one JSON document of type prune-report", async () => {
    const r = await command([Q.constant, "--prune-report", "--output", "json"]);
    const doc = JSON.parse(r.log.join("\n")) as Rec;
    expect([r.exitError, doc.success, doc.data.type, doc.data.mode]).toEqual([null, true, "prune-report", "prune"]);
    expect(Object.keys(doc.data).sort()).toEqual(["mode", "predicates", "reasons", "share", "triplesCut", "triplesLoaded", "type"]);
  });

  it("R9 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 the result cache is neither read nor written (positive control: plain query writes it)", async () => {
    // Its OWN home: the entry warmed here must not reach the axes that run after it.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "exo-dc5ed554-home9-"));
    (os.homedir as unknown as { mockReturnValue(v: string): void }).mockReturnValue(home);
    const dir = path.join(home, ".exocortex", "cache", "query-results");
    const written = (): number => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length : 0);
    try {
      const reportFirst = await command([Q.constant, "--prune-report"]);
      const afterReport = written();
      const plain = await command([Q.constant]);
      const afterPlain = written();
      const reportAgain = await command([Q.constant, "--prune-report"]);
      expect([reportFirst.exitError, plain.exitError, reportAgain.exitError]).toEqual([null, null, null]);
      expect([afterReport, afterPlain > 0, written()]).toEqual([0, true, afterPlain]);
      expect(reportAgain.log.join("\n")).toContain("Prune report");
      expect(reportAgain.log.join("\n")).not.toContain("(cached)");
    } finally {
      (os.homedir as unknown as { mockReturnValue(v: string): void }).mockReturnValue(homeDir);
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("R10 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 the query is not executed: the executor is never called, its answer never reaches stdout", async () => {
    const all = jest.spyOn(core.ExoQLQueryExecutor.prototype, "executeAll");
    const construct = jest.spyOn(core.ExoQLQueryExecutor.prototype, "executeConstruct");
    try {
      const r = await command([Q.constant, "--prune-report"]);
      const printed = r.log.join("\n") + r.out.join("");
      expect(r.exitError).toBeNull();
      expect(printed).toContain("Mode: prune");
      expect(printed).not.toContain(SECRET);
      expect(printed).not.toMatch(/Found \d+ result/);
      expect([all.mock.calls.length, construct.mock.calls.length]).toEqual([0, 0]);
    } finally {
      all.mockRestore();
      construct.mockRestore();
    }
  });

  // One axis NAME per refusal: the mutant driver keys on the first token, so a shared
  // "R11" would make the mutants of different refusals indistinguishable.
  it.each([
    ["R11a", "--prune-oracle with --batch", (f: string) => ["--batch", f, "--prune-report", "--prune-oracle"]],
    ["R11b", "--dry-run", () => [Q.constant, "--prune-report", "--dry-run"]],
    ["R11c", "--explain", () => [Q.constant, "--prune-report", "--explain"]],
    ["R11d", "--stats", () => [Q.constant, "--prune-report", "--stats"]],
    ["R11e", "--format csv", () => [Q.constant, "--prune-report", "--format", "csv"]],
  ] as const)("%s @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 refused before the load: --prune-report with %s", async (_axis, _label, args) => {
    const r = await command(args(batchFile([{ name: "q", sparql: Q.constant }])));
    expect(r.exitError).toMatch(/^exit:/);
    expect(r.log.join("\n")).not.toContain("Loading vault");
    expect(r.out.join("")).toBe("");
  });

  it("R12 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 --batch --prune-report: records in input order, summary last; modes counted; medians", async () => {
    const entries = [
      { name: "c", sparql: Q.constant },
      { name: "n", sparql: Q.namespace },
      { name: "v", sparql: Q.variable },
      { name: "s", sparql: Q.subProperty },
    ];
    const r = await command(["--batch", batchFile(entries), "--prune-report"]);
    const parsed = r.out.join("").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Rec);
    const records = parsed.filter((x) => x.type === "prune-report");
    const summary = parsed[parsed.length - 1];
    expect([r.exitError, records.map((x) => x.name), summary.type]).toEqual([null, ["c", "n", "v", "s"], "summary"]);
    expect([summary.prune, summary.pruneNamespace, summary.fullLoad, summary.fullLoadReasons]).toEqual([2, 1, 1, { "variable-predicate": 1 }]);
    const shares = records.map((x) => x.share as number);
    const prune = records.filter((x) => x.mode !== "full").map((x) => x.share as number);
    // The reference median is computed HERE, not by the module's `median` — a mutant of
    // that function would move both sides at once (integration-test-revert-verify §A68).
    const ref = (xs: number[]): number => {
      const v = [...xs].sort((a, b) => a - b);
      return v.length % 2 === 1 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    };
    expect(shares[2]).toBe(1);
    expect(summary.medianShare).toBeCloseTo(ref(shares), 12);
    expect(summary.medianSharePrune).toBeCloseTo(ref(prune), 12);
    expect(summary.medianShare).not.toBeCloseTo(summary.medianSharePrune, 12);
    expect([summary.graphLoads, summary.triplesLoaded]).toEqual([1, loaded.triples.length]);
  });

  it("R13 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 the batch union: one full entry ⇒ full; all pruned ⇒ |∪P'| and its loaded triples", async () => {
    const withFull = await runBatch([
      { name: "c", sparql: Q.constant },
      { name: "v", sparql: Q.variable },
    ]);
    expect(withFull.summary.union).toEqual({ mode: "full", predicates: null, triplesCut: loaded.triples.length, share: 1 });
    const pruned = await runBatch([
      { name: "c", sparql: Q.constant },
      { name: "n", sparql: Q.namespace },
    ]);
    const union = new Set<string>([
      "https://exocortex.my/ontology/ems#Effort_status",
      ...flowPredicates(),
    ]);
    expect(pruned.summary.union.mode).toBe("prune");
    expect([pruned.summary.union.predicates, pruned.summary.union.triplesCut]).toEqual([union.size, rawCount(union)]);
  });

  it("R14 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 entries a batch would not run are failed: not in medians nor union; exit OPERATION_FAILED", async () => {
    const run = await runBatch([
      { name: "c", sparql: Q.constant },
      { name: "bad", sparql: "SELECT WHERE {" },
      { name: "upd", sparql: `${PFX}\nINSERT DATA { test:x test:y "z" }` },
    ]);
    const types = run.records.map((x) => (x.ok ? "ok" : x.error.type));
    expect(types).toEqual(["ok", "syntax", "update-rejected"]);
    expect([run.summary.ok, run.summary.failed, run.summary.fullLoad]).toEqual([1, 2, 0]);
    expect(run.summary.medianShare).toBeCloseTo(run.records[0].share, 12);
    expect(run.summary.union.mode).toBe("prune");
    expect(run.exitCode).toBe(ExitCodes.OPERATION_FAILED);
  });

  it("R15 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 --use-cache reaches the report's load: the second run reads the triple cache", async () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "exo-dc5ed554-cache-"));
    try {
      for (const [u, fm] of NOTES) fs.writeFileSync(path.join(copy, `${u}.md`), noteText(fm));
      await command([Q.constant, "--prune-report", "--use-cache"], copy);
      const second = await command([Q.constant, "--prune-report", "--use-cache"], copy);
      expect(second.log.join("\n")).toMatch(/Loaded \d+ triples in \d+ms \(from cache\)/);
      const plain = await command([Q.constant, "--prune-report"], copy);
      expect(plain.log.join("\n")).not.toContain("(from cache)");
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  it("R15b @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 --use-cache reaches the batch report's load: the second batch reads the triple cache", async () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "exo-dc5ed554-bcache-"));
    try {
      for (const [u, fm] of NOTES) fs.writeFileSync(path.join(copy, `${u}.md`), noteText(fm));
      const f = batchFile([{ name: "c", sparql: Q.constant }]);
      const modeOf = (r: { out: string[] }): string => {
        const lines = r.out.join("").split("\n").filter((l) => l !== "");
        return (JSON.parse(lines[lines.length - 1]) as Rec).loadMode;
      };
      const first = await command(["--batch", f, "--prune-report", "--use-cache"], copy);
      const second = await command(["--batch", f, "--prune-report", "--use-cache"], copy);
      const plain = await command(["--batch", f, "--prune-report"], copy);
      expect([modeOf(first), modeOf(second), modeOf(plain)]).toEqual(["rebuild", "hit", "full-parse"]);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  it("R17 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 a mixed query (constant + namespace filter) is prune-namespace: SOME predicate admitted by the filter", async () => {
    const data = await jsonReport(Q.mixed);
    const src = Object.fromEntries((data.predicates as Rec[]).map((p) => [p.iri, p.sources]));
    expect(data.mode).toBe("prune-namespace");
    expect(src["https://exocortex.my/ontology/ems#Effort_status"]).toEqual(["query"]);
  });

  it("R18 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 the batch union of OVERLAPPING entries is the union, not the sum", async () => {
    const pred = "https://exocortex.my/ontology/ems#Effort_status";
    const run = await runBatch([
      { name: "a", sparql: Q.constant },
      { name: "b", sparql: Q.constant },
    ]);
    expect([run.summary.union.predicates, run.summary.union.triplesCut]).toEqual([1, rawCount([pred])]);
  });

  it("R19 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 the batch union in loader units: duplicates under P' counted, as in the entry", async () => {
    const run = await runBatch([{ name: "m", sparql: Q.membership }]);
    const preds = (run.records[0].predicates as Rec[]).map((p) => p.iri as string);
    expect(run.summary.union.triplesCut).toBe(rawCount(preds));
    expect(run.summary.union.triplesCut).toBe(run.records[0].triplesCut);
  });

  it("R20 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 the batch union keeps the skeletons (sub-property and its declarations)", async () => {
    const run = await runBatch([{ name: "s", sparql: Q.subProperty }]);
    expect([run.summary.union.predicates, run.summary.union.triplesCut]).toEqual([
      run.records[0].predicates.length,
      run.records[0].triplesCut,
    ]);
  });

  it("R21 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 P' is listed sorted by IRI", async () => {
    const data = await jsonReport(Q.subProperty);
    const iris = (data.predicates as Rec[]).map((p) => p.iri as string);
    expect(iris.length).toBeGreaterThanOrEqual(3);
    expect(iris).toEqual([...iris].sort());
  });

  it("R22 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 a batch record carries P', the reasons and the counts — the same report as the single one", async () => {
    const run = await runBatch([{ name: "n", sparql: Q.namespace }]);
    expect(Object.keys(run.records[0]).sort()).toEqual([
      "durationMs", "mode", "name", "ok", "predicates", "reasons", "share", "triplesCut", "triplesLoaded", "type",
    ]);
  });

  it("R23 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 --template reaches the report: the template's query is analyzed", async () => {
    const r = await command(["--template", "tasks-by-date", "--param", "date=2026-01-01", "--prune-report", "--output", "json"]);
    const doc = JSON.parse(r.log.join("\n")) as Rec;
    expect([r.exitError, doc.data.type, doc.data.mode]).toEqual([null, "prune-report", "prune"]);
  });

  it("R24 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 an empty graph: a prune reports share 0", async () => {
    const r = await command([Q.namespace, "--prune-report", "--output", "json"], emptyDir);
    const data = (JSON.parse(r.log.join("\n")) as Rec).data;
    expect([r.exitError, data.mode, data.triplesLoaded, data.share]).toEqual([null, "prune", 0, 0]);
  });

  it("R25 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 a query the translator refuses is a failed batch entry of type analysis", async () => {
    const run = await runBatch([{ name: "neg", sparql: Q.negated }]);
    expect([run.records[0].ok, run.records[0].error]).toEqual([false, { type: "analysis" }]);
    expect(run.exitCode).toBe(ExitCodes.OPERATION_FAILED);
  });

  it("R26 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 a syntax error is reported as by plain query: the same error context (line numbers of the parsed text)", async () => {
    const bad = "SELECT ?s WHERE {\n  ?s ems:Effort_status ?st .\n  FILTER(\n}";
    const contextOf = (r: { log: string[] }): unknown => (JSON.parse(r.log.join("\n")) as Rec).error?.context;
    const report = await command([bad, "--prune-report", "--output", "json"]);
    const plain = await command([bad, "--output", "json", "--no-cache"]);
    expect([report.exitError, plain.exitError]).toEqual([`exit:${ExitCodes.INVALID_ARGUMENTS}`, `exit:${ExitCodes.INVALID_ARGUMENTS}`]);
    expect(contextOf(report)).toEqual(contextOf(plain));
    expect((contextOf(plain) as Rec).queryContext).toBeDefined();
  });

  it("R27 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 a single UPDATE is a full load for the reason «update» (plain query runs it over the full graph)", async () => {
    const r = await command([`${PFX}\nINSERT DATA { test:x test:y "z" }`, "--prune-report"]);
    const text = r.log.join("\n");
    expect([r.exitError, text.includes("Mode: full load"), text.includes("Full-load reasons: update")]).toEqual([null, true, true]);
  });

  it("R16 @req:551f5dbd-9ceb-4193-a529-fd767d6713c1 median: odd, even, empty", () => {
    expect([report.median([0.3, 0.1, 0.2]), report.median([0.4, 0.1, 0.2, 0.3]), report.median([])]).toEqual([0.2, 0.25, null]);
  });
});
