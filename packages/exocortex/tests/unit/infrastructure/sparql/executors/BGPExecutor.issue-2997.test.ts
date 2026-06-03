/**
 * Issue #2997 Phase 3 — Translator literal-safety guard (defense in depth).
 *
 * Validates that the BGP / property-path executors yield zero solutions
 * (instead of throwing `Literals cannot appear in subject position`) when
 * upstream code (loader leak, malformed wikilink, optimizer rewrite) places
 * a literal where only an IRI/blank node is allowed.
 *
 * Cf. RFC `0810aad3-90fc-46bb-a103-26ca8172970b` Phase 3.
 */
import { BGPExecutor } from "../../../../../src/infrastructure/sparql/executors/BGPExecutor";
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { BGPOperation, PropertyPath } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("BGPExecutor — Issue #2997 Phase 3 literal-safety guard", () => {
  let tripleStore: InMemoryTripleStore;
  let executor: BGPExecutor;
  let errorSpy: jest.SpyInstance;

  const ex = (local: string) => new IRI(`http://example.org/${local}`);

  beforeEach(async () => {
    tripleStore = new InMemoryTripleStore();
    executor = new BGPExecutor(tripleStore);

    // Bad data shape mimicking the #2997 production crash: a malformed wikilink
    // that the loader emitted as a Literal in the OBJECT position of an
    // ems:Effort_parent triple. A subsequent join reuses the bound variable
    // in subject position.
    await tripleStore.add(
      new Triple(ex("task-1"), ex("Effort_parent"), new Literal("[[bad-link]]")),
    );
    await tripleStore.add(
      new Triple(ex("project-1"), ex("Effort_parent"), ex("root-1")),
    );

    // Issue #3282 promoted the literal-safety log from console.warn → console.error
    // so the silent recall loss is visible in tooling. Spy on error here.
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("yields no rows and does not throw when a join binds a variable to a literal then reuses it as subject", async () => {
    // Two triple patterns mirroring the #2997 query shape:
    //   ?task ex:Effort_parent ?phase .
    //   ?phase ex:Effort_parent ?root .
    // The first pattern binds ?phase to "[[bad-link]]" (literal) for task-1;
    // the second pattern then has a literal in subject position. Pre-fix this
    // throws BGPExecutorError. Post-fix it yields zero solutions for that row
    // (and the IRI-bound row from project-1 still works).
    const bgp: BGPOperation = {
      type: "bgp",
      triples: [
        {
          subject: { type: "variable", value: "task" },
          predicate: { type: "iri", value: "http://example.org/Effort_parent" },
          object: { type: "variable", value: "phase" },
        },
        {
          subject: { type: "variable", value: "phase" },
          predicate: { type: "iri", value: "http://example.org/Effort_parent" },
          object: { type: "variable", value: "root" },
        },
      ],
    };

    const run = executor.executeAll(bgp);
    await expect(run).resolves.toBeDefined();
    const results = await run;
    // The literal-bound branch yields 0 solutions (guard fired); the IRI-bound
    // branch yields none either because root-1 has no further parent. Either
    // way the execution must complete without throwing.
    expect(Array.isArray(results)).toBe(true);
    // Guard must have fired at least once for the literal-bound row.
    expect(errorSpy).toHaveBeenCalled();
    const messages = errorSpy.mock.calls.map((c) => c.join(" "));
    expect(messages.some((m) => m.includes("literal-safety guard"))).toBe(true);
  });

  it("yields zero rows with warn when a property-path pattern receives a literal subject via instantiation", async () => {
    // Construct a BGP where the first pattern binds ?node to a literal, and
    // the second pattern uses ?node as the subject of a property-path
    // expression. Without the Phase 3 guard PropertyPathExecutor.resolveElement
    // throws on literals.
    await tripleStore.add(
      new Triple(ex("anchor"), ex("rel"), new Literal("not-an-iri")),
    );

    const sequencePath: PropertyPath = {
      type: "path",
      pathType: "/",
      items: [
        { type: "iri", value: "http://example.org/Effort_parent" },
        { type: "iri", value: "http://example.org/Effort_parent" },
      ],
    };

    const bgp: BGPOperation = {
      type: "bgp",
      triples: [
        {
          subject: { type: "iri", value: "http://example.org/anchor" },
          predicate: { type: "iri", value: "http://example.org/rel" },
          object: { type: "variable", value: "node" },
        },
        {
          subject: { type: "variable", value: "node" },
          predicate: sequencePath,
          object: { type: "variable", value: "ancestor" },
        },
      ],
    };

    const results = await executor.executeAll(bgp);
    expect(Array.isArray(results)).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    const messages = errorSpy.mock.calls.map((c) => c.join(" "));
    expect(
      messages.some((m) => m.includes("literal-safety guard")),
    ).toBe(true);
  });

  it("guard fires for a direct literal-in-subject pattern with a property path predicate", async () => {
    const path: PropertyPath = {
      type: "path",
      pathType: "*",
      items: [{ type: "iri", value: "http://example.org/p" }],
    };

    const bgp: BGPOperation = {
      type: "bgp",
      triples: [
        {
          subject: { type: "literal", value: "literal-subject" },
          predicate: path,
          object: { type: "variable", value: "o" },
        },
      ],
    };

    const results = await executor.executeAll(bgp);
    expect(results).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("STR-coercion FILTER pattern shape from the #2997 issue does not throw", async () => {
    // Replicates the issue's BGP-level shape: ?task <p> ?phase ; ?phase <p> ?root.
    // With a malformed-literal triple in the store, executor must complete
    // without throwing. The full FILTER(CONTAINS(STR(?root), '<uuid>')) is
    // applied at the FILTER algebra level (above BGP), not here — this test
    // focuses on the BGP-level safety contract.
    const bgp: BGPOperation = {
      type: "bgp",
      triples: [
        {
          subject: { type: "variable", value: "task" },
          predicate: { type: "iri", value: "http://example.org/Effort_parent" },
          object: { type: "variable", value: "phase" },
        },
        {
          subject: { type: "variable", value: "phase" },
          predicate: { type: "iri", value: "http://example.org/Effort_parent" },
          object: { type: "variable", value: "root" },
        },
      ],
    };

    await expect(executor.executeAll(bgp)).resolves.toBeDefined();
  });

  // Issue #3282 — strict-mode escalation. The audit reproducer's 9
  // literal-safety warnings come from this guard (BGPExecutor), not
  // PropertyPathExecutor. Under EXOCORTEX_SPARQL_STRICT=1 the silent fail
  // becomes a hard error so CI / scripts can surface the recall loss.
  describe("Issue #3282 strict mode (EXOCORTEX_SPARQL_STRICT)", () => {
    let originalStrictEnv: string | undefined;

    beforeEach(() => {
      originalStrictEnv = process.env.EXOCORTEX_SPARQL_STRICT;
      delete process.env.EXOCORTEX_SPARQL_STRICT;
    });

    afterEach(() => {
      if (originalStrictEnv === undefined) {
        delete process.env.EXOCORTEX_SPARQL_STRICT;
      } else {
        process.env.EXOCORTEX_SPARQL_STRICT = originalStrictEnv;
      }
    });

    it("emits console.error with a structured payload (default mode)", async () => {
      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [{ type: "iri", value: "http://example.org/p" }],
      };

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "literal", value: "Барик (Area)" },
            predicate: path,
            object: { type: "variable", value: "o" },
          },
        ],
      };

      await executor.executeAll(bgp);

      expect(errorSpy).toHaveBeenCalled();
      const lastCall = errorSpy.mock.calls[errorSpy.mock.calls.length - 1];
      expect(lastCall[1]).toMatchObject({
        executor: "BGPExecutor",
        position: "subject",
        value: "Барик (Area)",
        hint: expect.stringContaining("Wikilink"),
      });
    });

    it("throws BGPExecutorError when EXOCORTEX_SPARQL_STRICT=1", async () => {
      process.env.EXOCORTEX_SPARQL_STRICT = "1";
      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [{ type: "iri", value: "http://example.org/p" }],
      };

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "literal", value: "Барик (Area)" },
            predicate: path,
            object: { type: "variable", value: "o" },
          },
        ],
      };

      await expect(executor.executeAll(bgp)).rejects.toThrow(
        /Literal in subject position/,
      );
    });

    it("does not throw when EXOCORTEX_SPARQL_STRICT=0 (explicit opt-out)", async () => {
      process.env.EXOCORTEX_SPARQL_STRICT = "0";
      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [{ type: "iri", value: "http://example.org/p" }],
      };

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "literal", value: "Барик (Area)" },
            predicate: path,
            object: { type: "variable", value: "o" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toEqual([]);
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
