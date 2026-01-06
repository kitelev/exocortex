/**
 * UUID to URI resolver for Exo 0.0.3 format files.
 *
 * Issue #1388: exocortex-public-ontologies uses UUID-based filenames across
 * multiple directories (exo/, rdfs/, owl/, etc.). Statement files reference
 * anchor files by UUID wikilinks like [[uuid|alias]].
 *
 * This resolver builds an index of UUID → URI mappings from anchor files
 * to enable O(1) lookup during triple conversion, instead of O(n*m) directory
 * traversal for each wikilink.
 *
 * Performance target: Query completes <100ms for 10k statement files.
 */
import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";

export interface UuidMapping {
  /** The canonical URI from the anchor file */
  uri: string;
  /** The type of the file (anchor, namespace, blank_node) */
  type: "iri" | "blank";
  /** The relative path to the file */
  filePath: string;
}

/**
 * Resolver that builds and maintains an index of UUID → URI mappings
 * from Exo 0.0.3 anchor files.
 */
export class Exo003UuidResolver {
  /**
   * Map of UUID (filename without .md extension) to URI mapping.
   * Key: UUID string (e.g., "7f53bc4f-891e-58d7-abbc-1e0314a2e3c9")
   * Value: UuidMapping with URI and type
   */
  private uuidToUri: Map<string, UuidMapping> = new Map();

  /**
   * The root path of the vault being indexed.
   */
  private rootPath: string = "";

  /**
   * Whether the index has been built.
   */
  private isIndexed: boolean = false;

  /**
   * Build the UUID → URI index by scanning all anchor/namespace/blank_node files.
   *
   * This method should be called once before any resolution queries.
   * For a vault with 100k files, this typically completes in 2-5 seconds.
   *
   * @param vaultPath - Root path of the vault to index
   * @param folderFilter - Optional folder to limit indexing (relative to vault root)
   */
  async buildIndex(vaultPath: string, _folderFilter?: string): Promise<void> {
    this.rootPath = vaultPath;
    this.uuidToUri.clear();

    // IMPORTANT: For cross-directory resolution, we MUST index the entire vault
    // even if a folderFilter is specified for the SPARQL query.
    // The folderFilter only limits which files are processed for triples,
    // but anchor files can be referenced from ANY directory.
    const startPath = vaultPath;

    await this.walkAndIndex(startPath);
    this.isIndexed = true;
  }

  /**
   * Resolve a UUID or wikilink reference to a URI.
   *
   * @param ref - The reference to resolve:
   *   - UUID string: "7f53bc4f-891e-58d7-abbc-1e0314a2e3c9"
   *   - Wikilink: "[[uuid|alias]]"
   *   - Full URI: "https://example.org/resource"
   * @returns Resolution result with type and value, or null if not found
   */
  resolve(ref: string): UuidMapping | null {
    // Extract UUID from wikilink if present
    const uuid = this.extractUuidFromWikilink(ref);

    // Check if it's a direct URI (not a wikilink or UUID)
    if (!uuid && ref.includes("://")) {
      return {
        uri: ref,
        type: "iri",
        filePath: "",
      };
    }

    // Look up in index
    const lookupKey = uuid || ref;
    return this.uuidToUri.get(lookupKey) || null;
  }

  /**
   * Check if the index has been built.
   */
  hasIndex(): boolean {
    return this.isIndexed;
  }

  /**
   * Get the number of indexed entries.
   */
  get size(): number {
    return this.uuidToUri.size;
  }

  /**
   * Get the internal index map.
   * This allows direct transfer to NoteToRDFConverter for O(1) lookups.
   *
   * @returns The internal UUID → UuidMapping map
   */
  getIndex(): Map<string, UuidMapping> {
    return this.uuidToUri;
  }

  /**
   * Walk directory tree and index all Exo 0.0.3 anchor files.
   */
  private async walkAndIndex(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.walkAndIndex(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        await this.indexFileIfAnchor(fullPath);
      }
    }
  }

  /**
   * Index a file if it's an Exo 0.0.3 anchor/namespace/blank_node file.
   */
  private async indexFileIfAnchor(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const frontmatter = this.extractFrontmatter(content);

      if (!frontmatter) {
        return;
      }

      const metadata = frontmatter.metadata;
      const uri = frontmatter.uri;

      // Only index files with metadata type and uri
      if (!metadata || !uri) {
        return;
      }

      // Get UUID from filename (without .md extension)
      const basename = path.basename(filePath, ".md");
      const relativePath = path.relative(this.rootPath, filePath);

      switch (metadata) {
        case "anchor":
        case "namespace":
          this.uuidToUri.set(basename, {
            uri: uri as string,
            type: "iri",
            filePath: relativePath,
          });
          break;

        case "blank_node":
          // Blank nodes use their URI as identifier (sanitized)
          const blankId = (uri as string).replace(/[^a-zA-Z0-9_-]/g, "_");
          this.uuidToUri.set(basename, {
            uri: blankId,
            type: "blank",
            filePath: relativePath,
          });
          break;
      }
    } catch {
      // Skip files that can't be read or parsed
    }
  }

  /**
   * Extract frontmatter from file content.
   */
  private extractFrontmatter(content: string): Record<string, unknown> | null {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return null;
    }

    try {
      const parsed = yaml.load(match[1]);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Extract UUID from a wikilink reference.
   *
   * Handles formats:
   * - "[[uuid]]" → "uuid"
   * - "[[uuid|alias]]" → "uuid"
   * - "uuid" → "uuid" (pass through)
   */
  private extractUuidFromWikilink(ref: string): string | null {
    // Match wikilinks with optional alias: [[Target]] or [[Target|Alias]]
    const match = ref.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
    return match ? match[1] : null;
  }
}
