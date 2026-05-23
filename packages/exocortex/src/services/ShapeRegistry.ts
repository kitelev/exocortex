/**
 * Shape: a parsed SHACL-lite constraint for a single property.
 * W3C SHACL vocabulary aligned — see RFC 82a72aca §"Engine: SHACL-lite service".
 */
export interface Shape {
  propertyIRI: string;
  domain: string[];
  range?: string[];
  cardinality?: "Single" | "Multiple";
  minCount?: number;
  /**
   * ECMAScript-compatible regex string applied to literal values.
   * Maps to W3C SHACL `sh:pattern`. Cached as a compiled `RegExp` once per
   * `validate()` call (not per subject) — invalid patterns are silently
   * ignored (TBox config error). Anchors `^`/`$` recommended for exact-match.
   */
  pattern?: string;
  severity: "sh:Violation" | "sh:Warning" | "sh:Info";
  message?: string;
}

/**
 * In-memory registry: propertyIRI → Shape.
 */
export class ShapeRegistry {
  private readonly shapes: Map<string, Shape> = new Map();

  get(propertyIRI: string): Shape | undefined {
    return this.shapes.get(propertyIRI);
  }

  register(shape: Shape): void {
    this.shapes.set(shape.propertyIRI, shape);
  }

  getAll(): Shape[] {
    return Array.from(this.shapes.values());
  }

  get size(): number {
    return this.shapes.size;
  }
}
