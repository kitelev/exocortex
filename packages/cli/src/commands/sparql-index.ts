import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import { InMemoryTripleStore, RDFSInferenceEngine, NonInheritablePropertyRegistry, PropertyCardinalityRegistry, PrototypeChainMaterializer } from "exocortex";
import { CacheManager } from "../cache/CacheManager.js";
import { CombinedCacheManager } from "../cache/CombinedCacheManager.js";
import { buildCombinedTriples } from "../cache/buildCombinedTriples.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder, type CacheResult, type CacheStatsResult } from "../responses/index.js";

export interface SparqlIndexOptions {
  vault: string;
  also?: string[];
  output?: OutputFormat;
  stats?: boolean;
  force?: boolean;
  strict?: boolean;
  inference?: boolean;
}

/**
 * Commander.js accumulator for repeatable --also flag.
 * Each --also <path> adds a vault path to the array.
 */
function collectAlso(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Creates the 'sparql index' subcommand for building/managing the triple cache.
 *
 * The index command creates a persistent cache of RDF triples from the vault,
 * enabling fast subsequent SPARQL queries without re-parsing all files.
 *
 * With one or more `--also <path>` flags, the command builds a **combined**
 * cross-vault cache materialized over the union of the primary and `--also`
 * vaults (Issue #3281). The combined cache lives at
 * `<primary>/.exocortex/cache/combined-<hash>.json` and is consumed by
 * `sparql query --use-cache --also` when the same set of vaults is queried.
 *
 * @returns Commander Command instance configured for cache management
 *
 * @example
 * exocortex sparql index --vault /path/to/vault
 * exocortex sparql index --vault /path/to/vault --stats
 * exocortex sparql index --vault /path/to/vault --force
 * exocortex sparql index --vault /path/to/vault --strict
 * exocortex sparql index --vault /path/to/primary --also /path/to/other
 */
export function sparqlIndexCommand(): Command {
  return new Command("index")
    .description("Build or refresh the triple cache for faster SPARQL queries")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--also <path>", "Additional vault to include in combined index (repeatable, Issue #3281)", collectAlso, [])
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .option("--stats", "Show cache statistics after building")
    .option("--force", "Force rebuild even if cache is valid")
    .option("--strict", "Fail on first invalid IRI instead of skipping")
    .option("--no-inference", "Disable RDFS subClassOf inference materialization")
    .action(async (options: SparqlIndexOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const alsoVaults = options.also ?? [];

        // Multi-vault path: build combined cross-vault index (Issue #3281)
        if (alsoVaults.length > 0) {
          await runCombinedIndex(vaultPath, alsoVaults, options, outputFormat);
          return;
        }

        // Single-vault path: original behaviour, unchanged for backward compat
        const cacheManager = new CacheManager(vaultPath);
        const cachePath = cacheManager.getCachePath();

        // Force rebuild if requested
        if (options.force) {
          if (outputFormat === "text") {
            console.log("🗑️  Invalidating existing cache...");
          }
          await cacheManager.invalidate();
        }

        // Build cache with validation
        if (outputFormat === "text") {
          console.log(`📦 Building triple cache for: ${vaultPath}...`);
        }

        const startTime = Date.now();
        const result = await cacheManager.buildCacheWithValidation({
          strict: options.strict ?? false,
        });

        // RDFS inference materialization (enabled by default)
        let inferredCount = 0;
        if (options.inference !== false) {
          const { triples } = await cacheManager.loadOrBuild();
          const tripleStore = new InMemoryTripleStore();
          await tripleStore.addAll(triples);

          const engine = new RDFSInferenceEngine();
          inferredCount = await engine.materialize(tripleStore);

          // Prototype chain materialization (after RDFS inference)
          const registry = new NonInheritablePropertyRegistry();
          await registry.initialize(tripleStore);
          const cardinalityRegistry = new PropertyCardinalityRegistry();
          await cardinalityRegistry.initialize(tripleStore);
          const protoMaterializer = new PrototypeChainMaterializer(registry, cardinalityRegistry);
          const protoInferredCount = await protoMaterializer.materialize(tripleStore);
          inferredCount += protoInferredCount;

          if (inferredCount > 0) {
            const allTriples = await tripleStore.match();
            await cacheManager.saveTriples(allTriples);
            result.tripleCount += inferredCount;
          }

          if (outputFormat === "text" && inferredCount > 0) {
            console.log(`🧠 Materialized ${inferredCount} inferred triples (RDFS + prototype chain)`);
          }
        }

        const totalDuration = Date.now() - startTime;

        if (outputFormat === "json") {
          const cacheResult: CacheResult = {
            action: "build",
            cachePath,
            tripleCount: result.tripleCount,
            durationMs: result.durationMs,
          };

          // Include validation info
          const validationInfo = {
            summary: result.summary,
            skippedFiles: result.skippedFiles,
          };

          // Include stats if requested
          if (options.stats) {
            const stats = await cacheManager.getCacheStats();
            if (stats) {
              const statsResult: CacheStatsResult = {
                tripleCount: stats.tripleCount,
                createdAt: stats.createdAt.toISOString(),
                isValid: stats.isValid,
                sizeBytes: stats.sizeBytes,
                cachePath,
              };
              const response = ResponseBuilder.success(
                { cache: cacheResult, stats: statsResult, validation: validationInfo },
                { durationMs: totalDuration }
              );
              console.log(JSON.stringify(response, null, 2));
            }
          } else {
            const response = ResponseBuilder.success(
              { cache: cacheResult, validation: validationInfo },
              { durationMs: totalDuration }
            );
            console.log(JSON.stringify(response, null, 2));
          }
        } else {
          // Show warnings for skipped files
          if (result.skippedFiles.length > 0) {
            console.log("\n⚠️  Files skipped due to IRI issues:");
            for (const file of result.skippedFiles) {
              console.log(`   - ${file.path}`);
              console.log(`     ${file.reason}`);
            }
            console.log("");
          }

          // Show summary
          console.log(`✅ Indexed ${result.summary.indexed} files, skipped ${result.summary.skipped} (total: ${result.summary.total})`);
          console.log(`📊 Created cache with ${result.tripleCount.toLocaleString()} triples at ${cachePath}`);
          console.log(`⏱️  Build time: ${result.durationMs}ms`);

          if (options.stats) {
            const stats = await cacheManager.getCacheStats();
            if (stats) {
              console.log("\n📊 Cache Statistics:");
              console.log(`   Triples: ${stats.tripleCount.toLocaleString()}`);
              console.log(`   Created: ${stats.createdAt.toISOString()}`);
              console.log(`   Valid: ${stats.isValid ? "✅ Yes" : "❌ No"}`);
              console.log(`   Size: ${formatBytes(stats.sizeBytes)}`);
            }
          }
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

/**
 * Build/refresh a combined cross-vault triple cache (Issue #3281).
 *
 * Materializes RDFS + prototype-chain inferences over the union of triples
 * from `primary` and every `alsoVaults` path. The resulting triple set is
 * persisted under `<primary>/.exocortex/cache/combined-<hash>.json` where
 * `<hash>` is a stable hash of the sorted vault-path set, so subsequent
 * `sparql query --use-cache --also` calls with the same vault set hit the
 * combined cache directly.
 */
async function runCombinedIndex(
  primary: string,
  alsoVaults: string[],
  options: SparqlIndexOptions,
  outputFormat: OutputFormat,
): Promise<void> {
  // Pre-validate that every --also path exists so the user sees an early
  // error rather than partial-build state.
  for (const a of alsoVaults) {
    const resolved = resolve(a);
    if (!existsSync(resolved)) {
      throw new VaultNotFoundError(resolved);
    }
  }

  const combinedCache = new CombinedCacheManager(primary, alsoVaults);
  const cachePath = combinedCache.getCachePath();

  if (options.force) {
    if (outputFormat === "text") {
      console.log("🗑️  Invalidating existing combined cache...");
    }
    await combinedCache.invalidate();
  }

  if (outputFormat === "text") {
    console.log(
      `📦 Building combined triple cache (${combinedCache.getAllVaultPaths().length} vaults)...`,
    );
  }

  const startTime = Date.now();

  // buildCombinedTriples handles per-vault load, cross-vault Instance_class
  // resolution, and RDFS + prototype-chain materialization on the combined
  // store. Disabling `noInference` mirrors `--no-inference` flag semantics.
  const buildResult = await buildCombinedTriples(primary, alsoVaults, {
    noInference: options.inference === false,
    silent: outputFormat !== "text",
  });

  await combinedCache.saveTriples(buildResult.triples);

  const totalDuration = Date.now() - startTime;
  const tripleCount = buildResult.triples.length;

  if (outputFormat === "json") {
    const cacheResult: CacheResult = {
      action: "build",
      cachePath,
      tripleCount,
      durationMs: totalDuration,
    };

    if (options.stats) {
      const stats = await combinedCache.getCacheStats();
      if (stats) {
        const statsResult: CacheStatsResult = {
          tripleCount: stats.tripleCount,
          createdAt: stats.createdAt.toISOString(),
          isValid: stats.isValid,
          sizeBytes: stats.sizeBytes,
          cachePath,
        };
        const response = ResponseBuilder.success(
          {
            cache: cacheResult,
            stats: statsResult,
            combined: {
              vaultPaths: combinedCache.getAllVaultPaths(),
              rawTripleCount: buildResult.rawTripleCount,
              crossVaultAddedTripleCount: buildResult.crossVaultAddedTripleCount,
              inferredTripleCount: buildResult.inferredTripleCount,
              canonicalizedTripleCount: buildResult.canonicalizedTripleCount,
            },
          },
          { durationMs: totalDuration },
        );
        console.log(JSON.stringify(response, null, 2));
        return;
      }
    }

    const response = ResponseBuilder.success(
      {
        cache: cacheResult,
        combined: {
          vaultPaths: combinedCache.getAllVaultPaths(),
          rawTripleCount: buildResult.rawTripleCount,
          crossVaultAddedTripleCount: buildResult.crossVaultAddedTripleCount,
          inferredTripleCount: buildResult.inferredTripleCount,
          canonicalizedTripleCount: buildResult.canonicalizedTripleCount,
        },
      },
      { durationMs: totalDuration },
    );
    console.log(JSON.stringify(response, null, 2));
  } else {
    console.log(
      `📊 Created combined cache with ${tripleCount.toLocaleString()} triples at ${cachePath}`,
    );
    console.log(`⏱️  Build time: ${totalDuration}ms`);

    if (options.stats) {
      const stats = await combinedCache.getCacheStats();
      if (stats) {
        console.log("\n📊 Combined Cache Statistics:");
        console.log(`   Triples: ${stats.tripleCount.toLocaleString()}`);
        console.log(`   Created: ${stats.createdAt.toISOString()}`);
        console.log(`   Valid: ${stats.isValid ? "✅ Yes" : "❌ No"}`);
        console.log(`   Size: ${formatBytes(stats.sizeBytes)}`);
        console.log(`   Vaults (${stats.vaultPaths.length}):`);
        for (const vp of stats.vaultPaths) {
          console.log(`     - ${vp}`);
        }
      }
    }
  }
}

/**
 * Formats bytes into human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
