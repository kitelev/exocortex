---
id: MOBILE-001
title: No top-level Node builtin imports in plugin src
domain: frontend
rules: true
files:
  [
    "packages/obsidian-plugin/src/**/*.ts",
    "packages/obsidian-plugin/src/**/*.tsx",
  ]
---

# No Top-Level Node Builtin Imports in Plugin Src

## Context

The Obsidian plugin targets mobile (`manifest.json` sets `isDesktopOnly: false`).
Obsidian mobile (iOS/Android) runs the plugin in a WebView **without a Node.js
runtime**. The plugin bundle is CJS with Node builtins marked external in
`esbuild.config.mjs`, so a top-level `import { x } from "node:fs"` compiles to a
**module-eval-level** `require("node:fs")` in `main.js`. On mobile that require
throws while the bundle is being evaluated and the WHOLE plugin fails to load
(«Failed to load plugin») — regardless of any `Platform.isMobile` guards inside
methods, because the import executes before any method runs.

This exact regression shipped in v16.51.0 (`GitSubmoduleOps.ts`, PR #3337) and
broke plugin load on iOS for ~30 releases unnoticed (Issue #3464). An ESLint
rule (`no-restricted-imports`) banning these imports already existed, but the
offending files bypassed it with `/* eslint-disable */` comments. This archgate
rule does NOT honour eslint-disable comments — it closes that bypass.

## Decision

- Top-level **value** imports of Node builtins (`node:*` prefix or bare
  `fs`/`path`/`os`/`child_process`/...) are FORBIDDEN in
  `packages/obsidian-plugin/src/**`.
- `import type ... from "node:*"` and `typeof import("node:*")` are ALLOWED —
  they are erased at compile time and never reach the bundle.
- Desktop-only code MUST access Node builtins lazily via
  `src/infrastructure/adapters/lazyNodeModules.ts` (`require` inside a
  function body, executed only behind a `Platform.isMobile` guard).
- The release build additionally runs `scripts/assert-mobile-loadable.mjs`,
  which module-evals the built `main.js` with a require-shim that throws on
  Node builtins — proving the bundle loads without Node.

## Consequences

- Mobile plugin load can never again be broken by a stray top-level Node
  import: archgate (required CI check) fails the PR.
- Desktop-only adapters pay one extra function call per Node module access
  (lazy `require` is cached by the CJS module cache — negligible).

## Verification

Empirically verified 2026-06-10: reverting one adapter to a top-level
`import { promises as fs } from "node:fs"` turns archgate red
(revert→fail); the lazy-require form is green (restore→pass).
