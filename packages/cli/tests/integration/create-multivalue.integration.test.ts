/**
 * Issue #3759 — `exocortex-cli create --property` multi-value support.
 *
 * Repeating the SAME `--property key=value` flag MUST accumulate the values
 * into a YAML array on the produced frontmatter (not last-wins, which silently
 * dropped all but the final value). A single occurrence MUST stay a scalar
 * string (back-compat).
 *
 * This drives the REAL `createCommand()` end-to-end against a temp vault —
 * commander `collect` → `parseProperties` → core `GenericAssetCreationService`
 * → on-disk frontmatter — i.e. the exact production path, not a hand-built
 * propertyValues map. `--skip-wikilink-validation` keeps the fixture minimal;
 * the `--class` is a pass-through UUID (no class file needed).
 *
 * Revert-verify (RFC 0003): restoring the last-wins `parseProperties` reduce
 * (`properties[key] = value`) turns the multi-value assertion RED; the fix
 * (accumulate repeated keys → array) turns it GREEN.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { createCommand } = await import("../../src/commands/create.js");

const RELATE_A = "11111111-1111-4111-8111-111111111111";
const RELATE_B = "22222222-2222-4222-8222-222222222222";
const RELATE_C = "33333333-3333-4333-8333-333333333333";
const CLASS_UID = "65b58c34-7451-4b89-bea3-483f7c65fe73"; // pass-through (ztlk:Note)

describe("Issue #3759: cli create --property multi-value (integration)", () => {
  let vault: string;
  let exitSpy: any;
  let stdoutSpy: any;
  let stderrSpy: any;
  let consoleErrSpy: any;
  let stdoutChunks: string[];
  let errChunks: string[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3759-"));
    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });
    stdoutChunks = [];
    errChunks = [];
    consoleErrSpy = jest
      .spyOn(console, "error")
      .mockImplementation(((...a: any[]) => {
        errChunks.push(a.map(String).join(" "));
      }) as any);
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as any);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: any) => {
        stdoutChunks.push(String(chunk));
        return true;
      }) as any);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleErrSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  /**
   * Run the real `create` command with the given `--property` args, then return
   * the written file's content + parsed JSON output ({uuid, path}). Swallows the
   * spied `process.exit(0)` throw.
   */
  const run = async (propertyArgs: string[], label: string) => {
    const argv = [
      "node",
      "exocortex",
      "--vault",
      vault,
      "--class",
      CLASS_UID,
      "--label",
      label,
      "--skip-wikilink-validation",
      ...propertyArgs,
    ];
    // NB: the action calls `process.exit(0)` INSIDE its own try/catch, so the
    // spied exit(0) throw is caught by the action → ErrorHandler → exit(1).
    // Either way the success JSON has already been written to stdout and the
    // file to disk before the first exit. We swallow any spied exit and parse
    // the stdout JSON (empty stdout ⇒ a genuine failure ⇒ JSON.parse throws).
    try {
      await createCommand().parseAsync(argv);
    } catch (e: any) {
      if (!/^__process_exit_\d+__$/.test(String(e?.message)))
        throw new Error(
          `create threw: ${e?.message} | console.error=${errChunks.join(" || ")}`,
        );
    }
    const stdout = stdoutChunks.join("").trim();
    if (!stdout)
      throw new Error(
        `create produced no stdout (failed) | console.error=${errChunks.join(" || ")}`,
      );
    const out = JSON.parse(stdout);
    const content = fs.readFileSync(path.join(vault, out.path), "utf-8");
    return { content, out };
  };

  it("@req:cd2c3f18-b798-4084-899d-38e2f438a2cc multi-value: repeated --property → YAML array", async () => {
    const { content } = await run(
      [
        "--property",
        `exo__Asset_relates=[[${RELATE_A}]]`,
        "--property",
        `exo__Asset_relates=[[${RELATE_B}]]`,
        "--property",
        `exo__Asset_relates=[[${RELATE_C}]]`,
      ],
      "TEST-3759-multi",
    );

    // YAML array form: `exo__Asset_relates:` followed by `  - "[[...]]"` lines.
    expect(content).toMatch(
      /exo__Asset_relates:\s*\n\s*-\s+"\[\[11111111/,
    );
    expect(content).toMatch(/\n\s*-\s+"\[\[22222222/);
    expect(content).toMatch(/\n\s*-\s+"\[\[33333333/);

    // All three values are present (no last-wins drop).
    expect(content).toContain(RELATE_A);
    expect(content).toContain(RELATE_B);
    expect(content).toContain(RELATE_C);

    // NOT a scalar (the last-wins bug emitted `exo__Asset_relates: "[[C]]"`).
    expect(content).not.toMatch(/exo__Asset_relates:\s*"\[\[/);
  });

  it("@req:cd2c3f18-b798-4084-899d-38e2f438a2cc back-compat: single --property → scalar string", async () => {
    const { content } = await run(
      ["--property", `exo__Asset_relates=[[${RELATE_A}]]`],
      "TEST-3759-single",
    );

    // Scalar form: `exo__Asset_relates: "[[...]]"` on one line, NOT an array.
    expect(content).toMatch(
      new RegExp(`exo__Asset_relates:\\s*"\\[\\[${RELATE_A}\\]\\]"`),
    );
    expect(content).not.toMatch(/exo__Asset_relates:\s*\n\s*-\s+"\[\[/);
  });

  it("@req:cd2c3f18-b798-4084-899d-38e2f438a2cc works for any key (exo__Instance_class-like repeated key)", async () => {
    // A non-system custom key repeated → array, proving key-independence.
    const { content } = await run(
      [
        "--property",
        `custom__Asset_tag=[[${RELATE_A}]]`,
        "--property",
        `custom__Asset_tag=[[${RELATE_B}]]`,
      ],
      "TEST-3759-anykey",
    );
    expect(content).toMatch(/custom__Asset_tag:\s*\n\s*-\s+"\[\[11111111/);
    expect(content).toMatch(/\n\s*-\s+"\[\[22222222/);
  });
});
