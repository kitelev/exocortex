import { defineConfig } from "@playwright/test";

/**
 * Dedicated Playwright config for the EKA "Obsidian leg" end-to-end test.
 *
 * This config is DELIBERATELY isolated from the required-CI e2e suite:
 *   - `testDir: ./tests/e2e/eka` — a directory OUTSIDE `tests/e2e/specs`, so the
 *     6 sharded `playwright.shard-N.config.ts` runs and the `validate-shard-
 *     assignments.mjs` drift guard (which scans `tests/e2e/specs` only) never
 *     see this spec. It is therefore NOT one of the 13 required checks and
 *     cannot flake them.
 *   - The spec additionally `test.skip(!process.env.EKA_E2E_PAT, …)` so even a
 *     stray invocation without a PAT is a clean skip, not a failure.
 *
 * The test hits LIVE GitHub (public + private `kitelev/exoas-*` repos) and
 * requires network + a PAT — see the spec header for the full run recipe.
 *
 * Timeout is generous (20 min) because the full alpha path under QEMU-emulated
 * amd64 Docker performs a cold Obsidian boot ×2 plus several tarball pulls and
 * `git submodule add` clones.
 */
export default defineConfig({
  testDir: "./tests/e2e/eka",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // The whole alpha path (bootstrap → add ×2 → relaunch → apply → create)
  // runs as ONE test; 20 min covers two cold Obsidian boots under emulation.
  timeout: 2_700_000,
  expect: {
    timeout: 60_000,
  },
  reporter: [["list"]],
  outputDir: "test-results-eka",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
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
});
