import { AggregateFunctions } from "../../../../../src/infrastructure/sparql/aggregates/AggregateFunctions";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";

describe("AggregateFunctions", () => {
  const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");

  describe("COUNT", () => {
    it("should count all solutions", () => {
      const solutions = [new SolutionMapping(), new SolutionMapping(), new SolutionMapping()];
      expect(AggregateFunctions.count(solutions)).toBe(3);
    });

    it("should count bound variable", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("a"));
      const s2 = new SolutionMapping();
      const solutions = [s1, s2];
      expect(AggregateFunctions.count(solutions, "x")).toBe(1);
    });
  });

  describe("SUM", () => {
    it("should sum numeric literals", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("20", xsdInt));
      expect(AggregateFunctions.sum([s1, s2], "x")).toBe(30);
    });
  });

  describe("AVG", () => {
    it("should calculate average", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("20", xsdInt));
      expect(AggregateFunctions.avg([s1, s2], "x")).toBe(15);
    });
  });

  describe("MIN/MAX", () => {
    it("should find minimum", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("20", xsdInt));
      expect(AggregateFunctions.min([s1, s2], "x")).toBe(10);
    });

    it("should find maximum", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("20", xsdInt));
      expect(AggregateFunctions.max([s1, s2], "x")).toBe(20);
    });
  });

  describe("GROUP_CONCAT", () => {
    it("should concatenate values with default separator", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("hello"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("world"));
      expect(AggregateFunctions.groupConcat([s1, s2], "x")).toBe("hello world");
    });

    it("should use custom separator", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("a"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("b"));
      expect(AggregateFunctions.groupConcat([s1, s2], "x", ",")).toBe("a,b");
    });
  });

  describe("SAMPLE", () => {
    it("should return an arbitrary value from the group", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("first"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("second"));
      const s3 = new SolutionMapping();
      s3.set("x", new Literal("third"));

      const result = AggregateFunctions.sample([s1, s2, s3], "x");
      // SAMPLE returns an arbitrary value - in our implementation, the first one
      expect(result).toBe("first");
    });

    it("should return null for empty group", () => {
      const result = AggregateFunctions.sample([], "x");
      expect(result).toBeNull();
    });

    it("should skip unbound values and return first bound value", () => {
      const s1 = new SolutionMapping(); // x is unbound
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("bound"));
      const s3 = new SolutionMapping();
      s3.set("x", new Literal("also bound"));

      const result = AggregateFunctions.sample([s1, s2, s3], "x");
      expect(result).toBe("bound");
    });

    it("should return null if all values are unbound", () => {
      const s1 = new SolutionMapping();
      const s2 = new SolutionMapping();

      const result = AggregateFunctions.sample([s1, s2], "x");
      expect(result).toBeNull();
    });

    it("should work with numeric literals", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("42", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("100", xsdInt));

      const result = AggregateFunctions.sample([s1, s2], "x");
      expect(result).toBe(42);
    });

    it("should work with IRI values", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new IRI("http://example.org/resource1"));
      const s2 = new SolutionMapping();
      s2.set("x", new IRI("http://example.org/resource2"));

      const result = AggregateFunctions.sample([s1, s2], "x");
      expect(result).toBe("http://example.org/resource1");
    });
  });

  describe("SAMPLE DISTINCT", () => {
    it("should return an arbitrary unique value", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("value"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("value")); // duplicate
      const s3 = new SolutionMapping();
      s3.set("x", new Literal("other"));

      // SAMPLE DISTINCT still returns an arbitrary value (we return first)
      const result = AggregateFunctions.sampleDistinct([s1, s2, s3], "x");
      expect(result).toBe("value");
    });

    it("should return null for empty group", () => {
      const result = AggregateFunctions.sampleDistinct([], "x");
      expect(result).toBeNull();
    });
  });
});
