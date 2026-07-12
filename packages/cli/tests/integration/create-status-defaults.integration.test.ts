/**
 * Issue #3849 — `cli create` must set a default `ems__Effort_status` (Backlog)
 * for status-bearing classes (ems__Effort subclasses) and a default
 * `exo__Asset_createdBy` (ExoAssistant), plus accept `--status` / `--yes`.
 *
 * Drives the REAL `createCommand()` action end-to-end against a temp fixture
 * vault (class defs + status enums + inbox), reads the written file back from
 * disk, and asserts the emitted frontmatter — the production create pipeline,
 * not hand-injected frontmatter (test-fixture-realism).
 *
 * Status-bearing detection uses real class-hierarchy walking: the fixture's
 * ems__Task class def has `exo__Class_superClass → ems__Effort`, so the walk
 * reaches ems__Effort and injects Backlog. concept__Concept has no Effort
 * ancestor → no status. Uses the real production UIDs (ems__Task / ems__Effort
 * / Backlog / Draft / ExoAssistant) so the assertions mirror real output.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * Edit-break the status/createdBy default injection in `create.ts` → the
 * status-bearing / createdBy assertions go RED; restored → GREEN. The
 * non-status-bearing case isolates non-vacuity (never gets a status either way).
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { createCommand } = await import("../../src/commands/create.js");

// Real production UIDs so assertions mirror live output.
const TASK_CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const EFFORT_CLASS_UID = "086f71fa-dd30-4284-90cf-e609f2a6c461";
const BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const DRAFT_UID = "c42245d0-01de-4c35-bfcf-d910445ea28e";
const EXOASSISTANT_UID = "4ef3962d-b8a7-42b5-bd28-88ec846f1d13";
// Non-status-bearing class (its superClass points at exo__Asset, which the
// fixture does NOT define → the walk terminates without reaching ems__Effort).
const CONCEPT_CLASS_UID = "c0c0c0c0-1111-2222-3333-444444444444";

const EMS_DIR = "assetspaces/kitelev/exoas-public/ems";

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
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

describe("Issue #3849: `cli create` sets default ems__Effort_status + createdBy", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3849-"));

    const emsDir = path.join(vault, EMS_DIR);
    fs.mkdirSync(emsDir, { recursive: true });

    // ems__Effort root class (carries ems__Effort_status).
    fs.writeFileSync(
      path.join(emsDir, `${EFFORT_CLASS_UID}.md`),
      md({ exo__Asset_uid: EFFORT_CLASS_UID, exo__Asset_label: "ems__Effort" }),
    );
    // ems__Task class — subclass of ems__Effort → status-bearing.
    fs.writeFileSync(
      path.join(emsDir, `${TASK_CLASS_UID}.md`),
      md({
        exo__Asset_uid: TASK_CLASS_UID,
        exo__Asset_label: "ems__Task",
        exo__Class_superClass: [`[[${EFFORT_CLASS_UID}]]`],
      }),
    );
    // concept__Concept class — superClass → exo__Asset (undefined here) →
    // NOT status-bearing (the walk never reaches ems__Effort).
    fs.writeFileSync(
      path.join(emsDir, `${CONCEPT_CLASS_UID}.md`),
      md({
        exo__Asset_uid: CONCEPT_CLASS_UID,
        exo__Asset_label: "concept__Concept",
        exo__Class_superClass: ["[[exo__Asset]]"],
      }),
    );
    // Status enums.
    fs.writeFileSync(
      path.join(emsDir, `${BACKLOG_UID}.md`),
      md({ exo__Asset_uid: BACKLOG_UID, exo__Asset_label: "ems__EffortStatusBacklog" }),
    );
    fs.writeFileSync(
      path.join(emsDir, `${DRAFT_UID}.md`),
      md({ exo__Asset_uid: DRAFT_UID, exo__Asset_label: "ems__EffortStatusDraft" }),
    );
    // ExoAssistant identity (createdBy default target).
    fs.writeFileSync(
      path.join(emsDir, `${EXOASSISTANT_UID}.md`),
      md({ exo__Asset_uid: EXOASSISTANT_UID, exo__Asset_label: "ExoAssistant" }),
    );

    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });

    stdoutChunks = [];
    exitCodes = [];
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

  /** Run the real create command; returns parsed JSON + on-disk content. */
  async function runCreate(
    classUid: string,
    extraArgs: string[],
  ): Promise<{ uuid: string; path: string; content: string; exit: number[] }> {
    const cmd = createCommand();
    const argv = [
      "--class",
      classUid,
      "--label",
      "E2E-3849 status defaults",
      "--vault",
      vault,
      ...extraArgs,
    ];
    await cmd.parseAsync(argv, { from: "user" });

    const json = stdoutChunks.join("").trim();
    if (!json) {
      return { uuid: "", path: "", content: "", exit: [...exitCodes] };
    }
    const parsed = JSON.parse(json) as { uuid: string; path: string };
    const content = fs.readFileSync(path.join(vault, parsed.path), "utf-8");
    return { uuid: parsed.uuid, path: parsed.path, content, exit: [...exitCodes] };
  }

  it("status-bearing class → default Backlog + createdBy ExoAssistant @req:b341020e-8f27-452b-9df6-da4247408b2e", async () => {
    const out = await runCreate(TASK_CLASS_UID, []);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);
    // Default status = Backlog (scalar UID-canon wikilink).
    expect(out.content).toContain(`ems__Effort_status: "[[${BACKLOG_UID}]]"`);
    // Default creator = ExoAssistant.
    expect(out.content).toContain(`exo__Asset_createdBy: "[[${EXOASSISTANT_UID}]]"`);
  });

  it("--status Draft → Draft status (status-bearing) @req:b341020e-8f27-452b-9df6-da4247408b2e", async () => {
    const out = await runCreate(TASK_CLASS_UID, ["--status", "Draft"]);

    expect(out.exit).toContain(0);
    expect(out.content).toContain(`ems__Effort_status: "[[${DRAFT_UID}]]"`);
    // The default Backlog must NOT also appear.
    expect(out.content).not.toContain(BACKLOG_UID);
  });

  it("non-status-bearing class → no status, still createdBy @req:b341020e-8f27-452b-9df6-da4247408b2e", async () => {
    const out = await runCreate(CONCEPT_CLASS_UID, []);

    expect(out.exit).toContain(0);
    expect(out.content).not.toContain("ems__Effort_status");
    // createdBy default applies to every class (not status-gated).
    expect(out.content).toContain(`exo__Asset_createdBy: "[[${EXOASSISTANT_UID}]]"`);
  });

  it("--status on a non-status-bearing class → fail-loud error @req:b341020e-8f27-452b-9df6-da4247408b2e", async () => {
    const out = await runCreate(CONCEPT_CLASS_UID, ["--status", "Draft"]);

    // The command handles the error via ErrorHandler → exit(1), no success JSON.
    expect(out.uuid).toBe("");
    expect(out.exit).toContain(1);
    const stderrLog = errorSpy.mock.calls.flat().join("\n");
    expect(stderrLog).toMatch(/status.bearing/i);
  });

  it("--created-by <uid> overrides the ExoAssistant default @req:b341020e-8f27-452b-9df6-da4247408b2e", async () => {
    const customCreator = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const out = await runCreate(CONCEPT_CLASS_UID, ["--created-by", customCreator]);

    expect(out.exit).toContain(0);
    expect(out.content).toContain(`exo__Asset_createdBy: "[[${customCreator}]]"`);
    expect(out.content).not.toContain(EXOASSISTANT_UID);
  });

  it("--yes is accepted (no 'unknown option'; create succeeds) @req:b341020e-8f27-452b-9df6-da4247408b2e", async () => {
    const out = await runCreate(CONCEPT_CLASS_UID, ["--yes"]);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);
    expect(out.uuid).not.toBe("");
  });

  it("explicit --property ems__Effort_status wins over the default @req:b341020e-8f27-452b-9df6-da4247408b2e", async () => {
    const out = await runCreate(TASK_CLASS_UID, [
      "--property",
      `ems__Effort_status=[[${DRAFT_UID}]]`,
      "--skip-wikilink-validation",
    ]);

    expect(out.exit).toContain(0);
    expect(out.content).toContain(`ems__Effort_status: "[[${DRAFT_UID}]]"`);
    // The Backlog default must NOT override an explicit value.
    expect(out.content).not.toContain(BACKLOG_UID);
  });

  it("--status conflicts with --property ems__Effort_status → error @req:b341020e-8f27-452b-9df6-da4247408b2e", async () => {
    const out = await runCreate(TASK_CLASS_UID, [
      "--status",
      "Draft",
      "--property",
      `ems__Effort_status=[[${DRAFT_UID}]]`,
      "--skip-wikilink-validation",
    ]);

    expect(out.uuid).toBe("");
    expect(out.exit).toContain(1);
    const stderrLog = errorSpy.mock.calls.flat().join("\n");
    expect(stderrLog).toMatch(/both --status and --property/i);
  });
});
