/**
 * SPARQL 1.2 Combined Features Integration Tests
 *
 * Tests for combining multiple SPARQL 1.2 features in real-world scenarios:
 * - DateTime subtraction producing ISO 8601 durations
 * - DirectionalLangTagTransformer for query preprocessing
 * - Real-world Exocortex data patterns
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
import { DirectionalLangTagTransformer } from "../../../src/infrastructure/sparql/DirectionalLangTagTransformer";

// Standard namespace URIs
const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const XSD_STRING = new IRI("http://www.w3.org/2001/XMLSchema#string");
const XSD_DATETIME = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
const RDFS_LABEL = new IRI("http://www.w3.org/2000/01/rdf-schema#label");

// Exocortex namespaces
const EXO = "https://exocortex.my/ontology/exo#";
const EMS = "https://exocortex.my/ontology/ems#";

const EXO_ASSET_LABEL = new IRI(`${EXO}Asset_label`);
const EXO_ASSET_PROTOTYPE = new IRI(`${EXO}Asset_prototype`);
const EMS_TASK = new IRI(`${EMS}Task`);
const EMS_PROJECT = new IRI(`${EMS}Project`);
const EMS_AREA = new IRI(`${EMS}Area`);
const EMS_EFFORT_START_TIMESTAMP = new IRI(`${EMS}Effort_startTimestamp`);
const EMS_EFFORT_END_TIMESTAMP = new IRI(`${EMS}Effort_endTimestamp`);
const EMS_EFFORT_STATUS = new IRI(`${EMS}Effort_status`);
const EMS_BELONGS_TO_PROJECT = new IRI(`${EMS}belongs_to_project`);
const EMS_BELONGS_TO_AREA = new IRI(`${EMS}belongs_to_area`);

const EX = "http://example.org/";

describe("SPARQL 1.2 Combined Features Integration Tests", () => {
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

  describe("Real-World Exocortex Pattern: Sleep Tracking with Duration Subtraction", () => {
    beforeEach(async () => {
      const sleepPrototype = new IRI(
        "obsidian://vault/03%20Knowledge%2Fkitelev%2Fsleep-prototype.md"
      );

      const triples: Triple[] = [
        // Sleep entry 1: 8 hours (Jan 15 23:00 to Jan 16 07:00)
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
          new Literal("2025-01-15T23:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}sleep-2025-01-15`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-16T07:00:00.000Z", XSD_DATETIME)
        ),

        // Sleep entry 2: 7 hours (Jan 16 00:00 to Jan 16 07:00)
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

    it("should calculate sleep durations using datetime subtraction", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?label (?end - ?start AS ?duration)
        WHERE {
          ?task exo:Asset_label ?label .
          FILTER(STRSTARTS(?label, "Поспать 2025-"))
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);

      // Jan 15: 8 hours
      expect((results[0].get("label") as Literal).value).toBe("Поспать 2025-01-15");
      expect((results[0].get("duration") as Literal).value).toMatch(/PT8H/);

      // Jan 16: 7 hours
      expect((results[1].get("label") as Literal).value).toBe("Поспать 2025-01-16");
      expect((results[1].get("duration") as Literal).value).toMatch(/PT7H/);

      // Jan 17: 6 hours
      expect((results[2].get("label") as Literal).value).toBe("Поспать 2025-01-17");
      expect((results[2].get("duration") as Literal).value).toMatch(/PT6H/);
    });

    it("should count sleep entries matching prototype", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT (COUNT(?task) AS ?count)
        WHERE {
          ?task exo:Asset_prototype <obsidian://vault/03%20Knowledge%2Fkitelev%2Fsleep-prototype.md> .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("count") as Literal).value).toBe("3");
    });

    it("should filter sleep entries by label pattern", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?label (?end - ?start AS ?duration)
        WHERE {
          ?task exo:Asset_label ?label .
          FILTER(CONTAINS(?label, "2025-01-15"))
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Поспать 2025-01-15");
      // 8 hours = PT8H
      expect((results[0].get("duration") as Literal).value).toMatch(/PT8H/);
    });
  });

  describe("Real-World Exocortex Pattern: Task Time Tracking by Project", () => {
    beforeEach(async () => {
      const project1 = new IRI(`${EX}project-exocortex`);
      const project2 = new IRI(`${EX}project-other`);
      const area = new IRI(`${EX}area-development`);

      const triples: Triple[] = [
        // Area
        new Triple(area, RDF_TYPE, EMS_AREA),
        new Triple(area, EXO_ASSET_LABEL, new Literal("Development", XSD_STRING)),

        // Project 1: Exocortex
        new Triple(project1, RDF_TYPE, EMS_PROJECT),
        new Triple(project1, EXO_ASSET_LABEL, new Literal("Exocortex", XSD_STRING)),
        new Triple(project1, EMS_BELONGS_TO_AREA, area),

        // Project 2: Other
        new Triple(project2, RDF_TYPE, EMS_PROJECT),
        new Triple(project2, EXO_ASSET_LABEL, new Literal("Other Project", XSD_STRING)),
        new Triple(project2, EMS_BELONGS_TO_AREA, area),

        // Task 1: 2 hours on Exocortex
        new Triple(new IRI(`${EX}task-1`), RDF_TYPE, EMS_TASK),
        new Triple(new IRI(`${EX}task-1`), EXO_ASSET_LABEL, new Literal("SPARQL Engine", XSD_STRING)),
        new Triple(new IRI(`${EX}task-1`), EMS_BELONGS_TO_PROJECT, project1),
        new Triple(new IRI(`${EX}task-1`), EMS_EFFORT_STATUS, new Literal("done", XSD_STRING)),
        new Triple(
          new IRI(`${EX}task-1`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T09:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}task-1`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T11:00:00.000Z", XSD_DATETIME)
        ),

        // Task 2: 3 hours on Exocortex
        new Triple(new IRI(`${EX}task-2`), RDF_TYPE, EMS_TASK),
        new Triple(new IRI(`${EX}task-2`), EXO_ASSET_LABEL, new Literal("CLI Commands", XSD_STRING)),
        new Triple(new IRI(`${EX}task-2`), EMS_BELONGS_TO_PROJECT, project1),
        new Triple(new IRI(`${EX}task-2`), EMS_EFFORT_STATUS, new Literal("done", XSD_STRING)),
        new Triple(
          new IRI(`${EX}task-2`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-15T14:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}task-2`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-15T17:00:00.000Z", XSD_DATETIME)
        ),

        // Task 3: 1 hour on Other Project
        new Triple(new IRI(`${EX}task-3`), RDF_TYPE, EMS_TASK),
        new Triple(new IRI(`${EX}task-3`), EXO_ASSET_LABEL, new Literal("Documentation", XSD_STRING)),
        new Triple(new IRI(`${EX}task-3`), EMS_BELONGS_TO_PROJECT, project2),
        new Triple(new IRI(`${EX}task-3`), EMS_EFFORT_STATUS, new Literal("in_progress", XSD_STRING)),
        new Triple(
          new IRI(`${EX}task-3`),
          EMS_EFFORT_START_TIMESTAMP,
          new Literal("2025-01-16T10:00:00.000Z", XSD_DATETIME)
        ),
        new Triple(
          new IRI(`${EX}task-3`),
          EMS_EFFORT_END_TIMESTAMP,
          new Literal("2025-01-16T11:00:00.000Z", XSD_DATETIME)
        ),
      ];

      await store.addAll(triples);
    });

    it("should find all tasks with their durations", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?taskLabel (?end - ?start AS ?duration)
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?taskLabel .
          ?task ems:Effort_startTimestamp ?start .
          ?task ems:Effort_endTimestamp ?end .
        }
        ORDER BY ?taskLabel
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);

      // CLI Commands: 3 hours
      expect((results[0].get("taskLabel") as Literal).value).toBe("CLI Commands");
      expect((results[0].get("duration") as Literal).value).toMatch(/PT3H/);

      // Documentation: 1 hour
      expect((results[1].get("taskLabel") as Literal).value).toBe("Documentation");
      expect((results[1].get("duration") as Literal).value).toMatch(/PT1H/);

      // SPARQL Engine: 2 hours
      expect((results[2].get("taskLabel") as Literal).value).toBe("SPARQL Engine");
      expect((results[2].get("duration") as Literal).value).toMatch(/PT2H/);
    });

    it("should count tasks by project", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?projectLabel (COUNT(?task) AS ?taskCount)
        WHERE {
          ?task rdf:type ems:Task .
          ?task ems:belongs_to_project ?project .
          ?project exo:Asset_label ?projectLabel .
        }
        GROUP BY ?project ?projectLabel
        ORDER BY DESC(?taskCount)
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);

      // Exocortex has 2 tasks
      expect((results[0].get("projectLabel") as Literal).value).toBe("Exocortex");
      expect((results[0].get("taskCount") as Literal).value).toBe("2");

      // Other Project has 1 task
      expect((results[1].get("projectLabel") as Literal).value).toBe("Other Project");
      expect((results[1].get("taskCount") as Literal).value).toBe("1");
    });

    it("should group tasks by status", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
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

      expect(results).toHaveLength(2);

      // 2 done tasks
      expect((results[0].get("status") as Literal).value).toBe("done");
      expect((results[0].get("count") as Literal).value).toBe("2");

      // 1 in_progress task
      expect((results[1].get("status") as Literal).value).toBe("in_progress");
      expect((results[1].get("count") as Literal).value).toBe("1");
    });

    it("should traverse project to area hierarchy", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?taskLabel ?projectLabel ?areaLabel
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?taskLabel .
          ?task ems:belongs_to_project ?project .
          ?project exo:Asset_label ?projectLabel .
          ?project ems:belongs_to_area ?area .
          ?area exo:Asset_label ?areaLabel .
        }
        ORDER BY ?taskLabel
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(3);

      // All tasks should belong to Development area
      results.forEach((r) => {
        expect((r.get("areaLabel") as Literal).value).toBe("Development");
      });
    });
  });

  describe("Multilingual Content with DirectionalLangTagTransformer", () => {
    let transformer: DirectionalLangTagTransformer;

    beforeEach(async () => {
      transformer = new DirectionalLangTagTransformer();

      const triples: Triple[] = [
        // English LTR content
        new Triple(new IRI(`${EX}doc-en`), RDF_TYPE, new IRI(`${EX}Document`)),
        new Triple(
          new IRI(`${EX}doc-en`),
          RDFS_LABEL,
          new Literal("Hello World", undefined, "en", "ltr")
        ),

        // Arabic RTL content
        new Triple(new IRI(`${EX}doc-ar`), RDF_TYPE, new IRI(`${EX}Document`)),
        new Triple(
          new IRI(`${EX}doc-ar`),
          RDFS_LABEL,
          new Literal("مرحبا بالعالم", undefined, "ar", "rtl")
        ),

        // French (no direction)
        new Triple(new IRI(`${EX}doc-fr`), RDF_TYPE, new IRI(`${EX}Document`)),
        new Triple(
          new IRI(`${EX}doc-fr`),
          RDFS_LABEL,
          new Literal("Bonjour le monde", undefined, "fr")
        ),

        // Hebrew RTL content
        new Triple(new IRI(`${EX}doc-he`), RDF_TYPE, new IRI(`${EX}Document`)),
        new Triple(
          new IRI(`${EX}doc-he`),
          RDFS_LABEL,
          new Literal("שלום עולם", undefined, "he", "rtl")
        ),
      ];

      await store.addAll(triples);
    });

    it("should query documents preserving directional metadata", async () => {
      const query = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX ex: <${EX}>

        SELECT ?doc ?label
        WHERE {
          ?doc a ex:Document .
          ?doc rdfs:label ?label .
        }
        ORDER BY ?doc
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(4);

      // Check directional metadata is preserved
      const labels = results.map((r) => r.get("label") as Literal);

      // Arabic should have RTL direction
      const arabicLabel = labels.find((l) => l.language === "ar");
      expect(arabicLabel?.direction).toBe("rtl");

      // English should have LTR direction
      const englishLabel = labels.find((l) => l.language === "en");
      expect(englishLabel?.direction).toBe("ltr");

      // Hebrew should have RTL direction
      const hebrewLabel = labels.find((l) => l.language === "he");
      expect(hebrewLabel?.direction).toBe("rtl");

      // French should have no direction
      const frenchLabel = labels.find((l) => l.language === "fr");
      expect(frenchLabel?.direction).toBeUndefined();
    });

    it("should filter by specific language", async () => {
      const query = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX ex: <${EX}>

        SELECT ?label
        WHERE {
          ?doc a ex:Document .
          ?doc rdfs:label ?label .
          FILTER(LANG(?label) = "ar")
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      const label = results[0].get("label") as Literal;
      expect(label.value).toBe("مرحبا بالعالم");
      expect(label.direction).toBe("rtl");
    });

    it("should transform directional query with DirectionalLangTagTransformer", () => {
      // Input query with directional tag
      const inputQuery = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        SELECT ?s WHERE {
          ?s rdfs:label "مرحبا"@ar--rtl .
        }
      `;

      const transformed = transformer.transform(inputQuery);

      // Direction tag should be removed for parser compatibility
      expect(transformed).not.toContain("--rtl");
      expect(transformed).toContain("@ar");

      // But direction should be tracked
      expect(transformer.getDirection("ar")).toBe("rtl");
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty result set with aggregates", async () => {
      const query = `
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT (COUNT(?task) AS ?count)
        WHERE {
          ?task exo:Asset_label ?label .
          FILTER(?label = "NonexistentTask")
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("count") as Literal).value).toBe("0");
    });

    it("should handle OPTIONAL with missing timestamps", async () => {
      // Add task without timestamps
      await store.add(new Triple(new IRI(`${EX}incomplete-task`), RDF_TYPE, EMS_TASK));
      await store.add(
        new Triple(
          new IRI(`${EX}incomplete-task`),
          EXO_ASSET_LABEL,
          new Literal("Incomplete task", XSD_STRING)
        )
      );

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?label ?start ?end
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          OPTIONAL { ?task ems:Effort_startTimestamp ?start }
          OPTIONAL { ?task ems:Effort_endTimestamp ?end }
        }
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Incomplete task");
      expect(results[0].get("start")).toBeUndefined();
      expect(results[0].get("end")).toBeUndefined();
    });

    it("should handle combined FILTER conditions", async () => {
      // Add multiple tasks
      const triples = [
        new Triple(new IRI(`${EX}filtered-task-1`), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI(`${EX}filtered-task-1`),
          EXO_ASSET_LABEL,
          new Literal("Alpha Task", XSD_STRING)
        ),
        new Triple(new IRI(`${EX}filtered-task-2`), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI(`${EX}filtered-task-2`),
          EXO_ASSET_LABEL,
          new Literal("Beta Task", XSD_STRING)
        ),
        new Triple(new IRI(`${EX}filtered-task-3`), RDF_TYPE, EMS_TASK),
        new Triple(
          new IRI(`${EX}filtered-task-3`),
          EXO_ASSET_LABEL,
          new Literal("Gamma Task", XSD_STRING)
        ),
      ];

      await store.addAll(triples);

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <${EXO}>
        PREFIX ems: <${EMS}>

        SELECT ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          FILTER(CONTAINS(?label, "Task"))
          FILTER(STRSTARTS(?label, "A") || STRSTARTS(?label, "B"))
        }
        ORDER BY ?label
      `;

      const results = await executeQuery(query);

      expect(results).toHaveLength(2);
      expect((results[0].get("label") as Literal).value).toBe("Alpha Task");
      expect((results[1].get("label") as Literal).value).toBe("Beta Task");
    });
  });
});
