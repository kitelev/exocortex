/**
 * `cli create` must expand a backslash-n escape ONLY for the inline `--body "a\nb"`
 * form, never for `--body-file`.
 *
 * Issue #2288 introduced the expansion, and its acceptance criterion names the inline
 * form explicitly ("Given --body \"Line1\\n\\nLine2\""): a single shell argument has no
 * way to carry a real newline. The implementation applied it to the RESOLVED body
 * regardless of where that body came from, so a file — which already carries real
 * newlines — had its authored backslash sequences rewritten too. `set-body` then
 * copied the behaviour verbatim ("parse \n escapes like create").
 *
 * The damage is silent and looks like nothing: measured on a 2-line body containing
 * a regex in prose and a Windows path, the write produced 4 lines and 0 backslashes.
 * Nothing validates it, so the corruption reaches the vault and the author discovers
 * it later, in a document that no longer says what they wrote.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md): drop the
 * `source === "inline"` condition in create.ts so the expansion is unconditional again
 * → the --body-file axis goes RED while the inline axis stays GREEN. Remove the
 * expansion entirely → the inline axis goes RED and the file axis stays GREEN. The two
 * axes therefore pin the DISCRIMINATOR, not merely the presence of an expansion.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { createCommand } = await import("../../src/commands/create.js");

const TASK_CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const EFFORT_CLASS_UID = "086f71fa-dd30-4284-90cf-e609f2a6c461";
const BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const EXOASSISTANT_UID = "4ef3962d-b8a7-42b5-bd28-88ec846f1d13";
const EMS_DIR = "assetspaces/kitelev/exoas-public/ems";

function md(frontmatter: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - "${item}"`);
    } else lines.push(`${k}: ${v}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

describe("cli create — backslash-n is expanded for --body only, never for --body-file", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-body-escapes-"));
    const emsDir = path.join(vault, EMS_DIR);
    fs.mkdirSync(emsDir, { recursive: true });
    // The class chain create walks to decide the status default, plus the enum it
    // resolves to. Without these create errors out and (process.exit being mocked)
    // simply writes nothing — which reads as "the assertion is wrong", not "the
    // fixture is short".
    fs.writeFileSync(
      path.join(emsDir, `${EFFORT_CLASS_UID}.md`),
      md({ exo__Asset_uid: EFFORT_CLASS_UID, exo__Asset_label: "ems__Effort" }),
    );
    fs.writeFileSync(
      path.join(emsDir, `${TASK_CLASS_UID}.md`),
      md({
        exo__Asset_uid: TASK_CLASS_UID,
        exo__Asset_label: "ems__Task",
        exo__Class_superClass: [`[[${EFFORT_CLASS_UID}]]`],
      }),
    );
    fs.writeFileSync(
      path.join(emsDir, `${BACKLOG_UID}.md`),
      md({ exo__Asset_uid: BACKLOG_UID, exo__Asset_label: "ems__EffortStatusBacklog" }),
    );
    fs.writeFileSync(
      path.join(emsDir, `${EXOASSISTANT_UID}.md`),
      md({ exo__Asset_uid: EXOASSISTANT_UID, exo__Asset_label: "ExoAssistant" }),
    );
    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });

    stdoutChunks = [];
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined as never) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      }) as never);
    logSpy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdoutChunks.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    logSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  /** Run the REAL create command via commander and return the BODY it wrote. */
  const runCreate = async (extra: string[]): Promise<string> => {
    const cmd = createCommand();
    await cmd.parseAsync(
      ["--vault", vault, "--class", TASK_CLASS_UID, "--label", "escape probe", ...extra],
      { from: "user" },
    );
    const inbox = path.join(vault, "01 Inbox");
    const written = fs.readdirSync(inbox).filter((f) => f.endsWith(".md"));
    expect(written).toHaveLength(1);
    return fs.readFileSync(path.join(inbox, written[0]), "utf-8").split("---")[2];
  };

  it("preserves a literal backslash-n from --body-file (authored prose, not an escape)", async () => {
    const bodyFile = path.join(vault, "literal-escapes.md");
    fs.writeFileSync(bodyFile, "regex `\\n` and path C:\\new\nsecond line\n");

    const body = await runCreate(["--body-file", bodyFile]);

    expect(body).toContain("C:\\new");
    expect(body).toContain("`\\n`");
    // 4 lines here would mean the two sequences were expanded.
    expect(body.trim().split("\n")).toHaveLength(2);
  });

  it("still expands backslash-n for the inline --body form (issue #2288 AC)", async () => {
    const body = await runCreate(["--body", "Line1\\nLine2"]);

    expect(body.trim().split("\n")).toHaveLength(2);
    expect(body).not.toContain("Line1\\nLine2");
  });
});
