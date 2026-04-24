# `exo__Layout` — RDF-configurable layout blocks (zero codeblock)

`exo__Layout` lets you declare, directly in the vault, the entire body
structure of a note whose class you own. Instead of writing a
`dataviewjs` / `exo-layout` codeblock inside every `period__Week` note (or
every `ems__Project`, or every `ems__Area`), you publish **one** Layout
asset that targets the class, reference a handful of **Block** assets, and
the plugin renders the declared blocks in the declared order on every
note of that class — no per-note plumbing required.

Layouts and blocks live as regular vault files with `exo__Layout` or an
`exo__*Block` subclass in `exo__Instance_class`. The plugin's
`ExoLayoutRepository` indexes them at load (single vault scan, 150 ms
debounce, double-buffered snapshot reads) and `UniversalLayoutRenderer`
consults the `LayoutSelector` on every note render. If a Layout is
selected, the default Asset Relations table is replaced by the declared
blocks; if no Layout matches, everything falls back to the legacy
Asset Relations rendering — the feature is purely additive.

## Feature flag

`ExocortexSettings.enableExoLayoutRenderer` gates consumption of the
resolver by the renderer. Defaults:

- `true` on new installs.
- Toggling to `false` reverts every note to the legacy Asset Relations
  rendering, even if a matching Layout exists — useful for bisecting a
  regression or A/B-ing the new experience against the legacy one.

The toggle is live in the Settings tab; no plugin reload required.

## Quickstart — `period__Week` with backlinks columns for `ems__WeeklyObjective`

The motivating scenario: you want every `period__Week` note to show a
single table of its backlinking `ems__WeeklyObjective` rows, with exactly
two columns (`exo__Asset_createdAt` and `exo__Asset_label`) — **not** the
default `Name` + `Instance Class` columns produced by Asset Relations, and
**not** wrapped in the default "Asset Relations" heading.

Create **two files anywhere in your vault** (folder and basename are
irrelevant — discovery is by `exo__Instance_class`):

### File 1 — the Layout asset

```yaml
---
exo__Asset_uid: 0b8af5f8-7a9f-4f24-9e80-3d8de32f8b3b
exo__Asset_label: "period__Week layout"
exo__Instance_class:
  - "[[exo__Layout]]"
exo__Layout_targetClass: "[[period__Week]]"
exo__Layout_blocks:
  - "[[c1c9b3cd-7f42-4f5a-9a0a-9d3e0f9c6b11]]"
exo__Layout_priority: 0
exo__Layout_coexistsWithDefault: false
---
```

### File 2 — the `exo__BacklinksTableBlock` referenced by the Layout

```yaml
---
exo__Asset_uid: c1c9b3cd-7f42-4f5a-9a0a-9d3e0f9c6b11
exo__Asset_label: "Weekly Objectives (for period__Week)"
exo__Instance_class:
  - "[[exo__BacklinksTableBlock]]"
exo__LayoutBlock_title: "Weekly Objectives"
exo__BacklinksTableBlock_rowClass: "[[ems__WeeklyObjective]]"
exo__BacklinksTableBlock_referencingProperty: "[[ems__WeeklyObjective__week]]"
exo__BacklinksTableBlock_columns:
  - "[[exo__Asset_createdAt]]"
  - "[[exo__Asset_label]]"
exo__BacklinksTableBlock_sortOrder: "asc"
---
```

Open any `period__Week` note. You should see a single `<h3>Weekly
Objectives</h3>` followed by a two-column table with each
`ems__WeeklyObjective` whose `ems__WeeklyObjective__week` points to the
open week. Nothing else — no `Name`, no `Instance Class`, no "Asset
Relations" heading.

The columns render in the declared order, left-to-right. Every
`exo__*Block_*` field is validated on parse with a `log.warn` on malformed
input — invalid blocks are skipped by the layout render loop without
throwing, so one typo never brings the whole page down.

## Block types reference (MVP)

Two block kinds ship in this MVP. Their discriminator is the
`exo__Instance_class` wikilink on the block asset itself.

### `exo__PropertiesBlock`

Renders the open note's own frontmatter as a two-column properties table.

| Field                        | Required | Notes                                                                                            |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `exo__Asset_uid`             | yes      | Block uid referenced from `exo__Layout_blocks`.                                                  |
| `exo__Instance_class`        | yes      | Must contain `[[exo__PropertiesBlock]]` (plain or UUID).                                         |
| `exo__LayoutBlock_title`     | no       | `<h3>` shown above the table. Falls back to `exo__Asset_label`, then to the block file basename. |
| `exo__LayoutBlock_collapsed` | no       | Reserved for a future "collapsed by default" UX — not yet consulted by the renderer.             |

### `exo__BacklinksTableBlock`

Renders a filtered, sorted table of backlinks — the block equivalent of
the default Asset Relations section, but scoped to a single
`(rowClass, referencingProperty)` pair and with explicit columns.

| Field                                          | Required | Notes                                                                                           |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `exo__Asset_uid`                               | yes      | Block uid.                                                                                      |
| `exo__Instance_class`                          | yes      | Must contain `[[exo__BacklinksTableBlock]]`.                                                    |
| `exo__BacklinksTableBlock_rowClass`            | yes      | Wikilink; only backlinks whose `exo__Instance_class` matches are included.                      |
| `exo__BacklinksTableBlock_referencingProperty` | yes      | Wikilink; only backlinks whose referencing frontmatter property equals this are included.       |
| `exo__BacklinksTableBlock_columns`             | yes      | Array of wikilinks or bare identifiers. Each is normalised to a property name before rendering. |
| `exo__BacklinksTableBlock_sortBy`              | no       | Column to sort by; defaults to `exo__Asset_label`.                                              |
| `exo__BacklinksTableBlock_sortOrder`           | no       | `"asc"` (default) or `"desc"`.                                                                  |
| `exo__BacklinksTableBlock_limit`               | no       | Positive integer cap on visible rows; omit for unlimited.                                       |
| `exo__BacklinksTableBlock_showArchived`        | no       | `false` by default; set `true` to include rows with `archived: true`.                           |

### Wikilink forms — canonical normalization

Every wikilink field is normalised through `WikiLinkHelpers.normalize`
before the resolver or the renderer touches it. All four frontmatter
forms below are equivalent:

- `exo__BacklinksTableBlock` (bare identifier)
- `[[exo__BacklinksTableBlock]]` (plain wikilink — recommended)
- `[[exo__BacklinksTableBlock|Backlinks table]]` (non-UUID target ⇒
  target wins, alias display-only)
- `[[2e868956-d81e-43fd-9817-1addde9cb311|exo__BacklinksTableBlock]]`
  (starter-kit convention — UUID target ⇒ alias wins)

Row-side `exo__Instance_class` values are normalised under the same
rules, so a block parsed in any form matches a row in any form — no
pipe-order mirroring needed. The `columns` array receives the same
normalization: every entry is reduced to a bare property name before
the React renderer looks it up against the row frontmatter (e.g.
`[[exo__Asset_createdAt]]` → `exo__Asset_createdAt`).

## Priority ladder

When more than one Layout asset targets the same class, the resolver
picks a single winner.

| Step | Rule                                                                                       |
| ---- | ------------------------------------------------------------------------------------------ |
| 1    | Walk `exo__Instance_class` of the open note in declaration order; stop at the first match. |
| 2    | Among matches for the winning class, pick the highest `exo__Layout_priority`.              |
| 3    | Tiebreaker — `exo__Asset_uid` ascending.                                                   |
| 4    | Nothing matched — fall back to the default Asset Relations rendering.                      |

Declaration order of classes in `exo__Instance_class` matters: the
selector walks classes in that order, and the first class to produce a
non-null match wins. This lets you declare a specific class
(`ems__Daily`) ahead of a more generic one (`ems__Effort`) on a note and
get the specific-first behaviour without writing priority arithmetic.

## Coexistence with the default Asset Relations table

`exo__Layout_coexistsWithDefault` decides whether the plugin still emits
the legacy Asset Relations section **in addition** to the Layout blocks.

- `false` (default) — the Layout replaces Asset Relations entirely. Use
  this when your Layout already contains a
  `exo__BacklinksTableBlock` (or several) and the default heading +
  grouped table would be redundant.
- `true` — the Layout blocks render first, and the default Asset
  Relations section appears below them. Use this when the Layout only
  adds new blocks (e.g. a `PropertiesBlock` for pinned metadata) and
  you still want the class-wide Asset Relations table below.

## Coexistence with `ui__RelationColumnSet`

Both features live side-by-side and never fight:

- `exo__Layout` (this page) owns the **body structure** of a note —
  which blocks render, in what order, with what columns.
- `ui__RelationColumnSet` (see `RELATION_COLUMN_SET.md`) customises the
  **column map of the default Asset Relations table**, which only
  renders when `coexistsWithDefault: true` **or** when no Layout
  matches the open note's class at all.

So if a note has both a matching Layout and matching RelationColumnSet
configs:

- `coexistsWithDefault: false` → Layout wins; RelationColumnSet is not
  consulted (Asset Relations not rendered at all).
- `coexistsWithDefault: true` → Layout blocks render first, then the
  default Asset Relations table renders below with columns picked by
  RelationColumnSet's resolver (same ladder as always).

## Troubleshooting

`log.warn` messages emitted by the pipeline, listed in the order they
can appear:

- `Layout: exo__Asset_uid missing at <path>` — every Layout needs a
  UUID. Regenerate one or paste from an existing working asset.
- `Layout <uid>: exo__Layout_targetClass required (<path>)` — add the
  class wikilink you want this Layout to render for.
- `Layout <uid>: exo__Layout_blocks must contain at least one block (<path>)` —
  the blocks array was empty or absent. Reference at least one block
  asset; bare identifiers and wikilinks both work.
- `LayoutBlock: exo__Asset_uid missing at <path>` — same rule as Layout.
- `BacklinksTableBlock <uid>: rowClass and referencingProperty required (<path>)` —
  both fields are mandatory for the block filter to match anything.
- `LayoutBlock <uid>: unknown block class at <path> — expected exo__PropertiesBlock or exo__BacklinksTableBlock` —
  the block asset's `exo__Instance_class` is neither MVP variant;
  extend the plugin or fix the class reference.
- `ExoLayoutRenderer: block "<ref>" not found (layout=<uid>, file=<path>)` —
  the layout references a block that the repository never indexed. The
  other blocks still render; fix the reference or the block asset.
- `ExoLayoutRepository: duplicate exo__Asset_uid <uid> (<path>); keeping first-seen` —
  two files share a UUID. Change one of them.

If an open note renders the default Asset Relations table when you
expected a Layout, check:

1. `enableExoLayoutRenderer` is `true` in Settings → Exocortex.
2. The note's `exo__Instance_class` contains the class targeted by the
   Layout (exact wikilink match after normalisation).
3. The console does not show any `log.warn` for the Layout or its
   blocks — a single parse failure blanks the whole Layout (the
   selector returns `null`).
4. The Layout file itself is inside the vault (the repository subscribes
   to `vault` events, not `metadataCache`-synthesised ones).

## Bootstrap (auto-installed ontology)

Since RFC exo**Layout Phase 4 shipped, the plugin auto-installs the 18
`exo**Layout`ontology assets (4 classes + 14 properties) into a hidden`\_exocortex-exo-layout-ontology/` folder on first load. Without these
assets, Layout and Block wikilinks would dangle and nothing would render.
The install is **idempotent and UID-aware**:

- If any of the 18 UUIDs are already present anywhere in the vault (e.g.
  you imported the starter-kit `exo/` folder manually), the bootstrap
  skips them — no duplicates.
- If the hidden folder already has the files (second plugin load), nothing
  is written.
- If only a subset is present, only the missing files are created.

**Troubleshooting bootstrap:**

- `exocortex:ExoLayoutOntologyBootstrapper: installed N ontology file(s)`
  in the console — normal on first load (N ≤ 18).
- `exocortex:ExoLayoutOntologyBootstrapper: failed to install <path>: <err>` —
  a single write failed (e.g. the folder was momentarily locked). The
  bootstrap continues with the remaining files; re-open the vault to
  retry.
- `exocortex:ExoLayoutOntologyBootstrapper: bootstrap failed: <err>` — an
  unexpected error aborted the whole run. The plugin still loads; Layouts
  that reference the missing ontology classes will log `unknown block
class` warnings. Copy the 18 files from
  `kitelev/exocortex-starter-kit/exo/` manually as a workaround.
- If the `_exocortex-exo-layout-ontology/` folder clutters your file
  explorer, hide dot-files / underscore-prefixed folders in Obsidian's
  Files & Links settings.
- **Do not edit** the 18 auto-installed files in place — the plugin
  treats them as an ontology source-of-truth. If you want to customise
  (e.g. add a new `aliases` entry), copy the file to a non-hidden folder
  and delete the original; the UID-aware bootstrap will then honour your
  copy and never regenerate the underscore-folder version.

## Migrating from `ui__RelationColumnSet`

The CLI ships with an opt-in migration helper
(`exocortex migrate-relcolset-to-exolayout`) that scans a vault for
existing `ui__RelationColumnSet` configs and generates a starting-point
`exo__Layout` + `exo__BacklinksTableBlock` pair per config.

```bash
# Dry-run — prints YAML previews + warnings to stderr (nothing written)
exocortex migrate-relcolset-to-exolayout --vault /path/to/vault

# Apply — writes pairs to vault (default: exo-layout-migrated/)
exocortex migrate-relcolset-to-exolayout --vault /path/to/vault --apply

# JSON report
exocortex migrate-relcolset-to-exolayout --vault /path/to/vault --json
```

**Semantic gap — read before applying:**

- `ui__RelationColumnSet` is **additive** (extends `Name` + `Instance Class`
  columns). `exo__BacklinksTableBlock` is **replacing** (renders only the
  configured columns). The generated block will look different from the
  original RelationColumnSet rendering by default.
- `exo__Layout.targetClass` is the **page class** the layout renders on.
  `ui__RelationColumnSet.targetClass` is the **row class** filtered in the
  relations table. The migration cannot infer the former from the latter
  and inserts a placeholder — review every generated Layout before
  applying in production, and fix the `exo__Layout_targetClass` wikilink
  to the class of the page you want the layout on.
- The generated files carry `exo__Layout_coexistsWithDefault: true` so
  the migrated block renders **in addition to** the legacy Asset
  Relations table. Set to `false` once you are happy to remove the
  legacy rendering.

The command is non-destructive in apply mode — it writes new files and
never edits or removes the source `ui__RelationColumnSet` assets. Delete
the RelationColumnSet configs manually once you've verified the migrated
Layouts.

**Idempotency.** Generated UIDs are **deterministic** (SHA-1 of source UID

- suffix). Re-running `--apply` against the same vault produces identical
  Layout+Block UIDs and contents — so the second run is a no-op at the
  filesystem level rather than creating a duplicate set of migrated files.
  This matches the plugin ontology bootstrap (UID-aware) and avoids the
  duplicate-assets footgun that would otherwise trip power-users.
