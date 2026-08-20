---
id: CI-001
title: A version pinned in two places must not drift between manifest and CI environment
domain: ci
rules: true
files: ["package.json", ".github/workflows/*.yml"]
---

# Manifest ↔ Environment Version Parity

## Context

Some versions are declared **twice**: once in a manifest (`package.json`) and
once in the description of the environment (a container tag, `node-version:`).
Dependabot reads manifests. It does not read the environment, because the
environment is written inline in a workflow — so a bump lands on one side and
the two drift, with nothing in the repo comparing them.

Measured twice within one hour on 2026-08-20, and the two failure shapes are
**opposite**:

| pair | manifest | environment | symptom |
| --- | --- | --- | --- |
| Playwright | `@playwright/test` 1.57 → 1.62 (#4163) | `container: mcr.microsoft.com/playwright:v1.57.0-jammy` — **3** occurrences in `ci.yml` | `test-component`: **322 failed**, every one `Executable doesn't exist at /ms-playwright/chromium_headless_shell-1234/…` |
| Node | `@types/node` 20 → 26 (#4147) | `node-version: "22"` (8 workflows), one on 20 | **nothing** — CI is green, because it compiles rather than runs |

The Node row is the reason this ADR exists. A green CI is not evidence for that
pair and structurally cannot be: `tsc` accepts an API the runtime lacks, and the
`ReferenceError` waits for the first caller. Demonstrated on the real
`packages/core/tsconfig.json` (`lib: ["ES2020","ES2022"]`, **no DOM**, so the
global can only come from `@types/node`):

| types | `new URLPattern({ pathname: "/x" })` — a Node-24 global |
| --- | --- |
| `@types/node@22.20.1` | 1 error |
| `@types/node@26.2.0` | **0 errors** |

## Decision

Compare the two declarations mechanically. The predicates are **not symmetric**,
and the asymmetry is measured rather than stylistic:

- **Playwright — exact equality.** The browsers ship in the image; the harness
  asks for the revision its npm version expects.
- **Node — types major ≤ MINIMUM `node-version`.** Types describing *less* than
  the runtime is safe (you cannot type an API you do not have); describing
  *more* is the hole. Minimum, not maximum, because the oldest workflow is where
  the code breaks first.

## Consequences

- A partial bump now fails `archgate` instead of failing a browser job with 322
  identical errors, or not failing at all.
- `.github/dependabot.yml` carries an `ignore` for `@types/node` majors with the
  lifting condition written next to it. That comment is a **signature, not a
  gate** — this rule is the gate.
- ⚠ Counting matters: the Playwright tag has three occurrences in `ci.yml`, and
  a first pass read "two" from a `grep … | head -20`. The rule reports **every**
  occurrence rather than the first.

## Alternatives considered

- **A milder Playwright predicate (major.minor).** Rejected: `main` carried
  `^1.56.1` against a `v1.57.0` image and was green, so *some* skew is tolerated
  — but the tolerated width is undocumented upstream, and "it happened to work
  at one minor" is not a contract. Equality is the only line that does not
  require guessing where tolerance ends.
- **Leaving it to the `dependabot.yml` comment.** Rejected: a comment does not
  turn red.
