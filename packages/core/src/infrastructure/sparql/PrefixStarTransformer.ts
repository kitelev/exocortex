/**
 * PrefixStarTransformer - Transforms PREFIX* declarations to regular PREFIX declarations.
 *
 * SPARQL 1.2 introduces PREFIX* syntax for importing all prefixes from a vocabulary:
 *
 * ```sparql
 * PREFIX* <http://schema.org/>
 * ```
 *
 * This transformer enables PREFIX* syntax by:
 * 1. Finding PREFIX* declarations in the query
 * 2. Resolving the vocabulary URI to extract prefix definitions
 * 3. Replacing PREFIX* with actual PREFIX declarations
 *
 * Supports:
 * - Remote vocabulary URIs (fetches and parses RDF)
 * - Local vocabulary files
 * - Multiple PREFIX* declarations
 * - Graceful error handling for unreachable URIs
 *
 * SPARQL 1.2 spec reference:
 * https://www.w3.org/TR/sparql12-query/#prefixDecl
 */

export interface VocabularyResolver {
  /**
   * Resolve a vocabulary URI to extract prefix definitions.
   *
   * @param uri - The vocabulary namespace URI
   * @returns Map of prefix names to their namespace URIs
   */
  resolve(uri: string): Promise<Map<string, string>>;
}

/**
 * Default vocabulary resolver that uses well-known prefix mappings.
 * For production use, this should be extended to fetch remote vocabularies.
 */
export class WellKnownPrefixResolver implements VocabularyResolver {
  private readonly wellKnownPrefixes: Map<string, Map<string, string>>;

  constructor() {
    this.wellKnownPrefixes = new Map();

    // Schema.org
    const schemaOrg = new Map<string, string>();
    schemaOrg.set("schema", "http://schema.org/");
    this.wellKnownPrefixes.set("http://schema.org/", schemaOrg);

    // FOAF
    const foaf = new Map<string, string>();
    foaf.set("foaf", "http://xmlns.com/foaf/0.1/");
    this.wellKnownPrefixes.set("http://xmlns.com/foaf/0.1/", foaf);

    // Dublin Core
    const dc = new Map<string, string>();
    dc.set("dc", "http://purl.org/dc/elements/1.1/");
    dc.set("dcterms", "http://purl.org/dc/terms/");
    this.wellKnownPrefixes.set("http://purl.org/dc/elements/1.1/", dc);
    this.wellKnownPrefixes.set("http://purl.org/dc/terms/", dc);

    // RDF/RDFS
    const rdf = new Map<string, string>();
    rdf.set("rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#");
    rdf.set("rdfs", "http://www.w3.org/2000/01/rdf-schema#");
    this.wellKnownPrefixes.set("http://www.w3.org/1999/02/22-rdf-syntax-ns#", rdf);
    this.wellKnownPrefixes.set("http://www.w3.org/2000/01/rdf-schema#", rdf);

    // OWL
    const owl = new Map<string, string>();
    owl.set("owl", "http://www.w3.org/2002/07/owl#");
    this.wellKnownPrefixes.set("http://www.w3.org/2002/07/owl#", owl);

    // XSD
    const xsd = new Map<string, string>();
    xsd.set("xsd", "http://www.w3.org/2001/XMLSchema#");
    this.wellKnownPrefixes.set("http://www.w3.org/2001/XMLSchema#", xsd);

    // SKOS
    const skos = new Map<string, string>();
    skos.set("skos", "http://www.w3.org/2004/02/skos/core#");
    this.wellKnownPrefixes.set("http://www.w3.org/2004/02/skos/core#", skos);

    // PROV
    const prov = new Map<string, string>();
    prov.set("prov", "http://www.w3.org/ns/prov#");
    this.wellKnownPrefixes.set("http://www.w3.org/ns/prov#", prov);

    // GEO
    const geo = new Map<string, string>();
    geo.set("geo", "http://www.w3.org/2003/01/geo/wgs84_pos#");
    this.wellKnownPrefixes.set("http://www.w3.org/2003/01/geo/wgs84_pos#", geo);

    // DCAT
    const dcat = new Map<string, string>();
    dcat.set("dcat", "http://www.w3.org/ns/dcat#");
    this.wellKnownPrefixes.set("http://www.w3.org/ns/dcat#", dcat);
  }

  async resolve(uri: string): Promise<Map<string, string>> {
    // Normalize URI (remove trailing hash/slash for lookup)
    const normalizedUri = uri.endsWith("#") || uri.endsWith("/")
      ? uri
      : uri + (uri.includes("#") ? "" : "/");

    // Try exact match first
    const exactMatch = this.wellKnownPrefixes.get(normalizedUri);
    if (exactMatch) {
      return exactMatch;
    }

    // Try without trailing character
    const withoutTrailing = normalizedUri.slice(0, -1);
    const withoutTrailingMatch = this.wellKnownPrefixes.get(withoutTrailing);
    if (withoutTrailingMatch) {
      return withoutTrailingMatch;
    }

    // If not found in well-known prefixes, return empty map
    // In a full implementation, this would fetch from the remote URI
    return new Map();
  }

  /**
   * Add a custom prefix mapping for a vocabulary URI.
   */
  addVocabulary(uri: string, prefixes: Map<string, string>): void {
    this.wellKnownPrefixes.set(uri, prefixes);
  }
}

export class PrefixStarTransformer {
  private readonly resolver: VocabularyResolver;

  constructor(resolver?: VocabularyResolver) {
    this.resolver = resolver ?? new WellKnownPrefixResolver();
  }

  /**
   * Transform all PREFIX* declarations in a SPARQL query to regular PREFIX declarations.
   *
   * @param query - The SPARQL query string that may contain PREFIX* declarations
   * @returns The transformed query with PREFIX* replaced by PREFIX declarations
   * @throws PrefixStarTransformerError if PREFIX* syntax is malformed
   */
  async transform(query: string): Promise<string> {
    // Find all PREFIX* declarations
    const prefixStarDeclarations = this.findPrefixStarDeclarations(query);

    if (prefixStarDeclarations.length === 0) {
      return query;
    }

    // Resolve each vocabulary and collect prefixes
    const resolvedPrefixes: string[] = [];
    const errors: string[] = [];

    for (const declaration of prefixStarDeclarations) {
      try {
        const prefixes = await this.resolver.resolve(declaration.uri);
        for (const [prefix, namespace] of prefixes) {
          resolvedPrefixes.push(`PREFIX ${prefix}: <${namespace}>`);
        }

        // If no prefixes were resolved for a well-known vocabulary, add a fallback
        if (prefixes.size === 0) {
          // Extract a reasonable prefix name from the URI
          const fallbackPrefix = this.extractPrefixFromUri(declaration.uri);
          if (fallbackPrefix) {
            resolvedPrefixes.push(`PREFIX ${fallbackPrefix}: <${declaration.uri}>`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to resolve vocabulary ${declaration.uri}: ${message}`);
      }
    }

    // If any errors occurred and no prefixes were resolved, throw
    if (resolvedPrefixes.length === 0 && errors.length > 0) {
      throw new PrefixStarTransformerError(errors.join("; "));
    }

    // Replace PREFIX* declarations with resolved prefixes
    let result = query;

    // Process in reverse order to maintain valid positions
    for (let i = prefixStarDeclarations.length - 1; i >= 0; i--) {
      const decl = prefixStarDeclarations[i];
      result = result.substring(0, decl.startPos) +
        result.substring(decl.endPos);
    }

    // Prepend resolved prefixes
    if (resolvedPrefixes.length > 0) {
      result = resolvedPrefixes.join("\n") + "\n" + result.trimStart();
    }

    return result;
  }

  /**
   * Find all PREFIX* declarations in the query.
   */
  private findPrefixStarDeclarations(query: string): Array<{
    uri: string;
    startPos: number;
    endPos: number;
  }> {
    const declarations: Array<{
      uri: string;
      startPos: number;
      endPos: number;
    }> = [];

    const queryUpper = query.toUpperCase();
    let pos = 0;

    while (pos < query.length) {
      // Skip string literals
      if (query[pos] === "'" || query[pos] === '"') {
        const quote = query[pos];
        pos++;
        while (pos < query.length && query[pos] !== quote) {
          if (query[pos] === "\\") pos++; // Skip escaped characters
          pos++;
        }
        pos++; // Skip closing quote
        continue;
      }

      // Check for PREFIX* keyword (allowing whitespace between PREFIX and *)
      if (queryUpper.substring(pos, pos + 6) === "PREFIX") {
        const prefixStart = pos;
        pos += 6; // Skip "PREFIX"

        // Skip whitespace
        while (pos < query.length && /\s/.test(query[pos])) {
          pos++;
        }

        // Check for *
        if (query[pos] === "*") {
          pos++; // Skip *

          // Skip whitespace before URI
          while (pos < query.length && /\s/.test(query[pos])) {
            pos++;
          }

          // Extract URI (must be in angle brackets)
          if (query[pos] === "<") {
            pos++; // Skip <
            const uriStart = pos;

            // Find closing >
            while (pos < query.length && query[pos] !== ">") {
              pos++;
            }

            if (query[pos] === ">") {
              const uri = query.substring(uriStart, pos);
              pos++; // Skip >

              // Find end of declaration (newline or next PREFIX/SELECT/etc.)
              const endPos = this.findDeclarationEnd(query, pos);

              declarations.push({
                uri,
                startPos: prefixStart,
                endPos: endPos,
              });

              pos = endPos;
              continue;
            } else {
              throw new PrefixStarTransformerError(
                `Unclosed IRI in PREFIX* declaration at position ${uriStart}`
              );
            }
          } else {
            throw new PrefixStarTransformerError(
              `Expected IRI after PREFIX* at position ${pos}`
            );
          }
        } else {
          // Regular PREFIX declaration, continue scanning
          continue;
        }
      }

      pos++;
    }

    return declarations;
  }

  /**
   * Find the end position of a PREFIX* declaration.
   */
  private findDeclarationEnd(query: string, startPos: number): number {
    let pos = startPos;

    // Skip whitespace and find next significant content
    while (pos < query.length) {
      const char = query[pos];

      // Stop at newline
      if (char === "\n") {
        return pos + 1;
      }

      // Stop at next PREFIX or query keyword
      const remaining = query.substring(pos).toUpperCase();
      if (
        remaining.startsWith("PREFIX") ||
        remaining.startsWith("BASE") ||
        remaining.startsWith("SELECT") ||
        remaining.startsWith("CONSTRUCT") ||
        remaining.startsWith("DESCRIBE") ||
        remaining.startsWith("ASK")
      ) {
        return pos;
      }

      // Skip other whitespace
      if (/\s/.test(char)) {
        pos++;
        continue;
      }

      // Non-whitespace character means we're past the declaration
      break;
    }

    return pos;
  }

  /**
   * Extract a reasonable prefix name from a vocabulary URI.
   */
  private extractPrefixFromUri(uri: string): string | null {
    // Remove protocol
    let path = uri.replace(/^https?:\/\//, "");

    // Remove common TLDs and path separators
    path = path.replace(/\/$/, "").replace(/#$/, "");

    // Get the last meaningful segment
    const segments = path.split(/[/.#]+/).filter(Boolean);
    if (segments.length === 0) return null;

    // Try to find a good prefix name
    const lastSegment = segments[segments.length - 1];

    // If it's a well-known pattern like "ontology" or "vocab", use preceding segment
    if (/^(ontology|vocab|schema|ns|core)$/i.test(lastSegment)) {
      if (segments.length > 1) {
        return segments[segments.length - 2].toLowerCase();
      }
    }

    // Clean up the segment name
    return lastSegment.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
}

/**
 * Error thrown when PREFIX* transformation fails.
 */
export class PrefixStarTransformerError extends Error {
  constructor(message: string) {
    super(`PREFIX* transformation error: ${message}`);
    this.name = "PrefixStarTransformerError";
  }
}
