import { TFile, WorkspaceLeaf, Plugin, CachedMetadata, MarkdownView } from "obsidian";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import type { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import type { ExocortexSettings, DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

/**
 * InlineTitlePatch — rewrites the inline title (the big H1 Obsidian shows above
 * the note body in Reading Mode and Live Preview) to display `exo__Asset_label`
 * instead of the raw filename.
 *
 * For class-definition notes in the starter-kit (UUID-named files) this turns
 * a header like "1b20a8f0-d745-4e93-91db-4531b3df120e" into "ems__Task". See
 * issue #2806.
 *
 * Strategy:
 * - Reuses `DisplayNameResolver` + `PrintNameRuleService` (same stack as
 *   `TabTitlePatch`) so tab titles and inline titles stay in sync.
 * - Hooks `active-leaf-change`, `layout-change`, and `metadataCache.changed`
 *   to re-apply the label whenever Obsidian re-renders.
 * - A per-leaf `MutationObserver` re-applies the label if Obsidian itself
 *   writes into the `.inline-title` element (it does this on file open).
 * - `disable()` restores the original text and disconnects all observers.
 */
interface PluginWithSettings extends Plugin {
  settings: ExocortexSettings;
  printNameRuleService?: PrintNameRuleService;
}

interface PatchedLeafState {
  originalText: string | null;
  observer: MutationObserver | null;
}

export class InlineTitlePatch {
  private app: Plugin["app"];
  private plugin: PluginWithSettings;
  private enabled = false;
  private patchedLeaves: WeakMap<WorkspaceLeaf, PatchedLeafState> = new WeakMap();
  private metadataChangeHandler: (file: TFile, data: string, cache: CachedMetadata) => void;

  constructor(plugin: Plugin) {
    this.plugin = plugin as PluginWithSettings;
    this.app = plugin.app;
    this.metadataChangeHandler = this.handleMetadataChange.bind(this);
  }

  private getDisplayNameSettings(): DisplayNameSettings {
    if (this.plugin.settings?.displayNameSettings) {
      return this.plugin.settings.displayNameSettings;
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Intentional backwards compatibility
    const template = this.plugin.settings?.displayNameTemplate || DEFAULT_DISPLAY_NAME_TEMPLATE;
    return {
      defaultTemplate: template,
      classTemplates: {},
    };
  }

  private createResolver(): DisplayNameResolver {
    const ruleService = this.plugin.printNameRuleService ?? null;
    const metadataResolver = ruleService?.createMetadataResolver() ?? null;
    return new DisplayNameResolver(this.getDisplayNameSettings(), ruleService, metadataResolver);
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.refreshAllLeaves();

    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.refreshAllLeaves())
    );
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => this.refreshAllLeaves())
    );
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", this.metadataChangeHandler)
    );
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.restoreAllLeaves();
  }

  cleanup(): void {
    this.disable();
  }

  private refreshAllLeaves(): void {
    if (!this.enabled) return;
    if (typeof this.app.workspace.iterateAllLeaves !== "function") return;

    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        this.applyLabelToLeaf(leaf);
      }
    });
  }

  private findInlineTitleEls(leaf: WorkspaceLeaf): HTMLElement[] {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return [];
    const container = (view as unknown as { containerEl?: HTMLElement }).containerEl;
    if (!container || typeof container.getElementsByClassName !== "function") return [];
    const nodes = container.getElementsByClassName("inline-title");
    const result: HTMLElement[] = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes.item(i);
      if (el instanceof HTMLElement) result.push(el);
    }
    return result;
  }

  private applyLabelToLeaf(leaf: WorkspaceLeaf): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const file = view.file;
    if (!file || !(file instanceof TFile) || file.extension !== "md") return;

    const label = this.getAssetLabel(file);
    if (!label) {
      // No override for this file — leave Obsidian default intact.
      return;
    }

    const inlineTitles = this.findInlineTitleEls(leaf);
    if (inlineTitles.length === 0) return;

    // Remember the original basename the first time we touch this leaf so
    // disable() can restore it cleanly.
    if (!this.patchedLeaves.has(leaf)) {
      this.patchedLeaves.set(leaf, {
        originalText: inlineTitles[0].textContent,
        observer: null,
      });
    }

    for (const el of inlineTitles) {
      if (el.textContent !== label) {
        el.textContent = label;
      }
    }

    this.ensureObserver(leaf);
  }

  private ensureObserver(leaf: WorkspaceLeaf): void {
    const state = this.patchedLeaves.get(leaf);
    if (!state) return;
    if (state.observer) return;
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const container = (view as unknown as { containerEl?: HTMLElement }).containerEl;
    if (!container || typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver(() => {
      if (!this.enabled) return;
      const file = view.file;
      if (!file) return;
      const currentLabel = this.getAssetLabel(file);
      if (!currentLabel) return;
      for (const el of this.findInlineTitleEls(leaf)) {
        if (el.textContent !== currentLabel) {
          el.textContent = currentLabel;
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    state.observer = observer;
  }

  private getAssetLabel(file: TFile): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    if (!frontmatter) return null;

    const metadata = { ...frontmatter };
    const createdDate = file.stat?.ctime ? new Date(file.stat.ctime) : undefined;

    const resolver = this.createResolver();
    const displayName = resolver.resolve({
      metadata,
      basename: file.basename,
      createdDate,
    });
    if (displayName) return displayName;

    const label = frontmatter.exo__Asset_label;
    if (label && typeof label === "string" && label.trim() !== "") {
      return label.trim();
    }
    return null;
  }

  private handleMetadataChange(file: TFile): void {
    if (!this.enabled) return;
    if (file.extension !== "md") return;
    if (typeof this.app.workspace.iterateAllLeaves !== "function") return;

    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path) {
        this.applyLabelToLeaf(leaf);
      }
    });
  }

  private restoreAllLeaves(): void {
    if (typeof this.app.workspace.iterateAllLeaves !== "function") return;

    this.app.workspace.iterateAllLeaves((leaf) => {
      const state = this.patchedLeaves.get(leaf);
      if (!state) return;
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }
      for (const el of this.findInlineTitleEls(leaf)) {
        if (state.originalText !== null) {
          el.textContent = state.originalText;
        }
      }
    });

    this.patchedLeaves = new WeakMap();
  }
}
