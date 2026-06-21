import { AreaHierarchyBuilder } from "../../../src/services/AreaHierarchyBuilder";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";

describe("AreaHierarchyBuilder", () => {
  let builder: AreaHierarchyBuilder;
  let mockVault: jest.Mocked<IVaultAdapter>;

  const createMockFile = (overrides?: Partial<IFile>): IFile => ({
    path: "areas/area.md",
    basename: "area",
    name: "area.md",
    parent: { path: "areas", name: "areas" },
    ...overrides,
  });

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn().mockReturnValue([]),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      updateLinks: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;

    builder = new AreaHierarchyBuilder(mockVault);
  });

  describe("buildHierarchy", () => {
    it("should return null when current file is not found", () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      const result = builder.buildHierarchy("nonexistent.md", []);

      expect(result).toBeNull();
    });

    it("should return null when current file is a folder (not IFile)", () => {
      // Return an object that does not have basename/path like IFile
      mockVault.getAbstractFileByPath.mockReturnValue({
        path: "areas",
        name: "areas",
      } as any);

      const result = builder.buildHierarchy("areas", []);

      expect(result).toBeNull();
    });

    it("should return null when current file is not an Area", () => {
      const file = createMockFile();
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.PROJECT}]]`,
      });

      const result = builder.buildHierarchy("areas/area.md", []);

      expect(result).toBeNull();
    });

    it("should return null when instance class is empty string", () => {
      const file = createMockFile();
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: "",
      });

      const result = builder.buildHierarchy("areas/area.md", []);

      expect(result).toBeNull();
    });

    it("should return null when instance class is missing", () => {
      const file = createMockFile();
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getFrontmatter.mockReturnValue({});

      const result = builder.buildHierarchy("areas/area.md", []);

      expect(result).toBeNull();
    });

    it("should return null when frontmatter is null", () => {
      const file = createMockFile();
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getFrontmatter.mockReturnValue(null);

      const result = builder.buildHierarchy("areas/area.md", []);

      expect(result).toBeNull();
    });

    it("should build a single root area with no children", () => {
      const file = createMockFile({ path: "areas/root-area.md", basename: "root-area" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        exo__Asset_label: "Root Area",
      });
      mockVault.getAllFiles.mockReturnValue([file]);

      const result = builder.buildHierarchy("areas/root-area.md", []);

      expect(result).not.toBeNull();
      expect(result!.path).toBe("areas/root-area.md");
      expect(result!.title).toBe("root-area");
      expect(result!.label).toBe("Root Area");
      expect(result!.depth).toBe(0);
      expect(result!.children).toEqual([]);
    });

    it("should build hierarchy when exo__Instance_class uses UUID-alias form (issue #2764)", () => {
      // Regression for #2764: starter-kit-style frontmatter uses
      // "[[UUID|ems__Area]]" instead of "[[ems__Area]]" and the widget
      // would previously render nothing because the class comparison
      // stripped only brackets and left the "UUID|ems__Area" literal.
      const file = createMockFile({
        path: "areas/test-area-uuid.md",
        basename: "test-area-uuid",
      });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class:
          "[[82c74542-1b14-4217-b852-d84730484b25|ems__Area]]",
        exo__Asset_label: "Test Area UUID",
      });
      mockVault.getAllFiles.mockReturnValue([file]);

      const result = builder.buildHierarchy("areas/test-area-uuid.md", []);

      expect(result).not.toBeNull();
      expect(result!.path).toBe("areas/test-area-uuid.md");
      expect(result!.label).toBe("Test Area UUID");
      expect(result!.depth).toBe(0);
      expect(result!.children).toEqual([]);
    });

    it("should build hierarchy when exo__Instance_class is an array with UUID-alias form (issue #2764)", () => {
      const file = createMockFile({
        path: "areas/array-area.md",
        basename: "array-area",
      });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: [
          "[[82c74542-1b14-4217-b852-d84730484b25|ems__Area]]",
        ],
        exo__Asset_label: "Array Area",
      });
      mockVault.getAllFiles.mockReturnValue([file]);

      const result = builder.buildHierarchy("areas/array-area.md", []);

      expect(result).not.toBeNull();
      expect(result!.label).toBe("Array Area");
    });

    it("should build hierarchy with parent-child relationships", () => {
      const parentFile = createMockFile({
        path: "areas/parent.md",
        basename: "parent",
      });
      const childFile = createMockFile({
        path: "areas/child.md",
        basename: "child",
      });

      mockVault.getAbstractFileByPath.mockReturnValue(parentFile);
      mockVault.getAllFiles.mockReturnValue([parentFile, childFile]);

      // First call: for current file; subsequent: for all files
      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === "areas/parent.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            exo__Asset_label: "Parent",
          };
        }
        if (f.path === "areas/child.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            exo__Asset_label: "Child",
            ems__Area_parent: "[[parent]]",
          };
        }
        return {};
      });

      const result = builder.buildHierarchy("areas/parent.md", []);

      expect(result).not.toBeNull();
      expect(result!.children).toHaveLength(1);
      expect(result!.children[0].title).toBe("child");
      expect(result!.children[0].depth).toBe(1);
    });

    it("should handle instance class as array", () => {
      const file = createMockFile({ path: "areas/area.md", basename: "area" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: [`[[${AssetClass.AREA}]]`, `[[${AssetClass.PROTOTYPE}]]`],
      });
      mockVault.getAllFiles.mockReturnValue([file]);

      const result = builder.buildHierarchy("areas/area.md", []);

      expect(result).not.toBeNull();
    });

    it("should handle instance class as array with empty first element", () => {
      const file = createMockFile({ path: "areas/area.md", basename: "area" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: [],
      });
      mockVault.getAllFiles.mockReturnValue([file]);

      const result = builder.buildHierarchy("areas/area.md", []);

      // Empty array -> empty first element -> empty string -> not AREA
      expect(result).toBeNull();
    });

    it("should handle parent as array", () => {
      const parentFile = createMockFile({ path: "areas/parent.md", basename: "parent" });
      const childFile = createMockFile({ path: "areas/child.md", basename: "child" });

      mockVault.getAbstractFileByPath.mockReturnValue(parentFile);
      mockVault.getAllFiles.mockReturnValue([parentFile, childFile]);

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === "areas/parent.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
          };
        }
        if (f.path === "areas/child.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            ems__Area_parent: ["[[parent]]", "[[other]]"],
          };
        }
        return {};
      });

      const result = builder.buildHierarchy("areas/parent.md", []);

      expect(result).not.toBeNull();
      expect(result!.children).toHaveLength(1);
    });

    it("should handle parent array with empty first element", () => {
      const parentFile = createMockFile({ path: "areas/parent.md", basename: "parent" });
      const childFile = createMockFile({ path: "areas/child.md", basename: "child" });

      mockVault.getAbstractFileByPath.mockReturnValue(parentFile);
      mockVault.getAllFiles.mockReturnValue([parentFile, childFile]);

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === "areas/parent.md") {
          return { exo__Instance_class: `[[${AssetClass.AREA}]]` };
        }
        if (f.path === "areas/child.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            ems__Area_parent: [""],
          };
        }
        return {};
      });

      const result = builder.buildHierarchy("areas/parent.md", []);

      expect(result).not.toBeNull();
      // Child has empty parent path, so it should NOT be child of parent
      expect(result!.children).toHaveLength(0);
    });

    it("should prevent circular references", () => {
      const areaA = createMockFile({ path: "areas/a.md", basename: "a" });
      const areaB = createMockFile({ path: "areas/b.md", basename: "b" });

      mockVault.getAbstractFileByPath.mockReturnValue(areaA);
      mockVault.getAllFiles.mockReturnValue([areaA, areaB]);

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === "areas/a.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            ems__Area_parent: "[[b]]",
          };
        }
        if (f.path === "areas/b.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            ems__Area_parent: "[[a]]",
          };
        }
        return {};
      });

      // Should not infinitely recurse - visited set prevents it
      const result = builder.buildHierarchy("areas/a.md", []);

      expect(result).not.toBeNull();
      // B is child of A, and A is child of B but A is already visited
      // so no infinite loop
    });

    it("should sort children alphabetically by label or title", () => {
      const parent = createMockFile({ path: "areas/parent.md", basename: "parent" });
      const childC = createMockFile({ path: "areas/c.md", basename: "c" });
      const childA = createMockFile({ path: "areas/a.md", basename: "a" });
      const childB = createMockFile({ path: "areas/b.md", basename: "b" });

      mockVault.getAbstractFileByPath.mockReturnValue(parent);
      mockVault.getAllFiles.mockReturnValue([parent, childC, childA, childB]);

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === "areas/parent.md") {
          return { exo__Instance_class: `[[${AssetClass.AREA}]]` };
        }
        return {
          exo__Instance_class: `[[${AssetClass.AREA}]]`,
          ems__Area_parent: "[[parent]]",
        };
      });

      const result = builder.buildHierarchy("areas/parent.md", []);

      expect(result!.children).toHaveLength(3);
      expect(result!.children[0].title).toBe("a");
      expect(result!.children[1].title).toBe("b");
      expect(result!.children[2].title).toBe("c");
    });

    it("should sort children by label when available, falling back to title", () => {
      const parent = createMockFile({ path: "areas/parent.md", basename: "parent" });
      const childX = createMockFile({ path: "areas/x.md", basename: "x" });
      const childY = createMockFile({ path: "areas/y.md", basename: "y" });

      mockVault.getAbstractFileByPath.mockReturnValue(parent);
      mockVault.getAllFiles.mockReturnValue([parent, childX, childY]);

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === "areas/parent.md") {
          return { exo__Instance_class: `[[${AssetClass.AREA}]]` };
        }
        if (f.path === "areas/x.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            exo__Asset_label: "Zebra",
            ems__Area_parent: "[[parent]]",
          };
        }
        if (f.path === "areas/y.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            exo__Asset_label: "Apple",
            ems__Area_parent: "[[parent]]",
          };
        }
        return {};
      });

      const result = builder.buildHierarchy("areas/parent.md", []);

      // Apple (y) before Zebra (x)
      expect(result!.children[0].title).toBe("y");
      expect(result!.children[1].title).toBe("x");
    });

    it("should detect archived areas", () => {
      const file = createMockFile({ path: "areas/archived.md", basename: "archived" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        exo__Asset_archived: true,
      });

      const result = builder.buildHierarchy("areas/archived.md", []);

      expect(result).not.toBeNull();
      expect(result!.isArchived).toBe(true);
    });

    it("should detect archived areas with string 'true'", () => {
      const file = createMockFile({ path: "areas/archived.md", basename: "archived" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        exo__Asset_archived: "true",
      });

      const result = builder.buildHierarchy("areas/archived.md", []);

      expect(result!.isArchived).toBe(true);
    });

    it("should detect archived areas with array [true]", () => {
      const file = createMockFile({ path: "areas/archived.md", basename: "archived" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        exo__Asset_archived: [true],
      });

      const result = builder.buildHierarchy("areas/archived.md", []);

      expect(result!.isArchived).toBe(true);
    });

    it("should detect archived areas with array ['true']", () => {
      const file = createMockFile({ path: "areas/archived.md", basename: "archived" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        exo__Asset_archived: ["true"],
      });

      const result = builder.buildHierarchy("areas/archived.md", []);

      expect(result!.isArchived).toBe(true);
    });

    it("should not mark as archived when archived is false", () => {
      const file = createMockFile({ path: "areas/active.md", basename: "active" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        exo__Asset_archived: false,
      });

      const result = builder.buildHierarchy("areas/active.md", []);

      expect(result!.isArchived).toBe(false);
    });

    it("should not mark as archived when archived is 'false'", () => {
      const file = createMockFile({ path: "areas/active.md", basename: "active" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        exo__Asset_archived: "false",
      });

      const result = builder.buildHierarchy("areas/active.md", []);

      expect(result!.isArchived).toBe(false);
    });

    it("should not mark as archived when archived is undefined", () => {
      const file = createMockFile({ path: "areas/active.md", basename: "active" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
      });

      const result = builder.buildHierarchy("areas/active.md", []);

      expect(result!.isArchived).toBe(false);
    });

    it("should not mark as archived when archived is empty array", () => {
      const file = createMockFile({ path: "areas/active.md", basename: "active" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        exo__Asset_archived: [],
      });

      const result = builder.buildHierarchy("areas/active.md", []);

      expect(result!.isArchived).toBe(false);
    });

    it("should not mark as archived when archived array has false first element", () => {
      const file = createMockFile({ path: "areas/active.md", basename: "active" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        exo__Asset_archived: [false],
      });

      const result = builder.buildHierarchy("areas/active.md", []);

      expect(result!.isArchived).toBe(false);
    });

    it("should skip non-area files when collecting areas", () => {
      const areaFile = createMockFile({ path: "areas/area.md", basename: "area" });
      const taskFile = createMockFile({ path: "tasks/task.md", basename: "task" });

      mockVault.getAbstractFileByPath.mockReturnValue(areaFile);
      mockVault.getAllFiles.mockReturnValue([areaFile, taskFile]);

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === "areas/area.md") {
          return { exo__Instance_class: `[[${AssetClass.AREA}]]` };
        }
        if (f.path === "tasks/task.md") {
          return { exo__Instance_class: `[[${AssetClass.TASK}]]` };
        }
        return {};
      });

      const result = builder.buildHierarchy("areas/area.md", []);

      expect(result).not.toBeNull();
      expect(result!.children).toHaveLength(0);
    });

    it("should resolve parent path from basename to full path", () => {
      const parent = createMockFile({ path: "areas/parent.md", basename: "parent" });
      const child = createMockFile({ path: "areas/child.md", basename: "child" });

      mockVault.getAbstractFileByPath.mockReturnValue(parent);
      mockVault.getAllFiles.mockReturnValue([parent, child]);

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === "areas/parent.md") {
          return { exo__Instance_class: `[[${AssetClass.AREA}]]` };
        }
        if (f.path === "areas/child.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            // Parent is referenced by basename only, needs resolution
            ems__Area_parent: "[[parent]]",
          };
        }
        return {};
      });

      const result = builder.buildHierarchy("areas/parent.md", []);

      expect(result!.children).toHaveLength(1);
      expect(result!.children[0].title).toBe("child");
    });

    it("should return null for area not in the areas map (buildTree)", () => {
      const areaFile = createMockFile({ path: "areas/area.md", basename: "area" });

      mockVault.getAbstractFileByPath.mockReturnValue(areaFile);
      // Return area in getFrontmatter for the initial check
      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === "areas/area.md") {
          return { exo__Instance_class: `[[${AssetClass.AREA}]]` };
        }
        return {};
      });
      // But getAllFiles returns empty -> area won't be in the map
      mockVault.getAllFiles.mockReturnValue([]);

      const result = builder.buildHierarchy("areas/area.md", []);

      // buildTree can't find the path in areas map -> returns null
      expect(result).toBeNull();
    });

    it("should handle deep hierarchy (3+ levels)", () => {
      const grandparent = createMockFile({ path: "areas/gp.md", basename: "gp" });
      const parentArea = createMockFile({ path: "areas/p.md", basename: "p" });
      const childArea = createMockFile({ path: "areas/c.md", basename: "c" });

      mockVault.getAbstractFileByPath.mockReturnValue(grandparent);
      mockVault.getAllFiles.mockReturnValue([grandparent, parentArea, childArea]);

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === "areas/gp.md") {
          return { exo__Instance_class: `[[${AssetClass.AREA}]]` };
        }
        if (f.path === "areas/p.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            ems__Area_parent: "[[gp]]",
          };
        }
        if (f.path === "areas/c.md") {
          return {
            exo__Instance_class: `[[${AssetClass.AREA}]]`,
            ems__Area_parent: "[[p]]",
          };
        }
        return {};
      });

      const result = builder.buildHierarchy("areas/gp.md", []);

      expect(result).not.toBeNull();
      expect(result!.depth).toBe(0);
      expect(result!.children).toHaveLength(1);
      expect(result!.children[0].depth).toBe(1);
      expect(result!.children[0].children).toHaveLength(1);
      expect(result!.children[0].children[0].depth).toBe(2);
    });

    it("should handle cleanWikiLink with non-string value", () => {
      const file = createMockFile({ path: "areas/area.md", basename: "area" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      // exo__Instance_class is a number (non-string)
      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: 123 as any,
      });

      const result = builder.buildHierarchy("areas/area.md", []);

      // cleanWikiLink returns "" for non-string -> not AREA
      expect(result).toBeNull();
    });

    it("should handle missing parent property", () => {
      const file = createMockFile({ path: "areas/area.md", basename: "area" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        // No ems__Area_parent
      });

      const result = builder.buildHierarchy("areas/area.md", []);

      expect(result).not.toBeNull();
      expect(result!.parentPath).toBeUndefined();
    });

    it("should use label from metadata when available", () => {
      const file = createMockFile({ path: "areas/area.md", basename: "area" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
        exo__Asset_label: "My Custom Label",
      });

      const result = builder.buildHierarchy("areas/area.md", []);

      expect(result!.label).toBe("My Custom Label");
    });

    it("should leave label undefined when not in metadata", () => {
      const file = createMockFile({ path: "areas/area.md", basename: "area" });
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.getAllFiles.mockReturnValue([file]);

      mockVault.getFrontmatter.mockReturnValue({
        exo__Instance_class: `[[${AssetClass.AREA}]]`,
      });

      const result = builder.buildHierarchy("areas/area.md", []);

      expect(result!.label).toBeUndefined();
    });

    it("should handle isFile check - object without basename", () => {
      // An object with path but no basename should fail isFile
      mockVault.getAbstractFileByPath.mockReturnValue({
        path: "areas",
        name: "areas",
        children: [],
      } as any);

      const result = builder.buildHierarchy("areas", []);

      expect(result).toBeNull();
    });
  });
});
