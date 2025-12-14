import { test, expect } from "@playwright/experimental-ct-react";
import { QueryBuilder } from "../../../src/presentation/components/sparql/QueryBuilder";
import type { SolutionMapping, Triple } from "exocortex";

test.describe("QueryBuilder Component", () => {
  const mockApp = {
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  } as any;

  const mockExecuteQuery = async (query: string): Promise<SolutionMapping[] | Triple[]> => {
    return [];
  };

  const mockAssetClick = () => {};

  test("should mount QueryBuilder component", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    await expect(component).toBeAttached();
  });

  test("should display template categories", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    const categorySelect = component.locator("select.query-builder-select");
    await expect(categorySelect).toBeVisible();

    const options = await categorySelect.locator("option").allTextContents();
    expect(options).toContain("all templates");
    expect(options).toContain("basic queries");
    expect(options).toContain("task management");
  });

  test("should display template cards when category selected", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    await expect(component.locator(".query-builder-template-card").first()).toBeVisible();
  });

  test("should populate query textarea when template selected", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    await component.locator(".query-builder-template-card").first().click();

    const textarea = component.locator("textarea.query-builder-textarea");
    const textareaValue = await textarea.inputValue();
    expect(textareaValue.length).toBeGreaterThan(0);
    expect(textareaValue).toContain("SELECT");
  });

  test("should enable run button when query present", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    const runButton = component.locator("button:has-text('run query')");
    await expect(runButton).toBeDisabled();

    await component.locator(".query-builder-template-card").first().click();

    await expect(runButton).toBeEnabled();
  });

  test("should enable copy button when query present", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    const copyButton = component.locator("button:has-text('copy')");
    await expect(copyButton).toBeDisabled();

    await component.locator(".query-builder-template-card").first().click();

    await expect(copyButton).toBeEnabled();
  });

  test("should allow custom query editing", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    const textarea = component.locator("textarea.query-builder-textarea");
    const customQuery = "SELECT ?s WHERE { ?s ?p ?o }";
    await textarea.fill(customQuery);

    const textareaValue = await textarea.inputValue();
    expect(textareaValue).toBe(customQuery);
  });

  test("should clear query and results when clear button clicked", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    await component.locator(".query-builder-template-card").first().click();

    const textarea = component.locator("textarea.query-builder-textarea");
    const textareaValueBefore = await textarea.inputValue();
    expect(textareaValueBefore.length).toBeGreaterThan(0);

    const clearButton = component.locator("button:has-text('clear')");
    await clearButton.click();

    const textareaValueAfter = await textarea.inputValue();
    expect(textareaValueAfter).toBe("");
  });

  test("should filter templates by category", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    const categorySelect = component.locator("select.query-builder-select");
    await categorySelect.selectOption("tasks");

    const templateCards = component.locator(".query-builder-template-card");
    const count = await templateCards.count();
    expect(count).toBeGreaterThan(0);

    const firstCardText = await templateCards.first().textContent();
    expect(firstCardText?.toLowerCase()).toContain("task");
  });

  test("should show empty preview state initially", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    await expect(component.locator(".query-builder-preview-empty")).toBeVisible();
    await expect(component.locator("text=select a template or write a query")).toBeVisible();
  });

  test("should display template info when template selected", async ({ mount }) => {
    const component = await mount(
      <QueryBuilder
        app={mockApp}
        onExecuteQuery={mockExecuteQuery}
        onAssetClick={mockAssetClick}
      />
    );

    await component.locator(".query-builder-template-card").first().click();

    await expect(component.locator(".query-builder-template-info")).toBeVisible();
    await expect(component.locator("text=template:")).toBeVisible();
  });
});
