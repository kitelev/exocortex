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
