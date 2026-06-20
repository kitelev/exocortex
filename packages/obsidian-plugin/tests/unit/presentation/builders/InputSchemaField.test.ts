import type {
  InputSchemaField,
  EnumOption,
} from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";

describe("InputSchemaField type definitions", () => {
  describe("type union", () => {
    it("should accept text type", () => {
      const field: InputSchemaField = { name: "title", type: "text" };
      expect(field.type).toBe("text");
    });

    it("should accept date type", () => {
      const field: InputSchemaField = { name: "dueDate", type: "date" };
      expect(field.type).toBe("date");
    });

    // T3 «Create Instance» — number/boolean for required-property datatype ranges.
    it("should accept number type", () => {
      const field: InputSchemaField = { name: "count", type: "number" };
      expect(field.type).toBe("number");
    });

    it("should accept boolean type", () => {
      const field: InputSchemaField = { name: "flag", type: "boolean" };
      expect(field.type).toBe("boolean");
    });

    it("should accept enum type", () => {
      const field: InputSchemaField = { name: "status", type: "enum" };
      expect(field.type).toBe("enum");
    });

    it("should accept multiline type", () => {
      const field: InputSchemaField = { name: "description", type: "multiline" };
      expect(field.type).toBe("multiline");
    });

    it("should accept assetRef type", () => {
      const field: InputSchemaField = { name: "parent", type: "assetRef" };
      expect(field.type).toBe("assetRef");
    });
  });

  describe("common optional fields", () => {
    it("should allow label override", () => {
      const field: InputSchemaField = {
        name: "myField",
        type: "text",
        label: "My custom label",
      };
      expect(field.label).toBe("My custom label");
    });

    it("should allow required flag", () => {
      const field: InputSchemaField = {
        name: "myField",
        type: "text",
        required: true,
      };
      expect(field.required).toBe(true);
    });

    it("should allow defaultValue", () => {
      const field: InputSchemaField = {
        name: "myField",
        type: "text",
        defaultValue: "hello",
      };
      expect(field.defaultValue).toBe("hello");
    });
  });

  describe("enum-specific fields", () => {
    it("should accept simple string options", () => {
      const field: InputSchemaField = {
        name: "priority",
        type: "enum",
        options: ["low", "medium", "high"],
      };
      expect(field.options).toHaveLength(3);
    });

    it("should accept value/label option pairs", () => {
      const options: EnumOption[] = [
        { value: "low", label: "Low priority" },
        { value: "high", label: "High priority" },
      ];
      const field: InputSchemaField = {
        name: "priority",
        type: "enum",
        options,
      };
      expect(field.options).toHaveLength(2);
      expect((field.options![0] as EnumOption).label).toBe("Low priority");
    });

    it("should accept mixed string and object options", () => {
      const field: InputSchemaField = {
        name: "status",
        type: "enum",
        options: [
          "active",
          { value: "archived", label: "Archived (hidden)" },
        ],
      };
      expect(field.options).toHaveLength(2);
    });

    it("should accept sparqlQuery for dynamic options", () => {
      const field: InputSchemaField = {
        name: "project",
        type: "enum",
        sparqlQuery: "SELECT ?value ?label WHERE { ?s a ems:Project ; rdfs:label ?label . BIND(STR(?s) AS ?value) }",
      };
      expect(field.sparqlQuery).toBeDefined();
    });
  });

  describe("multiline-specific fields", () => {
    it("should accept rows count", () => {
      const field: InputSchemaField = {
        name: "notes",
        type: "multiline",
        rows: 8,
      };
      expect(field.rows).toBe(8);
    });

    it("should default rows to undefined when not specified", () => {
      const field: InputSchemaField = {
        name: "notes",
        type: "multiline",
      };
      expect(field.rows).toBeUndefined();
    });
  });

  describe("assetRef-specific fields", () => {
    it("should accept filterQuery for candidate assets", () => {
      const field: InputSchemaField = {
        name: "parentProject",
        type: "assetRef",
        filterQuery: "SELECT ?asset WHERE { ?asset a ems:Project }",
      };
      expect(field.filterQuery).toBeDefined();
    });

    it("should work without filterQuery", () => {
      const field: InputSchemaField = {
        name: "relatedAsset",
        type: "assetRef",
      };
      expect(field.filterQuery).toBeUndefined();
    });
  });

  describe("date-specific behavior", () => {
    it("should accept ISO date as defaultValue", () => {
      const field: InputSchemaField = {
        name: "startDate",
        type: "date",
        defaultValue: "2026-04-05",
      };
      expect(field.defaultValue).toBe("2026-04-05");
    });
  });

  describe("extractInputSchema type guard (via structure)", () => {
    function isValidField(raw: unknown): raw is InputSchemaField {
      return (
        typeof raw === "object" &&
        raw !== null &&
        typeof (raw as Record<string, unknown>)["name"] === "string" &&
        typeof (raw as Record<string, unknown>)["type"] === "string"
      );
    }

    it("should accept valid text field", () => {
      expect(isValidField({ name: "x", type: "text" })).toBe(true);
    });

    it("should accept valid date field", () => {
      expect(isValidField({ name: "d", type: "date" })).toBe(true);
    });

    it("should accept valid enum field with options", () => {
      expect(
        isValidField({ name: "e", type: "enum", options: ["a", "b"] }),
      ).toBe(true);
    });

    it("should accept valid multiline field with rows", () => {
      expect(
        isValidField({ name: "m", type: "multiline", rows: 6 }),
      ).toBe(true);
    });

    it("should accept valid assetRef field with filterQuery", () => {
      expect(
        isValidField({
          name: "r",
          type: "assetRef",
          filterQuery: "SELECT ?x WHERE { ?x a ems:Task }",
        }),
      ).toBe(true);
    });

    it("should reject null", () => {
      expect(isValidField(null)).toBe(false);
    });

    it("should reject missing name", () => {
      expect(isValidField({ type: "text" })).toBe(false);
    });

    it("should reject missing type", () => {
      expect(isValidField({ name: "x" })).toBe(false);
    });

    it("should reject non-string type", () => {
      expect(isValidField({ name: "x", type: 42 })).toBe(false);
    });

    it("should reject primitive values", () => {
      expect(isValidField("not a field")).toBe(false);
      expect(isValidField(123)).toBe(false);
      expect(isValidField(undefined)).toBe(false);
    });
  });
});
