import type { DisplayMatcherHostFunctionRegistry } from "@plugin/domain/display-name/PrintNameRuleService";
import { BlockerHelpers } from "./BlockerHelpers";
import { EpisodePeriodHelpers } from "./EpisodePeriodHelpers";

/**
 * The built-in registry of display-matcher host functions (req d6cd2371), keyed by the
 * name an `exo__DisplayNameSpec_matchHostFunction` references. Each is a per-render,
 * possibly CROSS-ASSET predicate over (app, rendered-instance metadata) — the concrete
 * predicates that the storage-agnostic `PrintNameRuleService` engine consults through its
 * injected registry. Seeded from the composition root (see ExocortexPlugin), mirroring the
 * precondition-host-function pattern (`registerDefaultHostFunctions`).
 *
 * Seeded with `isEffortBlocked` — reuses the DailyNote renderer's `BlockerHelpers`
 * (reads `ems__Effort_blocker`, resolves that asset, checks ITS status), so a spec can
 * declare the 🚩-blocked condition as homoiconic vault data instead of renderer hardcode.
 * Extend by adding an entry here; the engine looks names up at match time.
 *
 * `isEpisodeOngoing` (req 8a47ff93) shows the other shape a host function can take: it
 * resolves no other asset, reading only the rendered instance's own period — but TODAY,
 * its comparand, is ambient, so a value-equality matcher still cannot express it.
 *
 * Both entries hardcode the property names they read, because the registry signature
 * carries no parameter channel. Widening it (so one generic predicate could serve any
 * `_start`/`_end` pair) is the natural extension once a second period-like class wants
 * the same marker.
 */
export const DEFAULT_DISPLAY_MATCHER_HOST_FUNCTIONS: DisplayMatcherHostFunctionRegistry = {
  isEffortBlocked: (app, metadata) => BlockerHelpers.isEffortBlocked(app, metadata),
  isEpisodeOngoing: (_app, metadata) => EpisodePeriodHelpers.isEpisodeOngoing(metadata),
};
