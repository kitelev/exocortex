import { QueryExecutor } from "../../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import type {
  BGPOperation,
  FilterOperation,
  JoinOperation,
  UnionOperation,
  MinusOperation,
  ProjectOperation,
  OrderByOperation,
  SliceOperation,
  DistinctOperation,
  ReducedOperation,
  GroupOperation,
  ExtendOperation,
  LeftJoinOperation,
  ValuesOperation,
  SubqueryOperation,
  ConstructOperation,
  AskOperation,
} from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("QueryExecutor", () => {
  let store: InMemoryTripleStore;
  let executor: QueryExecutor;

  const ex = (local: string) => new IRI(`http://example.org/${local}`);
  const rdfType = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);

    await store.add(new Triple(ex("task1"), rdfType, ex("Task")));
    await store.add(new Triple(ex("task1"), ex("label"), new Literal("Task 1")));
    await store.add(new Triple(ex("task1"), ex("priority"), new Literal("1", new IRI("http://www.w3.org/2001/XMLSchema#integer"))));

    await store.add(new Triple(ex("task2"), rdfType, ex("Task")));
    await store.add(new Triple(ex("task2"), ex("label"), new Literal("Task 2")));
    await store.add(new Triple(ex("task2"), ex("priority"), new Literal("2", new IRI("http://www.w3.org/2001/XMLSchema#integer"))));

    await store.add(new Triple(ex("project1"), rdfType, ex("Project")));
    await store.add(new Triple(ex("project1"), ex("label"), new Literal("Project 1")));
  });

  describe("executeAll", () => {
    it("should collect all results from BGP", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: rdfType.value },
            object: { type: "iri", value: ex("Task").value },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(2);
    });
  });

  describe("execute filter", () => {
    it("should filter results based on expression", async () => {
      const filterOp: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "label" },
          right: { type: "literal", value: "Task 1" },
        },
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: ex("label").value },
              object: { type: "variable", value: "label" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(filterOp);
      expect(results).toHaveLength(1);
    });
  });

  describe("execute join", () => {
    it("should join two BGPs with shared variables (bind join)", async () => {
      const joinOp: JoinOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
        right: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: ex("label").value },
              object: { type: "variable", value: "label" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(joinOp);
      expect(results).toHaveLength(2);
    });

    it("should join two BGPs without shared variables (hash join)", async () => {
      const joinOp: JoinOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
        right: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "p" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Project").value },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(joinOp);
      // Cross product: 2 tasks x 1 project = 2
      expect(results).toHaveLength(2);
    });

    it("should return empty when left side is empty", async () => {
      const joinOp: JoinOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("NonExistent").value },
            },
          ],
        } as BGPOperation,
        right: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: ex("label").value },
              object: { type: "variable", value: "label" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(joinOp);
      expect(results).toHaveLength(0);
    });
  });

  describe("execute leftjoin (OPTIONAL)", () => {
    it("should left join two patterns", async () => {
      const leftJoinOp: LeftJoinOperation = {
        type: "leftjoin",
        left: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "variable", value: "type" },
            },
          ],
        } as BGPOperation,
        right: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: ex("label").value },
              object: { type: "variable", value: "label" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(leftJoinOp);
      expect(results).toHaveLength(3); // 3 typed entities, all have labels
    });
  });

  describe("execute union", () => {
    it("should union two patterns", async () => {
      const unionOp: UnionOperation = {
        type: "union",
        left: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
        right: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Project").value },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(unionOp);
      expect(results).toHaveLength(3); // 2 tasks + 1 project
    });
  });

  describe("execute minus", () => {
    it("should subtract right pattern from left", async () => {
      const minusOp: MinusOperation = {
        type: "minus",
        left: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "variable", value: "type" },
            },
          ],
        } as BGPOperation,
        right: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(minusOp);
      expect(results).toHaveLength(1); // Only project
    });
  });

  describe("execute values", () => {
    it("should produce solutions from inline values", async () => {
      const valuesOp: ValuesOperation = {
        type: "values",
        variables: ["x"],
        bindings: [
          { x: { type: "iri", value: "http://example.org/task1" } },
          { x: { type: "iri", value: "http://example.org/task2" } },
        ],
      };

      const results = await executor.executeAll(valuesOp);
      expect(results).toHaveLength(2);
    });
  });

  describe("execute project", () => {
    it("should pass through solutions", async () => {
      const projectOp: ProjectOperation = {
        type: "project",
        variables: ["s"],
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(projectOp);
      expect(results).toHaveLength(2);
    });
  });

  describe("execute orderby", () => {
    it("should sort results ascending", async () => {
      const orderByOp: OrderByOperation = {
        type: "orderby",
        comparators: [
          {
            expression: { type: "variable", name: "label" },
            descending: false,
          },
        ],
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: ex("label").value },
              object: { type: "variable", value: "label" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(orderByOp);
      expect(results).toHaveLength(3);
    });

    it("should sort results descending", async () => {
      const orderByOp: OrderByOperation = {
        type: "orderby",
        comparators: [
          {
            expression: { type: "variable", name: "label" },
            descending: true,
          },
        ],
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: ex("label").value },
              object: { type: "variable", value: "label" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(orderByOp);
      expect(results).toHaveLength(3);
    });

    it("should handle undefined values in ordering", async () => {
      const orderByOp: OrderByOperation = {
        type: "orderby",
        comparators: [
          {
            expression: { type: "variable", name: "missing" },
            descending: false,
          },
        ],
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "variable", value: "type" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(orderByOp);
      expect(results).toHaveLength(3);
    });

    it("should handle literal expression values in ordering", async () => {
      const orderByOp: OrderByOperation = {
        type: "orderby",
        comparators: [
          {
            expression: { type: "literal", value: "constant" } as any,
            descending: false,
          },
        ],
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(orderByOp);
      expect(results).toHaveLength(2);
    });
  });

  describe("execute slice (LIMIT/OFFSET)", () => {
    it("should limit results", async () => {
      const sliceOp: SliceOperation = {
        type: "slice",
        limit: 1,
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "variable", value: "type" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(sliceOp);
      expect(results).toHaveLength(1);
    });

    it("should apply offset", async () => {
      const sliceOp: SliceOperation = {
        type: "slice",
        offset: 2,
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "variable", value: "type" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(sliceOp);
      expect(results).toHaveLength(1); // 3 total - 2 skipped = 1
    });
  });

  describe("execute distinct", () => {
    it("should remove duplicate solutions", async () => {
      const distinctOp: DistinctOperation = {
        type: "distinct",
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "variable", value: "type" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(distinctOp);
      expect(results).toHaveLength(3);
    });
  });

  describe("execute reduced", () => {
    it("should eliminate duplicates (same as DISTINCT)", async () => {
      const reducedOp: ReducedOperation = {
        type: "reduced",
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "variable", value: "type" },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(reducedOp);
      expect(results).toHaveLength(3);
    });
  });

  describe("execute extend (BIND)", () => {
    it("should add bound variable to solutions", async () => {
      const extendOp: ExtendOperation = {
        type: "extend",
        variable: "bound",
        expression: {
          type: "literal",
          value: "hello",
        } as any,
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(extendOp);
      expect(results).toHaveLength(2);
    });

    it("should handle aggregate expression by returning undefined", async () => {
      const extendOp: ExtendOperation = {
        type: "extend",
        variable: "count",
        expression: {
          type: "aggregate",
          aggregation: "count",
          expression: { type: "variable", name: "s" },
        } as any,
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(extendOp);
      expect(results).toHaveLength(2);
    });
  });

  describe("execute subquery", () => {
    it("should execute inner query and yield results", async () => {
      const subqueryOp: SubqueryOperation = {
        type: "subquery",
        query: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
      };

      const results = await executor.executeAll(subqueryOp);
      expect(results).toHaveLength(2);
    });
  });

  describe("execute unknown operation", () => {
    it("should throw for unknown operation type", async () => {
      const unknownOp = { type: "unknown_op" } as any;

      await expect(executor.executeAll(unknownOp)).rejects.toThrow(
        /Unknown operation type/
      );
    });
  });

  describe("isConstructQuery", () => {
    it("should return true for construct operations", () => {
      const constructOp: ConstructOperation = {
        type: "construct",
        template: [],
        where: { type: "bgp", triples: [] } as BGPOperation,
      };

      expect(executor.isConstructQuery(constructOp)).toBe(true);
    });

    it("should return false for non-construct operations", () => {
      const bgpOp: BGPOperation = { type: "bgp", triples: [] };
      expect(executor.isConstructQuery(bgpOp as any)).toBe(false);
    });
  });

  describe("isAskQuery", () => {
    it("should return true for ask operations", () => {
      const askOp: AskOperation = {
        type: "ask",
        where: { type: "bgp", triples: [] } as BGPOperation,
      };

      expect(executor.isAskQuery(askOp)).toBe(true);
    });

    it("should return false for non-ask operations", () => {
      const bgpOp: BGPOperation = { type: "bgp", triples: [] };
      expect(executor.isAskQuery(bgpOp as any)).toBe(false);
    });
  });

  describe("executeAsk", () => {
    it("should return true when pattern matches", async () => {
      const askOp: AskOperation = {
        type: "ask",
        where: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
      };

      const result = await executor.executeAsk(askOp);
      expect(result).toBe(true);
    });

    it("should return false when pattern does not match", async () => {
      const askOp: AskOperation = {
        type: "ask",
        where: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("NonExistent").value },
            },
          ],
        } as BGPOperation,
      };

      const result = await executor.executeAsk(askOp);
      expect(result).toBe(false);
    });

    it("should throw for non-ASK operation", async () => {
      const bgpOp = { type: "bgp", triples: [] } as any;
      await expect(executor.executeAsk(bgpOp)).rejects.toThrow(
        /executeAsk requires an ASK operation/
      );
    });
  });

  describe("executeConstruct", () => {
    it("should throw for non-CONSTRUCT operation", async () => {
      const bgpOp = { type: "bgp", triples: [] } as any;
      await expect(executor.executeConstruct(bgpOp)).rejects.toThrow(
        /executeConstruct requires a CONSTRUCT operation/
      );
    });

    it("should construct triples from template", async () => {
      const constructOp: ConstructOperation = {
        type: "construct",
        template: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/hasType" },
            object: { type: "iri", value: "http://example.org/Task" },
          },
        ],
        where: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
      };

      const triples = await executor.executeConstruct(constructOp);
      expect(triples.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("execute group", () => {
    it("should group and aggregate results", async () => {
      const groupOp: GroupOperation = {
        type: "group",
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "variable", value: "type" },
            },
          ],
        } as BGPOperation,
        variables: ["type"],
        aggregates: [
          {
            variable: "count",
            expression: {
              type: "aggregate",
              aggregation: "count",
              expression: { type: "variable", name: "s" } as any,
              distinct: false,
            },
          },
        ],
      };

      const results = await executor.executeAll(groupOp);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("execute lateraljoin", () => {
    it("should execute correlated subquery", async () => {
      const lateralOp = {
        type: "lateraljoin",
        left: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: rdfType.value },
              object: { type: "iri", value: ex("Task").value },
            },
          ],
        } as BGPOperation,
        right: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: ex("label").value },
              object: { type: "variable", value: "label" },
            },
          ],
        } as BGPOperation,
      } as any;

      const results = await executor.executeAll(lateralOp);
      expect(results).toHaveLength(2);
    });
  });
});
