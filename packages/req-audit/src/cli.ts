#!/usr/bin/env node
/**
 * Runnable wrapper for the `requirements-audit` tool (RFC 0003 / RFC 7c7859d1
 * W-req). Kept separate from `bin.ts` so importing the argv parser in a test
 * never executes the CLI.
 *
 * @example
 *   npx tsx packages/req-audit/src/cli.ts --reqs "$RUNNER_TEMP/reqs" --tests .
 */
import { main } from "./bin.js";

void main();
