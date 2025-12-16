/**
 * DurationRenderer Unit Tests
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";


import { DurationRenderer } from "@plugin/presentation/renderers/cell-renderers/DurationRenderer";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("DurationRenderer", () => {
  const createColumn = (): LayoutColumn => ({
    uid: "col-1",
    label: "Duration",
    property: "duration",
  });

  describe("Milliseconds Input", () => {
    it("renders milliseconds as formatted duration", () => {
      // 1 hour 30 minutes
      const ms = 90 * 60 * 1000;
      render(
        <DurationRenderer
          value={ms}
          column={createColumn()}
        />
      );

      expect(screen.getByText("1h 30m")).toBeInTheDocument();
      expect(screen.getByTitle(`${ms}ms`)).toBeInTheDocument();
    });

    it("renders duration with days", () => {
      // 1 day 2 hours 30 minutes
      const ms = (24 + 2) * 60 * 60 * 1000 + 30 * 60 * 1000;
      render(
        <DurationRenderer
          value={ms}
          column={createColumn()}
        />
      );

      expect(screen.getByText("1d 2h 30m")).toBeInTheDocument();
    });

    it("renders short duration with seconds", () => {
      // 45 seconds
      const ms = 45 * 1000;
      render(
        <DurationRenderer
          value={ms}
          column={createColumn()}
        />
      );

      expect(screen.getByText("45s")).toBeInTheDocument();
    });

    it("handles zero milliseconds", () => {
      render(
        <DurationRenderer
          value={0}
          column={createColumn()}
        />
      );

      expect(screen.getByText("0s")).toBeInTheDocument();
    });
  });

  describe("ISO 8601 Duration", () => {
    it("parses PT1H30M format", () => {
      render(
        <DurationRenderer
          value="PT1H30M"
          column={createColumn()}
        />
      );

      expect(screen.getByText("1h 30m")).toBeInTheDocument();
    });

    it("parses P1DT2H format", () => {
      render(
        <DurationRenderer
          value="P1DT2H"
          column={createColumn()}
        />
      );

      expect(screen.getByText("1d 2h")).toBeInTheDocument();
    });

    it("parses PT30M15S format", () => {
      render(
        <DurationRenderer
          value="PT30M15S"
          column={createColumn()}
        />
      );

      expect(screen.getByText("30m")).toBeInTheDocument();
    });

    it("handles lowercase iso format", () => {
      render(
        <DurationRenderer
          value="pt1h30m"
          column={createColumn()}
        />
      );

      expect(screen.getByText("1h 30m")).toBeInTheDocument();
    });
  });

  describe("Human-Readable Format", () => {
    it("parses '1h 30m' format", () => {
      render(
        <DurationRenderer
          value="1h 30m"
          column={createColumn()}
        />
      );

      expect(screen.getByText("1h 30m")).toBeInTheDocument();
    });

    it("parses '90min' format", () => {
      render(
        <DurationRenderer
          value="90min"
          column={createColumn()}
        />
      );

      expect(screen.getByText("1h 30m")).toBeInTheDocument();
    });

    it("parses '2 hours 30 minutes' format", () => {
      render(
        <DurationRenderer
          value="2 hours 30 minutes"
          column={createColumn()}
        />
      );

      expect(screen.getByText("2h 30m")).toBeInTheDocument();
    });

    it("parses '1d 12h' format", () => {
      render(
        <DurationRenderer
          value="1d 12h"
          column={createColumn()}
        />
      );

      expect(screen.getByText("1d 12h")).toBeInTheDocument();
    });

    it("parses '30s' format", () => {
      render(
        <DurationRenderer
          value="30s"
          column={createColumn()}
        />
      );

      expect(screen.getByText("30s")).toBeInTheDocument();
    });
  });

  describe("Empty State", () => {
    it("renders dash for null value", () => {
      render(
        <DurationRenderer
          value={null}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.getByText("-")).toHaveClass("exo-cell-duration-empty");
    });

    it("renders dash for undefined value", () => {
      render(
        <DurationRenderer
          value={undefined}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for empty string", () => {
      render(
        <DurationRenderer
          value=""
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for unparseable string", () => {
      render(
        <DurationRenderer
          value="not a duration"
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });

  describe("CSS Classes", () => {
    it("has correct class", () => {
      render(
        <DurationRenderer
          value={60000}
          column={createColumn()}
        />
      );

      expect(screen.getByText("1m")).toHaveClass("exo-cell-duration");
    });
  });
});
