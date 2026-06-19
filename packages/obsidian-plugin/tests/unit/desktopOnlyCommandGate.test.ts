import { readFileSync } from "fs";
import { resolve } from "path";
import {
  findDesktopOnlyGatedAddCommands,
  isDesktopOnlyCondition,
} from "../../../../.archgate/lint/desktopOnlyCommandGate";

/**
 * Revert-verify for the MOBILE-004 archgate rule (Desktop↔Mobile Command
 * Parity). The shared scanner in `.archgate/lint/desktopOnlyCommandGate.ts`
 * is the SAME module the archgate rule imports, so these assertions exercise
 * the actual CI gate logic verbatim:
 *
 *   - a desktop-only-gated `addCommand` fixture → the gate FAILS (hit found)
 *   - clean / unconditional / parity-pattern fixtures → the gate PASSES (no hit)
 *
 * That FAIL-on-gated / PASS-on-clean pair is the integration-test-revert-verify
 * discipline applied to an arch rule.
 */
describe("desktopOnlyCommandGate — MOBILE-004 detection", () => {
  describe("FAILS (desktop-only gate → violation found)", () => {
    it("flags addCommand inside an `if (!Platform.isMobile)` block", () => {
      const src = `
        function wire(plugin) {
          if (!Platform.isMobile) {
            plugin.addCommand({ id: "x", name: "X", callback: () => {} });
          }
        }
      `;
      const hits = findDesktopOnlyGatedAddCommands(src);
      expect(hits).toHaveLength(1);
      expect(hits[0].reason).toMatch(/desktop-only guard block/);
    });

    it("flags a single-statement `if (!Platform.isMobile) plugin.addCommand(...)`", () => {
      const src = `
        function wire(plugin) {
          if (!Platform.isMobile) plugin.addCommand({ id: "x", name: "X" });
        }
      `;
      const hits = findDesktopOnlyGatedAddCommands(src);
      expect(hits).toHaveLength(1);
      expect(hits[0].reason).toMatch(/same line/);
    });

    it("flags addCommand inside an `if (Platform.isDesktopApp)` block", () => {
      const src = `
        if (Platform.isDesktopApp) {
          this.addCommand({ id: "y", name: "Y" });
        }
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(1);
    });

    it("flags a `&& !Platform.isMobile` guarded block too", () => {
      const src = `
        if (ready && !Platform.isMobile) {
          this.addCommand({ id: "z", name: "Z" });
        }
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(1);
    });
  });

  describe("PASSES (parity-correct / unconditional → no false positive)", () => {
    it("does NOT flag an unconditional registration", () => {
      const src = `
        this.addCommand({ id: "always", name: "Always", callback: () => {} });
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(0);
    });

    it("does NOT flag the parity pattern `applyDeps !== null || (Platform.isMobile && restMount !== null)`", () => {
      const src = `
        if (applyDeps !== null || (Platform.isMobile && restMount !== null)) {
          this.addCommand({ id: "apply-profile", name: "Apply profile" });
        }
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(0);
    });

    it("does NOT flag a `Platform.isMobile && restMount` mobile-inclusive guard", () => {
      const src = `
        if (restMount !== null) {
          this.addCommand({ id: "unmount", name: "Unmount" });
        }
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(0);
    });

    it("does NOT flag a mobile-only block (mobile users are served)", () => {
      const src = `
        if (Platform.isMobile) {
          this.addCommand({ id: "mob", name: "Mobile only" });
        }
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(0);
    });

    it("does NOT flag addCommand mentioned only in a comment", () => {
      const src = `
        if (!Platform.isMobile) {
          // historically this used to plugin.addCommand(...) here
          doSomethingElse();
        }
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(0);
    });
  });

  describe("isDesktopOnlyCondition", () => {
    it.each([
      ["!Platform.isMobile", true],
      ["Platform.isDesktopApp", true],
      ["ready && !Platform.isMobile", true],
      ["applyDeps !== null || (Platform.isMobile && restMount !== null)", false],
      ["Platform.isMobile", false],
      ["Platform.isMobile ? a : b", false],
      ["someOtherCondition", false],
    ])("%s → %s", (cond, expected) => {
      expect(isDesktopOnlyCondition(cond as string)).toBe(expected);
    });
  });

  describe("real plugin source is parity-clean", () => {
    it("ExocortexPlugin.ts has zero desktop-only-gated addCommand", () => {
      const file = resolve(__dirname, "../../src/ExocortexPlugin.ts");
      const content = readFileSync(file, "utf8");
      const hits = findDesktopOnlyGatedAddCommands(content);
      expect(hits).toEqual([]);
    });
  });
});
