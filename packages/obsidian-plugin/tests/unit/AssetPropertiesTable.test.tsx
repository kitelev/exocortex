import React from "react";
import { render, act } from "@testing-library/react";
import { AssetPropertiesTable } from "../../src/presentation/components/AssetPropertiesTable";
import { createMockTFile } from "./helpers/testHelpers";

// Uses the __mocks__/obsidian.ts mock via moduleNameMapper (no jest.mock needed)

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
