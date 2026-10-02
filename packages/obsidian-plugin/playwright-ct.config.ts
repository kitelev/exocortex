import { defineConfig, devices } from "@playwright/experimental-ct-react";
import * as path from "path";

/**
 * Playwright Component Testing Configuration
 *
 * Tests React components in isolation without requiring full Obsidian environment
 *
 * Visual Regression Testing:
 * - Snapshots stored in tests/component/__snapshots__/
 * - Run `npx playwright test --update-snapshots` to update baselines
 * - Threshold: 0.2 (20% pixel difference allowed for anti-aliasing)
 */
export default defineConfig({
  testDir: "./tests/component",

  // Snapshot configuration for visual regression testing
  // Platform-specific snapshots to handle font rendering differences between macOS/Linux
  snapshotDir: "./tests/component/__snapshots__",
  snapshotPathTemplate:
    "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{-platform}{ext}",

  // Run tests in parallel
  fullyParallel: true,

  // Issue #4512 — there is deliberately NO `testIgnore` here.
  //
  // It used to carry `testIgnore: process.env.CI ? ["**/visual/**"] : []`, which dropped the
  // `tests/component/visual/` SUBDIRECTORY from CI: 3 specs, 40 tests, measured as zero
  // occurrences of that path in the job log. The pattern matches a path SEGMENT, so the
  // top-level `tests/component/*.visual.spec.tsx` were never affected — two filters, two
  // different subjects (#4506 was the verdict half, this was the input half).
  //
  // Its own stated condition was "until Linux snapshots are generated". That is now
  // satisfied for every executing visual spec: #4510 committed the top-level baselines,
  // this change committed the rest. So the hedge is removed WITH the filter rather than
  // left standing — a hedge that outlives its subject makes every later reader pay a probe
  // (migration-pre-verify-use-case §A6).
  //
  // ⛔ Reinstating any `testIgnore` that excludes `visual/` is guarded by
  // `tests/unit/build/visual-testignore-gate.test.ts`, which reads THIS file through the
  // TypeScript parser — a line-anchored grep would miss a key authored on a continuation
  // line and return a false verdict.

  // Fail CI if you accidentally left test.only
  forbidOnly: !!process.env.CI,

  // Retry failed tests in CI
  retries: process.env.CI ? 2 : 0,

  // Workers for parallel execution
  // ctPort is auto-incremented per-worker (3100, 3101), so 2 workers do not collide
  workers: process.env.CI ? 2 : undefined,

  // Reporter configuration
  reporter: [
    ["html", { outputFolder: "playwright-report-ct", open: "never" }],
    ["list"],
    ...(process.env.CI ? [["github"] as ["github"]] : []),
    // Flaky test reporter - tracks tests that pass after retry
    [
      "./playwright-flaky-reporter.ts",
      {
        outputFile: "flaky-report-playwright.json",
        failOnFlaky: false, // Track but don't fail CI
        verbose: true,
      },
    ],
  ],

  // Timeout configuration
  timeout: 10000, // 10 seconds per test
  expect: {
    timeout: 5000, // 5 seconds for assertions
    // Visual regression testing configuration
    toHaveScreenshot: {
      // Maximum allowed pixel difference ratio (0.2 = 20%)
      maxDiffPixelRatio: 0.2,
      // Animation timing tolerance
      animations: "disabled",
      // Scale for screenshot comparison
      scale: "css",
    },
    toMatchSnapshot: {
      // Maximum allowed pixel difference ratio
      maxDiffPixelRatio: 0.2,
    },
  },

  // Shared settings for all tests
  use: {
    // Capture trace on first retry
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Component testing options
    ctPort: 3100,
    ctViteConfig: {
      resolve: {
        alias: {
          "@kitelev/exocortex-core": path.resolve(
            __dirname,
            "../../packages/core/src",
          ),
          obsidian: path.resolve(__dirname, "./tests/__mocks__/obsidian.ts"),
          "@": path.resolve(__dirname, "./src"),
          "@plugin/types": path.resolve(__dirname, "./src/types/index.ts"),
          "@plugin/adapters": path.resolve(__dirname, "./src/adapters"),
          "@plugin/application": path.resolve(__dirname, "./src/application"),
          "@plugin/domain": path.resolve(__dirname, "./src/domain"),
          "@plugin/infrastructure": path.resolve(__dirname, "./src/infrastructure"),
          "@plugin/presentation": path.resolve(__dirname, "./src/presentation"),
          "@plugin": path.resolve(__dirname, "./src"),
        },
        extensions: [".ts", ".tsx", ".js", ".jsx"],
      },
      define: {
        // Provide jest globals for component tests (some code may reference jest)
        "global.jest": "undefined",
        "window.jest": "undefined",
      },
    },
  },

  // Test projects for different browsers
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Firefox and WebKit disabled by default (install with: npx playwright install firefox webkit)
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
});
