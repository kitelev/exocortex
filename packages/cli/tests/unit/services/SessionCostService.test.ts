import { describe, it, expect } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  computeCostFromUsage,
  computeSessionCost,
  findSessionFile,
  type UsageSummary,
} from "../../../src/services/SessionCostService.js";

// --- computeCostFromUsage ---

describe("computeCostFromUsage", () => {
  it("returns 0 for all-zero usage", () => {
    const usage: UsageSummary = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
    };
    expect(computeCostFromUsage(usage)).toBe(0);
  });

  it("computes cost from input tokens only", () => {
    const usage: UsageSummary = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
    };
    // 1M input tokens @ $15/M = $15
    expect(computeCostFromUsage(usage)).toBeCloseTo(15.0, 4);
  });

  it("computes cost from output tokens only", () => {
    const usage: UsageSummary = {
      inputTokens: 0,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      costUsd: 0,
    };
    // 1M output tokens @ $75/M = $75
    expect(computeCostFromUsage(usage)).toBeCloseTo(75.0, 4);
  });

  it("computes cost from cache read tokens only", () => {
    const usage: UsageSummary = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      costUsd: 0,
    };
    // 1M cache read tokens @ $1.5/M = $1.5
    expect(computeCostFromUsage(usage)).toBeCloseTo(1.5, 4);
  });

  it("computes combined cost correctly", () => {
    // 100K input + 10K output + 500K cache read
    const usage: UsageSummary = {
      inputTokens: 100_000,
      outputTokens: 10_000,
      cacheReadTokens: 500_000,
      costUsd: 0,
    };
    const expected = (100_000 * 15) / 1e6 + (10_000 * 75) / 1e6 + (500_000 * 1.5) / 1e6;
    expect(computeCostFromUsage(usage)).toBeCloseTo(expected, 6);
  });

  it("is consistent with sample real-world values (< $1 for small session)", () => {
    const usage: UsageSummary = {
      inputTokens: 5_000,
      outputTokens: 2_000,
      cacheReadTokens: 10_000,
      costUsd: 0,
    };
    const cost = computeCostFromUsage(usage);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1.0);
  });
});

// --- findSessionFile ---

describe("findSessionFile", () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cost-test-"));
    projectDir = path.join(tmpDir, "fake-project");
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null sessionFile when directory is empty", () => {
    const result = findSessionFile("some-uuid", Date.now(), tmpDir);
    expect(result.sessionFile).toBeNull();
    expect(result.warning).toContain("no session.jsonl");
  });

  it("returns warning when claude projects dir does not exist", () => {
    const result = findSessionFile("some-uuid", Date.now(), "/nonexistent/dir");
    expect(result.sessionFile).toBeNull();
    expect(result.warning).toBeTruthy();
  });

  it("finds the newest session file after spawn timestamp", () => {
    const taskUuid = "test-uuid-1234";
    const jsonlPath = path.join(projectDir, "session.jsonl");
    writeFileSync(jsonlPath, `{"type":"assistant","message":{"content":"x","usage":{"input_tokens":1,"output_tokens":1,"cache_read_input_tokens":0}}}\n`);

    const spawnTime = Date.now() - 10_000; // spawned 10 seconds ago
    const result = findSessionFile(taskUuid, spawnTime, tmpDir);
    // File exists but doesn't contain taskUuid — should return it as fallback (newest)
    expect(result.sessionFile).toBe(jsonlPath);
  });

  it("prefers file containing the task UUID over other files", () => {
    const taskUuid = "abc123-uuid-preferred";
    const oldPath = path.join(projectDir, "old-session.jsonl");
    const newPath = path.join(projectDir, "new-session.jsonl");

    writeFileSync(oldPath, `{"content": "${taskUuid}"}\n`);
    // Small delay to ensure different mtime would be hard to guarantee; just add UUID content
    writeFileSync(newPath, `{"type":"assistant","message":{}}\n`);

    const spawnTime = Date.now() - 60_000;
    const result = findSessionFile(taskUuid, spawnTime, tmpDir);
    // Should prefer oldPath because it contains the UUID
    expect(result.sessionFile).toBe(oldPath);
  });

  it("ignores files older than spawn timestamp", () => {
    const jsonlPath = path.join(projectDir, "old.jsonl");
    writeFileSync(jsonlPath, `{"type":"assistant"}\n`);

    // spawnTimestamp is in the far future — file is "old"
    const spawnTime = Date.now() + 999_999;
    const result = findSessionFile("uuid", spawnTime, tmpDir);
    expect(result.sessionFile).toBeNull();
  });
});

// --- computeSessionCost ---

describe("computeSessionCost", () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cost-session-"));
    projectDir = path.join(tmpDir, "fake-project");
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns costUsd=0 and warning when no session file found", () => {
    const logs: string[] = [];
    const result = computeSessionCost(
      "missing-uuid",
      Date.now(),
      (m) => logs.push(m),
      tmpDir,
    );
    expect(result.costUsd).toBe(0);
    expect(result.warning).toBeTruthy();
    expect(logs.length).toBeGreaterThan(0);
  });

  it("parses sample JSONL and returns correct USD cost", () => {
    const taskUuid = "sample-task-uuid-9999";
    const jsonlPath = path.join(projectDir, "session.jsonl");

    // 10K input, 2K output, 5K cache read — all in one assistant message
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: `task ${taskUuid}`,
        usage: {
          input_tokens: 10_000,
          output_tokens: 2_000,
          cache_read_input_tokens: 5_000,
        },
      },
    });
    writeFileSync(jsonlPath, `${line}\n`);

    const spawnTime = Date.now() - 5_000;
    const logs: string[] = [];
    const result = computeSessionCost(taskUuid, spawnTime, (m) => logs.push(m), tmpDir);

    const expected = (10_000 * 15) / 1e6 + (2_000 * 75) / 1e6 + (5_000 * 1.5) / 1e6;
    expect(result.costUsd).toBeCloseTo(expected, 6);
    expect(result.warning).toBeNull();
  });

  it("accumulates tokens across multiple assistant messages", () => {
    const taskUuid = "multi-msg-uuid-8888";
    const jsonlPath = path.join(projectDir, "multi.jsonl");

    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: `task ${taskUuid}`,
          usage: { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 0 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: "second message",
          usage: { input_tokens: 2_000, output_tokens: 1_000, cache_read_input_tokens: 200 },
        },
      }),
      // non-assistant line — should be ignored
      JSON.stringify({ type: "user", message: { content: "user prompt" } }),
    ];
    writeFileSync(jsonlPath, lines.join("\n") + "\n");

    const spawnTime = Date.now() - 5_000;
    const result = computeSessionCost(taskUuid, spawnTime, () => {}, tmpDir);

    const expectedCost =
      ((1_000 + 2_000) * 15) / 1e6 +
      ((500 + 1_000) * 75) / 1e6 +
      (200 * 1.5) / 1e6;
    expect(result.costUsd).toBeCloseTo(expectedCost, 6);
  });

  it("returns costUsd=0 and warning when JSONL has no assistant messages", () => {
    const taskUuid = "no-assistant-uuid";
    const jsonlPath = path.join(projectDir, "empty.jsonl");
    writeFileSync(jsonlPath, `${taskUuid}\n{"type":"user","message":{}}\n`);

    const spawnTime = Date.now() - 5_000;
    const logs: string[] = [];
    const result = computeSessionCost(taskUuid, spawnTime, (m) => logs.push(m), tmpDir);

    expect(result.costUsd).toBe(0);
    expect(result.warning).toBeTruthy();
  });

  it("emits warning log when cost exceeds $1.00 threshold", () => {
    const taskUuid = "expensive-task-uuid";
    const jsonlPath = path.join(projectDir, "expensive.jsonl");

    // 100K output tokens = $7.5 >> $1 threshold
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: `${taskUuid} big session`,
        usage: { input_tokens: 0, output_tokens: 100_000, cache_read_input_tokens: 0 },
      },
    });
    writeFileSync(jsonlPath, `${line}\n`);

    const spawnTime = Date.now() - 5_000;
    const logs: string[] = [];
    computeSessionCost(taskUuid, spawnTime, (m) => logs.push(m), tmpDir);

    const warnLog = logs.find((l) => l.includes("WARNING") && l.includes("exceeds threshold"));
    expect(warnLog).toBeDefined();
  });
});
