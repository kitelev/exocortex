import "reflect-metadata";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { ClassCreationService } from "../../../src/services/ClassCreationService";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";

describe("ClassCreationService", () => {
  let service: ClassCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      create: jest.fn<(path: string, content: string) => Promise<IFile>>(),
      createFolder: jest.fn<(path: string) => Promise<void>>(),
      getAbstractFileByPath: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockVault.create.mockResolvedValue({ path: "classes/my-class.md", basename: "my-class" } as IFile);

    service = new (ClassCreationService as any)(mockVault);
  });

  describe("createSubclass", () => {
    it("should create file in classes folder", async () => {
      const parentFile = { basename: "exo__Class", path: "classes/exo__Class.md" } as IFile;

      await service.createSubclass(parentFile, "My New Class", {});

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining("classes/"),
        expect.any(String),
      );
    });

    it("should create classes folder if not exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      const parentFile = { basename: "exo__Class" } as IFile;

      await service.createSubclass(parentFile, "Test", {});

      expect(mockVault.createFolder).toHaveBeenCalledWith("classes");
    });

    it("should not create folder if already exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue({ path: "classes", name: "classes" });
      const parentFile = { basename: "exo__Class" } as IFile;

      await service.createSubclass(parentFile, "Test", {});

      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });

    it("should generate frontmatter with exo__Instance_class", async () => {
      const parentFile = { basename: "exo__Class" } as IFile;

      await service.createSubclass(parentFile, "My Class", {});

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("exo__Instance_class");
      expect(content).toContain("exo__Class");
    });

    it("should include parent class as superClass", async () => {
      const parentFile = { basename: "ParentClass" } as IFile;

      await service.createSubclass(parentFile, "Child", {});

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("exo__Class_superClass");
      expect(content).toContain("[[ParentClass]]");
    });

    it("should use isDefinedBy from parent metadata", async () => {
      const parentFile = { basename: "Parent" } as IFile;
      const metadata = { exo__Asset_isDefinedBy: '"[[MyOntology]]"' };

      await service.createSubclass(parentFile, "Child", metadata);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("[[MyOntology]]");
    });

    it("should use default isDefinedBy when parent has none", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createSubclass(parentFile, "Child", {});

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("exo__Asset_isDefinedBy");
    });

    it("should generate clean filenames from labels", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createSubclass(parentFile, "My Test Class!", {});

      const filePath = mockVault.create.mock.calls[0][0];
      expect(filePath).toMatch(/classes\/[a-z0-9-]+\.md$/);
    });

    it("should add .md extension if not present", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createSubclass(parentFile, "Test", {});

      const filePath = mockVault.create.mock.calls[0][0];
      expect(filePath).toMatch(/\.md$/);
    });

    it("should include aliases in frontmatter", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createSubclass(parentFile, "My Label", {});

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("aliases");
      expect(content).toContain("My Label");
    });
  });
});
