# Graph Export Guide

Export your knowledge graphs to various image formats for sharing, presentations, or archival purposes. The Graph View supports PNG, JPEG, WebP, and SVG export with customizable options.

## Quick Start

```typescript
import { ExportManager } from "./presentation/renderers/graph";

// Create export manager
const exportManager = new ExportManager();

// Export graph as PNG
const result = await exportManager.export(nodes, edges, {
  format: "png",
  scale: 2,
  backgroundColor: "#ffffff",
  padding: 50,
});

// Download the file
exportManager.download(result, "my-knowledge-graph");
```

## Supported Formats

| Format | Extension | Best For | Transparency | Quality Options |
|--------|-----------|----------|--------------|-----------------|
| **PNG** | `.png` | General use, highest quality | Yes | N/A (lossless) |
| **JPEG** | `.jpg` | Photos, smaller files | No | 0.0 - 1.0 |
| **WebP** | `.webp` | Modern web, best compression | Yes | 0.0 - 1.0 |
| **SVG** | `.svg` | Print, infinite scaling | Yes | N/A (vector) |

### Format Selection Guide

- **PNG** (Default): Best for general use. Lossless compression preserves all details. Supports transparency.
- **JPEG**: Best for large graphs where file size matters. No transparency support.
- **WebP**: Modern format with excellent compression. 25-35% smaller than PNG at same quality.
- **SVG**: Vector format, scales infinitely without quality loss. Ideal for print or embedding.

## Export Options

### Basic Options

```typescript
interface ExportOptions {
  // Output format (default: "png")
  format: "png" | "jpeg" | "webp" | "svg";

  // Quality for lossy formats (0-1, default: 0.92)
  quality: number;

  // DPI scale factor (default: window.devicePixelRatio || 1)
  scale: number;

  // Background color or null for transparent (default: "#ffffff")
  backgroundColor: string | null;

  // Padding around graph in pixels (default: 50)
  padding: number;

  // Include node labels (default: true)
  includeLabels: boolean;

  // Include edges (default: true)
  includeEdges: boolean;
}
```

### Advanced Options

```typescript
interface AdvancedExportOptions extends ExportOptions {
  // Custom bounds for export area
  customBounds?: {
    x: number;      // Top-left X coordinate
    y: number;      // Top-left Y coordinate
    width: number;  // Export width
    height: number; // Export height
  };

  // Metadata to embed (PNG, SVG only)
  metadata?: {
    title?: string;
    author?: string;
    description?: string;
    [key: string]: string | undefined;
  };

  // Custom filename for download
  filename?: string;
}
```

## Common Use Cases

### High-Resolution Export for Print

For print materials, use 2x or 3x scale with SVG:

```typescript
const result = await exportManager.export(nodes, edges, {
  format: "svg",
  scale: 3,
  backgroundColor: "#ffffff",
  padding: 100,
  metadata: {
    title: "Knowledge Graph - Q4 2025",
    author: "Research Team",
  },
});

exportManager.download(result, "knowledge-graph-print");
```

### Transparent Background for Slides

Export with transparent background for presentation overlays:

```typescript
const result = await exportManager.export(nodes, edges, {
  format: "png",
  scale: 2,
  backgroundColor: null, // Transparent
  padding: 50,
});
```

### Compact Export for Web

Optimize for web use with WebP and adjusted quality:

```typescript
const result = await exportManager.export(nodes, edges, {
  format: "webp",
  quality: 0.85, // Good balance of quality/size
  scale: 1,
  padding: 30,
});

console.log(`File size: ${(result.fileSize / 1024).toFixed(1)} KB`);
```

### Export Specific Region

Export only a portion of the graph:

```typescript
const result = await exportManager.export(nodes, edges, {
  format: "png",
  customBounds: {
    x: 100,
    y: 100,
    width: 800,
    height: 600,
  },
});
```

### Nodes Only (No Edges)

Export just the nodes without edge connections:

```typescript
const result = await exportManager.export(nodes, edges, {
  format: "png",
  includeEdges: false,
  includeLabels: true,
});
```

## Programmatic Export

### Using Export Result

The export result contains all data needed for display or further processing:

```typescript
interface ExportResult {
  blob: Blob;       // Binary data
  dataUrl: string;  // Base64 data URL
  width: number;    // Pixel width
  height: number;   // Pixel height
  format: string;   // Format used
  fileSize: number; // Bytes
}

// Display in image element
const img = document.createElement("img");
img.src = result.dataUrl;
document.body.appendChild(img);

// Upload to server
const formData = new FormData();
formData.append("image", result.blob, "graph.png");
await fetch("/api/upload", { method: "POST", body: formData });
```

### Copy to Clipboard

Copy export directly to clipboard:

```typescript
await exportManager.copyToClipboard(result);

// For SVG, copies as text
// For raster formats, copies as image
```

### Progress Monitoring

Track export progress for large graphs:

```typescript
exportManager.addEventListener((event) => {
  switch (event.type) {
    case "start":
      console.log("Export started");
      showSpinner();
      break;

    case "progress":
      console.log(`Progress: ${event.progress}%`);
      updateProgressBar(event.progress);
      break;

    case "complete":
      console.log("Export complete", event.result);
      hideSpinner();
      break;

    case "error":
      console.error("Export failed:", event.error);
      showError(event.error.message);
      break;

    case "cancel":
      console.log("Export cancelled");
      hideSpinner();
      break;
  }
});
```

### Cancel Export

Cancel a long-running export:

```typescript
// Start export
const exportPromise = exportManager.export(nodes, edges, options);

// Cancel button handler
cancelButton.onclick = () => {
  exportManager.cancel();
};
```

## Export Statistics

Track export metrics for monitoring or debugging:

```typescript
// After multiple exports
const stats = exportManager.getStats();

console.log(`Total exports: ${stats.totalExports}`);
console.log(`Successful: ${stats.successfulExports}`);
console.log(`Failed: ${stats.failedExports}`);
console.log(`Average duration: ${stats.averageDuration.toFixed(0)}ms`);

// Reset statistics
exportManager.resetStats();
```

## Configuration

### Manager Configuration

Configure default behavior at construction:

```typescript
import { ExportManager, type ExportManagerConfig } from "./presentation/renderers/graph";

const config: Partial<ExportManagerConfig> = {
  // Maximum export dimension (default: 16384)
  maxDimension: 8192,

  // Export timeout in ms (default: 30000)
  timeout: 60000,

  // Show progress notifications (default: true)
  showProgress: true,

  // Default export options
  defaultOptions: {
    format: "png",
    scale: 2,
    backgroundColor: "#1a1a2e",
    padding: 100,
  },
};

const exportManager = new ExportManager(config);
```

### Factory Function

Use the factory function for quick setup:

```typescript
import { createExportManager } from "./presentation/renderers/graph";

const exportManager = createExportManager({
  maxDimension: 8192,
  defaultOptions: {
    format: "svg",
    scale: 2,
  },
});
```

## Node and Edge Data

### Node Format

Nodes require position and label information:

```typescript
interface ExportNode {
  id: string;       // Unique identifier
  label: string;    // Display text
  x: number;        // X position
  y: number;        // Y position
  radius?: number;  // Node size (default: 8)
  color?: number | string;  // Fill color (hex)
  group?: string;   // Category for styling
}

// Example nodes
const nodes: ExportNode[] = [
  { id: "1", label: "Philosophy", x: 100, y: 100, radius: 12, color: "#6366f1" },
  { id: "2", label: "Science", x: 200, y: 150, radius: 10, color: "#22c55e" },
  { id: "3", label: "Art", x: 150, y: 250, radius: 8, color: "#f59e0b" },
];
```

### Edge Format

Edges connect nodes by ID:

```typescript
interface ExportEdge {
  id: string;       // Unique identifier
  sourceId: string; // Source node ID
  targetId: string; // Target node ID
  label?: string;   // Edge label
  color?: number | string;  // Line color
  width?: number;   // Line width (default: 1)
}

// Example edges
const edges: ExportEdge[] = [
  { id: "e1", sourceId: "1", targetId: "2", color: "#64748b" },
  { id: "e2", sourceId: "2", targetId: "3", width: 2 },
  { id: "e3", sourceId: "1", targetId: "3", label: "influences" },
];
```

## Best Practices

### Performance Tips

1. **Large graphs**: Use lower scale (1x) and PNG for fastest export
2. **High quality**: Use SVG for infinite scalability
3. **File size**: Use WebP with 0.85 quality for best compression
4. **Memory**: Monitor `maxDimension` to prevent browser crashes

### Quality Guidelines

| Use Case | Format | Scale | Quality |
|----------|--------|-------|---------|
| Web preview | WebP | 1x | 0.8 |
| Documentation | PNG | 2x | N/A |
| Presentation | PNG | 2x | N/A |
| Print (300 DPI) | SVG | 3x | N/A |
| Social media | JPEG | 1x | 0.9 |

### Error Handling

```typescript
try {
  const result = await exportManager.export(nodes, edges, options);
  exportManager.download(result, "my-graph");
} catch (error) {
  if (error.message.includes("exceed maximum")) {
    // Dimensions too large
    console.error("Graph too large. Try reducing scale or using custom bounds.");
  } else if (error.message.includes("canvas context")) {
    // Browser limitation
    console.error("Browser canvas error. Try a smaller export.");
  } else {
    console.error("Export failed:", error.message);
  }
}
```

## Troubleshooting

### Export Fails with "exceed maximum" Error

The export dimensions exceed browser limits. Solutions:

```typescript
// Option 1: Reduce scale
const result = await exportManager.export(nodes, edges, {
  scale: 1, // Instead of 2 or higher
});

// Option 2: Use custom bounds for partial export
const result = await exportManager.export(nodes, edges, {
  customBounds: { x: 0, y: 0, width: 2000, height: 2000 },
});

// Option 3: Configure lower max dimension
const manager = new ExportManager({ maxDimension: 8192 });
```

### Transparent Background Shows Black

PNG and WebP support transparency, but JPEG does not:

```typescript
// Wrong: JPEG doesn't support transparency
const result = await exportManager.export(nodes, edges, {
  format: "jpeg",
  backgroundColor: null, // Will be black!
});

// Correct: Use PNG or WebP for transparency
const result = await exportManager.export(nodes, edges, {
  format: "png",
  backgroundColor: null, // Transparent works!
});
```

### Labels Appear Blurry

Increase scale factor for sharper text:

```typescript
const result = await exportManager.export(nodes, edges, {
  scale: 2, // Minimum 2x for readable labels
  includeLabels: true,
});
```

### SVG Export Not Rendering Correctly

Ensure node colors are valid:

```typescript
// Wrong: Invalid color values
const nodes = [
  { id: "1", label: "Test", x: 0, y: 0, color: "invalid" },
];

// Correct: Use hex numbers or strings
const nodes = [
  { id: "1", label: "Test", x: 0, y: 0, color: 0x6366f1 },
  { id: "2", label: "Test", x: 100, y: 0, color: "#22c55e" },
];
```

## See Also

- [API Reference](../api/index.md) - ExportManager API details
- [Styling Guide](./styling.md) - Node and edge customization
- [Performance Guide](./performance.md) - Large graph optimization
- [Basic Graph Example](../examples/basic-graph.md) - Getting started
