/**
 * ExocortexQuickSwitcher - Custom Quick Switcher showing asset labels
 *
 * Provides a FuzzySuggestModal that displays exo__Asset_label instead of
 * filenames (UUIDs) for better navigation experience.
 *
 * Uses the same label resolution infrastructure as GraphViewPatch and other
 * label display components.
 */
import { App, FuzzySuggestModal, FuzzyMatch, TFile } from "obsidian";
import type { DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";

/**
 * Quick switcher modal that shows asset labels instead of filenames
 */
export class ExocortexQuickSwitcher extends FuzzySuggestModal<TFile> {
  private resolver: DisplayNameResolver;
  private labelCache: Map<string, string> = new Map();

  constructor(app: App, displayNameSettings: DisplayNameSettings) {
    super(app);
    this.resolver = new DisplayNameResolver(displayNameSettings);
    this.setPlaceholder("Search by asset label or filename...");
    this.buildLabelCache();
  }

  /**
   * Build a cache of labels for all markdown files
   * This provides fast lookup during fuzzy matching
   */
  private buildLabelCache(): void {
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const label = this.getDisplayName(file);
      this.labelCache.set(file.path, label);
    }
  }

  /**
   * Get display name for a file using DisplayNameResolver
   */
  private getDisplayName(file: TFile): string {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    if (!frontmatter) {
      return file.basename;
    }

    const metadata = this.buildTemplateMetadata(frontmatter, file);
    const createdDate = file.stat?.ctime ? new Date(file.stat.ctime) : undefined;

    const displayName = this.resolver.resolve({
      metadata,
      basename: file.basename,
      createdDate,
    });

    return displayName || file.basename;
  }

  /**
   * Build metadata object for template rendering, merging frontmatter with prototype data
   */
  private buildTemplateMetadata(
    frontmatter: Record<string, unknown>,
    file: TFile
  ): Record<string, unknown> {
    const metadata = { ...frontmatter };

    // If label is missing, try to get from prototype
    if (!metadata.exo__Asset_label) {
      const prototypeRef = metadata.exo__Asset_prototype;
      if (prototypeRef) {
        const prototypePath =
          typeof prototypeRef === "string"
            ? prototypeRef.replace(/^\[\[|\]\]$/g, "").replace(/^"|"$/g, "").trim()
            : null;

        if (prototypePath) {
          let prototypeFile = this.app.metadataCache.getFirstLinkpathDest(
            prototypePath,
            file.path
          );

          if (!prototypeFile && !prototypePath.endsWith(".md")) {
            prototypeFile = this.app.metadataCache.getFirstLinkpathDest(
              prototypePath + ".md",
              file.path
            );
          }

          if (prototypeFile instanceof TFile) {
            const prototypeCache = this.app.metadataCache.getFileCache(prototypeFile);
            const prototypeMetadata = prototypeCache?.frontmatter;

            if (prototypeMetadata?.exo__Asset_label) {
              metadata.exo__Asset_label = prototypeMetadata.exo__Asset_label;
            }
          }
        }
      }
    }

    return metadata;
  }

  /**
   * Get all markdown files for the suggestions list
   */
  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  /**
   * Get the display text for fuzzy matching
   * This is what the user searches against
   */
  getItemText(file: TFile): string {
    const cachedLabel = this.labelCache.get(file.path);
    if (cachedLabel) {
      return cachedLabel;
    }

    // Fallback to computing if not cached
    return this.getDisplayName(file);
  }

  /**
   * Render a suggestion item in the dropdown
   */
  override renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
    const file = match.item;
    const label = this.getItemText(file);

    // Create main container
    const suggestionContent = el.createDiv({ cls: "exocortex-quick-switcher-item" });

    // Display label
    suggestionContent.createEl("span", {
      text: label,
      cls: "exocortex-quick-switcher-label",
    });

    // Show file path as secondary info if label differs from basename
    if (label !== file.basename) {
      suggestionContent.createEl("span", {
        text: file.path,
        cls: "exocortex-quick-switcher-path",
      });
    }
  }

  /**
   * Handle selection - open the chosen file
   */
  onChooseItem(file: TFile): void {
    this.app.workspace.openLinkText(file.path, "");
  }
}
