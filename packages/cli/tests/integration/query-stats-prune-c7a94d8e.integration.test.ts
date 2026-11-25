/**
 * Ticket c7a94d8e (RFC 308a52c3 «Загрузка по запросу», Д4, phase 4) — `query --stats`
 * prints the predicate-pruning line («N of M loaded triples, k predicates, mode
 * prune / full (reason)»), on a fresh run AND on a query-result-cache hit.
 *
 * The line reuses phase 1b's `pruneReport` (loader units, duplicates included) — so its
 * numbers must equal `query --prune-report --output json` on the same graph (S4). Loading
 * is unchanged until phase 3b: the line says what the query NEEDS of the loaded triples.
 *
 * Axes (the FIRST token of each title — the mutant driver keys on it):
 *   S1  fresh run, a constant predicate: the exact line, inside the statistics block,
 *       after «Results returned».
 *   S2  VL-3: a namespace filter on a variable predicate — «prune by namespace filter»,
 *       k = the flow# predicates of the graph.
 *   S3  a variable predicate: «full load (variable-predicate (?p))», k = every predicate of
 *       the loaded graph, 100 %.
 *   S4  the line equals `--prune-report --output json` (mode, k, cut, loaded, share) on four
 *       query forms — the ticket's acceptance measure.
 *   S5a a result-cache hit after a `--stats` run: the statistics block is printed with the
 *       RECORDED line and «Query result cache: HIT»; S5b — that line is the fresh one marked
 *       «recorded with the cached answer».
 *   S6  a hit on an answer cached WITHOUT --stats: the line says «not recorded».
 *   S7  without --stats nothing changes: no statistics block on a hit, no line on a fresh run.
 *   S8  the recorded statistics live OUTSIDE the cached answer: a JSON hit's `data` and a
 *       batch hit's bindings are those of an answer cached without --stats.
 *   S9  the analysis fails: the answer is still printed, the line says «not computed», and
 *       nothing is recorded for a later hit.
 *   S10a CONSTRUCT: the line in its block; S10b — its hit prints «Triples generated» and the
 *       recorded line.
 *   S11 UPDATE: «full load (update)».
 *   S12a–S12e a recorded value that is not one pruning line (not a string · another line ·
 *       two lines · a control sequence · the prefix mid-string) is «not recorded», not printed.
 *   S13 `--use-cache`: the same line on a triple-cache rebuild and on a triple-cache hit.
 *   S14a no analysis without --stats (canary: it runs under --stats); S14b — none under
 *       --stats --output json (the statistics block is text-only).
 *   S16 a full load with several reasons names every reason, as --prune-report prints them.
 *   S18 an empty graph: «0 of 0 loaded triples (0.00 %)», equal to --prune-report.
 *   S19 a JSON hit under --stats stays ONE JSON document, equal to a plain JSON hit (the
 *       statistics block of a hit is text-only).
 * Axes S14a, S14b, S16, S18 were found by the independent review of the specification: wrong
 * but plausible implementations passed S1–S13 (analysis on every query, in JSON mode; one
 * reason of several; NaN on an empty graph). S12d, S12e, S19 — by its closing round (a
 * weakened check of the recorded line; statistics printed into a JSON hit).
 */
import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import os from "os";

const { sparqlQueryCommand } = await import("../../src/commands/sparql-query.js");
const report = await import("../../src/commands/query-prune-report.js");
const { loadVaultTriples } = await import("../../src/cache/loadVaultTriples.js");
const core = await import("@kitelev/exocortex-core");
// The analysis is the only caller of getSubPropertyIndex (computeSubPropertyIndex): S14a/S14b
// count it. The class is not exported by core's index, so the test imports its module — the
// same module instance the CLI loads through the jest mapping of @kitelev/exocortex-core.
const PHRS = await import("../../../core/src/infrastructure/sparql/PropertyHierarchyResolvingStore.js");

const PFX = [
  "PREFIX exo: <https://exocortex.my/ontology/exo#>",
  "PREFIX ems: <https://exocortex.my/ontology/ems#>",
  "PREFIX concept: <https://exocortex.my/ontology/concept#>",
  "PREFIX flow: <https://exocortex.my/ontology/flow#>",
  "PREFIX test: <https://exocortex.my/ontology/test#>",
].join("\n");

let seq = 0;
const uid = (): string => `c7a94d8e-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const C = { thing: uid(), gadget: uid(), status: uid() };
const S = { done: uid() };
const P = { relates: uid(), related: uid() };
const A = { g1: uid(), g2: uid(), a1: uid(), a2: uid(), f1: uid(), f2: uid() };

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
  // a symbolic individual: every file that links it repeats its type triples (duplicates)
  [C.status, { exo__Asset_uid: C.status, exo__Asset_label: "test__Status", aliases: ["test__Status"], exo__Instance_class: ["[[exo__Class]]"] }],
  [S.done, { exo__Asset_uid: S.done, exo__Asset_label: "test__StatusDone", aliases: ["test__StatusDone"], exo__Instance_class: [`[[${C.status}]]`] }],
  [A.g1, { exo__Asset_uid: A.g1, exo__Asset_label: "Gadget one", exo__Instance_class: [`[[${C.gadget}]]`], ems__Effort_status: `[[${S.done}]]` }],
  [A.g2, { exo__Asset_uid: A.g2, exo__Asset_label: "Gadget two", exo__Instance_class: [`[[${C.gadget}]]`], ems__Effort_status: `[[${S.done}]]` }],
  [A.a1, { exo__Asset_uid: A.a1, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Concept A", concept__Concept_related: `[[${A.a2}]]` }],
  [A.a2, { exo__Asset_uid: A.a2, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Concept B", exo__Asset_relates: `[[${A.a1}]]` }],
  [A.f1, { exo__Asset_uid: A.f1, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Flow one", flow__WorkItem_stage: `[[${A.a2}]]`, flow__WorkItem_note: "n1" }],
  [A.f2, { exo__Asset_uid: A.f2, exo__Instance_class: ["[[exo__Asset]]"], exo__Asset_label: "Flow two", flow__WorkItem_rank: "5" }],
];

const Q = {
  constant: `${PFX}\nSELECT ?s ?st WHERE { ?s ems:Effort_status ?st }`,
  namespace: `${PFX}\nSELECT ?s ?p ?v WHERE { ?s ?p ?v . FILTER(CONTAINS(STR(?p), 'ontology/flow#')) }`,
  variable: `${PFX}\nSELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
  subProperty: `${PFX}\nSELECT ?s ?o WHERE { ?s exo:Asset_relates ?o }`,
  construct: `${PFX}\nCONSTRUCT { ?s ems:Effort_status ?st } WHERE { ?s ems:Effort_status ?st }`,
  update: `${PFX}\nINSERT DATA { <https://example.org/x> exo:Asset_label "x" }`,
};

let vaultDir: string;
let workDir: string;
/** The suite's HOME: the query result cache lives under os.homedir() — never the real one. */
let homeDir: string;
let loaded: Awaited<ReturnType<typeof loadVaultTriples>>;

type Rec = Record<string, any>;

const M = (): number => loaded.triples.length;
const rawCount = (predicates: Iterable<string>): number => {
  const set = new Set(predicates);
  return loaded.triples.filter((t) => set.has(t.predicate.value)).length;
};
const distinctPredicates = (): number => new Set(loaded.triples.map((t) => t.predicate.value)).size;
const flowPredicates = (): string[] =>
  [...new Set(loaded.triples.map((t) => t.predicate.value).filter((p) => p.includes("ontology/flow#")))].sort();
const pct = (n: number, m: number): string => `${((n / m) * 100).toFixed(2)} %`;

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

/** The lines of the statistics block, in order (each without its two-space indent). */
function statsLines(log: string[]): string[] {
  const all = log.join("\n").split("\n");
  const at = all.findIndex((l) => l.includes("📊 Execution Statistics:"));
  if (at < 0) return [];
  const rest = all.slice(at + 1);
  const end = rest.findIndex((l) => !l.startsWith("  "));
  return (end < 0 ? rest : rest.slice(0, end)).map((l) => l.slice(2));
}
const pruneLine = (log: string[]): string | undefined => statsLines(log).find((l) => l.startsWith("Predicate pruning:"));

/** Run `fn` with its OWN home, so the result cache it warms reaches no other axis. */
async function withHome<T>(tag: string, fn: (cacheDir: string) => Promise<T>): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `exo-c7a94d8e-${tag}-`));
  (os.homedir as unknown as { mockReturnValue(v: string): void }).mockReturnValue(home);
  try {
    return await fn(path.join(home, ".exocortex", "cache", "query-results"));
  } finally {
    (os.homedir as unknown as { mockReturnValue(v: string): void }).mockReturnValue(homeDir);
    fs.rmSync(home, { recursive: true, force: true });
  }
}
const cacheFiles = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f)) : []);

const jsonReport = async (sparql: string): Promise<Rec> => {
  const r = await command([sparql, "--prune-report", "--output", "json"]);
  expect(r.exitError).toBeNull();
  return (JSON.parse(r.log.join("\n")) as Rec).data;
};

beforeAll(async () => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-c7a94d8e-vault-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-c7a94d8e-work-"));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-c7a94d8e-home-"));
  jest.spyOn(os, "homedir").mockReturnValue(homeDir);
  for (const [u, fm] of NOTES) fs.writeFileSync(path.join(vaultDir, `${u}.md`), noteText(fm));
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  loaded = await loadVaultTriples(vaultDir, { useCache: false });
});

afterAll(() => {
  jest.restoreAllMocks();
  for (const d of [vaultDir, workDir, homeDir]) fs.rmSync(d, { recursive: true, force: true });
});

describe("query --stats: the predicate-pruning line (ticket c7a94d8e, RFC 308a52c3 Д4)", () => {
  // Several command runs per axis; under the parallel pre-commit run one took 13 s. A
  // timed-out axis keeps running and its spy (S9) would leak into the next one.
  jest.setTimeout(60_000);
  it("S1 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a a fresh run, a constant predicate: the exact line in the statistics block, after «Results returned»", async () => {
    const r = await command([Q.constant, "--stats", "--no-cache"]);
    const cut = rawCount(["https://exocortex.my/ontology/ems#Effort_status"]);
    const lines = statsLines(r.log);
    expect(r.exitError).toBeNull();
    expect(cut).toBeGreaterThan(0);
    expect(lines.slice(3)).toEqual([
      `Triples scanned: ${M()}`,
      "Results returned: 2",
      `Predicate pruning: prune — needs 1 predicate(s), ${cut} of ${M()} loaded triples (${pct(cut, M())})`,
    ]);
  });

  it("S2 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a VL-3: a namespace filter — «prune by namespace filter», k = the flow# predicates of the graph", async () => {
    const r = await command([Q.namespace, "--stats", "--no-cache"]);
    const flow = flowPredicates();
    expect(r.exitError).toBeNull();
    expect(flow.length).toBeGreaterThanOrEqual(3);
    expect(pruneLine(r.log)).toBe(
      `Predicate pruning: prune by namespace filter — needs ${flow.length} predicate(s), ${rawCount(flow)} of ${M()} loaded triples (${pct(rawCount(flow), M())})`,
    );
  });

  it("S3 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a a variable predicate: full load with its reason, k = every predicate of the loaded graph, 100 %", async () => {
    const r = await command([Q.variable, "--stats", "--no-cache"]);
    expect(r.exitError).toBeNull();
    expect(pruneLine(r.log)).toBe(
      `Predicate pruning: full load (variable-predicate (?p)) — needs all ${distinctPredicates()} predicate(s), ${M()} of ${M()} loaded triples (100.00 %)`,
    );
  });

  it("S4 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a the line equals `--prune-report --output json` on the same graph (mode, k, cut, loaded, share)", async () => {
    const MODE: Record<string, string> = { prune: "prune", "prune-namespace": "prune by namespace filter" };
    for (const q of [Q.constant, Q.namespace, Q.variable, Q.subProperty]) {
      const data = await jsonReport(q);
      const r = await command([q, "--stats", "--no-cache"]);
      const head = data.mode === "full" ? `full load (variable-predicate (?p))` : MODE[data.mode];
      // A full load's k (every predicate of the graph) is not a --prune-report field: only
      // «all» is compared here, the number is pinned by S3 and S11.
      const k = data.mode === "full" ? "all K" : String(data.predicates.length);
      const line = pruneLine(r.log)?.replace(/needs all \d+ predicate/, "needs all K predicate");
      expect([r.exitError, line]).toEqual([
        null,
        `Predicate pruning: ${head} — needs ${k} predicate(s), ${data.triplesCut} of ${data.triplesLoaded} loaded triples (${(data.share * 100).toFixed(2)} %)`,
      ]);
    }
  });

  /** Two runs of the same query with --stats in a fresh home: the fresh run, then the hit. */
  const freshThenHit = async (tag: string, query: string): Promise<{ first: string[]; second: string[] }> =>
    withHome(tag, async () => {
      const first = await command([query, "--stats"]);
      const second = await command([query, "--stats"]);
      expect([first.exitError, second.exitError]).toEqual([null, null]);
      expect(statsLines(first.log)).toContain("Query result cache: MISS (cached for next run)");
      expect(second.log.join("\n")).toContain("(cached)");
      return { first: first.log, second: second.log };
    });

  it("S5a @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a a result-cache hit after a --stats run prints the statistics block with the RECORDED line (not «not recorded»)", async () => {
    const { first, second } = await freshThenHit("s5a", Q.constant);
    const fresh = pruneLine(first) as string;
    const lines = statsLines(second);
    expect(fresh).toMatch(/^Predicate pruning: prune — needs 1 predicate\(s\), \d+ of \d+ loaded triples/);
    expect(lines[0]).toMatch(/^Total time: \d+ms$/);
    expect([lines[1], lines[3], lines.length]).toEqual(["Results returned: 2", "Query result cache: HIT", 4]);
    expect(lines[2] !== report.PRUNE_STATS_NOT_RECORDED && lines[2].startsWith(fresh)).toBe(true);
  });

  it("S5b @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a the hit's line is the fresh line marked «recorded with the cached answer»", async () => {
    const { first, second } = await freshThenHit("s5b", Q.constant);
    expect(pruneLine(second)).toBe(`${pruneLine(first)} — recorded with the cached answer`);
  });

  it("S6 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a a hit on an answer cached without --stats: the line says «not recorded»", async () => {
    await withHome("s6", async () => {
      const plain = await command([Q.constant]);
      const hit = await command([Q.constant, "--stats"]);
      expect([plain.exitError, hit.exitError]).toEqual([null, null]);
      expect(hit.log.join("\n")).toContain("(cached)");
      expect(statsLines(hit.log).slice(1)).toEqual([
        "Results returned: 2",
        "Predicate pruning: not recorded with the cached answer (rerun with --no-cache to measure)",
        "Query result cache: HIT",
      ]);
    });
  });

  it("S7 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a without --stats nothing changes: no statistics block on a hit, no pruning line on a fresh run", async () => {
    const fresh = await command([Q.constant, "--no-cache"]);
    expect([fresh.exitError, fresh.log.join("\n").includes("Predicate pruning")]).toEqual([null, false]);
    await withHome("s7", async () => {
      const warmed = await command([Q.constant, "--stats"]);
      const hit = await command([Q.constant]);
      const text = hit.log.join("\n");
      expect([warmed.exitError, hit.exitError, text.includes("(cached)")]).toEqual([null, null, true]);
      expect([text.includes("Execution Statistics"), text.includes("Predicate pruning")]).toEqual([false, false]);
    });
  });

  it("S8 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a the recorded statistics live outside the cached answer: JSON-hit data and batch-hit bindings are unchanged", async () => {
    const jsonHit = async (warm: string[]): Promise<Rec> =>
      withHome("s8", async () => {
        await command(warm);
        const r = await command([Q.constant, "--output", "json"]);
        const doc = JSON.parse(r.log.join("\n")) as Rec;
        expect([r.exitError, doc.meta.queryResultCacheHit]).toEqual([null, true]);
        return doc.data;
      });
    const withStats = await jsonHit([Q.constant, "--stats"]);
    const withoutStats = await jsonHit([Q.constant]);
    expect(Object.keys(withStats).sort()).toEqual(["bindings", "count", "type"]);
    expect(withStats).toEqual(withoutStats);

    await withHome("s8b", async () => {
      await command([Q.constant, "--stats"]);
      const file = path.join(workDir, "s8-batch.json");
      fs.writeFileSync(file, JSON.stringify([{ name: "q", sparql: Q.constant }]));
      const r = await command(["--batch", file]);
      const recs = r.out.join("").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Rec);
      const rec = recs.find((x) => x.name === "q") as Rec;
      expect([r.exitError, rec.queryResultCacheHit, rec.count, rec.bindings]).toEqual([null, true, 2, withoutStats.bindings]);
    });
  });

  it("S9 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a the analysis fails: the answer is still printed, the line says «not computed», nothing is recorded", async () => {
    await withHome("s9", async () => {
      // The first count() of a run is the analysis' sub-property index (computeSubPropertyIndex).
      const count = jest.spyOn(core.InMemoryTripleStore.prototype, "count").mockRejectedValueOnce(new Error("injected-c7a94d8e"));
      let failed: Awaited<ReturnType<typeof command>>;
      try {
        failed = await command([Q.constant, "--stats"]);
      } finally {
        count.mockRestore();
      }
      expect(failed.exitError).toBeNull();
      expect(failed.log.join("\n")).toContain("✅ Found 2 result(s)");
      expect(pruneLine(failed.log)).toBe("Predicate pruning: not computed — Error: injected-c7a94d8e");
      const hit = await command([Q.constant, "--stats"]);
      expect(hit.log.join("\n")).toContain("(cached)");
      expect(pruneLine(hit.log)).toBe(report.PRUNE_STATS_NOT_RECORDED);
    });
  });

  const constructLine = (): string => {
    const cut = rawCount(["https://exocortex.my/ontology/ems#Effort_status"]);
    return `Predicate pruning: prune — needs 1 predicate(s), ${cut} of ${M()} loaded triples (${pct(cut, M())})`;
  };

  it("S10a @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a CONSTRUCT: the line in its statistics block, after «Triples generated»", async () => {
    const r = await command([Q.construct, "--stats", "--no-cache"]);
    const lines = statsLines(r.log);
    expect(r.exitError).toBeNull();
    expect(lines.slice(lines.indexOf("Triples generated: 2"))).toEqual(["Triples generated: 2", constructLine()]);
  });

  it("S10b @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a a CONSTRUCT hit prints «Triples generated» and the recorded line", async () => {
    const { second } = await freshThenHit("s10b", Q.construct);
    expect(statsLines(second).slice(1)).toEqual([
      "Triples generated: 2",
      `${constructLine()} — recorded with the cached answer`,
      "Query result cache: HIT",
    ]);
  });

  it("S11 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a UPDATE: «full load (update)», every predicate of the loaded graph", async () => {
    const r = await command([Q.update, "--stats", "--no-cache"]);
    expect(r.exitError).toBeNull();
    expect(pruneLine(r.log)).toBe(
      `Predicate pruning: full load (update) — needs all ${distinctPredicates()} predicate(s), ${M()} of ${M()} loaded triples (100.00 %)`,
    );
  });

  // One axis per conjunct of recordedPruneStatsLine — the recorded value is printed only when
  // it is a string, STARTS with «Predicate pruning: » and carries no control character — and
  // per weakening of a conjunct (prefix found mid-string; a control character other than a
  // line break): each mutant reddens its own set (§A147). S12d–S12e — closing review round.
  const BAD: Array<[string, string, unknown]> = [
    ["S12a", "a value that is not a string", { mode: "prune", triplesCut: 1, triplesLoaded: 2 }],
    ["S12b", "a string that is not a pruning line", "Results returned: 2"],
    ["S12c", "a pruning line spanning two lines", "Predicate pruning: prune — needs 1 predicate(s)\nQuery result cache: MISS"],
    ["S12d", "a terminal control sequence", "Predicate pruning: prune — needs 1 predicate(s)\u001b[2K"],
    ["S12e", "the prefix in the middle of the string", "Results returned: 2 Predicate pruning: prune — needs 1 predicate(s)"],
  ];
  for (const [axis, what, bad] of BAD) {
    it(`${axis} @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a a recorded value with ${what} is «not recorded», never printed`, async () => {
      await withHome(axis.toLowerCase(), async (dir) => {
        await command([Q.constant, "--stats"]);
        const [file] = cacheFiles(dir);
        const entry = JSON.parse(fs.readFileSync(file, "utf-8")) as Rec;
        expect(entry.pruneStatsLine).toMatch(/^Predicate pruning: prune — /);
        entry.pruneStatsLine = bad;
        fs.writeFileSync(file, JSON.stringify(entry));
        const hit = await command([Q.constant, "--stats"]);
        expect([hit.log.join("\n").includes("(cached)"), pruneLine(hit.log)]).toEqual([true, report.PRUNE_STATS_NOT_RECORDED]);
      });
    });
  }

  it("S13 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a --use-cache: the same line on a triple-cache rebuild and on a triple-cache hit", async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "exo-c7a94d8e-tcache-"));
    try {
      for (const [u, fm] of NOTES) fs.writeFileSync(path.join(vault, `${u}.md`), noteText(fm));
      const rebuild = await command([Q.constant, "--stats", "--no-cache", "--use-cache"], vault);
      const hit = await command([Q.constant, "--stats", "--no-cache", "--use-cache"], vault);
      const cut = rawCount(["https://exocortex.my/ontology/ems#Effort_status"]);
      const line = `Predicate pruning: prune — needs 1 predicate(s), ${cut} of ${M()} loaded triples (${pct(cut, M())})`;
      expect([rebuild.exitError, hit.exitError]).toEqual([null, null]);
      expect([statsLines(rebuild.log).includes("Triple cache: MISS (rebuilt)"), statsLines(hit.log).includes("Triple cache: HIT")]).toEqual([true, true]);
      expect([pruneLine(rebuild.log), pruneLine(hit.log)]).toEqual([line, line]);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
  /** How many times the analysis ran during one command run. */
  const analysisCalls = async (args: string[]): Promise<[string | null, number]> => {
    const spy = jest.spyOn(PHRS.PropertyHierarchyResolvingStore.prototype, "getSubPropertyIndex");
    try {
      const r = await command(args);
      return [r.exitError, spy.mock.calls.length];
    } finally {
      spy.mockRestore();
    }
  };

  it("S14a @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a no analysis without --stats; canary: it runs under --stats", async () => {
    const plain = await analysisCalls([Q.constant, "--no-cache"]);
    const stats = await analysisCalls([Q.constant, "--stats", "--no-cache"]);
    expect([plain, stats[0], stats[1] > 0]).toEqual([[null, 0], null, true]);
  });

  it("S14b @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a no analysis under --stats --output json (the statistics block is text-only)", async () => {
    expect(await analysisCalls([Q.constant, "--stats", "--no-cache", "--output", "json"])).toEqual([null, 0]);
  });

  it("S16 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a a full load with several reasons names every reason, as --prune-report prints them", async () => {
    const q = `${PFX}\nSELECT ?s ?p ?o ?a ?q ?b WHERE { ?s ?p ?o . ?a ?q ?b }`;
    const rep = await command([q, "--prune-report"]);
    const reasonsLine = rep.log.join("\n").split("\n").find((l) => l.startsWith("Full-load reasons: ")) as string;
    const reasons = reasonsLine.slice("Full-load reasons: ".length);
    const r = await command([q, "--stats", "--no-cache"]);
    expect(reasons.split(", ").length).toBeGreaterThanOrEqual(2);
    expect(pruneLine(r.log)).toBe(
      `Predicate pruning: full load (${reasons}) — needs all ${distinctPredicates()} predicate(s), ${M()} of ${M()} loaded triples (100.00 %)`,
    );
  });

  it("S18 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a an empty graph: «0 of 0 loaded triples (0.00 %)», equal to --prune-report", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "exo-c7a94d8e-empty-"));
    try {
      const rep = await command([Q.constant, "--prune-report", "--output", "json"], empty);
      const data = (JSON.parse(rep.log.join("\n")) as Rec).data;
      const r = await command([Q.constant, "--stats", "--no-cache"], empty);
      expect([rep.exitError, r.exitError, data.triplesLoaded, data.share]).toEqual([null, null, 0, 0]);
      expect(pruneLine(r.log)).toBe("Predicate pruning: prune — needs 1 predicate(s), 0 of 0 loaded triples (0.00 %)");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
  it("S19 @req:9f8c6fd2-3450-49a0-ba17-1f0a90acd15a a JSON hit under --stats stays one JSON document, equal to a plain JSON hit", async () => {
    await withHome("s19", async () => {
      await command([Q.constant, "--stats"]);
      const plain = await command([Q.constant, "--output", "json"]);
      const stats = await command([Q.constant, "--output", "json", "--stats"]);
      const a = JSON.parse(plain.log.join("\n")) as Rec;
      const b = JSON.parse(stats.log.join("\n")) as Rec;
      expect([plain.exitError, stats.exitError, a.meta.queryResultCacheHit, b.meta.queryResultCacheHit]).toEqual([null, null, true, true]);
      expect(b.data).toEqual(a.data);
    });
  });
});
