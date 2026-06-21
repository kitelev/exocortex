import {
  ClassCreationService,
  FolderRepairService,
  IVaultAdapter,
  IFile,
  IFolder,
} from "exocortex";

/**
 * Production-shape fake IVaultAdapter mirroring the real Obsidian contract the
 * co-location resolver (FolderRepairService → getFirstLinkpathDest) depends on
 * — `getFirstLinkpathDest` resolves a registered ontology linkpath to a file
 * with a `.parent.path`, and returns `null` for unknown linkpaths (as real
 * Obsidian does). Per test-fixture-realism: not a stub-returning-any.
 */
function makeVault(ontologyFolders: Record<string, string>) {
  const created: { path: string; content: string }[] = [];
  const createdFolders: string[] = [];
  const existingFolders = new Set<string>();

  const vault = {
    create: jest.fn(async (path: string, content: string): Promise<IFile> => {
      created.push({ path, content });
      const slash = path.lastIndexOf("/");
      const folderPath = slash >= 0 ? path.slice(0, slash) : "";
      const name = slash >= 0 ? path.slice(slash + 1) : path;
      return {
        path,
        basename: name.replace(/\.md$/, ""),
        extension: "md",
        name,
        parent: { path: folderPath },
      } as unknown as IFile;
    }),
    createFolder: jest.fn(async (path: string): Promise<void> => {
      createdFolders.push(path);
      existingFolders.add(path);
    }),
    getAbstractFileByPath: jest.fn((path: string) =>
      existingFolders.has(path)
        ? ({ path, name: path, children: [] } as unknown as IFolder)
        : null,
    ),
    getFirstLinkpathDest: jest.fn(
      (linkpath: string, _source: string): IFile | null => {
        const folder = ontologyFolders[linkpath];
        if (folder === undefined) return null;
        const name = `${linkpath}.md`;
        return {
          path: folder ? `${folder}/${name}` : name,
          basename: linkpath,
          extension: "md",
          name,
          parent: { path: folder },
        } as unknown as IFile;
      },
    ),
    modify: jest.fn(),
    read: jest.fn(),
    delete: jest.fn(),
    rename: jest.fn(),
    exists: jest.fn(),
    getFiles: jest.fn(),
  } as unknown as IVaultAdapter;

  return { vault, created, createdFolders };
}

function makeService(ontologyFolders: Record<string, string> = {}) {
  const { vault, created, createdFolders } = makeVault(ontologyFolders);
  const folderRepair = new FolderRepairService(vault);
  const service = new ClassCreationService(vault, folderRepair);
  return { service, vault, created, createdFolders };
}

const UID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/;

const ONT_UID = "ca97bb2f-0000-4000-8000-000000000001";
const ONT_FOLDER = "assetspaces/kitelev/exoas-exo/exo";

describe("ClassCreationService", () => {
  describe("createSubclass — co-location + UID-canon (DEFECT-D1)", () => {
    it("co-locates in the isDefinedBy ontology folder and UID-names the file", async () => {
      const { service, created } = makeService({ [ONT_UID]: ONT_FOLDER });
      const parentFile = {
        basename: "ParentClass",
        path: `${ONT_FOLDER}/ParentClass.md`,
        extension: "md",
        name: "ParentClass.md",
        parent: { path: ONT_FOLDER },
      } as IFile;

      const result = await service.createSubclass(parentFile, "Test Subclass", {
        exo__Asset_isDefinedBy: `"[[${ONT_UID}]]"`,
      });

      const filePath = created[0].path;
      // co-located in the ontology folder, NOT vault-root classes/
      expect(filePath).toMatch(
        new RegExp(`^${ONT_FOLDER}/${UID_RE.source}\\.md$`),
      );
      expect(filePath).not.toContain("classes/");
      // not label-named
      expect(filePath.toLowerCase()).not.toContain("test-subclass");
      expect(result.path).toBe(filePath);
    });

    it("falls back to the parent class folder when isDefinedBy is unresolvable (UID-named, never vault-root classes/)", async () => {
      const { service, created } = makeService({}); // nothing resolves
      const parentFile = {
        basename: "ParentClass",
        path: "classes/ParentClass.md",
        extension: "md",
        name: "ParentClass.md",
        parent: null,
      } as IFile;

      await service.createSubclass(parentFile, "Subclass", {
        exo__Asset_isDefinedBy: '"[[Ontology/EXO]]"',
      });

      const filePath = created[0].path;
      // parent lives in "classes/" → fallback keeps it there, but UID-named now
      expect(filePath).toMatch(new RegExp(`^classes/${UID_RE.source}\\.md$`));
      expect(filePath.toLowerCase()).not.toContain("subclass.md");
    });

    it("creates the resolved ontology folder when it does not exist", async () => {
      const { service, createdFolders } = makeService({
        [ONT_UID]: ONT_FOLDER,
      });
      const parentFile = {
        basename: "ParentClass",
        path: `${ONT_FOLDER}/ParentClass.md`,
        parent: { path: ONT_FOLDER },
      } as IFile;

      await service.createSubclass(parentFile, "Subclass", {
        exo__Asset_isDefinedBy: `"[[${ONT_UID}]]"`,
      });

      expect(createdFolders).toContain(ONT_FOLDER);
    });
  });

  describe("createSubclass — frontmatter", () => {
    function fixture(ontologyFolders: Record<string, string> = {}) {
      const ctx = makeService(ontologyFolders);
      const parentFile = {
        basename: "ParentClass",
        path: "classes/ParentClass.md",
        extension: "md",
        name: "ParentClass.md",
        parent: null,
      } as IFile;
      return { ...ctx, parentFile };
    }

    it("writes correct frontmatter", async () => {
      const { service, created, parentFile } = fixture();
      await service.createSubclass(parentFile, "Test Subclass", {
        exo__Asset_isDefinedBy: '"[[Ontology/EXO]]"',
      });
      const content = created[0].content;
      expect(content).toContain("exo__Asset_label: Test Subclass");
      expect(content).toContain('exo__Instance_class:\n  - "[[exo__Class]]"');
      expect(content).toContain('exo__Class_superClass: "[[ParentClass]]"');
      expect(content).toContain('exo__Asset_isDefinedBy: "[[Ontology/EXO]]"');
      expect(content).toContain("aliases:\n  - Test Subclass");
    });

    it("inherits isDefinedBy from parent", async () => {
      const { service, created, parentFile } = fixture();
      await service.createSubclass(parentFile, "Child", {
        exo__Asset_isDefinedBy: '"[[Custom/Ontology]]"',
      });
      expect(created[0].content).toContain(
        'exo__Asset_isDefinedBy: "[[Custom/Ontology]]"',
      );
    });

    it("uses default isDefinedBy when parent has none", async () => {
      const { service, created, parentFile } = fixture();
      await service.createSubclass(parentFile, "Child", {});
      expect(created[0].content).toContain(
        'exo__Asset_isDefinedBy: "[[Ontology/EXO]]"',
      );
    });

    it("includes createdAt timestamp", async () => {
      const { service, created, parentFile } = fixture();
      await service.createSubclass(parentFile, "Child", {});
      expect(created[0].content).toMatch(
        /exo__Asset_createdAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("generates a valid UUID for uid (matching the filename)", async () => {
      const { service, created, parentFile } = fixture();
      await service.createSubclass(parentFile, "Child", {});
      const content = created[0].content;
      expect(content).toMatch(
        new RegExp(`exo__Asset_uid: ${UID_RE.source}`),
      );
      const uidInFile = content.match(/exo__Asset_uid:\s*(\S+)/)?.[1];
      expect(created[0].path).toContain(`${uidInFile}.md`);
    });
  });
});
