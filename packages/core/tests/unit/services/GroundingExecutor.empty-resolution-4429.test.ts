/**
 * Issue #4429 — `property_append` and `property_set` refuse a value expression
 * that RESOLVES to an empty string.
 *
 * The class: a guard of the form `expression === undefined` rejects an ABSENT
 * expression and says nothing about one that resolves to `""`. PR #4428 closed
 * the hole for `property_replace` (issue #4314); these are the two siblings the
 * review of that PR filed separately, because each touches a second method's
 * behaviour and needs its own axis + mutant.
 *
 * ⛔ The two guards have DIFFERENT predicates, deliberately — they are not one
 * guard spelled twice:
 *   - `property_append` keys on the DECODED value (`plain`), because that method's
 *     Set-based dedup compares decoded forms: a stored `- ""` and a resolved `""`
 *     are the SAME list item, and an `appendExpression` of `'""'` resolves to it.
 *   - `property_set` keys on the RAW substituted value, because there is no
 *     comparison there — the bytes are written as they are, and the defect the
 *     issue names is "a broken substitution silently blanks an existing value".
 *
 * ⛔ Both predicates are STRICT (`=== ""`), never `trim() === ""`. E6 pins that:
 * the measurement behind the sibling guard in `cli set-property` (req 501cdf2c —
 * all three canonical vaults, 34 327 files / 331 263 keys, 2026-08-23) found
 * **0** carriers of `key: ""` but **15** of `key: " "`
 * (`exo__PrintedLiteral_literal` ×9, `exo__DisplayNameSpec_separator` ×6). A
 * trimming predicate would make those two properties unwritable.
 */
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import * as yaml from "js-yaml";

function createMockReader(content: string) {
  return {
    readFile: jest.fn().mockResolvedValue(content),
    fileExists: jest.fn().mockResolvedValue(true),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
}

function createMockWriter() {
  return {
    createFile: jest.fn().mockResolvedValue(""),
    updateFile: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
}

function makeGrounding(
  type: GroundingType,
  overrides: Record<string, unknown>,
): GroundingDefinition {
  return {
    id: "gnd-empty-resolution-4429",
    label: "Empty resolution 4429",
    type,
    ...overrides,
  } as unknown as GroundingDefinition;
}

const TARGET_IRI = "https://exocortex.my/assets/test-asset-123";
const FILE_PATH = "/vault/test-asset.md";

function makeExecutor(content: string): {
  executor: GroundingExecutor;
  writer: ReturnType<typeof createMockWriter>;
} {
  const reader = createMockReader(content);
  const writer = createMockWriter();
  const executor = new GroundingExecutor(reader, writer, new ServiceRegistry());
  return { executor, writer };
}

/** Parse the frontmatter of what was actually written to disk. */
function written(
  writer: ReturnType<typeof createMockWriter>,
  property: string,
): unknown {
  const text = writer.updateFile.mock.calls[0][1] as string;
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  const parsed = yaml.load(fm![1]) as Record<string, unknown>;
  return parsed[property];
}

describe("GroundingExecutor.property_append — an appendExpression that RESOLVES to empty (#4429)", () => {
  it('E1 an appendExpression resolving to `""` is REFUSED and nothing is written', async () => {
    // Production shape: `$input.label` is a named input the user LEFT BLANK.
    // `missingInputHint` reads the TEMPLATE and treats "" as provided
    // (`v !== undefined && v !== null`), so nothing above the guard refuses it,
    // and `substituteVariables` substitutes the empty string.
    const { executor, writer } = makeExecutor(
      `---\nexo__Asset_label: Foo\naliases:\n  - "Bar"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding(GroundingType.PROPERTY_APPEND, {
        targetProperty: "aliases",
        appendExpression: "$input.label",
      }),
      TARGET_IRI,
      FILE_PATH,
      { label: "" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/appendExpression.*empty/);
    // The refusal must be TOTAL — a guard that reports failure after writing
    // would be worse than none.
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it('E2 an explicitly quoted-empty appendExpression (`""`) is the same empty item and is REFUSED', async () => {
    // Same fixture form as #4428's R10: the predicate is on the DECODED value,
    // so the two-character `""` and a bare empty resolution are one case.
    const { executor, writer } = makeExecutor(
      `---\naliases:\n  - "Bar"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding(GroundingType.PROPERTY_APPEND, {
        targetProperty: "aliases",
        appendExpression: '""',
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/appendExpression.*empty/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("E3 control — a NON-empty append onto a list that ALREADY CONTAINS an empty element still works", async () => {
    // Load-bearing: without it, a guard keyed on the LIST's content (refusing
    // whenever any element is empty) would pass E1/E2 while breaking the
    // ordinary case. The refusal must key on the empty EXPRESSION.
    const { executor, writer } = makeExecutor(
      `---\nexo__Asset_label: Foo\naliases:\n  - ""\n  - "Bar"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding(GroundingType.PROPERTY_APPEND, {
        targetProperty: "aliases",
        appendExpression: "$target.exo__Asset_label",
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    expect(written(writer, "aliases")).toEqual(["", "Bar", "Foo"]);
  });

  it('E7 control — a WHITESPACE-ONLY append is still appended: `" "` is a DIFFERENT item from `""`', async () => {
    // The strictness is mechanical here, not symmetry with the set guard: this
    // method's item identity IS the decoded string, and the dedup below compares
    // those — `" "` and `""` are two distinct items, so only the latter is the
    // "resolved to nothing" case. A `trim()`-widened predicate would refuse this.
    const { executor, writer } = makeExecutor(
      `---\naliases:\n  - "Bar"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding(GroundingType.PROPERTY_APPEND, {
        targetProperty: "aliases",
        appendExpression: '" "',
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    expect(written(writer, "aliases")).toEqual(["Bar", " "]);
  });
});

describe("GroundingExecutor.property_set — a value expression that RESOLVES to empty (#4429)", () => {
  it('E4 a targetValueSubstitution resolving to `""` is REFUSED rather than blanking the existing value', async () => {
    const { executor, writer } = makeExecutor(
      `---\nems__Effort_description: Prior text\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding(GroundingType.PROPERTY_SET, {
        targetProperty: "ems__Effort_description",
        targetValueSubstitution: "$input.text",
      }),
      TARGET_IRI,
      FILE_PATH,
      { text: "" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("E5 a targetValueLiteral of `\"\"` is REFUSED (no 'which element' ambiguity here — it is a direct overwrite)", async () => {
    const { executor, writer } = makeExecutor(
      `---\nexo__Asset_label: Prior label\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding(GroundingType.PROPERTY_SET, {
        targetProperty: "exo__Asset_label",
        targetValueLiteral: "",
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it('E6 control — a WHITESPACE-ONLY value is still written: the predicate is strict `=== ""`, not `trim()`', async () => {
    // 15 live carriers of `key: " "` exist across the canonical vaults (req
    // 501cdf2c's measurement). A trimming predicate would refuse them — exactly
    // the too-broad guard #4428's review warned about.
    //
    // ⛤ The fixture uses a STRING-SCALAR property with a RAW space, because that
    // is the only form on which strict-vs-trim is OBSERVABLE here: this guard's
    // predicate reads the raw substituted value, so a value authored in the
    // QUOTED form (`'" "'`, how a non-string-scalar carrier is written —
    // measured: `exo__DisplayNameSpec_separator: " "`) is three characters of
    // which none is whitespace, and no trimming predicate could ever see it. The
    // raw-space form reaches the writer as one space and is quoted on the way out
    // by `serializeYamlScalar` (`aliases` / `exo__Asset_label` are the two
    // string-scalar keys), so it both round-trips AND discriminates.
    const { executor, writer } = makeExecutor(
      `---\nexo__Asset_label: Prior label\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding(GroundingType.PROPERTY_SET, {
        targetProperty: "exo__Asset_label",
        targetValueLiteral: " ",
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    expect(writer.updateFile).toHaveBeenCalled();
    expect(written(writer, "exo__Asset_label")).toBe(" ");
  });
});
