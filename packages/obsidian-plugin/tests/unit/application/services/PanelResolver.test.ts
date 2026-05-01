import { describe, it, expect, jest } from "@jest/globals";

import {
  PanelResolver,
  type PanelLayoutProvider,
} from "../../../../src/application/services/PanelResolver";
import type { CommandPanel } from "../../../../src/domain/layout";

describe("PanelResolver", () => {
  describe("resolve", () => {
    it("returns the layout-declared command panel when present", () => {
      const panel: CommandPanel = {
        includeGroups: ["status"],
        excludeCommands: ["bind-block"],
        layout: "stacked",
        featuredBinding: "bind-feature",
      };
      const provider: PanelLayoutProvider = (classRef) =>
        classRef === "ems__Task" ? { commandPanel: panel } : null;

      const resolver = new PanelResolver({ layoutProvider: provider });

      expect(resolver.resolve("ems__Task")).toEqual(panel);
    });

    it("returns null when the layout exists but has no commandPanel slot", () => {
      const resolver = new PanelResolver({ layoutProvider: () => ({}) });

      expect(resolver.resolve("ems__Task")).toBeNull();
    });

    it("returns null when no layout is declared for the class", () => {
      const resolver = new PanelResolver({ layoutProvider: () => null });

      expect(resolver.resolve("unknown__Class")).toBeNull();
    });

    it("normalises wikilink form and alias when looking up a panel", () => {
      const panel: CommandPanel = { includeGroups: ["creation"] };
      const provider = jest.fn<PanelLayoutProvider>((classRef) =>
        classRef === "ems__Task" ? { commandPanel: panel } : null,
      );
      const resolver = new PanelResolver({ layoutProvider: provider });

      expect(resolver.resolve("[[ems__Task]]")).toEqual(panel);
      expect(resolver.resolve("[[ems__Task|Task]]")).toEqual(panel);
      // Both forms collapse to the same key — the provider is only hit once.
      expect(provider).toHaveBeenCalledTimes(1);
      expect(provider).toHaveBeenCalledWith("ems__Task");
    });

    it("caches resolutions so the layout provider is only queried once per class", () => {
      const provider = jest.fn<PanelLayoutProvider>(() => null);
      const resolver = new PanelResolver({ layoutProvider: provider });

      resolver.resolve("ems__Task");
      resolver.resolve("ems__Task");
      resolver.resolve("ems__Task");

      expect(provider).toHaveBeenCalledTimes(1);
    });

    it("caches the negative result (null) so repeated lookups skip the provider", () => {
      const provider = jest.fn<PanelLayoutProvider>(() => null);
      const resolver = new PanelResolver({ layoutProvider: provider });

      expect(resolver.resolve("ems__Task")).toBeNull();
      expect(resolver.resolve("ems__Task")).toBeNull();

      expect(provider).toHaveBeenCalledTimes(1);
    });
  });

  describe("applyFilter", () => {
    const candidates = [
      { uid: "bind-create", category: "creation" },
      { uid: "bind-status", category: "status" },
      { uid: "bind-block", category: "status" },
      { uid: "bind-misc", category: "maintenance" },
    ];

    it("returns the candidates unchanged when no panel is declared", () => {
      const resolver = new PanelResolver({ layoutProvider: () => null });

      expect(resolver.applyFilter("ems__Task", candidates)).toEqual(candidates);
    });

    it("includes only bindings whose category is whitelisted", () => {
      const panel: CommandPanel = { includeGroups: ["creation", "status"] };
      const resolver = new PanelResolver({
        layoutProvider: () => ({ commandPanel: panel }),
      });

      expect(resolver.applyFilter("ems__Task", candidates).map((c) => c.uid)).toEqual([
        "bind-create",
        "bind-status",
        "bind-block",
      ]);
    });

    it("drops excluded bindings even when their category is included (rule #2)", () => {
      const panel: CommandPanel = {
        includeGroups: ["creation", "status"],
        excludeCommands: ["bind-block"],
      };
      const resolver = new PanelResolver({
        layoutProvider: () => ({ commandPanel: panel }),
      });

      expect(resolver.applyFilter("ems__Task", candidates).map((c) => c.uid)).toEqual([
        "bind-create",
        "bind-status",
      ]);
    });
  });

  describe("isFeatured", () => {
    it("returns true only for the panel's featuredBinding (rule #3)", () => {
      const panel: CommandPanel = { featuredBinding: "bind-feature" };
      const resolver = new PanelResolver({
        layoutProvider: () => ({ commandPanel: panel }),
      });

      expect(resolver.isFeatured("ems__Task", "bind-feature")).toBe(true);
      expect(resolver.isFeatured("ems__Task", "bind-other")).toBe(false);
    });

    it("returns false when the class has no panel", () => {
      const resolver = new PanelResolver({ layoutProvider: () => null });

      expect(resolver.isFeatured("ems__Task", "bind-anything")).toBe(false);
    });
  });

  describe("invalidation (3 axes)", () => {
    it("axis 1 (layout change) re-queries after a class-specific invalidation", () => {
      const provider = jest.fn<PanelLayoutProvider>(() => null);
      const resolver = new PanelResolver({ layoutProvider: provider });

      resolver.resolve("ems__Task");
      resolver.invalidateOnLayoutChange("ems__Task");
      resolver.resolve("ems__Task");

      expect(provider).toHaveBeenCalledTimes(2);
    });

    it("axis 1 (layout change) without a class clears every cached entry", () => {
      const provider = jest.fn<PanelLayoutProvider>(() => null);
      const resolver = new PanelResolver({ layoutProvider: provider });

      resolver.resolve("ems__Task");
      resolver.resolve("ems__Project");
      resolver.invalidateOnLayoutChange();
      resolver.resolve("ems__Task");
      resolver.resolve("ems__Project");

      expect(provider).toHaveBeenCalledTimes(4);
    });

    it("axis 2 (binding change) clears every cached entry — featuredBinding / excludeCommands references are global", () => {
      const provider = jest.fn<PanelLayoutProvider>(() => null);
      const resolver = new PanelResolver({ layoutProvider: provider });

      resolver.resolve("ems__Task");
      resolver.resolve("ems__Project");
      resolver.invalidateOnBindingChange();
      resolver.resolve("ems__Task");
      resolver.resolve("ems__Project");

      expect(provider).toHaveBeenCalledTimes(4);
    });

    it("axis 3 (class change) drops the affected class entry only", () => {
      const provider = jest.fn<PanelLayoutProvider>(() => null);
      const resolver = new PanelResolver({ layoutProvider: provider });

      resolver.resolve("ems__Task");
      resolver.resolve("ems__Project");
      resolver.invalidateOnClassChange("ems__Task");
      resolver.resolve("ems__Task");
      resolver.resolve("ems__Project");

      // Task: 2 calls (initial + post-invalidation). Project: 1 call.
      expect(provider).toHaveBeenCalledTimes(3);
    });

    it("invalidate normalises wikilink form so [[X]] hits the same key as X", () => {
      const provider = jest.fn<PanelLayoutProvider>(() => null);
      const resolver = new PanelResolver({ layoutProvider: provider });

      resolver.resolve("ems__Task");
      resolver.invalidate("[[ems__Task]]");
      resolver.resolve("ems__Task");

      expect(provider).toHaveBeenCalledTimes(2);
    });
  });

  describe("default options", () => {
    it("constructs without a layoutProvider — every resolve returns null", () => {
      const resolver = new PanelResolver();

      expect(resolver.resolve("ems__Task")).toBeNull();
      expect(resolver.applyFilter("ems__Task", [{ uid: "x" }])).toEqual([
        { uid: "x" },
      ]);
      expect(resolver.isFeatured("ems__Task", "x")).toBe(false);
    });
  });
});
