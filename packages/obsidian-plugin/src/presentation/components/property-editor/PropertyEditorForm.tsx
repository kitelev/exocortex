import React, { useState, useCallback, useMemo, useEffect } from "react";
import type { PropertySchemaDefinition } from '@plugin/domain/property-editor/PropertySchemas';
import { getPropertySchemaForClass, getPropertySchemaForClassSync } from '@plugin/domain/property-editor/PropertySchemas';
import type { AssetRefCandidate } from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import {
  TextField,
  SelectField,
  WikiLinkField,
  BooleanField,
  TimestampField,
  NumberField,
} from "./fields";
import { RelationsSection, type PredicateOption } from "./RelationsSection";
import type { RelationRow } from "./relationsEditorModel";

/**
 * RFC `93a0b2ee` Phase 3 / Task 3.1 — dependencies for the embedded Relations
 * section. Supplied by {@link PropertyEditorModal} (which owns triple-store
 * access + the vault write-path). When absent the form behaves exactly as
 * before (back-compat) — wikilink fields render as raw text fields.
 */
export interface RelationsFormDeps {
  /** The unified, deduplicated outgoing relations at open time. */
  initialRows: RelationRow[];
  /** Predicates the user may create a relation with (A's class wikilink properties). */
  predicateOptions: PredicateOption[];
  /** Range-scoped candidate resolver for the target picker. */
  resolveCandidates: (rangeClassUid: string | undefined) => AssetRefCandidate[];
  /** Append a new inline relation; resolves to the refreshed row list. */
  createInline: (predicateKey: string, targetUid: string) => Promise<RelationRow[]>;
  /** Delete a relation (inline → frontmatter, reified → statement); resolves to refreshed rows. */
  deleteRelation: (row: RelationRow) => Promise<RelationRow[]>;
}

export interface PropertyEditorFormProps {
  instanceClass: string;
  frontmatter: Record<string, unknown>;
  onSave: (updatedFrontmatter: Record<string, unknown>) => void;
  onCancel: () => void;
  /** RFC `93a0b2ee` Task 3.1 — when present, render the Relations section. */
  relations?: RelationsFormDeps;
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
  relations,
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

  // RFC 93a0b2ee Task 3.1 — when the Relations section is active, relation
  // (wikilink) properties are managed there, not as raw text fields here.
  const editableProperties = useMemo(() => {
    const base = schema.filter((p) => !p.readOnly);
    return relations ? base.filter((p) => p.type !== "wikilink") : base;
  }, [schema, relations]);

  const handleSave = useCallback(() => {
    if (!validate()) return;
    // RFC 93a0b2ee Task 3.1 — when the Relations section is active, relations are
    // written LIVE by the section (create/delete). The bulk Save must NOT write
    // relation keys back from the stale `formData` snapshot (that would resurrect
    // a deleted relation / drop a created one). Save only the scalar fields the
    // form actually edits (the editable, non-relation properties).
    if (relations) {
      const editableKeys = new Set(editableProperties.map((p) => p.name));
      const payload = Object.fromEntries(
        Object.entries(formData).filter(([k]) => editableKeys.has(k)),
      );
      onSave(payload);
      return;
    }
    onSave(formData);
  }, [validate, formData, onSave, relations, editableProperties]);

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

  // RFC 93a0b2ee Task 3.1 — live relation rows (create/delete mutate the vault
  // immediately and return the refreshed list, independent of the bulk Save).
  const [relationRows, setRelationRows] = useState<RelationRow[]>(
    () => relations?.initialRows ?? [],
  );
  useEffect(() => {
    if (relations) setRelationRows(relations.initialRows);
  }, [relations]);

  const handleRelationCreate = useCallback(
    (predicateKey: string, targetUid: string) => {
      if (!relations) return;
      void relations
        .createInline(predicateKey, targetUid)
        .then((rows) => setRelationRows(rows));
    },
    [relations],
  );

  const handleRelationDelete = useCallback(
    (row: RelationRow) => {
      if (!relations) return;
      void relations.deleteRelation(row).then((rows) => setRelationRows(rows));
    },
    [relations],
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

      {relations && (
        <RelationsSection
          rows={relationRows}
          predicateOptions={relations.predicateOptions}
          resolveCandidates={relations.resolveCandidates}
          onCreate={handleRelationCreate}
          onDelete={handleRelationDelete}
        />
      )}

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
