/**
 * Phase 0 Task 0.3 — integration test for `apply --seed/--frozen-clock`.
 *
 * Builds a tiny vault with a command + create_instance grounding, runs `apply`
 * twice with identical determinism flags, and asserts the two created files are
 * byte-for-byte identical (acceptance criterion #2). Also verifies that omitting
 * the flags still works (regression / default live-clock path).
 *
 * Uses programmatic `applyCommand().parseAsync(...)` rather than `execSync` on a
 * built binary — faster, no build dependency, and consistent with the
 * `command-dry-run.integration.test.ts` `processExitSpy` pattern.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { applyCommand } = await import("../../src/commands/apply.js");

const COMMAND_UID = "ccccccc1-0000-0000-0000-000000000001";
const GROUNDING_UID = "ccccccc2-0000-0000-0000-000000000002";
const PARENT_UID = "ccccccc3-0000-0000-0000-000000000003";
const SEED = "11111111-2222-3333-4444-555555555555";
const FROZEN_CLOCK = "2026-01-01T00:00:00Z";

const COMMAND_MD = [
  "---",
  `exo__Asset_uid: ${COMMAND_UID}`,
  `exo__Asset_label: "Create child task (det-test)"`,
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
  `exocmd__Grounding_type: "[[4367e2d6-6c92-450a-becb-abce1fb07682]]"`,
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

interface VaultLayout {
  root: string;
  parentRelPath: string;
  inboxDir: string;
}

function buildVault(): VaultLayout {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-apply-det-"));
  fs.writeFileSync(path.join(root, `${COMMAND_UID}.md`), COMMAND_MD, "utf-8");
  fs.writeFileSync(path.join(root, `${GROUNDING_UID}.md`), GROUNDING_MD, "utf-8");
  fs.writeFileSync(path.join(root, `${PARENT_UID}.md`), PARENT_MD, "utf-8");
  const inboxDir = path.join(root, "Inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  return { root, parentRelPath: `${PARENT_UID}.md`, inboxDir };
}

function listCreatedFiles(inboxDir: string): string[] {
  if (!fs.existsSync(inboxDir)) return [];
  return fs.readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
}

describe("Phase 0 Task 0.3: apply --seed / --frozen-clock determinism", () => {
  let vault: VaultLayout;
  let vault2: VaultLayout;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    vault = buildVault();
    vault2 = buildVault();
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
    fs.rmSync(vault.root, { recursive: true, force: true });
    fs.rmSync(vault2.root, { recursive: true, force: true });
  });

  async function runApply(vaultRoot: string, extraArgs: string[] = []): Promise<void> {
    const cmd = applyCommand();
    const args = [
      "node",
      "apply",
      COMMAND_UID,
      `${PARENT_UID}.md`,
      "--vault",
      vaultRoot,
      "--input",
      JSON.stringify({ label: "Deterministic child" }),
      ...extraArgs,
    ];
    try {
      await cmd.parseAsync(args);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  it("two runs with identical --seed and --frozen-clock yield byte-identical created file", async () => {
    const detArgs = ["--seed", SEED, "--frozen-clock", FROZEN_CLOCK];

    await runApply(vault.root, detArgs);
    const created1 = listCreatedFiles(vault.inboxDir);
    expect(created1).toHaveLength(1);
    const path1 = path.join(vault.inboxDir, created1[0]);
    const content1 = fs.readFileSync(path1, "utf-8");

    await runApply(vault2.root, detArgs);
    const created2 = listCreatedFiles(vault2.inboxDir);
    expect(created2).toHaveLength(1);
    const path2 = path.join(vault2.inboxDir, created2[0]);
    const content2 = fs.readFileSync(path2, "utf-8");

    expect(created2[0]).toBe(created1[0]);
    expect(content2).toBe(content1);

    expect(content1).toMatch(/exo__Asset_uid: [0-9a-f-]{36}/);
    expect(content1).toContain("exo__Asset_label: Deterministic child");
    expect(content1).toContain("exo__Asset_createdAt: 2026-01-01T");
  });

  it("apply without determinism flags still produces a file (regression — live UID + clock)", async () => {
    await runApply(vault.root);
    const created = listCreatedFiles(vault.inboxDir);
    expect(created).toHaveLength(1);
    const content = fs.readFileSync(
      path.join(vault.inboxDir, created[0]),
      "utf-8",
    );
    expect(content).toMatch(/exo__Asset_uid: [0-9a-f-]{36}/);
    expect(content).toContain("exo__Asset_label: Deterministic child");
  });

  it("--frozen-clock alone forces createdAt timestamp without affecting UID generation", async () => {
    await runApply(vault.root, ["--frozen-clock", FROZEN_CLOCK]);
    const created = listCreatedFiles(vault.inboxDir);
    expect(created).toHaveLength(1);
    const content = fs.readFileSync(
      path.join(vault.inboxDir, created[0]),
      "utf-8",
    );
    expect(content).toContain("exo__Asset_createdAt: 2026-01-01T");
  });
});
