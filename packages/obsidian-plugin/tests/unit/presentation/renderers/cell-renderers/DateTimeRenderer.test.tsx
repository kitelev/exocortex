/**
 * DateTimeRenderer Unit Tests
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";


import {
  DateTimeRenderer,
  DateRenderer,
  TimeRenderer,
} from "@plugin/presentation/renderers/cell-renderers/DateTimeRenderer";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("DateTimeRenderer", () => {
  const createColumn = (): LayoutColumn => ({
    uid: "col-1",
    label: "Created",
    property: "created",
  });

  describe("Date Parsing", () => {
    it("renders Date object", () => {
      const date = new Date("2025-06-15T10:30:00Z");
      render(
        <DateTimeRenderer
          value={date}
          column={createColumn()}
        />
      );

      const element = screen.getByTitle(date.toISOString());
      expect(element).toBeInTheDocument();
      expect(element).toHaveClass("exo-cell-datetime");
    });

    it("renders ISO date string", () => {
      render(
        <DateTimeRenderer
          value="2025-06-15T10:30:00Z"
          column={createColumn()}
        />
      );

      const element = screen.getByTitle("2025-06-15T10:30:00.000Z");
      expect(element).toBeInTheDocument();
    });

    it("renders timestamp number", () => {
      const timestamp = new Date("2025-06-15T10:30:00Z").getTime();
      render(
        <DateTimeRenderer
          value={timestamp}
          column={createColumn()}
        />
      );

      const element = screen.getByTitle("2025-06-15T10:30:00.000Z");
      expect(element).toBeInTheDocument();
    });

    it("renders timestamp string", () => {
      const timestamp = String(new Date("2025-06-15T10:30:00Z").getTime());
      render(
        <DateTimeRenderer
          value={timestamp}
          column={createColumn()}
        />
      );

      const element = screen.getByTitle("2025-06-15T10:30:00.000Z");
      expect(element).toBeInTheDocument();
    });
  });

  describe("Empty State", () => {
    it("renders dash for null value", () => {
      render(
        <DateTimeRenderer
          value={null}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.getByText("-")).toHaveClass("exo-cell-datetime-empty");
    });

    it("renders dash for undefined value", () => {
      render(
        <DateTimeRenderer
          value={undefined}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for invalid date string", () => {
      render(
        <DateTimeRenderer
          value="not-a-date"
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for invalid Date object", () => {
      render(
        <DateTimeRenderer
          value={new Date("invalid")}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });
});

describe("DateRenderer", () => {
  const createColumn = (): LayoutColumn => ({
    uid: "col-1",
    label: "Date",
    property: "date",
  });

  it("renders date without time", () => {
    const date = new Date("2025-06-15T10:30:00Z");
    render(
      <DateRenderer
        value={date}
        column={createColumn()}
      />
    );

    const element = screen.getByTitle(date.toISOString());
    expect(element).toBeInTheDocument();
    expect(element).toHaveClass("exo-cell-date");
  });

  it("renders dash for null value", () => {
    render(
      <DateRenderer
        value={null}
        column={createColumn()}
      />
    );

    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText("-")).toHaveClass("exo-cell-date-empty");
  });
});

describe("TimeRenderer", () => {
  const createColumn = (): LayoutColumn => ({
    uid: "col-1",
    label: "Time",
    property: "time",
  });

  it("renders time without date", () => {
    const date = new Date("2025-06-15T10:30:00Z");
    render(
      <TimeRenderer
        value={date}
        column={createColumn()}
      />
    );

    const element = screen.getByTitle(date.toISOString());
    expect(element).toBeInTheDocument();
    expect(element).toHaveClass("exo-cell-time");
  });

  it("renders dash for null value", () => {
    render(
      <TimeRenderer
        value={null}
        column={createColumn()}
      />
    );

    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText("-")).toHaveClass("exo-cell-time-empty");
  });
});
