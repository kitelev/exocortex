/**
 * ems__Bug 530f895d — `property_replace` / `property_append` compare a list item
 * by its IDENTITY, not by its string: a wikilink is identified by its link
 * target, so `[[<uid>|ems__Task]]` and `[[<uid>]]` are one value.
 *
 * Before the fix (CLI 17.14.3, reproduced on an APFS clone of vault-bot-ao):
 *   - `apply replace-instance-class` refused (rc=5, "is not a value of") when the
 *     class on the asset carried an alias and `from` did not — the recipe the bots
 *     are taught passes `[[<uid>]]`;
 *   - `apply append-instance-class` wrote the class a second time in the other
 *     form (rc=0, "Class appended");
 *   - `replace` likewise kept `to` twice when it was already present in the other
 *     form.
 *
 * Four comparison sites, one identity (`listItemIdentity`):
 *   append dedup (K5, K6, K9) · replace `from` lookup (K1, K2, K7, K20) ·
 *   replace `from === to` refusal (K4, K14, K19, K21) ·
 *   replace `to` already present (K3, K13).
 *
 * ⛔ Boundaries this file locks on purpose (they must stay GREEN before and after):
 *   - K7 / K9: the SAME alias on DIFFERENT targets is two values — identity is the
 *     target, never the display alias;
 *   - K8: a pipe inside a PLAIN value is text — `aliases` holds labels like
 *     `Foo | Bar`, which must not collapse onto `Foo`;
 *   - K10 / K11: a bare `<uid>` with no brackets is NOT merged with `[[<uid>]]`
 *     — readers disagree on it (the RDF converter resolves it as the class,
 *     FileSpaceDiscovery reads wikilinks only), so it keeps byte comparison;
 *   - K16 / K17: whitespace around the link or its target is NOT trimmed —
 *     the converter emits such a value as a literal (no rdf:type), so it must
 *     not swallow the working link next to it;
 *   - K18: an empty link target (`[[|x]]`) is its own value;
 *   - K12 / K15: `to` and the co-values are written exactly as passed / as
 *     stored — identity drives the comparisons, never the write;
 *   - K20: `from` replaces the item spelled exactly like it before another form
 *     of the same target (as before the fix); K21: byte-identical `from === to`
 *     is refused even when the list holds that value twice (#4432).
 * Out of scope, deliberately NOT locked here: the label form `[[ems__Task]]`
 * against the UID form — recognising them as one value needs a vault lookup
 * (ems__Bug bf192739).
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

function makeExecutor(content: string): {
  executor: GroundingExecutor;
  writer: ReturnType<typeof createMockWriter>;
} {
  const writer = createMockWriter();
  const executor = new GroundingExecutor(
    createMockReader(content),
    writer,
    new ServiceRegistry(),
  );
  return { executor, writer };
}

/** The list as it sits on disk after the step: what was written, else the input. */
function listOnDisk(
  writer: ReturnType<typeof createMockWriter>,
  input: string,
  property: string,
): unknown {
  const text =
    writer.updateFile.mock.calls.length > 0
      ? (writer.updateFile.mock.calls[0][1] as string)
      : input;
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  return (yaml.load(fm?.[1] ?? "") as Record<string, unknown>)[property];
}

const asset = (property: string, items: string[]): string =>
  `---\n${property}:\n${items.map((i) => `  - "${i}"`).join("\n")}\n---\nBody`;

const replace = (from: string, to: string): GroundingDefinition =>
  ({
    id: "gnd-replace",
    label: "Replace",
    type: GroundingType.PROPERTY_REPLACE,
    targetProperty: "exo__Instance_class",
    replaceFromExpression: `"${from}"`,
    replaceToExpression: `"${to}"`,
  }) as unknown as GroundingDefinition;

const append = (property: string, value: string): GroundingDefinition =>
  ({
    id: "gnd-append",
    label: "Append",
    type: GroundingType.PROPERTY_APPEND,
    targetProperty: property,
    appendExpression: `"${value}"`,
  }) as unknown as GroundingDefinition;

const IRI = "https://exocortex.my/assets/test-asset-530f895d";
const PATH = "/vault/test-asset.md";
const TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const PROJECT = "7db5eeff-718a-49b0-8d2b-39b084a356e3";
const OTHER = "8619c4fc-64f1-4869-b17e-e34186cacca9";
const IC = "exo__Instance_class";

describe("GroundingExecutor — list items compared by link target (ems__Bug 530f895d)", () => {
  it("K1 replace: a plain `from` finds the class written WITH an alias; co-values keep value and order", async () => {
    const input = asset(IC, [`[[${TASK}|ems__Task]]`, `[[${OTHER}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}]]`, `[[${PROJECT}]]`),
      IRI,
      PATH,
    );
    expect(r).toEqual({ success: true });
    expect(listOnDisk(writer, input, IC)).toEqual([
      `[[${PROJECT}]]`,
      `[[${OTHER}]]`,
    ]);
  });

  it("K2 replace: an aliased `from` finds the class written WITHOUT an alias", async () => {
    const input = asset(IC, [`[[${TASK}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}|ems__Task]]`, `[[${PROJECT}]]`),
      IRI,
      PATH,
    );
    expect(r).toEqual({ success: true });
    expect(listOnDisk(writer, input, IC)).toEqual([`[[${PROJECT}]]`]);
  });

  it("K3 replace: `to` already present in the OTHER form drops `from` instead of writing a second copy", async () => {
    const input = asset(IC, [`[[${TASK}]]`, `[[${PROJECT}|ems__Project]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}]]`, `[[${PROJECT}]]`),
      IRI,
      PATH,
    );
    expect(r).toEqual({ success: true });
    expect(listOnDisk(writer, input, IC)).toEqual([
      `[[${PROJECT}|ems__Project]]`,
    ]);
  });

  it("K4 replace: `from` and `to` naming ONE target in two forms is refused as a no-op, nothing written", async () => {
    const input = asset(IC, [`[[${TASK}|ems__Task]]`, `[[${OTHER}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}|ems__Task]]`, `[[${TASK}]]`),
      IRI,
      PATH,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/one link target/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("K5 append: a plain class already present WITH an alias is not written a second time", async () => {
    const input = asset(IC, [`[[${TASK}|ems__Task]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(append(IC, `[[${TASK}]]`), IRI, PATH);
    expect(r.success).toBe(true);
    expect(listOnDisk(writer, input, IC)).toEqual([`[[${TASK}|ems__Task]]`]);
  });

  it("K6 append: an aliased class already present WITHOUT an alias is not written a second time", async () => {
    const input = asset(IC, [`[[${TASK}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      append(IC, `[[${TASK}|ems__Task]]`),
      IRI,
      PATH,
    );
    expect(r.success).toBe(true);
    expect(listOnDisk(writer, input, IC)).toEqual([`[[${TASK}]]`]);
  });

  it("K7 boundary: the SAME alias on a DIFFERENT target is not the value — replace still refuses", async () => {
    const input = asset(IC, [`[[${OTHER}|ems__Task]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}|ems__Task]]`, `[[${PROJECT}]]`),
      IRI,
      PATH,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/is not a value of/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("K8 boundary: a pipe inside a PLAIN alias is text — `Foo` is appended next to `Foo | Bar`", async () => {
    const input = asset("aliases", ["Foo | Bar"]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(append("aliases", "Foo"), IRI, PATH);
    expect(r.success).toBe(true);
    expect(listOnDisk(writer, input, "aliases")).toEqual(["Foo | Bar", "Foo"]);
  });

  it("K9 boundary: the SAME alias on a DIFFERENT target is a new value — append writes it", async () => {
    const input = asset(IC, [`[[${OTHER}|ems__Task]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      append(IC, `[[${TASK}|ems__Task]]`),
      IRI,
      PATH,
    );
    expect(r.success).toBe(true);
    expect(listOnDisk(writer, input, IC)).toEqual([
      `[[${OTHER}|ems__Task]]`,
      `[[${TASK}|ems__Task]]`,
    ]);
  });

  it("K10 boundary: a bare uid `from` (no brackets) is not merged with the link — replace still refuses", async () => {
    const input = asset(IC, [`[[${TASK}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(TASK, `[[${PROJECT}]]`),
      IRI,
      PATH,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/is not a value of/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("K11 boundary: the link is appended next to a bare uid (no brackets) — they are two values", async () => {
    const input = asset(IC, [TASK]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(append(IC, `[[${TASK}]]`), IRI, PATH);
    expect(r.success).toBe(true);
    expect(listOnDisk(writer, input, IC)).toEqual([TASK, `[[${TASK}]]`]);
  });

  it("K12 replace: an aliased `to` is written exactly as passed, alias kept", async () => {
    const input = asset(IC, [`[[${TASK}]]`, `[[${OTHER}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}]]`, `[[${PROJECT}|ems__Project]]`),
      IRI,
      PATH,
    );
    expect(r).toEqual({ success: true });
    expect(listOnDisk(writer, input, IC)).toEqual([
      `[[${PROJECT}|ems__Project]]`,
      `[[${OTHER}]]`,
    ]);
  });

  it("K13 replace: an aliased `to` already present WITHOUT an alias drops `from` instead of writing a second copy", async () => {
    const input = asset(IC, [`[[${TASK}]]`, `[[${PROJECT}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}]]`, `[[${PROJECT}|ems__Project]]`),
      IRI,
      PATH,
    );
    expect(r).toEqual({ success: true });
    expect(listOnDisk(writer, input, IC)).toEqual([`[[${PROJECT}]]`]);
  });

  it("K14 replace: a plain `from` → the aliased form of the SAME target is refused as a no-op, nothing written", async () => {
    const input = asset(IC, [`[[${TASK}]]`, `[[${OTHER}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}]]`, `[[${TASK}|ems__Task]]`),
      IRI,
      PATH,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/one link target/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("K15 replace: co-values are kept exactly as stored, aliases included", async () => {
    const input = asset(IC, [`[[${TASK}]]`, `[[${OTHER}|exo__Class]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}]]`, `[[${PROJECT}]]`),
      IRI,
      PATH,
    );
    expect(r).toEqual({ success: true });
    expect(listOnDisk(writer, input, IC)).toEqual([
      `[[${PROJECT}]]`,
      `[[${OTHER}|exo__Class]]`,
    ]);
  });

  it("K16 boundary: whitespace AROUND a link is not trimmed — the link is appended next to ` [[uid]]`", async () => {
    const input = asset(IC, [` [[${TASK}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(append(IC, `[[${TASK}]]`), IRI, PATH);
    expect(r.success).toBe(true);
    expect(listOnDisk(writer, input, IC)).toEqual([
      ` [[${TASK}]]`,
      `[[${TASK}]]`,
    ]);
  });

  it("K17 boundary: whitespace around a link TARGET is not trimmed — the link is appended next to `[[ uid ]]`", async () => {
    const input = asset(IC, [`[[ ${TASK} ]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(append(IC, `[[${TASK}]]`), IRI, PATH);
    expect(r.success).toBe(true);
    expect(listOnDisk(writer, input, IC)).toEqual([
      `[[ ${TASK} ]]`,
      `[[${TASK}]]`,
    ]);
  });

  it("K18 boundary: an EMPTY link target is its own value — `[[|y]]` is appended next to `[[|x]]`", async () => {
    const input = asset(IC, ["[[|x]]"]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(append(IC, "[[|y]]"), IRI, PATH);
    expect(r.success).toBe(true);
    expect(listOnDisk(writer, input, IC)).toEqual(["[[|x]]", "[[|y]]"]);
  });

  it("K19 replace: a class stored in TWO forms collapses onto `to` — the duplicate the old comparison wrote is removable", async () => {
    const input = asset(IC, [`[[${TASK}|ems__Task]]`, `[[${TASK}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}]]`, `[[${TASK}|ems__Task]]`),
      IRI,
      PATH,
    );
    expect(r).toEqual({ success: true });
    expect(listOnDisk(writer, input, IC)).toEqual([`[[${TASK}|ems__Task]]`]);
  });

  it("K20 replace: `from` replaces the item spelled exactly like it, not the first form of its target", async () => {
    const input = asset(IC, [
      `[[${TASK}|ems__Task]]`,
      `[[${OTHER}]]`,
      `[[${TASK}]]`,
    ]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}]]`, `[[${PROJECT}]]`),
      IRI,
      PATH,
    );
    expect(r).toEqual({ success: true });
    expect(listOnDisk(writer, input, IC)).toEqual([
      `[[${TASK}|ems__Task]]`,
      `[[${OTHER}]]`,
      `[[${PROJECT}]]`,
    ]);
  });

  it("K21 replace: byte-identical `from === to` is refused even when the list holds that value twice (#4432)", async () => {
    const input = asset(IC, [`[[${TASK}]]`, `[[${TASK}]]`]);
    const { executor, writer } = makeExecutor(input);
    const r = await executor.execute(
      replace(`[[${TASK}]]`, `[[${TASK}]]`),
      IRI,
      PATH,
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/both resolved to/);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });
});
