---
exo__Asset_uid: e2e-pre-has-start-timestamp
exo__Asset_label: "Has start timestamp"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[exocmd__Precondition]]"
exocmd__Precondition_sparqlAsk: >
  PREFIX ems: <https://exocortex.my/ontology/ems#>
  ASK {
    $target ems:Effort_startTimestamp ?ts .
  }
---
