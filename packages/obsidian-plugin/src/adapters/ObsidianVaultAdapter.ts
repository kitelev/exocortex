import { Vault, TFile, TFolder, MetadataCache, App, parseYaml } from "obsidian";
import { IVaultAdapter, IFile, IFolder, IFrontmatter, FrontmatterService } from "@kitelev/exocortex-core";

/** A linkpath body that is exactly a uuid — the `uid-bare` wikilink form. */
const UUID_LINKPATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A UID-CANON filename: the uuid is the basename (optionally with a suffix). */
const UUID_BASENAME =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export class ObsidianVaultAdapter implements IVaultAdapter {
  private fileCache: WeakMap<IFile, TFile> = new WeakMap();

  /**
   * uuid -> vault path, built from the FILE REGISTRY (see
   * {@link resolveUuidFromRegistry}). Paths, not `IFile`s: a path is re-resolved
   * through the registry on read, so a since-deleted file yields `null` instead
   * of a stale object.
   */
  private uuidRegistry: Map<string, string> | null = null;
  /** File count the registry was built from — its cheap invalidation key. */
  private uuidRegistryCount = -1;

  constructor(
    private vault: Vault,
    private metadataCache: MetadataCache,
    private app: App,
  ) {}

  async read(file: IFile): Promise<string> {
    const obsidianFile = this.toObsidianFile(file);
    return await this.vault.read(obsidianFile);
  }

  async create(path: string, content: string): Promise<IFile> {
    const createdFile = await this.vault.create(path, content);
    return this.fromObsidianFile(createdFile);
  }

  async modify(file: IFile, newContent: string): Promise<void> {
    const obsidianFile = this.toObsidianFile(file);
    await this.vault.modify(obsidianFile, newContent);
  }

  async delete(file: IFile): Promise<void> {
    const obsidianFile = this.toObsidianFile(file);
    await this.app.fileManager.trashFile(obsidianFile);
  }

  async exists(path: string): Promise<boolean> {
    const file = this.vault.getAbstractFileByPath(path);
    return file !== null;
  }

  getAbstractFileByPath(path: string): IFile | IFolder | null {
    const file = this.vault.getAbstractFileByPath(path);
    if (!file) return null;

    if (file instanceof TFile) {
      return this.fromObsidianFile(file);
    }

    if (file instanceof TFolder) {
      return this.fromObsidianFolder(file);
    }

    return null;
  }

  getAllFiles(): IFile[] {
    const markdownFiles = this.vault.getMarkdownFiles();
    return markdownFiles.map((f) => this.fromObsidianFile(f));
  }

  getFrontmatter(file: IFile): IFrontmatter | null {
    const obsidianFile = this.toObsidianFile(file);
    const cache = this.metadataCache.getFileCache(obsidianFile);
    return cache?.frontmatter || null;
  }

  /**
   * Get frontmatter with fallback to direct YAML parsing when Obsidian metadata
   * cache is unavailable (e.g., during vault indexing at startup).
   *
   * This enables UI components like Create Instance buttons to work immediately
   * when opening files, without waiting for Obsidian's metadata cache to populate.
   *
   * @param file The file to get frontmatter from
   * @returns Parsed frontmatter or null if unavailable or invalid
   */
  async getFrontmatterWithFallback(file: IFile): Promise<IFrontmatter | null> {
    // Try cache first (normal operation, fast path)
    const obsidianFile = this.toObsidianFile(file);
    const cache = this.metadataCache.getFileCache(obsidianFile);

    if (cache?.frontmatter) {
      return cache.frontmatter;
    }

    // Fallback: direct YAML parsing (during vault indexing)
    try {
      const content = await this.vault.read(obsidianFile);
      return this.extractFrontmatter(content);
    } catch {
      // File read error - return null gracefully
      return null;
    }
  }

  /**
   * Extract frontmatter from raw file content using direct YAML parsing.
   *
   * @param content Raw file content
   * @returns Parsed frontmatter or null if not found or invalid
   */
  private extractFrontmatter(content: string): IFrontmatter | null {
    // Match YAML frontmatter block: starts with ---, ends with ---
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return null;
    }

    const yamlContent = match[1];

    // Handle empty frontmatter
    if (!yamlContent || yamlContent.trim() === "") {
      return null;
    }

    try {
      const parsed = parseYaml(yamlContent);

      // Ensure parsed result is an object
      return typeof parsed === "object" && parsed !== null
        ? (parsed as IFrontmatter)
        : null;
    } catch {
      // YAML parsing error - return null gracefully
      return null;
    }
  }

  async updateFrontmatter(
    file: IFile,
    updater: (current: IFrontmatter) => IFrontmatter,
  ): Promise<void> {
    const currentFrontmatter = this.getFrontmatter(file) || {};
    const newFrontmatter = updater(currentFrontmatter);

    const obsidianFile = this.toObsidianFile(file);
    await this.app.fileManager.processFrontMatter(
      obsidianFile,
      (frontmatter) => {
        Object.keys(newFrontmatter).forEach((key) => {
          const normalizedKey = FrontmatterService.normalizeIRI(key);
          let value = newFrontmatter[key];
          if (typeof value === "string") {
            value = FrontmatterService.normalizeIRIValue(value);
          }
          frontmatter[normalizedKey] = value;
        });
      },
    );
  }

  async rename(file: IFile, newPath: string): Promise<void> {
    const obsidianFile = this.toObsidianFile(file);
    await this.app.fileManager.renameFile(obsidianFile, newPath);
  }

  async createFolder(path: string): Promise<void> {
    await this.vault.createFolder(path);
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): IFile | null {
    const file = this.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (file) return this.fromObsidianFile(file);
    // Tier 2 (req 7d00a60b): metadataCache is cold (reset index, fresh device,
    // large re-sync) — fall back to the file registry so class references keep
    // resolving and rdf:type-gated command buttons still render.
    return this.resolveUuidFromRegistry(linkpath);
  }

  /**
   * Resolve a `uid-bare` linkpath WITHOUT metadataCache (req 7d00a60b, Tier 2).
   *
   * `vault.getMarkdownFiles()` is the file REGISTRY — synchronous and separate
   * from the metadata cache, so it is populated while Obsidian is still
   * re-indexing. Under the UID-CANON TBox invariant a class file's basename IS
   * its uuid, so the index is built from NAMES ALONE: no file is read, which is
   * what makes this affordable on a phone (contrast the CLI's basename/alias
   * index, which reads every file).
   *
   * Scope is deliberately the uuid form only. Measured over 40 656
   * `exo__Instance_class` values (2026-08-29): `uid-bare` 94.2 % — the ONLY form
   * that reaches a vault lookup; `uid+alias` 5.4 % and `label-bare` 0.4 %
   * already resolve upstream in `NoteToRDFConverter.valueToClassURI` (layers 1-2)
   * without touching the vault at all. Resolving them here would add cost for
   * callers that never arrive.
   *
   * The alias half of `[[uuid|label]]` is stripped first, mirroring the CLI
   * adapter's `linkpath.split("|")[0]`, so both wikilink spellings land here
   * identically if a caller ever passes the raw form.
   */
  private resolveUuidFromRegistry(linkpath: string): IFile | null {
    const head = linkpath.split("|")[0].trim();
    if (!UUID_LINKPATH.test(head)) return null;

    const files = this.vault.getMarkdownFiles();
    // Rebuild when the file count moved. A rename that keeps the count is not
    // covered — by then metadataCache has normally caught up and the fallback
    // is not reached; a stale entry still fails safe, because the path is
    // re-resolved through the registry below and yields null when it is gone.
    if (this.uuidRegistry === null || this.uuidRegistryCount !== files.length) {
      const index = new Map<string, string>();
      for (const f of files) {
        const match = UUID_BASENAME.exec(f.basename);
        // First-write-wins on a duplicate uuid, matching the CLI adapter.
        if (match && !index.has(match[1].toLowerCase())) {
          index.set(match[1].toLowerCase(), f.path);
        }
      }
      this.uuidRegistry = index;
      this.uuidRegistryCount = files.length;
    }

    const path = this.uuidRegistry.get(head.toLowerCase());
    if (path === undefined) return null;
    const resolved = this.vault.getAbstractFileByPath(path);
    return resolved instanceof TFile ? this.fromObsidianFile(resolved) : null;
  }

  async process(file: IFile, fn: (content: string) => string): Promise<string> {
    const obsidianFile = this.toObsidianFile(file);
    return await this.vault.process(obsidianFile, fn);
  }

  getDefaultNewFileParent(): IFolder | null {
    const folder = this.app.fileManager.getNewFileParent("");
    if (!folder) return null;
    return this.fromObsidianFolder(folder);
  }

  private fromObsidianFile(file: TFile): IFile {
    const iFile: IFile = {
      path: file.path,
      basename: file.basename,
      name: file.name,
      parent: file.parent ? this.fromObsidianFolder(file.parent) : null,
      stat: file.stat
        ? {
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
          }
        : undefined,
    };
    this.fileCache.set(iFile, file);
    return iFile;
  }

  private fromObsidianFolder(folder: TFolder): IFolder {
    return {
      path: folder.path,
      name: folder.name,
    };
  }

  private toObsidianFile(file: IFile): TFile {
    const cachedFile = this.fileCache.get(file);
    if (cachedFile) {
      return cachedFile;
    }

    const obsidianFile = this.vault.getAbstractFileByPath(file.path);
    if (!obsidianFile || !(obsidianFile instanceof TFile)) {
      throw new Error(`File not found: ${file.path}`);
    }
    // Cache the file for future use
    this.fileCache.set(file, obsidianFile);
    return obsidianFile;
  }

  toTFile(file: IFile): TFile {
    return this.toObsidianFile(file);
  }

  async updateLinks(
    oldPath: string,
    newPath: string,
    oldBasename: string,
  ): Promise<void> {
    const newBasename = newPath.replace(/\.md$/, "").split("/").pop() || "";

    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    const filesToUpdate: string[] = [];

    for (const sourcePath in resolvedLinks) {
      const links = resolvedLinks[sourcePath];
      if (links[oldPath] !== undefined) {
        filesToUpdate.push(sourcePath);
      }
    }

    for (const sourcePath of filesToUpdate) {
      const sourceFile = this.vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof TFile)) continue;

      let content = await this.vault.read(sourceFile);

      const escapedOldBasename = oldBasename.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );

      // Collapse all wikilink shapes to bare [[newBasename]]:
      //   [[Old]] / [[Old|*]] / [[Old#h]] / [[Old#h|*]] / [[Old^b]] / [[Old^b|*]]
      // Display label resolved at render time from target's exo__Asset_label;
      // old basename preserved in target frontmatter `aliases:` by service.
      const collapseRegex = new RegExp(
        `\\[\\[${escapedOldBasename}(?:[#^][^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`,
        "g",
      );
      content = content.replace(collapseRegex, `[[${newBasename}]]`);

      await this.vault.modify(sourceFile, content);
    }
  }
}
