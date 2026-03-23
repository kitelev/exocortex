import yaml from "js-yaml";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";

/**
 * Statistics aggregation result for an archive vault.
 */
export interface ArchiveStats {
  /** Total number of archived assets */
  total: number;
  /** Count of assets per ontological class */
  by_class: Record<string, number>;
  /** Count of assets per year (derived from timestamps) */
  by_year: Record<string, number>;
  /** Cross-tabulation: count per class per year */
  cross: Record<string, Record<string, number>>;
}

/**
 * Aggregates statistics from an archive vault by scanning all markdown files
 * and collecting counts by ontological class and by year.
 *
 * Year is derived from `ems__Effort_resolutionTimestamp` with fallback to
 * `ems__Effort_endTimestamp`. Missing timestamps produce year key `"unknown"`.
 *
 * Class is derived from `exo__Instance_class`. Missing class produces
 * class key `"unknown"`.
 *
 * Runs in a single O(n) pass over files.
 *
 * @example
 * ```typescript
 * const service = new ArchiveStatsService(new NodeFsAdapter(archivePath));
 * const stats = await service.collect();
 * console.log(stats.total, stats.by_class, stats.by_year);
 * ```
 */
export class ArchiveStatsService {
  constructor(private readonly fs: NodeFsAdapter) {}

  /**
   * Collect archive vault statistics.
   *
   * @returns Aggregated statistics with total, by_class, by_year, and cross-tabulation
   */
  async collect(): Promise<ArchiveStats> {
    const files = await this.fs.getMarkdownFiles();
    const stats: ArchiveStats = {
      total: 0,
      by_class: {},
      by_year: {},
      cross: {},
    };

    for (const file of files) {
      try {
        const content = await this.fs.readFile(file);
        const fm = this.extractFrontmatter(content);

        stats.total++;

        const cls = this.extractClass(fm);
        stats.by_class[cls] = (stats.by_class[cls] ?? 0) + 1;

        const year = this.extractYear(fm);
        stats.by_year[year] = (stats.by_year[year] ?? 0) + 1;

        if (!stats.cross[cls]) stats.cross[cls] = {};
        stats.cross[cls][year] = (stats.cross[cls][year] ?? 0) + 1;
      } catch {
        // Skip unreadable files
        continue;
      }
    }

    return stats;
  }

  /**
   * Extract the class short name from frontmatter.
   *
   * Handles both string and array forms of exo__Instance_class.
   * Extracts the label from wikilink format: `"[[uuid|ClassName]]"` → `"ClassName"`.
   */
  private extractClass(fm: Record<string, unknown>): string {
    const raw = fm.exo__Instance_class;
    if (!raw) return "unknown";

    const value = Array.isArray(raw) ? raw[0] : raw;
    const str = String(value).replace(/^"|"$/g, "");

    // Extract label from wikilink: [[uuid|Label]] → Label
    const wikilinkMatch = str.match(/\[\[[^\]|]+\|([^\]]+)\]\]/);
    if (wikilinkMatch) return wikilinkMatch[1];

    // Extract plain wikilink: [[ClassName]] → ClassName
    const plainMatch = str.match(/\[\[([^\]]+)\]\]/);
    if (plainMatch) return plainMatch[1];

    return str || "unknown";
  }

  /**
   * Extract year from timestamps.
   *
   * Priority: ems__Effort_resolutionTimestamp > ems__Effort_endTimestamp.
   * Falls back to "unknown" if neither is present.
   */
  private extractYear(fm: Record<string, unknown>): string {
    const ts =
      fm.ems__Effort_resolutionTimestamp ?? fm.ems__Effort_endTimestamp;

    if (!ts) return "unknown";

    // js-yaml may parse ISO timestamps as Date objects
    if (ts instanceof Date) {
      const year = ts.getFullYear();
      return isNaN(year) ? "unknown" : year.toString();
    }

    const str = String(ts);
    const yearMatch = str.match(/^(\d{4})/);
    return yearMatch ? yearMatch[1] : "unknown";
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
