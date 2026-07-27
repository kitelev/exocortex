import fs from "fs-extra";
import path from "path";
import * as yaml from "js-yaml";
import {
  IVaultAdapter,
  IFile,
  IFolder,
  IFrontmatter,
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

  async updateFrontmatter(
    file: IFile,
    updater: (current: IFrontmatter) => IFrontmatter,
  ): Promise<void> {
    const content = await this.read(file);
    const currentFrontmatter = this.extractFrontmatter(content) || {};
    const updatedFrontmatter = updater(currentFrontmatter);
    const newContent = this.replaceFrontmatter(content, updatedFrontmatter);
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

  getFirstLinkpathDest(linkpath: string, sourcePath: string): IFile | null {
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

    // Step 4: Fall back to basename / frontmatter-alias index lookup so
    // wikilinks like [[ems__EffortStatusBacklog]] resolve to the file that
    // declares it as a basename or alias, matching Obsidian's behavior.
    if (this.basenameIndex === null || this.aliasIndex === null) {
      this.buildLinkpathIndex();
    }

    const linkKey = cleanLinkpath.toLowerCase();
    const basenameMatch = this.basenameIndex!.get(linkKey);
    if (basenameMatch) {
      return this.createFileObject(basenameMatch);
    }

    const aliasMatch = this.aliasIndex!.get(linkKey);
    if (aliasMatch) {
      return this.createFileObject(aliasMatch);
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

  private extractFrontmatter(content: string): IFrontmatter | null {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return null;
    }

    // #3800: tolerant parse — a duplicated mapping key would otherwise throw
    // and collapse the asset to `null` (0 triples → invisible & unrepairable).
    return parseYamlFrontmatterTolerant(match[1]) as IFrontmatter | null;
  }

  private replaceFrontmatter(
    content: string,
    frontmatter: IFrontmatter,
  ): string {
    const frontmatterYaml = yaml.dump(frontmatter, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
    });

    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (match) {
      return content.replace(
        frontmatterRegex,
        `---\n${frontmatterYaml.trim()}\n---`,
      );
    } else {
      return `---\n${frontmatterYaml.trim()}\n---\n${content}`;
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
