import type { ILogger } from "@kitelev/exocortex-core";

/**
 * Console-backed {@link ILogger} for the CLI that writes to **stderr only**.
 *
 * ⛔ NEVER stdout. `resolve-buttons --json`, `create`, `set-body` and `apply --json`
 * emit machine-readable JSON on stdout, and callers parse it — a single log line
 * there turns a valid document into a parse error. That contract is the whole reason
 * the CLI ran with `NullLogger` until now (issue #4077): wiring a logger was not a
 * size problem but an output-contract problem.
 *
 * ⛤ Why the silence mattered: `CommandResolver` warns when a PropertyDefault value
 * asset is missing from the store and the entry is skipped or emitted as a wikilink.
 * That warning is the only signal explaining a property that silently did not land.
 * On the plugin path it reaches a toast and the log file; on the CLI it went nowhere —
 * including on `resolve-buttons`, which is documented as the authoritative resolution
 * oracle and the cheapest reproduction path. Investigating a corrupted asset through
 * it produced the same silence that forced defect 0310aa28 to be narrowed by
 * elimination rather than measured.
 *
 * `debug` is gated behind `EXOCORTEX_DEBUG` because it fires per-resolution and would
 * bury the lines a human is actually looking for; `info`/`warn`/`error` always print.
 */
export const StderrLogger: ILogger = {
  debug(message: string, context?: Record<string, unknown>): void {
    if (!process.env.EXOCORTEX_DEBUG) return;
    write("debug", message, context);
  },
  info(message: string, context?: Record<string, unknown>): void {
    write("info", message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    write("warn", message, context);
  },
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    write("error", error ? `${message} — ${error.message}` : message, context);
  },
};

function write(
  level: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  const suffix =
    context && Object.keys(context).length > 0 ? ` ${safeJson(context)}` : "";
  process.stderr.write(`[${level}] ${message}${suffix}\n`);
}

/**
 * A logger must never throw: a context object carrying a cycle (or a BigInt) would
 * otherwise turn a diagnostic into the failure it was meant to explain.
 */
function safeJson(context: Record<string, unknown>): string {
  try {
    return JSON.stringify(context);
  } catch {
    return "[uninspectable context]";
  }
}
