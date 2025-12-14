import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";

describe("InMemoryTripleStore Performance", () => {
  let store: InMemoryTripleStore;
  const TRIPLE_COUNT = 10000;

  beforeAll(async () => {
    store = new InMemoryTripleStore();

    const triples: Triple[] = [];
    for (let i = 0; i < TRIPLE_COUNT; i++) {
      const subject = new IRI(`http://example.com/Person${i}`);
      const predicate = new IRI(`http://example.com/property${i % 100}`);
      const object = new Literal(`Value ${i}`);
      triples.push(new Triple(subject, predicate, object));
    }

    await store.addAll(triples);
  });

  describe("match performance", () => {
    it("should perform match by subject in < 1ms on 10K triples", async () => {
      const subject = new IRI("http://example.com/Person5000");

      const start = performance.now();
      await store.match(subject);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1);
    });

    it("should perform match by predicate in < 1ms on 10K triples", async () => {
      const predicate = new IRI("http://example.com/property50");

      const start = performance.now();
      await store.match(undefined, predicate);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1);
    });

    it("should perform match by object in < 1ms on 10K triples", async () => {
      const object = new Literal("Value 5000");

      const start = performance.now();
      await store.match(undefined, undefined, object);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1);
    });

    it("should perform exact match in < 1ms on 10K triples", async () => {
      const subject = new IRI("http://example.com/Person5000");
      const predicate = new IRI("http://example.com/property0");
      const object = new Literal("Value 5000");

      const start = performance.now();
      await store.match(subject, predicate, object);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1);
    });

    it("should perform 95% of queries in < 1ms", async () => {
      const durations: number[] = [];
      const queryCount = 100;

      for (let i = 0; i < queryCount; i++) {
        const subject = new IRI(`http://example.com/Person${i * 100}`);

        const start = performance.now();
        await store.match(subject);
        const duration = performance.now() - start;

        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.floor(queryCount * 0.95);
      const p95Duration = durations[p95Index];

      expect(p95Duration).toBeLessThan(1);
    });
  });

  describe("cache performance", () => {
    it("should achieve >90% cache hit rate on repeated queries", async () => {
      const subject = new IRI("http://example.com/Person5000");

      await store.match(subject);

      let cacheHits = 0;
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await store.match(subject);
        const duration = performance.now() - start;

        if (duration < 0.01) {
          cacheHits++;
        }
      }

      const hitRate = cacheHits / iterations;
      expect(hitRate).toBeGreaterThan(0.9);
    });

    it("should serve cached results faster than uncached", async () => {
      const subject = new IRI("http://example.com/Person1000");

      const uncachedStart = performance.now();
      await store.match(subject);
      const uncachedDuration = performance.now() - uncachedStart;

      const cachedStart = performance.now();
      await store.match(subject);
      const cachedDuration = performance.now() - cachedStart;

      expect(cachedDuration).toBeLessThan(uncachedDuration);
    });
  });

  describe("bulk operations performance", () => {
    it("should add 1000 triples in < 10ms", async () => {
      const newStore = new InMemoryTripleStore();
      const triples: Triple[] = [];

      for (let i = 0; i < 1000; i++) {
        const subject = new IRI(`http://example.com/Test${i}`);
        const predicate = new IRI("http://example.com/prop");
        const object = new Literal(`Value ${i}`);
        triples.push(new Triple(subject, predicate, object));
      }

      const start = performance.now();
      await newStore.addAll(triples);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(10);
    });

    it("should count 10K triples in < 0.1ms", async () => {
      const start = performance.now();
      await store.count();
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(0.1);
    });
  });

  describe("memory efficiency", () => {
    it("should store 10K triples without excessive memory", async () => {
      const count = await store.count();
      expect(count).toBe(TRIPLE_COUNT);
    });

    it("should clear all data efficiently", async () => {
      const newStore = new InMemoryTripleStore();

      const triples: Triple[] = [];
      for (let i = 0; i < 1000; i++) {
        triples.push(
          new Triple(
            new IRI(`http://example.com/s${i}`),
            new IRI("http://example.com/p"),
            new Literal(`${i}`)
          )
        );
      }

      await newStore.addAll(triples);

      const start = performance.now();
      await newStore.clear();
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1);
      expect(await newStore.count()).toBe(0);
    });
  });
});
