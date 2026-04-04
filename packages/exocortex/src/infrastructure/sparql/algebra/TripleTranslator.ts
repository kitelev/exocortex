 
import { AlgebraTranslatorError } from "./AlgebraTranslatorError";
import type {
  BGPOperation,
  Triple,
  TripleElement,
  PropertyPath,
  IRI,
  Literal,
  Variable,
  QuotedTriple,
} from "./AlgebraOperation";
import type {
  SparqljsPattern,
  SparqljsTriple,
  SparqljsTerm,
  SparqljsPropertyPath,
} from "../SparqljsTypes";

/** Direction mappings from directional language tags */
export type DirectionMappings = Map<string, "ltr" | "rtl">;

/**
 * Translates SPARQL triple-related constructs (BGP, triples, predicates,
 * property paths, quoted triples) from the sparqljs AST into the internal
 * algebra representation.
 */
export class TripleTranslator {
  private directionMappings: DirectionMappings = new Map();

  setDirectionMappings(mappings: DirectionMappings): void {
    this.directionMappings = mappings;
  }

  translateBGP(pattern: SparqljsPattern): BGPOperation {
    if (!("triples" in pattern) || !Array.isArray(pattern.triples)) {
      throw new AlgebraTranslatorError("BGP pattern must have triples array");
    }

    return {
      type: "bgp",
      triples: pattern.triples.map((t: SparqljsTriple) => this.translateTriple(t)),
    };
  }

  translateTriple(triple: SparqljsTriple): Triple {
    if (!triple.subject || !triple.predicate || !triple.object) {
      throw new AlgebraTranslatorError("Triple must have subject, predicate, and object");
    }

    return {
      subject: this.translateTripleElement(triple.subject),
      predicate: this.translatePredicate(triple.predicate),
      object: this.translateTripleElement(triple.object),
    };
  }

  /** Translate CONSTRUCT template triples from sparqljs AST format. */
  translateConstructTemplate(template: SparqljsTriple[]): Triple[] {
    if (!template || !Array.isArray(template)) {
      return [];
    }

    return template.map((t: SparqljsTriple) => this.translateTriple(t));
  }

  /** Translate a predicate (simple IRI/Variable or property path). */
  translatePredicate(predicate: SparqljsTerm | SparqljsPropertyPath): TripleElement | PropertyPath {
    if ("type" in predicate && predicate.type === "path") {
      return this.translatePropertyPath(predicate as SparqljsPropertyPath);
    }
    return this.translateTripleElement(predicate as SparqljsTerm);
  }

  /** Translate a property path expression from sparqljs AST. */
  translatePropertyPath(path: SparqljsPropertyPath): PropertyPath {
    if (!("pathType" in path) || !path.pathType) {
      throw new AlgebraTranslatorError("Property path must have pathType");
    }

    if (!("items" in path) || !Array.isArray(path.items)) {
      throw new AlgebraTranslatorError("Property path must have items array");
    }

    const translatedItems = (path.items as Array<import("sparqljs").IriTerm | SparqljsPropertyPath>).map(
      (item) => this.translatePathItem(item)
    );

    switch (path.pathType) {
      case "/":
        return { type: "path", pathType: "/", items: translatedItems };
      case "|":
        return { type: "path", pathType: "|", items: translatedItems };
      case "^":
        if (translatedItems.length !== 1) {
          throw new AlgebraTranslatorError("Inverse path must have exactly one item");
        }
        return { type: "path", pathType: "^", items: [translatedItems[0]] };
      case "+":
        if (translatedItems.length !== 1) {
          throw new AlgebraTranslatorError("OneOrMore path must have exactly one item");
        }
        return { type: "path", pathType: "+", items: [translatedItems[0]] };
      case "*":
        if (translatedItems.length !== 1) {
          throw new AlgebraTranslatorError("ZeroOrMore path must have exactly one item");
        }
        return { type: "path", pathType: "*", items: [translatedItems[0]] };
      case "?":
        if (translatedItems.length !== 1) {
          throw new AlgebraTranslatorError("ZeroOrOne path must have exactly one item");
        }
        return { type: "path", pathType: "?", items: [translatedItems[0]] };
      default:
        throw new AlgebraTranslatorError(`Unsupported property path type: ${path.pathType}`);
    }
  }

  /** Translate a single item in a property path (IRI or nested path). */
  translatePathItem(item: import("sparqljs").IriTerm | SparqljsPropertyPath): IRI | PropertyPath {
    if ("type" in item && item.type === "path") {
      return this.translatePropertyPath(item as SparqljsPropertyPath);
    }
    if ("termType" in item && item.termType === "NamedNode") {
      return { type: "iri", value: item.value };
    }
    const itemDesc = "type" in item ? (item as unknown as Record<string, unknown>).type : ("termType" in item ? (item as unknown as Record<string, unknown>).termType : "unknown");
    throw new AlgebraTranslatorError(`Unsupported path item type: ${String(itemDesc)}`);
  }

  translateTripleElement(element: SparqljsTerm): TripleElement {
    if (!element || !("termType" in element)) {
      throw new AlgebraTranslatorError("Triple element must have termType");
    }

    switch (element.termType) {
      case "Variable":
        return { type: "variable", value: element.value };
      case "NamedNode":
        return { type: "iri", value: element.value };
      case "Literal": {
        const literal: Literal = {
          type: "literal",
          value: element.value,
          datatype: element.datatype?.value,
          language: element.language,
        };
        if (element.language) {
          const direction = this.directionMappings.get(element.language.toLowerCase());
          if (direction) {
            literal.direction = direction;
          }
        }
        return literal;
      }
      case "BlankNode":
        return { type: "blank", value: element.value };
      case "Quad":
        return this.translateQuotedTriple(element as import("sparqljs").QuadTerm);
      default:
        throw new AlgebraTranslatorError(`Unsupported term type: ${(element as { termType: string }).termType}`);
    }
  }

  /** Translate a quoted triple (RDF-Star) from sparqljs Quad format. */
  private translateQuotedTriple(element: import("sparqljs").QuadTerm): QuotedTriple {
    if (!element.subject || !element.predicate || !element.object) {
      throw new AlgebraTranslatorError("Quoted triple must have subject, predicate, and object");
    }

    return {
      type: "quoted",
      subject: this.translateTripleElement(element.subject),
      predicate: this.translateQuotedTriplePredicate(element.predicate),
      object: this.translateTripleElement(element.object),
    };
  }

  /** Translate predicate in a quoted triple (only IRI or Variable allowed). */
  private translateQuotedTriplePredicate(predicate: SparqljsTerm): IRI | Variable {
    if (!predicate || !("termType" in predicate)) {
      throw new AlgebraTranslatorError("Quoted triple predicate must have termType");
    }

    switch (predicate.termType) {
      case "Variable":
        return { type: "variable", value: predicate.value };
      case "NamedNode":
        return { type: "iri", value: predicate.value };
      default:
        throw new AlgebraTranslatorError(
          `Quoted triple predicate must be IRI or Variable, got: ${(predicate as { termType: string }).termType}`
        );
    }
  }
}
