import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import yaml from "js-yaml";

import {
  listClaudeChildSessions,
  findVaultFile,
  isTaskDoing,
  detectOrphans,
  recoverOrphan,
  runOrphanRecovery,
  type ExecFn,
  type OrphanSession,
} from "../../../src/services/OrphanRecoveryService.js";
import type { AtomicUpdateResult } from "../../../src/services/AtomicFrontmatterService.js";

const FULL_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const SHORT_UUID_PREFIX = "a1b2c3d4";
const SHORT_SESSION = `claude-child-${SHORT_UUID_PREFIX}-1777826100`;
const FULL_SESSION = `claude-child-${FULL_UUID}`;

function makeSessionExecFn(sessionNames: string[]): ExecFn {
  return (_cmd, cb) => {
    cb(null, sessionNames.join("\n"), "");
    return {};
  };
}

function failExecFn(): ExecFn {
  return (_cmd, cb) => {
    cb(new Error("tmux not available"), "", "");
    return {};
  };
}

function noopExecFn(): ExecFn {
  return (_cmd, cb) => {
    cb(null, "", "");
    return {};
  };
}

function buildMd(fm: Record<string, unknown>): string {
  return `---\n${yaml.dump(fm)}---\n`;
}

describe("OrphanRecoveryService", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "orphan-svc-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── listClaudeChildSessions ─────────────────────────────────────────

  describe("listClaudeChildSessions", () => {
    it("parses full-UUID session", async () => {
      const result = await listClaudeChildSessions(
        makeSessionExecFn([FULL_SESSION]),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sessionName: FULL_SESSION,
        uuid: FULL_UUID,
        type: "full",
      });
    });

    it("parses short-UUID session", async () => {
      const result = await listClaudeChildSessions(
        makeSessionExecFn([SHORT_SESSION]),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sessionName: SHORT_SESSION,
        uuid: SHORT_UUID_PREFIX,
        type: "short",
      });
    });

    it("ignores non-claude-child sessions", async () => {
      const result = await listClaudeChildSessions(
        makeSessionExecFn(["n8n", "claude-orch-w1-123", "main"]),
      );
      expect(result).toHaveLength(0);
    });

    it("returns empty array when tmux fails", async () => {
      const result = await listClaudeChildSessions(failExecFn());
      expect(result).toHaveLength(0);
    });

    it("handles multiple sessions of different types", async () => {
      const result = await listClaudeChildSessions(
        makeSessionExecFn([FULL_SESSION, SHORT_SESSION, "irrelevant"]),
      );
      expect(result).toHaveLength(2);
    });
  });

  // ── findVaultFile ───────────────────────────────────────────────────

  describe("findVaultFile", () => {
    it("finds a file by full UUID (exact match)", () => {
      writeFileSync(path.join(tmpDir, `${FULL_UUID}.md`), "---\n---\n");
      const result = findVaultFile(tmpDir, FULL_UUID, "full");
      expect(result).toBe(path.join(tmpDir, `${FULL_UUID}.md`));
    });

    it("finds a file by UUID prefix (short match)", () => {
      writeFileSync(path.join(tmpDir, `${FULL_UUID}.md`), "---\n---\n");
      const result = findVaultFile(tmpDir, SHORT_UUID_PREFIX, "short");
      expect(result).toBe(path.join(tmpDir, `${FULL_UUID}.md`));
    });

    it("searches recursively in subdirectories", () => {
      const sub = path.join(tmpDir, "sub", "deep");
      mkdirSync(sub, { recursive: true });
      writeFileSync(path.join(sub, `${FULL_UUID}.md`), "---\n---\n");
      const result = findVaultFile(tmpDir, FULL_UUID, "full");
      expect(result).toBe(path.join(sub, `${FULL_UUID}.md`));
    });

    it("returns null when not found", () => {
      const result = findVaultFile(tmpDir, "00000000-0000-0000-0000-000000000000", "full");
      expect(result).toBeNull();
    });

    it("skips hidden directories", () => {
      const hidden = path.join(tmpDir, ".obsidian");
      mkdirSync(hidden, { recursive: true });
      writeFileSync(path.join(hidden, `${FULL_UUID}.md`), "---\n---\n");
      const result = findVaultFile(tmpDir, FULL_UUID, "full");
      expect(result).toBeNull();
    });
  });

  // ── isTaskDoing ─────────────────────────────────────────────────────

  describe("isTaskDoing", () => {
    it("returns true when status is Doing", () => {
      const filePath = path.join(tmpDir, "task.md");
      writeFileSync(
        filePath,
        buildMd({ ems__Effort_status: "[[ems__EffortStatusDoing]]" }),
      );
      expect(isTaskDoing(filePath)).toBe(true);
    });

    it("returns false when status is Backlog", () => {
      const filePath = path.join(tmpDir, "task.md");
      writeFileSync(
        filePath,
        buildMd({ ems__Effort_status: "[[ems__EffortStatusBacklog]]" }),
      );
      expect(isTaskDoing(filePath)).toBe(false);
    });

    it("returns false when status is Failed", () => {
      const filePath = path.join(tmpDir, "task.md");
      writeFileSync(
        filePath,
        buildMd({ ems__Effort_status: "[[ems__EffortStatusFailed]]" }),
      );
      expect(isTaskDoing(filePath)).toBe(false);
    });

    it("returns false when file does not exist", () => {
      expect(isTaskDoing(path.join(tmpDir, "nonexistent.md"))).toBe(false);
    });

    it("accepts injected readFn", () => {
      const fakePath = "/fake/path.md";
      const readFn = (_p: string) => "---\nems__Effort_status: \"[[ems__EffortStatusDoing]]\"\n---\n";
      expect(isTaskDoing(fakePath, readFn)).toBe(true);
    });
  });

  // ── detectOrphans ───────────────────────────────────────────────────

  describe("detectOrphans", () => {
    it("reports orphan when vault file not found", async () => {
      const orphans = await detectOrphans(
        tmpDir,
        makeSessionExecFn([FULL_SESSION]),
      );
      expect(orphans).toHaveLength(1);
      expect(orphans[0].reason).toContain("not found");
      expect(orphans[0].taskFilePath).toBeNull();
    });

    it("reports orphan when vault task status is not Doing", async () => {
      writeFileSync(
        path.join(tmpDir, `${FULL_UUID}.md`),
        buildMd({
          exo__Asset_uid: FULL_UUID,
          ems__Effort_status: "[[ems__EffortStatusBacklog]]",
        }),
      );
      const orphans = await detectOrphans(
        tmpDir,
        makeSessionExecFn([FULL_SESSION]),
      );
      expect(orphans).toHaveLength(1);
      expect(orphans[0].reason).toContain("status != Doing");
    });

    it("does not report orphan when task is Doing", async () => {
      writeFileSync(
        path.join(tmpDir, `${FULL_UUID}.md`),
        buildMd({
          exo__Asset_uid: FULL_UUID,
          ems__Effort_status: "[[ems__EffortStatusDoing]]",
        }),
      );
      const orphans = await detectOrphans(
        tmpDir,
        makeSessionExecFn([FULL_SESSION]),
      );
      expect(orphans).toHaveLength(0);
    });

    it("handles short-UUID session finding vault file by prefix", async () => {
      writeFileSync(
        path.join(tmpDir, `${FULL_UUID}.md`),
        buildMd({
          exo__Asset_uid: FULL_UUID,
          ems__Effort_status: "[[ems__EffortStatusDone]]",
        }),
      );
      const orphans = await detectOrphans(
        tmpDir,
        makeSessionExecFn([SHORT_SESSION]),
      );
      expect(orphans).toHaveLength(1);
      expect(orphans[0].taskFilePath).toBeTruthy();
    });

    it("returns empty when no claude-child sessions", async () => {
      const orphans = await detectOrphans(tmpDir, makeSessionExecFn([]));
      expect(orphans).toHaveLength(0);
    });
  });

  // ── recoverOrphan ───────────────────────────────────────────────────

  describe("recoverOrphan", () => {
    const killCmds: string[] = [];
    const updateCalls: Array<[string, Record<string, unknown>]> = [];

    let trackExecFn: ExecFn;
    let mockUpdateFn: (
      filePath: string,
      updates: Record<string, unknown>,
    ) => AtomicUpdateResult;

    beforeEach(() => {
      killCmds.length = 0;
      updateCalls.length = 0;
      trackExecFn = (cmd, cb) => {
        killCmds.push(cmd);
        cb(null, "", "");
        return {};
      };
      mockUpdateFn = (fp, updates) => {
        updateCalls.push([fp, updates]);
        return { success: true, verified: true };
      };
    });

    it("dry-run: does not kill session or update vault", async () => {
      const orphan: OrphanSession = {
        sessionName: FULL_SESSION,
        taskUuid: FULL_UUID,
        taskFilePath: path.join(tmpDir, `${FULL_UUID}.md`),
        reason: "test",
      };
      const result = await recoverOrphan(orphan, true, trackExecFn, mockUpdateFn);
      expect(result.ok).toBe(true);
      expect(killCmds).toHaveLength(0);
      expect(updateCalls).toHaveLength(0);
    });

    it("apply: updates vault and kills session when file exists", async () => {
      const filePath = path.join(tmpDir, `${FULL_UUID}.md`);
      writeFileSync(
        filePath,
        buildMd({ ems__Effort_status: "[[ems__EffortStatusDoing]]" }),
      );
      const orphan: OrphanSession = {
        sessionName: FULL_SESSION,
        taskUuid: FULL_UUID,
        taskFilePath: filePath,
        reason: "vault task status != Doing",
      };
      const result = await recoverOrphan(orphan, false, trackExecFn, mockUpdateFn);
      expect(result.ok).toBe(true);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][1]["ems__Effort_status"]).toBe("[[ems__EffortStatusFailed]]");
      expect(String(updateCalls[0][1]["aiTask__Task_lastError"])).toContain("orphan recovery");
      expect(killCmds.some((c) => c.includes(FULL_SESSION))).toBe(true);
    });

    it("apply: kills session even when vault file not found", async () => {
      const orphan: OrphanSession = {
        sessionName: FULL_SESSION,
        taskUuid: FULL_UUID,
        taskFilePath: null,
        reason: "vault task not found",
      };
      const result = await recoverOrphan(orphan, false, trackExecFn, mockUpdateFn);
      expect(result.ok).toBe(true);
      expect(updateCalls).toHaveLength(0);
      expect(killCmds.some((c) => c.includes(FULL_SESSION))).toBe(true);
    });

    it("handles tmux kill-session failure gracefully", async () => {
      const failKillExec: ExecFn = (cmd, cb) => {
        if (cmd.includes("kill-session")) {
          cb(new Error("no such session"), "", "");
        } else {
          cb(null, "", "");
        }
        return {};
      };
      const orphan: OrphanSession = {
        sessionName: FULL_SESSION,
        taskUuid: FULL_UUID,
        taskFilePath: null,
        reason: "vault task not found",
      };
      const result = await recoverOrphan(
        orphan,
        false,
        failKillExec,
        mockUpdateFn,
      );
      expect(result.ok).toBe(true);
    });
  });

  // ── runOrphanRecovery ───────────────────────────────────────────────

  describe("runOrphanRecovery", () => {
    it("dry-run reports orphan count without mutations", async () => {
      const result = await runOrphanRecovery(
        tmpDir,
        true,
        makeSessionExecFn([FULL_SESSION]),
      );
      expect(result.orphans).toBe(1);
      expect(result.recovered).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors).toBe(0);
    });

    it("apply mode increments recovered count", async () => {
      const result = await runOrphanRecovery(
        tmpDir,
        false,
        makeSessionExecFn([FULL_SESSION]),
        undefined,
        (fp, updates) => {
          void fp; void updates;
          return { success: true, verified: true };
        },
      );
      expect(result.orphans).toBe(1);
      expect(result.recovered).toBe(1);
      expect(result.errors).toBe(0);
    });

    it("returns zeros when no sessions", async () => {
      const result = await runOrphanRecovery(
        tmpDir,
        true,
        makeSessionExecFn([]),
      );
      expect(result.orphans).toBe(0);
      expect(result.recovered).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
    });
  });
});
