import { defineConfig } from "@playwright/test";

/**
 * Dedicated Playwright config for the EKA GUI-BDD suite (node a2e20c69 Ф4).
 *
 * DELIBERATELY isolated from the required-CI e2e suite, like its sibling
 * `playwright-eka-obsidian-leg.config.ts`:
 *   - `testDir: ./tests/e2e/eka-gui` — OUTSIDE `tests/e2e/specs`, so the 6
 *     sharded `playwright.shard-N.config.ts` runs and `validate-shard-
 *     assignments.mjs` never see it. NOT one of the 13 required checks → cannot
 *     flake them.
 *   - Unlike eka-obsidian-leg, this suite clones only PUBLIC `kitelev/exoas-*`
 *     repos, so it needs NO PAT and never self-skips — it runs on every
 *     push-to-main / nightly as the "авто на каждом релизе" release-gate.
 *
 * `workers: 1` is mandatory: ObsidianLauncher pins CDP port 9222, so concurrent
 * launches would collide. Generous timeout: a multi-repo clone + cold Obsidian
 * boot (×relaunch-retry under QEMU-emulated amd64) plus six create flows.
 */
export default defineConfig({
  testDir: "./tests/e2e/eka-gui",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 1_800_000,
  expect: {
    timeout: 60_000,
  },
  // `list` for the human log + the req-evidence reporter (al-gui-ci-runner): it
  // writes test-results-eka-gui/req-evidence.json mapping each `@req:<uid>`
  // scenario → result — the machine-readable AUTOMATED ui-acceptance evidence
  // (uploaded as the eka-gui-req-evidence CI artifact, retained on success too).
  reporter: [["list"], ["./tests/e2e/eka-gui/req-evidence-reporter.ts"]],
  outputDir: "test-results-eka-gui",
  use: {
    trace: "retain-on-failure",
    // `on` (not only-on-failure): capture a per-scenario DOM screenshot on EVERY
    // run so a PASSING acceptance leaves a durable visual evidence trail (the
    // auto-produced ui-acceptance evidence), alongside the req-evidence manifest.
    screenshot: "on",
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
