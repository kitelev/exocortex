import { exec } from "child_process";
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { atomicUpdateFrontmatter } from "./AtomicFrontmatterService.js";
import { computeSessionCost } from "./SessionCostService.js";

export interface SpawnOptions {
  taskFilePath: string;
  taskUuid: string;
  model: string;
  timeoutMinutes: number;
  systemPrompt?: string;
}

export type ExecFn = (
  cmd: string,
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown;

export type CostFn = typeof computeSessionCost;

/** Result of vault status polling: completion detected or deadline reached. */
export type VaultPollResult = "done" | "timeout";

export interface SpawnDeps {
  execFn?: ExecFn;
  atomicUpdate?: typeof atomicUpdateFrontmatter;
  /** Polling interval for tmux window monitoring (ms). Default: 5000. */
  pollIntervalMs?: number;
  /** Injectable cost computation function for tests. */
  costFn?: CostFn;
  /** Custom file reader for vault status polling (injectable for tests). */
  readFileFn?: (filePath: string) => string;
  /** Polling interval for vault status detection (ms). Default: 10_000. */
  vaultPollIntervalMs?: number;
  /** Shared cancellation signal — set `cancelled: true` to stop vault polling. */
  vaultCancelSignal?: { cancelled: boolean };
  /** Override for countClaudeSessions (injected in tests). */
  countClaudeSessionsFn?: () => Promise<number>;
}

/** Maximum allowed concurrent claude-(orch|child) tmux sessions before deferring. */
export const CLAUDE_SESSION_CAP = 4;

const COMPLETION_STATUS_FRAGMENTS = ["EffortStatusDone", "EffortStatusReview"];

const LOG_DIR = path.join(homedir(), ".exocortex", "ai-task-logs");
const WORKER_LOG = path.join(homedir(), ".exocortex", "logs", "aitask-worker.log");

function nowIso(): string {
  return new Date().toISOString();
}

function makeExecPromise(execFn: ExecFn) {
  return (cmd: string): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      execFn(cmd, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stdout, stderr }));
        else resolve({ stdout, stderr });
      });
    });
}

function isCompletionStatus(content: string): boolean {
  // Match any quoting style (single, double, or bare) since YAML serializers vary.
  const m = content.match(/ems__Effort_status:.*\[\[([^\]]+)\]\]/);
  if (!m) return false;
  return COMPLETION_STATUS_FRAGMENTS.some((f) => m[1].includes(f));
}

/**
 * Polls the vault task file until ems__Effort_status flips to Done or Review.
 * Returns 'done' when a completion status is detected, 'timeout' if the
 * deadline passes without a flip.
 *
 * The poll interval defaults to 10 s; set deps.vaultPollIntervalMs for tests.
 * Set deps.vaultCancelSignal.cancelled = true to abort early.
 */
export function pollVaultStatus(
  taskFilePath: string,
  timeoutMs: number,
  deps: SpawnDeps = {},
): Promise<VaultPollResult> {
  const readFn =
    deps.readFileFn ?? ((p: string) => readFileSync(p, "utf8"));
  const pollMs = deps.vaultPollIntervalMs ?? 10_000;
  const signal = deps.vaultCancelSignal;

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    function check() {
      if (signal?.cancelled) {
        resolve("timeout");
        return;
      }
      try {
        const content = readFn(taskFilePath);
        if (isCompletionStatus(content)) {
          resolve("done");
          return;
        }
      } catch {
        // file temporarily unreadable — keep waiting
      }
      if (Date.now() >= deadline) {
        resolve("timeout");
        return;
      }
      setTimeout(check, pollMs);
    }

    setTimeout(check, pollMs);
  });
}

/**
 * Returns the count of active tmux sessions whose name starts with
 * "claude-orch" or "claude-child". Used for pre-spawn cap enforcement.
 */
export async function countClaudeSessions(execFn: ExecFn = exec): Promise<number> {
  const execPromise = makeExecPromise(execFn);
  try {
    const { stdout } = await execPromise(
      "tmux list-sessions 2>/dev/null | grep -E '^claude-(orch|child)' | wc -l",
    );
    const n = parseInt(stdout.trim(), 10);
    return isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

/**
 * Completion detection B (T1.4): scans the last 20 lines of the Claude stdout
 * log for a line starting with "DONE:" (case-insensitive). Returns true if the
 * marker is found, false otherwise (file unreadable counts as not found).
 */
export function checkStdoutDone(
  logFilePath: string,
  readFileFn?: (filePath: string) => string,
): boolean {
  try {
    const read = readFileFn ?? ((p: string) => readFileSync(p, "utf8"));
    const content = read(logFilePath);
    const lines = content.trimEnd().split("\n");
    const tail = lines.slice(-20);
    return tail.some((line) => /^DONE:/i.test(line.trim()));
  } catch {
    return false;
  }
}

/**
 * Polls tmux list-windows until the named window disappears or timeout elapses.
 * Returns 0 if window exited cleanly, 124 if timed out.
 */
export function monitorSession(
  windowName: string,
  timeoutMs: number,
  deps: SpawnDeps = {},
): Promise<number> {
  const execPromise = makeExecPromise(deps.execFn ?? exec);
  const pollMs = deps.pollIntervalMs ?? 5000;
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const interval = setInterval(async () => {
      try {
        const { stdout } = await execPromise(
          "tmux list-windows -a -F '#{window_name}'",
        );
        const alive = stdout.split("\n").some((l) => l.trim() === windowName);
        if (!alive) {
          clearInterval(interval);
          resolve(0);
          return;
        }
      } catch {
        clearInterval(interval);
        resolve(0);
        return;
      }
      if (Date.now() >= deadline) {
        clearInterval(interval);
        resolve(124);
      }
    }, pollMs);
  });
}

/**
 * Spawns a detached Claude session in a tmux window.
 *
 * Primary completion detection (T1.3): polls the vault task file every
 * vaultPollIntervalMs (default 10 s) for ems__Effort_status flipping to
 * Done or Review.
 *
 * Secondary detection: monitors the tmux window via list-windows.
 *
 * Returns:
 *   0   — vault status flipped OR window exited cleanly
 *   1   — spawn failed
 *   2   — deferred (session cap exceeded)
 *   124 — timeout without status flip (hand off to Completion detection B / T1.4)
 */
export async function spawnSession(
  opts: SpawnOptions,
  deps: SpawnDeps = {},
): Promise<number> {
  const execFn = deps.execFn ?? exec;
  const updateFn = deps.atomicUpdate ?? atomicUpdateFrontmatter;
  const costFn = deps.costFn ?? computeSessionCost;
  const execPromise = makeExecPromise(execFn);
  const getSessionCount = deps.countClaudeSessionsFn ?? (() => countClaudeSessions(execFn));

  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }

  const logFile = path.join(LOG_DIR, `${opts.taskUuid}.log`);
  const windowName = `claude-child-${opts.taskUuid}`;

  const promptFlag = opts.systemPrompt
    ? `-p ${JSON.stringify(opts.systemPrompt)}`
    : "";

  const claudeCmd = `claude --model ${opts.model} --dangerously-skip-permissions ${promptFlag} 2>&1 | tee ${JSON.stringify(logFile)}`;
  const envPrefix =
    "env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH";
  const tmuxCmd = `tmux new-window -d -n ${windowName} "${envPrefix} bash -c ${JSON.stringify(claudeCmd)}"`;

  const spawnTimestamp = Date.now();

  // Pre-spawn cap check — performed immediately before spawn to minimise race window
  const sessionCount = await getSessionCount();
  if (sessionCount >= CLAUDE_SESSION_CAP) {
    const now = nowIso();
    const deferReason = `claude session cap reached (${sessionCount}/${CLAUDE_SESSION_CAP}), task deferred to next iteration`;
    updateFn(opts.taskFilePath, {
      "ems__Effort_status": "[[ems__EffortStatusBacklog]]",
      "aiTask__Task_claimedBy": null,
      "aiTask__Task_claimedAt": null,
      "ems__Effort_startTimestamp": null,
      "aiTask__Task_deferReason": deferReason,
      "aiTask__Task_deferredAt": now,
      "exo__Asset_updatedAt": now,
    });
    try {
      mkdirSync(path.dirname(WORKER_LOG), { recursive: true });
      appendFileSync(WORKER_LOG, `[ai-task-worker] ${now}: DEFERRED ${opts.taskUuid}: ${deferReason}\n`);
    } catch {
      // log write is best-effort
    }
    return 2;
  }

  try {
    await execPromise(tmuxCmd);
  } catch (e) {
    updateFn(opts.taskFilePath, {
      "ems__Effort_status": "[[ems__EffortStatusFailed]]",
      "aiTask__Task_lastError": `spawn failed: ${(e as Error).message}`,
      "exo__Asset_updatedAt": nowIso(),
    });
    return 1;
  }

  updateFn(opts.taskFilePath, {
    "aiTask__Task_sessionLog": logFile,
    "exo__Asset_updatedAt": nowIso(),
  });

  const timeoutMs = opts.timeoutMinutes * 60 * 1000;
  const vaultCancelSignal = { cancelled: false };

  type RaceResult =
    | { source: "vault"; result: VaultPollResult }
    | { source: "tmux"; code: number };

  const winner: RaceResult = await Promise.race([
    pollVaultStatus(opts.taskFilePath, timeoutMs, {
      readFileFn: deps.readFileFn,
      vaultPollIntervalMs: deps.vaultPollIntervalMs,
      vaultCancelSignal,
    }).then((result) => ({ source: "vault" as const, result })),
    monitorSession(windowName, timeoutMs, {
      execFn,
      pollIntervalMs: deps.pollIntervalMs,
    }).then((code) => ({ source: "tmux" as const, code })),
  ]);

  vaultCancelSignal.cancelled = true;

  if (winner.source === "vault") {
    if (winner.result === "done") {
      // Vault status flip detected — session complete; clean up the tmux window.
      await execPromise(`tmux kill-window -t ${windowName}`).catch(() => {});
      return 0;
    }
    // Vault polling timed out — Completion detection B (T1.4): check stdout log.
    await execPromise(`tmux kill-window -t ${windowName}`).catch(() => {});
    if (checkStdoutDone(logFile, deps.readFileFn)) {
      updateFn(opts.taskFilePath, {
        "ems__Effort_status": "[[ems__EffortStatusReview]]",
        "exo__Asset_updatedAt": nowIso(),
      });
      return 0;
    }
    updateFn(opts.taskFilePath, {
      "ems__Effort_status": "[[ems__EffortStatusFailed]]",
      "aiTask__Task_lastError": "timeout exceeded",
      "exo__Asset_updatedAt": nowIso(),
    });
    return 124;
  }

  // tmux window exited first.
  if (winner.code === 124) {
    // tmux-side timeout — Completion detection B (T1.4): check stdout log.
    await execPromise(`tmux kill-window -t ${windowName}`).catch(() => {});
    if (checkStdoutDone(logFile, deps.readFileFn)) {
      updateFn(opts.taskFilePath, {
        "ems__Effort_status": "[[ems__EffortStatusReview]]",
        "exo__Asset_updatedAt": nowIso(),
      });
      return 0;
    }
    const { costUsd } = costFn(opts.taskUuid, spawnTimestamp);
    updateFn(opts.taskFilePath, {
      "ems__Effort_status": "[[ems__EffortStatusFailed]]",
      "aiTask__Task_lastError": "timeout exceeded",
      "aiTask__Task_cost": costUsd,
      "exo__Asset_updatedAt": nowIso(),
    });
    return 124;
  }

  // Window closed naturally — success.
  const { costUsd } = costFn(opts.taskUuid, spawnTimestamp);
  updateFn(opts.taskFilePath, {
    "aiTask__Task_cost": costUsd,
    "exo__Asset_updatedAt": nowIso(),
  });
  return 0;
}
