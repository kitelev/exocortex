import type { VaultMetadataPort } from "@kitelev/exocortex-core";
import type { FileSystemVaultAdapter } from "./FileSystemVaultAdapter.js";

/**
 * The filesystem half of {@link VaultMetadataPort} (req f17f7c57) — the CLI's counterpart to
 * the plugin's `ObsidianVaultMetadataAdapter`.
 *
 * It is this thin because `FileSystemVaultAdapter` already mirrors the three Obsidian calls the
 * displayName engine used to make: `getAllFiles` ↔ `vault.getMarkdownFiles`, `getFrontmatter` ↔
 * `metadataCache.getFileCache(...)?.frontmatter`, `getFirstLinkpathDest` ↔ the identically-named
 * metadataCache method. That correspondence is WHY a port of two methods was enough to reach
 * UI/CLI parity (#3417) without reimplementing anything.
 *
 * ⛔ Do not let naming logic drift in here. If the CLI's composed name ever differs from the
 * plugin's, the cause is a divergence between these two adapters — not two engines, because
 * there is only one.
 */
export class FsVaultMetadataAdapter implements VaultMetadataPort {
  constructor(private readonly vault: FileSystemVaultAdapter) {}

  *listFrontmatter(): Iterable<Record<string, unknown>> {
    for (const file of this.vault.getAllFiles()) {
      const fm = this.vault.getFrontmatter(file);
      if (fm) yield fm as Record<string, unknown>;
    }
  }

  resolveLinkpathFrontmatter(linkpath: string): Record<string, unknown> | null {
    // The `.md` retry is the adapter's business (see the port docstring): the engine hands
    // over an unwrapped, alias-stripped target and asks exactly once.
    // ⛔ allowAliasFallback:false is load-bearing, not tidiness. FileSystemVaultAdapter resolves
    // a linkpath that matches only a frontmatter `aliases` entry; Obsidian's metadataCache does
    // NOT (DevTools-verified). Leaving it on would let the CLI resolve a link the plugin cannot
    // — and since this method feeds matcher identity, cross-asset key-paths and the printed-
    // property label hop, the two surfaces would compose DIFFERENT names. That divergence is
    // exactly what this class's docstring promises cannot happen.
    const noAlias = { allowAliasFallback: false };
    let file = this.vault.getFirstLinkpathDest(linkpath, "", noAlias);
    if (!file && !linkpath.endsWith(".md")) {
      file = this.vault.getFirstLinkpathDest(`${linkpath}.md`, "", noAlias);
    }
    if (!file) return null;
    // ⛔ `{}` — NOT null — per the port contract: the linkpath resolved, so the caller must be
    // able to tell "no such file" from "file with nothing in it". Mirrors the Obsidian half.
    return (this.vault.getFrontmatter(file) as Record<string, unknown> | null) ?? {};
  }
}
