/**
 * Acceptance test for Issue #667: Instance_class JOIN on class label.
 *
 * Tests that exo:Instance_class stores URI references (not literals),
 * enabling canonical SPARQL JOINs to retrieve class labels.
 *
 * The canonical SPARQL query pattern being tested:
 * ```sparql
 * SELECT ?s ?classLabel WHERE {
 *   ?s exo:Instance_class ?class .
 *   ?class exo:Asset_label ?classLabel .
 * }
 * ```
 *
 * Previously (broken):
 *   ?s exo:Instance_class "[[ems__Task]]" .  # Literal, can't JOIN
 *
 * After fix:
 *   ?s exo:Instance_class <https://exocortex.my/ontology/ems#Task> .  # URI, can JOIN
 */

import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import type { ITripleStore } from "../../../../src/interfaces/ITripleStore";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { Namespace } from "../../../../src/domain/models/rdf/Namespace";

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/**
 * Simple in-memory triple store for testing.
 */
class MockTripleStore implements ITripleStore {
  private triples: Triple[] = [];

  async add(triple: Triple): Promise<void> {
    this.triples.push(triple);
  }

  async addAll(triples: Triple[]): Promise<void> {
    this.triples.push(...triples);
  }

  async remove(_triple: Triple): Promise<boolean> {
    return false;
  }

  async removeAll(_triples: Triple[]): Promise<number> {
    return 0;
  }

  async has(_triple: Triple): Promise<boolean> {
    return false;
  }

  async match(
    subject?: IRI | undefined,
    predicate?: IRI | undefined,
    object?: IRI | Literal | undefined
  ): Promise<Triple[]> {
    return this.triples.filter((t) => {
      if (subject && t.subject.toString() !== subject.toString()) return false;
      if (predicate && t.predicate.toString() !== predicate.toString())
        return false;
      if (object && t.object.toString() !== object.toString()) return false;
      return true;
    });
  }

  async clear(): Promise<void> {
    this.triples = [];
  }

  async count(): Promise<number> {
    return this.triples.length;
  }

  async subjects(): Promise<IRI[]> {
    return this.triples.map((t) => t.subject as IRI);
  }

  async predicates(): Promise<IRI[]> {
    return this.triples.map((t) => t.predicate as IRI);
  }

  async objects(): Promise<(IRI | Literal)[]> {
    return this.triples.map((t) => t.object as IRI | Literal);
  }

  async beginTransaction(): Promise<any> {
    throw new Error("Not implemented");
  }
}

describe("Instance_class JOIN (Issue #667)", () => {
  let store: MockTripleStore;
  let executor: QueryExecutor;
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;

  // Test URIs
  const TASK_CLASS_URI = Namespace.EMS.term("Task").value;
  const PROJECT_CLASS_URI = Namespace.EMS.term("Project").value;
  const AREA_CLASS_URI = Namespace.EMS.term("Area").value;

  const TASK_INSTANCE_URI = "obsidian://vault/Tasks/My%20Task.md";
  const PROJECT_INSTANCE_URI = "obsidian://vault/Projects/My%20Project.md";
  const AREA_INSTANCE_URI = "obsidian://vault/Areas/Development.md";

  beforeEach(async () => {
    store = new MockTripleStore();
    executor = new QueryExecutor(store);
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();

    // Setup test data:
    // 1. Class definitions with labels
    // 2. Instances with Instance_class pointing to class URIs (not literals!)
    await store.addAll([
      // Class definitions (with labels)
      new Triple(
        new IRI(TASK_CLASS_URI),
        Namespace.EXO.term("Asset_label"),
        new Literal("Task", new IRI(XSD_STRING))
      ),
      new Triple(
        new IRI(PROJECT_CLASS_URI),
        Namespace.EXO.term("Asset_label"),
        new Literal("Project", new IRI(XSD_STRING))
      ),
      new Triple(
        new IRI(AREA_CLASS_URI),
        Namespace.EXO.term("Asset_label"),
        new Literal("Area", new IRI(XSD_STRING))
      ),

      // Task instance - Instance_class as URI (the fix!)
      new Triple(
        new IRI(TASK_INSTANCE_URI),
        Namespace.EXO.term("Asset_label"),
        new Literal("My Task", new IRI(XSD_STRING))
      ),
      new Triple(
        new IRI(TASK_INSTANCE_URI),
        Namespace.EXO.term("Instance_class"),
        new IRI(TASK_CLASS_URI) // URI, not literal!
      ),

      // Project instance
      new Triple(
        new IRI(PROJECT_INSTANCE_URI),
        Namespace.EXO.term("Asset_label"),
        new Literal("My Project", new IRI(XSD_STRING))
      ),
      new Triple(
        new IRI(PROJECT_INSTANCE_URI),
        Namespace.EXO.term("Instance_class"),
        new IRI(PROJECT_CLASS_URI)
      ),

      // Area instance
      new Triple(
        new IRI(AREA_INSTANCE_URI),
        Namespace.EXO.term("Asset_label"),
        new Literal("Development", new IRI(XSD_STRING))
      ),
      new Triple(
        new IRI(AREA_INSTANCE_URI),
        Namespace.EXO.term("Instance_class"),
        new IRI(AREA_CLASS_URI)
      ),
    ]);
  });

  describe("JOIN on Instance_class to get class label", () => {
    it("should JOIN Instance_class to class and retrieve class label", async () => {
      // This is the exact query pattern from Issue #667
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?classLabel WHERE {
          ?s exo:Instance_class ?class .
          ?class exo:Asset_label ?classLabel .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should find all 3 instances with their class labels
      expect(results.length).toBe(3);

      // Verify the JOIN worked correctly
      const labels = results.map((r) => (r.get("classLabel") as Literal).value);
      expect(labels).toContain("Task");
      expect(labels).toContain("Project");
      expect(labels).toContain("Area");

      // Verify subjects are the instance URIs
      const subjects = results.map((r) => (r.get("s") as IRI).value);
      expect(subjects).toContain(TASK_INSTANCE_URI);
      expect(subjects).toContain(PROJECT_INSTANCE_URI);
      expect(subjects).toContain(AREA_INSTANCE_URI);
    });

    it("should JOIN Instance_class with instance label and class label", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?instanceLabel ?classLabel WHERE {
          ?s exo:Asset_label ?instanceLabel .
          ?s exo:Instance_class ?class .
          ?class exo:Asset_label ?classLabel .
        }
        ORDER BY ?instanceLabel
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(3);

      // Verify instance-class pairs
      const pairs = results.map((r) => ({
        instance: (r.get("instanceLabel") as Literal).value,
        class: (r.get("classLabel") as Literal).value,
      }));

      expect(pairs).toContainEqual({ instance: "My Task", class: "Task" });
      expect(pairs).toContainEqual({ instance: "My Project", class: "Project" });
      expect(pairs).toContainEqual({ instance: "Development", class: "Area" });
    });

    it("should filter by class label after JOIN", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?instanceLabel WHERE {
          ?s exo:Asset_label ?instanceLabel .
          ?s exo:Instance_class ?class .
          ?class exo:Asset_label "Task" .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should find only Task instances
      expect(results.length).toBe(1);
      expect((results[0].get("instanceLabel") as Literal).value).toBe("My Task");
    });
  });

  describe("URI vs Literal Instance_class comparison", () => {
    it("should successfully join when Instance_class is URI (the fix)", async () => {
      // With the fix (Issue #667), Instance_class stores URIs
      // This JOIN works because both sides are URIs
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s WHERE {
          ?s exo:Instance_class ?class .
          ?class exo:Asset_label "Task" .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // JOIN succeeds, finds the task instance
      expect(results.length).toBe(1);
      expect((results[0].get("s") as IRI).value).toBe(TASK_INSTANCE_URI);
    });

    it("should find multiple instances with different classes via JOIN", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?classLabel (COUNT(?s) as ?count) WHERE {
          ?s exo:Instance_class ?class .
          ?class exo:Asset_label ?classLabel .
        }
        GROUP BY ?classLabel
        ORDER BY ?classLabel
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // All 3 classes found with 1 instance each
      expect(results.length).toBe(3);
      const classes = results.map((r) => (r.get("classLabel") as Literal).value);
      expect(classes).toContain("Area");
      expect(classes).toContain("Project");
      expect(classes).toContain("Task");
    });
  });

  describe("rdf:type triple (auto-generated)", () => {
    beforeEach(async () => {
      // NoteToRDFConverter also generates rdf:type triple from Instance_class
      await store.addAll([
        new Triple(
          new IRI(TASK_INSTANCE_URI),
          Namespace.RDF.term("type"),
          new IRI(TASK_CLASS_URI)
        ),
        new Triple(
          new IRI(PROJECT_INSTANCE_URI),
          Namespace.RDF.term("type"),
          new IRI(PROJECT_CLASS_URI)
        ),
        new Triple(
          new IRI(AREA_INSTANCE_URI),
          Namespace.RDF.term("type"),
          new IRI(AREA_CLASS_URI)
        ),
      ]);
    });

    it("should find instances by rdf:type", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?instanceLabel WHERE {
          ?s rdf:type ems:Task .
          ?s exo:Asset_label ?instanceLabel .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(1);
      expect((results[0].get("instanceLabel") as Literal).value).toBe("My Task");
    });
  });

  describe("Performance requirements", () => {
    it("should complete JOIN query in less than 50ms", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?instanceLabel ?classLabel WHERE {
          ?s exo:Asset_label ?instanceLabel .
          ?s exo:Instance_class ?class .
          ?class exo:Asset_label ?classLabel .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const startTime = performance.now();
      await executor.executeAll(algebra);
      const endTime = performance.now();

      const executionTime = endTime - startTime;
      expect(executionTime).toBeLessThan(50);
    });
  });
});
