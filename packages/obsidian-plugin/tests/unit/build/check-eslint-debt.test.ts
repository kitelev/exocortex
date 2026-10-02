import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * eslint-debt ratchet — revert-verify binding (issue #4497).
 *
 * `scripts/check-eslint-debt.mjs` is the eslint gate of the required `lint` job.
 * The defect it exists for had two halves, and the issue only named the first:
 *
 *   1. the root `lint` script pointed eslint at ONE package
 *      (`packages/obsidian-plugin/src`) out of six carrying TypeScript, so
 *      core / services / cli / req-audit / test-utils were never linted in CI;
 *   2. the step carried `continue-on-error: true` (fa5251f8, "allow lint
 *      WARNINGS to not fail CI"), so the job could not fail at ANY number of
 *      eslint ERRORS — including in the one package it did point at. Measured on
 *      main@204898e1: `npm run lint` exited 1 with 56 errors, `lint` was green.
 *
 * These axes drive the REAL guard script (not a reimplementation) against
 * fixture trees via `ESLINT_DEBT_ROOT`, which relocates the package tree, the
 * eslint config, the TS project and the baseline. The production path and the
 * fixture path are the same code.
 *
 * ⛤ Why the axes go beyond "a new error reddens it". The obvious guard — widen
 * the path list and keep counting — passes that single flip and is wrong in
 * several directions at once:
 *   • EL1/EL3 are the SCOPE axes, which is what #4497 is actually about. A guard
 *     that lints one hand-listed package passes a new-error flip inside that
 *     package and fails EL1 — and the issue is precisely that the other five
 *     were unjudged. EL3 is the harder half: a sweep NARROWER than the baseline
 *     describes must be rc=2 ("not judged"), not a quiet pass.
 *   • EL4/EL5 are the two sides of "eslint cannot judge this package".
 *     packages/cli is excluded from tsconfig.eslint.json, so all 122 of its
 *     files come back as FATAL parse errors; baselining those would be 122 keys
 *     asserting nothing. So an excluded package is dropped WITH ITS REASON
 *     PRINTED (EL4), while a fatal inside the derived scope is rc=2 (EL5) —
 *     either a package is judged or the run refuses to call itself clean.
 *   • EL6/EL7 keep the ratchet from becoming a licence in both directions: a
 *     second instance of a baselined pair is a finding, and a pair that no
 *     longer occurs means the baseline stopped describing the code.
 *   • EL8 is the preserved intent of fa5251f8 — warnings are reported, never
 *     gated. Its mutant is the one that would quietly re-break the thing that
 *     commit asked for.
 *   • EL9/EL10 are the population floor: zero findings over zero input, or over
 *     an unreadable baseline, is not a pass.
 *
 * Issue #4497. CI-config change — no `@req:` binding (RFC 0003 exempts bug
 * fixes / CI config), consistent with the other guard axes in this directory.
 */
describe("check-eslint-debt.mjs — eslint ratchet over every lintable packages/*/src (#4497)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const scriptPath = path.join(repoRoot, "scripts/check-eslint-debt.mjs");

  let fixtureRoot: string;

  /** Write `<fixtureRoot>/<rel>`, creating parents. */
  const write = (rel: string, body: string) => {
    const full = path.join(fixtureRoot, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };

  /**
   * A plugin-free flat config: no imports, so the fixture needs no
   * node_modules of its own, and the default parser handles the JS-compatible
   * `.ts` bodies below. `no-console` is the error rule, `no-debugger` the
   * warning rule — both core eslint, both stable.
   */
  const eslintConfig = [
    "export default [",
    '  { files: ["**/*.ts"], rules: { "no-console": "error", "no-debugger": "warn" } },',
    "];",
    "",
  ].join("\n");

  /** `exclude` holds whatever the caller wants to put outside the TS project. */
  const tsProject = (exclude: string[]) =>
    JSON.stringify({ include: ["packages/**/*.ts"], exclude }, null, 2) + "\n";

  const baseline = (
    scope: string[],
    entries: Array<{ file: string; rule: string; count: number }>,
  ) => JSON.stringify({ scope, entries }, null, 2) + "\n";

  const runGuard = (...args: string[]) =>
    spawnSync("node", [scriptPath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, ESLINT_DEBT_ROOT: fixtureRoot },
    });

  /** The minimal viable fixture: two lintable packages, one clean baseline. */
  const seedTwoCleanPackages = () => {
    write("eslint.config.mjs", eslintConfig);
    write("tsconfig.eslint.json", tsProject(["node_modules"]));
    write("packages/alpha/src/a.ts", "export const a = 1;\n");
    write("packages/beta/src/b.ts", "export const b = 2;\n");
    write("scripts/eslint-debt.baseline.json", baseline(["alpha", "beta"], []));
  };

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "eslint-debt-"));
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  // ── Scope: the actual subject of #4497 ────────────────────────────────────

  it("EL1 DERIVES its scope from the tree — a package added later is swept without touching the guard", () => {
    seedTwoCleanPackages();
    // A third package arrives, already in the baseline's scope: nothing about
    // the guard mentions it, yet it must be linted.
    write("packages/gamma/src/g.ts", "export const g = 3;\n");
    write(
      "scripts/eslint-debt.baseline.json",
      baseline(["alpha", "beta", "gamma"], []),
    );

    const r = runGuard();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("across 3 package(s) [alpha, beta, gamma]");
  });

  it("EL2 FAILS (exit 1) on a new error in a package that is NOT the first one — the #4497 hole", () => {
    seedTwoCleanPackages();
    write("packages/beta/src/b.ts", 'console.log("new debt");\n');

    const r = runGuard();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NEW eslint error(s)");
    expect(r.stderr).toContain("packages/beta/src/b.ts — no-console");
  });

  it("EL3 is NOT JUDGED (exit 2) when the sweep covers FEWER packages than the baseline names", () => {
    seedTwoCleanPackages();
    // beta is still in the baseline's scope but has left the TS project, so the
    // run says nothing about it. A quiet pass here is the defect.
    write(
      "tsconfig.eslint.json",
      tsProject(["node_modules", "packages/beta/**/*"]),
    );

    const r = runGuard();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("FEWER packages than the baseline");
    expect(r.stderr).toContain("Missing: beta");
  });

  // ── "eslint cannot judge this package": the two sides ─────────────────────

  it("EL4 DROPS a package excluded from the TS project and PRINTS the reason instead of baselining its fatals", () => {
    write("eslint.config.mjs", eslintConfig);
    write(
      "tsconfig.eslint.json",
      tsProject(["node_modules", "packages/excluded/**/*"]),
    );
    write("packages/alpha/src/a.ts", "export const a = 1;\n");
    // Would be 1 error if judged — it must not reach the findings at all.
    write("packages/excluded/src/x.ts", 'console.log("not judged");\n');
    write("scripts/eslint-debt.baseline.json", baseline(["alpha"], []));

    const r = runGuard();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("across 1 package(s) [alpha]");
    expect(r.stdout).toContain(
      'packages/excluded/src is NOT linted: tsconfig.eslint.json excludes "packages/excluded/**/*"',
    );
    expect(r.stdout).not.toContain("packages/excluded/src/x.ts");
  });

  it("EL5 is NOT JUDGED (exit 2) when a file INSIDE the derived scope fails to parse — never a silent skip", () => {
    seedTwoCleanPackages();
    write("packages/beta/src/broken.ts", "export const = ;\n");

    const r = runGuard();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("fatal parse error(s) inside the");
    expect(r.stderr).toContain("packages/beta/src/broken.ts");
  });

  // ── Ratchet, fail-loud in both directions ─────────────────────────────────

  it("EL6 FAILS (exit 1) when an already-baselined pair GROWS — a swap must not be absorbed", () => {
    write("eslint.config.mjs", eslintConfig);
    write("tsconfig.eslint.json", tsProject(["node_modules"]));
    write(
      "packages/alpha/src/a.ts",
      'console.log("one");\nconsole.log("two");\n',
    );
    write(
      "scripts/eslint-debt.baseline.json",
      baseline(
        ["alpha"],
        [{ file: "packages/alpha/src/a.ts", rule: "no-console", count: 1 }],
      ),
    );

    const r = runGuard();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("GREW");
    expect(r.stderr).toContain("no-console: 1 → 2");
  });

  it("EL7 FAILS (exit 1) when a baselined pair no longer occurs — a baseline nobody prunes is licence", () => {
    seedTwoCleanPackages();
    write(
      "scripts/eslint-debt.baseline.json",
      baseline(
        ["alpha", "beta"],
        [{ file: "packages/alpha/src/a.ts", rule: "no-console", count: 1 }],
      ),
    );

    const r = runGuard();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("baseline is STALE");
    expect(r.stderr).toContain("gone:   packages/alpha/src/a.ts — no-console");
  });

  // ── fa5251f8's intent, now carried by the mechanism ───────────────────────

  it("EL8 PASSES on warnings alone — fa5251f8 asked for exactly this, and now the mechanism says it", () => {
    seedTwoCleanPackages();
    write("packages/beta/src/b.ts", "export function f() { debugger; }\n");

    const r = runGuard();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("warning(s) (reported, not gated)");
    expect(r.stdout).toMatch(/1 warning\(s\)/);
  });

  // ── Population floor ──────────────────────────────────────────────────────

  it("EL9 is NOT JUDGED (exit 2) when an in-scope package lints ZERO files", () => {
    write("eslint.config.mjs", eslintConfig);
    write("tsconfig.eslint.json", tsProject(["node_modules"]));
    write("packages/alpha/src/a.ts", "export const a = 1;\n");
    // src/ exists but holds nothing lintable — paths visited is not content judged.
    mkdirSync(path.join(fixtureRoot, "packages/beta/src"), { recursive: true });
    write("packages/beta/src/README.md", "not a ts file\n");
    write("scripts/eslint-debt.baseline.json", baseline(["alpha", "beta"], []));

    const r = runGuard();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("linted ZERO files");
    expect(r.stderr).toContain("beta");
  });

  it("EL10 is NOT JUDGED (exit 2) when the baseline is missing or unparseable", () => {
    write("eslint.config.mjs", eslintConfig);
    write("tsconfig.eslint.json", tsProject(["node_modules"]));
    write("packages/alpha/src/a.ts", "export const a = 1;\n");
    write("scripts/eslint-debt.baseline.json", "{ not json\n");

    const r = runGuard();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("cannot read");
  });

  // ── The author-facing half ────────────────────────────────────────────────

  it("EL11 --report prints the findings and exits 0 — the advisory reading, never a gate", () => {
    seedTwoCleanPackages();
    write("packages/beta/src/b.ts", 'console.log("debt");\n');

    const r = runGuard("--report");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no-console");
    expect(r.stdout).toContain("1 error(s)");
  });
});
