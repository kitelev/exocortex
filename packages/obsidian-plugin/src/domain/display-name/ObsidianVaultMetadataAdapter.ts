import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { VaultMetadataPort } from "@kitelev/exocortex-core";

/**
 * The Obsidian half of {@link VaultMetadataPort} (req f17f7c57).
 *
 * This is the ONLY place the displayName engine still touches Obsidian. Everything the engine
 * used to call `this.app.*` for now arrives through these two methods — which is what lets the
 * exact same engine run under the CLI's filesystem adapter and keeps `packages/core` free of an
 * `obsidian` dependency.
 *
 * Behaviourally identical to the code it replaces: same `getMarkdownFiles` walk, same
 * `getFileCache(...)?.frontmatter` read, same `getFirstLinkpathDest` call — including the
 * `.md`-suffix retry, which lives here because it is an Obsidian linkpath quirk rather than a
 * naming rule (the engine asks once; see the port's docstring).
 */
export class ObsidianVaultMetadataAdapter implements VaultMetadataPort {
  constructor(private readonly app: App) {}

  *listFrontmatter(): Iterable<Record<string, unknown>> {
    // A generator, so a large vault is streamed rather than materialised — the scanner
    // consumes it exactly once. Files without frontmatter are skipped here, matching the
    // `if (!fm) continue` the scanner used to do itself.
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm) yield fm;
    }
  }

  resolveLinkpathFrontmatter(linkpath: string): Record<string, unknown> | null {
    let file = this.app.metadataCache.getFirstLinkpathDest(linkpath, "");
    if (!file && !linkpath.endsWith(".md")) {
      file = this.app.metadataCache.getFirstLinkpathDest(`${linkpath}.md`, "");
    }
    // ⛔ Duck-typed, NOT `instanceof TFile`, and the difference is load-bearing (req 5cd9fffe).
    // Two callers with DIFFERENT original strictness now share this method: the engine guarded
    // with `instanceof TFile`, but `BlockerHelpers.isEffortBlocked` only checked truthiness. An
    // `instanceof` here silently TIGHTENED the blocker path — caught by
    // DailyTasksRenderer.core "should handle task with blockers", whose mock returns a plain
    // object. Rejecting folders is the guard's actual intent, and `children` is what separates
    // TFolder from TFile; `instanceof` additionally fails whenever two copies of the obsidian
    // module are in play, so this is the more robust reading of the same rule, not a relaxation
    // of it.
    if (!file || typeof file !== "object" || "children" in file) return null;
    // ⛔ `{}` — NOT null — when the file resolves but has no frontmatter: see the port's
    // contract. `getFileCache` returns null for an unindexed file too, but by this point the
    // linkpath HAS resolved, so "resolved, nothing to read" is the honest reading.
    return this.app.metadataCache.getFileCache(file as TFile)?.frontmatter ?? {};
  }
}
