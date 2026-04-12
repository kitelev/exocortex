import { humanizePropertyName } from "../../../src/presentation/components/AssetRelationsTable";

describe("humanizePropertyName", () => {
  describe("prefix stripping", () => {
    it("strips exo__ prefix and humanizes", () => {
      expect(humanizePropertyName("exo__Instance_class")).toBe("Instance Class");
    });

    it("strips ems__ prefix and humanizes multi-word names", () => {
      expect(humanizePropertyName("ems__Effort_status")).toBe("Effort Status");
    });

    it("strips ims__ prefix", () => {
      expect(humanizePropertyName("ims__Concept_broader")).toBe("Concept Broader");
    });

    it("strips ztlk__ prefix", () => {
      expect(humanizePropertyName("ztlk__FleetingNote_body")).toBe("FleetingNote Body");
    });

    it("handles class names (no field suffix)", () => {
      expect(humanizePropertyName("ems__Task")).toBe("Task");
      expect(humanizePropertyName("ems__Area")).toBe("Area");
      expect(humanizePropertyName("ems__Project")).toBe("Project");
    });
  });

  describe("no-prefix passthrough", () => {
    it("passes through human-readable strings unchanged", () => {
      expect(humanizePropertyName("Body Links")).toBe("Body Links");
    });

    it("passes through plain lowercase words unchanged (assumed already friendly)", () => {
      expect(humanizePropertyName("title")).toBe("title");
    });

    it("passes through camelCase custom property names unchanged", () => {
      expect(humanizePropertyName("assignedTo")).toBe("assignedTo");
    });

    it("passes through snake_case without IRI-prefix unchanged", () => {
      expect(humanizePropertyName("created_at")).toBe("created_at");
    });
  });

  describe("UUID guard", () => {
    it("passes through UUIDs unchanged (no humanization garbage)", () => {
      const uuid = "82c74542-1b14-4217-b852-d84730484b25";
      expect(humanizePropertyName(uuid)).toBe(uuid);
    });

    it("passes through uppercase UUIDs", () => {
      const uuid = "82C74542-1B14-4217-B852-D84730484B25";
      expect(humanizePropertyName(uuid)).toBe(uuid);
    });
  });

  describe("edge cases", () => {
    it("returns empty string unchanged", () => {
      expect(humanizePropertyName("")).toBe("");
    });

    it("handles single-word property without underscore", () => {
      expect(humanizePropertyName("exo__Label")).toBe("Label");
    });

    it("preserves alphanumeric class names like ems__EffortStatusBacklog", () => {
      expect(humanizePropertyName("ems__EffortStatusBacklog")).toBe("EffortStatusBacklog");
    });
  });
});
