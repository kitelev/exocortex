---
id: SEC-001
title: Living-Docs build is PAT-less (fail-closed by absence)
domain: security
rules: true
files: [".github/workflows/living-docs.yml"]
---

# Living-Docs build is PAT-less (fail-closed by absence)

## Context

The Living-Documentation site (RFC 0004) publishes the **public** requirements
and architectural decisions of this repo to the open internet (GitHub Pages,
indexed and cached → any leak is irreversible). The vault graph these are drawn
from is a **mixed** public/private corpus: T-Bank work data and personal notes
live in **private** `exoas-*` repositories.

A naive "filter the private parts out at build time" model is one forgotten
query away from leaking. RFC 0004 §1.3 reframes the guarantee from a runtime
check to a **structural property**.

## Decision

The Living-Docs build workflow (`.github/workflows/living-docs.yml`) runs with
**no credential that grants access to any private repository** — it is
**PAT-less**:

- `actions/checkout` runs with only the default repo-scoped `GITHUB_TOKEN`. No
  `token:` / `ssh-key:` override widens it.
- No user PAT / broad-scope secret is injected into git or the generator.

Therefore a `git submodule update` can fetch **only public** submodules. A
private submodule would fail the credential-free fetch → the build fails → nothing
is published. This is **fail-closed by absence**: you cannot leak what was never
fetched (RFC 0004 §3.1 / §5).

## Enforcement (machine-checked)

This ADR carries an archgate rule (`SEC-001-living-docs-air-gap.rules.ts`) that
**fails the build** if `living-docs.yml` references any secret beyond the default
`GITHUB_TOKEN`, or overrides the checkout credential. The guarantee is thus
**verified, not assumed** — the inspectable absence of a private-repo credential
is a required CI gate.

## Consequences

- **Positive:** the privacy boundary cannot be regressed by a careless edit — a
  PAT added to this workflow is rejected at CI. The guarantee is auditable in one
  place (the workflow YAML).
- **Trade-off:** the site can only ever document **public** repos/submodules.
  Per-repo docs for other public repos are an explicit EXPAND phase; private
  knowledge is, by construction, never publishable here.
- **Out of scope (RFC 0004 §5):** data accidentally committed to a _public_ repo
  is already public at commit time — Pages adds no net exposure, so no
  output-content scan is performed (Andrey, interview Q4).
