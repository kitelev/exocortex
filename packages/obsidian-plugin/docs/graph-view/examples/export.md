# Graph Export Examples

Complete, copy-paste ready examples for exporting graphs to various formats.

## Basic Export

Export a simple graph to PNG:

```typescript
import {
  ExportManager,
  type ExportNode,
  type ExportEdge,
} from "@exocortex/obsidian-plugin";

// Sample graph data
const nodes: ExportNode[] = [
  { id: "philosophy", label: "Philosophy", x: 0, y: 0, color: "#6366f1", radius: 14 },
  { id: "science", label: "Science", x: 150, y: -50, color: "#22c55e", radius: 12 },
  { id: "art", label: "Art", x: 150, y: 50, color: "#f59e0b", radius: 12 },
  { id: "mathematics", label: "Mathematics", x: 300, y: -100, color: "#ef4444", radius: 10 },
  { id: "physics", label: "Physics", x: 300, y: 0, color: "#22c55e", radius: 10 },
  { id: "music", label: "Music", x: 300, y: 100, color: "#f59e0b", radius: 10 },
];

const edges: ExportEdge[] = [
  { id: "e1", sourceId: "philosophy", targetId: "science", color: "#64748b" },
  { id: "e2", sourceId: "philosophy", targetId: "art", color: "#64748b" },
  { id: "e3", sourceId: "science", targetId: "mathematics", color: "#64748b" },
  { id: "e4", sourceId: "science", targetId: "physics", color: "#64748b" },
  { id: "e5", sourceId: "art", targetId: "music", color: "#64748b" },
];

// Create export manager and export
const exportManager = new ExportManager();

const result = await exportManager.export(nodes, edges, {
  format: "png",
  scale: 2,
  backgroundColor: "#1e293b",
  padding: 50,
  includeLabels: true,
  includeEdges: true,
});

// Download the file
exportManager.download(result, "knowledge-tree");

console.log(`Exported ${result.width}x${result.height} PNG (${(result.fileSize / 1024).toFixed(1)} KB)`);
```

## Export All Formats

Export the same graph to all supported formats for comparison:

```typescript
import {
  ExportManager,
  createExportManager,
  type ExportNode,
  type ExportEdge,
  type ExportFormat,
} from "@exocortex/obsidian-plugin";

const nodes: ExportNode[] = [
  { id: "n1", label: "Central", x: 200, y: 200, color: "#6366f1", radius: 16 },
  { id: "n2", label: "North", x: 200, y: 50, color: "#22c55e", radius: 10 },
  { id: "n3", label: "East", x: 350, y: 200, color: "#f59e0b", radius: 10 },
  { id: "n4", label: "South", x: 200, y: 350, color: "#ef4444", radius: 10 },
  { id: "n5", label: "West", x: 50, y: 200, color: "#8b5cf6", radius: 10 },
];

const edges: ExportEdge[] = [
  { id: "e1", sourceId: "n1", targetId: "n2", width: 2 },
  { id: "e2", sourceId: "n1", targetId: "n3", width: 2 },
  { id: "e3", sourceId: "n1", targetId: "n4", width: 2 },
  { id: "e4", sourceId: "n1", targetId: "n5", width: 2 },
];

const exportManager = createExportManager();

// Export to all formats
const formats: ExportFormat[] = ["png", "jpeg", "webp", "svg"];
const results: { format: ExportFormat; size: number }[] = [];

for (const format of formats) {
  const result = await exportManager.export(nodes, edges, {
    format,
    scale: 2,
    quality: 0.92,
    backgroundColor: "#ffffff",
    padding: 60,
  });

  results.push({ format, size: result.fileSize });
  exportManager.download(result, `graph-comparison-${format}`);
}

// Compare file sizes
console.log("Format comparison:");
for (const r of results) {
  console.log(`  ${r.format.toUpperCase()}: ${(r.size / 1024).toFixed(1)} KB`);
}
```

## High-Resolution Print Export

Export for print at 300 DPI:

```typescript
import { ExportManager, type ExportNode, type ExportEdge } from "@exocortex/obsidian-plugin";

const nodes: ExportNode[] = [
  { id: "root", label: "Research Project", x: 400, y: 50, color: "#1e40af", radius: 20 },
  { id: "lit", label: "Literature Review", x: 200, y: 200, color: "#0891b2", radius: 14 },
  { id: "method", label: "Methodology", x: 400, y: 200, color: "#059669", radius: 14 },
  { id: "data", label: "Data Collection", x: 600, y: 200, color: "#ca8a04", radius: 14 },
  { id: "analysis", label: "Analysis", x: 300, y: 350, color: "#dc2626", radius: 14 },
  { id: "conclusion", label: "Conclusions", x: 500, y: 350, color: "#7c3aed", radius: 14 },
];

const edges: ExportEdge[] = [
  { id: "e1", sourceId: "root", targetId: "lit", width: 2 },
  { id: "e2", sourceId: "root", targetId: "method", width: 2 },
  { id: "e3", sourceId: "root", targetId: "data", width: 2 },
  { id: "e4", sourceId: "lit", targetId: "analysis", width: 2 },
  { id: "e5", sourceId: "method", targetId: "analysis", width: 2 },
  { id: "e6", sourceId: "data", targetId: "analysis", width: 2 },
  { id: "e7", sourceId: "analysis", targetId: "conclusion", width: 2 },
];

const exportManager = new ExportManager();

// Export as SVG for infinite scalability
const svgResult = await exportManager.export(nodes, edges, {
  format: "svg",
  scale: 3, // 3x for high DPI printing
  backgroundColor: "#ffffff",
  padding: 100,
  includeLabels: true,
  metadata: {
    title: "Research Project Structure",
    author: "Research Team",
    description: "High-level project workflow diagram",
    created: new Date().toISOString(),
  },
});

exportManager.download(svgResult, "research-project-print");

// Also export high-res PNG for presentations
const pngResult = await exportManager.export(nodes, edges, {
  format: "png",
  scale: 4, // 4x scale = ~384 DPI on standard displays
  backgroundColor: "#ffffff",
  padding: 100,
});

exportManager.download(pngResult, "research-project-presentation");

console.log(`SVG: ${(svgResult.fileSize / 1024).toFixed(1)} KB (vector, infinite scale)`);
console.log(`PNG: ${(pngResult.fileSize / 1024).toFixed(1)} KB (${pngResult.width}x${pngResult.height}px)`);
```

## Transparent Background for Overlays

Export with transparency for use in presentations or designs:

```typescript
import { ExportManager, type ExportNode, type ExportEdge } from "@exocortex/obsidian-plugin";

const nodes: ExportNode[] = [
  { id: "a", label: "Concept A", x: 100, y: 100, color: "#3b82f6", radius: 15 },
  { id: "b", label: "Concept B", x: 250, y: 80, color: "#10b981", radius: 12 },
  { id: "c", label: "Concept C", x: 250, y: 150, color: "#f59e0b", radius: 12 },
  { id: "d", label: "Concept D", x: 400, y: 100, color: "#ef4444", radius: 15 },
];

const edges: ExportEdge[] = [
  { id: "e1", sourceId: "a", targetId: "b", color: "#94a3b8", width: 2 },
  { id: "e2", sourceId: "a", targetId: "c", color: "#94a3b8", width: 2 },
  { id: "e3", sourceId: "b", targetId: "d", color: "#94a3b8", width: 2 },
  { id: "e4", sourceId: "c", targetId: "d", color: "#94a3b8", width: 2 },
];

const exportManager = new ExportManager();

// PNG with transparent background
const result = await exportManager.export(nodes, edges, {
  format: "png",
  scale: 2,
  backgroundColor: null, // Transparent!
  padding: 40,
});

exportManager.download(result, "concept-overlay");
console.log("Exported PNG with transparent background");

// WebP also supports transparency
const webpResult = await exportManager.export(nodes, edges, {
  format: "webp",
  scale: 2,
  quality: 0.9,
  backgroundColor: null,
  padding: 40,
});

exportManager.download(webpResult, "concept-overlay-webp");
console.log(`WebP transparent: ${(webpResult.fileSize / 1024).toFixed(1)} KB`);
```

## Export with Progress Monitoring

Show export progress for large graphs:

```typescript
import {
  ExportManager,
  type ExportNode,
  type ExportEdge,
  type ExportEvent,
} from "@exocortex/obsidian-plugin";

// Generate large graph
function generateLargeGraph(nodeCount: number): { nodes: ExportNode[]; edges: ExportEdge[] } {
  const nodes: ExportNode[] = [];
  const edges: ExportEdge[] = [];

  const colors = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"];

  for (let i = 0; i < nodeCount; i++) {
    const angle = (i / nodeCount) * Math.PI * 2;
    const radius = 200 + Math.random() * 100;

    nodes.push({
      id: `node-${i}`,
      label: `Node ${i}`,
      x: 300 + Math.cos(angle) * radius,
      y: 300 + Math.sin(angle) * radius,
      color: colors[i % colors.length],
      radius: 6 + Math.random() * 4,
    });

    // Connect to previous nodes
    if (i > 0) {
      const connectTo = Math.floor(Math.random() * i);
      edges.push({
        id: `edge-${i}`,
        sourceId: `node-${i}`,
        targetId: `node-${connectTo}`,
        color: "#64748b",
      });
    }
  }

  return { nodes, edges };
}

// Create UI elements
const progressBar = document.getElementById("progress-bar") as HTMLProgressElement;
const statusText = document.getElementById("status") as HTMLSpanElement;
const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;

const { nodes, edges } = generateLargeGraph(500);
const exportManager = new ExportManager();

// Set up progress listener
exportManager.addEventListener((event: ExportEvent) => {
  switch (event.type) {
    case "start":
      statusText.textContent = "Starting export...";
      progressBar.value = 0;
      cancelBtn.disabled = false;
      break;

    case "progress":
      progressBar.value = event.progress ?? 0;
      statusText.textContent = `Exporting: ${event.progress}%`;
      break;

    case "complete":
      statusText.textContent = `Complete! ${(event.result!.fileSize / 1024).toFixed(1)} KB`;
      progressBar.value = 100;
      cancelBtn.disabled = true;
      break;

    case "error":
      statusText.textContent = `Error: ${event.error?.message}`;
      cancelBtn.disabled = true;
      break;

    case "cancel":
      statusText.textContent = "Export cancelled";
      cancelBtn.disabled = true;
      break;
  }
});

// Cancel button handler
cancelBtn.onclick = () => exportManager.cancel();

// Start export
try {
  const result = await exportManager.export(nodes, edges, {
    format: "png",
    scale: 2,
    backgroundColor: "#0f172a",
    padding: 50,
  });

  exportManager.download(result, "large-graph");
} catch (error) {
  console.error("Export failed:", error);
}
```

## Partial Graph Export

Export only a specific region of a large graph:

```typescript
import { ExportManager, type ExportNode, type ExportEdge } from "@exocortex/obsidian-plugin";

// Large graph with many nodes spread across a wide area
const nodes: ExportNode[] = [
  // Cluster 1 (top-left region)
  { id: "c1-1", label: "Cluster 1 - A", x: 100, y: 100, color: "#3b82f6" },
  { id: "c1-2", label: "Cluster 1 - B", x: 150, y: 80, color: "#3b82f6" },
  { id: "c1-3", label: "Cluster 1 - C", x: 200, y: 120, color: "#3b82f6" },

  // Cluster 2 (center region)
  { id: "c2-1", label: "Cluster 2 - A", x: 450, y: 300, color: "#22c55e" },
  { id: "c2-2", label: "Cluster 2 - B", x: 500, y: 250, color: "#22c55e" },
  { id: "c2-3", label: "Cluster 2 - C", x: 550, y: 320, color: "#22c55e" },

  // Cluster 3 (bottom-right region)
  { id: "c3-1", label: "Cluster 3 - A", x: 800, y: 500, color: "#f59e0b" },
  { id: "c3-2", label: "Cluster 3 - B", x: 850, y: 480, color: "#f59e0b" },
  { id: "c3-3", label: "Cluster 3 - C", x: 900, y: 520, color: "#f59e0b" },
];

const edges: ExportEdge[] = [
  // Intra-cluster edges
  { id: "e1", sourceId: "c1-1", targetId: "c1-2" },
  { id: "e2", sourceId: "c1-2", targetId: "c1-3" },
  { id: "e3", sourceId: "c2-1", targetId: "c2-2" },
  { id: "e4", sourceId: "c2-2", targetId: "c2-3" },
  { id: "e5", sourceId: "c3-1", targetId: "c3-2" },
  { id: "e6", sourceId: "c3-2", targetId: "c3-3" },
  // Inter-cluster edges
  { id: "e7", sourceId: "c1-3", targetId: "c2-1" },
  { id: "e8", sourceId: "c2-3", targetId: "c3-1" },
];

const exportManager = new ExportManager();

// Export only Cluster 2 (center region)
const cluster2Result = await exportManager.export(nodes, edges, {
  format: "png",
  scale: 2,
  backgroundColor: "#1e293b",
  customBounds: {
    x: 400,   // Left edge of export region
    y: 200,   // Top edge of export region
    width: 200,  // Export width
    height: 200, // Export height
  },
});

exportManager.download(cluster2Result, "cluster-2-detail");
console.log(`Cluster 2 export: ${cluster2Result.width}x${cluster2Result.height}px`);

// Export full graph for comparison
const fullResult = await exportManager.export(nodes, edges, {
  format: "png",
  scale: 1, // Lower scale for full graph
  backgroundColor: "#1e293b",
  padding: 50,
});

exportManager.download(fullResult, "full-graph-overview");
console.log(`Full graph: ${fullResult.width}x${fullResult.height}px`);
```

## Copy to Clipboard

Export and copy directly to clipboard for pasting:

```typescript
import { ExportManager, type ExportNode, type ExportEdge } from "@exocortex/obsidian-plugin";

const nodes: ExportNode[] = [
  { id: "idea", label: "Main Idea", x: 200, y: 100, color: "#6366f1", radius: 14 },
  { id: "sub1", label: "Sub-topic 1", x: 100, y: 200, color: "#22c55e", radius: 10 },
  { id: "sub2", label: "Sub-topic 2", x: 200, y: 250, color: "#22c55e", radius: 10 },
  { id: "sub3", label: "Sub-topic 3", x: 300, y: 200, color: "#22c55e", radius: 10 },
];

const edges: ExportEdge[] = [
  { id: "e1", sourceId: "idea", targetId: "sub1" },
  { id: "e2", sourceId: "idea", targetId: "sub2" },
  { id: "e3", sourceId: "idea", targetId: "sub3" },
];

const exportManager = new ExportManager();

// Export as PNG and copy to clipboard
const pngResult = await exportManager.export(nodes, edges, {
  format: "png",
  scale: 2,
  backgroundColor: "#ffffff",
  padding: 30,
});

await exportManager.copyToClipboard(pngResult);
console.log("PNG copied to clipboard! Paste into any application.");

// Export as SVG and copy to clipboard (copies as text)
const svgResult = await exportManager.export(nodes, edges, {
  format: "svg",
  scale: 1,
  backgroundColor: "#ffffff",
  padding: 30,
});

await exportManager.copyToClipboard(svgResult);
console.log("SVG copied to clipboard as text! Paste into code editors or vector apps.");
```

## Export Statistics Dashboard

Track export metrics over time:

```typescript
import {
  ExportManager,
  type ExportNode,
  type ExportEdge,
  type ExportStats,
} from "@exocortex/obsidian-plugin";

const exportManager = new ExportManager();

// Sample graph
const nodes: ExportNode[] = [
  { id: "a", label: "A", x: 100, y: 100, color: "#6366f1" },
  { id: "b", label: "B", x: 200, y: 100, color: "#22c55e" },
  { id: "c", label: "C", x: 150, y: 200, color: "#f59e0b" },
];

const edges: ExportEdge[] = [
  { id: "e1", sourceId: "a", targetId: "b" },
  { id: "e2", sourceId: "b", targetId: "c" },
  { id: "e3", sourceId: "c", targetId: "a" },
];

// Perform multiple exports
const formats = ["png", "jpeg", "webp", "svg"] as const;

for (const format of formats) {
  try {
    await exportManager.export(nodes, edges, { format });
    console.log(`${format.toUpperCase()} export successful`);
  } catch (error) {
    console.error(`${format.toUpperCase()} export failed:`, error);
  }
}

// Intentionally trigger an error
try {
  const hugeNodes: ExportNode[] = [
    { id: "n1", label: "Test", x: 0, y: 0 },
    { id: "n2", label: "Test", x: 50000, y: 50000 },
  ];
  await exportManager.export(hugeNodes, []);
} catch {
  console.log("Expected error for oversized export");
}

// Display statistics
function displayStats(stats: ExportStats): void {
  console.log("\n📊 Export Statistics:");
  console.log(`  Total exports:      ${stats.totalExports}`);
  console.log(`  Successful:         ${stats.successfulExports}`);
  console.log(`  Failed:             ${stats.failedExports}`);
  console.log(`  Success rate:       ${((stats.successfulExports / stats.totalExports) * 100).toFixed(1)}%`);
  console.log(`  Average duration:   ${stats.averageDuration.toFixed(0)}ms`);
  if (stats.lastExportTime) {
    console.log(`  Last export:        ${new Date(stats.lastExportTime).toLocaleString()}`);
  }
}

displayStats(exportManager.getStats());

// Reset and start fresh
exportManager.resetStats();
console.log("\n🔄 Statistics reset");
displayStats(exportManager.getStats());
```

## See Also

- [Export Guide](../guides/export.md) - Complete export documentation
- [Styling Guide](../guides/styling.md) - Node and edge customization
- [Performance Guide](../guides/performance.md) - Large graph optimization
- [API Reference](../api/index.md) - ExportManager API
