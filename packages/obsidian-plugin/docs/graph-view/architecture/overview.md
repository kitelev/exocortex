# Architecture Overview

The Graph View module follows Clean Architecture principles with clear separation of concerns between layers.

## Architectural Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │   React     │ │   PixiJS    │ │    DOM Renderers        ││
│  │ Components  │ │  Renderer   │ │ (Tooltips, Menus)       ││
│  └─────────────┘ └─────────────┘ └─────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │  Managers   │ │  Services   │ │      Controllers        ││
│  │ (Selection, │ │ (Layout,    │ │   (Viewport, Focus)     ││
│  │  Hover)     │ │  Animation) │ │                         ││
│  └─────────────┘ └─────────────┘ └─────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Domain Layer                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │   Entities  │ │   Values    │ │      Algorithms         ││
│  │ (GraphNode, │ │ (Position,  │ │  (ForceSimulation,      ││
│  │  GraphEdge) │ │  Viewport)  │ │   HierarchicalLayout)   ││
│  └─────────────┘ └─────────────┘ └─────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Infrastructure Layer                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │  WebGL/GPU  │ │ Triple Store│ │      File System        ││
│  │  Rendering  │ │   Adapter   │ │       Adapter           ││
│  └─────────────┘ └─────────────┘ └─────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Presentation Layer

**GraphLayoutRenderer** (React Component)
- Entry point for embedding graphs
- Props-driven configuration
- Manages component lifecycle

**PixiGraphRenderer** (WebGL2)
- Hardware-accelerated rendering
- Manages PixiJS application
- Handles canvas and viewport

**Sub-Renderers**
- `NodeRenderer` - Node shapes and styles
- `EdgeRenderer` - Edge curves and arrows
- `LabelRenderer` - Text labels
- `BatchedNodeRenderer` - Instanced drawing

### 2. Application Layer

**Interaction Managers**
- `SelectionManager` - Node/edge selection
- `HoverManager` - Hover states and tooltips
- `KeyboardManager` - Keyboard shortcuts
- `NavigationManager` - Spatial navigation
- `ContextMenuManager` - Right-click menus

**Controllers**
- `ViewportController` - Pan/zoom
- `FocusIndicator` - Focus visualization

**Services**
- `LayoutManager` - Layout transitions
- `AnimationSystem` - Smooth animations
- `FilterManager` - Data filtering

### 3. Domain Layer

**Entities**
- `GraphNode` - Node data and state
- `GraphEdge` - Edge connections
- `SimulationNode` - Physics properties

**Value Objects**
- `Position` - 2D coordinates
- `Viewport` - View transform
- `NodeStyle` - Visual properties

**Algorithms**
- `ForceSimulation` - Force-directed layout
- `HierarchicalLayout` - Tree/DAG layout
- `RadialLayout` - Circular layout
- `TemporalLayout` - Timeline layout
- `CommunityDetection` - Louvain algorithm
- `BarnesHutForce` - O(n log n) forces
- `Quadtree` - Spatial indexing

### 4. Infrastructure Layer

**Rendering**
- WebGL2 context management
- Texture atlas
- Object pooling
- GPU memory management

**Data Access**
- Triple store adapters
- File system adapters
- Cache management

## Data Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Input     │     │   Process    │     │    Output    │
│              │     │              │     │              │
│ • Props      │────▶│ • Layout     │────▶│ • Render     │
│ • Events    │     │ • Simulation │     │ • DOM        │
│ • Data      │     │ • Filter     │     │ • Events     │
└──────────────┘     └──────────────┘     └──────────────┘
                           │
                           ▼
                     ┌───────────┐
                     │   State   │
                     │ • Nodes   │
                     │ • Edges   │
                     │ • Viewport│
                     │ • Select  │
                     └───────────┘
```

### State Management

State is managed through specialized managers, each owning its domain:

```typescript
// Selection state owned by SelectionManager
selectionManager.selectNodes(["node-1", "node-2"]);
const selected = selectionManager.getSelectedNodes();

// Viewport state owned by ViewportController
viewportController.zoomTo(2);
const viewport = viewportController.getViewport();

// Simulation state owned by ForceSimulation
simulation.alpha(1).restart();
const nodes = simulation.nodes();
```

### Event Flow

```
User Input (Mouse/Keyboard)
         │
         ▼
┌─────────────────┐
│ Event Listener  │  (DOM events)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Input Manager   │  (HoverManager, KeyboardManager)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ State Update    │  (SelectionManager, ViewportController)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Event Emission  │  (on("select"), on("change"))
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Render Update   │  (IncrementalRenderer, DirtyTracker)
└─────────────────┘
```

## Module Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│                     graph/index.ts                          │
│                     (Public API)                            │
└─────────────────────────────────────────────────────────────┘
         │
         ├──────────────────────────────────────────┐
         ▼                                          ▼
┌─────────────────┐                    ┌─────────────────────┐
│ GraphLayout     │                    │ ForceSimulation     │
│ Renderer        │                    │ (Physics)           │
└────────┬────────┘                    └──────────┬──────────┘
         │                                        │
         ▼                                        ▼
┌─────────────────┐                    ┌─────────────────────┐
│ PixiGraph       │                    │ BarnesHutForce      │
│ Renderer        │                    │ Quadtree            │
└────────┬────────┘                    └─────────────────────┘
         │
         ├──────────────────────────────────────────┐
         ▼                                          ▼
┌─────────────────┐                    ┌─────────────────────┐
│ NodeRenderer    │                    │ SelectionManager    │
│ EdgeRenderer    │                    │ HoverManager        │
│ LabelRenderer   │                    │ ViewportController  │
└─────────────────┘                    └─────────────────────┘
```

## Key Design Decisions

### 1. Separation of Rendering and Logic

Rendering is isolated from business logic:
- Managers don't know about PixiJS
- Renderers don't know about selection logic
- This enables testing and future renderer swaps

### 2. Event-Driven Communication

Components communicate via events:
- Loose coupling between modules
- Easy to add new listeners
- Supports undo/redo patterns

### 3. Immutable State Updates

State updates create new objects:
- Predictable state changes
- Easy diffing for incremental rendering
- Supports time-travel debugging

### 4. Progressive Enhancement

Features degrade gracefully:
- WebGPU → WebGL2 → Canvas fallback
- High performance → Medium → Basic
- Full accessibility → Reduced features

## See Also

- [Domain Model](./domain-model.md) - Entity details
- [Data Flow](./data-flow.md) - State management
- [Extension Points](./extension-points.md) - Plugin architecture
