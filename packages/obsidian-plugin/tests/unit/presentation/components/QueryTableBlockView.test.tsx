/**
 * RFC 9821a379 (ticket 058bad52) — what the `query-table` block shows:
 * loading (AC8), a named problem (AC7/AC11), the empty text, the table with
 * link cells (AC5) and the footer with the cut and the query time (AC10).
 *
 * revert-verify: `QueryTableBlockView.spec.json`.
 */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";
import {
  QueryTableBlockView,
  type QueryTableViewState,
} from "../../../../src/presentation/components/LayoutBlocks";

const rows = (
  overrides: Partial<Extract<QueryTableViewState, { kind: "rows" }>> = {},
): QueryTableViewState => ({
  kind: "rows",
  columns: ["Эпизод", "Начало"],
  rows: [
    [
      { kind: "link", path: "my/ep-1.md", text: "🔄 Утро" },
      { kind: "text", text: "2026-08-10T07:00:00" },
    ],
  ],
  total: 1,
  elapsedMs: 12,
  emptyText: "Эпизодов нет",
  ...overrides,
});

describe("QueryTableBlockView (RFC 9821a379, ticket 058bad52)", () => {
  it("B1 @req:23f10730-82f7-4037-b566-da79d5fa3378 loading shows «Загрузка…», never the empty text", () => {
    const { container } = render(
      <QueryTableBlockView title="Эпизоды дня" state={{ kind: "loading" }} />,
    );
    expect(
      container.querySelector(".exocortex-layout-block-loading"),
    ).toHaveTextContent("Загрузка…");
    expect(container).not.toHaveTextContent("Эпизодов нет");
    expect(container.querySelector("table")).toBeNull();
  });

  it("B2 @req:23f10730-82f7-4037-b566-da79d5fa3378 an empty result shows the block's empty text and the query time", () => {
    const { container } = render(
      <QueryTableBlockView
        title="Эпизоды дня"
        state={rows({ rows: [], total: 0 })}
      />,
    );
    expect(
      container.querySelector(".exocortex-layout-block-empty"),
    ).toHaveTextContent("Эпизодов нет");
    expect(
      container.querySelector(".exocortex-layout-block-meta"),
    ).toHaveTextContent("запрос 12 мс");
  });

  it("B3 @req:23f10730-82f7-4037-b566-da79d5fa3378 a cut table says how many of how many are shown, with the time", () => {
    const { container } = render(
      <QueryTableBlockView title="Эпизоды дня" state={rows({ total: 5 })} />,
    );
    expect(
      container.querySelector(".exocortex-layout-block-meta"),
    ).toHaveTextContent("показано 1 из 5 · запрос 12 мс");
  });

  it("B4 @req:23f10730-82f7-4037-b566-da79d5fa3378 headers are the columns; a link cell is a link to its asset; a text cell is text", () => {
    const { container } = render(
      <QueryTableBlockView title="Эпизоды дня" state={rows()} />,
    );
    expect(
      Array.from(container.querySelectorAll("th")).map((th) => th.textContent),
    ).toEqual(["Эпизод", "Начало"]);
    const link = container.querySelector("td a.internal-link");
    expect(link).toHaveTextContent("🔄 Утро");
    expect(link).toHaveAttribute("data-href", "my/ep-1.md");
    expect(container.querySelectorAll("td")[1]).toHaveTextContent(
      "2026-08-10T07:00:00",
    );
    expect(container.querySelectorAll("td")[1].querySelector("a")).toBeNull();
  });

  it("B7 @req:23f10730-82f7-4037-b566-da79d5fa3378 a click on a link cell is handled in-app: the browser default is prevented, the asset path is handed over", () => {
    const onLinkClick = jest.fn();
    const { container } = render(
      <QueryTableBlockView
        title="Эпизоды дня"
        state={rows()}
        onLinkClick={onLinkClick}
      />,
    );
    const link = container.querySelector("td a.internal-link");
    expect(fireEvent.click(link as Element)).toBe(false);
    expect(onLinkClick).toHaveBeenCalledWith("my/ep-1.md");
  });

  it("B6 @req:23f10730-82f7-4037-b566-da79d5fa3378 the block's title heads it in every state", () => {
    for (const state of [{ kind: "loading" } as const, rows()]) {
      const { container, unmount } = render(
        <QueryTableBlockView title="Эпизоды дня" state={state} />,
      );
      expect(
        container.querySelector("h3.exocortex-layout-block-title"),
      ).toHaveTextContent("Эпизоды дня");
      unmount();
    }
  });

  it("B5 @req:23f10730-82f7-4037-b566-da79d5fa3378 a problem is shown as an alert with its text", () => {
    const { container } = render(
      <QueryTableBlockView
        title="Эпизоды дня"
        state={{ kind: "message", text: "Запрос «Q»: в запросе не задан $x" }}
      />,
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toHaveTextContent("Запрос «Q»: в запросе не задан $x");
    expect(container.querySelector("table")).toBeNull();
  });
});
