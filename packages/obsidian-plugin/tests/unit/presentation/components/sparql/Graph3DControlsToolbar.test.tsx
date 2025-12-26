/**
 * Graph3DControlsToolbar Unit Tests
 *
 * Tests for the Graph3DControlsToolbar component which provides
 * UI controls for 3D graph visualization.
 */

import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  Graph3DControlsToolbar,
  Graph3DControlState,
} from "../../../../../src/presentation/components/sparql/Graph3DControlsToolbar";

describe("Graph3DControlsToolbar", () => {
  const defaultState: Graph3DControlState = {
    autoRotate: false,
    labelsVisible: true,
    isFullscreen: false,
  };

  const mockHandlers = {
    onCameraReset: jest.fn(),
    onAutoRotateToggle: jest.fn(),
    onLabelsToggle: jest.fn(),
    onFullscreenToggle: jest.fn(),
  };

  beforeEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders toolbar container with correct test id", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-controls-toolbar")).toBeInTheDocument();
    });

    it("renders all four control buttons", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-btn-reset")).toBeInTheDocument();
      expect(screen.getByTestId("graph3d-btn-autorotate")).toBeInTheDocument();
      expect(screen.getByTestId("graph3d-btn-labels")).toBeInTheDocument();
      expect(screen.getByTestId("graph3d-btn-fullscreen")).toBeInTheDocument();
    });

    it("applies custom className", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
          className="custom-class"
        />
      );

      expect(screen.getByTestId("graph3d-controls-toolbar")).toHaveClass("custom-class");
    });

    it("has toolbar role and aria-label", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      const toolbar = screen.getByTestId("graph3d-controls-toolbar");
      expect(toolbar).toHaveAttribute("role", "toolbar");
      expect(toolbar).toHaveAttribute("aria-label", "3D Graph Controls");
    });
  });

  describe("button states", () => {
    it("shows auto-rotate button as inactive when autoRotate is false", () => {
      render(
        <Graph3DControlsToolbar
          state={{ ...defaultState, autoRotate: false }}
          {...mockHandlers}
        />
      );

      const button = screen.getByTestId("graph3d-btn-autorotate");
      expect(button).not.toHaveClass("exo-graph3d-toolbar__btn--active");
      expect(button).toHaveAttribute("aria-pressed", "false");
    });

    it("shows auto-rotate button as active when autoRotate is true", () => {
      render(
        <Graph3DControlsToolbar
          state={{ ...defaultState, autoRotate: true }}
          {...mockHandlers}
        />
      );

      const button = screen.getByTestId("graph3d-btn-autorotate");
      expect(button).toHaveClass("exo-graph3d-toolbar__btn--active");
      expect(button).toHaveAttribute("aria-pressed", "true");
    });

    it("shows labels button as active when labelsVisible is true", () => {
      render(
        <Graph3DControlsToolbar
          state={{ ...defaultState, labelsVisible: true }}
          {...mockHandlers}
        />
      );

      const button = screen.getByTestId("graph3d-btn-labels");
      expect(button).toHaveClass("exo-graph3d-toolbar__btn--active");
      expect(button).toHaveAttribute("aria-pressed", "true");
    });

    it("shows labels button as inactive when labelsVisible is false", () => {
      render(
        <Graph3DControlsToolbar
          state={{ ...defaultState, labelsVisible: false }}
          {...mockHandlers}
        />
      );

      const button = screen.getByTestId("graph3d-btn-labels");
      expect(button).not.toHaveClass("exo-graph3d-toolbar__btn--active");
      expect(button).toHaveAttribute("aria-pressed", "false");
    });

    it("shows fullscreen button as active when isFullscreen is true", () => {
      render(
        <Graph3DControlsToolbar
          state={{ ...defaultState, isFullscreen: true }}
          {...mockHandlers}
        />
      );

      const button = screen.getByTestId("graph3d-btn-fullscreen");
      expect(button).toHaveClass("exo-graph3d-toolbar__btn--active");
      expect(button).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("button interactions", () => {
    it("calls onCameraReset when reset button is clicked", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      fireEvent.click(screen.getByTestId("graph3d-btn-reset"));
      expect(mockHandlers.onCameraReset).toHaveBeenCalledTimes(1);
    });

    it("calls onAutoRotateToggle when auto-rotate button is clicked", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      fireEvent.click(screen.getByTestId("graph3d-btn-autorotate"));
      expect(mockHandlers.onAutoRotateToggle).toHaveBeenCalledTimes(1);
    });

    it("calls onLabelsToggle when labels button is clicked", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      fireEvent.click(screen.getByTestId("graph3d-btn-labels"));
      expect(mockHandlers.onLabelsToggle).toHaveBeenCalledTimes(1);
    });

    it("calls onFullscreenToggle when fullscreen button is clicked", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      fireEvent.click(screen.getByTestId("graph3d-btn-fullscreen"));
      expect(mockHandlers.onFullscreenToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe("tooltips", () => {
    it("reset button has tooltip with keyboard shortcut", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-btn-reset")).toHaveAttribute("title", "Reset camera (R)");
    });

    it("auto-rotate button tooltip shows current state", () => {
      const { rerender } = render(
        <Graph3DControlsToolbar
          state={{ ...defaultState, autoRotate: false }}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-btn-autorotate")).toHaveAttribute("title", "Auto-rotate: OFF (A)");

      rerender(
        <Graph3DControlsToolbar
          state={{ ...defaultState, autoRotate: true }}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-btn-autorotate")).toHaveAttribute("title", "Auto-rotate: ON (A)");
    });

    it("labels button tooltip shows current state", () => {
      const { rerender } = render(
        <Graph3DControlsToolbar
          state={{ ...defaultState, labelsVisible: true }}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-btn-labels")).toHaveAttribute("title", "Labels: visible (L)");

      rerender(
        <Graph3DControlsToolbar
          state={{ ...defaultState, labelsVisible: false }}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-btn-labels")).toHaveAttribute("title", "Labels: hidden (L)");
    });

    it("fullscreen button tooltip shows current state", () => {
      const { rerender } = render(
        <Graph3DControlsToolbar
          state={{ ...defaultState, isFullscreen: false }}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-btn-fullscreen")).toHaveAttribute("title", "Fullscreen: enter (F)");

      rerender(
        <Graph3DControlsToolbar
          state={{ ...defaultState, isFullscreen: true }}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-btn-fullscreen")).toHaveAttribute("title", "Fullscreen: exit (F)");
    });
  });

  describe("keyboard shortcuts", () => {
    it("R key triggers camera reset", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      fireEvent.keyDown(document, { key: "r" });
      expect(mockHandlers.onCameraReset).toHaveBeenCalledTimes(1);
    });

    it("A key toggles auto-rotate", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      fireEvent.keyDown(document, { key: "a" });
      expect(mockHandlers.onAutoRotateToggle).toHaveBeenCalledTimes(1);
    });

    it("L key toggles labels", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      fireEvent.keyDown(document, { key: "l" });
      expect(mockHandlers.onLabelsToggle).toHaveBeenCalledTimes(1);
    });

    it("F key toggles fullscreen", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      fireEvent.keyDown(document, { key: "f" });
      expect(mockHandlers.onFullscreenToggle).toHaveBeenCalledTimes(1);
    });

    it("uppercase keys also work", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      fireEvent.keyDown(document, { key: "R" });
      expect(mockHandlers.onCameraReset).toHaveBeenCalled();

      fireEvent.keyDown(document, { key: "A" });
      expect(mockHandlers.onAutoRotateToggle).toHaveBeenCalled();
    });

    it("ignores keyboard shortcuts when typing in input", () => {
      render(
        <>
          <input data-testid="test-input" />
          <Graph3DControlsToolbar
            state={defaultState}
            {...mockHandlers}
          />
        </>
      );

      const input = screen.getByTestId("test-input");
      fireEvent.keyDown(input, { key: "r" });

      expect(mockHandlers.onCameraReset).not.toHaveBeenCalled();
    });

    it("ignores keyboard shortcuts when typing in textarea", () => {
      render(
        <>
          <textarea data-testid="test-textarea" />
          <Graph3DControlsToolbar
            state={defaultState}
            {...mockHandlers}
          />
        </>
      );

      const textarea = screen.getByTestId("test-textarea");
      fireEvent.keyDown(textarea, { key: "r" });

      expect(mockHandlers.onCameraReset).not.toHaveBeenCalled();
    });
  });

  describe("accessibility", () => {
    it("all buttons have type=button", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      const buttons = screen.getAllByRole("button");
      buttons.forEach((button) => {
        expect(button).toHaveAttribute("type", "button");
      });
    });

    it("reset button has aria-label", () => {
      render(
        <Graph3DControlsToolbar
          state={defaultState}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-btn-reset")).toHaveAttribute(
        "aria-label",
        "Reset camera to default view"
      );
    });

    it("toggle buttons have aria-pressed reflecting state", () => {
      render(
        <Graph3DControlsToolbar
          state={{ autoRotate: true, labelsVisible: false, isFullscreen: true }}
          {...mockHandlers}
        />
      );

      expect(screen.getByTestId("graph3d-btn-autorotate")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("graph3d-btn-labels")).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("graph3d-btn-fullscreen")).toHaveAttribute("aria-pressed", "true");
    });
  });
});
