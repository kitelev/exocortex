# Installation

This guide covers installing and setting up the Graph View module for use in your Obsidian plugin or standalone application.

## Package Installation

The Graph View is part of the `@exocortex/obsidian-plugin` package:

```bash
npm install @exocortex/obsidian-plugin
```

Or with yarn:

```bash
yarn add @exocortex/obsidian-plugin
```

## Peer Dependencies

The Graph View requires these peer dependencies:

```json
{
  "peerDependencies": {
    "obsidian": "^1.4.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

### Optional Dependencies

For enhanced features, install these optional dependencies:

```bash
# Three.js for 3D visualization
npm install three @types/three

# WebGPU types for GPU physics
npm install @webgpu/types
```

## Browser Requirements

### Required: WebGL2

The Graph View uses PixiJS v8 with WebGL2 for rendering. All modern browsers support WebGL2:

- Chrome 56+
- Firefox 51+
- Safari 15+
- Edge 79+

Check WebGL2 support programmatically:

```typescript
function checkWebGL2Support(): boolean {
  const canvas = document.createElement("canvas");
  return !!canvas.getContext("webgl2");
}
```

### Optional: WebGPU

For accelerated physics simulation on large graphs (10K+ nodes), WebGPU is recommended:

- Chrome 113+
- Edge 113+
- Firefox (behind flag)
- Safari 17+ (limited)

Check WebGPU support:

```typescript
import { isWebGPUAvailable } from "./presentation/renderers/graph";

if (await isWebGPUAvailable()) {
  console.log("WebGPU acceleration available!");
}
```

## TypeScript Configuration

Ensure your `tsconfig.json` includes these settings:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "jsx": "react-jsx",
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  }
}
```

## Build Configuration

### Vite

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["@exocortex/obsidian-plugin"],
  },
  build: {
    rollupOptions: {
      external: ["obsidian"],
    },
  },
});
```

### esbuild (Obsidian Plugin)

```typescript
// esbuild.config.ts
import esbuild from "esbuild";

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  // Important: handle JSX for React components
  loader: { ".tsx": "tsx", ".ts": "ts" },
  jsx: "automatic",
});
```

## Importing Components

### Named Imports (Recommended)

```typescript
import {
  // Main components
  GraphLayoutRenderer,
  PixiGraphRenderer,
  ForceSimulation,

  // Layout algorithms
  HierarchicalLayout,
  RadialLayout,
  TemporalLayout,
  LayoutManager,

  // Forces
  forceCenter,
  forceLink,
  forceManyBody,
  forceCollide,

  // Utilities
  buildGraphData,
  detectCommunities,
} from "./presentation/renderers/graph";
```

### Type Imports

```typescript
import type {
  GraphNode,
  GraphEdge,
  GraphData,
  GraphLayoutOptions,
  SimulationNode,
  SimulationLink,
} from "./presentation/renderers/graph";
```

## Verifying Installation

Run this code to verify the installation:

```typescript
import { ForceSimulation, forceCenter } from "./presentation/renderers/graph";

const simulation = new ForceSimulation();
simulation.force("center", forceCenter(400, 300));

console.log("Graph View installed successfully!");
console.log("Alpha:", simulation.alpha());
```

## Next Steps

- [Basic Usage](./basic-usage.md) - Create your first graph
- [Obsidian Integration](./obsidian-integration.md) - Integrate with Obsidian
- [Configuration](./configuration.md) - Full configuration reference
