/**
 * `query --prune-report` — phase 1b of RFC 308a52c3 «Загрузка по запросу» (ticket
 * dc5ed554): what the query-predicate analyzer (phase 1a) would load for this query.
 *
 * The report answers three questions and nothing else:
 * - P' — the predicates the query needs (each with the reasons it is there: the query
 *   itself, a namespace filter, the sub-property decorator, the class bridge), or
 * - the full-load reasons when the analyzer refuses to prune, and
 * - the share of the loaded triples P' covers.
 *
 * It does NOT change loading and does not reorder the command: the graph is loaded in
 * full exactly as plain `query` loads it, then the query is parsed (a second parse is
 * fine for this phase — RFC Д1) and analyzed. The query is NOT executed — the report is
 * a diagnostic, its answer would add nothing — and the query RESULT cache is neither
 * read nor written (the report path branches before it).
 *
 * Analysis input: the translator's algebra BEFORE the optimizer (the analyzer contract,
 * the oracle does the same) with the context computed from the loaded graph — the
 * sub-property index of the full store and every predicate present in it (VL-3).
 *
 * Share — in LOADER units: the loaded triples as `loadVaultTriples` returns them (the
 * explicit and the inferred layer, duplicates included — the unit RFC 308a52c3 §Контекст
 * fixes: «сырые тройки кэша … с дублями — именно столько грузит загрузчик»). Numerator and
 * denominator are counted over the SAME array: `triplesCut` = triples whose predicate is
 * in P', `triplesLoaded` = all of them. A full load reads everything: share 1. An empty
 * graph: share 0 for a prune. ⛔ The oracle's `cutTriples` (`--prune-oracle`) is the size
 * of the cut STORE — duplicates removed — so it is another quantity: dividing it by the
 * loaded count mixes units (it understated vault-tbank's median 16.2 % as 13.6 %).
 *
 * Mode: `full` — the analyzer refused; `prune-namespace` — at least one predicate of P'
 * is there because a namespace filter admitted it (VL-3: `Q_FLOW_TRIPLES` and kin);
 * `prune` — otherwise. ⛔ Boundary: a namespace filter that admitted NO predicate of the
 * graph leaves no trace in P' and reads as `prune` — the label is derived from P', not
 * from the query text.
 *
 * Batch (`query --batch <file> --prune-report`): one NDJSON line per entry, then a
 * summary with the median share (a full load counts as 1, as the RFC criterion reads
 * «с учётом запросов с полной загрузкой»), the median over pruned entries only, and the
 * UNION a batch would load (RFC «А»: the union of P' of its entries; one full load ⇒
 * full). Entries the batch would not run — a syntax error, an UPDATE (refused as
 * `query --batch` refuses it), a failed analysis — are failed entries: they count in
 * neither the medians nor the union. Exit OPERATION_FAILED when any entry failed.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import {
  InMemoryTripleStore,
  ExoQLParser,
  SPARQLParseError,
  ExoQLAlgebraTranslator,
  analyzeParsedQuery,
  computeSubPropertyIndex,
  type PredicateAnalysis,
  type PredicateAnalysisContext,
  type Triple,
} from "@kitelev/exocortex-core";
import { ResponseBuilder } from "../responses/index.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { scanVaultNamespaces } from "../utils/VaultNamespaceScanner.js";
import {
  injectExocortexPrefixes,
  transformShorthandNotation,
  filterOntologyPrefixes,
} from "../utils/QueryPrefixInjector.js";
import { loadVaultTriples, skippedFilesNotice } from "../cache/loadVaultTriples.js";
import {
  readBatchFile,
  graphLoader,
  loaderMeta,
  ndjsonLine,
  streamSink,
  refuse,
  finish,
  type BatchSink,
  type SparqlBatchEntry,
} from "./query-batch.js";
import { ExitCodes } from "../utils/ExitCodes.js";

export type PruneReportMode = "prune" | "prune-namespace" | "full";

export interface PruneReport {
  mode: PruneReportMode;
  /** The analyzer's full-load reasons (empty for a prune). */
  reasons: ReadonlyArray<Record<string, unknown>>;
  /** P', sorted by IRI, each with its sources (empty for a full load). */
  predicates: Array<{ iri: string; sources: string[] }>;
  /** Loaded triples whose predicate is in P' (all of them for a full load). */
  triplesCut: number;
  /** All loaded triples (explicit + inferred, duplicates included). */
  triplesLoaded: number;
  /** triplesCut / triplesLoaded; a full load ⇒ 1; an empty graph ⇒ 0 for a prune. */
  share: number;
}

/** The analysis context from the loaded graph: what phase 3b will read from the cache manifest. */
export async function analysisContext(
  store: InMemoryTripleStore,
  triples: readonly Triple[],
): Promise<PredicateAnalysisContext> {
  return {
    subPropertyIndex: await computeSubPropertyIndex(store),
    storePredicates: new Set(triples.map((t) => t.predicate.value)),
  };
}

/** The text `query` hands to the parser: shorthand expanded, Exocortex prefixes injected. */
export function prepareQueryText(sparql: string): string {
  return injectExocortexPrefixes(transformShorthandNotation(sparql));
}

/** Parse PREPARED text (see `prepareQueryText`) with the vault prefixes, as `query` does. */
export function parsePrepared(prepared: string, vaultPrefixes: Map<string, string>): { type: string } {
  const parser = new ExoQLParser();
  if (vaultPrefixes.size > 0) parser.setVaultPrefixes(vaultPrefixes);
  return parser.parse(prepared) as { type: string };
}

export function analyze(ast: { type: string }, context: PredicateAnalysisContext): PredicateAnalysis {
  // The translator's algebra, NOT buildAlgebra's optimized one (the analyzer contract).
  return analyzeParsedQuery(ast, (q: never) => new ExoQLAlgebraTranslator().translate(q), context);
}

/** The report of one analysis over the loaded triples. */
export function pruneReport(analysis: PredicateAnalysis, triples: readonly Triple[]): PruneReport {
  const triplesLoaded = triples.length;
  if (analysis.mode === "full") {
    return {
      mode: "full",
      reasons: analysis.reasons.map((r) => ({ ...r })),
      predicates: [],
      triplesCut: triplesLoaded,
      triplesLoaded,
      share: 1,
    };
  }
  const predicates = [...analysis.predicates]
    .sort()
    .map((iri) => ({ iri, sources: [...(analysis.sources.get(iri) ?? [])].sort() }));
  let triplesCut = 0;
  for (const t of triples) if (analysis.predicates.has(t.predicate.value)) triplesCut += 1;
  const namespace = predicates.some((p) => p.sources.includes("namespace-filter"));
  return {
    mode: namespace ? "prune-namespace" : "prune",
    reasons: [],
    predicates,
    triplesCut,
    triplesLoaded,
    share: triplesLoaded === 0 ? 0 : triplesCut / triplesLoaded,
  };
}

/** Median of a non-empty list (mean of the two middle values for an even count); null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percent(share: number): string {
  return `${(share * 100).toFixed(2)} %`;
}

function reasonText(reason: Record<string, unknown>): string {
  if (typeof reason.variable === "string") {
    // The analyzer names a variable without "?" and a blank-node predicate as "_:<type>".
    const v = reason.variable.startsWith("_:") ? reason.variable : `?${reason.variable}`;
    return `${String(reason.kind)} (${v})`;
  }
  return reason.endpoint === undefined ? String(reason.kind) : `${String(reason.kind)} (${String(reason.endpoint)})`;
}

const MODE_TEXT: Record<PruneReportMode, string> = {
  prune: "prune",
  "prune-namespace": "prune by namespace filter",
  full: "full load",
};

export function formatPruneReportText(report: PruneReport): string[] {
  const lines = [`🔎 Prune report (RFC 308a52c3, phase 1b) — loading is unchanged: the full graph was loaded`];
  lines.push(`Mode: ${MODE_TEXT[report.mode]}`);
  if (report.mode === "full") {
    lines.push(`Full-load reasons: ${report.reasons.map(reasonText).join(", ")}`);
  } else {
    lines.push(`P' (${report.predicates.length} predicate(s)):`);
    for (const p of report.predicates) lines.push(`  ${p.iri}  [${p.sources.join(", ")}]`);
  }
  lines.push(`Triples: ${report.triplesCut} of ${report.triplesLoaded} loaded (${percent(report.share)})`);
  return lines;
}

export interface PruneReportOptions {
  vault: string;
  useCache: boolean;
  output: "text" | "json";
}

/**
 * Single query: load in full, parse, analyze, print the report. The query is not executed.
 * `preparedQuery` is the text AFTER `prepareQueryText` — the caller prepares it, so its
 * error handler quotes the very text the parser saw (line numbers of a syntax error).
 */
export async function runPruneReport(preparedQuery: string, options: PruneReportOptions): Promise<void> {
  const startTime = Date.now();
  const vaultPath = resolve(options.vault);
  if (!existsSync(vaultPath)) throw new VaultNotFoundError(vaultPath);
  if (options.output === "text") console.log(`📦 Loading vault: ${vaultPath}...`);
  const loadStart = Date.now();
  const loaded = await loadVaultTriples(vaultPath, { useCache: options.useCache });
  const notice = skippedFilesNotice(loaded);
  if (notice !== null) console.error(notice);
  const store = new InMemoryTripleStore();
  await store.addAll(loaded.triples);
  const loadDurationMs = Date.now() - loadStart;
  if (options.output === "text") {
    console.log(`✅ Loaded ${loaded.triples.length} triples in ${loadDurationMs}ms${loaded.cacheHit ? " (from cache)" : ""}\n`);
  }
  const ast = parsePrepared(preparedQuery, filterOntologyPrefixes(scanVaultNamespaces(vaultPath)));
  const report = pruneReport(analyze(ast, await analysisContext(store, loaded.triples)), loaded.triples);
  if (options.output === "json") {
    const response = ResponseBuilder.success(
      { type: "prune-report", ...report },
      {
        durationMs: Date.now() - startTime,
        loadDurationMs,
        cacheHit: loaded.cacheHit,
        ...loaderMeta(loaded),
      },
    );
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  for (const line of formatPruneReportText(report)) console.log(line);
}

class UpdateRefusedError extends Error {
  constructor() {
    super("UPDATE refused in a batch");
    this.name = "UpdateRefusedError";
  }
}

function errorType(error: unknown): string {
  if (error instanceof UpdateRefusedError) return "update-rejected";
  if (error instanceof SPARQLParseError) return "syntax";
  if ((error as Error)?.name === "BatchLoadError") return "load";
  return "analysis";
}

/** `query --batch <file> --prune-report`: one report per entry, then the summary. */
export async function runPruneReportBatch(
  batchPath: string,
  options: Omit<PruneReportOptions, "output">,
  sink: BatchSink = streamSink(),
): Promise<void> {
  const startTime = Date.now();
  const vaultPath = resolve(options.vault);
  let entries: SparqlBatchEntry[];
  try {
    entries = readBatchFile(batchPath, "sparql");
    if (!existsSync(vaultPath)) throw new VaultNotFoundError(vaultPath);
  } catch (error) {
    refuse(error);
  }

  const graph = graphLoader(vaultPath, options.useCache, sink);
  const vaultPrefixes = filterOntologyPrefixes(scanVaultNamespaces(vaultPath));
  let context: PredicateAnalysisContext | null = null;
  const counts: Record<PruneReportMode, number> = { prune: 0, "prune-namespace": 0, full: 0 };
  const fullLoadReasons: Record<string, number> = {};
  const shares: number[] = [];
  const pruneShares: number[] = [];
  const union = new Set<string>();
  let unionFull = false;
  let failed = 0;

  for (const entry of entries) {
    const entryStart = Date.now();
    let record: Record<string, unknown>;
    try {
      const ast = parsePrepared(prepareQueryText(entry.sparql), vaultPrefixes);
      if (ast.type === "update") throw new UpdateRefusedError();
      let store: InMemoryTripleStore;
      try {
        store = await graph.ensure();
      } catch {
        const loadError = new Error("graph load failed");
        loadError.name = "BatchLoadError";
        throw loadError;
      }
      const triples = graph.state.loaded?.triples ?? [];
      context ??= await analysisContext(store, triples);
      const analysis = analyze(ast, context);
      const report = pruneReport(analysis, triples);
      counts[report.mode] += 1;
      shares.push(report.share);
      if (analysis.mode === "full") {
        unionFull = true;
        for (const r of report.reasons) {
          const kind = String(r.kind);
          fullLoadReasons[kind] = (fullLoadReasons[kind] ?? 0) + 1;
        }
      } else {
        pruneShares.push(report.share);
        for (const p of analysis.predicates) union.add(p);
      }
      record = { type: "prune-report", name: entry.name, ok: true, ...report };
    } catch (error) {
      failed += 1;
      record = { type: "prune-report", name: entry.name, ok: false, error: { type: errorType(error) } };
    }
    record.durationMs = Date.now() - entryStart;
    try {
      await sink.write(ndjsonLine(record));
    } catch {
      process.exitCode = ExitCodes.GENERAL_ERROR;
      return;
    }
  }

  const triples = graph.state.loaded?.triples ?? [];
  let unionRecord: Record<string, unknown> | null = null;
  if (shares.length > 0) {
    if (unionFull) {
      unionRecord = { mode: "full", predicates: null, triplesCut: triples.length, share: 1 };
    } else {
      let cut = 0;
      for (const t of triples) if (union.has(t.predicate.value)) cut += 1;
      unionRecord = {
        mode: "prune",
        predicates: union.size,
        triplesCut: cut,
        share: triples.length === 0 ? 0 : cut / triples.length,
      };
    }
  }
  const summary = {
    type: "summary",
    pruneReport: true,
    queries: entries.length,
    ok: entries.length - failed,
    failed,
    prune: counts.prune,
    pruneNamespace: counts["prune-namespace"],
    fullLoad: counts.full,
    fullLoadReasons,
    medianShare: median(shares),
    medianSharePrune: median(pruneShares),
    union: unionRecord,
    triplesLoaded: triples.length,
    graphLoads: graph.state.graphLoads,
    loadMode: graph.state.loaded ? graph.state.loaded.mode : "none",
    loadDurationMs: graph.state.loadDurationMs,
    durationMs: Date.now() - startTime,
    ...loaderMeta(graph.state.loaded),
  };
  try {
    await sink.write(ndjsonLine(summary));
  } catch {
    process.exitCode = ExitCodes.GENERAL_ERROR;
    return;
  }
  finish(failed);
}
