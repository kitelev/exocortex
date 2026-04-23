/**
 * Obsidian-flavoured adapter for `RelationColumnSetRepository`.
 *
 * Keeps the Repository itself storage-agnostic: unit tests use an in-memory
 * adapter, production wiring uses this class.
 *
 * @module infrastructure/repositories
 */

import { TFile } from "obsidian";
import type { App, EventRef } from "obsidian";

import type {
  RelationColumnSetEventHandler,
  RelationColumnSetVaultAdapter,
} from "./RelationColumnSetRepository";

export class ObsidianRelationColumnSetAdapter
  implements RelationColumnSetVaultAdapter
{
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
    handler: RelationColumnSetEventHandler,
  ): () => void {
    let eventRef: EventRef;
    if (event === "changed") {
      eventRef = this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile) handler({ path: file.path });
      });
    } else if (event === "deleted") {
      eventRef = this.app.metadataCache.on("deleted", (file) => {
        if (file instanceof TFile) handler({ path: file.path });
      });
    } else {
      eventRef = this.app.vault.on("rename", (file, _oldPath) => {
        if (file instanceof TFile) handler({ path: file.path });
      });
    }
    return () => this.app.metadataCache.offref(eventRef);
  }
}
