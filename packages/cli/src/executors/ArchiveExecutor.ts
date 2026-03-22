import { resolve, dirname, relative, basename } from "path";
import fs from "fs-extra";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { FrontmatterService } from "exocortex";

/**
 * Result of a single asset archival evaluation
 */
export interface ArchiveAssetResult {
  filepath: string;
  status: "moved" | "blocked" | "skipped";
  reason?: string;
  blockedBy?: string[];
}

/**
 * Summary report of the archive operation
 */
export interface ArchiveReport {
  moved: number;
  blocked: number;
  skipped: number;
  ontologiesCreated: number;
  details: ArchiveAssetResult[];
  durationMs: number;
}

/**
 * Options for the archive executor
 */
export interface ArchiveOptions {
  vaultPath: string;
  archiveVaultPath: string;
  classes?: string[];
  year?: number;
  dryRun: boolean;
}

/**
 * Executes automated asset archival from active vault to archive vault.
 *
 * Algorithm:
 * 1. Scan active vault for archived assets matching filters
 * 2. Check each candidate for incoming wikilinks from non-archived assets
 * 3. Auto-create archive ontology files if needed
 * 4. Transfer qualifying assets to archive vault
 * 5. Remove from active vault
 * 6. Generate report
 */
export class ArchiveExecutor {
  private sourceAdapter: NodeFsAdapter;
  private frontmatterService: FrontmatterService;

  constructor(private options: ArchiveOptions) {
    this.sourceAdapter = new NodeFsAdapter(options.vaultPath);
    this.frontmatterService = new FrontmatterService();
  }

  /**
   * Execute the archive operation
   */
  async execute(): Promise<ArchiveReport> {
    const startTime = Date.now();
    const details: ArchiveAssetResult[] = [];
    let ontologiesCreated = 0;

    // Step 1: Scan all markdown files and build metadata index
    const allFiles = await this.sourceAdapter.getMarkdownFiles();
    const metadataIndex = await this.buildMetadataIndex(allFiles);

    // Step 2: Identify candidates (archived assets matching filters)
    const candidates = this.identifyCandidates(metadataIndex);

    // Step 3: Build wikilink index for reference checking
    const wikilinkIndex = await this.buildWikilinkIndex(allFiles, metadataIndex);

    // Step 4: Process each candidate
    const candidateSet = new Set(candidates.map((c) => c.filepath));

    for (const candidate of candidates) {
      // Check for incoming wikilinks from non-archived, non-candidate assets
      const blockers = this.findBlockers(
        candidate.filepath,
        wikilinkIndex,
        metadataIndex,
        candidateSet,
      );

      if (blockers.length > 0) {
        details.push({
          filepath: candidate.filepath,
          status: "blocked",
          reason: `Referenced by ${blockers.length} active asset(s)`,
          blockedBy: blockers,
        });
        continue;
      }

      // Check if the file still exists (might have been a missing file)
      const fileExists = await this.sourceAdapter.fileExists(candidate.filepath);
      if (!fileExists) {
        details.push({
          filepath: candidate.filepath,
          status: "skipped",
          reason: "File not found on disk",
        });
        continue;
      }

      if (!this.options.dryRun) {
        // Auto-create ontology files if needed
        const created = await this.ensureOntologies(
          candidate.filepath,
          candidate.metadata,
        );
        ontologiesCreated += created;

        // Transfer asset to archive vault
        await this.transferAsset(candidate.filepath, candidate.metadata);
      }

      details.push({
        filepath: candidate.filepath,
        status: "moved",
      });
    }

    return {
      moved: details.filter((d) => d.status === "moved").length,
      blocked: details.filter((d) => d.status === "blocked").length,
      skipped: details.filter((d) => d.status === "skipped").length,
      ontologiesCreated,
      details,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Build metadata index for all files
   */
  private async buildMetadataIndex(
    files: string[],
  ): Promise<Map<string, Record<string, any>>> {
    const index = new Map<string, Record<string, any>>();

    for (const file of files) {
      try {
        const metadata = await this.sourceAdapter.getFileMetadata(file);
        index.set(file, metadata);
      } catch {
        // Skip files that can't be parsed
      }
    }

    return index;
  }

  /**
   * Identify candidates for archival based on filters
   */
  private identifyCandidates(
    metadataIndex: Map<string, Record<string, any>>,
  ): Array<{ filepath: string; metadata: Record<string, any> }> {
    const candidates: Array<{ filepath: string; metadata: Record<string, any> }> = [];

    for (const [filepath, metadata] of metadataIndex) {
      // Must be archived
      if (!this.isArchived(metadata)) {
        continue;
      }

      // Filter by class if specified
      if (this.options.classes && this.options.classes.length > 0) {
        const assetClass = this.getAssetClass(metadata);
        if (!assetClass || !this.options.classes.some((c) => assetClass.includes(c))) {
          continue;
        }
      }

      // Filter by resolution year if specified
      if (this.options.year) {
        const resolutionYear = this.getResolutionYear(metadata);
        if (resolutionYear !== this.options.year) {
          continue;
        }
      }

      candidates.push({ filepath, metadata });
    }

    return candidates;
  }

  /**
   * Build index of wikilinks: target → source files
   */
  private async buildWikilinkIndex(
    files: string[],
    metadataIndex: Map<string, Record<string, any>>,
  ): Promise<Map<string, string[]>> {
    const index = new Map<string, string[]>();
    const wikilinkPattern = /\[\[([^\]|]+)(?:\|[^\]]*)?]]/g;

    for (const file of files) {
      try {
        const content = await this.sourceAdapter.readFile(file);
        let match: RegExpExecArray | null;

        while ((match = wikilinkPattern.exec(content)) !== null) {
          const target = match[1].trim();
          // Normalize: remove .md extension for matching
          const normalizedTarget = target.replace(/\.md$/, "");

          // Try to resolve target to a filepath
          const resolvedTarget = this.resolveWikilinkTarget(
            normalizedTarget,
            metadataIndex,
          );
          if (resolvedTarget) {
            const sources = index.get(resolvedTarget) || [];
            if (!sources.includes(file)) {
              sources.push(file);
            }
            index.set(resolvedTarget, sources);
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return index;
  }

  /**
   * Resolve a wikilink target to a filepath in the metadata index
   */
  private resolveWikilinkTarget(
    target: string,
    metadataIndex: Map<string, Record<string, any>>,
  ): string | null {
    // Direct match by filename (without extension)
    for (const filepath of metadataIndex.keys()) {
      const name = basename(filepath, ".md");
      if (name === target) {
        return filepath;
      }
    }
    return null;
  }

  /**
   * Find assets that block archival (active assets referencing the candidate)
   */
  private findBlockers(
    candidateFilepath: string,
    wikilinkIndex: Map<string, string[]>,
    metadataIndex: Map<string, Record<string, any>>,
    candidateSet: Set<string>,
  ): string[] {
    const sources = wikilinkIndex.get(candidateFilepath) || [];

    return sources.filter((source) => {
      // Self-references don't block
      if (source === candidateFilepath) return false;

      // Other candidates don't block (they're also being archived)
      if (candidateSet.has(source)) return false;

      // Only non-archived assets block
      const metadata = metadataIndex.get(source);
      if (!metadata) return false;

      return !this.isArchived(metadata);
    });
  }

  /**
   * Ensure ontology files exist in archive vault for the asset's class
   */
  private async ensureOntologies(
    _filepath: string,
    metadata: Record<string, any>,
  ): Promise<number> {
    let created = 0;
    const archivePath = this.options.archiveVaultPath;

    // Get rdfs:isDefinedBy references from metadata
    const isDefinedBy = metadata["rdfs__isDefinedBy"];
    if (!isDefinedBy) return 0;

    const ontologyRefs = Array.isArray(isDefinedBy) ? isDefinedBy : [isDefinedBy];

    for (const ref of ontologyRefs) {
      // Extract filename from wikilink: "[[!exo]]" → "!exo.md"
      const linkMatch = String(ref).match(/\[\[([^\]|]+)/);
      if (!linkMatch) continue;

      const ontologyName = linkMatch[1].trim();
      // Look for ontology in a standard location
      const ontologyPath = resolve(
        archivePath,
        "03 Knowledge",
        "exo",
        `${ontologyName}.md`,
      );

      if (!(await fs.pathExists(ontologyPath))) {
        // Copy ontology from source vault if it exists
        const sourceOntologyPath = resolve(
          this.options.vaultPath,
          "03 Knowledge",
          "exo",
          `${ontologyName}.md`,
        );

        if (await fs.pathExists(sourceOntologyPath)) {
          await fs.ensureDir(dirname(ontologyPath));
          await fs.copy(sourceOntologyPath, ontologyPath);
          created++;
        }
      }
    }

    return created;
  }

  /**
   * Transfer an asset from active vault to archive vault
   */
  private async transferAsset(
    filepath: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    const sourcePath = resolve(this.options.vaultPath, filepath);
    const destPath = resolve(this.options.archiveVaultPath, filepath);

    // Ensure destination directory exists
    await fs.ensureDir(dirname(destPath));

    // Read content
    let content = await fs.readFile(sourcePath, "utf-8");

    // Update metadata: set rdfs:isDefinedBy to archive ontology if applicable
    if (metadata["rdfs__isDefinedBy"]) {
      // Keep the original isDefinedBy reference (archive vault has same ontology)
      // Just ensure archived flag is set
      content = this.frontmatterService.updateProperty(
        content,
        "exo__Asset_isArchived",
        "true",
      );
    }

    // Write to archive vault
    await fs.writeFile(destPath, content, "utf-8");

    // Remove from active vault
    await fs.remove(sourcePath);

    // Clean up empty directories in source
    await this.cleanEmptyDirs(dirname(sourcePath));
  }

  /**
   * Remove empty directories up the tree
   */
  private async cleanEmptyDirs(dirPath: string): Promise<void> {
    const vaultRoot = resolve(this.options.vaultPath);

    let current = dirPath;
    while (current !== vaultRoot && current.startsWith(vaultRoot)) {
      try {
        const entries = await fs.readdir(current);
        if (entries.length === 0) {
          await fs.rmdir(current);
          current = dirname(current);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }

  /**
   * Check if an asset is archived
   */
  private isArchived(metadata: Record<string, any>): boolean {
    if (metadata?.exo__Asset_isArchived === true) return true;

    const archived = metadata?.archived;
    if (archived === undefined || archived === null) return false;
    if (typeof archived === "boolean") return archived;
    if (typeof archived === "number") return archived !== 0;
    if (typeof archived === "string") {
      const normalized = archived.toLowerCase().trim();
      return normalized === "true" || normalized === "yes" || normalized === "1";
    }

    return false;
  }

  /**
   * Get asset class from metadata
   */
  private getAssetClass(metadata: Record<string, any>): string | null {
    const cls = metadata?.exo__Instance_class;
    if (!cls) return null;

    if (Array.isArray(cls)) {
      return cls.map(String).join(",");
    }

    return String(cls);
  }

  /**
   * Get resolution year from metadata
   */
  private getResolutionYear(metadata: Record<string, any>): number | null {
    const timestamp =
      metadata?.ems__Effort_resolutionTimestamp ||
      metadata?.ems__Effort_endTimestamp;

    if (!timestamp) return null;

    const date = new Date(String(timestamp));
    if (isNaN(date.getTime())) return null;

    return date.getFullYear();
  }
}
