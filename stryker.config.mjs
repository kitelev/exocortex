/**
 * @type {import('@stryker-mutator/api').PartialStrykerOptions}
 *
 * Stryker mutation-testing config — packages/core (deterministic engine, CommonJS jest).
 *
 * Mutation testing modifies source ("mutants") and checks whether a test fails
 * ("kills" the mutant). A surviving mutant is a test gap the manual per-fix
 * revert-verify discipline cannot find systemically — it proves WHERE the suite
 * is theater. Mutation score = (killed + timeout) / (killed + timeout +
 * survived + no-coverage).
 *
 * Test-quality improvement-plan 2026-06-22 (P4). This runs in the NIGHTLY cron
 * workflow only (.github/workflows/mutation-nightly.yml) — a full Stryker run is
 * far too slow for the required PR path (decision Q2: core+cli, nightly, NOT
 * PR-gating). `scripts/check-mutation-score.mjs` reads the JSON report and
 * fails when the score drops below the honest break-budget in
 * scripts/mutation-budget.json (`core`).
 *
 * The score-gate is the script (not Stryker's own `break`) so the workflow can
 * always emit the job-summary observability even on a below-budget run.
 *
 * Speed: `enableFindRelatedTests` + `coverageAnalysis: perTest` run only the
 * covering tests per mutant; `incremental` reuses prior results across nightly
 * runs (the workflow persists the incremental file via actions/cache), so only
 * changed files are re-mutated after the first (slow) baseline run.
 *
 * @see https://stryker-mutator.io/docs/stryker-js/configuration/
 */
export default {
  packageManager: "npm",
  reporters: ["html", "clear-text", "progress", "json"],
  testRunner: "jest",

  jest: {
    projectType: "custom",
    config: {
      preset: "ts-jest",
      testEnvironment: "node",
      rootDir: "packages/core",
      roots: ["<rootDir>/tests"],
      testMatch: ["**/?(*.)+(spec|test).ts"],
      // Performance micro-benchmarks assert wall-clock time — flaky under
      // mutation instrumentation + irrelevant to mutation score. Excluded.
      testPathIgnorePatterns: ["/node_modules/", "/tests/performance/"],
      setupFiles: ["reflect-metadata"],
      transformIgnorePatterns: ["node_modules/(?!(uuid)/)"],
      transform: {
        // isolatedModules: mutated source may not type-check; skip the check so
        // the mutant is run, not rejected by tsc (Stryker measures behaviour).
        "^.+\\.ts$": ["ts-jest", { isolatedModules: true }],
        "^.+\\.(js|mjs)$": "babel-jest",
      },
      forceExit: true,
      testTimeout: 60000,
    },
    enableFindRelatedTests: true,
  },

  // Type-checking mutants is disabled (isolatedModules above) — a typescript
  // checker would reject mutants on pre-existing test-file type quirks.
  checkers: [],

  coverageAnalysis: "perTest",
  timeoutMS: 60000,
  timeoutFactor: 2.5,
  // GH ubuntu-latest = 4 cores; leave one for the orchestrator process.
  concurrency: process.env.CI ? 3 : 4,

  // In-place mode avoids the sandbox-copy cost + monorepo path-resolution issues
  // (Stryker backs up originals and restores them after the run).
  inPlace: true,

  // Incremental: reuse prior mutant results; only re-mutate changed files. The
  // nightly workflow persists this file via actions/cache so the first run is
  // the slow full baseline and subsequent runs are fast.
  incremental: true,
  incrementalFile: "reports/mutation/incremental-core.json",

  mutate: [
    "packages/core/src/**/*.ts",
    "!packages/core/src/**/*.d.ts",
    "!packages/core/src/**/index.ts",
    "!packages/core/src/**/*.test.ts",
  ],

  ignorePatterns: [
    "node_modules",
    "dist",
    "reports",
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/tests/**",
    "*.d.ts",
    ".stryker-tmp",
  ],

  // Stryker never self-fails — scripts/check-mutation-score.mjs is the gate, so
  // the workflow always reaches the job-summary step. high/low colour the report.
  thresholds: { high: 80, low: 60, break: null },

  jsonReporter: { fileName: "reports/mutation/mutation-core.json" },
  htmlReporter: { fileName: "reports/mutation/mutation-core.html" },
  tempDirName: ".stryker-tmp",
  logLevel: process.env.CI ? "info" : "debug",
};
