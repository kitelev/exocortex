/**
 * SHACL Validator Service
 *
 * Validates RDF data against SHACL shapes. Implements a subset of the
 * W3C SHACL specification for validating Command class definitions.
 *
 * @see https://github.com/kitelev/exocortex/issues/1435
 * @see https://www.w3.org/TR/shacl/
 * @module services/shacl
 * @since 1.4.0
 */

import { Triple } from "../../domain/models/rdf/Triple";
import { IRI } from "../../domain/models/rdf/IRI";
import { Literal } from "../../domain/models/rdf/Literal";
import { Namespace } from "../../domain/models/rdf/Namespace";
import { TurtleParser } from "../../infrastructure/rdf/parsers/TurtleParser";

/**
 * Result of SHACL validation.
 */
export interface ValidationResult {
  /** Whether the data graph conforms to all shapes */
  conforms: boolean;
  /** List of validation violations */
  violations: ValidationViolation[];
}

/**
 * A single validation violation.
 */
export interface ValidationViolation {
  /** The node that failed validation */
  focusNode: string;
  /** The property path that was violated */
  path?: string;
  /** Human-readable error message */
  message: string;
  /** The severity of the violation */
  severity: "Violation" | "Warning" | "Info";
  /** The source constraint component */
  sourceConstraintComponent?: string;
}

/**
 * Parsed shape definition.
 */
interface ShapeDefinition {
  shapeUri: string;
  targetClass: string | null;
  properties: PropertyConstraint[];
}

/**
 * Property constraint from a SHACL shape.
 */
interface PropertyConstraint {
  path: string;
  datatype?: string;
  nodeKind?: "IRI" | "BlankNode" | "Literal" | "BlankNodeOrIRI" | "BlankNodeOrLiteral" | "IRIOrLiteral";
  minCount?: number;
  maxCount?: number;
  message?: string;
}

/**
 * SHACL namespace for properties.
 */
const SH = {
  targetClass: "http://www.w3.org/ns/shacl#targetClass",
  property: "http://www.w3.org/ns/shacl#property",
  path: "http://www.w3.org/ns/shacl#path",
  datatype: "http://www.w3.org/ns/shacl#datatype",
  nodeKind: "http://www.w3.org/ns/shacl#nodeKind",
  minCount: "http://www.w3.org/ns/shacl#minCount",
  maxCount: "http://www.w3.org/ns/shacl#maxCount",
  message: "http://www.w3.org/ns/shacl#message",
  NodeShape: "http://www.w3.org/ns/shacl#NodeShape",
  IRI: "http://www.w3.org/ns/shacl#IRI",
  BlankNode: "http://www.w3.org/ns/shacl#BlankNode",
  Literal: "http://www.w3.org/ns/shacl#Literal",
};

/**
 * SHACL Validator for RDF data.
 *
 * Validates RDF data graphs against SHACL shape graphs.
 * Currently supports a subset of SHACL Core:
 * - sh:targetClass
 * - sh:property
 * - sh:path
 * - sh:datatype
 * - sh:nodeKind (sh:IRI)
 * - sh:minCount
 * - sh:maxCount
 * - sh:message
 *
 * @example
 * ```typescript
 * const validator = new ShaclValidator();
 * const result = await validator.validate(dataRdf, shapesRdf);
 * if (!result.conforms) {
 *   console.log("Violations:", result.violations);
 * }
 * ```
 */
export class ShaclValidator {
  private readonly turtleParser: TurtleParser;
  private readonly shapesPrefixes: Record<string, string> = {
    sh: "http://www.w3.org/ns/shacl#",
    xsd: Namespace.XSD.iri.value,
    rdf: Namespace.RDF.iri.value,
    rdfs: Namespace.RDFS.iri.value,
    "exo-ui": "https://exocortex.my/ontology/exo-ui#",
  };

  constructor() {
    this.turtleParser = new TurtleParser();
  }

  /**
   * Validate RDF data against SHACL shapes.
   *
   * @param dataTurtle - RDF data in Turtle format
   * @param shapesTurtle - SHACL shapes in Turtle format
   * @returns Validation result with conformance status and violations
   */
  async validate(dataTurtle: string, shapesTurtle: string): Promise<ValidationResult> {
    // Handle empty data graph - should conform
    if (!dataTurtle || dataTurtle.trim() === "") {
      return { conforms: true, violations: [] };
    }

    // Parse shapes graph
    const shapes = this.parseShapes(shapesTurtle);

    // Parse data graph
    const dataTriples = this.parseData(dataTurtle);

    // Validate data against shapes
    const violations: ValidationViolation[] = [];

    for (const shape of shapes) {
      if (!shape.targetClass) {
        continue;
      }

      // Find all instances of the target class
      const targetInstances = this.findInstancesOf(dataTriples, shape.targetClass);

      // Validate each instance against the shape
      for (const instance of targetInstances) {
        const instanceViolations = this.validateInstance(dataTriples, instance, shape);
        violations.push(...instanceViolations);
      }
    }

    return {
      conforms: violations.length === 0,
      violations,
    };
  }

  /**
   * Parse SHACL shapes from Turtle format.
   */
  private parseShapes(shapesTurtle: string): ShapeDefinition[] {
    const triples = this.parseWithExpandedSyntax(shapesTurtle);
    const shapes: ShapeDefinition[] = [];
    const blankNodeProperties: Map<string, Triple[]> = new Map();

    // Group triples by subject
    const triplesBySubject = new Map<string, Triple[]>();
    for (const triple of triples) {
      const subjectStr = this.nodeToString(triple.subject);
      const subjectTriples = triplesBySubject.get(subjectStr) ?? [];
      if (subjectTriples.length === 0) {
        triplesBySubject.set(subjectStr, subjectTriples);
      }
      subjectTriples.push(triple);

      // Track blank node definitions
      if (subjectStr.startsWith("_:")) {
        const blankTriples = blankNodeProperties.get(subjectStr) ?? [];
        if (blankTriples.length === 0) {
          blankNodeProperties.set(subjectStr, blankTriples);
        }
        blankTriples.push(triple);
      }
    }

    // Find all NodeShapes
    for (const [subject, subjectTriples] of triplesBySubject.entries()) {
      const isNodeShape = subjectTriples.some(
        (t) =>
          t.predicate.value === Namespace.RDF.iri.value + "type" &&
          t.object instanceof IRI &&
          t.object.value === SH.NodeShape
      );

      if (!isNodeShape) {
        continue;
      }

      // Extract targetClass
      const targetClassTriple = subjectTriples.find(
        (t) => t.predicate.value === SH.targetClass
      );
      const targetClass = targetClassTriple?.object instanceof IRI
        ? targetClassTriple.object.value
        : null;

      // Extract properties
      const properties: PropertyConstraint[] = [];
      const propertyTriples = subjectTriples.filter(
        (t) => t.predicate.value === SH.property
      );

      for (const propTriple of propertyTriples) {
        const propNodeStr = this.nodeToString(propTriple.object);
        const propNodeTriples = blankNodeProperties.get(propNodeStr) || [];

        const constraint = this.parsePropertyConstraint(propNodeTriples);
        if (constraint) {
          properties.push(constraint);
        }
      }

      shapes.push({
        shapeUri: subject,
        targetClass,
        properties,
      });
    }

    return shapes;
  }

  /**
   * Parse a property constraint from blank node triples.
   */
  private parsePropertyConstraint(triples: Triple[]): PropertyConstraint | null {
    let path: string | null = null;
    let datatype: string | undefined;
    let nodeKind: PropertyConstraint["nodeKind"] | undefined;
    let minCount: number | undefined;
    let maxCount: number | undefined;
    let message: string | undefined;

    for (const triple of triples) {
      const pred = triple.predicate.value;

      if (pred === SH.path && triple.object instanceof IRI) {
        path = triple.object.value;
      } else if (pred === SH.datatype && triple.object instanceof IRI) {
        datatype = triple.object.value;
      } else if (pred === SH.nodeKind && triple.object instanceof IRI) {
        if (triple.object.value === SH.IRI) {
          nodeKind = "IRI";
        } else if (triple.object.value === SH.BlankNode) {
          nodeKind = "BlankNode";
        } else if (triple.object.value === SH.Literal) {
          nodeKind = "Literal";
        }
      } else if (pred === SH.minCount && triple.object instanceof Literal) {
        minCount = parseInt(triple.object.value, 10);
      } else if (pred === SH.maxCount && triple.object instanceof Literal) {
        maxCount = parseInt(triple.object.value, 10);
      } else if (pred === SH.message && triple.object instanceof Literal) {
        message = triple.object.value;
      }
    }

    if (!path) {
      return null;
    }

    return { path, datatype, nodeKind, minCount, maxCount, message };
  }

  /**
   * Parse data Turtle using the standard parser.
   */
  private parseData(dataTurtle: string): Triple[] {
    try {
      return this.parseWithExpandedSyntax(dataTurtle);
    } catch {
      return [];
    }
  }

  /**
   * Parse Turtle using the built-in parser.
   * The shape format uses simple statements without semicolons for compatibility.
   */
  private parseWithExpandedSyntax(turtle: string): Triple[] {
    return this.turtleParser.parse(turtle, { prefixes: this.shapesPrefixes });
  }

  /**
   * Find all instances of a given RDF class.
   */
  private findInstancesOf(triples: Triple[], classUri: string): IRI[] {
    const instances: IRI[] = [];

    for (const triple of triples) {
      if (
        triple.predicate.value === Namespace.RDF.iri.value + "type" &&
        triple.object instanceof IRI &&
        triple.object.value === classUri &&
        triple.subject instanceof IRI
      ) {
        instances.push(triple.subject);
      }
    }

    return instances;
  }

  /**
   * Validate a single instance against a shape.
   */
  private validateInstance(
    triples: Triple[],
    instance: IRI,
    shape: ShapeDefinition
  ): ValidationViolation[] {
    const violations: ValidationViolation[] = [];

    for (const constraint of shape.properties) {
      const propertyViolations = this.validatePropertyConstraint(
        triples,
        instance,
        constraint
      );
      violations.push(...propertyViolations);
    }

    return violations;
  }

  /**
   * Validate a property constraint for an instance.
   */
  private validatePropertyConstraint(
    triples: Triple[],
    instance: IRI,
    constraint: PropertyConstraint
  ): ValidationViolation[] {
    const violations: ValidationViolation[] = [];

    // Find all values for this property
    const values = triples.filter(
      (t) =>
        t.subject instanceof IRI &&
        t.subject.equals(instance) &&
        t.predicate.value === constraint.path
    );

    const count = values.length;
    const pathLocalName = constraint.path.split("#").pop() || constraint.path.split("/").pop() || constraint.path;

    // Check minCount
    if (constraint.minCount !== undefined && count < constraint.minCount) {
      violations.push({
        focusNode: instance.value,
        path: pathLocalName,
        message: constraint.message || `Property ${pathLocalName} requires at least ${constraint.minCount} value(s), found ${count}`,
        severity: "Violation",
        sourceConstraintComponent: "MinCountConstraintComponent",
      });
    }

    // Check maxCount
    if (constraint.maxCount !== undefined && count > constraint.maxCount) {
      violations.push({
        focusNode: instance.value,
        path: pathLocalName,
        message: constraint.message || `Property ${pathLocalName} allows at most ${constraint.maxCount} value(s), found ${count}`,
        severity: "Violation",
        sourceConstraintComponent: "MaxCountConstraintComponent",
      });
    }

    // Check datatype and nodeKind for each value
    for (const triple of values) {
      if (constraint.datatype) {
        if (!(triple.object instanceof Literal)) {
          violations.push({
            focusNode: instance.value,
            path: pathLocalName,
            message: constraint.message || `Property ${pathLocalName} value must be a literal with datatype ${constraint.datatype}`,
            severity: "Violation",
            sourceConstraintComponent: "DatatypeConstraintComponent",
          });
        } else if (triple.object.datatype && triple.object.datatype.value !== constraint.datatype) {
          violations.push({
            focusNode: instance.value,
            path: pathLocalName,
            message: constraint.message || `Property ${pathLocalName} value has wrong datatype: expected ${constraint.datatype}, got ${triple.object.datatype.value}`,
            severity: "Violation",
            sourceConstraintComponent: "DatatypeConstraintComponent",
          });
        }
      }

      if (constraint.nodeKind === "IRI" && !(triple.object instanceof IRI)) {
        violations.push({
          focusNode: instance.value,
          path: pathLocalName,
          message: constraint.message || `Property ${pathLocalName} value must be an IRI`,
          severity: "Violation",
          sourceConstraintComponent: "NodeKindConstraintComponent",
        });
      }
    }

    return violations;
  }

  /**
   * Convert an RDF node to string for map keys.
   */
  private nodeToString(node: Triple["subject"] | Triple["object"]): string {
    if (node instanceof IRI) {
      return node.value;
    } else if (node instanceof Literal) {
      return `"${node.value}"`;
    } else if ("id" in node) {
      // BlankNode
      return `_:${(node as { id: string }).id}`;
    }
    return String(node);
  }
}
