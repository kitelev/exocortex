import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the desktop smoke matrix (macOS + Windows).
 * Driven by `.github/workflows/e2e-desktop.yml`.
 *
 * Distinct from `playwright-e2e.config.ts` (Docker/Linux full E2E) — kept
 * separate so changes here cannot regress the existing 4-shard CI suite.
 */
export default defineConfig({
  testDir: "./tests/e2e-desktop/specs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  reporter: [
    ["list"],
    [
      "html",
      { outputFolder: "playwright-report-e2e-desktop", open: "never" },
    ],
    ...(process.env.CI ? ([["github", {}] as ["github", {}]]) : []),
  ],
  outputDir: "test-results-e2e-desktop",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-smoke",
      testMatch: "**/*.smoke.spec.ts",
    },
  ],
});
