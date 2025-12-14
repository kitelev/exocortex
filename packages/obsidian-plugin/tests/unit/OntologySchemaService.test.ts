import { OntologySchemaService, type OntologyPropertyDefinition } from "../../src/application/services/OntologySchemaService";
import { PropertyFieldType } from "exocortex";

// Mock SPARQLQueryService
const mockQuery = jest.fn();

jest.mock("../../src/application/services/SPARQLQueryService", () => ({
  SPARQLQueryService: jest.fn().mockImplementation(() => ({
    query: mockQuery,
  })),
}));

// Mock LoggerFactory
jest.mock("../../src/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe("OntologySchemaService", () => {
  let service: OntologySchemaService;
  let mockSparqlService: { query: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockSparqlService = {
      query: mockQuery,
    };

    service = new OntologySchemaService(mockSparqlService as any);
  });

  describe("getClassProperties", () => {
    it("should get direct properties for a class", async () => {
      // Mock direct properties query
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["label", "Label"],
          ["range", "http://www.w3.org/2001/XMLSchema#string"],
          ["deprecated", null],
          ["comment", "The display label"],
        ]),
      ]);

      // Mock class hierarchy query (no superclasses)
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("exo__Asset");

      expect(properties).toHaveLength(1);
      expect(properties[0].uri).toBe("exo__Asset_label");
      expect(properties[0].label).toBe("Label");
      expect(properties[0].fieldType).toBe(PropertyFieldType.Text);
      expect(properties[0].deprecated).toBe(false);
    });

    it("should include inherited properties from superclasses", async () => {
      // Mock direct properties for ems__Task
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/ems#Task_priority"],
          ["label", "Priority"],
          ["range", "http://www.w3.org/2001/XMLSchema#integer"],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);

      // Mock class hierarchy (Task -> Effort -> Asset)
      mockQuery.mockResolvedValueOnce([
        new Map([["superClass", "https://exocortex.my/ontology/ems#Effort"]]),
        new Map([["superClass", "https://exocortex.my/ontology/exo#Asset"]]),
      ]);

      // Mock properties for Effort
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/ems#Effort_status"],
          ["label", "Status"],
          ["range", "https://exocortex.my/ontology/ems#EffortStatus"],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);

      // Mock properties for Asset
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["label", "Label"],
          ["range", "http://www.w3.org/2001/XMLSchema#string"],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);

      const properties = await service.getClassProperties("ems__Task");

      expect(properties.length).toBeGreaterThanOrEqual(3);

      // Check that inherited properties are included
      const propertyUris = properties.map((p) => p.uri);
      expect(propertyUris).toContain("ems__Task_priority");
      expect(propertyUris).toContain("ems__Effort_status");
      expect(propertyUris).toContain("exo__Asset_label");
    });

    it("should sort properties alphabetically by label", async () => {
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_zulu"],
          ["label", "Zulu"],
          ["range", null],
          ["deprecated", null],
          ["comment", null],
        ]),
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_alpha"],
          ["label", "Alpha"],
          ["range", null],
          ["deprecated", null],
          ["comment", null],
        ]),
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_middle"],
          ["label", "Middle"],
          ["range", null],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);

      mockQuery.mockResolvedValueOnce([]); // No superclasses

      const properties = await service.getClassProperties("exo__Asset");

      expect(properties[0].label).toBe("Alpha");
      expect(properties[1].label).toBe("Middle");
      expect(properties[2].label).toBe("Zulu");
    });

    it("should prefer direct properties over inherited (same URI)", async () => {
      // Direct properties with overridden label
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["label", "Custom Label"],
          ["range", null],
          ["deprecated", null],
          ["comment", "Overridden"],
        ]),
      ]);

      // Superclass
      mockQuery.mockResolvedValueOnce([
        new Map([["superClass", "https://exocortex.my/ontology/exo#Asset"]]),
      ]);

      // Inherited property with different label
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["label", "Original Label"],
          ["range", null],
          ["deprecated", null],
          ["comment", "Original"],
        ]),
      ]);

      const properties = await service.getClassProperties("custom__Class");

      const labelProp = properties.find((p) => p.uri === "exo__Asset_label");
      expect(labelProp?.label).toBe("Custom Label");
      expect(labelProp?.description).toBe("Overridden");
    });

    it("should handle query errors gracefully", async () => {
      mockQuery.mockRejectedValue(new Error("Query failed"));

      const properties = await service.getClassProperties("exo__Asset");

      expect(properties).toEqual([]);
    });
  });

  describe("getClassHierarchy", () => {
    it("should return superclasses in order", async () => {
      mockQuery.mockResolvedValueOnce([
        new Map([["superClass", "https://exocortex.my/ontology/ems#Effort"]]),
        new Map([["superClass", "https://exocortex.my/ontology/exo#Asset"]]),
      ]);

      const hierarchy = await service.getClassHierarchy("ems__Task");

      expect(hierarchy).toContain("ems__Effort");
      expect(hierarchy).toContain("exo__Asset");
    });

    it("should return empty array for root class", async () => {
      mockQuery.mockResolvedValueOnce([]);

      const hierarchy = await service.getClassHierarchy("exo__Asset");

      expect(hierarchy).toEqual([]);
    });

    it("should handle query errors gracefully", async () => {
      mockQuery.mockRejectedValue(new Error("Query failed"));

      const hierarchy = await service.getClassHierarchy("ems__Task");

      expect(hierarchy).toEqual([]);
    });

    it("should convert IRI to class name format", async () => {
      mockQuery.mockResolvedValueOnce([
        new Map([["superClass", "https://exocortex.my/ontology/ems#SomeClass"]]),
      ]);

      const hierarchy = await service.getClassHierarchy("ems__Task");

      expect(hierarchy).toContain("ems__SomeClass");
    });
  });

  describe("isDeprecatedProperty", () => {
    it("should return true for deprecated property", async () => {
      mockQuery.mockResolvedValueOnce([
        new Map([["deprecated", "true"]]),
      ]);

      const isDeprecated = await service.isDeprecatedProperty("exo__Asset_oldProp");

      expect(isDeprecated).toBe(true);
    });

    it("should return false for non-deprecated property", async () => {
      mockQuery.mockResolvedValueOnce([]);

      const isDeprecated = await service.isDeprecatedProperty("exo__Asset_label");

      expect(isDeprecated).toBe(false);
    });

    it("should return false for property with deprecated=false", async () => {
      mockQuery.mockResolvedValueOnce([
        new Map([["deprecated", "false"]]),
      ]);

      const isDeprecated = await service.isDeprecatedProperty("exo__Asset_label");

      expect(isDeprecated).toBe(false);
    });

    it("should handle query errors gracefully", async () => {
      mockQuery.mockRejectedValue(new Error("Query failed"));

      const isDeprecated = await service.isDeprecatedProperty("exo__Asset_prop");

      expect(isDeprecated).toBe(false);
    });

    it("should handle full IRI input", async () => {
      mockQuery.mockResolvedValueOnce([
        new Map([["deprecated", "true"]]),
      ]);

      const isDeprecated = await service.isDeprecatedProperty(
        "https://exocortex.my/ontology/exo#Asset_oldProp"
      );

      expect(mockQuery).toHaveBeenCalled();
      expect(isDeprecated).toBe(true);
    });
  });

  describe("getDefaultProperties", () => {
    it("should return base properties for any class", () => {
      const properties = service.getDefaultProperties("exo__SomeClass");

      expect(properties).toHaveLength(1);
      expect(properties[0].uri).toBe("exo__Asset_label");
      expect(properties[0].fieldType).toBe(PropertyFieldType.Text);
    });

    it("should return task-specific properties for ems__Task", () => {
      const properties = service.getDefaultProperties("ems__Task");

      expect(properties.length).toBeGreaterThan(1);

      const propertyUris = properties.map((p) => p.uri);
      expect(propertyUris).toContain("exo__Asset_label");
      expect(propertyUris).toContain("ems__Effort_taskSize");
      expect(propertyUris).toContain("ems__Effort_status");
    });

    it("should return task-specific properties for task subclasses", () => {
      const properties = service.getDefaultProperties("ems__Task_Daily");

      expect(properties.length).toBeGreaterThan(1);

      const propertyUris = properties.map((p) => p.uri);
      expect(propertyUris).toContain("ems__Effort_taskSize");
    });

    it("should include correct field types for task properties", () => {
      const properties = service.getDefaultProperties("ems__Task");

      const sizeProperty = properties.find((p) => p.uri === "ems__Effort_taskSize");
      expect(sizeProperty?.fieldType).toBe(PropertyFieldType.SizeSelect);

      const statusProperty = properties.find((p) => p.uri === "ems__Effort_status");
      expect(statusProperty?.fieldType).toBe(PropertyFieldType.StatusSelect);
    });

    it("should mark all default properties as not deprecated", () => {
      const properties = service.getDefaultProperties("ems__Task");

      for (const prop of properties) {
        expect(prop.deprecated).toBe(false);
      }
    });

    it("should mark all default properties as not required", () => {
      const properties = service.getDefaultProperties("ems__Task");

      for (const prop of properties) {
        expect(prop.required).toBe(false);
      }
    });
  });

  describe("rangeToFieldType mapping", () => {
    beforeEach(() => {
      // Setup for testing range type mapping through getClassProperties
      mockQuery.mockResolvedValueOnce([]); // No superclasses for hierarchy query
    });

    it("should map xsd:dateTime to Timestamp field", async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_createdAt"],
          ["label", "Created At"],
          ["range", "http://www.w3.org/2001/XMLSchema#dateTime"],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]); // No superclasses

      const properties = await service.getClassProperties("exo__Asset");

      const prop = properties.find((p) => p.uri === "exo__Asset_createdAt");
      expect(prop?.fieldType).toBe(PropertyFieldType.Timestamp);
    });

    it("should map xsd:integer to Number field", async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_count"],
          ["label", "Count"],
          ["range", "http://www.w3.org/2001/XMLSchema#integer"],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("exo__Asset");

      const prop = properties.find((p) => p.uri === "exo__Asset_count");
      expect(prop?.fieldType).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:boolean to Boolean field", async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_isActive"],
          ["label", "Is Active"],
          ["range", "http://www.w3.org/2001/XMLSchema#boolean"],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("exo__Asset");

      const prop = properties.find((p) => p.uri === "exo__Asset_isActive");
      expect(prop?.fieldType).toBe(PropertyFieldType.Boolean);
    });

    it("should map EffortStatus to StatusSelect field", async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/ems#Effort_status"],
          ["label", "Status"],
          ["range", "https://exocortex.my/ontology/ems#EffortStatus"],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("ems__Effort");

      const prop = properties.find((p) => p.uri === "ems__Effort_status");
      expect(prop?.fieldType).toBe(PropertyFieldType.StatusSelect);
    });

    it("should map TaskSize to SizeSelect field", async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/ems#Effort_taskSize"],
          ["label", "Task Size"],
          ["range", "https://exocortex.my/ontology/ems#TaskSize"],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("ems__Effort");

      const prop = properties.find((p) => p.uri === "ems__Effort_taskSize");
      expect(prop?.fieldType).toBe(PropertyFieldType.SizeSelect);
    });

    it("should map Asset/Task references to Wikilink field", async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_relatedTo"],
          ["label", "Related To"],
          ["range", "https://exocortex.my/ontology/exo#Asset"],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("exo__Asset");

      const prop = properties.find((p) => p.uri === "exo__Asset_relatedTo");
      expect(prop?.fieldType).toBe(PropertyFieldType.Wikilink);
    });

    it("should default to Text field for unknown range types", async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_unknown"],
          ["label", "Unknown"],
          ["range", "http://example.org/UnknownType"],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("exo__Asset");

      const prop = properties.find((p) => p.uri === "exo__Asset_unknown");
      expect(prop?.fieldType).toBe(PropertyFieldType.Text);
    });

    it("should default to Text field when range is null", async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_noRange"],
          ["label", "No Range"],
          ["range", null],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("exo__Asset");

      const prop = properties.find((p) => p.uri === "exo__Asset_noRange");
      expect(prop?.fieldType).toBe(PropertyFieldType.Text);
    });
  });

  describe("label extraction", () => {
    it("should use rdfs:label when available", async () => {
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_someProp"],
          ["label", "Custom Label"],
          ["range", null],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("exo__Asset");

      expect(properties[0].label).toBe("Custom Label");
    });

    it("should extract label from URI when rdfs:label is missing", async () => {
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_myProperty"],
          ["label", null],
          ["range", null],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("exo__Asset");

      // Should extract "My Property" from "Asset_myProperty"
      expect(properties[0].label).toMatch(/property/i);
    });
  });

  describe("IRI conversion", () => {
    it("should handle ems prefix", async () => {
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/ems#Effort_status"],
          ["label", "Status"],
          ["range", null],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("ems__Effort");

      expect(properties[0].uri).toBe("ems__Effort_status");
    });

    it("should handle exo prefix", async () => {
      mockQuery.mockResolvedValueOnce([
        new Map([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["label", "Label"],
          ["range", null],
          ["deprecated", null],
          ["comment", null],
        ]),
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const properties = await service.getClassProperties("exo__Asset");

      expect(properties[0].uri).toBe("exo__Asset_label");
    });
  });
});
