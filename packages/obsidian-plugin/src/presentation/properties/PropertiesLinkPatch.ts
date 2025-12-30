import { TFile, Plugin, CachedMetadata } from "obsidian";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import type { ExocortexSettings, DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

/**
 * PropertiesLinkPatch - Patches Obsidian's Properties block to show display names for links
 *
 * This patch intercepts the Properties block's rendering to display meaningful labels
 * for links that point to notes with exo__Asset_label set in their frontmatter.
 * Uses per-class templates (e.g., "{{exo__Asset_label}} (TaskPrototype)").
 *
 * Implementation approach:
 * - Uses MutationObserver to detect Properties block DOM changes
 * - Finds internal links within .metadata-container
 * - Replaces link text with resolved display name while preserving link behavior
 * - Listens for metadata changes to update labels dynamically
 * - Stores original text as data attributes for restoration
 */

interface PluginWithSettings extends Plugin {
  settings: ExocortexSettings;
}

export class PropertiesLinkPatch {
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
   * Enable the Properties link patch
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // Initial patch of existing Properties blocks
    this.patchAllPropertiesBlocks();

    // Set up observer for dynamic content
    this.setupObserver();

    // Listen for metadata changes to update labels
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", this.metadataChangeHandler)
    );

    // Re-patch when workspace layout changes
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        setTimeout(() => this.patchAllPropertiesBlocks(), 100);
      })
    );

    // Re-patch when active leaf changes
    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        setTimeout(() => this.patchAllPropertiesBlocks(), 100);
      })
    );
  }

  /**
   * Disable the Properties link patch and restore original text
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
   * Patch all Properties blocks in visible views
   */
  private patchAllPropertiesBlocks(): void {
    if (!this.enabled) return;

    // Get all markdown views
    if (typeof this.app.workspace.getLeavesOfType === "function") {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      if (Array.isArray(leaves)) {
        for (const leaf of leaves) {
          const container = leaf.view.containerEl;
          this.patchPropertiesBlock(container);
        }
      }
    }
  }

  /**
   * Patch links within a Properties block container
   */
  private patchPropertiesBlock(container: HTMLElement): void {
    // Find the metadata container (Properties block)
    const metadataContainer = container.querySelector<HTMLElement>(".metadata-container");
    if (!metadataContainer) return;

    // Find all internal links within the Properties block
    // Obsidian uses various selectors for links in properties:
    // - .internal-link (standard internal links)
    // - .multi-select-pill-content (for multi-value properties)
    // - a[data-href] (any link with href data)
    const linkSelectors = [
      ".internal-link",
      ".multi-select-pill-content .internal-link",
      'a[data-href]:not(.internal-link)',
    ];

    const links = metadataContainer.querySelectorAll<HTMLElement>(
      linkSelectors.join(", ")
    );

    for (const link of Array.from(links)) {
      this.patchLink(link);
    }
  }

  /**
   * Patch a single link element
   *
   * IMPORTANT: In multi-value properties, Obsidian places child elements like
   * remove buttons (×) inside the link element. We must preserve these by updating
   * only the text nodes, not replacing the entire innerHTML via textContent.
   */
  private patchLink(linkEl: HTMLElement): void {
    // Get the file path from data-href attribute
    const dataHref = linkEl.getAttribute("data-href");
    if (!dataHref) return;

    // Try to find the linked file
    const file = this.resolveFile(dataHref);
    if (!file) return;

    // Get the display name for this file
    const displayName = this.getDisplayName(file);
    if (!displayName) return;

    // Store original text for restoration (before any modifications)
    const originalText = this.getTextContent(linkEl);
    if (!linkEl.hasAttribute("data-original-text")) {
      linkEl.setAttribute("data-original-text", originalText);
    }

    // Only update if different from current text
    if (this.getTextContent(linkEl) !== displayName) {
      // Update text content while preserving child elements (like delete buttons)
      this.setTextContentPreservingChildren(linkEl, displayName);
      this.patchedElements.set(linkEl, originalText);

      // Add tooltip with original filename
      linkEl.setAttribute("aria-label", `${displayName}\n(${file.basename}.md)`);
    }
  }

  /**
   * Get text content from an element, excluding text from child elements
   * This returns only the direct text nodes' content
   */
  private getTextContent(el: HTMLElement): string {
    let text = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || "";
      }
    }
    return text.trim() || el.textContent || "";
  }

  /**
   * Set text content of an element while preserving child elements
   *
   * This method:
   * 1. Collects all non-text child elements
   * 2. Clears the element
   * 3. Adds the new text as a text node
   * 4. Re-appends the preserved child elements
   *
   * This preserves buttons, icons, and other interactive elements
   * that Obsidian places inside link elements (e.g., remove buttons in multi-value properties)
   */
  private setTextContentPreservingChildren(el: HTMLElement, text: string): void {
    // Collect all non-text child elements to preserve
    const childElements: Element[] = [];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        childElements.push(node as Element);
      }
    }

    // Clear the element and set new text
    el.textContent = text;

    // Re-append preserved child elements
    for (const child of childElements) {
      el.appendChild(child);
    }
  }

  /**
   * Check if an element is inside a metadata container
   * This prevents patching links in other contexts (e.g., daily navigation)
   */
  private isInsideMetadataContainer(el: HTMLElement): boolean {
    return el.closest(".metadata-container") !== null;
  }

  /**
   * Resolve a file path to a TFile
   */
  private resolveFile(linkPath: string): TFile | null {
    // Clean up the path
    const cleanPath = linkPath
      .replace(/^\[\[|\]\]$/g, "") // Remove wikilink brackets
      .replace(/^"|"$/g, "") // Remove quotes
      .trim();

    if (!cleanPath) return null;

    // Try to find the file
    let file = this.app.metadataCache.getFirstLinkpathDest(cleanPath, "");

    // Try with .md extension if not found
    if (!file && !cleanPath.endsWith(".md")) {
      file = this.app.metadataCache.getFirstLinkpathDest(cleanPath + ".md", "");
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
   * Set up MutationObserver to detect Properties block DOM changes
   */
  private setupObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;

      for (const mutation of mutations) {
        // Check for added nodes that might be metadata containers or links
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement) {
            // Check if this is a metadata container
            if (node.classList?.contains("metadata-container")) {
              this.patchPropertiesBlock(node.parentElement || node);
            } else if (node.querySelector?.(".metadata-container")) {
              // Check for nested metadata containers
              this.patchPropertiesBlock(node);
            } else if (
              (node.classList?.contains("internal-link") ||
                node.hasAttribute?.("data-href")) &&
              this.isInsideMetadataContainer(node)
            ) {
              // Direct link added within metadata container
              this.patchLink(node);
            } else {
              // Check for links within added nodes
              const links = node.querySelectorAll<HTMLElement>(
                ".metadata-container .internal-link, .metadata-container a[data-href]"
              );
              for (const link of Array.from(links)) {
                this.patchLink(link);
              }
            }
          }
        }
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

    // Re-patch all Properties blocks to pick up changes
    // This is simpler and more reliable than trying to find specific elements
    this.patchAllPropertiesBlocks();
  }

  /**
   * Restore all patched elements to their original text
   */
  private restoreAllLabels(): void {
    // Find all elements with original text stored
    const patchedLinks = document.querySelectorAll<HTMLElement>(
      ".metadata-container [data-original-text]"
    );

    for (const link of Array.from(patchedLinks)) {
      const originalText = link.getAttribute("data-original-text");
      if (originalText) {
        // Restore text while preserving child elements (like delete buttons)
        this.setTextContentPreservingChildren(link, originalText);
        link.removeAttribute("data-original-text");
        link.removeAttribute("aria-label");
      }
    }

    this.patchedElements = new WeakMap();
  }
}
