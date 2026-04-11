import { TFile } from "obsidian";
import { BlockerHelpers } from '@plugin/presentation/utils/BlockerHelpers';
import { ObsidianApp, MetadataRecord } from '@plugin/types';

export class AssetMetadataService {
  constructor(private app: ObsidianApp) {}

  getAssetLabel(path: string): string | null {
    let file = this.app.metadataCache.getFirstLinkpathDest(path, "");

    if (!file && !path.endsWith(".md")) {
      file = this.app.metadataCache.getFirstLinkpathDest(path + ".md", "");
    }

    if (!(file instanceof TFile)) {
      return null;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const metadata = cache?.frontmatter || {};

    const label = metadata.exo__Asset_label;
    if (label && typeof label === "string" && label.trim() !== "") {
      return label;
    }

    return null;
  }

  extractFirstValue(value: unknown): string | null {
    if (!value) {
      return null;
    }

    if (typeof value === "string" && value.trim() !== "") {
      return value.replace(/^\[\[|\]\]$/g, "").trim();
    }

    if (Array.isArray(value) && value.length > 0) {
      const firstValue = value[0];
      if (typeof firstValue === "string" && firstValue.trim() !== "") {
        return firstValue.replace(/^\[\[|\]\]$/g, "").trim();
      }
    }

    return null;
  }

  getEffortArea(
    metadata: Record<string, unknown>,
    visited: Set<string> = new Set(),
  ): string | null {
    if (!metadata || typeof metadata !== "object") {
      return null;
    }

    const area = metadata.ems__Effort_area;
    const directArea = this.extractFirstValue(area);
    if (directArea) {
      return directArea;
    }

    const parentRef = metadata.ems__Effort_parent;
    const parentPath = this.extractFirstValue(parentRef);

    if (parentPath && !visited.has(parentPath)) {
      visited.add(parentPath);
      let parentFile = this.app.metadataCache.getFirstLinkpathDest(
        parentPath,
        "",
      );

      if (!parentFile && !parentPath.endsWith(".md")) {
        parentFile = this.app.metadataCache.getFirstLinkpathDest(
          parentPath + ".md",
          "",
        );
      }

      if (parentFile instanceof TFile) {
        const parentCache = this.app.metadataCache.getFileCache(parentFile);
        const parentMetadata = parentCache?.frontmatter || {};

        const resolvedArea = this.getEffortArea(parentMetadata, visited);
        if (resolvedArea) {
          return resolvedArea;
        }
      }
    }

    return null;
  }

  extractInstanceClass(metadata: MetadataRecord): string {
    const instanceClass = metadata.exo__Instance_class || "";
    const raw = Array.isArray(instanceClass)
      ? String(instanceClass[0] || "")
      : String(instanceClass);

    // Strip wikilink brackets: [[target|alias]] → target|alias, or [[target]] → target
    const stripped = raw.replace(/^\[\[|\]\]$/g, "").trim();
    if (!stripped) return "";

    // Extract link target (before |) — may be UUID or human-readable name
    const linkTarget = stripped.includes("|")
      ? stripped.split("|")[0].trim()
      : stripped;

    // If linkTarget looks like a UUID, resolve to exo__Asset_label via metadata cache
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(linkTarget)) {
      const label = this.getAssetLabel(linkTarget);
      if (label) return label;
    }

    // Fallback: return as-is (backward compatible with [[ems__Area]] format)
    return linkTarget;
  }

  /**
   * Checks if an effort is blocked by another effort.
   * An effort is considered blocked when:
   * - It has an ems__Effort_blocker property referencing another effort
   * - The referenced blocker effort has a status that is not DONE or TRASHED
   *
   * @param metadata The metadata of the effort to check
   * @returns true if the effort is blocked, false otherwise
   */
  isEffortBlocked(metadata: Record<string, unknown>): boolean {
    return BlockerHelpers.isEffortBlocked(this.app, metadata);
  }
}
