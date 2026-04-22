import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/specs",
  // fullyParallel: false - E2E tests share Obsidian state, must run serially per shard
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // D2 (2026-04-22): retries: 0 — the only recurring flake was a deterministic
  // race in starter-kit-smoke.spec.ts (expandGroupIfCollapsed silent-return on
  // un-hydrated Maintenance group after Project→Task class switch); fixed in
  // the same PR. Post-fix, all tests pass attempt-1 — no retry safety net
  // needed. Flaky failures now surface immediately instead of being masked.
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

  projects: [
    {
      name: "e2e",
      testMatch: "**/*.spec.ts",
    },
  ],
});
