import "reflect-metadata";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import {
  IFileSystemReader,
  IFileSystemWriter,
} from "../../../src/interfaces/IFileSystemAdapter";
import type { DeclaredRangesResolver } from "../../../src/services/DeclaredRangesResolver";

/**
 * Ticket 534a7a46 — the create_instance / property_set write path types a YAML
 * scalar by the property's declared `exo__Property_range` (CLI↔UI parity #3417).
 *
 * These axes drive the REAL `GroundingExecutor.execute()` and read the bytes it
 * writes, so they judge the emitted frontmatter rather than a helper's return.
 * The declared-range PORT is stubbed here on purpose: this file's subject is the
 * THREADING (does the range reach `serializeYamlScalar`, and is the gate on the
 * property_set side load-bearing), while the port's own store-backed
 * implementation — and the namespace trap in its key derivation — is the subject
 * of `tests/unit/services/DeclaredRangesResolver.test.ts` (K1–K7).
 *
 * ⛔ K12 is SYNTHETIC BY NECESSITY, and that is the honest statement, not a
 * hedge: measured 2026-09-20, all 48 live `exocmd__Grounding_targetProperty`
 * values [vault-exodev] target a property with NO declared range, so the
 * property_set half of this change cannot be exercised on live data at all. The
 * inertness is what makes the change regression-free there; it is not what makes
 * it covered.
 */

// Literal @req token for requirements-trace's STATIC scanner, which cannot see the
// template-literal form the titles below use (archgate REQ-001/
// no-template-literal-only-req-binding): @req:675cb0ab-b73d-4736-934d-6094e792af5d
const REQ = "675cb0ab-b73d-4736-934d-6094e792af5d";

class InMemoryFileSystem implements IFileSystemReader, IFileSystemWriter {
  private files = new Map<string, string>();

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }
  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async getMarkdownFiles(): Promise<string[]> {
    return Array.from(this.files.keys()).filter((p) => p.endsWith(".md"));
  }
  async createFile(path: string, content: string): Promise<string> {
    this.files.set(path, content);
    return path;
  }
  async updateFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content !== undefined) {
      this.files.set(newPath, content);
      this.files.delete(oldPath);
    }
  }
  getContent(path: string): string | undefined {
    return this.files.get(path);
  }
  getAllPaths(): string[] {
    return Array.from(this.files.keys());
  }
}

/** A stub port: the map a store-backed resolver would have produced. */
function rangesOf(
  entries: Record<string, readonly string[]>,
): DeclaredRangesResolver {
  const map = new Map<string, readonly string[]>(Object.entries(entries));
  return async () => map;
}

function executorWith(
  fs: InMemoryFileSystem,
  declaredRanges?: DeclaredRangesResolver,
): GroundingExecutor {
  return new GroundingExecutor(fs, fs, new ServiceRegistry(), undefined, {
    declaredRanges,
  });
}

/** create_instance writing ONE property, supplied through a PropertyDefault. */
function createGrounding(
  propertyName: string,
  value: string,
): GroundingDefinition {
  return {
    id: "gnd-range-typing",
    label: "Create with a ranged property",
    type: GroundingType.CREATE_INSTANCE,
    targetClass: "ems__Task",
    targetFolder: "01 Inbox",
    propertyDefault: [{ propertyName, value }],
  } as GroundingDefinition;
}

/**
 * create_instance writing ONE property whose value is copied from a
 * MULTI-VALUED property of `$target` — the production shape that makes
 * `properties[key]` an ARRAY (`applyPropertyDefaultStep`: `Array.isArray(resolved)`
 * stores the list verbatim), and therefore the only one that reaches the array
 * emission point of `FrontmatterService.serializeValue`.
 *
 * The marker form is the parameterised one the resolver registry answers
 * (`__SUBSTITUTE_P__<id>__<uuid>__<base64url-param>__`); `targetProperty`
 * returns `v.map(String)` when the target's value is an array.
 */
function createFromTargetListGrounding(
  propertyName: string,
  sourceKey: string,
): GroundingDefinition {
  const param = Buffer.from(sourceKey, "utf-8").toString("base64url");
  return createGrounding(
    propertyName,
    `__SUBSTITUTE_P__targetProperty__33333333-4444-5555-6666-777777777777__${param}__`,
  );
}

function propertySetGrounding(
  targetProperty: string,
  literal: string,
): GroundingDefinition {
  return {
    id: "gnd-range-typing-set",
    label: "Set a ranged property",
    type: GroundingType.PROPERTY_SET,
    targetProperty,
    targetValueLiteral: literal,
  } as GroundingDefinition;
}

const TARGET_PATH = "01 Inbox/target.md";
// Ticket afb25c43 — the target carries a MULTI-VALUED property so a
// create_instance can copy it through `targetProperty`, which returns
// `v.map(String)` for an array value (SubstitutionResolverRegistry). That is
// the production input for the ARRAY emission point (K18/K19); no other axis
// in this file reads this key.
const TARGET_MULTI_KEY = "flow__Stage_chatIds";
const TARGET_MULTI_VALUES = ["-1003912427125", "-1002000000001"];
const TARGET_CONTENT = [
  "---",
  "exo__Asset_uid: 11111111-2222-3333-4444-555555555555",
  'exo__Asset_label: "Target"',
  `${TARGET_MULTI_KEY}:`,
  // ⛔ BARE items, not quoted: `FrontmatterService.parseObject` keeps a quoted
  // item's quotes IN the string (probed on this tree), and `serializeYamlScalar`
  // passes a complete double-quoted scalar through verbatim — so a quoted
  // fixture would emit `"-100…"` with AND without the range, and K18 could not
  // discriminate (integration-test-revert-verify §A105).
  ...TARGET_MULTI_VALUES.map((v) => `  - ${v}`),
  "---",
  "Body",
].join("\n");
const TARGET_IRI = `obsidian://vault/${TARGET_PATH}`;

async function createdContent(
  fs: InMemoryFileSystem,
  exec: GroundingExecutor,
  grounding: GroundingDefinition,
): Promise<string> {
  const result = await exec.execute(grounding, TARGET_IRI, TARGET_PATH);
  expect(result.success).toBe(true);
  const created = fs.getAllPaths().filter((p) => p !== TARGET_PATH);
  expect(created).toHaveLength(1);
  const content = fs.getContent(created[0]);
  expect(content).toBeDefined();
  return content as string;
}

function lineOf(content: string, key: string): string | undefined {
  return content
    .split("\n")
    .find((l) => l.startsWith(`${key}:`) || l.startsWith(`${key}:\n`));
}

/**
 * The lines a top-level key OWNS: its own line plus every following INDENTED
 * one — the YAML block-sequence shape `serializeValue` emits for an array.
 * `lineOf` sees only the first of them, so a list-valued property needs this.
 */
function blockOf(content: string, key: string): string[] {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (start < 0) return [];
  let end = start + 1;
  while (end < lines.length && /^\s/.test(lines[end])) end += 1;
  return lines.slice(start, end);
}

describe("create_instance / property_set type a scalar by the declared range (ticket 534a7a46)", () => {
  let fs: InMemoryFileSystem;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await fs.createFile(TARGET_PATH, TARGET_CONTENT);
  });

  it(`K8 create_instance writes a canonical NEGATIVE integer BARE under an xsd:integer range @req:${REQ}`, async () => {
    const exec = executorWith(
      fs,
      rangesOf({ flow__Stage_chatId: ["xsd:integer"] }),
    );
    const content = await createdContent(
      fs,
      exec,
      createGrounding("flow__Stage_chatId", "-1003912427125"),
    );
    // Before this ticket the leading `-` (a YAML indicator) forced quoting, so
    // the converter tagged it xsd:string under an xsd:integer range.
    expect(lineOf(content, "flow__Stage_chatId")).toBe(
      "flow__Stage_chatId: -1003912427125",
    );
  });

  it(`K9 create_instance QUOTES a numeric string under an xsd:string range @req:${REQ}`, async () => {
    const exec = executorWith(
      fs,
      rangesOf({ flow__Stage_note: ["xsd:string"] }),
    );
    const content = await createdContent(
      fs,
      exec,
      createGrounding("flow__Stage_note", "42"),
    );
    expect(lineOf(content, "flow__Stage_note")).toBe('flow__Stage_note: "42"');
  });

  it(`K10 a property with NO declared range is emitted exactly as it is WITHOUT the port — the control @req:${REQ}`, async () => {
    const withPort = executorWith(
      fs,
      rangesOf({ flow__Stage_other: ["xsd:integer"] }),
    );
    const withPortContent = await createdContent(
      fs,
      withPort,
      createGrounding("flow__Stage_untyped", "-1003912427125"),
    );

    const fs2 = new InMemoryFileSystem();
    await fs2.createFile(TARGET_PATH, TARGET_CONTENT);
    const withoutPortContent = await createdContent(
      fs2,
      executorWith(fs2),
      createGrounding("flow__Stage_untyped", "-1003912427125"),
    );

    // The two runs differ only in the uid the executor mints, so compare the
    // line that is this axis's subject rather than the whole document.
    expect(lineOf(withPortContent, "flow__Stage_untyped")).toBe(
      lineOf(withoutPortContent, "flow__Stage_untyped"),
    );
    // And pin the pre-ticket shape literally, so the equality above cannot be
    // satisfied by BOTH sides regressing together.
    expect(lineOf(withPortContent, "flow__Stage_untyped")).toBe(
      'flow__Stage_untyped: "-1003912427125"',
    );
  });

  it(`K11 with the port ABSENT the typed property keeps its pre-ticket shape — fail-open @req:${REQ}`, async () => {
    const content = await createdContent(
      fs,
      executorWith(fs),
      createGrounding("flow__Stage_chatId", "-1003912427125"),
    );
    expect(lineOf(content, "flow__Stage_chatId")).toBe(
      'flow__Stage_chatId: "-1003912427125"',
    );
  });

  // ── ticket afb25c43: the ARRAY emission point, the twin of K8's scalar one ──
  //
  // Both emission points of `serializeValue` forward the declared range
  // (`covers[0]`: «at both emission points (:634 array items, :640 scalar)»),
  // but until this pair only the SCALAR one was exercised: the spec's
  // `MF2_array_item_site_drops_the_declared_range` carried `expect: []`, i.e. a
  // named hole. The fixture that closes it must make `properties[key]` an
  // ARRAY, and `create_instance` does that for an arbitrary property exactly
  // one way — a PropertyDefault whose resolver returns a list. `targetProperty`
  // is that resolver on live data (`v.map(String)` for a multi-valued target),
  // so K18/K19 drive it rather than hand-building the array.

  it(`K18 create_instance types the ITEMS of a multi-valued property by the declared range — the array emission point @req:${REQ}`, async () => {
    const exec = executorWith(
      fs,
      rangesOf({ [TARGET_MULTI_KEY]: ["xsd:integer"] }),
    );
    const content = await createdContent(
      fs,
      exec,
      createFromTargetListGrounding(TARGET_MULTI_KEY, TARGET_MULTI_KEY),
    );
    // Each item is a canonical negative integer: the shape rule would quote it
    // on its leading `-` (exactly as K11 shows for the scalar), the declared
    // xsd:integer range keeps it BARE.
    expect(blockOf(content, TARGET_MULTI_KEY)).toEqual([
      `${TARGET_MULTI_KEY}:`,
      "  - -1003912427125",
      "  - -1002000000001",
    ]);
  });

  it(`K19 with the port ABSENT the SAME multi-valued property keeps its pre-ticket quoted items — the discriminating control for K18 @req:${REQ}`, async () => {
    const content = await createdContent(
      fs,
      executorWith(fs),
      createFromTargetListGrounding(TARGET_MULTI_KEY, TARGET_MULTI_KEY),
    );
    expect(blockOf(content, TARGET_MULTI_KEY)).toEqual([
      `${TARGET_MULTI_KEY}:`,
      '  - "-1003912427125"',
      '  - "-1002000000001"',
    ]);
  });

  it(`K12 property_set QUOTES a numeric value under an xsd:string range (SYNTHETIC: 0 of 48 live groundings target a ranged property) @req:${REQ}`, async () => {
    const exec = executorWith(
      fs,
      rangesOf({ flow__Stage_note: ["xsd:string"] }),
    );
    const result = await exec.execute(
      propertySetGrounding("flow__Stage_note", "42"),
      TARGET_IRI,
      TARGET_PATH,
    );
    expect(result.success).toBe(true);
    // ⛔ The xsd:STRING case is the only one that DISCRIMINATES on this path, and
    // the reason is worth keeping: property_set writes an untyped value VERBATIM,
    // so a canonical integer under xsd:integer produces `-1003912427125` either
    // way — typed or not. An axis written on that value is green because
    // `substitutedValue` already happens to be bare, not because the range was
    // read (self-satisfying-metric-weak-verifier). It was written that way first
    // and the mutant caught it: ME1/ME4 (port not stored / not read) reddened
    // K8/K9 and left it green. Under xsd:string the two outcomes differ — bare
    // `42` without the range, quoted `"42"` with it — so this value is what makes
    // the property_set read load-bearing. The integer case IS pinned, on the
    // create_instance path, by K8 (there the shape rule quotes it).
    expect(lineOf(fs.getContent(TARGET_PATH) as string, "flow__Stage_note")).toBe(
      'flow__Stage_note: "42"',
    );
  });

  it(`K13 property_set leaves a deliberate FLOW ARRAY verbatim when no range types the property — the gate's axis @req:${REQ}`, async () => {
    const exec = executorWith(
      fs,
      rangesOf({ flow__Stage_chatId: ["xsd:integer"] }),
    );
    // The multi-class convert value. Routed through the scalar serializer it
    // would be quoted on its leading `[` and the convert path would break.
    const result = await exec.execute(
      propertySetGrounding("exo__Instance_class", '["[[ems__Task]]"]'),
      TARGET_IRI,
      TARGET_PATH,
    );
    expect(result.success).toBe(true);
    expect(
      lineOf(fs.getContent(TARGET_PATH) as string, "exo__Instance_class"),
    ).toBe('exo__Instance_class: ["[[ems__Task]]"]');
  });

  it(`K14 property_set leaves an already-quoted wikilink verbatim when no range types the property @req:${REQ}`, async () => {
    const exec = executorWith(
      fs,
      rangesOf({ flow__Stage_chatId: ["xsd:integer"] }),
    );
    const result = await exec.execute(
      propertySetGrounding(
        "ems__Effort_parent",
        '"[[22222222-3333-4444-5555-666666666666]]"',
      ),
      TARGET_IRI,
      TARGET_PATH,
    );
    expect(result.success).toBe(true);
    expect(
      lineOf(fs.getContent(TARGET_PATH) as string, "ems__Effort_parent"),
    ).toBe(
      'ems__Effort_parent: "[[22222222-3333-4444-5555-666666666666]]"',
    );
  });

  // ⛔ NO AXIS on a `targetProperty` arriving as a FULL symbolic IRI, and the
  // absence is deliberate — measured, not assumed. `CommandResolver` already
  // converts that field with the SAME namespace-registry inverse this change
  // uses (`getObsidianName` → `iriToObsidianName(obj.value) ?? obj.value`,
  // CommandResolver.ts:3696), so the executor never receives the IRI form from
  // the resolver. A hand-built grounding CAN carry it — probed 2026-09-20 on
  // this tree: the range IS resolved and the value lands bare, but the WRITE KEY
  // becomes the literal `https://exocortex.my/ontology/flow#Stage_chatId:`, a
  // dead key. That is a pre-existing defect of a shape production cannot produce
  // (the in-map spelling of the same class is what the :798-804 comment records
  // as already fixed), so pinning it here would specify an impossible input
  // (integration-test-revert-verify §A37) and would silently adopt someone
  // else's bug as this requirement's contract. Raised as a separate candidate.
});
