/**
 * Ticket 8ada0615 (RFC 049bc5f1, variant A) — `query --batch` / `run-query --batch`:
 * many named queries, ONE graph load, NDJSON answers by name.
 *
 * Every axis drives the REAL command in-process against a real temp vault.
 * stdout and stderr are captured SEPARATELY (the answer document is stdout only —
 * integration-test-revert-verify §A160). Graph loads are counted by an OBSERVER
 * independent of the code under test (spies on the loader classes), not only by
 * the `graphLoads` field the code reports about itself.
 *
 * Axis names (`B<N>` / `R<N>`) are the FIRST token of each title — the mutant
 * driver keys on it (`red_re: "› ([BR]\\d+\\w?) "`).
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import os from "os";

const { sparqlQueryCommand } = await import("../../src/commands/sparql-query.js");
const { runQueryCommand } = await import("../../src/commands/run-query.js");
const { CacheManager } = await import("../../src/cache/CacheManager.js");
const { QueryResultCache } = await import("../../src/cache/QueryResultCache.js");
const { streamSink, runSparqlBatch } = await import("../../src/commands/query-batch.js");
const core = await import("@kitelev/exocortex-core");

const CANARY = "FAKE-CANARY-8ada0615";

class ExitSignal extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

function asset(uid: string, label: string, cls: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    "exo__Instance_class:",
    `  - "[[${cls}]]"`,
    "---",
    `# ${label}`,
    "",
  ].join("\n");
}

function namedQuery(uid: string, label: string, sparql: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    "exo__Instance_class:",
    '  - "[[query__NamedQuery]]"',
    "---",
    `# ${label}`,
    "",
    "```sparql",
    sparql,
    "```",
    "",
  ].join("\n");
}

const NQ_LABELS = "a1000000-0000-4000-8000-0000000000a1";
const NQ_BY_LABEL = "a1000000-0000-4000-8000-0000000000a2";
const NQ_CURRENT = "a1000000-0000-4000-8000-0000000000a3";
const NQ_BY_IRI = "a1000000-0000-4000-8000-0000000000a4";
const NQ_BROKEN = "a1000000-0000-4000-8000-0000000000a5";

const Q_SHORTHAND = "SELECT ?s ?l WHERE { ?s <exo__Asset_label> ?l } ORDER BY ?l";
const Q_PREFIXED = 'SELECT ?s WHERE { ?s exo:Instance_class ?c . FILTER(CONTAINS(STR(?c), "Task")) } ORDER BY ?s';
const Q_CONSTRUCT = "CONSTRUCT { ?s <urn:test:label> ?l } WHERE { ?s exo:Asset_label ?l }";
const Q_COUNT = "SELECT (COUNT(?s) AS ?n) WHERE { ?s exo:Asset_label ?l }";

interface Captured {
  stdout: string[];
  stderr: string[];
  consoleOut: string[];
  events: string[];
  exitCodes: (number | undefined)[];
}

describe("query --batch / run-query --batch (ticket 8ada0615)", () => {
  let vaultDir: string;
  let workDir: string;
  let homeDir: string;
  let cap: Captured;
  let deferFlush: boolean;
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-8ada0615-vault-"));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-8ada0615-work-"));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-8ada0615-home-"));
    const w = (name: string, body: string) => fs.writeFileSync(path.join(vaultDir, name), body);
    w("t1.md", asset("11111111-1111-4111-8111-000000000001", "Alpha", "ems__Task"));
    w("t2.md", asset("11111111-1111-4111-8111-000000000002", "Beta", "ems__Task"));
    w("p1.md", asset("11111111-1111-4111-8111-000000000003", "Gamma", "ems__Project"));
    w("nq1.md", namedQuery(NQ_LABELS, "All labels", "PREFIX exo: <https://exocortex.my/ontology/exo#>\nSELECT ?l WHERE { ?s exo:Asset_label ?l } ORDER BY ?l"));
    w("nq2.md", namedQuery(NQ_BY_LABEL, "By label", "PREFIX exo: <https://exocortex.my/ontology/exo#>\nSELECT ?s WHERE { ?s exo:Asset_label ?l . FILTER(STR(?l) = $label) }"));
    w("nq3.md", namedQuery(NQ_CURRENT, "Of current", "PREFIX exo: <https://exocortex.my/ontology/exo#>\nSELECT ?l WHERE { $currentAsset exo:Asset_label ?l }"));
    w("nq4.md", namedQuery(NQ_BY_IRI, "Of target", "PREFIX exo: <https://exocortex.my/ontology/exo#>\nSELECT ?l WHERE { $target exo:Asset_label ?l }"));
    // Broken on purpose: the substituted $label lands inside the parser's error window.
    w("nq5.md", namedQuery(NQ_BROKEN, "Broken", "PREFIX exo: <https://exocortex.my/ontology/exo#>\nSELECT ?s WHERE { ?s exo:Asset_label $label"));

    jest.spyOn(os, "homedir").mockReturnValue(homeDir);
    cap = { stdout: [], stderr: [], consoleOut: [], events: [], exitCodes: [] };
    deferFlush = false;
    savedExitCode = process.exitCode;
    process.exitCode = undefined;

    jest.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      const text = String(chunk);
      cap.stdout.push(text);
      const name = (() => {
        try { return (JSON.parse(text) as { name?: string; type?: string }).name ?? "summary"; } catch { return "?"; }
      })();
      cap.events.push(`write:${name}`);
      const cb = rest.find((r) => typeof r === "function") as ((e?: Error | null) => void) | undefined;
      if (cb) {
        if (deferFlush) {
          // Real time, not one macrotask: an implementation that merely yields once
          // (setImmediate) instead of waiting for THIS callback must be caught (review RV06).
          setTimeout(() => { cap.events.push(`flushed:${name}`); cb(null); }, 30);
        } else {
          cap.events.push(`flushed:${name}`);
          cb(null);
        }
      }
      return true;
    }) as never);
    jest.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      cap.stderr.push(String(chunk));
      return true;
    }) as never);
    const toConsole = (...args: unknown[]): void => { cap.consoleOut.push(args.map(String).join(" ")); };
    jest.spyOn(console, "log").mockImplementation(toConsole);
    jest.spyOn(console, "error").mockImplementation(toConsole);
    jest.spyOn(console, "warn").mockImplementation(toConsole);
    jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      cap.exitCodes.push(code);
      throw new ExitSignal(code);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = savedExitCode;
    for (const d of [vaultDir, workDir, homeDir]) fs.rmSync(d, { recursive: true, force: true });
  });

  function batchFile(entries: unknown): string {
    const p = path.join(workDir, `batch-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(p, typeof entries === "string" ? entries : JSON.stringify(entries));
    return p;
  }

  async function runQuery(args: string[]): Promise<void> {
    try {
      await sparqlQueryCommand().parseAsync(["node", "query", ...args, "--vault", vaultDir]);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    }
  }

  async function runNamed(args: string[]): Promise<void> {
    try {
      await runQueryCommand().parseAsync(["node", "run-query", ...args, "--vault", vaultDir]);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    }
  }

  function records(): Array<Record<string, any>> {
    return cap.stdout.join("").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l));
  }

  /** The single-query answer as consumers parse it today: the `[...]` document of `--format json`. */
  async function single(sparql: string): Promise<unknown> {
    const before = cap.consoleOut.length;
    await runQuery([sparql, "--format", "json", "--no-cache"]);
    const doc = cap.consoleOut.slice(before).find((l) => l.startsWith("["));
    expect(doc).toBeDefined();
    return JSON.parse(doc as string);
  }

  function spyLoads(): { fullParse: ReturnType<typeof jest.spyOn>; cache: ReturnType<typeof jest.spyOn> } {
    return {
      fullParse: jest.spyOn(core.NoteToRDFConverter.prototype, "convertVaultWithValidation"),
      cache: jest.spyOn(CacheManager.prototype, "loadOrBuild"),
    };
  }

  it("B1 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea N queries load the graph ONCE (independent observer + graphLoads=1)", async () => {
    const loads = spyLoads();
    const f = batchFile([
      { name: "a", sparql: Q_SHORTHAND },
      { name: "b", sparql: Q_PREFIXED },
      { name: "c", sparql: Q_CONSTRUCT },
      { name: "d", sparql: Q_COUNT },
    ]);
    await runQuery(["--batch", f, "--no-cache"]);
    expect(loads.fullParse).toHaveBeenCalledTimes(1);
    const recs = records();
    expect(recs.map((r) => r.name ?? r.type)).toEqual(["a", "b", "c", "d", "summary"]);
    const summary = recs[recs.length - 1];
    expect(summary).toMatchObject({ type: "summary", queries: 4, ok: 4, failed: 0, graphLoads: 1, loadMode: "full-parse" });
    expect(process.exitCode).toBe(0);
  }, 60000);

  it("B1c @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea with --use-cache the cache loader runs ONCE for the whole batch", async () => {
    const loads = spyLoads();
    const f = batchFile([
      { name: "a", sparql: Q_SHORTHAND },
      { name: "b", sparql: Q_COUNT },
      { name: "c", sparql: Q_PREFIXED },
    ]);
    await runQuery(["--batch", f, "--no-cache", "--use-cache"]);
    expect(loads.cache).toHaveBeenCalledTimes(1);
    expect(records().pop()).toMatchObject({ graphLoads: 1, ok: 3 });
  }, 60000);

  it("B2 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea each answer equals the single `query --format json` answer for the same text", async () => {
    const texts = { a: Q_SHORTHAND, b: Q_PREFIXED, c: Q_CONSTRUCT, d: Q_COUNT };
    const f = batchFile(Object.entries(texts).map(([name, sparql]) => ({ name, sparql })));
    await runQuery(["--batch", f, "--no-cache"]);
    const byName = new Map(records().filter((r) => r.type === "result").map((r) => [r.name, r]));
    cap.stdout = [];
    for (const [name, sparql] of Object.entries(texts)) {
      const expected = await single(sparql);
      const got = byName.get(name) as Record<string, unknown>;
      expect(got.ok).toBe(true);
      expect(got.kind === "construct" ? got.triples : got.bindings).toEqual(expected);
      expect(got.count).toBe((expected as unknown[]).length);
    }
  }, 120000);

  it("B3 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea an UPDATE entry is refused and NOT executed (later entry does not see its triple)", async () => {
    const f = batchFile([
      { name: "upd", sparql: 'INSERT DATA { <urn:test:x> <urn:test:p> "planted" }' },
      { name: "after", sparql: "SELECT ?o WHERE { <urn:test:x> <urn:test:p> ?o }" },
    ]);
    await runQuery(["--batch", f, "--no-cache"]);
    const [upd, after] = records();
    expect(upd).toMatchObject({ name: "upd", ok: false, error: { type: "update-rejected" } });
    expect(after).toMatchObject({ name: "after", ok: true, count: 0 });
  }, 60000);

  // Review of PR #4605 (LOW 1): B3 alone was satisfied by a refusal that looks for "INSERT".
  it("B3b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea every update form is refused, not only INSERT: DELETE DATA and a PREFIX-led INSERT DATA", async () => {
    const f = batchFile([
      { name: "del", sparql: 'DELETE DATA { <urn:test:x> <urn:test:p> "planted" }' },
      { name: "pfx", sparql: 'PREFIX t: <urn:test:>\nINSERT DATA { t:x t:p "planted" }' },
      { name: "after", sparql: "SELECT ?o WHERE { <urn:test:x> <urn:test:p> ?o }" },
    ]);
    await runQuery(["--batch", f, "--no-cache"]);
    const [del, pfx, after] = records();
    expect(del).toMatchObject({ name: "del", ok: false, error: { type: "update-rejected" } });
    expect(pfx).toMatchObject({ name: "pfx", ok: false, error: { type: "update-rejected" } });
    expect(after).toMatchObject({ name: "after", ok: true, count: 0 });
  }, 60000);

  it("B4 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a failing entry does not stop the batch; rc = OPERATION_FAILED (5), no process.exit", async () => {
    const f = batchFile([
      { name: "ok1", sparql: Q_COUNT },
      { name: "broken", sparql: "SELECT ?s WHERE { ?s ?p " },
      { name: "ok2", sparql: Q_SHORTHAND },
    ]);
    await runQuery(["--batch", f, "--no-cache"]);
    const recs = records();
    expect(recs.map((r) => (r.type === "summary" ? "summary" : `${r.name}:${r.ok}`))).toEqual([
      "ok1:true", "broken:false", "ok2:true", "summary",
    ]);
    expect(recs[1].error.type).toBe("syntax");
    expect(recs[3]).toMatchObject({ failed: 1, ok: 2 });
    expect(process.exitCode).toBe(5);
    expect(cap.exitCodes).toEqual([]);
  }, 60000);

  it("B5 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea stdout carries ONLY NDJSON; progress goes to stderr", async () => {
    const f = batchFile([{ name: "a", sparql: Q_COUNT }, { name: "b", sparql: Q_SHORTHAND }]);
    await runQuery(["--batch", f, "--no-cache"]);
    expect(cap.stdout.length).toBe(3);
    for (const chunk of cap.stdout) {
      expect(chunk.endsWith("\n")).toBe(true);
      expect(chunk.slice(0, -1)).not.toContain("\n");
      expect(() => JSON.parse(chunk)).not.toThrow();
    }
    expect(cap.consoleOut).toEqual([]);
    expect(cap.stderr.join("")).toContain("Loading vault");
  }, 60000);

  it("B6 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea an answer is flushed BEFORE the next entry starts executing", async () => {
    deferFlush = true;
    const original = core.ExoQLQueryExecutor.prototype.executeAll;
    jest.spyOn(core.ExoQLQueryExecutor.prototype, "executeAll").mockImplementation(function (this: unknown, ...args: unknown[]) {
      cap.events.push("exec");
      return original.apply(this as never, args as never);
    } as never);
    const f = batchFile([{ name: "a", sparql: Q_COUNT }, { name: "b", sparql: Q_SHORTHAND }]);
    await runQuery(["--batch", f, "--no-cache"]);
    const ev = cap.events.filter((e) => e === "exec" || e.startsWith("write:") || e.startsWith("flushed:"));
    expect(ev.slice(0, 4)).toEqual(["exec", "write:a", "flushed:a", "exec"]);
  }, 60000);

  it("B7 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a batch file that is not JSON is refused WITHOUT quoting it (bcc041d8)", async () => {
    const loads = spyLoads();
    // The file STARTS with the canary: V8's JSON.parse message quotes the first
    // characters of its input ("Unexpected token 'F', \"FAKE-CANAR\"…"), so a
    // forwarded parser message is visible here. A file starting with `{` gives a
    // position-only message and would hide the leak (mutant M7, measured).
    const f = batchFile(`${CANARY} {"token":"x"}\nnot json at all\n`);
    await runQuery(["--batch", f, "--no-cache"]);
    const everything = [...cap.stdout, ...cap.stderr, ...cap.consoleOut].join("\n");
    expect(everything).not.toContain("FAKE-CAN");
    expect(everything).not.toContain("token");
    expect(everything).toContain("is not valid JSON");
    expect(cap.exitCodes[0]).toBe(2);
    expect(loads.fullParse).not.toHaveBeenCalled();
  }, 60000);

  it("B8 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a failing entry's answer carries the error TYPE, never the query text (bcc041d8)", async () => {
    const f = batchFile([{ name: "leak", sparql: `SELECT ?s WHERE { ?s "${CANARY}" ` }]);
    await runQuery(["--batch", f, "--no-cache"]);
    const everything = [...cap.stdout, ...cap.stderr, ...cap.consoleOut].join("\n");
    expect(everything).not.toContain("FAKE-CAN");
    expect(records()[0]).toEqual({ type: "result", name: "leak", ok: false, error: { type: "syntax" }, durationMs: expect.any(Number) });
  }, 60000);

  // Review of PR #4605 (HIGH 1): B8 locks only a PARSE error. A query that parses but is
  // rejected by the algebra translator answers type "execution", and the translator's
  // message quotes the offending literal — so the "type only" rule must hold there too.
  it("B8b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea an EXECUTION error carries the type only: a literal the translator quotes is never echoed (bcc041d8)", async () => {
    const f = batchFile([{ name: "leak", sparql: `SELECT ?x WHERE { ?s ?p ?o BIND(SUM("${CANARY}") AS ?x) }` }]);
    await runQuery(["--batch", f, "--no-cache"]);
    const everything = [...cap.stdout, ...cap.stderr, ...cap.consoleOut].join("\n");
    expect(everything).not.toContain("FAKE-CAN");
    expect(records()[0]).toEqual({ type: "result", name: "leak", ok: false, error: { type: "execution" }, durationMs: expect.any(Number) });
  }, 60000);

  it("B9 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea duplicate / invalid names and unknown fields are refused before the graph is loaded", async () => {
    const loads = spyLoads();
    for (const bad of [
      [{ name: "x", sparql: Q_COUNT }, { name: "x", sparql: Q_COUNT }],
      [{ name: "bad name", sparql: Q_COUNT }],
      [{ name: "x", sparql: Q_COUNT, extra: 1 }],
      [],
    ]) {
      cap.exitCodes = [];
      await runQuery(["--batch", batchFile(bad), "--no-cache"]);
      expect(cap.exitCodes[0]).toBe(2);
    }
    expect(loads.fullParse).not.toHaveBeenCalled();
    expect(cap.stdout).toEqual([]);
  }, 60000);

  // Review of PR #4605 (LOW 2): one axis per boundary of the file shape and of the name —
  // each refusal is its own guard (a shared axis would let one mutant hide another, §A147).
  const BATCH_SHAPES: Array<[string, unknown, string, string]> = [
    ["B9b", [{ name: "a".repeat(129), sparql: Q_COUNT }], "a name longer than 128 characters", "must match"],
    ["B9c", [{ name: "_a", sparql: Q_COUNT }], "a name that does not start with a letter or digit", "must match"],
    ["B9d", [{ name: "a\nb", sparql: Q_COUNT }], "a multi-line name", "must match"],
    ["B9e", [{ sparql: Q_COUNT }], "an entry without a name", "must match"],
    ["B9f", [{ name: "a", sparql: "   " }], "a blank sparql", '"sparql" must be a non-empty string'],
    ["B9g", { name: "a", sparql: Q_COUNT }, "an object instead of an array", "must be a non-empty JSON array"],
    ["B9h", [null], "a null entry", "is not an object"],
  ];
  for (const [axis, shape, named, refusal] of BATCH_SHAPES) {
    it(`${axis} @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a batch with ${named} is refused (rc 2) before the graph is loaded`, async () => {
      const loads = spyLoads();
      await runQuery(["--batch", batchFile(shape), "--no-cache"]);
      expect(cap.exitCodes[0]).toBe(2);
      expect([...cap.stderr, ...cap.consoleOut].join("\n")).toContain(refusal);
      expect(loads.fullParse).not.toHaveBeenCalled();
      expect(cap.stdout).toEqual([]);
    }, 60000);
  }

  // One axis per flag: each refusal is its own guard (spec review §A147 — shared red sets prove nothing).
  const QUERY_CLASHES: Array<[string, string[], string]> = [
    ["B10a", [Q_COUNT], "a positional query"],
    ["B10b", ["--template", "tasks-by-date"], "--template"],
    ["B10c", ["--param", "a=b"], "--param"],
    ["B10d", ["--dry-run"], "--dry-run"],
    ["B10e", ["--explain"], "--explain"],
    ["B10f", ["--stats"], "--stats"],
    ["B10g", ["--output", "json"], "--output"],
    ["B10h", ["--format", "csv"], "--format csv"],
    ["B10i", ["--format", "ntriples"], "--format ntriples"],
  ];
  for (const [axis, extra, named] of QUERY_CLASHES) {
    it(`${axis} @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea --batch with ${named} is refused, nothing loaded`, async () => {
      const loads = spyLoads();
      await runQuery(["--batch", batchFile([{ name: "a", sparql: Q_COUNT }]), ...extra, "--no-cache"]);
      expect(cap.exitCodes[0]).toBe(2);
      expect(cap.consoleOut.join("\n")).toContain(named);
      expect(loads.fullParse).not.toHaveBeenCalled();
      expect(cap.stdout).toEqual([]);
    }, 60000);
  }

  it("B11 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a graph load failure answers EVERY entry with type load; one attempt; rc 5", async () => {
    const load = jest.spyOn(CacheManager.prototype, "loadOrBuild").mockRejectedValue(new Error("EACCES simulated"));
    const f = batchFile([{ name: "a", sparql: Q_COUNT }, { name: "b", sparql: Q_SHORTHAND }, { name: "c", sparql: Q_COUNT }]);
    await runQuery(["--batch", f, "--no-cache", "--use-cache"]);
    const recs = records();
    expect(recs.slice(0, 3).map((r) => r.error?.type)).toEqual(["load", "load", "load"]);
    expect(recs[3]).toMatchObject({ type: "summary", failed: 3, graphLoads: 1 });
    // "One attempt" by an independent observer, not by the counter the code reports
    // about itself (review of PR #4605, MEDIUM 1: a retry per entry kept graphLoads = 1).
    expect(load).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(5);
  }, 60000);

  function stripVolatile(r: Record<string, any>): Record<string, any> {
    const { durationMs: _d, queryResultCacheHit: _h, ...rest } = r;
    return rest;
  }

  async function twice(): Promise<{ first: Array<Record<string, any>>; second: Array<Record<string, any>>; loads: ReturnType<typeof spyLoads> }> {
    const loads = spyLoads();
    const f = batchFile([{ name: "a", sparql: Q_SHORTHAND }, { name: "c", sparql: Q_CONSTRUCT }, { name: "d", sparql: Q_COUNT }]);
    await runQuery(["--batch", f]);
    const first = records();
    cap.stdout = [];
    await runQuery(["--batch", f]);
    return { first, second: records(), loads };
  }

  it("B14 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a repeated batch: SELECT answers come from the result cache, equal to the computed ones", async () => {
    const { first, second } = await twice();
    for (const i of [0, 2]) {
      expect(second[i].queryResultCacheHit).toBe(true);
      expect(stripVolatile(second[i])).toEqual(stripVolatile(first[i]));
    }
  }, 60000);

  it("B14e @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a repeated batch: the CONSTRUCT answer comes back as CONSTRUCT, equal to the computed one", async () => {
    const { first, second } = await twice();
    expect(second[1].queryResultCacheHit).toBe(true);
    expect(stripVolatile(second[1])).toEqual(stripVolatile(first[1]));
  }, 60000);

  it("B14f @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea an all-hit batch does not load the graph (independent observer)", async () => {
    const { loads } = await twice();
    expect(loads.fullParse).toHaveBeenCalledTimes(1);
  }, 60000);

  it("B14g @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea an all-hit batch reports graphLoads=0 and queryResultCacheHits=3", async () => {
    const { second } = await twice();
    expect(second[3]).toMatchObject({ type: "summary", graphLoads: 0, queryResultCacheHits: 3, ok: 3 });
  }, 60000);

  it("B14b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a vault edit between batches invalidates the cached answers (fresh, not stale)", async () => {
    const f = batchFile([{ name: "a", sparql: Q_SHORTHAND }]);
    await runQuery(["--batch", f]);
    const t1 = path.join(vaultDir, "t1.md");
    fs.writeFileSync(t1, asset("11111111-1111-4111-8111-000000000001", "Alpha2", "ems__Task"));
    const later = new Date(Date.now() + 10_000);
    fs.utimesSync(t1, later, later);
    cap.stdout = [];
    await runQuery(["--batch", f]);
    const [a, summary] = records();
    expect(a.queryResultCacheHit).toBe(false);
    expect(JSON.stringify(a.bindings)).toContain("Alpha2");
    expect(summary).toMatchObject({ graphLoads: 1, queryResultCacheHits: 0 });
  }, 60000);

  it("B14c @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea mixed hits and misses keep the input order and load the graph once", async () => {
    await runQuery(["--batch", batchFile([{ name: "a", sparql: Q_SHORTHAND }, { name: "d", sparql: Q_COUNT }])]);
    cap.stdout = [];
    await runQuery(["--batch", batchFile([
      { name: "a", sparql: Q_SHORTHAND }, { name: "b", sparql: Q_PREFIXED },
      { name: "d", sparql: Q_COUNT }, { name: "c", sparql: Q_CONSTRUCT },
    ])]);
    const recs = records();
    expect(recs.slice(0, 4).map((r) => [r.name, r.queryResultCacheHit])).toEqual([["a", true], ["b", false], ["d", true], ["c", false]]);
    expect(recs[4]).toMatchObject({ graphLoads: 1, queryResultCacheHits: 2 });
  }, 60000);

  it("B14d @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea the cache key is the query TEXT: a batch entry is served by the cache a single query filled", async () => {
    await runQuery([Q_COUNT, "--format", "json"]);
    cap.stdout = [];
    await runQuery(["--batch", batchFile([{ name: "x", sparql: Q_COUNT }])]);
    const [x, summary] = records();
    expect(x).toMatchObject({ name: "x", ok: true, queryResultCacheHit: true });
    expect(summary).toMatchObject({ graphLoads: 0 });
  }, 60000);

  it("B7b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea refusing a bad NAME does not quote it (bcc041d8)", async () => {
    await runQuery(["--batch", batchFile([{ name: `bad ${CANARY}`, sparql: Q_COUNT }]), "--no-cache"]);
    expect(cap.exitCodes[0]).toBe(2);
    expect([...cap.stdout, ...cap.stderr, ...cap.consoleOut].join("\n")).not.toContain("FAKE-CAN");
  }, 60000);

  it("B7c @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea refusing an unknown FIELD does not quote its key (bcc041d8)", async () => {
    await runQuery(["--batch", batchFile([{ name: "ok", sparql: Q_COUNT, [CANARY]: 1 }]), "--no-cache"]);
    expect(cap.exitCodes[0]).toBe(2);
    expect([...cap.stdout, ...cap.stderr, ...cap.consoleOut].join("\n")).not.toContain("FAKE-CAN");
  }, 60000);

  // The batch file is read ONCE and a failed read is classified by errno (CodeQL
  // js/file-system-race on the first edition: existsSync + statSync + read). One axis
  // per branch — each classification is its own guard (mutants M21–M24).
  it("B18 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a missing batch file exits 3 (file not found), nothing loaded", async () => {
    const loads = spyLoads();
    await runQuery(["--batch", path.join(workDir, "no-such-batch.json"), "--no-cache"]);
    expect(cap.exitCodes[0]).toBe(3);
    expect(loads.fullParse).not.toHaveBeenCalled();
    expect(cap.stdout).toEqual([]);
  }, 60000);

  it("B18b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a directory as the batch file is refused (rc 2, 'is a directory'), nothing loaded", async () => {
    const loads = spyLoads();
    await runQuery(["--batch", workDir, "--no-cache"]);
    expect(cap.exitCodes[0]).toBe(2);
    expect([...cap.stdout, ...cap.stderr, ...cap.consoleOut].join("\n")).toContain("is a directory");
    expect(loads.fullParse).not.toHaveBeenCalled();
    expect(cap.stdout).toEqual([]);
  }, 60000);

  it("B18c @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a path through a regular file (ENOTDIR) exits 3, like a missing file", async () => {
    const f = batchFile([{ name: "a", sparql: Q_COUNT }]);
    await runQuery(["--batch", path.join(f, "inner.json"), "--no-cache"]);
    expect(cap.exitCodes[0]).toBe(3);
    expect(cap.stdout).toEqual([]);
  }, 60000);

  it("B18d @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea any other read failure is refused with its errno code only (rc 2), not the raw fs message", async () => {
    const loads = spyLoads();
    // A symlink loop gives ELOOP for every user, root included (chmod 000 would not).
    const a = path.join(workDir, "loop-a.json");
    const b = path.join(workDir, "loop-b.json");
    fs.symlinkSync(b, a);
    fs.symlinkSync(a, b);
    await runQuery(["--batch", a, "--no-cache"]);
    expect(cap.exitCodes[0]).toBe(2);
    const everything = [...cap.stdout, ...cap.stderr, ...cap.consoleOut].join("\n");
    expect(everything).toContain("cannot be read (ELOOP)");
    expect(everything).not.toContain("symbolic links");
    expect(loads.fullParse).not.toHaveBeenCalled();
  }, 60000);

  it("B19 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a missing vault is refused before the graph is loaded (rc 3), not answered entry by entry", async () => {
    const loads = spyLoads();
    try {
      await sparqlQueryCommand().parseAsync(["node", "query", "--batch", batchFile([{ name: "a", sparql: Q_COUNT }]),
        "--vault", path.join(workDir, "no-such-vault"), "--no-cache"]);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    }
    expect(cap.exitCodes[0]).toBe(3);
    expect(loads.fullParse).not.toHaveBeenCalled();
    expect(cap.stdout).toEqual([]);
  }, 60000);

  it("B15 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a failed result-cache WRITE keeps the computed answer (stderr warning with the errno code), rc 0", async () => {
    jest.spyOn(QueryResultCache.prototype, "set").mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
    await runQuery(["--batch", batchFile([{ name: "a", sparql: Q_COUNT }, { name: "b", sparql: Q_SHORTHAND }])]);
    const recs = records();
    expect(recs.slice(0, 2).map((r) => r.ok)).toEqual([true, true]);
    expect(cap.stderr.join("")).toContain("EACCES");
    expect(process.exitCode).toBe(0);
  }, 60000);

  it("B16 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea U+2028 / U+2029 / U+0085 in values are escaped: a splitlines()-style reader cannot cut a line", async () => {
    const label = "Line\u2028Sep\u2029Par\u0085Nel";
    fs.writeFileSync(path.join(vaultDir, "u.md"), asset("11111111-1111-4111-8111-000000000009", label, "ems__Task"));
    await runQuery(["--batch", batchFile([{ name: "a", sparql: Q_SHORTHAND }]), "--no-cache"]);
    const chunk = cap.stdout[0];
    expect(/[\u2028\u2029\u0085]/.test(chunk)).toBe(false);
    expect(chunk.split(/[\n\r\v\f\x1c\x1d\x1e\u0085\u2028\u2029]/).filter((x) => x !== "")).toHaveLength(1);
    expect(JSON.stringify((JSON.parse(chunk) as { bindings: unknown[] }).bindings)).toContain(JSON.stringify(label).slice(1, -1));
  }, 60000);

  it("B17 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea the stdout sink survives a closed reader: the 'error' event has a listener, the write rejects", async () => {
    // Like a Node stream: the 'error' EVENT is emitted asynchronously, and with no
    // listener Node would crash the process — recorded here as `crashed` instead.
    const listeners: Array<(e: Error) => void> = [];
    let crashed = false;
    const fake = {
      on(event: string, fn: (e: Error) => void) { if (event === "error") listeners.push(fn); return fake; },
      write(_chunk: string, cb: (e?: Error | null) => void) {
        const e = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
        process.nextTick(() => {
          if (listeners.length === 0) crashed = true;
          else listeners.forEach((l) => l(e));
          cb(e);
        });
        return false;
      },
    };
    const sink = streamSink(fake as never, { write: () => true } as never);
    await expect(sink.write("x")).rejects.toThrow("EPIPE");
    expect(crashed).toBe(false);
  }, 60000);

  it("B17b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea once the reader is gone the batch stops: no further entry executes, rc 1", async () => {
    const exec = jest.spyOn(core.ExoQLQueryExecutor.prototype, "executeAll");
    const sparql = await import("../../src/commands/sparql-query.js");
    await runSparqlBatch(
      batchFile([{ name: "a", sparql: Q_COUNT }, { name: "b", sparql: Q_SHORTHAND }, { name: "c", sparql: Q_COUNT }]),
      {
        vault: vaultDir, useCache: false, useQueryResultCache: false, cacheTtlSeconds: 300, timeoutMs: 30000,
        noOptimize: false, buildAlgebra: sparql.buildAlgebra as never, executeAlgebra: sparql.executeAlgebra as never,
      },
      { write: async () => { throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" }); }, progress: () => undefined },
    );
    expect(exec).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  }, 60000);

  it("B17c @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a reader gone at the SUMMARY line still exits 1, not with the batch result", async () => {
    const sparql = await import("../../src/commands/sparql-query.js");
    await runSparqlBatch(
      batchFile([{ name: "a", sparql: Q_COUNT }]),
      {
        vault: vaultDir, useCache: false, useQueryResultCache: false, cacheTtlSeconds: 300, timeoutMs: 30000,
        noOptimize: false, buildAlgebra: sparql.buildAlgebra as never, executeAlgebra: sparql.executeAlgebra as never,
      },
      {
        write: async (line: string) => {
          if (line.includes('"type":"summary"')) throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
        },
        progress: () => undefined,
      },
    );
    expect(process.exitCode).toBe(1);
  }, 60000);

  /** One timed-out entry, then a normal one; the executor is injected exactly as the action injects it. */
  async function runWithTimeoutFirst(): Promise<Array<Record<string, any>>> {
    // The in-memory store never yields, so a real --timeout cannot fire (bug 8fe905e9).
    const { runSparqlBatch } = await import("../../src/commands/query-batch.js");
    const sparql = await import("../../src/commands/sparql-query.js");
    const { QueryTimeoutError } = await import("../../src/utils/errors/index.js");
    let call = 0;
    const f = batchFile([{ name: "slow", sparql: Q_COUNT }, { name: "fast", sparql: Q_SHORTHAND }]);
    await runSparqlBatch(f, {
      vault: vaultDir,
      useCache: false,
      useQueryResultCache: false,
      cacheTtlSeconds: 300,
      timeoutMs: 1000,
      noOptimize: false,
      buildAlgebra: sparql.buildAlgebra as never,
      executeAlgebra: (async (...args: Parameters<typeof sparql.executeAlgebra>) => {
        call += 1;
        if (call === 1) throw new QueryTimeoutError(1000, 1500);
        return sparql.executeAlgebra(...args);
      }) as never,
    });
    return records();
  }

  it("B13 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a timed-out entry answers type timeout; the rest of the batch goes on", async () => {
    const [slow, fast] = await runWithTimeoutFirst();
    expect(slow).toMatchObject({ name: "slow", ok: false, error: { type: "timeout" } });
    expect(fast).toMatchObject({ name: "fast", ok: true });
  }, 60000);

  it("B13c @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea a timed-out entry counts as failed (summary, rc 5)", async () => {
    const recs = await runWithTimeoutFirst();
    expect(recs[2]).toMatchObject({ type: "summary", failed: 1, ok: 1 });
    expect(process.exitCode).toBe(5);
  }, 60000);

  it("B13b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea the timeout answer keeps the CLI message (built from options, not from the batch file)", async () => {
    const [slow] = await runWithTimeoutFirst();
    expect(String(slow.error?.message)).toContain("Query timeout after");
  }, 60000);

  it("R1 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: N named queries, ONE graph load, answers equal single run-query", async () => {
    const loads = spyLoads();
    const f = batchFile([
      { name: "labels", uid: NQ_LABELS },
      { name: "beta", uid: NQ_BY_LABEL, params: { label: "Beta" } },
      { name: "missing", uid: "deadbeef-0000-4000-8000-000000000000" },
    ]);
    await runNamed(["--batch", f]);
    expect(loads.fullParse).toHaveBeenCalledTimes(1);
    const recs = records();
    // 8 labels: three assets + the five NamedQuery assets themselves.
    expect(recs[0]).toMatchObject({ name: "labels", ok: true, kind: "select", count: 8 });
    expect(recs[1]).toMatchObject({ name: "beta", ok: true, count: 1 });
    expect(recs[2]).toMatchObject({ name: "missing", ok: false, error: { type: "not-found" } });
    expect(recs[3]).toMatchObject({ type: "summary", graphLoads: 1, failed: 1 });
    expect(process.exitCode).toBe(5);

    // Parity with the single verb (its --format json document).
    const before = cap.consoleOut.length;
    try {
      await runQueryCommand().parseAsync(["node", "run-query", NQ_BY_LABEL, "--param", "label=Beta", "--format", "json", "--vault", vaultDir]);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    }
    const singleDoc = JSON.parse(cap.consoleOut.slice(before).join("\n")) as { data: { rows: unknown[] } };
    expect(recs[1].rows).toEqual(singleDoc.data.rows);
  }, 60000);

  const NAMED_CLASHES: Array<[string, string[], string]> = [
    ["R2a", [NQ_LABELS], "a positional uid"],
    ["R2b", ["--current-asset", "t1.md"], "--current-asset"],
    ["R2c", ["--param", "a=b"], "--param"],
    ["R2d", ["--param-iri", "a=t1.md"], "--param-iri"],
    ["R2e", ["--output", "json"], "--output"],
  ];
  for (const [axis, extra, named] of NAMED_CLASHES) {
    it(`${axis} @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch with ${named} is refused (it belongs in the entries)`, async () => {
      await runNamed([...extra, "--batch", batchFile([{ name: "labels", uid: NQ_LABELS }])]);
      expect(cap.exitCodes[0]).toBe(2);
      expect(cap.consoleOut.join("\n")).toContain(named);
      expect(cap.stdout).toEqual([]);
    }, 60000);
  }

  async function singleNamed(args: string[]): Promise<unknown[]> {
    const before = cap.consoleOut.length;
    try {
      await runQueryCommand().parseAsync(["node", "run-query", ...args, "--format", "json", "--vault", vaultDir]);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    }
    return (JSON.parse(cap.consoleOut.slice(before).join("\n")) as { data: { rows: unknown[] } }).data.rows;
  }

  async function runCurIri(): Promise<Array<Record<string, any>>> {
    await runNamed(["--batch", batchFile([
      { name: "cur", uid: NQ_CURRENT, currentAsset: "t2.md" },
      { name: "iri", uid: NQ_BY_IRI, paramsIri: { target: "t1.md" } },
    ])]);
    return records();
  }

  // R3a/R3b: the token is FILLED (no unset-token refusal); whether it is filled as an
  // IRI is R3c/R3d — split so "not passed" and "passed, but not as an IRI" differ.
  it("R3a @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: currentAsset fills $currentAsset (no unset-token)", async () => {
    expect((await runCurIri())[0].error?.type).not.toBe("unset-token");
  }, 60000);

  it("R3b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: paramsIri fills its $param (no unset-token)", async () => {
    expect((await runCurIri())[1].error?.type).not.toBe("unset-token");
  }, 60000);

  it("R3c @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: currentAsset reaches the body as an IRI — rows equal single run-query --current-asset", async () => {
    const [cur] = await runCurIri();
    const expected = await singleNamed([NQ_CURRENT, "--current-asset", "t2.md"]);
    expect(expected).toHaveLength(1);
    expect(cur.rows).toEqual(expected);
  }, 60000);

  it("R3d @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: paramsIri reaches the body as an IRI — rows equal single run-query --param-iri", async () => {
    const [, iri] = await runCurIri();
    const expected = await singleNamed([NQ_BY_IRI, "--param-iri", "target=t1.md"]);
    expect(expected).toHaveLength(1);
    expect(iri.rows).toEqual(expected);
  }, 60000);

  it("R4 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: a broken body answers error type syntax", async () => {
    await runNamed(["--batch", batchFile([{ name: "leak", uid: NQ_BROKEN, params: { label: "x" } }])]);
    expect(records()[0].error?.type).toBe("syntax");
  }, 60000);

  it("R4b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: the error carries no message — a param value from the file is never echoed (bcc041d8)", async () => {
    await runNamed(["--batch", batchFile([{ name: "leak", uid: NQ_BROKEN, params: { label: CANARY } }])]);
    expect([...cap.stdout, ...cap.stderr, ...cap.consoleOut].join("\n")).not.toContain("FAKE-CAN");
    expect(Object.keys(records()[0].error ?? {})).toEqual(["type"]);
  }, 60000);

  // Review of PR #4605 (HIGH 1): R4b locks only a PARSE error; a param value the
  // algebra translator quotes reaches an "execution" error — type only there too.
  it("R4c @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: an EXECUTION error carries the type only — a param value the translator quotes is never echoed (bcc041d8)", async () => {
    const NQ_AGG = "a1000000-0000-4000-8000-0000000000a6";
    fs.writeFileSync(path.join(vaultDir, "nq6.md"), namedQuery(NQ_AGG, "Aggregate inside BIND", "SELECT ?x WHERE { ?s ?p ?o BIND(SUM($pat) AS ?x) }"));
    await runNamed(["--batch", batchFile([{ name: "leak", uid: NQ_AGG, params: { pat: CANARY } }])]);
    expect([...cap.stdout, ...cap.stderr, ...cap.consoleOut].join("\n")).not.toContain("FAKE-CAN");
    expect(records()[0]).toMatchObject({ name: "leak", ok: false, error: { type: "execution" } });
    expect(Object.keys(records()[0].error ?? {})).toEqual(["type"]);
  }, 60000);

  it("R5 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: a $param the entry did not supply is refused (unset-token), not answered with every row", async () => {
    const f = batchFile([{ name: "typo", uid: NQ_BY_LABEL, params: { lable: "Beta" } }]);
    await runNamed(["--batch", f]);
    expect(records()[0]).toMatchObject({ name: "typo", ok: false, error: { type: "unset-token" } });
  }, 60000);

  it("R6 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: a batch whose only entry throws exits 5 and counts it failed", async () => {
    const f = batchFile([{ name: "leak", uid: NQ_BROKEN, params: { label: "x" } }]);
    await runNamed(["--batch", f]);
    expect(records()[1]).toMatchObject({ type: "summary", failed: 1, ok: 0 });
    expect(process.exitCode).toBe(5);
  }, 60000);

  // Review of PR #4605 (MEDIUM 2): B6 / B17b lock the flush and the EPIPE stop for
  // query --batch only; run-query --batch has its own loop.
  it("R7 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: an answer is flushed BEFORE the next entry runs", async () => {
    deferFlush = true;
    const original = core.NamedQueryRunner.prototype.run;
    jest.spyOn(core.NamedQueryRunner.prototype, "run").mockImplementation(function (this: unknown, ...args: unknown[]) {
      cap.events.push("run");
      return original.apply(this as never, args as never);
    } as never);
    await runNamed(["--batch", batchFile([{ name: "a", uid: NQ_LABELS }, { name: "b", uid: NQ_LABELS }])]);
    const ev = cap.events.filter((e) => e === "run" || e.startsWith("write:") || e.startsWith("flushed:"));
    expect(ev.slice(0, 4)).toEqual(["run", "write:a", "flushed:a", "run"]);
  }, 60000);

  it("R7b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea run-query --batch: once the reader is gone the batch stops — no further entry runs, rc 1", async () => {
    const run = jest.spyOn(core.NamedQueryRunner.prototype, "run");
    const { runNamedQueryBatch } = await import("../../src/commands/run-query-batch.js");
    await runNamedQueryBatch(
      batchFile([{ name: "a", uid: NQ_LABELS }, { name: "b", uid: NQ_LABELS }, { name: "c", uid: NQ_LABELS }]),
      { vault: vaultDir, useCache: false },
      { write: async () => { throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" }); }, progress: () => undefined },
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  }, 60000);
});
