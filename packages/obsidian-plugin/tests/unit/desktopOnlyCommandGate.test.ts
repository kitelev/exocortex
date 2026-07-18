import { readFileSync } from "fs";
import { resolve } from "path";
// Single source of truth: the scanner functions are inlined in the archgate
// MOBILE-004 rule file (archgate v0.50.0 forbids rule files importing local
// modules) and re-exported for this test — no drift between the CI gate and its
// test.
import {
  findDesktopOnlyGatedAddCommands,
  isDesktopOnlyCondition,
} from "../../../../.archgate/adrs/MOBILE-004-no-desktop-only-gated-addcommand.rules";

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

    it("flags an Allman-brace `if (!Platform.isMobile)` block", () => {
      const src = `
        if (!Platform.isMobile)
        {
          this.addCommand({ id: "allman", name: "Allman" });
        }
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(1);
    });

    it("flags a brace-less multi-line `if (!Platform.isMobile)` single statement", () => {
      const src = `
        if (!Platform.isMobile)
          this.addCommand({ id: "nobrace", name: "No brace" });
      `;
      const hits = findDesktopOnlyGatedAddCommands(src);
      expect(hits).toHaveLength(1);
      expect(hits[0].reason).toMatch(/brace-less/);
    });

    it("flags a brace-less guard even across a comment line", () => {
      const src = `
        if (!Platform.isMobile)
          // historical note
          this.addCommand({ id: "c", name: "C" });
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

    it("does NOT flag a brace-less guard over a non-addCommand statement", () => {
      const src = `
        if (!Platform.isMobile)
          doDesktopOnlyThing();
        this.addCommand({ id: "after", name: "After (unconditional)" });
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(0);
    });
  });

  // Honest false-negative boundary — these desktop-only-gating shapes are NOT
  // caught (documented in the ADR). The gate is defense-in-depth for the
  // likeliest regression; these assertions pin the current coverage limit so a
  // future improvement that starts catching them updates the test deliberately.
  describe("documented false-negatives (not yet caught)", () => {
    it("does NOT catch an early-return `if (Platform.isMobile) return;` guard", () => {
      const src = `
        function wire(plugin) {
          if (Platform.isMobile) return;
          plugin.addCommand({ id: "early", name: "Early" });
        }
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(0);
    });

    it("does NOT catch an else-branch desktop-only registration", () => {
      const src = `
        if (Platform.isMobile) {
          doMobile();
        } else {
          this.addCommand({ id: "else", name: "Else" });
        }
      `;
      expect(findDesktopOnlyGatedAddCommands(src)).toHaveLength(0);
    });

    it("does NOT catch data-flow gating through a deps variable", () => {
      const src = `
        const deps = Platform.isMobile ? null : build();
        if (deps !== null) {
          this.addCommand({ id: "dataflow", name: "Data flow" });
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
    it.each([
      "../../src/ExocortexPlugin.ts",
      // RFC 0002 §3.9 subject — the onboarding command registration file.
      "../../src/infrastructure/adapters/firstRunOnboarding.ts",
    ])("%s has zero desktop-only-gated addCommand", (relPath) => {
      const content = readFileSync(resolve(__dirname, relPath), "utf8");
      expect(findDesktopOnlyGatedAddCommands(content)).toEqual([]);
    });
  });
});
