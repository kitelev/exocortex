import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { IQueryBodyResolver } from "exocortex";

/**
 * Vault-backed `IQueryBodyResolver` (RFC c78cc5c8 Phase 1a).
 *
 * Resolves a UID to the markdown file whose frontmatter declares
 * `exo__Asset_uid: <uid>`, then extracts the first ```sparql``` fenced
 * block from the file body. The SPARQL string is the **single source of
 * truth** — there is no frontmatter mirror (M2 invariant).
 *
 * Lookup strategy
 *  1. Iterate `app.vault.getMarkdownFiles()` and consult
 *     `metadataCache.getFileCache(file).frontmatter.exo__Asset_uid`. The
 *     metadataCache is in-memory and the iteration is O(N) over all md
 *     files; precondition evaluation is gated behind layout rendering
 *     so the call rate stays bounded.
 *  2. Once located, read via `app.vault.cachedRead` and run a regex
 *     against the body to capture the first sparql block.
 *
 * Returns `null` whenever the asset is missing, has no frontmatter, or
 * lacks a recognisable ```sparql``` block. Callers must treat `null`
 * as fail-closed (PreconditionEvaluator returns `false`).
 */
export class ObsidianQueryBodyResolver implements IQueryBodyResolver {
  private readonly uidIndex = new Map<string, string>();

  constructor(private readonly app: App) {}

  async resolveSparql(queryUid: string): Promise<string | null> {
    if (!queryUid) return null;

    const file = this.findFileByUid(queryUid);
    if (!file) return null;

    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch {
      return null;
    }

    const body = this.stripFrontmatter(content);
    return this.extractSparqlBlock(body);
  }

  /**
   * Reset the UID→path cache. Plugin layer should invoke this when
   * vault events fire (rename / delete / metadata change) — kept opt-in
   * so the resolver stays a pure read-side adapter.
   */
  invalidateCache(): void {
    this.uidIndex.clear();
  }

  private findFileByUid(uid: string): TFile | null {
    const cachedPath = this.uidIndex.get(uid);
    if (cachedPath) {
      const f = this.app.vault.getAbstractFileByPath(cachedPath);
      if (f instanceof TFile && f.extension === "md") return f;
      this.uidIndex.delete(uid);
    }

    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      if (!fm) continue;
      const fileUid = fm["exo__Asset_uid"];
      if (typeof fileUid === "string" && fileUid === uid) {
        this.uidIndex.set(uid, file.path);
        return file;
      }
    }
    return null;
  }

  private stripFrontmatter(content: string): string {
    if (!content.startsWith("---")) return content;
    const end = content.indexOf("\n---", 3);
    if (end < 0) return content;
    return content.slice(end + 4);
  }

  private extractSparqlBlock(body: string): string | null {
    const match = body.match(/```sparql\s*\n([\s\S]*?)\n```/);
    if (!match) return null;
    const inner = match[1].trim();
    return inner.length > 0 ? inner : null;
  }
}
