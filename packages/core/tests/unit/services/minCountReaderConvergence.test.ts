import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";

import { ShapeLoader } from "../../../src/services/ShapeLoader";
import type { Shape } from "../../../src/services/ShapeRegistry";
import {
  createTripleStoreClassPropertyResolver,
  createTripleStoreRequiredPropertyResolver,
} from "../../../src/services/RequiredPropertyResolver";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { parseMinCount } from "../../../src/utilities/minCount";

/**
 * Ticket abd22b00 — ONE reader for `exo__Property_minCount`, exercised through
 * ALL FOUR of its consumers from ONE fixture.
 *
 * Until this change the predicate was read by four independent implementations
 * (`ShapeLoader.loadFromRDFGraph`, `ShapeLoader.registerCandidate`, and the two
 * triple-store resolvers), and the ONE form on which they genuinely disagreed
 * was a definition declaring SEVERAL values: the graph loader answered with the
 * FIRST triple, the FS loader with `undefined` (a `string[]` failed its
 * `typeof raw === "string"` guard), and the two resolvers accepted any value
 * `> 0`. The converged reader answers with the MAXIMUM, which keeps both
 * resolvers byte-identical (`max > 0` ⟺ `any > 0`) while removing the graph
 * loader's dependence on triple ORDER.
 *
 * ⚠ The fixture declares `[0, 1]` — the SMALLER value FIRST — deliberately, and
 * it is what makes these axes non-vacuous: under `first` the answer is 0 (no
 * obligation, not required), under `max` it is 1 (obligation, required). A
 * fixture written `[1, 0]`, or any single-valued one, would pass under BOTH
 * policies and measure nothing (integration-test-revert-verify §A105).
 *
 * Tagged `@req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978` — the loader-parity
 * requirement, whose invariant is that both loaders build deep-equal shapes from
 * the SAME bytes. Its measured cross-product was {bare, double-quoted,
 * single-quoted}; multi-value is the fourth dimension of the same invariant, and
 * the shared reader is what makes it hold by construction rather than by two
 * implementations agreeing. Per Step 0 of `/feature-sdd` this is conformance
 * with an already-active requirement, not new behaviour: no new req is minted.
 */

const PROPERTY_IRI = "https://exocortex.my/ontology/flow#Stage_order";
const HOST_UID = "7c1f0a52-1b3e-4a0c-9f11-8d2e6b4c5a90";
const DEF_UID = "3e9d4c17-5a62-4b88-9c03-1f7a2e6d8b41";

/** A property definition whose `exo__Property_minCount` block is given verbatim. */
const DEF = (minCountBlock: string[]): string =>
  [
    "---",
    "exo__Instance_class:",
    '  - "[[exo__Property]]"',
    "exo__Asset_label: flow__Stage_order",
    "exo__Property_domain:",
    `  - "[[${HOST_UID}]]"`,
    'exo__Property_range: "xsd:integer"',
    ...minCountBlock,
    "---",
    "",
  ].join("\n");

/** The host class the definition's domain points at. */
const HOST_CLASS = [
  "---",
  `exo__Asset_uid: ${HOST_UID}`,
  "exo__Instance_class:",
  '  - "[[exo__Class]]"',
  "exo__Asset_label: flow__Stage",
  "---",
  "",
].join("\n");

/** `exo__Property_minCount` declared as a YAML sequence, smaller value first. */
const MULTI = ["exo__Property_minCount:", "  - 0", "  - 1"];

async function withVault(
  files: Record<string, string>,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mincount-converge-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), content, "utf-8");
    }
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Frontmatter as Obsidian's metadataCache hands it to the converter — a real
 * YAML reader, so quotes are gone and a `key:` + `  - item` block is an ARRAY.
 * Copied from the parity helper in `tests/services/ShapeLoader.test.ts`: the two
 * halves of a parity measurement must model the same reader.
 */
function parseFm(content: string): Record<string, unknown> {
  const fm: Record<string, unknown> = {};
  let key: string | null = null;
  for (const line of content.split("\n").slice(1)) {
    if (line === "---") break;
    const item = /^ {2}- "?(.*?)"?$/.exec(line);
    if (item && key) {
      (fm[key] as string[]).push(item[1]);
      continue;
    }
    const kv = /^([^:]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    key = kv[1];
    fm[key] = kv[2] === "" ? [] : kv[2].replace(/^"|"$/g, "").replace(/^'|'$/g, "");
  }
  return fm;
}

/** The SAME bytes through the converter → one store every graph-side reader shares. */
async function graphStore(
  files: Record<string, string>,
): Promise<InMemoryTripleStore> {
  const byPath = new Map(Object.entries(files).map(([rel, c]) => [rel, parseFm(c)]));
  const fileOf = (rel: string) => ({
    path: rel,
    basename: path.basename(rel, ".md"),
    extension: "md",
    name: path.basename(rel),
    parent: null,
  });
  const mockVault = {
    getFrontmatter: jest.fn((f: { path: string }) => byPath.get(f.path)),
    getAllFiles: jest.fn().mockReturnValue([]),
    read: jest.fn().mockResolvedValue(""),
    getFirstLinkpathDest: jest.fn((link: string) => {
      const rel = [...byPath.keys()].find((p) => path.basename(p, ".md") === link);
      return rel ? fileOf(rel) : null;
    }),
  } as unknown as ConstructorParameters<typeof NoteToRDFConverter>[0];
  const converter = new NoteToRDFConverter(mockVault);
  const store = new InMemoryTripleStore();
  for (const rel of byPath.keys()) {
    await store.addAll(
      await converter.convertNote(fileOf(rel) as Parameters<typeof converter.convertNote>[0]),
    );
  }
  return store;
}

/** All four readers of `exo__Property_minCount`, fed from ONE set of files. */
async function allFourReaders(minCountBlock: string[]): Promise<{
  viaGraph: Shape | undefined;
  viaFS: Shape | undefined;
  requiredKeys: string[];
  declaredRequiredFlag: boolean | undefined;
}> {
  const files: Record<string, string> = {
    [`flow/${DEF_UID}.md`]: DEF(minCountBlock),
    [`exo/${HOST_UID}.md`]: HOST_CLASS,
  };
  const store = await graphStore(files);

  const viaGraph = (await ShapeLoader.loadFromRDFGraph(store)).get(PROPERTY_IRI);
  let viaFS: Shape | undefined;
  await withVault(files, async (dir) => {
    viaFS = (await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI);
  });

  const requiredKeys = (
    await createTripleStoreRequiredPropertyResolver(store)(HOST_UID)
  ).map((f) => f.propertyKey);
  const declared = await createTripleStoreClassPropertyResolver(store)(HOST_UID);
  const declaredRequiredFlag = declared.find(
    (f) => f.propertyKey === "flow__Stage_order",
  )?.required;

  return { viaGraph, viaFS, requiredKeys, declaredRequiredFlag };
}

describe("minCount reader convergence (ticket abd22b00)", () => {
  it("C1 @req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978 loadFromRDFGraph on a MULTI-VALUED exo__Property_minCount [0, 1] answers 1 — the maximum of the declared values, not whichever triple the store yielded first", async () => {
    const { viaGraph } = await allFourReaders(MULTI);
    expect(viaGraph).toBeDefined();
    expect(viaGraph!.minCount).toBe(1);
  });

  it("C2 @req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978 loadFromVaultFS on the SAME multi-valued declaration answers 1 as well — before the shared reader a YAML sequence failed the FS side's `typeof raw === \"string\"` guard and the obligation vanished", async () => {
    const { viaFS } = await allFourReaders(MULTI);
    expect(viaFS).toBeDefined();
    expect(viaFS!.minCount).toBe(1);
  });

  it("C3 @req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978 loader PARITY extends to the multi-valued form: the same bytes yield deep-equal shapes through loadFromRDFGraph and loadFromVaultFS — the fourth dimension of the guard's cross-product, and the one the two loaders actually disagreed on", async () => {
    const { viaGraph, viaFS } = await allFourReaders(MULTI);
    expect(viaGraph).toBeDefined();
    expect(viaFS).toBeDefined();
    expect(viaGraph).toEqual(viaFS);
  });

  it("C4 @req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978 the REQUIRED-property resolver reads the same declaration through the same helper and keeps the property — `max > 0` is exactly the `any declared value > 0` its own loop answered before", async () => {
    const { requiredKeys } = await allFourReaders(MULTI);
    expect(requiredKeys).toEqual(["flow__Stage_order"]);
  });

  it("C5 @req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978 the DECLARED-property resolver flags the same declaration required = true — under a `first` policy this fixture answers 0 and the flag would be false, which is what makes the axis measure the aggregation rather than restate it", async () => {
    const { declaredRequiredFlag } = await allFourReaders(MULTI);
    expect(declaredRequiredFlag).toBe(true);
  });

  it("C6 @req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978 an unparseable declaration fails OPEN through all four readers — no obligation on either loader, the property absent from the required resolver and required = false on the declared one; the value is user data, where failing open is the policy", async () => {
    const { viaGraph, viaFS, requiredKeys, declaredRequiredFlag } =
      await allFourReaders(["exo__Property_minCount:", "  - abc", "  - def"]);
    expect(viaGraph).toBeDefined();
    expect(viaFS).toBeDefined();
    expect(viaGraph!.minCount).toBeUndefined();
    expect(viaFS!.minCount).toBeUndefined();
    expect(requiredKeys).toEqual([]);
    expect(declaredRequiredFlag).toBe(false);
  });

  it("C10 @req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978 each branch of the shared reader is byte-faithful to the reader it replaced: an RDF Literal is parsed AS WRITTEN (no strip — the old graph reader had none) while a frontmatter string is stripped first (the old FS reader's own predicate), so the convergence unified the decision list without moving either side's lexical pre-processing", () => {
    // ⚠ A quoted Literal is SYNTHETIC — NoteToRDFConverter removes a scalar's
    // quotes itself (probed 2026-09-22: metadataCache hands it `"1"` for the
    // nested form `'"1"'` and it emits the Literal `1`), so no vault input
    // reaches this branch with quotes attached. The axis pins the REFACTOR'S own
    // contract — one branch per predecessor, each byte-identical to it — not a
    // data shape. That contract is what keeps a later reader from "simplifying"
    // the two branches back into one shared strip.
    expect(parseMinCount(new Literal('"1"'))).toBeUndefined();
    expect(parseMinCount(new Literal("1"))).toBe(1);
    expect(parseMinCount('"1"')).toBe(1);
    expect(parseMinCount("1")).toBe(1);
  });

  it("C7 @req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978 the single-valued form is the CONTROL — literal expectations, no reference to its multi-valued siblings, so it stays green under every mutation of the aggregation and proves the ordinary path was never touched", async () => {
    const { viaGraph, viaFS, requiredKeys, declaredRequiredFlag } =
      await allFourReaders(["exo__Property_minCount: 1"]);
    expect(viaGraph!.minCount).toBe(1);
    expect(viaFS!.minCount).toBe(1);
    expect(requiredKeys).toEqual(["flow__Stage_order"]);
    expect(declaredRequiredFlag).toBe(true);
  });
});
