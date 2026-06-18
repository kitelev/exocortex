# Per-AssetSpace SHACL CI gate — registry-driven rollout

> **Issue:** kitelev/exocortex#3513 · **Depends on:** #3511 (registry-driven
> `dependsOn` resolution) · **Program:** EKA Alpha 16-repo schema (PMBOK
> `f33732f4` M3.9, user directive 2026-06-14: _SHACL = 0 on every AssetSpace +
> CI gate on every commit_).

## Problem

In the EKA Alpha topology every AssetSpace is its own git repo (`exoas-*`). A
_leaf_ repo (e.g. `exoas-public`, `exoas-my`) defines classes/instances that
reference TBox living in **other** repos (`exoas-exo`, `exoas-w3c-aggregated`,
…). If CI validates a repo in isolation:

- **No shapes load** → `validate schema --shapes-mode` trivially passes with
  zero findings. The gate is a **false-negative** — a real structural violation
  ships green. (Empirically: `exoas-public` standalone = 0 violations, 0
  warnings; the shape definitions that would catch a violation live in
  `exoas-exo`, which wasn't loaded.)
- Or, when some shapes do load, every cross-repo class reference becomes an
  **unresolvable-ref warning** — noise that can't be told apart from a genuine
  broken reference.

The fix (#3513): on every commit/PR, **resolve the repo's transitive
`exo__AssetSpace_dependsOn` closure from the central registry, clone those
dependency repos, and validate the repo's content against the union** so the
shapes apply and cross-repo references resolve.

## Architecture

```
 push/PR to exoas-<repo>
        │
        ▼
 reusable workflow  kitelev/exoas-ci/.github/workflows/assetspace-ci.yml
        │
        ├─ git clone exoas-registry                         (central descriptors + dependsOn DAG)
        ├─ exocortex resolve-deps --registry … --self <owner/repo>   ──►  dep clone URLs
        │      (transitive dependsOn closure, #3511 core primitive)
        ├─ git clone <each dep>                              (materialise dependent TBox)
        ├─ validate schema --shapes-mode --vault . --also <dep> …    ──►  exit 0/1
        └─ audit ontology-imports --vault .
```

### CLI: `exocortex resolve-deps` (this issue's CLI deliverable)

```
exocortex resolve-deps --registry <path-to-cloned-exoas-registry> \
                       --self <owner/repo | git-url | namespace> \
                       [--format urls|json] [--strict]
```

- Scans the registry's `exo__AssetSpace` descriptors → builds the
  `uid → {source, namespace, dependsOn[]}` map.
- Matches `--self` (a `github.repository` slug, a clone URL, or a namespace) to
  its descriptor.
- Computes the transitive `dependsOn` closure via the shared core primitive
  `transitiveDependsOnClosure` (#3511) — **identical DAG semantics to
  profile-apply** (parity rule `multi-parser-predicate-migration`).
- `urls` format (default): prints one **dependency** clone URL per line, self
  excluded, BFS order. Empty output ⇒ no deps ⇒ validate standalone.
- **Lenient by default**: a repo with no descriptor in the registry prints
  nothing and exits 0 (validate standalone), so onboarding a new repo never
  hard-errors CI. `--strict` exits 2 for unregistered repos when you want
  fail-fast.

Examples (against the live registry):

| `--self`               | resolved dependency URLs (closure − self)                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `kitelev/exoas-exo`    | `exoas-w3c-aggregated`                                                                                   |
| `kitelev/exoas-public` | `exoas-exo`, `exoas-w3c-aggregated`                                                                      |
| `kitelev/exoas-my`     | `exoas-shared-private`, `exoas-shared-kalashnikova`, `exoas-public`, `exoas-exo`, `exoas-w3c-aggregated` |

### Severity contract — _zero false-positives from unresolvable cross-repo refs_

The CLI (`#3488`) splits findings by severity:

- `sh:Violation` (missing required property, cardinality, datatype, **resolvable
  but wrong** class) → breaks conformance → **exit 1** → gate **RED**.
- `sh:class unresolvable-ref` (a class reference whose target is absent from the
  resolved graph — a person/agent in a leaf repo the current repo legitimately
  does _not_ depend on) → `sh:Warning` → does **not** affect the exit code →
  gate stays **GREEN**.

Consequence: **resolution failures degrade safely.** A dependency that can't be
cloned (private repo, no token) turns its inbound references into warnings, never
a false violation. The gate only ever goes red on a genuine in-scope violation.

## Reusable workflow

Canonical home: **`kitelev/exoas-ci` → `.github/workflows/assetspace-ci.yml`**
(reviewed reference copy: [`assetspace-shacl-workflow.yml`](./assetspace-shacl-workflow.yml)).

Inputs:

| input                     | default                                     | meaning                                                     |
| ------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `warn_only`               | `true`                                      | non-blocking pilot; flip to `false` for a blocking gate     |
| `resolve_deps`            | `true`                                      | registry-driven dependent-TBox resolution (#3513)           |
| `registry_url`            | `https://github.com/kitelev/exoas-registry` | central registry                                            |
| `cli_version`             | `latest`                                    | `@kitelev/exocortex-cli` spec (must include `resolve-deps`) |
| `registry_token` (secret) | —                                           | optional PAT for cloning the registry + private deps        |

Caller (`.github/workflows/ci.yml` in an AssetSpace repo):

```yaml
name: CI
on: [push, pull_request, workflow_dispatch]
jobs:
  ci:
    uses: kitelev/exoas-ci/.github/workflows/assetspace-ci.yml@main
    with:
      warn_only: false # blocking once the repo is gate-green
      resolve_deps: true
    # secrets: { registry_token: ${{ secrets.EXOAS_CLONE_PAT }} }  # only if any dep is PRIVATE
```

## Rollout plan — 16+ AssetSpace repos

44 `exoas-*` repos already call `assetspace-ci.yml@main` (all `warn_only: true`).
The rollout is **per-repo opt-in to blocking**, staged by gate-green:

### Stage 0 — infrastructure (this issue)

1. Ship `resolve-deps` in `@kitelev/exocortex-cli` (exocortex PR → release).
2. Upgrade `exoas-ci/assetspace-ci.yml` to resolve deps + `--also` + blocking-capable
   (pin `cli_version` to the #3513 release). All 44 callers keep `warn_only: true`
   → they now get **accurate** warnings (deps resolved) with zero blocking risk.

### Stage 1 — pilot (this issue's acceptance)

3. Flip **one** repo (`exoas-exo`, the floor) to `warn_only: false`.
   - Green on clean content (closure `{exo, w3c-aggregated}` resolved).
   - Red on an injected `sh:Violation` (revert-verify).

### Stage 2 — floor + public TBox (high fan-in, validate first)

Flip to blocking in dependency order (a dependency should be clean before its
dependents gate on it):

```
exoas-w3c-aggregated → exoas-exo → exoas-public → exoas-exocmd
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
   exoas-shared-private        exoas-shared-tbank            exoas-registry / exoas-profiles
        │                            │
   exoas-shared-kalashnikova   exoas-shared-toosgroupleads → {shared-mudriy, shared-levina}
```

### Stage 3 — leaves

`exoas-my`, `exoas-tbank`, `exoas-exodev`, and the per-collaborator repos. Each
flips to blocking once its `validate schema --shapes-mode` (with resolved deps)
is clean.

### Per-repo onboarding checklist

1. Confirm the repo has an `exo__AssetSpace` descriptor in `exoas-registry`
   (else `resolve-deps` is lenient-empty and validation is standalone).
   `exocortex resolve-deps --registry <reg> --self <owner/repo> --format json`
   shows the resolved closure.
2. Run the gate in warn-only and read `sh:Violation` count from the CI summary.
3. Fix violations to **0** (warnings are acceptable — cross-repo refs).
4. Flip `warn_only: false` in that repo's `ci.yml`.

> **Note — repos NOT in the registry.** Legacy shared submodules (e.g. a separate
> `exoas-ems`) whose TBox was folded into `exoas-public` under the EKA re-prefix
> have no registry descriptor. `resolve-deps` returns empty (lenient) → they
> validate standalone, which is correct for a self-contained repo. Add a
> descriptor to `exoas-registry` only if the repo needs cross-repo TBox.

## Pilot verification (revert-verify, issue #3513 acceptance)

Local reproduction of the CI gate against the **live** registry + repos
(`exocortex-cli@<#3513 release>`):

```bash
# 1. resolve deps for the floor repo
git clone --depth 1 https://github.com/kitelev/exoas-registry registry
exocortex resolve-deps --registry registry --self kitelev/exoas-exo
#   → https://github.com/kitelev/exoas-w3c-aggregated

# 2. GREEN on clean content
git clone --depth 1 https://github.com/kitelev/exoas-exo
git clone --depth 1 https://github.com/kitelev/exoas-w3c-aggregated
exocortex validate schema --shapes-mode --vault exoas-exo --also exoas-w3c-aggregated
#   → ✅ conforms, exit 0   (26 cross-repo-ref warnings, non-blocking)

# 3. RED on injected violation (exo__Setting is Single-cardinality)
cat > exoas-exo/exo/zzz-violation.md <<'EOF'
---
exo__Asset_uid: zzzzzzzz-0000-0000-0000-000000000003
exo__Asset_label: "injected-setting"
exo__Instance_class: ["[[88b938af-1a55-451c-b3cc-2f03e5115fcf]]"]
exo__Setting_key: ["key-one", "key-two"]   # 2 values on a Single-cardinality property
---
EOF
exocortex validate schema --shapes-mode --vault exoas-exo --also exoas-w3c-aggregated
#   → ❌ sh:maxCount violation, exit 1

# 4. revert → GREEN again
rm exoas-exo/exo/zzz-violation.md
```
