import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, Extension } from "@codemirror/state";
import { TFile } from "obsidian";
import type { App, MetadataCache } from "obsidian";
import type { ExocortexSettings } from "@plugin/domain/settings/ExocortexSettings";

/**
 * Represents a parsed wikilink with its position and extracted components.
 */
export interface WikilinkMatch {
  /** Start position of the wikilink in the document */
  from: number;
  /** End position of the wikilink in the document */
  to: number;
  /** The target path (filename/UUID) */
  targetPath: string;
  /** Whether the wikilink has an explicit alias */
  hasAlias: boolean;
  /** Optional block reference ID (e.g., "jgp9nz" from [[file#^jgp9nz]]) */
  blockId?: string;
  /** Optional heading reference (e.g., "Heading" from [[file#Heading]]) */
  headingRef?: string;
}

/**
 * Widget that displays the resolved label text for a wikilink.
 * Used with Decoration.replace() to substitute the visible text
 * while preserving the underlying wikilink syntax.
 */
class WikilinkLabelWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly targetPath: string,
  ) {
    super();
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-hmd-internal-link exocortex-wikilink-label";
    span.textContent = this.label;
    span.setAttribute("data-target-path", this.targetPath);
    span.setAttribute("aria-label", `Link: ${this.targetPath}`);
    return span;
  }

  override eq(other: WidgetType): boolean {
    if (!(other instanceof WikilinkLabelWidget)) {
      return false;
    }
    return (
      other.label === this.label &&
      other.targetPath === this.targetPath
    );
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * ViewPlugin that displays wikilinks by their exo__Asset_label in live preview mode.
 *
 * When a wikilink like [[uuid]] is encountered and the target asset has an
 * exo__Asset_label, this plugin replaces the visible display with the label
 * while preserving the underlying link syntax.
 *
 * Key features:
 * - Uses Decoration.replace() for text substitution
 * - Cursor-aware: shows original text when cursor is inside the wikilink
 * - Respects explicit aliases: [[target|alias]] is not modified
 * - Uses WikilinkLabelResolver for label resolution
 *
 * @example
 * // Wikilink: [[369c1b17-1296-4ec8-bdb9-c73fb74c0085]]
 * // Target asset has exo__Asset_label: "My Project"
 * // Display: "My Project" (instead of UUID)
 */
export class WikilinkLabelViewPlugin {
  decorations: DecorationSet;
  private metadataCache: MetadataCache;
  private settings: ExocortexSettings;

  constructor(
    view: EditorView,
    _app: App,  // App passed for API consistency with other extensions
    metadataCache: MetadataCache,
    settings: ExocortexSettings,
  ) {
    this.metadataCache = metadataCache;
    this.settings = settings;
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    // Rebuild decorations when document changes, viewport changes, or selection changes
    // Selection change is important for cursor-aware editing
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();

    // Check if feature is enabled
    if (!this.settings.showLabelsInLivePreview) {
      return builder.finish();
    }

    const wikilinks = this.findWikilinksWithoutAliases(view);

    // Get cursor position for cursor-awareness
    const cursorPos = view.state.selection.main.head;

    // Sort by position (required by RangeSetBuilder)
    wikilinks.sort((a, b) => a.from - b.from);

    for (const wikilink of wikilinks) {
      // Skip if cursor is inside this wikilink (allow editing)
      if (WikilinkLabelViewPlugin.isCursorInsideMatch(wikilink, cursorPos)) {
        continue;
      }

      // Resolve the label for this target
      const baseLabel = WikilinkLabelViewPlugin.resolveLabel(
        this.metadataCache,
        wikilink.targetPath,
      );

      // Build display text with block or heading reference suffix
      let label = baseLabel;
      if (label) {
        if (wikilink.blockId) {
          label = `${label} > ^${wikilink.blockId}`;
        } else if (wikilink.headingRef) {
          label = `${label} > ${wikilink.headingRef}`;
        }
      }

      // Only create decoration if we found a label different from the target
      if (label && label !== wikilink.targetPath) {
        const widget = new WikilinkLabelWidget(label, wikilink.targetPath);

        const decoration = Decoration.replace({
          widget,
          inclusive: false,
        });

        builder.add(wikilink.from, wikilink.to, decoration);
      }
    }

    return builder.finish();
  }

  /**
   * Find all wikilinks without aliases in the current view.
   * Wikilinks without aliases have the format: [[target]]
   * Wikilinks with aliases ([[target|alias]]) are excluded.
   */
  private findWikilinksWithoutAliases(view: EditorView): WikilinkMatch[] {
    const { from, to } = view.viewport;
    const text = view.state.doc.sliceString(from, to);
    return WikilinkLabelViewPlugin.parseWikilinksFromText(text, from);
  }

  /**
   * Parse wikilinks from text, extracting only those without aliases.
   * This is a static method for easier testing.
   *
   * Supports:
   * - Simple wikilinks: [[target]]
   * - Block references: [[target#^blockId]]
   * - Heading references: [[target#Heading]]
   * - Wikilinks with aliases are excluded: [[target|alias]]
   *
   * @param text - The text to parse
   * @param offset - Offset to add to positions (for viewport-based parsing)
   * @returns Array of WikilinkMatch objects for wikilinks without aliases
   */
  static parseWikilinksFromText(text: string, offset: number): WikilinkMatch[] {
    const matches: WikilinkMatch[] = [];

    // Pattern: [[target]] or [[target#^blockId]] or [[target#Heading]] or [[target|alias]]
    // Captures:
    // 1. target (no #, ], or |)
    // 2. optional block reference (^alphanumeric after #)
    // 3. optional heading reference (text after # without ^ and without ] or |)
    // 4. optional alias (after |)
    const wikilinkPattern = /\[\[([^#\]|]+)(?:#\^([a-zA-Z0-9]+))?(?:#([^\]|^]+))?(?:\|([^\]]+))?\]\]/g;

    let match;
    while ((match = wikilinkPattern.exec(text)) !== null) {
      const targetPath = match[1].trim();
      const blockId = match[2]?.trim();
      const headingRef = match[3]?.trim();
      const alias = match[4]?.trim();

      // Only include wikilinks WITHOUT aliases
      if (!alias) {
        matches.push({
          from: offset + match.index,
          to: offset + match.index + match[0].length,
          targetPath,
          hasAlias: false,
          blockId,
          headingRef,
        });
      }
    }

    return matches;
  }

  /**
   * Check if a wikilink match should have its label shown.
   * Returns true only for wikilinks without explicit aliases.
   *
   * @param match - The wikilink match to check
   * @returns true if the label should be displayed
   */
  static shouldShowLabel(match: WikilinkMatch): boolean {
    return !match.hasAlias;
  }

  /**
   * Check if the cursor position is inside a wikilink match range.
   * When the cursor is inside, we show the original text for editing.
   *
   * @param match - The wikilink match
   * @param cursorPos - Current cursor position
   * @returns true if cursor is inside the match range (inclusive)
   */
  static isCursorInsideMatch(match: WikilinkMatch, cursorPos: number): boolean {
    return cursorPos >= match.from && cursorPos <= match.to;
  }

  /**
   * Resolve the exo__Asset_label for a given target path.
   *
   * @param metadataCache - Obsidian metadata cache
   * @param targetPath - The path to resolve
   * @returns The resolved label, or null if not found
   */
  static resolveLabel(
    metadataCache: MetadataCache,
    targetPath: string,
  ): string | null {
    // Try to find the file
    let file = metadataCache.getFirstLinkpathDest(targetPath, "");

    // Try with .md extension if not found
    if (!file && !targetPath.endsWith(".md")) {
      file = metadataCache.getFirstLinkpathDest(targetPath + ".md", "");
    }

    if (!(file instanceof TFile)) {
      return null;
    }

    const cache = metadataCache.getFileCache(file);
    const metadata = cache?.frontmatter;

    if (!metadata) {
      return null;
    }

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
        let prototypeFile = metadataCache.getFirstLinkpathDest(
          prototypePath,
          "",
        );

        if (!prototypeFile && !prototypePath.endsWith(".md")) {
          prototypeFile = metadataCache.getFirstLinkpathDest(
            prototypePath + ".md",
            "",
          );
        }

        if (prototypeFile instanceof TFile) {
          const prototypeCache = metadataCache.getFileCache(prototypeFile);
          const prototypeMetadata = prototypeCache?.frontmatter;
          const prototypeLabel = prototypeMetadata?.exo__Asset_label;

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
}

/**
 * Creates the editor extension for wikilink label display in live preview.
 *
 * @param app - Obsidian App instance
 * @param metadataCache - Obsidian MetadataCache
 * @param settings - Exocortex settings
 * @returns CodeMirror Extension
 */
export function createWikilinkLabelExtension(
  app: App,
  metadataCache: MetadataCache,
  settings: ExocortexSettings,
): Extension {
  return ViewPlugin.define(
    (view) => new WikilinkLabelViewPlugin(view, app, metadataCache, settings),
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}
