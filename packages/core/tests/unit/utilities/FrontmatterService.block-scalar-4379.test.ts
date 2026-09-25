import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import { FrontmatterService } from "../../../src/utilities/FrontmatterService";
import {
  blockScalarAsSequenceItem,
  decodeYamlBlockScalar,
  decodeYamlQuotedScalar,
} from "../../../src/utilities/yamlScalar";
import {
  clearResolvers,
  getResolver,
  installDefaultResolvers,
} from "../../../src/services/SubstitutionResolverRegistry";
import * as yaml from "js-yaml";

/**
 * Issue #4379 — `FrontmatterService.parseObject` read a TOP-LEVEL block scalar
 * (`key: |-` + indented body) as its bare header `"|-"` and skipped the body,
 * so every consumer of the read saw the indicator instead of the text.
 *
 * Measured on the three canonical vaults 2026-09-26 (53 648 files scanned):
 * **106** carrier files — headers `>` 63, `|-` 32, `|` 11; no explicit
 * indentation indicator, no `|+`; body indentation 2 in all of them. Keys:
 * `exocmd__Precondition_sparqlAsk` 84, `concept__Concept_definition` 10,
 * `lit__WebPage_url` 5, `exo__ValidatorRule_customCode` / `_autoFix` 3 + 3,
 * `place__Place_address` 1. Two live sub-shapes are the load-bearing ones:
 * a definition whose body lines look like LIST ITEMS (`  - …`, file f212f1b9)
 * and a validator rule whose body has a `  # …` line (file 12f27c54).
 *
 * The consumers were enumerated from the callers of `parseObject`; each axis
 * below drives one of them through its real code path:
 *
 * | axis | consumer                                              | before the fix                     |
 * |------|-------------------------------------------------------|------------------------------------|
 * | P*   | the read itself                                       | `"|-"`, body gone                  |
 * | U1   | read → `updateProperty` (the `canonicalizeLegacyKeys` | body erased on disk                |
 * |      | round trip in `repair-frontmatter`)                   |                                    |
 * | W1-2 | `property_append` (scalar → list)                     | first item `""`                    |
 * | S1   | `$target.<prop>` substitution                         | the text `|-`                      |
 * | I1   | InheritanceRule copy into a new asset                 | the text `|-`                      |
 * | T1   | `targetProperty` PropertyDefault resolver             | the text `|-`                      |
 *
 * ⛔ W1 guards against a regression the read fix alone would have INTRODUCED:
 * the raw body (indented two columns) written verbatim as a list item sits at
 * the indentation of its own `- `, and js-yaml then rejects the whole
 * frontmatter ("bad indentation") — the asset would drop out of the graph.
 *
 * Every write axis is judged by **js-yaml**, not by the parser under test.
 */

const TARGET_IRI = "https://exocortex.my/assets/test-asset-4379";
const FILE_PATH = "/vault/test-asset-4379.md";

/** Live shape of f212f1b9: a `|-` definition whose lines look like items. */
const DASHED_DEFINITION_FM =
  "---\nexo__Asset_uid: u1\nconcept__Concept_definition: |-\n" +
  "  - Разделение системы на уровни\n  - Вид классификации по уровням\n" +
  'aliases:\n  - "Стратификация"\n---\nBody\n';

/** Live shape of 12f27c54: a `|` rule body with a `#` line, then a second rule. */
const HASH_LINE_RULE_FM =
  "---\nexo__Asset_uid: u1\nexo__ValidatorRule_customCode: |\n" +
  "  # Strip quotes from aliases for comparison\n  const a = 1;\n" +
  "exo__ValidatorRule_autoFix: |\n  return a;\n---\nBody\n";

/** The majority shape (84 of 106): a folded `>` SPARQL precondition. */
const FOLDED_SPARQL_FM =
  "---\nexo__Asset_uid: u1\nexocmd__Precondition_sparqlAsk: >\n" +
  "  ASK {\n    $target exo:Asset_uid ?u .\n  }\n" +
  'exo__Asset_label: "L"\n---\nBody\n';

/** `|-` definition + a plain alias list, the shape the append axes drive. */
const DEFINITION_FM =
  "---\nexo__Asset_uid: u1\nconcept__Concept_definition: |-\n" +
  '  first line\n  second line\naliases:\n  - "Alpha"\n---\nBody\n';

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

function makeGrounding(
  overrides: Record<string, unknown>,
): GroundingDefinition {
  return {
    id: "gnd-4379",
    label: "Grounding 4379",
    ...overrides,
  } as unknown as GroundingDefinition;
}

/** The frontmatter block of written `content`, read back by js-yaml. */
function yamlOf(content: string): Record<string, unknown> {
  const block = /^---\n([\s\S]*?)\n---/.exec(content);
  expect(block).not.toBeNull();
  return yaml.load(block![1]) as Record<string, unknown>;
}

describe("FrontmatterService — top-level block scalar (issue #4379)", () => {
  const fm = new FrontmatterService();

  // ─── P: the read side, on the real service ────────────────────────────────

  it("[P1] a block scalar reads as its RAW text, header and body, and the next key survives", () => {
    const parsed = fm.parseObject(DEFINITION_FM);
    expect(parsed?.concept__Concept_definition).toBe(
      "|-\n  first line\n  second line",
    );
    expect(parsed?.aliases).toEqual(['"Alpha"']);
  });

  it("[P2] body lines shaped like LIST ITEMS or COMMENTS are text, not structure (live shapes)", () => {
    const dashed = fm.parseObject(DASHED_DEFINITION_FM);
    expect(dashed?.concept__Concept_definition).toBe(
      "|-\n  - Разделение системы на уровни\n  - Вид классификации по уровням",
    );
    expect(dashed?.aliases).toEqual(['"Стратификация"']);

    const rule = fm.parseObject(HASH_LINE_RULE_FM);
    expect(rule?.exo__ValidatorRule_customCode).toBe(
      "|\n  # Strip quotes from aliases for comparison\n  const a = 1;",
    );
    expect(rule?.exo__ValidatorRule_autoFix).toBe("|\n  return a;");
  });

  it("[P3] a blank line INSIDE the body stays inside it (ratchet — 0 live carriers)", () => {
    const parsed = fm.parseObject(
      "---\nk: |\n  first\n\n  second\nz: 1\n---\nBody",
    );
    expect(parsed?.k).toBe("|\n  first\n\n  second");
    expect(parsed?.z).toBe("1");
  });

  it("[P4] a blank line AFTER the body is not absorbed, as on the write side", () => {
    const parsed = fm.parseObject("---\nk: >-\n  folded\n\nz: 1\n---\nBody");
    expect(parsed?.k).toBe(">-\n  folded");
    expect(parsed?.z).toBe("1");
  });

  it('[P5] control: a QUOTED `"|-"` is not a header, and a plain scalar is unchanged', () => {
    const parsed = fm.parseObject(
      '---\nk: "|-"\nplain: v\nfolded: >\n  x\n---\nBody',
    );
    expect(parsed?.k).toBe('"|-"');
    expect(parsed?.plain).toBe("v");
    expect(parsed?.folded).toBe(">\n  x");
  });

  // ─── D: raw text → value ─────────────────────────────────────────────────

  it("[D1] decode turns every live header form into the value js-yaml reads", () => {
    for (const content of [
      DEFINITION_FM,
      DASHED_DEFINITION_FM,
      HASH_LINE_RULE_FM,
      FOLDED_SPARQL_FM,
    ]) {
      const parsed = fm.parseObject(content)!;
      const expected = yamlOf(content);
      for (const [key, raw] of Object.entries(parsed)) {
        if (typeof raw !== "string" || !/^[|>]/.test(raw)) continue;
        expect({ key, value: decodeYamlQuotedScalar(raw) }).toEqual({
          key,
          value: expected[key],
        });
      }
    }
  });

  it("[D2] an explicit indentation indicator keeps its meaning (read as a top-level value)", () => {
    // `k: |2-` fixes the body indentation at 2: the extra spaces of `lead` are
    // TEXT. Read standalone, js-yaml would re-base the indicator on column -1.
    expect(decodeYamlBlockScalar("|2-\n    lead\n  base")).toBe("  lead\nbase");
  });

  it("[D3] control: non-block input is returned as before", () => {
    expect(decodeYamlBlockScalar("plain")).toBe("plain");
    expect(decodeYamlBlockScalar('"|-"')).toBe('"|-"');
    expect(decodeYamlQuotedScalar('"Say \\"hi\\""')).toBe('Say "hi"');
    expect(blockScalarAsSequenceItem("plain")).toBe("plain");
  });

  // ─── U / W / S: through the real writers ─────────────────────────────────

  it("[U1] read → updateProperty (the canonicalizeLegacyKeys round trip) keeps the value on disk", () => {
    const raw = fm.parseObject(DEFINITION_FM)!.concept__Concept_definition;
    const rewritten = fm.updateProperty(
      DEFINITION_FM,
      "concept__Concept_definition",
      raw,
    );
    expect(yamlOf(rewritten)).toEqual(yamlOf(DEFINITION_FM));
  });

  it("[W1] property_append on a block scalar keeps its text as the first item — and a PARSEABLE file", async () => {
    const { executor, writer } = makeExecutor(DEFINITION_FM);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "concept__Concept_definition",
        appendExpression: '"Third"',
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    const written = yamlOf(writer.updateFile.mock.calls[0][1] as string);
    expect(written.concept__Concept_definition).toEqual([
      "first line\nsecond line",
      "Third",
    ]);
    expect(written.aliases).toEqual(["Alpha"]);
  });

  it("[W2] property_append on the live dashed shape keeps every dashed line as text", async () => {
    const { executor, writer } = makeExecutor(DASHED_DEFINITION_FM);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "concept__Concept_definition",
        appendExpression: '"Третье"',
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    const written = yamlOf(writer.updateFile.mock.calls[0][1] as string);
    expect(written.concept__Concept_definition).toEqual([
      "- Разделение системы на уровни\n- Вид классификации по уровням",
      "Третье",
    ]);
  });

  it("[S1] `$target.<prop>` substitutes the TEXT of a block scalar, not its header", async () => {
    const { executor, writer } = makeExecutor(DEFINITION_FM);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        appendExpression: "$target.concept__Concept_definition",
      }),
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    const written = yamlOf(writer.updateFile.mock.calls[0][1] as string);
    expect(written.aliases).toEqual(["Alpha", "first line\nsecond line"]);
  });

  it("[I1] InheritanceRule copies the VALUE of a block scalar into the new asset", async () => {
    const targetFm =
      '---\nexo__Asset_uid: u1\nexo__Instance_class:\n  - "[[ems__Area]]"\n' +
      "concept__Concept_definition: |-\n  first line\n  second line\n---\nBody";
    const { executor, writer } = makeExecutor(targetFm);
    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "concept__Concept_definition",
            targetPropertyName: "concept__Concept_definition",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      }),
      TARGET_IRI,
      FILE_PATH,
      { label: "inherits a definition" },
    );
    expect(result.success).toBe(true);
    const created = yamlOf(writer.createFile.mock.calls[0][1] as string);
    expect(created.concept__Concept_definition).toBe("first line\nsecond line");
  });

  describe("[T] targetProperty resolver", () => {
    beforeEach(() => {
      clearResolvers();
      installDefaultResolvers();
    });

    it("[T1] a block-scalar default resolves to its VALUE, scalar and list item alike", () => {
      const fn = getResolver("targetProperty")!;
      expect(
        fn({ targetFm: { d: "|-\n  first line\n  second line" } }, "d"),
      ).toBe("first line\nsecond line");
      expect(fn({ targetFm: { l: ['"A"', "|\n    body"] } }, "l")).toEqual([
        '"A"',
        "body\n",
      ]);
    });
  });
});
