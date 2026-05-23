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
   * Maps to W3C SHACL `sh:pattern`. Compiled once per validation run;
   * invalid patterns are silently ignored (TBox config error, not data error).
   * Anchors `^`/`$` recommended for exact-match semantics.
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
