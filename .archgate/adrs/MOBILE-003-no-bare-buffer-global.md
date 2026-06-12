---
id: MOBILE-003
title: No bare Buffer global references in core src
domain: frontend
rules: true
files:
  [
    "packages/exocortex/src/**/*.ts",
    "packages/exocortex/src/**/*.tsx",
    "packages/services/src/**/*.ts",
    "packages/services/src/**/*.tsx",
  ]
---

# No Bare `Buffer` Global References in Core Src

## Context

iOS WebKit has no Node `Buffer` global. MOBILE-001 bans module-eval Node
builtin imports and MOBILE-002 bans unguarded `process` access — but a bare
`Buffer` reference inside a method body slipped past both gates (it is
neither an import nor `process`). The plugin loads fine, then the first call
into the offending path throws `ReferenceError: Can't find variable: Buffer`.

This exact regression shipped as Issue #3486 (observed on v16.81.6): the
base64 blob decode in `githubRepoReader` (`getBlobText` / `getBlobBytes`)
went hot on every sync cycle with v16.81.x (#3478 examined-head tree GET +
#3476 base-tree reads), so the ENTIRE mobile ExoSync leg broke — 6/14 repos
errored, pushed 0 pulled 0. Five more bare `Buffer` call sites existed in
the same package (`SyncEngine`, `SyncedQuarantineStore`, `CommandResolver`,
`GroundingExecutor`).

Fourth layer of the mobile cluster: #3464 module-eval imports (MOBILE-001),
#3469 runtime `process` access (MOBILE-002), #3486 runtime `Buffer` access
(this rule).

## Decision

- Bare `Buffer` references — value OR type position — are FORBIDDEN in
  `packages/exocortex/src/**` and `packages/services/src/**` (both bundled
  into the plugin transitively, so both are mobile-reachable). Type
  positions are banned too: they cost nothing today (zero occurrences) and
  a `: Buffer` type in a platform-neutral package is a leaked Node contract
  that invites the next value usage.
- All base64 ⇄ bytes/UTF-8 conversion goes through the platform-neutral
  helpers in `packages/exocortex/src/utilities/base64.ts` (`bytesToBase64`,
  `base64ToBytes`, `base64ToUtf8`, `utf8ToBase64`) — built on `atob`/`btoa`
  plus `TextEncoder`/`TextDecoder`, available in both Obsidian webviews and
  Node ≥16.
- `packages/obsidian-plugin/src/**` is NOT scanned: it retains legitimate
  desktop-only `Buffer` usage behind the lazy-node-modules boundary
  (`GitSubmoduleOps` exec contract types, `SwitchCacheLayer` tar cache),
  where MOBILE-001 already fences module-eval safety.
- Property accesses (`vault.Buffer`), longer identifiers
  (`fetchTarballBuffer`, `BufferSource`, `ArrayBuffer`) and comment lines
  are ignored.
- Tests are NOT scanned — jest runs in Node, where `Buffer` is the natural
  oracle for output-equivalence assertions.

## Consequences

- The mobile sync path can never again be broken by a stray `Buffer`
  reference in core src: archgate (required CI check) fails the PR.
- Known line-heuristic limitations (same trade-off as MOBILE-001/002):
  string literals containing the word `Buffer` would be flagged (none exist
  in scope); mid-line block comments (`/* Buffer */ code`) are not
  stripped. Acceptable precision/complexity balance.

## Verification

Empirically verified 2026-06-12 (Issue #3486 TDD protocol): rule run
against the pre-fix tree reports all 6 bare references
(`githubRepoReader.ts:152/181`, `SyncEngine.ts:176`,
`SyncedQuarantineStore.ts:220`, `CommandResolver.ts:119`,
`GroundingExecutor.ts:1164`) — revert→fail; the helper-based forms are
green — restore→pass. Companion unit specs
(`tests/utilities/base64.test.ts`,
`tests/unit/services/sync/githubRepoReader.no-buffer.test.ts`) delete
`globalThis.Buffer` and exercise the helpers plus the exact production
blob-decode path.
