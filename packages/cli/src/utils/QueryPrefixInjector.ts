import { SPARQL_PREFIXES } from "exocortex";

/**
 * Standard Exocortex ontology IRI base used to derive ad-hoc prefix
 * declarations for non-whitelisted namespaces (e.g. `aiKnow:`, `aiTask:`).
 * Mirrors `Namespace.EXOCORTEX_ONTOLOGY_BASE` in the core package — kept as a
 * local constant to avoid pulling the full RDF module into the CLI's mock
 * surface area for every consuming test.
 */
const EXOCORTEX_ONTOLOGY_BASE = "https://exocortex.my/ontology/";

/** Prefix shape: lowercase letter, then alphanumerics. Mirrors Namespace.forPrefix. */
const VALID_PREFIX_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/**
 * Well-known Exocortex ontology prefixes that should NOT be treated as vault
 * directory namespaces. These map to ontology IRIs, not vault file paths.
 */
const ONTOLOGY_PREFIXES = new Set([
  "exo", "ems", "ims", "gtd", "period", "lit", "inbox",
  "rdf", "rdfs", "owl", "xsd",
]);

/**
 * Regex to match shorthand notation in angle brackets: <namespace__property>
 * Captures: namespace (letters), property name (letters, digits, underscores)
 */
const SHORTHAND_PATTERN = /(<)([a-zA-Z][a-zA-Z0-9]*)__([a-zA-Z][a-zA-Z0-9_]*)(>)/g;

/**
 * Inject missing Exocortex PREFIX declarations into a SPARQL query.
 *
 * Parses the query for existing PREFIX declarations and adds any missing
 * well-known prefixes (exo, ems, ims, etc.) from SPARQL_PREFIXES.
 *
 * @param query - The SPARQL query string
 * @returns The query with missing PREFIX declarations prepended
 */
export function injectExocortexPrefixes(query: string): string {
  // Find all already-declared prefixes
  const declaredPrefixes = new Set<string>();
  const prefixPattern = /PREFIX\s+(\w+)\s*:/gi;
  let match: RegExpExecArray | null;
  while ((match = prefixPattern.exec(query)) !== null) {
    declaredPrefixes.add(match[1].toLowerCase());
  }

  // Parse SPARQL_PREFIXES into individual lines
  const prefixLines = SPARQL_PREFIXES.split("\n").filter(line => line.trim().length > 0);

  // Collect missing prefix declarations
  const missingPrefixes: string[] = [];
  for (const line of prefixLines) {
    const lineMatch = /PREFIX\s+(\w+)\s*:/i.exec(line);
    if (lineMatch && !declaredPrefixes.has(lineMatch[1].toLowerCase())) {
      missingPrefixes.push(line);
    }
  }

  // RFC: SHACL namespace whitelist relaxation — auto-declare prefixes used
  // in the query body that are not in the static whitelist (e.g. `aiKnow:`,
  // `aiTask:`) using the standard Exocortex ontology IRI convention. Mirrors
  // NoteToRDFConverter's runtime auto-extension so cross-namespace SPARQL
  // queries like `?s aiKnow:Memory_aboutConcept ?c` resolve without forcing
  // the user to hand-declare every PREFIX.
  const usedPrefixPattern = /(?<![:\w])([a-z][a-zA-Z0-9]*):[a-zA-Z_]/g;
  const usedPrefixes = new Set<string>();
  let usedMatch: RegExpExecArray | null;
  while ((usedMatch = usedPrefixPattern.exec(query)) !== null) {
    usedPrefixes.add(usedMatch[1]);
  }
  // Track all prefixes we will end up declaring (existing + the ones we just
  // queued from SPARQL_PREFIXES) so we don't double-declare.
  const declaringPrefixes = new Set(declaredPrefixes);
  for (const line of missingPrefixes) {
    const m = /PREFIX\s+(\w+)\s*:/i.exec(line);
    if (m) declaringPrefixes.add(m[1].toLowerCase());
  }
  for (const prefix of usedPrefixes) {
    if (declaringPrefixes.has(prefix.toLowerCase())) continue;
    if (!VALID_PREFIX_PATTERN.test(prefix)) continue;
    missingPrefixes.push(
      `PREFIX ${prefix}: <${EXOCORTEX_ONTOLOGY_BASE}${prefix}#>`,
    );
    declaringPrefixes.add(prefix.toLowerCase());
  }

  if (missingPrefixes.length === 0) {
    return query;
  }

  return missingPrefixes.join("\n") + "\n" + query;
}

/**
 * Transform Exocortex shorthand notation to prefixed names.
 *
 * Converts `<namespace__property>` to `namespace:property` for known
 * Exocortex ontology namespaces.
 *
 * Examples:
 *   <exo__Instance_class> → exo:Instance_class
 *   <ems__Meeting>        → ems:Meeting
 *   <ems__Effort_status>  → ems:Effort_status
 *
 * Only transforms names where the namespace part matches a known
 * Exocortex ontology prefix.
 *
 * @param query - The SPARQL query string
 * @returns The query with shorthand notation replaced
 */
export function transformShorthandNotation(query: string): string {
  return query.replace(SHORTHAND_PATTERN, (_match, _open, namespace, property, _close) => {
    if (ONTOLOGY_PREFIXES.has(namespace.toLowerCase())) {
      return `${namespace}:${property}`;
    }
    // Not a known ontology prefix — leave as-is
    return _match;
  });
}

/**
 * Filter out ontology namespace prefixes from vault-scanned prefixes.
 *
 * Vault namespace scanning discovers directories like `exo/`, `ems/`, `ims/`
 * and registers them as SPARQL prefixes. However, these names collide with
 * Exocortex ontology namespaces that map to different IRIs.
 *
 * This function removes ontology prefix names from the vault prefix map
 * so that ontology PREFIX declarations take priority.
 *
 * @param vaultPrefixes - Map from vault namespace scanning
 * @returns Filtered map without ontology namespace collisions
 */
export function filterOntologyPrefixes(vaultPrefixes: Map<string, string>): Map<string, string> {
  const filtered = new Map(vaultPrefixes);
  for (const prefix of ONTOLOGY_PREFIXES) {
    filtered.delete(prefix);
  }
  return filtered;
}
