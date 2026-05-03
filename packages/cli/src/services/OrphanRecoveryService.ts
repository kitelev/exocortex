import { exec } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { atomicUpdateFrontmatter } from "./AtomicFrontmatterService.js";

export type ExecFn = (
  cmd: string,
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown;

export type UpdateFn = typeof atomicUpdateFrontmatter;

// Session name patterns for tasks spawned by ai-task-worker / orchestrator.
// Full UUID pattern: claude-child-<uuid> (bash worker — tmux new-session)
const FULL_UUID_RE =
  /^claude-child-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
// Short prefix pattern: claude-child-<8chars>-<digits> (orchestrator)
const SHORT_UUID_RE = /^claude-child-([0-9a-f]{8})-(\d+)$/;

const DOING_FRAGMENT = "EffortStatusDoing";

export interface ParsedSession {
  sessionName: string;
  /** Full UUID (full-type) or 8-char prefix (short-type). */
  uuid: string;
  type: "full" | "short";
}

export interface OrphanSession {
  sessionName: string;
  taskUuid: string;
  taskFilePath: string | null;
  reason: string;
}

export interface RecoveryResult {
  orphans: number;
  recovered: number;
  skipped: number;
  errors: number;
}

function makeExecPromise(execFn: ExecFn) {
  return (cmd: string): Promise<string> =>
    new Promise((resolve, reject) => {
      execFn(cmd, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stdout, stderr }));
        else resolve(stdout);
      });
    });
}

/** List all tmux sessions whose name matches the claude-child patterns. */
export async function listClaudeChildSessions(
  execFn: ExecFn = exec,
): Promise<ParsedSession[]> {
  const run = makeExecPromise(execFn);
  let stdout: string;
  try {
    stdout = await run("tmux list-sessions -F '#{session_name}' 2>/dev/null");
  } catch {
    return [];
  }

  const sessions: ParsedSession[] = [];
  for (const name of stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const fullMatch = FULL_UUID_RE.exec(name);
    if (fullMatch) {
      sessions.push({ sessionName: name, uuid: fullMatch[1], type: "full" });
      continue;
    }
    const shortMatch = SHORT_UUID_RE.exec(name);
    if (shortMatch) {
      sessions.push({ sessionName: name, uuid: shortMatch[1], type: "short" });
    }
  }
  return sessions;
}

/**
 * Recursively search for a vault markdown file whose name (without extension)
 * matches the given UUID or UUID prefix.
 */
export function findVaultFile(
  vaultDir: string,
  uuidOrPrefix: string,
  type: "full" | "short",
): string | null {
  let result: string | null = null;
  const prefix = uuidOrPrefix.toLowerCase();

  function walk(dir: string): void {
    if (result) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (result) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".md")) {
        const base = entry.name.slice(0, -3).toLowerCase();
        if (type === "full" && base === prefix) {
          result = fullPath;
        } else if (type === "short" && base.startsWith(prefix)) {
          result = fullPath;
        }
      }
    }
  }

  walk(vaultDir);
  return result;
}

/** Return true if the vault file's ems__Effort_status is Doing. */
export function isTaskDoing(filePath: string, readFn?: (p: string) => string): boolean {
  try {
    const read = readFn ?? ((p: string) => readFileSync(p, "utf8"));
    const content = read(filePath);
    const m = content.match(/ems__Effort_status\s*:.*\[\[([^\]]+)\]\]/);
    if (!m) return false;
    return m[1].includes(DOING_FRAGMENT);
  } catch {
    return false;
  }
}

/**
 * Detect orphaned claude-child tmux sessions:
 * a session is orphaned when either the corresponding vault task is not found
 * or its status is not Doing.
 */
export async function detectOrphans(
  vaultDir: string,
  execFn: ExecFn = exec,
  readFn?: (p: string) => string,
): Promise<OrphanSession[]> {
  const sessions = await listClaudeChildSessions(execFn);
  const orphans: OrphanSession[] = [];

  for (const s of sessions) {
    const filePath = findVaultFile(vaultDir, s.uuid, s.type);

    if (!filePath) {
      orphans.push({
        sessionName: s.sessionName,
        taskUuid: s.uuid,
        taskFilePath: null,
        reason: "vault task not found",
      });
      continue;
    }

    if (!isTaskDoing(filePath, readFn)) {
      orphans.push({
        sessionName: s.sessionName,
        taskUuid: s.uuid,
        taskFilePath: filePath,
        reason: "vault task status != Doing",
      });
    }
  }

  return orphans;
}

/**
 * Recover a single orphan: transition vault task to Failed and kill tmux session.
 * In dry-run mode only logs; no mutations are made.
 */
export async function recoverOrphan(
  orphan: OrphanSession,
  dryRun: boolean,
  execFn: ExecFn = exec,
  updateFn: UpdateFn = atomicUpdateFrontmatter,
): Promise<{ ok: boolean; error?: string }> {
  const run = makeExecPromise(execFn);

  if (dryRun) {
    return { ok: true };
  }

  const now = new Date().toISOString();

  if (orphan.taskFilePath) {
    try {
      updateFn(orphan.taskFilePath, {
        "ems__Effort_status": "[[ems__EffortStatusFailed]]",
        "aiTask__Task_lastError": `orphan recovery: ${orphan.reason}`,
        "exo__Asset_updatedAt": now,
      });
    } catch (e) {
      return { ok: false, error: `vault update failed: ${(e as Error).message}` };
    }
  }

  try {
    await run(`tmux kill-session -t ${JSON.stringify(orphan.sessionName)}`);
  } catch {
    // Session may have already exited — not an error.
  }

  return { ok: true };
}

/**
 * Full orphan recovery run. Returns a summary.
 * Without --apply (dryRun=true) lists orphans without modifying anything.
 */
export async function runOrphanRecovery(
  vaultDir: string,
  dryRun: boolean,
  execFn: ExecFn = exec,
  readFn?: (p: string) => string,
  updateFn: UpdateFn = atomicUpdateFrontmatter,
): Promise<RecoveryResult> {
  const orphans = await detectOrphans(vaultDir, execFn, readFn);
  let recovered = 0;
  let skipped = 0;
  let errors = 0;

  for (const orphan of orphans) {
    const result = await recoverOrphan(orphan, dryRun, execFn, updateFn);
    if (!result.ok) {
      errors++;
    } else if (dryRun) {
      skipped++;
    } else {
      recovered++;
    }
  }

  return { orphans: orphans.length, recovered, skipped, errors };
}
