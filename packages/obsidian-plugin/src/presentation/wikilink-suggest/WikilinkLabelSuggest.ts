/**
 * WikilinkLabelSuggest - EditorSuggest showing asset labels in [[ autocomplete
 *
 * Intercepts the [[ wikilink autocomplete trigger and shows asset labels
 * instead of filenames (UUIDs) for a better user experience.
 *
 * When a suggestion is selected:
 * - If file has a label: inserts [[uuid|label]]
 * - If file has no label: inserts [[uuid]]
 */
import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";
import type { DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import type ExocortexPlugin from "@plugin/ExocortexPlugin";

interface WikilinkSuggestion {
  file: TFile;
  label: string;
  hasLabel: boolean;
}

/**
 * Editor suggest that provides asset label suggestions when typing [[
 */
export class WikilinkLabelSuggest extends EditorSuggest<WikilinkSuggestion> {
  private plugin: ExocortexPlugin;
  private resolver: DisplayNameResolver;

  constructor(plugin: ExocortexPlugin, displayNameSettings: DisplayNameSettings) {
    super(plugin.app);
    this.plugin = plugin;
    this.resolver = new DisplayNameResolver(displayNameSettings);
  }

  /**
   * Update the resolver when settings change
   */
  updateSettings(displayNameSettings: DisplayNameSettings): void {
    this.resolver = new DisplayNameResolver(displayNameSettings);
  }

  /**
   * Check if the feature is enabled in settings
   */
  private isEnabled(): boolean {
    return this.plugin.settings.showLabelsInWikilinkAutocomplete;
  }

  /**
   * Detect when to show suggestions (after typing [[)
   */
  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null
  ): EditorSuggestTriggerInfo | null {
    // Check if feature is enabled
    if (!this.isEnabled()) {
      return null;
    }

    // Get the text before the cursor on the current line
    const line = editor.getLine(cursor.line);
    const textBeforeCursor = line.substring(0, cursor.ch);

    // Look for [[ pattern that isn't yet closed
    // Pattern: [[ followed by any text that doesn't contain ] or |
    const match = textBeforeCursor.match(/\[\[([^\]|]*)$/);

    if (!match) {
      return null;
    }

    const query = match[1];

    return {
      start: { line: cursor.line, ch: cursor.ch - query.length },
      end: cursor,
      query,
    };
  }

  /**
   * Get suggestions based on the query
   */
  getSuggestions(context: EditorSuggestContext): WikilinkSuggestion[] {
    const query = context.query.toLowerCase();
    const files = this.app.vault.getMarkdownFiles();
    const suggestions: WikilinkSuggestion[] = [];

    for (const file of files) {
      const { label, hasLabel } = this.getDisplayInfo(file);

      // Match against both label and filename
      const labelLower = label.toLowerCase();
      const basenameLower = file.basename.toLowerCase();
      const pathLower = file.path.toLowerCase();

      if (
        labelLower.includes(query) ||
        basenameLower.includes(query) ||
        pathLower.includes(query)
      ) {
        suggestions.push({
          file,
          label,
          hasLabel,
        });
      }
    }

    // Sort by relevance: exact label match first, then starts-with, then contains
    suggestions.sort((a, b) => {
      const aLabel = a.label.toLowerCase();
      const bLabel = b.label.toLowerCase();

      // Exact match highest priority
      if (aLabel === query && bLabel !== query) return -1;
      if (bLabel === query && aLabel !== query) return 1;

      // Starts with next priority
      const aStarts = aLabel.startsWith(query);
      const bStarts = bLabel.startsWith(query);
      if (aStarts && !bStarts) return -1;
      if (bStarts && !aStarts) return 1;

      // Alphabetical order otherwise
      return aLabel.localeCompare(bLabel);
    });

    // Limit results for performance
    return suggestions.slice(0, 50);
  }

  /**
   * Get display info for a file
   */
  private getDisplayInfo(file: TFile): { label: string; hasLabel: boolean } {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    if (!frontmatter) {
      return { label: file.basename, hasLabel: false };
    }

    const metadata = this.buildTemplateMetadata(frontmatter, file);
    const createdDate = file.stat?.ctime ? new Date(file.stat.ctime) : undefined;

    const displayName = this.resolver.resolve({
      metadata,
      basename: file.basename,
      createdDate,
    });

    if (displayName && displayName !== file.basename) {
      return { label: displayName, hasLabel: true };
    }

    return { label: file.basename, hasLabel: false };
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
   * Render a suggestion item
   */
  renderSuggestion(suggestion: WikilinkSuggestion, el: HTMLElement): void {
    const { file, label, hasLabel } = suggestion;

    // Create container
    const container = el.createDiv({ cls: "exocortex-wikilink-suggest-item" });

    // Display label
    container.createEl("span", {
      text: label,
      cls: "exocortex-wikilink-suggest-label",
    });

    // Show file path if label differs from basename
    if (hasLabel) {
      container.createEl("span", {
        text: file.path,
        cls: "exocortex-wikilink-suggest-path",
      });
    }
  }

  /**
   * Handle selection - insert the wikilink
   */
  selectSuggestion(
    suggestion: WikilinkSuggestion,
    _evt: MouseEvent | KeyboardEvent
  ): void {
    if (!this.context) return;

    const { file, label, hasLabel } = suggestion;
    const { editor, start, end } = this.context;

    // Determine what to insert
    // If file has a custom label, use [[uuid|label]] format
    // Otherwise just use [[uuid]]
    let insertText: string;
    if (hasLabel) {
      insertText = `${file.basename}|${label}]]`;
    } else {
      insertText = `${file.basename}]]`;
    }

    // Replace the query text with the link
    editor.replaceRange(insertText, start, end);

    // Position cursor after the inserted text
    const newCursorPos = {
      line: start.line,
      ch: start.ch + insertText.length,
    };
    editor.setCursor(newCursorPos);
  }
}
