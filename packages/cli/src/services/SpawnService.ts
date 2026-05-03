import { exec } from "child_process";
import { mkdirSync, existsSync, appendFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { atomicUpdateFrontmatter } from "./AtomicFrontmatterService.js";

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

export interface SpawnDeps {
  execFn?: ExecFn;
  atomicUpdate?: typeof atomicUpdateFrontmatter;
  /** Polling interval for tmux window monitoring (ms). Default: 5000. */
  pollIntervalMs?: number;
  /** Override for countClaudeSessions (injected in tests). */
  countClaudeSessionsFn?: () => Promise<number>;
}

/** Maximum allowed concurrent claude-(orch|child) tmux sessions before deferring. */
export const CLAUDE_SESSION_CAP = 4;

const LOG_DIR = path.join(homedir(), ".exocortex", "ai-task-logs");
const WORKER_LOG = path.join(homedir(), ".exocortex", "logs", "aitask-worker.log");

function uuid8(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

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
 * Returns exit code: 0 = success, 1 = failed, 2 = deferred (cap exceeded), 124 = timeout.
 */
export async function spawnSession(
  opts: SpawnOptions,
  deps: SpawnDeps = {},
): Promise<number> {
  const execFn = deps.execFn ?? exec;
  const updateFn = deps.atomicUpdate ?? atomicUpdateFrontmatter;
  const execPromise = makeExecPromise(execFn);
  const getSessionCount = deps.countClaudeSessionsFn ?? (() => countClaudeSessions(execFn));

  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }

  const logFile = path.join(LOG_DIR, `${opts.taskUuid}.log`);
  const windowName = `aitask-${uuid8(opts.taskUuid)}`;

  const promptFlag = opts.systemPrompt
    ? `-p ${JSON.stringify(opts.systemPrompt)}`
    : "";

  const claudeCmd = `claude --model ${opts.model} --dangerously-skip-permissions ${promptFlag} 2>&1 | tee ${JSON.stringify(logFile)}`;
  const envPrefix =
    "env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH";
  const tmuxCmd = `tmux new-window -d -n ${windowName} "${envPrefix} bash -c ${JSON.stringify(claudeCmd)}"`;

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
  const exitCode = await monitorSession(windowName, timeoutMs, {
    execFn,
    pollIntervalMs: deps.pollIntervalMs,
  });

  if (exitCode === 124) {
    try {
      await execPromise(`tmux kill-window -t ${windowName}`);
    } catch {
      // window may already be gone
    }
    updateFn(opts.taskFilePath, {
      "ems__Effort_status": "[[ems__EffortStatusFailed]]",
      "aiTask__Task_lastError": "timeout exceeded",
      "exo__Asset_updatedAt": nowIso(),
    });
    return 124;
  }

  return 0;
}
