import type { RDFTerm } from "./types";

import { IRI } from "../../../../domain/models/rdf/IRI";
import { Literal } from "../../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../../domain/models/rdf/BlankNode";

export class StringFunctions {
  static str(term: RDFTerm | undefined): string {
    if (term === undefined) {
      throw new Error("STR: argument is undefined");
    }

    if (term instanceof IRI) {
      return term.value;
    }

    if (term instanceof Literal) {
      return term.value;
    }

    if (term instanceof BlankNode) {
      return term.id;
    }

    return String(term);
  }

  static lang(term: RDFTerm | undefined): string {
    if (term === undefined) {
      throw new Error("LANG: argument is undefined");
    }

    if (term instanceof Literal && term.language) {
      return term.language;
    }

    return "";
  }

  /**
   * SPARQL 1.2 LANGDIR function.
   * https://w3c.github.io/sparql-12/spec/
   *
   * Returns the combined language tag and base direction from a directional literal.
   * The format is `lang--dir` (e.g., `"ar--rtl"`, `"en--ltr"`).
   *
   * For non-directional language-tagged literals, returns just the language tag.
   * For non-literals or literals without language tags, returns empty string.
   *
   * @param term - RDF term to extract language direction from
   * @returns String in format "lang--dir", "lang", or "" depending on the term
   *
   * @example
   * // Directional literal with rtl direction
   * LANGDIR("مرحبا"@ar--rtl) → "ar--rtl"
   *
   * // Directional literal with ltr direction
   * LANGDIR("Hello"@en--ltr) → "en--ltr"
   *
   * // Non-directional language-tagged literal
   * LANGDIR("Hello"@en) → "en"
   *
   * // Plain literal (no language tag)
   * LANGDIR("Hello") → ""
   *
   * // IRI (not a literal)
   * LANGDIR(<http://example.org>) → ""
   */
  static langdir(term: RDFTerm | undefined): string {
    if (term === undefined) {
      throw new Error("LANGDIR: argument is undefined");
    }

    if (!(term instanceof Literal)) {
      return "";
    }

    if (!term.language) {
      return "";
    }

    // If the literal has a direction, return "lang--dir" format
    if (term.direction) {
      return `${term.language}--${term.direction}`;
    }

    // No direction, just return the language tag
    return term.language;
  }

  /**
   * SPARQL 1.1/1.2 langMatches function with direction-aware extension.
   * https://www.w3.org/TR/sparql11-query/#func-langMatches
   *
   * Matches a language tag against a language range per RFC 4647 basic filtering.
   * Extended to support directional language tags in the format "lang--dir".
   *
   * @param languageTag - The language tag to check (e.g., "en", "en-US", "ar--rtl")
   * @param languageRange - The language range to match against (e.g., "en", "*", "ar--rtl")
   * @returns true if the language tag matches the range, false otherwise
   *
   * Special cases:
   * - Range "*" matches any non-empty language tag (including directional)
   * - Empty language tag matches nothing (except empty range for exact match)
   * - Case-insensitive comparison (per RFC 4647)
   *
   * Direction-aware matching (SPARQL 1.2 extension):
   * - Tags can include direction: "ar--rtl", "he--rtl", "en--ltr"
   * - Language-only range matches any direction: LANGMATCHES("ar--rtl", "ar") → true
   * - Exact direction match: LANGMATCHES("ar--rtl", "ar--rtl") → true
   * - Direction mismatch returns false: LANGMATCHES("ar--rtl", "ar--ltr") → false
   */
  static langMatches(languageTag: string, languageRange: string): boolean {
    // Parse direction from tag (format: "lang--dir")
    const [tagLang, tagDir] = StringFunctions.parseDirectionalLangTag(languageTag);
    const [rangeLang, rangeDir] = StringFunctions.parseDirectionalLangTag(languageRange);

    // Normalize both language parts to lowercase for case-insensitive comparison
    const tag = tagLang.toLowerCase();
    const range = rangeLang.toLowerCase();

    // Special case: "*" matches any non-empty language tag
    if (range === "*") {
      // Direction doesn't matter for wildcard - just check language is non-empty
      return tag !== "";
    }

    // Empty tag matches nothing (except empty range for exact match)
    if (tag === "") {
      return range === "";
    }

    // Check direction match if range specifies a direction
    // If range has no direction, match any direction in tag
    if (rangeDir && tagDir !== rangeDir) {
      return false;
    }

    // Exact match
    if (tag === range) {
      return true;
    }

    // Prefix match: tag starts with range followed by "-"
    // e.g., "en-US" matches "en", "en-GB-oed" matches "en-GB"
    return tag.startsWith(range + "-");
  }

  /**
   * Parses a directional language tag into language and direction components.
   *
   * @param tag - The language tag, possibly with direction (e.g., "ar--rtl", "en")
   * @returns Tuple of [language, direction] where direction may be undefined
   *
   * Examples:
   * - parseDirectionalLangTag("ar--rtl") → ["ar", "rtl"]
   * - parseDirectionalLangTag("en-US--ltr") → ["en-US", "ltr"]
   * - parseDirectionalLangTag("en") → ["en", undefined]
   * - parseDirectionalLangTag("en-US") → ["en-US", undefined]
   */
  private static parseDirectionalLangTag(
    tag: string
  ): [string, string | undefined] {
    const dirSeparatorIndex = tag.indexOf("--");
    if (dirSeparatorIndex === -1) {
      return [tag, undefined];
    }

    const language = tag.substring(0, dirSeparatorIndex);
    const direction = tag.substring(dirSeparatorIndex + 2).toLowerCase();

    return [language, direction];
  }

  /**
   * SPARQL REGEX function with Unicode support.
   *
   * Per SPARQL 1.1 specification, REGEX is based on XPath/XQuery regex which
   * uses XSD patterns that are Unicode-aware by default. To match this behavior
   * in JavaScript, we always include the 'u' (Unicode) flag.
   *
   * This enables:
   * - Case-insensitive matching for non-ASCII characters (Cyrillic, Greek, etc.)
   * - Unicode character classes like \p{L} (any letter), \p{N} (any number)
   *
   * @param text - The text to match against
   * @param pattern - The regex pattern (XPath/XSD regex syntax)
   * @param flags - Optional flags: 's' (dotall), 'm' (multiline), 'i' (case-insensitive), 'x' (extended)
   * @returns true if pattern matches text
   */
  static regex(text: string, pattern: string, flags?: string): boolean {
    try {
      // Always add 'u' flag for Unicode-aware matching (SPARQL 1.1 compliance)
      // This enables proper Cyrillic/Unicode case-insensitive matching and \p{} classes
      const unicodeFlags = flags ? (flags.includes("u") ? flags : flags + "u") : "u";
      const regex = new RegExp(pattern, unicodeFlags);
      return regex.test(text);
    } catch (error) {
      throw new Error(`REGEX: invalid pattern '${pattern}': ${(error as Error).message}`);
    }
  }

  // W3C SPARQL 1.1 String Functions
  // https://www.w3.org/TR/sparql11-query/#func-contains

  static contains(str: string, substr: string): boolean {
    return str.includes(substr);
  }

  static strStarts(str: string, prefix: string): boolean {
    return str.startsWith(prefix);
  }

  static strEnds(str: string, suffix: string): boolean {
    return str.endsWith(suffix);
  }

  static strlen(str: string): number {
    return str.length;
  }

  static ucase(str: string): string {
    return str.toUpperCase();
  }

  static lcase(str: string): string {
    return str.toLowerCase();
  }

  /**
   * SPARQL 1.1 SUBSTR function.
   * https://www.w3.org/TR/sparql11-query/#func-substr
   *
   * @param str - Source string
   * @param start - Starting position (1-based, per SPARQL spec)
   * @param length - Optional length of substring
   * @returns Substring from position start with optional length
   */
  static substr(str: string, start: number, length?: number): string {
    // SPARQL uses 1-based indexing, JavaScript uses 0-based
    const startIndex = start - 1;

    if (startIndex < 0) {
      // For negative start, adjust length and start from 0
      if (length !== undefined) {
        const adjustedLength = length + startIndex;
        if (adjustedLength <= 0) {
          return "";
        }
        return str.substring(0, adjustedLength);
      }
      return str;
    }

    if (length !== undefined) {
      return str.substring(startIndex, startIndex + length);
    }

    return str.substring(startIndex);
  }

  /**
   * SPARQL 1.1 STRBEFORE function.
   * https://www.w3.org/TR/sparql11-query/#func-strbefore
   *
   * Returns the substring before the first occurrence of the separator.
   * Returns empty string if separator not found or str is empty.
   *
   * @param str - Source string
   * @param separator - Separator to search for
   * @returns Substring before separator, or empty string if not found
   */
  static strBefore(str: string, separator: string): string {
    if (separator === "") {
      return "";
    }
    const index = str.indexOf(separator);
    if (index === -1) {
      return "";
    }
    return str.substring(0, index);
  }

  /**
   * SPARQL 1.1 STRAFTER function.
   * https://www.w3.org/TR/sparql11-query/#func-strafter
   *
   * Returns the substring after the first occurrence of the separator.
   * Returns empty string if separator not found or str is empty.
   *
   * @param str - Source string
   * @param separator - Separator to search for
   * @returns Substring after separator, or empty string if not found
   */
  static strAfter(str: string, separator: string): string {
    if (separator === "") {
      return str;
    }
    const index = str.indexOf(separator);
    if (index === -1) {
      return "";
    }
    return str.substring(index + separator.length);
  }

  /**
   * SPARQL 1.1 CONCAT function.
   * https://www.w3.org/TR/sparql11-query/#func-concat
   *
   * Concatenates multiple string arguments.
   *
   * @param strings - Strings to concatenate
   * @returns Concatenated result
   */
  static concat(...strings: string[]): string {
    return strings.join("");
  }

  /**
   * SPARQL 1.1 REPLACE function with Unicode support.
   * https://www.w3.org/TR/sparql11-query/#func-replace
   *
   * Always includes 'u' flag for Unicode-aware matching (SPARQL 1.1 compliance).
   */
  static replace(str: string, pattern: string, replacement: string, flags?: string): string {
    try {
      // Always add 'u' flag for Unicode-aware matching, ensure 'g' flag is present for replace
      const baseFlags = flags || "g";
      const unicodeFlags = baseFlags.includes("u") ? baseFlags : baseFlags + "u";
      const regex = new RegExp(pattern, unicodeFlags);
      return str.replace(regex, replacement);
    } catch (error) {
      throw new Error(`REPLACE: invalid pattern '${pattern}': ${(error as Error).message}`);
    }
  }

  // SPARQL 1.1 String Functions (URI)
  // https://www.w3.org/TR/sparql11-query/#func-encode

  /**
   * SPARQL 1.1 ENCODE_FOR_URI function.
   * https://www.w3.org/TR/sparql11-query/#func-encode
   *
   * Percent-encodes a string for safe inclusion in a URI.
   * Encodes all characters except unreserved characters (A-Z, a-z, 0-9, -, _, ., ~).
   *
   * @param str - String to encode
   * @returns Percent-encoded string
   *
   * Examples:
   * - ENCODE_FOR_URI("hello world") → "hello%20world"
   * - ENCODE_FOR_URI("a/b?c=d") → "a%2Fb%3Fc%3Dd"
   * - ENCODE_FOR_URI("Los Angeles") → "Los%20Angeles"
   */
  static encodeForUri(str: string): string {
    return encodeURIComponent(str);
  }

  // =========================================================================
  // SPARQL 1.2 NORMALIZE Function (Issue #982)
  // https://www.w3.org/TR/sparql12-query/#func-normalize
  // =========================================================================

  /**
   * Valid Unicode normalization forms per SPARQL 1.2 specification.
   */
  private static readonly VALID_NORMALIZATION_FORMS = ["NFC", "NFD", "NFKC", "NFKD"] as const;

  /**
   * SPARQL 1.2 NORMALIZE function.
   * Normalizes a Unicode string to a canonical form for consistent comparison.
   *
   * Unicode normalization forms:
   * - NFC (default): Canonical Decomposition, followed by Canonical Composition
   * - NFD: Canonical Decomposition
   * - NFKC: Compatibility Decomposition, followed by Canonical Composition
   * - NFKD: Compatibility Decomposition
   *
   * @param str - String or Literal to normalize
   * @param form - Optional normalization form (defaults to "NFC")
   * @returns Literal with normalized string value
   *
   * Examples:
   * - NORMALIZE("café") → NFC-normalized "café"
   * - NORMALIZE("ﬁ", "NFKC") → "fi" (compatibility normalization decomposes ligatures)
   * - NORMALIZE("Ω", "NFD") → NFD-normalized omega (decomposed form)
   */
  static normalize(str: RDFTerm | string | undefined, form?: RDFTerm | string  ): Literal {
    if (str === undefined) {
      throw new Error("NORMALIZE: string argument is undefined");
    }

    // Extract string value
    let strValue: string;
    if (str instanceof Literal) {
      strValue = str.value;
    } else if (str instanceof IRI) {
      strValue = str.value;
    } else if (str instanceof BlankNode) {
      strValue = str.id;
    } else if (typeof str === "string") {
      strValue = str;
    } else {
      throw new Error("NORMALIZE: first argument must be a string or literal");
    }

    // Extract normalization form (default to NFC)
    let normForm: string = "NFC";
    if (form !== undefined) {
      if (form instanceof Literal) {
        normForm = form.value.toUpperCase();
      } else if (typeof form === "string") {
        normForm = form.toUpperCase();
      } else if (form instanceof IRI) {
        normForm = form.value.toUpperCase();
      } else {
        throw new Error("NORMALIZE: second argument must be a string literal");
      }
    }

    // Validate normalization form
    if (!StringFunctions.VALID_NORMALIZATION_FORMS.includes(normForm as "NFC" | "NFD" | "NFKC" | "NFKD")) {
      throw new Error(`NORMALIZE: invalid normalization form '${normForm}'. Valid forms are: NFC, NFD, NFKC, NFKD`);
    }

    // Apply Unicode normalization
    const normalized = strValue.normalize(normForm as "NFC" | "NFD" | "NFKC" | "NFKD");

    return new Literal(normalized, new IRI("http://www.w3.org/2001/XMLSchema#string"));
  }

  // =========================================================================
  // SPARQL 1.2 FOLD Function (Issue #983)
  // https://www.w3.org/TR/sparql12-query/#func-fold
  // Unicode Case Folding per Unicode Standard Annex #15
  // =========================================================================

  /**
   * Unicode case folding mappings for special characters.
   * These are characters that don't simply map to their lowercase equivalent.
   * Based on Unicode Case Folding data (CaseFolding.txt).
   *
   * Key mappings include:
   * - German sharp S (ß) → ss (full case folding)
   * - Greek capital letter sigma (Σ) → σ (final form uses same lowercase)
   * - Turkish dotted/dotless I handling
   * - Various ligatures and special characters
   */
  private static readonly CASE_FOLDING_MAP: Map<string, string> = new Map([
    // German sharp S (full case folding)
    ["\u00DF", "ss"], // ß → ss
    ["\u1E9E", "ss"], // ẞ (capital sharp S) → ss

    // Greek sigma variants - all fold to lowercase sigma
    ["\u03A3", "\u03C3"], // Σ → σ
    ["\u03C2", "\u03C3"], // ς (final sigma) → σ

    // Turkish special cases
    ["\u0130", "i\u0307"], // İ (dotted I) → i + combining dot above
    ["\u0049", "\u0069"], // I → i (standard, but included for completeness)

    // Armenian ligatures
    ["\u0587", "\u0565\u0582"], // և → եdelays

    // Various other full case foldings from Unicode
    ["\uFB00", "ff"], // ﬀ → ff
    ["\uFB01", "fi"], // ﬁ → fi
    ["\uFB02", "fl"], // ﬂ → fl
    ["\uFB03", "ffi"], // ﬃ → ffi
    ["\uFB04", "ffl"], // ﬄ → ffl
    ["\uFB05", "st"], // ﬅ → st
    ["\uFB06", "st"], // ﬆ → st

    // Greek small letter iota with dialytika and tonos
    ["\u0390", "\u03B9\u0308\u0301"], // ΐ

    // Greek small letter upsilon with dialytika and tonos
    ["\u03B0", "\u03C5\u0308\u0301"], // ΰ

    // Latin small letter long S
    ["\u017F", "s"], // ſ → s

    // Cherokee small letters (map uppercase to lowercase)
    // Note: Cherokee case mapping was added in Unicode 8.0

    // Medieval Latin characters
    ["\u1E9B", "\u1E61"], // ẛ → ṡ (Latin small letter long s with dot above)

    // Kelvin sign
    ["\u212A", "k"], // K (Kelvin sign) → k

    // Angstrom sign
    ["\u212B", "\u00E5"], // Å (Angstrom) → å
  ]);

  /**
   * SPARQL 1.2 FOLD function.
   * Performs Unicode case folding for case-insensitive string comparison.
   *
   * Case folding is more comprehensive than simple lowercase conversion:
   * - Handles special cases like German ß → ss
   * - Handles Greek sigma variants
   * - Handles ligatures (ﬁ → fi, ﬂ → fl, etc.)
   * - Ensures consistent comparison across all Unicode scripts
   *
   * @param str - String or Literal to case-fold
   * @returns Literal with case-folded string value
   *
   * @see https://www.w3.org/TR/sparql12-query/#func-fold
   * @see https://unicode.org/reports/tr44/#Casemapping
   *
   * Examples:
   * - FOLD("Hello") → "hello"
   * - FOLD("Straße") → "strasse"
   * - FOLD("ΣΕΛΛΑΣ") → "σελλασ"
   * - FOLD("ﬁle") → "file"
   */
  static fold(str: RDFTerm | string | undefined): Literal {
    if (str === undefined) {
      throw new Error("FOLD: string argument is undefined");
    }

    // Extract string value
    let strValue: string;
    if (str instanceof Literal) {
      strValue = str.value;
    } else if (str instanceof IRI) {
      strValue = str.value;
    } else if (str instanceof BlankNode) {
      strValue = str.id;
    } else if (typeof str === "string") {
      strValue = str;
    } else {
      throw new Error("FOLD: argument must be a string or literal");
    }

    // Apply Unicode case folding
    const folded = StringFunctions.unicodeCaseFold(strValue);

    return new Literal(folded, new IRI("http://www.w3.org/2001/XMLSchema#string"));
  }

  /**
   * Performs full Unicode case folding on a string.
   *
   * This implements Unicode case folding following the Unicode Standard Annex #15.
   * Case folding is used for case-insensitive matching and differs from
   * simple lowercasing in several ways:
   *
   * 1. It uses full case folding (e.g., ß → ss, not ß → ß)
   * 2. It handles special characters that don't have simple case mappings
   * 3. It provides consistent results across all Unicode scripts
   *
   * @param str - Input string to case-fold
   * @returns Case-folded string
   */
  private static unicodeCaseFold(str: string): string {
    let result = "";

    for (const char of str) {
      // Check if character has special case folding
      const folded = StringFunctions.CASE_FOLDING_MAP.get(char);
      if (folded !== undefined) {
        result += folded;
      } else {
        // Use standard toLowerCase for characters without special mapping
        // This handles the vast majority of characters correctly
        result += char.toLowerCase();
      }
    }

    return result;
  }
}
