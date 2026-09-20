/**
 * Issue #4298 — `apply --dry-run` must reach the SAME verdict as the real run
 * for the `--input` it was handed.
 *
 * Before the fix the dry-run early-return sat ABOVE both the `--input` JSON
 * parse and any use of the grounding's value templates, so a preview answered
 * `rc=0 "precondition passed"` for an input the real run refuses with `rc=5`:
 *
 *   --input '{"value":"X"}'     wrong key   → dry-run OK,  --yes rc=5
 *   --input 'НЕ-JSON'           malformed   → dry-run OK,  --yes rc=5
 *
 * A preview that cannot fail is not a preview — and worse, repro steps written
 * through `--dry-run` (the tail of #4230 was one) silently stop proving anything.
 *
 * The real pipeline is exercised against a temp vault, and the dry-run cases
 * assert the file is byte-identical afterwards (`dry-run-preview-not-real-output`).
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

const COMMAND_UID = "42980000-0000-0000-0000-0000000000a1";
const GROUNDING_UID = "42980000-0000-0000-0000-0000000000a2";
const TARGET_UID = "42980000-0000-0000-0000-0000000000a3";

/** property_set grounding-type UID (GroundingTypeUIDs.ts) */
const PROPERTY_SET_TYPE = "cf3bb923-f1f1-40be-b728-782844402426";

const COMMAND_MD = [
  "---",
  `exo__Asset_uid: ${COMMAND_UID}`,
  `exo__Asset_label: "Set label (#4298 test)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${GROUNDING_UID}|grounding]]"`,
  "---",
  "",
].join("\n");

/** Mirrors the real "Set label composite (#3779)": the value is the user's
 *  NAMED input `label`, not the anonymous `value`. */
const GROUNDING_MD = [
  "---",
  `exo__Asset_uid: ${GROUNDING_UID}`,
  `exo__Asset_label: "Set label from $input.label"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${PROPERTY_SET_TYPE}]]"`,
  `exocmd__Grounding_targetProperty: "exo__Asset_label"`,
  `exocmd__Grounding_targetValueSubstitution: "$input.label"`,
  "---",
  "",
].join("\n");

const TARGET_MD = [
  "---",
  `exo__Asset_uid: ${TARGET_UID}`,
  `exo__Asset_label: "Original label"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[ems__Task]]"`,
  "---",
  "",
  "# Body",
  "",
].join("\n");

function buildVault(): { root: string; targetRel: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-4298-dryrun-"));
  const write = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");
  write(COMMAND_UID, COMMAND_MD);
  write(GROUNDING_UID, GROUNDING_MD);
  write(TARGET_UID, TARGET_MD);
  return { root, targetRel: `${TARGET_UID}.md` };
}

describe("Issue #4298 — apply --dry-run agrees with the real run about --input", () => {
  let root: string;
  let exitCode: number | undefined;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    exitCode = undefined;
    processExitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        exitCode = code ?? 0;
        throw new Error(`__process_exit_${code ?? 0}__`);
      }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  async function run(
    vaultRoot: string,
    targetRel: string,
    extra: string[],
  ): Promise<void> {
    const cmd = applyCommand();
    try {
      await cmd.parseAsync([
        "node",
        "apply",
        COMMAND_UID,
        targetRel,
        "--vault",
        vaultRoot,
        ...extra,
      ]);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  const stderr = (): string =>
    consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");
  const stdout = (): string =>
    consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");

  it("refuses a WRONG input key in --dry-run, naming the key the grounding wants", async () => {
    const vault = buildVault();
    root = vault.root;
    const before = fs.readFileSync(path.join(root, vault.targetRel), "utf-8");

    await run(root, vault.targetRel, ["--input", '{"value":"X"}', "--dry-run"]);

    expect(exitCode).not.toBe(0);
    expect(stderr()).toContain(`--input '{"label":...}' required`);
    // A refusal must not look like a preview.
    expect(stdout()).not.toContain("would apply");
    // Dry-run stays a dry-run: nothing written.
    expect(fs.readFileSync(path.join(root, vault.targetRel), "utf-8")).toBe(
      before,
    );
  });

  it("refuses MALFORMED --input JSON in --dry-run (it used to be parsed only after the early return)", async () => {
    const vault = buildVault();
    root = vault.root;
    const before = fs.readFileSync(path.join(root, vault.targetRel), "utf-8");

    await run(root, vault.targetRel, ["--input", "not-json-at-all", "--dry-run"]);

    expect(exitCode).not.toBe(0);
    expect(stderr()).toContain("--input: invalid JSON object");
    expect(fs.readFileSync(path.join(root, vault.targetRel), "utf-8")).toBe(
      before,
    );
  });

  it("still previews normally when the input is CORRECT (the refusal is not unconditional)", async () => {
    const vault = buildVault();
    root = vault.root;
    const before = fs.readFileSync(path.join(root, vault.targetRel), "utf-8");

    await run(root, vault.targetRel, [
      "--input",
      '{"label":"New label"}',
      "--dry-run",
    ]);

    expect(stdout()).toContain("would apply");
    expect(stderr()).not.toContain("required");
    expect(fs.readFileSync(path.join(root, vault.targetRel), "utf-8")).toBe(
      before,
    );
  });

  it("previews a command that needs NO input at all — unchanged behaviour", async () => {
    // Ratchet: the pre-flight must not invent a requirement where the grounding
    // consumes nothing. Without --input the call is still a clean preview.
    const vault = buildVault();
    root = vault.root;
    const noInputGrounding = GROUNDING_MD.replace(
      `exocmd__Grounding_targetValueSubstitution: "$input.label"`,
      `exocmd__Grounding_targetValueLiteral: "Fixed label"`,
    );
    fs.writeFileSync(
      path.join(root, `${GROUNDING_UID}.md`),
      noInputGrounding,
      "utf-8",
    );

    await run(root, vault.targetRel, ["--dry-run"]);

    expect(stdout()).toContain("would apply");
    expect(stderr()).not.toContain("required");
  });

  it("the REAL run refuses the same wrong key — the two paths now agree", async () => {
    // The half that already worked; asserted here so the pair is visible in one
    // place. If a future change makes the real path accept `{"value"}`, this
    // goes red next to the dry-run axis instead of leaving them to drift apart.
    const vault = buildVault();
    root = vault.root;
    const before = fs.readFileSync(path.join(root, vault.targetRel), "utf-8");

    await run(root, vault.targetRel, ["--input", '{"value":"X"}', "--yes"]);

    expect(exitCode).not.toBe(0);
    expect(stderr()).toContain(`--input '{"label":...}' required`);
    expect(fs.readFileSync(path.join(root, vault.targetRel), "utf-8")).toBe(
      before,
    );
  });

  it("the REAL run applies the correct key — end-to-end control", async () => {
    const vault = buildVault();
    root = vault.root;

    await run(root, vault.targetRel, [
      "--input",
      '{"label":"New label"}',
      "--yes",
    ]);

    const written = fs.readFileSync(path.join(root, vault.targetRel), "utf-8");
    expect(written).toContain("New label");
    expect(written).not.toContain("Original label");
  });
});
