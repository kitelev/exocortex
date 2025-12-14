import type { Triple } from "exocortex";

/**
 * Formatter for RDF triples output.
 * Supports N-Triples and Turtle-like formats.
 */
export class TriplesFormatter {
  /**
   * Format triples as N-Triples (one triple per line).
   */
  formatNTriples(triples: Triple[]): string {
    return triples.map((t) => t.toString()).join("\n");
  }

  /**
   * Format triples as a simple table (for text display).
   */
  formatTable(triples: Triple[]): string {
    if (triples.length === 0) {
      return "No triples generated.";
    }

    const lines: string[] = [];
    lines.push("Subject | Predicate | Object");
    lines.push("------- | --------- | ------");

    for (const triple of triples) {
      const subject = this.formatNode(triple.subject);
      const predicate = this.formatNode(triple.predicate);
      const object = this.formatNode(triple.object);
      lines.push(`${subject} | ${predicate} | ${object}`);
    }

    return lines.join("\n");
  }

  /**
   * Format triples as JSON array.
   */
  formatJson(triples: Triple[]): string {
    const jsonTriples = triples.map((t) => ({
      subject: this.nodeToJson(t.subject),
      predicate: this.nodeToJson(t.predicate),
      object: this.nodeToJson(t.object),
    }));
    return JSON.stringify(jsonTriples, null, 2);
  }

  private formatNode(node: any): string {
    if (node.value !== undefined) {
      // IRI or Literal
      return String(node.value);
    }
    return String(node);
  }

  private nodeToJson(node: any): { type: string; value: string; datatype?: string; language?: string } {
    // Check for Literal (has value property and might have datatype/language)
    if ("datatype" in node || "language" in node) {
      return {
        type: "literal",
        value: String(node.value),
        ...(node.datatype && { datatype: node.datatype.value || String(node.datatype) }),
        ...(node.language && { language: node.language }),
      };
    }

    // Check for BlankNode (has id property starting with _:)
    if ("id" in node && String(node.id).startsWith("_:")) {
      return {
        type: "bnode",
        value: String(node.id),
      };
    }

    // Default to IRI
    return {
      type: "uri",
      value: String(node.value),
    };
  }
}
