/**
 * Interpolation - Utilities for interpolating between values
 *
 * Provides interpolation functions for:
 * - Numbers and numeric values
 * - 2D and 3D points/positions
 * - Colors (RGB, HSL, Hex)
 * - Opacity and alpha values
 * - Arrays of values
 * - Complex objects with position data
 *
 * @module presentation/renderers/graph/animation
 * @since 1.0.0
 */

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * 2D point coordinates
 */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * 3D point coordinates
 */
export interface Point3D extends Point2D {
  z: number;
}

/**
 * RGB color
 */
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/**
 * RGBA color with alpha
 */
export interface RGBAColor extends RGBColor {
  a: number;
}

/**
 * HSL color
 */
export interface HSLColor {
  h: number;
  s: number;
  l: number;
}

/**
 * HSLA color with alpha
 */
export interface HSLAColor extends HSLColor {
  a: number;
}

/**
 * Node position data for interpolation
 */
export interface NodePosition {
  id: string;
  x: number;
  y: number;
  scale?: number;
  opacity?: number;
  rotation?: number;
}

/**
 * Interpolation options
 */
export interface InterpolationOptions {
  /** Whether to use shortest path for angular interpolation (default: true) */
  shortestPath?: boolean;
  /** Clamp values to valid ranges (default: true) */
  clamp?: boolean;
}

// ============================================================
// Number Interpolation
// ============================================================

/**
 * Linear interpolation between two numbers
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Interpolate a value with clamped t
 */
export function lerpClamped(start: number, end: number, t: number): number {
  return lerp(start, end, clamp(t, 0, 1));
}

/**
 * Inverse lerp - find t given a value in range
 */
export function inverseLerp(start: number, end: number, value: number): number {
  if (start === end) return 0;
  return (value - start) / (end - start);
}

/**
 * Remap a value from one range to another
 */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  const t = inverseLerp(inMin, inMax, value);
  return lerp(outMin, outMax, t);
}

// ============================================================
// Point Interpolation
// ============================================================

/**
 * Interpolate between two 2D points
 */
export function interpolatePoint2D(
  start: Point2D,
  end: Point2D,
  t: number
): Point2D {
  return {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
  };
}

/**
 * Interpolate between two 3D points
 */
export function interpolatePoint3D(
  start: Point3D,
  end: Point3D,
  t: number
): Point3D {
  return {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
    z: lerp(start.z, end.z, t),
  };
}

/**
 * Interpolate along a bezier curve (quadratic)
 */
export function interpolateBezierQuadratic(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  t: number
): Point2D {
  const oneMinusT = 1 - t;
  const oneMinusTSq = oneMinusT * oneMinusT;
  const tSq = t * t;

  return {
    x: oneMinusTSq * p0.x + 2 * oneMinusT * t * p1.x + tSq * p2.x,
    y: oneMinusTSq * p0.y + 2 * oneMinusT * t * p1.y + tSq * p2.y,
  };
}

/**
 * Interpolate along a bezier curve (cubic)
 */
export function interpolateBezierCubic(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const oneMinusT = 1 - t;
  const oneMinusTSq = oneMinusT * oneMinusT;
  const oneMinusTCu = oneMinusTSq * oneMinusT;
  const tSq = t * t;
  const tCu = tSq * t;

  return {
    x: oneMinusTCu * p0.x + 3 * oneMinusTSq * t * p1.x + 3 * oneMinusT * tSq * p2.x + tCu * p3.x,
    y: oneMinusTCu * p0.y + 3 * oneMinusTSq * t * p1.y + 3 * oneMinusT * tSq * p2.y + tCu * p3.y,
  };
}

/**
 * Catmull-Rom spline interpolation through a series of points
 */
export function interpolateCatmullRom(
  points: Point2D[],
  t: number,
  tension: number = 0.5
): Point2D {
  if (points.length < 2) {
    return points[0] || { x: 0, y: 0 };
  }
  if (points.length === 2) {
    return interpolatePoint2D(points[0], points[1], t);
  }

  // Calculate segment
  const segmentCount = points.length - 1;
  const scaledT = t * segmentCount;
  const segment = Math.floor(scaledT);
  const localT = scaledT - segment;

  // Get control points (with boundary handling)
  const p0 = points[Math.max(0, segment - 1)];
  const p1 = points[segment];
  const p2 = points[Math.min(points.length - 1, segment + 1)];
  const p3 = points[Math.min(points.length - 1, segment + 2)];

  // Calculate Catmull-Rom coefficients
  const t2 = localT * localT;
  const t3 = t2 * localT;

  const c0 = -tension * localT + 2 * tension * t2 - tension * t3;
  const c1 = 1 + (tension - 3) * t2 + (2 - tension) * t3;
  const c2 = tension * localT + (3 - 2 * tension) * t2 + (tension - 2) * t3;
  const c3 = -tension * t2 + tension * t3;

  return {
    x: p0.x * c0 + p1.x * c1 + p2.x * c2 + p3.x * c3,
    y: p0.y * c0 + p1.y * c1 + p2.y * c2 + p3.y * c3,
  };
}

// ============================================================
// Color Interpolation
// ============================================================

/**
 * Parse hex color to RGB
 */
export function hexToRgb(hex: string): RGBColor {
  // Remove # if present
  hex = hex.replace(/^#/, "");

  // Handle shorthand (e.g., #fff)
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  const num = parseInt(hex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Convert RGB to hex
 */
export function rgbToHex(color: RGBColor): string {
  const toHex = (c: number): string => {
    const hex = Math.round(clamp(c, 0, 255)).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

/**
 * Convert RGB to HSL
 */
export function rgbToHsl(color: RGBColor): HSLColor {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    case b:
      h = ((r - g) / d + 4) / 6;
      break;
  }

  return { h: h * 360, s, l };
}

/**
 * Convert HSL to RGB
 */
export function hslToRgb(color: HSLColor): RGBColor {
  const h = color.h / 360;
  const { s, l } = color;

  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

/**
 * Interpolate between two RGB colors
 */
export function interpolateRgb(
  start: RGBColor,
  end: RGBColor,
  t: number
): RGBColor {
  return {
    r: lerp(start.r, end.r, t),
    g: lerp(start.g, end.g, t),
    b: lerp(start.b, end.b, t),
  };
}

/**
 * Interpolate between two RGBA colors
 */
export function interpolateRgba(
  start: RGBAColor,
  end: RGBAColor,
  t: number
): RGBAColor {
  return {
    ...interpolateRgb(start, end, t),
    a: lerp(start.a, end.a, t),
  };
}

/**
 * Interpolate between two HSL colors
 */
export function interpolateHsl(
  start: HSLColor,
  end: HSLColor,
  t: number,
  options?: InterpolationOptions
): HSLColor {
  const shortestPath = options?.shortestPath ?? true;

  let h1 = start.h;
  let h2 = end.h;

  // Use shortest path around the hue circle
  if (shortestPath) {
    const diff = h2 - h1;
    if (diff > 180) {
      h1 += 360;
    } else if (diff < -180) {
      h2 += 360;
    }
  }

  return {
    h: ((lerp(h1, h2, t) % 360) + 360) % 360,
    s: lerp(start.s, end.s, t),
    l: lerp(start.l, end.l, t),
  };
}

/**
 * Interpolate between two HSLA colors
 */
export function interpolateHsla(
  start: HSLAColor,
  end: HSLAColor,
  t: number,
  options?: InterpolationOptions
): HSLAColor {
  return {
    ...interpolateHsl(start, end, t, options),
    a: lerp(start.a, end.a, t),
  };
}

/**
 * Interpolate between two hex colors
 */
export function interpolateHex(
  startHex: string,
  endHex: string,
  t: number
): string {
  const start = hexToRgb(startHex);
  const end = hexToRgb(endHex);
  const result = interpolateRgb(start, end, t);
  return rgbToHex(result);
}

/**
 * Interpolate between two hex colors through HSL (smoother for hue changes)
 */
export function interpolateHexHsl(
  startHex: string,
  endHex: string,
  t: number,
  options?: InterpolationOptions
): string {
  const startRgb = hexToRgb(startHex);
  const endRgb = hexToRgb(endHex);
  const startHsl = rgbToHsl(startRgb);
  const endHsl = rgbToHsl(endRgb);
  const resultHsl = interpolateHsl(startHsl, endHsl, t, options);
  const resultRgb = hslToRgb(resultHsl);
  return rgbToHex(resultRgb);
}

// ============================================================
// Opacity and Scale Interpolation
// ============================================================

/**
 * Interpolate opacity with clamping
 */
export function interpolateOpacity(
  start: number,
  end: number,
  t: number
): number {
  return clamp(lerp(start, end, t), 0, 1);
}

/**
 * Interpolate scale with minimum bound
 */
export function interpolateScale(
  start: number,
  end: number,
  t: number,
  minScale: number = 0
): number {
  return Math.max(minScale, lerp(start, end, t));
}

/**
 * Interpolate rotation (in degrees), handling wraparound
 */
export function interpolateRotation(
  start: number,
  end: number,
  t: number,
  options?: InterpolationOptions
): number {
  const shortestPath = options?.shortestPath ?? true;

  if (shortestPath) {
    // Normalize to 0-360
    let s = ((start % 360) + 360) % 360;
    let e = ((end % 360) + 360) % 360;

    // Find shortest path
    const diff = e - s;
    if (diff > 180) {
      s += 360;
    } else if (diff < -180) {
      e += 360;
    }

    return ((lerp(s, e, t) % 360) + 360) % 360;
  }

  return lerp(start, end, t);
}

// ============================================================
// Node Position Interpolation
// ============================================================

/**
 * Interpolate between two node positions
 */
export function interpolateNodePosition(
  start: NodePosition,
  end: NodePosition,
  t: number
): NodePosition {
  return {
    id: start.id,
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
    scale: start.scale !== undefined && end.scale !== undefined
      ? interpolateScale(start.scale, end.scale, t)
      : undefined,
    opacity: start.opacity !== undefined && end.opacity !== undefined
      ? interpolateOpacity(start.opacity, end.opacity, t)
      : undefined,
    rotation: start.rotation !== undefined && end.rotation !== undefined
      ? interpolateRotation(start.rotation, end.rotation, t)
      : undefined,
  };
}

/**
 * Interpolate between two maps of node positions
 */
export function interpolateNodePositions(
  start: Map<string, NodePosition>,
  end: Map<string, NodePosition>,
  t: number
): Map<string, NodePosition> {
  const result = new Map<string, NodePosition>();

  // Interpolate existing nodes
  for (const [id, startPos] of start) {
    const endPos = end.get(id);
    if (endPos) {
      result.set(id, interpolateNodePosition(startPos, endPos, t));
    } else {
      // Node being removed - fade out
      result.set(id, {
        ...startPos,
        opacity: interpolateOpacity(startPos.opacity ?? 1, 0, t),
        scale: interpolateScale(startPos.scale ?? 1, 0, t),
      });
    }
  }

  // Handle new nodes - fade in
  for (const [id, endPos] of end) {
    if (!start.has(id)) {
      result.set(id, {
        ...endPos,
        opacity: interpolateOpacity(0, endPos.opacity ?? 1, t),
        scale: interpolateScale(0, endPos.scale ?? 1, t),
      });
    }
  }

  return result;
}

// ============================================================
// Array Interpolation
// ============================================================

/**
 * Interpolate between two arrays of numbers
 */
export function interpolateArray(
  start: number[],
  end: number[],
  t: number
): number[] {
  const maxLen = Math.max(start.length, end.length);
  const result: number[] = [];

  for (let i = 0; i < maxLen; i++) {
    const s = i < start.length ? start[i] : 0;
    const e = i < end.length ? end[i] : 0;
    result.push(lerp(s, e, t));
  }

  return result;
}

/**
 * Interpolate between two arrays of points
 */
export function interpolatePointArray(
  start: Point2D[],
  end: Point2D[],
  t: number
): Point2D[] {
  const maxLen = Math.max(start.length, end.length);
  const result: Point2D[] = [];

  for (let i = 0; i < maxLen; i++) {
    const s = i < start.length ? start[i] : { x: 0, y: 0 };
    const e = i < end.length ? end[i] : { x: 0, y: 0 };
    result.push(interpolatePoint2D(s, e, t));
  }

  return result;
}

// ============================================================
// Staggered Interpolation
// ============================================================

/**
 * Calculate staggered progress for an item in a sequence
 */
export function calculateStaggeredProgress(
  globalProgress: number,
  itemIndex: number,
  totalItems: number,
  staggerAmount: number = 0.1
): number {
  if (totalItems <= 1 || staggerAmount <= 0) {
    return globalProgress;
  }

  // Calculate delay based on item position
  const maxDelay = Math.min(staggerAmount * (totalItems - 1), 0.5);
  const itemDelay = (itemIndex / (totalItems - 1)) * maxDelay;

  // Calculate item-specific progress
  const availableDuration = 1 - maxDelay;
  const itemStart = itemDelay;
  const itemProgress = (globalProgress - itemStart) / availableDuration;

  return clamp(itemProgress, 0, 1);
}

/**
 * Apply staggered interpolation to a map of positions
 */
export function interpolateStaggered(
  start: Map<string, Point2D>,
  end: Map<string, Point2D>,
  t: number,
  staggerAmount: number = 0.05
): Map<string, Point2D> {
  const result = new Map<string, Point2D>();
  const ids = Array.from(new Set([...start.keys(), ...end.keys()]));
  const totalItems = ids.length;

  ids.forEach((id, index) => {
    const staggeredT = calculateStaggeredProgress(t, index, totalItems, staggerAmount);
    const startPos = start.get(id) ?? { x: 0, y: 0 };
    const endPos = end.get(id) ?? startPos;
    result.set(id, interpolatePoint2D(startPos, endPos, staggeredT));
  });

  return result;
}
