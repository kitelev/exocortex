import { describe, it, expect } from "@jest/globals";
import * as yaml from "js-yaml";
import { FrontmatterService } from "@kitelev/exocortex-core";
import {
  createUpdatePropertyService,
  createSetStatusService,
  type IPathResolver,
} from "@kitelev/exocortex-services";

/**
 * Issue #4520 / req `61e3441e-08e2-483b-8ffc-385f2cd2ac69` —
 * `createUpdatePropertyService` (the `service_call` grounding `updateProperty`)
 * handed `userInput.value` straight to `FrontmatterService.updateProperty`,
 * whose contract is ALREADY-FORMATTED YAML: it writes what it is handed. So a
 * user typing `PR #42 merged` into the modal wrote `prop: PR #42 merged`, which
 * every YAML reader takes as `PR` with ` #42 merged` as a comment — the silent
 * truncation of #4405, at rc 0. Three shapes are WORSE than truncation
 * (`fix: broken parse`, `- item`, a multi-line value): js-yaml throws on the
 * whole frontmatter BLOCK, so the asset collapses at every read. W2 asserts the
 * parse itself, not just the value.
 *
 * This is the sibling-writer half of the class #4424 closed on the
 * `property_set` path (req `992f0a75`), whose covers clause (4) scopes THIS
 * factory out explicitly — which is why #4520 is a sibling requirement and not
 * an extension of it.
 *
 * ⛔ NO ORIGIN DISCRIMINATOR, measured rather than inherited. #4424 needed one
 * because one variable there carries both an author's YAML and substituted user
 * text. Here it does not: across all three canonical vaults (SPARQL
 * `--no-cache`, 2026-10-02) the 8 authored groundings with
 * `serviceId: updateProperty` pin ONLY `property` in `serviceCallPayload`, and
 * two of them never reach this factory (short-circuited by `targetValueRef` in
 * `executeServiceCall`). `value` is caller/user input, full stop.
 *
 * ⛔ WHY THESE AXES LIVE IN `packages/cli` AND NOT NEXT TO THE SUBJECT. No
 * workflow runs jest for `packages/services`: `test-ci-batched.sh` drives
 * exactly three configs (obsidian-plugin, cli, core) and CI touches the package
 * only through `npm run build -w @kitelev/exocortex-services`. Axes placed
 * beside the subject would sit outside every gate. `packages/cli/jest.config.js`
 * is run whole by the required `test-coverage-cli` and its `moduleNameMapper`
 * resolves `@kitelev/exocortex-services` to the package SOURCE, so these axes
 * exercise the real factory. Same reasoning, same directory, as the #4513 axes
 * of this factory.
 *
 * Mutants: `updateProperty-serialise-4520.spec.json`.
 */

interface FsStub {
  writes: Array<{ path: string; content: string }>;
  reads: string[];
  adapter: never;
}

function makeFsStub(initial: Record<string, string>): FsStub {
  const files = new Map(Object.entries(initial));
  const writes: Array<{ path: string; content: string }> = [];
  const reads: string[] = [];
  const adapter = {
    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) throw new Error(`not found: ${path}`);
      reads.push(path);
      return content;
    },
    async updateFile(path: string, content: string): Promise<void> {
      if (!files.has(path)) throw new Error(`not found: ${path}`);
      files.set(path, content);
      writes.push({ path, content });
    },
  } as never;
  return { writes, reads, adapter };
}

function pathResolver(returns: string): IPathResolver {
  return {
    async resolveTargetPath(): Promise<string> {
      return returns;
    },
  };
}

const TARGET = "tasks/x.md";
const KEY = "ems__Effort_result";
const FM = `---\nexo__Asset_label: Existing\n${KEY}: old\n---\nbody\n`;

function makeService(fs: FsStub) {
  return createUpdatePropertyService(
    fs.adapter,
    new FrontmatterService(),
    pathResolver(TARGET),
  );
}

/**
 * Loads the written frontmatter the way every consumer does. Returns the THROWN
 * message instead of a value when the block does not parse — the pre-fix
 * outcome for three of the shapes below, and the reason W2 asserts the parse
 * and not only the round-trip.
 */
function loadBack(content: string, key: string): unknown {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return "<no frontmatter block>";
  try {
    const parsed = yaml.load(m[1]) as Record<string, unknown> | null;
    return parsed?.[key];
  } catch (e) {
    return `<yaml threw: ${(e as Error).message.split("\n")[0]}>`;
  }
}

async function write(value: unknown, key = KEY): Promise<FsStub> {
  const fs = makeFsStub({ [TARGET]: FM });
  await makeService(fs).execute("any-iri", { property: key, value });
  return fs;
}

describe("createUpdatePropertyService — value serialisation (#4520)", () => {
  it("W1 a value carrying ` #` round-trips through js-yaml byte for byte", async () => {
    // Pre-fix: `ems__Effort_result: PR #42 merged` → js-yaml returns "PR".
    const fs = await write("PR #42 merged");
    expect(loadBack(fs.writes[0].content, KEY)).toBe("PR #42 merged");
  });

  it("W2 a value carrying `: ` keeps the whole frontmatter BLOCK parseable", async () => {
    // Pre-fix this is not truncation but total loss: js-yaml throws on the
    // block ("bad indentation of a mapping entry"), so EVERY key of the asset
    // disappears from every reader, not just this one.
    const fs = await write("fix: broken parse");
    const block = fs.writes[0].content.match(/^---\n([\s\S]*?)\n---/)![1];
    expect(() => yaml.load(block)).not.toThrow();
    const parsed = yaml.load(block) as Record<string, unknown>;
    expect(parsed[KEY]).toBe("fix: broken parse");
    // The neighbouring key survives too — the load-bearing half of "the block
    // stays parseable".
    expect(parsed["exo__Asset_label"]).toBe("Existing");
  });

  it("W3 a value opening with a YAML indicator round-trips (`- item`, `? maybe`, `*ref`, `&anchor`)", async () => {
    for (const v of ["- item", "? maybe", "*ref", "&anchor"]) {
      const fs = await write(v);
      expect(loadBack(fs.writes[0].content, KEY)).toBe(v);
    }
  });

  it("W4 leading / trailing / only-whitespace values round-trip instead of being trimmed to null", async () => {
    // Pre-fix: ` indented` came back "indented", `done ` came back "done" and
    // `" "` came back NULL — a junk key that looks like a cleared property,
    // which is what the #4513 guard on this same factory refuses for `""`.
    for (const v of [" indented", "done ", " "]) {
      const fs = await write(v);
      expect(loadBack(fs.writes[0].content, KEY)).toBe(v);
    }
  });

  it("W5 a multi-line value round-trips as one string", async () => {
    const fs = await write("line1\nline2");
    expect(loadBack(fs.writes[0].content, KEY)).toBe("line1\nline2");
  });

  it("W6 the live-corpus shapes are written BYTE-IDENTICALLY to the pre-fix revision", async () => {
    // The control group, and the reason the authored corpus changes by zero
    // bytes: all six live groundings that reach this factory pin a
    // timestamp / date property. These expectations are the LITERAL lines the
    // pre-fix code wrote (measured on this tree 2026-10-02).
    const cases: Array<[unknown, string]> = [
      ["shipped", `${KEY}: shipped`],
      ["2026-07-25T09:00:00", `${KEY}: 2026-07-25T09:00:00`],
      ["2026-07-25", `${KEY}: 2026-07-25`],
      [
        '"[[7b9b3116-aaaa-bbbb-cccc-ddddeeeeffff]]"',
        `${KEY}: "[[7b9b3116-aaaa-bbbb-cccc-ddddeeeeffff]]"`,
      ],
    ];
    for (const [value, expectedLine] of cases) {
      const fs = await write(value);
      expect(fs.writes[0].content).toContain(`\n${expectedLine}\n`);
    }
  });

  it("W7 a NON-STRING value is untouched: an array is still a multi-line YAML list", async () => {
    // ⛔ The `typeof value === "string"` guard is what makes this true.
    // `serializeYamlScalar` returns `String(value)` for a non-string, so
    // serialising unconditionally collapses the list to `prop: a,b` — measured
    // on this tree before the guard was written, not predicted.
    const fs = await write(['"[[ems__Task]]"', '"[[ems__Project]]"']);
    expect(fs.writes[0].content).toContain(
      `\n${KEY}:\n  - "[[ems__Task]]"\n  - "[[ems__Project]]"\n`,
    );
    expect(loadBack(fs.writes[0].content, KEY)).toEqual([
      "[[ems__Task]]",
      "[[ems__Project]]",
    ]);
  });

  it("W8 a number and a boolean keep their native YAML type", async () => {
    expect((await write(42)).writes[0].content).toContain(`\n${KEY}: 42\n`);
    expect((await write(true)).writes[0].content).toContain(`\n${KEY}: true\n`);
  });

  it("W9 a BARE wikilink is REFUSED, and nothing is read or written", async () => {
    // Parity with req 29e0d1b6 on the `property_set` path, through the SAME
    // predicate (`isUnquotedWikilink`, now shared from core). The refusal must
    // precede the serialisation: `serializeYamlScalar` quotes `[[uid]]` on its
    // leading `[`, so serialising first makes the guard blind and turns the
    // refusal into a silent successful write.
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: KEY,
        value: "[[7b9b3116-aaaa-bbbb-cccc-ddddeeeeffff]]",
      }),
    ).rejects.toThrow(/UNQUOTED wikilink/);
    expect(fs.writes).toHaveLength(0);
    expect(fs.reads).toHaveLength(0);
  });

  it("W10 the refusal names the property and the quoted form to use instead", async () => {
    const fs = makeFsStub({ [TARGET]: FM });
    await expect(
      makeService(fs).execute("any-iri", {
        property: KEY,
        value: "[[7b9b3116-aaaa-bbbb-cccc-ddddeeeeffff]]",
      }),
    ).rejects.toThrow(/ems__Effort_result[\s\S]*QUOTED form/);
  });

  it("W11 control — a wikilink embedded in PROSE is a string either way and passes", async () => {
    // Scope of the predicate: only an ENTIRELY bracketed value is
    // flow-sequence-shaped. This one carries no silent-literal risk.
    const fs = await write("see [[7b9b3116]] for details");
    expect(loadBack(fs.writes[0].content, KEY)).toBe(
      "see [[7b9b3116]] for details",
    );
  });

  it("W12 control — the setStatus twin is NOT double-serialised", async () => {
    // `createSetStatusService` builds `"[[<uid>]]"` itself — a complete
    // double-quoted scalar, i.e. the engine's own output. This axis pins that
    // #4520 did not widen to it (the issue names `:672` as out of scope).
    //
    // ⛤ Measured, because the issue's stated mechanism does not hold for this
    // shape: `serializeYamlScalar` passes a COMPLETE double-quoted scalar
    // through verbatim, so a second serialisation here would be a NO-OP, not
    // the corruption the issue predicts. The exclusion stands on the other
    // ground — a second writer on the engine's own output — and the no-op is a
    // property of the CURRENT shape, not a guarantee: were this factory to
    // build a BARE uid, the serializer would quote it on its leading `[`. This
    // axis pins the shape, which is what makes the exclusion safe.
    const fs = makeFsStub({
      [TARGET]: `---\nems__Effort_status: "[[old]]"\n---\nbody\n`,
    });
    const service = createSetStatusService(
      fs.adapter,
      new FrontmatterService(),
      pathResolver(TARGET),
    );
    await service.execute("any-iri", { statusUID: "ems__EffortStatusDone" });
    expect(fs.writes[0].content).toContain(
      '\nems__Effort_status: "[[ems__EffortStatusDone]]"\n',
    );
  });
});
