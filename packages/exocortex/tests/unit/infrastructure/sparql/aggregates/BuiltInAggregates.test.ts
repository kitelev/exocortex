import {
  medianAggregate,
  varianceAggregate,
  stddevAggregate,
  modeAggregate,
  createPercentileAggregate,
  getNumericValue,
  createDecimalLiteral,
  BUILT_IN_AGGREGATES,
  EXO_AGGREGATE_NS,
} from "../../../../../src/infrastructure/sparql/aggregates/BuiltInAggregates";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";

const XSD_INTEGER = new IRI("http://www.w3.org/2001/XMLSchema#integer");
const XSD_DECIMAL = new IRI("http://www.w3.org/2001/XMLSchema#decimal");

describe("Built-in Aggregates", () => {
  describe("getNumericValue", () => {
    it("should extract number from number", () => {
      expect(getNumericValue(42)).toBe(42);
      expect(getNumericValue(3.14)).toBe(3.14);
    });

    it("should parse number from string", () => {
      expect(getNumericValue("42")).toBe(42);
      expect(getNumericValue("3.14")).toBe(3.14);
    });

    it("should extract number from Literal", () => {
      expect(getNumericValue(new Literal("42", XSD_INTEGER))).toBe(42);
      expect(getNumericValue(new Literal("3.14", XSD_DECIMAL))).toBe(3.14);
    });

    it("should return NaN for null/undefined", () => {
      expect(getNumericValue(null)).toBeNaN();
      expect(getNumericValue(undefined)).toBeNaN();
    });

    it("should return NaN for IRI", () => {
      expect(getNumericValue(new IRI("http://example.org"))).toBeNaN();
    });

    it("should convert boolean to number", () => {
      expect(getNumericValue(true)).toBe(1);
      expect(getNumericValue(false)).toBe(0);
    });
  });

  describe("createDecimalLiteral", () => {
    it("should create decimal literal from number", () => {
      const literal = createDecimalLiteral(42);
      expect(literal.value).toBe("42");
      expect(literal.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#decimal");
    });
  });

  describe("medianAggregate", () => {
    it("should calculate median for odd number of values", () => {
      const state = medianAggregate.init();
      medianAggregate.step(state, 1);
      medianAggregate.step(state, 3);
      medianAggregate.step(state, 5);
      medianAggregate.step(state, 7);
      medianAggregate.step(state, 9);

      const result = medianAggregate.finalize(state);
      expect(parseFloat(result.value)).toBe(5);
    });

    it("should calculate median for even number of values", () => {
      const state = medianAggregate.init();
      medianAggregate.step(state, 1);
      medianAggregate.step(state, 2);
      medianAggregate.step(state, 3);
      medianAggregate.step(state, 4);

      const result = medianAggregate.finalize(state);
      expect(parseFloat(result.value)).toBe(2.5); // (2 + 3) / 2
    });

    it("should return 0 for empty group", () => {
      const state = medianAggregate.init();
      const result = medianAggregate.finalize(state);
      expect(parseFloat(result.value)).toBe(0);
    });

    it("should handle single value", () => {
      const state = medianAggregate.init();
      medianAggregate.step(state, 42);

      const result = medianAggregate.finalize(state);
      expect(parseFloat(result.value)).toBe(42);
    });

    it("should handle Literal values", () => {
      const state = medianAggregate.init();
      medianAggregate.step(state, new Literal("10", XSD_DECIMAL));
      medianAggregate.step(state, new Literal("20", XSD_DECIMAL));
      medianAggregate.step(state, new Literal("30", XSD_DECIMAL));

      const result = medianAggregate.finalize(state);
      expect(parseFloat(result.value)).toBe(20);
    });

    it("should ignore non-numeric values", () => {
      const state = medianAggregate.init();
      medianAggregate.step(state, 10);
      medianAggregate.step(state, "not a number");
      medianAggregate.step(state, 30);
      medianAggregate.step(state, null);

      const result = medianAggregate.finalize(state);
      expect(parseFloat(result.value)).toBe(20); // Median of [10, 30]
    });
  });

  describe("varianceAggregate", () => {
    it("should calculate population variance", () => {
      const state = varianceAggregate.init();
      // Values: 2, 4, 4, 4, 5, 5, 7, 9
      // Mean: 5
      // Variance: ((2-5)² + (4-5)² + (4-5)² + (4-5)² + (5-5)² + (5-5)² + (7-5)² + (9-5)²) / 8
      //         = (9 + 1 + 1 + 1 + 0 + 0 + 4 + 16) / 8 = 32 / 8 = 4
      medianAggregate.step(state, 2);
      varianceAggregate.step(state, 4);
      varianceAggregate.step(state, 4);
      varianceAggregate.step(state, 4);
      varianceAggregate.step(state, 5);
      varianceAggregate.step(state, 5);
      varianceAggregate.step(state, 7);
      varianceAggregate.step(state, 9);

      const result = varianceAggregate.finalize(state);
      expect(parseFloat(result.value)).toBeCloseTo(4, 5);
    });

    it("should return 0 for empty group", () => {
      const state = varianceAggregate.init();
      const result = varianceAggregate.finalize(state);
      expect(parseFloat(result.value)).toBe(0);
    });

    it("should return 0 for single value (zero variance)", () => {
      const state = varianceAggregate.init();
      varianceAggregate.step(state, 42);

      const result = varianceAggregate.finalize(state);
      expect(parseFloat(result.value)).toBe(0);
    });
  });

  describe("stddevAggregate", () => {
    it("should calculate population standard deviation", () => {
      const state = stddevAggregate.init();
      // Values: 2, 4, 4, 4, 5, 5, 7, 9
      // Variance = 4, so stddev = 2
      stddevAggregate.step(state, 2);
      stddevAggregate.step(state, 4);
      stddevAggregate.step(state, 4);
      stddevAggregate.step(state, 4);
      stddevAggregate.step(state, 5);
      stddevAggregate.step(state, 5);
      stddevAggregate.step(state, 7);
      stddevAggregate.step(state, 9);

      const result = stddevAggregate.finalize(state);
      expect(parseFloat(result.value)).toBeCloseTo(2, 5);
    });

    it("should return 0 for empty group", () => {
      const state = stddevAggregate.init();
      const result = stddevAggregate.finalize(state);
      expect(parseFloat(result.value)).toBe(0);
    });
  });

  describe("modeAggregate", () => {
    it("should return most frequent value", () => {
      const state = modeAggregate.init();
      modeAggregate.step(state, "a");
      modeAggregate.step(state, "b");
      modeAggregate.step(state, "b");
      modeAggregate.step(state, "c");
      modeAggregate.step(state, "b");

      const result = modeAggregate.finalize(state);
      expect(result.value).toBe("b");
    });

    it("should handle numeric values", () => {
      const state = modeAggregate.init();
      modeAggregate.step(state, 1);
      modeAggregate.step(state, 2);
      modeAggregate.step(state, 2);
      modeAggregate.step(state, 3);

      const result = modeAggregate.finalize(state);
      expect(parseFloat(result.value)).toBe(2);
    });

    it("should return space for empty group", () => {
      const state = modeAggregate.init();
      const result = modeAggregate.finalize(state);
      // Returns space because Literal cannot be empty
      expect(result.value).toBe(" ");
    });

    it("should skip null/undefined values", () => {
      const state = modeAggregate.init();
      modeAggregate.step(state, null);
      modeAggregate.step(state, "a");
      modeAggregate.step(state, undefined);

      const result = modeAggregate.finalize(state);
      expect(result.value).toBe("a");
    });
  });

  describe("createPercentileAggregate", () => {
    it("should calculate 50th percentile (median)", () => {
      const p50 = createPercentileAggregate(50);
      const state = p50.init();
      p50.step(state, 1);
      p50.step(state, 2);
      p50.step(state, 3);
      p50.step(state, 4);
      p50.step(state, 5);

      const result = p50.finalize(state);
      expect(parseFloat(result.value)).toBe(3);
    });

    it("should calculate 25th percentile", () => {
      const p25 = createPercentileAggregate(25);
      const state = p25.init();
      // Values: 1, 2, 3, 4, 5, 6, 7, 8
      for (let i = 1; i <= 8; i++) {
        p25.step(state, i);
      }

      const result = p25.finalize(state);
      // 25th percentile of 1-8 = value at index 0.25 * 7 = 1.75
      // Interpolation: 2 * 0.25 + 3 * 0.75 = 2.75
      expect(parseFloat(result.value)).toBeCloseTo(2.75, 5);
    });

    it("should calculate 75th percentile", () => {
      const p75 = createPercentileAggregate(75);
      const state = p75.init();
      for (let i = 1; i <= 8; i++) {
        p75.step(state, i);
      }

      const result = p75.finalize(state);
      // 75th percentile of 1-8 = value at index 0.75 * 7 = 5.25
      // Interpolation: 6 * 0.75 + 7 * 0.25 = 6.25
      expect(parseFloat(result.value)).toBeCloseTo(6.25, 5);
    });

    it("should handle percentile 0", () => {
      const p0 = createPercentileAggregate(0);
      const state = p0.init();
      p0.step(state, 10);
      p0.step(state, 20);
      p0.step(state, 30);

      const result = p0.finalize(state);
      expect(parseFloat(result.value)).toBe(10); // Minimum
    });

    it("should handle percentile 100", () => {
      const p100 = createPercentileAggregate(100);
      const state = p100.init();
      p100.step(state, 10);
      p100.step(state, 20);
      p100.step(state, 30);

      const result = p100.finalize(state);
      expect(parseFloat(result.value)).toBe(30); // Maximum
    });

    it("should return 0 for empty group", () => {
      const p50 = createPercentileAggregate(50);
      const state = p50.init();
      const result = p50.finalize(state);
      expect(parseFloat(result.value)).toBe(0);
    });
  });

  describe("BUILT_IN_AGGREGATES", () => {
    it("should contain median aggregate", () => {
      expect(BUILT_IN_AGGREGATES[`${EXO_AGGREGATE_NS}median`]).toBe(medianAggregate);
    });

    it("should contain variance aggregate", () => {
      expect(BUILT_IN_AGGREGATES[`${EXO_AGGREGATE_NS}variance`]).toBe(varianceAggregate);
    });

    it("should contain stddev aggregate", () => {
      expect(BUILT_IN_AGGREGATES[`${EXO_AGGREGATE_NS}stddev`]).toBe(stddevAggregate);
    });

    it("should contain mode aggregate", () => {
      expect(BUILT_IN_AGGREGATES[`${EXO_AGGREGATE_NS}mode`]).toBe(modeAggregate);
    });

    it("should contain percentile aggregates", () => {
      expect(BUILT_IN_AGGREGATES[`${EXO_AGGREGATE_NS}percentile25`]).toBeDefined();
      expect(BUILT_IN_AGGREGATES[`${EXO_AGGREGATE_NS}percentile50`]).toBeDefined();
      expect(BUILT_IN_AGGREGATES[`${EXO_AGGREGATE_NS}percentile75`]).toBeDefined();
      expect(BUILT_IN_AGGREGATES[`${EXO_AGGREGATE_NS}percentile90`]).toBeDefined();
      expect(BUILT_IN_AGGREGATES[`${EXO_AGGREGATE_NS}percentile95`]).toBeDefined();
      expect(BUILT_IN_AGGREGATES[`${EXO_AGGREGATE_NS}percentile99`]).toBeDefined();
    });
  });

  describe("EXO_AGGREGATE_NS", () => {
    it("should be the correct namespace", () => {
      expect(EXO_AGGREGATE_NS).toBe("https://exocortex.my/ontology/agg#");
    });
  });
});
