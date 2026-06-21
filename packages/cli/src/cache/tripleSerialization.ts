import { Triple, IRI, Literal, BlankNode } from "@kitelev/exocortex-core";

/**
 * Serializable RDF node representation used by the JSON triple-cache format.
 */
export interface SerializedNode {
  type: "IRI" | "Literal" | "BlankNode";
  value: string;
  datatype?: string;
  language?: string;
}

/**
 * Serializable triple representation used by the JSON triple-cache format.
 */
export interface SerializedTriple {
  subject: SerializedNode;
  predicate: SerializedNode;
  object: SerializedNode;
}

/**
 * Serializes an RDF node to JSON-compatible format.
 *
 * Used by both CacheManager (single-vault cache) and CombinedCacheManager
 * (cross-vault cache, Issue #3281). Keep these helpers in their own module
 * so test mocks of either cache class do not need to re-export them.
 */
export function serializeNode(
  node: Triple["subject"] | Triple["predicate"] | Triple["object"],
): SerializedNode {
  if (node instanceof IRI) {
    return { type: "IRI", value: node.value };
  }

  if (node instanceof Literal) {
    const result: SerializedNode = { type: "Literal", value: node.value };
    if (node.datatype) {
      result.datatype = node.datatype.value;
    }
    if (node.language) {
      result.language = node.language;
    }
    return result;
  }

  if (node instanceof BlankNode) {
    return { type: "BlankNode", value: node.value };
  }

  // Fallback for QuotedTriple or unknown types
  return { type: "IRI", value: String(node) };
}

/**
 * Deserializes an RDF node from JSON format.
 */
export function deserializeNode(data: SerializedNode): IRI | Literal | BlankNode {
  switch (data.type) {
    case "IRI":
      return new IRI(data.value);
    case "Literal":
      if (data.datatype) {
        return new Literal(data.value, new IRI(data.datatype));
      }
      if (data.language) {
        return new Literal(data.value, undefined, data.language);
      }
      return new Literal(data.value);
    case "BlankNode":
      return new BlankNode(data.value);
    default:
      return new IRI(data.value);
  }
}
