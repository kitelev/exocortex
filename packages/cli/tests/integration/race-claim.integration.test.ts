/**
 * Integration test: Race-condition safety for ClaimService.
 *
 * Verifies that when N workers concurrently attempt to claim the same
 * aiTask file, exactly 1 claim succeeds and the frontmatter remains
 * valid YAML with exactly one `aiTask__Task_claimedBy` entry.
 *
 * Uses EXO_CLAIM_LOCK_DIR env-var to isolate the advisory lock directory
 * from the system default so tests never affect real vault state.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  claimTask,
  releaseClaimLock,
} from "../../src/services/ClaimService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MINIMAL_FRONTMATTER = `---
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Asset_uid: "race-test-placeholder"
exo__Asset_createdAt: "2026-01-01T00:00:00+05:00"
exo__Asset_updatedAt: "2026-01-01T00:00:00+05:00"
exo__Asset_label: "Race condition test task"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
aiTask__Task_delegated: "true"
---
`;

function countOccurrences(content: string, key: string): number {
  return (content.match(new RegExp(key, "g")) ?? []).length;
}

function parseFrontmatter(filePath: string): Record<string, unknown> | null {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const parsed = yaml.load(match[1]);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tempDir: string;
let lockDir: string;

function createTaskFile(): string {
  const name = `task-${Date.now()}-${Math.random().toString(36).slice(2)}.md`;
  const taskPath = path.join(tempDir, name);
  fs.writeFileSync(taskPath, MINIMAL_FRONTMATTER, "utf8");
  return taskPath;
}

function resetLock(): void {
  releaseClaimLock();
  const lockFile = path.join(lockDir, "claim.lock");
  if (fs.existsSync(lockFile)) {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // best-effort
    }
  }
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "race-task-"));
  lockDir = fs.mkdtempSync(path.join(os.tmpdir(), "race-lock-"));
  process.env.EXO_CLAIM_LOCK_DIR = lockDir;
  resetLock();
});

afterEach(() => {
  resetLock();
  delete process.env.EXO_CLAIM_LOCK_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(lockDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaimService — race-condition integration", () => {
  describe("5 parallel claims → exactly 1 succeeds", () => {
    it("single run: exactly 1 claim succeeds out of 5", async () => {
      const taskPath = createTaskFile();
      const pids = [10001, 10002, 10003, 10004, 10005];

      const results = await Promise.all(pids.map((pid) => claimTask(taskPath, pid)));

      const succeeded = results.filter((r) => r === true).length;
      const skipped = results.filter((r) => r === false).length;

      expect(succeeded).toBe(1);
      expect(skipped).toBe(4);

      // Verify frontmatter has exactly one claimedBy entry
      const content = fs.readFileSync(taskPath, "utf8");
      expect(countOccurrences(content, "aiTask__Task_claimedBy")).toBe(1);

      // Verify YAML is valid and parseable
      const fm = parseFrontmatter(taskPath);
      expect(fm).not.toBeNull();
      expect(typeof fm!["aiTask__Task_claimedBy"]).toBe("string");

      // Verify the winner PID is one of the expected workers
      const claimedByPid = Number(fm!["aiTask__Task_claimedBy"]);
      expect(pids).toContain(claimedByPid);

      // Status must be updated to Doing
      expect(fm!["ems__Effort_status"]).toBe("[[ems__EffortStatusDoing]]");
    });

    it("10 repetitions: all pass (10/10)", async () => {
      for (let iteration = 0; iteration < 10; iteration++) {
        const taskPath = createTaskFile();

        // Ensure clean lock state before each iteration
        resetLock();

        const results = await Promise.all(
          [10001, 10002, 10003, 10004, 10005].map((pid) =>
            claimTask(taskPath, pid),
          ),
        );

        const succeeded = results.filter((r) => r === true).length;
        const content = fs.readFileSync(taskPath, "utf8");
        const claimedByCount = countOccurrences(content, "aiTask__Task_claimedBy");

        expect(succeeded).toBe(1);
        expect(claimedByCount).toBe(1);

        // YAML must remain valid after concurrent writes
        const fm = parseFrontmatter(taskPath);
        expect(fm).not.toBeNull();
      }
    }, 60_000);
  });

  describe("edge case: killed-between-claim-and-spawn", () => {
    it("stale claimed task is detectable and blocks re-claim", async () => {
      const taskPath = createTaskFile();
      const workerPid = 99999;

      // Step 1: Worker claims the task successfully
      const claimed = await claimTask(taskPath, workerPid);
      expect(claimed).toBe(true);

      // Step 2: Worker "dies" without completing spawn
      // (in real scenario the process exits; here we just don't call SpawnService)

      // Step 3: Verify stale state is correctly persisted in frontmatter
      const content = fs.readFileSync(taskPath, "utf8");
      expect(content).toContain("aiTask__Task_claimedBy");
      expect(content).toContain("aiTask__Task_claimedAt");
      expect(content).toContain(String(workerPid));

      const fm = parseFrontmatter(taskPath);
      expect(fm).not.toBeNull();
      expect(fm!["aiTask__Task_claimedBy"]).toBe(String(workerPid));
      expect(typeof fm!["aiTask__Task_claimedAt"]).toBe("string");
      // claimedAt is an ISO timestamp — recovery script uses this to detect staleness
      expect(() => new Date(fm!["aiTask__Task_claimedAt"] as string)).not.toThrow();

      // Step 4: Any new claim attempt must be rejected (task is already claimed)
      // Recovery worker detects stale via claimedAt age, then resets — not re-claims directly
      resetLock();
      const recoverAttempt = await claimTask(taskPath, 88888);
      expect(recoverAttempt).toBe(false);

      // Step 5: Original claimedBy must not be overwritten by the failed recovery attempt
      const afterContent = fs.readFileSync(taskPath, "utf8");
      expect(countOccurrences(afterContent, "aiTask__Task_claimedBy")).toBe(1);
      const afterFm = parseFrontmatter(taskPath);
      expect(afterFm!["aiTask__Task_claimedBy"]).toBe(String(workerPid));
    });

    it("frontmatter YAML is never corrupted under concurrent pressure", async () => {
      const taskPath = createTaskFile();

      // Run 5 concurrent claims, then verify YAML integrity regardless of who won
      await Promise.all(
        [20001, 20002, 20003, 20004, 20005].map((pid) =>
          claimTask(taskPath, pid),
        ),
      );

      // Must be parseable without exceptions
      expect(() => parseFrontmatter(taskPath)).not.toThrow();
      const fm = parseFrontmatter(taskPath);
      expect(fm).not.toBeNull();

      // Must contain required fields
      expect(fm!["exo__Asset_updatedAt"]).toBeDefined();
      expect(fm!["ems__Effort_status"]).toBe("[[ems__EffortStatusDoing]]");
    });
  });
});
