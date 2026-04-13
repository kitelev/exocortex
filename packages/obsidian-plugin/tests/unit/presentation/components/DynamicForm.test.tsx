import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { DynamicForm, DynamicFormProps } from "../../../../src/presentation/components/dynamic-form/DynamicForm";
import type { InputSchemaField } from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";

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
