/**
 * PropertyPathExecutor literal-safety guard — Issue #3282 regression tests.
 *
 * The guard at PropertyPathExecutor.execute:51 fires when a literal leaks
 * into the subject or object position of a property-path operation. Issue
 * #3282 root-caused this to label-form wikilinks like `[[Барик (Area)]]`:
 * when NoteToRDFConverter.valueToRDFObject cannot resolve the linkpath via
 * getFirstLinkpathDest, the value is stored as a bare RDFLiteral and any
 * downstream property-path query (`?s ems:Effort_area/ems:Area_parent* ?a`)
 * silently returns zero solutions.
 *
 * Sub-task C deliverable:
 *   - Switch the diagnostic from console.warn → console.error so the silent
 *     recall loss surfaces in tooling.
 *   - Emit a structured payload (position, value, path, hint) so users can
 *     identify which wikilink failed.
 *   - Honour `EXOCORTEX_SPARQL_STRICT` (truthy = "1" / "true" / "yes") and
 *     throw a `PropertyPathExecutorError` instead of swallowing — CLI
 *     `--strict` flag turns label-form recall loss into a hard failure.
 *
 * NOTE: revert-verify discipline (per
 *   `~/dotfiles/.claude/rules/integration-test-revert-verify.md`):
 *   each test FAILS against the pre-fix PropertyPathExecutor (it printed
 *   plain `console.warn(...)` and never inspected an env var). Run the
 *   suite with `git stash push -- packages/core/src/infrastructure/sparql/executors/PropertyPathExecutor.ts`
 *   to confirm RED→GREEN behaviour.
 */

import {
  PropertyPathExecutor,
  PropertyPathExecutorError,
} from "../../../../../src/infrastructure/sparql/executors/PropertyPathExecutor";
import type { ITripleStore } from "../../../../../src/interfaces/ITripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import type {
  TripleElement,
  PropertyPath,
  IRI as AlgebraIRI,
} from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

const algebraIri = (value: string): AlgebraIRI => ({ type: "iri", value });
const algebraVar = (name: string): TripleElement => ({ type: "variable", value: name });

describe("PropertyPathExecutor literal-safety guard (Issue #3282)", () => {
  let executor: PropertyPathExecutor;
  let triples: Triple[];
  let mockTripleStore: jest.Mocked<ITripleStore>;
  let originalStrictEnv: string | undefined;

  beforeEach(() => {
    triples = [];
    mockTripleStore = {
      add: jest.fn(),
      match: jest.fn().mockResolvedValue([]),
      clear: jest.fn(),
      size: jest.fn().mockReturnValue(0),
      getTriples: jest.fn().mockReturnValue(triples),
    } as unknown as jest.Mocked<ITripleStore>;

    executor = new PropertyPathExecutor(mockTripleStore);
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

  async function collectResults(
    subject: TripleElement,
    path: PropertyPath,
    object: TripleElement,
  ): Promise<SolutionMapping[]> {
    const results: SolutionMapping[] = [];
    for await (const mapping of executor.execute(subject, path, object)) {
      results.push(mapping);
    }
    return results;
  }

  const labelLiteral: TripleElement = {
    type: "literal" as const,
    value: "Барик (Area)",
  };
  const oneOrMorePath: PropertyPath = {
    type: "path",
    pathType: "+",
    items: [algebraIri("https://exocortex.my/ontology/ems#Effort_area")],
  };

  describe("default (non-strict) mode", () => {
    it("emits console.error with structured payload (Sub-task C visibility)", async () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const results = await collectResults(labelLiteral, oneOrMorePath, algebraVar("o"));

        expect(results).toEqual([]);
        // Pre-fix the guard called console.warn — Issue #3282 promotes to error.
        expect(errorSpy).toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();

        // Structured payload — Issue #3282 acceptance criterion.
        const lastCall = errorSpy.mock.calls[errorSpy.mock.calls.length - 1];
        const diagnostic = lastCall[1];
        expect(diagnostic).toMatchObject({
          position: "subject",
          value: "Барик (Area)",
          hint: expect.stringContaining("Wikilink"),
        });
        expect(typeof (diagnostic as { path: unknown }).path).toBe("string");
      } finally {
        errorSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it("surfaces literal in object position with the structured payload", async () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const results = await collectResults(algebraVar("s"), oneOrMorePath, labelLiteral);

        expect(results).toEqual([]);
        expect(errorSpy).toHaveBeenCalled();
        const diagnostic = errorSpy.mock.calls[errorSpy.mock.calls.length - 1][1];
        expect(diagnostic).toMatchObject({ position: "object", value: "Барик (Area)" });
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("truncates long literal values in the diagnostic for readability", async () => {
      const longValue = "x".repeat(200);
      const longLiteral: TripleElement = { type: "literal" as const, value: longValue };
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await collectResults(longLiteral, oneOrMorePath, algebraVar("o"));
        const diagnostic = errorSpy.mock.calls[errorSpy.mock.calls.length - 1][1];
        const value = (diagnostic as { value: string }).value;
        expect(value.length).toBeLessThanOrEqual(80);
        expect(value.endsWith("...")).toBe(true);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe("strict mode (EXOCORTEX_SPARQL_STRICT)", () => {
    it("throws PropertyPathExecutorError when env=1", async () => {
      process.env.EXOCORTEX_SPARQL_STRICT = "1";
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await expect(collectResults(labelLiteral, oneOrMorePath, algebraVar("o"))).rejects.toThrow(
          PropertyPathExecutorError,
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("throws when env=true (case-insensitive)", async () => {
      process.env.EXOCORTEX_SPARQL_STRICT = "TRUE";
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await expect(collectResults(labelLiteral, oneOrMorePath, algebraVar("o"))).rejects.toThrow(
          /Literal subject in property path/,
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("warns but does not throw when env=0 (explicit opt-out)", async () => {
      process.env.EXOCORTEX_SPARQL_STRICT = "0";
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const results = await collectResults(labelLiteral, oneOrMorePath, algebraVar("o"));
        expect(results).toEqual([]);
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("isStrictModeEnabled() honours yes/true/1 only", () => {
      const cases: Array<[string | undefined, boolean]> = [
        [undefined, false],
        ["", false],
        ["0", false],
        ["false", false],
        ["no", false],
        ["1", true],
        ["true", true],
        ["TRUE", true],
        ["yes", true],
        ["YES", true],
        ["  true  ", true],
      ];
      for (const [raw, expected] of cases) {
        if (raw === undefined) {
          delete process.env.EXOCORTEX_SPARQL_STRICT;
        } else {
          process.env.EXOCORTEX_SPARQL_STRICT = raw;
        }
        expect(PropertyPathExecutor.isStrictModeEnabled()).toBe(expected);
      }
    });
  });
});
