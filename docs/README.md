# Exocortex Documentation — Index

**Single entry point** for all Exocortex documentation. It indexes the curated
`docs/` tree **and** the root process docs (`AGENTS.md`, `PATTERNS.md`,
`TESTING.md`, …) **and** package-local docs (`packages/*/docs/`).

The `docs/` tree is physically organized into the
[Diátaxis](https://diataxis.fr/) modes — `tutorials/`, `how-to/`, `reference/`,
`explanation/`, plus a `contributing/` bucket and a frozen `history/` archive.
**Root-level docs** (`README`, `CLAUDE`, `AGENTS`, `VISION`, `ARCHITECTURE`,
`PATTERNS`, `TESTING`, `DEV-TROUBLESHOOTING`, …) and **package-local docs**
(`packages/*/docs/`) stay in place and are grouped *logically* here. The
complete `doc → mode` classification (with the move map and the rationale for
docs kept at root) is in **[TAXONOMY.md](TAXONOMY.md)**.

> Paths are relative to this file (`docs/`). Root-level docs are linked as `../NAME.md`.
> Old `docs/*` paths keep a one-release redirect stub, so external deep-links still resolve.

---

## Start here

- [../README.md](../README.md) — product overview & feature front door
- [Getting-Started.md](tutorials/Getting-Started.md) — install, first vault, core concepts
- [../VISION.md](../VISION.md) — product vision + cross-cutting invariants (UI/CLI parity, Desktop↔Mobile parity)
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — contributor setup, PR workflow, coding standards

## Tutorials & How-to

- [Getting-Started.md](tutorials/Getting-Started.md) — first install + first vault
- [Plugin-Development-Guide.md](how-to/Plugin-Development-Guide.md) — building/extending the plugin
- [WORKFLOW_CUSTOMIZATION.md](how-to/WORKFLOW_CUSTOMIZATION.md) — customizing status workflows
- [ONTOLOGY_EXTENSION.md](how-to/ONTOLOGY_EXTENSION.md) — adding classes/properties
- [Troubleshooting.md](how-to/Troubleshooting.md) — **user** troubleshooting (common issues & fixes)
- [profile.md](explanation/profile.md) — Profile pitch + Apply-profile (mount-state) usage
- [exosync.md](how-to/exosync.md) — ExoSync usage (`Exocortex: Sync`, structured merge, conflict quarantine)
- [../packages/obsidian-plugin/docs/release-checklist-mobile.md](../packages/obsidian-plugin/docs/release-checklist-mobile.md) — mobile release checklist

## Reference

- [PROPERTY_SCHEMA.md](reference/PROPERTY_SCHEMA.md) — full frontmatter property vocabulary
- [api/Core-API.md](reference/Core-API.md) — `exocortex` core programmatic API
- [NL-TO-SPARQL.md](reference/NL-TO-SPARQL.md) — natural-language → query translation (**canonical**)
- [SHACL_LITE_MAPPING.md](reference/SHACL_LITE_MAPPING.md) — SHACL-lite shape mapping
- [rdf/ExoRDF-Mapping.md](explanation/ExoRDF-Mapping.md) — vault ↔ RDF triple mapping
- CLI reference — [CLI_API_REFERENCE.md](../packages/cli/docs/CLI_API_REFERENCE.md), [ONTOLOGY_REFERENCE.md](../packages/cli/docs/ONTOLOGY_REFERENCE.md), [SPARQL_GUIDE.md](../packages/cli/docs/SPARQL_GUIDE.md), [SPARQL_COOKBOOK.md](../packages/cli/docs/SPARQL_COOKBOOK.md), [VERSIONING.md](../packages/cli/VERSIONING.md)
- Plugin reference — [EXO_LAYOUT.md](../packages/obsidian-plugin/docs/EXO_LAYOUT.md) — layout engine

## Explanation & Architecture

- [../ARCHITECTURE.md](../ARCHITECTURE.md) — layering, monorepo, clean architecture
- [CROSS_RUNTIME_PARITY.md](explanation/CROSS_RUNTIME_PARITY.md) — validator instance of the UI/CLI Parity Invariant
- [settings-homoiconization.md](explanation/settings-homoiconization.md) — plugin settings as `exo__Setting` vault assets
- [exosync-parallel-run.md](explanation/exosync-parallel-run.md) — ExoSync parallel-run mode + M1/M2 parity harness
- `diagrams/` — Mermaid architecture diagrams (`architecture-overview.mmd`, `asset-creation-flow.mmd`, `command-execution-flow.mmd`, `layout-rendering.mmd`, `property-inheritance.mmd`, `service-dependencies.mmd`, `status-workflow.mmd`, `future-architecture.mmd`)

## Testing & CI

- [../TESTING.md](../TESTING.md) — **canonical testing guide** (test types, pyramid, fixtures, mocking, E2E suites, coverage gates, troubleshooting)
- [FLAKY_POLICY.md](contributing/FLAKY_POLICY.md) — flaky-test handling policy (`@flaky-track`, quarantine)
- [e2e-desktop.md](contributing/e2e-desktop.md) — desktop E2E setup
- [Performance-Guide.md](reference/Performance-Guide.md) — performance guidance
- [ci/assetspace-shacl-gate.md](reference/ci/assetspace-shacl-gate.md) — per-AssetSpace SHACL CI gate
- [../packages/obsidian-plugin/docs/FLAKY_DASHBOARD.md](../packages/obsidian-plugin/docs/FLAKY_DASHBOARD.md) — flaky-test dashboard
- [.github/E2E-LOCAL-TESTING.md](../.github/E2E-LOCAL-TESTING.md) — running E2E locally
- _Pointer stubs (consolidated into `../TESTING.md`):_ [TEST-PYRAMID.md](TEST-PYRAMID.md), [.github/TESTING.md](../.github/TESTING.md), [../packages/obsidian-plugin/docs/TESTING.md](../packages/obsidian-plugin/docs/TESTING.md), [../packages/exocortex/docs/NL-TO-SPARQL.md](../packages/exocortex/docs/NL-TO-SPARQL.md)

## Contributor & AI-agent guide

- [../AGENTS.md](../AGENTS.md) — universal AI-agent dev guide (Claude Code, Copilot, Cursor, …)
- [../CLAUDE.md](../CLAUDE.md) — in-repo (Claude) development guide
- [../packages/obsidian-plugin/CLAUDE.md](../packages/obsidian-plugin/CLAUDE.md) — plugin-package development guide
- [../PATTERNS.md](../PATTERNS.md) — coding-patterns catalog (50+ patterns)
- [../TESTING.md](../TESTING.md) — canonical testing guide (see Testing & CI above)
- [../DEV-TROUBLESHOOTING.md](../DEV-TROUBLESHOOTING.md) — **developer/CI** troubleshooting
- [../TEMPLATES.md](../TEMPLATES.md) — post-mortem & report templates
- [AI-DEVELOPMENT-PATTERNS.md](contributing/AI-DEVELOPMENT-PATTERNS.md) — patterns for AI-agent contributors
- [../CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) · [../SECURITY.md](../SECURITY.md) — community + security policy
- [.github/COPILOT_SETUP.md](../.github/COPILOT_SETUP.md), [.github/BRANCH_PROTECTION.md](../.github/BRANCH_PROTECTION.md), [.github/GITHUB_SETTINGS.md](../.github/GITHUB_SETTINGS.md) — repo/CI setup references
- [.archgate/adrs/](../.archgate/adrs/) — **Architecture Decision Records** (executable, enforced by the `archgate` CI check); see [../ARCHITECTURE.md § Archgate](../ARCHITECTURE.md#archgate--executable-adr-governance)
- Proposals about the docs themselves live in [rfc/](rfc/) — e.g. the [Diátaxis reorganization RFC](rfc/0001-documentation-diataxis-reorganization.md)

## Operational runbooks

- [ROLLBACK_EXOQL_EVAL.md](how-to/ROLLBACK_EXOQL_EVAL.md) — revert procedure for the ExoQL eval-config rollout (referenced by runtime config; kept active)
- [../CHANGELOG.md](../CHANGELOG.md) — _retired_ → release notes now in [GitHub Releases](https://github.com/kitelev/exocortex/releases)

## Package documentation

Some docs live alongside their package (npm-shipped with it) rather than in this
top-level tree. They are **logically grouped here for discoverability**, not
physically relocated across package boundaries.

### CLI — `packages/cli/docs/`

- [CLI_API_REFERENCE.md](../packages/cli/docs/CLI_API_REFERENCE.md) — full command/flag reference
- [ONTOLOGY_REFERENCE.md](../packages/cli/docs/ONTOLOGY_REFERENCE.md) — ontology reference for CLI users
- [SPARQL_GUIDE.md](../packages/cli/docs/SPARQL_GUIDE.md), [SPARQL_COOKBOOK.md](../packages/cli/docs/SPARQL_COOKBOOK.md) — querying from the CLI
- [VERSIONING.md](../packages/cli/VERSIONING.md) — CLI semantic-versioning policy
- [RCA_DYNCOMMAND_SHOW_VS_EXEC.md](../packages/cli/docs/RCA_DYNCOMMAND_SHOW_VS_EXEC.md) — _(process)_ root-cause analysis, referenced by the CLI README
- [SUNSET_LEGACY_COMMAND_START.md](../packages/cli/docs/SUNSET_LEGACY_COMMAND_START.md) — _(process)_ sunset checklist for legacy `command start`

### Obsidian plugin — `packages/obsidian-plugin/docs/`

- [EXO_LAYOUT.md](../packages/obsidian-plugin/docs/EXO_LAYOUT.md) — layout engine
- [release-checklist-mobile.md](../packages/obsidian-plugin/docs/release-checklist-mobile.md) — mobile release checklist
- [FLAKY_DASHBOARD.md](../packages/obsidian-plugin/docs/FLAKY_DASHBOARD.md) — flaky-test dashboard (drives `flaky-aggregate`/`flaky-render-markdown` scripts)
- [TESTING.md](../packages/obsidian-plugin/docs/TESTING.md) — _(stub → [../TESTING.md](../TESTING.md))_
- `phase3/` — _(historical, frozen)_ Phase-3 CI/X11 stabilization ADR + spikes. The [ADR](../packages/obsidian-plugin/docs/phase3/ADR_FLAKY_X11_STRATEGY.md) is referenced by `docker-entrypoint-e2e.sh`, so the folder is kept in place. Also: [T3_1_QUARANTINE_DECISION_MATRIX](../packages/obsidian-plugin/docs/phase3/T3_1_QUARANTINE_DECISION_MATRIX.md), [T3_3_TRACKING_ISSUES](../packages/obsidian-plugin/docs/phase3/T3_3_TRACKING_ISSUES.md), [T5_1_XVFB_TUNING_SPIKE](../packages/obsidian-plugin/docs/phase3/T5_1_XVFB_TUNING_SPIKE.md), [T5_2_XVFB_RUN_SPIKE](../packages/obsidian-plugin/docs/phase3/T5_2_XVFB_RUN_SPIKE.md), [T5_3_HEADED_CHROMIUM_SPIKE](../packages/obsidian-plugin/docs/phase3/T5_3_HEADED_CHROMIUM_SPIKE.md)

### Core engine — `packages/exocortex/docs/`

- [NL-TO-SPARQL.md](../packages/exocortex/docs/NL-TO-SPARQL.md) — _(stub → [NL-TO-SPARQL.md](reference/NL-TO-SPARQL.md))_ engine-internals pointer

## Archive — `history/`

Point-in-time artifacts from completed work (CI-speedup program, RFC-CI-tests
suite, Phase-3 stabilization, dated RFC working docs). Kept for provenance, not
active guidance:

- [history/ROLLBACK_CI_SPEEDUP.md](history/ROLLBACK_CI_SPEEDUP.md), [history/ROLLBACK_RFC_CI_TESTS.md](history/ROLLBACK_RFC_CI_TESTS.md) — rollback runbooks for completed CI migrations
- [history/CI_SPEEDUP_PHASE3_EXIT_ANALYSIS.md](history/CI_SPEEDUP_PHASE3_EXIT_ANALYSIS.md), [history/PHASE3_DASHBOARD_README.md](history/PHASE3_DASHBOARD_README.md), [history/PHASE3_QUARANTINE_POLICY.md](history/PHASE3_QUARANTINE_POLICY.md), [history/PHASE3_RETRY_POLICY.md](history/PHASE3_RETRY_POLICY.md) — Phase-3 CI stabilization records
- [history/REGRESSION_T1.6_PHASE1_POST_MERGE.md](history/REGRESSION_T1.6_PHASE1_POST_MERGE.md), [history/ROLLBACK_X11_STABILIZATION.md](history/ROLLBACK_X11_STABILIZATION.md) — one-off incident records
- [history/rfc-ci-button-testing-2026-04-20.md](history/rfc-ci-button-testing-2026-04-20.md), [history/shacl-cli-design.md](history/shacl-cli-design.md), [history/T1.5-grounding-audit.md](history/T1.5-grounding-audit.md), [history/phase-0-prototype-report-2026-04-20.md](history/phase-0-prototype-report-2026-04-20.md) — dated RFC working docs

## Not indexed (non-prose / tooling — documented exclusions)

The following `*.md` files are intentionally **not** indexed above (they are not
human prose docs). A diff of `find . -name '*.md'` against this index's links is
empty modulo these categories:

- `node_modules/**` — vendored dependencies
- `**/test-vault/**`, `**/fixtures/**`, `docs/examples/**`, `**/tests/**/*.md` — test fixtures / sample data consumed by code & tests (e.g. `examples/rfc-009/` dynamic-command pipeline fixtures)
- `.claude/**` — Claude Code agent / command / skill definitions (tooling config, not contributor prose)
- `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/actions/**/README.md` — GitHub UI templates & composite-action readmes
- `.archgate/lint/README.md` — archgate-linter tooling readme (the ADRs it enforces are linked above)
- `packages/*/README.md`, `packages/*/CHANGELOG.md` — npm-registry-facing package readmes / changelogs
- `examples/production-cron/README.md` — runnable example setup (lives with its scripts)
