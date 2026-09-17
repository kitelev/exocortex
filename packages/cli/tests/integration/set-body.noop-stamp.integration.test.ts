/**
 * Ticket 6ffac10e (part 2) — a NO-OP `exocortex set-body` (the rebuilt content
 * is byte-identical to the file: same body INCLUDING the trailing newline the
 * command itself writes) is NOT a modification: nothing is written (mtime
 * untouched), `exo__Asset_updatedAt` is left alone, exit 0, echo `changed:false`
 * without an `updatedAt` field — the same semantics as `remove-property` of an
 * absent key, `set-property` and the executor's `stampUpdatedAt`.
 *
 * Repro on the published CLI 16.240.11 (frozen clocks A → B): the same
 * `--body-file` twice bumped updatedAt to B.
 *
 * Drives the REAL `setBodyCommand()` end-to-end against a temp fixture vault
 * and asserts on the real bytes read back from disk. Each axis writes the body
 * ONCE under clock A (so the on-disk form is exactly what set-body serialises)
 * and repeats under clock B.
 *
 * Revert-verify: M2 restore the unconditional bump in set-body → N4, N4c, N4d RED;
 * N4b is the changed-body control (GREEN under M2).
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { setBodyCommand } = await import("../../src/commands/set-body.js");

const TASKS_DIR = "assetspaces/kitelev/exoas-my/tasks";
const TASK_UID = "c1c1c1c1-0000-4000-8000-000000000001";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";

/** Clock A → 2026-07-30T15:00:00 in Asia/Almaty; clock B → 16:00:00. */
const CLOCK_A = "2026-07-30T10:00:00Z";
const CLOCK_B = "2026-07-30T11:00:00Z";
const STAMP_A = "2026-07-30T15:00:00";
const STAMP_B = "2026-07-30T16:00:00";
/** A deliberately old mtime: a write (even of identical bytes) would move it. */
const OLD_MTIME = new Date("2019-06-01T00:00:00Z");

describe("Ticket 6ffac10e: `cli set-body` with a byte-identical body is a no-op", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  const taskPath = `${TASKS_DIR}/${TASK_UID}.md`;
  const taskAbs = (): string => path.join(vault, taskPath);
  const originalContent =
    `---\n` +
    `exo__Asset_uid: ${TASK_UID}\n` +
    `exo__Asset_label: "A task"\n` +
    `exo__Asset_updatedAt: ${STALE_UPDATED_AT}\n` +
    `---\n` +
    `OLD BODY LINE 1\nOLD BODY LINE 2\n`;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-6ffac10e-sb-"));
    fs.mkdirSync(path.join(vault, TASKS_DIR), { recursive: true });
    fs.writeFileSync(taskAbs(), originalContent, "utf-8");

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
    bytes: Buffer;
    mtimeMs: number;
    echo: Record<string, unknown>;
    stderr: string;
  }

  /** Write `body` to a file in the vault and run the REAL set-body command on it. */
  async function runWithBody(
    body: string,
    clock: string,
    extraArgs: string[] = [],
  ): Promise<RunResult> {
    const bodyFile = path.join(vault, `body-${Math.random().toString(36).slice(2)}.md`);
    fs.writeFileSync(bodyFile, body, "utf-8");
    const stdoutBefore = stdoutChunks.length;
    const stderrBefore = stderrChunks.length;
    const cmd = setBodyCommand();
    await cmd.parseAsync(
      [taskPath, "--vault", vault, "--frozen-clock", clock, "--body-file", bodyFile, ...extraArgs],
      { from: "user" },
    );
    const lines = stdoutChunks
      .slice(stdoutBefore)
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean);
    const echo = lines.length > 0 ? (JSON.parse(lines[lines.length - 1]) as Record<string, unknown>) : {};
    const bytes = fs.readFileSync(taskAbs());
    return {
      exit: [...exitCodes],
      content: bytes.toString("utf-8"),
      bytes,
      mtimeMs: fs.statSync(taskAbs()).mtimeMs,
      echo,
      stderr: stderrChunks.slice(stderrBefore).join(""),
    };
  }

  function expectStampedA(first: RunResult, body: string): void {
    expect(first.exit).toContain(0);
    expect(first.content).toContain(`exo__Asset_updatedAt: ${STAMP_A}`);
    expect(first.content.endsWith(`---\n${body}`)).toBe(true);
    expect(first.echo.changed).toBe(true);
    expect(first.echo.updatedAt).toBe(STAMP_A);
  }

  function expectNoop(first: RunResult, second: RunResult, bodyBytes: number): void {
    expect(second.exit).toContain(0);
    expect(second.exit).not.toContain(1);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(second.content).toContain(`exo__Asset_updatedAt: ${STAMP_A}`);
    expect(second.content).not.toContain(STAMP_B);
    // Nothing was written at all: the deliberately old mtime survived.
    expect(second.mtimeMs).toBe(OLD_MTIME.getTime());
    // Echo contract: changed:false, NO updatedAt field, bodyBytes still reported.
    expect(second.echo.changed).toBe(false);
    expect(second.echo).not.toHaveProperty("updatedAt");
    expect(second.echo.bodyBytes).toBe(bodyBytes);
    expect(second.stderr).toMatch(/no change/);
  }

  const NEW_BODY = "NEW BODY\n\n- second line\n";

  it("N4: the same body (with trailing newline) again is a no-op — bytes, mtime, updatedAt untouched; changed:false; exit 0 @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const first = await runWithBody(NEW_BODY, CLOCK_A);
    expectStampedA(first, NEW_BODY);

    fs.utimesSync(taskAbs(), OLD_MTIME, OLD_MTIME);
    const second = await runWithBody(NEW_BODY, CLOCK_B);
    expectNoop(first, second, Buffer.byteLength(NEW_BODY, "utf8"));
  });

  it("N4c: a body file WITHOUT a trailing newline is normalised on write, so repeating it is still a no-op @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const bare = "NEW BODY\n\n- second line"; // set-body appends the trailing \n on write
    const first = await runWithBody(bare, CLOCK_A);
    expectStampedA(first, `${bare}\n`);

    fs.utimesSync(taskAbs(), OLD_MTIME, OLD_MTIME);
    const second = await runWithBody(bare, CLOCK_B);
    expectNoop(first, second, Buffer.byteLength(`${bare}\n`, "utf8"));
  });

  it("N4b: a DIFFERENT body still bumps updatedAt (changed:true, updatedAt echoed) @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const first = await runWithBody(NEW_BODY, CLOCK_A);
    expectStampedA(first, NEW_BODY);

    fs.utimesSync(taskAbs(), OLD_MTIME, OLD_MTIME);
    const changedBody = "NEW BODY\n\n- second line\n- third line\n";
    const second = await runWithBody(changedBody, CLOCK_B);
    expect(second.exit).toContain(0);
    expect(second.content.endsWith(`---\n${changedBody}`)).toBe(true);
    expect(second.content).toContain(`exo__Asset_updatedAt: ${STAMP_B}`);
    expect(second.content).not.toContain(STAMP_A);
    expect(second.mtimeMs).not.toBe(OLD_MTIME.getTime());
    expect(second.echo.changed).toBe(true);
    expect(second.echo.updatedAt).toBe(STAMP_B);
    expect(second.stderr).not.toMatch(/no change/);
  });

  it("N4d: --dry-run on a no-op previews the UNCHANGED file (updatedAt A) and echoes changed:false @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const first = await runWithBody(NEW_BODY, CLOCK_A);
    expectStampedA(first, NEW_BODY);

    fs.utimesSync(taskAbs(), OLD_MTIME, OLD_MTIME);
    const second = await runWithBody(NEW_BODY, CLOCK_B, ["--dry-run"]);
    expect(second.exit).toContain(0);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(second.mtimeMs).toBe(OLD_MTIME.getTime());
    expect(second.stderr).toContain("--- DRY RUN PREVIEW ---");
    expect(second.stderr).toContain(`exo__Asset_updatedAt: ${STAMP_A}`);
    expect(second.stderr).not.toContain(STAMP_B);
    expect(second.echo.changed).toBe(false);
    expect(second.echo).not.toHaveProperty("updatedAt");
  });
});
