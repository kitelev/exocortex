# Search Guide

> Find and highlight nodes in your knowledge graph

The Graph View includes a powerful search system for finding nodes by text, navigating between matches, and visually highlighting results. This guide covers the SearchManager for text search and the TypeColorManager for type-based visual categorization.

## Quick Start

### Using Search

1. Press `Ctrl+F` (or `Cmd+F` on Mac) to open the search box
2. Type your search query
3. Use `Enter` to navigate to the next match
4. Use `Shift+Enter` to navigate to the previous match
5. Press `Escape` to clear the search

### Programmatic Search

```typescript
import { SearchManager } from "./presentation/renderers/graph";

// Create search manager
const searchManager = new SearchManager();

// Set nodes to search
searchManager.setNodes(graphNodes);

// Execute search
searchManager.search("project");

// Get results
const state = searchManager.getState();
console.log(`Found ${state.matches.length} matches`);

// Navigate matches
searchManager.nextMatch();
searchManager.previousMatch();

// Clear search
searchManager.clear();
```

## SearchManager

### Configuration

```typescript
import {
  SearchManager,
  SearchManagerConfig,
  DEFAULT_SEARCH_MANAGER_CONFIG,
} from "./presentation/renderers/graph";

const config: Partial<SearchManagerConfig> = {
  searchOptions: {
    caseSensitive: false,     // Case-insensitive by default
    useRegex: false,          // Literal search by default
    searchLabels: true,       // Search in node labels
    searchPaths: true,        // Search in file paths
    searchTypes: true,        // Search in RDF type names
    minChars: 2,              // Minimum characters to trigger search
    debounceMs: 200,          // Debounce delay in milliseconds
    maxResults: 100,          // Maximum results to return
  },
  highlightStyle: {
    backgroundColor: "#ffff00",  // Yellow highlight
    textColor: "#000000",
    borderColor: "#ff8c00",
    borderWidth: 2,
    glowIntensity: 0.5,
  },
};

const searchManager = new SearchManager(config);
```

### Search Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `caseSensitive` | `boolean` | `false` | Match case when searching |
| `useRegex` | `boolean` | `false` | Treat query as regular expression |
| `searchLabels` | `boolean` | `true` | Search in node labels |
| `searchPaths` | `boolean` | `true` | Search in file paths |
| `searchTypes` | `boolean` | `true` | Search in RDF type names |
| `minChars` | `number` | `2` | Minimum characters to start search |
| `debounceMs` | `number` | `200` | Debounce delay for typing |
| `maxResults` | `number` | `100` | Maximum number of results |

### Setting Nodes

Provide nodes and optional type information for searching:

```typescript
// Basic: just nodes
searchManager.setNodes(graphNodes);

// With type information for searching by type
const nodeTypes = new Map<string, string[]>();
nodeTypes.set("node-1", ["ems__Task", "ems__Urgent"]);
nodeTypes.set("node-2", ["ems__Project"]);

searchManager.setNodes(graphNodes, nodeTypes);
```

### Executing Search

```typescript
// Standard search (with debounce)
searchManager.search("meeting notes");

// Immediate search (skip debounce)
searchManager.search("urgent", true);

// Regex search (enable in options first)
searchManager.setOptions({ useRegex: true });
searchManager.search("^Task-\\d+$");
```

### Search Results

```typescript
const state = searchManager.getState();

// SearchState structure:
interface SearchState {
  query: string;              // Current search query
  isActive: boolean;          // Whether search is active
  matches: SearchMatch[];     // Array of matches
  currentMatchIndex: number;  // Index of selected match (-1 if none)
  options: SearchOptions;     // Current search options
}

// SearchMatch structure:
interface SearchMatch {
  nodeId: string;            // ID of matching node
  matchedText: string;       // Full text that was matched
  matchedField: string;      // Field type: "label", "path", or "type"
  score: number;             // Relevance score for ranking
  matchStart: number;        // Start index of match in text
  matchEnd: number;          // End index of match in text
}
```

### Navigating Matches

```typescript
// Go to next match (wraps around)
const nextMatch = searchManager.nextMatch();

// Go to previous match (wraps around)
const prevMatch = searchManager.previousMatch();

// Select specific match by index
const match = searchManager.selectMatch(5);

// Select match by node ID
const matchByNode = searchManager.selectMatchByNodeId("node-123");
```

### Checking Match Status

```typescript
// Check if a node is a match
const isMatch = searchManager.isMatch("node-123");

// Check if a node is the currently selected match
const isCurrent = searchManager.isCurrentMatch("node-123");

// Get all matched node IDs
const matchedIds = searchManager.getMatchedNodeIds();
```

### Event Handling

Subscribe to search events for real-time updates:

```typescript
import { SearchEvent, SearchEventListener } from "./presentation/renderers/graph";

const handleSearchEvent: SearchEventListener = (event: SearchEvent) => {
  switch (event.type) {
    case "search:start":
      console.log("Search started:", event.query);
      break;

    case "search:update":
      console.log(`Found ${event.matches?.length} matches`);
      break;

    case "search:clear":
      console.log("Search cleared");
      break;

    case "match:select":
      console.log("Selected match:", event.selectedMatch?.nodeId);
      // Center graph on selected node
      break;

    case "match:highlight":
      console.log("Highlighting match:", event.selectedMatch?.nodeId);
      break;
  }
};

searchManager.addEventListener(handleSearchEvent);

// Later: remove listener
searchManager.removeEventListener(handleSearchEvent);
```

### Search Scoring

Matches are ranked by relevance score. Higher scores appear first:

| Factor | Score Bonus | Description |
|--------|-------------|-------------|
| Exact match | +50 | Query exactly equals full text |
| Prefix match | +30 | Query matches start of text |
| Label field | +20 | Match found in node label |
| Type field | +10 | Match found in type name |
| Match ratio | +0-20 | Longer matches relative to text |

### Cleanup

```typescript
// Clear current search
searchManager.clear();

// Destroy manager (cleanup resources)
searchManager.destroy();
```

## TypeColorManager

The TypeColorManager provides type-based coloring and a visual legend for the graph.

### Configuration

```typescript
import {
  TypeColorManager,
  TypeColorManagerConfig,
} from "./presentation/renderers/graph";

const config: Partial<TypeColorManagerConfig> = {
  paletteId: "default",           // Color palette to use
  useInheritance: true,           // Subclasses inherit parent colors
  customColors: [],               // Custom type color overrides
  enforceContrast: true,          // Ensure WCAG AA contrast
  storageKey: "exo-graph-colors", // localStorage key for preferences
};

const colorManager = new TypeColorManager(config);
```

### Getting Type Colors

```typescript
// Get color configuration for a type
const typeConfig = colorManager.getTypeColor("ems__Task");
// {
//   typeUri: "ems__Task",
//   color: "#22c55e",
//   icon: "✓",
//   shape: "circle",
//   priority: 80,
//   displayName: "Task"
// }

// Get color as hex number (for PixiJS)
const colorNumber = colorManager.getColorAsNumber("ems__Task");
// 0x22c55e
```

### Color Palettes

Built-in palettes are available for different use cases:

```typescript
// Get current palette
const palette = colorManager.getPalette();

// Get all available palettes
const palettes = colorManager.getAvailablePalettes();
// [
//   { id: "default", name: "Default", ... },
//   { id: "pastel", name: "Pastel", ... },
//   { id: "colorblind-safe", name: "Colorblind Safe", ... },
//   { id: "high-contrast", name: "High Contrast", ... },
// ]

// Change palette
colorManager.setPalette("colorblind-safe");
```

**Available Palettes:**

| Palette | Description | Use Case |
|---------|-------------|----------|
| `default` | Standard high-contrast colors | General use |
| `pastel` | Soft pastel colors | Light themes |
| `colorblind-safe` | Tol palette optimized for CVD | Accessibility |
| `high-contrast` | Maximum contrast colors | Visual impairment |

### Custom Colors

Override colors for specific types:

```typescript
// Set custom color for a type
colorManager.setTypeColor("ems__Task", "#ff0000");

// Reset to default color
colorManager.resetTypeColor("ems__Task");

// Register a new type configuration
colorManager.registerType({
  typeUri: "custom__MyType",
  color: "#8b5cf6",
  icon: "⭐",
  shape: "diamond",
  priority: 50,
  displayName: "My Custom Type",
});
```

### Type Inheritance

When `useInheritance` is enabled, subclasses inherit colors from their parent class:

```typescript
// With ontology information
const ontologyInfo = {
  getSuperclasses: (typeUri: string) => {
    if (typeUri === "ems__UrgentTask") return ["ems__Task"];
    return [];
  },
  getSubclasses: (typeUri: string) => {
    if (typeUri === "ems__Task") return ["ems__UrgentTask"];
    return [];
  },
  isSubclassOf: (typeA: string, typeB: string) => {
    return typeA === "ems__UrgentTask" && typeB === "ems__Task";
  },
};

const colorManager = new TypeColorManager(
  { useInheritance: true },
  ontologyInfo
);

// ems__UrgentTask will inherit color from ems__Task
const urgentConfig = colorManager.getTypeColor("ems__UrgentTask");
```

### Visual Legend

Display a legend showing all types in the graph:

```typescript
// Update legend with current type counts
const typeCounts = new Map<string, number>();
typeCounts.set("ems__Task", 150);
typeCounts.set("ems__Project", 25);
typeCounts.set("ems__Area", 5);

colorManager.updateLegend(typeCounts);

// Get legend state
const legendState = colorManager.getLegendState();
// {
//   items: [
//     { typeUri: "ems__Task", displayName: "Task", color: "#22c55e", count: 150, visible: true },
//     { typeUri: "ems__Project", displayName: "Project", color: "#3b82f6", count: 25, visible: true },
//     ...
//   ],
//   isExpanded: true,
//   paletteId: "default",
//   customColors: Map {}
// }

// Toggle legend expansion
colorManager.toggleLegendVisibility();

// Toggle visibility of a specific type
colorManager.toggleLegendVisibility("ems__Task");
```

### Import/Export

Share color configurations between users or sessions:

```typescript
// Export current configuration
const configJson = colorManager.exportConfig();
// Clipboard or save to file

// Import configuration
colorManager.importConfig(configJson);
```

### Events

Subscribe to color change events:

```typescript
colorManager.addEventListener((event) => {
  switch (event.type) {
    case "color:change":
      console.log(`Type ${event.typeUri} color changed to ${event.color}`);
      // Re-render affected nodes
      break;

    case "palette:change":
      console.log(`Palette changed to ${event.paletteId}`);
      // Re-render all nodes
      break;

    case "legend:toggle":
      console.log(`Type ${event.typeUri} visibility: ${event.visible}`);
      // Update filter state
      break;
  }
});
```

### WCAG Contrast

When `enforceContrast` is enabled, generated colors are checked for WCAG AA compliance:

```typescript
import { meetsWCAGAA } from "./presentation/renderers/graph";

// Check if colors meet contrast requirements
const isAccessible = meetsWCAGAA(
  "#22c55e",  // foreground color
  "#1e1e1e",  // background color
  true        // check for large text (relaxed requirements)
);
```

## Integration Example

Complete example combining search and type colors:

```typescript
import {
  SearchManager,
  TypeColorManager,
  GraphNode,
} from "./presentation/renderers/graph";

class GraphSearchController {
  private searchManager: SearchManager;
  private colorManager: TypeColorManager;

  constructor() {
    this.searchManager = new SearchManager({
      searchOptions: { searchTypes: true },
    });

    this.colorManager = new TypeColorManager({
      paletteId: "default",
      enforceContrast: true,
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Handle search matches
    this.searchManager.addEventListener((event) => {
      if (event.type === "match:select" && event.selectedMatch) {
        this.centerOnNode(event.selectedMatch.nodeId);
        this.highlightNode(event.selectedMatch.nodeId);
      }
    });

    // Handle color changes
    this.colorManager.addEventListener((event) => {
      if (event.type === "color:change") {
        this.recolorNode(event.typeUri!, event.color!);
      }
    });
  }

  setGraphData(nodes: GraphNode[], nodeTypes: Map<string, string[]>): void {
    this.searchManager.setNodes(nodes, nodeTypes);

    // Build type counts for legend
    const typeCounts = new Map<string, number>();
    for (const types of nodeTypes.values()) {
      for (const type of types) {
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      }
    }
    this.colorManager.updateLegend(typeCounts);
  }

  search(query: string): void {
    this.searchManager.search(query);
  }

  getNodeColor(nodeId: string, nodeTypes: string[]): string {
    // Use highest priority type for coloring
    let bestConfig = this.colorManager.getTypeColor(nodeTypes[0]);
    for (const type of nodeTypes.slice(1)) {
      const config = this.colorManager.getTypeColor(type);
      if (config.priority > bestConfig.priority) {
        bestConfig = config;
      }
    }
    return bestConfig.color;
  }

  getHighlightStyle(nodeId: string): object | null {
    if (this.searchManager.isCurrentMatch(nodeId)) {
      return {
        ...this.searchManager.getHighlightStyle(),
        isCurrent: true,
      };
    }
    if (this.searchManager.isMatch(nodeId)) {
      return this.searchManager.getHighlightStyle();
    }
    return null;
  }

  private centerOnNode(nodeId: string): void {
    // Implementation: pan graph to center on node
  }

  private highlightNode(nodeId: string): void {
    // Implementation: apply highlight effect
  }

  private recolorNode(typeUri: string, color: string): void {
    // Implementation: update node colors
  }

  destroy(): void {
    this.searchManager.destroy();
    this.colorManager.destroy();
  }
}
```

## Keyboard Shortcuts

Default keyboard shortcuts for search:

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + F` | Open search box |
| `Enter` | Go to next match |
| `Shift + Enter` | Go to previous match |
| `Escape` | Clear search and close |
| `Ctrl/Cmd + G` | Go to next match (alternative) |
| `Ctrl/Cmd + Shift + G` | Go to previous match (alternative) |

## Best Practices

### Search Performance

1. **Use debounce**: Don't search on every keystroke (default 200ms is good)
2. **Limit results**: Keep `maxResults` reasonable (100 is default)
3. **Index types**: Provide `nodeTypes` map for better type searching
4. **Clear on close**: Call `clear()` when search UI closes

### Color Accessibility

1. **Use colorblind-safe palette**: For public/shared graphs
2. **Enable contrast checking**: Keep `enforceContrast: true`
3. **Provide legend**: Always show a type legend
4. **Allow customization**: Let users override colors

### UX Guidelines

1. **Live search**: Show results as user types
2. **Result count**: Display "X of Y matches"
3. **Navigate context**: Show context around matches
4. **Persistent colors**: Save user color preferences
5. **Clear feedback**: Highlight current match distinctly

## Troubleshooting

### No search results

**Problem**: Search returns no matches despite matching nodes existing.

**Solution**: Check search options and node data:
```typescript
console.log("Query:", searchManager.getState().query);
console.log("Options:", searchManager.getState().options);
console.log("Nodes count:", nodes.length);
console.log("Sample node:", nodes[0]);
```

### Colors not updating

**Problem**: Type colors don't change after calling `setTypeColor`.

**Solution**: Listen for events and re-render:
```typescript
colorManager.addEventListener((event) => {
  if (event.type === "color:change") {
    renderer.invalidate(); // Force re-render
  }
});
```

### Memory leaks

**Problem**: Memory usage grows over time.

**Solution**: Clean up properly:
```typescript
// On component unmount
searchManager.removeEventListener(handler);
searchManager.destroy();
colorManager.destroy();
```

## Related Guides

- [Filtering Guide](./filtering.md) - Filter nodes by type and properties
- [Styling Guide](./styling.md) - Customize node and edge appearance
- [Interactions Guide](./interactions.md) - Selection and navigation
- [Accessibility Guide](./accessibility.md) - Screen readers and keyboard navigation
