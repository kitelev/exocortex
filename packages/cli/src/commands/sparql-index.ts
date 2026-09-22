import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import { CacheManager } from "../cache/CacheManager.js";
import { materializeInferredTriples } from "../cache/materializeInferred.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder, type CacheResult, type CacheStatsResult } from "../responses/index.js";

export interface SparqlIndexOptions {
  vault: string;
  output?: OutputFormat;
  stats?: boolean;
  force?: boolean;
  strict?: boolean;
  inference?: boolean;
}

/**
 * Creates the 'index' command for building/managing the triple cache.
 *
 * The index command creates a persistent cache of RDF triples from the vault,
 * enabling fast subsequent SPARQL queries without re-parsing all files.
 *
 * @returns Commander Command instance configured for cache management
 *
 * @example
 * exocortex index --vault /path/to/vault
 * exocortex index --vault /path/to/vault --stats
 * exocortex index --vault /path/to/vault --force
 * exocortex index --vault /path/to/vault --strict
 */
export function sparqlIndexCommand(): Command {
  return new Command("index")
    .description("Build or refresh the triple cache for faster SPARQL queries")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
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

        // RDFS inference materialization (enabled by default).
        // #4263: the pipeline lives in materializeInferredTriples (shared with
        // CacheManager's delta refresh, which re-materializes the layer after
        // splicing changed files) and the layer is persisted in its own cache
        // bucket, separate from the per-file explicit triples.
        let inferredCount = 0;
        if (options.inference !== false) {
          const { triples } = await cacheManager.loadOrBuild();
          const materialized = await materializeInferredTriples(triples);
          inferredCount = materialized.inferredCount;

          // Persist the layer EVEN WHEN EMPTY: saveInferredTriples flags
          // `inferenceEnabled` on, which is what lets a later delta refresh
          // materialize a prototype that did not exist at index time (review
          // round 2, N4 — a length-gated save left such vaults without a layer).
          await cacheManager.saveInferredTriples(materialized.inferred);
          result.tripleCount += inferredCount;

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
 * Formats bytes into human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
