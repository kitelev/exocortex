/**
 * KanbanLayoutRenderer Unit Tests
 *
 * Tests for the KanbanLayoutRenderer component including:
 * - Basic rendering
 * - Lane rendering from layout
 * - Card grouping by lane
 * - Empty state handling
 * - Lane collapse functionality
 * - Drag and drop behavior
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

import { KanbanLayoutRenderer } from "@plugin/presentation/renderers/kanban/KanbanLayoutRenderer";
import type {
  KanbanCard,
  KanbanLane,
} from "@plugin/presentation/renderers/kanban/types";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("KanbanLayoutRenderer", () => {
  // Test fixtures
  const createColumn = (overrides: Partial<LayoutColumn> = {}): LayoutColumn => ({
    uid: "col-1",
    label: "Test Column",
    property: "[[exo__Asset_label]]",
    header: "Name",
    width: "auto",
    renderer: "text",
    editable: false,
    sortable: true,
    ...overrides,
  });

  const createLayout = (overrides: Partial<Parameters<typeof KanbanLayoutRenderer>[0]["layout"]> = {}) => ({
    uid: "kanban-1",
    label: "Test Kanban",
    laneProperty: "[[ems__Effort_status]]",
    lanes: ["[[todo]]", "[[doing]]", "[[done]]"],
    columns: [createColumn()],
    ...overrides,
  });

  const createCard = (overrides: Partial<KanbanCard> = {}): KanbanCard => ({
    id: "card-1",
    path: "/path/to/asset.md",
    metadata: {},
    values: { "col-1": "Test Card" },
    laneId: "[[todo]]",
    ...overrides,
  });

  describe("Basic Rendering", () => {
    it("renders a kanban board with header", () => {
      const layout = createLayout();
      const cards = [createCard()];

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
        />
      );

      expect(screen.getByText("Test Kanban")).toBeInTheDocument();
      expect(screen.getByText("1 item")).toBeInTheDocument();
    });

    it("renders lanes from layout definition", () => {
      const layout = createLayout({
        lanes: ["[[todo]]", "[[doing]]", "[[done]]"],
      });
      const cards: KanbanCard[] = [];

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
        />
      );

      expect(screen.getByText("todo")).toBeInTheDocument();
      expect(screen.getByText("doing")).toBeInTheDocument();
      expect(screen.getByText("done")).toBeInTheDocument();
    });

    it("renders cards in correct lanes", () => {
      const layout = createLayout();
      const cards = [
        createCard({ id: "card-1", laneId: "[[todo]]", values: { "col-1": "Task 1" } }),
        createCard({ id: "card-2", laneId: "[[doing]]", values: { "col-1": "Task 2" } }),
        createCard({ id: "card-3", laneId: "[[done]]", values: { "col-1": "Task 3" } }),
      ];

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
        />
      );

      expect(screen.getByText("Task 1")).toBeInTheDocument();
      expect(screen.getByText("Task 2")).toBeInTheDocument();
      expect(screen.getByText("Task 3")).toBeInTheDocument();
    });

    it("displays correct card count per lane", () => {
      const layout = createLayout();
      const cards = [
        createCard({ id: "card-1", laneId: "[[todo]]" }),
        createCard({ id: "card-2", laneId: "[[todo]]" }),
        createCard({ id: "card-3", laneId: "[[doing]]" }),
      ];

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
        />
      );

      // Lane counts should be displayed
      const counts = screen.getAllByText(/^[0-3]$/);
      expect(counts.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Empty State", () => {
    it("renders empty message when no lanes defined", () => {
      const layout = createLayout({ lanes: [] });
      const cards: KanbanCard[] = [];

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
        />
      );

      expect(screen.getByText(/no lanes defined/i)).toBeInTheDocument();
    });

    it("renders empty lane placeholder", () => {
      const layout = createLayout();
      const cards: KanbanCard[] = [];

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
        />
      );

      const emptyMessages = screen.getAllByText(/no items/i);
      expect(emptyMessages.length).toBe(3); // One for each lane
    });
  });

  describe("Lane Collapse", () => {
    it("toggles lane collapse on header click", () => {
      const layout = createLayout();
      const cards = [createCard()];

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
        />
      );

      // Find the lane header for "todo"
      const laneHeaders = screen.getAllByText("todo");
      const laneHeader = laneHeaders[0];

      // Cards should be visible initially
      expect(screen.getByText("Test Card")).toBeInTheDocument();

      // Click to collapse
      fireEvent.click(laneHeader);

      // Card should be hidden in collapsed lane
      expect(screen.queryByText("Test Card")).not.toBeInTheDocument();
    });

    it("calls onLaneToggle handler when lane is toggled", () => {
      const onLaneToggle = jest.fn();
      const layout = createLayout();
      const cards: KanbanCard[] = [];

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
          onLaneToggle={onLaneToggle}
        />
      );

      // Click lane header to toggle
      const laneHeader = screen.getAllByText("todo")[0];
      fireEvent.click(laneHeader);

      expect(onLaneToggle).toHaveBeenCalledWith("[[todo]]", true);
    });
  });

  describe("Drag and Drop", () => {
    it("calls onCardMove when card is dropped on new lane", () => {
      const onCardMove = jest.fn();
      const layout = createLayout();
      const cards = [createCard({ id: "card-1", laneId: "[[todo]]" })];

      const { container } = render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
          onCardMove={onCardMove}
        />
      );

      // Find card and target lane
      const card = container.querySelector('[data-card-id="card-1"]');
      const lanes = container.querySelectorAll(".exo-kanban-lane-body");
      const targetLane = lanes[1]; // "doing" lane

      // Simulate drag start
      fireEvent.dragStart(card!, {
        dataTransfer: {
          setData: jest.fn(),
          effectAllowed: "move",
        },
      });

      // Simulate drag over target lane
      fireEvent.dragOver(targetLane, {
        preventDefault: jest.fn(),
        dataTransfer: { dropEffect: "move" },
      });

      // Simulate drop
      fireEvent.drop(targetLane, {
        preventDefault: jest.fn(),
      });

      expect(onCardMove).toHaveBeenCalledWith(
        "card-1",
        "[[ems__Effort_status]]",
        "[[doing]]"
      );
    });

    it("does not call onCardMove when dropped on same lane", () => {
      const onCardMove = jest.fn();
      const layout = createLayout();
      const cards = [createCard({ id: "card-1", laneId: "[[todo]]" })];

      const { container } = render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
          onCardMove={onCardMove}
        />
      );

      // Find card and source lane
      const card = container.querySelector('[data-card-id="card-1"]');
      const lanes = container.querySelectorAll(".exo-kanban-lane-body");
      const sourceLane = lanes[0]; // "todo" lane (same as card)

      // Simulate drag start
      fireEvent.dragStart(card!, {
        dataTransfer: {
          setData: jest.fn(),
          effectAllowed: "move",
        },
      });

      // Simulate drop on same lane
      fireEvent.drop(sourceLane, {
        preventDefault: jest.fn(),
      });

      expect(onCardMove).not.toHaveBeenCalled();
    });
  });

  describe("Custom className", () => {
    it("applies custom className to container", () => {
      const layout = createLayout();
      const cards: KanbanCard[] = [];

      const { container } = render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
          lanes={[
            { id: "[[todo]]", label: "To Do" },
          ]}
          className="custom-class"
        />
      );

      expect(container.firstChild).toHaveClass("custom-class");
    });
  });

  describe("Lane Options", () => {
    it("respects maxCardsPerLane option", () => {
      const layout = createLayout();
      const cards = Array.from({ length: 5 }, (_, i) =>
        createCard({
          id: `card-${i}`,
          laneId: "[[todo]]",
          values: { "col-1": `Card ${i}` },
        })
      );

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
          options={{ maxCardsPerLane: 3 }}
        />
      );

      // Should show first 3 cards
      expect(screen.getByText("Card 0")).toBeInTheDocument();
      expect(screen.getByText("Card 1")).toBeInTheDocument();
      expect(screen.getByText("Card 2")).toBeInTheDocument();

      // Should not show card 3 and 4
      expect(screen.queryByText("Card 3")).not.toBeInTheDocument();
      expect(screen.queryByText("Card 4")).not.toBeInTheDocument();

      // Should show "+2 more"
      expect(screen.getByText("+2 more")).toBeInTheDocument();
    });

    it("respects collapsible option", () => {
      const onLaneToggle = jest.fn();
      const layout = createLayout();
      const cards: KanbanCard[] = [];

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
          onLaneToggle={onLaneToggle}
          options={{ collapsible: false }}
        />
      );

      // Click lane header
      const laneHeader = screen.getAllByText("todo")[0];
      fireEvent.click(laneHeader);

      // Should not toggle when collapsible is false
      expect(onLaneToggle).not.toHaveBeenCalled();
    });

    it("hides count when showCount is false", () => {
      const layout = createLayout();
      const cards = [createCard()];

      const { container } = render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
          options={{ showCount: false }}
        />
      );

      // Lane count badges should not be present
      const countBadges = container.querySelectorAll(".exo-kanban-lane-count");
      expect(countBadges.length).toBe(0);
    });
  });

  describe("Provided Lanes", () => {
    it("uses provided lanes instead of deriving from layout", () => {
      const layout = createLayout({ lanes: [] }); // No lanes in layout
      const cards = [createCard({ laneId: "custom-lane" })];
      const lanes: KanbanLane[] = [
        { id: "custom-lane", label: "Custom Lane" },
      ];

      render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
          lanes={lanes}
        />
      );

      expect(screen.getByText("Custom Lane")).toBeInTheDocument();
    });
  });

  describe("Link Click Handler", () => {
    it("calls onLinkClick when card is clicked", () => {
      const onLinkClick = jest.fn();
      const layout = createLayout();
      const cards = [createCard()];

      const { container } = render(
        <KanbanLayoutRenderer
          layout={layout}
          cards={cards}
          onLinkClick={onLinkClick}
        />
      );

      const card = container.querySelector('[data-card-id="card-1"]');
      fireEvent.click(card!);

      expect(onLinkClick).toHaveBeenCalledWith("/path/to/asset.md", expect.any(Object));
    });
  });
});
