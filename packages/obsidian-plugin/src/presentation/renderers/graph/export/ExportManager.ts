/**
 * ExportManager - Graph export functionality for PNG, JPEG, WebP, and SVG formats
 *
 * Provides high-quality graph export with:
 * - High-DPI display support with configurable scale factor
 * - Multiple format support (PNG, JPEG, WebP, SVG)
 * - Custom background colors or transparency
 * - Configurable padding and bounds
 * - Metadata embedding for PNG and SVG
 * - Progress events for long exports
 *
 * @module presentation/renderers/graph/export
 * @since 1.0.0
 */

import type {
  ExportOptions,
  ExportResult,
  ExportBounds,
  ExportNode,
  ExportEdge,
  ExportEvent,
  ExportEventListener,
  ExportManagerConfig,
  ExportStats,
} from "./ExportTypes";

import {
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_EXPORT_MANAGER_CONFIG,
  EXPORT_MIME_TYPES,
  EXPORT_FILE_EXTENSIONS,
} from "./ExportTypes";

/**
 * ExportManager - Handles graph export to various image formats
 *
 * @example
 * ```typescript
 * const exportManager = new ExportManager();
 *
 * // Export graph as PNG
 * const result = await exportManager.export(nodes, edges, {
 *   format: "png",
 *   scale: 2,
 *   backgroundColor: "#ffffff",
 *   padding: 50,
 * });
 *
 * // Download the file
 * exportManager.download(result, "my-graph");
 *
 * // Or get data URL for display
 * const img = document.createElement("img");
 * img.src = result.dataUrl;
 * ```
 */
export class ExportManager {
  private config: ExportManagerConfig;
  private listeners: Set<ExportEventListener> = new Set();
  private stats: ExportStats = {
    totalExports: 0,
    successfulExports: 0,
    failedExports: 0,
    averageDuration: 0,
  };
  private abortController: AbortController | null = null;

  constructor(config: Partial<ExportManagerConfig> = {}) {
    this.config = {
      ...DEFAULT_EXPORT_MANAGER_CONFIG,
      ...config,
      defaultOptions: {
        ...DEFAULT_EXPORT_MANAGER_CONFIG.defaultOptions,
        ...config.defaultOptions,
      },
    };
  }

  /**
   * Export graph to specified format
   *
   * @param nodes - Array of nodes to export
   * @param edges - Array of edges to export
   * @param options - Export options
   * @returns Promise resolving to export result
   */
  async export(
    nodes: ExportNode[],
    edges: ExportEdge[],
    options: Partial<ExportOptions> = {}
  ): Promise<ExportResult> {
    const startTime = Date.now();
    this.stats.totalExports++;

    const mergedOptions: ExportOptions = {
      ...DEFAULT_EXPORT_OPTIONS,
      ...this.config.defaultOptions,
      ...options,
    };

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    try {
      this.emitEvent({ type: "start", timestamp: Date.now() });

      // Calculate bounds if not provided
      const bounds =
        mergedOptions.customBounds ??
        this.calculateBounds(nodes, mergedOptions.padding);

      // Validate dimensions
      this.validateDimensions(bounds, mergedOptions.scale);

      let result: ExportResult;

      if (mergedOptions.format === "svg") {
        result = await this.exportSVG(nodes, edges, bounds, mergedOptions);
      } else {
        result = await this.exportRaster(nodes, edges, bounds, mergedOptions);
      }

      // Update stats
      const duration = Date.now() - startTime;
      this.stats.successfulExports++;
      this.stats.lastExportTime = Date.now();
      this.stats.averageDuration =
        (this.stats.averageDuration * (this.stats.successfulExports - 1) +
          duration) /
        this.stats.successfulExports;

      this.emitEvent({
        type: "complete",
        result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      this.stats.failedExports++;
      const err = error instanceof Error ? error : new Error(String(error));

      this.emitEvent({
        type: "error",
        error: err,
        timestamp: Date.now(),
      });

      throw err;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel ongoing export operation
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.emitEvent({ type: "cancel", timestamp: Date.now() });
    }
  }

  /**
   * Download export result as file
   *
   * @param result - Export result to download
   * @param filename - Filename without extension (default: "graph-export")
   */
  download(result: ExportResult, filename?: string): void {
    const name = filename ?? "graph-export";
    const extension = EXPORT_FILE_EXTENSIONS[result.format];
    const fullFilename = `${name}${extension}`;

    const link = document.createElement("a");
    link.href = result.dataUrl;
    link.download = fullFilename;
    link.classList.add("exo-graph-export-hidden-link");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Copy export result to clipboard
   *
   * @param result - Export result to copy
   * @returns Promise resolving when copy is complete
   */
  async copyToClipboard(result: ExportResult): Promise<void> {
    if (result.format === "svg") {
      // For SVG, copy as text
      const text = await result.blob.text();
      await navigator.clipboard.writeText(text);
    } else {
      // For raster formats, copy as image
      await navigator.clipboard.write([
        new ClipboardItem({
          [result.blob.type]: result.blob,
        }),
      ]);
    }
  }

  /**
   * Add event listener
   *
   * @param listener - Event listener function
   */
  addEventListener(listener: ExportEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove event listener
   *
   * @param listener - Event listener function
   */
  removeEventListener(listener: ExportEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Get export statistics
   *
   * @returns Export statistics
   */
  getStats(): ExportStats {
    return { ...this.stats };
  }

  /**
   * Reset export statistics
   */
  resetStats(): void {
    this.stats = {
      totalExports: 0,
      successfulExports: 0,
      failedExports: 0,
      averageDuration: 0,
    };
  }

  /**
   * Calculate bounds encompassing all nodes
   */
  private calculateBounds(nodes: ExportNode[], padding: number): ExportBounds {
    if (nodes.length === 0) {
      return { x: 0, y: 0, width: 100, height: 100 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
      const radius = node.radius ?? 8;
      minX = Math.min(minX, node.x - radius);
      minY = Math.min(minY, node.y - radius);
      maxX = Math.max(maxX, node.x + radius);
      maxY = Math.max(maxY, node.y + radius);
    }

    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };
  }

  /**
   * Validate export dimensions
   */
  private validateDimensions(bounds: ExportBounds, scale: number): void {
    const scaledWidth = bounds.width * scale;
    const scaledHeight = bounds.height * scale;

    if (
      scaledWidth > this.config.maxDimension ||
      scaledHeight > this.config.maxDimension
    ) {
      throw new Error(
        `Export dimensions (${scaledWidth}x${scaledHeight}) exceed maximum allowed (${this.config.maxDimension}px). ` +
          `Try reducing scale or using custom bounds.`
      );
    }

    if (bounds.width <= 0 || bounds.height <= 0) {
      throw new Error("Export dimensions must be positive");
    }
  }

  /**
   * Export to raster format (PNG, JPEG, WebP)
   */
  private async exportRaster(
    nodes: ExportNode[],
    edges: ExportEdge[],
    bounds: ExportBounds,
    options: ExportOptions
  ): Promise<ExportResult> {
    const width = Math.ceil(bounds.width * options.scale);
    const height = Math.ceil(bounds.height * options.scale);

    // Create offscreen canvas
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create canvas context");
    }

    // Apply scale transform
    ctx.scale(options.scale, options.scale);

    // Draw background
    if (options.backgroundColor) {
      ctx.fillStyle = options.backgroundColor;
      ctx.fillRect(0, 0, bounds.width, bounds.height);
    }

    // Translate to center graph in canvas
    ctx.translate(-bounds.x, -bounds.y);

    this.emitEvent({ type: "progress", progress: 10, timestamp: Date.now() });

    // Draw edges
    if (options.includeEdges) {
      this.drawEdges(ctx, nodes, edges, options);
    }

    this.emitEvent({ type: "progress", progress: 40, timestamp: Date.now() });

    // Draw nodes
    this.drawNodes(ctx, nodes, options);

    this.emitEvent({ type: "progress", progress: 70, timestamp: Date.now() });

    // Draw labels
    if (options.includeLabels) {
      this.drawLabels(ctx, nodes, options);
    }

    this.emitEvent({ type: "progress", progress: 90, timestamp: Date.now() });

    // Convert to blob
    const mimeType = EXPORT_MIME_TYPES[options.format];
    const blob = await this.canvasToBlob(
      canvas,
      mimeType,
      options.format === "jpeg" || options.format === "webp"
        ? options.quality
        : undefined
    );

    const dataUrl = canvas.toDataURL(
      mimeType,
      options.format === "jpeg" || options.format === "webp"
        ? options.quality
        : undefined
    );

    return {
      blob,
      dataUrl,
      width,
      height,
      format: options.format,
      fileSize: blob.size,
    };
  }

  /**
   * Export to SVG format
   */
  private async exportSVG(
    nodes: ExportNode[],
    edges: ExportEdge[],
    bounds: ExportBounds,
    options: ExportOptions
  ): Promise<ExportResult> {
    const width = Math.ceil(bounds.width);
    const height = Math.ceil(bounds.height);

    const svgParts: string[] = [];

    // SVG header
    svgParts.push(
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" `,
      `width="${width * options.scale}" height="${height * options.scale}" `,
      `viewBox="${bounds.x} ${bounds.y} ${width} ${height}">`
    );

    // Metadata
    if (options.metadata) {
      svgParts.push(`<metadata>`);
      for (const [key, value] of Object.entries(options.metadata)) {
        svgParts.push(`<${key}>${this.escapeXml(value)}</${key}>`);
      }
      svgParts.push(`</metadata>`);
    }

    // Defs for gradients/filters
    svgParts.push(`<defs>`);
    svgParts.push(`<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">`);
    svgParts.push(`<feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.2"/>`);
    svgParts.push(`</filter>`);
    svgParts.push(`</defs>`);

    // Background
    if (options.backgroundColor) {
      svgParts.push(
        `<rect x="${bounds.x}" y="${bounds.y}" width="${width}" height="${height}" `,
        `fill="${options.backgroundColor}"/>`
      );
    }

    this.emitEvent({ type: "progress", progress: 20, timestamp: Date.now() });

    // Create node map for edge lookups
    const nodeMap = new Map<string, ExportNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    // Draw edges
    if (options.includeEdges) {
      svgParts.push(`<g class="edges">`);
      for (const edge of edges) {
        const source = nodeMap.get(edge.sourceId);
        const target = nodeMap.get(edge.targetId);
        if (source && target) {
          const color = this.normalizeColor(edge.color ?? 0x64748b);
          const strokeWidth = edge.width ?? 1;
          svgParts.push(
            `<line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" `,
            `stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="0.6"/>`
          );
        }
      }
      svgParts.push(`</g>`);
    }

    this.emitEvent({ type: "progress", progress: 50, timestamp: Date.now() });

    // Draw nodes
    svgParts.push(`<g class="nodes">`);
    for (const node of nodes) {
      const color = this.normalizeColor(node.color ?? 0x6366f1);
      const radius = node.radius ?? 8;
      svgParts.push(
        `<circle cx="${node.x}" cy="${node.y}" r="${radius}" `,
        `fill="${color}" filter="url(#shadow)"/>`
      );
    }
    svgParts.push(`</g>`);

    this.emitEvent({ type: "progress", progress: 70, timestamp: Date.now() });

    // Draw labels
    if (options.includeLabels) {
      svgParts.push(`<g class="labels">`);
      for (const node of nodes) {
        const radius = node.radius ?? 8;
        svgParts.push(
          `<text x="${node.x}" y="${node.y + radius + 14}" `,
          `text-anchor="middle" font-family="Inter, system-ui, sans-serif" `,
          `font-size="12" fill="#e2e8f0">${this.escapeXml(node.label)}</text>`
        );
      }
      svgParts.push(`</g>`);
    }

    svgParts.push(`</svg>`);

    this.emitEvent({ type: "progress", progress: 90, timestamp: Date.now() });

    const svgString = svgParts.join("");
    const blob = new Blob([svgString], { type: EXPORT_MIME_TYPES.svg });
    const dataUrl = `data:${EXPORT_MIME_TYPES.svg};charset=utf-8,${encodeURIComponent(svgString)}`;

    return {
      blob,
      dataUrl,
      width: width * options.scale,
      height: height * options.scale,
      format: "svg",
      fileSize: blob.size,
    };
  }

  /**
   * Draw edges on canvas context
   */
  private drawEdges(
    ctx: CanvasRenderingContext2D,
    nodes: ExportNode[],
    edges: ExportEdge[],
    _options: ExportOptions
  ): void {
    const nodeMap = new Map<string, ExportNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    ctx.lineCap = "round";

    for (const edge of edges) {
      const source = nodeMap.get(edge.sourceId);
      const target = nodeMap.get(edge.targetId);

      if (source && target) {
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.strokeStyle = this.normalizeColor(edge.color ?? 0x64748b);
        ctx.lineWidth = edge.width ?? 1;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * Draw nodes on canvas context
   */
  private drawNodes(
    ctx: CanvasRenderingContext2D,
    nodes: ExportNode[],
    _options: ExportOptions
  ): void {
    // Draw shadows first
    ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    for (const node of nodes) {
      const radius = node.radius ?? 8;
      const color = this.normalizeColor(node.color ?? 0x6366f1);

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Reset shadow
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  /**
   * Draw labels on canvas context
   */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    nodes: ExportNode[],
    _options: ExportOptions
  ): void {
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#e2e8f0";

    for (const node of nodes) {
      const radius = node.radius ?? 8;
      ctx.fillText(node.label, node.x, node.y + radius + 4);
    }
  }

  /**
   * Convert canvas to blob with promise wrapper
   */
  private canvasToBlob(
    canvas: HTMLCanvasElement,
    mimeType: string,
    quality?: number
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create blob from canvas"));
          }
        },
        mimeType,
        quality
      );
    });
  }

  /**
   * Normalize color to hex string
   */
  private normalizeColor(color: number | string | undefined): string {
    if (typeof color === "string") {
      return color;
    }
    if (typeof color === "number") {
      return `#${color.toString(16).padStart(6, "0")}`;
    }
    return "#6366f1";
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: ExportEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }
}

/**
 * Create a new ExportManager instance
 *
 * @param config - Optional configuration
 * @returns New ExportManager instance
 */
export function createExportManager(
  config?: Partial<ExportManagerConfig>
): ExportManager {
  return new ExportManager(config);
}
