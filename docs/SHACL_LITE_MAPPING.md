# SHACL-Lite Vocabulary Mapping

**Status:** Reference  
**RFC source:** vault `82a72aca-d974-44a4-92b4-55be932c6ed1` (RFC: SHACL-lite v3)  
**Related:** `docs/rfc/shacl-cli-design.md`, `docs/rdf/ExoRDF-Mapping.md`

This document records the alignment between `exo__Property_*` vocabulary and W3C SHACL (`sh:*`) terms used in the SHACL-lite validation engine (`ShaclLiteValidator`).

The namespace remains `exo__` — no full SHACL conformance is claimed. Properties are named by analogy to allow a straight rename if the engine migrates to full W3C SHACL in the future.

W3C SHACL namespace: `http://www.w3.org/ns/shacl#`

---

## Property mapping table

| exo property | W3C SHACL term | Relationship | Phase | Notes |
|---|---|---|---|---|
| `exo__Property_range` | `sh:class` | Equivalent in engine subset | Phase 1 — Active | Value must be an instance of the declared class (sub-class allowed via `rdfs:subClassOf*`). Vault asset UID: `a12b38a7-8c1f-4f93-872d-afd99803cac6`. superProperty = `rdfs:range`. |
| `exo__Property_cardinality` (enum `Single`) | `sh:maxCount 1` | Derived | Phase 1 — Active | `exo__PropertyCardinalitySingle` → engine emits `sh:maxCount=1`. No direct `sh:minCount` in Phase 1 for this enum. |
| `exo__Property_minCount` | `sh:minCount` | 1:1 name mapping (planned) | Phase 3+ — Not yet defined | YAGNI Drop #3 in RFC v3. Will carry `xsd:integer` range when added. `exo__Property_cardinality` enum is sufficient for Phase 1–2. |
| `exo__Property_severity` | `sh:severity` | 1:1 name mapping | Phase 1 — Active | Range = W3C sh:Severity IRIs directly (see §Severity IRIs below). Vault asset UID: `5ec51a6a-45d3-4eaa-9b4b-85137d26d067`. superProperty = `sh:severity` (not yet a vault wikilink — `sh__severity.md` does not exist; add alignment edge once SHACL namespace is bootstrapped). |

### Additional engine-level mappings (Phase 1)

| Engine constraint | W3C SHACL term | Source |
|---|---|---|
| literal type check (`xsd:string`, `xsd:dateTime`, `xsd:int`) | `sh:datatype` | Phase 1 subset |
| `exo__Property_cardinality = Single` → `maxCount=1` | `sh:maxCount` | Derived from cardinality enum |

---

## Severity IRIs

`exo__Property_severity` accepts W3C sh:Severity IRIs **directly** — no own enum-class exists.

| IRI | Engine semantics |
|---|---|
| `sh:Violation` (`http://www.w3.org/ns/shacl#Violation`) | Block write (default if `exo__Property_severity` is absent) |
| `sh:Warning` (`http://www.w3.org/ns/shacl#Warning`) | Log + UI notice; write proceeds |
| `sh:Info` (`http://www.w3.org/ns/shacl#Info`) | Audit log only |

**Confirmed: no own enum-class.** `exo__ValidationSeverity` was proposed in RFC v2 and **DROPPED in v3** (YAGNI Drop #2, RFC `82a72aca` §"DROPPED in v3: exo__ValidationSeverity класс"):

> Дублирует W3C `sh:Severity` который имеет ровно те же 3 instances (`Violation/Warning/Info`). Собственный класс гарантировал бы double-rename позже.

The three IRIs are not yet materialised as vault assets — referenced by IRI/CURIE in shape registry until `sh__Severity` ontology stub lands (out of scope of P0.x).

---

## Out-of-scope (Phase 1)

The following W3C SHACL terms are **not** covered by Phase 1 of the engine:

`sh:pattern`, `sh:in`, `sh:not`, `sh:and`, `sh:or`, `sh:xone`, property path expressions, `sh:targetSubjectsOf`, `sh:targetObjectsOf`, `sh:node`, `sh:sparql`, `sh:rule`.

Extension path: add individually per Phase 2/3 design doc.
