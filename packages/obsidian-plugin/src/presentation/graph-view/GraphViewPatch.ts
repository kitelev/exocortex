import { TFile, WorkspaceLeaf, Plugin, CachedMetadata } from "obsidian";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import type { ExocortexSettings, DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

/**
 * GraphViewPatch - Patches Obsidian's Graph View to show exo__Asset_label instead of filenames
 *
 * This patch intercepts the Graph View's node rendering to display meaningful labels
 * for notes that have exo__Asset_label set in their frontmatter. Falls back to
 * the original filename if no label is set.
 *
 * Implementation approach:
 * - Patches graph node prototypes by monkey-patching getDisplayText()
 * - Listens for layout-change events to re-patch when graph views are opened
 * - Listens for metadata changes to refresh the graph
 * - Stores original methods for restoration on disable
 *
 * Graph View Types:
 * - "graph" - Global graph view (View > Open graph view)
 * - "localgraph" - Local graph view (more options > Open local graph)
 */

// Plugin interface to access settings
interface PluginWithSettings extends Plugin {
  settings: ExocortexSettings;
}

// Obsidian internal types for graph nodes (not exposed in public API)
interface GraphNode {
  id: string;
  getDisplayText: () => string;
  nm_originalGetDisplayText?: () => string;
}

interface GraphRenderer {
  nodes?: GraphNode[];
}

interface GraphView {
  renderer?: GraphRenderer;
}

export class GraphViewPatch {
  private app: Plugin["app"];
  private plugin: PluginWithSettings;
  private enabled = false;
  private patchedPrototypes: WeakSet<object> = new WeakSet();
  private metadataChangeHandler: (file: TFile, data: string, cache: CachedMetadata) => void;
  private layoutChangeHandler: () => void;

  constructor(plugin: Plugin) {
    this.plugin = plugin as PluginWithSettings;
    this.app = plugin.app;
    this.metadataChangeHandler = this.handleMetadataChange.bind(this);
    this.layoutChangeHandler = this.handleLayoutChange.bind(this);
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
   * Enable the Graph View label patch
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // Initial patch of existing graph views
    this.patchAllGraphViews();

    // Listen for layout changes (new graph views, reopened views, etc.)
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", this.layoutChangeHandler)
    );

    // Listen for metadata changes to refresh the graph
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", this.metadataChangeHandler)
    );
  }

  /**
   * Disable the Graph View label patch and restore original methods
   */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    // Restore all patched prototypes
    this.restoreAllGraphViews();
  }

  /**
   * Cleanup resources when plugin unloads
   */
  cleanup(): void {
    this.disable();
  }

  /**
   * Handle layout changes to patch new graph views
   */
  private handleLayoutChange(): void {
    if (!this.enabled) return;
    // Use setTimeout to ensure DOM is updated after layout change
    setTimeout(() => this.patchAllGraphViews(), 100);
  }

  /**
   * Handle metadata changes to refresh graph display
   */
  private handleMetadataChange(file: TFile): void {
    if (!this.enabled) return;
    if (file.extension !== "md") return;

    // Refresh all graph views when metadata changes
    // This ensures labels are updated when exo__Asset_label changes
    this.refreshAllGraphViews();
  }

  /**
   * Patch all graph views in the workspace
   */
  private patchAllGraphViews(): void {
    if (!this.enabled) return;

    // Patch global graph views
    const graphLeaves = this.getGraphLeaves("graph");
    for (const leaf of graphLeaves) {
      this.patchGraphView(leaf);
    }

    // Patch local graph views
    const localGraphLeaves = this.getGraphLeaves("localgraph");
    for (const leaf of localGraphLeaves) {
      this.patchGraphView(leaf);
    }
  }

  /**
   * Get leaves of a specific graph type
   */
  private getGraphLeaves(viewType: string): WorkspaceLeaf[] {
    if (typeof this.app.workspace.getLeavesOfType !== "function") {
      return [];
    }
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    return Array.isArray(leaves) ? leaves : [];
  }

  /**
   * Patch a single graph view
   */
  private patchGraphView(leaf: WorkspaceLeaf): void {
    const view = leaf.view as unknown as GraphView;
    const renderer = view?.renderer;
    const nodes = renderer?.nodes;

    if (!nodes || !Array.isArray(nodes)) return;

    for (const node of nodes) {
      this.patchNode(node);
    }
  }

  /**
   * Patch a single graph node to use asset labels
   */
  private patchNode(node: GraphNode): void {
    // Skip if not a valid node with getDisplayText
    if (!node || typeof node.getDisplayText !== "function") return;

    // Get the prototype to patch
    const proto = Object.getPrototypeOf(node);
    if (!proto) return;

    // Skip if already patched
    if (this.patchedPrototypes.has(proto)) return;

    // Store original method
    const originalGetDisplayText = proto.getDisplayText;
    proto.nm_originalGetDisplayText = originalGetDisplayText;

    // Create patched method
    proto.getDisplayText = this.createPatchedGetDisplayText(originalGetDisplayText);

    // Mark as patched
    this.patchedPrototypes.add(proto);
  }

  /**
   * Create a patched getDisplayText function
   *
   * Uses closure to capture patch instance state without aliasing `this`
   */
  private createPatchedGetDisplayText(
    originalMethod: () => string
  ): (this: GraphNode) => string {
    // Capture instance methods in closures to avoid `this` aliasing
    const isEnabled = (): boolean => this.enabled;
    const getLabel = (filePath: string): string | null => this.getAssetLabel(filePath);

    return function (this: GraphNode): string {
      // If patch is disabled, return original
      if (!isEnabled()) {
        return originalMethod.call(this);
      }

      // Get the file path from the node id
      const filePath = this.id;
      if (!filePath) {
        return originalMethod.call(this);
      }

      // Try to get the asset label
      const label = getLabel(filePath);
      if (label) {
        return label;
      }

      // Fall back to original method
      return originalMethod.call(this);
    };
  }

  /**
   * Get the display name from a file's frontmatter using per-class template resolution
   */
  private getAssetLabel(filePath: string): string | null {
    // Get the file from vault
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.extension !== "md") {
      return null;
    }

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
   * Refresh all graph views (trigger re-render)
   */
  private refreshAllGraphViews(): void {
    // Re-patch to ensure new nodes get labels
    this.patchAllGraphViews();
  }

  /**
   * Restore all patched graph views to original methods
   */
  private restoreAllGraphViews(): void {
    // Restore global graph views
    const graphLeaves = this.getGraphLeaves("graph");
    for (const leaf of graphLeaves) {
      this.restoreGraphView(leaf);
    }

    // Restore local graph views
    const localGraphLeaves = this.getGraphLeaves("localgraph");
    for (const leaf of localGraphLeaves) {
      this.restoreGraphView(leaf);
    }

    // Clear the patched prototypes set
    this.patchedPrototypes = new WeakSet();
  }

  /**
   * Restore a single graph view
   */
  private restoreGraphView(leaf: WorkspaceLeaf): void {
    const view = leaf.view as unknown as GraphView;
    const renderer = view?.renderer;
    const nodes = renderer?.nodes;

    if (!nodes || !Array.isArray(nodes)) return;

    for (const node of nodes) {
      this.restoreNode(node);
    }
  }

  /**
   * Restore a single node's original getDisplayText method
   */
  private restoreNode(node: GraphNode): void {
    if (!node) return;

    const proto = Object.getPrototypeOf(node);
    if (!proto || !proto.nm_originalGetDisplayText) return;

    // Restore original method
    proto.getDisplayText = proto.nm_originalGetDisplayText;
    delete proto.nm_originalGetDisplayText;
  }
}
