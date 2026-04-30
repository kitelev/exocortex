import { Plugin, TFile, setIcon } from "obsidian";
import type { ThemeResolver } from "../../application/services/ThemeResolver";

/**
 * FileExplorerIconPatch — RFC-024 §4 Phase 4. Renders a Lucide icon next to
 * each Obsidian File Explorer row whose underlying note declares
 * `exo__Instance_class`, when the resolved `exo__Layout_icon` is non-null.
 *
 * Strategy: DOM overlay (mirrors the proven `FileExplorerLabelPatch` pattern).
 * A sibling `<span class="exo-file-explorer-icon">` is prepended inside the
 * `.nav-file-title` element, before `.nav-file-title-content`. We never mutate
 * the original DOM children — Obsidian re-renders the row on rename/refresh,
 * and our MutationObserver re-applies the overlay on every such re-render.
 *
 * Trigger: frontmatter has `exo__Instance_class` AND `ThemeResolver.resolveIcon`
 * returns a non-empty string for the first class. Without an icon resolution
 * we leave the row alone.
 *
 * Co-existence with the Iconize community plugin (RFC-024 §8): if any node in
 * the row already carries an Iconize-injected icon class, we skip — Iconize
 * wins by default.
 */

const PATCHED_ATTR = "data-exo-fe-icon-patched";
const OVERLAY_SPAN_CLASS = "exo-file-explorer-icon";
const ICONIZE_MARKERS = [
  "obsidian-icon-folder-icon",
  "iconize-icon",
];

interface PatchRecord {
  titleEl: HTMLElement;
  overlay: HTMLSpanElement;
}

export class FileExplorerIconPatch {
  private app: Plugin["app"];
  private plugin: Plugin;
  private themeResolver: ThemeResolver;
  private observer: MutationObserver | null = null;
  private enabled = false;
  private patched: PatchRecord[] = [];

  constructor(plugin: Plugin, themeResolver: ThemeResolver) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.themeResolver = themeResolver;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.patchAll();
    this.setupObserver();

    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.patchAll();
      }),
    );

    this.plugin.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.restoreAll();
        this.patchAll();
      }),
    );

    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        setTimeout(() => this.patchAll(), 100);
      }),
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
    if (titleEl.getAttribute(PATCHED_ATTR) === "true") return;

    const dataPath = titleEl.getAttribute("data-path");
    if (!dataPath) return;

    const abstractFile = this.app.vault.getAbstractFileByPath(dataPath);
    if (!abstractFile || !(abstractFile instanceof TFile)) return;

    const cache = this.app.metadataCache.getFileCache(abstractFile);
    const fm = cache?.frontmatter;
    if (!fm) return;

    const instanceClass = fm["exo__Instance_class"];
    const firstClass = this.firstClassRef(instanceClass);
    if (!firstClass) return;

    const iconName = this.themeResolver.resolveIcon(firstClass);
    if (!iconName) return;

    if (this.hasIconizeOverlay(titleEl)) return;

    const contentEl = titleEl.querySelector<HTMLElement>(
      ".nav-file-title-content",
    );

    const overlay = document.createElement("span");
    overlay.className = OVERLAY_SPAN_CLASS;
    overlay.setAttribute("data-exo-source-path", dataPath);
    overlay.setAttribute("aria-hidden", "true");

    try {
      setIcon(overlay, iconName);
    } catch {
      // Unknown Lucide icon name — skip silently rather than crash the row.
      return;
    }

    if (contentEl) {
      titleEl.insertBefore(overlay, contentEl);
    } else {
      titleEl.appendChild(overlay);
    }
    titleEl.setAttribute(PATCHED_ATTR, "true");

    this.patched.push({ titleEl, overlay });
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
        record.titleEl.removeAttribute(PATCHED_ATTR);
      } catch {
        // Best-effort restore.
      }
    }
    this.patched = [];
  }

  private firstClassRef(value: unknown): string | null {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) {
          return item.trim();
        }
      }
    }
    return null;
  }

  private hasIconizeOverlay(titleEl: HTMLElement): boolean {
    for (const marker of ICONIZE_MARKERS) {
      if (titleEl.querySelector(`.${marker}`)) return true;
    }
    return false;
  }
}
