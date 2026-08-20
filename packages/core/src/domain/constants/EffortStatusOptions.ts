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

import { EFFORT_STATUS_UID } from "./EffortStatusCanon";

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
 *
 * ⛤ DERIVED from {@link EFFORT_STATUS_UID} (issue #4121), not authored here.
 * That deletion had to be hand-applied to FOUR holders of the same vocabulary;
 * #4056 folded two of them into the canon and named this one as the remaining
 * write-side list. Deriving closes it: a status added or removed in one place
 * cannot leave this dropdown behind.
 *
 * ⛔ The values stay SYMBOLIC (`[[ems__EffortStatusDoing]]`) — deriving does NOT
 * migrate them to UUID-canon. The canon is keyed BY symbol, so the mapping only
 * needs its keys; the coordinated `NoteToRDFConverter` + starter-kit ASK
 * migration the file header defers is untouched.
 *
 * ⚠ The label is the symbol's tail (`ems__EffortStatusBacklog` → `Backlog`),
 * which reproduces every label this table carried by hand — measured, not
 * assumed. A future status whose human label is NOT its tail (a space, as the
 * deleted `To Do` had) would need its own mapping rather than this one.
 */
export const EFFORT_STATUS_OPTIONS: ReadonlyArray<{
  readonly value: string;
  readonly label: string;
}> = Object.freeze(
  Object.keys(EFFORT_STATUS_UID).map((symbol) =>
    Object.freeze({
      value: `[[${symbol}]]`,
      label: symbol.replace(/^ems__EffortStatus/, ""),
    }),
  ),
);
