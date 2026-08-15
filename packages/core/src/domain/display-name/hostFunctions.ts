import { EffortStatus } from "../constants/EffortStatus";
import type { DisplayMatcherHostFunctionRegistry } from "./PrintNameRuleService";
import type { VaultMetadataPort } from "./VaultMetadataPort";

/** Length of a `YYYY-MM-DD` calendar-day key. */
const DAY_KEY_LENGTH = 10;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The built-in display-matcher host functions (req 5cd9fffe), living in core so BOTH surfaces
 * run the same predicate.
 *
 * A host function is the escape hatch a `exo__DisplayNameSpec` reaches for when its condition
 * cannot be phrased as value-equality, because it looks OUTWARD: at another asset
 * (`isEffortBlocked` resolves `ems__Effort_blocker` and reads ITS status) or at an ambient
 * comparand (`isEpisodeOngoing` compares against TODAY, which no frontmatter carries).
 *
 * ⛤ These lived in the plugin until req 5cd9fffe, which is why the CLI naming oracle
 * (`resolve-display-name`, req f17f7c57) silently skipped the 2 specs of 35 that name them —
 * the engine is fail-closed, so an unregistered name means the spec simply never participates.
 * Measured 2026-08-15: 83 assets carry the properties these two read (74 `ems__Effort_blocker`
 * + 9 `life__Episode_start`).
 *
 * ⛤ Moving them cost no new port surface: `isEffortBlocked`'s only two Obsidian calls were
 * `getFirstLinkpathDest` followed by `getFileCache(...)?.frontmatter`, and that composition IS
 * {@link VaultMetadataPort.resolveLinkpathFrontmatter}; `isEpisodeOngoing` touches the vault not
 * at all. The plugin keeps its `(app, metadata)` wrappers, so none of their consumers changed.
 */

/**
 * True iff the effort is blocked by another effort — i.e. it carries `ems__Effort_blocker`
 * pointing at an asset whose own status is neither DONE nor TRASHED.
 *
 * ⛔ MOVED VERBATIM, INCLUDING A LIVE DEFECT — deliberately, because parity is the point of
 * req 5cd9fffe and "correct here, wrong in the plugin" would be worse than "identical in both".
 * The comparison below is against the SYMBOLIC status label (`ems__EffortStatusDone`), but
 * `exocortex-cli` writes the status as a bare `[[<uid>]]`; stripping the brackets then leaves a
 * UID, no branch matches, and a FINISHED blocker is reported as still blocking. Measured
 * 2026-08-15 on live data: 49 of 58 single-valued blockers store the bare-UID form, and 8
 * efforts currently carry a 🚩 they should not. That is the dual-IRI class, fixed by matching
 * BOTH forms — and it gets its own requirement, because the fix changes what the user sees.
 * Landing that fix HERE, once, now repairs both surfaces at once: this move is its precondition.
 *
 * ⛔ Likewise verbatim: a multi-valued `ems__Effort_blocker` (16 of the 74 measured) is flattened
 * by `String(...)` into a comma-joined string that resolves to nothing, so the predicate answers
 * "not blocked". Same reasoning — a behaviour change needs its own req. Characterised by test.
 *
 * ⚠ ONE delta is NOT verbatim and is accepted deliberately: the port retries the linkpath with a
 * `.md` suffix, which the inline original did not. It can only turn a previously UNRESOLVABLE
 * blocker into a resolvable one — i.e. strictly more links resolve — and it is the same retry the
 * engine has always done, so the two callers now agree rather than differ. The alternative was a
 * second port method whose only purpose is to resolve links WORSE.
 */
export function isEffortBlocked(
  vault: VaultMetadataPort,
  metadata: Record<string, unknown>,
): boolean {
  const effortBlocker = metadata.ems__Effort_blocker;
  if (!effortBlocker) {
    return false;
  }

  const blockerPath = String(effortBlocker).replace(/^\[\[|\]\]$/g, "");
  // The two Obsidian calls this replaces — getFirstLinkpathDest, then
  // getFileCache(...)?.frontmatter — are exactly what this port method does, on both adapters.
  const blockerMetadata = vault.resolveLinkpathFrontmatter(blockerPath);

  if (!blockerMetadata) {
    return false;
  }

  const blockerStatus = blockerMetadata.ems__Effort_status || "";
  const blockerStatusStr = String(blockerStatus).replace(/^\[\[|\]\]$/g, "");

  return (
    blockerStatusStr !== EffortStatus.DONE &&
    blockerStatusStr !== EffortStatus.TRASHED
  );
}

/**
 * The LOCAL calendar day as `YYYY-MM-DD`.
 *
 * Deliberately built from the local getters rather than `toISOString()`: the UTC form names the
 * wrong day for roughly a fifth of the local 24h in UTC+5, which is exactly the window where
 * "is this episode happening now" flips. Same local basis as the `$today` date-token line
 * (reqs 5c47471a / 26d79c70 / 96be4042).
 */
export function localToday(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Normalise a frontmatter date value to its `YYYY-MM-DD` calendar-day key, or null when it is
 * absent, empty or not a well-formed date.
 *
 * ⚠ An UNQUOTED `life__Episode_start: 2026-04-02` — which is how every real episode stores it —
 * is a YAML **timestamp**, so the parser hands us a `Date`, not a string. Handling only strings
 * makes this predicate return false for 100% of production assets while string-fixture tests
 * stay green. A zone-less YAML timestamp is parsed as UTC midnight, so the calendar day comes
 * from the UTC getters — the same reading `DisplayNameTemplateEngine.applyValueFormat` uses for
 * frontmatter dates.
 *
 * A quoted value arrives as a string; a value carrying a time component
 * (`2026-07-23T10:00:00`) compares by its calendar day. The array unwrap and bracket/quote
 * stripping mirror `PrintNameRuleService.resolveHostFunctionName`.
 */
function toDayKey(value: unknown): string | null {
  let raw = value;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    raw = raw[0];
  }

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${String(raw.getUTCFullYear()).padStart(4, "0")}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
  }
  if (typeof raw !== "string") return null;

  const cleaned = raw
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/^"|"$/g, "")
    .trim();
  const key = cleaned.slice(0, DAY_KEY_LENGTH);
  if (!DAY_KEY_RE.test(key)) return null;
  // The regex checks SHAPE only — "2026-13-45" and "2026-02-31" match it. Round-tripping
  // through Date.UTC rejects them, so "malformed → not ongoing" holds for quoted values too
  // (an unquoted typo never reaches here: YAML rolls it over into a Date).
  const [year, month, day] = key.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return key;
}

/**
 * True iff the episode's period contains today, boundaries INCLUSIVE.
 *
 * - `start` on or before today AND (`end` absent OR on or after today) → ongoing.
 * - An episode that has started and carries NO end counts as ongoing indefinitely. That is
 *   intended: the marker doubles as a "you forgot to close this" signal.
 * - Absent / malformed `start`, or a malformed `end`, → false (fail-closed). An asset that
 *   cannot be judged must not claim to be happening now.
 *
 * Day keys are `YYYY-MM-DD`, so lexicographic comparison is exact calendar order.
 *
 * ⛤ Takes no {@link VaultMetadataPort}: unlike its sibling it resolves no other asset, reading
 * only the rendered instance's own period. It is a host function rather than a value-equality
 * matcher purely because the comparand — TODAY — is ambient.
 */
export function isEpisodeOngoing(
  metadata: Record<string, unknown>,
  now: Date = new Date(),
): boolean {
  const start = toDayKey(metadata.life__Episode_start);
  if (start === null) return false;

  const today = localToday(now);
  if (start > today) return false;

  const rawEnd = metadata.life__Episode_end;
  const endIsAbsent =
    rawEnd === undefined ||
    rawEnd === null ||
    (Array.isArray(rawEnd) && rawEnd.length === 0) ||
    String(rawEnd).trim() === "";
  if (endIsAbsent) return true;

  const end = toDayKey(rawEnd);
  if (end === null) return false;
  return end >= today;
}

/**
 * The registry every surface should hand to `PrintNameRuleService` — the composition root's
 * one-liner for "register the built-in display-matcher host functions".
 *
 * ⛤ The predicates close over the port rather than reading the engine's opaque `host`, so a
 * caller need not also pass `host`: the CLI has no `App` to pass, and the plugin's own registry
 * keeps its `(app, metadata)` shape for backwards compatibility. Both end up in the same two
 * functions above.
 *
 * ⚠ Extending this registry is how a new spec-declarable predicate becomes available; the engine
 * looks names up at match time and stays fail-closed for anything absent, so an unknown name
 * degrades to "this spec does not participate" rather than to an error.
 */
export function createDisplayMatcherHostFunctions(
  vault: VaultMetadataPort,
): DisplayMatcherHostFunctionRegistry {
  return {
    isEffortBlocked: (_host, metadata) => isEffortBlocked(vault, metadata),
    isEpisodeOngoing: (_host, metadata) => isEpisodeOngoing(metadata),
  };
}
