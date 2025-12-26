# Accessibility Guide

This guide covers WCAG 2.1 AA compliance for Graph View, including screen reader support, keyboard navigation, and high contrast modes.

## Accessibility Overview

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

## Accessibility Manager

### Setup

```typescript
import {
  AccessibilityManager,
  createAccessibilityManager,
  DEFAULT_A11Y_CONFIG,
} from "@exocortex/obsidian-plugin";

const a11yManager = createAccessibilityManager({
  enabled: true,
  announceChanges: true,
  focusVisible: true,
  reducedMotion: "auto",  // Respect prefers-reduced-motion
  highContrast: "auto",   // Respect prefers-contrast
  screenReaderSupport: true,
});
```

### Configuration

```typescript
interface A11yConfig {
  enabled: boolean;           // Master switch
  announceChanges: boolean;   // Announce via live region
  focusVisible: boolean;      // Show focus indicator
  reducedMotion: "auto" | "on" | "off";
  highContrast: "auto" | "on" | "off";
  screenReaderSupport: boolean;
  keyboardNavigation: boolean;
  minContrastRatio: number;   // Default: 4.5
}
```

## Screen Reader Support

### ARIA Landmarks

```typescript
// Graph container
<div
  role="application"
  aria-label="Knowledge graph visualization"
  aria-describedby="graph-instructions"
>
  <div id="graph-instructions" className="sr-only">
    Use arrow keys to navigate between nodes. Press Enter to open a node.
    Press Tab to move to the next node. Press Escape to clear selection.
  </div>

  {/* Graph canvas */}
</div>
```

### Live Region Announcements

```typescript
import { AccessibilityManager } from "@exocortex/obsidian-plugin";

const a11yManager = new AccessibilityManager();

// Announce navigation
navigationManager.on("navigate", (event) => {
  const node = nodes.find((n) => n.id === event.toNodeId);
  if (node) {
    a11yManager.announce(
      `Navigated to ${node.label}. ${getNodeDescription(node)}`,
      "polite"
    );
  }
});

// Announce selection
selectionManager.on("select", (event) => {
  if (event.nodeIds.length === 1) {
    const node = nodes.find((n) => n.id === event.nodeIds[0]);
    a11yManager.announce(`Selected ${node?.label}`, "polite");
  } else if (event.nodeIds.length > 1) {
    a11yManager.announce(`Selected ${event.nodeIds.length} nodes`, "polite");
  }
});

// Announce important changes
a11yManager.announce("Graph layout changed to hierarchical", "assertive");
```

### Node Descriptions

Generate accessible descriptions for nodes:

```typescript
function getNodeDescription(node: GraphNode): string {
  const parts: string[] = [];

  // Type
  if (node.group) {
    parts.push(`Type: ${node.group}`);
  }

  // Connection count
  const connections = getConnectionCount(node.id);
  parts.push(`${connections} connections`);

  // Status if available
  if (node.metadata?.status) {
    parts.push(`Status: ${node.metadata.status}`);
  }

  return parts.join(". ");
}

// Apply to node
a11yManager.setNodeLabel(node.id, {
  name: node.label,
  description: getNodeDescription(node),
  role: "treeitem",
  selected: isSelected(node.id),
  expanded: isExpanded(node.id),
});
```

## Virtual Cursor

Screen reader users navigate via virtual cursor:

```typescript
import { VirtualCursor, createVirtualCursor } from "@exocortex/obsidian-plugin";

const virtualCursor = createVirtualCursor({
  wrapAround: true,
  sortOrder: "visual",  // visual, alphabetical, type
  includeEdges: true,
});

// Navigate to next/previous
virtualCursor.on("move", (event) => {
  a11yManager.announce(
    `${event.target.label}. ${event.target.description}`,
    "polite"
  );
  focusIndicator.show(event.target.id);
});

// Keyboard integration
keyboardManager.on("action", (event) => {
  switch (event.action) {
    case "virtual-next":
      virtualCursor.moveNext();
      break;
    case "virtual-prev":
      virtualCursor.movePrevious();
      break;
    case "virtual-first":
      virtualCursor.moveToFirst();
      break;
    case "virtual-last":
      virtualCursor.moveToLast();
      break;
  }
});
```

## Keyboard Navigation

### Default Key Bindings

| Key | Action |
|-----|--------|
| Arrow keys | Spatial navigation |
| Tab / Shift+Tab | Next/previous node |
| Enter | Open/activate node |
| Space | Toggle selection |
| Escape | Clear selection |
| + / - | Zoom in/out |
| 0 | Reset zoom |
| F | Fit to view |
| H | Toggle help |
| Ctrl+A | Select all |

### Focus Indicator

```typescript
import { FocusIndicator, DEFAULT_FOCUS_INDICATOR_STYLE } from "@exocortex/obsidian-plugin";

const focusIndicator = new FocusIndicator(renderer.app, {
  style: {
    color: 0x6366f1,       // Visible focus color
    width: 3,              // Thick enough to see
    dashPattern: null,     // Solid line
    glowEnabled: true,     // Additional visibility
    glowColor: 0x6366f1,
    glowAlpha: 0.4,
    glowBlur: 15,
  },
  animationDuration: 150,
});

// Always show focus on keyboard navigation
keyboardManager.on("action", () => {
  focusIndicator.setVisible(true);
});

// Hide on mouse interaction (optional)
container.addEventListener("mousedown", () => {
  focusIndicator.setVisible(false);
});
```

### Focus Trap

Trap focus within graph for modal interactions:

```typescript
a11yManager.enableFocusTrap({
  enabled: true,
  returnFocus: true,  // Return focus on exit
  escapeDeactivates: true,
});

// Disable when leaving graph
a11yManager.disableFocusTrap();
```

## Color and Contrast

### Contrast Checking

```typescript
import {
  a11yGetContrastRatio,
  a11yMeetsWCAGAA,
  a11yMeetsWCAGAAA,
  WCAG_CONTRAST_RATIOS,
} from "@exocortex/obsidian-plugin";

// Check contrast ratio
const foreground = 0xffffff;
const background = 0x1a1a2e;
const ratio = a11yGetContrastRatio(foreground, background);

console.log(`Contrast ratio: ${ratio.toFixed(2)}:1`);
console.log(`Meets WCAG AA: ${a11yMeetsWCAGAA(ratio)}`);
console.log(`Meets WCAG AAA: ${a11yMeetsWCAGAAA(ratio)}`);

// Minimum ratios
// Text: 4.5:1 (AA), 7:1 (AAA)
// Large text: 3:1 (AA), 4.5:1 (AAA)
// UI components: 3:1 (AA)
```

### High Contrast Mode

```typescript
import { HIGH_CONTRAST_THEMES } from "@exocortex/obsidian-plugin";

// Built-in high contrast themes
const themes = {
  dark: {
    background: 0x000000,
    foreground: 0xffffff,
    accent: 0xffff00,    // Yellow for visibility
    error: 0xff6b6b,
    success: 0x6bff6b,
  },
  light: {
    background: 0xffffff,
    foreground: 0x000000,
    accent: 0x0000ff,    // Blue for visibility
    error: 0xff0000,
    success: 0x008000,
  },
};

// Apply high contrast
a11yManager.on("contrastChange", (event) => {
  if (event.enabled) {
    applyTheme(HIGH_CONTRAST_THEMES[getCurrentMode()]);
  } else {
    applyTheme(defaultTheme);
  }
});

// Respect system preference
if (window.matchMedia("(prefers-contrast: more)").matches) {
  a11yManager.setHighContrast(true);
}
```

### Color-Blind Safe Palette

Use shapes in addition to color:

```typescript
const colorBlindSafeConfig: Record<string, { color: number; shape: NodeShape }> = {
  project: { color: 0x0077bb, shape: "hexagon" },   // Blue
  area: { color: 0xee7733, shape: "diamond" },      // Orange
  task: { color: 0x009988, shape: "circle" },       // Teal
  resource: { color: 0xcc3311, shape: "triangle" }, // Red
  note: { color: 0x33bbee, shape: "square" },       // Cyan
};

// Apply both color and shape
function getNodeStyle(node: GraphNode): { color: number; shape: NodeShape } {
  const config = colorBlindSafeConfig[node.group || "note"];
  return {
    color: config.color,
    shape: config.shape,
  };
}
```

## Reduced Motion

Respect user preference for reduced motion:

```typescript
import { DEFAULT_REDUCED_MOTION_CONFIG } from "@exocortex/obsidian-plugin";

const reducedMotionConfig = {
  transitionDuration: 0,    // Instant transitions
  animationEnabled: false,  // No animations
  simulationIterations: 1,  // Single-step layout
};

// Check preference
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (prefersReducedMotion) {
  // Use instant layout
  simulation.stop();
  simulation.tick(300);  // Compute final positions
  render();              // Render once
} else {
  // Normal animated simulation
  simulation.on("tick", render);
  simulation.start();
}

// Watch for preference changes
window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
  a11yManager.setReducedMotion(e.matches);
});
```

## Skip Links

Allow users to skip to main content:

```typescript
import type { SkipLink } from "@exocortex/obsidian-plugin";

const skipLinks: SkipLink[] = [
  { id: "skip-to-graph", label: "Skip to graph", target: "#graph-canvas" },
  { id: "skip-to-search", label: "Skip to search", target: "#graph-search" },
  { id: "skip-to-filters", label: "Skip to filters", target: "#graph-filters" },
];

// Render skip links
<nav className="skip-links" aria-label="Skip navigation">
  {skipLinks.map((link) => (
    <a key={link.id} href={link.target} className="skip-link">
      {link.label}
    </a>
  ))}
</nav>
```

## Testing Accessibility

### Automated Testing

```typescript
import { a11yGetContrastRatio, a11yMeetsWCAGAA } from "@exocortex/obsidian-plugin";

describe("Graph Accessibility", () => {
  test("all node colors meet contrast requirements", () => {
    const background = 0x1a1a2e;

    for (const [type, config] of Object.entries(nodeTypeConfigs)) {
      const ratio = a11yGetContrastRatio(config.style.fill, background);
      expect(a11yMeetsWCAGAA(ratio)).toBe(true);
    }
  });

  test("focus indicator is visible", () => {
    const focusColor = 0x6366f1;
    const nodeColor = 0x64748b;

    const ratio = a11yGetContrastRatio(focusColor, nodeColor);
    expect(ratio).toBeGreaterThanOrEqual(3);  // UI component requirement
  });
});
```

### Manual Testing Checklist

- [ ] Navigate entire graph with keyboard only
- [ ] Verify all actions accessible without mouse
- [ ] Test with screen reader (VoiceOver, NVDA)
- [ ] Check high contrast mode
- [ ] Verify reduced motion support
- [ ] Test with browser zoom (200%)
- [ ] Check focus visible at all times during keyboard use

## Best Practices

1. **Color is not sole indicator**: Always pair color with shape or pattern
2. **Focus always visible**: Never hide focus indicator during keyboard navigation
3. **Announce state changes**: Use live regions for dynamic updates
4. **Respect preferences**: Honor reduced motion and contrast settings
5. **Keyboard parity**: All mouse actions have keyboard equivalents
6. **Meaningful labels**: Provide context, not just "Node 1"
7. **Skip links**: Allow bypassing repeated content
8. **Error recovery**: Announce errors and provide recovery path

## See Also

- [Interactions](./interactions.md) - Keyboard navigation
- [Styling](./styling.md) - Color contrast
- [Configuration](../getting-started/configuration.md) - A11y options
