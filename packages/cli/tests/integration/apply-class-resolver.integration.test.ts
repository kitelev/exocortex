/**
 * Issue #3258 — CLI `apply` must emit UID-form `exo__Instance_class` for the
 * created instance, matching the UI button path's output.
 *
 * Bug reproduction: prior to wiring `createVaultFrontmatterClassLabelResolver`,
 * `apply` passed `grounding.targetClass = "ems__Task"` (label-form) through
 * to `GroundingExecutor.executeCreateInstance` unchanged, producing
 * `exo__Instance_class: "[[ems__Task]]"`. The plugin's UI button path
 * (wires `createObsidianClassLabelResolver(app)`) emits canonical UID-form
 * `exo__Instance_class: "[[1b20a8f0-...]]"`.
 *
 * After fix: CLI `apply` wires `createVaultFrontmatterClassLabelResolver(nodeFsAdapter)`
 * and emits the same UID-form.
 *
 * Integration test exercises real `applyCommand().parseAsync(...)` against a
 * temp vault containing:
 *   - command + create_instance grounding (label-form targetClass)
 *   - parent prototype asset to click on
 *   - class TBox file declaring `ems__Task` with canonical UID
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { applyCommand } = await import("../../src/commands/apply.js");

const COMMAND_UID = "dddddddd-0000-0000-0000-000000000001";
const GROUNDING_UID = "dddddddd-0000-0000-0000-000000000002";
const PARENT_UID = "dddddddd-0000-0000-0000-000000000003";
const CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // canonical ems__Task UID
const SEED = "99999999-8888-7777-6666-555555555555";
const FROZEN_CLOCK = "2026-01-01T00:00:00Z";

const COMMAND_MD = [
  "---",
  `exo__Asset_uid: ${COMMAND_UID}`,
  `exo__Asset_label: "Create child task (cli-class-resolver)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${GROUNDING_UID}|Create child task grounding]]"`,
  `exocmd__Command_successMessage: "Child task created"`,
  "---",
  "",
].join("\n");

const GROUNDING_MD = [
  "---",
  `exo__Asset_uid: ${GROUNDING_UID}`,
  `exo__Asset_label: "Create child task grounding"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "create_instance"`,
  // Label-form targetClass — the exact shape that triggered the regression.
  `exocmd__Grounding_targetClass: "ems__Task"`,
  `exocmd__Grounding_targetFolder: "Inbox"`,
  "---",
  "",
].join("\n");

const PARENT_MD = [
  "---",
  `exo__Asset_uid: ${PARENT_UID}`,
  `exo__Asset_label: "Parent prototype asset"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[ems__TaskPrototype]]"`,
  "---",
  "",
].join("\n");

// Class TBox file — UUID-named per UID-canon discipline. Carries the canonical
// UID and the label "ems__Task" the grounding references.
const CLASS_TBOX_MD = [
  "---",
  `exo__Asset_uid: ${CLASS_UID}`,
  `exo__Asset_label: "ems__Task"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exo__Class]]"`,
  "---",
  "",
].join("\n");

interface VaultLayout {
  root: string;
  parentRelPath: string;
  inboxDir: string;
}

function buildVault(opts: { withClassTBox: boolean } = { withClassTBox: true }): VaultLayout {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-apply-clsres-"));
  fs.writeFileSync(path.join(root, `${COMMAND_UID}.md`), COMMAND_MD, "utf-8");
  fs.writeFileSync(path.join(root, `${GROUNDING_UID}.md`), GROUNDING_MD, "utf-8");
  fs.writeFileSync(path.join(root, `${PARENT_UID}.md`), PARENT_MD, "utf-8");
  if (opts.withClassTBox) {
    fs.writeFileSync(path.join(root, `${CLASS_UID}.md`), CLASS_TBOX_MD, "utf-8");
  }
  const inboxDir = path.join(root, "Inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  return { root, parentRelPath: `${PARENT_UID}.md`, inboxDir };
}

function listCreatedFiles(inboxDir: string): string[] {
  if (!fs.existsSync(inboxDir)) return [];
  return fs.readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
}

describe("Issue #3258: CLI `apply` emits UID-form exo__Instance_class", () => {
  let vault: VaultLayout;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (vault) fs.rmSync(vault.root, { recursive: true, force: true });
  });

  async function runApply(vaultRoot: string): Promise<void> {
    const cmd = applyCommand();
    const args = [
      "node",
      "apply",
      COMMAND_UID,
      `${PARENT_UID}.md`,
      "--vault",
      vaultRoot,
      "--input",
      JSON.stringify({ label: "Child instance" }),
      "--seed",
      SEED,
      "--frozen-clock",
      FROZEN_CLOCK,
    ];
    try {
      await cmd.parseAsync(args);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  it("emits exo__Instance_class as UID-form wikilink when class TBox is present", async () => {
    vault = buildVault({ withClassTBox: true });

    await runApply(vault.root);

    const created = listCreatedFiles(vault.inboxDir);
    expect(created).toHaveLength(1);
    const content = fs.readFileSync(path.join(vault.inboxDir, created[0]), "utf-8");

    // Primary acceptance criterion: UID-form, not label-form.
    expect(content).toContain(`exo__Instance_class:\n  - "[[${CLASS_UID}]]"`);
    // Negative — must NOT have label-form anywhere.
    expect(content).not.toContain(`"[[ems__Task]]"`);
  });

  it("falls back to label-form when class TBox is missing (resolver returns null)", async () => {
    vault = buildVault({ withClassTBox: false });

    await runApply(vault.root);

    const created = listCreatedFiles(vault.inboxDir);
    expect(created).toHaveLength(1);
    const content = fs.readFileSync(path.join(vault.inboxDir, created[0]), "utf-8");

    // Without TBox declaration, resolver returns null and GroundingExecutor
    // preserves the original label-form ref. Backward-compatible behaviour.
    expect(content).toContain(`exo__Instance_class:\n  - "[[ems__Task]]"`);
  });
});
