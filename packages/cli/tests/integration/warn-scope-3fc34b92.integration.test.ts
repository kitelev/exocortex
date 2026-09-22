/**
 * Ticket 3fc34b92 — the duplicate-`exo__Property_range` report was emitted from
 * `PropertyNameValidator.collect()`, i.e. at the FIRST cache access, for EVERY
 * conflicting duplicate in the mounted TBox, whatever property the command was
 * writing. Measured on `origin/main` efc88f84 (2026-09-20) with the fixture
 * below: `set-property --property ems__Reminder_text` printed
 * `⚠ [PropertyNameValidator] property ems__Other_twin …` to stderr while the
 * write itself landed.
 *
 * The fix records the conflicts in the cached set and emits them from the
 * ACCESS points, keyed by the ADDRESSED name: `declaredRange(name)` and
 * `declaredRanges(addressed)`. `collect()` cannot filter by name itself — it is
 * cached, so its loop runs once and would report for the first caller only.
 *
 * Axes are stated the way the requirement is: BY COMMAND ("the command writes
 * X"), not by method. Revert-verify
 * (~/dotfiles/.claude/rules/integration-test-revert-verify.md): mutants live in
 * `warn-scope-3fc34b92.validator.spec.json` (+ the create call-site spec), each
 * naming the axes that MUST go red.
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
import * as url from "url";

const { setPropertyCommand } = await import(
  "../../src/commands/set-property.js"
);
const { createCommand } = await import("../../src/commands/create.js");
const { PropertyNameValidator } = await import(
  "../../src/services/PropertyNameValidator.js"
);

// requirements-trace binds ONLY on a literal `@req:<uuid>` token:
// @req:6d945bae-fc22-47a7-81e2-e2e0551e19ec
const REQ = "6d945bae-fc22-47a7-81e2-e2e0551e19ec";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const METACLASS_FIXTURES = path.resolve(
  __dirname,
  "../fixtures/shacl-integration/tbox",
);

const DATATYPE_PROPERTY_UID = "ae56ca4c-b610-42a4-a25d-058c23673296"; // exo__DatatypeProperty
const CLASS_UID = "40a0741c-0000-4000-8000-000000000001"; // ems__Reminder (fixture)
const TARGET_UID = "0d49e286-0000-4000-8000-000000000002";
const TBOX_DIR = "assetspaces/kitelev/exoas-public/ems";
const ABOX_DIR = "assetspaces/kitelev/exoas-my/my-assets";
const TARGET_REL = `${ABOX_DIR}/${TARGET_UID}.md`;
const FROZEN_CLOCK = "2026-09-20T09:00:00Z";

/** The property the command writes — declared exactly once, never in conflict. */
const ADDRESSED = "ems__Reminder_text";
/** An UNRELATED property whose twins disagree on the range. */
const OTHER = "ems__Other_twin";
/** A second addressed property, also conflict-free — for the ordering axis. */
const SECOND = "ems__Reminder_note";
/** The property `create` INJECTS by itself for a status-bearing class. */
const STATUS_PROPERTY = "ems__Effort_status";
const EFFORT_CLASS_UID = "eeee0000-0000-4000-8000-000000000003";
const TASK_CLASS_UID = "7a5c0000-0000-4000-8000-000000000004";
const BACKLOG_ENUM_UID = "bac70000-0000-4000-8000-000000000005";

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

function writeDef(
  vault: string,
  uid: string,
  label: string,
  range: string,
): void {
  fs.mkdirSync(path.join(vault, TBOX_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(vault, TBOX_DIR, `${uid}.md`),
    md({
      exo__Asset_uid: uid,
      exo__Instance_class: [`"[[${DATATYPE_PROPERTY_UID}]]"`],
      exo__Asset_label: label,
      exo__Property_domain: `"[[${CLASS_UID}]]"`,
      exo__Property_range: range,
    }),
  );
}

/**
 * UID-canon TBox: the metaclasses, the class, ONE conflict-free def for each
 * addressed property, and a pair of CONFLICTING twins for `ems__Other_twin`
 * (integer first in byte order, string second).
 */
function buildTbox(vault: string): void {
  const exoDir = path.join(vault, "assetspaces/kitelev/exoas-exo/exo");
  fs.mkdirSync(exoDir, { recursive: true });
  for (const f of fs.readdirSync(METACLASS_FIXTURES)) {
    fs.copyFileSync(path.join(METACLASS_FIXTURES, f), path.join(exoDir, f));
  }
  fs.mkdirSync(path.join(vault, TBOX_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(vault, TBOX_DIR, `${CLASS_UID}.md`),
    md({
      exo__Asset_uid: CLASS_UID,
      exo__Instance_class: ['"[[exo__Class]]"'],
      exo__Asset_label: "ems__Reminder",
      aliases: ["ems__Reminder"],
    }),
  );
  writeDef(
    vault,
    "f11bd200-0000-4000-8000-000000000012",
    ADDRESSED,
    "xsd:string",
  );
  writeDef(
    vault,
    "cccc0000-0000-4000-8000-000000000015",
    SECOND,
    "xsd:string",
  );
  // The unrelated conflict: `0000…` (integer) sorts first and wins.
  writeDef(vault, "00000000-0000-4000-8000-000000000020", OTHER, "xsd:integer");
  writeDef(vault, "zzzz0000-0000-4000-8000-000000000021", OTHER, "xsd:string");
}

/**
 * A status-bearing class (`ems__Effort` subclass) plus the Backlog enum, so
 * `create` INJECTS `ems__Effort_status` on its own — and a CONFLICTING pair of
 * defs for that injected property. Class ranges deliberately: a class range
 * types nothing (fail-open), so the conflict is registered without changing how
 * the injected wikilink is serialised.
 */
function buildStatusBearing(vault: string): void {
  const dir = path.join(vault, TBOX_DIR);
  fs.writeFileSync(
    path.join(dir, `${EFFORT_CLASS_UID}.md`),
    md({
      exo__Asset_uid: EFFORT_CLASS_UID,
      exo__Instance_class: ['"[[exo__Class]]"'],
      exo__Asset_label: "ems__Effort",
      aliases: ["ems__Effort"],
    }),
  );
  fs.writeFileSync(
    path.join(dir, `${TASK_CLASS_UID}.md`),
    md({
      exo__Asset_uid: TASK_CLASS_UID,
      exo__Instance_class: ['"[[exo__Class]]"'],
      exo__Asset_label: "ems__Task",
      aliases: ["ems__Task"],
      exo__Class_superClass: `"[[${EFFORT_CLASS_UID}]]"`,
    }),
  );
  fs.writeFileSync(
    path.join(dir, `${BACKLOG_ENUM_UID}.md`),
    md({
      exo__Asset_uid: BACKLOG_ENUM_UID,
      exo__Instance_class: ['"[[exo__Class]]"'],
      exo__Asset_label: "ems__EffortStatusBacklog",
      aliases: ["ems__EffortStatusBacklog"],
    }),
  );
  // `0000…` sorts first and wins; `zzzz…` conflicts with a different range.
  writeDef(
    vault,
    "00000000-0000-4000-8000-000000000030",
    STATUS_PROPERTY,
    `"[[${EFFORT_CLASS_UID}]]"`,
  );
  writeDef(
    vault,
    "zzzz0000-0000-4000-8000-000000000031",
    STATUS_PROPERTY,
    `"[[${TASK_CLASS_UID}]]"`,
  );
}

function writeTarget(vault: string): void {
  fs.mkdirSync(path.join(vault, ABOX_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(vault, TARGET_REL),
    md({
      exo__Asset_uid: TARGET_UID,
      exo__Instance_class: [`"[[${CLASS_UID}]]"`],
      exo__Asset_label: "Fixture reminder",
      exo__Asset_updatedAt: "2020-01-01T00:00:00",
    }),
  );
}

function lineFor(content: string, key: string): string | undefined {
  return content.split("\n").find((l) => l.startsWith(`${key}:`));
}

/** The asset `create` wrote: the only file carrying the probe label. */
function findCreated(vault: string, label: string): string {
  const stack = [vault];
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (
        entry.name.endsWith(".md") &&
        fs.readFileSync(full, "utf-8").includes(`exo__Asset_label: ${label}`)
      ) {
        return full;
      }
    }
  }
  throw new Error(`no asset created for label ${label}`);
}

describe(`ticket 3fc34b92: the duplicate-range report names ONLY an addressed property @req:${REQ}`, () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3fc34b92-"));
    buildTbox(vault);
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
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

  /** Every `⚠ [PropertyNameValidator] …` line the command wrote to stderr. */
  function warnLines(): string[] {
    return stderrSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((l: string) => l.startsWith("⚠ [PropertyNameValidator] property"));
  }

  async function setProp(extraArgs: string[]): Promise<string> {
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [TARGET_REL, "--vault", vault, "--frozen-clock", FROZEN_CLOCK, ...extraArgs],
      { from: "user" },
    );
    return fs.readFileSync(path.join(vault, TARGET_REL), "utf-8");
  }

  async function create(
    label: string,
    properties: string[],
    opts: { classUid?: string; extra?: string[] } = {},
  ): Promise<string> {
    const cmd = createCommand();
    const args = [
      "--vault",
      vault,
      "--class",
      opts.classUid ?? CLASS_UID,
      "--label",
      label,
    ];
    for (const p of properties) args.push("--property", p);
    for (const e of opts.extra ?? []) args.push(e);
    await cmd.parseAsync(args, { from: "user" });
    return fs.readFileSync(findCreated(vault, label), "utf-8");
  }

  it(`N1 addressing a conflict-FREE property is silent about an unrelated conflicting twin, and still resolves that property's range @req:${REQ}`, async () => {
    const warnings: string[] = [];
    const v = new PropertyNameValidator(vault, {
      warn: (m: string) => warnings.push(m),
    });
    expect(await v.declaredRange(ADDRESSED)).toEqual(["xsd:string"]);
    expect(warnings).toEqual([]);
  });

  it(`N2 addressing the CONFLICTING property reports it exactly once — and a second addressing of the same name adds no line @req:${REQ}`, async () => {
    const warnings: string[] = [];
    const v = new PropertyNameValidator(vault, {
      warn: (m: string) => warnings.push(m),
    });
    // First in byte-ordered path walk (`0000…`, xsd:integer) wins the range.
    expect(await v.declaredRange(OTHER)).toEqual(["xsd:integer"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(OTHER);
    expect(warnings[0]).toContain("xsd:integer");
    expect(warnings[0]).toContain("xsd:string");
    // The cache is warm now; the per-instance latch must still hold.
    expect(await v.declaredRange(OTHER)).toEqual(["xsd:integer"]);
    expect(warnings).toHaveLength(1);
  });

  it(`N3 the key check alone addresses no range and therefore reports nothing, even though the walk sees the conflict @req:${REQ}`, async () => {
    const warnings: string[] = [];
    const v = new PropertyNameValidator(vault, {
      warn: (m: string) => warnings.push(m),
    });
    await expect(v.validate([ADDRESSED])).resolves.toBeUndefined();
    expect(warnings).toEqual([]);
    // The conflict IS in the collected set — it is simply not addressed yet.
    expect(await v.declaredRange(OTHER)).toEqual(["xsd:integer"]);
    expect(warnings).toHaveLength(1);
  });

  it(`N4 set-property writing a conflict-free property writes NO warning line about the unrelated twin, and the write lands @req:${REQ}`, async () => {
    writeTarget(vault);
    const content = await setProp([
      "--property",
      ADDRESSED,
      "--value",
      "hello",
    ]);
    expect(lineFor(content, ADDRESSED)).toBe(`${ADDRESSED}: hello`);
    expect(warnLines()).toEqual([]);
  });

  it(`N5 set-property writing the CONFLICTING property itself still writes exactly one warning line naming it @req:${REQ}`, async () => {
    writeTarget(vault);
    const content = await setProp(["--property", OTHER, "--value", "42"]);
    // Typed by the FIRST def in path order (xsd:integer) → bare.
    expect(lineFor(content, OTHER)).toBe(`${OTHER}: 42`);
    const lines = warnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(OTHER);
  });

  it(`N6 create writing TWO properties, only the SECOND of which conflicts: exactly one line, and it names the SECOND @req:${REQ}`, async () => {
    const content = await create("N6 order", [
      `${ADDRESSED}=hello`,
      `${OTHER}=42`,
    ]);
    expect(lineFor(content, ADDRESSED)).toBe(`${ADDRESSED}: hello`);
    expect(lineFor(content, OTHER)).toBe(`${OTHER}: 42`);
    const lines = warnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(OTHER);
    expect(lines[0]).not.toContain(ADDRESSED);
  });

  it(`N7 create writing only conflict-free properties writes no warning line at all @req:${REQ}`, async () => {
    const content = await create("N7 quiet", [
      `${ADDRESSED}=hello`,
      `${SECOND}=world`,
    ]);
    expect(lineFor(content, ADDRESSED)).toBe(`${ADDRESSED}: hello`);
    expect(warnLines()).toEqual([]);
  });

  it(`N8 a bulk declaredRanges() hand-off that names no addressed property is silent, and the map it returns is complete @req:${REQ}`, async () => {
    const warnings: string[] = [];
    const v = new PropertyNameValidator(vault, {
      warn: (m: string) => warnings.push(m),
    });
    const ranges = await v.declaredRanges();
    expect(warnings).toEqual([]);
    expect(ranges.get(ADDRESSED)).toEqual(["xsd:string"]);
    expect(ranges.get(OTHER)).toEqual(["xsd:integer"]);
    // Naming the conflicting property DOES report it — same instance, same cache.
    await v.declaredRanges([OTHER]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(OTHER);
  });

  it(`N10 a property the command INJECTS itself (the default Backlog status) counts as written: its conflict is reported, exactly once @req:${REQ}`, async () => {
    buildStatusBearing(vault);
    const content = await create("N10 injected", [], {
      classUid: TASK_CLASS_UID,
    });
    // The status really was injected — otherwise the axis would be vacuous.
    expect(lineFor(content, STATUS_PROPERTY)).toBe(
      `${STATUS_PROPERTY}: "[[${BACKLOG_ENUM_UID}]]"`,
    );
    const lines = warnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(STATUS_PROPERTY);
  });

  it(`N11 --no-status injects nothing, so the same conflicting def is NOT reported @req:${REQ}`, async () => {
    buildStatusBearing(vault);
    const content = await create("N11 no status", [], {
      classUid: TASK_CLASS_UID,
      extra: ["--no-status"],
    });
    expect(lineFor(content, STATUS_PROPERTY)).toBeUndefined();
    expect(warnLines()).toEqual([]);
  });

  it(`N9 with NO warn channel injected nothing is printed and nothing is thrown, even when the conflicting property is addressed @req:${REQ}`, async () => {
    const silent = new PropertyNameValidator(vault);
    expect(await silent.declaredRange(OTHER)).toEqual(["xsd:integer"]);
    expect(await silent.declaredRanges([OTHER])).toBeInstanceOf(Map);
    expect(warnLines()).toEqual([]);
  });
});
