/**
 * Acceptance criteria verification for Issue #2593:
 * ExoQL property path parser support — +, *, ?, ^, /, |
 *
 * Verifies that sparqljs correctly parses property paths and
 * AlgebraTranslator produces correct PathExpression nodes for each operator.
 *
 * NOTE: The full property path stack (parser, translator, executor) was
 * implemented in a prior RFC. This test explicitly verifies each acceptance
 * criterion from Issue #2593.
 */

import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import type { PropertyPath } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import type { BGPOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("Issue #2593: ExoQL property path parser acceptance", () => {
  let parser: SPARQLParser;
  let translator: ExoQLAlgebraTranslator;

  beforeEach(() => {
    parser = new SPARQLParser();
    translator = new ExoQLAlgebraTranslator();
  });

  function getFirstBGP(query: string): BGPOperation {
    const ast = parser.parse(query);
    const algebra = translator.translate(ast);

    // Navigate to the BGP (may be nested under project, etc.)
    let current = algebra;
    while (current.type !== "bgp") {
      if ("input" in current) {
        current = (current as { input: typeof current }).input;
      } else if ("patterns" in current) {
        current = (current as { patterns: typeof current[] }).patterns[0] as typeof current;
      } else {
        break;
      }
    }
    return current as BGPOperation;
  }

  function getFirstPredicatePath(query: string): PropertyPath {
    const bgp = getFirstBGP(query);
    const triple = bgp.triples[0];
    return triple.predicate as PropertyPath;
  }

  describe("AC: Parser accepts p+ (one-or-more)", () => {
    it("should parse ?s exo:Asset_prototype+ ?root", () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?root WHERE {
          ?s exo:Asset_prototype+ ?root .
        }
      `;
      const path = getFirstPredicatePath(query);
      expect(path.type).toBe("path");
      expect(path.pathType).toBe("+");
      expect(path.items).toHaveLength(1);
    });
  });

  describe("AC: Parser accepts p* (zero-or-more)", () => {
    it("should parse ?s exo:Asset_prototype* ?root", () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?root WHERE {
          ?s exo:Asset_prototype* ?root .
        }
      `;
      const path = getFirstPredicatePath(query);
      expect(path.type).toBe("path");
      expect(path.pathType).toBe("*");
    });
  });

  describe("AC: Parser accepts p? (zero-or-one)", () => {
    it("should parse ?s ems:Effort_parent? ?parent", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?s ?parent WHERE {
          ?s ems:Effort_parent? ?parent .
        }
      `;
      const path = getFirstPredicatePath(query);
      expect(path.type).toBe("path");
      expect(path.pathType).toBe("?");
    });
  });

  describe("AC: Parser accepts ^p (inverse)", () => {
    it("should parse ?s ^exo:Asset_prototype ?instance", () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?instance WHERE {
          ?s ^exo:Asset_prototype ?instance .
        }
      `;
      const path = getFirstPredicatePath(query);
      expect(path.type).toBe("path");
      expect(path.pathType).toBe("^");
    });
  });

  describe("AC: Parser accepts p/q (sequence)", () => {
    it("should parse ?s ems:Effort_parent/exo:Asset_label ?label", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label WHERE {
          ?s ems:Effort_parent/exo:Asset_label ?label .
        }
      `;
      const path = getFirstPredicatePath(query);
      expect(path.type).toBe("path");
      expect(path.pathType).toBe("/");
      expect(path.items).toHaveLength(2);
    });
  });

  describe("AC: Parser accepts p|q (alternative)", () => {
    it("should parse ?s (ems:Effort_parent|exo:Asset_relates) ?related", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?related WHERE {
          ?s (ems:Effort_parent|exo:Asset_relates) ?related .
        }
      `;
      const path = getFirstPredicatePath(query);
      expect(path.type).toBe("path");
      expect(path.pathType).toBe("|");
      expect(path.items).toHaveLength(2);
    });
  });

  describe("AC: AlgebraTranslator produces correct PathExpression nodes", () => {
    it("should produce nested path for complex expression p+/q*", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?target WHERE {
          ?s ems:Effort_parent+/exo:Asset_relates* ?target .
        }
      `;
      const path = getFirstPredicatePath(query);
      expect(path.type).toBe("path");
      expect(path.pathType).toBe("/");
      expect(path.items).toHaveLength(2);

      // First item: ems:Effort_parent+
      const first = path.items[0] as PropertyPath;
      expect(first.type).toBe("path");
      expect(first.pathType).toBe("+");

      // Second item: exo:Asset_relates*
      const second = path.items[1] as PropertyPath;
      expect(second.type).toBe("path");
      expect(second.pathType).toBe("*");
    });
  });
});
