/**
 * Issue #3111: `command rename-to-uid --dry-run` must not mutate the filesystem.
 *
 * Audits dry-run contract across all `command` subcommands that mutate fs/frontmatter:
 * rename-to-uid, update-label, start, complete, trash, archive,
 * move-to-backlog, schedule, set-deadline,
 * create-task, create-meeting, create-project, create-area.
 *
 * Uses real filesystem (temp dir), not mocks — to guarantee fs contract.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { CommandExecutor } = await import("../../src/executors/CommandExecutor.js");

const ASSET_UID = "af48544e-c264-44f6-bb12-46cef2ad1acb";

function buildTaskMd(opts: { uid?: string; label?: string; status?: string } = {}): string {
  const lines = ["---"];
  if (opts.uid) lines.push(`exo__Asset_uid: ${opts.uid}`);
  if (opts.label !== undefined) lines.push(`exo__Asset_label: ${opts.label}`);
  lines.push(`exo__Instance_class:`);
  lines.push(`  - "[[ems__Task]]"`);
  lines.push(`ems__Effort_status: "${opts.status ?? "[[ems__EffortStatusToDo]]"}"`);
  lines.push("---");
  lines.push("");
  lines.push("# Body");
  return lines.join("\n");
}

describe("Issue #3111: `command --dry-run` filesystem contract", () => {
  let vaultRoot: string;
  let processExitSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let exitCalled: boolean;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-cli-dryrun-"));
    exitCalled = false;
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCalled = true;
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as any);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  async function runSilently(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e: any) {
      if (!/^__process_exit_/.test(String(e?.message))) throw e;
    }
  }

  function snapshot(file: string): { content: string; mtime: number; ino: number } {
    const st = fs.statSync(file);
    return {
      content: fs.readFileSync(file, "utf-8"),
      mtime: st.mtimeMs,
      ino: st.ino,
    };
  }

  describe("rename-to-uid --dry-run (Issue #3111 primary)", () => {
    it("@req:cd33eff0-4414-4fc3-8fa5-461bb92093fc does not rename file or mutate frontmatter", async () => {
      const filePath = path.join(vaultRoot, "Note.md");
      fs.writeFileSync(filePath, buildTaskMd({ uid: ASSET_UID, label: "Note" }), "utf-8");
      const before = snapshot(filePath);

      const exec = new CommandExecutor(vaultRoot, /* dryRun */ true);
      await runSilently(() => exec.executeRenameToUid("Note.md"));

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.existsSync(path.join(vaultRoot, `${ASSET_UID}.md`))).toBe(false);
      const after = snapshot(filePath);
      expect(after.content).toBe(before.content);
      expect(after.ino).toBe(before.ino);

      const out = consoleLogSpy.mock.calls.flat().join("\n");
      expect(out).toMatch(/\[dry-run\]/);
      expect(out).toMatch(/Would rename/i);
      expect(out).not.toMatch(/^✅ Renamed to UID format/m);
    });

    it("does not write missing label under dry-run", async () => {
      const filePath = path.join(vaultRoot, "Note.md");
      fs.writeFileSync(filePath, buildTaskMd({ uid: ASSET_UID, label: "" }), "utf-8");
      const before = snapshot(filePath);

      const exec = new CommandExecutor(vaultRoot, true);
      await runSilently(() => exec.executeRenameToUid("Note.md"));

      const after = snapshot(filePath);
      expect(after.content).toBe(before.content);
    });
  });

  describe("update-label --dry-run", () => {
    it("does not write file", async () => {
      const filePath = path.join(vaultRoot, "task.md");
      fs.writeFileSync(filePath, buildTaskMd({ uid: ASSET_UID, label: "Old" }), "utf-8");
      const before = snapshot(filePath);

      const exec = new CommandExecutor(vaultRoot, true);
      await runSilently(() => exec.executeUpdateLabel("task.md", "New Label"));

      expect(snapshot(filePath).content).toBe(before.content);
    });
  });

  describe("status transitions --dry-run", () => {
    const cases: Array<[string, (e: any) => Promise<void>]> = [
      ["start", (e) => e.executeStart("task.md")],
      ["complete", (e) => e.executeComplete("task.md")],
      ["trash", (e) => e.executeTrash("task.md")],
      ["archive", (e) => e.executeArchive("task.md")],
      ["move-to-backlog", (e) => e.executeMoveToBacklog("task.md")],
    ];

    it.each(cases)("%s does not mutate file", async (_name, fn) => {
      const filePath = path.join(vaultRoot, "task.md");
      fs.writeFileSync(filePath, buildTaskMd({ uid: ASSET_UID, label: "T" }), "utf-8");
      const before = snapshot(filePath);

      const exec = new CommandExecutor(vaultRoot, true);
      await runSilently(() => fn(exec));

      expect(snapshot(filePath).content).toBe(before.content);
    });
  });

  describe("planning commands --dry-run", () => {
    it("schedule does not write timestamp", async () => {
      const filePath = path.join(vaultRoot, "task.md");
      fs.writeFileSync(filePath, buildTaskMd({ uid: ASSET_UID, label: "T" }), "utf-8");
      const before = snapshot(filePath);

      const exec = new CommandExecutor(vaultRoot, true);
      await runSilently(() => exec.executeSchedule("task.md", "2026-06-01"));

      expect(snapshot(filePath).content).toBe(before.content);
    });

    it("set-deadline does not write timestamp", async () => {
      const filePath = path.join(vaultRoot, "task.md");
      fs.writeFileSync(filePath, buildTaskMd({ uid: ASSET_UID, label: "T" }), "utf-8");
      const before = snapshot(filePath);

      const exec = new CommandExecutor(vaultRoot, true);
      await runSilently(() => exec.executeSetDeadline("task.md", "2026-06-01"));

      expect(snapshot(filePath).content).toBe(before.content);
    });
  });

  describe("creation commands --dry-run", () => {
    const cases: Array<[string, (e: any) => Promise<void>]> = [
      ["create-task", (e) => e.executeCreateTask("new-task.md", "New Task")],
      ["create-meeting", (e) => e.executeCreateMeeting("new-meeting.md", "New Meeting")],
      ["create-project", (e) => e.executeCreateProject("new-project.md", "New Project")],
      ["create-area", (e) => e.executeCreateArea("new-area.md", "New Area")],
    ];

    it.each(cases)("%s does not create file", async (_name, fn) => {
      const exec = new CommandExecutor(vaultRoot, true);
      await runSilently(() => fn(exec));

      const files = fs.readdirSync(vaultRoot);
      expect(files).toEqual([]);
    });
  });
});
