/**
 * req 656bd2d9 — `apply` pre-flights the command's declared
 * `exocmd__Grounding_inputSchema` (ticket eb9d6d2c).
 *
 * Drives the REAL `applyCommand().parseAsync([...])` against a temp vault and
 * asserts the EFFECT on disk, not just the printed line: a refused call must
 * leave the target folder empty, because the defect being fixed is precisely
 * that the call "succeeded" and left an `Untitled` asset carrying an orphan
 * property built from the caller's input.
 *
 * Axes here (the unit-level branch table lives in
 * `packages/core/tests/unit/services/GroundingExecutor.inputSchema.test.ts`):
 *   B1 — a missing required key refuses AND creates nothing
 *   B2 — an undeclared key refuses AND creates nothing (the ticket's own call)
 *   B3 — the declared key still succeeds and writes the asset
 *   B4 — `--dry-run` and the executing path return the SAME verdict
 *   B5 — a command whose grounding declares NO schema is untouched
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

const { applyCommand } = await import("../../src/commands/apply.js");

const GT_CREATE_INSTANCE = "4367e2d6-6c92-450a-becb-abce1fb07682";

const SCHEMA_CMD_UID = "bbbb0001-0000-0000-0000-000000000001";
const SCHEMA_GROUNDING_UID = "bbbb0002-0000-0000-0000-000000000002";
const PROTO_UID = "bbbb0003-0000-0000-0000-000000000003";
const NOSCHEMA_CMD_UID = "bbbb0004-0000-0000-0000-000000000004";
const NOSCHEMA_GROUNDING_UID = "bbbb0005-0000-0000-0000-000000000005";

/** `create-task`'s real contract, verbatim from the exoas-exocmd grounding. */
const TASK_SCHEMA_JSON =
  '{"type":"object","properties":{"label":{"type":"string","title":"Task name"}},"required":["label"]}';

const fm = (lines: string[]): string =>
  ["---", ...lines, "---", ""].join("\n");

const SCHEMA_CMD_MD = fm([
  `exo__Asset_uid: ${SCHEMA_CMD_UID}`,
  `exo__Asset_label: "Create task (schema-test)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${SCHEMA_GROUNDING_UID}|Create task grounding]]"`,
]);

const SCHEMA_GROUNDING_MD = fm([
  `exo__Asset_uid: ${SCHEMA_GROUNDING_UID}`,
  `exo__Asset_label: "Create task grounding"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_CREATE_INSTANCE}]]"`,
  `exocmd__Grounding_targetClass: "ems__Task"`,
  `exocmd__Grounding_targetFolder: "Inbox"`,
  `exocmd__Grounding_inputSchema: '${TASK_SCHEMA_JSON}'`,
]);

const NOSCHEMA_CMD_MD = fm([
  `exo__Asset_uid: ${NOSCHEMA_CMD_UID}`,
  `exo__Asset_label: "Create task without schema (schema-test)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${NOSCHEMA_GROUNDING_UID}|No-schema grounding]]"`,
]);

const NOSCHEMA_GROUNDING_MD = fm([
  `exo__Asset_uid: ${NOSCHEMA_GROUNDING_UID}`,
  `exo__Asset_label: "No-schema grounding"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_CREATE_INSTANCE}]]"`,
  `exocmd__Grounding_targetClass: "ems__Task"`,
  `exocmd__Grounding_targetFolder: "Inbox"`,
]);

const PROTO_MD = fm([
  `exo__Asset_uid: ${PROTO_UID}`,
  `exo__Asset_label: "Parent prototype asset"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[ems__TaskPrototype]]"`,
]);

interface VaultLayout {
  root: string;
  protoRelPath: string;
  inboxDir: string;
}

function buildVault(): VaultLayout {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-input-schema-"));
  const write = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");
  write(SCHEMA_CMD_UID, SCHEMA_CMD_MD);
  write(SCHEMA_GROUNDING_UID, SCHEMA_GROUNDING_MD);
  write(NOSCHEMA_CMD_UID, NOSCHEMA_CMD_MD);
  write(NOSCHEMA_GROUNDING_UID, NOSCHEMA_GROUNDING_MD);
  write(PROTO_UID, PROTO_MD);
  fs.mkdirSync(path.join(root, "Inbox"), { recursive: true });
  return {
    root,
    protoRelPath: `${PROTO_UID}.md`,
    inboxDir: path.join(root, "Inbox"),
  };
}

describe("req 656bd2d9 — apply enforces the declared inputSchema (ticket eb9d6d2c)", () => {
  let vault: VaultLayout;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    vault = buildVault();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    fs.rmSync(vault.root, { recursive: true, force: true });
  });

  /** @returns the process exit code the run ended with (0 when it never exited). */
  async function runApply(
    cmdUid: string,
    extraArgs: string[],
  ): Promise<number> {
    const cmd = applyCommand();
    const args = [
      "node",
      "apply",
      cmdUid,
      vault.protoRelPath,
      "--vault",
      vault.root,
      ...extraArgs,
    ];
    try {
      await cmd.parseAsync(args);
      return 0;
    } catch (err) {
      const m = /^__process_exit_(\d+)__$/.exec(String((err as Error)?.message));
      if (m) return Number(m[1]);
      throw err;
    }
  }

  const inboxFiles = (): string[] => fs.readdirSync(vault.inboxDir);
  const stderr = (): string =>
    consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  it("B1 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 refuses a call missing the declared required key AND creates nothing", async () => {
    expect(inboxFiles()).toHaveLength(0); // input built

    const code = await runApply(SCHEMA_CMD_UID, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr()).toMatch(/required input "label" was not provided/);
    // THE EFFECT: before this requirement the call created an `Untitled` asset.
    expect(inboxFiles()).toHaveLength(0);
  });

  it("B2 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 refuses the ticket's own call — an undeclared key — AND writes no orphan property", async () => {
    expect(inboxFiles()).toHaveLength(0); // input built

    const code = await runApply(SCHEMA_CMD_UID, [
      "--yes",
      "--input",
      JSON.stringify({ value: "Fix the parser" }),
    ]);

    expect(code).not.toBe(0);
    expect(stderr()).toMatch(
      /"value" is not declared by this command's input schema/,
    );
    expect(stderr()).toMatch(/accepted: "label"/);
    // THE EFFECT: before this requirement an asset appeared here carrying
    // `value: "Fix the parser"` as a frontmatter property and label "Untitled".
    expect(inboxFiles()).toHaveLength(0);
  });

  it("B3 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 still creates the asset when the declared key IS supplied", async () => {
    const code = await runApply(SCHEMA_CMD_UID, [
      "--yes",
      "--input",
      JSON.stringify({ label: "Fix the parser" }),
    ]);

    expect(code).toBe(0);
    const files = inboxFiles();
    expect(files).toHaveLength(1);
    const written = fs.readFileSync(
      path.join(vault.inboxDir, files[0]),
      "utf-8",
    );
    expect(written).toMatch(/exo__Asset_label: .*Fix the parser/);
    expect(written).not.toMatch(/^value:/m);
  });

  it("B4 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 gives the SAME verdict on --dry-run as on the executing path", async () => {
    // Issue #4298's guarantee, extended to this axis: a preview that cannot
    // fail is not a preview, and a call copied from a green dry-run must run.
    const dryCode = await runApply(SCHEMA_CMD_UID, [
      "--dry-run",
      "--input",
      JSON.stringify({ value: "Fix the parser" }),
    ]);
    const dryErr = stderr();
    consoleErrorSpy.mockClear();

    const realCode = await runApply(SCHEMA_CMD_UID, [
      "--yes",
      "--input",
      JSON.stringify({ value: "Fix the parser" }),
    ]);
    const realErr = stderr();

    expect(dryCode).not.toBe(0);
    expect(realCode).toBe(dryCode);
    expect(dryErr).toBe(realErr);
    expect(inboxFiles()).toHaveLength(0);

    // And the positive direction: a green dry-run means the real run is green.
    consoleErrorSpy.mockClear();
    const okDry = await runApply(SCHEMA_CMD_UID, [
      "--dry-run",
      "--input",
      JSON.stringify({ label: "Fix the parser" }),
    ]);
    const okReal = await runApply(SCHEMA_CMD_UID, [
      "--yes",
      "--input",
      JSON.stringify({ label: "Fix the parser" }),
    ]);
    expect(okDry).toBe(0);
    expect(okReal).toBe(0);
  });

  it("B5 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 leaves a grounding that declares NO schema exactly as it was", async () => {
    // No declared contract → nothing to enforce. This command still creates the
    // asset on a call with no --input at all, byte-identical to before.
    const code = await runApply(NOSCHEMA_CMD_UID, ["--yes"]);

    expect(code).toBe(0);
    expect(inboxFiles()).toHaveLength(1);
    expect(stderr()).not.toMatch(/input_schema:/);
  });
});
