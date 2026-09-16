export interface IFileStat {
  ctime: number;
  mtime: number;
}

export interface IFile {
  path: string;
  basename: string;
  name: string;
  parent: IFolder | null;
  stat?: IFileStat;
}

export interface IFolder {
  path: string;
  name: string;
}

export interface IFrontmatter {
  [key: string]: unknown;
}

/**
 * Role-based interface for file reading operations.
 * Following Interface Segregation Principle (ISP).
 */
export interface IVaultFileReader {
  read(file: IFile): Promise<string>;
  exists(path: string): Promise<boolean>;
  getAllFiles(): IFile[];
  getAbstractFileByPath(path: string): IFile | IFolder | null;
}

/**
 * Role-based interface for file writing operations.
 * Following Interface Segregation Principle (ISP).
 */
export interface IVaultFileWriter {
  create(path: string, content: string): Promise<IFile>;
  modify(file: IFile, newContent: string): Promise<void>;
  delete(file: IFile): Promise<void>;
  process(file: IFile, fn: (content: string) => string): Promise<string>;
}

/**
 * Role-based interface for file renaming and link updates.
 * Following Interface Segregation Principle (ISP).
 */
export interface IVaultFileRenamer {
  rename(file: IFile, newPath: string): Promise<void>;
  updateLinks(
    oldPath: string,
    newPath: string,
    oldBasename: string,
  ): Promise<void>;
}

/**
 * Role-based interface for folder management.
 * Following Interface Segregation Principle (ISP).
 */
export interface IVaultFolderManager {
  createFolder(path: string): Promise<void>;
  getDefaultNewFileParent(): IFolder | null;
}

/**
 * Role-based interface for frontmatter operations.
 * Following Interface Segregation Principle (ISP).
 */
export interface IVaultFrontmatterManager {
  getFrontmatter(file: IFile): IFrontmatter | null;
  /**
   * Frontmatter with a disk fallback for when the platform's metadata cache is
   * cold (a reset index, a fresh device, a large re-sync).
   *
   * OPTIONAL because it is a platform capability, not a universal contract: an
   * adapter that already reads the filesystem directly (the CLI one) has no
   * second tier to fall back to, and the 15 in-memory test adapters have no
   * disk at all. Callers therefore feature-detect and degrade to the cached
   * `getFrontmatter` when it is absent.
   */
  getFrontmatterWithFallback?(file: IFile): Promise<IFrontmatter | null>;
  /**
   * Write the keys `updater` returns into the file's frontmatter (req
   * `2a020489`; the plugin half of the dialect is req `de7131ae`).
   *
   * Contract — the same for every production adapter, because both go through
   * the single carrier `FrontmatterService.applyPatch` and re-implement none
   * of it:
   *
   * 1. **PATCH, not REPLACE.** `updater` returns the keys to WRITE; every key
   *    of the current frontmatter it does not return is preserved unchanged.
   * 2. **Omission is not deletion.** This port never removes a key the caller
   *    left out; the only keys it removes are the `LEGACY_YAML_KEYS`
   *    spellings of a canonical key it has just written (bare `archived`
   *    after a write of `exo__Asset_archived`). To remove a property use
   *    `FrontmatterService.removeProperty` (the CLI `remove-property` verb /
   *    the `un-archive` grounding are built on it).
   * 3. **Every returned key goes through the chokepoint dialect.** A full
   *    object returned as `{...current, [prop]: value}` (the shape
   *    `LayoutService.handleCellEdit` produces) has EACH key mapped through
   *    `canonicalYamlKey(FrontmatterService.normalizeIRI(key))`, each string
   *    value through `FrontmatterService.normalizeIRIValue` in its BARE form
   *    (`[[x]]` — the serialiser quotes it on disk, so for a REFERENCE STRING
   *    the CLI adapter writes the same `key: "[[x]]"` line the text path does;
   *    req `27fbe40b`. Only that line is parity: the CLI adapter re-dumps the
   *    WHOLE block, so other scalars may change shape — an unquoted YAML 1.1
   *    timestamp is re-emitted as its Date form, an empty value as `null`), both
   *    spellings of one key resolved canonical-wins, and the legacy spelling
   *    of each written canonical key dropped from the file — so editing ANY
   *    key of a legacy `archived:` carrier migrates it.
   *
   * A file whose frontmatter block is present but not parseable is REFUSED
   * (rejects, file untouched) rather than patched over — patching would drop
   * every key the block held (PR #4243 review). A file with no block gets one.
   */
  updateFrontmatter(
    file: IFile,
    updater: (current: IFrontmatter) => IFrontmatter,
  ): Promise<void>;
}

/**
 * Role-based interface for link resolution.
 * Following Interface Segregation Principle (ISP).
 */
export interface IVaultLinkResolver {
  getFirstLinkpathDest(linkpath: string, sourcePath: string): IFile | null;
}

/**
 * Composite interface extending all role-based vault interfaces.
 * Maintains backward compatibility while following ISP.
 * Clients can depend on specific role interfaces instead of this full interface.
 */
export interface IVaultAdapter
  extends IVaultFileReader,
    IVaultFileWriter,
    IVaultFileRenamer,
    IVaultFolderManager,
    IVaultFrontmatterManager,
    IVaultLinkResolver {}
