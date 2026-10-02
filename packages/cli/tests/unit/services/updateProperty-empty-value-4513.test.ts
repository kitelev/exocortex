import { describe, it, expect } from "@jest/globals";
import { FrontmatterService } from "@kitelev/exocortex-core";
import {
  createUpdatePropertyService,
  type IPathResolver,
} from "@kitelev/exocortex-services";

/**
 * Issue #4513 — `createUpdatePropertyService` (the `service_call` grounding
 * `updateProperty`) is the THIRD writer of a frontmatter key, and until this
 * suite it was the only one that still accepted an empty string: its guard
 * tested `value === undefined`, which rejects an ABSENT value and says nothing
 * about one that IS `""`. The two siblings already refuse — `cli set-property`
 * (`assertNonEmptyValue`, req 501cdf2c) and the `property_set` /
 * `property_append` groundings (#4429, PR #4511).
 *
 * ⛔ WHY THESE AXES LIVE IN `packages/cli` AND NOT NEXT TO THE SUBJECT.
 * `packages/services` is **built** by CI (`npm run build -w
 * @kitelev/exocortex-services`, `ci.yml`) and **never jest-run** — no workflow
 * invokes `packages/services/jest.config.js`. That is not a theoretical rot
 * risk: on `origin/main@474e9dd5` that single suite does not even execute
 * (`TS2339: Property 'YAML11_SCHEMA' does not exist …`, measured 2026-10-02 in
 * the pristine checkout), so the three pre-existing `createUpdatePropertyService`
 * contract assertions living there are currently guarding nothing. Axes placed
 * beside the subject would be tautologically green (`hook-matcher-vs-declared-
 * surface`: the input never reaches them). `packages/cli/jest.config.js` has no
 * allow-list (`testMatch: tests/**\/*.test.ts`), `test-coverage-cli` runs it
 * whole, and `test-coverage` — a required check — fails if that job fails. Its
 * `moduleNameMapper` resolves `@kitelev/exocortex-services` to the package
 * SOURCE, so these axes exercise the real factory, not a built artefact.
 *
 * ⛤ V3/V5/V6 restate the pre-existing contract on purpose: they are the only
 * live copies of it until the services suite is repaired.
 *
 * Mutants: `updateProperty-empty-value-4513.spec.json`.
 */

interface FsStub {
  writes: Array<{ path: string; content: string }>;
  adapter: never;
}

function makeFsStub(initial: Record<string, string>): FsStub {
  const files = new Map(Object.entries(initial));
  const writes: Array<{ path: string; content: string }> = [];
  const adapter = {
    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) throw new Error(`not found: ${path}`);
      return content;
    },
    async updateFile(path: string, content: string): Promise<void> {
      if (!files.has(path)) throw new Error(`not found: ${path}`);
      files.set(path, content);
      writes.push({ path, content });
    },
  } as never;
  return { writes, adapter };
}

function pathResolver(returns: string): IPathResolver {
  return {
    async resolveTargetPath(): Promise<string> {
      return returns;
    },
  };
}

const TARGET = "tasks/x.md";
const FM = `---\nexo__Asset_label: Existing\nems__Effort_result: done\n---\nbody\n`;

function makeService(fs: FsStub) {
  return createUpdatePropertyService(
    fs.adapter,
    new FrontmatterService(),
    pathResolver(TARGET),
  );
}

describe("createUpdatePropertyService — empty-value refusal (#4513)", () => {
  it("V1 refuses an empty-string value and writes NOTHING", async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_result",
        value: "",
      }),
    ).rejects.toThrow();
    // Load-bearing half: the refusal must be TOTAL. A guard placed after the
    // write would still "throw" and pass a rejects-only assertion.
    expect(fs.writes).toHaveLength(0);
  });

  it("V2 names the property and the clearing path in the refusal", async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_result",
        value: "",
      }),
    ).rejects.toThrow(/ems__Effort_result[\s\S]*remove-property/);
  });

  it("V3 control — a non-empty value is still written", async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await makeService(fs).execute("any-iri", {
      property: "ems__Effort_result",
      value: "shipped",
    });
    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0].content).toMatch(/ems__Effort_result: shipped/);
  });

  it("V4 control — a whitespace-only value is still written (predicate is strict `=== \"\"`)", async () => {
    // The boundary req 501cdf2c measured: 0 live carriers of `key: ""`, but 15
    // of `key: " "` (exo__PrintedLiteral_literal ×9, exo__DisplayNameSpec_
    // separator ×6). A trim()-widened guard would make those unwritable.
    const fs = makeFsStub({ [TARGET]: FM });
    await makeService(fs).execute("any-iri", {
      property: "exo__DisplayNameSpec_separator",
      value: " ",
    });
    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0].content).toMatch(/exo__DisplayNameSpec_separator: /);
  });

  it("V5 control — an ABSENT value is still refused by the pre-existing guard", async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", { property: "ems__Effort_result" }),
    ).rejects.toThrow(/requires userInput\.value/);
    expect(fs.writes).toHaveLength(0);
  });

  it("V6 control — an absent property is still refused by the pre-existing guard", async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", { value: "shipped" }),
    ).rejects.toThrow(/requires userInput\.property/);
    expect(fs.writes).toHaveLength(0);
  });
});
