/**
 * Issue #4469 / req `2d072437-c19d-49a4-ae89-f20b6185571f` — the COMMAND
 * surface, end to end.
 *
 * The unit axes (`FrontmatterService.write-channels-4469`) pin the predicate and
 * the byte shape of the rewrite. This suite exists because those are the
 * INTERMEDIATE record, not the product: what #4469 is about is that a user
 * running `set-property` on a lone-CR / N-BOM asset got a SECOND frontmatter
 * block prepended and his own frontmatter demoted to body text — measured on the
 * published v17.7.13, 4 fence lines. So at least one axis drives the REAL
 * command against a real temp vault and judges the real bytes on disk
 * (integration-test-revert-verify §A66).
 *
 * Revert-verify — `set-property.write-channels-4469.spec.json`.
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
import * as os from "os";
import * as path from "path";

const { setPropertyCommand } =
  await import("../../src/commands/set-property.js");

const REQ = "@req:2d072437-c19d-49a4-ae89-f20b6185571f";
const BOM = "﻿";
const DIR = "assetspaces/kitelev/exoas-my/notes";
const ANCHOR = "a1a1a1a1-0000-4000-8000-000000000001";
const CLOCK = "2026-09-29T07:00:00Z";

/** Physical lines that are exactly `---`, BOM-insensitive. */
function fenceLines(content: string): number {
  return content
    .replace(/^﻿+/, "")
    .split(/\r\n|\r|\n/)
    .filter((line) => line === "---").length;
}

describe("set-property on a non-LF asset (#4469)", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-4469-"));
    fs.mkdirSync(path.join(vault, DIR), { recursive: true });
    fs.writeFileSync(
      path.join(vault, DIR, `${ANCHOR}.md`),
      `---\nexo__Asset_uid: ${ANCHOR}\nexo__Asset_label: concept__Notes\n---\nbody\n`,
    );

    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
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

  /** Seed one asset with EXACT bytes, run the real command, read the bytes back. */
  async function run(uid: string, bytes: string): Promise<string> {
    const rel = `${DIR}/${uid}.md`;
    fs.writeFileSync(path.join(vault, rel), bytes, "utf8");
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [
        rel,
        "--vault",
        vault,
        "--property",
        "smoke__marker",
        "--value",
        "set-by-4469",
        "--skip-wikilink-validation",
        "--frozen-clock",
        CLOCK,
      ],
      { from: "user" },
    );
    return fs.readFileSync(path.join(vault, rel), "utf8");
  }

  it(`CH30 ${REQ} lone-CR asset — ONE block after the write, every key intact, the body's bare CRs intact`, async () => {
    const uid = "11111111-1111-4111-8111-111111111111";
    const after = await run(
      uid,
      `---\rexo__Asset_uid: ${uid}\rexo__Asset_label: lone-CR 4469\rkeep__me: original\r---\rbody first\rbody second\r`,
    );

    expect(exitCodes).toEqual([]);
    expect(fenceLines(after)).toBe(2);
    expect(after).toContain("exo__Asset_label: lone-CR 4469");
    expect(after).toContain("keep__me: original");
    expect(after).toContain("smoke__marker: set-by-4469\r");
    expect(after).toContain("body first\rbody second\r");
    expect(after).not.toContain("\n");
  });

  it(`CH31 ${REQ} N-BOM asset — exactly ONE U+FEFF after the write, ONE block, keys intact`, async () => {
    const uid = "22222222-2222-4222-8222-222222222222";
    const after = await run(
      uid,
      `${BOM}${BOM}${BOM}---\nexo__Asset_uid: ${uid}\nkeep__me: original\n---\nbody\n`,
    );

    expect(exitCodes).toEqual([]);
    expect(after.length - after.replace(/^﻿+/, "").length).toBe(1);
    expect(fenceLines(after)).toBe(2);
    expect(after).toContain("keep__me: original");
    expect(after).toContain("smoke__marker: set-by-4469");
  });

  it(`CH32 ${REQ} CRLF asset — ONE block, CRLF preserved, no lone LF introduced`, async () => {
    const uid = "44444444-4444-4444-8444-444444444444";
    const after = await run(
      uid,
      `---\r\nexo__Asset_uid: ${uid}\r\nkeep__me: original\r\n---\r\nbody\r\n`,
    );

    expect(exitCodes).toEqual([]);
    expect(fenceLines(after)).toBe(2);
    expect(after).toContain("smoke__marker: set-by-4469\r\n");
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it(`CH33 ${REQ} CONTROL — the LF asset is untouched apart from the written property and the stamp`, async () => {
    const uid = "33333333-3333-4333-8333-333333333333";
    const before = `---\nexo__Asset_uid: ${uid}\nkeep__me: original\n---\nbody\n`;
    const after = await run(uid, before);

    expect(exitCodes).toEqual([]);
    expect(fenceLines(after)).toBe(2);
    const removed = before
      .split("\n")
      .filter((line) => !after.split("\n").includes(line));
    expect(removed).toEqual([]);
    const added = after
      .split("\n")
      .filter((line) => !before.split("\n").includes(line));
    expect(
      added.every(
        (line) =>
          line.startsWith("smoke__marker:") ||
          line.startsWith("exo__Asset_updatedAt:"),
      ),
    ).toBe(true);
  });
});
