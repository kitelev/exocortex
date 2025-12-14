import React, { useState, useCallback, useMemo } from "react";
import type { App } from "obsidian";
import type { SolutionMapping, Triple } from "exocortex";
import {
  TEMPLATE_CATEGORIES,
  getTemplatesByCategory,
  type QueryTemplate,
} from "./QueryTemplates";
import { SPARQLResultViewer } from "./SPARQLResultViewer";
import { SPARQLErrorView, type SPARQLError } from "./SPARQLErrorView";
import { SPARQLEmptyState } from "./SPARQLEmptyState";

export interface QueryBuilderProps {
  app: App;
  onExecuteQuery: (query: string) => Promise<SolutionMapping[] | Triple[]>;
  onAssetClick: (path: string, event?: React.MouseEvent) => void;
  onCopyQuery?: (query: string) => void;
}

export const QueryBuilder: React.FC<QueryBuilderProps> = ({
  app,
  onExecuteQuery,
  onAssetClick,
  onCopyQuery,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedTemplate, setSelectedTemplate] = useState<QueryTemplate | null>(null);
  const [customQuery, setCustomQuery] = useState<string>("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [results, setResults] = useState<SolutionMapping[] | Triple[] | null>(null);
  const [error, setError] = useState<SPARQLError | null>(null);

  const filteredTemplates = useMemo(
    () => getTemplatesByCategory(selectedCategory),
    [selectedCategory]
  );

  const activeQuery = useMemo(() => {
    if (customQuery.trim()) {
      return customQuery;
    }
    return selectedTemplate?.query || "";
  }, [customQuery, selectedTemplate]);

  const handleTemplateSelect = useCallback((template: QueryTemplate) => {
    setSelectedTemplate(template);
    setCustomQuery("");
    setError(null);
  }, []);

  const handleCategoryChange = useCallback((category: string) => {
    setSelectedCategory(category);
    setSelectedTemplate(null);
    setCustomQuery("");
    setError(null);
  }, []);

  const handleCustomQueryChange = useCallback((query: string) => {
    setCustomQuery(query);
    setSelectedTemplate(null);
    setError(null);
  }, []);

  const handleExecute = useCallback(async () => {
    if (!activeQuery.trim()) {
      setError({
        message: "no query to execute",
        queryString: "",
      });
      return;
    }

    setIsExecuting(true);
    setError(null);
    setResults(null);

    try {
      const queryResults = await onExecuteQuery(activeQuery);
      setResults(queryResults);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError({
        message: errorObj.message,
        queryString: activeQuery,
      });
    } finally {
      setIsExecuting(false);
    }
  }, [activeQuery, onExecuteQuery]);

  const handleCopy = useCallback(() => {
    if (!activeQuery.trim()) {
      return;
    }

    navigator.clipboard.writeText(activeQuery).then(
      () => {
        if (onCopyQuery) {
          onCopyQuery(activeQuery);
        }
      },
      (err) => {
        console.error("[Exocortex Query Builder] Copy failed:", err);
      }
    );
  }, [activeQuery, onCopyQuery]);

  const handleClear = useCallback(() => {
    setSelectedTemplate(null);
    setCustomQuery("");
    setResults(null);
    setError(null);
  }, []);

  return (
    <div className="query-builder">
      <div className="query-builder-header">
        <h3 className="query-builder-title">sparql query builder</h3>
        <div className="query-builder-actions">
          <button
            className="query-builder-button query-builder-button-secondary"
            onClick={handleClear}
            disabled={!activeQuery.trim()}
          >
            clear
          </button>
          <button
            className="query-builder-button query-builder-button-secondary"
            onClick={handleCopy}
            disabled={!activeQuery.trim()}
          >
            📋 copy
          </button>
          <button
            className="query-builder-button query-builder-button-primary"
            onClick={handleExecute}
            disabled={!activeQuery.trim() || isExecuting}
          >
            {isExecuting ? "executing..." : "▶ run query"}
          </button>
        </div>
      </div>

      <div className="query-builder-content">
        <div className="query-builder-sidebar">
          <div className="query-builder-section">
            <label className="query-builder-label">template category</label>
            <select
              className="query-builder-select"
              value={selectedCategory}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              {TEMPLATE_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div className="query-builder-section">
            <label className="query-builder-label">
              query templates ({filteredTemplates.length})
            </label>
            <div className="query-builder-templates">
              {filteredTemplates.map((template) => (
                <button
                  key={template.id}
                  className={`query-builder-template-card ${
                    selectedTemplate?.id === template.id ? "active" : ""
                  }`}
                  onClick={() => handleTemplateSelect(template)}
                >
                  <div className="query-builder-template-name">
                    {template.name}
                  </div>
                  <div className="query-builder-template-description">
                    {template.description}
                  </div>
                  <div className="query-builder-template-use-case">
                    💡 {template.useCase}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="query-builder-main">
          <div className="query-builder-section">
            <label className="query-builder-label">sparql query</label>
            <textarea
              className="query-builder-textarea"
              value={activeQuery}
              onChange={(e) => handleCustomQueryChange(e.target.value)}
              placeholder="select a template or write your own sparql query..."
              spellCheck={false}
            />
          </div>

          {selectedTemplate && (
            <div className="query-builder-template-info">
              <strong>template:</strong> {selectedTemplate.name}
              <span className="query-builder-template-category">
                {selectedTemplate.category}
              </span>
            </div>
          )}

          <div className="query-builder-section">
            <label className="query-builder-label">live preview</label>
            <div className="query-builder-preview">
              {isExecuting && (
                <div className="sparql-loading">executing query...</div>
              )}

              {!isExecuting && error && (
                <SPARQLErrorView error={error} />
              )}

              {!isExecuting && results && results.length > 0 && (
                <SPARQLResultViewer
                  results={results}
                  queryString={activeQuery}
                  onAssetClick={onAssetClick}
                  app={app}
                />
              )}

              {!isExecuting && results && results.length === 0 && (
                <SPARQLEmptyState queryString={activeQuery} />
              )}

              {!isExecuting && !results && !error && (
                <div className="query-builder-preview-empty">
                  <p>select a template or write a query to see results</p>
                  <p className="query-builder-preview-hint">
                    click "run query" to execute
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
