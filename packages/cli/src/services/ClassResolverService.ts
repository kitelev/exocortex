import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";

/**
 * Error thrown when a class short name cannot be resolved in the vault.
 * Includes available class names as suggestions when available.
 */
export class ClassNotFoundError extends Error {
  constructor(className: string, availableClasses?: string[]) {
    let message = `Class '${className}' not found in vault`;
    if (availableClasses && availableClasses.length > 0) {
      message += `\nAvailable classes: ${availableClasses.join(", ")}`;
    }
    super(message);
    this.name = "ClassNotFoundError";
  }
}

/**
 * Resolves class short names (e.g. "ztlk__PermanentNote") to their actual UUIDs
 * by scanning vault files for class definitions.
 *
 * Class definitions are vault files where:
 * - `exo__Instance_class` contains `ims__Class`
 * - The file name (without .md) or `exo__Asset_uid` provides the UUID
 * - `exo__Asset_label` or file basename provides the short name
 *
 * @example
 * ```typescript
 * const resolver = new ClassResolverService(fsAdapter);
 * const uuid = await resolver.resolve("/path/to/vault", "ztlk__PermanentNote");
 * // Returns the UUID of ztlk__PermanentNote class definition
 * ```
 */
export class ClassResolverService {
  /** In-memory cache: vaultPath -> Map<shortName, uuid> */
  private cache: Map<string, Map<string, string>> = new Map();

  constructor(private readonly fsAdapter: NodeFsAdapter) {}

  /**
   * Resolve a class short name to its UUID.
   *
   * If the input already looks like a UUID (matches UUID v4 pattern),
   * it is returned as-is (pass-through).
   *
   * @param vaultPath - Path to the vault root
   * @param classShortName - Class short name (e.g. "ztlk__PermanentNote")
   * @returns The UUID of the class
   * @throws ClassNotFoundError if the class cannot be found
   */
  async resolve(vaultPath: string, classShortName: string): Promise<string> {
    // UUID pass-through: if input already looks like a UUID, return as-is
    if (this.isUUID(classShortName)) {
      return classShortName;
    }

    const index = await this.getOrBuildIndex(vaultPath);
    const uuid = index.get(classShortName);

    if (!uuid) {
      const availableClasses = Array.from(index.keys()).filter(
        (name) => !this.isUUID(name),
      );
      throw new ClassNotFoundError(classShortName, availableClasses);
    }

    return uuid;
  }

  /**
   * Get all known class names in the vault.
   */
  async listClasses(vaultPath: string): Promise<string[]> {
    const index = await this.getOrBuildIndex(vaultPath);
    return Array.from(index.keys());
  }

  /**
   * Get or build the class name -> UUID index for a vault.
   */
  private async getOrBuildIndex(vaultPath: string): Promise<Map<string, string>> {
    if (this.cache.has(vaultPath)) {
      return this.cache.get(vaultPath)!;
    }

    const index = await this.buildIndex(vaultPath);
    this.cache.set(vaultPath, index);
    return index;
  }

  /**
   * Build the class name -> UUID index by scanning vault files.
   *
   * Scans all markdown files and looks for files where exo__Instance_class
   * contains "ims__Class" or "exo__Class". For those files:
   * - exo__Asset_uid is used as the UUID (preferred)
   * - If exo__Asset_uid is missing, the file basename is used if it is a valid UUID
   * - The file basename and exo__Asset_label are used as lookup keys
   */
  private async buildIndex(vaultPath: string): Promise<Map<string, string>> {
    const index = new Map<string, string>();

    const files = await this.fsAdapter.getMarkdownFiles();

    for (const file of files) {
      try {
        const metadata = await this.fsAdapter.getFileMetadata(file);

        if (!this.isClassDefinition(metadata)) {
          continue;
        }

        // Determine UUID: prefer exo__Asset_uid, fallback to filename if it's a UUID
        const basename = this.getBasename(file);
        let uid = metadata.exo__Asset_uid;
        if (!uid && this.isUUID(basename)) {
          uid = basename;
        }
        if (!uid) {
          continue;
        }

        const uidStr = String(uid);

        // Index by basename (for human-named files like ztlk__PermanentNote.md)
        if (basename) {
          index.set(basename, uidStr);
        }

        // Index by exo__Asset_label (primary lookup key for UUID-named files)
        const label = metadata.exo__Asset_label;
        if (label && typeof label === "string" && label !== basename) {
          index.set(label, uidStr);
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    return index;
  }

  /**
   * Check if a file's metadata indicates it is a class definition.
   * Recognizes both `ims__Class` (legacy) and `exo__Class` (current) markers.
   */
  private isClassDefinition(metadata: Record<string, unknown>): boolean {
    const instanceClass = metadata.exo__Instance_class;

    if (!instanceClass) {
      return false;
    }

    const classValues = Array.isArray(instanceClass) ? instanceClass : [instanceClass];

    return classValues.some((value) => {
      const str = String(value);
      return str.includes("ims__Class") || str.includes("exo__Class");
    });
  }

  /**
   * Get basename from a file path (without .md extension).
   */
  private getBasename(filepath: string): string {
    const parts = filepath.split("/");
    const filename = parts[parts.length - 1];
    return filename.replace(/\.md$/, "");
  }

  /**
   * Check if a string looks like a UUID v4.
   */
  private isUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }
}
