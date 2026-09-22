import fs from "fs-extra";
import path from "path";
import * as yaml from "js-yaml";
import {
  IVaultAdapter,
  IFile,
  IFolder,
  IFrontmatter,
  FrontmatterService,
  parseYamlFrontmatterTolerant,
} from "@kitelev/exocortex-core";
import { rewriteInboundWikilinks } from "../utils/wikilinkRewriter.js";

/** UUID v4 pattern for wikilink resolution */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FileSystemVaultAdapter implements IVaultAdapter {
  /** UUID (lowercase) → relative filepath mapping for O(1) lookups */
  private uuidIndex: Map<string, string> | null = null;

  /**
   * Lower-cased basename → relative filepath. Mirrors Obsidian's
   * metadataCache basename-aware wikilink resolution across the vault.
   */
  private basenameIndex: Map<string, string> | null = null;

  /**
   * Lower-cased frontmatter alias → relative filepath. Required for
   * CLI ↔ plugin triple parity (RFC-027 Phase 3): wikilinks like
   * `[[ems__EffortStatusBacklog]]` must resolve to the file that has
   * `aliases: [ems__EffortStatusBacklog]`, just like Obsidian's
   * metadataCache.getFirstLinkpathDest does.
   */
  private aliasIndex: Map<string, string> | null = null;

  constructor(private rootPath: string) {}

  async read(file: IFile): Promise<string> {
    const fullPath = this.resolvePath(file.path);
    if (!(await fs.pathExists(fullPath))) {
      throw new Error(`File not found: ${file.path}`);
    }
    return fs.readFile(fullPath, "utf-8");
  }

  async create(filePath: string, content: string): Promise<IFile> {
    const fullPath = this.resolvePath(filePath);
    if (await fs.pathExists(fullPath)) {
      throw new Error(`File already exists: ${filePath}`);
    }
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, "utf-8");
    return this.createFileObject(filePath);
  }

  async modify(file: IFile, newContent: string): Promise<void> {
    const fullPath = this.resolvePath(file.path);
    if (!(await fs.pathExists(fullPath))) {
      throw new Error(`File not found: ${file.path}`);
    }
    await fs.writeFile(fullPath, newContent, "utf-8");
  }

  async delete(file: IFile): Promise<void> {
    const fullPath = this.resolvePath(file.path);
    if (!(await fs.pathExists(fullPath))) {
      throw new Error(`File not found: ${file.path}`);
    }
    await fs.remove(fullPath);
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);
    return fs.pathExists(fullPath);
  }

  getAbstractFileByPath(filePath: string): IFile | IFolder | null {
    const fullPath = this.resolvePath(filePath);

    try {
      const stats = fs.statSync(fullPath);

      if (stats.isFile()) {
        return this.createFileObject(filePath);
      } else if (stats.isDirectory()) {
        return this.createFolderObject(filePath);
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  getAllFiles(): IFile[] {
    const files: IFile[] = [];
    this.walkDirectory(this.rootPath, (filePath) => {
      if (filePath.endsWith(".md")) {
        const relativePath = path.relative(this.rootPath, filePath);
        files.push(this.createFileObject(relativePath));
      }
    });
    return files;
  }

  getFrontmatter(file: IFile): IFrontmatter | null {
    try {
      const content = fs.readFileSync(this.resolvePath(file.path), "utf-8");
      return this.extractFrontmatter(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * PATCH the file's frontmatter block with the keys `updater` returns,
   * through the core carrier of the key dialect `FrontmatterService.applyPatch`
   * (req `2a020489`) — in parity with the plugin's `ObsidianVaultAdapter`:
   * `canonicalYamlKey(normalizeIRI(key))` per key, `normalizeIRIValue` per
   * string value, canonical-wins on a dual payload, `LEGACY_YAML_KEYS` of each
   * written canonical key removed, keys the updater does not return preserved
   * (before req `2a020489` this adapter replaced the whole block verbatim and
   * applied none of the dialect). The block is then re-serialised by
   * {@link replaceFrontmatter} exactly as before. Contract on
   * `IVaultFrontmatterManager.updateFrontmatter`.
   *
   * Three outcomes of reading the current block, kept apart on purpose:
   * no block → one is created from the patch; a block that parses → patched;
   * a block that is present but does NOT parse (or is not a mapping) →
   * `Error`, file untouched. Collapsing the last two into `{}` (PR #4243
   * review MEDIUM) would let {@link replaceFrontmatter} overwrite the unreadable
   * block with the patch's keys alone — silent data loss on malformed input,
   * the opposite of the "unreturned keys are preserved" promise.
   */
  async updateFrontmatter(
    file: IFile,
    updater: (current: IFrontmatter) => IFrontmatter,
  ): Promise<void> {
    const content = await this.read(file);
    const parsed = this.extractFrontmatter(content);
    // An EMPTY block (`---\n\n---`) parses to nothing and is a legitimate
    // "no keys yet"; only a block with a non-blank body that still yields no
    // mapping is unreadable.
    const blockBody = FileSystemVaultAdapter.FRONTMATTER_BLOCK.exec(content)?.[1];
    if (parsed === null && blockBody !== undefined && blockBody.trim() !== "") {
      throw new Error(
        `updateFrontmatter: frontmatter of ${file.path} is not parseable — refusing to patch (would drop keys)`,
      );
    }
    const target: IFrontmatter = parsed ?? {};
    // The updater sees a COPY: mutating `current` must not bypass the dialect.
    const patch = updater({ ...target });
    FrontmatterService.applyPatch(target, patch);
    const newContent = this.replaceFrontmatter(content, target);
    await this.modify(file, newContent);
  }

  async rename(file: IFile, newPath: string): Promise<void> {
    const oldFullPath = this.resolvePath(file.path);
    const newFullPath = this.resolvePath(newPath);

    if (!(await fs.pathExists(oldFullPath))) {
      throw new Error(`File not found: ${file.path}`);
    }

    await fs.ensureDir(path.dirname(newFullPath));
    await fs.move(oldFullPath, newFullPath);
  }

  async createFolder(folderPath: string): Promise<void> {
    const fullPath = this.resolvePath(folderPath);
    await fs.ensureDir(fullPath);
  }

  /**
   * @param options.allowAliasFallback Resolve a linkpath that matches only a frontmatter
   *   `aliases` entry. Defaults to TRUE — every pre-existing caller keeps today's behaviour.
   *   ⛔ Obsidian's `metadataCache.getFirstLinkpathDest` does NOT resolve aliases (verified in
   *   DevTools: `getFirstLinkpathDest('ems__Task','')` → null), so any CLI surface that must
   *   MATCH the plugin — the displayName oracle in particular — passes `false`. Leaving it on
   *   there would let the CLI resolve a link the plugin cannot, and compose a different name.
   */
  getFirstLinkpathDest(
    linkpath: string,
    sourcePath: string,
    options?: { allowAliasFallback?: boolean },
  ): IFile | null {
    // Step 1: Strip wikilink alias if present: "uuid|label" → "uuid"
    const cleanLinkpath = linkpath.split("|")[0].trim();

    // Handle empty linkpath after stripping
    if (!cleanLinkpath) {
      return null;
    }

    // Step 2: Check if linkpath is a UUID and resolve via index
    if (UUID_PATTERN.test(cleanLinkpath)) {
      // Build index lazily on first UUID lookup
      if (this.uuidIndex === null) {
        this.buildUuidIndex();
      }

      const normalizedUuid = cleanLinkpath.toLowerCase();
      const relativePath = this.uuidIndex!.get(normalizedUuid);

      if (relativePath) {
        return this.createFileObject(relativePath);
      }

      // UUID not found in index - return null
      return null;
    }

    // Step 3: Fall back to existing relative path resolution for non-UUID linkpaths
    const sourceDir = path.dirname(this.resolvePath(sourcePath));
    let resolvedPath: string;

    if (path.isAbsolute(cleanLinkpath)) {
      resolvedPath = this.resolvePath(cleanLinkpath);
    } else {
      resolvedPath = path.resolve(sourceDir, cleanLinkpath);
    }

    if (!cleanLinkpath.endsWith(".md")) {
      resolvedPath += ".md";
    }

    if (fs.existsSync(resolvedPath)) {
      const relativePath = path.relative(this.rootPath, resolvedPath);
      return this.createFileObject(relativePath);
    }

    // Step 4: basename lookup (matches Obsidian) and, unless opted out, a frontmatter-alias
    // lookup (does NOT — Obsidian resolves basenames only). See getFirstLinkpathDest's docstring.
    if (this.basenameIndex === null || this.aliasIndex === null) {
      this.buildLinkpathIndex();
    }

    const linkKey = cleanLinkpath.toLowerCase();
    const basenameMatch = this.basenameIndex!.get(linkKey);
    if (basenameMatch) {
      return this.createFileObject(basenameMatch);
    }

    // Basename above mirrors Obsidian; the alias hop below does NOT (see the options docstring).
    if (options?.allowAliasFallback !== false) {
      const aliasMatch = this.aliasIndex!.get(linkKey);
      if (aliasMatch) {
        return this.createFileObject(aliasMatch);
      }
    }

    return null;
  }

  /**
   * Build basename- and alias-to-filepath indexes by scanning the vault
   * once. Mirrors Obsidian's metadataCache.getFirstLinkpathDest semantics
   * required for CLI ↔ plugin triple parity (RFC-027 Phase 3).
   *
   * Conflict policy: first-write-wins. Obsidian itself produces a single
   * winner for ambiguous basenames/aliases; we choose deterministically
   * by traversal order rather than overwriting, so repeated lookups are
   * stable within one process.
   */
  private buildLinkpathIndex(): void {
    this.basenameIndex = new Map();
    this.aliasIndex = new Map();

    this.walkDirectory(this.rootPath, (fullPath) => {
      if (!fullPath.endsWith(".md")) {
        return;
      }

      const relativePath = path.relative(this.rootPath, fullPath);
      const basename = path.basename(fullPath, ".md").toLowerCase();
      if (!this.basenameIndex!.has(basename)) {
        this.basenameIndex!.set(basename, relativePath);
      }

      let raw: string;
      try {
        raw = fs.readFileSync(fullPath, "utf-8");
      } catch {
        return; // Permission/IO errors – skip this file.
      }

      const frontmatter = this.extractFrontmatter(raw);
      if (!frontmatter) {
        return;
      }

      const aliases = frontmatter.aliases;
      const aliasList = Array.isArray(aliases)
        ? aliases
        : typeof aliases === "string"
          ? [aliases]
          : [];

      for (const alias of aliasList) {
        if (typeof alias !== "string") continue;
        const key = alias.trim().toLowerCase();
        if (!key) continue;
        if (!this.aliasIndex!.has(key)) {
          this.aliasIndex!.set(key, relativePath);
        }
      }
    });
  }

  /**
   * Build UUID-to-filepath index by scanning the vault.
   * Called lazily on first UUID lookup.
   */
  private buildUuidIndex(): void {
    this.uuidIndex = new Map();

    this.walkDirectory(this.rootPath, (fullPath) => {
      if (fullPath.endsWith(".md")) {
        const filename = path.basename(fullPath, ".md");
        // Check if filename starts with a UUID
        const uuidMatch = filename.match(
          /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        );
        if (uuidMatch) {
          const uuid = uuidMatch[1].toLowerCase();
          const relativePath = path.relative(this.rootPath, fullPath);
          this.uuidIndex!.set(uuid, relativePath);
        }
      }
    });
  }

  async process(file: IFile, fn: (content: string) => string): Promise<string> {
    const content = await this.read(file);
    const newContent = fn(content);
    await this.modify(file, newContent);
    return newContent;
  }

  getDefaultNewFileParent(): IFolder | null {
    return {
      path: "",
      name: "",
    };
  }

  /**
   * Rewrites inbound wikilinks pointing at `oldBasename` so they collapse to a
   * bare `[[newBasename]]` — display label is resolved at render time from the
   * target's `exo__Asset_label`. Honors fenced/inline code-block exclusion and
   * skips the file being renamed itself. Issue #3113.
   */
  async updateLinks(
    oldPath: string,
    newPath: string,
    oldBasename: string,
  ): Promise<void> {
    const newBasename = path.basename(newPath, ".md");
    await rewriteInboundWikilinks(this.rootPath, oldBasename, newBasename, {
      excludeRelPath: oldPath,
    });
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    // #3761 — a co-location folder resolver that "relativized" an ABSOLUTE
    // vault path by stripping its leading slash (`replace(/^\/+/, "")`) yields
    // a fake-relative `<vault-root-without-leading-slash>/assetspaces/...`
    // string. It is not `path.isAbsolute`, so the guard above misses it and
    // `path.join(rootPath, …)` nests the entire vault-root path UNDER the vault
    // root, `mkdir -p`-ing a phantom duplicate tree. Detect that the
    // "relative" arg is the vault's own absolute path with a stripped leading
    // slash and resolve it to the correct in-vault location instead. Normalize
    // any trailing separator on the root so the guard holds regardless of how
    // the caller constructed `rootPath`.
    const root = this.rootPath.replace(/[/\\]+$/, "");
    const reAbsolute = path.sep + filePath;
    if (reAbsolute === root || reAbsolute.startsWith(root + path.sep)) {
      return reAbsolute;
    }
    return path.join(this.rootPath, filePath);
  }

  private createFileObject(filePath: string): IFile {
    // Match Obsidian TFile semantics: `basename` is the name WITHOUT extension
    // and `name` is the full filename. Shared services in `packages/core`
    // (GenericAssetCreationService.inheritParentContext, NoteToRDFConverter,
    // AreaHierarchyBuilder) rely on this contract.
    const name = path.basename(filePath);
    const basename = path.basename(filePath, path.extname(filePath));
    const parentPath = path.dirname(filePath);

    return {
      path: filePath,
      basename,
      name,
      parent: parentPath !== "." ? this.createFolderObject(parentPath) : null,
    };
  }

  private createFolderObject(folderPath: string): IFolder {
    return {
      path: folderPath,
      name: path.basename(folderPath),
    };
  }

  /** A leading `---` block; group 1 = its YAML body. Shared by the three block readers/writers below. */
  private static readonly FRONTMATTER_BLOCK = /^---\n([\s\S]*?)\n---/;

  private extractFrontmatter(content: string): IFrontmatter | null {
    const match = content.match(FileSystemVaultAdapter.FRONTMATTER_BLOCK);

    if (!match) {
      return null;
    }

    // #3800: tolerant parse — a duplicated mapping key would otherwise throw
    // and collapse the asset to `null` (0 triples → invisible & unrepairable).
    return parseYamlFrontmatterTolerant(match[1]) as IFrontmatter | null;
  }

  /**
   * Re-serialise the frontmatter block (req `27fbe40b`, ticket 73b16cc4):
   *
   * - `quoteStyle: "double"` — the js-yaml **5** option (this package resolves
   *   js-yaml 5.3.0; `quotingType` is the js-yaml 4 spelling and is IGNORED
   *   here — measured on both versions before touching this line): every
   *   scalar js-yaml has to quote (`[[x]]`, a value with `: `, a
   *   timestamp-looking string) is DOUBLE-quoted, the vault convention
   *   (vault-exodev, 2026-09-16: 232 144 double- vs 244 single-quoted scalars)
   *   and the byte-form `FrontmatterService.updateProperty` writes for a
   *   reference (`key: "[[x]]"`). Load-bearing for that parity — locked by an
   *   axis, not just by this comment. The parity is per REFERENCE LINE only:
   *   this method re-dumps the WHOLE block through js-yaml (pre-existing), so
   *   other scalars can change shape on the way — an unquoted YAML 1.1
   *   timestamp (`2026-05-17T19:40:11`) parses to a Date and is re-emitted in
   *   its `.000Z` form, an empty value becomes `null`, a quoted plain word
   *   loses its quotes. The text path touches one line and leaves the rest.
   * - the new block is spliced in with a FUNCTION replacer: a string replacer
   *   would re-interpret `$&` / `$1` / `` $` `` / `$'` / `$$` inside any dumped
   *   value as a replacement pattern (class #3748 / #3795).
   */
  private replaceFrontmatter(
    content: string,
    frontmatter: IFrontmatter,
  ): string {
    const frontmatterYaml = yaml.dump(frontmatter, {
      lineWidth: -1,
      noRefs: true,
      quoteStyle: "double",
    });
    const block = `---\n${frontmatterYaml.trim()}\n---`;

    const frontmatterRegex = FileSystemVaultAdapter.FRONTMATTER_BLOCK;
    const match = content.match(frontmatterRegex);

    if (match) {
      return content.replace(frontmatterRegex, () => block);
    } else {
      return `${block}\n${content}`;
    }
  }

  /**
   * Check if a directory entry should be skipped during traversal.
   * Skips hidden directories (starting with .) to avoid:
   * - System directories like .Trash, .DS_Store folders
   * - Configuration directories like .obsidian, .git
   * - Other hidden directories that may have restricted permissions
   */
  private shouldSkipDirectory(name: string): boolean {
    return name.startsWith(".");
  }

  /**
   * Recursively walk directory structure, calling callback for each file.
   *
   * Security features:
   * - Skips hidden directories to avoid .Trash, .obsidian, etc.
   * - Handles EPERM/EACCES errors gracefully by skipping inaccessible directories
   * - Only processes files within the vault boundary
   */
  private walkDirectory(
    dir: string,
    callback: (filePath: string) => void,
  ): void {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      // Handle permission errors gracefully - skip inaccessible directories
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "EPERM" || nodeError.code === "EACCES") {
        return; // Skip this directory silently
      }
      throw error; // Re-throw other errors
    }

    // req 265844b7 (ticket 193147b4) — `readdirSync` order is a property of the
    // FILESYSTEM, not a guarantee: APFS hands back directory entries already
    // sorted by name, ext4 hands back hash order. This walk hydrates the CLI
    // triple store (`loadVaultTriples` → `getAllFiles()` → `convertVault`), and
    // `InMemoryTripleStore.matchP` iterates `pso` — a Map, i.e. INSERTION order —
    // so "which definition wins" for a duplicated property label is decided by
    // the order right here. Its structural twin `PropertyNameValidator.walk`
    // already sorts explicitly (ticket 8185c9dd, review #4282 NIT-2, pinned by
    // mutant M12_sort_reversed under req 21ceea14); without this line the two
    // agreed only where the filesystem happened to sort for us.
    //
    // ⛤ The comparator is the JS default string one (UTF-16 code units), copied
    // from that twin — the guarantee is PARITY WITH THE VALIDATOR, not UTF-8 byte
    // order (the two differ on surrogate pairs). ⛔ NOT unified with
    // `NodeFsAdapter.getMarkdownFiles()`, which sorts FULL relative paths (#4272)
    // and is therefore a different order whenever a directory name is a prefix of
    // a file name (measured: per-directory gives `a/b.md a-c.md a-d/e.md a.md`,
    // full-path gives `a-c.md a-d/e.md a.md a/b.md`). Reconciling those two is a
    // separate decision; this walk adopts the order of the walk it must match.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories (.Trash, .obsidian, .git, etc.)
        if (this.shouldSkipDirectory(entry.name)) {
          continue;
        }
        this.walkDirectory(fullPath, callback);
      } else if (entry.isFile()) {
        callback(fullPath);
      }
    }
  }
}
