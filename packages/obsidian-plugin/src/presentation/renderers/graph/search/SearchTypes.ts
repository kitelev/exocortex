/**
 * Search and Highlight Types
 *
 * Defines the types and interfaces for node searching, highlighting,
 * type-based coloring, and visual legend components.
 *
 * @module presentation/renderers/graph/search
 * @since 1.0.0
 */

import type { NodeShape } from "../NodeRenderer";

// Re-export NodeShape for convenience
export type { NodeShape } from "../NodeRenderer";

/**
 * Type color configuration for a specific RDF type
 */
export interface TypeColorConfig {
  /** Full RDF type URI (e.g., "ems__Task", "http://www.w3.org/2000/01/rdf-schema#Class") */
  typeUri: string;
  /** Display color in hex format (e.g., "#3b82f6") */
  color: string;
  /** Optional display icon (emoji or icon name) */
  icon?: string;
  /** Optional shape override for this type */
  shape?: NodeShape;
  /** Priority for multi-type nodes (higher = more important) */
  priority: number;
  /** Optional display name override */
  displayName?: string;
  /** Whether this type is visible in the legend */
  visible?: boolean;
}

/**
 * Color palette configuration for consistent theming
 */
export interface ColorPalette {
  /** Unique identifier for the palette */
  id: string;
  /** Human-readable palette name */
  name: string;
  /** Array of colors in the palette (hex format) */
  colors: string[];
  /** Background color for the palette theme */
  background: string;
  /** Foreground (text) color for the palette theme */
  foreground: string;
  /** Optional description of the palette */
  description?: string;
}

/**
 * Built-in color palettes
 */
export const BUILT_IN_PALETTES: ColorPalette[] = [
  {
    id: "default",
    name: "Default",
    description: "Standard color palette with high contrast",
    colors: [
      "#3b82f6", // Blue
      "#ef4444", // Red
      "#22c55e", // Green
      "#f59e0b", // Amber
      "#8b5cf6", // Purple
      "#ec4899", // Pink
      "#14b8a6", // Teal
      "#f97316", // Orange
    ],
    background: "#1e1e1e",
    foreground: "#ffffff",
  },
  {
    id: "pastel",
    name: "Pastel",
    description: "Soft pastel colors for light themes",
    colors: [
      "#93c5fd", // Light blue
      "#fca5a5", // Light red
      "#86efac", // Light green
      "#fcd34d", // Light yellow
      "#c4b5fd", // Light purple
      "#f9a8d4", // Light pink
      "#5eead4", // Light teal
      "#fdba74", // Light orange
    ],
    background: "#f8fafc",
    foreground: "#1e293b",
  },
  {
    id: "colorblind-safe",
    name: "Colorblind Safe",
    description: "Optimized for color vision deficiency (Tol palette)",
    colors: [
      "#0077BB", // Blue
      "#33BBEE", // Cyan
      "#009988", // Teal
      "#EE7733", // Orange
      "#CC3311", // Red
      "#EE3377", // Magenta
      "#BBBBBB", // Grey
      "#000000", // Black
    ],
    background: "#ffffff",
    foreground: "#000000",
  },
  {
    id: "high-contrast",
    name: "High Contrast",
    description: "Maximum contrast for accessibility",
    colors: [
      "#0000FF", // Pure blue
      "#FF0000", // Pure red
      "#00FF00", // Pure green
      "#FFFF00", // Pure yellow
      "#FF00FF", // Pure magenta
      "#00FFFF", // Pure cyan
      "#FFA500", // Orange
      "#800080", // Purple
    ],
    background: "#000000",
    foreground: "#ffffff",
  },
];

/**
 * Default type color configurations for common RDF/ontology types
 */
export const DEFAULT_TYPE_COLORS: TypeColorConfig[] = [
  // RDF/RDFS/OWL core types
  {
    typeUri: "http://www.w3.org/2000/01/rdf-schema#Class",
    color: "#3b82f6",
    icon: "📦",
    priority: 100,
    displayName: "Class",
  },
  {
    typeUri: "http://www.w3.org/2002/07/owl#Class",
    color: "#3b82f6",
    icon: "📦",
    priority: 100,
    displayName: "OWL Class",
  },
  {
    typeUri: "http://www.w3.org/2002/07/owl#ObjectProperty",
    color: "#8b5cf6",
    icon: "🔗",
    priority: 90,
    displayName: "Object Property",
  },
  {
    typeUri: "http://www.w3.org/2002/07/owl#DatatypeProperty",
    color: "#06b6d4",
    icon: "📊",
    priority: 90,
    displayName: "Datatype Property",
  },
  // Exocortex ontology types
  {
    typeUri: "ems__Task",
    color: "#22c55e",
    icon: "✓",
    shape: "roundedRect",
    priority: 80,
    displayName: "Task",
  },
  {
    typeUri: "ems__Project",
    color: "#3b82f6",
    icon: "📁",
    shape: "hexagon",
    priority: 85,
    displayName: "Project",
  },
  {
    typeUri: "ems__Area",
    color: "#a855f7",
    icon: "◉",
    shape: "circle",
    priority: 90,
    displayName: "Area",
  },
  {
    typeUri: "ems__Person",
    color: "#f97316",
    icon: "👤",
    shape: "circle",
    priority: 75,
    displayName: "Person",
  },
  {
    typeUri: "ims__Concept",
    color: "#6b7280",
    icon: "🏷",
    shape: "diamond",
    priority: 70,
    displayName: "Concept",
  },
  {
    typeUri: "exo__Asset",
    color: "#64748b",
    icon: "📄",
    priority: 50,
    displayName: "Asset",
  },
];

/**
 * Search result match information
 */
export interface SearchMatch {
  /** The node ID that matched */
  nodeId: string;
  /** The matched text/field */
  matchedText: string;
  /** The field that matched (label, type, property, etc.) */
  matchedField: "label" | "type" | "path" | "property";
  /** Match score (higher = better match) */
  score: number;
  /** Start index of match in the text */
  matchStart?: number;
  /** End index of match in the text */
  matchEnd?: number;
}

/**
 * Search state for tracking current search
 */
export interface SearchState {
  /** Current search query */
  query: string;
  /** Whether search is active */
  isActive: boolean;
  /** All matching nodes */
  matches: SearchMatch[];
  /** Currently highlighted match index */
  currentMatchIndex: number;
  /** Search options */
  options: SearchOptions;
}

/**
 * Search configuration options
 */
export interface SearchOptions {
  /** Enable case-sensitive matching */
  caseSensitive: boolean;
  /** Enable regex search */
  useRegex: boolean;
  /** Search in node labels */
  searchLabels: boolean;
  /** Search in node types */
  searchTypes: boolean;
  /** Search in file paths */
  searchPaths: boolean;
  /** Search in property values */
  searchProperties: boolean;
  /** Minimum characters to trigger search */
  minChars: number;
  /** Debounce delay in milliseconds */
  debounceMs: number;
  /** Maximum results to return */
  maxResults: number;
}

/**
 * Default search options
 */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  useRegex: false,
  searchLabels: true,
  searchTypes: true,
  searchPaths: true,
  searchProperties: false,
  minChars: 2,
  debounceMs: 150,
  maxResults: 100,
};

/**
 * Highlight style configuration
 */
export interface HighlightStyle {
  /** Fill color for highlighted nodes */
  fillColor: string;
  /** Border color for highlighted nodes */
  borderColor: string;
  /** Border width for highlighted nodes */
  borderWidth: number;
  /** Glow/shadow effect for highlighted nodes */
  glowColor?: string;
  /** Glow blur amount */
  glowBlur?: number;
  /** Opacity for non-highlighted nodes when search is active (0-1) */
  dimOpacity: number;
  /** Animation duration in ms */
  animationDuration: number;
}

/**
 * Default highlight style
 */
export const DEFAULT_HIGHLIGHT_STYLE: HighlightStyle = {
  fillColor: "#fbbf24",
  borderColor: "#f59e0b",
  borderWidth: 3,
  glowColor: "#fbbf24",
  glowBlur: 8,
  dimOpacity: 0.3,
  animationDuration: 200,
};

/**
 * Legend item for display in color legend
 */
export interface LegendItem {
  /** Type URI */
  typeUri: string;
  /** Display name */
  displayName: string;
  /** Color */
  color: string;
  /** Optional icon */
  icon?: string;
  /** Optional shape */
  shape?: NodeShape;
  /** Count of nodes with this type */
  count: number;
  /** Whether type is visible */
  visible: boolean;
}

/**
 * Legend state for tracking visibility and colors
 */
export interface LegendState {
  /** All legend items */
  items: LegendItem[];
  /** Whether legend is expanded */
  isExpanded: boolean;
  /** Current color palette ID */
  paletteId: string;
  /** Custom color overrides */
  customColors: Map<string, string>;
}

/**
 * Color picker state
 */
export interface ColorPickerState {
  /** Whether picker is open */
  isOpen: boolean;
  /** Type URI being edited (null if closed) */
  editingTypeUri: string | null;
  /** Current color value */
  currentColor: string;
  /** Position for picker popup */
  position: { x: number; y: number };
}

/**
 * Events emitted by search/highlight system
 */
export type SearchEventType =
  | "search:start"
  | "search:update"
  | "search:clear"
  | "match:select"
  | "match:highlight"
  | "color:change"
  | "palette:change"
  | "legend:toggle";

/**
 * Search event payload
 */
export interface SearchEvent {
  type: SearchEventType;
  query?: string;
  matches?: SearchMatch[];
  selectedMatch?: SearchMatch;
  typeUri?: string;
  color?: string;
  paletteId?: string;
  visible?: boolean;
}

/**
 * Search event listener callback
 */
export type SearchEventListener = (event: SearchEvent) => void;

/**
 * Generate a deterministic color from a string (URI or name)
 * Uses the golden ratio for optimal hue distribution
 *
 * @param input - String to hash
 * @param palette - Color palette to use
 * @returns Hex color string
 */
export function generateColorFromString(
  input: string,
  palette: ColorPalette = BUILT_IN_PALETTES[0]
): string {
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Use absolute value and modulo to get palette index
  const index = Math.abs(hash) % palette.colors.length;
  return palette.colors[index];
}

/**
 * Generate a unique color using HSL and golden ratio
 * Ensures maximum distinction between adjacent colors
 *
 * @param index - Color index
 * @param saturation - Color saturation (0-100)
 * @param lightness - Color lightness (0-100)
 * @returns Hex color string
 */
export function generateGoldenRatioColor(
  index: number,
  saturation = 70,
  lightness = 50
): string {
  const goldenRatio = 0.618033988749895;
  // Start with a nice hue and offset by golden ratio
  const hue = ((index * goldenRatio) % 1) * 360;
  return hslToHex(hue, saturation, lightness);
}

/**
 * Convert HSL values to hex color
 *
 * @param h - Hue (0-360)
 * @param s - Saturation (0-100)
 * @param l - Lightness (0-100)
 * @returns Hex color string
 */
export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }

  const toHex = (n: number): string => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Calculate WCAG contrast ratio between two colors
 *
 * @param color1 - First color in hex
 * @param color2 - Second color in hex
 * @returns Contrast ratio (1-21)
 */
export function calculateContrastRatio(color1: string, color2: string): number {
  const lum1 = getRelativeLuminance(color1);
  const lum2 = getRelativeLuminance(color2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Get relative luminance of a color
 *
 * @param hexColor - Color in hex format
 * @returns Relative luminance (0-1)
 */
export function getRelativeLuminance(hexColor: string): number {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const toLinear = (c: number): number => {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Check if a color meets WCAG AA contrast requirements
 *
 * @param foreground - Foreground color in hex
 * @param background - Background color in hex
 * @param isLargeText - Whether this is for large text (14pt bold or 18pt regular)
 * @returns True if contrast meets WCAG AA
 */
export function meetsWCAGAA(
  foreground: string,
  background: string,
  isLargeText = false
): boolean {
  const ratio = calculateContrastRatio(foreground, background);
  return isLargeText ? ratio >= 3 : ratio >= 4.5;
}

/**
 * Format type URI for display
 * Converts "ems__Task" to "Task" and full URIs to local names
 *
 * @param typeUri - Type URI to format
 * @returns Formatted display name
 */
export function formatTypeUri(typeUri: string): string {
  // Handle namespace prefix format (e.g., "ems__Task")
  if (typeUri.includes("__")) {
    const parts = typeUri.split("__");
    return parts[parts.length - 1];
  }

  // Handle full URI format
  if (typeUri.includes("#")) {
    return typeUri.split("#").pop() || typeUri;
  }

  if (typeUri.includes("/")) {
    return typeUri.split("/").pop() || typeUri;
  }

  return typeUri;
}
