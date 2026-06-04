import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";
import baseConfig from "./playwright-e2e.config";
import shardData from "./playwright-shard-assignments.json";

export function buildShardConfig(shardIndex: number): PlaywrightTestConfig {
  const specs = shardData.shards[shardIndex - 1];
  if (!specs || !Array.isArray(specs) || specs.length === 0) {
    throw new Error(
      `Invalid shard index ${shardIndex}: expected 1..${shardData.shards.length}`,
    );
  }
  // Issue #3350: mirror the two-project @flaky-track routing from
  // `playwright-e2e.config.ts` inside each shard. Within a shard, the
  // default project takes untagged specs with retries: 0 (baseConfig);
  // the -flaky-track sibling takes tagged specs with retries: 1. Project
  // grep / grepInvert ensure each spec is executed in exactly one project,
  // so the shard's testMatch set stays partitioned, not duplicated.
  // The `projects: [...]` key below replaces baseConfig.projects via object
  // spread (no array merge). Shards 1/5/6 currently host no @flaky-track
  // specs — their -flaky-track project enumerates zero tests, which
  // Playwright tolerates (exit 0, no warning).
  return defineConfig({
    ...baseConfig,
    projects: [
      {
        name: `e2e-shard-${shardIndex}`,
        testMatch: specs,
        grepInvert: /@flaky-track/,
      },
      {
        name: `e2e-shard-${shardIndex}-flaky-track`,
        testMatch: specs,
        grep: /@flaky-track/,
        retries: 1,
      },
    ],
  });
}
