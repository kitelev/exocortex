import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import * as yaml from "js-yaml";

import {
  claimTask,
  releaseClaimLock,
} from "../../../src/services/ClaimService.js";

function buildMd(fm: Record<string, unknown>, body = ""): string {
  return `---\n${yaml.dump(fm)}---\n${body}`;
}

describe("ClaimService", () => {
  let tmpDir: string;
  let tmpLockDir: string;
  let target: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "claim-svc-"));
    tmpLockDir = path.join(tmpDir, "locks");
    process.env.EXO_CLAIM_LOCK_DIR = tmpLockDir;
    target = path.join(tmpDir, "task.md");
    writeFileSync(
      target,
      buildMd({
        exo__Asset_uid: "test-uuid",
        ems__Effort_status: "[[ems__EffortStatusBacklog]]",
        exo__Asset_updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
  });

  afterEach(() => {
    releaseClaimLock();
    delete process.env.EXO_CLAIM_LOCK_DIR;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("5 parallel claims → exactly one returns true", async () => {
    const results = await Promise.all(
      [1001, 1002, 1003, 1004, 1005].map((pid) => claimTask(target, pid)),
    );
    const trueCount = results.filter(Boolean).length;
    expect(trueCount).toBe(1);
  });

  it("releases lock when updateFn throws", async () => {
    const lockFile = path.join(tmpLockDir, "claim.lock");

    await expect(
      claimTask(target, 999, () => {
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");

    expect(existsSync(lockFile)).toBe(false);
  });

  it("returns false for already-claimed task", async () => {
    const first = await claimTask(target, 111);
    expect(first).toBe(true);

    const second = await claimTask(target, 222);
    expect(second).toBe(false);
  });

  it("creates lock directory if it does not exist", async () => {
    expect(existsSync(tmpLockDir)).toBe(false);
    await claimTask(target, 333);
    expect(existsSync(tmpLockDir)).toBe(true);
  });

  it("claims a task whose frontmatter has a duplicated YAML key (tolerant parse, no crash) (#3901)", async () => {
    // `readFrontmatter` had a bare `yaml.load` with NO try/catch → a dup key
    // THREW and claimTask rejected. The tolerant parser resolves last-wins so
    // the claim proceeds. REVERT-VERIFY: revert readFrontmatter to bare
    // yaml.load → this rejects/returns false → RED.
    writeFileSync(
      target,
      "---\nexo__Asset_uid: dup-uuid\nems__Effort_status: A\nems__Effort_status: B\n---\n",
    );
    const claimed = await claimTask(target, 2001);
    expect(claimed).toBe(true);
  });
});
