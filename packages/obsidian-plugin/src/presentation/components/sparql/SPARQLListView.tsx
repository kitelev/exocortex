import React, { useState, useMemo } from "react";
import type { Triple } from "exocortex";

export interface SPARQLListViewProps {
  triples: Triple[];
  onAssetClick?: (path: string, event: React.MouseEvent) => void;
}

interface WikiLink {
  target: string;
  alias?: string;
}

interface SubjectGroup {
  subject: string;
  subjectType: string;
  predicates: Map<string, string[]>;
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
  value: string,
  onAssetClick?: (path: string, event: React.MouseEvent) => void
): React.ReactNode => {
  if (!value || value === "") {
    return "-";
  }

  if (isWikiLink(value)) {
    const parsed = parseWikiLink(value);
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
        {parsed.alias || parsed.target}
      </a>
    );
  }

  return value;
};

const groupBySubject = (triples: Triple[]): SubjectGroup[] => {
  const groups = new Map<string, SubjectGroup>();

  for (const triple of triples) {
    const subjectStr = triple.subject.toString();
    const predicateStr = triple.predicate.toString();
    const objectStr = triple.object.toString();

    if (!groups.has(subjectStr)) {
      groups.set(subjectStr, {
        subject: subjectStr,
        subjectType: triple.subject.constructor.name,
        predicates: new Map(),
      });
    }

    const group = groups.get(subjectStr)!;

    if (!group.predicates.has(predicateStr)) {
      group.predicates.set(predicateStr, []);
    }

    group.predicates.get(predicateStr)!.push(objectStr);
  }

  return Array.from(groups.values());
};

const formatSubject = (subject: string, type: string): string => {
  if (type === "IRI" && subject.startsWith("<") && subject.endsWith(">")) {
    return subject.slice(1, -1);
  }
  return subject;
};

const formatPredicate = (predicate: string): string => {
  if (predicate.startsWith("<") && predicate.endsWith(">")) {
    const iri = predicate.slice(1, -1);
    const lastSlash = Math.max(iri.lastIndexOf("/"), iri.lastIndexOf("#"));
    if (lastSlash !== -1) {
      return iri.substring(lastSlash + 1);
    }
    return iri;
  }
  return predicate;
};

const formatObject = (object: string): string => {
  if (object.startsWith("<") && object.endsWith(">")) {
    return object.slice(1, -1);
  }
  return object;
};

export const SPARQLListView: React.FC<SPARQLListViewProps> = ({
  triples,
  onAssetClick,
}) => {
  const [viewMode, setViewMode] = useState<"structured" | "raw">("structured");
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupBySubject(triples), [triples]);

  const toggleSubject = (subject: string) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subject)) {
        next.delete(subject);
      } else {
        next.add(subject);
      }
      return next;
    });
  };

  const toggleAllSubjects = () => {
    if (expandedSubjects.size === groups.length) {
      setExpandedSubjects(new Set());
    } else {
      setExpandedSubjects(new Set(groups.map((g) => g.subject)));
    }
  };

  const rawTurtle = useMemo(() => {
    return triples.map((t) => t.toString()).join("\n");
  }, [triples]);

  if (triples.length === 0) {
    return (
      <div className="sparql-no-results">
        no results found
      </div>
    );
  }

  return (
    <div className="sparql-list-view">
      <div className="sparql-list-controls">
        <button
          className={`sparql-view-toggle ${viewMode === "structured" ? "active" : ""}`}
          onClick={() => setViewMode("structured")}
        >
          structured
        </button>
        <button
          className={`sparql-view-toggle ${viewMode === "raw" ? "active" : ""}`}
          onClick={() => setViewMode("raw")}
        >
          raw turtle
        </button>
        {viewMode === "structured" && (
          <button
            className="sparql-expand-toggle"
            onClick={toggleAllSubjects}
          >
            {expandedSubjects.size === groups.length ? "collapse all" : "expand all"}
          </button>
        )}
      </div>

      {viewMode === "structured" ? (
        <div className="sparql-list-structured">
          {groups.map((group) => {
            const isExpanded = expandedSubjects.has(group.subject);
            const formattedSubject = formatSubject(group.subject, group.subjectType);
            const displaySubject = renderValue(formattedSubject, onAssetClick);

            return (
              <div key={group.subject} className="sparql-subject-group">
                <div
                  className="sparql-subject-header"
                  onClick={() => toggleSubject(group.subject)}
                  style={{ cursor: "pointer" }}
                >
                  <span className="sparql-expand-icon">
                    {isExpanded ? "▼" : "▶"}
                  </span>
                  <span className="sparql-subject-icon">📄</span>
                  <span className="sparql-subject-name">{displaySubject}</span>
                  <span className="sparql-subject-type">
                    ({group.subjectType})
                  </span>
                </div>

                {isExpanded && (
                  <div className="sparql-predicates-list">
                    {Array.from(group.predicates.entries()).map(([predicate, objects]) => (
                      <div key={predicate} className="sparql-predicate-row">
                        <span className="sparql-predicate-name">
                          {formatPredicate(predicate)}:
                        </span>
                        <div className="sparql-objects-list">
                          {objects.map((obj, idx) => (
                            <div key={idx} className="sparql-object-item">
                              {renderValue(formatObject(obj), onAssetClick)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sparql-list-raw">
          <pre className="sparql-turtle-syntax">{rawTurtle}</pre>
        </div>
      )}

      <div className="sparql-list-info">
        <small>
          {groups.length} subject{groups.length !== 1 ? "s" : ""}, {triples.length} triple{triples.length !== 1 ? "s" : ""}
        </small>
      </div>
    </div>
  );
};
