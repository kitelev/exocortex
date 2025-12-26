import React, { useState, useEffect, useMemo } from "react";
import type { SolutionMapping, Triple } from "exocortex";
import type { App } from "obsidian";
import { SPARQLTableView } from "./SPARQLTableView";
import { SPARQLListView } from "./SPARQLListView";
import { SPARQLGraphView } from "./SPARQLGraphView";
import { SPARQLGraph3DView } from "./SPARQLGraph3DView";
import { ViewModeSelector, type ViewMode } from "./ViewModeSelector";
import { SPARQLEmptyState } from "./SPARQLEmptyState";

export interface SPARQLResultViewerProps {
  results: SolutionMapping[] | Triple[];
  queryString: string;
  onAssetClick: (path: string, event?: React.MouseEvent) => void;
  app: App;
}

const STORAGE_KEY = "exocortex-sparql-view-mode";

const isTripleArray = (results: SolutionMapping[] | Triple[]): results is Triple[] => {
  return results.length > 0 && "subject" in results[0];
};

const shouldDefaultToGraph = (triples: Triple[]): boolean => {
  if (triples.length === 0) {
    return false;
  }

  let relationshipCount = 0;

  for (const triple of triples) {
    const subjectStr = triple.subject.toString();
    const objectStr = triple.object.toString();

    const isSubjectIRI = subjectStr.startsWith("<") && subjectStr.endsWith(">");
    const isObjectIRI = objectStr.startsWith("<") && objectStr.endsWith(">");

    if (isSubjectIRI && isObjectIRI) {
      relationshipCount++;
    }
  }

  return relationshipCount >= 2;
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

const exportToJSON = (results: SolutionMapping[], variables: string[]): void => {
  const jsonData = results.map((result) => {
    const obj: Record<string, string> = {};
    variables.forEach((variable) => {
      obj[variable] = result.get(variable)?.toString() || "";
    });
    return obj;
  });

  const json = JSON.stringify(jsonData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sparql-results-${Date.now()}.json`;
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
  app,
}) => {
  const isTriples = isTripleArray(results);

  const defaultMode: ViewMode = useMemo(() => {
    if (!isTriples) {
      return "table";
    }
    return shouldDefaultToGraph(results) ? "graph" : "list";
  }, [isTriples, results]);

  const availableModes: ViewMode[] = useMemo(() => {
    return isTriples ? ["list", "graph", "graph3d"] : ["table"];
  }, [isTriples]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const stored = app.loadLocalStorage(STORAGE_KEY);
      if (stored && availableModes.includes(stored as ViewMode)) {
        return stored as ViewMode;
      }
    } catch (error) {
      console.warn("[Exocortex SPARQL] Could not read view mode from localStorage:", error);
    }
    return defaultMode;
  });

  useEffect(() => {
    try {
      app.saveLocalStorage(STORAGE_KEY, viewMode);
    } catch (error) {
      console.warn("[Exocortex SPARQL] Could not save view mode to localStorage:", error);
    }
  }, [viewMode, app]);

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
      if (viewMode === "table") {
        exportToCSV(results, variables);
      } else {
        exportToJSON(results, variables);
      }
    }
  };

  const renderView = () => {
    if (isTriples) {
      switch (viewMode) {
        case "graph":
          return (
            <SPARQLGraphView
              triples={results}
              onAssetClick={onAssetClick}
            />
          );
        case "graph3d":
          return (
            <SPARQLGraph3DView
              triples={results}
              onAssetClick={onAssetClick}
            />
          );
        case "list":
          return (
            <SPARQLListView
              triples={results}
              onAssetClick={(path, event) => onAssetClick(path, event)}
            />
          );
        default:
          return (
            <SPARQLListView
              triples={results}
              onAssetClick={(path, event) => onAssetClick(path, event)}
            />
          );
      }
    } else {
      return (
        <SPARQLTableView
          results={results}
          variables={variables}
          onAssetClick={(path, event) => onAssetClick(path, event)}
        />
      );
    }
  };

  if (results.length === 0) {
    return <SPARQLEmptyState queryString={queryString} />;
  }

  return (
    <div className="sparql-result-viewer">
      {availableModes.length > 1 && (
        <div className="sparql-result-viewer-controls">
          <ViewModeSelector
            currentMode={viewMode}
            onModeChange={setViewMode}
            availableModes={availableModes}
          />
          <button
            className="sparql-export-button"
            onClick={handleExport}
            aria-label="export results"
          >
            ⬇ export
          </button>
        </div>
      )}
      {availableModes.length === 1 && (
        <div className="sparql-result-viewer-controls">
          <div className="sparql-view-mode-info">
            {viewMode} view
          </div>
          <button
            className="sparql-export-button"
            onClick={handleExport}
            aria-label="export results"
          >
            ⬇ export
          </button>
        </div>
      )}
      <div className="sparql-result-viewer-content">
        {renderView()}
      </div>
    </div>
  );
};
