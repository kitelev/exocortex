/**
 * Validation schemas for graph configuration.
 * Provides runtime type checking and validation using manual validators
 * to avoid bundling issues with third-party validation libraries.
 */

import type { GraphConfig, ConfigPreset } from "./types";

// ============================================================
// Validation Error Types
// ============================================================

export interface ValidationIssue {
  path: string[];
  message: string;
  received?: unknown;
  expected?: string;
}

export interface ValidationError {
  issues: ValidationIssue[];
}

// ============================================================
// Validation Result Types
// ============================================================

/**
 * Result of a safe parse operation
 */
export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError };

// ============================================================
// Validation Helpers
// ============================================================

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isPositiveNumberOrInfinity(value: unknown): value is number {
  return isNumber(value) && (value >= 0 || value === Infinity);
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function isInteger(value: number): boolean {
  return Number.isInteger(value);
}

// ============================================================
// Schema Validators
// ============================================================

type Validator<T> = (value: unknown, path: string[]) => { valid: true; data: T } | { valid: false; issues: ValidationIssue[] };

function createValidator<T>(check: (value: unknown, path: string[]) => { valid: true; data: T } | { valid: false; issues: ValidationIssue[] }): Validator<T> {
  return check;
}

// ============================================================
// Physics Validators
// ============================================================

const validateSimulationConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isNumber(value.alphaMin) || !inRange(value.alphaMin, 0, 1)) {
    issues.push({ path: [...path, "alphaMin"], message: "Must be a number between 0 and 1", received: value.alphaMin });
  }
  if (!isNumber(value.alphaDecay) || !inRange(value.alphaDecay, 0, 1)) {
    issues.push({ path: [...path, "alphaDecay"], message: "Must be a number between 0 and 1", received: value.alphaDecay });
  }
  if (!isNumber(value.alphaTarget) || !inRange(value.alphaTarget, 0, 1)) {
    issues.push({ path: [...path, "alphaTarget"], message: "Must be a number between 0 and 1", received: value.alphaTarget });
  }
  if (!isNumber(value.velocityDecay) || !inRange(value.velocityDecay, 0, 1)) {
    issues.push({ path: [...path, "velocityDecay"], message: "Must be a number between 0 and 1", received: value.velocityDecay });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["physics"]["simulation"] };
});

const validateCenterForceConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (!isNumber(value.strength) || !inRange(value.strength, 0, 1)) {
    issues.push({ path: [...path, "strength"], message: "Must be a number between 0 and 1", received: value.strength });
  }
  if (value.x !== undefined && !isNumber(value.x)) {
    issues.push({ path: [...path, "x"], message: "Must be a number", received: value.x });
  }
  if (value.y !== undefined && !isNumber(value.y)) {
    issues.push({ path: [...path, "y"], message: "Must be a number", received: value.y });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["physics"]["center"] };
});

const validateLinkForceConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (!isNumber(value.distance) || value.distance < 0) {
    issues.push({ path: [...path, "distance"], message: "Must be a non-negative number", received: value.distance });
  }
  if (!isNumber(value.strength) || !inRange(value.strength, 0, 2)) {
    issues.push({ path: [...path, "strength"], message: "Must be a number between 0 and 2", received: value.strength });
  }
  if (!isNumber(value.iterations) || !isInteger(value.iterations) || !inRange(value.iterations, 1, 10)) {
    issues.push({ path: [...path, "iterations"], message: "Must be an integer between 1 and 10", received: value.iterations });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["physics"]["link"] };
});

const validateChargeForceConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (!isNumber(value.strength) || !inRange(value.strength, -1000, 1000)) {
    issues.push({ path: [...path, "strength"], message: "Must be a number between -1000 and 1000", received: value.strength });
  }
  if (!isNumber(value.distanceMin) || value.distanceMin < 0) {
    issues.push({ path: [...path, "distanceMin"], message: "Must be a non-negative number", received: value.distanceMin });
  }
  if (!isPositiveNumberOrInfinity(value.distanceMax)) {
    issues.push({ path: [...path, "distanceMax"], message: "Must be a non-negative number or Infinity", received: value.distanceMax });
  }
  if (!isNumber(value.theta) || !inRange(value.theta, 0, 1)) {
    issues.push({ path: [...path, "theta"], message: "Must be a number between 0 and 1", received: value.theta });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["physics"]["charge"] };
});

const validateCollisionForceConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (value.radius !== "auto" && (!isNumber(value.radius) || (value.radius as number) < 0)) {
    issues.push({ path: [...path, "radius"], message: "Must be 'auto' or a non-negative number", received: value.radius });
  }
  if (!isNumber(value.strength) || !inRange(value.strength, 0, 1)) {
    issues.push({ path: [...path, "strength"], message: "Must be a number between 0 and 1", received: value.strength });
  }
  if (!isNumber(value.iterations) || !isInteger(value.iterations) || !inRange(value.iterations, 1, 10)) {
    issues.push({ path: [...path, "iterations"], message: "Must be an integer between 1 and 10", received: value.iterations });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["physics"]["collision"] };
});

const validateRadialForceConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (!isNumber(value.strength) || !inRange(value.strength, 0, 1)) {
    issues.push({ path: [...path, "strength"], message: "Must be a number between 0 and 1", received: value.strength });
  }
  if (!isNumber(value.radius) || value.radius < 0) {
    issues.push({ path: [...path, "radius"], message: "Must be a non-negative number", received: value.radius });
  }
  if (value.x !== undefined && !isNumber(value.x)) {
    issues.push({ path: [...path, "x"], message: "Must be a number", received: value.x });
  }
  if (value.y !== undefined && !isNumber(value.y)) {
    issues.push({ path: [...path, "y"], message: "Must be a number", received: value.y });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["physics"]["radial"] };
});

const validateSemanticForceConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isString(value.predicate) || value.predicate.length === 0) {
    issues.push({ path: [...path, "predicate"], message: "Must be a non-empty string", received: value.predicate });
  }
  if (!isNumber(value.attractionMultiplier) || !inRange(value.attractionMultiplier, 0, 10)) {
    issues.push({ path: [...path, "attractionMultiplier"], message: "Must be a number between 0 and 10", received: value.attractionMultiplier });
  }
  if (!isNumber(value.repulsionMultiplier) || !inRange(value.repulsionMultiplier, 0, 10)) {
    issues.push({ path: [...path, "repulsionMultiplier"], message: "Must be a number between 0 and 10", received: value.repulsionMultiplier });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value };
});

const validateSemanticPhysicsConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (!isArray(value.predicates)) {
    issues.push({ path: [...path, "predicates"], message: "Must be an array", received: value.predicates });
  } else {
    for (let i = 0; i < value.predicates.length; i++) {
      const predResult = validateSemanticForceConfig(value.predicates[i], [...path, "predicates", String(i)]);
      if (!predResult.valid) issues.push(...predResult.issues);
    }
  }
  if (!isNumber(value.defaultAttractionMultiplier) || !inRange(value.defaultAttractionMultiplier, 0, 10)) {
    issues.push({ path: [...path, "defaultAttractionMultiplier"], message: "Must be a number between 0 and 10", received: value.defaultAttractionMultiplier });
  }
  if (!isNumber(value.defaultRepulsionMultiplier) || !inRange(value.defaultRepulsionMultiplier, 0, 10)) {
    issues.push({ path: [...path, "defaultRepulsionMultiplier"], message: "Must be a number between 0 and 10", received: value.defaultRepulsionMultiplier });
  }
  if (!isBoolean(value.typeBasedRepulsion)) {
    issues.push({ path: [...path, "typeBasedRepulsion"], message: "Must be a boolean", received: value.typeBasedRepulsion });
  }
  if (!isNumber(value.differentTypeRepulsionMultiplier) || !inRange(value.differentTypeRepulsionMultiplier, 0, 10)) {
    issues.push({ path: [...path, "differentTypeRepulsionMultiplier"], message: "Must be a number between 0 and 10", received: value.differentTypeRepulsionMultiplier });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["physics"]["semantic"] };
});

const validatePhysicsConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }

  const simResult = validateSimulationConfig(value.simulation, [...path, "simulation"]);
  if (!simResult.valid) issues.push(...simResult.issues);

  const centerResult = validateCenterForceConfig(value.center, [...path, "center"]);
  if (!centerResult.valid) issues.push(...centerResult.issues);

  const linkResult = validateLinkForceConfig(value.link, [...path, "link"]);
  if (!linkResult.valid) issues.push(...linkResult.issues);

  const chargeResult = validateChargeForceConfig(value.charge, [...path, "charge"]);
  if (!chargeResult.valid) issues.push(...chargeResult.issues);

  const collisionResult = validateCollisionForceConfig(value.collision, [...path, "collision"]);
  if (!collisionResult.valid) issues.push(...collisionResult.issues);

  const radialResult = validateRadialForceConfig(value.radial, [...path, "radial"]);
  if (!radialResult.valid) issues.push(...radialResult.issues);

  const semanticResult = validateSemanticPhysicsConfig(value.semantic, [...path, "semantic"]);
  if (!semanticResult.valid) issues.push(...semanticResult.issues);

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["physics"] };
});

// ============================================================
// Rendering Validators
// ============================================================

const validatePerformanceConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isNumber(value.maxFPS) || !isInteger(value.maxFPS) || !inRange(value.maxFPS, 1, 120)) {
    issues.push({ path: [...path, "maxFPS"], message: "Must be an integer between 1 and 120", received: value.maxFPS });
  }
  if (value.pixelRatio !== "auto" && (!isNumber(value.pixelRatio) || !inRange(value.pixelRatio as number, 0.5, 4))) {
    issues.push({ path: [...path, "pixelRatio"], message: "Must be 'auto' or a number between 0.5 and 4", received: value.pixelRatio });
  }
  if (!isBoolean(value.antialias)) {
    issues.push({ path: [...path, "antialias"], message: "Must be a boolean", received: value.antialias });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["rendering"]["performance"] };
});

const validateNodeRenderConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isNumber(value.defaultRadius) || !inRange(value.defaultRadius, 1, 100)) {
    issues.push({ path: [...path, "defaultRadius"], message: "Must be a number between 1 and 100", received: value.defaultRadius });
  }
  if (!isNumber(value.minRadius) || !inRange(value.minRadius, 1, 100)) {
    issues.push({ path: [...path, "minRadius"], message: "Must be a number between 1 and 100", received: value.minRadius });
  }
  if (!isNumber(value.maxRadius) || !inRange(value.maxRadius, 1, 100)) {
    issues.push({ path: [...path, "maxRadius"], message: "Must be a number between 1 and 100", received: value.maxRadius });
  }
  if (value.sizeBy !== undefined && !isString(value.sizeBy)) {
    issues.push({ path: [...path, "sizeBy"], message: "Must be a string", received: value.sizeBy });
  }
  if (!isNumber(value.borderWidth) || !inRange(value.borderWidth, 0, 10)) {
    issues.push({ path: [...path, "borderWidth"], message: "Must be a number between 0 and 10", received: value.borderWidth });
  }
  if (!isBoolean(value.showShadow)) {
    issues.push({ path: [...path, "showShadow"], message: "Must be a boolean", received: value.showShadow });
  }
  if (!isNumber(value.shadowBlur) || !inRange(value.shadowBlur, 0, 50)) {
    issues.push({ path: [...path, "shadowBlur"], message: "Must be a number between 0 and 50", received: value.shadowBlur });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["rendering"]["nodes"] };
});

const validateEdgeRenderConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isNumber(value.defaultWidth) || !inRange(value.defaultWidth, 0.5, 10)) {
    issues.push({ path: [...path, "defaultWidth"], message: "Must be a number between 0.5 and 10", received: value.defaultWidth });
  }
  if (!isNumber(value.minWidth) || !inRange(value.minWidth, 0.5, 10)) {
    issues.push({ path: [...path, "minWidth"], message: "Must be a number between 0.5 and 10", received: value.minWidth });
  }
  if (!isNumber(value.maxWidth) || !inRange(value.maxWidth, 0.5, 20)) {
    issues.push({ path: [...path, "maxWidth"], message: "Must be a number between 0.5 and 20", received: value.maxWidth });
  }
  if (!isNumber(value.opacity) || !inRange(value.opacity, 0, 1)) {
    issues.push({ path: [...path, "opacity"], message: "Must be a number between 0 and 1", received: value.opacity });
  }
  if (!isNumber(value.curvature) || !inRange(value.curvature, 0, 1)) {
    issues.push({ path: [...path, "curvature"], message: "Must be a number between 0 and 1", received: value.curvature });
  }
  if (!isBoolean(value.showArrows)) {
    issues.push({ path: [...path, "showArrows"], message: "Must be a boolean", received: value.showArrows });
  }
  if (!isNumber(value.arrowSize) || !inRange(value.arrowSize, 2, 20)) {
    issues.push({ path: [...path, "arrowSize"], message: "Must be a number between 2 and 20", received: value.arrowSize });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["rendering"]["edges"] };
});

const validateLabelRenderConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isString(value.fontFamily)) {
    issues.push({ path: [...path, "fontFamily"], message: "Must be a string", received: value.fontFamily });
  }
  if (!isNumber(value.fontSize) || !inRange(value.fontSize, 8, 32)) {
    issues.push({ path: [...path, "fontSize"], message: "Must be a number between 8 and 32", received: value.fontSize });
  }
  if (!["normal", "bold", "lighter"].includes(value.fontWeight as string)) {
    issues.push({ path: [...path, "fontWeight"], message: "Must be 'normal', 'bold', or 'lighter'", received: value.fontWeight });
  }
  if (!isNumber(value.showThreshold) || !inRange(value.showThreshold, 0, 10)) {
    issues.push({ path: [...path, "showThreshold"], message: "Must be a number between 0 and 10", received: value.showThreshold });
  }
  if (!isNumber(value.maxLength) || !isInteger(value.maxLength) || !inRange(value.maxLength, 5, 100)) {
    issues.push({ path: [...path, "maxLength"], message: "Must be an integer between 5 and 100", received: value.maxLength });
  }
  if (!isNumber(value.offset) || !inRange(value.offset, 0, 50)) {
    issues.push({ path: [...path, "offset"], message: "Must be a number between 0 and 50", received: value.offset });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["rendering"]["labels"] };
});

const validateBackgroundConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isString(value.color)) {
    issues.push({ path: [...path, "color"], message: "Must be a string", received: value.color });
  }
  if (!isBoolean(value.showGrid)) {
    issues.push({ path: [...path, "showGrid"], message: "Must be a boolean", received: value.showGrid });
  }
  if (!isNumber(value.gridSize) || !inRange(value.gridSize, 10, 200)) {
    issues.push({ path: [...path, "gridSize"], message: "Must be a number between 10 and 200", received: value.gridSize });
  }
  if (!isString(value.gridColor)) {
    issues.push({ path: [...path, "gridColor"], message: "Must be a string", received: value.gridColor });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["rendering"]["background"] };
});

const validateRenderingConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  const perfResult = validatePerformanceConfig(value.performance, [...path, "performance"]);
  if (!perfResult.valid) issues.push(...perfResult.issues);

  const nodesResult = validateNodeRenderConfig(value.nodes, [...path, "nodes"]);
  if (!nodesResult.valid) issues.push(...nodesResult.issues);

  const edgesResult = validateEdgeRenderConfig(value.edges, [...path, "edges"]);
  if (!edgesResult.valid) issues.push(...edgesResult.issues);

  const labelsResult = validateLabelRenderConfig(value.labels, [...path, "labels"]);
  if (!labelsResult.valid) issues.push(...labelsResult.issues);

  const bgResult = validateBackgroundConfig(value.background, [...path, "background"]);
  if (!bgResult.valid) issues.push(...bgResult.issues);

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["rendering"] };
});

// ============================================================
// Interaction Validators
// ============================================================

const validateZoomConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (!isNumber(value.min) || !inRange(value.min, 0.01, 1)) {
    issues.push({ path: [...path, "min"], message: "Must be a number between 0.01 and 1", received: value.min });
  }
  if (!isNumber(value.max) || !inRange(value.max, 1, 50)) {
    issues.push({ path: [...path, "max"], message: "Must be a number between 1 and 50", received: value.max });
  }
  if (!isNumber(value.step) || !inRange(value.step, 1.01, 2)) {
    issues.push({ path: [...path, "step"], message: "Must be a number between 1.01 and 2", received: value.step });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["interaction"]["zoom"] };
});

const validatePanConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (!isBoolean(value.inertia)) {
    issues.push({ path: [...path, "inertia"], message: "Must be a boolean", received: value.inertia });
  }
  if (!isNumber(value.friction) || !inRange(value.friction, 0, 1)) {
    issues.push({ path: [...path, "friction"], message: "Must be a number between 0 and 1", received: value.friction });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["interaction"]["pan"] };
});

const validateSelectionConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.multiSelect)) {
    issues.push({ path: [...path, "multiSelect"], message: "Must be a boolean", received: value.multiSelect });
  }
  if (!["ctrl", "shift", "meta", "alt"].includes(value.modifierKey as string)) {
    issues.push({ path: [...path, "modifierKey"], message: "Must be 'ctrl', 'shift', 'meta', or 'alt'", received: value.modifierKey });
  }
  if (!isBoolean(value.boxSelect)) {
    issues.push({ path: [...path, "boxSelect"], message: "Must be a boolean", received: value.boxSelect });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["interaction"]["selection"] };
});

const validateDragConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (!isNumber(value.threshold) || !inRange(value.threshold, 0, 20)) {
    issues.push({ path: [...path, "threshold"], message: "Must be a number between 0 and 20", received: value.threshold });
  }
  if (!isBoolean(value.showPreview)) {
    issues.push({ path: [...path, "showPreview"], message: "Must be a boolean", received: value.showPreview });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["interaction"]["drag"] };
});

const validateClickConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isNumber(value.doubleClickDelay) || !inRange(value.doubleClickDelay, 100, 1000)) {
    issues.push({ path: [...path, "doubleClickDelay"], message: "Must be a number between 100 and 1000", received: value.doubleClickDelay });
  }
  if (!isNumber(value.hoverDelay) || !inRange(value.hoverDelay, 0, 2000)) {
    issues.push({ path: [...path, "hoverDelay"], message: "Must be a number between 0 and 2000", received: value.hoverDelay });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["interaction"]["click"] };
});

const validateTouchConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (!isBoolean(value.pinchZoom)) {
    issues.push({ path: [...path, "pinchZoom"], message: "Must be a boolean", received: value.pinchZoom });
  }
  if (!isBoolean(value.twoFingerPan)) {
    issues.push({ path: [...path, "twoFingerPan"], message: "Must be a boolean", received: value.twoFingerPan });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["interaction"]["touch"] };
});

const validateInteractionConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  const zoomResult = validateZoomConfig(value.zoom, [...path, "zoom"]);
  if (!zoomResult.valid) issues.push(...zoomResult.issues);

  const panResult = validatePanConfig(value.pan, [...path, "pan"]);
  if (!panResult.valid) issues.push(...panResult.issues);

  const selectionResult = validateSelectionConfig(value.selection, [...path, "selection"]);
  if (!selectionResult.valid) issues.push(...selectionResult.issues);

  const dragResult = validateDragConfig(value.drag, [...path, "drag"]);
  if (!dragResult.valid) issues.push(...dragResult.issues);

  const clickResult = validateClickConfig(value.click, [...path, "click"]);
  if (!clickResult.valid) issues.push(...clickResult.issues);

  const touchResult = validateTouchConfig(value.touch, [...path, "touch"]);
  if (!touchResult.valid) issues.push(...touchResult.issues);

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["interaction"] };
});

// ============================================================
// Filter Validators
// ============================================================

const validateFilterConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isArray(value.nodeTypes) || !value.nodeTypes.every(isString)) {
    issues.push({ path: [...path, "nodeTypes"], message: "Must be an array of strings", received: value.nodeTypes });
  }
  if (!isArray(value.edgeTypes) || !value.edgeTypes.every(isString)) {
    issues.push({ path: [...path, "edgeTypes"], message: "Must be an array of strings", received: value.edgeTypes });
  }
  if (!isBoolean(value.showOrphans)) {
    issues.push({ path: [...path, "showOrphans"], message: "Must be a boolean", received: value.showOrphans });
  }
  if (!isNumber(value.minDegree) || !isInteger(value.minDegree) || value.minDegree < 0) {
    issues.push({ path: [...path, "minDegree"], message: "Must be a non-negative integer", received: value.minDegree });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["filters"] };
});

// ============================================================
// Layout Validators
// ============================================================

const validateForceLayoutConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isNumber(value.initialIterations) || !isInteger(value.initialIterations) || !inRange(value.initialIterations, 0, 500)) {
    issues.push({ path: [...path, "initialIterations"], message: "Must be an integer between 0 and 500", received: value.initialIterations });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["layout"]["force"] };
});

const validateHierarchicalLayoutConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!["TB", "BT", "LR", "RL"].includes(value.direction as string)) {
    issues.push({ path: [...path, "direction"], message: "Must be 'TB', 'BT', 'LR', or 'RL'", received: value.direction });
  }
  if (!isNumber(value.levelSeparation) || !inRange(value.levelSeparation, 20, 500)) {
    issues.push({ path: [...path, "levelSeparation"], message: "Must be a number between 20 and 500", received: value.levelSeparation });
  }
  if (!isNumber(value.nodeSeparation) || !inRange(value.nodeSeparation, 10, 200)) {
    issues.push({ path: [...path, "nodeSeparation"], message: "Must be a number between 10 and 200", received: value.nodeSeparation });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["layout"]["hierarchical"] };
});

const validateRadialLayoutConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isNumber(value.rings) || !isInteger(value.rings) || !inRange(value.rings, 1, 20)) {
    issues.push({ path: [...path, "rings"], message: "Must be an integer between 1 and 20", received: value.rings });
  }
  if (!isNumber(value.ringSeparation) || !inRange(value.ringSeparation, 20, 300)) {
    issues.push({ path: [...path, "ringSeparation"], message: "Must be a number between 20 and 300", received: value.ringSeparation });
  }
  if (!isNumber(value.startAngle) || !inRange(value.startAngle, 0, Math.PI * 2)) {
    issues.push({ path: [...path, "startAngle"], message: `Must be a number between 0 and ${Math.PI * 2}`, received: value.startAngle });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["layout"]["radial"] };
});

const validateGridLayoutConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isNumber(value.columns) || !isInteger(value.columns) || value.columns < 0) {
    issues.push({ path: [...path, "columns"], message: "Must be a non-negative integer", received: value.columns });
  }
  if (!isNumber(value.cellWidth) || !inRange(value.cellWidth, 20, 500)) {
    issues.push({ path: [...path, "cellWidth"], message: "Must be a number between 20 and 500", received: value.cellWidth });
  }
  if (!isNumber(value.cellHeight) || !inRange(value.cellHeight, 20, 500)) {
    issues.push({ path: [...path, "cellHeight"], message: "Must be a number between 20 and 500", received: value.cellHeight });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["layout"]["grid"] };
});

const validateLayoutConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!["force", "hierarchical", "radial", "grid"].includes(value.defaultAlgorithm as string)) {
    issues.push({ path: [...path, "defaultAlgorithm"], message: "Must be 'force', 'hierarchical', 'radial', or 'grid'", received: value.defaultAlgorithm });
  }

  const forceResult = validateForceLayoutConfig(value.force, [...path, "force"]);
  if (!forceResult.valid) issues.push(...forceResult.issues);

  const hierarchicalResult = validateHierarchicalLayoutConfig(value.hierarchical, [...path, "hierarchical"]);
  if (!hierarchicalResult.valid) issues.push(...hierarchicalResult.issues);

  const radialResult = validateRadialLayoutConfig(value.radial, [...path, "radial"]);
  if (!radialResult.valid) issues.push(...radialResult.issues);

  const gridResult = validateGridLayoutConfig(value.grid, [...path, "grid"]);
  if (!gridResult.valid) issues.push(...gridResult.issues);

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["layout"] };
});

// ============================================================
// Minimap Validators
// ============================================================

const validateMinimapConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isBoolean(value.enabled)) {
    issues.push({ path: [...path, "enabled"], message: "Must be a boolean", received: value.enabled });
  }
  if (!["top-left", "top-right", "bottom-left", "bottom-right"].includes(value.position as string)) {
    issues.push({ path: [...path, "position"], message: "Must be 'top-left', 'top-right', 'bottom-left', or 'bottom-right'", received: value.position });
  }
  if (!isNumber(value.width) || !inRange(value.width, 50, 400)) {
    issues.push({ path: [...path, "width"], message: "Must be a number between 50 and 400", received: value.width });
  }
  if (!isNumber(value.height) || !inRange(value.height, 50, 400)) {
    issues.push({ path: [...path, "height"], message: "Must be a number between 50 and 400", received: value.height });
  }
  if (!isNumber(value.opacity) || !inRange(value.opacity, 0.1, 1)) {
    issues.push({ path: [...path, "opacity"], message: "Must be a number between 0.1 and 1", received: value.opacity });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig["minimap"] };
});

// ============================================================
// Complete Graph Config Validator
// ============================================================

const validateGraphConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  const physicsResult = validatePhysicsConfig(value.physics, [...path, "physics"]);
  if (!physicsResult.valid) issues.push(...physicsResult.issues);

  const renderingResult = validateRenderingConfig(value.rendering, [...path, "rendering"]);
  if (!renderingResult.valid) issues.push(...renderingResult.issues);

  const interactionResult = validateInteractionConfig(value.interaction, [...path, "interaction"]);
  if (!interactionResult.valid) issues.push(...interactionResult.issues);

  const filtersResult = validateFilterConfig(value.filters, [...path, "filters"]);
  if (!filtersResult.valid) issues.push(...filtersResult.issues);

  const layoutResult = validateLayoutConfig(value.layout, [...path, "layout"]);
  if (!layoutResult.valid) issues.push(...layoutResult.issues);

  const minimapResult = validateMinimapConfig(value.minimap, [...path, "minimap"]);
  if (!minimapResult.valid) issues.push(...minimapResult.issues);

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as GraphConfig };
});

// ============================================================
// Preset Validator
// ============================================================

const validatePresetConfig = createValidator((value, path) => {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: [{ path, message: "Expected object", received: typeof value, expected: "object" }] };
  }

  if (!isString(value.name) || value.name.length < 1 || value.name.length > 50) {
    issues.push({ path: [...path, "name"], message: "Must be a string between 1 and 50 characters", received: value.name });
  }
  if (!isString(value.description) || value.description.length > 200) {
    issues.push({ path: [...path, "description"], message: "Must be a string with max 200 characters", received: value.description });
  }
  if (!isObject(value.config)) {
    issues.push({ path: [...path, "config"], message: "Must be an object", received: value.config });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, data: value as unknown as ConfigPreset };
});

// ============================================================
// Exported Schema-like Objects (for backwards compatibility)
// ============================================================

// Export schema objects that mimic the Zod API for tests
export const PhysicsConfigSchema = {
  safeParse: (value: unknown) => {
    const result = validatePhysicsConfig(value, []);
    return result.valid
      ? { success: true, data: result.data }
      : { success: false, error: { issues: result.issues } };
  },
};

export const RenderingConfigSchema = {
  safeParse: (value: unknown) => {
    const result = validateRenderingConfig(value, []);
    return result.valid
      ? { success: true, data: result.data }
      : { success: false, error: { issues: result.issues } };
  },
};

export const InteractionConfigSchema = {
  safeParse: (value: unknown) => {
    const result = validateInteractionConfig(value, []);
    return result.valid
      ? { success: true, data: result.data }
      : { success: false, error: { issues: result.issues } };
  },
};

export const FilterConfigSchema = {
  safeParse: (value: unknown) => {
    const result = validateFilterConfig(value, []);
    return result.valid
      ? { success: true, data: result.data }
      : { success: false, error: { issues: result.issues } };
  },
};

export const LayoutConfigSchema = {
  safeParse: (value: unknown) => {
    const result = validateLayoutConfig(value, []);
    return result.valid
      ? { success: true, data: result.data }
      : { success: false, error: { issues: result.issues } };
  },
};

export const MinimapConfigSchema = {
  safeParse: (value: unknown) => {
    const result = validateMinimapConfig(value, []);
    return result.valid
      ? { success: true, data: result.data }
      : { success: false, error: { issues: result.issues } };
  },
};

export const ConfigPresetSchema = {
  safeParse: (value: unknown) => {
    const result = validatePresetConfig(value, []);
    return result.valid
      ? { success: true, data: result.data }
      : { success: false, error: { issues: result.issues } };
  },
};

export const GraphConfigSchema = {
  safeParse: (value: unknown) => {
    const result = validateGraphConfig(value, []);
    return result.valid
      ? { success: true, data: result.data }
      : { success: false, error: { issues: result.issues } };
  },
};

// ============================================================
// Default Configuration Values
// ============================================================

/**
 * Get the default configuration with all values set
 */
export function getDefaultConfig(): GraphConfig {
  return {
    physics: {
      enabled: true,
      simulation: {
        alphaMin: 0.001,
        alphaDecay: 0.0228,
        alphaTarget: 0,
        velocityDecay: 0.4,
      },
      center: {
        enabled: true,
        strength: 0.1,
      },
      link: {
        enabled: true,
        distance: 100,
        strength: 1,
        iterations: 1,
      },
      charge: {
        enabled: true,
        strength: -300,
        distanceMin: 1,
        distanceMax: Infinity,
        theta: 0.9,
      },
      collision: {
        enabled: true,
        radius: "auto",
        strength: 0.7,
        iterations: 1,
      },
      radial: {
        enabled: false,
        strength: 0.1,
        radius: 200,
      },
      semantic: {
        enabled: true,
        predicates: [
          // Attraction modifiers: pull related nodes closer
          { predicate: "rdfs:subClassOf", attractionMultiplier: 2.0, repulsionMultiplier: 1.0 },
          { predicate: "exo:Asset_prototype", attractionMultiplier: 1.8, repulsionMultiplier: 1.0 },
          { predicate: "dcterms:isPartOf", attractionMultiplier: 1.5, repulsionMultiplier: 1.0 },
          // Repulsion modifiers: push unrelated nodes apart
          { predicate: "owl:disjointWith", attractionMultiplier: 1.0, repulsionMultiplier: 3.0 },
        ],
        defaultAttractionMultiplier: 1.0,
        defaultRepulsionMultiplier: 1.0,
        typeBasedRepulsion: true,
        differentTypeRepulsionMultiplier: 1.3,
      },
    },
    rendering: {
      performance: {
        maxFPS: 60,
        pixelRatio: "auto",
        antialias: true,
      },
      nodes: {
        defaultRadius: 8,
        minRadius: 4,
        maxRadius: 24,
        borderWidth: 1,
        showShadow: false,
        shadowBlur: 10,
      },
      edges: {
        defaultWidth: 1,
        minWidth: 0.5,
        maxWidth: 5,
        opacity: 0.6,
        curvature: 0,
        showArrows: true,
        arrowSize: 6,
      },
      labels: {
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 12,
        fontWeight: "normal",
        showThreshold: 0.5,
        maxLength: 30,
        offset: 4,
      },
      background: {
        color: "#1e1e1e",
        showGrid: false,
        gridSize: 50,
        gridColor: "#333333",
      },
    },
    interaction: {
      zoom: {
        enabled: true,
        min: 0.1,
        max: 10,
        step: 1.2,
      },
      pan: {
        enabled: true,
        inertia: true,
        friction: 0.85,
      },
      selection: {
        multiSelect: true,
        modifierKey: "shift",
        boxSelect: true,
      },
      drag: {
        enabled: true,
        threshold: 5,
        showPreview: true,
      },
      click: {
        doubleClickDelay: 300,
        hoverDelay: 500,
      },
      touch: {
        enabled: true,
        pinchZoom: true,
        twoFingerPan: true,
      },
    },
    filters: {
      nodeTypes: [],
      edgeTypes: [],
      showOrphans: true,
      minDegree: 0,
    },
    layout: {
      defaultAlgorithm: "force",
      force: {
        initialIterations: 100,
      },
      hierarchical: {
        direction: "TB",
        levelSeparation: 100,
        nodeSeparation: 50,
      },
      radial: {
        rings: 5,
        ringSeparation: 80,
        startAngle: 0,
      },
      grid: {
        columns: 0,
        cellWidth: 100,
        cellHeight: 100,
      },
    },
    minimap: {
      enabled: true,
      position: "bottom-right",
      width: 150,
      height: 100,
      opacity: 0.8,
    },
  };
}

// ============================================================
// Validation Functions
// ============================================================

/**
 * Validate a complete graph configuration
 */
export function validateConfig(config: unknown): SafeParseResult<GraphConfig> {
  const result = validateGraphConfig(config, []);
  return result.valid
    ? { success: true, data: result.data }
    : { success: false, error: { issues: result.issues } };
}

/**
 * Validate a partial configuration update
 * For partial configs, we don't validate deeply - just check if it's an object
 */
export function validatePartialConfig(config: unknown): SafeParseResult<unknown> {
  if (!isObject(config)) {
    return { success: false, error: { issues: [{ path: [], message: "Expected object", received: typeof config }] } };
  }
  return { success: true, data: config };
}

/**
 * Validate a preset configuration
 */
export function validatePreset(preset: unknown): SafeParseResult<ConfigPreset> {
  const result = validatePresetConfig(preset, []);
  return result.valid
    ? { success: true, data: result.data }
    : { success: false, error: { issues: result.issues } };
}
