/**
 * Acceptance test for querying non-deprecated class properties by name.
 * Tests Issue #665: Dynamic form building requires ability to get all valid properties
 * for a class (including inherited ones) while excluding deprecated properties.
 *
 * The canonical SPARQL query pattern being tested:
 * ```sparql
 * SELECT DISTINCT ?propertyLabel WHERE {
 *   ?targetClass exo:Asset_fileName "ems__Meeting" .
 *   ?targetClass exo:Class_superClass* ?class .
 *   ?property exo:Property_domain ?class .
 *   ?property exo:Asset_fileName ?propertyLabel .
 *   ?property exo:Instance_class ?propClass .
 *   FILTER NOT EXISTS {
 *     ?propClass exo:Asset_fileName "exo__DeprecatedProperty"
 *   }
 * }
 * ORDER BY ?propertyLabel
 * ```
 */

import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import type { ITripleStore } from "../../../../src/interfaces/ITripleStore";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../../src/domain/models/rdf/Triple";

// Ontology URIs
const EXO = "https://exocortex.my/ontology/exo#";
const EXO_ASSET_FILE_NAME = new IRI(`${EXO}Asset_fileName`);
const EXO_CLASS_SUPER_CLASS = new IRI(`${EXO}Class_superClass`);
const EXO_PROPERTY_DOMAIN = new IRI(`${EXO}Property_domain`);
const EXO_INSTANCE_CLASS = new IRI(`${EXO}Instance_class`);
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
      if (predicate && t.predicate.toString() !== predicate.toString()) return false;
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

// Test data helper functions
function createClassTriples(classUri: string, className: string): Triple[] {
  return [
    new Triple(
      new IRI(classUri),
      EXO_ASSET_FILE_NAME,
      new Literal(className, new IRI(XSD_STRING))
    ),
  ];
}

function createSuperClassTriple(subClass: string, superClass: string): Triple {
  return new Triple(
    new IRI(subClass),
    EXO_CLASS_SUPER_CLASS,
    new IRI(superClass)
  );
}

function createPropertyTriples(
  propertyUri: string,
  propertyName: string,
  domainUri: string,
  propertyClassUri: string
): Triple[] {
  return [
    new Triple(
      new IRI(propertyUri),
      EXO_ASSET_FILE_NAME,
      new Literal(propertyName, new IRI(XSD_STRING))
    ),
    new Triple(
      new IRI(propertyUri),
      EXO_PROPERTY_DOMAIN,
      new IRI(domainUri)
    ),
    new Triple(
      new IRI(propertyUri),
      EXO_INSTANCE_CLASS,
      new IRI(propertyClassUri)
    ),
  ];
}

describe("Class Properties Query (Issue #665)", () => {
  let store: MockTripleStore;
  let executor: QueryExecutor;
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;

  // Class URIs
  const MEETING_CLASS = "http://example.org/class/ems__Meeting";
  const TASK_CLASS = "http://example.org/class/ems__Task";
  const EFFORT_CLASS = "http://example.org/class/ems__Effort";
  const PROPERTY_CLASS = "http://example.org/class/exo__Property";
  const DEPRECATED_CLASS = "http://example.org/class/exo__DeprecatedProperty";

  beforeEach(async () => {
    store = new MockTripleStore();
    executor = new QueryExecutor(store);
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();

    // Setup class hierarchy:
    // ems__Meeting -> ems__Task -> ems__Effort (inheritance chain)
    await store.addAll([
      // Class definitions
      ...createClassTriples(MEETING_CLASS, "ems__Meeting"),
      ...createClassTriples(TASK_CLASS, "ems__Task"),
      ...createClassTriples(EFFORT_CLASS, "ems__Effort"),
      ...createClassTriples(PROPERTY_CLASS, "exo__Property"),
      ...createClassTriples(DEPRECATED_CLASS, "exo__DeprecatedProperty"),

      // Class hierarchy
      createSuperClassTriple(MEETING_CLASS, TASK_CLASS),
      createSuperClassTriple(TASK_CLASS, EFFORT_CLASS),

      // Properties for ems__Effort (base class)
      ...createPropertyTriples(
        "http://example.org/prop/ems__Effort_startTimestamp",
        "ems__Effort_startTimestamp",
        EFFORT_CLASS,
        PROPERTY_CLASS
      ),
      ...createPropertyTriples(
        "http://example.org/prop/ems__Effort_endTimestamp",
        "ems__Effort_endTimestamp",
        EFFORT_CLASS,
        PROPERTY_CLASS
      ),
      ...createPropertyTriples(
        "http://example.org/prop/ems__Effort_area",
        "ems__Effort_area",
        EFFORT_CLASS,
        PROPERTY_CLASS
      ),
      // Deprecated property on Effort
      ...createPropertyTriples(
        "http://example.org/prop/ems__Effort_day",
        "ems__Effort_day",
        EFFORT_CLASS,
        DEPRECATED_CLASS
      ),

      // Properties for ems__Task (middle class)
      ...createPropertyTriples(
        "http://example.org/prop/ems__Task_priority",
        "ems__Task_priority",
        TASK_CLASS,
        PROPERTY_CLASS
      ),
      ...createPropertyTriples(
        "http://example.org/prop/ems__Task_context",
        "ems__Task_context",
        TASK_CLASS,
        PROPERTY_CLASS
      ),
      // Deprecated property on Task
      ...createPropertyTriples(
        "http://example.org/prop/ems__Task_status",
        "ems__Task_status",
        TASK_CLASS,
        DEPRECATED_CLASS
      ),

      // Properties for ems__Meeting (leaf class)
      ...createPropertyTriples(
        "http://example.org/prop/ems__Meeting_participants",
        "ems__Meeting_participants",
        MEETING_CLASS,
        PROPERTY_CLASS
      ),
      ...createPropertyTriples(
        "http://example.org/prop/ems__Meeting_location",
        "ems__Meeting_location",
        MEETING_CLASS,
        PROPERTY_CLASS
      ),
    ]);
  });

  describe("Property path traversal for class hierarchy", () => {
    it("should find all classes in inheritance hierarchy using ZeroOrMore path (*)", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT DISTINCT ?class WHERE {
          ?targetClass exo:Asset_fileName "ems__Meeting" .
          ?targetClass exo:Class_superClass* ?class .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should include: ems__Meeting (self), ems__Task, ems__Effort
      expect(results.length).toBe(3);
      const classes = results.map((r) => (r.get("class") as IRI).value);
      expect(classes).toContain(MEETING_CLASS);
      expect(classes).toContain(TASK_CLASS);
      expect(classes).toContain(EFFORT_CLASS);
    });

    it("should find only self when class has no superclass", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT DISTINCT ?class WHERE {
          ?targetClass exo:Asset_fileName "ems__Effort" .
          ?targetClass exo:Class_superClass* ?class .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // ems__Effort has no superclass, should only return itself
      expect(results.length).toBe(1);
      expect((results[0].get("class") as IRI).value).toBe(EFFORT_CLASS);
    });
  });

  describe("Finding properties for a class", () => {
    it("should find direct properties for a single class", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT DISTINCT ?propertyLabel WHERE {
          ?property exo:Property_domain <${MEETING_CLASS}> .
          ?property exo:Asset_fileName ?propertyLabel .
        }
        ORDER BY ?propertyLabel
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Only ems__Meeting's own properties (not inherited)
      expect(results.length).toBe(2);
      const labels = results.map((r) => (r.get("propertyLabel") as Literal).value);
      expect(labels).toContain("ems__Meeting_location");
      expect(labels).toContain("ems__Meeting_participants");
    });

    it("should find properties from multiple classes in hierarchy", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT DISTINCT ?propertyLabel WHERE {
          ?targetClass exo:Asset_fileName "ems__Meeting" .
          ?targetClass exo:Class_superClass* ?class .
          ?property exo:Property_domain ?class .
          ?property exo:Asset_fileName ?propertyLabel .
        }
        ORDER BY ?propertyLabel
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // All properties from Meeting, Task, and Effort classes (including deprecated)
      expect(results.length).toBe(9);
      const labels = results.map((r) => (r.get("propertyLabel") as Literal).value);
      // Meeting properties
      expect(labels).toContain("ems__Meeting_location");
      expect(labels).toContain("ems__Meeting_participants");
      // Task properties (including deprecated)
      expect(labels).toContain("ems__Task_priority");
      expect(labels).toContain("ems__Task_context");
      expect(labels).toContain("ems__Task_status"); // deprecated but included
      // Effort properties (including deprecated)
      expect(labels).toContain("ems__Effort_area");
      expect(labels).toContain("ems__Effort_startTimestamp");
      expect(labels).toContain("ems__Effort_endTimestamp");
      expect(labels).toContain("ems__Effort_day"); // deprecated but included
    });
  });

  describe("Filtering deprecated properties", () => {
    it("should exclude deprecated properties using FILTER NOT EXISTS", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT DISTINCT ?propertyLabel WHERE {
          ?targetClass exo:Asset_fileName "ems__Meeting" .
          ?targetClass exo:Class_superClass* ?class .
          ?property exo:Property_domain ?class .
          ?property exo:Asset_fileName ?propertyLabel .
          ?property exo:Instance_class ?propClass .
          FILTER NOT EXISTS {
            ?propClass exo:Asset_fileName "exo__DeprecatedProperty"
          }
        }
        ORDER BY ?propertyLabel
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should exclude deprecated properties
      expect(results.length).toBe(7);
      const labels = results.map((r) => (r.get("propertyLabel") as Literal).value);

      // Meeting properties (non-deprecated)
      expect(labels).toContain("ems__Meeting_location");
      expect(labels).toContain("ems__Meeting_participants");
      // Task properties (non-deprecated)
      expect(labels).toContain("ems__Task_priority");
      expect(labels).toContain("ems__Task_context");
      // Effort properties (non-deprecated)
      expect(labels).toContain("ems__Effort_area");
      expect(labels).toContain("ems__Effort_startTimestamp");
      expect(labels).toContain("ems__Effort_endTimestamp");

      // Deprecated properties should NOT be included
      expect(labels).not.toContain("ems__Task_status");
      expect(labels).not.toContain("ems__Effort_day");
    });

    it("should return only deprecated properties when filter is inverted", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT DISTINCT ?propertyLabel WHERE {
          ?targetClass exo:Asset_fileName "ems__Meeting" .
          ?targetClass exo:Class_superClass* ?class .
          ?property exo:Property_domain ?class .
          ?property exo:Asset_fileName ?propertyLabel .
          ?property exo:Instance_class ?propClass .
          ?propClass exo:Asset_fileName "exo__DeprecatedProperty" .
        }
        ORDER BY ?propertyLabel
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should only return deprecated properties
      expect(results.length).toBe(2);
      const labels = results.map((r) => (r.get("propertyLabel") as Literal).value);
      expect(labels).toContain("ems__Task_status");
      expect(labels).toContain("ems__Effort_day");
    });
  });

  describe("Edge cases", () => {
    it("should return empty when class does not exist", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT DISTINCT ?propertyLabel WHERE {
          ?targetClass exo:Asset_fileName "NonExistentClass" .
          ?targetClass exo:Class_superClass* ?class .
          ?property exo:Property_domain ?class .
          ?property exo:Asset_fileName ?propertyLabel .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(0);
    });

    it("should handle class with no properties", async () => {
      // Add a class with no properties
      await store.addAll(createClassTriples("http://example.org/class/EmptyClass", "EmptyClass"));

      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT DISTINCT ?propertyLabel WHERE {
          ?targetClass exo:Asset_fileName "EmptyClass" .
          ?targetClass exo:Class_superClass* ?class .
          ?property exo:Property_domain ?class .
          ?property exo:Asset_fileName ?propertyLabel .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(0);
    });

    it("should handle properties for mid-level class (ems__Task)", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT DISTINCT ?propertyLabel WHERE {
          ?targetClass exo:Asset_fileName "ems__Task" .
          ?targetClass exo:Class_superClass* ?class .
          ?property exo:Property_domain ?class .
          ?property exo:Asset_fileName ?propertyLabel .
          ?property exo:Instance_class ?propClass .
          FILTER NOT EXISTS {
            ?propClass exo:Asset_fileName "exo__DeprecatedProperty"
          }
        }
        ORDER BY ?propertyLabel
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Task + Effort non-deprecated properties (but not Meeting properties)
      expect(results.length).toBe(5);
      const labels = results.map((r) => (r.get("propertyLabel") as Literal).value);

      // Task properties (non-deprecated)
      expect(labels).toContain("ems__Task_priority");
      expect(labels).toContain("ems__Task_context");
      // Effort properties (non-deprecated)
      expect(labels).toContain("ems__Effort_area");
      expect(labels).toContain("ems__Effort_startTimestamp");
      expect(labels).toContain("ems__Effort_endTimestamp");

      // Should NOT include Meeting properties (Meeting is subclass, not superclass)
      expect(labels).not.toContain("ems__Meeting_location");
      expect(labels).not.toContain("ems__Meeting_participants");
    });
  });

  describe("Performance requirements", () => {
    it("should complete query in less than 100ms", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT DISTINCT ?propertyLabel WHERE {
          ?targetClass exo:Asset_fileName "ems__Meeting" .
          ?targetClass exo:Class_superClass* ?class .
          ?property exo:Property_domain ?class .
          ?property exo:Asset_fileName ?propertyLabel .
          ?property exo:Instance_class ?propClass .
          FILTER NOT EXISTS {
            ?propClass exo:Asset_fileName "exo__DeprecatedProperty"
          }
        }
        ORDER BY ?propertyLabel
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const startTime = performance.now();
      await executor.executeAll(algebra);
      const endTime = performance.now();

      const executionTime = endTime - startTime;
      expect(executionTime).toBeLessThan(100);
    });
  });
});
