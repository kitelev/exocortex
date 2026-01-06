import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";
import { IVaultAdapter, IFile, IFolder, IFrontmatter } from "exocortex";

export class FileSystemVaultAdapter implements IVaultAdapter {
  private folderFilter?: string;

  constructor(private rootPath: string, folderFilter?: string) {
    this.folderFilter = folderFilter;
  }

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
    const startPath = this.folderFilter
      ? path.join(this.rootPath, this.folderFilter)
      : this.rootPath;

    // Validate folder exists if filter is specified
    if (this.folderFilter && !fs.existsSync(startPath)) {
      throw new Error(`Folder not found: ${this.folderFilter}`);
    }

    this.walkDirectory(startPath, (filePath) => {
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
    const sourceDir = path.dirname(this.resolvePath(sourcePath));
    let resolvedPath: string;

    if (path.isAbsolute(linkpath)) {
      resolvedPath = this.resolvePath(linkpath);
    } else {
      resolvedPath = path.resolve(sourceDir, linkpath);
    }

    if (!linkpath.endsWith(".md")) {
      resolvedPath += ".md";
    }

    if (fs.existsSync(resolvedPath)) {
      const relativePath = path.relative(this.rootPath, resolvedPath);
      return this.createFileObject(relativePath);
    }

    return null;
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

  async updateLinks(
    _oldPath: string,
    _newPath: string,
    _oldBasename: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.rootPath, filePath);
  }

  private createFileObject(filePath: string): IFile {
    const basename = path.basename(filePath);
    const name = path.basename(filePath, path.extname(filePath));
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

    try {
      const parsed = yaml.load(match[1]);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as IFrontmatter)
        : null;
    } catch (error) {
      return null;
    }
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

  private walkDirectory(
    dir: string,
    callback: (filePath: string) => void,
  ): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        this.walkDirectory(fullPath, callback);
      } else if (entry.isFile()) {
        callback(fullPath);
      }
    }
  }
}
