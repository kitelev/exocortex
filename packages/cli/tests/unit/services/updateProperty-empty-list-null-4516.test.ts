import { describe, it, expect } from "@jest/globals";
import { FrontmatterService, PropertyCleanupService } from "@kitelev/exocortex-core";
import {
  createUpdatePropertyService,
  createCleanPropertiesService,
  type IPathResolver,
} from "@kitelev/exocortex-services";

/**
 * Req `5d2c7ede-b053-4dac-a667-7c4f5e4b22da` (issue #4516) — the residual half
 * of the class req `501cdf2c` closed. That req refused `value === ""` and
 * EXPLICITLY scoped out the two neighbours producing the SAME observable:
 * `value: []` (writes a BARE `prop:`) and `value: null` (writes `prop: null`).
 * Both are literally the "junk key that looks like a cleared property" the
 * shipped message describes.
 *
 * ⛤ `null` is worse than that framing, and it was MEASURED here rather than
 * assumed: js-yaml reads `prop: null` back as `null`, but
 * `FrontmatterService.parseObject` — the reader on the CLI/loader path — reads
 * the STRING `"null"`. That fabricates a literal nobody wrote; on a
 * reference-typed property it is a dangling literal instead of an edge.
 *
 * ⛔ WHY THESE AXES LIVE IN `packages/cli` AND NOT NEXT TO THE SUBJECT.
 * No workflow ever runs jest for `packages/services`: `test-ci-batched.sh`
 * drives exactly three configs (obsidian-plugin, cli, core), and CI touches the
 * package only through `npm run build -w @kitelev/exocortex-services`. Axes
 * placed beside the subject would sit outside every gate. The required context
 * is `test-coverage` (the aggregator); `test-coverage-cli` is the upstream job
 * it depends on with an explicit `exit 1`. `packages/cli/jest.config.js` has no
 * allow-list and its `moduleNameMapper` resolves `@kitelev/exocortex-services`
 * to the package SOURCE, so these axes exercise the real factory.
 *
 * ⛤ W5-W7 restate the pre-existing contract on purpose — they are the
 * TOO-BROAD controls. W8 is the one the issue asked for explicitly: prove by
 * EXECUTION, not by reasoning, that the repair path (`apply clean-properties`)
 * is not broken by a write guard.
 *
 * Mutants — TWO specs, both under `packages/cli/tests/integration/`, named by
 * repo-relative path on purpose (a bare basename is how a pointer to a spec goes dead unnoticed: check-spec-anchors.mjs parses the specs' `from` anchors, never their prose):
 *   - `packages/cli/tests/integration/set-property-empty-list-null-4516.updateproperty-wiring.spec.json`
 *     — THIS file's call site (wiring).
 *   - `packages/cli/tests/integration/set-property-empty-list-null-4516.predicate.spec.json`
 *     — the shared predicate, which reddens axes in BOTH suites.
 */

const REQ = "@req:5d2c7ede-b053-4dac-a667-7c4f5e4b22da";

const TARGET = "tasks/x.md";
const FM = `---\nexo__Asset_label: Existing\nems__Effort_result: done\n---\nbody\n`;

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

function makeService(fs: FsStub) {
  return createUpdatePropertyService(
    fs.adapter,
    new FrontmatterService(),
    pathResolver(TARGET),
  );
}

describe("createUpdatePropertyService — empty LIST and NULL refusal (#4516)", () => {
  it(`W1 ${REQ} refuses an EMPTY LIST and writes NOTHING`, async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_area",
        value: [],
      }),
    ).rejects.toThrow();
    // Load-bearing half: the refusal must be TOTAL. A guard placed after the
    // write would still "throw" and pass a rejects-only assertion.
    expect(fs.writes).toHaveLength(0);
  });

  it(`W2 ${REQ} names the property, the FORM and the clearing path when refusing an empty list`, async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_area",
        value: [],
      }),
    ).rejects.toThrow(
      /ems__Effort_area[\s\S]*empty list[\s\S]*remove-property/,
    );
  });

  it(`W3 ${REQ} refuses a NULL value and writes NOTHING`, async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_area",
        value: null,
      }),
    ).rejects.toThrow();
    expect(fs.writes).toHaveLength(0);
  });

  it(`W4 ${REQ} names the NULL form distinctly from the empty-list form`, async () => {
    // ⛔ Not cosmetic. The two inputs produce DIFFERENT bytes (`prop:` vs
    // `prop: null`) and different reader outcomes (`[]`/`null` vs the
    // fabricated string `"null"`), so one shared message would send whoever
    // hits it to diagnose the wrong form.
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_area",
        value: null,
      }),
    ).rejects.toThrow(/ems__Effort_area[\s\S]*is null[\s\S]*remove-property/);
  });

  it(`W5 ${REQ} control — a POPULATED list is still written as a YAML sequence`, async () => {
    // ⛔ THE too-broad control. A guard keyed on `Array.isArray(value)` instead
    // of on its LENGTH would pass W1-W4 and silently kill every multi-value
    // write; only this axis notices.
    const fs = makeFsStub({ [TARGET]: FM });
    await makeService(fs).execute("any-iri", {
      property: "ems__Effort_area",
      value: ["alpha", "beta"],
    });
    expect(fs.writes).toHaveLength(1);
    const parsed = new FrontmatterService().parseObject(
      fs.writes[0].content,
    ) as Record<string, unknown>;
    expect(parsed.ems__Effort_area).toEqual(["alpha", "beta"]);
  });

  it(`W6 ${REQ} control — an EMPTY STRING is still refused (req 501cdf2c, unchanged)`, async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_result",
        value: "",
      }),
    ).rejects.toThrow(/empty string/);
    expect(fs.writes).toHaveLength(0);
  });

  it(`W7 ${REQ} control — a WHITESPACE-ONLY value is still written (the predicate does not trim)`, async () => {
    // 22 live carriers across the three canonical vaults, 2026-10-03
    // (`exo__DisplayNameSpec_separator` 13, `exo__PrintedLiteral_literal` 9).
    const fs = makeFsStub({ [TARGET]: FM });
    await makeService(fs).execute("any-iri", {
      property: "exo__DisplayNameSpec_separator",
      value: " ",
    });
    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0].content).toMatch(/exo__DisplayNameSpec_separator: /);
  });

  it(`W8 ${REQ} control — the REPAIR path still removes empty properties (the write guard does not break it)`, async () => {
    // ⛔ Demanded by the issue as an EXECUTED proof rather than an argument: a
    // write guard that refused the very input the repair command produces would
    // break the only sanctioned way to heal an already-damaged asset.
    // `createCleanPropertiesService` goes through `PropertyCleanupService`,
    // which DELETES empty properties and never writes one — so it cannot reach
    // the guard at all. This axis pins that, on the real services.
    const damaged =
      `---\nexo__Asset_label: Existing\nems__Effort_area:\nems__Effort_result: ""\n` +
      `ems__Effort_parent: null\nems__Effort_votes: []\nems__Effort_status: real\n---\nbody\n`;
    const files = new Map([["tasks/damaged.md", damaged]]);
    const vaultAdapter = {
      async read(file: { path: string }): Promise<string> {
        const c = files.get(file.path);
        if (c === undefined) throw new Error(`not found: ${file.path}`);
        return c;
      },
      async modify(file: { path: string }, content: string): Promise<void> {
        files.set(file.path, content);
      },
      getFileByPath(path: string): { path: string } {
        return { path };
      },
    } as never;
    const service = createCleanPropertiesService(
      vaultAdapter,
      new PropertyCleanupService(vaultAdapter),
      { resolveFile: (iri: string) => ({ path: iri }) as never },
    );

    await service.execute("tasks/damaged.md");

    const cleaned = files.get("tasks/damaged.md") as string;
    // Every empty FORM this req refuses on the WRITE side is still REMOVED here.
    expect(cleaned).not.toMatch(/^ems__Effort_area:/m);
    expect(cleaned).not.toMatch(/^ems__Effort_result:/m);
    expect(cleaned).not.toMatch(/^ems__Effort_parent:/m);
    expect(cleaned).not.toMatch(/^ems__Effort_votes:/m);
    // Canary: the repair is not a no-op and does not take the real value with it.
    expect(cleaned).toMatch(/^ems__Effort_status: real$/m);
    expect(cleaned).toMatch(/^exo__Asset_label: Existing$/m);
  });
});
