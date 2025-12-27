/**
 * WikilinkLabelResolver - Resolves display labels for wikilinks without aliases
 *
 * When a wikilink has no alias (e.g., [[asset-uuid]]), this utility resolves
 * the target asset's exo__Asset_label for display, making content more readable.
 *
 * @example
 * // Wikilink: [[abc123-def456]]
 * // Target asset has exo__Asset_label: "Project Alpha"
 * // Result: "Project Alpha"
 */
import { TFile } from "obsidian";
import { ObsidianApp } from "@plugin/types";

export interface WikilinkParsed {
  target: string;
  alias?: string;
}

export interface WikilinkResolved {
  target: string;
  displayText: string;
  hasAlias: boolean;
}

export class WikilinkLabelResolver {
  constructor(private app: ObsidianApp) {}

  /**
   * Parse a wikilink string into its components.
   *
   * @param value - Value that might be a wikilink
   * @returns Parsed target and alias, or null if not a wikilink
   */
  static parseWikilink(value: string): WikilinkParsed | null {
    // Match [[target]] or [[target|alias]]
    const match = value.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (match) {
      return {
        target: match[1].trim(),
        alias: match[2]?.trim(),
      };
    }
    return null;
  }

  /**
   * Check if a string is a wikilink.
   *
   * @param value - Value to check
   * @returns true if the value is a wikilink
   */
  static isWikilink(value: string): boolean {
    return /^\[\[.*?\]\]$/.test(value.trim());
  }

  /**
   * Get the exo__Asset_label for a given path.
   *
   * @param path - Path to the asset file
   * @returns The asset label, or null if not found
   */
  getAssetLabel(path: string): string | null {
    let file = this.app.metadataCache.getFirstLinkpathDest(path, "");

    // Try with .md extension if not found
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

    // Try to get label from prototype
    const prototypeRef = metadata.exo__Asset_prototype;
    if (prototypeRef) {
      const prototypePath =
        typeof prototypeRef === "string"
          ? prototypeRef.replace(/^\[\[|\]\]$/g, "").trim()
          : null;

      if (prototypePath) {
        const prototypeFile = this.app.metadataCache.getFirstLinkpathDest(
          prototypePath,
          "",
        );
        if (prototypeFile instanceof TFile) {
          const prototypeCache =
            this.app.metadataCache.getFileCache(prototypeFile);
          const prototypeMetadata = prototypeCache?.frontmatter || {};
          const prototypeLabel = prototypeMetadata.exo__Asset_label;

          if (
            prototypeLabel &&
            typeof prototypeLabel === "string" &&
            prototypeLabel.trim() !== ""
          ) {
            return prototypeLabel;
          }
        }
      }
    }

    return null;
  }

  /**
   * Resolve the display text for a wikilink.
   *
   * If the wikilink has an alias, returns the alias.
   * Otherwise, attempts to resolve the target asset's exo__Asset_label.
   * Falls back to the original target if no label is found.
   *
   * @param wikilinkValue - The wikilink string (e.g., "[[target]]" or "[[target|alias]]")
   * @returns Resolved wikilink with display text
   */
  resolveWikilinkLabel(wikilinkValue: string): WikilinkResolved | null {
    const parsed = WikilinkLabelResolver.parseWikilink(wikilinkValue);
    if (!parsed) {
      return null;
    }

    // If wikilink has an alias, use it directly
    if (parsed.alias) {
      return {
        target: parsed.target,
        displayText: parsed.alias,
        hasAlias: true,
      };
    }

    // Try to resolve the asset label
    const label = this.getAssetLabel(parsed.target);
    return {
      target: parsed.target,
      displayText: label || parsed.target,
      hasAlias: false,
    };
  }

  /**
   * Process text content and replace all wikilinks without aliases
   * with resolved asset labels.
   *
   * @param content - Text content containing wikilinks
   * @returns Processed content with resolved labels
   */
  processContent(content: string): string {
    // Match all wikilinks
    const wikilinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

    return content.replace(wikilinkPattern, (match, target, alias) => {
      // If wikilink has an alias, keep the original
      if (alias) {
        return match;
      }

      // Try to resolve the asset label
      const label = this.getAssetLabel(target.trim());
      if (label) {
        // Replace the wikilink display text with the label
        return `[[${target}|${label}]]`;
      }

      // Return original if no label found
      return match;
    });
  }
}

/**
 * Utility function to resolve a wikilink label without instantiating the class.
 *
 * @param app - Obsidian app instance
 * @param wikilinkValue - The wikilink string
 * @returns Resolved wikilink or null if not a valid wikilink
 */
export function resolveWikilinkLabel(
  app: ObsidianApp,
  wikilinkValue: string,
): WikilinkResolved | null {
  const resolver = new WikilinkLabelResolver(app);
  return resolver.resolveWikilinkLabel(wikilinkValue);
}

/**
 * Utility function to get display text for a wikilink.
 * Returns the alias if present, otherwise resolves the asset label.
 *
 * @param app - Obsidian app instance
 * @param wikilinkValue - The wikilink string
 * @param fallback - Fallback value if resolution fails (defaults to wikilink target)
 * @returns Display text for the wikilink
 */
export function getWikilinkDisplayText(
  app: ObsidianApp,
  wikilinkValue: string,
  fallback?: string,
): string {
  const resolver = new WikilinkLabelResolver(app);
  const resolved = resolver.resolveWikilinkLabel(wikilinkValue);

  if (resolved) {
    return resolved.displayText;
  }

  // Parse to get target as fallback
  const parsed = WikilinkLabelResolver.parseWikilink(wikilinkValue);
  return fallback || parsed?.target || wikilinkValue;
}

/**
 * Check if a string contains any wikilinks (embedded or standalone).
 *
 * @param value - Value to check
 * @returns true if the value contains any wikilinks
 */
export function containsWikilinks(value: string): boolean {
  return /\[\[[^\]]+\]\]/.test(value);
}

/**
 * Interface for parsed embedded wikilink segments.
 */
export interface WikilinkSegment {
  type: "text" | "wikilink";
  content: string;
  target?: string;
  displayText?: string;
}

/**
 * Parse text containing embedded wikilinks into segments.
 * Each segment is either plain text or a wikilink.
 *
 * @param content - Text content that may contain wikilinks
 * @param getAssetLabel - Optional function to resolve asset labels
 * @returns Array of segments representing the parsed content
 */
export function parseEmbeddedWikilinks(
  content: string,
  getAssetLabel?: (path: string) => string | null,
): WikilinkSegment[] {
  const segments: WikilinkSegment[] = [];
  const wikilinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  let lastIndex = 0;
  let match;

  while ((match = wikilinkPattern.exec(content)) !== null) {
    // Add text before the wikilink
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: content.substring(lastIndex, match.index),
      });
    }

    const target = match[1].trim();
    const alias = match[2]?.trim();

    let displayText: string;
    if (alias) {
      displayText = alias;
    } else if (getAssetLabel) {
      const resolvedLabel = getAssetLabel(target);
      displayText = resolvedLabel || target;
    } else {
      displayText = target;
    }

    segments.push({
      type: "wikilink",
      content: match[0],
      target,
      displayText,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after the last wikilink
  if (lastIndex < content.length) {
    segments.push({
      type: "text",
      content: content.substring(lastIndex),
    });
  }

  return segments;
}
