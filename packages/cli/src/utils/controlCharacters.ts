/**
 * Characters that break a one-line terminal block: C0, DEL, C1 and the Unicode line and paragraph
 * separators. ONE carrier for both consumers of `query --stats` (bug 01f1e76a, review of PR #4626):
 * the check of a recorded pruning line (`query-prune-report.ts`) and the collapse of an analysis
 * error into the «not computed» line (`sparql-query.ts`). Before, the class lived as two literals,
 * and a mutant of one could not tell the other drifted. This module has no imports on purpose:
 * `sparql-query.ts` loads `query-prune-report.ts` lazily, and must still collapse synchronously.
 */
export const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const CONTROL_CHARACTER_RUN = new RegExp(`${CONTROL_CHARACTER.source}+`, "g");

/** Every run of control characters becomes one space. */
export function collapseControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTER_RUN, " ");
}
