/**
 * NodeRenderer - Customizable node rendering with shapes, colors, borders, shadows, and icons
 *
 * Provides flexible node visualization for graph rendering with:
 * - Multiple shape types (circle, rect, roundedRect, diamond, hexagon, triangle)
 * - Configurable fill, border, and shadow styles
 * - Optional icon rendering (Lucide icons)
 * - Hover and selection states
 * - Both vector (Graphics) and rasterized (Sprite) rendering modes
 * - Object pooling for performance optimization
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import { Container, Graphics, Text, type TextStyle } from "pixi.js";

/**
 * Available node shape types
 */
export type NodeShape =
  | "circle"
  | "rect"
  | "roundedRect"
  | "diamond"
  | "hexagon"
  | "triangle";

/**
 * Radius scaling modes for nodes
 */
export type RadiusScalingMode = "fixed" | "degree" | "pagerank";

/**
 * Node visual style configuration
 */
export interface NodeVisualStyle {
  // Shape
  /** Shape type for the node */
  shape: NodeShape;

  // Size
  /** Base radius in pixels */
  radius: number;
  /** Multiplier for radius scaling (e.g., for degree-based sizing) */
  radiusScale: number;

  // Fill
  /** Fill color (hex number) */
  fillColor: number;
  /** Fill alpha (0-1) */
  fillAlpha: number;

  // Border
  /** Border width in pixels */
  borderWidth: number;
  /** Border color (hex number) */
  borderColor: number;
  /** Border alpha (0-1) */
  borderAlpha: number;

  // Shadow
  /** Whether shadow is enabled */
  shadowEnabled: boolean;
  /** Shadow color (hex number) */
  shadowColor: number;
  /** Shadow blur amount */
  shadowBlur: number;
  /** Shadow X offset */
  shadowOffsetX: number;
  /** Shadow Y offset */
  shadowOffsetY: number;

  // Icon (optional)
  /** Lucide icon name (optional) */
  icon?: string;
  /** Icon color (hex number) */
  iconColor?: number;
  /** Icon scale multiplier */
  iconScale?: number;

  // States
  /** Scale multiplier on hover */
  hoverScale: number;
  /** Border color when selected */
  selectedBorderColor: number;
  /** Border width when selected */
  selectedBorderWidth: number;
}

/**
 * Default node visual style
 */
export const DEFAULT_NODE_STYLE: NodeVisualStyle = {
  shape: "circle",
  radius: 8,
  radiusScale: 1,
  fillColor: 0x6366f1,
  fillAlpha: 1,
  borderWidth: 1,
  borderColor: 0xffffff,
  borderAlpha: 0.3,
  shadowEnabled: false,
  shadowColor: 0x000000,
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  hoverScale: 1.2,
  selectedBorderColor: 0xfbbf24,
  selectedBorderWidth: 2,
};

/**
 * Ontology class type for node type resolution
 */
export type OntologyClass =
  | "ems__Task"
  | "ems__Project"
  | "ems__Area"
  | "ems__Person"
  | "ims__Concept"
  | "exo__Asset"
  | string;

/**
 * Node type configuration for ontology-based styling
 */
export interface NodeTypeConfig {
  /** Ontology class URI or identifier */
  classUri: OntologyClass;
  /** Display name for the type */
  displayName: string;
  /** Visual style for this type */
  style: Partial<NodeVisualStyle>;
}

/**
 * Predefined node type configurations
 */
export const DEFAULT_NODE_TYPE_CONFIGS: NodeTypeConfig[] = [
  {
    classUri: "ems__Task",
    displayName: "Task",
    style: {
      shape: "roundedRect",
      fillColor: 0x22c55e, // Green
      icon: "check-square",
    },
  },
  {
    classUri: "ems__Project",
    displayName: "Project",
    style: {
      shape: "hexagon",
      fillColor: 0x3b82f6, // Blue
      icon: "folder",
    },
  },
  {
    classUri: "ems__Area",
    displayName: "Area",
    style: {
      shape: "circle",
      fillColor: 0xa855f7, // Purple
      icon: "layers",
    },
  },
  {
    classUri: "ems__Person",
    displayName: "Person",
    style: {
      shape: "circle",
      fillColor: 0xf97316, // Orange
      icon: "user",
    },
  },
  {
    classUri: "ims__Concept",
    displayName: "Concept",
    style: {
      shape: "diamond",
      fillColor: 0x6b7280, // Gray
      icon: "tag",
    },
  },
];

/**
 * Shape drawing functions - draw shapes centered at (0, 0)
 */
export const SHAPE_DRAWERS: Record<
  NodeShape,
  (graphics: Graphics, radius: number) => void
> = {
  /**
   * Draw a circle
   */
  circle: (graphics: Graphics, radius: number): void => {
    graphics.circle(0, 0, radius);
  },

  /**
   * Draw a rectangle with equivalent area to a circle
   */
  rect: (graphics: Graphics, radius: number): void => {
    // Size calculated to have similar visual weight to circle
    const size = radius * 1.6;
    graphics.rect(-size / 2, -size / 2, size, size);
  },

  /**
   * Draw a rounded rectangle
   */
  roundedRect: (graphics: Graphics, radius: number): void => {
    const size = radius * 1.6;
    const cornerRadius = radius * 0.3;
    graphics.roundRect(-size / 2, -size / 2, size, size, cornerRadius);
  },

  /**
   * Draw a diamond (rotated square)
   */
  diamond: (graphics: Graphics, radius: number): void => {
    const s = radius * 1.2;
    graphics.moveTo(0, -s);
    graphics.lineTo(s, 0);
    graphics.lineTo(0, s);
    graphics.lineTo(-s, 0);
    graphics.closePath();
  },

  /**
   * Draw a hexagon
   */
  hexagon: (graphics: Graphics, radius: number): void => {
    const angleOffset = Math.PI / 6; // 30 degrees - flat top
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + angleOffset;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      if (i === 0) {
        graphics.moveTo(x, y);
      } else {
        graphics.lineTo(x, y);
      }
    }
    graphics.closePath();
  },

  /**
   * Draw an isosceles triangle pointing up
   */
  triangle: (graphics: Graphics, radius: number): void => {
    const height = radius * 1.5;
    const halfBase = radius * 1.1;
    // Center the triangle vertically
    const yOffset = height / 4;
    graphics.moveTo(0, -height / 2 - yOffset);
    graphics.lineTo(halfBase, height / 2 - yOffset);
    graphics.lineTo(-halfBase, height / 2 - yOffset);
    graphics.closePath();
  },
};

/**
 * Rendered node graphics object
 */
export interface RenderedNode {
  /** Main container for all node graphics */
  container: Container;
  /** Background/shape graphics */
  shapeGraphics: Graphics;
  /** Optional icon text */
  iconText?: Text;
  /** Node ID */
  nodeId: string;
  /** Current style */
  style: NodeVisualStyle;
  /** Whether node is currently hovered */
  isHovered: boolean;
  /** Whether node is currently selected */
  isSelected: boolean;
}

/**
 * NodeStyleResolver - Resolves node visual styles based on ontology type
 */
export class NodeStyleResolver {
  private typeConfigs: Map<string, NodeTypeConfig> = new Map();
  private defaultStyle: NodeVisualStyle;

  constructor(
    typeConfigs: NodeTypeConfig[] = DEFAULT_NODE_TYPE_CONFIGS,
    defaultStyle: NodeVisualStyle = DEFAULT_NODE_STYLE
  ) {
    this.defaultStyle = { ...defaultStyle };
    for (const config of typeConfigs) {
      this.typeConfigs.set(config.classUri, config);
    }
  }

  /**
   * Get visual style for a given ontology class
   *
   * @param ontologyClass - The ontology class URI or identifier
   * @returns Merged visual style
   */
  resolveStyle(ontologyClass?: string): NodeVisualStyle {
    if (!ontologyClass) {
      return { ...this.defaultStyle };
    }

    const config = this.typeConfigs.get(ontologyClass);
    if (!config) {
      return { ...this.defaultStyle };
    }

    return { ...this.defaultStyle, ...config.style };
  }

  /**
   * Register a new type configuration
   *
   * @param config - Node type configuration to register
   */
  registerType(config: NodeTypeConfig): void {
    this.typeConfigs.set(config.classUri, config);
  }

  /**
   * Get all registered type configurations
   */
  getTypeConfigs(): NodeTypeConfig[] {
    return Array.from(this.typeConfigs.values());
  }

  /**
   * Set the default style
   *
   * @param style - Partial style to merge with defaults
   */
  setDefaultStyle(style: Partial<NodeVisualStyle>): void {
    this.defaultStyle = { ...this.defaultStyle, ...style };
  }

  /**
   * Get the default style
   */
  getDefaultStyle(): NodeVisualStyle {
    return { ...this.defaultStyle };
  }
}

/**
 * Object pool for Graphics objects (performance optimization)
 */
class GraphicsPool {
  private pool: Graphics[] = [];
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Acquire a Graphics object from the pool
   */
  acquire(): Graphics {
    if (this.pool.length > 0) {
      const graphics = this.pool.pop()!;
      graphics.clear();
      return graphics;
    }
    return new Graphics();
  }

  /**
   * Release a Graphics object back to the pool
   */
  release(graphics: Graphics): void {
    if (this.pool.length < this.maxSize) {
      graphics.clear();
      graphics.removeFromParent();
      this.pool.push(graphics);
    } else {
      graphics.destroy();
    }
  }

  /**
   * Clear the pool and destroy all objects
   */
  clear(): void {
    for (const graphics of this.pool) {
      graphics.destroy();
    }
    this.pool = [];
  }

  /**
   * Get current pool size
   */
  size(): number {
    return this.pool.length;
  }
}

/**
 * NodeRenderer - High-performance node rendering with customizable shapes
 */
export class NodeRenderer {
  private styleResolver: NodeStyleResolver;
  private graphicsPool: GraphicsPool;
  private renderedNodes: Map<string, RenderedNode> = new Map();
  private labelFontFamily: string;
  private labelFontSize: number;

  constructor(
    styleResolver: NodeStyleResolver = new NodeStyleResolver(),
    options: {
      poolSize?: number;
      labelFontFamily?: string;
      labelFontSize?: number;
    } = {}
  ) {
    this.styleResolver = styleResolver;
    this.graphicsPool = new GraphicsPool(options.poolSize ?? 1000);
    this.labelFontFamily = options.labelFontFamily ?? "Inter, system-ui, sans-serif";
    this.labelFontSize = options.labelFontSize ?? 10;
  }

  /**
   * Draw a node shape with the given style
   *
   * @param graphics - Graphics object to draw on
   * @param style - Visual style to apply
   * @param isHovered - Whether node is hovered
   * @param isSelected - Whether node is selected
   */
  drawNodeShape(
    graphics: Graphics,
    style: NodeVisualStyle,
    isHovered: boolean = false,
    isSelected: boolean = false
  ): void {
    graphics.clear();

    const effectiveRadius = style.radius * style.radiusScale * (isHovered ? style.hoverScale : 1);

    // Get the shape drawer
    const drawer = SHAPE_DRAWERS[style.shape];
    if (!drawer) {
      // Fallback to circle if shape not found
      SHAPE_DRAWERS.circle(graphics, effectiveRadius);
    } else {
      drawer(graphics, effectiveRadius);
    }

    // Apply fill
    graphics.fill({
      color: style.fillColor,
      alpha: style.fillAlpha,
    });

    // Apply border
    if (style.borderWidth > 0) {
      const borderColor = isSelected ? style.selectedBorderColor : style.borderColor;
      const borderWidth = isSelected ? style.selectedBorderWidth : style.borderWidth;

      // Need to redraw shape for stroke
      if (drawer) {
        drawer(graphics, effectiveRadius);
      } else {
        SHAPE_DRAWERS.circle(graphics, effectiveRadius);
      }

      graphics.stroke({
        width: borderWidth,
        color: borderColor,
        alpha: isSelected ? 1 : style.borderAlpha,
      });
    }
  }

  /**
   * Create a rendered node
   *
   * @param nodeId - Unique node identifier
   * @param ontologyClass - Ontology class for style resolution
   * @param label - Node label for icon display
   * @returns Rendered node object
   */
  createNode(
    nodeId: string,
    ontologyClass?: string,
    label?: string
  ): RenderedNode {
    // Check if node already exists
    const existing = this.renderedNodes.get(nodeId);
    if (existing) {
      return existing;
    }

    const style = this.styleResolver.resolveStyle(ontologyClass);
    const container = new Container();
    const shapeGraphics = this.graphicsPool.acquire();

    // Draw initial shape
    this.drawNodeShape(shapeGraphics, style, false, false);
    container.addChild(shapeGraphics);

    // Create icon text if icon is specified
    let iconText: Text | undefined;
    if (style.icon) {
      iconText = this.createIconText(style, label);
      container.addChild(iconText);
    }

    const renderedNode: RenderedNode = {
      container,
      shapeGraphics,
      iconText,
      nodeId,
      style,
      isHovered: false,
      isSelected: false,
    };

    this.renderedNodes.set(nodeId, renderedNode);
    return renderedNode;
  }

  /**
   * Create icon text for a node
   */
  private createIconText(style: NodeVisualStyle, _label?: string): Text {
    // Map Lucide icon names to Unicode symbols (simplified for now)
    const iconMap: Record<string, string> = {
      "check-square": "✓",
      folder: "📁",
      layers: "◉",
      user: "👤",
      tag: "🏷",
    };

    const iconChar = iconMap[style.icon || ""] || "";

    const textStyle: Partial<TextStyle> = {
      fontFamily: this.labelFontFamily,
      fontSize: (style.radius * (style.iconScale || 1)) * 1.2,
      fill: style.iconColor ?? 0xffffff,
      align: "center",
    };

    const text = new Text({ text: iconChar, style: textStyle });
    text.anchor.set(0.5, 0.5);
    return text;
  }

  /**
   * Update a rendered node
   *
   * @param nodeId - Node ID to update
   * @param x - X position
   * @param y - Y position
   * @param isHovered - Whether node is hovered
   * @param isSelected - Whether node is selected
   */
  updateNode(
    nodeId: string,
    x: number,
    y: number,
    isHovered: boolean = false,
    isSelected: boolean = false
  ): void {
    const node = this.renderedNodes.get(nodeId);
    if (!node) return;

    // Update position
    node.container.position.set(x, y);

    // Update state if changed
    if (node.isHovered !== isHovered || node.isSelected !== isSelected) {
      node.isHovered = isHovered;
      node.isSelected = isSelected;
      this.drawNodeShape(node.shapeGraphics, node.style, isHovered, isSelected);
    }
  }

  /**
   * Update node style (e.g., when ontology class changes)
   *
   * @param nodeId - Node ID to update
   * @param ontologyClass - New ontology class
   */
  updateNodeStyle(nodeId: string, ontologyClass?: string): void {
    const node = this.renderedNodes.get(nodeId);
    if (!node) return;

    const newStyle = this.styleResolver.resolveStyle(ontologyClass);
    node.style = newStyle;
    this.drawNodeShape(node.shapeGraphics, newStyle, node.isHovered, node.isSelected);

    // Update icon if needed
    if (node.iconText) {
      node.container.removeChild(node.iconText);
      node.iconText.destroy();
    }

    if (newStyle.icon) {
      node.iconText = this.createIconText(newStyle);
      node.container.addChild(node.iconText);
    } else {
      node.iconText = undefined;
    }
  }

  /**
   * Remove a rendered node
   *
   * @param nodeId - Node ID to remove
   */
  removeNode(nodeId: string): void {
    const node = this.renderedNodes.get(nodeId);
    if (!node) return;

    // Release graphics to pool
    this.graphicsPool.release(node.shapeGraphics);

    // Destroy icon text
    if (node.iconText) {
      node.iconText.destroy();
    }

    // Destroy container
    node.container.destroy({ children: false });

    this.renderedNodes.delete(nodeId);
  }

  /**
   * Get a rendered node by ID
   *
   * @param nodeId - Node ID
   * @returns Rendered node or undefined
   */
  getNode(nodeId: string): RenderedNode | undefined {
    return this.renderedNodes.get(nodeId);
  }

  /**
   * Get all rendered nodes
   */
  getAllNodes(): RenderedNode[] {
    return Array.from(this.renderedNodes.values());
  }

  /**
   * Clear all rendered nodes
   */
  clear(): void {
    for (const node of this.renderedNodes.values()) {
      this.graphicsPool.release(node.shapeGraphics);
      if (node.iconText) {
        node.iconText.destroy();
      }
      node.container.destroy({ children: false });
    }
    this.renderedNodes.clear();
  }

  /**
   * Destroy the renderer and release all resources
   */
  destroy(): void {
    this.clear();
    this.graphicsPool.clear();
  }

  /**
   * Get the style resolver
   */
  getStyleResolver(): NodeStyleResolver {
    return this.styleResolver;
  }

  /**
   * Get label settings for future label rendering
   */
  getLabelSettings(): { fontFamily: string; fontSize: number } {
    return {
      fontFamily: this.labelFontFamily,
      fontSize: this.labelFontSize,
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    renderedNodeCount: number;
    poolSize: number;
  } {
    return {
      renderedNodeCount: this.renderedNodes.size,
      poolSize: this.graphicsPool.size(),
    };
  }
}

/**
 * Calculate node radius based on scaling mode
 *
 * @param mode - Scaling mode
 * @param baseRadius - Base radius value
 * @param degree - Node degree (number of connections)
 * @param pagerank - Node PageRank value
 * @param minRadius - Minimum radius
 * @param maxRadius - Maximum radius
 * @returns Calculated radius
 */
export function calculateNodeRadius(
  mode: RadiusScalingMode,
  baseRadius: number,
  degree: number = 0,
  pagerank: number = 0,
  minRadius: number = 4,
  maxRadius: number = 32
): number {
  let radius = baseRadius;

  switch (mode) {
    case "fixed":
      radius = baseRadius;
      break;

    case "degree":
      // Scale based on degree with logarithmic dampening
      radius = baseRadius + Math.log(1 + degree) * 3;
      break;

    case "pagerank":
      // Scale based on PageRank value (typically 0-1)
      radius = baseRadius + pagerank * 20;
      break;
  }

  // Clamp to min/max
  return Math.max(minRadius, Math.min(maxRadius, radius));
}
