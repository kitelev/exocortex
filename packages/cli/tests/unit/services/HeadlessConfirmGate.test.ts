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
    // req `d4ccc901` — empty, and the pre-existing "2 files to remove" assertion
    // below stays CORRECT rather than being grandfathered. The park/destroy
    // partition happens in the PRODUCERS (`buildDiff` / the REST classification
    // loop), which put an AssetSpace in `toDestroy` XOR `toPark`; this gate is a
    // renderer and prints the plan it is handed. A fixture that hands it two
    // files under `filesToDestroy` is by definition describing a destroy, so the
    // count it must print is still 2. The park path gets its own fixture.
    assetSpacesBeingParked: [],
    assetSpacesBeingUnparked: [],
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

  /**
   * @req:d4ccc901-83a4-4495-a4bb-43d1305dfd00
   *
   * req `d4ccc901` — the CLI half of "the plan a human approves must describe
   * the mechanism". The compiler already forces this renderer to ACKNOWLEDGE the
   * new fields (they are required on `ApplyPlan`); it cannot force it to PRINT
   * them. So the mutant these guard against is not "field missing from the type"
   * — it is deleting the `log(...)` call while keeping the field read. That
   * compiles, and only these assertions redden.
   */
  describe("@req:d4ccc901-83a4-4495-a4bb-43d1305dfd00 parked / unparked lines", () => {
    it("PRINTS a park line, and says the files are not removed", async () => {
      const log = jest.fn<(m: string) => void>();
      const gate = new HeadlessConfirmGate({ yes: true, verbose: true, log });
      await gate.confirmApply(
        makePlan({
          filesToDestroy: new Map(),
          assetSpacesBeingTornDown: [],
          assetSpacesBeingParked: [
            { asUid: "as-soft", asLabel: "soft", fileCount: 42 },
          ],
        }),
      );
      const joined = log.mock.calls.map((args) => args[0]).join("\n");
      expect(joined).toContain("42 files to park");
      expect(joined).toContain("1 AS to park");
      // The whole point of the partition: the same 42 files must NOT also be
      // announced as removals.
      expect(joined).toContain("0 files to remove");
    });

    it("PRINTS an unpark line saying no download is involved", async () => {
      const log = jest.fn<(m: string) => void>();
      const gate = new HeadlessConfirmGate({ yes: true, verbose: true, log });
      await gate.confirmApply(
        makePlan({
          assetSpacesBeingUnparked: [{ asUid: "as-soft", asLabel: "soft" }],
        }),
      );
      const joined = log.mock.calls.map((args) => args[0]).join("\n");
      expect(joined).toContain("1 AS to unpark");
      expect(joined).toContain("no download");
    });

    it("stays SILENT about parking when nothing is parked (no noise on the common path)", async () => {
      const log = jest.fn<(m: string) => void>();
      const gate = new HeadlessConfirmGate({ yes: true, verbose: true, log });
      await gate.confirmApply(makePlan());
      const joined = log.mock.calls.map((args) => args[0]).join("\n");
      expect(joined).not.toContain("to park");
      expect(joined).not.toContain("to unpark");
    });
  });
});
