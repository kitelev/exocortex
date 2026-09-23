/**
 * Ticket bb855bb2 — `cli create --aliases` must refuse a comma-joined list.
 *
 * `--aliases` is VARIADIC (`<names...>`), so the caller passes each alias as its
 * own argument. A single token `a,b,c` is therefore ONE alias whose text happens
 * to contain commas — and it used to be accepted without a word. That is how
 * eight concept assets ended up carrying an alias `Стек,стек,LIFO,stack` (dedup
 * pass 73d7304b) while the caller believed it had written four.
 *
 * The discriminator is a comma NOT followed by a space: that is the shape of a
 * machine-joined list. A human alias keeps its comma-space (`Иванов, Иван`) and
 * must still be accepted — Y3 pins exactly that, so the guard cannot be widened
 * into "any comma" without going RED.
 *
 * Drives the REAL `createCommand().parseAsync` end-to-end against a temp vault
 * (commander → the guard → core `GenericAssetCreationService` → on-disk
 * frontmatter), mirroring `create-multivalue.integration.test.ts`.
 *
 * Revert-verify (req db6b7524): removing the guard turns Y1 RED; widening it to
 * any comma turns Y3 RED; restoring the `--aliases <a,b>` hint turns Y4 RED.
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

const { createCommand } = await import("../../src/commands/create.js");

const CLASS_UID = "65b58c34-7451-4b89-bea3-483f7c65fe73"; // pass-through (ztlk:Note)

describe("Ticket bb855bb2: cli create --aliases refuses a comma-joined list", () => {
  let vault: string;
  let exitSpy: jest.SpiedFunction<typeof process.exit>;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;
  let consoleErrSpy: jest.SpiedFunction<typeof console.error>;
  let stdoutChunks: string[];
  let errChunks: string[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-bb855bb2-"));
    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });
    stdoutChunks = [];
    errChunks = [];
    consoleErrSpy = jest
      .spyOn(console, "error")
      .mockImplementation(((...a: unknown[]) => {
        errChunks.push(a.map(String).join(" "));
      }) as never);
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array) => {
        stdoutChunks.push(String(chunk));
        return true;
      }) as never);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleErrSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  /** Run the real `create` with the given extra args; never throws. */
  const run = async (extraArgs: string[], label: string): Promise<void> => {
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
      ...extraArgs,
    ];
    try {
      await createCommand().parseAsync(argv);
    } catch (e) {
      const msg = String((e as Error)?.message);
      if (!/^__process_exit_\d+__$/.test(msg)) throw e;
    }
  };

  /** Every markdown file the run left in the vault (the fixture starts empty). */
  const writtenFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".md")) out.push(full);
      }
    };
    walk(vault);
    return out;
  };

  it("@req:db6b7524-8d90-42a5-9791-f21ec7ccd7be Y1 a comma-joined --aliases token is refused, and nothing is written", async () => {
    await run(["--aliases", "Стек,стек,LIFO,stack"], "List-shaped aliases");

    const errors = errChunks.join(" || ");
    expect(errors).toContain("comma-joined list");
    // The message must teach the form that WORKS — otherwise the caller repeats
    // the mistake. It names the offending token and the variadic invocation.
    expect(errors).toContain("Стек,стек,LIFO,stack");
    expect(errors).toContain("--aliases Стек стек LIFO stack");
    // Refusal means refusal: the asset is not created.
    expect(writtenFiles()).toHaveLength(0);
  });

  it("@req:db6b7524-8d90-42a5-9791-f21ec7ccd7be Y2 aliases passed as separate arguments are each kept", async () => {
    await run(["--aliases", "Стек", "стек", "LIFO", "stack"], "Proper aliases");

    const files = writtenFiles();
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(files[0], "utf-8");
    for (const alias of ["Стек", "стек", "LIFO", "stack"]) {
      expect(content).toContain(`  - ${alias}`);
    }
  });

  it("@req:db6b7524-8d90-42a5-9791-f21ec7ccd7be Y3 an alias whose comma IS followed by a space stays one alias", async () => {
    await run(["--aliases", "Иванов, Иван"], "Human alias with a comma");

    expect(errChunks.join(" || ")).not.toContain("comma-joined list");
    const files = writtenFiles();
    expect(files).toHaveLength(1);
    // One list ITEM carrying the comma — not two items. The serializer leaves it
    // unquoted, so the item line is the assertion.
    const written = fs.readFileSync(files[0], "utf-8");
    expect(written).toContain("  - Иванов, Иван");
    expect(written).not.toContain("  - Иванов\n  - Иван");
  });

  it("@req:db6b7524-8d90-42a5-9791-f21ec7ccd7be Y4 the --property aliases=X refusal points at the VARIADIC form", async () => {
    await run(["--property", "aliases=X"], "Self-managed field via --property");

    const errors = errChunks.join(" || ");
    expect(errors).toContain("--aliases <a> <b>");
    // The old hint printed `--aliases <a,b>` — the very shape Y1 refuses, so the
    // message used to teach the mistake it was written to prevent.
    expect(errors).not.toContain("--aliases <a,b>");
  });
});
