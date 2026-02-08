import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import { CacheManager } from "../cache/CacheManager.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder, type CacheResult, type CacheStatsResult } from "../responses/index.js";

export interface SparqlIndexOptions {
  vault: string;
  output?: OutputFormat;
  stats?: boolean;
  force?: boolean;
}

/**
 * Creates the 'sparql index' subcommand for building/managing the triple cache.
 *
 * The index command creates a persistent cache of RDF triples from the vault,
 * enabling fast subsequent SPARQL queries without re-parsing all files.
 *
 * @returns Commander Command instance configured for cache management
 *
 * @example
 * exocortex sparql index --vault /path/to/vault
 * exocortex sparql index --vault /path/to/vault --stats
 * exocortex sparql index --vault /path/to/vault --force
 */
export function sparqlIndexCommand(): Command {
  return new Command("index")
    .description("Build or refresh the triple cache for faster SPARQL queries")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .option("--stats", "Show cache statistics after building")
    .option("--force", "Force rebuild even if cache is valid")
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

        // Build cache
        if (outputFormat === "text") {
          console.log(`📦 Building triple cache for: ${vaultPath}...`);
        }

        const startTime = Date.now();
        const result = await cacheManager.buildCache();
        const totalDuration = Date.now() - startTime;

        if (outputFormat === "json") {
          const cacheResult: CacheResult = {
            action: "build",
            cachePath,
            tripleCount: result.tripleCount,
            durationMs: result.durationMs,
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
                { cache: cacheResult, stats: statsResult },
                { durationMs: totalDuration }
              );
              console.log(JSON.stringify(response, null, 2));
            }
          } else {
            const response = ResponseBuilder.success(cacheResult, {
              durationMs: totalDuration,
            });
            console.log(JSON.stringify(response, null, 2));
          }
        } else {
          console.log(`✅ Created cache with ${result.tripleCount.toLocaleString()} triples at ${cachePath}`);
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
