import { describe, it, expect, jest } from "@jest/globals";

import {
  ThemeResolver,
  CLASS_DEFAULT_ACCENT,
  type LayoutProvider,
} from "../../../../src/application/services/ThemeResolver";

describe("ThemeResolver", () => {
  describe("resolveAccent", () => {
    it("returns the layout-declared accent when present", () => {
      const provider: LayoutProvider = (classRef) =>
        classRef === "ems__Task" ? { accentColor: "var(--color-mint)" } : null;

      const resolver = new ThemeResolver({ layoutProvider: provider });

      expect(resolver.resolveAccent("ems__Task")).toBe("var(--color-mint)");
    });

    it("falls back to the plugin-built-in default when no layout override exists", () => {
      const resolver = new ThemeResolver({ layoutProvider: () => null });

      expect(resolver.resolveAccent("ems__Task")).toBe(
        CLASS_DEFAULT_ACCENT.get("ems__Task"),
      );
      expect(resolver.resolveAccent("ems__Project")).toBe(
        CLASS_DEFAULT_ACCENT.get("ems__Project"),
      );
      expect(resolver.resolveAccent("ems__Area")).toBe(
        CLASS_DEFAULT_ACCENT.get("ems__Area"),
      );
      expect(resolver.resolveAccent("ims__Concept")).toBe(
        CLASS_DEFAULT_ACCENT.get("ims__Concept"),
      );
    });

    it("returns null when neither layout nor built-in default applies", () => {
      const resolver = new ThemeResolver({ layoutProvider: () => null });

      expect(resolver.resolveAccent("unknown__Class")).toBeNull();
    });

    it("normalises wikilink form and alias when looking up defaults", () => {
      const resolver = new ThemeResolver();

      expect(resolver.resolveAccent("[[ems__Task]]")).toBe(
        CLASS_DEFAULT_ACCENT.get("ems__Task"),
      );
      expect(resolver.resolveAccent("[[ems__Task|Task]]")).toBe(
        CLASS_DEFAULT_ACCENT.get("ems__Task"),
      );
    });

    it("caches resolutions so the layout provider is only queried once per class", () => {
      const provider = jest.fn<LayoutProvider>(() => null);

      const resolver = new ThemeResolver({ layoutProvider: provider });

      resolver.resolveAccent("ems__Task");
      resolver.resolveAccent("ems__Task");
      resolver.resolveAccent("ems__Task");

      expect(provider).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveIcon & resolveLabelTypography", () => {
    it("returns the layout-declared icon and typography when present", () => {
      const resolver = new ThemeResolver({
        layoutProvider: () => ({
          icon: "check-circle",
          labelTypography: "large",
        }),
      });

      expect(resolver.resolveIcon("ems__Task")).toBe("check-circle");
      expect(resolver.resolveLabelTypography("ems__Task")).toBe("large");
    });

    it("returns null when the layout does not declare them", () => {
      const resolver = new ThemeResolver({
        layoutProvider: () => ({ accentColor: "var(--color-green)" }),
      });

      expect(resolver.resolveIcon("ems__Task")).toBeNull();
      expect(resolver.resolveLabelTypography("ems__Task")).toBeNull();
    });
  });

  describe("invalidate", () => {
    it("re-queries the layout provider after a class-specific invalidation", () => {
      const provider = jest.fn<LayoutProvider>(() => null);
      const resolver = new ThemeResolver({ layoutProvider: provider });

      resolver.resolveAccent("ems__Task");
      resolver.invalidate("ems__Task");
      resolver.resolveAccent("ems__Task");

      expect(provider).toHaveBeenCalledTimes(2);
    });

    it("clears every cached class when called without an argument", () => {
      const provider = jest.fn<LayoutProvider>(() => null);
      const resolver = new ThemeResolver({ layoutProvider: provider });

      resolver.resolveAccent("ems__Task");
      resolver.resolveAccent("ems__Project");
      resolver.invalidate();
      resolver.resolveAccent("ems__Task");
      resolver.resolveAccent("ems__Project");

      expect(provider).toHaveBeenCalledTimes(4);
    });

    it("normalises wikilink form when invalidating", () => {
      const provider = jest.fn<LayoutProvider>(() => null);
      const resolver = new ThemeResolver({ layoutProvider: provider });

      resolver.resolveAccent("ems__Task");
      resolver.invalidate("[[ems__Task]]");
      resolver.resolveAccent("ems__Task");

      expect(provider).toHaveBeenCalledTimes(2);
    });
  });
});
