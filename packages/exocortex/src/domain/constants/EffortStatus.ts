/**
 * Symbolic class-prefixed identifiers for effort status values.
 *
 * **Direction note (RFC 31c1a0be Phase 4 PR-B, #3194).** String values such
 * as `"ems__EffortStatusDoing"` are the pre-UUID-canon symbolic form. The
 * long-term direction is to identify status targets by their TBox UUIDs
 * (e.g. `027e78f4-6e16-4b36-b8fb-5510507d5745` for Doing) so the parser
 * resolves targets uniformly with the rest of the graph.
 *
 * **Not yet removable.** The enum values are coupled to:
 *   - `SPARQLTemplateLibrary.EFFORT_STATUSES` (symbolic PREFIX-form in queries)
 *   - `NoteToRDFConverter.expandClassValue` symbolic class-IRI emission
 *     (Issues #2782/#2959 — SPARQL `ASK` preconditions match the symbolic
 *     namespace IRI, not file UUIDs)
 *   - 25+ direct call sites comparing against the symbolic form
 *     (broader grep including companion `EFFORT_STATUSES` and
 *     `EffortStatusConfig` symbols reaches ~29 files; all are well above
 *     the Phase 4 PR-B 20-file WAITING_DECISION threshold)
 *
 * Removal requires a coordinated migration of (a) the SPARQL templates,
 * (b) the converter's class-IRI substitution branch, and (c) all callers
 * — deferred to RFC 31c1a0be Phase 5.
 *
 * New code should not introduce additional dependencies on this enum.
 * Resolve UUIDs at runtime via the TBox lookup instead.
 */
export enum EffortStatus {
  DRAFT = "ems__EffortStatusDraft",
  BACKLOG = "ems__EffortStatusBacklog",
  ANALYSIS = "ems__EffortStatusAnalysis",
  TODO = "ems__EffortStatusToDo",
  DOING = "ems__EffortStatusDoing",
  DONE = "ems__EffortStatusDone",
  TRASHED = "ems__EffortStatusTrashed",
}
