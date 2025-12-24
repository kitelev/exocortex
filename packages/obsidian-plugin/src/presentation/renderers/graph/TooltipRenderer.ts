/**
 * TooltipRenderer - Rich tooltip rendering for graph nodes and edges
 *
 * Provides a DOM-based tooltip renderer with:
 * - Rich metadata display (title, type, properties)
 * - Relationship counts (incoming/outgoing edges)
 * - Content preview
 * - Thumbnail image support
 * - Smooth animations and positioning
 * - Theme-aware styling
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type {
  TooltipRenderer as ITooltipRenderer,
  TooltipData,
  Point,
  NodeType,
} from "./HoverManager";

/**
 * Configuration for TooltipRenderer
 */
export interface TooltipRendererConfig {
  /** Maximum width of tooltip in pixels (default: 300) */
  maxWidth: number;
  /** Maximum height of tooltip in pixels (default: 400) */
  maxHeight: number;
  /** Padding around tooltip content in pixels (default: 12) */
  padding: number;
  /** Border radius in pixels (default: 8) */
  borderRadius: number;
  /** Offset from cursor in pixels (default: 16) */
  cursorOffset: number;
  /** Animation duration in ms (default: 150) */
  animationDuration: number;
  /** Whether to show relationship counts (default: true) */
  showRelationshipCounts: boolean;
  /** Maximum number of properties to show (default: 6) */
  maxProperties: number;
  /** Maximum preview text length (default: 200) */
  maxPreviewLength: number;
  /** Z-index for tooltip (default: 1000) */
  zIndex: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: TooltipRendererConfig = {
  maxWidth: 300,
  maxHeight: 400,
  padding: 12,
  borderRadius: 8,
  cursorOffset: 16,
  animationDuration: 150,
  showRelationshipCounts: true,
  maxProperties: 6,
  maxPreviewLength: 200,
  zIndex: 1000,
};

/**
 * Type badge color mapping
 */
const TYPE_COLORS: Record<NodeType, string> = {
  task: "#22c55e",      // Green
  project: "#3b82f6",   // Blue
  area: "#8b5cf6",      // Purple
  person: "#f97316",    // Orange
  concept: "#06b6d4",   // Cyan
  asset: "#6366f1",     // Indigo
  unknown: "#64748b",   // Gray
};

/**
 * Type display names
 */
const TYPE_LABELS: Record<NodeType, string> = {
  task: "Task",
  project: "Project",
  area: "Area",
  person: "Person",
  concept: "Concept",
  asset: "Asset",
  unknown: "Unknown",
};

/**
 * Set CSS custom properties on an element
 */
function setCssProps(element: HTMLElement, props: Record<string, string>): void {
  for (const [key, value] of Object.entries(props)) {
    element.style.setProperty(key, value);
  }
}

/**
 * Create SVG arrow icon element
 */
function createArrowIcon(direction: "left" | "right"): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  if (direction === "left") {
    path.setAttribute("d", "M19 12H5M12 19l-7-7 7-7");
  } else {
    path.setAttribute("d", "M5 12h14M12 5l7 7-7 7");
  }
  svg.appendChild(path);

  return svg;
}

/**
 * TooltipRenderer - DOM-based rich tooltip for graph visualization
 *
 * @example
 * ```typescript
 * const renderer = new TooltipRenderer();
 * renderer.mount(document.body);
 *
 * renderer.show({
 *   id: "node1",
 *   title: "My Task",
 *   type: "task",
 *   properties: [{ name: "Status", value: "In Progress" }],
 *   incomingCount: 3,
 *   outgoingCount: 2,
 * }, { x: 100, y: 100 });
 *
 * renderer.hide();
 * renderer.destroy();
 * ```
 */
export class TooltipRenderer implements ITooltipRenderer {
  private config: TooltipRendererConfig;
  private container: HTMLElement | null = null;
  private element: HTMLDivElement | null = null;
  private currentData: TooltipData | null = null;
  private isShown = false;

  constructor(config?: Partial<TooltipRendererConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Mount the tooltip renderer to a container
   *
   * Styles are loaded from styles.css (Obsidian plugin convention)
   *
   * @param container - DOM element to mount tooltip into
   */
  mount(container: HTMLElement): void {
    this.container = container;
    this.createElement();
  }

  /**
   * Create the tooltip DOM element
   */
  private createElement(): void {
    if (!this.container) return;

    this.element = document.createElement("div");
    this.element.className = "exo-graph-tooltip exo-graph-tooltip--hidden";
    this.element.setAttribute("role", "tooltip");
    this.element.setAttribute("aria-hidden", "true");

    // Apply CSS custom properties for dynamic values
    setCssProps(this.element, {
      "--tooltip-max-width": `${this.config.maxWidth}px`,
      "--tooltip-max-height": `${this.config.maxHeight}px`,
      "--tooltip-padding": `${this.config.padding}px`,
      "--tooltip-border-radius": `${this.config.borderRadius}px`,
      "--tooltip-z-index": String(this.config.zIndex),
      "transition-duration": `${this.config.animationDuration}ms`,
    });

    this.container.appendChild(this.element);
  }

  /**
   * Show tooltip at position with data
   *
   * @param data - Tooltip data to display
   * @param position - Screen position for tooltip
   */
  show(data: TooltipData, position: Point): void {
    if (!this.element) return;

    this.currentData = data;
    this.renderContent(data);
    this.updatePosition(position);

    // Show with animation
    this.element.classList.remove("exo-graph-tooltip--hidden", "exo-graph-tooltip--animating-out");
    this.element.classList.add("exo-graph-tooltip--animating-in");
    this.element.setAttribute("aria-hidden", "false");

    // Force reflow for animation
    void this.element.offsetHeight;

    this.element.classList.remove("exo-graph-tooltip--animating-in");
    this.element.classList.add("exo-graph-tooltip--visible");
    this.isShown = true;
  }

  /**
   * Render tooltip content using DOM manipulation (safe from XSS)
   */
  private renderContent(data: TooltipData): void {
    if (!this.element) return;

    // Clear existing content
    while (this.element.firstChild) {
      this.element.removeChild(this.element.firstChild);
    }

    // Header with type badge
    const header = document.createElement("div");
    header.className = "exo-tooltip-header";

    const typeBadge = document.createElement("span");
    typeBadge.className = "exo-tooltip-type";
    const typeColor = TYPE_COLORS[data.type] || TYPE_COLORS.unknown;
    typeBadge.style.backgroundColor = typeColor + "20";
    typeBadge.style.color = typeColor;
    typeBadge.textContent = TYPE_LABELS[data.type] || "Unknown";
    header.appendChild(typeBadge);

    this.element.appendChild(header);

    // Title
    const title = document.createElement("div");
    title.className = "exo-tooltip-title";
    title.textContent = data.title;
    this.element.appendChild(title);

    // Thumbnail (if available)
    if (data.thumbnail) {
      const thumbnailContainer = document.createElement("div");
      thumbnailContainer.className = "exo-tooltip-thumbnail";
      const img = document.createElement("img");
      img.src = data.thumbnail;
      img.alt = "";
      thumbnailContainer.appendChild(img);
      this.element.appendChild(thumbnailContainer);
    }

    // Relationship counts
    if (this.config.showRelationshipCounts && (data.incomingCount > 0 || data.outgoingCount > 0)) {
      const relations = document.createElement("div");
      relations.className = "exo-tooltip-relations";

      if (data.incomingCount > 0) {
        const incoming = document.createElement("span");
        incoming.className = "exo-tooltip-relation";
        incoming.appendChild(createArrowIcon("left"));
        const incomingText = document.createTextNode(`${data.incomingCount} incoming`);
        incoming.appendChild(incomingText);
        relations.appendChild(incoming);
      }

      if (data.outgoingCount > 0) {
        const outgoing = document.createElement("span");
        outgoing.className = "exo-tooltip-relation";
        outgoing.appendChild(createArrowIcon("right"));
        const outgoingText = document.createTextNode(`${data.outgoingCount} outgoing`);
        outgoing.appendChild(outgoingText);
        relations.appendChild(outgoing);
      }

      this.element.appendChild(relations);
    }

    // Properties
    if (data.properties.length > 0) {
      const displayProperties = data.properties.slice(0, this.config.maxProperties);

      const propsContainer = document.createElement("div");
      propsContainer.className = "exo-tooltip-properties";

      for (const prop of displayProperties) {
        const propRow = document.createElement("div");
        propRow.className = "exo-tooltip-property";

        const propName = document.createElement("span");
        propName.className = "exo-tooltip-property-name";
        propName.textContent = prop.name;
        propRow.appendChild(propName);

        const propValue = document.createElement("span");
        propValue.className = "exo-tooltip-property-value";
        propValue.textContent = prop.value;
        propRow.appendChild(propValue);

        propsContainer.appendChild(propRow);
      }

      if (data.properties.length > this.config.maxProperties) {
        const moreProps = document.createElement("div");
        moreProps.className = "exo-tooltip-more-props";
        moreProps.textContent = `+${data.properties.length - this.config.maxProperties} more properties`;
        propsContainer.appendChild(moreProps);
      }

      this.element.appendChild(propsContainer);
    }

    // Preview text
    if (data.preview) {
      const truncatedPreview = data.preview.length > this.config.maxPreviewLength
        ? data.preview.slice(0, this.config.maxPreviewLength) + "..."
        : data.preview;

      const preview = document.createElement("div");
      preview.className = "exo-tooltip-preview";
      preview.textContent = truncatedPreview;
      this.element.appendChild(preview);
    }

    // Path hint
    if (data.path) {
      const shortPath = this.getShortPath(data.path);
      const pathHint = document.createElement("div");
      pathHint.className = "exo-tooltip-path";
      pathHint.textContent = shortPath;
      this.element.appendChild(pathHint);
    }
  }

  /**
   * Get shortened path for display
   */
  private getShortPath(path: string): string {
    // Remove common prefixes and file extension
    let shortPath = path
      .replace(/^.*\/vault-\d+\//, "")
      .replace(/\.md$/, "");

    // Truncate long paths
    if (shortPath.length > 50) {
      const parts = shortPath.split("/");
      if (parts.length > 2) {
        shortPath = parts[0] + "/.../" + parts[parts.length - 1];
      }
    }

    return shortPath;
  }

  /**
   * Update tooltip position
   *
   * @param position - New screen position
   */
  updatePosition(position: Point): void {
    if (!this.element) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Get tooltip dimensions
    const rect = this.element.getBoundingClientRect();
    const tooltipWidth = rect.width || this.config.maxWidth;
    const tooltipHeight = rect.height || 200;

    // Calculate position with cursor offset
    let x = position.x + this.config.cursorOffset;
    let y = position.y + this.config.cursorOffset;

    // Flip horizontally if would overflow right edge
    if (x + tooltipWidth > viewportWidth - 10) {
      x = position.x - tooltipWidth - this.config.cursorOffset;
    }

    // Flip vertically if would overflow bottom edge
    if (y + tooltipHeight > viewportHeight - 10) {
      y = position.y - tooltipHeight - this.config.cursorOffset;
    }

    // Ensure minimum distance from edges
    x = Math.max(10, Math.min(x, viewportWidth - tooltipWidth - 10));
    y = Math.max(10, Math.min(y, viewportHeight - tooltipHeight - 10));

    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }

  /**
   * Hide the tooltip
   */
  hide(): void {
    if (!this.element || !this.isShown) return;

    this.element.classList.remove("exo-graph-tooltip--visible");
    this.element.classList.add("exo-graph-tooltip--animating-out");
    this.element.setAttribute("aria-hidden", "true");

    // Hide after animation
    setTimeout(() => {
      if (this.element) {
        this.element.classList.remove("exo-graph-tooltip--animating-out");
        this.element.classList.add("exo-graph-tooltip--hidden");
      }
    }, this.config.animationDuration);

    this.isShown = false;
    this.currentData = null;
  }

  /**
   * Check if tooltip is visible
   */
  isVisible(): boolean {
    return this.isShown;
  }

  /**
   * Get current tooltip data
   */
  getCurrentData(): TooltipData | null {
    return this.currentData;
  }

  /**
   * Update configuration
   *
   * @param config - Partial configuration to merge
   */
  setConfig(config: Partial<TooltipRendererConfig>): void {
    this.config = { ...this.config, ...config };

    // Update CSS custom properties if element exists
    if (this.element) {
      setCssProps(this.element, {
        "--tooltip-max-width": `${this.config.maxWidth}px`,
        "--tooltip-max-height": `${this.config.maxHeight}px`,
        "--tooltip-padding": `${this.config.padding}px`,
        "--tooltip-border-radius": `${this.config.borderRadius}px`,
        "--tooltip-z-index": String(this.config.zIndex),
        "transition-duration": `${this.config.animationDuration}ms`,
      });
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): TooltipRendererConfig {
    return { ...this.config };
  }

  /**
   * Destroy the renderer and remove DOM elements
   */
  destroy(): void {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    // Don't remove shared styles since other instances might use them

    this.element = null;
    this.container = null;
    this.currentData = null;
    this.isShown = false;
  }
}

/**
 * Default TooltipRenderer configuration
 */
export const DEFAULT_TOOLTIP_RENDERER_CONFIG = DEFAULT_CONFIG;
