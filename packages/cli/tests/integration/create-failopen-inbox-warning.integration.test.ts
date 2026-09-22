/**
 * Ticket 3f8b640f — `cli create` lands an asset in the `01 Inbox/` fail-open
 * folder SILENTLY when `exo__Asset_isDefinedBy` is absent: rc=0, the JSON is
 * well-formed, SHACL says nothing (an empty isDefinedBy is a documented
 * co-location skip reason), and `audit co-location` skips the file by design.
 * The divergence is visible only to whoever compares the printed path by eye.
 *
 * Priority-2 class-neighbour placement (#3934) does NOT cover this case: it
 * matches siblings on class AND the SAME anchor, so an absent anchor
 * (`newAnchor = null`) selects only siblings that ALSO carry no isDefinedBy.
 * Measured on the live vault-exodev (2026-09-10, CLI 16.235.11): all 451
 * `inbox__ExoAssistantKnowledge` instances carry an anchor, so that population
 * is empty BY CONSTRUCTION and every anchor-less create of the class lands in
 * `01 Inbox/`.
 *
 * The fix does NOT move the asset (placement stays fail-open — the tool cannot
 * know which of a class's several homes was intended); it makes the fail-open
 * AUDIBLE, and only when the class demonstrably has a home elsewhere.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * W1 FAILS pre-fix (no warning is emitted at all) and PASSES post-fix. The
 * negative/boundary controls W2-W5 stay green in BOTH states, proving the axis
 * is not vacuous and the change does not shout on healthy paths.
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

const { createCommand } = await import("../../src/commands/create.js");

const CLASS_UID = "b0474610-5fa7-4ec4-a947-f85f26e93455";
/** A class with no instances anywhere in the fixture vault. */
const LONELY_CLASS_UID = "aaaaaaaa-0000-0000-0000-000000000000";
const SIBLING_DIR = "assetspaces/kitelev/exoas-exodev/inbox";
const ONTOLOGY_UID = "32d2374c-aaaa-bbbb-cccc-000000000000";
const ONTOLOGY_DIR = "assetspaces/kitelev/exoas-exodev/exodev";
const INBOX = "01 Inbox";

function md(frontmatter: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function writeSibling(
  vault: string,
  dir: string,
  uid: string,
  classUid: string,
  isDefinedBy: string | null,
): void {
  const abs = path.join(vault, dir);
  fs.mkdirSync(abs, { recursive: true });
  const front: Record<string, string> = {
    exo__Asset_uid: uid,
    exo__Instance_class: `"[[${classUid}]]"`,
    exo__Asset_label: `sibling ${uid}`,
  };
  if (isDefinedBy !== null) {
    front.exo__Asset_isDefinedBy = `"${isDefinedBy}"`;
  }
  fs.writeFileSync(path.join(abs, `${uid}.md`), md(front));
}

/** A resolvable ontology file for the priority-1 negative control. */
function writeOntology(vault: string): void {
  const abs = path.join(vault, ONTOLOGY_DIR);
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(
    path.join(abs, `${ONTOLOGY_UID}.md`),
    md({
      exo__Asset_uid: ONTOLOGY_UID,
      exo__Asset_label: "$exodev",
    }),
  );
}

describe("Ticket 3f8b640f: `cli create` fail-open into `01 Inbox/` is audible", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3f8b640f-"));
    fs.mkdirSync(path.join(vault, INBOX), { recursive: true });

    stdoutChunks = [];
    stderrChunks = [];
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as never);
    // NOT a no-op spy: stderr IS the subject of this suite.
    stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as never);
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

  async function runCreate(
    classArg: string,
    extraArgs: string[],
  ): Promise<{
    result: { uuid: string; path: string; label: string };
    stderr: string;
  }> {
    const cmd = createCommand();
    await cmd.parseAsync(
      [
        "--class",
        classArg,
        "--label",
        "E2E-TEST fail-open warning",
        "--vault",
        vault,
        "--skip-wikilink-validation",
        ...extraArgs,
      ],
      { from: "user" },
    );
    expect(exitCodes).toContain(0);
    expect(exitCodes).not.toContain(1);
    const json = stdoutChunks.join("").trim();
    if (!json) {
      throw new Error(
        `create emitted no stdout JSON. stderr: ${stderrChunks.join("")}`,
      );
    }
    return { result: JSON.parse(json), stderr: stderrChunks.join("") };
  }

  it("@req:ec3e7b15-766f-4323-8c58-da7d34fb5fd9 W1 (subject): no isDefinedBy + class has a home elsewhere → lands in inbox AND warns, naming the actual path and the existing homes", async () => {
    writeSibling(
      vault,
      SIBLING_DIR,
      "1111aaaa-0000-0000-0000-000000000001",
      CLASS_UID,
      "[[!kitelev]]",
    );
    writeSibling(
      vault,
      SIBLING_DIR,
      "1111aaaa-0000-0000-0000-000000000002",
      CLASS_UID,
      "[[!kitelev]]",
    );

    const { result, stderr } = await runCreate(CLASS_UID, []);

    // Placement is UNCHANGED — the fix makes the fail-open audible, not silent-moved.
    expect(result.path).toBe(`${INBOX}/${result.uuid}.md`);
    // …and the warning names the mechanism, the actual folder and the real home.
    expect(stderr).toContain("co-location fail-open");
    expect(stderr).toContain(`${INBOX}/`);
    expect(stderr).toContain(SIBLING_DIR);
    // The count is DERIVED from the same scan that made the decision.
    expect(stderr).toContain("(2)");
    // stdout stays a single JSON document (consumers parse it).
    expect(() => JSON.parse(stdoutChunks.join("").trim())).not.toThrow();
  });

  it("@req:ec3e7b15-766f-4323-8c58-da7d34fb5fd9 W2 (negative, DoD 2): resolvable isDefinedBy → co-located AND silent", async () => {
    writeOntology(vault);
    writeSibling(
      vault,
      SIBLING_DIR,
      "2222aaaa-0000-0000-0000-000000000001",
      CLASS_UID,
      "[[!kitelev]]",
    );

    const { result, stderr } = await runCreate(CLASS_UID, [
      "--property",
      `exo__Asset_isDefinedBy=[[${ONTOLOGY_UID}]]`,
    ]);

    expect(result.path).toBe(`${ONTOLOGY_DIR}/${result.uuid}.md`);
    expect(stderr).not.toContain("co-location fail-open");
  });

  it("@req:ec3e7b15-766f-4323-8c58-da7d34fb5fd9 W3 (boundary, DoD 3): class with NO instances anywhere → inbox, and SILENT", async () => {
    writeSibling(
      vault,
      SIBLING_DIR,
      "3333aaaa-0000-0000-0000-000000000001",
      CLASS_UID,
      "[[!kitelev]]",
    );

    const { result, stderr } = await runCreate(LONELY_CLASS_UID, []);

    expect(result.path).toBe(`${INBOX}/${result.uuid}.md`);
    expect(stderr).not.toContain("co-location fail-open");
  });

  it("@req:ec3e7b15-766f-4323-8c58-da7d34fb5fd9 W4 (boundary): bang-anchor + same-anchor siblings → priority-2 places it, no warning", async () => {
    writeSibling(
      vault,
      SIBLING_DIR,
      "4444aaaa-0000-0000-0000-000000000001",
      CLASS_UID,
      "[[!kitelev]]",
    );

    const { result, stderr } = await runCreate(CLASS_UID, [
      "--property",
      "exo__Asset_isDefinedBy=[[!kitelev]]",
    ]);

    expect(result.path).toBe(`${SIBLING_DIR}/${result.uuid}.md`);
    expect(stderr).not.toContain("co-location fail-open");
  });

  it("@req:ec3e7b15-766f-4323-8c58-da7d34fb5fd9 W5 (boundary): the class's only home IS the inbox → fail-open is the convention, stay SILENT", async () => {
    writeSibling(
      vault,
      INBOX,
      "5555aaaa-0000-0000-0000-000000000001",
      CLASS_UID,
      "[[!kitelev]]",
    );

    const { result, stderr } = await runCreate(CLASS_UID, []);

    expect(result.path).toBe(`${INBOX}/${result.uuid}.md`);
    expect(stderr).not.toContain("co-location fail-open");
  });

  it("@req:ec3e7b15-766f-4323-8c58-da7d34fb5fd9 W6 (boundary): the class's only home is the VAULT ROOT → not a home, stay SILENT", async () => {
    // The emission filter drops "" (vault root) alongside the inbox default:
    // a sibling lying loose at the root is not evidence of a canonical home,
    // so pointing at it would be advice to move the asset nowhere. W5 locks
    // the inbox half of that filter; without this axis the root half is
    // unguarded (deleting `folder !== ""` reddens nothing).
    writeSibling(
      vault,
      ".",
      "6666aaaa-0000-0000-0000-000000000001",
      CLASS_UID,
      "[[!kitelev]]",
    );

    const { result, stderr } = await runCreate(CLASS_UID, []);

    expect(result.path).toBe(`${INBOX}/${result.uuid}.md`);
    expect(stderr).not.toContain("co-location fail-open");
  });

  it("@req:ec3e7b15-766f-4323-8c58-da7d34fb5fd9 W7 (subject, anchor present): isDefinedBy resolves no folder and no sibling shares it → warns, naming the ANCHOR that failed", async () => {
    // The other arm of the anchor-state wording: priority-1 finds no ontology
    // file for `[[!someoneelse]]` and priority-2 finds no sibling under that
    // anchor, so the asset fail-opens even though isDefinedBy IS set. Without
    // this axis the branch ships unlocked and a rewrite of the string (or an
    // inversion of the ternary) would be silent.
    writeSibling(
      vault,
      SIBLING_DIR,
      "7777aaaa-0000-0000-0000-000000000001",
      CLASS_UID,
      "[[!kitelev]]",
    );

    const { result, stderr } = await runCreate(CLASS_UID, [
      "--property",
      "exo__Asset_isDefinedBy=[[!someoneelse]]",
    ]);

    expect(result.path).toBe(`${INBOX}/${result.uuid}.md`);
    expect(stderr).toContain("co-location fail-open");
    expect(stderr).toContain("exo__Asset_isDefinedBy=[[!someoneelse]]");
    expect(stderr).toContain("no sibling shares that anchor");
    expect(stderr).toContain(`${SIBLING_DIR} (1)`);
  });
});
