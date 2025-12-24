/**
 * ContextMenuProviders - Built-in context menu providers for graph elements
 *
 * Provides standard context menu actions for:
 * - Nodes: Open, navigate, select, expand/collapse, copy
 * - Edges: Navigate to source/target, copy relationship
 * - Canvas: Fit view, reset zoom, layout options
 * - Selection: Bulk operations on multiple items
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type {
  ContextMenuProvider,
  ContextMenuItem,
  ContextMenuTarget,
} from "./ContextMenuManager";
import type { GraphNode } from "./types";

/**
 * Callbacks for context menu actions
 */
export interface ContextMenuCallbacks {
  /** Navigate to a file path */
  onNavigate?: (path: string) => void;
  /** Open file in new pane */
  onOpenInNewPane?: (path: string) => void;
  /** Focus on a node (center in viewport) */
  onFocusNode?: (nodeId: string) => void;
  /** Select nodes */
  onSelectNodes?: (nodeIds: string[]) => void;
  /** Expand node neighbors */
  onExpandNode?: (nodeId: string, depth?: number) => void;
  /** Collapse node (hide neighbors) */
  onCollapseNode?: (nodeId: string) => void;
  /** Hide nodes from view */
  onHideNodes?: (nodeIds: string[]) => void;
  /** Copy text to clipboard */
  onCopy?: (text: string) => void;
  /** Pin node position */
  onPinNode?: (nodeId: string) => void;
  /** Unpin node position */
  onUnpinNode?: (nodeId: string) => void;
  /** Fit viewport to all nodes */
  onFitView?: () => void;
  /** Reset viewport zoom to 100% */
  onResetZoom?: () => void;
  /** Change layout algorithm */
  onChangeLayout?: (algorithm: string) => void;
  /** Create new node at position */
  onCreateNode?: (position: { x: number; y: number }) => void;
  /** Show node/edge details panel */
  onShowDetails?: (type: "node" | "edge", id: string) => void;
  /** Select connected nodes */
  onSelectConnected?: (nodeId: string, direction: "incoming" | "outgoing" | "both") => void;
  /** Invert selection */
  onInvertSelection?: () => void;
}

/**
 * Node context menu provider
 *
 * Provides actions for individual nodes:
 * - Open in Obsidian
 * - Open in new pane
 * - Focus in graph
 * - Select neighbors
 * - Expand/collapse
 * - Copy path/link
 * - Pin/unpin position
 * - Hide from view
 */
export class NodeContextMenuProvider implements ContextMenuProvider {
  readonly id = "node-provider";
  readonly priority = 100;

  constructor(private callbacks: ContextMenuCallbacks) {}

  appliesTo(target: ContextMenuTarget): boolean {
    return target.type === "node";
  }

  getItems(target: ContextMenuTarget): ContextMenuItem[] {
    if (target.type !== "node") {
      return [];
    }

    const { nodeId, node } = target;
    const items: ContextMenuItem[] = [];

    // Open actions
    items.push({
      id: "open-file",
      label: "Open in Obsidian",
      icon: "open-file",
      shortcut: "Enter",
      action: () => {
        this.callbacks.onNavigate?.(node.path);
      },
    });

    items.push({
      id: "open-new-pane",
      label: "Open in New Pane",
      icon: "open-file",
      shortcut: "⌘Enter",
      action: () => {
        this.callbacks.onOpenInNewPane?.(node.path);
      },
      separator: true,
    });

    // Graph navigation
    items.push({
      id: "focus-node",
      label: "Focus in Graph",
      icon: "focus",
      shortcut: "F",
      action: () => {
        this.callbacks.onFocusNode?.(nodeId);
      },
    });

    items.push({
      id: "select-connected",
      label: "Select Connected",
      icon: "select",
      submenu: [
        {
          id: "select-incoming",
          label: "Incoming connections",
          action: () => {
            this.callbacks.onSelectConnected?.(nodeId, "incoming");
          },
        },
        {
          id: "select-outgoing",
          label: "Outgoing connections",
          action: () => {
            this.callbacks.onSelectConnected?.(nodeId, "outgoing");
          },
        },
        {
          id: "select-all-connected",
          label: "All connections",
          action: () => {
            this.callbacks.onSelectConnected?.(nodeId, "both");
          },
        },
      ],
    });

    items.push({
      id: "expand-node",
      label: "Expand Neighbors",
      icon: "expand",
      submenu: [
        {
          id: "expand-1",
          label: "1 level",
          action: () => {
            this.callbacks.onExpandNode?.(nodeId, 1);
          },
        },
        {
          id: "expand-2",
          label: "2 levels",
          action: () => {
            this.callbacks.onExpandNode?.(nodeId, 2);
          },
        },
        {
          id: "expand-3",
          label: "3 levels",
          action: () => {
            this.callbacks.onExpandNode?.(nodeId, 3);
          },
        },
      ],
    });

    items.push({
      id: "collapse-node",
      label: "Collapse Node",
      icon: "collapse",
      action: () => {
        this.callbacks.onCollapseNode?.(nodeId);
      },
      separator: true,
    });

    // Copy actions
    items.push({
      id: "copy-path",
      label: "Copy File Path",
      icon: "copy",
      action: () => {
        this.callbacks.onCopy?.(node.path);
      },
    });

    items.push({
      id: "copy-link",
      label: "Copy Obsidian Link",
      icon: "link",
      action: () => {
        this.callbacks.onCopy?.(`[[${node.path}]]`);
      },
      separator: true,
    });

    // Pin/unpin
    const isPinned = node.fx !== undefined && node.fx !== null;
    items.push({
      id: isPinned ? "unpin-node" : "pin-node",
      label: isPinned ? "Unpin Position" : "Pin Position",
      icon: "pin",
      action: () => {
        if (isPinned) {
          this.callbacks.onUnpinNode?.(nodeId);
        } else {
          this.callbacks.onPinNode?.(nodeId);
        }
      },
    });

    // Show details
    items.push({
      id: "show-details",
      label: "Show Details",
      icon: "info",
      action: () => {
        this.callbacks.onShowDetails?.("node", nodeId);
      },
      separator: true,
    });

    // Hide
    items.push({
      id: "hide-node",
      label: "Hide from Graph",
      icon: "hide",
      danger: true,
      action: () => {
        this.callbacks.onHideNodes?.([nodeId]);
      },
    });

    return items;
  }
}

/**
 * Edge context menu provider
 *
 * Provides actions for edges:
 * - Navigate to source/target
 * - Copy relationship info
 * - Show edge details
 */
export class EdgeContextMenuProvider implements ContextMenuProvider {
  readonly id = "edge-provider";
  readonly priority = 100;

  constructor(
    private callbacks: ContextMenuCallbacks,
    private getNode: (id: string) => GraphNode | undefined
  ) {}

  appliesTo(target: ContextMenuTarget): boolean {
    return target.type === "edge";
  }

  getItems(target: ContextMenuTarget): ContextMenuItem[] {
    if (target.type !== "edge") {
      return [];
    }

    const { edgeId, edge } = target;
    const items: ContextMenuItem[] = [];

    const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
    const sourceNode = this.getNode(sourceId);
    const targetNode = this.getNode(targetId);

    // Navigate to source
    if (sourceNode) {
      items.push({
        id: "goto-source",
        label: `Go to Source: ${sourceNode.label}`,
        icon: "open-file",
        action: () => {
          this.callbacks.onNavigate?.(sourceNode.path);
        },
      });
    }

    // Navigate to target
    if (targetNode) {
      items.push({
        id: "goto-target",
        label: `Go to Target: ${targetNode.label}`,
        icon: "open-file",
        action: () => {
          this.callbacks.onNavigate?.(targetNode.path);
        },
        separator: true,
      });
    }

    // Focus on source/target
    items.push({
      id: "focus-source",
      label: "Focus on Source",
      icon: "focus",
      action: () => {
        this.callbacks.onFocusNode?.(sourceId);
      },
    });

    items.push({
      id: "focus-target",
      label: "Focus on Target",
      icon: "focus",
      action: () => {
        this.callbacks.onFocusNode?.(targetId);
      },
      separator: true,
    });

    // Copy relationship
    if (edge.property) {
      items.push({
        id: "copy-relationship",
        label: "Copy Relationship",
        icon: "copy",
        action: () => {
          const relationText = `${sourceNode?.label ?? sourceId} → ${edge.property} → ${targetNode?.label ?? targetId}`;
          this.callbacks.onCopy?.(relationText);
        },
      });
    }

    // Show details
    items.push({
      id: "show-edge-details",
      label: "Show Edge Details",
      icon: "info",
      action: () => {
        this.callbacks.onShowDetails?.("edge", edgeId);
      },
    });

    return items;
  }
}

/**
 * Canvas context menu provider
 *
 * Provides actions for the graph canvas:
 * - Fit view
 * - Reset zoom
 * - Layout options
 * - Create new node
 */
export class CanvasContextMenuProvider implements ContextMenuProvider {
  readonly id = "canvas-provider";
  readonly priority = 50;

  constructor(private callbacks: ContextMenuCallbacks) {}

  appliesTo(target: ContextMenuTarget): boolean {
    return target.type === "canvas";
  }

  getItems(target: ContextMenuTarget): ContextMenuItem[] {
    if (target.type !== "canvas") {
      return [];
    }

    const { position } = target;
    const items: ContextMenuItem[] = [];

    // Viewport actions
    items.push({
      id: "fit-view",
      label: "Fit to View",
      icon: "focus",
      shortcut: "⌘0",
      action: () => {
        this.callbacks.onFitView?.();
      },
    });

    items.push({
      id: "reset-zoom",
      label: "Reset Zoom (100%)",
      icon: "search",
      shortcut: "⌘1",
      action: () => {
        this.callbacks.onResetZoom?.();
      },
      separator: true,
    });

    // Layout options
    items.push({
      id: "layout",
      label: "Layout",
      icon: "layout",
      submenu: [
        {
          id: "layout-force",
          label: "Force-directed",
          action: () => {
            this.callbacks.onChangeLayout?.("force");
          },
        },
        {
          id: "layout-hierarchical",
          label: "Hierarchical",
          action: () => {
            this.callbacks.onChangeLayout?.("hierarchical");
          },
        },
        {
          id: "layout-radial",
          label: "Radial",
          action: () => {
            this.callbacks.onChangeLayout?.("radial");
          },
        },
        {
          id: "layout-grid",
          label: "Grid",
          action: () => {
            this.callbacks.onChangeLayout?.("grid");
          },
        },
      ],
      separator: true,
    });

    // Create node
    items.push({
      id: "create-node",
      label: "Create New Note Here",
      icon: "plus",
      action: () => {
        this.callbacks.onCreateNode?.(position);
      },
    });

    return items;
  }
}

/**
 * Selection context menu provider
 *
 * Provides actions for multiple selected items:
 * - Hide selection
 * - Focus selection
 * - Invert selection
 * - Expand all
 * - Copy all paths
 */
export class SelectionContextMenuProvider implements ContextMenuProvider {
  readonly id = "selection-provider";
  readonly priority = 90;

  constructor(
    private callbacks: ContextMenuCallbacks,
    private getNode: (id: string) => GraphNode | undefined
  ) {}

  appliesTo(target: ContextMenuTarget): boolean {
    return target.type === "selection";
  }

  getItems(target: ContextMenuTarget): ContextMenuItem[] {
    if (target.type !== "selection") {
      return [];
    }

    const { nodeIds, edgeIds } = target;
    const items: ContextMenuItem[] = [];

    const nodeCount = nodeIds.length;
    const edgeCount = edgeIds.length;

    // Selection info header (disabled item as label)
    items.push({
      id: "selection-info",
      label: `${nodeCount} node${nodeCount !== 1 ? "s" : ""}, ${edgeCount} edge${edgeCount !== 1 ? "s" : ""} selected`,
      disabled: true,
      separator: true,
    });

    // Focus selection
    if (nodeCount > 0) {
      items.push({
        id: "focus-selection",
        label: "Focus Selected Nodes",
        icon: "focus",
        action: () => {
          // Focus on first selected node (or fit to all)
          this.callbacks.onFocusNode?.(nodeIds[0]);
        },
      });

      // Expand all selected
      items.push({
        id: "expand-all",
        label: "Expand All Selected",
        icon: "expand",
        action: () => {
          for (const nodeId of nodeIds) {
            this.callbacks.onExpandNode?.(nodeId, 1);
          }
        },
        separator: true,
      });

      // Copy all paths
      items.push({
        id: "copy-all-paths",
        label: "Copy All Paths",
        icon: "copy",
        action: () => {
          const paths = nodeIds
            .map((id) => this.getNode(id)?.path)
            .filter(Boolean)
            .join("\n");
          this.callbacks.onCopy?.(paths);
        },
      });

      items.push({
        id: "copy-all-links",
        label: "Copy All Links",
        icon: "link",
        action: () => {
          const links = nodeIds
            .map((id) => {
              const node = this.getNode(id);
              return node ? `[[${node.path}]]` : null;
            })
            .filter(Boolean)
            .join("\n");
          this.callbacks.onCopy?.(links);
        },
        separator: true,
      });
    }

    // Invert selection
    items.push({
      id: "invert-selection",
      label: "Invert Selection",
      icon: "select",
      action: () => {
        this.callbacks.onInvertSelection?.();
      },
    });

    // Hide selection
    if (nodeCount > 0) {
      items.push({
        id: "hide-selection",
        label: "Hide Selected",
        icon: "hide",
        danger: true,
        action: () => {
          this.callbacks.onHideNodes?.(nodeIds);
        },
      });
    }

    return items;
  }
}

/**
 * Create default context menu providers
 */
export function createDefaultProviders(
  callbacks: ContextMenuCallbacks,
  getNode: (id: string) => GraphNode | undefined
): ContextMenuProvider[] {
  return [
    new NodeContextMenuProvider(callbacks),
    new EdgeContextMenuProvider(callbacks, getNode),
    new CanvasContextMenuProvider(callbacks),
    new SelectionContextMenuProvider(callbacks, getNode),
  ];
}
