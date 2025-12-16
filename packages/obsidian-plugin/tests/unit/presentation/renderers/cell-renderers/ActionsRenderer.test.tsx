/**
 * ActionsRenderer Component Tests
 *
 * Tests for the ActionsRenderer component that displays action buttons.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ActionsRenderer } from "../../../../../src/presentation/renderers/cell-renderers/ActionsRenderer";
import type { LayoutActions, CommandRef } from "../../../../../src/domain/layout";

describe("ActionsRenderer", () => {
  const createMockActions = (overrides: Partial<LayoutActions> = {}): LayoutActions => ({
    uid: "actions-uid",
    label: "Test Actions",
    commands: [
      {
        uid: "cmd-1",
        label: "Start",
        icon: "play-circle",
        preconditionSparql: undefined,
        groundingSparql: "DELETE {} INSERT {} WHERE {}",
      },
    ],
    position: "column",
    showLabels: false,
    ...overrides,
  });

  const defaultProps = {
    assetUri: "obsidian://vault/test-asset.md",
    assetPath: "test-asset.md",
  };

  describe("Basic Rendering", () => {
    it("should render action buttons container", () => {
      const actions = createMockActions();

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("should render button with correct icon", () => {
      const actions = createMockActions();

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      // The icon should be rendered (▶️ for play-circle)
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("title", "Start");
    });

    it("should render multiple buttons for multiple commands", () => {
      const actions = createMockActions({
        commands: [
          { uid: "cmd-1", label: "Start", icon: "play-circle" },
          { uid: "cmd-2", label: "Stop", icon: "stop-circle" },
          { uid: "cmd-3", label: "Complete", icon: "check-circle" },
        ],
      });

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      expect(screen.getAllByRole("button")).toHaveLength(3);
    });

    it("should show labels when showLabels is true", () => {
      const actions = createMockActions({
        showLabels: true,
        commands: [{ uid: "cmd-1", label: "Start Task", icon: "play-circle" }],
      });

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      expect(screen.getByText("Start Task")).toBeInTheDocument();
    });

    it("should not show labels when showLabels is false", () => {
      const actions = createMockActions({
        showLabels: false,
        commands: [{ uid: "cmd-1", label: "Start Task", icon: "play-circle" }],
      });

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      // Label should only be in title attribute, not visible text
      expect(screen.queryByText("Start Task")).not.toBeInTheDocument();
      expect(screen.getByRole("button")).toHaveAttribute("title", "Start Task");
    });
  });

  describe("Precondition Checking", () => {
    it("should check preconditions on mount", async () => {
      const onCheckPrecondition = jest.fn().mockResolvedValue(true);
      const actions = createMockActions({
        commands: [
          {
            uid: "cmd-1",
            label: "Start",
            icon: "play-circle",
            preconditionSparql: "ASK { ?s ?p ?o }",
          },
        ],
      });

      render(
        <ActionsRenderer
          actions={actions}
          {...defaultProps}
          onCheckPrecondition={onCheckPrecondition}
        />
      );

      await waitFor(() => {
        expect(onCheckPrecondition).toHaveBeenCalledWith(
          "ASK { ?s ?p ?o }",
          defaultProps.assetUri
        );
      });
    });

    it("should hide button when precondition returns false", async () => {
      const onCheckPrecondition = jest.fn().mockResolvedValue(false);
      const actions = createMockActions({
        commands: [
          {
            uid: "cmd-1",
            label: "Start",
            icon: "play-circle",
            preconditionSparql: "ASK { ?s ?p ?o }",
          },
        ],
      });

      render(
        <ActionsRenderer
          actions={actions}
          {...defaultProps}
          onCheckPrecondition={onCheckPrecondition}
        />
      );

      await waitFor(() => {
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
      });
    });

    it("should show button when precondition returns true", async () => {
      const onCheckPrecondition = jest.fn().mockResolvedValue(true);
      const actions = createMockActions({
        commands: [
          {
            uid: "cmd-1",
            label: "Start",
            icon: "play-circle",
            preconditionSparql: "ASK { ?s ?p ?o }",
          },
        ],
      });

      render(
        <ActionsRenderer
          actions={actions}
          {...defaultProps}
          onCheckPrecondition={onCheckPrecondition}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("button")).toBeInTheDocument();
      });
    });

    it("should show button when no precondition is defined", () => {
      const actions = createMockActions({
        commands: [
          {
            uid: "cmd-1",
            label: "Start",
            icon: "play-circle",
            preconditionSparql: undefined,
          },
        ],
      });

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      expect(screen.getByRole("button")).toBeInTheDocument();
    });
  });

  describe("Command Execution", () => {
    it("should execute command on button click", async () => {
      const onExecuteCommand = jest.fn().mockResolvedValue(undefined);
      const groundingSparql = "DELETE {} INSERT {} WHERE {}";
      const actions = createMockActions({
        commands: [
          {
            uid: "cmd-1",
            label: "Start",
            icon: "play-circle",
            groundingSparql,
          },
        ],
      });

      render(
        <ActionsRenderer
          actions={actions}
          {...defaultProps}
          onExecuteCommand={onExecuteCommand}
        />
      );

      fireEvent.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(onExecuteCommand).toHaveBeenCalledWith(
          groundingSparql,
          defaultProps.assetUri
        );
      });
    });

    it("should re-check preconditions after command execution", async () => {
      const onCheckPrecondition = jest.fn().mockResolvedValue(true);
      const onExecuteCommand = jest.fn().mockResolvedValue(undefined);
      const actions = createMockActions({
        commands: [
          {
            uid: "cmd-1",
            label: "Start",
            icon: "play-circle",
            preconditionSparql: "ASK { ?s ?p ?o }",
            groundingSparql: "DELETE {} INSERT {} WHERE {}",
          },
        ],
      });

      render(
        <ActionsRenderer
          actions={actions}
          {...defaultProps}
          onCheckPrecondition={onCheckPrecondition}
          onExecuteCommand={onExecuteCommand}
        />
      );

      // Wait for initial precondition check
      await waitFor(() => {
        expect(onCheckPrecondition).toHaveBeenCalledTimes(1);
      });

      // Click the button
      fireEvent.click(screen.getByRole("button"));

      // Wait for re-check after execution
      await waitFor(() => {
        expect(onCheckPrecondition).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("Disabled State", () => {
    it("should disable buttons when disabled prop is true", () => {
      const actions = createMockActions();

      render(
        <ActionsRenderer actions={actions} {...defaultProps} disabled={true} />
      );

      expect(screen.getByRole("button")).toBeDisabled();
    });

    it("should not execute command when disabled", async () => {
      const onExecuteCommand = jest.fn();
      const actions = createMockActions({
        commands: [
          {
            uid: "cmd-1",
            label: "Start",
            icon: "play-circle",
            groundingSparql: "DELETE {} INSERT {} WHERE {}",
          },
        ],
      });

      render(
        <ActionsRenderer
          actions={actions}
          {...defaultProps}
          disabled={true}
          onExecuteCommand={onExecuteCommand}
        />
      );

      fireEvent.click(screen.getByRole("button"));

      // Disabled buttons don't fire click events
      expect(onExecuteCommand).not.toHaveBeenCalled();
    });
  });

  describe("Position Classes", () => {
    it("should apply column position class", () => {
      const actions = createMockActions({ position: "column" });

      const { container } = render(
        <ActionsRenderer actions={actions} {...defaultProps} />
      );

      expect(container.querySelector(".exo-actions-column")).toBeInTheDocument();
    });

    it("should apply inline position class", () => {
      const actions = createMockActions({ position: "inline" });

      const { container } = render(
        <ActionsRenderer actions={actions} {...defaultProps} />
      );

      expect(container.querySelector(".exo-actions-inline")).toBeInTheDocument();
    });

    it("should apply hover position class", () => {
      const actions = createMockActions({ position: "hover" });

      const { container } = render(
        <ActionsRenderer actions={actions} {...defaultProps} />
      );

      expect(container.querySelector(".exo-actions-hover")).toBeInTheDocument();
    });
  });

  describe("Data Attributes", () => {
    it("should include asset URI data attribute", () => {
      const actions = createMockActions();

      const { container } = render(
        <ActionsRenderer actions={actions} {...defaultProps} />
      );

      expect(container.querySelector("[data-asset-uri]")).toHaveAttribute(
        "data-asset-uri",
        defaultProps.assetUri
      );
    });

    it("should include asset path data attribute", () => {
      const actions = createMockActions();

      const { container } = render(
        <ActionsRenderer actions={actions} {...defaultProps} />
      );

      expect(container.querySelector("[data-asset-path]")).toHaveAttribute(
        "data-asset-path",
        defaultProps.assetPath
      );
    });

    it("should include command UID data attribute on buttons", () => {
      const actions = createMockActions({
        commands: [{ uid: "cmd-test-uid", label: "Test", icon: "check" }],
      });

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      expect(screen.getByRole("button")).toHaveAttribute(
        "data-command-uid",
        "cmd-test-uid"
      );
    });
  });

  describe("Icon Mapping", () => {
    it("should render play icon for play-circle", () => {
      const actions = createMockActions({
        commands: [{ uid: "cmd-1", label: "Start", icon: "play-circle" }],
      });

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      expect(screen.getByText("▶️")).toBeInTheDocument();
    });

    it("should render stop icon for stop-circle", () => {
      const actions = createMockActions({
        commands: [{ uid: "cmd-1", label: "Stop", icon: "stop-circle" }],
      });

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      expect(screen.getByText("⏹️")).toBeInTheDocument();
    });

    it("should render check icon for check-circle", () => {
      const actions = createMockActions({
        commands: [{ uid: "cmd-1", label: "Complete", icon: "check-circle" }],
      });

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      expect(screen.getByText("✅")).toBeInTheDocument();
    });

    it("should use default icon when icon is not mapped", () => {
      const actions = createMockActions({
        commands: [{ uid: "cmd-1", label: "Custom", icon: "unknown-icon" }],
      });

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      expect(screen.getByText("⚡")).toBeInTheDocument();
    });

    it("should use default icon when icon is not provided", () => {
      const actions = createMockActions({
        commands: [{ uid: "cmd-1", label: "No Icon" }],
      });

      render(<ActionsRenderer actions={actions} {...defaultProps} />);

      expect(screen.getByText("⚡")).toBeInTheDocument();
    });
  });
});
