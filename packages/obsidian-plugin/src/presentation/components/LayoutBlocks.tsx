/**
 * React components for `exo__LayoutBlock` subclasses rendered by
 * `ExoLayoutRenderer`.  Kept in a single file because each component is small
 * and they share prop conventions (title, collapsed, block-specific data).
 *
 * MVP scope (RFC exo__Layout Phase 2):
 *   - PropertiesBlockView  — display the current asset's frontmatter.
 *   - BacklinksTableBlockView — display filtered backlinks as a table.
 *
 * Security: all user-controlled text (`title`, cell values, column headers) is
 * rendered via React's auto-escaping JSX — we never route through
 * `dangerouslySetInnerHTML`.  XSS vectors (`<script>`, `javascript:`, HTML
 * entities, unicode) are therefore neutralised at the JSX boundary.
 *
 * @module presentation/components
 * @since 15.x (RFC exo__Layout Phase 2)
 */

import React from "react";
import type { AssetRelation } from "@plugin/presentation/renderers/layout/types";
import { humanizePropertyValue } from "@plugin/presentation/components/AssetRelationsTable";

export interface PropertiesBlockViewProps {
  readonly title: string;
  readonly properties: ReadonlyArray<{ readonly key: string; readonly value: unknown }>;
  /**
   * RFC 0002 §3.7 (P11) — resolves a wikilink target (UID or name) to its
   * `exo__Asset_label`, so UID-only enum/class values render a readable label
   * instead of a raw `[[uuid]]`. Optional: when absent, values fall back to
   * alias / prefix-stripped target humanization.
   */
  readonly resolveLabel?: (target: string) => string | null;
}

export const PropertiesBlockView: React.FC<PropertiesBlockViewProps> = ({
  title,
  properties,
  resolveLabel,
}) => {
  return (
    <div className="exocortex-layout-block exocortex-layout-block-properties">
      <h3 className="exocortex-layout-block-title">{title}</h3>
      {properties.length === 0 ? (
        <div className="exocortex-layout-block-empty">No properties</div>
      ) : (
        <table
          className="exocortex-layout-block-properties-table"
          role="table"
        >
          <thead>
            <tr>
              <th scope="col">Property</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {properties.map(({ key, value }) => (
              <tr key={key}>
                <td className="exocortex-layout-block-property-name">{key}</td>
                <td className="exocortex-layout-block-property-value">
                  {humanizePropertyValue(value, resolveLabel)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

function formatPropertyValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string | number | boolean => v !== null && v !== undefined)
      .map((v) => String(v))
      .join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

export interface BacklinksTableBlockViewProps {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly AssetRelation[];
}

export const BacklinksTableBlockView: React.FC<BacklinksTableBlockViewProps> = ({
  title,
  columns,
  rows,
}) => {
  const effectiveColumns =
    columns.length > 0 ? columns : ["exo__Asset_label"];
  return (
    <div className="exocortex-layout-block exocortex-layout-block-backlinks">
      <h3 className="exocortex-layout-block-title">{title}</h3>
      {rows.length === 0 ? (
        <div className="exocortex-layout-block-empty">No matching backlinks</div>
      ) : (
        <table
          className="exocortex-layout-block-backlinks-table"
          role="table"
        >
          <thead>
            <tr>
              {effectiveColumns.map((col) => (
                <th key={col} scope="col">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.path} data-asset-path={row.path}>
                {effectiveColumns.map((col) => (
                  <td key={col}>{resolveCell(row, col)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

function resolveCell(row: AssetRelation, column: string): string {
  if (column === "exo__Asset_label") {
    return row.title || "";
  }
  if (column === "_basename") {
    return row.path.split("/").pop()?.replace(/\.md$/, "") ?? row.path;
  }
  const value = row.metadata[column];
  return formatPropertyValue(value);
}
