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
const NO_TRAILING_NL_UID = "e5e5e5e5-0000-4000-8000-000000000005";
const UID_IN_BODY_UID = "a4a4a4a4-0000-4000-8000-000000000006";
const NO_FRONTMATTER_UID = "c3c3c3c3-0000-4000-8000-000000000007";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";

/** A body whose file does NOT end in a newline — 9.7 % of the live corpus. */
const NO_TRAILING_NL_BODY = "TAIL WITHOUT A NEWLINE";
/** A non-asset whose BODY carries the uid key — the whole-file guard's blind spot. */
const UID_IN_BODY_BODY =
  "Docs example:\n\n```yaml\nexo__Asset_uid: 11111111-2222-4333-8444-555555555555\n```\n";
/** No frontmatter block at all — pins the guard ORDER, not just the guard. */
const NO_FRONTMATTER_BODY = "PLAIN MARKDOWN WITH NO FENCE\n";

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
    // An asset whose file does NOT end in a newline (9.7 % of the live corpus).
    fs.writeFileSync(
      path.join(vault, `${TASKS_DIR}/${NO_TRAILING_NL_UID}.md`),
      `---\nexo__Asset_uid: ${NO_TRAILING_NL_UID}\nexo__Asset_label: "No trailing NL"\nexo__Asset_updatedAt: ${STALE_UPDATED_AT}\n---\n${NO_TRAILING_NL_BODY}`,
    );
    // A NON-asset whose frontmatter has no uid but whose BODY carries the key. A
    // guard testing the whole file would accept it and print the body; the shipped
    // guard tests the frontmatter block only.
    fs.writeFileSync(
      path.join(vault, `${TASKS_DIR}/${UID_IN_BODY_UID}.md`),
      `---\ntitle: docs page\n---\n${UID_IN_BODY_BODY}`,
    );
    // No frontmatter block and no uid — the only input on which the pre-fix guard
    // order (uid check first) and the shipped one (parse first) are distinguishable.
    fs.writeFileSync(
      path.join(vault, `${TASKS_DIR}/${NO_FRONTMATTER_UID}.md`),
      NO_FRONTMATTER_BODY,
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

  /**
   * SUCCESS is "process.exit was never called" — not "called with 0".
   *
   * The command must fall off the end of its action so the process ends naturally
   * and stdout DRAINS: `process.exit` does not wait for an asynchronous write, and
   * stdout is asynchronous whenever it is a pipe. Measured on the built bundle with
   * the largest live asset (424 964-byte body): to a file 424 964 bytes arrived,
   * through a pipe only 65 536. So this predicate is the in-jest half of the
   * truncation guard — restoring `process.exit(0)` reddens every success axis. The
   * delivered-bytes half needs a real process and lives in
   * get-body-9de09856-pipe.harness.ts (§A66: these axes see the intermediate
   * record, the harness sees the effect).
   */
  function expectNaturalExit(codes: number[]): void {
    expect(codes).toEqual([]);
  }

  /**
   * REFUSAL requires an actual non-zero code — ⛔ not `not.toContain(0)`, which is
   * also satisfied by "exit was never called" and would therefore pass on a command
   * that silently did nothing (§A38 — a negated predicate is satisfied by many
   * outcomes).
   */
  function expectRefused(codes: number[]): void {
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.some((c) => c !== 0)).toBe(true);
  }

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
    expectNaturalExit(got.exit);

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

  it("G1b round trip on a file with NO trailing newline: body survives, set-body normalises by exactly one \\n @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    // 4 490 of 46 164 live assets (9.7 %) have no trailing newline, so this is the
    // majority-adjacent case, not an edge one. The round trip is NOT a no-op here —
    // set-body appends the newline — and the requirement says so explicitly. What
    // MUST hold is that the body survives byte-for-byte as a prefix, and that the
    // normalisation is idempotent: the SECOND cycle is a no-op.
    const noNlPath = `${TASKS_DIR}/${NO_TRAILING_NL_UID}.md`;

    const first = await runGetBody(noNlPath);
    expectNaturalExit(first.exit);
    // The body came back exactly as it sits on disk — no trailing newline invented.
    expect(first.stdout).toBe(NO_TRAILING_NL_BODY);
    expect(first.stdout.endsWith("\n")).toBe(false);

    const bodyFile = path.join(vault, "no-nl-body.md");
    fs.writeFileSync(bodyFile, first.stdout);
    const back = await runSetBody(noNlPath, ["--body-file", bodyFile]);
    // set-body reports the change and appends exactly one newline — nothing else.
    expect(back.stdout).toContain('"changed":true');
    const afterWrite = fs.readFileSync(path.join(vault, noNlPath), "utf-8");

    const second = await runGetBody(noNlPath);
    expect(second.stdout.startsWith(first.stdout)).toBe(true);
    expect(second.stdout).toBe(`${NO_TRAILING_NL_BODY}\n`);

    // Idempotent: the second cycle IS a no-op.
    const bodyFile2 = path.join(vault, "no-nl-body-2.md");
    fs.writeFileSync(bodyFile2, second.stdout);
    const again = await runSetBody(noNlPath, ["--body-file", bodyFile2]);
    expect(again.stdout).toContain('"changed":false');
    expect(fs.readFileSync(path.join(vault, noNlPath), "utf-8")).toBe(afterWrite);
  });

  it("G2 prints ONLY the body — no frontmatter block @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    const got = await runGetBody(taskPath);

    expectNaturalExit(got.exit);
    expect(got.stdout).toBe(BODY_TEXT);
    expect(got.stdout).not.toContain("exo__Asset_uid");
    expect(got.stdout).not.toContain("---");
  });

  it("G3 a body-less asset prints nothing and exits 0 @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    const got = await runGetBody(emptyBodyPath);

    expect(got.stdout).toBe("");
    expectNaturalExit(got.exit);
  });

  it("G4 --json reports bodyBytes in UTF-8 BYTES, not UTF-16 units @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    const got = await runGetBody(cyrillicPath, ["--json"]);

    expectNaturalExit(got.exit);
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

    expectRefused(got.exit);
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

    expectRefused(got.exit);
    expect(got.stdout).toBe("");
    expect(got.stdout).not.toContain(NON_ASSET_BODY.trim());
    const messages = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(messages).toContain("Not a vault asset");
  });

  it("G7 reports a missing file by name @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    const got = await runGetBody(`${TASKS_DIR}/${NONEXISTENT_UID}.md`);

    expectRefused(got.exit);
    const messages = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(messages).toContain("Target file not found");
  });

  it("G8 is read-only on EVERY outcome — success and each refusal @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
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

    // The requirement says "любой из перечисленных исходов" — the REFUSAL paths are
    // part of the guarantee, and the happy path alone would leave them unlocked.
    const nonAsset = path.join(vault, notAnAssetPath);
    const nonAssetBefore = fs.readFileSync(nonAsset, "utf-8");
    const outsideBefore = fs.readFileSync(outsideAsset, "utf-8");

    await runGetBody(notAnAssetPath);
    await runGetBody(`../${path.basename(outsideAsset)}`);
    await runGetBody(`${TASKS_DIR}/${NONEXISTENT_UID}.md`);

    expect(fs.readFileSync(nonAsset, "utf-8")).toBe(nonAssetBefore);
    expect(fs.readFileSync(outsideAsset, "utf-8")).toBe(outsideBefore);
    // The missing file was not created as a side effect of being asked for.
    expect(fs.existsSync(path.join(vault, `${TASKS_DIR}/${NONEXISTENT_UID}.md`))).toBe(
      false,
    );
  });

  it("G12 refuses a file with NO frontmatter block, naming that as the reason @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    // Round-2 review: every other fixture begins with `---`, so NO axis reached the
    // `!parsed.exists` branch and nothing pinned the guard ORDER either — deleting
    // that guard, or swapping the two guards back, reddened nothing. This axis plus
    // the order mutant close that hole.
    const got = await runGetBody(`${TASKS_DIR}/${NO_FRONTMATTER_UID}.md`);

    expectRefused(got.exit);
    expect(got.stdout).toBe("");
    expect(got.stdout).not.toContain(NO_FRONTMATTER_BODY.trim());
    const messages = errorSpy.mock.calls.flat().map(String).join("\n");
    // The ORDER is what this pins: the file has no uid either, so the pre-fix order
    // would have answered "Not a vault asset" instead.
    expect(messages).toContain("No frontmatter block found");
  });

  it("G11 the asset check reads the FRONTMATTER, not the body @req:9de09856-ffd6-4add-aa7c-56985808dc87", async () => {
    // A guard testing the whole file is satisfied by an exo__Asset_uid line in the
    // BODY (a yaml fence in docs, a template skeleton) and would print a non-asset's
    // body. Live false-positive population is 0 of 46 164, so this locks a latent
    // hole — which is exactly the kind that reopens silently if nothing pins it.
    const got = await runGetBody(`${TASKS_DIR}/${UID_IN_BODY_UID}.md`);

    expectRefused(got.exit);
    expect(got.stdout).toBe("");
    expect(got.stdout).not.toContain("Docs example");
    const messages = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(messages).toContain("Not a vault asset");
  });

  it("G9 WIRING: get-body is registered in the real CLI program @req:9de09856-ffd6-4add-aa7c-56985808dc87", () => {
    const names = createProgram("0.0.0-test").commands.map((c) => c.name());

    expect(names).toContain("get-body");
    // Its write-side counterpart is registered too — the pair is the point.
    expect(names).toContain("set-body");
  });
});
