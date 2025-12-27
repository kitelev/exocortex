import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";
import { OntologySchemaService } from "../../../src/application/services/OntologySchemaService";

// Mock SPARQLQueryService
jest.mock("../../../src/application/services/SPARQLQueryService");

describe("OntologySchemaService", () => {
  let mockSparqlService: jest.Mocked<SPARQLQueryService>;
  let schemaService: OntologySchemaService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSparqlService = {
      query: jest.fn(),
      initialize: jest.fn(),
      refresh: jest.fn(),
      updateFile: jest.fn(),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<SPARQLQueryService>;
    schemaService = new OntologySchemaService(mockSparqlService);
  });

  describe("getClassProperties", () => {
    it("should return empty array when no properties found", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const properties = await schemaService.getClassProperties("ems__Task");

      expect(properties).toEqual([]);
    });

    it("should return properties from SPARQL query", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_label"],
        ["label", "Label"],
        ["range", "http://www.w3.org/2001/XMLSchema#string"],
        ["deprecated", "false"],
        ["comment", "Display label for the asset"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("ems__Task");

      expect(properties).toHaveLength(1);
      expect(properties[0]).toMatchObject({
        uri: "exo__Asset_label",
        label: "Label",
        fieldType: "text",
        deprecated: false,
        description: "Display label for the asset",
      });
    });

    it("should extract label from URI when rdfs:label not available", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/ems#Effort_taskSize"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("ems__Task");

      expect(properties).toHaveLength(1);
      expect(properties[0].label).toBe("Task Size");
    });

    it("should map datetime range to timestamp field type", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_createdAt"],
        ["range", "http://www.w3.org/2001/XMLSchema#dateTime"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].fieldType).toBe("timestamp");
    });

    it("should map integer range to number field type", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/ems#Effort_votes"],
        ["range", "http://www.w3.org/2001/XMLSchema#integer"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("ems__Effort");

      expect(properties[0].fieldType).toBe("number");
    });

    it("should map boolean range to boolean field type", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_isArchived"],
        ["range", "http://www.w3.org/2001/XMLSchema#boolean"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].fieldType).toBe("boolean");
    });

    it("should map EffortStatus range to status-select field type", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/ems#Effort_status"],
        ["range", "https://exocortex.my/ontology/ems#EffortStatus"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("ems__Effort");

      expect(properties[0].fieldType).toBe("status-select");
    });

    it("should map TaskSize range to size-select field type", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/ems#Effort_taskSize"],
        ["range", "https://exocortex.my/ontology/ems#TaskSize"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("ems__Effort");

      expect(properties[0].fieldType).toBe("size-select");
    });

    it("should map Asset reference to wikilink field type", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/ems#Effort_parent"],
        ["range", "https://exocortex.my/ontology/exo#Asset"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("ems__Effort");

      expect(properties[0].fieldType).toBe("wikilink");
    });

    it("should detect deprecated properties", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_oldField"],
        ["deprecated", "true"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].deprecated).toBe(true);
    });

    it("should return empty array on query error", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("Query failed"));

      const properties = await schemaService.getClassProperties("ems__Task");

      expect(properties).toEqual([]);
    });

    it("should sort properties alphabetically by label", async () => {
      const bindings = [
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_zebra"],
          ["label", "Zebra"],
        ]),
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_alpha"],
          ["label", "Alpha"],
        ]),
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_beta"],
          ["label", "Beta"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(bindings);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties.map((p) => p.label)).toEqual(["Alpha", "Beta", "Zebra"]);
    });
  });

  describe("getDefaultProperties", () => {
    it("should return label property for any class", () => {
      const properties = schemaService.getDefaultProperties("exo__Asset");

      expect(properties).toContainEqual(
        expect.objectContaining({
          uri: "exo__Asset_label",
          label: "Label",
          fieldType: "text",
        }),
      );
    });

    it("should return task-specific properties for ems__Task", () => {
      const properties = schemaService.getDefaultProperties("ems__Task");

      expect(properties).toHaveLength(3);
      expect(properties).toContainEqual(
        expect.objectContaining({
          uri: "exo__Asset_label",
          fieldType: "text",
        }),
      );
      expect(properties).toContainEqual(
        expect.objectContaining({
          uri: "ems__Effort_taskSize",
          fieldType: "size-select",
        }),
      );
      expect(properties).toContainEqual(
        expect.objectContaining({
          uri: "ems__Effort_status",
          fieldType: "status-select",
        }),
      );
    });

    it("should return task properties for Task subclasses", () => {
      const properties = schemaService.getDefaultProperties("ems__Task_Custom");

      expect(properties).toHaveLength(3);
      expect(properties).toContainEqual(
        expect.objectContaining({
          uri: "ems__Effort_taskSize",
        }),
      );
    });

    it("should not return task properties for non-Task classes", () => {
      const properties = schemaService.getDefaultProperties("ems__Project");

      expect(properties).toHaveLength(1);
      expect(properties[0].uri).toBe("exo__Asset_label");
    });
  });

  describe("IRI conversion", () => {
    it("should convert class name to full IRI for EMS namespace", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.getClassProperties("ems__Task");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/ems#Task>"),
      );
    });

    it("should convert class name to full IRI for EXO namespace", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.getClassProperties("exo__Asset");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/exo#Asset>"),
      );
    });
  });

  describe("label extraction", () => {
    it("should extract label from property with underscore separator", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_displayName"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].label).toBe("Display Name");
    });

    it("should handle camelCase in property names", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_isArchived"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].label).toBe("Is Archived");
    });
  });

  describe("superclass inheritance", () => {
    it("should include inherited properties from superclasses", async () => {
      // First call returns direct properties
      // Second call returns superclasses
      // Third call returns superclass properties
      mockSparqlService.query
        .mockResolvedValueOnce([
          new Map<string, unknown>([
            ["property", "https://exocortex.my/ontology/ems#Task_directProp"],
            ["label", "Direct Property"],
          ]),
        ])
        .mockResolvedValueOnce([
          new Map<string, unknown>([
            ["superClass", "https://exocortex.my/ontology/exo#Asset"],
          ]),
        ])
        .mockResolvedValueOnce([
          new Map<string, unknown>([
            ["property", "https://exocortex.my/ontology/exo#Asset_label"],
            ["label", "Label"],
          ]),
        ]);

      const properties = await schemaService.getClassProperties("ems__Task");

      expect(properties).toHaveLength(2);
      expect(properties.map((p) => p.uri)).toContain("ems__Task_directProp");
      expect(properties.map((p) => p.uri)).toContain("exo__Asset_label");
    });

    it("should prefer direct properties over inherited with same name", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          new Map<string, unknown>([
            ["property", "https://exocortex.my/ontology/exo#Asset_label"],
            ["label", "Task Label"],
          ]),
        ])
        .mockResolvedValueOnce([
          new Map<string, unknown>([
            ["superClass", "https://exocortex.my/ontology/exo#Asset"],
          ]),
        ])
        .mockResolvedValueOnce([
          new Map<string, unknown>([
            ["property", "https://exocortex.my/ontology/exo#Asset_label"],
            ["label", "Asset Label"],
          ]),
        ]);

      const properties = await schemaService.getClassProperties("ems__Task");

      expect(properties).toHaveLength(1);
      expect(properties[0].label).toBe("Task Label");
    });
  });

  describe("edge cases", () => {
    it("should handle full IRI class name", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.getClassProperties(
        "https://exocortex.my/ontology/ems#Task",
      );

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/ems#Task>"),
      );
    });

    it("should handle custom namespace prefix", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.getClassProperties("custom__MyClass");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/custom#MyClass>"),
      );
    });

    it("should return class name as-is if no prefix pattern matches", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.getClassProperties("SimpleClassName");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("SimpleClassName"),
      );
    });

    it("should handle property IRI with slash separator", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "http://example.org/props/myProperty"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].uri).toBe("myProperty");
    });

    it("should handle property IRI with no separator", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "simpleProperty"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].uri).toBe("simpleProperty");
    });

    it("should skip bindings without property URI", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([["label", "Orphan Label"]]),
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_valid"],
        ]),
      ]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties).toHaveLength(1);
      expect(properties[0].uri).toBe("exo__Asset_valid");
    });

    it("should filter out null superclasses", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([]) // direct properties
        .mockResolvedValueOnce([
          new Map<string, unknown>([["superClass", "http://other.org/Class"]]),
          new Map<string, unknown>([
            ["superClass", "https://exocortex.my/ontology/exo#Asset"],
          ]),
        ])
        .mockResolvedValueOnce([
          new Map<string, unknown>([
            ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ]),
        ]);

      const properties = await schemaService.getClassProperties("ems__Task");

      // Only exo__Asset properties should be included (not http://other.org/Class)
      expect(properties).toHaveLength(1);
    });
  });

  describe("rangeToFieldType additional mappings", () => {
    it("should map xsd:decimal to number", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_amount"],
        ["range", "http://www.w3.org/2001/XMLSchema#decimal"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].fieldType).toBe("number");
    });

    it("should map xsd:float to number", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_rate"],
        ["range", "http://www.w3.org/2001/XMLSchema#float"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].fieldType).toBe("number");
    });

    it("should map xsd:double to number", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_precision"],
        ["range", "http://www.w3.org/2001/XMLSchema#double"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].fieldType).toBe("number");
    });

    it("should map xsd:date to timestamp", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_dueDate"],
        ["range", "http://www.w3.org/2001/XMLSchema#date"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].fieldType).toBe("timestamp");
    });

    it("should map xsd: prefixed types", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_count"],
        ["range", "xsd:integer"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].fieldType).toBe("number");
    });

    it("should map Task reference to wikilink", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/ems#Effort_task"],
        ["range", "https://exocortex.my/ontology/ems#Task"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("ems__Effort");

      expect(properties[0].fieldType).toBe("wikilink");
    });

    it("should map Project reference to wikilink", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/ems#Area_project"],
        ["range", "https://exocortex.my/ontology/ems#Project"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("ems__Area");

      expect(properties[0].fieldType).toBe("wikilink");
    });

    it("should map Area reference to wikilink", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/ems#Project_area"],
        ["range", "https://exocortex.my/ontology/ems#Area"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("ems__Project");

      expect(properties[0].fieldType).toBe("wikilink");
    });

    it("should default to text for unknown range types", async () => {
      const mockBinding = new Map<string, unknown>([
        ["property", "https://exocortex.my/ontology/exo#Asset_custom"],
        ["range", "http://unknown.org/CustomType"],
      ]);

      mockSparqlService.query.mockResolvedValue([mockBinding]);

      const properties = await schemaService.getClassProperties("exo__Asset");

      expect(properties[0].fieldType).toBe("text");
    });
  });

  describe("getClassHierarchy", () => {
    it("should return superclasses for a class", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["superClass", "https://exocortex.my/ontology/ems#Effort"],
        ]),
        new Map<string, unknown>([
          ["superClass", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      const hierarchy = await schemaService.getClassHierarchy("ems__Task");

      expect(hierarchy).toEqual(["ems__Effort", "exo__Asset"]);
    });

    it("should return empty array for class with no superclasses", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const hierarchy = await schemaService.getClassHierarchy("exo__Asset");

      expect(hierarchy).toEqual([]);
    });

    it("should filter out non-matching namespace URIs", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["superClass", "http://www.w3.org/2002/07/owl#Thing"],
        ]),
        new Map<string, unknown>([
          ["superClass", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      const hierarchy = await schemaService.getClassHierarchy("ems__Task");

      // Only exocortex.my namespaces should be included
      expect(hierarchy).toEqual(["exo__Asset"]);
    });

    it("should return empty array on query error", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("Query failed"));

      const hierarchy = await schemaService.getClassHierarchy("ems__Task");

      expect(hierarchy).toEqual([]);
    });

    it("should handle full IRI as class name", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.getClassHierarchy(
        "https://exocortex.my/ontology/ems#Task",
      );

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/ems#Task>"),
      );
    });
  });

  describe("getClassHierarchy error handling (via getClassProperties)", () => {
    it("should return empty array when superclass query fails", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([]) // direct properties
        .mockRejectedValueOnce(new Error("Superclass query failed")); // superclasses

      const properties = await schemaService.getClassProperties("ems__Task");

      expect(properties).toEqual([]);
    });
  });

  describe("isDeprecatedProperty", () => {
    it("should return true for deprecated property", async () => {
      // SELECT query returns binding with deprecated = true
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([["deprecated", { toString: () => "true" }]]),
      ]);

      const isDeprecated =
        await schemaService.isDeprecatedProperty("exo__Asset_oldField");

      expect(isDeprecated).toBe(true);
    });

    it("should return false for non-deprecated property", async () => {
      // No results means no owl:deprecated triple exists
      mockSparqlService.query.mockResolvedValue([]);

      const isDeprecated =
        await schemaService.isDeprecatedProperty("exo__Asset_prototype");

      expect(isDeprecated).toBe(false);
    });

    it("should return false when deprecated value is false", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([["deprecated", { toString: () => "false" }]]),
      ]);

      const isDeprecated =
        await schemaService.isDeprecatedProperty("exo__Asset_active");

      expect(isDeprecated).toBe(false);
    });

    it("should return false on query error", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("Query failed"));

      const isDeprecated =
        await schemaService.isDeprecatedProperty("exo__Asset_test");

      expect(isDeprecated).toBe(false);
    });

    it("should convert prefixed property name to full IRI", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.isDeprecatedProperty("ems__Effort_status");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining(
          "<https://exocortex.my/ontology/ems#Effort_status>",
        ),
      );
    });

    it("should handle full IRI as property name", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.isDeprecatedProperty(
        "https://exocortex.my/ontology/exo#Asset_label",
      );

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining(
          "<https://exocortex.my/ontology/exo#Asset_label>",
        ),
      );
    });

    it("should handle custom namespace prefix", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.isDeprecatedProperty("custom__MyProperty");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining(
          "<https://exocortex.my/ontology/custom#MyProperty>",
        ),
      );
    });

    it("should use SELECT query with LIMIT 1", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.isDeprecatedProperty("exo__Asset_test");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringMatching(/SELECT.*deprecated.*LIMIT 1/s),
      );
    });
  });

  describe("getPropertyRangeClasses", () => {
    it("should return range classes from SPARQL query", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["range", "https://exocortex.my/ontology/ems#Project"],
        ]),
      ]);

      const rangeClasses = await schemaService.getPropertyRangeClasses("ems__Effort_project");

      expect(rangeClasses).toEqual(["ems__Project"]);
    });

    it("should return multiple range classes if defined", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["range", "https://exocortex.my/ontology/ems#Project"],
        ]),
        new Map<string, unknown>([
          ["range", "https://exocortex.my/ontology/ems#Area"],
        ]),
      ]);

      const rangeClasses = await schemaService.getPropertyRangeClasses("ems__Effort_parent");

      expect(rangeClasses).toContain("ems__Project");
      expect(rangeClasses).toContain("ems__Area");
    });

    it("should infer ems__Project from property name containing 'project'", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const rangeClasses = await schemaService.getPropertyRangeClasses("ems__Effort_project");

      expect(rangeClasses).toEqual(["ems__Project"]);
    });

    it("should infer ems__Area from property name containing 'area'", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const rangeClasses = await schemaService.getPropertyRangeClasses("ems__Task_area");

      expect(rangeClasses).toEqual(["ems__Area"]);
    });

    it("should infer ems__Task from property name containing 'task'", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const rangeClasses = await schemaService.getPropertyRangeClasses("ems__Effort_task");

      expect(rangeClasses).toEqual(["ems__Task"]);
    });

    it("should return empty array for 'parent' property (ambiguous)", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const rangeClasses = await schemaService.getPropertyRangeClasses("ems__Effort_parent");

      expect(rangeClasses).toEqual([]);
    });

    it("should return empty array on query error with fallback to inference", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("Query failed"));

      const rangeClasses = await schemaService.getPropertyRangeClasses("ems__Effort_project");

      // Should fallback to inference
      expect(rangeClasses).toEqual(["ems__Project"]);
    });

    it("should convert prefixed property name to full IRI", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.getPropertyRangeClasses("ems__Effort_project");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/ems#Effort_project>"),
      );
    });

    it("should handle full IRI as property name", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await schemaService.getPropertyRangeClasses(
        "https://exocortex.my/ontology/ems#Effort_project",
      );

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/ems#Effort_project>"),
      );
    });

    it("should skip non-exocortex range URIs", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["range", "http://www.w3.org/2001/XMLSchema#string"],
        ]),
        new Map<string, unknown>([
          ["range", "https://exocortex.my/ontology/ems#Project"],
        ]),
      ]);

      const rangeClasses = await schemaService.getPropertyRangeClasses("ems__Effort_mixed");

      // Only exocortex.my range should be returned
      expect(rangeClasses).toEqual(["ems__Project"]);
    });
  });
});
