# E2E Desktop Smoke Workflow

`.github/workflows/e2e-desktop.yml` runs a Playwright Electron smoke check
against a real Obsidian binary on macOS and Windows GitHub-hosted runners.

## When it runs

| Trigger | Notes |
| --- | --- |
| `pull_request` | Only when the PR carries the `e2e-desktop` label. Re-runs on `synchronize` and `reopened`. |
| `schedule` | Daily at 06:00 UTC against the default branch (`main`). |
| `workflow_dispatch` | Manual run from the Actions tab. |

The PR-label trigger is opt-in by design: regular PRs keep the existing
Docker-based `e2e-shard` matrix in `ci.yml` and don't pay the macOS/Windows
runner minutes. Apply the `e2e-desktop` label only when a change is likely
to affect desktop launch (Electron version bump, plugin manifest changes,
filesystem/path handling, etc.).

## Coverage

A single smoke spec runs per matrix cell:
`packages/obsidian-plugin/tests/e2e-desktop/specs/plugin-load.smoke.spec.ts`

It verifies:

1. The freshly built plugin payload (`main.js` + `manifest.json`) is
   present in the staged vault.
2. `Obsidian.exe` / `Obsidian.app` launches under Playwright Electron.
3. `window.app` plus `workspace` and `vault` become available.
4. `window.app.plugins.plugins.exocortex` is registered with a non-empty
   `manifest.version`.

Existing E2E coverage in `tests/e2e/` (the Docker shard suite) is
unchanged and unaffected by this workflow.

## Per-cell budget

Each matrix cell targets ≤5 minutes runtime; the job timeout is 10 minutes
as a hard cap. If runtime exceeds the soft target consistently, drop to a
single OS, narrow the spec, or cache the Obsidian install.

## Debugging

- Re-run via the Actions tab → **E2E Desktop Smoke** → **Run workflow**.
- On failure, the workflow uploads the Playwright HTML report and the
  `test-results-e2e-desktop/` directory (traces, screenshots, video) per
  OS as the `e2e-desktop-report-<os>` artifact.
- For local repro on macOS:
  ```sh
  cd packages/obsidian-plugin
  OBSIDIAN_PATH="/Applications/Obsidian.app/Contents/MacOS/Obsidian" \
    npx playwright test -c playwright-e2e-desktop.config.ts
  ```
  Make sure the plugin is built and copied into the smoke vault first
  (`npm run build` plus the `Stage plugin` step from the workflow, or
  invoke that block manually).

## Related

- `packages/obsidian-plugin/tests/e2e-desktop/test-vault/` — minimal vault
  used by the smoke spec; the plugin folder is populated by the workflow
  before launch.
- `packages/obsidian-plugin/playwright-e2e-desktop.config.ts` — Playwright
  config dedicated to this matrix.
- `.github/workflows/ci.yml` — Docker-based `e2e-shard` for the full E2E
  suite; remains the source of truth for E2E coverage.
