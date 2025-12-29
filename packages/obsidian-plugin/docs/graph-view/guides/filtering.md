# Filtering Guide

> Control graph visibility with powerful semantic filters

The Graph View provides a comprehensive filtering system that allows you to show or hide nodes and edges based on their types, properties, relationships, and more. This guide covers all filtering capabilities from basic type filters to advanced composite filters.

## Quick Start

### Using the Filter Panel

The Filter Panel is the primary UI for managing graph filters:

1. Click the filter icon in the graph toolbar to open the panel
2. Toggle node types on/off using checkboxes
3. Toggle edge types to show/hide specific relationships
4. Use quick filters (presets) for common filtering scenarios
5. Click "Reset" to clear all filters

### Programmatic Filtering

```typescript
import { FilterManager, createTypeFilter, generateFilterId } from "./presentation/renderers/graph";

// Get the filter manager
const filterManager = new FilterManager();

// Set graph data
filterManager.setGraphData(nodes, edges);

// Add a type filter to show only tasks
filterManager.addFilter({
  type: "type",
  id: generateFilterId("type"),
  enabled: true,
  typeUris: ["ems__Task"],
  include: true,
  includeSubclasses: false,
});

// Get filtered results
const { nodeIds, edgeIds } = filterManager.getFilteredResults();
```

## Filter Types

### Type Filters

Filter nodes by their RDF type (asset class). This is the most common filter type.

```typescript
import { createTypeFilter, generateFilterId } from "./presentation/renderers/graph";

// Show only tasks
const showTasks = createTypeFilter(
  generateFilterId("type"),
  ["ems__Task"],
  true,  // include = true means "show only these types"
  false  // includeSubclasses
);

// Hide projects (show everything except projects)
const hideProjects = createTypeFilter(
  generateFilterId("type"),
  ["ems__Project"],
  false, // include = false means "hide these types"
  false
);

filterManager.addFilter(showTasks);
```

**TypeFilter Properties:**
| Property | Type | Description |
|----------|------|-------------|
| `typeUris` | `string[]` | List of type URIs to filter (e.g., `"ems__Task"`, `"ems__Project"`) |
| `include` | `boolean` | `true` = show only these types, `false` = hide these types |
| `includeSubclasses` | `boolean` | Whether to include ontology subclasses |

### Predicate Filters

Filter based on edge types (relationships between nodes).

```typescript
import { createPredicateFilter, generateFilterId } from "./presentation/renderers/graph";

// Show only hierarchy relationships
const hierarchyOnly = createPredicateFilter(
  generateFilterId("predicate"),
  ["hierarchy", "ems__parentProject"],
  true,   // include
  "both"  // direction: "incoming" | "outgoing" | "both"
);

filterManager.addFilter(hierarchyOnly);
```

**PredicateFilter Properties:**
| Property | Type | Description |
|----------|------|-------------|
| `predicateUris` | `string[]` | List of predicate URIs to filter |
| `include` | `boolean` | `true` = show only these predicates, `false` = hide them |
| `direction` | `"incoming" \| "outgoing" \| "both"` | Filter by edge direction |

### Literal Filters

Filter nodes by property values with comparison operators.

```typescript
import { createLiteralFilter, generateFilterId } from "./presentation/renderers/graph";

// Filter tasks by status
const completedTasks = createLiteralFilter(
  generateFilterId("literal"),
  "ems__status",           // property predicate
  "equals",                // operator
  "completed"              // value
);

// Filter by numeric range
const recentItems = createLiteralFilter(
  generateFilterId("literal"),
  "ems__priority",
  "gte",                   // greater than or equal
  5
);

// Filter by date range
const dateRange = createLiteralFilter(
  generateFilterId("literal"),
  "ems__createdAt",
  "between",
  ["2024-01-01", "2024-12-31"]
);

filterManager.addFilter(completedTasks);
```

**Supported Operators:**
| Operator | Description | Example |
|----------|-------------|---------|
| `equals` | Exact string match | `value === "completed"` |
| `contains` | Substring match (case-insensitive) | `value.includes("task")` |
| `startsWith` | Prefix match (case-insensitive) | `value.startsWith("Project")` |
| `regex` | Regular expression match | `/^Task-\d+$/` |
| `gt` | Greater than (numeric) | `value > 5` |
| `lt` | Less than (numeric) | `value < 10` |
| `gte` | Greater than or equal | `value >= 5` |
| `lte` | Less than or equal | `value <= 10` |
| `between` | Range (inclusive) | `5 <= value <= 10` |

### Path Filters

Show nodes within a certain distance (hops) from a starting node. Uses BFS traversal.

```typescript
import { createPathFilter, generateFilterId } from "./presentation/renderers/graph";

// Show all nodes within 2 hops of a specific node
const neighborhood = createPathFilter(
  generateFilterId("path"),
  "node-123",          // starting node ID
  2,                   // max distance (hops)
  ["hierarchy", "references"]  // optional: restrict to specific predicates
);

filterManager.addFilter(neighborhood);
```

**PathFilter Properties:**
| Property | Type | Description |
|----------|------|-------------|
| `startNode` | `string` | ID of the starting node |
| `maxDistance` | `number` | Maximum number of hops from start |
| `predicates` | `string[]` | Optional: restrict traversal to specific edge types |

### Composite Filters

Combine multiple filters with logical operators (AND, OR, NOT).

```typescript
import { createCompositeFilter, createTypeFilter, generateFilterId } from "./presentation/renderers/graph";

// Create child filters
const tasksFilter = createTypeFilter(
  generateFilterId("type"),
  ["ems__Task"],
  true,
  false
);

const projectsFilter = createTypeFilter(
  generateFilterId("type"),
  ["ems__Project"],
  true,
  false
);

// Combine with OR: show tasks OR projects
const combinedFilter = createCompositeFilter(
  generateFilterId("composite"),
  "OR",
  [tasksFilter, projectsFilter]
);

filterManager.addFilter(combinedFilter);
```

**Composite Operators:**
| Operator | Behavior |
|----------|----------|
| `AND` | Show nodes matching ALL child filters |
| `OR` | Show nodes matching ANY child filter |
| `NOT` | Hide nodes matching the first child filter |

## Filter Panel UI

### FilterPanel Component

The `FilterPanel` component provides an interactive UI for managing filters:

```tsx
import { FilterPanel } from "./presentation/renderers/graph";

function MyGraphView() {
  const [visibleNodeTypes, setVisibleNodeTypes] = useState(new Set<string>());
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState(new Set<string>());

  return (
    <FilterPanel
      nodeTypes={["ems__Task", "ems__Project", "ems__Area"]}
      edgeTypes={["hierarchy", "references", "blocks"]}
      typeCounts={{
        nodeTypes: new Map([["ems__Task", 150], ["ems__Project", 25]]),
        edgeTypes: new Map([["hierarchy", 200], ["references", 50]]),
      }}
      activeFilters={[]}
      visibleNodeTypes={visibleNodeTypes}
      visibleEdgeTypes={visibleEdgeTypes}
      onToggleNodeType={(type) => {
        setVisibleNodeTypes((prev) => {
          const next = new Set(prev);
          if (next.has(type)) {
            next.delete(type);
          } else {
            next.add(type);
          }
          return next;
        });
      }}
      onToggleEdgeType={(type) => {
        setVisibleEdgeTypes((prev) => {
          const next = new Set(prev);
          if (next.has(type)) {
            next.delete(type);
          } else {
            next.add(type);
          }
          return next;
        });
      }}
      onResetFilters={() => {
        setVisibleNodeTypes(new Set());
        setVisibleEdgeTypes(new Set());
      }}
    />
  );
}
```

### Panel Configuration

Customize which filter sections are visible:

```typescript
import { FilterPanelConfig, DEFAULT_FILTER_PANEL_CONFIG } from "./presentation/renderers/graph";

const customConfig: FilterPanelConfig = {
  ...DEFAULT_FILTER_PANEL_CONFIG,
  showTypeFilters: true,        // Node type checkboxes
  showPredicateFilters: true,   // Edge type checkboxes
  showLiteralFilters: false,    // Property value filters (advanced)
  showPathFilters: false,       // Path distance filters (advanced)
  showCustomSPARQL: false,      // SPARQL query filters (expert)
  showPresets: true,            // Quick filter presets
};
```

### Quick Filter Presets

The Filter Panel includes built-in presets for common scenarios:

- **Show Tasks Only**: Filter to `ems__Task` type
- **Show Projects Only**: Filter to `ems__Project` type
- **Hierarchy Only**: Show only hierarchical relationships

## FilterManager API

### Core Methods

```typescript
const manager = new FilterManager();

// Set graph data
manager.setGraphData(nodes, edges);

// Add/remove/toggle filters
manager.addFilter(filter);
manager.removeFilter(filterId);
manager.toggleFilter(filterId);
manager.enableFilter(filterId);
manager.disableFilter(filterId);
manager.clearAllFilters();

// Get filtered results
const { nodeIds, edgeIds } = manager.getFilteredResults();
const { nodes, edges } = manager.getFilteredData();

// Check filter state
const hasFilters = manager.hasActiveFilters();
const count = manager.getEnabledFilterCount();
const filters = manager.getActiveFilters();
```

### Quick Filters

Convenience methods for creating common filters:

```typescript
// Quick filter by node type
const filterId = manager.quickFilterByType("ems__Task", true);

// Quick filter by edge type
const edgeFilterId = manager.quickFilterByEdgeType("hierarchy", true);

// Quick path filter from a node
const pathFilterId = manager.quickFilterByPath("node-123", 2);
```

### Filter Presets

Save and load filter configurations:

```typescript
// Save current filters as a preset
const preset = manager.savePreset("My Workflow", "Tasks and projects only");

// Load a preset
manager.loadPreset(preset.id);

// Get all presets
const presets = manager.getPresets();

// Delete a preset
manager.deletePreset(preset.id);
```

### Serialization

Export and import filters for persistence:

```typescript
// Export current filters to JSON
const filtersJson = manager.serializeFilters();

// Import filters from JSON
manager.loadFilters(filtersJson);
```

### Statistics

Get filtering statistics:

```typescript
const stats = manager.getStats();
// {
//   totalFilters: 3,
//   enabledFilters: 2,
//   totalNodes: 500,
//   filteredNodes: 125,
//   totalEdges: 1200,
//   filteredEdges: 300
// }
```

### Type Counts

Get counts for all node and edge types:

```typescript
const typeCounts = manager.getTypeCounts();
// {
//   nodeTypes: Map { "ems__Task" => 150, "ems__Project" => 25 },
//   edgeTypes: Map { "hierarchy" => 200, "references" => 50 }
// }

const nodeTypes = manager.getNodeTypes();  // ["ems__Area", "ems__Project", "ems__Task"]
const edgeTypes = manager.getEdgeTypes();  // ["hierarchy", "references", "blocks"]
```

### Event Subscription

React to filter changes:

```typescript
const unsubscribe = manager.subscribe((filteredNodeIds, filteredEdgeIds) => {
  console.log(`Visible: ${filteredNodeIds.size} nodes, ${filteredEdgeIds.size} edges`);
  // Update visualization...
});

// Later: unsubscribe
unsubscribe();
```

## Best Practices

### Performance Tips

1. **Use caching**: FilterManager automatically caches filter results
2. **Batch updates**: Add multiple filters before calling `getFilteredResults()`
3. **Prefer type filters**: They're the fastest filter type
4. **Limit path distance**: Keep `maxDistance` ≤ 3 for large graphs

### UX Guidelines

1. **Show counts**: Display node/edge counts in the filter panel
2. **Visual feedback**: Highlight which types are currently filtered
3. **Easy reset**: Always provide a "Reset All" button
4. **Presets**: Offer common filter combinations as presets
5. **Remember state**: Persist filter preferences across sessions

### Common Patterns

**Focus on a specific node:**
```typescript
// Show node and its immediate neighborhood
manager.clearAllFilters();
manager.quickFilterByPath(selectedNodeId, 1);
```

**Progressive disclosure:**
```typescript
// Start with high-level view, expand on demand
manager.quickFilterByType("ems__Area", true);

// Later: add projects
manager.addFilter(createTypeFilter(id, ["ems__Project"], true, false));

// Later: add tasks
manager.addFilter(createTypeFilter(id, ["ems__Task"], true, false));
```

**Exclusion pattern:**
```typescript
// Show everything except drafts
manager.addFilter(createLiteralFilter(
  generateFilterId("literal"),
  "ems__status",
  "equals",
  "draft"
).include = false);
```

## Troubleshooting

### Filter not working

**Problem**: Filter is added but nodes aren't hidden.

**Solution**: Check that `enabled: true` is set and call `getFilteredResults()`:
```typescript
const filter = manager.getFilter(filterId);
console.log("Filter enabled:", filter?.enabled);
```

### Type not found

**Problem**: `typeUris` don't match any nodes.

**Solution**: Check exact type URIs using:
```typescript
const nodeTypes = manager.getNodeTypes();
console.log("Available types:", nodeTypes);
```

### Edges still visible

**Problem**: Edges appear even though connected nodes are hidden.

**Solution**: FilterManager automatically hides edges when either endpoint is hidden. Verify with:
```typescript
const { nodeIds, edgeIds } = manager.getFilteredResults();
console.log("Visible edges:", edgeIds.size);
```

## Related Guides

- [Search Guide](./search.md) - Find nodes by text search
- [Styling Guide](./styling.md) - Customize node/edge appearance
- [Interactions Guide](./interactions.md) - Selection and navigation
- [Performance Guide](./performance.md) - Optimize large graph filtering
