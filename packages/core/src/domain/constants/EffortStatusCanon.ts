import { EffortStatus } from "./EffortStatus";

/**
 * The ONE table binding an `ems__EffortStatus*` symbol to its TBox UID, plus the
 * one normaliser that reads a frontmatter value against it.
 *
 * ⛤ Both existed TWICE before (issue #4056): `STATUS_UID_BY_ENUM` in
 * `services/GroundingExecutor` and `FALLBACK_EFFORT_STATUS_VALUES` in the
 * plugin's `PropertySchemas` — the same six UIDs in two shapes. Both had to be
 * hand-edited on 2026-08-13 when `ToDo` and `Analysis` were deleted from
 * `exoas-public` (both cite req `fcbde537`), so the drift point had already
 * fired once.
 *
 * It lives in `domain/constants/` beside `WorkflowClassUids` and
 * `GroundingTypeUIDs` because importing `services/` into `domain/` would invert
 * the layering — extraction is the shape, not a direct import.
 *
 * ⚠ **A member without a TBox instance is a defect** (req `fcbde537`). Every
 * value here is written into user frontmatter, so a status with no asset on
 * disk becomes a dangling wikilink no workflow can express. Resolve the
 * `ems__EffortStatus<Name>` asset before adding one.
 *
 * ⛤ A FOURTH holder mirrors this vocabulary in symbolic form for the UI
 * dropdown — `EFFORT_STATUS_OPTIONS` in `EffortStatusOptions.ts`. It is a
 * write-side option list rather than a parser, so it is deliberately out of
 * scope here; the next edit to the vocabulary must still visit it.
 */
export const EFFORT_STATUS_UID: Readonly<Record<EffortStatus, string>> = {
  [EffortStatus.DRAFT]: "c42245d0-01de-4c35-bfcf-d910445ea28e",
  [EffortStatus.BACKLOG]: "753a44d5-846c-4b82-9196-4fd9a4d48777",
  [EffortStatus.DOING]: "027e78f4-6e16-4b36-b8fb-5510507d5745",
  [EffortStatus.WAITING]: "0610947c-6a62-41c8-9d44-7863d3ba3a8e",
  [EffortStatus.DONE]: "7b9b3116-7c3c-438c-9618-94fe301320a6",
  [EffortStatus.TRASHED]: "5d14f18d-db2b-4847-9ac1-144cb93b2541",
};

/** The inverse, derived — never authored, so the two cannot disagree. */
export const EFFORT_STATUS_BY_UID: Readonly<Record<string, EffortStatus>> =
  Object.freeze(
    Object.fromEntries(
      (Object.entries(EFFORT_STATUS_UID) as [EffortStatus, string][]).map(
        ([symbol, uid]) => [uid, symbol],
      ),
    ) as Record<string, EffortStatus>,
  );

/** `ems__EffortStatusDone` — the exact shape of a symbolic status label. */
const SYMBOLIC_STATUS_RE = /^ems__EffortStatus[A-Za-z]+$/;
const TRAILING_UUID_RE =
  /\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEADING_UUID_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/**
 * Normalise a raw `ems__Effort_status` value to its SYMBOLIC form, or `null`
 * when it cannot be read as one.
 *
 * Handles every legal shape the vault contains:
 *
 * | authored                              | → |
 * |---------------------------------------|---|
 * | `[[ems__EffortStatusDone]]`           | `ems__EffortStatusDone` |
 * | `[[<uid>]]`                            | via the UID table |
 * | `[[<uid>\|ems__EffortStatusDone]]`     | the alias, when it IS a symbol |
 * | `[[<uid>\|Done]]`                      | via the UID table — an arbitrary alias is display text, not an identifier |
 * | `[[ems__EffortStatusDone <uuid>]]`     | the space-form some transitions leave behind |
 *
 * ⛔ A MULTI-element list returns `null` rather than picking a first: a caller
 * that guessed would silently contradict whichever value the UI displays. What
 * `null` MEANS is the caller's to decide — a workflow transition treats it as a
 * refusal, a display matcher as "unknown" — and that difference is deliberate,
 * not an inconsistency to be flattened.
 *
 * ⚠ Returns `null` for an unknown UID too. Resolving it would need the vault,
 * which `domain/` does not have; the one caller that HAS a vault falls back to
 * it after asking here first.
 */
export function normalizeEffortStatus(raw: unknown): string | null {
  let value = raw;
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    if (value.length !== 1) return null;
    value = value[0];
  }

  const inside = String(value)
    .trim()
    .replace(/^["']/, "")
    .replace(/["']$/, "")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .trim();
  if (!inside) return null;

  if (SYMBOLIC_STATUS_RE.test(inside)) return inside;

  const pipe = inside.indexOf("|");
  const target = pipe === -1 ? inside : inside.slice(0, pipe).trim();
  if (pipe !== -1) {
    const alias = inside.slice(pipe + 1).trim();
    // An alias is honoured ONLY when it is itself a symbol; otherwise it is
    // display text and the UID before the pipe is what identifies the status.
    if (SYMBOLIC_STATUS_RE.test(alias)) return alias;
  }

  const spaceForm = target.replace(TRAILING_UUID_RE, "").trim();
  if (SYMBOLIC_STATUS_RE.test(spaceForm)) return spaceForm;

  const uid = target.match(LEADING_UUID_RE);
  if (uid) return EFFORT_STATUS_BY_UID[uid[1].toLowerCase()] ?? null;

  return null;
}
