import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ReferencePicker,
  toReferenceWikilink,
} from "../../../../src/presentation/components/dynamic-form/ReferencePicker";
import type { AssetRefCandidate } from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";

/**
 * T2 «Create Instance» (project bbe40f8c) — focused unit tests for the generic,
 * reusable {@link ReferencePicker}. Verifies the contract any future command
 * relies on: fuzzy filtering, commit-as-wikilink, keyboard navigation, value
 * round-trip, and the free-text passthrough degrade.
 */

const CANDIDATES: AssetRefCandidate[] = [
  { uid: "11111111-1111-1111-1111-111111111111", label: "Alpha ontology" },
  { uid: "22222222-2222-2222-2222-222222222222", label: "Beta ontology" },
  { uid: "33333333-3333-3333-3333-333333333333", label: "Gamma ontology" },
];

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof ReferencePicker>> = {},
) {
  const onChange = jest.fn();
  const utils = render(
    <ReferencePicker
      name="ontology"
      value=""
      candidates={CANDIDATES}
      picker
      onChange={onChange}
      {...overrides}
    />,
  );
  return { ...utils, onChange };
}

describe("ReferencePicker", () => {
  describe("toReferenceWikilink", () => {
    it("wraps a bare uid as a quoted frontmatter wikilink", () => {
      expect(toReferenceWikilink("abc")).toBe('"[[abc]]"');
    });
  });

  describe("picker mode", () => {
    it("renders an ARIA combobox", () => {
      renderPicker();
      const input = screen.getByTestId("field-ontology");
      expect(input).toHaveAttribute("role", "combobox");
      expect(input).toHaveAttribute("aria-autocomplete", "list");
    });

    it("opens the listbox on focus and shows all candidates", () => {
      renderPicker();
      fireEvent.focus(screen.getByTestId("field-ontology"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(3);
    });

    it("fuzzy-filters candidates by label substring (case-insensitive)", () => {
      renderPicker();
      const input = screen.getByTestId("field-ontology");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "beta" } });
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent("Beta ontology");
    });

    it("commits the selected candidate as a quoted wikilink on click", () => {
      const { onChange } = renderPicker();
      const input = screen.getByTestId("field-ontology");
      fireEvent.focus(input);
      fireEvent.mouseDown(
        screen.getByTestId(
          "option-ontology-22222222-2222-2222-2222-222222222222",
        ),
      );
      expect(onChange).toHaveBeenLastCalledWith(
        '"[[22222222-2222-2222-2222-222222222222]]"',
      );
    });

    it("clears the committed value while the user types free text", () => {
      const { onChange } = renderPicker({
        value: '"[[11111111-1111-1111-1111-111111111111]]"',
      });
      const input = screen.getByTestId("field-ontology");
      fireEvent.change(input, { target: { value: "Be" } });
      // Free text never leaks into frontmatter — value is cleared until commit.
      expect(onChange).toHaveBeenCalledWith("");
    });

    it("round-trips the value: a committed wikilink shows the candidate label", () => {
      renderPicker({ value: '"[[33333333-3333-3333-3333-333333333333]]"' });
      expect(screen.getByTestId("field-ontology")).toHaveValue(
        "Gamma ontology",
      );
    });

    describe("keyboard navigation", () => {
      it("ArrowDown then Enter selects the first option", () => {
        const { onChange } = renderPicker();
        const input = screen.getByTestId("field-ontology");
        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: "ArrowDown" });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onChange).toHaveBeenLastCalledWith(
          '"[[11111111-1111-1111-1111-111111111111]]"',
        );
      });

      it("ArrowDown twice highlights the second option (aria-selected)", () => {
        renderPicker();
        const input = screen.getByTestId("field-ontology");
        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: "ArrowDown" });
        fireEvent.keyDown(input, { key: "ArrowDown" });
        const options = screen.getAllByRole("option");
        expect(options[1]).toHaveAttribute("aria-selected", "true");
      });

      it("Escape closes the listbox", () => {
        renderPicker();
        const input = screen.getByTestId("field-ontology");
        fireEvent.focus(input);
        expect(screen.queryByRole("listbox")).toBeInTheDocument();
        fireEvent.keyDown(input, { key: "Escape" });
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      });
    });
  });

  describe("free-text passthrough (picker=false)", () => {
    it("renders a plain text input and forwards raw input", () => {
      const onChange = jest.fn();
      render(
        <ReferencePicker
          name="freeform"
          value=""
          candidates={[]}
          picker={false}
          onChange={onChange}
        />,
      );
      const input = screen.getByTestId("field-freeform");
      expect(input).not.toHaveAttribute("role", "combobox");
      fireEvent.change(input, { target: { value: "[[manual-ref]]" } });
      expect(onChange).toHaveBeenCalledWith("[[manual-ref]]");
    });
  });
});
