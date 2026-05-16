# `ui__RelationColumnSet` — RDF-configurable backlinks columns

> **Consider `exo__Layout` for full body control.** `ui__RelationColumnSet`
> is **additive** — it extends the hardcoded `Name` + `Instance Class`
> columns of the default Asset Relations table. If you want to _replace_
> those columns, remove the table's `Asset Relations` wrapper, or build a
> standalone body composed of multiple typed blocks, see
> [`EXO_LAYOUT.md`](./EXO_LAYOUT.md). The CLI helper
> `exocortex migrate-relcolset-to-exolayout` generates a starting-point
> `exo__Layout` + `exo__BacklinksTableBlock` pair from each existing
> RelationColumnSet — read the "Migrating from `ui__RelationColumnSet`"
> section of `EXO_LAYOUT.md` for the semantic gaps the tool cannot bridge
> automatically.

`ui__RelationColumnSet` lets you declare, directly in the vault, which
properties should appear as columns in the UniversalLayout auto-backlinks
table for a given (rowClass, referencingProperty) pair. Previously this map
was hardcoded in `RelationsRenderer.ts`; now it is driven by RDF, so new
semantic cases can be shipped without touching plugin source.

The resolver is wired automatically on plugin load and is gated by the
`enableRelationColumnSetResolver` setting (default `true`). When the flag is
off, or no matching config exists, the renderer transparently falls back to
the original hardcoded map — the feature is purely additive and opt-in per
(rowClass, referencingProperty) pair.

## Initial setup — install the ontology

The 7 required ontology assets (`!ui` ontology root, `ui__RelationColumnSet`
class, and 5 `ui__RelationColumnSet_*` properties) are not auto-installed by
the plugin (see #3125). Install them yourself via one of:

- Copy the `ui/` ontology folder from
  [`kitelev/exocortex-starter-kit`](https://github.com/kitelev/exocortex-starter-kit)
  into your vault (any folder — plugin reads by UUID, not by path).
- Or add the starter-kit as a git submodule under `assetspaces/ui/` per
  RFC-D vault layout.

If the ontology is absent the plugin loads without error; `RelationColumnSet`
customization is simply unavailable until the 7 assets are present.

## Copy-pasteable example

Create a new note anywhere in the vault (e.g.
`03 Knowledge/ui/weekly-objective-week.md`) with the following frontmatter to
show `exo__Asset_createdAt` and `exo__Asset_label` as columns whenever
`ems__WeeklyObjective` backlinks to an open `period__Week` via
`ems__WeeklyObjective__week`:

```yaml
---
exo__Asset_uid: 3f41c77a-7e42-4b45-9e87-0d4b6dc3f451
exo__Asset_label: "WeeklyObjective columns for Week"
exo__Instance_class:
  - "[[ui__RelationColumnSet]]"
ui__RelationColumnSet_label: "WeeklyObjective ← Week"
ui__RelationColumnSet_targetClass:
  - "[[ems__WeeklyObjective]]"
ui__RelationColumnSet_referencingProperty: "[[ems__WeeklyObjective__week]]"
ui__RelationColumnSet_columns:
  - "[[exo__Asset_createdAt]]"
  - "[[exo__Asset_label]]"
ui__RelationColumnSet_priority: 0
---
```

The columns render in the declared order, left-to-right. Only the ontology
class wikilink in `exo__Instance_class` is mandatory for discovery; every
`ui__RelationColumnSet_*` field is validated on parse with a `log.warn` on
malformed input — invalid assets are skipped, never thrown.

### Wikilink forms — canonical normalization

Every wikilink field (`ui__RelationColumnSet_targetClass`,
`ui__RelationColumnSet_referencingProperty`, each entry in
`ui__RelationColumnSet_columns`) is normalized through
`WikiLinkHelpers.normalize` before it reaches the resolver. All four
frontmatter forms below are therefore equivalent:

- `ems__WeeklyObjective` (bare identifier — valid for matching but Obsidian
  won't autocomplete it)
- `[[ems__WeeklyObjective]]` (plain wikilink — recommended for the
  copy-pasteable example above)
- `[[ems__WeeklyObjective|Weekly Objective]]` (non-UUID target ⇒ target
  wins, alias is display-only)
- `[[97fc9862-c886-4d86-9a60-e0cf9d778575|ems__WeeklyObjective]]` (starter-kit
  convention — UUID target ⇒ alias wins, starter-kit assets use this form)

Row-side `exo__Instance_class` values from the vault are normalized under
the same rules, so a `ui__RelationColumnSet` config parsed in any form
above matches a row in any form above — no pipe-order mirroring needed.

The `columns` array receives the same normalization: every entry is reduced
to a bare property name before the React renderer looks it up against the
row frontmatter (e.g. `[[exo__Asset_createdAt]]` → `exo__Asset_createdAt`).

## Priority ladder

The resolver matches one config per (rowClass, referencingProperty) pair.
When more than one config could match, the ladder below fires in order and
the first tier with at least one match wins.

| Tier                  | Condition                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| **1 — Exact**         | `targetClass` contains the row-class AND `referencingProperty` equals the backlinks group key. |
| **2 — Class only**    | `targetClass` contains the row-class AND the config omits `referencingProperty`.               |
| **3 — Property only** | The config omits `targetClass` AND `referencingProperty` equals the backlinks group key.       |
| **4 — Default**       | Nothing matched — the renderer falls back to its legacy hardcoded map.                         |

**Tiebreaker within a tier** — `priority DESC → exo__Asset_uid ASC`. Ties on
both fields are impossible because `exo__Asset_uid` is globally unique; the
uid-sort guarantees deterministic output across vaults and across machines.
When two configs share the same tier and priority, the resolver emits a
`log.warn` with both uids so the collision is visible in the console.

Declaration order of classes in `exo__Instance_class` matters: the resolver
walks classes in that order, and the first class to produce a non-null match
wins. This lets you declare a specific class (`ems__WeeklyObjective`) ahead
of a more generic one (`ems__Effort`) on the row asset and get the
specific-first behaviour without writing priority arithmetic.

## Coexistence with `exo__TableLayout`

`exo__TableLayout` and `ui__RelationColumnSet` operate on different data
sources:

- `exo__TableLayout` renders a user-declared list of assets (explicit
  `rows:` or a SPARQL-like query), and each layout defines its own columns.
- `ui__RelationColumnSet` only customises the **auto-backlinks table**
  produced by `UniversalLayout` — the one grouped by referencing property.

Both renderers are live simultaneously on the same note without interference.
You can put an `exo__TableLayout` codeblock inside a note whose class is
targeted by a `ui__RelationColumnSet`, and each table uses its own column
definition. The RelationsRenderer integration point is
`RelationsRenderer.ts:buildGroupSpecificProperties` — it only consults the
resolver; it never touches `exo__TableLayout` code paths.

## Feature flag

`ExocortexSettings.enableRelationColumnSetResolver` gates consumption of the
resolver by the renderer. It does **not** gate the repository itself — the
index is always warm so toggling the flag at runtime is immediate (no reload
needed). Defaults:

- `true` on new installs.
- Toggling to `false` reverts the auto-backlinks table to the legacy
  hardcoded map for every group — useful for bisecting a regression or
  comparing behaviour.

The flag lives under the "RFC be70f741 Phase 1 — enable the
RelationColumnSetRepository" description in `ExocortexSettings.ts:100-110`.

## Troubleshooting

`log.warn` messages emitted by the pipeline, listed in the order they can
appear:

- `RelationColumnSet <uid>: at least one of targetClass / referencingProperty required (<path>)` —
  the config has neither. Add at least one of the two fields.
- `RelationColumnSet <uid>: columns array must contain at least one entry (<path>)` —
  `ui__RelationColumnSet_columns` was empty or absent; declare at least one
  column wikilink.
- `RelationColumnSet: exo__Asset_uid missing at <path>` — every vault asset
  needs a UUID; regenerate it or paste one from an existing working config.
- `RelationColumnSetRepository: duplicate exo__Asset_uid <uid> (<path>); keeping first-seen` —
  two files share a UUID. The repository keeps the first-seen asset and
  skips duplicates on subsequent rebuilds; change one uid to resolve.
- `RelationColumnSetResolver: tier-<N> collision on <cls> / <prop> (uids: [<a>, <b>, …])` —
  multiple matching configs share the same tier and priority. The resolver
  still picks one deterministically (uid ASC), but the warning lets you
  either split the configs or raise the priority on the intended winner.

If the auto-backlinks table does not reflect a newly-added config, check:

1. `enableRelationColumnSetResolver` is `true` in settings.
2. `exo__Instance_class` contains `[[ui__RelationColumnSet]]` or the
   canonical UID `[[97fc9862-c886-4d86-9a60-e0cf9d778575]]`.
3. The console does not show any of the `log.warn` messages above for the
   file's path.
4. The open note's row-class is listed in `ui__RelationColumnSet_targetClass`
   (exact wikilink match after normalisation).
