# Accessibility Guide

This guide covers WCAG 2.1 AA compliance for Graph View, including screen reader support, keyboard navigation, high contrast modes, and the VirtualCursor system.

## Table of Contents

- [WCAG 2.1 AA Compliance Overview](#wcag-21-aa-compliance-overview)
- [AccessibilityManager](#accessibilitymanager)
- [VirtualCursor Navigation](#virtualcursor-navigation)
- [Keyboard Navigation](#keyboard-navigation)
- [Screen Reader Support](#screen-reader-support)
- [High Contrast Mode](#high-contrast-mode)
- [Reduced Motion](#reduced-motion)
- [Skip Links](#skip-links)
- [Focus Management](#focus-management)
- [Color Contrast Utilities](#color-contrast-utilities)
- [Testing Accessibility](#testing-accessibility)
- [Best Practices](#best-practices)

## WCAG 2.1 AA Compliance Overview

Graph View implements WCAG 2.1 Level AA compliance:

| Criterion | Implementation |
|-----------|----------------|
| 1.1.1 Non-text Content | Alt text for nodes, ARIA labels |
| 1.4.1 Use of Color | Shape + color encoding |
| 1.4.3 Contrast (Minimum) | 4.5:1 text, 3:1 UI components |
| 1.4.11 Non-text Contrast | 3:1 for all graph elements |
| 2.1.1 Keyboard | Full keyboard navigation |
| 2.4.7 Focus Visible | Focus indicator ring |
| 4.1.2 Name, Role, Value | ARIA landmarks and live regions |

## AccessibilityManager

The `AccessibilityManager` is the main orchestrator for all accessibility features. It coordinates screen reader announcements, keyboard navigation, high contrast mode, and reduced motion preferences.

### Creating an AccessibilityManager

```typescript
import {
  AccessibilityManager,
  createAccessibilityManager,
  DEFAULT_ACCESSIBILITY_MANAGER_CONFIG,
} from "./presentation/renderers/graph";

// Using the factory function (recommended)
const a11y = createAccessibilityManager(container, {
  enableScreenReader: true,
  enableKeyboardNav: true,
  announceSelections: true,
  announceNavigations: true,
});

// Or using the constructor
const a11y = new AccessibilityManager(container, {
  virtualCursor: {
    wrapAround: true,
    defaultMode: "spatial",
  },
  highContrastColors: {
    foreground: "#FFFFFF",
    background: "#000000",
  },
});
```

### Configuration Options

The `AccessibilityManagerConfig` extends `A11yConfig` with additional options:

```typescript
interface AccessibilityManagerConfig {
  // Screen reader settings
  enableScreenReader: boolean;        // Enable screen reader announcements (default: true)
  announceSelections: boolean;        // Announce node selections (default: true)
  announceNavigations: boolean;       // Announce navigation changes (default: true)
  announceGraphChanges: boolean;      // Announce graph structure changes (default: true)
  announcementDelay: number;          // Delay between announcements in ms (default: 500)
  announcementDebounce: number;       // Debounce time for announcements in ms (default: 150)

  // Keyboard navigation
  enableKeyboardNav: boolean;         // Enable keyboard navigation (default: true)
  virtualCursorMode: VirtualCursorMode; // Navigation mode: "spatial" | "linear" | "semantic"

  // Visual preferences
  respectReducedMotion: boolean;      // Respect prefers-reduced-motion (default: true)
  highContrastMode: boolean;          // Enable high contrast mode (default: auto-detected)
  focusIndicatorSize: number;         // Focus indicator size in pixels (default: 3)

  // Skip links
  enableSkipLinks: boolean;           // Enable skip links (default: true)

  // Graph description
  graphRoleDescription: string;       // Role description (default: "Knowledge graph visualization")

  // Virtual cursor configuration
  virtualCursor?: Partial<VirtualCursorConfig>;

  // Custom high contrast colors
  highContrastColors?: HighContrastColors;

  // Custom skip links
  skipLinks?: SkipLink[];
}
```

### Setting Graph Data

Provide nodes and edges to the manager for accessibility features:

```typescript
const nodes: GraphNode[] = [
  { id: "node1", label: "Project Alpha", path: "/alpha.md", x: 0, y: 0, group: "Project" },
  { id: "node2", label: "Task Beta", path: "/beta.md", x: 100, y: 0, group: "Task" },
];

const edges: GraphEdge[] = [
  { id: "edge1", source: "node1", target: "node2", label: "contains" },
];

a11y.setGraphData(nodes, edges);
```

### Making Announcements

Screen reader announcements use ARIA live regions:

```typescript
// Polite announcement (non-urgent, waits for screen reader to finish current speech)
a11y.announce("Navigated to Project Alpha", "navigation", "polite");

// Assertive announcement (urgent, interrupts current speech)
a11y.announce("Error loading graph data", "error", "assertive");

// Announcement types: "navigation" | "selection" | "action" | "structure" | "error" | "help" | "status"
```

### Event Handling

Listen to accessibility events:

```typescript
// Navigation events
a11y.on("a11y:navigation", (event) => {
  console.log(`Navigated to: ${event.nodeId}`);
  console.log(`Previous node: ${event.previousNodeId}`);
});

// Selection changes
a11y.on("a11y:selection:change", (event) => {
  console.log(`Selection changed: ${event.nodeId}`);
});

// Configuration changes
a11y.on("a11y:config:change", (event) => {
  console.log("Config updated:", event.config);
});

// Announcements
a11y.on("a11y:announcement", (event) => {
  console.log(`Announced: ${event.message}`);
});

// Mode changes
a11y.on("a11y:mode:change", (event) => {
  console.log(`Navigation mode: ${event.mode}`);
});

// Remove listeners
a11y.off("a11y:navigation", myListener);
```

### Cleanup

Always destroy the manager when done:

```typescript
a11y.destroy();
```

## VirtualCursor Navigation

The `VirtualCursor` provides screen reader-friendly virtual cursor navigation with three modes:
- **Spatial**: Navigate to nearest node in arrow key direction
- **Linear**: Navigate through nodes in order (Tab/Shift+Tab)
- **Semantic**: Navigate by node type or relationship

### Creating a VirtualCursor

```typescript
import {
  VirtualCursor,
  createVirtualCursor,
  DEFAULT_VIRTUAL_CURSOR_CONFIG,
} from "./presentation/renderers/graph";

const cursor = createVirtualCursor({
  maxHistorySize: 50,        // Maximum navigation history entries
  wrapAround: true,          // Wrap to start/end when reaching boundaries
  defaultMode: "spatial",    // Default navigation mode
  directionTolerance: 45,    // Angular tolerance for spatial navigation (degrees)
  onPositionChange: (nodeId, previousNodeId) => {
    console.log(`Moved from ${previousNodeId} to ${nodeId}`);
  },
  onModeChange: (mode) => {
    console.log(`Mode changed to ${mode}`);
  },
});
```

### Setting Nodes and Connections

```typescript
// Set nodes
cursor.setNodes(graphNodes);

// Update connection information
cursor.updateConnections([
  { source: "node1", target: "node2", label: "contains" },
  { source: "node1", target: "node3", label: "links to" },
]);
```

### Navigation Methods

```typescript
// Spatial/Linear navigation (depends on current mode)
cursor.navigate("up");       // Move up (spatial) or previous (linear)
cursor.navigate("down");     // Move down (spatial) or next (linear)
cursor.navigate("left");     // Move left (spatial)
cursor.navigate("right");    // Move right (spatial)
cursor.navigate("next");     // Next node in order
cursor.navigate("previous"); // Previous node in order
cursor.navigate("first");    // First node
cursor.navigate("last");     // Last node

// Navigate returns result object
const result = cursor.navigate("right");
if (result.success) {
  console.log(`Navigated to ${result.nodeId}`);
}

// Semantic navigation - navigate by node type
cursor.navigateToType("Task", true);   // Next Task node
cursor.navigateToType("Project", false); // Previous Project node

// Navigate to connected node by index
cursor.navigateToConnection(0); // First connected node
cursor.navigateToConnection(1); // Second connected node
```

### History Navigation

```typescript
// Check if history navigation is available
if (cursor.canGoBack()) {
  cursor.goBack();
}

if (cursor.canGoForward()) {
  cursor.goForward();
}

// Clear navigation history
cursor.clearHistory();
```

### Position and State

```typescript
// Get current position
const nodeId = cursor.getCurrentNodeId();

// Get current node with accessibility info
const a11yNode = cursor.getCurrentNode();
if (a11yNode) {
  console.log(`Label: ${a11yNode.label}`);
  console.log(`Type: ${a11yNode.type}`);
  console.log(`Connections: ${a11yNode.connectionCount}`);
  console.log(`Connected to: ${a11yNode.connectedTo.join(", ")}`);
}

// Set position directly
cursor.setPosition("node2");

// Get all accessible nodes
const allNodes = cursor.getA11yNodes();
```

### Mode Management

```typescript
// Get current mode
const mode = cursor.getMode(); // "spatial" | "linear" | "semantic"

// Set mode
cursor.setMode("linear");
cursor.setMode("semantic");
cursor.setMode("spatial");
```

### Activation State

```typescript
// Activate cursor (focuses first node if no position set)
cursor.activate();

// Check if active
if (cursor.isActive()) {
  // Handle active state
}

// Deactivate cursor
cursor.deactivate();

// Reset cursor to initial state
cursor.reset();
```

### Event Handling

```typescript
cursor.on("cursor:move", (event) => {
  console.log(`Moved to ${event.nodeId} from ${event.previousNodeId}`);
});

cursor.on("cursor:mode:change", (event) => {
  console.log(`Mode changed to ${event.mode}`);
});

cursor.on("cursor:activate", () => {
  console.log("Cursor activated");
});

cursor.on("cursor:deactivate", () => {
  console.log("Cursor deactivated");
});

// Remove listener
cursor.off("cursor:move", myListener);
```

## Keyboard Navigation

### Default Key Bindings

| Key | Action |
|-----|--------|
| Arrow Up | Navigate up (spatial mode) |
| Arrow Down | Navigate down (spatial mode) |
| Arrow Left | Navigate left (spatial mode) |
| Arrow Right | Navigate right (spatial mode) |
| Tab | Navigate to next node |
| Shift+Tab | Navigate to previous node |
| Home | Navigate to first node |
| End | Navigate to last node |
| Alt+Backspace | Go back in navigation history |
| BrowserBack | Go back in navigation history |
| BrowserForward | Go forward in navigation history |
| Alt+M | Cycle navigation mode (spatial → linear → semantic) |
| ? | Announce keyboard shortcuts help |

### Customizing Keyboard Behavior

The AccessibilityManager handles keyboard events internally. You can disable keyboard navigation:

```typescript
const a11y = new AccessibilityManager(container, {
  enableKeyboardNav: false, // Disable built-in keyboard handling
});
```

## Screen Reader Support

### Supported Screen Readers

The accessibility system supports major screen readers:

| Screen Reader | Platform | Support Level |
|---------------|----------|---------------|
| NVDA | Windows | Full |
| JAWS | Windows | Full |
| VoiceOver | macOS/iOS | Full |
| Narrator | Windows | Good (limited SVG) |
| Orca | Linux | Full |

### ARIA Landmarks

The graph container is set up with proper ARIA attributes:

```html
<div
  role="application"
  tabindex="0"
  aria-roledescription="Knowledge graph visualization"
  aria-labelledby="exo-graph-label-xyz"
  aria-describedby="exo-graph-instructions-xyz"
>
  <span id="exo-graph-label-xyz" class="exo-a11y-label">
    Knowledge graph visualization
  </span>
  <span id="exo-graph-instructions-xyz" class="exo-a11y-instructions">
    Use arrow keys to navigate between nodes. Press Enter to open a node. Press Escape to exit.
  </span>
</div>
```

### Live Regions

Two live regions are created for announcements:

- **Polite** (role="status", aria-live="polite"): Non-urgent announcements
- **Assertive** (role="alert", aria-live="assertive"): Urgent announcements

### Detecting Screen Reader Type

```typescript
const screenReaderType = a11y.detectScreenReader();
// Returns: "nvda" | "jaws" | "voiceover" | "narrator" | "orca" | "unknown"

// Get capabilities for a screen reader type
import { getScreenReaderCapabilities } from "./presentation/renderers/graph";

const capabilities = getScreenReaderCapabilities("voiceover");
console.log(capabilities.supportsLiveRegions); // true
console.log(capabilities.supportsSVGAccessibility); // true
```

### Accessible Node Representation

Nodes are converted to accessible representations:

```typescript
interface A11yNode {
  id: string;                // Node unique identifier
  label: string;             // Human-readable label
  type: string;              // Node type (e.g., "Project", "Task")
  connectionCount: number;   // Number of connections
  connectedTo: string[];     // Labels of connected nodes
  position: { x: number; y: number }; // Position for spatial navigation
  index: number;             // Index in navigation order
  isSelected: boolean;       // Selection state
  isFocused: boolean;        // Focus state
  metadata?: Record<string, unknown>; // Additional data
}
```

## High Contrast Mode

### Enabling High Contrast

```typescript
// Enable with dark theme (white on black)
a11y.enableHighContrast("dark");

// Enable with light theme (black on white)
a11y.enableHighContrast("light");

// Enable without theme (uses existing/custom colors)
a11y.enableHighContrast();

// Disable high contrast
a11y.disableHighContrast();

// Check if active
if (a11y.isHighContrastActive()) {
  // Handle high contrast mode
}
```

### Built-in High Contrast Themes

```typescript
import { HIGH_CONTRAST_THEMES } from "./presentation/renderers/graph";

// Dark theme (white on black)
const darkTheme = HIGH_CONTRAST_THEMES.dark;
// {
//   foreground: "#FFFFFF",
//   background: "#000000",
//   accent: "#FFFF00",      // Yellow
//   focusIndicator: "#00FFFF", // Cyan
//   selection: "#0078D4",
//   error: "#FF0000",
//   border: "#FFFFFF"
// }

// Light theme (black on white)
const lightTheme = HIGH_CONTRAST_THEMES.light;
// {
//   foreground: "#000000",
//   background: "#FFFFFF",
//   accent: "#0000FF",      // Blue
//   focusIndicator: "#FF6600", // Orange
//   selection: "#0078D4",
//   error: "#CC0000",
//   border: "#000000"
// }
```

### Custom High Contrast Colors

```typescript
// Set custom colors
a11y.setHighContrastColors({
  foreground: "#00FF00",
  background: "#000033",
  accent: "#FF00FF",
  focusIndicator: "#FFFF00",
});

// Get current colors
const colors = a11y.getHighContrastColors();
```

### CSS Variables

When high contrast is enabled, CSS variables are set on the container:

```css
.exo-high-contrast {
  --exo-hc-foreground: #FFFFFF;
  --exo-hc-background: #000000;
  --exo-hc-accent: #FFFF00;
  --exo-hc-focus: #00FFFF;
  --exo-hc-selection: #0078D4;
  --exo-hc-error: #FF0000;
  --exo-hc-border: #FFFFFF;
}
```

### Automatic Detection

High contrast mode is automatically detected from system preferences:

```typescript
// System high contrast detection via media query
// (prefers-contrast: more) or (-ms-high-contrast: active)
```

## Reduced Motion

### Reduced Motion Configuration

```typescript
import { DEFAULT_REDUCED_MOTION_CONFIG } from "./presentation/renderers/graph";

interface ReducedMotionConfig {
  disableAnimations: boolean;   // Disable all animations
  disableTransitions: boolean;  // Disable CSS transitions
  instantNavigation: boolean;   // Use instant navigation instead of smooth scrolling
  reduceParallax: boolean;      // Reduce parallax effects
}

// Default when prefers-reduced-motion is active:
// {
//   disableAnimations: true,
//   disableTransitions: true,
//   instantNavigation: true,
//   reduceParallax: true
// }
```

### Checking Reduced Motion

```typescript
// Check if reduced motion is active
if (a11y.isReducedMotionActive()) {
  // Use instant transitions
}

// Get full reduced motion config
const config = a11y.getReducedMotionConfig();
if (config.disableAnimations) {
  // Skip animations
}
```

### Respecting System Preferences

```typescript
const a11y = new AccessibilityManager(container, {
  respectReducedMotion: true, // Default: true
});

// The manager automatically listens for preference changes
```

## Skip Links

Skip links allow keyboard users to bypass repeated content:

### Default Skip Links

Two default skip links are created:
1. "Skip to graph" - Focus the graph container
2. "Skip to first node" - Focus the first graph node

### Custom Skip Links

```typescript
const a11y = new AccessibilityManager(container, {
  enableSkipLinks: true,
  skipLinks: [
    {
      id: "skip-to-search",
      label: "Skip to search",
      targetId: "graph-search-input",
      shortcut: "Alt+S", // Optional
    },
    {
      id: "skip-to-filters",
      label: "Skip to filters",
      targetId: "graph-filter-panel",
    },
  ],
});
```

## Focus Management

### Focusing Nodes

```typescript
// Focus a specific node
a11y.focusNode("node2");

// Get currently focused node ID
const focusedId = a11y.getFocusedNodeId();
```

### Selecting Nodes

```typescript
// Toggle node selection (with announcement)
a11y.selectNode("node1");
```

### Focus Traps

Create a focus trap for modal dialogs:

```typescript
const releaseTrap = a11y.createFocusTrap({
  container: modalElement,
  initialFocus: firstButton,        // Element to focus initially
  returnFocusTo: triggerButton,     // Element to return focus to on release
  onEscape: () => {
    closeModal();
  },
});

// Check if focus trap is active
if (a11y.hasFocusTrap()) {
  // Handle trapped focus state
}

// Release the trap (also called on Escape if configured)
releaseTrap();
```

## Color Contrast Utilities

### Checking Contrast Ratios

```typescript
import {
  getContrastRatio,
  getRelativeLuminance,
  meetsWCAGAA,
  meetsWCAGAAA,
  WCAG_CONTRAST_RATIOS,
  // Aliased exports to avoid naming conflicts
  a11yGetContrastRatio,
  a11yMeetsWCAGAA,
} from "./presentation/renderers/graph";

// Calculate contrast ratio
const foreground = "#FFFFFF";
const background = "#1a1a2e";
const ratio = getContrastRatio(foreground, background);
console.log(`Contrast ratio: ${ratio.toFixed(2)}:1`);

// Check WCAG compliance
const normalTextOK = meetsWCAGAA(foreground, background, false);  // 4.5:1 required
const largeTextOK = meetsWCAGAA(foreground, background, true);    // 3:1 required
const aaaOK = meetsWCAGAAA(foreground, background, false);        // 7:1 required

// WCAG contrast requirements
console.log(WCAG_CONTRAST_RATIOS);
// {
//   normalText: 4.5,    // AA level
//   largeText: 3.0,     // AA level
//   uiComponent: 3.0,   // AA level
//   normalTextAAA: 7.0, // AAA level
//   largeTextAAA: 4.5   // AAA level
// }
```

### Relative Luminance

```typescript
const luminance = getRelativeLuminance("#FFFFFF"); // 1.0
const darkLuminance = getRelativeLuminance("#000000"); // 0.0
```

## Testing Accessibility

### Automated Testing

```typescript
import {
  getContrastRatio,
  meetsWCAGAA,
  AccessibilityManager,
} from "./presentation/renderers/graph";

describe("Graph Accessibility", () => {
  let container: HTMLElement;
  let a11y: AccessibilityManager;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    a11y = new AccessibilityManager(container);
  });

  afterEach(() => {
    a11y.destroy();
    document.body.removeChild(container);
  });

  test("creates ARIA live regions", () => {
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(document.querySelector('[aria-live="assertive"]')).not.toBeNull();
  });

  test("sets proper ARIA attributes", () => {
    expect(container.getAttribute("role")).toBe("application");
    expect(container.getAttribute("tabindex")).toBe("0");
    expect(container.hasAttribute("aria-labelledby")).toBe(true);
  });

  test("keyboard navigation works", () => {
    a11y.setGraphData(nodes, edges);
    a11y.focusNode("node1");

    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(a11y.getFocusedNodeId()).not.toBe("node1");
  });

  test("node colors meet contrast requirements", () => {
    const background = "#1a1a2e";

    for (const config of nodeTypeConfigs) {
      const ratio = getContrastRatio(config.color, background);
      expect(meetsWCAGAA(config.color, background)).toBe(true);
    }
  });
});
```

### Manual Testing Checklist

- [ ] Navigate entire graph with keyboard only
- [ ] Verify all actions accessible without mouse
- [ ] Test with screen reader (VoiceOver, NVDA, JAWS)
- [ ] Verify announcements are clear and timely
- [ ] Check high contrast mode
- [ ] Verify reduced motion support
- [ ] Test with browser zoom (200%)
- [ ] Check focus visible at all times during keyboard use
- [ ] Test skip links
- [ ] Verify node descriptions are meaningful

## Best Practices

1. **Color is not sole indicator**: Always pair color with shape or pattern for node types
2. **Focus always visible**: Never hide focus indicator during keyboard navigation
3. **Announce state changes**: Use live regions for dynamic updates
4. **Respect preferences**: Honor reduced motion and contrast settings automatically
5. **Keyboard parity**: All mouse actions must have keyboard equivalents
6. **Meaningful labels**: Provide context in labels, not just "Node 1"
7. **Skip links**: Allow bypassing repeated content
8. **Error recovery**: Announce errors and provide recovery path
9. **Test with real users**: Involve users with disabilities in testing
10. **Debounce announcements**: Prevent announcement spam during rapid navigation

## See Also

- [Interactions](./interactions.md) - Mouse and touch interactions
- [Styling](./styling.md) - Visual customization
- [Configuration](../getting-started/configuration.md) - Full configuration reference
- [Events](../api/events.md) - Event system reference
