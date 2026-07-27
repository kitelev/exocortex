# How to auto-file efforts per area-ontology (`exo__Ontology_effortsOntology`)

> Requirement `c03f9e3e` — per-ontology efforts routing.

## What it does

When you create a task or project from an **area** page via the homoiconic
**Create** button, its `exo__Asset_isDefinedBy` can be auto-derived so the new
effort is filed into a **target efforts-ontology** declared on **that area's
ontology** — without you picking `isDefinedBy` each time.

This keeps your area-ontologies clean (they hold areas, not the growing mass of
efforts) and routes efforts per-audience by a single declarative setting you
change on the ontology (e.g. `my-areas → my-efforts`, `work-areas →
work-efforts`).

The routing is **two-hop**:

```
area A  →  A.exo__Asset_isDefinedBy (the area-ontology O)  →  O.exo__Ontology_effortsOntology (the target efforts-ontology E)
```

The new effort's `exo__Asset_isDefinedBy` is set to **E**, and the file
co-locates in **E's folder** (co-location invariant) rather than the area's
folder.

## The setting: `exo__Ontology_effortsOntology`

An `exo__ObjectProperty` (domain `exo__Ontology`, range `exo__Ontology`, single-
valued). Add it to an **area-ontology** to declare where efforts created under
that ontology's areas should be filed.

```yaml
# On your area-ontology asset (e.g. the "my-areas" ontology):
exo__Ontology_effortsOntology: "[[<uid-of-the-target-efforts-ontology>]]"
```

## How to enable routing

1. **Declare the target** on your area-ontology: set
   `exo__Ontology_effortsOntology` to the efforts-ontology you want (e.g.
   `my-efforts`).
2. **Use a routing grounding**: the Create grounding for the effort must set
   `exo__Asset_isDefinedBy` via the two-hop resolver and use
   `targetFolder = $isDefinedByFolder`. Concretely, a
   `create_instance` grounding whose `propertyDefault` for
   `exo__Asset_isDefinedBy` wraps the `targetRefProperty` substitution token with
   the parameter `exo__Asset_isDefinedBy|exo__Ontology_effortsOntology` (the
   `refKey|propKey` pair — first hop reads the area's `exo__Asset_isDefinedBy`,
   second hop reads that ontology's `exo__Ontology_effortsOntology`). This
   per-grounding default **overrides** the built-in Universal Default (which
   inherits `isDefinedBy` single-hop from the click target).

Once both are in place, creating an effort from any area under that ontology
files the effort into the target efforts-ontology's folder automatically.

## Opt-in / no regression

Routing is **opt-in and data-driven**:

- An area-ontology that declares **no** `exo__Ontology_effortsOntology` → the
  two-hop resolver yields nothing → `isDefinedBy` is not routed and the effort
  co-locates with the area (unchanged behaviour).
- Different area-ontologies can target different efforts-ontologies — routing is
  strictly per-ontology (`O1 → E1`, `O2 → E2`).

## Change the target later

Because the routing decision lives in vault data (the
`exo__Ontology_effortsOntology` value on the ontology), you can re-point an
ontology's efforts elsewhere at any time by editing that one property — no code
change, and previously-created efforts are unaffected.
