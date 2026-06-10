#!/usr/bin/env node
/**
 * assert-mobile-loadable.mjs — Issue #3464 release-gate.
 *
 * Module-evals the built plugin bundle (main.js) in a sandbox whose
 * `require` THROWS for every Node builtin (and electron) — simulating
 * Obsidian mobile (iOS/Android WebView, no Node runtime). Only `obsidian`,
 * `@codemirror/*` and `@lezer/*` (the modules Obsidian itself provides on
 * mobile) resolve, to inert Proxy stubs.
 *
 * If module-eval completes and exports a plugin class, the bundle can at
 * least LOAD on mobile. A top-level `require("node:*")` — the v16.51.0
 * regression that broke iOS for ~30 releases — fails this script.
 *
 * Wired into the root `build` script, so every production build (incl. the
 * Auto Release artifact) is gated. Companion PR-time source gate:
 * .archgate/adrs/MOBILE-001-no-toplevel-node-imports.rules.ts
 *
 * Usage: node scripts/assert-mobile-loadable.mjs [path/to/main.js]
 */
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import vm from "node:vm";

const bundlePath = process.argv[2] ?? "packages/obsidian-plugin/main.js";

let code;
try {
  code = readFileSync(bundlePath, "utf8");
} catch (err) {
  console.error(
    `❌ [mobile-loadable] cannot read bundle ${bundlePath}: ${err.message}`,
  );
  process.exit(1);
}

const BUILTIN_SET = new Set(builtinModules);
const interceptedRequires = [];

/**
 * Inert universal stub: callable, constructible, and every property access
 * returns another stub — enough for `class X extends obsidian.Plugin`,
 * top-level destructuring, and decorator references at module-eval time.
 */
function makeStub(name) {
  const fn = function stub() {};
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === "prototype") return target.prototype;
      if (prop === Symbol.toPrimitive) return () => `[stub ${name}]`;
      if (prop === "default") return makeStub(`${name}.default`);
      return makeStub(`${name}.${String(prop)}`);
    },
    construct() {
      return {};
    },
    apply() {
      return makeStub(`${name}()`);
    },
  });
}

function mobileRequire(id) {
  interceptedRequires.push(id);
  if (
    id === "obsidian" ||
    id.startsWith("@codemirror/") ||
    id.startsWith("@lezer/")
  ) {
    return makeStub(id);
  }
  // Everything else is absent on mobile: Node builtins (bare or node:-prefixed),
  // electron, and any other external. Throw exactly like the WebView would.
  const bare = id.startsWith("node:") ? id.slice(5) : id;
  const kind =
    BUILTIN_SET.has(bare) || BUILTIN_SET.has(id)
      ? "Node builtin"
      : "external module";
  const err = new Error(
    `[mobile-sim] Cannot find module '${id}' (${kind} — no Node runtime on Obsidian mobile)`,
  );
  err.code = "MODULE_NOT_FOUND";
  throw err;
}

// Minimal WebView-ish globals. Obsidian mobile runs in a real browser
// context; the bundle's module-eval phase must not need more than this.
const moduleObj = { exports: {} };
const sandbox = {
  module: moduleObj,
  exports: moduleObj.exports,
  require: mobileRequire,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  navigator: { userAgent: "mobile-sim" },
  window: makeStub("window"),
  document: makeStub("document"),
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(code, sandbox, { filename: bundlePath, timeout: 60_000 });
} catch (err) {
  console.error(
    `❌ [mobile-loadable] bundle FAILED module-eval under mobile simulation.\n` +
      `   This is the Issue #3464 regression class: a module-eval-level require of a\n` +
      `   Node builtin (top-level \`import ... from "node:*"\` in plugin src).\n` +
      `   Error: ${err && err.message ? err.message : err}`,
  );
  process.exit(1);
}

const exported =
  moduleObj.exports && (moduleObj.exports.default ?? moduleObj.exports);
if (typeof exported !== "function") {
  console.error(
    `❌ [mobile-loadable] module-eval completed but no plugin class was exported ` +
      `(got ${typeof exported}). Bundle shape unexpected — investigate before release.`,
  );
  process.exit(1);
}

const nodeRequires = interceptedRequires.filter((id) => {
  const bare = id.startsWith("node:") ? id.slice(5) : id;
  return BUILTIN_SET.has(bare) || BUILTIN_SET.has(id);
});
// Defense-in-depth: mobileRequire already throws on builtins, so reaching
// here with nodeRequires non-empty is impossible unless the bundle swallowed
// the throw at module-eval level (try/catch around a top-level require would
// still be a mobile-correctness smell worth failing on).
if (nodeRequires.length > 0) {
  console.error(
    `❌ [mobile-loadable] module-eval ATTEMPTED Node builtin require(s): ${[...new Set(nodeRequires)].join(", ")}\n` +
      `   A top-level try/catch swallowed the throw — plugin load on mobile is still at risk.`,
  );
  process.exit(1);
}

console.log(
  `✅ [mobile-loadable] ${bundlePath} module-evals without Node ` +
    `(${interceptedRequires.length} require(s) intercepted: ${[...new Set(interceptedRequires)].join(", ") || "none"}). ` +
    `Plugin class exported OK.`,
);
