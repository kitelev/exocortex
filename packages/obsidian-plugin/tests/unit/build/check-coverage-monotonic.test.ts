import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * Coverage-monotonic ratchet guard — revert-verify binding.
 *
 * Test-quality audit 2026-06-22, recommendation P5.1. `scripts/check-coverage-monotonic.mjs`
 * enforces that every jest `coverageThreshold.global` metric stays AT or ABOVE
 * the high-water mark in `scripts/coverage-thresholds-baseline.json`. Thresholds
 * may rise freely; a value drifting BELOW baseline (the documented plugin
 * branches 64->63 "marginal failure" smell) fails the guard. Lowering a baseline
 * number is the explicit, req-justified withdrawal (RFC 0003).
 *
 * This test drives the REAL guard script against fixture jest configs + a
 * fixture baseline (via `COVERAGE_ROOT` + `COVERAGE_BASELINE`) and asserts the
 * revert-verify contract:
 *   • a fixture threshold BELOW baseline → exit 1 (coverage regression)
 *   • the threshold restored to baseline → exit 0
 *   • a threshold ABOVE baseline (growth) → exit 0.
 *
 * @req:289f87f4-23c8-4106-8069-0823c45167fe
 */
describe("check-coverage-monotonic.mjs — coverage-threshold monotonicity (P5.1, @req:289f87f4)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const scriptPath = path.join(repoRoot, "scripts/check-coverage-monotonic.mjs");

  let fixtureRoot: string;
  let configPath: string;
  let baselinePath: string;

  const writeConfig = (branches: number) => {
    writeFileSync(
      configPath,
      [
        "module.exports = {",
        "  coverageThreshold: {",
        `    global: { branches: ${branches}, functions: 70, lines: 65, statements: 65 },`,
        "  },",
        "};",
        "",
      ].join("\n"),
    );
  };

  const runGuard = () =>
    spawnSync("node", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        COVERAGE_ROOT: fixtureRoot,
        COVERAGE_BASELINE: baselinePath,
      },
    });

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "coverage-monotonic-"));
    mkdirSync(path.join(fixtureRoot, "packages/foo"), { recursive: true });
    configPath = path.join(fixtureRoot, "packages/foo/jest.config.js");
    baselinePath = path.join(fixtureRoot, "baseline.json");
    // High-water mark: branches must be >= 63.
    writeFileSync(
      baselinePath,
      JSON.stringify({
        thresholds: {
          "packages/foo/jest.config.js": {
            branches: 63,
            functions: 70,
            lines: 65,
            statements: 65,
          },
        },
      }),
    );
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("FAILS (exit 1) when a threshold drifts BELOW baseline", () => {
    writeConfig(60); // branches 60 < baseline 63
    const r = runGuard();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("below baseline");
    expect(r.stderr).toContain("branches: 60 < baseline 63");
  });

  it("PASSES (exit 0) when the threshold is restored to baseline (revert-verify GREEN)", () => {
    writeConfig(63); // == baseline
    const r = runGuard();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("coverage-monotonic guard OK");
  });

  it("PASSES (exit 0) when a threshold GROWS above baseline (ratchet up allowed)", () => {
    writeConfig(70); // > baseline 63
    const r = runGuard();
    expect(r.status).toBe(0);
  });
});
