import { describe, it, expect } from "@jest/globals";
import { FrontmatterService } from "@kitelev/exocortex-core";
import {
  createUpdatePropertyService,
  type IPathResolver,
} from "@kitelev/exocortex-services";

/**
 * Req `394389b1-fcf8-4af1-962f-fad2b943f0a1` (issue #4527) — the class the
 * empty-value guard of req `5d2c7ede` (#4516) EXPLICITLY scoped out. Its
 * §Non-goals item 3, verbatim: "`value: {}` on writer 3 (writes
 * `[object Object]`) — a different class, its own ticket".
 *
 * ⛤ The two classes need two MESSAGES, which is why this is a sibling req and
 * not a widened predicate: `prop: []` looks like a cleared property (so #4516
 * points at `remove-property`), while `prop: [object Object]` looks like
 * CORRUPTION — pointing the reader at the clearing path would send them to
 * diagnose the wrong form.
 *
 * ⛤ Measured on `origin/main` `cbff7ef5` through the real factory + real
 * `FrontmatterService`, bytes read back:
 *   {}        → `key: [object Object]`          re-parsed `["object Object"]`
 *   {a:1}     → `key: [object Object]`          (the contents are LOST)
 *   [{}]      → `  - [object Object]`           re-parsed `["[object Object]"]`
 *   ["a",{}]  → `  - a` + `  - [object Object]`
 *   [[1]]     → `  - 1`                         (nested array FLATTENS)
 * ⇒ N5 exists because the class is WIDER than the literal `[object Object]`: a
 * nested array is corrupted with that string appearing nowhere, so a predicate
 * searching for the substring would have missed it.
 *
 * ⛔ WHY THESE AXES LIVE IN `packages/cli` AND NOT NEXT TO THE SUBJECT.
 * No workflow runs jest for `packages/services`: `test-ci-batched.sh` drives
 * exactly three configs (obsidian-plugin, cli, core) and CI touches the package
 * only through `npm run build -w @kitelev/exocortex-services`. Axes placed
 * beside the subject would sit outside every gate. The required context is
 * `test-coverage` (the aggregator); `test-coverage-cli` is the upstream job it
 * depends on with an explicit `exit 1`. `packages/cli/jest.config.js` has no
 * allow-list and its `moduleNameMapper` resolves `@kitelev/exocortex-services`
 * to the package SOURCE, so these axes exercise the real factory.
 *
 * ⛤ N6-N8 are the TOO-BROAD controls (populated array, every scalar form, and
 * the #4513/#4516 messages kept intact). N9 is the totality axis: the refusal
 * must happen before the path is resolved and before the file is read.
 *
 * Mutants — `packages/cli/tests/unit/services/updateProperty-nonscalar-4527.spec.json`
 * (named by repo-relative path on purpose: a bare basename is how a pointer to
 * a spec goes dead unnoticed — `check-spec-anchors.mjs` parses the specs' `from`
 * anchors, never their prose).
 */

const REQ = "@req:394389b1-fcf8-4af1-962f-fad2b943f0a1";

const TARGET = "tasks/x.md";
const FM = `---\nexo__Asset_label: Existing\nems__Effort_result: done\n---\nbody\n`;

interface FsStub {
  writes: Array<{ path: string; content: string }>;
  reads: string[];
  files: Map<string, string>;
  adapter: never;
}

function makeFsStub(initial: Record<string, string>): FsStub {
  const files = new Map(Object.entries(initial));
  const writes: Array<{ path: string; content: string }> = [];
  const reads: string[] = [];
  const adapter = {
    async readFile(path: string): Promise<string> {
      reads.push(path);
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
  return { writes, reads, files, adapter };
}

function pathResolver(returns: string, calls?: string[]): IPathResolver {
  return {
    async resolveTargetPath(iri: string): Promise<string> {
      calls?.push(iri);
      return returns;
    },
  };
}

function makeService(fs: FsStub, resolverCalls?: string[]) {
  return createUpdatePropertyService(
    fs.adapter,
    new FrontmatterService(),
    pathResolver(TARGET, resolverCalls),
  );
}

describe("createUpdatePropertyService — NON-SCALAR value refusal (#4527)", () => {
  it(`N1 ${REQ} refuses an EMPTY OBJECT and writes NOTHING`, async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_area",
        value: {} as never,
      }),
    ).rejects.toThrow();
    expect(fs.writes).toHaveLength(0);
  });

  it(`N2 ${REQ} names the property and CORRUPTION — not the clearing path`, async () => {
    // ⛔ The distinctness is the deliverable, not cosmetics: `[object Object]`
    // is not a cleared property, so a message naming `remove-property` would
    // send the reader to diagnose the wrong form (req §Почему это НОВЫЙ req).
    const fs = makeFsStub({ [TARGET]: FM });
    let message = "";
    try {
      await makeService(fs).execute("any-iri", {
        property: "ems__Effort_area",
        value: {} as never,
      });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/ems__Effort_area/);
    expect(message).toMatch(/CORRUPT/i);
    expect(message).toMatch(/an object/);
    expect(message).not.toMatch(/remove-property/);
  });

  it(`N3 ${REQ} leaves an EXISTING value byte-identical when refusing a populated object`, async () => {
    // ⛔ On an existing property the unguarded write DESTROYED the real value
    // (`ems__Effort_result: done` → `[object Object]`, measured 2026-10-03), so
    // the damage was data loss, not a stray key. This axis pins the repair.
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_result",
        value: { a: 1 } as never,
      }),
    ).rejects.toThrow(/CORRUPT/i);
    expect(fs.writes).toHaveLength(0);
    expect(fs.files.get(TARGET)).toBe(FM);
  });

  it(`N4 ${REQ} refuses an ARRAY WITH A NON-SCALAR element and writes NOTHING`, async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_area",
        value: ["a", {}] as never,
      }),
    ).rejects.toThrow(/an array with a non-scalar element/);
    expect(fs.writes).toHaveLength(0);
  });

  it(`N5 ${REQ} refuses a NESTED array — the form that corrupts WITHOUT any [object Object]`, async () => {
    // Measured: `[[1]]` was written as `  - 1` (`String([1])` === `"1"`), so the
    // nested list was silently flattened and no `[object Object]` ever appeared
    // in the file. A predicate searching for that substring would pass this.
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: "ems__Effort_area",
        value: [[1]] as never,
      }),
    ).rejects.toThrow(/an array with a non-scalar element/);
    expect(fs.writes).toHaveLength(0);
  });

  it(`N6 ${REQ} control — a POPULATED array of scalars is still written as a YAML sequence`, async () => {
    // ⛔ THE too-broad control. A predicate keyed on `Array.isArray(value)`
    // instead of on its ELEMENTS would pass N1-N5 and kill every multi-value
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

  it(`N7 ${REQ} control — every SCALAR form is still written`, async () => {
    for (const value of ["plain", 5, true] as const) {
      const fs = makeFsStub({ [TARGET]: FM });
      await makeService(fs).execute("any-iri", {
        property: "ems__Effort_area",
        value: value as never,
      });
      expect(fs.writes).toHaveLength(1);
      expect(fs.writes[0].content).toMatch(
        new RegExp(`^ems__Effort_area: ${String(value)}$`, "m"),
      );
    }
  });

  it(`N8 ${REQ} control — the EMPTY forms keep the #4513 / #4516 wording (ORDER of the guards)`, async () => {
    // ⛔ `typeof null === "object"`, so this guard WOULD claim `null` if it ran
    // first — and would answer a cleared property with a corruption message.
    // The order (`emptyPropertyValueForm` first) is load-bearing; this axis is
    // what reddens when the two guard blocks are swapped.
    for (const [value, form] of [
      ["", "empty string"],
      [[], "empty list"],
      [null, "is null"],
    ] as Array<[unknown, string]>) {
      const fs = makeFsStub({ [TARGET]: FM });
      let message = "";
      try {
        await makeService(fs).execute("any-iri", {
          property: "ems__Effort_area",
          value: value as never,
        });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toMatch(new RegExp(form));
      expect(message).toMatch(/remove-property/);
      expect(message).not.toMatch(/CORRUPT/i);
      expect(fs.writes).toHaveLength(0);
    }
  });

  it(`N9 ${REQ} the refusal is TOTAL — the path is never resolved and the file is never read`, async () => {
    // ⛔ Load-bearing: a guard sitting after the read (or after the write) would
    // still throw and still satisfy a rejects-only assertion, while the key was
    // already corrupted on disk. The guard belongs with the other INPUT guards.
    const resolverCalls: string[] = [];
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs, resolverCalls).execute("any-iri", {
        property: "ems__Effort_area",
        value: {} as never,
      }),
    ).rejects.toThrow(/CORRUPT/i);
    expect(resolverCalls).toHaveLength(0);
    expect(fs.reads).toHaveLength(0);
    expect(fs.writes).toHaveLength(0);
  });
});
