/**
 * KanbanCard Unit Tests
 *
 * Tests for the KanbanCard component.
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

import { KanbanCard } from "@plugin/presentation/renderers/kanban/KanbanCard";
import type { KanbanCard as KanbanCardType } from "@plugin/presentation/renderers/kanban/types";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("KanbanCard", () => {
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

  const createCard = (overrides: Partial<KanbanCardType> = {}): KanbanCardType => ({
    id: "card-1",
    path: "/path/to/asset.md",
    metadata: {},
    values: { "col-1": "Test Card" },
    laneId: "[[todo]]",
    ...overrides,
  });

  describe("Basic Rendering", () => {
    it("renders card with primary value", () => {
      const card = createCard();
      const columns = [createColumn()];

      render(<KanbanCard card={card} columns={columns} />);

      expect(screen.getByText("Test Card")).toBeInTheDocument();
    });

    it("renders card with multiple columns", () => {
      const card = createCard({
        values: {
          "col-1": "Task Name",
          "col-2": "High Priority",
          "col-3": "Due Tomorrow",
        },
      });
      const columns = [
        createColumn({ uid: "col-1", header: "Name" }),
        createColumn({ uid: "col-2", header: "Priority" }),
        createColumn({ uid: "col-3", header: "Due Date" }),
      ];

      render(<KanbanCard card={card} columns={columns} />);

      expect(screen.getByText("Task Name")).toBeInTheDocument();
      expect(screen.getByText("High Priority")).toBeInTheDocument();
      expect(screen.getByText("Due Tomorrow")).toBeInTheDocument();
    });

    it("does not render empty field values", () => {
      const card = createCard({
        values: {
          "col-1": "Task Name",
          "col-2": "", // Empty
          "col-3": null, // Null
        },
      });
      const columns = [
        createColumn({ uid: "col-1", header: "Name" }),
        createColumn({ uid: "col-2", header: "Priority" }),
        createColumn({ uid: "col-3", header: "Due Date" }),
      ];

      const { container } = render(<KanbanCard card={card} columns={columns} />);

      // Only the body should contain Name
      const fieldLabels = container.querySelectorAll(".exo-kanban-card-field-label");
      // Additional fields should be empty (skipped)
      expect(fieldLabels.length).toBe(0); // No field labels since empty values are skipped
    });
  });

  describe("Draggable Behavior", () => {
    it("is draggable by default", () => {
      const card = createCard();

      const { container } = render(<KanbanCard card={card} isDraggable={true} />);

      const cardElement = container.querySelector(".exo-kanban-card");
      expect(cardElement).toHaveAttribute("draggable", "true");
      expect(cardElement).toHaveClass("exo-kanban-card-draggable");
    });

    it("is not draggable when isDraggable is false", () => {
      const card = createCard();

      const { container } = render(<KanbanCard card={card} isDraggable={false} />);

      const cardElement = container.querySelector(".exo-kanban-card");
      expect(cardElement).toHaveAttribute("draggable", "false");
      expect(cardElement).not.toHaveClass("exo-kanban-card-draggable");
    });

    it("calls onDragStart handler", () => {
      const onDragStart = jest.fn();
      const card = createCard();

      const { container } = render(
        <KanbanCard card={card} onDragStart={onDragStart} />
      );

      const cardElement = container.querySelector(".exo-kanban-card");
      fireEvent.dragStart(cardElement!, {
        dataTransfer: {
          setData: jest.fn(),
          effectAllowed: "move",
        },
      });

      expect(onDragStart).toHaveBeenCalled();
    });

    it("calls onDragEnd handler", () => {
      const onDragEnd = jest.fn();
      const card = createCard();

      const { container } = render(
        <KanbanCard card={card} onDragEnd={onDragEnd} />
      );

      const cardElement = container.querySelector(".exo-kanban-card");
      fireEvent.dragEnd(cardElement!);

      expect(onDragEnd).toHaveBeenCalled();
    });
  });

  describe("Click Navigation", () => {
    it("calls onLinkClick with card path on click", () => {
      const onLinkClick = jest.fn();
      const card = createCard({ path: "/my/file.md" });

      const { container } = render(
        <KanbanCard card={card} onLinkClick={onLinkClick} />
      );

      const cardElement = container.querySelector(".exo-kanban-card");
      fireEvent.click(cardElement!);

      expect(onLinkClick).toHaveBeenCalledWith("/my/file.md", expect.any(Object));
    });

    it("does not call onLinkClick when dragging", () => {
      const onLinkClick = jest.fn();
      const card = createCard();

      const { container } = render(
        <KanbanCard card={card} onLinkClick={onLinkClick} isDragging={true} />
      );

      const cardElement = container.querySelector(".exo-kanban-card");
      fireEvent.click(cardElement!);

      expect(onLinkClick).not.toHaveBeenCalled();
    });
  });

  describe("Dragging State", () => {
    it("applies dragging class when isDragging is true", () => {
      const card = createCard();

      const { container } = render(<KanbanCard card={card} isDragging={true} />);

      const cardElement = container.querySelector(".exo-kanban-card");
      expect(cardElement).toHaveClass("exo-kanban-card-dragging");
    });
  });

  describe("Data Attributes", () => {
    it("includes data-card-id attribute", () => {
      const card = createCard({ id: "unique-card-123" });

      const { container } = render(<KanbanCard card={card} />);

      const cardElement = container.querySelector(".exo-kanban-card");
      expect(cardElement).toHaveAttribute("data-card-id", "unique-card-123");
    });

    it("includes data-path attribute", () => {
      const card = createCard({ path: "/path/to/file.md" });

      const { container } = render(<KanbanCard card={card} />);

      const cardElement = container.querySelector(".exo-kanban-card");
      expect(cardElement).toHaveAttribute("data-path", "/path/to/file.md");
    });
  });
});
