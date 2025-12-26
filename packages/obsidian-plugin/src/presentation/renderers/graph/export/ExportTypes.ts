/**
 * Export Types
 *
 * Type definitions for graph export functionality supporting PNG, JPEG, WebP, and SVG formats.
 *
 * @module presentation/renderers/graph/export
 * @since 1.0.0
 */

/**
 * Supported export formats
 */
export type ExportFormat = "png" | "jpeg" | "webp" | "svg";

/**
 * Export options for configuring graph export
 */
export interface ExportOptions {
  /** Output format (default: "png") */
  format: ExportFormat;

  /** Quality for lossy formats (0-1, default: 0.92) */
  quality: number;

  /** DPI scale factor (default: window.devicePixelRatio || 1) */
  scale: number;

  /** Background color (hex string) or null for transparent (default: "#ffffff") */
  backgroundColor: string | null;

  /** Padding around the graph in pixels (default: 50) */
  padding: number;

  /** Whether to include node labels in export (default: true) */
  includeLabels: boolean;

  /** Whether to include edges in export (default: true) */
  includeEdges: boolean;

  /** Custom bounds for export (optional - uses calculated bounds by default) */
  customBounds?: ExportBounds;

  /** Custom metadata to embed in export (optional) */
  metadata?: Record<string, string>;

  /** Filename for download (optional, default: "graph-export") */
  filename?: string;
}

/**
 * Custom bounding box for export
 */
export interface ExportBounds {
  /** X coordinate of top-left corner */
  x: number;

  /** Y coordinate of top-left corner */
  y: number;

  /** Width of export area */
  width: number;

  /** Height of export area */
  height: number;
}

/**
 * Result of an export operation
 */
export interface ExportResult {
  /** Blob containing the exported data */
  blob: Blob;

  /** Data URL for the exported image */
  dataUrl: string;

  /** Width of the exported image in pixels */
  width: number;

  /** Height of the exported image in pixels */
  height: number;

  /** Format of the exported image */
  format: ExportFormat;

  /** File size in bytes */
  fileSize: number;
}

/**
 * Node data for export (minimal required properties)
 */
export interface ExportNode {
  /** Unique node identifier */
  id: string;

  /** Node label for display */
  label: string;

  /** X coordinate in world space */
  x: number;

  /** Y coordinate in world space */
  y: number;

  /** Node radius (optional, default based on style) */
  radius?: number;

  /** Node color as hex number or string */
  color?: number | string;

  /** Node group/type for styling */
  group?: string;
}

/**
 * Edge data for export (minimal required properties)
 */
export interface ExportEdge {
  /** Unique edge identifier */
  id: string;

  /** Source node ID */
  sourceId: string;

  /** Target node ID */
  targetId: string;

  /** Edge label (optional) */
  label?: string;

  /** Edge color as hex number or string */
  color?: number | string;

  /** Edge width in pixels (optional) */
  width?: number;
}

/**
 * Export event types
 */
export type ExportEventType =
  | "start"
  | "progress"
  | "complete"
  | "error"
  | "cancel";

/**
 * Export event data
 */
export interface ExportEvent {
  /** Event type */
  type: ExportEventType;

  /** Progress percentage (0-100) for progress events */
  progress?: number;

  /** Export result for complete events */
  result?: ExportResult;

  /** Error for error events */
  error?: Error;

  /** Timestamp of the event */
  timestamp: number;
}

/**
 * Export event listener function
 */
export type ExportEventListener = (event: ExportEvent) => void;

/**
 * Export manager configuration
 */
export interface ExportManagerConfig {
  /** Default export options */
  defaultOptions: Partial<ExportOptions>;

  /** Maximum export dimension in pixels (default: 16384) */
  maxDimension: number;

  /** Timeout for export operations in milliseconds (default: 30000) */
  timeout: number;

  /** Whether to show progress notifications (default: true) */
  showProgress: boolean;
}

/**
 * Export statistics
 */
export interface ExportStats {
  /** Total number of exports performed */
  totalExports: number;

  /** Number of successful exports */
  successfulExports: number;

  /** Number of failed exports */
  failedExports: number;

  /** Last export timestamp */
  lastExportTime?: number;

  /** Average export duration in milliseconds */
  averageDuration: number;
}

/**
 * Default export options
 */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "png",
  quality: 0.92,
  scale: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  backgroundColor: "#ffffff",
  padding: 50,
  includeLabels: true,
  includeEdges: true,
};

/**
 * Default export manager configuration
 */
export const DEFAULT_EXPORT_MANAGER_CONFIG: ExportManagerConfig = {
  defaultOptions: DEFAULT_EXPORT_OPTIONS,
  maxDimension: 16384,
  timeout: 30000,
  showProgress: true,
};

/**
 * MIME types for export formats
 */
export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * File extensions for export formats
 */
export const EXPORT_FILE_EXTENSIONS: Record<ExportFormat, string> = {
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
  svg: ".svg",
};
