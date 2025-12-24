/**
 * LabelRenderer - Efficient label rendering with text sprites
 *
 * Provides high-performance label visualization for graph nodes with:
 * - Text sprites for hardware-accelerated rendering
 * - Background pills for improved readability
 * - Automatic text truncation with ellipsis
 * - Zoom-dependent visibility with smooth fading
 * - Object pooling for memory efficiency
 * - Configurable positioning and anchoring
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import { Container, Graphics, Text, type TextStyle } from "pixi.js";

import type { Position } from "./EdgeRenderer";

/**
 * Anchor position for label relative to node
 */
export type LabelAnchor =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/**
 * Label visual style configuration
 */
export interface LabelVisualStyle {
  // Typography
  /** Font family (CSS font-family value) */
  fontFamily: string;
  /** Font size in pixels */
  fontSize: number;
  /** Font weight (100-900 or "normal", "bold") */
  fontWeight: number | string;
  /** Font style */
  fontStyle: "normal" | "italic";
  /** Text color (hex number) */
  color: number;

  // Background pill
  /** Background color (hex number) */
  backgroundColor: number;
  /** Background alpha (0-1) */
  backgroundAlpha: number;
  /** Padding inside background pill (pixels) */
  padding: number;
  /** Border radius for background pill */
  borderRadius: number;
  /** Whether to show background pill */
  showBackground: boolean;

  // Position
  /** Anchor position relative to node */
  anchor: LabelAnchor;
  /** X offset from anchor position */
  offsetX: number;
  /** Y offset from anchor position */
  offsetY: number;

  // Truncation
  /** Maximum character length before truncation */
  maxLength: number;
  /** Ellipsis string for truncated text */
  ellipsis: string;

  // Zoom visibility
  /** Minimum zoom level to show labels (0-1) */
  minZoom: number;
  /** Zoom level at which labels are fully visible */
  maxZoom: number;
  /** Fade distance (zoom range for fade transition) */
  fadeRange: number;

  // States
  /** Text color when hovered (hex number) */
  hoverColor: number;
  /** Background color when hovered (hex number) */
  hoverBackgroundColor: number;
  /** Text color when selected (hex number) */
  selectedColor: number;
  /** Background color when selected (hex number) */
  selectedBackgroundColor: number;
}

/**
 * Default label visual style
 */
export const DEFAULT_LABEL_STYLE: LabelVisualStyle = {
  // Typography
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 11,
  fontWeight: 400,
  fontStyle: "normal",
  color: 0xffffff,

  // Background pill
  backgroundColor: 0x1f2937, // gray-800
  backgroundAlpha: 0.85,
  padding: 4,
  borderRadius: 4,
  showBackground: true,

  // Position
  anchor: "bottom",
  offsetX: 0,
  offsetY: 4,

  // Truncation
  maxLength: 20,
  ellipsis: "…",

  // Zoom visibility
  minZoom: 0.5,
  maxZoom: 1.0,
  fadeRange: 0.2,

  // States
  hoverColor: 0xffffff,
  hoverBackgroundColor: 0x374151, // gray-700
  selectedColor: 0xfbbf24, // amber-400
  selectedBackgroundColor: 0x1f2937, // gray-800
};

/**
 * Rendered label object
 */
export interface RenderedLabel {
  /** Main container for all label graphics */
  container: Container;
  /** Background graphics (pill shape) */
  backgroundGraphics: Graphics;
  /** Text sprite */
  textSprite: Text;
  /** Label ID (typically matches node ID) */
  labelId: string;
  /** Current style */
  style: LabelVisualStyle;
  /** Original full text (before truncation) */
  fullText: string;
  /** Displayed text (possibly truncated) */
  displayText: string;
  /** Whether label is currently hovered */
  isHovered: boolean;
  /** Whether label is currently selected */
  isSelected: boolean;
  /** Whether label is currently visible */
  isVisible: boolean;
  /** Current alpha value (for fade transitions) */
  currentAlpha: number;
}

/**
 * Viewport state for zoom-based visibility
 */
export interface ViewportInfo {
  /** Current zoom level */
  zoom: number;
  /** Viewport bounds */
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

/**
 * Object pool for Text objects (performance optimization)
 */
class TextPool {
  private pool: Text[] = [];
  private maxSize: number;

  constructor(maxSize: number = 500) {
    this.maxSize = maxSize;
  }

  /**
   * Acquire a Text object from the pool
   */
  acquire(text: string, style: Partial<TextStyle>): Text {
    const pooled = this.pool.pop();
    if (pooled) {
      pooled.text = text;
      pooled.style = style as TextStyle;
      pooled.visible = true;
      pooled.alpha = 1;
      return pooled;
    }
    return new Text({ text, style: style as TextStyle });
  }

  /**
   * Release a Text object back to the pool
   */
  release(textObj: Text): void {
    if (this.pool.length < this.maxSize) {
      textObj.visible = false;
      textObj.removeFromParent();
      this.pool.push(textObj);
    } else {
      textObj.destroy();
    }
  }

  /**
   * Clear the pool and destroy all objects
   */
  clear(): void {
    for (const textObj of this.pool) {
      textObj.destroy();
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
 * Object pool for Graphics objects (performance optimization)
 */
class GraphicsPool {
  private pool: Graphics[] = [];
  private maxSize: number;

  constructor(maxSize: number = 500) {
    this.maxSize = maxSize;
  }

  /**
   * Acquire a Graphics object from the pool
   */
  acquire(): Graphics {
    const pooled = this.pool.pop();
    if (pooled) {
      pooled.clear();
      return pooled;
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
 * LabelStyleResolver - Resolves label visual styles based on node type
 */
export class LabelStyleResolver {
  private defaultStyle: LabelVisualStyle;
  private typeStyles: Map<string, Partial<LabelVisualStyle>> = new Map();

  constructor(defaultStyle: LabelVisualStyle = DEFAULT_LABEL_STYLE) {
    this.defaultStyle = { ...defaultStyle };
  }

  /**
   * Get visual style for a given node type
   *
   * @param nodeType - The node type identifier (optional)
   * @returns Merged visual style
   */
  resolveStyle(nodeType?: string): LabelVisualStyle {
    if (!nodeType) {
      return { ...this.defaultStyle };
    }

    const typeStyle = this.typeStyles.get(nodeType);
    if (!typeStyle) {
      return { ...this.defaultStyle };
    }

    return { ...this.defaultStyle, ...typeStyle };
  }

  /**
   * Register a style override for a node type
   *
   * @param nodeType - Node type identifier
   * @param style - Partial style to apply
   */
  registerTypeStyle(nodeType: string, style: Partial<LabelVisualStyle>): void {
    this.typeStyles.set(nodeType, style);
  }

  /**
   * Set the default style
   *
   * @param style - Partial style to merge with defaults
   */
  setDefaultStyle(style: Partial<LabelVisualStyle>): void {
    this.defaultStyle = { ...this.defaultStyle, ...style };
  }

  /**
   * Get the default style
   */
  getDefaultStyle(): LabelVisualStyle {
    return { ...this.defaultStyle };
  }
}

/**
 * LabelRenderer - High-performance label rendering with text sprites
 */
export class LabelRenderer {
  private styleResolver: LabelStyleResolver;
  private textPool: TextPool;
  private graphicsPool: GraphicsPool;
  private renderedLabels: Map<string, RenderedLabel> = new Map();
  private currentViewport: ViewportInfo = {
    zoom: 1,
    bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
  };

  constructor(
    styleResolver: LabelStyleResolver = new LabelStyleResolver(),
    options: {
      textPoolSize?: number;
      graphicsPoolSize?: number;
    } = {}
  ) {
    this.styleResolver = styleResolver;
    this.textPool = new TextPool(options.textPoolSize ?? 500);
    this.graphicsPool = new GraphicsPool(options.graphicsPoolSize ?? 500);
  }

  /**
   * Truncate text to specified maximum length
   *
   * @param text - Full text to truncate
   * @param maxLength - Maximum character length
   * @param ellipsis - Ellipsis string to append
   * @returns Truncated text
   */
  truncateText(text: string, maxLength: number, ellipsis: string): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - ellipsis.length) + ellipsis;
  }

  /**
   * Calculate label position based on anchor and offset
   *
   * @param nodePosition - Node center position
   * @param nodeRadius - Node radius
   * @param style - Label style
   * @returns Label position
   */
  calculateLabelPosition(
    nodePosition: Position,
    nodeRadius: number,
    style: LabelVisualStyle
  ): Position {
    let x = nodePosition.x + style.offsetX;
    let y = nodePosition.y + style.offsetY;

    // Apply anchor-based positioning
    switch (style.anchor) {
      case "top":
        y = nodePosition.y - nodeRadius - style.offsetY;
        break;
      case "bottom":
        y = nodePosition.y + nodeRadius + style.offsetY;
        break;
      case "left":
        x = nodePosition.x - nodeRadius - style.offsetX;
        break;
      case "right":
        x = nodePosition.x + nodeRadius + style.offsetX;
        break;
      case "top-left":
        x = nodePosition.x - nodeRadius - style.offsetX;
        y = nodePosition.y - nodeRadius - style.offsetY;
        break;
      case "top-right":
        x = nodePosition.x + nodeRadius + style.offsetX;
        y = nodePosition.y - nodeRadius - style.offsetY;
        break;
      case "bottom-left":
        x = nodePosition.x - nodeRadius - style.offsetX;
        y = nodePosition.y + nodeRadius + style.offsetY;
        break;
      case "bottom-right":
        x = nodePosition.x + nodeRadius + style.offsetX;
        y = nodePosition.y + nodeRadius + style.offsetY;
        break;
      case "center":
      default:
        // Center is already at node position with offsets applied
        break;
    }

    return { x, y };
  }

  /**
   * Calculate label alpha based on zoom level
   *
   * @param zoom - Current zoom level
   * @param style - Label style with zoom settings
   * @returns Alpha value (0-1)
   */
  calculateZoomAlpha(zoom: number, style: LabelVisualStyle): number {
    if (zoom < style.minZoom) {
      return 0;
    }

    if (zoom >= style.maxZoom) {
      return 1;
    }

    // Fade in as zoom increases from minZoom to (minZoom + fadeRange)
    const fadeStart = style.minZoom;
    const fadeEnd = Math.min(style.minZoom + style.fadeRange, style.maxZoom);

    if (zoom >= fadeEnd) {
      return 1;
    }

    // Linear interpolation for fade
    return (zoom - fadeStart) / (fadeEnd - fadeStart);
  }

  /**
   * Check if a position is within the viewport bounds
   *
   * @param position - Position to check
   * @param margin - Extra margin for culling
   * @returns Whether position is visible
   */
  isInViewport(position: Position, margin: number = 100): boolean {
    const { bounds } = this.currentViewport;
    return (
      position.x >= bounds.minX - margin &&
      position.x <= bounds.maxX + margin &&
      position.y >= bounds.minY - margin &&
      position.y <= bounds.maxY + margin
    );
  }

  /**
   * Draw background pill for label
   *
   * @param graphics - Graphics object to draw on
   * @param textWidth - Width of text
   * @param textHeight - Height of text
   * @param style - Label style
   * @param isHovered - Whether label is hovered
   * @param isSelected - Whether label is selected
   */
  drawBackground(
    graphics: Graphics,
    textWidth: number,
    textHeight: number,
    style: LabelVisualStyle,
    isHovered: boolean = false,
    isSelected: boolean = false
  ): void {
    graphics.clear();

    if (!style.showBackground) {
      return;
    }

    const padding = style.padding;
    const width = textWidth + padding * 2;
    const height = textHeight + padding * 2;

    // Determine color based on state
    let bgColor = style.backgroundColor;
    if (isSelected) {
      bgColor = style.selectedBackgroundColor;
    } else if (isHovered) {
      bgColor = style.hoverBackgroundColor;
    }

    // Draw rounded rectangle background
    graphics.roundRect(-width / 2, -height / 2, width, height, style.borderRadius);
    graphics.fill({
      color: bgColor,
      alpha: style.backgroundAlpha,
    });
  }

  /**
   * Create a rendered label
   *
   * @param labelId - Unique label identifier
   * @param text - Label text
   * @param nodeType - Node type for style resolution (optional)
   * @returns Rendered label object
   */
  createLabel(labelId: string, text: string, nodeType?: string): RenderedLabel {
    // Check if label already exists
    const existing = this.renderedLabels.get(labelId);
    if (existing) {
      return existing;
    }

    const style = this.styleResolver.resolveStyle(nodeType);

    // Truncate text if needed
    const displayText = this.truncateText(text, style.maxLength, style.ellipsis);

    // Create container
    const container = new Container();

    // Create text sprite
    // fontWeight must be a string for PixiJS ("normal", "bold", or "100"-"900")
    const fontWeightStr = typeof style.fontWeight === "number"
      ? String(style.fontWeight) as "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900"
      : style.fontWeight as "normal" | "bold" | "bolder" | "lighter";
    const textStyle: Partial<TextStyle> = {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: fontWeightStr,
      fontStyle: style.fontStyle,
      fill: style.color,
      align: "center",
    };
    const textSprite = this.textPool.acquire(displayText, textStyle);
    textSprite.anchor.set(0.5, 0.5);

    // Create background graphics
    const backgroundGraphics = this.graphicsPool.acquire();

    // Measure text and draw background
    // Note: In pixi.js v8, we need to get dimensions from the text bounds
    const textBounds = textSprite.getBounds();
    const textWidth = textBounds.width || style.fontSize * displayText.length * 0.6;
    const textHeight = textBounds.height || style.fontSize * 1.2;

    this.drawBackground(backgroundGraphics, textWidth, textHeight, style, false, false);

    // Add to container (background first, then text)
    container.addChild(backgroundGraphics);
    container.addChild(textSprite);

    const renderedLabel: RenderedLabel = {
      container,
      backgroundGraphics,
      textSprite,
      labelId,
      style,
      fullText: text,
      displayText,
      isHovered: false,
      isSelected: false,
      isVisible: true,
      currentAlpha: 1,
    };

    this.renderedLabels.set(labelId, renderedLabel);
    return renderedLabel;
  }

  /**
   * Update a rendered label
   *
   * @param labelId - Label ID to update
   * @param position - Label position
   * @param isHovered - Whether label is hovered
   * @param isSelected - Whether label is selected
   */
  updateLabel(
    labelId: string,
    position: Position,
    isHovered: boolean = false,
    isSelected: boolean = false
  ): void {
    const label = this.renderedLabels.get(labelId);
    if (!label) return;

    // Update position
    label.container.position.set(position.x, position.y);

    // Calculate visibility based on zoom
    const alpha = this.calculateZoomAlpha(this.currentViewport.zoom, label.style);
    const isInView = this.isInViewport(position);
    const shouldBeVisible = alpha > 0 && isInView;

    // Update visibility
    if (shouldBeVisible !== label.isVisible) {
      label.isVisible = shouldBeVisible;
      label.container.visible = shouldBeVisible;
    }

    // Update alpha for fade effect
    if (shouldBeVisible && Math.abs(alpha - label.currentAlpha) > 0.01) {
      label.currentAlpha = alpha;
      label.container.alpha = alpha;
    }

    // Update state if changed
    if (
      shouldBeVisible &&
      (label.isHovered !== isHovered || label.isSelected !== isSelected)
    ) {
      label.isHovered = isHovered;
      label.isSelected = isSelected;

      // Update text color
      let textColor = label.style.color;
      if (isSelected) {
        textColor = label.style.selectedColor;
      } else if (isHovered) {
        textColor = label.style.hoverColor;
      }
      label.textSprite.style.fill = textColor;

      // Redraw background
      const textBounds = label.textSprite.getBounds();
      const textWidth =
        textBounds.width || label.style.fontSize * label.displayText.length * 0.6;
      const textHeight = textBounds.height || label.style.fontSize * 1.2;
      this.drawBackground(
        label.backgroundGraphics,
        textWidth,
        textHeight,
        label.style,
        isHovered,
        isSelected
      );
    }
  }

  /**
   * Update label text
   *
   * @param labelId - Label ID to update
   * @param text - New text
   */
  updateLabelText(labelId: string, text: string): void {
    const label = this.renderedLabels.get(labelId);
    if (!label) return;

    if (label.fullText === text) return;

    label.fullText = text;
    label.displayText = this.truncateText(text, label.style.maxLength, label.style.ellipsis);
    label.textSprite.text = label.displayText;

    // Redraw background with new text dimensions
    const textBounds = label.textSprite.getBounds();
    const textWidth =
      textBounds.width || label.style.fontSize * label.displayText.length * 0.6;
    const textHeight = textBounds.height || label.style.fontSize * 1.2;
    this.drawBackground(
      label.backgroundGraphics,
      textWidth,
      textHeight,
      label.style,
      label.isHovered,
      label.isSelected
    );
  }

  /**
   * Update viewport for zoom-based visibility
   *
   * @param viewport - New viewport state
   */
  updateViewport(viewport: ViewportInfo): void {
    this.currentViewport = viewport;

    // Update all labels with new zoom level
    for (const label of this.renderedLabels.values()) {
      const alpha = this.calculateZoomAlpha(viewport.zoom, label.style);
      const shouldBeVisible = alpha > 0;

      if (shouldBeVisible !== label.isVisible) {
        label.isVisible = shouldBeVisible;
        label.container.visible = shouldBeVisible;
      }

      if (shouldBeVisible && Math.abs(alpha - label.currentAlpha) > 0.01) {
        label.currentAlpha = alpha;
        label.container.alpha = alpha;
      }
    }
  }

  /**
   * Batch update multiple labels
   *
   * @param updates - Array of label updates
   */
  batchUpdate(
    updates: Array<{
      labelId: string;
      position: Position;
      isHovered?: boolean;
      isSelected?: boolean;
    }>
  ): void {
    for (const update of updates) {
      this.updateLabel(
        update.labelId,
        update.position,
        update.isHovered ?? false,
        update.isSelected ?? false
      );
    }
  }

  /**
   * Remove a rendered label
   *
   * @param labelId - Label ID to remove
   */
  removeLabel(labelId: string): void {
    const label = this.renderedLabels.get(labelId);
    if (!label) return;

    // Release resources to pools
    this.textPool.release(label.textSprite);
    this.graphicsPool.release(label.backgroundGraphics);

    // Destroy container
    label.container.destroy({ children: false });

    this.renderedLabels.delete(labelId);
  }

  /**
   * Get a rendered label by ID
   *
   * @param labelId - Label ID
   * @returns Rendered label or undefined
   */
  getLabel(labelId: string): RenderedLabel | undefined {
    return this.renderedLabels.get(labelId);
  }

  /**
   * Get all rendered labels
   */
  getAllLabels(): RenderedLabel[] {
    return Array.from(this.renderedLabels.values());
  }

  /**
   * Get visible labels (based on current zoom and viewport)
   */
  getVisibleLabels(): RenderedLabel[] {
    return Array.from(this.renderedLabels.values()).filter((label) => label.isVisible);
  }

  /**
   * Clear all rendered labels
   */
  clear(): void {
    for (const label of this.renderedLabels.values()) {
      this.textPool.release(label.textSprite);
      this.graphicsPool.release(label.backgroundGraphics);
      label.container.destroy({ children: false });
    }
    this.renderedLabels.clear();
  }

  /**
   * Destroy the renderer and release all resources
   */
  destroy(): void {
    this.clear();
    this.textPool.clear();
    this.graphicsPool.clear();
  }

  /**
   * Get the style resolver
   */
  getStyleResolver(): LabelStyleResolver {
    return this.styleResolver;
  }

  /**
   * Get current viewport info
   */
  getViewport(): ViewportInfo {
    return { ...this.currentViewport };
  }

  /**
   * Get statistics
   */
  getStats(): {
    renderedLabelCount: number;
    visibleLabelCount: number;
    textPoolSize: number;
    graphicsPoolSize: number;
    currentZoom: number;
  } {
    const visibleCount = Array.from(this.renderedLabels.values()).filter(
      (l) => l.isVisible
    ).length;

    return {
      renderedLabelCount: this.renderedLabels.size,
      visibleLabelCount: visibleCount,
      textPoolSize: this.textPool.size(),
      graphicsPoolSize: this.graphicsPool.size(),
      currentZoom: this.currentViewport.zoom,
    };
  }
}

/**
 * Helper function to calculate optimal label position avoiding node overlap
 *
 * @param nodePosition - Node center position
 * @param nodeRadius - Node radius
 * @param preferredAnchor - Preferred anchor position
 * @param offsetY - Vertical offset (default: 4)
 * @returns Calculated label position and actual anchor used
 */
export function calculateOptimalLabelPosition(
  nodePosition: Position,
  nodeRadius: number,
  preferredAnchor: LabelAnchor = "bottom",
  offsetY: number = 4
): { position: Position; anchor: LabelAnchor } {
  const position: Position = {
    x: nodePosition.x,
    y: nodePosition.y,
  };

  switch (preferredAnchor) {
    case "top":
      position.y = nodePosition.y - nodeRadius - offsetY;
      break;
    case "bottom":
      position.y = nodePosition.y + nodeRadius + offsetY;
      break;
    case "left":
      position.x = nodePosition.x - nodeRadius - offsetY;
      break;
    case "right":
      position.x = nodePosition.x + nodeRadius + offsetY;
      break;
    case "center":
    default:
      // Center stays at node position
      break;
  }

  return { position, anchor: preferredAnchor };
}
