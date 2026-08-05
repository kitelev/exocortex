/**
 * req 59220c17 — the property-name guard is ASYMMETRIC: `remove-property`
 * ACCEPTS a property that is absent from the mounted TBox, while `set-property`
 * (and `create`) keep REJECTING it fail-loud.
 *
 * Rationale: the guard (reqs 40a9a81b / c616a289) exists against WRITE typos —
 * a mistyped key would land a DEAD property nothing reads. On the DELETE side
 * the same input is the opposite case: a property outside the TBox has no
 * consumers and is not SHACL-validated, i.e. it is garbage by construction and
 * precisely the class `remove-property` (req b160178e) exists to delete.
 * Refusing it pushed the operation OUT of the product (a raw Bash strip that
 * bypasses the PreToolUse hooks + SHACL floor) — the very gap issue #3926
 * closed. A delete-side typo is bounded: removal of an absent key is an
 * idempotent no-op, so the unknown name is surfaced as a NON-BLOCKING hint.
 *
 * Drives the REAL `removePropertyCommand()` / `setPropertyCommand()` actions
 * end-to-end against a temp fixture vault whose mounted TBox DOES declare
 * property defs (test-fixture-realism: with an EMPTY mounted set the validator
 * fails open and every scenario here would be vacuous).
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md) —
 * TWO independent axes, each reddening exactly its own scenario:
 *   1. guard removal — restore `await propertyNameValidator.validate([property])`
 *      in `remove-property.ts` → scenarios 1 AND 3 RED (the restored guard
 *      refuses BOTH undeclared names before either can be acted on).
 *   2. unknown-name hint — neutralise the lazy `!changed` hint branch →
 *      ONLY scenario 3 RED (scenario 1 stays GREEN — that asymmetry is what
 *      distinguishes this axis from axis 1).
 * The negative controls (2: set-property still refuses; 4: a DECLARED name emits
 * no hint; 5: the guarded denylist still refuses) stay GREEN under BOTH breaks,
 * proving the delta is exactly the delete-side acceptance + its diagnostic.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { removePropertyCommand } = await import(
  "../../src/commands/remove-property.js"
);
const { setPropertyCommand } = await import("../../src/commands/set-property.js");

const REQ = "@req:59220c17-5b7d-43b3-98db-6eef168d5ef3";

const TBOX_DIR = "assetspaces/kitelev/exoas-public/ems";
const TASKS_DIR = "assetspaces/kitelev/exoas-my/tasks";

const TASK_UID = "d7d7d7d7-0000-4000-8000-000000000001";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";

/** Frozen-clock instant → 2026-08-05T15:00:00 rendered in Asia/Almaty (UTC+5). */
const FROZEN_CLOCK = "2026-08-05T10:00:00Z";
const EXPECTED_UPDATED_AT = "2026-08-05T15:00:00";

/** Present on the asset, ABSENT from the mounted TBox — the garbage class. */
const UNDECLARED_PRESENT = "ems__Project_communicationChannel";
/** Absent from the asset AND from the mounted TBox — the typo class. */
const UNDECLARED_ABSENT = "ems__Project_bogusChannel";
/** DECLARED in the mounted TBox but absent from the asset — the no-op control. */
const DECLARED_ABSENT = "ems__Effort_area";

describe("req 59220c17: remove-property accepts an undeclared property (set-property still refuses)", () => {
  let vault: string;
  let taskPath: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  /** A minimal `prefix__Name` property-def the collector recognises. */
  function writePropertyDef(label: string, metaclass: string): void {
    fs.writeFileSync(
      path.join(vault, TBOX_DIR, `${label}.md`),
      [
        "---",
        `exo__Instance_class:`,
        `  - "[[${metaclass}]]"`,
        `exo__Asset_label: ${label}`,
        "---",
        "",
      ].join("\n"),
    );
  }

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "exo-rp-unknown-"));
    fs.mkdirSync(path.join(vault, TBOX_DIR), { recursive: true });
    fs.mkdirSync(path.join(vault, TASKS_DIR), { recursive: true });

    // A NON-EMPTY mounted property-name set — without it the validator fails
    // open and every scenario below would pass for the wrong reason.
    writePropertyDef(DECLARED_ABSENT, "exo__ObjectProperty");
    writePropertyDef("ems__Effort_status", "exo__ObjectProperty");
    writePropertyDef("exo__Asset_label", "exo__DatatypeProperty");

    taskPath = path.join(TASKS_DIR, `${TASK_UID}.md`);
    fs.writeFileSync(
      path.join(vault, taskPath),
      [
        "---",
        `exo__Asset_uid: ${TASK_UID}`,
        'exo__Asset_label: "Ship the thing"',
        'ems__Effort_status: "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]"',
        `${UNDECLARED_PRESENT}: "#general"`,
        `exo__Asset_updatedAt: ${STALE_UPDATED_AT}`,
        "---",
        "body",
        "",
      ].join("\n"),
    );

    stdoutChunks = [];
    stderrChunks = [];
    exitCodes = [];
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        exitCodes.push(code ?? 0);
        return undefined as never;
      }) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      }) as never);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(((chunk: unknown) => {
        stderrChunks.push(String(chunk));
        return true;
      }) as never);
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

  interface RunResult {
    exit: number[];
    content: string;
    stdout: string;
    stderr: string;
    errorLog: string;
  }

  function collect(): RunResult {
    return {
      exit: [...exitCodes],
      content: fs.readFileSync(path.join(vault, taskPath), "utf-8"),
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      errorLog: errorSpy.mock.calls.flat().join("\n"),
    };
  }

  async function runRemove(...extraArgs: string[]): Promise<RunResult> {
    await removePropertyCommand().parseAsync(
      [taskPath, "--vault", vault, "--frozen-clock", FROZEN_CLOCK, ...extraArgs],
      { from: "user" },
    );
    return collect();
  }

  async function runSet(...extraArgs: string[]): Promise<RunResult> {
    await setPropertyCommand().parseAsync([taskPath, "--vault", vault, ...extraArgs], {
      from: "user",
    });
    return collect();
  }

  // ── Scenario 1 (revert axis: guard removal) ──

  it(`removes a property that is ABSENT from the mounted TBox ${REQ}`, async () => {
    const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");
    expect(before).toContain(`${UNDECLARED_PRESENT}:`);

    const r = await runRemove("--property", UNDECLARED_PRESENT);

    expect(r.errorLog).not.toContain("Unknown property");
    expect(r.exit).toEqual([0]);
    expect(r.content).not.toContain(`${UNDECLARED_PRESENT}:`);
    expect(r.content).toContain(`exo__Asset_updatedAt: ${EXPECTED_UPDATED_AT}`);
    expect(r.stdout).toContain('"removed":true');
    // untouched neighbours
    expect(r.content).toContain('exo__Asset_label: "Ship the thing"');
    expect(r.content).toContain("ems__Effort_status:");
  });

  // ── Scenario 2 (negative control: the WRITE side is unchanged) ──

  it(`set-property on the SAME undeclared name still refuses fail-loud, file byte-unchanged ${REQ}`, async () => {
    const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");

    const r = await runSet("--property", UNDECLARED_PRESENT, "--value", "x");

    expect(r.exit).not.toContain(0);
    expect(r.errorLog).toContain("Unknown property");
    expect(r.errorLog).toContain(UNDECLARED_PRESENT);
    expect(r.content).toBe(before);
  });

  // ── Scenario 3 (revert axis: unknown-name hint) ──

  it(`hints when NOTHING was removed and the name is absent from the mounted TBox ${REQ}`, async () => {
    const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");

    const r = await runRemove("--property", UNDECLARED_ABSENT);

    expect(r.exit).toEqual([0]);
    expect(r.stdout).toContain('"removed":false');
    expect(r.content).toBe(before); // idempotent no-op, no updatedAt bump
    expect(r.stderr).toContain("Nothing was removed");
    expect(r.stderr).toContain(UNDECLARED_ABSENT);
    expect(r.stderr).toContain("not a property in the mounted TBox");
  });

  // ── Scenario 4 (negative control: a DECLARED name gets no hint) ──

  it(`emits NO hint when nothing was removed but the name IS declared ${REQ}`, async () => {
    const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");

    const r = await runRemove("--property", DECLARED_ABSENT);

    expect(r.exit).toEqual([0]);
    expect(r.stdout).toContain('"removed":false');
    expect(r.content).toBe(before);
    expect(r.stderr).not.toContain("Nothing was removed");
  });

  // ── Scenario 5 (negative control: the guarded denylist is untouched) ──

  it(`still REFUSES a state-machine-guarded property, naming its apply command ${REQ}`, async () => {
    const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");

    const r = await runRemove("--property", "ems__Effort_status");

    expect(r.exit).not.toContain(0);
    expect(r.errorLog).toContain("dedicated guarded command");
    expect(r.content).toBe(before);
  });
});
