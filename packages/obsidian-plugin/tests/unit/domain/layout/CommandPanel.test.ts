import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  applyCommandPanelFilter,
  createCommandPanelFromFrontmatter,
  isFeaturedBinding,
  isValidCommandPanelMode,
  normalizeBindingRef,
  type CommandPanel,
} from "../../../../src/domain/layout";

describe("CommandPanel — RFC-024 Phase 3 domain model", () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("isValidCommandPanelMode", () => {
    it.each(["inline", "stacked", "dropdown"])(
      "accepts canonical mode %s",
      (mode) => {
        expect(isValidCommandPanelMode(mode)).toBe(true);
      },
    );

    it.each([
      ["unknown string", "grid"],
      ["empty string", ""],
      ["number", 1],
      ["null", null],
      ["undefined", undefined],
      ["object", {}],
    ])("rejects %s", (_label, value) => {
      expect(isValidCommandPanelMode(value)).toBe(false);
    });
  });

  describe("normalizeBindingRef", () => {
    it.each([
      ["bare wikilink", "[[abc-123]]", "abc-123"],
      ["wikilink with alias", "[[abc-123|My Binding]]", "abc-123"],
      ["wikilink with heading", "[[abc-123#section]]", "abc-123"],
      ["bare uuid", "abc-123", "abc-123"],
      ["wikilink with path", "[[path/to/file]]", "path/to/file"],
      ["whitespace padded wikilink", "  [[abc-123]]  ", "abc-123"],
    ])("extracts ref from %s", (_label, input, expected) => {
      expect(normalizeBindingRef(input)).toBe(expected);
    });

    it.each([
      ["empty string", ""],
      ["null", null],
      ["number", 42],
      ["whitespace only", "   "],
    ])("returns null for %s", (_label, input) => {
      expect(normalizeBindingRef(input)).toBeNull();
    });
  });

  describe("createCommandPanelFromFrontmatter", () => {
    it("returns null when raw is missing", () => {
      expect(createCommandPanelFromFrontmatter(undefined)).toBeNull();
      expect(createCommandPanelFromFrontmatter(null)).toBeNull();
    });

    it("returns null when raw is not an object", () => {
      expect(createCommandPanelFromFrontmatter("inline")).toBeNull();
      expect(createCommandPanelFromFrontmatter(42)).toBeNull();
      expect(createCommandPanelFromFrontmatter([])).toBeNull();
    });

    it("returns null when no valid field is present", () => {
      const panel = createCommandPanelFromFrontmatter({
        includeGroups: [],
        excludeCommands: null,
        layout: "grid",
        featuredBinding: "",
      });
      expect(panel).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("must be"));
    });

    it("parses all four fields from a fully-populated inline structure", () => {
      const panel = createCommandPanelFromFrontmatter({
        includeGroups: ["creation", "status"],
        excludeCommands: ["[[cmd-uuid-1]]", "[[cmd-uuid-2|exclude me]]"],
        layout: "stacked",
        featuredBinding: "[[bind-uuid-xyz]]",
      });

      expect(panel).toEqual({
        includeGroups: ["creation", "status"],
        excludeCommands: ["cmd-uuid-1", "cmd-uuid-2"],
        layout: "stacked",
        featuredBinding: "bind-uuid-xyz",
      });
    });

    it("coerces single-string includeGroups into an array", () => {
      const panel = createCommandPanelFromFrontmatter({
        includeGroups: "creation",
      });
      expect(panel?.includeGroups).toEqual(["creation"]);
    });

    it("drops non-string entries in includeGroups", () => {
      const panel = createCommandPanelFromFrontmatter({
        includeGroups: ["creation", null, 42, "status", "  "],
      });
      expect(panel?.includeGroups).toEqual(["creation", "status"]);
    });

    it("accepts excludeCommands passed as a single wikilink", () => {
      const panel = createCommandPanelFromFrontmatter({
        excludeCommands: "[[cmd-uuid-1]]",
      });
      expect(panel?.excludeCommands).toEqual(["cmd-uuid-1"]);
    });

    it("accepts featuredBinding passed as a single-element array", () => {
      const panel = createCommandPanelFromFrontmatter({
        featuredBinding: ["[[bind-uuid-xyz]]"],
      });
      expect(panel?.featuredBinding).toBe("bind-uuid-xyz");
    });

    it("warns and drops invalid layout values", () => {
      const panel = createCommandPanelFromFrontmatter({
        includeGroups: ["creation"],
        layout: "grid",
      });
      expect(panel).toEqual({ includeGroups: ["creation"] });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("grid"));
    });

    it("silently drops missing layout without warning", () => {
      const panel = createCommandPanelFromFrontmatter({
        includeGroups: ["creation"],
      });
      expect(panel).toEqual({ includeGroups: ["creation"] });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("parses collapsedGroups array", () => {
      const panel = createCommandPanelFromFrontmatter({
        collapsedGroups: ["maintenance", "planning"],
      });
      expect(panel).toEqual({ collapsedGroups: ["maintenance", "planning"] });
    });

    it("omits collapsedGroups when empty / nullish", () => {
      expect(
        createCommandPanelFromFrontmatter({
          includeGroups: ["creation"],
          collapsedGroups: [],
        }),
      ).toEqual({ includeGroups: ["creation"] });
      expect(
        createCommandPanelFromFrontmatter({
          includeGroups: ["creation"],
          collapsedGroups: null,
        }),
      ).toEqual({ includeGroups: ["creation"] });
      expect(
        createCommandPanelFromFrontmatter({
          includeGroups: ["creation"],
        }),
      ).toEqual({ includeGroups: ["creation"] });
    });

    it("drops non-string entries in collapsedGroups", () => {
      const panel = createCommandPanelFromFrontmatter({
        collapsedGroups: ["maintenance", 42, "", "  ", "planning"],
      });
      expect(panel?.collapsedGroups).toEqual(["maintenance", "planning"]);
    });

    it("coerces single-string collapsedGroups into an array", () => {
      const panel = createCommandPanelFromFrontmatter({
        collapsedGroups: "maintenance",
      });
      expect(panel?.collapsedGroups).toEqual(["maintenance"]);
    });
  });

  describe("applyCommandPanelFilter — precedence rule #2", () => {
    const candidates = [
      { uid: "a", group: "creation" },
      { uid: "b", group: "creation" },
      { uid: "c", group: "status" },
      { uid: "d", group: "misc" },
      { uid: "e" },
    ];

    it("returns a copy of candidates when panel is undefined", () => {
      const result = applyCommandPanelFilter(candidates, undefined);
      expect(result).toEqual(candidates);
      expect(result).not.toBe(candidates);
    });

    it("returns a copy of candidates when panel is an empty object", () => {
      const result = applyCommandPanelFilter(candidates, {});
      expect(result).toEqual(candidates);
    });

    it("filters by includeGroups (OR-merge)", () => {
      const panel: CommandPanel = {
        includeGroups: ["creation", "status"],
      };
      expect(
        applyCommandPanelFilter(candidates, panel).map((c) => c.uid),
      ).toEqual(["a", "b", "c"]);
    });

    it("excludes commands explicitly listed in excludeCommands", () => {
      const panel: CommandPanel = { excludeCommands: ["b", "d"] };
      expect(
        applyCommandPanelFilter(candidates, panel).map((c) => c.uid),
      ).toEqual(["a", "c", "e"]);
    });

    it("excludeCommands trumps includeGroups when they overlap", () => {
      const panel: CommandPanel = {
        includeGroups: ["creation", "status"],
        excludeCommands: ["a", "c"],
      };
      expect(
        applyCommandPanelFilter(candidates, panel).map((c) => c.uid),
      ).toEqual(["b"]);
    });

    it("drops ungrouped commands when includeGroups is active", () => {
      const panel: CommandPanel = { includeGroups: ["creation"] };
      expect(
        applyCommandPanelFilter(candidates, panel).map((c) => c.uid),
      ).toEqual(["a", "b"]);
    });
  });

  describe("isFeaturedBinding — precedence rule #3", () => {
    const panel: CommandPanel = { featuredBinding: "bind-xyz" };

    it("returns true for the featured binding uid", () => {
      expect(isFeaturedBinding(panel, "bind-xyz")).toBe(true);
    });

    it("returns false for any other uid", () => {
      expect(isFeaturedBinding(panel, "bind-abc")).toBe(false);
    });

    it("returns false when panel is undefined", () => {
      expect(isFeaturedBinding(undefined, "bind-xyz")).toBe(false);
    });

    it("returns false when panel has no featuredBinding", () => {
      expect(isFeaturedBinding({}, "bind-xyz")).toBe(false);
    });
  });
});
