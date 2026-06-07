# Exocortex Documentation

Index of the `docs/` tree. Top-level project docs live in the repo root
([README.md](../README.md), [ARCHITECTURE.md](../ARCHITECTURE.md),
[VISION.md](../VISION.md)); package-specific docs live under
`packages/*/docs/`.

## Getting started

- [Getting-Started.md](Getting-Started.md) — install, first vault, core concepts
- [Plugin-Development-Guide.md](Plugin-Development-Guide.md) — building/extending the plugin
- [Troubleshooting.md](Troubleshooting.md) — common issues and fixes

## Reference

- [PROPERTY_SCHEMA.md](PROPERTY_SCHEMA.md) — full frontmatter property vocabulary
- [api/Core-API.md](api/Core-API.md) — `exocortex` core programmatic API
- [ONTOLOGY_EXTENSION.md](ONTOLOGY_EXTENSION.md) — adding classes/properties
- [WORKFLOW_CUSTOMIZATION.md](WORKFLOW_CUSTOMIZATION.md) — customizing status workflows
- [NL-TO-SPARQL.md](NL-TO-SPARQL.md) — natural-language → query translation

## Architecture & design

- [focus-profile.md](focus-profile.md) — FocusProfile pitch + 2-phase commit safety model
- [profiles.md](profiles.md) — KnowledgeProfile / hard-switch design
- [rdf/ExoRDF-Mapping.md](rdf/ExoRDF-Mapping.md) — vault ↔ RDF triple mapping
- [CROSS_RUNTIME_PARITY.md](CROSS_RUNTIME_PARITY.md) — validator-specific instance of the UI/CLI Parity Invariant (see [VISION.md](../VISION.md#uicli-parity-invariant))
- [SHACL_LITE_MAPPING.md](SHACL_LITE_MAPPING.md) — SHACL-lite shape mapping
- `diagrams/` — Mermaid architecture diagrams (`architecture-overview.mmd`, `asset-creation-flow.mmd`, `command-execution-flow.mmd`, `layout-rendering.mmd`, `property-inheritance.mmd`, `service-dependencies.mmd`, `status-workflow.mmd`, `future-architecture.mmd`)

## Testing & CI

- [TEST-PYRAMID.md](TEST-PYRAMID.md) — test strategy and layers
- [FLAKY_POLICY.md](FLAKY_POLICY.md) — flaky-test handling policy
- [e2e-desktop.md](e2e-desktop.md) — desktop E2E setup
- [fixture-access.md](fixture-access.md) — test fixture access patterns
- [Performance-Guide.md](Performance-Guide.md) — performance guidance

## Contributing

- [AI-DEVELOPMENT-PATTERNS.md](AI-DEVELOPMENT-PATTERNS.md) — patterns for AI-agent contributors

## Operational runbooks

- [ROLLBACK_EXOQL_EVAL.md](ROLLBACK_EXOQL_EVAL.md) — revert procedure for the ExoQL eval-config rollout (referenced by runtime config; kept active)

## Archive — `history/`

Point-in-time artifacts from completed work (CI-speedup program, RFC-CI-tests
suite, Phase-3 stabilization, dated RFC working docs). Kept for provenance, not
active guidance:

- [history/ROLLBACK_CI_SPEEDUP.md](history/ROLLBACK_CI_SPEEDUP.md), [history/ROLLBACK_RFC_CI_TESTS.md](history/ROLLBACK_RFC_CI_TESTS.md) — rollback runbooks for completed CI migrations
- [history/CI_SPEEDUP_PHASE3_EXIT_ANALYSIS.md](history/CI_SPEEDUP_PHASE3_EXIT_ANALYSIS.md), [history/PHASE3_DASHBOARD_README.md](history/PHASE3_DASHBOARD_README.md), [history/PHASE3_QUARANTINE_POLICY.md](history/PHASE3_QUARANTINE_POLICY.md), [history/PHASE3_RETRY_POLICY.md](history/PHASE3_RETRY_POLICY.md) — Phase-3 CI stabilization records
- [history/REGRESSION_T1.6_PHASE1_POST_MERGE.md](history/REGRESSION_T1.6_PHASE1_POST_MERGE.md), [history/ROLLBACK_X11_STABILIZATION.md](history/ROLLBACK_X11_STABILIZATION.md) — one-off incident records
- [history/rfc-ci-button-testing-2026-04-20.md](history/rfc-ci-button-testing-2026-04-20.md), [history/shacl-cli-design.md](history/shacl-cli-design.md), [history/T1.5-grounding-audit.md](history/T1.5-grounding-audit.md), [history/phase-0-prototype-report-2026-04-20.md](history/phase-0-prototype-report-2026-04-20.md) — dated RFC working docs

## Fixtures & data (consumed by code/tests — not human docs)

- `examples/rfc-009/` — dynamic-command pipeline fixtures (referenced by `packages/cli/README.md` and unit tests)
- `rfc-94e520da/starter-kit-grounding-status.json` — grounding-audit data (read by `scripts/audit-starter-kit-groundings.mjs`)

## Package documentation

Some docs live alongside their package rather than in this top-level tree. They
are listed here for discoverability. The process/historical ones below are kept
in place (not archived) because CI workflows, scripts, and tests reference them
by path.

### CLI — `packages/cli/docs/`

- [CLI_API_REFERENCE.md](../packages/cli/docs/CLI_API_REFERENCE.md) — full command/flag reference
- [ONTOLOGY_REFERENCE.md](../packages/cli/docs/ONTOLOGY_REFERENCE.md) — ontology reference for CLI users
- [SPARQL_GUIDE.md](../packages/cli/docs/SPARQL_GUIDE.md), [SPARQL_COOKBOOK.md](../packages/cli/docs/SPARQL_COOKBOOK.md) — querying from the CLI
- [RCA_DYNCOMMAND_SHOW_VS_EXEC.md](../packages/cli/docs/RCA_DYNCOMMAND_SHOW_VS_EXEC.md) — _(process)_ root-cause analysis, referenced by the CLI README
- [SUNSET_LEGACY_COMMAND_START.md](../packages/cli/docs/SUNSET_LEGACY_COMMAND_START.md) — _(process)_ sunset checklist for legacy `command start`

### Obsidian plugin — `packages/obsidian-plugin/docs/`

- [EXO_LAYOUT.md](../packages/obsidian-plugin/docs/EXO_LAYOUT.md) — layout engine
- [RELATION_COLUMN_SET.md](../packages/obsidian-plugin/docs/RELATION_COLUMN_SET.md) — relation column sets
- [TESTING.md](../packages/obsidian-plugin/docs/TESTING.md) — plugin testing guide
- [release-checklist-mobile.md](../packages/obsidian-plugin/docs/release-checklist-mobile.md) — mobile release checklist
- [FLAKY_DASHBOARD.md](../packages/obsidian-plugin/docs/FLAKY_DASHBOARD.md) — flaky-test dashboard (drives `flaky-aggregate`/`flaky-render-markdown` scripts)
- `phase3/` — _(historical)_ Phase-3 CI/X11 stabilization ADR + spikes. Completed program; the [ADR](../packages/obsidian-plugin/docs/phase3/ADR_FLAKY_X11_STRATEGY.md) is referenced by `docker-entrypoint-e2e.sh` and `ci.yml`, so the folder is kept in place.

### Core engine — `packages/exocortex/docs/`

- [NL-TO-SPARQL.md](../packages/exocortex/docs/NL-TO-SPARQL.md) — engine internals for NL→SPARQL (distinct from the user-facing [NL-TO-SPARQL.md](NL-TO-SPARQL.md) above)
