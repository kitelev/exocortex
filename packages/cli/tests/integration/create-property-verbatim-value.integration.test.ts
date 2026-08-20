/**
 * Issue #4014 — `create --property key= value ` must keep the value verbatim.
 *
 * `parseProperties` trimmed the value, so edge whitespace never reached disk:
 * `--property "sep= · "` landed as `sep: ·`. That whitespace is meaningful for
 * display properties (a ` · ` separator, an indent, a prefix), and it was the
 * ONLY layer losing it — the downstream serializer already quotes a value whose
 * edges differ from its trimmed form, so once the value survives parsing it
 * round-trips through YAML unharmed.
 *
 * Drives the REAL `createCommand()` end-to-end against a temp vault (commander
 * → parseProperties → core GenericAssetCreationService → on-disk frontmatter),
 * then parses the produced frontmatter with a real YAML parser — a raw-text
 * assertion alone could not tell `sep: " X "` from `sep: X` after quoting rules.
 *
 * Revert-verify (RFC 0003): restoring `.trim()` on the value turns the two
 * whitespace axes RED; the plain-value and multi-value axes stay GREEN in both
 * states, so the fix is not bought at their expense.
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
import * as os from "os";
import * as yaml from "js-yaml";

const { createCommand } = await import("../../src/commands/create.js");

const CLASS_UID = "65b58c34-7451-4b89-bea3-483f7c65fe73"; // pass-through (ztlk:Note)

describe("Issue #4014: cli create --property keeps the value verbatim", () => {
  let vault: string;
  let exitSpy: any;
  let stdoutSpy: any;
  let stderrSpy: any;
  let consoleErrSpy: any;
  let stdoutChunks: string[];
  let errChunks: string[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-4014-"));
    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });
    stdoutChunks = [];
    errChunks = [];
    consoleErrSpy = jest.spyOn(console, "error").mockImplementation(((
      ...a: any[]
    ) => {
      errChunks.push(a.map(String).join(" "));
    }) as any);
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as any);
    stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
      chunk: any,
    ) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as any);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleErrSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  /** Runs the real command, returns the frontmatter parsed by a real YAML parser. */
  const run = async (propertyArgs: string[], label: string) => {
    const argv = [
      "node",
      "exocortex",
      "--vault",
      vault,
      "--class",
      CLASS_UID,
      "--label",
      label,
      "--skip-wikilink-validation",
      ...propertyArgs,
    ];
    try {
      await createCommand().parseAsync(argv);
    } catch (e: any) {
      if (!/^__process_exit_\d+__$/.test(String(e?.message)))
        throw new Error(
          `create threw: ${e?.message} | console.error=${errChunks.join(" || ")}`,
        );
    }
    const stdout = stdoutChunks.join("").trim();
    if (!stdout)
      throw new Error(
        `create produced no stdout (failed) | console.error=${errChunks.join(" || ")}`,
      );
    const out = JSON.parse(stdout);
    const content = fs.readFileSync(path.join(vault, out.path), "utf-8");
    const frontmatter = yaml.load(content.split("---\n")[1]) as Record<
      string,
      unknown
    >;
    return { content, frontmatter };
  };

  it("keeps whitespace on BOTH edges of the value", async () => {
    // The reported case: a ` · ` separator for a display-name spec.
    const { frontmatter } = await run(
      ["--property", "probe__separator= · "],
      "TEST-4014-both-edges",
    );
    expect(frontmatter.probe__separator).toBe(" · ");
  });

  it("keeps whitespace on ONE edge of the value", async () => {
    // A prefix/indent is the one-sided form of the same need — and it is the
    // case a naive "quote only when both edges have space" fix would miss.
    const { frontmatter } = await run(
      ["--property", "probe__prefix=  indented"],
      "TEST-4014-one-edge",
    );
    expect(frontmatter.probe__prefix).toBe("  indented");
  });

  it("still trims the KEY, so `k = v` names key k", async () => {
    // Asymmetric on purpose: whitespace around a key is never meaningful.
    const { frontmatter } = await run(
      ["--property", "probe__spaced = padded"],
      "TEST-4014-key-trim",
    );
    expect(Object.keys(frontmatter)).toContain("probe__spaced");
    expect(frontmatter.probe__spaced).toBe(" padded");
  });

  it("leaves an ordinary value unquoted", async () => {
    // Canary — green in BOTH states. The fix must not start quoting values that
    // never needed it; a blanket-quote "fix" would pass the axes above and fail
    // here.
    const { content, frontmatter } = await run(
      ["--property", "probe__plain=ordinary"],
      "TEST-4014-plain",
    );
    expect(frontmatter.probe__plain).toBe("ordinary");
    expect(content).toMatch(/^probe__plain: ordinary$/m);
  });

  it("leaves the multi-value accumulation intact", async () => {
    // Canary — green in BOTH states (issue #3759's behaviour must survive).
    const { frontmatter } = await run(
      ["--property", "probe__many=first", "--property", "probe__many=second"],
      "TEST-4014-multi",
    );
    expect(frontmatter.probe__many).toEqual(["first", "second"]);
  });
});
