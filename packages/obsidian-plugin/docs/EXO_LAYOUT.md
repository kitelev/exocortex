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
  (convention — UUID target ⇒ alias wins)

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

## Installing the `exo__Layout` ontology

The 18 `exo__Layout` ontology assets (4 classes + 14 properties) are **not
auto-installed** by the plugin (see #3125 — TBox distribution is user
responsibility). Install them yourself via one of:

- Run **Cmd/Ctrl+P → "Exocortex: Add assetspace by URL"** with
  `https://github.com/kitelev/exoas-exo` to clone the `exo/` ontology into
  your vault (any folder — plugin reads by UUID, not by path).
- Or wire the `kitelev/exocortex-exo-ontology` repo under
  `assetspaces/exo/` per RFC-D vault layout.

If the ontology is absent the plugin loads without error; Layout-based
rendering falls back to the default Asset Relations table. Layouts that
reference unknown ontology classes will log `unknown block class`
warnings in the console.
