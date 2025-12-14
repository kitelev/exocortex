import { DescribeExecutor } from "../../../../../src/infrastructure/sparql/executors/DescribeExecutor";
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";

describe("DescribeExecutor", () => {
  let tripleStore: InMemoryTripleStore;
  let executor: DescribeExecutor;

  const rdfType = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  const ex = (local: string) => new IRI(`http://example.org/${local}`);

  beforeEach(async () => {
    tripleStore = new InMemoryTripleStore();
    executor = new DescribeExecutor(tripleStore);

    await tripleStore.add(new Triple(ex("task1"), rdfType, ex("Task")));
    await tripleStore.add(new Triple(ex("task1"), ex("label"), new Literal("Task 1")));
    await tripleStore.add(new Triple(ex("task1"), ex("parent"), ex("project1")));

    await tripleStore.add(new Triple(ex("project1"), rdfType, ex("Project")));
    await tripleStore.add(new Triple(ex("project1"), ex("label"), new Literal("Project 1")));
  });

  it("should describe resource as subject", async () => {
    const triples = await executor.execute([ex("task1")]);
    expect(triples.length).toBeGreaterThanOrEqual(3);
  });

  it("should describe resource as object", async () => {
    const triples = await executor.execute([ex("project1")]);
    const hasAsObject = triples.some(
      (t) => t.object.toString() === "http://example.org/project1"
    );
    expect(hasAsObject).toBe(true);
  });

  it("should eliminate duplicate triples", async () => {
    const triples = await executor.execute([ex("task1"), ex("task1")]);
    const unique = new Set(triples.map((t) => t.toString()));
    expect(triples.length).toBe(unique.size);
  });

  it("should describe by IRI string", async () => {
    const triples = await executor.describeByIRI("http://example.org/task1");
    expect(triples.length).toBeGreaterThanOrEqual(3);
  });

  it("should handle empty resource list", async () => {
    const triples = await executor.execute([]);
    expect(triples).toHaveLength(0);
  });
});
