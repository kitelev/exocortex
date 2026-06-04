import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/specs",
  // fullyParallel: false - E2E tests share Obsidian state, must run serially per shard
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // retries: 0 — surface flakes immediately rather than masking with retries.
  retries: 0,
  workers: 1,
  // Reduced timeout from 90s to 60s - most tests complete in 30-45s
  timeout: 60000,
  // Expect timeout reduced to 30s (was using global default)
  expect: {
    timeout: 30000,
  },

  reporter: [
    // Use blob reporter in CI for shard merging
    ...(process.env.CI
      ? ([["blob", { outputDir: "blob-report" }]] as const)
      : []),
    ["html", { outputFolder: "playwright-report-e2e", open: "never" }],
    ["list"],
    ...(process.env.CI ? [["github", {}] as ["github", {}]] : []),
    ["./playwright-no-flaky-reporter.ts"],
    // RFC Phase 3 / T2.2 — surface per-shard retry counts to the GitHub
    // Actions job summary so retries are visible at PR-check level instead
    // of buried in raw logs. Pure observability; never fails the run.
    [
      "./playwright-retry-summary-reporter.ts",
      { outputDir: "test-results" },
    ],
    // RFC 3cc77ba2 Phase 2.2 step 1 — data-flake detector (Category F).
    // Warn-only: snapshots tests/e2e/test-vault/ before/after each test and writes
    // test-results/fixture-drift.json for CI artifact pickup. Never fails the run.
    ["./tests/e2e/reporters/fixture-drift-reporter.ts"],
  ],

  // Output directory for test artifacts (videos, screenshots, traces)
  outputDir: "test-results",

  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Enable video recording for failures to aid debugging in CI
    video: "retain-on-failure",
    launchOptions: {
      args: [
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--log-level=3",
      ],
      env: {
        DBUS_SESSION_BUS_ADDRESS: "/dev/null",
      },
    },
  },

  // Issue #3350: structured tolerance for @flaky-track-tagged specs.
  // Two projects route by tag presence — default (untagged) keeps the
  // strict 0-retry contract that surfaces flakes immediately; flaky-track
  // gets retries: 1 as documented opt-in tolerance until root-cause lands.
  // Removing the tag automatically restores strict discipline (no silent
  // masking). Reporter `playwright-no-flaky-reporter` is tag-aware and
  // skips @flaky-track tests so the retry on that project does not fail CI.
  projects: [
    {
      name: "e2e",
      testMatch: "**/*.spec.ts",
      grepInvert: /@flaky-track/,
    },
    {
      name: "e2e-flaky-track",
      testMatch: "**/*.spec.ts",
      grep: /@flaky-track/,
      retries: 1,
    },
  ],
});
