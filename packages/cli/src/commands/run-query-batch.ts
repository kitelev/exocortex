/**
 * `run-query --batch <file>` (ticket 8ada0615) — the named-query twin of
 * `query --batch`; contract in query-batch.ts. A separate module so that
 * `query`'s import graph does not grow (NamedQueryCliRunner → NodeFsAdapter).
 */
import { resolve } from "path";
import { existsSync } from "fs";
import {
  InMemoryTripleStore,
  SPARQLParseError,
  UnsetQueryTokenError,
  vaultPathToIRI,
  type NamedQueryContext,
  type NamedQueryParam,
  type ExoQLEvalResult,
  type Triple,
} from "@kitelev/exocortex-core";
import { ExitCodes } from "../utils/ExitCodes.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { buildNamedQueryRunner } from "../services/NamedQueryCliRunner.js";
import {
  readBatchFile,
  streamSink,
  ndjsonLine,
  graphLoader,
  summaryRecord,
  finish,
  refuse,
  type BatchSink,
  type BatchRecord,
  type NamedQueryBatchEntry,
} from "./query-batch.js";

// ---------------------------------------------------------------------------

export interface NamedQueryBatchOptions {
  vault: string;
  useCache: boolean;
}

function namedContext(entry: NamedQueryBatchEntry): NamedQueryContext {
  const context: NamedQueryContext = {};
  if (entry.currentAsset) {
    (context as { currentAsset?: string }).currentAsset = vaultPathToIRI(entry.currentAsset);
  }
  const params: Record<string, NamedQueryParam> = {};
  for (const [k, v] of Object.entries(entry.params ?? {})) params[k] = { value: v, kind: "literal" };
  for (const [k, v] of Object.entries(entry.paramsIri ?? {})) params[k] = { value: vaultPathToIRI(v), kind: "iri" };
  if (Object.keys(params).length > 0) {
    (context as { params?: Record<string, NamedQueryParam> }).params = params;
  }
  return context;
}

/** Same `data` shape as `run-query <uid> --format json` prints for one query. */
function namedResultBody(result: ExoQLEvalResult): Record<string, unknown> {
  if (result.kind === "ask") return { kind: "ask", result: result.result };
  if (result.kind === "construct") {
    const triples = result.triples.map((t: Triple) => ({
      subject: t.subject.toString(),
      predicate: t.predicate.toString(),
      object: t.object.toString(),
    }));
    return { kind: "construct", triples, count: triples.length };
  }
  const rows = result.rows.map((row) => {
    const obj: Record<string, string | null> = {};
    for (const v of row.variables()) {
      const term = row.get(v);
      obj[v] = term ? term.toString() : null;
    }
    return obj;
  });
  return { kind: "select", rows, count: rows.length };
}

export async function runNamedQueryBatch(
  batchPath: string,
  options: NamedQueryBatchOptions,
  sink: BatchSink = streamSink(),
): Promise<void> {
  const startTime = Date.now();
  let entries: NamedQueryBatchEntry[];
  const vaultPath = resolve(options.vault);
  try {
    entries = readBatchFile(batchPath, "named");
    if (!existsSync(vaultPath)) throw new VaultNotFoundError(vaultPath);
  } catch (error) {
    refuse(error);
  }

  const graph = graphLoader(vaultPath, options.useCache, sink);
  let failed = 0;

  for (const entry of entries) {
    const entryStart = Date.now();
    let record: BatchRecord;
    try {
      // ONE guard holds "loaded once": the memo inside graphLoader (a second
      // memo here would make each of them unobservable — mutant M13 of the spec).
      let store: InMemoryTripleStore;
      try {
        store = await graph.ensure();
      } catch {
        const loadError = new Error("graph load failed");
        loadError.name = "BatchLoadError";
        throw loadError;
      }
      const runner = buildNamedQueryRunner(store, vaultPath);
      // refuseUnsetTokens: a `$param` the entry did not supply (a typo) is an
      // unbound variable, and a comparison with one lets every row through —
      // a wrong answer with ok:true. The batch is a new machine surface, so it
      // refuses (type "unset-token"); single `run-query <uid>` keeps its old
      // behaviour.
      const result = await runner.run(entry.uid, namedContext(entry), { refuseUnsetTokens: true });
      record =
        result === null
          ? { type: "result", name: entry.name, ok: false, error: { type: "not-found" } }
          : { type: "result", name: entry.name, ok: true, ...namedResultBody(result) };
      if (result === null) failed += 1;
    } catch (error) {
      failed += 1;
      const isLoad = (error as Error)?.name === "BatchLoadError";
      // TYPE only, no message: the entry's params come from the batch FILE and
      // are substituted into the body before parsing, so a parser message would
      // quote them (bcc041d8; review of the spec, finding 4).
      const type = isLoad
        ? "load"
        : error instanceof UnsetQueryTokenError
          ? "unset-token"
          : error instanceof SPARQLParseError
            ? "syntax"
            : "execution";
      record = { type: "result", name: entry.name, ok: false, error: { type } };
    }
    record.durationMs = Date.now() - entryStart;
    try {
      await sink.write(ndjsonLine(record));
    } catch {
      process.exitCode = ExitCodes.GENERAL_ERROR;
      return;
    }
  }

  try {
    await sink.write(ndjsonLine(summaryRecord(entries.length, failed, graph.state, startTime)));
  } catch {
    process.exitCode = ExitCodes.GENERAL_ERROR;
    return;
  }
  finish(failed);
}
