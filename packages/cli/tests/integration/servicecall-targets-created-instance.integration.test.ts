/**
 * Regression (Issue #4046): a `service_call` composite step that opted into
 * `exocmd__Grounding_targetsCreatedInstance` must make the SERVICE act on the
 * asset a previous `create_instance` step produced — not on the click-target.
 *
 * Before the fix `executeComposite` re-pointed only `stepPath`, while
 * `executeServiceCall` dispatched `service.execute(targetIRI, …)` — and every
 * registered service resolves its file from that IRI (`IGroundingService.execute`
 * has no file-path channel). The step therefore "succeeded" while operating on
 * the click-target: the created asset was never relocated, and the co-location
 * invariant broke silently (no error, no notice).
 *
 * The suite drives the REAL `GroundingExecutor`, the REAL
 * `createRepairFolderService` and the REAL `createPathBasedTargetResolver`
 * against an in-memory vault, so it exercises the exact production seam
 * (executor → IRI → resolver → FolderRepairService).
 *
 * Revert-verify: dropping the `targetsCreatedInstance` branch in
 * `executeServiceCall` (i.e. going back to `service.execute(targetIRI, …)`)
 * turns axis 1 RED — the created asset stays in the source folder — while
 * axes 2-4 stay GREEN (they assert the click-target path, which the fix must
 * not disturb).
 */
import { describe, it, expect } from "@jest/globals";
import {
  GroundingExecutor,
  ServiceRegistry,
  FolderRepairService,
  GroundingType,
  FrontmatterService,
  type GroundingDefinition,
  type IGroundingService,
  type IVaultAdapter,
  type IFile,
  type IFolder,
  type IFrontmatter,
} from "@kitelev/exocortex-core";
import {
  createRepairFolderService,
  createPathBasedTargetResolver,
} from "@kitelev/exocortex-services";

const TARGET_UID = "c1000000-0000-4000-8000-0000000000c1";
const SRC_ONTO_UID = "c2000000-0000-4000-8000-0000000000c2";
const ARCHIVE_ONTO_UID = "c3000000-0000-4000-8000-0000000000c3";

const SPACE = "assetspaces/kitelev/exoas-my/my-efforts";
const ARCHIVE_SPACE = `${SPACE}/archived`;

const TARGET_PATH = `${SPACE}/${TARGET_UID}.md`;
const SRC_ONTO_PATH = `${SPACE}/${SRC_ONTO_UID}.md`;
const ARCHIVE_ONTO_PATH = `${ARCHIVE_SPACE}/${ARCHIVE_ONTO_UID}.md`;

const TARGET_INITIAL = [
  "---",
  `exo__Asset_uid: ${TARGET_UID}`,
  `exo__Asset_label: "Action prototype"`,
  `exo__Asset_isDefinedBy: "[[${SRC_ONTO_UID}]]"`,
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

/** Minimal in-memory vault: disk is the single source of truth. */
class FakeVault {
  readonly disk = new Map<string, string>();
  readonly folders = new Set<string>();

  seed(path: string, content: string): void {
    this.disk.set(path, content);
    for (let dir = parentPath(path); dir !== ""; dir = parentPath(dir)) {
      this.folders.add(dir);
    }
  }

  readonly fileReader = {
    readFile: async (path: string): Promise<string> => {
      const c = this.disk.get(path);
      if (c === undefined) throw new Error(`ENOENT: ${path}`);
      return c;
    },
    fileExists: async (path: string): Promise<boolean> => this.disk.has(path),
    getMarkdownFiles: async (): Promise<string[]> => [...this.disk.keys()],
  };

  readonly fileWriter = {
    createFile: async (path: string, content: string): Promise<string> => {
      this.seed(path, content);
      return path;
    },
    updateFile: async (path: string, content: string): Promise<void> => {
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

  vaultAdapter(): IVaultAdapter {
    const self = this;
    return {
      read: async (file: IFile): Promise<string> => {
        const c = self.disk.get(file.path);
        if (c === undefined) throw new Error(`ENOENT: ${file.path}`);
        return c;
      },
      getFrontmatter: (file: IFile): IFrontmatter | null => {
        const c = self.disk.get(file.path);
        if (c === undefined) return null;
        return (new FrontmatterService().parseObject(c) ?? {}) as IFrontmatter;
      },
      getFirstLinkpathDest: (linkpath: string): IFile | null => {
        const hit = [...self.disk.keys()].find((p) => basename(p) === linkpath);
        return hit ? makeIFile(hit) : null;
      },
      getAbstractFileByPath: (path: string): IFile | IFolder | null => {
        if (self.disk.has(path)) return makeIFile(path);
        if (self.folders.has(path))
          return {
            path,
            name: path.split("/").pop() ?? "",
            children: [],
          } as unknown as IFolder;
        return null;
      },
      rename: async (file: IFile, newPath: string): Promise<void> => {
        const c = self.disk.get(file.path);
        if (c !== undefined) {
          self.disk.set(newPath, c);
          self.disk.delete(file.path);
        }
      },
      createFolder: async (path: string): Promise<void> => {
        self.folders.add(path);
      },
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

/** `create_instance` step: writes a new asset anchored to the ARCHIVE ontology
 *  but placed (deliberately) in the SOURCE folder, so repairFolder has work. */
function createStep(): GroundingDefinition {
  return {
    id: "step1-create-action-instance",
    label: "Create action instance",
    type: GroundingType.CREATE_INSTANCE,
    targetFolder: SPACE,
    targetClass: "ems__Action",
    labelTemplate: "Executed action",
    propertyDefault: [
      {
        propertyName: "exo__Asset_isDefinedBy",
        value: `"[[${ARCHIVE_ONTO_UID}]]"`,
      },
    ],
  };
}

function repairStep(targetsCreatedInstance?: boolean): GroundingDefinition {
  return {
    id: "step2-repair-folder",
    label: "Relocate to the ontology folder",
    type: GroundingType.SERVICE_CALL,
    // service_call overloads targetProperty as the serviceId.
    targetProperty: "repairFolder",
    ...(targetsCreatedInstance === undefined ? {} : { targetsCreatedInstance }),
  };
}

function composite(steps: GroundingDefinition[]): GroundingDefinition {
  return {
    id: "composite-create-and-repair",
    label: "Create instance, then relocate it",
    type: GroundingType.COMPOSITE,
    steps,
  };
}

function setup(): { vault: FakeVault; executor: GroundingExecutor } {
  const vault = new FakeVault();
  vault.seed(TARGET_PATH, TARGET_INITIAL);
  vault.seed(
    SRC_ONTO_PATH,
    [
      "---",
      `exo__Asset_uid: ${SRC_ONTO_UID}`,
      `exo__Asset_label: "My efforts ontology"`,
      "---",
      "",
    ].join("\n"),
  );
  vault.seed(
    ARCHIVE_ONTO_PATH,
    [
      "---",
      `exo__Asset_uid: ${ARCHIVE_ONTO_UID}`,
      `exo__Asset_label: "My efforts ontology (archive)"`,
      "---",
      "",
    ].join("\n"),
  );

  const vaultAdapter = vault.vaultAdapter();
  const registry = new ServiceRegistry();
  registry.register(
    "repairFolder",
    createRepairFolderService(
      vaultAdapter,
      new FolderRepairService(vaultAdapter),
      // REAL production resolver — accepts both `obsidian://vault/<path>` and a
      // bare vault-relative path, exactly like the CLI runtime.
      createPathBasedTargetResolver(vaultAdapter),
    ),
  );
  const executor = new GroundingExecutor(
    vault.fileReader,
    vault.fileWriter,
    registry,
  );
  return { vault, executor };
}

/** The single asset the composite created (everything except the seeds). */
function createdPathOf(vault: FakeVault): string {
  const seeded = new Set([TARGET_PATH, SRC_ONTO_PATH, ARCHIVE_ONTO_PATH]);
  const fresh = [...vault.disk.keys()].filter((p) => !seeded.has(p));
  expect(fresh).toHaveLength(1);
  return fresh[0];
}

describe("service_call honours targetsCreatedInstance (Issue #4046)", () => {
  it("relocates the CREATED asset, not the click-target", async () => {
    const { vault, executor } = setup();

    const result = await executor.execute(
      composite([createStep(), repairStep(true)]),
      TARGET_PATH,
      TARGET_PATH,
    );
    expect(result.success).toBe(true);

    // The created asset is anchored to the ARCHIVE ontology → repairFolder must
    // have moved it into `archived/`. With the bug it stays in SPACE.
    const created = createdPathOf(vault);
    expect(parentPath(created)).toBe(ARCHIVE_SPACE);
    expect(vault.disk.get(created)).toContain(
      `exo__Asset_isDefinedBy: "[[${ARCHIVE_ONTO_UID}]]"`,
    );

    // The click-target is untouched: same path, same ontology anchor.
    expect(vault.disk.has(TARGET_PATH)).toBe(true);
    expect(vault.disk.get(TARGET_PATH)).toContain(
      `exo__Asset_isDefinedBy: "[[${SRC_ONTO_UID}]]"`,
    );
  });

  it("without the flag the service still targets the click-target (no regression)", async () => {
    const { vault, executor } = setup();
    const seen: string[] = [];
    // Swap in a probe service so the assertion is on the IRI the executor hands
    // to the service — the exact seam the fix touches.
    const registryProbe: IGroundingService = {
      async execute(iri: string): Promise<void> {
        seen.push(iri);
      },
    };
    (
      executor as unknown as { serviceRegistry: ServiceRegistry }
    ).serviceRegistry.register("repairFolder", registryProbe);

    const result = await executor.execute(
      composite([createStep(), repairStep(/* flag absent */)]),
      TARGET_PATH,
      TARGET_PATH,
    );
    expect(result.success).toBe(true);
    expect(seen).toEqual([TARGET_PATH]);
    // The created asset was NOT relocated by anyone.
    expect(parentPath(createdPathOf(vault))).toBe(SPACE);
  });

  it("negative control: flag set but no prior create_instance still targets the click-target", async () => {
    const { vault, executor } = setup();
    const seen: string[] = [];
    (
      executor as unknown as { serviceRegistry: ServiceRegistry }
    ).serviceRegistry.register("repairFolder", {
      async execute(iri: string): Promise<void> {
        seen.push(iri);
      },
    } satisfies IGroundingService);

    const result = await executor.execute(
      composite([repairStep(true)]),
      TARGET_PATH,
      TARGET_PATH,
    );
    expect(result.success).toBe(true);
    // `stepPath` falls back to the click-target, so the service receives an IRI
    // that resolves to the click-target — not to some other asset.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(encodeURI(TARGET_PATH));
    expect(vault.disk.has(TARGET_PATH)).toBe(true);
  });

  it("the IRI handed to a flagged service resolves to the created file via the production resolver", async () => {
    const { vault, executor } = setup();
    const seen: string[] = [];
    (
      executor as unknown as { serviceRegistry: ServiceRegistry }
    ).serviceRegistry.register("repairFolder", {
      async execute(iri: string): Promise<void> {
        seen.push(iri);
      },
    } satisfies IGroundingService);

    const result = await executor.execute(
      composite([createStep(), repairStep(true)]),
      TARGET_PATH,
      TARGET_PATH,
    );
    expect(result.success).toBe(true);

    const created = createdPathOf(vault);
    expect(seen).toHaveLength(1);
    // Not the click-target — and the production resolver maps it back to the
    // created file (this is what makes every path-based service work).
    expect(seen[0]).not.toBe(TARGET_PATH);
    const resolved = createPathBasedTargetResolver(
      vault.vaultAdapter(),
    ).resolveFile(seen[0]);
    expect(resolved.path).toBe(created);
  });
});
