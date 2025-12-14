import {
  AreaHierarchyBuilder,
  type AssetRelation,
  type IVaultAdapter,
  type IFile,
} from "exocortex";

describe("AreaHierarchyBuilder", () => {
  let builder: AreaHierarchyBuilder;
  let mockVaultAdapter: IVaultAdapter;

  beforeEach(() => {
    mockVaultAdapter = {
      getAbstractFileByPath: jest.fn(),
      getAllFiles: jest.fn(() => []),
      getFrontmatter: jest.fn(),
      read: jest.fn().mockResolvedValue(""),
      create: jest.fn().mockResolvedValue({} as any),
      modify: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      updateFrontmatter: jest.fn().mockResolvedValue(undefined),
      rename: jest.fn().mockResolvedValue(undefined),
      createFolder: jest.fn().mockResolvedValue(undefined),
      getFirstLinkpathDest: jest.fn().mockReturnValue(null),
      process: jest.fn().mockResolvedValue(""),
    } as any;
    builder = new AreaHierarchyBuilder(mockVaultAdapter);
  });

  describe("buildHierarchy", () => {
    it("should return null for non-Area assets", () => {
      const currentAreaPath = "task.md";
      mockVaultAdapter.getAbstractFileByPath.mockReturnValue({
        basename: "task",
        path: currentAreaPath,
        stat: { ctime: 0, mtime: 0 },
      });
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Instance_class: "ems__Task",
      });

      const result = builder.buildHierarchy(currentAreaPath, []);

      expect(result).toBeNull();
    });

    it("should build single node hierarchy for area without parent", () => {
      const currentAreaPath = "areas/root.md";
      const rootFile = {
        basename: "root",
        path: currentAreaPath,
        stat: { ctime: 0, mtime: 0 },
      };

      mockVaultAdapter.getAbstractFileByPath.mockReturnValue(rootFile);
      mockVaultAdapter.getAllFiles.mockReturnValue([rootFile]);
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Instance_class: "ems__Area",
        exo__Asset_label: "Root Area",
      });

      const result = builder.buildHierarchy(currentAreaPath, []);

      expect(result).not.toBeNull();
      expect(result?.path).toBe(currentAreaPath);
      expect(result?.title).toBe("root");
      expect(result?.label).toBe("Root Area");
      expect(result?.children).toHaveLength(0);
      expect(result?.depth).toBe(0);
    });

    it("should build two-level hierarchy with parent-child relationship", () => {
      const rootPath = "areas/root.md";
      const childPath = "areas/child.md";

      const rootFile = {
        basename: "root",
        path: rootPath,
        stat: { ctime: 0, mtime: 0 },
      };
      const childFile = {
        basename: "child",
        path: childPath,
        stat: { ctime: 0, mtime: 0 },
      };

      mockVaultAdapter.getAbstractFileByPath.mockImplementation(
        (path: string) => {
          if (path === rootPath) return rootFile;
          if (path === childPath) return childFile;
          return null;
        },
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([rootFile, childFile]);

      mockVaultAdapter.getFrontmatter.mockImplementation((file: any) => {
        if (file.path === rootPath) {
          return {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Root Area",
          };
        }
        if (file.path === childPath) {
          return {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Child Area",
            ems__Area_parent: "[[root]]",
          };
        }
        return null;
      });

      const relations: AssetRelation[] = [
        {
          path: childPath,
          title: "child",
          metadata: {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Child Area",
            ems__Area_parent: "[[root]]",
          },
          isArchived: false,
        },
      ];

      const result = builder.buildHierarchy(rootPath, relations);

      expect(result).not.toBeNull();
      expect(result?.path).toBe(rootPath);
      expect(result?.children).toHaveLength(1);
      expect(result?.children[0]?.path).toBe(childPath);
      expect(result?.children[0]?.label).toBe("Child Area");
      expect(result?.children[0]?.depth).toBe(1);
    });

    it("should build three-level hierarchy with grandchildren", () => {
      const rootPath = "areas/root.md";
      const childPath = "areas/child.md";
      const grandchildPath = "areas/grandchild.md";

      const rootFile = {
        basename: "root",
        path: rootPath,
        stat: { ctime: 0, mtime: 0 },
      };
      const childFile = {
        basename: "child",
        path: childPath,
        stat: { ctime: 0, mtime: 0 },
      };
      const grandchildFile = {
        basename: "grandchild",
        path: grandchildPath,
        stat: { ctime: 0, mtime: 0 },
      };

      mockVaultAdapter.getAbstractFileByPath.mockImplementation(
        (path: string) => {
          const fileMap: Record<string, any> = {
            [rootPath]: rootFile,
            [childPath]: childFile,
            [grandchildPath]: grandchildFile,
          };
          return fileMap[path] || null;
        },
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([
        rootFile,
        childFile,
        grandchildFile,
      ]);

      mockVaultAdapter.getFrontmatter.mockImplementation((file: any) => {
        if (file.path === rootPath) {
          return {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Root",
          };
        }
        if (file.path === childPath) {
          return {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Child",
            ems__Area_parent: "[[root]]",
          };
        }
        if (file.path === grandchildPath) {
          return {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Grandchild",
            ems__Area_parent: "[[child]]",
          };
        }
        return null;
      });

      const relations: AssetRelation[] = [
        {
          path: childPath,
          title: "child",
          metadata: {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Child",
            ems__Area_parent: "[[root]]",
          },
          isArchived: false,
        },
        {
          path: grandchildPath,
          title: "grandchild",
          metadata: {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Grandchild",
            ems__Area_parent: "[[child]]",
          },
          isArchived: false,
        },
      ];

      const result = builder.buildHierarchy(rootPath, relations);

      expect(result).not.toBeNull();
      expect(result?.children).toHaveLength(1);
      expect(result?.children[0]?.children).toHaveLength(1);
      expect(result?.children[0]?.children[0]?.path).toBe(grandchildPath);
      expect(result?.children[0]?.children[0]?.depth).toBe(2);
    });

    it("should handle archived areas", () => {
      const rootPath = "areas/root.md";
      const childPath = "areas/archived-child.md";

      const rootFile = {
        basename: "root",
        path: rootPath,
        stat: { ctime: 0, mtime: 0 },
      };
      const childFile = {
        basename: "archived-child",
        path: childPath,
        stat: { ctime: 0, mtime: 0 },
      };

      mockVaultAdapter.getAbstractFileByPath.mockImplementation(
        (path: string) => {
          if (path === rootPath) return rootFile;
          return null;
        },
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([rootFile, childFile]);

      mockVaultAdapter.getFrontmatter.mockImplementation((file: any) => {
        if (file.path === rootPath) {
          return {
            exo__Instance_class: "ems__Area",
          };
        }
        if (file.path === childPath) {
          return {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Archived Child",
            ems__Area_parent: "[[root]]",
            exo__Asset_archived: true,
          };
        }
        return null;
      });

      const relations: AssetRelation[] = [
        {
          path: childPath,
          title: "archived-child",
          metadata: {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Archived Child",
            ems__Area_parent: "[[root]]",
            exo__Asset_archived: true,
          },
          isArchived: true,
        },
      ];

      const result = builder.buildHierarchy(rootPath, relations);

      expect(result).not.toBeNull();
      expect(result?.children).toHaveLength(1);
      expect(result?.children[0]?.isArchived).toBe(true);
    });

    it("should detect and prevent circular references", () => {
      const area1Path = "areas/area1.md";
      const area2Path = "areas/area2.md";

      const area1File = {
        basename: "area1",
        path: area1Path,
        stat: { ctime: 0, mtime: 0 },
      };
      const area2File = {
        basename: "area2",
        path: area2Path,
        stat: { ctime: 0, mtime: 0 },
      };

      mockVaultAdapter.getAbstractFileByPath.mockImplementation(
        (path: string) => {
          const fileMap: Record<string, any> = {
            [area1Path]: area1File,
            [area2Path]: area2File,
          };
          return fileMap[path] || null;
        },
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([area1File, area2File]);

      mockVaultAdapter.getFrontmatter.mockImplementation((file: any) => {
        if (file.path === area1Path) {
          return {
            exo__Instance_class: "ems__Area",
            ems__Area_parent: "[[area2]]",
          };
        }
        if (file.path === area2Path) {
          return {
            exo__Instance_class: "ems__Area",
            ems__Area_parent: "[[area1]]",
          };
        }
        return null;
      });

      const relations: AssetRelation[] = [
        {
          path: area2Path,
          title: "area2",
          metadata: {
            exo__Instance_class: "ems__Area",
            ems__Area_parent: "[[area1]]",
          },
          isArchived: false,
        },
      ];

      const result = builder.buildHierarchy(area1Path, relations);

      expect(result).not.toBeNull();
    });

    it("should sort children alphabetically by label", () => {
      const rootPath = "areas/root.md";
      const child1Path = "areas/zebra.md";
      const child2Path = "areas/alpha.md";
      const child3Path = "areas/middle.md";

      const rootFile = {
        basename: "root",
        path: rootPath,
        stat: { ctime: 0, mtime: 0 },
      };
      const child1File = {
        basename: "zebra",
        path: child1Path,
        stat: { ctime: 0, mtime: 0 },
      };
      const child2File = {
        basename: "alpha",
        path: child2Path,
        stat: { ctime: 0, mtime: 0 },
      };
      const child3File = {
        basename: "middle",
        path: child3Path,
        stat: { ctime: 0, mtime: 0 },
      };

      mockVaultAdapter.getAbstractFileByPath.mockImplementation(
        (path: string) => {
          if (path === rootPath) {
            return rootFile;
          }
          return null;
        },
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([
        rootFile,
        child1File,
        child2File,
        child3File,
      ]);

      mockVaultAdapter.getFrontmatter.mockImplementation((file: any) => {
        if (file.path === rootPath) {
          return {
            exo__Instance_class: "ems__Area",
          };
        }
        if (file.path === child1Path) {
          return {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Zebra Area",
            ems__Area_parent: "[[root]]",
          };
        }
        if (file.path === child2Path) {
          return {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Alpha Area",
            ems__Area_parent: "[[root]]",
          };
        }
        if (file.path === child3Path) {
          return {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Middle Area",
            ems__Area_parent: "[[root]]",
          };
        }
        return null;
      });

      const relations: AssetRelation[] = [
        {
          path: child1Path,
          title: "zebra",
          metadata: {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Zebra Area",
            ems__Area_parent: "[[root]]",
          },
          isArchived: false,
        },
        {
          path: child2Path,
          title: "alpha",
          metadata: {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Alpha Area",
            ems__Area_parent: "[[root]]",
          },
          isArchived: false,
        },
        {
          path: child3Path,
          title: "middle",
          metadata: {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Middle Area",
            ems__Area_parent: "[[root]]",
          },
          isArchived: false,
        },
      ];

      const result = builder.buildHierarchy(rootPath, relations);

      expect(result).not.toBeNull();
      expect(result?.children).toHaveLength(3);
      expect(result?.children[0]?.label).toBe("Alpha Area");
      expect(result?.children[1]?.label).toBe("Middle Area");
      expect(result?.children[2]?.label).toBe("Zebra Area");
    });

    it("should handle areas with array format for ems__Area_parent", () => {
      const rootPath = "areas/root.md";
      const childPath = "areas/child.md";

      const rootFile = {
        basename: "root",
        path: rootPath,
        stat: { ctime: 0, mtime: 0 },
      };
      const childFile = {
        basename: "child",
        path: childPath,
        stat: { ctime: 0, mtime: 0 },
      };

      mockVaultAdapter.getAbstractFileByPath.mockImplementation(
        (path: string) => {
          if (path === rootPath) {
            return rootFile;
          }
          return null;
        },
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([rootFile, childFile]);

      mockVaultAdapter.getFrontmatter.mockImplementation((file: any) => {
        if (file.path === rootPath) {
          return {
            exo__Instance_class: "ems__Area",
          };
        }
        if (file.path === childPath) {
          return {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Child Area",
            ems__Area_parent: ["[[root]]"],
          };
        }
        return null;
      });

      const relations: AssetRelation[] = [
        {
          path: childPath,
          title: "child",
          metadata: {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Child Area",
            ems__Area_parent: ["[[root]]"],
          },
          isArchived: false,
        },
      ];

      const result = builder.buildHierarchy(rootPath, relations);

      expect(result).not.toBeNull();
      expect(result?.children).toHaveLength(1);
      expect(result?.children[0]?.parentPath).toBe(rootPath);
    });

    it("should start from current area when it is a child", () => {
      const rootPath = "areas/root.md";
      const childPath = "areas/child.md";

      const rootFile = {
        basename: "root",
        path: rootPath,
        stat: { ctime: 0, mtime: 0 },
      };
      const childFile = {
        basename: "child",
        path: childPath,
        stat: { ctime: 0, mtime: 0 },
      };

      mockVaultAdapter.getAbstractFileByPath.mockImplementation(
        (path: string) => {
          const fileMap: Record<string, any> = {
            [rootPath]: rootFile,
            [childPath]: childFile,
          };
          return fileMap[path] || null;
        },
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([rootFile, childFile]);

      mockVaultAdapter.getFrontmatter.mockImplementation((file: any) => {
        if (file.path === rootPath) {
          return {
            exo__Instance_class: "ems__Area",
          };
        }
        if (file.path === childPath) {
          return {
            exo__Instance_class: "ems__Area",
            ems__Area_parent: "[[root]]",
          };
        }
        return null;
      });

      const relations: AssetRelation[] = [
        {
          path: rootPath,
          title: "root",
          metadata: {
            exo__Instance_class: "ems__Area",
            exo__Asset_label: "Root Area",
          },
          isArchived: false,
        },
      ];

      const result = builder.buildHierarchy(childPath, relations);

      expect(result).not.toBeNull();
      expect(result?.path).toBe(childPath);
      expect(result?.children).toHaveLength(0);
    });
  });
});
