# Migration Guide

This guide covers upgrading between major versions of Graph View.

## Version History

| Version | Release | Key Changes |
|---------|---------|-------------|
| v1.0.0 | 2024-Q4 | Initial stable release |

## Migrating to v1.0.0

If you're upgrading from pre-release versions, follow these steps.

### Breaking Changes

#### 1. Module Imports

**Before:**
```typescript
import { GraphRenderer } from "@exocortex/obsidian-plugin/graph";
import { ForceSimulation } from "@exocortex/obsidian-plugin/physics";
```

**After:**
```typescript
import { PixiGraphRenderer, ForceSimulation } from "./presentation/renderers/graph";
```

All graph-related exports are now available from the main package entry point.

#### 2. GraphLayoutRenderer Props

**Before:**
```typescript
<GraphLayoutRenderer
  data={{ nodes, edges }}
  config={options}
  onSelect={handleSelect}
/>
```

**After:**
```typescript
<GraphLayoutRenderer
  layout={layoutDefinition}
  nodes={nodes}
  edges={edges}
  options={options}
  onNodeClick={handleNodeClick}
  onEdgeClick={handleEdgeClick}
/>
```

The `data` prop is split into `nodes` and `edges`. The `config` prop is renamed to `options`. Event handlers are renamed for clarity.

#### 3. Force Configuration

**Before:**
```typescript
simulation.force("charge", {
  type: "manyBody",
  strength: -300,
});
```

**After:**
```typescript
import { forceManyBody } from "./presentation/renderers/graph";

simulation.force("charge", forceManyBody().strength(-300));
```

Forces now use a d3-force compatible API.

#### 4. Event System

**Before:**
```typescript
renderer.addEventListener("select", callback);
renderer.removeEventListener("select", callback);
```

**After:**
```typescript
selectionManager.on("select", callback);
selectionManager.off("select", callback);
```

Events are now emitted by specialized managers, not the renderer.

#### 5. Viewport Control

**Before:**
```typescript
renderer.setZoom(2);
renderer.panTo(100, 100);
```

**After:**
```typescript
viewportController.zoomTo(2);
viewportController.panTo(100, 100);
```

Viewport control is now handled by `ViewportController`.

### New Features in v1.0.0

#### Layout Algorithms

```typescript
import {
  HierarchicalLayout,
  RadialLayout,
  TemporalLayout,
  LayoutManager,
} from "./presentation/renderers/graph";

// Switch layouts with animation
const layoutManager = new LayoutManager();
await layoutManager.transitionTo("hierarchical", {
  direction: "TB",
  duration: 500,
});
```

#### Accessibility

```typescript
import { AccessibilityManager } from "./presentation/renderers/graph";

const a11yManager = new AccessibilityManager({
  screenReaderSupport: true,
  keyboardNavigation: true,
  highContrast: "auto",
});
```

#### Performance Optimization

```typescript
import {
  LODSystem,
  VisibilityCuller,
  BatchedNodeRenderer,
} from "./presentation/renderers/graph";

// Automatic performance optimization
const autoOptimizer = new AutoOptimizer({ targetFPS: 60 });
```

### Migration Script

For automated migration of import statements:

```bash
# Install codemod
npm install -g jscodeshift

# Run migration
jscodeshift -t ./codemods/graph-v1-imports.js src/**/*.ts
```

Example codemod (`codemods/graph-v1-imports.js`):
```javascript
module.exports = function(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // Update import paths
  root
    .find(j.ImportDeclaration)
    .filter((path) =>
      path.node.source.value.includes("@exocortex/obsidian-plugin/graph")
    )
    .forEach((path) => {
      path.node.source.value = "@exocortex/obsidian-plugin";
    });

  // Rename GraphRenderer to PixiGraphRenderer
  root
    .find(j.Identifier, { name: "GraphRenderer" })
    .forEach((path) => {
      path.node.name = "PixiGraphRenderer";
    });

  return root.toSource();
};
```

### Deprecations

The following are deprecated and will be removed in v2.0:

| Deprecated | Replacement |
|------------|-------------|
| `GraphRenderer` | `PixiGraphRenderer` |
| `simulation.configure(object)` | `simulation.force(name, force)` |
| `renderer.on(event)` | Manager-specific `.on()` methods |
| `options.d3Config` | Direct force configuration |

### Testing After Migration

1. **Visual Regression**
   ```bash
   npm run test:visual
   ```

2. **Type Checking**
   ```bash
   npm run typecheck
   ```

3. **Unit Tests**
   ```bash
   npm run test:unit -- --testPathPattern=graph
   ```

4. **Integration Tests**
   ```bash
   npm run test:integration
   ```

## Future Versions

### Planned for v1.1

- WebGPU renderer (opt-in)
- Edge bundling improvements
- Additional layout algorithms

### Planned for v2.0

- Complete WebGPU support
- Breaking: Remove deprecated APIs
- New plugin architecture

## Getting Help

If you encounter issues during migration:

1. Check the [Troubleshooting Guide](../getting-started/installation.md#troubleshooting)
2. Search [existing issues](https://github.com/kitelev/exocortex/issues)
3. Open a [new issue](https://github.com/kitelev/exocortex/issues/new) with:
   - Previous version
   - Target version
   - Error messages
   - Minimal reproduction

## See Also

- [Installation](../getting-started/installation.md) - Setup guide
- [Configuration](../getting-started/configuration.md) - Full options
- [API Reference](../api/index.md) - Current API
