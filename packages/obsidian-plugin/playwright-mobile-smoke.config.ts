import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile-load smoke config (Issue #3464).
 *
 * Runs the built plugin bundle through module-eval inside a REAL WebKit
 * engine with iPhone emulation — the same JavaScript engine family as
 * Obsidian iOS (WKWebView). Obsidian's closed-source iOS app cannot run in
 * CI, so this is the closest faithful reproduction of the iPhone load path:
 * WebKit + no Node runtime + a `require` shim that throws on Node builtins.
 *
 * Catches the v16.51.0 regression class: a top-level `import ... from
 * "node:*"` in plugin src compiles to a module-eval-level require that
 * crashes plugin load on iOS before any Platform.isMobile guard runs.
 *
 * CI: dedicated step in the `test-component` job (bundle is built there via
 * setup-node-pnpm run-build). Locally: `npm run build` first, then
 * `npx playwright test -c packages/obsidian-plugin/playwright-mobile-smoke.config.ts`.
 */
export default defineConfig({
  testDir: "./tests/mobile-smoke",
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  projects: [
    {
      name: "ios-webkit",
      use: {
        ...devices["iPhone 14"],
        browserName: "webkit",
      },
    },
  ],
});
