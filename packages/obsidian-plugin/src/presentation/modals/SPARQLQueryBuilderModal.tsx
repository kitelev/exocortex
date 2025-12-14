import { Modal, App, Notice, TFile, Plugin } from "obsidian";
import React from "react";
import type { SolutionMapping, Triple } from "exocortex";
import { ApplicationErrorHandler } from "exocortex";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { QueryBuilder } from '@plugin/presentation/components/sparql/QueryBuilder';
import { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';
import { ErrorBoundary } from '@plugin/presentation/components/ErrorBoundary';

export class SPARQLQueryBuilderModal extends Modal {
  private plugin: Plugin;
  private reactRenderer: ReactRenderer;
  private queryService: SPARQLQueryService;
  private errorHandler: ApplicationErrorHandler;
  private isInitialized = false;

  constructor(app: App, plugin: Plugin) {
    super(app);
    this.plugin = plugin;
    this.reactRenderer = new ReactRenderer();
    this.queryService = new SPARQLQueryService(app);
    this.errorHandler = new ApplicationErrorHandler();
  }

  override async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("sparql-query-builder-modal");

    const titleEl = contentEl.createEl("div", { cls: "modal-title" });
    titleEl.textContent = "Sparql query builder";

    const container = contentEl.createEl("div", { cls: "sparql-query-builder-container" });

    const loadingDiv = container.createEl("div", { cls: "sparql-loading" });
    loadingDiv.textContent = "Loading query engine...";

    try {
      await this.ensureQueryServiceInitialized();
      container.innerHTML = "";

      this.reactRenderer.render(
        container,
        React.createElement(
          ErrorBoundary,
          {
            children: React.createElement(QueryBuilder, {
              app: this.app,
              onExecuteQuery: this.executeQuery.bind(this),
              onAssetClick: this.handleAssetClick.bind(this),
              onCopyQuery: this.handleCopyQuery.bind(this),
            }),
            onError: (error, errorInfo) => {
              this.errorHandler.handle(error, {
                componentStack: errorInfo.componentStack,
                timestamp: new Date().toISOString(),
              });
            },
          }
        )
      );
    } catch (error) {
      container.innerHTML = "";
      const errorDiv = container.createEl("div", { cls: "sparql-error" });
      errorDiv.textContent = `Failed to load query engine: ${error instanceof Error ? error.message : String(error)}`;
      console.error("[Exocortex Query Builder] Failed to load:", error);
    }
  }

  override onClose(): void {
    const { contentEl } = this;
    this.reactRenderer.unmount(contentEl);
    contentEl.empty();
  }

  private async ensureQueryServiceInitialized(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.queryService.initialize();
    this.isInitialized = true;
  }

  private async executeQuery(query: string): Promise<SolutionMapping[] | Triple[]> {
    return await this.queryService.query(query);
  }

  private handleAssetClick(path: string, event?: React.MouseEvent): void {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!file) {
      new Notice(`file not found: ${path}`);
      return;
    }

    // Type guard: openFile requires TFile, not TAbstractFile (which could be TFolder)
    if (!(file instanceof TFile)) {
      new Notice(`path is not a file: ${path}`);
      return;
    }

    const newLeaf = event?.ctrlKey || event?.metaKey;

    if (newLeaf) {
      const leaf = this.plugin.app.workspace.getLeaf("tab");
      leaf.openFile(file);
    } else {
      this.plugin.app.workspace.getLeaf().openFile(file);
      this.close();
    }
  }

  private handleCopyQuery(_query: string): void {
    new Notice("Query copied to clipboard", 2000);
  }
}
