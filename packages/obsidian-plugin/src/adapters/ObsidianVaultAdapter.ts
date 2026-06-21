import { Vault, TFile, TFolder, MetadataCache, App, parseYaml } from "obsidian";
import { IVaultAdapter, IFile, IFolder, IFrontmatter, FrontmatterService } from "@kitelev/exocortex-core";

export class ObsidianVaultAdapter implements IVaultAdapter {
  private fileCache: WeakMap<IFile, TFile> = new WeakMap();

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
    if (!file) return null;
    return this.fromObsidianFile(file);
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
