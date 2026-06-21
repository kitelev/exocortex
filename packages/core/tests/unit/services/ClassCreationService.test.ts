import "reflect-metadata";
import { describe, it, expect, jest } from "@jest/globals";
import { ClassCreationService } from "../../../src/services/ClassCreationService";
import { FolderRepairService } from "../../../src/services/FolderRepairService";
import type {
  IVaultAdapter,
  IFile,
  IFolder,
} from "../../../src/interfaces/IVaultAdapter";

/**
 * Production-shape fake IVaultAdapter that mirrors the real Obsidian /
 * vault-adapter contract used by the co-location resolver
 * (FolderRepairService → getFirstLinkpathDest), per test-fixture-realism:
 *
 *  - `getFirstLinkpathDest(linkpath, source)` resolves a UID/basename linkpath
 *    to its ontology file ONLY when registered, returning `null` for unknown
 *    linkpaths — exactly as real Obsidian does (it does NOT invent a file).
 *  - the resolved ontology file exposes a `.parent.path` folder, which is what
 *    co-location reads back.
 *
 * This lets the revert-verify tests exercise the real placement logic rather
 * than a stub-returning-any.
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
    // Real Obsidian semantics: resolve a linkpath to its file, null when the
    // linkpath is unknown.
    getFirstLinkpathDest: jest.fn(
      (linkpath: string, _source: string): IFile | null => {
        const folder = ontologyFolders[linkpath];
        if (folder === undefined) return null;
        const name = `${linkpath}.md`;
        return {
          path: folder ? `${folder}/${name}` : name,
          basename: linkpath,
          name,
          parent: { path: folder },
        } as unknown as IFile;
      },
    ),
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
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

describe("ClassCreationService", () => {
  describe("createSubclass — co-location + UID-canon (DEFECT-D1)", () => {
    const ONT_UID = "ca97bb2f-0000-4000-8000-000000000001";
    const ONT_FOLDER = "assetspaces/kitelev/exoas-exo/exo";

    it("co-locates the new class in its isDefinedBy ontology folder (NOT vault-root classes/)", async () => {
      const { service, created } = makeService({ [ONT_UID]: ONT_FOLDER });
      const parentFile = {
        basename: "ae56ca4c-0000-4000-8000-000000000002",
        path: `${ONT_FOLDER}/ae56ca4c-0000-4000-8000-000000000002.md`,
      } as IFile;

      await service.createSubclass(parentFile, "NightUxccTestSubclass", {
        exo__Asset_isDefinedBy: `"[[${ONT_UID}]]"`,
      });

      const filePath = created[0].path;
      expect(filePath.startsWith(`${ONT_FOLDER}/`)).toBe(true);
      // Revert-verify anchor: with the bug (hardcoded "classes/" + label name)
      // this file would be "classes/nightuxcctestsubclass.md".
      expect(filePath).not.toContain("classes/");
      expect(filePath.toLowerCase()).not.toContain("nightuxcctestsubclass");
    });

    it("UID-names the new class file (NOT label-named lowercase)", async () => {
      const { service, created } = makeService({ [ONT_UID]: ONT_FOLDER });
      const parentFile = {
        basename: "Parent",
        path: `${ONT_FOLDER}/Parent.md`,
      } as IFile;

      await service.createSubclass(parentFile, "My Test Class!", {
        exo__Asset_isDefinedBy: `"[[${ONT_UID}]]"`,
      });

      const filePath = created[0].path;
      // <uuid>.md — matches the file's own exo__Asset_uid, not the label.
      expect(filePath).toMatch(
        new RegExp(`^${ONT_FOLDER}/${UID_RE.source}\\.md$`),
      );
      const content = created[0].content;
      const uidInFile = content.match(/exo__Asset_uid:\s*(\S+)/)?.[1];
      expect(filePath).toBe(`${ONT_FOLDER}/${uidInFile}.md`);
    });

    it("creates the resolved ontology folder when it does not yet exist", async () => {
      const { service, createdFolders } = makeService({
        [ONT_UID]: ONT_FOLDER,
      });
      const parentFile = {
        basename: "Parent",
        path: `${ONT_FOLDER}/Parent.md`,
      } as IFile;

      await service.createSubclass(parentFile, "Child", {
        exo__Asset_isDefinedBy: `"[[${ONT_UID}]]"`,
      });

      expect(createdFolders).toContain(ONT_FOLDER);
    });

    it("falls back to the parent class folder when isDefinedBy is unresolvable (still UID-named, never vault-root classes/)", async () => {
      // No ontologies registered → getFirstLinkpathDest returns null →
      // FolderRepairService.getExpectedFolderSync returns null → fall back to
      // the parent class's own (co-located) folder, mirroring GroundingExecutor.
      const { service, created } = makeService({});
      const parentFile = {
        basename: "Parent",
        path: "assetspaces/kitelev/exoas-public/ems/Parent.md",
      } as IFile;

      await service.createSubclass(parentFile, "Child", {
        exo__Asset_isDefinedBy: '"[[Ontology/EXO]]"',
      });

      const filePath = created[0].path;
      expect(filePath).toMatch(
        new RegExp(
          `^assetspaces/kitelev/exoas-public/ems/${UID_RE.source}\\.md$`,
        ),
      );
      expect(filePath).not.toContain("classes/");
    });

    it("places the class at the vault root when its ontology lives at the root", async () => {
      const { service, created } = makeService({ "root-onto": "" });
      const parentFile = { basename: "Parent", path: "Parent.md" } as IFile;

      await service.createSubclass(parentFile, "Child", {
        exo__Asset_isDefinedBy: '"[[root-onto]]"',
      });

      const filePath = created[0].path;
      expect(filePath).toMatch(new RegExp(`^${UID_RE.source}\\.md$`));
      expect(filePath).not.toContain("/");
    });
  });

  describe("createSubclass — frontmatter (unchanged by D1 fix)", () => {
    const ONT_UID = "ca97bb2f-0000-4000-8000-000000000001";
    const ONT_FOLDER = "assetspaces/kitelev/exoas-exo/exo";

    function frontmatterFixture() {
      const { service, created } = makeService({ [ONT_UID]: ONT_FOLDER });
      const parentFile = {
        basename: "ParentClass",
        path: `${ONT_FOLDER}/ParentClass.md`,
      } as IFile;
      return { service, created, parentFile };
    }

    it("declares exo__Instance_class as exo__Class", async () => {
      const { service, created, parentFile } = frontmatterFixture();
      await service.createSubclass(parentFile, "My Class", {
        exo__Asset_isDefinedBy: `"[[${ONT_UID}]]"`,
      });
      const content = created[0].content;
      expect(content).toContain("exo__Instance_class");
      expect(content).toContain("exo__Class");
    });

    it("includes the parent class as exo__Class_superClass", async () => {
      const { service, created, parentFile } = frontmatterFixture();
      await service.createSubclass(parentFile, "Child", {
        exo__Asset_isDefinedBy: `"[[${ONT_UID}]]"`,
      });
      const content = created[0].content;
      expect(content).toContain("exo__Class_superClass");
      expect(content).toContain("[[ParentClass]]");
    });

    it("propagates isDefinedBy from the parent metadata", async () => {
      const { service, created, parentFile } = frontmatterFixture();
      await service.createSubclass(parentFile, "Child", {
        exo__Asset_isDefinedBy: `"[[${ONT_UID}]]"`,
      });
      const content = created[0].content;
      expect(content).toContain(`[[${ONT_UID}]]`);
    });

    it("uses a default isDefinedBy when the parent has none", async () => {
      const { service, created } = makeService({});
      const parentFile = {
        basename: "Parent",
        path: "classes/Parent.md",
      } as IFile;
      await service.createSubclass(parentFile, "Child", {});
      const content = created[0].content;
      expect(content).toContain("exo__Asset_isDefinedBy");
    });

    it("includes the label in aliases and as the asset label", async () => {
      const { service, created, parentFile } = frontmatterFixture();
      await service.createSubclass(parentFile, "My Label", {
        exo__Asset_isDefinedBy: `"[[${ONT_UID}]]"`,
      });
      const content = created[0].content;
      expect(content).toContain("aliases");
      expect(content).toContain("My Label");
      expect(content).toMatch(UID_RE); // exo__Asset_uid present
    });
  });
});
