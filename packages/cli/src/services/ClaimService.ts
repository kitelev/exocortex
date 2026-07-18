import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseYamlFrontmatterTolerant } from "@kitelev/exocortex-core";
import {
  atomicUpdateFrontmatter,
  AtomicUpdateOptions,
  AtomicUpdateResult,
} from "./AtomicFrontmatterService.js";

// Flock-based claim transaction for aiTask delegation.
// Lock file: ~/.exocortex/locks/claim.lock (or EXO_CLAIM_LOCK_DIR override for tests).
// Advisory exclusive lock via O_CREAT|O_EXCL atomic file creation (POSIX/APFS safe).

type UpdateFn = (
  filePath: string,
  updates: Record<string, unknown>,
  options?: AtomicUpdateOptions,
) => AtomicUpdateResult;

const LOCK_RETRIES = 10;
const LOCK_RETRY_DELAY_MS = 100;

// Module-level lock state — safe in single-threaded Node.js event loop.
let _lockHeld = false;

function getLockDir(): string {
  return (
    process.env.EXO_CLAIM_LOCK_DIR ??
    path.join(os.homedir(), ".exocortex", "locks")
  );
}

function getLockFile(): string {
  return path.join(getLockDir(), "claim.lock");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryAcquireLockFileOnce(): boolean {
  try {
    const fd = fs.openSync(
      getLockFile(),
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    fs.closeSync(fd);
    _lockHeld = true;
    return true;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw e;
  }
}

async function acquireLock(): Promise<boolean> {
  fs.mkdirSync(getLockDir(), { recursive: true });
  for (let i = 0; i < LOCK_RETRIES; i++) {
    if (tryAcquireLockFileOnce()) return true;
    if (i < LOCK_RETRIES - 1) await sleep(LOCK_RETRY_DELAY_MS);
  }
  return false;
}

export function releaseClaimLock(): void {
  if (_lockHeld) {
    try {
      fs.unlinkSync(getLockFile());
    } catch {
      // best-effort
    }
    _lockHeld = false;
  }
}

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---/;

function readFrontmatter(filePath: string): Record<string, unknown> | null {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  // Tolerant parse (#3901 / #3800): a duplicated YAML key resolves last-wins
  // instead of throwing — the bare `yaml.load` here had NO try/catch, so a
  // dup-key claim file would CRASH claimTask; tolerant returns the mapping
  // (or null on genuine malformed). Non-dup input is byte-identical.
  const parsed = parseYamlFrontmatterTolerant(match[1], filePath);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Claim an aiTask file for this worker.
 *
 * Returns true if the claim succeeded (this worker now owns the task),
 * false if it was already claimed by another worker or the lock timed out.
 *
 * The optional updateFn parameter is for dependency injection in tests.
 */
export async function claimTask(
  taskFilePath: string,
  workerPid: number,
  updateFn: UpdateFn = atomicUpdateFrontmatter,
): Promise<boolean> {
  const acquired = await acquireLock();
  if (!acquired) return false;

  try {
    const fm = readFrontmatter(taskFilePath);
    if (
      fm !== null &&
      fm["aiTask__Task_claimedBy"] !== undefined &&
      fm["aiTask__Task_claimedBy"] !== null
    ) {
      return false;
    }

    const now = new Date().toISOString();
    const result = updateFn(
      taskFilePath,
      {
        "aiTask__Task_claimedBy": String(workerPid),
        "aiTask__Task_claimedAt": now,
        "ems__Effort_status": "[[ems__EffortStatusDoing]]",
        "ems__Effort_startTimestamp": now,
        "exo__Asset_updatedAt": now,
      },
      {
        verifyKey: "aiTask__Task_claimedBy",
        verifyValue: String(workerPid),
      },
    );

    return result.success && result.verified;
  } finally {
    releaseClaimLock();
  }
}
