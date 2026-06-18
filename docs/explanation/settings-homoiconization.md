# Settings homoiconization (`exo__Setting`)

> onto-RFC `981b6070` Phase 5 · ExoSync Phase D (D2) · Homoiconicity Invariant `c78cc5c8` (VL#17 «настройки → ассеты»)

The plugin's user-configurable settings are first-class vault assets of
class `exo__Setting`. Each setting is one markdown file whose frontmatter
carries a key reference and a typed value:

```yaml
---
exo__Asset_uid: a6ccb161-b5b7-4660-ad25-685e4afab364
exo__Instance_class:
  - "[[88b938af-1a55-451c-b3cc-2f03e5115fcf]]" # exo__Setting
exo__Asset_label: "Setting: showArchivedAssets"
exo__Setting_key: "[[aa14f04c-0fc3-4d93-9f50-ea08e37d583d]]" # exo__SettingKeyShowArchivedAssets
exo__Setting_value: false
---
```

The schema of valid settings lives **in the graph**: 23 `exo__SettingKey`
individuals (shipped in the `exoas-exo` ontology submodule) each declare
their `exo__SettingKey_datatype` (`boolean` | `string` | `stringList`).
The TypeScript binding table
(`packages/obsidian-plugin/src/domain/settings/VaultSettingsRegistry.ts`)
is pinned to the graph by a parity unit test — adding a settings field
without deciding its homoiconization fails CI.

## Architecture: data.json as write-through mirror

- **Boot:** `loadSettings()` reads `data.json` exactly as before —
  instant, no flicker. Vault values overlay once `metadataCache` is
  fully resolved; because every change is mirrored back into
  `data.json`, the overlay is a no-op except after real cross-device
  drift.
- **Source of truth:** the vault asset, when it exists. A field without
  an asset falls back to `data.json` (migration period, deleted files).
- **UI writes:** every surface funnels through `saveSettings()`; changed
  homoiconizable fields are written to their assets (debounced,
  sequential, echo-suppressed).
- **Remote changes:** a watcher applies edits arriving via sync (or
  hand-editing the asset) to the live settings and runs the same
  side-effect hooks the Settings tab uses.

## One-shot migration

On the first resolved-scan that finds no asset for a registry key, the
plugin creates `exocortex-settings/<uid>.md` seeded with the current
`data.json` value and shows a Notice. Asset UIDs and basenames are fixed
constants, so independent migrations on two devices produce identical
paths and file-level sync converges instead of duplicating. Re-runs are
no-ops (per-key skip-existing). Migration is skipped while a profile
switch is in flight.

Assets are **discovered by class, not by folder** — you may move them
anywhere, including into a materialized AssetSpace mount
(`assetspaces/<owner>/<repo>/…`), where ExoSync Phase A syncs them like
any other asset with zero extra sync code.

## What is NOT homoiconized

| Field                                   | Why                                                 | Where it lives                          |
| --------------------------------------- | --------------------------------------------------- | --------------------------------------- |
| `activeProfileUid`, `_switchInProgress` | per-device state (Issue #3327)                      | `data.local.json`                       |
| GitHub PAT                              | secret                                              | `data.local.json` (`LocalSecretsStore`) |
| `displayNameSettings`, `logChannels`    | structural nested objects — deferred (onto-RFC D26) | `data.json`                             |

The migration iterates an explicit allowlist (the registry), so these can
never leak into vault assets regardless of what `data.json` contains.

## Field-specific semantics

- `lazyBootstrapFolders` — applied as `union(defaults, asset value)`
  without write-back, so a stale asset cannot shadow defaults added by
  future releases (anti-regression #3279).
- `excludedFolders` — normalised (trailing slash) before comparison and
  write.
- Both lists are snapshotted by indexer components at startup — changes
  (from UI or vault) take effect after an Obsidian reload, same as
  before.

## Known limitations

- **Sync-vs-UI race (vault wins):** if an ExoSync pull rewrites a
  setting asset in the same instant the user toggles it in the UI, the
  remote value can win. The window is sub-second (manual on-command
  sync × 1 s write debounce); acceptable for MVP.
- `exo__Setting_value` carries three datatypes under one property name —
  Obsidian's Properties UI assigns a single widget type per property
  name, so the property panel may show a type-mismatch hint on some
  setting files. Values remain correct; edit via the plugin settings tab
  or source mode.
