/**
 * Coexistence surrogate wrappers for the Phase 3 coexistence spec.
 *
 * Playwright CT requires that any React component passed to `mount` be
 * statically importable — it cannot accept dynamic children created inline
 * in the spec file.  These wrappers expose the two collaborating systems
 * (a mock RFC-024 codeblock + the real `AssetRelationsTable`) through a
 * single static mount target with explicit props.
 */

import React from "react";
import {
  AssetRelationsTable,
  AssetRelation,
} from "../../src/presentation/components/AssetRelationsTable";

export const STATIC_TABLE_COLUMNS = ["rfc024__Col1", "rfc024__Col2"];
export const STATIC_TABLE_ROWS = [["layout-row-1-c1", "layout-row-1-c2"]];

const StaticTableLayoutCodeblock: React.FC = () => (
  <table className="exocortex-table-layout-codeblock" data-testid="rfc024">
    <thead>
      <tr>
        {STATIC_TABLE_COLUMNS.map((col) => (
          <th key={col}>{col}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {STATIC_TABLE_ROWS.map((row, idx) => (
        <tr key={idx}>
          {row.map((cell, cellIdx) => (
            <td key={cellIdx}>{cell}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

export interface CoexistenceHarnessProps {
  relations: AssetRelation[];
  groupSpecificProperties?: Record<string, string[]>;
  groupByProperty?: boolean;
}

export const CoexistenceHarness: React.FC<CoexistenceHarnessProps> = ({
  relations,
  groupSpecificProperties,
  groupByProperty = true,
}) => (
  <div data-testid="coexistence-host">
    <StaticTableLayoutCodeblock />
    <AssetRelationsTable
      relations={relations}
      groupByProperty={groupByProperty}
      groupSpecificProperties={groupSpecificProperties}
    />
  </div>
);
