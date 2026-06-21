import { Exo003UUIDGenerator } from "../../../../../src/domain/models/exo003/UUIDGenerator";

describe("Exo003UUIDGenerator", () => {
  describe("generateNamespaceUUID", () => {
    it("should generate deterministic UUID for the same namespace URI", () => {
      const uri = "https://exocortex.my/ontology/exo#";
      const uuid1 = Exo003UUIDGenerator.generateNamespaceUUID(uri);
      const uuid2 = Exo003UUIDGenerator.generateNamespaceUUID(uri);

      expect(uuid1).toBe(uuid2);
      expect(Exo003UUIDGenerator.isValidUUID(uuid1)).toBe(true);
    });

    it("should generate different UUIDs for different namespace URIs", () => {
      const uri1 = "https://exocortex.my/ontology/exo#";
      const uri2 = "https://exocortex.my/ontology/ems#";

      const uuid1 = Exo003UUIDGenerator.generateNamespaceUUID(uri1);
      const uuid2 = Exo003UUIDGenerator.generateNamespaceUUID(uri2);

      expect(uuid1).not.toBe(uuid2);
    });

    it("should throw error for empty namespace URI", () => {
      expect(() => Exo003UUIDGenerator.generateNamespaceUUID("")).toThrow(
        "Namespace URI cannot be empty"
      );
    });

    it("should throw error for whitespace-only namespace URI", () => {
      expect(() => Exo003UUIDGenerator.generateNamespaceUUID("   ")).toThrow(
        "Namespace URI cannot be empty"
      );
    });
  });

  describe("generateAssetUUID", () => {
    it("should generate deterministic UUID using two-level scheme", () => {
      const namespaceUri = "https://exocortex.my/ontology/exo#";
      const localName = "Person";

      const uuid1 = Exo003UUIDGenerator.generateAssetUUID(namespaceUri, localName);
      const uuid2 = Exo003UUIDGenerator.generateAssetUUID(namespaceUri, localName);

      expect(uuid1).toBe(uuid2);
      expect(Exo003UUIDGenerator.isValidUUID(uuid1)).toBe(true);
    });

    it("should generate different UUIDs for same local name in different namespaces", () => {
      const localName = "Task";

      const uuid1 = Exo003UUIDGenerator.generateAssetUUID(
        "https://exocortex.my/ontology/exo#",
        localName
      );
      const uuid2 = Exo003UUIDGenerator.generateAssetUUID(
        "https://exocortex.my/ontology/ems#",
        localName
      );

      expect(uuid1).not.toBe(uuid2);
    });

    it("should generate different UUIDs for different local names in same namespace", () => {
      const namespaceUri = "https://exocortex.my/ontology/exo#";

      const uuid1 = Exo003UUIDGenerator.generateAssetUUID(namespaceUri, "Person");
      const uuid2 = Exo003UUIDGenerator.generateAssetUUID(namespaceUri, "Organization");

      expect(uuid1).not.toBe(uuid2);
    });

    it("should throw error for empty local identifier", () => {
      expect(() =>
        Exo003UUIDGenerator.generateAssetUUID(
          "https://exocortex.my/ontology/exo#",
          ""
        )
      ).toThrow("Local identifier cannot be empty");
    });
  });

  describe("generateFromIRI", () => {
    it("should generate UUID from hash-style IRI", () => {
      const iri = "https://exocortex.my/ontology/exo#Person";
      const uuid = Exo003UUIDGenerator.generateFromIRI(iri);

      // Should be same as generateAssetUUID with split components
      const expected = Exo003UUIDGenerator.generateAssetUUID(
        "https://exocortex.my/ontology/exo#",
        "Person"
      );

      expect(uuid).toBe(expected);
    });

    it("should generate UUID from slash-style IRI", () => {
      const iri = "http://example.org/vocab/Person";
      const uuid = Exo003UUIDGenerator.generateFromIRI(iri);

      // Should be same as generateAssetUUID with split components
      const expected = Exo003UUIDGenerator.generateAssetUUID(
        "http://example.org/vocab/",
        "Person"
      );

      expect(uuid).toBe(expected);
    });

    it("should handle IRI without local name separator", () => {
      const iri = "urn:isbn:0451450523";
      const uuid = Exo003UUIDGenerator.generateFromIRI(iri);

      expect(Exo003UUIDGenerator.isValidUUID(uuid)).toBe(true);
    });

    it("should throw error for empty IRI", () => {
      expect(() => Exo003UUIDGenerator.generateFromIRI("")).toThrow(
        "IRI cannot be empty"
      );
    });
  });

  describe("generateBlankNodeUUID", () => {
    it("should generate deterministic UUID for same blank node ID", () => {
      const uuid1 = Exo003UUIDGenerator.generateBlankNodeUUID("b1");
      const uuid2 = Exo003UUIDGenerator.generateBlankNodeUUID("b1");

      expect(uuid1).toBe(uuid2);
      expect(Exo003UUIDGenerator.isValidUUID(uuid1)).toBe(true);
    });

    it("should generate different UUIDs for different blank node IDs", () => {
      const uuid1 = Exo003UUIDGenerator.generateBlankNodeUUID("b1");
      const uuid2 = Exo003UUIDGenerator.generateBlankNodeUUID("b2");

      expect(uuid1).not.toBe(uuid2);
    });

    it("should include context URI in UUID generation", () => {
      const uuid1 = Exo003UUIDGenerator.generateBlankNodeUUID("b1", "file:///a.md");
      const uuid2 = Exo003UUIDGenerator.generateBlankNodeUUID("b1", "file:///b.md");

      expect(uuid1).not.toBe(uuid2);
    });

    it("should throw error for empty blank node ID", () => {
      expect(() => Exo003UUIDGenerator.generateBlankNodeUUID("")).toThrow(
        "Blank node ID cannot be empty"
      );
    });
  });

  describe("generateStatementUUID", () => {
    it("should generate deterministic UUID for same triple", () => {
      const uuid1 = Exo003UUIDGenerator.generateStatementUUID(
        "https://exocortex.my/ontology/exo#Person",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "http://www.w3.org/2000/01/rdf-schema#Class"
      );
      const uuid2 = Exo003UUIDGenerator.generateStatementUUID(
        "https://exocortex.my/ontology/exo#Person",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "http://www.w3.org/2000/01/rdf-schema#Class"
      );

      expect(uuid1).toBe(uuid2);
      expect(Exo003UUIDGenerator.isValidUUID(uuid1)).toBe(true);
    });

    it("should generate different UUIDs for different triples", () => {
      const uuid1 = Exo003UUIDGenerator.generateStatementUUID(
        "https://exocortex.my/ontology/exo#Person",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "http://www.w3.org/2000/01/rdf-schema#Class"
      );
      const uuid2 = Exo003UUIDGenerator.generateStatementUUID(
        "https://exocortex.my/ontology/exo#Organization",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "http://www.w3.org/2000/01/rdf-schema#Class"
      );

      expect(uuid1).not.toBe(uuid2);
    });

    it("should throw error for empty components", () => {
      expect(() =>
        Exo003UUIDGenerator.generateStatementUUID(
          "",
          "http://predicate",
          "http://object"
        )
      ).toThrow("Subject, predicate, and object cannot be empty");
    });
  });

  describe("generateBodyUUID", () => {
    it("should generate deterministic UUID for same content", () => {
      const uuid1 = Exo003UUIDGenerator.generateBodyUUID("Hello, World!");
      const uuid2 = Exo003UUIDGenerator.generateBodyUUID("Hello, World!");

      expect(uuid1).toBe(uuid2);
      expect(Exo003UUIDGenerator.isValidUUID(uuid1)).toBe(true);
    });

    it("should generate different UUIDs for content with different language tags", () => {
      const uuid1 = Exo003UUIDGenerator.generateBodyUUID("Hello", { language: "en" });
      const uuid2 = Exo003UUIDGenerator.generateBodyUUID("Hello", { language: "de" });

      expect(uuid1).not.toBe(uuid2);
    });

    it("should include direction in UUID generation", () => {
      const uuid1 = Exo003UUIDGenerator.generateBodyUUID("مرحبا", {
        language: "ar",
        direction: "rtl",
      });
      const uuid2 = Exo003UUIDGenerator.generateBodyUUID("مرحبا", {
        language: "ar",
      });

      expect(uuid1).not.toBe(uuid2);
    });

    it("should include datatype in UUID generation", () => {
      const uuid1 = Exo003UUIDGenerator.generateBodyUUID("42", {
        datatype: "http://www.w3.org/2001/XMLSchema#integer",
      });
      const uuid2 = Exo003UUIDGenerator.generateBodyUUID("42", {
        datatype: "http://www.w3.org/2001/XMLSchema#string",
      });

      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe("splitIRI", () => {
    it("should split hash-style IRIs correctly", () => {
      const result = Exo003UUIDGenerator.splitIRI(
        "https://exocortex.my/ontology/exo#Person"
      );

      expect(result.namespace).toBe("https://exocortex.my/ontology/exo#");
      expect(result.localName).toBe("Person");
    });

    it("should split slash-style IRIs correctly", () => {
      const result = Exo003UUIDGenerator.splitIRI(
        "http://example.org/vocab/Person"
      );

      expect(result.namespace).toBe("http://example.org/vocab/");
      expect(result.localName).toBe("Person");
    });

    it("should handle IRI with no local name separator", () => {
      const result = Exo003UUIDGenerator.splitIRI("urn:isbn:0451450523");

      expect(result.namespace).toBe("urn:isbn:0451450523");
      expect(result.localName).toBe("");
    });

    it("should prefer hash over slash for separation", () => {
      const result = Exo003UUIDGenerator.splitIRI(
        "http://example.org/vocab#Person"
      );

      expect(result.namespace).toBe("http://example.org/vocab#");
      expect(result.localName).toBe("Person");
    });
  });

  describe("isValidUUID", () => {
    it("should return true for valid UUIDs", () => {
      expect(
        Exo003UUIDGenerator.isValidUUID("550e8400-e29b-41d4-a716-446655440000")
      ).toBe(true);
      expect(
        Exo003UUIDGenerator.isValidUUID("6BA7B810-9DAD-11D1-80B4-00C04FD430C8")
      ).toBe(true);
    });

    it("should return false for invalid UUIDs", () => {
      expect(Exo003UUIDGenerator.isValidUUID("not-a-uuid")).toBe(false);
      expect(Exo003UUIDGenerator.isValidUUID("550e8400-e29b-41d4-a716")).toBe(false);
      expect(Exo003UUIDGenerator.isValidUUID("")).toBe(false);
    });
  });
});
