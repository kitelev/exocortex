/**
 * KanbanLayoutRenderer Component
 *
 * Renders a KanbanLayout definition as an interactive Kanban board with:
 * - Lanes grouped by laneProperty values
 * - Draggable cards with HTML5 Drag and Drop API
 * - Collapsible lanes
 * - Card content from column definitions
 * - CSS styles following Obsidian theme
 *
 * @module presentation/renderers/kanban
 * @since 1.0.0
 */
import React, { useState, useMemo, useCallback } from "react";

import type {
  KanbanLayoutRendererProps,
  KanbanCard,
  KanbanLane,
  KanbanLayoutOptions,
} from "./types";
import { extractLabelFromWikilink } from "./types";
import { KanbanLane as KanbanLaneComponent } from "./KanbanLane";

/**
 * Default Kanban layout options
 */
const defaultOptions: KanbanLayoutOptions = {
  draggable: true,
  collapsible: true,
  showCount: true,
  laneWidth: "280px",
  cardHeight: "auto",
};

/**
 * KanbanLayoutRenderer - Renders a KanbanLayout as an interactive board
 *
 * @example
 * ```tsx
 * <KanbanLayoutRenderer
 *   layout={kanbanLayout}
 *   cards={cards}
 *   onCardMove={(cardId, property, newValue) => {
 *     // Update card's lane property via SPARQL UPDATE
 *   }}
 * />
 * ```
 */
export const KanbanLayoutRenderer: React.FC<KanbanLayoutRendererProps> = ({
  layout,
  cards,
  lanes: propLanes,
  onCardMove,
  onLinkClick,
  onCellChange: _onCellChange, // Reserved for future inline editing
  onLaneToggle,
  options: propOptions,
  className,
}) => {
  const options = { ...defaultOptions, ...propOptions };

  // Track collapsed lanes
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());

  // Track currently dragged card
  const [dragState, setDragState] = useState<{
    cardId: string | null;
    sourceLaneId: string | null;
  }>({ cardId: null, sourceLaneId: null });

  // Track which lane is being hovered during drag
  const [dragOverLaneId, setDragOverLaneId] = useState<string | null>(null);

  /**
   * Derive lanes from data or use explicit lanes
   */
  const lanes: KanbanLane[] = useMemo(() => {
    if (propLanes && propLanes.length > 0) {
      // Use provided lanes, adding collapsed state
      return propLanes.map((lane) => ({
        ...lane,
        collapsed: collapsedLanes.has(lane.id),
      }));
    }

    // Derive lanes from layout.lanes or card data
    const laneSet = new Set<string>();

    // First add explicit lanes from layout in order
    if (layout.lanes && layout.lanes.length > 0) {
      for (const laneDef of layout.lanes) {
        laneSet.add(laneDef);
      }
    }

    // Then add any lanes found in card data that aren't in explicit list
    for (const card of cards) {
      if (card.laneId && !laneSet.has(card.laneId)) {
        laneSet.add(card.laneId);
      }
    }

    // Convert to KanbanLane objects
    const derivedLanes: KanbanLane[] = [];
    let order = 0;

    for (const laneId of laneSet) {
      derivedLanes.push({
        id: laneId,
        label: extractLabelFromWikilink(laneId),
        collapsed: collapsedLanes.has(laneId),
        order: order++,
      });
    }

    return derivedLanes;
  }, [propLanes, layout.lanes, cards, collapsedLanes]);

  /**
   * Group cards by lane
   */
  const cardsByLane = useMemo(() => {
    const grouped = new Map<string, KanbanCard[]>();

    // Initialize all lanes with empty arrays
    for (const lane of lanes) {
      grouped.set(lane.id, []);
    }

    // Group cards into lanes
    for (const card of cards) {
      const laneCards = grouped.get(card.laneId);
      if (laneCards) {
        laneCards.push(card);
      } else {
        // Card belongs to unknown lane - skip or add to first lane
        const firstLane = lanes[0];
        if (firstLane) {
          const firstLaneCards = grouped.get(firstLane.id) || [];
          firstLaneCards.push({ ...card, laneId: firstLane.id });
          grouped.set(firstLane.id, firstLaneCards);
        }
      }
    }

    return grouped;
  }, [cards, lanes]);

  /**
   * Handle lane collapse toggle
   */
  const handleLaneToggle = useCallback(
    (laneId: string, collapsed: boolean) => {
      setCollapsedLanes((prev) => {
        const next = new Set(prev);
        if (collapsed) {
          next.add(laneId);
        } else {
          next.delete(laneId);
        }
        return next;
      });

      onLaneToggle?.(laneId, collapsed);
    },
    [onLaneToggle]
  );

  /**
   * Handle card drag start
   */
  const handleCardDragStart = useCallback(
    (laneId: string, cardId: string, _event: React.DragEvent) => {
      setDragState({ cardId, sourceLaneId: laneId });
    },
    []
  );

  /**
   * Handle drag over lane
   */
  const handleDragOverLane = useCallback(
    (laneId: string, _event: React.DragEvent) => {
      if (dragState.cardId && laneId !== dragOverLaneId) {
        setDragOverLaneId(laneId);
      }
    },
    [dragState.cardId, dragOverLaneId]
  );

  /**
   * Handle drag leave lane
   */
  const handleDragLeaveLane = useCallback(
    (_laneId: string, event: React.DragEvent) => {
      // Only clear if actually leaving the lane (not entering a child)
      const relatedTarget = event.relatedTarget as HTMLElement | null;
      const currentTarget = event.currentTarget as HTMLElement;

      if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
        setDragOverLaneId(null);
      }
    },
    []
  );

  /**
   * Handle card drop on lane
   */
  const handleDropOnLane = useCallback(
    (laneId: string, event: React.DragEvent) => {
      event.preventDefault();
      setDragOverLaneId(null);

      const { cardId, sourceLaneId } = dragState;

      // Reset drag state
      setDragState({ cardId: null, sourceLaneId: null });

      // If dropped on same lane, no-op
      if (!cardId || laneId === sourceLaneId) {
        return;
      }

      // Notify parent of card move
      if (onCardMove) {
        onCardMove(cardId, layout.laneProperty, laneId);
      }
    },
    [dragState, layout.laneProperty, onCardMove]
  );

  /**
   * Handle drag end (cleanup if dropped outside valid target)
   */
  const handleDragEnd = useCallback(() => {
    setDragState({ cardId: null, sourceLaneId: null });
    setDragOverLaneId(null);
  }, []);

  // Empty state
  if (lanes.length === 0) {
    return (
      <div className={`exo-kanban-board exo-kanban-board-empty ${className || ""}`}>
        <div className="exo-kanban-empty-message">
          No lanes defined. Configure lanes in your KanbanLayout or add items with status values.
        </div>
      </div>
    );
  }

  return (
    <div
      className={`exo-kanban-board ${className || ""}`}
      style={{
        "--lane-width": options.laneWidth,
        "--card-height": options.cardHeight,
      } as React.CSSProperties}
      onDragEnd={handleDragEnd}
    >
      <div className="exo-kanban-board-header">
        <h3 className="exo-kanban-board-title">{layout.label}</h3>
        <span className="exo-kanban-board-count">
          {cards.length} item{cards.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="exo-kanban-lanes">
        {lanes.map((lane) => (
          <KanbanLaneComponent
            key={lane.id}
            lane={lane}
            cards={cardsByLane.get(lane.id) || []}
            columns={layout.columns}
            isDropTarget={options.draggable}
            isDragOver={dragOverLaneId === lane.id}
            onToggle={(collapsed) => handleLaneToggle(lane.id, collapsed)}
            onCardLinkClick={onLinkClick}
            options={options}
            onDragOver={(event) => handleDragOverLane(lane.id, event)}
            onDragLeave={(event) => handleDragLeaveLane(lane.id, event)}
            onDrop={(event) => handleDropOnLane(lane.id, event)}
            onCardDragStart={(cardId, event) =>
              handleCardDragStart(lane.id, cardId, event)
            }
          />
        ))}
      </div>
    </div>
  );
};

export default KanbanLayoutRenderer;
