import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { DynamicForm, DynamicFormProps } from "../../../../src/presentation/components/dynamic-form/DynamicForm";
import type { InputSchemaField } from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
// Shared tz-simulation helper (canonical copy lives in core tests). Cross-package
// import keeps the FakeOffsetDate technique deduplicated across the $today revert-
// verify suites ([[jest-timezone-sensitive-tests]]).
import { installFakeOffsetDate } from "../../../../../core/tests/helpers/installFakeOffsetDate";

function renderForm(
  schema: InputSchemaField[],
  overrides: Partial<DynamicFormProps> = {},
) {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  const result = render(
    <DynamicForm
      schema={schema}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { ...result, onSubmit, onCancel };
}

describe("DynamicForm", () => {
  describe("text field", () => {
    it("should render a text input", () => {
      renderForm([{ name: "title", type: "text", label: "Title" }]);
      expect(screen.getByText("Title")).toBeInTheDocument();
      expect(screen.getByTestId("field-title")).toBeInTheDocument();
      expect(screen.getByTestId("field-title").tagName).toBe("INPUT");
    });

    it("should use name as label when label is omitted", () => {
      renderForm([{ name: "myField", type: "text" }]);
      expect(screen.getByText("myField")).toBeInTheDocument();
    });

    it("should populate default value", () => {
      renderForm([{ name: "title", type: "text", defaultValue: "hello" }]);
      expect(screen.getByTestId("field-title")).toHaveValue("hello");
    });

    it("should update value on change", () => {
      const { onSubmit } = renderForm([{ name: "title", type: "text" }]);
      const input = screen.getByTestId("field-title");
      fireEvent.change(input, { target: { value: "new value" } });
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).toHaveBeenCalledWith({ title: "new value" });
    });
  });

  describe("date field", () => {
    it("should render a date input", () => {
      renderForm([{ name: "dueDate", type: "date", label: "Due date" }]);
      const input = screen.getByTestId("field-dueDate");
      expect(input.tagName).toBe("INPUT");
      expect(input).toHaveAttribute("type", "date");
    });

    it("should populate default date value", () => {
      renderForm([{ name: "dueDate", type: "date", defaultValue: "2026-04-05" }]);
      expect(screen.getByTestId("field-dueDate")).toHaveValue("2026-04-05");
    });
  });

  // Feature ec15f83e / req 57b03ab3 — the create-task-instance modal pre-fills
  // its planned-date field with today via the `$today` token in defaultValue.
  // The LOCAL date slice (req 26d79c70 / #3809) mirrors the engine's now-local
  // $today basis (GroundingExecutor.resolveInstanceDate + label-template $today)
  // so the modal date, label, and planned timestamps agree — see the dedicated
  // boundary revert-verify describe below for the local-vs-UTC lock.
  describe("$today defaultValue token (req 57b03ab3)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-06-28T10:00:00Z"));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it("@req:57b03ab3-9666-4c5a-8f38-cf650e4f48d2 resolves a date field's '$today' defaultValue to today's date", () => {
      renderForm([{ name: "plannedDate", type: "date", defaultValue: "$today" }]);
      expect(screen.getByTestId("field-plannedDate")).toHaveValue("2026-06-28");
    });

    it("@req:57b03ab3-9666-4c5a-8f38-cf650e4f48d2 submits the resolved today date as the field value", () => {
      const { onSubmit } = renderForm([
        { name: "label", type: "text", defaultValue: "x" },
        { name: "plannedDate", type: "date", defaultValue: "$today" },
      ]);
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).toHaveBeenCalledWith({
        label: "x",
        plannedDate: "2026-06-28",
      });
    });

    it("@req:57b03ab3-9666-4c5a-8f38-cf650e4f48d2 leaves a literal date and non-'$today' text defaultValue untouched", () => {
      renderForm([
        { name: "plannedDate", type: "date", defaultValue: "2026-01-15" },
        { name: "note", type: "text", defaultValue: "$todayish" },
      ]);
      expect(screen.getByTestId("field-plannedDate")).toHaveValue("2026-01-15");
      expect(screen.getByTestId("field-note")).toHaveValue("$todayish");
    });

  });

  // req 26d79c70 / #3809 — the `$today` prefill must resolve to today's LOCAL
  // calendar day, matching the now-local engine `$today` (GroundingExecutor +
  // SubstitutionToken resolvers from #3808). The former `toISOString().slice`
  // (UTC) prefilled yesterday's local day just after local midnight in a UTC+N
  // timezone.
  //
  // CI-robust ([[jest-timezone-sensitive-tests]]): `process.env.TZ` cannot be
  // re-tzset at runtime under jest (V8 caches the worker timezone), and the fix
  // has NO observable effect in a UTC runner — so a `Date` subclass
  // (installFakeOffsetDate) simulates a fixed UTC+5 (Asia/Almaty, no DST) offset
  // at 2026-07-02T19:27:00Z = 00:27 local (local day 03, UTC day 02),
  // independent of the runner's real timezone. Kept in a separate describe with
  // NO jest fake timers (the subclass IS the clock) to avoid the
  // fake-timers × Date-subclass interaction. Revert-verify: reverting
  // resolveDefaultValue to `toISOString().slice(0,10)` resolves "2026-07-02"
  // (UTC) → RED; the local form → GREEN ("2026-07-03").
  describe("$today prefill = LOCAL calendar day (req 26d79c70 / #3809)", () => {
    it("@req:26d79c70-8e39-454c-b07e-a8d9d0ea2b66 prefills today's LOCAL day just after local midnight (UTC still previous day)", () => {
      const restore = installFakeOffsetDate(5, "2026-07-02T19:27:00Z");
      try {
        // Guard: prove the simulated tz is active (else the assertion below
        // would be vacuous in a UTC-tz runner and silently pass both ways).
        expect(new Date().getHours()).toBe(0); // 00:27 local (Almaty)
        expect(new Date().getUTCDate()).toBe(2); // still July 2 in UTC

        renderForm([
          { name: "plannedDate", type: "date", defaultValue: "$today" },
        ]);
        // Local today = 2026-07-03; the former UTC form prefilled "2026-07-02".
        expect(screen.getByTestId("field-plannedDate")).toHaveValue("2026-07-03");
      } finally {
        restore();
      }
    });
  });

  // T3 «Create Instance» — number/boolean field types for required-property
  // datatype ranges (xsd:integer/decimal/… → number, xsd:boolean → boolean).
  describe("number field (T3)", () => {
    it("should render a number input", () => {
      renderForm([{ name: "count", type: "number", label: "Count" }]);
      const input = screen.getByTestId("field-count");
      expect(input.tagName).toBe("INPUT");
      expect(input).toHaveAttribute("type", "number");
    });

    it("should forward typed numeric value", () => {
      const { onSubmit } = renderForm([{ name: "count", type: "number" }]);
      fireEvent.change(screen.getByTestId("field-count"), {
        target: { value: "42" },
      });
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).toHaveBeenCalledWith({ count: "42" });
    });
  });

  describe("boolean field (T3)", () => {
    it("should render a checkbox", () => {
      renderForm([{ name: "flag", type: "boolean", label: "Flag" }]);
      const input = screen.getByTestId("field-flag");
      expect(input.tagName).toBe("INPUT");
      expect(input).toHaveAttribute("type", "checkbox");
    });

    it("commits 'true'/'false' string on toggle", () => {
      const { onSubmit } = renderForm([
        { name: "flag", type: "boolean", defaultValue: "false" },
      ]);
      const cb = screen.getByTestId("field-flag");
      expect(cb).not.toBeChecked();
      fireEvent.click(cb);
      expect(cb).toBeChecked();
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).toHaveBeenCalledWith({ flag: "true" });
    });

    it("a required boolean defaulting to 'false' submits without blocking", () => {
      const { onSubmit } = renderForm([
        { name: "flag", type: "boolean", required: true, defaultValue: "false" },
      ]);
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).toHaveBeenCalledWith({ flag: "false" });
    });
  });

  describe("enum field", () => {
    it("should render a select dropdown with string options", () => {
      renderForm([{
        name: "priority",
        type: "enum",
        label: "Priority",
        options: ["low", "medium", "high"],
      }]);
      const select = screen.getByTestId("field-priority");
      expect(select.tagName).toBe("SELECT");
      expect(screen.getByText("low")).toBeInTheDocument();
      expect(screen.getByText("medium")).toBeInTheDocument();
      expect(screen.getByText("high")).toBeInTheDocument();
    });

    it("should render value/label option pairs", () => {
      renderForm([{
        name: "status",
        type: "enum",
        options: [
          { value: "active", label: "Active status" },
          { value: "archived", label: "Archived status" },
        ],
      }]);
      expect(screen.getByText("Active status")).toBeInTheDocument();
      expect(screen.getByText("Archived status")).toBeInTheDocument();
    });

    it("should render mixed string and object options", () => {
      renderForm([{
        name: "status",
        type: "enum",
        options: [
          "simple",
          { value: "complex", label: "Complex option" },
        ],
      }]);
      expect(screen.getByText("simple")).toBeInTheDocument();
      expect(screen.getByText("Complex option")).toBeInTheDocument();
    });

    it("should include placeholder option when not required", () => {
      renderForm([{
        name: "priority",
        type: "enum",
        options: ["low", "high"],
      }]);
      expect(screen.getByText("-- select --")).toBeInTheDocument();
    });

    it("should not include placeholder when required", () => {
      renderForm([{
        name: "priority",
        type: "enum",
        required: true,
        options: ["low", "high"],
      }]);
      expect(screen.queryByText("-- select --")).not.toBeInTheDocument();
    });

    it("should apply default value to select", () => {
      renderForm([{
        name: "priority",
        type: "enum",
        options: ["low", "medium", "high"],
        defaultValue: "medium",
      }]);
      expect(screen.getByTestId("field-priority")).toHaveValue("medium");
    });
  });

  describe("multiline field", () => {
    it("should render a textarea", () => {
      renderForm([{ name: "description", type: "multiline", label: "Description" }]);
      const textarea = screen.getByTestId("field-description");
      expect(textarea.tagName).toBe("TEXTAREA");
    });

    it("should use default 4 rows", () => {
      renderForm([{ name: "notes", type: "multiline" }]);
      expect(screen.getByTestId("field-notes")).toHaveAttribute("rows", "4");
    });

    it("should use custom rows count", () => {
      renderForm([{ name: "notes", type: "multiline", rows: 8 }]);
      expect(screen.getByTestId("field-notes")).toHaveAttribute("rows", "8");
    });

    it("should populate default value", () => {
      renderForm([{ name: "notes", type: "multiline", defaultValue: "initial text" }]);
      expect(screen.getByTestId("field-notes")).toHaveValue("initial text");
    });
  });

  describe("assetRef field", () => {
    it("should render a text input with placeholder", () => {
      renderForm([{ name: "parent", type: "assetRef", label: "Parent asset" }]);
      const input = screen.getByTestId("field-parent");
      expect(input.tagName).toBe("INPUT");
      expect(input).toHaveAttribute("placeholder", "asset reference...");
    });

    it("should populate default value", () => {
      renderForm([{
        name: "parent",
        type: "assetRef",
        defaultValue: "uuid-1234",
      }]);
      expect(screen.getByTestId("field-parent")).toHaveValue("uuid-1234");
    });
  });

  // T1 "Create Instance" (project bbe40f8c) — reusable fuzzy reference-picker.
  describe("assetRef fuzzy reference-picker (targetClassUid)", () => {
    const ONTOLOGY_FIELD: InputSchemaField = {
      name: "exo__Asset_isDefinedBy",
      type: "assetRef",
      label: "Ontology",
      required: true,
      targetClassUid: "829b9b3b-6fc3-4276-be6a-27d3398c012e",
    };
    const CANDIDATES = {
      exo__Asset_isDefinedBy: [
        { uid: "uid-ems", label: "ems (Effort Management)" },
        { uid: "uid-exo", label: "exo (Core)" },
        { uid: "uid-ims", label: "ims (Identity)" },
      ],
    };

    it("renders an ARIA combobox (not a plain text input) when candidates exist", () => {
      renderForm([ONTOLOGY_FIELD], { candidates: CANDIDATES });
      const input = screen.getByTestId("field-exo__Asset_isDefinedBy");
      expect(input).toHaveAttribute("role", "combobox");
      expect(input).toHaveAttribute("aria-expanded", "false");
      expect(input).toHaveAttribute("placeholder", "Type to search…");
    });

    it("filters candidates by typed query (fuzzy/substring on label)", () => {
      renderForm([ONTOLOGY_FIELD], { candidates: CANDIDATES });
      const input = screen.getByTestId("field-exo__Asset_isDefinedBy");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "ems" } });
      expect(screen.getByText("ems (Effort Management)")).toBeInTheDocument();
      expect(screen.queryByText("exo (Core)")).not.toBeInTheDocument();
    });

    it("commits a quoted wikilink to the selected candidate on click", () => {
      const { onSubmit } = renderForm([ONTOLOGY_FIELD], {
        candidates: CANDIDATES,
      });
      const input = screen.getByTestId("field-exo__Asset_isDefinedBy");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "exo" } });
      fireEvent.mouseDown(
        screen.getByTestId("option-exo__Asset_isDefinedBy-uid-exo"),
      );
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).toHaveBeenCalledWith({
        exo__Asset_isDefinedBy: '"[[uid-exo]]"',
      });
    });

    it("supports keyboard nav: ArrowDown + Enter selects the active option", () => {
      const { onSubmit } = renderForm([ONTOLOGY_FIELD], {
        candidates: CANDIDATES,
      });
      const input = screen.getByTestId("field-exo__Asset_isDefinedBy");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" }); // active = 0 (ems)
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).toHaveBeenCalledWith({
        exo__Asset_isDefinedBy: '"[[uid-ems]]"',
      });
    });

    it("required picker blocks submit until a candidate is selected", () => {
      const { onSubmit } = renderForm([ONTOLOGY_FIELD], {
        candidates: CANDIDATES,
      });
      // No selection yet → submit blocked with error.
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText("Ontology is required")).toBeInTheDocument();
    });

    it("typing free text without selecting does NOT commit a value", () => {
      const { onSubmit } = renderForm([ONTOLOGY_FIELD], {
        candidates: CANDIDATES,
      });
      const input = screen.getByTestId("field-exo__Asset_isDefinedBy");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "garbage typed text" } });
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("degrades to a plain text input when a targetClassUid field has no candidates", () => {
      renderForm([ONTOLOGY_FIELD], {
        candidates: { exo__Asset_isDefinedBy: [] },
      });
      // Still a picker shell (targetClassUid present) — combobox role, empty list.
      const input = screen.getByTestId("field-exo__Asset_isDefinedBy");
      expect(input).toHaveAttribute("role", "combobox");
    });
  });

  describe("validation", () => {
    it("should show error for empty required text field", () => {
      renderForm([{ name: "title", type: "text", label: "Title", required: true }]);
      fireEvent.click(screen.getByText("OK"));
      expect(screen.getByText("Title is required")).toBeInTheDocument();
    });

    it("should show error for empty required enum field", () => {
      renderForm([{
        name: "priority",
        type: "enum",
        label: "Priority",
        required: true,
        options: ["low", "high"],
      }]);
      fireEvent.click(screen.getByText("OK"));
      expect(screen.getByText("Priority is required")).toBeInTheDocument();
    });

    it("should not submit when validation fails", () => {
      const { onSubmit } = renderForm([
        { name: "title", type: "text", required: true },
      ]);
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should clear error when field is filled", () => {
      renderForm([{ name: "title", type: "text", label: "Title", required: true }]);
      fireEvent.click(screen.getByText("OK"));
      expect(screen.getByText("Title is required")).toBeInTheDocument();

      fireEvent.change(screen.getByTestId("field-title"), {
        target: { value: "filled" },
      });
      expect(screen.queryByText("Title is required")).not.toBeInTheDocument();
    });

    it("should use field name in error when label is absent", () => {
      renderForm([{ name: "myField", type: "text", required: true }]);
      fireEvent.click(screen.getByText("OK"));
      expect(screen.getByText("myField is required")).toBeInTheDocument();
    });

    it("should show required indicator", () => {
      renderForm([{ name: "title", type: "text", required: true }]);
      expect(screen.getByText("*")).toBeInTheDocument();
    });

    it("should not show required indicator for optional fields", () => {
      renderForm([{ name: "title", type: "text" }]);
      expect(screen.queryByText("*")).not.toBeInTheDocument();
    });
  });

  describe("form submission", () => {
    it("should submit all field values", () => {
      const { onSubmit } = renderForm([
        { name: "title", type: "text", defaultValue: "My title" },
        { name: "dueDate", type: "date", defaultValue: "2026-04-05" },
        { name: "notes", type: "multiline", defaultValue: "Some notes" },
      ]);
      fireEvent.click(screen.getByText("OK"));
      expect(onSubmit).toHaveBeenCalledWith({
        title: "My title",
        dueDate: "2026-04-05",
        notes: "Some notes",
      });
    });

    it("should call onCancel when cancel clicked", () => {
      const { onCancel } = renderForm([{ name: "title", type: "text" }]);
      fireEvent.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalled();
    });

    it("should submit form when Enter pressed in text field", () => {
      const { onSubmit } = renderForm([{ name: "title", type: "text" }]);
      const input = screen.getByTestId("field-title");
      fireEvent.change(input, { target: { value: "via enter" } });
      fireEvent.submit(input.closest("form")!);
      expect(onSubmit).toHaveBeenCalledWith({ title: "via enter" });
    });

    it("should validate required fields on Enter submit", () => {
      const { onSubmit } = renderForm([
        { name: "title", type: "text", label: "Title", required: true },
      ]);
      const input = screen.getByTestId("field-title");
      fireEvent.submit(input.closest("form")!);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText("Title is required")).toBeInTheDocument();
    });

    it("should not call onCancel from the Cancel button submitting the form", () => {
      const { onSubmit, onCancel } = renderForm([{ name: "title", type: "text" }]);
      fireEvent.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("multiple fields", () => {
    it("should render all field types together", () => {
      renderForm([
        { name: "title", type: "text", label: "Title" },
        { name: "dueDate", type: "date", label: "Due date" },
        { name: "priority", type: "enum", label: "Priority", options: ["low", "high"] },
        { name: "notes", type: "multiline", label: "Notes" },
        { name: "parent", type: "assetRef", label: "Parent" },
      ]);

      expect(screen.getByTestId("field-title")).toBeInTheDocument();
      expect(screen.getByTestId("field-dueDate")).toBeInTheDocument();
      expect(screen.getByTestId("field-priority")).toBeInTheDocument();
      expect(screen.getByTestId("field-notes")).toBeInTheDocument();
      expect(screen.getByTestId("field-parent")).toBeInTheDocument();
    });

    it("should validate all required fields at once", () => {
      renderForm([
        { name: "title", type: "text", label: "Title", required: true },
        { name: "priority", type: "enum", label: "Priority", required: true, options: ["low"] },
      ]);
      fireEvent.click(screen.getByText("OK"));
      expect(screen.getByText("Title is required")).toBeInTheDocument();
      expect(screen.getByText("Priority is required")).toBeInTheDocument();
    });
  });
});
