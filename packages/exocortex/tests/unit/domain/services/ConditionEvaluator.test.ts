/**
 * Tests for ConditionEvaluator - Condition evaluation engine
 *
 * Issue #1412: Implement ConditionEvaluator
 * @see https://github.com/kitelev/exocortex/issues/1412
 *
 * Tests for:
 * - SPARQL ASK conditions
 * - Simple class check conditions
 * - Property existence/value checks
 * - Logical operators (not, and, or)
 * - Error handling
 */

import { ITripleStore } from "../../../../src/interfaces/ITripleStore";
import { ConditionEvaluator } from "../../../../src/domain/services/ConditionEvaluator";
import { CONDITION_PREDICATES } from "../../../../src/domain/types/ConditionTypes";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";

describe("ConditionEvaluator", () => {
  let mockTripleStore: jest.Mocked<ITripleStore>;
  let evaluator: ConditionEvaluator;

  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const EMS_TASK = "https://exocortex.my/ontology/ems#Task";
  const EMS_PROJECT = "https://exocortex.my/ontology/ems#Project";
  const EMS_STATUS = "https://exocortex.my/ontology/ems#Task_status";

  // Helper to create proper Triple instances
  const createTriple = (
    subject: string,
    predicate: string,
    object: string | number | boolean
  ): Triple => {
    const subjectIRI = new IRI(subject);
    const predicateIRI = new IRI(predicate);
    const objectTerm =
      typeof object === "string" && object.startsWith("http")
        ? new IRI(object)
        : new Literal(String(object));

    return new Triple(subjectIRI, predicateIRI, objectTerm);
  };

  beforeEach(() => {
    mockTripleStore = {
      add: jest.fn(),
      remove: jest.fn(),
      has: jest.fn(),
      match: jest.fn(),
      addAll: jest.fn(),
      removeAll: jest.fn(),
      clear: jest.fn(),
      count: jest.fn(),
      subjects: jest.fn(),
      predicates: jest.fn(),
      objects: jest.fn(),
      beginTransaction: jest.fn(),
    } as unknown as jest.Mocked<ITripleStore>;

    evaluator = new ConditionEvaluator(mockTripleStore);
  });

  describe("constructor", () => {
    it("should create instance with tripleStore", () => {
      expect(evaluator).toBeInstanceOf(ConditionEvaluator);
    });
  });

  describe("evaluate() - SPARQL ASK conditions", () => {
    const conditionUri = "https://exocortex.my/conditions/sparql-condition-1";
    const assetUri = "https://exocortex.my/assets/task-1";

    it("should return true when SPARQL ASK matches", async () => {
      // Setup: condition definition with SPARQL query
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          // Return condition definition with SPARQL
          return [
            createTriple(
              conditionUri,
              CONDITION_PREDICATES.SPARQL,
              "ASK { ?asset a <https://exocortex.my/ontology/ems#Task> }"
            ),
          ];
        }

        // For SPARQL execution simulation - asset is a Task
        if (subjectValue === assetUri) {
          return [createTriple(assetUri, RDF_TYPE, EMS_TASK)];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(true);
    });

    it("should return false when SPARQL ASK does not match", async () => {
      // Setup: condition expects Task but asset is Project
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(
              conditionUri,
              CONDITION_PREDICATES.SPARQL,
              "ASK { ?asset a <https://exocortex.my/ontology/ems#Task> }"
            ),
          ];
        }

        // Asset is a Project, not Task
        if (subjectValue === assetUri) {
          return [createTriple(assetUri, RDF_TYPE, EMS_PROJECT)];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(false);
    });

    it("should substitute ?asset placeholder with actual asset URI", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(
              conditionUri,
              CONDITION_PREDICATES.SPARQL,
              "ASK { ?asset <https://exocortex.my/ontology/ems#Task_status> 'active' }"
            ),
          ];
        }

        // Return status for asset
        if (subjectValue === assetUri) {
          return [createTriple(assetUri, EMS_STATUS, "active")];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(true);
    });
  });

  describe("evaluate() - simple class check", () => {
    const conditionUri = "https://exocortex.my/conditions/class-condition-1";
    const assetUri = "https://exocortex.my/assets/task-1";

    it("should return true when asset is of specified class", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.ASSET_CLASS, EMS_TASK),
          ];
        }

        if (subjectValue === assetUri) {
          return [createTriple(assetUri, RDF_TYPE, EMS_TASK)];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(true);
    });

    it("should return false when asset is not of specified class", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.ASSET_CLASS, EMS_TASK),
          ];
        }

        // Asset is Project, not Task
        if (subjectValue === assetUri) {
          return [createTriple(assetUri, RDF_TYPE, EMS_PROJECT)];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(false);
    });
  });

  describe("evaluate() - property existence check", () => {
    const conditionUri = "https://exocortex.my/conditions/property-condition-1";
    const assetUri = "https://exocortex.my/assets/task-1";

    it("should return true when property exists (without value check)", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.HAS_PROPERTY, EMS_STATUS),
          ];
        }

        if (subjectValue === assetUri) {
          return [createTriple(assetUri, EMS_STATUS, "active")];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(true);
    });

    it("should return false when property does not exist", async () => {
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);
        const predicateValue =
          predicate && "value" in predicate ? predicate.value : undefined;

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.HAS_PROPERTY, EMS_STATUS),
          ];
        }

        // Asset queries: distinguish between rdf:type and property queries
        if (subjectValue === assetUri) {
          // Only return type triple, not status property
          if (predicateValue === RDF_TYPE || !predicateValue) {
            return [createTriple(assetUri, RDF_TYPE, EMS_TASK)];
          }
          // Property query - return empty (property doesn't exist)
          if (predicateValue === EMS_STATUS) {
            return [];
          }
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(false);
    });
  });

  describe("evaluate() - property value check", () => {
    const conditionUri = "https://exocortex.my/conditions/value-condition-1";
    const assetUri = "https://exocortex.my/assets/task-1";

    it("should return true when property has expected value", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.HAS_PROPERTY, EMS_STATUS),
            createTriple(conditionUri, CONDITION_PREDICATES.PROPERTY_VALUE, "active"),
          ];
        }

        if (subjectValue === assetUri) {
          return [createTriple(assetUri, EMS_STATUS, "active")];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(true);
    });

    it("should return false when property has different value", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.HAS_PROPERTY, EMS_STATUS),
            createTriple(conditionUri, CONDITION_PREDICATES.PROPERTY_VALUE, "active"),
          ];
        }

        // Asset has 'completed' status, not 'active'
        if (subjectValue === assetUri) {
          return [createTriple(assetUri, EMS_STATUS, "completed")];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(false);
    });
  });

  describe("evaluate() - NOT operator", () => {
    const conditionUri = "https://exocortex.my/conditions/not-condition-1";
    const innerConditionUri = "https://exocortex.my/conditions/inner-condition-1";
    const assetUri = "https://exocortex.my/assets/task-1";

    it("should return true when inner condition is false", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.NOT, innerConditionUri),
          ];
        }

        // Inner condition checks for Project class
        if (subjectValue === innerConditionUri) {
          return [
            createTriple(
              innerConditionUri,
              CONDITION_PREDICATES.ASSET_CLASS,
              EMS_PROJECT
            ),
          ];
        }

        // Asset is Task (not Project), so inner condition is false
        if (subjectValue === assetUri) {
          return [createTriple(assetUri, RDF_TYPE, EMS_TASK)];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(true);
    });

    it("should return false when inner condition is true", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.NOT, innerConditionUri),
          ];
        }

        // Inner condition checks for Task class
        if (subjectValue === innerConditionUri) {
          return [
            createTriple(innerConditionUri, CONDITION_PREDICATES.ASSET_CLASS, EMS_TASK),
          ];
        }

        // Asset is Task, so inner condition is true
        if (subjectValue === assetUri) {
          return [createTriple(assetUri, RDF_TYPE, EMS_TASK)];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(false);
    });
  });

  describe("evaluate() - AND operator", () => {
    const conditionUri = "https://exocortex.my/conditions/and-condition-1";
    const condition1Uri = "https://exocortex.my/conditions/cond-1";
    const condition2Uri = "https://exocortex.my/conditions/cond-2";
    const assetUri = "https://exocortex.my/assets/task-1";

    it("should return true when all conditions are true", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.AND, condition1Uri),
            createTriple(conditionUri, CONDITION_PREDICATES.AND, condition2Uri),
          ];
        }

        // Condition 1: is Task
        if (subjectValue === condition1Uri) {
          return [
            createTriple(condition1Uri, CONDITION_PREDICATES.ASSET_CLASS, EMS_TASK),
          ];
        }

        // Condition 2: has active status
        if (subjectValue === condition2Uri) {
          return [
            createTriple(condition2Uri, CONDITION_PREDICATES.HAS_PROPERTY, EMS_STATUS),
            createTriple(condition2Uri, CONDITION_PREDICATES.PROPERTY_VALUE, "active"),
          ];
        }

        // Asset is Task with active status
        if (subjectValue === assetUri) {
          return [
            createTriple(assetUri, RDF_TYPE, EMS_TASK),
            createTriple(assetUri, EMS_STATUS, "active"),
          ];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(true);
    });

    it("should return false when any condition is false", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.AND, condition1Uri),
            createTriple(conditionUri, CONDITION_PREDICATES.AND, condition2Uri),
          ];
        }

        // Condition 1: is Task
        if (subjectValue === condition1Uri) {
          return [
            createTriple(condition1Uri, CONDITION_PREDICATES.ASSET_CLASS, EMS_TASK),
          ];
        }

        // Condition 2: has active status
        if (subjectValue === condition2Uri) {
          return [
            createTriple(condition2Uri, CONDITION_PREDICATES.HAS_PROPERTY, EMS_STATUS),
            createTriple(condition2Uri, CONDITION_PREDICATES.PROPERTY_VALUE, "active"),
          ];
        }

        // Asset is Task but with completed status (not active)
        if (subjectValue === assetUri) {
          return [
            createTriple(assetUri, RDF_TYPE, EMS_TASK),
            createTriple(assetUri, EMS_STATUS, "completed"),
          ];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(false);
    });

    it("should short-circuit on first false condition", async () => {
      const matchCalls: string[] = [];

      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);
        matchCalls.push(subjectValue);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.AND, condition1Uri),
            createTriple(conditionUri, CONDITION_PREDICATES.AND, condition2Uri),
          ];
        }

        // Condition 1: is Project (will be false for Task)
        if (subjectValue === condition1Uri) {
          return [
            createTriple(condition1Uri, CONDITION_PREDICATES.ASSET_CLASS, EMS_PROJECT),
          ];
        }

        // Condition 2: should not be evaluated
        if (subjectValue === condition2Uri) {
          return [
            createTriple(condition2Uri, CONDITION_PREDICATES.HAS_PROPERTY, EMS_STATUS),
          ];
        }

        // Asset is Task
        if (subjectValue === assetUri) {
          return [createTriple(assetUri, RDF_TYPE, EMS_TASK)];
        }

        return [];
      });

      await evaluator.evaluate(conditionUri, assetUri);

      // Should not have loaded condition2Uri since condition1 was false
      expect(matchCalls).not.toContain(condition2Uri);
    });
  });

  describe("evaluate() - OR operator", () => {
    const conditionUri = "https://exocortex.my/conditions/or-condition-1";
    const condition1Uri = "https://exocortex.my/conditions/cond-1";
    const condition2Uri = "https://exocortex.my/conditions/cond-2";
    const assetUri = "https://exocortex.my/assets/task-1";

    it("should return true when any condition is true", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.OR, condition1Uri),
            createTriple(conditionUri, CONDITION_PREDICATES.OR, condition2Uri),
          ];
        }

        // Condition 1: is Project (false for Task)
        if (subjectValue === condition1Uri) {
          return [
            createTriple(condition1Uri, CONDITION_PREDICATES.ASSET_CLASS, EMS_PROJECT),
          ];
        }

        // Condition 2: is Task (true)
        if (subjectValue === condition2Uri) {
          return [
            createTriple(condition2Uri, CONDITION_PREDICATES.ASSET_CLASS, EMS_TASK),
          ];
        }

        // Asset is Task
        if (subjectValue === assetUri) {
          return [createTriple(assetUri, RDF_TYPE, EMS_TASK)];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(true);
    });

    it("should return false when all conditions are false", async () => {
      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.OR, condition1Uri),
            createTriple(conditionUri, CONDITION_PREDICATES.OR, condition2Uri),
          ];
        }

        // Condition 1: is Project
        if (subjectValue === condition1Uri) {
          return [
            createTriple(condition1Uri, CONDITION_PREDICATES.ASSET_CLASS, EMS_PROJECT),
          ];
        }

        // Condition 2: has status 'active'
        if (subjectValue === condition2Uri) {
          return [
            createTriple(condition2Uri, CONDITION_PREDICATES.HAS_PROPERTY, EMS_STATUS),
            createTriple(condition2Uri, CONDITION_PREDICATES.PROPERTY_VALUE, "active"),
          ];
        }

        // Asset is Task with completed status
        if (subjectValue === assetUri) {
          return [
            createTriple(assetUri, RDF_TYPE, EMS_TASK),
            createTriple(assetUri, EMS_STATUS, "completed"),
          ];
        }

        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      expect(result).toBe(false);
    });

    it("should short-circuit on first true condition", async () => {
      const matchCalls: string[] = [];

      mockTripleStore.match.mockImplementation(async (subject) => {
        const subjectValue =
          subject && "value" in subject ? subject.value : String(subject);
        matchCalls.push(subjectValue);

        if (subjectValue === conditionUri) {
          return [
            createTriple(conditionUri, CONDITION_PREDICATES.OR, condition1Uri),
            createTriple(conditionUri, CONDITION_PREDICATES.OR, condition2Uri),
          ];
        }

        // Condition 1: is Task (will be true)
        if (subjectValue === condition1Uri) {
          return [
            createTriple(condition1Uri, CONDITION_PREDICATES.ASSET_CLASS, EMS_TASK),
          ];
        }

        // Condition 2: should not be evaluated
        if (subjectValue === condition2Uri) {
          return [
            createTriple(condition2Uri, CONDITION_PREDICATES.HAS_PROPERTY, EMS_STATUS),
          ];
        }

        // Asset is Task
        if (subjectValue === assetUri) {
          return [createTriple(assetUri, RDF_TYPE, EMS_TASK)];
        }

        return [];
      });

      await evaluator.evaluate(conditionUri, assetUri);

      // Should not have loaded condition2Uri since condition1 was true
      expect(matchCalls).not.toContain(condition2Uri);
    });
  });

  describe("evaluate() - empty/no conditions", () => {
    const conditionUri = "https://exocortex.my/conditions/empty-condition-1";
    const assetUri = "https://exocortex.my/assets/task-1";

    it("should return true when no condition properties are defined", async () => {
      mockTripleStore.match.mockImplementation(async () => {
        // Condition with no relevant properties
        return [];
      });

      const result = await evaluator.evaluate(conditionUri, assetUri);

      // No conditions = always true
      expect(result).toBe(true);
    });
  });

  describe("error handling", () => {
    const conditionUri = "https://exocortex.my/conditions/error-condition-1";
    const assetUri = "https://exocortex.my/assets/task-1";

    it("should handle triple store errors gracefully", async () => {
      mockTripleStore.match.mockRejectedValue(new Error("Triple store error"));

      await expect(evaluator.evaluate(conditionUri, assetUri)).rejects.toThrow(
        "Triple store error"
      );
    });
  });
});
