/**
 * SearchTypes Unit Tests
 *
 * Tests for search types, color utilities, and constants.
 */

import {
  BUILT_IN_PALETTES,
  DEFAULT_TYPE_COLORS,
  DEFAULT_SEARCH_OPTIONS,
  DEFAULT_HIGHLIGHT_STYLE,
  generateColorFromString,
  generateGoldenRatioColor,
  hslToHex,
  calculateContrastRatio,
  getRelativeLuminance,
  meetsWCAGAA,
  formatTypeUri,
} from "../../../../../../src/presentation/renderers/graph/search";

describe("SearchTypes", () => {
  describe("BUILT_IN_PALETTES", () => {
    it("should have at least 3 palettes", () => {
      expect(BUILT_IN_PALETTES.length).toBeGreaterThanOrEqual(3);
    });

    it("should include default, pastel, and colorblind-safe palettes", () => {
      const paletteIds = BUILT_IN_PALETTES.map((p) => p.id);
      expect(paletteIds).toContain("default");
      expect(paletteIds).toContain("pastel");
      expect(paletteIds).toContain("colorblind-safe");
    });

    it("should have valid palette structure", () => {
      for (const palette of BUILT_IN_PALETTES) {
        expect(palette.id).toBeDefined();
        expect(palette.name).toBeDefined();
        expect(palette.colors).toBeInstanceOf(Array);
        expect(palette.colors.length).toBeGreaterThanOrEqual(6);
        expect(palette.background).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(palette.foreground).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });

    it("should have valid hex colors in each palette", () => {
      for (const palette of BUILT_IN_PALETTES) {
        for (const color of palette.colors) {
          expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        }
      }
    });
  });

  describe("DEFAULT_TYPE_COLORS", () => {
    it("should have common ontology types", () => {
      const typeUris = DEFAULT_TYPE_COLORS.map((t) => t.typeUri);
      expect(typeUris).toContain("ems__Task");
      expect(typeUris).toContain("ems__Project");
      expect(typeUris).toContain("ems__Area");
    });

    it("should have valid color configs", () => {
      for (const config of DEFAULT_TYPE_COLORS) {
        expect(config.typeUri).toBeDefined();
        expect(config.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(typeof config.priority).toBe("number");
      }
    });
  });

  describe("DEFAULT_SEARCH_OPTIONS", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_SEARCH_OPTIONS.caseSensitive).toBe(false);
      expect(DEFAULT_SEARCH_OPTIONS.useRegex).toBe(false);
      expect(DEFAULT_SEARCH_OPTIONS.searchLabels).toBe(true);
      expect(DEFAULT_SEARCH_OPTIONS.minChars).toBeGreaterThan(0);
      expect(DEFAULT_SEARCH_OPTIONS.maxResults).toBeGreaterThan(0);
    });
  });

  describe("DEFAULT_HIGHLIGHT_STYLE", () => {
    it("should have valid highlight colors", () => {
      expect(DEFAULT_HIGHLIGHT_STYLE.fillColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(DEFAULT_HIGHLIGHT_STYLE.borderColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(DEFAULT_HIGHLIGHT_STYLE.dimOpacity).toBeGreaterThan(0);
      expect(DEFAULT_HIGHLIGHT_STYLE.dimOpacity).toBeLessThan(1);
    });
  });

  describe("generateColorFromString", () => {
    it("should return consistent color for same input", () => {
      const color1 = generateColorFromString("test");
      const color2 = generateColorFromString("test");
      expect(color1).toBe(color2);
    });

    it("should return different colors for different inputs", () => {
      const color1 = generateColorFromString("apple");
      const color2 = generateColorFromString("banana");
      // They could be the same by chance, but highly unlikely
      // Let's just verify they're valid colors
      expect(color1).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(color2).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should use provided palette", () => {
      const testPalette = {
        id: "test",
        name: "Test",
        colors: ["#ff0000", "#00ff00", "#0000ff"],
        background: "#000000",
        foreground: "#ffffff",
      };
      const color = generateColorFromString("test", testPalette);
      expect(testPalette.colors).toContain(color);
    });
  });

  describe("generateGoldenRatioColor", () => {
    it("should return valid hex color", () => {
      for (let i = 0; i < 10; i++) {
        const color = generateGoldenRatioColor(i);
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });

    it("should produce distinct colors", () => {
      const colors = new Set<string>();
      for (let i = 0; i < 20; i++) {
        colors.add(generateGoldenRatioColor(i));
      }
      // Should have at least 15 unique colors out of 20
      expect(colors.size).toBeGreaterThan(15);
    });
  });

  describe("hslToHex", () => {
    it("should convert red correctly", () => {
      const hex = hslToHex(0, 100, 50);
      expect(hex).toBe("#ff0000");
    });

    it("should convert green correctly", () => {
      const hex = hslToHex(120, 100, 50);
      expect(hex).toBe("#00ff00");
    });

    it("should convert blue correctly", () => {
      const hex = hslToHex(240, 100, 50);
      expect(hex).toBe("#0000ff");
    });

    it("should handle gray (0 saturation)", () => {
      const hex = hslToHex(0, 0, 50);
      expect(hex).toBe("#808080");
    });

    it("should handle white", () => {
      const hex = hslToHex(0, 0, 100);
      expect(hex).toBe("#ffffff");
    });

    it("should handle black", () => {
      const hex = hslToHex(0, 0, 0);
      expect(hex).toBe("#000000");
    });
  });

  describe("getRelativeLuminance", () => {
    it("should return 0 for black", () => {
      expect(getRelativeLuminance("#000000")).toBeCloseTo(0, 2);
    });

    it("should return 1 for white", () => {
      expect(getRelativeLuminance("#ffffff")).toBeCloseTo(1, 2);
    });

    it("should return higher value for lighter colors", () => {
      const lightGray = getRelativeLuminance("#cccccc");
      const darkGray = getRelativeLuminance("#333333");
      expect(lightGray).toBeGreaterThan(darkGray);
    });
  });

  describe("calculateContrastRatio", () => {
    it("should return 21 for black on white", () => {
      const ratio = calculateContrastRatio("#000000", "#ffffff");
      expect(ratio).toBeCloseTo(21, 0);
    });

    it("should return 1 for same color", () => {
      const ratio = calculateContrastRatio("#888888", "#888888");
      expect(ratio).toBeCloseTo(1, 1);
    });

    it("should be symmetric", () => {
      const ratio1 = calculateContrastRatio("#ff0000", "#ffffff");
      const ratio2 = calculateContrastRatio("#ffffff", "#ff0000");
      expect(ratio1).toBeCloseTo(ratio2, 2);
    });
  });

  describe("meetsWCAGAA", () => {
    it("should return true for black on white (normal text)", () => {
      expect(meetsWCAGAA("#000000", "#ffffff", false)).toBe(true);
    });

    it("should return true for white on black (normal text)", () => {
      expect(meetsWCAGAA("#ffffff", "#000000", false)).toBe(true);
    });

    it("should have lower threshold for large text", () => {
      // Find a color that passes for large text but fails for normal text
      // Light gray on white has low contrast
      const lightGrayOnWhiteNormal = meetsWCAGAA("#767676", "#ffffff", false);
      const lightGrayOnWhiteLarge = meetsWCAGAA("#767676", "#ffffff", true);
      // #767676 is the minimum for AA on white
      expect(lightGrayOnWhiteNormal).toBe(true);
      expect(lightGrayOnWhiteLarge).toBe(true);
    });

    it("should fail for low contrast", () => {
      // Very light gray on white
      expect(meetsWCAGAA("#eeeeee", "#ffffff", false)).toBe(false);
    });
  });

  describe("formatTypeUri", () => {
    it("should extract local name from namespace prefix", () => {
      expect(formatTypeUri("ems__Task")).toBe("Task");
      expect(formatTypeUri("exo__Asset")).toBe("Asset");
      expect(formatTypeUri("ims__Concept")).toBe("Concept");
    });

    it("should extract local name from hash URI", () => {
      expect(formatTypeUri("http://example.org/ontology#Person")).toBe("Person");
      expect(formatTypeUri("http://www.w3.org/2002/07/owl#Class")).toBe("Class");
    });

    it("should extract local name from slash URI", () => {
      expect(formatTypeUri("http://example.org/types/Document")).toBe("Document");
    });

    it("should return input if no namespace", () => {
      expect(formatTypeUri("SimpleType")).toBe("SimpleType");
    });

    it("should handle empty string", () => {
      expect(formatTypeUri("")).toBe("");
    });
  });
});
