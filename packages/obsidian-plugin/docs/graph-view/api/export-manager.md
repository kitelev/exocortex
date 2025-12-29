# ExportManager API

The `ExportManager` class provides graph export functionality supporting PNG, JPEG, WebP, and SVG formats with high-DPI display support.

## Import

```typescript
import {
  ExportManager,
  createExportManager,
  type ExportOptions,
  type ExportResult,
  type ExportNode,
  type ExportEdge,
  type ExportEvent,
  type ExportManagerConfig,
  type ExportStats,
} from "./presentation/renderers/graph";
```

## Class: ExportManager

### Constructor

```typescript
new ExportManager(config?: Partial<ExportManagerConfig>)
```

Creates a new ExportManager instance with optional configuration.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `config` | `Partial<ExportManagerConfig>` | Optional configuration overrides |

**Example:**

```typescript
const manager = new ExportManager({
  maxDimension: 8192,
  timeout: 60000,
  defaultOptions: {
    format: "png",
    scale: 2,
  },
});
```

### Methods

#### export()

```typescript
async export(
  nodes: ExportNode[],
  edges: ExportEdge[],
  options?: Partial<ExportOptions>
): Promise<ExportResult>
```

Export graph to specified format.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `nodes` | `ExportNode[]` | Array of nodes to export |
| `edges` | `ExportEdge[]` | Array of edges to export |
| `options` | `Partial<ExportOptions>` | Export options |

**Returns:** `Promise<ExportResult>` - Export result containing blob, data URL, dimensions

**Throws:**
- `Error` if dimensions exceed maximum allowed
- `Error` if canvas context creation fails
- `Error` if blob creation fails

**Example:**

```typescript
const result = await manager.export(nodes, edges, {
  format: "png",
  scale: 2,
  backgroundColor: "#ffffff",
});
```

#### download()

```typescript
download(result: ExportResult, filename?: string): void
```

Download export result as file.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `result` | `ExportResult` | - | Export result to download |
| `filename` | `string` | `"graph-export"` | Filename without extension |

**Example:**

```typescript
manager.download(result, "my-knowledge-graph");
// Downloads: my-knowledge-graph.png
```

#### copyToClipboard()

```typescript
async copyToClipboard(result: ExportResult): Promise<void>
```

Copy export result to clipboard.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `result` | `ExportResult` | Export result to copy |

**Notes:**
- Raster formats (PNG, JPEG, WebP) are copied as images
- SVG format is copied as text

**Example:**

```typescript
await manager.copyToClipboard(result);
```

#### cancel()

```typescript
cancel(): void
```

Cancel ongoing export operation.

**Example:**

```typescript
const exportPromise = manager.export(nodes, edges);

// Later...
manager.cancel();
```

#### addEventListener()

```typescript
addEventListener(listener: ExportEventListener): void
```

Add event listener for export events.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `listener` | `ExportEventListener` | Event handler function |

**Example:**

```typescript
manager.addEventListener((event) => {
  if (event.type === "progress") {
    console.log(`Progress: ${event.progress}%`);
  }
});
```

#### removeEventListener()

```typescript
removeEventListener(listener: ExportEventListener): void
```

Remove event listener.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `listener` | `ExportEventListener` | Event handler to remove |

#### getStats()

```typescript
getStats(): ExportStats
```

Get export statistics.

**Returns:** `ExportStats` - Copy of current statistics

**Example:**

```typescript
const stats = manager.getStats();
console.log(`Success rate: ${stats.successfulExports / stats.totalExports * 100}%`);
```

#### resetStats()

```typescript
resetStats(): void
```

Reset export statistics to zero.

## Factory Function

### createExportManager()

```typescript
function createExportManager(
  config?: Partial<ExportManagerConfig>
): ExportManager
```

Factory function to create ExportManager instance.

**Example:**

```typescript
const manager = createExportManager({
  defaultOptions: { format: "svg" },
});
```

## Types

### ExportFormat

```typescript
type ExportFormat = "png" | "jpeg" | "webp" | "svg";
```

Supported export formats.

### ExportOptions

```typescript
interface ExportOptions {
  format: ExportFormat;        // Output format (default: "png")
  quality: number;             // Quality 0-1 for lossy formats (default: 0.92)
  scale: number;               // DPI scale factor (default: devicePixelRatio)
  backgroundColor: string | null;  // Background color or null for transparent
  padding: number;             // Padding in pixels (default: 50)
  includeLabels: boolean;      // Include node labels (default: true)
  includeEdges: boolean;       // Include edges (default: true)
  customBounds?: ExportBounds; // Custom export region
  metadata?: Record<string, string>;  // Metadata for PNG/SVG
  filename?: string;           // Download filename
}
```

### ExportBounds

```typescript
interface ExportBounds {
  x: number;      // Top-left X coordinate
  y: number;      // Top-left Y coordinate
  width: number;  // Export width
  height: number; // Export height
}
```

### ExportResult

```typescript
interface ExportResult {
  blob: Blob;       // Binary data
  dataUrl: string;  // Base64 data URL
  width: number;    // Pixel width
  height: number;   // Pixel height
  format: ExportFormat;  // Format used
  fileSize: number; // File size in bytes
}
```

### ExportNode

```typescript
interface ExportNode {
  id: string;       // Unique identifier
  label: string;    // Display text
  x: number;        // X coordinate
  y: number;        // Y coordinate
  radius?: number;  // Node radius (default: 8)
  color?: number | string;  // Fill color
  group?: string;   // Category for styling
}
```

### ExportEdge

```typescript
interface ExportEdge {
  id: string;       // Unique identifier
  sourceId: string; // Source node ID
  targetId: string; // Target node ID
  label?: string;   // Edge label
  color?: number | string;  // Line color
  width?: number;   // Line width (default: 1)
}
```

### ExportEvent

```typescript
interface ExportEvent {
  type: ExportEventType;
  progress?: number;     // 0-100 for progress events
  result?: ExportResult; // For complete events
  error?: Error;         // For error events
  timestamp: number;     // Event timestamp
}

type ExportEventType = "start" | "progress" | "complete" | "error" | "cancel";
```

### ExportEventListener

```typescript
type ExportEventListener = (event: ExportEvent) => void;
```

### ExportManagerConfig

```typescript
interface ExportManagerConfig {
  defaultOptions: Partial<ExportOptions>;  // Default export options
  maxDimension: number;   // Maximum dimension (default: 16384)
  timeout: number;        // Timeout in ms (default: 30000)
  showProgress: boolean;  // Show progress (default: true)
}
```

### ExportStats

```typescript
interface ExportStats {
  totalExports: number;      // Total export count
  successfulExports: number; // Successful count
  failedExports: number;     // Failed count
  lastExportTime?: number;   // Last export timestamp
  averageDuration: number;   // Average duration in ms
}
```

## Constants

### DEFAULT_EXPORT_OPTIONS

```typescript
const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "png",
  quality: 0.92,
  scale: window.devicePixelRatio || 1,
  backgroundColor: "#ffffff",
  padding: 50,
  includeLabels: true,
  includeEdges: true,
};
```

### DEFAULT_EXPORT_MANAGER_CONFIG

```typescript
const DEFAULT_EXPORT_MANAGER_CONFIG: ExportManagerConfig = {
  defaultOptions: DEFAULT_EXPORT_OPTIONS,
  maxDimension: 16384,
  timeout: 30000,
  showProgress: true,
};
```

### EXPORT_MIME_TYPES

```typescript
const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};
```

### EXPORT_FILE_EXTENSIONS

```typescript
const EXPORT_FILE_EXTENSIONS: Record<ExportFormat, string> = {
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
  svg: ".svg",
};
```

## Events

The ExportManager emits events during export:

| Event | When | Properties |
|-------|------|------------|
| `start` | Export begins | `timestamp` |
| `progress` | During export | `progress` (0-100), `timestamp` |
| `complete` | Export succeeds | `result`, `timestamp` |
| `error` | Export fails | `error`, `timestamp` |
| `cancel` | Export cancelled | `timestamp` |

**Example:**

```typescript
manager.addEventListener((event) => {
  switch (event.type) {
    case "start":
      showSpinner();
      break;
    case "progress":
      updateProgress(event.progress!);
      break;
    case "complete":
      hideSpinner();
      displayImage(event.result!.dataUrl);
      break;
    case "error":
      hideSpinner();
      showError(event.error!.message);
      break;
    case "cancel":
      hideSpinner();
      break;
  }
});
```

## Error Handling

The export method throws errors for:

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `"Export dimensions exceed maximum"` | Graph too large | Reduce scale or use custom bounds |
| `"Export dimensions must be positive"` | Invalid bounds | Ensure width/height > 0 |
| `"Failed to create canvas context"` | Browser limitation | Try smaller export |
| `"Failed to create blob from canvas"` | Memory issue | Reduce scale or graph size |

**Example:**

```typescript
try {
  const result = await manager.export(nodes, edges);
} catch (error) {
  if (error.message.includes("exceed maximum")) {
    // Try with lower scale
    const result = await manager.export(nodes, edges, { scale: 1 });
  }
}
```

## See Also

- [Export Guide](../guides/export.md) - User guide with examples
- [Export Examples](../examples/export.md) - Copy-paste code samples
- [API Overview](./index.md) - Full API reference
