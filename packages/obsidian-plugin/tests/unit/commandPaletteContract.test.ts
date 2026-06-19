/**
 * Contract tests for the command-palette grooming — RFC 0002 §3.2
 * ([P2, P3, P4, P16]).
 *
 * These lock the single source of truth that the production registration sites
 * import (`commandPaletteContract`), so the assertions here ARE the strings
 * users see in the palette — no fixture/production drift (test-fixture-realism).
 *
 * Regression-verify discipline: the de-jargon assertions name the exact NEW
 * strings, so a revert to the old jargon names ("Bootstrap vault", "Unmount
 * assetspace", lowercase "edit properties", …) turns these tests red.
 */
import {
  ADVANCED_MARKER,
  GROOMED_COMMAND_NAMES,
  DESTRUCTIVE_COMMAND_IDS,
  REMOVE_PACK_PICKER_TITLE,
  REMOVE_PACK_CONFIRM_TITLE,
  REMOVE_PACK_CONFIRM_LABEL,
  isGlyphOnly,
  type GroomedCommandId,
} from "@plugin/application/services/commandPaletteContract";

describe("commandPaletteContract — RFC 0002 §3.2 palette grooming", () => {
  describe("id stability (P3 — ids immutable, only display name changes)", () => {
    it("keys are exactly the known stable command ids", () => {
      // If a key is renamed, an Obsidian hotkey / automation bound to the old id
      // silently breaks (Obsidian persists by id). Lock the id set byte-exact.
      expect(Object.keys(GROOMED_COMMAND_NAMES).sort()).toEqual(
        [
          "add-assetspace",
          "bootstrap-vault",
          "clear-switch-cache",
          "edit-properties",
          "exosync-parity-report",
          "push-current-assetspace",
          "show-profile-state",
          "unmount-assetspace",
        ].sort(),
      );
    });
  });

  describe("de-jargon renames (P3)", () => {
    it.each<[GroomedCommandId, string]>([
      ["bootstrap-vault", "Set up the engine"],
      ["add-assetspace", "Add a knowledge pack"],
      ["push-current-assetspace", "Push current knowledge pack"],
      ["show-profile-state", "Show active profile"],
      ["exosync-parity-report", "Check sync status"],
    ])("%s → plain-language %j", (id, expected) => {
      expect(GROOMED_COMMAND_NAMES[id]).toBe(expected);
    });

    it("no groomed name still contains the internal jargon terms", () => {
      const jargon = /assetspace|bootstrap|parity|switch cache|wipe-all/i;
      for (const name of Object.values(GROOMED_COMMAND_NAMES)) {
        expect(name).not.toMatch(jargon);
      }
    });
  });

  describe("casing fix (P3 — `edit properties` was lowercase)", () => {
    it("edit-properties is sentence case", () => {
      expect(GROOMED_COMMAND_NAMES["edit-properties"]).toBe("Edit properties");
    });

    it("every groomed name starts with an uppercase letter (sentence case)", () => {
      for (const name of Object.values(GROOMED_COMMAND_NAMES)) {
        expect(name[0]).toBe(name[0].toUpperCase());
        expect(name[0]).toMatch(/[A-Z]/); // not a glyph / lowercase / digit
      }
    });
  });

  describe("destructive flagging (P4 / P16 / M5)", () => {
    it("every destructive command id is a known groomed command", () => {
      for (const id of DESTRUCTIVE_COMMAND_IDS) {
        expect(GROOMED_COMMAND_NAMES[id]).toBeDefined();
      }
    });

    it("100% of destructive commands carry the «(advanced)» text marker (M5)", () => {
      for (const id of DESTRUCTIVE_COMMAND_IDS) {
        expect(GROOMED_COMMAND_NAMES[id]).toContain(ADVANCED_MARKER);
      }
    });

    it("the marker is real text, not an emoji glyph (P16 — AT-reliable)", () => {
      // Stripping all glyphs from the marker must leave the literal word.
      expect(isGlyphOnly(ADVANCED_MARKER)).toBe(false);
      expect(ADVANCED_MARKER).toBe("(advanced)");
    });

    it("non-destructive groomed commands do NOT carry the «(advanced)» marker", () => {
      const destructive = new Set<string>(DESTRUCTIVE_COMMAND_IDS);
      for (const [id, name] of Object.entries(GROOMED_COMMAND_NAMES)) {
        if (!destructive.has(id)) {
          expect(name).not.toContain(ADVANCED_MARKER);
        }
      }
    });
  });

  describe("accessibility (P16 — no glyph-only name)", () => {
    it("no groomed command name is glyph-only", () => {
      for (const name of Object.values(GROOMED_COMMAND_NAMES)) {
        expect(isGlyphOnly(name)).toBe(false);
      }
    });

    it("isGlyphOnly flags a lone emoji and clears plain text", () => {
      expect(isGlyphOnly("⚠️")).toBe(true);
      expect(isGlyphOnly("  🗑️ ")).toBe(true);
      expect(isGlyphOnly("Remove knowledge pack (advanced)")).toBe(false);
    });
  });

  describe("unmount flow stays coherent with the groomed palette name", () => {
    it("picker + confirm copy use the plain «Remove knowledge pack» language", () => {
      expect(REMOVE_PACK_PICKER_TITLE).toBe("Remove knowledge pack");
      expect(REMOVE_PACK_CONFIRM_TITLE).toBe("Remove knowledge pack?");
      expect(REMOVE_PACK_CONFIRM_LABEL).toBe("Remove");
    });

    it("flow titles carry no «(advanced)» marker (marker is palette-only)", () => {
      expect(REMOVE_PACK_PICKER_TITLE).not.toContain(ADVANCED_MARKER);
      expect(REMOVE_PACK_CONFIRM_TITLE).not.toContain(ADVANCED_MARKER);
    });

    it("flow titles share the palette command's base wording (no jargon re-entry)", () => {
      expect(GROOMED_COMMAND_NAMES["unmount-assetspace"]).toContain(
        REMOVE_PACK_PICKER_TITLE,
      );
    });
  });
});
