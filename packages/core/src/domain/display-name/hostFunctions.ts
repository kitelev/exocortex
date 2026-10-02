import { EffortStatus } from "../constants/EffortStatus";
import { normalizeEffortStatus } from "../constants/EffortStatusCanon";
import type { DisplayMatcherHostFunctionRegistry } from "./PrintNameRuleService";
import type { VaultMetadataPort } from "./VaultMetadataPort";

/** Length of a `YYYY-MM-DD` calendar-day key. */
const DAY_KEY_LENGTH = 10;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A wall-clock key, `YYYY-MM-DDTHH:mm:ss` — the 19-character generalisation of the day key
 * (req 0fc2c853). Fixed-width zero-padded fields, so lexicographic comparison is exact
 * chronological order, exactly as it is for the 10-character form.
 *
 * The separator accepts a space as well as `T`, and the seconds are optional, because that is
 * what the SHIPPED RENDERER of the same two properties accepts
 * (`DisplayNameTemplateEngine.applyValueFormat`). Keeping the two readings identical is what
 * makes 📍 light at the time the user sees printed.
 */
const INSTANT_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * The built-in display-matcher host functions (req 5cd9fffe), living in core so BOTH surfaces
 * run the same predicate.
 *
 * A host function is the escape hatch a `exo__DisplayNameSpec` reaches for when its condition
 * cannot be phrased as value-equality, because it looks OUTWARD: at another asset
 * (`isEffortBlocked` resolves `ems__Effort_blocker` and reads ITS status) or at an ambient
 * comparand (`isEpisodeOngoing` compares against NOW, which no frontmatter carries).
 *
 * ⛤ These lived in the plugin until req 5cd9fffe, which is why the CLI naming oracle
 * (`resolve-display-name`, req f17f7c57) silently skipped the 2 specs of 35 that name them —
 * the engine is fail-closed, so an unregistered name means the spec simply never participates.
 * Measured 2026-08-15: 83 assets carry the properties these two read (74 `ems__Effort_blocker`
 * + 9 `life__Episode_start`). Re-measured in `vault-my` 2026-10-03, after the class gained
 * instant bounds: `life__Episode_start` 9, `_end` 8, `life__Episode_startTimestamp` **1**,
 * `_endTimestamp` **0** — so the instant branch (req 0fc2c853) is exercised by one live asset
 * and the acceptance case "📍 only inside the interval" cannot be shown on live data: no
 * episode carries a full interval yet. That is a fact about the corpus, not a gap in the axes.
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
 * ⛤ The dual-IRI defect this function shipped with is FIXED here (req d6cd2371 conformance):
 * the status is normalised to its symbolic label first, so all three legal wikilink forms compare
 * identically. Req 5cd9fffe moved the predicate to core verbatim, defect included, precisely so
 * that this one fix would repair BOTH surfaces at once — the plugin and the CLI now change
 * together, which is what "one implementation" was for. See `resolveStatusLabel` for the measured
 * incidence (49 of 58 blockers, 8 efforts with a wrong 🚩) and for why the lookup goes through the
 * vault rather than a UID table.
 *
 * ⛤ The ALIAS defect is fixed here too (issue #4057, same req-d6cd2371 conformance): the blocker
 * link is now unwrapped AND alias-stripped before the port sees it. It is inert today — measured
 * 2026-08-16, **0 of 74** live blockers carry an alias — but the reason to fix it is not the count,
 * it is that the surfaces DISAGREED: the CLI adapter strips the alias itself
 * (`FileSystemVaultAdapter.getFirstLinkpathDest` → `linkpath.split("|")[0]`) while Obsidian's
 * `metadataCache.getFirstLinkpathDest` does not, so `[[<uid>|label]]` resolved on one surface and
 * failed open on the other. That divergence is precisely what `FsVaultMetadataAdapter`'s docstring
 * promises cannot happen, and one implementation in core is what makes the promise keepable.
 *
 * ⛔ Count that incidence from RAW FRONTMATTER, never from SPARQL: the store emits the wikilink
 * TARGET and DISCARDS the alias, so a SPARQL count of "how many blockers are aliased" is
 * structurally blind and answers zero regardless of the data.
 *
 * ⛔ Still verbatim, and still deferred: a multi-valued `ems__Effort_blocker` is flattened by
 * `String(...)` into a comma-joined string that resolves to nothing, so the predicate answers
 * "not blocked". Characterised by test; its own fix, its own req.
 *
 * ⛔ Its incidence was recorded here as "16 of the 74" and that does NOT reproduce. Re-measured
 * 2026-08-16 across the three canonical vaults: **2** assets of the 70 carrying the property are
 * genuinely multi-valued (6 of the 74 values). 13 use YAML-list syntax, but 11 of those hold a
 * single item, and a one-element list flattens harmlessly. Corrected rather than quietly dropped:
 * the wrong number sat on the same line as a denominator that WAS verified, which is what made
 * the whole claim read as measured.
 *
 * ⚠ ONE delta is not verbatim and is accepted deliberately: the port retries the linkpath with a
 * `.md` suffix, which the inline original did not. It can only turn a previously UNRESOLVABLE
 * blocker into a resolvable one, and it is the same retry the engine has always done, so the two
 * callers now agree rather than differ.
 */
export function isEffortBlocked(
  vault: VaultMetadataPort,
  metadata: Record<string, unknown>,
): boolean {
  const effortBlocker = metadata.ems__Effort_blocker;
  if (!effortBlocker) {
    return false;
  }

  // ⛔ The ALIAS must come off before the port sees it. This is the port's own documented input
  // contract ({@link VaultMetadataPort.resolveLinkpathFrontmatter}: the engine hands over an
  // "unwrapped, alias-stripped target"), and the predicate was the one caller breaking it —
  // it stripped brackets only, so `[[<uid>|label]]` reached the adapter as `<uid>|label`.
  const blockerPath = unwrapWikilink(String(effortBlocker)).split("|")[0].trim();
  // ⛤ Both siblings guard the empty target (`resolveStatusLabel`: `if (inside === "") return ""`;
  // `createMetadataResolver`: `if (!cleaned) return null`) and this one did not. The truthiness
  // check above does NOT cover it: `"   "`, `"[[]]"`, `'""'`, `"[[.md]]"`, `"[[|label]]"` are all
  // truthy and all normalise to "". Harmless today — both adapters return null for an empty
  // linkpath — so this is consistency, not a fix, and it keeps the three callers reading alike.
  if (!blockerPath) {
    return false;
  }
  // The two Obsidian calls this replaces — getFirstLinkpathDest, then
  // getFileCache(...)?.frontmatter — are exactly what this port method does, on both adapters.
  const blockerMetadata = vault.resolveLinkpathFrontmatter(blockerPath);

  if (!blockerMetadata) {
    return false;
  }

  const label = resolveStatusLabel(vault, blockerMetadata.ems__Effort_status);

  return label !== EffortStatus.DONE && label !== EffortStatus.TRASHED;
}

/**
 * Unwrap a frontmatter wikilink into the string the port expects: quotes off, `[[ ]]` off, a
 * trailing `.md` off, trimmed.
 *
 * ⛔ Deliberately does NOT split the alias, because the two callers disagree about what an alias
 * MEANS: for a status, `[[<uid>|ems__EffortStatusDone]]` may itself be the answer (an alias that
 * is a symbolic label is honoured); for a blocker it is display text and nothing else. Sharing the
 * split would have to pick one of those, so the split stays at each call site and only the
 * unwrapping — where the two agree exactly — is shared.
 *
 * ⛤ Shared by the TWO callers in this file (`isEffortBlocked` and `resolveStatusLabel`) rather
 * than copied a third time, because a third inline copy is how the dual-IRI defect survived in
 * the first place — each copy is only ever checked by its own caller's tests.
 *
 * ⛔ It does NOT serve the whole display-name path, and unifying the rest is NOT a tidy-up.
 * Seven other inline unwrap chains remain (`toDayKey` below in this file;
 * `PrintNameRuleService` ×5; `DisplayNameResolver` ×1), and they are **deliberately** left alone:
 * measured over 36 inputs, this helper and the `PrintNameRuleService` chain disagree on **11** —
 * the copies strip brackets BEFORE quotes (so `[["weird"]]` → `weird` here but `"weird"` there),
 * this one also accepts `'`, and this one strips a trailing `.md` (`[[Note.md]]` → `Note` vs
 * `Note.md`). Replacing them with this helper would silently change matcher identity, key-path
 * resolution and the printed-property label hop. That is a behaviour change and needs its own req
 * — see #4056 for the sibling consolidation question.
 */
function unwrapWikilink(raw: string): string {
  return raw
    .trim()
    .replace(/^["']/, "")
    .replace(/["']$/, "")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/\.md$/, "")
    .trim();
}

/**
 * Normalise `ems__Effort_status` to its SYMBOLIC label (`ems__EffortStatusDone`), whichever legal
 * shape it was written in (req d6cd2371 conformance).
 *
 * ⛔ This is the dual-IRI fix. The predicate always compared against the symbolic label, but the
 * value is written several ways and only one survived a bare bracket strip:
 *
 *   `[[ems__EffortStatusDone]]`      → matched
 *   `[[<uid>]]`                      → left a UID; NEVER matched
 *   `[[<uid>|ems__…Done]]`           → left `<uid>|ems__…Done`; NEVER matched
 *
 * Measured 2026-08-15 across all three vaults: of the 49 blockers carrying a status, **49 use the
 * bare-UID form and zero use symbolic or alias** — i.e. broken for 100% of real blockers. It
 * stayed invisible only because a blocker is rarely finished.
 *
 * ⛔ An ALIAS is arbitrary display text, not an identifier — `[[<uid>|Done]]` is legal and says
 * nothing about the status. It is therefore honoured ONLY when it is itself a symbolic label;
 * otherwise the UID before the pipe is resolved. That is the port's own documented floor
 * ({@link VaultMetadataPort.resolveLinkpathFrontmatter}: "`[[uid|label]]` must resolve identically
 * to `[[uid]]`") and it matches both in-repo precedents, which key on the target rather than on
 * the alias.
 *
 * ⛤ Resolved through the vault rather than against a UID table. That table already exists TWICE —
 * `STATUS_UID_BY_ENUM` (`GroundingExecutor`) and `FALLBACK_EFFORT_STATUS_VALUES`
 * (`PropertySchemas`) — and BOTH had to be hand-edited when `ToDo`/`Analysis` were deleted on
 * 2026-08-13 (both cite req `fcbde537`). A third copy would be a third proven drift point, and
 * importing either into `domain/` would invert the layering.
 *
 * ⛔ That is a TRADE, not a strict improvement, and the next reader should not conclude otherwise:
 * a UID table rots when a status UID changes; this lookup rots when the status asset's
 * `exo__Asset_label` stops being exactly the enum string. Relabel it to `"Done"` and every blocker
 * reads as blocking — fail-safe and loud, but wrong. No test here can catch it: the ems submodule
 * is not mounted in this repo, which is why `GroundingExecutor.status_uid_integrity.test.ts`
 * asserts only the map's internal shape. The guarantee is the vault's, not the suite's.
 *
 * @see GroundingExecutor.resolveStatusFromFrontmatter — the same vocabulary, UID-table based
 * @see getStatusLabel in PropertySchemas — the same vocabulary again, for the property editor
 *
 * ⚠ Fail-safe: an unresolvable status returns the raw target, which matches neither terminal
 * label ⇒ "unknown status ⇒ still blocking". Note the deliberate ASYMMETRY with the caller — an
 * unresolvable BLOCKER yields `false` (not blocked), an unresolvable STATUS yields `true`. That
 * is not an oversight to be harmonised: the port distinguishes "no such asset" (`null`) from
 * "asset with nothing in it" (`{}`), and a blocker that does not exist cannot block, whereas a
 * blocker whose state is unknown must not be assumed finished.
 */
function resolveStatusLabel(vault: VaultMetadataPort, rawStatus: unknown): string {
  // ⛤ The parse is the ONE normaliser now (issue #4056); only the vault
  // fallback below is this caller's own — and it is the reason this reader
  // exists separately at all: `domain/` has no vault, so the shared function
  // stops at the UID table and hands the rest back here.
  const symbolic = normalizeEffortStatus(rawStatus);
  if (symbolic !== null) return symbolic;

  // Everything below is the fail-safe tail: a value the canon cannot read is
  // resolved THROUGH THE VAULT rather than declared unknown, because an
  // unresolvable status must not read as finished (see the caller's asymmetry
  // note). A multi-element list, however, stays unknown — the normaliser
  // returns null for it and there is no single target to resolve.
  let raw = rawStatus;
  if (raw === undefined || raw === null) return "";
  if (Array.isArray(raw)) {
    if (raw.length !== 1) return "";
    raw = raw[0];
  }

  const inside = unwrapWikilink(String(raw));
  if (inside === "") return "";
  const pipe = inside.indexOf("|");
  const target = pipe === -1 ? inside : inside.slice(0, pipe).trim();

  const fm = vault.resolveLinkpathFrontmatter(target);
  let label = fm?.exo__Asset_label;
  if (Array.isArray(label)) label = label[0];
  return typeof label === "string" && label.trim() ? label.trim() : target;
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

  const cleaned = unwrapDateish(raw);
  const key = cleaned.slice(0, DAY_KEY_LENGTH);
  if (!DAY_KEY_RE.test(key)) return null;
  // The regex checks SHAPE only — "2026-13-45" and "2026-02-31" match it. Round-tripping
  // through Date.UTC rejects them, so "malformed → not ongoing" holds for quoted values too
  // (an unquoted typo never reaches here: YAML rolls it over into a Date).
  const [year, month, day] = key.split("-").map(Number);
  if (!isRealCalendarDay(year, month, day)) return null;
  return key;
}

/**
 * Strip the frontmatter decoration a date-ish value may arrive wrapped in: brackets, quotes,
 * surrounding whitespace. Shared by the day key and the wall-clock key so the two agree on what
 * a value even IS before they disagree about its granularity.
 *
 * ⛔ Deliberately NOT shared with the seven other inline unwrap chains in the display-name path —
 * see {@link unwrapWikilink}'s note: they strip in a different ORDER and replacing them would
 * silently change matcher identity. That consolidation is issue #4056, not a tidy-up here.
 */
function unwrapDateish(raw: string): string {
  return raw
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/^"|"$/g, "")
    .trim();
}

/**
 * True iff `year-month-day` is a day that actually exists. Extracted from {@link toDayKey} so the
 * wall-clock key rejects "2026-02-31T10:00:00" by the same rule rather than by a second copy of it
 * — a second copy is only ever exercised by its own caller's tests, which is how the dual-IRI
 * defect in this very file survived three readings.
 */
function isRealCalendarDay(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * True iff a frontmatter value is ABSENT in the sense the episode predicate means: missing, null,
 * an empty list, or whitespace. Extracted verbatim from the end-bound check below so the day pair
 * and the instant pair answer "is this bound set?" identically.
 */
function isAbsentValue(raw: unknown): boolean {
  return (
    raw === undefined ||
    raw === null ||
    (Array.isArray(raw) && raw.length === 0) ||
    String(raw).trim() === ""
  );
}

/**
 * Normalise a frontmatter timestamp to its `YYYY-MM-DDTHH:mm:ss` WALL-CLOCK key — the clock as
 * WRITTEN in the file — or null when it is absent, empty or not a well-formed instant
 * (req 0fc2c853).
 *
 * ⛤ This reading is NOT a new convention: it is the one the already-shipped renderer of these two
 * properties uses. `DisplayNameTemplateEngine.applyValueFormat` takes its components literally
 * from the stored value — UTC getters for a `Date`, a regex over an ISO string — precisely because
 * a zone-less YAML timestamp is parsed as UTC, so a `Date`'s UTC fields ARE the digits the author
 * typed. Reading the predicate the same way makes the JUDGE agree with the DISPLAY: 📍 lights at
 * the time printed beside it.
 *
 * ⚠ Measured 2026-10-03 (js-yaml 5.4.2 under `YAML11_SCHEMA`, the schema
 * `FileSystemVaultAdapter` loads frontmatter with): an UNQUOTED `2026-08-10T07:00:00` arrives as a
 * **Date**, not a string — a zone-less value is read as that instant in UTC. Only the QUOTED form
 * stays a string. The task that commissioned this work recorded the opposite ("the `T` form
 * arrives as a string"); that note described the quoted case. Both branches are therefore live and
 * both are covered.
 *
 * ⛔ An explicit zone (`…Z`, `±HH:MM`) is IGNORED, in both branches and for the same reason: the
 * renderer ignores it too, so honouring it here alone would light the marker at a time other than
 * the one on screen. Latent today — the canonical writer
 * (`DateFormatter.toLocalTimestamp`) emits no suffix and 1 of 1 live carriers is zone-less — and
 * deliberately left to the standing single-source-of-TZ question, where the renderer and this
 * predicate must move together.
 *
 * A DATE-ONLY value in a timestamp property reads as that day's midnight: the same reading the day
 * key makes in reverse, and the only one that keeps an open episode's marker behaving as it does
 * for a day-bounded one.
 */
function toWallClockKey(value: unknown): string | null {
  let raw = value;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    raw = raw[0];
  }

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = `${String(raw.getUTCFullYear()).padStart(4, "0")}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
    return `${day}T${pad(raw.getUTCHours())}:${pad(raw.getUTCMinutes())}:${pad(raw.getUTCSeconds())}`;
  }
  if (typeof raw !== "string") return null;

  const cleaned = unwrapDateish(raw);
  const match = INSTANT_KEY_RE.exec(cleaned);
  if (match === null) {
    // No time component at all → midnight of that day, if the day itself is well-formed.
    const day = toDayKey(cleaned);
    return day === null ? null : `${day}T00:00:00`;
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  if (!isRealCalendarDay(Number(year), Number(month), Number(day))) return null;
  // The regex pins the WIDTH of each field, not its range: "25:61" matches it. A wall clock the
  // calendar cannot name must fail closed rather than sort after every real "now".
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds ?? "0") > 59) return null;
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds ?? "00"}`;
}

/**
 * NOW as the same `YYYY-MM-DDTHH:mm:ss` wall-clock key, built from the LOCAL getters.
 *
 * Same local basis as {@link localToday} and the `$today` / `$nowLocal` date-token line: the
 * comparand for "is this happening now" is the clock the user is reading, not UTC.
 */
function localNowKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${localToday(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * True iff the episode's period contains NOW, boundaries INCLUSIVE.
 *
 * The class carries TWO period formats and they are mutually exclusive per episode (founder
 * interview 2026-08-07, decision 2) — so which one is read is decided by the data, not by a
 * setting:
 *
 * - **Instant bounds** (`life__Episode_startTimestamp` / `_endTimestamp`, req 0fc2c853) — judged
 *   against the current wall clock to the second. A two-hour flight is therefore marked for two
 *   hours, which is the whole point: under a day-truncating reading both of its bounds collapse to
 *   today and 📍 burns from midnight to midnight.
 * - **Day bounds** (`life__Episode_start` / `_end`, req 8a47ff93) — judged against TODAY, exactly
 *   as before, INCLUDING a value that carries a time component, which still compares by its
 *   calendar day. Day granularity is the right answer for most episodes and is not deprecated.
 *
 * Shared by both readings:
 *
 * - A bound that has started and carries NO end counts as ongoing indefinitely. That is intended:
 *   the marker doubles as a "you forgot to close this" signal.
 * - Absent / malformed start, or a malformed end, → false (fail-closed). An asset that cannot be
 *   judged must not claim to be happening now.
 * - Keys are fixed-width and zero-padded (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm:ss`), so lexicographic
 *   comparison is exact chronological order.
 *
 * ⛔ A PRESENT but unreadable `life__Episode_startTimestamp` fails closed and does **not** fall
 * back to the day pair. A junk instant must not be silently answered at a coarser granularity:
 * that would turn "I cannot read this" into "it is happening", which is the one direction this
 * predicate must never fail in.
 *
 * ⛔ The instant pair WINS over a co-present day pair. Unobservable in a conformant corpus (the
 * two formats are exclusive), specified so a non-conformant asset gets a deterministic answer
 * rather than one that depends on the order the properties happen to be read in — and never a
 * MIXTURE of the two, which is what the exclusivity decision forbids.
 *
 * ⛤ Takes no {@link VaultMetadataPort}: unlike its sibling it resolves no other asset, reading
 * only the rendered instance's own period. It is a host function rather than a value-equality
 * matcher purely because the comparand — NOW — is ambient.
 */
export function isEpisodeOngoing(
  metadata: Record<string, unknown>,
  now: Date = new Date(),
): boolean {
  const rawStartInstant = metadata.life__Episode_startTimestamp;
  if (!isAbsentValue(rawStartInstant)) {
    return isInstantPeriodOngoing(rawStartInstant, metadata.life__Episode_endTimestamp, now);
  }

  const start = toDayKey(metadata.life__Episode_start);
  if (start === null) return false;

  const today = localToday(now);
  if (start > today) return false;

  const rawEnd = metadata.life__Episode_end;
  if (isAbsentValue(rawEnd)) return true;

  const end = toDayKey(rawEnd);
  if (end === null) return false;
  return end >= today;
}

/**
 * The instant-bounded half of {@link isEpisodeOngoing}, structurally identical to the day-bounded
 * half one granularity finer — same inclusivity, same open-end reading, same fail-closed
 * direction. Split out rather than inlined so the two readings can be seen to be the same shape,
 * and so neutralising one in a revert-verify leaves the other visibly untouched.
 */
function isInstantPeriodOngoing(rawStart: unknown, rawEnd: unknown, now: Date): boolean {
  const start = toWallClockKey(rawStart);
  if (start === null) return false;

  const nowKey = localNowKey(now);
  if (start > nowKey) return false;

  if (isAbsentValue(rawEnd)) return true;

  const end = toWallClockKey(rawEnd);
  if (end === null) return false;
  return end >= nowKey;
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
