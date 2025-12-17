import { DirectionalLangTagTransformer } from "../../../../src/infrastructure/sparql/DirectionalLangTagTransformer";

describe("DirectionalLangTagTransformer", () => {
  let transformer: DirectionalLangTagTransformer;

  beforeEach(() => {
    transformer = new DirectionalLangTagTransformer();
  });

  describe("transform", () => {
    it("should transform @ar--rtl to @ar and store direction", () => {
      const query = `SELECT * WHERE { ?s ?p "مرحبا"@ar--rtl }`;
      const result = transformer.transform(query);

      expect(result).toBe(`SELECT * WHERE { ?s ?p "مرحبا"@ar }`);
      expect(transformer.getDirection("ar")).toBe("rtl");
    });

    it("should transform @en--ltr to @en and store direction", () => {
      const query = `SELECT * WHERE { ?s ?p "Hello"@en--ltr }`;
      const result = transformer.transform(query);

      expect(result).toBe(`SELECT * WHERE { ?s ?p "Hello"@en }`);
      expect(transformer.getDirection("en")).toBe("ltr");
    });

    it("should transform @he--rtl to @he and store direction", () => {
      const query = `SELECT * WHERE { ?s ?p "שלום"@he--rtl }`;
      const result = transformer.transform(query);

      expect(result).toBe(`SELECT * WHERE { ?s ?p "שלום"@he }`);
      expect(transformer.getDirection("he")).toBe("rtl");
    });

    it("should handle complex language tags with region codes", () => {
      const query = `SELECT * WHERE { ?s ?p "Hello"@en-US--ltr }`;
      const result = transformer.transform(query);

      expect(result).toBe(`SELECT * WHERE { ?s ?p "Hello"@en-US }`);
      expect(transformer.getDirection("en-us")).toBe("ltr");
    });

    it("should handle multiple directional literals in same query", () => {
      const query = `SELECT * WHERE {
        ?s ?p "مرحبا"@ar--rtl .
        ?s ?q "Hello"@en--ltr .
      }`;
      const result = transformer.transform(query);

      expect(result).toContain(`"مرحبا"@ar`);
      expect(result).toContain(`"Hello"@en`);
      expect(result).not.toContain("--rtl");
      expect(result).not.toContain("--ltr");
      expect(transformer.getDirection("ar")).toBe("rtl");
      expect(transformer.getDirection("en")).toBe("ltr");
    });

    it("should not transform regular language tags without direction", () => {
      const query = `SELECT * WHERE { ?s ?p "Bonjour"@fr }`;
      const result = transformer.transform(query);

      expect(result).toBe(query);
      expect(transformer.getDirection("fr")).toBeUndefined();
    });

    it("should handle single-quoted strings", () => {
      const query = `SELECT * WHERE { ?s ?p 'مرحبا'@ar--rtl }`;
      const result = transformer.transform(query);

      expect(result).toBe(`SELECT * WHERE { ?s ?p 'مرحبا'@ar }`);
      expect(transformer.getDirection("ar")).toBe("rtl");
    });

    it("should handle escaped quotes in strings", () => {
      const query = `SELECT * WHERE { ?s ?p "Hello \\"world\\""@en--ltr }`;
      const result = transformer.transform(query);

      expect(result).toBe(`SELECT * WHERE { ?s ?p "Hello \\"world\\""@en }`);
      expect(transformer.getDirection("en")).toBe("ltr");
    });

    it("should normalize language tag to lowercase for storage", () => {
      const query = `SELECT * WHERE { ?s ?p "Hello"@EN-US--ltr }`;
      transformer.transform(query);

      // Direction should be retrievable with lowercase
      expect(transformer.getDirection("en-us")).toBe("ltr");
      expect(transformer.getDirection("EN-US")).toBe("ltr");
    });
  });

  describe("hasDirectionalTags", () => {
    it("should return true for queries with directional tags", () => {
      const query = `SELECT * WHERE { ?s ?p "مرحبا"@ar--rtl }`;
      expect(transformer.hasDirectionalTags(query)).toBe(true);
    });

    it("should return false for queries without directional tags", () => {
      const query = `SELECT * WHERE { ?s ?p "Hello"@en }`;
      expect(transformer.hasDirectionalTags(query)).toBe(false);
    });

    it("should return false for empty query", () => {
      expect(transformer.hasDirectionalTags("")).toBe(false);
    });
  });

  describe("getAllMappings", () => {
    it("should return all stored direction mappings", () => {
      const query = `SELECT * WHERE {
        ?s ?p "مرحبا"@ar--rtl .
        ?s ?q "Hello"@en--ltr .
        ?s ?r "שלום"@he--rtl .
      }`;
      transformer.transform(query);

      const mappings = transformer.getAllMappings();
      expect(mappings.size).toBe(3);
      expect(mappings.get("ar")).toBe("rtl");
      expect(mappings.get("en")).toBe("ltr");
      expect(mappings.get("he")).toBe("rtl");
    });

    it("should return a copy of mappings (not internal reference)", () => {
      const query = `SELECT * WHERE { ?s ?p "Hello"@en--ltr }`;
      transformer.transform(query);

      const mappings1 = transformer.getAllMappings();
      const mappings2 = transformer.getAllMappings();
      expect(mappings1).not.toBe(mappings2);
      expect(mappings1).toEqual(mappings2);
    });
  });

  describe("clearMappings", () => {
    it("should clear all stored direction mappings", () => {
      const query = `SELECT * WHERE { ?s ?p "Hello"@en--ltr }`;
      transformer.transform(query);

      expect(transformer.getDirection("en")).toBe("ltr");

      transformer.clearMappings();

      expect(transformer.getDirection("en")).toBeUndefined();
      expect(transformer.getAllMappings().size).toBe(0);
    });
  });

  describe("multiple transform calls", () => {
    it("should clear previous mappings on new transform call", () => {
      const query1 = `SELECT * WHERE { ?s ?p "مرحبا"@ar--rtl }`;
      transformer.transform(query1);
      expect(transformer.getDirection("ar")).toBe("rtl");

      const query2 = `SELECT * WHERE { ?s ?p "Hello"@en--ltr }`;
      transformer.transform(query2);

      // Previous mapping should be cleared
      expect(transformer.getDirection("ar")).toBeUndefined();
      // New mapping should be present
      expect(transformer.getDirection("en")).toBe("ltr");
    });
  });
});
