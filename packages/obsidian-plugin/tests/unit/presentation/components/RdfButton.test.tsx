/**
 * Tests for RdfButton component
 *
 * RdfButton is a generic React component that renders any button from RDF definition.
 * It replaces 18 specialized button components with a single generic component.
 *
 * @see https://github.com/kitelev/exocortex/issues/2004
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RdfButton, RdfButtonProps, RdfButtonDefinition } from "../../../../src/presentation/components/RdfButton";

describe("RdfButton", () => {
  const mockOnClick = jest.fn();

  const defaultDefinition: RdfButtonDefinition = {
    uri: "test:StartButton",
    label: "Start",
    action: "test:StartAction",
  };

  const defaultProps: RdfButtonProps = {
    definition: defaultDefinition,
    onClick: mockOnClick,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render button with label from RDF definition", () => {
      render(<RdfButton {...defaultProps} />);

      const button = screen.getByRole("button", { name: "Start" });
      expect(button).toBeInTheDocument();
    });

    it("should render button with icon when provided in definition", () => {
      const definitionWithIcon: RdfButtonDefinition = {
        ...defaultDefinition,
        icon: "play",
      };

      render(<RdfButton {...defaultProps} definition={definitionWithIcon} />);

      const button = screen.getByRole("button");
      // Icon should be rendered (we check for the icon class)
      expect(button.querySelector(".exocortex-rdf-button-icon")).toBeInTheDocument();
    });

    it("should render button without icon when not provided", () => {
      render(<RdfButton {...defaultProps} />);

      const button = screen.getByRole("button");
      expect(button.querySelector(".exocortex-rdf-button-icon")).not.toBeInTheDocument();
    });

    it("should apply correct variant class for primary variant", () => {
      const definitionWithVariant: RdfButtonDefinition = {
        ...defaultDefinition,
        variant: "primary",
      };

      render(<RdfButton {...defaultProps} definition={definitionWithVariant} />);

      const button = screen.getByRole("button");
      expect(button).toHaveClass("exocortex-rdf-button--primary");
    });

    it("should apply secondary variant class by default", () => {
      render(<RdfButton {...defaultProps} />);

      const button = screen.getByRole("button");
      expect(button).toHaveClass("exocortex-rdf-button--secondary");
    });

    it("should apply correct variant class for all variants", () => {
      const variants: Array<"primary" | "secondary" | "success" | "warning" | "danger"> = [
        "primary",
        "secondary",
        "success",
        "warning",
        "danger",
      ];

      variants.forEach((variant) => {
        const { unmount } = render(
          <RdfButton
            {...defaultProps}
            definition={{ ...defaultDefinition, variant }}
          />
        );

        const button = screen.getByRole("button");
        expect(button).toHaveClass(`exocortex-rdf-button--${variant}`);
        unmount();
      });
    });

    it("should render tooltip when provided in definition", () => {
      const definitionWithTooltip: RdfButtonDefinition = {
        ...defaultDefinition,
        tooltip: "Click to start effort",
      };

      render(<RdfButton {...defaultProps} definition={definitionWithTooltip} />);

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("title", "Click to start effort");
    });
  });

  describe("onClick behavior", () => {
    it("should call onClick handler when button is clicked", async () => {
      render(<RdfButton {...defaultProps} />);

      const button = screen.getByRole("button", { name: "Start" });
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockOnClick).toHaveBeenCalledTimes(1);
      });
    });

    it("should pass action URI and button definition to onClick handler", async () => {
      render(<RdfButton {...defaultProps} />);

      const button = screen.getByRole("button");
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockOnClick).toHaveBeenCalledWith(defaultDefinition);
      });
    });

    it("should prevent default event behavior on click", async () => {
      render(<RdfButton {...defaultProps} />);

      const button = screen.getByRole("button");
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(clickEvent, "preventDefault", {
        value: jest.fn(),
        writable: true,
      });

      fireEvent(button, clickEvent);

      expect(clickEvent.preventDefault).toHaveBeenCalled();
    });

    it("should stop event propagation on click", async () => {
      render(<RdfButton {...defaultProps} />);

      const button = screen.getByRole("button");
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(clickEvent, "stopPropagation", {
        value: jest.fn(),
        writable: true,
      });

      fireEvent(button, clickEvent);

      expect(clickEvent.stopPropagation).toHaveBeenCalled();
    });

    it("should handle async onClick without errors", async () => {
      const asyncOnClick = jest.fn().mockResolvedValue(undefined);

      render(<RdfButton {...defaultProps} onClick={asyncOnClick} />);

      const button = screen.getByRole("button");
      fireEvent.click(button);

      await waitFor(() => {
        expect(asyncOnClick).toHaveBeenCalled();
      });
    });
  });

  describe("disabled state", () => {
    it("should render as disabled when disabled prop is true", () => {
      render(<RdfButton {...defaultProps} disabled={true} />);

      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
    });

    it("should not call onClick when disabled", () => {
      render(<RdfButton {...defaultProps} disabled={true} />);

      const button = screen.getByRole("button");
      fireEvent.click(button);

      expect(mockOnClick).not.toHaveBeenCalled();
    });

    it("should have disabled class when disabled", () => {
      render(<RdfButton {...defaultProps} disabled={true} />);

      const button = screen.getByRole("button");
      expect(button).toHaveClass("exocortex-rdf-button--disabled");
    });
  });

  describe("loading state", () => {
    it("should show loading indicator when loading", () => {
      render(<RdfButton {...defaultProps} loading={true} />);

      const button = screen.getByRole("button");
      expect(button.querySelector(".exocortex-rdf-button-loading")).toBeInTheDocument();
    });

    it("should be disabled when loading", () => {
      render(<RdfButton {...defaultProps} loading={true} />);

      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
    });
  });

  describe("CSS classes", () => {
    it("should have base CSS class", () => {
      render(<RdfButton {...defaultProps} />);

      const button = screen.getByRole("button");
      expect(button).toHaveClass("exocortex-rdf-button");
    });

    it("should allow additional custom classes via className prop", () => {
      render(<RdfButton {...defaultProps} className="custom-class" />);

      const button = screen.getByRole("button");
      expect(button).toHaveClass("exocortex-rdf-button");
      expect(button).toHaveClass("custom-class");
    });
  });

  describe("accessibility", () => {
    it("should have type=button to prevent form submission", () => {
      render(<RdfButton {...defaultProps} />);

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("type", "button");
    });

    it("should be focusable", () => {
      render(<RdfButton {...defaultProps} />);

      const button = screen.getByRole("button");
      button.focus();
      expect(document.activeElement).toBe(button);
    });
  });

  describe("integration with RDF definitions", () => {
    it("should render correctly with complete RDF definition", () => {
      const fullDefinition: RdfButtonDefinition = {
        uri: "exo-ui:CompleteButton",
        label: "Complete Task",
        icon: "check",
        variant: "success",
        tooltip: "Mark this task as complete",
        action: "exo-ui:CompleteAction",
      };

      render(<RdfButton definition={fullDefinition} onClick={mockOnClick} />);

      // Button with icon has accessible name that includes both icon text and label
      const button = screen.getByRole("button", { name: /Complete Task/ });
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass("exocortex-rdf-button--success");
      expect(button).toHaveAttribute("title", "Mark this task as complete");
      expect(button.querySelector(".exocortex-rdf-button-icon")).toBeInTheDocument();
    });

    it("should handle special characters in label", () => {
      const definitionWithSpecialChars: RdfButtonDefinition = {
        ...defaultDefinition,
        label: "Приостановить & Resume",
      };

      render(<RdfButton {...defaultProps} definition={definitionWithSpecialChars} />);

      const button = screen.getByRole("button", { name: /Приостановить & Resume/ });
      expect(button).toBeInTheDocument();
    });
  });
});
