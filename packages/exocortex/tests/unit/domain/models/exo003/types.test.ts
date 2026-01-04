import {
  Exo003MetadataType,
  ALLOWED_PROPERTIES,
  REQUIRED_PROPERTIES,
  DEFAULT_LANGUAGE_TAG,
  UUID_URL_NAMESPACE,
} from "../../../../../src/domain/models/exo003/types";

describe("Exo003 Types", () => {
  describe("Exo003MetadataType", () => {
    it("should define all expected metadata types", () => {
      expect(Exo003MetadataType.Namespace).toBe("namespace");
      expect(Exo003MetadataType.Anchor).toBe("anchor");
      expect(Exo003MetadataType.BlankNode).toBe("blank_node");
      expect(Exo003MetadataType.Statement).toBe("statement");
      expect(Exo003MetadataType.Body).toBe("body");
    });

    it("should have exactly 5 metadata types", () => {
      const types = Object.values(Exo003MetadataType);
      expect(types).toHaveLength(5);
    });
  });

  describe("ALLOWED_PROPERTIES", () => {
    it("should define allowed properties for all metadata types", () => {
      expect(ALLOWED_PROPERTIES[Exo003MetadataType.Namespace]).toBeDefined();
      expect(ALLOWED_PROPERTIES[Exo003MetadataType.Anchor]).toBeDefined();
      expect(ALLOWED_PROPERTIES[Exo003MetadataType.BlankNode]).toBeDefined();
      expect(ALLOWED_PROPERTIES[Exo003MetadataType.Statement]).toBeDefined();
      expect(ALLOWED_PROPERTIES[Exo003MetadataType.Body]).toBeDefined();
    });

    it("should include common base properties for all types", () => {
      for (const type of Object.values(Exo003MetadataType)) {
        const props = ALLOWED_PROPERTIES[type];
        expect(props).toContain("exo__Asset_uid");
        expect(props).toContain("exo__Asset_createdAt");
        expect(props).toContain("exo__metadataType");
      }
    });

    it("should include namespace-specific properties", () => {
      const props = ALLOWED_PROPERTIES[Exo003MetadataType.Namespace];
      expect(props).toContain("exo__Namespace_prefix");
      expect(props).toContain("exo__Namespace_uri");
    });

    it("should include anchor-specific properties", () => {
      const props = ALLOWED_PROPERTIES[Exo003MetadataType.Anchor];
      expect(props).toContain("exo__Anchor_localName");
      expect(props).toContain("exo__Asset_label");
      expect(props).toContain("aliases");
    });

    it("should include blank_node-specific properties", () => {
      const props = ALLOWED_PROPERTIES[Exo003MetadataType.BlankNode];
      expect(props).toContain("exo__BlankNode_id");
      expect(props).toContain("exo__Asset_label");
    });

    it("should include statement-specific properties", () => {
      const props = ALLOWED_PROPERTIES[Exo003MetadataType.Statement];
      expect(props).toContain("exo__Statement_subject");
      expect(props).toContain("exo__Statement_predicate");
      expect(props).toContain("exo__Statement_object");
    });

    it("should include body-specific properties", () => {
      const props = ALLOWED_PROPERTIES[Exo003MetadataType.Body];
      expect(props).toContain("exo__Body_datatype");
      expect(props).toContain("exo__Body_language");
      expect(props).toContain("exo__Body_direction");
    });
  });

  describe("REQUIRED_PROPERTIES", () => {
    it("should define required properties for all metadata types", () => {
      expect(REQUIRED_PROPERTIES[Exo003MetadataType.Namespace]).toBeDefined();
      expect(REQUIRED_PROPERTIES[Exo003MetadataType.Anchor]).toBeDefined();
      expect(REQUIRED_PROPERTIES[Exo003MetadataType.BlankNode]).toBeDefined();
      expect(REQUIRED_PROPERTIES[Exo003MetadataType.Statement]).toBeDefined();
      expect(REQUIRED_PROPERTIES[Exo003MetadataType.Body]).toBeDefined();
    });

    it("should require common base properties for all types", () => {
      for (const type of Object.values(Exo003MetadataType)) {
        const props = REQUIRED_PROPERTIES[type];
        expect(props).toContain("exo__Asset_uid");
        expect(props).toContain("exo__Asset_createdAt");
        expect(props).toContain("exo__metadataType");
      }
    });

    it("should have required properties as subset of allowed properties", () => {
      for (const type of Object.values(Exo003MetadataType)) {
        const required = REQUIRED_PROPERTIES[type];
        const allowed = ALLOWED_PROPERTIES[type];

        for (const prop of required) {
          expect(allowed).toContain(prop);
        }
      }
    });

    it("should require namespace-specific properties", () => {
      const props = REQUIRED_PROPERTIES[Exo003MetadataType.Namespace];
      expect(props).toContain("exo__Namespace_prefix");
      expect(props).toContain("exo__Namespace_uri");
    });

    it("should require anchor local name", () => {
      const props = REQUIRED_PROPERTIES[Exo003MetadataType.Anchor];
      expect(props).toContain("exo__Anchor_localName");
    });

    it("should require blank node id", () => {
      const props = REQUIRED_PROPERTIES[Exo003MetadataType.BlankNode];
      expect(props).toContain("exo__BlankNode_id");
    });

    it("should require all statement components", () => {
      const props = REQUIRED_PROPERTIES[Exo003MetadataType.Statement];
      expect(props).toContain("exo__Statement_subject");
      expect(props).toContain("exo__Statement_predicate");
      expect(props).toContain("exo__Statement_object");
    });

    it("should not require body content metadata (optional)", () => {
      const props = REQUIRED_PROPERTIES[Exo003MetadataType.Body];
      expect(props).not.toContain("exo__Body_datatype");
      expect(props).not.toContain("exo__Body_language");
      expect(props).not.toContain("exo__Body_direction");
    });
  });

  describe("DEFAULT_LANGUAGE_TAG", () => {
    it("should be 'ru' (Russian)", () => {
      expect(DEFAULT_LANGUAGE_TAG).toBe("ru");
    });
  });

  describe("UUID_URL_NAMESPACE", () => {
    it("should be the RFC 4122 URL namespace UUID", () => {
      // This is the standard UUID namespace for URLs from RFC 4122
      expect(UUID_URL_NAMESPACE).toBe("6ba7b811-9dad-11d1-80b4-00c04fd430c8");
    });

    it("should be a valid UUID format", () => {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(UUID_URL_NAMESPACE)).toBe(true);
    });
  });
});
