import React, { useState, useCallback, useMemo } from "react";
import type {
  InputSchemaField,
  EnumOption,
} from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";

export interface DynamicFormProps {
  readonly schema: InputSchemaField[];
  readonly onSubmit: (values: Record<string, string>) => void;
  readonly onCancel: () => void;
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

  const handleSubmit = useCallback(() => {
    if (validate()) {
      onSubmit(values);
    }
  }, [validate, values, onSubmit]);

  const getFieldError = useCallback(
    (name: string): string | undefined =>
      errors.find((e) => e.name === name)?.message,
    [errors],
  );

  return (
    <div className="dynamic-form">
      {schema.map((field) => (
        <div key={field.name} className="dynamic-form-field">
          <label className="dynamic-form-label">
            {field.label ?? field.name}
            {field.required && <span className="dynamic-form-required"> *</span>}
          </label>
          {renderField(field, values[field.name] ?? "", handleChange)}
          {getFieldError(field.name) && (
            <div className="dynamic-form-error">{getFieldError(field.name)}</div>
          )}
        </div>
      ))}
      <div className="modal-button-container">
        <button className="mod-cta" onClick={handleSubmit}>
          OK
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
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

    case "assetRef":
      return (
        <input
          type="text"
          className="dynamic-form-input"
          placeholder="asset reference..."
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
