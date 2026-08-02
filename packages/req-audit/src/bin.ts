#!/usr/bin/env node
/**
 * `requirements-audit` — RFC 0003 requirements-traceability checker.
 *
 * Repo-internal DEV TOOLING, not a product surface. Extracted out of
 * `@kitelev/exocortex-cli` by RFC 7c7859d1 W-req (migration-first): the checker
 * is a CI gate for THIS repo, so it has no business occupying a verb of the
 * published product CLI. Consumers: the `requirements-trace` job in
 * `.github/workflows/ci.yml` (see ADR `.archgate/adrs/REQ-001-*`).
 *
 * Self-contained on purpose — it depends on neither `@kitelev/exocortex-core`
 * nor the CLI, so the CI job runs it directly (`npx tsx`) with no build chain.
 *
 * @example
 *   npx tsx packages/req-audit/src/bin.ts --reqs "$RUNNER_TEMP/reqs" --tests . \
 *     --gate soft --output json
 */
import { runAudit, type GateMode, type OutputFormat } from "./audit.js";

const USAGE = `requirements-audit — requirement↔test traceability checker (RFC 0003)

Usage:
  requirements-audit --reqs <path> [--tests <path>] [--output text|json]
                     [--gate soft|hard] [--strict]

Options:
  --reqs <path>     Directory tree containing req__Requirement assets (required)
  --tests <path>    Test-corpus root scanned for @req:<uid> tags (default: ".")
  --output <type>   Response format: text|json (default: "text")
  --gate <mode>     soft (warn only on hard findings) | hard (also block when
                    the P0 checklist is not ramp-ready) (default: "soft")
  --strict          Also exit 1 on orphan requirements
  -h, --help        Show this help

Exit code: 0 when there are no hard findings, 1 otherwise.`;

interface ParsedArgs {
  reqs?: string;
  tests?: string;
  output?: string;
  gate?: string;
  strict: boolean;
  help: boolean;
}

/**
 * Parse the argv vector. Deliberately hand-rolled (no `commander`) to keep the
 * tool dependency-light; the flag surface is frozen by the CI job + the
 * `--output json` contract consumed by the PR-comment script.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { strict: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (name: string): string => {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`Missing value for ${name}`);
      }
      return value;
    };
    switch (arg) {
      case "--reqs":
        out.reqs = takeValue(arg);
        break;
      case "--tests":
        out.tests = takeValue(arg);
        break;
      case "--output":
        out.output = takeValue(arg);
        break;
      case "--gate":
        out.gate = takeValue(arg);
        break;
      case "--strict":
        out.strict = true;
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return out;
}

/**
 * Entrypoint body. Exported (and NOT self-invoked here) so importing this module
 * for `parseArgs` in a test has zero side effects — `src/cli.ts` is the thin
 * runnable wrapper that calls it.
 */
export async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ ${(error as Error).message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (!parsed.reqs) {
    console.error(`❌ Missing required option: --reqs\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  try {
    // `--output` / `--gate` are passed through unvalidated ON PURPOSE — this
    // mirrors the Commander behaviour of the CLI subcommand this replaced
    // (`gate === "hard" ? "hard" : "soft"`, any other `--output` renders text),
    // so a typo degrades to the soft/text default exactly as it did before.
    process.exitCode = await runAudit({
      reqs: parsed.reqs,
      tests: parsed.tests,
      output: parsed.output as OutputFormat | undefined,
      gate: parsed.gate as GateMode | undefined,
      strict: parsed.strict,
    });
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exitCode = 2;
  }
}
