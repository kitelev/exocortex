/**
 * KanbanLane Unit Tests
 *
 * Tests for the KanbanLane component.
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

import { KanbanLane } from "@plugin/presentation/renderers/kanban/KanbanLane";
import type {
  KanbanLane as KanbanLaneType,
  KanbanCard,
} from "@plugin/presentation/renderers/kanban/types";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("KanbanLane", () => {
  const createColumn = (overrides: Partial<LayoutColumn> = {}): LayoutColumn => ({
    uid: "col-1",
    label: "Label",
    property: "[[exo__Asset_label]]",
    header: "Name",
    width: "auto",
    renderer: "text",
    editable: false,
    sortable: true,
    ...overrides,
  });

  const createLane = (overrides: Partial<KanbanLaneType> = {}): KanbanLaneType => ({
    id: "lane-1",
    label: "Test Lane",
    collapsed: false,
    ...overrides,
  });

  const createCard = (overrides: Partial<KanbanCard> = {}): KanbanCard => ({
    id: "card-1",
    path: "/path/to/asset.md",
    metadata: {},
    values: { "col-1": "Test Card" },
    laneId: "lane-1",
    ...overrides,
  });

  describe("Basic Rendering", () => {
    it("renders lane with header", () => {
      const lane = createLane({ label: "To Do" });
      const cards: KanbanCard[] = [];

      render(<KanbanLane lane={lane} cards={cards} />);

      expect(screen.getByText("To Do")).toBeInTheDocument();
    });

    it("renders cards in lane", () => {
      const lane = createLane();
      const cards = [
        createCard({ id: "card-1", values: { "col-1": "Task 1" } }),
        createCard({ id: "card-2", values: { "col-1": "Task 2" } }),
      ];
      const columns = [createColumn()];

      render(<KanbanLane lane={lane} cards={cards} columns={columns} />);

      expect(screen.getByText("Task 1")).toBeInTheDocument();
      expect(screen.getByText("Task 2")).toBeInTheDocument();
    });

    it("shows card count by default", () => {
      const lane = createLane();
      const cards = [
        createCard({ id: "card-1" }),
        createCard({ id: "card-2" }),
        createCard({ id: "card-3" }),
      ];

      render(<KanbanLane lane={lane} cards={cards} />);

      expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("hides card count when showCount is false", () => {
      const lane = createLane();
      const cards = [createCard()];

      const { container } = render(
        <KanbanLane
          lane={lane}
          cards={cards}
          options={{ showCount: false }}
        />
      );

      const countBadge = container.querySelector(".exo-kanban-lane-count");
      expect(countBadge).not.toBeInTheDocument();
    });
  });

  describe("Empty State", () => {
    it("shows empty placeholder when no cards", () => {
      const lane = createLane();
      const cards: KanbanCard[] = [];

      render(<KanbanLane lane={lane} cards={cards} />);

      expect(screen.getByText(/no items/i)).toBeInTheDocument();
    });
  });

  describe("Collapse Behavior", () => {
    it("renders collapsed lane without body", () => {
      const lane = createLane({ collapsed: true });
      const cards = [createCard({ values: { "col-1": "Hidden Card" } })];
      const columns = [createColumn()];

      render(<KanbanLane lane={lane} cards={cards} columns={columns} />);

      expect(screen.queryByText("Hidden Card")).not.toBeInTheDocument();
    });

    it("calls onToggle when header is clicked", () => {
      const onToggle = jest.fn();
      const lane = createLane();
      const cards: KanbanCard[] = [];

      render(
        <KanbanLane
          lane={lane}
          cards={cards}
          onToggle={onToggle}
        />
      );

      const header = screen.getByText("Test Lane");
      fireEvent.click(header);

      expect(onToggle).toHaveBeenCalledWith(true); // Toggle to collapsed
    });

    it("does not call onToggle when collapsible is false", () => {
      const onToggle = jest.fn();
      const lane = createLane();
      const cards: KanbanCard[] = [];

      render(
        <KanbanLane
          lane={lane}
          cards={cards}
          onToggle={onToggle}
          options={{ collapsible: false }}
        />
      );

      const header = screen.getByText("Test Lane");
      fireEvent.click(header);

      expect(onToggle).not.toHaveBeenCalled();
    });

    it("shows chevron for collapsible lanes", () => {
      const lane = createLane();
      const cards: KanbanCard[] = [];

      const { container } = render(
        <KanbanLane lane={lane} cards={cards} />
      );

      const chevron = container.querySelector(".exo-kanban-lane-chevron");
      expect(chevron).toBeInTheDocument();
      expect(chevron).toHaveTextContent("▾"); // Expanded chevron
    });

    it("shows collapsed chevron when lane is collapsed", () => {
      const lane = createLane({ collapsed: true });
      const cards: KanbanCard[] = [];

      const { container } = render(
        <KanbanLane lane={lane} cards={cards} />
      );

      const chevron = container.querySelector(".exo-kanban-lane-chevron");
      expect(chevron).toHaveTextContent("▸"); // Collapsed chevron
    });
  });

  describe("Max Cards Per Lane", () => {
    it("limits visible cards to maxCardsPerLane", () => {
      const lane = createLane();
      const cards = Array.from({ length: 5 }, (_, i) =>
        createCard({
          id: `card-${i}`,
          values: { "col-1": `Card ${i}` },
        })
      );
      const columns = [createColumn()];

      render(
        <KanbanLane
          lane={lane}
          cards={cards}
          columns={columns}
          options={{ maxCardsPerLane: 3 }}
        />
      );

      expect(screen.getByText("Card 0")).toBeInTheDocument();
      expect(screen.getByText("Card 1")).toBeInTheDocument();
      expect(screen.getByText("Card 2")).toBeInTheDocument();
      expect(screen.queryByText("Card 3")).not.toBeInTheDocument();
      expect(screen.queryByText("Card 4")).not.toBeInTheDocument();
    });

    it("shows '+N more' when cards are hidden", () => {
      const lane = createLane();
      const cards = Array.from({ length: 5 }, (_, i) =>
        createCard({ id: `card-${i}` })
      );

      render(
        <KanbanLane
          lane={lane}
          cards={cards}
          options={{ maxCardsPerLane: 3 }}
        />
      );

      expect(screen.getByText("+2 more")).toBeInTheDocument();
    });
  });

  describe("Drag and Drop Target", () => {
    it("applies drag-over class when isDragOver is true", () => {
      const lane = createLane();
      const cards: KanbanCard[] = [];

      const { container } = render(
        <KanbanLane lane={lane} cards={cards} isDragOver={true} />
      );

      const laneElement = container.querySelector(".exo-kanban-lane");
      expect(laneElement).toHaveClass("exo-kanban-lane-drag-over");
    });

    it("calls onDragOver handler", () => {
      const onDragOver = jest.fn();
      const lane = createLane();
      const cards: KanbanCard[] = [];

      const { container } = render(
        <KanbanLane
          lane={lane}
          cards={cards}
          onDragOver={onDragOver}
        />
      );

      const laneBody = container.querySelector(".exo-kanban-lane-body");
      const dataTransfer = { dropEffect: "" };
      fireEvent.dragOver(laneBody!, { dataTransfer });

      expect(onDragOver).toHaveBeenCalled();
    });

    it("calls onDrop handler", () => {
      const onDrop = jest.fn();
      const lane = createLane();
      const cards: KanbanCard[] = [];

      const { container } = render(
        <KanbanLane
          lane={lane}
          cards={cards}
          onDrop={onDrop}
        />
      );

      const laneBody = container.querySelector(".exo-kanban-lane-body");
      fireEvent.drop(laneBody!, { preventDefault: jest.fn() });

      expect(onDrop).toHaveBeenCalled();
    });

    it("does not handle drag events when isDropTarget is false", () => {
      const onDragOver = jest.fn();
      const onDrop = jest.fn();
      const lane = createLane();
      const cards: KanbanCard[] = [];

      const { container } = render(
        <KanbanLane
          lane={lane}
          cards={cards}
          isDropTarget={false}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
      );

      const laneBody = container.querySelector(".exo-kanban-lane-body");
      const dataTransfer = { dropEffect: "" };
      fireEvent.dragOver(laneBody!, { dataTransfer });
      fireEvent.drop(laneBody!);

      expect(onDragOver).not.toHaveBeenCalled();
      expect(onDrop).not.toHaveBeenCalled();
    });
  });

  describe("Data Attributes", () => {
    it("includes data-lane-id attribute", () => {
      const lane = createLane({ id: "unique-lane-123" });
      const cards: KanbanCard[] = [];

      const { container } = render(<KanbanLane lane={lane} cards={cards} />);

      const laneElement = container.querySelector(".exo-kanban-lane");
      expect(laneElement).toHaveAttribute("data-lane-id", "unique-lane-123");
    });
  });

  describe("Lane Color", () => {
    it("applies custom lane color via CSS variable", () => {
      const lane = createLane({ color: "#ff0000" });
      const cards: KanbanCard[] = [];

      const { container } = render(<KanbanLane lane={lane} cards={cards} />);

      const laneElement = container.querySelector(".exo-kanban-lane");
      expect(laneElement).toHaveStyle({ "--lane-color": "#ff0000" });
    });
  });
});
