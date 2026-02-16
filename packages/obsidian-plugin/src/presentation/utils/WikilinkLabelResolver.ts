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
  blockId?: string;
  headingRef?: string;
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
   * Supports:
   * - Simple wikilinks: [[target]]
   * - Wikilinks with aliases: [[target|alias]]
   * - Block references: [[target#^blockId]]
   * - Block references with aliases: [[target#^blockId|alias]]
   * - Heading references: [[target#Heading]]
   * - Heading references with aliases: [[target#Heading|alias]]
   *
   * @param value - Value that might be a wikilink
   * @returns Parsed target, blockId, headingRef and alias, or null if not a wikilink
   */
  static parseWikilink(value: string): WikilinkParsed | null {
    // Match [[target]] or [[target#^blockId]] or [[target#Heading]] or [[target|alias]] or [[target#^blockId|alias]] or [[target#Heading|alias]]
    // Pattern breakdown:
    // - ([^#\]|]+) - target (no #, ], or |)
    // - (?:#\^([a-zA-Z0-9]+))? - optional block reference (# followed by ^ and alphanumeric id)
    // - (?:#([^\]|^]+))? - optional heading reference (# followed by text, no ], |, or ^)
    // - (?:\|([^\]]+))? - optional alias (| followed by text)
    const match = value.match(
      /^\[\[([^#\]|]+)(?:#\^([a-zA-Z0-9]+))?(?:#([^\]|^]+))?(?:\|([^\]]+))?\]\]$/,
    );
    if (match) {
      const target = match[1].trim();
      const blockId = match[2]?.trim();
      const headingRef = match[3]?.trim();
      const alias = match[4]?.trim();

      return {
        target,
        blockId,
        headingRef,
        alias,
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
   * For block references, appends " > ^blockId" to the label.
   * For heading references, appends " > Heading" to the label.
   * Falls back to the original target if no label is found.
   *
   * @param wikilinkValue - The wikilink string (e.g., "[[target]]" or "[[target|alias]]" or "[[target#^blockId]]")
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
    const baseLabel = label || parsed.target;

    // Build display text with block or heading reference suffix
    let displayText = baseLabel;
    if (parsed.blockId) {
      displayText = `${baseLabel} > ^${parsed.blockId}`;
    } else if (parsed.headingRef) {
      displayText = `${baseLabel} > ${parsed.headingRef}`;
    }

    return {
      target: parsed.target,
      displayText,
      hasAlias: false,
    };
  }

  /**
   * Process text content and replace all wikilinks without aliases
   * with resolved asset labels. Supports block and heading references.
   *
   * @param content - Text content containing wikilinks
   * @returns Processed content with resolved labels
   */
  processContent(content: string): string {
    // Match all wikilinks including block/heading references
    // Pattern: [[target]] or [[target#^blockId]] or [[target#Heading]] or [[target|alias]] etc.
    const wikilinkPattern = /\[\[([^#\]|]+)(?:#\^([a-zA-Z0-9]+))?(?:#([^\]|^]+))?(?:\|([^\]]+))?\]\]/g;

    return content.replace(
      wikilinkPattern,
      (match, target, blockId, headingRef, alias) => {
        // If wikilink has an alias, keep the original
        if (alias) {
          return match;
        }

        const trimmedTarget = target.trim();
        const trimmedBlockId = blockId?.trim();
        const trimmedHeadingRef = headingRef?.trim();

        // Try to resolve the asset label
        const label = this.getAssetLabel(trimmedTarget);

        // Build the link path portion (target + optional block/heading ref)
        let linkPath = trimmedTarget;
        if (trimmedBlockId) {
          linkPath = `${trimmedTarget}#^${trimmedBlockId}`;
        } else if (trimmedHeadingRef) {
          linkPath = `${trimmedTarget}#${trimmedHeadingRef}`;
        }

        // Build display text
        if (label) {
          let displayText = label;
          if (trimmedBlockId) {
            displayText = `${label} > ^${trimmedBlockId}`;
          } else if (trimmedHeadingRef) {
            displayText = `${label} > ${trimmedHeadingRef}`;
          }
          return `[[${linkPath}|${displayText}]]`;
        }

        // Return original if no label found
        return match;
      },
    );
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
  blockId?: string;
  headingRef?: string;
  displayText?: string;
}

/**
 * Parse text containing embedded wikilinks into segments.
 * Each segment is either plain text or a wikilink.
 * Supports block references ([[target#^blockId]]) and heading references ([[target#Heading]]).
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
  // Match wikilinks including block/heading references
  const wikilinkPattern =
    /\[\[([^#\]|]+)(?:#\^([a-zA-Z0-9]+))?(?:#([^\]|^]+))?(?:\|([^\]]+))?\]\]/g;

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
    const blockId = match[2]?.trim();
    const headingRef = match[3]?.trim();
    const alias = match[4]?.trim();

    let displayText: string;
    if (alias) {
      // Alias takes priority - don't call getAssetLabel
      displayText = alias;
    } else {
      // Resolve label if function provided
      let baseLabel: string;
      if (getAssetLabel) {
        const resolvedLabel = getAssetLabel(target);
        baseLabel = resolvedLabel || target;
      } else {
        baseLabel = target;
      }

      // Append block or heading reference to display text
      if (blockId) {
        displayText = `${baseLabel} > ^${blockId}`;
      } else if (headingRef) {
        displayText = `${baseLabel} > ${headingRef}`;
      } else {
        displayText = baseLabel;
      }
    }

    const segment: WikilinkSegment = {
      type: "wikilink",
      content: match[0],
      target,
      displayText,
    };

    // Add blockId/headingRef to segment if present
    if (blockId) {
      segment.blockId = blockId;
    }
    if (headingRef) {
      segment.headingRef = headingRef;
    }

    segments.push(segment);

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
