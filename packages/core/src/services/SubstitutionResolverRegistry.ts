/**
 * SubstitutionResolverRegistry — central map of token resolver-id → handler
 * function for the RFC 727572d2 RDF-driven asset creation pipeline.
 *
 * Tokens are vault assets (`exocmd__SubstitutionToken` instances) that declare
 * a string `_resolver` literal; this registry maps that literal to a TS
 * function that produces the substitution value at execute time. Adding a new
 * token vocabulary entry usually means (a) creating the vault asset and (b)
 * registering a resolver here under the same id — no other code changes.
 *
 * Resolver functions receive a {@link ResolverContext} bundle and an optional
 * string parameter (from `exocmd__TokenInvocation_parameter`). They return
 * either a final string (most cases) or `string[]` for list-typed properties
 * (e.g. `$labelAsArray` → `[label]`).
 *
 * RFC 727572d2-194b-4a4d-8a5a-585a1d3bac8e.
 */

import { DateFormatter } from "../utilities/DateFormatter";

/**
 * Runtime context made available to resolver functions. Optional fields permit
 * use in test/CLI harnesses where some context (target frontmatter, grounding
 * targetClass) is not always available.
 */
export interface ResolverContext {
  /** Modal-collected user input, keyed by property local name. */
  readonly userInput?: Record<string, unknown>;
  /** Click-target asset's IRI value (vault wikilink-resolvable). */
  readonly targetIRI?: string;
  /** Click-target asset's vault-relative file path. */
  readonly targetFilePath?: string;
  /** Click-target asset's parsed frontmatter (read once per executeCreateInstance). */
  readonly targetFm?: Record<string, unknown>;
  /** UID-canon class ref baked into the active Grounding (already resolved by executor). */
  readonly groundingTargetClassUid?: string;
}

/**
 * Resolver function signature. Returns either a string value (for scalar
 * frontmatter writes) or `string[]` (for multi-valued writes like `aliases`).
 * `null` signals "skip this PropertyDefault entry" (e.g. required context
 * missing).
 */
export type ResolverFn = (
  ctx: ResolverContext,
  parameter?: string,
) => string | string[] | null;

const _resolvers = new Map<string, ResolverFn>();

/**
 * Ids of resolvers that consume the optional `parameter` as an inline
 * MODIFIER (date format / offset suffix — Веха 5 / Templater `tp.date.*`
 * parity). The TemplateBodyResolver captures `$date+7d:YYYY-MM-DD`-style
 * suffixes and forwards them as `parameter` to these resolvers, which bake the
 * value in. For resolvers NOT in this set the body resolver reproduces the
 * suffix verbatim, so a legacy token like `$today+7d` stays `<date>+7d` exactly
 * as before this feature (zero regression). See {@link isResolverModifierAware}.
 */
const _modifierAware = new Set<string>();

/**
 * Register a resolver. Idempotent overwrite — last registration wins. Tests
 * may inject deterministic resolvers (e.g. fixed UUID, fixed timestamp);
 * production wiring at package init time installs the live implementations.
 *
 * @param modifierAware when true, marks this resolver as consuming the inline
 *        `parameter` modifier (date format/offset, Веха 5). Defaults to false
 *        so every existing call site keeps legacy "ignore the suffix" behaviour.
 */
export function registerResolver(
  id: string,
  fn: ResolverFn,
  modifierAware = false,
): void {
  _resolvers.set(id, fn);
  if (modifierAware) _modifierAware.add(id);
}

export function getResolver(id: string): ResolverFn | undefined {
  return _resolvers.get(id);
}

/**
 * True when the resolver `id` consumes the inline `parameter` modifier (date
 * format/offset suffix). The body resolver uses this to decide whether the
 * captured `$token<suffix>` suffix was already baked into the value (aware →
 * yes) or must be reproduced verbatim (not aware → legacy behaviour).
 */
export function isResolverModifierAware(id: string): boolean {
  return _modifierAware.has(id);
}

export function getRegisteredResolverIds(): string[] {
  return Array.from(_resolvers.keys());
}

export function clearResolvers(): void {
  _resolvers.clear();
  _modifierAware.clear();
}

// -- Built-in resolvers (RFC 727572d2 Phase A2 vocabulary) --

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// -- Date format + offset tokens (Веха 5 — Templater `tp.date.*` parity) --
//
// Templater's `tp.date.now(format, offset)` / `tp.date.tomorrow(format)` /
// `tp.date.yesterday(format)` produce a formatted, optionally day-shifted date.
// The homoiconic equivalent is an inline `$token<offset><:format>` suffix on a
// date token (`$date`, `$now`, `$tomorrow`, `$yesterday`), e.g.
//   $date                  → 2026-06-21          (default YYYY-MM-DD)
//   $date:DD.MM.YYYY        → 21.06.2026
//   $date+7d                → 2026-06-28          (+7 days, default format)
//   $date+1M:YYYY-MM         → 2026-07
//   $now:HH:mm:ss            → 14:30:05
//   $tomorrow / $yesterday   → ±1 day convenience tokens
// The TemplateBodyResolver parses the suffix and forwards it as `parameter`;
// these resolvers own offset+format parsing (self-contained semantics). All
// arithmetic/formatting uses plain `Date` + hardcoded English names — NO Node
// `fs`, NO `Intl` — so it behaves identically on desktop and mobile (Desktop↔
// Mobile command parity invariant).

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const DAY_NAMES_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/** English ordinal day-of-month (1 → "1st", 22 → "22nd", 11 → "11th"). */
function ordinalDay(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
}

/**
 * moment-style format tokens, longest-first so the alternation never mis-splits
 * (`YYYY` before `YY`, `MMMM` before `MM`, `dddd` before `ddd`, `DD`/`Do` before
 * `D`). `String.replace` does not re-scan substituted output, so a month name
 * like "June" is never re-matched. Unrecognised characters (`-`, `:`, `/`, `.`,
 * `T`, spaces, …) pass through literally — e.g. ISO `YYYY-MM-DDTHH:mm:ss` keeps
 * its `-`, `T`, `:` separators.
 */
const DATE_FORMAT_RE =
  /YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g;

/** Format a Date with a moment-style format string (local time, English names). */
function formatDate(d: Date, format: string): string {
  const h12 = ((d.getHours() + 11) % 12) + 1;
  return format.replace(DATE_FORMAT_RE, (tok) => {
    switch (tok) {
      case "YYYY":
        return String(d.getFullYear());
      case "YY":
        return pad2(d.getFullYear() % 100);
      case "MMMM":
        return MONTH_NAMES[d.getMonth()];
      case "MMM":
        return MONTH_NAMES_SHORT[d.getMonth()];
      case "MM":
        return pad2(d.getMonth() + 1);
      case "M":
        return String(d.getMonth() + 1);
      case "Do":
        return ordinalDay(d.getDate());
      case "DD":
        return pad2(d.getDate());
      case "D":
        return String(d.getDate());
      case "dddd":
        return DAY_NAMES[d.getDay()];
      case "ddd":
        return DAY_NAMES_SHORT[d.getDay()];
      case "HH":
        return pad2(d.getHours());
      case "H":
        return String(d.getHours());
      case "hh":
        return pad2(h12);
      case "h":
        return String(h12);
      case "mm":
        return pad2(d.getMinutes());
      case "m":
        return String(d.getMinutes());
      case "ss":
        return pad2(d.getSeconds());
      case "s":
        return String(d.getSeconds());
      case "A":
        return d.getHours() < 12 ? "AM" : "PM";
      case "a":
        return d.getHours() < 12 ? "am" : "pm";
      default:
        return tok;
    }
  });
}

/**
 * Add `n` months/years to `d` with moment-style day CLAMPING (matches
 * Templater's `tp.date.*`): if the source day-of-month does not exist in the
 * target month it is clamped to that month's last day rather than rolling over.
 *   Jan 31 +1M  → Feb 28 (or 29)   NOT Mar 3 (raw `Date.setMonth` roll-over)
 *   Feb 29 +1y  → Feb 28           NOT Mar 1
 * Implemented by parking the day at 1 before the shift (so `setMonth` never
 * rolls), then clamping to `min(originalDay, lastDayOfTargetMonth)`.
 */
function addMonthsClamped(d: Date, n: number, unit: "M" | "y"): Date {
  const day = d.getDate();
  const r = new Date(d.getTime());
  r.setDate(1);
  if (unit === "M") r.setMonth(r.getMonth() + n);
  else r.setFullYear(r.getFullYear() + n);
  // Last day of the (now day-1) target month — day 0 of the next month.
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, lastDay));
  return r;
}

/**
 * Shift `d` by a signed offset string `[+-]\d+[dwMy]?` (`d`ays default, `w`eeks,
 * `M`onths, `y`ears — moment convention: `M`=month, lowercase reserved). Month/
 * year shifts CLAMP to the last valid day (moment/Templater parity, see
 * {@link addMonthsClamped}). A malformed offset — or one that overflows the
 * representable Date range — leaves the date unchanged (lenient: a freeform body
 * must never throw or emit `NaN`). Returns a NEW Date (does not mutate input).
 */
function applyDateOffset(d: Date, offset: string | null): Date {
  if (!offset) return d;
  const m = offset.match(/^([+-])(\d+)([dwMy])?$/);
  if (!m) return d;
  const n = (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10);
  const unit = m[3] ?? "d";
  let r = new Date(d.getTime());
  switch (unit) {
    case "d":
      r.setDate(r.getDate() + n);
      break;
    case "w":
      r.setDate(r.getDate() + n * 7);
      break;
    case "M":
      r = addMonthsClamped(r, n, "M");
      break;
    case "y":
      r = addMonthsClamped(r, n, "y");
      break;
  }
  // Overflow (e.g. an absurd day count) → Invalid Date. Stay lenient: fall back
  // to the unshifted date rather than formatting `NaN-NaN-NaN`.
  return isNaN(r.getTime()) ? d : r;
}

/**
 * Split a date modifier `parameter` into its offset and format parts. The FIRST
 * `:` separates offset from format; everything after it is the format (which may
 * itself contain `:` for time, e.g. `HH:mm:ss`). Either part may be absent:
 *   "+7d:YYYY-MM-DD" → { offset: "+7d", format: "YYYY-MM-DD" }
 *   ":HH:mm"          → { offset: null,  format: "HH:mm" }
 *   "+7d"             → { offset: "+7d", format: null }
 *   undefined/""      → { offset: null,  format: null }
 */
function parseDateModifier(parameter?: string): {
  offset: string | null;
  format: string | null;
} {
  if (!parameter) return { offset: null, format: null };
  const colon = parameter.indexOf(":");
  // `parameter` is guaranteed non-empty here (the `!parameter` guard above
  // returns early), so `parameter || null` was a no-op `|| null` — dropped
  // to clear the js/trivial-conditional alert (#3696) without behaviour change.
  if (colon < 0) return { offset: parameter, format: null };
  const offsetPart = parameter.slice(0, colon);
  const format = parameter.slice(colon + 1);
  return { offset: offsetPart || null, format: format || null };
}

/**
 * Build a date resolver with a base day shift and a default format. The inline
 * modifier (offset + format) is applied ON TOP of the base shift, so
 * `$tomorrow+7d` is base +1 then +7 = +8 days. Ignores `ctx` (date tokens are
 * context-free).
 */
function makeDateResolver(
  baseDayShift: number,
  defaultFormat: string,
): ResolverFn {
  return (_ctx, parameter) => {
    const { offset, format } = parseDateModifier(parameter);
    let d = new Date();
    if (baseDayShift !== 0) d.setDate(d.getDate() + baseDayShift);
    d = applyDateOffset(d, offset);
    return formatDate(d, format ?? defaultFormat);
  };
}

/**
 * Install the default Phase A2 resolver set. Idempotent — safe to call from
 * multiple entry points (CLI bootstrap, plugin bootstrap, test setup). Tests
 * may call {@link clearResolvers} first to start from empty state.
 */
export function installDefaultResolvers(): void {
  // -- Existing tokens (legacy parity) — modifier-UNAWARE --
  // req 5c47471a / #3807 — `today` returns today's LOCAL calendar day. The
  // former UTC form (`toISOString().slice(0,10)`) mis-fired just after local
  // midnight in a UTC+N timezone to YESTERDAY's local date and disagreed with
  // the already-local `$date` resolver. Local getters match `$date`/`$tomorrow`
  // (no hardcoded timezone). Kept modifier-UNAWARE (no `makeDateResolver`) to
  // preserve the documented `isResolverModifierAware("today") === false`.
  registerResolver("today", () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  });
  // #3811 — `todayStart` returns today's LOCAL day at midnight in the
  // timezone-naive `YYYY-MM-DDT00:00:00` shape (via
  // `DateFormatter.getTodayStartTimestamp`), matching the executor's
  // `$todayStart` (`${today}T00:00:00`) and the effort/timestamp frontmatter
  // convention. The former `new Date(...setHours(0,0,0,0)).toISOString()` form
  // emitted a UTC Z-instant (`...T00:00:00.000Z`) — same instant, but a
  // different string shape that disagreed with the executor form under
  // lexicographic comparison. Now both `$todayStart` paths share one shape.
  registerResolver("todayStart", () => DateFormatter.getTodayStartTimestamp());

  // -- Date format + offset tokens (Веха 5 — Templater `tp.date.*` parity) --
  // modifier-AWARE: the inline `$token<offset><:format>` suffix is consumed and
  // baked into the value. `now` defaults to a datetime shape (tp.date.now);
  // `date`/`tomorrow`/`yesterday` default to a calendar date.
  registerResolver("date", makeDateResolver(0, "YYYY-MM-DD"), true);
  registerResolver("now", makeDateResolver(0, "YYYY-MM-DDTHH:mm:ss"), true);
  registerResolver("tomorrow", makeDateResolver(1, "YYYY-MM-DD"), true);
  registerResolver("yesterday", makeDateResolver(-1, "YYYY-MM-DD"), true);
  // `target` and `targetFolder` are context-dependent — executor resolves them
  // from marker form; they're registered here too for symmetry but their
  // handlers fall back to empty when context missing.
  registerResolver("target", (ctx) => {
    if (!ctx.targetIRI) return "";
    return `"[[${ctx.targetIRI}]]"`;
  });
  registerResolver("targetFolder", (ctx) => {
    if (!ctx.targetFilePath) return "";
    const normalized = ctx.targetFilePath.replace(/^\/+/, "");
    const slashIdx = normalized.lastIndexOf("/");
    return slashIdx >= 0 ? normalized.slice(0, slashIdx) : "";
  });

  // -- RFC 727572d2 Phase A2 new vocabulary --

  registerResolver("randomUUIDv4", () => {
    // crypto.randomUUID() — Node 14.17+ / modern browsers / Obsidian Electron.
    // No Math.random fallback (ARCH-008 SEC-001 / Math.random not crypto-safe).
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
    throw new Error(
      "randomUUIDv4 resolver requires crypto.randomUUID() — runtime is missing Node crypto / Web Crypto API.",
    );
  });

  registerResolver("nowTimestamp", () => {
    // Local ISO 8601 without TZ suffix — mirrors DateFormatter.toLocalTimestamp
    // shape used by all other creation services (Issue #3188).
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  });

  registerResolver("nowDate", () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  });

  registerResolver("nowYear", () => String(new Date().getFullYear()));

  registerResolver("nowMonth", () => pad2(new Date().getMonth() + 1));

  registerResolver("userInputLabel", (ctx) => {
    const label = ctx.userInput?.label;
    return typeof label === "string" ? label : "";
  });

  registerResolver("userInput", (ctx, parameter) => {
    if (!parameter) return null;
    const v = ctx.userInput?.[parameter];
    return typeof v === "string" ? v : v == null ? null : String(v);
  });

  registerResolver("targetProperty", (ctx, parameter) => {
    if (!parameter || !ctx.targetFm) return null;
    const v = ctx.targetFm[parameter];
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) return v.map(String);
    return String(v);
  });

  registerResolver("labelAsArray", (ctx) => {
    const label = ctx.userInput?.label;
    return typeof label === "string" && label.length > 0 ? [label] : [];
  });

  registerResolver("groundingTargetClass", (ctx) => {
    if (!ctx.groundingTargetClassUid) return null;
    return `"[[${ctx.groundingTargetClassUid}]]"`;
  });

  // -- "Create Instance" homoiconic button (T1, project bbe40f8c) --
  //
  // `targetClassSelf` — the click-target IS the class definition (`exo__Class`
  // instance), so the new asset's `exo__Instance_class` must point back at the
  // host file's own UID. This inverts `groundingTargetClass` (which reads a
  // class baked into the Grounding): here the class is the host, discovered
  // from `targetFilePath` basename (UID-canon filenames guarantee
  // basename === uid). Returns a quoted wikilink so it serialises identically
  // to the other class-ref defaults. `null` when no target file path is in
  // context (CLI/test harness without a click target).
  registerResolver("targetClassSelf", (ctx) => {
    if (!ctx.targetFilePath) return null;
    const normalized = ctx.targetFilePath.replace(/^\/+/, "");
    const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
    const uid = fileName.replace(/\.md$/i, "");
    return uid.length > 0 ? `"[[${uid}]]"` : null;
  });
}
