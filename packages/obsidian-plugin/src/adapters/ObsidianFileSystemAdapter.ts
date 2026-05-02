import { Vault, TFolder } from "obsidian";
import yaml from "js-yaml";
import {
  IFileSystemAdapter,
  FileNotFoundError,
  FileAlreadyExistsError,
} from "exocortex";

export class ObsidianFileSystemAdapter implements IFileSystemAdapter {
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

  async getFileMetadata(path: string): Promise<Record<string, unknown>> {
    const content = await this.readFile(path);
    return this.extractFrontmatter(content);
  }

  async findFilesByMetadata(
    query: Record<string, unknown>,
  ): Promise<string[]> {
    const allFiles = await this.getMarkdownFiles();
    const matches: string[] = [];

    for (const file of allFiles) {
      try {
        const metadata = await this.getFileMetadata(file);
        if (this.matchesQuery(metadata, query)) {
          matches.push(file);
        }
      } catch {
        continue;
      }
    }

    return matches;
  }

  async findFileByUID(uid: string): Promise<string | null> {
    const files = await this.findFilesByMetadata({ exo__Asset_uid: uid });
    return files.length > 0 ? files[0] : null;
  }

  async createDirectory(path: string): Promise<void> {
    await this.vault.adapter.mkdir(path);
  }

  async directoryExists(path: string): Promise<boolean> {
    const exists = await this.vault.adapter.exists(path);
    if (!exists) return false;
    const abstract = this.vault.getAbstractFileByPath(path);
    return abstract instanceof TFolder;
  }

  private extractFrontmatter(content: string): Record<string, unknown> {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    if (!match) {
      return {};
    }
    try {
      const parsed = yaml.load(match[1]);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private matchesQuery(
    metadata: Record<string, unknown>,
    query: Record<string, unknown>,
  ): boolean {
    for (const [key, value] of Object.entries(query)) {
      const metaValue = metadata[key];
      if (Array.isArray(metaValue)) {
        if (
          !metaValue.some(
            (v) => this.normalizeValue(v) === this.normalizeValue(value),
          )
        ) {
          return false;
        }
      } else if (
        this.normalizeValue(metaValue) !== this.normalizeValue(value)
      ) {
        return false;
      }
    }
    return true;
  }

  private normalizeValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/["'[\]]/g, "")
      .trim();
  }
}
