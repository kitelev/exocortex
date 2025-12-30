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

    // Store original text for restoration
    const originalText = linkEl.textContent || "";
    if (!linkEl.hasAttribute("data-original-text")) {
      linkEl.setAttribute("data-original-text", originalText);
    }

    // Only update if different from current text
    if (linkEl.textContent !== displayName) {
      linkEl.textContent = displayName;
      this.patchedElements.set(linkEl, originalText);

      // Add tooltip with original filename
      linkEl.setAttribute("aria-label", `${displayName}\n(${file.basename}.md)`);

      // Add a data attribute to mark this as body-patched for easier identification
      linkEl.setAttribute("data-body-patched", "true");
    }
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
   * Set up MutationObserver to detect markdown body DOM changes
   */
  private setupObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;

      for (const mutation of mutations) {
        // Check for added nodes that might contain links
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement) {
            // Skip if this is inside metadata-container or exocortex components
            if (this.isInsideExcludedContainer(node)) continue;

            // Check if this is a markdown preview view
            if (node.classList?.contains("markdown-preview-view")) {
              this.patchBodyContent(node.parentElement || node);
            } else if (node.querySelector?.(".markdown-preview-view")) {
              // Check for nested preview views
              this.patchBodyContent(node);
            } else if (
              node.classList?.contains("internal-link") &&
              this.isInsideMarkdownBody(node)
            ) {
              // Direct link added within markdown body
              this.patchLink(node);
            } else {
              // Check for links within added nodes (but exclude metadata and our components)
              const links = node.querySelectorAll<HTMLElement>(
                ".internal-link"
              );
              for (const link of Array.from(links)) {
                if (this.isInsideMarkdownBody(link)) {
                  this.patchLink(link);
                }
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
