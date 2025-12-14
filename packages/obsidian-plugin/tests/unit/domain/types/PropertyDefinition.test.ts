import {
  PropertyFieldType,
  PropertyDefinition,
  propertyNameToUri,
  uriToPropertyName,
  extractPropertyLabel,
} from "exocortex";

describe("PropertyDefinition interface", () => {
  it("should allow creating a minimal property definition", () => {
    const prop: PropertyDefinition = {
      uri: "exo:Asset_label",
      name: "exo__Asset_label",
      label: "Label",
      fieldType: PropertyFieldType.Text,
    };

    expect(prop.uri).toBe("exo:Asset_label");
    expect(prop.name).toBe("exo__Asset_label");
    expect(prop.label).toBe("Label");
    expect(prop.fieldType).toBe(PropertyFieldType.Text);
  });

  it("should allow creating a full property definition", () => {
    const prop: PropertyDefinition = {
      uri: "ems:Effort_status",
      name: "ems__Effort_status",
      label: "Status",
      fieldType: PropertyFieldType.StatusSelect,
      required: true,
      description: "Current status of the effort",
      rangeType: "https://exocortex.my/ontology/ems#EffortStatus",
      deprecated: false,
      options: [
        { value: "[[ems__EffortStatusDraft]]", label: "Draft" },
        { value: "[[ems__EffortStatusActive]]", label: "Active" },
      ],
      defaultValue: "[[ems__EffortStatusDraft]]",
      order: 1,
      group: "Status",
    };

    expect(prop.required).toBe(true);
    expect(prop.description).toBe("Current status of the effort");
    expect(prop.options).toHaveLength(2);
    expect(prop.options![0].value).toBe("[[ems__EffortStatusDraft]]");
    expect(prop.order).toBe(1);
    expect(prop.group).toBe("Status");
  });

  it("should allow creating a numeric property definition with constraints", () => {
    const prop: PropertyDefinition = {
      uri: "ems:Effort_votes",
      name: "ems__Effort_votes",
      label: "Votes",
      fieldType: PropertyFieldType.Number,
      minValue: 0,
      maxValue: 100,
      defaultValue: 0,
    };

    expect(prop.minValue).toBe(0);
    expect(prop.maxValue).toBe(100);
  });

  it("should allow creating a text property definition with constraints", () => {
    const prop: PropertyDefinition = {
      uri: "exo:Asset_label",
      name: "exo__Asset_label",
      label: "Label",
      fieldType: PropertyFieldType.Text,
      maxLength: 255,
      pattern: "^[a-zA-Z0-9\\s]+$",
    };

    expect(prop.maxLength).toBe(255);
    expect(prop.pattern).toBe("^[a-zA-Z0-9\\s]+$");
  });

  it("should allow creating a multi-value property definition", () => {
    const prop: PropertyDefinition = {
      uri: "exo:Asset_tags",
      name: "exo__Asset_tags",
      label: "Tags",
      fieldType: PropertyFieldType.Reference,
      isMultiValue: true,
    };

    expect(prop.isMultiValue).toBe(true);
  });
});

describe("propertyNameToUri", () => {
  it("should convert exo__ prefix to exo:", () => {
    expect(propertyNameToUri("exo__Asset_label")).toBe("exo:Asset_label");
  });

  it("should convert ems__ prefix to ems:", () => {
    expect(propertyNameToUri("ems__Effort_status")).toBe("ems:Effort_status");
  });

  it("should preserve property names without recognized prefix", () => {
    expect(propertyNameToUri("custom__Property_name")).toBe(
      "custom:Property_name",
    );
  });

  it("should handle properties without prefix", () => {
    expect(propertyNameToUri("simpleProperty")).toBe("simpleProperty");
  });

  it("should handle empty string", () => {
    expect(propertyNameToUri("")).toBe("");
  });
});

describe("uriToPropertyName", () => {
  describe("prefixed URIs", () => {
    it("should convert exo: prefix to exo__", () => {
      expect(uriToPropertyName("exo:Asset_label")).toBe("exo__Asset_label");
    });

    it("should convert ems: prefix to ems__", () => {
      expect(uriToPropertyName("ems:Effort_status")).toBe("ems__Effort_status");
    });

    it("should handle other prefixes", () => {
      expect(uriToPropertyName("custom:Property_name")).toBe(
        "custom__Property_name",
      );
    });
  });

  describe("full IRIs", () => {
    it("should extract property name from exo namespace IRI", () => {
      expect(
        uriToPropertyName("https://exocortex.my/ontology/exo#Asset_label"),
      ).toBe("exo__Asset_label");
    });

    it("should extract property name from ems namespace IRI", () => {
      expect(
        uriToPropertyName("https://exocortex.my/ontology/ems#Effort_status"),
      ).toBe("ems__Effort_status");
    });

    it("should extract namespace and property for unknown namespaces", () => {
      expect(
        uriToPropertyName("https://example.org/ontology#SomeProperty"),
      ).toBe("ontology__SomeProperty");
    });

    it("should handle IRIs with slash separator", () => {
      expect(
        uriToPropertyName("https://example.org/ontology/SomeProperty"),
      ).toBe("SomeProperty");
    });
  });

  it("should handle empty string", () => {
    expect(uriToPropertyName("")).toBe("");
  });
});

describe("extractPropertyLabel", () => {
  describe("from property names", () => {
    it("should extract label from exo__ prefixed property", () => {
      expect(extractPropertyLabel("exo__Asset_label")).toBe("Label");
    });

    it("should extract label from ems__ prefixed property", () => {
      expect(extractPropertyLabel("ems__Effort_status")).toBe("Status");
    });

    it("should handle camelCase in property part", () => {
      expect(extractPropertyLabel("ems__Effort_startTimestamp")).toBe(
        "Start Timestamp",
      );
    });

    it("should handle property without underscore after class", () => {
      expect(extractPropertyLabel("exo__Asset")).toBe("Asset");
    });

    it("should handle multi-part property names", () => {
      expect(extractPropertyLabel("ems__Task_expectedDuration")).toBe(
        "Expected Duration",
      );
    });
  });

  describe("from URIs", () => {
    it("should extract label from prefixed URI", () => {
      expect(extractPropertyLabel("exo:Asset_label")).toBe("Label");
    });

    it("should extract label from full IRI", () => {
      expect(
        extractPropertyLabel("https://exocortex.my/ontology/exo#Asset_label"),
      ).toBe("Label");
    });
  });

  describe("edge cases", () => {
    it("should capitalize first letter", () => {
      expect(extractPropertyLabel("exo__Asset_name")).toBe("Name");
    });

    it("should handle all uppercase", () => {
      expect(extractPropertyLabel("exo__Asset_URL")).toBe("URL");
    });

    it("should handle camelCase single word property", () => {
      expect(extractPropertyLabel("simpleProperty")).toBe("Simple Property");
    });
  });
});
