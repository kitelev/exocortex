/**
 * req b06129dc — a `property_set` whose `targetValueRef` is fed from the user's
 * input (`$input.parent`, `$input.blocker` — set-parent / set-blocker) accepts
 * the reference as a bare uid OR a single wikilink (`[[uid]]`, `[[uid|alias]]`,
 * `"[[uid]]"`), normalises it through `extractAssetReference` to ONE resolvable
 * link, and refuses a residue loudly instead of writing `"[[[[uid]]]]"` at rc 0
 * (ticket 52199c53).
 *
 * Production-shape, same harness as req 29e0d1b6: the REAL `GroundingExecutor`
 * over the REAL `FrontmatterService` write path (only the filesystem ports are
 * faked), and the written frontmatter is parsed with the REAL YAML reader —
 * the defect is a resolvability disagreement (`[[[[uid]]]]` is a string too,
 * only a broken one), so the assertion is on the exact stored value.
 *
 * Each axis is revert-verified by a mutant that removes ONE guarantee (table
 * in the PR body): B1-B3 red without the normaliser, B5 red without the
 * residue detection. B7 is a CONTROL of the pre-existing missing-input gate:
 * the gate reads the TEMPLATE (`"[[$input.parent]]"`) before any substitution
 * and the placeholder carries no brackets, so the order "gate first,
 * normaliser second" is not observable by construction (no mutant; see PR).
 *
 * @req:b06129dc-a6da-40d1-90b5-1789fb927a63
 */

import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../src/services/GroundingExecutor";
import { GroundingType } from "../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../src/domain/models/CommandDefinition";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

const REQ = "@req:b06129dc-a6da-40d1-90b5-1789fb927a63";
const TARGET_IRI = "obsidian://vault/assetspaces/kitelev/exoas-my/task.md";
const FILE_PATH = "assetspaces/kitelev/exoas-my/task.md";
const PARENT_UID = "3f1d005c-7a2e-4b8f-9c1d-5e6f7a8b9c0d";

const TARGET_CONTENT = [
  "---",
  "exo__Asset_uid: 11111111-2222-3333-4444-555555555555",
  'exo__Asset_label: "Some task"',
  'exo__Asset_isDefinedBy: "[[00000000-0000-4000-8000-000000000000]]"',
  "---",
  "Body",
].join("\n");

function makeReader(content = TARGET_CONTENT) {
  return {
    readFile: jest.fn().mockResolvedValue(content),
    fileExists: jest.fn().mockResolvedValue(true),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
}

function makeWriter() {
  return {
    createFile: jest.fn().mockResolvedValue(""),
    writeFile: jest.fn().mockResolvedValue(undefined),
    updateFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
}

/** The live `set-parent` grounding shape (exoas-exocmd `18f12de2`). */
function setParentGrounding(): GroundingDefinition {
  return {
    id: "gnd-req-b06129dc",
    label: "Set parent grounding (fixture)",
    type: GroundingType.PROPERTY_SET,
    targetProperty: "ems__Effort_parent",
    targetValueRef: "$input.parent",
  } as unknown as GroundingDefinition;
}

describe("req b06129dc — property_set targetValueRef fed from $input accepts a wrapped reference and never writes [[[[uid]]]]", () => {
  let reader: ReturnType<typeof makeReader>;
  let writer: ReturnType<typeof makeWriter>;
  let executor: GroundingExecutor;

  beforeEach(() => {
    reader = makeReader();
    writer = makeWriter();
    executor = new GroundingExecutor(reader, writer, new ServiceRegistry());
  });

  /** Run set-parent with `parent` = `input`; return the parsed + raw written frontmatter. */
  async function setParent(input: string) {
    const result = await executor.execute(setParentGrounding(), TARGET_IRI, FILE_PATH, {
      parent: input,
    });
    return {
      result,
      written: (writer.updateFile.mock.calls[0]?.[1] as string | undefined) ?? "",
    };
  }

  it(`B1 (Scenario 1) [[uid]] on input is unwrapped ONCE and stored as the single link "[[uid]]" — never "[[[[uid]]]]" ${REQ}`, async () => {
    const { result, written } = await setParent(`[[${PARENT_UID}]]`);
    expect(result.success).toBe(true);
    expect(writer.updateFile).toHaveBeenCalledTimes(1);
    expect(written).toContain(`ems__Effort_parent: "[[${PARENT_UID}]]"`);
    expect(written).not.toContain("[[[[");
    const fm = parseFrontmatterAsReader(written);
    expect(fm.ems__Effort_parent).toBe(`[[${PARENT_UID}]]`);
  });

  it(`B2 (Scenario 2) [[uid|alias]] drops the alias and stores "[[uid]]" ${REQ}`, async () => {
    const { result, written } = await setParent(`[[${PARENT_UID}|Some parent]]`);
    expect(result.success).toBe(true);
    const fm = parseFrontmatterAsReader(written);
    expect(fm.ems__Effort_parent).toBe(`[[${PARENT_UID}]]`);
  });

  it(`B3 (Scenario 2) the quoted "[[uid]]" form (YAML quotes included) stores the same "[[uid]]" ${REQ}`, async () => {
    const { result, written } = await setParent(`"[[${PARENT_UID}]]"`);
    expect(result.success).toBe(true);
    const fm = parseFrontmatterAsReader(written);
    expect(fm.ems__Effort_parent).toBe(`[[${PARENT_UID}]]`);
  });

  it(`B4 (Scenario 3, control) the bare uid keeps today's behaviour byte-identically ${REQ}`, async () => {
    const { result, written } = await setParent(PARENT_UID);
    expect(result.success).toBe(true);
    expect(written).toContain(`ems__Effort_parent: "[[${PARENT_UID}]]"`);
    const fm = parseFrontmatterAsReader(written);
    expect(fm.ems__Effort_parent).toBe(`[[${PARENT_UID}]]`);
  });

  // PR #4242 review MEDIUM: the residue is detected BEFORE the alias strip —
  // `extractAssetReference` drops everything after the first `|`, so checking
  // its output let `[[uid|alias]] see also` through as "[[uid]]". LOW-6: an
  // empty input used to be written as "[[]]".
  it.each([
    ["nested [[[[uid]]]]", `[[[[${PARENT_UID}]]]]`],
    ["link inside prose", `[[${PARENT_UID}]] see also`],
    ["aliased link inside prose", `[[${PARENT_UID}|alias]] see also`],
    ["aliased link followed by a second link", `[[${PARENT_UID}|alias]] [[other]]`],
    ["aliased link with stray closing brackets", `[[${PARENT_UID}|a]]]]`],
    ["bare uid with garbage and a link", `${PARENT_UID}|garbage [[x]]`],
  ])(`B5 (Scenario 4) %s is refused loudly and nothing is written ${REQ}`, async (_label, bad) => {
    const { result } = await setParent(bad);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BARE uid/);
    expect(result.error).toContain(PARENT_UID);
    expect(result.error).toContain("ems__Effort_parent");
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it(`B5e (Scenario 4) an EMPTY input is refused instead of being written as "[[]]" ${REQ}`, async () => {
    const { result } = await setParent("");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BARE uid/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it(`B10 (Scenario 2) inner whitespace is trimmed: [[ uid ]] stores "[[uid]]" ${REQ}`, async () => {
    const { result, written } = await setParent(`[[ ${PARENT_UID} ]]`);
    expect(result.success).toBe(true);
    const fm = parseFrontmatterAsReader(written);
    expect(fm.ems__Effort_parent).toBe(`[[${PARENT_UID}]]`);
  });

  it(`B6 (Scenario 6, control) a STATIC targetValueRef (no $input token) is byte-identical to the pre-req path ${REQ}`, async () => {
    const result = await executor.execute(
      {
        ...setParentGrounding(),
        targetValueRef: PARENT_UID,
      } as unknown as GroundingDefinition,
      TARGET_IRI,
      FILE_PATH,
    );
    expect(result.success).toBe(true);
    const written = writer.updateFile.mock.calls[0][1] as string;
    expect(written).toContain(`ems__Effort_parent: "[[${PARENT_UID}]]"`);
  });

  it(`B7 (Scenario 5, control) an absent $input.parent — the missing-input refusal is returned unchanged, not the reference one ${REQ}`, async () => {
    const result = await executor.execute(setParentGrounding(), TARGET_IRI, FILE_PATH, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/input that was not provided/);
    expect(result.error).toContain(`--input '{"parent":...}'`);
    expect(result.error).not.toMatch(/BARE uid/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it(`B8 (Scenario 6, control) the sibling targetValueSubstitution contract is untouched — an unquoted [[uid]] is still refused (req 29e0d1b6) ${REQ}`, async () => {
    const result = await executor.execute(
      {
        ...setParentGrounding(),
        targetValueRef: undefined,
        targetValueSubstitution: "$input.parent",
      } as unknown as GroundingDefinition,
      TARGET_IRI,
      FILE_PATH,
      { parent: `[[${PARENT_UID}]]` },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/UNQUOTED wikilink/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });
});
