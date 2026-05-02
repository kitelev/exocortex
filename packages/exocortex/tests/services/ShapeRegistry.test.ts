import { ShapeRegistry, Shape } from "../../src/services/ShapeRegistry";

const makeShape = (propertyIRI: string, overrides?: Partial<Shape>): Shape => ({
  propertyIRI,
  domain: ["https://exocortex.my/ontology/ems#Effort"],
  severity: "sh:Violation",
  ...overrides,
});

describe("ShapeRegistry", () => {
  let registry: ShapeRegistry;

  beforeEach(() => {
    registry = new ShapeRegistry();
  });

  describe("register / get", () => {
    it("registers a shape and retrieves it by propertyIRI", () => {
      const shape = makeShape("https://exocortex.my/ontology/ems#Effort_parent");
      registry.register(shape);
      expect(registry.get("https://exocortex.my/ontology/ems#Effort_parent")).toEqual(shape);
    });

    it("returns undefined for unknown propertyIRI", () => {
      expect(registry.get("https://example.com/unknown")).toBeUndefined();
    });

    it("overwrites shape registered under the same propertyIRI", () => {
      const first = makeShape("https://exocortex.my/ontology/ems#Effort_parent", {
        severity: "sh:Warning",
      });
      const second = makeShape("https://exocortex.my/ontology/ems#Effort_parent", {
        severity: "sh:Violation",
      });
      registry.register(first);
      registry.register(second);
      expect(registry.get("https://exocortex.my/ontology/ems#Effort_parent")!.severity).toBe(
        "sh:Violation",
      );
    });
  });

  describe("getAll", () => {
    it("returns empty array when no shapes registered", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("returns all registered shapes", () => {
      const s1 = makeShape("https://exocortex.my/ontology/ems#Effort_parent");
      const s2 = makeShape("https://exocortex.my/ontology/ems#Effort_status");
      registry.register(s1);
      registry.register(s2);
      expect(registry.getAll()).toHaveLength(2);
      expect(registry.getAll()).toContainEqual(s1);
      expect(registry.getAll()).toContainEqual(s2);
    });
  });

  describe("size", () => {
    it("reflects number of registered shapes", () => {
      expect(registry.size).toBe(0);
      registry.register(makeShape("https://exocortex.my/ontology/ems#Effort_parent"));
      expect(registry.size).toBe(1);
      registry.register(makeShape("https://exocortex.my/ontology/ems#Effort_status"));
      expect(registry.size).toBe(2);
    });

    it("does not grow on duplicate registration", () => {
      registry.register(makeShape("https://exocortex.my/ontology/ems#Effort_parent"));
      registry.register(makeShape("https://exocortex.my/ontology/ems#Effort_parent"));
      expect(registry.size).toBe(1);
    });
  });

  describe("Shape optional fields", () => {
    it("stores range when provided", () => {
      const shape = makeShape("https://exocortex.my/ontology/ems#Effort_parent", {
        range: ["https://exocortex.my/ontology/ems#ParentEffort"],
      });
      registry.register(shape);
      expect(registry.get(shape.propertyIRI)!.range).toEqual([
        "https://exocortex.my/ontology/ems#ParentEffort",
      ]);
    });

    it("stores cardinality Single", () => {
      const shape = makeShape("https://exocortex.my/ontology/ems#Effort_parent", {
        cardinality: "Single",
      });
      registry.register(shape);
      expect(registry.get(shape.propertyIRI)!.cardinality).toBe("Single");
    });

    it("stores cardinality Multiple", () => {
      const shape = makeShape("https://exocortex.my/ontology/ems#Effort_parent", {
        cardinality: "Multiple",
      });
      registry.register(shape);
      expect(registry.get(shape.propertyIRI)!.cardinality).toBe("Multiple");
    });

    it("stores sh:Warning severity", () => {
      const shape = makeShape("https://exocortex.my/ontology/ems#Effort_parent", {
        severity: "sh:Warning",
      });
      registry.register(shape);
      expect(registry.get(shape.propertyIRI)!.severity).toBe("sh:Warning");
    });

    it("stores sh:Info severity", () => {
      const shape = makeShape("https://exocortex.my/ontology/ems#Effort_parent", {
        severity: "sh:Info",
      });
      registry.register(shape);
      expect(registry.get(shape.propertyIRI)!.severity).toBe("sh:Info");
    });

    it("stores message when provided", () => {
      const shape = makeShape("https://exocortex.my/ontology/ems#Effort_parent", {
        message: "must reference ems:ParentEffort",
      });
      registry.register(shape);
      expect(registry.get(shape.propertyIRI)!.message).toBe(
        "must reference ems:ParentEffort",
      );
    });
  });
});
