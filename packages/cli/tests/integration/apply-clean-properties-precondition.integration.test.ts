/**
 * req:f05caada-fbaa-43fb-9808-e5330c685df4 — the homoiconic "Clean Properties"
 * exocmd command (asset 0da175e1) is available ONLY on assets that have at
 * least one EMPTY frontmatter property. Its precondition declares host function
 * `hasObsoleteProperties`, which was UNREGISTERED in code → on the async
 * inline-button path `PreconditionEvaluator.evaluateHostFunction` fell open
 * (`return true`) and the button showed on every asset. The CLI surface gates
 * `apply` on the same precondition, so it exhibits the parallel fail-open.
 *
 * Fix: register `hasObsoleteProperties` on the CLI/plugin PreconditionEvaluator
 * via a factory that reads the target's frontmatter and returns the pure
 * `hasEmptyProperties(metadata)` helper (mirrors `isInWrongFolder` / Issue #3302).
 *
 * Production-shape (test-fixture-realism): these tests run the REAL `apply`
 * pipeline against a temp vault (no `--dry-run`; the mutated file is read back —
 * dry-run-preview-not-real-output.md):
 *   apply → NoteToRDFConverter.convertVault → CommandResolver.loadCommand →
 *   PreconditionEvaluator.evaluate (real `hasObsoleteProperties` host function) →
 *   GroundingExecutor → cleanProperties service (PropertyCleanupService).
 *
 * Revert-verify (integration-test-revert-verify): with the registration reverted
 * (delete the `evaluator.registerHostFunction("hasObsoleteProperties", …)` line in
 * `apply.ts`), the "CLEAN asset is blocked" test goes RED — the unregistered host
 * function falls open, the precondition passes, and `apply` proceeds instead of
 * printing "Precondition not satisfied". With the fix it is GREEN. The
 * "EMPTY asset proceeds" test passes both ways (it was always fail-open on a
 * clean-and-EMPTY asset), so it guards the working direction, not the regression.
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

// GroundingType catalog UID (packages/core/src/domain/constants/GroundingTypeUIDs.ts)
const GT_SERVICE_CALL = "9bf9fc99-ac37-4e51-b9f5-bd920099947c";

// Fixture command / precondition / grounding (local UIDs).
const CMD = "f05caada-0000-0000-0000-000000000001";
const PRECOND = "f05caada-0000-0000-0000-000000000002";
const GROUNDING = "f05caada-0000-0000-0000-000000000003";

const fm = (lines: string[]): string => ["---", ...lines, "---", ""].join("\n");

const CMD_MD = fm([
  `exo__Asset_uid: ${CMD}`,
  `exo__Asset_label: "Clean Properties (fixture)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class: ["[[exocmd__Command]]"]`,
  `exocmd__Command_cliName: clean-props-fixture`,
  `exocmd__Command_precondition: "[[${PRECOND}|precondition]]"`,
  `exocmd__Command_grounding: "[[${GROUNDING}|g]]"`,
]);
// Mirrors the real precondition asset 79a7fb4b — a host-function gate on
// "has empty properties" (legacy name `hasObsoleteProperties`).
const PRECOND_MD = fm([
  `exo__Asset_uid: ${PRECOND}`,
  `exo__Asset_label: "Has empty properties (fixture)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class: ["[[exocmd__Precondition]]"]`,
  `exocmd__Precondition_hostFunction: "hasObsoleteProperties"`,
]);
// Mirrors the real grounding de7914fb — service_call → cleanProperties.
const GROUNDING_MD = fm([
  `exo__Asset_uid: ${GROUNDING}`,
  `exo__Asset_label: "Clean properties via service (fixture)"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_SERVICE_CALL}]]"`,
  `exocmd__Grounding_serviceId: "cleanProperties"`,
]);

function buildVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-cleanprops-"));
  const write = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");
  write(CMD, CMD_MD);
  write(PRECOND, PRECOND_MD);
  write(GROUNDING, GROUNDING_MD);
  return root;
}

describe("req:f05caada — CLI apply clean-properties is gated by empty-property presence", () => {
  let root: string;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    processExitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__process_exit_${code ?? 0}__`);
      }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    root = buildVault();
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  async function runApply(targetPath: string): Promise<void> {
    const cmd = applyCommand();
    try {
      await cmd.parseAsync([
        "node",
        "apply",
        "clean-props-fixture",
        targetPath,
        "--vault",
        root,
        "--yes",
      ]);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  function writeTarget(uid: string, extraLines: string[]): string {
    const rel = `${uid}.md`;
    fs.writeFileSync(
      path.join(root, rel),
      fm([
        `exo__Asset_uid: ${uid}`,
        `exo__Asset_label: "Target ${uid}"`,
        ...extraLines,
      ]),
      "utf-8",
    );
    return rel;
  }

  function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), "utf-8");
  }

  function preconditionBlocked(): boolean {
    return consoleErrorSpy.mock.calls.some((c) =>
      /Precondition not satisfied/.test(String(c[0])),
    );
  }

  it("@req:f05caada-fbaa-43fb-9808-e5330c685df4 EMPTY-property asset → precondition passes and the empty property is removed (real mutation)", async () => {
    // `empty_marker:` parses to null → an empty frontmatter value.
    const rel = writeTarget("f05caada-0000-0000-0000-0000000000a1", [
      "empty_marker:",
    ]);

    await runApply(rel);

    expect(preconditionBlocked()).toBe(false);
    const written = read(rel);
    // cleanProperties removed the empty property; the real ones survive.
    expect(written).not.toContain("empty_marker");
    expect(written).toContain("exo__Asset_uid:");
    expect(written).toContain("exo__Asset_label:");
  });

  it("@req:f05caada-fbaa-43fb-9808-e5330c685df4 CLEAN asset (no empty property) → precondition NOT satisfied, no mutation", async () => {
    // Every frontmatter value is non-empty.
    const rel = writeTarget("f05caada-0000-0000-0000-0000000000a2", [
      "some_prop: a real value",
    ]);
    const before = read(rel);

    await runApply(rel);

    expect(preconditionBlocked()).toBe(true);
    expect(read(rel)).toBe(before); // untouched
  });
});
