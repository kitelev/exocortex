import {
  CustomAggregateRegistry,
  CustomAggregateError,
  type CustomAggregate,
  type AggregateState,
} from "../../../../../src/infrastructure/sparql/aggregates/CustomAggregateRegistry";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";

const XSD_DECIMAL = new IRI("http://www.w3.org/2001/XMLSchema#decimal");

describe("CustomAggregateRegistry", () => {
  beforeEach(() => {
    // Reset singleton for each test
    CustomAggregateRegistry.resetInstance();
  });

  afterAll(() => {
    // Clean up after all tests
    CustomAggregateRegistry.resetInstance();
  });

  describe("singleton pattern", () => {
    it("should return the same instance on multiple calls", () => {
      const instance1 = CustomAggregateRegistry.getInstance();
      const instance2 = CustomAggregateRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("should create a new instance after reset", () => {
      const instance1 = CustomAggregateRegistry.getInstance();
      CustomAggregateRegistry.resetInstance();
      const instance2 = CustomAggregateRegistry.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe("register", () => {
    it("should register a valid custom aggregate", () => {
      const registry = CustomAggregateRegistry.getInstance();

      interface CountState extends AggregateState {
        count: number;
      }

      const testAggregate: CustomAggregate = {
        init: (): CountState => ({ count: 0 }),
        step: (state: AggregateState) => { (state as CountState).count++; },
        finalize: (state: AggregateState) => new Literal(String((state as CountState).count), XSD_DECIMAL),
      };

      registry.register("http://example.org/agg/count", testAggregate);

      expect(registry.has("http://example.org/agg/count")).toBe(true);
      expect(registry.get("http://example.org/agg/count")).toBe(testAggregate);
    });

    it("should throw error for empty IRI", () => {
      const registry = CustomAggregateRegistry.getInstance();
      const testAggregate: CustomAggregate = {
        init: () => ({}),
        step: () => {},
        finalize: () => new Literal("0", XSD_DECIMAL),
      };

      expect(() => registry.register("", testAggregate)).toThrow(CustomAggregateError);
      expect(() => registry.register("", testAggregate)).toThrow("Aggregate IRI must be a non-empty string");
    });

    it("should throw error for invalid aggregate (missing methods)", () => {
      const registry = CustomAggregateRegistry.getInstance();

      expect(() => registry.register("http://example.org/agg/bad", {} as any)).toThrow(CustomAggregateError);
      expect(() => registry.register("http://example.org/agg/bad", {} as any)).toThrow(
        "Aggregate must implement init(), step(), and finalize() methods"
      );
    });

    it("should throw error when registering duplicate IRI", () => {
      const registry = CustomAggregateRegistry.getInstance();
      const testAggregate: CustomAggregate = {
        init: () => ({}),
        step: () => {},
        finalize: () => new Literal("0", XSD_DECIMAL),
      };

      registry.register("http://example.org/agg/test", testAggregate);

      expect(() => registry.register("http://example.org/agg/test", testAggregate)).toThrow(CustomAggregateError);
      expect(() => registry.register("http://example.org/agg/test", testAggregate)).toThrow(
        'Aggregate with IRI "http://example.org/agg/test" is already registered'
      );
    });
  });

  describe("unregister", () => {
    it("should remove registered aggregate", () => {
      const registry = CustomAggregateRegistry.getInstance();
      const testAggregate: CustomAggregate = {
        init: () => ({}),
        step: () => {},
        finalize: () => new Literal("0", XSD_DECIMAL),
      };

      registry.register("http://example.org/agg/test", testAggregate);
      expect(registry.has("http://example.org/agg/test")).toBe(true);

      const result = registry.unregister("http://example.org/agg/test");
      expect(result).toBe(true);
      expect(registry.has("http://example.org/agg/test")).toBe(false);
    });

    it("should return false for non-existent aggregate", () => {
      const registry = CustomAggregateRegistry.getInstance();
      const result = registry.unregister("http://example.org/agg/nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent aggregate", () => {
      const registry = CustomAggregateRegistry.getInstance();
      expect(registry.get("http://example.org/agg/nonexistent")).toBeUndefined();
    });
  });

  describe("getRegisteredIris", () => {
    it("should return empty array when no aggregates registered", () => {
      const registry = CustomAggregateRegistry.getInstance();
      expect(registry.getRegisteredIris()).toEqual([]);
    });

    it("should return all registered IRIs", () => {
      const registry = CustomAggregateRegistry.getInstance();
      const testAggregate: CustomAggregate = {
        init: () => ({}),
        step: () => {},
        finalize: () => new Literal("0", XSD_DECIMAL),
      };

      registry.register("http://example.org/agg/one", testAggregate);
      registry.register("http://example.org/agg/two", testAggregate);

      const iris = registry.getRegisteredIris();
      expect(iris).toHaveLength(2);
      expect(iris).toContain("http://example.org/agg/one");
      expect(iris).toContain("http://example.org/agg/two");
    });
  });

  describe("clear", () => {
    it("should remove all registered aggregates", () => {
      const registry = CustomAggregateRegistry.getInstance();
      const testAggregate: CustomAggregate = {
        init: () => ({}),
        step: () => {},
        finalize: () => new Literal("0", XSD_DECIMAL),
      };

      registry.register("http://example.org/agg/one", testAggregate);
      registry.register("http://example.org/agg/two", testAggregate);
      expect(registry.size).toBe(2);

      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.getRegisteredIris()).toEqual([]);
    });
  });

  describe("size", () => {
    it("should return correct count", () => {
      const registry = CustomAggregateRegistry.getInstance();
      expect(registry.size).toBe(0);

      const testAggregate: CustomAggregate = {
        init: () => ({}),
        step: () => {},
        finalize: () => new Literal("0", XSD_DECIMAL),
      };

      registry.register("http://example.org/agg/one", testAggregate);
      expect(registry.size).toBe(1);

      registry.register("http://example.org/agg/two", testAggregate);
      expect(registry.size).toBe(2);
    });
  });
});

describe("Custom aggregate execution", () => {
  beforeEach(() => {
    CustomAggregateRegistry.resetInstance();
  });

  afterAll(() => {
    CustomAggregateRegistry.resetInstance();
  });

  it("should execute a simple count aggregate", () => {
    interface CountState extends AggregateState {
      count: number;
    }

    const countAggregate: CustomAggregate = {
      init: (): CountState => ({ count: 0 }),
      step: (state: AggregateState) => {
        (state as CountState).count++;
      },
      finalize: (state: AggregateState): Literal => {
        return new Literal(String((state as CountState).count), XSD_DECIMAL);
      },
    };

    const state = countAggregate.init();
    countAggregate.step(state, "value1");
    countAggregate.step(state, "value2");
    countAggregate.step(state, "value3");

    const result = countAggregate.finalize(state);
    expect(result.value).toBe("3");
  });

  it("should execute a sum aggregate", () => {
    interface SumState extends AggregateState {
      total: number;
    }

    const sumAggregate: CustomAggregate = {
      init: (): SumState => ({ total: 0 }),
      step: (state: AggregateState, value) => {
        const num = typeof value === "number" ? value : parseFloat(String(value));
        if (!isNaN(num)) {
          (state as SumState).total += num;
        }
      },
      finalize: (state: AggregateState): Literal => {
        return new Literal(String((state as SumState).total), XSD_DECIMAL);
      },
    };

    const state = sumAggregate.init();
    sumAggregate.step(state, 10);
    sumAggregate.step(state, 20);
    sumAggregate.step(state, 30);

    const result = sumAggregate.finalize(state);
    expect(result.value).toBe("60");
  });
});
