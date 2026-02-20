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
   * Returns concatenated string: label + aliases + UID for multi-field search
   */
  getItemText(file: TFile): string {
    const cachedLabel = this.labelCache.get(file.path);
    const label = cachedLabel || this.getDisplayName(file);

    // Get aliases from frontmatter
    const cache = this.app.metadataCache.getFileCache(file);
    const aliases = cache?.frontmatter?.aliases || [];

    // Handle both array and string aliases
    const aliasArray = Array.isArray(aliases) ? aliases : (aliases ? [aliases] : []);

    // Concatenate all searchable fields: label + aliases + UID
    const searchableText = [
      label,
      ...aliasArray,
      file.basename,
    ].join(' ');

    return searchableText;
  }

  /**
   * Render a suggestion item in the dropdown
   */
  override renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
    const file = match.item;
    // Get just the display label for rendering (not the full searchable text)
    const cachedLabel = this.labelCache.get(file.path);
    const label = cachedLabel || this.getDisplayName(file);

    // Get classes from frontmatter
    const cache = this.app.metadataCache.getFileCache(file);
    const classes = cache?.frontmatter?.exo__Instance_class || [];

    // Create main container
    const suggestionContent = el.createDiv({ cls: "exocortex-quick-switcher-item" });

    // Display label
    suggestionContent.createEl("span", {
      text: label,
      cls: "exocortex-quick-switcher-label",
    });

    // Show classes instead of path if available
    const classArray = Array.isArray(classes) ? classes : (classes ? [classes] : []);
    if (classArray.length > 0) {
      const classNames = classArray.map((c: string) => this.extractClassName(c)).join(', ');
      suggestionContent.createEl("span", {
        text: classNames,
        cls: "exocortex-quick-switcher-classes",
      });
    }
  }

  /**
   * Extract class name from IRI or return the string as-is
   * E.g., "https://example.org/ontology#ems__Project" -> "ems__Project"
   */
  private extractClassName(classIRI: string): string {
    // Extract last segment after # or /
    const match = classIRI.match(/[#/]([^#/]+)$/);
    return match ? match[1] : classIRI;
  }

  /**
   * Handle selection - open the chosen file
   */
  onChooseItem(file: TFile): void {
    this.app.workspace.openLinkText(file.path, "");
  }
}
