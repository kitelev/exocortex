/**
 * VaultPrefixTransformer - Auto-resolves vault namespace prefixed names in SPARQL.
 *
 * Allows users to write queries like:
 * ```sparql
 * SELECT ?label WHERE {
 *   kitelev:dce4f087-1393-4e1b-a09f-8da39d3a5fa3 exo:Asset_label ?label .
 * }
 * ```
 *
 * Which gets transformed to:
 * ```sparql
 * SELECT ?label WHERE {
 *   <obsidian://vault/03%20Knowledge/kitelev/dce4f087-1393-4e1b-a09f-8da39d3a5fa3.md> exo:Asset_label ?label .
 * }
 * ```
 *
 * Unlike standard PREFIX injection, this does direct text replacement because
 * vault asset IRIs end with `.md` suffix, which cannot be expressed via
 * standard PREFIX expansion (which is simple concatenation).
 */

/**
 * Regex to find existing PREFIX declarations in a SPARQL query.
 * Captures the prefix name (without colon).
 */
const DECLARED_PREFIX_PATTERN = /PREFIX\s+(\w+)\s*:/gi;

/**
 * SPARQL keywords and URI schemes that look like prefixed names but aren't.
 */
const SPARQL_KEYWORDS = new Set([
  "mailto", "http", "https", "urn", "ftp",
  "prefix", "base", "select", "construct", "describe", "ask",
  "where", "filter", "optional", "union", "graph",
  "order", "group", "having", "limit", "offset",
  "values", "bind", "minus", "service",
  "insert", "delete", "load", "clear", "drop", "create", "move", "copy", "add",
]);

export class VaultPrefixTransformer {
  private vaultPrefixes: Map<string, string> = new Map();

  /**
   * Set the vault prefix map.
   *
   * @param prefixes - Map of prefix name to base IRI (with trailing slash, without .md)
   *   e.g., Map { "kitelev" => "obsidian://vault/03%20Knowledge/kitelev/" }
   */
  setVaultPrefixes(prefixes: Map<string, string>): void {
    this.vaultPrefixes = new Map(prefixes);
  }

  /**
   * Get the current vault prefix map.
   */
  getVaultPrefixes(): Map<string, string> {
    return new Map(this.vaultPrefixes);
  }

  /**
   * Transform a SPARQL query by replacing vault-prefixed names with full IRIs.
   *
   * `kitelev:uuid` → `<obsidian://vault/03%20Knowledge/kitelev/uuid.md>`
   *
   * Only replaces prefixed names that:
   * - Are not already declared via PREFIX
   * - Match a known vault namespace
   * - Are outside string literals, URIs, and comments
   *
   * @param query - The SPARQL query string
   * @returns The query with vault prefixed names replaced by full IRIs
   */
  transform(query: string): string {
    if (this.vaultPrefixes.size === 0) {
      return query;
    }

    // Find all already-declared prefixes (skip those)
    const declaredPrefixes = this.findDeclaredPrefixes(query);

    // Build active vault prefixes (not already declared, not keywords)
    const activePrefixes: Array<{ prefix: string; baseIRI: string }> = [];
    for (const [prefix, baseIRI] of this.vaultPrefixes) {
      if (!declaredPrefixes.has(prefix.toLowerCase()) &&
          !SPARQL_KEYWORDS.has(prefix.toLowerCase())) {
        activePrefixes.push({ prefix, baseIRI });
      }
    }

    if (activePrefixes.length === 0) {
      return query;
    }

    // Replace vault-prefixed names (outside literals/URIs/comments)
    let result = "";
    let i = 0;

    while (i < query.length) {
      const char = query[i];

      // Skip string literals
      if (char === '"' || char === "'") {
        const skip = this.skipLiteral(query, i);
        result += query.substring(i, skip);
        i = skip;
        continue;
      }

      // Skip URIs in angle brackets
      if (char === "<") {
        const end = query.indexOf(">", i);
        if (end !== -1) {
          result += query.substring(i, end + 1);
          i = end + 1;
        } else {
          result += char;
          i++;
        }
        continue;
      }

      // Skip comments
      if (char === "#") {
        const end = query.indexOf("\n", i);
        if (end !== -1) {
          result += query.substring(i, end);
          i = end;
        } else {
          result += query.substring(i);
          i = query.length;
        }
        continue;
      }

      // Try to match a vault-prefixed name
      const replacement = this.tryReplacePrefixedName(query, i, activePrefixes);
      if (replacement) {
        result += replacement.iri;
        i = replacement.endIndex;
        continue;
      }

      result += char;
      i++;
    }

    return result;
  }

  /**
   * Try to match and replace a vault-prefixed name at position i.
   */
  private tryReplacePrefixedName(
    query: string,
    i: number,
    activePrefixes: Array<{ prefix: string; baseIRI: string }>,
  ): { iri: string; endIndex: number } | null {
    // Must be at word boundary
    if (i > 0 && /[a-zA-Z0-9_]/.test(query[i - 1])) {
      return null;
    }

    for (const { prefix, baseIRI } of activePrefixes) {
      if (query.substring(i, i + prefix.length + 1) !== prefix + ":") continue;

      const localStart = i + prefix.length + 1;

      // Read local name: UUID chars + dots, hyphens, underscores
      let localEnd = localStart;
      while (localEnd < query.length && /[a-zA-Z0-9_.%-]/.test(query[localEnd])) {
        localEnd++;
      }

      if (localEnd === localStart) continue;

      const localName = query.substring(localStart, localEnd);

      // Build full IRI: baseIRI + localName + .md
      const fullIRI = `<${baseIRI}${localName}.md>`;
      return { iri: fullIRI, endIndex: localEnd };
    }

    return null;
  }

  /**
   * Find all PREFIX names already declared in the query.
   */
  private findDeclaredPrefixes(query: string): Set<string> {
    const declared = new Set<string>();
    const pattern = new RegExp(DECLARED_PREFIX_PATTERN.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(query)) !== null) {
      declared.add(match[1].toLowerCase());
    }
    return declared;
  }

  /**
   * Skip past a string literal starting at position i.
   */
  private skipLiteral(query: string, i: number): number {
    const char = query[i];

    // Triple-quoted
    if (i + 2 < query.length && query.substring(i, i + 3) === char + char + char) {
      const end = query.indexOf(char + char + char, i + 3);
      return end !== -1 ? end + 3 : query.length;
    }

    // Single-quoted
    let j = i + 1;
    while (j < query.length && query[j] !== char) {
      if (query[j] === "\\") j++;
      j++;
    }
    return j < query.length ? j + 1 : query.length;
  }
}
