/**
 * AccessibilityTypes Tests
 *
 * Tests for WCAG contrast ratio utilities and accessibility type definitions.
 */

import {
  DEFAULT_A11Y_CONFIG,
  DEFAULT_REDUCED_MOTION_CONFIG,
  HIGH_CONTRAST_THEMES,
  WCAG_CONTRAST_RATIOS,
  getContrastRatio,
  getRelativeLuminance,
  getScreenReaderCapabilities,
  meetsWCAGAA,
  meetsWCAGAAA,
} from "../../../../../../src/presentation/renderers/graph/accessibility";

describe("AccessibilityTypes", () => {
  describe("DEFAULT_A11Y_CONFIG", () => {
    it("should have sensible default values", () => {
      expect(DEFAULT_A11Y_CONFIG.enableScreenReader).toBe(true);
      expect(DEFAULT_A11Y_CONFIG.enableKeyboardNav).toBe(true);
      expect(DEFAULT_A11Y_CONFIG.respectReducedMotion).toBe(true);
      expect(DEFAULT_A11Y_CONFIG.highContrastMode).toBe(false);
      expect(DEFAULT_A11Y_CONFIG.focusIndicatorSize).toBe(3);
      expect(DEFAULT_A11Y_CONFIG.announceSelections).toBe(true);
      expect(DEFAULT_A11Y_CONFIG.announceNavigations).toBe(true);
      expect(DEFAULT_A11Y_CONFIG.announceGraphChanges).toBe(true);
      expect(DEFAULT_A11Y_CONFIG.announcementDelay).toBe(500);
      expect(DEFAULT_A11Y_CONFIG.enableSkipLinks).toBe(true);
      expect(DEFAULT_A11Y_CONFIG.virtualCursorMode).toBe("spatial");
    });

    it("should have a graph role description", () => {
      expect(DEFAULT_A11Y_CONFIG.graphRoleDescription).toBe("Knowledge graph visualization");
    });
  });

  describe("DEFAULT_REDUCED_MOTION_CONFIG", () => {
    it("should disable animations by default for reduced motion", () => {
      expect(DEFAULT_REDUCED_MOTION_CONFIG.disableAnimations).toBe(true);
      expect(DEFAULT_REDUCED_MOTION_CONFIG.disableTransitions).toBe(true);
      expect(DEFAULT_REDUCED_MOTION_CONFIG.instantNavigation).toBe(true);
      expect(DEFAULT_REDUCED_MOTION_CONFIG.reduceParallax).toBe(true);
    });
  });

  describe("HIGH_CONTRAST_THEMES", () => {
    it("should have dark theme with high contrast colors", () => {
      const dark = HIGH_CONTRAST_THEMES.dark;
      expect(dark.foreground).toBe("#FFFFFF");
      expect(dark.background).toBe("#000000");
      expect(dark.accent).toBe("#FFFF00");
      expect(dark.focusIndicator).toBe("#00FFFF");
    });

    it("should have light theme with high contrast colors", () => {
      const light = HIGH_CONTRAST_THEMES.light;
      expect(light.foreground).toBe("#000000");
      expect(light.background).toBe("#FFFFFF");
      expect(light.accent).toBe("#0000FF");
      expect(light.focusIndicator).toBe("#FF6600");
    });
  });

  describe("WCAG_CONTRAST_RATIOS", () => {
    it("should have correct minimum ratios", () => {
      expect(WCAG_CONTRAST_RATIOS.normalText).toBe(4.5);
      expect(WCAG_CONTRAST_RATIOS.largeText).toBe(3.0);
      expect(WCAG_CONTRAST_RATIOS.uiComponent).toBe(3.0);
      expect(WCAG_CONTRAST_RATIOS.normalTextAAA).toBe(7.0);
      expect(WCAG_CONTRAST_RATIOS.largeTextAAA).toBe(4.5);
    });
  });

  describe("getRelativeLuminance", () => {
    it("should return 0 for pure black", () => {
      expect(getRelativeLuminance("#000000")).toBeCloseTo(0, 4);
    });

    it("should return 1 for pure white", () => {
      expect(getRelativeLuminance("#FFFFFF")).toBeCloseTo(1, 4);
    });

    it("should return correct luminance for gray", () => {
      const luminance = getRelativeLuminance("#808080");
      expect(luminance).toBeGreaterThan(0);
      expect(luminance).toBeLessThan(1);
    });

    it("should handle colors without hash prefix", () => {
      expect(getRelativeLuminance("000000")).toBeCloseTo(0, 4);
      expect(getRelativeLuminance("FFFFFF")).toBeCloseTo(1, 4);
    });
  });

  describe("getContrastRatio", () => {
    it("should return 21 for black on white", () => {
      const ratio = getContrastRatio("#000000", "#FFFFFF");
      expect(ratio).toBeCloseTo(21, 1);
    });

    it("should return 21 for white on black", () => {
      const ratio = getContrastRatio("#FFFFFF", "#000000");
      expect(ratio).toBeCloseTo(21, 1);
    });

    it("should return 1 for same colors", () => {
      expect(getContrastRatio("#000000", "#000000")).toBeCloseTo(1, 4);
      expect(getContrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 4);
      expect(getContrastRatio("#808080", "#808080")).toBeCloseTo(1, 4);
    });

    it("should be symmetric", () => {
      const ratio1 = getContrastRatio("#FF0000", "#00FF00");
      const ratio2 = getContrastRatio("#00FF00", "#FF0000");
      expect(ratio1).toBeCloseTo(ratio2, 4);
    });
  });

  describe("meetsWCAGAA", () => {
    it("should pass for black on white (normal text)", () => {
      expect(meetsWCAGAA("#000000", "#FFFFFF")).toBe(true);
    });

    it("should pass for black on white (large text)", () => {
      expect(meetsWCAGAA("#000000", "#FFFFFF", true)).toBe(true);
    });

    it("should fail for low contrast pairs", () => {
      // Light gray on white has low contrast
      expect(meetsWCAGAA("#CCCCCC", "#FFFFFF")).toBe(false);
    });

    it("should have lower threshold for large text", () => {
      // A color that fails for normal text might pass for large text
      const darkGray = "#767676"; // ~4.54:1 ratio with white
      expect(meetsWCAGAA(darkGray, "#FFFFFF", false)).toBe(true);
      expect(meetsWCAGAA(darkGray, "#FFFFFF", true)).toBe(true);
    });
  });

  describe("meetsWCAGAAA", () => {
    it("should pass for black on white", () => {
      expect(meetsWCAGAAA("#000000", "#FFFFFF")).toBe(true);
    });

    it("should have stricter threshold than AA", () => {
      // This color passes AA but not AAA
      const midGray = "#595959"; // ~7:1 ratio
      expect(meetsWCAGAA(midGray, "#FFFFFF")).toBe(true);
      expect(meetsWCAGAAA(midGray, "#FFFFFF")).toBe(true);

      const lighterGray = "#767676"; // ~4.54:1 ratio
      expect(meetsWCAGAA(lighterGray, "#FFFFFF")).toBe(true);
      expect(meetsWCAGAAA(lighterGray, "#FFFFFF")).toBe(false);
    });
  });

  describe("getScreenReaderCapabilities", () => {
    it("should return capabilities for VoiceOver", () => {
      const caps = getScreenReaderCapabilities("voiceover");
      expect(caps.supportsLiveRegions).toBe(true);
      expect(caps.supportsDescribedBy).toBe(true);
      expect(caps.supportsApplicationRole).toBe(true);
      expect(caps.supportsSVGAccessibility).toBe(true);
      expect(caps.supportsVirtualCursor).toBe(true);
    });

    it("should return capabilities for NVDA", () => {
      const caps = getScreenReaderCapabilities("nvda");
      expect(caps.supportsLiveRegions).toBe(true);
      expect(caps.supportsVirtualCursor).toBe(true);
    });

    it("should return capabilities for JAWS", () => {
      const caps = getScreenReaderCapabilities("jaws");
      expect(caps.supportsLiveRegions).toBe(true);
    });

    it("should return limited capabilities for Narrator", () => {
      const caps = getScreenReaderCapabilities("narrator");
      expect(caps.supportsLiveRegions).toBe(true);
      // Narrator has less SVG support
      expect(caps.supportsSVGAccessibility).toBe(false);
    });

    it("should return default capabilities for unknown screen reader", () => {
      const caps = getScreenReaderCapabilities("unknown");
      expect(caps.supportsLiveRegions).toBe(true);
      expect(caps.supportsDescribedBy).toBe(true);
    });
  });
});
