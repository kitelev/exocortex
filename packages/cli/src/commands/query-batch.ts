/**
 * `query --batch <file>` and `run-query --batch <file>` (RFC 049bc5f1, variant A —
 * ticket 8ada0615): many named queries, ONE graph load, answers by name.
 *
 * Contract (every line below is locked by an axis in
 * tests/integration/query-batch-8ada0615.integration.test.ts):
 *
 * - stdout carries ONLY NDJSON: one `{"type":"result",…}` line per entry, in
 *   input order, then one `{"type":"summary",…}` line. Progress goes to stderr.
 *   A missing summary line means the batch did not finish. Tell lines apart by
 *   `type`, never by `name` (an entry may be NAMED "summary"). Split the stream
 *   on "\n" only: U+2028 / U+2029 / U+0085 inside values are emitted as JSON
 *   escapes, so a `splitlines()`-style reader cannot cut a line either.
 * - Each line is handed to the OS (write callback) BEFORE the next entry starts,
 *   so an external `kill` keeps every answer already computed.
 * - Each entry has its own try/catch; nothing inside the loop calls
 *   `process.exit`. Any failed entry ⇒ `process.exitCode = OPERATION_FAILED`.
 * - The graph is loaded at most ONCE per batch (`graphLoads` ∈ {0, 1} in the
 *   summary; 0 when no entry needed it — all served by the result cache, see
 *   `queryResultCacheHits`, or all refused before execution).
 * - The result-cache vault signature is computed at most ONCE per batch, and
 *   only when the result cache is in play (`--no-cache` ⇒ never).
 * - UPDATE (`INSERT DATA` / `DELETE DATA`) is refused per entry, never executed.
 * - ems__Bug bcc041d8 carries over: the batch file is a file the caller named by
 *   path, so no error — neither of the file nor of an entry — quotes its content
 *   (for run-query --batch too: entry params are substituted into the body
 *   before parsing, so a parser message would quote them).
 * - The result cache is best-effort: a failed cache WRITE never discards the
 *   computed answer (stderr warning with the errno code).
 */
import { readFileSync, existsSync, statSync } from "fs";
import { resolve } from "path";
// ⛔ Import from core ONLY names `sparql-query.ts` already imports: two unit suites
// replace the whole module with a hand-written factory, and a new name here fails
// them at link time (harness-invocation-surface §A146). `run-query --batch` lives
// in run-query-batch.ts for the same reason (NamedQueryCliRunner → NodeFsAdapter).
import {
  InMemoryTripleStore,
  ExoQLParser,
  SPARQLParseError,
  type AlgebraOperation,
  type Triple,
} from "@kitelev/exocortex-core";
import { TriplesFormatter } from "../formatters/TriplesFormatter.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import {
  CLIError,
  InvalidArgumentsError,
  FileNotFoundError,
  QueryTimeoutError,
  VaultNotFoundError,
} from "../utils/errors/index.js";
import {
  loadVaultTriples,
  skippedFilesNotice,
  type LoadVaultTriplesResult,
} from "../cache/loadVaultTriples.js";
import { QueryResultCache } from "../cache/QueryResultCache.js";
import { computeVaultSignature } from "../cache/vaultSignature.js";
import { scanVaultNamespaces } from "../utils/VaultNamespaceScanner.js";
import {
  injectExocortexPrefixes,
  transformShorthandNotation,
  filterOntologyPrefixes,
} from "../utils/QueryPrefixInjector.js";

/** An entry name: echoed in every answer, so restricted to a safe alphabet. */
export const BATCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export interface SparqlBatchEntry {
  name: string;
  sparql: string;
}

export interface NamedQueryBatchEntry {
  name: string;
  uid: string;
  currentAsset?: string;
  params?: Record<string, string>;
  paramsIri?: Record<string, string>;
}

export type BatchErrorType =
  | "syntax"
  | "update-rejected"
  | "timeout"
  | "execution"
  | "not-found"
  | "load";

/** One NDJSON line of the batch output. */
export type BatchRecord = Record<string, unknown> & { type: "result" | "summary" };

/**
 * One NDJSON line. `JSON.stringify` leaves U+2028, U+2029 and U+0085 raw inside
 * strings; Python's `str.splitlines()` (and some other readers) cut lines on
 * them. Escaping keeps the JSON identical in value and the line unbreakable.
 */
export function ndjsonLine(record: unknown): string {
  return JSON.stringify(record).replace(
    /[\u2028\u2029\u0085]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Where the batch writes; injectable for tests. */
export interface BatchSink {
  write(line: string): Promise<void>;
  progress(message: string): void;
}

/**
 * Line writer over a Node stream: resolves only when the stream has accepted
 * the chunk (the write callback). On a pipe that is asynchronous on macOS, so
 * `await` here is what makes "flushed before the next entry starts" true.
 */
export function streamSink(
  out: NodeJS.WritableStream = process.stdout,
  err: NodeJS.WritableStream = process.stderr,
): BatchSink {
  // A closed reader (EPIPE) arrives as an 'error' EVENT as well as through the
  // write callback; without a listener Node crashes with a stack trace. The
  // callback path below decides what happens (stop, rc 1).
  out.on("error", () => undefined);
  return {
    write: (line: string) =>
      new Promise<void>((resolveWrite, rejectWrite) => {
        out.write(`${line}\n`, (error?: Error | null) => {
          if (error) rejectWrite(error);
          else resolveWrite();
        });
      }),
    progress: (message: string) => {
      err.write(`${message}\n`);
    },
  };
}

// ---------------------------------------------------------------------------
// Batch file
// ---------------------------------------------------------------------------

/**
 * Read and validate a batch file. Every refusal names the file path and, for a
 * bad entry, its INDEX and FIELD — never a value from the file (bcc041d8):
 * `JSON.parse`'s own message quotes the input, so it is never forwarded.
 */
export function readBatchFile(
  batchPath: string,
  kind: "sparql",
): SparqlBatchEntry[];
export function readBatchFile(
  batchPath: string,
  kind: "named",
): NamedQueryBatchEntry[];
export function readBatchFile(
  batchPath: string,
  kind: "sparql" | "named",
): SparqlBatchEntry[] | NamedQueryBatchEntry[] {
  const full = resolve(batchPath);
  if (!existsSync(full)) {
    throw new FileNotFoundError(batchPath);
  }
  // Not `isFile()`: `/dev/stdin` and a process substitution `<(…)` are FIFOs /
  // character devices and are legitimate batch sources for shell callers.
  if (statSync(full).isDirectory()) {
    throw batchFileError(batchPath, "is a directory");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(full, "utf-8"));
  } catch {
    throw batchFileError(batchPath, "is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw batchFileError(batchPath, "must be a non-empty JSON array of entries");
  }
  const seen = new Set<string>();
  const entries = parsed.map((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw batchFileError(batchPath, `entry #${index} is not an object`);
    }
    const entry = raw as Record<string, unknown>;
    const name = entry.name;
    if (typeof name !== "string" || !BATCH_NAME_PATTERN.test(name)) {
      throw batchFileError(
        batchPath,
        `entry #${index}: "name" must match ${BATCH_NAME_PATTERN.source}`,
      );
    }
    if (seen.has(name)) {
      throw batchFileError(batchPath, `entry #${index}: duplicate "name"`);
    }
    seen.add(name);
    const allowed =
      kind === "sparql"
        ? ["name", "sparql"]
        : ["name", "uid", "currentAsset", "params", "paramsIri"];
    for (const key of Object.keys(entry)) {
      if (!allowed.includes(key)) {
        throw batchFileError(batchPath, `entry #${index}: unknown field (allowed: ${allowed.join(", ")})`);
      }
    }
    if (kind === "sparql") {
      if (typeof entry.sparql !== "string" || entry.sparql.trim() === "") {
        throw batchFileError(batchPath, `entry #${index}: "sparql" must be a non-empty string`);
      }
      return { name, sparql: entry.sparql };
    }
    if (typeof entry.uid !== "string" || entry.uid.trim() === "") {
      throw batchFileError(batchPath, `entry #${index}: "uid" must be a non-empty string`);
    }
    if (entry.currentAsset !== undefined && typeof entry.currentAsset !== "string") {
      throw batchFileError(batchPath, `entry #${index}: "currentAsset" must be a string`);
    }
    for (const field of ["params", "paramsIri"] as const) {
      const value = entry[field];
      if (value === undefined) continue;
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.values(value as object).some((v) => typeof v !== "string")
      ) {
        throw batchFileError(batchPath, `entry #${index}: "${field}" must be an object of strings`);
      }
    }
    return {
      name,
      uid: entry.uid,
      currentAsset: entry.currentAsset as string | undefined,
      params: entry.params as Record<string, string> | undefined,
      paramsIri: entry.paramsIri as Record<string, string> | undefined,
    };
  });
  return entries as SparqlBatchEntry[] | NamedQueryBatchEntry[];
}

function batchFileError(batchPath: string, problem: string): InvalidArgumentsError {
  return new InvalidArgumentsError(
    `Batch file '${batchPath}' ${problem}. The file content is not shown.`,
    'A batch file is a JSON array: [{"name":"q1","sparql":"SELECT …"}] for query, [{"name":"q1","uid":"…"}] for run-query',
  );
}

// ---------------------------------------------------------------------------
// Shared loop helpers
// ---------------------------------------------------------------------------

export interface GraphState {
  graphLoads: number;
  loaded: LoadVaultTriplesResult | null;
  store: InMemoryTripleStore | null;
  loadDurationMs: number;
}

/** The ONE place a batch loads the graph; memoised, so a second call is free. */
export function graphLoader(
  vaultPath: string,
  useCache: boolean,
  sink: BatchSink,
): { ensure: () => Promise<InMemoryTripleStore>; state: GraphState } {
  const state: GraphState = { graphLoads: 0, loaded: null, store: null, loadDurationMs: 0 };
  let pending: Promise<InMemoryTripleStore> | null = null;
  const ensure = (): Promise<InMemoryTripleStore> => {
    if (pending) return pending;
    pending = (async () => {
      const start = Date.now();
      sink.progress(`📦 Loading vault: ${vaultPath}...`);
      state.graphLoads += 1;
      const loaded = await loadVaultTriples(vaultPath, { useCache });
      const notice = skippedFilesNotice(loaded);
      if (notice !== null) sink.progress(notice);
      const store = new InMemoryTripleStore();
      await store.addAll(loaded.triples);
      state.loaded = loaded;
      state.store = store;
      state.loadDurationMs = Date.now() - start;
      sink.progress(
        `✅ Loaded ${loaded.triples.length} triples in ${state.loadDurationMs}ms (${loaded.mode})`,
      );
      return store;
    })();
    return pending;
  };
  return { ensure, state };
}

export function loaderMeta(loaded: LoadVaultTriplesResult | null): Record<string, unknown> {
  if (!loaded) return {};
  if (loaded.skippedFiles) {
    return loaded.skippedFiles.length === 0
      ? {}
      : {
          skippedCount: loaded.skippedFiles.length,
          skippedFiles: loaded.skippedFiles,
          skippedFilesAvailable: true,
        };
  }
  return loaded.zeroTriplePaths.length === 0
    ? {}
    : { zeroTripleCount: loaded.zeroTriplePaths.length, skippedFilesAvailable: false };
}

export function summaryRecord(
  total: number,
  failed: number,
  state: GraphState,
  startTime: number,
  queryResultCacheHits = 0,
): BatchRecord {
  return {
    type: "summary",
    queries: total,
    ok: total - failed,
    failed,
    graphLoads: state.graphLoads,
    queryResultCacheHits,
    loadMode: state.loaded ? state.loaded.mode : "none",
    loadDurationMs: state.loadDurationMs,
    triples: state.loaded ? state.loaded.triples.length : 0,
    durationMs: Date.now() - startTime,
    ...loaderMeta(state.loaded),
  };
}

export function finish(failed: number): void {
  process.exitCode = failed > 0 ? ExitCodes.OPERATION_FAILED : ExitCodes.SUCCESS;
}

/** Pre-stream refusal: nothing is on stdout yet, so the usual CLI error path is right. */
export function refuse(error: unknown): never {
  ErrorHandler.handle(error as Error);
}

class UpdateRefusedError extends Error {
  constructor() {
    super("UPDATE refused in a batch");
    this.name = "UpdateRefusedError";
  }
}

// ---------------------------------------------------------------------------
// query --batch
// ---------------------------------------------------------------------------

export interface SparqlBatchOptions {
  vault: string;
  useCache: boolean;
  /** `false` ⇔ `--no-cache` (result cache bypassed). */
  useQueryResultCache: boolean;
  cacheTtlSeconds: number;
  timeoutMs: number;
  noOptimize: boolean;
  /**
   * The SAME translate/optimize and dispatch/execute functions single `query`
   * uses (sparql-query.ts), injected rather than imported to avoid an import
   * cycle. Parity of answers is by construction, not by a second copy.
   */
  buildAlgebra: (ast: never, noOptimize: boolean) => AlgebraOperation;
  executeAlgebra: (
    store: InMemoryTripleStore,
    algebra: AlgebraOperation,
    timeoutMs: number,
    startTime: number,
  ) => Promise<{ kind: "construct"; triples: Triple[] } | { kind: "select"; results: Array<{ toJSON(): Record<string, string> }> }>;
}

/** Error type from the exception CLASS, never from its message (bcc041d8 / review #4550). */
function sparqlErrorType(error: unknown): BatchErrorType {
  if (error instanceof UpdateRefusedError) return "update-rejected";
  if (error instanceof SPARQLParseError) return "syntax";
  if (error instanceof QueryTimeoutError) return "timeout";
  return "execution";
}

export async function runSparqlBatch(
  batchPath: string,
  options: SparqlBatchOptions,
  sink: BatchSink = streamSink(),
): Promise<void> {
  const startTime = Date.now();
  let entries: SparqlBatchEntry[];
  const vaultPath = resolve(options.vault);
  try {
    entries = readBatchFile(batchPath, "sparql");
    if (!existsSync(vaultPath)) throw new VaultNotFoundError(vaultPath);
  } catch (error) {
    refuse(error);
  }

  const graph = graphLoader(vaultPath, options.useCache, sink);

  // Result cache: ONE signature for the whole batch, and none under --no-cache.
  const cache = options.useQueryResultCache ? new QueryResultCache() : null;
  const signature = cache ? await computeVaultSignature(vaultPath) : null;
  const cached: Array<unknown | null> = [];
  for (const entry of entries) {
    cached.push(cache ? await cache.get(entry.sparql, options.cacheTtlSeconds, signature) : null);
  }

  // Shared once per batch: vault prefixes are a property of the vault, not of a query.
  const vaultPrefixes = filterOntologyPrefixes(scanVaultNamespaces(vaultPath));
  let failed = 0;
  let cacheHits = 0;
  /** Best-effort: a failed cache write must not turn a computed answer into an error. */
  const remember = async (entry: SparqlBatchEntry, value: unknown): Promise<void> => {
    if (!cache) return;
    try {
      await cache.set(entry.sparql, value, options.cacheTtlSeconds, signature);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code ?? "unknown";
      sink.progress(`⚠️  query result cache not written for "${entry.name}" (${code}); the answer is unaffected`);
    }
  };

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const entryStart = Date.now();
    let record: BatchRecord;
    try {
      const hit = cached[i] as
        | { type: string; count?: number; bindings?: unknown[]; triples?: unknown[] }
        | null;
      if (hit) {
        record =
          hit.type === "construct"
            ? { type: "result", name: entry.name, ok: true, kind: "construct", count: hit.triples?.length ?? 0, triples: hit.triples ?? [] }
            : { type: "result", name: entry.name, ok: true, kind: "select", count: hit.bindings?.length ?? 0, bindings: hit.bindings ?? [] };
        record.queryResultCacheHit = true;
        cacheHits += 1;
      } else {
        const queryString = injectExocortexPrefixes(transformShorthandNotation(entry.sparql));
        const parser = new ExoQLParser();
        if (vaultPrefixes.size > 0) parser.setVaultPrefixes(vaultPrefixes);
        const ast = parser.parse(queryString);
        if (ast.type === "update") throw new UpdateRefusedError();

        let store: InMemoryTripleStore;
        try {
          store = await graph.ensure();
        } catch {
          const loadError = new Error("graph load failed");
          loadError.name = "BatchLoadError";
          throw loadError;
        }

        const algebra = options.buildAlgebra(ast as never, options.noOptimize);
        const executed = await options.executeAlgebra(store, algebra, options.timeoutMs, Date.now());
        if (executed.kind === "construct") {
          const rows = JSON.parse(new TriplesFormatter().formatJson(executed.triples));
          record = { type: "result", name: entry.name, ok: true, kind: "construct", count: rows.length, triples: rows };
          await remember(entry, { type: "construct", count: rows.length, triples: rows });
        } else {
          const bindings = executed.results.map((r) => r.toJSON());
          record = { type: "result", name: entry.name, ok: true, kind: "select", count: bindings.length, bindings };
          await remember(entry, { type: "select", count: bindings.length, bindings });
        }
        record.queryResultCacheHit = false;
      }
    } catch (error) {
      failed += 1;
      const type: BatchErrorType =
        (error as Error)?.name === "BatchLoadError" ? "load" : sparqlErrorType(error);
      const errorBody: Record<string, unknown> = { type };
      // CLI errors are built from options, not from the batch file (timeout).
      if (error instanceof CLIError) errorBody.message = error.message;
      record = { type: "result", name: entry.name, ok: false, error: errorBody };
    }
    record.durationMs = Date.now() - entryStart;
    try {
      await sink.write(ndjsonLine(record));
    } catch {
      // Nobody reads stdout any more (EPIPE): stop, do not run the rest.
      process.exitCode = ExitCodes.GENERAL_ERROR;
      return;
    }
  }

  try {
    await sink.write(ndjsonLine(summaryRecord(entries.length, failed, graph.state, startTime, cacheHits)));
  } catch {
    process.exitCode = ExitCodes.GENERAL_ERROR;
    return;
  }
  finish(failed);
}
