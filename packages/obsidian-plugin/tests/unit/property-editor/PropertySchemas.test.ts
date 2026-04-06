import {
  EFFORT_STATUS_VALUES,
  TASK_SIZE_VALUES,
  FALLBACK_EFFORT_STATUS_VALUES,
  FALLBACK_TASK_SIZE_VALUES,
  getPropertySchemaForClass,
  getPropertySchemaForClassSync,
  getEditableProperties,
  getPropertyByName,
  getStatusLabel,
  getEffortStatusValues,
  getTaskSizeValues,
  refreshEnumValues,
  initPropertySchemaService,
  initEnumResolver,
  type PropertySchemaDefinition,
} from "../../../src/domain/property-editor/PropertySchemas";
import { PropertySchemaService } from "../../../src/domain/property-editor/PropertySchemaService";
import type { PropertySchemaResolver, PropertySchema, ClassHierarchyResolver, EnumValueResolver, EnumValue } from "exocortex";

function createMockResolver(
  schemas: Map<string, PropertySchema>,
): PropertySchemaResolver {
  return {
    getSchema: jest.fn(async (iri: string) => schemas.get(iri) ?? null),
    getAllSchemas: jest.fn(async () => new Map(schemas)),
    invalidateCache: jest.fn(),
  } as unknown as PropertySchemaResolver;
}

const TEST_HIERARCHY: Record<string, string[]> = {
  ems__Task: ["ems__Task", "ems__Effort", "exo__Asset"],
  ems__Meeting: ["ems__Meeting", "ems__Task", "ems__Effort", "exo__Asset"],
  ems__Project: ["ems__Project", "ems__Effort", "exo__Asset"],
  ems__Initiative: ["ems__Initiative", "ems__Effort", "exo__Asset"],
  ems__Area: ["ems__Area", "exo__Asset"],
  ims__Concept: ["ims__Concept", "exo__Asset"],
};

function createMockHierarchyResolver(): ClassHierarchyResolver {
  return {
    resolve: jest.fn(async (className: string) => {
      return TEST_HIERARCHY[className] ?? [className, "exo__Asset"];
    }),
    invalidateCache: jest.fn(),
  } as unknown as ClassHierarchyResolver;
}

function createMockEnumResolver(
  values: Map<string, EnumValue[]>,
): EnumValueResolver {
  return {
    resolve: jest.fn(async (enumClass: string) => values.get(enumClass) ?? []),
    invalidateCache: jest.fn(),
  } as unknown as EnumValueResolver;
}

function buildTestSchemas(): Map<string, PropertySchema> {
  const schemas = new Map<string, PropertySchema>();

  schemas.set("exo__Asset_label", {
    type: "text" as any,
    label: "Label",
    validation: { required: true },
  });
  schemas.set("exo__Asset_uid", {
    type: "text" as any,
    label: "UID",
    readOnly: true,
    validation: { required: true },
  });
  schemas.set("exo__Asset_createdAt", {
    type: "timestamp" as any,
    label: "Created at",
    readOnly: true,
    validation: { required: true },
  });
  schemas.set("exo__Asset_isArchived", {
    type: "boolean" as any,
    label: "Archived",
  });
  schemas.set("ems__Effort_status", {
    type: "status-select" as any,
    label: "Status",
    validation: { required: true },
  });
  schemas.set("ems__Effort_area", {
    type: "wikilink" as any,
    label: "Area",
  });
  schemas.set("ems__Effort_parent", {
    type: "wikilink" as any,
    label: "Parent",
  });
  schemas.set("ems__Effort_votes", {
    type: "number" as any,
    label: "Votes",
    validation: { minValue: 0 },
  });
  schemas.set("ems__Effort_day", {
    type: "wikilink" as any,
    label: "Planned day",
  });
  schemas.set("ems__Effort_startTimestamp", {
    type: "timestamp" as any,
    label: "Started at",
    readOnly: true,
  });
  schemas.set("ems__Effort_endTimestamp", {
    type: "timestamp" as any,
    label: "Ended at",
    readOnly: true,
  });
  schemas.set("ems__Task_size", {
    type: "size-select" as any,
    label: "Size",
  });
  schemas.set("ems__Area_parent", {
    type: "wikilink" as any,
    label: "Parent area",
  });

  return schemas;
}

describe("PropertySchemas", () => {
  afterEach(() => {
    initEnumResolver(null as unknown as EnumValueResolver);
  });

  describe("FALLBACK_EFFORT_STATUS_VALUES", () => {
    it("should have 7 status values", () => {
      expect(FALLBACK_EFFORT_STATUS_VALUES).toHaveLength(7);
    });

    it("should have all required status values", () => {
      const labels = FALLBACK_EFFORT_STATUS_VALUES.map((s) => s.label);
      expect(labels).toContain("Draft");
      expect(labels).toContain("Backlog");
      expect(labels).toContain("Analysis");
      expect(labels).toContain("To Do");
      expect(labels).toContain("Doing");
      expect(labels).toContain("Done");
      expect(labels).toContain("Trashed");
    });

    it("should have wikilink format values", () => {
      for (const status of FALLBACK_EFFORT_STATUS_VALUES) {
        expect(status.value).toMatch(/^\[\[ems__EffortStatus\w+\]\]$/);
      }
    });
  });

  describe("FALLBACK_TASK_SIZE_VALUES", () => {
    it("should have 6 size values", () => {
      expect(FALLBACK_TASK_SIZE_VALUES).toHaveLength(6);
    });

    it("should have all size values in order", () => {
      const labels = FALLBACK_TASK_SIZE_VALUES.map((s) => s.label);
      expect(labels).toEqual(["XXS", "XS", "S", "M", "L", "XL"]);
    });

    it("should have wikilink format values", () => {
      for (const size of FALLBACK_TASK_SIZE_VALUES) {
        expect(size.value).toMatch(/^\[\[ems__TaskSize_\w+\]\]$/);
      }
    });
  });

  describe("EFFORT_STATUS_VALUES (mutable, initially equals fallback)", () => {
    it("should initially contain fallback values", () => {
      expect(EFFORT_STATUS_VALUES).toHaveLength(7);
      expect(EFFORT_STATUS_VALUES.map((s) => s.label)).toContain("Doing");
    });
  });

  describe("TASK_SIZE_VALUES (mutable, initially equals fallback)", () => {
    it("should initially contain fallback values", () => {
      expect(TASK_SIZE_VALUES).toHaveLength(6);
      expect(TASK_SIZE_VALUES.map((s) => s.label)).toContain("M");
    });
  });

  describe("getEffortStatusValues (async)", () => {
    it("should return fallback when no enum resolver is set", async () => {
      const values = await getEffortStatusValues();
      expect(values).toEqual(FALLBACK_EFFORT_STATUS_VALUES);
    });

    it("should return resolved values when enum resolver returns data", async () => {
      const resolved: EnumValue[] = [
        { value: "[[ems__EffortStatusNew]]", label: "New" },
        { value: "[[ems__EffortStatusActive]]", label: "Active" },
      ];
      const enumValues = new Map<string, EnumValue[]>();
      enumValues.set("ems__EffortStatus", resolved);
      initEnumResolver(createMockEnumResolver(enumValues));

      const values = await getEffortStatusValues();

      expect(values).toHaveLength(2);
      expect(values[0].label).toBe("New");
      expect(values[0].value).toBe("[[ems__EffortStatusNew]]");
      expect(values[0].wikilink).toBe("[[ems__EffortStatusNew|New]]");
      expect(values[1].label).toBe("Active");
    });

    it("should return fallback when enum resolver returns empty", async () => {
      const enumValues = new Map<string, EnumValue[]>();
      initEnumResolver(createMockEnumResolver(enumValues));

      const values = await getEffortStatusValues();

      expect(values).toEqual(FALLBACK_EFFORT_STATUS_VALUES);
    });
  });

  describe("getTaskSizeValues (async)", () => {
    it("should return fallback when no enum resolver is set", async () => {
      const values = await getTaskSizeValues();
      expect(values).toEqual(FALLBACK_TASK_SIZE_VALUES);
    });

    it("should return resolved values when enum resolver returns data", async () => {
      const resolved: EnumValue[] = [
        { value: "[[ems__TaskSize_Tiny]]", label: "Tiny" },
        { value: "[[ems__TaskSize_Huge]]", label: "Huge" },
      ];
      const enumValues = new Map<string, EnumValue[]>();
      enumValues.set("ems__TaskSize", resolved);
      initEnumResolver(createMockEnumResolver(enumValues));

      const values = await getTaskSizeValues();

      expect(values).toHaveLength(2);
      expect(values[0].label).toBe("Tiny");
      expect(values[1].label).toBe("Huge");
    });

    it("should return fallback when enum resolver returns empty", async () => {
      const enumValues = new Map<string, EnumValue[]>();
      initEnumResolver(createMockEnumResolver(enumValues));

      const values = await getTaskSizeValues();

      expect(values).toEqual(FALLBACK_TASK_SIZE_VALUES);
    });
  });

  describe("refreshEnumValues", () => {
    it("should do nothing when no enum resolver is set", async () => {
      await refreshEnumValues();
      expect(EFFORT_STATUS_VALUES).toHaveLength(7);
      expect(TASK_SIZE_VALUES).toHaveLength(6);
    });

    it("should update mutable arrays when resolver returns data", async () => {
      const statusValues: EnumValue[] = [
        { value: "[[ems__EffortStatusNew]]", label: "New" },
      ];
      const sizeValues: EnumValue[] = [
        { value: "[[ems__TaskSize_Tiny]]", label: "Tiny" },
      ];
      const enumValues = new Map<string, EnumValue[]>();
      enumValues.set("ems__EffortStatus", statusValues);
      enumValues.set("ems__TaskSize", sizeValues);
      initEnumResolver(createMockEnumResolver(enumValues));

      await refreshEnumValues();

      expect(EFFORT_STATUS_VALUES).toHaveLength(1);
      expect(EFFORT_STATUS_VALUES[0].label).toBe("New");
      expect(TASK_SIZE_VALUES).toHaveLength(1);
      expect(TASK_SIZE_VALUES[0].label).toBe("Tiny");
    });

    it("should reset to fallback when resolver returns empty", async () => {
      const enumValues = new Map<string, EnumValue[]>();
      initEnumResolver(createMockEnumResolver(enumValues));

      await refreshEnumValues();

      expect(EFFORT_STATUS_VALUES).toEqual(FALLBACK_EFFORT_STATUS_VALUES);
      expect(TASK_SIZE_VALUES).toEqual(FALLBACK_TASK_SIZE_VALUES);
    });
  });

  describe("getPropertySchemaForClass (async with resolver)", () => {
    beforeEach(() => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      const hierarchyResolver = createMockHierarchyResolver();
      initPropertySchemaService(resolver, hierarchyResolver);
    });

    it("should return schema for known class (ems__Task)", async () => {
      const schema = await getPropertySchemaForClass("ems__Task");
      expect(schema.length).toBeGreaterThan(0);
      expect(schema.some((p) => p.name === "exo__Asset_label")).toBe(true);
      expect(schema.some((p) => p.name === "ems__Effort_status")).toBe(true);
      expect(schema.some((p) => p.name === "ems__Task_size")).toBe(true);
    });

    it("should strip wikilink brackets from class name", async () => {
      const schema = await getPropertySchemaForClass("[[ems__Task]]");
      expect(schema.some((p) => p.name === "exo__Asset_label")).toBe(true);
      expect(schema.some((p) => p.name === "ems__Task_size")).toBe(true);
    });

    it("should return fallback properties for unknown class when resolver has no matching properties", async () => {
      const emptyResolver = createMockResolver(new Map());
      initPropertySchemaService(emptyResolver);
      const schema = await getPropertySchemaForClass("unknown__Class");
      expect(schema.length).toBe(4);
      expect(schema.some((p) => p.name === "exo__Asset_label")).toBe(true);
      expect(schema.some((p) => p.name === "exo__Asset_uid")).toBe(true);
    });

    it("should return schema for Area class without Effort properties", async () => {
      const schema = await getPropertySchemaForClass("ems__Area");
      expect(schema.some((p) => p.name === "ems__Area_parent")).toBe(true);
      expect(schema.some((p) => p.name === "ems__Effort_status")).toBe(false);
    });

    it("should return schema for Concept class with only Asset properties", async () => {
      const schema = await getPropertySchemaForClass("ims__Concept");
      expect(schema.some((p) => p.name === "exo__Asset_label")).toBe(true);
      expect(schema.some((p) => p.name === "ems__Effort_status")).toBe(false);
    });

    it("should have effort properties in effort-based classes", async () => {
      const effortClasses = ["ems__Task", "ems__Meeting", "ems__Project", "ems__Initiative"];
      const effortProperties = ["ems__Effort_status", "ems__Effort_area", "ems__Effort_parent", "ems__Effort_votes"];

      for (const className of effortClasses) {
        const schema = await getPropertySchemaForClass(className);
        for (const propName of effortProperties) {
          const prop = schema.find((p) => p.name === propName);
          expect(prop).toBeDefined();
        }
      }
    });

    it("should have task-specific properties only for tasks and meetings", async () => {
      const taskClasses = ["ems__Task", "ems__Meeting"];

      for (const className of taskClasses) {
        const schema = await getPropertySchemaForClass(className);
        const prop = schema.find((p) => p.name === "ems__Task_size");
        expect(prop).toBeDefined();
      }

      const nonTaskClasses = ["ems__Project", "ems__Initiative", "ems__Area", "ims__Concept"];
      for (const className of nonTaskClasses) {
        const schema = await getPropertySchemaForClass(className);
        const prop = schema.find((p) => p.name === "ems__Task_size");
        expect(prop).toBeUndefined();
      }
    });
  });

  describe("getPropertySchemaForClassSync", () => {
    it("should return fallback properties", () => {
      const schema = getPropertySchemaForClassSync("ems__Task");
      expect(schema.length).toBe(4);
      expect(schema.some((p) => p.name === "exo__Asset_label")).toBe(true);
    });
  });

  describe("getEditableProperties", () => {
    it("should filter out read-only properties", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());

      const schema = await getPropertySchemaForClass("ems__Task");
      const editable = getEditableProperties(schema);
      const readOnlyProps = editable.filter((p) => p.readOnly === true);
      expect(readOnlyProps).toHaveLength(0);
    });

    it("should not include uid property", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());

      const schema = await getPropertySchemaForClass("ems__Task");
      const editable = getEditableProperties(schema);
      expect(editable.some((p) => p.name === "exo__Asset_uid")).toBe(false);
    });

    it("should not include createdAt property", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());

      const schema = await getPropertySchemaForClass("ems__Task");
      const editable = getEditableProperties(schema);
      expect(editable.some((p) => p.name === "exo__Asset_createdAt")).toBe(false);
    });

    it("should not include timestamp properties", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());

      const schema = await getPropertySchemaForClass("ems__Task");
      const editable = getEditableProperties(schema);
      expect(editable.some((p) => p.name === "ems__Effort_startTimestamp")).toBe(false);
      expect(editable.some((p) => p.name === "ems__Effort_endTimestamp")).toBe(false);
    });

    it("should propagate readOnly from core schema, not hardcoded list", async () => {
      const schemas = buildTestSchemas();
      schemas.set("ems__Effort_day", {
        type: "wikilink" as any,
        label: "Planned day",
        readOnly: true,
      });
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());

      const schema = await getPropertySchemaForClass("ems__Task");
      const day = schema.find((p) => p.name === "ems__Effort_day");
      expect(day?.readOnly).toBe(true);
    });

    it("should not mark property as readOnly when core schema has no readOnly flag", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());

      const schema = await getPropertySchemaForClass("ems__Task");
      const status = schema.find((p) => p.name === "ems__Effort_status");
      expect(status?.readOnly).toBeUndefined();
    });

    it("should include editable properties", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());

      const schema = await getPropertySchemaForClass("ems__Task");
      const editable = getEditableProperties(schema);
      expect(editable.some((p) => p.name === "exo__Asset_label")).toBe(true);
      expect(editable.some((p) => p.name === "ems__Effort_status")).toBe(true);
      expect(editable.some((p) => p.name === "exo__Asset_isArchived")).toBe(true);
    });
  });

  describe("getPropertyByName", () => {
    let taskSchema: PropertySchemaDefinition[];

    beforeEach(async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());
      taskSchema = await getPropertySchemaForClass("ems__Task");
    });

    it("should find property by name", () => {
      const prop = getPropertyByName(taskSchema, "exo__Asset_label");
      expect(prop).toBeDefined();
      expect(prop?.label).toBe("Label");
      expect(prop?.type).toBe("text");
      expect(prop?.required).toBe(true);
    });

    it("should return undefined for non-existent property", () => {
      const prop = getPropertyByName(taskSchema, "non_existent_property");
      expect(prop).toBeUndefined();
    });

    it("should find effort status property", () => {
      const prop = getPropertyByName(taskSchema, "ems__Effort_status");
      expect(prop).toBeDefined();
      expect(prop?.type).toBe("status-select");
    });

    it("should find task size property", () => {
      const prop = getPropertyByName(taskSchema, "ems__Task_size");
      expect(prop).toBeDefined();
      expect(prop?.type).toBe("size-select");
    });

    it("should not find task-specific property in area schema", async () => {
      const areaSchema = await getPropertySchemaForClass("ems__Area");
      const prop = getPropertyByName(areaSchema, "ems__Task_size");
      expect(prop).toBeUndefined();
    });
  });

  describe("property schema structure", () => {
    it("should have valid field types from resolver", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());

      const validTypes = ["text", "status-select", "size-select", "wikilink", "number", "boolean", "timestamp"];
      const schema = await getPropertySchemaForClass("ems__Task");
      for (const prop of schema) {
        expect(validTypes).toContain(prop.type);
      }
    });

    it("should have labels for all properties", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());

      const schema = await getPropertySchemaForClass("ems__Task");
      for (const prop of schema) {
        expect(prop.label).toBeDefined();
        expect(prop.label.length).toBeGreaterThan(0);
      }
    });

    it("should have min value for votes property", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      initPropertySchemaService(resolver, createMockHierarchyResolver());

      const schema = await getPropertySchemaForClass("ems__Task");
      const votesProperty = getPropertyByName(schema, "ems__Effort_votes");
      expect(votesProperty?.type).toBe("number");
      expect(votesProperty?.min).toBe(0);
    });
  });

  describe("PropertySchemaService", () => {
    it("should convert core PropertySchema to PropertySchemaDefinition", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      const service = new PropertySchemaService(resolver);

      const result = await service.getSchema("exo__Asset_label");
      expect(result).toBeDefined();
      expect(result?.name).toBe("exo__Asset_label");
      expect(result?.type).toBe("text");
      expect(result?.label).toBe("Label");
      expect(result?.required).toBe(true);
    });

    it("should return null for unknown property", async () => {
      const resolver = createMockResolver(new Map());
      const service = new PropertySchemaService(resolver);

      const result = await service.getSchema("unknown__Property");
      expect(result).toBeNull();
    });

    it("should mark read-only properties correctly", async () => {
      const schemas = buildTestSchemas();
      const resolver = createMockResolver(schemas);
      const service = new PropertySchemaService(resolver, createMockHierarchyResolver());

      const taskSchema = await service.getPropertySchemaForClass("ems__Task");
      const uid = taskSchema.find((p) => p.name === "exo__Asset_uid");
      expect(uid?.readOnly).toBe(true);

      const startTs = taskSchema.find((p) => p.name === "ems__Effort_startTimestamp");
      expect(startTs?.readOnly).toBe(true);
    });

    it("should return empty array when resolver returns no schemas", async () => {
      const resolver = createMockResolver(new Map());
      const service = new PropertySchemaService(resolver);

      const result = await service.getPropertySchemaForClass("ems__Task");
      expect(result).toEqual([]);
    });
  });

  describe("getStatusLabel", () => {
    it("should return human-readable label for raw URI", () => {
      expect(getStatusLabel("ems__EffortStatusDoing")).toBe("Doing");
      expect(getStatusLabel("ems__EffortStatusDone")).toBe("Done");
      expect(getStatusLabel("ems__EffortStatusTrashed")).toBe("Trashed");
      expect(getStatusLabel("ems__EffortStatusDraft")).toBe("Draft");
      expect(getStatusLabel("ems__EffortStatusBacklog")).toBe("Backlog");
      expect(getStatusLabel("ems__EffortStatusAnalysis")).toBe("Analysis");
      expect(getStatusLabel("ems__EffortStatusToDo")).toBe("To Do");
    });

    it("should return human-readable label for wiki-link wrapped URI", () => {
      expect(getStatusLabel("[[ems__EffortStatusDoing]]")).toBe("Doing");
      expect(getStatusLabel("[[ems__EffortStatusDone]]")).toBe("Done");
      expect(getStatusLabel("[[ems__EffortStatusToDo]]")).toBe("To Do");
    });

    it("should return the label as-is if already human-readable", () => {
      expect(getStatusLabel("Doing")).toBe("Doing");
      expect(getStatusLabel("Done")).toBe("Done");
      expect(getStatusLabel("To Do")).toBe("To Do");
    });

    it("should handle case-insensitive label matching", () => {
      expect(getStatusLabel("doing")).toBe("Doing");
      expect(getStatusLabel("DONE")).toBe("Done");
      expect(getStatusLabel("to do")).toBe("To Do");
    });

    it("should return dash for null or undefined", () => {
      expect(getStatusLabel(null)).toBe("-");
      expect(getStatusLabel(undefined)).toBe("-");
    });

    it("should return dash for empty string", () => {
      expect(getStatusLabel("")).toBe("-");
    });

    it("should return original value for unknown status", () => {
      expect(getStatusLabel("unknown_status")).toBe("unknown_status");
      expect(getStatusLabel("CustomStatus")).toBe("CustomStatus");
    });
  });
});
