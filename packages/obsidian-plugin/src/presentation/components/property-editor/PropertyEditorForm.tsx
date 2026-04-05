import React, { useState, useCallback, useMemo, useEffect } from "react";
import type { PropertySchemaDefinition } from '@plugin/domain/property-editor/PropertySchemas';
import { getPropertySchemaForClass, getPropertySchemaForClassSync } from '@plugin/domain/property-editor/PropertySchemas';
import {
  TextField,
  SelectField,
  WikiLinkField,
  BooleanField,
  TimestampField,
  NumberField,
} from "./fields";

export interface PropertyEditorFormProps {
  instanceClass: string;
  frontmatter: Record<string, unknown>;
  onSave: (updatedFrontmatter: Record<string, unknown>) => void;
  onCancel: () => void;
}

interface ValidationError {
  field: string;
  message: string;
}

export const PropertyEditorForm: React.FC<PropertyEditorFormProps> = ({
  instanceClass,
  frontmatter,
  onSave,
  onCancel,
}) => {
  const [schema, setSchema] = useState<PropertySchemaDefinition[]>(
    () => getPropertySchemaForClassSync(instanceClass),
  );

  useEffect(() => {
    let cancelled = false;
    getPropertySchemaForClass(instanceClass).then((resolved) => {
      if (!cancelled) {
        setSchema(resolved);
      }
    });
    return () => { cancelled = true; };
  }, [instanceClass]);

  const [formData, setFormData] = useState<Record<string, unknown>>(() => ({
    ...frontmatter,
  }));
  const [errors, setErrors] = useState<ValidationError[]>([]);

  const handleFieldChange = useCallback(
    (propertyName: string, value: unknown) => {
      setFormData((prev) => ({
        ...prev,
        [propertyName]: value,
      }));
      setErrors((prev) => prev.filter((e) => e.field !== propertyName));
    },
    [],
  );

  const validate = useCallback((): boolean => {
    const newErrors: ValidationError[] = [];

    for (const property of schema) {
      if (property.required && !property.readOnly) {
        const value = formData[property.name];
        if (value === undefined || value === null || value === "") {
          newErrors.push({
            field: property.name,
            message: `${property.label} is required`,
          });
        }
      }
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  }, [schema, formData]);

  const handleSave = useCallback(() => {
    if (validate()) {
      onSave(formData);
    }
  }, [validate, formData, onSave]);

  const getErrorForField = useCallback(
    (fieldName: string): string | undefined => {
      const error = errors.find((e) => e.field === fieldName);
      return error?.message;
    },
    [errors],
  );

  const renderField = useCallback(
    (property: PropertySchemaDefinition) => {
      const value = formData[property.name];
      const error = getErrorForField(property.name);

      switch (property.type) {
        case "text":
          return (
            <TextField
              key={property.name}
              property={property}
              value={value as string}
              onChange={(v) => handleFieldChange(property.name, v)}
              error={error}
            />
          );

        case "status-select":
        case "size-select":
          return (
            <SelectField
              key={property.name}
              property={property}
              value={value as string}
              onChange={(v) => handleFieldChange(property.name, v)}
              error={error}
            />
          );

        case "wikilink":
          return (
            <WikiLinkField
              key={property.name}
              property={property}
              value={value as string}
              onChange={(v) => handleFieldChange(property.name, v)}
              error={error}
            />
          );

        case "boolean":
          return (
            <BooleanField
              key={property.name}
              property={property}
              value={value as boolean | string}
              onChange={(v) => handleFieldChange(property.name, v)}
              error={error}
            />
          );

        case "timestamp":
          return (
            <TimestampField
              key={property.name}
              property={property}
              value={value as string}
            />
          );

        case "number":
          return (
            <NumberField
              key={property.name}
              property={property}
              value={value as number | string}
              onChange={(v) => handleFieldChange(property.name, v)}
              error={error}
            />
          );

        default:
          return null;
      }
    },
    [formData, getErrorForField, handleFieldChange],
  );

  const editableProperties = useMemo(
    () => schema.filter((p) => !p.readOnly),
    [schema],
  );

  const readOnlyProperties = useMemo(
    () => schema.filter((p) => p.readOnly),
    [schema],
  );

  return (
    <div className="property-editor-form">
      <div className="property-editor-section">
        <h3 className="property-editor-section-title">Editable properties</h3>
        {editableProperties.map(renderField)}
      </div>

      {readOnlyProperties.length > 0 && (
        <div className="property-editor-section property-editor-readonly-section">
          <h3 className="property-editor-section-title">
            Read-only properties
          </h3>
          {readOnlyProperties.map(renderField)}
        </div>
      )}

      {errors.length > 0 && (
        <div className="property-editor-errors">
          <p className="error-summary">
            Please fix {errors.length} validation error
            {errors.length > 1 ? "s" : ""}
          </p>
        </div>
      )}

      <div className="property-editor-actions modal-button-container">
        <button className="mod-cta" onClick={handleSave}>
          Save
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};
