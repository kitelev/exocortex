# Starter-Kit Fixture Access

Strategy for exposing `exocortex-starter-kit` assets (ontology files, user journeys, Commands) to tests in this repo.

## Current strategy: git submodule (Phase 1 pilot, RFC §3.4)

Starter-kit is wired as a git submodule at `packages/starter-kit-fixtures`, tracking `kitelev/exocortex-starter-kit` main.

### Consumer workflow

```bash
# Clone or update
git clone <exocortex repo>
cd exocortex
git submodule update --init --recursive

# Pull latest main + refresh submodule
git pull
git submodule update --remote --merge packages/starter-kit-fixtures
```

### CI integration

Jobs that read fixtures add `submodules: recursive` to `actions/checkout@v6`:

- `test-unit` — unit tests consuming starter-kit assets (Phase 1+)
- `test-coverage` — same test surface as `test-unit`, measured with coverage wrapper
- `e2e-shard` — test-vault seeding from starter-kit (Phase 1+, see note below)

### npm workspaces isolation

Root `package.json` excludes the submodule via a negation glob:

```json
"workspaces": [
  "packages/*",
  "!packages/starter-kit-fixtures"
]
```

This is required because `exocortex-starter-kit/package.json` exists (it has its own `test` / `test:journeys` / `check:invariants` scripts). Without the exclusion, `npm ci` would try to resolve starter-kit as a fourth monorepo workspace and fail on dependency resolution (starter-kit devDeps include a specific `@kitelev/exocortex-cli` version, which would conflict with the CLI workspace).

## Known limitations

### Docker E2E image (e2e-shard)

`packages/obsidian-plugin/Dockerfile.e2e` uses selective `COPY` directives — it does not copy `packages/starter-kit-fixtures/`. Adding `submodules: recursive` to the `e2e-shard` checkout step makes the submodule present on the runner filesystem, but the contents do not reach the Docker container yet.

This is intentional for Phase 1 Gate 0 (wiring, not consumption). Downstream Phase 1 tasks (test-vault seeding in `e2e-shard`) will either:

1. Add `COPY packages/starter-kit-fixtures/exocmd ./packages/starter-kit-fixtures/exocmd` to `Dockerfile.e2e`, or
2. Pre-seed the test-vault inside the CI job before `docker run` (volume-mount).

## Fallback: npm package (`@kitelev/exocortex-starter-kit`)

Alternative strategy considered per RFC §3.4 — publish starter-kit to npm and consume via `devDependencies`.

### Pros

- No submodule-per-worktree hydration step (contributors run `npm install` only).
- npm cache in GHA is already configured (`setup-node` with `cache: "npm"`).
- No multi-agent write contention on a submodule pointer.

### Cons

- Requires publish infrastructure in starter-kit repo (`npm publish` in `auto-release.yml` + `files: ["exocmd/**", "ems/**", "ims/**"]`).
- Version pinning via `package.json` loses the "always consume main" property that the submodule provides via `--remote`.
- Slightly slower iteration loop for cross-repo refactors (publish + wait + bump vs. commit + bump-SHA).

## Fallback trigger criteria (RFC §3.4 decision rule)

Switch from submodule to npm package **before Phase 2** if any of the following surfaces:

1. **Submodule friction ≥ 3 contributor incidents** — e.g. "I forgot `git submodule update`", "my worktree has stale fixtures", "submodule clone failed behind corporate proxy", etc. Counted across humans and AI agents.
2. **Parallel-agent conflicts ≥ 2 times** — two concurrent Claude/Copilot/Codex sessions both bump the submodule pointer in overlapping PRs and produce merge conflicts in `.gitmodules` or in the submodule SHA reference.

Counter is maintained in the Phase 1 retrospective. Review at **end-of-week Phase 1** (tracked in orchestrator project `9b4f1f59-d771-4c1b-b8e4-feb06984c06c`).

If fallback triggers, the migration is:

1. Publish `@kitelev/exocortex-starter-kit` from starter-kit repo (publish-on-merge or on-tag).
2. Add `"@kitelev/exocortex-starter-kit": "^X.Y.Z"` to this repo's `package.json` devDependencies.
3. Remove submodule:
   ```bash
   git rm packages/starter-kit-fixtures
   git config -f .gitmodules --remove-section submodule.packages/starter-kit-fixtures
   rm -rf .git/modules/packages/starter-kit-fixtures
   # Commit the deletion
   ```
4. Remove `!packages/starter-kit-fixtures` from root `package.json` workspaces.
5. Update test helpers: replace `packages/starter-kit-fixtures/exocmd/` paths with `node_modules/@kitelev/exocortex-starter-kit/exocmd/`.
6. Drop `submodules: recursive` from `ci.yml` checkout steps.
7. Revert README onboarding section.

## Cross-package refactor ordering (RFC §3.4)

When the plugin's `GroundingExecutor` API changes and breaks the starter-kit command contract:

1. Land the starter-kit fixture update first (behind a feature flag or a new command-category tag).
2. In this repo, bump the submodule pointer (`git submodule update --remote packages/starter-kit-fixtures && git commit`) concurrently with the plugin PR.
3. For release-sensitive work, pin the submodule to a starter-kit tag rather than main:
   ```bash
   cd packages/starter-kit-fixtures
   git fetch --tags
   git checkout v<X.Y.Z>
   cd ../..
   git add packages/starter-kit-fixtures
   git commit -m "chore: pin starter-kit-fixtures to v<X.Y.Z>"
   ```

## References

- RFC §3.1 — strategy comparison (submodule vs npm)
- RFC §3.4 — developer workflow impact + decision rule (this page operationalises it)
- RFC §8.1 — CI workflow integration plan
- Task `27260d2d-7bf3-40cf-9467-a4cad0b98d55` — Phase 1 Gate 0 wiring
