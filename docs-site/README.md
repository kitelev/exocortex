# docs-site — Living-Documentation generator (RFC 0004)

A **self-contained**, from-graph static-site generator for the public
documentation of `kitelev/exocortex`. It renders, into a static site:

- **Functional requirements** — `req__Requirement` instances from the
  `packages/exoas-exo-reqs` public submodule (Gherkin `Given/When/Then`,
  lifecycle status, priority, binding classes, `verifiedBy` coverage).
- **Architectural / NFR decisions** — the ADRs in `.archgate/adrs`.
- **Ontology reference** — a flat class/property listing from the
  `packages/exoas-exo` public submodule.

It is **MVP-2** of the Living-Documentation phasing (RFC 0004 §6).

## Why this is a standalone script, not a CLI subcommand

The original RFC sketch suggested an `@kitelev/exocortex-cli requirements pages`
subcommand. That was **revised by Andrey** (2026-06-21): the `requirements`
command does not fit the target CLI paradigm (the CLI keeps only the basic vault
verbs — `find` / `query` / `apply`). So the generator lives here as a standalone
build with **zero dependency on `@kitelev/exocortex-cli`** — it parses the RDF
frontmatter itself (see `lib/frontmatter.mjs`). This keeps the publish-CLI lean
and keeps this generator independent of CLI churn.

## Privacy model (RFC 0004 §3.1 / §5) — fail-closed by absence

This generator does **no filtering** and needs none: the privacy guarantee is
**upstream and structural**. The deploy pipeline (MVP-3, `living-docs.yml`) runs
**without any PAT**, so it can only ever have checked out **public** repos. The
generator reads _only_ the local checkout — there is no network access and no
cross-repo fetch. You cannot leak what was never fetched.

## Usage

```bash
npm ci                 # install marked + js-yaml (pinned via package-lock.json)
npm test               # node:test unit + fixture tests
node build.mjs         # build _site/ from this repo's submodule layout
```

Options (all default to this repo's layout, so a bare `node build.mjs` works from
a `submodules: recursive` checkout):

| flag               | default                            | meaning                                          |
| ------------------ | ---------------------------------- | ------------------------------------------------ |
| `--reqs <dir>`     | `packages/exoas-exo-reqs/exo-reqs` | requirements ABox                                |
| `--archgate <dir>` | `.archgate`                        | ADR source (`adrs/` is read)                     |
| `--ontology <dir>` | `packages/exoas-exo`               | ontology submodule (optional; skipped if absent) |
| `--out <dir>`      | `_site`                            | output directory                                 |

The output is a Jekyll-free static site (`.nojekyll`).

## Layout

```
docs-site/
  build.mjs          CLI entry (arg parsing + summary)
  lib/
    frontmatter.mjs  split + parse YAML frontmatter (js-yaml), wikilink helpers
    requirements.mjs load req__Requirement assets (from-graph coverage via verifiedBy)
    adrs.mjs         load .archgate/adrs (*.md only)
    ontology.mjs     load class/property reference from exoas-exo
    render.mjs       markdown→HTML (marked) + page templates + stylesheet
    site.mjs         orchestrate: write index + per-entity pages + assets
  test/              node:test unit + fixture tests
```
