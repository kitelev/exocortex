import { Command } from "commander";
import { QueryResultCache } from "../cache/QueryResultCache.js";

/**
 * `exocortex cache` (Issue #3981) — maintenance for the SPARQL **query-result**
 * cache (`~/.exocortex/cache/query-results/`), the on-disk store that `query`
 * uses to serve identical repeat queries without re-running them.
 *
 * Subcommands:
 *   - `cache clear` — remove every cached query result (durable equivalent of
 *     `find ~/.exocortex/cache/query-results -name '*.json' -delete`). Safe:
 *     cached results are freely regenerable.
 *   - `cache stats` — report the current entry count and total size on disk.
 *
 * Growth is now additionally bounded automatically: `QueryResultCache.set`
 * evicts oldest-first once the count/size caps are exceeded (Issue #3981).
 *
 * Note on staleness (separate, deferred by #3981): the query-result cache
 * invalidates by TTL only (default 300s) — a `set-property`/`apply` mutation can
 * leave a stale cached result until the TTL elapses. For read-after-write flows
 * prefer `query --no-cache` or a short `query --cache-ttl <seconds>`.
 */
export function cacheCommand(): Command {
  const cmd = new Command("cache").description(
    "SPARQL query-result cache maintenance (clear / stats). " +
      "For read-after-write, prefer `query --no-cache` or a short `--cache-ttl`.",
  );

  cmd.addCommand(cacheClearCommand());
  cmd.addCommand(cacheStatsCommand());

  return cmd;
}

interface CacheClearOptions {
  output?: "text" | "json";
}

function cacheClearCommand(): Command {
  return new Command("clear")
    .description("Remove all cached SPARQL query results from disk")
    .option("--output <format>", "Output format: text | json", "text")
    .action(async (options: CacheClearOptions) => {
      const cache = new QueryResultCache();
      const before = await cache.getCacheStats();
      await cache.clear();

      if (options.output === "json") {
        console.log(
          JSON.stringify({
            success: true,
            data: {
              action: "clear",
              cacheDir: cache.getCacheDir(),
              clearedEntries: before.entryCount,
              freedBytes: before.totalSizeBytes,
            },
          }),
        );
        return;
      }

      console.log(
        `🗑️  Cleared ${before.entryCount} cached query result(s) ` +
          `(${formatBytes(before.totalSizeBytes)} freed) from ${cache.getCacheDir()}`,
      );
    });
}

interface CacheStatsOptions {
  output?: "text" | "json";
}

function cacheStatsCommand(): Command {
  return new Command("stats")
    .description("Show query-result cache entry count and total size")
    .option("--output <format>", "Output format: text | json", "text")
    .action(async (options: CacheStatsOptions) => {
      const cache = new QueryResultCache();
      const stats = await cache.getCacheStats();

      if (options.output === "json") {
        console.log(
          JSON.stringify({
            success: true,
            data: {
              cacheDir: cache.getCacheDir(),
              entryCount: stats.entryCount,
              totalSizeBytes: stats.totalSizeBytes,
            },
          }),
        );
        return;
      }

      console.log(`📊 SPARQL query-result cache: ${cache.getCacheDir()}`);
      console.log(`   Entries: ${stats.entryCount.toLocaleString()}`);
      console.log(`   Size:    ${formatBytes(stats.totalSizeBytes)}`);
    });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
