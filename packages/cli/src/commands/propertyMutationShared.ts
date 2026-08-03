import { canonicalYamlKey } from "@kitelev/exocortex-core";

/**
 * Shared guards + helpers for the generic frontmatter-mutation CLI verbs
 * `set-property` (#3795 / #3848) and `remove-property` (#3926). Both apply the
 * SAME state-machine / immutable denylists, the SAME canonical-YAML-key mapping
 * (#3944), and the SAME timezone-deterministic `exo__Asset_updatedAt` bump — a
 * single source of truth so a guard added here protects every mutation primitive.
 */

/**
 * Default timezone for the `exo__Asset_updatedAt` bump. Matches `cli create`'s
 * Asia/Almaty default; overridable with `--timezone`.
 */
export const DEFAULT_TIMEZONE = "Asia/Almaty";

export const UPDATED_AT_KEY = "exo__Asset_updatedAt";

/**
 * Canonical-YAML-key mapping (issue #3944) — re-exported from core, where it now
 * lives next to the `UNPREFIXED_ASSET_FIELDS` whitelist it consults.
 *
 * ⛤ It used to be DEFINED here, and that was the defect: a rule every writer of
 * frontmatter must obey sat inside one package's command folder, so the
 * core-side writers (`GroundingExecutor`, `GenericAssetCreationService`) could
 * not reach it and wrote raw keys instead. The re-export keeps this module's
 * public surface unchanged for `set-property` / `remove-property` while making
 * core the single source (req 869561bf).
 */
export { canonicalYamlKey };

/**
 * Properties the generic mutation primitives REFUSE because a dedicated guarded
 * `exocmd__Command` owns them — each enforces a state-machine transition or a
 * precondition guard, so mutating the property directly would bypass that guard.
 * The value is the dedicated command to use instead. This is a SUPERSET of the
 * `dogfood-cli-mutation` hook's routing table: every property that has a
 * dedicated command is refused here and routed to that command, so the generic
 * primitives only ever handle the "everything else" class the hook leaves to them.
 *
 * NOT guarded (so the primitives handle them): `exo__Asset_isDefinedBy` (issue
 * #3848 — set-property allows it with a co-location warning), and any other
 * scalar / boolean / enum / wikilink property with no dedicated command.
 *
 * Looked up via {@link guardedReason} (own-key `hasOwnProperty` check) so a
 * user-supplied property name like `toString` / `constructor` never matches an
 * inherited Object.prototype key (#3795 review M2).
 */
export const GUARDED_PROPERTIES: Record<string, string> = {
  // Status state machine (transitions carry preconditions).
  ems__Effort_status:
    "apply mark-done|move-to-backlog|move-to-todo|start-effort|set-draft-status <path>",
  // Criticality zone (not-a-prototype precondition guard).
  ems__Task_zone: "apply set-criticality-high|medium|low <path>",
  // Parent / label — dedicated guarded commands (#3779).
  ems__Effort_parent: 'apply set-parent <path> --input \'{"parent":"<uid>"}\'',
  exo__Asset_label: 'apply set-label <path> --input \'{"label":"<text>"}\'',
  // Reclassing — dedicated Convert commands (raw set desyncs class vs co-location).
  exo__Instance_class:
    "apply convert-to-task|convert-to-project <path>  (reclassing is a semantic operation with a precondition)",
  // Status-transition FACT timestamps (set only as status-transition side effects).
  ems__Effort_startTimestamp:
    "apply start-effort <path>  (or apply remove-start-timestamp <path>)",
  ems__Effort_endTimestamp:
    "apply mark-done <path>  (or apply remove-end-timestamp <path>)",
  ems__Effort_resolutionTimestamp: "apply mark-done <path>",
  // Plan / schedule dates — dedicated commands.
  ems__Effort_plannedStartTimestamp:
    "apply set-planned-start|plan-on-today|plan-for-evening|shift-day-forward|shift-day-backward <path>",
  ems__Effort_plannedEndTimestamp: "apply set-planned-end <path>",
  ems__Effort_scheduledDate: "apply set-scheduled-date <path>",
  // Votes — dedicated command.
  ems__Effort_votes: "apply vote-on-effort <path>",
  // Archive flag (bare `archived:` in frontmatter; `exo__Asset_archived` when
  // prefixed) — dedicated archive/un-archive commands (un-archive has a Done
  // precondition).
  archived: "apply archive-completed|archive-ontologically|un-archive <path>",
  exo__Asset_archived:
    "apply archive-completed|archive-ontologically|un-archive <path>",
};

/**
 * Properties the generic mutation primitives REFUSE as immutable identity /
 * self-managed. The value is the reason surfaced to the user.
 */
export const IMMUTABLE_PROPERTIES: Record<string, string> = {
  exo__Asset_uid:
    "the asset identity — changing it breaks UID-canon filenames and every inbound [[uid]] wikilink",
  [UPDATED_AT_KEY]: "auto-managed (bumped on every mutation)",
};

/** Own-key lookup on a denylist that never matches inherited Object.prototype keys. */
export function guardedReason(
  denylist: Record<string, string>,
  property: string,
): string | undefined {
  return Object.prototype.hasOwnProperty.call(denylist, property)
    ? denylist[property]
    : undefined;
}

/**
 * Render `YYYY-MM-DDTHH:MM:SS` for the given instant in `timezone`. Uses
 * `Intl.DateTimeFormat` with an explicit `timeZone`, so the result is
 * deterministic regardless of the runner's local timezone (mirrors
 * `GenericAssetCreationService.generateTimestampInTimezone`).
 */
export function stampTimestamp(now: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}
