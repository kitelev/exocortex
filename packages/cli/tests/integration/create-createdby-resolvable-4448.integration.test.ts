/**
 * Issue #4448 / ticket 36bd4ee0 — `create --created-by <uuid>` must REFUSE an
 * EXPLICIT creator UID that has no file in the vault.
 *
 * Sibling of #4438 (closed by #4446) on a different property. Same mechanism:
 * `exo__Asset_createdBy`, like `exo__Instance_class`, is assembled by the core
 * creation service DOWNSTREAM of `propertyValues`, so the existing
 * `WikilinkValidator.validatePropertyValues` call in `planCreate` never saw it.
 * Measured on the pre-fix checkout of this branch (temp fixture vault, real
 * `createCommand()`): `--created-by beef0000-0000-4000-8000-000000000111`
 * exited 0, the asset was written, and `find <vault> -name 'beef0000*'`
 * returned 0 while the same find on a real identity uid returned 1.
 *
 * ⛤ The gate is scoped to the EXPLICIT flag. The ExoAssistant DEFAULT is a
 * product constant, not caller input, so it stays unvalidated — a minimal vault
 * that does not carry that identity file must still be writable. That fail-open
 * half is NOT left implicit: C6 asserts it as a negative control, and it is
 * tagged `@req:b341020e-8f27-452b-9df6-da4247408b2e` because clause 4 of that
 * Active requirement's Gherkin ("the created asset has exo__Asset_createdBy set
 * to the ExoAssistant wikilink") is UNCONDITIONAL — C6 pins it under a
 * condition the requirement did not contemplate, which is a regression binding,
 * not a new promise.
 *
 * Every axis drives the REAL `createCommand()` / `createBatchCommand()` action
 * against a temp fixture vault and reads the disk back (test-fixture-realism) —
 * no hand-injected config that would bypass the resolution under test.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * mutants live in two spec files, one per subject —
 *   create-createdby-resolvable-4448.create.spec.json     (create.ts: M1, M2, M5)
 *   create-createdby-resolvable-4448.validator.spec.json  (WikilinkValidator.ts: M3, M4, M6)
 * M1 (refusal reduced to a no-op) reds C1/C2/C5/C9/C10 and leaves
 * C3/C4/C6/C7/C8 GREEN — the non-vacuity control: with the gate gone the
 * phantom creator lands exactly as it did before the fix and nothing else
 * moves. M2 (escape guard dropped) reds C4 alone. M5 (the gate widened to the
 * EFFECTIVE creator, i.e. the default included) reds C6 alone — it is what pins
 * the fail-open half as deliberate rather than accidental. M3 (the probe stops
 * reusing `validateWikilink` and checks the UID filename only) reds C7/C8 — it
 * pins the REUSE rather than a second hand-rolled existence check. M4 (the
 * `find` hint dropped) reds C2. M6 (`not found` dropped from the message) reds
 * C10, because the exit code is decided by a SUBSTRING of that message.
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
import { expectNaturalExit, expectRefused } from "./helpers/exit-assertions.js";

const { createCommand } = await import("../../src/commands/create.js");
const { createBatchCommand } =
  await import("../../src/commands/create-batch.js");

// Real production UIDs so the fixture mirrors the live TBox shapes.
const CLASS_METACLASS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9"; // exo__Class
const TASK_CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task
const EFFORT_CLASS_UID = "086f71fa-dd30-4284-90cf-e609f2a6c461"; // ems__Effort
const BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
/** The CLI's `--created-by` default (ExoAssistant) — the fail-open subject. */
const EXOASSISTANT_UID = "4ef3962d-b8a7-42b5-bd28-88ec846f1d13";
/** A real identity in the fixture: the control an explicit flag may name. */
const REAL_CREATOR_UID = "0aa339bc-9b56-400a-8148-cbde57bbf0b6"; // a.kitelev

/**
 * The issue's UID verbatim: a plausible 8-char prefix with an invented tail. No
 * file carries it — that is the whole point of the fixture.
 */
const PHANTOM_CREATOR_UID = "beef0000-0000-4000-8000-000000000111";

/**
 * An identity that is NOT UID-named: its UID lives only in the frontmatter, the
 * way the calendar-plugin whitelist files do. Referencing it by UID must resolve
 * through the `exo__Asset_uid` scan — the fallback a naive `<uid>.md` existence
 * check would miss (mutant M3).
 */
const LABEL_NAMED_CREATOR_UID = "bb77aa11-2222-4333-8444-5555666677ff";

/** A dangling PROPERTY-value target — the pre-existing refusal C10 compares against. */
const MISSING_TARGET_UID = "dead0000-0000-4000-8000-000000000999";

const EMS_DIR = "assetspaces/kitelev/exoas-public/ems";
const EXO_DIR = "assetspaces/kitelev/exoas-exo/exo";

function md(frontmatter: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - "${item}"`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

/** Count every markdown file in the vault (the "nothing was written" oracle). */
function countMd(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += countMd(full);
    else if (entry.name.endsWith(".md")) total += 1;
  }
  return total;
}

describe("issue #4448: `cli create` refuses an explicit --created-by uid that does not exist in the vault", () => {
  // Several axes drive the real command more than once; the 5 s default is too
  // tight for that under a loaded parallel run.
  jest.setTimeout(30_000);

  let vault: string;
  let scratch: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-4448-vault-"));
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cli-4448-input-"));

    const emsDir = path.join(vault, EMS_DIR);
    const exoDir = path.join(vault, EXO_DIR);
    fs.mkdirSync(emsDir, { recursive: true });
    fs.mkdirSync(exoDir, { recursive: true });

    // exo__Class metaclass — what makes the files below class DEFINITIONS, so
    // the short-name index is populated the way the real TBox populates it.
    fs.writeFileSync(
      path.join(exoDir, `${CLASS_METACLASS_UID}.md`),
      md({
        exo__Asset_uid: CLASS_METACLASS_UID,
        exo__Asset_label: "exo__Class",
      }),
    );
    const isClass = [`[[${CLASS_METACLASS_UID}]]`];
    fs.writeFileSync(
      path.join(emsDir, `${EFFORT_CLASS_UID}.md`),
      md({
        exo__Asset_uid: EFFORT_CLASS_UID,
        exo__Asset_label: "ems__Effort",
        exo__Instance_class: isClass,
      }),
    );
    fs.writeFileSync(
      path.join(emsDir, `${TASK_CLASS_UID}.md`),
      md({
        exo__Asset_uid: TASK_CLASS_UID,
        exo__Asset_label: "ems__Task",
        exo__Instance_class: isClass,
        exo__Class_superClass: [`[[${EFFORT_CLASS_UID}]]`],
      }),
    );
    // Status enum, so a status-bearing create is complete.
    fs.writeFileSync(
      path.join(emsDir, `${BACKLOG_UID}.md`),
      md({
        exo__Asset_uid: BACKLOG_UID,
        exo__Asset_label: "ems__EffortStatusBacklog",
      }),
    );
    // The DEFAULT creator identity. C6 REMOVES this file to exercise the
    // fail-open half; every other axis needs it present so the default write
    // succeeds exactly as it did before the gate.
    fs.writeFileSync(
      path.join(emsDir, `${EXOASSISTANT_UID}.md`),
      md({
        exo__Asset_uid: EXOASSISTANT_UID,
        exo__Asset_label: "ExoAssistant",
      }),
    );
    // A real identity an explicit `--created-by` may legitimately name (C3).
    fs.writeFileSync(
      path.join(emsDir, `${REAL_CREATOR_UID}.md`),
      md({
        exo__Asset_uid: REAL_CREATOR_UID,
        exo__Asset_label: "a.kitelev",
      }),
    );
    // LABEL-named identity (filename ≠ uid) — C7's subject.
    fs.writeFileSync(
      path.join(emsDir, "person__LabelNamedIdentity.md"),
      md({
        exo__Asset_uid: LABEL_NAMED_CREATOR_UID,
        exo__Asset_label: "person__LabelNamedIdentity",
      }),
    );
    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });

    stdoutChunks = [];
    stderrChunks = [];
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    const writeTo = (sink: string[]) =>
      ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
        sink.push(String(chunk));
        const done =
          typeof encodingOrCallback === "function"
            ? encodingOrCallback
            : callback;
        if (typeof done === "function") (done as () => void)();
        return true;
      }) as never;
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(writeTo(stdoutChunks));
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(writeTo(stderrChunks));
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    // ErrorHandler reports through console.error — collected with stderr so the
    // refusal text is assertable.
    errorSpy = jest.spyOn(console, "error").mockImplementation(((
      ...args: unknown[]
    ) => {
      stderrChunks.push(`${args.map(String).join(" ")}\n`);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  interface Run {
    exit: number[];
    stderr: string;
    stdout: string;
    created: { uuid: string; path: string } | null;
  }

  function reset(): void {
    stdoutChunks.length = 0;
    stderrChunks.length = 0;
    exitCodes.length = 0;
  }

  /** Run the REAL create action; `created` is non-null only on success. */
  async function runCreate(args: string[]): Promise<Run> {
    reset();
    await createCommand().parseAsync(
      [
        "--vault",
        vault,
        "--class",
        TASK_CLASS_UID,
        "--label",
        "E2E-4448",
        ...args,
      ],
      { from: "user" },
    );
    const stdout = stdoutChunks.join("");
    const json = stdout.trim();
    return {
      exit: [...exitCodes],
      stderr: stderrChunks.join(""),
      stdout,
      created: json
        ? (JSON.parse(json) as { uuid: string; path: string })
        : null,
    };
  }

  /** Run the REAL create-batch action on `items` (written to a JSON file). */
  async function runBatch(
    items: unknown,
    extraArgs: string[] = [],
  ): Promise<Run> {
    reset();
    const file = path.join(
      scratch,
      `batch-${Math.random().toString(16).slice(2)}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(items));
    await createBatchCommand().parseAsync(
      [file, "--vault", vault, ...extraArgs],
      {
        from: "user",
      },
    );
    const stdout = stdoutChunks.join("");
    return {
      exit: [...exitCodes],
      stderr: stderrChunks.join(""),
      stdout,
      created: null,
    };
  }

  it("C1 an explicit --created-by uid with no file in the vault is REFUSED and nothing is written", async () => {
    const before = countMd(vault);

    const run = await runCreate(["--created-by", PHANTOM_CREATOR_UID]);

    expectRefused(run.exit);
    expect(run.created).toBeNull();
    expect(countMd(vault)).toBe(before);
    // No asset anywhere carries the phantom reference.
    const leaked = fs
      .readdirSync(path.join(vault, "01 Inbox"))
      .filter((f) => f.endsWith(".md"));
    expect(leaked).toEqual([]);
  });

  it("C2 the refusal NAMES the unresolved uid, the find command for its prefix, and the escape flag", async () => {
    const run = await runCreate(["--created-by", PHANTOM_CREATOR_UID]);

    expect(run.stderr).toContain(PHANTOM_CREATOR_UID);
    // The caller usually HAS the right first 8 characters — the hint turns
    // those into the command that finds the real UID.
    expect(run.stderr).toContain("find");
    expect(run.stderr).toContain("beef0000*.md");
    expect(run.stderr).toContain("--skip-wikilink-validation");
  });

  it("C3 an EXISTING identity uid still creates the asset (behaviour unchanged)", async () => {
    const run = await runCreate(["--created-by", REAL_CREATOR_UID]);

    expectNaturalExit(run.exit);
    expect(run.created).not.toBeNull();
    const content = fs.readFileSync(
      path.join(vault, run.created!.path),
      "utf-8",
    );
    expect(content).toContain(
      `exo__Asset_createdBy: "[[${REAL_CREATOR_UID}]]"`,
    );
  });

  it("C4 --skip-wikilink-validation is the escape: the phantom creator is accepted deliberately", async () => {
    const run = await runCreate([
      "--created-by",
      PHANTOM_CREATOR_UID,
      "--skip-wikilink-validation",
    ]);

    expectNaturalExit(run.exit);
    expect(run.created).not.toBeNull();
    const content = fs.readFileSync(
      path.join(vault, run.created!.path),
      "utf-8",
    );
    expect(content).toContain(PHANTOM_CREATOR_UID);
  });

  it("C5 --dry-run does not bypass the gate: no preview, no file", async () => {
    const before = countMd(vault);

    const run = await runCreate([
      "--created-by",
      PHANTOM_CREATOR_UID,
      "--dry-run",
    ]);

    expectRefused(run.exit);
    expect(run.stderr).not.toContain("DRY RUN PREVIEW");
    expect(countMd(vault)).toBe(before);
  });

  it("C6 the DEFAULT creator is NOT gated: a vault missing the ExoAssistant identity still creates (fail-open) @req:b341020e-8f27-452b-9df6-da4247408b2e", async () => {
    // The gate covers CALLER INPUT; the default is a product constant. A minimal
    // vault without that identity file must stay writable, and the reference is
    // still written — clause 4 of req b341020e, which states it unconditionally.
    fs.rmSync(path.join(vault, EMS_DIR, `${EXOASSISTANT_UID}.md`));
    expect(
      fs.existsSync(path.join(vault, EMS_DIR, `${EXOASSISTANT_UID}.md`)),
    ).toBe(false);

    const run = await runCreate([]);

    expectNaturalExit(run.exit);
    expect(run.created).not.toBeNull();
    const content = fs.readFileSync(
      path.join(vault, run.created!.path),
      "utf-8",
    );
    expect(content).toContain(
      `exo__Asset_createdBy: "[[${EXOASSISTANT_UID}]]"`,
    );
  });

  it("C7 an identity whose UID lives only in frontmatter (label-named file) resolves", async () => {
    const run = await runCreate(["--created-by", LABEL_NAMED_CREATOR_UID]);

    expectNaturalExit(run.exit);
    expect(run.created).not.toBeNull();
    const content = fs.readFileSync(
      path.join(vault, run.created!.path),
      "utf-8",
    );
    expect(content).toContain(LABEL_NAMED_CREATOR_UID);
  });

  it("C8 create-batch: an item may name a creator created by an EARLIER item of the same batch", async () => {
    const pendingIdentityUid = "aa11bb22-3333-4444-8555-66667777aaaa";
    const run = await runBatch([
      {
        class: TASK_CLASS_UID,
        label: "Batch-made identity",
        uid: pendingIdentityUid,
      },
      {
        class: TASK_CLASS_UID,
        label: "Created by the batch-made identity",
        createdBy: pendingIdentityUid,
      },
    ]);

    expect(run.exit).toContain(0);
    const written = JSON.parse(run.stdout.trim()) as { path: string }[];
    expect(written).toHaveLength(2);
    const instance = fs.readFileSync(
      path.join(vault, written[1].path),
      "utf-8",
    );
    expect(instance).toContain(
      `exo__Asset_createdBy: "[[${pendingIdentityUid}]]"`,
    );
  });

  it("C9 create-batch control: a creator uid in neither the batch nor the vault is refused, nothing written", async () => {
    const before = countMd(vault);

    const run = await runBatch(
      [
        { class: TASK_CLASS_UID, label: "Fine item" },
        { class: TASK_CLASS_UID, label: "Second item" },
      ],
      ["--created-by", PHANTOM_CREATOR_UID],
    );

    expectRefused(run.exit);
    expect(run.stderr).toContain(PHANTOM_CREATOR_UID);
    expect(countMd(vault)).toBe(before);
  });

  it("C10 the creator refusal is classified like its sibling: same exit code as a dangling --property wikilink, and that code is FILE_NOT_FOUND", async () => {
    // The pre-existing refusal this one must not diverge from.
    const danglingValue = await runCreate([
      "--property",
      `ems__Effort_parent=[[${MISSING_TARGET_UID}]]`,
    ]);
    const phantomCreator = await runCreate([
      "--created-by",
      PHANTOM_CREATOR_UID,
    ]);

    expectRefused(danglingValue.exit);
    expect(phantomCreator.exit).toEqual(danglingValue.exit);
    // ⛔ Pinned ABSOLUTELY as well, not only by the comparison: every other axis
    // asserts a non-zero code, and a negation is satisfied by EVERY nonzero code
    // (integration-test-revert-verify §A38). It matters here because the code is
    // decided by a SUBSTRING of the message — `ErrorHandler.classifyMessage`
    // maps `includes("not found")` to FILE_NOT_FOUND — so a reworded refusal
    // would silently become GENERAL_ERROR (1) while every other axis stayed
    // green. Mutant M6 is exactly that rewording.
    expect(phantomCreator.exit).toContain(3); // ExitCodes.FILE_NOT_FOUND
  });
});
