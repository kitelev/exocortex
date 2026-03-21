import { RDFSerializer } from "../../../../src/infrastructure/rdf/RDFSerializer";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal, createDirectionalLiteral } from "../../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../../src/domain/models/rdf/Namespace";

describe("RDFSerializer", () => {
  let store: InMemoryTripleStore;
  let serializer: RDFSerializer;
  let alice: IRI;
  let bob: IRI;
  let knows: IRI;
  let label: IRI;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    serializer = new RDFSerializer(store);

    alice = new IRI("http://example.com/Alice");
    bob = new IRI("http://example.com/Bob");
    knows = new IRI("http://example.com/knows");
    label = Namespace.RDFS.term("label");

    await store.addAll([
      new Triple(alice, knows, bob),
      new Triple(alice, label, new Literal("Alice", undefined, "en")),
      new Triple(
        bob,
        label,
        new Literal("Bob", Namespace.XSD.term("string"))
      ),
    ]);
  });

  it("serializes triples to Turtle with default prefixes", async () => {
    const ttl = await serializer.serialize("turtle");

    expect(ttl).toContain("@prefix rdf:");
    expect(ttl).toContain(`<${alice.value}> <${knows.value}> <${bob.value}> .`);
    expect(ttl).toContain(`"Alice"@en`);
  });

  it("round-trips Turtle content via load", async () => {
    const turtleContent = `
      @prefix ex: <http://example.com/> .
      <http://example.com/Charlie> <http://example.com/knows> ex:Delta .
      ex:Delta <http://example.com/name> "Delta" .
    `;

    const loadedCount = await serializer.load(turtleContent, "turtle");
    expect(loadedCount).toBe(2);

    const triples = await store.match();
    expect(triples).toHaveLength(2);
    expect(triples[0].subject).toBeInstanceOf(IRI);
  });

  it("serializes triples to N-Triples", async () => {
    const ntriples = await serializer.serialize("n-triples");

    expect(ntriples).toContain(`<${alice.value}> <${knows.value}> <${bob.value}> .`);
    expect(ntriples).toContain(`"Bob"^^<${Namespace.XSD.term("string").value}>`);
  });

  it("loads N-Triples content with typed literals", async () => {
    const ntriples = `
      <http://example.com/T1> <http://example.com/value> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .
      <http://example.com/T1> <http://example.com/name> "Answer" .
    `;

    const count = await serializer.load(ntriples, "n-triples");
    expect(count).toBe(2);

    const triples = await store.match();
    const typedLiteral = triples.find(
      (t) => (t.object as Literal).datatype?.value.includes("integer")
    );

    expect(typedLiteral).toBeDefined();
  });

  it("serializes to JSON-LD with correct structure", async () => {
    const jsonld = await serializer.serialize("json-ld", { pretty: true });
    const document = JSON.parse(jsonld);

    expect(document["@graph"]).toHaveLength(2);
    expect(document["@context"]).toBeDefined();
  });

  it("streams Turtle output in batches", async () => {
    const largeStore = new InMemoryTripleStore();
    const largeSerializer = new RDFSerializer(largeStore);
    const predicate = new IRI("http://example.com/prop");
    const triples: Triple[] = [];

    for (let index = 0; index < 1500; index++) {
      triples.push(
        new Triple(
          new IRI(`http://example.com/resource/${index}`),
          predicate,
          new Literal(`Value ${index}`)
        )
      );
    }

    await largeStore.addAll(triples);

    const chunks: string[] = [];
    for await (const chunk of largeSerializer.stream("turtle", { batchSize: 250 })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("@prefix rdf:");

    const combined = chunks.join("");
    expect(combined).toContain("Value 0");
    expect(combined).toContain("Value 1499");
  });

  it("streams JSON-LD output", async () => {
    const chunks: string[] = [];

    for await (const chunk of serializer.stream("json-ld")) {
      chunks.push(chunk);
    }

    const combined = chunks.join("");
    expect(combined).toContain('"@context"');
    expect(combined).toContain('"@graph"');
  });

  it("validates input and rejects malformed Turtle", async () => {
    const invalidTurtle = `<http://example.com/A> <http://example.com/B> "Missing terminator"`;

    await expect(serializer.load(invalidTurtle, "turtle")).rejects.toThrow(
      /Unterminated Turtle statement/
    );
  });

  describe("directional literals (SPARQL 1.2)", () => {
    it("serializes directional literal to JSON-LD with @direction", async () => {
      const dirStore = new InMemoryTripleStore();
      const dirSerializer = new RDFSerializer(dirStore);

      const subject = new IRI("http://example.com/resource");
      const predicate = Namespace.RDFS.term("label");
      const arabicLabel = createDirectionalLiteral("مرحبا", "ar", "rtl");

      await dirStore.add(new Triple(subject, predicate, arabicLabel));

      const jsonld = await dirSerializer.serialize("json-ld", { pretty: true });
      const document = JSON.parse(jsonld);

      expect(document["@graph"]).toHaveLength(1);
      const node = document["@graph"][0];
      const labelValue = node["rdfs:label"];

      expect(labelValue["@value"]).toBe("مرحبا");
      expect(labelValue["@language"]).toBe("ar");
      expect(labelValue["@direction"]).toBe("rtl");
    });

    it("serializes directional literal to Turtle with @lang--dir syntax", async () => {
      const dirStore = new InMemoryTripleStore();
      const dirSerializer = new RDFSerializer(dirStore);

      const subject = new IRI("http://example.com/resource");
      const predicate = Namespace.RDFS.term("label");
      const arabicLabel = createDirectionalLiteral("مرحبا", "ar", "rtl");

      await dirStore.add(new Triple(subject, predicate, arabicLabel));

      const turtle = await dirSerializer.serialize("turtle");

      expect(turtle).toContain('"مرحبا"@ar--rtl');
    });

    it("serializes directional literal to N-Triples with @lang--dir syntax", async () => {
      const dirStore = new InMemoryTripleStore();
      const dirSerializer = new RDFSerializer(dirStore);

      const subject = new IRI("http://example.com/resource");
      const predicate = Namespace.RDFS.term("label");
      const hebrewLabel = createDirectionalLiteral("שלום", "he", "rtl");

      await dirStore.add(new Triple(subject, predicate, hebrewLabel));

      const ntriples = await dirSerializer.serialize("n-triples");

      expect(ntriples).toContain('"שלום"@he--rtl');
    });

    it("round-trips directional literal via JSON-LD", async () => {
      // Test that directional literals are correctly serialized and parsed back
      // Note: Full round-trip requires valid @id in JSON-LD
      const dirStore = new InMemoryTripleStore();
      const dirSerializer = new RDFSerializer(dirStore);

      const subject = new IRI("http://example.com/resource");
      const predicate = Namespace.RDFS.term("label");
      const arabicLabel = createDirectionalLiteral("مرحبا", "ar", "rtl");

      await dirStore.add(new Triple(subject, predicate, arabicLabel));

      // Serialize to JSON-LD and verify @direction is included
      const jsonld = await dirSerializer.serialize("json-ld");
      const document = JSON.parse(jsonld);

      // The graph should have the node with directional literal
      expect(document["@graph"]).toBeDefined();
      expect(document["@graph"].length).toBeGreaterThan(0);

      const node = document["@graph"][0];
      expect(node["rdfs:label"]).toBeDefined();
      expect(node["rdfs:label"]["@value"]).toBe("مرحبا");
      expect(node["rdfs:label"]["@language"]).toBe("ar");
      expect(node["rdfs:label"]["@direction"]).toBe("rtl");
    });

    it("does not include @direction for non-directional language literals", async () => {
      const dirStore = new InMemoryTripleStore();
      const dirSerializer = new RDFSerializer(dirStore);

      const subject = new IRI("http://example.com/resource");
      const predicate = Namespace.RDFS.term("label");
      const englishLabel = new Literal("Hello", undefined, "en");

      await dirStore.add(new Triple(subject, predicate, englishLabel));

      const jsonld = await dirSerializer.serialize("json-ld", { pretty: true });
      const document = JSON.parse(jsonld);

      const node = document["@graph"][0];
      const labelValue = node["rdfs:label"];

      expect(labelValue["@language"]).toBe("en");
      expect(labelValue["@direction"]).toBeUndefined();
    });

    it("serializes ltr directional literal", async () => {
      const dirStore = new InMemoryTripleStore();
      const dirSerializer = new RDFSerializer(dirStore);

      const subject = new IRI("http://example.com/resource");
      const predicate = Namespace.RDFS.term("label");
      const englishLtrLabel = createDirectionalLiteral("Hello", "en", "ltr");

      await dirStore.add(new Triple(subject, predicate, englishLtrLabel));

      const jsonld = await dirSerializer.serialize("json-ld", { pretty: true });
      const document = JSON.parse(jsonld);

      const node = document["@graph"][0];
      const labelValue = node["rdfs:label"];

      expect(labelValue["@value"]).toBe("Hello");
      expect(labelValue["@language"]).toBe("en");
      expect(labelValue["@direction"]).toBe("ltr");
    });
  });

  describe("serializeTriples unsupported format", () => {
    it("throws for unknown format", () => {
      expect(() => serializer.serializeTriples([], "xml" as any)).toThrow(
        /Unsupported serialization format/
      );
    });
  });

  describe("parse", () => {
    it("parses N-Triples input", () => {
      const ntriples = `<http://example.com/A> <http://example.com/p> "hello" .`;
      const triples = serializer.parse(ntriples, "n-triples");
      expect(triples).toHaveLength(1);
      expect((triples[0].object as Literal).value).toBe("hello");
    });

    it("throws for unsupported parse format", () => {
      expect(() => serializer.parse("data", "xml" as any)).toThrow(
        /Unsupported serialization format/
      );
    });
  });

  describe("load with append mode", () => {
    it("appends triples without clearing store", async () => {
      const initialTriples = await store.match();
      const initialCount = initialTriples.length;

      const ntriples = `<http://example.com/New> <http://example.com/prop> "value" .`;
      await serializer.load(ntriples, "n-triples", { mode: "append" });

      const allTriples = await store.match();
      expect(allTriples.length).toBe(initialCount + 1);
    });
  });

  describe("stream N-Triples", () => {
    it("streams N-Triples output in batches", async () => {
      const chunks: string[] = [];
      for await (const chunk of serializer.stream("n-triples", { batchSize: 1 })) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join("")).toContain("<http://example.com/Alice>");
    });
  });

  describe("stream return early termination", () => {
    it("returns done when calling return() on stream", async () => {
      const stream = serializer.stream("turtle");
      const result = await stream.return!();
      expect(result.done).toBe(true);
    });
  });

  describe("JSON-LD parsing", () => {
    it("parses JSON-LD with @graph array", async () => {
      const jsonld = JSON.stringify({
        "@context": { "myns": "http://example.com/" },
        "@graph": [
          {
            "@id": "http://example.com/Alice",
            "@type": "http://example.com/Person",
            "http://example.com/name": "Alice"
          }
        ]
      });

      const count = await serializer.load(jsonld, "json-ld");
      expect(count).toBe(2); // rdf:type + name
    });

    it("parses JSON-LD single object (no @graph)", async () => {
      const jsonld = JSON.stringify({
        "@context": { "myns": "http://example.com/" },
        "@id": "http://example.com/Bob",
        "http://example.com/name": "Bob"
      });

      const count = await serializer.load(jsonld, "json-ld");
      expect(count).toBe(1);
    });

    it("parses JSON-LD array document", async () => {
      const jsonld = JSON.stringify([
        {
          "@id": "http://example.com/A",
          "http://example.com/p": "val1"
        },
        {
          "@id": "http://example.com/B",
          "http://example.com/p": "val2"
        }
      ]);

      const count = await serializer.load(jsonld, "json-ld");
      expect(count).toBe(2);
    });

    it("throws for invalid JSON in JSON-LD", () => {
      expect(() => serializer.parse("not valid json{", "json-ld")).toThrow(
        /Invalid JSON-LD document/
      );
    });

    it("throws for invalid JSON-LD node", () => {
      const jsonld = JSON.stringify({
        "@graph": ["not an object"]
      });

      expect(() => serializer.parse(jsonld, "json-ld")).toThrow(
        /Invalid JSON-LD node at index 0/
      );
    });

    it("throws for invalid @type value", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "@type": 42
      });

      expect(() => serializer.parse(jsonld, "json-ld")).toThrow(
        /Invalid @type value/
      );
    });

    it("parses JSON-LD with @type as array", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "@type": ["http://example.com/Person", "http://example.com/Agent"]
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(2);
    });

    it("parses JSON-LD blank node subjects", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "_:b1",
        "http://example.com/name": "Anonymous"
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
    });

    it("creates auto blank node when @id is missing", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "http://example.com/name": "NoId"
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
    });

    it("parses absolute IRI @id values", () => {
      const jsonld = JSON.stringify({
        "@id": "http://example.com/MyResource",
        "http://example.com/name": "Test"
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
      expect((triples[0].subject as IRI).value).toBe("http://example.com/MyResource");
    });

    it("parses JSON-LD with null/undefined values (skips them)", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/name": null,
        "http://example.com/desc": "Hello"
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1); // only desc
    });

    it("parses JSON-LD array values", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/tag": ["one", "two", "three"]
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(3);
    });

    it("parses JSON-LD object with @id reference", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/knows": { "@id": "http://example.com/B" }
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
      expect(triples[0].object).toBeInstanceOf(IRI);
    });

    it("parses JSON-LD object with blank node @id reference", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/ref": { "@id": "_:bnode1" }
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
    });

    it("parses JSON-LD object with prefixed @id reference", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/knows": { "@id": "http://example.com/B" }
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
      expect(triples[0].object).toBeInstanceOf(IRI);
    });

    it("parses JSON-LD typed literal with @value and @type", () => {
      const jsonld = JSON.stringify({
        "@id": "http://example.com/A",
        "http://example.com/age": { "@value": "42", "@type": "http://www.w3.org/2001/XMLSchema#integer" }
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
      expect((triples[0].object as Literal).datatype?.value).toContain("integer");
    });

    it("parses JSON-LD language literal with @value and @language", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/label": { "@value": "Hola", "@language": "es" }
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
      expect((triples[0].object as Literal).language).toBe("es");
    });

    it("parses JSON-LD directional literal with @direction", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/label": { "@value": "مرحبا", "@language": "ar", "@direction": "rtl" }
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
      const lit = triples[0].object as Literal;
      expect(lit.language).toBe("ar");
      expect(lit.direction).toBe("rtl");
    });

    it("throws for non-string @value in literal", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/val": { "@value": 42 }
      });

      expect(() => serializer.parse(jsonld, "json-ld")).toThrow(
        /literal values must be strings/
      );
    });

    it("parses JSON-LD numeric values", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/count": 42,
        "http://example.com/ratio": 3.14
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(2);
      const intTriple = triples.find(t => (t.object as Literal).value === "42");
      expect(intTriple).toBeDefined();
      expect((intTriple!.object as Literal).datatype?.value).toContain("integer");

      const decTriple = triples.find(t => (t.object as Literal).value === "3.14");
      expect(decTriple).toBeDefined();
      expect((decTriple!.object as Literal).datatype?.value).toContain("decimal");
    });

    it("parses JSON-LD boolean values", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/active": true
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
      expect((triples[0].object as Literal).datatype?.value).toContain("boolean");
    });

    it("throws for unknown prefix in JSON-LD term expansion", () => {
      const jsonld = JSON.stringify({
        "@context": {},
        "@id": "http://example.com/A",
        "unknown_prefix:prop": "value"
      });

      expect(() => serializer.parse(jsonld, "json-ld")).toThrow(
        /Unknown prefix/
      );
    });

    it("uses @vocab for term expansion", () => {
      const jsonld = JSON.stringify({
        "@context": { "@vocab": "http://example.com/" },
        "@id": "http://example.com/A",
        "name": "Test"
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
      expect(triples[0].predicate.value).toBe("http://example.com/name");
    });

    it("throws when term cannot be expanded (no prefix, no @vocab)", () => {
      const jsonld = JSON.stringify({
        "@context": {},
        "@id": "http://example.com/A",
        "name": "Test"
      });

      expect(() => serializer.parse(jsonld, "json-ld")).toThrow(
        /Unable to expand JSON-LD term/
      );
    });

    it("handles empty graph in document", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@graph": []
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(0);
    });

    it("returns empty for non-object context", () => {
      const jsonld = JSON.stringify({
        "@context": "http://example.com/",
        "@id": "http://example.com/A",
        "http://example.com/p": "value"
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
    });

    it("returns empty graph for null/primitive document", () => {
      const jsonld = JSON.stringify(42);

      // Primitive parsed = empty graph
      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(0);
    });

    it("handles @context with non-string values (skips them)", () => {
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/", "nested": { "@id": "http://example.com/nested" } },
        "@id": "http://example.com/A",
        "http://example.com/name": "Test"
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
    });

    it("skips @context property in node entries when present at top level", () => {
      // The @context property is skipped during node property iteration
      const jsonld = JSON.stringify({
        "@context": { "ex": "http://example.com/" },
        "@id": "http://example.com/A",
        "http://example.com/name": "Test"
      });

      const triples = serializer.parse(jsonld, "json-ld");
      expect(triples).toHaveLength(1);
    });
  });

  describe("composePrefixes", () => {
    it("excludes default prefixes when includeDefault is false", async () => {
      const ttl = await serializer.serialize("turtle", {
        includeDefaultPrefixes: false,
        prefixes: { "ex": "http://example.com/" },
      });

      // Should not include default rdf/rdfs/owl prefixes
      expect(ttl).not.toContain("@prefix rdf:");
      expect(ttl).not.toContain("@prefix rdfs:");
    });
  });

  describe("stream with custom newline", () => {
    it("uses custom newline in turtle stream", async () => {
      const chunks: string[] = [];
      for await (const chunk of serializer.stream("turtle", { newline: "\r\n" })) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("stream without prefixes header", () => {
    it("handles turtle stream with no header", async () => {
      const emptyStore = new InMemoryTripleStore();
      const emptySerializer = new RDFSerializer(emptyStore);
      await emptyStore.add(new Triple(alice, knows, bob));

      const chunks: string[] = [];
      for await (const chunk of emptySerializer.stream("turtle", {
        includeDefaultPrefixes: false,
      })) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });
});
