/**
 * Issue #3906 — integration test for `apply <cmd> <target> --json`.
 *
 * Builds a tiny vault with a create_instance-grounding command + prototype and
 * drives the REAL `applyCommand().parseAsync([...--json...])` end-to-end, then
 * reads the created file from disk (production-shape — not hand-injected). It
 * asserts stdout parses to a `{command,target,created:[{uuid,path,label}]}`
 * envelope whose `created[0]` matches the file actually written; that `--json`
 * off keeps the human output and emits no stdout JSON; and that a non-creating
 * (property_set) grounding yields an empty `created` array.
 *
 * Revert-verify axis (@req:55a79515-dd18-4116-9295-f7bee8949712): the `created[0]` assertion goes RED
 * when the production `created`-surfacing in `apply.ts` is neutralized (the
 * envelope's `created` stays empty → `created[0]` is undefined) and GREEN when
 * restored — empirically checked before merge (see PR body).
 *
 * Uses programmatic `parseAsync` (no built-binary dependency), mirroring
 * `apply-determinism.integration.test.ts`.
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

const CREATE_CMD_UID = "aaaa0001-0000-0000-0000-000000000001";
const CREATE_GROUNDING_UID = "aaaa0002-0000-0000-0000-000000000002";
const PROTO_UID = "aaaa0003-0000-0000-0000-000000000003";
const PSET_CMD_UID = "aaaa0004-0000-0000-0000-000000000004";
const PSET_GROUNDING_UID = "aaaa0005-0000-0000-0000-000000000005";

const INPUT_LABEL = "JSON child task";

const CREATE_CMD_MD = [
  "---",
  `exo__Asset_uid: ${CREATE_CMD_UID}`,
  `exo__Asset_label: "Create child task (json-test)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${CREATE_GROUNDING_UID}|Create child task grounding]]"`,
  `exocmd__Command_successMessage: "Child task created"`,
  "---",
  "",
].join("\n");

const CREATE_GROUNDING_MD = [
  "---",
  `exo__Asset_uid: ${CREATE_GROUNDING_UID}`,
  `exo__Asset_label: "Create child task grounding"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_CREATE_INSTANCE}]]"`,
  `exocmd__Grounding_targetClass: "ems__Task"`,
  `exocmd__Grounding_targetFolder: "Inbox"`,
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

// A non-creating command: property_set writes a literal to the prototype's own
// frontmatter → its ExecutionResult has NO `openPath` → `created` must be empty.
const PSET_CMD_MD = [
  "---",
  `exo__Asset_uid: ${PSET_CMD_UID}`,
  `exo__Asset_label: "Set a flag (json-test)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${PSET_GROUNDING_UID}|Set flag grounding]]"`,
  `exocmd__Command_successMessage: "Flag set"`,
  "---",
  "",
].join("\n");

const PSET_GROUNDING_MD = [
  "---",
  `exo__Asset_uid: ${PSET_GROUNDING_UID}`,
  `exo__Asset_label: "Set flag grounding"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
  `exocmd__Grounding_targetProperty: "test__Flag"`,
  `exocmd__Grounding_targetValueLiteral: "done"`,
  "---",
  "",
].join("\n");

interface VaultLayout {
  root: string;
  protoRelPath: string;
  inboxDir: string;
}

function buildVault(): VaultLayout {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-apply-json-"));
  fs.writeFileSync(path.join(root, `${CREATE_CMD_UID}.md`), CREATE_CMD_MD, "utf-8");
  fs.writeFileSync(
    path.join(root, `${CREATE_GROUNDING_UID}.md`),
    CREATE_GROUNDING_MD,
    "utf-8",
  );
  fs.writeFileSync(path.join(root, `${PROTO_UID}.md`), PROTO_MD, "utf-8");
  fs.writeFileSync(path.join(root, `${PSET_CMD_UID}.md`), PSET_CMD_MD, "utf-8");
  fs.writeFileSync(
    path.join(root, `${PSET_GROUNDING_UID}.md`),
    PSET_GROUNDING_MD,
    "utf-8",
  );
  fs.mkdirSync(path.join(root, "Inbox"), { recursive: true });
  return { root, protoRelPath: `${PROTO_UID}.md`, inboxDir: path.join(root, "Inbox") };
}

describe("Issue #3906: apply --json emits created uid/path", () => {
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

  it("@req:55a79515-dd18-4116-9295-f7bee8949712 --json emits created:[{uuid,path,label}] resolving to the file actually written", async () => {
    await runApply(CREATE_CMD_UID, ["--json"]);

    // stdout is exactly one JSON document (no ✅ / 📊 noise — console.log was
    // suppressed, only the envelope was written to process.stdout).
    const stdout = stdoutChunks.join("");
    const parsed = JSON.parse(stdout);

    expect(parsed.command).toBe(CREATE_CMD_UID);
    expect(parsed.target).toBe(vault.protoRelPath);

    // The core acceptance: created[0] carries uuid + path + label for the asset
    // actually created (this assertion is the revert-verify axis — RED when the
    // production surfacing is neutralized, since created would then be empty).
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

    // uuid is the created file's exo__Asset_uid (its UUID-canon basename)
    expect(entry.uuid).toBe(path.basename(entry.path, ".md"));
    expect(content).toContain(`exo__Asset_uid: ${entry.uuid}`);

    // label was read fresh from the created file's exo__Asset_label
    expect(entry.label).toBe(INPUT_LABEL);
    const onDiskLabel = /exo__Asset_label:\s*"?([^"\n]+?)"?\s*$/m.exec(content)?.[1];
    expect(onDiskLabel).toBe(entry.label);

    // the entry describes the file inside the grounding's target folder
    expect(entry.path).toBe(path.join("Inbox", `${entry.uuid}.md`));
  });

  it("without --json output stays human-readable and emits NO stdout JSON (backward-compatible)", async () => {
    await runApply(CREATE_CMD_UID, []);

    // no JSON envelope on stdout
    const stdout = stdoutChunks.join("");
    expect(stdout).not.toContain('"created"');

    // the human success message went to console.log (with the created path
    // appended per #3906), and a file was still created
    const logged = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("✅");
    expect(logged).toContain("Child task created");
    const inbox = fs.readdirSync(vault.inboxDir).filter((f) => f.endsWith(".md"));
    expect(inbox).toHaveLength(1);
  });

  it("@req:55a79515-dd18-4116-9295-f7bee8949712 --json on a non-creating (property_set) grounding yields an empty created array", async () => {
    await runApply(PSET_CMD_UID, ["--json"]);

    const parsed = JSON.parse(stdoutChunks.join(""));
    expect(parsed.command).toBe(PSET_CMD_UID);
    expect(Array.isArray(parsed.created)).toBe(true);
    expect(parsed.created).toHaveLength(0);

    // property_set really ran (the prototype gained the flag) — proving the
    // empty `created` is "created nothing", not "did nothing".
    const protoContent = fs.readFileSync(
      path.join(vault.root, vault.protoRelPath),
      "utf-8",
    );
    expect(protoContent).toContain("test__Flag: done");
  });
});
