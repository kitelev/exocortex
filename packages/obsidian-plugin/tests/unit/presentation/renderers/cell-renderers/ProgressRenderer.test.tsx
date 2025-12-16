/**
 * ProgressRenderer Unit Tests
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";


import { ProgressRenderer } from "@plugin/presentation/renderers/cell-renderers/ProgressRenderer";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("ProgressRenderer", () => {
  const createColumn = (): LayoutColumn => ({
    uid: "col-1",
    label: "Progress",
    property: "progress",
  });

  describe("Percentage Values", () => {
    it("renders percentage value", () => {
      render(
        <ProgressRenderer
          value={75}
          column={createColumn()}
        />
      );

      expect(screen.getByText("75%")).toBeInTheDocument();
      expect(screen.getByTitle("75%")).toBeInTheDocument();
    });

    it("renders 0%", () => {
      render(
        <ProgressRenderer
          value={0}
          column={createColumn()}
        />
      );

      expect(screen.getByText("0%")).toBeInTheDocument();
    });

    it("renders 100%", () => {
      render(
        <ProgressRenderer
          value={100}
          column={createColumn()}
        />
      );

      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("clamps values above 100", () => {
      render(
        <ProgressRenderer
          value={150}
          column={createColumn()}
        />
      );

      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("clamps negative values to 0", () => {
      render(
        <ProgressRenderer
          value={-10}
          column={createColumn()}
        />
      );

      expect(screen.getByText("0%")).toBeInTheDocument();
    });
  });

  describe("Ratio Values", () => {
    it("converts ratio 0.75 to 75%", () => {
      render(
        <ProgressRenderer
          value={0.75}
          column={createColumn()}
        />
      );

      expect(screen.getByText("75%")).toBeInTheDocument();
    });

    it("converts ratio 0.5 to 50%", () => {
      render(
        <ProgressRenderer
          value={0.5}
          column={createColumn()}
        />
      );

      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("converts ratio 1.0 to 100%", () => {
      render(
        <ProgressRenderer
          value={1.0}
          column={createColumn()}
        />
      );

      expect(screen.getByText("100%")).toBeInTheDocument();
    });
  });

  describe("String Values", () => {
    it("parses '75%' string", () => {
      render(
        <ProgressRenderer
          value="75%"
          column={createColumn()}
        />
      );

      expect(screen.getByText("75%")).toBeInTheDocument();
    });

    it("parses '50' string", () => {
      render(
        <ProgressRenderer
          value="50"
          column={createColumn()}
        />
      );

      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("parses decimal string '33.33%'", () => {
      render(
        <ProgressRenderer
          value="33.33%"
          column={createColumn()}
        />
      );

      expect(screen.getByText("33%")).toBeInTheDocument();
    });
  });

  describe("Color Classes", () => {
    it("applies complete color for 100%", () => {
      render(
        <ProgressRenderer
          value={100}
          column={createColumn()}
        />
      );

      const element = screen.getByTitle("100%");
      expect(element).toHaveClass("exo-progress-complete");
    });

    it("applies high color for 75-99%", () => {
      render(
        <ProgressRenderer
          value={75}
          column={createColumn()}
        />
      );

      const element = screen.getByTitle("75%");
      expect(element).toHaveClass("exo-progress-high");
    });

    it("applies medium color for 50-74%", () => {
      render(
        <ProgressRenderer
          value={50}
          column={createColumn()}
        />
      );

      const element = screen.getByTitle("50%");
      expect(element).toHaveClass("exo-progress-medium");
    });

    it("applies low color for 25-49%", () => {
      render(
        <ProgressRenderer
          value={25}
          column={createColumn()}
        />
      );

      const element = screen.getByTitle("25%");
      expect(element).toHaveClass("exo-progress-low");
    });

    it("applies minimal color for 0-24%", () => {
      render(
        <ProgressRenderer
          value={10}
          column={createColumn()}
        />
      );

      const element = screen.getByTitle("10%");
      expect(element).toHaveClass("exo-progress-minimal");
    });
  });

  describe("Progress Bar Structure", () => {
    it("has correct structure with track and fill", () => {
      const { container } = render(
        <ProgressRenderer
          value={50}
          column={createColumn()}
        />
      );

      expect(container.querySelector(".exo-progress-track")).toBeInTheDocument();
      expect(container.querySelector(".exo-progress-fill")).toBeInTheDocument();
      expect(container.querySelector(".exo-progress-label")).toBeInTheDocument();
    });

    it("sets fill width based on progress", () => {
      const { container } = render(
        <ProgressRenderer
          value={60}
          column={createColumn()}
        />
      );

      const fill = container.querySelector(".exo-progress-fill") as HTMLElement;
      expect(fill.style.width).toBe("60%");
    });
  });

  describe("Empty State", () => {
    it("renders dash for null value", () => {
      render(
        <ProgressRenderer
          value={null}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.getByText("-")).toHaveClass("exo-cell-progress-empty");
    });

    it("renders dash for undefined value", () => {
      render(
        <ProgressRenderer
          value={undefined}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for unparseable string", () => {
      render(
        <ProgressRenderer
          value="not a number"
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for NaN", () => {
      render(
        <ProgressRenderer
          value={NaN}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });
});
