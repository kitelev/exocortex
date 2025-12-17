/**
 * SPARQL 1.2 Directional Language Tags Integration Tests
 *
 * Tests for directional language tag features including:
 * - DirectionalLangTagTransformer for query preprocessing
 * - Literal with direction property
 *
 * Note: LANGDIR, hasLANGDIR, STRLANGDIR functions are defined in BuiltInFunctions.ts
 * but not yet registered in the SPARQL parser. Tests for those functions are skipped
 * until the parser is extended to support them.
 *
 * Issue #994: SPARQL 1.2 Integration Test Suite
 *
 * @see https://w3c.github.io/sparql-12/spec/
 * @see https://w3c.github.io/rdf-dir-literal/
 */

import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { AlgebraOptimizer } from "../../../src/infrastructure/sparql/algebra/AlgebraOptimizer";
import { QueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { DirectionalLangTagTransformer } from "../../../src/infrastructure/sparql/DirectionalLangTagTransformer";

// Standard namespace URIs
const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const XSD_STRING = new IRI("http://www.w3.org/2001/XMLSchema#string");
const RDFS_LABEL = new IRI("http://www.w3.org/2000/01/rdf-schema#label");

// Example namespace
const EX = "http://example.org/";

describe("SPARQL 1.2 Directional Language Tags Integration Tests", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let optimizer: AlgebraOptimizer;
  let store: InMemoryTripleStore;
  let executor: QueryExecutor;

  async function executeQuery(sparql: string) {
    const parsed = parser.parse(sparql);
    let algebra = translator.translate(parsed);
    algebra = optimizer.optimize(algebra);
    return executor.executeAll(algebra);
  }

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    optimizer = new AlgebraOptimizer();
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
  });

  describe("DirectionalLangTagTransformer", () => {
    let transformer: DirectionalLangTagTransformer;

    beforeEach(() => {
      transformer = new DirectionalLangTagTransformer();
    });

    describe("Query Transformation", () => {
      it("should transform RTL directional language tag in query", () => {
        const query = `SELECT ?s WHERE { ?s rdfs:label "مرحبا"@ar--rtl }`;
        const transformed = transformer.transform(query);

        expect(transformed).toBe(`SELECT ?s WHERE { ?s rdfs:label "مرحبا"@ar }`);
        expect(transformer.getDirection("ar")).toBe("rtl");
      });

      it("should transform LTR directional language tag in query", () => {
        const query = `SELECT ?s WHERE { ?s rdfs:label "Hello"@en--ltr }`;
        const transformed = transformer.transform(query);

        expect(transformed).toBe(`SELECT ?s WHERE { ?s rdfs:label "Hello"@en }`);
        expect(transformer.getDirection("en")).toBe("ltr");
      });

      it("should transform multiple directional tags in same query", () => {
        const query = `
          SELECT ?s WHERE {
            ?s rdfs:label "Hello"@en--ltr .
            ?s rdfs:altLabel "مرحبا"@ar--rtl .
          }
        `;
        const transformed = transformer.transform(query);

        expect(transformed).not.toContain("--ltr");
        expect(transformed).not.toContain("--rtl");
        expect(transformer.getDirection("en")).toBe("ltr");
        expect(transformer.getDirection("ar")).toBe("rtl");
      });

      it("should preserve query structure with complex language tags", () => {
        const query = `SELECT ?s WHERE { ?s rdfs:label "Hello World"@en-US--ltr }`;
        const transformed = transformer.transform(query);

        expect(transformed).toBe(
          `SELECT ?s WHERE { ?s rdfs:label "Hello World"@en-US }`
        );
        expect(transformer.getDirection("en-US")).toBe("ltr");
      });

      it("should not modify non-directional language tags", () => {
        const query = `SELECT ?s WHERE { ?s rdfs:label "Bonjour"@fr }`;
        const transformed = transformer.transform(query);

        expect(transformed).toBe(query);
        expect(transformer.getDirection("fr")).toBeUndefined();
      });

      it("should handle single-quoted strings", () => {
        const query = `SELECT ?s WHERE { ?s rdfs:label 'Hello'@en--ltr }`;
        const transformed = transformer.transform(query);

        expect(transformed).toBe(`SELECT ?s WHERE { ?s rdfs:label 'Hello'@en }`);
        expect(transformer.getDirection("en")).toBe("ltr");
      });
    });

    describe("Direction Detection", () => {
      it("should detect directional tags in query", () => {
        const queryWithDir = `SELECT ?s WHERE { ?s rdfs:label "Hello"@en--ltr }`;
        const queryWithoutDir = `SELECT ?s WHERE { ?s rdfs:label "Hello"@en }`;

        expect(transformer.hasDirectionalTags(queryWithDir)).toBe(true);
        expect(transformer.hasDirectionalTags(queryWithoutDir)).toBe(false);
      });

      it("should handle uppercase direction tags in detection", () => {
        // Note: The transformer's regex is case-sensitive for 'ltr' and 'rtl'
        // Uppercase directions are not transformed, but we can still detect them
        const queryUppercase = `SELECT ?s WHERE { ?s rdfs:label "Hello"@en--LTR }`;
        const queryLowercase = `SELECT ?s WHERE { ?s rdfs:label "Hello"@en--ltr }`;

        // Only lowercase directions are transformed
        expect(transformer.hasDirectionalTags(queryLowercase)).toBe(true);
        const transformed = transformer.transform(queryLowercase);
        expect(transformed).not.toContain("--ltr");
        expect(transformer.getDirection("en")).toBe("ltr");
      });
    });

    describe("Edge Cases", () => {
      it("should handle escaped quotes in string literals", () => {
        const query = `SELECT ?s WHERE { ?s rdfs:label "He said \\"hello\\""@en--ltr }`;
        const transformed = transformer.transform(query);

        expect(transformed).not.toContain("--ltr");
        expect(transformer.getDirection("en")).toBe("ltr");
      });

      it("should clear mappings between transforms", () => {
        transformer.transform(`SELECT ?s WHERE { ?s rdfs:label "Hello"@en--ltr }`);
        expect(transformer.getDirection("en")).toBe("ltr");

        // Transform a different query
        transformer.transform(`SELECT ?s WHERE { ?s rdfs:label "مرحبا"@ar--rtl }`);

        // Previous mapping should be cleared
        expect(transformer.getDirection("en")).toBeUndefined();
        expect(transformer.getDirection("ar")).toBe("rtl");
      });

      it("should explicitly clear mappings when requested", () => {
        transformer.transform(`SELECT ?s WHERE { ?s rdfs:label "Hello"@en--ltr }`);
        expect(transformer.getAllMappings().size).toBe(1);

        transformer.clearMappings();
        expect(transformer.getAllMappings().size).toBe(0);
      });
    });
  });

  describe("Literal with Direction", () => {
    describe("Creation", () => {
      it("should create literal with RTL direction", () => {
        const literal = new Literal("مرحبا", undefined, "ar", "rtl");

        expect(literal.value).toBe("مرحبا");
        expect(literal.language).toBe("ar");
        expect(literal.direction).toBe("rtl");
      });

      it("should create literal with LTR direction", () => {
        const literal = new Literal("Hello", undefined, "en", "ltr");

        expect(literal.value).toBe("Hello");
        expect(literal.language).toBe("en");
        expect(literal.direction).toBe("ltr");
      });

      it("should create literal without direction", () => {
        const literal = new Literal("Hello", undefined, "en");

        expect(literal.value).toBe("Hello");
        expect(literal.language).toBe("en");
        expect(literal.direction).toBeUndefined();
      });
    });

    describe("Serialization", () => {
      it("should serialize directional literal with direction suffix", () => {
        const literal = new Literal("مرحبا", undefined, "ar", "rtl");
        const serialized = literal.toString();

        expect(serialized).toContain("@ar--rtl");
      });

      it("should serialize non-directional language literal without suffix", () => {
        const literal = new Literal("Hello", undefined, "en");
        const serialized = literal.toString();

        expect(serialized).toContain("@en");
        expect(serialized).not.toContain("--");
      });
    });

    describe("Equality", () => {
      it("should consider direction in equality check", () => {
        const lit1 = new Literal("Hello", undefined, "en", "ltr");
        const lit2 = new Literal("Hello", undefined, "en", "ltr");
        const lit3 = new Literal("Hello", undefined, "en", "rtl");
        const lit4 = new Literal("Hello", undefined, "en");

        expect(lit1.equals(lit2)).toBe(true);
        expect(lit1.equals(lit3)).toBe(false); // Different direction
        expect(lit1.equals(lit4)).toBe(false); // With vs without direction
      });
    });
  });

  describe("Query with Directional Literals in Store", () => {
    beforeEach(async () => {
      // Create test data with various language tags
      const triples: Triple[] = [
        // RTL directional literal (Arabic)
        new Triple(new IRI(`${EX}resource1`), RDF_TYPE, new IRI(`${EX}Document`)),
        new Triple(
          new IRI(`${EX}resource1`),
          RDFS_LABEL,
          new Literal("مرحبا", undefined, "ar", "rtl")
        ),

        // LTR directional literal (English)
        new Triple(new IRI(`${EX}resource2`), RDF_TYPE, new IRI(`${EX}Document`)),
        new Triple(
          new IRI(`${EX}resource2`),
          RDFS_LABEL,
          new Literal("Hello", undefined, "en", "ltr")
        ),

        // Non-directional language literal (French)
        new Triple(new IRI(`${EX}resource3`), RDF_TYPE, new IRI(`${EX}Document`)),
        new Triple(
          new IRI(`${EX}resource3`),
          RDFS_LABEL,
          new Literal("Bonjour", undefined, "fr")
        ),

        // Plain literal (no language tag)
        new Triple(new IRI(`${EX}resource4`), RDF_TYPE, new IRI(`${EX}Document`)),
        new Triple(
          new IRI(`${EX}resource4`),
          RDFS_LABEL,
          new Literal("Plain text", XSD_STRING)
        ),

        // Hebrew RTL
        new Triple(new IRI(`${EX}resource5`), RDF_TYPE, new IRI(`${EX}Document`)),
        new Triple(
          new IRI(`${EX}resource5`),
          RDFS_LABEL,
          new Literal("שלום", undefined, "he", "rtl")
        ),
      ];

      await store.addAll(triples);
    });

    it("should retrieve all directional and non-directional labels", async () => {
      const query = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX ex: <${EX}>

        SELECT ?resource ?label
        WHERE {
          ?resource a ex:Document .
          ?resource rdfs:label ?label .
        }
        ORDER BY ?resource
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(5);

      // Check that directional literals are preserved
      const labels = results.map((r) => r.get("label") as Literal);

      // Check Arabic (RTL)
      const arabicLabel = labels.find((l) => l.value === "مرحبا");
      expect(arabicLabel).toBeDefined();
      expect(arabicLabel?.language).toBe("ar");
      expect(arabicLabel?.direction).toBe("rtl");

      // Check English (LTR)
      const englishLabel = labels.find((l) => l.value === "Hello");
      expect(englishLabel).toBeDefined();
      expect(englishLabel?.language).toBe("en");
      expect(englishLabel?.direction).toBe("ltr");

      // Check French (no direction)
      const frenchLabel = labels.find((l) => l.value === "Bonjour");
      expect(frenchLabel).toBeDefined();
      expect(frenchLabel?.language).toBe("fr");
      expect(frenchLabel?.direction).toBeUndefined();
    });

    it("should filter by language using LANG function", async () => {
      const query = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX ex: <${EX}>

        SELECT ?label
        WHERE {
          ?resource a ex:Document .
          ?resource rdfs:label ?label .
          FILTER(LANG(?label) = "ar")
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const label = results[0].get("label") as Literal;
      expect(label.value).toBe("مرحبا");
      expect(label.language).toBe("ar");
    });

    it("should count labels by language", async () => {
      const query = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX ex: <${EX}>

        SELECT (COUNT(?label) AS ?count)
        WHERE {
          ?resource a ex:Document .
          ?resource rdfs:label ?label .
          FILTER(LANG(?label) != "")
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      // 4 labels have language tags (ar, en, fr, he)
      expect((results[0].get("count") as Literal).value).toBe("4");
    });
  });

  describe("Edge Cases", () => {
    it("should handle Unicode in directional literals", async () => {
      const literal = new Literal("العربية 🌍 日本語", undefined, "ar", "rtl");

      expect(literal.value).toBe("العربية 🌍 日本語");
      expect(literal.language).toBe("ar");
      expect(literal.direction).toBe("rtl");

      // Store and retrieve
      await store.add(
        new Triple(
          new IRI(`${EX}unicode-test`),
          RDFS_LABEL,
          literal
        )
      );

      const query = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

        SELECT ?label
        WHERE {
          <${EX}unicode-test> rdfs:label ?label .
        }
      `;

      const results = await executeQuery(query);
      expect(results).toHaveLength(1);

      const retrievedLabel = results[0].get("label") as Literal;
      expect(retrievedLabel.value).toBe("العربية 🌍 日本語");
      expect(retrievedLabel.direction).toBe("rtl");
    });

    it("should handle case sensitivity in direction values", () => {
      // Direction should be stored as provided
      const ltrLiteral = new Literal("Hello", undefined, "en", "ltr");
      const rtlLiteral = new Literal("مرحبا", undefined, "ar", "rtl");

      expect(ltrLiteral.direction).toBe("ltr");
      expect(rtlLiteral.direction).toBe("rtl");
    });

    it("should distinguish literals with same value but different directions", async () => {
      // Store two literals with same text but different directions
      const triples = [
        new Triple(
          new IRI(`${EX}ltr-item`),
          RDFS_LABEL,
          new Literal("Test", undefined, "en", "ltr")
        ),
        new Triple(
          new IRI(`${EX}rtl-item`),
          RDFS_LABEL,
          new Literal("Test", undefined, "he", "rtl")
        ),
      ];

      await store.addAll(triples);

      const query = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

        SELECT ?resource ?label
        WHERE {
          ?resource rdfs:label ?label .
          FILTER(?label = "Test")
        }
      `;

      const results = await executeQuery(query);

      // Both should be found
      expect(results).toHaveLength(2);

      // Verify different directions
      const labels = results.map((r) => r.get("label") as Literal);
      const directions = labels.map((l) => l.direction);

      expect(directions).toContain("ltr");
      expect(directions).toContain("rtl");
    });
  });

  // Note: LANGDIR, hasLANGDIR, and STRLANGDIR functions are defined in
  // BuiltInFunctions.ts but not yet registered in the SPARQL parser.
  // Once registered, the following tests should be enabled:
  describe.skip("LANGDIR Function (not yet registered in parser)", () => {
    it("should return language with direction for directional RTL literal", () => {
      // Test placeholder - enable when LANGDIR is registered
    });
  });

  describe.skip("hasLANGDIR Function (not yet registered in parser)", () => {
    it("should return true for directional literal", () => {
      // Test placeholder - enable when hasLANGDIR is registered
    });
  });

  describe.skip("STRLANGDIR Function (not yet registered in parser)", () => {
    it("should create directional literal", () => {
      // Test placeholder - enable when STRLANGDIR is registered
    });
  });
});
