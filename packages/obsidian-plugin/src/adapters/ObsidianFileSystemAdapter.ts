import { Vault, TFolder } from "obsidian";
import {
  IFileSystemAdapter,
  FileNotFoundError,
  FileAlreadyExistsError,
  parseYamlFrontmatterTolerant,
} from "@kitelev/exocortex-core";

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

  /**
   * Issue #4046 — creation goes through `Vault.create`, NOT
   * `vault.adapter.write`.
   *
   * `adapter.write` is the raw `DataAdapter`: it puts bytes on disk but fires
   * no vault event, so Obsidian does not register a `TFile` for the new path
   * until its own filesystem watcher happens to catch up. Everything the
   * plugin does with a file afterwards goes through the Vault INDEX —
   * `createObsidianTargetResolver` (`vault.getAbstractFileByPath`),
   * `ObsidianVaultAdapter.toObsidianFile`, `fileManager.renameFile` — so a
   * file created this way is unreachable to all of them for an unbounded,
   * racy window.
   *
   * That made any composite of the shape `[create_instance, <anything that
   * touches the created asset through the Vault API>]` fail in the plugin
   * while working in the CLI (whose `FileSystemVaultAdapter` has no index at
   * all). `Vault.create` returns the registered `TFile`, closing the window
   * synchronously.
   *
   * ⛔ Not interchangeable with the deliberate `adapter.write` calls in
   * ExoSync (`SyncCommands`, `VaultRDFIndexer`): those bypass the vault event
   * ON PURPOSE, to avoid re-entrant re-indexing during a sync round. This
   * adapter is the executor's writer — it wants the event.
   *
   * `updateFile` below deliberately stays on `adapter.write`: the path is
   * already registered, so re-routing it would only add an index lookup.
   */
  async createFile(path: string, content: string): Promise<string> {
    const exists = await this.vault.adapter.exists(path);
    if (exists) {
      throw new FileAlreadyExistsError(path);
    }
    await this.vault.create(path, content);
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
    // #3800: tolerant parse — a duplicated mapping key would otherwise throw
    // and collapse the asset to `{}` (0 triples → invisible & unrepairable).
    return parseYamlFrontmatterTolerant(match[1]) ?? {};
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
