import { TFile, WorkspaceLeaf, Plugin, CachedMetadata, MarkdownView } from "obsidian";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import type { ExocortexSettings, DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

/**
 * TabTitlePatch - Patches Obsidian's tab titles to show exo__Asset_label instead of filenames
 *
 * This patch intercepts WorkspaceLeaf.getDisplayText() to display meaningful labels
 * for notes that have exo__Asset_label set in their frontmatter. Falls back to
 * the original filename if no label is set.
 *
 * Implementation approach:
 * - Patches all WorkspaceLeaf instances by monkey-patching getDisplayText()
 * - Listens for leaf-change events to patch new tabs
 * - Listens for metadata changes to update titles dynamically
 * - Stores original method for restoration on disable
 */
// Plugin interface to access settings
interface PluginWithSettings extends Plugin {
  settings: ExocortexSettings;
}

export class TabTitlePatch {
  private app: Plugin["app"];
  private plugin: PluginWithSettings;
  private enabled = false;
  private patchedLeaves: WeakMap<WorkspaceLeaf, () => string> = new WeakMap();
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
    // Prefer new displayNameSettings, fall back to legacy displayNameTemplate
    if (this.plugin.settings?.displayNameSettings) {
      return this.plugin.settings.displayNameSettings;
    }

    // Legacy fallback: convert single template to DisplayNameSettings
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
   * Enable the tab title patch
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // Patch all existing leaves
    this.patchAllLeaves();

    // Listen for new leaves
    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.patchAllLeaves();
      })
    );

    // Listen for layout changes (new tabs, splits, etc.)
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.patchAllLeaves();
      })
    );

    // Listen for metadata changes to update labels
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", this.metadataChangeHandler)
    );
  }

  /**
   * Disable the tab title patch and restore original titles
   */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    // Restore all patched leaves
    this.restoreAllLeaves();
  }

  /**
   * Cleanup resources when plugin unloads
   */
  cleanup(): void {
    this.disable();
  }

  /**
   * Patch all workspace leaves to use asset labels
   */
  private patchAllLeaves(): void {
    if (!this.enabled) return;

    // getLeavesOfType might not exist or might return non-iterable in test environment
    if (typeof this.app.workspace.getLeavesOfType === "function") {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      if (Array.isArray(leaves)) {
        for (const leaf of leaves) {
          this.patchLeaf(leaf);
        }
      }
    }

    // Also check for any other leaves that might have markdown views
    // iterateAllLeaves might not exist in test environment
    if (typeof this.app.workspace.iterateAllLeaves === "function") {
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view instanceof MarkdownView) {
          this.patchLeaf(leaf);
        }
      });
    }
  }

  /**
   * Patch a single WorkspaceLeaf to use asset labels
   */
  private patchLeaf(leaf: WorkspaceLeaf): void {
    // Skip if already patched
    if (this.patchedLeaves.has(leaf)) return;

    const view = leaf.view;
    if (!view) return;

    // Store original getDisplayText method
    const originalGetDisplayText = leaf.getDisplayText.bind(leaf);
    this.patchedLeaves.set(leaf, originalGetDisplayText);

    // Monkey-patch getDisplayText using arrow function to preserve `this` context
    leaf.getDisplayText = (): string => {
      if (!this.enabled) {
        return originalGetDisplayText();
      }

      const file = (view as MarkdownView).file;
      if (!file || !(file instanceof TFile) || file.extension !== "md") {
        return originalGetDisplayText();
      }

      const label = this.getAssetLabel(file);
      if (label) {
        return label;
      }

      return originalGetDisplayText();
    };

    // Trigger tab header update
    this.updateLeafTabHeader(leaf);
  }

  /**
   * Get the display name from a file's frontmatter using per-class template resolution
   */
  private getAssetLabel(file: TFile): string | null {
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
   * Update the tab header for a leaf to reflect the current display text
   */
  private updateLeafTabHeader(leaf: WorkspaceLeaf): void {
    // Trigger tab header update by calling updateHeader if available
    // This is an internal Obsidian method that refreshes the tab title
    // Using type assertion through unknown to access internal Obsidian property
    const tabHeaderEl = (leaf as unknown as { tabHeaderEl?: HTMLElement }).tabHeaderEl;
    if (tabHeaderEl) {
      const innerTitleEl = tabHeaderEl.querySelector(".workspace-tab-header-inner-title");
      if (innerTitleEl) {
        innerTitleEl.textContent = leaf.getDisplayText();
      }
    }
  }

  /**
   * Handle metadata changes to update tab titles
   */
  private handleMetadataChange(file: TFile): void {
    if (!this.enabled) return;
    if (file.extension !== "md") return;

    // Find and update all leaves showing this file
    // iterateAllLeaves might not exist in test environment
    if (typeof this.app.workspace.iterateAllLeaves === "function") {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file?.path === file.path) {
          this.updateLeafTabHeader(leaf);
        }
      });
    }
  }

  /**
   * Restore all patched leaves to their original getDisplayText method
   */
  private restoreAllLeaves(): void {
    // iterateAllLeaves might not exist in test environment
    if (typeof this.app.workspace.iterateAllLeaves === "function") {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const originalMethod = this.patchedLeaves.get(leaf);
        if (originalMethod) {
          leaf.getDisplayText = originalMethod;
          this.updateLeafTabHeader(leaf);
        }
      });
    }

    this.patchedLeaves = new WeakMap();
  }
}
