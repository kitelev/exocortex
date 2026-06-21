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
 *   - `NoteToRDFConverter.expandClassValue` symbolic class-IRI emission
 *     (Issues #2782/#2959 — SPARQL `ASK` preconditions match the symbolic
 *     namespace IRI, not file UUIDs)
 *   - 18+ direct call sites comparing against the symbolic form (workflow
 *     engine, visibility rules, kanban provider, renderers; broader grep
 *     reaches ~25 files — all well above the 15-caller cascade-cap that
 *     gates in-PR migration)
 *
 * Removal requires a coordinated migration of (a) the converter's class-IRI
 * substitution branch, (b) all callers, AND (c) the starter-kit ASK
 * preconditions in the public-ontologies repo — deferred to
 * RFC 31c1a0be Phase 5b (cross-repo coordinated PR series).
 *
 * The companion `EffortStatusConfig.ts` (legacy name-to-enum / wikilink
 * helpers with no production callers) was removed in Phase 4 PR-D, #3194;
 * the single live export `EFFORT_STATUS_OPTIONS` now lives in
 * `EffortStatusOptions.ts`.
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
