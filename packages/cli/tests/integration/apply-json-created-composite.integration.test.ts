/**
 * Issue #3918 — integration test for `apply <cmd> <target> --json` surfacing
 * assets created as a SIDE EFFECT by a `composite` grounding.
 *
 * Follow-up to #3906 (req 55a79515), which scoped `apply --json` `created[]` to
 * DIRECT `create_instance` groundings (ExecutionResult.openPath). Today
 * `executeComposite` drops the created path (returns `{ success: true }`), so a
 * composite command yields an empty `created` array under `apply --json`. This
 * test drives the REAL `applyCommand().parseAsync([...--json...])` over a temp
 * vault holding a real `composite` command (a create_instance step + a
 * property_set step on the source) and asserts the composite-created file is
 * surfaced in `created[]` (production-shape — not hand-injected), that a
 * property_set-only composite yields an empty `created`, and that a DIRECT
 * create_instance command (#3906) is unchanged.
 *
 * Revert-verify axis (@req:8eaae6a9-3a11-42cd-a549-c988dae2073b): the composite
 * `created[0]` assertion goes RED when the production `createdPaths` surfacing in
 * `GroundingExecutor.executeComposite` is neutralized (the envelope's `created`
 * stays empty for a composite) and GREEN when restored — empirically checked
 * before merge (see PR body).
 *
 * Uses programmatic `parseAsync` (no built-binary dependency), mirroring
 * `apply-json-created.integration.test.ts`.
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
const GT_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";
const GT_COMPOSITE = "8f9a57db-3865-4886-92fb-c5ab7f3c3fa3";

// --- composite (create-as-side-effect) command ---
const COMP_CMD_UID = "bbbb0001-0000-0000-0000-000000000001";
const COMP_GROUNDING_UID = "bbbb0002-0000-0000-0000-000000000002";
const STEP_CREATE_UID = "bbbb0003-0000-0000-0000-000000000003";
const STEP_PSET_SOURCE_UID = "bbbb0004-0000-0000-0000-000000000004";
const PROTO_UID = "bbbb0005-0000-0000-0000-000000000005";
// --- composite that creates NOTHING (property_set-only) ---
const PSET_COMP_CMD_UID = "bbbb0006-0000-0000-0000-000000000006";
const PSET_COMP_GROUNDING_UID = "bbbb0007-0000-0000-0000-000000000007";
const STEP_PSET_ONLY_UID = "bbbb0008-0000-0000-0000-000000000008";
// --- DIRECT create_instance command (#3906 preservation) reusing STEP_CREATE ---
const DIRECT_CMD_UID = "bbbb0009-0000-0000-0000-000000000009";
// --- composite that creates TWO assets (>1 create_instance step) ---
const MULTI_COMP_CMD_UID = "bbbb000a-0000-0000-0000-00000000000a";
const MULTI_COMP_GROUNDING_UID = "bbbb000b-0000-0000-0000-00000000000b";
const STEP_CREATE2_UID = "bbbb000c-0000-0000-0000-00000000000c";

const INPUT_LABEL = "Composite child task";

const COMP_CMD_MD = [
  "---",
  `exo__Asset_uid: ${COMP_CMD_UID}`,
  `exo__Asset_label: "Create child + flag source (composite json-test)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${COMP_GROUNDING_UID}|Composite grounding]]"`,
  `exocmd__Command_successMessage: "Composite ran"`,
  "---",
  "",
].join("\n");

// A composite whose steps create a task AND set a flag on the source (the
// click-target) — the canonical "create-as-side-effect" shape.
const COMP_GROUNDING_MD = [
  "---",
  `exo__Asset_uid: ${COMP_GROUNDING_UID}`,
  `exo__Asset_label: "Composite grounding"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_COMPOSITE}]]"`,
  `exocmd__Grounding_steps:`,
  `  - "[[${STEP_CREATE_UID}|Create step]]"`,
  `  - "[[${STEP_PSET_SOURCE_UID}|Flag source step]]"`,
  "---",
  "",
].join("\n");

const STEP_CREATE_MD = [
  "---",
  `exo__Asset_uid: ${STEP_CREATE_UID}`,
  `exo__Asset_label: "Create child task step"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_CREATE_INSTANCE}]]"`,
  `exocmd__Grounding_targetClass: "ems__Task"`,
  `exocmd__Grounding_targetFolder: "Inbox"`,
  "---",
  "",
].join("\n");

const STEP_PSET_SOURCE_MD = [
  "---",
  `exo__Asset_uid: ${STEP_PSET_SOURCE_UID}`,
  `exo__Asset_label: "Flag source step"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
  `exocmd__Grounding_targetProperty: "test__CompositeRan"`,
  `exocmd__Grounding_targetValueLiteral: "yes"`,
  "---",
  "",
].join("\n");

const PROTO_MD = [
  "---",
  `exo__Asset_uid: ${PROTO_UID}`,
  `exo__Asset_label: "Parent prototype asset"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[ems__TaskPrototype]]"`,
  "---",
  "",
].join("\n");

// A composite that runs a property_set-only step → creates NO asset → `created`
// must be empty (proves the empty array is "created nothing", not "no
// createdPaths surfacing at all").
const PSET_COMP_CMD_MD = [
  "---",
  `exo__Asset_uid: ${PSET_COMP_CMD_UID}`,
  `exo__Asset_label: "Set a flag composite (json-test)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${PSET_COMP_GROUNDING_UID}|Pset composite grounding]]"`,
  `exocmd__Command_successMessage: "Flag set"`,
  "---",
  "",
].join("\n");

const PSET_COMP_GROUNDING_MD = [
  "---",
  `exo__Asset_uid: ${PSET_COMP_GROUNDING_UID}`,
  `exo__Asset_label: "Pset composite grounding"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_COMPOSITE}]]"`,
  `exocmd__Grounding_steps:`,
  `  - "[[${STEP_PSET_ONLY_UID}|Set flag step]]"`,
  "---",
  "",
].join("\n");

const STEP_PSET_ONLY_MD = [
  "---",
  `exo__Asset_uid: ${STEP_PSET_ONLY_UID}`,
  `exo__Asset_label: "Set flag step"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
  `exocmd__Grounding_targetProperty: "test__Flag"`,
  `exocmd__Grounding_targetValueLiteral: "done"`,
  "---",
  "",
].join("\n");

// A DIRECT create_instance command reusing the SAME create step grounding — its
// `openPath` surfacing (#3906) must be unchanged by the composite change.
const DIRECT_CMD_MD = [
  "---",
  `exo__Asset_uid: ${DIRECT_CMD_UID}`,
  `exo__Asset_label: "Create child task direct (json-test)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${STEP_CREATE_UID}|Create child task step]]"`,
  `exocmd__Command_successMessage: "Direct child created"`,
  "---",
  "",
].join("\n");

// A second create_instance step (distinct grounding) — targets a separate
// folder so a 2-create composite writes two distinct files.
const STEP_CREATE2_MD = [
  "---",
  `exo__Asset_uid: ${STEP_CREATE2_UID}`,
  `exo__Asset_label: "Create second child task step"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_CREATE_INSTANCE}]]"`,
  `exocmd__Grounding_targetClass: "ems__Task"`,
  `exocmd__Grounding_targetFolder: "Inbox2"`,
  "---",
  "",
].join("\n");

const MULTI_COMP_CMD_MD = [
  "---",
  `exo__Asset_uid: ${MULTI_COMP_CMD_UID}`,
  `exo__Asset_label: "Create two children (multi-create composite json-test)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${MULTI_COMP_GROUNDING_UID}|Multi-create composite grounding]]"`,
  `exocmd__Command_successMessage: "Two children created"`,
  "---",
  "",
].join("\n");

// A composite with TWO create_instance steps → the `createdPaths` array must
// collect BOTH → apply --json emits two `created` entries (#3918 multi-create).
const MULTI_COMP_GROUNDING_MD = [
  "---",
  `exo__Asset_uid: ${MULTI_COMP_GROUNDING_UID}`,
  `exo__Asset_label: "Multi-create composite grounding"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_COMPOSITE}]]"`,
  `exocmd__Grounding_steps:`,
  `  - "[[${STEP_CREATE_UID}|Create step 1]]"`,
  `  - "[[${STEP_CREATE2_UID}|Create step 2]]"`,
  "---",
  "",
].join("\n");

interface VaultLayout {
  root: string;
  protoRelPath: string;
  inboxDir: string;
}

function buildVault(): VaultLayout {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-apply-json-comp-"));
  const write = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");
  write(COMP_CMD_UID, COMP_CMD_MD);
  write(COMP_GROUNDING_UID, COMP_GROUNDING_MD);
  write(STEP_CREATE_UID, STEP_CREATE_MD);
  write(STEP_PSET_SOURCE_UID, STEP_PSET_SOURCE_MD);
  write(PROTO_UID, PROTO_MD);
  write(PSET_COMP_CMD_UID, PSET_COMP_CMD_MD);
  write(PSET_COMP_GROUNDING_UID, PSET_COMP_GROUNDING_MD);
  write(STEP_PSET_ONLY_UID, STEP_PSET_ONLY_MD);
  write(DIRECT_CMD_UID, DIRECT_CMD_MD);
  write(MULTI_COMP_CMD_UID, MULTI_COMP_CMD_MD);
  write(MULTI_COMP_GROUNDING_UID, MULTI_COMP_GROUNDING_MD);
  write(STEP_CREATE2_UID, STEP_CREATE2_MD);
  fs.mkdirSync(path.join(root, "Inbox"), { recursive: true });
  fs.mkdirSync(path.join(root, "Inbox2"), { recursive: true });
  return {
    root,
    protoRelPath: `${PROTO_UID}.md`,
    inboxDir: path.join(root, "Inbox"),
  };
}

describe("Issue #3918: apply --json surfaces composite create-as-side-effect assets", () => {
  let vault: VaultLayout;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stdoutChunks: string[];

  beforeEach(() => {
    vault = buildVault();
    stdoutChunks = [];
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    // Capture the JSON envelope (written via process.stdout.write). console.log
    // is mocked to a no-op above, so it never reaches process.stdout.write —
    // this spy therefore captures ONLY the apply envelope.
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array) => {
        stdoutChunks.push(chunk.toString());
        return true;
      }) as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    fs.rmSync(vault.root, { recursive: true, force: true });
  });

  async function runApply(cmdUid: string, extraArgs: string[]): Promise<void> {
    const cmd = applyCommand();
    const args = [
      "node",
      "apply",
      cmdUid,
      vault.protoRelPath,
      "--vault",
      vault.root,
      "--input",
      JSON.stringify({ label: INPUT_LABEL }),
      ...extraArgs,
    ];
    try {
      await cmd.parseAsync(args);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  it("@req:8eaae6a9-3a11-42cd-a549-c988dae2073b --json surfaces the composite-created asset in created:[{uuid,path,label}]", async () => {
    await runApply(COMP_CMD_UID, ["--json"]);

    // stdout is exactly one JSON document (no ✅ / 📊 noise).
    const parsed = JSON.parse(stdoutChunks.join(""));
    expect(parsed.command).toBe(COMP_CMD_UID);
    expect(parsed.target).toBe(vault.protoRelPath);

    // The core acceptance: the composite created a task as a side effect →
    // created[0] surfaces it (this assertion is the revert-verify axis — RED
    // when executeComposite drops the createdPaths surfacing).
    expect(Array.isArray(parsed.created)).toBe(true);
    expect(parsed.created).toHaveLength(1);
    const entry = parsed.created[0];
    expect(typeof entry.uuid).toBe("string");
    expect(typeof entry.path).toBe("string");
    expect(typeof entry.label).toBe("string");

    // path resolves to a real file on disk (AC verification)
    const abs = path.join(vault.root, entry.path);
    expect(fs.existsSync(abs)).toBe(true);
    const content = fs.readFileSync(abs, "utf-8");

    // uuid = the created file's exo__Asset_uid (its UUID-canon basename)
    expect(entry.uuid).toBe(path.basename(entry.path, ".md"));
    expect(content).toContain(`exo__Asset_uid: ${entry.uuid}`);

    // label read fresh from the created file's exo__Asset_label
    expect(entry.label).toBe(INPUT_LABEL);

    // the created file lives inside the create step's target folder
    expect(entry.path).toBe(path.join("Inbox", `${entry.uuid}.md`));

    // both composite steps ran: the SOURCE (click-target) gained the flag —
    // proving the create is a genuine SIDE EFFECT of a real multi-step composite.
    const protoContent = fs.readFileSync(
      path.join(vault.root, vault.protoRelPath),
      "utf-8",
    );
    expect(protoContent).toContain("test__CompositeRan: yes");
  });

  it("@req:8eaae6a9-3a11-42cd-a549-c988dae2073b --json on a property_set-only composite yields an empty created array", async () => {
    await runApply(PSET_COMP_CMD_UID, ["--json"]);

    const parsed = JSON.parse(stdoutChunks.join(""));
    expect(parsed.command).toBe(PSET_COMP_CMD_UID);
    expect(Array.isArray(parsed.created)).toBe(true);
    expect(parsed.created).toHaveLength(0);

    // the property_set step really ran (the source gained the flag) — proving
    // the empty `created` is "created nothing", not "did nothing".
    const protoContent = fs.readFileSync(
      path.join(vault.root, vault.protoRelPath),
      "utf-8",
    );
    expect(protoContent).toContain("test__Flag: done");
    // and no task was created in Inbox
    const inbox = fs.readdirSync(vault.inboxDir).filter((f) => f.endsWith(".md"));
    expect(inbox).toHaveLength(0);
  });

  it("--json on a DIRECT create_instance command (#3906) still surfaces its created asset (composite change preserves direct behavior)", async () => {
    await runApply(DIRECT_CMD_UID, ["--json"]);

    const parsed = JSON.parse(stdoutChunks.join(""));
    expect(parsed.command).toBe(DIRECT_CMD_UID);
    expect(Array.isArray(parsed.created)).toBe(true);
    expect(parsed.created).toHaveLength(1);
    const entry = parsed.created[0];
    const abs = path.join(vault.root, entry.path);
    expect(fs.existsSync(abs)).toBe(true);
    expect(entry.uuid).toBe(path.basename(entry.path, ".md"));
    expect(entry.label).toBe(INPUT_LABEL);
    // NO source flag: a direct create does not touch the source (only the
    // composite's property_set step does — proving the two paths are distinct).
    const protoContent = fs.readFileSync(
      path.join(vault.root, vault.protoRelPath),
      "utf-8",
    );
    expect(protoContent).not.toContain("test__CompositeRan");
  });

  it("@req:8eaae6a9-3a11-42cd-a549-c988dae2073b --json on a composite with TWO create_instance steps emits TWO created entries (multi-create)", async () => {
    await runApply(MULTI_COMP_CMD_UID, ["--json"]);

    const parsed = JSON.parse(stdoutChunks.join(""));
    expect(parsed.command).toBe(MULTI_COMP_CMD_UID);
    expect(Array.isArray(parsed.created)).toBe(true);
    // both create_instance steps ran → createdPaths collected both → two entries
    expect(parsed.created).toHaveLength(2);

    // each entry resolves to a distinct real file (one per target folder)
    const paths = parsed.created.map((c: { path: string }) => c.path).sort();
    expect(new Set(paths).size).toBe(2);
    for (const entry of parsed.created) {
      const abs = path.join(vault.root, entry.path);
      expect(fs.existsSync(abs)).toBe(true);
      expect(entry.uuid).toBe(path.basename(entry.path, ".md"));
      expect(entry.label).toBe(INPUT_LABEL);
    }
    // one file landed in each step's target folder (Inbox + Inbox2)
    expect(paths.some((p: string) => p.startsWith(`Inbox${path.sep}`))).toBe(true);
    expect(paths.some((p: string) => p.startsWith(`Inbox2${path.sep}`))).toBe(true);
  });

  it("without --json a composite create surfaces the created path in the human message + emits NO stdout JSON", async () => {
    await runApply(COMP_CMD_UID, []);

    const stdout = stdoutChunks.join("");
    expect(stdout).not.toContain('"created"');

    const logged = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("✅");
    expect(logged).toContain("Composite ran");
    // the created path is appended (→ Inbox/<uid>.md)
    expect(logged).toMatch(/→ .*Inbox\//);
    const inbox = fs.readdirSync(vault.inboxDir).filter((f) => f.endsWith(".md"));
    expect(inbox).toHaveLength(1);
  });
});
