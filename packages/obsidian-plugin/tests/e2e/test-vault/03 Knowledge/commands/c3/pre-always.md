---
exo__Asset_uid: e2e-pre-always
exo__Asset_label: "Always available"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[exocmd__Precondition]]"
exocmd__Precondition_sparqlAsk: >
  PREFIX exo: <https://exocortex.my/ontology/exo#>
  ASK {
    $target exo:Asset_uid ?u .
  }
---
