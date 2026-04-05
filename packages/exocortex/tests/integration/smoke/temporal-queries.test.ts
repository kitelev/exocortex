/**
 * Smoke test: Temporal Queries (RFC-013 / Issue #2599).
 *
 * Verifies ExoQL temporal query capabilities end-to-end:
 *   - Task age computation via dateTimeDiff + durationToDays
 *   - Effort duration via dateDiffMinutes
 *   - Weekly report filtering by literal date boundaries
 *   - Date-range FILTER on createdAt
 *   - Tasks created in the last N days via NOW() arithmetic
 *   - Effort duration aggregation (total minutes per status)
 *
 * Uses real (non-mocked) services: SPARQLParser, AlgebraTranslator,
 * AlgebraOptimizer, QueryExecutor, InMemoryTripleStore.
 *
 * NOTE: Temporal variables ($thisWeekStart etc.) are text substitutions
 * handled by PreconditionEvaluator and are NOT part of the executor.
 * These tests use literal date values instead.
 *
 * NOTE: Custom exo: functions (exo:dateDiffMinutes, exo:durationToDays, etc.)
 * return raw numbers through BIND, not Literal instances. Use toNumber()
 * helper to extract numeric values from either type.
 */

import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { AlgebraOptimizer } from "../../../src/infrastructure/sparql/algebra/AlgebraOptimizer";
import { QueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXO = "https://exocortex.my/ontology/exo#";
const EMS = "https://exocortex.my/ontology/ems#";

const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const XSD_STRING = new IRI("http://www.w3.org/2001/XMLSchema#string");
const XSD_DATETIME = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");

const EXO_ASSET_LABEL = new IRI(`${EXO}Asset_label`);
const EXO_ASSET_UID = new IRI(`${EXO}Asset_uid`);
const EXO_ASSET_CREATED_AT = new IRI(`${EXO}Asset_createdAt`);

const EMS_TASK = new IRI(`${EMS}Task`);
const EMS_EFFORT_STATUS = new IRI(`${EMS}Effort_status`);
const EMS_EFFORT_START_TIMESTAMP = new IRI(`${EMS}Effort_startTimestamp`);
const EMS_EFFORT_END_TIMESTAMP = new IRI(`${EMS}Effort_endTimestamp`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a numeric value from a query result binding.
 * Custom exo: functions return raw numbers via BIND, while
 * aggregates (SUM, COUNT, AVG) return Literal instances.
 */
function toNumber(val: unknown): number {
  if (val instanceof Literal) return parseFloat(val.value);
  return Number(val);
}

// ---------------------------------------------------------------------------
// Test Data Builder
// ---------------------------------------------------------------------------

class TemporalTestDataBuilder {
  private triples: Triple[] = [];

  createTask(
    id: string,
    label: string,
    options: {
      status?: string;
      createdAt?: string;
      startTimestamp?: string;
      endTimestamp?: string;
    } = {},
  ): this {
    const uri = new IRI(`http://example.org/${id}`);
    this.triples.push(
      new Triple(uri, RDF_TYPE, EMS_TASK),
      new Triple(uri, EXO_ASSET_LABEL, new Literal(label, XSD_STRING)),
      new Triple(uri, EXO_ASSET_UID, new Literal(id, XSD_STRING)),
    );

    if (options.status) {
      this.triples.push(
        new Triple(
          uri,
          EMS_EFFORT_STATUS,
          new IRI(`http://example.org/${options.status}`),
        ),
      );
    }

    if (options.createdAt) {
      this.triples.push(
        new Triple(
          uri,
          EXO_ASSET_CREATED_AT,
          new Literal(options.createdAt, XSD_DATETIME),
        ),
      );
    }

    if (options.startTimestamp) {
      this.triples.push(
        new Triple(
          uri,
          EMS_EFFORT_START_TIMESTAMP,
          new Literal(options.startTimestamp, XSD_DATETIME),
        ),
      );
    }

    if (options.endTimestamp) {
      this.triples.push(
        new Triple(
          uri,
          EMS_EFFORT_END_TIMESTAMP,
          new Literal(options.endTimestamp, XSD_DATETIME),
        ),
      );
    }

    return this;
  }

  createStatus(id: string, label: string): this {
    const uri = new IRI(`http://example.org/${id}`);
    this.triples.push(
      new Triple(uri, EXO_ASSET_LABEL, new Literal(label, XSD_STRING)),
      new Triple(uri, EXO_ASSET_UID, new Literal(id, XSD_STRING)),
    );
    return this;
  }

  build(): Triple[] {
    return this.triples;
  }
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Smoke: Temporal Queries (Issue #2599)", () => {
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

  // -----------------------------------------------------------------------
  // Scenario 1: Task age via dateTimeDiff + durationToDays
  // -----------------------------------------------------------------------

  describe("Task age computation", () => {
    beforeEach(async () => {
      const builder = new TemporalTestDataBuilder()
        .createTask("task-old", "Old task", {
          createdAt: "2024-01-01T00:00:00Z",
        })
        .createTask("task-recent", "Recent task", {
          createdAt: "2024-06-15T12:00:00Z",
        })
        .createTask("task-new", "New task", {
          createdAt: "2024-12-01T08:00:00Z",
        });

      await store.addAll(builder.build());
    });

    it("should compute task age in days using dateTimeDiff and durationToDays", async () => {
      // Compute days between createdAt and a fixed reference date (2024-12-31)
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

        SELECT ?label ?ageDays
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task exo:Asset_createdAt ?createdAt .
          BIND(exo:durationToDays(exo:dateTimeDiff("2024-12-31T00:00:00Z"^^xsd:dateTime, ?createdAt)) AS ?ageDays)
        }
        ORDER BY DESC(?ageDays)
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);

      // Old task: 2024-01-01 -> 2024-12-31 = 365 days
      const oldTask = results.find(
        (r) => (r.get("label") as Literal).value === "Old task",
      );
      expect(oldTask).toBeDefined();
      expect(toNumber(oldTask!.get("ageDays"))).toBeCloseTo(365, 0);

      // Recent task: 2024-06-15T12:00 -> 2024-12-31T00:00 = ~198.5 days
      const recentTask = results.find(
        (r) => (r.get("label") as Literal).value === "Recent task",
      );
      expect(recentTask).toBeDefined();
      expect(toNumber(recentTask!.get("ageDays"))).toBeCloseTo(198.5, 0);

      // New task: 2024-12-01T08:00 -> 2024-12-31T00:00 = ~29.67 days
      const newTask = results.find(
        (r) => (r.get("label") as Literal).value === "New task",
      );
      expect(newTask).toBeDefined();
      expect(toNumber(newTask!.get("ageDays"))).toBeCloseTo(29.67, 0);
    });

    it("should filter tasks older than 180 days from reference date", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

        SELECT ?label ?ageDays
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task exo:Asset_createdAt ?createdAt .
          BIND(exo:durationToDays(exo:dateTimeDiff("2024-12-31T00:00:00Z"^^xsd:dateTime, ?createdAt)) AS ?ageDays)
          FILTER(?ageDays > 180)
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toContain("Old task");
      expect(labels).toContain("Recent task");
      expect(labels).not.toContain("New task");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 2: Effort duration via dateDiffMinutes
  // -----------------------------------------------------------------------

  describe("Effort duration computation", () => {
    beforeEach(async () => {
      const builder = new TemporalTestDataBuilder()
        .createStatus("status-done", "Done")
        .createStatus("status-doing", "Doing")
        .createTask("task-quick", "Quick task", {
          status: "status-done",
          startTimestamp: "2024-03-10T09:00:00Z",
          endTimestamp: "2024-03-10T09:30:00Z",
        })
        .createTask("task-long", "Long task", {
          status: "status-done",
          startTimestamp: "2024-03-10T08:00:00Z",
          endTimestamp: "2024-03-10T12:00:00Z",
        })
        .createTask("task-active", "Active task", {
          status: "status-doing",
          startTimestamp: "2024-03-10T14:00:00Z",
        });

      await store.addAll(builder.build());
    });

    it("should compute effort duration in minutes for completed tasks", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

        SELECT ?label ?durationMinutes
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
          BIND(exo:dateDiffMinutes(?end, ?start) AS ?durationMinutes)
        }
        ORDER BY ?durationMinutes
      `;

      const results = await executeQuery(query);

      // Only tasks with both start and end timestamps (task-active has no end)
      expect(results).toHaveLength(2);

      // Quick task: 30 minutes
      const quick = results.find(
        (r) => (r.get("label") as Literal).value === "Quick task",
      );
      expect(quick).toBeDefined();
      expect(toNumber(quick!.get("durationMinutes"))).toBe(30);

      // Long task: 240 minutes (4 hours)
      const long = results.find(
        (r) => (r.get("label") as Literal).value === "Long task",
      );
      expect(long).toBeDefined();
      expect(toNumber(long!.get("durationMinutes"))).toBe(240);
    });

    it("should compute effort duration in hours using dateDiffHours", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

        SELECT ?label ?durationHours
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
          BIND(exo:dateDiffHours(?end, ?start) AS ?durationHours)
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);

      const long = results.find(
        (r) => (r.get("label") as Literal).value === "Long task",
      );
      expect(long).toBeDefined();
      expect(toNumber(long!.get("durationHours"))).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3: Weekly report with literal date boundaries
  // -----------------------------------------------------------------------

  describe("Weekly report with date boundaries", () => {
    beforeEach(async () => {
      // Simulate a weekly report for the week of 2024-03-11 to 2024-03-17
      const builder = new TemporalTestDataBuilder()
        .createStatus("status-done", "Done")
        .createTask("task-prev-week", "Previous week task", {
          status: "status-done",
          startTimestamp: "2024-03-04T09:00:00Z",
          endTimestamp: "2024-03-08T17:00:00Z",
        })
        .createTask("task-this-week-1", "This week task 1", {
          status: "status-done",
          startTimestamp: "2024-03-11T09:00:00Z",
          endTimestamp: "2024-03-11T11:00:00Z",
        })
        .createTask("task-this-week-2", "This week task 2", {
          status: "status-done",
          startTimestamp: "2024-03-13T14:00:00Z",
          endTimestamp: "2024-03-13T16:30:00Z",
        })
        .createTask("task-next-week", "Next week task", {
          status: "status-done",
          startTimestamp: "2024-03-18T08:00:00Z",
          endTimestamp: "2024-03-18T10:00:00Z",
        });

      await store.addAll(builder.build());
    });

    it("should find tasks completed within a specific week", async () => {
      // In production, $thisWeekStart and $lastWeekStart are substituted
      // by PreconditionEvaluator. Here we use literal values.
      const thisWeekStart = "2024-03-11T00:00:00Z";
      const thisWeekEnd = "2024-03-18T00:00:00Z";

      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

        SELECT ?label ?end
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_endTimestamp ?end .
          FILTER(
            ?end >= "${thisWeekStart}"^^xsd:dateTime &&
            ?end < "${thisWeekEnd}"^^xsd:dateTime
          )
        }
        ORDER BY ?end
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toContain("This week task 1");
      expect(labels).toContain("This week task 2");
      expect(labels).not.toContain("Previous week task");
      expect(labels).not.toContain("Next week task");
    });

    it("should compute total effort minutes for the week", async () => {
      const thisWeekStart = "2024-03-11T00:00:00Z";
      const thisWeekEnd = "2024-03-18T00:00:00Z";

      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

        SELECT (SUM(?minutes) AS ?totalMinutes) (COUNT(?task) AS ?taskCount)
        WHERE {
          ?task rdf:type ems:Task .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
          FILTER(
            ?end >= "${thisWeekStart}"^^xsd:dateTime &&
            ?end < "${thisWeekEnd}"^^xsd:dateTime
          )
          BIND(exo:dateDiffMinutes(?end, ?start) AS ?minutes)
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);

      // Task 1: 2h = 120min, Task 2: 2.5h = 150min => total = 270
      expect(toNumber(results[0].get("totalMinutes"))).toBe(270);
      expect(toNumber(results[0].get("taskCount"))).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 4: Date-range FILTER on createdAt
  // -----------------------------------------------------------------------

  describe("Date-range FILTER on createdAt", () => {
    beforeEach(async () => {
      const builder = new TemporalTestDataBuilder()
        .createTask("task-q1", "Q1 Task", {
          createdAt: "2024-02-15T10:00:00Z",
        })
        .createTask("task-q2", "Q2 Task", {
          createdAt: "2024-05-20T14:00:00Z",
        })
        .createTask("task-q3", "Q3 Task", {
          createdAt: "2024-08-10T09:00:00Z",
        })
        .createTask("task-q4", "Q4 Task", {
          createdAt: "2024-11-05T16:00:00Z",
        });

      await store.addAll(builder.build());
    });

    it("should filter tasks created in Q2 (April-June 2024)", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

        SELECT ?label ?createdAt
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task exo:Asset_createdAt ?createdAt .
          FILTER(
            ?createdAt >= "2024-04-01T00:00:00Z"^^xsd:dateTime &&
            ?createdAt < "2024-07-01T00:00:00Z"^^xsd:dateTime
          )
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Q2 Task");
    });

    it("should filter tasks created in the second half of 2024", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

        SELECT ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task exo:Asset_createdAt ?createdAt .
          FILTER(?createdAt >= "2024-07-01T00:00:00Z"^^xsd:dateTime)
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toContain("Q3 Task");
      expect(labels).toContain("Q4 Task");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 5: Tasks created in last N days via NOW() arithmetic
  // -----------------------------------------------------------------------

  describe("Recent tasks via NOW() arithmetic", () => {
    it("should use NOW() and dateTimeSubtract to define a time boundary", async () => {
      // Seed tasks: one created "now" and one created far in the past
      const now = new Date();
      const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days ago

      const builder = new TemporalTestDataBuilder()
        .createTask("task-recent-now", "Recently created", {
          createdAt: recentDate.toISOString(),
        })
        .createTask("task-old-now", "Created long ago", {
          createdAt: oldDate.toISOString(),
        });

      await store.addAll(builder.build());

      // Find tasks created in the last 7 days using NOW() - P7D
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

        SELECT ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task exo:Asset_createdAt ?createdAt .
          BIND(exo:dateTimeSubtract(NOW(), "P7D"^^xsd:dayTimeDuration) AS ?cutoff)
          FILTER(?createdAt >= ?cutoff)
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe(
        "Recently created",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 6: Effort duration aggregation (total per status)
  // -----------------------------------------------------------------------

  describe("Effort duration aggregation per status", () => {
    beforeEach(async () => {
      const builder = new TemporalTestDataBuilder()
        .createStatus("status-done", "Done")
        .createStatus("status-doing", "Doing")
        // Done tasks
        .createTask("task-done-1", "Done task 1", {
          status: "status-done",
          startTimestamp: "2024-03-10T09:00:00Z",
          endTimestamp: "2024-03-10T10:00:00Z", // 60 min
        })
        .createTask("task-done-2", "Done task 2", {
          status: "status-done",
          startTimestamp: "2024-03-11T13:00:00Z",
          endTimestamp: "2024-03-11T15:30:00Z", // 150 min
        })
        .createTask("task-done-3", "Done task 3", {
          status: "status-done",
          startTimestamp: "2024-03-12T08:00:00Z",
          endTimestamp: "2024-03-12T08:45:00Z", // 45 min
        });

      await store.addAll(builder.build());
    });

    it("should aggregate total effort minutes across completed tasks", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

        SELECT (SUM(?minutes) AS ?totalMinutes) (COUNT(?task) AS ?taskCount) (AVG(?minutes) AS ?avgMinutes)
        WHERE {
          ?task rdf:type ems:Task .
          ?task ems:Effort_status <http://example.org/status-done> .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
          BIND(exo:dateDiffMinutes(?end, ?start) AS ?minutes)
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);

      // Total: 60 + 150 + 45 = 255 minutes
      expect(toNumber(results[0].get("totalMinutes"))).toBe(255);

      // Count: 3 tasks
      expect(toNumber(results[0].get("taskCount"))).toBe(3);

      // Average: 255 / 3 = 85 minutes
      expect(toNumber(results[0].get("avgMinutes"))).toBe(85);
    });

    it("should compute per-task duration alongside labels", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

        SELECT ?label ?minutes
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
          BIND(exo:dateDiffMinutes(?end, ?start) AS ?minutes)
        }
        ORDER BY ?minutes
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);

      // Verify each task has the correct duration (order may vary with raw numeric BIND)
      const taskDurations = results.map((r) => ({
        label: (r.get("label") as Literal).value,
        minutes: toNumber(r.get("minutes")),
      }));

      const done1 = taskDurations.find((t) => t.label === "Done task 1");
      expect(done1).toBeDefined();
      expect(done1!.minutes).toBe(60);

      const done2 = taskDurations.find((t) => t.label === "Done task 2");
      expect(done2).toBeDefined();
      expect(done2!.minutes).toBe(150);

      const done3 = taskDurations.find((t) => t.label === "Done task 3");
      expect(done3).toBeDefined();
      expect(done3!.minutes).toBe(45);
    });
  });
});
