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
        // Command-oriented signature (#3654 Part 2): the callback receives the
        // whole CommandRef + the row asset's IRI + path (the host decides how to
        // gate — raw ASK here; structural PreconditionEvaluator for structural).
        expect(onCheckPrecondition).toHaveBeenCalledWith(
          expect.objectContaining({
            uid: "cmd-1",
            preconditionSparql: "ASK { ?s ?p ?o }",
          }),
          defaultProps.assetUri,
          defaultProps.assetPath
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
        // Command-oriented signature (#3654 Part 2): the host receives the whole
        // CommandRef (to resolve a structural command) + the row IRI + path.
        expect(onExecuteCommand).toHaveBeenCalledWith(
          expect.objectContaining({ uid: "cmd-1", groundingSparql }),
          defaultProps.assetUri,
          defaultProps.assetPath
        );
      });
    });

    it("executes a STRUCTURAL command (no raw groundingSparql) and gates it by structural precondition [@req:28731c06-b393-419b-b8ee-453ca6225b17]", async () => {
      // A structural exocmd command has NO raw preconditionSparql/groundingSparql
      // — it is flagged `structural`. hasPrecondition/hasExecutor must be true via
      // the flag so the host checks its structural precondition and routes the
      // click through CommandExecutionFlow (#3654 Part 2 / #3777).
      const onCheckPrecondition = jest.fn().mockResolvedValue(true);
      const onExecuteCommand = jest.fn().mockResolvedValue(undefined);
      const actions = createMockActions({
        commands: [
          {
            uid: "cmd-structural",
            label: "Set Status",
            icon: "check-circle",
            structural: true,
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

      // The structural command's precondition IS checked (button visible on true).
      await waitFor(() => {
        expect(onCheckPrecondition).toHaveBeenCalledWith(
          expect.objectContaining({ uid: "cmd-structural", structural: true }),
          defaultProps.assetUri,
          defaultProps.assetPath
        );
      });
      await waitFor(() => {
        expect(screen.getByRole("button")).toBeInTheDocument();
      });

      // Clicking routes the whole CommandRef to the executor (no groundingSparql).
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => {
        expect(onExecuteCommand).toHaveBeenCalledWith(
          expect.objectContaining({ uid: "cmd-structural", structural: true }),
          defaultProps.assetUri,
          defaultProps.assetPath
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

  describe("Error surfacing (#3628)", () => {
    it("surfaces an error (not a silent no-op) when no executor is wired", () => {
      const onError = jest.fn();
      const actions = createMockActions(); // has groundingSparql, but no onExecuteCommand

      render(
        <ActionsRenderer actions={actions} {...defaultProps} onError={onError} />,
      );

      fireEvent.click(screen.getByRole("button"));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toContain("Start");
    });

    it("surfaces an error when the command has no action configured", () => {
      const onError = jest.fn();
      const onExecuteCommand = jest.fn();
      const actions = createMockActions({
        commands: [
          {
            uid: "cmd-1",
            label: "Start",
            icon: "play-circle",
            groundingSparql: undefined,
          },
        ],
      });

      render(
        <ActionsRenderer
          actions={actions}
          {...defaultProps}
          onExecuteCommand={onExecuteCommand}
          onError={onError}
        />,
      );

      fireEvent.click(screen.getByRole("button"));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onExecuteCommand).not.toHaveBeenCalled();
    });

    it("surfaces execution errors instead of swallowing them", async () => {
      const onError = jest.fn();
      const onExecuteCommand = jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("boom"));
      const actions = createMockActions(); // has groundingSparql

      render(
        <ActionsRenderer
          actions={actions}
          {...defaultProps}
          onExecuteCommand={onExecuteCommand}
          onError={onError}
        />,
      );

      fireEvent.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1);
      });
      expect(onError.mock.calls[0][0]).toContain("boom");
    });

    it("does not surface an error on a successful execution", async () => {
      const onError = jest.fn();
      const onExecuteCommand = jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined);
      const actions = createMockActions();

      render(
        <ActionsRenderer
          actions={actions}
          {...defaultProps}
          onExecuteCommand={onExecuteCommand}
          onError={onError}
        />,
      );

      fireEvent.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(onExecuteCommand).toHaveBeenCalled();
      });
      expect(onError).not.toHaveBeenCalled();
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
