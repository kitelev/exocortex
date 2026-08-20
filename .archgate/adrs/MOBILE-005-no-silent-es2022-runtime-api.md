---
id: MOBILE-005
title: No ES2022 runtime APIs that tsc accepts under target ES2020
domain: frontend
rules: true
files:
  [
    "packages/core/src/**/*.ts",
    "packages/core/src/**/*.tsx",
    "packages/services/src/**/*.ts",
    "packages/services/src/**/*.tsx",
  ]
---

# No Silent ES2022 Runtime APIs in Mobile-Reachable Src

## Context

`packages/core/tsconfig.json` sets `"target": "ES2020"` with
`"lib": ["ES2020", "ES2022"]`. The `lib` entry types APIs the `target` does not
downlevel, so some ES2022 runtime methods **type-check cleanly and ship a
`TypeError`** on any runtime below Safari / iOS 15.4. The plugin builds with
`isDesktopOnly: false`, so that runtime is in the delivery scope.

The concrete trap (Issue #4064): an author "simplifying"

```ts
Object.prototype.hasOwnProperty.call(source, key)  →  Object.hasOwn(source, key)
```

gets a **green build and green CI**. Until this rule, the invariant was defended
by a docstring in `keyPathResolver.ts` and nothing else — five point-fixes of the
surrounding own-property class had already shipped (#4052, #4058, #4060, #4062,
#4063) with the invariants kept in prose only.

Fifth layer of the mobile cluster: #3464 module-eval imports (MOBILE-001),
#3469 runtime `process` access (MOBILE-002), #3486 runtime `Buffer` access
(MOBILE-003), #3535 desktop-only command gating (MOBILE-004), and this rule.

## Decision

The ban covers exactly the APIs **the compiler lets through** — measured, not
assumed. Each candidate was run through `tsc` under both lib settings:

| API | `--lib ES2020` | `--lib ES2020,ES2022` (the repo) | banned |
| --- | --- | --- | --- |
| `Object.hasOwn` | `TS2550` error | **no error** | yes |
| `.at()` | no error | no error | yes |
| `.findLast()` | `TS2550` error | `TS2550` error | **no** |

`findLast` is deliberately EXCLUDED. `tsc` already refuses it under both
settings, so banning it here would duplicate the compiler and imply a coverage
this rule does not provide for the cases `tsc` misses. A guard that restates
what another gate already enforces reads as broader than it is.

Scope: `packages/core/src/**` and `packages/services/src/**` — both are bundled
into the plugin transitively and therefore mobile-reachable.
`packages/obsidian-plugin/src` is NOT scanned, mirroring MOBILE-003: it has
legitimate desktop-only usage behind the lazy-node-modules boundary.

Comments are skipped. Four live mentions of `Object.hasOwn` exist today and all
four are docstrings warning against it — a guard that flagged its own warning
text would be born red and would be silenced rather than obeyed.

## Sanctioned replacements

| banned | use instead |
| --- | --- |
| `Object.hasOwn(o, k)` | `Object.prototype.hasOwnProperty.call(o, k)`, or the `ownProperty` helper in `packages/core/src/domain/display-name/keyPathResolver.ts` |
| `arr.at(-1)` | `arr[arr.length - 1]` |
| `arr.at(i)` / `str.at(i)` | `arr[i]` / `str[i]` |

## Consequences

- A "simplification" to an ES2022 method in mobile-reachable code now fails the
  `archgate` job (a required check) instead of passing CI and breaking on phones.
- The rule does not replace raising the `target`/`lib` question — it makes the
  current pairing safe to keep.
- Heuristics are line-based, same trade-off as MOBILE-001/002/003; the known
  false-negative and false-positive shapes are enumerated in the rules file.
