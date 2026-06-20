---
id: REQ-001
title: Requirements traceability — well-formed @req tags
domain: process
rules: true
files:
  [
    "packages/**/*.test.ts",
    "packages/**/*.test.tsx",
    "packages/**/*.spec.ts",
    "packages/**/*.spec.tsx",
  ]
---

# Requirements traceability — well-formed `@req` tags

## Context

RFC 0003 (requirements management) binds a functional `req__Requirement` vault
asset to an **already-existing real test** by placing a `@req:<uid>` token
inside that test's `it(...)` / `test(...)` title — so the binding travels with
the assertion across refactors. The `exocortex requirements audit` CLI checker
resolves those tags against the requirement graph (orphans / dangling /
duplicates / coverage / binding-class floor).

The full resolution — _does this tag point at an existing requirement?_ —
requires the vault graph, which `archgate` cannot see (its `RuleContext` is
repo-scoped: `glob` / `grep` / `readFile`, no vault assets, no diff delta). That
resolution is the job of the **`requirements-trace`** CI job (it clones the reqs
assetspace and has graph access).

What archgate **can** enforce, whole-tree and deterministically, is the one
repo-expressible invariant: **every `@req:` tag in a test title is a
syntactically well-formed UUID**. A truncated or mistyped tag (the realistic
copy-paste failure) can never resolve, so catching it at the syntax layer keeps
the binding corpus clean before the graph-aware job even runs.

## Decision

Any `@req:` token in a test/spec file whose suffix begins like a UUID
(hex/dash characters) **must** be a complete, well-formed UUID:
`@req:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (8-4-4-4-12 hex).

The check is deliberately **conservative** — it only flags a candidate that
_looks like_ a malformed UUID (`@req:` immediately followed by a hex char). It
never flags template interpolations (`@req:${uid}`) or documentation
placeholders (`@req:<uid>`), so the checker's own tests and the authoring guide
are not false-positives.

This is a **soft** discipline rule (`severity: warning`) — it surfaces malformed
tags without blocking. Existence/resolution remains the `requirements-trace`
job's responsibility (soft in P1, hard in P3 per RFC 0003 §3.7).

## Do's and Don'ts

### Do

- Write the full UID in the test title: `it("@req:449f29ce-cbd5-4ac8-94d4-28aa56a013c2 …", …)`.
- Keep the tag inside the `it()`/`test()` title (it travels with the assertion).
- Record the binding's class + revert-verify evidence in the requirement asset.

### Don't

- Truncate or mistype the UUID (`@req:449f29ce` — dangling, never resolves).
- Put the tag in a detachable comment instead of the title.

## References

- [RFC 0003 — requirements management](../../docs/rfc/0003-requirements-management.md) §3.6, §3.7
- [Authoring functional requirements](../../docs/requirements-authoring.md)
- `exocortex requirements audit` — the graph-aware traceability checker (CLI)
