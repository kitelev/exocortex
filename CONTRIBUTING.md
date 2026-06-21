# Contributing to Exocortex

Thanks for your interest! Exocortex is an open-source semantic knowledge-management
system (Obsidian plugin + CLI + TypeScript core). It is developed **primarily by AI
coding agents** (Claude Code, GitHub Copilot, …) following documented patterns —
**human contributions are very welcome too.**

This page is the on-ramp. It links to the deeper guides rather than duplicating them.

## Ways to contribute

- **Report a bug** → [open a Bug report](https://github.com/kitelev/exocortex/issues/new?template=bug_report.md). Include your plugin version, Obsidian version, and the relevant lines of `exocortex-logs.txt` (vault root).
- **Request a feature** → [open a Feature request](https://github.com/kitelev/exocortex/issues/new?template=feature_request.md).
- **Improve docs** → docs PRs are first-class. See the [documentation index](docs/README.md).
- **Submit code** → read the workflow below first.

## Development setup

```bash
git clone https://github.com/kitelev/exocortex
cd exocortex
git submodule update --init --recursive   # hydrates the exoas-exo / exoas-exocmd data submodules
npm install
npm run build
npm run test:all
```

- The repo is a monorepo (npm workspaces): `packages/core` (core), `packages/obsidian-plugin`, `packages/cli`, `packages/services`, `packages/test-utils`. See [ARCHITECTURE.md](ARCHITECTURE.md).
- `packages/exoas-exo` / `packages/exoas-exocmd` are **public data submodules** (ontology assets), not code packages — no auth token needed.

## Pull-request workflow

1. **Branch** from `main` (never commit to `main` directly).
2. **Make the change** in a focused, single-purpose PR.
3. **Run `npm run test:all`** locally before pushing — this is mandatory.
4. **Open a PR** with a clear, user-facing title/body (the title flows into the auto-generated release notes).
5. **CI must pass** — all required checks are green. The current set is listed in [docs/reference/ci/required-checks.md](docs/reference/ci/required-checks.md) (source of truth: `gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks`).
6. **Squash-merge** once approved and green (`gh pr merge --squash`). Rebase merges are not used.

A task is **not complete** until: CI green + PR merged + the Auto Release workflow succeeds.

## Coding standards

- **Clean Architecture** — keep domain/engine logic in the platform-agnostic `exocortex` core; the plugin and CLI are thin adapters behind ports (`IVaultAdapter` / `IFileSystemAdapter`). New features land in the core first, then get thin bindings in **both** clients — this is the **UI/CLI Parity Invariant** (see [VISION.md](VISION.md#uicli-parity-invariant)).
- **Homoiconicity** — user-configurable semantics (commands, workflows, layouts, settings) belong in the vault as RDF assets, not hardcoded in TypeScript (see [VISION.md](VISION.md) and `CLAUDE.md`).
- **Desktop ↔ Mobile parity** — every plugin command must work on both desktop and mobile; do not gate commands desktop-only (use `vault.adapter` / REST instead of Node `fs` / git where needed).
- Patterns and gotchas live in [PATTERNS.md](PATTERNS.md); testing guidance in [TESTING.md](TESTING.md).

## Working as / with AI agents

This project optimizes for AI-agent contributors. The detailed agent workflow
(worktrees, post-mortems, coordination) lives in:

- **[AGENTS.md](AGENTS.md)** — universal AI-agent instructions.
- **[CLAUDE.md](CLAUDE.md)** — Claude Code-specific in-repo guidance.

Human contributors can ignore the agent-specific tooling and follow the PR workflow above.

## Reporting security issues

Please do **not** open a public issue for security problems — see [SECURITY.md](SECURITY.md).

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
