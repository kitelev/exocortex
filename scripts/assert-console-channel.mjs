#!/usr/bin/env node
/**
 * assert-console-channel.mjs — Issue #3479 release-gate.
 *
 * Asserts the built plugin bundle (main.js) retains console.* call sites for
 * every Logger level (debug/info/warn/error). The Logger console channel is a
 * settings-facing feature (logChannels.<level>.console toggles, default true),
 * but esbuild `drop: ["console"]` + `pure: ["console.log", "console.debug",
 * "console.info"]` used to strip every console call from release builds,
 * silently turning the channel into a no-op (verified on v16.81.1 main.js:
 * 0 occurrences of console.warn while ~100 [ExoSync] WARN events flooded
 * Notices and the file log).
 *
 * Checking all four methods guards both regression vectors independently:
 * `drop: ["console"]` strips everything; a re-introduced console `pure`-list
 * tree-shakes debug/info under minify even without `drop`.
 *
 * Wired into the root `build` script (after assert-mobile-loadable), so every
 * production build — incl. the Auto Release artifact — is gated against the
 * strip being silently re-introduced. Companion config-level PR-time gate:
 * packages/obsidian-plugin/tests/unit/build/esbuild-console-channel.test.ts
 *
 * Usage: node scripts/assert-console-channel.mjs [path/to/main.js]
 */
import { readFileSync } from "node:fs";

const bundlePath = process.argv[2] ?? "packages/obsidian-plugin/main.js";

let code;
try {
  code = readFileSync(bundlePath, "utf8");
} catch (err) {
  console.error(
    `❌ [console-channel] cannot read bundle ${bundlePath}: ${err.message}`,
  );
  process.exit(1);
}

const requiredCallSites = [
  "console.debug",
  "console.info",
  "console.warn",
  "console.error",
];
const missing = requiredCallSites.filter((site) => !code.includes(site));

if (missing.length > 0) {
  console.error(
    `❌ [console-channel] bundle ${bundlePath} is missing call sites: ${missing.join(", ")}.\n` +
      `   The Logger console channel (settings logChannels.<level>.console) is a\n` +
      `   no-op in this build — DevTools console receives nothing while Notices\n` +
      `   and the file log still flood (Issue #3479 regression class).\n` +
      `   Likely cause: drop:["console"] or a console pure-list re-introduced in\n` +
      `   packages/obsidian-plugin/esbuild.config.mjs.`,
  );
  process.exit(1);
}

const counts = requiredCallSites
  .map((site) => `${site} ×${code.split(site).length - 1}`)
  .join(", ");
console.log(
  `✅ [console-channel] ${bundlePath} retains console call sites (${counts}). ` +
    `Logger console channel live in release build.`,
);
