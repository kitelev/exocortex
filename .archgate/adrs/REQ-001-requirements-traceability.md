---
id: REQ-001
title: Requirements traceability — statically-resolvable @req bindings
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

# Requirements traceability — statically-resolvable `@req` bindings

## Context

RFC 0003 (requirements management) binds a functional `req__Requirement` vault
asset to an **already-existing real test** by placing a `@req:<uid>` token
inside that test's `it(...)` / `test(...)` title — so the binding travels with
the assertion across refactors. The `requirements-audit` checker
(`packages/req-audit`) resolves those tags against the requirement graph
(orphans / dangling / duplicates / coverage / binding-class floor).

The full resolution — _does this tag point at an existing requirement?_ —
requires the vault graph, which `archgate` cannot see (its `RuleContext` is
repo-scoped: `glob` / `grep` / `readFile`, no vault assets, no diff delta). That
resolution is the job of the **`requirements-trace`** CI job (it clones the reqs
assetspace and has graph access).

What archgate **can** enforce, whole-tree and deterministically, are two
repo-expressible invariants:

1. **Every `@req:` tag in a test title is a syntactically well-formed UUID.** A
   truncated or mistyped tag (the realistic copy-paste failure) can never
   resolve, so catching it at the syntax layer keeps the binding corpus clean
   before the graph-aware job even runs.

2. **A requirement binding is statically resolvable.** The `requirements-trace`
   scanner binds ONLY on a literal `@req:<uuid>` token — it never evaluates a
   template literal. A test that DRYs the UID (`const REQ = "…"` +
   ``it(`… @req:${REQ}`)``) therefore has an **invisible** binding: the audit
   sees zero coverage for that requirement. Harmless while the requirement is
   `proposed`, but the moment it is activated the active-gate reds
   `requirements-trace` for **every** PR in the repo and blocks Auto Release —
   an expensive, repo-wide incident (see #3949/#3951) for a one-line omission.
   archgate catches this at the syntax layer: a template-literal binding must be
   accompanied by a literal `@req:<uuid>` token somewhere in the file.

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

### `no-template-literal-only-req-binding` (error)

A test that binds a requirement **only** through a template literal —
``it(`… @req:${UID}`)`` / ``describe(`… @req:${uid}`)`` / ``test(`… @req:${x}`)`` —
is invisible to the static `requirements-trace` scanner. This is a **hard** rule
(`severity: error`): the file **must** also carry a literal
`@req:<full-uuid>` token (a comment next to the interpolated `const`, or a
literal title) so the binding survives when the requirement is activated.

Detection is precise: it flags only a title opener (`it(`/`describe(`/`test(`)
immediately followed by a backtick then `@req:${` — it does **not** flag a
fixture STRING like `` `it("@req:${UID}…")` `` (backtick-first, so `it(` is
followed by `"`), which is how `requirements-audit.integration.test.ts`
constructs its test-corpus fixtures. And a single literal token anywhere in the
file clears the rule, so a DRY `const REQ` + interpolated titles stays legal as
long as one literal token anchors the binding.

## Do's and Don'ts

### Do

- Write the full UID as a **literal** in the test title: `it("@req:449f29ce-cbd5-4ac8-94d4-28aa56a013c2 …", …)`.
- Keep the literal tag inside the `it()`/`test()` title (it travels with the assertion).
- If you DRY the UID (`const REQ = "…"` + ``it(`… @req:${REQ}`)``), add a literal
  anchor token next to the const — `// @req:<full-uuid>` — so the binding is
  statically resolvable. The `@req:${REQ}` titles remain for readability; the
  comment is what `requirements-trace` (and archgate) actually bind on.
- Record the binding's class + revert-verify evidence in the requirement asset.

### Don't

- Truncate or mistype the UUID (`@req:449f29ce` — dangling, never resolves).
- Bind a requirement **only** through a template literal (``it(`… @req:${UID}`)``)
  with no literal token anywhere — the static scanner can't see it, so activating
  that requirement reds `requirements-trace` for every PR. (A detachable comment
  is fine _as the literal anchor_ when titles interpolate; what's forbidden is
  having **no** literal token at all.)

## References

- [RFC 0003 — requirements management](../../docs/rfc/0003-requirements-management.md) §3.6, §3.7
- [Authoring functional requirements](../../docs/requirements-authoring.md)
- `packages/req-audit` — the graph-aware traceability checker (repo-internal dev
  tool; run by the `requirements-trace` CI job. Extracted out of
  `@kitelev/exocortex-cli`, where it was `exocortex requirements audit`, by
  RFC 7c7859d1 W-req)
- Incident #3949/#3951 — a template-literal-only binding (`@req:${REQ}`) went
  active and red `requirements-trace` repo-wide; #3953 added the preventive rule.
