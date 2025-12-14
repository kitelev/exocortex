import type { SolutionMapping } from "../SolutionMapping";
import { Triple } from "../../../domain/models/rdf/Triple";
import { IRI } from "../../../domain/models/rdf/IRI";
import { Literal } from "../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import type { Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";
import type { Triple as AlgebraTriple, TripleElement, PropertyPath } from "../algebra/AlgebraOperation";

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

    throw new Error(`Unknown element type: ${(element as any).type}`);
  }
}
