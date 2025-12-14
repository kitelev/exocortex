import fs from "fs-extra";
import path from "path";
import * as glob from "glob";
import yaml from "js-yaml";
import {
  IFileSystemAdapter,
  FileNotFoundError,
  FileAlreadyExistsError,
} from "exocortex";

export class NodeFsAdapter implements IFileSystemAdapter {
  constructor(private rootPath: string) {}

  async readFile(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    if (!(await fs.pathExists(fullPath))) {
      throw new FileNotFoundError(filePath);
    }
    return fs.readFile(fullPath, "utf-8");
  }

  async fileExists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);
    return fs.pathExists(fullPath);
  }

  async getFileMetadata(filePath: string): Promise<Record<string, any>> {
    const content = await this.readFile(filePath);
    return this.extractFrontmatter(content);
  }

  async createFile(filePath: string, content: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    if (await fs.pathExists(fullPath)) {
      throw new FileAlreadyExistsError(filePath);
    }
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, "utf-8");
    return filePath;
  }

  async updateFile(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    if (!(await fs.pathExists(fullPath))) {
      throw new FileNotFoundError(filePath);
    }
    await fs.writeFile(fullPath, content, "utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, "utf-8");
  }

  async deleteFile(filePath: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    if (!(await fs.pathExists(fullPath))) {
      throw new FileNotFoundError(filePath);
    }
    await fs.remove(fullPath);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const fullOldPath = this.resolvePath(oldPath);
    const fullNewPath = this.resolvePath(newPath);
    if (!(await fs.pathExists(fullOldPath))) {
      throw new FileNotFoundError(oldPath);
    }
    await fs.ensureDir(path.dirname(fullNewPath));
    await fs.move(fullOldPath, fullNewPath);
  }

  async createDirectory(dirPath: string): Promise<void> {
    const fullPath = this.resolvePath(dirPath);
    await fs.ensureDir(fullPath);
  }

  async directoryExists(dirPath: string): Promise<boolean> {
    const fullPath = this.resolvePath(dirPath);
    if (!(await fs.pathExists(fullPath))) return false;
    const stats = await fs.stat(fullPath);
    return stats.isDirectory();
  }

  async getMarkdownFiles(rootPath?: string): Promise<string[]> {
    const searchPath = rootPath ? this.resolvePath(rootPath) : this.rootPath;
    const pattern = path.join(searchPath, "**/*.md");

    const files = await glob.glob(pattern, { nodir: true });
    const relativePaths = files.map((f: string) =>
      path.relative(this.rootPath, f),
    );
    return relativePaths;
  }

  async findFilesByMetadata(query: Record<string, any>): Promise<string[]> {
    const allFiles = await this.getMarkdownFiles();
    const matches: string[] = [];

    for (const file of allFiles) {
      try {
        const metadata = await this.getFileMetadata(file);
        if (this.matchesQuery(metadata, query)) {
          matches.push(file);
        }
      } catch (error) {
        continue;
      }
    }

    return matches;
  }

  async findFileByUID(uid: string): Promise<string | null> {
    const files = await this.findFilesByMetadata({ exo__Asset_uid: uid });
    return files.length > 0 ? files[0] : null;
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.rootPath, filePath);
  }

  private extractFrontmatter(content: string): Record<string, any> {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return {};
    }

    try {
      const parsed = yaml.load(match[1]);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, any>)
        : {};
    } catch (error) {
      return {};
    }
  }

  private matchesQuery(
    metadata: Record<string, any>,
    query: Record<string, any>,
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

  private normalizeValue(value: any): string {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/["'[\]]/g, "")
      .trim();
  }
}
