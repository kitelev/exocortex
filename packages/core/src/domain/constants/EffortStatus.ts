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
 *
 * **This enum MIRRORS the shared ontology — a member without a TBox instance
 * is a defect** (req `fcbde537-f09a-410e-8bee-d3d607a70302`). `ToDo`
 * (`6a0e933a-…`) and `Analysis` (`cde3525c-…`) were deleted from
 * `exoas-public` on 2026-08-13 (commit `c35a660d`) and removed here; the
 * parking status `Waiting` (`0610947c-…`) shipped in their place. Before
 * adding a member, resolve its `ems__EffortStatus<Name>` asset on disk —
 * every value below is written into user frontmatter, so a value with no
 * asset becomes a dangling wikilink no workflow can express.
 */
export enum EffortStatus {
  DRAFT = "ems__EffortStatusDraft",
  BACKLOG = "ems__EffortStatusBacklog",
  DOING = "ems__EffortStatusDoing",
  WAITING = "ems__EffortStatusWaiting",
  DONE = "ems__EffortStatusDone",
  TRASHED = "ems__EffortStatusTrashed",
}
