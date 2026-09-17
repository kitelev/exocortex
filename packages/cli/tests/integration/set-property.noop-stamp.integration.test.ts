/**
 * Ticket 6ffac10e (part 2) — a NO-OP `exocortex set-property` (the property
 * already holds the requested value, serialised the same way) is NOT a
 * modification: the file stays byte-identical, nothing is written (mtime
 * untouched), `exo__Asset_updatedAt` is left alone, the command exits 0 and
 * echoes `changed: false` (no `updatedAt` field) — the same semantics as
 * `remove-property` of an absent key and the executor's `stampUpdatedAt`.
 *
 * Repro on the published CLI 16.240.11 (frozen clocks A → B): setting the same
 * scalar / the same `--input` array twice bumped updatedAt to B every time.
 *
 * Drives the REAL `setPropertyCommand()` end-to-end against a temp fixture vault
 * and asserts on the real bytes read back from disk (test-fixture-realism).
 * Each axis sets the value ONCE under clock A (the on-disk form is then exactly
 * what the command itself serialises) and repeats under clock B.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 *   M1 restore the unconditional bump (`changed = true`)      → N1, N3, N1d RED
 *   M3 compare against the stamped string instead of original → N1, N3 RED
 *   N2 / N3b are the changed-value controls (stay GREEN under M1/M3).
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { setPropertyCommand } = await import("../../src/commands/set-property.js");

const MOVIES_DIR = "assetspaces/kitelev/exoas-my/movies";
const TASKS_DIR = "assetspaces/kitelev/exoas-my/tasks";

const ANCHOR_MOVIES = "a1a1a1a1-0000-4000-8000-000000000001";
const MOVIE_UID = "b1b1b1b1-0000-4000-8000-000000000003";
const PARENT_A = "d1d1d1d1-0000-4000-8000-000000000005";
const PARENT_B = "d2d2d2d2-0000-4000-8000-000000000006";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";

/** Clock A → 2026-07-12T15:00:00 in Asia/Almaty; clock B → 16:00:00. */
const CLOCK_A = "2026-07-12T10:00:00Z";
const CLOCK_B = "2026-07-12T11:00:00Z";
const STAMP_A = "2026-07-12T15:00:00";
const STAMP_B = "2026-07-12T16:00:00";
/** A deliberately old mtime: a write (even of identical bytes) would move it. */
const OLD_MTIME = new Date("2019-06-01T00:00:00Z");

function md(frontmatter: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
  lines.push("---", "body", "");
  return lines.join("\n");
}

describe("Ticket 6ffac10e: `cli set-property` no-op leaves the file byte-identical and updatedAt untouched", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  const moviePath = `${MOVIES_DIR}/${MOVIE_UID}.md`;
  const movieAbs = (): string => path.join(vault, moviePath);

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-6ffac10e-sp-"));
    const moviesDir = path.join(vault, MOVIES_DIR);
    const tasksDir = path.join(vault, TASKS_DIR);
    fs.mkdirSync(moviesDir, { recursive: true });
    fs.mkdirSync(tasksDir, { recursive: true });

    fs.writeFileSync(
      path.join(moviesDir, `${ANCHOR_MOVIES}.md`),
      md({ exo__Asset_uid: ANCHOR_MOVIES, exo__Asset_label: "concept__Movies" }),
    );
    for (const uid of [PARENT_A, PARENT_B]) {
      fs.writeFileSync(
        path.join(tasksDir, `${uid}.md`),
        md({ exo__Asset_uid: uid, exo__Asset_label: `Parent ${uid.slice(0, 8)}` }),
      );
    }
    fs.writeFileSync(
      movieAbs(),
      md({
        exo__Asset_uid: MOVIE_UID,
        exo__Asset_isDefinedBy: `"[[${ANCHOR_MOVIES}]]"`,
        exo__Asset_label: '"Chislo 23"',
        concept__Movie_watched: "false",
        exo__Asset_updatedAt: STALE_UPDATED_AT,
      }),
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
    bytes: Buffer;
    mtimeMs: number;
    echo: Record<string, unknown>;
    stderr: string;
  }

  /** Run the REAL set-property command under a frozen clock; capture the last JSON echo. */
  async function run(extraArgs: string[], clock: string): Promise<RunResult> {
    const stdoutBefore = stdoutChunks.length;
    const stderrBefore = stderrChunks.length;
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [moviePath, "--vault", vault, "--frozen-clock", clock, ...extraArgs],
      { from: "user" },
    );
    const lines = stdoutChunks
      .slice(stdoutBefore)
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean);
    const echo = lines.length > 0 ? (JSON.parse(lines[lines.length - 1]) as Record<string, unknown>) : {};
    const bytes = fs.readFileSync(movieAbs());
    return {
      exit: [...exitCodes],
      content: bytes.toString("utf-8"),
      bytes,
      mtimeMs: fs.statSync(movieAbs()).mtimeMs,
      echo,
      stderr: stderrChunks.slice(stderrBefore).join(""),
    };
  }

  /** Assert the fixture is in the "set once under clock A" state. */
  function expectStampedA(first: RunResult): void {
    expect(first.exit).toContain(0);
    expect(first.content).toContain(`exo__Asset_updatedAt: ${STAMP_A}`);
    expect(first.echo.changed).toBe(true);
    expect(first.echo.updatedAt).toBe(STAMP_A);
  }

  /** The full no-op post-condition against the bytes written by the first call. */
  function expectNoop(first: RunResult, second: RunResult): void {
    expect(second.exit).toContain(0);
    expect(second.exit).not.toContain(1);
    // Byte-identical to what the FIRST call wrote — updatedAt still A, not B.
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(second.content).toContain(`exo__Asset_updatedAt: ${STAMP_A}`);
    expect(second.content).not.toContain(STAMP_B);
    // Nothing was written at all: the deliberately old mtime survived.
    expect(second.mtimeMs).toBe(OLD_MTIME.getTime());
    // Echo contract (mirrors remove-property): changed:false, NO updatedAt field.
    expect(second.echo.changed).toBe(false);
    expect(second.echo).not.toHaveProperty("updatedAt");
    expect(second.stderr).toMatch(/no change/);
  }

  const scalarArgs = ["--property", "youtube__Video_channel", "--value", "Some Channel"];
  const arrayArgs = [
    "--input",
    JSON.stringify({
      property: "exo__Asset_relates",
      value: [`[[${PARENT_A}]]`, `[[${PARENT_B}]]`],
    }),
  ];

  it("N1: setting the same scalar again is a no-op (bytes, mtime, updatedAt untouched; changed:false; exit 0) @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const first = await run(scalarArgs, CLOCK_A);
    expectStampedA(first);
    expect(first.content).toMatch(/youtube__Video_channel: "?Some Channel"?\n/);

    fs.utimesSync(movieAbs(), OLD_MTIME, OLD_MTIME);
    const second = await run(scalarArgs, CLOCK_B);
    expectNoop(first, second);
  });

  it("N2: setting a DIFFERENT scalar value still bumps updatedAt (changed:true, updatedAt echoed) @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const first = await run(scalarArgs, CLOCK_A);
    expectStampedA(first);

    fs.utimesSync(movieAbs(), OLD_MTIME, OLD_MTIME);
    const second = await run(
      ["--property", "youtube__Video_channel", "--value", "Another Channel"],
      CLOCK_B,
    );
    expect(second.exit).toContain(0);
    expect(second.content).toMatch(/youtube__Video_channel: "?Another Channel"?\n/);
    expect(second.content).toContain(`exo__Asset_updatedAt: ${STAMP_B}`);
    expect(second.content).not.toContain(STAMP_A);
    expect(second.mtimeMs).not.toBe(OLD_MTIME.getTime());
    expect(second.echo.changed).toBe(true);
    expect(second.echo.updatedAt).toBe(STAMP_B);
    expect(second.stderr).not.toMatch(/no change/);
  });

  it("N3: setting the same --input array again (same order) is a no-op @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const first = await run(arrayArgs, CLOCK_A);
    expectStampedA(first);
    expect(first.content).toContain(`  - "[[${PARENT_A}]]"\n  - "[[${PARENT_B}]]"`);

    fs.utimesSync(movieAbs(), OLD_MTIME, OLD_MTIME);
    const second = await run(arrayArgs, CLOCK_B);
    expectNoop(first, second);
  });

  it("N3b: the same array in a DIFFERENT order is a change — updatedAt bumps @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const first = await run(arrayArgs, CLOCK_A);
    expectStampedA(first);

    fs.utimesSync(movieAbs(), OLD_MTIME, OLD_MTIME);
    const second = await run(
      [
        "--input",
        JSON.stringify({
          property: "exo__Asset_relates",
          value: [`[[${PARENT_B}]]`, `[[${PARENT_A}]]`],
        }),
      ],
      CLOCK_B,
    );
    expect(second.exit).toContain(0);
    expect(second.content).toContain(`  - "[[${PARENT_B}]]"\n  - "[[${PARENT_A}]]"`);
    expect(second.content).toContain(`exo__Asset_updatedAt: ${STAMP_B}`);
    expect(second.echo.changed).toBe(true);
    expect(second.echo.updatedAt).toBe(STAMP_B);
  });

  it("N1d: --dry-run on a no-op previews the UNCHANGED file (updatedAt A) and echoes changed:false @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const first = await run(scalarArgs, CLOCK_A);
    expectStampedA(first);

    fs.utimesSync(movieAbs(), OLD_MTIME, OLD_MTIME);
    const second = await run([...scalarArgs, "--dry-run"], CLOCK_B);
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
