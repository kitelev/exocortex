---
id: MOBILE-002
title: No unguarded process global access in core/plugin src
domain: frontend
rules: true
files:
  [
    "packages/exocortex/src/**/*.ts",
    "packages/exocortex/src/**/*.tsx",
    "packages/obsidian-plugin/src/**/*.ts",
    "packages/obsidian-plugin/src/**/*.tsx",
  ]
---

# No Unguarded `process` Global Access in Core/Plugin Src

## Context

iOS WebKit has no Node `process` global. MOBILE-001 protects **module-eval**
time (top-level Node builtin imports crash plugin load), but a bare runtime
reference to `process` inside a method body is a separate failure layer: the
plugin loads fine, then the first call into the offending path throws
`ReferenceError: Can't find variable: process`.

This exact regression shipped as Issue #3469 (v16.80.1): the lazy-loader path
`ensureLoadedByIRI` → `NoteToRDFConverter` convert read
`process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES` unguarded, so converting any
asset on iOS failed and **no command buttons rendered** — even though the
plugin loaded. `process.env?.X` optional chaining does NOT help: it guards
`.env` being undefined, not the unresolved `process` identifier itself.

Third layer of the mobile cluster: #3464 fixed module-eval imports
(MOBILE-001), #3468 fixed Notice spam, #3469 is runtime global access (this
rule).

## Decision

- Live member access to the `process` global (`process.env`, `process.exit`,
  `process.once`, ...) is FORBIDDEN in `packages/exocortex/src/**` and
  `packages/obsidian-plugin/src/**` unless the SAME line contains a
  `typeof process` guard. The sanctioned idiom is the one-line alias:

  ```ts
  const env = typeof process !== "undefined" ? process.env : undefined;
  const raw = env?.MY_VAR;
  ```

- `process.env.NODE_ENV` is EXEMPT — `esbuild.config.mjs` `define` blocks
  substitute it with a string literal at build time (verified in both prod
  and dev configs), so the bundle never dereferences the real global.
- Comment lines and non-global usages (`vault.process(...)`) are ignored.
- Desktop-/Node-only files (e.g. `ValidatorDaemon.ts`) get NO file-level
  allowlist: they are bundled into the plugin transitively, so they follow
  the same same-line guard idiom. Behavior on Node is unchanged (the guard
  is always true there).

## Consequences

- Mobile runtime paths can never again be broken by a stray `process.*`
  read: archgate (required CI check) fails the PR.
- Env-flag escape hatches keep working on desktop/CLI and silently behave
  as "unset" on mobile — the correct degradation for opt-in flags.
- Block-style guards on separate lines are flagged by the line-based
  heuristic; code must use the same-line alias form. This is a deliberate
  precision/complexity trade-off (same as MOBILE-001's line heuristics).

## Verification

Empirically verified 2026-06-11 (Issue #3469 TDD protocol): rule run against
the pre-fix tree reports all 7 unguarded accesses
(`NoteToRDFConverter.ts:1217`, `PropertyPathExecutor.ts:530`,
`ValidatorDaemon.ts:25/71/72/88`, `GitSubmoduleOps.ts:589`) — revert→fail;
the guarded forms are green — restore→pass. Companion unit specs
(`NoteToRDFConverter.no-process-env.test.ts`,
`PropertyPathExecutor.no-process-env.test.ts`) delete `globalThis.process`
and exercise the exact convert/strict-mode paths.
