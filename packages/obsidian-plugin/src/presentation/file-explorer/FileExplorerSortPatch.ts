import { TFile, TFolder, TAbstractFile, WorkspaceLeaf, Plugin, View } from "obsidian";
import { DisplayNameTemplateEngine, DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import type { ExocortexSettings } from "@plugin/domain/settings/ExocortexSettings";

/**
 * FileExplorerSortPatch - Patches Obsidian's File Explorer to sort by exo__Asset_label
 *
 * This patch intercepts the File Explorer's sorting mechanism to order files
 * by their display name (based on exo__Asset_label) instead of their filename.
 * This is especially useful for vaults using UUID-based filenames where
 * alphabetical sorting by filename is meaningless.
 *
 * Implementation approach:
 * - Patches the FileExplorerView.sort method via monkey-patching
 * - Uses existing label resolution from DisplayNameTemplateEngine
 * - Maintains folder-first sorting
 * - Respects Obsidian's sort direction (ascending/descending)
 * - Falls back to filename if no label is available
 */

// Internal type for FileExplorer view's file items
interface FileExplorerItem {
  file: TAbstractFile;
  selfEl?: HTMLElement;
  innerEl?: HTMLElement;
}

// Internal type for FileExplorer view
interface FileExplorerView extends View {
  fileItems: Record<string, FileExplorerItem>;
  sortOrder?: string;
  requestSort?: () => void;
  sort?: () => void;
}

// Plugin interface to access settings
interface PluginWithSettings extends Plugin {
  settings: ExocortexSettings;
}

export class FileExplorerSortPatch {
  private app: Plugin["app"];
  private plugin: PluginWithSettings;
  private enabled = false;
  private originalSort: (() => void) | null = null;
  private patchedView: FileExplorerView | null = null;
  private labelCache: Map<string, string> = new Map();

  constructor(plugin: Plugin) {
    this.plugin = plugin as PluginWithSettings;
    this.app = plugin.app;
  }

  /**
   * Get the display name template from settings
   */
  private getTemplate(): string {
    return this.plugin.settings?.displayNameTemplate || DEFAULT_DISPLAY_NAME_TEMPLATE;
  }

  /**
   * Enable the File Explorer sort patch
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // Clear label cache when enabling
    this.labelCache.clear();

    // Find and patch the File Explorer
    this.patchFileExplorerSort();

    // Listen for metadata changes to invalidate cache and resort
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file.extension === "md") {
          // Invalidate cache for this file
          this.labelCache.delete(file.path);
          // Trigger resort
          this.triggerResort();
        }
      })
    );

    // Re-patch when workspace layout changes (e.g., File Explorer reopened)
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        setTimeout(() => {
          // Check if our patch is still applied
          if (!this.patchedView || !this.originalSort) {
            this.patchFileExplorerSort();
          }
        }, 100);
      })
    );

    // Trigger initial sort
    this.triggerResort();
  }

  /**
   * Disable the File Explorer sort patch and restore original sorting
   */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    // Restore original sort function
    if (this.patchedView && this.originalSort) {
      this.patchedView.sort = this.originalSort;
      this.patchedView = null;
      this.originalSort = null;
    }

    // Clear cache
    this.labelCache.clear();
  }

  /**
   * Cleanup resources when plugin unloads
   */
  cleanup(): void {
    this.disable();
  }

  /**
   * Find the File Explorer leaf in the workspace
   */
  private getFileExplorerLeaf(): WorkspaceLeaf | null {
    if (typeof this.app.workspace.getLeavesOfType !== "function") {
      return null;
    }
    const leaves = this.app.workspace.getLeavesOfType("file-explorer");
    return Array.isArray(leaves) && leaves.length > 0 ? leaves[0] : null;
  }

  /**
   * Patch the File Explorer's sort method
   */
  private patchFileExplorerSort(): void {
    if (!this.enabled) return;

    const leaf = this.getFileExplorerLeaf();
    if (!leaf) return;

    const view = leaf.view as FileExplorerView;
    if (!view || !view.sort) return;

    // Store reference to patched view and original sort
    this.patchedView = view;
    this.originalSort = view.sort.bind(view);

    // Create bound reference to our custom sort
    const customSort = this.createCustomSort(view);

    // Monkey-patch the sort method
    view.sort = customSort;

    // Trigger initial sort with our custom logic
    this.triggerResort();
  }

  /**
   * Create a custom sort function for the File Explorer
   */
  private createCustomSort(_view: FileExplorerView): () => void {
    const originalSort = this.originalSort;

    if (!originalSort) {
      // Return a no-op if original sort wasn't captured
      return () => { /* no-op */ };
    }

    // Use arrow function and capture patchedView reference for accessing view properties
    return (): void => {
      const view = this.patchedView;
      if (!view) {
        return;
      }

      if (!this.enabled || !this.plugin.settings?.sortByDisplayName) {
        // If sorting by display name is disabled, use original sort
        originalSort.call(view);
        return;
      }

      // Get the sort order from the view
      const sortOrder = view.sortOrder || "alphabetical";
      const isReverse = sortOrder.toLowerCase().includes("reverse");

      // Get all file items from the view
      const fileItems = view.fileItems;
      if (!fileItems) {
        originalSort.call(view);
        return;
      }

      // Sort each folder's children
      const folders = new Set<TFolder>();
      for (const path of Object.keys(fileItems)) {
        const item = fileItems[path];
        if (item.file instanceof TFolder) {
          folders.add(item.file);
        } else if (item.file instanceof TFile && item.file.parent) {
          folders.add(item.file.parent);
        }
      }

      // Sort each folder's children by display name
      for (const folder of folders) {
        this.sortFolderChildren(folder, fileItems, isReverse);
      }

      // Call original sort to handle any remaining internal state updates
      // but the DOM order should already be correct from our sorting
      originalSort.call(view);
    };
  }

  /**
   * Sort children of a folder by display name
   */
  private sortFolderChildren(
    folder: TFolder,
    fileItems: Record<string, FileExplorerItem>,
    isReverse: boolean
  ): void {
    const children = folder.children;
    if (!children || children.length === 0) return;

    // Create sorted array of children with their display names
    const itemsWithLabels: Array<{ file: TAbstractFile; sortKey: string }> = [];

    for (const child of children) {
      const sortKey = this.getSortKey(child);
      itemsWithLabels.push({ file: child, sortKey });
    }

    // Sort: folders first, then by display name
    itemsWithLabels.sort((a, b) => {
      // Folders always come before files
      const aIsFolder = a.file instanceof TFolder;
      const bIsFolder = b.file instanceof TFolder;

      if (aIsFolder && !bIsFolder) return -1;
      if (!aIsFolder && bIsFolder) return 1;

      // Same type - compare by display name
      const comparison = a.sortKey.localeCompare(b.sortKey, undefined, {
        sensitivity: "base",
        numeric: true,
      });

      return isReverse ? -comparison : comparison;
    });

    // Reorder DOM elements to match sorted order
    const folderPath = folder.path;
    const folderItem = fileItems[folderPath];
    if (!folderItem?.innerEl) return;

    const container = folderItem.innerEl;
    const childrenContainer = container.querySelector(".nav-folder-children");
    if (!childrenContainer) return;

    // Reorder child elements
    for (const { file } of itemsWithLabels) {
      const childItem = fileItems[file.path];
      if (childItem?.selfEl && childItem.selfEl.parentElement === childrenContainer) {
        childrenContainer.appendChild(childItem.selfEl);
      }
    }
  }

  /**
   * Get the sort key for a file/folder
   * For folders: folder name
   * For files: display name (from template) or filename as fallback
   */
  private getSortKey(file: TAbstractFile): string {
    // For folders, use the folder name
    if (file instanceof TFolder) {
      return file.name.toLowerCase();
    }

    // For files, check cache first
    const cachedKey = this.labelCache.get(file.path);
    if (cachedKey) {
      return cachedKey;
    }

    // Get display name - only for TFile instances
    let displayName: string | null = null;
    if (file instanceof TFile) {
      displayName = this.getDisplayName(file);
    }
    const sortKey = (displayName || file.name).toLowerCase();

    // Cache the result
    this.labelCache.set(file.path, sortKey);

    return sortKey;
  }

  /**
   * Get display name for a file using the template engine
   */
  private getDisplayName(file: TFile): string | null {
    if (file.extension !== "md") {
      return null;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    if (!frontmatter) return null;

    // Build metadata for template rendering
    const metadata = this.buildTemplateMetadata(frontmatter, file);

    // Get creation date if available
    const createdDate = file.stat?.ctime ? new Date(file.stat.ctime) : undefined;

    // Use template engine to render display name
    const template = this.getTemplate();
    const engine = new DisplayNameTemplateEngine(template);
    const displayName = engine.render(metadata, file.basename, createdDate);

    if (displayName) {
      return displayName;
    }

    // Fallback: try direct exo__Asset_label from frontmatter
    const label = frontmatter.exo__Asset_label;
    if (label && typeof label === "string" && label.trim() !== "") {
      return label.trim();
    }

    return null;
  }

  /**
   * Build metadata object for template rendering, merging frontmatter with prototype data
   */
  private buildTemplateMetadata(
    frontmatter: Record<string, unknown>,
    _file: TFile
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
            ""
          );

          if (!prototypeFile && !prototypePath.endsWith(".md")) {
            prototypeFile = this.app.metadataCache.getFirstLinkpathDest(
              prototypePath + ".md",
              ""
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
   * Trigger a resort of the File Explorer
   */
  private triggerResort(): void {
    if (!this.enabled) return;

    const leaf = this.getFileExplorerLeaf();
    if (!leaf) return;

    const view = leaf.view as FileExplorerView;
    if (view?.requestSort) {
      view.requestSort();
    } else if (view?.sort) {
      view.sort();
    }
  }
}
