#!/usr/bin/env node
//
// check-mutation-score.mjs — mutation-score break-budget gate.
//
// Source: test-quality improvement-plan 2026-06-22, recommendation P4 (mutation
// testing core+cli nightly). Stryker mutation testing PROVES the test suite
// actually catches bugs — it mutates source and checks whether a test fails
// ("kills" the mutant). A surviving mutant is a test-harness gap the manual
// per-fix revert-verify discipline cannot find systemically. This gate reads a
// Stryker JSON report and FAILS (exit 1) when the total mutation score falls
// BELOW the package's committed break-budget (scripts/mutation-budget.json).
//
// It runs in the NIGHTLY cron workflow (.github/workflows/mutation-nightly.yml),
// NOT in the required PR checks — a full Stryker run over packages/core +
// packages/cli is far too slow for the critical PR path (decision Q2: nightly
// only). The budget is intentionally a conservative honest floor (initial
// scores can be low); ratchet it UP in mutation-budget.json as the suite hardens.
//
// Total mutation score (the honest one — no-coverage counts against you):
//     (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage) * 100
// CompileError / RuntimeError / Ignored mutants are excluded from the
// denominator (they were never a valid test of the suite).
//
// Usage:
//   node scripts/check-mutation-score.mjs --report <path> --package <core|cli>
//   node scripts/check-mutation-score.mjs --report <path> --budget 50
//   node scripts/check-mutation-score.mjs --report <path> --package core --summary "$GITHUB_STEP_SUMMARY"
//
// Testability (the @req binding test drives the gate against fixture reports):
//   MUTATION_REPORT       — path to the Stryker JSON report (overrides --report)
//   MUTATION_BUDGET       — numeric break-budget (overrides --budget and the file)
//   MUTATION_BUDGET_FILE  — path to the budget JSON (default: <root>/scripts/mutation-budget.json)
//   MUTATION_PACKAGE      — budget key to read from the budget file (overrides --package)

import { readFileSync, appendFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

/** Minimal CLI-arg parser: `--flag value` and `--flag` (boolean). */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/**
 * Tally the four score-relevant mutant statuses across every file in a Stryker
 * JSON report (mutation-testing schema v1).
 *
 * @param {{files: Record<string, {mutants: {status: string}[]}>}} report
 * @returns {{killed:number, timeout:number, survived:number, noCoverage:number, other:number, total:number}}
 */
export function tallyMutants(report) {
  const counts = {
    killed: 0,
    timeout: 0,
    survived: 0,
    noCoverage: 0,
    other: 0,
  };
  // A report that parses as JSON `null`, a string, or an array has no mutants —
  // route it through the zero-mutants fail-closed path (never crash with a raw
  // stack trace, never silently pass).
  const files =
    report && typeof report === "object" ? (report.files ?? {}) : {};
  for (const fileReport of Object.values(files)) {
    for (const mutant of fileReport.mutants ?? []) {
      switch (mutant.status) {
        case "Killed":
          counts.killed++;
          break;
        case "Timeout":
          counts.timeout++;
          break;
        case "Survived":
          counts.survived++;
          break;
        case "NoCoverage":
          counts.noCoverage++;
          break;
        default:
          // CompileError / RuntimeError / Ignored — excluded from the score.
          counts.other++;
      }
    }
  }
  counts.total =
    counts.killed + counts.timeout + counts.survived + counts.noCoverage;
  return counts;
}

/**
 * Total mutation score (0..100). Detected = Killed + Timeout; the denominator
 * counts uncaught mutants (Survived) and untested code (NoCoverage). Returns
 * null when there are zero score-relevant mutants (nothing to judge).
 *
 * @param {ReturnType<typeof tallyMutants>} counts
 * @returns {number|null}
 */
export function mutationScore(counts) {
  if (counts.total === 0) return null;
  return ((counts.killed + counts.timeout) / counts.total) * 100;
}

/** Reject a non-finite budget so a typo fails CLOSED, never `score < NaN` (false → green). */
function asFiniteBudget(raw, source) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(
      `budget from ${source} is not a number: ${JSON.stringify(raw)}`,
    );
  }
  return { value, source };
}

function resolveBudget(args) {
  if (process.env.MUTATION_BUDGET !== undefined) {
    return asFiniteBudget(process.env.MUTATION_BUDGET, "env MUTATION_BUDGET");
  }
  if (args.budget !== undefined && args.budget !== true) {
    return asFiniteBudget(args.budget, "--budget");
  }
  const pkg = process.env.MUTATION_PACKAGE ?? args.package;
  if (!pkg || pkg === true) {
    throw new Error(
      "no budget given — pass --budget <n>, --package <key>, or set MUTATION_BUDGET",
    );
  }
  const budgetFile =
    process.env.MUTATION_BUDGET_FILE ??
    resolve(SCRIPT_DIR, "mutation-budget.json");
  const parsed = JSON.parse(readFileSync(budgetFile, "utf8"));
  const budgets = parsed.budgets ?? parsed;
  if (budgets[pkg] === undefined) {
    throw new Error(
      `budget key "${pkg}" not found in ${budgetFile} (keys: ${Object.keys(budgets).join(", ")})`,
    );
  }
  return asFiniteBudget(budgets[pkg], `${budgetFile}#${pkg}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = process.env.MUTATION_REPORT ?? args.report;
  if (!reportPath || reportPath === true) {
    console.error(
      "❌ mutation-score gate: no report path — pass --report <path> or set MUTATION_REPORT",
    );
    process.exit(1);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (e) {
    // Fail-closed: a missing/unparseable report means the nightly run did not
    // produce a verdict — treat that as RED, never silently green.
    console.error(
      `❌ mutation-score gate: cannot read Stryker report ${reportPath}: ${e.message}`,
    );
    process.exit(1);
  }

  let budget;
  try {
    budget = resolveBudget(args);
  } catch (e) {
    console.error(`❌ mutation-score gate: ${e.message}`);
    process.exit(1);
  }

  const counts = tallyMutants(report);
  const score = mutationScore(counts);
  const label =
    process.env.MUTATION_PACKAGE ??
    (args.package && args.package !== true ? args.package : "report");

  if (score === null) {
    console.error(
      `❌ mutation-score gate [${label}]: report has zero score-relevant mutants — nothing was tested (failing closed).`,
    );
    process.exit(1);
  }

  const scoreStr = score.toFixed(2);
  const detail =
    `killed=${counts.killed} timeout=${counts.timeout} ` +
    `survived=${counts.survived} no-coverage=${counts.noCoverage}` +
    (counts.other ? ` (excluded: ${counts.other})` : "");

  // Optional GitHub job-summary observability (markdown).
  const summaryPath =
    args.summary && args.summary !== true
      ? args.summary
      : process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const verdict = score >= budget.value ? "✅ PASS" : "❌ BELOW BUDGET";
    try {
      appendFileSync(
        summaryPath,
        `| \`${label}\` | **${scoreStr}%** | ${budget.value}% | ${verdict} | ` +
          `${counts.killed} | ${counts.timeout} | ${counts.survived} | ${counts.noCoverage} |\n`,
      );
    } catch {
      /* summary is best-effort observability — never fail the gate over it */
    }
  }

  if (score < budget.value) {
    console.error(
      `❌ mutation-score gate [${label}]: ${scoreStr}% < break-budget ${budget.value}% (${budget.source})`,
    );
    console.error(`   ${detail}`);
    console.error(
      "\n   A surviving mutant above budget means a test gap: source was mutated and\n" +
        "   NO test failed. Kill the surviving mutants (strengthen the tests) — see the\n" +
        "   Stryker HTML report. To lower the budget instead, edit scripts/mutation-budget.json\n" +
        "   (a conscious withdrawal under RFC 0003 everything-req-first).",
    );
    process.exit(1);
  }

  console.log(
    `✅ mutation-score gate [${label}]: ${scoreStr}% >= break-budget ${budget.value}% (${budget.source})`,
  );
  console.log(`   ${detail}`);
}

main();
