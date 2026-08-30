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
describe("check-coverage-monotonic.mjs — coverage-threshold monotonicity (P5.1, @req:289f87f4-23c8-4106-8069-0823c45167fe)", () => {
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

  // ── Population floor (#4090) ──────────────────────────────────────────────────
  //
  // The three cases above all vary a threshold NUMBER, so every one of them enters the
  // per-entry loop. None of them can reach the failure this section covers: the loop
  // iterates Object.entries(baseline), so an EMPTY baseline never enters it, collects no
  // violation, and the guard printed "✅ … 0 threshold(s)" with exit 0 — satisfied by an
  // empty input. Measured on origin/main before the fix: exit 0.
  it("FAILS (exit 1) on an EMPTY baseline instead of passing with 0 thresholds", () => {
    writeConfig(63);
    writeFileSync(baselinePath, JSON.stringify({ thresholds: {} }));
    const r = runGuard();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("declare a");
    expect(r.stderr).toContain("NOT in the baseline");
  });

  // The complement, and the reason the check is a POSITIVE scope proof rather than a
  // non-emptiness test: a baseline can be non-empty and still not cover a config that
  // declares thresholds. Pre-fix that config was simply never visited — its thresholds
  // could fall to zero and the success line would just print a smaller count.
  it("FAILS (exit 1) when a config declares thresholds but is absent from the baseline", () => {
    writeConfig(63);
    mkdirSync(path.join(fixtureRoot, "packages/bar"), { recursive: true });
    writeFileSync(
      path.join(fixtureRoot, "packages/bar/jest.config.js"),
      "module.exports = { coverageThreshold: { global: { branches: 10 } } };\n",
    );
    const r = runGuard();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("packages/bar/jest.config.js");
  });

  // The carrier is a SHAPE, not one filename. packages/obsidian-plugin/jest.ui.config.js
  // exists today in the very package this baseline gates; when the enumeration was
  // `jest.config.js` alone, a threshold added there — and in .mjs/.ts/.cjs siblings —
  // was invisible, which is a false GREEN on the check meant to prove completeness.
  it.each(["jest.ui.config.js", "jest.config.mjs", "jest.config.ts", "jest.config.cjs"])(
    "FAILS (exit 1) when %s declares thresholds but is absent from the baseline",
    (fileName) => {
      writeConfig(63);
      mkdirSync(path.join(fixtureRoot, "packages/bar"), { recursive: true });
      writeFileSync(
        path.join(fixtureRoot, "packages/bar", fileName),
        "module.exports = { coverageThreshold: { global: { branches: 10 } } };\n",
      );
      const r = runGuard();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`packages/bar/${fileName}`);
    },
  );

  // Structural, not a substring: the word appearing in a COMMENT used to red a REQUIRED
  // check, and the remedy it printed would have written a vacuous `{}` baseline entry.
  it("PASSES (exit 0) when a config only MENTIONS coverageThreshold in a comment", () => {
    writeConfig(63);
    mkdirSync(path.join(fixtureRoot, "packages/qux"), { recursive: true });
    writeFileSync(
      path.join(fixtureRoot, "packages/qux/jest.config.js"),
      "// no coverageThreshold here on purpose\nmodule.exports = { testEnvironment: 'node' };\n",
    );
    const r = runGuard();
    expect(r.status).toBe(0);
  });

  // A package WITHOUT thresholds must not be demanded in the baseline — otherwise the
  // check would red on every package that simply does not measure coverage.
  it("PASSES (exit 0) when a package has a jest config but declares no thresholds", () => {
    writeConfig(63);
    mkdirSync(path.join(fixtureRoot, "packages/baz"), { recursive: true });
    writeFileSync(
      path.join(fixtureRoot, "packages/baz/jest.config.js"),
      "module.exports = { testEnvironment: 'node' };\n",
    );
    const r = runGuard();
    expect(r.status).toBe(0);
  });
});
