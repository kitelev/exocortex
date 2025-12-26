# Obsidian Integration

This guide covers integrating the Graph View with Obsidian plugins, including file navigation, vault integration, and Obsidian-specific features.

## Plugin Setup

### Registering a Graph View

```typescript
import { Plugin, ItemView, WorkspaceLeaf } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { GraphLayoutRenderer } from "@exocortex/obsidian-plugin";

const GRAPH_VIEW_TYPE = "exocortex-graph-view";

class GraphView extends ItemView {
  private root: Root | null = null;
  private plugin: MyPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Knowledge Graph";
  }

  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();

    const reactContainer = container.createDiv({ cls: "graph-view-container" });
    this.root = createRoot(reactContainer);

    this.root.render(
      <GraphLayoutRenderer
        layout={this.plugin.getCurrentLayout()}
        nodes={await this.plugin.getGraphNodes()}
        edges={await this.plugin.getGraphEdges()}
        onNodeClick={this.handleNodeClick.bind(this)}
        options={{
          width: "100%",
          height: "100%",
          showLabels: true,
          zoomable: true,
        }}
      />
    );
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
  }

  private handleNodeClick(nodeId: string, path: string, event: React.MouseEvent): void {
    // Open file in Obsidian
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      // Ctrl/Cmd+click opens in new pane
      if (event.ctrlKey || event.metaKey) {
        this.app.workspace.getLeaf("split").openFile(file as TFile);
      } else {
        this.app.workspace.getLeaf().openFile(file as TFile);
      }
    }
  }
}

export default class MyPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));

    // Add ribbon icon
    this.addRibbonIcon("git-fork", "Open Graph View", () => {
      this.activateView();
    });

    // Add command
    this.addCommand({
      id: "open-graph-view",
      name: "Open Knowledge Graph",
      callback: () => this.activateView(),
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(GRAPH_VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: GRAPH_VIEW_TYPE,
          active: true,
        });
        leaf = rightLeaf;
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}
```

## File Navigation

### Opening Files from Graph

```typescript
import { TFile, WorkspaceLeaf } from "obsidian";

class GraphNavigator {
  constructor(private app: App) {}

  openFile(path: string, options: { newPane?: boolean; newTab?: boolean } = {}): void {
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      console.warn(`File not found: ${path}`);
      return;
    }

    let leaf: WorkspaceLeaf;

    if (options.newPane) {
      leaf = this.app.workspace.getLeaf("split");
    } else if (options.newTab) {
      leaf = this.app.workspace.getLeaf("tab");
    } else {
      leaf = this.app.workspace.getLeaf();
    }

    leaf.openFile(file);
  }

  openFileAndHighlight(path: string, line: number): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      this.app.workspace.getLeaf().openFile(file, {
        eState: { line },
      });
    }
  }
}
```

### Syncing with Active File

```typescript
class GraphViewSync {
  private currentFile: TFile | null = null;

  constructor(
    private app: App,
    private graphView: GraphView
  ) {
    // Listen for active file changes
    this.app.workspace.on("active-leaf-change", this.onActiveLeafChange.bind(this));
    this.app.workspace.on("file-open", this.onFileOpen.bind(this));
  }

  private onActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    if (!leaf) return;

    const view = leaf.view;
    if (view.getViewType() === "markdown") {
      const file = (view as MarkdownView).file;
      if (file) {
        this.focusNodeForFile(file);
      }
    }
  }

  private onFileOpen(file: TFile | null): void {
    if (file) {
      this.focusNodeForFile(file);
    }
  }

  private focusNodeForFile(file: TFile): void {
    const nodeId = file.path;
    this.graphView.focusNode(nodeId);
    this.graphView.centerOnNode(nodeId);
  }

  destroy(): void {
    this.app.workspace.off("active-leaf-change", this.onActiveLeafChange);
    this.app.workspace.off("file-open", this.onFileOpen);
  }
}
```

## Vault Integration

### Loading Graph Data from Vault

```typescript
import { TFile, CachedMetadata } from "obsidian";
import type { GraphNode, GraphEdge } from "@exocortex/obsidian-plugin";

class VaultGraphBuilder {
  constructor(private app: App) {}

  async buildGraph(folder?: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeMap = new Map<string, GraphNode>();

    // Get all markdown files
    const files = this.app.vault.getMarkdownFiles().filter((f) =>
      folder ? f.path.startsWith(folder) : true
    );

    // Create nodes
    for (const file of files) {
      const metadata = this.app.metadataCache.getFileCache(file);
      const node: GraphNode = {
        id: file.path,
        label: this.extractLabel(file, metadata),
        path: file.path,
        metadata: this.extractMetadata(metadata),
        group: this.extractGroup(file, metadata),
      };
      nodes.push(node);
      nodeMap.set(file.path, node);
    }

    // Create edges from links
    for (const file of files) {
      const metadata = this.app.metadataCache.getFileCache(file);
      if (!metadata?.links) continue;

      for (const link of metadata.links) {
        const targetPath = this.app.metadataCache.getFirstLinkpathDest(
          link.link,
          file.path
        )?.path;

        if (targetPath && nodeMap.has(targetPath)) {
          edges.push({
            id: `${file.path}->${targetPath}`,
            source: file.path,
            target: targetPath,
            label: link.displayText || link.link,
          });
        }
      }
    }

    return { nodes, edges };
  }

  private extractLabel(file: TFile, metadata: CachedMetadata | null): string {
    // Try frontmatter title first
    if (metadata?.frontmatter?.title) {
      return metadata.frontmatter.title;
    }
    // Fall back to filename
    return file.basename;
  }

  private extractMetadata(metadata: CachedMetadata | null): Record<string, unknown> {
    return {
      tags: metadata?.tags?.map((t) => t.tag) ?? [],
      ...metadata?.frontmatter,
    };
  }

  private extractGroup(file: TFile, metadata: CachedMetadata | null): string {
    // Check frontmatter type
    if (metadata?.frontmatter?.type) {
      return metadata.frontmatter.type;
    }
    // Check first folder
    const folder = file.parent?.name;
    if (folder) {
      return folder;
    }
    return "default";
  }
}
```

### Watching for Vault Changes

```typescript
class VaultWatcher {
  private debounceTimer: number | null = null;

  constructor(
    private app: App,
    private onUpdate: () => void
  ) {
    this.app.vault.on("create", this.handleChange.bind(this));
    this.app.vault.on("modify", this.handleChange.bind(this));
    this.app.vault.on("delete", this.handleChange.bind(this));
    this.app.vault.on("rename", this.handleChange.bind(this));
    this.app.metadataCache.on("changed", this.handleChange.bind(this));
  }

  private handleChange(): void {
    // Debounce updates
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.onUpdate();
    }, 500);
  }

  destroy(): void {
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }
    // Unregister event handlers
    this.app.vault.off("create", this.handleChange);
    this.app.vault.off("modify", this.handleChange);
    this.app.vault.off("delete", this.handleChange);
    this.app.vault.off("rename", this.handleChange);
  }
}
```

## Theme Integration

### Adapting to Obsidian Themes

```typescript
import { getComputedStyle } from "obsidian";

function getThemeColors(): Record<string, number> {
  const root = document.documentElement;
  const style = getComputedStyle(root);

  return {
    background: cssColorToHex(style.getPropertyValue("--background-primary")),
    text: cssColorToHex(style.getPropertyValue("--text-normal")),
    accent: cssColorToHex(style.getPropertyValue("--interactive-accent")),
    muted: cssColorToHex(style.getPropertyValue("--text-muted")),
    border: cssColorToHex(style.getPropertyValue("--background-modifier-border")),
  };
}

function cssColorToHex(cssColor: string): number {
  // Handle rgb(r, g, b) format
  const rgbMatch = cssColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch.map(Number);
    return (r << 16) | (g << 8) | b;
  }

  // Handle #rrggbb format
  if (cssColor.startsWith("#")) {
    return parseInt(cssColor.slice(1), 16);
  }

  return 0x1a1a2e; // Default dark
}

// Apply theme colors to graph
const themeColors = getThemeColors();

<GraphLayoutRenderer
  options={{
    backgroundColor: themeColors.background,
    nodeColor: themeColors.accent,
    edgeColor: themeColors.muted,
    labelColor: themeColors.text,
  }}
/>;
```

### Light/Dark Mode Detection

```typescript
class ThemeObserver {
  private observer: MutationObserver;
  private isDarkMode: boolean;

  constructor(private onThemeChange: (isDark: boolean) => void) {
    this.isDarkMode = document.body.classList.contains("theme-dark");

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "class") {
          const newIsDark = document.body.classList.contains("theme-dark");
          if (newIsDark !== this.isDarkMode) {
            this.isDarkMode = newIsDark;
            this.onThemeChange(this.isDarkMode);
          }
        }
      }
    });

    this.observer.observe(document.body, { attributes: true });
  }

  destroy(): void {
    this.observer.disconnect();
  }
}
```

## Context Menu Integration

### Custom Obsidian Context Menu

```typescript
import { Menu } from "obsidian";
import { ContextMenuManager, createDefaultProviders } from "@exocortex/obsidian-plugin";

class ObsidianContextMenuProvider {
  constructor(
    private app: App,
    private graphView: GraphView
  ) {}

  showContextMenu(event: MouseEvent, nodeId: string | null, edgeId: string | null): void {
    const menu = new Menu();

    if (nodeId) {
      const path = this.graphView.getNodePath(nodeId);

      menu.addItem((item) =>
        item
          .setTitle("Open")
          .setIcon("file")
          .onClick(() => this.app.workspace.openLinkText(path, ""))
      );

      menu.addItem((item) =>
        item
          .setTitle("Open in new pane")
          .setIcon("separator-vertical")
          .onClick(() => {
            const leaf = this.app.workspace.getLeaf("split");
            this.app.workspace.openLinkText(path, "", leaf);
          })
      );

      menu.addSeparator();

      menu.addItem((item) =>
        item
          .setTitle("Reveal in file explorer")
          .setIcon("folder")
          .onClick(() => {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file) {
              this.app.workspace.revealLeaf(
                this.app.workspace.getLeavesOfType("file-explorer")[0]
              );
              // Scroll to file in explorer
            }
          })
      );

      menu.addItem((item) =>
        item
          .setTitle("Focus on this node")
          .setIcon("target")
          .onClick(() => this.graphView.setFocusNode(nodeId))
      );
    } else {
      // Canvas context menu
      menu.addItem((item) =>
        item
          .setTitle("Fit to view")
          .setIcon("maximize")
          .onClick(() => this.graphView.fitToView())
      );

      menu.addItem((item) =>
        item
          .setTitle("Reset zoom")
          .setIcon("zoom-in")
          .onClick(() => this.graphView.resetZoom())
      );
    }

    menu.showAtMouseEvent(event);
  }
}
```

## Settings Integration

### Plugin Settings

```typescript
interface GraphViewSettings {
  defaultChargeStrength: number;
  defaultLinkDistance: number;
  showLabels: boolean;
  labelFontSize: number;
  colorByType: boolean;
  animationSpeed: number;
}

const DEFAULT_SETTINGS: GraphViewSettings = {
  defaultChargeStrength: -300,
  defaultLinkDistance: 100,
  showLabels: true,
  labelFontSize: 12,
  colorByType: true,
  animationSpeed: 1,
};

class GraphViewSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: MyPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Graph View Settings" });

    new Setting(containerEl)
      .setName("Charge strength")
      .setDesc("Repulsion force between nodes (-1000 to -30)")
      .addSlider((slider) =>
        slider
          .setLimits(-1000, -30, 10)
          .setValue(this.plugin.settings.defaultChargeStrength)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultChargeStrength = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show labels")
      .setDesc("Display node labels on the graph")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showLabels).onChange(async (value) => {
          this.plugin.settings.showLabels = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
```

## Next Steps

- [Configuration](./configuration.md) - Full options reference
- [Data Sources](../guides/data-sources.md) - SPARQL and triple store integration
- [Performance](../guides/performance.md) - Optimizing for large vaults
