/**
 * The vault-metadata surface the displayName engine needs — and nothing more.
 *
 * The engine used to sit in the plugin and reach for Obsidian's `App` directly. A
 * measurement (2026-08-15, req f17f7c57) showed the contact surface was exactly THREE
 * Obsidian calls — `vault.getMarkdownFiles()`, `metadataCache.getFileCache(file)?.frontmatter`
 * and `metadataCache.getFirstLinkpathDest(linkpath, "")` — and that the scanner never uses a
 * file object for anything EXCEPT fetching its frontmatter (`collectDisplayNameSpec` /
 * `collectDisplayNamePart` take frontmatter alone, and a rule's `sourceFile` comes from the
 * spec's own `exo__Asset_uid`, not from a path). That is why this port is TWO methods rather
 * than a file-handle abstraction: there is no handle to round-trip.
 *
 * ⛔ Do NOT widen this port with an Obsidian type. The whole point is that `packages/core`
 * carries no `obsidian` dependency, so the same engine serves the plugin (Obsidian adapter)
 * and the CLI (filesystem adapter) — UI/CLI parity (#3417) by construction rather than by
 * two implementations kept in step by discipline.
 */
export interface VaultMetadataPort {
  /**
   * The frontmatter of every markdown file in the vault. Files without frontmatter are
   * omitted — the scanner skips them anyway, so filtering here keeps adapters honest about
   * "no frontmatter" versus "empty frontmatter".
   *
   * Returns an iterable so a filesystem adapter may stream a large vault instead of
   * materialising ~10k objects; the scanner consumes it exactly once per scan.
   */
  listFrontmatter(): Iterable<Record<string, unknown>>;

  /**
   * Resolve a linkpath to that asset's frontmatter, or null when it resolves to nothing.
   *
   * The caller passes an ALREADY-UNWRAPPED target: `[[…]]` brackets, surrounding quotes and
   * a `|alias` suffix are stripped by the engine (the dual-IRI floor — `[[uid|label]]` must
   * resolve identically to `[[uid]]`). What remains for the adapter is the Obsidian-flavoured
   * part: a bare uid/basename that may or may not carry a `.md` suffix. **The adapter owns
   * that retry** — the engine does not call twice.
   */
  resolveLinkpathFrontmatter(linkpath: string): Record<string, unknown> | null;
}
