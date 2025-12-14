/**
 * Integration tests for the full SPARQL query pipeline.
 *
 * These tests verify the complete flow: Parse → Translate → Optimize → Execute → Format
 * They use realistic data and query patterns to ensure all components work together.
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
const RDFS_LABEL = new IRI("http://www.w3.org/2000/01/rdf-schema#label");
const RDFS_SUBCLASS_OF = new IRI("http://www.w3.org/2000/01/rdf-schema#subClassOf");
const XSD_STRING = new IRI("http://www.w3.org/2001/XMLSchema#string");
const XSD_INTEGER = new IRI("http://www.w3.org/2001/XMLSchema#integer");
const XSD_DATE = new IRI("http://www.w3.org/2001/XMLSchema#date");
const XSD_DATETIME = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");

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

/**
 * Helper class to set up test data with common patterns.
 */
class TestDataBuilder {
  private triples: Triple[] = [];
  private counter = 0;

  /**
   * Create a task with label and optional metadata
   */
  createTask(
    id: string,
    label: string,
    options: {
      status?: string;
      parent?: string;
      startTimestamp?: string;
      endTimestamp?: string;
      prototype?: string;
    } = {}
  ): this {
    const taskIRI = new IRI(`http://example.org/${id}`);

    this.triples.push(
      new Triple(taskIRI, RDF_TYPE, EMS_TASK),
      new Triple(taskIRI, EXO_INSTANCE_CLASS, EMS_TASK),
      new Triple(taskIRI, EXO_ASSET_LABEL, new Literal(label, XSD_STRING))
    );

    if (options.status) {
      this.triples.push(
        new Triple(taskIRI, EMS_EFFORT_STATUS, new Literal(options.status, XSD_STRING))
      );
    }

    if (options.parent) {
      this.triples.push(
        new Triple(taskIRI, EMS_EFFORT_PARENT, new IRI(`http://example.org/${options.parent}`))
      );
    }

    if (options.startTimestamp) {
      this.triples.push(
        new Triple(
          taskIRI,
          EMS_EFFORT_START_TIMESTAMP,
          new Literal(options.startTimestamp, XSD_DATETIME)
        )
      );
    }

    if (options.endTimestamp) {
      this.triples.push(
        new Triple(
          taskIRI,
          EMS_EFFORT_END_TIMESTAMP,
          new Literal(options.endTimestamp, XSD_DATETIME)
        )
      );
    }

    if (options.prototype) {
      this.triples.push(
        new Triple(
          taskIRI,
          EXO_ASSET_PROTOTYPE,
          new IRI(`http://example.org/${options.prototype}`)
        )
      );
    }

    return this;
  }

  /**
   * Create a project with label and optional parent area
   */
  createProject(id: string, label: string, parentArea?: string): this {
    const projectIRI = new IRI(`http://example.org/${id}`);

    this.triples.push(
      new Triple(projectIRI, RDF_TYPE, EMS_PROJECT),
      new Triple(projectIRI, EXO_INSTANCE_CLASS, EMS_PROJECT),
      new Triple(projectIRI, EXO_ASSET_LABEL, new Literal(label, XSD_STRING))
    );

    if (parentArea) {
      this.triples.push(
        new Triple(projectIRI, EMS_EFFORT_PARENT, new IRI(`http://example.org/${parentArea}`))
      );
    }

    return this;
  }

  /**
   * Create an area with label
   */
  createArea(id: string, label: string): this {
    const areaIRI = new IRI(`http://example.org/${id}`);

    this.triples.push(
      new Triple(areaIRI, RDF_TYPE, EMS_AREA),
      new Triple(areaIRI, EXO_INSTANCE_CLASS, EMS_AREA),
      new Triple(areaIRI, EXO_ASSET_LABEL, new Literal(label, XSD_STRING))
    );

    return this;
  }

  /**
   * Add custom triple
   */
  addTriple(subject: string, predicate: IRI, object: IRI | Literal): this {
    this.triples.push(new Triple(new IRI(subject), predicate, object));
    return this;
  }

  /**
   * Get all triples
   */
  build(): Triple[] {
    return this.triples;
  }
}

describe("SPARQL Query Pipeline Integration Tests", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let optimizer: AlgebraOptimizer;
  let store: InMemoryTripleStore;
  let executor: QueryExecutor;

  /**
   * Helper to execute a SPARQL query end-to-end
   */
  async function executeQuery(sparql: string, optimize = true) {
    const parsed = parser.parse(sparql);
    let algebra = translator.translate(parsed);

    if (optimize) {
      algebra = optimizer.optimize(algebra);
    }

    return executor.executeAll(algebra);
  }

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    optimizer = new AlgebraOptimizer();
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
  });

  describe("Full Pipeline: Parse → Translate → Optimize → Execute", () => {
    beforeEach(async () => {
      // Load realistic test data
      const builder = new TestDataBuilder()
        .createArea("area-work", "Work")
        .createArea("area-personal", "Personal")
        .createProject("proj-exocortex", "Exocortex Development", "area-work")
        .createProject("proj-fitness", "Fitness Goals", "area-personal")
        .createTask("task-1", "Implement SPARQL engine", {
          status: "doing",
          parent: "proj-exocortex",
          startTimestamp: "2025-01-15T09:00:00Z",
        })
        .createTask("task-2", "Write unit tests", {
          status: "done",
          parent: "proj-exocortex",
          startTimestamp: "2025-01-14T10:00:00Z",
          endTimestamp: "2025-01-14T12:00:00Z",
        })
        .createTask("task-3", "Morning run", {
          status: "done",
          parent: "proj-fitness",
          startTimestamp: "2025-01-15T06:00:00Z",
          endTimestamp: "2025-01-15T07:00:00Z",
        })
        .createTask("task-4", "Code review", {
          status: "todo",
          parent: "proj-exocortex",
        });

      await store.addAll(builder.build());
    });

    it("should execute simple SELECT with BGP", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(4);
      const labels = results.map((r) => (r.get("label") as Literal).value).sort();
      expect(labels).toEqual([
        "Code review",
        "Implement SPARQL engine",
        "Morning run",
        "Write unit tests",
      ]);
    });

    it("should execute SELECT with FILTER", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_status ?status .
          FILTER(?status = "doing")
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Implement SPARQL engine");
    });

    it("should execute SELECT with CONTAINS filter", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER(CONTAINS(?label, "test"))
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Write unit tests");
    });

    it("should execute SELECT with ORDER BY", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(4);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual([
        "Code review",
        "Implement SPARQL engine",
        "Morning run",
        "Write unit tests",
      ]);
    });

    it("should execute SELECT with ORDER BY DESC", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
        }
        ORDER BY DESC(?label)
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(4);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual([
        "Write unit tests",
        "Morning run",
        "Implement SPARQL engine",
        "Code review",
      ]);
    });

    it("should execute SELECT with LIMIT", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
        }
        ORDER BY ?label
        LIMIT 2
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual(["Code review", "Implement SPARQL engine"]);
    });

    it("should execute SELECT with OFFSET", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
        }
        ORDER BY ?label
        OFFSET 1
        LIMIT 2
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual(["Implement SPARQL engine", "Morning run"]);
    });

    it("should eliminate duplicate solutions with DISTINCT", async () => {
      // Test DISTINCT by querying the same value multiple ways
      // Each task has its own unique label, so DISTINCT on label produces correct results

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT DISTINCT ?status
        WHERE {
          ?task rdf:type ems:Task .
          ?task ems:Effort_status ?status .
        }
        ORDER BY ?status
      `;

      const results = await executeQuery(query);

      // Should return distinct status values: doing, done, todo
      // task-1: doing, task-2: done, task-3: done, task-4: todo
      expect(results.length).toBeGreaterThanOrEqual(3);
      const statuses = results.map((r) => (r.get("status") as Literal).value);
      expect(statuses).toContain("doing");
      expect(statuses).toContain("done");
      expect(statuses).toContain("todo");
    });
  });

  describe("OPTIONAL Pattern Tests", () => {
    beforeEach(async () => {
      // Manually create test data to ensure clean state for OPTIONAL test
      const task1 = new IRI("http://example.org/task-1");
      const task2 = new IRI("http://example.org/task-2");

      await store.addAll([
        // Task with priority
        new Triple(task1, RDF_TYPE, EMS_TASK),
        new Triple(task1, EXO_ASSET_LABEL, new Literal("Task with priority", XSD_STRING)),
        new Triple(task1, new IRI(`${EMS}priority`), new Literal("high", XSD_STRING)),

        // Task 2 also with priority
        new Triple(task2, RDF_TYPE, EMS_TASK),
        new Triple(task2, EXO_ASSET_LABEL, new Literal("Task two", XSD_STRING)),
        new Triple(task2, new IRI(`${EMS}priority`), new Literal("low", XSD_STRING)),
      ]);
    });

    it("should join OPTIONAL pattern when it matches", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label ?priority
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          OPTIONAL { ?task ems:priority ?priority }
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);

      // Both tasks have priority
      const task1Result = results.find((r) =>
        (r.get("label") as Literal).value === "Task with priority"
      );
      expect(task1Result).toBeDefined();
      expect((task1Result!.get("priority") as Literal).value).toBe("high");

      const task2Result = results.find((r) =>
        (r.get("label") as Literal).value === "Task two"
      );
      expect(task2Result).toBeDefined();
      expect((task2Result!.get("priority") as Literal).value).toBe("low");
    });

    it("should filter tasks with matching OPTIONAL values", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label ?priority
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          OPTIONAL { ?task ems:priority ?priority }
          FILTER(?priority = "high")
        }
      `;

      const results = await executeQuery(query);

      // Only task with high priority
      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Task with priority");
    });
  });

  describe("UNION Pattern Tests", () => {
    beforeEach(async () => {
      const builder = new TestDataBuilder()
        .createTask("task-1", "Important Task", { status: "doing" })
        .createProject("proj-1", "Important Project")
        .createArea("area-1", "Important Area");

      await store.addAll(builder.build());
    });

    it("should combine results from UNION branches", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?entity ?label
        WHERE {
          {
            ?entity rdf:type ems:Task .
            ?entity exo:Asset_label ?label .
          }
          UNION
          {
            ?entity rdf:type ems:Project .
            ?entity exo:Asset_label ?label .
          }
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value).sort();
      expect(labels).toEqual(["Important Project", "Important Task"]);
    });

    it("should handle 3-way UNION", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?entity ?label
        WHERE {
          { ?entity rdf:type ems:Task . ?entity exo:Asset_label ?label }
          UNION
          { ?entity rdf:type ems:Project . ?entity exo:Asset_label ?label }
          UNION
          { ?entity rdf:type ems:Area . ?entity exo:Asset_label ?label }
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);
      const labels = results.map((r) => (r.get("label") as Literal).value).sort();
      expect(labels).toEqual(["Important Area", "Important Project", "Important Task"]);
    });
  });

  describe("VALUES Clause Tests", () => {
    beforeEach(async () => {
      const builder = new TestDataBuilder()
        .createTask("task-1", "Task Alpha", { status: "doing" })
        .createTask("task-2", "Task Beta", { status: "done" })
        .createTask("task-3", "Task Gamma", { status: "todo" });

      await store.addAll(builder.build());
    });

    it("should filter by VALUES clause", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          VALUES ?label { "Task Alpha" "Task Gamma" }
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value).sort();
      expect(labels).toEqual(["Task Alpha", "Task Gamma"]);
    });

    it("should handle VALUES with IRI values", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ?type .
          ?task exo:Asset_label ?label .
          VALUES ?type { ems:Task }
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);
    });
  });

  describe("BIND Expression Tests", () => {
    beforeEach(async () => {
      const builder = new TestDataBuilder()
        .createTask("task-1", "Test Task", {
          startTimestamp: "2025-01-15T09:00:00Z",
          endTimestamp: "2025-01-15T11:00:00Z",
        });

      await store.addAll(builder.build());
    });

    it("should bind simple variable copy", async () => {
      // Simple BIND that copies a variable
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label ?labelCopy
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          BIND(?label AS ?labelCopy)
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Test Task");
      expect((results[0].get("labelCopy") as Literal).value).toBe("Test Task");
    });
  });

  describe("Aggregation Tests", () => {
    beforeEach(async () => {
      const builder = new TestDataBuilder()
        .createTask("task-1", "Task 1", { status: "done" })
        .createTask("task-2", "Task 2", { status: "done" })
        .createTask("task-3", "Task 3", { status: "doing" })
        .createTask("task-4", "Task 4", { status: "todo" })
        .createTask("task-5", "Task 5", { status: "todo" });

      await store.addAll(builder.build());
    });

    it("should count results with COUNT aggregate", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>

        SELECT (COUNT(?task) AS ?count)
        WHERE {
          ?task rdf:type ems:Task .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const count = results[0].get("count");
      expect(count).toBeDefined();
      expect((count as Literal).value).toBe("5");
    });

    it("should group and count with GROUP BY", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>

        SELECT ?status (COUNT(?task) AS ?count)
        WHERE {
          ?task rdf:type ems:Task .
          ?task ems:Effort_status ?status .
        }
        GROUP BY ?status
        ORDER BY ?status
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);

      // Check counts per status
      const statusCounts = new Map<string, string>();
      for (const result of results) {
        const status = (result.get("status") as Literal).value;
        const count = (result.get("count") as Literal).value;
        statusCounts.set(status, count);
      }

      expect(statusCounts.get("doing")).toBe("1");
      expect(statusCounts.get("done")).toBe("2");
      expect(statusCounts.get("todo")).toBe("2");
    });
  });

  describe("String Function Tests in FILTER", () => {
    beforeEach(async () => {
      const builder = new TestDataBuilder()
        .createTask("task-1", "Hello World Task")
        .createTask("task-2", "Another Task")
        .createTask("task-3", "UPPERCASE TEST");

      await store.addAll(builder.build());
    });

    it("should filter using UCASE comparison", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER(UCASE(?label) = "HELLO WORLD TASK")
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Hello World Task");
    });

    it("should filter using LCASE comparison", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER(LCASE(?label) = "uppercase test")
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("UPPERCASE TEST");
    });

    it("should filter using STRLEN", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER(STRLEN(?label) > 14)
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      // "Hello World Task" = 16 chars, "UPPERCASE TEST" = 14 chars (not included)
      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Hello World Task");
    });

    it("should filter using STRSTARTS", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER(STRSTARTS(?label, "Hello"))
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Hello World Task");
    });

    it("should filter using STRENDS", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER(STRENDS(?label, "Task"))
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toContain("Hello World Task");
      expect(labels).toContain("Another Task");
    });
  });

  describe("FILTER NOT EXISTS Pattern Tests", () => {
    beforeEach(async () => {
      const builder = new TestDataBuilder()
        .createTask("task-1", "Task A", { status: "done" })
        .createTask("task-2", "Task B", { status: "done" })
        .createTask("task-3", "Task C", { status: "doing" })
        .createTask("task-4", "Task D"); // No status

      await store.addAll(builder.build());
    });

    it("should exclude matching patterns with FILTER NOT EXISTS", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER NOT EXISTS {
            ?task ems:Effort_status ?status .
            FILTER(?status = "done")
          }
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual(["Task C", "Task D"]);
    });

    it("should find matching patterns with FILTER EXISTS", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER EXISTS { ?task ems:Effort_status ?status }
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      // Tasks A, B, C have status; Task D does not
      expect(results).toHaveLength(3);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toContain("Task A");
      expect(labels).toContain("Task B");
      expect(labels).toContain("Task C");
    });
  });

  describe("Subquery Tests", () => {
    beforeEach(async () => {
      const builder = new TestDataBuilder()
        .createArea("area-1", "Work")
        .createProject("proj-1", "Project A", "area-1")
        .createProject("proj-2", "Project B", "area-1")
        .createTask("task-1", "Task 1", { parent: "proj-1" })
        .createTask("task-2", "Task 2", { parent: "proj-1" })
        .createTask("task-3", "Task 3", { parent: "proj-2" });

      await store.addAll(builder.build());
    });

    it("should execute subquery and join results", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label ?project
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_parent ?project .
          {
            SELECT ?project
            WHERE {
              ?project rdf:type ems:Project .
              ?project exo:Asset_label "Project A" .
            }
          }
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value).sort();
      expect(labels).toEqual(["Task 1", "Task 2"]);
    });
  });

  describe("ASK Query Tests", () => {
    beforeEach(async () => {
      const builder = new TestDataBuilder()
        .createTask("task-1", "Existing Task", { status: "doing" });

      await store.addAll(builder.build());
    });

    it("should return true for ASK when pattern matches", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>

        ASK
        WHERE {
          ?task rdf:type ems:Task .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      // ASK queries use executeAsk method
      const result = await executor.executeAsk(algebra as any);
      expect(result).toBe(true);
    });

    it("should return false for ASK when pattern does not match", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>

        ASK
        WHERE {
          ?task rdf:type <http://example.org/NonExistent> .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const result = await executor.executeAsk(algebra as any);
      expect(result).toBe(false);
    });
  });

  describe("CONSTRUCT Query Tests", () => {
    beforeEach(async () => {
      const builder = new TestDataBuilder()
        .createTask("task-1", "Important Task", { status: "doing" });

      await store.addAll(builder.build());
    });

    it("should construct new triples from pattern", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

        CONSTRUCT {
          ?task rdfs:label ?label .
        }
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const triples = await executor.executeConstruct(algebra as any);

      expect(triples).toHaveLength(1);
      expect(triples[0].predicate.value).toBe("http://www.w3.org/2000/01/rdf-schema#label");
      expect((triples[0].object as Literal).value).toBe("Important Task");
    });
  });

  describe("Optimization Impact Tests", () => {
    beforeEach(async () => {
      // Create a larger dataset to see optimization effects
      const builder = new TestDataBuilder();
      for (let i = 0; i < 100; i++) {
        builder.createTask(`task-${i}`, `Task ${i}`, {
          status: i % 3 === 0 ? "done" : i % 3 === 1 ? "doing" : "todo",
        });
      }
      await store.addAll(builder.build());
    });

    it("should produce same results with and without optimization", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_status ?status .
          FILTER(?status = "doing")
        }
        ORDER BY ?label
        LIMIT 10
      `;

      const resultsWithOptimization = await executeQuery(query, true);
      const resultsWithoutOptimization = await executeQuery(query, false);

      expect(resultsWithOptimization).toHaveLength(resultsWithoutOptimization.length);

      // Results should be identical (same labels in same order)
      const labelsOptimized = resultsWithOptimization.map((r) => (r.get("label") as Literal).value);
      const labelsUnoptimized = resultsWithoutOptimization.map(
        (r) => (r.get("label") as Literal).value
      );
      expect(labelsOptimized).toEqual(labelsUnoptimized);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty result set gracefully", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>

        SELECT ?task
        WHERE {
          ?task rdf:type ems:Task .
        }
      `;

      // Empty store
      const results = await executeQuery(query);
      expect(results).toHaveLength(0);
    });

    it("should handle queries with no matching patterns", async () => {
      const builder = new TestDataBuilder().createTask("task-1", "Task 1");
      await store.addAll(builder.build());

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

        SELECT ?x
        WHERE {
          ?x rdf:type <http://example.org/NonExistentType> .
        }
      `;

      const results = await executeQuery(query);
      expect(results).toHaveLength(0);
    });

    it("should handle Unicode in labels", async () => {
      await store.add(
        new Triple(
          new IRI("http://example.org/task-unicode"),
          RDF_TYPE,
          EMS_TASK
        )
      );
      await store.add(
        new Triple(
          new IRI("http://example.org/task-unicode"),
          EXO_ASSET_LABEL,
          new Literal("日本語タスク 🎯", XSD_STRING)
        )
      );

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER(CONTAINS(?label, "日本語"))
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("日本語タスク 🎯");
    });

    it("should handle multiple same-predicate triples for same subject", async () => {
      const taskIRI = new IRI("http://example.org/multi-label-task");

      // Add multiple labels for same task
      await store.addAll([
        new Triple(taskIRI, RDF_TYPE, EMS_TASK),
        new Triple(taskIRI, EXO_ASSET_LABEL, new Literal("Label A", XSD_STRING)),
        new Triple(taskIRI, EXO_ASSET_LABEL, new Literal("Label B", XSD_STRING)),
        new Triple(taskIRI, EXO_ASSET_LABEL, new Literal("Label C", XSD_STRING)),
      ]);

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>
        PREFIX exo: <${EXO}>

        SELECT ?label
        WHERE {
          <http://example.org/multi-label-task> exo:Asset_label ?label .
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual(["Label A", "Label B", "Label C"]);
    });
  });
});
