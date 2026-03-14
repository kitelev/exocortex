import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { TFile, setIcon } from "obsidian";
import { PropertyUpdateService } from '@plugin/application/services/PropertyUpdateService';
import { PropertyValidationService } from '@plugin/application/services/PropertyValidationService';
import { TextPropertyField } from "./properties/TextPropertyField";
import { DateTimePropertyField } from "./properties/DateTimePropertyField";

interface SortState {
  column: string;
  order: "asc" | "desc";
}

interface PropertyValidationErrors {
  [key: string]: {
    domainError?: string;
    rangeError?: string;
  };
}

export interface AssetPropertiesTableProps {
  metadata: Record<string, unknown>;
  onLinkClick?: (path: string, event: React.MouseEvent) => void;
  getAssetLabel?: (path: string) => string | null;
  onRemoveRedundantAlias?: (file: TFile, propertyKey: string, target: string, alias: string) => Promise<void>;
  file?: TFile;
  propertyUpdateService?: PropertyUpdateService;
  propertyValidationService?: PropertyValidationService;
  editable?: boolean;
}

/**
 * Helper component to render the bookmark-minus icon via Obsidian's setIcon.
 */
const AliasRemoveIcon: React.FC<{
  alias: string;
  onClick: () => void;
}> = ({ alias, onClick }) => {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (spanRef.current) {
      setIcon(spanRef.current, "bookmark-minus");
    }
  }, []);

  return (
    <span
      ref={spanRef}
      className="exocortex-alias-remove-icon"
      aria-label={`Remove redundant alias "${alias}"`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    />
  );
};

export const AssetPropertiesTable: React.FC<AssetPropertiesTableProps> = ({
  metadata,
  onLinkClick,
  getAssetLabel,
  onRemoveRedundantAlias,
  file,
  propertyUpdateService,
  propertyValidationService,
  editable = false,
}) => {
  const [sortState, setSortState] = useState<SortState>({
    column: "",
    order: "asc",
  });
  const [validationErrors, setValidationErrors] =
    useState<PropertyValidationErrors>({});

  useEffect(() => {
    const validateProperties = async () => {
      if (!propertyValidationService || !metadata) {
        setValidationErrors({});
        return;
      }

      const assetClass = String(metadata["exo__Instance_class"] || "");
      const errors: PropertyValidationErrors = {};

      for (const [key, value] of Object.entries(metadata)) {
        if (key === "exo__Instance_class" || key === "position") {
          continue;
        }

        const domainResult =
          await propertyValidationService.validatePropertyDomain(
            key,
            assetClass,
          );
        const rangeResult =
          await propertyValidationService.validatePropertyRange(key, value);

        if (!domainResult.isValid || !rangeResult.isValid) {
          errors[key] = {
            domainError: domainResult.isValid
              ? undefined
              : domainResult.errorMessage,
            rangeError: rangeResult.isValid
              ? undefined
              : rangeResult.errorMessage,
          };
        }
      }

      setValidationErrors(errors);
    };

    validateProperties();
  }, [metadata, propertyValidationService]);

  const handleSort = (column: string) => {
    setSortState((prev) => ({
      column,
      order: prev.column === column && prev.order === "asc" ? "desc" : "asc",
    }));
  };

  const isWikiLink = (value: unknown): boolean => {
    return typeof value === "string" && /\[\[.*?\]\]/.test(value);
  };

  interface WikiLink {
    target: string;
    alias?: string;
  }

  const parseWikiLink = (value: string): WikiLink => {
    // Remove [[ and ]]
    const content = value.replace(/^\[\[|\]\]$/g, "");

    // Check if there's an alias (format: target|alias)
    const pipeIndex = content.indexOf("|");

    if (pipeIndex !== -1) {
      return {
        target: content.substring(0, pipeIndex).trim(),
        alias: content.substring(pipeIndex + 1).trim(),
      };
    }

    return {
      target: content.trim(),
    };
  };

  const detectPropertyType = (
    value: unknown,
  ): "datetime" | "text" | "number" | "boolean" | "wikilink" | "array" | "object" => {
    if (value === null || value === undefined) return "text";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return "number";
    if (Array.isArray(value)) return "array";
    if (typeof value === "object") return "object";

    if (typeof value === "string") {
      if (isWikiLink(value)) return "wikilink";

      const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z?)?$/;
      if (dateRegex.test(value)) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return "datetime";
        }
      }

      return "text";
    }

    return "text";
  };

  const [hiddenAliasIcons, setHiddenAliasIcons] = useState<Set<string>>(new Set());

  const handleRemoveAlias = useCallback(async (propertyKey: string, target: string, alias: string) => {
    if (!file || !onRemoveRedundantAlias) return;

    const iconKey = `${propertyKey}:${target}`;
    setHiddenAliasIcons(prev => new Set(prev).add(iconKey));

    try {
      await onRemoveRedundantAlias(file, propertyKey, target, alias);
    } catch {
      setHiddenAliasIcons(prev => {
        const next = new Set(prev);
        next.delete(iconKey);
        return next;
      });
    }
  }, [file, onRemoveRedundantAlias]);

  const handlePropertyUpdate = async (key: string, newValue: unknown) => {
    if (!file || !propertyUpdateService) return;

    try {
      await propertyUpdateService.updateProperty(file, key, newValue);
    } catch (error) {
      console.error(`Failed to update property "${key}":`, error);
    }
  };

  const renderEditableField = (key: string, value: unknown): React.ReactNode => {
    const propertyType = detectPropertyType(value);

    switch (propertyType) {
      case "datetime":
        return (
          <DateTimePropertyField
            value={typeof value === "string" ? value : null}
            onChange={(newValue) => handlePropertyUpdate(key, newValue)}
          />
        );

      case "text":
        return (
          <TextPropertyField
            value={String(value || "")}
            onChange={(newValue) => handlePropertyUpdate(key, newValue)}
          />
        );

      case "wikilink":
      case "array":
      case "object":
      case "boolean":
      case "number":
      default:
        return renderValue(value, key);
    }
  };

  const renderValue = (value: unknown, propertyKey?: string): React.ReactNode => {
    if (value === null || value === undefined) {
      return "-";
    }

    if (typeof value === "boolean" || typeof value === "number") {
      return String(value);
    }

    if (typeof value === "string") {
      if (isWikiLink(value)) {
        const parsed = parseWikiLink(value);
        const label = getAssetLabel?.(parsed.target);
        const displayText = parsed.alias || label || parsed.target;
        const alias = parsed.alias;
        const isRedundantAlias = alias != null && label != null && alias === label;
        const iconKey = propertyKey ? `${propertyKey}:${parsed.target}` : "";
        const iconHidden = hiddenAliasIcons.has(iconKey);
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
            <a
              data-href={parsed.target}
              className="internal-link"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onLinkClick?.(parsed.target, e);
              }}
              style={{ cursor: "pointer" }}
            >
              {displayText}
            </a>
            {isRedundantAlias && alias && onRemoveRedundantAlias && propertyKey && !iconHidden && (
              <AliasRemoveIcon
                alias={alias}
                onClick={() => handleRemoveAlias(propertyKey, parsed.target, alias)}
              />
            )}
          </span>
        );
      }
      return value;
    }

    if (Array.isArray(value)) {
      return (
        <>
          {value.map((item, index) => (
            <React.Fragment key={index}>
              {renderValue(item, propertyKey)}
              {index < value.length - 1 ? ", " : ""}
            </React.Fragment>
          ))}
        </>
      );
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  };

  const metadataEntries = Object.entries(metadata || {});

  const getNormalizedValue = (value: unknown): string | number => {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? "true" : "false";

    if (typeof value === "string" && /\[\[.*?\]\]/.test(value)) {
      const content = value.replace(/^\[\[|\]\]$/g, "");
      const pipeIndex = content.indexOf("|");
      return (
        pipeIndex !== -1
          ? content.substring(pipeIndex + 1).trim()
          : content.trim()
      ).toLowerCase();
    }

    if (Array.isArray(value)) {
      return value.length > 0 ? getNormalizedValue(value[0]) : "";
    }

    if (typeof value === "object") {
      return JSON.stringify(value).toLowerCase();
    }

    return String(value).toLowerCase();
  };

  const sortedEntries = useMemo(() => {
    if (!sortState.column) {
      return metadataEntries;
    }

    const sorted = [...metadataEntries];

    sorted.sort(([keyA, valueA], [keyB, valueB]) => {
      let aValue: string | number;
      let bValue: string | number;

      if (sortState.column === "property") {
        aValue = keyA.toLowerCase();
        bValue = keyB.toLowerCase();
      } else {
        aValue = getNormalizedValue(valueA);
        bValue = getNormalizedValue(valueB);
      }

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortState.order === "asc" ? aValue - bValue : bValue - aValue;
      }

      const aStr = String(aValue);
      const bStr = String(bValue);

      if (aStr < bStr) {
        return sortState.order === "asc" ? -1 : 1;
      }
      if (aStr > bStr) {
        return sortState.order === "asc" ? 1 : -1;
      }
      return 0;
    });

    return sorted;
  }, [metadataEntries, sortState]);

  if (metadataEntries.length === 0) {
    return null;
  }

  return (
    <div className="exocortex-asset-properties">
      <h3>Properties</h3>
      <table className="exocortex-properties-table">
        <thead>
          <tr>
            <th
              onClick={() => handleSort("property")}
              className="sortable"
              style={{ cursor: "pointer" }}
            >
              Property{" "}
              {sortState.column === "property" &&
                (sortState.order === "asc" ? "↑" : "↓")}
            </th>
            <th
              onClick={() => handleSort("value")}
              className="sortable"
              style={{ cursor: "pointer" }}
            >
              Value{" "}
              {sortState.column === "value" &&
                (sortState.order === "asc" ? "↑" : "↓")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map(([key, value]) => {
            const hasError = validationErrors[key];
            const keyClasses = [
              "property-key",
              hasError?.domainError ? "exocortex-property-error-key" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const valueClasses = [
              "property-value",
              hasError?.rangeError ? "exocortex-property-error-value" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <tr key={key}>
                <td
                  className={keyClasses}
                  title={hasError?.domainError || undefined}
                >
                  {key}
                </td>
                <td
                  className={valueClasses}
                  title={hasError?.rangeError || undefined}
                >
                  {editable && file && propertyUpdateService
                    ? renderEditableField(key, value)
                    : renderValue(value, key)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
