import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import { FrontmatterService } from "../../../src/utilities/FrontmatterService";
import * as yaml from "js-yaml";

/**
 * Issue #4314 — `FrontmatterService.parseObject` dropped every array item after
 * a line it could not classify, and both list primitives write back what they
 * read, so the loss landed ON DISK with no error.
 *
 * The `P*` axes read through the REAL `FrontmatterService`; the `W*` axes drive
 * the REAL `GroundingExecutor` (`property_append` / `property_replace`) and judge
 * the BYTES it handed the writer, parsed by **js-yaml** — the same engine
 * Obsidian and the graph builder use, so "the file is still valid and still
 * carries these values" is decided by an independent reader, not by the parser
 * under test (test-fixture-realism).
 *
 * Measured on the three canonical vaults 2026-09-25 (53 591 files, detector
 * canary green), so each axis says whether it guards live data or ratchets
 * against future data:
 *
 * | shape                                | carriers | pre-fix on disk                       |
 * |--------------------------------------|----------|---------------------------------------|
 * | block-scalar item      (P1/P2/W1/W2) |        0 | body destroyed, co-values dropped     |
 * | 0-indent list          (P3/W3)       |        0 | file UNPARSEABLE (items left dangling)|
 * | flow-style array       (P4/W4/W5)    |       15 | nested array `- ["[[uid]]"]`          |
 * | nested map in an item  (P5)          |        2 | 2nd item dropped                      |
 * | comment between items  (P6/W6)       |       46 | every item after the comment dropped  |
 *
 * ⛔ A top-level `key: |` block scalar (106 carriers) is deliberately NOT changed
 * here — it is a SCALAR, not in #4314, and flipping what its readers see is a
 * separate unit of work (issue #4372). P7 locks that it still reads as `"|-"`.
 */

const UID_A = "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16]]";
const UID_B = "[[ae56ca4c-b610-42a4-a25d-058c23673296]]";
const UID_C = "[[a1f9bca8-6580-458c-bfdb-08579fe357e0]]";

const TARGET_IRI = "https://exocortex.my/assets/test-asset-123";
const FILE_PATH = "/vault/test-asset.md";

/** `exo__Instance_class` with a block-scalar item between two class refs. */
const BLOCK_SCALAR_ITEM_FM =
  `---\nexo__Asset_uid: u1\nexo__Instance_class:\n  - "${UID_A}"\n` +
  `  - |\n    Some block\n    Scalar body\n  - "${UID_C}"\n---\nBody\n`;

/** …with a blank line INSIDE the block-scalar body (legal YAML). */
const BLOCK_SCALAR_BLANK_FM =
  `---\nexo__Asset_uid: u1\nexo__Instance_class:\n  - "${UID_A}"\n` +
  `  - |\n    Some block\n\n    Scalar body\n  - "${UID_C}"\n---\nBody\n`;

/** Column-0 list items — valid YAML, just not this codebase's writer shape. */
const ZERO_INDENT_FM =
  `---\nexo__Asset_uid: u1\nexo__Instance_class:\n- "${UID_A}"\n- "${UID_C}"\n---\nBody\n`;

/** Flow-style array — what the multi-class convert path writes. */
const FLOW_FM = `---\nexo__Asset_uid: u1\nexo__Instance_class: ["${UID_A}"]\n---\nBody\n`;

/** A list of MAPS (SHACL shapes) — the live 2-carrier shape. */
const NESTED_MAP_FM =
  `---\nexo__Asset_uid: u1\nsh__property:\n  - path: "${UID_A}"\n    minCount: 1\n` +
  `  - path: "${UID_C}"\n    minCount: 1\n---\nBody\n`;

/** Aliases with a comment BETWEEN items. */
const COMMENT_IN_LIST_FM =
  `---\nexo__Asset_uid: u1\naliases:\n  - "Протокол GAPS"\n  # Английские\n` +
  `  - "GAPS Diet"\n  # Эпонимные\n  - "Диета Кэмпбелл-МакБрайд"\n---\nBody\n`;

/**
 * Aliases whose FIRST line after the key is a comment — the shape every one of
 * the 33 live carriers actually has (copied from
 * `exoas-my/kitelev/96f81711-…`). Kept as a separate fixture from the
 * between-items one on purpose: the array is still EMPTY at the comment, which
 * is a different branch, and a single fixture carrying both would let a mutant
 * that only breaks this one hide behind the other.
 */
const COMMENT_FIRST_FM =
  `---\nexo__Asset_uid: u1\nexo__Asset_label: "Диета GAPS"\naliases:\n` +
  `  # Русские\n  - "Диета GAPS"\n  - "GAPS-диета"\n  # Английские\n` +
  `  - "GAPS Diet"\n---\nBody\n`;

function createMockWriter() {
  return {
    createFile: jest.fn().mockResolvedValue(""),
    updateFile: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
}

function makeExecutor(content: string): {
  executor: GroundingExecutor;
  writer: ReturnType<typeof createMockWriter>;
} {
  const reader = {
    readFile: jest.fn().mockResolvedValue(content),
    fileExists: jest.fn().mockResolvedValue(true),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
  const writer = createMockWriter();
  return {
    executor: new GroundingExecutor(reader, writer, new ServiceRegistry()),
    writer,
  };
}

function makeGrounding(overrides: Record<string, unknown>): GroundingDefinition {
  return {
    id: "gnd-4314",
    label: "Grounding 4314",
    ...overrides,
  } as unknown as GroundingDefinition;
}

/**
 * The frontmatter BLOCK the executor handed the writer, read back by js-yaml.
 * Throws when the bytes are not valid YAML — which is exactly what the 0-indent
 * shape produced before the fix, so an axis asserting a value also asserts
 * parseability.
 */
function writtenYaml(
  writer: ReturnType<typeof createMockWriter>,
): Record<string, unknown> {
  expect(writer.updateFile).toHaveBeenCalled();
  const written = writer.updateFile.mock.calls[0][1] as string;
  const block = /^---\n([\s\S]*?)\n---/.exec(written);
  expect(block).not.toBeNull();
  return yaml.load(block![1]) as Record<string, unknown>;
}

describe("FrontmatterService.parseObject — list continuation (issue #4314)", () => {
  const fm = new FrontmatterService();

  // ─── P: the read side, on the real service ────────────────────────────────

  it("[P1] a block-scalar item keeps its body AND does not end the array", () => {
    const parsed = fm.parseObject(BLOCK_SCALAR_ITEM_FM);
    expect(parsed?.exo__Instance_class).toEqual([
      `"${UID_A}"`,
      "|\n    Some block\n    Scalar body",
      `"${UID_C}"`,
    ]);
  });

  it("[P2] a blank line inside a block-scalar body stays inside it", () => {
    const parsed = fm.parseObject(BLOCK_SCALAR_BLANK_FM);
    expect(parsed?.exo__Instance_class).toEqual([
      `"${UID_A}"`,
      "|\n    Some block\n\n    Scalar body",
      `"${UID_C}"`,
    ]);
  });

  it("[P3] a column-0 list is read as its items, not as an empty array", () => {
    const parsed = fm.parseObject(ZERO_INDENT_FM);
    expect(parsed?.exo__Instance_class).toEqual([`"${UID_A}"`, `"${UID_C}"`]);
  });

  it("[P4] a flow-style array is read as items, each keeping its RAW quoting", () => {
    expect(fm.parseObject(FLOW_FM)?.exo__Instance_class).toEqual([
      `"${UID_A}"`,
    ]);
    // Quoted item containing the separator, and the empty sequence.
    expect(
      fm.parseObject('---\np: ["a, still one", \'b\']\n---\nX')?.p,
    ).toEqual(['"a, still one"', "'b'"]);
    expect(fm.parseObject("---\np: []\n---\nX")?.p).toEqual([]);
  });

  it("[P5] a list of maps keeps every item with its sub-keys", () => {
    expect(fm.parseObject(NESTED_MAP_FM)?.sh__property).toEqual([
      `path: "${UID_A}"\n    minCount: 1`,
      `path: "${UID_C}"\n    minCount: 1`,
    ]);
  });

  it("[P6] a comment between items neither ends the array nor pollutes a value", () => {
    expect(fm.parseObject(COMMENT_IN_LIST_FM)?.aliases).toEqual([
      '"Протокол GAPS"',
      '"GAPS Diet"',
      '"Диета Кэмпбелл-МакБрайд"',
    ]);
  });

  it("[P9] a comment as the FIRST line under the key does not read the list as empty", () => {
    // The live shape (33 carriers). Pre-fix this returned `[]` — the array was
    // still empty at the comment, so the terminator hit before any item, and
    // property_append then rewrote the property from scratch.
    expect(fm.parseObject(COMMENT_FIRST_FM)?.aliases).toEqual([
      '"Диета GAPS"',
      '"GAPS-диета"',
      '"GAPS Diet"',
    ]);
  });

  it("[P7] control: shapes deliberately left alone keep their pre-#4314 reading", () => {
    // Plain two-space list and scalars — the overwhelmingly common shapes.
    const plain = fm.parseObject(
      `---\nexo__Asset_label: "L"\naliases:\n  - "One"\n  - "Two"\nexo__Asset_archived: true\n---\nBody`,
    );
    expect(plain?.exo__Asset_label).toBe('"L"');
    expect(plain?.aliases).toEqual(['"One"', '"Two"']);
    expect(plain?.exo__Asset_archived).toBe("true");

    // A top-level block scalar is a SCALAR and still reads as its indicator
    // (issue #4372 — out of scope here, on purpose).
    const blockScalar = fm.parseObject(
      `---\nconcept__Concept_definition: |-\n  first line\n  second line\nexo__Asset_label: "L"\n---\nBody`,
    );
    expect(blockScalar?.concept__Concept_definition).toBe("|-");
    expect(blockScalar?.exo__Asset_label).toBe('"L"');

    // A nested map under a bare key is NOT invented as a list item.
    expect(fm.parseObject("---\nkey:\n  sub: v\nother: 1\n---\nBody")).toEqual({
      key: [],
      other: "1",
    });
  });

  it("[P8] a flow value this splitter cannot account for stays an opaque scalar", () => {
    // Unterminated quote / unbalanced bracket → no invented items.
    expect(fm.parseObject('---\np: ["a, b]\n---\nX')?.p).toBe('["a, b]');
    expect(fm.parseObject("---\np: [a, [b]]]\n---\nX")?.p).toBe("[a, [b]]]");
    // Closes before it opens and still ends at depth 0 — only the `depth < 0`
    // guard rejects this one, so it is what makes that guard non-redundant.
    expect(fm.parseObject("---\np: []] [[]\n---\nX")?.p).toBe("[]] [[]");
  });

  // ─── W: the write side, through the real executors, judged by js-yaml ─────

  it("[W1] property_append on a block-scalar list keeps body AND co-value on disk", async () => {
    const { executor, writer } = makeExecutor(BLOCK_SCALAR_ITEM_FM);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "exo__Instance_class",
        appendExpression: `"${UID_B}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    expect(writtenYaml(writer).exo__Instance_class).toEqual([
      UID_A,
      "Some block\nScalar body\n",
      UID_C,
      UID_B,
    ]);
  });

  it("[W2] property_replace on a block-scalar list swaps one item, keeps the rest", async () => {
    const { executor, writer } = makeExecutor(BLOCK_SCALAR_ITEM_FM);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_REPLACE,
        targetProperty: "exo__Instance_class",
        replaceFromExpression: `"${UID_A}"`,
        replaceToExpression: `"${UID_B}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    expect(writtenYaml(writer).exo__Instance_class).toEqual([
      UID_B,
      "Some block\nScalar body\n",
      UID_C,
    ]);
  });

  it("[W3] property_append on a column-0 list leaves a PARSEABLE file with every item", async () => {
    // Pre-fix this wrote `prop:\n  - new` above the original column-0 items and
    // js-yaml refused the result ("end of the stream or a document separator is
    // expected") — the read fix alone would not have closed that, the span on
    // the write side had to own those lines too.
    const { executor, writer } = makeExecutor(ZERO_INDENT_FM);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "exo__Instance_class",
        appendExpression: `"${UID_B}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    expect(writtenYaml(writer).exo__Instance_class).toEqual([
      UID_A,
      UID_C,
      UID_B,
    ]);
  });

  it("[W4] property_append on a flow-style list does not nest it inside an item", async () => {
    const { executor, writer } = makeExecutor(FLOW_FM);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "exo__Instance_class",
        appendExpression: `"${UID_B}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    expect(writtenYaml(writer).exo__Instance_class).toEqual([UID_A, UID_B]);
  });

  it("[W5] property_replace on a flow-style list is no longer refused as a scalar", async () => {
    const { executor, writer } = makeExecutor(FLOW_FM);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_REPLACE,
        targetProperty: "exo__Instance_class",
        replaceFromExpression: `"${UID_A}"`,
        replaceToExpression: `"${UID_B}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    expect(writtenYaml(writer).exo__Instance_class).toEqual([UID_B]);
  });

  it("[W6] property_append on a comment-interleaved alias list keeps every alias and still dedups", async () => {
    // The 46-carrier shape: pre-fix the read stopped at the first comment, so a
    // re-append of an alias that IS already there wrote it again and the aliases
    // below the comment were erased.
    const { executor, writer } = makeExecutor(COMMENT_IN_LIST_FM);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        appendExpression: '"GAPS Diet"',
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    expect(writtenYaml(writer).aliases).toEqual([
      "Протокол GAPS",
      "GAPS Diet",
      "Диета Кэмпбелл-МакБрайд",
    ]);
  });

  it("[W8] property_append on the LIVE alias shape (comment first) keeps every alias", async () => {
    // Pre-fix the property read as `[]`, so this append wrote a one-item list
    // and the three real aliases were gone from disk. 33 live carriers.
    const { executor, writer } = makeExecutor(COMMENT_FIRST_FM);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        appendExpression: "$target.exo__Asset_label",
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    // "Диета GAPS" is the label AND already the first alias → dedup keeps three.
    expect(writtenYaml(writer).aliases).toEqual([
      "Диета GAPS",
      "GAPS-диета",
      "GAPS Diet",
    ]);
  });

  it("[W7] control: the plain two-space list the writers produce is untouched", async () => {
    const { executor, writer } = makeExecutor(
      '---\nexo__Asset_label: "Foo"\naliases:\n  - "Bar"\n---\nBody',
    );
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        appendExpression: "$target.exo__Asset_label",
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    expect(writtenYaml(writer).aliases).toEqual(["Bar", "Foo"]);
  });
});
