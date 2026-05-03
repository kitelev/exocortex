import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { ExecFn } from "../../../src/services/SpawnService.js";
import {
  spawnSession,
  monitorSession,
  countClaudeSessions,
  CLAUDE_SESSION_CAP,
} from "../../../src/services/SpawnService.js";
import type { AtomicUpdateResult } from "../../../src/services/AtomicFrontmatterService.js";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import yaml from "js-yaml";

// Minimal frontmatter for a valid task file
function buildMd(fm: Record<string, unknown>): string {
  return `---\n${yaml.dump(fm)}---\n`;
}

// Build a synchronous exec mock that responds based on the command content
function makeExecFn(responses: Record<string, string>): ExecFn {
  return (cmd, cb) => {
    const match = Object.keys(responses).find((k) => cmd.includes(k));
    const stdout = match !== undefined ? responses[match] : "";
    cb(null, stdout, "");
    return {};
  };
}

function failingExecFn(message: string): ExecFn {
  return (_cmd, cb) => {
    cb(new Error(message), "", "");
    return {};
  };
}

const TASK_UUID = "c576b1e2-0f88-4f0a-badc-ec817c8779ce";
const WINDOW_NAME = `aitask-${TASK_UUID.replace(/-/g, "").slice(0, 8)}`;

let tmpDir: string;
let taskFile: string;
const atomicCalls: Array<[string, Record<string, unknown>]> = [];
const mockAtomicUpdate = (
  filePath: string,
  updates: Record<string, unknown>,
): AtomicUpdateResult => {
  atomicCalls.push([filePath, updates]);
  return { success: true, verified: true };
};

const BASE_OPTS = {
  taskFilePath: "", // set in beforeEach
  taskUuid: TASK_UUID,
  model: "sonnet",
  timeoutMinutes: 1,
};

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "spawn-test-"));
  taskFile = path.join(tmpDir, `${TASK_UUID}.md`);
  writeFileSync(
    taskFile,
    buildMd({ exo__Asset_uid: TASK_UUID, exo__Asset_label: "Test task" }),
  );
  BASE_OPTS.taskFilePath = taskFile;
  atomicCalls.length = 0;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  jest.useRealTimers();
});

// --- countClaudeSessions ---

describe("countClaudeSessions", () => {
  it("parses wc -l output to an integer", async () => {
    const execFn = makeExecFn({ "list-sessions": "claude-orch-abc: 1 windows\nclaude-child-def: 1 windows\n" });
    // The wc -l mock: grep | wc -l → we mock by returning "2\n" for wc-containing cmd
    const wclExec: ExecFn = (_cmd, cb) => {
      cb(null, "2\n", "");
      return {};
    };
    const count = await countClaudeSessions(wclExec);
    expect(count).toBe(2);
  });

  it("returns 0 when tmux is not running (exec error)", async () => {
    const count = await countClaudeSessions(failingExecFn("no server running"));
    expect(count).toBe(0);
  });

  it("returns 0 when wc -l outputs non-numeric text", async () => {
    const execFn: ExecFn = (_cmd, cb) => {
      cb(null, "  \n", "");
      return {};
    };
    const count = await countClaudeSessions(execFn);
    expect(count).toBe(0);
  });
});

// --- spawnSession: cap check ---

describe("spawnSession — cap check", () => {
  it("returns 2 and reverts task to Backlog when session count >= cap", async () => {
    const execFn = makeExecFn({ "new-window": "", "list-windows": "" });
    const countFn = async () => CLAUDE_SESSION_CAP; // at cap

    const code = await spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 1,
      countClaudeSessionsFn: countFn,
    });

    expect(code).toBe(2);

    const deferCall = atomicCalls.find(
      ([, u]) => u["ems__Effort_status"] === "[[ems__EffortStatusBacklog]]",
    );
    expect(deferCall).toBeDefined();
    expect(deferCall![1]["aiTask__Task_deferReason"]).toContain("cap reached");
    expect(deferCall![1]["aiTask__Task_deferredAt"]).toBeDefined();
    expect(deferCall![1]["aiTask__Task_claimedBy"]).toBeNull();
    expect(deferCall![1]["aiTask__Task_claimedAt"]).toBeNull();
  });

  it("returns 2 when session count exceeds cap", async () => {
    const execFn = makeExecFn({ "new-window": "", "list-windows": "" });
    const countFn = async () => CLAUDE_SESSION_CAP + 2;

    const code = await spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 1,
      countClaudeSessionsFn: countFn,
    });

    expect(code).toBe(2);
  });

  it("proceeds with spawn when session count is below cap", async () => {
    const execFn = makeExecFn({ "new-window": "", "list-windows": "" });
    const countFn = async () => CLAUDE_SESSION_CAP - 1;

    const code = await spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 1,
      countClaudeSessionsFn: countFn,
    });

    expect(code).toBe(0);
    const deferCall = atomicCalls.find(
      ([, u]) => u["ems__Effort_status"] === "[[ems__EffortStatusBacklog]]",
    );
    expect(deferCall).toBeUndefined();
  });

  it("proceeds with spawn when session count is 0", async () => {
    const execFn = makeExecFn({ "new-window": "", "list-windows": "" });
    const countFn = async () => 0;

    const code = await spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 1,
      countClaudeSessionsFn: countFn,
    });

    expect(code).toBe(0);
  });

  it("does not spawn a tmux window when deferred", async () => {
    const spawnedWindows: string[] = [];
    const execFn: ExecFn = (cmd, cb) => {
      if (cmd.includes("new-window")) spawnedWindows.push(cmd);
      cb(null, "", "");
      return {};
    };
    const countFn = async () => CLAUDE_SESSION_CAP;

    await spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 1,
      countClaudeSessionsFn: countFn,
    });

    expect(spawnedWindows).toHaveLength(0);
  });
});

// --- spawnSession ---

describe("spawnSession", () => {
  it("stores sessionLog path in frontmatter after successful spawn", async () => {
    const execFn = makeExecFn({
      "new-window": "",
      "list-windows": "", // empty → window gone immediately
    });

    await spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 1,
      countClaudeSessionsFn: async () => 0,
    });

    const sessionLogCall = atomicCalls.find(
      ([, u]) => "aiTask__Task_sessionLog" in u,
    );
    expect(sessionLogCall).toBeDefined();
    expect(sessionLogCall![1]["aiTask__Task_sessionLog"]).toContain(TASK_UUID);
    expect(sessionLogCall![1]["aiTask__Task_sessionLog"]).toContain(
      "ai-task-logs",
    );
  });

  it("returns 1 and stores lastError when tmux spawn fails", async () => {
    const execFn = failingExecFn("no server running on /tmp/tmux-501/default");

    const code = await spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 1,
      countClaudeSessionsFn: async () => 0,
    });

    expect(code).toBe(1);
    const failCall = atomicCalls.find(
      ([, u]) => u["aiTask__Task_lastError"] !== undefined,
    );
    expect(failCall).toBeDefined();
    expect(String(failCall![1]["aiTask__Task_lastError"])).toContain(
      "spawn failed",
    );
  });

  it("returns 124 and marks 'timeout exceeded' when window stays alive past deadline", async () => {
    jest.useFakeTimers();

    const timeoutMinutes = 6 / 60; // 6 000 ms
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const opts = { ...BASE_OPTS, timeoutMinutes };

    const execFn: ExecFn = (cmd, cb) => {
      if (cmd.includes("list-windows")) {
        cb(null, `${WINDOW_NAME}\n`, "");
      } else {
        cb(null, "", "");
      }
      return {};
    };

    const promise = spawnSession(opts, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 5000,
      countClaudeSessionsFn: async () => 0,
    });

    await jest.advanceTimersByTimeAsync(timeoutMs + 12_000);
    const code = await promise;

    expect(code).toBe(124);
    const timeoutCall = atomicCalls.find(
      ([, u]) => u["aiTask__Task_lastError"] === "timeout exceeded",
    );
    expect(timeoutCall).toBeDefined();
  });

  it("two concurrent spawns both start without blocking each other", async () => {
    const calls: string[] = [];
    const execFn: ExecFn = (cmd, cb) => {
      calls.push(cmd);
      cb(null, "", "");
      return {};
    };

    const opts1 = { ...BASE_OPTS, taskUuid: "aaaaaaaa-0000-0000-0000-000000000001" };
    const opts2 = { ...BASE_OPTS, taskUuid: "bbbbbbbb-0000-0000-0000-000000000002" };

    const [code1, code2] = await Promise.all([
      spawnSession(opts1, { execFn, atomicUpdate: mockAtomicUpdate, pollIntervalMs: 1, countClaudeSessionsFn: async () => 0 }),
      spawnSession(opts2, { execFn, atomicUpdate: mockAtomicUpdate, pollIntervalMs: 1, countClaudeSessionsFn: async () => 0 }),
    ]);

    const spawnCalls = calls.filter((c) => c.includes("new-window"));
    expect(spawnCalls.length).toBeGreaterThanOrEqual(2);
    expect([0, 1, 124]).toContain(code1);
    expect([0, 1, 124]).toContain(code2);
  });
});

// --- monitorSession ---

describe("monitorSession", () => {
  it("returns 0 when window disappears before timeout", async () => {
    jest.useFakeTimers();

    let pollCount = 0;
    const execFn: ExecFn = (cmd, cb) => {
      pollCount++;
      const out = pollCount < 2 ? `${WINDOW_NAME}\n` : "other\n";
      cb(null, out, "");
      return {};
    };

    const promise = monitorSession(WINDOW_NAME, 60_000, { execFn, pollIntervalMs: 5000 });
    await jest.advanceTimersByTimeAsync(11_000);
    const code = await promise;
    expect(code).toBe(0);
  });

  it("returns 124 when window stays alive through the full timeout", async () => {
    jest.useFakeTimers();

    const execFn: ExecFn = (_cmd, cb) => {
      cb(null, `${WINDOW_NAME}\n`, "");
      return {};
    };

    const promise = monitorSession(WINDOW_NAME, 5_000, { execFn, pollIntervalMs: 5000 });
    await jest.advanceTimersByTimeAsync(12_000);
    const code = await promise;
    expect(code).toBe(124);
  });
});
