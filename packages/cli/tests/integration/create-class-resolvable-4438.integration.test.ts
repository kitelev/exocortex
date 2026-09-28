/**
 * Issue #4438 / ticket a3f3939c — `create --class <uuid>` must REFUSE a class
 * UID that has no file in the vault.
 *
 * Live incident (2026-09-27): a Telegram bot created an asset with
 * `exo__Instance_class: "[[fe1a4590-0000-0000-0000-000000000000]]"` — the first
 * 8 characters of a real class UID, the tail invented. `create` returned 0, the
 * asset was written, and `validate schema --shapes-mode` did not mention it
 * either (identical violation/warning counts before and after a manual repair).
 * A short NAME was already checked (the resolver's index lookup raises
 * ClassNotFoundError); a full UUID was passed through unchecked, and
 * `exo__Instance_class` is assembled by the core service DOWNSTREAM of
 * `propertyValues`, so the existing WikilinkValidator call never saw it.
 *
 * The PreToolUse `validate-wikilinks` hook cannot close this by construction — a
 * CLI create runs through Bash, not Write/Edit — so the gate lives in
 * `planCreate`, which also gives `create-batch` the same refusal for free.
 *
 * Every axis drives the REAL `createCommand()` / `createBatchCommand()` action
 * against a temp fixture vault and reads the disk back (test-fixture-realism) —
 * no hand-injected config that would bypass the resolution being tested.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * mutants live in three spec files, one per subject —
 *   create-class-resolvable-4438.create.spec.json      (create.ts: M1, M2)
 *   create-class-resolvable-4438.validator.spec.json   (WikilinkValidator.ts: M3)
 *   create-class-resolvable-4438.error.spec.json       (ClassResolverService.ts: M4)
 * M1 (gate removed) reds K1/K2/K6/K9 and leaves K3/K4/K5/K7/K8 GREEN — the
 * non-vacuity control. M2 (escape guard dropped) reds K5 alone. M3 (the probe
 * stops reusing validateWikilink and checks the UID filename only) reds K7/K8 —
 * it is what pins the REUSE rather than a second hand-rolled existence check.
 * M4 (the `find` hint dropped from the message) reds K2 alone, pinning the
 * diagnostic as its own deliverable.
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
const { createBatchCommand } =
  await import("../../src/commands/create-batch.js");

// Real production UIDs so the fixture mirrors the live TBox shapes.
const CLASS_METACLASS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9"; // exo__Class
const TASK_CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task
const EFFORT_CLASS_UID = "086f71fa-dd30-4284-90cf-e609f2a6c461"; // ems__Effort
const BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const EXOASSISTANT_UID = "4ef3962d-b8a7-42b5-bd28-88ec846f1d13";

/**
 * The incident's UID verbatim: a real 8-char prefix with a zero-filled tail.
 * No file carries it — that is the whole point of the fixture.
 */
const PHANTOM_CLASS_UID = "fe1a4590-0000-0000-0000-000000000000";

/**
 * A class that is NOT UID-named: its UID lives only in the frontmatter, the way
 * the calendar-plugin whitelist files do. Referencing it by UID must resolve
 * through the `exo__Asset_uid` scan — the fallback a naive `<uid>.md` existence
 * check would miss (mutant M3).
 */
const LABEL_NAMED_CLASS_UID = "bb77aa11-2222-4333-8444-555566667777";

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

describe("issue #4438: `cli create` refuses a class UID that does not exist in the vault", () => {
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
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-4438-vault-"));
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cli-4438-input-"));

    const emsDir = path.join(vault, EMS_DIR);
    const exoDir = path.join(vault, EXO_DIR);
    fs.mkdirSync(emsDir, { recursive: true });
    fs.mkdirSync(exoDir, { recursive: true });

    // exo__Class metaclass — what makes the files below class DEFINITIONS, so
    // the short-name index (K4) is populated the way the real TBox populates it.
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
    // LABEL-named class definition (filename ≠ uid) — K7's subject.
    fs.writeFileSync(
      path.join(emsDir, "ems__LabelNamedClass.md"),
      md({
        exo__Asset_uid: LABEL_NAMED_CLASS_UID,
        exo__Asset_label: "ems__LabelNamedClass",
        exo__Instance_class: isClass,
      }),
    );
    // Status enum + creator identity, so a status-bearing create is complete.
    fs.writeFileSync(
      path.join(emsDir, `${BACKLOG_UID}.md`),
      md({
        exo__Asset_uid: BACKLOG_UID,
        exo__Asset_label: "ems__EffortStatusBacklog",
      }),
    );
    fs.writeFileSync(
      path.join(emsDir, `${EXOASSISTANT_UID}.md`),
      md({
        exo__Asset_uid: EXOASSISTANT_UID,
        exo__Asset_label: "ExoAssistant",
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
      ["--vault", vault, "--label", "E2E-4438", ...args],
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
      { from: "user" },
    );
    const stdout = stdoutChunks.join("");
    return {
      exit: [...exitCodes],
      stderr: stderrChunks.join(""),
      stdout,
      created: null,
    };
  }

  it("K1 a class UID with no file in the vault is REFUSED and nothing is written", async () => {
    const before = countMd(vault);

    const run = await runCreate(["--class", PHANTOM_CLASS_UID]);

    expect(run.exit).not.toContain(0);
    expect(run.created).toBeNull();
    expect(countMd(vault)).toBe(before);
    // No asset anywhere carries the phantom reference.
    const leaked = fs
      .readdirSync(path.join(vault, "01 Inbox"))
      .filter((f) => f.endsWith(".md"));
    expect(leaked).toEqual([]);
  });

  it("K2 the refusal NAMES the unresolved uid, the find command for its prefix, and the escape flag", async () => {
    const run = await runCreate(["--class", PHANTOM_CLASS_UID]);

    expect(run.stderr).toContain(PHANTOM_CLASS_UID);
    // The caller usually HAS the right first 8 characters — the hint turns
    // those into the command that finds the real UID.
    expect(run.stderr).toContain("find");
    expect(run.stderr).toContain("fe1a4590*.md");
    expect(run.stderr).toContain("--skip-wikilink-validation");
  });

  it("K3 an EXISTING class UID still creates the asset (behaviour unchanged)", async () => {
    const run = await runCreate(["--class", TASK_CLASS_UID]);

    expect(run.exit).toContain(0);
    expect(run.created).not.toBeNull();
    const content = fs.readFileSync(
      path.join(vault, run.created!.path),
      "utf-8",
    );
    expect(content).toContain(`exo__Instance_class`);
    expect(content).toContain(TASK_CLASS_UID);
  });

  it("K4 a short-name class still resolves and creates (symbolic form not broken)", async () => {
    const run = await runCreate(["--class", "ems__Task"]);

    expect(run.exit).toContain(0);
    expect(run.created).not.toBeNull();
    const content = fs.readFileSync(
      path.join(vault, run.created!.path),
      "utf-8",
    );
    // The resolver turned the short name into the class UID, as before.
    expect(content).toContain(TASK_CLASS_UID);
  });

  it("K5 --skip-wikilink-validation is the escape: the phantom class is accepted deliberately", async () => {
    const run = await runCreate([
      "--class",
      PHANTOM_CLASS_UID,
      "--skip-wikilink-validation",
    ]);

    expect(run.exit).toContain(0);
    expect(run.created).not.toBeNull();
    const content = fs.readFileSync(
      path.join(vault, run.created!.path),
      "utf-8",
    );
    expect(content).toContain(PHANTOM_CLASS_UID);
  });

  it("K6 --dry-run does not bypass the gate: no preview, no file", async () => {
    const before = countMd(vault);

    const run = await runCreate(["--class", PHANTOM_CLASS_UID, "--dry-run"]);

    expect(run.exit).not.toContain(0);
    expect(run.stderr).not.toContain("DRY RUN PREVIEW");
    expect(countMd(vault)).toBe(before);
  });

  it("K7 a class whose UID lives only in frontmatter (label-named file) resolves", async () => {
    const run = await runCreate(["--class", LABEL_NAMED_CLASS_UID]);

    expect(run.exit).toContain(0);
    expect(run.created).not.toBeNull();
    const content = fs.readFileSync(
      path.join(vault, run.created!.path),
      "utf-8",
    );
    expect(content).toContain(LABEL_NAMED_CLASS_UID);
  });

  it("K8 create-batch: an item may instance a class created by an EARLIER item of the same batch", async () => {
    const pendingClassUid = "aa11bb22-3333-4444-8555-666677778888";
    const run = await runBatch([
      {
        class: CLASS_METACLASS_UID,
        label: "Batch-made class",
        uid: pendingClassUid,
      },
      { class: pendingClassUid, label: "Instance of the batch-made class" },
    ]);

    expect(run.exit).toContain(0);
    expect(run.stderr).not.toContain("not found in vault");
    const written = JSON.parse(run.stdout.trim()) as { path: string }[];
    expect(written).toHaveLength(2);
    const instance = fs.readFileSync(
      path.join(vault, written[1].path),
      "utf-8",
    );
    expect(instance).toContain(pendingClassUid);
  });

  it("K9 create-batch control: a class UID in neither the batch nor the vault is refused, nothing written", async () => {
    const before = countMd(vault);

    const run = await runBatch([
      { class: TASK_CLASS_UID, label: "Fine item" },
      { class: PHANTOM_CLASS_UID, label: "Phantom-class item" },
    ]);

    expect(run.exit).not.toContain(0);
    expect(run.stderr).toContain(PHANTOM_CLASS_UID);
    expect(countMd(vault)).toBe(before);
  });
});
