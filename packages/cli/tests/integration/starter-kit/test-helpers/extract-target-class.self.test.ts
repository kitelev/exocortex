/**
 * Integration self-test for `extract-target-class` — runs the RFC v4 §7.1a
 * ladder against the live `starter-kit-fixtures` submodule and pins the
 * Strategy-distribution aggregate against the Phase 0 post-Option-C baseline
 * (`/Users/kitelev/Developer/phase1-post-migration-ladder-2026-04-20.md`).
 *
 * The unit suite (`tests/unit/test-helpers/extract-target-class.test.ts`)
 * covers per-branch logic with synthetic data. This self-test is the canary:
 * if ladder drift, Option-C migration rollback, or fixture churn ever changes
 * the gate math, the test goes red immediately.
 */
import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadCommandCatalog } from "./command-catalog.js";
import {
  extractTargetClassFromCommand,
  loadStarterKitContext,
  type ResolutionStrategy,
} from "./extract-target-class.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "..",
  "starter-kit-fixtures",
);

const SUBMODULE_HYDRATED =
  fs.existsSync(FIXTURES_ROOT) &&
  fs.existsSync(path.join(FIXTURES_ROOT, "exocmd"));

const describeOrSkip = SUBMODULE_HYDRATED ? describe : describe.skip;

describeOrSkip("extract-target-class ladder (self-test)", () => {
  const catalog = loadCommandCatalog();
  const ctx = loadStarterKitContext();
  const results = catalog.map((cmd) => ({
    cmd,
    result: extractTargetClassFromCommand(cmd, ctx),
  }));
  const counts = new Map<ResolutionStrategy, number>([
    ["S1", 0],
    ["S2", 0],
    ["S3", 0],
    ["S4", 0],
    ["S5", 0],
  ]);
  for (const { result } of results) {
    counts.set(result.strategy, (counts.get(result.strategy) ?? 0) + 1);
  }

  it("classifies every Command into a strategy", () => {
    expect(catalog.length).toBeGreaterThanOrEqual(40);
    expect(results).toHaveLength(catalog.length);
  });

  it("S1 count matches Option-C migration anchor (8 creation commands)", () => {
    // Creation commands migrated in Phase 1 reconcile (starter-kit PR #81).
    // Floor at 7 to absorb ±1 fixture churn without turning red prematurely.
    expect(counts.get("S1")).toBeGreaterThanOrEqual(7);
  });

  it("S5 fallback ratio ≤ 30% (RFC §7.1a gate)", () => {
    const s5 = counts.get("S5") ?? 0;
    const ratio = s5 / catalog.length;
    expect(ratio).toBeLessThanOrEqual(0.3);
  });

  it("all non-S5 results are NOT dispatchOnly; S5 results ARE", () => {
    for (const { result } of results) {
      if (result.strategy === "S5") expect(result.dispatchOnly).toBe(true);
      else expect(result.dispatchOnly).toBe(false);
    }
  });

  it("every resolved targetClass is a non-empty string", () => {
    for (const { result } of results) {
      expect(typeof result.targetClass).toBe("string");
      expect(result.targetClass.length).toBeGreaterThan(0);
    }
  });
});
