import path from "path";
import yaml from "js-yaml";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";

/**
 * Maximum number of fixed-point iterations to prevent infinite loops.
 */
const MAX_ITERATIONS = 100;

/**
 * Options for the cascade archive operation.
 */
export interface CascadeOptions {
  /** Path to the active vault */
  vaultPath: string;
  /** Path to the archive vault */
  archiveVaultPath: string;
  /** If true, preview without writing files */
  dryRun: boolean;
}

/**
 * Detail of a single iteration in the cascade process.
 */
export interface IterationDetail {
  /** 1-based iteration number */
  iteration: number;
  /** UUIDs of assets moved in this iteration */
  moved: string[];
}

/**
 * Result of the cascade archive operation.
 */
export interface CascadeResult {
  /** Number of completed iterations */
  iterations: number;
  /** Total number of assets moved across all iterations */
  total_moved: number;
  /** Number of archived assets still blocked after completion */
  still_blocked: number;
  /** Detail of each iteration */
  iterations_detail: IterationDetail[];
}

/**
 * Internal representation of a file in the vault.
 */
interface VaultFile {
  relativePath: string;
  uuid: string;
  metadata: Record<string, unknown>;
  content: string;
  isArchived: boolean;
}

/**
 * Service that performs cascade archive: iteratively moves archived assets
 * from active vault to archive vault by resolving dependency chains.
 *
 * Algorithm (fixed-point iteration):
 * 1. Scan active vault for all markdown files
 * 2. Identify archived candidates (archived: true in frontmatter)
 * 3. Build reference set from non-archived files (UUID mentions)
 * 4. For each candidate: if no active (non-archived) files reference its UUID -> freeable
 * 5. Transfer all freeable candidates to archive vault
 * 6. Repeat (moved candidates no longer block others)
 * 7. Terminate when no new candidates freed (fixed-point) or MAX_ITERATIONS reached
 */
export class ArchiveCascadeService {
  constructor(
    private readonly activeFs: NodeFsAdapter,
    private readonly archiveFs: NodeFsAdapter,
  ) {}

  /**
   * Execute cascade archive operation.
   */
  async cascade(options: CascadeOptions): Promise<CascadeResult> {
    const result: CascadeResult = {
      iterations: 0,
      total_moved: 0,
      still_blocked: 0,
      iterations_detail: [],
    };

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      // Step 1: Scan active vault
      const allFiles = await this.activeFs.getMarkdownFiles();
      const files = await this.readAllFiles(allFiles);

      // Step 2: Identify archived candidates and non-archived files
      const candidates = files.filter((f) => f.isArchived && f.uuid);
      const nonArchivedFiles = files.filter((f) => !f.isArchived);

      if (candidates.length === 0) {
        break;
      }

      // Step 3: Build reference set from non-archived file contents
      const activeReferenceSet = this.buildReferenceSet(
        nonArchivedFiles.map((f) => f.content),
      );

      // Step 4: Find freeable candidates (no active incoming refs)
      const freeable = candidates.filter(
        (c) => !activeReferenceSet.has(c.uuid.toLowerCase()),
      );

      if (freeable.length === 0) {
        // Fixed-point reached: no more candidates can be freed
        result.still_blocked = candidates.length;
        break;
      }

      // Step 5: Transfer freeable candidates
      const movedUuids: string[] = [];

      if (!options.dryRun) {
        // Create archive ontologies for this batch
        await this.createArchiveOntologies(freeable);

        for (const candidate of freeable) {
          await this.transferFile(candidate);
          movedUuids.push(candidate.uuid);
        }
      } else {
        for (const candidate of freeable) {
          movedUuids.push(candidate.uuid);
        }
      }

      result.iterations++;
      result.total_moved += movedUuids.length;
      result.iterations_detail.push({
        iteration: result.iterations,
        moved: movedUuids,
      });

      // In dry-run mode, we cannot iterate further because files are not moved
      if (options.dryRun) {
        // Count remaining blocked after this virtual iteration
        const stillBlocked = candidates.length - freeable.length;
        result.still_blocked = stillBlocked;
        break;
      }
    }

    // Check if we hit MAX_ITERATIONS (safety limit)
    if (result.iterations >= MAX_ITERATIONS) {
      throw new Error(
        `MAX_ITERATIONS (${MAX_ITERATIONS}) exceeded during cascade archive. ` +
          `This likely indicates a bug. Moved ${result.total_moved} assets before stopping.`,
      );
    }

    // Final count of still-blocked candidates (if not already set)
    if (
      result.iterations > 0 &&
      result.still_blocked === 0 &&
      !options.dryRun
    ) {
      const finalFiles = await this.activeFs.getMarkdownFiles();
      const finalParsed = await this.readAllFiles(finalFiles);
      result.still_blocked = finalParsed.filter(
        (f) => f.isArchived && f.uuid,
      ).length;
    }

    return result;
  }

  /**
   * Read and parse all markdown files.
   */
  private async readAllFiles(filePaths: string[]): Promise<VaultFile[]> {
    const files: VaultFile[] = [];

    for (const filePath of filePaths) {
      try {
        const content = await this.activeFs.readFile(filePath);
        const metadata = this.extractFrontmatter(content);
        const isArchived = metadata.archived === true;
        const uuid = this.extractUUID(filePath, metadata);

        files.push({
          relativePath: filePath,
          uuid: uuid || "",
          metadata,
          content,
          isArchived,
        });
      } catch {
        // Skip unreadable files
        continue;
      }
    }

    return files;
  }

  /**
   * Build a Set of all UUIDs referenced in file contents.
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
   * Create archive ontology files for candidates being moved.
   */
  private async createArchiveOntologies(
    candidates: VaultFile[],
  ): Promise<number> {
    const ontologyMap = this.collectOntologies(candidates);
    let created = 0;

    for (const [ontologyPath] of ontologyMap.entries()) {
      const archiveOntologyName = ontologyPath + "_archive";
      const archiveOntologyPath = archiveOntologyName + ".md";

      const exists = await this.archiveFs.fileExists(archiveOntologyPath);
      if (exists) continue;

      try {
        const ontologyContent = await this.activeFs.readFile(
          ontologyPath + ".md",
        );
        const ontologyMeta = this.extractFrontmatter(ontologyContent);
        const activeUrl = ontologyMeta.exo__Ontology_url;

        if (activeUrl) {
          const archiveUrl =
            String(activeUrl).replace(/#$/, "") + "/archive#";
          const archiveContent = this.buildOntologyFile(
            archiveOntologyName,
            archiveUrl,
            ontologyMeta,
          );
          await this.archiveFs.writeFile(archiveOntologyPath, archiveContent);
          created++;
        }
      } catch {
        continue;
      }
    }

    return created;
  }

  /**
   * Collect unique ontology paths from candidates' isDefinedBy.
   */
  private collectOntologies(
    candidates: VaultFile[],
  ): Map<string, VaultFile[]> {
    const map = new Map<string, VaultFile[]>();

    for (const candidate of candidates) {
      const isDefinedBy = candidate.metadata.exo__Asset_isDefinedBy;
      if (!isDefinedBy) continue;

      const ontologyPath = this.extractWikilinkTarget(String(isDefinedBy));
      if (!ontologyPath) continue;

      const existing = map.get(ontologyPath) || [];
      existing.push(candidate);
      map.set(ontologyPath, existing);
    }

    return map;
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
      exo__Instance_class:
        activeMeta.exo__Instance_class || "exo__Ontology",
      exo__Asset_label: `${activeMeta.exo__Asset_label || name} (Archive)`,
      exo__Ontology_url: url,
    };

    const yamlStr = yaml.dump(frontmatter, { lineWidth: -1 });
    return `---\n${yamlStr}---\n`;
  }

  /**
   * Transfer a single file from active vault to archive vault.
   */
  private async transferFile(candidate: VaultFile): Promise<void> {
    let content = candidate.content;

    // Update isDefinedBy to point to archive ontology
    const isDefinedBy = candidate.metadata.exo__Asset_isDefinedBy;
    if (isDefinedBy) {
      const ontologyTarget = this.extractWikilinkTarget(String(isDefinedBy));
      if (ontologyTarget) {
        const archiveName = ontologyTarget + "_archive";
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
   * Extract UUID from file path or frontmatter.
   */
  private extractUUID(
    filePath: string,
    metadata: Record<string, unknown>,
  ): string | null {
    const uid = metadata.exo__Asset_uid;
    if (uid) return String(uid);

    const basename = path.basename(filePath, ".md");
    if (this.isUUID(basename)) return basename;

    return null;
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
