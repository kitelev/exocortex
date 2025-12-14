/**
 * Role-based interface for file reading operations.
 * Following Interface Segregation Principle (ISP).
 */
export interface IFileSystemReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  getMarkdownFiles(rootPath?: string): Promise<string[]>;
}

/**
 * Role-based interface for file writing operations.
 * Following Interface Segregation Principle (ISP).
 */
export interface IFileSystemWriter {
  createFile(path: string, content: string): Promise<string>;
  updateFile(path: string, content: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
}

/**
 * Role-based interface for file metadata operations.
 * Following Interface Segregation Principle (ISP).
 */
export interface IFileSystemMetadataProvider {
  getFileMetadata(path: string): Promise<Record<string, any>>;
  findFilesByMetadata(query: Record<string, any>): Promise<string[]>;
  findFileByUID(uid: string): Promise<string | null>;
}

/**
 * Role-based interface for directory management.
 * Following Interface Segregation Principle (ISP).
 */
export interface IFileSystemDirectoryManager {
  createDirectory(path: string): Promise<void>;
  directoryExists(path: string): Promise<boolean>;
}

/**
 * Composite interface extending all role-based file system interfaces.
 * Maintains backward compatibility while following ISP.
 * Clients can depend on specific role interfaces instead of this full interface.
 */
export interface IFileSystemAdapter
  extends IFileSystemReader,
    IFileSystemWriter,
    IFileSystemMetadataProvider,
    IFileSystemDirectoryManager {}

export class FileNotFoundError extends Error {
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = "FileNotFoundError";
  }
}

export class FileAlreadyExistsError extends Error {
  constructor(path: string) {
    super(`File already exists: ${path}`);
    this.name = "FileAlreadyExistsError";
  }
}
