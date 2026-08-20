---
id: CI-002
title: A published package must not promise an older Node than its dependencies require
domain: ci
rules: true
files: ["packages/*/package.json", "package-lock.json"]
---

# Published `engines` ↔ Dependency `engines`

## Context

A package we publish declares `engines.node`. Every dependency it pulls declares
its own. Nothing in the repository compares the two, so a routine dependency
bump can raise what the code **requires** without touching what the manifest
**promises**.

Measured on 2026-08-21 (PR #4169, `commander` 14 → 15), read from the lockfile:

```
packages/cli/node_modules/commander  15.0.0  engines: { node: '>=22.12.0' }
packages/cli/package.json                    engines: { node: '>=20.0.0'  }
```

The published package promised Node 20 and required 22.12.

## The part that makes this a rule rather than a checklist item

CI cannot catch it **by construction**. The workflows run `node-version: "22"`,
which resolves above 22.12, so every job is green. The gap exists precisely
where we do not test — at a consumer on Node 20 — and none of the required
checks reads `engines` at all.

The failure therefore surfaces as somebody else's install error, days later,
with no signal on our side. That is the same shape as CI-001's Node pair: a
green pipeline is not evidence, because the pipeline never exercises the
declaration.

## Relationship to CI-001

CI-001 compares a manifest against the **CI environment**. This is the third
form of one class, and its second side is different:

| # | manifest | second side | caught today |
|---|---|---|---|
| #4163 | `@playwright/test` | container tag in `ci.yml` | CI (322 red) + CI-001 |
| #4147 / #4161 | `@types/node` | `node-version:` | CI compiles, does not run → CI-001 |
| **this** | our `engines` | **dependencies' `engines`** | nothing — breaks at the consumer |

The data source differs (`package-lock.json`, not a workflow), which is why it
is a separate rule rather than a third pair inside CI-001.

## Decision

For every **published** package (`private` not `true`) that declares
`engines.node`, compare its floor against the floor of each **direct**
dependency's `engines.node`, resolved through `package-lock.json` (nearest
entry first, matching npm resolution). A dependency floor **above** ours is a
violation.

## Limits — chosen, not overlooked

1. **Direct dependencies only.** Transitive requirements are not ours to
   satisfy, and their declarations are often absent or stale; including them
   would bury the actionable signal under noise.

2. **Lower bounds, not range containment.** `engines` may be a disjunction —
   `20 || >=22` and `^12.17.0 || ^14.13 || >=16.0.0` both appear in this
   lockfile today — and the rule compares the lowest version each side admits.
   This catches "the dependency needs a newer Node than we promise", the shape
   that shipped. It does not catch a hole *inside* a disjunction (we allow Node
   21 while a dependency admits `20 || >=22`). Closing that needs a real semver
   implementation, and rule files may import only `node:*`.

## Consequences

- A `commander`-style bump now fails `archgate` instead of reaching npm.
- Raising `engines` becomes an explicit, reviewed act rather than a silent
  omission.
- Adding a published package with no `engines` declaration stays allowed — the
  rule only fires where a promise exists to contradict.
