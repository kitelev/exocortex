/**
 * Lazy accessors for `node:*` builtins (Issue #3464).
 *
 * ⛔ NEVER import `node:*` (or bare `fs`/`path`/`os`/...) at TOP LEVEL in
 * plugin src. The plugin bundle is CJS with Node builtins marked external —
 * a top-level `import { x } from "node:fs"` compiles to a module-eval-level
 * `require("node:fs")` in `main.js`. Obsidian mobile (iOS/Android WebView)
 * has no Node runtime: that require throws WHILE the bundle is being
 * evaluated and the whole plugin fails to load («Failed to load plugin»),
 * regardless of any `Platform.isMobile` guards inside methods. This is
 * exactly the v16.51.0 mobile regression (Issue #3464).
 *
 * These helpers defer the `require` to the first CALL — desktop-only
 * adapters invoke them inside methods that are already mobile-guarded
 * (`Platform.isMobile` throw / early return), so mobile never executes the
 * require. `import type ... from "node:*"` and `typeof import("node:*")`
 * remain allowed everywhere — they are erased at compile time.
 *
 * Enforcement: archgate MOBILE-001 bans top-level node:* value imports in
 * plugin src; `scripts/assert-mobile-loadable.mjs` proves the built bundle
 * module-evals without Node (runs in the release build).
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/no-nodejs-modules --
   this file is the SINGLE sanctioned location for lazy node:* requires (see
   doc above). The requires here live inside function bodies — they never run
   at module-eval, so the bundle stays mobile-loadable. archgate MOBILE-001 +
   scripts/assert-mobile-loadable.mjs enforce that invariant mechanically. */

export function nodeChildProcess(): typeof import("node:child_process") {
  return require("node:child_process");
}

export function nodeUtil(): typeof import("node:util") {
  return require("node:util");
}

export function nodeFs(): typeof import("node:fs") {
  return require("node:fs");
}

export function nodeFsPromises(): (typeof import("node:fs"))["promises"] {
  return nodeFs().promises;
}

export function nodePath(): typeof import("node:path") {
  return require("node:path");
}

export function nodeOs(): typeof import("node:os") {
  return require("node:os");
}

export function nodeCrypto(): typeof import("node:crypto") {
  return require("node:crypto");
}
