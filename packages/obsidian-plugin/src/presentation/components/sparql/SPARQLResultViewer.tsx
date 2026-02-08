import React, { useMemo } from "react";
import type { SolutionMapping, Triple } from "exocortex";
import type { App } from "obsidian";
import { SPARQLTableView } from "./SPARQLTableView";
import { SPARQLListView } from "./SPARQLListView";
import { SPARQLEmptyState } from "./SPARQLEmptyState";

export interface SPARQLResultViewerProps {
  results: SolutionMapping[] | Triple[];
  queryString: string;
  onAssetClick: (path: string, event?: React.MouseEvent) => void;
  app: App;
}

const isTripleArray = (results: SolutionMapping[] | Triple[]): results is Triple[] => {
  return results.length > 0 && "subject" in results[0];
};

const extractVariables = (queryString: string): string[] => {
  const selectMatch = queryString.match(/SELECT\s+([\s\S]*?)\s+WHERE/i);
  if (!selectMatch) {
    return [];
  }

  const variablesString = selectMatch[1];
  const distinctMatch = variablesString.match(/DISTINCT\s+(.*)/i);
  const cleanedString = distinctMatch ? distinctMatch[1] : variablesString;

  const variableMatches = cleanedString.match(/\?(\w+)/g);
  if (!variableMatches) {
    return [];
  }

  return variableMatches.map((v) => v.substring(1));
};

const exportToCSV = (results: SolutionMapping[], variables: string[]): void => {
  const header = variables.join(",");
  const rows = results.map((result) => {
    return variables
      .map((variable) => {
        const value = result.get(variable)?.toString() || "";
        return `"${value.replace(/"/g, '""')}"`;
      })
      .join(",");
  });

  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sparql-results-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const exportToTurtle = (triples: Triple[]): void => {
  const turtle = triples.map((t) => t.toString()).join("\n");
  const blob = new Blob([turtle], { type: "text/turtle" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sparql-triples-${Date.now()}.ttl`;
  a.click();
  URL.revokeObjectURL(url);
};

export const SPARQLResultViewer: React.FC<SPARQLResultViewerProps> = ({
  results,
  queryString,
  onAssetClick,
}) => {
  const isTriples = isTripleArray(results);

  const variables = useMemo(() => {
    if (isTriples) {
      return [];
    }
    return extractVariables(queryString);
  }, [isTriples, queryString]);

  const handleExport = () => {
    if (isTriples) {
      exportToTurtle(results);
    } else {
      exportToCSV(results, variables);
    }
  };

  if (results.length === 0) {
    return <SPARQLEmptyState queryString={queryString} />;
  }

  return (
    <div className="sparql-result-viewer">
      <div className="sparql-result-viewer-controls">
        <div className="sparql-view-mode-info">
          {isTriples ? "list" : "table"} view
        </div>
        <button
          className="sparql-export-button"
          onClick={handleExport}
          aria-label="export results"
        >
          ⬇ export
        </button>
      </div>
      <div className="sparql-result-viewer-content">
        {isTriples ? (
          <SPARQLListView
            triples={results}
            onAssetClick={(path, event) => onAssetClick(path, event)}
          />
        ) : (
          <SPARQLTableView
            results={results}
            variables={variables}
            onAssetClick={(path, event) => onAssetClick(path, event)}
          />
        )}
      </div>
    </div>
  );
};
