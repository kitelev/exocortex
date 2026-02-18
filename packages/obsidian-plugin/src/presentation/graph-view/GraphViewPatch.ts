import { TFile, WorkspaceLeaf, Plugin, CachedMetadata } from "obsidian";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import type { ExocortexSettings, DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";
import { FunctionReplacer } from "@plugin/infrastructure/utils/FunctionReplacer";

/**
 * GraphViewPatch - Patches Obsidian's Graph View to show exo__Asset_label instead of filenames
 *
 * This patch intercepts the Graph View's node rendering to display meaningful labels
 * for notes that have exo__Asset_label set in their frontmatter. Falls back to
 * the original filename if no label is set.
 *
 * Implementation approach (FunctionReplacer pattern based on obsidian-front-matter-title):
 * - Uses FunctionReplacer for type-safe method wrapping with proper this context
 * - Implements bind/unbind lifecycle for event management
 * - Uses onIframeLoad() for reliable graph refresh
 * - Handles dynamically created nodes via layout-change events with background init
 *
 * Graph View Types:
 * - "graph" - Global graph view (View > Open graph view)
 * - "localgraph" - Local graph view (more options > Open local graph)
 *
 * Key improvements over previous implementation:
 * - FunctionReplacer preserves this context correctly
 * - Background init handles nodes created after initial patch window
 * - onIframeLoad() provides more reliable refresh than renderer.changed()
 * - Clean enable/disable lifecycle via replacer.enable()/disable()
 */

// Plugin interface to access settings
interface PluginWithSettings extends Plugin {
  settings: ExocortexSettings;
}

// Obsidian internal types for graph nodes (not exposed in public API)
interface GraphNodeText {
  text: string;
}

interface GraphNode {
  id: string;
  text?: GraphNodeText;
  getDisplayText: () => string;
}

interface GraphRenderer {
  nodes?: GraphNode[];
  changed?: () => void;
  onIframeLoad?: () => void;
}

interface GraphView {
  renderer?: GraphRenderer;
}

/**
 * Arguments passed to FunctionReplacer implementation
 */
interface GraphPatchArgs {
  patch: GraphViewPatch;
}

export class GraphViewPatch {
  private app: Plugin["app"];
  private plugin: PluginWithSettings;
  private enabled = false;
  private bound = false;
  private replacer: FunctionReplacer<GraphNode, "getDisplayText", GraphPatchArgs> | null = null;
  private metadataChangeHandler: (file: TFile, data: string, cache: CachedMetadata) => void;
  private layoutChangeHandler: () => void;
  private initTimeoutId: ReturnType<typeof setTimeout> | null = null;

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

    // Try to initialize replacement immediately
    if (!this.initReplacement()) {
      // If no nodes available yet, bind to layout-change events
      this.bind();
    }

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

    // Clear any pending background init
    if (this.initTimeoutId !== null) {
      clearTimeout(this.initTimeoutId);
      this.initTimeoutId = null;
    }

    // Unbind layout-change listener
    this.unbind();

    // Disable the replacement
    if (this.replacer) {
      this.replacer.disable();
      this.replacer = null;
    }

    // Refresh all graph views to restore original labels
    this.refreshAllGraphViews();
  }

  /**
   * Cleanup resources when plugin unloads
   */
  cleanup(): void {
    this.disable();
  }

  /**
   * Bind to layout-change events (used when waiting for graph nodes to appear)
   */
  private bind(): void {
    if (this.bound) return;
    this.bound = true;

    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", this.layoutChangeHandler)
    );
  }

  /**
   * Unbind from layout-change events
   */
  private unbind(): void {
    if (!this.bound) return;
    this.bound = false;
    // Note: Obsidian's registerEvent handles cleanup automatically when plugin unloads
  }

  /**
   * Handle layout changes to initialize replacement when graph views appear
   */
  private handleLayoutChange(): void {
    if (!this.enabled) return;

    // Try to initialize replacement
    if (this.initReplacement()) {
      // Successfully initialized, unbind layout-change listener
      this.unbind();
    }
  }

  /**
   * Handle metadata changes to refresh graph display
   */
  private handleMetadataChange(file: TFile): void {
    if (!this.enabled) return;
    if (file.extension !== "md") return;

    // Update specific file in graph views
    this.updateFileInGraphViews(file.path);
  }

  /**
   * Initialize the FunctionReplacer on the first available node prototype
   *
   * @returns true if replacement was initialized, false if no nodes available yet
   */
  private initReplacement(): boolean {
    // Find the first available graph node
    const node = this.getFirstNode();

    if (node) {
      // Get the prototype to patch
      const proto = Object.getPrototypeOf(node) as GraphNode;

      // Create the FunctionReplacer
      this.replacer = FunctionReplacer.create(
        proto,
        "getDisplayText",
        { patch: this },
        function (args, _defaultArgs, vanilla) {
          // `this` is the GraphNode instance
          const label = args.patch.getAssetLabel(this.id);
          return label ?? vanilla.call(this);
        }
      );

      // Enable the replacement
      this.replacer.enable();

      // Refresh all graph views to show new labels
      this.refreshAllGraphViews();

      return true;
    } else if (this.getViews().length > 0) {
      // Graph views exist but have no nodes yet - try again in background
      this.runBackgroundInit();
      return true; // Return true to indicate we're handling it
    }

    return false;
  }

  /**
   * Run background initialization to handle cases where graph views exist
   * but nodes haven't been created yet
   */
  private runBackgroundInit(): void {
    // Clear any previous timeout
    if (this.initTimeoutId !== null) {
      clearTimeout(this.initTimeoutId);
    }

    // Try again after a delay
    this.initTimeoutId = setTimeout(() => {
      this.initTimeoutId = null;
      if (this.enabled && !this.replacer) {
        this.initReplacement();
      }
    }, 200);
  }

  /**
   * Get the first available graph node from any open graph view
   */
  private getFirstNode(): GraphNode | null {
    for (const view of this.getViews()) {
      const nodes = view.renderer?.nodes ?? [];
      if (nodes.length > 0) {
        return nodes[0];
      }
    }
    return null;
  }

  /**
   * Get all open graph views
   */
  private getViews(): GraphView[] {
    const graphLeaves = this.getGraphLeaves("graph");
    const localGraphLeaves = this.getGraphLeaves("localgraph");

    const views: GraphView[] = [];

    for (const leaf of graphLeaves) {
      const view = leaf.view as unknown as GraphView;
      if (view) views.push(view);
    }

    for (const leaf of localGraphLeaves) {
      const view = leaf.view as unknown as GraphView;
      if (view) views.push(view);
    }

    return views;
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
   * Refresh all graph views by triggering onIframeLoad
   * This is more reliable than renderer.changed() for updating labels
   */
  private refreshAllGraphViews(): void {
    for (const view of this.getViews()) {
      const renderer = view.renderer;
      if (renderer) {
        // Update node.text.text for all nodes
        this.updateNodeTexts(renderer);

        // Trigger refresh using onIframeLoad (more reliable) or changed()
        if (typeof renderer.onIframeLoad === "function") {
          renderer.onIframeLoad();
        } else if (typeof renderer.changed === "function") {
          renderer.changed();
        }
      }
    }
  }

  /**
   * Update a specific file's node in all graph views
   */
  private updateFileInGraphViews(filePath: string): void {
    for (const view of this.getViews()) {
      const renderer = view.renderer;
      const nodes = renderer?.nodes ?? [];

      let needsRefresh = false;

      for (const node of nodes) {
        if (node.id === filePath) {
          this.updateNodeText(node);
          needsRefresh = true;
          break;
        }
      }

      if (needsRefresh) {
        if (typeof renderer?.onIframeLoad === "function") {
          renderer.onIframeLoad();
        } else if (typeof renderer?.changed === "function") {
          renderer.changed();
        }
      }
    }
  }

  /**
   * Update node.text.text for all nodes in a renderer
   */
  private updateNodeTexts(renderer: GraphRenderer): void {
    const nodes = renderer.nodes ?? [];
    for (const node of nodes) {
      this.updateNodeText(node);
    }
  }

  /**
   * Update a node's text.text property with its display text
   * This is necessary because Obsidian's Graph View caches the text
   * and doesn't call getDisplayText() on every render.
   */
  private updateNodeText(node: GraphNode): void {
    if (!node || !node.text) return;

    // Get the display text (will use patched method if replacement is active)
    const displayText = node.getDisplayText();
    if (displayText) {
      node.text.text = displayText;
    }
  }

  /**
   * Get the display name from a file's frontmatter using per-class template resolution
   * This is called by the FunctionReplacer implementation
   */
  getAssetLabel(filePath: string): string | null {
    if (!this.enabled) return null;

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
}
