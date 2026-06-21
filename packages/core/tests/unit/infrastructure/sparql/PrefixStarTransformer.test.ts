import {
  PrefixStarTransformer,
  PrefixStarTransformerError,
  WellKnownPrefixResolver,
  VocabularyResolver,
} from "../../../../src/infrastructure/sparql/PrefixStarTransformer";

describe("PrefixStarTransformer", () => {
  let transformer: PrefixStarTransformer;

  beforeEach(() => {
    transformer = new PrefixStarTransformer();
  });

  describe("transform", () => {
    it("should return unchanged query when no PREFIX* is present", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?name WHERE { ?person foaf:name ?name }
      `;

      const result = await transformer.transform(query);

      expect(result).toBe(query);
    });

    it("should transform PREFIX* with well-known schema.org vocabulary", async () => {
      const query = `
        PREFIX* <http://schema.org/>
        SELECT ?s WHERE { ?s schema:name "Test" }
      `;

      const result = await transformer.transform(query);

      expect(result).toContain("PREFIX schema: <http://schema.org/>");
      expect(result).not.toContain("PREFIX*");
      expect(result).toContain("SELECT ?s WHERE { ?s schema:name");
    });

    it("should transform PREFIX* with well-known FOAF vocabulary", async () => {
      const query = `
        PREFIX* <http://xmlns.com/foaf/0.1/>
        SELECT ?name WHERE { ?person foaf:name ?name }
      `;

      const result = await transformer.transform(query);

      expect(result).toContain("PREFIX foaf: <http://xmlns.com/foaf/0.1/>");
      expect(result).not.toContain("PREFIX*");
    });

    it("should transform PREFIX* with well-known RDF vocabulary", async () => {
      const query = `
        PREFIX* <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?s WHERE { ?s rdf:type ?type }
      `;

      const result = await transformer.transform(query);

      expect(result).toContain("PREFIX rdf:");
      expect(result).not.toContain("PREFIX*");
    });

    it("should transform multiple PREFIX* declarations", async () => {
      const query = `
        PREFIX* <http://schema.org/>
        PREFIX* <http://xmlns.com/foaf/0.1/>
        SELECT ?s WHERE { ?s schema:name ?name . ?s foaf:knows ?friend }
      `;

      const result = await transformer.transform(query);

      expect(result).toContain("PREFIX schema: <http://schema.org/>");
      expect(result).toContain("PREFIX foaf: <http://xmlns.com/foaf/0.1/>");
      expect(result).not.toContain("PREFIX*");
    });

    it("should handle PREFIX* with whitespace between PREFIX and *", async () => {
      const query = `
        PREFIX  * <http://schema.org/>
        SELECT ?s WHERE { ?s schema:name "Test" }
      `;

      const result = await transformer.transform(query);

      expect(result).toContain("PREFIX schema: <http://schema.org/>");
      expect(result).not.toContain("PREFIX*");
      expect(result).not.toContain("PREFIX  *");
    });

    it("should preserve existing PREFIX declarations alongside PREFIX*", async () => {
      const query = `
        PREFIX* <http://schema.org/>
        PREFIX ex: <http://example.org/>
        SELECT ?s WHERE { ?s ex:custom ?value }
      `;

      const result = await transformer.transform(query);

      expect(result).toContain("PREFIX schema: <http://schema.org/>");
      expect(result).toContain("PREFIX ex: <http://example.org/>");
    });

    it("should generate fallback prefix for unknown vocabularies", async () => {
      const query = `
        PREFIX* <http://example.org/custom/ontology/>
        SELECT ?s WHERE { ?s ?p ?o }
      `;

      const result = await transformer.transform(query);

      // Should generate a prefix from the URI
      expect(result).toContain("PREFIX ");
      expect(result).toContain("<http://example.org/custom/ontology/>");
      expect(result).not.toContain("PREFIX*");
    });

    it("should handle PREFIX* case-insensitively", async () => {
      const query = `
        prefix* <http://schema.org/>
        SELECT ?s WHERE { ?s schema:name "Test" }
      `;

      const result = await transformer.transform(query);

      expect(result).toContain("PREFIX schema: <http://schema.org/>");
    });
  });

  describe("error handling", () => {
    it("should throw error for unclosed IRI in PREFIX*", async () => {
      const query = `
        PREFIX* <http://schema.org/
        SELECT ?s WHERE { ?s ?p ?o }
      `;

      await expect(transformer.transform(query)).rejects.toThrow(
        PrefixStarTransformerError
      );
    });

    it("should throw error when PREFIX* is not followed by IRI", async () => {
      const query = `
        PREFIX* schema
        SELECT ?s WHERE { ?s ?p ?o }
      `;

      await expect(transformer.transform(query)).rejects.toThrow(
        PrefixStarTransformerError
      );
    });
  });

  describe("edge cases", () => {
    it("should not transform PREFIX* inside string literals", async () => {
      const query = `
        SELECT ?s WHERE { ?s <http://example.org/note> "Use PREFIX* for imports" }
      `;

      const result = await transformer.transform(query);

      expect(result).toBe(query);
    });

    it("should handle empty query", async () => {
      const result = await transformer.transform("");
      expect(result).toBe("");
    });

    it("should handle query with only whitespace", async () => {
      const result = await transformer.transform("   \n\t  ");
      expect(result).toBe("   \n\t  ");
    });
  });
});

describe("WellKnownPrefixResolver", () => {
  let resolver: WellKnownPrefixResolver;

  beforeEach(() => {
    resolver = new WellKnownPrefixResolver();
  });

  describe("resolve", () => {
    it("should resolve schema.org to schema prefix", async () => {
      const prefixes = await resolver.resolve("http://schema.org/");

      expect(prefixes.get("schema")).toBe("http://schema.org/");
    });

    it("should resolve FOAF vocabulary", async () => {
      const prefixes = await resolver.resolve("http://xmlns.com/foaf/0.1/");

      expect(prefixes.get("foaf")).toBe("http://xmlns.com/foaf/0.1/");
    });

    it("should resolve Dublin Core vocabulary", async () => {
      const prefixes = await resolver.resolve("http://purl.org/dc/elements/1.1/");

      expect(prefixes.has("dc")).toBe(true);
    });

    it("should resolve RDF vocabulary", async () => {
      const prefixes = await resolver.resolve(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
      );

      expect(prefixes.has("rdf")).toBe(true);
    });

    it("should resolve OWL vocabulary", async () => {
      const prefixes = await resolver.resolve("http://www.w3.org/2002/07/owl#");

      expect(prefixes.get("owl")).toBe("http://www.w3.org/2002/07/owl#");
    });

    it("should resolve XSD vocabulary", async () => {
      const prefixes = await resolver.resolve(
        "http://www.w3.org/2001/XMLSchema#"
      );

      expect(prefixes.get("xsd")).toBe("http://www.w3.org/2001/XMLSchema#");
    });

    it("should resolve SKOS vocabulary", async () => {
      const prefixes = await resolver.resolve(
        "http://www.w3.org/2004/02/skos/core#"
      );

      expect(prefixes.get("skos")).toBe("http://www.w3.org/2004/02/skos/core#");
    });

    it("should return empty map for unknown vocabulary", async () => {
      const prefixes = await resolver.resolve("http://unknown.example.org/vocab#");

      expect(prefixes.size).toBe(0);
    });

    it("should handle URI without trailing slash/hash", async () => {
      const prefixes = await resolver.resolve("http://schema.org");

      expect(prefixes.get("schema")).toBe("http://schema.org/");
    });
  });

  describe("addVocabulary", () => {
    it("should allow adding custom vocabulary", async () => {
      const customPrefixes = new Map<string, string>();
      customPrefixes.set("custom", "http://example.org/custom#");

      resolver.addVocabulary("http://example.org/custom#", customPrefixes);

      const resolved = await resolver.resolve("http://example.org/custom#");
      expect(resolved.get("custom")).toBe("http://example.org/custom#");
    });
  });
});

describe("Custom VocabularyResolver", () => {
  it("should use custom resolver when provided", async () => {
    const mockResolver: VocabularyResolver = {
      resolve: jest.fn().mockResolvedValue(
        new Map([["custom", "http://custom.example.org/"]])
      ),
    };

    const transformer = new PrefixStarTransformer(mockResolver);

    const query = `
      PREFIX* <http://custom.example.org/>
      SELECT ?s WHERE { ?s custom:prop ?o }
    `;

    const result = await transformer.transform(query);

    expect(mockResolver.resolve).toHaveBeenCalledWith("http://custom.example.org/");
    expect(result).toContain("PREFIX custom: <http://custom.example.org/>");
  });

  it("should handle resolver errors gracefully", async () => {
    const failingResolver: VocabularyResolver = {
      resolve: jest.fn().mockRejectedValue(new Error("Network error")),
    };

    const transformer = new PrefixStarTransformer(failingResolver);

    const query = `
      PREFIX* <http://failing.example.org/>
      SELECT ?s WHERE { ?s ?p ?o }
    `;

    // Should throw because no prefixes could be resolved
    await expect(transformer.transform(query)).rejects.toThrow(
      PrefixStarTransformerError
    );
  });
});
