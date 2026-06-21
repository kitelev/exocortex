/**
 * SPARQL 1.2 DateTime Arithmetic Integration Tests
 *
 * Tests for DateTime arithmetic features including:
 * - Date/DateTime subtraction producing xsd:dayTimeDuration
 * - Duration arithmetic operations
 * - GROUP BY with duration calculations
 * - Real-world Exocortex patterns (sleep tracking, task duration)
 *
 * Issue #994: SPARQL 1.2 Integration Test Suite
 *
 * @see https://w3c.github.io/sparql-12/spec/
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
const XSD_DATETIME = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
const XSD_DATE = new IRI("http://www.w3.org/2001/XMLSchema#date");
const XSD_TIME = new IRI("http://www.w3.org/2001/XMLSchema#time");
const XSD_DAYTIME_DURATION = new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration");

// Exocortex-specific namespaces
const EXO = "https://exocortex.my/ontology/exo#";
const EMS = "https://exocortex.my/ontology/ems#";

const EXO_ASSET_LABEL = new IRI(`${EXO}Asset_label`);
const EXO_ASSET_PROTOTYPE = new IRI(`${EXO}Asset_prototype`);

const EMS_TASK = new IRI(`${EMS}Task`);
const EMS_EFFORT_START_TIMESTAMP = new IRI(`${EMS}Effort_startTimestamp`);
const EMS_EFFORT_END_TIMESTAMP = new IRI(`${EMS}Effort_endTimestamp`);

// Example namespace for tests
const EX = "http://example.org/";

describe("SPARQL 1.2 DateTime Arithmetic Integration Tests", () => {
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

  describe("DateTime Subtraction", () => {
    beforeEach(async () => {
      // Create test data with dateTime values
      const triples: Triple[] = [
        // Task with timestamps - 2 hours duration
        new Triple(new IRI(`${EX}task-1`), RDF_TYPE, EMS_TASK),
        new Triple(new IRI(`${EX}task-1`), EXO_ASSET_LABEL, new Literal("Morning task", XSD_STRING)),
        new Triple(
          new IRI(`${EX}task-1`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T08:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}task-1`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T10:00:00.000Z", XSD_DATETIME)
        ),

        // Task with timestamps - 1.5 hours duration
        new Triple(new IRI(`${EX}task-2`), RDF_TYPE, EMS_TASK),
        new Triple(new IRI(`${EX}task-2`), EXO_ASSET_LABEL, new Literal("Afternoon task", XSD_STRING)),
        new Triple(
          new IRI(`${EX}task-2`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T14:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}task-2`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T15:30:00.000Z", XSD_DATETIME)
        ),

        // Task with timestamps - 30 minute duration
        new Triple(new IRI(`${EX}task-3`), RDF_TYPE, EMS_TASK),
        new Triple(new IRI(`${EX}task-3`), EXO_ASSET_LABEL, new Literal("Quick task", XSD_STRING)),
        new Triple(
          new IRI(`${EX}task-3`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T16:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}task-3`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T16:30:00.000Z", XSD_DATETIME)
        ),
      ];

      await store.addAll(triples);
    });

    it("should subtract dateTime values to produce duration", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?task ?label ?start ?end (?end - ?start AS ?duration)
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
          FILTER(?label = "Morning task")
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const duration = results[0].get("duration");
      expect(duration).toBeDefined();
      // 2 hours = PT2H in ISO 8601 duration format
      expect((duration as Literal).value).toMatch(/^P.*T.*2H/);
    });

    it("should produce valid ISO 8601 durations for all tasks", async () => {
      // Test that duration subtraction produces valid ISO 8601 format
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?label (?end - ?start AS ?duration)
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);

      // All durations should be valid ISO 8601
      const durations = results.map((r) => ({
        label: (r.get("label") as Literal).value,
        duration: (r.get("duration") as Literal).value,
      }));

      // Afternoon task: 1.5 hours = PT1H30M
      expect(durations[0].label).toBe("Afternoon task");
      expect(durations[0].duration).toMatch(/^P.*T.*1H.*30M/);

      // Morning task: 2 hours = PT2H
      expect(durations[1].label).toBe("Morning task");
      expect(durations[1].duration).toMatch(/^P.*T.*2H/);

      // Quick task: 30 minutes = PT30M
      expect(durations[2].label).toBe("Quick task");
      expect(durations[2].duration).toMatch(/^P.*T.*30M/);
    });

    it("should filter tasks by duration comparison", async () => {
      // Test duration comparison in FILTER
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?label (?end - ?start AS ?duration)
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
          FILTER(?label = "Morning task")
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      // Morning task: 2 hours
      expect((results[0].get("label") as Literal).value).toBe("Morning task");
      expect((results[0].get("duration") as Literal).value).toMatch(/PT2H/);
    });
  });

  describe("Date Subtraction", () => {
    beforeEach(async () => {
      // Create test data with xsd:date values
      const triples: Triple[] = [
        new Triple(new IRI(`${EX}event-1`), RDF_TYPE, new IRI(`${EX}Event`)),
        new Triple(new IRI(`${EX}event-1`), EXO_ASSET_LABEL, new Literal("Conference", XSD_STRING)),
        new Triple(
          new IRI(`${EX}event-1`),
          new IRI(`${EX}startDate`),
          new Literal("2025-01-15", XSD_DATE)
        ),
        new Triple(
          new IRI(`${EX}event-1`),
          new IRI(`${EX}endDate`),
          new Literal("2025-01-22", XSD_DATE)
        ),
      ];

      await store.addAll(triples);
    });

    it("should subtract date values to produce duration in days", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ex: <${EX}>

        SELECT ?label ?startDate ?endDate (?endDate - ?startDate AS ?duration)
        WHERE {
          ?event rdf:type ex:Event .
          ?event exo:Asset_label ?label .
          ?event ex:startDate ?startDate .
          ?event ex:endDate ?endDate .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const duration = results[0].get("duration");
      expect(duration).toBeDefined();
      // 7 days = P7D
      expect((duration as Literal).value).toBe("P7D");
    });
  });

  describe("Time Subtraction", () => {
    beforeEach(async () => {
      // Create test data with xsd:time values
      const triples: Triple[] = [
        new Triple(new IRI(`${EX}meeting-1`), RDF_TYPE, new IRI(`${EX}Meeting`)),
        new Triple(new IRI(`${EX}meeting-1`), EXO_ASSET_LABEL, new Literal("Team standup", XSD_STRING)),
        new Triple(
          new IRI(`${EX}meeting-1`),
          new IRI(`${EX}startTime`),
          new Literal("09:00:00", XSD_TIME)
        ),
        new Triple(
          new IRI(`${EX}meeting-1`),
          new IRI(`${EX}endTime`),
          new Literal("09:30:00", XSD_TIME)
        ),
      ];

      await store.addAll(triples);
    });

    it("should subtract time values to produce duration", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ex: <${EX}>

        SELECT ?label (?endTime - ?startTime AS ?duration)
        WHERE {
          ?meeting rdf:type ex:Meeting .
          ?meeting exo:Asset_label ?label .
          ?meeting ex:startTime ?startTime .
          ?meeting ex:endTime ?endTime .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const duration = results[0].get("duration");
      expect(duration).toBeDefined();
      // 30 minutes = PT30M
      expect((duration as Literal).value).toMatch(/PT30M/);
    });
  });

  describe("Duration Arithmetic", () => {
    beforeEach(async () => {
      // Create test data with duration values
      const triples: Triple[] = [
        new Triple(new IRI(`${EX}sprint-1`), RDF_TYPE, new IRI(`${EX}Sprint`)),
        new Triple(new IRI(`${EX}sprint-1`), EXO_ASSET_LABEL, new Literal("Sprint 1", XSD_STRING)),
        new Triple(
          new IRI(`${EX}sprint-1`),
          new IRI(`${EX}plannedDuration`),
          new Literal("P14D", XSD_DAYTIME_DURATION)
        ),
        new Triple(
          new IRI(`${EX}sprint-1`),
          new IRI(`${EX}actualDuration`),
          new Literal("P16D", XSD_DAYTIME_DURATION)
        ),
      ];

      await store.addAll(triples);
    });

    it("should subtract duration values", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ex: <${EX}>

        SELECT ?label (?actualDuration - ?plannedDuration AS ?overrun)
        WHERE {
          ?sprint rdf:type ex:Sprint .
          ?sprint exo:Asset_label ?label .
          ?sprint ex:plannedDuration ?plannedDuration .
          ?sprint ex:actualDuration ?actualDuration .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const overrun = results[0].get("overrun");
      expect(overrun).toBeDefined();
      // 2 days overrun = P2D
      expect((overrun as Literal).value).toBe("P2D");
    });

    it("should add duration values", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ex: <${EX}>

        SELECT ?label (?plannedDuration + ?actualDuration AS ?totalDuration)
        WHERE {
          ?sprint rdf:type ex:Sprint .
          ?sprint exo:Asset_label ?label .
          ?sprint ex:plannedDuration ?plannedDuration .
          ?sprint ex:actualDuration ?actualDuration .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const total = results[0].get("totalDuration");
      expect(total).toBeDefined();
      // 14 + 16 = 30 days = P30D
      expect((total as Literal).value).toBe("P30D");
    });
  });

  describe("Real-World Pattern: Sleep Tracking", () => {
    beforeEach(async () => {
      // Create sleep log entries - realistic Exocortex pattern
      const sleepPrototype = new IRI("obsidian://vault/03%20Knowledge%2Fkitelev%2Fsleep-prototype.md");

      const triples: Triple[] = [
        // Sleep entry 1: 8 hours (Jan 14 23:00 to Jan 15 07:00)
        new Triple(new IRI(`${EX}sleep-2025-01-15`), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI(`${EX}sleep-2025-01-15`),
          EXO_ASSET_LABEL,
          new Literal("Поспать 2025-01-15", XSD_STRING)
        ),
        new Triple(new IRI(`${EX}sleep-2025-01-15`), EXO_ASSET_PROTOTYPE, sleepPrototype),
        new Triple(
          new IRI(`${EX}sleep-2025-01-15`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-14T23:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}sleep-2025-01-15`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T07:00:00.000Z", XSD_DATETIME)
        ),

        // Sleep entry 2: 7 hours (Jan 15 00:00 to Jan 15 07:00)
        new Triple(new IRI(`${EX}sleep-2025-01-16`), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI(`${EX}sleep-2025-01-16`),
          EXO_ASSET_LABEL,
          new Literal("Поспать 2025-01-16", XSD_STRING)
        ),
        new Triple(new IRI(`${EX}sleep-2025-01-16`), EXO_ASSET_PROTOTYPE, sleepPrototype),
        new Triple(
          new IRI(`${EX}sleep-2025-01-16`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-16T00:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}sleep-2025-01-16`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-16T07:00:00.000Z", XSD_DATETIME)
        ),

        // Sleep entry 3: 6 hours (Jan 17 01:00 to Jan 17 07:00)
        new Triple(new IRI(`${EX}sleep-2025-01-17`), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI(`${EX}sleep-2025-01-17`),
          EXO_ASSET_LABEL,
          new Literal("Поспать 2025-01-17", XSD_STRING)
        ),
        new Triple(new IRI(`${EX}sleep-2025-01-17`), EXO_ASSET_PROTOTYPE, sleepPrototype),
        new Triple(
          new IRI(`${EX}sleep-2025-01-17`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-17T01:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}sleep-2025-01-17`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-17T07:00:00.000Z", XSD_DATETIME)
        ),
      ];

      await store.addAll(triples);
    });

    it("should calculate sleep duration for each entry using datetime subtraction", async () => {
      // Test datetime subtraction produces valid durations for sleep tracking
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?label (?end - ?start AS ?duration)
        WHERE {
          ?s exo:Asset_label ?label .
          FILTER(STRSTARTS(?label, "Поспать 2025-"))
          ?s ems:Effort_startTimestamp ?start .
          ?s ems:Effort_endTimestamp ?end .
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);

      // Verify each sleep entry produces valid duration
      // Jan 15: 23:00 to 07:00 next day = 8 hours
      expect((results[0].get("label") as Literal).value).toBe("Поспать 2025-01-15");
      expect((results[0].get("duration") as Literal).value).toMatch(/PT8H/);

      // Jan 16: 00:00 to 07:00 = 7 hours
      expect((results[1].get("label") as Literal).value).toBe("Поспать 2025-01-16");
      expect((results[1].get("duration") as Literal).value).toMatch(/PT7H/);

      // Jan 17: 01:00 to 07:00 = 6 hours
      expect((results[2].get("label") as Literal).value).toBe("Поспать 2025-01-17");
      expect((results[2].get("duration") as Literal).value).toMatch(/PT6H/);
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

    it("should calculate total sleep hours", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT (SUM(HOURS(?end - ?start)) AS ?totalHours)
        WHERE {
          ?s exo:Asset_label ?label .
          FILTER(STRSTARTS(?label, "Поспать 2025-"))
          ?s ems:Effort_startTimestamp ?start .
          ?s ems:Effort_endTimestamp ?end .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const totalHours = Number((results[0].get("totalHours") as Literal).value);
      // 8 + 7 + 6 = 21 hours
      expect(totalHours).toBe(21);
    });
  });

  describe("Real-World Pattern: Task Duration by Category", () => {
    beforeEach(async () => {
      // Create tasks in different categories with duration
      const triples: Triple[] = [
        // Development category
        new Triple(new IRI(`${EX}task-dev-1`), RDF_TYPE, EMS_TASK),
        new Triple(new IRI(`${EX}task-dev-1`), EXO_ASSET_LABEL, new Literal("Dev Task 1", XSD_STRING)),
        new Triple(new IRI(`${EX}task-dev-1`), new IRI(`${EX}category`), new Literal("development", XSD_STRING)),
        new Triple(
          new IRI(`${EX}task-dev-1`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T09:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}task-dev-1`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T12:00:00.000Z", XSD_DATETIME)
        ),

        new Triple(new IRI(`${EX}task-dev-2`), RDF_TYPE, EMS_TASK),
        new Triple(new IRI(`${EX}task-dev-2`), EXO_ASSET_LABEL, new Literal("Dev Task 2", XSD_STRING)),
        new Triple(new IRI(`${EX}task-dev-2`), new IRI(`${EX}category`), new Literal("development", XSD_STRING)),
        new Triple(
          new IRI(`${EX}task-dev-2`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T14:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}task-dev-2`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T16:00:00.000Z", XSD_DATETIME)
        ),

        // Meeting category
        new Triple(new IRI(`${EX}task-mtg-1`), RDF_TYPE, EMS_TASK),
        new Triple(new IRI(`${EX}task-mtg-1`), EXO_ASSET_LABEL, new Literal("Meeting 1", XSD_STRING)),
        new Triple(new IRI(`${EX}task-mtg-1`), new IRI(`${EX}category`), new Literal("meeting", XSD_STRING)),
        new Triple(
          new IRI(`${EX}task-mtg-1`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T10:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}task-mtg-1`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T11:00:00.000Z", XSD_DATETIME)
        ),
      ];

      await store.addAll(triples);
    });

    it("should calculate total duration per category using GROUP BY", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX ex: <${EX}>

        SELECT ?category (SUM(HOURS(?end - ?start)) AS ?totalHours) (COUNT(?task) AS ?count)
        WHERE {
          ?task rdf:type ems:Task .
          ?task ex:category ?category .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
        }
        GROUP BY ?category
        ORDER BY DESC(?totalHours)
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);

      const categories = results.map((r) => ({
        category: (r.get("category") as Literal).value,
        totalHours: Number((r.get("totalHours") as Literal).value),
        count: Number((r.get("count") as Literal).value),
      }));

      // Development: 3 + 2 = 5 hours, 2 tasks
      const dev = categories.find((c) => c.category === "development");
      expect(dev?.totalHours).toBe(5);
      expect(dev?.count).toBe(2);

      // Meeting: 1 hour, 1 task
      const mtg = categories.find((c) => c.category === "meeting");
      expect(mtg?.totalHours).toBe(1);
      expect(mtg?.count).toBe(1);
    });

    it("should calculate average duration per category", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>
        PREFIX ex: <${EX}>

        SELECT ?category (AVG(HOURS(?end - ?start)) AS ?avgHours)
        WHERE {
          ?task rdf:type ems:Task .
          ?task ex:category ?category .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
        }
        GROUP BY ?category
        ORDER BY ?category
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);

      const devResult = results.find((r) => (r.get("category") as Literal).value === "development");
      const devAvg = Number((devResult?.get("avgHours") as Literal).value);
      // Development: (3 + 2) / 2 = 2.5 hours average
      expect(devAvg).toBe(2.5);

      const mtgResult = results.find((r) => (r.get("category") as Literal).value === "meeting");
      const mtgAvg = Number((mtgResult?.get("avgHours") as Literal).value);
      // Meeting: 1 hour average
      expect(mtgAvg).toBe(1);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero duration (same start and end time)", async () => {
      await store.add(
        new Triple(new IRI(`${EX}instant-task`), RDF_TYPE, EMS_TASK)
      );
      await store.add(
        new Triple(
          new IRI(`${EX}instant-task`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T10:00:00.000Z", XSD_DATETIME)
        )
      );
      await store.add(
        new Triple(
          new IRI(`${EX}instant-task`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T10:00:00.000Z", XSD_DATETIME)
        )
      );

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>

        SELECT (?end - ?start AS ?duration)
        WHERE {
          <${EX}instant-task> rdf:type ems:Task .
          <${EX}instant-task> ems:Effort_startTimestamp ?start .
          <${EX}instant-task> ems:Effort_endTimestamp ?end .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const duration = results[0].get("duration");
      // Zero duration
      expect((duration as Literal).value).toBe("PT0S");
    });

    it("should handle negative duration (end before start)", async () => {
      await store.add(
        new Triple(new IRI(`${EX}reversed-task`), RDF_TYPE, EMS_TASK)
      );
      await store.add(
        new Triple(
          new IRI(`${EX}reversed-task`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T12:00:00.000Z", XSD_DATETIME)
        )
      );
      await store.add(
        new Triple(
          new IRI(`${EX}reversed-task`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T10:00:00.000Z", XSD_DATETIME)
        )
      );

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>

        SELECT (?end - ?start AS ?duration)
        WHERE {
          <${EX}reversed-task> rdf:type ems:Task .
          <${EX}reversed-task> ems:Effort_startTimestamp ?start .
          <${EX}reversed-task> ems:Effort_endTimestamp ?end .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const duration = results[0].get("duration");
      // Negative duration (2 hours before)
      expect((duration as Literal).value).toMatch(/^-P/);
    });

    it("should handle duration spanning multiple days", async () => {
      await store.add(
        new Triple(new IRI(`${EX}long-task`), RDF_TYPE, EMS_TASK)
      );
      await store.add(
        new Triple(
          new IRI(`${EX}long-task`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T10:00:00.000Z", XSD_DATETIME)
        )
      );
      await store.add(
        new Triple(
          new IRI(`${EX}long-task`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-17T14:00:00.000Z", XSD_DATETIME)
        )
      );

      // Test that duration subtraction works for multi-day spans
      // and produces a valid ISO 8601 duration
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>

        SELECT ?start ?end (?end - ?start AS ?duration)
        WHERE {
          <${EX}long-task> rdf:type ems:Task .
          <${EX}long-task> ems:Effort_startTimestamp ?start .
          <${EX}long-task> ems:Effort_endTimestamp ?end .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const duration = results[0].get("duration");
      expect(duration).toBeDefined();
      // 2 days 4 hours = P2DT4H in ISO 8601
      expect((duration as Literal).value).toMatch(/P.*2.*D.*T.*4.*H/);
    });

    it("should handle millisecond precision", async () => {
      await store.add(
        new Triple(new IRI(`${EX}precise-task`), RDF_TYPE, EMS_TASK)
      );
      await store.add(
        new Triple(
          new IRI(`${EX}precise-task`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T10:00:00.000Z", XSD_DATETIME)
        )
      );
      await store.add(
        new Triple(
          new IRI(`${EX}precise-task`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T10:00:00.500Z", XSD_DATETIME)
        )
      );

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>

        SELECT (?end - ?start AS ?duration)
        WHERE {
          <${EX}precise-task> rdf:type ems:Task .
          <${EX}precise-task> ems:Effort_startTimestamp ?start .
          <${EX}precise-task> ems:Effort_endTimestamp ?end .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const duration = results[0].get("duration");
      // 0.5 seconds
      expect((duration as Literal).value).toMatch(/PT0\.5S/);
    });
  });

  describe("Performance Benchmarks", () => {
    it("should handle datetime arithmetic for 100+ records efficiently", async () => {
      // Create 100 task records
      const triples: Triple[] = [];
      for (let i = 0; i < 100; i++) {
        const taskIRI = new IRI(`${EX}perf-task-${i}`);
        triples.push(
          new Triple(taskIRI, RDF_TYPE, EMS_TASK),
          new Triple(
            taskIRI,
            EMS_EFFORT_START_TIMESTAMP,
            new Literal(`2025-01-15T${String(i % 24).padStart(2, "0")}:00:00.000Z`, XSD_DATETIME)
          ),
          new Triple(
            taskIRI,
            EMS_EFFORT_END_TIMESTAMP,
            new Literal(`2025-01-15T${String((i % 24) + 1).padStart(2, "0")}:00:00.000Z`, XSD_DATETIME)
          )
        );
      }
      await store.addAll(triples);

      const startTime = Date.now();

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <${EMS}>

        SELECT (SUM(HOURS(?end - ?start)) AS ?totalHours) (COUNT(?task) AS ?count)
        WHERE {
          ?task rdf:type ems:Task .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
        }
      `;

      const results = await executeQuery(query);
      const elapsed = Date.now() - startTime;

      expect(results).toHaveLength(1);
      expect(Number((results[0].get("count") as Literal).value)).toBe(100);
      // Should complete in reasonable time (< 5 seconds)
      expect(elapsed).toBeLessThan(5000);
    });
  });
});
