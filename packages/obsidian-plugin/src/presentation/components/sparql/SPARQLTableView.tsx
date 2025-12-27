import React, { useState, useMemo } from "react";
import type { SolutionMapping } from "exocortex";
import {
  containsWikilinks,
  parseEmbeddedWikilinks,
} from "@plugin/presentation/utils/WikilinkLabelResolver";

export interface SPARQLTableViewProps {
  results: SolutionMapping[];
  variables: string[];
  onAssetClick?: (path: string, event: React.MouseEvent) => void;
  pageSize?: number;
  /**
   * Optional function to resolve asset labels for wikilinks without aliases.
   * When provided, wikilinks like [[uuid]] will display the resolved label
   * instead of the raw target path.
   */
  getAssetLabel?: (path: string) => string | null;
}

interface SortState {
  column: string;
  order: "asc" | "desc";
}

interface WikiLink {
  target: string;
  alias?: string;
}

const isWikiLink = (value: string): boolean => {
  return /^\[\[.*?\]\]$/.test(value.trim());
};

const parseWikiLink = (value: string): WikiLink => {
  const content = value.replace(/^\[\[|\]\]$/g, "");
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

const renderValue = (
  value: string | undefined,
  onAssetClick?: (path: string, event: React.MouseEvent) => void,
  getAssetLabel?: (path: string) => string | null,
): React.ReactNode => {
  if (!value || value === "") {
    return "-";
  }

  // Check if the entire value is a standalone wikilink
  if (isWikiLink(value)) {
    const parsed = parseWikiLink(value);
    let displayText: string;

    if (parsed.alias) {
      // Wikilink has an explicit alias - use it
      displayText = parsed.alias;
    } else if (getAssetLabel) {
      // No alias - try to resolve asset label
      const resolvedLabel = getAssetLabel(parsed.target);
      displayText = resolvedLabel || parsed.target;
    } else {
      // No alias and no resolver - use target path
      displayText = parsed.target;
    }

    return (
      <a
        data-href={parsed.target}
        className="internal-link"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAssetClick?.(parsed.target, e);
        }}
        style={{ cursor: "pointer" }}
      >
        {displayText}
      </a>
    );
  }

  // Check if value contains embedded wikilinks (e.g., "• [[uuid]]" or "text [[link]] more")
  if (containsWikilinks(value)) {
    const segments = parseEmbeddedWikilinks(value, getAssetLabel);

    return (
      <>
        {segments.map((segment, index) => {
          if (segment.type === "wikilink" && segment.target) {
            return (
              <a
                key={index}
                data-href={segment.target}
                className="internal-link"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAssetClick?.(segment.target!, e);
                }}
                style={{ cursor: "pointer" }}
              >
                {segment.displayText}
              </a>
            );
          }
          return <React.Fragment key={index}>{segment.content}</React.Fragment>;
        })}
      </>
    );
  }

  return value;
};

const normalizeValue = (value: string | undefined): string => {
  if (!value || value === "") return "";

  if (isWikiLink(value)) {
    const parsed = parseWikiLink(value);
    return (parsed.alias || parsed.target).toLowerCase();
  }

  return value.toLowerCase();
};

export const SPARQLTableView: React.FC<SPARQLTableViewProps> = ({
  results,
  variables,
  onAssetClick,
  pageSize = 100,
  getAssetLabel,
}) => {
  const [sortState, setSortState] = useState<SortState>({
    column: variables[0] || "",
    order: "asc",
  });
  const [currentPage, setCurrentPage] = useState(0);

  const handleSort = (column: string) => {
    setSortState((prev) => ({
      column,
      order: prev.column === column && prev.order === "asc" ? "desc" : "asc",
    }));
    setCurrentPage(0);
  };

  const sortedResults = useMemo(() => {
    if (!sortState.column) return results;

    return [...results].sort((a, b) => {
      const aValue = a.get(sortState.column)?.toString() || "";
      const bValue = b.get(sortState.column)?.toString() || "";

      const aStr = normalizeValue(aValue);
      const bStr = normalizeValue(bValue);

      const numA = parseFloat(aValue);
      const numB = parseFloat(bValue);

      if (!isNaN(numA) && !isNaN(numB)) {
        return sortState.order === "asc" ? numA - numB : numB - numA;
      }

      if (aStr < bStr) {
        return sortState.order === "asc" ? -1 : 1;
      }
      if (aStr > bStr) {
        return sortState.order === "asc" ? 1 : -1;
      }

      return 0;
    });
  }, [results, sortState]);

  const totalPages = Math.ceil(sortedResults.length / pageSize);
  const paginatedResults = useMemo(() => {
    const start = currentPage * pageSize;
    return sortedResults.slice(start, start + pageSize);
  }, [sortedResults, currentPage, pageSize]);

  const showPagination = sortedResults.length > pageSize;

  const handlePreviousPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  const handlePageClick = (page: number) => {
    setCurrentPage(page);
  };

  const getPageNumbers = (): number[] => {
    const pages: number[] = [];
    const maxVisiblePages = 7;

    if (totalPages <= maxVisiblePages) {
      for (let i = 0; i < totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(0);

      let start = Math.max(1, currentPage - 2);
      let end = Math.min(totalPages - 2, currentPage + 2);

      if (currentPage <= 3) {
        end = 5;
      } else if (currentPage >= totalPages - 4) {
        start = totalPages - 6;
      }

      if (start > 1) {
        pages.push(-1);
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (end < totalPages - 2) {
        pages.push(-1);
      }

      pages.push(totalPages - 1);
    }

    return pages;
  };

  if (results.length === 0) {
    return (
      <div className="sparql-no-results">
        no results found
      </div>
    );
  }

  return (
    <div className="sparql-table-view">
      <table className="sparql-results-table">
        <thead>
          <tr>
            {variables.map((variable) => (
              <th
                key={variable}
                onClick={() => handleSort(variable)}
                className="sortable"
                style={{ cursor: "pointer" }}
              >
                ?{variable}{" "}
                {sortState.column === variable &&
                  (sortState.order === "asc" ? "▲" : "▼")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paginatedResults.map((result, index) => (
            <tr key={`row-${currentPage}-${index}`}>
              {variables.map((variable) => {
                const value = result.get(variable)?.toString();
                return (
                  <td key={`${currentPage}-${index}-${variable}`}>
                    {renderValue(value, onAssetClick, getAssetLabel)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {showPagination && (
        <div className="sparql-pagination">
          <div className="pagination-info">
            <small>
              showing {currentPage * pageSize + 1}–
              {Math.min((currentPage + 1) * pageSize, sortedResults.length)} of{" "}
              {sortedResults.length} results
            </small>
          </div>
          <div className="pagination-controls">
            <button
              onClick={handlePreviousPage}
              disabled={currentPage === 0}
              className="pagination-button"
            >
              ‹
            </button>

            {getPageNumbers().map((page, idx) => {
              if (page === -1) {
                return (
                  <span key={`ellipsis-${idx}`} className="pagination-ellipsis">
                    …
                  </span>
                );
              }
              return (
                <button
                  key={page}
                  onClick={() => handlePageClick(page)}
                  className={`pagination-button ${page === currentPage ? "active" : ""}`}
                >
                  {page + 1}
                </button>
              );
            })}

            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages - 1}
              className="pagination-button"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
