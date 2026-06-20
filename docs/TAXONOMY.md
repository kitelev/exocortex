# Documentation taxonomy — `doc → Diátaxis mode` mapping

> **Phase-2 deliverable** of [RFC 0001 — Documentation reorganization (Diátaxis)](rfc/0001-documentation-diataxis-reorganization.md).
> This table classifies **every** prose doc by Diátaxis mode _before_ the Phase-2
> file moves, so no doc is relocated unclassified. It is the source of truth for the
> physical layout under `docs/` and for the logical grouping in [`README.md`](README.md)
> (the single index).

[Diátaxis](https://diataxis.fr/) modes: **tutorial** (learning-oriented),
**how-to** (task-oriented), **reference** (information-oriented),
**explanation** (understanding-oriented), plus a **contributing** bucket for
contributor/CI process docs. RFC §3: _the taxonomy + single index + de-duplication
matter more than literal paths; cohesion over purity — a straddle doc is placed by
its dominant intent with an explicit rationale, never silently._

---

## Scope decision (what Phase 2 physically moves)

Phase 2 introduces `docs/{tutorials,how-to,reference,explanation,contributing}/`
and **physically relocates the `docs/`-tree prose files** into those buckets,
leaving a redirect stub at every old path (one-release grace — **removed in Phase 5**
once the grace elapsed) and fixing all cross-links + non-markdown config refs in the same PR.

Two categories are classified for the index but **NOT physically moved in Phase 2**
(cohesion-over-purity / bounded blast-radius — explicit, per RFC §3 & §5):

1. **Root-level docs** (`README.md`, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`,
   `SECURITY.md`, `CODE_OF_CONDUCT.md`, `TEMPLATES.md`, `PATTERNS.md`, `TESTING.md`,
   `DEV-TROUBLESHOOTING.md`, `VISION.md`, `ARCHITECTURE.md`, `CHANGELOG.md`) **stay at
   the repo root.** Rationale:
   - `README.md` / `CONTRIBUTING.md` / `SECURITY.md` / `CODE_OF_CONDUCT.md` are
     **GitHub-convention-pinned** to the repo root (auto-detected community-health
     files / front door). `CLAUDE.md` and `AGENTS.md` are **tool-discovery-pinned** to
     the root (Claude Code auto-loads root `CLAUDE.md`; the universal `AGENTS.md`
     standard is discovered at the repo root). Moving any of these breaks tooling.
   - `PATTERNS.md` / `TESTING.md` / `AGENTS.md` are **Phase-3 content-hygiene targets**
     (slim / prune / unify). RFC §5 keeps moves separate from content edits; physically
     relocating them now would be double-churn against a doc that is about to be rewritten.
   - The root process cluster (`PATTERNS`, `TESTING`, `DEV-TROUBLESHOOTING`, `VISION`,
     `ARCHITECTURE`, `TEMPLATES`) is referenced by the coordination hub `CLAUDE.md` as
     `exocortex/<NAME>.md` and by CI/scripts; it is a cohesive root cluster. A future
     phase (or explicit user decision) may relocate it — out of Phase-2 scope.
   - Their **Diátaxis mode is still recorded below** so the index groups them correctly.

2. **Package-local docs** (`packages/*/docs/*`, `packages/*/README.md`,
   `packages/cli/VERSIONING.md`) are **npm-shipped with their package** — only
   **logically grouped** under `reference/` in the index, **never** relocated across
   package boundaries (RFC §3).

`docs/history/**` (frozen archive bucket), `docs/rfc/**` (RFC home),
`docs/examples/**` (test fixtures consumed by code/tests), and `docs/diagrams/**`
(non-prose `.mmd` assets referenced by `ARCHITECTURE.md`) **stay in place** —
already-bucketed or non-prose.

---

## `docs/`-tree files — physically moved in Phase 2

| Old path                                                               | → New path                                           | Mode         | Rationale (straddles explicit)                                                                                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/Getting-Started.md`                                              | `docs/tutorials/Getting-Started.md`                  | tutorial     | learning-oriented first-install walkthrough                                                                                                                                            |
| `docs/Troubleshooting.md`                                              | `docs/how-to/Troubleshooting.md`                     | how-to       | task-oriented "common issues & fixes" (end-user)                                                                                                                                       |
| `docs/WORKFLOW_CUSTOMIZATION.md`                                       | `docs/how-to/WORKFLOW_CUSTOMIZATION.md`              | how-to       | **straddle**: step-by-step (lean tutorial) but the goal is _accomplish a customization task_ → how-to (cohesion with the other config how-tos)                                         |
| `docs/ONTOLOGY_EXTENSION.md`                                           | `docs/how-to/ONTOLOGY_EXTENSION.md`                  | how-to       | **straddle**: step-by-step but goal = _extend the ontology_ → how-to                                                                                                                   |
| `docs/Plugin-Development-Guide.md`                                     | `docs/how-to/Plugin-Development-Guide.md`            | how-to       | **straddle**: developer guide; task-oriented "extend Exocortex with custom functionality"                                                                                              |
| `docs/exosync.md`                                                      | `docs/how-to/exosync.md`                             | how-to       | ExoSync **usage** (`Exocortex: Sync`, structured merge, conflict quarantine)                                                                                                           |
| `docs/ROLLBACK_EXOQL_EVAL.md`                                          | `docs/how-to/ROLLBACK_EXOQL_EVAL.md`                 | how-to       | operational rollback **procedure** (runbook); task-oriented                                                                                                                            |
| `docs/PROPERTY_SCHEMA.md`                                              | `docs/reference/PROPERTY_SCHEMA.md`                  | reference    | frontmatter property vocabulary (pure reference)                                                                                                                                       |
| `docs/NL-TO-SPARQL.md`                                                 | `docs/reference/NL-TO-SPARQL.md`                     | reference    | canonical NL → query translation reference                                                                                                                                             |
| `docs/SHACL_LITE_MAPPING.md`                                           | `docs/reference/SHACL_LITE_MAPPING.md`               | reference    | self-labeled "Status: Reference"; vocabulary mapping                                                                                                                                   |
| `docs/Performance-Guide.md`                                            | `docs/reference/Performance-Guide.md`                | reference    | **straddle**: "optimization tips **and performance characteristics**" — the system-characteristics content (index permutations, complexity) dominates over the tuning tips → reference |
| `docs/api/Core-API.md`                                                 | `docs/reference/Core-API.md`                         | reference    | programmatic core API reference (`api/` subdir flattened — single file)                                                                                                                |
| `docs/ci/assetspace-shacl-gate.md` (+ `assetspace-shacl-workflow.yml`) | `docs/reference/ci/assetspace-shacl-gate.md` (+ yml) | reference    | **straddle**: documents the per-AssetSpace SHACL CI **gate mechanism** (reference) with a rollout plan; subdir moved as a unit to preserve the sibling `.yml` link                     |
| `docs/profile.md`                                                      | `docs/explanation/profile.md`                        | explanation  | **straddle**: has Apply-profile usage but the architectural pitch + 2-phase-commit model dominate → explanation (per RFC §3)                                                           |
| `docs/CROSS_RUNTIME_PARITY.md`                                         | `docs/explanation/CROSS_RUNTIME_PARITY.md`           | explanation  | the UI/CLI parity invariant as a validator instance (concept)                                                                                                                          |
| `docs/settings-homoiconization.md`                                     | `docs/explanation/settings-homoiconization.md`       | explanation  | plugin settings as `exo__Setting` vault assets (concept)                                                                                                                               |
| `docs/exosync-parallel-run.md`                                         | `docs/explanation/exosync-parallel-run.md`           | explanation  | ExoSync internals / M1-M2 parity harness (per RFC §3 "exosync internals")                                                                                                              |
| `docs/rdf/ExoRDF-Mapping.md`                                           | `docs/explanation/ExoRDF-Mapping.md`                 | explanation  | vault ↔ RDF triple-mapping concept (per RFC §3; `rdf/` flattened — single file)                                                                                                        |
| `docs/AI-DEVELOPMENT-PATTERNS.md`                                      | `docs/contributing/AI-DEVELOPMENT-PATTERNS.md`       | contributing | patterns for AI-agent contributors                                                                                                                                                     |
| `docs/FLAKY_POLICY.md`                                                 | `docs/contributing/FLAKY_POLICY.md`                  | contributing | **straddle**: a normative CI policy (reference-like) but contributor/CI-ops-facing → contributing (cohesion with the testing/CI contributor docs)                                      |
| `docs/e2e-desktop.md`                                                  | `docs/contributing/e2e-desktop.md`                   | contributing | documents the `e2e-desktop.yml` CI workflow for contributors                                                                                                                           |

## `docs/`-tree — stay in place (already bucketed / non-prose)

| Path                   | Why it stays                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/README.md`       | **THE single index** (canonical home, RFC §3)                                                                                              |
| `docs/history/**`      | frozen archive bucket (Diátaxis `history/`)                                                                                                |
| `docs/rfc/**`          | RFC home (incl. this taxonomy's parent RFC)                                                                                                |
| `docs/examples/**`     | test fixtures consumed by code/tests (documented index exclusion)                                                                          |
| `docs/diagrams/**`     | non-prose `.mmd` assets referenced by `ARCHITECTURE.md`                                                                                    |
| `docs/TEST-PYRAMID.md` | Phase-1 consolidation stub → root `TESTING.md`; kept by path because `packages/{obsidian-plugin,cli}/jest.config.js` comments reference it |

## Root-level docs — classified for the index, NOT moved in Phase 2

| Doc                                                      | Mode (for index grouping) | Why it stays at root                                                                             |
| -------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `README.md`                                              | front door                | repo-root front door (GitHub convention)                                                         |
| `VISION.md`                                              | explanation               | root cluster; referenced widely (`./VISION.md`)                                                  |
| `ARCHITECTURE.md`                                        | explanation               | **straddle**: reference-heavy but kept whole (RFC §3); referenced as `exocortex/ARCHITECTURE.md` |
| `AGENTS.md`                                              | contributing              | universal AGENTS standard — root-discovered by AI tools; Phase-3 slim target                     |
| `CLAUDE.md`                                              | contributing              | Claude Code auto-loads root `CLAUDE.md`                                                          |
| `PATTERNS.md`                                            | contributing              | Phase-3 prune target; referenced as `exocortex/PATTERNS.md`                                      |
| `TESTING.md`                                             | contributing              | canonical testing guide; Phase-3 unify target; `exocortex/TESTING.md`                            |
| `DEV-TROUBLESHOOTING.md`                                 | contributing              | developer/CI troubleshooting; `exocortex/DEV-TROUBLESHOOTING.md`                                 |
| `TEMPLATES.md`                                           | contributing              | post-mortem templates; `exocortex/TEMPLATES.md`                                                  |
| `CONTRIBUTING.md` / `SECURITY.md` / `CODE_OF_CONDUCT.md` | contributing / community  | GitHub-auto-detected community-health files (root)                                               |
| `CHANGELOG.md`                                           | operational (retired)     | release notes retired to GitHub Releases; `release.sh` still greps it at root                    |

## Package-local docs — logically `reference/`, physically stay (npm-shipped)

| Path                                                                                  | Mode                                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/cli/docs/CLI_API_REFERENCE.md`                                              | reference                                                                       |
| `packages/cli/docs/ONTOLOGY_REFERENCE.md`                                             | reference                                                                       |
| `packages/cli/docs/SPARQL_GUIDE.md`, `SPARQL_COOKBOOK.md`                             | reference                                                                       |
| `packages/cli/VERSIONING.md`                                                          | reference                                                                       |
| `packages/cli/docs/RCA_DYNCOMMAND_SHOW_VS_EXEC.md`, `SUNSET_LEGACY_COMMAND_START.md`  | contributing (process)                                                          |
| `packages/obsidian-plugin/docs/EXO_LAYOUT.md`                                         | reference                                                                       |
| `packages/obsidian-plugin/docs/release-checklist-mobile.md`                           | how-to                                                                          |
| `packages/obsidian-plugin/docs/FLAKY_DASHBOARD.md`                                    | contributing                                                                    |
| `packages/obsidian-plugin/docs/TESTING.md`, `packages/exocortex/docs/NL-TO-SPARQL.md` | stubs → canonical (root `TESTING.md` / `docs/reference/NL-TO-SPARQL.md`)        |
| `packages/obsidian-plugin/docs/phase3/**`                                             | frozen archive (referenced by `docker-entrypoint-e2e.sh` comment — do not move) |

---

_Generated for RFC 0001 Phase 2. The redirect stubs at every moved old path (one-release
grace) were removed in Phase 5 once the grace elapsed; the new canonical Diátaxis paths
above are now the only locations._
