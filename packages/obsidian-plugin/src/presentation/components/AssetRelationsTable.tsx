import React, { useState, useMemo, useRef, useLayoutEffect, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function humanizePropertyName(raw: string): string {
  if (!raw) return raw;
  if (UUID_REGEX.test(raw)) return raw;
  if (!raw.includes("__")) return raw;
  const withoutPrefix = raw.replace(/^[a-z]+__/, "");
  const spaced = withoutPrefix.replace(/_/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

const WHOLE_WIKILINK_REGEX = /^\[\[(.+)\]\]$/;

/**
 * Humanize a frontmatter *value* for display (RFC 0002 §3.7, P11) — the value
 * counterpart of {@link humanizePropertyName} (which humanizes property *keys*).
 *
 * Reuses the same IRI-prefix-stripping mechanism, applied to enum/class
 * *values* so the Properties block reads "Project" instead of
 * `[[ems__Project]]` and "EffortStatusDoing" instead of
 * `[[uid|ems__EffortStatusDoing]]`. Resolution order for wikilink values:
 * explicit alias → resolved `exo__Asset_label` of a UID target (via
 * `resolveLabel`) → the raw target; the chosen display string is then run
 * through {@link humanizePropertyName} to strip the prefix. Non-wikilink,
 * non-jargon values (free text, timestamps, UUIDs, numbers) pass through
 * unchanged because `humanizePropertyName` is a no-op on them.
 *
 * Note: literal per-enum display (e.g. "Doing") is intentionally NOT produced —
 * the live status asset's label is `ems__EffortStatusDoing` and the shared
 * humanizer preserves PascalCase by design; the result is consistent with the
 * relations table. A per-enum display map would be a separate concern.
 */
export function humanizePropertyValue(
  value: unknown,
  resolveLabel?: (target: string) => string | null,
): string {
  if (value === null || value === undefined) return "";

  if (Array.isArray(value)) {
    return value
      .map((v) => humanizePropertyValue(v, resolveLabel))
      .filter((s) => s !== "")
      .join(", ");
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(WHOLE_WIKILINK_REGEX);
    if (match) {
      const content = match[1];
      const pipeIndex = content.indexOf("|");
      const target = (
        pipeIndex === -1 ? content : content.slice(0, pipeIndex)
      ).trim();
      const alias =
        pipeIndex === -1 ? undefined : content.slice(pipeIndex + 1).trim();
      const display = alias || resolveLabel?.(target) || target;
      return humanizePropertyName(display);
    }
    // Plain string: only de-jargon IRI-prefixed values (`ems__Project`);
    // leave free text (which may legitimately contain "__") untouched.
    if (/^[a-z]+__/.test(trimmed)) {
      return humanizePropertyName(trimmed);
    }
    return trimmed;
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

export interface AssetRelation {
  path: string;
  title: string;
  propertyName?: string;
  isBodyLink: boolean;
  created: number;
  modified: number;
  isArchived?: boolean;
  isBlocked?: boolean;

  metadata: Record<string, unknown>;
}

export interface AssetRelationsTableProps {
  relations: AssetRelation[];
  groupByProperty?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  showProperties?: string[];
  groupSpecificProperties?: Record<string, string[]>;
  onAssetClick?: (path: string, event: React.MouseEvent) => void;
  getAssetLabel?: (path: string) => string | null;
  /**
   * RFC-024 Phase 1 AC5 — returns the visual accent colour (a CSS var or
   * literal) for the given Instance-class reference, or `null` when no
   * accent applies. Bare class names (`ems__Task`) are expected; the alias
   * form is stripped upstream.
   */
  resolveAccent?: (classRef: string) => string | null;
}

interface SortState {
  column: string;
  order: "asc" | "desc";
}

interface SingleTableProps {
  items: AssetRelation[];
  sortBy: string;
  sortOrder: "asc" | "desc";
  showProperties: string[];
  onAssetClick?: (path: string, event: React.MouseEvent) => void;
  getAssetLabel?: (path: string) => string | null;
  resolveAccent?: (classRef: string) => string | null;
}

const SingleTable: React.FC<SingleTableProps> = ({
  items,
  sortBy,
  sortOrder,
  showProperties,
  onAssetClick,
  getAssetLabel,
  resolveAccent,
}) => {
  const [sortState, setSortState] = useState<SortState>({
    column: sortBy,
    order: sortOrder,
  });

  const handleSort = (column: string) => {
    setSortState((prev) => ({
      column,
      order: prev.column === column && prev.order === "asc" ? "desc" : "asc",
    }));
  };

  const parseInstanceClassValue = (value: unknown): WikiLink => {
    if (!value || value === "-") {
      return { target: "-" };
    }

    const content = String(value).replace(/^\[\[|\]\]$/g, "");
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

  const getInstanceClasses = (metadata: Record<string, unknown>): WikiLink[] => {
    const instanceClassRaw = metadata?.exo__Instance_class;

    if (!instanceClassRaw) {
      return [{ target: "-" }];
    }

    if (Array.isArray(instanceClassRaw)) {
      if (instanceClassRaw.length === 0) {
        return [{ target: "-" }];
      }
      return instanceClassRaw.map(parseInstanceClassValue);
    }

    return [parseInstanceClassValue(instanceClassRaw)];
  };

  // Backward compatibility - returns first instance class for sorting
  const getInstanceClass = (metadata: Record<string, unknown>): WikiLink => {
    return getInstanceClasses(metadata)[0];
  };

  const getDisplayLabel = (relation: AssetRelation): string => {
    const blockerIcon = relation.isBlocked ? "🚩 " : "";
    const label = relation.metadata?.exo__Asset_label;
    if (label && typeof label === "string" && label.trim() !== "") {
      return blockerIcon + label;
    }
    return blockerIcon + relation.title;
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

  const renderPropertyValue = (value: unknown): React.ReactNode => {
    if (value === null || value === undefined) {
      return "-";
    }

    if (typeof value === "string" && isWikiLink(value)) {
      const parsed = parseWikiLink(value);
      const label = getAssetLabel?.(parsed.target);
      const displayText = parsed.alias
        ? humanizePropertyName(parsed.alias)
        : label || humanizePropertyName(parsed.target);

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

    if (Array.isArray(value)) {
      return value.map((item, index) => (
        <React.Fragment key={index}>
          {renderPropertyValue(item)}
          {index < value.length - 1 ? ", " : ""}
        </React.Fragment>
      ));
    }

    return String(value);
  };

  const normalizeMetadataValue = (value: unknown): string | number => {
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
      return value.length > 0 ? normalizeMetadataValue(value[0]) : "";
    }

    if (typeof value === "object") {
      return JSON.stringify(value).toLowerCase();
    }

    return String(value).toLowerCase();
  };

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      if (sortState.column === "title") {
        aVal = getDisplayLabel(a).toLowerCase();
        bVal = getDisplayLabel(b).toLowerCase();
      } else if (sortState.column === "exo__Instance_class") {
        const aClass = getInstanceClass(a.metadata);
        const bClass = getInstanceClass(b.metadata);
        aVal = (aClass.alias || aClass.target).toLowerCase();
        bVal = (bClass.alias || bClass.target).toLowerCase();
      } else {
        aVal = normalizeMetadataValue(a.metadata[sortState.column]);
        bVal = normalizeMetadataValue(b.metadata[sortState.column]);
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortState.order === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal);
      const bStr = String(bVal);

      if (aStr < bStr) {
        return sortState.order === "asc" ? -1 : 1;
      }
      if (aStr > bStr) {
        return sortState.order === "asc" ? 1 : -1;
      }

      return 0;
    });
  }, [items, sortState]);

  const ROW_HEIGHT = 35;
  const VIRTUALIZATION_THRESHOLD = 50;
  const parentRef = useRef<HTMLDivElement>(null);

  // Track when parent element is mounted for virtualizer initialization
  const [isParentMounted, setIsParentMounted] = useState(false);

  useLayoutEffect(() => {
    if (parentRef.current && !isParentMounted) {
      setIsParentMounted(true);
    }
  }, [isParentMounted]);

  const shouldVirtualize = sortedItems.length > VIRTUALIZATION_THRESHOLD;

  // Synchronize column widths between header and body tables in virtualized mode
  // This fixes misalignment caused by scrollbar width difference (Issue #941, #2116)
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  // Measure scrollbar width when scroll container is mounted
  const measureWidths = useCallback(() => {
    if (!parentRef.current) return;

    const scrollContainer = parentRef.current;
    // Scrollbar width = total width - client width (visible content area)
    const sbWidth = scrollContainer.offsetWidth - scrollContainer.clientWidth;
    setScrollbarWidth(sbWidth);
  }, []);

  // Measure widths when virtualized mode is active and parent is mounted
  useLayoutEffect(() => {
    if (shouldVirtualize && isParentMounted) {
      measureWidths();
    }
  }, [shouldVirtualize, isParentMounted, measureWidths]);

  // Re-measure on window resize (scrollbar might appear/disappear)
  useEffect(() => {
    if (!shouldVirtualize) return;

    const handleResize = () => measureWidths();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [shouldVirtualize, measureWidths]);

  // Only initialize virtualizer when we need virtualization AND parent is mounted
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? sortedItems.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
    // Enable smooth scrolling and ensure proper initialization
    enabled: shouldVirtualize && isParentMounted,
  });

  const renderInstanceClassCell = (metadata: Record<string, unknown>): React.ReactNode => {
    const instanceClasses = getInstanceClasses(metadata);

    // If only one class and it's the placeholder
    if (instanceClasses.length === 1 && instanceClasses[0].target === "-") {
      return "-";
    }

    return instanceClasses.map((instanceClass, index) => {
      const alias = instanceClass.alias;
      const target = instanceClass.target;
      const resolvedLabel = alias
        ? humanizePropertyName(alias)
        : getAssetLabel?.(target) || humanizePropertyName(target);
      const accent = target !== "-" ? resolveAccent?.(target) ?? null : null;
      const badgeStyle: React.CSSProperties | undefined = accent
        ? {
            borderLeftStyle: "solid",
            borderLeftWidth: "3px",
            borderLeftColor: accent,
            paddingLeft: "6px",
          }
        : undefined;
      return (
        <React.Fragment key={`${target}-${index}`}>
          {target !== "-" ? (
            <span
              className="exocortex-class-badge"
              style={badgeStyle}
              data-class-accent={accent ?? undefined}
            >
              <a
                data-href={target}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAssetClick?.(target, e);
                }}
                className="internal-link"
                style={{ cursor: "pointer" }}
              >
                {resolvedLabel}
              </a>
            </span>
          ) : (
            "-"
          )}
          {index < instanceClasses.length - 1 ? ", " : ""}
        </React.Fragment>
      );
    });
  };

  const renderRow = (relation: AssetRelation, index: number, style?: React.CSSProperties) => {
    const uniqueKey = `${relation.path}-${relation.propertyName || "body"}-${index}`;
    const rowClassName = relation.isArchived ? "archived-asset" : "";

    return (
      <tr
        key={uniqueKey}
        data-path={relation.path}
        className={rowClassName}
        style={style}
      >
        <td className="asset-name">
          <a
            data-href={relation.path}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAssetClick?.(relation.path, e);
            }}
            className="internal-link"
            style={{ cursor: "pointer" }}
          >
            {getDisplayLabel(relation)}
          </a>
        </td>
        <td className="instance-class">
          {renderInstanceClassCell(relation.metadata)}
        </td>
        {showProperties.map((prop) => (
          <td key={prop}>
            {renderPropertyValue(relation.metadata[prop])}
          </td>
        ))}
      </tr>
    );
  };

  // Calculate column widths for fixed table layout
  const baseColumnCount = 2; // Name + Instance_class
  const totalColumns = baseColumnCount + showProperties.length;
  const nameColumnWidth = Math.max(40, 60 - showProperties.length * 10); // Name column gets more space
  const classColumnWidth = 20; // Instance_class fixed width
  const propertyColumnWidth = totalColumns > 2
    ? Math.floor((100 - nameColumnWidth - classColumnWidth) / showProperties.length)
    : 0;

  const renderColGroup = () => (
    <colgroup>
      <col style={{ width: `${nameColumnWidth}%` }} />
      <col style={{ width: `${classColumnWidth}%` }} />
      {showProperties.map((prop) => (
        <col key={prop} style={{ width: `${propertyColumnWidth}%` }} />
      ))}
    </colgroup>
  );

  const renderTableHeader = () => (
    <thead>
      <tr>
        <th onClick={() => handleSort("title")} className="sortable">
          Name{" "}
          {sortState.column === "title" &&
            (sortState.order === "asc" ? "↑" : "↓")}
        </th>
        <th
          onClick={() => handleSort("exo__Instance_class")}
          className="sortable"
        >
          {humanizePropertyName("exo__Instance_class")}{" "}
          {sortState.column === "exo__Instance_class" &&
            (sortState.order === "asc" ? "↑" : "↓")}
        </th>
        {showProperties.map((prop) => (
          <th
            key={prop}
            onClick={() => handleSort(prop)}
            className="sortable"
            style={{ cursor: "pointer" }}
          >
            {humanizePropertyName(prop)}{" "}
            {sortState.column === prop &&
              (sortState.order === "asc" ? "↑" : "↓")}
          </th>
        ))}
      </tr>
    </thead>
  );

  if (!shouldVirtualize) {
    return (
      <table className="exocortex-relations-table" style={{ tableLayout: "fixed", width: "100%" }}>
        {renderColGroup()}
        {renderTableHeader()}
        <tbody>
          {sortedItems.map((relation, index) => renderRow(relation, index))}
        </tbody>
      </table>
    );
  }

  // Get virtual items - may be empty on first render if parentRef is not yet set
  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualizerTotalSize = rowVirtualizer.getTotalSize();

  // Calculate fallback height when virtualizer hasn't initialized yet
  // This ensures content is visible even before the parent ref is mounted
  const totalSize = virtualizerTotalSize > 0
    ? virtualizerTotalSize
    : sortedItems.length * ROW_HEIGHT;

  return (
    <div className="exocortex-relations-virtualized">
      {/* Header wrapper with padding-right to account for scrollbar width (Issue #941, #2116) */}
      <div
        className="exocortex-relations-table-header-wrapper"
        style={{
          paddingRight: scrollbarWidth > 0 ? `${scrollbarWidth}px` : undefined,
        }}
      >
        <table className="exocortex-relations-table exocortex-relations-table-header" style={{ tableLayout: "fixed", width: "100%" }}>
          {renderColGroup()}
          {renderTableHeader()}
        </table>
      </div>
      <div
        ref={parentRef}
        className="exocortex-virtual-scroll-container"
        style={{
          height: "400px",
          overflow: "auto",
        }}
      >
        {/* Wrapper div with total height for scrollbar sizing */}
        <div
          style={{
            height: `${totalSize}px`,
            width: "100%",
            position: "relative",
          }}
        >
          <table
            className="exocortex-relations-table exocortex-virtual-table"
            style={{
              tableLayout: "fixed",
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
            }}
          >
            {renderColGroup()}
            <tbody>
              {virtualItems.length > 0 ? (
                virtualItems.map((virtualRow) => {
                  const relation = sortedItems[virtualRow.index];
                  return renderRow(relation, virtualRow.index, {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  });
                })
              ) : (
                // Fallback: render all rows if virtualizer hasn't initialized yet
                // This handles the case where parentRef is not yet set
                sortedItems.map((relation, index) => renderRow(relation, index))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const AssetRelationsTable: React.FC<AssetRelationsTableProps> = ({
  relations,
  groupByProperty = false,
  sortBy = "title",
  sortOrder = "asc",
  showProperties = [],
  groupSpecificProperties = {},
  onAssetClick,
  getAssetLabel,
  resolveAccent,
}) => {
  // State to track collapsed groups (all expanded by default)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set()
  );

  const groupedRelations = useMemo(() => {
    if (!groupByProperty) {
      return { ungrouped: relations };
    }

    const grouped = relations.reduce(
      (acc, relation) => {
        const group = relation.propertyName || "Body Links";
        if (!acc[group]) acc[group] = [];
        acc[group].push(relation);
        return acc;
      },
      {} as Record<string, AssetRelation[]>,
    );

    return grouped;
  }, [relations, groupByProperty]);

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupName)) {
        newSet.delete(groupName);
      } else {
        newSet.add(groupName);
      }
      return newSet;
    });
  };

  const handleKeyDown = (
    event: React.KeyboardEvent,
    groupName: string
  ) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggleGroup(groupName);
    }
  };

  if (groupByProperty) {
    return (
      <div className="exocortex-relations-grouped">
        {Object.entries(groupedRelations).map(([groupName, items]) => {
          const groupProps = groupSpecificProperties[groupName] || [];
          const mergedProperties = [...showProperties, ...groupProps];
          const isCollapsed = collapsedGroups.has(groupName);

          return (
            <div key={groupName} className="relation-group">
              <div className="relation-group-header">
                <button
                  className="relation-group-toggle"
                  onClick={() => toggleGroup(groupName)}
                  onKeyDown={(e) => handleKeyDown(e, groupName)}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${groupName} relations`}
                  type="button"
                >
                  {isCollapsed ? "▶" : "▼"}
                </button>
                <h3 className="group-header">{humanizePropertyName(groupName)}</h3>
              </div>
              <div
                className="relation-group-content"
                data-collapsed={isCollapsed.toString()}
              >
                {!isCollapsed && (
                  <SingleTable
                    items={items}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    showProperties={mergedProperties}
                    onAssetClick={onAssetClick}
                    getAssetLabel={getAssetLabel}
                    resolveAccent={resolveAccent}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="exocortex-relations">
      <SingleTable
        items={groupedRelations.ungrouped}
        sortBy={sortBy}
        sortOrder={sortOrder}
        showProperties={showProperties}
        onAssetClick={onAssetClick}
        getAssetLabel={getAssetLabel}
        resolveAccent={resolveAccent}
      />
    </div>
  );
};

export interface AssetRelationsTableWithToggleProps
  extends AssetRelationsTableProps {
  showEffortVotes: boolean;
  onToggleEffortVotes: () => void;
  showArchived: boolean;
  onToggleArchived: () => void;
}

export const AssetRelationsTableWithToggle: React.FC<
  AssetRelationsTableWithToggleProps
> = ({ showEffortVotes, onToggleEffortVotes, showArchived, onToggleArchived, showProperties = [], ...props }) => {
  const enhancedShowProperties = showEffortVotes
    ? [...showProperties, "ems__Effort_votes"]
    : showProperties;

  const filteredRelations = showArchived
    ? props.relations
    : props.relations.filter(r => !r.isArchived);

  return (
    <div className="exocortex-relations-wrapper">
      <div className="exocortex-relations-controls">
        <button
          className="exocortex-toggle-effort-votes"
          onClick={onToggleEffortVotes}
          style={{
            marginBottom: "8px",
            marginRight: "8px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showEffortVotes ? "Hide" : "Show"} Votes
        </button>
        <button
          className="exocortex-toggle-archived"
          onClick={onToggleArchived}
          style={{
            marginBottom: "8px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showArchived ? "Hide" : "Show"} Archived
        </button>
      </div>
      <AssetRelationsTable
        {...props}
        relations={filteredRelations}
        showProperties={enhancedShowProperties}
      />
    </div>
  );
};
