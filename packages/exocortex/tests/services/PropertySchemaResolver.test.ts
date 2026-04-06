import {
  PropertySchemaResolver,
  type ISPARQLQueryable,
  type PropertySchema,
} from "../../src/services/PropertySchemaResolver";
import { PropertyFieldType } from "../../src/domain/types/PropertyFieldType";

describe("PropertySchemaResolver", () => {
  let mockSparqlService: jest.Mocked<ISPARQLQueryable>;
  let resolver: PropertySchemaResolver;

  beforeEach(() => {
    mockSparqlService = {
      query: jest.fn(),
    };
    resolver = new PropertySchemaResolver(mockSparqlService);
  });

  describe("getSchema", () => {
    it("should return schema for a text property", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
          ["description", "Display label for the asset"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_label");

      expect(schema).not.toBeNull();
      expect(schema!.type).toBe(PropertyFieldType.Text);
      expect(schema!.label).toBe("Label");
    });

    it("should return schema for an enum property with options", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "https://exocortex.my/ontology/ems#EffortStatus"],
          ["label", "Status"],
          ["optionValue", "[[ems__EffortStatusBacklog]]"],
          ["optionLabel", "Backlog"],
        ]),
        new Map<string, unknown>([
          ["rangeType", "https://exocortex.my/ontology/ems#EffortStatus"],
          ["label", "Status"],
          ["optionValue", "[[ems__EffortStatusDoing]]"],
          ["optionLabel", "Doing"],
        ]),
        new Map<string, unknown>([
          ["rangeType", "https://exocortex.my/ontology/ems#EffortStatus"],
          ["label", "Status"],
          ["optionValue", "[[ems__EffortStatusDone]]"],
          ["optionLabel", "Done"],
        ]),
      ]);

      const schema = await resolver.getSchema("ems__Effort_status");

      expect(schema).not.toBeNull();
      expect(schema!.type).toBe(PropertyFieldType.StatusSelect);
      expect(schema!.label).toBe("Status");
      expect(schema!.options).toHaveLength(3);
      expect(schema!.options).toEqual([
        { value: "[[ems__EffortStatusBacklog]]", label: "Backlog" },
        { value: "[[ems__EffortStatusDoing]]", label: "Doing" },
        { value: "[[ems__EffortStatusDone]]", label: "Done" },
      ]);
    });

    it("should return null for unknown property", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const schema = await resolver.getSchema("exo__NonExistent_prop");

      expect(schema).toBeNull();
    });

    it("should return null on query error", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("Query failed"));

      const schema = await resolver.getSchema("exo__Asset_label");

      expect(schema).toBeNull();
    });

    it("should cache schema after first load", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
      ]);

      await resolver.getSchema("exo__Asset_label");
      await resolver.getSchema("exo__Asset_label");

      expect(mockSparqlService.query).toHaveBeenCalledTimes(1);
    });

    it("should return cached schema on second call", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#integer"],
          ["label", "Votes"],
        ]),
      ]);

      const first = await resolver.getSchema("ems__Effort_votes");
      const second = await resolver.getSchema("ems__Effort_votes");

      expect(first).toEqual(second);
      expect(first!.type).toBe(PropertyFieldType.Number);
    });

    it("should extract label from property name when not provided", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#dateTime"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_createdAt");

      expect(schema!.label).toBe("Created At");
    });

    it("should map dateTime range to DateTime field type", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#dateTime"],
          ["label", "Created at"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_createdAt");

      expect(schema!.type).toBe(PropertyFieldType.DateTime);
    });

    it("should map boolean range to Boolean field type", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#boolean"],
          ["label", "Archived"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_isArchived");

      expect(schema!.type).toBe(PropertyFieldType.Boolean);
    });

    it("should include validation when present", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#integer"],
          ["label", "Votes"],
          ["required", "true"],
          ["minValue", "0"],
          ["maxValue", "100"],
        ]),
      ]);

      const schema = await resolver.getSchema("ems__Effort_votes");

      expect(schema!.validation).toEqual({
        required: true,
        minValue: 0,
        maxValue: 100,
      });
    });

    it("should not include validation when no constraints present", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_label");

      expect(schema!.validation).toBeUndefined();
    });

    it("should normalize full IRI to prefixed form for cache key", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
      ]);

      await resolver.getSchema("https://exocortex.my/ontology/exo#Asset_label");
      await resolver.getSchema("exo__Asset_label");

      expect(mockSparqlService.query).toHaveBeenCalledTimes(1);
    });

    it("should handle size-select type", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "https://exocortex.my/ontology/ems#TaskSize"],
          ["label", "Size"],
        ]),
      ]);

      const schema = await resolver.getSchema("ems__Task_size");

      expect(schema!.type).toBe(PropertyFieldType.SizeSelect);
    });

    it("should deduplicate options by value", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "https://exocortex.my/ontology/ems#EffortStatus"],
          ["label", "Status"],
          ["optionValue", "Backlog"],
          ["optionLabel", "Backlog"],
        ]),
        new Map<string, unknown>([
          ["rangeType", "https://exocortex.my/ontology/ems#EffortStatus"],
          ["label", "Status"],
          ["optionValue", "Backlog"],
          ["optionLabel", "Backlog Duplicate"],
        ]),
      ]);

      const schema = await resolver.getSchema("ems__Effort_status");

      expect(schema!.options).toHaveLength(1);
      expect(schema!.options![0].label).toBe("Backlog");
    });

    it("should use option value as label when label not provided", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "https://exocortex.my/ontology/ems#EffortStatus"],
          ["label", "Status"],
          ["optionValue", "SomeValue"],
        ]),
      ]);

      const schema = await resolver.getSchema("ems__Effort_status");

      expect(schema!.options![0]).toEqual({ value: "SomeValue", label: "SomeValue" });
    });

    it("should include pattern in validation", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "UID"],
          ["pattern", "^[a-f0-9-]+$"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_uid");

      expect(schema!.validation).toEqual({
        pattern: "^[a-f0-9-]+$",
      });
    });

    it("should include maxLength in validation", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Short Name"],
          ["maxLength", "50"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_shortName");

      expect(schema!.validation).toEqual({
        maxLength: 50,
      });
    });

    it("should default to Text type when rangeType missing", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["label", "Something"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_something");

      expect(schema!.type).toBe(PropertyFieldType.Text);
    });

    it("should set readOnly to true when exo:schema_readOnly is 'true'", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "UID"],
          ["readOnly", "true"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_uid");

      expect(schema!.readOnly).toBe(true);
    });

    it("should not set readOnly when exo:schema_readOnly is 'false'", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
          ["readOnly", "false"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_label");

      expect(schema!.readOnly).toBeUndefined();
    });

    it("should not set readOnly when exo:schema_readOnly is absent", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
      ]);

      const schema = await resolver.getSchema("exo__Asset_label");

      expect(schema!.readOnly).toBeUndefined();
    });

    it("should include readOnly in SPARQL query for single property", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await resolver.getSchema("exo__Asset_uid");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("exo:schema_readOnly"),
      );
    });
  });

  describe("getAllSchemas", () => {
    it("should return all schemas from store", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/ems#Effort_votes"],
          ["rangeType", "http://www.w3.org/2001/XMLSchema#integer"],
          ["label", "Votes"],
        ]),
      ]);

      const schemas = await resolver.getAllSchemas();

      expect(schemas.size).toBe(2);
      expect(schemas.get("exo__Asset_label")!.type).toBe(PropertyFieldType.Text);
      expect(schemas.get("ems__Effort_votes")!.type).toBe(PropertyFieldType.Number);
    });

    it("should cache all schemas after first load", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
      ]);

      await resolver.getAllSchemas();
      await resolver.getAllSchemas();

      expect(mockSparqlService.query).toHaveBeenCalledTimes(1);
    });

    it("should return empty map on query error", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("Query failed"));

      const schemas = await resolver.getAllSchemas();

      expect(schemas.size).toBe(0);
    });

    it("should skip bindings without property URI", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Orphan"],
        ]),
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
      ]);

      const schemas = await resolver.getAllSchemas();

      expect(schemas.size).toBe(1);
      expect(schemas.has("exo__Asset_label")).toBe(true);
    });

    it("should load readOnly flag from bulk query", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_uid"],
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "UID"],
          ["readOnly", "true"],
        ]),
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
      ]);

      const schemas = await resolver.getAllSchemas();

      expect(schemas.get("exo__Asset_uid")!.readOnly).toBe(true);
      expect(schemas.get("exo__Asset_label")!.readOnly).toBeUndefined();
    });

    it("should include readOnly in SPARQL query for all schemas", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await resolver.getAllSchemas();

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("exo:schema_readOnly"),
      );
    });

    it("should populate cache so getSchema uses cached value", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
      ]);

      await resolver.getAllSchemas();
      const schema = await resolver.getSchema("exo__Asset_label");

      expect(mockSparqlService.query).toHaveBeenCalledTimes(1);
      expect(schema!.type).toBe(PropertyFieldType.Text);
    });
  });

  describe("invalidateCache", () => {
    it("should clear cached schemas", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
      ]);

      await resolver.getSchema("exo__Asset_label");
      resolver.invalidateCache();
      await resolver.getSchema("exo__Asset_label");

      expect(mockSparqlService.query).toHaveBeenCalledTimes(2);
    });

    it("should force getAllSchemas to reload", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["property", "https://exocortex.my/ontology/exo#Asset_label"],
          ["rangeType", "http://www.w3.org/2001/XMLSchema#string"],
          ["label", "Label"],
        ]),
      ]);

      await resolver.getAllSchemas();
      resolver.invalidateCache();
      await resolver.getAllSchemas();

      expect(mockSparqlService.query).toHaveBeenCalledTimes(2);
    });
  });

  describe("IRI conversion", () => {
    it("should convert prefixed property name to full IRI in query", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await resolver.getSchema("ems__Effort_status");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/ems#Effort_status>"),
      );
    });

    it("should handle full IRI as input", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await resolver.getSchema("https://exocortex.my/ontology/exo#Asset_label");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/exo#Asset_label>"),
      );
    });

    it("should handle custom namespace prefix", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await resolver.getSchema("custom__MyProperty");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/custom#MyProperty>"),
      );
    });
  });

  describe("with logger", () => {
    it("should log warning on getSchema error", async () => {
      const mockLogger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };
      const loggedResolver = new PropertySchemaResolver(mockSparqlService, mockLogger as any);

      mockSparqlService.query.mockRejectedValue(new Error("Connection lost"));

      await loggedResolver.getSchema("exo__Asset_label");

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load schema"),
        expect.objectContaining({ error: expect.stringContaining("Connection lost") }),
      );
    });

    it("should log warning on getAllSchemas error", async () => {
      const mockLogger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };
      const loggedResolver = new PropertySchemaResolver(mockSparqlService, mockLogger as any);

      mockSparqlService.query.mockRejectedValue(new Error("Connection lost"));

      await loggedResolver.getAllSchemas();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load all schemas"),
        expect.objectContaining({ error: expect.stringContaining("Connection lost") }),
      );
    });
  });
});
