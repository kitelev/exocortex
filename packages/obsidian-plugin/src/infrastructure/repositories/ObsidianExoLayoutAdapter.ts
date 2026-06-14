/**
 * Obsidian-flavoured adapter for `ExoLayoutRepository`.
 *
 * Subscription pattern: `changed` / `deleted` live on `metadataCache`,
 * `renamed` lives on `vault`, so offref must target the correct Events
 * instance.
 *
 * @module infrastructure/repositories
 */

import { TFile } from "obsidian";
import type { App } from "obsidian";

import type {
  ExoLayoutEventHandler,
  ExoLayoutVaultAdapter,
} from "./ExoLayoutRepository";

export class ObsidianExoLayoutAdapter implements ExoLayoutVaultAdapter {
  constructor(private readonly app: App) {}

  getAllMarkdownPaths(): readonly string[] {
    return this.app.vault.getMarkdownFiles().map((file) => file.path);
  }

  getFrontmatter(path: string): Record<string, unknown> | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    return (cache?.frontmatter as Record<string, unknown> | undefined) ?? null;
  }

  on(
    event: "changed" | "deleted" | "renamed",
    handler: ExoLayoutEventHandler,
  ): () => void {
    if (event === "changed") {
      const eventRef = this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile) handler({ path: file.path });
      });
      return () => this.app.metadataCache.offref(eventRef);
    }
    if (event === "deleted") {
      const eventRef = this.app.metadataCache.on("deleted", (file) => {
        if (file instanceof TFile) handler({ path: file.path });
      });
      return () => this.app.metadataCache.offref(eventRef);
    }
    const eventRef = this.app.vault.on("rename", (file, _oldPath) => {
      if (file instanceof TFile) handler({ path: file.path });
    });
    return () => this.app.vault.offref(eventRef);
  }
}
