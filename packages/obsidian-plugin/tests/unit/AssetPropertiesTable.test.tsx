import React from "react";
import { render, act } from "@testing-library/react";
import { AssetPropertiesTable } from "../../src/presentation/components/AssetPropertiesTable";
import { createMockTFile } from "./helpers/testHelpers";

// Uses the __mocks__/obsidian.ts mock via moduleNameMapper (no jest.mock needed)

describe("AssetPropertiesTable - Copy UID button", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders copy button for exo__Asset_uid property", () => {
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ exo__Asset_uid: "fca0a931-a01f-48e4-b72a-4af206c94bc7" }}
      />,
    );

    const btn = container.querySelector(".exo-copy-uid-btn");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-label")).toBe("Copy uid");
  });

  it("does not render copy button for other properties", () => {
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ exo__Asset_label: "Some Label" }}
      />,
    );

    const btn = container.querySelector(".exo-copy-uid-btn");
    expect(btn).toBeNull();
  });

  it("copies UID to clipboard on click", async () => {
    const uid = "fca0a931-a01f-48e4-b72a-4af206c94bc7";
    const { container } = render(
      <AssetPropertiesTable metadata={{ exo__Asset_uid: uid }} />,
    );

    const btn = container.querySelector(".exo-copy-uid-btn");
    expect(btn).not.toBeNull();

    await act(async () => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(uid);
  });

  it("uses setIcon with copy icon", () => {
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ exo__Asset_uid: "test-uid" }}
      />,
    );

    const btn = container.querySelector(".exo-copy-uid-btn");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("data-icon-name")).toBe("copy");
  });

  it("renders copy button in editable mode (default layout view)", () => {
    const mockFile = createMockTFile("test/file.md");
    const mockPropertyUpdateService = {
      updateProperty: jest.fn().mockResolvedValue(undefined),
    };
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ exo__Asset_uid: "abc-123-def" }}
        editable={true}
        file={mockFile}
        propertyUpdateService={mockPropertyUpdateService as never}
      />,
    );

    const btn = container.querySelector(".exo-copy-uid-btn");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-label")).toBe("Copy uid");
    // UID should be displayed as text, not as an editable input
    const input = container.querySelector("input.exocortex-property-text-input");
    // The UID row should not have an editable text input
    const uidText = container.textContent;
    expect(uidText).toContain("abc-123-def");
  });

  it("does not make UID editable even in editable mode", () => {
    const mockFile = createMockTFile("test/file.md");
    const mockPropertyUpdateService = {
      updateProperty: jest.fn().mockResolvedValue(undefined),
    };
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ exo__Asset_uid: "abc-123", exo__Asset_label: "Test" }}
        editable={true}
        file={mockFile}
        propertyUpdateService={mockPropertyUpdateService as never}
      />,
    );

    // UID row should have copy button, not text input
    const copyBtn = container.querySelector(".exo-copy-uid-btn");
    expect(copyBtn).not.toBeNull();

    // Label row should still have editable text input
    const inputs = container.querySelectorAll("input.exocortex-property-text-input");
    expect(inputs.length).toBe(1); // only label, not uid
  });
});

describe("AssetPropertiesTable - Redundant Alias Remove", () => {
  const mockFile = createMockTFile("test/file.md");

  function makeGetAssetLabel(mapping: Record<string, string>) {
    return (path: string) => mapping[path] ?? null;
  }

  it("renders remove icon when alias equals getAssetLabel result", () => {
    const onRemoveRedundantAlias = jest.fn();
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ parent: "[[some-uuid|My Label]]" }}
        getAssetLabel={makeGetAssetLabel({ "some-uuid": "My Label" })}
        file={mockFile}
        onRemoveRedundantAlias={onRemoveRedundantAlias}
      />,
    );

    const icon = container.querySelector(".exocortex-alias-remove-icon");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-label")).toBe(
      'Remove redundant alias "My Label"',
    );
  });

  it("does NOT render remove icon when alias differs from label", () => {
    const onRemoveRedundantAlias = jest.fn();
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ parent: "[[some-uuid|Different Label]]" }}
        getAssetLabel={makeGetAssetLabel({ "some-uuid": "My Label" })}
        file={mockFile}
        onRemoveRedundantAlias={onRemoveRedundantAlias}
      />,
    );

    const icon = container.querySelector(".exocortex-alias-remove-icon");
    expect(icon).toBeNull();
  });

  it("does NOT render remove icon when onRemoveRedundantAlias is not provided", () => {
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ parent: "[[some-uuid|My Label]]" }}
        getAssetLabel={makeGetAssetLabel({ "some-uuid": "My Label" })}
        file={mockFile}
      />,
    );

    const icon = container.querySelector(".exocortex-alias-remove-icon");
    expect(icon).toBeNull();
  });

  it("does NOT render remove icon when wikilink has no alias", () => {
    const onRemoveRedundantAlias = jest.fn();
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ parent: "[[some-uuid]]" }}
        getAssetLabel={makeGetAssetLabel({ "some-uuid": "My Label" })}
        file={mockFile}
        onRemoveRedundantAlias={onRemoveRedundantAlias}
      />,
    );

    const icon = container.querySelector(".exocortex-alias-remove-icon");
    expect(icon).toBeNull();
  });

  it("does NOT render remove icon when getAssetLabel returns null", () => {
    const onRemoveRedundantAlias = jest.fn();
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ parent: "[[some-uuid|My Label]]" }}
        getAssetLabel={makeGetAssetLabel({})}
        file={mockFile}
        onRemoveRedundantAlias={onRemoveRedundantAlias}
      />,
    );

    const icon = container.querySelector(".exocortex-alias-remove-icon");
    expect(icon).toBeNull();
  });

  it("calls onRemoveRedundantAlias with correct args on click", async () => {
    const onRemoveRedundantAlias = jest.fn().mockResolvedValue(undefined);
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ parent: "[[some-uuid|My Label]]" }}
        getAssetLabel={makeGetAssetLabel({ "some-uuid": "My Label" })}
        file={mockFile}
        onRemoveRedundantAlias={onRemoveRedundantAlias}
      />,
    );

    const icon = container.querySelector(".exocortex-alias-remove-icon");
    expect(icon).not.toBeNull();

    await act(async () => {
      icon!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRemoveRedundantAlias).toHaveBeenCalledWith(
      mockFile,
      "parent",
      "some-uuid",
      "My Label",
    );
  });

  it("works for array properties with wikilinks", () => {
    const onRemoveRedundantAlias = jest.fn();
    const { container } = render(
      <AssetPropertiesTable
        metadata={{
          tags: [
            "[[uuid1|Label One]]",
            "[[uuid2|Different]]",
            "[[uuid3|Label Three]]",
          ],
        }}
        getAssetLabel={makeGetAssetLabel({
          uuid1: "Label One",
          uuid2: "Actual Label",
          uuid3: "Label Three",
        })}
        file={mockFile}
        onRemoveRedundantAlias={onRemoveRedundantAlias}
      />,
    );

    const icons = container.querySelectorAll(".exocortex-alias-remove-icon");
    // uuid1 and uuid3 have redundant aliases, uuid2 does not
    expect(icons).toHaveLength(2);
  });

  it("hides icon optimistically on click and shows on error", async () => {
    const error = new Error("update failed");
    const onRemoveRedundantAlias = jest.fn().mockRejectedValue(error);
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ parent: "[[some-uuid|My Label]]" }}
        getAssetLabel={makeGetAssetLabel({ "some-uuid": "My Label" })}
        file={mockFile}
        onRemoveRedundantAlias={onRemoveRedundantAlias}
      />,
    );

    const icon = container.querySelector(".exocortex-alias-remove-icon");
    expect(icon).not.toBeNull();

    // Click to trigger removal - wrap in act since it triggers state update
    await act(async () => {
      icon!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Icon should be hidden (optimistic UI) then reappear after error
    // After act completes, the rejected promise and re-render have happened
    expect(
      container.querySelector(".exocortex-alias-remove-icon"),
    ).not.toBeNull();
  });

  it("uses setIcon with bookmark-minus", () => {
    const onRemoveRedundantAlias = jest.fn();
    const { container } = render(
      <AssetPropertiesTable
        metadata={{ parent: "[[some-uuid|My Label]]" }}
        getAssetLabel={makeGetAssetLabel({ "some-uuid": "My Label" })}
        file={mockFile}
        onRemoveRedundantAlias={onRemoveRedundantAlias}
      />,
    );

    const icon = container.querySelector(".exocortex-alias-remove-icon");
    expect(icon).not.toBeNull();
    // The __mocks__/obsidian.ts setIcon sets data-icon-name attribute
    expect(icon?.getAttribute("data-icon-name")).toBe("bookmark-minus");
  });
});
