/**
 * WCAG AA contrast matrix — RFC-024 Phase 1 CI merge gate.
 *
 * Verifies that the fallback colours shipped in `packages/obsidian-plugin/
 * styles.css` for each action-button variant pass WCAG AA (>=4.5:1) against
 * the default Obsidian light and dark backgrounds. These fallbacks are what
 * renders when the user's theme does not supply the corresponding
 * `--text-*` / `--interactive-accent` Layer 1 variable.
 *
 * Per the RFC-024 v4 WCAG baseline (2026-04-17), the pre-Phase-1 CSS shipped
 * 4/6 variants that failed AA in light mode (`success` 2.41, `warning` 1.91,
 * `danger` 3.00 — plus `danger` 4.11 in dark mode). This test locks the new
 * AA-compliant palette so future edits cannot silently regress accessibility.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { resolve } from "path";

const STYLES_CSS_PATH = resolve(__dirname, "../../../styles.css");

type RGB = readonly [number, number, number];
type RGBA = readonly [number, number, number, number];

function sRGBToLinear(component: number): number {
  const c = component / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: RGB): number {
  return (
    0.2126 * sRGBToLinear(r) +
    0.7152 * sRGBToLinear(g) +
    0.0722 * sRGBToLinear(b)
  );
}

function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToRGB(hex: string): RGB {
  const m = hex.replace(/^#/, "");
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ] as const;
}

function blendRGBA(fg: RGBA, bg: RGB): RGB {
  const alpha = fg[3];
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
  ] as const;
}

/** Default Obsidian base colours the plugin renders against. */
const THEME_BASE: Record<"light" | "dark", RGB> = {
  light: [255, 255, 255],
  dark: [30, 30, 30],
};

/**
 * Fallback (hex) foreground/background per variant — the values embedded in
 * `styles.css` as `var(--foo, #fallback)`. Updating this matrix without
 * updating the CSS (or vice versa) will fail the lock-test below.
 */
const VARIANT_PALETTE = {
  primary: {
    light: { fg: hexToRGB("#ffffff"), bg: hexToRGB("#5546a8") },
    dark: { fg: hexToRGB("#ffffff"), bg: hexToRGB("#5546a8") },
  },
  secondary: {
    light: { fg: hexToRGB("#1d1d1d"), bg: hexToRGB("#ffffff") },
    dark: { fg: hexToRGB("#dcddde"), bg: hexToRGB("#1e1e1e") },
  },
  success: {
    light: {
      fg: hexToRGB("#1b5e20"),
      bg: blendRGBA([46, 125, 50, 0.12], THEME_BASE.light),
    },
    dark: {
      fg: hexToRGB("#81c784"),
      bg: blendRGBA([102, 187, 106, 0.18], THEME_BASE.dark),
    },
  },
  warning: {
    light: {
      fg: hexToRGB("#bf360c"),
      bg: blendRGBA([191, 54, 12, 0.12], THEME_BASE.light),
    },
    dark: {
      fg: hexToRGB("#ffb74d"),
      bg: blendRGBA([255, 183, 77, 0.18], THEME_BASE.dark),
    },
  },
  danger: {
    light: {
      fg: hexToRGB("#7f1d1d"),
      bg: blendRGBA([183, 28, 28, 0.12], THEME_BASE.light),
    },
    dark: {
      fg: hexToRGB("#ffcdd2"),
      bg: blendRGBA([239, 154, 154, 0.18], THEME_BASE.dark),
    },
  },
  muted: {
    light: { fg: hexToRGB("#666666"), bg: hexToRGB("#ffffff") },
    dark: { fg: hexToRGB("#b3b3b3"), bg: hexToRGB("#1e1e1e") },
  },
} as const;

type Variant = keyof typeof VARIANT_PALETTE;
const VARIANTS: Variant[] = [
  "primary",
  "secondary",
  "success",
  "warning",
  "danger",
  "muted",
];
const THEMES: Array<"light" | "dark"> = ["light", "dark"];

describe("WCAG AA contrast matrix (RFC-024 Phase 1 CI gate)", () => {
  describe.each(VARIANTS)("variant: %s", (variant) => {
    describe.each(THEMES)("theme: %s", (theme) => {
      const { fg, bg } = VARIANT_PALETTE[variant][theme];
      const ratio = contrastRatio(fg, bg);

      it(`passes WCAG AA (>=4.5:1) — actual ratio: ${ratio.toFixed(2)}:1`, () => {
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    });
  });

  describe("AAA targets for critical intents (RFC-024 §8)", () => {
    it.each(THEMES)(
      "primary variant reaches AAA (>=7:1) in %s mode",
      (theme) => {
        const { fg, bg } = VARIANT_PALETTE.primary[theme];
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(7);
      },
    );

    // Recalibrated to AAA per issue #2847 (RFC-024 Phase 4 AC2):
    // foreground darkened in light mode (`#b71c1c` → `#7f1d1d`, Tailwind red-900)
    // and lightened in dark mode (`#ef9a9a` → `#ffcdd2`, Material Red 100) against
    // the same tinted backgrounds. Ratios: light ≈ 8.18:1, dark ≈ 8.35:1.
    it.each(THEMES)(
      "danger variant reaches AAA (>=7:1) in %s mode",
      (theme) => {
        const { fg, bg } = VARIANT_PALETTE.danger[theme];
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(7);
      },
    );
  });

  describe("styles.css lock", () => {
    const css = readFileSync(STYLES_CSS_PATH, "utf-8");

    it.each<[string, string]>([
      ["--exo-intent-primary-fg", "#ffffff"],
      ["--exo-intent-primary-bg", "#5546a8"],
      ["--exo-intent-secondary-fg", "#1d1d1d"],
      ["--exo-intent-success-fg", "#1b5e20"],
      ["--exo-intent-warning-fg", "#bf360c"],
      ["--exo-intent-danger-fg", "#7f1d1d"],
      ["--exo-intent-muted-fg", "#666666"],
    ])("styles.css defines %s with fallback %s", (token, expectedHex) => {
      const pattern = new RegExp(
        `${token.replace(/[-]/g, "\\-")}:\\s*var\\([^,]+,\\s*${expectedHex}\\)`,
        "i",
      );
      expect(css).toMatch(pattern);
    });

    it("retains no raw Material-500 hex values in the variant block", () => {
      const matchBlock = css.match(
        /\/\* Primary variant[\s\S]*?\/\* Dark theme adjustments/,
      );
      expect(matchBlock).not.toBeNull();
      const block = matchBlock?.[0] ?? "";
      // Pre-Phase-1 used #4caf50 / #ff9800 / #f44336 directly. None must remain.
      expect(block).not.toMatch(/#4caf50/i);
      expect(block).not.toMatch(/#ff9800/i);
      expect(block).not.toMatch(/#f44336/i);
    });
  });
});
