/**
 * Ticket 2227d660 — `set-property` typed a YAML scalar by its SHAPE
 * (`needsYamlQuoting`: a leading `-` ⇒ quoted), not by the property's DECLARED
 * `exo__Property_range`. Under `xsd:integer` (ems__Reminder_chatId since ticket
 * d72aba19 G2) a group chat id `-1001234567890` landed as `"-1001234567890"` —
 * an `xsd:string` literal, `sh:datatype` violation under founder rule 6c — while
 * a numeric string under `xsd:string` landed bare (`xsd:integer`, the mirror
 * violation). Measured 2026-09-19 on a copy of vault-my with CLI 16.241.5:
 * conforms → 3 datatype violations after three writes.
 *
 * The fix reads the range from the SAME one-pass TBox scan `PropertyNameValidator`
 * already runs for the key check and passes it to `serializeYamlScalar`.
 *
 * Drives the REAL `setPropertyCommand()` against a temp fixture vault that
 * mounts genuine UID-canon property defs (metaclass `exo__DatatypeProperty`,
 * `exo__Property_range` as the TBox writes it) and asserts the PARSED type via
 * js-yaml YAML11_SCHEMA — the production reader.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * with `declaredRange` no longer passed to `serializeForWrite` (pre-ticket
 * state) S1 / S2 go RED; S3 (no TBox mounted → shape rule) and S4 (`--input`
 * JSON number) stay GREEN in both states — the controls that prove the change
 * is scoped to a mounted declaration and did not switch the shape rule off.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";

const { setPropertyCommand } =
  await import("../../src/commands/set-property.js");
const { PropertyNameValidator } =
  await import("../../src/services/PropertyNameValidator.js");

// requirements-trace binds ONLY on a literal `@req:<uuid>` token:
// @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105
const REQ = "21ceea14-50dd-4cf8-bd3b-5a50b7c97105";

const DATATYPE_PROPERTY_UID = "ae56ca4c-b610-42a4-a25d-058c23673296"; // exo__DatatypeProperty
const CLASS_UID = "40a0741c-0000-4000-8000-000000000001"; // ems__Reminder (fixture)
const TARGET_UID = "0d49e286-0000-4000-8000-000000000002";
const TBOX_DIR = "assetspaces/kitelev/exoas-public/ems";
const ABOX_DIR = "assetspaces/kitelev/exoas-my/my-assets";
const TARGET_REL = `${ABOX_DIR}/${TARGET_UID}.md`;
const FROZEN_CLOCK = "2026-09-19T21:00:00Z";
const NEG_CHAT_ID = "-1001234567890";

function md(frontmatter: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "body", "");
  return lines.join("\n");
}

/** A UID-canon datatype-property def, exactly as `exoas-public/ems` writes it. */
function writeDef(
  vault: string,
  uid: string,
  label: string,
  range: string,
): void {
  const dir = path.join(vault, TBOX_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${uid}.md`),
    md({
      exo__Asset_uid: uid,
      exo__Instance_class: [`"[[${DATATYPE_PROPERTY_UID}]]"`],
      exo__Asset_label: label,
      exo__Property_domain: `"[[${CLASS_UID}]]"`,
      exo__Property_range: range,
    }),
  );
}

function buildTbox(vault: string): void {
  writeDef(
    vault,
    "39197b8c-0000-4000-8000-000000000011",
    "ems__Reminder_chatId",
    "xsd:integer",
  );
  writeDef(
    vault,
    "f11bd200-0000-4000-8000-000000000012",
    "ems__Reminder_text",
    "xsd:string",
  );
  writeDef(
    vault,
    "aaaa0000-0000-4000-8000-000000000013",
    "ems__Reminder_score",
    "xsd:decimal",
  );
  writeDef(
    vault,
    "bbbb0000-0000-4000-8000-000000000014",
    "ems__Reminder_done",
    "xsd:boolean",
  );
  // A def WITHOUT a range: the name is known, the range is not → shape rule.
  writeDef(
    vault,
    "cccc0000-0000-4000-8000-000000000015",
    "ems__Reminder_note",
    "",
  );
}

function writeTarget(vault: string): void {
  const dir = path.join(vault, ABOX_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(vault, TARGET_REL),
    md({
      exo__Asset_uid: TARGET_UID,
      exo__Instance_class: [`"[[${CLASS_UID}]]"`],
      exo__Asset_label: "Fixture reminder",
      exo__Asset_updatedAt: "2020-01-01T00:00:00",
      ems__Reminder_chatId: "987654321",
    }),
  );
}

/** Parse the written file the way the production reader does (YAML11_SCHEMA). */
function parseFrontmatter(content: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) throw new Error("no frontmatter in written file");
  return (yaml.load(m[1], { schema: yaml.YAML11_SCHEMA }) ?? {}) as Record<
    string,
    unknown
  >;
}

function lineFor(content: string, key: string): string | undefined {
  return content.split("\n").find((l) => l.startsWith(`${key}:`));
}

describe(`ticket 2227d660: set-property types a scalar by the declared exo__Property_range @req:${REQ}`, () => {
  let vault: string;
  /** The second temp vault Q2 creates (empty TBox) — removed in afterEach. */
  let emptyVault: string | undefined;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-2227d660-set-"));
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as never);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as never);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
    if (emptyVault !== undefined) {
      fs.rmSync(emptyVault, { recursive: true, force: true });
      emptyVault = undefined;
    }
  });

  async function setProp(extraArgs: string[]): Promise<{
    exit: number[];
    content: string;
    parsed: Record<string, unknown>;
  }> {
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [
        TARGET_REL,
        "--vault",
        vault,
        "--frozen-clock",
        FROZEN_CLOCK,
        ...extraArgs,
      ],
      { from: "user" },
    );
    const content = fs.readFileSync(path.join(vault, TARGET_REL), "utf-8");
    return { exit: [...exitCodes], content, parsed: parseFrontmatter(content) };
  }

  it(`S1 a canonical NEGATIVE --value under a mounted xsd:integer def is written BARE and reads back as that number @req:${REQ}`, async () => {
    buildTbox(vault);
    writeTarget(vault);
    // `--value=-…`: the `=` form keeps commander from reading the sign as a flag.
    const out = await setProp([
      "--property",
      "ems__Reminder_chatId",
      `--value=${NEG_CHAT_ID}`,
    ]);
    expect(out.exit).not.toContain(1);
    expect(lineFor(out.content, "ems__Reminder_chatId")).toBe(
      `ems__Reminder_chatId: ${NEG_CHAT_ID}`,
    );
    expect(out.parsed.ems__Reminder_chatId).toBe(-1001234567890);
  });

  it(`S2 a numeric --value under a mounted xsd:string def is QUOTED and reads back as a string @req:${REQ}`, async () => {
    buildTbox(vault);
    writeTarget(vault);
    const out = await setProp([
      "--property",
      "ems__Reminder_text",
      "--value",
      "42",
    ]);
    expect(out.exit).not.toContain(1);
    expect(lineFor(out.content, "ems__Reminder_text")).toBe(
      'ems__Reminder_text: "42"',
    );
    expect(out.parsed.ems__Reminder_text).toBe("42");
  });

  it(`S2b decimal and boolean defs: a canonical negative fraction is bare under xsd:decimal, true is bare under xsd:boolean; a def without a range keeps the shape rule @req:${REQ}`, async () => {
    buildTbox(vault);
    writeTarget(vault);
    const score = await setProp([
      "--property",
      "ems__Reminder_score",
      "--value=-1.5",
    ]);
    expect(lineFor(score.content, "ems__Reminder_score")).toBe(
      "ems__Reminder_score: -1.5",
    );
    expect(score.parsed.ems__Reminder_score).toBe(-1.5);
    const done = await setProp([
      "--property",
      "ems__Reminder_done",
      "--value",
      "true",
    ]);
    expect(lineFor(done.content, "ems__Reminder_done")).toBe(
      "ems__Reminder_done: true",
    );
    expect(done.parsed.ems__Reminder_done).toBe(true);
    const note = await setProp([
      "--property",
      "ems__Reminder_note",
      "--value=-7",
    ]);
    expect(lineFor(note.content, "ems__Reminder_note")).toBe(
      'ems__Reminder_note: "-7"',
    );
    expect(note.parsed.ems__Reminder_note).toBe("-7");
  });

  it(`S3 control — NO property TBox mounted: the pre-ticket shape rule is byte-identical (negative quoted, number bare) @req:${REQ}`, async () => {
    writeTarget(vault);
    const neg = await setProp([
      "--property",
      "ems__Reminder_chatId",
      `--value=${NEG_CHAT_ID}`,
    ]);
    expect(neg.exit).not.toContain(1);
    expect(lineFor(neg.content, "ems__Reminder_chatId")).toBe(
      `ems__Reminder_chatId: "${NEG_CHAT_ID}"`,
    );
    expect(neg.parsed.ems__Reminder_chatId).toBe(NEG_CHAT_ID);
    const num = await setProp([
      "--property",
      "ems__Reminder_text",
      "--value",
      "42",
    ]);
    expect(lineFor(num.content, "ems__Reminder_text")).toBe(
      "ems__Reminder_text: 42",
    );
    expect(num.parsed.ems__Reminder_text).toBe(42);
  });

  it(`S4 control — an --input JSON number under xsd:string stays bare (non-string values are never typed by the range) @req:${REQ}`, async () => {
    buildTbox(vault);
    writeTarget(vault);
    const out = await setProp([
      "--input",
      JSON.stringify({ property: "ems__Reminder_text", value: 42 }),
    ]);
    expect(out.exit).not.toContain(1);
    expect(lineFor(out.content, "ems__Reminder_text")).toBe(
      "ems__Reminder_text: 42",
    );
  });

  it(`S5 an --input JSON ARRAY of numeric strings under xsd:integer: every item is typed by the range (bare) @req:${REQ}`, async () => {
    buildTbox(vault);
    writeTarget(vault);
    const out = await setProp([
      "--input",
      JSON.stringify({ property: "ems__Reminder_chatId", value: ["-1", "-2"] }),
    ]);
    expect(out.exit).not.toContain(1);
    expect(out.content).toContain("ems__Reminder_chatId:\n  - -1\n  - -2\n");
    expect(out.parsed.ems__Reminder_chatId).toEqual([-1, -2]);
  });

  // ── the collector itself (the range rides along on the name-check scan) ──

  it(`Q1 PropertyNameValidator.declaredRange returns the mounted def's exo__Property_range as written, quotes stripped @req:${REQ}`, async () => {
    buildTbox(vault);
    fs.writeFileSync(
      path.join(vault, TBOX_DIR, "dddd0000-0000-4000-8000-000000000016.md"),
      md({
        exo__Asset_uid: "dddd0000-0000-4000-8000-000000000016",
        exo__Instance_class: [`"[[${DATATYPE_PROPERTY_UID}]]"`],
        exo__Asset_label: "ems__Reminder_url",
        exo__Property_domain: `"[[${CLASS_UID}]]"`,
        exo__Property_range: '"http://www.w3.org/2001/XMLSchema#anyURI"',
      }),
    );
    const v = new PropertyNameValidator(vault);
    expect(await v.declaredRange("ems__Reminder_chatId")).toEqual([
      "xsd:integer",
    ]);
    expect(await v.declaredRange("ems__Reminder_text")).toEqual(["xsd:string"]);
    expect(await v.declaredRange("ems__Reminder_url")).toEqual([
      "http://www.w3.org/2001/XMLSchema#anyURI",
    ]);
    expect((await v.declaredRanges()).get("ems__Reminder_score")).toEqual([
      "xsd:decimal",
    ]);
  });

  it(`Q2 a def without a range, an unknown name and an empty vault give undefined (fail-open) @req:${REQ}`, async () => {
    buildTbox(vault);
    const v = new PropertyNameValidator(vault);
    expect(await v.declaredRange("ems__Reminder_note")).toBeUndefined();
    expect(await v.declaredRange("ems__Reminder_nope")).toBeUndefined();
    emptyVault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-2227d660-empty-"));
    const empty = new PropertyNameValidator(emptyVault);
    expect(await empty.declaredRange("ems__Reminder_chatId")).toBeUndefined();
    expect((await empty.declaredRanges()).size).toBe(0);
  });

  it(`Q3 a prefix__Name-labelled asset OUTSIDE the property-metaclass closure does not contribute a range (an instance is not a def) @req:${REQ}`, async () => {
    buildTbox(vault);
    // Same label shape, same range key — but typed as an ordinary class instance.
    fs.writeFileSync(
      path.join(vault, TBOX_DIR, "eeee0000-0000-4000-8000-000000000017.md"),
      md({
        exo__Asset_uid: "eeee0000-0000-4000-8000-000000000017",
        exo__Instance_class: [`"[[${CLASS_UID}]]"`],
        exo__Asset_label: "ems__Reminder_bogus",
        exo__Property_range: "xsd:integer",
      }),
    );
    const v = new PropertyNameValidator(vault);
    expect(await v.declaredRange("ems__Reminder_bogus")).toBeUndefined();
    // …and the closure-approved def next to it is still collected.
    expect(await v.declaredRange("ems__Reminder_chatId")).toEqual([
      "xsd:integer",
    ]);
  });
});

/**
 * Ticket 8185c9dd (review #4282 MEDIUM-1 / NIT-2) on the set-property path.
 * S6: the writer's string oracle is the YAML11 reader — a YAML 1.1-only form
 * (`no`, `10:30`) under a mounted `xsd:string` def is QUOTED end to end.
 * Q4/Q5: two defs sharing a label resolve DETERMINISTICALLY (first in
 * byte-ordered path walk) and a twin with a DIFFERENT range is reported once
 * through the injected warn channel; an identical twin is silent.
 * Revert-verify: reader-oracle reverted → S6 RED; walk unsorted / last-wins →
 * Q4 RED (the fixture writes the twins in REVERSE lexical order so a
 * last-seen rule on a sorted walk and an unsorted APFS order both flip it);
 * warn dropped → Q4 RED (warn count).
 */
describe(`ticket 8185c9dd: set-property — reader oracle and deterministic duplicate defs @req:${REQ}`, () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-8185c9dd-set-"));
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined as never) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as never);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as never);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  async function setProp(extraArgs: string[]): Promise<string> {
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [
        TARGET_REL,
        "--vault",
        vault,
        "--frozen-clock",
        FROZEN_CLOCK,
        ...extraArgs,
      ],
      { from: "user" },
    );
    return fs.readFileSync(path.join(vault, TARGET_REL), "utf-8");
  }

  it(`S6 a YAML 1.1-only form (\`no\`, \`10:30\`, \`True\`) under the mounted xsd:string def is QUOTED and reads back as that string; the canonical \`true\` stays bare @req:${REQ}`, async () => {
    buildTbox(vault);
    writeTarget(vault);
    for (const v of ["no", "10:30", "True"]) {
      const content = await setProp([
        "--property",
        "ems__Reminder_text",
        "--value",
        v,
      ]);
      expect(lineFor(content, "ems__Reminder_text")).toBe(
        `ems__Reminder_text: "${v}"`,
      );
      expect(parseFrontmatter(content).ems__Reminder_text).toBe(v);
    }
    const content = await setProp([
      "--property",
      "ems__Reminder_text",
      "--value",
      "true",
    ]);
    expect(lineFor(content, "ems__Reminder_text")).toBe(
      "ems__Reminder_text: true",
    );
  });

  it(`Q4 three defs with one label and DIFFERENT ranges: the first in byte-ordered path walk wins (not the last readdir entry) and the twins are reported ONCE per name on the warn channel @req:${REQ}`, async () => {
    buildTbox(vault);
    // Written in REVERSE lexical order: `zzzz…` (xsd:string) before `0000…`
    // (xsd:integer). Sorted walk → `0000…` first → integer wins.
    writeDef(
      vault,
      "zzzz0000-0000-4000-8000-000000000021",
      "ems__Reminder_twin",
      "xsd:string",
    );
    writeDef(
      vault,
      "00000000-0000-4000-8000-000000000020",
      "ems__Reminder_twin",
      "xsd:integer",
    );
    // A THIRD twin (xsd:decimal): the report is once per NAME, not per twin.
    writeDef(
      vault,
      "yyyy0000-0000-4000-8000-000000000024",
      "ems__Reminder_twin",
      "xsd:decimal",
    );
    const warnings: string[] = [];
    const v = new PropertyNameValidator(vault, {
      warn: (m: string) => warnings.push(m),
    });
    expect(await v.declaredRange("ems__Reminder_twin")).toEqual([
      "xsd:integer",
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ems__Reminder_twin");
    // Names the winner and the first conflicting twin in path order (`yyyy…`
    // decimal sorts before `zzzz…` string); the third twin adds no line.
    expect(warnings[0]).toContain("xsd:integer");
    expect(warnings[0]).toContain("xsd:decimal");
    // The name itself is still known (both twins are defs).
    await expect(v.validate(["ems__Reminder_twin"])).resolves.toBeUndefined();
  });

  it(`Q5 two defs with one label and the SAME range are silent (no warning) and resolve that range; the default channel is a no-op @req:${REQ}`, async () => {
    buildTbox(vault);
    writeDef(
      vault,
      "zzzz0000-0000-4000-8000-000000000023",
      "ems__Reminder_same",
      "xsd:decimal",
    );
    writeDef(
      vault,
      "00000000-0000-4000-8000-000000000022",
      "ems__Reminder_same",
      "xsd:decimal",
    );
    const warnings: string[] = [];
    const v = new PropertyNameValidator(vault, {
      warn: (m: string) => warnings.push(m),
    });
    expect(await v.declaredRange("ems__Reminder_same")).toEqual([
      "xsd:decimal",
    ]);
    expect(warnings).toHaveLength(0);
    // No channel injected → nothing thrown, nothing printed.
    const silent = new PropertyNameValidator(vault);
    expect(await silent.declaredRange("ems__Reminder_same")).toEqual([
      "xsd:decimal",
    ]);
  });

  it(`S7 the set-property command wires the warn channel to stderr: a twin def with a different range is reported as a \`⚠ [PropertyNameValidator] …\` line and the write still succeeds by the first def @req:${REQ}`, async () => {
    buildTbox(vault);
    writeTarget(vault);
    writeDef(
      vault,
      "zzzz0000-0000-4000-8000-000000000025",
      "ems__Reminder_text",
      "xsd:integer",
    );
    const content = await setProp([
      "--property",
      "ems__Reminder_text",
      "--value",
      "42",
    ]);
    // First def in path order is `f11bd200…` (xsd:string) → quoted.
    expect(lineFor(content, "ems__Reminder_text")).toBe(
      'ems__Reminder_text: "42"',
    );
    const stderrLines: string[] = stderrSpy.mock.calls.map((c: unknown[]) =>
      String(c[0]),
    );
    expect(
      stderrLines.filter((l: string) =>
        l.startsWith("⚠ [PropertyNameValidator] property ems__Reminder_text"),
      ),
    ).toHaveLength(1);
  });
});
