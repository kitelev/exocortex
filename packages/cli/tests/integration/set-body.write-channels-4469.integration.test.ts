/**
 * Issue #4469 / req `2d072437-c19d-49a4-ae89-f20b6185571f` — the CALLERS of the
 * widened predicate, not the predicate itself.
 *
 * `set-body` asked `FrontmatterService.parse()` for the block's BODY and then
 * rebuilt the block by hand: `` `---\n${parsed.content}\n---` `` — a hardcoded
 * LF on both fences and no BOM at all. That was harmless only while `parse()`
 * refused every non-LF shape: the command threw "No frontmatter block found"
 * and left the file alone. Widening `parse()` (the point of #4469) turned that
 * dead branch HOT, so the first edition of this work item SHIPPED a regression
 * into a second command. Measured through the real command before the fix:
 *
 *   lone-CR asset → `---\n…\rkeep__me: original\n---\n…`  (one block, two styles)
 *   2-BOM asset   → BOM gone
 *   CRLF asset    → `---\n…\r\nkeep__me: original\n---\n…`
 *
 * The fix gives the block's bytes ONE owner: `FrontmatterService.leadingBlock`.
 *
 * Revert-verify — `set-body.write-channels-4469.spec.json`.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const { setBodyCommand } = await import("../../src/commands/set-body.js");

const REQ = "@req:2d072437-c19d-49a4-ae89-f20b6185571f";
const BOM = "﻿";
const DIR = "assetspaces/kitelev/exoas-my/notes";
const CLOCK = "2026-09-29T07:00:00Z";

function eolProfile(content: string): {
  crlf: number;
  cr: number;
  lf: number;
} {
  const crlf = (content.match(/\r\n/g) ?? []).length;
  return {
    crlf,
    cr: (content.match(/\r/g) ?? []).length - crlf,
    lf: (content.match(/\n/g) ?? []).length - crlf,
  };
}

describe("set-body on a non-LF asset (#4469)", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-4469-sb-"));
    fs.mkdirSync(path.join(vault, DIR), { recursive: true });
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as never);
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

  async function run(uid: string, bytes: string): Promise<string> {
    const rel = `${DIR}/${uid}.md`;
    fs.writeFileSync(path.join(vault, rel), bytes, "utf8");
    const cmd = setBodyCommand();
    await cmd.parseAsync(
      [
        rel,
        "--vault",
        vault,
        "--body",
        "new body text",
        "--skip-wikilink-validation",
        "--frozen-clock",
        CLOCK,
      ],
      { from: "user" },
    );
    return fs.readFileSync(path.join(vault, rel), "utf8");
  }

  it(`CH40 ${REQ} set-body on a lone-CR asset keeps the block's own line endings — no LF is introduced into it`, async () => {
    const uid = "11111111-1111-4111-8111-111111111111";
    const after = await run(
      uid,
      `---\rexo__Asset_uid: ${uid}\rkeep__me: original\r---\rold body\r`,
    );

    expect(exitCodes).toEqual([]);
    expect(after).toContain("keep__me: original");
    expect(after).toContain("new body text");
    // Every byte of the block, fences included, is still CR-terminated.
    const block = after.slice(0, after.indexOf("---", 3) + 3);
    // ⛔ Asserted as ABSOLUTE zeros, not against a value read back from the same
    // string — `cr: eolProfile(block).cr` would be true of any input.
    expect(eolProfile(block).lf).toBe(0);
    expect(eolProfile(block).crlf).toBe(0);
    expect(eolProfile(block).cr).toBeGreaterThan(2);
    expect(block).toContain(`---\rexo__Asset_uid: ${uid}\r`);
    expect(block.endsWith("---")).toBe(true);
  });

  it(`CH41 ${REQ} set-body on a RUN-of-BOM asset keeps exactly ONE U+FEFF`, async () => {
    const uid = "22222222-2222-4222-8222-222222222222";
    const after = await run(
      uid,
      `${BOM}${BOM}---\nexo__Asset_uid: ${uid}\nkeep__me: original\n---\nold body\n`,
    );

    expect(exitCodes).toEqual([]);
    expect(after.length - after.replace(/^﻿+/, "").length).toBe(1);
    expect(after).toContain("keep__me: original");
    expect(after).toContain("new body text");
  });

  it(`CH42 ${REQ} set-body on a CRLF asset introduces no lone LF into the block or after the closing fence`, async () => {
    const uid = "44444444-4444-4444-8444-444444444444";
    const after = await run(
      uid,
      `---\r\nexo__Asset_uid: ${uid}\r\nkeep__me: original\r\n---\r\nold body\r\n`,
    );

    expect(exitCodes).toEqual([]);
    const upToBody = after.slice(0, after.indexOf("new body text"));
    expect(eolProfile(upToBody).lf).toBe(0);
    expect(eolProfile(upToBody).cr).toBe(0);
    expect(upToBody).toContain(`---\r\nexo__Asset_uid: ${uid}\r\n`);
    // the separator between the closing fence and the body is the file's own
    expect(upToBody.endsWith("---\r\n")).toBe(true);
  });

  it(`CH43 ${REQ} CONTROL — the pure-LF asset is unchanged in shape`, async () => {
    const uid = "33333333-3333-4333-8333-333333333333";
    const after = await run(
      uid,
      `---\nexo__Asset_uid: ${uid}\nkeep__me: original\n---\nold body\n`,
    );

    expect(exitCodes).toEqual([]);
    expect(eolProfile(after).crlf).toBe(0);
    expect(eolProfile(after).cr).toBe(0);
    expect(after.startsWith(`---\nexo__Asset_uid: ${uid}\n`)).toBe(true);
    expect(after).toContain("new body text\n");
  });
});
