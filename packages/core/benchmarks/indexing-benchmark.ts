/**
 * Benchmark Suite for Large Vault Performance Profiling
 *
 * Measures performance of indexing and SPARQL queries on large vaults (10k+ notes).
 *
 * Usage:
 *   npx ts-node benchmarks/indexing-benchmark.ts [options]
 *
 * Options:
 *   --notes <n>    Number of notes to simulate (default: 10000)
 *   --queries <n>  Number of queries to run (default: 100)
 *   --verbose      Enable verbose output
 */

import {
  InMemoryTripleStore,
  IRI,
  Literal,
  Triple,
  Namespace,
} from "../src";

// Performance targets from Issue #1280
const PERFORMANCE_TARGETS = {
  /** SPARQL query should return in < 1 second */
  sparqlQueryMs: 1000,
  /** Incremental indexing should complete in < 5 seconds */
  incrementalIndexMs: 5000,
  /** Full indexing baseline for comparison */
  fullIndexPerNoteMs: 0.5,
};

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  passesTarget?: boolean;
  targetMs?: number;
}

interface BenchmarkSuite {
  vaultSize: number;
  tripleCount: number;
  results: BenchmarkResult[];
  timestamp: string;
}

/**
 * High-precision timer for benchmarking
 */
class Timer {
  private start: [number, number];

  constructor() {
    this.start = process.hrtime();
  }

  elapsedMs(): number {
    const [seconds, nanoseconds] = process.hrtime(this.start);
    return seconds * 1000 + nanoseconds / 1_000_000;
  }

  static measure<T>(fn: () => T): { result: T; elapsedMs: number } {
    const timer = new Timer();
    const result = fn();
    return { result, elapsedMs: timer.elapsedMs() };
  }

  static async measureAsync<T>(fn: () => Promise<T>): Promise<{ result: T; elapsedMs: number }> {
    const timer = new Timer();
    const result = await fn();
    return { result, elapsedMs: timer.elapsedMs() };
  }
}

/**
 * Calculate percentiles from sorted array
 */
function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)];
}

/**
 * Generate mock triples for a single note
 */
function generateNoteTriples(noteIndex: number): Triple[] {
  const uuid = `00000000-0000-0000-0000-${noteIndex.toString().padStart(12, "0")}`;
  const noteUri = `obsidian://vault/03%20Knowledge%2Fkitelev%2F${uuid}.md`;
  const noteIRI = new IRI(noteUri);

  const triples: Triple[] = [];

  // Standard asset properties
  triples.push(
    new Triple(
      noteIRI,
      new IRI(Namespace.EXO.term("Asset_label").value),
      new Literal(`Note ${noteIndex}`)
    )
  );

  triples.push(
    new Triple(
      noteIRI,
      new IRI(Namespace.EXO.term("Asset_class").value),
      new IRI(Namespace.EMS.term("Task").value)
    )
  );

  // Add some relationships
  if (noteIndex > 0 && noteIndex % 10 === 0) {
    // Every 10th note references the previous one
    const prevUuid = `00000000-0000-0000-0000-${(noteIndex - 1).toString().padStart(12, "0")}`;
    const prevUri = `obsidian://vault/03%20Knowledge%2Fkitelev%2F${prevUuid}.md`;
    triples.push(
      new Triple(
        noteIRI,
        new IRI(Namespace.EXO.term("Asset_prototype").value),
        new IRI(prevUri)
      )
    );
  }

  // Add effort timestamps for some notes
  if (noteIndex % 5 === 0) {
    triples.push(
      new Triple(
        noteIRI,
        new IRI(Namespace.EMS.term("Effort_startTimestamp").value),
        new Literal(new Date().toISOString(), new IRI(Namespace.XSD.term("dateTime").value))
      )
    );
  }

  return triples;
}

/**
 * Generate all triples for a vault with the specified number of notes
 */
function generateVaultTriples(noteCount: number): Triple[] {
  const allTriples: Triple[] = [];
  for (let i = 0; i < noteCount; i++) {
    allTriples.push(...generateNoteTriples(i));
  }
  return allTriples;
}

/**
 * Benchmark: Full vault indexing
 */
async function benchmarkFullIndexing(
  store: InMemoryTripleStore,
  allTriples: Triple[],
  iterations: number
): Promise<BenchmarkResult> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    await store.clear();

    const { elapsedMs } = await Timer.measureAsync(async () => {
      await store.addAll(allTriples);
    });

    times.push(elapsedMs);
  }

  times.sort((a, b) => a - b);

  return {
    name: "Full Indexing",
    iterations,
    totalMs: times.reduce((a, b) => a + b, 0),
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: times[0],
    maxMs: times[times.length - 1],
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    targetMs: PERFORMANCE_TARGETS.fullIndexPerNoteMs * allTriples.length / 3,
    passesTarget: times.reduce((a, b) => a + b, 0) / times.length <
      PERFORMANCE_TARGETS.fullIndexPerNoteMs * allTriples.length / 3,
  };
}

/**
 * Benchmark: Incremental file update (simulate single file change)
 */
async function benchmarkIncrementalUpdate(
  store: InMemoryTripleStore,
  noteCount: number,
  iterations: number
): Promise<BenchmarkResult> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    // Simulate updating a random note
    const noteIndex = Math.floor(Math.random() * noteCount);
    const oldTriples = generateNoteTriples(noteIndex);
    const newTriples = generateNoteTriples(noteIndex); // Generate "new" version

    const { elapsedMs } = await Timer.measureAsync(async () => {
      // Remove old triples
      await store.removeAll(oldTriples);
      // Add new triples
      await store.addAll(newTriples);
    });

    times.push(elapsedMs);
  }

  times.sort((a, b) => a - b);

  return {
    name: "Incremental Update (single file)",
    iterations,
    totalMs: times.reduce((a, b) => a + b, 0),
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: times[0],
    maxMs: times[times.length - 1],
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    targetMs: 10, // Should be < 10ms for single file
    passesTarget: percentile(times, 95) < 10,
  };
}

/**
 * Benchmark: Simple match query (get all triples for a subject)
 */
async function benchmarkSimpleMatch(
  store: InMemoryTripleStore,
  noteCount: number,
  iterations: number
): Promise<BenchmarkResult> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const noteIndex = Math.floor(Math.random() * noteCount);
    const uuid = `00000000-0000-0000-0000-${noteIndex.toString().padStart(12, "0")}`;
    const noteUri = `obsidian://vault/03%20Knowledge%2Fkitelev%2F${uuid}.md`;
    const noteIRI = new IRI(noteUri);

    const { elapsedMs } = await Timer.measureAsync(async () => {
      await store.match(noteIRI);
    });

    times.push(elapsedMs);
  }

  times.sort((a, b) => a - b);

  return {
    name: "Simple Match (by subject)",
    iterations,
    totalMs: times.reduce((a, b) => a + b, 0),
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: times[0],
    maxMs: times[times.length - 1],
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    targetMs: 1, // Should be < 1ms with index
    passesTarget: percentile(times, 95) < 1,
  };
}

/**
 * Benchmark: Predicate-Object match (common SPARQL pattern)
 */
async function benchmarkPredicateObjectMatch(
  store: InMemoryTripleStore,
  iterations: number
): Promise<BenchmarkResult> {
  const times: number[] = [];
  const assetClass = new IRI(Namespace.EXO.term("Asset_class").value);
  const taskClass = new IRI(Namespace.EMS.term("Task").value);

  for (let i = 0; i < iterations; i++) {
    const { elapsedMs } = await Timer.measureAsync(async () => {
      await store.match(undefined, assetClass, taskClass);
    });

    times.push(elapsedMs);
  }

  times.sort((a, b) => a - b);

  return {
    name: "Predicate-Object Match (all tasks)",
    iterations,
    totalMs: times.reduce((a, b) => a + b, 0),
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: times[0],
    maxMs: times[times.length - 1],
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    targetMs: PERFORMANCE_TARGETS.sparqlQueryMs,
    passesTarget: percentile(times, 95) < PERFORMANCE_TARGETS.sparqlQueryMs,
  };
}

/**
 * Benchmark: UUID lookup (uses UUID index)
 */
async function benchmarkUUIDLookup(
  store: InMemoryTripleStore,
  noteCount: number,
  iterations: number
): Promise<BenchmarkResult> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const noteIndex = Math.floor(Math.random() * noteCount);
    const uuid = `00000000-0000-0000-0000-${noteIndex.toString().padStart(12, "0")}`;

    const { elapsedMs } = await Timer.measureAsync(async () => {
      await store.findSubjectsByUUID(uuid);
    });

    times.push(elapsedMs);
  }

  times.sort((a, b) => a - b);

  return {
    name: "UUID Lookup (indexed)",
    iterations,
    totalMs: times.reduce((a, b) => a + b, 0),
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: times[0],
    maxMs: times[times.length - 1],
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    targetMs: 0.1, // Should be < 0.1ms with index
    passesTarget: percentile(times, 95) < 0.1,
  };
}

/**
 * Benchmark: Cache hit rate (simulated via repeated queries)
 */
async function benchmarkCacheEfficiency(
  store: InMemoryTripleStore,
  noteCount: number,
  iterations: number
): Promise<BenchmarkResult> {
  const times: number[] = [];
  const querySet = Array.from({ length: 10 }, (_, i) => {
    const noteIndex = Math.floor((i / 10) * noteCount);
    const uuid = `00000000-0000-0000-0000-${noteIndex.toString().padStart(12, "0")}`;
    return `obsidian://vault/03%20Knowledge%2Fkitelev%2F${uuid}.md`;
  });

  for (let i = 0; i < iterations; i++) {
    // Run same 10 queries repeatedly to measure cache benefit
    const noteUri = querySet[i % querySet.length];
    const noteIRI = new IRI(noteUri);

    const { elapsedMs } = await Timer.measureAsync(async () => {
      await store.match(noteIRI);
    });

    times.push(elapsedMs);
  }

  times.sort((a, b) => a - b);

  // Compare first 10 queries (cold) vs later queries (warm)
  const coldTimes = times.slice(0, 10);
  const warmTimes = times.slice(10);
  const coldAvg = coldTimes.reduce((a, b) => a + b, 0) / coldTimes.length;
  const warmAvg = warmTimes.length > 0
    ? warmTimes.reduce((a, b) => a + b, 0) / warmTimes.length
    : coldAvg;

  return {
    name: `Cache Efficiency (cold: ${coldAvg.toFixed(3)}ms, warm: ${warmAvg.toFixed(3)}ms)`,
    iterations,
    totalMs: times.reduce((a, b) => a + b, 0),
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: times[0],
    maxMs: times[times.length - 1],
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    targetMs: 1,
    passesTarget: warmAvg < coldAvg * 0.5, // Warm should be 50% faster than cold
  };
}

/**
 * Format benchmark result for display
 */
function formatResult(result: BenchmarkResult): string {
  const status = result.passesTarget === undefined
    ? "⚪"
    : result.passesTarget
      ? "✅"
      : "❌";

  const targetStr = result.targetMs !== undefined
    ? ` (target: <${result.targetMs}ms)`
    : "";

  return `
${status} ${result.name}${targetStr}
   Iterations: ${result.iterations}
   Avg: ${result.avgMs.toFixed(3)}ms | Min: ${result.minMs.toFixed(3)}ms | Max: ${result.maxMs.toFixed(3)}ms
   P50: ${result.p50Ms.toFixed(3)}ms | P95: ${result.p95Ms.toFixed(3)}ms | P99: ${result.p99Ms.toFixed(3)}ms
`;
}

/**
 * Main benchmark runner
 */
async function runBenchmarks(noteCount: number, queryCount: number, verbose: boolean): Promise<BenchmarkSuite> {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  Exocortex Performance Benchmark Suite                         ║
║  Vault Size: ${noteCount.toLocaleString().padEnd(7)} notes | Queries: ${queryCount.toLocaleString().padEnd(6)}         ║
╚════════════════════════════════════════════════════════════════╝
`);

  const results: BenchmarkResult[] = [];
  const store = new InMemoryTripleStore();

  // Generate test data
  console.log("Generating test data...");
  const allTriples = generateVaultTriples(noteCount);
  console.log(`Generated ${allTriples.length.toLocaleString()} triples\n`);

  // 1. Full indexing benchmark
  console.log("Running: Full Indexing...");
  const fullIndex = await benchmarkFullIndexing(store, allTriples, 3);
  results.push(fullIndex);
  if (verbose) console.log(formatResult(fullIndex));

  // Ensure store is populated for subsequent tests
  await store.addAll(allTriples);

  // 2. Incremental update benchmark
  console.log("Running: Incremental Update...");
  const incUpdate = await benchmarkIncrementalUpdate(store, noteCount, queryCount);
  results.push(incUpdate);
  if (verbose) console.log(formatResult(incUpdate));

  // 3. Simple match benchmark
  console.log("Running: Simple Match...");
  const simpleMatch = await benchmarkSimpleMatch(store, noteCount, queryCount);
  results.push(simpleMatch);
  if (verbose) console.log(formatResult(simpleMatch));

  // 4. Predicate-Object match benchmark
  console.log("Running: Predicate-Object Match...");
  const poMatch = await benchmarkPredicateObjectMatch(store, queryCount);
  results.push(poMatch);
  if (verbose) console.log(formatResult(poMatch));

  // 5. UUID lookup benchmark
  console.log("Running: UUID Lookup...");
  const uuidLookup = await benchmarkUUIDLookup(store, noteCount, queryCount);
  results.push(uuidLookup);
  if (verbose) console.log(formatResult(uuidLookup));

  // 6. Cache efficiency benchmark
  console.log("Running: Cache Efficiency...");
  const cacheEff = await benchmarkCacheEfficiency(store, noteCount, queryCount);
  results.push(cacheEff);
  if (verbose) console.log(formatResult(cacheEff));

  // Summary
  console.log("\n" + "═".repeat(66));
  console.log("SUMMARY");
  console.log("═".repeat(66));

  const passed = results.filter((r) => r.passesTarget === true).length;
  const failed = results.filter((r) => r.passesTarget === false).length;
  const neutral = results.filter((r) => r.passesTarget === undefined).length;

  console.log(`
Total Benchmarks: ${results.length}
  ✅ Passed:  ${passed}
  ❌ Failed:  ${failed}
  ⚪ No Target: ${neutral}
`);

  if (!verbose) {
    console.log("\nRun with --verbose for detailed results");
  } else {
    results.forEach((r) => console.log(formatResult(r)));
  }

  const tripleCount = await store.count();

  return {
    vaultSize: noteCount,
    tripleCount,
    results,
    timestamp: new Date().toISOString(),
  };
}

// Parse command line arguments
function parseArgs(): { noteCount: number; queryCount: number; verbose: boolean } {
  const args = process.argv.slice(2);
  let noteCount = 10000;
  let queryCount = 100;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--notes" && args[i + 1]) {
      noteCount = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--queries" && args[i + 1]) {
      queryCount = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--verbose") {
      verbose = true;
    }
  }

  return { noteCount, queryCount, verbose };
}

// Run benchmarks
const { noteCount, queryCount, verbose } = parseArgs();
runBenchmarks(noteCount, queryCount, verbose)
  .then((suite) => {
    // Output JSON for CI integration
    if (process.env.CI) {
      console.log("\n--- JSON OUTPUT FOR CI ---");
      console.log(JSON.stringify(suite, null, 2));
    }
  })
  .catch((error) => {
    console.error("Benchmark failed:", error);
    process.exit(1);
  });
