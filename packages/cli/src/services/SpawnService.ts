import { exec } from "child_process";
import { mkdirSync, existsSync, readFileSync } from "fs";
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

/** Result of vault status polling: completion detected or deadline reached. */
export type VaultPollResult = "done" | "timeout";

export interface SpawnDeps {
  execFn?: ExecFn;
  atomicUpdate?: typeof atomicUpdateFrontmatter;
  /** Polling interval for tmux window monitoring (ms). Default: 5000. */
  pollIntervalMs?: number;
  /** Custom file reader for vault status polling (injectable for tests). */
  readFileFn?: (filePath: string) => string;
  /** Polling interval for vault status detection (ms). Default: 10_000. */
  vaultPollIntervalMs?: number;
  /** Shared cancellation signal — set `cancelled: true` to stop vault polling. */
  vaultCancelSignal?: { cancelled: boolean };
}

const LOG_DIR = path.join(homedir(), ".exocortex", "ai-task-logs");

const COMPLETION_STATUS_FRAGMENTS = ["EffortStatusDone", "EffortStatusReview"];

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
 *   124 — timeout without status flip (hand off to Completion detection B / T1.4)
 */
export async function spawnSession(
  opts: SpawnOptions,
  deps: SpawnDeps = {},
): Promise<number> {
  const execFn = deps.execFn ?? exec;
  const updateFn = deps.atomicUpdate ?? atomicUpdateFrontmatter;
  const execPromise = makeExecPromise(execFn);

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
    // Vault polling timed out — hand off to Completion detection B (T1.4).
    await execPromise(`tmux kill-window -t ${windowName}`).catch(() => {});
    updateFn(opts.taskFilePath, {
      "ems__Effort_status": "[[ems__EffortStatusFailed]]",
      "aiTask__Task_lastError": "timeout exceeded",
      "exo__Asset_updatedAt": nowIso(),
    });
    return 124;
  }

  // tmux window exited first.
  if (winner.code === 124) {
    // tmux-side timeout — treat same as vault timeout.
    await execPromise(`tmux kill-window -t ${windowName}`).catch(() => {});
    updateFn(opts.taskFilePath, {
      "ems__Effort_status": "[[ems__EffortStatusFailed]]",
      "aiTask__Task_lastError": "timeout exceeded",
      "exo__Asset_updatedAt": nowIso(),
    });
    return 124;
  }

  // Window closed naturally — success.
  return 0;
}
