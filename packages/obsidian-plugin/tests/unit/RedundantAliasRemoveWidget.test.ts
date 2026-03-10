import { RedundantAliasRemoveWidget } from "../../src/presentation/editor-extensions/RedundantAliasRemoveWidget";

// Uses global obsidian mock from tests/__mocks__/obsidian.ts

describe("RedundantAliasRemoveWidget", () => {
  const createMockOnClick = (result: { success: boolean; error?: string }) => {
    return jest.fn().mockResolvedValue(result);
  };

  describe("constructor", () => {
    it("should create widget with provided properties", () => {
      const onClick = createMockOnClick({ success: true });
      const widget = new RedundantAliasRemoveWidget(0, 30, "path/to/file.md", "My Label", onClick);

      expect(widget).toBeInstanceOf(RedundantAliasRemoveWidget);
    });
  });

  describe("toDOM", () => {
    it("should create span element with correct class", () => {
      const onClick = createMockOnClick({ success: true });
      const widget = new RedundantAliasRemoveWidget(0, 30, "path/to/file.md", "My Label", onClick);

      const element = widget.toDOM();

      expect(element.tagName).toBe("SPAN");
      expect(element.className).toBe("exocortex-alias-remove-icon");
    });

    it("should set aria-label for accessibility", () => {
      const onClick = createMockOnClick({ success: true });
      const widget = new RedundantAliasRemoveWidget(0, 30, "path/to/file.md", "My Label", onClick);

      const element = widget.toDOM();

      expect(element.getAttribute("aria-label")).toBe('Remove redundant alias "My Label"');
    });

    it("should set data attributes", () => {
      const onClick = createMockOnClick({ success: true });
      const widget = new RedundantAliasRemoveWidget(0, 30, "path/to/file.md", "My Label", onClick);

      const element = widget.toDOM();

      expect(element.getAttribute("data-target-path")).toBe("path/to/file.md");
      expect(element.getAttribute("data-alias")).toBe("My Label");
    });

    it("should call setIcon with bookmark-minus", () => {
      const onClick = createMockOnClick({ success: true });
      const widget = new RedundantAliasRemoveWidget(0, 30, "path/to/file.md", "My Label", onClick);

      const element = widget.toDOM();

      expect(element.getAttribute("data-icon-set")).toBe("true");
    });

    it("should call onClick callback when clicked", async () => {
      const onClick = createMockOnClick({ success: true });
      const widget = new RedundantAliasRemoveWidget(10, 40, "path/to/file.md", "My Label", onClick);

      const element = widget.toDOM();
      element.click();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onClick).toHaveBeenCalledWith(10, 40, "path/to/file.md", "My Label");
    });

    it("should add is-hidden class on click (optimistic UI)", async () => {
      const onClick = createMockOnClick({ success: true });
      const widget = new RedundantAliasRemoveWidget(0, 30, "path/to/file.md", "My Label", onClick);

      const element = widget.toDOM();
      element.click();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(element.classList.contains("is-hidden")).toBe(true);
    });

    it("should remove is-hidden class on failure", async () => {
      const onClick = createMockOnClick({ success: false, error: "Failed" });
      const widget = new RedundantAliasRemoveWidget(0, 30, "path/to/file.md", "My Label", onClick);

      const element = widget.toDOM();
      element.click();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(element.classList.contains("is-hidden")).toBe(false);
    });

    it("should add/remove hover class on mouseenter/mouseleave", () => {
      const onClick = createMockOnClick({ success: true });
      const widget = new RedundantAliasRemoveWidget(0, 30, "path/to/file.md", "My Label", onClick);

      const element = widget.toDOM();

      element.dispatchEvent(new MouseEvent("mouseenter"));
      expect(element.classList.contains("is-hovered")).toBe(true);

      element.dispatchEvent(new MouseEvent("mouseleave"));
      expect(element.classList.contains("is-hovered")).toBe(false);
    });
  });

  describe("eq", () => {
    it("should return true for identical widgets", () => {
      const onClick = createMockOnClick({ success: true });
      const widget1 = new RedundantAliasRemoveWidget(0, 30, "path.md", "Label", onClick);
      const widget2 = new RedundantAliasRemoveWidget(0, 30, "path.md", "Label", onClick);

      expect(widget1.eq(widget2)).toBe(true);
    });

    it("should return false for different positions", () => {
      const onClick = createMockOnClick({ success: true });
      const widget1 = new RedundantAliasRemoveWidget(0, 30, "path.md", "Label", onClick);
      const widget2 = new RedundantAliasRemoveWidget(5, 35, "path.md", "Label", onClick);

      expect(widget1.eq(widget2)).toBe(false);
    });

    it("should return false for different target paths", () => {
      const onClick = createMockOnClick({ success: true });
      const widget1 = new RedundantAliasRemoveWidget(0, 30, "path1.md", "Label", onClick);
      const widget2 = new RedundantAliasRemoveWidget(0, 30, "path2.md", "Label", onClick);

      expect(widget1.eq(widget2)).toBe(false);
    });
  });

  describe("ignoreEvent", () => {
    it("should return false to allow event handling", () => {
      const onClick = createMockOnClick({ success: true });
      const widget = new RedundantAliasRemoveWidget(0, 30, "path.md", "Label", onClick);

      expect(widget.ignoreEvent()).toBe(false);
    });
  });
});
