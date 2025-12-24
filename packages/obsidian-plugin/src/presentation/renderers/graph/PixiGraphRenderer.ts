/**
 * PixiGraphRenderer - High-performance 2D graph rendering with PixiJS v8 and WebGL2
 *
 * Provides GPU-accelerated rendering for graph visualization with:
 * - WebGL2 backend for optimal performance
 * - Layered container hierarchy (edges → nodes → labels)
 * - Viewport transformation (pan, zoom)
 * - Efficient sprite batching for large graphs
 * - ResizeObserver integration for responsive sizing
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import { Application, Container, Graphics, Text, type TextStyle } from "pixi.js";
import type { GraphNode, GraphEdge } from "./types";

/**
 * Configuration options for PixiGraphRenderer
 */
export interface PixiGraphRendererOptions {
  /** Background color (hex number, default: 0x1a1a2e) */
  backgroundColor?: number;

  /** Whether to use anti-aliasing (default: true) */
  antialias?: boolean;

  /** Resolution multiplier (default: window.devicePixelRatio) */
  resolution?: number;

  /** Whether to auto-resize with container (default: true) */
  autoDensity?: boolean;

  /** GPU power preference (default: 'high-performance') */
  powerPreference?: "high-performance" | "low-power";

  /** Whether to prefer WebGL2 (default: true) */
  preferWebGL2?: boolean;

  /** Default node radius in pixels (default: 8) */
  nodeRadius?: number;

  /** Default node color (hex number, default: 0x6366f1) */
  nodeColor?: number;

  /** Default edge color (hex number, default: 0x64748b) */
  edgeColor?: number;

  /** Default edge width in pixels (default: 1) */
  edgeWidth?: number;

  /** Label font family (default: 'Inter, system-ui, sans-serif') */
  labelFontFamily?: string;

  /** Label font size in pixels (default: 12) */
  labelFontSize?: number;

  /** Label color (hex number, default: 0xe2e8f0) */
  labelColor?: number;

  /** Whether to show labels by default (default: true) */
  showLabels?: boolean;

  /** Minimum zoom level (default: 0.1) */
  minZoom?: number;

  /** Maximum zoom level (default: 4) */
  maxZoom?: number;
}

/**
 * Viewport state for pan/zoom
 */
export interface ViewportState {
  /** X offset in screen coordinates */
  x: number;
  /** Y offset in screen coordinates */
  y: number;
  /** Zoom level (1 = 100%) */
  zoom: number;
}

/**
 * Rendered node sprite with metadata
 */
interface NodeSprite {
  /** PixiJS Graphics object for the node circle */
  graphics: Graphics;
  /** Label text object (if labels enabled) */
  label?: Text;
  /** Reference to original node data */
  node: GraphNode;
}

/**
 * Rendered edge graphics with metadata
 */
interface EdgeGraphics {
  /** PixiJS Graphics object for the edge line */
  graphics: Graphics;
  /** Reference to original edge data */
  edge: GraphEdge;
}

/**
 * PixiGraphRenderer - GPU-accelerated graph rendering using PixiJS v8
 *
 * @example
 * ```typescript
 * const renderer = new PixiGraphRenderer();
 * await renderer.initialize(canvasElement);
 *
 * // Update graph data
 * renderer.setNodes(nodes);
 * renderer.setEdges(edges);
 *
 * // Viewport control
 * renderer.setViewport(100, 100, 1.5);
 *
 * // Cleanup
 * renderer.destroy();
 * ```
 */
export class PixiGraphRenderer {
  private app: Application | null = null;
  private canvas: HTMLCanvasElement | null = null;

  // Layer containers (z-order: edges → nodes → labels)
  private edgeContainer: Container | null = null;
  private nodeContainer: Container | null = null;
  private labelContainer: Container | null = null;

  // Sprite maps for efficient updates
  private nodeSprites: Map<string, NodeSprite> = new Map();
  private edgeGraphics: Map<string, EdgeGraphics> = new Map();

  // Configuration
  private options: Required<PixiGraphRendererOptions>;

  // Viewport state
  private viewport: ViewportState = { x: 0, y: 0, zoom: 1 };

  // Resize handling
  private resizeObserver: ResizeObserver | null = null;

  // Initialization state
  private initialized = false;

  constructor(options: PixiGraphRendererOptions = {}) {
    this.options = {
      backgroundColor: options.backgroundColor ?? 0x1a1a2e,
      antialias: options.antialias ?? true,
      resolution: options.resolution ?? (typeof window !== "undefined" ? window.devicePixelRatio : 1),
      autoDensity: options.autoDensity ?? true,
      powerPreference: options.powerPreference ?? "high-performance",
      preferWebGL2: options.preferWebGL2 ?? true,
      nodeRadius: options.nodeRadius ?? 8,
      nodeColor: options.nodeColor ?? 0x6366f1,
      edgeColor: options.edgeColor ?? 0x64748b,
      edgeWidth: options.edgeWidth ?? 1,
      labelFontFamily: options.labelFontFamily ?? "Inter, system-ui, sans-serif",
      labelFontSize: options.labelFontSize ?? 12,
      labelColor: options.labelColor ?? 0xe2e8f0,
      showLabels: options.showLabels ?? true,
      minZoom: options.minZoom ?? 0.1,
      maxZoom: options.maxZoom ?? 4,
    };
  }

  /**
   * Initialize the PixiJS application with WebGL2 backend
   *
   * @param canvas - The canvas element to render to
   * @returns Promise that resolves when initialization is complete
   */
  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    if (this.initialized) {
      throw new Error("PixiGraphRenderer is already initialized");
    }

    this.canvas = canvas;
    this.app = new Application();

    await this.app.init({
      canvas,
      width: canvas.clientWidth || 800,
      height: canvas.clientHeight || 600,
      backgroundColor: this.options.backgroundColor,
      antialias: this.options.antialias,
      resolution: this.options.resolution,
      autoDensity: this.options.autoDensity,
      powerPreference: this.options.powerPreference,
      // PixiJS v8 automatically uses WebGL2 when available
    });

    this.setupContainers();
    this.setupResizeHandler();
    this.initialized = true;
  }

  /**
   * Setup container hierarchy for layered rendering
   * Order: edges (bottom) → nodes → labels (top)
   */
  private setupContainers(): void {
    if (!this.app) return;

    this.edgeContainer = new Container();
    this.nodeContainer = new Container();
    this.labelContainer = new Container();

    // Enable sortable children for z-index control
    this.nodeContainer.sortableChildren = true;

    // Add containers to stage in z-order
    this.app.stage.addChild(this.edgeContainer);
    this.app.stage.addChild(this.nodeContainer);
    this.app.stage.addChild(this.labelContainer);
  }

  /**
   * Setup resize observer for responsive canvas sizing
   */
  private setupResizeHandler(): void {
    if (!this.canvas || typeof ResizeObserver === "undefined") return;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.resize(width, height);
      }
    });

    this.resizeObserver.observe(this.canvas);
  }

  /**
   * Resize the renderer to new dimensions
   *
   * @param width - New width in CSS pixels
   * @param height - New height in CSS pixels
   */
  resize(width: number, height: number): void {
    if (!this.app) return;

    this.app.renderer.resize(width, height);
  }

  /**
   * Get current canvas dimensions
   *
   * @returns Object with width and height
   */
  getSize(): { width: number; height: number } {
    if (!this.app) {
      return { width: 0, height: 0 };
    }
    return {
      width: this.app.renderer.width,
      height: this.app.renderer.height,
    };
  }

  /**
   * Set viewport transformation (pan and zoom)
   *
   * @param x - X offset in screen coordinates
   * @param y - Y offset in screen coordinates
   * @param zoom - Zoom level (1 = 100%)
   */
  setViewport(x: number, y: number, zoom: number): void {
    // Clamp zoom to valid range
    zoom = Math.max(this.options.minZoom, Math.min(this.options.maxZoom, zoom));

    this.viewport = { x, y, zoom };

    if (!this.app) return;

    // Apply viewport transformation to stage
    this.app.stage.position.set(x, y);
    this.app.stage.scale.set(zoom);
  }

  /**
   * Get current viewport state
   *
   * @returns Current viewport state
   */
  getViewport(): ViewportState {
    return { ...this.viewport };
  }

  /**
   * Pan the viewport by a delta amount
   *
   * @param dx - Delta X in screen coordinates
   * @param dy - Delta Y in screen coordinates
   */
  pan(dx: number, dy: number): void {
    this.setViewport(
      this.viewport.x + dx,
      this.viewport.y + dy,
      this.viewport.zoom
    );
  }

  /**
   * Zoom the viewport around a point
   *
   * @param zoomDelta - Zoom multiplier (e.g., 1.1 for 10% zoom in)
   * @param centerX - X coordinate to zoom around (screen space)
   * @param centerY - Y coordinate to zoom around (screen space)
   */
  zoomAt(zoomDelta: number, centerX: number, centerY: number): void {
    const newZoom = this.viewport.zoom * zoomDelta;

    // Clamp to valid range
    const clampedZoom = Math.max(
      this.options.minZoom,
      Math.min(this.options.maxZoom, newZoom)
    );

    // Calculate new viewport position to keep the point stationary
    const zoomChange = clampedZoom / this.viewport.zoom;
    const newX = centerX - (centerX - this.viewport.x) * zoomChange;
    const newY = centerY - (centerY - this.viewport.y) * zoomChange;

    this.setViewport(newX, newY, clampedZoom);
  }

  /**
   * Center the viewport on specific coordinates
   *
   * @param worldX - World X coordinate to center on
   * @param worldY - World Y coordinate to center on
   */
  centerOn(worldX: number, worldY: number): void {
    const { width, height } = this.getSize();
    const screenCenterX = width / 2;
    const screenCenterY = height / 2;

    const newX = screenCenterX - worldX * this.viewport.zoom;
    const newY = screenCenterY - worldY * this.viewport.zoom;

    this.setViewport(newX, newY, this.viewport.zoom);
  }

  /**
   * Fit all nodes in view with padding
   *
   * @param nodes - Nodes to fit in view
   * @param padding - Padding around nodes in pixels (default: 50)
   */
  fitToView(nodes: GraphNode[], padding: number = 50): void {
    if (nodes.length === 0) return;

    // Calculate bounds
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
      if (node.x !== undefined && node.y !== undefined) {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x);
        maxY = Math.max(maxY, node.y);
      }
    }

    if (!isFinite(minX)) return;

    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    const { width, height } = this.getSize();

    // Calculate zoom to fit
    const scaleX = (width - padding * 2) / graphWidth;
    const scaleY = (height - padding * 2) / graphHeight;
    const zoom = Math.min(scaleX, scaleY, this.options.maxZoom);

    // Center the graph
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    this.setViewport(
      width / 2 - centerX * zoom,
      height / 2 - centerY * zoom,
      zoom
    );
  }

  /**
   * Set and render nodes
   *
   * @param nodes - Array of graph nodes to render
   */
  setNodes(nodes: GraphNode[]): void {
    if (!this.nodeContainer || !this.labelContainer) return;

    // Track which nodes to keep
    const currentNodeIds = new Set(nodes.map((n) => n.id));

    // Remove nodes that no longer exist
    for (const [id, sprite] of this.nodeSprites) {
      if (!currentNodeIds.has(id)) {
        this.nodeContainer.removeChild(sprite.graphics);
        sprite.graphics.destroy();
        if (sprite.label) {
          this.labelContainer.removeChild(sprite.label);
          sprite.label.destroy();
        }
        this.nodeSprites.delete(id);
      }
    }

    // Add or update nodes
    for (const node of nodes) {
      let sprite = this.nodeSprites.get(node.id);

      if (!sprite) {
        // Create new node sprite
        const graphics = new Graphics();
        const label = this.options.showLabels ? this.createLabel(node.label) : undefined;

        sprite = { graphics, label, node };
        this.nodeSprites.set(node.id, sprite);

        this.nodeContainer.addChild(graphics);
        if (label) {
          this.labelContainer.addChild(label);
        }
      } else {
        // Update existing sprite's node reference
        sprite.node = node;
      }

      // Update position and appearance
      this.updateNodeSprite(sprite, node);
    }
  }

  /**
   * Update a single node sprite's appearance
   */
  private updateNodeSprite(sprite: NodeSprite, node: GraphNode): void {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const radius = node.size ?? this.options.nodeRadius;
    const color = node.color ? parseInt(node.color.replace("#", ""), 16) : this.options.nodeColor;

    // Clear and redraw graphics
    sprite.graphics.clear();
    sprite.graphics.circle(0, 0, radius);
    sprite.graphics.fill({ color });
    sprite.graphics.position.set(x, y);

    // Update label position
    if (sprite.label) {
      sprite.label.position.set(x, y + radius + 4);
      sprite.label.text = node.label;
    }
  }

  /**
   * Create a text label
   */
  private createLabel(text: string): Text {
    const textStyle: Partial<TextStyle> = {
      fontFamily: this.options.labelFontFamily,
      fontSize: this.options.labelFontSize,
      fill: this.options.labelColor,
      align: "center",
    };

    const label = new Text({ text, style: textStyle });
    label.anchor.set(0.5, 0);
    return label;
  }

  /**
   * Set and render edges
   *
   * @param edges - Array of graph edges to render
   * @param nodes - Array of nodes (needed to resolve source/target positions)
   */
  setEdges(edges: GraphEdge[], nodes: GraphNode[]): void {
    if (!this.edgeContainer) return;

    // Create node position lookup
    const nodePositions = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
      nodePositions.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
    }

    // Track which edges to keep
    const currentEdgeIds = new Set(edges.map((e) => e.id));

    // Remove edges that no longer exist
    for (const [id, edgeGfx] of this.edgeGraphics) {
      if (!currentEdgeIds.has(id)) {
        this.edgeContainer.removeChild(edgeGfx.graphics);
        edgeGfx.graphics.destroy();
        this.edgeGraphics.delete(id);
      }
    }

    // Add or update edges
    for (const edge of edges) {
      let edgeGfx = this.edgeGraphics.get(edge.id);

      if (!edgeGfx) {
        // Create new edge graphics
        const graphics = new Graphics();
        edgeGfx = { graphics, edge };
        this.edgeGraphics.set(edge.id, edgeGfx);
        this.edgeContainer.addChild(graphics);
      } else {
        edgeGfx.edge = edge;
      }

      // Update edge appearance
      this.updateEdgeGraphics(edgeGfx, edge, nodePositions);
    }
  }

  /**
   * Update a single edge's appearance
   */
  private updateEdgeGraphics(
    edgeGfx: EdgeGraphics,
    edge: GraphEdge,
    nodePositions: Map<string, { x: number; y: number }>
  ): void {
    const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

    const sourcePos = nodePositions.get(sourceId);
    const targetPos = nodePositions.get(targetId);

    if (!sourcePos || !targetPos) return;

    const color = edge.color
      ? parseInt(edge.color.replace("#", ""), 16)
      : this.options.edgeColor;

    edgeGfx.graphics.clear();
    edgeGfx.graphics.moveTo(sourcePos.x, sourcePos.y);
    edgeGfx.graphics.lineTo(targetPos.x, targetPos.y);
    edgeGfx.graphics.stroke({ width: this.options.edgeWidth, color });
  }

  /**
   * Update all node and edge positions (call after force simulation tick)
   *
   * @param nodes - Updated nodes with new positions
   * @param edges - Edges (optional, only needed if positions changed)
   */
  updatePositions(nodes: GraphNode[], edges?: GraphEdge[]): void {
    // Update node positions
    for (const node of nodes) {
      const sprite = this.nodeSprites.get(node.id);
      if (sprite) {
        this.updateNodeSprite(sprite, node);
      }
    }

    // Update edge positions if provided
    if (edges && this.edgeContainer) {
      const nodePositions = new Map<string, { x: number; y: number }>();
      for (const node of nodes) {
        nodePositions.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
      }

      for (const edge of edges) {
        const edgeGfx = this.edgeGraphics.get(edge.id);
        if (edgeGfx) {
          this.updateEdgeGraphics(edgeGfx, edge, nodePositions);
        }
      }
    }
  }

  /**
   * Set label visibility
   *
   * @param visible - Whether to show labels
   */
  setLabelsVisible(visible: boolean): void {
    if (!this.labelContainer) return;
    this.labelContainer.visible = visible;
  }

  /**
   * Convert screen coordinates to world coordinates
   *
   * @param screenX - Screen X coordinate
   * @param screenY - Screen Y coordinate
   * @returns World coordinates
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.viewport.x) / this.viewport.zoom,
      y: (screenY - this.viewport.y) / this.viewport.zoom,
    };
  }

  /**
   * Convert world coordinates to screen coordinates
   *
   * @param worldX - World X coordinate
   * @param worldY - World Y coordinate
   * @returns Screen coordinates
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: worldX * this.viewport.zoom + this.viewport.x,
      y: worldY * this.viewport.zoom + this.viewport.y,
    };
  }

  /**
   * Find node at screen position
   *
   * @param screenX - Screen X coordinate
   * @param screenY - Screen Y coordinate
   * @returns Node at position or undefined
   */
  findNodeAtPosition(screenX: number, screenY: number): GraphNode | undefined {
    const world = this.screenToWorld(screenX, screenY);

    for (const [, sprite] of this.nodeSprites) {
      const node = sprite.node;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const radius = node.size ?? this.options.nodeRadius;

      const dx = world.x - x;
      const dy = world.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= radius) {
        return node;
      }
    }

    return undefined;
  }

  /**
   * Force a render update
   */
  render(): void {
    if (!this.app) return;
    this.app.render();
  }

  /**
   * Check if the renderer is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get renderer statistics
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    fps: number;
  } {
    return {
      nodeCount: this.nodeSprites.size,
      edgeCount: this.edgeGraphics.size,
      fps: this.app?.ticker?.FPS ?? 0,
    };
  }

  /**
   * Clear all nodes and edges
   */
  clear(): void {
    // Clear nodes
    for (const [, sprite] of this.nodeSprites) {
      sprite.graphics.destroy();
      if (sprite.label) {
        sprite.label.destroy();
      }
    }
    this.nodeSprites.clear();

    // Clear edges
    for (const [, edgeGfx] of this.edgeGraphics) {
      edgeGfx.graphics.destroy();
    }
    this.edgeGraphics.clear();
  }

  /**
   * Destroy the renderer and release resources
   */
  destroy(): void {
    // Stop resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clear all graphics
    this.clear();

    // Destroy containers
    if (this.edgeContainer) {
      this.edgeContainer.destroy({ children: true });
      this.edgeContainer = null;
    }
    if (this.nodeContainer) {
      this.nodeContainer.destroy({ children: true });
      this.nodeContainer = null;
    }
    if (this.labelContainer) {
      this.labelContainer.destroy({ children: true });
      this.labelContainer = null;
    }

    // Destroy application
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }

    this.canvas = null;
    this.initialized = false;
  }
}
