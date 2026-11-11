/**
 * DirectionalLangTagTransformer - Transforms SPARQL 1.2 directional language tags.
 *
 * SPARQL 1.2 introduces directional language tags with the syntax `@lang--dir`
 * where `dir` is either "ltr" (left-to-right) or "rtl" (right-to-left).
 *
 * Since sparqljs doesn't support this syntax natively, this transformer:
 * 1. Extracts direction info from language tags
 * 2. Transforms the query to use regular language tags for parsing
 * 3. Stores direction information for post-processing
 *
 * Examples:
 * - `"مرحبا"@ar--rtl` → `"مرحبا"@ar` (with direction="rtl" stored)
 * - `"Hello"@en--ltr` → `"Hello"@en` (with direction="ltr" stored)
 * - `"Bonjour"@fr` → `"Bonjour"@fr` (no change, no direction)
 *
 * @see https://w3c.github.io/rdf-dir-literal/
 */

export type BaseDirection = "ltr" | "rtl";

export interface DirectionMapping {
  /** The language tag without direction suffix */
  language: string;
  /** The direction extracted from the tag */
  direction: BaseDirection;
  /** Original full tag including direction */
  originalTag: string;
}

export class DirectionalLangTagTransformer {
  /**
   * Regex to find directional language tags.
   * Matches patterns like @ar--rtl or @en-US--ltr after a string literal.
   *
   * Pattern breakdown:
   * - (`["'])  - Opening quote (captured for reference)
   * - ((?:[^\\]|\\.)*?)  - String content (non-greedy, handles escapes)
   * - \1  - Matching closing quote
   * - @  - Language tag marker
   * - ([a-zA-Z]+(?:-[a-zA-Z0-9]+)*)  - Language tag (e.g., en, ar, en-US)
   * - --  - Direction separator
   * - (ltr|rtl)  - Direction value
   */
  private static readonly DIRECTIONAL_TAG_REGEX =
    /(["'])((?:[^\\]|\\.)*?)\1@([a-zA-Z]+(?:-[a-zA-Z0-9]+)*)--(ltr|rtl)/g;

  /**
   * Stores mappings from transformed language tags to their original direction info.
   * Key: normalized lowercase language tag, Value: direction
   */
  private directionMappings: Map<string, BaseDirection> = new Map();

  /**
   * Transform a SPARQL query by converting directional language tags to regular tags.
   *
   * @param query - The SPARQL query string with potential directional language tags
   * @returns The transformed query with direction suffixes removed
   */
  transform(query: string): string {
    this.directionMappings.clear();

    return query.replace(
      DirectionalLangTagTransformer.DIRECTIONAL_TAG_REGEX,
      (_match, quote, stringContent, langTag, direction) => {
        // Store the direction mapping
        const normalizedLang = langTag.toLowerCase();
        this.directionMappings.set(normalizedLang, direction as BaseDirection);

        // Return the literal without direction suffix
        return `${quote}${stringContent}${quote}@${langTag}`;
      }
    );
  }

  /**
   * Like `transform`, but the direction stays with ITS literal: `"x"@ar--rtl` is
   * rewritten to `"x"@ar-x-exodir-rtl` — a private-use subtag sparqljs accepts as
   * part of an ordinary language tag — and `restoreDirections` turns the parsed
   * tag back into `ar` plus `direction: "rtl"` on that very term. The language-keyed
   * map (`getDirection`) cannot tell `"x"@ar--rtl` from `"y"@ar` in one query, and
   * nothing hands it to the translator anyway (ems__Bug 0b24c745). The map is
   * still filled for the public API.
   */
  encode(query: string): string {
    this.directionMappings.clear();

    return query.replace(
      DirectionalLangTagTransformer.DIRECTIONAL_TAG_REGEX,
      (_match, quote, stringContent, langTag, direction) => {
        this.directionMappings.set(langTag.toLowerCase(), direction as BaseDirection);
        return `${quote}${stringContent}${quote}@${langTag}${DirectionalLangTagTransformer.DIRECTION_SUBTAG}${direction}`;
      }
    );
  }

  /** Subtag `encode` appends before the direction; sparqljs lower-cases the tag. */
  static readonly DIRECTION_SUBTAG = "-x-exodir-";

  private static readonly ENCODED_TAG_REGEX = /^(.+)-x-exodir-(ltr|rtl)$/;

  private static readonly ENCODED_IN_TEXT_REGEX = /@([a-zA-Z]+(?:-[a-zA-Z0-9]+)*?)-x-exodir-(ltr|rtl)/g;

  /**
   * Split a language tag written by `encode` into the language and its direction;
   * any other tag comes back unchanged with no direction.
   */
  static splitEncodedLanguage(tag: string): { language: string; direction?: BaseDirection } {
    const m = DirectionalLangTagTransformer.ENCODED_TAG_REGEX.exec(tag);
    return m ? { language: m[1], direction: m[2] as BaseDirection } : { language: tag };
  }

  /**
   * Walk a sparqljs AST produced from an `encode`d query and give every literal
   * whose tag `encode` marked its own `direction`, restoring the plain language
   * tag (`ar-x-exodir-rtl` → `language: "ar"`, `direction: "rtl"`). Mutates in place.
   */
  static restoreDirections(ast: unknown): void {
    const seen = new WeakSet<object>();
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      const rec = node as Record<string, unknown>;
      // encode() rewrites the raw query text, a string literal's contents included
      // ('a "x"@ar--rtl b'): give that text back verbatim.
      if (rec.termType === "Literal" && typeof rec.value === "string" && rec.value.includes("-x-exodir-")) {
        rec.value = rec.value.replace(
          DirectionalLangTagTransformer.ENCODED_IN_TEXT_REGEX,
          (_m: string, lang: string, dir: string) => `@${lang}--${dir}`,
        );
      }
      if (rec.termType === "Literal" && typeof rec.language === "string" && rec.language) {
        const { language, direction } = DirectionalLangTagTransformer.splitEncodedLanguage(rec.language);
        if (direction) {
          rec.language = language;
          rec.direction = direction;
        }
      }
      for (const key of Object.keys(rec)) walk(rec[key]);
    };
    walk(ast);
  }

  /**
   * Check if a language tag has a direction mapping stored.
   *
   * @param languageTag - The language tag to check (will be normalized to lowercase)
   * @returns The direction if found, undefined otherwise
   */
  getDirection(languageTag: string): BaseDirection | undefined {
    return this.directionMappings.get(languageTag.toLowerCase());
  }

  /**
   * Get all stored direction mappings.
   *
   * @returns Map of language tags to their directions
   */
  getAllMappings(): Map<string, BaseDirection> {
    return new Map(this.directionMappings);
  }

  /**
   * Check if the query contains any directional language tags.
   *
   * @param query - The SPARQL query string to check
   * @returns true if the query contains directional language tags
   */
  hasDirectionalTags(query: string): boolean {
    DirectionalLangTagTransformer.DIRECTIONAL_TAG_REGEX.lastIndex = 0;
    return DirectionalLangTagTransformer.DIRECTIONAL_TAG_REGEX.test(query);
  }

  /**
   * Clear all stored direction mappings.
   * Call this before processing a new query.
   */
  clearMappings(): void {
    this.directionMappings.clear();
  }
}

/**
 * Error thrown when directional language tag transformation fails.
 */
export class DirectionalLangTagTransformerError extends Error {
  constructor(message: string) {
    super(`Directional language tag transformation error: ${message}`);
    this.name = "DirectionalLangTagTransformerError";
  }
}
