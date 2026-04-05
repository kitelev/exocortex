---
exo__Asset_uid: e2e-pre-status-is-doing
exo__Asset_label: "Status is Doing"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[exocmd__Precondition]]"
exocmd__Precondition_sparqlAsk: >
  PREFIX ems: <https://exocortex.my/ontology/ems#>
  ASK {
    $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDoing> .
  }
---
