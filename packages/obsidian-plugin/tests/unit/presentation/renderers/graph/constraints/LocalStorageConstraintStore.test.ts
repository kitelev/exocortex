/**
 * LocalStorageConstraintStore Tests
 *
 * Tests for the browser localStorage persistence of layout constraints.
 */

import {
  LocalStorageConstraintStore,
  createLocalStorageConstraintStore,
} from "../../../../../../src/presentation/renderers/graph/constraints/LocalStorageConstraintStore";
import type {
  LayoutConstraint,
  PinConstraint,
  AlignmentConstraint,
  GroupConstraint,
  DistanceConstraint,
  RegionConstraint,
  OrderConstraint,
} from "../../../../../../src/presentation/renderers/graph/constraints/constraint.types";

// ============================================================
// Test Utilities
// ============================================================

/**
 * Mock localStorage for testing
 */
function createMockLocalStorage(): Storage {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      store = {};
    },
    get length(): number {
      return Object.keys(store).length;
    },
    key: (index: number): string | null => {
      const keys = Object.keys(store);
      return keys[index] ?? null;
    },
  };
}

/**
 * Create test constraints
 */
function createTestConstraints(): LayoutConstraint[] {
  const pin: PinConstraint = {
    id: "pin-1",
    type: "pin",
    enabled: true,
    priority: "high",
    nodeId: "node1",
    position: { x: 100, y: 100 },
    strength: 1.0,
  };

  const alignment: AlignmentConstraint = {
    id: "align-1",
    type: "alignment",
    enabled: true,
    priority: "medium",
    axis: "horizontal",
    nodeIds: ["node1", "node2", "node3"],
    alignmentMethod: "average",
  };

  const group: GroupConstraint = {
    id: "group-1",
    type: "group",
    enabled: true,
    priority: "medium",
    nodeIds: ["node4", "node5"],
    padding: 20,
    minDistance: 30,
    label: "Test Group",
    color: "#ff0000",
  };

  const distance: DistanceConstraint = {
    id: "distance-1",
    type: "distance",
    enabled: true,
    priority: "low",
    node1: "node1",
    node2: "node2",
    minDistance: 50,
    maxDistance: 100,
  };

  const region: RegionConstraint = {
    id: "region-1",
    type: "region",
    enabled: false,
    priority: "high",
    nodeId: "node3",
    region: { x: 0, y: 0, width: 200, height: 200 },
  };

  const order: OrderConstraint = {
    id: "order-1",
    type: "order",
    enabled: true,
    priority: "medium",
    axis: "x",
    nodeIds: ["node1", "node2", "node3"],
    minSpacing: 25,
  };

  return [pin, alignment, group, distance, region, order];
}

// ============================================================
// Tests
// ============================================================

describe("LocalStorageConstraintStore", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createMockLocalStorage();
  });

  describe("construction", () => {
    it("should create with default prefix", () => {
      const store = new LocalStorageConstraintStore(undefined, mockStorage);
      expect(store).toBeDefined();
    });

    it("should create with custom prefix", () => {
      const store = new LocalStorageConstraintStore("custom-prefix-", mockStorage);
      expect(store).toBeDefined();
    });

    it("should create using factory function", () => {
      const store = createLocalStorageConstraintStore("custom-", mockStorage);
      expect(store).toBeDefined();
    });
  });

  describe("save", () => {
    it("should save constraints to localStorage", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);
      const constraints = createTestConstraints();

      await store.save("graph-123", constraints);

      const stored = mockStorage.getItem("test-graph-123");
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.version).toBe(1);
      expect(parsed.constraints).toHaveLength(6);
    });

    it("should save empty array", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);

      await store.save("graph-empty", []);

      const stored = mockStorage.getItem("test-graph-empty");
      const parsed = JSON.parse(stored!);
      expect(parsed.constraints).toHaveLength(0);
    });

    it("should overwrite existing data", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);
      const constraints1 = createTestConstraints().slice(0, 2);
      const constraints2 = createTestConstraints().slice(2, 4);

      await store.save("graph-123", constraints1);
      await store.save("graph-123", constraints2);

      const constraints = await store.load("graph-123");
      expect(constraints).toHaveLength(2);
    });
  });

  describe("load", () => {
    it("should load saved constraints", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);
      const original = createTestConstraints();

      await store.save("graph-123", original);
      const loaded = await store.load("graph-123");

      expect(loaded).toHaveLength(6);
    });

    it("should return empty array for non-existent graph", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);

      const loaded = await store.load("non-existent");

      expect(loaded).toHaveLength(0);
    });

    it("should correctly deserialize pin constraints", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);
      const pin: PinConstraint = {
        id: "pin-1",
        type: "pin",
        enabled: true,
        priority: "high",
        nodeId: "node1",
        position: { x: 100, y: 200 },
        strength: 0.8,
      };

      await store.save("graph-pin", [pin]);
      const [loaded] = await store.load("graph-pin") as PinConstraint[];

      expect(loaded.type).toBe("pin");
      expect(loaded.nodeId).toBe("node1");
      expect(loaded.position).toEqual({ x: 100, y: 200 });
      expect(loaded.strength).toBe(0.8);
      expect(loaded.enabled).toBe(true);
      expect(loaded.priority).toBe("high");
    });

    it("should correctly deserialize alignment constraints", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);
      const alignment: AlignmentConstraint = {
        id: "align-1",
        type: "alignment",
        enabled: true,
        priority: "medium",
        axis: "vertical",
        nodeIds: ["a", "b", "c"],
        referencePosition: 150,
        alignmentMethod: "first",
      };

      await store.save("graph-align", [alignment]);
      const [loaded] = await store.load("graph-align") as AlignmentConstraint[];

      expect(loaded.type).toBe("alignment");
      expect(loaded.axis).toBe("vertical");
      expect(loaded.nodeIds).toEqual(["a", "b", "c"]);
      expect(loaded.referencePosition).toBe(150);
      expect(loaded.alignmentMethod).toBe("first");
    });

    it("should correctly deserialize group constraints", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);
      const group: GroupConstraint = {
        id: "group-1",
        type: "group",
        enabled: true,
        priority: "low",
        nodeIds: ["x", "y"],
        padding: 15,
        minDistance: 25,
        maxDistance: 100,
        boundingBox: { x: 10, y: 20, width: 300, height: 400 },
        label: "My Group",
        color: "#00ff00",
      };

      await store.save("graph-group", [group]);
      const [loaded] = await store.load("graph-group") as GroupConstraint[];

      expect(loaded.type).toBe("group");
      expect(loaded.nodeIds).toEqual(["x", "y"]);
      expect(loaded.padding).toBe(15);
      expect(loaded.minDistance).toBe(25);
      expect(loaded.maxDistance).toBe(100);
      expect(loaded.boundingBox).toEqual({ x: 10, y: 20, width: 300, height: 400 });
      expect(loaded.label).toBe("My Group");
      expect(loaded.color).toBe("#00ff00");
    });

    it("should correctly deserialize distance constraints", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);
      const distance: DistanceConstraint = {
        id: "dist-1",
        type: "distance",
        enabled: false,
        priority: "critical",
        node1: "nodeA",
        node2: "nodeB",
        exactDistance: 75,
      };

      await store.save("graph-dist", [distance]);
      const [loaded] = await store.load("graph-dist") as DistanceConstraint[];

      expect(loaded.type).toBe("distance");
      expect(loaded.node1).toBe("nodeA");
      expect(loaded.node2).toBe("nodeB");
      expect(loaded.exactDistance).toBe(75);
      expect(loaded.enabled).toBe(false);
      expect(loaded.priority).toBe("critical");
    });

    it("should correctly deserialize region constraints", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);
      const region: RegionConstraint = {
        id: "region-1",
        type: "region",
        enabled: true,
        priority: "medium",
        nodeId: "nodeX",
        region: { x: 50, y: 60, width: 500, height: 600 },
      };

      await store.save("graph-region", [region]);
      const [loaded] = await store.load("graph-region") as RegionConstraint[];

      expect(loaded.type).toBe("region");
      expect(loaded.nodeId).toBe("nodeX");
      expect(loaded.region).toEqual({ x: 50, y: 60, width: 500, height: 600 });
    });

    it("should correctly deserialize order constraints", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);
      const order: OrderConstraint = {
        id: "order-1",
        type: "order",
        enabled: true,
        priority: "high",
        axis: "y",
        nodeIds: ["1", "2", "3", "4"],
        minSpacing: 40,
      };

      await store.save("graph-order", [order]);
      const [loaded] = await store.load("graph-order") as OrderConstraint[];

      expect(loaded.type).toBe("order");
      expect(loaded.axis).toBe("y");
      expect(loaded.nodeIds).toEqual(["1", "2", "3", "4"]);
      expect(loaded.minSpacing).toBe(40);
    });

    it("should handle corrupted data gracefully", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);

      mockStorage.setItem("test-graph-corrupted", "invalid json {{{");

      const loaded = await store.load("graph-corrupted");
      expect(loaded).toHaveLength(0);
    });
  });

  describe("delete", () => {
    it("should delete stored constraints", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);
      const constraints = createTestConstraints();

      await store.save("graph-123", constraints);
      expect(await store.exists("graph-123")).toBe(true);

      await store.delete("graph-123");
      expect(await store.exists("graph-123")).toBe(false);
    });

    it("should not throw when deleting non-existent graph", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);

      await expect(store.delete("non-existent")).resolves.not.toThrow();
    });
  });

  describe("exists", () => {
    it("should return true for existing graph", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);

      await store.save("graph-123", []);

      expect(await store.exists("graph-123")).toBe(true);
    });

    it("should return false for non-existent graph", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);

      expect(await store.exists("non-existent")).toBe(false);
    });
  });

  describe("getAllGraphIds", () => {
    it("should return all graph IDs", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);

      await store.save("graph-1", []);
      await store.save("graph-2", []);
      await store.save("graph-3", []);

      const ids = await store.getAllGraphIds();

      expect(ids).toHaveLength(3);
      expect(ids).toContain("graph-1");
      expect(ids).toContain("graph-2");
      expect(ids).toContain("graph-3");
    });

    it("should return empty array when no graphs stored", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);

      const ids = await store.getAllGraphIds();

      expect(ids).toHaveLength(0);
    });

    it("should only return IDs with matching prefix", async () => {
      // Use a unique prefix to avoid interference from other tests
      const store = new LocalStorageConstraintStore("unique-prefix-", mockStorage);

      await store.save("graph-1", []);
      mockStorage.setItem("other-key", "some value");

      const ids = await store.getAllGraphIds();

      expect(ids).toHaveLength(1);
      expect(ids).toContain("graph-1");
    });
  });

  describe("clearAll", () => {
    it("should clear all stored constraints", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);

      await store.save("graph-1", createTestConstraints());
      await store.save("graph-2", createTestConstraints());

      await store.clearAll();

      expect(await store.exists("graph-1")).toBe(false);
      expect(await store.exists("graph-2")).toBe(false);
    });

    it("should only clear items with matching prefix", async () => {
      const store = new LocalStorageConstraintStore("test-", mockStorage);

      await store.save("graph-1", []);
      mockStorage.setItem("other-key", "some value");

      await store.clearAll();

      expect(mockStorage.getItem("other-key")).toBe("some value");
    });
  });
});
