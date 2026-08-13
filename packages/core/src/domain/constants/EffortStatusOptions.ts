/**
 * @file Effort status dropdown options for UI selection.
 *
 * **Direction note (RFC 31c1a0be Phase 4 PR-D, #3194).** Values use the
 * pre-UUID-canon symbolic form (`"[[ems__EffortStatusDoing]]"`). New writes
 * via this map continue to produce symbolic-form frontmatter, which the
 * parser substitutes into the symbolic class IRI via
 * {@link NoteToRDFConverter.expandClassValue} so starter-kit `ASK`
 * preconditions match. Migrating values to UUID-canon form requires the
 * coordinated `NoteToRDFConverter` + starter-kit ASK migration deferred to
 * a follow-up phase (see EffortStatus.ts directional doc note).
 *
 * Split out of the former `EffortStatusConfig.ts` in Phase 4 PR-D — the
 * surrounding name-to-enum / wikilink helpers (`STATUS_NAME_TO_ENUM`,
 * `STATUS_NAME_TO_WIKILINK`, `normalizeEffortStatus`, `isDoneStatus`,
 * `isTrashedStatus`, `getEffortStatusLabel`, `EFFORT_STATUS_CONFIG`) had
 * no production callers and were deleted with that PR. `test-utils` has
 * an independent `isDoneStatus` / `isTrashedStatus` / `EffortStatusName`
 * for fixture factories.
 */

/**
 * Effort status values with label and wikilink, for UI dropdowns and selects.
 *
 * Example: `[{ value: "[[ems__EffortStatusDraft]]", label: "Draft" }, ...]`
 *
 * Sole production consumer: `StatusSelectPropertyField`
 * (`packages/obsidian-plugin/src/presentation/components/property-fields/StatusSelectPropertyField.ts`).
 *
 * Every entry is written verbatim into user frontmatter, so the list MUST
 * mirror the shared ontology (req `fcbde537-f09a-410e-8bee-d3d607a70302`):
 * `Analysis` / `To Do` were removed when their TBox instances were deleted
 * (`exoas-public@c35a660d`), `Waiting` added in their place.
 */
export const EFFORT_STATUS_OPTIONS: ReadonlyArray<{
  readonly value: string;
  readonly label: string;
}> = [
  { value: "[[ems__EffortStatusDraft]]", label: "Draft" },
  { value: "[[ems__EffortStatusBacklog]]", label: "Backlog" },
  { value: "[[ems__EffortStatusDoing]]", label: "Doing" },
  { value: "[[ems__EffortStatusWaiting]]", label: "Waiting" },
  { value: "[[ems__EffortStatusDone]]", label: "Done" },
  { value: "[[ems__EffortStatusTrashed]]", label: "Trashed" },
] as const;
