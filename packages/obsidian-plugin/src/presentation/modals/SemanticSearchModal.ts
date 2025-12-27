import { App, Modal, Setting, TFile, debounce } from "obsidian";
import type { SemanticSearchResult } from "exocortex";
import type { SemanticSearchManager } from "../../infrastructure/semantic-search";

/**
 * Modal for semantic search functionality.
 * Allows users to search notes by meaning and find similar content.
 */
export class SemanticSearchModal extends Modal {
  private searchManager: SemanticSearchManager;
  private resultsContainer: HTMLDivElement | null = null;
  private statusContainer: HTMLDivElement | null = null;
  private currentFile: TFile | null;

  constructor(
    app: App,
    searchManager: SemanticSearchManager,
    currentFile: TFile | null = null
  ) {
    super(app);
    this.searchManager = searchManager;
    this.currentFile = currentFile;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("exocortex-semantic-search-modal");

    // Title
    contentEl.createEl("h2", { text: "Semantic search" });

    // Status indicator
    this.statusContainer = contentEl.createDiv({
      cls: "semantic-search-status",
    });
    this.updateStatus();

    // Search input
    const searchContainer = contentEl.createDiv({
      cls: "semantic-search-input-container",
    });

    new Setting(searchContainer)
      .setName("Search by meaning")
      .setDesc("Enter a query to find semantically similar notes")
      .addText((text) => {
        text
          .setPlaceholder("What are you looking for?")
          .onChange(
            debounce(async (value: string) => {
              await this.performSearch(value);
            }, 300)
          );
        text.inputEl.focus();
      });

    // Find similar button (if current file)
    if (this.currentFile && this.searchManager.isConfigured()) {
      new Setting(searchContainer)
        .setName("Find similar")
        .setDesc(`Find notes similar to: ${this.currentFile.basename}`)
        .addButton((button) =>
          button
            .setButtonText("Find similar notes")
            .setCta()
            .onClick(async () => {
              await this.findSimilar();
            })
        );
    }

    // Results container
    this.resultsContainer = contentEl.createDiv({
      cls: "semantic-search-results",
    });

    // Instructions
    const instructions = contentEl.createDiv({
      cls: "semantic-search-instructions",
    });
    instructions.createEl("p", {
      text: "Semantic search finds notes by meaning, not just keywords. Try describing what you're looking for.",
      cls: "setting-item-description",
    });
  }

  override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * Update status display
   */
  private updateStatus(): void {
    if (!this.statusContainer) {
      return;
    }

    this.statusContainer.empty();

    if (!this.searchManager.isConfigured()) {
      this.statusContainer.createEl("p", {
        text: "Semantic search is not configured. Add your OpenAI API key in settings.",
        cls: "semantic-search-warning",
      });
      return;
    }

    const indexedCount = this.searchManager.getIndexedCount();
    const status = this.searchManager.getIndexingStatus();

    if (status.isIndexing) {
      this.statusContainer.createEl("p", {
        text: `Indexing: ${status.indexedFiles}/${status.totalFiles} (${status.progress}%)`,
        cls: "semantic-search-indexing",
      });
    } else if (indexedCount === 0) {
      this.statusContainer.createEl("p", {
        text: "No notes indexed yet. Use the 'Index all notes' command to build the index.",
        cls: "semantic-search-info",
      });
    } else {
      this.statusContainer.createEl("p", {
        text: `${indexedCount} notes indexed`,
        cls: "semantic-search-ready",
      });
    }
  }

  /**
   * Perform semantic search
   */
  private async performSearch(query: string): Promise<void> {
    if (!this.resultsContainer) {
      return;
    }

    this.resultsContainer.empty();

    if (!query.trim()) {
      return;
    }

    if (!this.searchManager.isConfigured()) {
      this.resultsContainer.createEl("p", {
        text: "Semantic search is not configured",
        cls: "semantic-search-error",
      });
      return;
    }

    try {
      const loadingEl = this.resultsContainer.createEl("p", {
        text: "Searching...",
        cls: "semantic-search-loading",
      });

      const results = await this.searchManager.search(query);

      loadingEl.remove();

      if (results.length === 0) {
        this.resultsContainer.createEl("p", {
          text: "No matching notes found",
          cls: "semantic-search-no-results",
        });
        return;
      }

      this.renderResults(results);
    } catch (error) {
      this.resultsContainer.createEl("p", {
        text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        cls: "semantic-search-error",
      });
    }
  }

  /**
   * Find notes similar to current file
   */
  private async findSimilar(): Promise<void> {
    if (!this.resultsContainer || !this.currentFile) {
      return;
    }

    this.resultsContainer.empty();

    if (!this.searchManager.isConfigured()) {
      this.resultsContainer.createEl("p", {
        text: "Semantic search is not configured",
        cls: "semantic-search-error",
      });
      return;
    }

    try {
      const loadingEl = this.resultsContainer.createEl("p", {
        text: "Finding similar notes...",
        cls: "semantic-search-loading",
      });

      const results = await this.searchManager.findSimilar(this.currentFile);

      loadingEl.remove();

      if (results.length === 0) {
        this.resultsContainer.createEl("p", {
          text: "No similar notes found. Try indexing more notes.",
          cls: "semantic-search-no-results",
        });
        return;
      }

      this.renderResults(results);
    } catch (error) {
      this.resultsContainer.createEl("p", {
        text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        cls: "semantic-search-error",
      });
    }
  }

  /**
   * Render search results
   */
  private renderResults(results: SemanticSearchResult[]): void {
    if (!this.resultsContainer) {
      return;
    }

    const list = this.resultsContainer.createEl("ul", {
      cls: "semantic-search-results-list",
    });

    for (const result of results) {
      const item = list.createEl("li", {
        cls: "semantic-search-result-item",
      });

      const link = item.createEl("a", {
        cls: "semantic-search-result-link",
        href: "#",
      });

      // Score badge
      const scorePercent = Math.round(result.score * 100);
      link.createEl("span", {
        text: `${scorePercent}%`,
        cls: "semantic-search-score",
      });

      // Title/label
      const title = result.label || this.getFilenameFromPath(result.path);
      link.createEl("span", {
        text: title,
        cls: "semantic-search-title",
      });

      // Instance class badge
      if (result.instanceClass) {
        link.createEl("span", {
          text: this.formatClassName(result.instanceClass),
          cls: "semantic-search-class",
        });
      }

      // Path (if different from title)
      if (result.label) {
        link.createEl("span", {
          text: result.path,
          cls: "semantic-search-path",
        });
      }

      // Click handler
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.openFile(result.path);
      });
    }
  }

  /**
   * Open a file by path
   */
  private openFile(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      this.close();
      this.app.workspace.openLinkText(path, "");
    }
  }

  /**
   * Extract filename from path
   */
  private getFilenameFromPath(path: string): string {
    const parts = path.split("/");
    const filename = parts[parts.length - 1];
    return filename.replace(/\.md$/, "");
  }

  /**
   * Format class name for display
   */
  private formatClassName(className: string): string {
    // Remove namespace prefix and format
    return className
      .replace(/^(ems|exo|ims)__/, "")
      .replace(/([A-Z])/g, " $1")
      .trim();
  }
}
