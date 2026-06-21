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
   * A file is a class definition when its `exo__Instance_class` references the
   * class metaclass. Two reference forms are recognized:
   *  - legacy label-form wikilinks: `[[exo__Class]]` / `[[ims__Class]]`
   *  - UID-canon form: `[[<metaclass-uuid>]]`, where the metaclass UUID is
   *    discovered from the vault (a file whose `exo__Asset_label` is exactly
   *    `exo__Class` / `ims__Class`) — no metaclass UUID is hardcoded.
   *
   * Under UID-canon TBox (CLAUDE.md) every class definition references the
   * metaclass by UUID, so the legacy string match alone never matches and
   * short-name resolution silently fails — `--class ems__Task` throws while
   * `--class <uuid>` still works via pass-through. Discovering the metaclass
   * UID(s) by label closes that gap (dogfood W1, RFC 7c7859d1).
   *
   * For class-definition files:
   * - exo__Asset_uid is used as the UUID (preferred)
   * - If exo__Asset_uid is missing, the file basename is used if it is a valid UUID
   * - The file basename and exo__Asset_label are used as lookup keys
   */
  private async buildIndex(vaultPath: string): Promise<Map<string, string>> {
    const index = new Map<string, string>();

    const files = await this.fsAdapter.getMarkdownFiles();

    // Pass 1: read each file's metadata once, extract the minimal fields, and
    // discover the class-metaclass UID(s) by label so UID-canon class refs can
    // be matched without hardcoding a metaclass UUID.
    const entries: {
      basename: string;
      uid?: string;
      label?: string;
      classValues: string[];
    }[] = [];
    const metaclassUids = new Set<string>();

    for (const file of files) {
      try {
        const metadata = await this.fsAdapter.getFileMetadata(file);

        const basename = this.getBasename(file);
        let uid = metadata.exo__Asset_uid;
        if (!uid && this.isUUID(basename)) {
          uid = basename;
        }
        const uidStr = uid ? String(uid) : undefined;

        const rawLabel = metadata.exo__Asset_label;
        const label = typeof rawLabel === "string" ? rawLabel : undefined;

        const instanceClass = metadata.exo__Instance_class;
        const classValues = instanceClass
          ? (Array.isArray(instanceClass)
              ? instanceClass
              : [instanceClass]
            ).map((value) => String(value))
          : [];

        entries.push({ basename, uid: uidStr, label, classValues });

        // Discover class-metaclass UID(s): a file whose label is exactly
        // `exo__Class` / `ims__Class` is the metaclass every class instances.
        if (uidStr && (label === "exo__Class" || label === "ims__Class")) {
          metaclassUids.add(uidStr);
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    // Pass 2: index files that are class definitions.
    for (const entry of entries) {
      if (!entry.uid) {
        continue;
      }
      if (!this.isClassDefinition(entry.classValues, metaclassUids)) {
        continue;
      }

      // Index by basename (for human-named files like ztlk__PermanentNote.md)
      if (entry.basename) {
        index.set(entry.basename, entry.uid);
      }

      // Index by exo__Asset_label (primary lookup key for UUID-named files)
      if (entry.label && entry.label !== entry.basename) {
        index.set(entry.label, entry.uid);
      }
    }

    return index;
  }

  /**
   * Check whether a file's `exo__Instance_class` values mark it as a class
   * definition. Matches both the legacy label-form (`[[exo__Class]]` /
   * `[[ims__Class]]`) and the UID-canon form (`[[<metaclass-uuid>]]`), where the
   * metaclass UID(s) were discovered from the vault by label.
   */
  private isClassDefinition(
    classValues: string[],
    metaclassUids: Set<string>,
  ): boolean {
    return classValues.some((str) => {
      // Legacy label-form wikilinks.
      if (str.includes("ims__Class") || str.includes("exo__Class")) {
        return true;
      }
      // UID-canon form: a file whose `exo__Instance_class` references a
      // discovered metaclass UID is by definition a class definition. The
      // metaclass UID(s) are only discovered from files labelled
      // `exo__Class` / `ims__Class`, so this match cannot pick up a non-class.
      for (const uid of metaclassUids) {
        if (uid && str.includes(uid)) {
          return true;
        }
      }
      return false;
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
