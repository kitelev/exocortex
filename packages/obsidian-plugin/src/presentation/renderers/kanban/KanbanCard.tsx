/**
 * KanbanCard Component
 *
 * Renders a single card in the Kanban board.
 * Supports drag-and-drop and displays card content based on columns.
 *
 * @module presentation/renderers/kanban
 * @since 1.0.0
 */
import React from "react";

import type { KanbanCardProps } from "./types";
import { getCellRenderer } from "../cell-renderers";

/**
 * KanbanCard - Renders a single Kanban card
 *
 * Features:
 * - Displays card title from values
 * - Shows additional column data
 * - Draggable with HTML5 Drag and Drop API
 * - Link click navigation
 */
export const KanbanCard: React.FC<KanbanCardProps> = ({
  card,
  columns = [],
  isDraggable = true,
  isDragging = false,
  onLinkClick,
  onDragStart,
  onDragEnd,
}) => {
  // Get primary display value (first column or asset label)
  const primaryColumn = columns[0];
  const primaryValue = primaryColumn
    ? card.values[primaryColumn.uid]
    : card.values["label"] || card.id;

  // Additional columns (excluding the first)
  const additionalColumns = columns.slice(1);

  const handleDragStart = (event: React.DragEvent) => {
    if (!isDraggable) return;

    // Set drag data
    event.dataTransfer.setData("text/plain", card.id);
    event.dataTransfer.setData("application/json", JSON.stringify({
      cardId: card.id,
      sourceLaneId: card.laneId,
    }));
    event.dataTransfer.effectAllowed = "move";

    onDragStart?.(event);
  };

  const handleDragEnd = (event: React.DragEvent) => {
    onDragEnd?.(event);
  };

  const handleCardClick = (event: React.MouseEvent) => {
    // Navigate to card file on click (if not dragging)
    if (!isDragging && onLinkClick && card.path) {
      onLinkClick(card.path, event);
    }
  };

  return (
    <div
      className={`exo-kanban-card ${isDragging ? "exo-kanban-card-dragging" : ""} ${isDraggable ? "exo-kanban-card-draggable" : ""}`}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleCardClick}
      data-card-id={card.id}
      data-path={card.path}
    >
      {/* Card Header - Primary Value */}
      <div className="exo-kanban-card-header">
        {primaryColumn ? (
          <CardCellRenderer
            value={primaryValue}
            column={primaryColumn}
            assetPath={card.path}
            onLinkClick={onLinkClick}
          />
        ) : (
          <span className="exo-kanban-card-title">{String(primaryValue)}</span>
        )}
      </div>

      {/* Card Body - Additional Columns */}
      {additionalColumns.length > 0 && (
        <div className="exo-kanban-card-body">
          {additionalColumns.map((column) => {
            const value = card.values[column.uid];
            if (value === null || value === undefined || value === "") {
              return null;
            }

            return (
              <div
                key={column.uid}
                className={`exo-kanban-card-field exo-kanban-card-field-${column.renderer || "text"}`}
              >
                {column.header && (
                  <span className="exo-kanban-card-field-label">
                    {column.header}:
                  </span>
                )}
                <CardCellRenderer
                  value={value}
                  column={column}
                  assetPath={card.path}
                  onLinkClick={onLinkClick}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * CardCellRenderer - Renders a cell value within a card
 */
interface CardCellRendererProps {
  value: unknown;
  column: { uid: string; renderer?: string; header?: string; property: string };
  assetPath?: string;
  onLinkClick?: (path: string, event: React.MouseEvent) => void;
}

const CardCellRenderer: React.FC<CardCellRendererProps> = ({
  value,
  column,
  assetPath,
  onLinkClick,
}) => {
  const CellRenderer = getCellRenderer(column.renderer as import("../cell-renderers").ColumnRenderer);

  return (
    <span className="exo-kanban-card-value">
      <CellRenderer
        value={value as import("../cell-renderers").CellValue}
        column={column as import("../../../domain/layout").LayoutColumn}
        assetPath={assetPath}
        onLinkClick={onLinkClick}
      />
    </span>
  );
};

export default KanbanCard;
