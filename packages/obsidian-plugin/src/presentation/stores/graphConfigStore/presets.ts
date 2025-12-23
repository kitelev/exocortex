/**
 * Built-in configuration presets for graph visualization.
 * Provides optimized configurations for different use cases.
 */

import type { ConfigPreset } from "./types";

/**
 * Performance preset - optimized for large graphs and low-end devices
 */
export const PERFORMANCE_PRESET: ConfigPreset = {
  name: "performance",
  description: "Optimized for large graphs with 500+ nodes. Reduces visual effects for better FPS.",
  config: {
    rendering: {
      performance: {
        maxFPS: 30,
        pixelRatio: 1,
        antialias: false,
      },
      nodes: {
        showShadow: false,
        defaultRadius: 6,
      },
      edges: {
        opacity: 0.4,
        showArrows: false,
      },
      labels: {
        showThreshold: 1.5,
      },
    },
    physics: {
      collision: {
        enabled: false,
      },
      charge: {
        theta: 0.95,
      },
    },
    minimap: {
      enabled: false,
    },
  },
};

/**
 * Quality preset - maximum visual quality for presentations
 */
export const QUALITY_PRESET: ConfigPreset = {
  name: "quality",
  description: "Maximum visual quality with all effects enabled. Best for presentations.",
  config: {
    rendering: {
      performance: {
        maxFPS: 60,
        pixelRatio: 2,
        antialias: true,
      },
      nodes: {
        showShadow: true,
        shadowBlur: 15,
        borderWidth: 2,
      },
      edges: {
        opacity: 0.8,
        showArrows: true,
        curvature: 0.2,
      },
      labels: {
        showThreshold: 0.3,
        fontWeight: "bold",
      },
      background: {
        showGrid: true,
      },
    },
    minimap: {
      enabled: true,
      opacity: 0.9,
    },
  },
};

/**
 * Dense preset - optimized for graphs with many connections
 */
export const DENSE_PRESET: ConfigPreset = {
  name: "dense",
  description: "Optimized for highly connected graphs. Stronger repulsion to prevent overlap.",
  config: {
    physics: {
      charge: {
        strength: -500,
        distanceMax: 500,
      },
      link: {
        distance: 150,
        strength: 0.5,
      },
      collision: {
        enabled: true,
        strength: 1,
        iterations: 2,
      },
    },
    rendering: {
      nodes: {
        defaultRadius: 6,
      },
      edges: {
        opacity: 0.3,
        defaultWidth: 0.5,
        showArrows: false,
      },
      labels: {
        showThreshold: 2,
        fontSize: 10,
      },
    },
    filters: {
      minDegree: 2,
      showOrphans: false,
    },
  },
};

/**
 * Hierarchical preset - optimized for tree-like structures
 */
export const HIERARCHICAL_PRESET: ConfigPreset = {
  name: "hierarchical",
  description: "Tree layout for hierarchical data. Best for parent-child relationships.",
  config: {
    physics: {
      enabled: false,
    },
    layout: {
      defaultAlgorithm: "hierarchical",
      hierarchical: {
        direction: "TB",
        levelSeparation: 120,
        nodeSeparation: 60,
      },
    },
    rendering: {
      edges: {
        curvature: 0.3,
        showArrows: true,
      },
    },
  },
};

/**
 * Accessibility preset - high contrast and larger text
 */
export const ACCESSIBILITY_PRESET: ConfigPreset = {
  name: "accessibility",
  description: "High contrast colors and larger text for better visibility.",
  config: {
    rendering: {
      nodes: {
        defaultRadius: 12,
        borderWidth: 3,
        showShadow: true,
        shadowBlur: 8,
      },
      edges: {
        defaultWidth: 2,
        opacity: 1,
        arrowSize: 10,
      },
      labels: {
        fontSize: 16,
        fontWeight: "bold",
        showThreshold: 0.2,
        offset: 6,
      },
      background: {
        color: "#000000",
        showGrid: true,
        gridColor: "#444444",
      },
    },
    interaction: {
      click: {
        hoverDelay: 200,
      },
      drag: {
        threshold: 10,
      },
    },
    minimap: {
      enabled: true,
      width: 200,
      height: 150,
    },
  },
};

/**
 * Radial preset - centered radial layout
 */
export const RADIAL_PRESET: ConfigPreset = {
  name: "radial",
  description: "Radial layout with nodes arranged in concentric circles.",
  config: {
    physics: {
      enabled: true,
      radial: {
        enabled: true,
        strength: 0.3,
        radius: 200,
      },
      charge: {
        strength: -100,
      },
      link: {
        strength: 0.3,
      },
    },
    layout: {
      defaultAlgorithm: "radial",
      radial: {
        rings: 5,
        ringSeparation: 100,
      },
    },
    rendering: {
      edges: {
        curvature: 0.1,
        opacity: 0.5,
      },
    },
  },
};

/**
 * Compact preset - minimal spacing for overview
 */
export const COMPACT_PRESET: ConfigPreset = {
  name: "compact",
  description: "Minimal spacing for a compact overview of the entire graph.",
  config: {
    physics: {
      charge: {
        strength: -100,
        distanceMax: 200,
      },
      link: {
        distance: 40,
      },
      collision: {
        enabled: true,
        radius: 10,
      },
    },
    rendering: {
      nodes: {
        defaultRadius: 4,
        borderWidth: 0.5,
      },
      edges: {
        defaultWidth: 0.5,
        opacity: 0.4,
        showArrows: false,
      },
      labels: {
        showThreshold: 3,
        fontSize: 9,
      },
    },
    minimap: {
      enabled: false,
    },
  },
};

/**
 * All built-in presets
 */
export const BUILT_IN_PRESETS: ConfigPreset[] = [
  PERFORMANCE_PRESET,
  QUALITY_PRESET,
  DENSE_PRESET,
  HIERARCHICAL_PRESET,
  ACCESSIBILITY_PRESET,
  RADIAL_PRESET,
  COMPACT_PRESET,
];

/**
 * Get a built-in preset by name
 */
export function getBuiltInPreset(name: string): ConfigPreset | undefined {
  return BUILT_IN_PRESETS.find((p) => p.name === name);
}

/**
 * Check if a preset name is built-in (non-deletable)
 */
export function isBuiltInPreset(name: string): boolean {
  return BUILT_IN_PRESETS.some((p) => p.name === name);
}
