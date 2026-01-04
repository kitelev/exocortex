import {
  Exo003Parser,
  Exo003MetadataType,
  Exo003NamespaceMetadata,
  Exo003AnchorMetadata,
  Exo003BlankNodeMetadata,
  Exo003StatementMetadata,
  Exo003BodyMetadata,
  DEFAULT_LANGUAGE_TAG,
} from "../../../../../src/domain/models/exo003";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";

describe("Exo003Parser", () => {
  describe("validate", () => {
    describe("common validation", () => {
      it("should fail when metadata is missing", () => {
        const result = Exo003Parser.validate({});

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Missing required property: metadata");
      });

      it("should fail for unknown metadata type", () => {
        const result = Exo003Parser.validate({
          metadata: "unknown_type",
        });

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain("Invalid metadata");
      });

      it("should fail when required properties are missing", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Namespace,
          // Missing uri
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Missing required property: uri");
      });

      it("should fail when forbidden properties are present", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Namespace,
          uri: "https://exocortex.my/ontology/exo#",
          forbidden_property: "value", // Not allowed
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Forbidden property for namespace: forbidden_property");
      });
    });

    describe("namespace validation", () => {
      it("should pass for valid namespace metadata", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Namespace,
          uri: "https://exocortex.my/ontology/exo#",
        });

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should fail for invalid namespace URI", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Namespace,
          uri: "not a valid uri",
        });

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain("uri is not a valid IRI");
      });
    });

    describe("anchor validation", () => {
      it("should pass for valid anchor metadata with uri", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Anchor,
          uri: "https://exocortex.my/kitelev/63967e73-2e3e-4394-8b26-86373b292cb5",
        });

        expect(result.valid).toBe(true);
      });

      it("should fail for invalid anchor uri", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Anchor,
          uri: "not a valid uri",
        });

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain("uri is not a valid IRI");
      });

      it("should reject forbidden localName property", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Anchor,
          uri: "https://exocortex.my/kitelev/test",
          localName: "Person", // NOT allowed per spec
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Forbidden property for anchor: localName");
      });
    });

    describe("blank_node validation", () => {
      it("should pass for valid blank node metadata with uri", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.BlankNode,
          uri: "https://exocortex.my/kitelev/_:bnode-abc123",
        });

        expect(result.valid).toBe(true);
      });

      it("should fail for invalid blank node uri", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.BlankNode,
          uri: "not a valid uri",
        });

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain("uri is not a valid IRI");
      });

      it("should reject forbidden id property", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.BlankNode,
          uri: "https://exocortex.my/kitelev/_:bnode-test",
          id: "b1", // NOT allowed per spec
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Forbidden property for blank_node: id");
      });
    });

    describe("statement validation", () => {
      it("should pass for valid statement metadata", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Statement,
          subject: "[[person-123]]",
          predicate: "[[rdf-type]]",
          object: "[[rdfs-class]]",
        });

        expect(result.valid).toBe(true);
      });
    });

    describe("body validation", () => {
      it("should pass for valid body metadata (minimal: subject, predicate)", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[rdfs-label]]",
        });

        expect(result.valid).toBe(true);
      });

      it("should reject forbidden language property", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[rdfs-label]]",
          language: "en", // NOT allowed per spec
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Forbidden property for body: language");
      });

      it("should reject forbidden datatype property", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[xsd-integer-value]]",
          datatype: "http://www.w3.org/2001/XMLSchema#integer", // NOT allowed per spec
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Forbidden property for body: datatype");
      });

      it("should reject forbidden direction property", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[rdfs-label]]",
          direction: "rtl", // NOT allowed per spec
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Forbidden property for body: direction");
      });

      it("should pass with valid aliases", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[rdfs-label]]",
          aliases: ["kitelev:person-123 rdfs:label"],
        });

        expect(result.valid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });
    });
  });

  describe("parse", () => {
    it("should parse valid namespace metadata", () => {
      const result = Exo003Parser.parse({
        metadata: Exo003MetadataType.Namespace,
        uri: "https://exocortex.my/ontology/exo#",
      });

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.metadata).toBe(Exo003MetadataType.Namespace);

      const namespace = result.metadata as Exo003NamespaceMetadata;
      expect(namespace.uri).toBe("https://exocortex.my/ontology/exo#");
    });

    it("should parse valid anchor metadata with uri", () => {
      const result = Exo003Parser.parse({
        metadata: Exo003MetadataType.Anchor,
        uri: "https://exocortex.my/kitelev/63967e73-2e3e-4394-8b26-86373b292cb5",
        aliases: ["kitelev:63967e73-2e3e-4394-8b26-86373b292cb5"],
      });

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();

      const anchor = result.metadata as Exo003AnchorMetadata;
      expect(anchor.uri).toBe("https://exocortex.my/kitelev/63967e73-2e3e-4394-8b26-86373b292cb5");
      expect(anchor.aliases).toEqual(["kitelev:63967e73-2e3e-4394-8b26-86373b292cb5"]);
    });

    it("should parse valid blank node metadata with uri", () => {
      const result = Exo003Parser.parse({
        metadata: Exo003MetadataType.BlankNode,
        uri: "https://exocortex.my/kitelev/_:bnode-abc123",
      });

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();

      const blankNode = result.metadata as Exo003BlankNodeMetadata;
      expect(blankNode.uri).toBe("https://exocortex.my/kitelev/_:bnode-abc123");
    });

    it("should parse valid statement metadata", () => {
      const result = Exo003Parser.parse({
        metadata: Exo003MetadataType.Statement,
        subject: "[[person-123]]",
        predicate: "[[rdf-type]]",
        object: "[[rdfs-class]]",
      });

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();

      const statement = result.metadata as Exo003StatementMetadata;
      expect(statement.subject).toBe("[[person-123]]");
      expect(statement.predicate).toBe("[[rdf-type]]");
      expect(statement.object).toBe("[[rdfs-class]]");
    });

    it("should parse valid body metadata and include body content", () => {
      const result = Exo003Parser.parse(
        {
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[rdfs-label]]",
        },
        "Hello, World!"
      );

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.bodyContent).toBe("Hello, World!");

      const body = result.metadata as Exo003BodyMetadata;
      expect(body.subject).toBe("[[person-123]]");
      expect(body.predicate).toBe("[[rdfs-label]]");
    });

    it("should return errors for invalid frontmatter", () => {
      const result = Exo003Parser.parse({
        metadata: Exo003MetadataType.Namespace,
        // Missing required uri property
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });

  describe("toLiteral", () => {
    it("should create literal with language from TBox options", () => {
      const metadata: Exo003BodyMetadata = {
        metadata: Exo003MetadataType.Body,
        subject: "[[person-123]]",
        predicate: "[[rdfs-label]]",
      };

      const literal = Exo003Parser.toLiteral(metadata, "Hello, World!", { language: "en" });

      expect(literal.value).toBe("Hello, World!");
      expect(literal.language).toBe("en");
      expect(literal.datatype).toBeUndefined();
    });

    it("should create literal with default language when no options specified", () => {
      const metadata: Exo003BodyMetadata = {
        metadata: Exo003MetadataType.Body,
        subject: "[[person-123]]",
        predicate: "[[rdfs-label]]",
      };

      const literal = Exo003Parser.toLiteral(metadata, "Привет, мир!");

      expect(literal.value).toBe("Привет, мир!");
      expect(literal.language).toBe(DEFAULT_LANGUAGE_TAG);
    });

    it("should create literal with direction from TBox options", () => {
      const metadata: Exo003BodyMetadata = {
        metadata: Exo003MetadataType.Body,
        subject: "[[person-123]]",
        predicate: "[[rdfs-label]]",
      };

      const literal = Exo003Parser.toLiteral(metadata, "مرحبا", {
        language: "ar",
        direction: "rtl",
      });

      expect(literal.value).toBe("مرحبا");
      expect(literal.language).toBe("ar");
      expect(literal.direction).toBe("rtl");
    });

    it("should create typed literal with datatype from TBox options", () => {
      const metadata: Exo003BodyMetadata = {
        metadata: Exo003MetadataType.Body,
        subject: "[[person-123]]",
        predicate: "[[age]]",
      };

      const literal = Exo003Parser.toLiteral(metadata, "42", {
        datatype: "http://www.w3.org/2001/XMLSchema#integer",
      });

      expect(literal.value).toBe("42");
      expect(literal.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#integer");
      expect(literal.language).toBeUndefined();
    });
  });

  describe("isExo003Format", () => {
    it("should return true for valid Exo 0.0.3 frontmatter", () => {
      expect(
        Exo003Parser.isExo003Format({
          metadata: Exo003MetadataType.Namespace,
        })
      ).toBe(true);

      expect(
        Exo003Parser.isExo003Format({
          metadata: Exo003MetadataType.Statement,
        })
      ).toBe(true);
    });

    it("should return false for non-Exo 0.0.3 frontmatter", () => {
      expect(
        Exo003Parser.isExo003Format({
          exo__Instance_class: "ems__Task",
        })
      ).toBe(false);

      expect(
        Exo003Parser.isExo003Format({
          metadata: "unknown_type",
        })
      ).toBe(false);

      expect(Exo003Parser.isExo003Format({})).toBe(false);
    });
  });

  describe("toTriple", () => {
    it("should convert statement metadata to Triple", () => {
      const metadata: Exo003StatementMetadata = {
        metadata: Exo003MetadataType.Statement,
        subject: "[[person-123]]",
        predicate: "[[rdf-type]]",
        object: "[[rdfs-class]]",
      };

      const resolveReference = (ref: string) => {
        const mappings: Record<string, { type: "iri" | "blank" | "literal"; value: string }> = {
          "[[person-123]]": { type: "iri", value: "https://exocortex.my/ontology/exo#Person" },
          "[[rdf-type]]": { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
          "[[rdfs-class]]": { type: "iri", value: "http://www.w3.org/2000/01/rdf-schema#Class" },
        };
        return mappings[ref] || { type: "iri" as const, value: ref };
      };

      const triple = Exo003Parser.toTriple(metadata, resolveReference);

      expect(triple.subject.toString()).toBe("https://exocortex.my/ontology/exo#Person");
      expect(triple.predicate.toString()).toBe(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
      );
      expect(triple.object.toString()).toBe("http://www.w3.org/2000/01/rdf-schema#Class");
    });

    it("should handle literal objects with body content", () => {
      const metadata: Exo003StatementMetadata = {
        metadata: Exo003MetadataType.Statement,
        subject: "[[person-123]]",
        predicate: "[[rdfs-label]]",
        object: "[[label-body]]",
      };

      const resolveReference = (ref: string) => {
        const mappings: Record<
          string,
          { type: "iri" | "blank" | "literal"; value: string; language?: string }
        > = {
          "[[person-123]]": { type: "iri", value: "https://exocortex.my/ontology/exo#Person" },
          "[[rdfs-label]]": { type: "iri", value: "http://www.w3.org/2000/01/rdf-schema#label" },
          "[[label-body]]": { type: "literal", value: "", language: "en" },
        };
        return mappings[ref] || { type: "iri" as const, value: ref };
      };

      const triple = Exo003Parser.toTriple(metadata, resolveReference, "Person Class");

      expect(triple.object).toBeInstanceOf(Literal);
      expect((triple.object as Literal).value).toBe("Person Class");
      expect((triple.object as Literal).language).toBe("en");
    });
  });
});
