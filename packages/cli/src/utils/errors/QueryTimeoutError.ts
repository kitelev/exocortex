import { ExitCodes } from "../ExitCodes.js";
import { CLIError } from "./CLIError.js";
import { ErrorCode } from "../../responses/index.js";

/**
 * Error thrown when a SPARQL query exceeds the configured timeout.
 *
 * This error provides:
 * - Clear timeout and elapsed time information
 * - Guidance on how to increase timeout
 * - Structured JSON response for MCP tools
 */
export class QueryTimeoutError extends CLIError {
  readonly exitCode = ExitCodes.OPERATION_FAILED;
  readonly errorCode = ErrorCode.INTERNAL_QUERY_TIMEOUT;
  readonly guidance: string;

  /**
   * Creates a new QueryTimeoutError.
   *
   * @param timeoutMs - The configured timeout in milliseconds
   * @param elapsedMs - The actual elapsed time before timeout (optional)
   * @param partialResultsCount - Number of partial results available (optional)
   */
  constructor(
    timeoutMs: number,
    elapsedMs?: number,
    partialResultsCount?: number,
  ) {
    const timeoutSec = Math.round(timeoutMs / 1000);
    const elapsedSec = elapsedMs !== undefined ? Math.round(elapsedMs / 1000) : timeoutSec;

    const message = `Query timeout after ${elapsedSec}s (limit: ${timeoutSec}s)`;

    super(
      message,
      {
        timeoutMs,
        elapsedMs: elapsedMs ?? timeoutMs,
        partialResultsCount,
      },
      {
        message: `Increase timeout with --timeout <duration> (e.g., --timeout 60s)`,
        suggestion: `exocortex sparql query --timeout ${timeoutSec * 2}s "..."`,
      },
    );

    this.guidance = `Query exceeded the ${timeoutSec}s timeout limit.

To fix this:
  1. Increase timeout: --timeout ${timeoutSec * 2}s
  2. Set global timeout: export EXOCORTEX_SPARQL_TIMEOUT=${timeoutSec * 2}s
  3. Simplify query: reduce WHERE clauses or add LIMIT
  4. Use cache: --use-cache for faster vault loading${partialResultsCount !== undefined ? `

Partial results: ${partialResultsCount} result(s) were collected before timeout.` : ""}`;
  }
}
