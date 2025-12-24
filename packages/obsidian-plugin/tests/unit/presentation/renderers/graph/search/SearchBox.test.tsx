/**
 * SearchBox Component Unit Tests
 *
 * Tests for the search input UI component.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import {
  SearchBox,
  SearchButton,
  DEFAULT_SEARCH_OPTIONS,
} from "../../../../../../src/presentation/renderers/graph/search";
import type { SearchState } from "../../../../../../src/presentation/renderers/graph/search";

describe("SearchBox", () => {
  const defaultSearchState: SearchState = {
    query: "",
    isActive: false,
    matches: [],
    currentMatchIndex: -1,
    options: DEFAULT_SEARCH_OPTIONS,
  };

  const mockOnSearch = jest.fn();
  const mockOnNextMatch = jest.fn();
  const mockOnPreviousMatch = jest.fn();
  const mockOnClear = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render search input", () => {
      render(
        <SearchBox
          searchState={defaultSearchState}
          onSearch={mockOnSearch}
        />
      );
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("should render with placeholder", () => {
      render(
        <SearchBox
          searchState={defaultSearchState}
          onSearch={mockOnSearch}
          placeholder="Custom placeholder"
        />
      );
      expect(screen.getByPlaceholderText("Custom placeholder")).toBeInTheDocument();
    });

    it("should not render when not visible", () => {
      render(
        <SearchBox
          searchState={defaultSearchState}
          onSearch={mockOnSearch}
          isVisible={false}
        />
      );
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("should render with custom class", () => {
      const { container } = render(
        <SearchBox
          searchState={defaultSearchState}
          onSearch={mockOnSearch}
          className="custom-class"
        />
      );
      expect(container.firstChild).toHaveClass("custom-class");
    });
  });

  describe("search input", () => {
    it("should call onSearch when typing", async () => {
      const user = userEvent.setup();
      render(
        <SearchBox
          searchState={defaultSearchState}
          onSearch={mockOnSearch}
        />
      );

      await user.type(screen.getByRole("textbox"), "test");
      expect(mockOnSearch).toHaveBeenCalledWith("t");
      expect(mockOnSearch).toHaveBeenCalledWith("te");
      expect(mockOnSearch).toHaveBeenCalledWith("tes");
      expect(mockOnSearch).toHaveBeenCalledWith("test");
    });

    it("should show match counter when active with matches", () => {
      const stateWithMatches: SearchState = {
        ...defaultSearchState,
        query: "test",
        isActive: true,
        matches: [
          { nodeId: "1", matchedText: "test", matchedField: "label", score: 100 },
          { nodeId: "2", matchedText: "test", matchedField: "label", score: 90 },
        ],
        currentMatchIndex: 0,
      };

      render(
        <SearchBox
          searchState={stateWithMatches}
          onSearch={mockOnSearch}
        />
      );

      expect(screen.getByText("1/2")).toBeInTheDocument();
    });

    it("should show 0 when no matches", () => {
      const stateNoMatches: SearchState = {
        ...defaultSearchState,
        query: "xyz",
        isActive: true,
        matches: [],
        currentMatchIndex: -1,
      };

      render(
        <SearchBox
          searchState={stateNoMatches}
          onSearch={mockOnSearch}
        />
      );

      expect(screen.getByText("0")).toBeInTheDocument();
    });
  });

  describe("clear button", () => {
    it("should show clear button when query is not empty", async () => {
      const stateWithQuery: SearchState = {
        ...defaultSearchState,
        query: "test",
      };

      render(
        <SearchBox
          searchState={stateWithQuery}
          onSearch={mockOnSearch}
          onClear={mockOnClear}
        />
      );

      const clearButton = screen.getByLabelText("Clear search");
      expect(clearButton).toBeInTheDocument();
    });

    it("should call onClear when clicked", async () => {
      const user = userEvent.setup();
      const stateWithQuery: SearchState = {
        ...defaultSearchState,
        query: "test",
      };

      render(
        <SearchBox
          searchState={stateWithQuery}
          onSearch={mockOnSearch}
          onClear={mockOnClear}
        />
      );

      await user.click(screen.getByLabelText("Clear search"));
      expect(mockOnClear).toHaveBeenCalled();
    });
  });

  describe("navigation controls", () => {
    const stateWithMatches: SearchState = {
      ...defaultSearchState,
      query: "test",
      isActive: true,
      matches: [
        { nodeId: "1", matchedText: "test", matchedField: "label", score: 100 },
        { nodeId: "2", matchedText: "test", matchedField: "label", score: 90 },
      ],
      currentMatchIndex: 0,
    };

    it("should show navigation buttons when matches exist", () => {
      render(
        <SearchBox
          searchState={stateWithMatches}
          onSearch={mockOnSearch}
          onNextMatch={mockOnNextMatch}
          onPreviousMatch={mockOnPreviousMatch}
        />
      );

      expect(screen.getByLabelText("Previous match")).toBeInTheDocument();
      expect(screen.getByLabelText("Next match")).toBeInTheDocument();
    });

    it("should call onNextMatch when next button clicked", async () => {
      const user = userEvent.setup();
      render(
        <SearchBox
          searchState={stateWithMatches}
          onSearch={mockOnSearch}
          onNextMatch={mockOnNextMatch}
        />
      );

      await user.click(screen.getByLabelText("Next match"));
      expect(mockOnNextMatch).toHaveBeenCalled();
    });

    it("should call onPreviousMatch when previous button clicked", async () => {
      const user = userEvent.setup();
      render(
        <SearchBox
          searchState={stateWithMatches}
          onSearch={mockOnSearch}
          onPreviousMatch={mockOnPreviousMatch}
        />
      );

      await user.click(screen.getByLabelText("Previous match"));
      expect(mockOnPreviousMatch).toHaveBeenCalled();
    });
  });

  describe("keyboard shortcuts", () => {
    const stateWithMatches: SearchState = {
      ...defaultSearchState,
      query: "test",
      isActive: true,
      matches: [
        { nodeId: "1", matchedText: "test", matchedField: "label", score: 100 },
      ],
      currentMatchIndex: 0,
    };

    it("should call onNextMatch on Enter", async () => {
      const user = userEvent.setup();
      render(
        <SearchBox
          searchState={stateWithMatches}
          onSearch={mockOnSearch}
          onNextMatch={mockOnNextMatch}
        />
      );

      const input = screen.getByRole("textbox");
      await user.type(input, "{Enter}");
      expect(mockOnNextMatch).toHaveBeenCalled();
    });

    it("should call onPreviousMatch on Shift+Enter", async () => {
      const user = userEvent.setup();
      render(
        <SearchBox
          searchState={stateWithMatches}
          onSearch={mockOnSearch}
          onPreviousMatch={mockOnPreviousMatch}
        />
      );

      const input = screen.getByRole("textbox");
      await user.type(input, "{Shift>}{Enter}{/Shift}");
      expect(mockOnPreviousMatch).toHaveBeenCalled();
    });

    it("should call onClear on Escape when query exists", async () => {
      const user = userEvent.setup();
      render(
        <SearchBox
          searchState={stateWithMatches}
          onSearch={mockOnSearch}
          onClear={mockOnClear}
        />
      );

      const input = screen.getByRole("textbox");
      await user.type(input, "{Escape}");
      expect(mockOnClear).toHaveBeenCalled();
    });
  });

  describe("options panel", () => {
    const stateWithMatches: SearchState = {
      ...defaultSearchState,
      query: "test",
      isActive: true,
      matches: [
        { nodeId: "1", matchedText: "test", matchedField: "label", score: 100 },
      ],
      currentMatchIndex: 0,
    };

    it("should toggle options panel", async () => {
      const user = userEvent.setup();
      render(
        <SearchBox
          searchState={stateWithMatches}
          onSearch={mockOnSearch}
          onOptionsChange={jest.fn()}
        />
      );

      const optionsButton = screen.getByLabelText("Toggle search options");
      await user.click(optionsButton);

      // Options panel should now be visible
      expect(screen.getByText("Case sensitive")).toBeInTheDocument();
      expect(screen.getByText("Regular expression")).toBeInTheDocument();
    });
  });
});

describe("SearchButton", () => {
  it("should render toggle button", () => {
    render(
      <SearchButton
        isSearchVisible={false}
        onToggle={jest.fn()}
      />
    );

    expect(screen.getByLabelText("Open search")).toBeInTheDocument();
  });

  it("should change label when search is visible", () => {
    render(
      <SearchButton
        isSearchVisible={true}
        onToggle={jest.fn()}
      />
    );

    expect(screen.getByLabelText("Close search")).toBeInTheDocument();
  });

  it("should call onToggle when clicked", async () => {
    const user = userEvent.setup();
    const mockToggle = jest.fn();

    render(
      <SearchButton
        isSearchVisible={false}
        onToggle={mockToggle}
      />
    );

    await user.click(screen.getByRole("button"));
    expect(mockToggle).toHaveBeenCalled();
  });

  it("should show badge with match count", () => {
    render(
      <SearchButton
        isSearchVisible={true}
        onToggle={jest.fn()}
        hasResults={true}
        matchCount={5}
      />
    );

    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("should have active class when visible", () => {
    const { container } = render(
      <SearchButton
        isSearchVisible={true}
        onToggle={jest.fn()}
      />
    );

    expect(container.firstChild).toHaveClass("exo-search-button--active");
  });
});
