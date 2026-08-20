/**
 * Integration smoke test for Phase 6 ai-task pipeline.
 *
 * Tests the end-to-end flow with real filesystem I/O:
 *   delegated task file (Backlog) → spawnSession → completion detection → status flip
 *
 * Mocks only tmux exec calls; uses real AtomicFrontmatterService to update files.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir, homedir } from "os";
import path from "path";
import * as yaml from "js-yaml";
import { spawnSession } from "../../src/services/SpawnService.js";
import type { ExecFn, SpawnDeps } from "../../src/services/SpawnService.js";
import { atomicUpdateFrontmatter } from "../../src/services/AtomicFrontmatterService.js";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TASK_UUID = "e2e-smoke-0000-4ccd-9a1b-d90c04360148";
const WINDOW_NAME = `claude-child-${TASK_UUID}`;

function buildDelegatedTaskMd(): string {
  const fm: Record<string, unknown> = {
    exo__Asset_uid: TASK_UUID,
    exo__Asset_label: "Smoke test delegated task",
    "ems__Effort_status": "[[ems__EffortStatusBacklog]]",
    "aiTask__Task_delegated": "true",
    "aiTask__Task_model": "sonnet",
    "aiTask__Task_timeoutMinutes": 1,
  };
  return `---\n${yaml.dump(fm)}---\n## Body\nDo something useful.\n`;
}

function parseFrontmatter(filePath: string): Record<string, unknown> {
  const content = readFileSync(filePath, "utf8");
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("No frontmatter in " + filePath);
  const parsed = parseFrontmatterAsReader(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid frontmatter");
  }
  return parsed as Record<string, unknown>;
}

function makeNopExecFn(): ExecFn {
  return (_cmd, cb) => {
    cb(null, "", "");
    return {};
  };
}

function makeWindowAliveExecFn(): ExecFn {
  return (cmd, cb) => {
    if (cmd.includes("list-windows")) {
      cb(null, `${WINDOW_NAME}\n`, "");
    } else {
      cb(null, "", "");
    }
    return {};
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let taskFile: string;

// Synthetic log file path that spawnSession writes to
const logFile = path.join(homedir(), ".exocortex", "ai-task-logs", `${TASK_UUID}.log`);

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "smoke-test-"));
  taskFile = path.join(tmpDir, `${TASK_UUID}.md`);
  writeFileSync(taskFile, buildDelegatedTaskMd());
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Smoke tests
// ---------------------------------------------------------------------------

describe("Phase 6 smoke — full delegated task pipeline", () => {
  it(
    "task goes from Backlog to Review when claude outputs DONE: marker (T1.4 path)",
    async () => {
      const claudeLog = "Claude processing...\nDone thinking\nDONE: task completed successfully\n";

      const deps: SpawnDeps = {
        execFn: makeWindowAliveExecFn(),
        atomicUpdate: atomicUpdateFrontmatter,
        pollIntervalMs: 600_000, // tmux won't fire before vault
        readFileFn: (p) => {
          if (p === logFile) return claudeLog;
          return readFileSync(p, "utf8"); // real vault file read
        },
        vaultPollIntervalMs: 300, // fast polls for test
        countClaudeSessionsFn: async () => 0,
      };

      const code = await spawnSession(
        {
          taskFilePath: taskFile,
          taskUuid: TASK_UUID,
          model: "sonnet",
          timeoutMinutes: 2 / 60, // 2 second vault timeout
        },
        deps,
      );

      // Should succeed via DONE: detection (T1.4)
      expect(code).toBe(0);

      const fm = parseFrontmatter(taskFile);
      expect(String(fm["ems__Effort_status"] ?? "")).toContain("EffortStatusReview");
    },
    15_000,
  );

  it(
    "task is deferred (returns 2) when 4 claude sessions are already running",
    async () => {
      const code = await spawnSession(
        {
          taskFilePath: taskFile,
          taskUuid: TASK_UUID,
          model: "sonnet",
          timeoutMinutes: 1,
        },
        {
          execFn: makeNopExecFn(),
          atomicUpdate: atomicUpdateFrontmatter,
          countClaudeSessionsFn: async () => 4, // at cap
        },
      );

      expect(code).toBe(2);

      // Real frontmatter should reflect deferral
      const fm = parseFrontmatter(taskFile);
      expect(String(fm["ems__Effort_status"] ?? "")).toContain("EffortStatusBacklog");
      expect(fm["aiTask__Task_deferReason"]).toBeTruthy();
      expect(String(fm["aiTask__Task_deferReason"])).toContain("cap reached");
      expect(fm["aiTask__Task_claimedBy"]).toBeNull();
    },
    10_000,
  );

  it(
    "3 claude sessions → proceeds with spawn (below cap)",
    async () => {
      const code = await spawnSession(
        {
          taskFilePath: taskFile,
          taskUuid: TASK_UUID,
          model: "sonnet",
          timeoutMinutes: 1 / 60, // 1 second timeout
        },
        {
          execFn: makeNopExecFn(),
          atomicUpdate: atomicUpdateFrontmatter,
          pollIntervalMs: 1,
          vaultPollIntervalMs: 100,
          readFileFn: () => readFileSync(taskFile, "utf8"),
          countClaudeSessionsFn: async () => 3, // below cap of 4
        },
      );

      // Should proceed (not defer) — returns 0 or 124 (timeout), but NOT 2 (deferred)
      expect(code).not.toBe(2);
    },
    10_000,
  );

  it(
    "sessionLog path written to frontmatter after successful spawn",
    async () => {
      await spawnSession(
        {
          taskFilePath: taskFile,
          taskUuid: TASK_UUID,
          model: "sonnet",
          timeoutMinutes: 1 / 60,
        },
        {
          execFn: makeNopExecFn(),
          atomicUpdate: atomicUpdateFrontmatter,
          pollIntervalMs: 1,
          vaultPollIntervalMs: 100,
          readFileFn: () => readFileSync(taskFile, "utf8"),
          countClaudeSessionsFn: async () => 0,
        },
      );

      const fm = parseFrontmatter(taskFile);
      expect(fm["aiTask__Task_sessionLog"]).toBeDefined();
      expect(String(fm["aiTask__Task_sessionLog"])).toContain(TASK_UUID);
    },
    10_000,
  );

  it(
    "task flips to Failed when tmux spawn fails",
    async () => {
      const execFn: ExecFn = (cmd, cb) => {
        if (cmd.includes("new-window")) {
          cb(new Error("no tmux server running"), "", "");
        } else {
          cb(null, "", "");
        }
        return {};
      };

      const code = await spawnSession(
        {
          taskFilePath: taskFile,
          taskUuid: TASK_UUID,
          model: "sonnet",
          timeoutMinutes: 1,
        },
        {
          execFn,
          atomicUpdate: atomicUpdateFrontmatter,
          countClaudeSessionsFn: async () => 0,
        },
      );

      expect(code).toBe(1);

      const fm = parseFrontmatter(taskFile);
      expect(String(fm["ems__Effort_status"] ?? "")).toContain("EffortStatusFailed");
      expect(fm["aiTask__Task_lastError"]).toBeTruthy();
      expect(String(fm["aiTask__Task_lastError"])).toContain("spawn failed");
    },
    10_000,
  );
});
