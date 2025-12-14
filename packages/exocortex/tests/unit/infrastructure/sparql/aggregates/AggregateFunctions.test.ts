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
});
