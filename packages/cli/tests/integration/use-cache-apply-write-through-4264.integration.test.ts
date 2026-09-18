/**
 * #4264 — `--use-cache` on `apply` / `resolve-inline-buttons` / `create` with
 * write-through.
 *
 * Requirement: @req:cb707868-356f-495d-825a-182e66ba8bcd
 *
 * Production-shape (test-fixture-realism): every axis drives the REAL command
 * (`applyCommand()` / `resolveButtonsCommand()` / `createCommand()` via
 * `parseAsync`, or the exported `resolveButtons()` /
 * `CandidateShaclValidator`) against a temp vault with the real
 * `NoteToRDFConverter` + `FileSystemVaultAdapter` + `CacheManager`. Nothing is
 * mocked except process.exit / console / stdout / stderr capture, and — in ONE
 * axis, A5 — the write-through itself, to inject a persist failure.
 *
 * "Separate process" in the chain axes = a FRESH `applyCommand()` instance per
 * step, each constructing its own `CacheManager`; the only state shared
 * between steps is `.exocortex/cache/triples.json` on disk — exactly what
 * separates two real processes. (The CLI jest job has no built `dist`, so a
 * child-process chain is proved by the measurement script + release smoke in
 * the PR body, not here.)
 *
 * Axis ↔ scenario:
 *   A1 AC1 default off (no cache read/write, one convertVault)
 *   A2 AC2 byte-identical stdout with / without the flag
 *   A3 AC3 write-through: entry + stamp + next process is a HIT; only the
 *          changed file re-parsed (convertNote count)
 *   A4 AC4 three-step chain: every precondition sees the prior write, final
 *          file identical to the no-flag chain, steps 2/3 are hits
 *   A5 AC5 persist failure: rc / stdout / mutation unchanged, stderr warns,
 *          next reader still sees the write (delta)
 *   A6 AC6 rebuild-class mutation: cache left byte-identical, next reader
 *          rebuilds
 *   A7 AC7 a concurrent writer's fresher cache is not reverted
 *   A8 AC8 create: --validate loads through the loader (same verdict), a
 *          bare create writes through to an EXISTING cache only
 *   A9 AC9 exactly one stderr notice under the flag, none without it
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import fsExtra from "fs-extra";
import * as path from "path";
import { createHash } from "crypto";
import {
  NoteToRDFConverter,
  Triple,
  IRI,
  vaultPathToIRI,
} from "@kitelev/exocortex-core";

const { applyCommand } = await import("../../src/commands/apply.js");
const { resolveButtonsCommand } = await import(
  "../../src/commands/resolve-buttons.js"
);
const { createCommand } = await import("../../src/commands/create.js");
const { sparqlIndexCommand } = await import("../../src/commands/sparql-index.js");
const { CacheManager } = await import("../../src/cache/CacheManager.js");
const { CandidateShaclValidator } = await import(
  "../../src/services/CandidateShaclValidator.js"
);

const REQ = "@req:cb707868-356f-495d-825a-182e66ba8bcd";

import {
  TASK_CLASS,
  STATUS_DRAFT,
  STATUS_BACKLOG,
  STATUS_DOING,
  PROTO,
  PROTO_CLASS,
  CMD_CREATE,
  GND_CREATE,
  PD_DRAFT,
  CMD_BACKLOG,
  PRE_BACKLOG,
  GND_BACKLOG,
  CMD_START,
  PRE_START,
  GND_START,
  TBOX_TASK,
  BIND_START,
  BIND_BACKLOG,
  DRAFT_TASK,
  OTHER_TASK,
  PROTO_INSTANCE,
  CMD_INHERITED,
  PRE_INHERITED,
  GND_INHERITED,
  BIND_INHERITED,
  GT_SERVICE_CALL,
  SEED,
  FROZEN,
  CHAIN_LABEL,
  fm,
  statusAsk,
  command,
  precondition,
  propertySet,
  binding,
  taskMd,
  REL,
  buildVault,
} from "./fixtures/use-cache-4264-vault.js";

/** Build the cache once (full rebuild + persist) so later runs start warm. */
async function warmCache(root: string): Promise<void> {
  const result = await new CacheManager(root).loadOrBuild();
  if (result.mode !== "rebuild") {
    throw new Error(`warmCache expected a rebuild, got ${result.mode}`);
  }
}

interface CacheFile {
  metadata: {
    fileCount: number;
    tripleCount: number;
    inferredCount: number;
    inferenceEnabled: boolean;
  };
  files: Array<{
    path: string;
    mtimeMs: number;
    size: number;
    triples: Array<{ object: { value: string } }>;
  }>;
  inferred: Array<{ object: { value: string } }>;
}

function readCache(root: string): CacheFile {
  return JSON.parse(fs.readFileSync(path.join(root, REL.cache), "utf-8")) as CacheFile;
}

function sha(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

interface Run {
  stdout: string;
  stderr: string;
  logs: string[];
  errors: string[];
  exitCode: number | null;
}

describe(`#4264 --use-cache on apply / resolve-buttons / create with write-through ${REQ}`, () => {
  let roots: string[];
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    roots = [];
    stdoutChunks = [];
    stderrChunks = [];
    // Recorder, not a thrower: `create` calls process.exit(0) INSIDE its try
    // block on success, and a throwing mock would turn that into a caught
    // "error" (ErrorHandler → exit 1). The first recorded code is the rc.
    exitCodes = [];
    jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0);
    }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stdoutChunks.push(chunk.toString());
      return true;
    }) as never);
    jest.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderrChunks.push(chunk.toString());
      return true;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  function vault(): string {
    const root = buildVault();
    roots.push(root);
    return root;
  }

  /** Run ONE command invocation and collect everything it emitted. */
  async function run(exec: () => Promise<unknown>): Promise<Run> {
    stdoutChunks = [];
    stderrChunks = [];
    consoleLogSpy.mockClear();
    consoleErrorSpy.mockClear();
    exitCodes = [];
    await exec();
    return {
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      logs: consoleLogSpy.mock.calls.map((c) => String(c[0])),
      errors: consoleErrorSpy.mock.calls.map((c) => String(c[0])),
      // `null` = the command never called process.exit (apply's success path);
      // otherwise the FIRST code it asked for.
      exitCode: exitCodes.length > 0 ? exitCodes[0] : null,
    };
  }

  /** A fresh `applyCommand()` per call = a separate process as far as the cache is concerned. */
  const runApply = (root: string, args: string[]): Promise<Run> =>
    run(() => applyCommand().parseAsync(["node", "apply", ...args, "--vault", root]));

  const runResolve = (root: string, args: string[]): Promise<Run> =>
    run(() =>
      resolveButtonsCommand().parseAsync([...args, "--vault", root], { from: "user" }),
    );

  const runCreate = (root: string, args: string[]): Promise<Run> =>
    run(() => createCommand().parseAsync(["node", "create", ...args, "--vault", root]));

  const createArgs = (extra: string[]): string[] => [
    "create-task-instance-4264",
    REL.proto,
    "--input",
    JSON.stringify({ label: CHAIN_LABEL }),
    "--seed",
    SEED,
    "--frozen-clock",
    FROZEN,
    "--json",
    ...extra,
  ];

  const cacheNotices = (r: Run): string[] =>
    r.stderr.split("\n").filter((l) => /triple cache: (hit|delta|rebuild)/.test(l));
  const writeThroughNotices = (r: Run): string[] =>
    r.stderr.split("\n").filter((l) => /write-through/.test(l));
  const preconditionRefused = (r: Run): boolean =>
    r.errors.some((e) => /Precondition not satisfied/.test(e));

  function createdPath(r: Run): string {
    const parsed = JSON.parse(r.stdout) as { created: Array<{ path: string }> };
    expect(parsed.created).toHaveLength(1);
    return parsed.created[0].path;
  }

  // -------------------------------------------------------------------------
  it(`A1 ${REQ} without --use-cache none of the three commands touches the cache: CacheManager never loads, no cache file appears, one convertVault per command`, async () => {
    const root = vault();
    const loadSpy = jest.spyOn(CacheManager.prototype, "loadOrBuild");
    const refreshSpy = jest.spyOn(CacheManager.prototype, "refreshAfterWrite");
    const convertVaultSpy = jest.spyOn(NoteToRDFConverter.prototype, "convertVault");

    const a = await runApply(root, ["move-to-backlog-4264", REL.draftTask, "--json"]);
    expect(a.exitCode).toBeNull();
    expect(preconditionRefused(a)).toBe(false);
    expect(fs.readFileSync(path.join(root, REL.draftTask), "utf-8")).toContain(`[[${STATUS_BACKLOG}]]`);
    expect(convertVaultSpy).toHaveBeenCalledTimes(1);

    const r = await runResolve(root, [REL.otherTask, "--json"]);
    expect(r.exitCode).toBeNull();
    expect(convertVaultSpy).toHaveBeenCalledTimes(2);

    const c = await runCreate(root, ["--class", TASK_CLASS, "--label", "A1 task", "--validate", "--dry-run"]);
    expect(c.exitCode).toBe(0);
    expect(convertVaultSpy).toHaveBeenCalledTimes(3);

    expect(loadSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, ".exocortex"))).toBe(false);
    expect(cacheNotices(a).concat(cacheNotices(r), cacheNotices(c))).toEqual([]);

    // The same on a vault that already HAS a cache: a real write without the
    // flag leaves the cache file byte-identical (no read, no write-through).
    await warmCache(root);
    loadSpy.mockClear();
    const cacheBefore = sha(path.join(root, REL.cache));
    const w = await runApply(root, ["start-effort-4264", REL.draftTask, "--json"]);
    expect(w.exitCode).toBeNull();
    expect(fs.readFileSync(path.join(root, REL.draftTask), "utf-8")).toContain(`[[${STATUS_DOING}]]`);
    const cw = await runCreate(root, ["--class", TASK_CLASS, "--label", "A1 written", "--validate"]);
    expect(cw.exitCode).toBe(0);
    expect(fs.existsSync(path.join(root, (JSON.parse(cw.stdout) as { path: string }).path))).toBe(true);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(sha(path.join(root, REL.cache))).toBe(cacheBefore);
    expect(w.stderr + cw.stderr).not.toMatch(/triple cache/);
  });

  // -------------------------------------------------------------------------
  it(`A2 ${REQ} stdout of apply --json / --dry-run, resolve-buttons --json and create --validate is byte-identical with and without --use-cache on the same vault state`, async () => {
    const plain = vault();
    const cached = vault();
    await warmCache(cached);

    // apply --dry-run (console.log lines) — precondition-only path
    const d1 = await runApply(plain, ["move-to-backlog-4264", REL.draftTask, "--dry-run"]);
    const d2 = await runApply(cached, ["move-to-backlog-4264", REL.draftTask, "--dry-run", "--use-cache"]);
    expect(d2.logs).toEqual(d1.logs);
    expect(d2.stdout).toBe(d1.stdout);
    expect(cacheNotices(d2)).toHaveLength(1);

    // apply --json (real mutation) — envelope + written file
    const j1 = await runApply(plain, ["move-to-backlog-4264", REL.draftTask, "--json"]);
    const j2 = await runApply(cached, ["move-to-backlog-4264", REL.draftTask, "--json", "--use-cache"]);
    expect(j2.stdout).toBe(j1.stdout);
    expect(JSON.parse(j2.stdout)).toEqual({ command: "move-to-backlog-4264", created: [], target: REL.draftTask });
    expect(fs.readFileSync(path.join(cached, REL.draftTask), "utf-8")).toBe(
      fs.readFileSync(path.join(plain, REL.draftTask), "utf-8"),
    );

    // create-task-instance --json with a seed + frozen clock → identical file bytes
    const c1 = await runApply(plain, createArgs([]));
    const c2 = await runApply(cached, createArgs(["--use-cache"]));
    expect(c2.stdout).toBe(c1.stdout);
    const created = createdPath(c1);
    expect(fs.readFileSync(path.join(cached, created), "utf-8")).toBe(
      fs.readFileSync(path.join(plain, created), "utf-8"),
    );

    // start-effort --json on the Backlog task
    const s1 = await runApply(plain, ["start-effort-4264", REL.otherTask, "--json"]);
    const s2 = await runApply(cached, ["start-effort-4264", REL.otherTask, "--json", "--use-cache"]);
    expect(s2.stdout).toBe(s1.stdout);

    // resolve-buttons --json (the whole structured document)
    const r1 = await runResolve(plain, [REL.draftTask, "--json", "--show-hidden"]);
    const r2 = await runResolve(cached, [REL.draftTask, "--json", "--show-hidden", "--use-cache"]);
    expect(r2.logs).toEqual(r1.logs);
    expect(r2.stdout).toBe(r1.stdout);
    const doc = JSON.parse(r1.logs.join("\n")) as { visible: unknown[]; hidden: unknown[] };
    expect(doc.visible.length + doc.hidden.length).toBe(3); // all three ems__Task bindings resolved (Layer A)

    // create --validate --dry-run: uid / timestamps are minted per run, so
    // the comparison masks them; everything else (path folder, label,
    // preview shape, verdict) must be identical.
    const mask = (s: string): string =>
      s
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "<uid>")
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "<ts>");
    const v1 = await runCreate(plain, ["--class", TASK_CLASS, "--label", "A2 task", "--validate", "--dry-run"]);
    const v2 = await runCreate(cached, ["--class", TASK_CLASS, "--label", "A2 task", "--validate", "--dry-run", "--use-cache"]);
    expect(v1.exitCode).toBe(0);
    expect(v2.exitCode).toBe(0);
    expect(mask(v2.stdout)).toBe(mask(v1.stdout));
    expect(cacheNotices(v2)).toHaveLength(1);
    expect(mask(v2.stderr.split("\n").filter((l) => !/triple cache/.test(l)).join("\n"))).toBe(
      mask(v1.stderr),
    );
  });

  // -------------------------------------------------------------------------
  it(`A2b ${REQ} on an INDEX-built cache the flagged store additionally carries the inferred layer (documented divergence, same as query --use-cache): a command gated on an inherited property is hidden without the flag, visible with it; a cache the flag built itself has no layer and stays byte-identical; a write-through keeps the layer`, async () => {
    const root = vault();
    const runButtons = async (flag: boolean): Promise<{ visible: string[]; hidden: string[]; stdout: string }> => {
      const r = await runResolve(root, [REL.protoInstance, "--json", "--show-hidden", ...(flag ? ["--use-cache"] : [])]);
      const doc = JSON.parse(r.logs.join("\n")) as { visible: Array<{ id: string }>; hidden: Array<{ id: string }> };
      return { visible: doc.visible.map((e) => e.id), hidden: doc.hidden.map((e) => e.id), stdout: r.logs.join("\n") };
    };

    // No flag: the explicit graph only — the inherited-owner command is hidden.
    const plain = await runButtons(false);
    expect(plain.hidden).toContain(CMD_INHERITED);
    expect(plain.visible).not.toContain(CMD_INHERITED);

    // Cache built by --use-cache itself (rebuild → no inferred layer): identical.
    const built = await runButtons(true);
    expect(built.stdout).toBe(plain.stdout);
    expect(readCache(root).metadata.inferredCount).toBe(0);

    // The real `index` (what the bot runs): persists the inferred layer.
    const idx = await run(() =>
      sparqlIndexCommand().parseAsync(["node", "index", "--vault", root, "--force"]),
    );
    expect(idx.logs.join("\n")).toMatch(/Materialized \d+ inferred triples/);
    const indexed = readCache(root);
    expect(indexed.metadata.inferenceEnabled).toBe(true);
    expect(indexed.metadata.inferredCount).toBeGreaterThan(0);

    // With the flag the store = explicit + inferred → the inherited owner is
    // there and the command is VISIBLE; without the flag nothing changed.
    const withLayer = await runButtons(true);
    expect(withLayer.visible).toContain(CMD_INHERITED);
    expect((await runButtons(false)).hidden).toContain(CMD_INHERITED);

    // A write-through on the prototype-bearing instance re-materializes the
    // layer (prototype-bearing file = engine input) instead of dropping it.
    const w = await runApply(root, ["move-to-backlog-4264", REL.protoInstance, "--json", "--use-cache"]);
    expect(preconditionRefused(w)).toBe(false);
    expect(writeThroughNotices(w)).toEqual(["💾 triple cache: write-through persisted (1 file(s) re-parsed)"]);
    const after = readCache(root);
    expect(after.metadata.inferenceEnabled).toBe(true);
    expect(after.metadata.inferredCount).toBeGreaterThan(0);
    const still = await runButtons(true);
    expect(still.visible).toContain(CMD_INHERITED);
    expect((await new CacheManager(root).loadOrBuild()).mode).toBe("hit");
  });

  // -------------------------------------------------------------------------
  it(`A3 ${REQ} a mutating apply --use-cache writes its change through: the created file's entry (fresh stamp + triples) is in the cache, only that file was re-parsed, and the next --use-cache process is a plain hit`, async () => {
    const root = vault();
    await warmCache(root);
    const before = readCache(root);
    const convertNoteSpy = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");

    const r = await runApply(root, createArgs(["--use-cache"]));
    expect(r.exitCode).toBeNull();
    const created = createdPath(r);
    expect(cacheNotices(r)).toEqual(["⚡ triple cache: hit"]);
    expect(writeThroughNotices(r)).toEqual([
      "💾 triple cache: write-through persisted (1 file(s) re-parsed)",
    ]);
    // The load was a hit (0 re-parsed); the write-through re-parsed exactly the
    // one file the command created — never the vault.
    expect(convertNoteSpy).toHaveBeenCalledTimes(1);
    expect((convertNoteSpy.mock.calls[0][0] as { path: string }).path).toBe(created);

    const after = readCache(root);
    expect(after.metadata.fileCount).toBe(before.metadata.fileCount + 1);
    const entry = after.files.find((e) => e.path === created);
    expect(entry).toBeDefined();
    const stat = fs.statSync(path.join(root, created));
    expect(entry!.mtimeMs).toBe(stat.mtimeMs);
    expect(entry!.size).toBe(stat.size);
    expect(entry!.triples.some((t) => t.object.value === CHAIN_LABEL)).toBe(true);
    // Untouched entries are carried over verbatim.
    for (const old of before.files) {
      expect(after.files.find((e) => e.path === old.path)).toEqual(old);
    }

    // Next process: plain hit, triples contain the new asset.
    const next = await new CacheManager(root).loadOrBuild();
    expect(next.mode).toBe("hit");
    expect(next.reparsedFiles).toBe(0);
    const subject = vaultPathToIRI(created);
    expect(next.triples.some((t) => String((t.subject as { value: string }).value) === subject)).toBe(true);
  });

  // -------------------------------------------------------------------------
  it(`A4 ${REQ} the three-process chain create-task-instance → move-to-backlog → start-effort, each --use-cache, never evaluates a precondition on stale state; steps 2 and 3 are hits; the result equals the no-flag chain byte for byte`, async () => {
    const cached = vault();
    const plain = vault();
    await warmCache(cached);

    // --- with the flag, one fresh applyCommand() per step ---
    const p1 = await runApply(cached, createArgs(["--use-cache"]));
    expect(p1.exitCode).toBeNull();
    const created = createdPath(p1);
    expect(fs.readFileSync(path.join(cached, created), "utf-8")).toContain(`[[${STATUS_DRAFT}]]`);

    const p2 = await runApply(cached, ["move-to-backlog-4264", created, "--json", "--use-cache"]);
    expect(preconditionRefused(p2)).toBe(false);
    expect(p2.exitCode).toBeNull();
    expect(cacheNotices(p2)).toEqual(["⚡ triple cache: hit"]);
    expect(fs.readFileSync(path.join(cached, created), "utf-8")).toContain(`[[${STATUS_BACKLOG}]]`);

    const p3 = await runApply(cached, ["start-effort-4264", created, "--json", "--use-cache"]);
    expect(preconditionRefused(p3)).toBe(false);
    expect(p3.exitCode).toBeNull();
    expect(cacheNotices(p3)).toEqual(["⚡ triple cache: hit"]);
    const finalCached = fs.readFileSync(path.join(cached, created), "utf-8");
    expect(finalCached).toContain(`[[${STATUS_DOING}]]`);

    // The persisted cache reflects the LAST write too (start-effort's Doing).
    const last = await new CacheManager(cached).loadOrBuild();
    expect(last.mode).toBe("hit");
    const doingIri = "https://exocortex.my/ontology/ems#EffortStatusDoing";
    const subject = vaultPathToIRI(created);
    expect(
      last.triples.some(
        (t) =>
          String((t.subject as { value: string }).value) === subject &&
          String((t.object as { value: string }).value) === doingIri,
      ),
    ).toBe(true);

    // --- the same chain without the flag on a twin vault ---
    const q1 = await runApply(plain, createArgs([]));
    expect(createdPath(q1)).toBe(created);
    const q2 = await runApply(plain, ["move-to-backlog-4264", created, "--json"]);
    const q3 = await runApply(plain, ["start-effort-4264", created, "--json"]);
    expect(preconditionRefused(q2) || preconditionRefused(q3)).toBe(false);
    expect(fs.readFileSync(path.join(plain, created), "utf-8")).toBe(finalCached);
    expect([p1.stdout, p2.stdout, p3.stdout]).toEqual([q1.stdout, q2.stdout, q3.stdout]);
  });

  // -------------------------------------------------------------------------
  it(`A5 ${REQ} a failing write-through changes nothing about the command: exit code and --json stdout as on success, the mutation stays, one stderr warning, and the next reader still sees the write via a delta`, async () => {
    const root = vault();
    await warmCache(root);
    const cacheBefore = sha(path.join(root, REL.cache));
    jest
      .spyOn(CacheManager.prototype, "refreshAfterWrite")
      .mockRejectedValue(new Error("disk full (injected)"));

    const r = await runApply(root, ["move-to-backlog-4264", REL.draftTask, "--json", "--use-cache"]);
    expect(r.exitCode).toBeNull(); // success path never calls process.exit
    expect(JSON.parse(r.stdout)).toEqual({ command: "move-to-backlog-4264", created: [], target: REL.draftTask });
    expect(fs.readFileSync(path.join(root, REL.draftTask), "utf-8")).toContain(`[[${STATUS_BACKLOG}]]`);
    expect(writeThroughNotices(r)).toEqual([
      "⚠ triple cache: write-through failed (disk full (injected)) — command result unaffected; the next --use-cache run refreshes the cache itself",
    ]);
    expect(sha(path.join(root, REL.cache))).toBe(cacheBefore);

    jest.restoreAllMocks();
    const next = await new CacheManager(root).loadOrBuild();
    expect(next.mode).toBe("delta");
    expect(next.reparsedFiles).toBe(1);
    const backlogIri = "https://exocortex.my/ontology/ems#EffortStatusBacklog";
    const subject = vaultPathToIRI(REL.draftTask);
    expect(
      next.triples.some(
        (t) =>
          String((t.subject as { value: string }).value) === subject &&
          String((t.object as { value: string }).value) === backlogIri,
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  it(`A6 ${REQ} a rebuild-class mutation (a TBox-form-labelled asset changes) is not written through: the cache file stays byte-identical, no re-parse happens in the mutating process, the next reader rebuilds`, async () => {
    const root = vault();
    await warmCache(root);
    const cacheBefore = sha(path.join(root, REL.cache));
    const convertNoteSpy = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");

    const r = await runApply(root, ["move-to-backlog-4264", REL.tboxTask, "--json", "--use-cache"]);
    expect(r.exitCode).toBeNull();
    expect(preconditionRefused(r)).toBe(false);
    expect(fs.readFileSync(path.join(root, REL.tboxTask), "utf-8")).toContain(`[[${STATUS_BACKLOG}]]`);
    expect(writeThroughNotices(r)).toHaveLength(1);
    expect(writeThroughNotices(r)[0]).toMatch(
      /^💾 triple cache: write-through skipped \(rebuild needed \(TBox-form asset changed: .*\) — left to the next reader\)$/,
    );
    expect(convertNoteSpy).not.toHaveBeenCalled();
    expect(sha(path.join(root, REL.cache))).toBe(cacheBefore);

    const next = await new CacheManager(root).loadOrBuild();
    expect(next.mode).toBe("rebuild");
  });

  // -------------------------------------------------------------------------
  it(`A7 ${REQ} a concurrent writer's fresher cache is never reverted: the write-through re-parses the file the other process changed as well, and the merged cache is a hit for the next reader`, async () => {
    const root = vault();
    await warmCache(root);

    // Process A loads (hit) and keeps its state in memory.
    const a = new CacheManager(root);
    expect((await a.loadOrBuild()).mode).toBe("hit");

    // Meanwhile another process edits G and persists a refreshed cache.
    const gPath = path.join(root, REL.otherTask);
    fs.writeFileSync(gPath, taskMd(OTHER_TASK, "Other task EDITED BY B", STATUS_BACKLOG), "utf-8");
    const b = await new CacheManager(root).loadOrBuild();
    expect(b.mode).toBe("delta");

    // A now writes F and writes through against ITS loaded state.
    const fPath = path.join(root, REL.draftTask);
    fs.writeFileSync(fPath, taskMd(DRAFT_TASK, "Draft task EDITED BY A", STATUS_DRAFT), "utf-8");
    const wt = await a.refreshAfterWrite();
    expect(wt.mode).toBe("delta");
    // A's snapshot predates B's persist: the cache file's stamp changed, so A
    // drops its snapshot, re-reads B's cache (fresh G already in it) and only
    // its OWN write F needs a re-parse. (Without the stamp guard A would diff
    // its stale snapshot: G re-parsed too, correct but paid twice — and the
    // metadata B wrote, e.g. an inferred layer, would be lost: see A7b.)
    expect(wt.reparsedFiles).toBe(1);

    const persisted = readCache(root);
    const labelOf = (rel: string): string[] =>
      persisted.files.find((e) => e.path === rel)!.triples.map((t) => t.object.value);
    expect(labelOf(REL.otherTask)).toContain("Other task EDITED BY B");
    expect(labelOf(REL.draftTask)).toContain("Draft task EDITED BY A");
    expect(persisted.files.find((e) => e.path === REL.otherTask)!.mtimeMs).toBe(fs.statSync(gPath).mtimeMs);

    const next = await new CacheManager(root).loadOrBuild();
    expect(next.mode).toBe("hit");
  });

  it(`A7b ${REQ} a concurrent \`index\` (inferred layer + inferenceEnabled, no vault file touched) is never reverted: the write-through folds F into the cache index persisted, keeps its inferred layer and the flag`, async () => {
    const root = vault();
    await warmCache(root);

    // Process A loads (hit) — the cache has no inferred layer yet.
    const a = new CacheManager(root);
    const loadedByA = await a.loadOrBuild();
    expect(loadedByA.mode).toBe("hit");
    expect(readCache(root).metadata.inferredCount).toBe(0);

    // Meanwhile `index` materializes and persists the inferred layer — a
    // change to the CACHE FILE only; no vault file's stamp moves.
    const marker = new Triple(
      new IRI(vaultPathToIRI(REL.proto)),
      new IRI("https://exocortex.my/ontology/exo#Instance_class"),
      new IRI("https://exocortex.my/ontology/ems#Task"),
    );
    await new CacheManager(root).saveInferredTriples([marker]);
    const afterIndex = readCache(root);
    expect(afterIndex.metadata.inferenceEnabled).toBe(true);
    expect(afterIndex.metadata.inferredCount).toBe(1);

    // A now writes F and writes through.
    fs.writeFileSync(
      path.join(root, REL.draftTask),
      taskMd(DRAFT_TASK, "Draft task EDITED BY A", STATUS_DRAFT),
      "utf-8",
    );
    const wt = await a.refreshAfterWrite();
    expect(wt.mode).toBe("delta");
    expect(wt.reparsedFiles).toBe(1);

    const persisted = readCache(root);
    expect(persisted.metadata.inferenceEnabled).toBe(true); // index's flag survived
    // The edit touched no engine input, so #4263's gate keeps index's layer
    // verbatim — the marker triple is still there, count unchanged.
    expect(persisted.metadata.inferredCount).toBe(1);
    expect(persisted.inferred.map((t) => t.object.value)).toEqual([
      "https://exocortex.my/ontology/ems#Task",
    ]);
    expect(
      persisted.files.find((e) => e.path === REL.draftTask)!.triples.map((t) => t.object.value),
    ).toContain("Draft task EDITED BY A");
    const next = await new CacheManager(root).loadOrBuild();
    expect(next.mode).toBe("hit");
    expect(next.triples.length).toBe(loadedByA.triples.length + 1); // + the inferred marker
  });

  // -------------------------------------------------------------------------
  it(`A8 ${REQ} create: --validate --use-cache loads the vault context through the loader with the same verdict as the full parse; a bare create --use-cache writes through to an EXISTING cache and never builds one`, async () => {
    const root = vault();

    // (a) no cache on disk: create --use-cache writes the asset, does NOT
    //     build a cache, and does not load anything.
    const loadSpy = jest.spyOn(CacheManager.prototype, "loadOrBuild");
    const convertVaultSpy = jest.spyOn(NoteToRDFConverter.prototype, "convertVault");
    const c0 = await runCreate(root, ["--class", TASK_CLASS, "--label", "A8 first", "--use-cache"]);
    expect(c0.exitCode).toBe(0);
    const first = JSON.parse(c0.stdout) as { path: string };
    expect(fs.existsSync(path.join(root, first.path))).toBe(true);
    expect(fs.existsSync(path.join(root, ".exocortex"))).toBe(false);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(convertVaultSpy).not.toHaveBeenCalled();
    expect(writeThroughNotices(c0)).toEqual([
      "💾 triple cache: write-through skipped (no cache to refresh)",
    ]);

    // (b) warm cache: the created asset lands in the cache, next reader hits.
    await warmCache(root);
    loadSpy.mockClear();
    const convertNoteSpy = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");
    const c1 = await runCreate(root, ["--class", TASK_CLASS, "--label", "A8 second", "--use-cache"]);
    expect(c1.exitCode).toBe(0);
    const second = JSON.parse(c1.stdout) as { path: string };
    expect(loadSpy).not.toHaveBeenCalled(); // no --validate → no triple-store load
    expect(convertNoteSpy).toHaveBeenCalledTimes(1);
    expect(writeThroughNotices(c1)).toEqual([
      "💾 triple cache: write-through persisted (1 file(s) re-parsed)",
    ]);
    const entry = readCache(root).files.find((e) => e.path === second.path);
    expect(entry).toBeDefined();
    expect(entry!.triples.some((t) => t.object.value === "A8 second")).toBe(true);
    expect((await new CacheManager(root).loadOrBuild()).mode).toBe("hit");

    // (c) --validate: same verdict through the loader (hit) as through the
    //     full parse — asserted on the validator itself with a candidate that
    //     carries a dangling class ref (→ an open-world WARNING, non-empty).
    const candidateRel = `Inbox/${"42640000-0000-4000-8000-0000000000ee"}.md`;
    const candidate = fm([
      "exo__Asset_uid: 42640000-0000-4000-8000-0000000000ee",
      'exo__Asset_label: "A8 candidate"',
      `exo__Instance_class: ["[[${TASK_CLASS}]]"]`,
      `ems__Effort_status: "[[${STATUS_DRAFT}]]"`,
      'ems__Effort_parent: "[[00000000-dead-4000-8000-000000000000]]"',
    ]);
    convertVaultSpy.mockClear();
    loadSpy.mockClear();
    const plainVerdict = await new CandidateShaclValidator(root).validateCandidate(candidateRel, candidate);
    expect(convertVaultSpy).toHaveBeenCalledTimes(1);
    const lines: string[] = [];
    const cachedVerdict = await new CandidateShaclValidator(root, {
      useCache: true,
      log: (l) => lines.push(l),
    }).validateCandidate(candidateRel, candidate);
    expect(convertVaultSpy).toHaveBeenCalledTimes(1); // the cached run did NOT parse the vault
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(["⚡ triple cache: hit"]);
    expect(cachedVerdict).toEqual(plainVerdict);

    // (d) a REAL `create --validate --use-cache`: ONE cache load (the
    //     validator's, a hit) and the write-through reuses that loaded state —
    //     the cache file is read exactly once in the whole invocation.
    loadSpy.mockClear();
    convertNoteSpy.mockClear();
    const readJson = jest.spyOn(fsExtra, "readJson");
    const c2 = await runCreate(root, ["--class", TASK_CLASS, "--label", "A8 third", "--validate", "--use-cache"]);
    expect(c2.exitCode).toBe(0);
    const third = JSON.parse(c2.stdout) as { path: string };
    expect(cacheNotices(c2)).toEqual(["⚡ triple cache: hit"]);
    expect(writeThroughNotices(c2)).toEqual([
      "💾 triple cache: write-through persisted (1 file(s) re-parsed)",
    ]);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(readJson).toHaveBeenCalledTimes(1);
    expect(convertNoteSpy).toHaveBeenCalledTimes(1);
    expect(readCache(root).files.some((e) => e.path === third.path)).toBe(true);
    expect((await new CacheManager(root).loadOrBuild()).mode).toBe("hit");
  });

  // -------------------------------------------------------------------------
  it(`A9 ${REQ} under --use-cache each command prints exactly one load notice on stderr (plus one write-through outcome for a mutating command) and nothing extra on stdout; without the flag it prints none`, async () => {
    const root = vault();
    await warmCache(root);

    const a = await runApply(root, ["move-to-backlog-4264", REL.draftTask, "--json", "--use-cache"]);
    expect(cacheNotices(a)).toEqual(["⚡ triple cache: hit"]);
    expect(writeThroughNotices(a)).toHaveLength(1);
    expect(() => JSON.parse(a.stdout)).not.toThrow();
    expect(a.stdout).not.toMatch(/triple cache/);

    // dry-run: a load notice but NO write-through (nothing was written)
    const d = await runApply(root, ["start-effort-4264", REL.otherTask, "--dry-run", "--use-cache"]);
    expect(cacheNotices(d)).toEqual(["⚡ triple cache: hit"]);
    expect(writeThroughNotices(d)).toEqual([]);

    const r = await runResolve(root, [REL.otherTask, "--json", "--use-cache"]);
    expect(cacheNotices(r)).toEqual(["⚡ triple cache: hit"]);
    expect(() => JSON.parse(r.logs.join("\n"))).not.toThrow();
    expect(r.logs.join("\n")).not.toMatch(/triple cache/);

    const c = await runCreate(root, ["--class", TASK_CLASS, "--label", "A9 task", "--validate", "--dry-run", "--use-cache"]);
    expect(cacheNotices(c)).toEqual(["⚡ triple cache: hit"]);
    expect(writeThroughNotices(c)).toEqual([]); // dry-run writes nothing
    expect(() => JSON.parse(c.stdout)).not.toThrow();

    const a0 = await runApply(root, ["start-effort-4264", REL.otherTask, "--dry-run"]);
    const r0 = await runResolve(root, [REL.otherTask, "--json"]);
    expect(cacheNotices(a0).concat(writeThroughNotices(a0), cacheNotices(r0))).toEqual([]);
    expect(a0.stderr).toBe("");
  });
});
