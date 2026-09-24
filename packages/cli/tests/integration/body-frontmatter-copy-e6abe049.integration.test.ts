/**
 * Ticket e6abe049 — `set-body` / `create --body-file` must REFUSE a body whose
 * leading text is a COPY of a frontmatter block.
 *
 * The incident: the program hub `31c2bdee` carried TWO frontmatter blocks — the
 * real one and, immediately after its closing `---`, a stale 16-line copy with
 * its own `---`. For the YAML parser the copy was body, Obsidian rendered it as
 * text and SPARQL read the first block, so nothing reported it.
 *
 * ⛤ Q1/Q1b/Q2 drive the REAL pre-fix text, recovered from the data repo's git
 * history (`exoas-exodev@169e6846`, the parent of the fix commit `b8184ded`) —
 * not a hand-written approximation. That matters twice over: the copy began
 * WITHOUT an opening `---` (the real block's CLOSING fence served as one), and
 * the ticket body never said the copy carried `exo__Asset_uid` /
 * `exo__Asset_createdAt` — the two keys the guard keys on. Building the axis on
 * invented text would have left both facts unverified.
 *
 * ⛔ The discriminator is NOT "the body starts with a frontmatter block".
 * Measured across the three canonical vaults (52,079 assets with frontmatter,
 * 2026-09-24) that naive predicate refuses 31 LIVE assets — every one an
 * `exo__Template` whose body IS a frontmatter skeleton by design. Q3/Q3b pin
 * exactly those: a placeholder uid/createdAt stays legal. The shipped predicate
 * refuses 0 of 52,079 while still refusing the real hub text.
 *
 * Drives the REAL `setBodyCommand()` / `createCommand()` via `parseAsync`
 * against a temp vault (commander → the guard → on-disk bytes).
 *
 * Revert-verify (req 8ac4d9f5): un-wiring the guard from set-body reddens
 * Q1/Q1b/Q2; from create — Q6; emptying the guard reddens all four; widening it
 * past the real-uid/ISO discriminator reddens Q3/Q3b; dropping the bare-form cut
 * at the copy's own `---` reddens Q3b; dropping the YAML-key check reddens Q5.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { setBodyCommand } = await import("../../src/commands/set-body.js");
const { createCommand } = await import("../../src/commands/create.js");

const TASKS_DIR = "assetspaces/kitelev/exoas-my/tasks";
const TASK_UID = "c1c1c1c1-0000-4000-8000-000000000001";
const CLASS_UID = "65b58c34-7451-4b89-bea3-483f7c65fe73"; // pass-through (ztlk:Note)

/**
 * VERBATIM leading fragment of the hub's pre-fix body (exoas-exodev@169e6846,
 * `exodev/31c2bdee-db5f-4e0b-b34e-b1b0e2c12bd5.md`). Note the absent opening
 * `---`: the real frontmatter's closing fence played that role, so the body
 * started directly on `exo__Asset_uid:`.
 */
const REAL_HUB_COPY =
  `exo__Asset_uid: 31c2bdee-db5f-4e0b-b34e-b1b0e2c12bd5\n` +
  `exo__Asset_createdAt: 2026-09-10T10:17:11\n` +
  `exo__Asset_updatedAt: 2026-09-11T02:33:29\n` +
  `exo__Instance_class:\n` +
  `  - "[[7db5eeff-718a-49b0-8d2b-39b084a356e3]]"\n` +
  `exo__Asset_createdBy: "[[4ef3962d-b8a7-42b5-bd28-88ec846f1d13]]"\n` +
  `exo__Asset_label: "Слоевое разделение exoas-public: F1 → O4"\n` +
  `exo__Asset_isDefinedBy: "[[32d2374c-1bef-4b64-ad23-e26b53b52df8]]"\n` +
  `ems__Effort_status: "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]"\n` +
  `---\n` +
  `# Слоевое разделение exoas-public\n\n` +
  `⛤ Секция для сессии, поднявшейся после компакции.\n`;

/** The live `exo__Template` shape — 31 such assets exist; it MUST stay legal. */
const TEMPLATE_BODY =
  `---\n` +
  `exo__Asset_isDefinedBy: \n` +
  `exo__Asset_uid: $randomUUIDv4\n` +
  `exo__Asset_createdAt: $nowTimestamp\n` +
  `exo__Instance_class:\n` +
  `  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16]]"\n` +
  `---\n`;

/**
 * Same template, but the PROSE below quotes a real timestamp — a retro note
 * about this very incident does exactly that. Legal: the leading block ends at
 * its own `---`, so the quote below is ordinary content.
 */
const TEMPLATE_BODY_WITH_QUOTE_BELOW =
  TEMPLATE_BODY +
  `\nРазбор инцидента: испорченный хаб нёс строку\n\n` +
  `exo__Asset_createdAt: 2026-09-10T10:17:11\n`;

/**
 * A `---` thematic break followed by prose that QUOTES a real frontmatter line.
 * Legal: the line after the break is not a YAML key, so it is not a fence.
 */
const THEMATIC_BREAK_BODY =
  `---\n\n` +
  `Разбор инцидента 2026-09-13:\n\n` +
  `exo__Asset_uid: 31c2bdee-db5f-4e0b-b34e-b1b0e2c12bd5\n\n` +
  `---\n\n` +
  `Вывод: копию сняли.\n`;

const YAML_FENCE_BODY =
  `# Заголовок\n\n` +
  "```yaml\n" +
  `exo__Asset_uid: 31c2bdee-db5f-4e0b-b34e-b1b0e2c12bd5\n` +
  "```\n";

describe("Ticket e6abe049: a body carrying a frontmatter COPY is refused fail-loud", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let errChunks: string[];
  let exitCodes: number[];

  const taskPath = `${TASKS_DIR}/${TASK_UID}.md`;
  const taskAbs = (): string => path.join(vault, taskPath);
  const originalContent =
    `---\n` +
    `exo__Asset_uid: ${TASK_UID}\n` +
    `exo__Asset_label: "A task"\n` +
    `exo__Asset_updatedAt: 2020-01-01T00:00:00\n` +
    `---\n` +
    `OLD BODY\n`;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-e6abe049-"));
    fs.mkdirSync(path.join(vault, TASKS_DIR), { recursive: true });
    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });
    fs.writeFileSync(taskAbs(), originalContent, "utf-8");

    stdoutChunks = [];
    errChunks = [];
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
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
    errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(((...a: unknown[]) => {
        errChunks.push(a.map(String).join(" "));
      }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  /** Run the REAL set-body with `body` delivered through `--body-file`. */
  async function runSetBodyFile(body: string, extra: string[] = []): Promise<void> {
    const bodyFile = path.join(vault, `body-${Math.random().toString(36).slice(2)}.md`);
    fs.writeFileSync(bodyFile, body, "utf-8");
    await setBodyCommand().parseAsync(
      [taskPath, "--vault", vault, "--body-file", bodyFile, ...extra],
      { from: "user" },
    );
  }

  const GUARD_MSG = /COPY of a frontmatter block/;

  it("Q1: set-body refuses the REAL pre-fix hub body (exoas-exodev@169e6846) and leaves the file byte-identical @req:dbb19e9a-5425-4ccf-94b5-048681359bfb", async () => {
    const before = fs.readFileSync(taskAbs());
    await runSetBodyFile(REAL_HUB_COPY);
    expect(errChunks.join("\n")).toMatch(GUARD_MSG);
    expect(errChunks.join("\n")).toContain("31c2bdee-db5f-4e0b-b34e-b1b0e2c12bd5");
    expect(exitCodes).not.toContain(0);
    expect(fs.readFileSync(taskAbs()).equals(before)).toBe(true);
  });

  it("Q1b: the refusal comes from the guard, not from wikilink validation — it stands with --skip-wikilink-validation @req:dbb19e9a-5425-4ccf-94b5-048681359bfb", async () => {
    const before = fs.readFileSync(taskAbs());
    await runSetBodyFile(REAL_HUB_COPY, ["--skip-wikilink-validation"]);
    expect(errChunks.join("\n")).toMatch(GUARD_MSG);
    expect(exitCodes).not.toContain(0);
    expect(fs.readFileSync(taskAbs()).equals(before)).toBe(true);
  });

  it("Q2: the same copy delivered INLINE via --body is refused too (the mistake is in the content, not the delivery) @req:dbb19e9a-5425-4ccf-94b5-048681359bfb", async () => {
    const before = fs.readFileSync(taskAbs());
    await setBodyCommand().parseAsync(
      [taskPath, "--vault", vault, "--skip-wikilink-validation", "--body", REAL_HUB_COPY],
      { from: "user" },
    );
    expect(errChunks.join("\n")).toMatch(GUARD_MSG);
    expect(fs.readFileSync(taskAbs()).equals(before)).toBe(true);
  });

  it("Q3: a live exo__Template body (placeholder uid/createdAt) is ACCEPTED — 31 such assets exist @req:dbb19e9a-5425-4ccf-94b5-048681359bfb", async () => {
    await runSetBodyFile(TEMPLATE_BODY, ["--skip-wikilink-validation"]);
    expect(errChunks.join("\n")).not.toMatch(GUARD_MSG);
    expect(exitCodes).toContain(0);
    expect(fs.readFileSync(taskAbs(), "utf-8")).toContain("$randomUUIDv4");
  });

  it("Q3b: a template body whose PROSE below quotes a real timestamp is ACCEPTED — the leading block ends at its own --- @req:dbb19e9a-5425-4ccf-94b5-048681359bfb", async () => {
    await runSetBodyFile(TEMPLATE_BODY_WITH_QUOTE_BELOW, ["--skip-wikilink-validation"]);
    expect(errChunks.join("\n")).not.toMatch(GUARD_MSG);
    expect(exitCodes).toContain(0);
    expect(fs.readFileSync(taskAbs(), "utf-8")).toContain("Разбор инцидента");
  });

  it("Q4: an ordinary body (heading, and a real uid inside a ```yaml fence) is ACCEPTED @req:dbb19e9a-5425-4ccf-94b5-048681359bfb", async () => {
    await runSetBodyFile(YAML_FENCE_BODY, ["--skip-wikilink-validation"]);
    expect(errChunks.join("\n")).not.toMatch(GUARD_MSG);
    expect(exitCodes).toContain(0);
    expect(fs.readFileSync(taskAbs(), "utf-8")).toContain("```yaml");
  });

  it("Q5: a `---` thematic break followed by prose quoting a real uid is ACCEPTED — a break is not a fence @req:dbb19e9a-5425-4ccf-94b5-048681359bfb", async () => {
    await runSetBodyFile(THEMATIC_BREAK_BODY, ["--skip-wikilink-validation"]);
    expect(errChunks.join("\n")).not.toMatch(GUARD_MSG);
    expect(exitCodes).toContain(0);
    expect(fs.readFileSync(taskAbs(), "utf-8")).toContain("Вывод: копию сняли.");
  });

  it("Q6: create --body-file refuses the same copy and creates NOTHING @req:dbb19e9a-5425-4ccf-94b5-048681359bfb", async () => {
    const bodyFile = path.join(vault, "copy-body.md");
    fs.writeFileSync(bodyFile, REAL_HUB_COPY, "utf-8");
    const inbox = path.join(vault, "01 Inbox");
    const before = fs.readdirSync(inbox).length;
    await createCommand().parseAsync(
      ["--class", CLASS_UID, "--label", "Fresh note", "--vault", vault, "--body-file", bodyFile],
      { from: "user" },
    );
    expect(errChunks.join("\n")).toMatch(GUARD_MSG);
    expect(exitCodes).not.toContain(0);
    expect(fs.readdirSync(inbox).length).toBe(before);
  });

  it("Q7: create --body-file with an ordinary body still works (control) @req:dbb19e9a-5425-4ccf-94b5-048681359bfb", async () => {
    const bodyFile = path.join(vault, "ok-body.md");
    fs.writeFileSync(bodyFile, "# Fresh\n\nplain content\n", "utf-8");
    await createCommand().parseAsync(
      ["--class", CLASS_UID, "--label", "Fresh note", "--vault", vault, "--body-file", bodyFile],
      { from: "user" },
    );
    expect(errChunks.join("\n")).not.toMatch(GUARD_MSG);
    expect(stdoutChunks.join("")).toContain("uuid");
  });
});
