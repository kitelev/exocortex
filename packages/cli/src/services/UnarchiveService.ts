import path from "path";
import yaml from "js-yaml";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";

/**
 * Options for the unarchive operation
 */
export interface UnarchiveOptions {
  /** UUID of asset to restore */
  uuid: string;
  /** Path to the active vault */
  vaultPath: string;
  /** Path to the archive vault */
  archiveVaultPath: string;
  /** If true, preview without writing */
  dryRun: boolean;
}

/**
 * Result of the unarchive operation
 */
export interface UnarchiveResult {
  success: boolean;
  uuid: string;
  movedTo?: string;
  isDefinedBy?: string;
  error?: string;
}

/**
 * Service that restores a single asset from the archive vault back to the active vault.
 *
 * This is the symmetric reverse of ArchiveService.transferFile():
 * - Finds asset by UUID in archive vault
 * - Updates exo__Asset_isDefinedBy from archive ontology to active ontology
 * - Moves file to active vault inbox (03 Knowledge/inbox/)
 * - Preserves archived: true in frontmatter (user decides whether to remove it)
 */
export class UnarchiveService {
  constructor(
    private readonly activeFs: NodeFsAdapter,
    private readonly archiveFs: NodeFsAdapter,
  ) {}

  /**
   * Execute the unarchive operation for a single asset.
   */
  async unarchive(options: UnarchiveOptions): Promise<UnarchiveResult> {
    const { uuid, dryRun } = options;

    // Step 1: Find asset in archive vault by UUID
    const assetFile = await this.findAssetByUUID(uuid);
    if (!assetFile) {
      return {
        success: false,
        uuid,
        error: `UUID ${uuid} not found in archive vault`,
      };
    }

    // Step 2: Read content and extract frontmatter
    const content = await this.archiveFs.readFile(assetFile);
    const metadata = this.extractFrontmatter(content);

    // Step 3: Resolve active ontology URI from archive ontology
    const isDefinedBy = metadata.exo__Asset_isDefinedBy;
    const activeOntologyWikilink = isDefinedBy
      ? this.resolveActiveOntology(String(isDefinedBy))
      : null;

    // Step 4: Determine target path in active vault
    const targetPath = path.join("03 Knowledge", "inbox", path.basename(assetFile));

    // Dry-run: return preview without making changes
    if (dryRun) {
      return {
        success: true,
        uuid,
        movedTo: targetPath,
        isDefinedBy: activeOntologyWikilink || undefined,
      };
    }

    // Step 5: Update isDefinedBy in content
    let updatedContent = content;
    if (isDefinedBy && activeOntologyWikilink) {
      updatedContent = updatedContent.replace(
        String(isDefinedBy),
        activeOntologyWikilink,
      );
    }

    // Step 6: Write file to active vault inbox
    await this.activeFs.writeFile(targetPath, updatedContent);

    // Step 7: Delete from archive vault
    await this.archiveFs.deleteFile(assetFile);

    return {
      success: true,
      uuid,
      movedTo: targetPath,
      isDefinedBy: activeOntologyWikilink || undefined,
    };
  }

  /**
   * Find asset file by UUID in the archive vault.
   *
   * Search order:
   * 1. Direct filename match: <uuid>.md
   * 2. Scan all files for exo__Asset_uid match in frontmatter
   */
  private async findAssetByUUID(uuid: string): Promise<string | null> {
    // Fast path: check if file with UUID name exists
    const directPath = uuid + ".md";
    const exists = await this.archiveFs.fileExists(directPath);
    if (exists) {
      return directPath;
    }

    // Slow path: scan archive vault for matching exo__Asset_uid
    const allFiles = await this.archiveFs.getMarkdownFiles();
    for (const file of allFiles) {
      try {
        const content = await this.archiveFs.readFile(file);
        const metadata = this.extractFrontmatter(content);
        const uid = metadata.exo__Asset_uid;
        if (uid && String(uid).toLowerCase() === uuid.toLowerCase()) {
          return file;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Resolve the active ontology wikilink from an archive ontology wikilink.
   *
   * Reverse of ArchiveService.getArchiveOntologyName():
   * "[[!ems_archive|EMS Ontology (Archive)]]" → "[[!ems|EMS Ontology]]"
   * "[[!ems_archive]]" → "[[!ems]]"
   */
  private resolveActiveOntology(archiveWikilink: string): string | null {
    const match = archiveWikilink.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (!match) return null;

    const target = match[1]; // e.g. "!ems_archive"
    const label = match[2]; // e.g. "EMS Ontology (Archive)" or undefined

    // Check if this is actually an archive ontology reference
    if (!target.endsWith("_archive")) {
      // Already pointing to active ontology, return as-is
      return archiveWikilink;
    }

    // Strip _archive suffix
    const activeTarget = target.replace(/_archive$/, "");

    // Strip " (Archive)" suffix from label if present
    if (label) {
      const activeLabel = label.replace(/\s*\(Archive\)$/, "");
      return `[[${activeTarget}|${activeLabel}]]`;
    }

    return `[[${activeTarget}]]`;
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
}
