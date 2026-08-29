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
