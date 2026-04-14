import { Plugin, TFile } from "obsidian";

/**
 * FileExplorerLabelPatch — replaces UUID filenames in Obsidian's File Explorer
 * sidebar with human-readable `exo__Asset_label` values.
 *
 * Strategy: span overlay. The original `.nav-file-title-content` text node is
 * hidden via a CSS class and a sibling `<span class="exo-file-explorer-label">`
 * is appended with the resolved label. We never mutate the original text node
 * directly — Obsidian re-renders the file explorer row on rename/refresh, and
 * our MutationObserver re-applies the overlay on every such re-render.
 *
 * Trigger: frontmatter has both `exo__Instance_class` AND a non-empty
 * `exo__Asset_label`. Without `exo__Instance_class` we leave the row alone so
 * non-Exocortex notes render normally.
 *
 * Registered after PropertiesLabelPatch in ExocortexPlugin.onload() with the
 * same 500ms delay, and listens to `metadataCache.on("resolved")` to cover the
 * fresh-vault / starter-kit-tarball install path where metadata parsing is
 * still in flight when the plugin enables (Finding 4, UX audit 2026-04-14).
 *
 * Issue #2802. Source: Ваня Холькин vault asset
 * `37a88fda-74f3-4b26-bc93-8ebdac701c70`, 09:32 2026-04-12.
 */

const PATCHED_ATTR = "data-exo-fe-label-patched";
const OVERLAY_SPAN_CLASS = "exo-file-explorer-label";
const HIDDEN_TEXT_CLASS = "exo-file-explorer-label-hidden";

interface PatchRecord {
  contentEl: HTMLElement;
  overlay: HTMLSpanElement;
}

export class FileExplorerLabelPatch {
  private app: Plugin["app"];
  private plugin: Plugin;
  private observer: MutationObserver | null = null;
  private enabled = false;
  private patched: PatchRecord[] = [];

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.patchAll();
    this.setupObserver();

    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.patchAll();
      })
    );

    // Fresh vault / starter-kit tarball: metadataCache finishes after plugin
    // enables; without this listener getFileCache returns null for every file
    // and labels never appear. See PropertiesLabelPatch for background.
    this.plugin.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.restoreAll();
        this.patchAll();
      })
    );

    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        setTimeout(() => this.patchAll(), 100);
      })
    );
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.restoreAll();
  }

  cleanup(): void {
    this.disable();
  }

  private patchAll(): void {
    if (!this.enabled) return;
    const titles = document.getElementsByClassName("nav-file-title");
    for (const title of Array.from(titles)) {
      if (title instanceof HTMLElement) this.patchTitle(title);
    }
  }

  private patchTitle(titleEl: HTMLElement): void {
    const contentEl = titleEl.querySelector<HTMLElement>(".nav-file-title-content");
    if (!contentEl) return;
    if (contentEl.getAttribute(PATCHED_ATTR) === "true") return;

    const dataPath = titleEl.getAttribute("data-path");
    if (!dataPath) return;

    const abstractFile = this.app.vault.getAbstractFileByPath(dataPath);
    if (!abstractFile || !(abstractFile instanceof TFile)) return;

    const cache = this.app.metadataCache.getFileCache(abstractFile);
    const fm = cache?.frontmatter;
    if (!fm) return;

    const instanceClass = fm["exo__Instance_class"];
    if (instanceClass === undefined || instanceClass === null) return;
    if (Array.isArray(instanceClass) && instanceClass.length === 0) return;

    const rawLabel = fm["exo__Asset_label"];
    if (typeof rawLabel !== "string") return;
    const label = rawLabel.trim();
    if (!label) return;

    // Avoid overlay if the label already equals what's visible — nothing to
    // improve and we'd just create a visual duplicate.
    const currentText = (contentEl.textContent || "").trim();
    if (currentText === label) return;

    contentEl.classList.add(HIDDEN_TEXT_CLASS);

    const overlay = document.createElement("span");
    overlay.className = OVERLAY_SPAN_CLASS;
    overlay.textContent = label;
    overlay.setAttribute("data-exo-source-path", dataPath);

    contentEl.appendChild(overlay);
    contentEl.setAttribute(PATCHED_ATTR, "true");

    this.patched.push({ contentEl, overlay });
  }

  private setupObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;

      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;

          if (node.classList?.contains("nav-file-title")) {
            this.patchTitle(node);
          } else {
            const titles = node.getElementsByClassName("nav-file-title");
            for (const title of Array.from(titles)) {
              if (title instanceof HTMLElement) this.patchTitle(title);
            }
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private restoreAll(): void {
    for (const record of this.patched) {
      try {
        record.overlay.remove();
        record.contentEl.classList.remove(HIDDEN_TEXT_CLASS);
        record.contentEl.removeAttribute(PATCHED_ATTR);
      } catch {
        // Best-effort restore
      }
    }
    this.patched = [];
  }
}
