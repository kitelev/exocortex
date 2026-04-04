import { Vault } from "obsidian";
import {
  IFileSystemReader,
  IFileSystemWriter,
  FileNotFoundError,
  FileAlreadyExistsError,
} from "exocortex";

export class ObsidianFileSystemAdapter
  implements IFileSystemReader, IFileSystemWriter
{
  constructor(private vault: Vault) {}

  async readFile(path: string): Promise<string> {
    const exists = await this.vault.adapter.exists(path);
    if (!exists) {
      throw new FileNotFoundError(path);
    }
    return this.vault.adapter.read(path);
  }

  async fileExists(path: string): Promise<boolean> {
    return this.vault.adapter.exists(path);
  }

  async getMarkdownFiles(rootPath?: string): Promise<string[]> {
    const files = this.vault.getMarkdownFiles();
    const paths = files.map((f) => f.path);
    if (rootPath) {
      const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
      return paths.filter((p) => p.startsWith(prefix));
    }
    return paths;
  }

  async createFile(path: string, content: string): Promise<string> {
    const exists = await this.vault.adapter.exists(path);
    if (exists) {
      throw new FileAlreadyExistsError(path);
    }
    await this.vault.adapter.write(path, content);
    return path;
  }

  async updateFile(path: string, content: string): Promise<void> {
    const exists = await this.vault.adapter.exists(path);
    if (!exists) {
      throw new FileNotFoundError(path);
    }
    await this.vault.adapter.write(path, content);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.vault.adapter.write(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    const exists = await this.vault.adapter.exists(path);
    if (!exists) {
      throw new FileNotFoundError(path);
    }
    await this.vault.adapter.remove(path);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const exists = await this.vault.adapter.exists(oldPath);
    if (!exists) {
      throw new FileNotFoundError(oldPath);
    }
    await this.vault.adapter.rename(oldPath, newPath);
  }
}
