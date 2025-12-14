/**
 * Acceptance test for Asset_fileName predicate (Issue #666).
 *
 * This test verifies that every asset gets an exo:Asset_fileName triple
 * during RDF indexing, allowing SPARQL queries to search by filename
 * without hardcoded URIs.
 *
 * The canonical SPARQL query pattern being tested:
 * ```sparql
 * PREFIX exo: <https://exocortex.my/ontology/exo#>
 * SELECT ?s WHERE {
 *   ?s exo:Asset_fileName "ems__Meeting" .
 * }
 * ```
 */

import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { Namespace } from "../../../../src/domain/models/rdf/Namespace";

describe("Asset_fileName SPARQL Query (Issue #666)", () => {
  let store: InMemoryTripleStore;
  let executor: QueryExecutor;
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;

  // Asset URIs (simulating how NoteToRDFConverter creates them)
  const MEETING_URI = "obsidian://vault/03%20Knowledge/ems/ems__Meeting.md";
  const TASK_URI = "obsidian://vault/03%20Knowledge/ems/ems__Task.md";
  const MY_NOTE_URI = "obsidian://vault/Notes/My%20Note.md";

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();

    // Setup test data: Assets with Asset_fileName triples
    // This simulates what NoteToRDFConverter.convertNote() produces
    const EXO_ASSET_FILE_NAME = Namespace.EXO.term("Asset_fileName");
    const EXO_ASSET_LABEL = Namespace.EXO.term("Asset_label");
    const EXO_INSTANCE_CLASS = Namespace.EXO.term("Instance_class");

    await store.addAll([
      // ems__Meeting asset
      new Triple(
        new IRI(MEETING_URI),
        EXO_ASSET_FILE_NAME,
        new Literal("ems__Meeting")
      ),
      new Triple(
        new IRI(MEETING_URI),
        EXO_ASSET_LABEL,
        new Literal("Meeting Class")
      ),
      new Triple(
        new IRI(MEETING_URI),
        EXO_INSTANCE_CLASS,
        Namespace.EXO.term("Class")
      ),

      // ems__Task asset
      new Triple(
        new IRI(TASK_URI),
        EXO_ASSET_FILE_NAME,
        new Literal("ems__Task")
      ),
      new Triple(
        new IRI(TASK_URI),
        EXO_ASSET_LABEL,
        new Literal("Task Class")
      ),
      new Triple(
        new IRI(TASK_URI),
        EXO_INSTANCE_CLASS,
        Namespace.EXO.term("Class")
      ),

      // My Note asset (with spaces in filename)
      new Triple(
        new IRI(MY_NOTE_URI),
        EXO_ASSET_FILE_NAME,
        new Literal("My Note")
      ),
      new Triple(
        new IRI(MY_NOTE_URI),
        EXO_ASSET_LABEL,
        new Literal("A personal note")
      ),
    ]);
  });

  describe("Basic Asset_fileName queries", () => {
    it("should find asset by exact fileName match", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s WHERE {
          ?s exo:Asset_fileName "ems__Meeting" .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(1);
      expect((results[0].get("s") as IRI).value).toBe(MEETING_URI);
    });

    it("should find asset with spaces in fileName", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s WHERE {
          ?s exo:Asset_fileName "My Note" .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(1);
      expect((results[0].get("s") as IRI).value).toBe(MY_NOTE_URI);
    });

    it("should return empty result for non-existent fileName", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s WHERE {
          ?s exo:Asset_fileName "NonExistent" .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(0);
    });

    it("should find all assets with their fileNames", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?fileName WHERE {
          ?s exo:Asset_fileName ?fileName .
        }
        ORDER BY ?fileName
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(3);
      const fileNames = results.map((r) => (r.get("fileName") as Literal).value);
      expect(fileNames).toContain("ems__Meeting");
      expect(fileNames).toContain("ems__Task");
      expect(fileNames).toContain("My Note");
    });
  });

  describe("Combined queries with Asset_fileName", () => {
    it("should find asset by fileName and return its label", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?label WHERE {
          ?s exo:Asset_fileName "ems__Meeting" .
          ?s exo:Asset_label ?label .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(1);
      expect((results[0].get("label") as Literal).value).toBe("Meeting Class");
    });

    it("should filter assets by fileName and Instance_class", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?fileName WHERE {
          ?s exo:Instance_class exo:Class .
          ?s exo:Asset_fileName ?fileName .
        }
        ORDER BY ?fileName
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Only ems__Meeting and ems__Task have Instance_class = exo:Class
      expect(results.length).toBe(2);
      const fileNames = results.map((r) => (r.get("fileName") as Literal).value);
      expect(fileNames).toContain("ems__Meeting");
      expect(fileNames).toContain("ems__Task");
      expect(fileNames).not.toContain("My Note");
    });
  });

  describe("Use case: Finding asset by filename instead of URI", () => {
    it("should allow querying by human-readable filename (Issue #666 acceptance criteria)", async () => {
      // This is the exact acceptance criteria from Issue #666:
      // Given vault with file `03 Knowledge/ems/ems__Meeting.md`
      // When executing SPARQL: SELECT ?s WHERE { ?s exo:Asset_fileName "ems__Meeting" . }
      // Then receive 1 result with URI `obsidian://vault/03%20Knowledge/ems/ems__Meeting.md`

      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s WHERE {
          ?s exo:Asset_fileName "ems__Meeting" .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(1);
      expect((results[0].get("s") as IRI).value).toBe(
        "obsidian://vault/03%20Knowledge/ems/ems__Meeting.md"
      );
    });
  });

  describe("Performance", () => {
    it("should complete fileName lookup in less than 50ms", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s WHERE {
          ?s exo:Asset_fileName "ems__Meeting" .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const startTime = performance.now();
      await executor.executeAll(algebra);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(50);
    });
  });
});
