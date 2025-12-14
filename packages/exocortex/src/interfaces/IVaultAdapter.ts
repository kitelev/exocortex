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
  [key: string]: any;
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
