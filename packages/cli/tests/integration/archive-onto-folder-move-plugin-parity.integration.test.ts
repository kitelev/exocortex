/**
 * Regression: «Archive Ontologically» must RELOCATE the file into the archive
 * ontology folder — in the PLUGIN as well as the CLI (req 8efc003c).
 *
 * The command is a composite grounding:
 *   step-1 = property_set  exo__Asset_isDefinedBy → archive ontology
 *   step-2 = service_call  serviceId=repairFolder  (co-location relocation)
 *
 * The CLI works (`apply-ontological-archive.integration.test.ts`) because its
 * `FileSystemVaultAdapter.getFrontmatter` reads FRESH from disk
 * (`fs.readFileSync`). The plugin's `ObsidianVaultAdapter.getFrontmatter` reads
 * from `app.metadataCache`, which is re-indexed ASYNCHRONOUSLY after a write.
 * Inside one synchronous composite, step-1 writes the new `isDefinedBy` to disk
 * but the metadataCache still holds the OLD value → `getExpectedFolder`
 * computes the OLD (current) folder → `currentFolder === expectedFolder` →
 * `repairFolder` no-ops → the file is re-anchored but never moved.
 *
 * This test reproduces the plugin's storage contract faithfully with a
 * plugin-parity adapter: fresh-disk `read`/`readFile`/`updateFile`, but a
 * `getFrontmatter` that lags a disk write (updated only on explicit re-index,
 * exactly like `metadataCache`). It drives the REAL `GroundingExecutor`,
 * `FolderRepairService`, and `createRepairFolderService`. With the bug the file
 * stays put; with the fix (fresh read in the repairFolder service) it moves —
 * matching the CLI.
 *
 * Revert-verify: reverting the fresh-read in `createRepairFolderService` (back
 * to `vaultAdapter.getFrontmatter`) turns this RED; restoring it makes it GREEN.
 */
import { describe, it, expect } from "@jest/globals";
import {
  GroundingExecutor,
  ServiceRegistry,
  FolderRepairService,
  GroundingType,
  FrontmatterService,
  type GroundingDefinition,
  type IVaultAdapter,
  type IFile,
  type IFolder,
  type IFrontmatter,
} from "@kitelev/exocortex-core";
import {
  createRepairFolderService,
  type ITargetResolver,
} from "@kitelev/exocortex-services";

// UID-canon filenames (basename === uid), mirroring a real vault so that
// getFirstLinkpathDest resolves the ontology refs the same way Obsidian does.
const TARGET_UID = "b1000000-0000-4000-8000-0000000000b1";
const SRC_ONTO_UID = "b2000000-0000-4000-8000-0000000000b2";
const ARCHIVE_ONTO_UID = "b3000000-0000-4000-8000-0000000000b3";

const SPACE = "assetspaces/kitelev/exoas-my/my-efforts";
const ARCHIVE_SPACE = "assetspaces/kitelev/exoas-my/my-efforts/archived";

const TARGET_PATH = `${SPACE}/${TARGET_UID}.md`;
const SRC_ONTO_PATH = `${SPACE}/${SRC_ONTO_UID}.md`;
const ARCHIVE_ONTO_PATH = `${ARCHIVE_SPACE}/${ARCHIVE_ONTO_UID}.md`;

const TARGET_INITIAL = [
  "---",
  `exo__Asset_uid: ${TARGET_UID}`,
  `exo__Asset_label: "Some archived effort"`,
  `exo__Asset_isDefinedBy: "[[${SRC_ONTO_UID}]]"`,
  "archived: true",
  "---",
  "",
  "Body.",
  "",
].join("\n");

function basename(p: string): string {
  return (p.split("/").pop() ?? p).replace(/\.md$/, "");
}
function parentPath(p: string): string {
  return p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
}
function makeIFile(p: string): IFile {
  const parent = parentPath(p);
  return {
    path: p,
    name: p.split("/").pop() ?? p,
    basename: basename(p),
    parent: { path: parent, name: parent.split("/").pop() ?? "" } as IFolder,
  };
}

/**
 * In-memory storage modelling the PLUGIN's split:
 *  - `disk`  — file content, updated synchronously on every write (fresh).
 *  - `meta`  — the metadataCache view; updated ONLY by an explicit reindex()
 *              (never automatically on write) → models the async cache lag.
 * The GroundingExecutor's fileReader/fileWriter and the vaultAdapter's `read`
 * all hit `disk`; `getFrontmatter` hits `meta`.
 */
class FakePluginStorage {
  readonly disk = new Map<string, string>();
  readonly meta = new Map<string, IFrontmatter>();
  readonly folders = new Set<string>();

  /** Populate a file on disk AND index its frontmatter into the cache. */
  seed(path: string, content: string): void {
    this.disk.set(path, content);
    for (
      let dir = parentPath(path);
      dir !== "";
      dir = parentPath(dir)
    ) {
      this.folders.add(dir);
    }
    this.reindex(path);
  }

  /** Re-parse a file's frontmatter into the cache (what the async re-index does). */
  reindex(path: string): void {
    const content = this.disk.get(path);
    if (content === undefined) {
      this.meta.delete(path);
      return;
    }
    this.meta.set(
      path,
      (new FrontmatterService().parseObject(content) ??
        {}) as IFrontmatter,
    );
  }

  // -- IFileSystemReader --
  readonly fileReader = {
    readFile: async (path: string): Promise<string> => {
      const c = this.disk.get(path);
      if (c === undefined) throw new Error(`ENOENT: ${path}`);
      return c;
    },
    fileExists: async (path: string): Promise<boolean> => this.disk.has(path),
    getMarkdownFiles: async (): Promise<string[]> => [...this.disk.keys()],
  };

  // -- IFileSystemWriter (writes disk; DELIBERATELY does NOT reindex meta) --
  readonly fileWriter = {
    createFile: async (path: string, content: string): Promise<string> => {
      this.disk.set(path, content);
      return path;
    },
    updateFile: async (path: string, content: string): Promise<void> => {
      // NOTE: intentionally no reindex — models metadataCache lag after a write.
      this.disk.set(path, content);
    },
    writeFile: async (path: string, content: string): Promise<void> => {
      this.disk.set(path, content);
    },
    deleteFile: async (path: string): Promise<void> => {
      this.disk.delete(path);
    },
    renameFile: async (oldPath: string, newPath: string): Promise<void> => {
      const c = this.disk.get(oldPath);
      if (c !== undefined) {
        this.disk.set(newPath, c);
        this.disk.delete(oldPath);
      }
    },
  };

  // -- IVaultAdapter (plugin-parity) --
  vaultAdapter(): IVaultAdapter {
    const self = this;
    return {
      // FRESH disk read (plugin: vault.read).
      read: async (file: IFile): Promise<string> => {
        const c = self.disk.get(file.path);
        if (c === undefined) throw new Error(`ENOENT: ${file.path}`);
        return c;
      },
      // STALE cache read (plugin: metadataCache.getFileCache().frontmatter).
      getFrontmatter: (file: IFile): IFrontmatter | null =>
        self.meta.get(file.path) ?? null,
      getFirstLinkpathDest: (linkpath: string): IFile | null => {
        const hit = [...self.disk.keys()].find(
          (p) => basename(p) === linkpath,
        );
        return hit ? makeIFile(hit) : null;
      },
      getAbstractFileByPath: (path: string): IFile | IFolder | null => {
        if (self.disk.has(path)) return makeIFile(path);
        if (self.folders.has(path))
          return { path, name: path.split("/").pop() ?? "", children: [] } as unknown as IFolder;
        return null;
      },
      rename: async (file: IFile, newPath: string): Promise<void> => {
        const c = self.disk.get(file.path);
        if (c !== undefined) {
          self.disk.set(newPath, c);
          self.disk.delete(file.path);
        }
        const m = self.meta.get(file.path);
        if (m !== undefined) {
          self.meta.set(newPath, m);
          self.meta.delete(file.path);
        }
      },
      createFolder: async (path: string): Promise<void> => {
        self.folders.add(path);
      },
      // -- unused-by-repairFolder members (throw-if-called guards) --
      create: async (): Promise<IFile> => {
        throw new Error("create not expected");
      },
      modify: async (): Promise<void> => {
        throw new Error("modify not expected");
      },
      delete: async (): Promise<void> => {
        throw new Error("delete not expected");
      },
      process: async (): Promise<string> => {
        throw new Error("process not expected");
      },
      exists: async (path: string): Promise<boolean> => self.disk.has(path),
      getAllFiles: (): IFile[] => [...self.disk.keys()].map(makeIFile),
      updateFrontmatter: async (): Promise<void> => {
        throw new Error("updateFrontmatter not expected");
      },
      updateLinks: async (): Promise<void> => {},
      getDefaultNewFileParent: (): IFolder | null => null,
    };
  }
}

function buildComposite(): GroundingDefinition {
  const step1: GroundingDefinition = {
    id: "step1-set-isdefinedby",
    label: "Re-anchor isDefinedBy to archive ontology",
    type: GroundingType.PROPERTY_SET,
    targetProperty: "exo__Asset_isDefinedBy",
    targetValueRef: ARCHIVE_ONTO_UID,
  };
  const step2: GroundingDefinition = {
    id: "step2-repair-folder",
    label: "Relocate to archive ontology folder",
    type: GroundingType.SERVICE_CALL,
    // service_call overloads targetProperty as the serviceId.
    targetProperty: "repairFolder",
  };
  return {
    id: "composite-archive-ontologically",
    label: "Archive Ontologically (composite)",
    type: GroundingType.COMPOSITE,
    steps: [step1, step2],
  };
}

describe("Archive Ontologically — plugin-parity folder move (req 8efc003c)", () => {
  function setup(): {
    storage: FakePluginStorage;
    executor: GroundingExecutor;
  } {
    const storage = new FakePluginStorage();
    // Domain data: target + srcOnto co-located in my-efforts/,
    // archive ontology lives in my-efforts/archived/.
    storage.seed(TARGET_PATH, TARGET_INITIAL);
    storage.seed(
      SRC_ONTO_PATH,
      [
        "---",
        `exo__Asset_uid: ${SRC_ONTO_UID}`,
        `exo__Asset_label: "My efforts ontology"`,
        `exo__Ontology_archiveOntology: "[[${ARCHIVE_ONTO_UID}]]"`,
        "---",
        "",
      ].join("\n"),
    );
    storage.seed(
      ARCHIVE_ONTO_PATH,
      [
        "---",
        `exo__Asset_uid: ${ARCHIVE_ONTO_UID}`,
        `exo__Asset_label: "My efforts ontology (archive)"`,
        "---",
        "",
      ].join("\n"),
    );

    const vaultAdapter = storage.vaultAdapter();
    const registry = new ServiceRegistry();
    const resolver: ITargetResolver = {
      resolveFile: (iri: string): IFile => makeIFile(iri),
    };
    registry.register(
      "repairFolder",
      createRepairFolderService(
        vaultAdapter,
        new FolderRepairService(vaultAdapter),
        resolver,
      ),
    );
    const executor = new GroundingExecutor(
      storage.fileReader,
      storage.fileWriter,
      registry,
    );
    return { storage, executor };
  }

  it("relocates the asset into the archive ontology folder despite a stale metadataCache @req:8efc003c-f0b3-4572-b702-710d66b8b184", async () => {
    const { storage, executor } = setup();

    const result = await executor.execute(
      buildComposite(),
      TARGET_PATH,
      TARGET_PATH,
    );
    expect(result.success).toBe(true);

    // Step-1 re-anchored isDefinedBy to the archive ontology (on disk).
    const oldPath = TARGET_PATH;
    const newPath = `${ARCHIVE_SPACE}/${TARGET_UID}.md`;

    // Step-2 (repairFolder) physically relocated the file into archived/.
    // With the stale-cache bug this assertion FAILS (file stays at oldPath).
    expect(storage.disk.has(oldPath)).toBe(false);
    expect(storage.disk.has(newPath)).toBe(true);

    const moved = storage.disk.get(newPath) ?? "";
    expect(moved).toContain(`exo__Asset_isDefinedBy: "[[${ARCHIVE_ONTO_UID}]]"`);
    expect(moved).not.toContain(SRC_ONTO_UID);
    // archived:true survives (we don't unset it).
    expect(moved).toContain("archived: true");
  });

  it("proves the metadataCache actually lags step-1's write (the bug's mechanism)", async () => {
    const { storage } = setup();
    const vaultAdapter = storage.vaultAdapter();
    const targetFile = makeIFile(TARGET_PATH);

    // Simulate step-1's disk write without reindexing the cache.
    const rewritten = TARGET_INITIAL.replace(
      `[[${SRC_ONTO_UID}]]`,
      `[[${ARCHIVE_ONTO_UID}]]`,
    );
    await storage.fileWriter.updateFile(TARGET_PATH, rewritten);

    // Fresh read sees the NEW ontology; the cache still holds the OLD one.
    const fresh = new FrontmatterService().parseObject(
      await vaultAdapter.read(targetFile),
    );
    expect(fresh?.exo__Asset_isDefinedBy).toContain(ARCHIVE_ONTO_UID);
    expect(vaultAdapter.getFrontmatter(targetFile)?.exo__Asset_isDefinedBy).toContain(
      SRC_ONTO_UID,
    );
  });
});
