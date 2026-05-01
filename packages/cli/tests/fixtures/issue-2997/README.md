# Issue #2997 — Synthetic fixture vault

Reproduces the SPARQL algebra crash described in
https://github.com/kitelev/exocortex/issues/2997
(`Literals cannot appear in subject position` on
`FILTER(CONTAINS(STR(?var), …))` queries when the vault contains
files that fail pre-validation).

Layout:

- `valid-tree/` — three legacy-format files modelling the
  Project → Phase → Task hierarchy used in the issue's reproduction
  query. Loaded alone this set must answer the query without throwing
  (control case).
- `bad-files/` — 11 files mimicking each shape that produced a
  loader skip-warning during the original incident:

  | #   | File                                 | Bad shape                                                                |
  | --- | ------------------------------------ | ------------------------------------------------------------------------ |
  | 1   | `01-invalid-iri-class.md`            | `exo__Instance_class` wikilink with spaces/parens → `Invalid IRI format` |
  | 2   | `02-empty-locked-by.md`              | `ems__Effort_lockedBy: ""` → empty literal                               |
  | 3   | `03-empty-lock-expires.md`           | `ems__Effort_lockExpires: ""` → empty literal                            |
  | 4   | `04-missing-asset-uid.md`            | no `exo__Asset_uid`                                                      |
  | 5   | `05-missing-asset-isdefinedby.md`    | no `exo__Asset_isDefinedBy`                                              |
  | 6   | `06-empty-asset-label.md`            | `exo__Asset_label: ""`                                                   |
  | 7   | `07-empty-instance-class.md`         | `exo__Instance_class: ""`                                                |
  | 8   | `08-empty-effort-status.md`          | `ems__Effort_status: ""`                                                 |
  | 9   | `09-empty-effort-parent.md`          | `ems__Effort_parent: ""`                                                 |
  | 10  | `10-empty-asset-updatedat.md`        | `exo__Asset_updatedAt: ""`                                               |
  | 11  | `11-empty-effort-start-timestamp.md` | `ems__Effort_startTimestamp: ""`                                         |

The Project root carries the UUID
`5b4030aa-f0c1-43dc-996a-896b0a1a6dfb` from the issue, so the same
`FILTER(CONTAINS(STR(?root), '5b4030aa-…'))` filter binds.
