/**
 * DisplayNameTemplateEngine - Renders display names from templates
 *
 * Template syntax:
 * - {{field}} - Replaced with frontmatter field value
 * - {{field.nested}} - Dot-notation for nested fields (e.g., {{custom.priority}})
 * - {{_basename}} - Original filename without extension
 * - {{_created}} - File creation date
 *
 * Special handling:
 * - Wikilink syntax [[link]] is stripped from values
 * - Empty template results fall back to label or basename
 *
 * Example templates:
 * - "{{exo__Asset_label}}" - Just the label (default)
 * - "{{exo__Asset_label}}: {{ems__Effort_status}}" - Label with status
 * - "[{{exo__Instance_class}}] {{exo__Asset_label}}" - Class prefix
 * - "{{_basename}} - {{exo__Asset_label}}" - Filename with label
 */
import { resolveKeyPath, type MetadataResolver } from "./keyPathResolver";

export type { MetadataResolver };

/**
 * The compiled form of `exo__PrintedPropertyValueSourceDisplayName` — the suffix a placeholder
 * carries when its part asked for the target's COMPOSED name (req ff1482f2).
 *
 * ⛔ ONE constant for BOTH halves of the round trip. `PrintNameRuleService` writes the suffix and
 * this file reads it back; with a literal on each side nothing links them, and an edit to one
 * alone would break the feature silently — no test would notice, because each side's fixtures
 * would still agree with its own copy (review of #4311).
 */
export const COMPOSED_SOURCE_MARKER = "displayName";

/**
 * What one render pass counted: how many `{{placeholder}}`s the template NAMED, and how many of
 * them substituted to something non-empty. Exported as ONE named type so the engine and a caller
 * reading the counts cannot drift apart if a field is ever added (review of PR #4366, LOW-3).
 */
export interface PlaceholderStats {
  placeholders: number;
  nonEmpty: number;
}

/** What a compiled placeholder actually carries: `{{key!displayName}}` / `{{key::FMT!displayName}}`. */
const COMPOSED_SOURCE_SUFFIX = `!${COMPOSED_SOURCE_MARKER}`;

export class DisplayNameTemplateEngine {
  private static readonly PLACEHOLDER_PATTERN = /\{\{([^}]+)\}\}/g;
  private static readonly WIKILINK_PATTERN = /^\[\[|\]\]$/g;
  private static readonly UUID_PATTERN =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  /**
   * @param options.joinArrayValues OPT-IN (default false). When true, a `{{key}}` placeholder
   *   resolving to an ARRAY renders ALL its values joined by a space (dropping any value that
   *   resolves only to a bare UID — fail-closed) instead of first-only. Used by the concept
   *   definition composition (a multi-valued `concept__Concept_differentia` renders all
   *   adjectives). Default (false) is first-only — so the displayName path (which renders the
   *   multi-valued `{{exo__Instance_class}}` in the default classSuffix template) is UNCHANGED.
   * @param options.separator OPT-IN (default undefined). The vault-declared
   *   `exo__DisplayNameSpec_separator`. When a non-empty string, the template renders in
   *   SEPARATOR MODE: it is split into FIELDS on this literal separator, each field is rendered
   *   and cleaned INDEPENDENTLY, a field that renders empty is DROPPED together with its
   *   adjacent separator, and the survivors are re-joined by the separator. Absent → the
   *   original single-pass path, byte-identical (onto-RFC 0ba349ed, issue #4012).
   * @param options.nestedDisplayName OPT-IN (default absent). Asked for the COMPOSED displayName
   *   of a referenced asset, and asked ONLY where this engine would otherwise print the bare
   *   linkpath — i.e. when the reference carries no display alias AND the target has no
   *   `exo__Asset_label`. In a UID-canon vault that fallback is a bare UID, which is not a name
   *   but the absence of one leaking into a sibling's title (req 0f992e88, issue #4303). The hop
   *   is supplied by `DisplayNameResolver`, which owns the recursion and its bounds; an engine
   *   constructed WITHOUT it is byte-identical to before the requirement.
   */
  constructor(
    private readonly template: string,
    private readonly options: {
      joinArrayValues?: boolean;
      separator?: string;
      nestedDisplayName?: (
        wikilink: string,
        targetMetadata?: Record<string, unknown> | null,
      ) => string | null;
    } = {},
  ) {}

  /**
   * Render the template with provided metadata
   *
   * @param metadata - Frontmatter metadata object
   * @param basename - Original filename without extension
   * @param createdDate - Optional file creation date
   * @returns Rendered display name, or null if template produces empty result
   */
  render(
    metadata: Record<string, unknown>,
    basename: string,
    createdDate?: Date,
    metadataResolver?: MetadataResolver,
    onPlaceholderStats?: (stats: PlaceholderStats) => void,
  ): string | null {
    if (!this.template || this.template.trim() === "") {
      return null;
    }

    const separator = this.options.separator;
    if (separator) {
      return this.renderWithSeparator(
        separator,
        metadata,
        basename,
        createdDate,
        metadataResolver,
      );
    }

    // ⛤ Count, while substituting, how many placeholders rendered to something. A template
    // whose placeholders ALL came back empty produced only its own literals — `Q2-`, `2025-`,
    // `-W`, `-` — and that is not a name: it outranks the asset's correct exo__Asset_label
    // purely because its provenance is `spec` (req c67e4c69).
    let placeholders = 0;
    let nonEmpty = 0;
    const result = this.renderSegment(
      this.template,
      metadata,
      basename,
      createdDate,
      metadataResolver,
      () => {
        placeholders += 1;
      },
      () => {
        nonEmpty += 1;
      },
    );

    // Hand the SAME pass's counts to a caller that needs a stricter verdict than this method's
    // own (#4359 wants "EVERY named slot rendered", not "at least one did"). Deliberately
    // reported from here and NOT recomputed by the caller: a second parse of the template would
    // be a second opinion on emptiness, which is exactly what renderSegment's docblock warns
    // against. ⛔ NOT reported on the separator path — that mode drops empty fields BY DESIGN,
    // so "every slot non-empty" is not a meaningful question there; a caller that needs the
    // guarantee must treat a missing report as "cannot vouch" rather than as "all present".
    onPlaceholderStats?.({ placeholders, nonEmpty });

    // Separator mode already declines in this situation ("the affixes alone are not a name");
    // this is the same judgement on the plain path, minus ONE case. ⛔ The exception is not
    // defensive: declining hands the caller null, and a caller with no exo__Asset_label falls
    // through to the BASENAME — which for a UID-canon asset is a bare UID inside a title, the
    // exact defect req 0f992e88 exists to prevent. There the literals, poor as they are, are
    // the lesser evil (measured: 3 live assets, all affix-only specs).
    if (placeholders > 0 && nonEmpty === 0 && DisplayNameTemplateEngine.hasReadableFallback(metadata, basename)) {
      return null;
    }

    // Clean up the result to handle edge cases from missing values
    const cleanedResult = this.cleanupResult(result);

    // Return null if template produces empty or whitespace-only result
    if (cleanedResult === "") {
      return null;
    }

    return cleanedResult;
  }

  /**
   * Would declining (returning null) leave the caller with something READABLE?
   *
   * A caller that gets null falls back to `exo__Asset_label`, and failing that to the file's
   * basename. So declining is an improvement exactly when one of those two is a name — and a
   * UUID basename is not (req 0f992e88: a bare UID inside a title is the defect, not the cure).
   *
   * ⛔ A BLANK basename is not a name either, and it fails the UUID test, so testing only for
   * "is it a UUID" would answer "readable" for a caller that has NOTHING to fall back to. The
   * public entry `render()` is reachable with `basename: ""` — `ConceptDefinitionResolver`
   * passes that literal — so the case is not hypothetical, and blank is judged BEFORE the
   * UUID test rather than through it.
   */
  private static hasReadableFallback(
    metadata: Record<string, unknown>,
    basename: string,
  ): boolean {
    const label = metadata.exo__Asset_label;
    if (typeof label === "string" && label.trim() !== "") return true;
    const trimmed = basename.trim();
    if (trimmed === "") return false;
    return !DisplayNameTemplateEngine.UUID_PATTERN.test(trimmed);
  }

  /**
   * Substitute every {{placeholder}} in a template segment.
   *
   * `onPlaceholder` / `onNonEmpty` let the caller count what the substitution produced without
   * re-running it — the emptiness verdict must be taken from the SAME pass that builds the
   * string, or the two could disagree.
   */
  private renderSegment(
    segment: string,
    metadata: Record<string, unknown>,
    basename: string,
    createdDate?: Date,
    metadataResolver?: MetadataResolver,
    onPlaceholder?: () => void,
    onNonEmpty?: () => void,
  ): string {
    return segment.replace(
      DisplayNameTemplateEngine.PLACEHOLDER_PATTERN,
      (_, key: string) => {
        const trimmedKey = key.trim();
        onPlaceholder?.();
        const value = this.resolveValue(
          trimmedKey,
          metadata,
          basename,
          createdDate,
          metadataResolver,
        );
        if (value.trim() !== "") onNonEmpty?.();
        return value;
      },
    );
  }

  /**
   * SEPARATOR MODE (opt-in, `exo__DisplayNameSpec_separator`): join the NON-EMPTY fields.
   *
   * The split happens on the TEMPLATE — deliberately BEFORE substitution — so a rendered VALUE
   * that itself contains the separator (a dish called "Кофе · Латте") is never cut into pieces.
   * Each field is cleaned with the SAME cleanupResult as the default path, so a field is
   * considered empty when its cleaned render is "" (value missing OR whitespace-only). Survivors
   * are re-joined by the separator verbatim, so a hanging separator around a dropped field is
   * structurally impossible.
   *
   * Only the CORE region is split into fields — the leading literal (before the first
   * placeholder) and the trailing literal (after the last placeholder) are AFFIXES, not fields.
   * That is what keeps a composed prefix marker attached to the name rather than becoming a
   * field of its own: composing a "🍽 " prefix spec over a separator-bearing core must render
   * "🍽 Тирамису · Teplo", never "🍽 · Тирамису · Teplo" (req 1a6525eb, AC-D).
   */
  private renderWithSeparator(
    separator: string,
    metadata: Record<string, unknown>,
    basename: string,
    createdDate?: Date,
    metadataResolver?: MetadataResolver,
  ): string | null {
    const first = this.template.indexOf("{{");
    const last = this.template.lastIndexOf("}}");
    if (first === -1 || last === -1 || last < first) {
      // No placeholder at all → nothing to collapse; fall back to the default single pass.
      const cleaned = this.cleanupResult(
        this.renderSegment(this.template, metadata, basename, createdDate, metadataResolver),
      );
      return cleaned === "" ? null : cleaned;
    }

    const prefix = this.template.slice(0, first);
    const core = this.template.slice(first, last + 2);
    const suffix = this.template.slice(last + 2);

    const rendered: string[] = [];
    for (const field of DisplayNameTemplateEngine.splitOutsidePlaceholders(
      core,
      separator,
    )) {
      const cleaned = this.cleanupResult(
        this.renderSegment(field, metadata, basename, createdDate, metadataResolver),
      );
      if (cleaned !== "") {
        rendered.push(cleaned);
      }
    }

    // Every field empty → the affixes alone are not a name; fall back (null) to label/basename.
    if (rendered.length === 0) {
      return null;
    }

    const renderedPrefix = this.renderSegment(
      prefix,
      metadata,
      basename,
      createdDate,
      metadataResolver,
    );
    const renderedSuffix = this.renderSegment(
      suffix,
      metadata,
      basename,
      createdDate,
      metadataResolver,
    );

    const joined = `${renderedPrefix}${rendered.join(separator)}${renderedSuffix}`.trim();
    return joined === "" ? null : joined;
  }

  /**
   * Split the core into fields on `separator`, but NEVER inside a `{{…}}`
   * placeholder.
   *
   * A plain `core.split(separator)` cuts the TEMPLATE, and a placeholder can
   * legitimately contain the separator inside its per-part value format:
   * `{{ems__Effort_endTimestamp::YYYY-MM-DD HH:mm}}` under
   * `exo__DisplayNameSpec_separator: " "`. The naive split produced
   * `{{…::YYYY-MM-DD` and `HH:mm}}`, neither of which is a placeholder, so the
   * raw template text leaked into the rendered name — silently, and only for
   * specs whose format happens to contain the separator character.
   *
   * Reach, measured over all three canonical vaults on 2026-08-15 (the specs
   * live in shared assetspaces, so the three vaults agree): 3 specs declare a
   * separator — `06606775` uses `" "`, `b836acf7` and `4ee3522b` use `" · "` —
   * and BOTH shipped space-bearing formats (`DD.MM.YYYY HH:mm`, on `e8ded318`
   * and `e910fa27`) belong to `" · "` specs. So the naive split never cut a
   * name shipped to date; the defect goes live with the first spec that pairs
   * `separator: " "` with a time-bearing format. Prospective, not current.
   *
   * Splitting outside placeholders is byte-identical for every template whose
   * placeholders do NOT contain the separator (i.e. every spec authored before
   * a space-bearing format existed), so this is a strict widening.
   *
   * An unterminated `{{` (malformed template) is treated as literal text — the
   * scan falls through to the character-by-character branch rather than
   * swallowing the remainder of the core.
   */
  private static splitOutsidePlaceholders(
    core: string,
    separator: string,
  ): string[] {
    if (separator.length === 0) return [core];

    const fields: string[] = [];
    let buffer = "";
    let i = 0;
    while (i < core.length) {
      if (core.startsWith("{{", i)) {
        const end = core.indexOf("}}", i + 2);
        if (end !== -1) {
          buffer += core.slice(i, end + 2);
          i = end + 2;
          continue;
        }
      }
      if (core.startsWith(separator, i)) {
        fields.push(buffer);
        buffer = "";
        i += separator.length;
        continue;
      }
      buffer += core[i];
      i += 1;
    }
    fields.push(buffer);
    return fields;
  }

  /**
   * Clean up rendered result to handle edge cases from missing values
   *
   * Handles cases like:
   * - Empty parentheses at end: "Label ()" -> "Label"
   * - Empty brackets at end: "Label []" -> "Label"
   * - Empty parentheses at start: "() Label" -> "Label"
   * - Standalone parentheses: "()" -> ""
   * - Leading/trailing separators after empty values
   *
   * Note: Only removes empty brackets at string boundaries to avoid
   * affecting content like "function() {}" which is valid text.
   */
  private cleanupResult(result: string): string {
    let cleaned = result;

    // Remove empty parentheses at end of string: "Label ()" -> "Label"
    cleaned = cleaned.replace(/\s+\(\s*\)$/g, "");

    // Remove empty parentheses at start of string: "() Label" -> "Label"
    cleaned = cleaned.replace(/^\(\s*\)\s+/g, "");

    // Remove standalone parentheses (entire string): "()" -> ""
    if (cleaned === "()") {
      cleaned = "";
    }

    // Remove empty brackets at end of string: "Label []" -> "Label"
    cleaned = cleaned.replace(/\s+\[\s*\]$/g, "");

    // Remove empty brackets at start of string: "[] Label" -> "Label"
    cleaned = cleaned.replace(/^\[\s*\]\s+/g, "");

    // Remove standalone brackets (entire string): "[]" -> ""
    if (cleaned === "[]") {
      cleaned = "";
    }

    // Remove multiple consecutive spaces
    cleaned = cleaned.replace(/\s+/g, " ");

    // Trim and return
    return cleaned.trim();
  }

  /**
   * Resolve a placeholder value
   */
  private resolveValue(
    key: string,
    metadata: Record<string, unknown>,
    basename: string,
    createdDate?: Date,
    metadataResolver?: MetadataResolver
  ): string {
    // Handle special variables
    if (key === "_basename") {
      return basename;
    }

    if (key === "_created") {
      if (createdDate) {
        return this.formatDate(createdDate);
      }
      return "";
    }

    // Optional per-part value format (`exo__PrintedProperty_format`), compiled into the
    // placeholder as `{{key::FORMAT}}`. The format MUST travel with the placeholder because it
    // is declared per PART, while the compiled artifact is ONE template string per spec.
    // `::` is a reserved sequence of the template micro-syntax: frontmatter keys have the shape
    // `prefix__Name` and never contain it. Split on the FIRST `::`; a trailing empty format is
    // ignored (the key is then used verbatim).
    const { path, format, preferComposed } = DisplayNameTemplateEngine.splitKeyAndFormat(key);

    // A part may declare an ORDERED PREFERENCE LIST rather than one key —
    // `exo__PrintedProperty_property` as a multi-value wikilink list, compiled
    // into `{{a|b|c::FORMAT}}` by PrintNameRuleService. Semantics: FIRST
    // NON-EMPTY wins; the shared `format` applies to whichever candidate won.
    //
    // WHY a list and not N parts: N separate parts would print EVERY candidate
    // that happens to be set (an effort with both an end and a start timestamp
    // would render both), which is not a preference — it is a concatenation.
    //
    // `|` is safe as the separator for the same reason `::` is: a frontmatter
    // key has the shape `prefix__Name` and a dot-path `a.b` — neither can
    // contain it. A single-candidate path (every template authored before this)
    // takes the loop's first iteration and behaves byte-identically.
    const candidates = path.includes("|")
      ? path
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0)
      : [path];

    let lastRendered = "";
    for (const candidate of candidates) {
      // Handle dot notation for nested fields (with cross-asset resolution)
      const value = this.getNestedValue(metadata, candidate, metadataResolver);

      let rendered: string;
      if (format) {
        // Format the RAW value — BEFORE formatValue, which would JSON.stringify a Date into
        // `"2026-01-24T13:50:17.000Z"` (quotes included) and lose the literal digits.
        const formatted = DisplayNameTemplateEngine.applyValueFormat(value, format);
        // Fail-open: unrecognised value → print it as usual.
        rendered =
          formatted !== null
            ? formatted
            : this.formatValue(value, metadataResolver, preferComposed);
      } else {
        rendered = this.formatValue(value, metadataResolver, preferComposed);
      }

      if (rendered !== "") return rendered;
      lastRendered = rendered;
    }

    // Every candidate resolved empty — return the empty string so the
    // separator-mode join drops the field together with its separator, exactly
    // as a single absent property already did.
    return lastRendered;
  }

  /**
   * Split a placeholder key into its frontmatter path, its optional value format, and its
   * optional VALUE SOURCE.
   *
   * The source rides in the placeholder as `!displayName` for the same reason the format rides
   * as `::FORMAT`: both are declared per PART, while the compiled artifact is ONE template string
   * per spec (req ff1482f2).
   *
   * ⛔ Anchored on the SUFFIX, not on the first `!`. The frontmatter key cannot contain one —
   * it is `prefix__Name` or a dot-path `a.b` — but the FORMAT can: `exo__PrintedProperty_format`
   * documents every non-token character as a literal, so `DD!MM` is a legal format. With
   * `indexOf` the compiled `{{key::DD!MM!displayName}}` matched the `!` INSIDE the format, the
   * marker branch never fired, and the part rendered `20!09!displayName` — the marker leaking
   * into the output AND the declared source silently dropped (review of #4311). The compiler
   * always appends the marker last, so the suffix is the only place it can legitimately be.
   */
  private static splitKeyAndFormat(key: string): {
    path: string;
    format?: string;
    preferComposed?: boolean;
  } {
    let rest = key;
    let preferComposed = false;
    const trimmedKey = rest.trimEnd();
    if (
      trimmedKey.length > COMPOSED_SOURCE_SUFFIX.length &&
      trimmedKey.endsWith(COMPOSED_SOURCE_SUFFIX)
    ) {
      preferComposed = true;
      rest = trimmedKey.slice(0, -COMPOSED_SOURCE_SUFFIX.length).trim();
    }

    const idx = rest.indexOf("::");
    if (idx <= 0) return preferComposed ? { path: rest, preferComposed } : { path: rest };
    const path = rest.slice(0, idx).trim();
    const format = rest.slice(idx + 2).trim();
    if (!path || !format) return preferComposed ? { path: rest, preferComposed } : { path: rest };
    return preferComposed ? { path, format, preferComposed } : { path, format };
  }

  /**
   * Apply a vault-declared value format (`exo__PrintedProperty_format`) to a raw frontmatter
   * value. v1 vocabulary — date/time only: YYYY, YY, MM, DD, HH, mm, ss (every other character
   * of the format is a literal, so "DD.MM" → "31.07").
   *
   * The components are taken LITERALLY from the stored value — a regex over the ISO string, and
   * UTC getters for a Date (YAML reads a zone-less timestamp as UTC). No local-time conversion,
   * so the printed digits equal the digits written in the file and the result does not depend on
   * the machine's timezone.
   *
   * Returns null (→ the caller prints the value unchanged, FAIL-OPEN) when the value is not a
   * recognisable date/time, OR when any token of the format cannot be filled from it — the
   * engine never fabricates zeros for missing components.
   */
  private static applyValueFormat(value: unknown, format: string): string | null {
    let raw = value;
    if (Array.isArray(raw)) {
      if (raw.length === 0) return null;
      raw = raw[0];
    }

    let year: string, month: string, day: string;
    let hours: string | undefined, minutes: string | undefined, seconds: string | undefined;

    if (raw instanceof Date) {
      if (Number.isNaN(raw.getTime())) return null;
      const pad = (n: number) => String(n).padStart(2, "0");
      year = String(raw.getUTCFullYear()).padStart(4, "0");
      month = pad(raw.getUTCMonth() + 1);
      day = pad(raw.getUTCDate());
      hours = pad(raw.getUTCHours());
      minutes = pad(raw.getUTCMinutes());
      seconds = pad(raw.getUTCSeconds());
    } else if (typeof raw === "string") {
      const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
      if (!m) return null;
      year = m[1];
      month = m[2];
      day = m[3];
      hours = m[4];
      minutes = m[5];
      seconds = m[6];
    } else {
      return null;
    }

    let unfillable = false;
    const out = format.replace(/YYYY|YY|MM|DD|HH|mm|ss/g, (token) => {
      switch (token) {
        case "YYYY":
          return year;
        case "YY":
          return year.slice(-2);
        case "MM":
          return month;
        case "DD":
          return day;
        case "HH":
          if (hours === undefined) unfillable = true;
          return hours ?? "";
        case "mm":
          if (minutes === undefined) unfillable = true;
          return minutes ?? "";
        case "ss":
          if (seconds === undefined) unfillable = true;
          return seconds ?? "";
        default:
          return token;
      }
    });

    return unfillable ? null : out;
  }

  /**
   * Get nested value from object using dot notation.
   *
   * Delegates to the shared `resolveKeyPath` so a `{{a.b}}` template placeholder and an
   * `exo__DisplayNameSpec_matchPath` dot-path (req fedeaa6e) resolve by the SAME rules.
   */
  private getNestedValue(
    obj: Record<string, unknown>,
    path: string,
    metadataResolver?: MetadataResolver
  ): unknown {
    return resolveKeyPath(obj, path, metadataResolver);
  }

  /**
   * Format a string value, handling wikilink syntax:
   * - [[target|alias]] → alias
   * - [[target]] with metadataResolver → resolved exo__Asset_label
   * - [[target]] without resolver → target (stripped brackets)
   */
  private formatWikilinkValue(
    value: string,
    metadataResolver?: MetadataResolver,
    preferComposed = false,
  ): string {
    // Match wikilink pattern: [[target]] or [[target|alias]]
    const match = value.match(/^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]$/);
    if (!match) {
      // Not a wikilink — strip any partial bracket syntax
      return value.replace(DisplayNameTemplateEngine.WIKILINK_PATTERN, "").trim();
    }

    const target = match[1].trim();
    const alias = match[2]?.trim();

    // An authored alias is the data author's own override and wins over every declaration,
    // including a part asking for the composed name (req ff1482f2).
    if (alias) {
      return alias;
    }

    // Resolve the target ONCE and reuse the result for both the label read and the composed-name
    // hop. Without that the hop would dereference the SAME target a second time, and for the
    // filesystem adapter a dereference is a `readFileSync` — i.e. every label-less or dangling
    // reference in a vault sweep would cost two disk reads instead of one (review of #4303).
    const resolvedTarget = metadataResolver ? metadataResolver(value) : undefined;
    const rawLabel = resolvedTarget?.exo__Asset_label;
    const label = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : null;

    const composed = (): string | null => {
      const rendered = this.options.nestedDisplayName?.(value, resolvedTarget);
      return rendered !== null && rendered !== undefined && rendered.trim() !== ""
        ? rendered.trim()
        : null;
    };

    // ⛤ The ORDER is the whole contract of the two requirements this method carries.
    //
    // Without a declaration (req 0f992e88): label → composed → linkpath. The composed name is
    // asked for ONLY where the value printed so far stops being a name — `target` is a bare UID
    // in a UID-canon vault — so an asset that HAS a label keeps printing it and nothing rendered
    // today changes (measured 2026-09-20 on this branch: 0 of 51 052 live assets rendered
    // differently across the three canonical vaults — a SNAPSHOT of those corpora, not an
    // invariant; the axes below are what actually holds the ordering).
    //
    // With `exo__PrintedProperty_valueSource = …SourceDisplayName` (req ff1482f2): composed →
    // label → linkpath. The declaration is a PREFERENCE, not a guarantee: when nothing composes
    // (no participating spec, a cycle, the depth cap) the label is still printed.
    if (preferComposed) {
      const preferred = composed();
      if (preferred !== null) return preferred;
    }

    if (label !== null) return label;

    if (!preferComposed) {
      const fallback = composed();
      if (fallback !== null) return fallback;
    }

    // Fallback: return target without brackets
    return target;
  }

  /**
   * Format a value for display.
   * Parses wikilinks to extract alias or resolve label via metadataResolver.
   */
  private formatValue(
    value: unknown,
    metadataResolver?: MetadataResolver,
    preferComposed = false,
  ): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return this.formatWikilinkValue(value, metadataResolver, preferComposed);
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return "";
      }
      if (this.options.joinArrayValues) {
        // Opt-in (definition composition): render ALL values joined by a space, dropping any
        // value that resolves only to a bare UID (fail-closed). The default path is first-only.
        const parts: string[] = [];
        for (const item of value) {
          const formatted = this.formatValue(item, metadataResolver, preferComposed);
          if (formatted && !DisplayNameTemplateEngine.UUID_PATTERN.test(formatted)) {
            parts.push(formatted);
          }
        }
        return parts.join(" ");
      }
      // For arrays, use the first value (default — displayName path, unchanged).
      return this.formatValue(value[0], metadataResolver, preferComposed);
    }

    if (typeof value === "object") {
      // For objects, try to stringify
      return JSON.stringify(value);
    }

    return String(value);
  }

  /**
   * Format a date for display
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Get the template string
   */
  getTemplate(): string {
    return this.template;
  }

  /**
   * Check if template is valid (has at least one placeholder)
   */
  isValid(): boolean {
    if (!this.template || this.template.trim() === "") {
      return false;
    }
    // Use a fresh regex without 'g' flag to avoid state issues
    return /\{\{[^}]+\}\}/.test(this.template);
  }

  /**
   * Extract all placeholder keys from template
   */
  getPlaceholders(): string[] {
    const placeholders: string[] = [];
    const regex = /\{\{([^}]+)\}\}/g;
    let match;

    while ((match = regex.exec(this.template)) !== null) {
      placeholders.push(match[1].trim());
    }

    return placeholders;
  }
}

/**
 * Preset templates for common display name patterns
 */
export const DISPLAY_NAME_PRESETS = {
  default: {
    name: "Label only (default)",
    template: "{{exo__Asset_label}}",
  },
  labelWithStatus: {
    name: "Label with status",
    template: "{{exo__Asset_label}}: {{ems__Effort_status}}",
  },
  classPrefix: {
    name: "Class prefix",
    template: "[{{exo__Instance_class}}] {{exo__Asset_label}}",
  },
  classSuffix: {
    name: "Class suffix",
    template: "{{exo__Asset_label}} ({{exo__Instance_class}})",
  },
  basenameWithLabel: {
    name: "Filename with label",
    template: "{{_basename}} - {{exo__Asset_label}}",
  },
  datePrefix: {
    name: "Date prefix",
    template: "{{_created}} - {{exo__Asset_label}}",
  },
} as const;

export type DisplayNamePresetKey = keyof typeof DISPLAY_NAME_PRESETS;

/**
 * Default template (shows label with class suffix for consistent display across all asset types)
 */
export const DEFAULT_DISPLAY_NAME_TEMPLATE = DISPLAY_NAME_PRESETS.classSuffix.template;
