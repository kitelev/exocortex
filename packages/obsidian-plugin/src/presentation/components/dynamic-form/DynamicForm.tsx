import React, { useState, useCallback, useMemo, useRef, useId } from "react";
import type {
  InputSchemaField,
  EnumOption,
  AssetRefCandidate,
} from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";

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
            <AssetRefPicker
              field={field}
              value={values[field.name] ?? ""}
              candidates={candidates?.[field.name] ?? []}
              onChange={handleChange}
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

/**
 * T1 "Create Instance" — reusable fuzzy reference-picker for `assetRef` fields
 * (project bbe40f8c, meta-requirement (a): a generic, parameterised-by-class
 * component, not a one-off). Displays candidate `label`s, commits a quoted
 * wikilink (`"[[<uid>]]"`) to the selected candidate. When no candidates are
 * supplied (e.g. unparameterised field) it degrades to a free-text input so
 * existing assetRef groundings keep working.
 *
 * Accessibility: ARIA combobox pattern with keyboard navigation —
 * ArrowDown/ArrowUp move the active option, Enter selects, Escape closes.
 */
interface AssetRefPickerProps {
  readonly field: InputSchemaField;
  readonly value: string;
  readonly candidates: ReadonlyArray<AssetRefCandidate>;
  readonly onChange: (name: string, value: string) => void;
}

function toWikilink(uid: string): string {
  return `"[[${uid}]]"`;
}

const AssetRefPicker: React.FC<AssetRefPickerProps> = ({
  field,
  value,
  candidates,
  onChange,
}) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // No candidates supplied → behave like a plain text input (backward compat
  // with assetRef fields that don't declare a targetClassUid).
  const isPicker = candidates.length > 0 || field.targetClassUid !== undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return candidates.slice(0, 50);
    return candidates
      .filter((c) => c.label.toLowerCase().includes(q))
      .slice(0, 50);
  }, [candidates, query]);

  const commit = useCallback(
    (candidate: AssetRefCandidate) => {
      onChange(field.name, toWikilink(candidate.uid));
      setQuery(candidate.label);
      setOpen(false);
      setActiveIndex(-1);
    },
    [field.name, onChange],
  );

  const handleInput = useCallback(
    (text: string) => {
      setQuery(text);
      setOpen(true);
      setActiveIndex(-1);
      // Clear the committed selection until a candidate is chosen, so free
      // text never leaks into frontmatter as a value.
      if (value) onChange(field.name, "");
    },
    [field.name, onChange, value],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isPicker) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        if (open && activeIndex >= 0 && activeIndex < filtered.length) {
          e.preventDefault();
          commit(filtered[activeIndex]);
        }
      } else if (e.key === "Escape") {
        setOpen(false);
        setActiveIndex(-1);
      }
    },
    [isPicker, filtered, open, activeIndex, commit],
  );

  if (!isPicker) {
    // Plain text passthrough (legacy assetRef without candidates).
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
  }

  return (
    <div className="dynamic-form-assetref">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeIndex >= 0
            ? `${listboxId}-opt-${activeIndex}`
            : undefined
        }
        className="dynamic-form-input"
        placeholder="Type to search…"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so an option's mousedown can commit before blur closes.
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        data-testid={`field-${field.name}`}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="dynamic-form-assetref-options"
        >
          {filtered.map((candidate, idx) => (
            <li
              key={candidate.uid}
              id={`${listboxId}-opt-${idx}`}
              role="option"
              aria-selected={idx === activeIndex}
              className={
                idx === activeIndex
                  ? "dynamic-form-assetref-option is-active"
                  : "dynamic-form-assetref-option"
              }
              // onMouseDown (not onClick) so it fires before the input blur.
              onMouseDown={(e) => {
                e.preventDefault();
                if (blurTimer.current) clearTimeout(blurTimer.current);
                commit(candidate);
              }}
              data-testid={`option-${field.name}-${candidate.uid}`}
            >
              {candidate.label}
            </li>
          ))}
        </ul>
      )}
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
