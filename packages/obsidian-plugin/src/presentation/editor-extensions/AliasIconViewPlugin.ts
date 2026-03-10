import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
} from "@codemirror/view";
import { RangeSetBuilder, Extension } from "@codemirror/state";
import { TFile } from "obsidian";
import type { App, MetadataCache } from "obsidian";
import { AliasIconWidget, type AliasIconClickResult } from "./AliasIconWidget";
import { RedundantAliasRemoveWidget, type RedundantAliasRemoveClickResult } from "./RedundantAliasRemoveWidget";
import { WikilinkLabelViewPlugin } from "./WikilinkLabelViewPlugin";

/**
 * Represents a parsed wikilink with its position and extracted components.
 */
interface WikilinkMatch {
  from: number;
  to: number;
  targetPath: string;
  alias: string;
}

/**
 * Service interface for alias management operations.
 */
export interface IAliasService {
  getAliases(file: TFile): string[];
  addAlias(file: TFile, alias: string): Promise<void>;
}

/**
 * ViewPlugin that adds inline icons next to wikilinks with aliases
 * that are not present in the target asset's frontmatter aliases property.
 *
 * @example
 * Given a wikilink: [[Target Asset|my alias]]
 * If "my alias" is not in Target Asset's `aliases` frontmatter property,
 * an icon appears next to the wikilink. Clicking adds the alias.
 */
export class AliasIconViewPlugin {
  decorations: DecorationSet;
  private app: App;
  private metadataCache: MetadataCache;
  private aliasService: IAliasService;
  private notifyUser: (message: string) => void;
  private pendingAliases: Set<string> = new Set();
  private pendingRemovals: Set<string> = new Set();
  private view: EditorView;

  constructor(
    view: EditorView,
    app: App,
    metadataCache: MetadataCache,
    aliasService: IAliasService,
    notifyUser: (message: string) => void,
  ) {
    this.app = app;
    this.metadataCache = metadataCache;
    this.aliasService = aliasService;
    this.notifyUser = notifyUser;
    this.view = view;
    this.decorations = this.buildDecorations(view);
  }

  private getPendingKey(targetPath: string, alias: string): string {
    return `${targetPath}|${alias}`;
  }

  isPending(targetPath: string, alias: string): boolean {
    return this.pendingAliases.has(this.getPendingKey(targetPath, alias));
  }

  markAsPending(targetPath: string, alias: string): void {
    this.pendingAliases.add(this.getPendingKey(targetPath, alias));
  }

  unmarkAsPending(targetPath: string, alias: string): void {
    this.pendingAliases.delete(this.getPendingKey(targetPath, alias));
  }

  private getRemovalKey(from: number, to: number): string {
    return `${from}|${to}`;
  }

  isRemovalPending(from: number, to: number): boolean {
    return this.pendingRemovals.has(this.getRemovalKey(from, to));
  }

  markRemovalAsPending(from: number, to: number): void {
    this.pendingRemovals.add(this.getRemovalKey(from, to));
  }

  unmarkRemovalAsPending(from: number, to: number): void {
    this.pendingRemovals.delete(this.getRemovalKey(from, to));
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const wikilinks = this.findWikilinksWithAliases(view);

    // Sort by position (required by RangeSetBuilder)
    wikilinks.sort((a, b) => a.to - b.to);

    for (const wikilink of wikilinks) {
      const targetFile = this.resolveTargetFile(wikilink.targetPath);

      if (!targetFile) {
        // Target file doesn't exist, skip
        continue;
      }

      // Check if alias equals exo__Asset_label (redundant alias)
      const targetLabel = WikilinkLabelViewPlugin.resolveLabel(this.metadataCache, wikilink.targetPath);

      if (targetLabel && wikilink.alias === targetLabel && !this.isRemovalPending(wikilink.from, wikilink.to)) {
        // Alias is redundant — show remove icon
        const widget = new RedundantAliasRemoveWidget(
          wikilink.from,
          wikilink.to,
          targetFile.path,
          wikilink.alias,
          (from: number, to: number, _path: string, _alias: string) =>
            this.handleRemoveRedundantAlias(from, to),
        );

        const decoration = Decoration.widget({
          widget,
          side: 1,
        });

        builder.add(wikilink.to, wikilink.to, decoration);
      } else {
        const existingAliases = this.aliasService.getAliases(targetFile);

        // Check if alias is already in target's aliases or pending addition
        if (!existingAliases.includes(wikilink.alias) && !this.isPending(targetFile.path, wikilink.alias)) {
          const widget = new AliasIconWidget(
            targetFile.path,
            wikilink.alias,
            (path: string, alias: string) => this.handleAddAlias(path, alias),
          );

          const decoration = Decoration.widget({
            widget,
            side: 1,
          });

          builder.add(wikilink.to, wikilink.to, decoration);
        }
      }
    }

    return builder.finish();
  }

  /**
   * Handle clicking the remove redundant alias icon.
   * Transforms [[uuid|Label]] → [[uuid]] by editing the document.
   */
  private async handleRemoveRedundantAlias(
    from: number,
    to: number,
  ): Promise<RedundantAliasRemoveClickResult> {
    this.markRemovalAsPending(from, to);

    try {
      const currentText = this.view.state.doc.sliceString(from, to);

      // Parse [[target|alias]] to extract target
      const match = currentText.match(/^\[\[([^\]|]+)\|[^\]]+\]\]$/);
      if (!match) {
        this.unmarkRemovalAsPending(from, to);
        return { success: false, error: "Could not parse wikilink" };
      }

      const target = match[1];
      const newText = `[[${target}]]`;

      this.view.dispatch({
        changes: { from, to, insert: newText },
      });

      this.notifyUser("Removed redundant alias");
      setTimeout(() => this.unmarkRemovalAsPending(from, to), 100);
      return { success: true };
    } catch (error) {
      this.unmarkRemovalAsPending(from, to);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.notifyUser(`Failed to remove alias: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Find all wikilinks with aliases in the current view.
   * Wikilinks with aliases have the format: [[target|alias]]
   */
  private findWikilinksWithAliases(view: EditorView): WikilinkMatch[] {
    const matches: WikilinkMatch[] = [];
    const doc = view.state.doc;
    const { from, to } = view.viewport;

    // Use regex to find wikilinks with aliases
    // Pattern: [[target|alias]] where target and alias are captured
    const wikilinkPattern = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
    const text = doc.sliceString(from, to);

    let match;
    while ((match = wikilinkPattern.exec(text)) !== null) {
      const targetPath = match[1].trim();
      const alias = match[2].trim();

      // Don't process if alias is same as target (no need for icon)
      if (alias !== targetPath && alias.length > 0) {
        matches.push({
          from: from + match.index,
          to: from + match.index + match[0].length,
          targetPath,
          alias,
        });
      }
    }

    return matches;
  }

  /**
   * Resolve a wikilink target to a TFile.
   * Handles both with and without .md extension.
   */
  private resolveTargetFile(targetPath: string): TFile | null {
    let file = this.metadataCache.getFirstLinkpathDest(targetPath, "");

    // Try with .md extension if not found
    if (!file && !targetPath.endsWith(".md")) {
      file = this.metadataCache.getFirstLinkpathDest(targetPath + ".md", "");
    }

    return file;
  }

  /**
   * Handle clicking the add alias icon.
   * Returns a result to support optimistic UI (icon reappears on failure).
   * Uses pending state to prevent re-render showing icon while operation in progress.
   */
  private async handleAddAlias(targetPath: string, alias: string): Promise<AliasIconClickResult> {
    // Mark as pending immediately to prevent re-render showing icon
    this.markAsPending(targetPath, alias);

    const file = this.app.vault.getAbstractFileByPath(targetPath);

    // Use instanceof to properly check for TFile
    if (file instanceof TFile) {
      try {
        await this.aliasService.addAlias(file, alias);
        this.notifyUser(`Added "${alias}" to aliases`);
        // Keep pending briefly - MetadataCache update will remove need for icon anyway
        // Clear after short delay to ensure MetadataCache has updated
        setTimeout(() => this.unmarkAsPending(targetPath, alias), 100);
        return { success: true };
      } catch (error) {
        // Clear pending on failure to allow icon to reappear
        this.unmarkAsPending(targetPath, alias);
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.notifyUser(`Failed to add alias: ${errorMessage}`);
        return { success: false, error: errorMessage };
      }
    }

    // File not found or not a TFile - clear pending
    this.unmarkAsPending(targetPath, alias);
    this.notifyUser(`Failed to add alias: file not found`);
    return { success: false, error: "File not found" };
  }
}

/**
 * Creates the editor extension for alias icon decorations.
 */
export function createAliasIconExtension(
  app: App,
  metadataCache: MetadataCache,
  aliasService: IAliasService,
  notifyUser: (message: string) => void,
): Extension {
  return ViewPlugin.define(
    (view) => new AliasIconViewPlugin(view, app, metadataCache, aliasService, notifyUser),
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}
