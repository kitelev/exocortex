/**
 * Issue #4469 / req `2d072437-c19d-49a4-ae89-f20b6185571f` — `claimTask`'s
 * "already claimed by someone else?" PRE-CHECK reads through the same predicate
 * as the write it guards.
 *
 * `readFrontmatter` carried a local `/^---\s*\r?\n…/` while the write half
 * (`atomicUpdateFrontmatter`) was widened by this work item. A pre-check blind
 * to inputs the write accepts is not a pre-check: on a lone-CR / BOM task file
 * it returned `null`, so the refusal branch was UNREACHABLE regardless of what
 * `aiTask__Task_claimedBy` held — the claim would be silently STOLEN from its
 * current owner.
 *
 * Revert-verify — `ClaimService.write-channels-4469.spec.json`.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { claimTask } from "../../../src/services/ClaimService.js";

const REQ = "@req:2d072437-c19d-49a4-ae89-f20b6185571f";
const BOM = "﻿";

describe("ClaimService pre-check (#4469)", () => {
  let dir: string;
  let target: string;
  let previousLockDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "claim-4469-"));
    target = path.join(dir, "task.md");
    previousLockDir = process.env.EXO_CLAIM_LOCK_DIR;
    process.env.EXO_CLAIM_LOCK_DIR = path.join(dir, "locks");
  });
  afterEach(() => {
    if (previousLockDir === undefined) delete process.env.EXO_CLAIM_LOCK_DIR;
    else process.env.EXO_CLAIM_LOCK_DIR = previousLockDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it(`CH50 ${REQ} a lone-CR task ALREADY claimed by another worker is refused, not stolen`, async () => {
    writeFileSync(
      target,
      "---\rexo__Asset_uid: u-1\raiTask__Task_claimedBy: worker-A\r---\rbody\r",
      "utf8",
    );

    expect(await claimTask(target, 4242)).toBe(false);
    // and the file still names its original owner
    expect(readFileSync(target, "utf8")).toContain(
      "aiTask__Task_claimedBy: worker-A",
    );
  });

  it(`CH51 ${REQ} a BOM-prefixed task ALREADY claimed by another worker is refused, not stolen`, async () => {
    writeFileSync(
      target,
      `${BOM}${BOM}---\nexo__Asset_uid: u-2\naiTask__Task_claimedBy: worker-A\n---\nbody\n`,
      "utf8",
    );

    expect(await claimTask(target, 4242)).toBe(false);
    expect(readFileSync(target, "utf8")).toContain(
      "aiTask__Task_claimedBy: worker-A",
    );
  });

  it(`CH52 ${REQ} an UNCLAIMED lone-CR task is still claimable — the pre-check refuses nothing it should not`, async () => {
    writeFileSync(target, "---\rexo__Asset_uid: u-3\r---\rbody\r", "utf8");

    expect(await claimTask(target, 4242)).toBe(true);
    expect(readFileSync(target, "utf8")).toContain(
      "aiTask__Task_claimedBy: \"4242\"",
    );
  });

  it(`CH53 ${REQ} CONTROL — the LF path behaves exactly as before`, async () => {
    writeFileSync(
      target,
      "---\nexo__Asset_uid: u-4\naiTask__Task_claimedBy: worker-A\n---\nbody\n",
      "utf8",
    );
    expect(await claimTask(target, 4242)).toBe(false);

    writeFileSync(target, "---\nexo__Asset_uid: u-5\n---\nbody\n", "utf8");
    expect(await claimTask(target, 4242)).toBe(true);
  });
});
