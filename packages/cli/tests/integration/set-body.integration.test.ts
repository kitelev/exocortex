/**
 * Issue #3943 — `exocortex set-body <path>` overwrites the markdown BODY of an
 * existing vault asset (frontmatter block byte-identical except an
 * exo__Asset_updatedAt bump), validating wikilinks in the new body, refusing a
 * non-asset. The dogfood body-rewrite path — no raw backup→rm→Write.
 *
 * Drives the REAL `setBodyCommand()` action end-to-end against a temp fixture
 * vault, reads the written file back from disk, and asserts on the real bytes —
 * the production pipeline (FrontmatterService.parse + updateProperty +
 * WikilinkValidator), not hand-injected content (test-fixture-realism).
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md) —
 * THREE independent axes in `set-body.ts`, each reddening exactly its own
 * assertion when Edit-broken and GREEN when restored:
 *   1. body replacement — neutralise `newBody` (force `= ""` / keep original)
 *      → the body-replaced assertions RED.
 *   2. updatedAt bump   — neutralise the `updateProperty(UPDATED_AT_KEY)` call
 *      → the updatedAt-bump assertion RED.
 *   3. wikilink validate — neutralise the `validateValue(newBody)` call → the
 *      invalid-wikilink refusal RED (the file would be written).
 * The non-asset refusal + valid-wikilink happy path isolate non-vacuity.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { setBodyCommand } = await import("../../src/commands/set-body.js");

const TASKS_DIR = "assetspaces/kitelev/exoas-my/tasks";

const TASK_UID = "c1c1c1c1-0000-4000-8000-000000000001";
const TARGET_UID = "d2d2d2d2-0000-4000-8000-000000000002";
const NONEXISTENT_UID = "eeeeeeee-0000-4000-8000-000000000009";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";

/** Frozen-clock instant → 2026-07-30T15:00:00 rendered in Asia/Almaty (UTC+5). */
const FROZEN_CLOCK = "2026-07-30T10:00:00Z";
const EXPECTED_UPDATED_AT = "2026-07-30T15:00:00";

describe("Issue #3943: `cli set-body` overwrites the markdown body of an existing asset", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let exitCodes: number[];

  const taskPath = `${TASKS_DIR}/${TASK_UID}.md`;
  // A vault asset with frontmatter (incl. a STALE updatedAt) + an old body.
  const originalContent =
    `---\n` +
    `exo__Asset_uid: ${TASK_UID}\n` +
    `exo__Asset_label: "A task"\n` +
    `exo__Asset_updatedAt: ${STALE_UPDATED_AT}\n` +
    `---\n` +
    `OLD BODY LINE 1\nOLD BODY LINE 2\n`;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3943-"));
    const tasksDir = path.join(vault, TASKS_DIR);
    fs.mkdirSync(tasksDir, { recursive: true });

    fs.writeFileSync(path.join(vault, taskPath), originalContent);
    // A resolvable target for a valid [[uuid]] body wikilink.
    fs.writeFileSync(
      path.join(tasksDir, `${TARGET_UID}.md`),
      `---\nexo__Asset_uid: ${TARGET_UID}\nexo__Asset_label: "Target"\n---\nbody\n`,
    );
    // A bare markdown file (NO exo__Asset_uid) — set-body must refuse it.
    fs.writeFileSync(
      path.join(tasksDir, "not-an-asset.md"),
      `# Just notes\n\nno frontmatter here\n`,
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
  });

  /** Run the real set-body command; returns exit codes + on-disk content. */
  async function runSetBody(
    relPath: string,
    extraArgs: string[],
  ): Promise<{ exit: number[]; content: string }> {
    const cmd = setBodyCommand();
    await cmd.parseAsync(
      [relPath, "--vault", vault, "--frozen-clock", FROZEN_CLOCK, ...extraArgs],
      { from: "user" },
    );
    const abs = path.join(vault, relPath);
    const content = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "";
    return { exit: [...exitCodes], content };
  }

  it("overwrites the body, preserves frontmatter, bumps updatedAt @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const bodyFile = path.join(vault, "new-body.md");
    fs.writeFileSync(bodyFile, "BRAND NEW BODY\nsecond line\n");

    const out = await runSetBody(taskPath, ["--body-file", bodyFile]);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);
    // New body present, old body gone.
    expect(out.content).toContain("BRAND NEW BODY");
    expect(out.content).toContain("second line");
    expect(out.content).not.toContain("OLD BODY LINE 1");
    expect(out.content).not.toContain("OLD BODY LINE 2");
    // Frontmatter keys preserved.
    expect(out.content).toContain(`exo__Asset_uid: ${TASK_UID}`);
    expect(out.content).toContain(`exo__Asset_label: "A task"`);
    // updatedAt bumped away from the stale value.
    expect(out.content).toContain(`exo__Asset_updatedAt: ${EXPECTED_UPDATED_AT}`);
    expect(out.content).not.toContain(STALE_UPDATED_AT);
  });

  it("accepts a valid [[uuid]] wikilink in the new body @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const out = await runSetBody(taskPath, [
      "--body",
      `See [[${TARGET_UID}]] for context.`,
    ]);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);
    expect(out.content).toContain(`[[${TARGET_UID}]]`);
    expect(out.content).not.toContain("OLD BODY LINE 1");
  });

  it("rejects an invalid wikilink in the new body, leaving the file byte-unchanged @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const out = await runSetBody(taskPath, [
      "--body",
      `Broken [[${NONEXISTENT_UID}]] link.`,
    ]);

    // Handled via ErrorHandler → non-zero exit; the file must be untouched.
    expect(out.exit).not.toContain(0);
    expect(out.content).toBe(originalContent);
    expect(out.content).toContain("OLD BODY LINE 1");
    expect(out.content).not.toContain(NONEXISTENT_UID);
  });

  it("refuses a non-asset (no exo__Asset_uid) @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const before = fs.readFileSync(
      path.join(vault, `${TASKS_DIR}/not-an-asset.md`),
      "utf-8",
    );
    const out = await runSetBody(`${TASKS_DIR}/not-an-asset.md`, [
      "--body",
      "should not be written",
    ]);

    expect(out.exit).not.toContain(0);
    // File byte-unchanged; the refused body never landed.
    expect(out.content).toBe(before);
    expect(out.content).not.toContain("should not be written");
    const stderrLog = errorSpy.mock.calls.flat().join("\n");
    expect(stderrLog).toMatch(/not a vault asset/i);
  });

  // ⛔ The body MUST be multi-byte. With ASCII, String.length === Buffer.byteLength, so
  // this axis would pass under BOTH the broken and the fixed implementation — vacuous,
  // and vacuous in the direction that reads as coverage. Cyrillic makes the two disagree
  // by ~1.5x, which is exactly the ratio that made the field look like data loss in the
  // first place (a 31,007-byte body was reported as 19,980).
  it("reports bodyBytes in BYTES, not UTF-16 code units @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const body = "Тело на кириллице\nвторая строка\n";
    const bodyFile = path.join(vault, "cyrillic-body.md");
    fs.writeFileSync(bodyFile, body, "utf-8");

    const out = await runSetBody(taskPath, ["--body-file", bodyFile]);
    expect(out.exit).toContain(0);

    const echo = JSON.parse(
      stdoutChunks.join("").trim().split("\n").filter(Boolean).pop() as string,
    );
    const asBytes = Buffer.byteLength(body, "utf8");
    const asCodeUnits = body.length;

    // Guard the guard: if these ever coincide the assertion below proves nothing.
    expect(asBytes).toBeGreaterThan(asCodeUnits);

    expect(echo.bodyBytes).toBe(asBytes);
    expect(echo.bodyBytes).not.toBe(asCodeUnits);
  });

  // ⛔ A literal backslash-n in a FILE body is authored text — a regex in prose, a
  // Windows path — not an escape to expand. Expanding it silently corrupts the
  // document: measured on this very fixture, the pre-fix write produced 4 lines and
  // 0 backslashes from 2 lines and 2 backslashes, and nothing reported it.
  it("preserves a literal backslash-n from --body-file @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const bodyFile = path.join(vault, "literal-escapes.md");
    fs.writeFileSync(bodyFile, "regex `\\n` and path C:\\new\nsecond line\n");

    const out = await runSetBody(taskPath, ["--body-file", bodyFile]);

    expect(out.exit).toContain(0);
    const body = out.content.split("---")[2];
    // The two backslash sequences survive verbatim...
    expect(body).toContain("C:\\new");
    expect(body).toContain("`\\n`");
    // ...and the file's real line count is unchanged (4 lines here means expansion).
    expect(body.trim().split("\n")).toHaveLength(2);
  });

  // The paired axis, and the one that stops the fix from over-reaching: issue #2288
  // asked for exactly this — a single shell argument cannot carry a real newline, so
  // the INLINE form must keep expanding. Drop the `source === "inline"` branch and
  // this goes RED while the axis above stays green.
  it("still expands backslash-n for the INLINE --body form (issue #2288) @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const out = await runSetBody(taskPath, ["--body", "Line1\\nLine2"]);

    expect(out.exit).toContain(0);
    const body = out.content.split("---")[2];
    expect(body.trim().split("\n")).toHaveLength(2);
    expect(body).not.toContain("Line1\\nLine2");
  });

  it("--dry-run previews the result without writing @req:664123d3-5b91-4793-8085-485d48471546", async () => {
    const out = await runSetBody(taskPath, [
      "--body",
      "PREVIEW ONLY BODY",
      "--dry-run",
    ]);

    expect(out.exit).toContain(0);
    // The file on disk is unchanged (dry-run wrote nothing).
    expect(out.content).toBe(originalContent);
    expect(out.content).toContain("OLD BODY LINE 1");
  });
});
