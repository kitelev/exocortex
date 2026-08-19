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
 * A guarded property's ROUTE: the cliNames of the dedicated `exocmd__Command`s
 * that own it, plus optional prose. This is the MACHINE-READABLE half — the
 * human message in {@link GUARDED_PROPERTIES} is DERIVED from it.
 *
 * ⛤ Why a structure and not a hand-authored sentence: the message is a CLAIM
 * about which commands exist. When it was authored as free prose it drifted —
 * three of its names (`remove-start-timestamp`, `remove-end-timestamp`,
 * `archive-completed`) never existed in any live registry, so the guard refused
 * the mutation and then pointed the user at a command that does not resolve.
 * ⛤ The three had DIFFERENT causes, and only one was prose-drift:
 *   `remove-start-timestamp` / `remove-end-timestamp` — never existed anywhere but
 *     an e2e TEST FIXTURE (`tests/e2e/test-vault/03 Knowledge/commands/
 *     cmd-remove-start-timestamp.md`), i.e. a fixture name leaked into prose;
 *   `archive-completed` — WAS a real command, renamed to `archive` upstream. It is
 *     still PRESENT in the pinned `exoas-exocmd` submodule. So the mechanism there
 *     is "upstream rename + stale pin", not invention — and that is the cause that
 *     will recur.
 * Deriving the sentence from this array makes "the message names a command not
 * listed here" impossible by construction; it does NOT stop an upstream rename.
 *
 * ⛔ The rendered sentence is ALSO the INPUT of `ErrorHandler.classifyError`,
 * which picks the process exit code by SUBSTRING (`transition` → 6,
 * `transaction` → 7, `concurrent`/`modified` → 8, `not found` → 4, `Invalid` →
 * 2, …). So a word chosen for readability silently changes the exit code a
 * scripted consumer branches on — an early draft of the timestamp notes said
 * "as a transition side effect" and turned the refusal from 1 into 6. The
 * `guard messages do not collide with the exit-code classifier` axis in
 * `tests/unit/guardedRoutes.test.ts` locks this.
 *
 * ⛔ It does NOT make "a listed cliName exists in the user's vault" checkable in
 * CI: the command registry is split across assetspaces and exocortex pins only
 * `exoas-exocmd` — `archive`, `set-criticality-*`, `set-planned-*` live in the
 * UNPINNED `exoas-public`. Verifying existence needs the live vault, which the
 * commands do have at refusal time; that is a separate follow-up.
 */
export interface GuardedRoute {
  /** cliNames of the dedicated commands, in the order to present them. */
  readonly commands: readonly string[];
  /** Rendered after `<path>` (e.g. a required `--input` payload). */
  readonly argSuffix?: string;
  /** Rendered in parentheses after the invocation. */
  readonly note?: string;
}

/**
 * Machine-readable routing table — see {@link GuardedRoute}.
 *
 * Every cliName here was verified against the live registry on 2026-08-19
 * (76 `exocmd__Command_cliName` across the mounted assetspaces).
 */
export const GUARDED_ROUTES: Record<string, GuardedRoute> = {
  // Status state machine (transitions carry preconditions).
  ems__Effort_status: {
    commands: [
      "mark-done",
      "move-to-backlog",
      "rollback-to-backlog",
      "start-effort",
      "set-draft-status",
    ],
  },
  // Criticality zone (not-a-prototype precondition guard).
  ems__Task_zone: {
    commands: [
      "set-criticality-high",
      "set-criticality-medium",
      "set-criticality-low",
    ],
  },
  // Parent / label — dedicated guarded commands (#3779).
  ems__Effort_parent: {
    commands: ["set-parent"],
    argSuffix: `--input '{"parent":"<uid>"}'`,
  },
  exo__Asset_label: {
    commands: ["set-label"],
    argSuffix: `--input '{"label":"<text>"}'`,
  },
  // Reclassing — dedicated Convert commands (raw set desyncs class vs co-location).
  exo__Instance_class: {
    commands: ["convert-to-task", "convert-to-project"],
    note: "reclassing is a semantic operation with a precondition",
  },
  // Status-transition FACT timestamps (set only as status-transition side effects).
  //
  // ⛤ There is no standalone "remove the timestamp" command — CLEARING it is a
  // side effect of a workflow transition (`ems__WorkflowTransition_postActions`),
  // so the commands below both SET and CLEAR depending on direction.
  ems__Effort_startTimestamp: {
    commands: ["start-effort", "rollback-to-backlog", "park-waiting"],
    note: "start-effort sets it; the others clear it as a side effect of the status change",
  },
  ems__Effort_endTimestamp: {
    commands: ["mark-done", "re-open"],
    note: "mark-done sets it; re-open clears it as a side effect of the status change",
  },
  ems__Effort_resolutionTimestamp: {
    commands: ["mark-done", "re-open"],
    note: "mark-done sets it; re-open clears it as a side effect of the status change",
  },
  // Plan / schedule dates — dedicated commands.
  ems__Effort_plannedStartTimestamp: {
    commands: [
      "set-planned-start",
      "plan-on-today",
      "plan-for-evening",
      "shift-day-forward",
      "shift-day-backward",
    ],
  },
  ems__Effort_plannedEndTimestamp: { commands: ["set-planned-end"] },
  ems__Effort_scheduledDate: { commands: ["set-scheduled-date"] },
  // Votes — dedicated command.
  ems__Effort_votes: { commands: ["vote-on-effort"] },
  // Archive flag (bare `archived:` in frontmatter; `exo__Asset_archived` when
  // prefixed) — dedicated archive/un-archive commands (un-archive has a Done
  // precondition).
  archived: { commands: ["archive", "archive-ontologically", "un-archive"] },
  exo__Asset_archived: {
    commands: ["archive", "archive-ontologically", "un-archive"],
  },
};

/** Render a route as the sentence the guard surfaces to the user. */
export function renderGuardedRoute(route: GuardedRoute): string {
  const invocation = `apply ${route.commands.join("|")} <path>`;
  const withArg = route.argSuffix
    ? `${invocation} ${route.argSuffix}`
    : invocation;
  return route.note ? `${withArg}  (${route.note})` : withArg;
}

/**
 * Properties the generic mutation primitives REFUSE because a dedicated guarded
 * `exocmd__Command` owns them — each enforces a state-machine transition or a
 * precondition guard, so mutating the property directly would bypass that guard.
 * The value is the dedicated command to use instead. This is a SUPERSET of the
 * `dogfood-cli-mutation` hook's routing table: every property that has a
 * dedicated command is refused here and routed to that command, so the generic
 * primitives only ever handle the "everything else" class the hook leaves to them.
 *
 * ⛤ DERIVED from {@link GUARDED_ROUTES} — do not hand-edit. The shape
 * (`Record<string, string>`) is unchanged, so every consumer and every existing
 * assertion keeps working.
 *
 * NOT guarded (so the primitives handle them): `exo__Asset_isDefinedBy` (issue
 * #3848 — set-property allows it with a co-location warning), and any other
 * scalar / boolean / enum / wikilink property with no dedicated command.
 *
 * Looked up via {@link guardedReason} (own-key `hasOwnProperty` check) so a
 * user-supplied property name like `toString` / `constructor` never matches an
 * inherited Object.prototype key (#3795 review M2).
 */
export const GUARDED_PROPERTIES: Record<string, string> = Object.fromEntries(
  Object.entries(GUARDED_ROUTES).map(([property, route]) => [
    property,
    renderGuardedRoute(route),
  ]),
);

/**
 * Properties the generic mutation primitives REFUSE as immutable identity /
 * self-managed. The value is the reason surfaced to the user.
 */
export const IMMUTABLE_PROPERTIES: Record<string, string> = {
  exo__Asset_uid:
    "the asset identity — changing it breaks UID-canon filenames and every inbound [[uid]] wikilink",
  [UPDATED_AT_KEY]: "auto-managed (bumped on every mutation)",
};

/**
 * Render the refusal a generic mutation primitive surfaces when a property is
 * owned by a dedicated command.
 *
 * ⛤ Shared by BOTH call sites (and by the axis in
 * `tests/unit/guardedRoutes.test.ts`) so the sentence exists in ONE place. It has
 * to: the whole string — wrapper included — is the input of
 * `classifyMessage`, which picks the process exit code by SUBSTRING. When the
 * wrapper was an inline literal per command, a trigger word introduced there was
 * invisible to any test asserting on the routing fragment alone.
 *
 * @param verb - the primitive's own verb, e.g. `set` / `remove`
 * @param command - the CLI name of that primitive, e.g. `set-property`
 */
export function renderGuardRefusal(
  verb: string,
  command: string,
  property: string,
  routeFragment: string,
): string {
  return (
    `Refusing to ${verb} "${property}" via ${command} — it has a dedicated guarded ` +
    `command so the state machine / precondition is not bypassed. ` +
    `Use:  exocortex ${routeFragment} --vault <v>`
  );
}

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
