import path from "path";
import yaml from "js-yaml";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { ClassResolverService } from "./ClassResolverService.js";

/**
 * Result of the archive operation
 */
export interface ArchiveResult {
  /** Number of assets successfully moved to archive vault */
  moved: number;
  /** Number of assets blocked due to active references */
  blocked: number;
  /** Number of assets skipped (no match, file issues) */
  skipped: number;
  /** Number of archive ontologies created */
  ontologies_created: number;
  /** Detailed info per candidate */
  details: ArchiveCandidateDetail[];
}

/**
 * Detail for a single archive candidate
 */
export interface ArchiveCandidateDetail {
  uuid: string;
  file: string;
  status: "moved" | "blocked" | "skipped";
  reason?: string;
  blockedBy?: string[];
}

/**
 * Options for the archive operation
 */
export interface ArchiveOptions {
  /** Path to the active vault */
  vaultPath: string;
  /** Path to the archive vault */
  archiveVaultPath: string;
  /** Class short names or UUIDs to archive */
  classes: string[];
  /** Year to filter by (resolution/end timestamp year) */
  year: number;
  /** If true, preview without writing */
  dryRun: boolean;
  /** If true, skip referenced assets (default: true) */
  noReferenced: boolean;
}

/**
 * Internal representation of a candidate file
 */
interface CandidateFile {
  relativePath: string;
  uuid: string;
  metadata: Record<string, unknown>;
  content: string;
}

/**
 * Service that handles archiving assets from active vault to archive vault.
 *
 * Algorithm:
 * 1. Scan active vault for candidates (archived: true, class match, year match)
 * 2. Build reference set from all non-archived files (UUID mentions)
 * 3. Check references: if candidate UUID found in non-archived files -> blocked
 * 4. Create archive ontology files if needed
 * 5. Transfer: update isDefinedBy, copy to archive, remove from active
 * 6. Report: JSON with moved/blocked/skipped/ontologies_created
 */
export class ArchiveService {
  constructor(
    private readonly activeFs: NodeFsAdapter,
    private readonly archiveFs: NodeFsAdapter,
    private readonly classResolver: ClassResolverService,
  ) {}

  /**
   * Execute the archive operation.
   */
  async archive(options: ArchiveOptions): Promise<ArchiveResult> {
    // Step 1: Resolve class names to UUIDs
    const classUUIDs = await this.resolveClasses(
      options.vaultPath,
      options.classes,
    );

    // Step 2: Scan vault for all markdown files
    const allFiles = await this.activeFs.getMarkdownFiles();

    // Step 3: Classify files into candidates and non-archived
    const candidates: CandidateFile[] = [];
    const nonArchivedContents: string[] = [];

    for (const file of allFiles) {
      try {
        const content = await this.activeFs.readFile(file);
        const metadata = this.extractFrontmatter(content);

        if (this.isCandidate(metadata, classUUIDs, options.year)) {
          const uuid = this.extractUUID(file, metadata);
          if (uuid) {
            candidates.push({ relativePath: file, uuid, metadata, content });
          }
        } else {
          // Non-archived file: collect content for reference checking
          const isArchived = metadata.archived === true;
          if (!isArchived) {
            nonArchivedContents.push(content);
          }
        }
      } catch {
        // Skip unreadable files
        continue;
      }
    }

    // Step 4: Build reference set from non-archived files
    const referenceSet = this.buildReferenceSet(nonArchivedContents);

    // Step 5: Classify candidates as movable or blocked
    const details: ArchiveCandidateDetail[] = [];
    const movable: CandidateFile[] = [];

    for (const candidate of candidates) {
      if (options.noReferenced && referenceSet.has(candidate.uuid)) {
        // Find which files reference this candidate
        const blockedBy = this.findReferencingFiles(
          candidate.uuid,
          nonArchivedContents,
        );
        details.push({
          uuid: candidate.uuid,
          file: candidate.relativePath,
          status: "blocked",
          reason: "Referenced by non-archived assets",
          blockedBy,
        });
      } else {
        movable.push(candidate);
      }
    }

    // Step 6: Create archive ontologies and transfer files
    let ontologiesCreated = 0;

    if (!options.dryRun) {
      ontologiesCreated = await this.createArchiveOntologies(
        movable,
        options.vaultPath,
        options.archiveVaultPath,
      );

      for (const candidate of movable) {
        await this.transferFile(candidate, options.archiveVaultPath);
        details.push({
          uuid: candidate.uuid,
          file: candidate.relativePath,
          status: "moved",
        });
      }
    } else {
      // Dry run: count ontologies that would be created
      ontologiesCreated = await this.countArchiveOntologies(
        movable,
        options.vaultPath,
        options.archiveVaultPath,
      );

      for (const candidate of movable) {
        details.push({
          uuid: candidate.uuid,
          file: candidate.relativePath,
          status: "moved",
          reason: "dry-run: would be moved",
        });
      }
    }

    return {
      moved: movable.length,
      blocked: details.filter((d) => d.status === "blocked").length,
      skipped: 0,
      ontologies_created: ontologiesCreated,
      details,
    };
  }

  /**
   * Resolve class short names to UUIDs using ClassResolverService.
   */
  private async resolveClasses(
    vaultPath: string,
    classNames: string[],
  ): Promise<Set<string>> {
    const uuids = new Set<string>();
    for (const className of classNames) {
      try {
        const uuid = await this.classResolver.resolve(vaultPath, className);
        uuids.add(uuid);
        // Also add the original name as a fallback for label-based matching
        uuids.add(className);
      } catch {
        // If class not found, still use name for label matching
        uuids.add(className);
      }
    }
    return uuids;
  }

  /**
   * Check if a file's metadata qualifies it as an archive candidate.
   *
   * Requirements:
   * - archived: true in frontmatter
   * - Class matches one of the target classes
   * - Resolution/end timestamp falls within the target year
   */
  private isCandidate(
    metadata: Record<string, unknown>,
    classUUIDs: Set<string>,
    year: number,
  ): boolean {
    // Must be archived
    if (metadata.archived !== true) {
      return false;
    }

    // Must match class
    if (!this.matchesClass(metadata, classUUIDs)) {
      return false;
    }

    // Must match year
    if (!this.matchesYear(metadata, year)) {
      return false;
    }

    return true;
  }

  /**
   * Check if metadata matches one of the target class UUIDs or names.
   */
  private matchesClass(
    metadata: Record<string, unknown>,
    classUUIDs: Set<string>,
  ): boolean {
    const instanceClass = metadata.exo__Instance_class;
    if (!instanceClass) return false;

    const classes = Array.isArray(instanceClass)
      ? instanceClass
      : [instanceClass];

    return classes.some((cls) => {
      const clsStr = String(cls).replace(/["'[\]]/g, "").trim();
      return classUUIDs.has(clsStr);
    });
  }

  /**
   * Check if the asset's resolution/end timestamp matches the target year.
   */
  private matchesYear(metadata: Record<string, unknown>, year: number): boolean {
    const timestamps = [
      metadata.ems__Effort_resolutionTimestamp,
      metadata.ems__Effort_endTimestamp,
    ];

    for (const ts of timestamps) {
      if (ts) {
        const tsYear = this.extractYear(ts);
        if (tsYear === year) return true;
      }
    }

    return false;
  }

  /**
   * Extract year from a timestamp value.
   * Handles both Date objects (YAML-parsed) and ISO timestamp strings.
   */
  private extractYear(timestamp: unknown): number | null {
    if (timestamp instanceof Date) {
      return timestamp.getFullYear();
    }
    const str = String(timestamp);
    const match = str.match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Extract UUID from file path or frontmatter.
   */
  private extractUUID(
    filePath: string,
    metadata: Record<string, unknown>,
  ): string | null {
    // Prefer exo__Asset_uid from frontmatter
    const uid = metadata.exo__Asset_uid;
    if (uid) return String(uid);

    // Fallback to filename (without .md extension)
    const basename = path.basename(filePath, ".md");
    if (this.isUUID(basename)) return basename;

    return null;
  }

  /**
   * Build a Set of all UUIDs referenced in non-archived file contents.
   * Uses a single pass over all content with UUID regex extraction.
   */
  private buildReferenceSet(contents: string[]): Set<string> {
    const uuidPattern =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const referenceSet = new Set<string>();

    for (const content of contents) {
      const matches = content.match(uuidPattern);
      if (matches) {
        for (const match of matches) {
          referenceSet.add(match.toLowerCase());
        }
      }
    }

    return referenceSet;
  }

  /**
   * Find which non-archived files reference the given UUID.
   * Returns file indices (for reporting).
   */
  private findReferencingFiles(
    _uuid: string,
    _contents: string[],
  ): string[] {
    // For performance we don't track file names in reference set.
    // Return generic info.
    return [`referenced in active vault`];
  }

  /**
   * Create archive ontology files for each unique isDefinedBy value
   * found among movable candidates.
   */
  private async createArchiveOntologies(
    candidates: CandidateFile[],
    _vaultPath: string,
    _archiveVaultPath: string,
  ): Promise<number> {
    const ontologyMap = this.collectOntologies(candidates);
    let created = 0;

    for (const [ontologyPath, _candidates] of ontologyMap.entries()) {
      const archiveOntologyName = this.getArchiveOntologyName(ontologyPath);
      const archiveOntologyPath = archiveOntologyName + ".md";

      // Check if archive ontology already exists
      const exists = await this.archiveFs.fileExists(archiveOntologyPath);
      if (exists) continue;

      // Read active ontology to get URL
      try {
        const ontologyContent = await this.activeFs.readFile(ontologyPath + ".md");
        const ontologyMeta = this.extractFrontmatter(ontologyContent);
        const activeUrl = ontologyMeta.exo__Ontology_url;

        if (activeUrl) {
          const archiveUrl = String(activeUrl).replace(/#$/, "") + "/archive#";
          const archiveContent = this.buildOntologyFile(
            archiveOntologyName,
            archiveUrl,
            ontologyMeta,
          );
          await this.archiveFs.writeFile(archiveOntologyPath, archiveContent);
          created++;
        }
      } catch {
        // If ontology file not found, skip
        continue;
      }
    }

    return created;
  }

  /**
   * Count how many archive ontologies would be created (dry-run).
   */
  private async countArchiveOntologies(
    candidates: CandidateFile[],
    _vaultPath: string,
    _archiveVaultPath: string,
  ): Promise<number> {
    const ontologyMap = this.collectOntologies(candidates);
    let count = 0;

    for (const [ontologyPath, _candidates] of ontologyMap.entries()) {
      const archiveOntologyName = this.getArchiveOntologyName(ontologyPath);
      const archiveOntologyPath = archiveOntologyName + ".md";

      const exists = await this.archiveFs.fileExists(archiveOntologyPath);
      if (!exists) {
        // Check if active ontology exists and has URL
        try {
          const ontologyContent = await this.activeFs.readFile(ontologyPath + ".md");
          const ontologyMeta = this.extractFrontmatter(ontologyContent);
          if (ontologyMeta.exo__Ontology_url) {
            count++;
          }
        } catch {
          continue;
        }
      }
    }

    return count;
  }

  /**
   * Collect unique ontology paths from candidates' isDefinedBy.
   */
  private collectOntologies(
    candidates: CandidateFile[],
  ): Map<string, CandidateFile[]> {
    const map = new Map<string, CandidateFile[]>();

    for (const candidate of candidates) {
      const isDefinedBy = candidate.metadata.exo__Asset_isDefinedBy;
      if (!isDefinedBy) continue;

      // isDefinedBy is a wikilink like "[[!ems|EMS Ontology]]"
      const ontologyPath = this.extractWikilinkTarget(String(isDefinedBy));
      if (!ontologyPath) continue;

      const existing = map.get(ontologyPath) || [];
      existing.push(candidate);
      map.set(ontologyPath, existing);
    }

    return map;
  }

  /**
   * Get archive ontology filename from active ontology path.
   * Example: "!ems" -> "!ems_archive"
   */
  private getArchiveOntologyName(ontologyPath: string): string {
    return ontologyPath + "_archive";
  }

  /**
   * Build an ontology markdown file content.
   */
  private buildOntologyFile(
    name: string,
    url: string,
    activeMeta: Record<string, unknown>,
  ): string {
    const frontmatter: Record<string, unknown> = {
      exo__Instance_class: activeMeta.exo__Instance_class || "exo__Ontology",
      exo__Asset_label: `${activeMeta.exo__Asset_label || name} (Archive)`,
      exo__Ontology_url: url,
    };

    const yamlStr = yaml.dump(frontmatter, { lineWidth: -1 });
    return `---\n${yamlStr}---\n`;
  }

  /**
   * Transfer a single file from active vault to archive vault.
   * - Read content
   * - Update isDefinedBy to archive ontology
   * - Write to archive vault
   * - Delete from active vault
   */
  private async transferFile(
    candidate: CandidateFile,
    _archiveVaultPath: string,
  ): Promise<void> {
    let content = candidate.content;

    // Update isDefinedBy to point to archive ontology
    const isDefinedBy = candidate.metadata.exo__Asset_isDefinedBy;
    if (isDefinedBy) {
      const ontologyTarget = this.extractWikilinkTarget(String(isDefinedBy));
      if (ontologyTarget) {
        const archiveName = this.getArchiveOntologyName(ontologyTarget);
        // Replace the wikilink target in frontmatter
        content = content.replace(
          String(isDefinedBy),
          String(isDefinedBy).replace(ontologyTarget, archiveName),
        );
      }
    }

    // Write to archive vault using UUID filename
    const archivePath = candidate.uuid + ".md";
    await this.archiveFs.writeFile(archivePath, content);

    // Delete from active vault
    await this.activeFs.deleteFile(candidate.relativePath);
  }

  /**
   * Extract wikilink target from a wikilink string.
   * "[[!ems|EMS Ontology]]" -> "!ems"
   * "[[!ems]]" -> "!ems"
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
