---
exo__Asset_uid: e2e-pre-status-is-backlog
exo__Asset_label: "Status is Backlog"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[exocmd__Precondition]]"
exocmd__Precondition_sparqlAsk: >
  PREFIX ems: <https://exocortex.my/ontology/ems#>
  ASK {
    $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusBacklog> .
  }
---
