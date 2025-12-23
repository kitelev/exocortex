import { TFile, WorkspaceLeaf, Plugin, CachedMetadata } from "obsidian";
import { DisplayNameTemplateEngine, DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import type { ExocortexSettings } from "@plugin/domain/settings/ExocortexSettings";

/**
 * FileExplorerPatch - Patches Obsidian's File Explorer to show exo__Asset_label instead of filenames
 *
 * This patch intercepts the File Explorer's rendering to display meaningful labels
 * for notes that have exo__Asset_label set in their frontmatter. Falls back to
 * the original filename if no label is set.
 *
 * Implementation approach:
 * - Uses MutationObserver to detect File Explorer DOM changes
 * - Patches file items by modifying their inner text content
 * - Listens for metadata changes to update labels dynamically
 * - Stores original filenames as data attributes for tooltips
 */
// Plugin interface to access settings
interface PluginWithSettings extends Plugin {
  settings: ExocortexSettings;
}

export class FileExplorerPatch {
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
   * Get the display name template from settings
   */
  private getTemplate(): string {
    return this.plugin.settings?.displayNameTemplate || DEFAULT_DISPLAY_NAME_TEMPLATE;
  }

  /**
   * Enable the File Explorer label patch
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // Initial patch of existing File Explorer
    this.patchFileExplorer();

    // Set up observer for dynamic content
    this.setupObserver();

    // Listen for metadata changes to update labels
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", this.metadataChangeHandler)
    );

    // Re-patch when workspace layout changes (e.g., File Explorer reopened)
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        // Use setTimeout to ensure DOM is updated
        setTimeout(() => this.patchFileExplorer(), 100);
      })
    );
  }

  /**
   * Disable the File Explorer label patch and restore original filenames
   */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    // Disconnect observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Restore all patched elements
    this.restoreAllLabels();
  }

  /**
   * Cleanup resources when plugin unloads
   */
  cleanup(): void {
    this.disable();
  }

  /**
   * Find all File Explorer leaves in the workspace
   */
  private getFileExplorerLeaves(): WorkspaceLeaf[] {
    // getLeavesOfType might not exist in test environment
    if (typeof this.app.workspace.getLeavesOfType !== "function") {
      return [];
    }
    const leaves = this.app.workspace.getLeavesOfType("file-explorer");
    // Ensure we return an array even if the API returns undefined
    return Array.isArray(leaves) ? leaves : [];
  }

  /**
   * Patch all file items in the File Explorer
   */
  private patchFileExplorer(): void {
    if (!this.enabled) return;

    const leaves = this.getFileExplorerLeaves();
    for (const leaf of leaves) {
      const container = leaf.view.containerEl;
      this.patchFileItems(container);
    }
  }

  /**
   * Patch file items within a container element
   */
  private patchFileItems(container: HTMLElement): void {
    // File Explorer uses tree-item elements with file-tree-item class
    const fileItems = container.querySelectorAll<HTMLElement>(
      ".tree-item.nav-file"
    );

    for (const item of Array.from(fileItems)) {
      this.patchFileItem(item);
    }
  }

  /**
   * Patch a single file item element
   */
  private patchFileItem(item: HTMLElement): void {
    // Get the title element (inner text of the nav-file-title)
    const titleEl = item.querySelector<HTMLElement>(".nav-file-title-content");
    if (!titleEl) return;

    // Get the file path from the data attribute
    const titleWrapper = item.querySelector<HTMLElement>(".nav-file-title");
    if (!titleWrapper) return;

    const filePath = titleWrapper.getAttribute("data-path");
    if (!filePath) return;

    // Get the file
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.extension !== "md") return;

    // Get the asset label from frontmatter
    const label = this.getAssetLabel(file);
    if (!label) return;

    // Store original filename in data attribute for tooltip
    const originalName = file.basename;
    if (!titleEl.hasAttribute("data-original-name")) {
      titleEl.setAttribute("data-original-name", originalName);
    }

    // Only update if different from current
    if (titleEl.textContent !== label) {
      titleEl.textContent = label;
      this.patchedElements.set(titleEl, originalName);

      // Add tooltip with original filename
      titleWrapper.setAttribute("aria-label", `${label}\n(${originalName}.md)`);
    }
  }

  /**
   * Get the display name from a file's frontmatter using the template engine
   */
  private getAssetLabel(file: TFile): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    if (!frontmatter) return null;

    // Build metadata for template rendering
    const metadata = this.buildTemplateMetadata(frontmatter, file);

    // Get creation date if available
    const createdDate = file.stat?.ctime ? new Date(file.stat.ctime) : undefined;

    // Use template engine to render display name
    const template = this.getTemplate();
    const engine = new DisplayNameTemplateEngine(template);
    const displayName = engine.render(metadata, file.basename, createdDate);

    if (displayName) {
      return displayName;
    }

    // Fallback: try direct exo__Asset_label from frontmatter
    const label = frontmatter.exo__Asset_label;
    if (label && typeof label === "string" && label.trim() !== "") {
      return label.trim();
    }

    // Fallback: try prototype label if available
    const prototypeRef = frontmatter.exo__Asset_prototype;
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

        // Try with .md extension if not found
        if (!prototypeFile && !prototypePath.endsWith(".md")) {
          prototypeFile = this.app.metadataCache.getFirstLinkpathDest(
            prototypePath + ".md",
            ""
          );
        }

        if (prototypeFile instanceof TFile) {
          const prototypeCache = this.app.metadataCache.getFileCache(prototypeFile);
          const prototypeMetadata = prototypeCache?.frontmatter;

          if (prototypeMetadata) {
            const prototypeLabel = prototypeMetadata.exo__Asset_label;
            if (
              prototypeLabel &&
              typeof prototypeLabel === "string" &&
              prototypeLabel.trim() !== ""
            ) {
              return prototypeLabel.trim();
            }
          }
        }
      }
    }

    return null;
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
   * Set up MutationObserver to detect File Explorer DOM changes
   */
  private setupObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;

      for (const mutation of mutations) {
        // Check for added nodes
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement) {
            // Check if this is a file item or contains file items
            if (node.classList?.contains("nav-file")) {
              this.patchFileItem(node);
            } else {
              // Check for nested file items
              const fileItems = node.querySelectorAll<HTMLElement>(
                ".tree-item.nav-file"
              );
              for (const item of Array.from(fileItems)) {
                this.patchFileItem(item);
              }
            }
          }
        }
      }
    });

    // Observe all File Explorer containers
    const leaves = this.getFileExplorerLeaves();
    for (const leaf of leaves) {
      const container = leaf.view.containerEl;
      this.observer.observe(container, {
        childList: true,
        subtree: true,
      });
    }
  }

  /**
   * Handle metadata changes to update labels
   */
  private handleMetadataChange(file: TFile): void {
    if (!this.enabled) return;
    if (file.extension !== "md") return;

    // Find and update the file item for this file
    const leaves = this.getFileExplorerLeaves();
    for (const leaf of leaves) {
      const container = leaf.view.containerEl;
      const titleWrapper = container.querySelector<HTMLElement>(
        `.nav-file-title[data-path="${file.path}"]`
      );

      if (titleWrapper) {
        const item = titleWrapper.closest<HTMLElement>(".tree-item.nav-file");
        if (item) {
          // Get current label
          const newLabel = this.getAssetLabel(file);
          const titleEl = item.querySelector<HTMLElement>(".nav-file-title-content");

          if (titleEl) {
            if (newLabel) {
              // Update with new label
              const originalName = titleEl.getAttribute("data-original-name") || file.basename;
              titleEl.textContent = newLabel;
              titleWrapper.setAttribute("aria-label", `${newLabel}\n(${originalName}.md)`);
              this.patchedElements.set(titleEl, originalName);
            } else {
              // Restore original filename if label was removed
              const originalName = titleEl.getAttribute("data-original-name");
              if (originalName) {
                titleEl.textContent = originalName;
                titleWrapper.removeAttribute("aria-label");
                this.patchedElements.delete(titleEl);
              }
            }
          }
        }
      }
    }
  }

  /**
   * Restore all patched elements to their original filenames
   */
  private restoreAllLabels(): void {
    const leaves = this.getFileExplorerLeaves();
    for (const leaf of leaves) {
      const container = leaf.view.containerEl;
      const titleElements = container.querySelectorAll<HTMLElement>(
        ".nav-file-title-content[data-original-name]"
      );

      for (const titleEl of Array.from(titleElements)) {
        const originalName = titleEl.getAttribute("data-original-name");
        if (originalName) {
          titleEl.textContent = originalName;
          titleEl.removeAttribute("data-original-name");

          const titleWrapper = titleEl.closest<HTMLElement>(".nav-file-title");
          if (titleWrapper) {
            titleWrapper.removeAttribute("aria-label");
          }
        }
      }
    }

    this.patchedElements = new WeakMap();
  }
}
