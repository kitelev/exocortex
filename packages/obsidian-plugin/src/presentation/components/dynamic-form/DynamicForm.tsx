import React, { useState, useCallback, useMemo } from "react";
import type {
  InputSchemaField,
  EnumOption,
  AssetRefCandidate,
} from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { ReferencePicker } from "@plugin/presentation/components/dynamic-form/ReferencePicker";

export interface DynamicFormProps {
  readonly schema: InputSchemaField[];
  readonly onSubmit: (values: Record<string, string>) => void;
  readonly onCancel: () => void;
  readonly submitLabel?: string;
  /**
   * T1 "Create Instance" (project bbe40f8c) — candidate assets for `assetRef`
   * fuzzy reference-picker fields, keyed by field name. Resolved by the modal
   * layer from the field's `targetClassUid`. Absent → the picker degrades to a
   * plain text input (backward compatible).
   */
  readonly candidates?: Record<string, AssetRefCandidate[]>;
}

interface FieldError {
  readonly name: string;
  readonly message: string;
}

function normalizeEnumOption(opt: string | EnumOption): EnumOption {
  return typeof opt === "string" ? { value: opt, label: opt } : opt;
}

export const DynamicForm: React.FC<DynamicFormProps> = ({
  schema,
  onSubmit,
  onCancel,
  submitLabel,
  candidates,
}) => {
  const initialValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const field of schema) {
      values[field.name] = field.defaultValue ?? "";
    }
    return values;
  }, [schema]);

  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [errors, setErrors] = useState<FieldError[]>([]);

  const handleChange = useCallback((name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => prev.filter((e) => e.name !== name));
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: FieldError[] = [];
    for (const field of schema) {
      if (field.required && !values[field.name]?.trim()) {
        newErrors.push({
          name: field.name,
          message: `${field.label ?? field.name} is required`,
        });
      }
    }
    setErrors(newErrors);
    return newErrors.length === 0;
  }, [schema, values]);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (validate()) {
        onSubmit(values);
      }
    },
    [validate, values, onSubmit],
  );

  const getFieldError = useCallback(
    (name: string): string | undefined =>
      errors.find((e) => e.name === name)?.message,
    [errors],
  );

  return (
    <form className="dynamic-form" onSubmit={handleSubmit}>
      {schema.map((field) => (
        <div key={field.name} className="dynamic-form-field">
          <label className="dynamic-form-label">
            {field.label ?? field.name}
            {field.required && <span className="dynamic-form-required"> *</span>}
          </label>
          {field.type === "assetRef" ? (
            <ReferencePicker
              name={field.name}
              value={values[field.name] ?? ""}
              candidates={candidates?.[field.name] ?? []}
              picker={
                (candidates?.[field.name]?.length ?? 0) > 0 ||
                field.targetClassUid !== undefined
              }
              onChange={(v) => handleChange(field.name, v)}
            />
          ) : (
            renderField(field, values[field.name] ?? "", handleChange)
          )}
          {getFieldError(field.name) && (
            <div className="dynamic-form-error">{getFieldError(field.name)}</div>
          )}
        </div>
      ))}
      <div className="modal-button-container">
        <button type="submit" className="mod-cta">
          {submitLabel ?? "OK"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};

function renderField(
  field: InputSchemaField,
  value: string,
  onChange: (name: string, value: string) => void,
): React.ReactElement {
  switch (field.type) {
    case "date":
      return (
        <input
          type="date"
          className="dynamic-form-input"
          value={value}
          onChange={(e) => onChange(field.name, e.target.value)}
          data-testid={`field-${field.name}`}
        />
      );

    case "number":
      return (
        <input
          type="number"
          className="dynamic-form-input"
          value={value}
          onChange={(e) => onChange(field.name, e.target.value)}
          data-testid={`field-${field.name}`}
        />
      );

    case "boolean":
      // Committed as the string "true"/"false" so it serialises to a YAML
      // boolean in frontmatter. A checkbox is always "filled" (default false),
      // so a required boolean never blocks submit.
      return (
        <input
          type="checkbox"
          className="dynamic-form-checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(field.name, e.target.checked ? "true" : "false")}
          data-testid={`field-${field.name}`}
        />
      );

    case "enum":
      return (
        <select
          className="dynamic-form-input dropdown"
          value={value}
          onChange={(e) => onChange(field.name, e.target.value)}
          data-testid={`field-${field.name}`}
        >
          {!field.required && <option value="">-- select --</option>}
          {(field.options ?? []).map((opt) => {
            const normalized = normalizeEnumOption(opt);
            return (
              <option key={normalized.value} value={normalized.value}>
                {normalized.label}
              </option>
            );
          })}
        </select>
      );

    case "multiline":
      return (
        <textarea
          className="dynamic-form-input"
          rows={field.rows ?? 4}
          value={value}
          onChange={(e) => onChange(field.name, e.target.value)}
          data-testid={`field-${field.name}`}
        />
      );

    case "text":
    default:
      return (
        <input
          type="text"
          className="dynamic-form-input"
          value={value}
          onChange={(e) => onChange(field.name, e.target.value)}
          data-testid={`field-${field.name}`}
        />
      );
  }
}
