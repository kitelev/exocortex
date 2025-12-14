/**
 * Integration tests for real-world SPARQL query patterns.
 *
 * These tests use query patterns that match actual usage in Exocortex CLI and Obsidian plugin.
 * They verify that complex queries work correctly in realistic scenarios.
 *
 * Issue #750: Add Integration Tests for SPARQL Engine
 */

import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { AlgebraOptimizer } from "../../../src/infrastructure/sparql/algebra/AlgebraOptimizer";
import { QueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

// Standard namespace URIs
const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const XSD_STRING = new IRI("http://www.w3.org/2001/XMLSchema#string");
const XSD_INTEGER = new IRI("http://www.w3.org/2001/XMLSchema#integer");
const XSD_DATETIME = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
const XSD_DECIMAL = new IRI("http://www.w3.org/2001/XMLSchema#decimal");

// Exocortex-specific namespaces
const EXO = "https://exocortex.my/ontology/exo#";
const EMS = "https://exocortex.my/ontology/ems#";

const EXO_ASSET_LABEL = new IRI(`${EXO}Asset_label`);
const EXO_ASSET_PROTOTYPE = new IRI(`${EXO}Asset_prototype`);
const EXO_INSTANCE_CLASS = new IRI(`${EXO}Instance_class`);

const EMS_TASK = new IRI(`${EMS}Task`);
const EMS_PROJECT = new IRI(`${EMS}Project`);
const EMS_AREA = new IRI(`${EMS}Area`);
const EMS_EFFORT_STATUS = new IRI(`${EMS}Effort_status`);
const EMS_EFFORT_PARENT = new IRI(`${EMS}Effort_parent`);
const EMS_EFFORT_START_TIMESTAMP = new IRI(`${EMS}Effort_startTimestamp`);
const EMS_EFFORT_END_TIMESTAMP = new IRI(`${EMS}Effort_endTimestamp`);
const EMS_VOTE_VALUE = new IRI(`${EMS}Vote_value`);
const EMS_VOTE_TIMESTAMP = new IRI(`${EMS}Vote_timestamp`);

describe("Real-World SPARQL Query Patterns", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let optimizer: AlgebraOptimizer;
  let store: InMemoryTripleStore;
  let executor: QueryExecutor;

  async function executeQuery(sparql: string) {
    const parsed = parser.parse(sparql);
    let algebra = translator.translate(parsed);
    algebra = optimizer.optimize(algebra);
    return executor.executeAll(algebra);
  }

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    optimizer = new AlgebraOptimizer();
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
  });

  describe("Sleep Tracking Queries (Real Exocortex Pattern)", () => {
    beforeEach(async () => {
      // Simulate sleep log entries with prototype pattern
      const sleepPrototype = new IRI("obsidian://vault/03%20Knowledge%2Fkitelev%2Fsleep-prototype.md");

      const triples: Triple[] = [
        // Sleep prototype definition
        new Triple(sleepPrototype, RDF_TYPE, EMS_TASK),
        new Triple(sleepPrototype, EXO_ASSET_LABEL, new Literal("Поспать", XSD_STRING)),

        // Sleep entry 1: 8 hours
        new Triple(
          new IRI("http://example.org/sleep-2025-01-14"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-14"),
          EXO_ASSET_LABEL,
          new Literal("Поспать 2025-01-14", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-14"),
          EXO_ASSET_PROTOTYPE,
          sleepPrototype
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-14"),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-13T23:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-14"),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-14T07:00:00.000Z", XSD_DATETIME)
        ),

        // Sleep entry 2: 7 hours
        new Triple(
          new IRI("http://example.org/sleep-2025-01-15"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-15"),
          EXO_ASSET_LABEL,
          new Literal("Поспать 2025-01-15", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-15"),
          EXO_ASSET_PROTOTYPE,
          sleepPrototype
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-15"),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T00:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-15"),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T07:00:00.000Z", XSD_DATETIME)
        ),

        // Sleep entry 3: 6 hours
        new Triple(
          new IRI("http://example.org/sleep-2025-01-16"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-16"),
          EXO_ASSET_LABEL,
          new Literal("Поспать 2025-01-16", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-16"),
          EXO_ASSET_PROTOTYPE,
          sleepPrototype
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-16"),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-16T01:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI("http://example.org/sleep-2025-01-16"),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-16T07:00:00.000Z", XSD_DATETIME)
        ),
      ];

      await store.addAll(triples);
    });

    it("should find sleep entries by prototype", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?s ?label ?start ?end
        WHERE {
          ?s exo:Asset_prototype <obsidian://vault/03%20Knowledge%2Fkitelev%2Fsleep-prototype.md> .
          ?s exo:Asset_label ?label .
          ?s ems:Effort_startTimestamp ?start .
          ?s ems:Effort_endTimestamp ?end .
        }
        ORDER BY ?start
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels[0]).toBe("Поспать 2025-01-14");
      expect(labels[1]).toBe("Поспать 2025-01-15");
      expect(labels[2]).toBe("Поспать 2025-01-16");
    });

    it("should find sleep entries by label pattern (STRSTARTS)", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
          FILTER(STRSTARTS(?label, "Поспать 2025-"))
        }
      `;

      const results = await executeQuery(query);

      // Should find 3 sleep entries (not the prototype which has just "Поспать")
      expect(results).toHaveLength(3);
    });

    it("should count sleep entries", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT (COUNT(?s) AS ?count)
        WHERE {
          ?s exo:Asset_prototype <obsidian://vault/03%20Knowledge%2Fkitelev%2Fsleep-prototype.md> .
          ?s ems:Effort_startTimestamp ?start .
          ?s ems:Effort_endTimestamp ?end .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("count") as Literal).value).toBe("3");
    });
  });

  describe("Task Status Queries (Real Exocortex Pattern)", () => {
    beforeEach(async () => {
      // Create realistic task hierarchy
      const triples: Triple[] = [
        // Area: Work
        new Triple(
          new IRI("http://example.org/area-work"),
          RDF_TYPE,
          EMS_AREA
        ),
        new Triple(
          new IRI("http://example.org/area-work"),
          EXO_INSTANCE_CLASS,
          EMS_AREA
        ),
        new Triple(
          new IRI("http://example.org/area-work"),
          EXO_ASSET_LABEL,
          new Literal("Work", XSD_STRING)
        ),

        // Project: Exocortex
        new Triple(
          new IRI("http://example.org/proj-exocortex"),
          RDF_TYPE,
          EMS_PROJECT
        ),
        new Triple(
          new IRI("http://example.org/proj-exocortex"),
          EXO_INSTANCE_CLASS,
          EMS_PROJECT
        ),
        new Triple(
          new IRI("http://example.org/proj-exocortex"),
          EXO_ASSET_LABEL,
          new Literal("Exocortex Development", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/proj-exocortex"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/area-work")
        ),

        // Task 1: In progress
        new Triple(
          new IRI("http://example.org/task-1"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-1"),
          EXO_INSTANCE_CLASS,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-1"),
          EXO_ASSET_LABEL,
          new Literal("Implement SPARQL integration tests", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-1"),
          EMS_EFFORT_STATUS,
          new Literal("doing", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-1"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/proj-exocortex")
        ),

        // Task 2: Done
        new Triple(
          new IRI("http://example.org/task-2"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-2"),
          EXO_INSTANCE_CLASS,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-2"),
          EXO_ASSET_LABEL,
          new Literal("Write unit tests", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-2"),
          EMS_EFFORT_STATUS,
          new Literal("done", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-2"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/proj-exocortex")
        ),

        // Task 3: Todo
        new Triple(
          new IRI("http://example.org/task-3"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-3"),
          EXO_INSTANCE_CLASS,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-3"),
          EXO_ASSET_LABEL,
          new Literal("Code review", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-3"),
          EMS_EFFORT_STATUS,
          new Literal("todo", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-3"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/proj-exocortex")
        ),

        // Task 4: Cancelled
        new Triple(
          new IRI("http://example.org/task-4"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-4"),
          EXO_INSTANCE_CLASS,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-4"),
          EXO_ASSET_LABEL,
          new Literal("Old approach", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-4"),
          EMS_EFFORT_STATUS,
          new Literal("cancelled", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-4"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/proj-exocortex")
        ),
      ];

      await store.addAll(triples);
    });

    it("should find active tasks (doing status)", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?task ?label
        WHERE {
          ?task exo:Instance_class ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_status "doing" .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Implement SPARQL integration tests");
    });

    it("should count tasks by status (GROUP BY)", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?status (COUNT(?task) AS ?count)
        WHERE {
          ?task exo:Instance_class ems:Task .
          ?task ems:Effort_status ?status .
        }
        GROUP BY ?status
        ORDER BY DESC(?count)
      `;

      const results = await executeQuery(query);

      expect(results.length).toBeGreaterThan(0);

      const statusCounts = new Map<string, number>();
      for (const r of results) {
        const status = (r.get("status") as Literal).value;
        const count = parseInt((r.get("count") as Literal).value, 10);
        statusCounts.set(status, count);
      }

      expect(statusCounts.get("doing")).toBe(1);
      expect(statusCounts.get("done")).toBe(1);
      expect(statusCounts.get("todo")).toBe(1);
      expect(statusCounts.get("cancelled")).toBe(1);
    });

    it("should find tasks under specific project", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?task ?label ?status
        WHERE {
          ?task exo:Instance_class ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_status ?status .
          ?task ems:Effort_parent <http://example.org/proj-exocortex> .
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(4);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toContain("Implement SPARQL integration tests");
      expect(labels).toContain("Write unit tests");
      expect(labels).toContain("Code review");
      expect(labels).toContain("Old approach");
    });

    it("should exclude cancelled tasks using FILTER NOT IN", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?task ?label ?status
        WHERE {
          ?task exo:Instance_class ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_status ?status .
          FILTER(?status NOT IN ("cancelled", "dropped"))
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);
      const statuses = results.map((r) => (r.get("status") as Literal).value);
      expect(statuses).not.toContain("cancelled");
    });

    it("should find incomplete tasks using FILTER IN", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?task ?label ?status
        WHERE {
          ?task exo:Instance_class ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_status ?status .
          FILTER(?status IN ("todo", "doing"))
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const statuses = results.map((r) => (r.get("status") as Literal).value);
      expect(statuses).toContain("todo");
      expect(statuses).toContain("doing");
    });
  });

  describe("Hierarchy Navigation Queries", () => {
    beforeEach(async () => {
      // Create multi-level hierarchy: Area -> Project -> Task
      const triples: Triple[] = [
        // Area 1
        new Triple(new IRI("http://example.org/area-1"), RDF_TYPE, EMS_AREA),
        new Triple(
          new IRI("http://example.org/area-1"),
          EXO_ASSET_LABEL,
          new Literal("Area 1", XSD_STRING)
        ),

        // Project 1 under Area 1
        new Triple(new IRI("http://example.org/proj-1"), RDF_TYPE, EMS_PROJECT),
        new Triple(
          new IRI("http://example.org/proj-1"),
          EXO_ASSET_LABEL,
          new Literal("Project 1", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/proj-1"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/area-1")
        ),

        // Project 2 under Area 1
        new Triple(new IRI("http://example.org/proj-2"), RDF_TYPE, EMS_PROJECT),
        new Triple(
          new IRI("http://example.org/proj-2"),
          EXO_ASSET_LABEL,
          new Literal("Project 2", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/proj-2"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/area-1")
        ),

        // Tasks under Project 1
        new Triple(new IRI("http://example.org/task-1-1"), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI("http://example.org/task-1-1"),
          EXO_ASSET_LABEL,
          new Literal("Task 1.1", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-1-1"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/proj-1")
        ),

        new Triple(new IRI("http://example.org/task-1-2"), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI("http://example.org/task-1-2"),
          EXO_ASSET_LABEL,
          new Literal("Task 1.2", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-1-2"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/proj-1")
        ),

        // Tasks under Project 2
        new Triple(new IRI("http://example.org/task-2-1"), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI("http://example.org/task-2-1"),
          EXO_ASSET_LABEL,
          new Literal("Task 2.1", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-2-1"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/proj-2")
        ),
      ];

      await store.addAll(triples);
    });

    it("should navigate from area to projects", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?project ?projectLabel
        WHERE {
          ?project rdf:type ems:Project .
          ?project exo:Asset_label ?projectLabel .
          ?project ems:Effort_parent <http://example.org/area-1> .
        }
        ORDER BY ?projectLabel
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("projectLabel") as Literal).value);
      expect(labels).toEqual(["Project 1", "Project 2"]);
    });

    it("should navigate from project to tasks", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?task ?taskLabel
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?taskLabel .
          ?task ems:Effort_parent <http://example.org/proj-1> .
        }
        ORDER BY ?taskLabel
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("taskLabel") as Literal).value);
      expect(labels).toEqual(["Task 1.1", "Task 1.2"]);
    });

    it("should join area, project, and task in single query", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?areaLabel ?projectLabel ?taskLabel
        WHERE {
          ?area rdf:type ems:Area .
          ?area exo:Asset_label ?areaLabel .
          ?project rdf:type ems:Project .
          ?project exo:Asset_label ?projectLabel .
          ?project ems:Effort_parent ?area .
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?taskLabel .
          ?task ems:Effort_parent ?project .
        }
        ORDER BY ?areaLabel ?projectLabel ?taskLabel
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3); // 3 tasks total
      expect((results[0].get("areaLabel") as Literal).value).toBe("Area 1");
    });

    it("should count tasks per project", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?projectLabel (COUNT(?task) AS ?taskCount)
        WHERE {
          ?project rdf:type ems:Project .
          ?project exo:Asset_label ?projectLabel .
          ?task rdf:type ems:Task .
          ?task ems:Effort_parent ?project .
        }
        GROUP BY ?projectLabel
        ORDER BY DESC(?taskCount)
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);

      const projectCounts = new Map<string, number>();
      for (const r of results) {
        const label = (r.get("projectLabel") as Literal).value;
        const count = parseInt((r.get("taskCount") as Literal).value, 10);
        projectCounts.set(label, count);
      }

      expect(projectCounts.get("Project 1")).toBe(2);
      expect(projectCounts.get("Project 2")).toBe(1);
    });
  });

  describe("Entity Search Queries", () => {
    beforeEach(async () => {
      const triples: Triple[] = [
        // Tasks with various labels
        new Triple(
          new IRI("http://example.org/task-1"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-1"),
          EXO_ASSET_LABEL,
          new Literal("Fix critical bug in SPARQL parser", XSD_STRING)
        ),

        new Triple(
          new IRI("http://example.org/task-2"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-2"),
          EXO_ASSET_LABEL,
          new Literal("Write SPARQL documentation", XSD_STRING)
        ),

        new Triple(
          new IRI("http://example.org/task-3"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-3"),
          EXO_ASSET_LABEL,
          new Literal("Review pull request", XSD_STRING)
        ),

        // Projects
        new Triple(
          new IRI("http://example.org/proj-1"),
          RDF_TYPE,
          EMS_PROJECT
        ),
        new Triple(
          new IRI("http://example.org/proj-1"),
          EXO_ASSET_LABEL,
          new Literal("SPARQL Engine Improvements", XSD_STRING)
        ),
      ];

      await store.addAll(triples);
    });

    it("should search entities by keyword (CONTAINS)", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?entity ?label ?type
        WHERE {
          ?entity exo:Asset_label ?label .
          ?entity rdf:type ?type .
          FILTER(CONTAINS(LCASE(?label), "sparql"))
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual([
        "Fix critical bug in SPARQL parser",
        "SPARQL Engine Improvements",
        "Write SPARQL documentation",
      ]);
    });

    it("should search tasks only using type filter", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER(CONTAINS(LCASE(?label), "sparql"))
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual([
        "Fix critical bug in SPARQL parser",
        "Write SPARQL documentation",
      ]);
    });

    it("should search using REGEX pattern", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER(REGEX(?label, "^(Fix|Write)", "i"))
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toContain("Fix critical bug in SPARQL parser");
      expect(labels).toContain("Write SPARQL documentation");
    });
  });

  describe("Multi-Type Entity Queries (UNION)", () => {
    beforeEach(async () => {
      const triples: Triple[] = [
        // Task
        new Triple(new IRI("http://example.org/task-1"), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI("http://example.org/task-1"),
          EXO_ASSET_LABEL,
          new Literal("Task Item", XSD_STRING)
        ),

        // Project
        new Triple(new IRI("http://example.org/proj-1"), RDF_TYPE, EMS_PROJECT),
        new Triple(
          new IRI("http://example.org/proj-1"),
          EXO_ASSET_LABEL,
          new Literal("Project Item", XSD_STRING)
        ),

        // Area
        new Triple(new IRI("http://example.org/area-1"), RDF_TYPE, EMS_AREA),
        new Triple(
          new IRI("http://example.org/area-1"),
          EXO_ASSET_LABEL,
          new Literal("Area Item", XSD_STRING)
        ),
      ];

      await store.addAll(triples);
    });

    it("should find all entity types using VALUES", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?entity ?label ?type
        WHERE {
          ?entity rdf:type ?type .
          ?entity exo:Asset_label ?label .
          VALUES ?type { ems:Task ems:Project ems:Area }
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual(["Area Item", "Project Item", "Task Item"]);
    });

    it("should find all entity types using UNION", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?entity ?label ?type
        WHERE {
          {
            ?entity rdf:type ems:Task .
            ?entity exo:Asset_label ?label .
            BIND(ems:Task AS ?type)
          }
          UNION
          {
            ?entity rdf:type ems:Project .
            ?entity exo:Asset_label ?label .
            BIND(ems:Project AS ?type)
          }
          UNION
          {
            ?entity rdf:type ems:Area .
            ?entity exo:Asset_label ?label .
            BIND(ems:Area AS ?type)
          }
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);
    });
  });

  describe("Date/Time Queries", () => {
    beforeEach(async () => {
      const triples: Triple[] = [
        // Task with timestamps
        new Triple(
          new IRI("http://example.org/task-1"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-1"),
          EXO_ASSET_LABEL,
          new Literal("Morning Task", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-1"),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T08:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI("http://example.org/task-1"),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T09:30:00.000Z", XSD_DATETIME)
        ),

        new Triple(
          new IRI("http://example.org/task-2"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-2"),
          EXO_ASSET_LABEL,
          new Literal("Afternoon Task", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-2"),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T14:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI("http://example.org/task-2"),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T16:00:00.000Z", XSD_DATETIME)
        ),

        new Triple(
          new IRI("http://example.org/task-3"),
          RDF_TYPE,
          EMS_TASK
        ),
        new Triple(
          new IRI("http://example.org/task-3"),
          EXO_ASSET_LABEL,
          new Literal("Yesterday Task", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-3"),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-14T10:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI("http://example.org/task-3"),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-14T12:00:00.000Z", XSD_DATETIME)
        ),
      ];

      await store.addAll(triples);
    });

    it("should filter tasks by date range", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

        SELECT ?task ?label ?start
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_startTimestamp ?start .
          FILTER(?start >= "2025-01-15T00:00:00.000Z"^^xsd:dateTime)
        }
        ORDER BY ?start
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual(["Morning Task", "Afternoon Task"]);
    });

    it("should order tasks by start timestamp", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?task ?label ?start
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_startTimestamp ?start .
        }
        ORDER BY DESC(?start)
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual(["Afternoon Task", "Morning Task", "Yesterday Task"]);
    });
  });

  describe("Complex Queries with Multiple Patterns", () => {
    beforeEach(async () => {
      const triples: Triple[] = [
        // Area
        new Triple(new IRI("http://example.org/area-1"), RDF_TYPE, EMS_AREA),
        new Triple(
          new IRI("http://example.org/area-1"),
          EXO_ASSET_LABEL,
          new Literal("Development", XSD_STRING)
        ),

        // Project
        new Triple(new IRI("http://example.org/proj-1"), RDF_TYPE, EMS_PROJECT),
        new Triple(
          new IRI("http://example.org/proj-1"),
          EXO_ASSET_LABEL,
          new Literal("Exocortex", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/proj-1"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/area-1")
        ),
        new Triple(
          new IRI("http://example.org/proj-1"),
          EMS_EFFORT_STATUS,
          new Literal("doing", XSD_STRING)
        ),

        // Task 1: Done
        new Triple(new IRI("http://example.org/task-1"), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI("http://example.org/task-1"),
          EXO_ASSET_LABEL,
          new Literal("Setup CI", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-1"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/proj-1")
        ),
        new Triple(
          new IRI("http://example.org/task-1"),
          EMS_EFFORT_STATUS,
          new Literal("done", XSD_STRING)
        ),

        // Task 2: Doing
        new Triple(new IRI("http://example.org/task-2"), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI("http://example.org/task-2"),
          EXO_ASSET_LABEL,
          new Literal("Write tests", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-2"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/proj-1")
        ),
        new Triple(
          new IRI("http://example.org/task-2"),
          EMS_EFFORT_STATUS,
          new Literal("doing", XSD_STRING)
        ),

        // Task 3: Todo
        new Triple(new IRI("http://example.org/task-3"), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI("http://example.org/task-3"),
          EXO_ASSET_LABEL,
          new Literal("Deploy", XSD_STRING)
        ),
        new Triple(
          new IRI("http://example.org/task-3"),
          EMS_EFFORT_PARENT,
          new IRI("http://example.org/proj-1")
        ),
        new Triple(
          new IRI("http://example.org/task-3"),
          EMS_EFFORT_STATUS,
          new Literal("todo", XSD_STRING)
        ),
      ];

      await store.addAll(triples);
    });

    it("should find project with task summary using subquery", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?projectLabel ?taskCount
        WHERE {
          ?project rdf:type ems:Project .
          ?project exo:Asset_label ?projectLabel .
          {
            SELECT ?project (COUNT(?task) AS ?taskCount)
            WHERE {
              ?task rdf:type ems:Task .
              ?task ems:Effort_parent ?project .
            }
            GROUP BY ?project
          }
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("projectLabel") as Literal).value).toBe("Exocortex");
      expect((results[0].get("taskCount") as Literal).value).toBe("3");
    });

    it("should find full path from area to tasks", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?areaLabel ?projectLabel ?taskLabel ?taskStatus
        WHERE {
          ?area rdf:type ems:Area .
          ?area exo:Asset_label ?areaLabel .

          ?project rdf:type ems:Project .
          ?project exo:Asset_label ?projectLabel .
          ?project ems:Effort_parent ?area .

          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?taskLabel .
          ?task ems:Effort_parent ?project .
          ?task ems:Effort_status ?taskStatus .
        }
        ORDER BY ?taskStatus ?taskLabel
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);

      // Verify all results have correct path
      for (const r of results) {
        expect((r.get("areaLabel") as Literal).value).toBe("Development");
        expect((r.get("projectLabel") as Literal).value).toBe("Exocortex");
      }
    });

    it("should filter by project status and task status", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?projectLabel ?taskLabel
        WHERE {
          ?project rdf:type ems:Project .
          ?project exo:Asset_label ?projectLabel .
          ?project ems:Effort_status "doing" .

          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?taskLabel .
          ?task ems:Effort_parent ?project .
          ?task ems:Effort_status ?taskStatus .

          FILTER(?taskStatus IN ("todo", "doing"))
        }
        ORDER BY ?taskLabel
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("taskLabel") as Literal).value);
      expect(labels).toEqual(["Deploy", "Write tests"]);
    });
  });
});
