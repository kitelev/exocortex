import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  spawnSession,
  monitorSession,
  pollVaultStatus,
  countClaudeSessions,
  checkStdoutDone,
  CLAUDE_SESSION_CAP,
  type ExecFn,
  type CostFn,
} from "../../../src/services/SpawnService.js";
import type { AtomicUpdateResult } from "../../../src/services/AtomicFrontmatterService.js";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir, homedir } from "os";
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
const WINDOW_NAME = `claude-child-${TASK_UUID}`;

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

const mockCostFn: CostFn = (_taskUuid, _spawnTs) => ({ costUsd: 0.42, warning: null });

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

// --- pollVaultStatus ---

describe("pollVaultStatus", () => {
  it("returns 'done' when status is EffortStatusDone", async () => {
    jest.useFakeTimers();

    const content = buildMd({
      exo__Asset_uid: TASK_UUID,
      "ems__Effort_status": "[[ems__EffortStatusDone]]",
    });
    const promise = pollVaultStatus(taskFile, 60_000, {
      readFileFn: () => content,
      vaultPollIntervalMs: 1_000,
    });

    await jest.advanceTimersByTimeAsync(1_100);
    expect(await promise).toBe("done");
  });

  it("returns 'done' when status is EffortStatusReview", async () => {
    jest.useFakeTimers();

    const content = buildMd({
      exo__Asset_uid: TASK_UUID,
      "ems__Effort_status": "[[ems__EffortStatusReview]]",
    });
    const promise = pollVaultStatus(taskFile, 60_000, {
      readFileFn: () => content,
      vaultPollIntervalMs: 1_000,
    });

    await jest.advanceTimersByTimeAsync(1_100);
    expect(await promise).toBe("done");
  });

  it("returns 'done' for UUID|label wikilink format", async () => {
    jest.useFakeTimers();

    const content =
      `---\nexo__Asset_uid: ${TASK_UUID}\n` +
      `ems__Effort_status: "[[7b9b3116-7c3c-438c-9618-94fe301320a6|ems__EffortStatusDone]]"\n---\n`;
    const promise = pollVaultStatus(taskFile, 60_000, {
      readFileFn: () => content,
      vaultPollIntervalMs: 1_000,
    });

    await jest.advanceTimersByTimeAsync(1_100);
    expect(await promise).toBe("done");
  });

  it("returns 'timeout' when status never flips before deadline", async () => {
    jest.useFakeTimers();

    const content = buildMd({ exo__Asset_uid: TASK_UUID });
    const promise = pollVaultStatus(taskFile, 3_000, {
      readFileFn: () => content,
      vaultPollIntervalMs: 1_000,
    });

    await jest.advanceTimersByTimeAsync(10_000);
    expect(await promise).toBe("timeout");
  });

  it("returns 'timeout' on next check when cancel signal is set", async () => {
    jest.useFakeTimers();

    const content = buildMd({ exo__Asset_uid: TASK_UUID });
    const vaultCancelSignal = { cancelled: false };
    const promise = pollVaultStatus(taskFile, 60_000, {
      readFileFn: () => content,
      vaultPollIntervalMs: 1_000,
      vaultCancelSignal,
    });

    await jest.advanceTimersByTimeAsync(500);
    vaultCancelSignal.cancelled = true;
    await jest.advanceTimersByTimeAsync(1_100);
    expect(await promise).toBe("timeout");
  });

  it("handles file read errors gracefully and keeps polling until status flips", async () => {
    jest.useFakeTimers();

    let callCount = 0;
    const readFileFn = () => {
      callCount++;
      if (callCount < 3) throw new Error("ENOENT: no such file");
      return buildMd({
        exo__Asset_uid: TASK_UUID,
        "ems__Effort_status": "[[ems__EffortStatusDone]]",
      });
    };

    const promise = pollVaultStatus(taskFile, 60_000, {
      readFileFn,
      vaultPollIntervalMs: 1_000,
    });

    await jest.advanceTimersByTimeAsync(4_000);
    expect(await promise).toBe("done");
  });
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
      costFn: mockCostFn,
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

  it("writes aiTask__Task_cost to frontmatter after successful session", async () => {
    const execFn = makeExecFn({
      "new-window": "",
      "list-windows": "",
    });

    await spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      costFn: mockCostFn,
      pollIntervalMs: 1,
      countClaudeSessionsFn: async () => 0,
    });

    const costCall = atomicCalls.find(([, u]) => "aiTask__Task_cost" in u);
    expect(costCall).toBeDefined();
    expect(costCall![1]["aiTask__Task_cost"]).toBe(0.42);
  });

  it("writes aiTask__Task_cost on tmux-side timeout", async () => {
    jest.useFakeTimers();

    const timeoutMinutes = 6 / 60;
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
      costFn: mockCostFn,
      pollIntervalMs: 5000,
      countClaudeSessionsFn: async () => 0,
      // Vault polling disabled by very large interval so tmux wins the race
      vaultPollIntervalMs: 999_999,
      readFileFn: () => buildMd({ exo__Asset_uid: TASK_UUID }),
    });

    await jest.advanceTimersByTimeAsync(timeoutMs + 12_000);
    await promise;

    const timeoutCall = atomicCalls.find(
      ([, u]) => u["aiTask__Task_lastError"] === "timeout exceeded",
    );
    expect(timeoutCall).toBeDefined();
    expect(timeoutCall![1]["aiTask__Task_cost"]).toBe(0.42);
  });

  it("returns 1 and stores lastError when tmux spawn fails", async () => {
    const execFn = failingExecFn("no server running on /tmp/tmux-501/default");

    const code = await spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      costFn: mockCostFn,
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
      costFn: mockCostFn,
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
      spawnSession(opts1, { execFn, atomicUpdate: mockAtomicUpdate, costFn: mockCostFn, pollIntervalMs: 1, countClaudeSessionsFn: async () => 0 }),
      spawnSession(opts2, { execFn, atomicUpdate: mockAtomicUpdate, costFn: mockCostFn, pollIntervalMs: 1, countClaudeSessionsFn: async () => 0 }),
    ]);

    const spawnCalls = calls.filter((c) => c.includes("new-window"));
    expect(spawnCalls.length).toBeGreaterThanOrEqual(2);
    expect([0, 1, 124]).toContain(code1);
    expect([0, 1, 124]).toContain(code2);
  });

  it("returns 0 when vault status flips to Done before tmux window closes", async () => {
    jest.useFakeTimers();

    let fileContent = buildMd({ exo__Asset_uid: TASK_UUID });

    const execFn: ExecFn = (cmd, cb) => {
      if (cmd.includes("list-windows")) {
        cb(null, `${WINDOW_NAME}\n`, ""); // window stays alive
      } else {
        cb(null, "", "");
      }
      return {};
    };

    const promise = spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 600_000, // tmux won't fire before vault
      readFileFn: () => fileContent,
      vaultPollIntervalMs: 5_000,
    });

    // Advance past first vault poll — status not yet set
    await jest.advanceTimersByTimeAsync(5_100);

    // Flip vault status to Done
    fileContent = buildMd({
      exo__Asset_uid: TASK_UUID,
      "ems__Effort_status": "[[ems__EffortStatusDone]]",
    });

    // Advance past next vault poll — status detected
    await jest.advanceTimersByTimeAsync(5_100);
    const code = await promise;

    expect(code).toBe(0);
  });

  it("returns 0 and sets Review when vault times out but stdout contains DONE: (T1.4)", async () => {
    jest.useFakeTimers();

    const timeoutMinutes = 8 / 60; // 8_000 ms
    const opts = { ...BASE_OPTS, timeoutMinutes };

    const execFn: ExecFn = (cmd, cb) => {
      if (cmd.includes("list-windows")) {
        cb(null, `${WINDOW_NAME}\n`, ""); // window stays alive
      } else {
        cb(null, "", "");
      }
      return {};
    };

    const logPath = path.join(homedir(), ".exocortex", "ai-task-logs", `${TASK_UUID}.log`);

    const promise = spawnSession(opts, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 600_000,
      readFileFn: (p) => {
        if (p === logPath) return "Claude output\nDONE: task completed successfully\n";
        return buildMd({ exo__Asset_uid: TASK_UUID }); // vault — no status flip
      },
      vaultPollIntervalMs: 5_000,
    });

    await jest.advanceTimersByTimeAsync(20_000);
    const code = await promise;

    expect(code).toBe(0);
    expect(
      atomicCalls.some(([, u]) => u["ems__Effort_status"] === "[[ems__EffortStatusReview]]"),
    ).toBe(true);
    expect(
      atomicCalls.some(([, u]) => u["aiTask__Task_lastError"] !== undefined),
    ).toBe(false);
  });

  it("returns 124 when vault times out without status flip (T1.4 handoff)", async () => {
    jest.useFakeTimers();

    const timeoutMinutes = 8 / 60; // 8_000 ms
    const opts = { ...BASE_OPTS, timeoutMinutes };

    const execFn: ExecFn = (cmd, cb) => {
      if (cmd.includes("list-windows")) {
        cb(null, `${WINDOW_NAME}\n`, ""); // window stays alive
      } else {
        cb(null, "", "");
      }
      return {};
    };

    const promise = spawnSession(opts, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      pollIntervalMs: 600_000, // tmux won't fire before vault
      readFileFn: () => buildMd({ exo__Asset_uid: TASK_UUID }), // never completes
      vaultPollIntervalMs: 5_000,
    });

    await jest.advanceTimersByTimeAsync(20_000);
    const code = await promise;

    expect(code).toBe(124);
    expect(
      atomicCalls.some(([, u]) => u["aiTask__Task_lastError"] === "timeout exceeded"),
    ).toBe(true);
  });
});

// --- spawnSession: stdin prompt (regression W6) ---

describe("spawnSession — systemPrompt piped via stdin", () => {
  it("does not pass frontmatter body as -p positional arg when systemPrompt starts with '---'", async () => {
    const capturedCmds: string[] = [];
    const execFn: ExecFn = (cmd, cb) => {
      capturedCmds.push(cmd);
      cb(null, "", "");
      return {};
    };

    const frontmatterPrompt =
      "---\nexo__Asset_uid: test-uuid\nems__Effort_status: \"[[ems__EffortStatusBacklog]]\"\n---\n\nDo something useful.";

    await spawnSession(
      { ...BASE_OPTS, systemPrompt: frontmatterPrompt },
      {
        execFn,
        atomicUpdate: mockAtomicUpdate,
        costFn: mockCostFn,
        pollIntervalMs: 1,
        countClaudeSessionsFn: async () => 0,
      },
    );

    const spawnCmd = capturedCmds.find((c) => c.includes("new-window"));
    expect(spawnCmd).toBeDefined();
    // Must use stdin pipe, NOT -p "<content>" as positional arg
    expect(spawnCmd).toContain("printf '%s'");
    expect(spawnCmd).toContain("| claude");
    // Must NOT pass the raw --- string as a positional argument
    expect(spawnCmd).not.toMatch(/-p\s+"---/);
    expect(spawnCmd).not.toMatch(/-p\s+'---/);
  });

  it("properly escapes single quotes in systemPrompt", async () => {
    const capturedCmds: string[] = [];
    const execFn: ExecFn = (cmd, cb) => {
      capturedCmds.push(cmd);
      cb(null, "", "");
      return {};
    };

    const promptWithQuotes = "Task: fix the user's issue\n---\nbody";

    await spawnSession(
      { ...BASE_OPTS, systemPrompt: promptWithQuotes },
      {
        execFn,
        atomicUpdate: mockAtomicUpdate,
        costFn: mockCostFn,
        pollIntervalMs: 1,
        countClaudeSessionsFn: async () => 0,
      },
    );

    const spawnCmd = capturedCmds.find((c) => c.includes("new-window"));
    expect(spawnCmd).toBeDefined();
    // JSON.stringify in tmuxCmd construction doubles the backslash; the actual shell sees '\''
    expect(spawnCmd).toContain("'\\\\''");
    expect(spawnCmd).toContain("printf '%s'");
  });

  it("spawns without prompt prefix when systemPrompt is not provided", async () => {
    const capturedCmds: string[] = [];
    const execFn: ExecFn = (cmd, cb) => {
      capturedCmds.push(cmd);
      cb(null, "", "");
      return {};
    };

    await spawnSession(BASE_OPTS, {
      execFn,
      atomicUpdate: mockAtomicUpdate,
      costFn: mockCostFn,
      pollIntervalMs: 1,
      countClaudeSessionsFn: async () => 0,
    });

    const spawnCmd = capturedCmds.find((c) => c.includes("new-window"));
    expect(spawnCmd).toBeDefined();
    expect(spawnCmd).not.toContain("printf '%s'");
  });
});

// --- checkStdoutDone ---

describe("checkStdoutDone", () => {
  it("returns true when last lines contain 'DONE:' marker", () => {
    const log = "some output\nprocessing...\nDONE: task completed\n";
    expect(checkStdoutDone("/any.log", () => log)).toBe(true);
  });

  it("returns true when DONE: appears within last 20 lines", () => {
    const body = Array.from({ length: 15 }, (_, i) => `line ${i}`).join("\n");
    const log = `${body}\nDONE: finished\n`;
    expect(checkStdoutDone("/any.log", () => log)).toBe(true);
  });

  it("returns false when DONE: is not in last 20 lines", () => {
    const earlyDone = "DONE: old run\n" + Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
    expect(checkStdoutDone("/any.log", () => earlyDone)).toBe(false);
  });

  it("returns false when log has no DONE: marker at all", () => {
    const log = "Claude output...\nsome work done\nfinal line\n";
    expect(checkStdoutDone("/any.log", () => log)).toBe(false);
  });

  it("returns false when log file is unreadable", () => {
    expect(checkStdoutDone("/nonexistent/path.log")).toBe(false);
  });

  it("matches DONE: case-insensitively", () => {
    const log = "work done\ndone: lowercase marker\n";
    expect(checkStdoutDone("/any.log", () => log)).toBe(true);
  });

  it("ignores DONE: that appears mid-line (not at line start)", () => {
    const log = "output containing DONE: in middle of line\n";
    expect(checkStdoutDone("/any.log", () => log)).toBe(false);
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
