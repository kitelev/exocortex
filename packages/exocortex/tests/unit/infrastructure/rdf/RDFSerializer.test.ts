import { RDFSerializer } from "../../../../src/infrastructure/rdf/RDFSerializer";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
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

  it("serializes to JSON-LD and deserializes back", async () => {
    const jsonld = await serializer.serialize("json-ld", { pretty: true });
    const document = JSON.parse(jsonld);

    expect(document["@graph"]).toHaveLength(2);

    const reloadedCount = await serializer.load(jsonld, "json-ld");
    expect(reloadedCount).toBeGreaterThan(0);

    const triples = await store.match();
    expect(triples.length).toBeGreaterThan(0);
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
      /Invalid RDF statement/
    );
  });
});
