/**
 * Integration test for ems__Bug bcc041d8 — `query <path>` printed the content
 * of an arbitrary file inside the SPARQL error.
 *
 * `loadQuery` reads the positional argument as a FILE when it names an existing
 * path and carries no SELECT/CONSTRUCT/INSERT/DELETE. When the content is not
 * SPARQL, the parser message and the enhancer's context lines quote it — so the
 * caller saw the file. Bot wrappers deny the Read tool on secrets, but the CLI
 * reads the file itself, so `query <token file>` bypassed that deny.
 *
 * The fix keeps the file-query form (`query q.sparql` still works) and reports
 * a failed file query by type + position only. Every axis drives the REAL
 * `sparqlQueryCommand()` in-process (real core parser via moduleNameMapper)
 * against a real temp vault, with a synthetic canary file — no real secret is
 * ever read.
 *
 * Revert-verify: drop the `sourceFile` branches in sparql-query.ts → F1–F5 RED
 * (the canary reaches stdout/stderr); F6–F8 stay GREEN (unchanged behaviour).
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
// Default import (mutable CJS exports) so jest.spyOn(os, "homedir") works.
import os from "os";

const { sparqlQueryCommand } =
  await import("../../src/commands/sparql-query.js");

const CANARY_1 = "FAKE-CANARY-bcc041d8-line1";
const CANARY_2 = "FAKE-CANARY-bcc041d8-line2";

class ExitSignal extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe("query <file>: errors never echo the file content (ems__Bug bcc041d8)", () => {
  let vaultDir: string;
  let workDir: string;
  let homeDir: string;
  let secretFile: string;
  let output: string[];
  let exitCodes: (number | undefined)[];
  let originalCwd: string;

  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-bcc041d8-vault-"));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-bcc041d8-work-"));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-bcc041d8-home-"));
    fs.writeFileSync(
      path.join(vaultDir, "asset-1.md"),
      `---\nexo__Asset_label: "Asset One"\nexo__Instance_class: "[[ems__Task]]"\n---\n`,
    );
    // Synthetic secret: two lines, neither of them SPARQL.
    secretFile = path.join(workDir, "fake-secret.json");
    fs.writeFileSync(secretFile, `{"token":"${CANARY_1}"}\nsecond ${CANARY_2} line\n`);

    jest.spyOn(os, "homedir").mockReturnValue(homeDir);
    output = [];
    exitCodes = [];
    const capture = (...args: unknown[]): void => {
      output.push(args.map((a) => String(a)).join(" "));
    };
    jest.spyOn(console, "log").mockImplementation(capture);
    jest.spyOn(console, "error").mockImplementation(capture);
    jest.spyOn(console, "warn").mockImplementation(capture);
    jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code);
      throw new ExitSignal(code);
    }) as never);
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    jest.restoreAllMocks();
    for (const d of [vaultDir, workDir, homeDir]) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  /**
   * Run the real command; an exit is captured, not propagated.
   * ⚠ With the stubbed exit, an ExitSignal thrown inside executeDryRun is caught
   * by the action's own catch and reported a second time (exitCodes [2, 2]); a
   * real process.exit never returns, so axes assert exitCodes[0] only.
   */
  async function run(args: string[]): Promise<string> {
    const cmd = sparqlQueryCommand();
    try {
      await cmd.parseAsync(["node", "query", ...args, "--vault", vaultDir, "--no-cache"]);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    }
    return output.join("\n");
  }

  // ⛔ Match FRAGMENTS, not the whole canary: the parser shows a ~20-char window
  // (`{"token":"FAKE-CANAR`), and JSON mode escapes the quotes (`{\"token\"`).
  // A full-string or quoted match is green on the leaking base (measured).
  function expectNoEcho(out: string): void {
    expect(out).not.toContain("FAKE-CAN");
    expect(out).not.toContain("token");
    expect(out).not.toContain(CANARY_2);
  }

  it("F1 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 text mode: a failed file query names the file, not its content", async () => {
    const out = await run([secretFile]);
    expectNoEcho(out);
    expect(exitCodes[0]).toBe(2);
    expect(out).toContain(secretFile);
    expect(out).toContain("The file content is not shown");
    expect(out).toContain("(syntax error)");
  }, 60000);

  it("F2 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 JSON mode: the error response carries no file content", async () => {
    const out = await run([secretFile, "--output", "json"]);
    expectNoEcho(out);
    expect(exitCodes[0]).toBe(2);
    const json = output.map((l) => {
      try { return JSON.parse(l) as { success?: boolean }; } catch { return undefined; }
    }).find((p) => p && typeof p === "object" && "success" in p);
    expect(json?.success).toBe(false);
  }, 60000);

  it("F3 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 --dry-run: syntax validation of a file query echoes nothing", async () => {
    const out = await run([secretFile, "--dry-run"]);
    expectNoEcho(out);
    expect(exitCodes[0]).toBe(2);
  }, 60000);

  it("F4 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 --dry-run --explain: the analysis of a file query echoes nothing", async () => {
    const out = await run([secretFile, "--dry-run", "--explain"]);
    expectNoEcho(out);
    expect(exitCodes[0]).toBe(2);
  }, 60000);

  it("F5 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 relative path (resolved from cwd) and --explain: nothing echoed", async () => {
    process.chdir(workDir);
    const out = await run([path.basename(secretFile), "--explain"]);
    expectNoEcho(out);
    expect(exitCodes[0]).toBe(2);
  }, 60000);

  it("F9 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 digits of the file never surface as a line/column", async () => {
    // The parser message quotes a window of the input and the enhancer extracts
    // "(N, M)" / "at N:M" from it — a numeric canary would come out as the
    // reported position (PR #4550 review). File queries report no position.
    const numeric = path.join(workDir, "numeric.json");
    fs.writeFileSync(numeric, "pin (4821, 9930) zz\nx at 7351:6624 zz\n");
    for (const extra of [[], ["--output", "json"], ["--dry-run"]]) {
      output.length = 0;
      exitCodes.length = 0;
      const out = await run([numeric, ...extra]);
      expect(exitCodes[0]).toBe(2);
      for (const digits of ["4821", "9930", "7351", "6624"]) {
        expect(out).not.toContain(digits);
      }
    }
  }, 60000);

  it("F10 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 an exit that RETURNS (embedding host) still echoes nothing", async () => {
    // The guard ends in `return reportFileQueryError(...)`; with a throwing
    // exit stub that `return` is never reached, so this axis uses an exit that
    // returns and asserts the old context branch stays unreachable.
    (process.exit as unknown as jest.Mock).mockImplementation(((code?: number) => {
      exitCodes.push(code);
    }) as never);
    for (const extra of [[], ["--dry-run"]]) {
      output.length = 0;
      exitCodes.length = 0;
      const out = await run([secretFile, ...extra]);
      expect(exitCodes[0]).toBe(2);
      expectNoEcho(out);
    }
  }, 60000);

  it("F12 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 an exit that RETURNS still echoes nothing under --dry-run --explain", async () => {
    // The guard ends in `return reportFileQueryError(...)`; with a throwing
    // exit stub that `return` is never reached, so this axis uses an exit that
    // returns and asserts the old context branch stays unreachable.
    (process.exit as unknown as jest.Mock).mockImplementation(((code?: number) => {
      exitCodes.push(code);
    }) as never);
    for (const extra of [["--dry-run", "--explain"]]) {
      output.length = 0;
      exitCodes.length = 0;
      const out = await run([secretFile, ...extra]);
      expect(exitCodes[0]).toBe(2);
      expectNoEcho(out);
    }
  }, 60000);

  it("F11 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 file words never steer the reported type", async () => {
    // classifyError reads the parser message (it quotes the file): "undefined"
    // in the window used to flip the type to unknown_prefix — a 1-bit channel.
    const worded = path.join(workDir, "worded.json");
    fs.writeFileSync(worded, "undefined not defined zz\n");
    const out = await run([worded]);
    expect(exitCodes[0]).toBe(2);
    expect(out).toContain("(syntax error)");
    expect(out).not.toContain("unknown_prefix");
  }, 60000);

  it("F6 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 an INLINE invalid query keeps its parser context (unchanged)", async () => {
    const out = await run(["SELECT ?s WHERE { ?s ?p"]);
    expect(exitCodes[0]).toBe(2);
    expect(out).toContain("Context:");
    expect(out).toContain("SELECT ?s WHERE { ?s ?p");
    expect(out).not.toContain("The file content is not shown");
  }, 60000);

  it("F7 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 a valid query read from a .sparql file still executes", async () => {
    const q = path.join(workDir, "q.sparql");
    fs.writeFileSync(q, "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1\n");
    const out = await run([q, "--output", "json"]);
    expect(exitCodes).toEqual([]);
    const json = output.map((l) => {
      try { return JSON.parse(l) as { success?: boolean }; } catch { return undefined; }
    }).find((p) => p && typeof p === "object" && "success" in p);
    expect(json?.success).toBe(true);
    expect(out).not.toContain("The file content is not shown");
  }, 60000);

  it("F8 @req:1ed27571-bdb8-4c3f-88ed-886cbe9ed8e3 a CLI error of a file query keeps its own message", async () => {
    const q = path.join(workDir, "q.sparql");
    fs.writeFileSync(q, "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1\n");
    const missingVault = path.join(workDir, "no-such-vault");
    const cmd = sparqlQueryCommand();
    try {
      await cmd.parseAsync(["node", "query", q, "--vault", missingVault, "--no-cache"]);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    }
    const out = output.join("\n");
    expect(exitCodes.length).toBeGreaterThan(0);
    expect(out).toContain(missingVault);
    expect(out).not.toContain("The file content is not shown");
  }, 60000);
});
