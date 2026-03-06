import { readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Scan vault for namespace directories and build a prefix-to-IRI map.
 *
 * Namespace directories live under top-level vault directories (e.g., `03 Knowledge/`).
 * Each subdirectory name becomes a SPARQL prefix, and assets within it get IRIs like:
 *   obsidian://vault/03%20Knowledge/kitelev/<uuid>
 *
 * This enables SPARQL queries like:
 * ```sparql
 * SELECT ?label WHERE {
 *   kitelev:dce4f087-1393-4e1b-a09f-8da39d3a5fa3 exo:Asset_label ?label .
 * }
 * ```
 *
 * @param vaultPath - Absolute path to the Obsidian vault root
 * @returns Map of prefix name to base IRI (with trailing slash)
 */
export function scanVaultNamespaces(vaultPath: string): Map<string, string> {
  const prefixes = new Map<string, string>();
  const OBSIDIAN_VAULT_SCHEME = "obsidian://vault/";

  // Scan top-level directories for namespace-like subdirectories
  let entries: string[];
  try {
    entries = readdirSync(vaultPath);
  } catch {
    return prefixes;
  }

  for (const entry of entries) {
    const entryPath = join(vaultPath, entry);

    // Skip hidden dirs and non-directories
    if (entry.startsWith(".")) continue;

    let entryStat;
    try {
      entryStat = statSync(entryPath);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory()) continue;

    // Scan subdirectories of each top-level directory
    let subdirs: string[];
    try {
      subdirs = readdirSync(entryPath);
    } catch {
      continue;
    }

    for (const subdir of subdirs) {
      const subdirPath = join(entryPath, subdir);

      // Skip hidden dirs
      if (subdir.startsWith(".")) continue;

      let subdirStat;
      try {
        subdirStat = statSync(subdirPath);
      } catch {
        continue;
      }
      if (!subdirStat.isDirectory()) continue;

      // Check if this subdirectory contains .md files (namespace indicator)
      let hasMarkdownFiles = false;
      try {
        const files = readdirSync(subdirPath);
        hasMarkdownFiles = files.some(f => f.endsWith(".md"));
      } catch {
        continue;
      }

      if (hasMarkdownFiles) {
        // Build the IRI base: obsidian://vault/<encoded-parent>/<subdir>/
        const relativePath = `${entry}/${subdir}`;
        const encodedPath = encodeURI(relativePath);
        const baseIRI = `${OBSIDIAN_VAULT_SCHEME}${encodedPath}/`;

        // Use the subdirectory name as the prefix (must be valid SPARQL prefix)
        // Only register if it looks like a valid prefix name (letter followed by alphanumeric/underscore)
        if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(subdir)) {
          prefixes.set(subdir, baseIRI);
        }
      }
    }
  }

  return prefixes;
}
