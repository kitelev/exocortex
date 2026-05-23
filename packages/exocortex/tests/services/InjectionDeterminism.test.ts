import "reflect-metadata";
import { frozenClock, liveClock, IClock } from "../../src/services/IClock";
import {
  seededUidGenerator,
  liveUidGenerator,
  IUidGenerator,
} from "../../src/services/IUidGenerator";
import { PreconditionEvaluator } from "../../src/services/PreconditionEvaluator";
import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { GenericAssetCreationService } from "../../src/services/GenericAssetCreationService";

/**
 * Task 0.2 acceptance — verify IClock + IUidGenerator injection enables
 * deterministic output across independent service instances given the
 * same seed/clock.
 *
 * Three layers covered:
 * 1. IClock contract — two frozenClock instances with same ISO yield
 *    identical `now()` results across multiple calls.
 * 2. IUidGenerator contract — two seededUidGenerator instances with same
 *    seed yield identical sequences across multiple calls.
 * 3. PreconditionEvaluator end-to-end — substituteVariables uses injected
 *    clock, so frozen-clock invocations yield identical rendered queries.
 *
 * GroundingExecutor + GenericAssetCreationService have heavier collaborator
 * graphs (vault adapters, file system writers, DI tokens) — covered by the
 * existing 257 service tests as regression guards. Determinism guarantee
 * is inherited transitively: their createdAt / uid fields are sourced
 * exclusively from this.clock.now() / this.uidGen.next().
 */
describe("Determinism injection (Task 0.2 — Phase 0 CLI determinism)", () => {
  describe("IClock contract", () => {
    it("two frozenClock instances with same ISO yield identical timestamps", () => {
      const iso = "2026-05-23T12:00:00Z";
      const a = frozenClock(iso);
      const b = frozenClock(iso);

      expect(a.now().getTime()).toBe(b.now().getTime());
      expect(a.now().toISOString()).toBe(b.now().toISOString());
    });

    it("frozenClock is stable across multiple calls (idempotent now)", () => {
      const iso = "2026-05-23T12:00:00Z";
      const c = frozenClock(iso);

      const samples = [c.now(), c.now(), c.now()];
      const millis = samples.map((d) => d.getTime());
      expect(new Set(millis).size).toBe(1);
    });

    it("liveClock returns a Date instance (smoke)", () => {
      const c: IClock = liveClock();
      expect(c.now()).toBeInstanceOf(Date);
    });
  });

  describe("IUidGenerator contract", () => {
    it("two seededUidGenerator instances with same seed yield identical sequences", () => {
      const seed = "determinism-test-seed-001";
      const a = seededUidGenerator(seed);
      const b = seededUidGenerator(seed);

      const seqA = [a.next(), a.next(), a.next()];
      const seqB = [b.next(), b.next(), b.next()];
      expect(seqA).toEqual(seqB);
    });

    it("seededUidGenerator with different seeds yields different sequences", () => {
      const a = seededUidGenerator("seed-A");
      const b = seededUidGenerator("seed-B");
      expect(a.next()).not.toBe(b.next());
    });

    it("liveUidGenerator returns valid UUID strings (smoke)", () => {
      const g: IUidGenerator = liveUidGenerator();
      const u = g.next();
      expect(u).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe("GenericAssetCreationService.withDeterminism (fluent setter)", () => {
    // Minimal stub — GAS only stores `vault` from constructor; we never
    // invoke a vault method here, so {} cast is safe for this contract test.
    const stubVault = {} as unknown as ConstructorParameters<
      typeof GenericAssetCreationService
    >[0];

    it("withDeterminism overrides internal clock + uidGen (introspect via private fields)", () => {
      const seed = "gas-determinism-seed-1";
      const iso = "2026-05-23T12:00:00Z";
      const clk = frozenClock(iso);
      const uidg = seededUidGenerator(seed);

      const svc = new GenericAssetCreationService(stubVault).withDeterminism({
        clock: clk,
        uidGenerator: uidg,
      });

      // Field access via index signature — tsyringe-resolved instances retain
      // the prototype, and private fields are exposed at runtime for tests.
      const internalClock = (svc as unknown as { clock: IClock }).clock;
      const internalUidGen = (svc as unknown as { uidGen: IUidGenerator })
        .uidGen;

      expect(internalClock.now().toISOString()).toBe("2026-05-23T12:00:00.000Z");
      // seeded generator emits deterministic sequence — first value should
      // match an independent seeded generator with same seed.
      const independent = seededUidGenerator(seed);
      expect(internalUidGen.next()).toBe(independent.next());
    });

    it("withDeterminism returns this for fluent chaining", () => {
      const svc = new GenericAssetCreationService(stubVault);
      const ret = svc.withDeterminism({ clock: frozenClock("2026-01-01T00:00:00Z") });
      expect(ret).toBe(svc);
    });

    it("withDeterminism partial override leaves other defaults intact", () => {
      const svc = new GenericAssetCreationService(stubVault);
      const defaultClock = (svc as unknown as { clock: IClock }).clock;

      svc.withDeterminism({ uidGenerator: seededUidGenerator("only-uid") });

      // Clock should still be the original default (liveClock instance)
      expect((svc as unknown as { clock: IClock }).clock).toBe(defaultClock);
    });
  });

  describe("PreconditionEvaluator with injected IClock", () => {
    const TARGET_IRI = "https://exocortex.my/assets/det-test-123";

    it("substituteVariables uses injected frozen clock — identical output across instances", () => {
      const iso = "2026-05-23T12:00:00Z";
      const storeA = new InMemoryTripleStore();
      const storeB = new InMemoryTripleStore();
      const evalA = new PreconditionEvaluator(storeA, undefined, {
        clock: frozenClock(iso),
      });
      const evalB = new PreconditionEvaluator(storeB, undefined, {
        clock: frozenClock(iso),
      });

      const queryTemplate =
        "ASK { ?s ?p ?o . FILTER(?o > '$now' && ?o < '$today') }";

      const renderedA = evalA.substituteVariables(queryTemplate, TARGET_IRI);
      const renderedB = evalB.substituteVariables(queryTemplate, TARGET_IRI);

      expect(renderedA).toBe(renderedB);
      // Sanity: frozen clock at 12:00 UTC → today = 2026-05-23
      expect(renderedA).toContain("2026-05-23");
    });

    it("substituteVariables defaults to liveClock when no options provided (backwards-compat)", () => {
      const store = new InMemoryTripleStore();
      const evaluator = new PreconditionEvaluator(store);

      const rendered = evaluator.substituteVariables(
        "ASK { FILTER(?o = '$today') }",
        TARGET_IRI,
      );

      // Should contain TODAY's date (YYYY-MM-DD form), not crash, and not
      // be a literal $today (substitution must have run).
      expect(rendered).not.toContain("$today");
      expect(rendered).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });
});
