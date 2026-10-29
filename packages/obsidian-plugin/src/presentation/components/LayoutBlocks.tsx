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
    // req `3f65eb4a` — the exo__Layout children/query table's label column now shows the
    // HOMOICONIC display name (vault exo__DisplayNameSpec status/class prefix, e.g. 🔄 while
    // Doing), resolved by RelationsRenderer onto `row.displayName` — the SAME single source
    // as the Relations block + native links. Null-safe: no resolver / no matching spec →
    // `displayName` is undefined → plain `row.title` fallback (byte-identical, no regression).
    if (row.displayName != null && row.displayName !== "") {
      return row.displayName;
    }
    return row.title || "";
  }
  if (column === "_basename") {
    return row.path.split("/").pop()?.replace(/\.md$/, "") ?? row.path;
  }
  const value = row.metadata[column];
  return formatPropertyValue(value);
}

/**
 * QueryTableBlockView — the `query-table` block (RFC 9821a379, ticket 058bad52).
 *
 * States, decided upstream by `ExoLayoutRenderer`:
 *  - `loading` — the index is not stable yet (AC8): «Загрузка…», never the
 *    empty text, so a cold start does not claim «there are no rows».
 *  - `message` — a problem named by the query's label (AC7, AC11).
 *  - `rows` — the table; an empty result shows the block's `emptyText`. The
 *    footer names the cut («показано N из M» when the limit trimmed rows) and
 *    the query time (AC10 — readable on desktop AND iPhone without tooling).
 *
 * Security: every header, cell and message is JSX-escaped.
 */
export type QueryTableViewCell =
  | { readonly kind: "link"; readonly path: string; readonly text: string }
  | { readonly kind: "text"; readonly text: string };

export type QueryTableViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "message"; readonly text: string }
  | {
      readonly kind: "rows";
      readonly columns: readonly string[];
      readonly rows: readonly (readonly QueryTableViewCell[])[];
      readonly total: number;
      readonly elapsedMs: number;
      readonly emptyText: string;
    };

export interface QueryTableBlockViewProps {
  readonly title: string;
  readonly state: QueryTableViewState;
  readonly onLinkClick?: (path: string) => void;
}

export const QUERY_TABLE_LOADING_TEXT = "Загрузка…";

export function queryTableFooter(shown: number, total: number, elapsedMs: number): string {
  const time = `запрос ${elapsedMs} мс`;
  return shown < total ? `показано ${shown} из ${total} · ${time}` : time;
}

export const QueryTableBlockView: React.FC<QueryTableBlockViewProps> = ({
  title,
  state,
  onLinkClick,
}) => {
  return (
    <div className="exocortex-layout-block exocortex-layout-block-query-table">
      {title !== "" && <h3 className="exocortex-layout-block-title">{title}</h3>}
      {state.kind === "loading" && (
        <div className="exocortex-layout-block-loading" role="status" aria-busy="true">
          {QUERY_TABLE_LOADING_TEXT}
        </div>
      )}
      {state.kind === "message" && (
        <div className="exocortex-layout-block-error" role="alert">
          {state.text}
        </div>
      )}
      {state.kind === "rows" && state.rows.length === 0 && (
        <div className="exocortex-layout-block-empty">{state.emptyText}</div>
      )}
      {state.kind === "rows" && state.rows.length > 0 && (
        <table className="exocortex-layout-block-query-table-table" role="table">
          <thead>
            <tr>
              {state.columns.map((col) => (
                <th key={col} scope="col">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>
                    {cell.kind === "link" ? (
                      <a
                        className="internal-link"
                        data-href={cell.path}
                        href={cell.path}
                        onClick={(e) => {
                          e.preventDefault();
                          onLinkClick?.(cell.path);
                        }}
                      >
                        {cell.text}
                      </a>
                    ) : (
                      cell.text
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {state.kind === "rows" && (
        <div className="exocortex-layout-block-meta">
          {queryTableFooter(state.rows.length, state.total, state.elapsedMs)}
        </div>
      )}
    </div>
  );
};

/**
 * DailyEffortsBlockView — renders one class-partition of the day's efforts
 * (Actions / Tasks / Projects) as a clickable list (RL#4b / VL#4, RFC
 * pn__DailyNote toggles). The partition + visibility are decided upstream in
 * `ExoLayoutRenderer`; this view just renders the supplied items.
 *
 * Security: `title` and each item title are auto-escaped by JSX.
 */
export interface DailyEffortsBlockViewProps {
  readonly title: string;
  readonly items: ReadonlyArray<{ readonly path: string; readonly title: string }>;
  readonly onItemClick?: (path: string) => void;
}

export const DailyEffortsBlockView: React.FC<DailyEffortsBlockViewProps> = ({
  title,
  items,
  onItemClick,
}) => {
  return (
    <div className="exocortex-layout-block exocortex-layout-block-daily-efforts">
      <h3 className="exocortex-layout-block-title">{title}</h3>
      {items.length === 0 ? (
        <div className="exocortex-layout-block-empty">No efforts</div>
      ) : (
        <ul className="exocortex-layout-block-daily-efforts-list">
          {items.map((item) => (
            <li key={item.path} data-asset-path={item.path}>
              <a
                className="exocortex-daily-effort-link"
                href={item.path}
                onClick={(e) => {
                  e.preventDefault();
                  onItemClick?.(item.path);
                }}
              >
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
