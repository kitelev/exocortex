# `setup-node-pnpm` composite action

Shared setup for every Node-based job in `ci.yml`. Centralises repeated boilerplate (checkout, `setup-node`, `npm ci`, optional build) and adds a `node_modules` cache that skips `npm ci` on exact-lockfile hits.

> The directory name retains the historical `setup-node-pnpm` label introduced in the Phase 3 project brief. This repository uses `npm` (not `pnpm`) — the action name is a naming legacy only.

## Inputs

| Input             | Default   | Description                                                                                                                                                                                                                                   |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-version`    | `"22"`    | Node.js major version to install via `actions/setup-node@v4`.                                                                                                                                                                                 |
| `run-build`       | `"false"` | When `"true"`, runs `npm run build` after dependency install. Required for `build`, `test-component`, `performance-tests`.                                                                                                                    |
| `cache-key-extra` | `""`      | Suffix appended to the `node_modules` cache key. Use this to segregate caches produced inside different container images (e.g. `playwright-jammy`) so the restore step never unpacks native modules compiled against a different glibc / ABI. |

All inputs are strings — GitHub composite actions do not support boolean inputs.

## Checkout is the caller's responsibility

Local composite actions (referenced via `uses: ./.github/actions/<name>`) require the calling job to have already run `actions/checkout` — the runner needs `action.yml` on disk before it can resolve the reference. Each job therefore performs its own `actions/checkout@v6` step with the appropriate `submodules` mode before invoking this action. Submodule handling is deliberately kept in the job definition so recursive-vs-shallow decisions remain visible and reviewable at the call site.

## Steps performed

1. `actions/setup-node@v4` with `cache: "npm"` (primes `~/.npm` download cache).
2. `actions/cache@v4` over the root `node_modules` and every workspace's `node_modules`, keyed on `package-lock.json` hash + OS + Node version + optional discriminator.
3. Conditional `npm ci --prefer-offline --no-audit --no-fund` on cache miss.
4. On cache hit: a sanity check that verifies `node_modules/.package-lock.json` exists, falling back to `npm ci` if the restored tree looks corrupted.
5. Conditional `npm run build` when `run-build: "true"`.

## Example usage

```yaml
jobs:
  my-job:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.57.0-jammy
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          submodules: recursive

      - name: Setup Node & install deps
        uses: ./.github/actions/setup-node-pnpm
        with:
          run-build: "true"
          cache-key-extra: "playwright-jammy"

      - name: Run tests
        run: npm run test:something
```

## Cache key strategy

```
<runner.os>-nm-node<node-version>-<hashFiles(package-lock.json)>[-<cache-key-extra>]
```

**Exact-match only** — no `restore-keys`. A partial match would risk unpacking a stale dependency tree that doesn't match the current lockfile; skipping `npm ci` in that state would leave the job with subtly wrong modules. When the lockfile changes, the cache misses and `npm ci` runs fresh; the new tree is then persisted for subsequent runs with the same lockfile.

The optional `cache-key-extra` input lets container-based jobs isolate their cache from host-runner jobs that share the same lockfile. For example, both `test-unit` (playwright container) and `test-coverage-shard` (bare `ubuntu-latest`) see the same `hashFiles('package-lock.json')`, but they should not share a `node_modules` cache because native modules (`better-sqlite3`, etc.) may have been compiled against different glibc versions. Containerised jobs pass `cache-key-extra: "playwright-jammy"`; bare-runner jobs omit the input.

## Why no `pnpm`?

The action name was fixed by the Phase 3 project brief (§4 naming). The repository itself runs on `npm` workspaces with `packages/exoas-*` (submodule fixture packages) negated via `package.json`'s `workspaces` field. The action is named after its brief role — "the shared setup we'd reach for regardless of package manager" — rather than the tool it invokes.

## Jobs that use this action

As of this PR (Phase 3 task `44b3219a`):

| Job                       | checkout submodules | run-build | cache-key-extra      |
| ------------------------- | ------------------- | --------- | -------------------- |
| `build`                   | none                | `"true"`  |                      |
| `typecheck`               | none                |           |                      |
| `lint`                    | none                |           |                      |
| `test-ui`                 | `recursive`         |           | `"playwright-jammy"` |
| `test-coverage-shard`     | `recursive`         |           |                      |
| `test-coverage-cli`       | `recursive`         |           |                      |
| `test-coverage-exocortex` | `recursive`         |           |                      |
| `test-coverage`           | none                |           |                      |
| `test-bdd`                | none                |           |                      |
| `test-component`          | none                | `"true"`  | `"playwright-jammy"` |
| `performance-tests`       | none                | `"true"`  | `"playwright-jammy"` |

Jobs that deliberately do **not** use the composite:

- `docs-link-check` — uses a third-party link-check action, not Node.
- `docs-property-validation` — `setup-node` only, no `npm ci` required.
- `archgate` — has its own `~/.archgate` cache and uses `npm install -g`, not `npm ci`.
- `e2e-shard` — no Node setup in the runner; tests run inside a pre-built Docker image.
- `e2e-tests` — minimal `setup-node` + a one-off `npm install -D @playwright/test`, no full lockfile install.
