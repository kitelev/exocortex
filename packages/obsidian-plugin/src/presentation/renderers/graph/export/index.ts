/**
 * Graph Export Module
 *
 * Provides comprehensive graph export functionality supporting multiple formats:
 * - PNG: High-quality raster with transparency support
 * - JPEG: Lossy compression for smaller file sizes
 * - WebP: Modern format with excellent compression
 * - SVG: Vector format for infinite scalability
 *
 * Features:
 * - High-DPI display support with configurable scale factor
 * - Custom background colors or transparency
 * - Configurable padding and bounds
 * - Metadata embedding for PNG and SVG
 * - Progress events for long exports
 * - Download and clipboard copy utilities
 *
 * @module presentation/renderers/graph/export
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { ExportManager, createExportManager } from "./export";
 *
 * // Create export manager
 * const exportManager = createExportManager();
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
 * // Or copy to clipboard
 * await exportManager.copyToClipboard(result);
 * ```
 */

// Export types
export type {
  ExportFormat,
  ExportOptions,
  ExportBounds,
  ExportResult,
  ExportNode,
  ExportEdge,
  ExportEventType,
  ExportEvent,
  ExportEventListener,
  ExportManagerConfig,
  ExportStats,
} from "./ExportTypes";

// Export constants
export {
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_EXPORT_MANAGER_CONFIG,
  EXPORT_MIME_TYPES,
  EXPORT_FILE_EXTENSIONS,
} from "./ExportTypes";

// Export manager
export { ExportManager, createExportManager } from "./ExportManager";
