/**
 * @type {import('@stryker-mutator/api').PartialStrykerOptions}
 *
 * Stryker mutation-testing config — packages/cli (ESM jest).
 *
 * Companion to stryker.config.mjs (core). The CLI package is ESM
 * (`"type": "module"`), so its jest runs under `useESM` ts-jest +
 * `--experimental-vm-modules` (set in NODE_OPTIONS by the npm script and the
 * nightly workflow). This config mirrors packages/cli/jest.config.js exactly so
 * the Stryker dry-run reproduces the real CLI test environment (incl. the
 * reflect-metadata setup tsyringe DI requires and the `@kitelev/exocortex-*`
 * source moduleNameMappers).
 *
 * Test-quality improvement-plan 2026-06-22 (P4). Nightly cron only — NOT a
 * required PR check (decision Q2). Gate: scripts/check-mutation-score.mjs
 * against scripts/mutation-budget.json (`cli`).
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
      rootDir: "packages/cli",
      testMatch: ["<rootDir>/tests/**/*.test.ts"],
      setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
      moduleNameMapper: {
        "^@kitelev/exocortex-core$": "<rootDir>/../core/src/index.ts",
        "^@kitelev/exocortex-services$": "<rootDir>/../services/src/index.ts",
        "^(\\.{1,2}/.*)\\.js$": "$1",
      },
      transform: {
        "^.+\\.tsx?$": [
          "ts-jest",
          {
            useESM: true,
            // Mutated source may not type-check; skip the check (Stryker measures
            // behaviour, not types).
            isolatedModules: true,
            tsconfig: {
              module: "ESNext",
              moduleResolution: "node",
              esModuleInterop: true,
            },
          },
        ],
      },
      transformIgnorePatterns: ["node_modules/(?!(uuid)/)"],
      extensionsToTreatAsEsm: [".ts"],
      forceExit: true,
      testTimeout: 60000,
    },
    enableFindRelatedTests: true,
  },

  checkers: [],
  coverageAnalysis: "perTest",
  timeoutMS: 60000,
  timeoutFactor: 2.5,
  concurrency: process.env.CI ? 3 : 4,
  inPlace: true,

  incremental: true,
  incrementalFile: "reports/mutation/incremental-cli.json",

  mutate: [
    "packages/cli/src/**/*.ts",
    "!packages/cli/src/**/*.d.ts",
    "!packages/cli/src/**/index.ts",
    "!packages/cli/src/**/*.test.ts",
    // daily-review.ts is excluded from cli coverage (logic tested via
    // DailyReviewService) — exclude from mutation for the same reason.
    "!packages/cli/src/commands/daily-review.ts",
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

  thresholds: { high: 80, low: 60, break: null },

  jsonReporter: { fileName: "reports/mutation/mutation-cli.json" },
  htmlReporter: { fileName: "reports/mutation/mutation-cli.html" },
  tempDirName: ".stryker-tmp",
  logLevel: process.env.CI ? "info" : "debug",
};
