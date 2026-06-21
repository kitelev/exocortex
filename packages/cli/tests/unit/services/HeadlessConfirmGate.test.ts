/**
 * Unit tests for HeadlessConfirmGate (RFC 22b50a17 Phase 1b).
 */
import { describe, it, expect, jest } from "@jest/globals";
import type { ApplyPlan } from "@kitelev/exocortex-core";
import { HeadlessConfirmGate } from "../../../src/services/HeadlessConfirmGate.js";

function makePlan(overrides: Partial<ApplyPlan> = {}): ApplyPlan {
  return {
    targetProfileUid: "target-uid",
    targetProfileLabel: "Work",
    sourceProfileUid: "source-uid",
    sourceProfileLabel: "Personal",
    filesToDestroy: new Map([
      ["as-personal", ["assetspaces/personal/a.md", "assetspaces/personal/b.md"]],
    ]),
    assetSpacesBeingTornDown: [
      { asUid: "as-personal", asLabel: "personal", fileCount: 2 },
    ],
    assetSpacesBeingMaterialized: [
      { asUid: "as-work", asLabel: "work" },
    ],
    ...overrides,
  };
}

describe("HeadlessConfirmGate", () => {
  it("returns true when --yes is passed", async () => {
    const log = jest.fn<(m: string) => void>();
    const gate = new HeadlessConfirmGate({ yes: true, log });
    const ok = await gate.confirmApply(makePlan());
    expect(ok).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("returns false (refuses) by default without --yes", async () => {
    const log = jest.fn<(m: string) => void>();
    const gate = new HeadlessConfirmGate({ yes: false, log });
    const ok = await gate.confirmApply(makePlan());
    expect(ok).toBe(false);
    const lines = log.mock.calls.map((args) => args[0]);
    expect(lines.some((line) => line.includes("Refused"))).toBe(true);
    expect(lines.some((line) => line.includes("--yes"))).toBe(true);
  });

  it("emits verbose plan summary to log when verbose=true (regardless of yes)", async () => {
    const log = jest.fn<(m: string) => void>();
    const gate = new HeadlessConfirmGate({ yes: true, verbose: true, log });
    await gate.confirmApply(makePlan());
    const joined = log.mock.calls.map((args) => args[0]).join("\n");
    expect(joined).toContain("Target: Work (target-uid)");
    expect(joined).toContain("Source: Personal");
    expect(joined).toContain("2 files to remove");
    expect(joined).toContain("1 AS to tear down");
    expect(joined).toContain("1 AS to materialize");
  });

  it("verbose mode still refuses without --yes", async () => {
    const log = jest.fn<(m: string) => void>();
    const gate = new HeadlessConfirmGate({ yes: false, verbose: true, log });
    const ok = await gate.confirmApply(makePlan());
    expect(ok).toBe(false);
    const lines = log.mock.calls.map((args) => args[0]);
    expect(lines.some((line) => line.includes("Refused"))).toBe(true);
    expect(lines.some((line) => line.includes("Target:"))).toBe(true);
  });

  it("counts files across multiple assetspaces correctly", async () => {
    const log = jest.fn<(m: string) => void>();
    const gate = new HeadlessConfirmGate({ yes: true, verbose: true, log });
    await gate.confirmApply(
      makePlan({
        filesToDestroy: new Map([
          ["as-a", ["a/1.md", "a/2.md", "a/3.md"]],
          ["as-b", ["b/1.md", "b/2.md"]],
        ]),
      }),
    );
    const joined = log.mock.calls.map((args) => args[0]).join("\n");
    expect(joined).toContain("5 files to remove");
  });

  it("defaults verbose to false (no plan output)", async () => {
    const log = jest.fn<(m: string) => void>();
    const gate = new HeadlessConfirmGate({ yes: true, log });
    await gate.confirmApply(makePlan());
    expect(log).not.toHaveBeenCalled();
  });
});
