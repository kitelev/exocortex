import type { SolutionMapping } from "../SolutionMapping";
import { Triple } from "../../../domain/models/rdf/Triple";
import { IRI } from "../../../domain/models/rdf/IRI";
import { Literal } from "../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import { QuotedTriple as RDFQuotedTriple } from "../../../domain/models/rdf/QuotedTriple";
import type { Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";
import type { QuotedSubject, QuotedPredicate, QuotedObject } from "../../../domain/models/rdf/QuotedTriple";
import type {
  Triple as AlgebraTriple,
  TripleElement,
  PropertyPath,
  QuotedTriple as AlgebraQuotedTriple,
} from "../algebra/AlgebraOperation";

export class ConstructExecutor {
  async execute(template: AlgebraTriple[], solutions: SolutionMapping[]): Promise<Triple[]> {
    const resultTriples: Triple[] = [];
    const seen = new Set<string>();

    for (const solution of solutions) {
      for (const pattern of template) {
        try {
          const triple = this.instantiateTriple(pattern, solution);
          const key = `${triple.subject.toString()}|${triple.predicate.toString()}|${triple.object.toString()}`;

          if (!seen.has(key)) {
            seen.add(key);
            resultTriples.push(triple);
          }
        } catch (error) {
          continue;
        }
      }
    }

    return resultTriples;
  }

  private instantiateTriple(pattern: AlgebraTriple, solution: SolutionMapping): Triple {
    // Property paths are not supported in CONSTRUCT templates
    if (this.isPropertyPath(pattern.predicate)) {
      throw new Error("Property paths are not supported in CONSTRUCT templates");
    }

    const subject = this.instantiateElement(pattern.subject, solution) as Subject;
    const predicate = this.instantiateElement(pattern.predicate, solution) as Predicate;
    const object = this.instantiateElement(pattern.object, solution) as RDFObject;

    return new Triple(subject, predicate, object);
  }

  private isPropertyPath(predicate: TripleElement | PropertyPath): predicate is PropertyPath {
    return predicate.type === "path";
  }

  private instantiateElement(element: TripleElement, solution: SolutionMapping): Subject | Predicate | RDFObject {
    if (element.type === "variable") {
      const bound = solution.get(element.value);
      if (!bound) {
        throw new Error(`Unbound variable: ${element.value}`);
      }
      return bound;
    }

    if (element.type === "iri") {
      return new IRI(element.value);
    }

    if (element.type === "literal") {
      return new Literal(
        element.value,
        element.datatype ? new IRI(element.datatype) : undefined,
        element.language
      );
    }

    if (element.type === "blank") {
      return new BlankNode(element.value);
    }

    if (element.type === "quoted") {
      return this.instantiateQuotedTriple(element, solution);
    }

    throw new Error(`Unknown element type: ${(element as any).type}`);
  }

  /**
   * Instantiate a quoted triple from an algebra QuotedTriple pattern.
   * Supports RDF-Star CONSTRUCT templates with quoted triples.
   *
   * Example SPARQL:
   * ```sparql
   * CONSTRUCT {
   *   <<( ?person :hasName ?name )>> :source :Database .
   * }
   * WHERE {
   *   ?person :name ?name .
   * }
   * ```
   *
   * Variables inside the quoted triple are substituted with bound values.
   * Supports nested quoted triples for complex provenance graphs.
   *
   * @param element - The algebra QuotedTriple pattern with potential variables
   * @param solution - Variable bindings from WHERE clause evaluation
   * @returns Instantiated RDF QuotedTriple with all variables substituted
   * @throws Error if any variable in the quoted triple is unbound
   */
  private instantiateQuotedTriple(
    element: AlgebraQuotedTriple,
    solution: SolutionMapping
  ): RDFQuotedTriple {
    // Instantiate subject (can be IRI, BlankNode, or nested QuotedTriple)
    const subject = this.instantiateQuotedSubject(element.subject, solution);

    // Instantiate predicate (must be IRI, but may be a variable)
    const predicate = this.instantiateQuotedPredicate(element.predicate, solution);

    // Instantiate object (can be IRI, BlankNode, Literal, or nested QuotedTriple)
    const object = this.instantiateQuotedObject(element.object, solution);

    return new RDFQuotedTriple(subject, predicate, object);
  }

  /**
   * Instantiate a quoted triple subject from an algebra element.
   * Subjects in quoted triples can be IRI, BlankNode, or another QuotedTriple.
   */
  private instantiateQuotedSubject(
    element: TripleElement,
    solution: SolutionMapping
  ): QuotedSubject {
    if (element.type === "variable") {
      const bound = solution.get(element.value);
      if (!bound) {
        throw new Error(`Unbound variable in quoted triple subject: ${element.value}`);
      }
      // Validate that the bound value is valid for subject position
      if (bound instanceof Literal) {
        throw new Error("Literals cannot appear in quoted triple subject position");
      }
      return bound as QuotedSubject;
    }

    if (element.type === "iri") {
      return new IRI(element.value);
    }

    if (element.type === "blank") {
      return new BlankNode(element.value);
    }

    if (element.type === "quoted") {
      return this.instantiateQuotedTriple(element, solution);
    }

    throw new Error(`Invalid element type for quoted triple subject: ${element.type}`);
  }

  /**
   * Instantiate a quoted triple predicate from an algebra element.
   * Predicates in quoted triples must be IRIs.
   */
  private instantiateQuotedPredicate(
    element: { type: "iri"; value: string } | { type: "variable"; value: string },
    solution: SolutionMapping
  ): QuotedPredicate {
    if (element.type === "variable") {
      const bound = solution.get(element.value);
      if (!bound) {
        throw new Error(`Unbound variable in quoted triple predicate: ${element.value}`);
      }
      if (!(bound instanceof IRI)) {
        throw new Error("Quoted triple predicate must be an IRI");
      }
      return bound;
    }

    return new IRI(element.value);
  }

  /**
   * Instantiate a quoted triple object from an algebra element.
   * Objects in quoted triples can be IRI, BlankNode, Literal, or another QuotedTriple.
   */
  private instantiateQuotedObject(
    element: TripleElement,
    solution: SolutionMapping
  ): QuotedObject {
    if (element.type === "variable") {
      const bound = solution.get(element.value);
      if (!bound) {
        throw new Error(`Unbound variable in quoted triple object: ${element.value}`);
      }
      return bound as QuotedObject;
    }

    if (element.type === "iri") {
      return new IRI(element.value);
    }

    if (element.type === "blank") {
      return new BlankNode(element.value);
    }

    if (element.type === "literal") {
      return new Literal(
        element.value,
        element.datatype ? new IRI(element.datatype) : undefined,
        element.language
      );
    }

    if (element.type === "quoted") {
      return this.instantiateQuotedTriple(element, solution);
    }

    // TypeScript exhaustiveness check - this should never be reached
    const _exhaustiveCheck: never = element;
    throw new Error(`Invalid element type for quoted triple object: ${(_exhaustiveCheck as TripleElement).type}`);
  }
}
