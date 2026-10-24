---
exo__Instance_class: "[[exo__Layout]]"
exo__Asset_uid: fixture-exolayout-demo-class
exo__Asset_label: "exo__DemoClass layout (fixture)"
exo__Layout_targetClass: "[[exo__DemoClass]]"
exo__Layout_priority: 0
exo__Layout_coexistsWithDefault: false
---

# exo__DemoClass layout

Phase 3 E2E smoke fixture — the Layout for `exo__DemoClass` notes. Consumed
by `exo-layout-smoke.spec.ts`. Its single block (`block-demo-backlinks.md`)
names this Layout through `exo__LayoutBlock_layout` (RFC 9821a379 decision 3 —
the Layout no longer lists its blocks) and declares a two-column backlinks
table; the default Asset Relations section is suppressed because
`coexistsWithDefault: false`.
