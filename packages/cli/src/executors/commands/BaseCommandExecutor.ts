import { NodeFsAdapter } from "../../adapters/NodeFsAdapter.js";
import { PathResolver } from "../../utils/PathResolver.js";
import { FrontmatterService, DateFormatter } from "exocortex";

/**
 * Context shared across command executors
 */
export interface CommandContext {
  pathResolver: PathResolver;
  fsAdapter: NodeFsAdapter;
  frontmatterService: FrontmatterService;
  dryRun: boolean;
}

/**
 * Base class with shared command execution utilities
 */
export abstract class BaseCommandExecutor {
  protected pathResolver: PathResolver;
  protected fsAdapter: NodeFsAdapter;
  protected frontmatterService: FrontmatterService;
  protected dryRun: boolean;

  constructor(context: CommandContext) {
    this.pathResolver = context.pathResolver;
    this.fsAdapter = context.fsAdapter;
    this.frontmatterService = context.frontmatterService;
    this.dryRun = context.dryRun;
  }

  /**
   * Resolve and validate file path, return relative path
   */
  protected resolveAndValidate(filepath: string): { resolvedPath: string; relativePath: string } {
    const resolvedPath = this.pathResolver.resolve(filepath);
    this.pathResolver.validate(resolvedPath);
    const relativePath = resolvedPath.replace(this.pathResolver.getVaultRoot() + "/", "");
    return { resolvedPath, relativePath };
  }

  /**
   * Get current timestamp for property updates in ISO 8601 local time format.
   * Format: YYYY-MM-DDTHH:MM:SS (without Z suffix)
   */
  protected getCurrentTimestamp(): string {
    return DateFormatter.toLocalTimestamp(new Date());
  }

  /**
   * Check if asset is archived
   */
  protected isAssetArchived(metadata: Record<string, any>): boolean {
    if (metadata?.exo__Asset_isArchived === true) {
      return true;
    }

    const archivedValue = metadata?.archived;

    if (archivedValue === undefined || archivedValue === null) {
      return false;
    }

    if (typeof archivedValue === "boolean") {
      return archivedValue;
    }

    if (typeof archivedValue === "number") {
      return archivedValue !== 0;
    }

    if (typeof archivedValue === "string") {
      const normalized = archivedValue.toLowerCase().trim();
      return normalized === "true" || normalized === "yes" || normalized === "1";
    }

    return false;
  }

  /**
   * Extract aliases from frontmatter content
   */
  protected extractAliasesFromFrontmatter(frontmatterContent: string): string[] {
    const aliasesMatch = frontmatterContent.match(/aliases:\s*\n((?:  - .*\n?)*)/);
    if (!aliasesMatch) {
      return [];
    }

    const aliasLines = aliasesMatch[1].split("\n").filter((line) => line.trim());
    return aliasLines.map((line) => line.replace(/^\s*-\s*/, "").trim());
  }
}
