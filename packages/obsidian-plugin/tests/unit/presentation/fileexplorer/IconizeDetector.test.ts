import { IconizeDetector } from "../../../../src/presentation/fileexplorer/IconizeDetector";

describe("IconizeDetector", () => {
  it("returns detected=false when app is null", () => {
    expect(IconizeDetector.detect(null)).toEqual({
      detected: false,
      pluginId: null,
    });
  });

  it("returns detected=false when app.plugins is missing", () => {
    expect(IconizeDetector.detect({})).toEqual({
      detected: false,
      pluginId: null,
    });
  });

  it("returns detected=false when plugins map is empty", () => {
    expect(
      IconizeDetector.detect({ plugins: { plugins: {} } }),
    ).toEqual({ detected: false, pluginId: null });
  });

  it("returns detected=false when plugins map lacks Iconize ids", () => {
    expect(
      IconizeDetector.detect({
        plugins: { plugins: { "some-other-plugin": {} } },
      }),
    ).toEqual({ detected: false, pluginId: null });
  });

  it("returns detected=true with pluginId when obsidian-icon-folder is loaded", () => {
    const result = IconizeDetector.detect({
      plugins: {
        plugins: {
          "obsidian-icon-folder": { settings: {} },
          "another-plugin": {},
        },
      },
    });
    expect(result).toEqual({
      detected: true,
      pluginId: "obsidian-icon-folder",
    });
  });

  it("does not throw on malformed app shape", () => {
    expect(() => IconizeDetector.detect({ plugins: "string" })).not.toThrow();
    expect(() =>
      IconizeDetector.detect({ plugins: { plugins: 42 } }),
    ).not.toThrow();
  });
});
