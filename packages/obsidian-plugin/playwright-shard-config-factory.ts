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
  return defineConfig({
    ...baseConfig,
    projects: [
      {
        name: `e2e-shard-${shardIndex}`,
        testMatch: specs,
      },
    ],
  });
}
