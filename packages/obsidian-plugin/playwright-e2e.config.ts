import { defineConfig } from "@playwright/test";
import * as path from "path";

// Resolve paths relative to this config file's directory
const configDir = path.dirname(__filename);

export default defineConfig({
  testDir: path.join(configDir, "./tests/e2e/specs"),
  // fullyParallel: false - E2E tests share Obsidian state, must run serially per shard
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Reduced retries: 1 instead of 2 to speed up failing tests
  retries: process.env.CI ? 1 : 0,
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
    [
      "html",
      {
        outputFolder: path.join(configDir, "playwright-report-e2e"),
        open: "never",
      },
    ],
    // Custom E2E reporter with improved formatting and hierarchy
    [path.join(configDir, "playwright-e2e-reporter.ts")],
    ...(process.env.CI ? [["github", {}] as ["github", {}]] : []),
    [path.join(configDir, "playwright-no-flaky-reporter.ts")],
  ],

  // Output directory for test artifacts (videos, screenshots, traces)
  outputDir: path.join(configDir, "test-results"),

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
