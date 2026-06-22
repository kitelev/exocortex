import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * Mutation-score break-budget gate — revert-verify binding.
 *
 * Test-quality improvement-plan 2026-06-22, recommendation P4 (mutation testing
 * core+cli nightly). The NIGHTLY workflow (.github/workflows/mutation-nightly.yml)
 * runs Stryker over packages/{core,cli}/src and feeds the JSON report to
 * `scripts/check-mutation-score.mjs`, which FAILS (exit 1) when the total
 * mutation score drops below the package's break-budget
 * (scripts/mutation-budget.json). A surviving mutant ABOVE budget means a test
 * gap — source was mutated and NO test failed.
 *
 * A full Stryker run is far too slow for the required PR path (decision Q2:
 * nightly only), so THIS required-CI test drives the REAL gate script against
 * fixture Stryker reports — the same integration shape as the over-mock ratchet
 * binding (check-test-antipatterns-overmock.test.ts). It pins the
 * RED-when-below / GREEN-when-at-or-above revert-verify contract that the
 * end-to-end escaped-mutant nightly proof rides on:
 *   • a report whose score is BELOW the budget (escaped mutants survived) → exit 1 (RED)
 *   • a report whose score is AT/ABOVE the budget                          → exit 0 (GREEN)
 *   • a missing report  → exit 1 (fail-closed — no verdict is never "green")
 *   • a report with zero score-relevant mutants → exit 1 (nothing was tested)
 *
 * @req:7af848cd-b8a5-4842-b0fb-b01184a94b95
 */
describe("check-mutation-score.mjs — mutation-score break-budget gate (P4, @req:7af848cd)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const scriptPath = path.join(repoRoot, "scripts/check-mutation-score.mjs");

  let workDir: string;

  /** Build a Stryker JSON report (schema v1) with the given status tally. */
  const writeReport = (
    file: string,
    tally: {
      Killed?: number;
      Timeout?: number;
      Survived?: number;
      NoCoverage?: number;
    },
  ): string => {
    const mutants: { id: string; status: string }[] = [];
    let id = 0;
    for (const [status, n] of Object.entries(tally)) {
      for (let i = 0; i < (n ?? 0); i++) {
        mutants.push({ id: String(id++), status });
      }
    }
    const report = {
      schemaVersion: "1.0",
      thresholds: { high: 80, low: 60 },
      files: {
        "src/example.ts": { language: "typescript", source: "", mutants },
      },
    };
    const p = path.join(workDir, file);
    writeFileSync(p, JSON.stringify(report));
    return p;
  };

  const runGate = (reportPath: string, budget: number) =>
    spawnSync("node", [scriptPath, "--report", reportPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_BUDGET: String(budget) },
    });

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "mutation-score-gate-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("FAILS (exit 1) when survived mutants drop the score BELOW budget (escaped-mutant RED)", () => {
    // 4 killed + 6 survived = 40% total score; budget 50 → RED. The 6 survived
    // mutants are exactly what a deliberately weak test leaves uncaught.
    const report = writeReport("below.json", { Killed: 4, Survived: 6 });
    const r = runGate(report, 50);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("40.00% < break-budget 50%");
    expect(r.stderr).toContain("survived=6");
  });

  it("PASSES (exit 0) when the mutants are killed and score is AT/ABOVE budget (GREEN)", () => {
    // 9 killed + 1 survived = 90% total; budget 50 → GREEN. Removing the weak
    // test (killing the escaped mutants) restores a green gate.
    const report = writeReport("above.json", { Killed: 9, Survived: 1 });
    const r = runGate(report, 50);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("90.00% >= break-budget 50%");
  });

  it("counts Timeout as detected and NoCoverage against the score", () => {
    // (killed 5 + timeout 1) / (5 + 1 + survived 2 + no-cov 2) = 60% → GREEN at 50.
    const report = writeReport("mixed.json", {
      Killed: 5,
      Timeout: 1,
      Survived: 2,
      NoCoverage: 2,
    });
    const r = runGate(report, 50);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("60.00%");
    // ...and RED at a higher budget.
    const r2 = runGate(report, 70);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain("no-coverage=2");
  });

  it("fails closed (exit 1) when the report is missing — no verdict is never green", () => {
    const r = runGate(path.join(workDir, "does-not-exist.json"), 50);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("cannot read Stryker report");
  });

  it("fails closed (exit 1) when the report has zero score-relevant mutants", () => {
    const report = writeReport("empty.json", {});
    const r = runGate(report, 50);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("zero score-relevant mutants");
  });
});
