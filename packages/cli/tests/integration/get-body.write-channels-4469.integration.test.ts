/**
 * Issue #4469 / req `2d072437-c19d-49a4-ae89-f20b6185571f` — the READER half of
 * the same caller class as `set-body`.
 *
 * `get-body` located the end of the frontmatter block by the LENGTH of a
 * hand-rebuilt `` `---\n${parse(original).content}\n---` ``. That length equals
 * the real one only for an LF file with no BOM, so once #4469 widened `parse()`
 * the command started printing part of the file's OWN frontmatter as its body —
 * exit code 0, no diagnostic. Measured on the branch dist before the fix, with
 * the real body being `THE REAL BODY`:
 *
 *   CRLF    → "--\r\nTHE REAL BODY"   (two dashes of the closing fence leaked)
 *   lone-CR → "\rTHE REAL BODY"
 *   3×BOM   → "---\nTHE REAL BODY"    (the whole closing fence)
 *
 * On `main` (17.7.14) the same fixtures exit 1 — a fail-loud refusal. So this
 * work item, left as it was, would have converted a safe refusal into silent
 * corruption on a second command.
 *
 * Revert-verify — `get-body.write-channels-4469.spec.json`.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const { getBodyCommand } = await import("../../src/commands/get-body.js");

const REQ = "@req:2d072437-c19d-49a4-ae89-f20b6185571f";
const BOM = "﻿";
const DIR = "assetspaces/kitelev/exoas-my/notes";

describe("get-body on a non-LF asset (#4469)", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdout: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-4469-gb-"));
    fs.mkdirSync(path.join(vault, DIR), { recursive: true });
    stdout = [];
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        stdout.push(String(chunk));
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

  /** Seed exact bytes, run the REAL command with --json, return the body field. */
  async function bodyOf(uid: string, bytes: string): Promise<string> {
    const rel = `${DIR}/${uid}.md`;
    fs.writeFileSync(path.join(vault, rel), bytes, "utf8");
    stdout.length = 0;
    const cmd = getBodyCommand();
    await cmd.parseAsync([rel, "--vault", vault, "--json"], { from: "user" });
    const line = stdout.join("").trim();
    return (JSON.parse(line) as { body: string }).body;
  }

  it(`CH60 ${REQ} a lone-CR asset yields its body, with no part of the closing fence`, async () => {
    const uid = "11111111-1111-4111-8111-111111111111";
    const body = await bodyOf(
      uid,
      `---\rexo__Asset_uid: ${uid}\rkeep__me: original\r---\rTHE REAL BODY\r`,
    );

    expect(exitCodes).toEqual([]);
    expect(body).toBe("THE REAL BODY\r");
    expect(body).not.toContain("-");
  });

  it(`CH61 ${REQ} a CRLF asset yields its body — the two dashes that used to leak are gone`, async () => {
    const uid = "44444444-4444-4444-8444-444444444444";
    const body = await bodyOf(
      uid,
      `---\r\nexo__Asset_uid: ${uid}\r\nkeep__me: original\r\n---\r\nTHE REAL BODY\r\n`,
    );

    expect(exitCodes).toEqual([]);
    expect(body).toBe("THE REAL BODY\r\n");
    expect(body.startsWith("-")).toBe(false);
  });

  it(`CH62 ${REQ} a RUN-of-BOM asset yields its body, not its closing fence`, async () => {
    const uid = "22222222-2222-4222-8222-222222222222";
    const body = await bodyOf(
      uid,
      `${BOM}${BOM}${BOM}---\nexo__Asset_uid: ${uid}\n---\nTHE REAL BODY\n`,
    );

    expect(exitCodes).toEqual([]);
    expect(body).toBe("THE REAL BODY\n");
    expect(body).not.toContain("---");
  });

  it(`CH63 ${REQ} CONTROL — the LF asset, and a file that ends at the closing fence`, async () => {
    const uid = "33333333-3333-4333-8333-333333333333";
    expect(
      await bodyOf(uid, `---\nexo__Asset_uid: ${uid}\n---\nTHE REAL BODY\n`),
    ).toBe("THE REAL BODY\n");

    const uid2 = "55555555-5555-4555-8555-555555555555";
    expect(await bodyOf(uid2, `---\nexo__Asset_uid: ${uid2}\n---`)).toBe("");
    expect(exitCodes).toEqual([]);
  });
});
