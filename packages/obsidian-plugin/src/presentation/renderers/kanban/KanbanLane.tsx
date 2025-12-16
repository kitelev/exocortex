/**
 * KanbanLane Component
 *
 * Renders a single lane (column) in the Kanban board.
 * Supports collapsing, drag-and-drop target, and card count display.
 *
 * @module presentation/renderers/kanban
 * @since 1.0.0
 */
import React from "react";

import type { KanbanLaneProps } from "./types";
import { KanbanCard } from "./KanbanCard";

/**
 * KanbanLane - Renders a single Kanban lane
 *
 * Features:
 * - Lane header with title and card count
 * - Collapsible lane body
 * - Drag-and-drop target for cards
 * - Optional max cards display with "show more"
 */
export const KanbanLane: React.FC<KanbanLaneProps> = ({
  lane,
  cards,
  columns = [],
  isDropTarget = true,
  isDragOver = false,
  onToggle,
  onCardLinkClick,
  options = {},
  onDragOver,
  onDragLeave,
  onDrop,
  onCardDragStart,
}) => {
  const {
    collapsible = true,
    maxCardsPerLane,
    showCount = true,
  } = options;

  // Determine which cards to show
  const visibleCards = maxCardsPerLane
    ? cards.slice(0, maxCardsPerLane)
    : cards;
  const hiddenCount = maxCardsPerLane
    ? Math.max(0, cards.length - maxCardsPerLane)
    : 0;

  const handleHeaderClick = () => {
    if (collapsible && onToggle) {
      onToggle(!lane.collapsed);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!isDropTarget) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onDragOver?.(event);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    onDragLeave?.(event);
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!isDropTarget) return;
    event.preventDefault();
    onDrop?.(event);
  };

  const handleCardDragStart = (cardId: string, event: React.DragEvent) => {
    onCardDragStart?.(cardId, event);
  };

  return (
    <div
      className={`exo-kanban-lane ${lane.collapsed ? "exo-kanban-lane-collapsed" : ""} ${isDragOver ? "exo-kanban-lane-drag-over" : ""}`}
      data-lane-id={lane.id}
      style={lane.color ? { "--lane-color": lane.color } as React.CSSProperties : undefined}
    >
      {/* Lane Header */}
      <div
        className={`exo-kanban-lane-header ${collapsible ? "exo-kanban-lane-header-collapsible" : ""}`}
        onClick={handleHeaderClick}
      >
        <div className="exo-kanban-lane-title">
          {collapsible && (
            <span className="exo-kanban-lane-chevron">
              {lane.collapsed ? "▸" : "▾"}
            </span>
          )}
          <span className="exo-kanban-lane-label">{lane.label}</span>
        </div>
        {showCount && (
          <span className="exo-kanban-lane-count">{cards.length}</span>
        )}
      </div>

      {/* Lane Body */}
      {!lane.collapsed && (
        <div
          className="exo-kanban-lane-body"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {visibleCards.length === 0 ? (
            <div className="exo-kanban-lane-empty">
              <span className="exo-kanban-lane-empty-text">No items</span>
            </div>
          ) : (
            <>
              {visibleCards.map((card) => (
                <KanbanCard
                  key={card.id}
                  card={card}
                  columns={columns}
                  isDraggable={isDropTarget}
                  onLinkClick={onCardLinkClick}
                  onDragStart={(event) => handleCardDragStart(card.id, event)}
                />
              ))}
              {hiddenCount > 0 && (
                <div className="exo-kanban-lane-more">
                  <span className="exo-kanban-lane-more-text">
                    +{hiddenCount} more
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default KanbanLane;
