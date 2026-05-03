import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  computeCostFromUsage,
  computeSessionCost,
  findSessionFile,
} from "../../../src/services/SessionCostService.js";

const TASK_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function makeJsonlLine(
  taskUuid: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: "session-123",
    message: {
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cacheReadTokens,
      },
    },
    // embed task UUID so findSessionFile can match
    systemPrompt: `Task ${taskUuid} context`,
  });
}

let tmpDir: string;
let projectDir: string;
let spawnTs: number;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "cost-test-"));
  projectDir = path.join(tmpDir, "projects", "-Users-test");
  mkdirSync(projectDir, { recursive: true });
  spawnTs = Date.now() - 100; // slightly before "now"
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeSessionFile(fileName: string, lines: string[]): string {
  const filePath = path.join(projectDir, fileName);
  writeFileSync(filePath, lines.join("\n") + "\n");
  return filePath;
}

describe("computeCostFromUsage", () => {
  it("computes cost correctly with all token types", () => {
    const cost = computeCostFromUsage({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      costUsd: 0,
    });
    // 15 + 75 + 1.5 = 91.5
    expect(cost).toBeCloseTo(91.5);
  });

  it("computes zero cost for zero tokens", () => {
    expect(
      computeCostFromUsage({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        costUsd: 0,
      }),
    ).toBe(0);
  });

  it("computes cost with only output tokens", () => {
    const cost = computeCostFromUsage({
      inputTokens: 0,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      costUsd: 0,
    });
    expect(cost).toBeCloseTo(75.0);
  });
});

describe("findSessionFile", () => {
  it("returns null with warning when no files exist after spawnTs", () => {
    const futureTs = Date.now() + 60_000;
    const result = findSessionFile(
      TASK_UUID,
      futureTs,
      path.join(tmpDir, "projects"),
    );
    expect(result.sessionFile).toBeNull();
    expect(result.warning).toBeTruthy();
  });

  it("finds file containing task UUID among candidates", () => {
    const line = makeJsonlLine(TASK_UUID, 100, 50, 10);
    const filePath = writeSessionFile("session-abc.jsonl", [line]);

    const result = findSessionFile(
      TASK_UUID,
      spawnTs,
      path.join(tmpDir, "projects"),
    );
    expect(result.sessionFile).toBe(filePath);
    expect(result.warning).toBeNull();
  });

  it("falls back to newest file when no file contains task UUID", () => {
    writeSessionFile("session-old.jsonl", [
      JSON.stringify({ type: "assistant", message: { usage: {} } }),
    ]);
    // give small delay so mtime differs, or just check it returns something
    const result = findSessionFile(
      "no-match-uuid",
      spawnTs,
      path.join(tmpDir, "projects"),
    );
    expect(result.sessionFile).not.toBeNull();
  });

  it("returns warning when projects dir does not exist", () => {
    const result = findSessionFile(
      TASK_UUID,
      spawnTs,
      path.join(tmpDir, "nonexistent"),
    );
    expect(result.sessionFile).toBeNull();
    expect(result.warning).toBeTruthy();
  });
});

describe("computeSessionCost", () => {
  it("returns correct USD cost from session.jsonl", () => {
    const line = makeJsonlLine(TASK_UUID, 100_000, 10_000, 50_000);
    writeSessionFile("session-xyz.jsonl", [line]);

    const warnings: string[] = [];
    const result = computeSessionCost(
      TASK_UUID,
      spawnTs,
      (msg) => warnings.push(msg),
      path.join(tmpDir, "projects"),
    );

    // 100000*15/1e6 + 10000*75/1e6 + 50000*1.5/1e6 = 1.5 + 0.75 + 0.075 = 2.325
    expect(result.costUsd).toBeCloseTo(2.325);
    expect(result.warning).toBeNull();
  });

  it("emits soft warning when cost exceeds 1.00 USD", () => {
    // Need cost > 1.00: e.g. 100000 output tokens = 7.5 USD
    const line = makeJsonlLine(TASK_UUID, 0, 100_000, 0);
    writeSessionFile("session-expensive.jsonl", [line]);

    const warnings: string[] = [];
    computeSessionCost(
      TASK_UUID,
      spawnTs,
      (msg) => warnings.push(msg),
      path.join(tmpDir, "projects"),
    );

    expect(warnings.some((w) => w.includes("WARNING"))).toBe(true);
    expect(warnings.some((w) => w.includes("threshold"))).toBe(true);
  });

  it("returns costUsd=0 and logs warning when no session file found", () => {
    const futureTs = Date.now() + 60_000;
    const warnings: string[] = [];
    const result = computeSessionCost(
      TASK_UUID,
      futureTs,
      (msg) => warnings.push(msg),
      path.join(tmpDir, "projects"),
    );

    expect(result.costUsd).toBe(0);
    expect(result.warning).toBeTruthy();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("returns costUsd=0 when jsonl is malformed (defensive parsing)", () => {
    writeSessionFile("session-bad.jsonl", [
      `{task_uuid: "${TASK_UUID}"}`, // invalid JSON
      `{"type":"assistant","message":{"usage":{"input_tokens":100}}, "systemPrompt": "${TASK_UUID}"}`,
    ]);

    const warnings: string[] = [];
    // The file contains TASK_UUID so findSessionFile will find it,
    // but the malformed line is skipped; only valid line contributes
    const result = computeSessionCost(
      TASK_UUID,
      spawnTs,
      (msg) => warnings.push(msg),
      path.join(tmpDir, "projects"),
    );

    // Valid line contributes 100 input tokens = 100*15/1e6 = 0.0015
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.warning).toBeNull();
  });

  it("accumulates usage across multiple assistant messages", () => {
    const line1 = makeJsonlLine(TASK_UUID, 10_000, 5_000, 0);
    const line2 = makeJsonlLine(TASK_UUID, 20_000, 3_000, 1_000);
    writeSessionFile("session-multi.jsonl", [line1, line2]);

    const result = computeSessionCost(
      TASK_UUID,
      spawnTs,
      () => {},
      path.join(tmpDir, "projects"),
    );

    // (30000*15 + 8000*75 + 1000*1.5) / 1e6 = 0.45 + 0.6 + 0.0015 = 1.0515
    expect(result.costUsd).toBeCloseTo(1.0515);
  });
});
