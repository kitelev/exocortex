import type { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

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

  const elapsed = Date.now() - start;
  emitPluginWaitMs({ ms: elapsed, spec: specName, context: "playwright" });
  return elapsed;
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
