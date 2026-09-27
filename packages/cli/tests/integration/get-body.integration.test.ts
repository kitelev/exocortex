/**
 * Requirement 9de09856-ffd6-4add-aa7c-56985808dc87 — `exocortex get-body <path>`
 * prints the markdown BODY of an existing vault asset to stdout. The READ
 * counterpart of `set-body` (#3943), which had none: the CLI could overwrite a
 * body but never read one, so appending a paragraph meant rewriting the whole
 * body from memory (measured on the personal Telegram assistant, 2026-09-27 —
 * its cwd sits outside the vault and the graph carries no body prose, so it had
 * NO read channel at all).
 *
 * Drives the REAL `getBodyCommand()` action end-to-end against a temp fixture
 * vault and asserts on the real bytes it writes to stdout — and, for the
 * load-bearing axis, feeds that output back through the REAL `setBodyCommand()`
 * (test-fixture-realism: the round trip is exercised by the production pipeline,
 * not by a hand-built string comparison).
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md) —
 * independent axes in `get-body.ts`, each reddening exactly its own assertion:
 *   G1 round trip (LOAD-BEARING) — shift the cut by one char, or drop the
 *      separator-newline strip, or append a newline to the raw output → RED.
 *      This one axis locks the cut position, the newline semantics AND the fact
 *      that the output is usable as set-body input.
 *   G2 body-only output — keep the frontmatter in the slice → RED.
 *   G3 empty body        — emit anything for a body-less asset → RED.
 *   G4 bodyBytes in UTF-8 bytes — swap Buffer.byteLength for String.length → RED
 *      (Cyrillic fixture: the two disagree by ~1.5x).
 *   G5 outside-vault guard  — remove the guard → RED.
 *   G6 non-asset guard      — remove the exo__Asset_uid check → RED.
 *   G7 missing-file message — remove the ENOENT branch → RED.
 *   G8 read-only            — write anything to the target → RED.
 *   G9 WIRING — `get-body` registered in the real createProgram() registry.
 *      Axes G1-G8 call getBodyCommand() directly, so they stay GREEN if the verb
 *      is never registered; G9 is the only one that reddens when the
 *      `program.addCommand(getBodyCommand())` line is deleted.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { getBodyCommand } = await import("../../src/commands/get-body.js");
const { setBodyCommand } = await import("../../src/commands/set-body.js");
const { createProgram } = await import("../../src/program.js");

const TASKS_DIR = "assetspaces/kitelev/exoas-my/tasks";

const TASK_UID = "a9a9a9a9-0000-4000-8000-000000000001";
const EMPTY_BODY_UID = "b8b8b8b8-0000-4000-8000-000000000002";
const CYRILLIC_UID = "c7c7c7c7-0000-4000-8000-000000000003";
const NONEXISTENT_UID = "f0f0f0f0-0000-4000-8000-000000000009";
const OUTSIDE_UID = "d6d6d6d6-0000-4000-8000-000000000004";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";

/** Bodies that must NEVER reach stdout — the guards are what keep them out. */
const NON_ASSET_BODY = "BODY OF A NON ASSET\n";
const OUTSIDE_BODY = "BODY FROM OUTSIDE THE VAULT\n";

/** Frozen-clock instant → 2026-09-27T15:00:00 rendered in Asia/Almaty (UTC+5). */
const FROZEN_CLOCK = "2026-09-27T10:00:00Z";

/** The body of the main fixture, byte-for-byte as it sits on disk. */
const BODY_TEXT = "OLD BODY LINE 1\nOLD BODY LINE 2\n";

/**
 * Cyrillic body: 30 Cyrillic letters + punctuation. Every Cyrillic code point is
 * 2 bytes in UTF-8 and 1 UTF-16 unit, so byteLength and .length MUST differ —
 * that gap is what axis G4 pins.
 */
const CYRILLIC_BODY = "Наули минимизирует запоры и рак кишечника.\n";

describe("req 9de09856: `cli get-body` prints the body of an existing asset", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let exitCodes: number[];
  let outsideAsset: string;

  const taskPath = `${TASKS_DIR}/${TASK_UID}.md`;
  const emptyBodyPath = `${TASKS_DIR}/${EMPTY_BODY_UID}.md`;
  const cyrillicPath = `${TASKS_DIR}/${CYRILLIC_UID}.md`;
  const notAnAssetPath = `${TASKS_DIR}/not-an-asset.md`;

  const frontmatter =
    `---\n` +
    `exo__Asset_uid: ${TASK_UID}\n` +
    `exo__Asset_label: "A task"\n` +
    `exo__Asset_updatedAt: ${STALE_UPDATED_AT}\n` +
    `---\n`;
  const originalContent = frontmatter + BODY_TEXT;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-9de09856-"));
    const tasksDir = path.join(vault, TASKS_DIR);
    fs.mkdirSync(tasksDir, { recursive: true });

    fs.writeFileSync(path.join(vault, taskPath), originalContent);
    // An asset whose frontmatter is followed by NOTHING — a legitimate state.
    fs.writeFileSync(
      path.join(vault, emptyBodyPath),
      `---\nexo__Asset_uid: ${EMPTY_BODY_UID}\nexo__Asset_label: "Bodyless"\n---\n`,
    );
    // Cyrillic prose, for the bodyBytes-in-UTF-8-bytes axis.
    fs.writeFileSync(
      path.join(vault, cyrillicPath),
      `---\nexo__Asset_uid: ${CYRILLIC_UID}\nexo__Asset_label: "Наули"\n---\n${CYRILLIC_BODY}`,
    );
    // A markdown file WITH a frontmatter block but NO exo__Asset_uid. It carries
    // a readable body on purpose: with the uid guard removed the command would
    // happily print that body, so axis G6 reddens on the OUTPUT and not merely on
    // a non-zero exit (which the "no frontmatter block" branch would produce too
    // — integration-test-revert-verify §A38: a negated predicate is satisfied by
    // MANY outcomes).
    fs.writeFileSync(
      path.join(vault, notAnAssetPath),
      `---\ntitle: just notes\n---\n${NON_ASSET_BODY}`,
    );
    // A VALID asset one level ABOVE the vault. The outside-vault guard is the only
    // thing standing between get-body and this file: remove the guard and the read
    // SUCCEEDS, so axis G5 reddens on the printed body. Were the target merely
    // absent, the ENOENT branch would also exit non-zero and G5 would be vacuous.
    outsideAsset = path.join(path.dirname(vault), `outside-${path.basename(vault)}.md`);
    fs.writeFileSync(
      outsideAsset,
      `---\nexo__Asset_uid: ${OUTSIDE_UID}\nexo__Asset_label: "Outside"\n---\n${OUTSIDE_BODY}`,
    );

    stdoutChunks = [];
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
      .mockImplementation((() => true) as never);
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
    fs.rmSync(outsideAsset, { force: true });
  });

  /** Run the real get-body command; returns its exit codes + captured stdout. */
  async function runGetBody(
    relPath: string,
    extraArgs: string[] = [],
  ): Promise<{ exit: number[]; stdout: string }> {
    stdoutChunks = [];
    exitCodes = [];
    const cmd = getBodyCommand();
    await cmd.parseAsync([relPath, "--vault", vault, ...extraArgs], {
      from: "user",
    });
    return { exit: [...exitCodes], stdout: stdoutChunks.join("") };
  }

  /** Run the real set-body command; returns its exit codes + captured stdout. */
  async function runSetBody(
    relPath: string,
    extraArgs: string[],
  ): Promise<{ exit: number[]; stdout: string }> {
    stdoutChunks = [];
    exitCodes = [];
    const cmd = setBodyCommand();
    await cmd.parseAsync(
      [relPath, "--vault", vault, "--frozen-clock", FROZEN_CLOCK, ...extraArgs],
      { from: "user" },
    );
    return { exit: [...exitCodes], stdout: stdoutChunks.join("") };
  }

  it("G1 round trip: its output fed back through set-body is a no-op @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    const got = await runGetBody(taskPath);
    expect(got.exit).toContain(0);

    // Hand the captured body back to set-body EXACTLY as received — the same
    // path a caller takes for read → modify → write.
    const roundTripFile = path.join(vault, "round-trip-body.md");
    fs.writeFileSync(roundTripFile, got.stdout);

    const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");
    const back = await runSetBody(taskPath, ["--body-file", roundTripFile]);
    const after = fs.readFileSync(path.join(vault, taskPath), "utf-8");

    // set-body itself reports the no-op, and the file is byte-identical: the two
    // verbs cut the frontmatter/body boundary at the same place.
    expect(back.stdout).toContain('"changed":false');
    expect(after).toBe(before);
    expect(after).toContain(`exo__Asset_updatedAt: ${STALE_UPDATED_AT}`);
  });

  it("G2 prints ONLY the body — no frontmatter block @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    const got = await runGetBody(taskPath);

    expect(got.exit).toContain(0);
    expect(got.stdout).toBe(BODY_TEXT);
    expect(got.stdout).not.toContain("exo__Asset_uid");
    expect(got.stdout).not.toContain("---");
  });

  it("G3 a body-less asset prints nothing and exits 0 @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    const got = await runGetBody(emptyBodyPath);

    expect(got.stdout).toBe("");
    expect(got.exit).toContain(0);
    expect(got.exit).not.toContain(1);
  });

  it("G4 --json reports bodyBytes in UTF-8 BYTES, not UTF-16 units @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    const got = await runGetBody(cyrillicPath, ["--json"]);

    expect(got.exit).toContain(0);
    const parsed = JSON.parse(got.stdout) as {
      path: string;
      bodyBytes: number;
      body: string;
    };
    expect(parsed.path).toBe(cyrillicPath);
    expect(parsed.body).toBe(CYRILLIC_BODY);
    expect(parsed.bodyBytes).toBe(Buffer.byteLength(CYRILLIC_BODY, "utf8"));
    // The fixture is chosen so the two measures genuinely disagree — otherwise
    // this axis would pass under String.length too (vacuous).
    expect(parsed.bodyBytes).not.toBe(CYRILLIC_BODY.length);
  });

  it("G5 refuses a target outside the vault @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    // The target is a READABLE valid asset — only the guard keeps it out, so this
    // axis pins the guard rather than "some refusal happened".
    const got = await runGetBody(`../${path.basename(outsideAsset)}`);

    expect(got.exit).not.toContain(0);
    expect(got.stdout).toBe("");
    expect(got.stdout).not.toContain(OUTSIDE_BODY.trim());
    const messages = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(messages).toContain("outside the vault");
  });

  it("G6 refuses a markdown file that is not an asset @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    // The file HAS a frontmatter block and a readable body: without the
    // exo__Asset_uid guard the body would be printed, so the axis reddens on the
    // output too — not only on the exit code, which the "no frontmatter block"
    // branch would also produce.
    const got = await runGetBody(notAnAssetPath);

    expect(got.exit).not.toContain(0);
    expect(got.stdout).toBe("");
    expect(got.stdout).not.toContain(NON_ASSET_BODY.trim());
    const messages = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(messages).toContain("Not a vault asset");
  });

  it("G7 reports a missing file by name @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    const got = await runGetBody(`${TASKS_DIR}/${NONEXISTENT_UID}.md`);

    expect(got.exit).not.toContain(0);
    const messages = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(messages).toContain("Target file not found");
  });

  it("G8 is read-only: the asset is left byte-identical @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    const abs = path.join(vault, taskPath);
    const before = fs.readFileSync(abs, "utf-8");
    const statBefore = fs.statSync(abs);

    await runGetBody(taskPath);
    await runGetBody(taskPath, ["--json"]);

    expect(fs.readFileSync(abs, "utf-8")).toBe(before);
    expect(fs.statSync(abs).size).toBe(statBefore.size);
    // No stamp: the stale updatedAt survives a read.
    expect(fs.readFileSync(abs, "utf-8")).toContain(
      `exo__Asset_updatedAt: ${STALE_UPDATED_AT}`,
    );
  });

  it("G9 WIRING: get-body is registered in the real CLI program @req:9de09856-ffd6-4add-aa7c-56985808dc87", () => {
    const names = createProgram("0.0.0-test").commands.map((c) => c.name());

    expect(names).toContain("get-body");
    // Its write-side counterpart is registered too — the pair is the point.
    expect(names).toContain("set-body");
  });
});
