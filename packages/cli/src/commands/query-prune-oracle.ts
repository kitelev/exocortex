/**
 * `query --batch <file> --prune-oracle` — the double-run oracle of RFC 308a52c3
 * «Загрузка по запросу», section Д3 (phase 2, ticket 2588fa84).
 *
 * For every entry of a batch file it answers ONE question: does the query give the
 * same answer over the graph cut to the analyzer's P' as over the full graph?
 *
 * - ONE graph load per batch; both runs read the SAME snapshot by construction (the
 *   RFC's «оба прогона — на одном снимке кэша троек»).
 * - The query RESULT cache is never read nor written (the RFC's «оба прогона с
 *   `--no-cache`»): a second run can never return the first run's answer.
 * - The cut is the REFERENCE semantics the phase-3b loader must reproduce: the loaded
 *   triples (explicit AND inferred layer) filtered by predicate, in their original
 *   order (`allTriples.filter(...)` — the analyzer's axes and both fuzzers proved
 *   answers over exactly this cut).
 * - Analysis: the translator's algebra BEFORE the optimizer (the analyzer contract);
 *   execution: the SAME `buildAlgebra` / `executeAlgebra` single `query` and
 *   `query --batch` use (injected — answers cannot drift from the product path).
 * - Product parity: an UPDATE is refused per entry (`update-rejected`), as `query
 *   --batch` refuses it; a full-load entry is still executed ONCE over the full graph,
 *   so a query the product cannot run (DESCRIBE today) is a failed entry, not a
 *   healthy-looking `full-load`.
 * - Clock: the engine reads the wall clock per call (`NOW()`, `exo:age_days`). When
 *   the cut answer (or a canary's) differs from the full one, the full answer is
 *   computed AGAIN; when the two full answers differ in ANY way (order included) the
 *   entry is `unstable` — not judged — instead of a false `diverged` (or `detected`).
 * - Timeouts depend on load, not on the cut: a cut run that times out is
 *   `cut-timeout` (not judged); any other cut failure while the full run answered
 *   is `diverged` (the cut changed the outcome).
 * - Non-vacuity: per entry, the cut is repeated without each skeleton part (class
 *   bridge; sub-properties + their declarations) — exactly the P' a skeleton-breaking
 *   mutant of the analyzer would produce. `detected` = the oracle WOULD be red on that
 *   P' while the full answer is stable: the multiset changed, or the canary run failed
 *   with a non-timeout error (the main cut's `diverged` with `cutError`). A canary run
 *   that times out, or a full re-run that fails, proves nothing about the cut:
 *   `unstable`. The summary counts `detected` per part.
 * - Stability: a failed full re-run (timeout, error) makes the entry `unstable`, never
 *   `failed` — the first full run answered, the cut was compared against it.
 * - Privacy: no bound value, no predicate IRI, no digest of an answer is printed —
 *   cardinalities only (rows, cut triples, |P'|). A cardinality may coincide with a
 *   COUNT answer (a single-predicate COUNT equals `cutTriples`); that is accepted: the
 *   live tool reading this output prints names and per-vault aggregates only.
 *
 * Verdicts: `equal` · `order-only` (same multiset, other row order — the RFC judges
 * after canonicalising order) · `diverged` · `unstable` · `cut-timeout` · `full-load`
 * (the analyzer refused to prune; nothing to compare). Exit code: OPERATION_FAILED
 * when any entry diverged or failed.
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
  type AlgebraOperation,
  type PredicateAnalysis,
  type PredicateAnalysisContext,
  type Triple,
} from "@kitelev/exocortex-core";
import { ExitCodes } from "../utils/ExitCodes.js";
import { QueryTimeoutError, VaultNotFoundError } from "../utils/errors/index.js";
import { scanVaultNamespaces } from "../utils/VaultNamespaceScanner.js";
import {
  injectExocortexPrefixes,
  transformShorthandNotation,
  filterOntologyPrefixes,
} from "../utils/QueryPrefixInjector.js";
import {
  readBatchFile,
  graphLoader,
  ndjsonLine,
  streamSink,
  refuse,
  type BatchSink,
  type SparqlBatchEntry,
  type SparqlBatchOptions,
} from "./query-batch.js";

export type OracleVerdict = "equal" | "order-only" | "diverged" | "unstable" | "cut-timeout" | "full-load";
export type CanaryOutcome = "detected" | "silent" | "unstable" | "n/a";

/** The skeleton parts a canary removes, by the analyzer's `sources` of each predicate. */
export const CANARY_PARTS = {
  classBridge: ["class-bridge"],
  subProperty: ["sub-property", "sub-property-declarations"],
} as const;
export type CanaryPart = keyof typeof CANARY_PARTS;

/** One NDJSON line of the oracle output (`oracle` per entry, then one `summary`). */
export type OracleRecord = Record<string, unknown> & { type: "oracle" | "summary" };

export type PruneOracleOptions = Omit<SparqlBatchOptions, "useQueryResultCache" | "cacheTtlSeconds">;

type Term = { toString(): string };
type Executed =
  | { kind: "construct"; triples: Triple[] }
  | { kind: "select"; results: Array<{ getBindings(): Map<string, Term> }> };

/** One RDF term, unambiguously (a literal's value is not escaped by `toString`). */
function termKey(term: Term): unknown {
  // BIND / aggregate results can be bare JS values in a solution, not RDF terms.
  if (term === null || typeof term !== "object") return ["P", typeof term, String(term)];
  const t = term as Term & { value?: string; datatype?: { value: string }; language?: string; direction?: string };
  if ("datatype" in t) {
    return ["L", t.value, t.datatype?.value ?? null, t.language ?? null, t.direction ?? null];
  }
  return ["T", t.toString()];
}

/** The rows of an answer, each as one canonical string, in the engine's order. */
export function answerRows(executed: Executed): string[] {
  if (executed.kind === "construct") {
    return executed.triples.map((t) =>
      JSON.stringify([termKey(t.subject), termKey(t.predicate), termKey(t.object)]),
    );
  }
  return executed.results.map((row) => {
    const pairs = [...row.getBindings().entries()]
      .map(([variable, value]) => [variable, termKey(value)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return JSON.stringify(pairs);
  });
}

export interface AnswerComparison {
  verdict: "equal" | "order-only" | "diverged";
  /** Rows (with multiplicity) only in the reference / only in the candidate. */
  onlyReference: number;
  onlyCandidate: number;
}

/** Compare two answers: same row list ⇒ equal; same multiset ⇒ order-only; else diverged. */
export function compareAnswers(reference: readonly string[], candidate: readonly string[]): AnswerComparison {
  if (reference.length === candidate.length && reference.every((r, i) => r === candidate[i])) {
    return { verdict: "equal", onlyReference: 0, onlyCandidate: 0 };
  }
  const counts = new Map<string, number>();
  for (const r of reference) counts.set(r, (counts.get(r) ?? 0) + 1);
  for (const c of candidate) counts.set(c, (counts.get(c) ?? 0) - 1);
  let onlyReference = 0;
  let onlyCandidate = 0;
  for (const n of counts.values()) {
    if (n > 0) onlyReference += n;
    else if (n < 0) onlyCandidate -= n;
  }
  return {
    verdict: onlyReference === 0 && onlyCandidate === 0 ? "order-only" : "diverged",
    onlyReference,
    onlyCandidate,
  };
}

/** P' minus the predicates that are in it ONLY because of one skeleton part. */
export function canaryPredicates(
  analysis: Extract<PredicateAnalysis, { mode: "prune" }>,
  part: CanaryPart,
): Set<string> | null {
  const removable = new Set<string>(CANARY_PARTS[part]);
  const kept = new Set<string>();
  let removed = 0;
  for (const predicate of analysis.predicates) {
    const sources = analysis.sources.get(predicate);
    const onlyThisPart =
      sources !== undefined && sources.size > 0 && [...sources].every((s) => removable.has(s));
    if (onlyThisPart) removed += 1;
    else kept.add(predicate);
  }
  return removed === 0 ? null : kept;
}

/** The cut: loaded triples whose predicate is in the set, in their original order. */
export function cutTriples(triples: readonly Triple[], predicates: ReadonlySet<string>): Triple[] {
  return triples.filter((t) => predicates.has(t.predicate.value));
}

class OracleExecutionError extends Error {
  constructor(
    readonly side: "full" | "cut",
    readonly errorType: string,
  ) {
    super(`${side} run failed (${errorType})`);
    this.name = "OracleExecutionError";
  }
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
  if (error instanceof QueryTimeoutError) return "timeout";
  return "execution";
}

/** The last cut only: consecutive entries often share P', and each cut store of the live graph is hundreds of MB. */
const MAX_CUT_STORES = 1;

export async function runPruneOracleBatch(
  batchPath: string,
  options: PruneOracleOptions,
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
  const cutStores = new Map<string, InMemoryTripleStore>();

  const tally = {
    equal: 0,
    "order-only": 0,
    diverged: 0,
    unstable: 0,
    "cut-timeout": 0,
    "full-load": 0,
  } as Record<OracleVerdict, number>;
  const reasons: Record<string, number> = {};
  const canary: Record<CanaryPart, { eligible: number; detected: number }> = {
    classBridge: { eligible: 0, detected: 0 },
    subProperty: { eligible: 0, detected: 0 },
  };
  let failed = 0;
  let judgedNonEmpty = 0;

  const run = async (
    side: "full" | "cut",
    store: InMemoryTripleStore,
    algebra: AlgebraOperation,
  ): Promise<string[]> => {
    try {
      return answerRows((await options.executeAlgebra(store, algebra, options.timeoutMs, Date.now())) as Executed);
    } catch (error) {
      throw new OracleExecutionError(side, errorType(error));
    }
  };

  const cutStore = async (predicates: ReadonlySet<string>): Promise<{ store: InMemoryTripleStore; size: number }> => {
    const key = [...predicates].sort().join("\n");
    const known = cutStores.get(key);
    if (known) return { store: known, size: await known.count() };
    const triples = graph.state.loaded?.triples ?? [];
    const store = new InMemoryTripleStore();
    await store.addAll(cutTriples(triples, predicates));
    if (cutStores.size >= MAX_CUT_STORES) cutStores.delete(cutStores.keys().next().value as string);
    cutStores.set(key, store);
    return { store, size: await store.count() };
  };

  for (const entry of entries) {
    const entryStart = Date.now();
    let record: OracleRecord;
    try {
      const queryString = injectExocortexPrefixes(transformShorthandNotation(entry.sparql));
      const parser = new ExoQLParser();
      if (vaultPrefixes.size > 0) parser.setVaultPrefixes(vaultPrefixes);
      const ast = parser.parse(queryString);
      if (ast.type === "update") throw new UpdateRefusedError();
      const full = await graph.ensure();
      if (context === null) {
        const triples = graph.state.loaded?.triples ?? [];
        context = {
          subPropertyIndex: await computeSubPropertyIndex(full),
          storePredicates: new Set(triples.map((t) => t.predicate.value)),
        };
      }
      const analysis = analyzeParsedQuery(
        ast,
        (q: never) => new ExoQLAlgebraTranslator().translate(q),
        context,
      );
      const algebra = options.buildAlgebra(ast as never, options.noOptimize);
      if (analysis.mode === "full") {
        const kinds: string[] = analysis.reasons.map((r: { kind: string }) => r.kind);
        // Product parity: the entry must still RUN over the full graph.
        const rows = await run("full", full, algebra);
        for (const k of kinds) reasons[k] = (reasons[k] ?? 0) + 1;
        tally["full-load"] += 1;
        record = { type: "oracle", name: entry.name, ok: true, verdict: "full-load", mode: "full", reasons: kinds, full: { count: rows.length } };
      } else {
        const first = await run("full", full, algebra);
        const cut = await cutStore(analysis.predicates);
        const pruned = await run("cut", cut.store, algebra);
        const cmp = compareAnswers(first, pruned);
        // The second full run happens ONLY when something differs from the first: it
        // tells «the cut changed the answer» from «the clock / the engine did».
        let stable: boolean | null = null;
        const fullIsStable = async (): Promise<boolean> => {
          if (stable === null) {
            try {
              stable = compareAnswers(first, await run("full", full, algebra)).verdict === "equal";
            } catch {
              stable = false; // a failed re-run proves nothing about the cut: not judged, never `failed`
            }
          }
          return stable;
        };
        const sourceCounts: Record<string, number> = {};
        for (const sources of analysis.sources.values()) {
          for (const s of sources) sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
        }
        const base: OracleRecord = {
          type: "oracle",
          name: entry.name,
          ok: true,
          mode: "prune",
          predicates: analysis.predicates.size,
          sources: sourceCounts,
          cutTriples: cut.size,
          full: { count: first.length },
          cut: { count: pruned.length },
        };
        if (cmp.verdict !== "equal" && !(await fullIsStable())) {
          tally.unstable += 1;
          record = { ...base, verdict: "unstable" };
        } else {
          tally[cmp.verdict] += 1;
          if (first.length > 0) judgedNonEmpty += 1;
          const outcomes: Record<string, CanaryOutcome> = {};
          for (const part of Object.keys(CANARY_PARTS) as CanaryPart[]) {
            const kept = canaryPredicates(analysis, part);
            if (kept === null) {
              outcomes[part] = "n/a";
              continue;
            }
            canary[part].eligible += 1;
            // Not cached: a canary cut is used once (memory — the live graph is ~1.1M triples).
            const canaryStore = new InMemoryTripleStore();
            await canaryStore.addAll(cutTriples(graph.state.loaded?.triples ?? [], kept));
            let differs: boolean;
            try {
              differs = compareAnswers(first, await run("cut", canaryStore, algebra)).verdict === "diverged";
            } catch (error) {
              if (error instanceof OracleExecutionError && error.errorType === "timeout") {
                outcomes[part] = "unstable"; // load, not the cut
                continue;
              }
              differs = true; // a non-timeout failure: the main cut would be `diverged` (cutError)
            }
            const detected = differs && (await fullIsStable());
            outcomes[part] = detected ? "detected" : differs ? "unstable" : "silent";
            if (detected) canary[part].detected += 1;
          }
          record = {
            ...base,
            verdict: cmp.verdict,
            ...(cmp.verdict === "diverged" ? { onlyFull: cmp.onlyReference, onlyCut: cmp.onlyCandidate } : {}),
            canary: outcomes,
          };
        }
      }
    } catch (error) {
      if (error instanceof OracleExecutionError && error.side === "cut" && error.errorType === "timeout") {
        // A timeout depends on the load of the machine, not on the cut: not judged.
        tally["cut-timeout"] += 1;
        record = { type: "oracle", name: entry.name, ok: true, verdict: "cut-timeout", mode: "prune" };
      } else if (error instanceof OracleExecutionError && error.side === "cut") {
        // The full answer exists, the cut one does not: the cut changed the outcome.
        tally.diverged += 1;
        record = { type: "oracle", name: entry.name, ok: true, verdict: "diverged", mode: "prune", cutError: error.errorType };
      } else {
        failed += 1;
        const type = error instanceof OracleExecutionError ? error.errorType : errorType(error);
        record = { type: "oracle", name: entry.name, ok: false, error: { type } };
      }
    }
    record.durationMs = Date.now() - entryStart;
    try {
      await sink.write(ndjsonLine(record));
    } catch {
      process.exitCode = ExitCodes.GENERAL_ERROR;
      return;
    }
  }

  const judged = tally.equal + tally["order-only"] + tally.diverged;
  const summary: OracleRecord = {
    type: "summary",
    oracle: true,
    queries: entries.length,
    judged,
    judgedNonEmpty,
    equal: tally.equal,
    orderOnly: tally["order-only"],
    diverged: tally.diverged,
    unstable: tally.unstable,
    cutTimeout: tally["cut-timeout"],
    fullLoad: tally["full-load"],
    failed,
    fullLoadReasons: reasons,
    canary,
    graphLoads: graph.state.graphLoads,
    loadMode: graph.state.loaded ? graph.state.loaded.mode : "none",
    triples: graph.state.loaded ? graph.state.loaded.triples.length : 0,
    durationMs: Date.now() - startTime,
  };
  try {
    await sink.write(ndjsonLine(summary));
  } catch {
    process.exitCode = ExitCodes.GENERAL_ERROR;
    return;
  }
  process.exitCode = tally.diverged > 0 || failed > 0 ? ExitCodes.OPERATION_FAILED : ExitCodes.SUCCESS;
}
