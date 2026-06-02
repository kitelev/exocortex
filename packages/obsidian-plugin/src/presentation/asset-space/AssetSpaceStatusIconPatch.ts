import {
  type App,
  type Plugin,
  type WorkspaceLeaf,
  MarkdownView,
} from "obsidian";

import { isAssetSpaceFrontmatter } from "@plugin/infrastructure/adapters/AssetSpaceFrontmatter";
import type { AssetSpaceMaterializationTracker } from "@plugin/infrastructure/adapters/AssetSpaceMaterializationTracker";

/**
 * AssetSpaceStatusIconPatch — renders a small status icon (✅ materialized
 * vs ⏸ available) near the inline title of `exo__AssetSpace` ABox notes
 * (RFC 22b50a17 Phase 4).
 *
 * Detects AssetSpace assets by frontmatter (`isAssetSpaceFrontmatter`) and
 * queries the runtime-derived `AssetSpaceMaterializationTracker` for status.
 * Re-applied on workspace events so the icon stays in sync with hard-switch
 * mutations: `active-leaf-change`, `layout-change`, `metadataCache.changed`.
 *
 * Idempotent — never adds a second icon to the same title element; updates
 * the existing icon's class + tooltip when status changes.
 */
const BADGE_CLASS = "exo-assetspace-status-badge";
const BADGE_MATERIALIZED = "exo-assetspace-status-materialized";
const BADGE_AVAILABLE = "exo-assetspace-status-available";

export class AssetSpaceStatusIconPatch {
  private readonly app: App;
  private readonly plugin: Plugin;
  private readonly tracker: AssetSpaceMaterializationTracker;
  private enabled = false;

  constructor(
    plugin: Plugin,
    tracker: AssetSpaceMaterializationTracker,
  ) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.tracker = tracker;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.refreshAllLeaves();

    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.refreshAllLeaves()),
    );
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => this.refreshAllLeaves()),
    );
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", () => this.refreshAllLeaves()),
    );
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.removeAllBadges();
  }

  cleanup(): void {
    this.disable();
  }

  /**
   * Hook called by the orchestrator after the tracker is refreshed so the
   * icon reflects newly-materialized/destroyed AS folders without waiting
   * for a workspace event.
   */
  onTrackerRefreshed(): void {
    if (!this.enabled) return;
    this.refreshAllLeaves();
  }

  private refreshAllLeaves(): void {
    if (typeof this.app.workspace.getLeavesOfType !== "function") return;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    if (!Array.isArray(leaves)) return;
    for (const leaf of leaves) this.refreshLeaf(leaf);
  }

  private refreshLeaf(leaf: WorkspaceLeaf): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const file = view.file;
    if (file === null) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    if (!fm || !isAssetSpaceFrontmatter(fm)) {
      this.removeBadgeFrom(view.containerEl);
      return;
    }

    const asUid =
      typeof fm["exo__Asset_uid"] === "string"
        ? (fm["exo__Asset_uid"] as string).trim()
        : "";
    if (asUid.length === 0) {
      this.removeBadgeFrom(view.containerEl);
      return;
    }

    const materialized = this.tracker.isMaterialized(asUid);
    this.applyBadge(view.containerEl, materialized);
  }

  private applyBadge(container: HTMLElement, materialized: boolean): void {
    // Prefer the dedicated `.inline-title` (Reading Mode + Live Preview
    // header). Fallback to `.mod-header h1` which Obsidian uses for the
    // preview-mode title specifically (NOT a generic body h1 — see M2
    // code-reviewer catch: previously `.markdown-preview-section h1`
    // matched the first body heading on AS notes that started with `#`).
    const titleEl =
      container.querySelector<HTMLElement>(".inline-title") ??
      container.querySelector<HTMLElement>(".markdown-preview-section .mod-header h1");
    if (titleEl === null) return;

    let badge = titleEl.parentElement?.querySelector<HTMLElement>(
      `.${BADGE_CLASS}`,
    );
    if (!badge) {
      badge = document.createElement("span");
      badge.classList.add(BADGE_CLASS);
      // Insert before the title so it sits inline at the leading edge.
      titleEl.parentElement?.insertBefore(badge, titleEl);
    }

    badge.classList.toggle(BADGE_MATERIALIZED, materialized);
    badge.classList.toggle(BADGE_AVAILABLE, !materialized);
    badge.textContent = materialized ? "✅" : "⏸";
    badge.title = materialized
      ? "AssetSpace materialized on disk (assetspaces/<namespace>/ exists)"
      : "AssetSpace available but not materialized — run Hard Switch to populate";
    badge.setAttribute("aria-label", badge.title);
  }

  private removeBadgeFrom(container: HTMLElement): void {
    const badge = container.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
    if (badge !== null) badge.remove();
  }

  private removeAllBadges(): void {
    if (typeof this.app.workspace.getLeavesOfType !== "function") return;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    if (!Array.isArray(leaves)) return;
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView) {
        this.removeBadgeFrom(leaf.view.containerEl);
      }
    }
  }
}
