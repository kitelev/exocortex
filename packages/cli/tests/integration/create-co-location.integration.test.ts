/**
 * Issue #3520 — `cli create` must co-locate a new asset in the folder of its
 * `exo__Asset_isDefinedBy` ontology file (RFC 0b7a2fad CR-1), instead of
 * unconditionally writing to `01 Inbox/`.
 *
 * Exercises the REAL `createCommand()` action end-to-end against a temp fixture
 * vault (no service-level shortcut): parses CLI args, resolves the class UID,
 * resolves co-location placement via the shared `folderRepairHelpers`
 * resolver, and writes the file. Asserts where the file physically lands by
 * parsing the command's JSON stdout (`{ uuid, path, label }`) and stat-ing the
 * file.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * the "resolvable → co-located" case FAILS pre-fix (the asset landed in
 * `01 Inbox/`) and PASSES post-fix. The fail-open cases (no / `!`-prefixed /
 * unresolvable isDefinedBy) keep the historical inbox default in both states.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { createCommand } = await import("../../src/commands/create.js");

// Full-UUID ontology + class so the resolver's UID-index branch (Try 3) and the
// `--class` UID pass-through both fire deterministically.
const ONTOLOGY_UID = "32d2374c-aaaa-bbbb-cccc-000000000000";
const CLASS_UID = "b0474610-1111-2222-3333-444444444444";
const ONTOLOGY_DIR = "assetspaces/kitelev/exoas-exodev/exodev";

function md(frontmatter: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

describe("Issue #3520: `cli create` co-locates by exo__Asset_isDefinedBy", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3520-"));

    // Ontology file ($exodev anchor) — the co-location target.
    const ontologyDir = path.join(vault, ONTOLOGY_DIR);
    fs.mkdirSync(ontologyDir, { recursive: true });
    fs.writeFileSync(
      path.join(ontologyDir, `${ONTOLOGY_UID}.md`),
      md({
        exo__Asset_uid: ONTOLOGY_UID,
        exo__Asset_label: "$exodev",
      }),
    );

    // Inbox default must already exist for the fail-open cases.
    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });

    stdoutChunks = [];
    exitCodes = [];
    // `create`'s action calls `process.exit(0)` as the LAST statement inside
    // its own try block, so a throwing spy would be caught by that try and
    // re-handled as an error. Record the code as a NO-OP instead — the success
    // JSON has already been written to stdout by that point.
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

  /**
   * Run the real create command action. Returns the parsed JSON result
   * (`{ uuid, path, label }`). Asserts the command exited 0 and emitted JSON.
   */
  async function runCreate(extraArgs: string[]): Promise<{
    uuid: string;
    path: string;
    label: string;
  }> {
    const cmd = createCommand();
    const argv = [
      "--class",
      CLASS_UID,
      "--label",
      "E2E-TEST co-location",
      "--vault",
      vault,
      "--skip-wikilink-validation",
      ...extraArgs,
    ];
    await cmd.parseAsync(argv, { from: "user" });

    const stderrLog = errorSpy.mock.calls.flat().join("\n");
    expect(exitCodes).toContain(0);
    expect(exitCodes).not.toContain(1);
    const json = stdoutChunks.join("").trim();
    if (!json) {
      throw new Error(`create emitted no stdout JSON. stderr: ${stderrLog}`);
    }
    return JSON.parse(json);
  }

  it("resolvable isDefinedBy → asset placed in the ontology folder (not inbox) @req:ec877f5e-d466-41fb-a3ae-9b8239cd7345", async () => {
    const result = await runCreate([
      "--property",
      `exo__Asset_isDefinedBy=[[${ONTOLOGY_UID}]]`,
    ]);

    expect(result.path).toBe(`${ONTOLOGY_DIR}/${result.uuid}.md`);
    expect(result.path.startsWith("01 Inbox/")).toBe(false);

    // File physically exists in the co-located folder…
    expect(fs.existsSync(path.join(vault, result.path))).toBe(true);
    // …and NOT in the inbox.
    expect(
      fs.existsSync(path.join(vault, "01 Inbox", `${result.uuid}.md`)),
    ).toBe(false);
  });

  it("fail-open: unresolvable isDefinedBy → inbox default", async () => {
    const result = await runCreate([
      "--property",
      "exo__Asset_isDefinedBy=[[ffffffff-dead-beef-cafe-000000000000]]",
    ]);

    expect(result.path).toBe(`01 Inbox/${result.uuid}.md`);
    expect(fs.existsSync(path.join(vault, result.path))).toBe(true);
  });

  it("fail-open: `!`-prefixed anchor isDefinedBy → inbox default", async () => {
    const result = await runCreate([
      "--property",
      "exo__Asset_isDefinedBy=[[!exodev]]",
    ]);

    expect(result.path).toBe(`01 Inbox/${result.uuid}.md`);
  });

  it("fail-open: no isDefinedBy → inbox default", async () => {
    const result = await runCreate([]);

    expect(result.path).toBe(`01 Inbox/${result.uuid}.md`);
    expect(fs.existsSync(path.join(vault, result.path))).toBe(true);
  });
});
