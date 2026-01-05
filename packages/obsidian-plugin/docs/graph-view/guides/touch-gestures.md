# Touch Gesture Support

The Touch Gesture system provides mobile and iPad support for graph interaction, including tap, long-press, pinch-to-zoom, and multi-finger navigation.

## Overview

The `TouchGestureManager` handles touch-specific interactions that complement mouse-based interactions:

- **Tap**: Select nodes (equivalent to click)
- **Double-tap**: Zoom to fit or focus on node
- **Long-press**: Show context menu
- **Pinch-to-zoom**: Handled by OrbitControls
- **Two-finger rotation**: Handled by OrbitControls
- **Single-finger pan**: Handled by OrbitControls

## Basic Usage

```typescript
import { TouchGestureManager } from "./presentation/renderers/graph/3d";

// Create manager attached to canvas
const touchManager = new TouchGestureManager(canvas, {
  tapThreshold: 10,
  longPressTimeout: 500,
});

// Handle tap events
touchManager.on("tap", (event) => {
  const node = hitTest(event.x, event.y);
  if (node) {
    selectNode(node.id);
  }
});

// Handle long-press for context menu
touchManager.on("longPress", (event) => {
  const node = hitTest(event.x, event.y);
  showContextMenu(event.x, event.y, node);
});

// Handle double-tap to zoom
touchManager.on("doubleTap", (event) => {
  zoomToFit();
});
```

## Configuration

```typescript
interface TouchGestureConfig {
  /** Maximum movement (in pixels) before tap becomes a drag */
  tapThreshold: number;

  /** Maximum time (in ms) for a touch to count as a tap */
  tapTimeout: number;

  /** Time (in ms) to trigger long press */
  longPressTimeout: number;

  /** Enable haptic feedback on supported devices */
  enableHapticFeedback: boolean;

  /** Enable double-tap to zoom to fit */
  enableDoubleTap: boolean;

  /** Double-tap maximum interval (in ms) */
  doubleTapTimeout: number;
}

// Default configuration
const DEFAULT_CONFIG: TouchGestureConfig = {
  tapThreshold: 10,
  tapTimeout: 300,
  longPressTimeout: 500,
  enableHapticFeedback: true,
  enableDoubleTap: true,
  doubleTapTimeout: 300,
};
```

## Event Types

### Tap Event

Single finger tap (quick touch and release):

```typescript
touchManager.on("tap", (event) => {
  console.log("Tap at:", event.x, event.y);
  // event.originalEvent contains the native TouchEvent
});
```

### Double Tap Event

Two taps in quick succession:

```typescript
touchManager.on("doubleTap", (event) => {
  console.log("Double tap at:", event.x, event.y);
  // Typically used to zoom to fit or focus on element
});
```

### Long Press Event

Touch held for a duration:

```typescript
touchManager.on("longPress", (event) => {
  console.log("Long press at:", event.x, event.y);
  // Typically used to show context menu
});
```

### Touch Lifecycle Events

Track touch start, move, and end:

```typescript
touchManager.on("touchStart", (event) => {
  console.log("Touch started:", event.touchCount, "fingers");
});

touchManager.on("touchMove", (event) => {
  console.log("Touch moving at:", event.x, event.y);
});

touchManager.on("touchEnd", (event) => {
  console.log("Touch ended");
});
```

## Event Data Structure

```typescript
interface TouchGestureEvent {
  /** Event type */
  type: TouchGestureEventType;

  /** X position relative to element */
  x: number;

  /** Y position relative to element */
  y: number;

  /** Original native TouchEvent */
  originalEvent?: TouchEvent;

  /** Number of active touches */
  touchCount?: number;
}
```

## Integration with OrbitControls

OrbitControls handles multi-touch gestures automatically. TouchGestureManager focuses on selection interactions:

```typescript
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

// OrbitControls handles pinch/rotate/pan
const controls = new OrbitControls(camera, canvas);
controls.enableRotate = true;
controls.enableZoom = true;
controls.enablePan = true;

// TouchGestureManager handles tap/longpress
const touchManager = new TouchGestureManager(canvas);

// Both can coexist - TouchGestureManager doesn't interfere with multi-touch
```

## Haptic Feedback

Enable vibration feedback on supported devices:

```typescript
const touchManager = new TouchGestureManager(canvas, {
  enableHapticFeedback: true,
});

// Haptic feedback triggers automatically on:
// - Tap (selection feedback)
// - Long press (context menu feedback)
// - Double tap (zoom feedback)

// Programmatically trigger haptic
if ("vibrate" in navigator) {
  navigator.vibrate(10); // 10ms vibration
}
```

## Device Detection

Check if touch is available:

```typescript
// Static method to check touch support
if (TouchGestureManager.isTouchDevice()) {
  const touchManager = new TouchGestureManager(canvas);
  // Setup touch handlers
} else {
  // Setup mouse handlers only
}
```

## Coordinate Transformation

Touch coordinates are relative to the element. For world coordinates:

```typescript
touchManager.on("tap", (event) => {
  // Screen coordinates (relative to element)
  const screenX = event.x;
  const screenY = event.y;

  // Convert to world coordinates
  const worldPos = viewportController.screenToWorld(screenX, screenY);

  // Hit test in world space
  const node = findNodeAtWorldPosition(worldPos.x, worldPos.y);
});
```

## Platform-Specific Considerations

### iOS Safari

```typescript
// Prevent default touch behaviors that interfere
canvas.style.touchAction = "none";

// Prevent scroll bounce
document.body.style.overscrollBehavior = "none";

// Prevent text selection on long press
canvas.style.webkitUserSelect = "none";
canvas.style.userSelect = "none";
```

### Android Chrome

```typescript
// Prevent context menu on long press (handled by TouchGestureManager)
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// Handle browser back gesture conflicts
// Ensure sufficient padding from screen edges
```

### iPad/Tablet

```typescript
// Consider larger tap targets for stylus
const config = {
  tapThreshold: 15, // Slightly larger for stylus precision
  longPressTimeout: 400, // Slightly shorter for stylus
};
```

## Integration Example

Complete touch integration for graph view:

```typescript
import {
  TouchGestureManager,
  PixiGraphRenderer,
  ViewportController,
  SelectionManager,
  ContextMenuManager,
} from "./presentation/renderers/graph";

// Create managers
const renderer = new PixiGraphRenderer(container);
const viewport = new ViewportController(container);
const selection = new SelectionManager();
const contextMenu = new ContextMenuManager();

// Setup touch gestures
const touchManager = new TouchGestureManager(container, {
  tapThreshold: 10,
  longPressTimeout: 500,
  enableDoubleTap: true,
  enableHapticFeedback: true,
});

// Tap to select
touchManager.on("tap", (event) => {
  const worldPos = viewport.screenToWorld(event.x, event.y);
  const node = renderer.hitTest(worldPos.x, worldPos.y);

  if (node) {
    selection.select(node.id);
  } else {
    selection.clearSelection();
  }
});

// Double-tap to focus
touchManager.on("doubleTap", (event) => {
  const worldPos = viewport.screenToWorld(event.x, event.y);
  const node = renderer.hitTest(worldPos.x, worldPos.y);

  if (node) {
    viewport.focusOnNode(node);
  } else {
    viewport.fitToView();
  }
});

// Long-press for context menu
touchManager.on("longPress", (event) => {
  const worldPos = viewport.screenToWorld(event.x, event.y);
  const node = renderer.hitTest(worldPos.x, worldPos.y);

  if (node) {
    contextMenu.showForNode(node.id, { x: event.x, y: event.y });
  } else {
    contextMenu.showForCanvas(worldPos, { x: event.x, y: event.y });
  }
});

// Cleanup
function destroy() {
  touchManager.destroy();
  viewport.destroy();
  selection.destroy();
  contextMenu.destroy();
  renderer.destroy();
}
```

## Runtime Configuration

Update configuration at runtime:

```typescript
// Update config
touchManager.setConfig({
  longPressTimeout: 600,
  enableHapticFeedback: false,
});

// Get current config
const config = touchManager.getConfig();
console.log("Current tap threshold:", config.tapThreshold);
```

## Cleanup

Always destroy the manager when done:

```typescript
// In component cleanup
touchManager.destroy();

// This removes all event listeners from the element
// and clears internal state
```

## See Also

- [Interactions](./interactions.md) - Mouse and keyboard interactions
- [Context Menus](./context-menus.md) - Context menu system
- [Accessibility](./accessibility.md) - Accessibility features
