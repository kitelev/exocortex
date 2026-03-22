import path from "path";
import yaml from "js-yaml";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";

/**
 * Result of the archive verification operation.
 *
 * JSON-serializable output for CI integration.
 * Exit code 0 when `ok === true`, exit code 1 otherwise.
 */
export interface ArchiveVerifyResult {
  /** Number of broken cross-vault links detected */
  broken_links: number;
  /** Details of each broken link */
  broken_link_details: BrokenLinkDetail[];
  /** Archive ontologies expected but missing */
  missing_ontologies: string[];
  /** Vault statistics */
  stats: VaultStats;
  /** Overall health: true when broken_links === 0 && missing_ontologies.length === 0 */
  ok: boolean;
}

/**
 * Detail of a single broken cross-vault link.
 */
export interface BrokenLinkDetail {
  /** UUID of the archived asset being referenced */
  uuid: string;
  /** Relative path in the active vault that references the archived UUID */
  referenced_from: string;
}

/**
 * Vault statistics.
 */
export interface VaultStats {
  /** Number of markdown files in the active vault */
  active_files: number;
  /** Number of markdown files in the archive vault */
  archive_files: number;
}

/**
 * Service that verifies archive integrity after archival.
 *
 * Checks:
 * 1. No broken links from active (non-archived) assets to archive UUIDs
 * 2. All archive ontologies (`!<name>_archive.md`) exist in archive vault
 * 3. File count statistics for both vaults
 *
 * Algorithm:
 * 1. Collect all UUID filenames from archive vault → archiveUUIDs set
 * 2. Scan active vault: for each non-archived file, extract all UUID references
 * 3. For each reference that matches an archive UUID → broken link
 * 4. Collect unique `exo__Asset_isDefinedBy` from archive files → expected ontologies
 * 5. Check existence of each `!<name>_archive.md` in archive vault
 * 6. Count files in both vaults
 */
export class ArchiveVerifyService {
  constructor(
    private readonly activeFs: NodeFsAdapter,
    private readonly archiveFs: NodeFsAdapter,
  ) {}

  /**
   * Execute the archive verification.
   */
  async verify(): Promise<ArchiveVerifyResult> {
    // Step 1: Get all markdown files in both vaults
    const activeFiles = await this.activeFs.getMarkdownFiles();
    const archiveFiles = await this.archiveFs.getMarkdownFiles();

    // Step 2: Build archive UUID set from archive vault filenames
    const archiveUUIDs = new Set<string>();
    for (const file of archiveFiles) {
      const basename = path.basename(file, ".md");
      if (this.isUUID(basename)) {
        archiveUUIDs.add(basename.toLowerCase());
      }
    }

    // Step 3: Scan active vault for broken links
    const brokenLinkDetails: BrokenLinkDetail[] = [];
    const uuidPattern =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

    for (const file of activeFiles) {
      try {
        const content = await this.activeFs.readFile(file);
        const metadata = this.extractFrontmatter(content);

        // Skip archived files in active vault (they are pending move)
        if (metadata.archived === true) {
          continue;
        }

        // Extract all UUID references from the entire file content
        const matches = content.match(uuidPattern);
        if (matches) {
          const seenInFile = new Set<string>();
          for (const match of matches) {
            const lower = match.toLowerCase();
            if (archiveUUIDs.has(lower) && !seenInFile.has(lower)) {
              seenInFile.add(lower);
              brokenLinkDetails.push({
                uuid: lower,
                referenced_from: file,
              });
            }
          }
        }
      } catch {
        // Skip unreadable files
        continue;
      }
    }

    // Step 4: Check archive ontologies
    const missingOntologies = await this.checkArchiveOntologies(archiveFiles);

    // Step 5: Build result
    const ok =
      brokenLinkDetails.length === 0 && missingOntologies.length === 0;

    return {
      broken_links: brokenLinkDetails.length,
      broken_link_details: brokenLinkDetails,
      missing_ontologies: missingOntologies,
      stats: {
        active_files: activeFiles.length,
        archive_files: archiveFiles.length,
      },
      ok,
    };
  }

  /**
   * Check that for each unique isDefinedBy in archive vault,
   * the corresponding archive ontology file exists.
   *
   * For example, if archive files reference `[[!ems|EMS Ontology]]`,
   * then `!ems_archive.md` must exist in the archive vault.
   */
  private async checkArchiveOntologies(
    archiveFiles: string[],
  ): Promise<string[]> {
    const ontologyTargets = new Set<string>();

    for (const file of archiveFiles) {
      // Skip ontology files themselves
      const basename = path.basename(file, ".md");
      if (basename.startsWith("!")) {
        continue;
      }

      try {
        const content = await this.archiveFs.readFile(file);
        const metadata = this.extractFrontmatter(content);
        const isDefinedBy = metadata.exo__Asset_isDefinedBy;
        if (isDefinedBy) {
          const target = this.extractWikilinkTarget(String(isDefinedBy));
          if (target && target.startsWith("!")) {
            // If it already ends with _archive, extract the base name
            const baseName = target.endsWith("_archive")
              ? target
              : target + "_archive";
            ontologyTargets.add(baseName);
          }
        }
      } catch {
        continue;
      }
    }

    const missing: string[] = [];
    for (const ontologyName of ontologyTargets) {
      const ontologyPath = ontologyName + ".md";
      const exists = await this.archiveFs.fileExists(ontologyPath);
      if (!exists) {
        missing.push(ontologyName);
      }
    }

    return missing.sort();
  }

  /**
   * Extract wikilink target from a wikilink string.
   * "[[!ems_archive|EMS Ontology (Archive)]]" -> "!ems_archive"
   * "[[!ems|EMS Ontology]]" -> "!ems"
   */
  private extractWikilinkTarget(wikilink: string): string | null {
    const match = wikilink.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
    return match ? match[1] : null;
  }

  /**
   * Extract frontmatter from markdown content.
   */
  private extractFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    try {
      const parsed = yaml.load(match[1]);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  /**
   * Check if a string is a UUID v4.
   */
  private isUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
