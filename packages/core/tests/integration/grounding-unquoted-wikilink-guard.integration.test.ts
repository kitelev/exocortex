/**
 * req 29e0d1b6 — `property_set` refuses an UNQUOTED wikilink instead of writing
 * a silent literal into the graph.
 *
 * Production-shape: drives the REAL `GroundingExecutor.execute` over the REAL
 * `FrontmatterService` write path (only the filesystem ports are faked), and
 * parses the written frontmatter with the REAL YAML parser — because the whole
 * defect is a YAML-parse disagreement (a bare `[[uid]]` is a flow SEQUENCE, so
 * the converter emits a literal and the reference is lost) that no assertion on
 * the raw string could honestly demonstrate.
 */
import * as yaml from "js-yaml";

import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../src/services/GroundingExecutor";
import { GroundingType } from "../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../src/domain/models/CommandDefinition";

const TARGET_IRI = "obsidian://vault/assetspaces/kitelev/exoas-my/task.md";
const FILE_PATH = "assetspaces/kitelev/exoas-my/task.md";
const ONTOLOGY_UID = "9d1d2e9d-3f9e-4c6a-9a3f-0f2a1c6b7e11";

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

function makeGrounding(overrides: Record<string, unknown>): GroundingDefinition {
  return {
    id: "gnd-req-29e0d1b6",
    label: "Set Ontology (fixture)",
    type: GroundingType.PROPERTY_SET,
    ...overrides,
  } as unknown as GroundingDefinition;
}

/** Parse the frontmatter block of a written note with the real YAML parser. */
function parseFrontmatter(written: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---/.exec(written);
  expect(match).not.toBeNull();
  return yaml.load((match as RegExpExecArray)[1]) as Record<string, unknown>;
}

describe("req 29e0d1b6 — property_set rejects an unquoted wikilink value", () => {
  let reader: ReturnType<typeof makeReader>;
  let writer: ReturnType<typeof makeWriter>;
  let executor: GroundingExecutor;

  beforeEach(() => {
    reader = makeReader();
    writer = makeWriter();
    executor = new GroundingExecutor(reader, writer, new ServiceRegistry());
  });

  const substitutionGrounding = () =>
    makeGrounding({
      targetProperty: "exo__Asset_isDefinedBy",
      targetValueSubstitution: "$input.ontology",
    });

  it("Scenario 1: @req:29e0d1b6-3863-4af3-8807-02e546b0817a refuses the bare [[uid]] form and writes nothing", async () => {
    const result = await executor.execute(
      substitutionGrounding(),
      TARGET_IRI,
      FILE_PATH,
      { ontology: `[[${ONTOLOGY_UID}]]` },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/UNQUOTED wikilink/);
    // The message must teach BOTH contracts — the asymmetry is the defect.
    expect(result.error).toMatch(/targetValueRef/);
    expect(result.error).toContain(ONTOLOGY_UID);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it('Scenario 2: @req:29e0d1b6-3863-4af3-8807-02e546b0817a accepts the quoted "[[uid]]" form and YAML reads it as a string', async () => {
    const result = await executor.execute(
      substitutionGrounding(),
      TARGET_IRI,
      FILE_PATH,
      { ontology: `"[[${ONTOLOGY_UID}]]"` },
    );

    expect(result.success).toBe(true);
    expect(writer.updateFile).toHaveBeenCalledTimes(1);
    const written = writer.updateFile.mock.calls[0][1] as string;
    expect(written).toContain(`exo__Asset_isDefinedBy: "[[${ONTOLOGY_UID}]]"`);

    // The load-bearing half: a STRING (resolvable reference), never a sequence.
    const fm = parseFrontmatter(written);
    expect(typeof fm.exo__Asset_isDefinedBy).toBe("string");
    expect(fm.exo__Asset_isDefinedBy).toBe(`[[${ONTOLOGY_UID}]]`);
  });

  it("Scenario 3: @req:29e0d1b6-3863-4af3-8807-02e546b0817a the sibling targetValueRef contract (bare uid) is unaffected", async () => {
    const result = await executor.execute(
      makeGrounding({
        targetProperty: "exo__Asset_isDefinedBy",
        targetValueRef: ONTOLOGY_UID,
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    const written = writer.updateFile.mock.calls[0][1] as string;
    const fm = parseFrontmatter(written);
    expect(typeof fm.exo__Asset_isDefinedBy).toBe("string");
    expect(fm.exo__Asset_isDefinedBy).toBe(`[[${ONTOLOGY_UID}]]`);
  });

  it("Scenario 4: @req:29e0d1b6-3863-4af3-8807-02e546b0817a non-reference substituted values are unaffected", async () => {
    // (a) a plain label on a string-scalar property — quoted by
    //     serializeYamlScalar BEFORE the guard, so it must still pass.
    const labelResult = await executor.execute(
      makeGrounding({
        targetProperty: "exo__Asset_label",
        targetValueSubstitution: "$input.label",
      }),
      TARGET_IRI,
      FILE_PATH,
      { label: "Quarterly review" },
    );
    expect(labelResult.success).toBe(true);

    // (b) prose that merely CONTAINS a wikilink is a string either way — it
    //     carries no silent-literal risk, so the guard must leave it alone.
    const proseWriter = makeWriter();
    const proseExecutor = new GroundingExecutor(
      makeReader(),
      proseWriter,
      new ServiceRegistry(),
    );
    const proseResult = await proseExecutor.execute(
      makeGrounding({
        targetProperty: "ems__Effort_result",
        targetValueSubstitution: "$input.note",
      }),
      TARGET_IRI,
      FILE_PATH,
      { note: `see [[${ONTOLOGY_UID}]] for details` },
    );
    expect(proseResult.success).toBe(true);
    const proseWritten = proseWriter.updateFile.mock.calls[0][1] as string;
    expect(proseWritten).toContain(
      `ems__Effort_result: see [[${ONTOLOGY_UID}]] for details`,
    );
  });
});
