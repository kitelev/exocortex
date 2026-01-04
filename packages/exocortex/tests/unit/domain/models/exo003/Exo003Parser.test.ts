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
      it("should pass for valid anchor metadata", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Anchor,
          localName: "Person",
        });

        expect(result.valid).toBe(true);
      });

      it("should fail for empty anchor local name", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Anchor,
          localName: "   ",
        });

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain("localName cannot be empty");
      });
    });

    describe("blank_node validation", () => {
      it("should pass for valid blank node metadata", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.BlankNode,
          id: "b1",
        });

        expect(result.valid).toBe(true);
      });

      it("should fail for empty blank node id", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.BlankNode,
          id: "",
        });

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain("id cannot be empty");
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
      it("should pass for valid body metadata with language", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[rdfs-label]]",
          language: "en",
        });

        expect(result.valid).toBe(true);
      });

      it("should pass for valid body metadata with datatype", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[xsd-integer-value]]",
          datatype: "http://www.w3.org/2001/XMLSchema#integer",
        });

        expect(result.valid).toBe(true);
      });

      it("should fail when both language and datatype are specified", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[rdfs-label]]",
          language: "en",
          datatype: "http://www.w3.org/2001/XMLSchema#string",
        });

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain(
          "Body cannot have both datatype and language"
        );
      });

      it("should fail when direction is specified without language", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[rdfs-label]]",
          direction: "rtl",
        });

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain(
          "direction requires language to be set"
        );
      });

      it("should fail for invalid direction value", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[rdfs-label]]",
          language: "ar",
          direction: "invalid",
        });

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('direction must be "ltr" or "rtl"');
      });

      it("should warn when no language or datatype is specified", () => {
        const result = Exo003Parser.validate({
          metadata: Exo003MetadataType.Body,
          subject: "[[person-123]]",
          predicate: "[[rdfs-label]]",
        });

        expect(result.valid).toBe(true);
        expect(result.warnings).toContain(
          `No language or datatype specified. Will use default language tag: @${DEFAULT_LANGUAGE_TAG}`
        );
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

    it("should parse valid anchor metadata", () => {
      const result = Exo003Parser.parse({
        metadata: Exo003MetadataType.Anchor,
        localName: "Person",
        label: "Person Class",
      });

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();

      const anchor = result.metadata as Exo003AnchorMetadata;
      expect(anchor.localName).toBe("Person");
      expect(anchor.label).toBe("Person Class");
    });

    it("should parse valid blank node metadata", () => {
      const result = Exo003Parser.parse({
        metadata: Exo003MetadataType.BlankNode,
        id: "b1",
      });

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();

      const blankNode = result.metadata as Exo003BlankNodeMetadata;
      expect(blankNode.id).toBe("b1");
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
          language: "en",
        },
        "Hello, World!"
      );

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.bodyContent).toBe("Hello, World!");

      const body = result.metadata as Exo003BodyMetadata;
      expect(body.language).toBe("en");
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
    it("should create literal with specified language", () => {
      const metadata: Exo003BodyMetadata = {
        metadata: Exo003MetadataType.Body,
        subject: "[[person-123]]",
        predicate: "[[rdfs-label]]",
        language: "en",
      };

      const literal = Exo003Parser.toLiteral(metadata, "Hello, World!");

      expect(literal.value).toBe("Hello, World!");
      expect(literal.language).toBe("en");
      expect(literal.datatype).toBeUndefined();
    });

    it("should create literal with default language when not specified", () => {
      const metadata: Exo003BodyMetadata = {
        metadata: Exo003MetadataType.Body,
        subject: "[[person-123]]",
        predicate: "[[rdfs-label]]",
      };

      const literal = Exo003Parser.toLiteral(metadata, "Привет, мир!");

      expect(literal.value).toBe("Привет, мир!");
      expect(literal.language).toBe(DEFAULT_LANGUAGE_TAG);
    });

    it("should create literal with direction", () => {
      const metadata: Exo003BodyMetadata = {
        metadata: Exo003MetadataType.Body,
        subject: "[[person-123]]",
        predicate: "[[rdfs-label]]",
        language: "ar",
        direction: "rtl",
      };

      const literal = Exo003Parser.toLiteral(metadata, "مرحبا");

      expect(literal.value).toBe("مرحبا");
      expect(literal.language).toBe("ar");
      expect(literal.direction).toBe("rtl");
    });

    it("should create typed literal with datatype", () => {
      const metadata: Exo003BodyMetadata = {
        metadata: Exo003MetadataType.Body,
        subject: "[[person-123]]",
        predicate: "[[age]]",
        datatype: "http://www.w3.org/2001/XMLSchema#integer",
      };

      const literal = Exo003Parser.toLiteral(metadata, "42");

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
