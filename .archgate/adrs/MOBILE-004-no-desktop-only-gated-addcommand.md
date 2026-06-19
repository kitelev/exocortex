---
id: MOBILE-004
title: No desktop-only-gated addCommand registration
domain: frontend
rules: true
files:
  [
    "packages/obsidian-plugin/src/**/*.ts",
    "packages/obsidian-plugin/src/**/*.tsx",
  ]
---

# No Desktop-Only-Gated `addCommand` Registration

## Context

The **Desktop↔Mobile Command Parity** invariant (Developer/CLAUDE.md, user
directive 2026-06-14): _EVERY plugin command must work on BOTH desktop and
iPhone/mobile._ A command whose `addCommand(...)` is reachable only when the
platform is NOT mobile — a desktop-only gate — is a **parity violation**:
mobile users can never invoke it.

On mobile there is no Node `fs` / git binary, so the correct shape routes the
command's heavy work through the cross-platform `vault.adapter` / REST path
(`RestAssetSpaceMount`, RFC `01a83de8`; first applied in #3535) and registers
the command **unconditionally** — or on a condition that ALSO admits a positive
mobile branch.

This sits alongside the mobile-load cluster — #3464 module-eval imports
(MOBILE-001), #3469 runtime `process` access (MOBILE-002), #3486 runtime
`Buffer` access (MOBILE-003) — but covers a distinct failure mode: the bundle
loads fine and the command is simply **absent** from the mobile palette. It is
a preventive guard for RFC 0002 §3.9 (P14, mobile onboarding parity): the
onboarding panel + `Setup` command and the Bootstrap / Add / Apply / Sync
commands already register on both platforms; this rule keeps future commands
from silently regressing the invariant.

## Decision

- An `addCommand(...)` registration that is lexically gated **desktop-only** is
  FORBIDDEN in `packages/obsidian-plugin/src/**`. Canonical anti-patterns:

  ```ts
  if (!Platform.isMobile) { this.addCommand({...}); }   // block guard
  if (Platform.isDesktopApp) plugin.addCommand({...});  // single-statement
  ```

- The **parity pattern** is explicitly allowed — its condition admits a
  positive (non-negated) mobile branch, so the command registers on desktop OR
  mobile:

  ```ts
  if (applyDeps !== null || (Platform.isMobile && restMount !== null)) {
    this.addCommand({...});
  }
  ```

- A genuinely desktop-only capability with no mobile analogue must still
  register the command on both platforms and surface a clear "not available on
  mobile" notice from the callback — never gate the registration away.

## Detection

Implemented in `.archgate/lint/desktopOnlyCommandGate.ts`, shared verbatim with
the jest revert-verify test
`packages/obsidian-plugin/tests/unit/desktopOnlyCommandGate.test.ts` (no drift
between the gate and its test). Line/brace based, with the same documented
heuristic trade-offs as MOBILE-001/002/003. Caught forms: a same-line braced
block (`if (!Platform.isMobile) { addCommand(...) }`), an Allman-brace block,
a brace-less single statement, and a same-line single statement.

Defense-in-depth for the **likeliest** regression (literally wrapping
`addCommand` in an `if (!Platform.isMobile)`). These desktop-only-gating shapes
are NOT caught (honest false-negative boundary):

- **data-flow gating** — `const deps = Platform.isMobile ? null : build();` then
  `if (deps !== null) addCommand(...)` (no lexical Platform guard around the
  registration);
- **early-return guard** — `if (Platform.isMobile) return;` before `addCommand`;
- **else-branch** — `if (Platform.isMobile) {...} else { addCommand(...) }`;
- a **multi-line** `if (...)` condition (parens not balanced on one line);
- braces inside string/regex literals can desync the depth counter.

Scope is `packages/obsidian-plugin/src` — the only place a `Plugin` instance
(and thus `Plugin.addCommand`) exists.
