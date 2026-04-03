import "reflect-metadata";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { ProjectCreationService } from "../../../src/services/ProjectCreationService";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";

describe("ProjectCreationService", () => {
  let service: ProjectCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      create: jest.fn<(path: string, content: string) => Promise<IFile>>(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockVault.create.mockResolvedValue({ path: "projects/test.md", basename: "test" } as IFile);

    service = new (ProjectCreationService as any)(mockVault);
  });

  describe("createProject", () => {
    it("should create project file", async () => {
      const sourceFile = { basename: "SourceArea", parent: { path: "areas" } } as IFile;

      await service.createProject(sourceFile, {}, "ems__Area");

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining("areas/"),
        expect.any(String),
      );
    });

    it("should create project in root when no parent folder", async () => {
      const sourceFile = { basename: "Source", parent: null } as unknown as IFile;

      await service.createProject(sourceFile, {}, "ems__Area");

      const filePath = mockVault.create.mock.calls[0][0];
      expect(filePath).toMatch(/^[0-9a-f-]+\.md$/);
    });

    it("should include ems__Project instance class", async () => {
      const sourceFile = { basename: "Source", parent: { path: "p" } } as IFile;

      await service.createProject(sourceFile, {}, "ems__Area");

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ems__Project");
    });
  });

  describe("generateProjectFrontmatter", () => {
    it("should use ems__Effort_area for Area source class", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "MyArea",
        "ems__Area",
      );
      expect(fm["ems__Effort_area"]).toContain("[[MyArea]]");
    });

    it("should use ems__Effort_parent for Initiative source class", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "MyInitiative",
        "ems__Initiative",
      );
      expect(fm["ems__Effort_parent"]).toContain("[[MyInitiative]]");
    });

    it("should use ems__Effort_parent for Project source class", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "ParentProject",
        "ems__Project",
      );
      expect(fm["ems__Effort_parent"]).toContain("[[ParentProject]]");
    });

    it("should fallback to ems__Effort_area for unknown source class", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "Source",
        "unknown__Class",
      );
      expect(fm["ems__Effort_area"]).toContain("[[Source]]");
    });

    it("should include label and aliases when label provided", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "Source",
        "ems__Area",
        "My Project Label",
      );
      expect(fm["exo__Asset_label"]).toBe("My Project Label");
      expect(fm["aliases"]).toEqual(["My Project Label"]);
    });

    it("should not include label when empty string", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "Source",
        "ems__Area",
        "",
      );
      expect(fm["exo__Asset_label"]).toBeUndefined();
      expect(fm["aliases"]).toBeUndefined();
    });

    it("should not include label when whitespace only", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "Source",
        "ems__Area",
        "   ",
      );
      expect(fm["exo__Asset_label"]).toBeUndefined();
    });

    it("should trim label", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "Source",
        "ems__Area",
        "  Trimmed Label  ",
      );
      expect(fm["exo__Asset_label"]).toBe("Trimmed Label");
    });

    it("should set draft status", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "Source",
        "ems__Area",
      );
      expect(fm["ems__Effort_status"]).toContain("ems__EffortStatusDraft");
    });

    it("should generate uid when not provided", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "Source",
        "ems__Area",
      );
      expect(fm["exo__Asset_uid"]).toBeDefined();
      expect(fm["exo__Asset_uid"]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("should use provided uid", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "Source",
        "ems__Area",
        undefined,
        "custom-uid-1234",
      );
      expect(fm["exo__Asset_uid"]).toBe("custom-uid-1234");
    });

    it("should handle wikilink class normalization", () => {
      const fm = service.generateProjectFrontmatter(
        {},
        "Source",
        '"[[ems__Area]]"',
      );
      expect(fm["ems__Effort_area"]).toContain("[[Source]]");
    });
  });
});
