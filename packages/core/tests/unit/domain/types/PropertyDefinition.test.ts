import { describe, it, expect } from "@jest/globals";
import {
  propertyNameToUri,
  uriToPropertyName,
  extractPropertyLabel,
} from "../../../../src/domain/types/PropertyDefinition";

describe("PropertyDefinition", () => {
  describe("propertyNameToUri", () => {
    it("should convert exo__ prefix to exo:", () => {
      expect(propertyNameToUri("exo__Asset_label")).toBe("exo:Asset_label");
    });

    it("should convert ems__ prefix to ems:", () => {
      expect(propertyNameToUri("ems__Effort_status")).toBe("ems:Effort_status");
    });

    it("should return unchanged if no double underscore prefix", () => {
      expect(propertyNameToUri("plainProperty")).toBe("plainProperty");
    });

    it("should only replace the first prefix occurrence", () => {
      expect(propertyNameToUri("exo__Asset__nested")).toBe("exo:Asset__nested");
    });

    it("should handle single char prefixes", () => {
      expect(propertyNameToUri("x__Foo")).toBe("x:Foo");
    });
  });

  describe("uriToPropertyName", () => {
    it("should convert prefixed URI to frontmatter name", () => {
      expect(uriToPropertyName("exo:Asset_label")).toBe("exo__Asset_label");
    });

    it("should convert full IRI with hash to property name", () => {
      expect(
        uriToPropertyName("https://exocortex.my/ontology/exo#Asset_label"),
      ).toBe("exo__Asset_label");
    });

    it("should convert full IRI with ems prefix", () => {
      expect(
        uriToPropertyName("https://exocortex.my/ontology/ems#Effort_status"),
      ).toBe("ems__Effort_status");
    });

    it("should handle full IRI without matching hash pattern (fallback to last hash segment)", () => {
      expect(
        uriToPropertyName("http://example.org/ns#SomeProperty"),
      ).toBe("ns__SomeProperty");
    });

    it("should handle full IRI with no hash or prefix match (fallback to last slash)", () => {
      // URI that doesn't match the /([a-z]+)#([A-Za-z0-9_]+)$/ pattern
      expect(
        uriToPropertyName("https://example.org/ontology/MyProperty"),
      ).toBe("MyProperty");
    });

    it("should handle full IRI with hash as last char (no fragment)", () => {
      // lastHash > lastSlash, but substring(separator+1) = empty string
      expect(
        uriToPropertyName("http://example.org/ontology#"),
      ).toBe("");
    });

    it("should handle simple URI with no separator at all", () => {
      // No http prefix and no colon prefix -> passes through
      expect(uriToPropertyName("justAString")).toBe("justAString");
    });

    it("should handle prefixed URI with ems prefix", () => {
      expect(uriToPropertyName("ems:Effort_status")).toBe("ems__Effort_status");
    });
  });

  describe("extractPropertyLabel", () => {
    it("should extract label from frontmatter property name", () => {
      expect(extractPropertyLabel("exo__Asset_label")).toBe("Label");
    });

    it("should extract label from property with camelCase", () => {
      expect(extractPropertyLabel("ems__Effort_startTimestamp")).toBe(
        "Start Timestamp",
      );
    });

    it("should extract label from prefixed URI", () => {
      expect(extractPropertyLabel("exo:Asset_label")).toBe("Label");
    });

    it("should handle property without prefix (no double underscore)", () => {
      expect(extractPropertyLabel("Asset_label")).toBe("Label");
    });

    it("should handle property with only one part after class", () => {
      expect(extractPropertyLabel("exo__Asset")).toBe("Asset");
    });

    it("should handle property with multiple underscore-separated parts", () => {
      expect(extractPropertyLabel("ems__Effort_planned_start")).toBe(
        "Planned start",
      );
    });

    it("should capitalize first letter", () => {
      expect(extractPropertyLabel("exo__Asset_uid")).toBe("Uid");
    });

    it("should split camelCase into words", () => {
      expect(extractPropertyLabel("exo__Asset_myProperty")).toBe("My Property");
    });

    it("should handle full IRI as input", () => {
      expect(
        extractPropertyLabel("https://exocortex.my/ontology/exo#Asset_label"),
      ).toBe("Label");
    });
  });
});
