import type { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { emitColdStartStep } from "./coldStartTelemetry";

/**
 * Default cold-start wait ceiling (RFC 3cc77ba2 v2 §Phase 1.2):
 * - 30s guardrail against pathological Docker cold-starts (P99 measured ~11s).
 * - 15s paired P99 gate is applied post-hoc by the CI aggregator, not inline.
 */
export const PLUGIN_WAIT_TIMEOUT_MS_DEFAULT = 30_000;

export interface WaitForExocortexPluginOptions {
  /** Wait ceiling in milliseconds. Default: {@link PLUGIN_WAIT_TIMEOUT_MS_DEFAULT}. */
  timeoutMs?: number;
  /** Test/spec identifier recorded in the PLUGIN_WAIT_MS log. */
  specName?: string;
}

/**
 * Playwright-level wait for the Exocortex plugin to register on
 * `window.app.plugins.plugins.exocortex`. Replaces the in-spec
 * `maxPluginWait = 10` for-loops that were classified as Category B
 * environment flakes in RFC 3cc77ba2 v2 §Category B.
 *
 * Emits a `[PLUGIN_WAIT_MS] ms=N spec=X context=playwright` log line to stdout
 * for CI stdout scrapers. If the `PLUGIN_WAIT_MS_LOG` env var is set (CI only),
 * also appends a JSONL record to that path for per-shard aggregation.
 */
export async function waitForExocortexPluginViaPlaywright(
  page: Page,
  opts: WaitForExocortexPluginOptions = {},
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? PLUGIN_WAIT_TIMEOUT_MS_DEFAULT;
  const specName = opts.specName ?? "unknown";
  const start = Date.now();

  // Phase 3.1 cold-start telemetry — record obsidian_spawn (window.app present)
  // separately from plugin_load (exocortex registered).
  await page.waitForFunction(
    () => {
      const w = window as unknown as { app?: unknown };
      return Boolean(w.app);
    },
    undefined,
    { timeout: timeoutMs },
  );
  const obsidianSpawnMs = Date.now() - start;
  emitColdStartStep({
    step: "obsidian_spawn",
    ms: obsidianSpawnMs,
    spec: specName,
    shard: process.env.E2E_SHARD_ID,
    context: "node",
  });

  const pluginLoadStart = Date.now();
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        app?: { plugins?: { plugins?: { exocortex?: unknown } } };
      };
      return Boolean(w.app?.plugins?.plugins?.exocortex);
    },
    undefined,
    { timeout: timeoutMs },
  );

  const pluginLoadMs = Date.now() - pluginLoadStart;
  const elapsed = Date.now() - start;
  emitPluginWaitMs({ ms: elapsed, spec: specName, context: "playwright" });
  emitColdStartStep({
    step: "plugin_load",
    ms: pluginLoadMs,
    spec: specName,
    shard: process.env.E2E_SHARD_ID,
    context: "node",
  });
  return elapsed;
}

/**
 * Cold-start telemetry helper — wait for vault index readiness and emit the
 * `vault_index` step duration. Backwards-compatible: callers who don't invoke
 * this just don't get the step in the JSONL log.
 */
export async function waitForVaultIndex(
  page: Page,
  opts: { specName?: string; timeoutMs?: number } = {},
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? PLUGIN_WAIT_TIMEOUT_MS_DEFAULT;
  const specName = opts.specName ?? "unknown";
  const start = Date.now();

  await page.waitForFunction(
    async () => {
      const w = window as unknown as {
        app?: { vault?: { adapter?: { list?: (p: string) => Promise<unknown> } } };
      };
      const list = w.app?.vault?.adapter?.list;
      if (!list) return false;
      try {
        await list.call(w.app!.vault!.adapter!, "/");
        return true;
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: timeoutMs },
  );

  const elapsed = Date.now() - start;
  emitColdStartStep({
    step: "vault_index",
    ms: elapsed,
    spec: specName,
    shard: process.env.E2E_SHARD_ID,
    context: "node",
  });
  return elapsed;
}

/**
 * Cold-start telemetry helper — record `first_interaction` step. Pass a closure
 * that performs the first user-facing action (click, navigation, fixture load).
 * Returns the elapsed milliseconds for that closure.
 */
export async function recordFirstInteraction<T>(
  fn: () => Promise<T>,
  opts: { specName?: string } = {},
): Promise<{ result: T; ms: number }> {
  const specName = opts.specName ?? "unknown";
  const start = Date.now();
  const result = await fn();
  const ms = Date.now() - start;
  emitColdStartStep({
    step: "first_interaction",
    ms,
    spec: specName,
    shard: process.env.E2E_SHARD_ID,
    context: "node",
  });
  return { result, ms };
}

/**
 * Browser-context plugin-wait snippet, exported as a string so it can be
 * inlined via `page.evaluate(new Function(\`return ${evaluateWaitForPlugin}\`)())`.
 *
 * Use this when a test MUST poll for the plugin from inside `page.evaluate()`
 * (e.g. to read the plugin reference that does not survive serialisation).
 * Prefer {@link waitForExocortexPluginViaPlaywright} when the plugin reference
 * is not needed downstream of the evaluate boundary.
 *
 * The function body is self-contained (no external refs) to survive
 * stringification. Uses a structured polling loop paired with a deterministic
 * predicate, bounded by `timeoutMs`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const evaluateWaitForPlugin = (async function (
  timeoutMs = 30000,
): Promise<unknown | null> {
  const start = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as unknown as { app?: any };
  while (Date.now() - start < timeoutMs) {
    const plugin = w.app?.plugins?.plugins?.exocortex;
    if (plugin) {
      // eslint-disable-next-line no-console
      console.log(
        `[PLUGIN_WAIT_MS] ms=${Date.now() - start} context=browser`,
      );
      return plugin;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}).toString();

/**
 * CI metric emission. Writes to `PLUGIN_WAIT_MS_LOG` (if set) as JSONL, and
 * always logs to stdout. Silent no-op on write failure — observability is
 * advisory, not test-blocking.
 */
function emitPluginWaitMs(record: {
  ms: number;
  spec: string;
  context: "playwright" | "browser";
}): void {
  // eslint-disable-next-line no-console
  console.log(
    `[PLUGIN_WAIT_MS] ms=${record.ms} spec=${record.spec} context=${record.context}`,
  );

  const logPath = process.env.PLUGIN_WAIT_MS_LOG;
  if (!logPath || logPath.length === 0) return;

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      JSON.stringify({ ...record, ts: Date.now() }) + "\n",
      "utf8",
    );
  } catch {
    // Observability is best-effort; do not fail tests on metric emission errors.
  }
}
