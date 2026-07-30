/**
 * Issue #3928 — `cli create --no-status` suppresses the default
 * `ems__Effort_status` injection (#3849) for a status-bearing class, so a
 * recurring/template prototype is created WITHOUT a status. Without the flag
 * the #3849 default is unchanged (backward-compat). `--no-status` combined with
 * an explicit `--property ems__Effort_status=...` is an ambiguity error.
 *
 * Drives the REAL `createCommand()` action end-to-end against a temp fixture
 * vault (class defs + status enums + inbox), reads the written file back from
 * disk, and asserts the emitted frontmatter — the production create pipeline,
 * not hand-injected frontmatter (test-fixture-realism).
 *
 * Status-bearing detection uses real class-hierarchy walking: the fixture's
 * ems__TaskPrototype → ems__Task → ems__Effort chain reaches ems__Effort, so
 * WITHOUT --no-status it injects Backlog; WITH --no-status it does not.
 * concept__Concept has no Effort ancestor → never a status either way (isolates
 * the --no-status no-op for a non-status-bearing class).
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * Edit-break the `!noStatus` guard in create.ts (drop the `&& !noStatus`) → the
 * prototype gets Backlog again → the --no-status suppression assertion goes RED;
 * restored → GREEN. The backward-compat scenario proves the default still fires
 * (non-vacuity); the ambiguity scenario reds if the guard is removed.
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
// A status-bearing PROTOTYPE class (the AC's `--class <Prototype>`): its
// superClass chain reaches ems__Effort via ems__Task → status-bearing.
const TASK_PROTOTYPE_UID = "df7e579d-0000-4000-8000-000000000001";
// Non-status-bearing class (superClass → exo__Asset, undefined here → the walk
// terminates without reaching ems__Effort).
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

describe("Issue #3928: `cli create --no-status` suppresses the default ems__Effort_status", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3928-"));

    const emsDir = path.join(vault, EMS_DIR);
    fs.mkdirSync(emsDir, { recursive: true });

    // ems__Effort root class (carries ems__Effort_status).
    fs.writeFileSync(
      path.join(emsDir, `${EFFORT_CLASS_UID}.md`),
      md({ exo__Asset_uid: EFFORT_CLASS_UID, exo__Asset_label: "ems__Effort" }),
    );
    // ems__Task — subclass of ems__Effort → status-bearing.
    fs.writeFileSync(
      path.join(emsDir, `${TASK_CLASS_UID}.md`),
      md({
        exo__Asset_uid: TASK_CLASS_UID,
        exo__Asset_label: "ems__Task",
        exo__Class_superClass: [`[[${EFFORT_CLASS_UID}]]`],
      }),
    );
    // ems__TaskPrototype — subclass of ems__Task → transitively status-bearing.
    fs.writeFileSync(
      path.join(emsDir, `${TASK_PROTOTYPE_UID}.md`),
      md({
        exo__Asset_uid: TASK_PROTOTYPE_UID,
        exo__Asset_label: "ems__TaskPrototype",
        exo__Class_superClass: [`[[${TASK_CLASS_UID}]]`],
      }),
    );
    // concept__Concept — superClass → exo__Asset (undefined here) → NOT
    // status-bearing (the walk never reaches ems__Effort).
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
      "E2E-3928 no-status",
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

  it("--no-status on a status-bearing prototype → NO ems__Effort_status @req:d214c122-e09b-4826-a827-242c5e5745a1", async () => {
    const out = await runCreate(TASK_PROTOTYPE_UID, ["--no-status"]);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);
    expect(out.uuid).not.toBe("");
    // The default Backlog was suppressed — no status of any form.
    expect(out.content).not.toContain("ems__Effort_status");
    expect(out.content).not.toContain(BACKLOG_UID);
    // createdBy default still applies (not status-gated).
    expect(out.content).toContain(`exo__Asset_createdBy: "[[${EXOASSISTANT_UID}]]"`);
  });

  it("WITHOUT --no-status the #3849 Backlog default is unchanged (backward-compat) @req:d214c122-e09b-4826-a827-242c5e5745a1", async () => {
    const out = await runCreate(TASK_PROTOTYPE_UID, []);

    expect(out.exit).toContain(0);
    // The default DOES fire without the flag → proves the suppression above is
    // non-vacuous (the flag is what removes it).
    expect(out.content).toContain(`ems__Effort_status: "[[${BACKLOG_UID}]]"`);
  });

  it("--no-status + explicit --property ems__Effort_status → fail-loud ambiguity error @req:d214c122-e09b-4826-a827-242c5e5745a1", async () => {
    const out = await runCreate(TASK_PROTOTYPE_UID, [
      "--no-status",
      "--property",
      `ems__Effort_status=[[${DRAFT_UID}]]`,
      "--skip-wikilink-validation",
    ]);

    // Handled via ErrorHandler → exit(1), no success JSON, file not written.
    expect(out.uuid).toBe("");
    expect(out.exit).toContain(1);
    const stderrLog = errorSpy.mock.calls.flat().join("\n");
    expect(stderrLog).toMatch(/no-status/i);
    expect(stderrLog).toMatch(/ambiguous/i);
  });

  it("--no-status on a non-status-bearing class → harmless no-op success @req:d214c122-e09b-4826-a827-242c5e5745a1", async () => {
    const out = await runCreate(CONCEPT_CLASS_UID, ["--no-status"]);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);
    expect(out.uuid).not.toBe("");
    // No status was injected anyway; --no-status is a no-op here.
    expect(out.content).not.toContain("ems__Effort_status");
    expect(out.content).toContain(`exo__Asset_createdBy: "[[${EXOASSISTANT_UID}]]"`);
  });
});
