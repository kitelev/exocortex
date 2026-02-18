import { TFile, Plugin, CachedMetadata } from "obsidian";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import type { ExocortexSettings, DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

/**
 * BodyLinkPatch - Patches markdown body content to show display names for asset links
 *
 * This patch intercepts the markdown body's rendering to display meaningful labels
 * for links that point to notes with exo__Asset_label set in their frontmatter.
 * Uses per-class templates (e.g., "{{exo__Asset_label}} (TaskPrototype)").
 *
 * Implementation approach:
 * - Uses MutationObserver to detect markdown body DOM changes
 * - Finds internal links within markdown-preview-view (reading mode)
 * - Replaces link text with resolved display name while preserving link behavior
 * - Listens for metadata changes to update labels dynamically
 * - Stores original text as data attributes for restoration
 * - Excludes links in .metadata-container (handled by PropertiesLinkPatch)
 * - Excludes links in exocortex layout tables (already have proper display names)
 */

interface PluginWithSettings extends Plugin {
  settings: ExocortexSettings;
}

export class BodyLinkPatch {
  private app: Plugin["app"];
  private plugin: PluginWithSettings;
  private observer: MutationObserver | null = null;
  private enabled = false;
  private patchedElements: WeakMap<HTMLElement, string> = new WeakMap();
  private metadataChangeHandler: (file: TFile, data: string, cache: CachedMetadata) => void;

  constructor(plugin: Plugin) {
    this.plugin = plugin as PluginWithSettings;
    this.app = plugin.app;
    this.metadataChangeHandler = this.handleMetadataChange.bind(this);
  }

  /**
   * Get the display name settings
   */
  private getDisplayNameSettings(): DisplayNameSettings {
    if (this.plugin.settings?.displayNameSettings) {
      return this.plugin.settings.displayNameSettings;
    }

    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Intentional backwards compatibility
    const template = this.plugin.settings?.displayNameTemplate || DEFAULT_DISPLAY_NAME_TEMPLATE;
    return {
      defaultTemplate: template,
      classTemplates: {},
      statusEmojis: {},
    };
  }

  /**
   * Create a DisplayNameResolver with current settings
   */
  private createResolver(): DisplayNameResolver {
    return new DisplayNameResolver(this.getDisplayNameSettings());
  }

  /**
   * Enable the body link patch
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // Initial patch of existing body content
    this.patchAllBodyLinks();

    // Set up observer for dynamic content
    this.setupObserver();

    // Listen for metadata changes to update labels
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", this.metadataChangeHandler)
    );

    // Re-patch when workspace layout changes
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        setTimeout(() => this.patchAllBodyLinks(), 100);
      })
    );

    // Re-patch when active leaf changes
    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        setTimeout(() => this.patchAllBodyLinks(), 100);
      })
    );
  }

  /**
   * Disable the body link patch and restore original text
   */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.restoreAllLabels();
  }

  /**
   * Cleanup resources when plugin unloads
   */
  cleanup(): void {
    this.disable();
  }

  /**
   * Patch all body links in visible views
   */
  private patchAllBodyLinks(): void {
    if (!this.enabled) return;

    // Get all markdown views
    if (typeof this.app.workspace.getLeavesOfType === "function") {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      if (Array.isArray(leaves)) {
        for (const leaf of leaves) {
          const container = leaf.view.containerEl;
          this.patchBodyContent(container);
        }
      }
    }
  }

  /**
   * Patch links within markdown body content (excluding Properties block)
   */
  private patchBodyContent(container: HTMLElement): void {
    // Find the markdown preview view (reading mode content)
    const previewView = container.querySelector<HTMLElement>(".markdown-preview-view");
    if (!previewView) return;

    // Find all internal links within the preview, but exclude:
    // 1. Links inside .metadata-container (handled by PropertiesLinkPatch)
    // 2. Links inside .exocortex-* containers (our layout tables already have proper names)
    const links = previewView.querySelectorAll<HTMLElement>(
      ".internal-link:not(.metadata-container .internal-link):not([class*='exocortex'] .internal-link)"
    );

    for (const link of Array.from(links)) {
      // Double-check: skip if inside metadata-container or exocortex components
      if (this.isInsideExcludedContainer(link)) continue;
      this.patchLink(link);
    }
  }

  /**
   * Check if an element is inside an excluded container
   * (metadata-container or exocortex layout components)
   */
  private isInsideExcludedContainer(el: HTMLElement): boolean {
    return (
      el.closest(".metadata-container") !== null ||
      el.closest("[class*='exocortex']") !== null
    );
  }

  /**
   * Check if an element is inside the markdown body (not metadata or our layouts)
   */
  private isInsideMarkdownBody(el: HTMLElement): boolean {
    const previewView = el.closest(".markdown-preview-view");
    if (!previewView) return false;
    return !this.isInsideExcludedContainer(el);
  }

  /**
   * Patch a single link element
   *
   * IMPORTANT: Preserves user-defined aliases (Issue #2097).
   * If the current textContent differs from the file basename AND the cleaned data-href,
   * the user provided an explicit alias and we should not overwrite it.
   * However, if we already patched this link (has data-body-patched),
   * we should re-patch to pick up metadata changes.
   *
   * Also supports block references (Issue #2133):
   * - [[file#^blockid]] displays as "Label > ^blockid"
   * - [[file#Heading]] displays as "Label > Heading"
   */
  private patchLink(linkEl: HTMLElement): void {
    // Get the file path from data-href attribute
    const dataHref = linkEl.getAttribute("data-href");
    if (!dataHref) return;

    // Parse the link to get file path and optional block/heading reference
    const { blockId, headingRef } = this.parseLinkRef(dataHref);

    // Try to find the linked file
    const file = this.resolveFile(dataHref);
    if (!file) return;

    // Clean the data-href to get what Obsidian would show for a bare wikilink
    const cleanedDataHref = dataHref
      .replace(/^\[\[|\]\]$/g, "") // Remove wikilink brackets
      .replace(/^"|"$/g, "") // Remove quotes
      .replace(/\.md$/, "") // Remove .md extension
      .trim();

    // Check for user-defined alias (Issue #2097)
    // If textContent differs from BOTH file basename AND cleaned data-href,
    // user provided explicit alias. BUT: if already patched, allow re-patching.
    const currentText = (linkEl.textContent || "").trim();
    const wasAlreadyPatched = linkEl.hasAttribute("data-body-patched");
    const matchesBasename = currentText === file.basename;
    const matchesDataHref = currentText === cleanedDataHref;
    // Also check if textContent matches basename + block/heading ref (for block reference links)
    // Obsidian may render in different formats (Issue #2139):
    // - "basename#^blockid" (standard format)
    // - "basename#blockid" (without caret)
    // - "basename > ^blockid" (separator format)
    // - "basename#Heading" (heading reference)
    const expectedBlockRefText = blockId
      ? `${file.basename}#^${blockId}`
      : headingRef
        ? `${file.basename}#${headingRef}`
        : file.basename;
    const matchesBlockRefText = currentText === expectedBlockRefText;

    // Issue #2139: Additional patterns Obsidian might render that should be patched
    // (not user aliases)
    const matchesBlockRefWithoutCaret = blockId
      ? currentText === `${file.basename}#${blockId}`
      : false;
    const matchesBlockRefSeparatorFormat = blockId
      ? currentText === `${file.basename} > ^${blockId}`
      : headingRef
        ? currentText === `${file.basename} > ${headingRef}`
        : false;

    const hasUserAlias =
      currentText !== "" &&
      !matchesBasename &&
      !matchesDataHref &&
      !matchesBlockRefText &&
      !matchesBlockRefWithoutCaret &&
      !matchesBlockRefSeparatorFormat &&
      !wasAlreadyPatched;

    if (hasUserAlias) {
      // User provided explicit alias - preserve it, don't overwrite
      return;
    }

    // Get the display name for this file
    let displayName = this.getDisplayName(file);
    if (!displayName) return;

    // Append block or heading reference to display name (Issue #2133)
    if (blockId) {
      displayName = `${displayName} > ^${blockId}`;
    } else if (headingRef) {
      displayName = `${displayName} > ${headingRef}`;
    }

    // Store original text for restoration (use data-original-text if already stored)
    const originalText = linkEl.getAttribute("data-original-text") || linkEl.textContent || "";
    if (!linkEl.hasAttribute("data-original-text")) {
      linkEl.setAttribute("data-original-text", originalText);
    }

    // Only update if different from current text
    if (linkEl.textContent !== displayName) {
      linkEl.textContent = displayName;
      this.patchedElements.set(linkEl, originalText);

      // Add tooltip with original filename (include block/heading ref if present)
      const tooltipPath = blockId
        ? `${file.basename}.md#^${blockId}`
        : headingRef
          ? `${file.basename}.md#${headingRef}`
          : `${file.basename}.md`;
      linkEl.setAttribute("aria-label", `${displayName}\n(${tooltipPath})`);

      // Add a data attribute to mark this as body-patched for easier identification
      linkEl.setAttribute("data-body-patched", "true");
    }
  }

  /**
   * Parse a link path to extract file path and optional block/heading reference.
   * Examples:
   * - "file" -> { filePath: "file", blockId: undefined, headingRef: undefined }
   * - "file#^blockid" -> { filePath: "file", blockId: "blockid", headingRef: undefined }
   * - "file#Heading" -> { filePath: "file", blockId: undefined, headingRef: "Heading" }
   */
  private parseLinkRef(linkPath: string): {
    filePath: string;
    blockId?: string;
    headingRef?: string;
  } {
    // Clean up the path first
    const cleanPath = linkPath
      .replace(/^\[\[|\]\]$/g, "") // Remove wikilink brackets
      .replace(/^"|"$/g, "") // Remove quotes
      .trim();

    // Check for block reference: file#^blockid
    const blockMatch = cleanPath.match(/^([^#]+)#\^([a-zA-Z0-9]+)$/);
    if (blockMatch) {
      return {
        filePath: blockMatch[1].trim(),
        blockId: blockMatch[2].trim(),
      };
    }

    // Check for heading reference: file#Heading (no ^ means heading)
    const headingMatch = cleanPath.match(/^([^#]+)#(.+)$/);
    if (headingMatch) {
      return {
        filePath: headingMatch[1].trim(),
        headingRef: headingMatch[2].trim(),
      };
    }

    return { filePath: cleanPath };
  }

  /**
   * Resolve a file path to a TFile
   */
  private resolveFile(linkPath: string): TFile | null {
    // Parse the link to get file path (stripping block/heading ref)
    const { filePath } = this.parseLinkRef(linkPath);

    if (!filePath) return null;

    // Try to find the file
    let file = this.app.metadataCache.getFirstLinkpathDest(filePath, "");

    // Try with .md extension if not found
    if (!file && !filePath.endsWith(".md")) {
      file = this.app.metadataCache.getFirstLinkpathDest(filePath + ".md", "");
    }

    if (file instanceof TFile && file.extension === "md") {
      return file;
    }

    return null;
  }

  /**
   * Get the display name for a file using per-class template resolution
   */
  private getDisplayName(file: TFile): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    if (!frontmatter) return null;

    // Build metadata for template rendering
    const metadata = this.buildTemplateMetadata(frontmatter, file);

    // Get creation date if available
    const createdDate = file.stat?.ctime ? new Date(file.stat.ctime) : undefined;

    // Use DisplayNameResolver for per-class template resolution
    const resolver = this.createResolver();
    const displayName = resolver.resolve({
      metadata,
      basename: file.basename,
      createdDate,
    });

    return displayName;
  }

  /**
   * Build metadata object for template rendering, merging frontmatter with prototype data
   */
  private buildTemplateMetadata(
    frontmatter: Record<string, unknown>,
    _file: TFile
  ): Record<string, unknown> {
    const metadata = { ...frontmatter };

    // If label is missing, try to get from prototype
    if (!metadata.exo__Asset_label) {
      const prototypeRef = metadata.exo__Asset_prototype;
      if (prototypeRef) {
        const prototypePath =
          typeof prototypeRef === "string"
            ? prototypeRef.replace(/^\[\[|\]\]$/g, "").replace(/^"|"$/g, "").trim()
            : null;

        if (prototypePath) {
          let prototypeFile = this.app.metadataCache.getFirstLinkpathDest(
            prototypePath,
            ""
          );

          if (!prototypeFile && !prototypePath.endsWith(".md")) {
            prototypeFile = this.app.metadataCache.getFirstLinkpathDest(
              prototypePath + ".md",
              ""
            );
          }

          if (prototypeFile instanceof TFile) {
            const prototypeCache = this.app.metadataCache.getFileCache(prototypeFile);
            const prototypeMetadata = prototypeCache?.frontmatter;

            if (prototypeMetadata?.exo__Asset_label) {
              metadata.exo__Asset_label = prototypeMetadata.exo__Asset_label;
            }
          }
        }
      }
    }

    return metadata;
  }

  /**
   * Set up MutationObserver to detect markdown body DOM changes
   *
   * Issue #2153: Uses queueMicrotask to defer link processing, ensuring the DOM
   * is fully attached before checking ancestors. This is critical for table cells
   * where Obsidian may render content asynchronously.
   */
  private setupObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;

      // Collect links to process - use Set to deduplicate
      const linksToProcess = new Set<HTMLElement>();

      for (const mutation of mutations) {
        // Check for added nodes that might contain links
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement) {
            // Skip if this is inside metadata-container or exocortex components
            if (this.isInsideExcludedContainer(node)) continue;

            // Check if this is a markdown preview view
            if (node.classList?.contains("markdown-preview-view")) {
              // For preview views, patch immediately (they're definitely attached)
              this.patchBodyContent(node.parentElement || node);
            } else if (node.querySelector?.(".markdown-preview-view")) {
              // Check for nested preview views
              this.patchBodyContent(node);
            } else if (node.classList?.contains("internal-link")) {
              // Direct link added - collect for deferred processing
              linksToProcess.add(node);
            } else {
              // Check for links within added nodes (including tables, lists, etc.)
              // Issue #2153: This handles wikilinks inside table cells
              const links = node.querySelectorAll<HTMLElement>(".internal-link");
              for (const link of Array.from(links)) {
                linksToProcess.add(link);
              }
            }
          }
        }
      }

      // Issue #2153: Defer link processing using queueMicrotask
      // This ensures the DOM is fully attached before we check ancestors like
      // .markdown-preview-view. Critical for table cells which may be added
      // to the DOM in multiple steps (table structure first, then cell content).
      if (linksToProcess.size > 0) {
        queueMicrotask(() => {
          if (!this.enabled) return;
          for (const link of linksToProcess) {
            // Re-check if link is in markdown body after DOM is fully attached
            if (this.isInsideMarkdownBody(link)) {
              this.patchLink(link);
            }
          }
        });
      }
    });

    // Observe the document body for changes
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Handle metadata changes to update labels
   */
  private handleMetadataChange(file: TFile): void {
    if (!this.enabled) return;
    if (file.extension !== "md") return;

    // Re-patch all body links to pick up changes
    // This is simpler and more reliable than trying to find specific elements
    this.patchAllBodyLinks();
  }

  /**
   * Restore all patched elements to their original text
   */
  private restoreAllLabels(): void {
    // Find all elements with original text stored (in markdown body, marked as body-patched)
    const patchedLinks = document.querySelectorAll<HTMLElement>(
      ".markdown-preview-view [data-body-patched='true']"
    );

    for (const link of Array.from(patchedLinks)) {
      const originalText = link.getAttribute("data-original-text");
      if (originalText) {
        link.textContent = originalText;
        link.removeAttribute("data-original-text");
        link.removeAttribute("aria-label");
        link.removeAttribute("data-body-patched");
      }
    }

    this.patchedElements = new WeakMap();
  }
}
